'use strict';

/**
 * Stripe webhook. Verifies the signature, idempotently fulfills
 * checkout.session.completed events: marks the deposit paid, credits
 * the user's balance, and mints the NFT receipt.
 *
 * MUST be mounted with express.raw() so the raw body is available for
 * signature verification (done in server/index.js).
 */

const express = require('express');
const config = require('../config');
const db = require('../database');
const nftService = require('../services/nft.service');

const router = express.Router();

router.post('/', async (req, res) => {
    if (!config.hasStripe) {
        return res.status(503).send('Stripe not configured.');
    }

    const Stripe = require('stripe');
    const stripe = new Stripe(config.STRIPE_SECRET_KEY);
    const signature = req.headers['stripe-signature'];

    let event;
    if (config.hasWebhookSecret) {
        try {
            event = stripe.webhooks.constructEvent(req.body, signature, config.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            console.warn('[stripe-webhook] signature verification failed:', err.message);
            return res.status(400).send('Invalid signature.');
        }
    } else {
        // Without STRIPE_WEBHOOK_SECRET we can't trust the caller. Refuse
        // so this server never fulfills a forged webhook.
        console.warn('[stripe-webhook] refusing to process — STRIPE_WEBHOOK_SECRET is not set.');
        return res.status(503).send('Webhook verification disabled — configure STRIPE_WEBHOOK_SECRET.');
    }

    try {
        if (event.type === 'checkout.session.completed') {
            await handleCheckoutCompleted(event.data.object);
        } else if (event.type === 'checkout.session.async_payment_succeeded') {
            await handleCheckoutCompleted(event.data.object);
        } else if (event.type === 'checkout.session.expired') {
            await markDepositStatus(event.data.object, 'expired');
        } else if (event.type === 'checkout.session.async_payment_failed') {
            await markDepositStatus(event.data.object, 'failed');
        }
        res.json({ received: true });
    } catch (err) {
        console.error('[stripe-webhook] handler error:', err);
        // Stripe retries non-2xx; return 500 so we get another shot.
        res.status(500).send('Handler error.');
    }
});

async function handleCheckoutCompleted(session) {
    const depositId = Number(session.client_reference_id || (session.metadata && session.metadata.deposit_id));
    if (!depositId) {
        console.warn('[stripe-webhook] session without deposit_id', session.id);
        return;
    }
    if (session.payment_status && session.payment_status !== 'paid') {
        console.warn('[stripe-webhook] session not paid yet:', session.id, session.payment_status);
        return;
    }

    const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [depositId]);
    if (!deposit) {
        console.warn('[stripe-webhook] no deposit row for id', depositId);
        return;
    }
    if (deposit.status === 'paid') {
        // Already processed — mint is idempotent but skip the balance update.
        return;
    }

    const isPg = db.kind === 'pg';
    await db.run(
        isPg
            ? `UPDATE deposits SET status = ?, completed_at = NOW() WHERE id = ? AND status <> 'paid'`
            : `UPDATE deposits SET status = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status <> 'paid'`,
        ['paid', depositId]
    );

    // Re-read to ensure we only credit when the UPDATE actually flipped status.
    const post = await db.get('SELECT status FROM deposits WHERE id = ?', [depositId]);
    if (post.status !== 'paid') return;

    await db.run(
        'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
        [Number(deposit.amount_cents), deposit.user_id]
    );

    await nftService.mintFor({
        userId: deposit.user_id,
        depositId: deposit.id,
        amountCents: Number(deposit.amount_cents),
        currency: deposit.currency,
    });

    console.log(`[stripe-webhook] deposit ${depositId} fulfilled for user ${deposit.user_id} (+${deposit.amount_cents} cents)`);
}

async function markDepositStatus(session, status) {
    const depositId = Number(session.client_reference_id || (session.metadata && session.metadata.deposit_id));
    if (!depositId) return;
    await db.run(
        `UPDATE deposits SET status = ? WHERE id = ? AND status = 'pending'`,
        [status, depositId]
    );
}

module.exports = router;
