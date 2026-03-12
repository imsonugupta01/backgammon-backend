const User = require('../models/user.model');
const CoinTransaction = require('../models/coinTransaction.model');

function ensureNativeUser(req, res) {
  if (req.user?.principalType === 'external') {
    res.status(403).json({
      success: false,
      message: 'Wallet actions are only available for native players',
    });
    return false;
  }
  return true;
}

async function getMyWallet(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    const userId = req.user.userId;
    const user = await User.findById(userId).select('_id coins');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const recentTransactions = await CoinTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        coins: user.coins,
        recentTransactions,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPaypalConfig(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    return res.status(403).json({
      success: false,
      message: 'Self-serve coin purchase is disabled. Contact an admin.',
    });
  } catch (error) {
    return next(error);
  }
}

async function createPaypalOrder(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    return res.status(403).json({
      success: false,
      message: 'Self-serve coin purchase is disabled. Contact an admin.',
    });
  } catch (error) {
    return next(error);
  }
}

async function capturePaypalOrder(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    return res.status(403).json({
      success: false,
      message: 'Self-serve coin purchase is disabled. Contact an admin.',
    });
  } catch (error) {
    return next(error);
  }
}

async function requestWithdrawal(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    return res.status(403).json({
      success: false,
      message: 'Withdrawals are currently disabled. Contact an admin.',
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyWallet,
  getPaypalConfig,
  createPaypalOrder,
  capturePaypalOrder,
  requestWithdrawal,
};
