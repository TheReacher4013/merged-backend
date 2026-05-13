const Notification = require('../models/Notification.model');

class NotificationService {
  /**
   * Create and deliver a notification to one user
   * @param {ObjectId} userId
   * @param {Object}   payload - { type, title, message, link, channels, expiresAt }
   */
  static async create(userId, payload) {
    const { type = 'info', title, message, link = null, channels = ['inapp'], expiresAt = null } = payload;

    // 1. Always persist in-app notification
    const notification = await Notification.create({
      userId, type, title, message, link, channels, expiresAt,
    });

    // 2. Queue email if requested
    if (channels.includes('email')) {
      // In production: add to BullMQ email queue
      // emailQueue.add({ userId, title, message, link });
      console.log(`[Notification] Email queued for user ${userId}`);
    }

    // 3. Push notification via FCM/APNs if requested
    if (channels.includes('push')) {
      // pushService.send(userId, { title, message });
      console.log(`[Notification] Push queued for user ${userId}`);
    }

    // 4. Socket.io real-time emit
    // io.to(`user:${userId}`).emit('notification:new', notification);

    return notification;
  }

  /**
   * Broadcast a notification to multiple users (admin use)
   * @param {ObjectId[]} userIds
   * @param {Object}     payload
   */
  static async broadcast(userIds, payload) {
    const docs = userIds.map(userId => ({
      userId,
      type: payload.type || 'info',
      title: payload.title,
      message: payload.message,
      link: payload.link || null,
      channels: payload.channels || ['inapp'],
    }));
    return Notification.insertMany(docs, { ordered: false });
  }

  /**
   * Get paginated notifications for a user
   */
  static async getForUser(userId, { page = 1, limit = 20, type, isRead } = {}) {
    const query = { userId, isDeleted: false };
    if (type)    query.type   = type;
    if (isRead !== undefined) query.isRead = isRead;

    const [data, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ userId, isRead: false, isDeleted: false }),
    ]);

    return { data, total, unreadCount, page: Number(page), limit: Number(limit) };
  }

  static async getUnreadCount(userId) {
    return Notification.countDocuments({ userId, isRead: false, isDeleted: false });
  }

  static async markRead(notificationId, userId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true },
      { new: true }
    );
  }

  static async markAllRead(userId) {
    return Notification.updateMany({ userId, isRead: false }, { isRead: true });
  }

  static async softDelete(notificationId, userId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isDeleted: true },
      { new: true }
    );
  }
}

module.exports = NotificationService;
