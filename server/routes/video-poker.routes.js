'use strict';

/**
 * Video Poker — Jacks or Better.
 *
 * Single-coin paytable (multiplied by `coins` 1..5; coins=5 unlocks RF jackpot 800):
 *    Royal Flush       250  (×5 → 4000 jackpot relative; we still apply 800x as table base)
 *    Straight Flush    50
 *    Four of a Kind    25
 *    Full House        9
 *    Flush             6
 *    Straight          4
 *    Three of a Kind   3
 *    Two Pair          2
 *    Jacks or Better   1
 *
 * Per spec the table is in BB-multiples per coin. Implementation note:
 *   - `coins` is 1..5
 *   - `bet` per coin = baseBet (default $1, configurable)
 *   - total bet = baseBet * coins
 *   - payout = baseBet * paytable[hand] * (coins for normal hands)
 *   - Royal Flush at coins=5 pays 800x total bet (industry jackpot)
 *
 * Endpoints:
 *   POST /api/video-poker/deal     { baseBet, coins }                → 5 cards, hand id
 *   POST /api/video-poker/draw     { holds: [bool,bool,bool,bool,bool] } → replace + settle
 *   POST /api/video-poker/gamble/start   → flip face-down card, offer red/black guess
 *   POST /api/video-poker/gamble/guess   { color: 'red'|'black' }     → resolve
 *   POST /api/video-poker/gamble/collect → bank current gamble pot
 *
 * Game state persisted in-memory keyed by user (one open hand per user).
 * On server restart open hands are forfeited — credit is already debited at
 * deal time, but no payout was due yet so this is a clean reset.
 */

const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const cards = require('../services/cards.service');
const tg = require('../services/table-games.service');

const router = express.Router();

const GAME_ID = 'video-poker';
const MIN_BASE_BET = 0.25;
const MAX_BASE_BET = 25;
const MAX_GAMBLE_DOUBLES = 5;

// Per-coin paytable (Jacks or Better — 9/6 schedule)
const PAYTABLE = {
    royal_flush: 250,
    straight_flush: 50,
    four_kind: 25,
    full_house: 9,
    flush: 6,
    straight: 4,
    three_kind: 3,
    two_pair: 2,
    jacks_or_better: 1,
    nothing: 0,
};
const HAND_LABEL = {
    royal_flush: 'Royal Flush',
    straight_flush: 'Straight Flush',
    four_kind: 'Four of a Kind',
    full_house: 'Full House',
    flush: 'Flush',
    straight: 'Straight',
    three_kind: 'Three of a Kind',
    two_pair: 'Two Pair',
    jacks_or_better: 'Jacks or Better',
    nothing: 'No Win',
};

// In-memory open hands. Map<userId, state>
const openHands = new Map();
setInterval(() => {
    // Garbage collect hands idle > 30 min
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of openHands.entries()) {
        if ((v.updated || 0) < cutoff) openHands.delete(k);
    }
}, 5 * 60 * 1000).unref();

// ── Hand evaluation ──────────────────────────────────────────────────────
const RANK_VAL = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function evaluate(hand) {
    if (!hand || hand.length !== 5) return 'nothing';
    const ranks = hand.map(c => RANK_VAL[c.r]).sort((a, b) => a - b);
    const suits = hand.map(c => c.s);
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.entries(counts).map(([r, c]) => ({ r: Number(r), c })).sort((a, b) => b.c - a.c || b.r - a.r);

    const flush = suits.every(s => s === suits[0]);
    let straight = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
    // Wheel straight: A,2,3,4,5
    if (!straight && ranks.join(',') === '2,3,4,5,14') straight = true;
    const isRoyal = flush && ranks.join(',') === '10,11,12,13,14';

    if (isRoyal) return 'royal_flush';
    if (straight && flush) return 'straight_flush';
    if (groups[0].c === 4) return 'four_kind';
    if (groups[0].c === 3 && groups[1] && groups[1].c === 2) return 'full_house';
    if (flush) return 'flush';
    if (straight) return 'straight';
    if (groups[0].c === 3) return 'three_kind';
    if (groups[0].c === 2 && groups[1] && groups[1].c === 2) return 'two_pair';
    if (groups[0].c === 2 && groups[0].r >= 11) return 'jacks_or_better';
    return 'nothing';
}

