const Match = require('../models/match.model');
const CoinTransaction = require('../models/coinTransaction.model');
const { getOnlineStats } = require('../utils/onlineStats');
const ExternalPlayer = require('../models/externalPlayer.model');

function getExternalResult(match, externalPlayerId) {
  if (match.winnerExternalPlayerId && String(match.winnerExternalPlayerId) === String(externalPlayerId)) {
    return 'Win';
  }
  if (match.loserExternalPlayerId && String(match.loserExternalPlayerId) === String(externalPlayerId)) {
    return 'Loss';
  }
  return 'Draw';
}

async function reportMatch(req, res, next) {
  try {
    if (req.user?.principalType === 'external') {
      return res.status(403).json({
        success: false,
        message: 'External players cannot report offline matches',
      });
    }

    const userId = req.user.userId;
    const { mode, result, metadata } = req.body || {};

    if (!['vsComputer', 'yourself'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'mode must be vsComputer or yourself',
      });
    }
    if (!['win', 'loss', 'draw'].includes(result)) {
      return res.status(400).json({
        success: false,
        message: 'result must be win, loss or draw',
      });
    }

    const match = await Match.create({
      mode,
      participants: [userId],
      winnerId: result === 'win' ? userId : null,
      loserId: result === 'loss' ? userId : null,
      reason: 'completed',
      metadata: {
        result,
        ...(metadata || {}),
      },
      reportedBy: userId,
    });

    return res.status(201).json({
      success: true,
      data: { id: match._id },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMyMatches(req, res, next) {
  try {
    let matches = [];
    let onlineStats = { wins: 0, losses: 0, total: 0 };

    if (req.user?.principalType === 'external') {
      const externalPlayerId = req.user.externalPlayerId;
      const player = await ExternalPlayer.findById(externalPlayerId).select('_id');
      if (!player) {
        return res.status(404).json({
          success: false,
          message: 'External player not found',
        });
      }

      matches = await Match.find({
        'participantSnapshots.externalPlayerId': player._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      const onlineMatches = matches.filter((m) => m.mode === 'online');
      onlineStats = onlineMatches.reduce((acc, match) => {
        const result = getExternalResult(match, player._id);
        if (result === 'Win') acc.wins += 1;
        if (result === 'Loss') acc.losses += 1;
        acc.total += 1;
        return acc;
      }, { wins: 0, losses: 0, total: 0 });
    } else {
      const userId = req.user.userId;
      matches = await Match.find({ participants: userId })
        .sort({ createdAt: -1 })
        .lean();
      onlineStats = await getOnlineStats(userId);
    }

    const grouped = {
      yourself: [],
      vsComputer: [],
      online: [],
    };

    for (const m of matches) {
      if (!grouped[m.mode]) continue;
      grouped[m.mode].push(m);
    }

    return res.status(200).json({
      success: true,
      data: {
        matches: grouped,
        onlineStats,
      },
    });
  } catch (error) {
    return next(error);
  }
}

function getPeriodStart(period) {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // start Monday
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getLeaderboard(req, res, next) {
  try {
    const period = ['today', 'week', 'month'].includes(req.query?.period)
      ? req.query.period
      : 'today';

    const start = getPeriodStart(period);

    const rows = await CoinTransaction.aggregate([
      {
        $match: {
          type: 'match-win',
          amount: { $gt: 0 },
          createdAt: { $gte: start },
        },
      },
      {
        $group: {
          _id: '$userId',
          coinsWon: { $sum: '$amount' },
          wins: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: '$user._id',
          username: '$user.username',
          name: '$user.name',
          coinsWon: 1,
          wins: 1,
        },
      },
      { $sort: { coinsWon: -1, wins: -1, username: 1 } },
      { $limit: 100 },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        period,
        leaderboard: rows,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  reportMatch,
  getMyMatches,
  getLeaderboard,
};
