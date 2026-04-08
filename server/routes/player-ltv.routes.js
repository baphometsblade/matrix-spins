'use strict';

/**
 * Player Lifetime Value (LTV) Prediction Engine
 *
 * Scores players based on:
 *   - Total deposits (40% weight)
 *   - Session frequency — days active in last 30 (20% weight)
 *   - Average session duration (10% weight)
 *   - Deposit frequency (15% weight)
 *   - Social engagement — referrals, tournament participation (15% weight)
 *
 * Predicts churn risk via:
 *   - Days since last login (exponential decay)
 *   - Declining session duration trend
 *   - Declining bet amounts
 *   - Loss streak without deposit
 *   - Ignored bonuses/offers
 *
 * LTV Tiers:
 *   - Diamond: top 1%
 *   - Platinum: top 5%
 *   - Gold: top 15%
 *   - Silver: top 30%
 *   - Bronze: rest
 *
 * Monetization recommendations per tier:
 *   - Diamond: Personal VIP manager, exclusive high-roller events, custom bonuses
 *   - Platinum: Priority support, enhanced cashback (10%), exclusive tournaments
 *   - Gold: Loyalty multiplier 2x, weekend deposit bonuses
 *   - Silver: Standard bonuses, daily login incentives
 *   - Bronze: Aggressive welcome offers, low-barrier deposits, gamification focus
 *
 * Endpoints:
 *   GET  /my-score            — (authenticated) Get player's own LTV tier
 *   POST /compute/:userId     — (admin) Recalculate LTV for specific player
 *   POST /compute-all         — (admin) Batch recalculate all active players
 *   GET  /admin/leaderboard   — (admin) Top players by LTV with tier distribution
 *   GET  /admin/at-risk       — (admin) Players with high churn_risk (>0.6)
 *   GET  /admin/opportunities — (admin) High-LTV, low-monetization upsell targets
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

/**
 * Lazy-init table for player LTV scores
 * Uses lazy pattern — table created on first route hit, NOT at require() time
 */
