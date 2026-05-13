const router = require('express').Router();
const ctrl   = require('../controllers/razorpay.controller');
const { protect: auth } = require('../middleware/auth.middleware');
const admin  = require('../middleware/isAdmin');

// Webhook MUST be before auth — Razorpay calls this without JWT
router.post('/webhook', ctrl.webhook);

router.use(auth);

router.post('/create-order',         ctrl.createOrder);
router.post('/create-subscription',  ctrl.createSubscription);
router.post('/verify-payment',       ctrl.verifyPayment);
router.get('/payments',              ctrl.getPaymentHistory);
router.post('/refund',               admin, ctrl.refund);

module.exports = router;
