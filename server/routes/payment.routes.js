const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { mintOnDeposit, recordResaleOnWithdrawal } = require('../services/nft-ledger');
const { mintDeposit } = require('../../blockchain/mint');
const { burnWithdrawal } = require('../../blockchain/burn');
// Shared responsible-gambling + velocity checks (also used by stripe-checkout.routes.js)
const depositChecks = require('../services/deposit-checks.service');
// AML compliance event logging
const aml = require('../services/aml.service');
// Realtime notifications (fire-and-forget)
let notify;
try { notify = require('../services/notification.service'); } catch (_) { notify = null; }

const router = express.Router();

// ─── Withdrawal request lock: prevents concurrent double-withdrawal race condition ───
// ROUND 64: TTL-map (userId → acquisition timestamp). Every 60s the sweep
// evicts entries older than 30 s — enough for any legit withdrawal to complete,
// but bounded so crashes don't leave a permanent lock. Previous implementation
// (`setInterval(() => set.clear(), 5 min)`) wiped the ENTIRE lock set on every
// tick, briefly opening a race window for any in-flight request that acquired
// just before the clear.
const activeWithdrawals = {
    _map: new Map(),
    add(userId) { this._map.set(userId, Date.now()); },
    has(userId) { return this._map.has(userId); },
    delete(userId) { this._map.delete(userId); },
    clear() { this._map.clear(); },
    get size() { return this._map.size; },
    [Symbol.iterator]() { return this._map.keys(); },
};
const _WITHDRAW_LOCK_TTL_MS = 30_000;
setInterval(function sweepStaleWithdrawLocks() {
    const cutoff = Date.now() - _WITHDRAW_LOCK_TTL_MS;
    for (const [uid, acquiredAt] of activeWithdrawals._map) {
        if (acquiredAt < cutoff) activeWithdrawals._map.delete(uid);
    }
}, 60 * 1000).unref();

// ─── OTP Rate Limiters (ROUND 66: split) ───
//
// Previously a single otpLimiter (5/15min per user) was shared across both
// /verify-otp and /resend-otp. An attacker who burned the budget on resend
// could prevent the legit user from verifying their own code, and that
// shared budget mixed two distinct security concerns. Now:
//
//   otpVerifyLimiter:  5 verify attempts / 15 min (matches the cumulative
//                      cancel threshold on incorrect codes — a legit user
//                      who needs >5 verify attempts has bigger problems)
//   otpResendLimiter:  3 resends / 15 min (rate-limit the email sender;
//                      legit users almost never need >1 resend)
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => `otp_verify:${req.user ? req.user.id : req.ip}`,
    handler: (req, res) => {
        res.status(429).json({ error: 'Too many OTP verification attempts. Please wait 15 minutes.' });
    },
    skipSuccessfulRequests: false,
});
const otpResendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    keyGenerator: (req) => `otp_resend:${req.user ? req.user.id : req.ip}`,
    handler: (req, res) => {
        res.status(429).json({ error: 'Too many resend requests. Please wait 15 minutes.' });
    },
    skipSuccessfulRequests: false,
});
// Backwards-compat alias for any code path that still uses otpLimiter; we
// route those to the verify limiter (the more restrictive of the two).
const otpLimiter = otpVerifyLimiter;

// ─── Helpers ───

function generateReference(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function maskCardNumber(cardNumber) {
    const digits = cardNumber.replace(/\D/g, '');
    return digits.slice(-4);
}

function maskBankAccount(accountNumber) {
    const digits = accountNumber.replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    return '***' + digits.slice(-4);
}

async function ensureUserLimitsRow(userId) {
    const existing = await db.get('SELECT user_id FROM user_limits WHERE user_id = ?', [userId]);
    if (!existing) {
        await db.run('INSERT INTO user_limits (user_id) VALUES (?)', [userId]);
    }
}

// ─── RG + velocity checks delegated to shared service ───
// The canonical implementations live in services/deposit-checks.service.js
// so stripe-checkout.routes.js + bundle.routes.js + matrix-money.routes.js
// all enforce the same limits. Thin wrappers kept here for call-site readability.
const checkExclusion       = (userId) => depositChecks.checkExclusion(userId);
const checkDepositLimits   = (userId, amount) => depositChecks.checkDepositLimits(userId, amount);
const checkDepositVelocity = (userId) => depositChecks.checkDepositVelocity(userId);

// ═══════════════════════════════════════════════════

// --- Withdrawal velocity fraud detection ---
// Blocks rapid-fire withdrawals that indicate automated abuse
async function checkWithdrawalVelocity(userId) {
    // Max 2 withdrawals per 24 hours
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const daily = await db.get(
        "SELECT COUNT(*) as count FROM withdrawals WHERE user_id = ? AND created_at >= ?",
        [userId, dayAgo]
    );
    if (daily && daily.count >= 2) {
        return 'Maximum 2 withdrawal requests per day. Please try again tomorrow.';
    }

    // Max 3 pending withdrawals at once
    const pending = await db.get(
        "SELECT COUNT(*) as count FROM withdrawals WHERE user_id = ? AND status = 'pending'",
        [userId]
    );
    if (pending && pending.count >= 3) {
        return 'You have too many pending withdrawals. Please wait for them to process.';
    }

    return null;
}
//  PAYMENT METHODS
// ═══════════════════════════════════════════════════

// GET /api/payments/methods — list user's saved payment methods
router.get('/methods', authenticate, async (req, res) => {
    try {
        const methods = await db.all(
            'SELECT id, type, label, details_encrypted, is_default, is_verified, created_at FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
            [req.user.id]
        );
        res.json({ methods });
    } catch (err) {
        console.warn('[Payment] List methods error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve payment methods' });
    }
});

// POST /api/payments/methods — add a new payment method
router.post('/methods', authenticate, async (req, res) => {
    try {
        const { type, label, details } = req.body;

        if (!type || !label) {
            return res.status(400).json({ error: 'Type and label are required' });
        }

        if (!config.PAYMENT_METHODS.includes(type)) {
            return res.status(400).json({
                error: `Invalid payment type. Allowed: ${config.PAYMENT_METHODS.join(', ')}`
            });
        }

        if (!details || typeof details !== 'object') {
            return res.status(400).json({ error: 'Payment details are required' });
        }

        // Build safe stored details based on type
        let storedDetails = {};

        if (type === 'visa' || type === 'mastercard') {
            if (!details.cardNumber) {
                return res.status(400).json({ error: 'Card number is required' });
            }
            const last4 = maskCardNumber(details.cardNumber);
            if (last4.length < 4) {
                return res.status(400).json({ error: 'Invalid card number' });
            }
            storedDetails = {
                last4,
                expiryMonth: details.expiryMonth || null,
                expiryYear: details.expiryYear || null,
                cardholderName: details.cardholderName || null
            };
        } else if (type === 'payid') {
            if (!details.payId) {
                return res.status(400).json({ error: 'PayID is required' });
            }
            storedDetails = { payId: details.payId };
        } else if (type === 'bank_transfer') {
            if (!details.bsb || !details.accountNumber) {
                return res.status(400).json({ error: 'BSB and account number are required' });
            }
            storedDetails = {
                bsb: details.bsb,
                accountNumber: maskBankAccount(details.accountNumber),
                accountName: details.accountName || null
            };
        } else if (type.startsWith('crypto_')) {
            if (!details.walletAddress) {
                return res.status(400).json({ error: 'Wallet address is required' });
            }
            storedDetails = { walletAddress: details.walletAddress };
        }

        // Check if this is the first method — auto-set as default
        const existingCount = await db.get(
            'SELECT COUNT(*) as count FROM payment_methods WHERE user_id = ?',
            [req.user.id]
        );
        const isDefault = existingCount.count === 0 ? 1 : 0;

        const result = await db.run(
            'INSERT INTO payment_methods (user_id, type, label, details_encrypted, is_default) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, type, label, JSON.stringify(storedDetails), isDefault]
        );

        res.json({
            message: 'Payment method added',
            method: {
                id: result.lastInsertRowid,
                type,
                label,
                details_encrypted: JSON.stringify(storedDetails),
                is_default: isDefault,
                is_verified: 0
            }
        });
    } catch (err) {
        console.warn('[Payment] Add method error:', err.message);
        res.status(500).json({ error: 'Failed to add payment method' });
    }
});

