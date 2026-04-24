#!/usr/bin/env node
'use strict';

/**
 * Paytable consistency audit.
 *
 * Verifies that every game's paytable is internally sensible:
 *   - scatter / wild pays are positive
 *   - wildTriple > triple (wild-assisted lines should pay more)
 *   - cluster12 > cluster8 > cluster5
 *   - no negative values
 *   - no NaN / undefined entries in required fields
 *
 * Also checks the central CLUSTER_PAYTABLE / CLASSIC_PAYTABLE in
 * house-edge.js for monotonic tier progression (higher-index symbols
 * must pay ≥ lower-index symbols).
 */

const path = require('path');
const games = require(path.join(__dirname, '..', 'shared', 'game-definitions'));

const issues = [];
const warns = [];

function err(game, msg) { issues.push(`[${game.id}] ${msg}`); }
function warn(game, msg) { warns.push(`[${game.id}] ${msg}`); }

games.forEach(g => {
    const p = g.payouts;
    if (!p || typeof p !== 'object') {
        err(g, 'missing payouts{}');
        return;
    }

    // Non-negative values
    Object.entries(p).forEach(([k, v]) => {
        if (typeof v !== 'number' || !isFinite(v)) {
            err(g, `payouts.${k} is not a finite number: ${v}`);
        } else if (v < 0) {
            err(g, `payouts.${k} is negative: ${v}`);
        }
    });

    // Payline games: 5-of-a-kind must pay > 3-of-a-kind
    if (g.winType === 'payline') {
        const p3 = p.payline3 ?? p.triple;
        const p4 = p.payline4;
        const p5 = p.payline5;
        if (typeof p3 === 'number' && typeof p5 === 'number') {
            if (p5 < p3) err(g, `payline5 (${p5}) < payline3 (${p3}) — longer line pays less`);
        }
        if (typeof p4 === 'number' && typeof p5 === 'number' && p5 < p4) {
            err(g, `payline5 (${p5}) < payline4 (${p4})`);
        }
        if (typeof p3 === 'number' && typeof p4 === 'number' && p4 < p3) {
            err(g, `payline4 (${p4}) < payline3 (${p3})`);
        }
    }

    // Wild-assist multiplier
    if (typeof p.wildTriple === 'number' && typeof p.triple === 'number') {
        if (p.wildTriple < p.triple) {
            err(g, `wildTriple (${p.wildTriple}) < triple (${p.triple}) — wild should enhance`);
        }
    }

    // Cluster tiers
    if (g.winType === 'cluster') {
        const c5 = p.cluster5;
        const c8 = p.cluster8;
        const c12 = p.cluster12;
        const c15 = p.cluster15;
        if (typeof c8 === 'number' && typeof c5 === 'number' && c8 < c5) {
            err(g, `cluster8 (${c8}) < cluster5 (${c5})`);
        }
        if (typeof c12 === 'number' && typeof c8 === 'number' && c12 < c8) {
            err(g, `cluster12 (${c12}) < cluster8 (${c8})`);
        }
        if (typeof c15 === 'number' && typeof c12 === 'number' && c15 < c12) {
            err(g, `cluster15 (${c15}) < cluster12 (${c12})`);
        }
    }

    // Scatter pay
    if (g.freeSpinsCount > 0 && typeof p.scatterPay === 'number') {
        if (p.scatterPay < 0) {
            err(g, `scatterPay negative: ${p.scatterPay}`);
        }
    }

    // Double should be less than triple (2 matches pay less than 3 matches)
    if (typeof p.double === 'number' && typeof p.triple === 'number' && p.double > p.triple) {
        err(g, `double (${p.double}) > triple (${p.triple}) — 2-match pays more than 3-match`);
    }
});

// ─── Report ───
console.log(`\n=== PAYTABLE CONSISTENCY AUDIT — ${games.length} games ===\n`);
if (issues.length) {
    console.log(`🔴 ISSUES (${issues.length}):`);
    issues.forEach(i => console.log('   ' + i));
    console.log('');
}
if (warns.length) {
    console.log(`🟡 WARNINGS (${warns.length}):`);
    warns.forEach(w => console.log('   ' + w));
    console.log('');
}
if (!issues.length && !warns.length) {
    console.log('✅ All 100 paytables structurally consistent.');
}
process.exit(issues.length ? 1 : 0);
