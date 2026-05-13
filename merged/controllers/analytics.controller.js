const Campaign = require('../models/Campaign.model');
const EmailLog = require('../models/EmailLog.model');
const Contact = require('../models/Contact.model');
const { Automation, Enrollment } = require('../models/Automation.model');
const { asyncHandler } = require('../middleware/errorHandler');

// ─── @desc  Overall dashboard summary
// ─── @route GET /api/analytics/dashboard
const getDashboard = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { period = '30d' } = req.query;

    const periodMap = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
    const days = periodMap[period] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // ─── Aggregate campaign stats for period ──────────────────────────────────
    const campaignStats = await Campaign.aggregate([
        { $match: { userId, sentAt: { $gte: since }, status: 'sent' } },
        {
            $group: {
                _id: null,
                totalCampaigns: { $sum: 1 },
                totalSent: { $sum: '$stats.sent' },
                totalDelivered: { $sum: '$stats.delivered' },
                totalOpened: { $sum: '$stats.uniqueOpens' },
                totalClicked: { $sum: '$stats.uniqueClicks' },
                totalBounced: { $sum: '$stats.bounced' },
                totalUnsubscribed: { $sum: '$stats.unsubscribed' },
                totalComplained: { $sum: '$stats.complained' },
            },
        },
    ]);

    const stats = campaignStats[0] || {
        totalCampaigns: 0, totalSent: 0, totalDelivered: 0,
        totalOpened: 0, totalClicked: 0, totalBounced: 0,
        totalUnsubscribed: 0, totalComplained: 0,
    };

    const sent = stats.totalSent || 1;
    const rates = {
        deliveryRate: ((stats.totalDelivered / sent) * 100).toFixed(2),
        openRate: ((stats.totalOpened / sent) * 100).toFixed(2),
        clickRate: ((stats.totalClicked / sent) * 100).toFixed(2),
        clickToOpenRate: stats.totalOpened ? ((stats.totalClicked / stats.totalOpened) * 100).toFixed(2) : '0.00',
        bounceRate: ((stats.totalBounced / sent) * 100).toFixed(2),
        unsubscribeRate: ((stats.totalUnsubscribed / sent) * 100).toFixed(2),
    };

    // ─── Contact growth over period ───────────────────────────────────────────
    const contactGrowth = await Contact.aggregate([
        { $match: { userId, createdAt: { $gte: since }, isDeleted: false } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    const totalContacts = await Contact.countDocuments({ userId, isDeleted: false, status: 'subscribed' });
    const newContacts = await Contact.countDocuments({ userId, createdAt: { $gte: since }, isDeleted: false });

    // ─── Campaign performance over time (daily sent count) ───────────────────
    const sendingTrend = await Campaign.aggregate([
        { $match: { userId, sentAt: { $gte: since }, status: 'sent' } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
                campaigns: { $sum: 1 },
                emailsSent: { $sum: '$stats.sent' },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    // ─── Top 5 campaigns by open rate ────────────────────────────────────────
    const topCampaigns = await Campaign.find({ userId, status: 'sent', 'stats.sent': { $gt: 0 } })
        .sort({ 'stats.uniqueOpens': -1 })
        .limit(5)
        .select('name stats.sent stats.uniqueOpens stats.uniqueClicks sentAt');

    // ─── Recent campaigns ─────────────────────────────────────────────────────
    const recentCampaigns = await Campaign.find({ userId, isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name status stats.sent stats.uniqueOpens scheduledAt sentAt createdAt');

    // ─── Automation summary ───────────────────────────────────────────────────
    const automationStats = await Automation.aggregate([
        { $match: { userId, isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    res.json({
        success: true,
        data: {
            period,
            overview: {
                totalContacts,
                newContacts,
                ...stats,
                rates,
            },
            contactGrowth,
            sendingTrend,
            topCampaigns,
            recentCampaigns,
            automationStats,
        },
    });
});

// ─── @desc  Engagement over time (opens + clicks per day/hour)
// ─── @route GET /api/analytics/engagement
const getEngagementTimeline = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { period = '30d', granularity = 'day' } = req.query;

    const periodMap = { '7d': 7, '30d': 30, '90d': 90 };
    const days = periodMap[period] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const format = granularity === 'hour' ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%d';

    const [opens, clicks] = await Promise.all([
        EmailLog.aggregate([
            { $match: { userId, openedAt: { $gte: since } } },
            { $group: { _id: { $dateToString: { format, date: '$openedAt' } }, count: { $sum: '$openCount' } } },
            { $sort: { _id: 1 } },
        ]),
        EmailLog.aggregate([
            { $match: { userId, clickedAt: { $gte: since } } },
            { $group: { _id: { $dateToString: { format, date: '$clickedAt' } }, count: { $sum: '$clickCount' } } },
            { $sort: { _id: 1 } },
        ]),
    ]);

    res.json({ success: true, data: { opens, clicks } });
});

// ─── @desc  Best send time analysis (what times get highest open rates)
// ─── @route GET /api/analytics/best-send-time
const getBestSendTime = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const hourlyOpenRate = await EmailLog.aggregate([
        { $match: { userId, openedAt: { $exists: true } } },
        {
            $group: {
                _id: { $hour: '$openedAt' },
                opens: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    const dayOfWeekRate = await EmailLog.aggregate([
        { $match: { userId, openedAt: { $exists: true } } },
        {
            $group: {
                _id: { $dayOfWeek: '$openedAt' },   // 1=Sunday ... 7=Saturday
                opens: { $sum: 1 },
            },
        },
        { $sort: { opens: -1 } },
    ]);

    const dayNames = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeekRateNamed = dayOfWeekRate.map((d) => ({ day: dayNames[d._id], opens: d.opens }));

    res.json({ success: true, data: { hourlyOpenRate, dayOfWeekRate: dayOfWeekRateNamed } });
});

// ─── @desc  Device & geo breakdown
// ─── @route GET /api/analytics/devices
const getDeviceBreakdown = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [devices, countries] = await Promise.all([
        EmailLog.aggregate([
            { $match: { userId, openDevice: { $exists: true }, openedAt: { $gte: since } } },
            { $group: { _id: '$openDevice', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        EmailLog.aggregate([
            { $match: { userId, openCountry: { $exists: true, $ne: null }, openedAt: { $gte: since } } },
            { $group: { _id: '$openCountry', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
        ]),
    ]);

    res.json({ success: true, data: { devices, countries } });
});

// ─── @desc  Contact engagement cohort (based on past engagement)
// ─── @route GET /api/analytics/cohort
const getCohortAnalysis = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Segment contacts by engagement level
    const [champions, engaged, atRisk, inactive] = await Promise.all([
        Contact.countDocuments({ userId, emailsOpened: { $gte: 10 }, emailsClicked: { $gte: 3 }, status: 'subscribed' }),
        Contact.countDocuments({ userId, emailsOpened: { $gte: 3, $lt: 10 }, status: 'subscribed' }),
        Contact.countDocuments({ userId, emailsOpened: { $gte: 1, $lt: 3 }, status: 'subscribed' }),
        Contact.countDocuments({ userId, emailsOpened: 0, emailsSent: { $gte: 3 }, status: 'subscribed' }),
    ]);

    const total = champions + engaged + atRisk + inactive || 1;

    res.json({
        success: true,
        data: {
            cohorts: [
                { label: 'Champions', description: '10+ opens, 3+ clicks', count: champions, percent: ((champions / total) * 100).toFixed(1) },
                { label: 'Engaged', description: '3-9 opens', count: engaged, percent: ((engaged / total) * 100).toFixed(1) },
                { label: 'At Risk', description: '1-2 opens', count: atRisk, percent: ((atRisk / total) * 100).toFixed(1) },
                { label: 'Inactive', description: 'Never opened (3+ emails sent)', count: inactive, percent: ((inactive / total) * 100).toFixed(1) },
            ],
            total,
        },
    });
});

// ─── @desc  Export analytics as JSON (frontend converts to CSV/PDF)
// ─── @route GET /api/analytics/export
const exportAnalytics = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { type = 'campaigns', period = '30d' } = req.query;

    const days = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let data = [];

    if (type === 'campaigns') {
        data = await Campaign.find({ userId, sentAt: { $gte: since }, status: 'sent' })
            .select('name subject sentAt stats')
            .lean();

        data = data.map((c) => ({
            name: c.name,
            subject: c.subject,
            sentAt: c.sentAt,
            sent: c.stats.sent,
            delivered: c.stats.delivered,
            opened: c.stats.uniqueOpens,
            clicked: c.stats.uniqueClicks,
            bounced: c.stats.bounced,
            unsubscribed: c.stats.unsubscribed,
            openRate: c.stats.sent ? ((c.stats.uniqueOpens / c.stats.sent) * 100).toFixed(2) : 0,
            clickRate: c.stats.sent ? ((c.stats.uniqueClicks / c.stats.sent) * 100).toFixed(2) : 0,
        }));
    } else if (type === 'contacts') {
        data = await Contact.find({ userId, isDeleted: false })
            .select('email firstName lastName company status tags emailsSent emailsOpened emailsClicked createdAt')
            .lean();
    }

    res.json({ success: true, data, total: data.length, exportedAt: new Date() });
});

// ─── @desc  Spam score check before send
// ─── @route POST /api/analytics/spam-check
const spamCheckEndpoint = asyncHandler(async (req, res) => {
    const { htmlContent, subject } = req.body;
    if (!htmlContent || !subject) {
        return res.status(400).json({ success: false, message: 'htmlContent and subject are required.' });
    }

    const { spamCheck } = require('../services/emailEngine.service');
    const result = spamCheck(htmlContent, subject);

    res.json({ success: true, data: result });
});

module.exports = {
    getDashboard,
    getEngagementTimeline,
    getBestSendTime,
    getDeviceBreakdown,
    getCohortAnalysis,
    exportAnalytics,
    spamCheckEndpoint,
};