const { Automation, Enrollment } = require('../models/Automation.model');
const Contact = require('../models/Contact.model');
const Campaign = require('../models/Campaign.model');
const emailQueue = require('../jobs/emailQueue');
const { sendSingleEmail } = require('./emailEngine.service');

// ─── Enroll a contact into an automation ──────────────────────────────────────
const enrollContact = async (automationId, contactId, userId) => {
    const automation = await Automation.findById(automationId);
    if (!automation || automation.status !== 'active') return null;

    // Check re-enrollment setting
    const existing = await Enrollment.findOne({ automationId, contactId });
    if (existing) {
        if (!automation.allowReEnrollment) return null;
        if (existing.status === 'active') return null;   // already active — don't double enroll
    }

    // Create enrollment
    const enrollment = await Enrollment.findOneAndUpdate(
        { automationId, contactId },
        {
            userId,
            status: 'active',
            currentStepId: automation.entryStepId,
            nextRunAt: new Date(),
            stepHistory: [],
            enrolledAt: new Date(),
            completedAt: undefined,
        },
        { upsert: true, new: true }
    );

    // Update automation stats
    await Automation.findByIdAndUpdate(automationId, { $inc: { 'stats.enrolled': 1, 'stats.active': 1 } });

    // Queue the first step immediately
    await emailQueue.add('automation-step', { enrollmentId: enrollment._id.toString() }, { jobId: `enroll_${enrollment._id}_${Date.now()}` });

    return enrollment;
};

// ─── Process one step for an enrollment ───────────────────────────────────────
const processEnrollmentStep = async (enrollmentId) => {
    const enrollment = await Enrollment.findById(enrollmentId);
    if (!enrollment || enrollment.status !== 'active') return;

    const automation = await Automation.findById(enrollment.automationId);
    if (!automation || automation.status !== 'active') {
        await exitEnrollment(enrollment, 'automation_deactivated');
        return;
    }

    const step = automation.steps.find((s) => s.stepId === enrollment.currentStepId);
    if (!step) {
        await completeEnrollment(enrollment);
        return;
    }

    const contact = await Contact.findById(enrollment.contactId);
    if (!contact || contact.status !== 'subscribed') {
        await exitEnrollment(enrollment, 'contact_unsubscribed_or_deleted');
        return;
    }

    try {
        let nextStepId = null;

        // ─── Execute step by type ───────────────────────────────────────────────
        switch (step.type) {

            // TRIGGER — just move to next step
            case 'trigger':
                nextStepId = step.nextStepId;
                break;

            // ACTION — send email, add/remove tag, update field
            case 'action':
                await executeAction(step, contact, automation, enrollment);
                nextStepId = step.nextStepId;
                break;

            // DELAY — calculate next run time and re-queue
            case 'delay':
                const delayMs = calculateDelay(step.delayAmount, step.delayUnit, step.delayUntilTime);
                await Enrollment.findByIdAndUpdate(enrollmentId, {
                    currentStepId: step.nextStepId,
                    nextRunAt: new Date(Date.now() + delayMs),
                });

                // Push step history
                await pushStepHistory(enrollment, step.stepId, 'success', `Delay: ${step.delayAmount} ${step.delayUnit}`);

                // Schedule next step after delay
                await emailQueue.add(
                    'automation-step',
                    { enrollmentId: enrollment._id.toString() },
                    { delay: delayMs, jobId: `enroll_${enrollment._id}_delay_${Date.now()}` }
                );
                return; // Don't continue — re-queued with delay

            // CONDITION — if/else branch
            case 'condition':
                const conditionMet = await evaluateCondition(step, contact);
                nextStepId = conditionMet ? step.yesStepId : step.noStepId;
                break;

            // GOAL — mark conversion
            case 'goal':
                await Automation.findByIdAndUpdate(automation._id, { $inc: { 'stats.converted': 1 } });
                nextStepId = step.nextStepId;
                break;

            // EXIT — remove from workflow
            case 'exit':
                await exitEnrollment(enrollment, 'exit_step_reached');
                return;
        }

        // Push step history
        await pushStepHistory(enrollment, step.stepId, 'success');

        if (nextStepId) {
            // Move to next step and queue immediately
            await Enrollment.findByIdAndUpdate(enrollmentId, {
                currentStepId: nextStepId,
                nextRunAt: new Date(),
            });
            await emailQueue.add('automation-step', { enrollmentId: enrollment._id.toString() }, { jobId: `enroll_${enrollment._id}_${nextStepId}` });
        } else {
            // No next step — workflow complete
            await completeEnrollment(enrollment);
        }
    } catch (err) {
        console.error(`Error processing step ${step.stepId} for enrollment ${enrollmentId}:`, err.message);
        await pushStepHistory(enrollment, step.stepId, 'failed', err.message);

        // On action failure, still move forward (don't block the workflow)
        if (step.nextStepId) {
            await Enrollment.findByIdAndUpdate(enrollmentId, { currentStepId: step.nextStepId, nextRunAt: new Date() });
            await emailQueue.add('automation-step', { enrollmentId: enrollment._id.toString() }, { delay: 60000 });
        }
    }
};

