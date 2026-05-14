const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const multer = require('multer');
const Contact = require('../models/Contact.model');
const Segment = require('../models/Segment.model');
const { asyncHandler } = require('../middleware/errorHandler');

// Multer: temp disk storage for CSV/XLSX import
const upload = multer({
    dest: 'uploads/temp/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.mimetype) ||
            file.originalname.match(/\.(csv|xls|xlsx)$/)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV or Excel files allowed'));
        }
    },
});

// ─── @desc  Get all contacts (paginated + filtered)
// ─── @route GET /api/contacts
// ─── @access Private
const getContacts = asyncHandler(async (req, res) => {
    const {
        page = 1, limit = 50,
        status, tag, search,
        sortBy = 'createdAt', order = 'desc',
    } = req.query;

    const query = { userId: req.user._id, isDeleted: false };

    if (status) query.status = status;
    if (tag) query.tags = tag;
    if (search) {
        query.$or = [
            { email: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
            { company: { $regex: search, $options: 'i' } },
        ];
    }

    const total = await Contact.countDocuments(query);
    const contacts = await Contact.find(query)
        .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select('-engagementHistory'); // exclude heavy field in list view

    res.json({
        success: true,
        data: contacts,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / limit),
            limit: Number(limit),
        },
    });
});

// ─── @desc  Get single contact with full engagement history
// ─── @route GET /api/contacts/:id
// ─── @access Private
const getContact = asyncHandler(async (req, res) => {
    const contact = await Contact.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found.' });
    res.json({ success: true, data: contact });
});

// ─── @desc  Create single contact manually
// ─── @route POST /api/contacts
// ─── @access Private
const createContact = asyncHandler(async (req, res) => {
    const { email, firstName, lastName, phone, company, jobTitle, country, city, tags, customFields } = req.body;

    const existing = await Contact.findOne({ userId: req.user._id, email });
    if (existing) {
        return res.status(409).json({ success: false, message: 'Contact with this email already exists.' });
    }

    const contact = await Contact.create({
        userId: req.user._id,
        tenantId: req.user.tenantId,
        email,
        firstName,
        lastName,
        phone,
        company,
        jobTitle,
        country,
        city,
        tags: tags?.map((t) => t.toLowerCase().trim()) || [],
        customFields: customFields || {},
        source: 'manual',
    });

    res.status(201).json({ success: true, message: 'Contact created.', data: contact });
});

// ─── @desc  Update contact
// ─── @route PUT /api/contacts/:id
// ─── @access Private
const updateContact = asyncHandler(async (req, res) => {
    const allowed = ['firstName', 'lastName', 'phone', 'company', 'jobTitle', 'country', 'city', 'tags', 'customFields', 'status'];
    const updates = {};
    allowed.forEach((field) => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

    if (updates.tags) updates.tags = updates.tags.map((t) => t.toLowerCase().trim());

    const contact = await Contact.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, isDeleted: false },
        updates,
        { new: true, runValidators: true }
    );

    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found.' });
    res.json({ success: true, message: 'Contact updated.', data: contact });
});

// ─── @desc  Soft delete contact
// ─── @route DELETE /api/contacts/:id
// ─── @access Private
const deleteContact = asyncHandler(async (req, res) => {
    const contact = await Contact.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id },
        { isDeleted: true },
        { new: true }
    );
    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found.' });
    res.json({ success: true, message: 'Contact deleted.' });
});

