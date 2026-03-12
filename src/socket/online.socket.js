const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const ExternalPlayer = require('../models/externalPlayer.model');
const Match = require('../models/match.model');
const CoinTransaction = require('../models/coinTransaction.model');
const { getOnlineStats } = require('../utils/onlineStats');
const {
  createInitialState,
  calculateLegalMoves,
  executeMove,
  endTurn,
  rollDice,
} = require('../game/gameEngine');

const TURN_MS = 30_000;
const PROMPT_MS = 10_000;

const onlineUsers = new Map(); // userId -> { user, socketId }
const pendingRequests = new Map(); // toUserId -> { fromUserId, stake }
const activeMatches = new Map(); // roomId -> { roomId, players: {white, black}, state, timers, extended, stake, settled }

function isNativeUser(userLike) {
  return userLike?.type !== 'external';
}

function toPublicUser(record) {
  return record.user;
}

async function getExternalOnlineStats(externalPlayerId) {
  const [wins, losses, total] = await Promise.all([
    Match.countDocuments({ mode: 'online', winnerExternalPlayerId: externalPlayerId }),
    Match.countDocuments({ mode: 'online', loserExternalPlayerId: externalPlayerId }),
    Match.countDocuments({ mode: 'online', 'participantSnapshots.externalPlayerId': externalPlayerId }),
  ]);

  return { wins, losses, total };
}

function getMatchParticipant(match, userId) {
  if (!match?.participantsByUserId) return null;
  return match.participantsByUserId[userId] || null;
}

function getWinnerParticipant(match, winnerId) {
  return getMatchParticipant(match, winnerId);
}

function getLoserParticipant(match, loserId) {
  return getMatchParticipant(match, loserId);
}

function normalizeStake(value) {
  const n = Number(value);
  const stake = Number.isFinite(n) ? Math.trunc(n) : NaN;
  if (!Number.isInteger(stake)) return null;
  if (stake < 10 || stake > 5000) return null;
  return stake;
}

function clearMatchTimers(match) {
  if (!match?.timers) return;
  if (match.timers.main) clearTimeout(match.timers.main);
  if (match.timers.prompt) clearTimeout(match.timers.prompt);
  match.timers.main = null;
  match.timers.prompt = null;
}

function getPublicUsers(excludeUserId = null) {
  const users = [];
  for (const [userId, value] of onlineUsers.entries()) {
    if (excludeUserId && userId === excludeUserId) continue;
    if (findMatchByUserId(userId)) continue;
    users.push(toPublicUser(value));
  }
  return users;
}

function emitOnlineUsers(io) {
  for (const [userId, value] of onlineUsers.entries()) {
    io.to(value.socketId).emit('online:users', getPublicUsers(userId));
  }
}

function findMatchByUserId(userId) {
  for (const match of activeMatches.values()) {
    if (match.players.white === userId || match.players.black === userId) return match;
  }
  return null;
}

function getColorForUser(match, userId) {
  return match.players.white === userId ? 'white' : 'black';
}

function getUserIdForColor(match, color) {
  return color === 'white' ? match.players.white : match.players.black;
}

function sanitizeState(state) {
  return JSON.parse(JSON.stringify(state));
}

function emitMatchState(io, match) {
  io.to(match.roomId).emit('online:match-state', sanitizeState(match.state));
}

