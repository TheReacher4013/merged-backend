/**
 * cronJobs.js — Scheduled tasks (no Redis dependency)
 *
 * Uses node-cron (already a lightweight dep).
 * Queues due automation enrollments into the in-memory emailQueue.
 */

const cron = require('node-cron');
const { Enrollment } = require('../models/Automation.model');
const emailQueue = require('./emailQueue');

// ─── Every 2 minutes: find due automation enrollments and queue them ──────────
const scheduleAutomationRunner = () => {
    cron.schedule('*/2 * * * *', async () => {
        try {
            const due = await Enrollment.find({
                status: 'active',
                nextRunAt: { $lte: new Date() },
            }).limit(500); // process max 500 per tick

            if (!due.length) return;

            console.log(`⚙️  Cron: Queuing ${due.length} due automation enrollments`);

            for (const enrollment of due) {
                // Bump nextRunAt far into the future to prevent double-queuing
                await Enrollment.findByIdAndUpdate(enrollment._id, {
                    nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                });

                await emailQueue.add(
                    'automation-step',
                    { enrollmentId: enrollment._id.toString() },
                    { jobId: `cron_enroll_${enrollment._id}_${Date.now()}` }
                );
            }
        } catch (err) {
            console.error('Automation runner cron error:', err.message);
        }
    });

    console.log('⏰ Automation cron runner scheduled (every 2 min)');
};

module.exports = { scheduleAutomationRunner };
