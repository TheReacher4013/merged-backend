const express = require('express');
const router = express.Router();
const {
    getDashboard, getEngagementTimeline, getBestSendTime,
    getDeviceBreakdown, getCohortAnalysis, exportAnalytics, spamCheckEndpoint,
} = require('../controllers/analytics.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

router.use(protect);

router.get('/dashboard', getDashboard);
router.get('/engagement', getEngagementTimeline);
router.get('/best-send-time', getBestSendTime);
router.get('/devices', getDeviceBreakdown);
router.get('/cohort', getCohortAnalysis);
router.get('/export', exportAnalytics);
router.post('/spam-check', spamCheckEndpoint);

module.exports = router;