// ─── @desc  Bulk operations (delete / tag / export)
// ─── @route POST /api/contacts/bulk
// ─── @access Private
const bulkOperation = asyncHandler(async (req, res) => {
    const { operation, contactIds, tag } = req.body;

    if (!contactIds?.length) {
        return res.status(400).json({ success: false, message: 'No contact IDs provided.' });
    }

    const filter = { _id: { $in: contactIds }, userId: req.user._id };
    let result;

    switch (operation) {
        case 'delete':
            result = await Contact.updateMany(filter, { isDeleted: true });
            return res.json({ success: true, message: `${result.modifiedCount} contact(s) deleted.` });

        case 'add_tag':
            if (!tag) return res.status(400).json({ success: false, message: 'Tag is required.' });
            result = await Contact.updateMany(filter, { $addToSet: { tags: tag.toLowerCase().trim() } });
            return res.json({ success: true, message: `Tag '${tag}' added to ${result.modifiedCount} contact(s).` });

        case 'remove_tag':
            if (!tag) return res.status(400).json({ success: false, message: 'Tag is required.' });
            result = await Contact.updateMany(filter, { $pull: { tags: tag.toLowerCase().trim() } });
            return res.json({ success: true, message: `Tag '${tag}' removed from ${result.modifiedCount} contact(s).` });

        case 'unsubscribe':
            result = await Contact.updateMany(filter, { status: 'unsubscribed', unsubscribedAt: new Date() });
            return res.json({ success: true, message: `${result.modifiedCount} contact(s) unsubscribed.` });

        default:
            return res.status(400).json({ success: false, message: `Unknown operation: ${operation}` });
    }
});

// ─── @desc  Import contacts from CSV or Excel
// ─── @route POST /api/contacts/import
// ─── @access Private
const importContacts = asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { columnMap } = req.body; // e.g. { "Email Address": "email", "Full Name": "firstName" }
    const map = columnMap ? JSON.parse(columnMap) : null;
    const filePath = req.file.path;
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    let rows = [];

    // ─── Parse CSV ───────────────────────────────────────────────────────────────
    if (ext === 'csv') {
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => rows.push(row))
                .on('end', resolve)
                .on('error', reject);
        });
    }

    // ─── Parse XLSX / XLS ────────────────────────────────────────────────────────
    if (ext === 'xlsx' || ext === 'xls') {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet);
    }

    fs.unlinkSync(filePath); // cleanup temp file

    if (!rows.length) {
        return res.status(400).json({ success: false, message: 'File is empty or could not be parsed.' });
    }

    // ─── Map columns & normalize ─────────────────────────────────────────────────
    const normalize = (row) => {
        const m = map || {}; // if no map, try auto-detect common column names
        const get = (keys) => {
            for (const k of keys) {
                const val = row[m[k] ? m[k] : k];
                if (val) return String(val).trim();
            }
            return undefined;
        };

        const email = get(['email', 'Email', 'EMAIL', 'Email Address', 'email_address']);
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) return null; // skip invalid

        return {
            email: email.toLowerCase(),
            firstName: get(['firstName', 'first_name', 'First Name', 'firstname']),
            lastName: get(['lastName', 'last_name', 'Last Name', 'lastname']),
            phone: get(['phone', 'Phone', 'mobile', 'Mobile']),
            company: get(['company', 'Company', 'organization', 'Organization']),
            jobTitle: get(['jobTitle', 'job_title', 'Job Title', 'title']),
            country: get(['country', 'Country']),
            city: get(['city', 'City']),
        };
    };

    const normalized = rows.map(normalize).filter(Boolean);

    if (!normalized.length) {
        return res.status(400).json({ success: false, message: 'No valid contacts found in file.' });
    }

    // ─── Bulk upsert with deduplication ──────────────────────────────────────────
    const ops = normalized.map((contact) => ({
        updateOne: {
            filter: { userId: req.user._id, email: contact.email },
            update: {
                $setOnInsert: {
                    userId: req.user._id,
                    tenantId: req.user.tenantId,
                    source: 'csv_import',
                    status: 'subscribed',
                    ...contact,
                },
            },
            upsert: true,
        },
    }));

    const result = await Contact.bulkWrite(ops, { ordered: false });

    res.json({
        success: true,
        message: `Import complete.`,
        data: {
            total: normalized.length,
            inserted: result.upsertedCount,
            duplicatesSkipped: normalized.length - result.upsertedCount,
        },
    });
});

