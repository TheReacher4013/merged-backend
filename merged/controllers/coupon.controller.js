const CouponService = require('../services/coupon.service');

// POST /api/coupons/validate
exports.validate = async (req, res) => {
  try {
    const { code, planId } = req.body;
    if (!code || !planId) return res.status(400).json({ success: false, message: 'code and planId required' });

    const result = await CouponService.validate({ code, planId, userId: req.user._id });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/coupons  [Admin]
exports.getAll = async (req, res) => {
  try {
    const result = await CouponService.getAll(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/coupons  [Admin]
exports.create = async (req, res) => {
  try {
    const coupon = await CouponService.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json({ success: true, coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Coupon code already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/coupons/:id  [Admin]
exports.update = async (req, res) => {
  try {
    const coupon = await CouponService.update(req.params.id, req.body);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/coupons/:id  [Admin]
exports.delete = async (req, res) => {
  try {
    await CouponService.delete(req.params.id);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