async function persistOnlineMatchResult(match, winnerId, loserId, reason) {
  const winnerParticipant = winnerId ? getWinnerParticipant(match, winnerId) : null;
  const loserParticipant = loserId ? getLoserParticipant(match, loserId) : null;
  const nativeParticipants = Object.values(match.participantsByUserId)
    .filter((participant) => participant?.type === 'native' && participant.nativeUserId)
    .map((participant) => participant.nativeUserId);

  await Match.create({
    mode: 'online',
    participants: nativeParticipants,
    participantSnapshots: Object.values(match.participantsByUserId).map((participant) => ({
      participantType: participant.type,
      userId: participant.nativeUserId || null,
      externalPlayerId: participant.externalPlayerId || null,
      externalUserId: participant.externalUserId || null,
      platform: participant.platform || null,
      name: participant.name,
      email: participant.email || '',
      coinsAtStart: participant.coinsAtStart || 0,
    })),
    winnerId: winnerParticipant?.type === 'native' ? winnerParticipant.nativeUserId : null,
    loserId: loserParticipant?.type === 'native' ? loserParticipant.nativeUserId : null,
    winnerExternalPlayerId: winnerParticipant?.type === 'external' ? winnerParticipant.externalPlayerId : null,
    loserExternalPlayerId: loserParticipant?.type === 'external' ? loserParticipant.externalPlayerId : null,
    reason,
    stake: match.stake || 0,
    metadata: {
      winnerColor: winnerId ? getColorForUser(match, winnerId) : null,
      payout: match.settlementMode === 'native-vs-native'
        ? (winnerId ? (match.stake || 0) * 2 : 0)
        : (winnerId && match.settlementMode === 'native-vs-external' ? (match.stake || 0) : 0),
      settlementMode: match.settlementMode,
    },
  });
}

async function refreshOnlineStatsForUsers(userIds) {
  for (const uid of userIds) {
    const info = onlineUsers.get(uid);
    if (!info) continue;
    if (info.user.type === 'external') {
      const [stats, playerDoc] = await Promise.all([
        getExternalOnlineStats(info.user.externalPlayerDocId),
        ExternalPlayer.findById(info.user.externalPlayerDocId).select('_id coins'),
      ]);
      info.user.onlineStats = stats;
      info.user.coins = playerDoc?.coins || 0;
      continue;
    }

    const [stats, userDoc] = await Promise.all([
      getOnlineStats(uid),
      User.findById(uid).select('_id coins'),
    ]);
    info.user.onlineStats = stats;
    info.user.coins = userDoc?.coins || 0;
  }
}

async function createCoinTransaction({ userId, type, amount, balanceAfter, roomId, metadata }) {
  await CoinTransaction.create({
    userId,
    type,
    amount,
    balanceAfter,
    roomId: roomId || null,
    metadata: metadata || {},
  });
}

async function debitCoins(userId, amount, { roomId, type = 'stake-lock', metadata = {} } = {}) {
  const MAX_RETRIES = 3;
  let updated = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const currentDoc = await User.findById(userId).select('_id coins');
    if (!currentDoc) return null;

    const currentCoins = Number(currentDoc.coins || 0);
    if (!Number.isFinite(currentCoins) || currentCoins < amount) return null;

    const nextCoins = currentCoins - amount;
    updated = await User.findOneAndUpdate(
      { _id: userId, coins: currentDoc.coins },
      { $set: { coins: nextCoins } },
      { new: true }
    ).select('_id coins');

    if (updated) break;
  }

  if (!updated) return null;

  await createCoinTransaction({
    userId,
    type,
    amount: -amount,
    balanceAfter: updated.coins,
    roomId,
    metadata,
  });

  return updated.coins;
}

async function creditCoins(userId, amount, { roomId, type = 'refund', metadata = {} } = {}) {
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { coins: amount } },
    { new: true }
  ).select('_id coins');

  if (!updated) return null;

  await createCoinTransaction({
    userId,
    type,
    amount,
    balanceAfter: updated.coins,
    roomId,
    metadata,
  });

  return updated.coins;
}

async function lockStakeForPlayers(match) {
  const participants = [match.players.white, match.players.black]
    .map((userId) => getMatchParticipant(match, userId))
    .filter((participant) => participant?.type === 'native');
  const debited = [];

  for (const participant of participants) {
    const balance = await debitCoins(participant.nativeUserId, match.stake, {
      roomId: match.roomId,
      type: 'stake-lock',
      metadata: { stake: match.stake },
    });
    if (balance === null) {
      for (const rollbackUserId of debited) {
        await creditCoins(rollbackUserId, match.stake, {
          roomId: match.roomId,
          type: 'refund',
          metadata: { reason: 'stake-lock-rollback', stake: match.stake },
        });
      }
      return { ok: false, failedUserId: participant.userId };
    }
    debited.push(participant.nativeUserId);
  }

  return { ok: true };
}

