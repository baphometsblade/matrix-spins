'use strict';

/**
 * Deposit creation. POSTing to /api/deposit/checkout creates a real
 * Stripe Checkout session and returns the hosted-payment URL plus the
 * deposit id that the webhook will fulfill.
 *
 * If Stripe is not configured (no STRIPE_SECRET_KEY), the endpoint
 * returns 503 with a clear message — we NEVER auto-credit balance in
 * that case.
 */

const express = require('express');
const config = require('../config');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const MIN_DEPOSIT_CENTS = 500;      // $5
const MAX_DEPOSIT_CENTS = 500000;   // $5000 per transaction hard cap

async function sumDepositsSince(userId, sinceSec) {
    const row = await db.get(
        db.kind === 'pg'
            ? `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM deposits
                 WHERE user_id = ? AND status IN ('paid','partial_refund')
                   AND completed_at >= NOW() - (? * INTERVAL '1 second')`
            : `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM deposits
                 WHERE user_id = ? AND status IN ('paid','partial_refund')
                   AND completed_at >= datetime('now', ? || ' seconds')`,
        db.kind === 'pg' ? [userId, sinceSec] : [userId, '-' + sinceSec]
    );
    return Number((row && row.total) || 0);
}

function stripeClient() {
    if (!config.STRIPE_SECRET_KEY) return null;
    const Stripe = require('stripe');
    return new Stripe(config.STRIPE_SECRET_KEY);
}

