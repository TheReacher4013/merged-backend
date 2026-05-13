const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subscriptionId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    planId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    // Razorpay IDs
    razorpayOrderId:  { type: String, default: null, index: true },
    razorpayPaymentId:{ type: String, default: null, index: true },
    razorpaySubId:    { type: String, default: null },
    razorpaySignature:{ type: String, default: null },
    // Amount in paise
    amount:           { type: Number, required: true },
    currency:         { type: String, default: 'INR' },
    type:             { type: String, enum: ['one_time','subscription'], default: 'one_time' },
    status:           { type: String, enum: ['created','captured','failed','refunded'], default: 'created' },
    couponApplied:    { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    discountAmount:   { type: Number, default: 0 },
    refundId:         { type: String, default: null },
    refundAmount:     { type: Number, default: 0 },
    notes:            { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
