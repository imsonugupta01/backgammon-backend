function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateSignup(req, res, next) {
  const { name, username, email, password } = req.body || {};

  if (!name || !username || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'name, username, email and password are required',
    });
  }

  if (String(username).trim().length < 3) {
    return res.status(400).json({
      success: false,
      message: 'Username must be at least 3 characters',
    });
  }

  if (!isEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email',
    });
  }

  if (String(password).length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters',
    });
  }

  next();
}

function validateLogin(req, res, next) {
  const { identifier, username, email, password } = req.body || {};
  const loginIdentifier = String(identifier || username || email || '').trim();

  if (!loginIdentifier || !password) {
    return res.status(400).json({
      success: false,
      message: 'username/email and password are required',
    });
  }

  if (loginIdentifier.includes('@') && !isEmail(loginIdentifier)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email',
    });
  }

  next();
}

module.exports = {
  validateSignup,
  validateLogin,
};
