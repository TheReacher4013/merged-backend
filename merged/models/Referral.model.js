const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referrerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    refereeId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referralCode: { type: String, required: true },
    status:       { type: String, enum: ['pending','converted','rewarded','fraud'], default: 'pending' },
    convertedAt:  { type: Date, default: null },
    rewardedAt:   { type: Date, default: null },
    referrerReward: {
      type:   { type: String, enum: ['days','credit'], default: 'days' },
      value:  { type: Number, default: 30 },
    },
    refereeReward: {
      couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    },
    // Fraud signals
    ipAddress:      { type: String, default: null },
    deviceFingerprint: { type: String, default: null },
    isFlagged:      { type: Boolean, default: false },
    flagReason:     { type: String, default: null },
  },
  { timestamps: true }
);

referralSchema.index({ referrerId: 1 });
referralSchema.index({ refereeId: 1, status: 1 });

module.exports = mongoose.model('Referral', referralSchema);
