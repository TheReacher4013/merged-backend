const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

// ─── Your Routes ──────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth.routes');
const contactRoutes = require('./routes/contact.routes');
const templateRoutes = require('./routes/template.routes');
const campaignRoutes = require('./routes/campaign.routes');
const automationRoutes = require('./routes/automation.routes');
const trackingRoutes = require('./routes/tracking.routes');
const analyticsRoutes = require('./routes/analytics.routes');

// ─── Friend's 8 Module Routes ─────────────────────────────────────────────────
const notificationRoutes = require('./routes/notification.routes');
const announcementRoutes = require('./routes/announcement.routes');
const couponRoutes = require('./routes/coupon.routes');
const referralRoutes = require('./routes/referral.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const razorpayRoutes = require('./routes/razorpay.routes');
const trialRoutes = require('./routes/trial.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');

// ─── Middleware & Workers ─────────────────────────────────────────────────────
const { errorHandler } = require('./middleware/errorHandler');
const { scheduleAutomationRunner } = require('./jobs/cronJobs');
const { initWorkers } = require('./jobs/emailWorker');

// ─── Cron jobs from friend's modules (trial expiry, subscription renewal, etc.)
require('./utils/cron');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(morgan('dev'));
app.use(cookieParser());

// Razorpay webhook needs raw body — must be BEFORE express.json()
app.use('/api/razorpay/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images locally (replaces S3)
app.use('/uploads', express.static('uploads'));

// ─── Your Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/track', trackingRoutes);   // public — no auth
app.use('/api/analytics', analyticsRoutes);

// ─── Friend's 8 Module Routes ─────────────────────────────────────────────────
app.use('/api/notifications', notificationRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/trial', trialRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── MongoDB + Server Start ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB Connected');
        initWorkers();
        scheduleAutomationRunner();
        app.listen(process.env.PORT || 5000, () => {
            console.log('🚀 Server running on port ' + (process.env.PORT || 5000));
        });
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

module.exports = app;
