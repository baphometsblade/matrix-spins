/**
 * Stripe Payment Service
 *
 * Gracefully handles the case where the stripe npm package is not installed.
 * When Stripe is unavailable, all methods return appropriate errors (503).
 * No mock/simulated payments — real Stripe integration only.
 *
 * Required env vars (set in .env or environment):
 *   STRIPE_SECRET_KEY       — sk_test_... or sk_live_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_...
 *   STRIPE_PUBLISHABLE_KEY  — pk_test_... or pk_live_... (sent to client)
 */

'use strict';

const config = require('../config');
const db = require('../database');

// ─── Stripe SDK (optional dependency) ───────────────────────────────────────

let stripe = null;

try {
    const Stripe = require('stripe');
    if (config.STRIPE_SECRET_KEY) {
        stripe = new Stripe(config.STRIPE_SECRET_KEY, {
            apiVersion: '2024-06-20',
            appInfo: {
                name: 'MatrixSpins Casino',
                version: '1.0.0',
            },
        });
        console.warn('[Stripe] SDK loaded and configured');
    } else {
        console.warn('[Stripe] SDK loaded but STRIPE_SECRET_KEY is not set — Stripe payments disabled');
    }
} catch (err) {
    console.warn('[Stripe] stripe package not installed — Stripe payments disabled. Run `npm install stripe` to enable.');
}

// ─── Availability check ─────────────────────────────────────────────────────

/**
 * Returns true if the Stripe SDK is loaded AND a secret key is configured.
 */
function isAvailable() {
    return stripe !== null;
}

// ─── Checkout Session (Stripe Hosted) ───────────────────────────────────────

/**
 * Creates a Stripe Checkout Session for a deposit.
 *
 * @param {number} userId        — internal user ID
 * @param {number} amount        — deposit amount in major currency units (e.g. 50.00)
 * @param {string} currency      — ISO currency code (default from config)
 * @param {string} returnUrl     — URL to redirect to after payment
 * @returns {Promise<object>}    — { sessionId, url } or throws
 */
async function createCheckoutSession(userId, amount, currency, returnUrl) {
    if (!stripe) {
        throw new Error('Stripe is not available. Install the stripe package and set STRIPE_SECRET_KEY.');
    }

    const amountInCents = Math.round(amount * 100);
    if (amountInCents < 50) {
        throw new Error('Amount must be at least $0.50');
    }

    // Create a pending deposit record so we can match it on webhook callback
    const reference = `DEP-STRIPE-${Date.now()}-${require('crypto').randomBytes(4).toString('hex')}`;

    const depositResult = await db.run(
        'INSERT INTO deposits (user_id, amount, currency, payment_type, status, reference) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, amount, currency || config.CURRENCY, 'stripe', 'pending', reference]
    );
    const depositId = depositResult.lastInsertRowid;

    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: (currency || config.CURRENCY).toLowerCase(),
                    unit_amount: amountInCents,
                    product_data: {
                        name: 'Matrix Spins Deposit',
                        description: `Deposit $${amount.toFixed(2)} to your casino balance`,
                    },
                },
                quantity: 1,
            },
        ],
        metadata: {
            userId: String(userId),
            depositId: String(depositId),
            reference: reference,
        },
        success_url: returnUrl ? `${returnUrl}?deposit=success&ref=${reference}` : undefined,
        cancel_url: returnUrl ? `${returnUrl}?deposit=cancelled&ref=${reference}` : undefined,
    }, {
        // Idempotency: prevents duplicate session creation on network retry.
        // The reference is unique per user-initiated deposit attempt.
        idempotencyKey: reference,
    });

    // Store the Stripe session ID as external_ref on the deposit
    await db.run(
        'UPDATE deposits SET external_ref = ? WHERE id = ?',
        [session.id, depositId]
    );

    console.warn(`[Stripe] Checkout session ${session.id} created for user ${userId}, deposit ${depositId}, $${amount}`);

    return {
        sessionId: session.id,
        url: session.url,
        depositId,
        reference,
    };
}

