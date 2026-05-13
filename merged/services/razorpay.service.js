const Razorpay = require('razorpay');
const crypto = require('crypto');
const Payment = require('../models/Payment.model');
const ProcessedEvent = require('../models/ProcessedEvent.model');
const SubscriptionService = require('./subscription.service');
const CouponService = require('./coupon.service');
const ReferralService = require('./referral.service');
const NotificationService = require('./notification.service');

// Lazy init — won't crash on startup if keys are missing
let _razorpay = null;
const getRazorpay = () => {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay keys not configured in .env');
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
};

class RazorpayService {
  /**
   * Create a one-time order (used at checkout)
   */
  static async createOrder({ userId, planId, amount, couponCode, billingCycle }) {
    let discountAmount = 0;
    let couponId = null;

    // Validate coupon if provided
    if (couponCode) {
      const result = await CouponService.validate({ code: couponCode, planId, userId });
      if (result.valid) {
        discountAmount = result.discountAmount;
        couponId = result.couponId;
        amount = result.finalAmount;
      }
    }

    // Create Razorpay order (amount in paise)
    const order = await getRazorpay().orders.create({
      amount,
      currency: 'INR',
      notes: { userId: String(userId), planId: String(planId), billingCycle },
    });

    // Save payment record
    await Payment.create({
      userId,
      planId,
      razorpayOrderId: order.id,
      amount,
      type: 'one_time',
      status: 'created',
      couponApplied: couponId,
      discountAmount,
    });

    return { order, couponApplied: !!couponId, discountAmount };
  }

  /**
   * Create a Razorpay Subscription (recurring)
   */
  static async createSubscription({ userId, razorpayPlanId, totalCount = 12 }) {
    const sub = await getRazorpay().subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: totalCount,
      quantity: 1,
      notes: { userId: String(userId) },
    });

    await Payment.create({
      userId,
      razorpaySubId: sub.id,
      amount: 0,
      type: 'subscription',
      status: 'created',
    });

    return sub;
  }

  /**
   * Verify payment signature (called after checkout.js callback)
   */
  static verifySignature({ orderId, paymentId, signature }) {
    const body = `${orderId}|${paymentId}`;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');
    return expectedSig === signature;
  }

  /**
   * Verify webhook signature from Razorpay
   */
  static verifyWebhookSignature(rawBody, signature) {
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    return expectedSig === signature;
  }

  /**
   * Main webhook handler — idempotent, handles all critical events
   */
  static async handleWebhook(event) {
    const eventId = event.payload?.payment?.entity?.id || event.payload?.subscription?.entity?.id || `${event.event}-${Date.now()}`;

    // ─── Idempotency Check ───────────────────────────────────────────────────
    const alreadyProcessed = await ProcessedEvent.findOne({ eventId });
    if (alreadyProcessed) {
      console.log(`[Razorpay] Duplicate event ${eventId} — skipping`);
      return;
    }
    await ProcessedEvent.create({ eventId, event: event.event });

    const paymentEntity = event.payload?.payment?.entity;
    const subscriptionEntity = event.payload?.subscription?.entity;

    switch (event.event) {
      // ── One-time payment success ─────────────────────────────────────────
      case 'payment.captured': {
        const { order_id, id: paymentId, notes } = paymentEntity;
        const { userId, planId, billingCycle } = notes;

        await Payment.findOneAndUpdate(
          { razorpayOrderId: order_id },
          { razorpayPaymentId: paymentId, status: 'captured' }
        );

        const payment = await Payment.findOne({ razorpayOrderId: order_id }).lean();

        await SubscriptionService.activate(userId, { planId, billingCycle, couponApplied: payment?.couponApplied });

        // Consume coupon atomically
        if (payment?.couponApplied) {
          await CouponService.consume(payment.couponApplied, userId);
        }

        // Convert referral if any
        await ReferralService.convertAndReward(userId);

        await NotificationService.create(userId, {
          type: 'success',
          title: 'Payment Successful! ✅',
          message: 'Your subscription is now active. Enjoy all features!',
          channels: ['inapp', 'email'],
        });
        break;
      }

      // ── Payment failed ───────────────────────────────────────────────────
      case 'payment.failed': {
        const { notes } = paymentEntity;
        if (notes?.userId) {
          await Payment.findOneAndUpdate(
            { razorpayOrderId: paymentEntity.order_id },
            { status: 'failed' }
          );
          await NotificationService.create(notes.userId, {
            type: 'error',
            title: 'Payment Failed',
            message: 'Your payment could not be processed. Please try again.',
            channels: ['inapp', 'email'],
          });
        }
        break;
      }

      // ── Subscription charged (auto-renewal success) ──────────────────────
      case 'subscription.charged': {
        const { notes } = subscriptionEntity;
        const userId = notes?.userId || subscriptionEntity.notes?.userId;
        if (userId) {
          await SubscriptionService.activate(userId, {
            razorpaySubId: subscriptionEntity.id,
          });
        }
        break;
      }

      // ── Subscription halted (renewal failed after retries) ───────────────
      case 'subscription.halted': {
        const { notes } = subscriptionEntity;
        const userId = notes?.userId;
        if (userId) await SubscriptionService.setPastDue(userId);
        break;
      }

      // ── Subscription cancelled ───────────────────────────────────────────
      case 'subscription.cancelled': {
        const { notes } = subscriptionEntity;
        const userId = notes?.userId;
        if (userId) await SubscriptionService.cancel(userId);
        break;
      }

      default:
        console.log(`[Razorpay] Unhandled event: ${event.event}`);
    }
  }

  static async getPaymentHistory(userId, { page = 1, limit = 10 } = {}) {
    const [data, total] = await Promise.all([
      Payment.find({ userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Payment.countDocuments({ userId }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  static async refund(paymentId, amount) {
    const refund = await getRazorpay().payments.refund(paymentId, { amount });
    await Payment.findOneAndUpdate(
      { razorpayPaymentId: paymentId },
      { status: 'refunded', refundId: refund.id, refundAmount: amount }
    );
    return refund;
  }
}

module.exports = RazorpayService;