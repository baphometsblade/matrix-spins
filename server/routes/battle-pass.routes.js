'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');
const rateLimit = require('express-rate-limit');
const purchaseLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many purchase attempts, please slow down' },
});

// ============================================================================
// LAZY INIT: Create tables and seed data on first request (not at require-time)
// ============================================================================
var _bpInitDone = false;
var _bpInitPromise = null;

async function _ensureBattlePassData() {
  if (_bpInitDone) return;
  if (_bpInitPromise) return _bpInitPromise;
  _bpInitPromise = (async function() {
    try {
      const isPg = db.isPg();
      const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

      await db.run(`CREATE TABLE IF NOT EXISTS battle_passes (
        id ${idDef},
        season_number INTEGER NOT NULL UNIQUE,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        premium_price INTEGER NOT NULL,
        elite_price INTEGER NOT NULL,
        rewards TEXT NOT NULL,
        created_at ${tsDef}
      )`);

      await db.run(`CREATE TABLE IF NOT EXISTS battle_pass_purchases (
        id ${idDef},
        user_id INTEGER NOT NULL,
        pass_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        purchased_at ${tsDef},
        UNIQUE(user_id, pass_id)
      )`);

      await db.run(`CREATE TABLE IF NOT EXISTS battle_pass_user_progress (
        id ${idDef},
        user_id INTEGER NOT NULL,
        pass_id INTEGER NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        current_level INTEGER NOT NULL DEFAULT 1,
        last_xp_gain ${tsDef},
        updated_at ${tsDef},
        UNIQUE(user_id, pass_id)
      )`);

      await db.run(`CREATE TABLE IF NOT EXISTS battle_pass_claims (
        id ${idDef},
        user_id INTEGER NOT NULL,
        pass_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        tier_claimed TEXT NOT NULL,
        claimed_at ${tsDef},
        UNIQUE(user_id, pass_id, level)
      )`);

      // ROUND 39: DB-backed XP rate limiting table
      await db.run(`CREATE TABLE IF NOT EXISTS bp_xp_rate_log (
        id ${idDef},
        user_id INTEGER NOT NULL,
        xp_amount INTEGER NOT NULL,
        created_at ${tsDef}
      )`);

      console.warn('[BattlePass] Tables ready');

      // Seed initial battle pass if not exists
      const existing = await db.get(
        'SELECT id FROM battle_passes WHERE season_number = ?',
        [1]
      );

      if (!existing) {
        const rewards = generateRewardsStructure();
        await db.run(
          'INSERT INTO battle_passes (season_number, name, start_date, end_date, premium_price, elite_price, rewards) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [1, 'Season 1: Matrix Rising', '2026-03-01', '2026-04-30', 999, 2499, JSON.stringify(rewards)]
        );
        console.warn('[BattlePass] Seeded Season 1: Matrix Rising');
      } else {
        // Ensure dates are wide enough (fix for UTC timezone offset)
        await db.run(
          'UPDATE battle_passes SET start_date = ?, end_date = ? WHERE season_number = ? AND start_date > ?',
          ['2026-03-01', '2026-04-30', 1, '2026-03-01']
        );
      }

      _bpInitDone = true;
    } catch (err) {
      console.warn('[BattlePass] Lazy init error:', err.message);
      _bpInitPromise = null; // Allow retry
    }
  })();
  return _bpInitPromise;
}

