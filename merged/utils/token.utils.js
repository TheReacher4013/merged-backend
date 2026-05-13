const jwt = require('jsonwebtoken');
const crypto = require('crypto');

//Generate Access Token (short-lived: 15 min) 
const generateAccessToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
    });
};

//Generate Refresh Token (long-lived: 7 days)
const generateRefreshToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
    });
};

//Send Tokens via HttpOnly Cookies + Response
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
    };

    res
        .status(statusCode)
        .cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 })          // 15 min
        .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 }) // 7 days
        .json({
            success: true,
            message,
            data: {
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    avatar: user.avatar,
                    isEmailVerified: user.isEmailVerified,
                    isTwoFactorEnabled: user.isTwoFactorEnabled,
                },
                accessToken, // also returned in body for API clients
            },
        });

    return refreshToken;
};

// Generate Secure Random Token (for email verification, password reset)
const generateSecureToken = () => crypto.randomBytes(32).toString('hex');

// Hash a plain token for storage 
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    sendTokenResponse,
    generateSecureToken,
    hashToken,
};