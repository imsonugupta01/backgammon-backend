const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const {
  getMyWallet,
  getPaypalConfig,
  createPaypalOrder,
  capturePaypalOrder,
  requestWithdrawal,
} = require('../controllers/wallet.controller');

const router = express.Router();

router.get('/me', requireAuth, getMyWallet);
router.get('/paypal/config', requireAuth, getPaypalConfig);
router.post('/paypal/create-order', requireAuth, createPaypalOrder);
router.post('/paypal/capture-order', requireAuth, capturePaypalOrder);
router.post('/withdraw/request', requireAuth, requestWithdrawal);

module.exports = router;