// ============================================================================
// REWARD STRUCTURE GENERATION
// ============================================================================
function generateRewardsStructure() {
  const rewards = {};

  // Reward definitions for milestone levels
  const milestones = {
    1: {
      free: { coins: 100 },
      premium: { coins: 250 },
      elite: { coins: 500 }
    },
    2: {
      free: { coins: 150 },
      premium: { coins: 350 },
      elite: { coins: 700 }
    },
    3: {
      free: { coins: 200 },
      premium: { coins: 450 },
      elite: { coins: 900 }
    },
    4: {
      free: { coins: 300 },
      premium: { coins: 600 },
      elite: { coins: 1200 }
    },
    5: {
      free: { coins: 500 },
      premium: { coins: 1000, gems: 10 },
      elite: { coins: 2000, gems: 25 }
    },
    6: {
      free: { coins: 600 },
      premium: { coins: 1200, gems: 12 },
      elite: { coins: 2400, gems: 30 }
    },
    7: {
      free: { coins: 700 },
      premium: { coins: 1400, gems: 14 },
      elite: { coins: 2800, gems: 35 }
    },
    8: {
      free: { coins: 800 },
      premium: { coins: 1600, gems: 16 },
      elite: { coins: 3200, gems: 40 }
    },
    9: {
      free: { coins: 900 },
      premium: { coins: 1800, gems: 18 },
      elite: { coins: 3600, gems: 45 }
    },
    10: {
      free: { coins: 1000 },
      premium: { coins: 2500, gems: 25 },
      elite: { coins: 5000, gems: 50, item: 'Neon Frame' }
    },
    11: {
      free: { coins: 1200 },
      premium: { coins: 2800, gems: 28 },
      elite: { coins: 5600, gems: 56, item: null }
    },
    12: {
      free: { coins: 1400 },
      premium: { coins: 3100, gems: 31 },
      elite: { coins: 6200, gems: 62, item: null }
    },
    13: {
      free: { coins: 1600 },
      premium: { coins: 3400, gems: 34 },
      elite: { coins: 6800, gems: 68, item: null }
    },
    14: {
      free: { coins: 1800 },
      premium: { coins: 3700, gems: 37 },
      elite: { coins: 7400, gems: 74, item: null }
    },
    15: {
      free: { coins: 2000 },
      premium: { coins: 5000, gems: 50 },
      elite: { coins: 10000, gems: 100, item: 'Matrix Avatar' }
    },
    16: {
      free: { coins: 2300 },
      premium: { coins: 5500, gems: 55 },
      elite: { coins: 11000, gems: 110, item: null }
    },
    17: {
      free: { coins: 2600 },
      premium: { coins: 6000, gems: 60 },
      elite: { coins: 12000, gems: 120, item: null }
    },
    18: {
      free: { coins: 2900 },
      premium: { coins: 6500, gems: 65 },
      elite: { coins: 13000, gems: 130, item: null }
    },
    19: {
      free: { coins: 3200 },
      premium: { coins: 7000, gems: 70 },
      elite: { coins: 14000, gems: 140, item: null }
    },
    20: {
      free: { coins: 5000 },
      premium: { coins: 10000, gems: 100 },
      elite: { coins: 25000, gems: 250, item: 'Gold Win Effect' }
    },
    21: {
      free: { coins: 5500 },
      premium: { coins: 11000, gems: 110 },
      elite: { coins: 27500, gems: 275, item: null }
    },
    22: {
      free: { coins: 6000 },
      premium: { coins: 12000, gems: 120 },
      elite: { coins: 30000, gems: 300, item: null }
    },
    23: {
      free: { coins: 6500 },
      premium: { coins: 13000, gems: 130 },
      elite: { coins: 32500, gems: 325, item: null }
    },
    24: {
      free: { coins: 7000 },
      premium: { coins: 14000, gems: 140 },
      elite: { coins: 35000, gems: 350, item: null }
    },
    25: {
      free: { coins: 10000 },
      premium: { coins: 25000, gems: 200 },
      elite: { coins: 50000, gems: 500, item: 'Diamond Frame' }
    },
    26: {
      free: { coins: 11000 },
      premium: { coins: 27500, gems: 220 },
      elite: { coins: 55000, gems: 550, item: null }
    },
    27: {
      free: { coins: 12000 },
      premium: { coins: 30000, gems: 240 },
      elite: { coins: 60000, gems: 600, item: null }
    },
    28: {
      free: { coins: 13000 },
      premium: { coins: 32500, gems: 260 },
      elite: { coins: 65000, gems: 650, item: null }
    },
    29: {
      free: { coins: 14000 },
      premium: { coins: 35000, gems: 280 },
      elite: { coins: 70000, gems: 700, item: null }
    },
    30: {
      free: { coins: 25000 },
      premium: { coins: 50000, gems: 500 },
      elite: { coins: 100000, gems: 1000, item: 'Legendary Matrix Set' }
    }
  };

  for (let level = 1; level <= 30; level++) {
    if (milestones[level]) {
      rewards[level] = milestones[level];
    }
  }

  return rewards;
}

// ============================================================================
// XP RATE LIMITING — DB-backed (persistent across restarts & instances)
// ============================================================================
const XP_RATE_LIMIT_CAP = 200; // 200 XP per minute