// DELETE /api/payments/methods/:id — remove a payment method
router.delete('/methods/:id', authenticate, async (req, res) => {
    try {
        const methodId = parseInt(req.params.id);
        if (isNaN(methodId)) {
            return res.status(400).json({ error: 'Invalid method ID' });
        }

        const method = await db.get(
            'SELECT id, is_default FROM payment_methods WHERE id = ? AND user_id = ?',
            [methodId, req.user.id]
        );
        if (!method) {
            return res.status(404).json({ error: 'Payment method not found' });
        }

        await db.run('DELETE FROM payment_methods WHERE id = ? AND user_id = ?', [methodId, req.user.id]);

        // If we deleted the default, promote the next one
        if (method.is_default) {
            const next = await db.get(
                'SELECT id FROM payment_methods WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
                [req.user.id]
            );
            if (next) {
                await db.run('UPDATE payment_methods SET is_default = 1 WHERE id = ?', [next.id]);
            }
        }

        res.json({ message: 'Payment method removed' });
    } catch (err) {
        console.warn('[Payment] Delete method error:', err.message);
        res.status(500).json({ error: 'Failed to remove payment method' });
    }
});

// PUT /api/payments/methods/:id/default — set as default payment method
router.put('/methods/:id/default', authenticate, async (req, res) => {
    try {
        const methodId = parseInt(req.params.id);
        if (isNaN(methodId)) {
            return res.status(400).json({ error: 'Invalid method ID' });
        }

        const method = await db.get(
            'SELECT id FROM payment_methods WHERE id = ? AND user_id = ?',
            [methodId, req.user.id]
        );
        if (!method) {
            return res.status(404).json({ error: 'Payment method not found' });
        }

        // Clear all defaults for this user, then set the new one
        await db.run('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?', [req.user.id]);
        await db.run('UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?', [methodId, req.user.id]);

        res.json({ message: 'Default payment method updated' });
    } catch (err) {
        console.warn('[Payment] Set default error:', err.message);
        res.status(500).json({ error: 'Failed to update default payment method' });
    }
});

// ═══════════════════════════════════════════════════
//  DEPOSITS
// ═══════════════════════════════════════════════════

// POST /api/payments/deposit — create and auto-complete a deposit
router.post('/deposit', authenticate, async (req, res) => {
    try {
        const { amount, paymentType, paymentMethodId } = req.body;
        const deposit = parseFloat(amount);

        // ROUND 56: Number.isFinite blocks Infinity/NaN — isNaN alone allowed Infinity deposits
        if (!Number.isFinite(deposit) || deposit <= 0) {
            return res.status(400).json({ error: 'Invalid deposit amount' });
        }
        if (deposit < config.MIN_DEPOSIT) {
            return res.status(400).json({ error: `Minimum deposit is $${config.MIN_DEPOSIT.toFixed(2)}` });
        }
        if (deposit > config.MAX_DEPOSIT) {
            return res.status(400).json({ error: `Maximum deposit is $${config.MAX_DEPOSIT.toFixed(2)}` });
        }

        if (!paymentType) {
            return res.status(400).json({ error: 'Payment type is required' });
        }
        if (!config.PAYMENT_METHODS.includes(paymentType)) {
            return res.status(400).json({ error: 'Invalid payment type' });
        }

        // Check self-exclusion
        const exclusion = await checkExclusion(req.user.id);
        if (exclusion) {
            return res.status(403).json({ error: exclusion });
        }

        // Check deposit limits
        await ensureUserLimitsRow(req.user.id);
        const limitError = await checkDepositLimits(req.user.id, deposit);
        if (limitError) {
            return res.status(400).json({ error: limitError });
        }

        // Deposit velocity fraud check
        const velocityError = await checkDepositVelocity(req.user.id);
        if (velocityError) {
            return res.status(429).json({ error: velocityError });
        }

        // Validate payment method ownership if provided
        if (paymentMethodId) {
            const pm = await db.get(
                'SELECT id FROM payment_methods WHERE id = ? AND user_id = ?',
                [paymentMethodId, req.user.id]
            );
            if (!pm) {
                return res.status(400).json({ error: 'Invalid payment method' });
            }
        }

        const reference = generateReference('DEP');

        // Create deposit record as PENDING — balance is NOT credited yet.
        // In production, a payment processor webhook (Stripe, PayPal, etc.) calls
        // a separate callback endpoint to confirm payment, which then credits balance.
        // This prevents users from getting free money by calling this endpoint directly.
        const depositResult = await db.run(
            'INSERT INTO deposits (user_id, amount, currency, payment_method_id, payment_type, status, reference) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, deposit, config.CURRENCY, paymentMethodId || null, paymentType, 'pending', reference]
        );
        const depositId = depositResult.lastInsertRowid;

        // Gems are awarded ONLY when the deposit is confirmed (via webhook/admin approval).
        // Previously gems were awarded here on submission AND again on confirmation = double-gem exploit.

        res.json({
            message: `Deposit of $${deposit.toFixed(2)} submitted — awaiting payment confirmation`,
            deposit: {
                id: depositId,
                amount: deposit,
                currency: config.CURRENCY,
                status: 'pending',
                reference
            },
            gemsAwarded: 0
        });
    } catch (err) {
        console.warn('[Payment] Deposit error:', err.message);
        res.status(500).json({ error: 'Deposit failed' });
    }
});

// GET /api/payments/deposits — list user's deposit history
router.get('/deposits', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const deposits = await db.all(
            'SELECT id, amount, currency, payment_type, status, reference, external_ref, created_at, completed_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?',
            [req.user.id, limit]
        );
        res.json({ deposits });
    } catch (err) {
        console.warn('[Payment] List deposits error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve deposit history' });
    }
});

// ═══════════════════════════════════════════════════
//  WITHDRAWALS
// ═══════════════════════════════════════════════════

