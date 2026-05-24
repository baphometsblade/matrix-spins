'use strict';

/**
 * Admin email broadcast + queue management.
 *
 *   GET  /api/admin-email/queue        — queue stats + recent rows
 *   POST /api/admin-email/process      — flush the queue immediately
 *   POST /api/admin-email/test         — send a test email to admin email
 *   POST /api/admin-email/broadcast    — broadcast to a segment
 *   GET  /api/admin-email/broadcasts   — list past broadcasts
 *   GET  /api/admin-email/segments/:s/preview — count + sample for a segment
 *
 * Auth: requires authenticate + role=admin.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const emailService = require('../services/email.service');
const db = require('../database');

// ── Admin guard ─────────────────────────────────────────────
// Pure role check. Previously also accepted X-Admin-Token = ADMIN_PASSWORD,
// which let any user holding a valid JWT escalate to broadcast email if the
// ADMIN_PASSWORD leaked. Removed for defense-in-depth: the only path to
// admin email routes is now a JWT whose subject is flagged is_admin.
function adminOnly(req, res, next) {
    if (req.user && (req.user.role === 'admin' || req.user.is_admin)) return next();
    return res.status(403).json({ error: 'Admin only' });
}

// ── Queue ───────────────────────────────────────────────────

router.get('/queue', authenticate, adminOnly, async (req, res) => {
    try {
        const stats = await emailService.getQueueStats();
        const recent = await db.all(
            `SELECT id, to_email, template, category, subject, status, attempts, last_error, created_at, sent_at
             FROM email_queue ORDER BY id DESC LIMIT 50`
        );
        res.json({
            success: true,
            available: emailService.isAvailable(),
            stats,
            recent,
        });
    } catch (err) {
        console.error('[admin-email/queue]', err);
        res.status(500).json({ error: 'Failed to load queue' });
    }
});

router.post('/process', authenticate, adminOnly, async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt((req.body && req.body.limit) || 50, 10)));
        const result = await emailService.processQueue(limit);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: 'Failed to process queue' });
    }
});

// ── Test send ───────────────────────────────────────────────

router.post('/test', authenticate, adminOnly, async (req, res) => {
    try {
        const to = (req.body && req.body.to) || config.ADMIN_EMAIL;
        if (!to) return res.status(400).json({ error: 'No recipient — provide { to } or set ADMIN_EMAIL env' });
        const result = await emailService.send({
            to,
            userId: req.user && req.user.id,
            template: 'broadcast',
            data: {
                subject: 'Matrix Spins — test email',
                headline: 'SMTP test',
                body: 'This is a test email from the admin console. If you received this, the SMTP transport is working correctly.',
                ctaLabel: 'Open admin console',
                ctaUrl: `${process.env.PUBLIC_URL || 'https://msaart.online'}/admin/`,
            },
        });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[admin-email/test]', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Broadcast ───────────────────────────────────────────────

const VALID_SEGMENTS = new Set([
    'all', 'active_7d', 'inactive_30d', 'high_value', 'never_deposited',
    'vip:silver', 'vip:gold', 'vip:platinum', 'vip:diamond',
]);

router.post('/broadcast', authenticate, adminOnly, async (req, res) => {
    try {
        const { segment, subject, headline, body, ctaLabel, ctaUrl } = req.body || {};
        if (!subject || !body) return res.status(400).json({ error: 'subject + body required' });
        if (segment && !VALID_SEGMENTS.has(segment) && !segment.startsWith('vip:')) {
            return res.status(400).json({ error: 'Invalid segment' });
        }
        if (subject.length > 200) return res.status(400).json({ error: 'subject too long' });
        if (body.length > 8000)   return res.status(400).json({ error: 'body too long' });
        if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
            return res.status(400).json({ error: 'ctaUrl must start with http(s)://' });
        }

        const result = await emailService.createBroadcast({
            adminId: req.user && req.user.id,
            segment: segment || 'all',
            subject,
            headline: headline || subject,
            body,
            ctaLabel: ctaLabel || null,
            ctaUrl: ctaUrl || null,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[admin-email/broadcast]', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/broadcasts', authenticate, adminOnly, async (req, res) => {
    try {
        const list = await emailService.listBroadcasts(parseInt(req.query.limit, 10) || 50);
        res.json({ success: true, broadcasts: list });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list broadcasts' });
    }
});

router.get('/segments', authenticate, adminOnly, (req, res) => {
    res.json({
        success: true,
        segments: Array.from(VALID_SEGMENTS).map(key => ({
            key,
            label: _segmentLabel(key),
        })),
    });
});

router.get('/segments/:segment/preview', authenticate, adminOnly, async (req, res) => {
    try {
        const segment = req.params.segment;
        if (!VALID_SEGMENTS.has(segment) && !segment.startsWith('vip:')) {
            return res.status(400).json({ error: 'Invalid segment' });
        }
        // Re-use the resolver via a private export? No — query lazily.
        const { _resolveSegment } = emailService;
        // emailService doesn't export _resolveSegment publicly; use a small mirror
        // by counting eligible recipients ourselves.
        const recipients = await _previewSegment(segment);
        res.json({
            success: true,
            segment,
            count: recipients.length,
            sample: recipients.slice(0, 5).map(r => ({ id: r.id, email: _maskEmail(r.email) })),
        });
    } catch (err) {
        console.error('[admin-email/preview]', err);
        res.status(500).json({ error: err.message });
    }
});

function _segmentLabel(key) {
    return ({
        all: 'All players',
        active_7d: 'Active (last 7 days)',
        inactive_30d: 'Inactive (30+ days)',
        high_value: 'High value (balance ≥ $100)',
        never_deposited: 'Never deposited',
        'vip:silver': 'VIP — Silver',
        'vip:gold':   'VIP — Gold',
        'vip:platinum': 'VIP — Platinum',
        'vip:diamond':  'VIP — Diamond',
    })[key] || key;
}

function _maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!domain) return email;
    return (local.length <= 2 ? local[0] + '*' : local[0] + '***' + local.slice(-1)) + '@' + domain;
}

async function _previewSegment(segment) {
    // Mirror resolver — kept simple to avoid cross-file coupling.
    const isPg = typeof db.isPg === 'function' && db.isPg();
    const dateSub = (days) => isPg ? `NOW() - INTERVAL '${days} days'` : `datetime('now', '-${days} days')`;
    const base = `FROM users u WHERE u.email IS NOT NULL AND u.email <> '' AND COALESCE(u.is_banned, 0) = 0`;
    let sql, params = [];
    if (segment === 'active_7d') {
        sql = `SELECT DISTINCT u.id, u.email FROM users u
               INNER JOIN spins s ON s.user_id = u.id AND s.created_at >= ${dateSub(7)}
               WHERE u.email IS NOT NULL AND COALESCE(u.is_banned, 0) = 0`;
    } else if (segment === 'inactive_30d') {
        sql = `SELECT u.id, u.email ${base}
               AND u.id NOT IN (SELECT DISTINCT user_id FROM spins WHERE created_at >= ${dateSub(30)})`;
    } else if (segment === 'high_value') {
        sql = `SELECT u.id, u.email ${base}
               AND (COALESCE(u.balance, 0) + COALESCE(u.bonus_balance, 0)) >= 100`;
    } else if (segment === 'never_deposited') {
        sql = `SELECT u.id, u.email ${base}
               AND u.id NOT IN (SELECT DISTINCT user_id FROM deposits WHERE status = 'completed')`;
    } else if (segment.startsWith('vip:')) {
        sql = `SELECT u.id, u.email ${base} AND LOWER(COALESCE(u.vip_tier, '')) = LOWER(?)`;
        params = [segment.slice(4)];
    } else {
        sql = `SELECT u.id, u.email ${base}`;
    }
    try {
        return await db.all(sql, params);
    } catch (err) {
        return [];
    }
}

module.exports = router;
