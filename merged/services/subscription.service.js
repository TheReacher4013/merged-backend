const Subscription        = require('../models/Subscription.model');
const Plan                = require('../models/Plan.model');
const NotificationService = require('./notification.service');

class SubscriptionService {
  /**
   * Start a 7-day free trial on a given plan (no payment required)
   */
  static async startTrial(userId, planId) {
    const existing = await Subscription.findOne({ userId, status: { $in: ['trialing','active'] } });
    if (existing) throw new Error('User already has an active subscription or trial');

    const now      = new Date();
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const subscription = await Subscription.create({
      userId,
      planId,
      status:     'trialing',
      trialStart: now,
      trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd:   trialEnd,
    });

    await NotificationService.create(userId, {
      type: 'success',
      title: 'Trial Started! 🚀',
      message: 'Your 7-day free trial has begun. Explore all features!',
      channels: ['inapp','email'],
    });

    return subscription;
  }

  /**
   * Activate a subscription after successful payment
   */
  static async activate(userId, { planId, razorpaySubId, billingCycle, couponApplied } = {}) {
    const now    = new Date();
    const period = billingCycle === 'yearly' ? 365 : 30;
    const end    = new Date(now.getTime() + period * 24 * 60 * 60 * 1000);

    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      {
        planId,
        razorpaySubId,
        status:             'active',
        billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd:   end,
        couponApplied:      couponApplied || null,
      },
      { upsert: true, new: true }
    );

    return subscription;
  }

  /**
   * Handle failed payment — set past_due + 3-day grace period
   */
  static async setPastDue(userId) {
    const gracePeriodEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const sub = await Subscription.findOneAndUpdate(
      { userId, status: 'active' },
      { status: 'past_due', gracePeriodEnd },
      { new: true }
    );

    if (sub) {
      await NotificationService.create(userId, {
        type: 'error',
        title: 'Payment Failed',
        message: 'Your payment failed. Please update your payment method within 3 days.',
        channels: ['inapp','email'],
      });
    }
    return sub;
  }

  /**
   * Cancel subscription (soft cancel — active until period end)
   */
  static async cancel(userId) {
    return Subscription.findOneAndUpdate(
      { userId, status: 'active' },
      { cancelAtPeriodEnd: true, cancelledAt: new Date() },
      { new: true }
    );
  }

  /**
   * Expire a subscription (called by cron or after grace period)
   */
  static async expire(userId) {
    const sub = await Subscription.findOneAndUpdate(
      { userId, status: { $in: ['trialing','past_due'] } },
      { status: 'expired' },
      { new: true }
    );

    if (sub) {
      await NotificationService.create(userId, {
        type: 'warning',
        title: 'Subscription Expired',
        message: 'Your subscription has expired. Upgrade to restore full access.',
        channels: ['inapp','email'],
      });
    }
    return sub;
  }

  static async getByUser(userId) {
    return Subscription.findOne({ userId })
      .populate('planId')
      .sort({ createdAt: -1 })
      .lean();
  }

  static async getAll({ page = 1, limit = 20, status } = {}) {
    const query = status ? { status } : {};
    const [data, total] = await Promise.all([
      Subscription.find(query)
        .populate('userId', 'name email')
        .populate('planId', 'name slug')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Subscription.countDocuments(query),
    ]);
    return { data, total };
  }

  /**
   * Admin: manually extend trial
   */
  static async extendTrial(subscriptionId, days, adminId, reason) {
    const sub = await Subscription.findById(subscriptionId);
    if (!sub) throw new Error('Subscription not found');

    const newEnd = new Date(sub.trialEnd.getTime() + days * 24 * 60 * 60 * 1000);
    sub.trialEnd            = newEnd;
    sub.currentPeriodEnd    = newEnd;
    sub.isTrialExtended     = true;
    sub.extendedBy          = adminId;
    sub.extensionReason     = reason;
    await sub.save();

    return sub;
  }
}

module.exports = SubscriptionService;
