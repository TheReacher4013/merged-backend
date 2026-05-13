const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
    {
        id:{type:String, required: true},
        type:{
            type:String,
            required:true,
            enum:['text', 'image', 'button', 'divider', 'spacer', 'columns', 'header', 'footer', 'social'],
        },

        content: {type:mongoose.Schema.Types.Mixed},
        styles:{type:mongoose.Schema.Types.Mixed},
        order:{type:Number},
    },
    {_id:false}
);

const templateSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },

        name: {
            type: String,
            required: [true, 'Template name is required'],
            trim: true,
            maxlength: [200, 'Name cannot exceed 200 characters'],
        },
        description: { type: String, trim: true },

        // ─── Template Type ──────────────────────────────────────────────────────────
        category: {
            type: String,
            enum: ['newsletter', 'promotional', 'transactional', 'welcome', 'drip', 'custom'],
            default: 'custom',
        },

        // ─── Content ────────────────────────────────────────────────────────────────
        subject: {
            type: String,
            trim: true,
            maxlength: [998, 'Subject line too long'], // RFC limit
        },
        previewText: { type: String, trim: true, maxlength: 200 }, // email snippet text

        // Drag-and-drop blocks (JSON structure)
        blocks: [blockSchema],

        // Compiled HTML output (rendered from blocks OR hand-coded HTML mode)
        htmlContent: { type: String },

        // Plain text fallback
        textContent: { type: String },

        // ─── Editor Mode ────────────────────────────────────────────────────────────
        editorMode: {
            type: String,
            enum: ['drag_drop', 'html'],
            default: 'drag_drop',
        },

        // ─── Merge Tags Used ─────────────────────────────────────────────────────────
        // e.g. ['{{name}}', '{{company}}'] — extracted on save
        mergeTags: [{ type: String }],

        // ─── Thumbnail (S3 URL) ────────────────────────────────────────────────────
        thumbnailUrl: { type: String },

        // ─── Status ─────────────────────────────────────────────────────────────────
        status: {
            type: String,
            enum: ['draft', 'published', 'archived'],
            default: 'draft',
        },

        // ─── Gallery / Shared ─────────────────────────────────────────────────────
        isGalleryTemplate: { type: Boolean, default: false }, // pre-built templates visible to all
        isShared: { type: Boolean, default: false },          // shared within tenant

        isDeleted: { type: Boolean, default: false },
    },
    {
        timestamps: true,
    }
);

// ─── Indexes ───────────────────────────────────────────────────────────────────
templateSchema.index({ userId: 1, status: 1 });
templateSchema.index({ isGalleryTemplate: 1 });

// ─── Pre-save: Extract merge tags from HTML ────────────────────────────────────
templateSchema.pre('save', function (next) {
    if (this.htmlContent) {
        const regex = /\{\{(\w+)\}\}/g;
        const tags = [];
        let match;
        while ((match = regex.exec(this.htmlContent)) !== null) {
            if (!tags.includes(`{{${match[1]}}}`)) {
                tags.push(`{{${match[1]}}}`);
            }
        }
        this.mergeTags = tags;
    }
    next();
});

const Template = mongoose.model('Template', templateSchema);
module.exports = Template;
