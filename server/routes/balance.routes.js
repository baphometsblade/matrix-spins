const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

// GET /api/balance
router.get('/', authenticate, async (req, res) => {
    try {
        const user = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        res.json({ balance: user ? user.balance : 0 });
    } catch (err) {
        console.error('[Balance] Get balance error:', err);
        res.status(500).json({ error: 'Failed to get balance' });
    }
});

// POST /api/deposit
// Admin-only manual balance credit (for admin-approved deposits or support adjustments).
// Players cannot call this endpoint directly — all player deposits must go through
// /api/payments/deposit which creates a pending record for payment processor callback.
router.post('/deposit', authenticate, async (req, res) => {
    try {
        // Only admins can directly credit balance
        if (!req.user.is_admin) {
            return res.status(403).json({ error: 'Admin access required for direct deposits' });
        }

        const { amount, paymentRef, userId, reason } = req.body;
        const deposit = parseFloat(amount);
        // Allow admin to credit a specific user (or themselves)
        const targetUserId = userId ? parseInt(userId) : req.user.id;

        if (isNaN(deposit) || deposit <= 0) {
            return res.status(400).json({ error: 'Invalid deposit amount' });
        }
        if (deposit > 100000) {
            return res.status(400).json({ error: 'Maximum deposit is $100,000' });
        }

        const user = await db.get('SELECT balance FROM users WHERE id = ?', [targetUserId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balanceBefore = user.balance;
        const balanceAfter = balanceBefore + deposit;

        // Atomic credit (race-safe vs concurrent admin actions)
        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit, targetUserId]);

        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [targetUserId, 'deposit', deposit, balanceBefore, balanceAfter, paymentRef || 'admin-manual']
        );

        // Best-effort audit trail of which admin acted on whom
        await db.run(
            'INSERT INTO admin_audit (admin_id, target_user_id, action, amount, reason, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
            [req.user.id, targetUserId, 'manual_deposit', deposit, (reason || 'admin-manual').slice(0, 200)]
        ).catch(() => { /* admin_audit table may not exist on older schemas; skip silently */ });

        res.json({ balance: balanceAfter, message: `Deposited $${deposit.toFixed(2)}` });
    } catch (err) {
        console.error('[Balance] Deposit error:', err);
        res.status(500).json({ error: 'Deposit failed' });
    }
});

// POST /api/withdraw
// DEPRECATED — this legacy endpoint bypassed self-exclusion, OTP, 24h cooling-off,
// and bonus-wagering enforcement that lives in /api/payment/withdraw. It also did
// non-atomic balance writes (race condition: double-spend). All clients must use
// /api/payment/withdraw. The route now returns 410 Gone.
router.post('/withdraw', authenticate, async (req, res) => {
    return res.status(410).json({
        error: 'This endpoint is deprecated. Use POST /api/payment/withdraw instead.',
        upgrade: '/api/payment/withdraw'
    });
});

// GET /api/transactions
router.get('/transactions', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const rows = await db.all(
            'SELECT id, type, amount, balance_before, balance_after, reference, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?',
            [req.user.id, limit]
        );
        res.json({ transactions: rows });
    } catch (err) {
        console.error('[Balance] Transactions error:', err);
        res.status(500).json({ error: 'Failed to load transactions' });
    }
});

module.exports = router;
