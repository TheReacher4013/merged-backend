const axios              = require('axios');
const WhatsappTemplate   = require('../models/WhatsappTemplate.model');
const WhatsappCampaign   = require('../models/WhatsappCampaign.model');
const WhatsappMessage    = require('../models/WhatsappMessage.model');
const WhatsappOptin      = require('../models/WhatsappOptin.model');

const WA_API_URL   = process.env.WHATSAPP_API_URL;
const PHONE_NUM_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

class WhatsappService {
  // ─── Template Management ─────────────────────────────────────────────────

  static async createTemplate(tenantId, data) {
    const template = await WhatsappTemplate.create({ tenantId, ...data });
    // Submit to Meta for approval
    try {
      const payload = {
        name:       data.name,
        category:   data.category,
        language:   data.language || 'en',
        components: this._buildMetaComponents(data.components),
      };
      const res = await axios.post(
        `${WA_API_URL}/${PHONE_NUM_ID}/message_templates`,
        payload,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );
      template.metaTemplateId = res.data.id;
      await template.save();
    } catch (err) {
      console.error('[WhatsApp] Template submission failed:', err.response?.data || err.message);
    }
    return template;
  }

  static async getTemplates(tenantId) {
    return WhatsappTemplate.find({ tenantId }).sort({ createdAt: -1 }).lean();
  }

  static async getTemplateStatus(templateId) {
    const template = await WhatsappTemplate.findById(templateId).lean();
    if (!template?.metaTemplateId) return template;

    try {
      const res = await axios.get(
        `${WA_API_URL}/${template.metaTemplateId}`,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );
      const metaStatus = res.data.status?.toLowerCase();
      if (metaStatus !== template.status) {
        await WhatsappTemplate.findByIdAndUpdate(templateId, { status: metaStatus });
        template.status = metaStatus;
      }
    } catch (err) {
      console.error('[WhatsApp] Status poll failed:', err.message);
    }
    return template;
  }

  // ─── Campaign Management ─────────────────────────────────────────────────

  static async createCampaign(tenantId, data) {
    return WhatsappCampaign.create({ tenantId, ...data });
  }

