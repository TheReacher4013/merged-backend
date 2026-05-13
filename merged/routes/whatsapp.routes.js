const router = require('express').Router();
const ctrl   = require('../controllers/whatsapp.controller');
const { protect: auth } = require('../middleware/auth.middleware');

// Meta webhook verification — public (no auth)
router.get('/webhook',  ctrl.verifyWebhook);
router.post('/webhook', ctrl.handleWebhook);

router.use(auth);

// Templates
router.get('/templates',               ctrl.getTemplates);
router.post('/templates',              ctrl.createTemplate);
router.get('/templates/:id/status',    ctrl.getTemplateStatus);

// Campaigns
router.post('/campaigns',              ctrl.createCampaign);
router.get('/campaigns',               ctrl.getCampaigns);
router.post('/campaigns/:id/send-now', ctrl.sendNow);
router.get('/campaigns/:id/analytics', ctrl.getCampaignAnalytics);

// Opt-in / Opt-out
router.get('/optins',                           ctrl.getOptins);
router.post('/optins/:contactId/optin',         ctrl.optIn);
router.post('/optins/:contactId/optout',        ctrl.optOut);

module.exports = router;
