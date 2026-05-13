const ReferralService = require('../services/referral.service');

// GET /api/referrals/my  — referrer's referrals
exports.getMyReferrals = async (req, res) => {
  try {
    const result = await ReferralService.getByReferrer(req.user._id, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/referrals/stats
exports.getStats = async (req, res) => {
  try {
    const stats = await ReferralService.getStats(req.user._id);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/referrals/my-code
exports.getMyCode = async (req, res) => {
  try {
    const referralCode = req.user.referralCode;
    const referralLink = `${process.env.FRONTEND_URL}/signup?ref=${referralCode}`;
    res.json({ success: true, referralCode, referralLink });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
