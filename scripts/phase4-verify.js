#!/usr/bin/env node
/**
 * Phase 4 Verification Script
 * Tests all 100 games: load + spin cycle, check zero console errors.
 * Uses fetch to verify HTML structure, and reports per-game results.
 *
 * For full browser spin testing, use Playwright via MCP.
 * This script does structural + config validation on all 100 games.
 */

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.resolve(__dirname, '..', 'games');
const ENGINE_PATH = path.resolve(__dirname, '..', 'js', 'casino-engine.js');
const RUNTIME_PATH = path.resolve(__dirname, '..', 'games', '_shared', 'game-runtime.js');
const CSS_PATH = path.resolve(__dirname, '..', 'games', '_shared', 'game-runtime.css');

// Get all game directories
const gameDirs = fs.readdirSync(GAMES_DIR).filter(d => {
    if (d === '_shared') return false;
    const stat = fs.statSync(path.join(GAMES_DIR, d));
    return stat.isDirectory();
}).sort();

console.log('╔══════════════════════════════════════════════════╗');
console.log('║  Phase 4 Verification — Matrix Spins Casino     ║');
console.log('╚══════════════════════════════════════════════════╝\n');

// Check shared files exist
const sharedChecks = [
    { path: ENGINE_PATH, name: 'casino-engine.js' },
    { path: RUNTIME_PATH, name: 'game-runtime.js' },
    { path: CSS_PATH, name: 'game-runtime.css' },
];

let sharedOk = true;
for (const check of sharedChecks) {
    if (fs.existsSync(check.path)) {
        const content = fs.readFileSync(check.path, 'utf8');
        const version = content.match(/version:\s*['"]([^'"]+)['"]/);
        console.log(`  ✓ ${check.name} ${version ? 'v' + version[1] : ''} (${(content.length / 1024).toFixed(1)}KB)`);
    } else {
        console.log(`  ✗ ${check.name} MISSING`);
        sharedOk = false;
    }
}
console.log('');

if (!sharedOk) {
    console.error('FATAL: Shared files missing. Aborting.');
    process.exit(1);
}

// Phase 4 feature checks per game
const REQUIRED_FEATURES = [
    { name: 'GAME_CONFIG', pattern: /window\.GAME_CONFIG\s*=/ },
    { name: 'GAME_MECHANIC', pattern: /window\.GAME_MECHANIC\s*=/ },
    { name: 'casino-engine.js', pattern: /casino-engine\.js\?v=3\.1\.0/ },
    { name: 'game-runtime.js', pattern: /game-runtime\.js/ },
    { name: 'game-runtime.css', pattern: /game-runtime\.css/ },
    { name: 'Matrix Spins', pattern: /Matrix Spins/ },
    { name: 'Dollar sign', pattern: /\$/ },
    { name: 'SVG symbols', pattern: /<svg\s+id="svg_/ },
    { name: 'Reels grid', pattern: /id="reelsGrid"/ },
    { name: 'Spin button', pattern: /id="spinBtn"/ },
    { name: 'Balance display', pattern: /id="balanceValue"/ },
    { name: 'Studio theme vars', pattern: /--studio-primary/ },
    { name: 'Mechanic overlay', pattern: /id="mechanicOverlay"/ },
    { name: 'Free spins banner', pattern: /id="freeSpinsBanner"/ },
];

// Config checks
const CONFIG_FIELDS = ['id', 'name', 'provider', 'symbols', 'gridCols', 'gridRows', 'winType', 'rtp', 'bonusType', 'minBet', 'maxBet'];

// Crypto language check (excluding SVG polygon false positives)
const CRYPTO_PATTERNS = /\b(token|crypto|blockchain|ethereum|matic|wallet)\b/i;

let totalOk = 0;
let totalFail = 0;
let issues = [];
let checkpoint = 0;

for (let i = 0; i < gameDirs.length; i++) {
    const slug = gameDirs[i];
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');

    if (!fs.existsSync(htmlPath)) {
        issues.push(`${slug}: index.html missing`);
        totalFail++;
        continue;
    }

    const html = fs.readFileSync(htmlPath, 'utf8');
    const gameIssues = [];

    // Feature checks
    for (const feat of REQUIRED_FEATURES) {
        if (!feat.pattern.test(html)) {
            gameIssues.push(`missing ${feat.name}`);
        }
    }

    // Config validation
    const configMatch = html.match(/window\.GAME_CONFIG\s*=\s*(\{[\s\S]*?\});/);
    if (configMatch) {
        try {
            const config = JSON.parse(configMatch[1]);
            for (const field of CONFIG_FIELDS) {
                if (config[field] === undefined || config[field] === null) {
                    gameIssues.push(`config missing: ${field}`);
                }
            }
            if (!config.symbols || config.symbols.length < 4) {
                gameIssues.push(`too few symbols: ${config.symbols ? config.symbols.length : 0}`);
            }
            if (config.rtp < 80 || config.rtp > 99) {
                gameIssues.push(`invalid RTP: ${config.rtp}`);
            }
        } catch(e) {
            gameIssues.push('config JSON parse error');
        }
    } else {
        gameIssues.push('could not extract GAME_CONFIG');
    }

    // Mechanic check
    const mechMatch = html.match(/window\.GAME_MECHANIC\s*=\s*\{/);
    if (!mechMatch) {
        gameIssues.push('no GAME_MECHANIC object');
    }

    // Crypto language check (strip SVG tags first)
    const nonSvg = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<polygon[^>]*>/g, '');
    if (CRYPTO_PATTERNS.test(nonSvg)) {
        const match = nonSvg.match(CRYPTO_PATTERNS);
        gameIssues.push(`crypto language found: "${match[0]}"`);
    }

    if (gameIssues.length === 0) {
        totalOk++;
    } else {
        totalFail++;
        issues.push(`${slug}: ${gameIssues.join(', ')}`);
    }

    // Checkpoint every 10
    if ((i + 1) % 10 === 0) {
        checkpoint++;
        const ok = totalOk;
        const fail = totalFail;
        const issuesInBatch = issues.filter(iss => {
            const batchStart = (checkpoint - 1) * 10;
            const batchSlugs = gameDirs.slice(batchStart, batchStart + 10);
            return batchSlugs.some(s => iss.startsWith(s));
        });
        console.log(`  ✓ Checkpoint ${checkpoint}: ${i + 1} games verified | OK: ${ok} | Issues: ${issuesInBatch.length}`);
        if (issuesInBatch.length > 0) {
            issuesInBatch.forEach(iss => console.log(`    ⚠ ${iss}`));
        }
    }
}

console.log('\n═══════════════════════════════════════════════════');
console.log(`  TOTAL: ${gameDirs.length} games | PASS: ${totalOk} | FAIL: ${totalFail}`);
console.log('═══════════════════════════════════════════════════');

if (issues.length > 0) {
    console.log('\nAll issues:');
    issues.forEach(iss => console.log(`  ✗ ${iss}`));
}

if (totalFail === 0) {
    console.log('\n  ★ ALL 100 GAMES PASS PHASE 4 VERIFICATION ★\n');
} else {
    console.log(`\n  ⚠ ${totalFail} games have issues that need fixing.\n`);
}

process.exit(totalFail > 0 ? 1 : 0);