async function settleMatchCoins(match, { winnerId }) {
  if (match.settled) return null;

  const stake = match.stake || 0;
  const whiteParticipant = getMatchParticipant(match, match.players.white);
  const blackParticipant = getMatchParticipant(match, match.players.black);
  const nativeParticipants = [whiteParticipant, blackParticipant].filter((participant) => participant?.type === 'native');
  const payout = match.settlementMode === 'native-vs-native' ? stake * 2 : stake;

  if (!winnerId) {
    await Promise.all(nativeParticipants.map((participant) => creditCoins(participant.nativeUserId, stake, {
      roomId: match.roomId,
      type: 'refund',
      metadata: { reason: 'draw-or-cancel', stake },
    })));
    match.settled = true;
    return {
      payout,
      winnerCoins: null,
      loserCoins: null,
      winnerDelta: 0,
      loserDelta: 0,
    };
  }

  const loserId = winnerId === match.players.white ? match.players.black : match.players.white;
  const winnerParticipant = getMatchParticipant(match, winnerId);
  const loserParticipant = getMatchParticipant(match, loserId);
  let winnerCoins = null;
  let loserCoins = null;
  let winnerDelta = 0;
  let loserDelta = 0;

  if (match.settlementMode === 'native-vs-native') {
    winnerCoins = await creditCoins(winnerParticipant.nativeUserId, payout, {
      roomId: match.roomId,
      type: 'match-win',
      metadata: { stake, payout },
    });
    const loserDoc = await User.findById(loserParticipant.nativeUserId).select('_id coins');
    loserCoins = loserDoc?.coins ?? 0;
    winnerDelta = stake;
    loserDelta = -stake;
  } else if (match.settlementMode === 'native-vs-external') {
    if (winnerParticipant?.type === 'native') {
      winnerCoins = await creditCoins(winnerParticipant.nativeUserId, stake, {
        roomId: match.roomId,
        type: 'match-win',
        metadata: { stake, payout: stake, source: 'external-opponent' },
      });
      winnerDelta = stake;
    }
    if (loserParticipant?.type === 'native') {
      const loserDoc = await User.findById(loserParticipant.nativeUserId).select('_id coins');
      loserCoins = loserDoc?.coins ?? 0;
      loserDelta = -stake;
    }
  }

  match.settled = true;

  return {
    payout,
    winnerCoins,
    loserCoins,
    winnerDelta,
    loserDelta,
  };
}

async function endMatch(io, match, { winnerId = null, loserId = null, reason = 'completed' }) {
  clearMatchTimers(match);
  if (winnerId) {
    const winnerColor = getColorForUser(match, winnerId);
    match.state.gamePhase = 'gameOver';
    match.state.winner = winnerColor;
  }
  emitMatchState(io, match);
  const settlement = await settleMatchCoins(match, { winnerId });
  io.to(match.roomId).emit('online:match-ended', {
    winnerId,
    loserId,
    reason,
    stake: match.stake || 0,
    payout: settlement?.payout || 0,
    winnerDelta: settlement?.winnerDelta ?? 0,
    loserDelta: settlement?.loserDelta ?? 0,
    winnerCoins: settlement?.winnerCoins ?? null,
    loserCoins: settlement?.loserCoins ?? null,
  });

  await persistOnlineMatchResult(match, winnerId, loserId, reason);
  await refreshOnlineStatsForUsers([match.players.white, match.players.black]);
  activeMatches.delete(match.roomId);
  emitOnlineUsers(io);
}