// ─── Execute an Action step ───────────────────────────────────────────────────
const executeAction = async (step, contact, automation, enrollment) => {
    switch (step.actionType) {

        case 'send_email': {
            const { templateId, subject, fromEmail, fromName } = step.actionConfig || {};
            let html = '';
            let subjectLine = subject || 'Email from us';

            if (templateId) {
                const Template = require('../models/Template.model');
                const template = await Template.findById(templateId);
                if (template) {
                    html = template.htmlContent || '';
                    subjectLine = subject || template.subject || subjectLine;
                }
            }

            // Basic personalization
            html = html.replace(/\{\{name\}\}/g, contact.firstName || contact.email.split('@')[0]);
            html = html.replace(/\{\{email\}\}/g, contact.email);
            html = html.replace(/\{\{company\}\}/g, contact.company || '');

            await sendSingleEmail({
                to: contact.email,
                subject: subjectLine,
                html,
                fromEmail: fromEmail || process.env.EMAIL_FROM,
                fromName: fromName || process.env.EMAIL_FROM_NAME,
            });
            break;
        }

        case 'add_tag': {
            const { tag } = step.actionConfig || {};
            if (tag) {
                await Contact.findByIdAndUpdate(contact._id, { $addToSet: { tags: tag.toLowerCase().trim() } });
            }
            break;
        }

        case 'remove_tag': {
            const { tag } = step.actionConfig || {};
            if (tag) {
                await Contact.findByIdAndUpdate(contact._id, { $pull: { tags: tag.toLowerCase().trim() } });
            }
            break;
        }

        case 'update_field': {
            const { fieldKey, fieldValue } = step.actionConfig || {};
            if (fieldKey) {
                await Contact.findByIdAndUpdate(contact._id, { $set: { [`customFields.${fieldKey}`]: fieldValue } });
            }
            break;
        }

        case 'webhook_call': {
            const { url, method = 'POST' } = step.actionConfig || {};
            if (url) {
                const axios = require('axios');
                await axios({ method, url, data: { contactId: contact._id, email: contact.email }, timeout: 10000 });
            }
            break;
        }
    }
};

// ─── Evaluate a condition step ────────────────────────────────────────────────
const evaluateCondition = async (step, contact) => {
    const { conditionField, conditionOperator, conditionValue } = step;

    switch (conditionField) {
        case 'tag':
            const hasTags = contact.tags || [];
            if (conditionOperator === 'equals') return hasTags.includes(String(conditionValue).toLowerCase());
            if (conditionOperator === 'not_equals') return !hasTags.includes(String(conditionValue).toLowerCase());
            break;

        case 'email_opened': {
            const EmailLog = require('../models/EmailLog.model');
            const log = await EmailLog.findOne({ contactId: contact._id, campaignId: conditionValue, openCount: { $gt: 0 } });
            return conditionOperator === 'equals' ? !!log : !log;
        }

        case 'email_clicked': {
            const EmailLog = require('../models/EmailLog.model');
            const log = await EmailLog.findOne({ contactId: contact._id, campaignId: conditionValue, clickCount: { $gt: 0 } });
            return conditionOperator === 'equals' ? !!log : !log;
        }

        default: {
            // Custom field check
            const fieldValue = contact.customFields?.get(conditionField);
            if (conditionOperator === 'is_set') return !!fieldValue;
            if (conditionOperator === 'is_not_set') return !fieldValue;
            if (conditionOperator === 'equals') return String(fieldValue) === String(conditionValue);
            if (conditionOperator === 'not_equals') return String(fieldValue) !== String(conditionValue);
            if (conditionOperator === 'contains') return String(fieldValue || '').includes(String(conditionValue));
        }
    }
    return false;
};

// ─── Calculate delay in ms ────────────────────────────────────────────────────
const calculateDelay = (amount, unit, untilTime) => {
    const multipliers = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000, weeks: 7 * 24 * 60 * 60 * 1000 };
    let delayMs = (amount || 1) * (multipliers[unit] || multipliers.hours);

    // If delayUntilTime is set (e.g. '10:00'), adjust delay to hit that time after the base delay
    if (untilTime) {
        const [targetHour, targetMin] = untilTime.split(':').map(Number);
        const targetDate = new Date(Date.now() + delayMs);
        targetDate.setHours(targetHour, targetMin, 0, 0);
        if (targetDate <= new Date(Date.now() + delayMs)) {
            targetDate.setDate(targetDate.getDate() + 1);
        }
        delayMs = targetDate.getTime() - Date.now();
    }

    return Math.max(delayMs, 0);
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pushStepHistory = async (enrollment, stepId, result, note) => {
    await Enrollment.findByIdAndUpdate(enrollment._id, {
        $push: { stepHistory: { stepId, executedAt: new Date(), result, note } },
    });
};

const completeEnrollment = async (enrollment) => {
    await Enrollment.findByIdAndUpdate(enrollment._id, { status: 'completed', completedAt: new Date() });
    await Automation.findByIdAndUpdate(enrollment.automationId, {
        $inc: { 'stats.active': -1, 'stats.completed': 1 },
    });
};

const exitEnrollment = async (enrollment, reason) => {
    await Enrollment.findByIdAndUpdate(enrollment._id, { status: 'exited', exitedAt: new Date(), exitReason: reason });
    await Automation.findByIdAndUpdate(enrollment.automationId, {
        $inc: { 'stats.active': -1, 'stats.exited': 1 },
    });
};

module.exports = { enrollContact, processEnrollmentStep };