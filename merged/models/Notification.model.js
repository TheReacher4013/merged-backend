const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type:      { type: String, enum: ['info','success','warning','error','promo','system'], default: 'info' },
    title:     { type: String, required: true, trim: true },
    message:   { type: String, required: true },
    link:      { type: String, default: null },
    isRead:    { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    channels:  { type: [String], enum: ['inapp','email','push'], default: ['inapp'] },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// TTL index — auto-delete expired notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });
notificationSchema.index({ userId: 1, isRead: 1, isDeleted: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
