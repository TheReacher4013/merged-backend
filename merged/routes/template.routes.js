const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');

const {
    getTemplates, getTemplate, createTemplate, updateTemplate,
    duplicateTemplate, deleteTemplate, uploadImage,
    previewTemplate, publishTemplate,
} = require('../controllers/template.controller');

const { protect } = require('../middleware/auth.middleware');

// ─── Local disk storage (replaces S3) ─────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/temp/'),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files allowed'));
    },
});

// All template routes require authentication
router.use(protect);

// ─── Template CRUD ─────────────────────────────────────────────────────────────
router.get('/', getTemplates);
router.get('/:id', getTemplate);

router.post('/', [
    body('name').trim().notEmpty().withMessage('Template name required').isLength({ max: 200 }),
    body('editorMode').optional().isIn(['drag_drop', 'html']),
    body('category').optional().isIn(['newsletter', 'promotional', 'transactional', 'welcome', 'drip', 'custom']),
], createTemplate);

router.put('/:id', updateTemplate);
router.delete('/:id', deleteTemplate);

// ─── Special Actions ───────────────────────────────────────────────────────────
router.post('/:id/duplicate', duplicateTemplate);
router.post('/:id/preview', previewTemplate);
router.patch('/:id/publish', publishTemplate);

// ─── Image Upload (local storage) ─────────────────────────────────────────────
router.post('/upload-image', upload.single('image'), uploadImage);

module.exports = router;
