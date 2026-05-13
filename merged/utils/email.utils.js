/**
 * email.utils.js — Transactional emails via SMTP (nodemailer)
 *
 * Used for auth emails: verification, password reset, welcome.
 * Shares the same SMTP_* env vars as emailEngine.service.js.
 */

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const FROM = `"${process.env.SMTP_FROM_NAME || 'Email Marketing Platform'}" <${process.env.SMTP_FROM_EMAIL}>`;

// ─── Generic send ─────────────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html, text }) => {
    try {
        await transporter.sendMail({ from: FROM, to, subject, html, text });
    } catch (error) {
        console.error('SMTP error:', error.message);
        throw new Error('Failed to send email.');
    }
};

// ─── Email verification ────────────────────────────────────────────────────────
const sendVerificationEmail = async (email, name, token) => {
    const url = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
    await sendEmail({
        to: email,
        subject: 'Verify your email address',
        html: `
      <h2>Hi ${name},</h2>
      <p>Please verify your email address by clicking the link below.</p>
      <p>This link expires in <strong>24 hours</strong>.</p>
      <a href="${url}" style="background:#4F46E5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Verify Email</a>
      <p>Or copy this link: ${url}</p>
    `,
    });
};

// ─── Password reset ────────────────────────────────────────────────────────────
const sendPasswordResetEmail = async (email, name, token) => {
    const url = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    await sendEmail({
        to: email,
        subject: 'Reset your password',
        html: `
      <h2>Hi ${name},</h2>
      <p>You requested a password reset. Click below to set a new password.</p>
      <p>This link expires in <strong>1 hour</strong>.</p>
      <a href="${url}" style="background:#EF4444;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Reset Password</a>
      <p>If you did not request this, please ignore this email.</p>
    `,
    });
};

// ─── Welcome email ─────────────────────────────────────────────────────────────
const sendWelcomeEmail = async (email, name) => {
    await sendEmail({
        to: email,
        subject: `Welcome to Email Marketing Platform, ${name}!`,
        html: `
      <h2>Welcome, ${name}! 🎉</h2>
      <p>Your account has been created successfully. Start creating campaigns today.</p>
      <a href="${process.env.CLIENT_URL}/dashboard" style="background:#10B981;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Go to Dashboard</a>
    `,
    });
};

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail };
