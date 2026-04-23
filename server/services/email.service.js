'use strict';

/**
 * Email service. Wraps nodemailer with a graceful no-op mode when SMTP
 * isn't configured, so the rest of the app never crashes on a missing
 * email server. In development / tests, set SMTP_CAPTURE=1 to record
 * outgoing messages in a memory buffer instead of sending.
 *
 * Expected env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   SMTP_FROM  (e.g. "Matrix Spins <no-reply@msaart.online>")
 */

const config = require('../config');

const SMTP_HOST = config.SMTP_HOST;
const SMTP_PORT = config.SMTP_PORT || 587;
const SMTP_USER = config.SMTP_USER;
const SMTP_PASS = config.SMTP_PASS;
const SMTP_FROM = config.SMTP_FROM;
// Capture mode is ONLY honored in non-production and exists so the
// integration test can inspect outgoing mail without real SMTP.
const CAPTURE = config.NODE_ENV !== 'production' && String(process.env.SMTP_CAPTURE || '0') === '1';

const captured = [];
let transporter = null;

function hasTransport() { return config.hasSmtp; }

function getTransport() {
    if (!hasTransport()) return null;
    if (transporter) return transporter;
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    return transporter;
}

async function send({ to, subject, text, html }) {
    if (!to || !subject) return { skipped: true, reason: 'missing to/subject' };
    if (CAPTURE) {
        captured.push({ to, subject, text, html, capturedAt: new Date().toISOString() });
        return { captured: true };
    }
    if (!hasTransport()) {
        // Config already refuses to start in production with SMTP unset.
        // In dev, log loudly so it's obvious the email did not send.
        console.warn('[email] SMTP is not configured — dropping message "' + subject + '" to ' + to);
        return { skipped: true, reason: 'no-smtp' };
    }
    try {
        const info = await getTransport().sendMail({ from: SMTP_FROM, to, subject, text, html });
        return { ok: true, messageId: info.messageId };
    } catch (err) {
        console.error('[email] send failed to ' + to + ':', err.message);
        return { ok: false, error: err.message };
    }
}

function getCaptured() { return captured.slice(); }
function clearCaptured() { captured.length = 0; }

async function sendDepositReceipt({ to, username, amount, currency, depositId, tier, tokenId }) {
    const subject = 'Your Matrix Spins deposit — $' + amount.toFixed(2) + ' ' + currency.toUpperCase();
    const text = [
        'Hi ' + (username || 'there') + ',',
        '',
        'Your deposit of $' + amount.toFixed(2) + ' ' + currency.toUpperCase() + ' has been received and your balance has been credited.',
        '',
        'Receipt NFT: ' + tokenId + ' (' + (tier || 'standard') + ')',
        'Deposit ID: ' + depositId,
        '',
        'You can view your collection anytime from your account.',
        '',
        '— Matrix Spins',
    ].join('\n');
    const html = '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0d1117;color:#e0e0e0;border-radius:12px">' +
        '<h1 style="color:#d4af37;margin:0 0 8px;font-size:20px;letter-spacing:2px">MATRIX SPINS</h1>' +
        '<p style="color:#8a8a8a;margin:0 0 16px;font-size:13px">Deposit receipt · ' + new Date().toISOString().slice(0, 10) + '</p>' +
        '<p>Hi ' + escapeHtml(username || 'there') + ',</p>' +
        '<p>Your deposit of <strong style="color:#d4af37">$' + amount.toFixed(2) + ' ' + currency.toUpperCase() + '</strong> has cleared and your balance is updated.</p>' +
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.3);border-radius:8px;padding:12px;margin:16px 0;font-size:13px">' +
            '<div>Receipt NFT: <code style="color:#00d4ff">' + escapeHtml(tokenId) + '</code></div>' +
            '<div>Tier: ' + escapeHtml(tier || 'standard') + '</div>' +
            '<div>Deposit ID: ' + depositId + '</div>' +
        '</div>' +
        '<p style="font-size:12px;color:#8a8a8a">This email was sent automatically. Do not reply.</p>' +
    '</div>';
    return send({ to, subject, text, html });
}

async function sendPasswordResetLink({ to, username, resetUrl }) {
    const subject = 'Reset your Matrix Spins password';
    const text = [
        'Hi ' + (username || 'there') + ',',
        '',
        'Use this link to set a new password. It expires in 1 hour.',
        '',
        resetUrl,
        '',
        'If you did not request this, ignore this email — your account is unchanged.',
        '',
        '— Matrix Spins',
    ].join('\n');
    const html = '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0d1117;color:#e0e0e0;border-radius:12px">' +
        '<h1 style="color:#d4af37;margin:0 0 16px;font-size:20px;letter-spacing:2px">Reset password</h1>' +
        '<p>Hi ' + escapeHtml(username || 'there') + ',</p>' +
        '<p>Use the link below to set a new password. It expires in 1 hour.</p>' +
        '<p style="margin:20px 0"><a href="' + escapeHtml(resetUrl) + '" style="display:inline-block;padding:12px 20px;background:linear-gradient(135deg,#d4af37,#f4d03f);color:#000;text-decoration:none;border-radius:8px;font-weight:700">Reset password</a></p>' +
        '<p style="font-size:12px;color:#8a8a8a">If you did not request this, ignore this email — your account is unchanged.</p>' +
    '</div>';
    return send({ to, subject, text, html });
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

module.exports = { send, sendDepositReceipt, sendPasswordResetLink, getCaptured, clearCaptured, hasTransport };
// Suppress unused-var lint while still importing config
void config;
