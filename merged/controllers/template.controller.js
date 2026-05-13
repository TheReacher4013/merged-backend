const sanitizeHtml = require('sanitize-html');
const Template = require('../models/Template.model');
const { asyncHandler } = require('../middleware/errorHandler');
// S3 not used — images stored locally in uploads/temp/

// ─── @desc  Get all templates for user
// ─── @route GET /api/templates
// ─── @access Private
const getTemplates = asyncHandler(async (req, res) => {
    const {
        page = 1, limit = 20,
        status, category, search, gallery,
    } = req.query;

    const query = { isDeleted: false };

    if (gallery === 'true') {
        // Pre-built gallery visible to all users
        query.isGalleryTemplate = true;
    } else {
        // User's own templates
        query.userId = req.user._id;
    }

    if (status) query.status = status;
    if (category) query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };

    const total = await Template.countDocuments(query);
    const templates = await Template.find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select('-htmlContent -blocks -textContent'); // lightweight list

    res.json({
        success: true,
        data: templates,
        pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
});

// ─── @desc  Get single template with full content
// ─── @route GET /api/templates/:id
// ─── @access Private
const getTemplate = asyncHandler(async (req, res) => {
    const template = await Template.findOne({
        _id: req.params.id,
        $or: [{ userId: req.user._id }, { isGalleryTemplate: true }],
        isDeleted: false,
    });

    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, data: template });
});

// ─── @desc  Create new template (drag-and-drop or HTML mode)
// ─── @route POST /api/templates
// ─── @access Private
const createTemplate = asyncHandler(async (req, res) => {
    const {
        name, description, category, subject, previewText,
        blocks, htmlContent, textContent, editorMode,
    } = req.body;

    // Sanitize HTML to prevent XSS
    const cleanHtml = htmlContent
        ? sanitizeHtml(htmlContent, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'head', 'html', 'body', 'link', 'meta']),
            allowedAttributes: false, // allow all attributes (needed for email HTML)
        })
        : undefined;

    const template = await Template.create({
        userId: req.user._id,
        tenantId: req.user.tenantId,
        name,
        description,
        category: category || 'custom',
        subject,
        previewText,
        blocks: blocks || [],
        htmlContent: cleanHtml,
        textContent,
        editorMode: editorMode || 'drag_drop',
        status: 'draft',
    });

    res.status(201).json({ success: true, message: 'Template created.', data: template });
});

// ─── @desc  Update template
// ─── @route PUT /api/templates/:id
// ─── @access Private
const updateTemplate = asyncHandler(async (req, res) => {
    const allowed = [
        'name', 'description', 'category', 'subject', 'previewText',
        'blocks', 'htmlContent', 'textContent', 'editorMode', 'status',
    ];

    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Sanitize HTML if updated
    if (updates.htmlContent) {
        updates.htmlContent = sanitizeHtml(updates.htmlContent, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'head', 'html', 'body', 'link', 'meta']),
            allowedAttributes: false,
        });
    }

    const template = await Template.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, isDeleted: false },
        updates,
        { new: true, runValidators: true }
    );

    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, message: 'Template updated.', data: template });
});

// ─── @desc  Duplicate template
// ─── @route POST /api/templates/:id/duplicate
// ─── @access Private
const duplicateTemplate = asyncHandler(async (req, res) => {
    const source = await Template.findOne({
        _id: req.params.id,
        $or: [{ userId: req.user._id }, { isGalleryTemplate: true }],
        isDeleted: false,
    });

    if (!source) return res.status(404).json({ success: false, message: 'Template not found.' });

    const copy = await Template.create({
        userId: req.user._id,
        tenantId: req.user.tenantId,
        name: `${source.name} (Copy)`,
        description: source.description,
        category: source.category,
        subject: source.subject,
        previewText: source.previewText,
        blocks: source.blocks,
        htmlContent: source.htmlContent,
        textContent: source.textContent,
        editorMode: source.editorMode,
        status: 'draft',
    });

    res.status(201).json({ success: true, message: 'Template duplicated.', data: copy });
});

// ─── @desc  Soft delete template
// ─── @route DELETE /api/templates/:id
// ─── @access Private
const deleteTemplate = asyncHandler(async (req, res) => {
    const template = await Template.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id },
        { isDeleted: true },
        { new: true }
    );
    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, message: 'Template deleted.' });
});

// ─── @desc  Upload image to S3 (used in template editor)
// ─── @route POST /api/templates/upload-image
// ─── @access Private
const uploadImage = asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image uploaded.' });
    }
    res.json({
        success: true,
        message: 'Image uploaded.',
        // Return locally accessible URL (served via /uploads/temp/ static route)
        data: { url: `${process.env.APP_BASE_URL}/uploads/temp/${req.file.filename}` },
    });
});

// ─── @desc  Preview template — render with sample merge tag data
// ─── @route POST /api/templates/:id/preview
// ─── @access Private
const previewTemplate = asyncHandler(async (req, res) => {
    const template = await Template.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });

    // Replace merge tags with sample data
    const sampleData = {
        name: req.user.name || 'John Doe',
        email: req.user.email || 'john@example.com',
        company: 'Acme Corp',
        unsubscribe_url: '#',
        ...req.body.sampleData,
    };

    let rendered = template.htmlContent || '';
    for (const [key, value] of Object.entries(sampleData)) {
        rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    res.json({ success: true, data: { html: rendered, subject: template.subject } });
});

// ─── @desc  Publish template (status: draft → published)
// ─── @route PATCH /api/templates/:id/publish
// ─── @access Private
const publishTemplate = asyncHandler(async (req, res) => {
    const template = await Template.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, isDeleted: false },
        { status: 'published' },
        { new: true }
    );
    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, message: 'Template published.', data: template });
});

module.exports = {
    getTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    duplicateTemplate,
    deleteTemplate,
    uploadImage,
    previewTemplate,
    publishTemplate,
};