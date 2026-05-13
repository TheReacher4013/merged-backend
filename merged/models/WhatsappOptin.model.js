const mongoose = require('mongoose');

const whatsappOptinSchema = new mongoose.Schema(
  {
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    contactId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    phone:        { type: String, required: true },
    status:       { type: String, enum: ['opted_in','opted_out'], default: 'opted_in' },
    consentSource:{ type: String, enum: ['web_form','sms_keyword','inapp','manual','api'], default: 'manual' },
    consentedAt:  { type: Date, default: Date.now },
    optedOutAt:   { type: Date, default: null },
    ipAddress:    { type: String, default: null },
  },
  { timestamps: true }
);

whatsappOptinSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('WhatsappOptin', whatsappOptinSchema);
