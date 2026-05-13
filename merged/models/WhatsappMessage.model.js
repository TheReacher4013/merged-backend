const mongoose = require('mongoose');

const whatsappMessageSchema = new mongoose.Schema(
  {
    campaignId:  { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsappCampaign', required: true },
    contactId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    tenantId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phone:       { type: String, required: true },          // E.164: +91XXXXXXXXXX
    wamid:       { type: String, default: null, index: true }, // WhatsApp Message ID from Meta
    status:      { type: String, enum: ['queued','sent','delivered','read','failed','replied'], default: 'queued' },
    errorCode:   { type: String, default: null },
    errorMessage:{ type: String, default: null },
    sentAt:      { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt:      { type: Date, default: null },
    repliedAt:   { type: Date, default: null },
    replyText:   { type: String, default: null },
  },
  { timestamps: true }
);

whatsappMessageSchema.index({ campaignId: 1, status: 1 });
whatsappMessageSchema.index({ wamid: 1 });

module.exports = mongoose.model('WhatsappMessage', whatsappMessageSchema);
