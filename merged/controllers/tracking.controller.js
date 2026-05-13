const EmailLog = require('../models/EmailLog.model');
const Campaign = require('../models/Campaign.model');
const Contact = require('../models/Contact.model');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/errorHandler');

// 1x1 transparent GIF in base64
const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

// ─── Detect device from User-Agent ───────────────────────────────────────────
const detectDevice = (ua = '') => {
    if (/mobile|android|iphone|ipad|tablet/i.test(ua)) {
        if (/tablet|ipad/i.test(ua)) return 'tablet';
        return 'mobile';
    }
    return 'desktop';
};

// ─── @desc  Open tracking pixel
// ─── @route GET /api/track/open/:pixelId
// ─── @access Public (called by email client)
const trackOpen = asyncHandler(async (req, res) => {
    // Always serve pixel first (speed matters for email clients)
    res.set({
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
    });
    res.send(TRACKING_PIXEL);

    // Process tracking in background (don't block pixel response)
    setImmediate(async () => {
        try {
            const { pixelId } = req.params;
            const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
            const ua = req.headers['user-agent'] || '';

            // Skip bot/preview opens
            const botPatterns = /bot|crawler|preview|prefetch|GoogleImageProxy|Outlook|thunderbird/i;
            if (botPatterns.test(ua)) return;

            const emailLog = await EmailLog.findOne({ trackingPixelId: pixelId });
            if (!emailLog) return;

            const isFirstOpen = emailLog.openCount === 0;

            await EmailLog.findByIdAndUpdate(emailLog._id, {
                $inc: { openCount: 1 },
                $set: {
                    status: 'opened',
                    openedAt: isFirstOpen ? new Date() : emailLog.openedAt,
                    lastOpenedAt: new Date(),
                    openIp: ip,
                    openUserAgent: ua,
                    openDevice: detectDevice(ua),
                },
            });

            if (isFirstOpen && emailLog.campaignId) {
                await Campaign.findByIdAndUpdate(emailLog.campaignId, {
                    $inc: { 'stats.opened': 1, 'stats.uniqueOpens': 1 },
                });

                // Log engagement on contact
                await Contact.findByIdAndUpdate(emailLog.contactId, {
                    $inc: { emailsOpened: 1 },
                    $push: {
                        engagementHistory: {
                            type: 'email_opened',
                            campaignId: emailLog.campaignId,
                            timestamp: new Date(),
                        },
                    },
                });
            } else if (!isFirstOpen && emailLog.campaignId) {
                // Count repeat opens
                await Campaign.findByIdAndUpdate(emailLog.campaignId, {
                    $inc: { 'stats.opened': 1 },
                });
            }
        } catch (err) {
            console.error('Open tracking error:', err.message);
        }
    });
});

// ─── @desc  Click tracking redirect
// ─── @route GET /api/track/click
// ─── @access Public
const trackClick = asyncHandler(async (req, res) => {
    const { lid, url } = req.query;

    if (!url) return res.status(400).send('Bad request');

    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(url);
        new URL(decodedUrl); // validate URL
    } catch {
        return res.status(400).send('Invalid URL');
    }

    // Redirect immediately for UX
    res.redirect(302, decodedUrl);

    // Track in background
    setImmediate(async () => {
        try {
            if (!lid) return;

            const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
            const ua = req.headers['user-agent'] || '';

            const emailLog = await EmailLog.findById(lid);
            if (!emailLog) return;

            const isFirstClick = emailLog.clickCount === 0;

            await EmailLog.findByIdAndUpdate(lid, {
                $inc: { clickCount: 1 },
                $set: {
                    status: 'clicked',
                    clickedAt: isFirstClick ? new Date() : emailLog.clickedAt,
                },
                $push: {
                    clickEvents: {
                        url: decodedUrl,
                        trackedUrl: req.originalUrl,
                        clickedAt: new Date(),
                        ipAddress: ip,
                        userAgent: ua,
                        device: detectDevice(ua),
                    },
                },
            });

            if (isFirstClick && emailLog.campaignId) {
                await Campaign.findByIdAndUpdate(emailLog.campaignId, {
                    $inc: { 'stats.clicked': 1, 'stats.uniqueClicks': 1 },
                });

                await Contact.findByIdAndUpdate(emailLog.contactId, {
                    $inc: { emailsClicked: 1 },
                    $push: {
                        engagementHistory: {
                            type: 'email_clicked',
                            campaignId: emailLog.campaignId,
                            timestamp: new Date(),
                            metadata: { url: decodedUrl },
                        },
                    },
                });
            } else if (!isFirstClick && emailLog.campaignId) {
                await Campaign.findByIdAndUpdate(emailLog.campaignId, {
                    $inc: { 'stats.clicked': 1 },
                });
            }
        } catch (err) {
            console.error('Click tracking error:', err.message);
        }
    });
});

// ─── @desc  Unsubscribe handler
// ─── @route GET /api/track/unsubscribe
// ─── @access Public
const trackUnsubscribe = asyncHandler(async (req, res) => {
    const { lid } = req.query;

    if (!lid) return res.status(400).send('Invalid unsubscribe link.');

    const emailLog = await EmailLog.findById(lid).populate('contactId');
    if (!emailLog) return res.status(404).send('Unsubscribe link not found.');

    // Update contact status
    await Contact.findByIdAndUpdate(emailLog.contactId, {
        status: 'unsubscribed',
        unsubscribedAt: new Date(),
        unsubscribeReason: 'email_unsubscribe_link',
    });

    // Update email log
    await EmailLog.findByIdAndUpdate(lid, {
        status: 'unsubscribed',
        unsubscribedAt: new Date(),
    });

    // Update campaign stats
    if (emailLog.campaignId) {
        await Campaign.findByIdAndUpdate(emailLog.campaignId, {
            $inc: { 'stats.unsubscribed': 1 },
        });
    }

    // Redirect to unsubscribe confirmation page
    res.redirect(`${process.env.CLIENT_URL}/unsubscribed?email=${encodeURIComponent(emailLog.toEmail)}`);
});

