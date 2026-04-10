'use strict';

var express = require('express');
const crypto = require('crypto');
var db = require('../database');
var { authenticate, requireAdmin } = require('../middleware/auth');

var router = express.Router();

// Database initialization state
var _initDone = false;
var _initPromise = null;

/**
 * Pool Initialization Metadata
 */
var DEFAULT_POOLS = [
  {
    poolName: 'Community Chest',
    targetAmount: 1000,
    contributionRate: 0.02,
  },
  {
    poolName: 'Mega Millions',
    targetAmount: 10000,
    contributionRate: 0.01,
  },
  {
    poolName: 'Lightning Strike',
    targetAmount: 500,
    contributionRate: 0.03,
  },
];

/**
 * Lazy initialization of social_jackpots and social_jackpot_contributions tables
 */
function _initTables() {
  if (_initDone) return Promise.resolve();
  if (_initPromise) return _initPromise;

  _initPromise = (async function () {
    try {
      var isPg = db.isPg();
      var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
      var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

      // Check if tables exist
      var checkSql = isPg
        ? "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='social_jackpots')"
        : "SELECT name FROM sqlite_master WHERE type='table' AND name='social_jackpots'";

      var tableExists = await db.get(checkSql, []);

      if (!tableExists) {
        // Create social_jackpots table
        var createPoolsSql = isPg
          ? `CREATE TABLE social_jackpots (
              id ${idDef},
              pool_name TEXT NOT NULL UNIQUE,
              current_amount NUMERIC(12,2) DEFAULT 0,
              target_amount NUMERIC(12,2) NOT NULL,
              contribution_rate NUMERIC(5,3) DEFAULT 0.02,
              total_contributors INTEGER DEFAULT 0,
              winner_id INTEGER,
              won_at ${tsDef},
              status TEXT DEFAULT 'active',
              created_at ${tsDef},
              FOREIGN KEY (winner_id) REFERENCES users(id)
            )`
          : `CREATE TABLE social_jackpots (
              id ${idDef},
              pool_name TEXT NOT NULL UNIQUE,
              current_amount REAL DEFAULT 0,
              target_amount REAL NOT NULL,
              contribution_rate REAL DEFAULT 0.02,
              total_contributors INTEGER DEFAULT 0,
              winner_id INTEGER,
              won_at ${tsDef},
              status TEXT DEFAULT 'active',
              created_at ${tsDef},
              FOREIGN KEY (winner_id) REFERENCES users(id)
            )`;

        // Create social_jackpot_contributions table
        var createContribSql = isPg
          ? `CREATE TABLE social_jackpot_contributions (
              id ${idDef},
              pool_id INTEGER NOT NULL,
              user_id INTEGER NOT NULL,
              amount NUMERIC(12,2) NOT NULL,
              contributed_at ${tsDef},
              FOREIGN KEY (pool_id) REFERENCES social_jackpots(id),
              FOREIGN KEY (user_id) REFERENCES users(id)
            )`
          : `CREATE TABLE social_jackpot_contributions (
              id ${idDef},
              pool_id INTEGER NOT NULL,
              user_id INTEGER NOT NULL,
              amount REAL NOT NULL,
              contributed_at ${tsDef},
              FOREIGN KEY (pool_id) REFERENCES social_jackpots(id),
              FOREIGN KEY (user_id) REFERENCES users(id)
            )`;

        await db.run(createPoolsSql, []);
        await db.run(createContribSql, []);

        // Seed default pools
        for (var i = 0; i < DEFAULT_POOLS.length; i++) {
          var pool = DEFAULT_POOLS[i];
          await db.run(
            `INSERT INTO social_jackpots (pool_name, target_amount, contribution_rate) VALUES (?, ?, ?)`,
            [pool.poolName, pool.targetAmount, pool.contributionRate]
          );
        }

        console.warn('[SocialJackpot] Tables created and seeded with 3 default pools');
      }

      _initDone = true;
    } catch (err) {
      console.warn('[SocialJackpot] Table initialization error:', err.message);
      _initDone = true;
    }
  })();

  return _initPromise;
}

