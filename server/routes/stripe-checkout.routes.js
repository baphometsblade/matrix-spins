// server/routes/stripe-checkout.routes.js — Real Stripe Checkout Integration
const express = require('express');
const router = express.Router();
const config = require('../config');
const { authenticate } = require('../middleware/auth');

// Deposit price mapping — these are LIVE Stripe Price IDs
const DEPOSIT_PRICES = {
    5:   'price_1TE4GlEs7PHC7HDVUEhFXd1w',
    10:  'price_1TE4GzEs7PHC7HDVA1e8ftkO',
    25:  'price_1TE4H0Es7PHC7HDVwbmnJyEg',
    50:  'price_1TE4H1Es7PHC7HDV9Ei4fdpz',
    100: 'price_1TE4H2Es7PHC7HDVR6YXlofT',
    250: 'price_1TE4H3Es7PHC7HDVHDwmeiB5'
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

        // SECURITY: Check self-exclusion before allowing deposit
        const { getBackend } = require('../database');
        const db = getBackend();
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [playerId]
        );
        if (exclusion) {
            return res.status(403).json({ error: 'Account is self-excluded. Deposits are disabled.' });
        }

        const priceId = DEPOSIT_PRICES[amountNum];

        let lineItems;
        if (priceId) {
            lineItems = [{ price: priceId, quantity: 1 }];
        } else {
            // Custom amount — use price_data
            lineItems = [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Matrix Spins - $' + amountNum.toFixed(2) + ' Deposit',
                        description: 'Add $' + amountNum.toFixed(2) + ' in credits to your Matrix Spins account'
                    },
                    unit_amount: Math.round(amountNum * 100)
                },
                quantity: 1
            }];
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: (process.env.APP_URL || 'https://msaart.online') + '?deposit=success&amount=' + amountNum,
            cancel_url: (process.env.APP_URL || 'https://msaart.online') + '?deposit=cancelled',
            metadata: {
                type: 'casino_deposit',
                amount: amountNum.toString(),
                player_id: String(playerId) // From authenticated session, not request body
            }
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (err) {
        console.error('[Stripe] Checkout error:', err.message);
        res.status(500).json({ error: 'Payment processing error' });
    }
});

// POST /api/payment/webhook — Stripe webhook for completed payments
router.post('/payment/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
        return res.status(503).json({ error: 'Webhooks not configured' });
    }
    const stripe = require('stripe')(config.STRIPE_SECRET_KEY);
    // ROUND 30: Validate signature header presence before calling constructEvent
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        return res.status(400).json({ error: 'Missing signature' });
    }
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('[Stripe] Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
    }

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

            await db.run(
                'INSERT INTO nfts (id, user_id, amount, name, description, metadata, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [nftId, playerId, amount, nftName, '$' + amount + ' Casino Credit NFT', metadata, session.payment_intent || session.id]
            );

            // Credit balance
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, playerId]);

            console.warn('[Stripe+NFT] Minted ' + nftId + ' for player ' + playerId + ': $' + amount);
        } catch (dbErr) {
            console.error('[Stripe] NFT mint/credit error:', dbErr.message);
            // SECURITY: Do NOT blindly retry balance credit — the UPDATE may have succeeded
            // before the NFT INSERT failed, which would double-credit.
            // Instead, check if balance was already credited by looking for the transaction.
            try {
                const { getBackend } = require('../database');
                const db = getBackend();
                const existing = await db.get(
                    "SELECT id FROM nfts WHERE stripe_payment_id = ? LIMIT 1",
                    [session.payment_intent || session.id]
                );
                if (!existing) {
                    // NFT wasn't created, so balance credit likely also failed — safe to retry
                    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, playerId]);
                    console.warn('[Stripe] Fallback direct credit applied for player ' + playerId);
                } else {
                    console.warn('[Stripe] NFT already exists — skipping fallback credit to prevent double-credit');
                }
            } catch (e) { console.error('[Stripe] Fallback credit also failed:', e.message); }
        }
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