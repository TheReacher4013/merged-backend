const Campaign = require('../models/Campaign.model');
const Contact = require('../models/Contact.model');
const EmailLog = require('../models/EmailLog.model');
const { asyncHandler } = require('../middleware/errorHandler');
const emailQueue = require('../jobs/emailQueue');

const getCampaigns = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status, type, search } = req.query;
    const query = { userId: req.user._id, isDeleted: false };

    if (status) query.status = status;
    if (type) query.type = type;
    if (search) query.name = { $regex: search, $options: 'i' };

    const total = await Campaign.countDocuments(query);
    const campaigns = await Campaign.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select('-htmlContent -textContent')
        .populate('templateId', 'name');

    res.json({
        success: true,
        data: campaigns,
        pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
});

// ─── @desc  Get single campaign
// ─── @route GET /api/campaigns/:id
const getCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false })
        .populate('templateId', 'name htmlContent');

    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
    res.json({ success: true, data: campaign });
});

// ─── @desc  Create campaign
// ─── @route POST /api/campaigns
const createCampaign = asyncHandler(async (req, res) => {
    const {
        name, description, type, subject, previewText,
        fromName, fromEmail, replyTo, templateId, htmlContent, textContent,
        recipientType, segmentIds, tags, manualContactIds,
        scheduledAt, timezone, isABTest, abVariants, abTestDurationHours, abWinnerMetric,
        trackOpens, trackClicks,
    } = req.body;

    const campaign = await Campaign.create({
        userId: req.user._id,
        tenantId: req.user.tenantId,
        name, description, type, subject, previewText,
        fromName: fromName || req.user.name,
        fromEmail: fromEmail || req.user.email,
        replyTo, templateId, htmlContent, textContent,
        recipientType, segmentIds, tags, manualContactIds,
        scheduledAt, timezone,
        isABTest: isABTest || false,
        abVariants: isABTest ? abVariants : [],
        abTestDurationHours, abWinnerMetric,
        trackOpens: trackOpens !== undefined ? trackOpens : true,
        trackClicks: trackClicks !== undefined ? trackClicks : true,
        status: 'draft',
    });

    res.status(201).json({ success: true, message: 'Campaign created.', data: campaign });
});

// ─── @desc  Update campaign (only if draft or scheduled)
// ─── @route PUT /api/campaigns/:id
const updateCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    if (['sending', 'sent'].includes(campaign.status)) {
        return res.status(400).json({ success: false, message: 'Cannot edit a campaign that is sending or already sent.' });
    }

    const allowed = [
        'name', 'description', 'subject', 'previewText', 'fromName', 'fromEmail', 'replyTo',
        'templateId', 'htmlContent', 'textContent', 'recipientType', 'segmentIds', 'tags',
        'manualContactIds', 'scheduledAt', 'timezone', 'trackOpens', 'trackClicks',
        'isABTest', 'abVariants', 'abTestDurationHours', 'abWinnerMetric',
    ];

    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    Object.assign(campaign, updates);
    await campaign.save();

    res.json({ success: true, message: 'Campaign updated.', data: campaign });
});

// ─── @desc  Delete campaign (soft)
// ─── @route DELETE /api/campaigns/:id
const deleteCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: { $in: ['draft', 'scheduled', 'cancelled'] } },
        { isDeleted: true },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found or cannot be deleted.' });
    res.json({ success: true, message: 'Campaign deleted.' });
});

// ─── @desc  Submit campaign for approval (pending_approval)
// ─── @route POST /api/campaigns/:id/submit
const submitForApproval = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: 'draft' },
        { status: 'pending_approval' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found or not in draft.' });
    res.json({ success: true, message: 'Campaign submitted for approval.', data: campaign });
});

// ─── @desc  Approve campaign [Admin/Manager]
// ─── @route POST /api/campaigns/:id/approve
const approveCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, status: 'pending_approval' },
        { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found or not pending approval.' });
    res.json({ success: true, message: 'Campaign approved.', data: campaign });
});

// ─── @desc  Schedule campaign
// ─── @route POST /api/campaigns/:id/schedule
const scheduleCampaign = asyncHandler(async (req, res) => {
    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ success: false, message: 'scheduledAt is required.' });

    const scheduleDate = new Date(scheduledAt);
    if (scheduleDate <= new Date()) {
        return res.status(400).json({ success: false, message: 'Scheduled time must be in the future.' });
    }

    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    if (!['draft', 'approved'].includes(campaign.status)) {
        return res.status(400).json({ success: false, message: `Cannot schedule a campaign with status: ${campaign.status}` });
    }

    campaign.scheduledAt = scheduleDate;
    campaign.status = 'scheduled';
    await campaign.save();

    // Add to Bull queue with delay
    const delay = scheduleDate.getTime() - Date.now();
    await emailQueue.add('send-campaign', { campaignId: campaign._id.toString() }, { delay, jobId: `campaign_${campaign._id}` });

    res.json({ success: true, message: `Campaign scheduled for ${scheduleDate.toISOString()}.`, data: campaign });
});

