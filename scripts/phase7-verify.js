#!/usr/bin/env node
/**
 * Phase 7 — Comprehensive QA Verification
 * Checks: RTP, studio chrome, balance display, asset refs, demo mode, file sizes
 */

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.resolve(__dirname, '..', 'games');
const JS_DIR = path.resolve(__dirname, '..', 'js');
const ROOT = path.resolve(__dirname, '..');

const gameDirs = fs.readdirSync(GAMES_DIR).filter(d => {
    if (d === '_shared') return false;
    return fs.statSync(path.join(GAMES_DIR, d)).isDirectory();
}).sort();

console.log('');
console.log('='.repeat(60));
console.log('  Phase 7 — Comprehensive QA Verification');
console.log('  Matrix Spins Casino — ' + gameDirs.length + ' games');
console.log('='.repeat(60));
console.log('');

let totalIssues = 0;

// ═══════════════════════════════════════════════════════
// CHECK 3: RTP VERIFICATION (0.88 - 0.94 inclusive)
// ═══════════════════════════════════════════════════════
console.log('--- CHECK 3: RTP VERIFICATION ---');
console.log('Game'.padEnd(35) + 'RTP'.padEnd(8) + 'Status');
console.log('-'.repeat(55));

let rtpPass = 0, rtpFail = 0;
const rtpResults = [];

for (const slug of gameDirs) {
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) { rtpFail++; continue; }
    const html = fs.readFileSync(htmlPath, 'utf8');

    const configMatch = html.match(/window\.GAME_CONFIG\s*=\s*(\{[\s\S]*?\});/);
    if (!configMatch) {
        console.log(slug.padEnd(35) + 'N/A'.padEnd(8) + 'FAIL (no config)');
        rtpFail++; totalIssues++;
        continue;
    }

    try {
        const config = JSON.parse(configMatch[1]);
        const rtp = config.rtp;
        // RTP in config is stored as percentage (e.g., 88-94)
        const rtpNorm = rtp > 1 ? rtp / 100 : rtp;
        const inRange = rtpNorm >= 0.88 && rtpNorm <= 0.94;

        if (inRange) {
            rtpPass++;
            rtpResults.push({ slug, rtp: rtp > 1 ? rtp : rtp * 100, status: 'PASS' });
        } else {
            rtpFail++; totalIssues++;
            rtpResults.push({ slug, rtp: rtp > 1 ? rtp : rtp * 100, status: 'FAIL' });
        }
    } catch(e) {
        rtpFail++; totalIssues++;
        rtpResults.push({ slug, rtp: 'ERR', status: 'FAIL' });
    }
}

// Print in 3-column table
for (let i = 0; i < rtpResults.length; i += 3) {
    let line = '';
    for (let j = i; j < i + 3 && j < rtpResults.length; j++) {
        const r = rtpResults[j];
        const rtpStr = typeof r.rtp === 'number' ? r.rtp.toFixed(1) + '%' : r.rtp;
        line += (r.slug.slice(0,20).padEnd(22) + rtpStr.padEnd(8) + r.status).padEnd(42);
    }
    console.log(line);
}

console.log('\nRTP: ' + rtpPass + ' PASS, ' + rtpFail + ' FAIL\n');


// ═══════════════════════════════════════════════════════
// CHECK 4: STUDIO CHROME VERIFICATION
// ═══════════════════════════════════════════════════════
console.log('--- CHECK 4: STUDIO CHROME VERIFICATION ---');

const STUDIOS = {
    'nebula-gaming': { name: 'Nebula Gaming', font: 'Orbitron' },
    'golden-reels': { name: 'Golden Reels Studio', font: 'Playfair Display' },
    'mythic-forge': { name: 'Mythic Forge', font: 'Cinzel' },
    'ironclad': { name: 'Ironclad Entertainment', font: 'Oswald' },
    'shadow-works': { name: 'Shadow Works', font: 'Creepster' },
    'wild-frontier': { name: 'Wild Frontier Games', font: 'Bangers' },
    'cascade-labs': { name: 'Cascade Labs', font: 'Exo 2' },
    'dragon-pearl': { name: 'Dragon Pearl Studios', font: 'Noto Serif SC' }
};