function startTurnTimer(io, match) {
  clearMatchTimers(match);
  if (match.state.gamePhase !== 'playing') return;

  match.timers.main = setTimeout(async () => {
    const currentUserId = getUserIdForColor(match, match.state.currentPlayer);
    const currentSocket = onlineUsers.get(currentUserId)?.socketId;

    if (!match.extended) {
      match.extended = true;
      if (currentSocket) {
        io.to(currentSocket).emit('online:still-playing-prompt', { seconds: 10 });
      }
      match.timers.prompt = setTimeout(async () => {
        const winnerId = currentUserId === match.players.white ? match.players.black : match.players.white;
        await endMatch(io, match, {
          winnerId,
          loserId: currentUserId,
          reason: 'timeout-no-response',
        });
      }, PROMPT_MS);
      return;
    }

    const winnerId = currentUserId === match.players.white ? match.players.black : match.players.white;
    await endMatch(io, match, {
      winnerId,
      loserId: currentUserId,
      reason: 'timeout-final',
    });
  }, TURN_MS);
}

function createOnlineMatch(userAId, userBId, stake) {
  const roomId = `room_${Date.now()}_${userAId}_${userBId}`;
  const white = Math.random() < 0.5 ? userAId : userBId;
  const black = white === userAId ? userBId : userAId;
  const userA = onlineUsers.get(userAId)?.user;
  const userB = onlineUsers.get(userBId)?.user;
  const participantA = {
    userId: userAId,
    type: userA?.type || 'native',
    nativeUserId: userA?.type === 'external' ? null : userA?.nativeUserId || userAId,
    externalPlayerId: userA?.type === 'external' ? userA?.externalPlayerDocId : null,
    externalUserId: userA?.type === 'external' ? userA?.externalUserId : null,
    platform: userA?.type === 'external' ? userA?.platform : null,
    name: userA?.name || 'Player A',
    email: userA?.email || '',
    coinsAtStart: Number(userA?.coins || 0),
  };
  const participantB = {
    userId: userBId,
    type: userB?.type || 'native',
    nativeUserId: userB?.type === 'external' ? null : userB?.nativeUserId || userBId,
    externalPlayerId: userB?.type === 'external' ? userB?.externalPlayerDocId : null,
    externalUserId: userB?.type === 'external' ? userB?.externalUserId : null,
    platform: userB?.type === 'external' ? userB?.platform : null,
    name: userB?.name || 'Player B',
    email: userB?.email || '',
    coinsAtStart: Number(userB?.coins || 0),
  };
  const nativeCount = [participantA, participantB].filter((participant) => participant.type === 'native').length;

  let state = createInitialState();
  state.gamePhase = 'playing';

  let rollWhite = 0;
  let rollBlack = 0;
  while (rollWhite === rollBlack) {
    rollWhite = Math.floor(Math.random() * 6) + 1;
    rollBlack = Math.floor(Math.random() * 6) + 1;
  }
  state.currentPlayer = rollBlack > rollWhite ? 'black' : 'white';
  state.dice = [rollWhite, rollBlack];
  state.diceRolled = true;
  state.diceUsed = [false, false];
  state.legalMoves = calculateLegalMoves(state);
  if (state.legalMoves.length === 0) {
    state.turnComplete = true;
    state = endTurn(state);
  }

  return {
    roomId,
    players: { white, black },
    participantsByUserId: {
      [userAId]: participantA,
      [userBId]: participantB,
    },
    stake,
    settlementMode: nativeCount === 2 ? 'native-vs-native' : nativeCount === 1 ? 'native-vs-external' : 'external-vs-external',
    state,
    timers: { main: null, prompt: null },
    extended: false,
    settled: false,
  };
}

async function socketAuth(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if ((payload.principalType || 'native') === 'external') {
      const player = await ExternalPlayer.findById(payload.externalPlayerId).select('_id name email coins platform externalUserId returnUrl');
      if (!player) return next(new Error('Unauthorized'));

      socket.user = {
        id: `external:${player._id}`,
        type: 'external',
        externalPlayerDocId: String(player._id),
        externalUserId: player.externalUserId,
        platform: player.platform,
        returnUrl: player.returnUrl || '',
        name: player.name,
        email: player.email || '',
        coins: player.coins || 0,
        onlineStats: await getExternalOnlineStats(String(player._id)),
      };
      return next();
    }

    const user = await User.findById(payload.userId).select('_id name username email coins');
    if (!user) return next(new Error('Unauthorized'));

    socket.user = {
      id: String(user._id),
      type: 'native',
      nativeUserId: String(user._id),
      name: user.name,
      username: user.username,
      email: user.email,
      coins: user.coins,
      onlineStats: await getOnlineStats(String(user._id)),
    };
    return next();
  } catch (_error) {
    return next(new Error('Unauthorized'));
  }
}

