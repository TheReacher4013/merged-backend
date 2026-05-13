const express = require('express');
const router = express.Router();
const {body} = require('express-validator');

const {
    upload, getContacts, getContact, createContact, updateContact, deleteContact, bulkOperation, importContacts, exportContacts, getTags, createSegment, getSegments, previewSegment,
} = require("../controllers/contact.controller");

const {protect} = require('../middleware/auth.middleware');
const {importLimiter} = require('../middleware/rateLimiter');

router.use(protect);

// Contact CRUD 
router.get('/', getContacts);
router.get('/export', exportContacts);
router.get('/tags', getTags);
router.get('/:id', getContact);

router.post('/', [
    body('email').isEmail().withMessage('Invalid email'),
    body('firstName').optional().isLength({ max: 50 }),
    body('lastName').optional().isLength({ max: 50 }),
], createContact);

router.put('/:id', updateContact);
router.delete('/:id', deleteContact);

//Bulk Operations
router.post('/bulk', [
    body('operation').isIn(['delete', 'add_tag', 'remove_tag', 'unsubscribe']),
    body('contactIds').isArray({ min: 1 }),
], bulkOperation);

//Import
router.post('/import', importLimiter, upload.single('file'), importContacts);

//Segments 
router.get('/segments', getSegments);
router.post('/segments', [
    body('name').trim().notEmpty().withMessage('Segment name required'),
    body('rules').isArray(),
], createSegment);
router.post('/segments/preview', previewSegment);

module.exports = router;
