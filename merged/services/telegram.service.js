/**
 * telegram.service.js  —  AI-Powered Telegram Bot
 *
 * Covers ALL project modules:
 *   📧 Email Campaigns   — list, create, send, pause, resume, cancel, stats
 *   💬 WhatsApp          — templates, campaigns, send, analytics, opt-ins
 *   👥 Contacts          — list, add, delete, count, tags, segments
 *   📄 Templates         — list, preview, publish, delete
 *   📊 Analytics         — dashboard, engagement, best send time, devices
 *   🤖 Automations       — list, activate, pause, enroll contact
 *   🔔 Notifications     — list, mark read, unread count
 *   💳 Subscription      — current plan, cancel
 *   🏷  Coupons           — validate, list (admin)
 *   🔗 Referrals         — my code, stats
 */

const axios = require('axios');
const User = require('../models/User.model');
const Campaign = require('../models/Campaign.model');
const Contact = require('../models/Contact.model');
const EmailLog = require('../models/EmailLog.model');
const Template = require('../models/Template.model');
const Automation = require('../models/Automation.model');
const Notification = require('../models/Notification.model');
const Subscription = require('../models/Subscription.model');
const WhatsappTemplate = require('../models/WhatsappTemplate.model');
const WhatsappCampaign = require('../models/WhatsappCampaign.model');
const WhatsappMessage = require('../models/WhatsappMessage.model');
const WhatsappOptin = require('../models/WhatsappOptin.model');
const Coupon = require('../models/Coupon.model');
const Referral = require('../models/Referral.model');
const emailQueue = require('../jobs/emailQueue');

const TG_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const send = async (chatId, text, extra = {}) => {
    try {
        await axios.post(`${TG_API}/sendMessage`, {
            chat_id: chatId, text, parse_mode: 'Markdown', ...extra,
        });
    } catch (e) {
        console.error('[TG send]', e?.response?.data || e.message);
    }
};

const typing = (chatId) =>
    axios.post(`${TG_API}/sendChatAction`, { chat_id: chatId, action: 'typing' }).catch(() => { });

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '0%';

// ─── AI Intent Parser ─────────────────────────────────────────────────────────
const ASK_AI = async (msg, ctx) => {
    const prompt = `You are an AI assistant inside an Email + WhatsApp Marketing Platform bot on Telegram.
Parse user messages and return ONLY valid JSON (no markdown, no explanation).

Supported actions:
EMAIL CAMPAIGNS:
  list_email_campaigns | get_email_campaign | create_email_campaign |
  send_email_campaign | pause_email_campaign | resume_email_campaign |
  cancel_email_campaign | email_campaign_stats | schedule_email_campaign

WHATSAPP:
  list_wa_templates | wa_template_status | list_wa_campaigns |
  send_wa_campaign | wa_campaign_analytics | wa_optin_list |
  wa_optin | wa_optout

CONTACTS:
  list_contacts | add_contact | delete_contact | contact_count |
  list_tags | list_segments

TEMPLATES (Email):
  list_templates | preview_template | publish_template | delete_template

ANALYTICS:
  analytics_dashboard | engagement_timeline | best_send_time |
  device_breakdown

AUTOMATIONS:
  list_automations | activate_automation | pause_automation | automation_enrollments

NOTIFICATIONS:
  list_notifications | unread_count | mark_all_read

SUBSCRIPTION:
  my_subscription | cancel_subscription

COUPONS:
  validate_coupon | list_coupons

REFERRALS:
  my_referral_code | referral_stats

GENERAL:
  help | unknown

Response format:
{
  "action": "<one of above>",
  "params": {
    "name": "...",
    "id": "...",
    "email": "...",
    "phone": "...",
    "limit": 5,
    "code": "...",
    "contactId": "..."
  },
  "reply": "Short friendly message to show user (same language they used, Hinglish if they wrote in Hindi/Hinglish)"
}

User context: ${JSON.stringify(ctx)}
User message: ${msg}`;

    const r = await axios.post(
        `${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`,
        {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
        },
        { headers: { 'Content-Type': 'application/json' } }
    );

    const raw = r.data.candidates[0].content.parts[0].text
        .trim().replace(/```json|```/g, '').trim();
    try { return JSON.parse(raw); }
    catch { return { action: 'unknown', params: {}, reply: raw }; }
};

// ─── Action Handlers ──────────────────────────────────────────────────────────

