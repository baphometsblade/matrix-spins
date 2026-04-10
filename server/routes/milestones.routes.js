'use strict';
const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Define spend milestones
const MILESTONES = [
  { id: 'bronze_starter', threshold: 50, reward: 10, rewardType: 'balance', label: 'Bronze Starter', vipTier: 'bronze' },
  { id: 'silver_player', threshold: 250, reward: 50, rewardType: 'balance', label: 'Silver Player', vipTier: 'silver' },
  { id: 'gold_high_roller', threshold: 1000, reward: 150, rewardType: 'balance', label: 'Gold High Roller', vipTier: 'gold' },
  { id: 'platinum_elite', threshold: 5000, reward: 500, rewardType: 'balance', label: 'Platinum Elite', vipTier: 'platinum' },
  { id: 'diamond_vip', threshold: 25000, reward: 2000, rewardType: 'balance', label: 'Diamond VIP', vipTier: 'diamond' }
];

// Bootstrap: create milestone_claims table
db.run(`CREATE TABLE IF NOT EXISTS milestone_claims (
  id ${idDef},
  user_id INTEGER NOT NULL,
  milestone_id TEXT NOT NULL,
  reward_amount REAL NOT NULL,
  claimed_at ${tsDef},
  UNIQUE(user_id, milestone_id)
)`).catch(function(e) { if (e && !String(e.message || e).match(/already exists/i)) console.warn('[Milestones] Table create failed:', e.message || e); });

// GET /api/milestones — Get player's milestone progress
router.get('/', authenticate, async function(req, res) {
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


    // Get total lifetime wagered from spins table
    const wagerRow = await db.get(
      'SELECT COALESCE(SUM(bet_amount), 0) as total_wagered FROM spins WHERE user_id = ?',
      [userId]
    );
    const totalWagered = parseFloat(wagerRow?.total_wagered || 0);

    // Get claimed milestones
    const claimed = await db.all(
      'SELECT milestone_id, reward_amount, claimed_at FROM milestone_claims WHERE user_id = ? LIMIT 200',
      [userId]
    );
    const claimedIds = new Set(claimed.map(c => c.milestone_id));

    // Build milestone progress
    const milestonesList = MILESTONES.map(m => {
      const isClaimed = claimedIds.has(m.id);
      const isReached = totalWagered >= m.threshold;
      return {
        id: m.id,
        label: m.label,
        threshold: m.threshold,
        reward: m.reward,
        rewardType: m.rewardType,
        vipTier: m.vipTier,
        reached: isReached,
        claimed: isClaimed
      };
    });

    // Find next unclaimed milestone
    let nextMilestone = null;
    for (const m of MILESTONES) {
      if (!claimedIds.has(m.id) && totalWagered < m.threshold) {
        nextMilestone = {
          id: m.id,
          label: m.label,
          threshold: m.threshold,
          reward: m.reward,
          progress: totalWagered,
          remaining: m.threshold - totalWagered
        };
        break;
      }
    }

    // Get current VIP tier (highest claimed milestone's vipTier)
    let currentVipTier = 'none';
    for (let i = MILESTONES.length - 1; i >= 0; i--) {
      if (claimedIds.has(MILESTONES[i].id)) {
        currentVipTier = MILESTONES[i].vipTier;
        break;
      }
    }

    res.json({
      success: true,
      totalWagered: parseFloat(totalWagered.toFixed(2)),
      currentVipTier: currentVipTier,
      milestones: milestonesList,
      nextMilestone: nextMilestone
    });
  } catch (err) {
    console.warn('[Milestones] getProgress error:', err.message);
    res.status(500).json({ error: 'Failed to load milestone progress' });
  }
});

// POST /api/milestones/claim — Claim a milestone reward
router.post('/claim', authenticate, bonusGuard, async function(req, res) {
  try {
    const userId = req.user.id;
    const { milestoneId } = req.body;

    if (!milestoneId) {
      return res.status(400).json({ error: 'milestoneId required' });
    }

    // Find milestone definition
    const milestone = MILESTONES.find(m => m.id === milestoneId);
    if (!milestone) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    // Get total lifetime wagered
    const wagerRow = await db.get(
      'SELECT COALESCE(SUM(bet_amount), 0) as total_wagered FROM spins WHERE user_id = ?',
      [userId]
    );
    const totalWagered = parseFloat(wagerRow?.total_wagered || 0);

    // Verify player has reached threshold
    if (totalWagered < milestone.threshold) {
      return res.status(400).json({
        error: 'Threshold not reached',
        required: milestone.threshold,
        current: totalWagered,
        remaining: milestone.threshold - totalWagered
      });
    }

    // Check if already claimed
    const existing = await db.get(
      'SELECT id FROM milestone_claims WHERE user_id = ? AND milestone_id = ?',
      [userId, milestoneId]
    );
    if (existing) {
      return res.status(400).json({ error: 'Milestone already claimed' });
    }

    // Atomic: INSERT claim first — UNIQUE(user_id, milestone_id) prevents double-claim race
    try {
      await db.run(
        'INSERT INTO milestone_claims (user_id, milestone_id, reward_amount) VALUES (?, ?, ?)',
        [userId, milestoneId, milestone.reward]
      );
    } catch (insertErr) {
      if (String(insertErr.message || '').match(/UNIQUE|duplicate/i)) {
        return res.status(409).json({ error: 'Milestone already claimed (concurrent request)' });
      }
      throw insertErr;
    }

    // Credit reward to bonus_balance with 15x wagering requirement
    await db.run(
      'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
      [milestone.reward, milestone.reward * 15, userId]
    );

    // Record transaction
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'milestone_reward', ?, ?)",
      [userId, milestone.reward, `Milestone reward: ${milestone.label}`]
    );

    // Fetch updated player bonus balance
    const updatedUser = await db.get('SELECT bonus_balance FROM users WHERE id = ?', [userId]);

    res.json({
      success: true,
      milestoneId: milestoneId,
      label: milestone.label,
      reward: milestone.reward,
      vipTier: milestone.vipTier,
      newBonusBalance: parseFloat(updatedUser?.bonus_balance || 0)
    });
  } catch (err) {
    console.warn('[Milestones] claim error:', err.message);
    res.status(500).json({ error: 'Failed to claim milestone' });
  }
});

module.exports = router;
