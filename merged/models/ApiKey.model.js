const mongoose = require('mongoose');
const crypto   = require('crypto');

const apiKeySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        // Display name given by user e.g. "Production App", "Zapier Integration"
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },

        // The actual key — stored as hash, shown to user ONCE on creation
        keyHash: {
            type: String,
            required: true,
            unique: true,
        },

        // First 8 chars of raw key shown in UI for identification e.g. "em_live_Ab3xYz12..."
        keyPrefix: {
            type: String,
            required: true,
        },

        // Scopes / permissions this key has
        scopes: [{
            type: String,
            enum: [
                'contacts:read',  'contacts:write',
                'campaigns:read', 'campaigns:write',
                'templates:read', 'templates:write',
                'analytics:read',
                'automations:read', 'automations:write',
                'webhooks:read',  'webhooks:write',
                'all',            // Full access
            ],
        }],

        isActive: { type: Boolean, default: true },

        // Optional expiry date — null = never expires
        expiresAt: { type: Date, default: null },

        // Usage tracking
        lastUsedAt:  { type: Date, default: null },
        usageCount:  { type: Number, default: 0 },

        // Optional IP whitelist — empty array = any IP allowed
        allowedIps: [{ type: String }],
    },
    { timestamps: true }
);

// ─── Static: generate a new raw API key ───────────────────────────────────────
// Returns { rawKey, keyHash, keyPrefix }
apiKeySchema.statics.generateKey = function () {
    const rawKey   = 'em_live_' + crypto.randomBytes(32).toString('hex'); // 72 chars
    const keyHash  = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 16); // "em_live_XXXXXXXX"
    return { rawKey, keyHash, keyPrefix };
};

// ─── Static: find key by raw value ───────────────────────────────────────────
apiKeySchema.statics.findByRawKey = function (rawKey) {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    return this.findOne({ keyHash, isActive: true });
};

// ─── Instance: check if expired ───────────────────────────────────────────────
apiKeySchema.methods.isExpired = function () {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
};

apiKeySchema.index({ keyHash: 1 });
apiKeySchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('ApiKey', apiKeySchema);
