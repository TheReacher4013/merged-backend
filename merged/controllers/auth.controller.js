const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const User = require('../models/User.model');
const { asyncHandler } = require('../middleware/errorHandler');
const {
    sendTokenResponse,
    generateRefreshToken,
    generateAccessToken,
    generateSecureToken,
    hashToken,
} = require('../utils/token.utils');
const {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendWelcomeEmail,
} = require('../utils/email.utils');
const jwt = require('jsonwebtoken');

// ─── @desc  Register new user
// ─── @route POST /api/auth/register
// ─── @access Public
const register = asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    // Generate email verification token
    const rawToken = generateSecureToken();
    const hashedToken = hashToken(rawToken);

    const user = await User.create({
        name,
        email,
        password,
        emailVerificationToken: hashedToken,
        emailVerificationExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    await sendVerificationEmail(email, name, rawToken);

    res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email to verify your account.',
        data: { userId: user._id, email: user.email },
    });
});

// ─── @desc  Login with email & password
// ─── @route POST /api/auth/login
// ─── @access Public
const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil +refreshTokens');

    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Brute-force check
    if (user.isLocked()) {
        const waitMin = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return res.status(423).json({
            success: false,
            message: `Account temporarily locked. Try again in ${waitMin} minute(s).`,
        });
    }

    if (!user.password) {
        return res.status(400).json({
            success: false,
            message: `This account uses ${user.authProvider} login. Please use that method.`,
        });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        await user.incrementLoginAttempts();
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isEmailVerified) {
        return res.status(403).json({ success: false, message: 'Please verify your email before logging in.' });
    }

    // 2FA check
    if (user.isTwoFactorEnabled) {
        // Issue a short-lived pre-auth token instead of full JWT
        const preAuthToken = jwt.sign({ id: user._id, stage: '2fa' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
        return res.status(200).json({
            success: true,
            requires2FA: true,
            preAuthToken,
            message: 'Please enter your 2FA code.',
        });
    }

    // Successful login
    await user.resetLoginAttempts();

    // Save refresh token
    const refreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push({
        token: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    // Keep only last 5 refresh tokens
    if (user.refreshTokens.length > 5) user.refreshTokens.shift();
    await user.save();

    sendTokenResponse(user, 200, res, 'Login successful.');
});

// ─── @desc  Verify 2FA code and issue tokens
// ─── @route POST /api/auth/2fa/verify
// ─── @access Public (with preAuthToken)
const verify2FA = asyncHandler(async (req, res) => {
    const { preAuthToken, code } = req.body;

    let decoded;
    try {
        decoded = jwt.verify(preAuthToken, process.env.JWT_ACCESS_SECRET);
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid or expired pre-auth token.' });
    }

    if (decoded.stage !== '2fa') {
        return res.status(400).json({ success: false, message: 'Invalid token stage.' });
    }

    const user = await User.findById(decoded.id).select('+twoFactorSecret +refreshTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const isValid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 1,
    });

    if (!isValid) {
        return res.status(401).json({ success: false, message: 'Invalid 2FA code.' });
    }

    const refreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push({
        token: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await user.save();

    sendTokenResponse(user, 200, res, '2FA verified. Login successful.');
});

// ─── @desc  Setup 2FA — generate QR code
// ─── @route POST /api/auth/2fa/setup
// ─── @access Private
const setup2FA = asyncHandler(async (req, res) => {
    const secret = speakeasy.generateSecret({ name: `EmailPlatform (${req.user.email})` });

    await User.findByIdAndUpdate(req.user._id, { twoFactorSecret: secret.base32 });

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.json({
        success: true,
        message: 'Scan this QR code with your authenticator app, then confirm with a code.',
        data: { qrCode: qrCodeUrl, secret: secret.base32 },
    });
});

// ─── @desc  Enable 2FA after QR scan confirmation
// ─── @route POST /api/auth/2fa/enable
// ─── @access Private
const enable2FA = asyncHandler(async (req, res) => {
    const { code } = req.body;
    const user = await User.findById(req.user._id).select('+twoFactorSecret');

    const isValid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 1,
    });

    if (!isValid) return res.status(400).json({ success: false, message: 'Invalid code. 2FA not enabled.' });

    user.isTwoFactorEnabled = true;
    await user.save();

    res.json({ success: true, message: '2FA enabled successfully.' });
});

// ─── @desc  Refresh access token using refresh token
// ─── @route POST /api/auth/refresh
// ─── @access Public
const refreshToken = asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken || req.body.refreshToken;
    if (!token) return res.status(401).json({ success: false, message: 'No refresh token.' });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const user = await User.findById(decoded.id).select('+refreshTokens');
    if (!user) return res.status(401).json({ success: false, message: 'User not found.' });

    // Validate stored token (rotation check)
    const hashedIncoming = hashToken(token);
    const storedToken = user.refreshTokens.find((t) => t.token === hashedIncoming);
    if (!storedToken) {
        // Possible token reuse attack — clear all refresh tokens
        user.refreshTokens = [];
        await user.save();
        return res.status(401).json({ success: false, message: 'Refresh token reuse detected. Please login again.' });
    }

    // Rotate: remove old, add new
    user.refreshTokens = user.refreshTokens.filter((t) => t.token !== hashedIncoming);
    const newRefreshToken = generateRefreshToken(user._id);
    user.refreshTokens.push({
        token: hashToken(newRefreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await user.save();

    const newAccessToken = generateAccessToken(user._id);

    res
        .cookie('accessToken', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 15 * 60 * 1000 })
        .cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 })
        .json({ success: true, message: 'Token refreshed.', data: { accessToken: newAccessToken } });
});

