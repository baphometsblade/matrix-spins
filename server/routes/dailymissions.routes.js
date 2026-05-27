'use strict';

// Daily Missions Routes
// GET  /api/dailymissions -- authenticated; get today's missions with progress
// POST /api/dailymissions/progress  -- authenticated; update progress
// POST /api/dailymissions/claim/:id -- authenticated; claim reward

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

// Mission templates -- 3 randomly assigned per user per day
const MISSION_TEMPLATES = [
  { type: 'spins',  target: 5,   reward_type: 'cash',   reward_amount: 0.50, label: 'Spin 5 times'    },
  { type: 'spins',  target: 10,  reward_type: 'cash',   reward_amount: 1.00, label: 'Spin 10 times'   },
  { type: 'wins',   target: 3,   reward_type: 'cash',   reward_amount: 0.50, label: 'Win 3 times'     },
  { type: 'wins',   target: 5,   reward_type: 'cash',   reward_amount: 1.00, label: 'Win 5 times'     },
  { type: 'bet',    target: 5,   reward_type: 'points', reward_amount: 50,   label: 'Wager $5 total'  },
  { type: 'bet',    target: 10,  reward_type: 'cash',   reward_amount: 0.75, label: 'Wager $10 total' },
  { type: 'spins',  target: 20,  reward_type: 'points', reward_amount: 100,  label: 'Spin 20 times'   },
  { type: 'wins',   target: 10,  reward_type: 'cash',   reward_amount: 1.50, label: 'Win 10 times'    },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Seeded random -- same 3 missions for all users on a given calendar day
function seededPick(seed, arr, count) {
  let s = seed;
  const shuffle = arr.slice();
  for (let i = shuffle.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [shuffle[i], shuffle[j]] = [shuffle[j], shuffle[i]];
  }
  return shuffle.slice(0, count);
}

function getDayMissions() {
  const today = todayStr();
  const seed = today.split('-').reduce((acc, n) => acc * 31 + parseInt(n), 0);
  return seededPick(seed, MISSION_TEMPLATES, 3).map((t, i) => ({ ...t, slot: i }));
}

// Schema bootstrap
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const isPg  = db.isPg();
  const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  await db.run(
    'CREATE TABLE IF NOT EXISTS daily_mission_progress (' +
    '  id            ' + idDef + ',' +
    '  user_id       INTEGER NOT NULL,' +
    '  mission_date  TEXT    NOT NULL,' +
    '  slot          INTEGER NOT NULL,' +
    '  progress      REAL    DEFAULT 0,' +
    '  completed     INTEGER DEFAULT 0,' +
    '  claimed       INTEGER DEFAULT 0,' +
    '  UNIQUE(user_id, mission_date, slot)' +
    ')'
  );
  // Ensure loyalty_points column exists (may already be present from loyaltyshop)
  try { await db.run('ALTER TABLE users ADD COLUMN loyalty_points INTEGER DEFAULT 0'); } catch (_) {}
  schemaReady = true;
}

// Merge template missions with DB progress rows
async function getMissionsWithProgress(userId) {
  await ensureSchema();
  const today = todayStr();
  const templates = getDayMissions();
  const rows = await db.all(
    'SELECT slot, progress, completed, claimed FROM daily_mission_progress WHERE user_id = ? AND mission_date = ?',
    [userId, today]
  );
  const bySlot = {};
  rows.forEach(function(r) { bySlot[r.slot] = r; });
  return templates.map(function(t) {
    const r = bySlot[t.slot] || { progress: 0, completed: 0, claimed: 0 };
    return {
      slot: t.slot,
      type: t.type,
      label: t.label,
      target: t.target,
      reward_type: t.reward_type,
      reward_amount: t.reward_amount,
      progress: r.progress || 0,
      completed: !!r.completed,
      claimed: !!r.claimed,
    };
  });
}

// GET / -- list today's missions
router.get('/', authenticate, async function(req, res) {
  try {
    const missions = await getMissionsWithProgress(req.user.id);
    return res.json({ missions, date: todayStr() });
  } catch (err) {
    console.warn('[DailyMissions] GET / error:', err.message);
    return res.status(500).json({ error: 'Failed to get missions' });
  }
});

// POST /progress — DISABLED (client-reported progress removed)
// All mission progress is now tracked exclusively server-side in spin.routes.js
// (the fire-and-forget daily missions block). This prevents users from forging
// completions by sending fake { spins, wins, betAmount } payloads.
router.post('/progress', authenticate, async function(req, res) {
  // Return current mission state without accepting any client-reported progress
  try {
    const missions = await getMissionsWithProgress(req.user.id);
    return res.json({ success: true, missions });
  } catch (err) {
    console.warn('[DailyMissions] POST /progress error:', err.message);
    return res.status(500).json({ error: 'Failed to get missions' });
  }
});

// POST /claim/:slot -- claim reward for a completed mission
router.post('/claim/:slot', authenticate, bonusGuard, async function(req, res) {
  try {
    await ensureSchema();
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

    const today  = todayStr();
    const slot   = parseInt(req.params.slot, 10);
    const templates = getDayMissions();
    const mission = templates.find(function(t) { return t.slot === slot; });
    if (!mission) return res.status(400).json({ error: 'Invalid mission slot' });

    // Atomic claim: UPDATE WHERE claimed = 0 AND completed = 1 prevents race condition double-claim
    const claimResult = await db.run(
      'UPDATE daily_mission_progress SET claimed = 1 WHERE user_id = ? AND mission_date = ? AND slot = ? AND completed = 1 AND claimed = 0',
      [userId, today, slot]
    );
    if (!claimResult || claimResult.changes === 0) {
      return res.status(409).json({ error: 'Mission not completed or already claimed' });
    }

    // Credit reward
    let newBalance = null;
    if (mission.reward_type === 'cash') {
      var creditAmount = mission.reward_amount;
      // ROUND 52: Cap to remaining daily bonus limit
      if (creditAmount > 0 && req.bonusCapRemaining !== undefined && creditAmount > req.bonusCapRemaining) {
        creditAmount = Math.max(0, Math.floor(req.bonusCapRemaining * 100) / 100);
        if (creditAmount <= 0) {
          return res.status(400).json({ error: 'Daily bonus limit reached' });
        }
      }
      await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [creditAmount, creditAmount * 15, userId]);
      // Use the canonical 6-column transactions schema. The previous
      // INSERT into `description` (the column doesn't exist) silently
      // 500'd every claim AFTER bonus_balance was credited — players
      // saw an error toast on a mission they had actually completed.
      // balance_before === balance_after because credit went to
      // bonus_balance, not balance (matches admin_bonus pattern).
      const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      newBalance = u ? parseFloat(u.balance) : null;
      const balanceForLog = newBalance == null ? 0 : newBalance;
      await db.run(
        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, 'bonus', mission.reward_amount, balanceForLog, balanceForLog, 'Daily mission reward: ' + mission.label + ' (bonus, 15x wagering)']
      );
    } else if (mission.reward_type === 'points') {
      await db.run(
        'UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?',
        [mission.reward_amount, userId]
      );
    }

    return res.json({
      success: true,
      reward_type: mission.reward_type,
      reward_amount: mission.reward_amount,
      newBalance,
    });
  } catch (err) {
    console.warn('[DailyMissions] POST /claim error:', err.message);
    return res.status(500).json({ error: 'Failed to claim mission reward' });
  }
});

module.exports = router;
