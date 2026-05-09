const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Database setup pattern
const isPg = db.isPg();
const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Bootstrap is handled lazily by _ensureSeedData() on first request.
// (Previous eager IIFE broke because db.run returns {changes,lastInsertRowid},
//  not {id} — passing a result object as event_id failed prize inserts.)

// Lazy seed — ensures tables + event data exist when first request arrives
async function _ensureSeedData() {
  try {
    // Ensure tables exist (handles case where bootstrap failed)
    await db.run(`CREATE TABLE IF NOT EXISTS seasonal_events (
      id ${idDef}, name TEXT NOT NULL, theme TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, bonus_multiplier REAL NOT NULL DEFAULT 1.0,
      special_currency TEXT, challenges TEXT NOT NULL, created_at ${tsDef}, updated_at ${tsDef}
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS seasonal_event_progress (
      id ${idDef}, user_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
      challenge_id INTEGER NOT NULL, completed_at TEXT,
      shamrock_balance INTEGER NOT NULL DEFAULT 0, created_at ${tsDef}, updated_at ${tsDef}
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS seasonal_event_prizes (
      id ${idDef}, event_id INTEGER NOT NULL, shamrock_cost INTEGER NOT NULL,
      prize_type TEXT NOT NULL, prize_name TEXT NOT NULL, prize_details TEXT, created_at ${tsDef}
    )`);
    var existing = await db.get('SELECT id FROM seasonal_events WHERE theme = ?', ['st-patricks']);
    if (existing) return;
    var challenges = JSON.stringify([
      { id: 1, name: 'Spin 50 times', reward: 100 },
      { id: 2, name: 'Win $100 total', reward: 200 },
      { id: 3, name: 'Hit 3 wins in a row', reward: 150 },
      { id: 4, name: 'Play 5 different games', reward: 250 },
      { id: 5, name: 'Spin during Happy Hour', reward: 300 }
    ]);
    await db.run(
      'INSERT INTO seasonal_events (name, theme, start_date, end_date, bonus_multiplier, special_currency, challenges) VALUES (?,?,?,?,?,?,?)',
      ['Lucky Leprechaun Festival', 'st-patricks', '2026-03-15', '2026-03-20', 1.5, 'shamrocks', challenges]
    );
    var evt = await db.get('SELECT id FROM seasonal_events WHERE theme = ?', ['st-patricks']);
    var eid = evt ? evt.id : 1;
    var prizes = [
      [eid, 50, 'free_spins', '10 Free Spins', '{"spins":10}'],
      [eid, 150, 'bonus_cash', '$5 Bonus', '{"amount":5}'],
      [eid, 300, 'bonus_cash', '$15 Bonus', '{"amount":15}'],
      [eid, 500, 'cosmetic', 'Lucky Clover Avatar', '{"avatar":"lucky-clover"}'],
      [eid, 1000, 'combo', '$50 Bonus + Pot of Gold', '{"amount":50,"effect":"pot-of-gold"}']
    ];
    for (var p of prizes) {
      await db.run('INSERT INTO seasonal_event_prizes (event_id, shamrock_cost, prize_type, prize_name, prize_details) VALUES (?,?,?,?,?)', p);
    }
    console.warn('[SeasonalEvent] Lazy seed completed');
  } catch(e) { console.warn('[SeasonalEvent] Lazy seed:', e.message); }
}

