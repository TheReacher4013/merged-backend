const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title:          { type: String, required: true, trim: true },
    content:        { type: String, required: true },                         // HTML/Markdown
    type:           { type: String, enum: ['banner','modal','toast','inline'], default: 'banner' },
    priority:       { type: Number, min: 1, max: 5, default: 1 },            // 1=low, 5=critical
    targetAudience: { type: String, enum: ['all','free','paid','trial','specific_plan'], default: 'all' },
    planIds:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Plan' }], // for specific_plan
    isActive:       { type: Boolean, default: true },
    startAt:        { type: Date, default: Date.now },
    endAt:          { type: Date, default: null },
    isDismissible:  { type: Boolean, default: true },
    ctaLabel:       { type: String, default: null },
    ctaUrl:         { type: String, default: null },
    // Track who dismissed
    dismissedBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

announcementSchema.index({ isActive: 1, startAt: 1, endAt: 1 });

module.exports = mongoose.model('Announcement', announcementSchema);
