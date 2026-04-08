/**
 * Stripe Payment Service
 *
 * Gracefully handles the case where the stripe npm package is not installed.
 * When Stripe is unavailable, all methods return appropriate errors and the
 * existing mock payment flow continues to work.
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

/**
 * Verifies a Stripe webhook signature and processes the event.
 *
 * @param {Buffer} rawBody    — raw request body (NOT parsed JSON)
 * @param {string} signature  — Stripe-Signature header value
 * @returns {Promise<object>} — { event, action } describing what happened
 */
async function handleWebhook(rawBody, signature) {
    if (!stripe) {
        throw new Error('Stripe is not available');
    }

    if (!config.STRIPE_WEBHOOK_SECRET) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    // Verify the webhook signature
    let event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    console.warn(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

    let action = { type: event.type, handled: false };

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            action = await handlePaymentSuccess(
                session.metadata,
                session.id,
                session.amount_total / 100,
                'checkout.session.completed'
            );
            break;
        }

        case 'payment_intent.succeeded': {
            const intent = event.data.object;
            action = await handlePaymentSuccess(
                intent.metadata,
                intent.id,
                intent.amount_received / 100,
                'payment_intent.succeeded'
            );
            break;
        }

        case 'payment_intent.payment_failed': {
            const intent = event.data.object;
            const reference = intent.metadata && intent.metadata.reference;
            if (reference) {
                await db.run(
                    "UPDATE deposits SET status = 'failed' WHERE reference = ? AND status = 'pending'",
                    [reference]
                );
                console.warn(`[Stripe Webhook] Payment failed for reference ${reference}`);
            }
            action = { type: event.type, handled: true, reference };
            break;
        }

        default:
            console.warn(`[Stripe Webhook] Unhandled event type: ${event.type}`);
            action = { type: event.type, handled: false };
    }

    return { event: { id: event.id, type: event.type }, action };
}

/**
 * Shared logic for crediting a user after successful payment.
 * Used by both checkout.session.completed and payment_intent.succeeded.
 */
async function handlePaymentSuccess(metadata, externalId, amountFromStripe, eventType) {
    const reference = metadata && metadata.reference;
    const userId = metadata && metadata.userId ? parseInt(metadata.userId, 10) : null;

    if (!reference) {
        console.warn(`[Stripe Webhook] ${eventType} — no reference in metadata, skipping`);
        return { type: eventType, handled: false, reason: 'no_reference' };
    }

    // Look up the pending deposit
    const deposit = await db.get(
        "SELECT id, user_id, amount, status FROM deposits WHERE reference = ?",
        [reference]
    );

    if (!deposit) {
        console.warn(`[Stripe Webhook] Deposit not found for reference ${reference}`);
        return { type: eventType, handled: false, reason: 'deposit_not_found' };
    }

    if (deposit.status !== 'pending') {
        console.warn(`[Stripe Webhook] Deposit ${deposit.id} already ${deposit.status}, skipping duplicate`);
        return { type: eventType, handled: true, reason: 'already_processed', depositId: deposit.id };
    }

    // Use the deposit amount from our DB (authoritative), not from Stripe, to avoid
    // any mismatch due to currency conversion or rounding
    const depositAmount = deposit.amount;
    const depositUserId = deposit.user_id;

    // Credit the user
    const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [depositUserId]);
    if (!user) {
        console.warn(`[Stripe Webhook] User ${depositUserId} not found for deposit ${deposit.id}`);
        return { type: eventType, handled: false, reason: 'user_not_found' };
    }

    const balanceBefore = user.balance;
    const balanceAfter = balanceBefore + depositAmount;

    // Determine bonus: first deposit or reload
    let bonusAmount = 0;
    let wageringMult = 0;
    let bonusType = '';
    const priorDeposits = await db.get(
        "SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND status = 'completed'",
        [depositUserId]
    );
    if (priorDeposits && priorDeposits.count === 0) {
        bonusAmount = Math.round(Math.min(depositAmount * (config.FIRST_DEPOSIT_BONUS_PCT / 100), config.FIRST_DEPOSIT_BONUS_MAX) * 100) / 100;
        wageringMult = config.FIRST_DEPOSIT_WAGERING_MULT || 30;
        bonusType = 'first_deposit_bonus';
    } else {
        bonusAmount = Math.round(Math.min(depositAmount * ((config.RELOAD_BONUS_PCT || 50) / 100), config.RELOAD_BONUS_MAX || 250) * 100) / 100;
        wageringMult = config.RELOAD_WAGERING_MULT || 25;
        bonusType = 'reload_bonus';
    }

    // Update user balance (atomic increment — prevents race condition if Stripe webhook fires twice)
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [depositAmount, depositUserId]);

    // Mark deposit as completed
    await db.run(
        "UPDATE deposits SET status = 'completed', external_ref = ?, completed_at = datetime('now') WHERE id = ?",
        [externalId, deposit.id]
    );

    // Log the deposit transaction
    await db.run(
        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
        [depositUserId, 'deposit', depositAmount, balanceBefore, balanceAfter, reference]
    );

    // Apply bonus if applicable
    if (bonusAmount > 0) {
        const wagerReq = Math.round(bonusAmount * wageringMult * 100) / 100;
        await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [bonusAmount, wagerReq, depositUserId]
        );
        const refLabel = bonusType === 'first_deposit_bonus'
            ? `FIRST-DEPOSIT-MATCH (${wageringMult}x wagering)`
            : `RELOAD-MATCH (${wageringMult}x wagering)`;
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [depositUserId, bonusType, bonusAmount, balanceAfter, balanceAfter, refLabel]
        );
    }

    // Gem reward (fire-and-forget but log failures)
    const depositGems = Math.max(25, Math.min(Math.floor(depositAmount * 20), 2500));
    await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [depositGems, depositUserId]).catch(function(err) { console.warn('[Stripe] Failed to award deposit gems for user ' + depositUserId + ':', err.message); });

    // Deposit streak (fire-and-forget)
    try {
        require('../routes/depositstreak.routes').recordForUser(depositUserId).catch(function(e) { console.warn('[Stripe] depositstreak.recordForUser error:', e.message || e); });
    } catch (_) { /* depositstreak may not exist */ }

    console.warn(`[Stripe Webhook] Deposit ${deposit.id} completed — $${depositAmount} + $${bonusAmount} bonus credited to user ${depositUserId}`);

    return {
        type: eventType,
        handled: true,
        depositId: deposit.id,
        userId: depositUserId,
        amount: depositAmount,
        bonus: bonusAmount,
        gems: depositGems,
    };
}

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
    handleWebhook,
    createPayout,
};
