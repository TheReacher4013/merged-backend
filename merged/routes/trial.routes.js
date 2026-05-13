const router = require('express').Router();
const ctrl   = require('../controllers/trial.controller');
const { protect: auth } = require('../middleware/auth.middleware');

router.use(auth);

router.post('/start',    ctrl.startTrial);
router.get('/status',    ctrl.getTrialStatus);

module.exports = router;
