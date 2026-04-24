#!/usr/bin/env node
'use strict';

/**
 * One-shot script: measure each game's actual coefficient of variation
 * over 2,000 spins and patch shared/game-definitions.js so
 * game.volatility matches reality.
 *
 * Because our engine caps max win at MAX_WIN_MULTIPLIER = 200x, no
 * game in the catalog can exhibit true "very high" volatility the way
 * uncapped slots with 10,000x+ caps do. Auto-aligning the label is
 * the compliant thing to do — licensed regulators treat a "HIGH
 * VOLATILITY" sticker on a game that actually plays "LOW" as
 * misrepresentation.
 *
 * Writes the updated file in place. Run once; re-runs are idempotent
 * (they only change labels that disagree with measurement).
 */

const fs = require('fs');
const path = require('path');
const engine = require(path.join(__dirname, '..', 'server', 'services', 'game-engine'));
const houseEdge = require(path.join(__dirname, '..', 'server', 'services', 'house-edge'));
const games = require(path.join(__dirname, '..', 'shared', 'game-definitions'));

const DEF_PATH = path.join(__dirname, '..', 'shared', 'game-definitions.js');
const N = 2000;

// CV bands calibrated to our 200x cap (same as audit-volatility.js)
const BANDS = [
    { name: 'low',         max: 1.0 },
    { name: 'medium',      max: 1.8 },
    { name: 'medium-high', max: 2.8 },
    { name: 'high',        max: 5.0 },
    { name: 'very high',   max: Infinity }
];
function bandFor(cv) {
    for (const b of BANDS) if (cv < b.max) return b.name;
    return 'very high';
}

async function measureGame(game) {
    const bet = game.minBet || 0.20;
    const stats = { total_spins: 0, total_wagered: 0, total_paid: 0 };
    let fs = null;
    const wins = [];
    for (let i = 0; i < N; i++) {
        stats.total_spins++;
        stats.total_wagered += bet;
        try {
            const r = await engine.resolveSpin(game, bet, stats, fs, null);
            let w = r.winAmount;
            if (w > 0) w = await houseEdge.capWinAmount(w, bet, game, null);
            if (typeof w === 'number' && isFinite(w)) {
                if (w > 0) { wins.push(w / bet); stats.total_paid += w; }
                fs = r.freeSpinState;
            }
        } catch (_) { /* skip */ }
    }
    if (wins.length < 30) return null;
    const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
    const varSum = wins.reduce((s, w) => s + (w - mean) * (w - mean), 0);
    const stdDev = Math.sqrt(varSum / wins.length);
    const cv = mean > 0 ? stdDev / mean : 0;
    return { cv, band: bandFor(cv) };
}

(async () => {
    console.log(`Measuring ${games.length} games × ${N} spins each…\n`);
    const updates = [];
    let idx = 0;
    for (const game of games) {
        idx++;
        const m = await measureGame(game);
        if (!m) {
            console.log(`[${idx}/${games.length}] ${game.id.padEnd(24)} — skip (insufficient wins)`);
            continue;
        }
        const declared = (game.volatility || '').toLowerCase();
        const match = declared === m.band;
        console.log(`[${idx}/${games.length}] ${game.id.padEnd(24)} CV=${m.cv.toFixed(2).padStart(5)} → ${m.band.padEnd(11)} ${match ? '(ok)' : `was "${declared}"`}`);
        if (!match) updates.push({ id: game.id, from: declared, to: m.band });
    }

    if (updates.length === 0) {
        console.log('\nNo updates needed — all labels already match.');
        return;
    }

    console.log(`\n${updates.length} games need label updates. Patching ${DEF_PATH}…`);
    let src = fs.readFileSync(DEF_PATH, 'utf8');
    let patched = 0;
    for (const u of updates) {
        // Match `id: 'xxx'` … `volatility: 'yyy'` on the same game object
        const idRe = new RegExp(`(id:\\s*'${u.id}'[^{}]*?volatility:\\s*)'[^']*'`, 's');
        const before = src;
        src = src.replace(idRe, `$1'${u.to}'`);
        if (src !== before) patched++;
    }
    fs.writeFileSync(DEF_PATH, src);
    console.log(`Patched ${patched}/${updates.length} entries.`);
    if (patched !== updates.length) {
        console.warn('WARNING: some updates could not be applied. Review manually.');
        updates.forEach(u => console.warn(`  ${u.id}: ${u.from} → ${u.to}`));
    }
})().catch(e => { console.error(e); process.exit(1); });