// POST /api/payments/withdraw — create a withdrawal request
router.post('/withdraw', authenticate, async (req, res) => {
    // SECURITY: Per-user lock prevents concurrent withdrawal race condition
    const lockKey = String(req.user.id);
    if (activeWithdrawals.has(lockKey)) {
        return res.status(429).json({ error: 'Another withdrawal request is being processed. Please wait.' });
    }
    activeWithdrawals.add(lockKey);
    try {
        const { amount, paymentType, paymentMethodId } = req.body;
        const withdrawal = parseFloat(amount);

        if (!Number.isFinite(withdrawal) || withdrawal <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal amount' });
        }
        if (withdrawal < config.MIN_WITHDRAWAL) {
            return res.status(400).json({ error: `Minimum withdrawal is $${config.MIN_WITHDRAWAL.toFixed(2)}` });
        }
        if (withdrawal > config.MAX_WITHDRAWAL) {
            return res.status(400).json({ error: `Maximum withdrawal is $${config.MAX_WITHDRAWAL.toFixed(2)}` });
        }

        if (!paymentType) {
            return res.status(400).json({ error: 'Payment type is required' });
        }
        if (!config.PAYMENT_METHODS.includes(paymentType)) {
            return res.status(400).json({ error: 'Invalid payment type' });
        }

        // Check self-exclusion
        const exclusion = await checkExclusion(req.user.id);
        if (exclusion) {
            return res.status(403).json({ error: exclusion });
        }

        // Withdrawal velocity fraud check
        const wdVelocityError = await checkWithdrawalVelocity(req.user.id);
        if (wdVelocityError) {
            return res.status(429).json({ error: wdVelocityError });
        }

        const user = await db.get('SELECT balance, bonus_balance, wagering_requirement, wagering_progress, email_verified, kyc_status FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // -- Require verified email for withdrawals (anti-fraud) --
        if (!user.email_verified) {
            return res.status(403).json({
                error: 'Please verify your email address before requesting a withdrawal.',
                action: 'verify_email'
            });
        }

        // ROUND 41: KYC verification required for withdrawals over $2,000 (AML compliance)
        if (withdrawal > 2000) {
            var kycStatus = user.kyc_status || 'unverified';
            if (kycStatus !== 'verified') {
                return res.status(403).json({
                    error: 'Identity verification required for withdrawals over $2,000.',
                    action: 'verify_identity',
                    kycStatus: kycStatus,
                    threshold: 2000
                });
            }
        }

        // ROUND 41: Lifetime withdrawal cap for unverified users ($5,000)
        if ((user.kyc_status || 'unverified') !== 'verified') {
            try {
                var lifetimeWithdrawals = await db.get(
                    "SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE user_id = ? AND status IN ('completed', 'pending', 'processing')",
                    [req.user.id]
                );
                var totalWithdrawn = lifetimeWithdrawals ? parseFloat(lifetimeWithdrawals.total) || 0 : 0;
                if (totalWithdrawn + withdrawal > 5000) {
                    return res.status(403).json({
                        error: 'Lifetime withdrawal limit of $5,000 reached for unverified accounts. Please complete KYC verification.',
                        action: 'verify_identity',
                        lifetimeWithdrawn: totalWithdrawn,
                        limit: 5000
                    });
                }
            } catch (kycErr) {
                // If withdrawals table doesn't exist, allow (table may not be created yet)
                if (kycErr.message && kycErr.message.includes('no such table')) { /* OK */ }
                else {
                    console.error('[Withdrawal] Lifetime check error:', kycErr.message);
                    return res.status(500).json({ error: 'Security check failed' });
                }
            }
        }

        // Withdrawable balance = real balance only (bonus_balance is a separate column, not included in balance)
        var withdrawableBalance = user.balance || 0;
        if (withdrawableBalance < withdrawal) {
            return res.status(400).json({
                error: 'Insufficient withdrawable balance. Bonus funds cannot be withdrawn directly.',
                balance: user.balance,
                bonusBalance: user.bonus_balance || 0,
                withdrawableBalance: withdrawableBalance
            });
        }

        // Wagering requirement: must wager at least 1x total deposits before withdrawing
        const totalDeposited = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = 'completed'",
            [req.user.id]
        );
        const totalWagered = await db.get(
            'SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?',
            [req.user.id]
        );
        const deposited = totalDeposited ? totalDeposited.total : 0;
        const wagered = totalWagered ? totalWagered.total : 0;
        if (deposited > 0 && wagered < deposited) {
            const remaining = (deposited - wagered).toFixed(2);
            return res.status(400).json({
                error: `Wagering requirement not met. You must wager $${remaining} more before withdrawing. (Wagered: $${wagered.toFixed(2)} / Required: $${deposited.toFixed(2)})`,
                wagerRequired: deposited,
                wagerCompleted: wagered,
                wagerRemaining: deposited - wagered
            });
        }

        // Block withdrawal if active bonus wagering is incomplete
        if (user.wagering_requirement > 0 && user.wagering_progress < user.wagering_requirement) {
            const remaining = (user.wagering_requirement - user.wagering_progress).toFixed(2);
            const pct = Math.round((user.wagering_progress / user.wagering_requirement) * 100);
            return res.status(400).json({
                error: `Bonus wagering requirement not met. Wager $${remaining} more to unlock your $${(user.bonus_balance || 0).toFixed(2)} bonus. (${pct}% complete)`,
                bonusWagering: {
                    requirement: user.wagering_requirement,
                    progress: user.wagering_progress,
                    remaining: user.wagering_requirement - user.wagering_progress,
                    bonusBalance: user.bonus_balance || 0,
                    pct
                }
            });
        }

        // ── Must have at least one completed deposit to withdraw ──
        // Prevents pure bonus abuse (users who never deposit accumulating free money)
        if (!deposited || deposited <= 0) {
            return res.status(400).json({
                error: 'You must make at least one deposit before you can request a withdrawal.'
            });
        }

        // ── ROUND 26: Deposit hold period — 24h minimum after last deposit ──
        // Prevents deposit→withdraw laundering (player deposits, never plays, withdraws)
        try {
            var lastDepositRow = await db.get(
                "SELECT MAX(created_at) as last_deposit FROM deposits WHERE user_id = ? AND status = 'completed'",
                [req.user.id]
            );
            if (lastDepositRow && lastDepositRow.last_deposit) {
                var lastDepositTime = new Date(lastDepositRow.last_deposit).getTime();
                var hoursSinceDeposit = (Date.now() - lastDepositTime) / 3600000;
                if (hoursSinceDeposit < 24) {
                    var hoursRemaining = Math.ceil(24 - hoursSinceDeposit);
                    return res.status(400).json({
                        error: 'Withdrawals are available 24 hours after your last deposit. Please wait ' + hoursRemaining + ' more hour(s).',
                        holdPeriodEnds: new Date(lastDepositTime + 24 * 3600000).toISOString()
                    });
                }
            }
        } catch (_depositHoldErr) {
            console.warn('[Payment] Deposit hold check error:', _depositHoldErr.message);
        }

        // ── ROUND 26: Deposit-to-withdrawal ratio (AML protection) ──
        // Prevents withdrawing more than 20x lifetime deposits without admin review
        var maxWithdrawalRatio = 20;
        if (withdrawal > deposited * maxWithdrawalRatio) {
            return res.status(400).json({
                error: 'Withdrawal amount exceeds allowed ratio. Please contact support for large withdrawals.',
                maxAllowed: deposited * maxWithdrawalRatio
            });
        }

        // ── Non-deposit bonus playthrough requirement (5x multiplier, capped) ──
        // All free bonus credits (birthday, daily missions, challenges, mystery drops,
        // deposit streak, promo codes, free spins) must be wagered 5x before withdrawal
        const BONUS_WAGER_MULT = 5;
        const MAX_BONUS_WAGER_CAP = 100000; // $100K cap prevents stuck accounts
        const bonusCreditsRow = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND amount > 0 AND type IN ('bonus', 'mystery_drop', 'birthday_bonus', 'deposit_streak', 'challenge_reward', 'streak_bonus', 'free_spin', 'promo')",
            [req.user.id]
        );
        const totalBonusReceived = bonusCreditsRow ? bonusCreditsRow.total : 0;
        const bonusWagerRequired = Math.min(totalBonusReceived * BONUS_WAGER_MULT, MAX_BONUS_WAGER_CAP);
        if (totalBonusReceived > 0 && wagered < bonusWagerRequired) {
            const bonusRemaining = (bonusWagerRequired - wagered).toFixed(2);
            return res.status(400).json({
                error: `Free bonus playthrough not met. Wager $${bonusRemaining} more before withdrawing. (Wagered: $${wagered.toFixed(2)} / Required: $${bonusWagerRequired.toFixed(2)})`,
                bonusPlaythrough: {
                    totalBonusReceived: totalBonusReceived,
                    multiplier: BONUS_WAGER_MULT,
                    required: bonusWagerRequired,
                    wagered: wagered,
                    remaining: bonusWagerRequired - wagered
                }
            });
        }

        // Validate payment method ownership if provided
        if (paymentMethodId) {
            const pm = await db.get(
                'SELECT id FROM payment_methods WHERE id = ? AND user_id = ?',
                [paymentMethodId, req.user.id]
            );
            if (!pm) {
                return res.status(400).json({ error: 'Invalid payment method' });
            }
        }

        const reference = generateReference('WDR');
        const balanceBefore = user.balance;

        // ── ATOMIC: Wrap deduction + record + transaction log in DB transaction ──
        await db.beginTransaction();
        var withdrawalId;
        var balanceAfter;
        try {
            // Atomic balance deduction — prevents race condition double-withdrawal
            const deductResult = await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
                [withdrawal, req.user.id, withdrawal]
            );
            if (!deductResult || deductResult.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Insufficient balance' });
            }
            balanceAfter = balanceBefore - withdrawal;

            // Create withdrawal record as pending (awaits admin processing)
            const wdResult = await db.run(
                'INSERT INTO withdrawals (user_id, amount, currency, payment_method_id, payment_type, status, reference) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [req.user.id, withdrawal, config.CURRENCY, paymentMethodId || null, paymentType, 'pending', reference]
            );
            withdrawalId = wdResult.lastInsertRowid;

            // Log transaction
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, 'withdrawal', -withdrawal, balanceBefore, balanceAfter, reference]
            );

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_rb) { console.warn('[payment] rollback error:', _rb.message); }
            throw txErr;
        }

        // ── NFT ledger: record withdrawal as NFT resale (fire-and-forget) ──
        recordResaleOnWithdrawal(db, { userId: req.user.id, amount: withdrawal, withdrawalId: withdrawalId, paymentType: paymentType, reference: reference, currency: config.CURRENCY }).catch(function() {});

        // Silent blockchain burn — fire-and-forget (DB is source of truth)
        burnWithdrawal('server-wallet', withdrawal)
            .catch(function(err) { console.warn('[Blockchain] Burn failed for withdrawal', withdrawalId, ':', err.message); });

        // AML analysis — flags large withdrawals + rapid-turnaround laundering pattern
        aml.analyseWithdrawal(req.user.id, withdrawal, reference).catch(function(e) {
            console.warn('[AML] analyseWithdrawal error:', e.message);
        });

        // ── Withdrawal OTP (email-confirmed high-value withdrawals) ────────
        // Any withdrawal ≥ WITHDRAWAL_OTP_THRESHOLD gets a 6-digit OTP emailed
        // to the user. Blocks account-takeover theft: even with a stolen JWT,
        // the attacker can't complete the withdrawal without the user's email.
        let otpRequired = false;
        const OTP_THRESHOLD = config.WITHDRAWAL_OTP_THRESHOLD || 500;
        if (withdrawal >= OTP_THRESHOLD) {
            try {
                // 6-digit OTP from crypto RNG (never Math.random)
                const rand = crypto.randomBytes(3).readUIntBE(0, 3);
                const otpCode = String(rand % 1_000_000).padStart(6, '0');
                await db.run(
                    "UPDATE withdrawals SET otp_code = ?, otp_attempts = 0, otp_created_at = datetime('now') WHERE id = ?",
                    [otpCode, withdrawalId]
                );
                otpRequired = true;

                // Look up user email for delivery (fire-and-forget — user can
                // also resend via /withdraw/:id/resend-otp if the email doesn't arrive)
                const emailRow = await db.get('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
                if (emailRow && emailRow.email) {
                    const emailService = require('../services/email.service');
                    emailService.sendWithdrawalOtp(
                        emailRow.email,
                        emailRow.username,
                        otpCode,
                        withdrawal,
                        config.CURRENCY,
                        config.WITHDRAWAL_OTP_EXPIRY_MINUTES || 15,
                        req.user.id
                    ).catch(function(e) {
                        console.warn('[Payment] OTP email send failed:', e.message);
                    });
                }
            } catch (otpErr) {
                console.warn('[Payment] OTP generation error (non-blocking):', otpErr.message);
            }
        }

        // Calculate when cooling-off ends (24h from now)
        var coolingOffEnds = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        if (notify) {
            notify.notify({
                userId: req.user.id,
                type: 'withdrawal',
                title: 'Withdrawal Submitted',
                body: `Your $${withdrawal.toFixed(2)} withdrawal is in the review queue.`,
                linkAction: 'wallet.html',
            }).catch(function(){});
        }

        // Withdrawal requested email (always — transactional, fire-and-forget)
        try {
            const userRow = await db.get('SELECT username, email FROM users WHERE id = ?', [req.user.id]);
            if (userRow && userRow.email) {
                const emailService = require('../services/email.service');
                emailService.sendWithdrawalRequested(userRow.email, req.user.id, {
                    username: userRow.username,
                    amount: withdrawal,
                    currency: config.CURRENCY,
                    reference,
                    paymentType,
                    etaDays: (config.WITHDRAWAL_PROCESSING_DAYS || 3),
                }).catch(e => console.warn('[Payment] withdrawal email failed:', e.message));
            }
        } catch (_) { /* non-fatal */ }

        res.json({
            message: otpRequired
                ? `Withdrawal of $${withdrawal.toFixed(2)} submitted. Check your email for a verification code to confirm it, then admin review (${config.WITHDRAWAL_PROCESSING_DAYS + 1} days).`
                : `Withdrawal of $${withdrawal.toFixed(2)} submitted. 24-hour review period before processing.`,
            balance: balanceAfter,
            otpRequired,
            otpExpiryMinutes: otpRequired ? (config.WITHDRAWAL_OTP_EXPIRY_MINUTES || 15) : undefined,
            withdrawal: {
                id: withdrawalId,
                amount: withdrawal,
                currency: config.CURRENCY,
                status: 'pending',
                reference,
                coolingOffEnds: coolingOffEnds,
                estimatedDays: config.WITHDRAWAL_PROCESSING_DAYS + 1
            }
        });
    } catch (err) {
        console.warn('[Payment] Withdrawal error:', err.message);
        res.status(500).json({ error: 'Withdrawal failed' });
    } finally {
        activeWithdrawals.delete(lockKey);
    }
});

