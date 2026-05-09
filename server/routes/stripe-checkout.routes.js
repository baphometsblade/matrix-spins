// server/routes/stripe-checkout.routes.js — Real Stripe Checkout Integration
const express = require('express');
const router = express.Router();
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const depositChecks = require('../services/deposit-checks.service');
const aml = require('../services/aml.service');

// Deposit price mapping — Stripe Price IDs from env only (no hardcoded
// fallbacks because a test-mode price ID would break live-mode checkout with
// "No such price" errors). When an env var is missing for a given preset
// amount we fall through to dynamic price_data construction below.
const DEPOSIT_PRICES = {
    5:   process.env.STRIPE_PRICE_5   || null,
    10:  process.env.STRIPE_PRICE_10  || null,
    25:  process.env.STRIPE_PRICE_25  || null,
    50:  process.env.STRIPE_PRICE_50  || null,
    100: process.env.STRIPE_PRICE_100 || null,
    250: process.env.STRIPE_PRICE_250 || null
};

// Deposit limits
const MIN_DEPOSIT = config.MIN_DEPOSIT || 5;
const MAX_DEPOSIT = config.MAX_DEPOSIT || 10000;

// POST /api/payment/create-checkout — Create a Stripe Checkout session
// SECURITY: Requires authentication — playerId is taken from the verified
// JWT token, NOT from the request body (prevents crediting arbitrary accounts)
router.post('/payment/create-checkout', authenticate, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!config.STRIPE_SECRET_KEY) {
            return res.status(503).json({ error: 'Stripe not configured' });
        }

        // SECURITY: Use authenticated user's ID — never trust client-supplied playerId
        const playerId = req.user.id;
        if (!playerId) {
            return res.status(401).json({ error: 'Authentication required for deposits' });
        }

        const stripe = require('stripe')(config.STRIPE_SECRET_KEY);
        const amountNum = parseFloat(amount);

        // SECURITY: Validate deposit amount range
        if (!Number.isFinite(amountNum) || amountNum < MIN_DEPOSIT || amountNum > MAX_DEPOSIT) {
            return res.status(400).json({
                error: 'Invalid deposit amount. Must be between $' + MIN_DEPOSIT + ' and $' + MAX_DEPOSIT
            });
        }

        // SECURITY: Full responsible-gambling + velocity checks before
        // creating a Stripe session. Mirrors /api/payment/deposit — a user
        // cannot bypass their own deposit limit by using a different route.
        const rgCheck = await depositChecks.runAllChecks(playerId, amountNum);
        if (!rgCheck.allowed) {
            return res.status(403).json({ error: rgCheck.error });
        }

        const priceId = DEPOSIT_PRICES[amountNum];

        let lineItems;
        if (priceId) {
            lineItems = [{ price: priceId, quantity: 1 }];
        } else {
            // Custom amount — use price_data
            lineItems = [{
                price_data: {
                    currency: (config.CURRENCY || 'AUD').toLowerCase(),
                    product_data: {
                        name: 'Matrix Spins - $' + amountNum.toFixed(2) + ' Deposit',
                        description: 'Add $' + amountNum.toFixed(2) + ' in credits to your Matrix Spins account'
                    },
                    unit_amount: Math.round(amountNum * 100)
                },
                quantity: 1
            }];
        }

        // Idempotency key scoped to player + amount + minute-bucket, preventing
        // double-charge if the client retries within a minute of a network blip.
        const minuteBucket = Math.floor(Date.now() / 60000);
        const idempotencyKey = `checkout-${playerId}-${amountNum}-${minuteBucket}`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: (process.env.APP_URL || config.ALLOWED_ORIGIN || 'https://msaart.online') + '/deposit/success.html?amount=' + amountNum,
            cancel_url: (process.env.APP_URL || config.ALLOWED_ORIGIN || 'https://msaart.online') + '?deposit=cancelled',
            metadata: {
                type: 'casino_deposit',
                amount: amountNum.toString(),
                player_id: String(playerId) // From authenticated session, not request body
            }
        }, {
            idempotencyKey: idempotencyKey
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (err) {
        console.error('[Stripe] Checkout error:', err.message);
        res.status(500).json({ error: 'Payment processing error' });
    }
});

