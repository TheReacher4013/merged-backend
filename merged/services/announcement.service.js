const Announcement = require('../models/Announcement.model');
const Subscription  = require('../models/Subscription.model');

class AnnouncementService {
  /**
   * Get active announcements for a given user based on audience targeting
   */
  static async getActiveForUser(userId) {
    const now = new Date();

    // Fetch all currently active announcements in window
    const all = await Announcement.find({
      isActive: true,
      startAt:  { $lte: now },
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    })
      .sort({ priority: -1 })
      .lean();

    // Determine user's subscription status for targeting
    const sub = await Subscription.findOne({ userId }).sort({ createdAt: -1 }).lean();
    const userStatus = sub ? sub.status : 'free'; // trialing | active | free

    // Filter by audience
    const filtered = all.filter(a => {
      if (a.dismissedBy && a.dismissedBy.map(String).includes(String(userId))) return false;
      if (a.targetAudience === 'all')    return true;
      if (a.targetAudience === 'free')   return !sub || sub.status === 'expired';
      if (a.targetAudience === 'paid')   return sub && sub.status === 'active';
      if (a.targetAudience === 'trial')  return sub && sub.status === 'trialing';
      if (a.targetAudience === 'specific_plan') {
        return sub && a.planIds.map(String).includes(String(sub.planId));
      }
      return false;
    });

    return filtered;
  }

  static async create(data) {
    return Announcement.create(data);
  }

  static async update(id, data) {
    return Announcement.findByIdAndUpdate(id, data, { new: true });
  }

  static async dismiss(announcementId, userId) {
    return Announcement.findByIdAndUpdate(
      announcementId,
      { $addToSet: { dismissedBy: userId } },
      { new: true }
    );
  }

  static async getAll({ page = 1, limit = 20 } = {}) {
    const [data, total] = await Promise.all([
      Announcement.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Announcement.countDocuments(),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  static async deactivateExpired() {
    const now = new Date();
    const result = await Announcement.updateMany(
      { isActive: true, endAt: { $lte: now } },
      { isActive: false }
    );
    return result.modifiedCount;
  }

  static async delete(id) {
    return Announcement.findByIdAndDelete(id);
  }
}

module.exports = AnnouncementService;
