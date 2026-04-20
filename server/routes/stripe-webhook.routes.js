'use strict';

/**
 * Stripe webhook. Verifies the signature, deduplicates events by
 * event.id, and idempotently fulfills payment / refund events.
 *
 * MUST be mounted with express.raw() BEFORE express.json() (done in
 * server/index.js) so the raw body is available for signature verify.
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
    if (!config.hasWebhookSecret) {
        console.warn('[stripe-webhook] refusing to process — STRIPE_WEBHOOK_SECRET is not set.');
        return res.status(503).send('Webhook verification disabled — configure STRIPE_WEBHOOK_SECRET.');
    }

    const Stripe = require('stripe');
    const stripe = new Stripe(config.STRIPE_SECRET_KEY);
    const signature = req.headers['stripe-signature'];

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.warn('[stripe-webhook] signature verification failed:', err.message);
        return res.status(400).send('Invalid signature.');
    }

    // Replay protection: refuse to re-process a delivery we've already
    // handled. Stripe retries non-2xx aggressively so duplicates are
    // expected and must not cause double-credit.
    try {
        const prior = await db.get(
            'SELECT id FROM processed_webhook_events WHERE provider = ? AND event_id = ?',
            ['stripe', event.id]
        );
        if (prior) return res.json({ received: true, duplicate: true });
    } catch (err) {
        console.error('[stripe-webhook] dedupe check failed:', err);
        return res.status(500).send('Dedupe check failed.');
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded':
                await handleCheckoutCompleted(event.data.object);
                break;
            case 'checkout.session.expired':
                await markDepositStatus(event.data.object, 'expired');
                break;
            case 'checkout.session.async_payment_failed':
                await markDepositStatus(event.data.object, 'failed');
                break;
            case 'charge.refunded':
                await handleChargeRefunded(event.data.object);
                break;
            case 'charge.dispute.funds_withdrawn':
                await handleDisputeWithdrawn(event.data.object);
                break;
            default:
                // Unhandled event types are still ACKed so Stripe stops retrying.
                break;
        }

        // Record the event id only after the handler succeeds. If a
        // handler throws, the event is not marked processed and Stripe
        // retries — the branch-level idempotency guards in each handler
        // ensure retries are safe.
        await db.run(
            'INSERT INTO processed_webhook_events (provider, event_id, event_type) VALUES (?, ?, ?)',
            ['stripe', event.id, event.type]
        );
        res.json({ received: true });
    } catch (err) {
        console.error('[stripe-webhook] handler error for', event.type, err);
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
    if (deposit.status === 'paid') return; // already credited on a previous delivery

    const isPg = db.kind === 'pg';
    const flip = await db.run(
        isPg
            ? `UPDATE deposits SET status = ?, completed_at = NOW(), provider_ref = COALESCE(provider_ref, ?) WHERE id = ? AND status <> 'paid'`
            : `UPDATE deposits SET status = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), provider_ref = COALESCE(provider_ref, ?) WHERE id = ? AND status <> 'paid'`,
        ['paid', session.id, depositId]
    );
    if (!flip || flip.changes === 0) {
        // Another worker already flipped it — safe to skip.
        return;
    }

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

    console.log(`[stripe-webhook] deposit ${depositId} fulfilled for user ${deposit.user_id} (+${deposit.amount_cents} ${deposit.currency})`);
}

async function markDepositStatus(session, status) {
    const depositId = Number(session.client_reference_id || (session.metadata && session.metadata.deposit_id));
    if (!depositId) return;
    await db.run(
        `UPDATE deposits SET status = ? WHERE id = ? AND status = 'pending'`,
        [status, depositId]
    );
}

async function handleChargeRefunded(charge) {
    const deposit = await findDepositForCharge(charge);
    if (!deposit) {
        console.warn('[stripe-webhook] refund: no matching deposit for charge', charge.id);
        return;
    }

    const refundedCents = Number(charge.amount_refunded || 0);
    if (refundedCents <= 0) return;

    const prior = await db.get(
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE deposit_id = ?',
        [deposit.id]
    );
    const priorTotal = Number((prior && prior.total) || 0);
    const delta = refundedCents - priorTotal;
    if (delta <= 0) return;

    await db.run(
        'INSERT INTO refunds (deposit_id, user_id, amount_cents, provider_ref, reason) VALUES (?, ?, ?, ?, ?)',
        [
            deposit.id, deposit.user_id, delta, charge.id,
            (charge.refunds && charge.refunds.data && charge.refunds.data[0] && charge.refunds.data[0].reason) || null,
        ]
    );

    if (db.kind === 'pg') {
        await db.run('UPDATE users SET balance_cents = GREATEST(0, balance_cents - ?) WHERE id = ?', [delta, deposit.user_id]);
    } else {
        await db.run(
            'UPDATE users SET balance_cents = CASE WHEN balance_cents < ? THEN 0 ELSE balance_cents - ? END WHERE id = ?',
            [delta, delta, deposit.user_id]
        );
    }

    const newStatus = refundedCents >= Number(deposit.amount_cents) ? 'refunded' : 'partial_refund';
    await db.run(`UPDATE deposits SET status = ? WHERE id = ?`, [newStatus, deposit.id]);
    console.log(`[stripe-webhook] refund of ${delta} applied to deposit ${deposit.id} (user ${deposit.user_id})`);
}

async function handleDisputeWithdrawn(dispute) {
    const chargeId = dispute.charge;
    if (!chargeId) return;
    const deposit = await db.get('SELECT * FROM deposits WHERE provider_ref = ?', [chargeId]);
    if (!deposit) {
        console.warn('[stripe-webhook] dispute: no matching deposit for charge', chargeId);
        return;
    }
    const amt = Number(deposit.amount_cents);
    await db.run(
        'UPDATE users SET balance_cents = CASE WHEN balance_cents < ? THEN 0 ELSE balance_cents - ? END WHERE id = ?',
        [amt, amt, deposit.user_id]
    );
    await db.run(`UPDATE deposits SET status = 'disputed' WHERE id = ?`, [deposit.id]);
    console.log(`[stripe-webhook] dispute funds withdrawn for deposit ${deposit.id}`);
}

async function findDepositForCharge(charge) {
    // Primary lookup: charge → payment_intent → checkout.session → deposit_id
    if (charge.payment_intent) {
        try {
            const Stripe = require('stripe');
            const stripe = new Stripe(config.STRIPE_SECRET_KEY);
            const sessions = await stripe.checkout.sessions.list({
                payment_intent: charge.payment_intent,
                limit: 1,
            });
            const session = sessions.data && sessions.data[0];
            if (session) {
                const depId = Number(session.client_reference_id || (session.metadata && session.metadata.deposit_id));
                if (depId) return db.get('SELECT * FROM deposits WHERE id = ?', [depId]);
            }
        } catch (err) {
            console.warn('[stripe-webhook] session lookup failed:', err.message);
        }
    }
    // Fallback: deposit rows store the session.id on provider_ref
    return db.get('SELECT * FROM deposits WHERE provider_ref = ?', [charge.id]);
}

module.exports = router;
