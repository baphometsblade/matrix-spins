'use strict';

const crypto = require('crypto');

/**
 * Virtual Horse Racing Route
 *
 * House edge note:
 *   True fair odds for a 6-horse field (assuming equal probability):
 *     win   = 6:1  (true), we pay 6:1  → actually 0% edge on win, so we net via bust outs
 *     place = 3:1  (true 2/6 chance), we pay 2.5:1 → ~16.7% edge
 *     show  = 2:1  (true 3/6 chance), we pay 1.5:1 → ~25% edge
 *     exacta = 30:1 (true 1/30), we pay 25:1 → ~16.7% edge
 *     quinella = 15:1 (true 1/15), we pay 10:1 → ~33.3% edge
 *   Blended across typical bet mixes this produces ~15% house advantage.
 *
 *   Payout multipliers below are the TOTAL return (stake × multiplier),
 *   so a win bet of $10 at 6x returns $60 (profit $50).
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HORSE_NAMES = ['Thunder', 'Lightning', 'Storm', 'Blaze', 'Shadow', 'Comet'];
const HORSE_COUNT = HORSE_NAMES.length; // 6
const FURLONGS = 10;                    // legs per race
const MIN_BET = 0.25;
const MAX_BET = 500;

/**
 * Payout multipliers (total return including stake).
 * e.g. WIN_MULTIPLIER = 6 means a $10 bet returns $60 total → $50 profit.
 */
const PAYOUTS = {
  win:      6,    // pick exact 1st place
  place:    2.5,  // pick horse finishing 1st or 2nd
  show:     1.5,  // pick horse finishing 1st, 2nd, or 3rd
  exacta:   25,   // exact 1st and 2nd in order
  quinella: 10,   // 1st and 2nd in any order
};

const VALID_BET_TYPES = Object.keys(PAYOUTS);

// Bet types that require a second horse selection
const DUAL_HORSE_TYPES = new Set(['exacta', 'quinella']);

// ---------------------------------------------------------------------------
// Helper: simulate one race
// ---------------------------------------------------------------------------

/**
 * Simulate a 6-horse race.
 * Each horse gets FURLONGS random speed values drawn from [1, 10].
 * Total time = sum of those values. Lower total time = faster horse.
 *
 * @returns {{
 *   horses: Array<{id: number, name: string, times: number[], total: number}>,
 *   finishOrder: number[]  // horse ids sorted fastest → slowest (0-indexed)
 * }}
 */
function simulateRace() {
  const horses = HORSE_NAMES.map((name, id) => {
    const times = Array.from({ length: FURLONGS }, () =>
      crypto.randomInt(10) + 1   // crypto-secure: race outcomes drive payouts
    );
    const total = times.reduce((sum, t) => sum + t, 0);
    return { id, name, times, total };
  });

  // Sort ascending by total time; ties broken by first differing furlong
  const sorted = [...horses].sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    for (let f = 0; f < FURLONGS; f++) {
      if (a.times[f] !== b.times[f]) return a.times[f] - b.times[f];
    }
    return a.id - b.id; // stable fallback
  });

  const finishOrder = sorted.map(h => h.id);

  return { horses, finishOrder };
}

// ---------------------------------------------------------------------------
// Helper: evaluate a single bet against the race result
// ---------------------------------------------------------------------------

/**
 * Determine whether a bet won and what the payout amount is.
 *
 * @param {{ type: string, horse: number, horse2: number|undefined, amount: number }} bet
 * @param {number[]} finishOrder - horse ids in finishing order (index 0 = 1st)
 * @returns {{ won: boolean, payout: number, description: string }}
 */
