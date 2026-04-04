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
        console.warn('[Balance] Get balance error:', err.message);
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

        const { amount, paymentRef, userId } = req.body;
        const deposit = parseFloat(amount);
        // Allow admin to credit a specific user (or themselves)
        const targetUserId = userId ? parseInt(userId) : req.user.id;

        // ROUND 56: Number.isFinite blocks Infinity/NaN
        if (!Number.isFinite(deposit) || deposit <= 0) {
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

        // Atomic balance credit — prevents race condition overwrites
        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit, targetUserId]);

        const balanceAfter = balanceBefore + deposit;

        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [targetUserId, 'deposit', deposit, balanceBefore, balanceAfter, paymentRef || 'admin-manual']
        );

        res.json({ balance: balanceAfter, message: `Deposited $${deposit.toFixed(2)}` });
    } catch (err) {
        console.warn('[Balance] Deposit error:', err.message);
        res.status(500).json({ error: 'Deposit failed' });
    }
});

// POST /api/withdraw — DISABLED for players
// All player withdrawals must use /api/payments/withdraw which enforces:
// wagering requirements, self-exclusion checks, deposit-required gate,
// bonus playthrough, OTP verification, cooling-off period, and limits.
// This endpoint now requires admin privileges (for support-initiated refunds only).
router.post('/withdraw', authenticate, async (req, res) => {
    try {
        if (!req.user.is_admin) {
            return res.status(403).json({ error: 'Use the Cashier to request withdrawals' });
        }
        const { amount, userId } = req.body;
        const withdrawal = parseFloat(amount);
        const targetUserId = userId ? parseInt(userId) : req.user.id;

        // ROUND 56: Number.isFinite blocks Infinity/NaN
        if (!Number.isFinite(withdrawal) || withdrawal <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal amount' });
        }

        // Atomic balance deduction — prevents race condition double-withdrawal
        const result = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [withdrawal, targetUserId, withdrawal]
        );
        if (!result || result.changes === 0) {
            return res.status(400).json({ error: 'Insufficient balance or user not found' });
        }

        const user = await db.get('SELECT balance FROM users WHERE id = ?', [targetUserId]);

        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [targetUserId, 'withdrawal', -withdrawal, (user ? user.balance : 0) + withdrawal, user ? user.balance : 0, 'admin-refund']
        );

        res.json({ balance: user ? user.balance : 0, message: `Withdrawal of $${withdrawal.toFixed(2)} processed` });
    } catch (err) {
        console.warn('[Balance] Withdrawal error:', err.message);
        res.status(500).json({ error: 'Withdrawal failed' });
    }
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
        console.warn('[Balance] Transactions error:', err.message);
        res.status(500).json({ error: 'Failed to load transactions' });
    }
});

module.exports = router;
