const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const {
    createApiKey,
    getApiKeys,
    getApiKeyById,
    updateApiKey,
    revokeApiKey,
    regenerateApiKey,
} = require('../controllers/apiKey.controller');
const { protect } = require('../middleware/auth.middleware');

// All routes require login
router.use(protect);

router.get('/',              getApiKeys);
router.get('/:id',           getApiKeyById);

router.post('/', [
    body('name').trim().notEmpty().withMessage('Key name is required'),
    body('scopes').optional().isArray().withMessage('Scopes must be an array'),
], createApiKey);

router.put('/:id', [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('scopes').optional().isArray().withMessage('Scopes must be an array'),
], updateApiKey);

router.delete('/:id',        revokeApiKey);
router.post('/:id/regenerate', regenerateApiKey);

module.exports = router;