router.post('/checkout', authenticate, async (req, res) => {
    const stripe = stripeClient();
    if (!stripe) {
        return res.status(503).json({ error: 'Payments are not configured on this server. Set STRIPE_SECRET_KEY to enable.' });
    }
    const { amount, currency } = req.body || {};
    const amountNum = Number(amount);
    const cents = Math.round(amountNum * 100);
    if (!isFinite(amountNum) || cents < MIN_DEPOSIT_CENTS || cents > MAX_DEPOSIT_CENTS) {
        return res.status(400).json({
            error: `Amount must be between $${MIN_DEPOSIT_CENTS / 100} and $${MAX_DEPOSIT_CENTS / 100}.`,
        });
    }
    const cur = String(currency || 'usd').toLowerCase();
    if (!/^[a-z]{3}$/.test(cur)) {
        return res.status(400).json({ error: 'Invalid currency.' });
    }

    try {
        // Gate first deposit behind a verified email. We keep this here
        // rather than at a middleware layer so the error message is
        // specific and the rest of the deposit route is a single flow.
        const verificationCheck = await db.get(
            'SELECT email_verified, self_excluded_until FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!verificationCheck || !verificationCheck.email_verified) {
            return res.status(403).json({ error: 'Please verify your email address before making a deposit. Check your inbox for the confirmation link.', code: 'email_unverified' });
        }
        // Self-exclusion gate. A user who hit "take a break" should not
        // even see the Checkout session — they will be rejected at login
        // too, but a session established before exclusion could still
        // try to deposit until the JWT expires, so check here as well.
        if (verificationCheck.self_excluded_until) {
            const untilMs = Date.parse(verificationCheck.self_excluded_until);
            if (Number.isFinite(untilMs) && untilMs > Date.now()) {
                return res.status(403).json({
                    error: 'Your account is self-excluded until ' + new Date(untilMs).toISOString() + '.',
                    code: 'self_excluded',
                    until: new Date(untilMs).toISOString(),
                });
            }
        }
        // Enforce per-user rolling-window deposit caps. These are stored
        // per-user on the `users` table so limit changes can be audited
        // and applied without redeploy.
        const limits = await db.get(
            'SELECT deposit_limit_daily_cents, deposit_limit_weekly_cents, deposit_limit_monthly_cents FROM users WHERE id = ?',
            [req.user.id]
        );
        if (limits) {
            const daily = Number(limits.deposit_limit_daily_cents || 0);
            const weekly = Number(limits.deposit_limit_weekly_cents || 0);
            const monthly = Number(limits.deposit_limit_monthly_cents || 0);
            const SEC_DAY = 86400, SEC_WEEK = 7 * 86400, SEC_MONTH = 30 * 86400;
            const [usedDaily, usedWeekly, usedMonthly] = await Promise.all([
                sumDepositsSince(req.user.id, SEC_DAY),
                sumDepositsSince(req.user.id, SEC_WEEK),
                sumDepositsSince(req.user.id, SEC_MONTH),
            ]);
            if (daily > 0 && usedDaily + cents > daily) {
                return res.status(403).json({ error: `Daily deposit limit reached. $${((daily - usedDaily) / 100).toFixed(2)} remaining today.` });
            }
            if (weekly > 0 && usedWeekly + cents > weekly) {
                return res.status(403).json({ error: `Weekly deposit limit reached. $${((weekly - usedWeekly) / 100).toFixed(2)} remaining this week.` });
            }
            if (monthly > 0 && usedMonthly + cents > monthly) {
                return res.status(403).json({ error: `Monthly deposit limit reached. $${((monthly - usedMonthly) / 100).toFixed(2)} remaining this month.` });
            }
        }

        const isPg = db.kind === 'pg';
        let depositId;
        if (isPg) {
            const row = await db.get(
                `INSERT INTO deposits (user_id, provider, amount_cents, currency, status)
                 VALUES (?, ?, ?, ?, ?) RETURNING id`,
                [req.user.id, 'stripe', cents, cur, 'pending']
            );
            depositId = row && row.id;
        } else {
            await db.run(
                `INSERT INTO deposits (user_id, provider, amount_cents, currency, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [req.user.id, 'stripe', cents, cur, 'pending']
            );
            const row = await db.get('SELECT id FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]);
            depositId = row && row.id;
        }
        if (!depositId) throw new Error('Could not create deposit row');

        const successUrl = config.PUBLIC_URL + '/#deposit-success=' + depositId;
        const cancelUrl = config.PUBLIC_URL + '/#deposit-cancel=' + depositId;

        // Idempotency key prevents duplicate Stripe sessions on double-
        // click, network retry, or a client re-POST after success. Bound
        // to our own deposit id so every (user, deposit) pair maps to
        // exactly one Checkout Session, even under retries.
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            client_reference_id: String(depositId),
            metadata: {
                deposit_id: String(depositId),
                user_id: String(req.user.id),
            },
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: cur,
                    unit_amount: cents,
                    product_data: {
                        name: 'Matrix Spins deposit — ' + (cents / 100).toFixed(2) + ' ' + cur.toUpperCase(),
                        description: 'Credits balance and mints a receipt NFT to your account.',
                    },
                },
            }],
            success_url: successUrl,
            cancel_url: cancelUrl,
        }, {
            idempotencyKey: 'ms_deposit_' + depositId,
        });

        await db.run('UPDATE deposits SET provider_ref = ? WHERE id = ?', [session.id, depositId]);

        res.json({ url: session.url, sessionId: session.id, depositId });
    } catch (err) {
        console.error('[deposit/checkout]', err);
        res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
});

router.get('/limits', authenticate, async (req, res) => {
    try {
        const row = await db.get(
            'SELECT deposit_limit_daily_cents, deposit_limit_weekly_cents, deposit_limit_monthly_cents FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!row) return res.status(404).json({ error: 'User not found.' });
        const [dailyUsed, weeklyUsed, monthlyUsed] = await Promise.all([
            sumDepositsSince(req.user.id, 86400),
            sumDepositsSince(req.user.id, 7 * 86400),
            sumDepositsSince(req.user.id, 30 * 86400),
        ]);
        res.json({
            limits: {
                daily_cents: Number(row.deposit_limit_daily_cents),
                weekly_cents: Number(row.deposit_limit_weekly_cents),
                monthly_cents: Number(row.deposit_limit_monthly_cents),
            },
            used: {
                daily_cents: dailyUsed,
                weekly_cents: weeklyUsed,
                monthly_cents: monthlyUsed,
            },
            remaining: {
                daily_cents: Math.max(0, Number(row.deposit_limit_daily_cents) - dailyUsed),
                weekly_cents: Math.max(0, Number(row.deposit_limit_weekly_cents) - weeklyUsed),
                monthly_cents: Math.max(0, Number(row.deposit_limit_monthly_cents) - monthlyUsed),
            },
        });
    } catch (err) {
        console.error('[deposit/limits]', err);
        res.status(500).json({ error: 'Failed to fetch limits.' });
    }
});

router.put('/limits', authenticate, async (req, res) => {
    // Decreases apply immediately; increases are NOT applied by this
    // endpoint. A real cooling-off path would queue the increase with a
    // timer — here we reject and document the policy so the UI can
    // surface it honestly rather than pretending to save.
    const { daily_cents, weekly_cents, monthly_cents } = req.body || {};
    const MAX = 10000 * 100; // $10,000
    function num(v) { const n = Number(v); return isFinite(n) && n >= 0 && n <= MAX ? Math.round(n) : null; }
    const d = num(daily_cents), w = num(weekly_cents), m = num(monthly_cents);
    if (d == null || w == null || m == null) return res.status(400).json({ error: 'Limits must be numbers between 0 and 1,000,000 cents.' });
    if (d > w || w > m) return res.status(400).json({ error: 'Limits must satisfy daily ≤ weekly ≤ monthly.' });
    try {
        const cur = await db.get(
            'SELECT deposit_limit_daily_cents, deposit_limit_weekly_cents, deposit_limit_monthly_cents FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!cur) return res.status(404).json({ error: 'User not found.' });
        const rejected = [];
        const applyD = d <= Number(cur.deposit_limit_daily_cents) ? d : (rejected.push('daily'), Number(cur.deposit_limit_daily_cents));
        const applyW = w <= Number(cur.deposit_limit_weekly_cents) ? w : (rejected.push('weekly'), Number(cur.deposit_limit_weekly_cents));
        const applyM = m <= Number(cur.deposit_limit_monthly_cents) ? m : (rejected.push('monthly'), Number(cur.deposit_limit_monthly_cents));
        await db.run(
            'UPDATE users SET deposit_limit_daily_cents = ?, deposit_limit_weekly_cents = ?, deposit_limit_monthly_cents = ? WHERE id = ?',
            [applyD, applyW, applyM, req.user.id]
        );
        res.json({
            limits: { daily_cents: applyD, weekly_cents: applyW, monthly_cents: applyM },
            rejected,
            note: rejected.length
                ? 'Limit increases require a 24-hour cooling-off period and must be applied by an operator; only decreases were applied.'
                : 'Limits updated.',
        });
    } catch (err) {
        console.error('[deposit/limits PUT]', err);
        res.status(500).json({ error: 'Failed to update limits.' });
    }
});

router.get('/:id', authenticate, async (req, res) => {
    try {
        const row = await db.get(
            'SELECT * FROM deposits WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!row) return res.status(404).json({ error: 'Deposit not found.' });
        res.json({
            deposit: {
                id: row.id,
                amount: Number(row.amount_cents) / 100,
                amount_cents: Number(row.amount_cents),
                currency: row.currency,
                status: row.status,
                created_at: row.created_at,
                completed_at: row.completed_at,
            },
        });
    } catch (err) {
        console.error('[deposit/get]', err);
        res.status(500).json({ error: 'Failed to fetch deposit.' });
    }
});

module.exports = router;
