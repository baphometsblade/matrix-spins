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

        // Real-money vs free-play pills visible on every card so a
        // logged-in player can never confuse a demo for a live slot.
        // We assert every card carries exactly one mode pill and that
        // at least one of each kind is present (the catalog has 2 live
        // games + 65 demos).
        const pillSummary = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.game-card'));
            let live = 0, demo = 0, missing = 0;
            for (const c of cards) {
                const live1 = c.querySelector('.game-mode-pill.gmp-live');
                const demo1 = c.querySelector('.game-mode-pill.gmp-demo');
                if (live1 && !demo1) live += 1;
                else if (demo1 && !live1) demo += 1;
                else missing += 1;
            }
            return { live, demo, missing, total: cards.length };
        });
        if (pillSummary.missing > 0) fail('mode pill missing on ' + pillSummary.missing + '/' + pillSummary.total + ' cards');
        else if (pillSummary.live < 1 || pillSummary.demo < 1) fail('mode pills not split: ' + JSON.stringify(pillSummary));
        else ok('mode pills: ' + pillSummary.live + ' REAL MONEY, ' + pillSummary.demo + ' FREE PLAY across ' + pillSummary.total + ' cards');

        // Hero copy — assertions guard against the old false claims
        // (165+ games, $25,000 jackpot, instant withdrawals, hardcoded
        // "12 wins in last hour"). Catalog is 67 games, only 2 take
        // real money, and withdrawals require operator approval, so
        // the hero must not say otherwise.
        const heroCopy = await page.evaluate(() => {
            const hero = document.querySelector('.hero-banner');
            return hero ? (hero.textContent || '') : '';
        });
        const heroLies = [
            { needle: '165+', label: '"165+ games" claim' },
            { needle: '$25,000', label: '"$25,000 jackpot" claim' },
            { needle: 'Instant Withdrawals', label: '"Instant Withdrawals" claim' },
            { needle: 'wins in last hour', label: 'hardcoded "wins in last hour" copy' },
        ];
        const stillLying = heroLies.filter(l => heroCopy.indexOf(l.needle) >= 0);
        if (stillLying.length) {
            fail('hero still advertises: ' + stillLying.map(l => l.label).join(', '));
        } else {
            ok('hero copy is honest (no 165+/jackpot/instant-withdrawals/12-wins-per-hour claims)');
        }

        // Real Money filter — clicking the live tab must narrow the
        // main "All Games" grid to liveMode slots only. Other lobby
        // sections (Hot, New, recently-played carousels) keep their
        // own card sets, so we scope the assertion to #allGames.
        const liveFilter = await page.evaluate(async () => {
            if (typeof setFilter !== 'function') return { ok: false, reason: 'setFilter not defined' };
            setFilter('live');
            await new Promise((r) => setTimeout(r, 100));
            const grid = document.getElementById('allGames');
            if (!grid) {
                setFilter('all');
                return { ok: false, reason: '#allGames not found' };
            }
            const cards = Array.from(grid.querySelectorAll('.game-card'));
            const live = cards.filter((c) => c.querySelector('.game-mode-pill.gmp-live')).length;
            const demo = cards.filter((c) => c.querySelector('.game-mode-pill.gmp-demo')).length;
            setFilter('all');
            return { ok: true, live, demo, total: cards.length };
        });
        if (!liveFilter.ok) fail('live filter setup failed: ' + liveFilter.reason);
        else if (liveFilter.demo > 0) fail('live filter leaked ' + liveFilter.demo + ' demo card(s) into #allGames');
        else if (liveFilter.live < 1) fail('live filter rendered no real-money cards in #allGames');
        else ok('live filter (#allGames): ' + liveFilter.live + ' real-money cards, 0 demo cards');

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

                    // Second game: open neon_burst, assert the modal
                    // re-renders with 5 reel cells and the right header.
                    await page.evaluate(() => { if (window.closeLiveSlot) window.closeLiveSlot(); });
                    await page.evaluate(() => { window.openLiveSlot('neon_burst'); });
                    await page.waitForFunction(
                        () => {
                            const t = document.getElementById('liveSlotTitle');
                            return t && /NEON BURST/i.test(t.textContent || '');
                        },
                        { timeout: 5000 }
                    ).catch(() => { /* reported below */ });
                    const cells = await page.$$('#liveSlotReels .ls-reel');
                    if (cells.length !== 5) {
                        fail('neon_burst modal should render 5 reel cells, got ' + cells.length);
                    } else {
                        const beforeNb = await db.get("SELECT balance_cents FROM users WHERE id = ?", [userRow.id]);
                        const roundCountBefore = Number((await db.get(
                            "SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?", [userRow.id]
                        )).n) || 0;
                        await page.click('#liveSlotSpin');
                        let nbRound = null;
                        for (let i = 0; i < 50 && !nbRound; i++) {
                            nbRound = await db.get(
                                "SELECT id, game_id, bet_cents, win_cents FROM slot_rounds WHERE user_id = ? AND game_id = 'neon_burst' ORDER BY id DESC LIMIT 1",
                                [userRow.id]
                            );
                            if (!nbRound) await new Promise(r => setTimeout(r, 100));
                        }
                        if (!nbRound) {
                            fail('neon_burst spin did not persist a round');
                        } else {
                            const afterNb = await db.get("SELECT balance_cents FROM users WHERE id = ?", [userRow.id]);
                            const roundCountAfter = Number((await db.get(
                                "SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?", [userRow.id]
                            )).n) || 0;
                            const delta = Number(afterNb.balance_cents) - Number(beforeNb.balance_cents);
                            const expected = Number(nbRound.win_cents) - Number(nbRound.bet_cents);
                            if (delta !== expected) {
                                fail('neon_burst balance math: delta=' + delta + ' expected=' + expected);
                            } else if (roundCountAfter !== roundCountBefore + 1) {
                                fail('neon_burst should add exactly 1 round');
                            } else {
                                ok('neon_burst: 5-reel modal opened, spin persisted (#' + nbRound.id + '), balance delta matches');
                            }
                        }
                    }

                    // Persistent client seed: type a value into the new
                    // panel, save, spin, assert revealed.client_seed matches.
                    // The panel lives inside a collapsed <details> — open
                    // it so the input is interactable.
                    await page.evaluate(() => {
                        var d = document.querySelector('#liveSlotCard details');
                        if (d) d.open = true;
                    });
                    await page.fill('#liveSlotClientSeedInput', 'browser-smoke-seed');
                    await page.click('#liveSlotClientSeedSave');
                    await page.waitForFunction(
                        () => /Saved\./.test((document.getElementById('liveSlotClientSeedMsg') || {}).textContent || ''),
                        { timeout: 4000 }
                    ).catch(() => { /* reported below */ });
                    // Clear window.__lastSlotResult so the wait below
                    // can't satisfy itself with stale state from the
                    // previous neon_burst spin.
                    await page.evaluate(() => { try { delete window.__lastSlotResult; } catch (e) { window.__lastSlotResult = null; } });
                    await page.click('#liveSlotSpin');
                    await page.waitForFunction(
                        () => window.__lastSlotResult && window.__lastSlotResult.revealed,
                        { timeout: 5000 }
                    ).catch(() => { /* reported below */ });
                    const revealed = await page.evaluate(() => window.__lastSlotResult && window.__lastSlotResult.revealed);
                    if (!revealed) {
                        fail('client seed: live-slot spin produced no revealed payload');
                    } else if (revealed.client_seed !== 'browser-smoke-seed') {
                        fail('client seed: revealed.client_seed=' + JSON.stringify(revealed.client_seed) + ' (expected browser-smoke-seed)');
                    } else {
                        ok('client seed: panel save → next spin used the saved seed (revealed.client_seed=' + revealed.client_seed + ')');
                    }

                    // Rotate-seed: clicking the new button must change
                    // the commit hash on screen.
                    const oldHashText = await page.$eval('#liveSlotCommit span', el => el.textContent.trim());
                    await page.click('#liveSlotRotateBtn');
                    const rotated = await page.waitForFunction(
                        (prev) => {
                            const span = document.querySelector('#liveSlotCommit span');
                            return !!(span && span.textContent.trim() && span.textContent.trim() !== prev);
                        },
                        oldHashText,
                        { timeout: 5000 }
                    ).then(() => true).catch(() => false);
                    if (!rotated) {
                        fail('rotate-seed: commit hash did not change after Rotate click');
                    } else {
                        const newHashText = await page.$eval('#liveSlotCommit span', el => el.textContent.trim());
                        ok('rotate-seed: commit hash rolled (' + oldHashText + ' → ' + newHashText + ')');
                    }

                    // Auto-spin x10: select Auto 10×, click SPIN, wait
                    // until 10 rounds are persisted, assert the
                    // selector was disabled during the loop and is
                    // re-enabled afterwards.
                    const beforeAutoCount = Number((await db.get(
                        "SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?", [userRow.id]
                    )).n) || 0;
                    await page.selectOption('#liveSlotAutoCount', '10');
                    await page.click('#liveSlotSpin');
                    // Pacing is ~350ms × 10 = 3.5s; allow generous headroom.
                    const reachedTen = await page.waitForFunction(
                        (start) => {
                            return new Promise((resolve) => resolve(true));
                        },
                        beforeAutoCount,
                        { timeout: 1 }
                    ).then(() => true).catch(() => true);
                    void reachedTen;
                    // Poll until we observe both: 10 rounds persisted AND
                    // the loop has called setAutoUI(false) (controls
                    // re-enabled). Polling both together avoids a race
                    // where round 10's INSERT lands a beat before
                    // setAutoUI runs.
                    let after = beforeAutoCount;
                    let controlsEnabled = false;
                    for (let i = 0; i < 100; i++) {
                        const row = await db.get(
                            "SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?",
                            [userRow.id]
                        );
                        after = Number(row && row.n) || 0;
                        controlsEnabled = await page.evaluate(() => {
                            const sel = document.getElementById('liveSlotAutoCount');
                            return sel ? !sel.disabled : false;
                        });
                        if (after >= beforeAutoCount + 10 && controlsEnabled) break;
                        await new Promise(r => setTimeout(r, 200));
                    }
                    if (after !== beforeAutoCount + 10) {
                        fail('auto-spin x10: expected ' + (beforeAutoCount + 10) + ' rounds, saw ' + after);
                    } else if (!controlsEnabled) {
                        fail('auto-spin x10 left controls in disabled state');
                    } else {
                        ok('auto-spin x10: 10 rounds settled, controls re-enabled');
                    }

                    // Auto-spin session-loss cap: bet $1, cap loss at
                    // $0.05. classic_777's RTP is 95.2% but the 7-of-a-
                    // kind jackpot is 1/1000 — at $1 a single losing
                    // spin already exceeds 5¢ of net loss, so the cap
                    // must trip on (at most) the very first spin.
                    await page.evaluate(() => {
                        delete window.__lastSlotResult;
                        const inp = document.getElementById('liveSlotBet');
                        if (inp) inp.value = '1.00';
                        document.getElementById('liveSlotAutoLoss').value = '0.05';
                        document.getElementById('liveSlotAutoFloor').value = '0';
                    });
                    const beforeCap = Number((await db.get(
                        "SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?", [userRow.id]
                    )).n) || 0;
                    await page.selectOption('#liveSlotAutoCount', '25');
                    await page.click('#liveSlotSpin');
                    let lossCapText = '';
                    let after2 = beforeCap;
                    for (let i = 0; i < 100; i++) {
                        const row = await db.get(
                            "SELECT COUNT(*) AS n FROM slot_rounds WHERE user_id = ?", [userRow.id]
                        );
                        after2 = Number(row && row.n) || 0;
                        lossCapText = await page.evaluate(() =>
                            (document.getElementById('liveSlotResult') || {}).textContent || ''
                        );
                        if (/loss cap reached/i.test(lossCapText)) break;
                        await new Promise(r => setTimeout(r, 200));
                    }
                    const triggered = /loss cap reached/i.test(lossCapText);
                    const spinsRun = after2 - beforeCap;
                    if (!triggered) {
                        fail('auto-spin loss cap: never triggered. Result text: ' + lossCapText.slice(0, 160));
                    } else if (spinsRun >= 25) {
                        fail('auto-spin loss cap: ran the full 25 (cap should stop early), got ' + spinsRun);
                    } else {
                        ok('auto-spin loss cap: stopped after ' + spinsRun + ' spin(s) — "' + lossCapText.slice(0, 80) + '"');
                    }
                    // Reset the inputs so any subsequent assertions
                    // aren't affected.
                    await page.evaluate(() => {
                        document.getElementById('liveSlotAutoCount').value = '0';
                        document.getElementById('liveSlotAutoLoss').value = '0';
                        document.getElementById('liveSlotAutoFloor').value = '0';
                    });

                    // Demo closeSlot resync. The 65 non-live games run
                    // through the client-side demo engine, which mutates
                    // the bundle-scoped `balance` variable to make the
                    // simulation feel real. Without a resync the lobby
                    // displays a fictitious post-demo balance until the
                    // next page load. We can't mutate the let-scoped
                    // `balance` from page-evaluate context, so instead
                    // we intercept fetch and confirm closeSlot for a
                    // demo game fires GET /api/balance — exactly the
                    // refetch the fix introduces.
                    await page.evaluate(() => { if (window.closeLiveSlot) window.closeLiveSlot(); });
                    await page.evaluate(() => {
                        window.__balanceFetches = 0;
                        const orig = window.fetch.bind(window);
                        window.fetch = function (url, opts) {
                            if (typeof url === 'string' && /\/api\/balance(\?|$)/.test(url) &&
                                (!opts || (opts.method || 'GET') === 'GET')) {
                                window.__balanceFetches += 1;
                            }
                            return orig(url, opts);
                        };
                        if (typeof window.openSlot === 'function') window.openSlot('sugar_rush');
                    });
                    await page.waitForFunction(
                        () => document.getElementById('slotModal') &&
                              document.getElementById('slotModal').classList.contains('active'),
                        { timeout: 5000 }
                    ).catch(() => { /* reported below */ });
                    const fetchBefore = await page.evaluate(() => Number(window.__balanceFetches || 0));
                    await page.evaluate(() => { if (typeof closeSlot === 'function') closeSlot(); });
                    const fired = await page.waitForFunction(
                        (b) => Number(window.__balanceFetches || 0) > b,
                        fetchBefore,
                        { timeout: 4000 }
                    ).then(() => true).catch(() => false);
                    if (!fired) {
                        const after = await page.evaluate(() => Number(window.__balanceFetches || 0));
                        fail('demo closeSlot resync: GET /api/balance did not fire (before=' + fetchBefore + ' after=' + after + ')');
                    } else {
                        ok('demo closeSlot resync: GET /api/balance refetched after sugar_rush close');
                    }
                }
            } else {
                fail('could not find registered user row for live-slot test');
            }
        }

        // Verify-round page — after the live-slot spin persisted a
        // round, navigate to /verify-round.html?round=N and confirm
        // the browser's SubtleCrypto RNG reimplementation reaches the
        // same indices the server did. This catches any drift between
        // server/services/slot-engine.service.js and the hardcoded
        // client reel strip.
        if (registered) {
            const userRow = await db.get("SELECT id FROM users WHERE username = ?", [regUsername]);
            const roundRow = userRow ? await db.get(
                'SELECT id FROM slot_rounds WHERE user_id = ? ORDER BY id DESC LIMIT 1',
                [userRow.id]
            ) : null;
            if (roundRow && roundRow.id) {
                await page.goto('http://localhost:' + process.env.PORT + '/verify-round.html?round=' + roundRow.id, { waitUntil: 'networkidle', timeout: 15000 });
                // Wait for the auto-verify driven by ?round=... to render
                // the result card.
                const okPill = await page.waitForSelector('#result-card .pill-ok', { timeout: 5000 })
                    .then(el => el ? el.innerText() : null)
                    .catch(() => null);
                const failPill = await page.$('#result-card .pill-fail');
                if (failPill) {
                    const txt = await failPill.innerText();
                    fail('verify-round showed a failure pill: ' + txt);
                } else if (!okPill) {
                    fail('verify-round did not render a verification pill');
                } else {
                    ok('verify-round: ' + okPill.trim() + ' for round #' + roundRow.id);
                }
            }
        }

        // Withdrawal UI — navigate to /account.html, open the
        // Withdrawals tab, submit the form, and assert a real pending
        // withdrawal row exists for this user.
        if (registered) {
            const userRow = await db.get("SELECT id FROM users WHERE username = ?", [regUsername]);
            if (userRow && userRow.id) {
                // Email-verified + healthy balance are prerequisites;
                // the withdrawal endpoint rejects otherwise.
                await db.run("UPDATE users SET email_verified = 1, balance_cents = ? WHERE id = ?", [50000, userRow.id]);
                await page.goto('http://localhost:' + process.env.PORT + '/account.html', { waitUntil: 'networkidle', timeout: 15000 });
                // Dismiss any first-visit consent overlay if it shows up here too.
                await page.evaluate(() => {
                    var btn = document.getElementById('acceptTermsBtn');
                    if (btn) btn.click();
                    var consent = document.getElementById('first-visit-consent');
                    if (consent && consent.parentNode) consent.parentNode.removeChild(consent);
                });
                // Switch to the Withdrawals tab.
                await page.evaluate(() => {
                    var tab = document.querySelector('[data-tab="withdrawals"]');
                    if (tab) tab.click();
                });
                const formUp = await page.waitForSelector('#wd-form', { state: 'visible', timeout: 5000 })
                    .then(() => true).catch(() => false);
                if (!formUp) {
                    fail('withdrawal form did not become visible on account page');
                } else {
                    await page.fill('#wd-amount', '25');
                    await page.selectOption('#wd-method', 'bank_transfer');
                    await page.fill('#wd-destination', 'IBAN-SMOKE-' + Date.now());
                    const beforeBal = await db.get("SELECT balance_cents FROM users WHERE id = ?", [userRow.id]);
                    await page.click('#wd-submit');
                    // Wait until the server-side row appears.
                    let wdRow = null;
                    for (let i = 0; i < 50 && !wdRow; i++) {
                        wdRow = await db.get("SELECT id, amount_cents, status FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userRow.id]);
                        if (!wdRow) await new Promise(r => setTimeout(r, 100));
                    }
                    if (!wdRow) {
                        fail('withdrawal UI submit did not persist a withdrawal row');
                    } else {
                        const afterBal = await db.get("SELECT balance_cents FROM users WHERE id = ?", [userRow.id]);
                        if (Number(wdRow.amount_cents) !== 2500) {
                            fail('withdrawal amount wrong: ' + wdRow.amount_cents + 'c');
                        } else if (wdRow.status !== 'pending') {
                            fail('withdrawal status wrong: ' + wdRow.status);
                        } else if (Number(afterBal.balance_cents) !== Number(beforeBal.balance_cents) - 2500) {
                            fail('withdrawal balance debit wrong: before=' + beforeBal.balance_cents + ' after=' + afterBal.balance_cents);
                        } else {
                            ok('withdrawal UI: $25 request submitted, row=' + wdRow.id + ' status=pending, balance debited exactly');
                        }
                    }

                    // Slots tab — assert stats card populates with the
                    // per-user spin history accumulated by earlier
                    // assertions (live-slot, neon_burst, auto-spin x10).
                    await page.evaluate(() => {
                        var tab = document.querySelector('[data-tab="slots"]');
                        if (tab) tab.click();
                    });
                    const slotsTabUp = await page.waitForFunction(
                        () => {
                            const v = document.getElementById('ss-spins');
                            return v && /^\d+$/.test((v.textContent || '').replace(/,/g, ''));
                        },
                        { timeout: 5000 }
                    ).then(() => true).catch(() => false);
                    if (!slotsTabUp) {
                        fail('slots tab: stats card never populated');
                    } else {
                        const cents = await page.evaluate(() => ({
                            spins:    Number((document.getElementById('ss-spins').textContent || '').replace(/,/g, '')),
                            wagered:  document.getElementById('ss-wagered').textContent,
                            won:      document.getElementById('ss-won').textContent,
                            biggest:  document.getElementById('ss-biggest').textContent,
                        }));
                        if (cents.spins < 10) {
                            fail('slots tab: expected ≥10 spins from earlier blocks, saw ' + cents.spins);
                        } else if (!/\$/.test(cents.wagered) || !/\$/.test(cents.won)) {
                            fail('slots tab: wagered/won did not render as $ amounts');
                        } else {
                            ok('slots tab: ' + cents.spins + ' spins, wagered ' + cents.wagered + ', won ' + cents.won);
                        }
                    }
                }
            }
        }

        // Hot-wins ticker — runs LAST so the page reload doesn't
        // disturb upstream auth/CSRF state. Seed a public win row,
        // reload the lobby, assert the ticker shows the anonymized
        // username and the win amount.
        const tickerName = 'tick_' + Date.now();
        const tickerHash = await require('bcryptjs').hash('Str0ngP@ss!!', 10);
        await db.run(
            'INSERT INTO users (username, email, password_hash, date_of_birth, email_verified, balance_cents) VALUES (?, ?, ?, ?, 1, ?)',
            [tickerName, tickerName + '@example.com', tickerHash, '1990-01-01', 1000000]
        );
        const tickerUser = await db.get('SELECT id FROM users WHERE username = ?', [tickerName]);
        await db.run(
            `INSERT INTO slot_rounds
             (user_id, game_id, bet_cents, win_cents, balance_after_cents,
              server_seed, server_seed_hash, client_seed, nonce, outcome_json)
             VALUES (?, 'classic_777', 100, 90000, 0, 'x', 'y', 'z', 1, '{}')`,
            [tickerUser.id]
        );
        try { require('../server/routes/public.routes')._test.resetCache(); } catch (e) { /* ignore */ }
        await page.goto('http://localhost:' + process.env.PORT + '/', { waitUntil: 'networkidle', timeout: 15000 });
        const tickerVisible = await page.waitForFunction(() => {
            const t = document.getElementById('hotWinsTicker');
            const s = document.getElementById('hotWinsScroll');
            return t && t.style.display !== 'none' && s && s.children.length > 0;
        }, { timeout: 8000 }).then(() => true).catch(() => false);
        if (!tickerVisible) {
            fail('hot-wins ticker did not become visible after seeding a public win');
        } else {
            const expectedAnon = tickerName.slice(0, 2) + '***' + tickerName.slice(-2);
            const tickerText = await page.$eval('#hotWinsScroll', el => el.textContent || '');
            if (tickerText.indexOf(expectedAnon) < 0) {
                fail('hot-wins ticker missing anonymized username "' + expectedAnon + '" in: ' + tickerText.slice(0, 200));
            } else if (tickerText.indexOf(tickerName) >= 0) {
                fail('hot-wins ticker leaked the raw username: ' + tickerText.slice(0, 200));
            } else if (tickerText.indexOf('won $900.00') < 0) {
                fail('hot-wins ticker missing the win amount: ' + tickerText.slice(0, 200));
            } else {
                ok('hot-wins ticker: rendered the anonymized win (' + expectedAnon + ')');
            }
        }

        // Public stats page — visit /stats.html and assert the
        // lifetime cards populate with $ amounts and the per-game
        // table fills with both wired games.
        try { require('../server/routes/public.routes')._test.resetCache(); } catch (e) { /* ignore */ }
        await page.goto('http://localhost:' + process.env.PORT + '/stats.html', { waitUntil: 'networkidle', timeout: 15000 });
        const statsReady = await page.waitForFunction(() => {
            const wagered = (document.getElementById('t-wagered') || {}).textContent || '';
            const tbody = document.querySelector('#tbl-games tbody');
            return /\$/.test(wagered) && tbody && tbody.children.length >= 1 && !/loading/i.test(tbody.textContent || '');
        }, { timeout: 8000 }).then(() => true).catch(() => false);
        if (!statsReady) {
            fail('stats page never populated');
        } else {
            const view = await page.evaluate(() => ({
                spins: (document.getElementById('t-spins') || {}).textContent || '',
                wagered: (document.getElementById('t-wagered') || {}).textContent || '',
                won: (document.getElementById('t-won') || {}).textContent || '',
                rtp: (document.getElementById('t-rtp') || {}).textContent || '',
                rows: Array.from(document.querySelectorAll('#tbl-games tbody tr')).map(r => r.textContent.trim().slice(0, 40)),
            }));
            const ok77 = view.rows.some(t => /classic_777/.test(t));
            const okNeon = view.rows.some(t => /neon_burst/.test(t));
            if (!ok77 || !okNeon) {
                fail('stats page: per-game rows missing classic_777 or neon_burst — ' + JSON.stringify(view.rows));
            } else if (!/\$/.test(view.wagered) || !/\$/.test(view.won)) {
                fail('stats page: wagered/won did not render as $ amounts');
            } else {
                ok('stats page: ' + view.spins + ' spins, wagered ' + view.wagered + ', won ' + view.won + ', RTP ' + view.rtp);
            }

            // Leaderboard table must populate (or render the empty-state
            // copy if no qualifying users yet — both prove the JS ran).
            const lbReady = await page.waitForFunction(() => {
                const tbody = document.querySelector('#tbl-leaderboard tbody');
                return tbody && tbody.children.length >= 1 && !/loading/i.test(tbody.textContent || '');
            }, { timeout: 8000 }).then(() => true).catch(() => false);
            if (!lbReady) {
                fail('stats page: leaderboard table never populated');
            } else {
                const lb = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('#tbl-leaderboard tbody tr'))
                        .map(r => r.textContent.trim().slice(0, 80));
                    return { rows, rowCount: rows.length };
                });
                ok('stats page: leaderboard rendered (' + lb.rowCount + ' row(s))');
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
