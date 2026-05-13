const AnnouncementService = require('../services/announcement.service');

// GET /api/announcements/active  — for logged-in users
exports.getActive = async (req, res) => {
  try {
    const announcements = await AnnouncementService.getActiveForUser(req.user._id);
    res.json({ success: true, data: announcements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/announcements  [Admin]
exports.getAll = async (req, res) => {
  try {
    const result = await AnnouncementService.getAll(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/announcements  [Admin]
exports.create = async (req, res) => {
  try {
    const announcement = await AnnouncementService.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/announcements/:id  [Admin]
exports.update = async (req, res) => {
  try {
    const announcement = await AnnouncementService.update(req.params.id, req.body);
    if (!announcement) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/announcements/:id/dismiss
exports.dismiss = async (req, res) => {
  try {
    await AnnouncementService.dismiss(req.params.id, req.user._id);
    res.json({ success: true, message: 'Announcement dismissed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/announcements/:id  [Admin]
exports.delete = async (req, res) => {
  try {
    await AnnouncementService.delete(req.params.id);
    res.json({ success: true, message: 'Announcement deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
