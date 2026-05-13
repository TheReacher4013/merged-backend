const mongoose = require('mongoose');

const whatsappCampaignSchema = new mongoose.Schema(
  {
    tenantId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:              { type: String, required: true, trim: true },
    templateId:        { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsappTemplate', required: true },
    segmentId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Segment', default: null },
    // Variable values to fill in template: { '1': 'John', '2': 'ORD123' }
    templateVariables: { type: mongoose.Schema.Types.Mixed, default: {} },
    status:            { type: String, enum: ['draft','scheduled','sending','sent','failed'], default: 'draft' },
    scheduledAt:       { type: Date, default: null },
    sentAt:            { type: Date, default: null },
    totalRecipients:   { type: Number, default: 0 },
    stats: {
      queued:    { type: Number, default: 0 },
      sent:      { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read:      { type: Number, default: 0 },
      replied:   { type: Number, default: 0 },
      failed:    { type: Number, default: 0 },
      optedOut:  { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsappCampaign', whatsappCampaignSchema);