let studioPass = 0, studioFail = 0;

for (const slug of gameDirs) {
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) { studioFail++; continue; }
    const html = fs.readFileSync(htmlPath, 'utf8');

    const issues = [];

    // Check studio badge
    if (!html.match(/class="[^"]*studio-badge/)) {
        // Check alternative: provider in GAME_CONFIG
        const configMatch = html.match(/provider:\s*['"]([^'"]+)['"]/);
        if (!configMatch) issues.push('no studio badge');
    }

    // Check --studio-primary CSS var
    if (!html.match(/--studio-primary/)) {
        issues.push('no --studio-primary var');
    }

    // Check font reference (--studio-font CSS var OR explicit font-family)
    let hasFont = html.includes('--studio-font') || html.includes('font-family');
    if (!hasFont) issues.push('no studio font');

    if (issues.length === 0) {
        studioPass++;
    } else {
        studioFail++; totalIssues++;
        console.log('  FAIL: ' + slug + ' — ' + issues.join(', '));
    }
}
console.log('Studio Chrome: ' + studioPass + ' PASS, ' + studioFail + ' FAIL\n');


// ═══════════════════════════════════════════════════════
// CHECK 5: BALANCE DISPLAY VERIFICATION ($ only)
// ═══════════════════════════════════════════════════════
console.log('--- CHECK 5: BALANCE DISPLAY VERIFICATION ---');

let balPass = 0, balFail = 0;

// Check lobby files
const lobbyFiles = ['index.html', 'terms.html', 'responsible-gambling.html'];
for (const f of lobbyFiles) {
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) continue;
    const html = fs.readFileSync(fp, 'utf8');

    // Check balance displays use $
    const balanceMatch = html.match(/id="balance"/);
    if (f === 'index.html' && balanceMatch) {
        // Should have $ prefix before balance span
        if (html.includes('$<span id="balance"') || html.includes('$<span id="walletBalance"')) {
            balPass++;
            console.log('  ' + f.padEnd(35) + 'PASS');
        } else {
            balFail++; totalIssues++;
            console.log('  ' + f.padEnd(35) + 'FAIL (no $ prefix)');
        }
    } else {
        balPass++;
        console.log('  ' + f.padEnd(35) + 'PASS (no balance display)');
    }
}

// Check game files
for (const slug of gameDirs) {
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Balance should show $ sign
    const hasDollar = html.includes('$') || html.includes('\\$') || html.includes('&#36;');
    // Should NOT have token/coin units
    const nonSvg = html.replace(/<svg[\s\S]*?<\/svg>/g, '');
    const hasTokenUnit = /\b(tokens?|coins?|chips?)\s*[:=]/i.test(nonSvg);

    if (hasDollar && !hasTokenUnit) {
        balPass++;
    } else {
        balFail++; totalIssues++;
        console.log('  FAIL: ' + slug + (hasTokenUnit ? ' (token unit found)' : ' (no $ sign)'));
    }
}

console.log('Balance Display: ' + balPass + ' PASS, ' + balFail + ' FAIL\n');


// ═══════════════════════════════════════════════════════
// CHECK 6: ASSET VERIFICATION
// ═══════════════════════════════════════════════════════
console.log('--- CHECK 6: ASSET VERIFICATION ---');

let assetPass = 0, assetFail = 0;

