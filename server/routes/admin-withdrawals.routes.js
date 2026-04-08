/**
 * Admin Withdrawal Authorization � server/routes/admin-withdrawals.routes.js
 *
 * Admin panel to review, approve, or deny withdrawal requests.
 * On approval: "buys back" the user's NFT and initiates Stripe payout.
 * Withdrawals are NEVER automatic � admin must manually authorize each one.
 */
'use strict';

// Ensure admin_audit_log table exists for accountability
const dbForAudit = require('../database');
(async () => {
    try {
        const db = typeof dbForAudit.getBackend === 'function' ? dbForAudit.getBackend() : dbForAudit;
        await db.run(`CREATE TABLE IF NOT EXISTS admin_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_username TEXT,
            action TEXT NOT NULL,
            target_id TEXT,
            details TEXT,
            ip_address TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`);
    } catch (e) { /* table may already exist */ }
})();


const express = require('express');
const router = express.Router();
const config = require('../config');
const { getBackend } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

// SECURITY: All admin-withdrawal endpoints require authentication + admin role.
// Without this, ANY unauthenticated user could approve/deny withdrawals.
router.use(authenticate, requireAdmin);

// -- List all withdrawal requests (admin) --
router.get('/withdrawals', async (req, res) => {
    try {
        const db = getBackend();
        const status = req.query.status || 'pending';
        const withdrawals = await db.all(
            `SELECT wr.*, u.username, u.email
             FROM withdrawal_requests wr
             LEFT JOIN users u ON wr.user_id = u.id
             WHERE wr.status = ?
             ORDER BY wr.requested_at DESC
             LIMIT 100`,
            [status]
        );
        res.json({ withdrawals, count: withdrawals.length });
    } catch (err) {
        console.error('[Admin WD] List error:', err.message);
        res.status(500).json({ error: 'Failed to list withdrawals' });
    }
});

// -- Get withdrawal stats (admin dashboard) --
router.get('/withdrawals/stats', async (req, res) => {
    try {
        const db = getBackend();
        const pending = await db.get(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM withdrawal_requests WHERE status = 'pending'`);
        const approved = await db.get(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM withdrawal_requests WHERE status = 'approved'`);
        const denied = await db.get(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM withdrawal_requests WHERE status = 'denied'`);
        var defaults = { count: 0, total: 0 };
        res.json({
            pending: pending || defaults,
            approved: approved || defaults,
            denied: denied || defaults
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// -- Approve withdrawal (admin) � buys back NFT, initiates Stripe payout --
router.post('/withdrawals/:id/approve', async (req, res) => {
    try {
        const db = getBackend();
        const { id } = req.params;
        const { adminNotes } = req.body;

        const wd = await db.get(`SELECT id, user_id, amount, status, nft_id FROM withdrawal_requests WHERE id = ?`, [id]);
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
        if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

        // Mark the associated NFT as "burned" (bought back by house)
        if (wd.nft_id) {
            await db.run(
                `UPDATE nfts SET status = 'burned', burned_at = datetime('now') WHERE id = ?`,
                [wd.nft_id]
            );
        }

        // Initiate Stripe payout if configured
        let stripePayoutId = null;
        if (config.STRIPE_SECRET_KEY) {
            try {
                const stripe = require('stripe')(config.STRIPE_SECRET_KEY);
                // Create a payout from the Stripe account balance
                const payout = await stripe.payouts.create({
                    amount: Math.round(wd.amount * 100), // cents
                    currency: 'usd',
                    description: `Casino withdrawal ${id} for user ${wd.user_id}`,
                    metadata: {
                        withdrawal_id: id,
                        user_id: String(wd.user_id),
                        nft_id: wd.nft_id || 'none'
                    }
                });
                stripePayoutId = payout.id;
                console.warn(`[Admin WD] Stripe payout created: ${payout.id}`);
            } catch (stripeErr) {
                console.warn('[Admin WD] Stripe payout failed:', stripeErr.message);
                // Still approve the withdrawal � admin can process manually
            }
        }

        // Atomic: only approve if still pending (prevents TOCTOU double-approval by concurrent admins)
        const approveResult = await db.run(
            `UPDATE withdrawal_requests
             SET status = 'approved', processed_at = datetime('now'), processed_by = ?, admin_notes = ?, stripe_payout_id = ?
             WHERE id = ? AND status = 'pending'`,
            [req.user?.username || 'admin', adminNotes || '', stripePayoutId, id]
        );
        if (!approveResult || approveResult.changes === 0) {
            return res.status(409).json({ error: 'Withdrawal was already processed by another admin' });
        }

        console.warn(`[Admin WD] Approved withdrawal ${id}: $${wd.amount}`);

        // Audit log
        await db.run(
            'INSERT INTO admin_audit_log (admin_username, action, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?)',
            [req.user?.username || 'admin', 'withdrawal_approve', String(id), `Approved $${wd.amount} withdrawal for user ${wd.user_id}` + (stripePayoutId ? ` (Stripe: ${stripePayoutId})` : ''), req.ip || 'unknown']
        ).catch(function(e) { console.warn('[Admin WD] Audit log failed:', e.message); });

        res.json({
            success: true,
            withdrawal: { id, amount: wd.amount, status: 'approved', stripePayoutId }
        });
    } catch (err) {
        console.error('[Admin WD] Approve error:', err.message);
        res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
});

// -- Deny withdrawal (admin) � refunds balance back to user --
router.post('/withdrawals/:id/deny', async (req, res) => {
    try {
        const db = getBackend();
        const { id } = req.params;
        const { adminNotes } = req.body;

        const wd = await db.get(`SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ?`, [id]);
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
        if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

        // Refund + status update wrapped in transaction for atomicity
        // Atomic WHERE guard prevents TOCTOU double-denial by concurrent admins
        await db.beginTransaction();
        try {
            const denyResult = await db.run(
                `UPDATE withdrawal_requests
                 SET status = 'denied', processed_at = datetime('now'), processed_by = ?, admin_notes = ?
                 WHERE id = ? AND status = 'pending'`,
                [req.user?.username || 'admin', String(adminNotes || 'Denied by admin').slice(0, 500), id]
            );
            if (!denyResult || denyResult.changes === 0) {
                await db.rollback().catch(function(rbErr) { console.warn('[AdminWithdrawals] Rollback failed:', rbErr.message); });
                return res.status(409).json({ error: 'Withdrawal was already processed by another admin' });
            }
            await db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [wd.amount, wd.user_id]);
            await db.commit();
        } catch (txErr) {
            await db.rollback().catch(function(rbErr) { console.warn('[Admin WD] Rollback failed:', rbErr.message); });
            throw txErr;
        }

        console.warn(`[Admin WD] Denied withdrawal ${id}: $${wd.amount} — refunded to user ${wd.user_id}`);

        // Audit log
        await db.run(
            'INSERT INTO admin_audit_log (admin_username, action, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?)',
            [req.user?.username || 'admin', 'withdrawal_deny', String(id), `Denied $${wd.amount} withdrawal for user ${wd.user_id}, refunded to balance`, req.ip || 'unknown']
        ).catch(function(e) { console.warn('[Admin WD] Audit log failed:', e.message); });

        res.json({
            success: true,
            withdrawal: { id, amount: wd.amount, status: 'denied', refunded: true }
        });
    } catch (err) {
        console.error('[Admin WD] Deny error:', err.message);
        res.status(500).json({ error: 'Failed to deny withdrawal' });
    }
});

module.exports = router;