// GET /api/payments/withdrawals — list user's withdrawal history
router.get('/withdrawals', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const withdrawals = await db.all(
            'SELECT id, amount, currency, payment_type, status, admin_note, reference, created_at, processed_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?',
            [req.user.id, limit]
        );
        res.json({ withdrawals });
    } catch (err) {
        console.warn('[Payment] List withdrawals error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve withdrawal history' });
    }
});

// POST /api/payments/withdraw/verify-otp — verify OTP to confirm a withdrawal
router.post('/withdraw/verify-otp', authenticate, otpVerifyLimiter, async (req, res) => {
    try {
        const { withdrawal_id, otp } = req.body;
        if (!withdrawal_id || !otp) {
            return res.status(400).json({ error: 'withdrawal_id and otp are required' });
        }

        const wd = await db.get(
            'SELECT id, user_id, amount, status, otp_code, otp_attempts, otp_created_at FROM withdrawals WHERE id = ? AND user_id = ?',
            [parseInt(withdrawal_id), req.user.id]
        );
        if (!wd) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }
        if (wd.status !== 'pending') {
            return res.status(400).json({ error: `Withdrawal is not pending (status: ${wd.status})` });
        }
        if (!wd.otp_code) {
            return res.status(400).json({ error: 'No OTP is set for this withdrawal or it has been invalidated' });
        }

        // Enforce OTP expiry. Expired OTPs are invalidated so a stolen code
        // from an old inbox can't be replayed after the window.
        const expiryMin = config.WITHDRAWAL_OTP_EXPIRY_MINUTES || 15;
        if (wd.otp_created_at) {
            const ageMs = Date.now() - new Date(wd.otp_created_at).getTime();
            if (ageMs > expiryMin * 60 * 1000) {
                await db.run(
                    'UPDATE withdrawals SET otp_code = NULL WHERE id = ?',
                    [wd.id]
                );
                return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
            }
        }

        // Atomic attempt increment — prevents the parallel-guess race where
        // five concurrent verify requests all read otp_attempts=0, all compute
        // attempts=1, and all miss the attempts>=5 cancel threshold. The
        // increment itself is now the serialisation point: each request's
        // RETURNING gives the post-increment value it owns.
        //
        // Fallback when RETURNING isn't supported (older SQLite < 3.35): a
        // transaction wraps the increment + re-read so concurrent requests
        // serialise through the row-level lock.
        let attempts;
        let otpCodeInDb;
        try {
            const incResult = await db.get(
                "UPDATE withdrawals SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ? AND user_id = ? AND status = 'pending' AND otp_code IS NOT NULL RETURNING otp_attempts, otp_code",
                [wd.id, req.user.id]
            );
            if (incResult && incResult.otp_attempts) {
                attempts = incResult.otp_attempts;
                otpCodeInDb = incResult.otp_code;
            }
        } catch (_) { /* RETURNING unsupported — fall through to transaction fallback */ }
        if (attempts == null) {
            await db.beginTransaction();
            try {
                await db.run(
                    "UPDATE withdrawals SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ? AND user_id = ? AND status = 'pending' AND otp_code IS NOT NULL",
                    [wd.id, req.user.id]
                );
                const fresh = await db.get(
                    'SELECT otp_attempts, otp_code FROM withdrawals WHERE id = ?',
                    [wd.id]
                );
                await db.commit();
                attempts = fresh ? fresh.otp_attempts : null;
                otpCodeInDb = fresh ? fresh.otp_code : null;
            } catch (txErr) {
                await db.rollback();
                throw txErr;
            }
        }
        if (attempts == null || otpCodeInDb == null) {
            return res.status(400).json({ error: 'No OTP is set for this withdrawal or it has been invalidated' });
        }

        // Constant-time compare to avoid leaking code digits through timing
        const submitted = String(otp);
        let matches = false;
        try {
            if (submitted.length === otpCodeInDb.length) {
                matches = crypto.timingSafeEqual(Buffer.from(submitted, 'utf8'), Buffer.from(otpCodeInDb, 'utf8'));
            }
        } catch (_) { matches = false; }

        if (!matches) {
            if (attempts >= 5) {
                // Invalidate the OTP, cancel the withdrawal, and refund — all atomically.
                await db.beginTransaction();
                try {
                    await db.run(
                        "UPDATE withdrawals SET otp_code = NULL, status = 'cancelled', admin_note = 'OTP invalidated after 5 failed attempts', processed_at = datetime('now') WHERE id = ? AND status = 'pending'",
                        [wd.id]
                    );
                    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [wd.amount, req.user.id]);
                    await db.run(
                        "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) SELECT ?, 'withdrawal_cancel', ?, balance - ?, balance, ? FROM users WHERE id = ?",
                        [req.user.id, wd.amount, wd.amount, `WDR-OTP-FAIL-${wd.id}`, req.user.id]
                    );
                    await db.commit();
                } catch (txErr) {
                    await db.rollback();
                    throw txErr;
                }
                return res.status(400).json({ error: 'Too many incorrect OTP attempts — withdrawal has been cancelled and refunded' });
            }
            return res.status(400).json({ error: `Incorrect OTP. ${Math.max(0, 5 - attempts)} attempt(s) remaining.` });
        }

        // OTP correct — mark as otp_verified atomically (guard against concurrent race)
        await db.run(
            "UPDATE withdrawals SET status = 'otp_verified', otp_code = NULL, otp_attempts = 0, otp_verified_at = datetime('now') WHERE id = ? AND status = 'pending'",
            [wd.id]
        );
        res.json({ message: 'OTP verified. Withdrawal queued for admin review.', withdrawal_id: wd.id });
    } catch (err) {
        console.warn('[Payment] OTP verify error:', err.message);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});

