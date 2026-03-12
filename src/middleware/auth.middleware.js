const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      principalType: payload.principalType || 'native',
      ...payload,
    };
    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
}

module.exports = { requireAuth };

async function requireAdmin(req, res, next) {
  if (req.user?.principalType === 'external' || !req.user?.userId) {
    return res.status(403).json({
      success: false,
      message: 'Admin access only',
    });
  }

  try {
    const user = await User.findById(req.user.userId).select('_id name email isAdmin');
    if (!user?.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access only',
      });
    }

    req.adminUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAuth, requireAdmin };
