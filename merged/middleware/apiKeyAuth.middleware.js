const ApiKey = require('../models/ApiKey.model');
const User   = require('../models/User.model');

/**
 * Middleware: authenticate via API Key
 * Reads key from header: X-API-Key: em_live_xxxxx
 * OR from query param:   ?api_key=em_live_xxxxx
 *
 * On success: populates req.user and req.apiKey
 * On failure: 401 / 403
 */
const apiKeyAuth = async (req, res, next) => {
    try {
        const rawKey =
            req.headers['x-api-key'] ||
            req.query.api_key ||
            null;

        if (!rawKey) {
            return res.status(401).json({
                success: false,
                message: 'API key required. Pass it in the X-API-Key header.',
            });
        }

        // Find by hash
        const apiKey = await ApiKey.findByRawKey(rawKey).populate('userId');

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or revoked API key.',
            });
        }

        // Check expiry
        if (apiKey.isExpired()) {
            return res.status(403).json({
                success: false,
                message: 'API key has expired.',
            });
        }

        // Check IP whitelist
        if (apiKey.allowedIps && apiKey.allowedIps.length > 0) {
            const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
            if (!apiKey.allowedIps.includes(clientIp)) {
                return res.status(403).json({
                    success: false,
                    message: 'IP address not allowed for this API key.',
                });
            }
        }

        // Check user is still active
        const user = await User.findById(apiKey.userId).select('-password -refreshTokens');
        if (!user || !user.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Account is inactive.',
            });
        }

        // Update usage tracking (non-blocking)
        ApiKey.findByIdAndUpdate(apiKey._id, {
            $inc: { usageCount: 1 },
            $set: { lastUsedAt: new Date() },
        }).exec().catch(() => {});

        req.user   = user;
        req.apiKey = apiKey;
        next();
    } catch (err) {
        console.error('[ApiKeyAuth] Error:', err.message);
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
};

/**
 * Middleware: check that the API key has a required scope
 * Usage: router.get('/contacts', apiKeyAuth, requireScope('contacts:read'), ...)
 */
const requireScope = (...requiredScopes) => {
    return (req, res, next) => {
        const key = req.apiKey;
        if (!key) {
            return res.status(403).json({ success: false, message: 'API key context missing' });
        }

        // 'all' scope grants everything
        if (key.scopes.includes('all')) return next();

        const hasScope = requiredScopes.some(s => key.scopes.includes(s));
        if (!hasScope) {
            return res.status(403).json({
                success: false,
                message: `This API key does not have the required scope: ${requiredScopes.join(' or ')}`,
            });
        }

        next();
    };
};

module.exports = { apiKeyAuth, requireScope };
