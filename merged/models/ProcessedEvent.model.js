const mongoose = require('mongoose');

// Prevents double-processing of Razorpay webhooks
const processedEventSchema = new mongoose.Schema(
  {
    eventId:   { type: String, required: true, unique: true, index: true },
    event:     { type: String },
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Auto-delete after 30 days
processedEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('ProcessedEvent', processedEventSchema);
