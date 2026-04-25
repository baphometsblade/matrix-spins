const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Chuck-a-Luck — 3 dice, bets on single numbers (1-6)
// Number bet: if 1 die matches → 1:1, 2 dice → 2:1, 3 dice → 10:1
// Field bet  : total 3-7 pays 1:1, total 14-18 pays 1:1, else lose (house edge ~5%)
// Big bet    : total 11-17 excluding triples → 1:1 (edge ~2.8%)
// Small bet  : total 4-10 excluding triples → 1:1 (edge ~2.8%)
// Triple bet : specific triple (e.g. three 6s) → 30:1 (edge ~13.9%)
// Any triple : any triple → 5:1 (edge ~13.9%)

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

const MIN_BET = 0.25;
const MAX_BET = 500;

function roll3() {
  return [
    secureInt(6) + 1,
    secureInt(6) + 1,
    secureInt(6) + 1,
  ];
}

// ── POST /roll ────────────────────────────────────────────────────────────────
// Body: {
//   number: { n: 1-6, amt: float }        — bet on a specific number
//   field:  float                          — field bet (totals 3-7 or 14-18)
//   big:    float                          — big bet (total 11-17, no triple)
//   small:  float                          — small bet (total 4-10, no triple)
//   triple: { n: 1-6, amt: float } | null — specific triple
//   anyTriple: float                       — any triple
// }

router.post('/roll', authenticate, async function(req, res) {
  try {
    const userId = req.user.id;
    var body = req.body;

    // Parse bets
    var numberBet   = body.number   && parseFloat(body.number.amt)   > 0 ? body.number   : null;
    var fieldAmt    = parseFloat(body.field)     || 0;
    var bigAmt      = parseFloat(body.big)       || 0;
    var smallAmt    = parseFloat(body.small)     || 0;
    var tripleBet   = body.triple   && parseFloat(body.triple.amt)   > 0 ? body.triple   : null;
    var anyTripleAmt = parseFloat(body.anyTriple) || 0;

    // Validate each bet amount
    var allAmts = [
      numberBet ? parseFloat(numberBet.amt) : 0,
      fieldAmt, bigAmt, smallAmt,
      tripleBet ? parseFloat(tripleBet.amt) : 0,
      anyTripleAmt,
    ];
    for (var a of allAmts) {
      if (a > 0 && (a < MIN_BET || a > MAX_BET))
        return res.status(400).json({ error: 'Each bet must be $' + MIN_BET + '\u2013$' + MAX_BET });
    }
    if (numberBet && (numberBet.n < 1 || numberBet.n > 6))
      return res.status(400).json({ error: 'Number must be 1-6' });
    if (tripleBet && (tripleBet.n < 1 || tripleBet.n > 6))
      return res.status(400).json({ error: 'Triple number must be 1-6' });

    var totalBet = parseFloat(allAmts.reduce(function(s, a) { return s + a; }, 0).toFixed(2));
    if (totalBet === 0) return res.status(400).json({ error: 'Place at least one bet' });

    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (parseFloat(user.balance) < totalBet)
      return res.status(400).json({ error: 'Insufficient balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [totalBet, userId]);

    // Roll
    var dice  = roll3();
    var total = dice[0] + dice[1] + dice[2];
    var isTriple = dice[0] === dice[1] && dice[1] === dice[2];

    var payout = 0;
    var breakdown = {};

    // Number bet
    if (numberBet) {
      var n    = parseInt(numberBet.n);
      var amt  = parseFloat(numberBet.amt);
      var hits = dice.filter(function(d) { return d === n; }).length;
      var mult = hits === 0 ? 0 : hits === 1 ? 2 : hits === 2 ? 3 : 11; // stake + win
      var numPayout = hits > 0 ? parseFloat((amt * mult).toFixed(2)) : 0;
      payout += numPayout;
      breakdown.number = { n, hits, payout: numPayout, profit: numPayout - amt };
    }

    // Field bet (3-7 or 14-18 pays 1:1; some houses pay 2:1 on 3 or 18 — we use flat 1:1)
    if (fieldAmt > 0) {
      var fieldWin = (total >= 3 && total <= 7) || (total >= 14 && total <= 18);
      var fPayout  = fieldWin ? parseFloat((fieldAmt * 2).toFixed(2)) : 0;
      payout += fPayout;
      breakdown.field = { total, win: fieldWin, payout: fPayout, profit: fPayout - fieldAmt };
    }

    // Big bet (11-17, no triple)
    if (bigAmt > 0) {
      var bigWin = total >= 11 && total <= 17 && !isTriple;
      var bPayout = bigWin ? parseFloat((bigAmt * 2).toFixed(2)) : 0;
      payout += bPayout;
      breakdown.big = { win: bigWin, payout: bPayout, profit: bPayout - bigAmt };
    }

    // Small bet (4-10, no triple)
    if (smallAmt > 0) {
      var smallWin = total >= 4 && total <= 10 && !isTriple;
      var sPayout  = smallWin ? parseFloat((smallAmt * 2).toFixed(2)) : 0;
      payout += sPayout;
      breakdown.small = { win: smallWin, payout: sPayout, profit: sPayout - smallAmt };
    }

    // Specific triple
    if (tripleBet) {
      var tn  = parseInt(tripleBet.n);
      var ta  = parseFloat(tripleBet.amt);
      var tWin = isTriple && dice[0] === tn;
      var tPayout = tWin ? parseFloat((ta * 31).toFixed(2)) : 0; // 30:1 + stake
      payout += tPayout;
      breakdown.triple = { n: tn, win: tWin, payout: tPayout, profit: tPayout - ta };
    }

    // Any triple
    if (anyTripleAmt > 0) {
      var atWin    = isTriple;
      var atPayout = atWin ? parseFloat((anyTripleAmt * 6).toFixed(2)) : 0; // 5:1 + stake
      payout += atPayout;
      breakdown.anyTriple = { win: atWin, payout: atPayout, profit: atPayout - anyTripleAmt };
    }

    payout = parseFloat(payout.toFixed(2));
    var profit = parseFloat((payout - totalBet).toFixed(2));

    if (payout > 0)
      await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, userId]);
    if (profit > 0)
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'win', ?, ?)",
        [userId, profit, 'Chuck-a-Luck: [' + dice.join(',') + ']']
      ).catch(function() {});

    const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      dice,
      total,
      isTriple,
      breakdown,
      totalBet,
      payout,
      profit,
      newBalance: u ? parseFloat(u.balance) : null,
    });
  } catch (err) {
    console.error('[ChuckALuck] /roll error:', err.message);
    return res.status(500).json({ error: 'Roll failed' });
  }
});

module.exports = router;
