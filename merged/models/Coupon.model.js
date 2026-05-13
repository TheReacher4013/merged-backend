const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code:             { type: String, required: true, unique: true, uppercase: true, trim: true },
    type:             { type: String, enum: ['percent','fixed'], required: true },
    value:            { type: Number, required: true, min: 0 },
    maxDiscountAmount:{ type: Number, default: null },   // cap for percent coupons (in paise)
    minOrderAmount:   { type: Number, default: 0 },      // minimum plan price in paise
    applicablePlans:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Plan' }], // empty = all plans
    usageLimit:       { type: Number, default: 0 },      // 0 = unlimited
    usagePerUser:     { type: Number, default: 1 },
    usedCount:        { type: Number, default: 0 },
    usedBy: [
      {
        userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        usedAt:  { type: Date, default: Date.now },
      },
    ],
    isActive:         { type: Boolean, default: true },
    validFrom:        { type: Date, default: Date.now },
    validUntil:       { type: Date, required: true },
    description:      { type: String, default: '' },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

couponSchema.index({ code: 1 });
couponSchema.index({ isActive: 1, validUntil: 1 });

module.exports = mongoose.model('Coupon', couponSchema);