// POST /api/payments/withdraw/:id/resend-otp — rotate + resend the OTP
// Rate-limited via otpResendLimiter (3/15min, separate from verify limiter)
// to prevent abuse as a free email sender + keep verify budget for the user.
router.post('/withdraw/:id/resend-otp', authenticate, otpResendLimiter, async (req, res) => {
    try {
        const withdrawalId = parseInt(req.params.id, 10);
        if (!Number.isInteger(withdrawalId) || withdrawalId <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal id' });
        }
        const wd = await db.get(
            'SELECT id, user_id, amount, status FROM withdrawals WHERE id = ? AND user_id = ?',
            [withdrawalId, req.user.id]
        );
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
        if (wd.status !== 'pending') {
            return res.status(400).json({ error: `Withdrawal is not pending (status: ${wd.status})` });
        }
        if (wd.amount < (config.WITHDRAWAL_OTP_THRESHOLD || 500)) {
            return res.status(400).json({ error: 'OTP not required for this withdrawal' });
        }

        // Rotate to a fresh 6-digit code (invalidates any previously emailed one).
        // ROUND 64: otp_attempts is NOT reset — the 5-wrong-attempts cancel
        // threshold is cumulative across resends. Otherwise an attacker could
        // loop resend + 4 wrong guesses per 15-min window and brute-force the
        // code over time. Legitimate users rarely need more than 1-2 attempts;
        // if they really need a fresh start they can cancel + re-submit.
        const rand = crypto.randomBytes(3).readUIntBE(0, 3);
        const otpCode = String(rand % 1_000_000).padStart(6, '0');
        await db.run(
            "UPDATE withdrawals SET otp_code = ?, otp_created_at = datetime('now') WHERE id = ?",
            [otpCode, wd.id]
        );

        const user = await db.get('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
        if (user && user.email) {
            const emailService = require('../services/email.service');
            emailService.sendWithdrawalOtp(
                user.email,
                user.username,
                otpCode,
                wd.amount,
                config.CURRENCY,
                config.WITHDRAWAL_OTP_EXPIRY_MINUTES || 15
            ).catch(function(e) {
                console.warn('[Payment] OTP resend email error:', e.message);
            });
        }
        res.json({
            ok: true,
            message: 'A new verification code has been emailed to you.',
            expiryMinutes: config.WITHDRAWAL_OTP_EXPIRY_MINUTES || 15,
        });
    } catch (err) {
        console.warn('[Payment] OTP resend error:', err.message);
        res.status(500).json({ error: 'Failed to resend OTP' });
    }
});

// POST /api/payments/withdraw/:id/cancel — cancel a pending withdrawal
router.post('/withdraw/:id/cancel', authenticate, async (req, res) => {
    try {
        const withdrawalId = parseInt(req.params.id);
        if (isNaN(withdrawalId)) {
            return res.status(400).json({ error: 'Invalid withdrawal ID' });
        }

        const wd = await db.get(
            'SELECT id, amount, status FROM withdrawals WHERE id = ? AND user_id = ?',
            [withdrawalId, req.user.id]
        );
        if (!wd) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }
        if (wd.status !== 'pending') {
            return res.status(400).json({ error: `Cannot cancel a withdrawal with status: ${wd.status}` });
        }

        // ── ATOMIC: Wrap cancel + refund + transaction log in DB transaction ──
        await db.beginTransaction();
        try {
            const cancelResult = await db.run(
                "UPDATE withdrawals SET status = 'cancelled', processed_at = datetime('now'), admin_note = 'Cancelled by user' WHERE id = ? AND status = 'pending'",
                [withdrawalId]
            );
            if (!cancelResult || cancelResult.changes === 0) {
                await db.rollback();
                return res.status(400).json({ error: 'Withdrawal already processed or cancelled' });
            }

            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [wd.amount, req.user.id]);

            const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
            const newBalance = updatedUser ? updatedUser.balance : 0;

            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, 'withdrawal_cancel', wd.amount, newBalance - wd.amount, newBalance, `WDR-CANCEL-${withdrawalId}`]
            );

            await db.commit();

            res.json({
                message: `Withdrawal of $${wd.amount.toFixed(2)} cancelled and refunded`,
                balance: newBalance
            });
        } catch (txErr) {
            try { await db.rollback(); } catch (_rb) { console.warn('[payment] rollback error:', _rb.message); }
            throw txErr;
        }
    } catch (err) {
        console.warn('[Payment] Cancel withdrawal error:', err.message);
        res.status(500).json({ error: 'Failed to cancel withdrawal' });
    }
});

