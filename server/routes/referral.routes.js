'use strict';

/**
 * Referral System Routes
 *
 * Endpoints:
 *   GET  /api/referral              — Get user's referral code + stats
 *   POST /api/referral/claim        — Claim a referral code during signup
 *   POST /api/referral/reward       — Award bonuses when referred user deposits
 *   GET  /api/referral/admin/stats  — Admin referral statistics
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

/**
 * Bootstrap the referral tables on module load.
 * Creates:
 *   - referral_codes (user's referral code + generation timestamp)
 *   - referral_claims (tracks referrer → referred relationships & bonus state)
 */
async function bootstrapTables() {
  try {
    var isPg = db.isPg();
    var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

    await db.run(
      'CREATE TABLE IF NOT EXISTS referral_codes (' +
      '  id ' + idDef + ',' +
      '  user_id INTEGER NOT NULL UNIQUE,' +
      '  code TEXT NOT NULL UNIQUE,' +
      '  created_at ' + tsDef +
      ')'
    );

    await db.run(
      'CREATE TABLE IF NOT EXISTS referral_claims (' +
      '  id ' + idDef + ',' +
      '  referrer_id INTEGER NOT NULL,' +
      '  referred_id INTEGER NOT NULL UNIQUE,' +
      '  bonus_given INTEGER DEFAULT 0,' +
      '  created_at ' + tsDef +
      ')'
    );
    console.warn('[Referral] Tables initialized');
  } catch (err) {
    console.warn('[Referral] bootstrapTables error:', err.message);
  }
}

// Ensure tables exist on load
bootstrapTables();

/**
 * Generate a referral code from username + random alphanumeric.
 * Format: first 3 chars of username (uppercase) + 5 random alphanumeric chars
 */
function generateReferralCode(username) {
  const prefix = username.substring(0, 3).toUpperCase();
  const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let random = '';
  for (let i = 0; i < 5; i++) {
    random += randomChars.charAt(Math.floor((crypto.randomBytes(4).readUInt32BE(0) / 0x100000000) * randomChars.length));
  }
  return prefix + random;
}

/**
 * ── GET /api/referral ──────────────────────────────────────────────────
 * Get the user's referral code and referral statistics.
 *
 * If the user doesn't have a referral code yet, generate one.
 *
 * Response:
 *   {
 *     code: string,
 *     totalReferred: number,
 *     totalEarned: number,
 *     referrals: [
 *       {
 *         referred_id: number,
 *         referred_username: string,
 *         bonus_given: boolean,
 *         created_at: string
 *       }
 *     ]
 *   }
 */
