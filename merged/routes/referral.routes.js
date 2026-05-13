const router = require('express').Router();
const ctrl   = require('../controllers/referral.controller');
const { protect: auth } = require('../middleware/auth.middleware');

router.use(auth);

router.get('/my',       ctrl.getMyReferrals);
router.get('/stats',    ctrl.getStats);
router.get('/my-code',  ctrl.getMyCode);

module.exports = router;
