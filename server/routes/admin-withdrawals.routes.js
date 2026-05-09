'use strict';

/**
 * Admin withdrawal approval queue.
 *
 * Pairs with the existing /api/admin/approve-withdrawal + /reject-withdrawal
 * endpoints, but provides a dedicated queue view + bulk operations + filtering
 * specifically for the daily processing workflow.
 *
 *   GET  /api/admin-withdrawals/queue              — pending/otp_verified rows
 *   GET  /api/admin-withdrawals/history            — completed/rejected (paged)
 *   GET  /api/admin-withdrawals/stats              — counts + sums per status
 *   GET  /api/admin-withdrawals/:id                — full detail with user info
 *   POST /api/admin-withdrawals/:id/note           — append admin_note (audit-trailed)
 *   POST /api/admin-withdrawals/bulk-approve       — body: { ids: [] }
 *
 * Approval/rejection itself reuses the existing endpoints to keep the
 * email + balance-refund + dispute-safety logic in one place.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');

function adminOnly(req, res, next) {
    const tokenOk = config.ADMIN_PASSWORD && req.headers['x-admin-token'] === config.ADMIN_PASSWORD;
    const roleOk = req.user && (req.user.role === 'admin' || req.user.is_admin);
    if (tokenOk || roleOk) return next();
    return res.status(403).json({ error: 'Admin only' });
}

// ─── Queue (pending withdrawals) ───────────────────────────

router.get('/queue', authenticate, adminOnly, async (req, res) => {
    try {
        const minAmount = parseFloat(req.query.minAmount) || 0;
        const paymentType = req.query.paymentType || null;

        let sql = `
            SELECT w.id, w.user_id, w.amount, w.currency, w.payment_type, w.status,
                   w.reference, w.admin_note, w.created_at, w.processed_at,
                   u.username, u.email, u.kyc_status, u.balance, u.is_banned,
                   (SELECT COUNT(*) FROM withdrawals w2 WHERE w2.user_id = w.user_id AND w2.status = 'completed') AS prior_completed_count,
                   (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE user_id = w.user_id AND status = 'completed') AS lifetime_deposits
            FROM withdrawals w
            LEFT JOIN users u ON u.id = w.user_id
            WHERE w.status IN ('pending', 'otp_verified')
              AND w.amount >= ?`;
        const params = [minAmount];
        if (paymentType) {
            sql += ' AND w.payment_type = ?';
            params.push(paymentType);
        }
        sql += ' ORDER BY w.created_at ASC LIMIT 200';

        const rows = await db.all(sql, params);

        // Decorate each row with cooling-off info + risk flags
        const now = Date.now();
        const decorated = rows.map(r => {
            const createdAt = r.created_at ? new Date(r.created_at).getTime() : now;
            const hoursSince = (now - createdAt) / 3_600_000;
            const coolingOffActive = hoursSince < 24;
            const hoursRemaining = coolingOffActive ? Math.ceil(24 - hoursSince) : 0;
            const otpRequired = r.amount >= (config.WITHDRAWAL_OTP_THRESHOLD || 500);
            const otpStatus = otpRequired
                ? (r.status === 'otp_verified' ? 'verified' : 'pending')
                : 'not_required';
            const riskFlags = [];
            if (r.is_banned) riskFlags.push('user_banned');
            if (r.kyc_status !== 'verified' && r.amount > 2000) riskFlags.push('kyc_required');
            if (r.lifetime_deposits === 0) riskFlags.push('no_deposits');
            if (r.amount > (Number(r.lifetime_deposits) || 0) * 5) riskFlags.push('exceeds_5x_deposits');
            return {
                ...r,
                cooling_off_active: coolingOffActive,
                cooling_off_hours_remaining: hoursRemaining,
                otp_status: otpStatus,
                approvable: !coolingOffActive && otpStatus !== 'pending' && !r.is_banned,
                risk_flags: riskFlags,
            };
        });

        res.json({ success: true, count: decorated.length, queue: decorated });
    } catch (err) {
        console.error('[admin-withdrawals/queue]', err);
        res.status(500).json({ error: 'Failed to load queue' });
    }
});

router.get('/history', authenticate, adminOnly, async (req, res) => {
    try {
        const status = req.query.status || null;
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

        let sql = `
            SELECT w.id, w.user_id, w.amount, w.currency, w.payment_type, w.status,
                   w.reference, w.admin_note, w.created_at, w.processed_at,
                   u.username, u.email
            FROM withdrawals w
            LEFT JOIN users u ON u.id = w.user_id
            WHERE w.status NOT IN ('pending', 'otp_verified')`;
        const params = [];
        if (status) {
            sql += ' AND w.status = ?';
            params.push(status);
        }
        sql += ` ORDER BY w.processed_at DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`;

        // SQLite doesn't support NULLS LAST — handle gracefully
        let rows;
        try {
            rows = await db.all(sql, params);
        } catch (_) {
            sql = sql.replace(' NULLS LAST', '');
            rows = await db.all(sql, params);
        }

        res.json({ success: true, count: rows.length, history: rows });
    } catch (err) {
        console.error('[admin-withdrawals/history]', err);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

router.get('/stats', authenticate, adminOnly, async (req, res) => {
    try {
        const isPg = typeof db.isPg === 'function' && db.isPg();
        const dayClause = isPg ? "created_at >= NOW() - INTERVAL '1 day'" : "created_at >= datetime('now', '-1 day')";
        const weekClause = isPg ? "created_at >= NOW() - INTERVAL '7 days'" : "created_at >= datetime('now', '-7 days')";

        const counts = await db.all(`SELECT status, COUNT(*) AS c, COALESCE(SUM(amount), 0) AS sum FROM withdrawals GROUP BY status`);
        const today = await db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS sum FROM withdrawals WHERE ${dayClause}`);
        const week = await db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS sum FROM withdrawals WHERE ${weekClause}`);
        const pendingValue = (counts.find(r => r.status === 'pending') || { sum: 0 }).sum;
        const otpVerifiedValue = (counts.find(r => r.status === 'otp_verified') || { sum: 0 }).sum;

        res.json({
            success: true,
            byStatus: counts,
            today,
            week,
            queueValue: Number(pendingValue) + Number(otpVerifiedValue),
        });
    } catch (err) {
        console.error('[admin-withdrawals/stats]', err);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

router.get('/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
        const wd = await db.get(`
            SELECT w.*, u.username, u.email, u.kyc_status, u.balance, u.bonus_balance, u.created_at AS user_created_at
            FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id
            WHERE w.id = ?`, [id]);
        if (!wd) return res.status(404).json({ error: 'Not found' });

        // Fetch player history snapshot
        const summary = await db.get(`
            SELECT
              (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE user_id = ? AND status = 'completed') AS lifetime_deposits,
              (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE user_id = ? AND status = 'completed') AS lifetime_withdrawals,
              (SELECT COALESCE(SUM(bet_amount), 0) FROM spins WHERE user_id = ?) AS lifetime_wagered,
              (SELECT COUNT(*) FROM spins WHERE user_id = ?) AS lifetime_spins
        `, [wd.user_id, wd.user_id, wd.user_id, wd.user_id]);

        res.json({ success: true, withdrawal: wd, summary });
    } catch (err) {
        console.error('[admin-withdrawals/:id]', err);
        res.status(500).json({ error: 'Failed to load withdrawal' });
    }
});

router.post('/:id/note', authenticate, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { note } = req.body || {};
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
        if (!note || typeof note !== 'string') return res.status(400).json({ error: 'note required' });
        const trimmed = note.trim().slice(0, 500);

        const wd = await db.get('SELECT id, admin_note FROM withdrawals WHERE id = ?', [id]);
        if (!wd) return res.status(404).json({ error: 'Not found' });

        const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const adminLabel = (req.user && (req.user.username || req.user.id)) || 'admin';
        const newNote = (wd.admin_note ? wd.admin_note + '\n' : '') + `[${stamp}] ${adminLabel}: ${trimmed}`;
        await db.run('UPDATE withdrawals SET admin_note = ? WHERE id = ?', [newNote.slice(-2000), id]);

        // Audit log (best-effort)
        await db.run(
            "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES (?, 'withdrawal_note', NULL, ?)",
            [req.user.id, JSON.stringify({ withdrawalId: id, note: trimmed })]
        ).catch(() => {});

        res.json({ success: true, admin_note: newNote });
    } catch (err) {
        console.error('[admin-withdrawals/note]', err);
        res.status(500).json({ error: 'Failed to add note' });
    }
});

router.post('/bulk-approve', authenticate, adminOnly, async (req, res) => {
    try {
        const ids = (req.body && req.body.ids) || [];
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
        if (ids.length > 50) return res.status(400).json({ error: 'max 50 per batch' });
        const numericIds = ids.map(n => parseInt(n, 10)).filter(Number.isFinite);

        const results = [];
        for (const id of numericIds) {
            try {
                const wd = await db.get(
                    'SELECT id, user_id, amount, currency, payment_type, reference, status, created_at FROM withdrawals WHERE id = ?',
                    [id]
                );
                if (!wd) { results.push({ id, ok: false, error: 'not found' }); continue; }
                if (wd.status !== 'pending' && wd.status !== 'otp_verified') {
                    results.push({ id, ok: false, error: 'wrong status: ' + wd.status });
                    continue;
                }
                // Cooling-off check
                const hoursSince = (Date.now() - new Date(wd.created_at).getTime()) / 3_600_000;
                if (hoursSince < 24) {
                    results.push({ id, ok: false, error: `cooling-off (${Math.ceil(24 - hoursSince)}h left)` });
                    continue;
                }
                // OTP gate
                const OTP_THRESHOLD = config.WITHDRAWAL_OTP_THRESHOLD || 500;
                if (wd.amount >= OTP_THRESHOLD && wd.status === 'pending') {
                    results.push({ id, ok: false, error: 'otp not verified' });
                    continue;
                }

                const claim = await db.run(
                    "UPDATE withdrawals SET status = 'completed', processed_at = datetime('now'), admin_note = COALESCE(admin_note, '') || ' [bulk approved]' WHERE id = ? AND status IN ('pending', 'otp_verified')",
                    [id]
                );
                if (!claim || claim.changes === 0) {
                    results.push({ id, ok: false, error: 'concurrent change' });
                    continue;
                }

                // Audit + email (best-effort)
                await db.run(
                    "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES (?, 'bulk_approve_withdrawal', ?, ?)",
                    [req.user.id, wd.user_id, JSON.stringify({ withdrawalId: id, amount: wd.amount })]
                ).catch(() => {});

                try {
                    const u = await db.get('SELECT username, email FROM users WHERE id = ?', [wd.user_id]);
                    if (u && u.email) {
                        const emailService = require('../services/email.service');
                        emailService.sendWithdrawalApproved(u.email, wd.user_id, {
                            username: u.username,
                            amount: wd.amount,
                            currency: wd.currency || 'AUD',
                            reference: wd.reference,
                            paymentType: wd.payment_type,
                        }).catch(() => {});
                    }
                } catch (_) {}

                results.push({ id, ok: true, amount: wd.amount });
            } catch (err) {
                results.push({ id, ok: false, error: err.message });
            }
        }
        const approved = results.filter(r => r.ok).length;
        res.json({ success: true, approved, failed: results.length - approved, results });
    } catch (err) {
        console.error('[admin-withdrawals/bulk-approve]', err);
        res.status(500).json({ error: 'Bulk approve failed' });
    }
});

// ─── Stripe webhook audit (admin diagnostics) ───────────────

router.get('/stripe-audit/recent', authenticate, adminOnly, async (req, res) => {
    try {
        const stripeAudit = require('../services/stripe-audit.service');
        const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
        const events = await stripeAudit.recentEvents(limit);
        res.json({ success: true, count: events.length, events });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/stripe-audit/stats', authenticate, adminOnly, async (req, res) => {
    try {
        const stripeAudit = require('../services/stripe-audit.service');
        const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
        const stats = await stripeAudit.statsByType(days);
        res.json({ success: true, days, stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
