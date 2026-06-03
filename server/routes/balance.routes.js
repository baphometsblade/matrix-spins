const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

// GET /api/balance
router.get('/', authenticate, async (req, res) => {
    try {
        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.user.id]);
        const balance = user ? Number(user.balance) || 0 : 0;       // withdrawable, dollars
        const bonus = user ? Number(user.bonus_balance) || 0 : 0;   // locked until wagered, dollars
        // The wallet UI (wallet.html) and the slot engine (casino-engine.js boot)
        // read cents-suffixed fields — availableCents / balanceCents / lockedCents.
        // Returning only { balance } (dollars) made every balance render $0.00.
        // Keep `balance` (dollars) for backward-compat AND emit the cents fields
        // both clients expect. available = withdrawable, locked = bonus/wagering.
        res.json({
            balance,
            bonusBalance: bonus,
            balanceCents: Math.round(balance * 100),
            availableCents: Math.round(balance * 100),
            lockedCents: Math.round(bonus * 100),
            totalCents: Math.round((balance + bonus) * 100),
        });
    } catch (err) {
        console.warn('[Balance] Get balance error:', err.message);
        res.status(500).json({ error: 'Failed to get balance' });
    }
});

// POST /api/deposit
// Admin-only manual balance credit (for admin-approved deposits or support adjustments).
// Players cannot call this endpoint directly — all player deposits must go through
// /api/payments/deposit which creates a pending record for payment processor callback.
//
// ROUND 65: Per-call cap tightened from $100,000 to $10,000 (matches the
// other admin money endpoints and prevents a phished admin from draining
// the entire casino float at 30-calls-per-minute rate-limit speed).
// Added admin_audit_log write — this was missing, making forensics on
// admin-initiated credits much harder than on /user/:id/adjust-balance.
const ADMIN_MANUAL_DEPOSIT_CAP = 10000;

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
        if (deposit > ADMIN_MANUAL_DEPOSIT_CAP) {
            return res.status(400).json({
                error: `Manual deposit capped at $${ADMIN_MANUAL_DEPOSIT_CAP.toFixed(2)}. For larger credits use the Stripe webhook / approve-deposit flow.`,
                cap: ADMIN_MANUAL_DEPOSIT_CAP
            });
        }

        const user = await db.get('SELECT balance FROM users WHERE id = ?', [targetUserId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balanceBefore = user.balance;
        const balanceAfter = balanceBefore + deposit;

        await db.beginTransaction();
        try {
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit, targetUserId]);
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [targetUserId, 'deposit', deposit, balanceBefore, balanceAfter, paymentRef || 'admin-manual']
            );
            // ROUND 65: Compliance audit log — track which admin credited which user
            await db.run(
                "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, 'manual_deposit', ?, ?, datetime('now'))",
                [req.user.id, targetUserId, JSON.stringify({ amount: deposit, paymentRef: paymentRef || 'admin-manual', balanceBefore, balanceAfter })]
            ).catch(() => {});
            await db.commit();
        } catch (txErr) {
            await db.rollback();
            throw txErr;
        }

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

        await db.beginTransaction();
        try {
            // Atomic balance deduction — prevents race condition double-withdrawal
            const result = await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
                [withdrawal, targetUserId, withdrawal]
            );
            if (!result || result.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Insufficient balance or user not found' });
            }

            const user = await db.get('SELECT balance FROM users WHERE id = ?', [targetUserId]);

            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [targetUserId, 'withdrawal', -withdrawal, (user ? user.balance : 0) + withdrawal, user ? user.balance : 0, 'admin-refund']
            );

            await db.commit();
            res.json({ balance: user ? user.balance : 0, message: `Withdrawal of $${withdrawal.toFixed(2)} processed` });
        } catch (txErr) {
            await db.rollback();
            throw txErr;
        }
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
