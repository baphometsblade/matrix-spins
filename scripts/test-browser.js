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

        // Wait for the first thumbnail to finish decoding. SVGs can take
        // a beat to rasterize in headless Chromium; give it real time.
        await page.waitForFunction(() => {
            const img = document.querySelector('.game-card .game-card-thumb');
            return img && img.complete && img.naturalWidth > 0;
        }, { timeout: 20000 }).catch(() => { /* reported below */ });
        const firstThumb = await page.evaluate(() => {
            const img = document.querySelector('.game-card .game-card-thumb');
            return img ? { src: img.currentSrc || img.src, natural: img.naturalWidth + 'x' + img.naturalHeight, complete: img.complete } : null;
        });
        if (!firstThumb) fail('no .game-card-thumb <img> found');
        else if (!firstThumb.complete || firstThumb.natural === '0x0') {
            fail('first thumbnail failed to load: ' + JSON.stringify(firstThumb));
        } else {
            ok('first thumbnail loaded: ' + firstThumb.src + ' (' + firstThumb.natural + ')');
        }

        // Register modal opens on click?
        // Note: we don't actually submit — just confirm the form elements
        // are present, proving auth.js wired up.
        const authOk = await page.evaluate(() => !!document.querySelector('#loginUsername'));
        if (!authOk) fail('#loginUsername missing — auth UI did not wire up');
        else ok('auth form elements present');

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
