const crypto        = require('crypto');
const Referral       = require('../models/Referral.model');
const NotificationService = require('./notification.service');

const MAX_REWARDS_PER_USER = 12; // months or referrals cap

class ReferralService {
  /**
   * Generate a unique referral code for a user (called at signup)
   * e.g. NV-ABC123
   */
  static generateCode(userId) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `NV-${suffix}`;
  }

  /**
   * When User B signs up with a referral code, create a pending referral record
   */
  static async createPending({ referralCode, refereeId, ipAddress, deviceFingerprint }) {
    // Find referrer by referral code (stored on User model)
    // NOTE: Requires User model to have referralCode field
    const User = require('../models/User.model');
    const referrer = await User.findOne({ referralCode }).lean();
    if (!referrer) return null;

    // Fraud check: same user cannot refer themselves
    if (String(referrer._id) === String(refereeId)) return null;

    // Fraud check: IP used more than 3 times in 24h
    const recentFromIP = await Referral.countDocuments({
      ipAddress,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (recentFromIP >= 3) {
      return { isFlagged: true, flagReason: 'IP_ABUSE' };
    }

    // Cap referrer rewards
    const rewardCount = await Referral.countDocuments({
      referrerId: referrer._id,
      status: { $in: ['rewarded'] },
    });
    if (rewardCount >= MAX_REWARDS_PER_USER) {
      return null; // silently cap
    }

    const referral = await Referral.create({
      referrerId: referrer._id,
      refereeId,
      referralCode,
      status: 'pending',
      ipAddress,
      deviceFingerprint,
    });

    return referral;
  }

  /**
   * Called from Razorpay webhook: payment.captured — mark converted + issue rewards
   */
  static async convertAndReward(refereeId) {
    const referral = await Referral.findOne({ refereeId, status: 'pending' });
    if (!referral) return null;

    // Mark converted
    referral.status      = 'converted';
    referral.convertedAt = new Date();
    await referral.save();

    // Issue rewards
    const User = require('../models/User.model');

    // Referrer: +30 days or ₹100 credit
    await User.findByIdAndUpdate(referral.referrerId, {
      $inc: { referralCredits: 100, referralCount: 1 },
    });

    // Referee: 10% discount coupon (create a one-time coupon for them)
    const CouponService = require('./coupon.service');
    const coupon = await CouponService.create({
      code:          `REF-${referral.refereeId.toString().slice(-6).toUpperCase()}`,
      type:          'percent',
      value:         10,
      usageLimit:    1,
      usagePerUser:  1,
      validUntil:    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      description:   'Referral welcome discount',
    });

    referral.refereeReward.couponId = coupon._id;
    referral.status   = 'rewarded';
    referral.rewardedAt = new Date();
    await referral.save();

    // Notify both users
    await NotificationService.create(referral.referrerId, {
      type: 'success',
      title: 'Referral Reward Earned! 🎉',
      message: 'Your referral just subscribed. You earned ₹100 credit!',
    });
    await NotificationService.create(referral.refereeId, {
      type: 'promo',
      title: 'Your Referral Discount',
      message: `You got a 10% discount coupon: ${coupon.code}`,
    });

    return referral;
  }

  static async getByReferrer(referrerId, { page = 1, limit = 20 } = {}) {
    const [data, total] = await Promise.all([
      Referral.find({ referrerId })
        .populate('refereeId', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Referral.countDocuments({ referrerId }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  static async getStats(referrerId) {
    const stats = await Referral.aggregate([
      { $match: { referrerId: referrerId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return stats;
  }
}

module.exports = ReferralService;
