const cron = require('node-cron');
const TrialService        = require('../services/trial.service');
const AnnouncementService = require('../services/announcement.service');
const SubscriptionService = require('../services/subscription.service');
const Subscription         = require('../models/Subscription.model');
const NotificationService  = require('../services/notification.service');

console.log('⏰ Cron jobs initialized');

// ─── Trial: Expire trials every hour ─────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const result = await TrialService.expireTrials();
    if (result.expiredCount > 0) console.log(`[Cron] Expired ${result.expiredCount} trials`);
  } catch (err) {
    console.error('[Cron] trial-expiry-check failed:', err.message);
  }
});

// ─── Trial: Day 5 reminder — 2 days left (daily 10am IST = 4:30am UTC) ───────
cron.schedule('30 4 * * *', async () => {
  try {
    const r = await TrialService.sendReminders(5);
    console.log(`[Cron] D5 reminder sent to ${r.sent} users`);
  } catch (err) {
    console.error('[Cron] trial-reminder-d5 failed:', err.message);
  }
});

// ─── Trial: Day 6 reminder — ends tomorrow (daily 10am IST) ─────────────────
cron.schedule('31 4 * * *', async () => {
  try {
    const r = await TrialService.sendReminders(2);
    console.log(`[Cron] D6 reminder sent to ${r.sent} users`);
  } catch (err) {
    console.error('[Cron] trial-reminder-d6 failed:', err.message);
  }
});

// ─── Trial: Day 14 re-engagement email ───────────────────────────────────────
cron.schedule('0 5 * * *', async () => {
  try {
    const r = await TrialService.sendReengagement();
    console.log(`[Cron] D14 re-engagement sent to ${r.sent} users`);
  } catch (err) {
    console.error('[Cron] re-engagement failed:', err.message);
  }
});

// ─── Subscription: Renewal check every hour ───────────────────────────────────
cron.schedule('15 * * * *', async () => {
  try {
    const now    = new Date();
    const expiredSubs = await Subscription.find({
      status:           'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd:  { $lte: now },
    }).lean();

    for (const sub of expiredSubs) {
      await SubscriptionService.expire(sub.userId);
    }
    if (expiredSubs.length) console.log(`[Cron] Cancelled ${expiredSubs.length} subscriptions at period end`);
  } catch (err) {
    console.error('[Cron] subscription-renewal failed:', err.message);
  }
});

// ─── Subscription: Grace period expiry every hour ────────────────────────────
cron.schedule('30 * * * *', async () => {
  try {
    const now = new Date();
    const pastDue = await Subscription.find({
      status:          'past_due',
      gracePeriodEnd:  { $lte: now },
    }).lean();

    for (const sub of pastDue) {
      await SubscriptionService.expire(sub.userId);
    }
    if (pastDue.length) console.log(`[Cron] Expired ${pastDue.length} subscriptions after grace period`);
  } catch (err) {
    console.error('[Cron] grace-period-check failed:', err.message);
  }
});

// ─── Announcements: Deactivate expired announcements (every 30 min) ──────────
cron.schedule('*/30 * * * *', async () => {
  try {
    const count = await AnnouncementService.deactivateExpired();
    if (count > 0) console.log(`[Cron] Deactivated ${count} expired announcements`);
  } catch (err) {
    console.error('[Cron] announcement deactivation failed:', err.message);
  }
});
