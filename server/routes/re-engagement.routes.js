'use strict';

/**
 * Re-Engagement Campaign Routes
 *
 * Automated campaign system that sends targeted notifications to inactive players.
 *
 * Endpoints:
 *   POST   /api/re-engagement/process       — (admin) Run campaign processor
 *   GET    /api/re-engagement/admin/campaigns — (admin) List campaigns with pagination
 *   GET    /api/re-engagement/admin/stats    — (admin) Campaign performance metrics
 *   POST   /api/re-engagement/mark-opened/:campaignId — (auth) Mark campaign opened
 *   POST   /api/re-engagement/convert/:campaignId    — (auth) Convert on offer
 *   GET    /api/re-engagement/my-campaigns   — (auth) Get player's pending campaigns
 *
 * Integration with node-cron (in server/index.js or scheduler):
 * ─────────────────────────────────────────────────────────────
 *
 * const cron = require('node-cron');
 * cron.schedule('0 2 * * *', async () => {
 *   try {
 *     console.log('[Scheduler] Running re-engagement processor...');
 *     const response = await fetch('http://localhost:3000/api/re-engagement/process', {
 *       method: 'POST',
 *       headers: {
 *         'Content-Type': 'application/json',
 *         'Authorization': 'Bearer <admin-token>',
 *         'X-CSRF-Token': '<csrf-token>'
 *       }
 *     });
 *     const result = await response.json();
 *     console.log('[Scheduler] Re-engagement result:', result);
 *   } catch (err) {
 *     console.warn('[Scheduler] Re-engagement processor error:', err.message);
 *   }
 * });
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard'); // ROUND 49

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

/**
 * Campaign definitions with targeting rules
 */
const CAMPAIGNS = {
  we_miss_you: {
    name: 'We Miss You',
    description: 'Haven\'t seen you in 24 hours — here\'s 50 free coins',
    inactivityHours: 24,
    targetFilter: null, // All players
    offer: { type: 'free_coins', value: 50 },
    maxPerUser: 1
  },
  streak_recovery: {
    name: 'Your Streak is Fading',
    description: 'You had an active streak — recover it with a bonus',
    inactivityHours: 48,
    targetFilter: 'had_active_streak', // Custom filter
    offer: { type: 'bonus_multiplier', value: 2.0, description: '2x multiplier on next 5 spins' },
    maxPerUser: 1
  },
  vip_comeback: {
    name: 'Exclusive VIP Comeback',
    description: 'Premium players deserve premium treatment — 200% match bonus',
    inactivityHours: 72,
    targetFilter: 'vip_player', // Custom filter
    offer: { type: 'deposit_match', value: 200, description: '200% match on next deposit' },
    maxPerUser: 1
  },
  weekly_digest: {
    name: 'Weekly Digest',
    description: 'See what you missed this week',
    inactivityHours: 168, // 7 days
    targetFilter: null, // All players
    offer: { type: 'info', value: 0, description: 'Summary of missed jackpots & tournaments' },
    maxPerUser: 1
  },
  last_chance: {
    name: 'Last Chance Bonus',
    description: 'Massive 500% bonus expires in 24 hours — claim now!',
    inactivityHours: 336, // 14 days
    targetFilter: null, // All players
    offer: { type: 'deposit_match', value: 500, description: '500% match (expires in 24h)' },
    maxPerUser: 1
  }
};

/**
 * Lazy-init table for re-engagement campaigns
 * Uses lazy pattern — table created on first route hit, NOT at require() time
 */
