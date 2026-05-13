const WhatsappService = require('../services/whatsapp.service');

// ─── Templates ───────────────────────────────────────────────────────────────

// GET /api/whatsapp/templates
exports.getTemplates = async (req, res) => {
  try {
    const templates = await WhatsappService.getTemplates(req.user._id);
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/whatsapp/templates
exports.createTemplate = async (req, res) => {
  try {
    const template = await WhatsappService.createTemplate(req.user._id, req.body);
    res.status(201).json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/whatsapp/templates/:id/status
exports.getTemplateStatus = async (req, res) => {
  try {
    const template = await WhatsappService.getTemplateStatus(req.params.id);
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Campaigns ───────────────────────────────────────────────────────────────

// POST /api/whatsapp/campaigns
exports.createCampaign = async (req, res) => {
  try {
    const campaign = await WhatsappService.createCampaign(req.user._id, req.body);
    res.status(201).json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/whatsapp/campaigns
exports.getCampaigns = async (req, res) => {
  try {
    const result = await WhatsappService.getCampaigns(req.user._id, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/whatsapp/campaigns/:id/send-now
exports.sendNow = async (req, res) => {
  try {
    const result = await WhatsappService.sendCampaign(req.params.id, req.user._id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/whatsapp/campaigns/:id/analytics
exports.getCampaignAnalytics = async (req, res) => {
  try {
    const analytics = await WhatsappService.getCampaignAnalytics(req.params.id);
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Webhook ─────────────────────────────────────────────────────────────────

// GET /api/whatsapp/webhook  — Meta verification handshake
exports.verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
};

// POST /api/whatsapp/webhook  — Meta delivery events
exports.handleWebhook = async (req, res) => {
  try {
    await WhatsappService.handleWebhook(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('[WhatsApp Webhook]', err.message);
    res.sendStatus(500);
  }
};

// ─── Opt-in / Opt-out ────────────────────────────────────────────────────────

// GET /api/whatsapp/optins
exports.getOptins = async (req, res) => {
  try {
    const result = await WhatsappService.getOptins(req.user._id, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/whatsapp/optins/:contactId/optin
exports.optIn = async (req, res) => {
  try {
    const { phone, source } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'phone required' });
    const result = await WhatsappService.optIn(req.user._id, req.params.contactId, phone, source, req.ip);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/whatsapp/optins/:contactId/optout
exports.optOut = async (req, res) => {
  try {
    const result = await WhatsappService.optOut(req.user._id, req.params.contactId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
