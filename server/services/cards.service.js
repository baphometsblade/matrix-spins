'use strict';

/**
 * Shared card / deck utilities for table games (Blackjack, Video Poker).
 * Uses crypto.randomBytes via the global secure-rng patch — no Math.random
 * fallbacks. Cards are encoded as { r: rank, s: suit } where:
 *   rank: 'A','2','3','4','5','6','7','8','9','T','J','Q','K'
 *   suit: 'S','H','D','C'  (Spades, Hearts, Diamonds, Clubs)
 */

const crypto = require('crypto');

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function buildDeck(decks = 1) {
    const out = [];
    for (let d = 0; d < decks; d++) {
        for (const s of SUITS) {
            for (const r of RANKS) out.push({ r, s });
        }
    }
    return out;
}

/**
 * Cryptographically-secure Fisher–Yates shuffle. Uses crypto.randomInt to avoid
 * modulo bias from naive byte truncation.
 */
function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function freshShoe(decks = 1) {
    return shuffle(buildDeck(decks));
}

function cardValue(card) {
    if (!card) return 0;
    if (card.r === 'A') return 11;
    if (card.r === 'T' || card.r === 'J' || card.r === 'Q' || card.r === 'K') return 10;
    return parseInt(card.r, 10);
}

/**
 * Best blackjack hand value, treating Aces as 11 then dropping to 1 as needed.
 * Returns { value, soft, blackjack, busted }.
 */
function handValue(hand) {
    let total = 0;
    let aces = 0;
    for (const c of hand) {
        if (c.r === 'A') { aces++; total += 11; }
        else total += cardValue(c);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return {
        value: total,
        soft: aces > 0 && total <= 21,
        blackjack: hand.length === 2 && total === 21,
        busted: total > 21,
    };
}

function rankRank(r) {
    return RANKS.indexOf(r); // 0=A then 2..K
}

function isRedSuit(s) { return s === 'H' || s === 'D'; }

module.exports = {
    RANKS,
    SUITS,
    buildDeck,
    shuffle,
    freshShoe,
    cardValue,
    handValue,
    rankRank,
    isRedSuit,
};