  static async getCampaigns(tenantId, { page = 1, limit = 20 } = {}) {
    const [data, total] = await Promise.all([
      WhatsappCampaign.find({ tenantId })
        .populate('templateId', 'name category')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      WhatsappCampaign.countDocuments({ tenantId }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  /**
   * Send a campaign immediately — filters opted-in contacts, queues messages
   */
  static async sendCampaign(campaignId, tenantId) {
    const campaign = await WhatsappCampaign.findOne({ _id: campaignId, tenantId })
      .populate('templateId')
      .lean();
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.status !== 'scheduled' && campaign.status !== 'draft') {
      throw new Error('Campaign already sent or in progress');
    }

    // Get opted-in contacts for tenant
    const optins = await WhatsappOptin.find({ tenantId, status: 'opted_in' }).lean();

    await WhatsappCampaign.findByIdAndUpdate(campaignId, {
      status:           'sending',
      totalRecipients:  optins.length,
      sentAt:           new Date(),
      'stats.queued':   optins.length,
    });

    // Queue messages (in production use BullMQ)
    for (const optin of optins) {
      const msg = await WhatsappMessage.create({
        campaignId,
        contactId:  optin.contactId,
        tenantId,
        phone:      optin.phone,
        status:     'queued',
      });
      // whatsappQueue.add({ messageId: msg._id, ... })
      // For demo: send directly
      await this._sendMessage(msg._id, campaign.templateId, optin.phone, campaign.templateVariables);
    }

    await WhatsappCampaign.findByIdAndUpdate(campaignId, { status: 'sent' });
    return { sent: optins.length };
  }

  /**
   * Send a single WhatsApp message via Meta API
   */
  static async _sendMessage(messageId, template, phone, variables = {}) {
    try {
      const body = {
        messaging_product: 'whatsapp',
        to:    phone,
        type:  'template',
        template: {
          name:     template.name,
          language: { code: template.language || 'en' },
          components: this._buildSendComponents(template.components, variables),
        },
      };

      const res = await axios.post(
        `${WA_API_URL}/${PHONE_NUM_ID}/messages`,
        body,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );

      const wamid = res.data.messages?.[0]?.id;
      await WhatsappMessage.findByIdAndUpdate(messageId, {
        wamid,
        status: 'sent',
        sentAt: new Date(),
      });
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      await WhatsappMessage.findByIdAndUpdate(messageId, {
        status:       'failed',
        errorMessage: errMsg,
      });
    }
  }

  // ─── Webhook Handler (delivery + read receipts) ──────────────────────────

  static async handleWebhook(body) {
    const entry = body.entry?.[0];
    if (!entry) return;

    for (const change of (entry.changes || [])) {
      const value = change.value;

      // Delivery/read status updates
      for (const status of (value.statuses || [])) {
        const { id: wamid, status: wStatus, timestamp } = status;
        const update = {};

        if (wStatus === 'delivered') {
          update.status      = 'delivered';
          update.deliveredAt = new Date(timestamp * 1000);
        } else if (wStatus === 'read') {
          update.status = 'read';
          update.readAt = new Date(timestamp * 1000);
        } else if (wStatus === 'failed') {
          update.status = 'failed';
          update.errorCode = status.errors?.[0]?.code;
          update.errorMessage = status.errors?.[0]?.message;
        }

        if (Object.keys(update).length) {
          await WhatsappMessage.findOneAndUpdate({ wamid }, update);
          // Update campaign stats
          const msg = await WhatsappMessage.findOne({ wamid }).lean();
          if (msg) {
            const statKey = update.status === 'delivered' ? 'delivered' : update.status === 'read' ? 'read' : 'failed';
            await WhatsappCampaign.findByIdAndUpdate(msg.campaignId, {
              $inc: { [`stats.${statKey}`]: 1 },
            });
          }
        }
      }

      // Incoming messages (replies & opt-out)
      for (const message of (value.messages || [])) {
        const { from: phone, text, type, id: wamid } = message;
        const replyText = text?.body || '';

        // Check for STOP / opt-out keywords
        if (['stop','unsubscribe','optout','opt out'].includes(replyText.toLowerCase().trim())) {
          await WhatsappOptin.findOneAndUpdate(
            { phone: `+${phone}` },
            { status: 'opted_out', optedOutAt: new Date() }
          );
          // Increment opt-out in related campaign
          const relatedMsg = await WhatsappMessage.findOne({ phone: `+${phone}` }).sort({ createdAt: -1 }).lean();
          if (relatedMsg) {
            await WhatsappCampaign.findByIdAndUpdate(relatedMsg.campaignId, { $inc: { 'stats.optedOut': 1 } });
          }
        } else {
          // Save reply
          await WhatsappMessage.findOneAndUpdate(
            { phone: `+${phone}`, status: { $in: ['sent','delivered','read'] } },
            { status: 'replied', repliedAt: new Date(), replyText },
            { sort: { createdAt: -1 } }
          );
        }
      }
    }
  }

  // ─── Opt-in / Opt-out ────────────────────────────────────────────────────

  static async optIn(tenantId, contactId, phone, source = 'manual', ipAddress = null) {
    return WhatsappOptin.findOneAndUpdate(
      { tenantId, phone },
      { contactId, status: 'opted_in', consentSource: source, consentedAt: new Date(), ipAddress },
      { upsert: true, new: true }
    );
  }

  static async optOut(tenantId, contactId) {
    return WhatsappOptin.findOneAndUpdate(
      { tenantId, contactId },
      { status: 'opted_out', optedOutAt: new Date() },
      { new: true }
    );
  }

  static async getOptins(tenantId, { page = 1, limit = 20 } = {}) {
    const [data, total] = await Promise.all([
      WhatsappOptin.find({ tenantId, status: 'opted_in' })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      WhatsappOptin.countDocuments({ tenantId, status: 'opted_in' }),
    ]);
    return { data, total };
  }

  static async getCampaignAnalytics(campaignId) {
    const campaign = await WhatsappCampaign.findById(campaignId).lean();
    if (!campaign) throw new Error('Campaign not found');

    const { stats, totalRecipients } = campaign;
    const calcRate = (n) => totalRecipients ? ((n / totalRecipients) * 100).toFixed(2) + '%' : '0%';

    return {
      campaign:     campaign.name,
      status:       campaign.status,
      sentAt:       campaign.sentAt,
      totalRecipients,
      stats,
      rates: {
        deliveryRate: calcRate(stats.delivered),
        readRate:     calcRate(stats.read),
        replyRate:    calcRate(stats.replied),
        failedRate:   calcRate(stats.failed),
        optOutRate:   calcRate(stats.optedOut),
      },
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  static _buildMetaComponents(components) {
    const result = [];
    if (components.header?.type) {
      result.push({ type: 'HEADER', format: components.header.type, text: components.header.text });
    }
    if (components.body) {
      result.push({ type: 'BODY', text: components.body });
    }
    if (components.footer) {
      result.push({ type: 'FOOTER', text: components.footer });
    }
    if (components.buttons?.length) {
      result.push({ type: 'BUTTONS', buttons: components.buttons });
    }
    return result;
  }

  static _buildSendComponents(components, variables) {
    const result = [];
    const bodyParams = Object.values(variables).map(v => ({ type: 'text', text: String(v) }));
    if (bodyParams.length) {
      result.push({ type: 'body', parameters: bodyParams });
    }
    return result;
  }
}

module.exports = WhatsappService;