// GET / - Returns active seasonal event with time remaining
router.get('/', async (req, res) => {
  try {
    await _ensureSeedData();
    const event = await db.get(
      `SELECT id, name, theme, start_date, end_date, bonus_multiplier, special_currency, challenges
       FROM seasonal_events WHERE end_date >= ${isPg ? "CURRENT_DATE::text" : "date('now')"} LIMIT 1`,
      []
    );

    if (!event) {
      return res.status(404).json({ error: 'No active seasonal event' });
    }

    const now = new Date();
    const endDate = new Date(event.end_date);
    const timeRemaining = Math.max(0, endDate - now);
    const daysRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60 * 24));

    res.json({
      event: {
        id: event.id,
        name: event.name,
        theme: event.theme,
        start_date: event.start_date,
        end_date: event.end_date,
        bonus_multiplier: event.bonus_multiplier,
        special_currency: event.special_currency,
        challenges: (function() { try { return JSON.parse(event.challenges || '[]'); } catch (_) { return []; } })(),
        days_remaining: daysRemaining
      }
    });
  } catch (err) {
    console.warn('Error fetching active event:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// GET /progress - Returns user's challenge progress and shamrock balance
router.get('/progress', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

        // ROUND 34: Self-exclusion check (regulatory compliance)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [userId]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[SelfExcl] Check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }


    const event = await db.get(
      `SELECT id FROM seasonal_events WHERE end_date >= ${isPg ? "CURRENT_DATE::text" : "date('now')"} LIMIT 1`,
      []
    );

    if (!event) {
      return res.status(404).json({ error: 'No active seasonal event' });
    }

    const progress = await db.all(
      `SELECT challenge_id, completed_at FROM seasonal_event_progress
       WHERE user_id = ? AND event_id = ?`,
      [userId, event.id]
    );

    const shamrockBalance = await db.get(
      `SELECT SUM(shamrock_balance) as total FROM seasonal_event_progress
       WHERE user_id = ? AND event_id = ?`,
      [userId, event.id]
    );

    const completedChallenges = progress
      .filter(p => p.completed_at)
      .map(p => p.challenge_id);

    res.json({
      event_id: event.id,
      shamrock_balance: shamrockBalance?.total || 0,
      completed_challenges: completedChallenges,
      progress: progress
    });
  } catch (err) {
    console.warn('Error fetching user progress:', err.message);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// POST /collect - Collect reward for completed challenge
router.post('/collect', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { challenge_id } = req.body;

    if (!challenge_id) {
      return res.status(400).json({ error: 'challenge_id required' });
    }

    const event = await db.get(
      `SELECT id, challenges FROM seasonal_events WHERE end_date >= ${isPg ? "CURRENT_DATE::text" : "date('now')"} LIMIT 1`,
      []
    );

    if (!event) {
      return res.status(404).json({ error: 'No active seasonal event' });
    }

    let challenges = [];
    try { challenges = JSON.parse(event.challenges || '[]'); } catch (_) { /* corrupted data */ }
    const challenge = challenges.find(c => c.id === challenge_id);

    if (!challenge) {
      return res.status(400).json({ error: 'Invalid challenge_id' });
    }

    const existingProgress = await db.get(
      `SELECT id, completed_at FROM seasonal_event_progress
       WHERE user_id = ? AND event_id = ? AND challenge_id = ?`,
      [userId, event.id, challenge_id]
    );

    if (existingProgress && existingProgress.completed_at) {
      return res.status(400).json({ error: 'Challenge already completed' });
    }

    if (existingProgress) {
      await db.run(
        `UPDATE seasonal_event_progress SET completed_at = ${isPg ? 'NOW()' : "datetime('now')"}, shamrock_balance = shamrock_balance + ?
         WHERE id = ?`,
        [challenge.reward, existingProgress.id]
      );
    } else {
      await db.run(
        `INSERT INTO seasonal_event_progress (user_id, event_id, challenge_id, completed_at, shamrock_balance)
         VALUES (?, ?, ?, ${isPg ? 'NOW()' : "datetime('now')"}, ?)`,
        [userId, event.id, challenge_id, challenge.reward]
      );
    }

    res.json({
      message: 'Challenge completed',
      shamrocks_earned: challenge.reward
    });
  } catch (err) {
    console.warn('Error collecting challenge reward:', err.message);
    res.status(500).json({ error: 'Failed to collect reward' });
  }
});

// GET /prizes - Returns redeemable prizes
router.get('/prizes', async (req, res) => {
  try {
    const event = await db.get(
      `SELECT id FROM seasonal_events WHERE end_date >= ${isPg ? "CURRENT_DATE::text" : "date('now')"} LIMIT 1`,
      []
    );

    if (!event) {
      return res.status(404).json({ error: 'No active seasonal event' });
    }

    const prizes = await db.all(
      `SELECT id, shamrock_cost, prize_type, prize_name, prize_details
       FROM seasonal_event_prizes WHERE event_id = ? ORDER BY shamrock_cost ASC`,
      [event.id]
    );

    const formattedPrizes = prizes.map(p => ({
      id: p.id,
      shamrock_cost: p.shamrock_cost,
      prize_type: p.prize_type,
      prize_name: p.prize_name,
      prize_details: (function() { try { return JSON.parse(p.prize_details || '{}'); } catch (_) { return {}; } })()
    }));

    res.json({ prizes: formattedPrizes });
  } catch (err) {
    console.warn('Error fetching prizes:', err.message);
    res.status(500).json({ error: 'Failed to fetch prizes' });
  }
});

// POST /redeem - Redeem shamrocks for a prize
router.post('/redeem', authenticate, bonusGuard, async (req, res) => {
  try {
    const userId = req.user.id;
    const { prize_id } = req.body;

    if (!prize_id) {
      return res.status(400).json({ error: 'prize_id required' });
    }

    const event = await db.get(
      `SELECT id FROM seasonal_events WHERE end_date >= ${isPg ? "CURRENT_DATE::text" : "date('now')"} LIMIT 1`,
      []
    );

    if (!event) {
      return res.status(404).json({ error: 'No active seasonal event' });
    }

    const prize = await db.get(
      `SELECT id, shamrock_cost, prize_name FROM seasonal_event_prizes
       WHERE id = ? AND event_id = ?`,
      [prize_id, event.id]
    );

    if (!prize) {
      return res.status(400).json({ error: 'Invalid prize_id' });
    }

    const userBalance = await db.get(
      `SELECT SUM(shamrock_balance) as total FROM seasonal_event_progress
       WHERE user_id = ? AND event_id = ?`,
      [userId, event.id]
    );

    const balance = userBalance?.total || 0;

    if (balance < prize.shamrock_cost) {
      return res.status(400).json({
        error: 'Insufficient shamrocks',
        current_balance: balance,
        required: prize.shamrock_cost
      });
    }

    // ROUND 29: Atomic deduction with WHERE guard — prevents double-claim race condition.
    // Old code: checked balance then deducted without verifying balance was still sufficient.
    // Two concurrent requests could both pass the check and both deduct.
    var deductResult = await db.run(
      `UPDATE seasonal_event_progress SET shamrock_balance = shamrock_balance - ?
       WHERE user_id = ? AND event_id = ? AND shamrock_balance >= ?`,
      [prize.shamrock_cost, userId, event.id, prize.shamrock_cost]
    );
    if (!deductResult || deductResult.changes === 0) {
      return res.status(400).json({ error: 'Insufficient shamrocks' });
    }

    // Deliver the actual prize
    const prizeDetails = await db.get('SELECT prize_type, prize_details FROM seasonal_event_prizes WHERE id = ?', [prize_id]);
    if (prizeDetails) {
      const details = JSON.parse(prizeDetails.prize_details || '{}');
      switch (prizeDetails.prize_type) {
        case 'free_spins':
          await db.run('UPDATE users SET free_spin_tokens = COALESCE(free_spin_tokens, 0) + ? WHERE id = ?', [details.spins || 10, userId]);
          break;
        case 'bonus_cash':
        case 'combo':
          if (details.amount && details.amount > 0) {
            var wageringMult = 15;
            await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
              [details.amount, details.amount * wageringMult, userId]);
          }
          break;
        case 'cosmetic':
          // Cosmetic rewards are tracked by the redemption record itself
          break;
      }
    }

    res.json({
      message: 'Prize redeemed successfully',
      prize_name: prize.prize_name,
      shamrocks_spent: prize.shamrock_cost,
      new_balance: balance - prize.shamrock_cost
    });
  } catch (err) {
    console.warn('Error redeeming prize:', err.message);
    res.status(500).json({ error: 'Failed to redeem prize' });
  }
});

// GET /leaderboard - Top 10 shamrock earners
router.get('/leaderboard', async (req, res) => {
  try {
    const event = await db.get(
      `SELECT id FROM seasonal_events WHERE end_date >= ${isPg ? "CURRENT_DATE::text" : "date('now')"} LIMIT 1`,
      []
    );

    if (!event) {
      return res.status(404).json({ error: 'No active seasonal event' });
    }

    const leaderboard = await db.all(
      `SELECT user_id, SUM(shamrock_balance) as total_shamrocks,
              COUNT(DISTINCT challenge_id) as challenges_completed
       FROM seasonal_event_progress
       WHERE event_id = ?
       GROUP BY user_id
       ORDER BY total_shamrocks DESC
       LIMIT 10`,
      [event.id]
    );

    const ranked = leaderboard.map((entry, index) => ({
      rank: index + 1,
      user_id: entry.user_id,
      total_shamrocks: entry.total_shamrocks,
      challenges_completed: entry.challenges_completed
    }));

    res.json({ leaderboard: ranked });
  } catch (err) {
    console.warn('Error fetching leaderboard:', err.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
