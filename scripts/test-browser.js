#!/usr/bin/env node
'use strict';

/**
 * End-to-end browser smoke test.
 *
 * Boots the server (with the same in-process env the deposit test
 * uses), launches headless Chromium via Playwright, loads /,
 * and asserts that the lobby actually renders: game cards appear,
 * real SVG thumbnails load, no uncaught console errors fire.
 *
 * This catches the class of bug where a syntax error in the
 * concatenated bundle silently kills the client — the API-level
 * test in scripts/test-deposit-flow.js doesn't look at the browser
 * at all and can't see the bundle failing to execute.
 *
 *   npm run test:browser
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Set the same env the API test uses so config.js accepts the run.
process.env.NODE_ENV = 'development';
process.env.PORT = '3210';
process.env.PUBLIC_URL = 'http://localhost:3210';
process.env.ALLOWED_ORIGIN = 'http://localhost:3210';
process.env.JWT_SECRET = 'browser-test-jwt-' + crypto.randomBytes(8).toString('hex');
process.env.NFT_SIGNING_SECRET = 'browser-test-nft-' + crypto.randomBytes(8).toString('hex');
process.env.ADMIN_PASSWORD = 'browser-test-admin';
process.env.SQLITE_FILE = path.join(__dirname, '..', 'server', 'browser-test-data.sqlite');
process.env.STRIPE_RECONCILE_DISABLED = '1';
process.env.MAINTENANCE_CRON_DISABLED = '1';
process.env.SMTP_CAPTURE = '1';

try { fs.unlinkSync(process.env.SQLITE_FILE); } catch (err) { /* first run */ }

function fail(msg) { console.error('❌ ' + msg); process.exitCode = 1; }
function ok(msg) { console.log('✓ ' + msg); }