// ═══════════════════════════════════════════════════
//  RESPONSIBLE GAMBLING — LIMITS
// ═══════════════════════════════════════════════════

// GET /api/payments/limits — get user's current limits
router.get('/limits', authenticate, async (req, res) => {
    try {
        await ensureUserLimitsRow(req.user.id);
        const limits = await db.get(
            'SELECT daily_deposit_limit, weekly_deposit_limit, monthly_deposit_limit, daily_loss_limit, session_time_limit, self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?',
            [req.user.id]
        );
        res.json({ limits });
    } catch (err) {
        console.warn('[Payment] Get limits error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve limits' });
    }
});

// PUT /api/payments/limits — update deposit/loss/time limits
router.put('/limits', authenticate, async (req, res) => {
    try {
        const {
            daily_deposit_limit,
            weekly_deposit_limit,
            monthly_deposit_limit,
            daily_loss_limit,
            session_time_limit
        } = req.body;

        await ensureUserLimitsRow(req.user.id);

        const current = await db.get(
            'SELECT daily_deposit_limit, weekly_deposit_limit, monthly_deposit_limit, daily_loss_limit, session_time_limit FROM user_limits WHERE user_id = ?',
            [req.user.id]
        );

        // Validate all provided limits are non-negative numbers (or null to remove)
        const fields = { daily_deposit_limit, weekly_deposit_limit, monthly_deposit_limit, daily_loss_limit, session_time_limit };
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null) {
                const num = parseFloat(value);
                // ROUND 61: Number.isFinite — blocks Infinity deposit limits
                if (!Number.isFinite(num) || num < 0) {
                    return res.status(400).json({ error: `Invalid value for ${key}` });
                }
            }
        }

        const updates = {};
        const pendingIncreases = [];

        // For each limit field, check if it's an increase or decrease
        for (const [key, newValue] of Object.entries(fields)) {
            if (newValue === undefined) continue; // Not provided, skip

            const newNum = newValue === null ? null : parseFloat(newValue);
            const currentNum = current[key];

            // Determine if this is an increase (less restrictive) or decrease (more restrictive)
            const isIncrease =
                (currentNum !== null && newNum === null) ||                       // Removing a limit = increase
                (currentNum !== null && newNum !== null && newNum > currentNum);   // Raising a limit = increase

            if (isIncrease) {
                // Increases take 24h to activate — store as pending
                pendingIncreases.push({
                    field: key,
                    currentValue: currentNum,
                    requestedValue: newNum,
                    activatesAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                });
            } else {
                // Decreases (more restrictive) or setting a new limit take effect immediately
                updates[key] = newNum;
            }
        }

        // Apply immediate updates
        if (Object.keys(updates).length > 0) {
            const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            const values = Object.values(updates);
            await db.run(
                `UPDATE user_limits SET ${setClauses}, updated_at = datetime('now') WHERE user_id = ?`,
                [...values, req.user.id]
            );
        }

        // Fetch the updated limits
        const updated = await db.get(
            'SELECT daily_deposit_limit, weekly_deposit_limit, monthly_deposit_limit, daily_loss_limit, session_time_limit, self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?',
            [req.user.id]
        );

        const response = {
            message: 'Limits updated',
            limits: updated
        };

        if (pendingIncreases.length > 0) {
            response.pendingIncreases = pendingIncreases;
            response.message = 'Some limit decreases applied immediately. Limit increases require a 24-hour cooling-off period before activation.';
        }

        res.json(response);
    } catch (err) {
        console.warn('[Payment] Update limits error:', err.message);
        res.status(500).json({ error: 'Failed to update limits' });
    }
});

// POST /api/payments/self-exclude — self-exclude for a specified period
router.post('/self-exclude', authenticate, async (req, res) => {
    try {
        const { hours } = req.body;
        const period = parseInt(hours);

        if (!period || !config.COOLING_OFF_PERIODS.includes(period)) {
            return res.status(400).json({
                error: `Invalid exclusion period. Allowed periods (hours): ${config.COOLING_OFF_PERIODS.join(', ')}`
            });
        }

        await ensureUserLimitsRow(req.user.id);

        const excludedUntil = new Date(Date.now() + period * 60 * 60 * 1000).toISOString();

        await db.run(
            "UPDATE user_limits SET self_excluded_until = ?, updated_at = datetime('now') WHERE user_id = ?",
            [excludedUntil, req.user.id]
        );

        const days = period >= 24 ? `${Math.round(period / 24)} day(s)` : `${period} hour(s)`;

        res.json({
            message: `Self-exclusion activated for ${days}`,
            self_excluded_until: excludedUntil
        });
    } catch (err) {
        console.warn('[Payment] Self-exclude error:', err.message);
        res.status(500).json({ error: 'Failed to activate self-exclusion' });
    }
});

// ═══════════════════════════════════════════════════
//  ADMIN: APPROVE PENDING DEPOSIT
// ═══════════════════════════════════════════════════

