const AuditLog = require('../models/AuditLog.model');
const { asyncHandler } = require('../middleware/errorHandler');

// @desc  Get audit logs with filters + pagination
// @route GET /api/audit-logs
// @access Admin only
const getAuditLogs = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 50,
        module,
        action,
        userId,
        status,
        startDate,
        endDate,
        search,
    } = req.query;

    const query = {};

    if (module) query.module = module;
    if (action) query.action = action;
    if (userId) query.userId = userId;
    if (status) query.status = status;

    // Date range filter
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Search in description or userEmail
    if (search) {
        query.$or = [
            { description: { $regex: search, $options: 'i' } },
            { userEmail: { $regex: search, $options: 'i' } },
            { userName: { $regex: search, $options: 'i' } },
        ];
    }

    const total = await AuditLog.countDocuments(query);

    const logs = await AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

    res.json({
        success: true,
        data: logs,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit),
        },
    });
});

// @desc  Get a single audit log entry
// @route GET /api/audit-logs/:id
const getAuditLogById = asyncHandler(async (req, res) => {
    const log = await AuditLog.findById(req.params.id).lean();

    if (!log) {
        return res.status(404).json({ success: false, message: 'Audit log not found' });
    }

    res.json({ success: true, data: log });
});

// @desc  Get summary stats (for admin dashboard widget)
// @route GET /api/audit-logs/stats
const getAuditStats = asyncHandler(async (req, res) => {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
        total,
        last24hCount,
        failureCount,
        byModule,
        recentFailures,
        topUsers,
    ] = await Promise.all([
        AuditLog.countDocuments(),
        AuditLog.countDocuments({ createdAt: { $gte: last24h } }),
        AuditLog.countDocuments({ status: 'failure', createdAt: { $gte: last7d } }),

        // Actions grouped by module (last 7 days)
        AuditLog.aggregate([
            { $match: { createdAt: { $gte: last7d } } },
            { $group: { _id: '$module', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),

        // Recent failures
        AuditLog.find({ status: 'failure' })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),

        // Most active users (last 7 days)
        AuditLog.aggregate([
            { $match: { createdAt: { $gte: last7d }, userId: { $ne: null } } },
            { $group: { _id: '$userId', userName: { $first: '$userName' }, userEmail: { $first: '$userEmail' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
        ]),
    ]);

    res.json({
        success: true,
        data: {
            total,
            last24hCount,
            failureCount,
            byModule,
            recentFailures,
            topUsers,
        },
    });
});

// @desc  Export logs as CSV (admin)
// @route GET /api/audit-logs/export
const exportAuditLogs = asyncHandler(async (req, res) => {
    const { startDate, endDate, module, status } = req.query;

    const query = {};
    if (module) query.module = module;
    if (status) query.status = status;
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const logs = await AuditLog.find(query)
        .sort({ createdAt: -1 })
        .limit(10000) // Safety cap
        .lean();

    const header = 'Date,User,Email,Role,Action,Module,Description,Status,IP\n';
    const rows = logs.map(l =>
        [
            new Date(l.createdAt).toISOString(),
            `"${l.userName}"`,
            l.userEmail,
            l.userRole,
            l.action,
            l.module,
            `"${l.description.replace(/"/g, '""')}"`,
            l.status,
            l.ipAddress || '',
        ].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    res.send(header + rows);
});

module.exports = {
    getAuditLogs,
    getAuditLogById,
    getAuditStats,
    exportAuditLogs,
};
