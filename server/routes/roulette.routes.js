'use strict';

/**
 * European Roulette — single zero, 37 pockets (0–36).
 *
 * Endpoints:
 *   GET  /api/roulette/state           → recent results, hot/cold, balance
 *   POST /api/roulette/spin            { bets: [{ type, value?, amount }] } → resolve
 *
 * Bet types & payouts (return = payout multiplier including stake):
 *   straight  value:0..36           pays 36x  (35:1 + stake)
 *   split     value:[a,b]           pays 18x  (17:1)
 *   street    value: row index 0..11 (rows 1-3, 4-6, … 34-36)  pays 12x  (11:1)
 *   corner    value:[a,b,c,d]       pays 9x   (8:1)
 *   line      value: pair-row 0..10 (covers 6 numbers across two rows) pays 6x (5:1)
 *   dozen     value: 1|2|3 (1-12,13-24,25-36) pays 3x (2:1)
 *   column    value: 1|2|3 (top/middle/bottom) pays 3x (2:1)
 *   red / black                                pays 2x (1:1)
 *   even / odd                                 pays 2x (1:1)
 *   high (19-36) / low (1-18)                  pays 2x (1:1)
 *
 * House edge = 1/37 ≈ 2.70% on every fair-pay bet.
 */

const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const tg = require('../services/table-games.service');

const router = express.Router();