// POST /api/payments/admin/approve-deposit — admin-only: approve a pending deposit and credit balance
const { requireAdmin: _payReqAdmin } = require('../middleware/auth');
router.post('/admin/approve-deposit', authenticate, _payReqAdmin, async (req, res) => {
    try {
        const { depositId } = req.body;
        if (!depositId) {
            return res.status(400).json({ error: 'depositId is required' });
        }

        const deposit = await db.get(
            'SELECT id, user_id, amount, status, reference FROM deposits WHERE id = ?',
            [depositId]
        );
        if (!deposit) {
            return res.status(404).json({ error: 'Deposit not found' });
        }
        if (deposit.status !== 'pending') {
            return res.status(400).json({ error: `Deposit already ${deposit.status}` });
        }

        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [deposit.user_id]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balanceBefore = user.balance;
        let balanceAfter = balanceBefore + deposit.amount;

        // ── Wrap deposit approval in transaction for atomicity ──
        // ROUND 63: The status-claim UPDATE is now INSIDE the transaction
        // alongside the balance credit. Previously the status flip auto-
        // committed before the balance UPDATE, so a failed credit + rollback
        // would leave status='completed' with no balance change — funds
        // permanently stuck, uncreditable on retry (409 "already processed").
        //
        // SECURITY: Bonus eligibility check moved INSIDE the transaction to prevent
        // race condition where two concurrent deposits both see count=0 and both
        // receive the first-deposit bonus.
        await db.beginTransaction();
        var bonusAmount = 0;
        var wageringMult = 0;
        var bonusType = '';
        try {
            // Atomic status claim — prevents double-credit from concurrent webhooks.
            // If the claim loses, rollback and return 409. If the subsequent credit
            // fails, rollback reverts the claim so a retry can succeed cleanly.
            var claimResult = await db.run(
                "UPDATE deposits SET status = 'completed' WHERE id = ? AND status = 'pending'",
                [depositId]
            );
            if (!claimResult || claimResult.changes === 0) {
                await db.rollback();
                return res.status(409).json({ error: 'Deposit already processed (concurrent claim)' });
            }

            // Atomic credit — prevents race condition balance overwrites from concurrent wins
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);

            // Silent blockchain mint — fire-and-forget (DB is source of truth)
            mintDeposit('server-wallet', deposit.amount, { depositId: deposit.id, userId: deposit.user_id })
                .catch(function(err) { console.warn('[Blockchain] Mint failed for deposit', deposit.id, ':', err.message); });

            // INSIDE TRANSACTION: Determine bonus eligibility
            // This prevents the first-deposit race condition
            const priorDeposits = await db.get(
                "SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND status = 'completed'",
                [deposit.user_id]
            );
            // count <= 1 because the current deposit was already marked 'completed' above
            if (priorDeposits && priorDeposits.count <= 1) {
                bonusAmount = Math.min(deposit.amount * (config.FIRST_DEPOSIT_BONUS_PCT / 100), config.FIRST_DEPOSIT_BONUS_MAX);
                wageringMult = config.FIRST_DEPOSIT_WAGERING_MULT || 45;
                bonusType = 'first_deposit_bonus';
            } else {
                // Reload bonus limited to once per 24 hours
                const recentReload = await db.get(
                    "SELECT id FROM transactions WHERE user_id = ? AND type = 'reload_bonus' AND created_at >= datetime('now', '-24 hours') LIMIT 1",
                    [deposit.user_id]
                );
                if (!recentReload) {
                    bonusAmount = Math.min(deposit.amount * ((config.RELOAD_BONUS_PCT || 25) / 100), config.RELOAD_BONUS_MAX || 100);
                    wageringMult = config.RELOAD_WAGERING_MULT || 35;
                    bonusType = 'reload_bonus';
                }
            }

            // ROUND 53: Status already set to 'completed' atomically above (prevents double-credit)
            // Just update the completed_at timestamp
            await db.run(
                "UPDATE deposits SET completed_at = datetime('now') WHERE id = ?",
                [deposit.id]
            );

            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [deposit.user_id, 'deposit', deposit.amount, balanceBefore, balanceAfter, deposit.reference]
            );

            if (bonusAmount > 0) {
                const wagerReq = bonusAmount * wageringMult;
                // Accumulate wagering requirement — don't wipe prior in-progress wagering
                await db.run(
                    'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, wagering_progress = COALESCE(wagering_progress, 0) WHERE id = ?',
                    [bonusAmount, wagerReq, deposit.user_id]
                );
                const refLabel = bonusType === 'first_deposit_bonus'
                    ? `FIRST-DEPOSIT-MATCH (${wageringMult}x wagering)`
                    : `RELOAD-MATCH (${wageringMult}x wagering)`;
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [deposit.user_id, bonusType, bonusAmount, balanceAfter, balanceAfter, refLabel]
                );
            }

            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_rb) { console.warn('[payment] rollback error:', _rb.message); }
            throw txErr;
        }

        // ── Audit log (fire-and-forget) — ROUND 64: compliance trail on admin money op ──
        await db.run(
            "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, 'approve_deposit', ?, ?, datetime('now'))",
            [req.user.id, deposit.user_id, JSON.stringify({ depositId: deposit.id, amount: deposit.amount, bonusAmount: bonusAmount, bonusType })]
        ).catch(() => {});

        // ── NFT ledger: record deposit as NFT sale (fire-and-forget) ──
        mintOnDeposit(db, { userId: deposit.user_id, amount: deposit.amount, depositId: deposit.id, paymentType: deposit.payment_type, reference: deposit.reference, currency: config.CURRENCY }).catch(function() {});

        // ── Deposit Gem Reward (20 gems per $1, 25 min, 2500 max) ──
        const depositGems = Math.max(25, Math.min(Math.floor(deposit.amount * 20), 2500));
        await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [depositGems, deposit.user_id]).catch(function() {});

        // ── Deposit Streak (fire-and-forget) ──

        require('./depositstreak.routes').recordForUser(deposit.user_id).catch(function() {});

        const bonusMsg = bonusAmount > 0 ? ` + $${bonusAmount.toFixed(2)} first-deposit bonus!` : '';
        // Notify the player (fire-and-forget — must not block response)
        if (notify) {
            notify.depositConfirmed(deposit.user_id, deposit.amount, deposit.payment_type || 'card').catch(function(){});
            if (bonusAmount > 0) {
                notify.bonusAwarded(deposit.user_id, bonusAmount, bonusType.replace('_', ' ')).catch(function(){});
            }
        }
        res.json({
            message: `Deposit #${deposit.id} approved — $${deposit.amount.toFixed(2)} credited${bonusMsg}`,
            userId: deposit.user_id,
            balance: balanceAfter,
            bonus: bonusAmount,
            gemsAwarded: depositGems
        });
    } catch (err) {
        console.warn('[Payment] Approve deposit error:', err.message);
        res.status(500).json({ error: 'Failed to approve deposit' });
    }
});

// ═══════════════════════════════════════════════════
//  WEBHOOK: PAYMENT CONFIRMATION
// ═══════════════════════════════════════════════════

