const router = require('express').Router();
const ctrl   = require('../controllers/coupon.controller');
const { protect: auth } = require('../middleware/auth.middleware');
const admin  = require('../middleware/isAdmin');

router.use(auth);

router.post('/validate', ctrl.validate);    // users can validate

// Admin routes
router.get('/',          admin, ctrl.getAll);
router.post('/',         admin, ctrl.create);
router.put('/:id',       admin, ctrl.update);
router.delete('/:id',    admin, ctrl.delete);

module.exports = router;
