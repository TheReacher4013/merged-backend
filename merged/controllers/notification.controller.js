const NotificationService = require('../services/notification.service');

// GET /api/notifications
exports.getNotifications = async (req, res) => {
  try {
    const { page, limit, type, isRead } = req.query;
    const result = await NotificationService.getForUser(req.user._id, {
      page, limit, type,
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/notifications/count
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user._id);
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    const notification = await NotificationService.markRead(req.params.id, req.user._id);
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/notifications/read-all
exports.markAllRead = async (req, res) => {
  try {
    const result = await NotificationService.markAllRead(req.user._id);
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/notifications/:id
exports.deleteNotification = async (req, res) => {
  try {
    await NotificationService.softDelete(req.params.id, req.user._id);
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/notifications/broadcast  [Admin only]
exports.broadcast = async (req, res) => {
  try {
    const { userIds, type, title, message, link, channels } = req.body;
    if (!userIds?.length) return res.status(400).json({ success: false, message: 'userIds required' });
    const result = await NotificationService.broadcast(userIds, { type, title, message, link, channels });
    res.status(201).json({ success: true, count: result.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