// ─── Payment Intent (Embedded / Custom UI) ──────────────────────────────────

/**
 * Creates a PaymentIntent for embedded payment forms.
 *
 * @param {number} userId    — internal user ID
 * @param {number} amount    — amount in major currency units
 * @param {string} currency  — ISO currency code
 * @returns {Promise<object>} — { clientSecret, paymentIntentId, depositId, reference }
 */
async function createPaymentIntent(userId, amount, currency) {
    if (!stripe) {
        throw new Error('Stripe is not available. Install the stripe package and set STRIPE_SECRET_KEY.');
    }

    const amountInCents = Math.round(amount * 100);
    if (amountInCents < 50) {
        throw new Error('Amount must be at least $0.50');
    }

    const reference = `DEP-PI-${Date.now()}-${require('crypto').randomBytes(4).toString('hex')}`;

    const depositResult = await db.run(
        'INSERT INTO deposits (user_id, amount, currency, payment_type, status, reference) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, amount, currency || config.CURRENCY, 'stripe', 'pending', reference]
    );
    const depositId = depositResult.lastInsertRowid;

    const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: (currency || config.CURRENCY).toLowerCase(),
        metadata: {
            userId: String(userId),
            depositId: String(depositId),
            reference: reference,
        },
        description: `Matrix Spins deposit — user ${userId}`,
    }, {
        // Idempotency: prevents duplicate charge creation on network retry.
        idempotencyKey: reference,
    });

    await db.run(
        'UPDATE deposits SET external_ref = ? WHERE id = ?',
        [paymentIntent.id, depositId]
    );

    console.warn(`[Stripe] PaymentIntent ${paymentIntent.id} created for user ${userId}, deposit ${depositId}, $${amount}`);

    return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        depositId,
        reference,
    };
}

// ─── Webhook Handler ────────────────────────────────────────────────────────
// NOTE: Stripe webhook processing is NOT done here. The active webhook handler
// lives in server/routes/stripe-checkout.routes.js which is mounted at
// POST /api/payment/webhook and uses the raw-body middleware configured in
// server/index.js. The dead handleWebhook + handlePaymentSuccess helpers that
// previously lived in this file were confusingly never called and had a
// different bonus-calculation path (non-atomic first-deposit check); they
// have been removed to eliminate the risk of someone wiring them in and
// creating a parallel double-credit path.

// ─── Payout (Stripe Connect) ────────────────────────────────────────────────

/**
 * Creates a payout via Stripe Connect (for withdrawals).
 *
 * This requires the user to have a connected Stripe account (destination).
 * For most casinos, withdrawals are handled out-of-band (bank transfer, etc.)
 * so this is provided as an optional integration point.
 *
 * @param {number} userId       — internal user ID
 * @param {number} amount       — payout amount in major currency units
 * @param {string} currency     — ISO currency code
 * @param {string} destination  — Stripe connected account ID (acct_...)
 * @returns {Promise<object>}   — { transferId, reference }
 */
async function createPayout(userId, amount, currency, destination) {
    if (!stripe) {
        throw new Error('Stripe is not available. Install the stripe package and set STRIPE_SECRET_KEY.');
    }

    if (!destination) {
        throw new Error('Stripe connected account destination is required for payouts');
    }

    const amountInCents = Math.round(amount * 100);
    const reference = `PAY-STRIPE-${Date.now()}-${require('crypto').randomBytes(4).toString('hex')}`;

    const transfer = await stripe.transfers.create({
        amount: amountInCents,
        currency: (currency || config.CURRENCY).toLowerCase(),
        destination: destination,
        metadata: {
            userId: String(userId),
            reference: reference,
        },
        description: `Matrix Spins withdrawal — user ${userId}`,
    });

    console.warn(`[Stripe] Payout transfer ${transfer.id} created for user ${userId}, $${amount}`);

    return {
        transferId: transfer.id,
        reference,
    };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    isAvailable,
    createCheckoutSession,
    createPaymentIntent,
    createPayout,
};
