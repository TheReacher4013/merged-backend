const express = require ('express');
const router = express.Router();
const passport = require('../config/passport');
const {body} = require('express-validator');

const {
    register, login, logout, verify2FA, setup2FA, enable2FA, refreshToken, verifyEmail, forgotPassword, resetPassword,getMe, oauthCallback, } = require('../controllers/auth.controller');

    const {protect} = require('../middleware/auth.middleware');
    const {authLimiter} = require('../middleware/rateLimiter');

//validation rules

const registerValidation = [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({max:100}),
    body('email').isEmail().withMessage('Invalid email').normalizeEmail(),
    body('password').isLength({min:8}).withMessage('Password is must 8 characters'),
];

const loginValidtion = [
    body('email').isEmail().withMessage('Invalid email').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
];

//public routes

router.post('/register', authLimiter, registerValidation, register);

router.post('/login', authLimiter, loginValidtion, login);

router.post('/refresh', refreshToken);

router.get('/verify-email/:token', verifyEmail);

router.post('/forgot-password', authLimiter, body('email').isEmail(), forgotPassword);

router.post('/reset-password/:token', body('password').isLength({ min: 8 }), resetPassword);

router.post('/2fa/verify', verify2FA);

//google OAuth
router.get('/google', passport.authenticate('google',{scope:['profile', 'email']}));

router.get('/google/callback',
    passport.authenticate('google',{session:false, failureRedirect: `${process.env.CLIENT_URL}/login?error=oauth`}),
    oauthCallback
);

//facebook Oauth
router.get('/facebook', passport.authenticate('facebook', {scope:['email']}));

router.get('/facebook/callback',
    passport.authenticate('facebook', {session:false, failureRedirect:`${process.env.CLIENT_URL}/login?error=oauth`}),
    oauthCallback
);

//protect routes

router.use(protect); // all routes below require auth

router.get('/me', getMe);
router.post('/logout', logout);
router.post('/2fa/setup', setup2FA);
router.post('/2fa/enable', body('code').isLength({ min: 6, max: 6 }), enable2FA);

module.exports = router;