const GAME_ID = 'roulette';
const MIN_BET = 0.10;
const MAX_BET_PER_CHIP = 500;
const MAX_TOTAL_BET = 2000;

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function colorOf(n) {
    if (n === 0) return 'green';
    return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// ── Bet validation: returns true if `bet` is a winner, given drawn `n` ────
function betWins(bet, n) {
    const { type, value } = bet;
    if (n === 0) {
        // Only bets that include 0 win on zero
        if (type === 'straight') return Number(value) === 0;
        if (type === 'split' || type === 'street' || type === 'corner' || type === 'line') {
            return Array.isArray(value) ? value.includes(0) : false;
        }
        return false;
    }
    switch (type) {
        case 'straight': return Number(value) === n;
        case 'split': return Array.isArray(value) && value.includes(n);
        case 'street': return Array.isArray(value) && value.includes(n);
        case 'corner': return Array.isArray(value) && value.includes(n);
        case 'line':   return Array.isArray(value) && value.includes(n);
        case 'dozen':  return n >= (value - 1) * 12 + 1 && n <= value * 12;
        case 'column': {
            // Column 1 = 1,4,7…34 (n%3===1), Column 2 = 2,5,…35 (n%3===2), Column 3 = 3,6…36 (n%3===0)
            if (value === 1) return n % 3 === 1;
            if (value === 2) return n % 3 === 2;
            if (value === 3) return n % 3 === 0;
            return false;
        }
        case 'red':   return colorOf(n) === 'red';
        case 'black': return colorOf(n) === 'black';
        case 'even':  return n % 2 === 0;
        case 'odd':   return n % 2 === 1;
        case 'high':  return n >= 19 && n <= 36;
        case 'low':   return n >= 1 && n <= 18;
        default: return false;
    }
}

const PAYOUT = {
    straight: 36, split: 18, street: 12, corner: 9, line: 6,
    dozen: 3, column: 3, red: 2, black: 2, even: 2, odd: 2, high: 2, low: 2,
};

function validateBet(b) {
    if (!b || !b.type) return 'Missing bet type';
    if (!Object.prototype.hasOwnProperty.call(PAYOUT, b.type)) return 'Unknown bet type';
    const amt = parseFloat(b.amount);
    if (!Number.isFinite(amt) || amt < MIN_BET) return `Bet too small (min $${MIN_BET}).`;
    if (amt > MAX_BET_PER_CHIP) return `Bet too large (max $${MAX_BET_PER_CHIP} per chip).`;
    switch (b.type) {
        case 'straight': {
            const v = Number(b.value);
            if (!Number.isInteger(v) || v < 0 || v > 36) return 'Straight bet must target 0–36';
            return null;
        }
        case 'split':
            if (!Array.isArray(b.value) || b.value.length !== 2) return 'Split needs 2 numbers';
            return null;
        case 'street':
            if (!Array.isArray(b.value) || b.value.length !== 3) return 'Street needs 3 numbers';
            return null;
        case 'corner':
            if (!Array.isArray(b.value) || b.value.length !== 4) return 'Corner needs 4 numbers';
            return null;
        case 'line':
            if (!Array.isArray(b.value) || b.value.length !== 6) return 'Line needs 6 numbers';
            return null;
        case 'dozen':
        case 'column':
            if (![1, 2, 3].includes(Number(b.value))) return `${b.type} value must be 1, 2 or 3`;
            return null;
        default:
            return null; // outside bets need no value
    }
}

// ── Hot/cold over the last 50 spins (any user — public table feel) ────────
async function recentNumbers(limit = 20) {
    try {
        const rows = await db.all('SELECT number FROM roulette_history ORDER BY id DESC LIMIT ?', [limit]);
        return rows.map(r => r.number);
    } catch (_) { return []; }
}
async function hotCold(window = 50) {
    try {
        const rows = await db.all('SELECT number FROM roulette_history ORDER BY id DESC LIMIT ?', [window]);
        const counts = new Map();
        for (const r of rows) counts.set(r.number, (counts.get(r.number) || 0) + 1);
        const arr = [...counts.entries()].map(([n, c]) => ({ n, c }));
        arr.sort((a, b) => b.c - a.c);
        return {
            hot: arr.slice(0, 5),
            cold: arr.slice(-5).reverse(),
            sampleSize: rows.length,
        };
    } catch (_) {
        return { hot: [], cold: [], sampleSize: 0 };
    }
}

// ── Routes ────────────────────────────────────────────────────────────────
router.get('/state', authenticate, async (req, res) => {
    try {
        await tg.ensureSchema();
        const [recent, hc, balance] = await Promise.all([
            recentNumbers(20),
            hotCold(50),
            tg.getBalance(req.user.id),
        ]);
        res.json({ recent, hotCold: hc, balance, limits: { minBet: MIN_BET, maxBet: MAX_BET_PER_CHIP, maxTotal: MAX_TOTAL_BET } });
    } catch (err) {
        res.status(500).json({ error: 'state failed', detail: err.message });
    }
});

router.post('/spin', authenticate, async (req, res) => {
    try {
        await tg.ensureSchema();
        const userId = req.user.id;
        const bets = Array.isArray(req.body.bets) ? req.body.bets : [];
        if (bets.length === 0) return res.status(400).json({ error: 'No bets placed.' });
        if (bets.length > 80) return res.status(400).json({ error: 'Too many simultaneous bets (max 80).' });

        let total = 0;
        for (const b of bets) {
            const err = validateBet(b);
            if (err) return res.status(400).json({ error: err });
            total += Number(b.amount);
        }
        total = Math.round(total * 100) / 100;
        if (total < MIN_BET) return res.status(400).json({ error: `Total bet below minimum ($${MIN_BET}).` });
        if (total > MAX_TOTAL_BET) return res.status(400).json({ error: `Total bet exceeds table max ($${MAX_TOTAL_BET}).` });

        const pf = await tg.preflightWager(userId, total);
        if (!pf.ok) return res.status(pf.status).json({ error: pf.error });

        const debit = await tg.debitBalance(userId, total);
        if (!debit.ok) return res.status(400).json({ error: debit.error || 'Insufficient balance.' });

        // Spin: secure RNG 0..36
        const n = crypto.randomInt(0, 37);
        const c = colorOf(n);

        // Settle
        let payout = 0;
        const settled = bets.map((b) => {
            const wins = betWins(b, n);
            const win = wins ? Number(b.amount) * PAYOUT[b.type] : 0;
            payout += win;
            return { ...b, win, hit: wins };
        });
        payout = Math.round(payout * 100) / 100;

        if (payout > 0) await tg.creditBalance(userId, payout);

        // Log roulette history + the unified spins row
        try {
            await db.run('INSERT INTO roulette_history (user_id, number, color, total_bet, total_win) VALUES (?,?,?,?,?)',
                [userId, n, c, total, payout]);
            // Prune to last 200 entries to keep the table small
            await db.run('DELETE FROM roulette_history WHERE id IN (SELECT id FROM roulette_history ORDER BY id DESC LIMIT -1 OFFSET 200)');
        } catch (_) {}

        await tg.recordRound(userId, GAME_ID, total, payout, {
            number: n, color: c, betCount: bets.length, settled,
        });

        const balance = await tg.getBalance(userId);
        const recent = await recentNumbers(20);
        res.json({ number: n, color: c, totalBet: total, totalWin: payout, net: payout - total, settled, balance, recent });
    } catch (err) {
        console.error('[Roulette /spin]', err);
        res.status(500).json({ error: 'Spin failed', detail: err.message });
    }
});

module.exports = router;
