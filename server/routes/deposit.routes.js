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
const MAX_DEPOSIT_CENTS = 500000;   // $5000

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
        });

        await db.run('UPDATE deposits SET provider_ref = ? WHERE id = ?', [session.id, depositId]);

        res.json({ url: session.url, sessionId: session.id, depositId });
    } catch (err) {
        console.error('[deposit/checkout]', err);
        res.status(500).json({ error: 'Could not start checkout. Please try again.' });
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
