const bcrypt = require('bcryptjs');

const User = require('../models/user.model');
const ExternalPlayer = require('../models/externalPlayer.model');
const CoinTransaction = require('../models/coinTransaction.model');
const { signToken, verifyExternalHandoff } = require('../utils/token');

function serializeNativeUser(user) {
  return {
    id: user._id,
    type: 'native',
    name: user.name,
    username: user.username,
    email: user.email,
    coins: user.coins,
    isAdmin: Boolean(user.isAdmin),
    isExternal: false,
  };
}

function serializeExternalUser(player) {
  return {
    id: String(player._id),
    type: 'external',
    name: player.name,
    username: null,
    email: player.email || '',
    coins: player.coins || 0,
    isExternal: true,
    platform: player.platform,
    externalUserId: player.externalUserId,
    returnUrl: player.returnUrl || '',
  };
}

async function signup(req, res, next) {
  try {
    const { name, username, email, password } = req.body;
    const normalizedUsername = String(username).toLowerCase().trim();
    const normalizedEmail = email.toLowerCase().trim();

    const existingByEmail = await User.findOne({ email: normalizedEmail });
    if (existingByEmail) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
      });
    }

    const existingByUsername = await User.findOne({ username: normalizedUsername });
    if (existingByUsername) {
      return res.status(409).json({
        success: false,
        message: 'Username already taken',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: name.trim(),
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashedPassword,
      isAdmin: false,
    });

    await CoinTransaction.create({
      userId: user._id,
      type: 'signup-bonus',
      amount: user.coins,
      balanceAfter: user.coins,
      metadata: { note: 'Signup welcome coins' },
    });

    const token = signToken({ userId: user._id, email: user.email });

    return res.status(201).json({
      success: true,
      message: 'Signup successful',
      data: {
        token,
        user: serializeNativeUser(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  return loginWithAdminRequirement(req, res, next, false);
}

async function adminLogin(req, res, next) {
  return loginWithAdminRequirement(req, res, next, true);
}

async function loginWithAdminRequirement(req, res, next, adminOnly) {
  try {
    const { identifier, username, email, password } = req.body;
    const rawIdentifier = String(identifier || username || email || '').trim();
    const normalizedIdentifier = rawIdentifier.toLowerCase();
    const isEmailIdentifier = normalizedIdentifier.includes('@');

    const user = await User.findOne(
      isEmailIdentifier
        ? { email: normalizedIdentifier }
        : { username: normalizedIdentifier }
    );
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username/email or password',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username/email or password',
      });
    }

    if (adminOnly && !user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access only',
      });
    }

    const token = signToken({ userId: user._id, email: user.email });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: serializeNativeUser(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function externalSession(req, res, next) {
  try {
    const body = req.body || {};
    const payload = {
      platform: String(body.platform || '').trim(),
      externalUserId: String(body.externalUserId || '').trim(),
      name: String(body.name || '').trim(),
      email: String(body.email || '').trim().toLowerCase(),
      coins: Number.isFinite(Number(body.coins)) ? Math.max(0, Math.trunc(Number(body.coins))) : 0,
      returnUrl: String(body.returnUrl || '').trim(),
      metadata: body.metadata || {},
    };
    const signature = String(body.signature || '').trim();

    if (!payload.platform || !payload.externalUserId || !payload.name) {
      return res.status(400).json({
        success: false,
        message: 'platform, externalUserId and name are required',
      });
    }

    const signaturePayload = {
      platform: payload.platform,
      externalUserId: payload.externalUserId,
      name: payload.name,
      email: payload.email,
      coins: payload.coins,
      returnUrl: payload.returnUrl,
    };

    if (!verifyExternalHandoff(signaturePayload, signature)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid external handoff signature',
      });
    }

    const player = await ExternalPlayer.findOneAndUpdate(
      { platform: payload.platform, externalUserId: payload.externalUserId },
      {
        $set: {
          name: payload.name,
          email: payload.email,
          coins: payload.coins,
          returnUrl: payload.returnUrl,
          metadata: payload.metadata,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const token = signToken({
      principalType: 'external',
      externalPlayerId: String(player._id),
      platform: player.platform,
      externalUserId: player.externalUserId,
    });

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: serializeExternalUser(player),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    if (req.user?.principalType === 'external') {
      const player = await ExternalPlayer.findById(req.user.externalPlayerId)
        .select('_id platform externalUserId name email coins returnUrl');
      if (!player) {
        return res.status(404).json({
          success: false,
          message: 'External player not found',
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          user: serializeExternalUser(player),
        },
      });
    }

    const userId = req.user?.userId;
    const user = await User.findById(userId).select('_id name username email coins isAdmin');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user: serializeNativeUser(user),
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  signup,
  login,
  adminLogin,
  externalSession,
  me,
};