// ROUND 39: Moved from in-memory Map to database-backed rate limiting.
// In-memory limiter reset on server restart, allowing unlimited XP farming.
async function checkXpRateLimitDB(userId) {
  try {
    // Sum XP gained in the last 60 seconds from battle_pass_user_progress updates
    var row = await db.get(
        `SELECT COALESCE(SUM(xp_amount), 0) as total_xp
         FROM bp_xp_rate_log
         WHERE user_id = ? AND created_at > datetime('now', '-60 seconds')`,
        [userId]
    );
    var usedXp = row ? (row.total_xp || 0) : 0;
    var remaining = Math.max(XP_RATE_LIMIT_CAP - usedXp, 0);
    return { allowed: remaining > 0, remaining: remaining };
  } catch (err) {
    // If table doesn't exist yet, allow (will be created in init)
    if (err.message && err.message.includes('no such table')) {
      return { allowed: true, remaining: XP_RATE_LIMIT_CAP };
    }
    console.error('[BattlePass] XP rate limit check error:', err.message);
    // Fail-closed: block XP if rate limit check fails
    return { allowed: false, remaining: 0 };
  }
}

async function logXpGain(userId, xp) {
  try {
    await db.run(
      'INSERT INTO bp_xp_rate_log (user_id, xp_amount) VALUES (?, ?)',
      [userId, xp]
    );
  } catch (err) {
    // Non-fatal — rate log is defensive, don't block XP for logging failure
    console.warn('[BattlePass] XP rate log insert error:', err.message);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function calculateLevelFromXp(totalXp) {
  let level = 1;
  let accumulatedXp = 0;

  for (let i = 1; i <= 30; i++) {
    const xpRequired = i * 100;
    if (accumulatedXp + xpRequired > totalXp) {
      break;
    }
    accumulatedXp += xpRequired;
    level = i + 1;
  }

  return Math.min(level, 30);
}

function getTotalXpForLevel(level) {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += i * 100;
  }
  return total;
}

// ============================================================================
// ROUTES
// ============================================================================

// GET / — Get active battle pass info (public basics, full with auth)
router.get('/', async (req, res) => {
  try {
    await _ensureBattlePassData();
    // Get current active pass (by date)
    const isPg = db.isPg();
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    const pass = await db.get(
      `SELECT id, season_number, name, start_date, end_date, premium_price, elite_price, rewards
       FROM battle_passes
       WHERE start_date <= ${dateFunc} AND end_date >= ${dateFunc}
       ORDER BY season_number DESC
       LIMIT 1`,
      []
    );

    if (!pass) {
      return res.json({ active: false, message: 'No active battle pass' });
    }

    const rewards = JSON.parse(pass.rewards);
    const response = {
      id: pass.id,
      season_number: pass.season_number,
      name: pass.name,
      start_date: pass.start_date,
      end_date: pass.end_date,
      premium_price: pass.premium_price,
      elite_price: pass.elite_price,
      max_level: 30,
      rewards: rewards
    };

    // If authenticated, add user progress
    if (req.headers.authorization) {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          const jwt = require('jsonwebtoken');
          const config = require('../config');

          try {
            const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
            const user = await db.get('SELECT id FROM users WHERE id = ?', [payload.userId]);

            if (user) {
              const progress = await db.get(
                'SELECT xp, current_level FROM battle_pass_user_progress WHERE user_id = ? AND pass_id = ?',
                [user.id, pass.id]
              );

              const purchase = await db.get(
                'SELECT tier FROM battle_pass_purchases WHERE user_id = ? AND pass_id = ?',
                [user.id, pass.id]
              );

              response.user_progress = {
                xp: progress ? progress.xp : 0,
                current_level: progress ? progress.current_level : 1,
                tier: purchase ? purchase.tier : 'free'
              };
            }
          } catch (e) {
            // Token invalid, skip user progress
          }
        }
      } catch (e) {
        // Silently ignore auth errors for public endpoint
      }
    }

    res.json(response);
  } catch (err) {
    console.warn('[BattlePass] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to load battle pass' });
  }
});