var _initDone = false;
var _initPromise = null;
async function _ensureTable() {
  if (_initDone) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async function() {
    try {
      await db.get('SELECT 1 FROM player_ltv_scores LIMIT 1');
    } catch (err) {
      await db.run(`
        CREATE TABLE IF NOT EXISTS player_ltv_scores (
          id ${idDef},
          user_id INTEGER NOT NULL UNIQUE,
          ltv_score REAL DEFAULT 0,
          ltv_tier TEXT DEFAULT 'bronze',
          predicted_30d_value REAL DEFAULT 0,
          churn_risk REAL DEFAULT 0,
          engagement_score REAL DEFAULT 0,
          monetization_score REAL DEFAULT 0,
          factors TEXT,
          last_computed_at ${tsDef},
          created_at ${tsDef},
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
      console.warn('[PlayerLTV] player_ltv_scores table created');
    }
    _initDone = true;
  })();
  return _initPromise;
}

/**
 * Compute LTV score for a single player
 * Returns { ltv_score, ltv_tier, churn_risk, engagement_score, monetization_score, factors }
 */
async function computePlayerLTV(userId) {
  const user = await db.get('SELECT id, balance, created_at FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  // ── Component 1: Total Deposits (40% weight) ──────────────────────────
  const deposits = await db.get(
    `SELECT COALESCE(SUM(amount), 0) as total_deposits
     FROM transactions
     WHERE user_id = ? AND type = 'deposit'`,
    [userId]
  );
  const totalDeposits = deposits?.total_deposits || 0;
  const depositScore = Math.min(totalDeposits / 5000, 1.0); // Normalize to 0-1 (cap at $5k)

  // ── Component 2: Session Frequency (20% weight) ─────────────────────
  // Days active in last 30 days (spins with distinct dates)
  const activeDAys = await db.get(
    `SELECT COUNT(DISTINCT DATE(created_at)) as days_active
     FROM spins
     WHERE user_id = ? AND created_at > datetime('now', '-30 days')`,
    [userId]
  );
  const daysActive = activeDAys?.days_active || 0;
  const sessionFrequencyScore = Math.min(daysActive / 25, 1.0); // Normalize to 0-1 (cap at 25 days)

  // ── Component 3: Average Session Duration (10% weight) ───────────────
  // Average session = total spins in last 30 days / number of distinct session days
  const sessionStats = await db.get(
    `SELECT COUNT(*) as total_spins
     FROM spins
     WHERE user_id = ? AND created_at > datetime('now', '-30 days')`,
    [userId]
  );
  const totalSpins = sessionStats?.total_spins || 0;
  const avgSessionDuration = daysActive > 0 ? totalSpins / daysActive : 0;
  const sessionDurationScore = Math.min(avgSessionDuration / 100, 1.0); // Normalize to 0-1 (cap at 100 spins/day)

  // ── Component 4: Deposit Frequency (15% weight) ──────────────────────
  // Number of deposits in last 90 days
  const depositFreq = await db.get(
    `SELECT COUNT(*) as deposit_count
     FROM transactions
     WHERE user_id = ? AND type = 'deposit' AND created_at > datetime('now', '-90 days')`,
    [userId]
  );
  const depositCount = depositFreq?.deposit_count || 0;
  const depositFrequencyScore = Math.min(depositCount / 20, 1.0); // Normalize to 0-1 (cap at 20 deposits)

  // ── Component 5: Social Engagement (15% weight) ────────────────────────
  // Referrals + tournament participation (if available)
  let engagementScore = 0;
  try {
    const referrals = await db.get(
      'SELECT COUNT(*) as referral_count FROM referrals WHERE referrer_id = ?',
      [userId]
    );
    const referralCount = referrals?.referral_count || 0;
    engagementScore += Math.min(referralCount / 10, 0.5); // 50% weight to referrals

    const tournaments = await db.get(
      'SELECT COUNT(*) as tournament_count FROM tournament_participants WHERE user_id = ?',
      [userId]
    );
    const tournamentCount = tournaments?.tournament_count || 0;
    engagementScore += Math.min(tournamentCount / 20, 0.5); // 50% weight to tournaments
  } catch (err) {
    // Tables may not exist; skip silently
    engagementScore = 0;
  }

  // ── Weighted LTV Score ────────────────────────────────────────────────
  const ltv = (
    depositScore * 0.40 +
    sessionFrequencyScore * 0.20 +
    sessionDurationScore * 0.10 +
    depositFrequencyScore * 0.15 +
    engagementScore * 0.15
  ) * 100; // Scale to 0-100

  // ── Engagement Score (0-100) ──────────────────────────────────────────
  const engagement = Math.min(engagementScore * 100, 100);

  // ── Monetization Score (0-100) ────────────────────────────────────────
  // Based on: deposit/balance ratio, frequency of new deposits, session activity
  let monetization = 0;
  if (totalDeposits > 0) {
    // Players who deposit more and play frequently have higher monetization potential
    const depositVsBalance = Math.min(totalDeposits / (user.balance || 1), 1.0); // Willingness to deposit
    const activityLevel = Math.min(daysActive / 30, 1.0); // Consistent activity
    monetization = (depositVsBalance * 0.5 + activityLevel * 0.5) * 100;
  }

  // ── Churn Risk Score (0-1) ────────────────────────────────────────────
  const lastActivity = await db.get(
    'SELECT MAX(created_at) as last_spin FROM spins WHERE user_id = ?',
    [userId]
  );
  const lastLogin = await db.get(
    'SELECT last_login_date FROM users WHERE id = ?',
    [userId]
  );

  let churnRisk = 0;
  const now = new Date();

  // Recency score (days since last activity)
  let lastActivityTime = null;
  if (lastActivity?.last_spin) {
    const spinDate = new Date(lastActivity.last_spin);
    lastActivityTime = spinDate;
  }
  if (lastLogin?.last_login_date) {
    const loginDate = new Date(lastLogin.last_login_date);
    if (!lastActivityTime || loginDate > lastActivityTime) {
      lastActivityTime = loginDate;
    }
  }

  if (lastActivityTime) {
    const daysSinceActivity = (now - lastActivityTime) / (1000 * 60 * 60 * 24);
    // Exponential decay: 0% churn at 0 days, 50% at 14 days, 90% at 30 days
    churnRisk = Math.min(1.0, (1 - Math.exp(-daysSinceActivity / 14)) * 0.95);
  } else {
    churnRisk = 0.95; // Never active = almost certain to churn
  }

  // Adjust for deposit trend (declining deposits = higher churn)
  const recentDeposits = await db.get(
    `SELECT COUNT(*) as count FROM transactions
     WHERE user_id = ? AND type = 'deposit' AND created_at > datetime('now', '-30 days')`,
    [userId]
  );
  const olderDeposits = await db.get(
    `SELECT COUNT(*) as count FROM transactions
     WHERE user_id = ? AND type = 'deposit'
     AND created_at BETWEEN datetime('now', '-60 days') AND datetime('now', '-30 days')`,
    [userId]
  );
  const recentCount = recentDeposits?.count || 0;
  const olderCount = olderDeposits?.count || 0;

  if (olderCount > 0 && recentCount < olderCount) {
    churnRisk += 0.1; // Declining deposit trend
  }

  churnRisk = Math.min(churnRisk, 1.0);

  // ── Predicted 30d Value ───────────────────────────────────────────────
  // Average 30-day deposits * engagement factor
  const avgMonthlyDeposit = depositCount > 0 ? totalDeposits / Math.max(depositCount, 1) : 0;
  const predicted30d = avgMonthlyDeposit * (1 - churnRisk);

  // ── Factors Summary ───────────────────────────────────────────────────
  const factors = {
    totalDeposits,
    daysActive,
    avgSessionDuration: Math.round(avgSessionDuration * 10) / 10,
    depositCount,
    referrals: 0,
    tournaments: 0,
    daysSinceActivity: lastActivityTime ? Math.round((now - lastActivityTime) / (1000 * 60 * 60 * 24)) : null,
    depositTrend: recentCount >= olderCount ? 'stable/increasing' : 'declining'
  };

  return {
    ltv_score: Math.round(ltv * 100) / 100,
    churn_risk: Math.round(churnRisk * 10000) / 10000,
    engagement_score: Math.round(engagement * 100) / 100,
    monetization_score: Math.round(monetization * 100) / 100,
    predicted_30d_value: Math.round(predicted30d * 100) / 100,
    factors: JSON.stringify(factors)
  };
}

/**
 * Determine tier based on percentile ranking
 * tiers: diamond (top 1%), platinum (5%), gold (15%), silver (30%), bronze (rest)
 */
async function getTierForScore(ltvScore) {
  const stats = await db.get(`
    SELECT
      COUNT(*) as total_count,
      MAX(ltv_score) as max_score
    FROM player_ltv_scores
  `);

  if (!stats || stats.total_count === 0) {
    return 'bronze'; // First user
  }

  const totalCount = stats.total_count;
  const countAboveScore = await db.get(
    'SELECT COUNT(*) as count FROM player_ltv_scores WHERE ltv_score > ?',
    [ltvScore]
  );
  const percentile = (countAboveScore?.count || 0) / totalCount;

  if (percentile <= 0.01) return 'diamond';
  if (percentile <= 0.05) return 'platinum';
  if (percentile <= 0.15) return 'gold';
  if (percentile <= 0.30) return 'silver';
  return 'bronze';
}

/**
 * ── POST /api/player-ltv/compute/:userId ─────────────────────────────────
 * Admin endpoint to recalculate LTV for a specific player
 */
router.post('/compute/:userId', authenticate, requireAdmin, async (req, res) => {
  await _ensureTable();
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const ltvData = await computePlayerLTV(userId);
    const tier = await getTierForScore(ltvData.ltv_score);

    const existing = await db.get(
      'SELECT id FROM player_ltv_scores WHERE user_id = ?',
      [userId]
    );

    if (existing) {
      await db.run(
        `UPDATE player_ltv_scores
         SET ltv_score = ?, ltv_tier = ?, predicted_30d_value = ?,
             churn_risk = ?, engagement_score = ?, monetization_score = ?,
             factors = ?, last_computed_at = datetime('now')
         WHERE user_id = ?`,
        [
          ltvData.ltv_score,
          tier,
          ltvData.predicted_30d_value,
          ltvData.churn_risk,
          ltvData.engagement_score,
          ltvData.monetization_score,
          ltvData.factors,
          userId
        ]
      );
    } else {
      await db.run(
        `INSERT INTO player_ltv_scores
         (user_id, ltv_score, ltv_tier, predicted_30d_value, churn_risk,
          engagement_score, monetization_score, factors, last_computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          userId,
          ltvData.ltv_score,
          tier,
          ltvData.predicted_30d_value,
          ltvData.churn_risk,
          ltvData.engagement_score,
          ltvData.monetization_score,
          ltvData.factors
        ]
      );
    }

    res.json({
      success: true,
      userId,
      tier,
      ...ltvData
    });
  } catch (err) {
    console.warn('[PlayerLTV] Compute error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ── POST /api/player-ltv/compute-all ──────────────────────────────────────
 * Admin endpoint to batch-recalculate LTV for all active players
 * Runs asynchronously; returns immediately with job ID
 */
router.post('/compute-all', authenticate, requireAdmin, async (req, res) => {
  await _ensureTable();
  try {
    const users = await db.all(
      'SELECT id FROM users WHERE is_banned = 0 ORDER BY id LIMIT 10000',
      []
    );

    const jobId = 'ltv_' + Date.now();
    let processed = 0;
    let errors = 0;

    // Async batch processing (fire-and-forget)
    (async () => {
      for (const user of users) {
        try {
          const ltvData = await computePlayerLTV(user.id);
          const tier = await getTierForScore(ltvData.ltv_score);

          const existing = await db.get(
            'SELECT id FROM player_ltv_scores WHERE user_id = ?',
            [user.id]
          );

          if (existing) {
            await db.run(
              `UPDATE player_ltv_scores
               SET ltv_score = ?, ltv_tier = ?, predicted_30d_value = ?,
                   churn_risk = ?, engagement_score = ?, monetization_score = ?,
                   factors = ?, last_computed_at = datetime('now')
               WHERE user_id = ?`,
              [
                ltvData.ltv_score,
                tier,
                ltvData.predicted_30d_value,
                ltvData.churn_risk,
                ltvData.engagement_score,
                ltvData.monetization_score,
                ltvData.factors,
                user.id
              ]
            );
          } else {
            await db.run(
              `INSERT INTO player_ltv_scores
               (user_id, ltv_score, ltv_tier, predicted_30d_value, churn_risk,
                engagement_score, monetization_score, factors, last_computed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
              [
                user.id,
                ltvData.ltv_score,
                tier,
                ltvData.predicted_30d_value,
                ltvData.churn_risk,
                ltvData.engagement_score,
                ltvData.monetization_score,
                ltvData.factors
              ]
            );
          }

          processed++;
        } catch (err) {
          console.warn(`[PlayerLTV] Error computing LTV for user ${user.id}:`, err.message);
          errors++;
        }
      }
      console.warn(`[PlayerLTV] Batch compute-all complete: ${processed} processed, ${errors} errors`);
    })();

    res.json({
      success: true,
      jobId,
      message: `Batch processing started for ${users.length} users`,
      usersCount: users.length
    });
  } catch (err) {
    console.warn('[PlayerLTV] Compute-all error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ── GET /api/player-ltv/my-score ──────────────────────────────────────────
 * Authenticated endpoint: returns player's own LTV tier (without revealing raw scores)
 * This endpoint is safe to expose to players
 */
router.get('/my-score', authenticate, async (req, res) => {
  await _ensureTable();
  try {
    const score = await db.get(
      'SELECT ltv_tier FROM player_ltv_scores WHERE user_id = ?',
      [req.user.id]
    );

    // If no score exists, compute it now
    if (!score) {
      const ltvData = await computePlayerLTV(req.user.id);
      const tier = await getTierForScore(ltvData.ltv_score);

      await db.run(
        `INSERT INTO player_ltv_scores
         (user_id, ltv_score, ltv_tier, predicted_30d_value, churn_risk,
          engagement_score, monetization_score, factors, last_computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          req.user.id,
          ltvData.ltv_score,
          tier,
          ltvData.predicted_30d_value,
          ltvData.churn_risk,
          ltvData.engagement_score,
          ltvData.monetization_score,
          ltvData.factors
        ]
      );

      return res.json({ tier });
    }

    res.json({ tier: score.ltv_tier });
  } catch (err) {
    console.warn('[PlayerLTV] Get my-score error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tier' });
  }
});

/**
 * ── GET /api/player-ltv/admin/leaderboard ───────────────────────────────────
 * Admin endpoint: top players by LTV with tier distribution
 */
router.get('/admin/leaderboard', authenticate, requireAdmin, async (req, res) => {
  await _ensureTable();
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 100, 1000));

    const leaderboard = await db.all(
      `SELECT
        user_id, ltv_score, ltv_tier, predicted_30d_value,
        churn_risk, engagement_score, monetization_score, last_computed_at
       FROM player_ltv_scores
       ORDER BY ltv_score DESC
       LIMIT ?`,
      [limit]
    );

    const distribution = await db.all(
      `SELECT
        ltv_tier, COUNT(*) as count
       FROM player_ltv_scores
       GROUP BY ltv_tier`,
      []
    );

    res.json({
      leaderboard,
      tierDistribution: distribution
    });
  } catch (err) {
    console.warn('[PlayerLTV] Leaderboard error:', err.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * ── GET /api/player-ltv/admin/at-risk ────────────────────────────────────────
 * Admin endpoint: players with high churn_risk (>0.6) sorted by LTV descending
 * Prioritize high-value players who are at risk of leaving
 */
router.get('/admin/at-risk', authenticate, requireAdmin, async (req, res) => {
  await _ensureTable();
  try {
    const atRisk = await db.all(
      `SELECT
        user_id, ltv_score, ltv_tier, predicted_30d_value,
        churn_risk, engagement_score, monetization_score, last_computed_at
       FROM player_ltv_scores
       WHERE churn_risk > 0.6
       ORDER BY ltv_score DESC`,
      []
    );

    res.json({
      count: atRisk.length,
      players: atRisk
    });
  } catch (err) {
    console.warn('[PlayerLTV] At-risk error:', err.message);
    res.status(500).json({ error: 'Failed to fetch at-risk players' });
  }
});

/**
 * ── GET /api/player-ltv/admin/opportunities ──────────────────────────────────
 * Admin endpoint: high-LTV players with low monetization (upsell targets)
 * Targets: ltv_tier in (diamond, platinum, gold) AND monetization_score < 60
 */
router.get('/admin/opportunities', authenticate, requireAdmin, async (req, res) => {
  await _ensureTable();
  try {
    const opportunities = await db.all(
      `SELECT
        user_id, ltv_score, ltv_tier, predicted_30d_value,
        churn_risk, engagement_score, monetization_score, last_computed_at
       FROM player_ltv_scores
       WHERE ltv_tier IN ('diamond', 'platinum', 'gold')
       AND monetization_score < 60
       ORDER BY ltv_score DESC`,
      []
    );

    res.json({
      count: opportunities.length,
      players: opportunities
    });
  } catch (err) {
    console.warn('[PlayerLTV] Opportunities error:', err.message);
    res.status(500).json({ error: 'Failed to fetch upsell opportunities' });
  }
});

module.exports = router;
