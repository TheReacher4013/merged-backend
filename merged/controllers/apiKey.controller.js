const ApiKey = require('../models/ApiKey.model');
const { createAuditLog } = require('../middleware/auditLogger.middleware');
const { asyncHandler } = require('../middleware/errorHandler');

// @desc  Create new API key
// @route POST /api/keys
// @access Private
const createApiKey = asyncHandler(async (req, res) => {
    const { name, scopes = ['all'], expiresAt, allowedIps = [] } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Key name is required' });
    }

    // Max 10 keys per user
    const keyCount = await ApiKey.countDocuments({ userId: req.user._id, isActive: true });
    if (keyCount >= 10) {
        return res.status(400).json({
            success: false,
            message: 'Maximum 10 active API keys allowed. Revoke an existing key first.',
        });
    }

    // Generate key
    const { rawKey, keyHash, keyPrefix } = ApiKey.generateKey();

    const apiKey = await ApiKey.create({
        userId: req.user._id,
        name: name.trim(),
        keyHash,
        keyPrefix,
        scopes,
        expiresAt: expiresAt || null,
        allowedIps,
    });

    // Audit log
    await createAuditLog({
        user: req.user,
        action: 'API_KEY_CREATED',
        module: 'api_key',
        description: `API key "${name}" created`,
        resourceId: apiKey._id,
        resourceType: 'ApiKey',
        metadata: { scopes, keyPrefix },
        req,
    });

    // Return raw key ONCE — never stored in plain text
    res.status(201).json({
        success: true,
        message: 'API key created. Copy it now — it will not be shown again.',
        data: {
            _id:       apiKey._id,
            name:      apiKey.name,
            key:       rawKey,        // ← shown only here
            keyPrefix: apiKey.keyPrefix,
            scopes:    apiKey.scopes,
            expiresAt: apiKey.expiresAt,
            createdAt: apiKey.createdAt,
        },
    });
});

// @desc  List all API keys for current user
// @route GET /api/keys
// @access Private
const getApiKeys = asyncHandler(async (req, res) => {
    const keys = await ApiKey.find({ userId: req.user._id })
        .select('-keyHash')   // never expose hash
        .sort({ createdAt: -1 });

    res.json({ success: true, data: keys });
});

// @desc  Get single API key details
// @route GET /api/keys/:id
// @access Private
const getApiKeyById = asyncHandler(async (req, res) => {
    const key = await ApiKey.findOne({ _id: req.params.id, userId: req.user._id })
        .select('-keyHash');

    if (!key) {
        return res.status(404).json({ success: false, message: 'API key not found' });
    }

    res.json({ success: true, data: key });
});

// @desc  Update API key (name, scopes, allowedIps)
// @route PUT /api/keys/:id
// @access Private
const updateApiKey = asyncHandler(async (req, res) => {
    const { name, scopes, allowedIps, expiresAt } = req.body;

    const key = await ApiKey.findOne({ _id: req.params.id, userId: req.user._id });
    if (!key) {
        return res.status(404).json({ success: false, message: 'API key not found' });
    }

    if (name)       key.name = name.trim();
    if (scopes)     key.scopes = scopes;
    if (allowedIps) key.allowedIps = allowedIps;
    if (expiresAt !== undefined) key.expiresAt = expiresAt || null;

    await key.save();

    const sanitized = key.toObject();
    delete sanitized.keyHash;

    res.json({ success: true, message: 'API key updated', data: sanitized });
});

// @desc  Revoke (deactivate) an API key
// @route DELETE /api/keys/:id
// @access Private
const revokeApiKey = asyncHandler(async (req, res) => {
    const key = await ApiKey.findOne({ _id: req.params.id, userId: req.user._id });
    if (!key) {
        return res.status(404).json({ success: false, message: 'API key not found' });
    }

    key.isActive = false;
    await key.save();

    await createAuditLog({
        user: req.user,
        action: 'API_KEY_REVOKED',
        module: 'api_key',
        description: `API key "${key.name}" revoked`,
        resourceId: key._id,
        resourceType: 'ApiKey',
        metadata: { keyPrefix: key.keyPrefix },
        req,
    });

    res.json({ success: true, message: 'API key revoked successfully' });
});

// @desc  Regenerate API key (new secret, same settings)
// @route POST /api/keys/:id/regenerate
// @access Private
const regenerateApiKey = asyncHandler(async (req, res) => {
    const key = await ApiKey.findOne({ _id: req.params.id, userId: req.user._id });
    if (!key) {
        return res.status(404).json({ success: false, message: 'API key not found' });
    }

    const { rawKey, keyHash, keyPrefix } = ApiKey.generateKey();

    key.keyHash   = keyHash;
    key.keyPrefix = keyPrefix;
    key.isActive  = true;
    key.usageCount = 0;
    key.lastUsedAt = null;
    await key.save();

    await createAuditLog({
        user: req.user,
        action: 'API_KEY_REGENERATED',
        module: 'api_key',
        description: `API key "${key.name}" regenerated`,
        resourceId: key._id,
        resourceType: 'ApiKey',
        metadata: { newPrefix: keyPrefix },
        req,
    });

    res.json({
        success: true,
        message: 'API key regenerated. Copy it now — it will not be shown again.',
        data: {
            _id:       key._id,
            name:      key.name,
            key:       rawKey,       // ← shown only here
            keyPrefix: key.keyPrefix,
            scopes:    key.scopes,
            expiresAt: key.expiresAt,
        },
    });
});

module.exports = {
    createApiKey,
    getApiKeys,
    getApiKeyById,
    updateApiKey,
    revokeApiKey,
    regenerateApiKey,
};
