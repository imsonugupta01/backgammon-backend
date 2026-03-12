const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const {
  listUsers,
  getUserDetails,
  addCoinsToUser,
} = require('../controllers/admin.controller');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/users', listUsers);
router.get('/users/:userId', getUserDetails);
router.post('/users/:userId/coins', addCoinsToUser);

module.exports = router;