var _initDone = false;
var _initPromise = null;
async function _ensureTable() {
  if (_initDone) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async function() {
    try {
      await db.get('SELECT 1 FROM re_engagement_campaigns LIMIT 1');
    } catch (err) {
      await db.run(`
        CREATE TABLE IF NOT EXISTS re_engagement_campaigns (
          id ${idDef},
          user_id INTEGER NOT NULL,
          campaign_type TEXT NOT NULL,
          sent_at ${tsDef},
          opened_at TEXT,
          converted_at TEXT,
          offer_value REAL,
          offer_description TEXT,
          status TEXT DEFAULT 'pending',
          metadata TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
      console.warn('[ReEngagement] re_engagement_campaigns table created');
    }
    _initDone = true;
  })();
  return _initPromise;
}

/**
 * Query user last activity time
 */
async function getLastActivityTime(userId) {
  const lastSpin = await db.get(
    'SELECT MAX(created_at) as last_spin FROM spins WHERE user_id = ?',
    [userId]
  );
  const lastLogin = await db.get(
    'SELECT last_login_date FROM users WHERE id = ?',
    [userId]
  );

  const spinTime = lastSpin?.last_spin ? new Date(lastSpin.last_spin) : null;
  const loginTime = lastLogin?.last_login_date ? new Date(lastLogin.last_login_date) : null;

  // Return the more recent of the two
  if (!spinTime && !loginTime) return null;
  if (!spinTime) return loginTime;
  if (!loginTime) return spinTime;
  return spinTime > loginTime ? spinTime : loginTime;
}

/**
 * Check if user qualifies for a campaign
 */
async function userQualifiesForCampaign(userId, campaign) {
  const lastActivity = await getLastActivityTime(userId);
  if (!lastActivity) return false; // New user or never played

  const hoursInactive = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
  if (hoursInactive < campaign.inactivityHours) return false;

  // Custom targeting filters
  if (campaign.targetFilter === 'had_active_streak') {
    const user = await db.get(
      'SELECT win_streak_current, win_streak_max FROM users WHERE id = ?',
      [userId]
    );
    if (!user || (user.win_streak_current === 0 && user.win_streak_max === 0)) {
      return false;
    }
  }

  if (campaign.targetFilter === 'vip_player') {
    const user = await db.get(
      'SELECT whale_tier FROM player_ltv WHERE user_id = ?',
      [userId]
    );
    if (!user || user.whale_tier !== 'whale') {
      return false;
    }
  }

  // Check self-exclusion
  const limits = await db.get(
    'SELECT self_excluded_until FROM user_limits WHERE user_id = ?',
    [userId]
  );
  if (limits && limits.self_excluded_until) {
    const excludedUntil = new Date(limits.self_excluded_until);
    if (excludedUntil > new Date()) {
      return false;
    }
  }

  return true;
}

/**
 * Check if user already received this campaign type recently (avoid spam)
 */
async function hasRecentCampaign(userId, campaignType) {
  const recent = await db.get(
    'SELECT id FROM re_engagement_campaigns WHERE user_id = ? AND campaign_type = ? AND sent_at > datetime(\'now\', \'-48 hours\')',
    [userId, campaignType]
  );
  return !!recent;
}

/**
 * ── POST /api/re-engagement/process ──────────────────────────────────────
 * Admin-only endpoint that runs the campaign processor.
 *
 * Queries eligible users, creates campaign records for those who qualify.
 * Returns count of campaigns created.
 *
 * Response:
 *   {
 *     success: true,
 *     campaignsCreated: number,
 *     byType: { campaign_name: count, ... }
 *   }
 */
router.post('/process', authenticate, requireAdmin, async function(req, res) {
  try {
    const campaignsCreated = {};
    let totalCreated = 0;

    // Get all active users
    const users = await db.all('SELECT id FROM users WHERE is_banned = 0 ORDER BY id LIMIT 1000');

    for (const user of users) {
      for (const [campaignKey, campaign] of Object.entries(CAMPAIGNS)) {
        try {
          // Check if user qualifies
          const qualifies = await userQualifiesForCampaign(user.id, campaign);
          if (!qualifies) continue;

          // Check spam limit (max 1 per 48 hours)
          const hasRecent = await hasRecentCampaign(user.id, campaignKey);
          if (hasRecent) continue;

          // Create campaign record
          await db.run(
            'INSERT INTO re_engagement_campaigns (user_id, campaign_type, offer_value, offer_description, status, metadata) VALUES (?, ?, ?, ?, ?, ?)',
            [
              user.id,
              campaignKey,
              campaign.offer.value || 0,
              campaign.offer.description || '',
              'pending',
              JSON.stringify({
                campaignName: campaign.name,
                offerType: campaign.offer.type,
                createdAt: new Date().toISOString()
              })
            ]
          );

          campaignsCreated[campaignKey] = (campaignsCreated[campaignKey] || 0) + 1;
          totalCreated++;
        } catch (err) {
          console.warn(`[ReEngagement] Error creating campaign ${campaignKey} for user ${user.id}:`, err.message);
        }
      }
    }

    console.warn(`[ReEngagement] Processor complete: ${totalCreated} campaigns created`);
    return res.json({
      success: true,
      campaignsCreated: totalCreated,
      byType: campaignsCreated
    });
  } catch (err) {
    console.warn('[ReEngagement] POST /process error:', err.message);
    return res.status(500).json({ error: 'Failed to run campaign processor' });
  }
});

/**
 * ── GET /api/re-engagement/admin/campaigns ────────────────────────────────
 * Admin-only endpoint to list all campaigns with pagination.
 *
 * Query parameters:
 *   limit: number (default 50)
 *   offset: number (default 0)
 *
 * Response:
 *   {
 *     success: true,
 *     campaigns: [ { id, user_id, campaign_type, sent_at, status, ... }, ... ],
 *     total: number
 *   }
 */
router.get('/admin/campaigns', authenticate, requireAdmin, async function(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    const campaigns = await db.all(
      'SELECT id, user_id, campaign_type, sent_at, opened_at, converted_at, offer_value, status FROM re_engagement_campaigns ORDER BY sent_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    const totalRow = await db.get('SELECT COUNT(*) as total FROM re_engagement_campaigns');

    return res.json({
      success: true,
      campaigns: campaigns || [],
      total: totalRow?.total || 0,
      limit,
      offset
    });
  } catch (err) {
    console.warn('[ReEngagement] GET /admin/campaigns error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

/**
 * ── GET /api/re-engagement/admin/stats ────────────────────────────────────
 * Admin-only endpoint for campaign performance metrics.
 *
 * Response:
 *   {
 *     success: true,
 *     stats: {
 *       campaign_type: {
 *         sent: number,
 *         opened: number,
 *         openRate: percentage,
 *         converted: number,
 *         conversionRate: percentage
 *       },
 *       ...
 *     }
 *   }
 */
router.get('/admin/stats', authenticate, requireAdmin, async function(req, res) {
  try {
    const rows = await db.all(`
      SELECT
        campaign_type,
        COUNT(*) as sent,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN converted_at IS NOT NULL THEN 1 ELSE 0 END) as converted
      FROM re_engagement_campaigns
      GROUP BY campaign_type
      ORDER BY sent DESC
    `);

    const stats = {};
    (rows || []).forEach(function(row) {
      const sent = parseInt(row.sent, 10) || 0;
      const opened = parseInt(row.opened, 10) || 0;
      const converted = parseInt(row.converted, 10) || 0;

      stats[row.campaign_type] = {
        sent,
        opened,
        openRate: sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0.0',
        converted,
        conversionRate: sent > 0 ? ((converted / sent) * 100).toFixed(1) : '0.0'
      };
    });

    return res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.warn('[ReEngagement] GET /admin/stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * ── POST /api/re-engagement/mark-opened/:campaignId ──────────────────────
 * Authenticated endpoint for player to mark a campaign as opened.
 *
 * Response:
 *   { success: true }
 */
router.post('/mark-opened/:campaignId', authenticate, async function(req, res) {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    if (isNaN(campaignId)) {
      return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    const campaign = await db.get(
      'SELECT id, user_id FROM re_engagement_campaigns WHERE id = ?',
      [campaignId]
    );

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Verify ownership
    if (campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Mark as opened
    await db.run(
      'UPDATE re_engagement_campaigns SET opened_at = datetime(\'now\') WHERE id = ?',
      [campaignId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.warn('[ReEngagement] POST /mark-opened error:', err.message);
    return res.status(500).json({ error: 'Failed to mark campaign as opened' });
  }
});

/**
 * ── POST /api/re-engagement/convert/:campaignId ──────────────────────────
 * Authenticated endpoint for player to convert on a campaign offer.
 * Awards the bonus/reward to the player.
 *
 * Response:
 *   { success: true, bonusAwarded: amount }
 */
router.post('/convert/:campaignId', authenticate, bonusGuard, async function(req, res) { // ROUND 49: Added bonusGuard
  try {
    // ROUND 38: Self-exclusion check (regulatory compliance)
    try {
        var exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [req.user.id]
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

    // ROUND 42: Daily + weekly cap on campaign conversions
    try {
      var dailyConversions = await db.get(
        "SELECT COUNT(*) as cnt FROM re_engagement_campaigns WHERE user_id = ? AND status = 'converted' AND converted_at >= datetime('now', '-1 day')",
        [req.user.id]
      );
      if (dailyConversions && dailyConversions.cnt >= 1) {
        return res.status(400).json({ error: 'Maximum 1 campaign conversion per day' });
      }
      var weeklyConversions = await db.get(
        "SELECT COUNT(*) as cnt FROM re_engagement_campaigns WHERE user_id = ? AND status = 'converted' AND converted_at >= datetime('now', '-7 days')",
        [req.user.id]
      );
      if (weeklyConversions && weeklyConversions.cnt >= 3) {
        return res.status(400).json({ error: 'Maximum 3 campaign conversions per week' });
      }
    } catch (capErr) {
      if (capErr.message && capErr.message.includes('no such table')) { /* OK */ }
      else { console.warn('[ReEngagement] Cap check error:', capErr.message); }
    }

    const campaignId = parseInt(req.params.campaignId, 10);
    if (isNaN(campaignId)) {
      return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    const campaign = await db.get(
      'SELECT id, user_id, campaign_type, offer_value, metadata FROM re_engagement_campaigns WHERE id = ?',
      [campaignId]
    );

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Verify ownership
    if (campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Prevent double conversion
    const checkConverted = await db.get(
      'SELECT converted_at FROM re_engagement_campaigns WHERE id = ?',
      [campaignId]
    );
    if (checkConverted?.converted_at) {
      return res.status(400).json({ error: 'Campaign already converted' });
    }

    // Parse metadata to get campaign details
    let campaignDef = CAMPAIGNS[campaign.campaign_type];
    if (!campaignDef) {
      return res.status(400).json({ error: 'Campaign type not found' });
    }

    // Award bonus based on offer type
    let bonusAwarded = 0;
    if (campaignDef.offer.type === 'free_coins') {
      bonusAwarded = campaignDef.offer.value;
      await db.run(
        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
        [bonusAwarded, bonusAwarded * 15, campaign.user_id]
      );
    } else if (campaignDef.offer.type === 'deposit_match') {
      // Deposit match is applied when user makes a deposit (handled elsewhere)
      bonusAwarded = 0; // Will be awarded on deposit
    } else if (campaignDef.offer.type === 'bonus_multiplier') {
      // Multiplier applied on next spin (handled by client)
      bonusAwarded = 0;
    }

    // Mark campaign as converted
    await db.run(
      'UPDATE re_engagement_campaigns SET converted_at = datetime(\'now\'), status = ? WHERE id = ?',
      ['converted', campaignId]
    );

    // Log transaction if bonus was awarded
    if (bonusAwarded > 0) {
      await db.run(
        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
        [
          campaign.user_id,
          're_engagement_bonus',
          bonusAwarded,
          req.user.balance,
          req.user.balance + bonusAwarded,
          'Campaign: ' + campaignDef.name
        ]
      );
    }

    console.warn(`[ReEngagement] User ${campaign.user_id} converted campaign ${campaign.campaign_type}, bonus: ${bonusAwarded}`);

    return res.json({
      success: true,
      bonusAwarded,
      message: campaignDef.offer.description || 'Bonus applied!'
    });
  } catch (err) {
    console.warn('[ReEngagement] POST /convert error:', err.message);
    return res.status(500).json({ error: 'Failed to convert campaign' });
  }
});

/**
 * ── GET /api/re-engagement/my-campaigns ───────────────────────────────────
 * Authenticated endpoint for player to fetch their pending campaigns.
 *
 * Response:
 *   {
 *     success: true,
 *     campaigns: [
 *       {
 *         id, campaign_type, offer_value, offer_description,
 *         campaignName, offerType, sent_at, opened_at
 *       },
 *       ...
 *     ]
 *   }
 */
router.get('/my-campaigns', authenticate, async function(req, res) {
  try {
    const campaigns = await db.all(
      'SELECT id, campaign_type, offer_value, offer_description, status, metadata, sent_at, opened_at FROM re_engagement_campaigns WHERE user_id = ? AND status IN (?, ?) ORDER BY sent_at DESC',
      [req.user.id, 'pending', 'sent']
    );

    // Enrich with campaign definitions
    const enriched = (campaigns || []).map(function(camp) {
      const def = CAMPAIGNS[camp.campaign_type];
      const meta = camp.metadata ? JSON.parse(camp.metadata) : {};
      return {
        id: camp.id,
        campaignType: camp.campaign_type,
        campaignName: meta.campaignName || def?.name || 'Campaign',
        description: def?.description || '',
        offerValue: camp.offer_value,
        offerDescription: camp.offer_description,
        offerType: def?.offer.type || 'bonus',
        status: camp.status,
        sentAt: camp.sent_at,
        openedAt: camp.opened_at
      };
    });

    return res.json({
      success: true,
      campaigns: enriched
    });
  } catch (err) {
    console.warn('[ReEngagement] GET /my-campaigns error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

module.exports = router;