router.get('/', authenticate, async (req, res) => {
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


    // Check if user already has a referral code
    let refCode = await db.get(
      'SELECT code FROM referral_codes WHERE user_id = ?',
      [userId]
    );

    // If not, generate one
    if (!refCode) {
      const newCode = generateReferralCode(req.user.username);
      await db.run(
        'INSERT INTO referral_codes (user_id, code) VALUES (?, ?)',
        [userId, newCode]
      );
      refCode = { code: newCode };
    }

    // Get referral statistics
    const stats = await db.get(`
      SELECT
        COUNT(*) as total_referred,
        SUM(CASE WHEN bonus_given = 1 THEN 25 ELSE 0 END) as total_earned
      FROM referral_claims
      WHERE referrer_id = ?
    `, [userId]);

    const totalReferred = stats?.total_referred ? parseInt(stats.total_referred, 10) : 0;
    const totalEarned = stats?.total_earned ? parseFloat(stats.total_earned) : 0;

    // Get list of referrals with referred user details (paginated)
    const refLimit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const refOffset = Math.max(parseInt(req.query.offset) || 0, 0);
    const referrals = await db.all(`
      SELECT
        rc.referred_id,
        u.username as referred_username,
        rc.bonus_given,
        rc.created_at
      FROM referral_claims rc
      JOIN users u ON u.id = rc.referred_id
      WHERE rc.referrer_id = ?
      ORDER BY rc.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, refLimit, refOffset]);

    return res.json({
      code: refCode.code,
      totalReferred,
      totalEarned,
      referrals: referrals.map(r => ({
        referred_id: r.referred_id,
        referred_username: r.referred_username,
        bonus_given: r.bonus_given === 1,
        created_at: r.created_at
      }))
    });
  } catch (err) {
    console.warn('[Referral] GET / error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch referral data' });
  }
});

/**
 * ── POST /api/referral/claim ───────────────────────────────────────────
 * Claim a referral code during signup flow.
 *
 * Request body:
 *   { code: string }
 *
 * Validations:
 *   - Code must exist in referral_codes
 *   - User cannot be the one who created the code (self-referral)
 *   - User cannot already be referred by someone else
 *
 * Response:
 *   { success: true, referrer_username: string }
 */
router.post('/claim', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    // Validate code provided
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Find the referral code owner
    const refCode = await db.get(
      'SELECT user_id FROM referral_codes WHERE code = ?',
      [code]
    );

    if (!refCode) {
      return res.status(400).json({ error: 'Referral code not found' });
    }

    const referrerId = refCode.user_id;

    // Prevent self-referral
    if (referrerId === userId) {
      return res.status(400).json({ error: 'Cannot refer yourself' });
    }

    // ROUND 45: Account age gate — prevent bot farming. Accounts must be at
    // least 10 minutes old to claim a referral code.
    try {
        var account = await db.get('SELECT created_at FROM users WHERE id = ?', [userId]);
        if (account && account.created_at) {
            var ageMs = Date.now() - new Date(account.created_at).getTime();
            if (ageMs < 10 * 60 * 1000) {
                return res.status(400).json({ error: 'Please wait a few minutes before claiming a referral code' });
            }
        }
    } catch (ageErr) {
        // Non-critical — allow through if check fails
    }

    // ROUND 36: IP-based referral fraud detection
    var clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    try {
        var referrerUser = await db.get('SELECT registration_ip FROM users WHERE id = ?', [referrerId]);
        if (referrerUser && referrerUser.registration_ip && referrerUser.registration_ip === clientIp) {
            console.warn('[Referral] Blocked same-IP referral: referrer=' + referrerId + ' referred=' + userId + ' IP=' + clientIp);
            return res.status(400).json({ error: 'Referral not available for this account' });
        }
    } catch (ipErr) {
        if (!ipErr.message || !ipErr.message.includes('no such column')) {
            console.warn('[Referral] IP check error:', ipErr.message);
        }
    }

    // ROUND 36: Per-referrer daily cap — max 5 referral rewards per day
    try {
        var todayReferrals = await db.get(
            "SELECT COUNT(*) as cnt FROM referral_claims WHERE referrer_id = ? AND created_at >= date('now')",
            [referrerId]
        );
        if (todayReferrals && todayReferrals.cnt >= 5) {
            return res.status(400).json({ error: 'Referral limit reached for today' });
        }
    } catch (refErr) {
        if (!refErr.message || !refErr.message.includes('no such')) {
            console.warn('[Referral] Daily cap check error:', refErr.message);
        }
    }

    // ROUND 45: Anti-circular referral — block A→B if B→A already exists.
    // Two colluding users could otherwise exchange referral codes and both
    // collect $25+$15+gems for no real recruitment.
    try {
        var reverseReferral = await db.get(
            'SELECT id FROM referral_claims WHERE referrer_id = ? AND referred_id = ?',
            [userId, referrerId]
        );
        if (reverseReferral) {
            return res.status(400).json({ error: 'Circular referral detected' });
        }
    } catch (circErr) {
        if (!circErr.message || !circErr.message.includes('no such')) {
            console.warn('[Referral] Circular check error:', circErr.message);
        }
    }

    // Check if user is already referred
    const existingClaim = await db.get(
      'SELECT id FROM referral_claims WHERE referred_id = ?',
      [userId]
    );

    if (existingClaim) {
      return res.status(400).json({ error: 'You have already been referred' });
    }

    // Record the claim
    await db.run(
      'INSERT INTO referral_claims (referrer_id, referred_id, bonus_given) VALUES (?, ?, ?)',
      [referrerId, userId, 0]
    );

    // Get referrer username for response
    const referrer = await db.get(
      'SELECT username FROM users WHERE id = ?',
      [referrerId]
    );

    return res.json({
      success: true,
      referrer_username: referrer?.username || 'Unknown'
    });
  } catch (err) {
    console.warn('[Referral] POST /claim error:', err.message);
    return res.status(500).json({ error: 'Failed to claim referral code' });
  }
});

/**
 * ── POST /api/referral/reward ──────────────────────────────────────────
 * Award bonuses when a referred user makes their first deposit.
 *
 * Called internally when referred user deposits. Awards:
 *   - Referrer: $25 bonus
 *   - Referred user: $15 bonus
 *
 * Request body:
 *   { referred_user_id: number } (optional, defaults to authenticated user)
 *
 * Response:
 *   {
 *     success: true,
 *     referrer_bonus: 25,
 *     referred_bonus: 15
 *   }
 */
router.post('/reward', authenticate, bonusGuard, async (req, res) => {
  try {
    // SECURITY: Only the referred user themselves can trigger this reward.
    // Previously accepted req.body.referred_user_id, allowing any authenticated
    // user to trigger the $25+$15 bonus for ANY referral pair.
    const referredUserId = req.user.id;

    // ── ABUSE PREVENTION: Verify referred user has made at least one deposit ──
    var depositCheck = null;
    try {
      depositCheck = await db.get(
        "SELECT id FROM deposits WHERE user_id = ? AND status = 'completed' LIMIT 1",
        [referredUserId]
      );
    } catch (_) { /* deposits table may not exist yet */ }
    if (!depositCheck) {
      return res.status(400).json({ error: 'Referred user must make a deposit before claiming referral bonus' });
    }

    // ── ATOMIC: Wrap entire reward flow in transaction to prevent double-reward ──
    await db.beginTransaction();

    // Find unclaimed referral record — inside transaction for atomicity
    const claim = await db.get(
      'SELECT referrer_id, bonus_given FROM referral_claims WHERE referred_id = ? AND bonus_given = 0',
      [referredUserId]
    );

    if (!claim) {
      await db.rollback();
      return res.status(400).json({ error: 'No pending referral bonus found' });
    }

    const referrerId = claim.referrer_id;
    // SECURITY FIX: Referral bonuses go to bonus_balance with 10x wagering requirement
    // Previously credited to real balance — allowed immediate withdrawal of referral funds
    var referrerBonus = 25;
    var referredBonus = 15;
    const wageringMultiplier = 10;

    // ROUND 55: Cap referral bonuses to remaining daily bonus limit
    var totalReferralBonus = referrerBonus + referredBonus;
    if (req.bonusCapRemaining !== undefined && totalReferralBonus > req.bonusCapRemaining) {
        // Split remaining cap proportionally between referrer (62.5%) and referred (37.5%)
        var remaining = Math.max(0, req.bonusCapRemaining);
        if (remaining <= 0) {
            await db.rollback();
            return res.status(400).json({ error: 'Daily bonus limit reached' });
        }
        referrerBonus = Math.floor(remaining * 0.625 * 100) / 100;
        referredBonus = Math.floor(remaining * 0.375 * 100) / 100;
    }

    // Verify both users exist
    const referrer = await db.get('SELECT balance FROM users WHERE id = ?', [referrerId]);
    const referred = await db.get('SELECT balance FROM users WHERE id = ?', [referredUserId]);

    if (!referrer || !referred) {
      await db.rollback();
      return res.status(400).json({ error: 'User not found' });
    }

    // Credit referrer bonus to bonus_balance with wagering requirement
    await db.run(
      'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
      [referrerBonus, referrerBonus * wageringMultiplier, referrerId]
    );
    await db.run(
      'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
      [referrerId, 'referral_bonus', referrerBonus, parseFloat(referrer.balance), parseFloat(referrer.balance), 'Referral bonus (bonus_balance) for user ' + referredUserId]
    );

    // Credit referred user bonus to bonus_balance with wagering requirement
    // Also award the 200 signup gems that were deferred from /apply
    await db.run(
      'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, gems = COALESCE(gems, 0) + 200 WHERE id = ?',
      [referredBonus, referredBonus * wageringMultiplier, referredUserId]
    );
    await db.run(
      'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
      [referredUserId, 'referral_bonus', referredBonus, parseFloat(referred.balance), parseFloat(referred.balance), 'Referral bonus (bonus_balance) from user ' + referrerId]
    );

    // Award referrer the 500 gems (deferred from /apply)
    await db.run(
      'UPDATE users SET gems = COALESCE(gems, 0) + 500 WHERE id = ?',
      [referrerId]
    );

    // Mark bonus as given — LAST step, inside transaction
    await db.run('UPDATE referral_claims SET bonus_given = 1 WHERE referred_id = ?', [referredUserId]);

    await db.commit();

    return res.json({
      success: true,
      referrer_bonus: referrerBonus,
      referred_bonus: referredBonus
    });
  } catch (err) {
    try { await db.rollback(); } catch (_rbErr) { console.warn('[Referral] rollback error:', _rbErr.message); }
    console.warn('[Referral] POST /reward error:', err.message);
    return res.status(500).json({ error: 'Failed to award referral bonus' });
  }
});

/**
 * ── GET /api/referral/code ─────────────────────────────────────────────
 * Get or generate user's unique referral code (for new unified system).
 *
 * Response:
 *   {
 *     code: string,
 *     created_at: string
 *   }
 */
router.get('/code', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user already has a referral code
    let refCode = await db.get(
      'SELECT code, created_at FROM referral_codes WHERE user_id = ?',
      [userId]
    );

    // If not, generate one
    if (!refCode) {
      const newCode = generateReferralCode(req.user.username);
      await db.run(
        'INSERT INTO referral_codes (user_id, code) VALUES (?, ?)',
        [userId, newCode]
      );
      refCode = { code: newCode, created_at: new Date().toISOString() };
    }

    return res.json({
      code: refCode.code,
      created_at: refCode.created_at
    });
  } catch (err) {
    console.warn('[Referral] GET /code error:', err.message);
    return res.status(500).json({ error: 'Failed to get referral code' });
  }
});

/**
 * ── GET /api/referral/stats ────────────────────────────────────────────
 * Get referral stats (total invites, gems earned, recent referrals).
 *
 * Response:
 *   {
 *     totalReferrals: number,
 *     totalGemsEarned: number,
 *     recentReferrals: [
 *       {
 *         username: string,
 *         created_at: string
 *       }
 *     ]
 *   }
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get total referrals and gems earned
    const stats = await db.get(`
      SELECT
        COUNT(*) as total_referred,
        SUM(CASE WHEN bonus_given = 1 THEN 500 ELSE 0 END) as total_gems
      FROM referral_claims
      WHERE referrer_id = ?
    `, [userId]);

    const totalReferrals = stats?.total_referred ? parseInt(stats.total_referred, 10) : 0;
    const totalGemsEarned = stats?.total_gems ? parseInt(stats.total_gems, 10) : 0;

    // Get recent referrals (last 5)
    const recentReferrals = await db.all(`
      SELECT
        u.username,
        rc.created_at
      FROM referral_claims rc
      JOIN users u ON u.id = rc.referred_id
      WHERE rc.referrer_id = ?
      ORDER BY rc.created_at DESC
      LIMIT 5
    `, [userId]);

    return res.json({
      totalReferrals,
      totalGemsEarned,
      recentReferrals: recentReferrals.map(r => ({
        username: r.username,
        created_at: r.created_at
      }))
    });
  } catch (err) {
    console.warn('[Referral] GET /stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch referral stats' });
  }
});

/**
 * ── GET /api/referral/leaderboard ──────────────────────────────────────
 * Get top referrers leaderboard (top 5).
 *
 * Response:
 *   {
 *     leaderboard: [
 *       {
 *         rank: number,
 *         username: string,
 *         referrals: number,
 *         gemsEarned: number
 *       }
 *     ]
 *   }
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const topReferrers = await db.all(`
      SELECT
        u.username,
        COUNT(*) as referral_count,
        SUM(CASE WHEN rc.bonus_given = 1 THEN 500 ELSE 0 END) as total_gems
      FROM referral_claims rc
      JOIN users u ON u.id = rc.referrer_id
      GROUP BY rc.referrer_id, u.id
      ORDER BY referral_count DESC
      LIMIT 5
    `);

    const leaderboard = topReferrers.map((r, idx) => ({
      rank: idx + 1,
      username: r.username,
      referrals: parseInt(r.referral_count, 10),
      gemsEarned: parseInt(r.total_gems || 0, 10)
    }));

    return res.json({ leaderboard });
  } catch (err) {
    console.warn('[Referral] GET /leaderboard error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * ── POST /api/referral/apply ───────────────────────────────────────────
 * Apply a referral code (for new users on signup).
 *
 * Request body:
 *   { code: string }
 *
 * Validations:
 *   - Code must exist
 *   - User cannot self-refer
 *   - User cannot be already referred
 *   - Max 50 referrals per code
 *
 * Response:
 *   {
 *     success: true,
 *     message: string
 *   }
 */
router.post('/apply', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Invalid referral code' });
    }

    // Find the referral code owner
    const refCode = await db.get(
      'SELECT user_id FROM referral_codes WHERE code = ?',
      [code.toUpperCase()]
    );

    if (!refCode) {
      return res.status(400).json({ error: 'Referral code not found' });
    }

    const referrerId = refCode.user_id;

    // Prevent self-referral
    if (referrerId === userId) {
      return res.status(400).json({ error: 'Cannot refer yourself' });
    }

    // Check if user is already referred
    const existingClaim = await db.get(
      'SELECT id FROM referral_claims WHERE referred_id = ?',
      [userId]
    );

    if (existingClaim) {
      return res.status(400).json({ error: 'You have already been referred' });
    }

    // Check max uses (50 per code)
    const codeStats = await db.get(
      'SELECT COUNT(*) as uses FROM referral_claims WHERE referrer_id = ?',
      [referrerId]
    );

    const currentUses = codeStats?.uses ? parseInt(codeStats.uses, 10) : 0;
    if (currentUses >= 50) {
      return res.status(400).json({ error: 'This referral code has reached its limit' });
    }

    // SECURITY FIX: Record the referral claim but DO NOT award gems yet.
    // Referred user gets 200 gems only after first deposit (prevents bot farming).
    // Referrer gets 500 gems only after referred user's first deposit (via /reward endpoint).
    // Previously awarded all gems immediately at signup — allowed mass bot account gem farming.
    await db.run(
      'INSERT INTO referral_claims (referrer_id, referred_id, bonus_given) VALUES (?, ?, ?)',
      [referrerId, userId, 0]
    );

    return res.json({
      success: true,
      message: 'Referral code applied! You and your referrer will receive bonus gems after your first deposit.'
    });
  } catch (err) {
    console.warn('[Referral] POST /apply error:', err.message);
    return res.status(500).json({ error: 'Failed to apply referral code' });
  }
});

/**
 * ── GET /api/referral/info ─────────────────────────────────────────────
 * Get complete referral info (code + stats + leaderboard).
 * Used by referral dashboard.
 *
 * Response:
 *   {
 *     code: string,
 *     stats: { totalReferrals, totalGemsEarned, recentReferrals },
 *     leaderboard: [...]
 *   }
 */
router.get('/info', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's code
    let refCode = await db.get(
      'SELECT code FROM referral_codes WHERE user_id = ?',
      [userId]
    );

    if (!refCode) {
      const newCode = generateReferralCode(req.user.username);
      await db.run(
        'INSERT INTO referral_codes (user_id, code) VALUES (?, ?)',
        [userId, newCode]
      );
      refCode = { code: newCode };
    }

    // Get stats
    const stats = await db.get(`
      SELECT
        COUNT(*) as total_referred,
        SUM(CASE WHEN bonus_given = 1 THEN 500 ELSE 0 END) as total_gems
      FROM referral_claims
      WHERE referrer_id = ?
    `, [userId]);

    const totalReferrals = stats?.total_referred ? parseInt(stats.total_referred, 10) : 0;
    const totalGemsEarned = stats?.total_gems ? parseInt(stats.total_gems, 10) : 0;

    // Get leaderboard
    const leaderboardData = await db.all(`
      SELECT
        u.username,
        COUNT(*) as referral_count,
        SUM(CASE WHEN rc.bonus_given = 1 THEN 500 ELSE 0 END) as total_gems
      FROM referral_claims rc
      JOIN users u ON u.id = rc.referrer_id
      GROUP BY rc.referrer_id, u.id
      ORDER BY referral_count DESC
      LIMIT 5
    `);

    const leaderboard = leaderboardData.map((r, idx) => ({
      rank: idx + 1,
      username: r.username,
      referrals: parseInt(r.referral_count, 10),
      gemsEarned: parseInt(r.total_gems || 0, 10)
    }));

    return res.json({
      code: refCode.code,
      stats: {
        totalReferrals,
        totalGemsEarned
      },
      leaderboard
    });
  } catch (err) {
    console.warn('[Referral] GET /info error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch referral info' });
  }
});

/**
 * ── GET /api/referral/admin/stats ──────────────────────────────────────
 * Admin-only endpoint for referral system statistics.
 *
 * Response:
 *   {
 *     total_referrals: number,
 *     total_bonuses_paid: number,
 *     top_referrers: [
 *       {
 *         referrer_username: string,
 *         referral_count: number,
 *         bonuses_earned: number
 *       }
 *     ]
 *   }
 */
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    // Total referrals (all claimed codes)
    const totalStats = await db.get(`
      SELECT
        COUNT(*) as total_referrals,
        SUM(CASE WHEN bonus_given = 1 THEN 500 ELSE 0 END) as total_bonuses_paid
      FROM referral_claims
    `);

    const totalReferrals = totalStats?.total_referrals ? parseInt(totalStats.total_referrals, 10) : 0;
    const totalBonusesPaid = totalStats?.total_bonuses_paid ? parseFloat(totalStats.total_bonuses_paid) : 0;

    // Top referrers
    const topReferrers = await db.all(`
      SELECT
        u.username as referrer_username,
        COUNT(*) as referral_count,
        SUM(CASE WHEN rc.bonus_given = 1 THEN 500 ELSE 0 END) as bonuses_earned
      FROM referral_claims rc
      JOIN users u ON u.id = rc.referrer_id
      GROUP BY rc.referrer_id, u.id
      ORDER BY referral_count DESC
      LIMIT 10
    `);

    return res.json({
      total_referrals: totalReferrals,
      total_bonuses_paid: totalBonusesPaid,
      top_referrers: topReferrers.map(r => ({
        referrer_username: r.referrer_username,
        referral_count: parseInt(r.referral_count, 10),
        bonuses_earned: parseFloat(r.bonuses_earned) || 0
      }))
    });
  } catch (err) {
    console.warn('[Referral] GET /admin/stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch referral stats' });
  }
});

module.exports = router;
