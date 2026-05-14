/**
 * telegram.controller.js
 */
const crypto = require('crypto');
const User   = require('../models/User.model');
const { handleWebhook } = require('../services/telegram.service');
const { asyncHandler }  = require('../middleware/errorHandler');

// POST /api/telegram/webhook  — public, called by Telegram
const telegramWebhook = async (req, res) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }
    await handleWebhook(req, res);
};

// POST /api/telegram/generate-token  — JWT required
const generateLinkToken = asyncHandler(async (req, res) => {
    const user  = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const token = crypto.randomBytes(32).toString('hex');
    user.telegramLinkToken = token;
    await user.save();
    const bot      = process.env.TELEGRAM_BOT_USERNAME;
    const deepLink = `https://t.me/${bot}?start=${token}`;
    res.json({ success: true, data: { deepLink, token } });
});

// DELETE /api/telegram/unlink  — JWT required
const unlinkTelegram = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.user._id, {
        $unset: { telegramChatId: '', telegramUserId: '', telegramLinkToken: '' },
        telegramLinked: false,
    });
    res.json({ success: true, message: 'Telegram unlinked.' });
});

// GET /api/telegram/status  — JWT required
const getTelegramStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('telegramLinked telegramChatId');
    res.json({ success: true, data: { linked: !!user?.telegramLinked, chatId: user?.telegramChatId || null } });
});

module.exports = { telegramWebhook, generateLinkToken, unlinkTelegram, getTelegramStatus };
