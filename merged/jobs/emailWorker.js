/**
 * emailWorker.js — Wire job processors to the in-memory queue
 *
 * Previously this file bootstrapped a Bull worker process.
 * Now the same processors run inside the main server process
 * using the InMemoryQueue. Call initWorkers() once after
 * MongoDB is connected (done in server.js).
 */

const emailQueue = require('./emailQueue');

const initWorkers = () => {
    const { processCampaign, selectABWinner, sendSingleEmail } = require('../services/emailEngine.service');
    const { processEnrollmentStep } = require('../services/automation.service');
    const { notifyCampaignComplete } = require('../services/telegram.service');

    // ─── Campaign send ─────────────────────────────────────────────────────
    emailQueue.process('send-campaign', 5, async (job) => {
        const { campaignId, resume } = job.data;
        console.log(`📧 Processing campaign: ${campaignId} (resume: ${resume || false})`);

        try {
            const result = await processCampaign(campaignId, resume || false);

            // ─── Telegram Notification — Success ──────────────────────────
            const Campaign = require('../models/Campaign.model');
            const campaign = await Campaign.findById(campaignId).select('name userId stats');
            if (campaign) {
                await notifyCampaignComplete(campaign.userId, campaign.name, {
                    success: true,
                    sent: campaign.stats?.sent || 0,
                    failed: campaign.stats?.failed || 0,
                });
            }
        } catch (err) {
            // ─── Telegram Notification — Failure ──────────────────────────
            try {
                const Campaign = require('../models/Campaign.model');
                const campaign = await Campaign.findById(campaignId).select('name userId');
                if (campaign) {
                    await notifyCampaignComplete(campaign.userId, campaign.name, {
                        success: false,
                        sent: 0,
                        failed: 0,
                        error: err.message,
                    });
                }
            } catch (_) { }
            throw err; // re-throw so queue marks job as failed
        }
    });

    // ─── A/B Winner Selection ──────────────────────────────────────────────
    emailQueue.process('select-ab-winner', 1, async (job) => {
        const { campaignId } = job.data;
        console.log(`🏆 Selecting A/B winner for campaign: ${campaignId}`);
        await selectABWinner(campaignId);
    });

    // ─── Automation Step Runner ────────────────────────────────────────────
    emailQueue.process('automation-step', 10, async (job) => {
        const { enrollmentId } = job.data;
        await processEnrollmentStep(enrollmentId);
    });

    // ─── Single transactional email ────────────────────────────────────────
    emailQueue.process('send-single-email', 20, async (job) => {
        const { to, subject, html, text, fromEmail, fromName, replyTo } = job.data;
        await sendSingleEmail({ to, subject, html, text, fromEmail, fromName, replyTo });
    });

    console.log('🚀 Email workers registered and listening for jobs...');
};

module.exports = { initWorkers };
