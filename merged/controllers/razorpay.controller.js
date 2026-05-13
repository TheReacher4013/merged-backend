const RazorpayService = require('../services/razorpay.service');

// POST /api/razorpay/create-order
exports.createOrder = async (req, res) => {
  try {
    const { planId, amount, couponCode, billingCycle } = req.body;
    if (!planId || !amount) return res.status(400).json({ success: false, message: 'planId and amount required' });

    const result = await RazorpayService.createOrder({
      userId: req.user._id,
      planId,
      amount,
      couponCode,
      billingCycle: billingCycle || 'monthly',
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/razorpay/create-subscription
exports.createSubscription = async (req, res) => {
  try {
    const { razorpayPlanId, totalCount } = req.body;
    if (!razorpayPlanId) return res.status(400).json({ success: false, message: 'razorpayPlanId required' });

    const sub = await RazorpayService.createSubscription({
      userId: req.user._id,
      razorpayPlanId,
      totalCount,
    });
    res.status(201).json({ success: true, subscription: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/razorpay/verify-payment
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = RazorpayService.verifySignature({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValid) return res.status(400).json({ success: false, message: 'Payment verification failed' });

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/razorpay/webhook  [Public — Razorpay calls this]
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody   = req.body; // raw Buffer (see server.js middleware)

    const isValid = RazorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) return res.status(400).json({ message: 'Invalid webhook signature' });

    const event = JSON.parse(rawBody.toString());
    await RazorpayService.handleWebhook(event);

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[Webhook Error]', err.message);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
};

// GET /api/razorpay/payments
exports.getPaymentHistory = async (req, res) => {
  try {
    const result = await RazorpayService.getPaymentHistory(req.user._id, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/razorpay/refund  [Admin]
exports.refund = async (req, res) => {
  try {
    const { paymentId, amount } = req.body;
    if (!paymentId || !amount) return res.status(400).json({ success: false, message: 'paymentId and amount required' });
    const refund = await RazorpayService.refund(paymentId, amount);
    res.json({ success: true, refund });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
