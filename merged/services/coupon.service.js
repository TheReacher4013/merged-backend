const Coupon = require('../models/Coupon.model');
const Plan   = require('../models/Plan.model');

class CouponService {
  /**
   * Full 10-step coupon validation (per document spec)
   * Does NOT consume the coupon — only validates and calculates discount
   */
  static async validate({ code, planId, userId }) {
    const now = new Date();

    // Step 2: Find coupon (case-insensitive)
    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });
    if (!coupon) {
      return { valid: false, error: 'Coupon not found', code: 'NOT_FOUND' };
    }

    // Step 3: Check active
    if (!coupon.isActive) {
      return { valid: false, error: 'Coupon is inactive', code: 'INACTIVE' };
    }

    // Step 4: Check date validity
    if (coupon.validFrom > now || coupon.validUntil < now) {
      return { valid: false, error: 'Coupon has expired', code: 'EXPIRED' };
    }

    // Step 5: Global usage limit
    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      return { valid: false, error: 'Coupon usage limit reached', code: 'LIMIT_REACHED' };
    }

    // Step 6: Per-user usage limit
    const userUsage = coupon.usedBy.filter(u => String(u.userId) === String(userId)).length;
    if (userUsage >= coupon.usagePerUser) {
      return { valid: false, error: 'You have already used this coupon', code: 'USER_LIMIT' };
    }

    // Step 7: Plan restriction
    if (coupon.applicablePlans.length > 0) {
      const planAllowed = coupon.applicablePlans.map(String).includes(String(planId));
      if (!planAllowed) {
        return { valid: false, error: 'Coupon not valid for this plan', code: 'PLAN_MISMATCH' };
      }
    }

    // Step 8: Minimum order amount
    const plan = await Plan.findById(planId).lean();
    if (!plan) {
      return { valid: false, error: 'Plan not found', code: 'PLAN_NOT_FOUND' };
    }

    const planPrice = plan.monthlyPrice; // in paise
    if (planPrice < coupon.minOrderAmount) {
      return { valid: false, error: `Minimum order of ₹${coupon.minOrderAmount / 100} required`, code: 'MIN_ORDER' };
    }

    // Step 9: Calculate discount
    let discountAmount = 0;
    if (coupon.type === 'percent') {
      discountAmount = Math.floor((planPrice * coupon.value) / 100);
      if (coupon.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
      }
    } else {
      discountAmount = coupon.value; // fixed in paise
    }

    const finalAmount = Math.max(0, planPrice - discountAmount);

    return {
      valid: true,
      couponId:       coupon._id,
      code:           coupon.code,
      discountType:   coupon.type,
      discountValue:  coupon.value,
      discountAmount,
      originalAmount: planPrice,
      finalAmount,
    };
  }

  /**
   * Atomically consume a coupon — call ONLY from payment success webhook
   */
  static async consume(couponId, userId) {
    return Coupon.findOneAndUpdate(
      { _id: couponId, isActive: true },
      {
        $inc: { usedCount: 1 },
        $push: { usedBy: { userId, usedAt: new Date() } },
      },
      { new: true }
    );
  }

  static async create(data) {
    data.code = data.code.toUpperCase().trim();
    return Coupon.create(data);
  }

  static async update(id, data) {
    if (data.code) data.code = data.code.toUpperCase().trim();
    return Coupon.findByIdAndUpdate(id, data, { new: true });
  }

  static async getAll({ page = 1, limit = 20, isActive } = {}) {
    const query = {};
    if (isActive !== undefined) query.isActive = isActive;
    const [data, total] = await Promise.all([
      Coupon.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Coupon.countDocuments(query),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  static async delete(id) {
    return Coupon.findByIdAndDelete(id);
  }
}

module.exports = CouponService;
