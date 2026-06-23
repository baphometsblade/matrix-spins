#!/usr/bin/env node
'use strict';

/**
 * add-game-favicon.js — idempotent favicon injector for slot game pages.
 *
 * Every games/*.html (and its served dist/games/*.html mirror) was generated
 * without a favicon <link>, so browsers fell back to GET /favicon.ico → 404
 * (console noise on all 120 game pages). The repo already ships /favicon.svg.
 *
 * This inserts exactly one line — immediately after the page <title> — into
 * each game page that lacks any <link rel="icon">:
 *
 *   <link rel="icon" type="image/svg+xml" href="/favicon.svg">
 *
 * Idempotent: re-running is a no-op for files that already have the link.
 * Mirrors the change into dist/games/* (the live-served copy — server/index.js
 * serves dist/ before the source root) so the fix is live without a full
 * `npm run build` (which would re-stamp dist/sw.js and collide with concurrent
 * work).
 *
 * Usage: node scripts/add-game-favicon.js [--check]
 *   --check  exit 1 if any game page is still missing the link (CI guard)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FAVICON_LINK = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
const HAS_ICON = /<link[^>]+rel=["']icon["']/i;
const TITLE_LINE = /^([ \t]*)<title>[\s\S]*?<\/title>[ \t]*\r?\n/m;

function gamePages(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.html'))
        .map(f => path.join(dir, f));
}

function patchFile(file, checkOnly) {
    const html = fs.readFileSync(file, 'utf8');
    if (HAS_ICON.test(html)) return 'skip';      // already has a favicon link
    if (checkOnly) return 'missing';

    const m = html.match(TITLE_LINE);
    if (!m) return 'notitle';                     // no <title> — leave untouched, report

    const indent = m[1] || '  ';
    const insertion = `${m[0]}${indent}${FAVICON_LINK}\n`;
    const out = html.replace(TITLE_LINE, insertion);
    fs.writeFileSync(file, out, 'utf8');
    return 'patched';
}

function main() {
    const checkOnly = process.argv.includes('--check');

    // Source pages + their served dist mirror. Only patch the dist file that
    // actually corresponds to a source game (matches what `npm run build`
    // would copy — leaves unrelated/orphan dist pages alone).
    const srcDir = path.join(ROOT, 'games');
    const distDir = path.join(ROOT, 'dist', 'games');

    const targets = [];
    for (const src of gamePages(srcDir)) {
        targets.push(src);
        const distTwin = path.join(distDir, path.basename(src));
        if (fs.existsSync(distTwin)) targets.push(distTwin);
    }

    const tally = { patched: 0, skip: 0, missing: 0, notitle: 0 };
    const problems = [];
    for (const file of targets) {
        const r = patchFile(file, checkOnly);
        tally[r] = (tally[r] || 0) + 1;
        if (r === 'notitle') problems.push(path.relative(ROOT, file));
    }

    const rel = p => path.relative(ROOT, p);
    console.log(`[favicon] scanned ${targets.length} game pages ` +
        `(${rel(srcDir)} + ${rel(distDir)})`);
    if (checkOnly) {
        console.log(`[favicon] ${tally.skip} ok, ${tally.missing} missing`);
        if (tally.missing > 0) {
            console.error(`[favicon] FAIL: ${tally.missing} game page(s) lack a favicon link`);
            process.exit(1);
        }
        console.log('[favicon] OK — every game page has a favicon link');
        return;
    }

    console.log(`[favicon] patched ${tally.patched}, already-present ${tally.skip}`);
    if (problems.length) {
        console.warn(`[favicon] WARN: ${problems.length} file(s) had no <title>, skipped:`);
        problems.forEach(p => console.warn(`  - ${p}`));
    }
}

main();
