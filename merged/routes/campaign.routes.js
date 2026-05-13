// ─────────────────────────────────────────────────────────────────────────────
// routes/campaign.routes.js
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const campaignRouter = express.Router();
const { body } = require('express-validator');
const {
    getCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
    submitForApproval, approveCampaign, scheduleCampaign,
    sendNow, pauseCampaign, resumeCampaign, cancelCampaign, getCampaignAnalytics,
} = require('../controllers/campaign.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

campaignRouter.use(protect);

campaignRouter.get('/', getCampaigns);
campaignRouter.get('/:id', getCampaign);
campaignRouter.get('/:id/analytics', getCampaignAnalytics);

campaignRouter.post('/', [
    body('name').trim().notEmpty().withMessage('Campaign name is required'),
    body('subject').trim().notEmpty().withMessage('Subject line is required'),
], createCampaign);

campaignRouter.put('/:id', updateCampaign);
campaignRouter.delete('/:id', deleteCampaign);

// ─── Status transitions ───────────────────────────────────────────────────────
campaignRouter.post('/:id/submit', submitForApproval);
campaignRouter.post('/:id/approve', authorize('super_admin', 'business_admin'), approveCampaign);
campaignRouter.post('/:id/schedule', [body('scheduledAt').isISO8601().withMessage('Valid date required')], scheduleCampaign);
campaignRouter.post('/:id/send-now', sendNow);
campaignRouter.post('/:id/pause', pauseCampaign);
campaignRouter.post('/:id/resume', resumeCampaign);
campaignRouter.post('/:id/cancel', cancelCampaign);

module.exports = campaignRouter;