async function main() {
    let playwright;
    try { playwright = require('playwright'); }
    catch (e) {
        console.error('Playwright is not installed (devDependency). Run: npm install');
        process.exit(1);
    }

    const app = require('../server/index');
    const db = require('../server/database');
    await db.initDatabase();
    await require('../server/services/admin.service').bootstrap();
    const server = await new Promise(resolve => {
        const s = app.listen(Number(process.env.PORT), () => resolve(s));
    });
    console.log('[test] server up on :' + process.env.PORT);

    // Chrome may not be pre-installed; if the launch fails we give a
    // clear actionable message rather than a stack trace.
    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true });
    } catch (err) {
        console.error('❌ could not launch Chromium: ' + err.message);
        console.error('   Install browsers with: npx playwright install chromium');
        server.close();
        await db.close();
        process.exit(1);
    }

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => {
        consoleErrors.push('pageerror: ' + err.message);
    });

    const req404 = [];
    page.on('response', res => {
        if (res.status() === 404) req404.push(res.url());
    });

    try {
        await page.goto('http://localhost:' + process.env.PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
        ok('page loaded');

        // Is the asset manifest reachable + populated? Wait for the
        // async fetch to land (`loaded: true`), then read sizes.
        await page.waitForFunction(
            () => window.__assetManifest && window.__assetManifest.loaded,
            { timeout: 5000 }
        ).catch(() => { /* reported below */ });
        const manifest = await page.evaluate(() => {
            const m = window.__assetManifest;
            if (!m) return null;
            return {
                loaded: !!m.loaded,
                thumbnails: m.thumbnails && typeof m.thumbnails.size === 'number' ? m.thumbnails.size : 0,
                symbols: m.symbols && typeof m.symbols.size === 'number' ? m.symbols.size : 0,
                games: m.gameSymbols && typeof m.gameSymbols.size === 'number' ? m.gameSymbols.size : 0,
            };
        });
        if (!manifest || !manifest.loaded || manifest.thumbnails < 1 || manifest.games < 1) {
            fail('asset manifest empty or missing on the page: ' + JSON.stringify(manifest));
        } else {
            ok('manifest on page reports ' + manifest.thumbnails + ' thumbs / ' + manifest.games + ' games with symbols');
        }

        // Game cards render?
        const cards = await page.$$('.game-card');
        if (cards.length < 1) fail('no .game-card rendered — bundle likely died');
        else ok(cards.length + ' game cards rendered');

        // Wait until at least one thumbnail has finished decoding.
        // Headless Chromium's SVG rasterizer is stochastic — the
        // "first" DOM card doesn't always decode first. What we care
        // about is that the <img>-based pipeline works at all; that
        // means "any thumbnail decoded." This check scans all cards.
        await page.waitForFunction(() => {
            return Array.from(document.querySelectorAll('.game-card .game-card-thumb'))
                .some(img => img && img.complete && img.naturalWidth > 0);
        }, { timeout: 30000 }).catch(() => { /* reported below */ });
        const thumbSummary = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('.game-card .game-card-thumb'));
            const decoded = imgs.filter(i => i && i.complete && i.naturalWidth > 0);
            const first = decoded[0] || imgs[0] || null;
            return {
                total: imgs.length,
                decoded: decoded.length,
                sample: first ? {
                    src: first.currentSrc || first.src,
                    natural: first.naturalWidth + 'x' + first.naturalHeight,
                    complete: first.complete,
                } : null,
            };
        });
        if (!thumbSummary.sample) fail('no .game-card-thumb <img> found');
        else if (thumbSummary.decoded === 0) {
            fail('no thumbnails decoded: ' + JSON.stringify(thumbSummary));
        } else {
            ok(thumbSummary.decoded + '/' + thumbSummary.total + ' thumbnails decoded (sample: ' + thumbSummary.sample.src + ' ' + thumbSummary.sample.natural + ')');
        }

        // Register modal opens on click?
        // Note: we don't actually submit — just confirm the form elements
        // are present, proving auth.js wired up.
        const authOk = await page.evaluate(() => !!document.querySelector('#loginUsername'));
        if (!authOk) fail('#loginUsername missing — auth UI did not wire up');
        else ok('auth form elements present');

        // Real register flow — open the auth modal, fill the form, submit,
        // and confirm the server returned a session. This catches the class
        // of bug where apiRequest, CSRF, or the register endpoint itself
        // breaks even though the page renders.
        const regUsername = 'smoke' + crypto.randomBytes(4).toString('hex');
        const regEmail = regUsername + '@test.invalid';
        const regPassword = 'BrowserSmoke!' + crypto.randomBytes(3).toString('hex');
        const regDob = '1990-01-01';

        await page.evaluate(() => {
            if (typeof showAuthModal === 'function') showAuthModal();
            if (typeof switchAuthTab === 'function') switchAuthTab('register');
        });
        await page.waitForSelector('#registerForm', { state: 'visible', timeout: 3000 })
            .catch(() => { /* reported below */ });

        await page.fill('#regUsername', regUsername);
        await page.fill('#regEmail', regEmail);
        await page.fill('#regPassword', regPassword);
        await page.fill('#regConfirm', regPassword);
        await page.fill('#regDOB', regDob);

        await page.click('#registerBtn');
        // A successful register sets currentUser AND writes a token to
        // localStorage AND closes the auth modal. Wait on the strongest
        // signal (token) because currentUser is module-scoped and not
        // guaranteed to be on window in every build.
        const registered = await page.waitForFunction(() => {
            // STORAGE_KEY_TOKEN = 'casinoToken' — see js/globals.js.
            const tok = localStorage.getItem('casinoToken');
            return !!(tok && tok.length > 20);
        }, { timeout: 15000 }).then(() => true).catch(() => false);

        if (!registered) {
            const authErr = await page.evaluate(() => {
                const el = document.querySelector('#authError');
                return el ? el.textContent.trim() : '';
            });
            fail('register flow did not establish a session' + (authErr ? ' (authError: "' + authErr + '")' : ''));
        } else {
            const who = await page.evaluate(() => {
                const btn = document.querySelector('#authBtn');
                return btn ? btn.textContent.trim() : '';
            });
            ok('registered ' + regUsername + ' and session is live (authBtn="' + who + '")');
        }

        // Live slot end-to-end — open the classic_777 modal, spin once,
        // assert a real round was persisted server-side. We credit a
        // bankroll directly via the DB; deposit flow is exercised in
        // the API suite, not here.
        if (registered) {
            const userRow = await db.get("SELECT id FROM users WHERE username = ?", [regUsername]);
            if (userRow && userRow.id) {
                await db.run("UPDATE users SET balance_cents = ? WHERE id = ?", [10000, userRow.id]);
                // Dismiss any first-visit consent overlay so it does not
                // intercept the spin-button click. Harmless if absent.
                await page.evaluate(() => {
                    var btn = document.getElementById('acceptTermsBtn');
                    if (btn) btn.click();
                    var consent = document.getElementById('first-visit-consent');
                    if (consent && consent.parentNode) consent.parentNode.removeChild(consent);
                });
                await page.evaluate(() => { if (typeof window.openLiveSlot === 'function') window.openLiveSlot(); });
                const modalUp = await page.waitForSelector('#liveSlotSpin', { state: 'visible', timeout: 5000 })
                    .then(() => true).catch(() => false);
                if (!modalUp) {
                    fail('live slot modal did not open (openLiveSlot unavailable or DOM not rendered)');
                } else {
                    // Wait for the initial balance fetch to paint.
                    await page.waitForFunction(
                        () => /\$100\.00|\$10,000\.00|\$10000\.00|\$100\.00/.test(
                            (document.getElementById('liveSlotBalance') || {}).textContent || ''
                        ),
                        { timeout: 5000 }
                    ).catch(() => { /* still proceed — we check below */ });
                    const before = await db.get("SELECT balance_cents FROM users WHERE id = ?", [userRow.id]);
                    await page.click('#liveSlotSpin');
                    // Wait for a settled round by polling the DB.
                    let rounds = 0;
                    for (let i = 0; i < 50 && rounds === 0; i++) {
                        const row = await db.get("SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?", [userRow.id]);
                        rounds = Number(row && row.n) || 0;
                        if (rounds === 0) await new Promise(r => setTimeout(r, 100));
                    }
                    if (rounds < 1) {
                        fail('live slot spin did not persist a round');
                    } else {
                        const after = await db.get("SELECT balance_cents FROM users WHERE id = ?", [userRow.id]);
                        const round = await db.get("SELECT bet_cents, win_cents FROM slot_rounds WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userRow.id]);
                        const delta = Number(after.balance_cents) - Number(before.balance_cents);
                        const expected = Number(round.win_cents) - Number(round.bet_cents);
                        if (delta !== expected) {
                            fail('live slot balance math: delta=' + delta + ' expected=' + expected + ' bet=' + round.bet_cents + ' win=' + round.win_cents);
                        } else {
                            ok('live slot: 1 round persisted, bet=' + round.bet_cents + 'c win=' + round.win_cents + 'c balance delta matches');
                        }
                    }
                }
            } else {
                fail('could not find registered user row for live-slot test');
            }
        }

        if (consoleErrors.length) {
            // Filter out known-benign noise:
            //   - service-worker registration on a server that doesn't serve /sw.js
            //   - favicon fallback 404s
            //   - 401s on admin-only endpoints hit from a pre-auth visit
            const real = consoleErrors.filter(s =>
                !/service[- ]?worker|sw\.js/i.test(s)
                && !/bad HTTP response code.*received when fetching the script/i.test(s)
                && !/Failed to load resource.*favicon/i.test(s)
                && !/401.*Unauthorized/i.test(s)
                && !/status of 401/i.test(s));
            if (real.length) {
                fail(real.length + ' console error(s):');
                real.slice(0, 5).forEach(e => console.error('    ' + e.slice(0, 200)));
            } else {
                ok('no blocking console errors');
            }
        } else {
            ok('no console errors');
        }

        if (req404.length) {
            const real404 = req404.filter(u => !/favicon|\.map$/.test(u));
            if (real404.length) {
                fail(real404.length + ' unexpected 404(s):');
                real404.slice(0, 5).forEach(u => console.error('    ' + u));
            } else {
                ok('no unexpected 404s');
            }
        } else {
            ok('no 404s at all');
        }

    } finally {
        await browser.close();
        server.close();
        await db.close();
        try { fs.unlinkSync(process.env.SQLITE_FILE); } catch (err) { /* ignore */ }
    }

    if (process.exitCode) {
        console.error('\n❌ browser smoke test failed');
    } else {
        console.log('\n✅ browser smoke test passed');
    }
}

main().catch(err => {
    console.error('[fatal]', err);
    process.exit(1);
});
