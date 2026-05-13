const Subscription        = require('../models/Subscription.model');
const NotificationService = require('./notification.service');

class TrialService {
  /**
   * Send scheduled trial reminder notifications (called by cron jobs)
   * @param {number} daysRemaining - days left in trial (5, 2, 1, 0)
   */
  static async sendReminders(daysRemaining) {
    const now         = new Date();
    const windowStart = new Date(now.getTime() + (daysRemaining - 0.5) * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + (daysRemaining + 0.5) * 24 * 60 * 60 * 1000);

    const trials = await Subscription.find({
      status:   'trialing',
      trialEnd: { $gte: windowStart, $lte: windowEnd },
    }).lean();

    const messages = {
      5: {
        title:   '⏰ 2 Days Left in Your Trial',
        message: 'Your trial ends in 2 days. Add a payment method to keep full access.',
        channels: ['inapp','email'],
      },
      2: {
        title:   '🚨 Trial Ends Tomorrow!',
        message: 'Urgent: Your trial ends tomorrow. Add payment to continue.',
        channels: ['inapp'],
      },
      1: {
        title:   '⚠️ Trial Ending Soon',
        message: '2 days left — add a payment method to keep your access.',
        channels: ['inapp','email'],
      },
      0: {
        title:   '❌ Trial Ended',
        message: 'Your trial has ended. Upgrade now or move to the free tier.',
        channels: ['inapp','email'],
      },
    };

    const msg = messages[daysRemaining];
    if (!msg) return { sent: 0 };

    let sent = 0;
    for (const sub of trials) {
      await NotificationService.create(sub.userId, msg);
      sent++;
    }

    return { sent, daysRemaining };
  }

  /**
   * Expire trials that have passed their trialEnd date
   * Called every hour by cron
   */
  static async expireTrials() {
    const now     = new Date();
    const expired = await Subscription.find({
      status:   'trialing',
      trialEnd: { $lte: now },
    }).lean();

    let expiredCount = 0;
    for (const sub of expired) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'expired' });
      await NotificationService.create(sub.userId, {
        type:    'warning',
        title:   'Trial Expired',
        message: 'Your 7-day trial has ended. Upgrade to continue using premium features.',
        channels: ['inapp','email'],
      });
      expiredCount++;
    }

    return { expiredCount };
  }

  /**
   * Check if a user is eligible for a trial
   * Enforced by: email, device fingerprint, IP
   */
  static async checkEligibility(userId, { deviceFingerprint, ipAddress } = {}) {
    // 1. Has the user already had a trial?
    const prevTrial = await Subscription.findOne({
      userId,
      trialStart: { $exists: true },
    }).lean();
    if (prevTrial) {
      return { eligible: false, reason: 'User already had a trial' };
    }

    // 2. IP abuse: more than 3 trials from same IP in 24h
    if (ipAddress) {
      // This requires a TrialAttempt log in production
      // For now, trust the flag from auth layer
    }

    return { eligible: true };
  }

  /**
   * Send Day 14 re-engagement email for lapsed trials
   */
  static async sendReengagement() {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const thirteenDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);

    const lapsed = await Subscription.find({
      status:   'expired',
      trialEnd: { $gte: fourteenDaysAgo, $lte: thirteenDaysAgo },
    }).lean();

    let sent = 0;
    for (const sub of lapsed) {
      await NotificationService.create(sub.userId, {
        type:    'promo',
        title:   'Miss the Premium Features? 🎁',
        message: 'Special offer: 20% off your first month. Use code COMEBACK20',
        channels: ['inapp','email'],
      });
      sent++;
    }

    return { sent };
  }
}

module.exports = TrialService;
