const paypal = require('@paypal/checkout-server-sdk');

const User = require('../models/user.model');
const CoinTransaction = require('../models/coinTransaction.model');
const { getPaypalClient, createPaypalPayout } = require('../config/paypal');

const COINS_PER_USD = Number(process.env.COINS_PER_USD || 100);
const PAYPAL_CURRENCY = (process.env.PAYPAL_CURRENCY || 'USD').toUpperCase();
const MIN_TOPUP_COINS = Number(process.env.MIN_TOPUP_COINS || 100);
const MAX_TOPUP_COINS = Number(process.env.MAX_TOPUP_COINS || 100000);
const MIN_WITHDRAW_COINS = Number(process.env.MIN_WITHDRAW_COINS || 1000);
const MAX_WITHDRAW_COINS = Number(process.env.MAX_WITHDRAW_COINS || 1000000);
const PAYOUTS_ENABLED = String(process.env.PAYPAL_AUTO_PAYOUTS || 'false').toLowerCase() === 'true';

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

function parseInteger(input) {
  const raw = Number(input);
  const value = Number.isFinite(raw) ? Math.trunc(raw) : NaN;
  return Number.isInteger(value) ? value : null;
}

function parsePositiveUsd(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function coinsToUsdAmount(coins) {
  const usd = coins / COINS_PER_USD;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return usd.toFixed(2);
}

function parseTopupCustomId(customId) {
  const value = String(customId || '');
  const [prefix, userId, coinsRaw] = value.split(':');
  if (prefix !== 'topup') return null;
  const coins = parseInteger(coinsRaw);
  if (!coins || coins <= 0) return null;
  return { userId, coins };
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
    const clientId = process.env.PAYPAL_CLIENT_ID || process.env.ClientID;
    if (!clientId) {
      return res.status(500).json({
        success: false,
        message: 'PayPal client id is not configured',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        clientId,
        currency: PAYPAL_CURRENCY,
        minTopupCoins: MIN_TOPUP_COINS,
        maxTopupCoins: MAX_TOPUP_COINS,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function createPaypalOrder(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    const userId = req.user.userId;
    const coins = parseInteger(req.body?.coins);
    if (!coins || coins < MIN_TOPUP_COINS || coins > MAX_TOPUP_COINS) {
      return res.status(400).json({
        success: false,
        message: `coins must be an integer between ${MIN_TOPUP_COINS} and ${MAX_TOPUP_COINS}`,
      });
    }

    const usdAmount = coinsToUsdAmount(coins);
    if (!usdAmount) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coins to USD conversion',
      });
    }

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: PAYPAL_CURRENCY,
            value: usdAmount,
          },
          custom_id: `topup:${userId}:${coins}`,
          description: `${coins} in-game coins`,
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    });

    const paypalClient = getPaypalClient();
    const order = await paypalClient.execute(request);

    return res.status(201).json({
      success: true,
      data: {
        orderId: order.result.id,
        status: order.result.status,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function capturePaypalOrder(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    const userId = req.user.userId;
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'orderId is required',
      });
    }

    const existingByOrderId = await CoinTransaction.findOne({
      userId,
      type: 'paypal-topup',
      'metadata.paypal.orderId': orderId,
    }).select('_id balanceAfter');
    if (existingByOrderId) {
      return res.status(200).json({
        success: true,
        data: { coins: existingByOrderId.balanceAfter },
      });
    }

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const paypalClient = getPaypalClient();
    const captureResult = await paypalClient.execute(request);
    const result = captureResult.result || {};

    if (result.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: `Order is not completed. Current status: ${result.status || 'UNKNOWN'}`,
      });
    }

    const purchaseUnit = Array.isArray(result.purchase_units) ? result.purchase_units[0] : null;
    const parsedCustomId = parseTopupCustomId(purchaseUnit?.custom_id);
    if (!parsedCustomId || String(parsedCustomId.userId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: 'This PayPal order does not belong to the current user',
      });
    }

    const captures = purchaseUnit?.payments?.captures || [];
    const firstCapture = captures[0];
    const captureId = firstCapture?.id;
    const paidAmountValue = parsePositiveUsd(firstCapture?.amount?.value);

    if (!captureId || !paidAmountValue) {
      return res.status(400).json({
        success: false,
        message: 'Capture details missing from PayPal response',
      });
    }

    const expectedAmount = parsePositiveUsd(coinsToUsdAmount(parsedCustomId.coins));
    if (!expectedAmount || Math.abs(expectedAmount - paidAmountValue) > 0.01) {
      return res.status(400).json({
        success: false,
        message: 'Captured amount does not match expected coin package amount',
      });
    }

    const existingByCaptureId = await CoinTransaction.findOne({
      userId,
      type: 'paypal-topup',
      'metadata.paypal.captureId': captureId,
    }).select('_id balanceAfter');
    if (existingByCaptureId) {
      return res.status(200).json({
        success: true,
        data: { coins: existingByCaptureId.balanceAfter },
      });
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { coins: parsedCustomId.coins } },
      { new: true }
    ).select('_id coins');

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await CoinTransaction.create({
      userId,
      type: 'paypal-topup',
      amount: parsedCustomId.coins,
      balanceAfter: updated.coins,
      metadata: {
        paypal: {
          orderId,
          captureId,
          payerId: result.payer?.payer_id || null,
          payerEmail: result.payer?.email_address || null,
          amount: paidAmountValue.toFixed(2),
          currency: firstCapture?.amount?.currency_code || PAYPAL_CURRENCY,
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        coins: updated.coins,
        addedCoins: parsedCustomId.coins,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function requestWithdrawal(req, res, next) {
  try {
    if (!ensureNativeUser(req, res)) return;
    const userId = req.user.userId;
    const coins = parseInteger(req.body?.coins);
    const paypalEmail = String(req.body?.paypalEmail || '').trim().toLowerCase();

    if (!coins || coins < MIN_WITHDRAW_COINS || coins > MAX_WITHDRAW_COINS) {
      return res.status(400).json({
        success: false,
        message: `coins must be an integer between ${MIN_WITHDRAW_COINS} and ${MAX_WITHDRAW_COINS}`,
      });
    }

    if (!paypalEmail || !paypalEmail.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'A valid paypalEmail is required',
      });
    }

    const usdAmount = coinsToUsdAmount(coins);
    if (!usdAmount) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coins to USD conversion',
      });
    }

    const user = await User.findById(userId).select('_id coins');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.coins < coins) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient coins',
      });
    }

    const updated = await User.findOneAndUpdate(
      { _id: userId, coins: user.coins },
      { $inc: { coins: -coins } },
      { new: true }
    ).select('_id coins');

    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Coin balance changed. Please retry',
      });
    }

    const requestRef = `wd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await CoinTransaction.create({
      userId,
      type: 'withdraw-request',
      amount: -coins,
      balanceAfter: updated.coins,
      metadata: {
        requestRef,
        paypalEmail,
        usdAmount,
        currency: PAYPAL_CURRENCY,
        status: PAYOUTS_ENABLED ? 'processing' : 'pending-manual-review',
      },
    });

    if (!PAYOUTS_ENABLED) {
      return res.status(201).json({
        success: true,
        data: {
          coins: updated.coins,
          status: 'pending-manual-review',
          message: 'Withdrawal request created. Admin will process it soon.',
        },
      });
    }

    try {
      const payout = await createPaypalPayout({
        sender_batch_header: {
          sender_batch_id: requestRef,
          email_subject: 'You received a payout',
          email_message: 'Your backgammon withdrawal is on the way.',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: {
              value: usdAmount,
              currency: PAYPAL_CURRENCY,
            },
            receiver: paypalEmail,
            note: `Withdrawal for ${coins} coins`,
            sender_item_id: requestRef,
          },
        ],
      });

      await CoinTransaction.create({
        userId,
        type: 'withdraw-complete',
        amount: 0,
        balanceAfter: updated.coins,
        metadata: {
          requestRef,
          paypalEmail,
          usdAmount,
          currency: PAYPAL_CURRENCY,
          payoutBatchId: payout?.batch_header?.payout_batch_id || null,
          payoutBatchStatus: payout?.batch_header?.batch_status || null,
        },
      });

      return res.status(201).json({
        success: true,
        data: {
          coins: updated.coins,
          status: payout?.batch_header?.batch_status || 'PENDING',
        },
      });
    } catch (payoutError) {
      const refunded = await User.findByIdAndUpdate(
        userId,
        { $inc: { coins: coins } },
        { new: true }
      ).select('_id coins');

      await CoinTransaction.create({
        userId,
        type: 'withdraw-failed',
        amount: coins,
        balanceAfter: refunded?.coins || updated.coins + coins,
        metadata: {
          requestRef,
          paypalEmail,
          usdAmount,
          currency: PAYPAL_CURRENCY,
          reason: payoutError.message,
          refunded: true,
        },
      });

      return res.status(400).json({
        success: false,
        message: 'Withdrawal failed and coins were refunded',
      });
    }
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
