const mongoose = require('mongoose');

const whatsappTemplateSchema = new mongoose.Schema(
  {
    tenantId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:           { type: String, required: true, trim: true },
    category:       { type: String, enum: ['MARKETING','UTILITY','AUTHENTICATION'], required: true },
    language:       { type: String, default: 'en' },
    components: {
      header: {
        type:   { type: String, enum: ['TEXT','IMAGE','VIDEO','DOCUMENT'], default: null },
        text:   { type: String, default: null },
        mediaUrl: { type: String, default: null },
      },
      body:   { type: String, required: true },
      footer: { type: String, default: null },
      buttons: [
        {
          type:    { type: String, enum: ['QUICK_REPLY','URL','PHONE_NUMBER'] },
          text:    String,
          url:     String,
          phone:   String,
        },
      ],
    },
    variableCount:    { type: Number, default: 0 },
    status:           { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    metaTemplateId:   { type: String, default: null },
    rejectionReason:  { type: String, default: null },
  },
  { timestamps: true }
);

whatsappTemplateSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('WhatsappTemplate', whatsappTemplateSchema);
