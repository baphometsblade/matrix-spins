'use strict';

/**
 * Pure-math tests for the new table-game engines.
 * Run with:  node tests/table-games-math.test.js
 */

require('../server/utils/secure-rng');

const cards = require('../server/services/cards.service');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; }
    else { fail++; console.error(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`); }
}
function truthy(v, label) {
    if (v) pass++;
    else { fail++; console.error(`FAIL ${label}: expected truthy, got ${v}`); }
}

eq(cards.cardValue({ r: 'A', s: 'S' }), 11, 'Ace = 11');
eq(cards.cardValue({ r: 'K', s: 'S' }), 10, 'K = 10');
eq(cards.cardValue({ r: '2', s: 'S' }), 2,  '2 = 2');
eq(cards.cardValue({ r: 'T', s: 'S' }), 10, 'T = 10');

eq(cards.handValue([{r:'A',s:'S'},{r:'K',s:'D'}]).blackjack, true, 'A+K = blackjack');
eq(cards.handValue([{r:'A',s:'S'},{r:'A',s:'D'}]).value, 12, 'A+A = 12');
eq(cards.handValue([{r:'A',s:'S'},{r:'9',s:'D'}]).value, 20, 'A+9 = 20 soft');
truthy(cards.handValue([{r:'A',s:'S'},{r:'9',s:'D'}]).soft, 'A+9 soft flag');
eq(cards.handValue([{r:'K',s:'S'},{r:'5',s:'D'},{r:'7',s:'C'}]).value, 22, 'bust 22');
truthy(cards.handValue([{r:'K',s:'S'},{r:'5',s:'D'},{r:'7',s:'C'}]).busted, 'bust flag');
eq(cards.handValue([{r:'A',s:'S'},{r:'6',s:'D'},{r:'5',s:'C'}]).value, 12, 'A6+5 = 12 hard');
eq(cards.handValue([{r:'A',s:'S'},{r:'A',s:'D'},{r:'9',s:'C'}]).value, 21, 'A+A+9 = 21');

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
truthy(RED.has(7),  'red 7');
truthy(!RED.has(8), 'black 8');

function vpRank(hand) {
    const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
    const ranks = hand.map(c => RANK_VAL[c.r]).sort((a,b)=>a-b);
    const suits = hand.map(c => c.s);
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r]||0)+1;
    const groups = Object.entries(counts).map(([r,c]) => ({r:Number(r),c})).sort((a,b)=>b.c-a.c||b.r-a.r);
    const flush = suits.every(s => s===suits[0]);
    let straight = ranks.every((r,i)=>i===0||r===ranks[i-1]+1);
    if (!straight && ranks.join(',') === '2,3,4,5,14') straight = true;
    const isRoyal = flush && ranks.join(',') === '10,11,12,13,14';
    if (isRoyal) return 'royal_flush';
    if (straight && flush) return 'straight_flush';
    if (groups[0].c===4) return 'four_kind';
    if (groups[0].c===3 && groups[1] && groups[1].c===2) return 'full_house';
    if (flush) return 'flush';
    if (straight) return 'straight';
    if (groups[0].c===3) return 'three_kind';
    if (groups[0].c===2 && groups[1] && groups[1].c===2) return 'two_pair';
    if (groups[0].c===2 && groups[0].r>=11) return 'jacks_or_better';
    return 'nothing';
}

eq(vpRank([{r:'T',s:'S'},{r:'J',s:'S'},{r:'Q',s:'S'},{r:'K',s:'S'},{r:'A',s:'S'}]), 'royal_flush', 'Royal Flush');
eq(vpRank([{r:'5',s:'H'},{r:'6',s:'H'},{r:'7',s:'H'},{r:'8',s:'H'},{r:'9',s:'H'}]), 'straight_flush', 'Straight Flush');
eq(vpRank([{r:'A',s:'S'},{r:'2',s:'D'},{r:'3',s:'C'},{r:'4',s:'H'},{r:'5',s:'S'}]), 'straight', 'Wheel straight');
eq(vpRank([{r:'9',s:'S'},{r:'9',s:'D'},{r:'9',s:'C'},{r:'9',s:'H'},{r:'2',s:'S'}]), 'four_kind', 'Quads');
eq(vpRank([{r:'K',s:'S'},{r:'K',s:'D'},{r:'K',s:'C'},{r:'2',s:'H'},{r:'2',s:'S'}]), 'full_house', 'Boat');
eq(vpRank([{r:'2',s:'S'},{r:'5',s:'S'},{r:'9',s:'S'},{r:'J',s:'S'},{r:'K',s:'S'}]), 'flush', 'Flush');
eq(vpRank([{r:'4',s:'S'},{r:'5',s:'D'},{r:'6',s:'C'},{r:'7',s:'H'},{r:'8',s:'S'}]), 'straight', 'Straight');
eq(vpRank([{r:'7',s:'S'},{r:'7',s:'D'},{r:'7',s:'C'},{r:'2',s:'H'},{r:'3',s:'S'}]), 'three_kind', 'Trips');
eq(vpRank([{r:'8',s:'S'},{r:'8',s:'D'},{r:'5',s:'C'},{r:'5',s:'H'},{r:'2',s:'S'}]), 'two_pair', 'Two pair');
eq(vpRank([{r:'J',s:'S'},{r:'J',s:'D'},{r:'5',s:'C'},{r:'7',s:'H'},{r:'2',s:'S'}]), 'jacks_or_better', 'Jacks');
eq(vpRank([{r:'T',s:'S'},{r:'T',s:'D'},{r:'5',s:'C'},{r:'7',s:'H'},{r:'2',s:'S'}]), 'nothing', 'Tens (not paying)');
eq(vpRank([{r:'2',s:'S'},{r:'5',s:'D'},{r:'9',s:'C'},{r:'J',s:'H'},{r:'K',s:'S'}]), 'nothing', 'High card');

function bjSettle(playerHand, dealerHand, bet) {
    const p = cards.handValue(playerHand);
    const d = cards.handValue(dealerHand);
    if (p.busted) return { result: 'lose', payout: 0 };
    if (p.blackjack && !d.blackjack) return { result: 'blackjack', payout: bet + bet * 1.5 };
    if (d.busted) return { result: 'win', payout: bet * 2 };
    if (p.value > d.value) return { result: 'win', payout: bet * 2 };
    if (p.value < d.value) return { result: 'lose', payout: 0 };
    return { result: 'push', payout: bet };
}
eq(bjSettle([{r:'A',s:'S'},{r:'K',s:'D'}], [{r:'9',s:'S'},{r:'8',s:'D'}], 10).payout, 25, 'BJ vs 17 → 25');
eq(bjSettle([{r:'T',s:'S'},{r:'9',s:'D'}], [{r:'T',s:'C'},{r:'9',s:'H'}], 10).result, 'push', '19 vs 19 push');
eq(bjSettle([{r:'T',s:'S'},{r:'5',s:'D'},{r:'9',s:'C'}], [{r:'T',s:'C'},{r:'9',s:'H'}], 10).result, 'lose', 'bust loses');
eq(bjSettle([{r:'T',s:'S'},{r:'9',s:'D'}], [{r:'T',s:'C'},{r:'8',s:'H'}], 10).payout, 20, '19 beats 18 → 20');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
