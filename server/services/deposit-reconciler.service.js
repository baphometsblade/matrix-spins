'use strict';

/**
 * Pending-deposit reconciler.
 *
 * If a Stripe webhook is dropped or delayed, our `deposits` table will
 * have rows stuck in 'pending' even though the customer paid (or
 * abandoned the checkout). Every N minutes this scans for stale
 * pending deposits and asks Stripe directly what happened. The flow
 * uses the same fulfillment service as the webhook — so if a deposit
 * was actually paid, the user's balance is credited, the receipt NFT
 * is minted, and the receipt email is sent, exactly as if the webhook
 * had arrived on time.
 *
 * Wired from server/index.js boot: scheduleReconciler() registers a
 * node-cron job. STRIPE_RECONCILE_DISABLED=1 skips it (useful for tests).
 */

const cron = require('node-cron');
const config = require('../config');
const db = require('../database');
const { fulfillCheckoutSession, markDepositStatusBySession } = require('./deposit-fulfillment.service');

// Only consider deposits at least this old — gives the webhook fair
// time to arrive first under normal latency.
const MIN_AGE_SECONDS = 10 * 60;
// Don't pursue deposits older than this — Stripe Checkout sessions
// expire after 24h anyway, and anything that old will never resolve.
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

async function pendingCandidates(limit = 50) {
    const minAge = MIN_AGE_SECONDS;
    const maxAge = MAX_AGE_SECONDS;
    if (db.kind === 'pg') {
        return db.all(
            `SELECT id, provider_ref, created_at FROM deposits
              WHERE status = 'pending' AND provider = 'stripe' AND provider_ref IS NOT NULL
                AND created_at <= NOW() - (? * INTERVAL '1 second')
                AND created_at >= NOW() - (? * INTERVAL '1 second')
           ORDER BY created_at ASC LIMIT ?`,
            [minAge, maxAge, limit]
        );
    }
    // Use the same strftime format that our inserts use ("YYYY-MM-DDTHH:MM:SS.fffZ")
    // so the lexicographic <= and >= comparisons line up.
    return db.all(
        `SELECT id, provider_ref, created_at FROM deposits
          WHERE status = 'pending' AND provider = 'stripe' AND provider_ref IS NOT NULL
            AND created_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds')
            AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ? || ' seconds')
       ORDER BY created_at ASC LIMIT ?`,
        ['-' + minAge, '-' + maxAge, limit]
    );
}

async function reconcileOne(stripe, row) {
    let session;
    try {
        session = await stripe.checkout.sessions.retrieve(row.provider_ref);
    } catch (err) {
        console.warn('[reconciler] could not fetch session ' + row.provider_ref + ': ' + err.message);
        return { id: row.id, action: 'fetch_failed', error: err.message };
    }
    if (!session) return { id: row.id, action: 'no_session' };

    if (session.status === 'expired') {
        await markDepositStatusBySession(session, 'expired');
        return { id: row.id, action: 'marked_expired' };
    }
    if (session.status === 'complete' && session.payment_status === 'paid') {
        const r = await fulfillCheckoutSession(session);
        return { id: row.id, action: r.alreadyPaid ? 'already_paid' : 'fulfilled' };
    }
    if (session.payment_status === 'unpaid' && session.status === 'open') {
        // Still waiting for the user — leave as pending.
        return { id: row.id, action: 'still_open' };
    }
    return { id: row.id, action: 'noop', stripe_status: session.status, payment_status: session.payment_status };
}

/**
 * One reconciliation pass. Returns the per-deposit summary.
 * Safe to call manually (e.g. from an admin endpoint or a test).
 */
async function reconcileOnce() {
    if (!config.hasStripe) return { skipped: 'no_stripe' };
    const Stripe = require('stripe');
    const stripe = new Stripe(config.STRIPE_SECRET_KEY);
    const startedAt = new Date().toISOString();
    lastTick = { startedAt: startedAt, finishedAt: null, count: 0, summary: null, error: null };
    try {
        const candidates = await pendingCandidates();
        const results = [];
        for (const row of candidates) {
            try {
                results.push(await reconcileOne(stripe, row));
            } catch (err) {
                console.warn('[reconciler] error on deposit ' + row.id + ':', err.message);
                results.push({ id: row.id, action: 'error', error: err.message });
            }
        }
        const summary = results.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {});
        if (results.length) {
            console.log('[reconciler] processed ' + results.length + ' pending deposits: ' + JSON.stringify(summary));
        }
        lastTick = { startedAt: startedAt, finishedAt: new Date().toISOString(), count: results.length, summary: summary, error: null };
        return { count: results.length, results };
    } catch (err) {
        lastTick = { startedAt: startedAt, finishedAt: new Date().toISOString(), count: 0, summary: null, error: err.message };
        throw err;
    }
}

let scheduled = null;
let lastTick = { startedAt: null, finishedAt: null, count: 0, summary: null, error: null };

function getStatus() {
    return {
        scheduled: !!scheduled,
        enabled: process.env.STRIPE_RECONCILE_DISABLED !== '1' && config.hasStripe,
        last_tick: lastTick,
    };
}

function scheduleReconciler() {
    if (process.env.STRIPE_RECONCILE_DISABLED === '1') {
        console.log('[reconciler] disabled via STRIPE_RECONCILE_DISABLED=1');
        return;
    }
    if (!config.hasStripe) {
        console.log('[reconciler] Stripe not configured — reconciler will not run');
        return;
    }
    if (scheduled) return;
    // Every 5 minutes.
    scheduled = cron.schedule('*/5 * * * *', () => {
        reconcileOnce().catch(err => console.warn('[reconciler] tick failed:', err.message));
    });
    console.log('[reconciler] scheduled every 5 minutes');
}

function stopReconciler() {
    if (scheduled) { scheduled.stop(); scheduled = null; }
}

module.exports = { reconcileOnce, scheduleReconciler, stopReconciler, getStatus, MIN_AGE_SECONDS, MAX_AGE_SECONDS };
