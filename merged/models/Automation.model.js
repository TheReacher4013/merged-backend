const mongoose = require('mongoose');

//Individual Step/Node Schema
const stepSchema = new mongoose.Schema(
    {
        stepId: { type: String, required: true },        // unique id within workflow e.g. 'step_1'
        type: {
            type: String,
            required: true,
            enum: ['trigger', 'action', 'delay', 'condition', 'goal', 'exit'],
        },

        // Trigger config
        triggerType: {
            type: String,
            enum: [
                'contact_added',       // new contact added to list
                'tag_added',           // tag assigned to contact
                'form_submitted',      // external form webhook
                'campaign_opened',     // opened a specific campaign
                'campaign_clicked',    // clicked in a specific campaign
                'date_based',          // specific date (e.g. birthday)
                'webhook',             // external trigger via API
                'segment_entered',     // contact matches segment
            ],
        },
        triggerConfig: { type: mongoose.Schema.Types.Mixed },  // { campaignId, tag, segmentId, etc. }

        // Action config
        actionType: {
            type: String,
            enum: ['send_email', 'add_tag', 'remove_tag', 'update_field', 'send_whatsapp', 'webhook_call'],
        },
        actionConfig: { type: mongoose.Schema.Types.Mixed },   // { templateId, tag, fieldKey, fieldValue, url }

        // Delay config
        delayAmount: { type: Number },
        delayUnit: { type: String, enum: ['minutes', 'hours', 'days', 'weeks'] },
        delayUntilTime: { type: String },   // e.g. '10:00' — send at specific time after delay

        // Condition (if/else branching)
        conditionField: { type: String },   // 'email_opened', 'tag', 'custom_field'
        conditionOperator: { type: String, enum: ['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'] },
        conditionValue: { type: mongoose.Schema.Types.Mixed },
        yesStepId: { type: String },        // next step if condition true
        noStepId: { type: String },         // next step if condition false

        // Next step (for linear steps)
        nextStepId: { type: String },

        // Position in visual builder (x, y coordinates)
        position: { x: Number, y: Number },
    },
    { _id: false }
);

//Automation Schema 
const automationSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },

        name: { type: String, required: true, trim: true },
        description: { type: String },

        status: {
            type: String,
            enum: ['draft', 'active', 'paused', 'archived'],
            default: 'draft',
            index: true,
        },

        steps: [stepSchema],               // all nodes in the workflow
        entryStepId: { type: String },     // first step to execute (trigger)

        //Stats 
        stats: {
            enrolled: { type: Number, default: 0 },      // total contacts entered
            active: { type: Number, default: 0 },         // currently in workflow
            completed: { type: Number, default: 0 },
            exited: { type: Number, default: 0 },
            converted: { type: Number, default: 0 },      // reached goal step
        },

        //Settings
        allowReEnrollment: { type: Boolean, default: false },  // can contact enter again after completing
        goalTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },  // for goal step

        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

//Enrollment Schema — tracks each contact's progress through automation
const enrollmentSchema = new mongoose.Schema(
    {
        automationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
        contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

        status: {
            type: String,
            enum: ['active', 'completed', 'exited', 'failed'],
            default: 'active',
            index: true,
        },

        currentStepId: { type: String },
        nextRunAt: { type: Date, index: true },     // when next step should execute (for delays)

        stepHistory: [
            {
                stepId: String,
                executedAt: { type: Date, default: Date.now },
                result: String,                          // 'success', 'failed', 'skipped'
                note: String,
            },
        ],

        enrolledAt: { type: Date, default: Date.now },
        completedAt: { type: Date },
        exitedAt: { type: Date },
        exitReason: { type: String },
    },
    { timestamps: true }
);

enrollmentSchema.index({ automationId: 1, contactId: 1 }, { unique: true });
enrollmentSchema.index({ nextRunAt: 1, status: 1 });   // for cron job: find due enrollments

const Automation = mongoose.model('Automation', automationSchema);
const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

module.exports = { Automation, Enrollment };