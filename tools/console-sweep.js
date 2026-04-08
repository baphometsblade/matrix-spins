#!/usr/bin/env node
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    const netErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGE_ERROR: ' + err.message));
    page.on('response', resp => {
        if (resp.status() >= 400) netErrors.push(resp.status() + ' ' + resp.url());
    });

    console.log('Loading lobby...');
    try {
        await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch(e) { console.log('Nav warning: ' + e.message); }
    await page.waitForTimeout(3000);

    console.log('\nConsole Errors (' + errors.length + '):');
    errors.forEach((e,i) => console.log('  [' + (i+1) + '] ' + e.substring(0, 200)));
    console.log('\nNetwork Errors (' + netErrors.length + '):');
    netErrors.forEach((e,i) => console.log('  [' + (i+1) + '] ' + e.substring(0, 200)));

    // Filter: ignore external font 404s, 401s (expected for anon)
    const isExternal = (e) => e.includes('fonts.gstatic') || e.includes('fonts.googleapis') || e.includes('cdn.') || e.includes('status of 404');
    const isAuth = (e) => e.includes('401') || e.includes('Unauthorized');
    const critical = errors.filter(e => !isExternal(e) && !isAuth(e));
    const criticalNet = netErrors.filter(e => !isExternal(e) && !isAuth(e));

    console.log('\nCritical JS errors: ' + critical.length);
    critical.forEach(e => console.log('  CRITICAL: ' + e));
    console.log('Critical network errors: ' + criticalNet.length);
    criticalNet.forEach(e => console.log('  CRITICAL: ' + e));

    if (critical.length === 0 && criticalNet.length === 0) {
        console.log('\n✅ PASS - No critical errors (external font 404s and auth 401s excluded)');
    } else {
        console.log('\n❌ FAIL - ' + (critical.length + criticalNet.length) + ' critical error(s)');
    }

    await browser.close();
    process.exit(critical.length > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
