/**
 * telegram.routes.js
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { telegramWebhook, generateLinkToken, unlinkTelegram, getTelegramStatus } = require('../controllers/telegram.controller');

router.post('/webhook',         telegramWebhook);          // public
router.post('/generate-token',  protect, generateLinkToken);
router.delete('/unlink',        protect, unlinkTelegram);
router.get('/status',           protect, getTelegramStatus);

module.exports = router;
