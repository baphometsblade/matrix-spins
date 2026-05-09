'use strict';

/**
 * Blackjack — full real-money table game.
 *
 * Endpoints (all auth-required):
 *   GET  /api/blackjack/state            → current open hand (or null)
 *   POST /api/blackjack/deal             { bet, perfectPairsBet? } → start hand
 *   POST /api/blackjack/hit              → draw to active hand
 *   POST /api/blackjack/stand            → freeze active hand, advance / settle
 *   POST /api/blackjack/double           → double active hand bet, draw 1, stand
 *   POST /api/blackjack/split            → split a pair into two hands
 *   POST /api/blackjack/insurance        { take: bool } → buy/skip insurance
 *
 * Rules:
 *   - 6-deck shoe, reshuffle when < 25% remain
 *   - Dealer hits soft 17
 *   - Blackjack pays 3:2
 *   - Insurance pays 2:1 (offered only when dealer up = A)
 *   - Double allowed on any first 2 cards (after split too)
 *   - Split allowed once (max 4 ways via re-splits is disabled for clarity)
 *   - Split aces: each ace gets exactly one card, no further hits
 *   - Side bet: Perfect Pairs — only on initial 2-card hand. Pays:
 *       perfect (same rank+suit) 25:1, colored (same rank+color) 12:1,
 *       mixed (same rank, different colors) 6:1
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const cards = require('../services/cards.service');
const tg = require('../services/table-games.service');

const router = express.Router();

const GAME_ID = 'blackjack';
const DECKS = 6;
const RESHUFFLE_BELOW = Math.floor(DECKS * 52 * 0.25); // 25% penetration
const MIN_BET = 1;
const MAX_BET = 500;
const PERFECT_PAIRS_MAX = 100;

// ── Persistent state I/O ──────────────────────────────────────────────────
async function loadState(userId) {
    const row = await db.get('SELECT state_json FROM blackjack_sessions WHERE user_id = ?', [userId]);
    if (!row) return null;
    try { return JSON.parse(row.state_json); } catch (_) { return null; }
}
async function saveState(userId, state) {
    const json = JSON.stringify(state);
    const isPg = typeof db.isPg === 'function' && db.isPg();
    if (isPg) {
        await db.run(
            'INSERT INTO blackjack_sessions (user_id, state_json, updated_at) VALUES (?,?, NOW()) ' +
            'ON CONFLICT (user_id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()',
            [userId, json]
        );
    } else {
        const existed = await db.get('SELECT user_id FROM blackjack_sessions WHERE user_id = ?', [userId]);
        if (existed) {
            await db.run("UPDATE blackjack_sessions SET state_json = ?, updated_at = datetime('now') WHERE user_id = ?", [json, userId]);
        } else {
            await db.run("INSERT INTO blackjack_sessions (user_id, state_json) VALUES (?, ?)", [userId, json]);
        }
    }
}
async function clearState(userId) {
    await db.run('DELETE FROM blackjack_sessions WHERE user_id = ?', [userId]);
}

// ── Shoe management ───────────────────────────────────────────────────────
function ensureShoe(state) {
    if (!state.shoe || state.shoe.length < RESHUFFLE_BELOW) {
        state.shoe = cards.freshShoe(DECKS);
        state.shoeBuilt = Date.now();
    }
}
function draw(state, n = 1) {
    ensureShoe(state);
    const out = [];
    for (let i = 0; i < n; i++) out.push(state.shoe.pop());
    return out;
}

// ── Dealer plays out (hits soft 17) ───────────────────────────────────────
function playDealer(state) {
    while (true) {
        const v = cards.handValue(state.dealer);
        if (v.busted) return;
        if (v.value > 17) return;
        if (v.value === 17 && !v.soft) return;
        state.dealer.push(...draw(state, 1));
    }
}

// ── Side bet evaluation (Perfect Pairs on first 2 player cards) ───────────
function evalPerfectPairs(twoCards) {
    if (!twoCards || twoCards.length !== 2) return 0;
    const [a, b] = twoCards;
    if (a.r !== b.r) return 0;
    if (a.s === b.s) return 25; // perfect (same rank+suit)
    if (cards.isRedSuit(a.s) === cards.isRedSuit(b.s)) return 12; // colored
    return 6; // mixed
}

// ── Settlement (after stand / dealer plays) ───────────────────────────────
function settleHand(playerHand, dealerHand, bet) {
    const p = cards.handValue(playerHand);
    const d = cards.handValue(dealerHand);
    if (p.busted) return { result: 'lose', payout: 0, net: -bet };
    if (p.blackjack && !d.blackjack) {
        // 3:2 — return bet + 1.5 * bet
        const payout = bet + bet * 1.5;
        return { result: 'blackjack', payout, net: payout - bet };
    }
    if (d.busted) return { result: 'win', payout: bet * 2, net: bet };
    if (p.value > d.value) return { result: 'win', payout: bet * 2, net: bet };
    if (p.value < d.value) return { result: 'lose', payout: 0, net: -bet };
    return { result: 'push', payout: bet, net: 0 };
}

// ── Public-safe state shape (hides shoe + dealer hole when in-play) ───────
function publicState(state) {
    if (!state) return null;
    const inPlay = state.phase === 'player' || state.phase === 'insurance';
    const dealer = inPlay
        ? [state.dealer[0], { r: '?', s: '?' }]
        : state.dealer;
    return {
        phase: state.phase,
        bet: state.bet,
        perfectPairsBet: state.perfectPairsBet || 0,
        hands: state.hands.map((h) => ({
            cards: h.cards,
            value: cards.handValue(h.cards),
            bet: h.bet,
            doubled: !!h.doubled,
            stood: !!h.stood,
            busted: !!h.busted,
            blackjack: !!h.blackjack,
            settled: h.settled || null,
        })),
        active: state.active,
        dealer,
        dealerValue: inPlay
            ? cards.handValue([state.dealer[0]])
            : cards.handValue(state.dealer),
        insuranceOffered: !!state.insuranceOffered,
        insuranceTaken: !!state.insuranceTaken,
        insuranceBet: state.insuranceBet || 0,
        sideBet: state.sideBet || null,
        totalPayout: state.totalPayout || 0,
        totalNet: state.totalNet || 0,
        shoeRemaining: state.shoe ? state.shoe.length : 0,
    };
}

// ── Routes ────────────────────────────────────────────────────────────────
router.get('/state', authenticate, async (req, res) => {
    try {
        await tg.ensureSchema();
        const s = await loadState(req.user.id);
        const balance = await tg.getBalance(req.user.id);
        res.json({ state: publicState(s), balance });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load state', detail: err.message });
    }
});

router.post('/deal', authenticate, async (req, res) => {
    try {
        await tg.ensureSchema();
        const userId = req.user.id;
        const bet = parseFloat(req.body.bet);
        const ppBet = parseFloat(req.body.perfectPairsBet) || 0;

        if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
            return res.status(400).json({ error: `Bet must be $${MIN_BET}–$${MAX_BET}.` });
        }
        if (ppBet < 0 || ppBet > PERFECT_PAIRS_MAX) {
            return res.status(400).json({ error: `Perfect Pairs side bet must be $0–$${PERFECT_PAIRS_MAX}.` });
        }

        const existing = await loadState(userId);
        if (existing && existing.phase !== 'settled') {
            return res.status(400).json({ error: 'Finish the current hand first.' });
        }

        const totalAtRisk = bet + ppBet;
        const pf = await tg.preflightWager(userId, totalAtRisk);
        if (!pf.ok) return res.status(pf.status).json({ error: pf.error });

        const debit = await tg.debitBalance(userId, totalAtRisk);
        if (!debit.ok) return res.status(400).json({ error: debit.error || 'Insufficient balance.' });

        // Build initial state, draw 2-card player + 2-card dealer
        const state = {
            phase: 'player',
            bet, perfectPairsBet: ppBet,
            hands: [{ cards: [], bet, doubled: false, stood: false, busted: false, blackjack: false }],
            active: 0,
            dealer: [],
            insuranceOffered: false, insuranceTaken: false, insuranceBet: 0,
            sideBet: null,
            totalPayout: 0, totalNet: -totalAtRisk,
            shoe: existing && existing.shoe && existing.shoe.length >= RESHUFFLE_BELOW
                ? existing.shoe : cards.freshShoe(DECKS),
        };

        // Deal: P, D, P, D
        state.hands[0].cards.push(...draw(state, 1));
        state.dealer.push(...draw(state, 1));
        state.hands[0].cards.push(...draw(state, 1));
        state.dealer.push(...draw(state, 1));

        // Side bet evaluated immediately on initial 2 cards
        if (ppBet > 0) {
            const ppMult = evalPerfectPairs(state.hands[0].cards);
            if (ppMult > 0) {
                const ppPayout = ppBet + ppBet * ppMult;
                state.totalPayout += ppPayout;
                state.totalNet += ppPayout;
                state.sideBet = { type: 'perfectPairs', mult: ppMult, payout: ppPayout, won: true };
                await tg.creditBalance(userId, ppPayout);
            } else {
                state.sideBet = { type: 'perfectPairs', mult: 0, payout: 0, won: false };
            }
        }

        // Detect blackjack(s)
        const pv = cards.handValue(state.hands[0].cards);
        const dUp = state.dealer[0];
        if (pv.blackjack) state.hands[0].blackjack = true;

        // Insurance offer when dealer shows Ace and player has no BJ
        if (dUp.r === 'A' && !pv.blackjack) {
            state.phase = 'insurance';
            state.insuranceOffered = true;
        } else {
            // If dealer or player has blackjack → settle now
            const dv = cards.handValue(state.dealer);
            if (pv.blackjack || dv.blackjack) {
                await settleAndFinish(userId, state);
            }
        }

        await saveState(userId, state);
        const balance = await tg.getBalance(userId);
        res.json({ state: publicState(state), balance });
    } catch (err) {
        console.error('[Blackjack /deal]', err);
        res.status(500).json({ error: 'Deal failed', detail: err.message });
    }
});

router.post('/insurance', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const state = await loadState(userId);
        if (!state || state.phase !== 'insurance') return res.status(400).json({ error: 'No insurance offered.' });

        const take = !!req.body.take;
        const insBet = take ? state.bet / 2 : 0;

        if (take) {
            const debit = await tg.debitBalance(userId, insBet);
            if (!debit.ok) return res.status(400).json({ error: 'Insufficient balance for insurance.' });
            state.insuranceTaken = true;
            state.insuranceBet = insBet;
            state.totalNet -= insBet;
        }

        // Resolve insurance immediately
        const dv = cards.handValue(state.dealer);
        if (take && dv.blackjack) {
            // Insurance pays 2:1 → return insBet + 2*insBet
            const insPayout = insBet * 3;
            state.totalPayout += insPayout;
            state.totalNet += insPayout;
            await tg.creditBalance(userId, insPayout);
        }

        if (dv.blackjack) {
            // Main bet settles immediately
            await settleAndFinish(userId, state);
        } else {
            state.phase = 'player';
        }
        await saveState(userId, state);
        const balance = await tg.getBalance(userId);
        res.json({ state: publicState(state), balance });
    } catch (err) {
        res.status(500).json({ error: 'Insurance failed', detail: err.message });
    }
});

router.post('/hit', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const state = await loadState(userId);
        if (!state || state.phase !== 'player') return res.status(400).json({ error: 'No active hand.' });
        const hand = state.hands[state.active];
        if (hand.stood || hand.busted) return res.status(400).json({ error: 'Hand already complete.' });

        hand.cards.push(...draw(state, 1));
        const v = cards.handValue(hand.cards);
        if (v.busted) { hand.busted = true; hand.stood = true; }
        else if (v.value === 21) { hand.stood = true; }

        if (hand.stood) await advanceOrFinish(userId, state);
        await saveState(userId, state);
        const balance = await tg.getBalance(userId);
        res.json({ state: publicState(state), balance });
    } catch (err) {
        res.status(500).json({ error: 'Hit failed', detail: err.message });
    }
});

router.post('/stand', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const state = await loadState(userId);
        if (!state || state.phase !== 'player') return res.status(400).json({ error: 'No active hand.' });
        const hand = state.hands[state.active];
        if (hand.stood || hand.busted) return res.status(400).json({ error: 'Hand already complete.' });
        hand.stood = true;
        await advanceOrFinish(userId, state);
        await saveState(userId, state);
        const balance = await tg.getBalance(userId);
        res.json({ state: publicState(state), balance });
    } catch (err) {
        res.status(500).json({ error: 'Stand failed', detail: err.message });
    }
});

router.post('/double', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const state = await loadState(userId);
        if (!state || state.phase !== 'player') return res.status(400).json({ error: 'No active hand.' });
        const hand = state.hands[state.active];
        if (hand.cards.length !== 2 || hand.stood || hand.busted) {
            return res.status(400).json({ error: 'Cannot double now.' });
        }
        const debit = await tg.debitBalance(userId, hand.bet);
        if (!debit.ok) return res.status(400).json({ error: 'Insufficient balance to double.' });

        state.totalNet -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(...draw(state, 1));
        const v = cards.handValue(hand.cards);
        if (v.busted) hand.busted = true;
        hand.stood = true;
        await advanceOrFinish(userId, state);
        await saveState(userId, state);
        const balance = await tg.getBalance(userId);
        res.json({ state: publicState(state), balance });
    } catch (err) {
        res.status(500).json({ error: 'Double failed', detail: err.message });
    }
});

router.post('/split', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const state = await loadState(userId);
        if (!state || state.phase !== 'player') return res.status(400).json({ error: 'No active hand.' });
        if (state.hands.length > 1) return res.status(400).json({ error: 'Only one split allowed.' });
        const hand = state.hands[state.active];
        if (hand.cards.length !== 2 || cards.cardValue(hand.cards[0]) !== cards.cardValue(hand.cards[1])) {
            return res.status(400).json({ error: 'Cannot split this hand.' });
        }

        const debit = await tg.debitBalance(userId, hand.bet);
        if (!debit.ok) return res.status(400).json({ error: 'Insufficient balance to split.' });

        state.totalNet -= hand.bet;

        const c1 = hand.cards[0];
        const c2 = hand.cards[1];
        const splitAces = c1.r === 'A';

        const h1 = { cards: [c1, ...draw(state, 1)], bet: hand.bet, doubled: false, stood: false, busted: false, blackjack: false };
        const h2 = { cards: [c2, ...draw(state, 1)], bet: hand.bet, doubled: false, stood: false, busted: false, blackjack: false };

        // Split aces — one card each, auto-stand. Hand value of 21 here is NOT a natural blackjack.
        if (splitAces) { h1.stood = true; h2.stood = true; }

        state.hands = [h1, h2];
        state.active = 0;
        if (h1.stood) await advanceOrFinish(userId, state);
        await saveState(userId, state);
        const balance = await tg.getBalance(userId);
        res.json({ state: publicState(state), balance });
    } catch (err) {
        res.status(500).json({ error: 'Split failed', detail: err.message });
    }
});

// ── Internal: advance to next hand or play dealer + settle ────────────────
async function advanceOrFinish(userId, state) {
    while (state.active < state.hands.length - 1) {
        state.active++;
        if (!state.hands[state.active].stood && !state.hands[state.active].busted) return;
    }
    // All hands finished — dealer plays unless every hand busted
    const allBusted = state.hands.every(h => h.busted);
    if (!allBusted) playDealer(state);
    await settleAndFinish(userId, state);
}

async function settleAndFinish(userId, state) {
    let totalBet = 0;
    let totalPayout = 0;
    for (const h of state.hands) {
        const settled = settleHand(h.cards, state.dealer, h.bet);
        h.settled = settled;
        totalBet += h.bet;
        totalPayout += settled.payout;
    }
    if (totalPayout > 0) await tg.creditBalance(userId, totalPayout);
    state.totalPayout += totalPayout;
    state.totalNet += totalPayout;
    state.phase = 'settled';

    // Record gross bet (initial + side bet + insurance + double + split additions)
    const grossBet = state.bet
        + (state.perfectPairsBet || 0)
        + (state.insuranceBet || 0)
        + state.hands.reduce((acc, h) => acc + (h.bet - state.bet), 0); // doubled/split extras
    const grossWin = state.totalPayout;
    await tg.recordRound(userId, GAME_ID, grossBet, grossWin, {
        hands: state.hands.map(h => ({ cards: h.cards, value: cards.handValue(h.cards), result: h.settled?.result })),
        dealer: state.dealer,
        sideBet: state.sideBet,
        insurance: state.insuranceTaken ? state.insuranceBet : 0,
    });
}

module.exports = router;
