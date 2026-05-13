/**
 * emailEngine.service.js — Send emails via SMTP (nodemailer)
 *
 * Replaces the previous SendGrid primary + AWS SES fallback approach.
 * A single nodemailer transporter is created from SMTP_* env vars,
 * supporting any SMTP provider (Gmail, Mailgun, Brevo, Postmark, etc.).
 *
 * The rest of the service (personalization, tracking, batch processing,
 * A/B test winner selection, spam check) is unchanged.
 */

const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const Campaign = require('../models/Campaign.model');
const Contact = require('../models/Contact.model');
const EmailLog = require('../models/EmailLog.model');
const emailQueue = require('../jobs/emailQueue');

// ─── SMTP Transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for others
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    // Optional: increase timeouts for bulk sends
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
});

// Verify SMTP connection on startup (non-fatal — logs a warning only)
transporter.verify().then(() => {
    console.log('✅ SMTP transporter connected');
}).catch((err) => {
    console.warn('⚠️  SMTP verify failed (will retry on first send):', err.message);
});

// ─── Throttle config ──────────────────────────────────────────────────────────
const BATCH_SIZE = parseInt(process.env.SMTP_BATCH_SIZE || '50', 10);
const BATCH_DELAY_MS = parseInt(process.env.SMTP_BATCH_DELAY_MS || '1000', 10);

// ─── Rewrite links for click tracking ────────────────────────────────────────
const rewriteLinks = (html, emailLogId, baseUrl) => {
    const regex = /href="(https?:\/\/[^"]+)"/gi;
    return html.replace(regex, (match, url) => {
        if (url.includes('unsubscribe')) return match;
        const encoded = encodeURIComponent(url);
        return `href="${baseUrl}/api/track/click?lid=${emailLogId}&url=${encoded}"`;
    });
};

// ─── Inject open-tracking pixel ───────────────────────────────────────────────
const injectOpenPixel = (html, pixelId, baseUrl) => {
    const pixel = `<img src="${baseUrl}/api/track/open/${pixelId}" width="1" height="1" style="display:none;" alt="" />`;
    return html.replace('</body>', `${pixel}</body>`);
};

// ─── Replace merge tags with contact data ─────────────────────────────────────
const personalize = (html, contact, unsubscribeUrl) => {
    const data = {
        name: contact.firstName || contact.email.split('@')[0],
        first_name: contact.firstName || '',
        last_name: contact.lastName || '',
        email: contact.email,
        company: contact.company || '',
        unsubscribe_url: unsubscribeUrl,
        ...(contact.customFields ? Object.fromEntries(contact.customFields) : {}),
    };
    let result = html;
    for (const [key, value] of Object.entries(data)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }
    return result;
};

// ─── Send a single email via SMTP ─────────────────────────────────────────────
const sendSingleEmail = async ({ to, subject, html, text, fromEmail, fromName, replyTo, headers }) => {
    const mailOptions = {
        from: `"${fromName || process.env.SMTP_FROM_NAME}" <${fromEmail || process.env.SMTP_FROM_EMAIL}>`,
        to,
        replyTo: replyTo || fromEmail || process.env.SMTP_FROM_EMAIL,
        subject,
        html,
        text: text || '',
        headers: {
            'List-Unsubscribe': headers?.unsubscribeHeader || '',
            'X-Campaign-ID': headers?.campaignId || '',
        },
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return {
            success: true,
            provider: 'smtp',
            messageId: info.messageId,
        };
    } catch (err) {
        console.error('SMTP send error:', err.message);
        return {
            success: false,
            provider: 'smtp',
            error: err.message,
        };
    }
};