// ─── @desc  Send campaign immediately
// ─── @route POST /api/campaigns/:id/send-now
const sendNow = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    if (!['draft', 'approved', 'scheduled'].includes(campaign.status)) {
        return res.status(400).json({ success: false, message: `Cannot send a campaign with status: ${campaign.status}` });
    }

    campaign.status = 'sending';
    await campaign.save();

    // Queue immediately
    await emailQueue.add('send-campaign', { campaignId: campaign._id.toString() }, { jobId: `campaign_${campaign._id}_now` });

    res.json({ success: true, message: 'Campaign queued for immediate sending.', data: campaign });
});

// ─── @desc  Pause sending campaign
// ─── @route POST /api/campaigns/:id/pause
const pauseCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: 'sending' },
        { status: 'paused' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found or not currently sending.' });

    // Remove from queue
    const job = await emailQueue.getJob(`campaign_${campaign._id}`);
    if (job) await job.remove();

    res.json({ success: true, message: 'Campaign paused.', data: campaign });
});

// ─── @desc  Resume paused campaign
// ─── @route POST /api/campaigns/:id/resume
const resumeCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: 'paused' },
        { status: 'sending' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found or not paused.' });

    await emailQueue.add('send-campaign', { campaignId: campaign._id.toString(), resume: true }, { jobId: `campaign_${campaign._id}_resume` });

    res.json({ success: true, message: 'Campaign resumed.', data: campaign });
});

// ─── @desc  Cancel campaign
// ─── @route POST /api/campaigns/:id/cancel
const cancelCampaign = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: { $in: ['scheduled', 'sending', 'paused'] } },
        { status: 'cancelled' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found or cannot be cancelled.' });

    const job = await emailQueue.getJob(`campaign_${campaign._id}`);
    if (job) await job.remove();

    res.json({ success: true, message: 'Campaign cancelled.', data: campaign });
});

// ─── @desc  Get campaign analytics
// ─── @route GET /api/campaigns/:id/analytics
const getCampaignAnalytics = asyncHandler(async (req, res) => {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });

    const { stats } = campaign;
    const total = stats.sent || 1;

    // Compute rates
    const rates = {
        deliveryRate: ((stats.delivered / total) * 100).toFixed(2),
        openRate: ((stats.uniqueOpens / total) * 100).toFixed(2),
        clickRate: ((stats.uniqueClicks / total) * 100).toFixed(2),
        clickToOpenRate: stats.uniqueOpens ? ((stats.uniqueClicks / stats.uniqueOpens) * 100).toFixed(2) : '0.00',
        bounceRate: ((stats.bounced / total) * 100).toFixed(2),
        unsubscribeRate: ((stats.unsubscribed / total) * 100).toFixed(2),
        complaintRate: ((stats.complained / total) * 100).toFixed(2),
    };

    // Time-series opens/clicks (hourly for last 48h)
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const hourlyOpens = await EmailLog.aggregate([
        { $match: { campaignId: campaign._id, openedAt: { $gte: since } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$openedAt' } },
                count: { $sum: '$openCount' },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    const hourlyClicks = await EmailLog.aggregate([
        { $match: { campaignId: campaign._id, clickedAt: { $gte: since } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$clickedAt' } },
                count: { $sum: '$clickCount' },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    // Top clicked links
    const topLinks = await EmailLog.aggregate([
        { $match: { campaignId: campaign._id } },
        { $unwind: '$clickEvents' },
        { $group: { _id: '$clickEvents.url', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
    ]);

    // Device breakdown
    const deviceBreakdown = await EmailLog.aggregate([
        { $match: { campaignId: campaign._id, openDevice: { $exists: true } } },
        { $group: { _id: '$openDevice', count: { $sum: 1 } } },
    ]);

    // A/B variant stats
    let abStats = null;
    if (campaign.isABTest) {
        abStats = await EmailLog.aggregate([
            { $match: { campaignId: campaign._id } },
            {
                $group: {
                    _id: '$abVariant',
                    sent: { $sum: 1 },
                    opened: { $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] } },
                    clicked: { $sum: { $cond: [{ $gt: ['$clickCount', 0] }, 1, 0] } },
                },
            },
        ]);
    }

    res.json({
        success: true,
        data: {
            campaign: { _id: campaign._id, name: campaign.name, status: campaign.status, sentAt: campaign.sentAt },
            stats,
            rates,
            hourlyOpens,
            hourlyClicks,
            topLinks,
            deviceBreakdown,
            abStats,
        },
    });
});

module.exports = {
    getCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    submitForApproval,
    approveCampaign,
    scheduleCampaign,
    sendNow,
    pauseCampaign,
    resumeCampaign,
    cancelCampaign,
    getCampaignAnalytics,
};