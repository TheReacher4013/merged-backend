const SubscriptionService = require('../services/subscription.service');

// GET /api/subscriptions/my
exports.getMy = async (req, res) => {
  try {
    const subscription = await SubscriptionService.getByUser(req.user._id);
    res.json({ success: true, subscription });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/subscriptions/cancel
exports.cancel = async (req, res) => {
  try {
    const sub = await SubscriptionService.cancel(req.user._id);
    if (!sub) return res.status(404).json({ success: false, message: 'No active subscription found' });
    res.json({ success: true, message: 'Subscription will be cancelled at period end', subscription: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/subscriptions  [Admin]
exports.getAll = async (req, res) => {
  try {
    const result = await SubscriptionService.getAll(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/subscriptions/:id/extend-trial  [Admin]
exports.extendTrial = async (req, res) => {
  try {
    const { days, reason } = req.body;
    if (!days) return res.status(400).json({ success: false, message: 'days required' });
    const sub = await SubscriptionService.extendTrial(req.params.id, days, req.user._id, reason);
    res.json({ success: true, subscription: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