// ─── @desc  Logout (clear cookies + invalidate refresh token)
// ─── @route POST /api/auth/logout
// ─── @access Private
const logout = asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (token) {
        const hashed = hashToken(token);
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { refreshTokens: { token: hashed } },
        });
    }

    res
        .clearCookie('accessToken')
        .clearCookie('refreshToken')
        .json({ success: true, message: 'Logged out successfully.' });
});

// ─── @desc  Verify email address via token
// ─── @route GET /api/auth/verify-email/:token
// ─── @access Public
const verifyEmail = asyncHandler(async (req, res) => {
    const hashedToken = hashToken(req.params.token);

    const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpiry: { $gt: Date.now() },
    }).select('+emailVerificationToken +emailVerificationExpiry');

    if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid or expired verification link.' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpiry = undefined;
    await user.save();

    await sendWelcomeEmail(user.email, user.name);

    res.json({ success: true, message: 'Email verified successfully. You can now login.' });
});

// ─── @desc  Forgot password — send reset email
// ─── @route POST /api/auth/forgot-password
// ─── @access Public
const forgotPassword = asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });

    // Always return success to prevent email enumeration
    if (!user) {
        return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const rawToken = generateSecureToken();
    user.passwordResetToken = hashToken(rawToken);
    user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    await sendPasswordResetEmail(user.email, user.name, rawToken);

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
});

// ─── @desc  Reset password using token
// ─── @route POST /api/auth/reset-password/:token
// ─── @access Public
const resetPassword = asyncHandler(async (req, res) => {
    const hashedToken = hashToken(req.params.token);

    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpiry: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpiry +refreshTokens');

    if (!user) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    user.refreshTokens = []; // Invalidate all sessions
    await user.save();

    res.json({ success: true, message: 'Password reset successful. Please login with your new password.' });
});

// ─── @desc  Get current user profile
// ─── @route GET /api/auth/me
// ─── @access Private
const getMe = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    res.json({ success: true, data: user });
});

// ─── @desc  OAuth callback handler (Google / Facebook)
// ─── @route Used after Passport.js authenticate
// ─── @access Public
const oauthCallback = asyncHandler(async (req, res) => {
    const user = req.user;
    const refreshToken = generateRefreshToken(user._id);

    await User.findByIdAndUpdate(user._id, {
        $push: {
            refreshTokens: {
                token: hashToken(refreshToken),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        },
    });

    res
        .cookie('accessToken', generateAccessToken(user._id), { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 15 * 60 * 1000 })
        .cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 })
        .redirect(`${process.env.CLIENT_URL}/dashboard`);
});

module.exports = {
    register,
    login,
    logout,
    verify2FA,
    setup2FA,
    enable2FA,
    refreshToken,
    verifyEmail,
    forgotPassword,
    resetPassword,
    getMe,
    oauthCallback,
};