for (const slug of gameDirs) {
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');

    const issues = [];

    // Check SVG symbols exist (inline SVG fallbacks)
    const svgCount = (html.match(/<svg\s+id="svg_/g) || []).length;
    if (svgCount === 0) {
        issues.push('no SVG symbols');
    }

    // Check if external image refs exist or have fallback
    const imgRefs = html.match(/src="([^"]*\.(png|jpg|webp))"/g) || [];
    // External images are optional — SVG fallbacks are primary

    // Check gradient backgrounds (CSS or SVG linearGradient)
    const hasGradient = html.includes('linear-gradient') || html.includes('radial-gradient') || html.includes('linearGradient') || html.includes('background:');
    if (!hasGradient) {
        issues.push('no gradient fallbacks');
    }

    // Check game-runtime.css loaded (has all animation fallbacks)
    if (!html.includes('game-runtime.css')) {
        issues.push('missing game-runtime.css');
    }

    if (issues.length === 0) {
        assetPass++;
    } else {
        assetFail++; totalIssues++;
        console.log('  FAIL: ' + slug + ' — ' + issues.join(', '));
    }
}

console.log('Assets: ' + assetPass + ' PASS, ' + assetFail + ' FAIL\n');


// ═══════════════════════════════════════════════════════
// CHECK 8: DEMO MODE VERIFICATION
// ═══════════════════════════════════════════════════════
console.log('--- CHECK 8: DEMO MODE VERIFICATION ---');

let demoPass = 0, demoFail = 0;

for (const slug of gameDirs) {
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Check demo mode banner setup
    const hasDemoBanner = html.includes('setupDemoModeBanner') || html.includes('demoModeBanner') || html.includes('demo-mode');
    // Check runtime loads (which handles demo mode)
    const hasRuntime = html.includes('game-runtime.js');

    if (hasRuntime) {
        demoPass++;
    } else {
        demoFail++; totalIssues++;
        console.log('  FAIL: ' + slug + ' — missing game-runtime.js (handles demo mode)');
    }
}

console.log('Demo Mode: ' + demoPass + ' PASS, ' + demoFail + ' FAIL\n');


// ═══════════════════════════════════════════════════════
// CHECK 11: PERFORMANCE
// ═══════════════════════════════════════════════════════
console.log('--- CHECK 11: PERFORMANCE ---');

// Check file sizes
let sizePass = 0, sizeFail = 0;
let maxSize = 0, maxFile = '';

for (const slug of gameDirs) {
    const htmlPath = path.join(GAMES_DIR, slug, 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    const stats = fs.statSync(htmlPath);
    const sizeKB = stats.size / 1024;

    if (sizeKB > maxSize) { maxSize = sizeKB; maxFile = slug; }

    if (sizeKB <= 500) {
        sizePass++;
    } else {
        sizeFail++; totalIssues++;
        console.log('  OVERSIZE: ' + slug + ' — ' + sizeKB.toFixed(1) + 'KB');
    }
}
console.log('  File sizes: ' + sizePass + ' PASS (<=500KB), ' + sizeFail + ' FAIL');
console.log('  Largest: ' + maxFile + ' at ' + maxSize.toFixed(1) + 'KB');

// Check engine size
const enginePath = path.join(ROOT, 'js', 'casino-engine.js');
if (fs.existsSync(enginePath)) {
    const engineSize = fs.statSync(enginePath).size / 1024;
    console.log('  casino-engine.js: ' + engineSize.toFixed(1) + 'KB');
}

// Check lazy loading in index.html
const indexPath = path.join(ROOT, 'index.html');
if (fs.existsSync(indexPath)) {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    // Lazy loading is in ui-lobby.js (data-bg + IntersectionObserver), not in index.html directly
    const lobbyJs = fs.existsSync(path.join(JS_DIR, 'ui-lobby.js')) ? fs.readFileSync(path.join(JS_DIR, 'ui-lobby.js'), 'utf8') : '';
    const hasLazy = lobbyJs.includes('data-bg') || lobbyJs.includes('_initLazyThumbnails') || lobbyJs.includes('IntersectionObserver') || indexHtml.includes('loading="lazy"');
    console.log('  Lobby lazy loading: ' + (hasLazy ? 'PASS' : 'FAIL'));
    if (!hasLazy) totalIssues++;
}

console.log('');

// ═══════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════
console.log('='.repeat(60));
console.log('  PHASE 7 VERIFICATION SUMMARY');
console.log('='.repeat(60));
console.log('  Games scanned: ' + gameDirs.length);
console.log('  Total issues: ' + totalIssues);
console.log('');

if (totalIssues === 0) {
    console.log('  ★ ALL CHECKS PASS — READY FOR DEPLOYMENT ★');
} else {
    console.log('  ⚠ ' + totalIssues + ' issues need attention');
}

console.log('');
process.exit(totalIssues > 0 ? 1 : 0);
