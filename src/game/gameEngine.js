// Backgammon Game Engine (server-side, CommonJS)

const INITIAL_BOARD = () => {
  const points = {};
  for (let i = 1; i <= 24; i++) {
    points[i] = { pieces: [], location: i };
  }

  for (let i = 0; i < 5; i++) points[6].pieces.push({ id: `w${i}`, color: 'white' });
  for (let i = 5; i < 8; i++) points[8].pieces.push({ id: `w${i}`, color: 'white' });
  for (let i = 8; i < 13; i++) points[13].pieces.push({ id: `w${i}`, color: 'white' });
  for (let i = 13; i < 15; i++) points[24].pieces.push({ id: `w${i}`, color: 'white' });

  for (let i = 0; i < 2; i++) points[1].pieces.push({ id: `b${i}`, color: 'black' });
  for (let i = 2; i < 7; i++) points[12].pieces.push({ id: `b${i}`, color: 'black' });
  for (let i = 7; i < 10; i++) points[17].pieces.push({ id: `b${i}`, color: 'black' });
  for (let i = 10; i < 15; i++) points[19].pieces.push({ id: `b${i}`, color: 'black' });

  return points;
};

function createInitialState() {
  return {
    points: INITIAL_BOARD(),
    bar: { white: [], black: [] },
    borneOff: { white: [], black: [] },
    currentPlayer: null,
    dice: [0, 0],
    diceRolled: false,
    diceUsed: [false, false],
    gamePhase: 'playing',
    winner: null,
    selectedPoint: null,
    legalMoves: [],
    turnComplete: false,
    noMoveMessage: null,
  };
}

function rollDice() {
  return [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
  ];
}

function opponent(color) {
  return color === 'white' ? 'black' : 'white';
}

function totalDiceMoves(dice) {
  return dice[0] === dice[1] ? 4 : 2;
}

function remainingDice(state) {
  const total = totalDiceMoves(state.dice);
  const used = Array.isArray(state.diceUsed) ? state.diceUsed : [];
  const out = [];
  for (let i = 0; i < total; i++) {
    if (used[i]) continue;
    out.push({
      index: i,
      value: state.dice[0] === state.dice[1] ? state.dice[0] : state.dice[i],
    });
  }
  return out;
}

function allPiecesHome(state, color) {
  const { points, bar } = state;
  if (bar[color].length > 0) return false;

  if (color === 'white') {
    for (let i = 7; i <= 24; i++) {
      if (points[i].pieces.some((p) => p.color === 'white')) return false;
    }
  } else {
    for (let i = 1; i <= 18; i++) {
      if (points[i].pieces.some((p) => p.color === 'black')) return false;
    }
  }
  return true;
}

function isHighestPiece(state, color, pointIndex) {
  const { points } = state;
  if (color === 'white') {
    for (let i = 6; i > pointIndex; i--) {
      if (points[i].pieces.some((p) => p.color === 'white')) return false;
    }
    return true;
  }
  for (let i = 19; i < pointIndex; i++) {
    if (points[i].pieces.some((p) => p.color === 'black')) return false;
  }
  return true;
}

function canLand(targetPoint, color, points) {
  const opp = opponent(color);
  const target = points[targetPoint];
  return (
    target.pieces.length === 0 ||
    target.pieces[0]?.color === color ||
    (target.pieces.length === 1 && target.pieces[0]?.color === opp)
  );
}

function applyMoveForSearch(state, move) {
  const next = JSON.parse(JSON.stringify(state));
  const color = next.currentPlayer;
  const opp = opponent(color);

  let piece;
  if (move.from === 'bar') {
    piece = next.bar[color].pop();
  } else {
    piece = next.points[move.from].pieces.pop();
  }

  if (move.isHit && move.to !== 'off') {
    const captured = next.points[move.to].pieces.pop();
    next.bar[opp].push(captured);
  }

  if (move.to === 'off') {
    next.borneOff[color].push(piece);
  } else {
    next.points[move.to].pieces.push(piece);
  }

  next.diceUsed[move.diceIndex] = true;
  return next;
}