function registerSocket(io) {
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const me = socket.user;
    onlineUsers.set(me.id, { user: me, socketId: socket.id });
    emitOnlineUsers(io);

    socket.on('online:send-request', async ({ toUserId, stake }) => {
      if (!toUserId || toUserId === me.id) return;
      const normalizedStake = normalizeStake(stake);
      if (!normalizedStake) {
        socket.emit('online:request-error', { message: 'Stake must be between 10 and 5000' });
        return;
      }
      if (findMatchByUserId(me.id) || findMatchByUserId(toUserId)) {
        socket.emit('online:request-error', { message: 'Either you or target user is already in a match' });
        return;
      }
      const target = onlineUsers.get(toUserId);
      if (!target) {
        socket.emit('online:request-error', { message: 'User is not online' });
        return;
      }

      const myCoins = Number(me.coins || 0);
      const targetCoins = Number(target.user.coins || 0);
      if (!Number.isFinite(myCoins) || myCoins < normalizedStake) {
        socket.emit('online:request-error', { message: 'Insufficient coins for selected stake' });
        return;
      }
      if (!Number.isFinite(targetCoins) || targetCoins < normalizedStake) {
        socket.emit('online:request-error', { message: 'Selected player has insufficient coins' });
        return;
      }

      pendingRequests.set(toUserId, { fromUserId: me.id, stake: normalizedStake });
      io.to(target.socketId).emit('online:request-received', { from: me, stake: normalizedStake });
      socket.emit('online:request-sent', { toUserId, stake: normalizedStake });
    });

    socket.on('online:respond-request', async ({ fromUserId, accepted }) => {
      const pending = pendingRequests.get(me.id);
      if (!pending || pending.fromUserId !== fromUserId) return;
      pendingRequests.delete(me.id);

      const fromTarget = onlineUsers.get(fromUserId);
      if (!fromTarget) return;

      io.to(fromTarget.socketId).emit('online:request-response', {
        fromUser: me,
        accepted: Boolean(accepted),
      });

      if (!accepted) return;

      const match = createOnlineMatch(me.id, fromUserId, pending.stake);
      try {
        const lockResult = await lockStakeForPlayers(match);
        if (!lockResult.ok) {
          io.to(fromTarget.socketId).emit('online:request-error', {
            message: 'Match could not start. One player has insufficient coins.',
          });
          socket.emit('online:request-error', {
            message: 'Match could not start. One player has insufficient coins.',
          });
          await refreshOnlineStatsForUsers([me.id, fromUserId]);
          emitOnlineUsers(io);
          return;
        }

        activeMatches.set(match.roomId, match);

        socket.join(match.roomId);
        io.sockets.sockets.get(fromTarget.socketId)?.join(match.roomId);

        io.to(fromTarget.socketId).emit('online:match-start', {
          roomId: match.roomId,
          opponent: me,
          color: getColorForUser(match, fromUserId),
          stake: match.stake,
          state: sanitizeState(match.state),
        });
        socket.emit('online:match-start', {
          roomId: match.roomId,
          opponent: fromTarget.user,
          color: getColorForUser(match, me.id),
          stake: match.stake,
          state: sanitizeState(match.state),
        });

        await refreshOnlineStatsForUsers([me.id, fromUserId]);
        emitOnlineUsers(io);
        startTurnTimer(io, match);
      } catch (_error) {
        socket.emit('online:request-error', {
          message: 'Failed to start match',
        });
      }
    });

    socket.on('online:still-playing-yes', ({ roomId }) => {
      const match = activeMatches.get(roomId);
      if (!match) return;
      const currentUserId = getUserIdForColor(match, match.state.currentPlayer);
      if (currentUserId !== me.id) return;
      if (!match.extended) return;
      if (match.timers.prompt) {
        clearTimeout(match.timers.prompt);
        match.timers.prompt = null;
      }
      startTurnTimer(io, match);
    });

    socket.on('online:match-action', async ({ roomId, type, move }) => {
      const match = activeMatches.get(roomId);
      if (!match) return;

      const color = getColorForUser(match, me.id);
      if (match.state.currentPlayer !== color) {
        socket.emit('online:action-error', { message: 'Not your turn' });
        return;
      }
      if (match.state.gamePhase !== 'playing') {
        socket.emit('online:action-error', { message: 'Game is already over' });
        return;
      }

      if (type === 'roll') {
        if (match.state.diceRolled) return;
        const newDice = rollDice();
        const used = newDice[0] === newDice[1]
          ? [false, false, false, false]
          : [false, false];
        match.state = {
          ...match.state,
          dice: newDice,
          diceRolled: true,
          diceUsed: used,
          noMoveMessage: null,
          turnComplete: false,
        };
        match.state.legalMoves = calculateLegalMoves(match.state);
        if (match.state.legalMoves.length === 0) {
          match.state.turnComplete = true;
          match.state = endTurn(match.state);
          match.extended = false;
        }
        emitMatchState(io, match);
        startTurnTimer(io, match);
        return;
      }

      if (type === 'move') {
        if (!match.state.diceRolled) {
          socket.emit('online:action-error', { message: 'Roll dice first' });
          return;
        }
        let legal = match.state.legalMoves.find(
          (m) => m.from === move?.from && m.to === move?.to && m.diceIndex === move?.diceIndex
        );
        if (!legal) {
          legal = match.state.legalMoves.find((m) => m.from === move?.from && m.to === move?.to);
        }
        if (!legal) {
          socket.emit('online:action-error', { message: 'Illegal move' });
          return;
        }

        match.state = executeMove(match.state, legal);
        if (match.state.gamePhase === 'gameOver') {
          const winnerId = getUserIdForColor(match, match.state.winner);
          const loserId = winnerId === match.players.white ? match.players.black : match.players.white;
          await endMatch(io, match, {
            winnerId,
            loserId,
            reason: 'completed',
          });
          return;
        }
        if (match.state.turnComplete) {
          match.state = endTurn(match.state);
          match.extended = false;
        }
        emitMatchState(io, match);
        startTurnTimer(io, match);
      }
    });

    socket.on('online:join-match', ({ roomId }) => {
      const match = activeMatches.get(roomId);
      if (!match) return;
      if (match.players.white !== me.id && match.players.black !== me.id) return;
      socket.join(roomId);
      socket.emit('online:match-state', sanitizeState(match.state));
    });

    socket.on('online:chat-send', ({ roomId, text }) => {
      const match = activeMatches.get(roomId);
      if (!match) return;
      if (match.players.white !== me.id && match.players.black !== me.id) return;
      const clean = String(text || '').trim();
      if (!clean) return;
      if (clean.length > 300) return;

      io.to(roomId).emit('online:chat-message', {
        roomId,
        text: clean,
        fromUserId: me.id,
        fromName: me.name,
        at: new Date().toISOString(),
      });
    });

    socket.on('online:leave-match', async ({ roomId }) => {
      const match = activeMatches.get(roomId);
      if (!match) return;
      const otherId = match.players.white === me.id ? match.players.black : match.players.white;
      const otherSocket = onlineUsers.get(otherId)?.socketId;
      if (otherSocket) {
        io.to(otherSocket).emit('online:opponent-left');
        io.sockets.sockets.get(otherSocket)?.leave(roomId);
      }
      await endMatch(io, match, {
        winnerId: otherId,
        loserId: me.id,
        reason: 'opponent-left',
      });
      socket.leave(roomId);
    });

    socket.on('disconnect', () => {
      if (onlineUsers.get(me.id)?.socketId === socket.id) {
        onlineUsers.delete(me.id);
      }
      pendingRequests.delete(me.id);
      emitOnlineUsers(io);
    });
  });
}

module.exports = { registerSocket };
