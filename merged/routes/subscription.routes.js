const router = require('express').Router();
const ctrl   = require('../controllers/subscription.controller');
const { protect: auth } = require('../middleware/auth.middleware');
const admin  = require('../middleware/isAdmin');

router.use(auth);

router.get('/my',               ctrl.getMy);
router.post('/cancel',          ctrl.cancel);

// Admin routes
router.get('/',                   admin, ctrl.getAll);
router.post('/:id/extend-trial',  admin, ctrl.extendTrial);

module.exports = router;
