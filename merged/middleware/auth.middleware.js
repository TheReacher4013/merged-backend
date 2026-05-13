const jwt = require('jsonwebtoken');
const User = require('../models/User.model');

// ─── Verify Access Token ──────────────────────────────────────────────────────
const protect = async (req, res, next) => {
    try {
        let token;

        // Check Authorization header first, then HttpOnly cookie
        if (req.headers.authorization?.startsWith('Bearer ')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        }

        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const user = await User.findById(decoded.id).select('-password -refreshTokens');

        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Account is deactivated.' });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
};

// ─── Role-based Authorization ─────────────────────────────────────────────────
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Role '${req.user.role}' is not authorized to perform this action.`,
            });
        }
        next();
    };
};

// ─── Optional Auth (doesn't block if no token) ────────────────────────────────
const optionalAuth = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization?.startsWith('Bearer ')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        }

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
        }
    } catch (_) {
        // No-op — token invalid or absent; continue as guest
    }
    next();
};

module.exports = { protect, authorize, optionalAuth };