'use strict';

/**
 * Stripe webhook idempotency (2026-06-27).
 *
 * The checkout.session.completed handler credited balance after two SEPARATE
 * pre-transaction SELECT checks. Two concurrent webhook deliveries (Stripe
 * retries on network latency) could both pass those checks before either
 * committed → DOUBLE-CREDIT. A plain `INSERT ... WHERE NOT EXISTS` is NOT
 * race-safe under READ COMMITTED either.
 *
 * Fix: an atomic claim backed by a PRIMARY KEY on stripe_processed_sessions —
 * exactly one concurrent claim for a given session id can succeed; the second
 * hits the PK and is reported as a duplicate. These tests lock that guarantee.
 */

const { setupTestDb, teardownTestDb } = require('../helpers/test-db');

let db;
let stripe;

beforeAll(async () => {
    await setupTestDb();
    db = require('../../server/database');
    stripe = require('../../server/routes/stripe-checkout.routes');
});

afterAll(async () => { await teardownTestDb(); });

describe('Stripe webhook idempotency claim', () => {
    test('the route exposes the idempotency helpers', () => {
        expect(typeof stripe.ensureStripeIdempotency).toBe('function');
        expect(typeof stripe.claimStripeSession).toBe('function');
    });

    test('a session can be claimed exactly once (duplicate webhook is rejected)', async () => {
        await stripe.ensureStripeIdempotency(db);
        const first = await stripe.claimStripeSession(db, 'cs_test_dup_1', 'evt_a');
        const second = await stripe.claimStripeSession(db, 'cs_test_dup_1', 'evt_b');
        expect(first).toBe(true);   // first delivery credits
        expect(second).toBe(false); // retry is a no-op duplicate
    });

    test('distinct sessions each claim successfully', async () => {
        await stripe.ensureStripeIdempotency(db);
        expect(await stripe.claimStripeSession(db, 'cs_test_unique_a', 'e')).toBe(true);
        expect(await stripe.claimStripeSession(db, 'cs_test_unique_b', 'e')).toBe(true);
    });

    test('the claim row persists the session id (durable across the transaction)', async () => {
        await stripe.ensureStripeIdempotency(db);
        await stripe.claimStripeSession(db, 'cs_test_persist', 'evt_persist');
        const row = await db.get('SELECT session_id, event_id FROM stripe_processed_sessions WHERE session_id = ?', ['cs_test_persist']);
        expect(row).toBeTruthy();
        expect(row.session_id).toBe('cs_test_persist');
    });
});
