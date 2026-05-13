const mongoose = require('mongoose');

const abVariantSchema = new mongoose.Schema({
    variantId: {type: String},  // A or B
    subject: {type: String },
    htmlContent:{type: String},
    splitPercent: {type: Number}, // % of audience for this variant
    sentCount: {type: Number, default: 0},
    openRate: {type: Number, default:0},
    clickRate: {type: Number, default: 0},
},

{_id: false}

);

const campaignSchema = new mongoose.Schema(
    {
        userId : {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true},
        
        tenantId: {type : mongoose.Schema.Types.ObjectId, ref:'Tenant', index: true},

        //Basic info
        name: {type:String, required:true, trim: true, maxlength: 200},
        description: {type: String, trim: true},
        type: {
            type: String,
            enum: ['regular', 'ab_test', 'drip', 'transactional'],
            default: 'regular',
        },

        //email content
        subject:{type: String, required:true, trim:true},
        previewText: {type: String, trim: true},
        fromName: {type: String, trim: true},
        fromEmail: {type: String, trim: true},
        replyTo: {type: String, trim: true},
        templateId: {type: mongoose.Schema.Types.ObjectId, ref: 'Template'},
        htmlContent:{type: String},
        textContent: {type: String},
    
        //Recipients

        recipientType:{
            type: String,
            enum: ['all', 'segment', 'tag', 'manual'],
            default: 'all',
        },

        segmentIds: [{type: mongoose.Schema.Types.ObjectId, ref: 'segment'}],

        tags:[{type: String}],

        manualContactIds:[{type: mongoose.Schema.Types.ObjectId, ref: 'Contact'}],

        //status & schedule
        status:{
            type: String,
            enum:['draft', 'pending_approval', 'approved', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'],
            
            default:'draft',
            index:true,
        },

        scheduledAt: {type: Date, index: true},
        sentAt: {type: Date},
        timezone : {type:String, default: 'Asia/kolkata'},

        //Approval workflow
        approvedBy:{type: mongoose.Schema.Types.ObjectId, ref: 'User'},
        approvedAt : {type:Date},
        rejectedReason: {type:String},

        //A/B testing
        isABTest: {type: Boolean, default: false},
        abVariants: [abVariantSchema],
        abWinnerVariant : {type:String},
        abTestDurationHours: {type: Number, default:4},
        abWinnerMetric: {type:String, enum:['open_rate', 'click_rate'], default: 'open_rate'},

        //Cached Status (updated by tracking system)
        stats: {
            totalRecipients: { type: Number, default: 0 },
            sent: { type: Number, default: 0 },
            delivered: { type: Number, default: 0 },
            opened: { type: Number, default: 0 },
            uniqueOpens: { type: Number, default: 0 },
            clicked: { type: Number, default: 0 },
            uniqueClicks: { type: Number, default: 0 },
            bounced: { type: Number, default: 0 },
            hardBounced: { type: Number, default: 0 },
            softBounced: { type: Number, default: 0 },
            unsubscribed: { type: Number, default: 0 },
            complained: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
        },

        //Settings 
        trackOpens: { type: Boolean, default: true },
        trackClicks: { type: Boolean, default: true },
        unsubscribeLink: { type: Boolean, default: true },

        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

campaignSchema.index({ userId: 1, status: 1 });
campaignSchema.index({ scheduledAt: 1, status: 1 });
campaignSchema.index({ userId: 1, createdAt: -1 });

const Campaign = mongoose.model('Campaign', campaignSchema);
module.exports = Campaign;

