#!/usr/bin/env node
'use strict';

/**
 * verify-assets.js — Asset completeness check.
 * Verifies all 100 games have:
 *   1. Valid game definition entry
 *   2. Generated HTML page
 *   3. Required config fields
 *   4. Valid RTP range (88-93.5%)
 *   5. Valid symbols and payouts
 */

const fs = require('fs');
const path = require('path');

const gameDefs = require('../shared/game-definitions');
const games = Array.isArray(gameDefs) ? gameDefs : (gameDefs.GAMES || gameDefs.games || gameDefs.default || []);

const gamesDir = path.join(__dirname, '..', 'games');
const REQUIRED_FIELDS = ['id', 'name', 'provider', 'symbols', 'gridCols', 'gridRows', 'winType', 'rtp', 'volatility', 'payouts'];

let errors = 0;
let warnings = 0;

console.log('\n  ═══ Asset Completeness Check ═══\n');

// 1. Total game count
console.log(`  Game definitions: ${games.length}`);
if (games.length !== 100) {
    console.log(`  ❌ Expected 100 games, found ${games.length}`);
    errors++;
}

// 2. Check each game
const seenIds = new Set();
games.forEach((game, idx) => {
    const prefix = `  [${idx + 1}] ${game.id || 'UNKNOWN'}:`;

    // Duplicate ID check
    if (seenIds.has(game.id)) {
        console.log(`${prefix} ❌ Duplicate game ID`);
        errors++;
    }
    seenIds.add(game.id);

    // Required fields
    for (const field of REQUIRED_FIELDS) {
        if (!game[field] && game[field] !== 0) {
            console.log(`${prefix} ❌ Missing field: ${field}`);
            errors++;
        }
    }

    // RTP range
    if (game.rtp < 88 || game.rtp > 93.5) {
        console.log(`${prefix} ❌ RTP ${game.rtp}% out of range (88-93.5%)`);
        errors++;
    }

    // Symbols check
    if (!game.symbols || game.symbols.length < 3) {
        console.log(`${prefix} ⚠ Only ${(game.symbols || []).length} symbols`);
        warnings++;
    }

    // HTML page check
    const htmlPath = path.join(gamesDir, game.id + '.html');
    if (!fs.existsSync(htmlPath)) {
        console.log(`${prefix} ❌ Missing HTML page: games/${game.id}.html`);
        errors++;
    } else {
        const html = fs.readFileSync(htmlPath, 'utf8');
        if (html.length < 1000) {
            console.log(`${prefix} ⚠ HTML page suspiciously small (${html.length} bytes)`);
            warnings++;
        }
        if (!html.includes('data-studio=')) {
            console.log(`${prefix} ⚠ No data-studio attribute in HTML`);
            warnings++;
        }
    }
});

// 3. Orphaned HTML pages
const htmlFiles = fs.readdirSync(gamesDir).filter(f => f.endsWith('.html'));
const gameIds = new Set(games.map(g => g.id));
htmlFiles.forEach(f => {
    const id = f.replace('.html', '');
    if (!gameIds.has(id)) {
        console.log(`  ⚠ Orphaned HTML page: games/${f}`);
        warnings++;
    }
});

// 4. Provider distribution
const providers = {};
games.forEach(g => { providers[g.provider] = (providers[g.provider] || 0) + 1; });
console.log('\n  Provider distribution:');
Object.entries(providers).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`    ${name}: ${count} games`);
});

// 5. Summary
console.log(`\n  HTML pages: ${htmlFiles.length}`);
console.log(`  Errors: ${errors}`);
console.log(`  Warnings: ${warnings}`);
console.log(`  Status: ${errors === 0 ? '✅ PASS' : '❌ FAIL'}\n`);

process.exit(errors > 0 ? 1 : 0);
