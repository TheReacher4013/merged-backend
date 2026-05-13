const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        // ─── Basic Info ──────────────────────────────────────────────────────────
        name: {
            type: String,
            required: [true, 'Name is required'],
            trim: true,
            maxlength: [100, 'Name cannot exceed 100 characters'],
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
        },
        password: {
            type: String,
            minlength: [8, 'Password must be at least 8 characters'],
            select: false, // Never return password in queries
        },

        // ─── Role & Status ───────────────────────────────────────────────────────
        role: {
            type: String,
            enum: ['super_admin', 'business_admin', 'marketing_manager', 'viewer', 'individual'],
            default: 'individual',
        },
        isActive: { type: Boolean, default: true },
        isEmailVerified: { type: Boolean, default: false },

        // ─── OAuth ───────────────────────────────────────────────────────────────
        authProvider: {
            type: String,
            enum: ['local', 'google', 'facebook', 'microsoft'],
            default: 'local',
        },
        googleId: { type: String, sparse: true },
        facebookId: { type: String, sparse: true },
        avatar: { type: String },

        // ─── Email Verification ───────────────────────────────────────────────────
        emailVerificationToken: { type: String, select: false },
        emailVerificationExpiry: { type: Date, select: false },

        // ─── Password Reset ───────────────────────────────────────────────────────
        passwordResetToken: { type: String, select: false },
        passwordResetExpiry: { type: Date, select: false },

        // ─── Two-Factor Auth (TOTP) ────────────────────────────────────────────────
        twoFactorSecret: { type: String, select: false },
        isTwoFactorEnabled: { type: Boolean, default: false },

        // ─── Refresh Token ────────────────────────────────────────────────────────
        refreshTokens: [
            {
                token: { type: String },
                createdAt: { type: Date, default: Date.now },
                expiresAt: { type: Date },
            },
        ],

        // ─── Brute Force Protection ───────────────────────────────────────────────
        loginAttempts: { type: Number, default: 0 },
        lockUntil: { type: Date },

        // ─── Tenant (Multi-tenant SaaS) ───────────────────────────────────────────
        tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },

        lastLoginAt: { type: Date },

        // ─── Referral System ──────────────────────────────────────────────────
        referralCode:    { type: String, unique: true, sparse: true },
        referredBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        referralCount:   { type: Number, default: 0 },
        referralCredits: { type: Number, default: 0 }, // in paise (₹)

        // ─── Fraud Prevention ─────────────────────────────────────────────────
        deviceFingerprint: { type: String, default: null },
        lastLoginIp:       { type: String, default: null },
    },
    {
        timestamps: true, // createdAt, updatedAt auto-added
    }
);

// ─── Indexes ────────────────────────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ tenantId: 1 });

// ─── Pre-save: Hash password ────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

// ─── Pre-save: Auto-generate referral code ────────────────────────────────────
userSchema.pre('save', function (next) {
    if (this.isNew && !this.referralCode) {
        const crypto = require('crypto');
        const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
        this.referralCode = `NV-${suffix}`;
    }
    next();
});

// ─── Methods ─────────────────────────────────────────────────────────────────

// Compare entered password with hashed
userSchema.methods.comparePassword = async function (enteredPassword) {
    return bcrypt.compare(enteredPassword, this.password);
};

// Check if account is locked (brute-force)
userSchema.methods.isLocked = function () {
    return this.lockUntil && this.lockUntil > Date.now();
};

// Increment login attempts with progressive lockout
userSchema.methods.incrementLoginAttempts = async function () {
    // If previous lock expired, reset
    if (this.lockUntil && this.lockUntil < Date.now()) {
        this.loginAttempts = 1;
        this.lockUntil = undefined;
    } else {
        this.loginAttempts += 1;
        // Lock after 5 failed attempts: 2min, 10min, 30min progressively
        if (this.loginAttempts >= 5) {
            const lockDurations = [2, 10, 30]; // minutes
            const lockIndex = Math.min(Math.floor((this.loginAttempts - 5) / 2), 2);
            this.lockUntil = new Date(Date.now() + lockDurations[lockIndex] * 60 * 1000);
        }
    }
    await this.save();
};

// Reset login attempts on successful login
userSchema.methods.resetLoginAttempts = async function () {
    this.loginAttempts = 0;
    this.lockUntil = undefined;
    this.lastLoginAt = new Date();
    await this.save();
};

const User = mongoose.model('User', userSchema);
module.exports = User;