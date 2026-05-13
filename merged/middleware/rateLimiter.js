const rateLimit = require('express-rate-limit');

// ─── General API Rate Limiter ──────────────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again after 15 minutes.' },
});

// ─── Auth Routes (stricter) ────────────────────────────────────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 10 login attempts per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
});

// ─── CSV Import (resource heavy) ──────────────────────────────────────────────
const importLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { success: false, message: 'Too many import requests. Please try again after 1 hour.' },
});

module.exports = { apiLimiter, authLimiter, importLimiter };