// ─── Batch-send campaign to all recipients ────────────────────────────────────
const processCampaign = async (campaignId, resumeMode = false) => {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    campaign.status = 'sending';
    await campaign.save();

    // ─── Build recipient list ──────────────────────────────────────────────
    let contacts = [];

    if (campaign.recipientType === 'all') {
        contacts = await Contact.find({ userId: campaign.userId, status: 'subscribed', isDeleted: false });
    } else if (campaign.recipientType === 'segment') {
        const { buildSegmentQuery } = require('./segmentQuery.service');
        const query = await buildSegmentQuery(campaign.userId, campaign.segmentIds);
        contacts = await Contact.find(query);
    } else if (campaign.recipientType === 'tag') {
        contacts = await Contact.find({ userId: campaign.userId, tags: { $in: campaign.tags }, status: 'subscribed', isDeleted: false });
    } else if (campaign.recipientType === 'manual') {
        contacts = await Contact.find({ _id: { $in: campaign.manualContactIds }, status: 'subscribed' });
    }

    // Skip already-sent contacts in resume mode
    if (resumeMode) {
        const alreadySent = await EmailLog.distinct('contactId', { campaignId: campaign._id, status: { $ne: 'failed' } });
        contacts = contacts.filter((c) => !alreadySent.some((id) => id.equals(c._id)));
    }

    // ─── A/B Test: split audience ──────────────────────────────────────────
    let variantAssignments = {};
    if (campaign.isABTest && campaign.abVariants?.length === 2) {
        const splitA = Math.floor(contacts.length * (campaign.abVariants[0].splitPercent / 100));
        contacts.forEach((c, i) => {
            variantAssignments[c._id.toString()] = i < splitA ? 'A' : 'B';
        });
    }

    campaign.stats.totalRecipients = contacts.length;
    await campaign.save();

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5000';
    let sentCount = 0;

    // ─── Process in batches ────────────────────────────────────────────────
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        // Abort if campaign was paused / cancelled mid-send
        const freshCampaign = await Campaign.findById(campaignId).select('status');
        if (['paused', 'cancelled'].includes(freshCampaign.status)) {
            console.log(`Campaign ${campaignId} ${freshCampaign.status} — stopping batch`);
            return;
        }

        const batch = contacts.slice(i, i + BATCH_SIZE);

        const sendPromises = batch.map(async (contact) => {
            try {
                const existing = await EmailLog.findOne({ campaignId: campaign._id, contactId: contact._id });
                if (existing && existing.status !== 'failed') return;

                const variant = campaign.isABTest ? variantAssignments[contact._id.toString()] : null;
                const variantData = variant ? campaign.abVariants.find((v) => v.variantId === variant) : null;

                const subject = variantData?.subject || campaign.subject;
                let html = variantData?.htmlContent || campaign.htmlContent || '';

                let emailLog = await EmailLog.findOneAndUpdate(
                    { campaignId: campaign._id, contactId: contact._id },
                    {
                        $setOnInsert: {
                            userId: campaign.userId,
                            toEmail: contact.email,
                            subject,
                            fromEmail: campaign.fromEmail,
                            abVariant: variant,
                            trackingPixelId: uuidv4(),
                            status: 'queued',
                            queuedAt: new Date(),
                        },
                    },
                    { upsert: true, new: true }
                );

                const unsubscribeUrl = `${baseUrl}/api/track/unsubscribe?lid=${emailLog._id}`;

                html = personalize(html, contact, unsubscribeUrl);

                if (campaign.trackClicks) html = rewriteLinks(html, emailLog._id, baseUrl);
                if (campaign.trackOpens) html = injectOpenPixel(html, emailLog.trackingPixelId, baseUrl);

                const result = await sendSingleEmail({
                    to: contact.email,
                    subject,
                    html,
                    text: campaign.textContent || '',
                    fromEmail: campaign.fromEmail,
                    fromName: campaign.fromName,
                    replyTo: campaign.replyTo,
                    headers: {
                        unsubscribeHeader: `<${unsubscribeUrl}>`,
                        campaignId: campaign._id.toString(),
                    },
                });

                if (result.success) {
                    await EmailLog.findByIdAndUpdate(emailLog._id, {
                        status: 'sent',
                        provider: result.provider,
                        providerMessageId: result.messageId,
                        sentAt: new Date(),
                    });
                    sentCount++;
                    await Campaign.findByIdAndUpdate(campaignId, { $inc: { 'stats.sent': 1 } });
                } else {
                    await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'failed', error: result.error });
                    await Campaign.findByIdAndUpdate(campaignId, { $inc: { 'stats.failed': 1 } });
                }
            } catch (err) {
                console.error(`Error sending to contact ${contact._id}:`, err.message);
            }
        });

        await Promise.allSettled(sendPromises);

        // Throttle between batches
        if (i + BATCH_SIZE < contacts.length) {
            await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
    }

    await Campaign.findByIdAndUpdate(campaignId, { status: 'sent', sentAt: new Date() });
    console.log(`✅ Campaign ${campaignId} completed. Sent: ${sentCount}/${contacts.length}`);

    // Schedule A/B winner selection (delayed job in the in-memory queue)
    if (campaign.isABTest) {
        const delayMs = (campaign.abTestDurationHours || 4) * 60 * 60 * 1000;
        await emailQueue.add(
            'select-ab-winner',
            { campaignId: campaign._id.toString() },
            { delay: delayMs, jobId: `ab_winner_${campaign._id}` }
        );
    }
};

// ─── A/B Winner Selection ─────────────────────────────────────────────────────
const selectABWinner = async (campaignId) => {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign || !campaign.isABTest) return;

    const stats = await EmailLog.aggregate([
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

    const metric = campaign.abWinnerMetric || 'open_rate';
    let winner = null;
    let bestScore = -1;

    for (const s of stats) {
        const score =
            metric === 'click_rate'
                ? s.sent > 0 ? s.clicked / s.sent : 0
                : s.sent > 0 ? s.opened / s.sent : 0;

        if (score > bestScore) {
            bestScore = score;
            winner = s._id;
        }
    }

    await Campaign.findByIdAndUpdate(campaignId, { abWinnerVariant: winner });
    console.log(`🏆 A/B Test winner for campaign ${campaignId}: Variant ${winner}`);
};

// ─── Spam content scanner (basic) ─────────────────────────────────────────────
const spamCheck = (html, subject) => {
    const spamWords = ['FREE', 'WINNER', 'CLICK HERE', 'BUY NOW', 'LIMITED TIME', 'ACT NOW', 'GUARANTEED', 'NO RISK'];
    const issues = [];
    let score = 0;

    const combined = `${subject} ${html}`.toUpperCase();

    for (const word of spamWords) {
        if (combined.includes(word)) {
            issues.push(`Spam trigger word: "${word}"`);
            score += 1;
        }
    }

    const capsRatio = (subject.match(/[A-Z]/g) || []).length / subject.length;
    if (capsRatio > 0.3) {
        issues.push('Subject line has too many capital letters');
        score += 2;
    }

    if (!html.toLowerCase().includes('unsubscribe')) {
        issues.push('Missing unsubscribe link — required by CAN-SPAM');
        score += 3;
    }

    const imgCount = (html.match(/<img/gi) || []).length;
    const textLength = html.replace(/<[^>]+>/g, '').length;
    if (imgCount > 3 && textLength < 200) {
        issues.push('Too many images with too little text — may trigger spam filters');
        score += 1;
    }

    return { score, issues, safe: score < 5 };
};

module.exports = { processCampaign, selectABWinner, sendSingleEmail, spamCheck };
