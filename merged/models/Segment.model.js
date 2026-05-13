const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema(
    {
        field:{type: String, required:true},
        operator:{
            type: String,
            required:true,
            enum:['equals', 'not_equals', 'contains','not_contains', 'starts_with', 'ends_with', 'greater_than', 'less_than', 'is_set', 'is_not_set', 'in', 'not_in'],
        },
        value: {type:mongoose.Schema.Types.Mixed},
    },
     { _id: false}
);

const segmentSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },

        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true },

        // rule-based filter stored as JSON (AND logic between rules)
        rules: [ruleSchema],
        ruleLogic: { type: String, enum: ['AND', 'OR'], default: 'AND' },

        contactCount: { type: Number, default: 0 }, // cached count, refreshed on demand
        lastRefreshedAt: { type: Date },

        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

const Segment = mongoose.model('Segment', segmentSchema);
module.exports = Segment;