/**
 * GET /api/social-jackpot/pools
 * Public endpoint — List all active jackpot pools with progress %
 */
router.get('/pools', async function (req, res) {
  try {
    await _initTables();

    var rows = await db.all(
      `SELECT id, pool_name, current_amount, target_amount, contribution_rate, total_contributors, won_at
       FROM social_jackpots
       WHERE status = ?
       ORDER BY created_at ASC`,
      ['active']
    );

    var pools = rows.map(function (row) {
      var current = parseFloat(row.current_amount) || 0;
      var target = parseFloat(row.target_amount) || 1;
      var progress = Math.min((current / target) * 100, 100);

      return {
        id: row.id,
        poolName: row.pool_name,
        currentAmount: current,
        targetAmount: target,
        progressPercent: Math.round(progress * 10) / 10,
        contributionRate: parseFloat(row.contribution_rate) || 0.02,
        totalContributors: row.total_contributors || 0,
        lastWonAt: row.won_at || null,
      };
    });

    return res.json({ pools: pools });
  } catch (err) {
    console.warn('[SocialJackpot] GET /pools error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

/**
 * POST /api/social-jackpot/contribute
 * Authenticated endpoint — Add contribution from a spin
 * Called automatically on each spin. Amount = bet * contribution_rate
 */
router.post('/contribute', authenticate, async function (req, res) {
  try {
    await _initTables();

    var userId = req.user.id;

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

    var betAmount = parseFloat(req.body.betAmount);

    // ROUND 58: Number.isFinite + minimum $0.10 bet — prevents zero-contribution jackpot eligibility
    if (!Number.isFinite(betAmount) || betAmount < 0.10) {
      return res.status(400).json({ error: 'Minimum $0.10 bet required for jackpot contribution' });
    }

    // Get all active pools
    var pools = await db.all(
      `SELECT id, pool_name, current_amount, target_amount, contribution_rate, total_contributors
       FROM social_jackpots
       WHERE status = ?`,
      ['active']
    );

    var contributions = [];

    // Contribute to each pool
    for (var i = 0; i < pools.length; i++) {
      var pool = pools[i];
      var contributionAmount = betAmount * (parseFloat(pool.contribution_rate) || 0.02);

      if (contributionAmount > 0) {
        // Add contribution to pool
        await db.run(
          `UPDATE social_jackpots SET current_amount = current_amount + ? WHERE id = ?`,
          [contributionAmount, pool.id]
        );

        // Log contribution
        await db.run(
          `INSERT INTO social_jackpot_contributions (pool_id, user_id, amount) VALUES (?, ?, ?)`,
          [pool.id, userId, contributionAmount]
        );

        // Update total contributors (distinct count)
        var contributorCount = await db.get(
          `SELECT COUNT(DISTINCT user_id) as cnt FROM social_jackpot_contributions WHERE pool_id = ?`,
          [pool.id]
        );
        var contribCount = (contributorCount && contributorCount.cnt) || 0;

        await db.run(
          `UPDATE social_jackpots SET total_contributors = ? WHERE id = ?`,
          [contribCount, pool.id]
        );

        contributions.push({
          poolId: pool.id,
          poolName: pool.pool_name,
          contributedAmount: contributionAmount,
        });
      }
    }

    return res.json({ contributions: contributions });
  } catch (err) {
    console.warn('[SocialJackpot] POST /contribute error:', err.message);
    return res.status(500).json({ error: 'Failed to process contribution' });
  }
});

/**
 * POST /api/social-jackpot/check-winner
 * Authenticated endpoint — Roll for jackpot win
 * Probability = (contribution_amount / remaining_to_target) * base_rate
 */
router.post('/check-winner', authenticate, async function (req, res) {
  try {
    await _initTables();

    var userId = req.user.id;

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

    var poolId = req.body.poolId;

    if (!poolId) {
      return res.status(400).json({ error: 'poolId required' });
    }

    // Get pool details
    var pool = await db.get(
      `SELECT id, pool_name, current_amount, target_amount FROM social_jackpots WHERE id = ? AND status = ?`,
      [poolId, 'active']
    );

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    var current = parseFloat(pool.current_amount) || 0;
    var target = parseFloat(pool.target_amount) || 1;
    var remaining = Math.max(target - current, 0);

    // Get user's last contribution to this pool (last 24h)
    var lastContrib = await db.get(
      `SELECT amount FROM social_jackpot_contributions
       WHERE pool_id = ? AND user_id = ? AND contributed_at > datetime('now', '-1 day')
       ORDER BY contributed_at DESC LIMIT 1`,
      [poolId, userId]
    );

    if (!lastContrib) {
      return res.status(400).json({ error: 'No recent contribution to this pool' });
    }

    var userContribAmount = parseFloat(lastContrib.amount) || 0;
    var baseWinRate = 0.0001; // 0.01% base win rate per $1 of contribution

    // Probability calculation:
    // Higher contributions = better odds
    // As pool fills up, odds improve (remaining decreases)
    var winOdds = (userContribAmount / Math.max(remaining, 1)) * baseWinRate;
    var roll = (crypto.randomBytes(4).readUInt32BE(0) / 0x100000000);

    var won = roll < winOdds;

    if (won) {
      // Update pool: set winner and reset
      var user = await db.get(`SELECT username FROM users WHERE id = ?`, [userId]);
      var winnerName = (user && user.username) || 'Player';

      await db.run(
        `UPDATE social_jackpots SET winner_id = ?, status = ?, won_at = datetime('now') WHERE id = ?`,
        [userId, 'won', poolId]
      );

      // ROUND 39: CRITICAL — Actually credit the winner's balance.
      // Previously: pool was marked as won but winner never received funds.
      var winAmount = Math.round(current * 100) / 100;
      if (winAmount > 0) {
        await db.run(
          'UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE id = ?',
          [winAmount, userId]
        );

        // Record transaction for audit trail
        try {
          await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'jackpot', ?, ?)",
            [userId, winAmount, 'Social Jackpot Win: ' + pool.pool_name + ' — $' + winAmount.toFixed(2)]
          );
        } catch (txLogErr) {
          console.warn('[SocialJackpot] Transaction log failed:', txLogErr.message);
        }
      }

      return res.json({
        won: true,
        poolId: poolId,
        poolName: pool.pool_name,
        amount: winAmount,
        winnerName: winnerName,
        odds: Math.round(winOdds * 10000) / 100,
      });
    }

    return res.json({
      won: false,
      odds: Math.round(winOdds * 10000) / 100,
    });
  } catch (err) {
    console.warn('[SocialJackpot] POST /check-winner error:', err.message);
    return res.status(500).json({ error: 'Failed to check winner' });
  }
});

/**
 * GET /api/social-jackpot/my-contributions
 * Authenticated endpoint — Player's total contributions and odds
 */
router.get('/my-contributions', authenticate, async function (req, res) {
  try {
    await _initTables();

    var userId = req.user.id;

    var rows = await db.all(
      `SELECT sp.id, sp.pool_name, sp.current_amount, sp.target_amount,
              SUM(sjc.amount) as user_total
       FROM social_jackpots sp
       LEFT JOIN social_jackpot_contributions sjc ON sp.id = sjc.pool_id AND sjc.user_id = ?
       WHERE sp.status = ?
       GROUP BY sp.id
       ORDER BY sp.created_at ASC`,
      [userId, 'active']
    );

    var contributions = rows.map(function (row) {
      var current = parseFloat(row.current_amount) || 0;
      var target = parseFloat(row.target_amount) || 1;
      var remaining = Math.max(target - current, 0);
      var userTotal = parseFloat(row.user_total) || 0;
      var baseWinRate = 0.0001;
      var odds = (userTotal / Math.max(remaining, 1)) * baseWinRate;

      return {
        poolId: row.id,
        poolName: row.pool_name,
        userContribution: userTotal,
        poolProgress: Math.round((current / target) * 1000) / 10,
        estimatedOdds: Math.round(odds * 10000) / 100,
      };
    });

    return res.json({ contributions: contributions });
  } catch (err) {
    console.warn('[SocialJackpot] GET /my-contributions error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch contributions' });
  }
});

/**
 * GET /api/social-jackpot/recent-winners
 * Public endpoint — Last 10 jackpot winners for social proof
 */
router.get('/recent-winners', async function (req, res) {
  try {
    await _initTables();

    var rows = await db.all(
      `SELECT sp.pool_name, sp.current_amount, sp.won_at, u.username
       FROM social_jackpots sp
       LEFT JOIN users u ON sp.winner_id = u.id
       WHERE sp.status = ? AND sp.winner_id IS NOT NULL
       ORDER BY sp.won_at DESC
       LIMIT 10`,
      ['won']
    );

    var winners = rows.map(function (row) {
      return {
        poolName: row.pool_name,
        amount: parseFloat(row.current_amount) || 0,
        wonAt: row.won_at,
        winner: row.username || 'Anonymous Player',
      };
    });

    return res.json({ winners: winners });
  } catch (err) {
    console.warn('[SocialJackpot] GET /recent-winners error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch winners' });
  }
});

