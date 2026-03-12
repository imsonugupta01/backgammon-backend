const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { reportMatch, getMyMatches, getLeaderboard } = require('../controllers/match.controller');

const router = express.Router();

router.post('/report', requireAuth, reportMatch);
router.get('/mine', requireAuth, getMyMatches);
router.get('/leaderboard', requireAuth, getLeaderboard);

module.exports = router;
