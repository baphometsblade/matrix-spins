'use strict';

const express = require('express');
const db = require('../database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Tier display order: mini → minor → major → grand
const TIER_ORDER = { mini: 0, minor: 1, major: 2, grand: 3 };

// ROUND 28: Removed custom authenticate — it skipped blacklist, ban, and
// password_changed_at checks. Banned users could contribute to / claim jackpots.
// Now uses centralized authenticate middleware.

/**
 * Initialize jackpot tables if they don't exist
 */
async function _ensureJackpotTables() {
  var isPg = !!process.env.DATABASE_URL;

  // Check if tables exist
  const checkTableSql = isPg
    ? "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='jackpot_pool')"
    : "SELECT name FROM sqlite_master WHERE type='table' AND name='jackpot_pool'";

  const tableExists = await db.get(checkTableSql);
  if (tableExists) return; // Tables already exist, jackpot.service.js will seed them

  // Create contribution tracking table
  const createContribSql = isPg
    ? `CREATE TABLE IF NOT EXISTS jackpot_contributions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pool_tier TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
    : `CREATE TABLE IF NOT EXISTS jackpot_contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        pool_tier TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`;

  // Create wins tracking table
  const createWinsSql = isPg
    ? `CREATE TABLE IF NOT EXISTS jackpot_wins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        pool_tier TEXT NOT NULL,
        amount_won NUMERIC(12,2) NOT NULL,
        won_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
    : `CREATE TABLE IF NOT EXISTS jackpot_wins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        pool_tier TEXT NOT NULL,
        amount_won REAL NOT NULL,
        won_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`;

  try {
    await db.run(createContribSql, []);
    await db.run(createWinsSql, []);
  } catch (err) {
    console.warn('[Jackpot] Table initialization (non-critical):', err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/jackpot/status  (public — no auth required)
// Returns live pool amounts from jackpot_pool (managed by jackpot.service.js)
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  try {
    await _ensureJackpotTables();

    const rows = await db.all(
      `SELECT jp.tier, jp.current_amount, jp.seed_amount, jp.last_won_at,
              u.username AS last_winner_username
       FROM jackpot_pool jp
       LEFT JOIN users u ON jp.last_winner_id = u.id
       LIMIT 10`
    );

    const pools = rows
      .sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99))
      .map(row => ({
        tier: row.tier,
        currentAmount: parseFloat(row.current_amount) || 0,
        lastWinner: row.last_winner_username
          ? { username: row.last_winner_username, wonAt: row.last_won_at }
          : null,
      }));

    return res.json({ pools });
  } catch (err) {
    console.warn('[Jackpot] status error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch jackpot status' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/jackpot/pools  (public — alias for /status)
// Client-side code calls /pools; maps to the same data as /status
// ---------------------------------------------------------------------------
router.get('/pools', async (req, res) => {
  try {
    await _ensureJackpotTables();

    const rows = await db.all(
      `SELECT jp.tier, jp.current_amount, jp.seed_amount, jp.last_won_at,
              u.username AS last_winner_username
       FROM jackpot_pool jp
       LEFT JOIN users u ON jp.last_winner_id = u.id
       LIMIT 10`
    );

    const pools = rows
      .sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99))
      .map(row => ({
        tier: row.tier,
        currentAmount: parseFloat(row.current_amount) || 0,
        seedAmount: parseFloat(row.seed_amount) || 0,
        lastWinner: row.last_winner_username
          ? { username: row.last_winner_username, wonAt: row.last_won_at }
          : null,
      }));

    return res.json({ pools });
  } catch (err) {
    console.warn('[Jackpot] pools error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch jackpot pools' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/jackpot/contribute  (auth required)
// Called after each spin to contribute % of bet to jackpot pools
// Checks for jackpot win triggers
// ---------------------------------------------------------------------------
router.post('/contribute', authenticate, async (req, res) => {
  try {
    await _ensureJackpotTables();

    const userId = req.user.userId || req.user.id;

    // ROUND 39: Self-exclusion check (regulatory compliance)
    try {
        var exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            return res.status(403).json({ error: 'Account is self-excluded.' });
        }
    } catch (exclErr) {
        if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
        else {
            console.error('[SelfExcl] Check failed:', exclErr.message);
            return res.status(500).json({ error: 'Security check failed' });
        }
    }

    const { betAmount } = req.body;

    if (!betAmount || betAmount <= 0) {
      return res.status(400).json({ error: 'Invalid bet amount' });
    }

    // Use jackpot service to process contribution
    const jackpotService = require('../services/jackpot.service');
    const win = await jackpotService.processJackpotContribution(userId, betAmount);

    // Log contribution
    const totalContrib = Math.round(betAmount * config.JACKPOT_CONTRIBUTION_RATE * 100) / 100;
    if (totalContrib > 0) {
      try {
        await db.run(
          `INSERT INTO jackpot_contributions (user_id, pool_tier, amount) VALUES (?, ?, ?)`,
          [userId, 'total', totalContrib]
        );
      } catch (e) {
        console.warn('[Jackpot] Contribution log failed:', e.message);
      }
    }

    // If there was a win, log it
    if (win) {
      try {
        await db.run(
          `INSERT INTO jackpot_wins (user_id, pool_tier, amount_won) VALUES (?, ?, ?)`,
          [userId, win.tier, win.amount]
        );
      } catch (e) {
        // CRITICAL: Win audit trail must not silently fail — log for compliance
        console.error('[Jackpot] WIN LOG FAILED — audit gap:', e.message, { userId, tier: win.tier, amount: win.amount });
      }
    }

    return res.json({
      contributed: totalContrib > 0,
      win: win || null,
    });
  } catch (err) {
    console.warn('[Jackpot] contribute error:', err.message);
    return res.status(500).json({ error: 'Failed to process jackpot contribution' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/jackpot/winners  (public)
// Returns recent jackpot winners (last 20)
// ---------------------------------------------------------------------------
router.get('/winners', async (req, res) => {
  try {
    await _ensureJackpotTables();

    const rows = await db.all(
      `SELECT jw.pool_tier, jw.amount_won, jw.won_at, u.username
       FROM jackpot_wins jw
       LEFT JOIN users u ON jw.user_id = u.id
       ORDER BY jw.won_at DESC
       LIMIT 20`
    );

    const winners = rows.map(row => ({
      tier: row.pool_tier,
      amount: parseFloat(row.amount_won) || 0,
      wonAt: row.won_at,
      winner: row.username || 'Anonymous',
    }));

    return res.json({ winners });
  } catch (err) {
    console.warn('[Jackpot] winners error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch winners' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/jackpot/history  (auth required)
// Returns user's personal jackpot win history
// ---------------------------------------------------------------------------
router.get('/history', authenticate, async (req, res) => {
  try {
    await _ensureJackpotTables();

    const userId = req.user.userId || req.user.id;

    const rows = await db.all(
      `SELECT pool_tier, amount_won, won_at
       FROM jackpot_wins
       WHERE user_id = ?
       ORDER BY won_at DESC
       LIMIT 50`,
      [userId]
    );

    const history = rows.map(row => ({
      tier: row.pool_tier,
      amount: parseFloat(row.amount_won) || 0,
      wonAt: row.won_at,
    }));

    return res.json({ history });
  } catch (err) {
    console.warn('[Jackpot] history error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch jackpot history' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/jackpot/mywin  (auth required)
// Returns the most recent jackpot win for the authenticated user (last 24h)
// ---------------------------------------------------------------------------
router.get('/mywin', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const row = await db.get(
      `SELECT amount, reference, created_at
       FROM transactions
       WHERE user_id = ?
         AND type = 'jackpot'
         AND created_at > datetime('now', '-1 day')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!row) return res.json({ recentWin: null });

    const tierMatch = row.reference
      ? row.reference.toLowerCase().match(/^(mini|minor|major|grand)/)
      : null;
    const tier = tierMatch ? tierMatch[1] : null;

    return res.json({
      recentWin: { amount: parseFloat(row.amount), tier, wonAt: row.created_at },
    });
  } catch (err) {
    console.warn('[Jackpot] mywin error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch recent win' });
  }
});

module.exports = router;
