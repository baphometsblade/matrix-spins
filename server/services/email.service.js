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

async function sendEmailVerification({ to, username, verifyUrl }) {
    const subject = 'Confirm your Matrix Spins email';
    const text = [
        'Hi ' + (username || 'there') + ',',
        '',
        'Click the link below to confirm this email address. The link expires in 24 hours. Until you confirm, you cannot make deposits.',
        '',
        verifyUrl,
        '',
        'If you did not create a Matrix Spins account, ignore this email.',
        '',
        '— Matrix Spins',
    ].join('\n');
    const html = '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0d1117;color:#e0e0e0;border-radius:12px">' +
        '<h1 style="color:#d4af37;margin:0 0 12px;font-size:20px">Confirm your email</h1>' +
        '<p>Hi ' + escapeHtml(username || 'there') + ',</p>' +
        '<p>Click below to confirm this email address. The link expires in 24 hours. Until you confirm, deposits are blocked on your account.</p>' +
        '<p style="margin:20px 0"><a href="' + escapeHtml(verifyUrl) + '" style="display:inline-block;padding:12px 20px;background:linear-gradient(135deg,#d4af37,#f4d03f);color:#000;text-decoration:none;border-radius:8px;font-weight:700">Confirm my email</a></p>' +
        '<p style="font-size:12px;color:#8a8a8a">If you did not create a Matrix Spins account, ignore this email.</p>' +
    '</div>';
    return send({ to, subject, text, html });
}

async function sendWelcome({ to, username }) {
    const subject = 'Welcome to Matrix Spins';
    const text = [
        'Hi ' + (username || 'there') + ',',
        '',
        'Your Matrix Spins account is ready. Every deposit mints a signed receipt NFT to your collection — higher amounts unlock higher tiers (bronze, silver, gold, platinum, diamond).',
        '',
        'We strongly recommend enabling two-factor authentication on your security page.',
        '',
        '— Matrix Spins',
    ].join('\n');
    const html = '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0d1117;color:#e0e0e0;border-radius:12px">' +
        '<h1 style="color:#d4af37;margin:0 0 8px;font-size:20px;letter-spacing:2px">MATRIX SPINS</h1>' +
        '<p>Hi ' + escapeHtml(username || 'there') + ',</p>' +
        '<p>Your account is ready. Every deposit mints a signed receipt NFT to your collection — higher amounts unlock higher tiers (bronze, silver, gold, platinum, diamond).</p>' +
        '<p style="margin-top:16px;color:#8a8a8a;font-size:13px">We strongly recommend enabling two-factor authentication on your security page.</p>' +
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

async function sendSecurityAlert({ to, username, event, ip, userAgent }) {
    const eventLabel = {
        password_change: 'Your Matrix Spins password was changed',
        password_reset: 'Your Matrix Spins password was reset',
        email_change: 'Your Matrix Spins email address was changed',
        twofa_enabled: 'Two-factor authentication was turned ON',
        twofa_disabled: 'Two-factor authentication was turned OFF',
        session_revoked: 'All Matrix Spins sessions were signed out',
    }[event] || 'A security change was made to your Matrix Spins account';
    const subject = eventLabel;
    const when = new Date().toISOString();
    const ctx = [
        'When: ' + when,
        ip ? 'IP: ' + ip : null,
        userAgent ? 'Device: ' + userAgent : null,
    ].filter(Boolean).join('\n');
    const text = [
        'Hi ' + (username || 'there') + ',',
        '',
        eventLabel + '.',
        '',
        ctx,
        '',
        'If this was you, no action is required.',
        'If you did not do this, reset your password immediately and contact support.',
        '',
        '— Matrix Spins',
    ].join('\n');
    const html = '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0d1117;color:#e0e0e0;border-radius:12px">' +
        '<h1 style="color:#d4af37;margin:0 0 8px;font-size:18px">Security alert</h1>' +
        '<p style="margin:0 0 12px">' + escapeHtml(eventLabel) + '.</p>' +
        '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:12px;font-size:13px;color:#b0b0b0;margin:12px 0">' +
            '<div>When: ' + escapeHtml(when) + '</div>' +
            (ip ? '<div>IP: ' + escapeHtml(ip) + '</div>' : '') +
            (userAgent ? '<div style="word-break:break-all">Device: ' + escapeHtml(userAgent) + '</div>' : '') +
        '</div>' +
        '<p style="color:#8a8a8a;font-size:13px">If this was you, no action is required. If not, reset your password immediately.</p>' +
    '</div>';
    return send({ to, subject, text, html });
}

async function sendWithdrawalRequested({ to, amount, currency }) {
    const cur = String(currency || 'usd').toUpperCase();
    const amountStr = '$' + Number(amount || 0).toFixed(2) + ' ' + cur;
    const subject = 'Matrix Spins — withdrawal request received';
    const text = [
        'We received your withdrawal request for ' + amountStr + '.',
        '',
        'It is pending operator review. You will receive another email when it is paid or denied.',
    ].join('\n');
    return send({ to, subject, text });
}

async function sendWithdrawalPaid({ to, amount, currency }) {
    const cur = String(currency || 'usd').toUpperCase();
    const amountStr = '$' + Number(amount || 0).toFixed(2) + ' ' + cur;
    const subject = 'Matrix Spins — withdrawal paid';
    const text = [
        'Your withdrawal of ' + amountStr + ' has been marked paid by our operations team.',
        '',
        'If you do not see the funds within 3 business days, reply to this email.',
    ].join('\n');
    return send({ to, subject, text });
}

async function sendDestinationAdded({ to, username, method, destination, cooldown_until }) {
    // Tip-off mail when a payout destination is added. The point is
    // that the legitimate user sees this even if a session-hijacker
    // added the destination — they have until cooldown_until elapses
    // to log in and DELETE it. Truncate the destination so we never
    // print a full bank account number / wallet in plaintext.
    const masked = String(destination || '').slice(0, 4) + '…' + String(destination || '').slice(-4);
    const cd = cooldown_until ? new Date(cooldown_until).toUTCString() : 'unknown';
    const subject = 'Matrix Spins — payout destination added';
    const text = [
        'Hi ' + (username || 'there') + ',',
        '',
        'A new payout destination was just added to your account:',
        '  Method:      ' + (method || ''),
        '  Destination: ' + masked,
        '',
        'It will become usable for withdrawals after ' + cd + '.',
        '',
        'If you did NOT add this, log in and delete it from your account page right away,',
        'and rotate your password and 2FA.',
    ].join('\n');
    return send({ to, subject, text });
}

async function sendWithdrawalDenied({ to, amount, currency, reason }) {
    const cur = String(currency || 'usd').toUpperCase();
    const amountStr = '$' + Number(amount || 0).toFixed(2) + ' ' + cur;
    const subject = 'Matrix Spins — withdrawal denied';
    const text = [
        'Your withdrawal of ' + amountStr + ' was denied by our operations team.',
        reason ? 'Reason: ' + reason : '',
        '',
        'The amount has been refunded to your account balance.',
    ].filter(Boolean).join('\n');
    return send({ to, subject, text });
}

module.exports = {
    send,
    sendDepositReceipt,
    sendPasswordResetLink,
    sendWelcome,
    sendSecurityAlert,
    sendEmailVerification,
    sendWithdrawalRequested,
    sendWithdrawalPaid,
    sendWithdrawalDenied,
    sendDestinationAdded,
    getCaptured,
    clearCaptured,
    hasTransport,
};
// Suppress unused-var lint while still importing config
void config;