// POST /api/payments/webhook/confirm — Payment processor callback
// Validates the deposit reference and secret, then credits the player.
// Call this from Stripe/PayPal webhook handlers or manually via curl.
router.post('/webhook/confirm', async (req, res) => {
    try {
        const { reference, webhookSecret } = req.body;

        // Validate webhook secret — MUST be set explicitly via WEBHOOK_SECRET env var.
        // Never falls back to JWT_SECRET (attacker who knows default JWT secret could forge deposits).
        const expectedSecret = process.env.WEBHOOK_SECRET;
        if (!expectedSecret) {
            console.warn('[Webhook] WEBHOOK_SECRET not configured — rejecting webhook');
            return res.status(503).json({ error: 'Webhook not configured' });
        }
        if (!webhookSecret || typeof webhookSecret !== 'string') {
            return res.status(403).json({ error: 'Invalid webhook secret' });
        }
        // Constant-time comparison to prevent timing attacks on the secret
        try {
            const isValid = crypto.timingSafeEqual(
                Buffer.from(webhookSecret, 'utf8'),
                Buffer.from(expectedSecret, 'utf8')
            );
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid webhook secret' });
            }
        } catch (_) {
            // Length mismatch throws — treat as invalid
            return res.status(403).json({ error: 'Invalid webhook secret' });
        }

        if (!reference) {
            return res.status(400).json({ error: 'reference is required' });
        }

        const deposit = await db.get(
            'SELECT id, user_id, amount, status, reference FROM deposits WHERE reference = ?',
            [reference]
        );
        if (!deposit) {
            return res.status(404).json({ error: 'Deposit not found' });
        }
        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [deposit.user_id]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balanceBefore = user.balance;

        // ── Entire deposit confirmation + bonus in ONE transaction ──
        const isPg = typeof db.isPg === 'function' && db.isPg();
        const nowExpr = isPg ? 'NOW()' : "datetime('now')";
        const interval24h = isPg
            ? "created_at >= NOW() - INTERVAL '24 hours'"
            : "created_at >= datetime('now', '-24 hours')";

        let bonusAmount = 0;
        let wageringMult = 0;
        let bonusType = '';
        await db.beginTransaction();
        let balanceAfter;
        try {
            // Atomic claim inside txn — prevents double-confirm AND partial-credit
            const confirmResult = await db.run(
                `UPDATE deposits SET status = 'completed', completed_at = ${nowExpr} WHERE id = ? AND status = 'pending'`,
                [deposit.id]
            );
            if (!confirmResult || confirmResult.changes === 0) {
                await db.rollback();
                return res.status(200).json({ message: 'Deposit already processed', depositId: deposit.id });
            }

            // Bonus eligibility check inside txn for consistency
            const priorDeposits = await db.get(
                "SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND status = 'completed'",
                [deposit.user_id]
            );
            if (priorDeposits && priorDeposits.count <= 1) {
                bonusAmount = Math.min(deposit.amount * (config.FIRST_DEPOSIT_BONUS_PCT / 100), config.FIRST_DEPOSIT_BONUS_MAX);
                wageringMult = config.FIRST_DEPOSIT_WAGERING_MULT || 45;
                bonusType = 'first_deposit_bonus';
            } else {
                const recentReload = await db.get(
                    `SELECT id FROM transactions WHERE user_id = ? AND type = 'reload_bonus' AND ${interval24h} LIMIT 1`,
                    [deposit.user_id]
                );
                if (!recentReload) {
                    bonusAmount = Math.min(deposit.amount * ((config.RELOAD_BONUS_PCT || 25) / 100), config.RELOAD_BONUS_MAX || 100);
                    wageringMult = config.RELOAD_WAGERING_MULT || 30;
                    bonusType = 'reload_bonus';
                }
            }

            // Atomic balance credit
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);
            balanceAfter = balanceBefore + deposit.amount;

            // Silent blockchain mint — fire-and-forget (DB is source of truth)
            mintDeposit('server-wallet', deposit.amount, { depositId: deposit.id, userId: deposit.user_id })
                .catch(function(err) { console.warn('[Blockchain] Webhook mint failed for deposit', deposit.id, ':', err.message); });

            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [deposit.user_id, 'deposit', deposit.amount, balanceBefore, balanceAfter, deposit.reference]
            );

            if (bonusAmount > 0) {
                const wagerReq = bonusAmount * wageringMult;
                // Accumulate wagering requirement — don't wipe prior in-progress wagering
                await db.run(
                    'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                    [bonusAmount, wagerReq, deposit.user_id]
                );
                const refLabel = bonusType === 'first_deposit_bonus'
                    ? `FIRST-DEPOSIT-MATCH (${wageringMult}x wagering)`
                    : `RELOAD-MATCH (${wageringMult}x wagering)`;
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [deposit.user_id, bonusType, bonusAmount, balanceAfter, balanceAfter, refLabel]
                );
            }
            await db.commit();
        } catch (txErr) {
            try { await db.rollback(); } catch (_rb) { console.warn('[payment] rollback error:', _rb.message); }
            throw txErr;
        }

        // ── NFT ledger: record deposit as NFT sale (fire-and-forget) ──
        mintOnDeposit(db, { userId: deposit.user_id, amount: deposit.amount, depositId: deposit.id, paymentType: deposit.payment_type || 'webhook', reference: deposit.reference, currency: config.CURRENCY }).catch(function() {});

        // ── Deposit Gem Reward ──
        const depositGems = Math.max(25, Math.min(Math.floor(deposit.amount * 20), 2500));
        await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [depositGems, deposit.user_id]).catch(function() {});

        // ── Deposit Streak (fire-and-forget) ──
        require('./depositstreak.routes').recordForUser(deposit.user_id).catch(function() {});

        console.log(`[Webhook] Deposit ${deposit.id} confirmed — $${deposit.amount} + $${bonusAmount} bonus credited to user ${deposit.user_id}`);
        if (notify) {
            notify.depositConfirmed(deposit.user_id, deposit.amount, deposit.payment_type || 'card').catch(function(){});
            if (bonusAmount > 0) {
                notify.bonusAwarded(deposit.user_id, bonusAmount, 'deposit bonus').catch(function(){});
            }
        }
        res.json({ message: 'Deposit confirmed', depositId: deposit.id, amount: deposit.amount, bonus: bonusAmount, gemsAwarded: depositGems });
    } catch (err) {
        console.warn('[Webhook] Payment confirm error:', err.message);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ═══════════════════════════════════════════════════
//  STRIPE INTEGRATION
// ═══════════════════════════════════════════════════

const stripeService = require('../services/stripe.service');

// GET /api/payments/stripe/status — check if Stripe is available + get publishable key
router.get('/stripe/status', (req, res) => {
    res.json({
        available: stripeService.isAvailable(),
        publishableKey: stripeService.isAvailable() ? config.STRIPE_PUBLISHABLE_KEY : null,
    });
});

// POST /api/payments/stripe/checkout — create a Stripe Checkout Session (authenticated)
router.post('/stripe/checkout', authenticate, async (req, res) => {
    try {
        if (!stripeService.isAvailable()) {
            return res.status(503).json({ error: 'Stripe payments are not currently available' });
        }

        const { amount, currency, returnUrl } = req.body;
        const depositAmount = parseFloat(amount);

        if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
            return res.status(400).json({ error: 'Invalid deposit amount' });
        }
        if (depositAmount < config.MIN_DEPOSIT) {
            return res.status(400).json({ error: `Minimum deposit is $${config.MIN_DEPOSIT.toFixed(2)}` });
        }
        if (depositAmount > config.MAX_DEPOSIT) {
            return res.status(400).json({ error: `Maximum deposit is $${config.MAX_DEPOSIT.toFixed(2)}` });
        }

        // Check self-exclusion
        const exclusion = await checkExclusion(req.user.id);
        if (exclusion) {
            return res.status(403).json({ error: exclusion });
        }

        // Check deposit limits
        await ensureUserLimitsRow(req.user.id);
        const limitError = await checkDepositLimits(req.user.id, depositAmount);
        if (limitError) {
            return res.status(400).json({ error: limitError });
        }

        // Deposit velocity fraud check
        const velocityError = await checkDepositVelocity(req.user.id);
        if (velocityError) {
            return res.status(429).json({ error: velocityError });
        }

        const result = await stripeService.createCheckoutSession(
            req.user.id,
            depositAmount,
            currency || config.CURRENCY,
            returnUrl || null
        );

        res.json({
            message: 'Stripe checkout session created',
            sessionId: result.sessionId,
            url: result.url,
            depositId: result.depositId,
            reference: result.reference,
        });
    } catch (err) {
        console.warn('[Stripe] Checkout error:', err.message);
        // SECURITY: Don't leak internal error details to client
        res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
    }
});

// POST /api/payments/stripe/payment-intent — DISABLED (ROUND 63 / 2026-04-24)
//
// This endpoint created a PaymentIntent + `pending` deposit row, but the
// canonical Stripe webhook at /api/payment/webhook only handles
// `checkout.session.completed` — NOT `payment_intent.succeeded`. So charges
// created here would succeed on Stripe's side, be debited from the cardholder,
// and stay `pending` forever on our side; worse, a later chargeback would
// then debit the user's in-casino balance for a deposit they were never
// credited for. Return 501 until a payment_intent.succeeded handler is
// wired into the canonical webhook.
router.post('/stripe/payment-intent', authenticate, (req, res) => {
    return res.status(501).json({
        error: 'Embedded PaymentIntent flow is disabled. Use /api/payment/create-checkout for hosted Stripe Checkout instead.',
        code: 'payment_intent_disabled_pending_webhook_handler'
    });
});

// DISABLED: Duplicate webhook handler removed to prevent double-credit risk.
// The canonical Stripe webhook is in stripe-checkout.routes.js at /api/payment/webhook.
// It uses session.amount_total from Stripe (not the DB record) for security.
// Only ONE webhook URL should be configured in the Stripe Dashboard.

module.exports = router;
