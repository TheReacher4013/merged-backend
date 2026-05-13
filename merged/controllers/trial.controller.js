const TrialService        = require('../services/trial.service');
const SubscriptionService = require('../services/subscription.service');

// POST /api/trial/start
exports.startTrial = async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ success: false, message: 'planId required' });

    const eligibility = await TrialService.checkEligibility(req.user._id, {
      ipAddress:         req.ip,
      deviceFingerprint: req.body.deviceFingerprint,
    });

    if (!eligibility.eligible) {
      return res.status(403).json({ success: false, message: eligibility.reason });
    }

    const subscription = await SubscriptionService.startTrial(req.user._id, planId);
    res.status(201).json({ success: true, subscription });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/trial/status
exports.getTrialStatus = async (req, res) => {
  try {
    const subscription = await SubscriptionService.getByUser(req.user._id);
    if (!subscription || subscription.status !== 'trialing') {
      return res.json({ success: true, onTrial: false, subscription });
    }

    const now         = new Date();
    const msRemaining = subscription.trialEnd - now;
    const daysLeft    = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));

    res.json({
      success: true,
      onTrial: true,
      daysLeft,
      trialEnd:  subscription.trialEnd,
      subscription,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
