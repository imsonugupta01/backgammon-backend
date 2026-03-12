const Match = require('../models/match.model');

async function getOnlineStats(userId) {
  const [wins, losses, total] = await Promise.all([
    Match.countDocuments({ mode: 'online', winnerId: userId }),
    Match.countDocuments({ mode: 'online', loserId: userId }),
    Match.countDocuments({ mode: 'online', participants: userId }),
  ]);

  return { wins, losses, total };
}

module.exports = { getOnlineStats };