function payoutFor(handRank, baseBet, coins) {
    if (handRank === 'nothing') return 0;
    if (handRank === 'royal_flush' && coins === 5) {
        // Industry jackpot: 800 × total bet (= 800 × baseBet × 5 = 4000 × baseBet)
        return baseBet * 5 * 800;
    }
    return baseBet * PAYTABLE[handRank] * coins;
}

// ── Routes ───────────────────────────────────────────────────────────────
router.post('/deal', authenticate, async (req, res) => {
    try {
        await tg.ensureSchema();
        const userId = req.user.id;
        const baseBet = parseFloat(req.body.baseBet);
        const coins = parseInt(req.body.coins, 10);

        if (!Number.isFinite(baseBet) || baseBet < MIN_BASE_BET || baseBet > MAX_BASE_BET) {
            return res.status(400).json({ error: `Base bet must be $${MIN_BASE_BET}–$${MAX_BASE_BET}.` });
        }
        if (![1, 2, 3, 4, 5].includes(coins)) {
            return res.status(400).json({ error: 'Coins must be 1–5.' });
        }
        const totalBet = baseBet * coins;
        const pf = await tg.preflightWager(userId, totalBet);
        if (!pf.ok) return res.status(pf.status).json({ error: pf.error });

        const debit = await tg.debitBalance(userId, totalBet);
        if (!debit.ok) return res.status(400).json({ error: debit.error || 'Insufficient balance.' });

        const deck = cards.freshShoe(1);
        const hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

        openHands.set(userId, {
            phase: 'draw',
            baseBet, coins, totalBet,
            deck, hand,
            updated: Date.now(),
        });

        const balance = await tg.getBalance(userId);
        res.json({ phase: 'draw', hand, baseBet, coins, totalBet, balance });
    } catch (err) {
        console.error('[VP /deal]', err);
        res.status(500).json({ error: 'Deal failed', detail: err.message });
    }
});

router.post('/draw', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const state = openHands.get(userId);
        if (!state || state.phase !== 'draw') return res.status(400).json({ error: 'No hand to draw on.' });
        const holds = req.body.holds;
        if (!Array.isArray(holds) || holds.length !== 5) return res.status(400).json({ error: 'holds must be an array of 5 booleans.' });

        for (let i = 0; i < 5; i++) {
            if (!holds[i]) state.hand[i] = state.deck.pop();
        }

        const handRank = evaluate(state.hand);
        const winAmount = payoutFor(handRank, state.baseBet, state.coins);

        if (winAmount > 0) await tg.creditBalance(userId, winAmount);

        await tg.recordRound(userId, GAME_ID, state.totalBet, winAmount, {
            initialBet: state.totalBet, coins: state.coins, handRank, hand: state.hand,
        });

        if (winAmount > 0) {
            // Move to gamble-eligible state: hold winnings as gamble pot
            state.phase = 'won';
            state.handRank = handRank;
            state.handLabel = HAND_LABEL[handRank];
            state.winAmount = winAmount;
            state.gamblePot = winAmount;
            state.gambleDoubles = 0;
            openHands.set(userId, state);
        } else {
            openHands.delete(userId);
        }

        const balance = await tg.getBalance(userId);
        res.json({
            phase: state.phase || 'idle',
            hand: state.hand,
            handRank,
            handLabel: HAND_LABEL[handRank],
            winAmount,
            balance,
            canGamble: winAmount > 0 && state.gambleDoubles < MAX_GAMBLE_DOUBLES,
            gamblePot: state.gamblePot || 0,
            gambleDoubles: state.gambleDoubles || 0,
        });
    } catch (err) {
        console.error('[VP /draw]', err);
        res.status(500).json({ error: 'Draw failed', detail: err.message });
    }
});