// GET /progress — User's detailed progress (authenticated)
router.get('/progress', authenticate, async (req, res) => {
  try {
    await _ensureBattlePassData();
    const userId = req.user.id;

    // Get current active pass
    const isPg = db.isPg();
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    const pass = await db.get(
      `SELECT id, season_number, name, start_date, end_date, premium_price, elite_price, rewards
       FROM battle_passes
       WHERE start_date <= ${dateFunc} AND end_date >= ${dateFunc}
       ORDER BY season_number DESC
       LIMIT 1`,
      []
    );

    if (!pass) {
      return res.status(404).json({ error: 'No active battle pass' });
    }

    // Get or create user progress
    let progress = await db.get(
      'SELECT xp, current_level FROM battle_pass_user_progress WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    if (!progress) {
      await db.run(
        'INSERT INTO battle_pass_user_progress (user_id, pass_id, xp, current_level) VALUES (?, ?, 0, 1)',
        [userId, pass.id]
      );
      progress = { xp: 0, current_level: 1 };
    }

    // Get user's tier
    const purchase = await db.get(
      'SELECT tier FROM battle_pass_purchases WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    const tier = purchase ? purchase.tier : 'free';

    // Get claimed rewards
    const claims = await db.all(
      'SELECT level FROM battle_pass_claims WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    const claimedLevels = new Set(claims.map(c => c.level));

    const rewards = JSON.parse(pass.rewards);
    const xpForNextLevel = (progress.current_level + 1) * 100;
    const xpForCurrentLevel = progress.current_level * 100;
    const xpInCurrentLevel = progress.xp - getTotalXpForLevel(progress.current_level);
    const progressToNextLevel = Math.max(0, Math.min(100, Math.floor((xpInCurrentLevel / xpForCurrentLevel) * 100)));

    res.json({
      season_number: pass.season_number,
      name: pass.name,
      tier: tier,
      current_level: progress.current_level,
      total_xp: progress.xp,
      xp_for_next_level: xpForNextLevel,
      progress_to_next_level: progressToNextLevel,
      claimed_levels: Array.from(claimedLevels),
      max_level: 30
    });
  } catch (err) {
    console.warn('[BattlePass] GET /progress error:', err.message);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// POST /purchase — Buy premium or elite tier (authenticated)
router.post('/purchase', authenticate, purchaseLimit, async (req, res) => {
  try {
    await _ensureBattlePassData();
    const userId = req.user.id;

    // ROUND 39: Self-exclusion check (regulatory compliance)
    try {
        var exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            return res.status(403).json({ error: 'Account is self-excluded. Purchases are disabled.' });
        }
    } catch (exclErr) {
        if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
        else {
            console.error('[SelfExcl] Check failed:', exclErr.message);
            return res.status(500).json({ error: 'Security check failed' });
        }
    }

    const { tier } = req.body;

    if (!tier || !['premium', 'elite'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be premium or elite.' });
    }

    // Get current active pass
    const isPg = db.isPg();
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    const pass = await db.get(
      `SELECT id, season_number, premium_price, elite_price
       FROM battle_passes
       WHERE start_date <= ${dateFunc} AND end_date >= ${dateFunc}
       ORDER BY season_number DESC
       LIMIT 1`,
      []
    );

    if (!pass) {
      return res.status(404).json({ error: 'No active battle pass' });
    }

    // Check if user already purchased this pass
    const existing = await db.get(
      'SELECT tier FROM battle_pass_purchases WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    if (existing && existing.tier !== 'free') {
      return res.status(400).json({ error: `Already purchased ${existing.tier} tier` });
    }

    const price = tier === 'premium' ? pass.premium_price : pass.elite_price;

    // Check user's gem balance
    const user = await db.get('SELECT gems FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentGems = user.gems || 0;
    if (currentGems < price) {
      return res.status(400).json({
        error: 'Insufficient gems',
        required: price,
        available: currentGems
      });
    }

    // ── Wrap gem deduction + purchase record in transaction ──
    // Prevents: gems deducted but purchase INSERT/UPDATE fails → lost gems
    await db.beginTransaction();
    try {
      // Atomic deduction with balance guard
      var deductResult = await db.run(
        'UPDATE users SET gems = gems - ? WHERE id = ? AND gems >= ?',
        [price, userId, price]
      );
      if (!deductResult || deductResult.changes === 0) {
        await db.rollback();
        return res.status(400).json({ error: 'Insufficient gems' });
      }

      if (existing) {
        // Upgrade from free to premium/elite
        await db.run(
          'UPDATE battle_pass_purchases SET tier = ? WHERE user_id = ? AND pass_id = ?',
          [tier, userId, pass.id]
        );
      } else {
        // New purchase
        await db.run(
          'INSERT INTO battle_pass_purchases (user_id, pass_id, tier) VALUES (?, ?, ?)',
          [userId, pass.id, tier]
        );
      }

      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (rbErr) { console.warn('[BattlePass] Rollback error:', rbErr.message); }
      throw txErr;
    }

    res.json({
      success: true,
      tier: tier,
      gems_spent: price,
      season_number: pass.season_number
    });
  } catch (err) {
    console.warn('[BattlePass] POST /purchase error:', err.message);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

// POST /claim — Claim reward for a level (authenticated)
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
  try {
    await _ensureBattlePassData();
    const userId = req.user.id;

    // ROUND 39: Self-exclusion check (regulatory compliance)
    try {
        var exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            return res.status(403).json({ error: 'Account is self-excluded. Rewards are disabled.' });
        }
    } catch (exclErr) {
        if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
        else {
            console.error('[SelfExcl] Check failed:', exclErr.message);
            return res.status(500).json({ error: 'Security check failed' });
        }
    }

    const { level } = req.body;

    if (!level || level < 1 || level > 30 || !Number.isInteger(level)) {
      return res.status(400).json({ error: 'Invalid level. Must be 1-30.' });
    }

    // Get current active pass
    const isPg = db.isPg();
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    const pass = await db.get(
      `SELECT id, season_number, rewards
       FROM battle_passes
       WHERE start_date <= ${dateFunc} AND end_date >= ${dateFunc}
       ORDER BY season_number DESC
       LIMIT 1`,
      []
    );

    if (!pass) {
      return res.status(404).json({ error: 'No active battle pass' });
    }

    // Get user progress
    const progress = await db.get(
      'SELECT current_level FROM battle_pass_user_progress WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    if (!progress || progress.current_level < level) {
      return res.status(400).json({
        error: 'Level not reached',
        current_level: progress ? progress.current_level : 1,
        required_level: level
      });
    }

    // Check if already claimed
    const claimed = await db.get(
      'SELECT tier_claimed FROM battle_pass_claims WHERE user_id = ? AND pass_id = ? AND level = ?',
      [userId, pass.id, level]
    );

    if (claimed) {
      return res.status(400).json({
        error: 'Reward already claimed',
        level: level,
        tier_claimed: claimed.tier_claimed
      });
    }

    // Get user's tier
    const purchase = await db.get(
      'SELECT tier FROM battle_pass_purchases WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    const tier = purchase ? purchase.tier : 'free';

    // Get reward definition
    const rewards = JSON.parse(pass.rewards);
    const levelReward = rewards[level];

    if (!levelReward) {
      return res.status(400).json({ error: 'Reward not defined for this level' });
    }

    // Get the appropriate reward tier
    const reward = levelReward[tier];

    if (!reward) {
      return res.status(400).json({ error: `No ${tier} reward for this level` });
    }

    // ── Wrap claim + reward credit in transaction ──
    // INSERT first with UNIQUE(user_id, pass_id, level) constraint → prevents double-claim.
    // Only credit rewards if INSERT succeeds (wasn't already claimed).
    const coins = reward.coins || 0;
    const gems = reward.gems || 0;

    await db.beginTransaction();
    try {
      // This INSERT will fail (UNIQUE constraint) if already claimed — preventing double-credit
      await db.run(
        'INSERT INTO battle_pass_claims (user_id, pass_id, level, tier_claimed) VALUES (?, ?, ?, ?)',
        [userId, pass.id, level, tier]
      );

      // Credit coins to bonus_balance (NOT withdrawable balance) with 20x wagering per CLAUDE.md
      // Battle pass rewards are free bonuses — must use bonus_balance to prevent revenue leak
      if (coins > 0 || gems > 0) {
        const updateParts = [];
        const updateValues = [];

        if (coins > 0) {
          updateParts.push('bonus_balance = COALESCE(bonus_balance, 0) + ?');
          updateValues.push(coins);
          updateParts.push('wagering_requirement = COALESCE(wagering_requirement, 0) + ?');
          updateValues.push(coins * 20);
        }

        if (gems > 0) {
          updateParts.push('gems = COALESCE(gems, 0) + ?');
          updateValues.push(gems);
        }

        updateValues.push(userId);

        await db.run(
          `UPDATE users SET ${updateParts.join(', ')} WHERE id = ?`,
          updateValues
        );
      }

      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (rbErr) { console.warn('[BattlePass] Rollback error:', rbErr.message); }
      // UNIQUE constraint violation = already claimed
      if (txErr.message && txErr.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Reward already claimed', level: level });
      }
      throw txErr;
    }

    res.json({
      success: true,
      level: level,
      tier: tier,
      reward: reward,
      coins_awarded: coins,
      gems_awarded: gems
    });
  } catch (err) {
    console.warn('[BattlePass] POST /claim error:', err.message);
    res.status(500).json({ error: 'Claim failed' });
  }
});

// POST /add-xp — Add XP from gameplay (authenticated, rate-limited)
router.post('/add-xp', authenticate, async (req, res) => {
  try {
    await _ensureBattlePassData();
    const userId = req.user.id;
    const { xp, source } = req.body;

    if (!xp || !Number.isInteger(xp) || xp < 1 || xp > 50) {
      return res.status(400).json({ error: 'XP must be an integer between 1 and 50' });
    }

    // ROUND 32: Server-side XP validation — verify user actually played a spin recently.
    // Previously accepted any XP amount (1-50) from client with no gameplay verification.
    // Players could POST arbitrary XP to level up instantly.
    try {
      var recentSpin = await db.get(
        "SELECT id FROM spins WHERE user_id = ? AND created_at >= datetime('now', '-2 minutes') LIMIT 1",
        [userId]
      );
      if (!recentSpin) {
        return res.status(400).json({ error: 'No recent gameplay detected. XP requires active play.' });
      }
    } catch (xpValidErr) {
      console.error('[BattlePass] XP validation failed:', xpValidErr.message);
      return res.status(500).json({ error: 'Validation failed' });
    }

    // ROUND 39: DB-backed rate limit check (persistent across restarts)
    const rateLimit = await checkXpRateLimitDB(userId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Maximum 200 XP per minute. Try again later.'
      });
    }

    if (xp > rateLimit.remaining) {
      return res.status(429).json({
        error: 'Insufficient rate limit remaining',
        requested: xp,
        remaining: rateLimit.remaining
      });
    }

    // Get current active pass
    const isPg = db.isPg();
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    const pass = await db.get(
      `SELECT id FROM battle_passes
       WHERE start_date <= ${dateFunc} AND end_date >= ${dateFunc}
       ORDER BY season_number DESC
       LIMIT 1`,
      []
    );

    if (!pass) {
      return res.status(404).json({ error: 'No active battle pass' });
    }

    // Get or create user progress
    let progress = await db.get(
      'SELECT xp, current_level FROM battle_pass_user_progress WHERE user_id = ? AND pass_id = ?',
      [userId, pass.id]
    );

    if (!progress) {
      await db.run(
        'INSERT INTO battle_pass_user_progress (user_id, pass_id, xp, current_level) VALUES (?, ?, ?, 1)',
        [userId, pass.id, xp]
      );
      progress = { xp: xp, current_level: 1 };
    } else {
      const newXp = progress.xp + xp;
      const newLevel = calculateLevelFromXp(newXp);

      await db.run(
        'UPDATE battle_pass_user_progress SET xp = ?, current_level = ? WHERE user_id = ? AND pass_id = ?',
        [newXp, newLevel, userId, pass.id]
      );

      progress = { xp: newXp, current_level: newLevel };
    }

    // ROUND 39: Log XP gain to DB for persistent rate limiting
    await logXpGain(userId, xp);

    res.json({
      success: true,
      xp_gained: xp,
      total_xp: progress.xp,
      current_level: progress.current_level,
      source: source || 'game'
    });
  } catch (err) {
    console.warn('[BattlePass] POST /add-xp error:', err.message);
    res.status(500).json({ error: 'Failed to add XP' });
  }
});

// GET /leaderboard — Top 20 players by XP (public)
router.get('/leaderboard', async (req, res) => {
  try {
    await _ensureBattlePassData();
    // Get current active pass
    const isPg = db.isPg();
    const dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

    const pass = await db.get(
      `SELECT id FROM battle_passes
       WHERE start_date <= ${dateFunc} AND end_date >= ${dateFunc}
       ORDER BY season_number DESC
       LIMIT 1`,
      []
    );

    if (!pass) {
      return res.json({ leaderboard: [] });
    }

    const leaderboard = await db.all(
      `SELECT
        u.id,
        u.username,
        bp.xp,
        bp.current_level,
        CASE
          WHEN bpp.tier IS NOT NULL THEN bpp.tier
          ELSE 'free'
        END as tier
      FROM battle_pass_user_progress bp
      JOIN users u ON bp.user_id = u.id
      LEFT JOIN battle_pass_purchases bpp ON bp.user_id = bpp.user_id AND bp.pass_id = bpp.pass_id
      WHERE bp.pass_id = ?
      ORDER BY bp.xp DESC
      LIMIT 20`,
      [pass.id]
    );

    res.json({
      leaderboard: leaderboard || []
    });
  } catch (err) {
    console.warn('[BattlePass] GET /leaderboard error:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

module.exports = router;
