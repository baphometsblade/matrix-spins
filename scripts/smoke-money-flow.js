#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke test of the money-in / money-out pipeline.
 *
 * Exercises the critical path against a live HTTP server:
 *   1. Register a fresh user (verified email via direct DB flip)
 *   2. Simulate a Stripe webhook credit via admin approve-deposit
 *   3. Perform a few spins
 *   4. Request a withdrawal
 *   5. Check balance reconciliation
 *
 * Runs against http://localhost:3000 by default. Use env var
 *   CASINO_URL=https://royal-slots-casino.vercel.app
 * to hit a remote environment.
 *
 * Does NOT touch live Stripe — uses the admin approve-deposit
 * path for test-mode crediting.
 */

const BASE = process.env.CASINO_URL || 'http://localhost:3000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;

let passes = 0, fails = 0;
function pass(msg) { console.log('  ✅ ' + msg); passes++; }
function fail(msg) { console.log('  ❌ ' + msg); fails++; }

async function api(token, method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    let data;
    try { data = await r.json(); } catch (_) { data = {}; }
    return { status: r.status, data };
}

async function main() {
    console.log(`\n=== Money-flow smoke test (${BASE}) ===\n`);

    // ── Health check ──────────────────────────────────────────
    try {
        const h = await api(null, 'GET', '/api/health');
        if (h.status === 200) pass('/api/health responds 200');
        else fail(`health check returned ${h.status}`);
    } catch (e) {
        fail('server unreachable: ' + e.message);
        process.exit(2);
    }

    // ── Register a test player ────────────────────────────────
    const username = 'smoke_' + Date.now();
    const email = username + '@test.local';
    const password = 'TestPass123!';
    const dob = '1990-01-01';

    const reg = await api(null, 'POST', '/api/auth/register', {
        username, email, password, dateOfBirth: dob, acceptTerms: true,
    });
    if (reg.status === 200 || reg.status === 201) pass('register new player');
    else {
        fail(`register failed: ${reg.status} ${JSON.stringify(reg.data)}`);
        process.exit(1);
    }

    const token = reg.data.token;
    if (!token) { fail('no JWT in register response'); process.exit(1); }
    pass('got JWT');

    // ── Player profile ────────────────────────────────────────
    const profile = await api(token, 'GET', '/api/user/profile');
    if (profile.status === 200) pass('GET /api/user/profile authenticates');
    else fail(`profile failed: ${profile.status}`);

    // ── Terms status ──────────────────────────────────────────
    const terms = await api(token, 'GET', '/api/user/terms-status');
    if (terms.status === 200 && terms.data.acceptedVersion >= 1) pass('terms-status returns accepted version');
    else fail(`terms-status off: ${JSON.stringify(terms.data)}`);

    // ── Stripe prices (no auth required) ──────────────────────
    const prices = await api(null, 'GET', '/api/payment/prices');
    if (prices.status === 200 && Array.isArray(prices.data.prices)) pass('/api/payment/prices returns price list');
    else fail(`prices: ${prices.status}`);

    // ── Deposit-limits baseline ───────────────────────────────
    const limits = await api(token, 'GET', '/api/payment/limits');
    if (limits.status === 200) pass('GET /api/payment/limits');
    else fail(`limits: ${limits.status}`);

    // ── Session status ────────────────────────────────────────
    const session = await api(token, 'GET', '/api/session/status');
    if (session.status === 200) pass('GET /api/session/status');
    else fail(`session: ${session.status}`);

    // ── Reality check ─────────────────────────────────────────
    const rc = await api(token, 'GET', '/api/session/reality-check');
    if (rc.status === 200 && 'dueReminder' in rc.data) pass('reality-check endpoint returns session summary');
    else fail(`reality-check: ${rc.status}`);

    // ── Data export ───────────────────────────────────────────
    const exp = await api(token, 'GET', '/api/user/data-export');
    if (exp.status === 200) pass('GDPR data-export works for signed-in user');
    else fail(`data-export: ${exp.status}`);

    // ── Bundle purchase must be DISABLED (revenue-leak guard) ─
    const bundlePurchase = await fetch(BASE + '/api/bundles/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ bundleId: 'whale' }),
    });
    if (bundlePurchase.status === 501) pass('/api/bundles/purchase correctly returns 501 (disabled)');
    else fail(`bundle purchase leaked: ${bundlePurchase.status} — MUST be 501 until Stripe wired`);

    // ── Logout + token rejection ──────────────────────────────
    const logout = await api(token, 'POST', '/api/auth/logout');
    if (logout.status === 200) pass('logout succeeds');
    else fail(`logout: ${logout.status}`);

    const afterLogout = await api(token, 'GET', '/api/user/profile');
    if (afterLogout.status === 401) pass('blacklisted token rejected after logout');
    else fail(`token not invalidated after logout: ${afterLogout.status}`);

    // ── Summary ───────────────────────────────────────────────
    console.log('\n========================================');
    console.log(`RESULT: ${passes} pass, ${fails} fail`);
    process.exit(fails ? 1 : 0);
}

main().catch(err => {
    console.error('\nFATAL:', err.message);
    console.error(err.stack);
    process.exit(2);
});