/**
 * POST /api/social-jackpot/admin/create-pool
 * Admin endpoint — Create new jackpot pool
 */
router.post('/admin/create-pool', authenticate, requireAdmin, async function (req, res) {
  try {
    await _initTables();

    var poolName = req.body.poolName;
    var targetAmount = req.body.targetAmount;
    var contributionRate = req.body.contributionRate || 0.02;

    if (!poolName || !targetAmount || targetAmount <= 0) {
      return res.status(400).json({ error: 'poolName and targetAmount required' });
    }

    // Insert new pool
    var result = await db.run(
      `INSERT INTO social_jackpots (pool_name, target_amount, contribution_rate) VALUES (?, ?, ?)`,
      [poolName, targetAmount, contributionRate]
    );

    var poolId = result.lastInsertRowid;

    return res.json({
      poolId: poolId,
      poolName: poolName,
      targetAmount: targetAmount,
      contributionRate: contributionRate,
    });
  } catch (err) {
    console.warn('[SocialJackpot] POST /admin/create-pool error:', err.message);
    return res.status(500).json({ error: 'Failed to create pool' });
  }
});

/**
 * POST /api/social-jackpot/admin/reset-pool/:poolId
 * Admin endpoint — Reset a pool after it's won
 */
router.post('/admin/reset-pool/:poolId', authenticate, requireAdmin, async function (req, res) {
  try {
    await _initTables();

    var poolId = parseInt(req.params.poolId, 10);

    if (!poolId) {
      return res.status(400).json({ error: 'Invalid poolId' });
    }

    // Get pool details
    var pool = await db.get(
      `SELECT id, pool_name, target_amount, contribution_rate FROM social_jackpots WHERE id = ?`,
      [poolId]
    );

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    // Reset pool
    await db.run(
      `UPDATE social_jackpots SET current_amount = 0, winner_id = NULL, won_at = NULL, status = ? WHERE id = ?`,
      ['active', poolId]
    );

    return res.json({
      poolId: poolId,
      poolName: pool.pool_name,
      message: 'Pool reset successfully',
    });
  } catch (err) {
    console.warn('[SocialJackpot] POST /admin/reset-pool error:', err.message);
    return res.status(500).json({ error: 'Failed to reset pool' });
  }
});

module.exports = router;
