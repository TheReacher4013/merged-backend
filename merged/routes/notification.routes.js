const router = require('express').Router();
const ctrl   = require('../controllers/notification.controller');
const { protect: auth } = require('../middleware/auth.middleware');
const admin  = require('../middleware/isAdmin');

router.use(auth);

router.get('/',          ctrl.getNotifications);
router.get('/count',     ctrl.getUnreadCount);
router.patch('/read-all', ctrl.markAllRead);
router.patch('/:id/read', ctrl.markRead);
router.delete('/:id',    ctrl.deleteNotification);
router.post('/broadcast', admin, ctrl.broadcast);   // admin only

module.exports = router;
