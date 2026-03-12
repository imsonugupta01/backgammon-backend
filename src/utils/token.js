const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is missing in environment');
  }

  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

function signExternalHandoff(payload) {
  const secret = process.env.EXTERNAL_PLATFORM_SHARED_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('EXTERNAL_PLATFORM_SHARED_SECRET or JWT_SECRET is missing in environment');
  }

  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function verifyExternalHandoff(payload, signature) {
  if (!signature) return false;
  const expected = signExternalHandoff(payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch (_error) {
    return false;
  }
}

module.exports = { signToken, signExternalHandoff, verifyExternalHandoff };
