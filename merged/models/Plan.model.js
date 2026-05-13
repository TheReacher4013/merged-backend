const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name:             { type: String, required: true, trim: true },   // Starter, Professional, Agency, Enterprise
    slug:             { type: String, required: true, unique: true, lowercase: true },
    description:      { type: String, default: '' },
    monthlyPrice:     { type: Number, required: true },               // in paise
    yearlyPrice:      { type: Number, required: true },               // in paise
    razorpayMonthlyPlanId: { type: String, default: null },
    razorpayYearlyPlanId:  { type: String, default: null },
    limits: {
      users:            { type: Number, default: 1 },
      contacts:         { type: Number, default: 1000 },
      emailsPerMonth:   { type: Number, default: 5000 },
      whatsappPerMonth: { type: Number, default: 0 },
    },
    features:         [{ type: String }],
    isActive:         { type: Boolean, default: true },
    isFree:           { type: Boolean, default: false },
    trialDays:        { type: Number, default: 7 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plan', planSchema);
