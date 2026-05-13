const router = require('express').Router();
const ctrl   = require('../controllers/announcement.controller');
const { protect: auth } = require('../middleware/auth.middleware');
const admin  = require('../middleware/isAdmin');

router.use(auth);

router.get('/active',   ctrl.getActive);            // for users
router.post('/:id/dismiss', ctrl.dismiss);          // user dismisses

// Admin routes
router.get('/',         admin, ctrl.getAll);
router.post('/',        admin, ctrl.create);
router.put('/:id',      admin, ctrl.update);
router.delete('/:id',   admin, ctrl.delete);

module.exports = router;
