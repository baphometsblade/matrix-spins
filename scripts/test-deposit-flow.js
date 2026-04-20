#!/usr/bin/env node
'use strict';

/**
 * End-to-end deposit flow test — drives a real Express server through
 * the full register → checkout-intent → webhook → balance+NFT path.
 *
 * The Stripe SDK is NOT called for external charges; we generate a
 * signed webhook payload ourselves and exercise the handler the same
 * way Stripe would. This proves signature verification, replay
 * protection, balance credit, and mint-service call all work end to end.
 *
 *   node scripts/test-deposit-flow.js
 */

const crypto = require('crypto');
const assert = require('assert');
const fs = require('fs');

const STRIPE_WEBHOOK_SECRET = 'whsec_test_' + crypto.randomBytes(12).toString('hex');
process.env.STRIPE_SECRET_KEY = 'sk_test_' + crypto.randomBytes(16).toString('hex');
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
process.env.JWT_SECRET = 'test-jwt-secret-' + crypto.randomBytes(8).toString('hex');
process.env.NFT_SIGNING_SECRET = 'test-nft-' + crypto.randomBytes(8).toString('hex');
process.env.NODE_ENV = 'development';
process.env.SQLITE_FILE = './server/test-data.sqlite';
process.env.PORT = '3199';
process.env.ADMIN_USERNAME = 'admin_test';
process.env.ADMIN_PASSWORD = 'AdminTest!2026';
process.env.SMTP_CAPTURE = '1';
process.env.PUBLIC_URL = 'http://localhost:3199';

try { fs.unlinkSync(process.env.SQLITE_FILE); } catch (err) { /* first run */ }

const app = require('../server/index');
const db = require('../server/database');

function signPayload(payload, secret) {
    const ts = Math.floor(Date.now() / 1000);
    const signed = ts + '.' + payload;
    const v1 = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    return 't=' + ts + ',v1=' + v1;
}