// POST /api/payment/webhook — Stripe webhook for completed payments
router.post('/payment/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripeAudit = require('../services/stripe-audit.service');
    if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
        await stripeAudit.logEvent({ eventType: 'unknown', verified: false, errorMessage: 'webhooks not configured' });
        return res.status(503).json({ error: 'Webhooks not configured' });
    }
    const stripe = require('stripe')(config.STRIPE_SECRET_KEY);
    // ROUND 30: Validate signature header presence before calling constructEvent
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        await stripeAudit.logEvent({ eventType: 'unknown', verified: false, errorMessage: 'missing signature' });
        return res.status(400).json({ error: 'Missing signature' });
    }
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('[Stripe] Webhook signature verification failed:', err.message);
        await stripeAudit.logEvent({ eventType: 'unknown', verified: false, errorMessage: 'sig verify: ' + err.message });
        return res.status(400).json({ error: 'Invalid signature' });
    }
    // Successful verification — log a baseline entry. Specific handlers below
    // will append outcome/processed/duplicate to this same event_id.
    await stripeAudit.logEvent({
        eventId: event.id,
        eventType: event.type,
        verified: true,
        processed: false,
        objectId: event.data && event.data.object && event.data.object.id,
        amount: (event.data && event.data.object &&
                 (event.data.object.amount_total || event.data.object.amount || event.data.object.amount_refunded || 0) / 100) || null,
    });

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // SECURITY: Idempotency — Stripe may retry webhooks on network errors.
        // Check BOTH deposits table and NFTs table to prevent double-crediting.
        const { getBackend } = require('../database');
        const idempDb = getBackend();
        const sessionId = session.id;

        // Primary idempotency: check deposits table by stripe session ID
        try {
            const alreadyDeposited = await idempDb.get(
                "SELECT id FROM deposits WHERE external_ref = ? AND status = 'completed' LIMIT 1",
                [sessionId]
            );
            if (alreadyDeposited) {
                console.warn('[Stripe] Duplicate webhook for session ' + sessionId + ' — deposit already completed, skipping');
                return res.json({ received: true, duplicate: true });
            }
        } catch (idempErr) {
            // ROUND 31: Fail CLOSED — was catch(_){} which meant if the idempotency
            // check failed (DB error), the deposit would be double-credited.
            console.error('[Stripe] CRITICAL: Idempotency check failed for session ' + sessionId + ':', idempErr.message);
            return res.status(500).json({ error: 'Deposit processing error. Please contact support.' });
        }

        // Secondary idempotency: check NFTs table by stripe session ID (exact JSON match)
        try {
            const alreadyMinted = await idempDb.get(
                "SELECT id FROM nfts WHERE stripe_payment_id = ? LIMIT 1",
                [session.payment_intent || sessionId]
            );
            if (alreadyMinted) {
                console.warn('[Stripe] Duplicate webhook for session ' + sessionId + ' — NFT already minted, skipping');
                return res.json({ received: true, duplicate: true });
            }
        } catch (_) {
            // nfts table may not exist yet — continue processing
        }

        const playerId = parseInt(session.metadata.player_id, 10);

        // SECURITY: Validate playerId is a positive integer (prevents injection)
        if (!Number.isInteger(playerId) || playerId <= 0) {
            console.error('[Stripe] Invalid player_id in webhook metadata:', session.metadata.player_id);
            return res.status(400).json({ error: 'Invalid player_id' });
        }

        // SECURITY: Use the actual amount charged by Stripe, NOT the metadata amount.
        // Metadata is set by the client at checkout creation time — if there were a bug
        // or exploit, metadata could claim a different amount than what was charged.
        // session.amount_total is in cents, set by Stripe from the actual payment.
        const stripeAmountCents = session.amount_total;

        // CRITICAL: Never fall back to metadata amount — if Stripe doesn't report
        // the real charge amount, reject the webhook rather than trusting client data.
        if (!stripeAmountCents || stripeAmountCents <= 0) {
            console.error('[Stripe] Missing or invalid amount_total in webhook — rejecting to prevent amount inflation exploit. Session:', sessionId);
            return res.status(400).json({ error: 'Missing verified payment amount' });
        }
        const amount = Math.round(stripeAmountCents) / 100;

        // Sanity check: amount must be positive and within deposit limits
        if (!Number.isFinite(amount) || amount <= 0 || amount > (config.MAX_DEPOSIT || 10000)) {
            console.error('[Stripe] Invalid deposit amount in webhook:', amount);
            return res.status(400).json({ error: 'Invalid amount' });
        }

        console.warn('[Stripe] Deposit completed: $' + amount + ' for player ' + playerId + ' (verified from Stripe amount_total)');

        // Mint NFT and credit balance via NFT deposit system
        try {
            const { ensureNFTTables } = require('./nft-deposit.routes');
            const { getBackend } = require('../database');
            const crypto = require('crypto');
            const db = getBackend();
            await ensureNFTTables();

            // SECURITY: Verify the user actually exists before crediting
            const userCheck = await db.get('SELECT id FROM users WHERE id = ?', [playerId]);
            if (!userCheck) {
                console.error('[Stripe] Player not found for webhook credit:', playerId);
                return res.status(400).json({ error: 'User not found' });
            }

            const nftId = 'NFT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            const nftName = amount >= 250 ? 'Diamond Casino Token' : amount >= 100 ? 'Gold Casino Token' : amount >= 50 ? 'Silver Casino Token' : 'Casino Token';
            const metadata = JSON.stringify({
                type: 'casino_credit', denomination: amount, mintedBy: 'matrix-spins',
                chain: 'internal', stripeSessionId: session.id, stripePaymentIntent: session.payment_intent
            });

            // Transaction: NFT record + balance credit must both succeed or both fail.
            // Without this, a crash between INSERT and UPDATE would leave the player
            // charged but uncredited, with the idempotency check blocking retries.
            await db.beginTransaction();
            try {
                await db.run(
                    'INSERT INTO nfts (id, user_id, amount, name, description, metadata, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [nftId, playerId, amount, nftName, '$' + amount + ' Casino Credit NFT', metadata, session.payment_intent || session.id]
                );
                await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, playerId]);

                // Record in deposits table — required for wagering/withdrawal checks downstream
                await db.run(
                    `INSERT INTO deposits (user_id, amount, currency, payment_type, status, external_ref, created_at)
                     VALUES (?, ?, ?, 'stripe_checkout', 'completed', ?, CURRENT_TIMESTAMP)`,
                    [playerId, amount, (config.CURRENCY || 'AUD'), session.id]
                );

                // Compute deposit bonus from config.
                //
                // ROUND 64: first-deposit detection is now an atomic INSERT ...
                // WHERE NOT EXISTS against the transactions log (keyed on
                // type='first_deposit_bonus'). Under concurrent webhook sessions,
                // both SELECTs previously returned COUNT=0 (before either COMMITted)
                // and both applied the first-deposit bonus — FIRST_DEPOSIT_BONUS_MAX × 2.
                // Now only the first INSERT succeeds; the second becomes a no-op
                // and the handler falls through to the reload-bonus path.
                var isFirstDeposit = false;
                var firstDepositClaim = await db.run(
                    `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference)
                     SELECT ?, 'first_deposit_bonus', 0, 0, 0, 'FIRST-DEPOSIT-CLAIM'
                     WHERE NOT EXISTS (
                         SELECT 1 FROM transactions WHERE user_id = ? AND type = 'first_deposit_bonus'
                     )`,
                    [playerId, playerId]
                );
                if (firstDepositClaim && firstDepositClaim.changes > 0) {
                    isFirstDeposit = true;
                }

                var bonusPct = isFirstDeposit
                    ? (config.FIRST_DEPOSIT_BONUS_PCT || 100)
                    : (config.RELOAD_BONUS_PCT || 50);
                var bonusMax = isFirstDeposit
                    ? (config.FIRST_DEPOSIT_BONUS_MAX || 500)
                    : (config.RELOAD_BONUS_MAX || 250);
                var wageringMult = isFirstDeposit
                    ? (config.FIRST_DEPOSIT_WAGERING_MULT || 45)
                    : (config.RELOAD_WAGERING_MULT || 30);
                var depositBonus = Math.round(Math.min(amount * (bonusPct / 100), bonusMax) * 100) / 100;
                if (depositBonus > 0) {
                    await db.run(
                        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                        [depositBonus, Math.round(depositBonus * wageringMult * 100) / 100, playerId]
                    );
                    var bonusType = isFirstDeposit ? 'first_deposit_bonus' : 'reload_bonus';
                    var refLabel = (isFirstDeposit ? 'FIRST-DEPOSIT' : 'RELOAD') + '-MATCH (' + wageringMult + 'x wagering)';
                    if (isFirstDeposit) {
                        // Update the already-inserted claim row with the real amount + reference
                        await db.run(
                            'UPDATE transactions SET amount = ?, reference = ? WHERE user_id = ? AND type = ? AND reference = ?',
                            [depositBonus, refLabel, playerId, 'first_deposit_bonus', 'FIRST-DEPOSIT-CLAIM']
                        );
                    } else {
                        await db.run(
                            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                            [playerId, bonusType, depositBonus, 0, 0, refLabel]
                        );
                    }
                    console.warn('[Stripe] ' + bonusType + ' credited: $' + depositBonus + ' (' + wageringMult + 'x wagering) for player ' + playerId);
                } else if (isFirstDeposit) {
                    // No bonus payable but we inserted a claim row — clean it up so
                    // reload bonus still works on future deposits.
                    await db.run(
                        "DELETE FROM transactions WHERE user_id = ? AND type = 'first_deposit_bonus' AND reference = 'FIRST-DEPOSIT-CLAIM'",
                        [playerId]
                    );
                }

                await db.commit();
            } catch (txErr) {
                try { await db.rollback(); } catch (_) {}
                throw txErr;
            }

            console.warn('[Stripe+NFT] Minted ' + nftId + ' for player ' + playerId + ': $' + amount);

            // AML analysis (fire-and-forget — never blocks deposit credit)
            aml.analyseDeposit(playerId, amount, session.id).catch(function(e) {
                console.warn('[AML] analyseDeposit error:', e.message);
            });

            // Deposit confirmation email (fire-and-forget)
            try {
                const userRow = await db.get('SELECT username, email, balance FROM users WHERE id = ?', [playerId]);
                if (userRow && userRow.email) {
                    const emailService = require('../services/email.service');
                    emailService.sendDepositConfirmation(userRow.email, playerId, {
                        username: userRow.username,
                        amount: amount,
                        currency: config.CURRENCY || 'AUD',
                        reference: session.id,
                        paymentType: 'Card (Stripe)',
                        balance: Number(userRow.balance) || 0,
                        bonusAwarded: typeof depositBonus === 'number' && depositBonus > 0 ? depositBonus : null,
                    }).catch(e => console.warn('[Stripe] deposit email failed:', e.message));
                }
            } catch (e) { /* non-fatal */ }
        } catch (dbErr) {
            console.error('[Stripe] NFT mint/credit error:', dbErr.message);
            // CRITICAL: Must return 5xx so Stripe retries. If we return 2xx here,
            // Stripe marks the webhook as delivered and NEVER retries, leaving the
            // user charged with no credit. Transaction was rolled back above, so
            // a retried webhook will process cleanly.
            return res.status(500).json({ error: 'Internal processing error — Stripe will retry.' });
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CHARGEBACK / DISPUTE — freeze account, flag operator, log ledger
    // ═══════════════════════════════════════════════════════════════════
    // A chargeback is the single biggest fraud vector. When a user disputes
    // their card charge through the issuing bank:
    //   - Stripe sends charge.dispute.created (we lose the funds + may lose more)
    //   - We MUST ban the account immediately so they cannot keep withdrawing
    //   - We claw back the chargeback amount from their current balance
    //     (clamped ≥ 0 — if they already withdrew, that's the cost of doing
    //     business; we can't go negative without violating the atomic balance
    //     invariant and breaking play for other operations).
    //   - We mark the deposit as disputed so admins know which funds are at risk.
    if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.funds_withdrawn') {
        try {
            const dispute = event.data.object;
            const chargeId = dispute.charge;
            const paymentIntent = dispute.payment_intent;
            const disputeAmount = Math.round((dispute.amount || 0)) / 100;
            const { getBackend } = require('../database');
            const db = getBackend();

            // Find the deposit by payment_intent or charge id (both end up in external_ref)
            const deposit = await db.get(
                'SELECT id, user_id, amount, status FROM deposits WHERE external_ref = ? OR external_ref = ? LIMIT 1',
                [paymentIntent || '', chargeId || '']
            );

            if (!deposit) {
                console.error('[Stripe Dispute] No deposit matched for dispute ' + dispute.id +
                    ' (charge=' + chargeId + ', pi=' + paymentIntent + ') — manual investigation required');
                return res.json({ received: true, matched: false });
            }

            console.error('[Stripe Dispute] Chargeback filed: dispute=' + dispute.id +
                ' user=' + deposit.user_id + ' amount=$' + disputeAmount +
                ' reason=' + (dispute.reason || 'unknown'));

            // Atomic claw-back + freeze + idempotency claim in a single transaction.
            //
            // ROUND 63: Previously the idempotency check (SELECT from transactions
            // by DISPUTE-<id> reference) ran OUTSIDE the transaction. Under
            // concurrent dispute.created + dispute.funds_withdrawn webhooks (or
            // Stripe retries), both requests' SELECTs would return no match
            // before either one COMMITted, and both would proceed to claw back
            // balance — double-debit. Now the idempotency is the atomic claim:
            // a conditional INSERT that succeeds exactly once per dispute id.
            await db.beginTransaction();
            try {
                // Guarded INSERT into transactions — serves as the atomic idempotency
                // key. If a row with reference=DISPUTE-<id> already exists (from a
                // previous webhook event for the same dispute) this becomes a no-op
                // (changes = 0) and we bail out without clawing back again.
                const refKey = 'DISPUTE-' + dispute.id;
                const idempotencyClaim = await db.run(
                    `INSERT INTO transactions (user_id, type, amount, reference)
                     SELECT ?, 'chargeback', ?, ?
                     WHERE NOT EXISTS (
                         SELECT 1 FROM transactions
                          WHERE user_id = ? AND type = 'chargeback'
                            AND reference LIKE ?
                     )`,
                    [
                        deposit.user_id,
                        -disputeAmount,
                        refKey + ':' + (dispute.reason || 'unknown'),
                        deposit.user_id,
                        refKey + '%',
                    ]
                );
                if (!idempotencyClaim || idempotencyClaim.changes === 0) {
                    await db.rollback();
                    console.warn('[Stripe Dispute] Dispute ' + dispute.id + ' already processed — skipping duplicate claw-back');
                    return res.json({ received: true, duplicate: true });
                }

                // 1. Mark deposit as disputed — only the first webhook transitions the row
                await db.run(
                    "UPDATE deposits SET status = 'disputed' WHERE id = ? AND status IN ('completed', 'pending')",
                    [deposit.id]
                );

                // 2. Claw back — deduct disputed amount from balance, clamped at 0.
                // Uses CASE so a user with insufficient balance goes to 0 rather than
                // negative. Lost-withdrawn funds are tracked via the transaction log below.
                await db.run(
                    `UPDATE users SET balance = CASE
                        WHEN balance - ? < 0 THEN 0
                        ELSE balance - ? END
                     WHERE id = ?`,
                    [disputeAmount, disputeAmount, deposit.user_id]
                );

                // 3. Freeze the account. Admin can review & unban if the dispute is
                // resolved in the operator's favour.
                await db.run(
                    "UPDATE users SET is_banned = 1, banned_at = CURRENT_TIMESTAMP, banned_reason = ? WHERE id = ?",
                    ['chargeback_dispute:' + dispute.id + ' (' + (dispute.reason || 'unspecified') + ')', deposit.user_id]
                );

                await db.commit();
                console.warn('[Stripe Dispute] User ' + deposit.user_id + ' banned, $' + disputeAmount + ' clawed back, deposit ' + deposit.id + ' marked disputed');
            } catch (txErr) {
                try { await db.rollback(); } catch (_) {}
                throw txErr;
            }

            return res.json({ received: true, disputed: true, userId: deposit.user_id });
        } catch (err) {
            console.error('[Stripe Dispute] Handler error:', err.message);
            // Return 500 so Stripe retries — better to process twice (idempotent)
            // than miss a chargeback entirely.
            return res.status(500).json({ error: 'Dispute processing error' });
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  REFUND — admin-initiated or Stripe-automatic refund
    // ═══════════════════════════════════════════════════════════════════
    if (event.type === 'charge.refunded') {
        try {
            const charge = event.data.object;
            const paymentIntent = charge.payment_intent;
            const amountRefunded = Math.round((charge.amount_refunded || 0)) / 100;
            const { getBackend } = require('../database');
            const db = getBackend();

            const deposit = await db.get(
                'SELECT id, user_id, amount, status FROM deposits WHERE external_ref = ? OR external_ref = ? LIMIT 1',
                [paymentIntent || '', charge.id || '']
            );
            if (!deposit) {
                console.warn('[Stripe Refund] No deposit matched for charge ' + charge.id);
                return res.json({ received: true, matched: false });
            }

            // Atomic refund with idempotency claim INSIDE the transaction.
            // ROUND 63: the previous idempotency SELECT ran outside the
            // transaction, so two concurrent refund webhooks could both
            // pass the check and both debit balance. Now the transaction-
            // log INSERT IS the claim — a duplicate yields 0 rows.
            await db.beginTransaction();
            try {
                const refKey = 'REFUND:' + charge.id;
                const idempotencyClaim = await db.run(
                    `INSERT INTO transactions (user_id, type, amount, reference)
                     SELECT ?, 'refund', ?, ?
                     WHERE NOT EXISTS (
                         SELECT 1 FROM transactions
                          WHERE user_id = ? AND type = 'refund' AND reference = ?
                     )`,
                    [deposit.user_id, -amountRefunded, refKey, deposit.user_id, refKey]
                );
                if (!idempotencyClaim || idempotencyClaim.changes === 0) {
                    await db.rollback();
                    console.warn('[Stripe Refund] Duplicate refund webhook for charge ' + charge.id + ' — skipping');
                    return res.json({ received: true, duplicate: true });
                }

                await db.run(
                    "UPDATE deposits SET status = 'refunded' WHERE id = ? AND status IN ('completed', 'pending')",
                    [deposit.id]
                );
                await db.run(
                    'UPDATE users SET balance = CASE WHEN balance - ? < 0 THEN 0 ELSE balance - ? END WHERE id = ?',
                    [amountRefunded, amountRefunded, deposit.user_id]
                );
                await db.commit();
                console.warn('[Stripe Refund] $' + amountRefunded + ' refunded to user ' + deposit.user_id + ' (deposit ' + deposit.id + ')');
            } catch (txErr) {
                try { await db.rollback(); } catch (_) {}
                throw txErr;
            }
            return res.json({ received: true, refunded: true });
        } catch (err) {
            console.error('[Stripe Refund] Handler error:', err.message);
            return res.status(500).json({ error: 'Refund processing error' });
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PAYMENT FAILED — mark any pending deposit as failed
    // ═══════════════════════════════════════════════════════════════════
    if (event.type === 'payment_intent.payment_failed') {
        try {
            const intent = event.data.object;
            const { getBackend } = require('../database');
            const db = getBackend();
            await db.run(
                "UPDATE deposits SET status = 'failed' WHERE external_ref = ? AND status = 'pending'",
                [intent.id]
            );
            console.warn('[Stripe] Payment failed for intent ' + intent.id + ' — deposit marked failed');
        } catch (err) {
            console.warn('[Stripe] Failed-payment handler error:', err.message);
        }
        return res.json({ received: true, failed: true });
    }

    res.json({ received: true });
});

// GET /api/payment/prices — Return available deposit tiers
router.get('/payment/prices', (req, res) => {
    res.json({
        prices: [
            { amount: 5, bonus: 0, label: '$5' },
            { amount: 10, bonus: 0, label: '$10' },
            { amount: 25, bonus: 5, label: '$25 + $5 bonus' },
            { amount: 50, bonus: 15, label: '$50 + $15 bonus' },
            { amount: 100, bonus: 40, label: '$100 + $40 bonus' },
            { amount: 250, bonus: 125, label: '$250 + $125 bonus' }
        ],
        publishableKey: config.STRIPE_PUBLISHABLE_KEY || null
    });
});

module.exports = router;