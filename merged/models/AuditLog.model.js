const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
    {
        // Who performed the action
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null, // null = system action
        },
        userName:  { type: String, default: 'System' },
        userEmail: { type: String, default: '' },
        userRole:  { type: String, default: '' },

        // What was done
        action: {
            type: String,
            required: true,
            enum: [
                // Auth
                'USER_REGISTER', 'USER_LOGIN', 'USER_LOGOUT',
                'PASSWORD_RESET', 'EMAIL_VERIFIED', '2FA_ENABLED', '2FA_DISABLED',

                // Campaigns
                'CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_DELETED',
                'CAMPAIGN_SENT', 'CAMPAIGN_SCHEDULED', 'CAMPAIGN_PAUSED',
                'CAMPAIGN_APPROVED', 'CAMPAIGN_SUBMITTED',

                // Contacts
                'CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_DELETED',
                'CONTACTS_IMPORTED', 'CONTACTS_EXPORTED',
                'SEGMENT_CREATED', 'SEGMENT_DELETED',

                // Templates
                'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'TEMPLATE_DELETED',
                'TEMPLATE_PUBLISHED', 'TEMPLATE_DUPLICATED',

                // Automations
                'AUTOMATION_CREATED', 'AUTOMATION_UPDATED', 'AUTOMATION_DELETED',
                'AUTOMATION_ACTIVATED', 'AUTOMATION_PAUSED',

                // Admin Actions
                'USER_ROLE_CHANGED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_DELETED',
                'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_DELETED',

                // Billing
                'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_CANCELLED', 'SUBSCRIPTION_RENEWED',
                'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'REFUND_ISSUED',

                // API Keys
                'API_KEY_CREATED', 'API_KEY_REVOKED', 'API_KEY_REGENERATED',

                // WhatsApp
                'WHATSAPP_CAMPAIGN_CREATED', 'WHATSAPP_CAMPAIGN_SENT',
                'WHATSAPP_TEMPLATE_CREATED',
            ],
        },

        // Which module
        module: {
            type: String,
            required: true,
            enum: [
                'auth', 'campaign', 'contact', 'template',
                'automation', 'analytics', 'admin', 'billing',
                'api_key', 'whatsapp', 'system',
            ],
        },

        // Human-readable description
        description: { type: String, required: true },

        // ID of the resource affected (campaign id, contact id, etc.)
        resourceId:   { type: String, default: null },
        resourceType: { type: String, default: null },

        // Extra details (old value, new value, etc.)
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

        // Request info
        ipAddress: { type: String, default: null },
        userAgent:  { type: String, default: null },

        // Status of the action
        status: {
            type: String,
            enum: ['success', 'failure'],
            default: 'success',
        },
        errorMessage: { type: String, default: null },
    },
    {
        timestamps: true,
    }
);

// Indexes for fast querying
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

// Auto-delete logs older than 90 days
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
