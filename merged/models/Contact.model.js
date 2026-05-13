const mongoose = require('mongoose');

// ─── Sub-schema: Engagement History ──────────────────────────────────────────
const engagementSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['email_sent', 'email_opened', 'email_clicked', 'unsubscribed', 'bounced'],
        },
        campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
        timestamp: { type: Date, default: Date.now },
        metadata: { type: mongoose.Schema.Types.Mixed }, // url clicked, etc.
    },
    { _id: false }
);

// ─── Main Contact Schema ──────────────────────────────────────────────────────
const contactSchema = new mongoose.Schema(
    {
        // ─── Owner ─────────────────────────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Tenant',
            index: true,
        },

        // ─── Contact Info ──────────────────────────────────────────────────────────
        email: {
            type: String,
            required: [true, 'Email is required'],
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
        },
        firstName: { type: String, trim: true, maxlength: 50 },
        lastName: { type: String, trim: true, maxlength: 50 },
        phone: { type: String, trim: true },
        company: { type: String, trim: true },
        jobTitle: { type: String, trim: true },
        country: { type: String, trim: true },
        city: { type: String, trim: true },

        // ─── Custom Fields (stored as flexible key-value) ─────────────────────────
        customFields: {
            type: Map,
            of: mongoose.Schema.Types.Mixed,
            default: {},
        },

        // ─── Tags ──────────────────────────────────────────────────────────────────
        tags: [{ type: String, trim: true, lowercase: true }],

        // ─── Subscription Status ───────────────────────────────────────────────────
        status: {
            type: String,
            enum: ['subscribed', 'unsubscribed', 'bounced', 'complained', 'pending'],
            default: 'subscribed',
            index: true,
        },
        unsubscribedAt: { type: Date },
        unsubscribeReason: { type: String },

        // ─── Segments (IDs of segments this contact belongs to) ───────────────────
        segmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Segment' }],

        // ─── Engagement History ────────────────────────────────────────────────────
        engagementHistory: [engagementSchema],

        // ─── Engagement Scores (computed) ─────────────────────────────────────────
        emailsSent: { type: Number, default: 0 },
        emailsOpened: { type: Number, default: 0 },
        emailsClicked: { type: Number, default: 0 },

        // ─── Import Source ─────────────────────────────────────────────────────────
        source: {
            type: String,
            enum: ['csv_import', 'manual', 'api', 'form', 'oauth'],
            default: 'manual',
        },
        importBatchId: { type: String }, // ties to a CSV import batch

        isDeleted: { type: Boolean, default: false }, // soft delete
    },
    {
        timestamps: true,
    }
);

// ─── Compound Indexes ─────────────────────────────────────────────────────────
contactSchema.index({ userId: 1, email: 1 }, { unique: true }); // one email per user
contactSchema.index({ userId: 1, status: 1 });
contactSchema.index({ userId: 1, tags: 1 });

// ─── Virtual: full name ────────────────────────────────────────────────────────
contactSchema.virtual('fullName').get(function () {
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

const Contact = mongoose.model('Contact', contactSchema);
module.exports = Contact;