const mongoose = require('mongoose');
const Campaign = require('./Campaign.model');

const clickEventSchema = new mongoose.Schema(
    {
        url:{type: String},
        trackedUrl : {type: String},  //rewritten tracking url
        clickedAt : {type: Date},
        ipAddress: {type: String},
        userAgent: {type: String},
        country:{type: String},
        device:{type:String, enum:['desktop', 'mobile', 'tablet', 'unknown']},
    },
    {_id: false}
);

const emailLogSchema = new mongoose.Schema(
    {
        userId: {type:mongoose.Schema.Types.ObjectId, ref:'User', required: true, index:true},
        CampaignId:{type: mongoose.Schema.Types.ObjectId, ref:'Campaign', index:true},

        automationId: {type:mongoose.Schema.Types.ObjectId, ref:'Automation'},

        contactId:{type:mongoose.Schema.Types.ObjectId, ref:'Contact', required:true},
        abVariant: {type:String}, //"A or B for A/B test"

        //Email Details 
        toEmail: {type:String, required:true},
        subject:{type:String},
        fromEmail:{type: String},

        //provider info
        provider:{type: String, enum:['sendgrid', 'ses', 'mailgun'], default: 'sendgrid'},
        providerMessageId: { type: String, index: true },   // SendGrid/SES message ID for webhook matching
        trackingPixelId: { type: String, unique: true, sparse: true }, // unique ID embedded in open pixel

        //Delivery Status
        status: {
            type: String,
            enum: ['queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'failed'],
            default: 'queued',
            index: true,
        },

        //Open Tracking
        openedAt: { type: Date },
        openCount: { type: Number, default: 0 },
        lastOpenedAt: { type: Date },
        openIp: { type: String },
        openUserAgent: { type: String },
        openDevice: { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'] },
        openCountry: { type: String },

        // Click Tracking
        clickedAt: { type: Date },
        clickCount: { type: Number, default: 0 },
        clickEvents: [clickEventSchema],

        //Bounce
        bouncedAt: { type: Date },
        bounceType: { type: String, enum: ['hard', 'soft'] },
        bounceReason: { type: String },

        //Unsubscribe / Complaint
        unsubscribedAt: { type: Date },
        complainedAt: { type: Date },

        //Error
        error: { type: String },
        errorCode: { type: String },

        sentAt: { type: Date },
        queuedAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

emailLogSchema.index({ campaignId: 1, status: 1 });
emailLogSchema.index({ contactId: 1, campaignId: 1 }, { unique: true }); // prevent duplicate sends
emailLogSchema.index({ providerMessageId: 1 });
emailLogSchema.index({ trackingPixelId: 1 });

const EmailLog = mongoose.model('EmailLog', emailLogSchema);
module.exports = EmailLog;
