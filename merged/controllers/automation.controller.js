const { Automation, Enrollment } = require('../models/Automation.model');
const { enrollContact } = require('../services/automation.service');
const { asyncHandler } = require('../middleware/errorHandler');

// ─── @desc  Get all automations
// ─── @route GET /api/automations
const getAutomations = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const query = { userId: req.user._id, isDeleted: false };
    if (status) query.status = status;

    const automations = await Automation.find(query).sort({ createdAt: -1 }).select('-steps');
    res.json({ success: true, data: automations });
});

// ─── @desc  Get single automation with all steps
// ─── @route GET /api/automations/:id
const getAutomation = asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found.' });
    res.json({ success: true, data: automation });
});

// ─── @desc  Create automation
// ─── @route POST /api/automations
const createAutomation = asyncHandler(async (req, res) => {
    const { name, description, steps, entryStepId, allowReEnrollment } = req.body;

    if (!steps?.length) {
        return res.status(400).json({ success: false, message: 'At least one step is required.' });
    }
    if (!entryStepId) {
        return res.status(400).json({ success: false, message: 'entryStepId is required.' });
    }

    const automation = await Automation.create({
        userId: req.user._id,
        tenantId: req.user.tenantId,
        name, description, steps, entryStepId,
        allowReEnrollment: allowReEnrollment || false,
        status: 'draft',
    });

    res.status(201).json({ success: true, message: 'Automation created.', data: automation });
});

// ─── @desc  Update automation (only if draft or paused)
// ─── @route PUT /api/automations/:id
const updateAutomation = asyncHandler(async (req, res) => {
    const automation = await Automation.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found.' });

    if (automation.status === 'active') {
        return res.status(400).json({ success: false, message: 'Pause the automation before editing.' });
    }

    const allowed = ['name', 'description', 'steps', 'entryStepId', 'allowReEnrollment'];
    allowed.forEach((f) => { if (req.body[f] !== undefined) automation[f] = req.body[f]; });
    await automation.save();

    res.json({ success: true, message: 'Automation updated.', data: automation });
});

// ─── @desc  Activate automation
// ─── @route POST /api/automations/:id/activate
const activateAutomation = asyncHandler(async (req, res) => {
    const automation = await Automation.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: { $in: ['draft', 'paused'] } },
        { status: 'active' },
        { new: true }
    );
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found or already active.' });
    res.json({ success: true, message: 'Automation activated.', data: automation });
});

// ─── @desc  Pause automation (no new enrollments; existing run to completion)
// ─── @route POST /api/automations/:id/pause
const pauseAutomation = asyncHandler(async (req, res) => {
    const automation = await Automation.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: 'active' },
        { status: 'paused' },
        { new: true }
    );
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found or not active.' });
    res.json({ success: true, message: 'Automation paused.', data: automation });
});

// ─── @desc  Delete automation (soft)
// ─── @route DELETE /api/automations/:id
const deleteAutomation = asyncHandler(async (req, res) => {
    const automation = await Automation.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, status: { $nin: ['active'] } },
        { isDeleted: true },
        { new: true }
    );
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found. Pause it before deleting.' });
    res.json({ success: true, message: 'Automation deleted.' });
});

// ─── @desc  Manually enroll a contact
// ─── @route POST /api/automations/:id/enroll
const enrollContactManual = asyncHandler(async (req, res) => {
    const { contactId } = req.body;
    const enrollment = await enrollContact(req.params.id, contactId, req.user._id);
    if (!enrollment) {
        return res.status(400).json({ success: false, message: 'Could not enroll contact. Automation may be inactive or contact already enrolled.' });
    }
    res.json({ success: true, message: 'Contact enrolled.', data: enrollment });
});

// ─── @desc  Get enrollments for automation
// ─── @route GET /api/automations/:id/enrollments
const getEnrollments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, status } = req.query;
    const query = { automationId: req.params.id };
    if (status) query.status = status;

    const total = await Enrollment.countDocuments(query);
    const enrollments = await Enrollment.find(query)
        .sort({ enrolledAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('contactId', 'email firstName lastName');

    res.json({
        success: true,
        data: enrollments,
        pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
});

// ─── @desc  Remove (exit) a contact from automation
// ─── @route DELETE /api/automations/:id/enrollments/:enrollmentId
const removeEnrollment = asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findOneAndUpdate(
        { _id: req.params.enrollmentId, automationId: req.params.id, status: 'active' },
        { status: 'exited', exitedAt: new Date(), exitReason: 'manually_removed' },
        { new: true }
    );
    if (!enrollment) return res.status(404).json({ success: false, message: 'Active enrollment not found.' });

    await Automation.findByIdAndUpdate(req.params.id, { $inc: { 'stats.active': -1, 'stats.exited': 1 } });
    res.json({ success: true, message: 'Contact removed from automation.' });
});

module.exports = {
    getAutomations,
    getAutomation,
    createAutomation,
    updateAutomation,
    activateAutomation,
    pauseAutomation,
    deleteAutomation,
    enrollContactManual,
    getEnrollments,
    removeEnrollment,
};