// ─── @desc  SendGrid Webhook (delivery, bounce, spam complaint events)
// ─── @route POST /api/track/webhook/sendgrid
// ─── @access Public (verified by signature)
const sendgridWebhook = asyncHandler(async (req, res) => {
    // Verify SendGrid webhook signature
    const signature = req.headers['x-twilio-email-event-webhook-signature'];
    const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'];

    if (process.env.SENDGRID_WEBHOOK_KEY && signature) {
        const payload = timestamp + req.rawBody;
        const expectedSig = crypto
            .createHmac('sha256', process.env.SENDGRID_WEBHOOK_KEY)
            .update(payload)
            .digest('base64');

        if (signature !== expectedSig) {
            return res.status(403).json({ message: 'Invalid webhook signature.' });
        }
    }

    res.status(200).send('OK'); // Acknowledge immediately

    const events = Array.isArray(req.body) ? req.body : [req.body];

    setImmediate(async () => {
        for (const event of events) {
            try {
                const messageId = event.sg_message_id?.split('.')[0];
                if (!messageId) continue;

                const emailLog = await EmailLog.findOne({ providerMessageId: messageId });
                if (!emailLog) continue;

                switch (event.event) {
                    case 'delivered':
                        await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'delivered' });
                        if (emailLog.campaignId) {
                            await Campaign.findByIdAndUpdate(emailLog.campaignId, { $inc: { 'stats.delivered': 1 } });
                        }
                        break;

                    case 'bounce':
                    case 'blocked':
                        const bounceType = event.type === 'bounce' ? 'hard' : 'soft';
                        await EmailLog.findByIdAndUpdate(emailLog._id, {
                            status: 'bounced',
                            bouncedAt: new Date(),
                            bounceType,
                            bounceReason: event.reason || '',
                        });
                        if (emailLog.campaignId) {
                            await Campaign.findByIdAndUpdate(emailLog.campaignId, {
                                $inc: {
                                    'stats.bounced': 1,
                                    [bounceType === 'hard' ? 'stats.hardBounced' : 'stats.softBounced']: 1,
                                },
                            });
                        }
                        // Hard bounce — mark contact
                        if (bounceType === 'hard') {
                            await Contact.findByIdAndUpdate(emailLog.contactId, { status: 'bounced' });
                        }
                        break;

                    case 'spamreport':
                        await EmailLog.findByIdAndUpdate(emailLog._id, {
                            status: 'complained',
                            complainedAt: new Date(),
                        });
                        await Contact.findByIdAndUpdate(emailLog.contactId, { status: 'complained' });
                        if (emailLog.campaignId) {
                            await Campaign.findByIdAndUpdate(emailLog.campaignId, { $inc: { 'stats.complained': 1 } });
                        }
                        break;

                    case 'unsubscribe':
                        await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'unsubscribed', unsubscribedAt: new Date() });
                        await Contact.findByIdAndUpdate(emailLog.contactId, { status: 'unsubscribed', unsubscribedAt: new Date() });
                        if (emailLog.campaignId) {
                            await Campaign.findByIdAndUpdate(emailLog.campaignId, { $inc: { 'stats.unsubscribed': 1 } });
                        }
                        break;
                }
            } catch (err) {
                console.error('SendGrid webhook event processing error:', err.message);
            }
        }
    });
});

// ─── @desc  Amazon SES Webhook (via SNS)
// ─── @route POST /api/track/webhook/ses
// ─── @access Public
const sesWebhook = asyncHandler(async (req, res) => {
    res.status(200).send('OK');

    setImmediate(async () => {
        try {
            const snsMessage = typeof req.body.Message === 'string'
                ? JSON.parse(req.body.Message)
                : req.body;

            const notificationType = snsMessage.notificationType;
            const messageId = snsMessage.mail?.messageId;
            if (!messageId) return;

            const emailLog = await EmailLog.findOne({ providerMessageId: messageId });
            if (!emailLog) return;

            if (notificationType === 'Bounce') {
                const bounceType = snsMessage.bounce?.bounceType === 'Permanent' ? 'hard' : 'soft';
                await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'bounced', bouncedAt: new Date(), bounceType });
                if (bounceType === 'hard') await Contact.findByIdAndUpdate(emailLog.contactId, { status: 'bounced' });
                if (emailLog.campaignId) {
                    await Campaign.findByIdAndUpdate(emailLog.campaignId, { $inc: { 'stats.bounced': 1 } });
                }
            }

            if (notificationType === 'Complaint') {
                await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'complained', complainedAt: new Date() });
                await Contact.findByIdAndUpdate(emailLog.contactId, { status: 'complained' });
                if (emailLog.campaignId) {
                    await Campaign.findByIdAndUpdate(emailLog.campaignId, { $inc: { 'stats.complained': 1 } });
                }
            }

            if (notificationType === 'Delivery') {
                await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'delivered' });
                if (emailLog.campaignId) {
                    await Campaign.findByIdAndUpdate(emailLog.campaignId, { $inc: { 'stats.delivered': 1 } });
                }
            }
        } catch (err) {
            console.error('SES webhook error:', err.message);
        }
    });
});

module.exports = { trackOpen, trackClick, trackUnsubscribe, sendgridWebhook, sesWebhook };