function evaluateBet(bet, finishOrder) {
  const { type, horse, horse2, amount } = bet;
  const first  = finishOrder[0];
  const second = finishOrder[1];
  const third  = finishOrder[2];

  let won = false;

  switch (type) {
    case 'win':
      won = horse === first;
      break;

    case 'place':
      won = horse === first || horse === second;
      break;

    case 'show':
      won = horse === first || horse === second || horse === third;
      break;

    case 'exacta':
      // horse must finish 1st, horse2 must finish 2nd — exact order
      won = horse === first && horse2 === second;
      break;

    case 'quinella':
      // horse and horse2 must be 1st and 2nd in either order
      won = (horse === first && horse2 === second) ||
            (horse === second && horse2 === first);
      break;

    default:
      won = false;
  }

  // Payout = stake × multiplier when won, 0 when lost
  const payout = won ? parseFloat((amount * PAYOUTS[type]).toFixed(2)) : 0;

  const horseLabel = `${HORSE_NAMES[horse]}${horse2 !== undefined ? ' + ' + HORSE_NAMES[horse2] : ''}`;
  const description = won
    ? `${type.toUpperCase()} on ${horseLabel} — WON $${payout.toFixed(2)}`
    : `${type.toUpperCase()} on ${horseLabel} — lost`;

  return { won, payout, description };
}

// ---------------------------------------------------------------------------
// Helper: validate a single bet object
// ---------------------------------------------------------------------------

/**
 * @param {unknown} bet
 * @param {number} index - position in bets array (for error messages)
 * @returns {string|null} error message or null if valid
 */
function validateBet(bet, index) {
  if (bet === null || typeof bet !== 'object') {
    return `Bet[${index}]: must be an object`;
  }

  const { type, horse, horse2, amount } = bet;

  if (!VALID_BET_TYPES.includes(type)) {
    return `Bet[${index}]: invalid type "${type}". Must be one of: ${VALID_BET_TYPES.join(', ')}`;
  }

  if (!Number.isInteger(horse) || horse < 0 || horse >= HORSE_COUNT) {
    return `Bet[${index}]: horse must be an integer 0–${HORSE_COUNT - 1}`;
  }

  if (DUAL_HORSE_TYPES.has(type)) {
    if (!Number.isInteger(horse2) || horse2 < 0 || horse2 >= HORSE_COUNT) {
      return `Bet[${index}]: "${type}" requires horse2 to be an integer 0–${HORSE_COUNT - 1}`;
    }
    if (horse === horse2) {
      return `Bet[${index}]: horse and horse2 must be different horses`;
    }
  }

  if (typeof amount !== 'number' || !isFinite(amount)) {
    return `Bet[${index}]: amount must be a finite number`;
  }

  const rounded = parseFloat(amount.toFixed(2));
  if (rounded < MIN_BET) {
    return `Bet[${index}]: minimum bet is $${MIN_BET.toFixed(2)}`;
  }
  if (rounded > MAX_BET) {
    return `Bet[${index}]: maximum bet is $${MAX_BET.toFixed(2)}`;
  }

  return null; // valid
}

// ---------------------------------------------------------------------------
// POST /api/horseracing/race
// ---------------------------------------------------------------------------

