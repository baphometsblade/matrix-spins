'use strict';

const express = require('express');
const config = require('../config');

const router = express.Router();

/**
 * Public endpoint the frontend uses to decide whether to show the
 * deposit button at all, and to load Stripe.js with the right key.
 * Exposes only non-secret values.
 */
router.get('/', (_req, res) => {
    res.json({
        enabled: !!config.STRIPE_SECRET_KEY,
        publishable_key: config.STRIPE_PUBLISHABLE_KEY || null,
        webhookConfigured: !!config.STRIPE_WEBHOOK_SECRET,
    });
});

const FOUNDER_PASS_PRODUCTS = Object.freeze([
    {
        id: 'supporter_pass',
        name: 'Matrix Spins Supporter Pass',
        amount_cents: 900,
        currency: 'aud',
        badge: 'Supporter',
        description: 'Digital supporter receipt, Founder Wall listing, and launch-progress updates.',
        bullets: [
            'Founder Wall listing',
            'Digital supporter receipt',
            'Launch-progress update email',
        ],
    },
    {
        id: 'founder_pass',
        name: 'Matrix Spins Founder Pass',
        amount_cents: 2900,
        currency: 'aud',
        badge: 'Founder',
        description: 'Everything in Supporter plus early feature voting and MatrixMonster launch shoutout priority.',
        bullets: [
            'Founder Wall listing',
            'Early feature voting',
            'MatrixMonster launch shoutout priority',
        ],
    },
    {
        id: 'sponsor_pass',
        name: 'Matrix Spins Launch Sponsor Pass',
        amount_cents: 9900,
        currency: 'aud',
        badge: 'Launch Sponsor',
        description: 'Premium launch supporter package for brands, creators, and early sponsors.',
        bullets: [
            'Premium Founder Wall placement',
            'Sponsor thank-you placement',
            'Priority product feedback channel',
        ],
    },
]);

const FOUNDER_PRODUCT_BY_ID = new Map(FOUNDER_PASS_PRODUCTS.map(p => [p.id, p]));

function publicProduct(product) {
    return {
        id: product.id,
        name: product.name,
        amount_cents: product.amount_cents,
        amount: product.amount_cents / 100,
        currency: product.currency,
        badge: product.badge,
        description: product.description,
        bullets: product.bullets,
    };
}

function stripeClient() {
    if (!config.STRIPE_SECRET_KEY) return null;
    const Stripe = require('stripe');
    return new Stripe(config.STRIPE_SECRET_KEY);
}

function validEmail(value) {
    if (value == null || value === '') return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
}

/**
 * Public catalog for the no-login revenue page. These products are
 * supporter/access packages only — they deliberately do not credit
 * wagering balance, do not unlock withdrawals, and do not promise prizes.
 */
router.get('/founder-pass/catalog', (_req, res) => {
    res.json({
        enabled: !!config.STRIPE_SECRET_KEY,
        mode: 'supporter_access_only',
        disclaimer: 'Founder Pass purchases are digital supporter/access packages. They do not add gambling balance, create prize entitlement, or enable cash-out.',
        products: FOUNDER_PASS_PRODUCTS.map(publicProduct),
    });
});

/**
 * Public Stripe Checkout for Founder Pass packages.
 *
 * This is intentionally separate from /api/deposit/checkout. It does
 * not require registration, does not mutate balance, and does not share
 * the casino deposit fulfillment path. Stripe remains merchant-of-record
 * for the card checkout and sends its own receipt when enabled.
 */
router.post('/founder-pass/checkout', async (req, res) => {
    const stripe = stripeClient();
    if (!stripe) {
        return res.status(503).json({
            error: 'Payments are not configured on this server. Set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET to enable checkout.',
        });
    }

    const productId = String((req.body && req.body.product_id) || '').trim();
    const product = FOUNDER_PRODUCT_BY_ID.get(productId);
    if (!product) {
        return res.status(400).json({ error: 'Unknown Founder Pass product.' });
    }

    const customerEmail = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!validEmail(customerEmail)) {
        return res.status(400).json({ error: 'Enter a valid email address or leave it blank.' });
    }

    const successUrl = config.PUBLIC_URL + '/founder-pass.html?success=1&session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl = config.PUBLIC_URL + '/founder-pass.html?cancelled=1';
    const metadata = {
        kind: 'founder_pass',
        product_id: product.id,
        product_name: product.name,
        product_badge: product.badge,
        no_balance_credit: 'true',
        no_prize_entitlement: 'true',
    };

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            customer_email: customerEmail || undefined,
            allow_promotion_codes: true,
            billing_address_collection: 'auto',
            client_reference_id: 'founder_pass:' + product.id + ':' + Date.now(),
            metadata,
            payment_intent_data: { metadata },
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: product.currency,
                    unit_amount: product.amount_cents,
                    product_data: {
                        name: product.name,
                        description: product.description + ' No gambling balance, prize entitlement, or cash-out value.',
                        metadata,
                    },
                },
            }],
            success_url: successUrl,
            cancel_url: cancelUrl,
        }, {
            idempotencyKey: 'founder_pass_' + product.id + '_' + Date.now() + '_' + Math.random().toString(16).slice(2),
        });

        res.json({ url: session.url, sessionId: session.id, product: publicProduct(product) });
    } catch (err) {
        console.error('[founder-pass/checkout]', err);
        res.status(500).json({ error: 'Could not start Founder Pass checkout. Please try again.' });
    }
});

module.exports = router;