// ─── @desc  Export contacts as JSON (frontend converts to CSV)
// ─── @route GET /api/contacts/export
// ─── @access Private
const exportContacts = asyncHandler(async (req, res) => {
    const { status, tag } = req.query;
    const query = { userId: req.user._id, isDeleted: false };
    if (status) query.status = status;
    if (tag) query.tags = tag;

    const contacts = await Contact.find(query).select(
        'email firstName lastName phone company jobTitle country city tags status createdAt'
    );

    res.json({ success: true, data: contacts, total: contacts.length });
});

// ─── @desc  Get all tags used by this user
// ─── @route GET /api/contacts/tags
// ─── @access Private
const getTags = asyncHandler(async (req, res) => {
    const tags = await Contact.distinct('tags', { userId: req.user._id, isDeleted: false });
    res.json({ success: true, data: tags });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEGMENTS
// ──────────────────────────────────────────────────────────────────────────────

// ─── @desc  Create segment
// ─── @route POST /api/contacts/segments
// ─── @access Private
const createSegment = asyncHandler(async (req, res) => {
    const { name, description, rules, ruleLogic } = req.body;

    const segment = await Segment.create({
        userId: req.user._id,
        tenantId: req.user.tenantId,
        name,
        description,
        rules,
        ruleLogic,
    });

    // Refresh count
    segment.contactCount = await getSegmentCount(req.user._id, rules, ruleLogic);
    segment.lastRefreshedAt = new Date();
    await segment.save();

    res.status(201).json({ success: true, message: 'Segment created.', data: segment });
});

// ─── @desc  Get all segments
// ─── @route GET /api/contacts/segments
// ─── @access Private
const getSegments = asyncHandler(async (req, res) => {
    const segments = await Segment.find({ userId: req.user._id, isDeleted: false }).sort({ createdAt: -1 });
    res.json({ success: true, data: segments });
});

// ─── @desc  Preview segment — returns matching contacts
// ─── @route POST /api/contacts/segments/preview
// ─── @access Private
const previewSegment = asyncHandler(async (req, res) => {
    const { rules, ruleLogic = 'AND' } = req.body;
    const mongoQuery = buildSegmentQuery(req.user._id, rules, ruleLogic);
    const contacts = await Contact.find(mongoQuery).limit(20).select('email firstName lastName tags status');
    const total = await Contact.countDocuments(mongoQuery);
    res.json({ success: true, data: contacts, total });
});

// ─── Helper: Build MongoDB query from segment rules ────────────────────────────
const buildSegmentQuery = (userId, rules, logic = 'AND') => {
    const base = { userId, isDeleted: false, status: 'subscribed' };
    if (!rules?.length) return base;

    const conditions = rules.map((rule) => {
        const { field, operator, value } = rule;
        switch (operator) {
            case 'equals': return { [field]: value };
            case 'not_equals': return { [field]: { $ne: value } };
            case 'contains': return { [field]: { $regex: value, $options: 'i' } };
            case 'not_contains': return { [field]: { $not: new RegExp(value, 'i') } };
            case 'starts_with': return { [field]: { $regex: `^${value}`, $options: 'i' } };
            case 'in': return { [field]: { $in: Array.isArray(value) ? value : [value] } };
            case 'not_in': return { [field]: { $nin: Array.isArray(value) ? value : [value] } };
            case 'is_set': return { [field]: { $exists: true, $ne: null, $ne: '' } };
            case 'is_not_set': return { $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] };
            case 'greater_than': return { [field]: { $gt: value } };
            case 'less_than': return { [field]: { $lt: value } };
            default: return {};
        }
    });

    return { ...base, [logic === 'OR' ? '$or' : '$and']: conditions };
};

const getSegmentCount = async (userId, rules, ruleLogic) => {
    const query = buildSegmentQuery(userId, rules, ruleLogic);
    return Contact.countDocuments(query);
};

module.exports = {
    upload,
    getContacts,
    getContact,
    createContact,
    updateContact,
    deleteContact,
    bulkOperation,
    importContacts,
    exportContacts,
    getTags,
    createSegment,
    getSegments,
    previewSegment,
};