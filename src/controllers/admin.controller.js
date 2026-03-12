const User = require('../models/user.model');
const CoinTransaction = require('../models/coinTransaction.model');

function serializeAdminUser(user) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    coins: user.coins,
    isAdmin: Boolean(user.isAdmin),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) return null;
  return normalized;
}

async function listUsers(req, res, next) {
  try {
    const search = String(req.query?.q || '').trim();
    const filter = {};

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { username: regex },
        { name: regex },
      ];
    }

    const users = await User.find(filter)
      .select('_id username name coins email isAdmin createdAt updatedAt')
      .sort({ username: 1, name: 1 })
      .limit(500)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        users: users.map(serializeAdminUser),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getUserDetails(req, res, next) {
  try {
    const user = await User.findById(req.params.userId)
      .select('_id username name email coins isAdmin createdAt updatedAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const recentTransactions = await CoinTransaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        user: serializeAdminUser(user),
        recentTransactions,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function addCoinsToUser(req, res, next) {
  try {
    const coins = parsePositiveInteger(req.body?.coins);
    const note = String(req.body?.note || '').trim();

    if (!coins) {
      return res.status(400).json({
        success: false,
        message: 'coins must be a positive integer',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $inc: { coins } },
      { new: true }
    ).select('_id username name email coins isAdmin createdAt updatedAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await CoinTransaction.create({
      userId: user._id,
      type: 'admin-credit',
      amount: coins,
      balanceAfter: user.coins,
      metadata: {
        adminUserId: req.adminUser?._id || null,
        adminName: req.adminUser?.name || '',
        adminEmail: req.adminUser?.email || '',
        note,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Coins added successfully',
      data: {
        user: serializeAdminUser(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
  getUserDetails,
  addCoinsToUser,
};