function getSingleDieMoves(state, die) {
  const { points, bar, currentPlayer } = state;
  const color = currentPlayer;
  const opp = opponent(color);
  const moves = [];

  if (bar[color].length > 0) {
    const targetPoint = color === 'white' ? 25 - die.value : die.value;
    if (targetPoint >= 1 && targetPoint <= 24 && canLand(targetPoint, color, points)) {
      const target = points[targetPoint];
      moves.push({
        from: 'bar',
        to: targetPoint,
        diceIndex: die.index,
        diceValue: die.value,
        isHit: target.pieces.length === 1 && target.pieces[0]?.color === opp,
      });
    }
    return moves;
  }

  const canBearOff = allPiecesHome(state, color);

  for (let i = 1; i <= 24; i++) {
    const point = points[i];
    if (point.pieces.length === 0) continue;

    const topPiece = point.pieces[point.pieces.length - 1];
    if (topPiece.color !== color) continue;

    const targetPoint = color === 'white' ? i - die.value : i + die.value;

    if (canBearOff) {
      if (color === 'white' && targetPoint <= 0) {
        if (targetPoint === 0 || isHighestPiece(state, color, i)) {
          moves.push({
            from: i,
            to: 'off',
            diceIndex: die.index,
            diceValue: die.value,
            isHit: false,
          });
        }
        continue;
      }
      if (color === 'black' && targetPoint >= 25) {
        if (targetPoint === 25 || isHighestPiece(state, color, i)) {
          moves.push({
            from: i,
            to: 'off',
            diceIndex: die.index,
            diceValue: die.value,
            isHit: false,
          });
        }
        continue;
      }
    }

    if (targetPoint >= 1 && targetPoint <= 24 && canLand(targetPoint, color, points)) {
      const target = points[targetPoint];
      moves.push({
        from: i,
        to: targetPoint,
        diceIndex: die.index,
        diceValue: die.value,
        isHit: target.pieces.length === 1 && target.pieces[0]?.color === opp,
      });
    }
  }

  return moves;
}

function chooseBestMoves(state, dicePool) {
  if (dicePool.length === 0) return { used: 0, firstMoves: [] };

  let bestUsed = 0;
  let firstMoves = [];
  let foundAny = false;

  for (let i = 0; i < dicePool.length; i++) {
    const die = dicePool[i];
    const moves = getSingleDieMoves(state, die);
    if (moves.length === 0) continue;
    foundAny = true;

    const rest = dicePool.filter((_, idx) => idx !== i);
    for (const move of moves) {
      const next = applyMoveForSearch(state, move);
      const result = chooseBestMoves(next, rest);
      const used = 1 + result.used;
      if (used > bestUsed) {
        bestUsed = used;
        firstMoves = [move];
      } else if (used === bestUsed) {
        firstMoves.push(move);
      }
    }
  }

  if (!foundAny) return { used: 0, firstMoves: [] };
  return { used: bestUsed, firstMoves };
}

function dedupeMoves(moves) {
  const seen = new Set();
  const out = [];
  for (const m of moves) {
    const key = `${m.from}-${m.to}-${m.diceIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function calculateLegalMoves(state) {
  if (!state.currentPlayer || !state.diceRolled) return [];

  const dicePool = remainingDice(state);
  if (dicePool.length === 0) return [];

  const best = chooseBestMoves(state, dicePool);
  let legal = dedupeMoves(best.firstMoves);

  if (
    best.used === 1 &&
    dicePool.length === 2 &&
    state.dice[0] !== state.dice[1] &&
    !state.diceUsed[0] &&
    !state.diceUsed[1]
  ) {
    const high = Math.max(dicePool[0].value, dicePool[1].value);
    legal = legal.filter((m) => m.diceValue === high);
  }

  return legal;
}

function executeMove(state, move) {
  const newState = JSON.parse(JSON.stringify(state));
  const { from, to, diceIndex, isHit } = move;
  const color = newState.currentPlayer;
  const opp = opponent(color);

  let piece;
  if (from === 'bar') {
    piece = newState.bar[color].pop();
  } else {
    piece = newState.points[from].pieces.pop();
  }

  if (isHit && to !== 'off') {
    const capturedPiece = newState.points[to].pieces.pop();
    newState.bar[opp].push(capturedPiece);
  }

  if (to === 'off') {
    newState.borneOff[color].push(piece);
  } else {
    newState.points[to].pieces.push(piece);
  }

  newState.diceUsed[diceIndex] = true;
  newState.selectedPoint = null;
  newState.legalMoves = calculateLegalMoves(newState);

  if (newState.borneOff[color].length === 15) {
    newState.gamePhase = 'gameOver';
    newState.winner = color;
  }

  if (newState.diceUsed.every(Boolean) || newState.legalMoves.length === 0) {
    if (newState.gamePhase !== 'gameOver') {
      if (newState.legalMoves.length === 0 && newState.diceUsed.some((used) => !used)) {
        newState.noMoveMessage = color;
      }
      newState.turnComplete = true;
    }
  }

  return newState;
}

function endTurn(state) {
  const newState = { ...state };
  newState.currentPlayer = opponent(state.currentPlayer);
  newState.dice = [0, 0];
  newState.diceRolled = false;
  newState.diceUsed = [false, false];
  newState.selectedPoint = null;
  newState.legalMoves = [];
  newState.turnComplete = false;
  newState.noMoveMessage = null;
  return newState;
}

module.exports = {
  createInitialState,
  calculateLegalMoves,
  executeMove,
  endTurn,
  rollDice,
};