async function http(method, path, { token, body, csrf, rawBody } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const init = { method, headers };
    if (rawBody != null) {
        init.body = rawBody;
        init.headers = Object.assign({}, headers, body && body.headers || {});
    } else if (body) {
        init.body = JSON.stringify(body);
    }
    const res = await fetch('http://localhost:3199' + path, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { /* non-json */ }
    return { status: res.status, body: json, raw: text };
}

async function main() {
    await db.initDatabase();
    await require('../server/services/admin.service').bootstrap();
    await new Promise((resolve) => {
        const srv = app.listen(Number(process.env.PORT), resolve);
        main.server = srv;
    });

    console.log('[test] server up on :' + process.env.PORT);

    // 0) Public stripe config
    const stripeCfg = await http('GET', '/api/stripe/config');
    assert.strictEqual(stripeCfg.status, 200);
    assert.strictEqual(stripeCfg.body.enabled, true);
    assert.strictEqual(stripeCfg.body.webhookConfigured, true);
    console.log('[test] stripe config endpoint reports configured');

    // 1) CSRF token (anon)
    const csrfRes = await http('GET', '/api/csrf-token');
    assert.strictEqual(csrfRes.status, 200);
    assert.ok(csrfRes.body.csrfToken, 'missing csrf token');
    const csrf = csrfRes.body.csrfToken;

    // 2) Register
    const reg = await http('POST', '/api/auth/register', {
        csrf,
        body: {
            username: 'tester_' + Date.now(),
            email: 'tester_' + Date.now() + '@example.com',
            password: 'Str0ngP@ss!!',
            date_of_birth: '1990-01-01',
        },
    });
    assert.strictEqual(reg.status, 201, 'register failed: ' + reg.raw);
    const token = reg.body.token;
    const userId = reg.body.user.id;
    console.log('[test] registered user id=' + userId);

    // 3) Create checkout (we have a fake STRIPE_SECRET_KEY so the
    //    Stripe SDK will actually try to call Stripe; capture the
    //    deposit row directly from the DB instead.)
    const authedCsrfRes = await http('GET', '/api/csrf-token', { token });
    const authedCsrf = authedCsrfRes.body.csrfToken;
    // Insert a deposit row manually to simulate what /checkout would create;
    // we're testing the webhook path, not the external Stripe call.
    await db.run(
        `INSERT INTO deposits (user_id, provider, provider_ref, amount_cents, currency, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, 'stripe', 'cs_test_' + Date.now(), 2500, 'usd', 'pending']
    );
    const depositRow = await db.get('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    const depositId = depositRow.id;
    console.log('[test] pending deposit id=' + depositId);

    // 4) Build a signed webhook payload for checkout.session.completed
    const eventId = 'evt_test_' + crypto.randomBytes(6).toString('hex');
    const event = {
        id: eventId,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: depositRow.provider_ref,
                client_reference_id: String(depositId),
                payment_status: 'paid',
                metadata: { deposit_id: String(depositId), user_id: String(userId) },
            },
        },
        created: Math.floor(Date.now() / 1000),
    };
    const payload = JSON.stringify(event);
    const sig = signPayload(payload, STRIPE_WEBHOOK_SECRET);

    const hookRes = await fetch('http://localhost:3199/api/payment/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig },
        body: payload,
    });
    const hookBody = await hookRes.json();
    assert.strictEqual(hookRes.status, 200, 'webhook failed: ' + JSON.stringify(hookBody));
    assert.strictEqual(hookBody.received, true);
    console.log('[test] webhook accepted');

    // 5) Verify balance credited
    const meRes = await http('GET', '/api/user/me', { token });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.user.balance_cents, 2500, 'balance not credited: ' + JSON.stringify(meRes.body.user));
    console.log('[test] balance credited: $' + meRes.body.user.balance);

    // 6) Verify NFT receipt was minted
    const nftsRes = await http('GET', '/api/nfts', { token });
    assert.strictEqual(nftsRes.status, 200);
    assert.strictEqual(nftsRes.body.nfts.length, 1, 'NFT not minted: ' + JSON.stringify(nftsRes.body));
    const nft = nftsRes.body.nfts[0];
    assert.ok(/^msr_/.test(nft.tokenId), 'unexpected token id: ' + nft.tokenId);
    assert.strictEqual(nft.metadata.user_id, String(userId));
    const tier = (nft.metadata.attributes || []).find(a => a.trait_type === 'Tier');
    console.log('[test] NFT minted: ' + nft.tokenId + ' (' + (tier && tier.value) + ')');

    // 7) Replay protection — re-send the same event and confirm it's marked duplicate
    const replay = await fetch('http://localhost:3199/api/payment/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signPayload(payload, STRIPE_WEBHOOK_SECRET) },
        body: payload,
    });
    const replayBody = await replay.json();
    assert.strictEqual(replay.status, 200);
    assert.strictEqual(replayBody.duplicate, true, 'replay not blocked');
    const meAfterReplay = await http('GET', '/api/user/me', { token });
    assert.strictEqual(meAfterReplay.body.user.balance_cents, 2500, 'replay double-credited!');
    console.log('[test] replay protection works');

    // 8) Invalid signature rejected
    const bad = await fetch('http://localhost:3199/api/payment/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=0,v1=deadbeef' },
        body: payload,
    });
    assert.strictEqual(bad.status, 400, 'bad signature not rejected');
    console.log('[test] invalid signature rejected');

    // 9) Refund — decrements balance, marks deposit refunded, leaves NFT
    const refundEvent = {
        id: 'evt_refund_' + crypto.randomBytes(6).toString('hex'),
        object: 'event',
        type: 'charge.refunded',
        data: {
            object: {
                id: depositRow.provider_ref,    // fallback match path
                amount_refunded: 2500,
                refunds: { data: [{ reason: 'requested_by_customer' }] },
            },
        },
        created: Math.floor(Date.now() / 1000),
    };
    const refundPayload = JSON.stringify(refundEvent);
    const refundRes = await fetch('http://localhost:3199/api/payment/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signPayload(refundPayload, STRIPE_WEBHOOK_SECRET) },
        body: refundPayload,
    });
    assert.strictEqual(refundRes.status, 200);
    const afterRefund = await http('GET', '/api/user/me', { token });
    assert.strictEqual(afterRefund.body.user.balance_cents, 0, 'refund did not decrement balance');
    const depRow = await db.get('SELECT status FROM deposits WHERE id = ?', [depositId]);
    assert.strictEqual(depRow.status, 'refunded');
    console.log('[test] refund flow OK — balance zeroed, deposit marked refunded');

    // 10) NFT has real SVG image
    const nftsAfter = await http('GET', '/api/nfts', { token });
    const nft2 = nftsAfter.body.nfts[0];
    assert.ok(nft2.metadata.image && /^data:image\/svg\+xml/.test(nft2.metadata.image), 'NFT image not a data URL');
    console.log('[test] NFT has SVG art (' + nft2.metadata.image.length + ' bytes)');

    // 11) Admin login via bootstrapped credentials + overview endpoint
    const adminCsrf = (await http('GET', '/api/csrf-token')).body.csrfToken;
    const adminLogin = await http('POST', '/api/auth/login', {
        csrf: adminCsrf,
        body: { username: 'admin_test', password: 'AdminTest!2026' },
    });
    assert.strictEqual(adminLogin.status, 200, 'admin login failed: ' + adminLogin.raw);
    assert.strictEqual(adminLogin.body.user.is_admin, true);
    const adminToken = adminLogin.body.token;
    const overview = await http('GET', '/api/admin/overview', { token: adminToken });
    assert.strictEqual(overview.status, 200);
    assert.ok(overview.body.users.total >= 2, 'expected at least admin + tester');
    assert.strictEqual(overview.body.deposits.count, 1);
    assert.strictEqual(overview.body.refunds.count, 1);
    console.log('[test] admin overview: ' + overview.body.users.total + ' users, ' + overview.body.deposits.count + ' paid, ' + overview.body.refunds.count + ' refunded');

    // 12) Admin access denied for non-admin user
    const denied = await http('GET', '/api/admin/overview', { token });
    assert.strictEqual(denied.status, 403);
    console.log('[test] non-admin blocked from /api/admin/*');

    // 13) Deposit limits — read then enforce a decrease
    const limitsBefore = await http('GET', '/api/deposit/limits', { token });
    assert.strictEqual(limitsBefore.status, 200);
    assert.ok(limitsBefore.body.limits.daily_cents > 0);
    const authedCsrf2 = (await http('GET', '/api/csrf-token', { token })).body.csrfToken;
    const decrease = await http('PUT', '/api/deposit/limits', {
        token,
        csrf: authedCsrf2,
        body: { daily_cents: 1000, weekly_cents: 2000, monthly_cents: 3000 },
    });
    assert.strictEqual(decrease.status, 200);
    assert.deepStrictEqual(decrease.body.limits, { daily_cents: 1000, weekly_cents: 2000, monthly_cents: 3000 });
    console.log('[test] deposit limits decrease applied');

    // 14) Deposit limit increase is rejected without cooling-off
    const increase = await http('PUT', '/api/deposit/limits', {
        token,
        csrf: authedCsrf2,
        body: { daily_cents: 999999, weekly_cents: 999999, monthly_cents: 999999 },
    });
    assert.strictEqual(increase.status, 200);
    assert.ok(increase.body.rejected && increase.body.rejected.length === 3, 'increases must be rejected: ' + JSON.stringify(increase.body));
    console.log('[test] deposit limits increases rejected (cooling-off)');

    // 15) Email service captured a deposit receipt
    const emailSvc = require('../server/services/email.service');
    const mails = emailSvc.getCaptured();
    const receiptMail = mails.find(m => /deposit/i.test(m.subject));
    assert.ok(receiptMail, 'no deposit-receipt email captured');
    assert.ok(/\$25\.00/.test(receiptMail.text), 'receipt email missing amount');
    console.log('[test] deposit receipt email sent ("' + receiptMail.subject + '")');

    // 16) Change password (authed)
    const meCsrf = (await http('GET', '/api/csrf-token', { token })).body.csrfToken;
    const cp = await http('POST', '/api/auth/change-password', {
        token, csrf: meCsrf,
        body: { current_password: 'Str0ngP@ss!!', new_password: 'Str0ngP@ss!!v2' },
    });
    assert.strictEqual(cp.status, 200, 'change-password failed: ' + cp.raw);
    // Old password should now fail
    const oldLogin = await http('POST', '/api/auth/login', { csrf, body: { username: reg.body.user.username, password: 'Str0ngP@ss!!' } });
    assert.strictEqual(oldLogin.status, 401);
    console.log('[test] change password works, old password rejected');

    // 17) Forgot + reset password round-trip
    emailSvc.clearCaptured();
    const fp = await http('POST', '/api/auth/forgot-password', { csrf, body: { email: reg.body.user.email } });
    assert.strictEqual(fp.status, 200);
    // SMTP_CAPTURE=1 should have recorded the reset email
    const resetMail = emailSvc.getCaptured().find(m => /reset/i.test(m.subject));
    assert.ok(resetMail, 'reset email not captured');
    const tokenMatch = resetMail.text.match(/reset-password=([A-Fa-f0-9]+)/);
    assert.ok(tokenMatch, 'reset email missing token URL: ' + resetMail.text.slice(0, 200));
    const resetToken = tokenMatch[1];
    const rp = await http('POST', '/api/auth/reset-password', {
        csrf,
        body: { token: resetToken, new_password: 'ResetP@ss2026' },
    });
    assert.strictEqual(rp.status, 200, 'reset-password failed: ' + rp.raw);
    // Used token cannot be reused
    const rpReplay = await http('POST', '/api/auth/reset-password', {
        csrf,
        body: { token: resetToken, new_password: 'Other!Pass1' },
    });
    assert.strictEqual(rpReplay.status, 400);
    const newLogin = await http('POST', '/api/auth/login', { csrf, body: { username: reg.body.user.username, password: 'ResetP@ss2026' } });
    assert.strictEqual(newLogin.status, 200);
    console.log('[test] forgot/reset password round-trip works, token single-use');

    // 18) Account deletion with confirmation
    const delToken = newLogin.body.token;
    const delCsrf = (await http('GET', '/api/csrf-token', { token: delToken })).body.csrfToken;
    const delNoConfirm = await http('DELETE', '/api/user', { token: delToken, csrf: delCsrf, body: {} });
    assert.strictEqual(delNoConfirm.status, 400);
    const del = await http('DELETE', '/api/user', {
        token: delToken, csrf: delCsrf,
        body: { confirm_username: reg.body.user.username },
    });
    assert.strictEqual(del.status, 200, 'delete failed: ' + del.raw);
    // Old JWT is still technically valid (stateless) but the user row is gone
    const afterDel = await http('GET', '/api/user/me', { token: delToken });
    assert.strictEqual(afterDel.status, 404);
    console.log('[test] account deletion works; post-delete /me returns 404');

    console.log('\n✅ all deposit-flow assertions passed');
    main.server.close();
    await db.close();
    try { fs.unlinkSync(process.env.SQLITE_FILE); } catch (err) { /* ignore */ }
    process.exit(0);
}

main().catch(err => {
    console.error('❌ test failed:', err);
    if (main.server) main.server.close();
    process.exit(1);
});