// Gamble (double-or-nothing): card flip — guess colour
router.post('/gamble/start', authenticate, async (req, res) => {
    const userId = req.user.id;
    const state = openHands.get(userId);
    if (!state || state.phase !== 'won' || state.gamblePot <= 0) {
        return res.status(400).json({ error: 'Nothing to gamble.' });
    }
    if (state.gambleDoubles >= MAX_GAMBLE_DOUBLES) {
        return res.status(400).json({ error: 'Gamble limit reached.' });
    }
    // Pre-flight gamble wager (the gamble pot) against RG controls
    const pf = await tg.preflightWager(userId, state.gamblePot);
    if (!pf.ok) return res.status(pf.status).json({ error: pf.error });

    // Withdraw gamble pot from balance — it was credited on the win, now goes back at risk.
    const debit = await tg.debitBalance(userId, state.gamblePot);
    if (!debit.ok) return res.status(400).json({ error: 'Insufficient balance to gamble.' });

    // Reveal hidden card on next /guess; we draw it now and store secretly
    const deck = cards.freshShoe(1);
    state.gambleCard = deck.pop();
    state.phase = 'gambling';
    openHands.set(userId, state);

    res.json({ phase: 'gambling', gamblePot: state.gamblePot, gambleDoubles: state.gambleDoubles });
});

router.post('/gamble/guess', authenticate, async (req, res) => {
    const userId = req.user.id;
    const state = openHands.get(userId);
    if (!state || state.phase !== 'gambling' || !state.gambleCard) {
        return res.status(400).json({ error: 'No active gamble.' });
    }
    const guess = String(req.body.color || '').toLowerCase();
    if (guess !== 'red' && guess !== 'black') return res.status(400).json({ error: 'Guess must be red or black.' });

    const card = state.gambleCard;
    const cardColor = cards.isRedSuit(card.s) ? 'red' : 'black';
    const won = guess === cardColor;
    let gamblePot = state.gamblePot;
    state.gambleDoubles++;

    if (won) {
        gamblePot *= 2;
        state.gamblePot = gamblePot;
        // Record the gamble round
        await tg.recordRound(userId, GAME_ID, state.gamblePot / 2, state.gamblePot, {
            gamble: true, guess, card, won: true,
        });
        if (state.gambleDoubles >= MAX_GAMBLE_DOUBLES) {
            // Auto-collect at cap
            await tg.creditBalance(userId, gamblePot);
            openHands.delete(userId);
            const balance = await tg.getBalance(userId);
            return res.json({ phase: 'collected', won: true, card, cardColor, gamblePot, autoCollected: true, balance });
        }
        state.phase = 'won';
        openHands.set(userId, state);
        const balance = await tg.getBalance(userId);
        return res.json({ phase: 'won', won: true, card, cardColor, gamblePot, balance, canGamble: true, gambleDoubles: state.gambleDoubles });
    } else {
        await tg.recordRound(userId, GAME_ID, state.gamblePot, 0, { gamble: true, guess, card, won: false });
        openHands.delete(userId);
        const balance = await tg.getBalance(userId);
        return res.json({ phase: 'lost', won: false, card, cardColor, gamblePot: 0, balance });
    }
});

router.post('/gamble/collect', authenticate, async (req, res) => {
    const userId = req.user.id;
    const state = openHands.get(userId);
    if (!state || state.phase !== 'won' || state.gamblePot <= 0) {
        return res.status(400).json({ error: 'Nothing to collect.' });
    }
    await tg.creditBalance(userId, state.gamblePot);
    const collected = state.gamblePot;
    openHands.delete(userId);
    const balance = await tg.getBalance(userId);
    res.json({ phase: 'collected', gamblePot: collected, balance });
});

router.get('/state', authenticate, async (req, res) => {
    await tg.ensureSchema();
    const state = openHands.get(req.user.id);
    const balance = await tg.getBalance(req.user.id);
    if (!state) return res.json({ state: null, balance, paytable: PAYTABLE });
    res.json({
        state: {
            phase: state.phase,
            hand: state.hand,
            baseBet: state.baseBet,
            coins: state.coins,
            handRank: state.handRank || null,
            handLabel: state.handLabel || null,
            winAmount: state.winAmount || 0,
            gamblePot: state.gamblePot || 0,
            gambleDoubles: state.gambleDoubles || 0,
        },
        balance,
        paytable: PAYTABLE,
    });
});

module.exports = router;
