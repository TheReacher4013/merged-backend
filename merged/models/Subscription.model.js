const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    userId:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planId:              { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    razorpaySubId:       { type: String, default: null },
    status:              {
      type: String,
      enum: ['trialing','active','past_due','cancelled','expired'],
      default: 'trialing',
    },
    billingCycle:        { type: String, enum: ['monthly','yearly'], default: 'monthly' },
    currentPeriodStart:  { type: Date, default: null },
    currentPeriodEnd:    { type: Date, default: null },
    trialStart:          { type: Date, default: null },
    trialEnd:            { type: Date, default: null },
    cancelAtPeriodEnd:   { type: Boolean, default: false },
    cancelledAt:         { type: Date, default: null },
    couponApplied:       { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    gracePeriodEnd:      { type: Date, default: null },
    // Trial extension tracking
    isTrialExtended:     { type: Boolean, default: false },
    extendedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    extensionReason:     { type: String, default: null },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ status: 1, trialEnd: 1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