router.post('/race', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { bets } = req.body;

    // --- Validate bets array ---
    if (!Array.isArray(bets) || bets.length === 0) {
      return res.status(400).json({ error: 'bets must be a non-empty array' });
    }
    if (bets.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 bets per race' });
    }

    const validationErrors = [];
    for (let i = 0; i < bets.length; i++) {
      const err = validateBet(bets[i], i);
      if (err) validationErrors.push(err);
    }
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Bet validation failed', details: validationErrors });
    }

    // Normalise amounts to 2dp
    const normalisedBets = bets.map(b => ({
      ...b,
      amount: parseFloat(b.amount.toFixed(2)),
    }));

    const totalWager = parseFloat(
      normalisedBets.reduce((sum, b) => sum + b.amount, 0).toFixed(2)
    );

    // --- Fetch and check balance ---
    const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentBalance = parseFloat(user.balance);
    if (currentBalance < totalWager) {
      return res.status(400).json({
        error: 'Insufficient balance',
        balance: currentBalance,
        required: totalWager,
      });
    }

    // --- Atomic wager debit (race-safe vs concurrent bets) ---
    const balanceAfterDeduct = parseFloat((currentBalance - totalWager).toFixed(2));
    const debit = await db.run(
      'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
      [totalWager, userId, totalWager]
    );
    const debitRows = (debit && (debit.changes || debit.rowCount)) || 0;
    if (debitRows === 0) {
      return res.status(400).json({ error: 'Insufficient balance (concurrent debit detected)' });
    }

    // --- Simulate race ---
    const { horses, finishOrder } = simulateRace();

    // --- Evaluate each bet ---
    let totalPayout = 0;
    const betResults = normalisedBets.map((bet, i) => {
      const result = evaluateBet(bet, finishOrder);
      totalPayout += result.payout;
      return {
        index: i,
        type: bet.type,
        horse: bet.horse,
        horseName: HORSE_NAMES[bet.horse],
        horse2: bet.horse2 !== undefined ? bet.horse2 : null,
        horse2Name: bet.horse2 !== undefined ? HORSE_NAMES[bet.horse2] : null,
        amount: bet.amount,
        won: result.won,
        payout: result.payout,
        description: result.description,
      };
    });
    totalPayout = parseFloat(totalPayout.toFixed(2));

    // --- Credit winnings (atomic accumulator) ---
    const finalBalance = parseFloat((balanceAfterDeduct + totalPayout).toFixed(2));
    if (totalPayout > 0) {
      await db.run(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [totalPayout, userId]
      );
    }

    // --- Build finish-order enriched response ---
    const finishDisplay = finishOrder.map((horseId, position) => ({
      position: position + 1,
      id: horseId,
      name: HORSE_NAMES[horseId],
      total: horses[horseId].total,
      times: horses[horseId].times,
    }));

    return res.json({
      success: true,
      race: {
        horses: horses.map(h => ({
          id: h.id,
          name: h.name,
          times: h.times,
          total: h.total,
        })),
        finishOrder,
        finishDisplay,
        winner: HORSE_NAMES[finishOrder[0]],
        second: HORSE_NAMES[finishOrder[1]],
        third:  HORSE_NAMES[finishOrder[2]],
      },
      betResults,
      summary: {
        totalWager,
        totalPayout,
        netResult: parseFloat((totalPayout - totalWager).toFixed(2)),
        betsWon: betResults.filter(b => b.won).length,
        betsLost: betResults.filter(b => !b.won).length,
      },
      balance: finalBalance,
    });
  } catch (err) {
    console.error('[horseracing] POST /race error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/horseracing/info
// ---------------------------------------------------------------------------

router.get('/info', (req, res) => {
  /*
   * Public endpoint — no auth required.
   * Returns static game metadata for the client to build the UI.
   */
  return res.json({
    gameName: 'Virtual Horse Racing',
    horses: HORSE_NAMES.map((name, id) => ({ id, name })),
    betTypes: VALID_BET_TYPES.map(type => ({
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      description: betTypeDescription(type),
      payoutMultiplier: PAYOUTS[type],
      requiresTwoHorses: DUAL_HORSE_TYPES.has(type),
    })),
    limits: {
      minBet: MIN_BET,
      maxBet: MAX_BET,
      maxBetsPerRace: 20,
    },
    raceFormat: {
      horses: HORSE_COUNT,
      furlongs: FURLONGS,
      speedRange: { min: 1, max: 10 },
      note: 'Each horse draws 10 random speed values. Lower total = faster horse.',
    },
    /*
     * House edge note (informational, not displayed to players):
     *   Blended edge across bet types is approximately 15%.
     *   win: 0% theoretical edge (6:1 true odds, paid 6:1) — edge comes
     *        from field size variance; place/show/exotic edges listed below.
     *   place: ~16.7% edge  (true 3:1, pays 2.5:1)
     *   show:  ~25% edge    (true 2:1, pays 1.5:1)
     *   exacta: ~16.7% edge (true 30:1, pays 25:1)
     *   quinella: ~33.3% edge (true 15:1, pays 10:1)
     */
  });
});

/**
 * Human-readable description for each bet type.
 * @param {string} type
 * @returns {string}
 */
function betTypeDescription(type) {
  switch (type) {
    case 'win':      return 'Pick the horse that finishes 1st. Pays 6:1.';
    case 'place':    return 'Pick a horse that finishes 1st or 2nd. Pays 2.5:1.';
    case 'show':     return 'Pick a horse that finishes 1st, 2nd, or 3rd. Pays 1.5:1.';
    case 'exacta':   return 'Pick the 1st and 2nd place horses in exact order. Pays 25:1.';
    case 'quinella': return 'Pick the 1st and 2nd place horses in any order. Pays 10:1.';
    default:         return '';
  }
}

module.exports = router;