const ACTIONS = {

    // ════════════════════════════════════════════════════════
    // EMAIL CAMPAIGNS
    // ════════════════════════════════════════════════════════

    list_email_campaigns: async (user, p, chatId) => {
        const camps = await Campaign.find({ userId: user._id, isDeleted: false })
            .sort({ createdAt: -1 }).limit(p.limit || 7)
            .select('name status scheduledAt createdAt');
        if (!camps.length) return send(chatId, '📭 Koi email campaign nahi mili. Dashboard se banao!');
        const list = camps.map((c, i) =>
            `${i + 1}. *${c.name}*\n   Status: \`${c.status}\`\n   ID: \`${c._id}\``
        ).join('\n\n');
        await send(chatId, `📧 *Email Campaigns (recent ${camps.length}):*\n\n${list}\n\n_"send campaign [name]" likhke bhejo_`);
    },

    get_email_campaign: async (user, p, chatId) => {
        const c = await Campaign.findOne({
            userId: user._id, isDeleted: false,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        }).select('name status subject fromEmail scheduledAt stats');
        if (!c) return send(chatId, `❌ Campaign nahi mili: *${p.name || p.id}*`);
        await send(chatId,
            `📧 *${c.name}*\nStatus: \`${c.status}\`\nSubject: ${c.subject}\nFrom: ${c.fromEmail}\n` +
            `Sent: ${fmt(c.stats?.sent)} | Opens: ${fmt(c.stats?.opens)} | Clicks: ${fmt(c.stats?.clicks)}`);
    },

    send_email_campaign: async (user, p, chatId) => {
        const c = await Campaign.findOne({
            userId: user._id, isDeleted: false,
            status: { $in: ['draft', 'scheduled', 'approved'] },
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ Draft/scheduled campaign nahi mili: *${p.name || p.id}*\n\nPehle "list campaigns" se check karo.`);
        await send(chatId, `🚀 *"${c.name}"* queue ho rahi hai...`);
        await emailQueue.add('send-campaign', { campaignId: c._id.toString(), userId: user._id.toString(), triggeredBy: 'telegram' });
        c.status = 'sending'; await c.save();
        await send(chatId, `✅ *Campaign Queued!*\nName: *${c.name}*\nStatus: \`sending\`\n\n_Complete hone pe notify karunga!_`);
    },

    pause_email_campaign: async (user, p, chatId) => {
        const c = await Campaign.findOne({
            userId: user._id, isDeleted: false,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ Campaign nahi mili.`);
        if (c.status !== 'sending') return send(chatId, `⚠️ Sirf *sending* campaign pause ho sakti hai. Current: \`${c.status}\``);
        c.status = 'paused'; await c.save();
        await send(chatId, `⏸ *"${c.name}"* pause ho gayi.`);
    },

    resume_email_campaign: async (user, p, chatId) => {
        const c = await Campaign.findOne({
            userId: user._id, isDeleted: false,
            status: 'paused',
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ Paused campaign nahi mili.`);
        await emailQueue.add('send-campaign', { campaignId: c._id.toString(), userId: user._id.toString(), triggeredBy: 'telegram_resume' });
        c.status = 'sending'; await c.save();
        await send(chatId, `▶️ *"${c.name}"* resume ho gayi. Emails phir se ja rahe hain!`);
    },

    cancel_email_campaign: async (user, p, chatId) => {
        const c = await Campaign.findOne({
            userId: user._id, isDeleted: false,
            status: { $in: ['draft', 'scheduled', 'paused'] },
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ Cancel karne layak campaign nahi mili.`);
        c.status = 'cancelled'; await c.save();
        await send(chatId, `🚫 *"${c.name}"* cancel ho gayi.`);
    },

    email_campaign_stats: async (user, p, chatId) => {
        const c = await Campaign.findOne({
            userId: user._id, isDeleted: false,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ Campaign nahi mili.`);
        const logs = await EmailLog.aggregate([
            { $match: { campaignId: c._id } },
            {
                $group: {
                    _id: '$status', count: { $sum: 1 },
                    opens: { $sum: { $cond: ['$openedAt', 1, 0] } },
                    clicks: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$clickEvents', []] } }, 0] }, 1, 0] } }
                }
            }
        ]);
        const s = { sent: 0, failed: 0, opened: 0, clicked: 0 };
        logs.forEach(l => { if (l._id === 'sent') { s.sent = l.count; s.opened = l.opens; s.clicked = l.clicks; } if (l._id === 'failed') s.failed = l.count; });
        await send(chatId,
            `📊 *Email Stats: "${c.name}"*\n\n` +
            `📤 Sent: *${fmt(s.sent)}*\n❌ Failed: *${fmt(s.failed)}*\n` +
            `👁 Opens: *${fmt(s.opened)}* (${pct(s.opened, s.sent)})\n` +
            `🖱 Clicks: *${fmt(s.clicked)}* (${pct(s.clicked, s.sent)})\n` +
            `📅 Status: \`${c.status}\``);
    },

    schedule_email_campaign: async (user, p, chatId) => {
        await send(chatId, `📅 Campaign scheduling abhi Telegram se direct support nahi karta (datetime parsing complex hai).\n\nDashboard pe jao: *Campaigns → Schedule*\n\nYa "send campaign [name]" se abhi bhejo!`);
    },

    // ════════════════════════════════════════════════════════
    // WHATSAPP
    // ════════════════════════════════════════════════════════

    list_wa_templates: async (user, p, chatId) => {
        const templates = await WhatsappTemplate.find({ tenantId: user._id })
            .sort({ createdAt: -1 }).limit(p.limit || 7)
            .select('name category status language');
        if (!templates.length) return send(chatId, '📭 Koi WhatsApp template nahi mila. Dashboard se banao!');
        const list = templates.map((t, i) =>
            `${i + 1}. *${t.name}*\n   Category: ${t.category} | Status: \`${t.status}\`\n   ID: \`${t._id}\``
        ).join('\n\n');
        await send(chatId, `💬 *WhatsApp Templates (${templates.length}):*\n\n${list}`);
    },

    wa_template_status: async (user, p, chatId) => {
        const t = await WhatsappTemplate.findOne({
            tenantId: user._id,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!t) return send(chatId, `❌ Template nahi mila.`);
        await send(chatId,
            `💬 *Template: "${t.name}"*\nCategory: ${t.category}\nLanguage: ${t.language}\n` +
            `Status: \`${t.status}\`\nMeta ID: \`${t.metaTemplateId || 'pending'}\``);
    },

    list_wa_campaigns: async (user, p, chatId) => {
        const camps = await WhatsappCampaign.find({ userId: user._id })
            .sort({ createdAt: -1 }).limit(p.limit || 7)
            .select('name status createdAt');
        if (!camps.length) return send(chatId, '📭 Koi WhatsApp campaign nahi mili.');
        const list = camps.map((c, i) =>
            `${i + 1}. *${c.name}* — \`${c.status}\`\n   ID: \`${c._id}\``
        ).join('\n\n');
        await send(chatId, `💬 *WhatsApp Campaigns:*\n\n${list}`);
    },

    send_wa_campaign: async (user, p, chatId) => {
        const c = await WhatsappCampaign.findOne({
            userId: user._id, status: { $in: ['draft', 'scheduled'] },
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ WhatsApp campaign nahi mili ya already sent hai: *${p.name || p.id}*`);
        // Use existing WhatsappService — import and call
        const WhatsappService = require('../services/whatsapp.service');
        try {
            await send(chatId, `🚀 *"${c.name}"* WhatsApp campaign bhej raha hoon...`);
            const result = await WhatsappService.sendCampaign(c._id.toString(), user._id.toString());
            await send(chatId,
                `✅ *WhatsApp Campaign Sent!*\nName: *${c.name}*\n` +
                `📤 Queued: *${fmt(result.queued || 0)}*\nFailed: *${fmt(result.failed || 0)}*`);
        } catch (err) {
            await send(chatId, `❌ WhatsApp campaign fail: ${err.message}`);
        }
    },

    wa_campaign_analytics: async (user, p, chatId) => {
        const c = await WhatsappCampaign.findOne({
            userId: user._id,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!c) return send(chatId, `❌ Campaign nahi mili.`);
        const msgs = await WhatsappMessage.aggregate([
            { $match: { campaignId: c._id } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        const s = { sent: 0, delivered: 0, read: 0, failed: 0 };
        msgs.forEach(m => { if (s[m._id] !== undefined) s[m._id] = m.count; });
        const total = s.sent + s.delivered + s.read + s.failed;
        await send(chatId,
            `📊 *WhatsApp Stats: "${c.name}"*\n\n` +
            `📤 Sent: *${fmt(s.sent)}*\n✅ Delivered: *${fmt(s.delivered)}* (${pct(s.delivered, total)})\n` +
            `👁 Read: *${fmt(s.read)}* (${pct(s.read, total)})\n❌ Failed: *${fmt(s.failed)}*`);
    },

    wa_optin_list: async (user, p, chatId) => {
        const optins = await WhatsappOptin.find({ userId: user._id, optedIn: true })
            .limit(p.limit || 10).select('phone optedInAt');
        await send(chatId,
            `💬 *WhatsApp Opt-ins: ${fmt(optins.length)}*\n\n` +
            (optins.length ? optins.map((o, i) => `${i + 1}. \`${o.phone}\``).join('\n') : 'Koi opt-in nahi.'));
    },

    wa_optin: async (user, p, chatId) => {
        if (!p.contactId || !p.phone) return send(chatId, `❌ Contact ID aur phone number chahiye.\nExample: "optin contact [id] phone [number]"`);
        const WhatsappService = require('../services/whatsapp.service');
        await WhatsappService.optIn(user._id, p.contactId, p.phone, 'telegram', '');
        await send(chatId, `✅ Contact \`${p.contactId}\` WhatsApp opt-in ho gaya (${p.phone})`);
    },

    wa_optout: async (user, p, chatId) => {
        if (!p.contactId) return send(chatId, `❌ Contact ID chahiye.`);
        const WhatsappService = require('../services/whatsapp.service');
        await WhatsappService.optOut(user._id, p.contactId);
        await send(chatId, `✅ Contact \`${p.contactId}\` WhatsApp opt-out ho gaya.`);
    },

    // ════════════════════════════════════════════════════════
    // CONTACTS
    // ════════════════════════════════════════════════════════

    contact_count: async (user, p, chatId) => {
        const [total, active, unsubbed] = await Promise.all([
            Contact.countDocuments({ userId: user._id, isDeleted: false }),
            Contact.countDocuments({ userId: user._id, isDeleted: false, status: 'active' }),
            Contact.countDocuments({ userId: user._id, isDeleted: false, status: 'unsubscribed' }),
        ]);
        await send(chatId,
            `👥 *Aapke Contacts:*\n\nTotal: *${fmt(total)}*\nActive: *${fmt(active)}*\nUnsubscribed: *${fmt(unsubbed)}*`);
    },

    list_contacts: async (user, p, chatId) => {
        const contacts = await Contact.find({ userId: user._id, isDeleted: false, status: 'active' })
            .sort({ createdAt: -1 }).limit(p.limit || 8)
            .select('email firstName lastName status');
        if (!contacts.length) return send(chatId, `📭 Koi active contact nahi.`);
        const list = contacts.map((c, i) =>
            `${i + 1}. ${c.firstName || ''} ${c.lastName || ''}\n   \`${c.email}\``
        ).join('\n\n');
        await send(chatId, `👥 *Recent Contacts:*\n\n${list}\n\n_Dashboard se full list dekho_`);
    },

    add_contact: async (user, p, chatId) => {
        if (!p.email) return send(chatId, `❌ Email chahiye.\nExample: "add contact john@example.com"`);
        const exists = await Contact.findOne({ userId: user._id, email: p.email });
        if (exists) return send(chatId, `⚠️ Contact already exists: \`${p.email}\``);
        const c = await Contact.create({
            userId: user._id, email: p.email,
            firstName: p.name?.split(' ')[0] || '', lastName: p.name?.split(' ')[1] || '', status: 'active'
        });
        await send(chatId, `✅ Contact add ho gaya!\nEmail: \`${c.email}\`\nID: \`${c._id}\``);
    },

    delete_contact: async (user, p, chatId) => {
        const c = await Contact.findOne({
            userId: user._id,
            $or: [{ _id: p.id }, { email: p.email }]
        });
        if (!c) return send(chatId, `❌ Contact nahi mila.`);
        c.isDeleted = true; await c.save();
        await send(chatId, `🗑 Contact \`${c.email}\` delete ho gaya.`);
    },

    list_tags: async (user, p, chatId) => {
        const tags = await Contact.distinct('tags', { userId: user._id, isDeleted: false });
        if (!tags.length) return send(chatId, `🏷 Koi tag nahi mila.`);
        await send(chatId, `🏷 *Tags (${tags.length}):*\n\n${tags.map(t => `• \`${t}\``).join('\n')}`);
    },

    list_segments: async (user, p, chatId) => {
        const Segment = require('../models/Segment.model');
        const segs = await Segment.find({ userId: user._id }).limit(10).select('name contactCount');
        if (!segs.length) return send(chatId, `📭 Koi segment nahi.`);
        const list = segs.map((s, i) => `${i + 1}. *${s.name}* — ${fmt(s.contactCount)} contacts`).join('\n');
        await send(chatId, `📋 *Segments:*\n\n${list}`);
    },

    // ════════════════════════════════════════════════════════
    // EMAIL TEMPLATES
    // ════════════════════════════════════════════════════════

    list_templates: async (user, p, chatId) => {
        const templates = await Template.find({ userId: user._id, isDeleted: false })
            .sort({ createdAt: -1 }).limit(p.limit || 7)
            .select('name category status');
        if (!templates.length) return send(chatId, `📭 Koi email template nahi.`);
        const list = templates.map((t, i) =>
            `${i + 1}. *${t.name}* — \`${t.status}\`\n   ID: \`${t._id}\``
        ).join('\n\n');
        await send(chatId, `📄 *Email Templates:*\n\n${list}`);
    },

    preview_template: async (user, p, chatId) => {
        const t = await Template.findOne({
            userId: user._id, isDeleted: false,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        }).select('name subject htmlContent');
        if (!t) return send(chatId, `❌ Template nahi mila.`);
        const preview = t.htmlContent ? t.htmlContent.replace(/<[^>]+>/g, '').slice(0, 300) + '...' : '(no content)';
        await send(chatId, `📄 *"${t.name}"*\nSubject: ${t.subject || 'N/A'}\n\n*Preview:*\n${preview}`);
    },

    publish_template: async (user, p, chatId) => {
        const t = await Template.findOne({
            userId: user._id, isDeleted: false,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!t) return send(chatId, `❌ Template nahi mila.`);
        t.status = 'published'; t.publishedAt = new Date(); await t.save();
        await send(chatId, `✅ Template *"${t.name}"* publish ho gaya!`);
    },

    delete_template: async (user, p, chatId) => {
        const t = await Template.findOne({
            userId: user._id, isDeleted: false,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!t) return send(chatId, `❌ Template nahi mila.`);
        t.isDeleted = true; await t.save();
        await send(chatId, `🗑 Template *"${t.name}"* delete ho gaya.`);
    },

    // ════════════════════════════════════════════════════════
    // ANALYTICS
    // ════════════════════════════════════════════════════════

    analytics_dashboard: async (user, p, chatId) => {
        const [totalCamps, sentCamps, totalContacts] = await Promise.all([
            Campaign.countDocuments({ userId: user._id, isDeleted: false }),
            Campaign.countDocuments({ userId: user._id, isDeleted: false, status: 'sent' }),
            Contact.countDocuments({ userId: user._id, isDeleted: false, status: 'active' }),
        ]);
        const emailStats = await EmailLog.aggregate([
            { $match: { userId: user._id } },
            {
                $group: {
                    _id: null, total: { $sum: 1 },
                    opens: { $sum: { $cond: ['$openedAt', 1, 0] } },
                    clicks: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$clickEvents', []] } }, 0] }, 1, 0] } }
                }
            }
        ]);
        const es = emailStats[0] || { total: 0, opens: 0, clicks: 0 };
        await send(chatId,
            `📊 *Analytics Dashboard*\n\n` +
            `📧 Email Campaigns: *${totalCamps}* (${sentCamps} sent)\n` +
            `👥 Active Contacts: *${fmt(totalContacts)}*\n\n` +
            `📤 Total Emails Sent: *${fmt(es.total)}*\n` +
            `👁 Total Opens: *${fmt(es.opens)}* (${pct(es.opens, es.total)})\n` +
            `🖱 Total Clicks: *${fmt(es.clicks)}* (${pct(es.clicks, es.total)})`);
    },

    engagement_timeline: async (user, p, chatId) => {
        const days = 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const data = await EmailLog.aggregate([
            { $match: { userId: user._id, sentAt: { $gte: since } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
                    sent: { $sum: 1 }, opens: { $sum: { $cond: ['$openedAt', 1, 0] } }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        if (!data.length) return send(chatId, `📊 Last ${days} days mein koi email activity nahi.`);
        const lines = data.map(d => `• ${d._id}: ${fmt(d.sent)} sent, ${fmt(d.opens)} opens`).join('\n');
        await send(chatId, `📈 *Last ${days} Days Engagement:*\n\n${lines}`);
    },

    best_send_time: async (user, p, chatId) => {
        const data = await EmailLog.aggregate([
            { $match: { userId: user._id, openedAt: { $exists: true } } },
            { $group: { _id: { $hour: '$openedAt' }, opens: { $sum: 1 } } },
            { $sort: { opens: -1 } }, { $limit: 3 }
        ]);
        if (!data.length) return send(chatId, `📊 Abhi tak sufficient data nahi best time ke liye.`);
        const top = data.map((d, i) => `${i + 1}. ${d._id}:00 - ${d._id + 1}:00 → *${d.opens} opens*`).join('\n');
        await send(chatId, `⏰ *Best Email Send Times:*\n\n${top}\n\n_In hours pe campaigns schedule karo for max opens!_`);
    },

    device_breakdown: async (user, p, chatId) => {
        const data = await EmailLog.aggregate([
            { $match: { userId: user._id, 'openMeta.device': { $exists: true } } },
            { $group: { _id: '$openMeta.device', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        if (!data.length) return send(chatId, `📱 Abhi device data available nahi.`);
        const total = data.reduce((a, d) => a + d.count, 0);
        const lines = data.map(d => `• ${d._id || 'Unknown'}: *${fmt(d.count)}* (${pct(d.count, total)})`).join('\n');
        await send(chatId, `📱 *Device Breakdown:*\n\n${lines}`);
    },

    // ════════════════════════════════════════════════════════
    // AUTOMATIONS
    // ════════════════════════════════════════════════════════

    list_automations: async (user, p, chatId) => {
        const autos = await Automation.find({ userId: user._id })
            .sort({ createdAt: -1 }).limit(7).select('name status trigger enrolledCount');
        if (!autos.length) return send(chatId, `🤖 Koi automation nahi. Dashboard se banao!`);
        const list = autos.map((a, i) =>
            `${i + 1}. *${a.name}*\n   Status: \`${a.status}\` | Enrolled: ${fmt(a.enrolledCount)}\n   ID: \`${a._id}\``
        ).join('\n\n');
        await send(chatId, `🤖 *Automations:*\n\n${list}`);
    },

    activate_automation: async (user, p, chatId) => {
        const a = await Automation.findOne({
            userId: user._id,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!a) return send(chatId, `❌ Automation nahi mili.`);
        a.status = 'active'; await a.save();
        await send(chatId, `✅ Automation *"${a.name}"* activate ho gayi!`);
    },

    pause_automation: async (user, p, chatId) => {
        const a = await Automation.findOne({
            userId: user._id,
            $or: [{ _id: p.id }, { name: { $regex: p.name || '', $options: 'i' } }]
        });
        if (!a) return send(chatId, `❌ Automation nahi mili.`);
        a.status = 'paused'; await a.save();
        await send(chatId, `⏸ Automation *"${a.name}"* pause ho gayi.`);
    },

    automation_enrollments: async (user, p, chatId) => {
        await send(chatId, `📋 Automation enrollments dashboard pe detailed view milega.\n\nKisi specific automation ke stats ke liye uska naam do.`);
    },

    // ════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ════════════════════════════════════════════════════════

    list_notifications: async (user, p, chatId) => {
        const notifs = await Notification.find({ userId: user._id })
            .sort({ createdAt: -1 }).limit(p.limit || 5)
            .select('title message isRead createdAt');
        if (!notifs.length) return send(chatId, `🔔 Koi notification nahi.`);
        const list = notifs.map((n, i) =>
            `${n.isRead ? '○' : '🔵'} *${n.title}*\n   ${n.message?.slice(0, 60)}...`
        ).join('\n\n');
        await send(chatId, `🔔 *Notifications:*\n\n${list}`);
    },

    unread_count: async (user, p, chatId) => {
        const count = await Notification.countDocuments({ userId: user._id, isRead: false });
        await send(chatId, count > 0
            ? `🔵 *${count} unread notifications* hain.\n\n"list notifications" likhke dekho.`
            : `✅ Koi unread notification nahi!`);
    },

    mark_all_read: async (user, p, chatId) => {
        await Notification.updateMany({ userId: user._id, isRead: false }, { isRead: true });
        await send(chatId, `✅ Saari notifications read mark ho gayi!`);
    },

    // ════════════════════════════════════════════════════════
    // SUBSCRIPTION
    // ════════════════════════════════════════════════════════

    my_subscription: async (user, p, chatId) => {
        const sub = await Subscription.findOne({ userId: user._id }).sort({ createdAt: -1 })
            .populate('planId', 'name price emailsPerMonth');
        if (!sub) return send(chatId, `💳 Koi active subscription nahi.\nDashboard pe plans dekho!`);
        await send(chatId,
            `💳 *My Subscription:*\n\nPlan: *${sub.planId?.name || 'N/A'}*\n` +
            `Price: ₹${sub.planId?.price || 0}/month\n` +
            `Emails/month: *${fmt(sub.planId?.emailsPerMonth)}*\n` +
            `Status: \`${sub.status}\`\n` +
            `Renews: ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toDateString() : 'N/A'}`);
    },

    cancel_subscription: async (user, p, chatId) => {
        await send(chatId,
            `⚠️ Subscription cancel karna ek important action hai.\n\n` +
            `Please dashboard pe jao: *Billing → Cancel Plan*\n\n` +
            `_Safety ke liye yeh Telegram se directly nahi hota._`);
    },

    // ════════════════════════════════════════════════════════
    // COUPONS
    // ════════════════════════════════════════════════════════

    validate_coupon: async (user, p, chatId) => {
        if (!p.code) return send(chatId, `❌ Coupon code chahiye.\nExample: "validate coupon SAVE20"`);
        const coupon = await Coupon.findOne({ code: p.code.toUpperCase(), isActive: true });
        if (!coupon) return send(chatId, `❌ Coupon *${p.code}* valid nahi ya expired hai.`);
        const now = new Date();
        if (coupon.expiresAt && coupon.expiresAt < now)
            return send(chatId, `❌ Coupon *${p.code}* expire ho gaya (${coupon.expiresAt.toDateString()}).`);
        await send(chatId,
            `✅ *Coupon Valid!*\n\nCode: \`${coupon.code}\`\nDiscount: *${coupon.discount}${coupon.type === 'percent' ? '%' : '₹'}*\n` +
            `Valid till: ${coupon.expiresAt ? coupon.expiresAt.toDateString() : 'No expiry'}`);
    },

    list_coupons: async (user, p, chatId) => {
        if (!['super_admin', 'business_admin'].includes(user.role))
            return send(chatId, `❌ Coupons list sirf admin dekh sakte hain.`);
        const coupons = await Coupon.find({ isActive: true }).limit(10).select('code discount type expiresAt');
        if (!coupons.length) return send(chatId, `📭 Koi active coupon nahi.`);
        const list = coupons.map((c, i) =>
            `${i + 1}. \`${c.code}\` — ${c.discount}${c.type === 'percent' ? '%' : '₹'} off`
        ).join('\n');
        await send(chatId, `🏷 *Active Coupons:*\n\n${list}`);
    },

    // ════════════════════════════════════════════════════════
    // REFERRALS
    // ════════════════════════════════════════════════════════

    my_referral_code: async (user, p, chatId) => {
        const ref = await Referral.findOne({ userId: user._id }).select('code totalReferred totalEarned');
        if (!ref) return send(chatId, `🔗 Referral code abhi generate nahi hua. Dashboard pe jao!`);
        await send(chatId,
            `🔗 *Mera Referral Code:*\n\n\`${ref.code}\`\n\n` +
            `Total Referred: *${fmt(ref.totalReferred)}*\nTotal Earned: *₹${fmt(ref.totalEarned)}*\n\n` +
            `_Share karo aur earn karo! 💰_`);
    },

    referral_stats: async (user, p, chatId) => {
        const ref = await Referral.findOne({ userId: user._id });
        if (!ref) return send(chatId, `🔗 Koi referral data nahi.`);
        await send(chatId,
            `📊 *Referral Stats:*\n\nCode: \`${ref.code}\`\n` +
            `Referred Users: *${fmt(ref.totalReferred)}*\n` +
            `Pending Rewards: *₹${fmt(ref.pendingEarned || 0)}*\n` +
            `Total Earned: *₹${fmt(ref.totalEarned || 0)}*`);
    },

    // ════════════════════════════════════════════════════════
    // HELP
    // ════════════════════════════════════════════════════════

    help: async (user, p, chatId) => {
        await send(chatId,
            `🤖 *AI Marketing Bot — Full Commands*\n\n` +
            `📧 *Email Campaigns:*\n` +
            `• \`list campaigns\`\n• \`send campaign [name]\`\n• \`pause/resume/cancel campaign [name]\`\n• \`stats for [campaign name]\`\n\n` +
            `💬 *WhatsApp:*\n` +
            `• \`list wa templates\`\n• \`list wa campaigns\`\n• \`send wa campaign [name]\`\n• \`wa analytics [name]\`\n• \`wa optins\`\n\n` +
            `👥 *Contacts:*\n` +
            `• \`contact count\`\n• \`list contacts\`\n• \`add contact [email]\`\n• \`list tags\`\n• \`list segments\`\n\n` +
            `📄 *Templates:*\n` +
            `• \`list templates\`\n• \`preview template [name]\`\n• \`publish template [name]\`\n\n` +
            `📊 *Analytics:*\n` +
            `• \`dashboard\`\n• \`engagement timeline\`\n• \`best send time\`\n• \`device breakdown\`\n\n` +
            `🤖 *Automations:*\n` +
            `• \`list automations\`\n• \`activate automation [name]\`\n• \`pause automation [name]\`\n\n` +
            `🔔 *More:*\n` +
            `• \`notifications\`\n• \`unread count\`\n• \`my plan\`\n• \`referral code\`\n• \`validate coupon [code]\`\n\n` +
            `_Natural language mein bhi likh sakte ho! 🧠_`);
    },

    unknown: async (user, p, chatId) => {
        await send(chatId, p.reply || `🤔 Samjha nahi. *"help"* type karo full command list ke liye.`);
    },
};

// ─── Main Webhook Handler ─────────────────────────────────────────────────────
const handleWebhook = async (req, res) => {
    res.sendStatus(200); // always ack Telegram immediately

    const update = req.body;
    if (!update.message) return;

    const { message } = update;
    const chatId = message.chat.id;
    const text = message.text?.trim();
    const telegramUserId = message.from.id;

    if (!text) return;

    // ── /start [token] — account linking ─────────────────────────────────────
    if (text.startsWith('/start')) {
        const token = text.split(' ')[1];
        if (!token) {
            return send(chatId,
                `👋 *Welcome to AI Marketing Bot!*\n\n` +
                `Apna account link karne ke liye:\n` +
                `1. Dashboard → Settings → Telegram\n` +
                `2. "Generate Link Token" click karo\n` +
                `3. Us link ko Telegram pe open karo\n\n` +
                `_Ek baar link hone ke baad sab Telegram se!_ 🚀`);
        }
        const user = await User.findOne({ telegramLinkToken: token });
        if (!user) return send(chatId, `❌ Invalid ya expired token.\nDashboard se naya token generate karo.`);
        user.telegramChatId = chatId.toString();
        user.telegramUserId = telegramUserId.toString();
        user.telegramLinked = true;
        user.telegramLinkToken = undefined;
        await user.save();
        return send(chatId,
            `✅ *Account Link Ho Gaya!*\n\n👤 *${user.name}*\n📧 ${user.email}\n\n` +
            `Ab Telegram se hi sab manage karo! "help" type karo 🚀`);
    }

    // ── Auth check ────────────────────────────────────────────────────────────
    const user = await User.findOne({ telegramChatId: chatId.toString(), telegramLinked: true });
    if (!user) {
        return send(chatId,
            `🔗 *Account link nahi hai.*\n\nDashboard → Settings → Telegram se link karo.`);
    }

    await typing(chatId);

    // Build compact context for AI
    const recentCamps = await Campaign.find({ userId: user._id, isDeleted: false })
        .sort({ createdAt: -1 }).limit(5).select('name status _id');
    const ctx = {
        userName: user.name, plan: user.plan || 'free', role: user.role,
        recentEmailCampaigns: recentCamps.map(c => ({ id: c._id, name: c.name, status: c.status })),
    };

    // Ask AI
    let ai;
    try {
        ai = await ASK_AI(text, ctx);
    } catch (err) {
        console.error('[TG AI error]', err?.response?.data || err.message);
        return send(chatId, `⚠️ AI se connect nahi ho pa raha. Thodi der baad try karo.`);
    }

    // Execute
    const handler = ACTIONS[ai.action] || ACTIONS.unknown;
    try {
        await handler(user, ai.params || {}, chatId);
    } catch (err) {
        console.error(`[TG action ${ai.action}]`, err.message);
        await send(chatId, `❌ Error: ${err.message}\n\nDashboard pe check karo.`);
    }
};

// ─── Campaign completion notifier ─────────────────────────────────────────────
const notifyCampaignComplete = async (userId, campaignName, result) => {
    const user = await User.findById(userId).select('telegramLinked telegramChatId');
    if (!user?.telegramLinked || !user?.telegramChatId) return;
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? 'Successfully Sent!' : 'Send Failed!';
    await send(user.telegramChatId,
        `${icon} *Email Campaign ${status}*\n\n` +
        `📧 *${campaignName}*\n` +
        `📤 Sent: *${fmt(result.sent || 0)}*  ❌ Failed: *${fmt(result.failed || 0)}*` +
        (result.error ? `\n\nError: \`${result.error}\`` : ''));
};

const notifyWaCampaignComplete = async (userId, campaignName, result) => {
    const user = await User.findById(userId).select('telegramLinked telegramChatId');
    if (!user?.telegramLinked || !user?.telegramChatId) return;
    await send(user.telegramChatId,
        `${result.success ? '✅' : '❌'} *WhatsApp Campaign ${result.success ? 'Sent!' : 'Failed!'}*\n\n` +
        `💬 *${campaignName}*\n` +
        `📤 Queued: *${fmt(result.queued || 0)}*  ❌ Failed: *${fmt(result.failed || 0)}*`);
};

// ─── Register webhook with Telegram ──────────────────────────────────────────
const registerWebhook = async () => {
    const url = `${process.env.APP_BASE_URL}/api/telegram/webhook`;
    try {
        const r = await axios.post(`${TG_API}/setWebhook`, {
            url,
            secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
        });
        console.log('✅ Telegram webhook registered:', r.data.description);
    } catch (err) {
        console.error('❌ Telegram webhook failed:', err?.response?.data || err.message);
    }
};

module.exports = { handleWebhook, notifyCampaignComplete, notifyWaCampaignComplete, registerWebhook, send };