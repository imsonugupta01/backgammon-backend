const express = require('express');

const { signup, login, adminLogin, externalSession, me } = require('../controllers/auth.controller');
const { validateSignup, validateLogin } = require('../middleware/validateAuthInput');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/signup', validateSignup, signup);
router.post('/login', validateLogin, login);
router.post('/admin/login', validateLogin, adminLogin);
router.post('/external/session', externalSession);
router.get('/me', requireAuth, me);

module.exports = router;
