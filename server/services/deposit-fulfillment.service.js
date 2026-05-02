'use strict';

/**
 * Deposit fulfillment.
 *
 * Single source of truth for "this checkout session was paid → flip
 * the deposit row to paid, credit balance, mint receipt NFT, send the
 * receipt email." Used by both the Stripe webhook and the reconciler
 * cron, so a dropped webhook is recovered with the same business
 * logic — no divergence.
 *
 * Idempotent: the UPDATE that flips status to 'paid' is conditional
 * (status <> 'paid'); subsequent invocations are no-ops.
 */

const config = require('../config');
const db = require('../database');
const nftService = require('./nft.service');
const mailer = require('./email.service');

async function fulfillCheckoutSession(session) {
    const depositId = Number(session.client_reference_id || (session.metadata && session.metadata.deposit_id));
    if (!depositId) {
        console.warn('[fulfill] session without deposit_id', session.id);
        return { ok: false, reason: 'no_deposit_id' };
    }
    if (session.payment_status && session.payment_status !== 'paid') {
        return { ok: false, reason: 'not_paid', payment_status: session.payment_status };
    }

    const deposit = await db.get('SELECT * FROM deposits WHERE id = ?', [depositId]);
    if (!deposit) {
        console.warn('[fulfill] no deposit row for id', depositId);
        return { ok: false, reason: 'deposit_not_found', deposit_id: depositId };
    }
    if (deposit.status === 'paid') return { ok: true, alreadyPaid: true, deposit_id: depositId };

    // Cross-check the actual paid amount/currency reported by Stripe against
    // the deposit row we created at checkout. If a mismatch sneaks in
    // (discount coupon, partial-pay, currency conversion, tampered metadata)
    // we credit only the lesser of the two values and never trust a row that
    // disagrees with Stripe on the currency. This is the last line of
    // defense against amount-tampering between checkout-create and webhook.
    const stripeAmount = Number(session.amount_total);
    const stripeCurrency = String(session.currency || '').toLowerCase();
    const rowCurrency = String(deposit.currency || '').toLowerCase();
    if (Number.isFinite(stripeAmount) && stripeAmount > 0 && stripeCurrency) {
        if (rowCurrency && stripeCurrency !== rowCurrency) {
            console.warn(
                '[fulfill] currency mismatch — refusing to credit',
                'deposit_id=' + depositId, 'row=' + rowCurrency, 'stripe=' + stripeCurrency
            );
            return { ok: false, reason: 'currency_mismatch', deposit_id: depositId };
        }
        if (stripeAmount !== Number(deposit.amount_cents)) {
            console.warn(
                '[fulfill] amount mismatch — crediting min(row, stripe)',
                'deposit_id=' + depositId, 'row=' + deposit.amount_cents, 'stripe=' + stripeAmount
            );
        }
    }
    const creditAmount = Number.isFinite(stripeAmount) && stripeAmount > 0
        ? Math.min(Number(deposit.amount_cents), stripeAmount)
        : Number(deposit.amount_cents);

    const isPg = db.kind === 'pg';
    const flip = await db.run(
        isPg
            ? `UPDATE deposits SET status = ?, amount_cents = ?, completed_at = NOW(), provider_ref = COALESCE(provider_ref, ?) WHERE id = ? AND status <> 'paid'`
            : `UPDATE deposits SET status = ?, amount_cents = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), provider_ref = COALESCE(provider_ref, ?) WHERE id = ? AND status <> 'paid'`,
        ['paid', creditAmount, session.id, depositId]
    );
    if (!flip || flip.changes === 0) {
        // Another worker already flipped it.
        return { ok: true, alreadyPaid: true, deposit_id: depositId };
    }

    await db.run(
        'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
        [creditAmount, deposit.user_id]
    );

    const receipt = await nftService.mintFor({
        userId: deposit.user_id,
        depositId: deposit.id,
        amountCents: creditAmount,
        currency: deposit.currency,
    });

    try {
        const user = await db.get('SELECT username, email FROM users WHERE id = ?', [deposit.user_id]);
        if (user && user.email) {
            const tier = receipt && receipt.metadata && (receipt.metadata.attributes || []).find(a => a.trait_type === 'Tier');
            await mailer.sendDepositReceipt({
                to: user.email,
                username: user.username,
                amount: creditAmount / 100,
                currency: deposit.currency,
                depositId: deposit.id,
                tier: tier && tier.value,
                tokenId: receipt && receipt.tokenId,
            });
        }
    } catch (err) {
        console.warn('[fulfill] receipt email failed (non-fatal):', err.message);
    }

    console.log(`[fulfill] deposit ${depositId} fulfilled for user ${deposit.user_id} (+${creditAmount} ${deposit.currency})`);
    return { ok: true, alreadyPaid: false, deposit_id: depositId, receipt_token: receipt && receipt.tokenId };
}

async function markDepositStatusBySession(session, status) {
    const depositId = Number(session.client_reference_id || (session.metadata && session.metadata.deposit_id));
    if (!depositId) return { ok: false };
    await db.run(
        `UPDATE deposits SET status = ? WHERE id = ? AND status = 'pending'`,
        [status, depositId]
    );
    return { ok: true, deposit_id: depositId, status };
}

void config;
module.exports = { fulfillCheckoutSession, markDepositStatusBySession };
