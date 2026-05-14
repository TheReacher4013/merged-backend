const AuditLog = require('../models/AuditLog.model');

/**
 * Core function to create an audit log entry.
 * Call this from any controller after a successful action.
 *
 * @param {Object} options
 * @param {Object|null} options.user        - req.user (null for system actions)
 * @param {String} options.action           - Action enum value e.g. 'CAMPAIGN_CREATED'
 * @param {String} options.module           - Module name e.g. 'campaign'
 * @param {String} options.description      - Human-readable message
 * @param {String|null} options.resourceId  - ID of affected resource
 * @param {String|null} options.resourceType- Type of affected resource
 * @param {Object} options.metadata         - Extra data (diffs, counts, etc.)
 * @param {Object|null} options.req         - Express request (for IP + UA)
 * @param {String} options.status           - 'success' | 'failure'
 * @param {String|null} options.errorMessage- Error message if status=failure
 */
const createAuditLog = async ({
    user = null,
    action,
    module,
    description,
    resourceId = null,
    resourceType = null,
    metadata = {},
    req = null,
    status = 'success',
    errorMessage = null,
}) => {
    try {
        await AuditLog.create({
            userId:       user?._id || null,
            userName:     user?.name || 'System',
            userEmail:    user?.email || '',
            userRole:     user?.role || '',
            action,
            module,
            description,
            resourceId:   resourceId ? String(resourceId) : null,
            resourceType,
            metadata,
            ipAddress:    req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null) : null,
            userAgent:    req ? req.headers['user-agent'] : null,
            status,
            errorMessage,
        });
    } catch (err) {
        // Never let audit logging break the main flow
        console.error('[AuditLog] Failed to write log:', err.message);
    }
};

/**
 * Express middleware that auto-logs on response finish.
 * Attach to specific routes where you want automatic logging.
 *
 * Usage in route file:
 *   router.post('/campaigns', protect, auditMiddleware('CAMPAIGN_CREATED', 'campaign', 'Campaign created'), createCampaign);
 */
const auditMiddleware = (action, module, description) => {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);

        res.json = (body) => {
            // Only log if response was successful
            if (res.statusCode >= 200 && res.statusCode < 300) {
                createAuditLog({
                    user: req.user,
                    action,
                    module,
                    description,
                    resourceId: body?.data?._id || req.params?.id || null,
                    resourceType: module,
                    metadata: {},
                    req,
                    status: 'success',
                });
            }
            return originalJson(body);
        };

        next();
    };
};

module.exports = { createAuditLog, auditMiddleware };
