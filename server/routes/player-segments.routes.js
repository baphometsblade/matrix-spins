var router = require('express').Router();
var authenticate = require('../middleware/auth').authenticate;
var db = require('../database');

// Determine database type for SERIAL vs AUTOINCREMENT
var isPg = db.isPg();

// Initialize player_segments table
async function initializeTable() {
  var createTableSql = isPg
    ? `CREATE TABLE IF NOT EXISTS player_segments (
        id SERIAL PRIMARY KEY,
        user_id INT UNIQUE NOT NULL,
        segment TEXT NOT NULL,
        sub_segments TEXT,
        score INT DEFAULT 0,
        last_computed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    : `CREATE TABLE IF NOT EXISTS player_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INT UNIQUE NOT NULL,
        segment TEXT NOT NULL,
        sub_segments TEXT,
        score INT DEFAULT 0,
        last_computed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`;

  await db.run(createTableSql, []);
  console.warn('[PlayerSegments] Table initialized');
}

// Table initialization deferred to server startup (see server/index.js)

/**
 * Compute player segment based on behavioral stats
 * Returns segment name and sub_segments array
 */
async function computePlayerSegment(userId) {
  try {
    // Safely fetch user stats with defensive queries
    var userStats = {};

    try {
      var userRow = await db.get(
        "SELECT id, created_at FROM users WHERE id = ?",
        [userId]
      );
      if (userRow) {
        userStats.created_at = userRow.created_at;
      }
    } catch (e) {
      console.warn('Unable to fetch user:', e.message);
    }

    try {
      var statsRow = await db.get(
        "SELECT total_spins, total_wagered, total_deposits, bonus_claims_count FROM player_stats WHERE user_id = ?",
        [userId]
      );
      if (statsRow) {
        userStats.total_spins = statsRow.total_spins || 0;
        userStats.total_wagered = statsRow.total_wagered || 0;
        userStats.total_deposits = statsRow.total_deposits || 0;
        userStats.bonus_claims_count = statsRow.bonus_claims_count || 0;
      }
    } catch (e) {
      console.warn('Unable to fetch player_stats:', e.message);
    }

    try {
      var txRow = await db.get(
        "SELECT COUNT(*) as spin_count, SUM(amount) as total_amount FROM transactions WHERE user_id = ? AND type = 'spin'",
        [userId]
      );
      if (txRow && txRow.spin_count && !userStats.total_spins) {
        userStats.total_spins = txRow.spin_count;
        userStats.total_wagered = txRow.total_amount || 0;
      }
    } catch (e) {
      console.warn('Unable to fetch transactions:', e.message);
    }

    try {
      var recentRow = await db.get(
        "SELECT COUNT(DISTINCT DATE(created_at)) as days_active_7, MAX(created_at) as last_activity FROM transactions WHERE user_id = ? AND created_at > datetime('now', '-7 days')",
        [userId]
      );
      if (recentRow) {
        userStats.days_active_7 = recentRow.days_active_7 || 0;
        userStats.last_activity = recentRow.last_activity;
      }
    } catch (e) {
      console.warn('Unable to fetch recent activity:', e.message);
    }

    try {
      var trendRow = await db.get(
        "SELECT COUNT(DISTINCT DATE(created_at)) as days_active_14 FROM transactions WHERE user_id = ? AND created_at > datetime('now', '-14 days')",
        [userId]
      );
      if (trendRow) {
        userStats.days_active_14 = trendRow.days_active_14 || 0;
      }
    } catch (e) {
      console.warn('Unable to fetch 14-day trend:', e.message);
    }

    // Default to new_player if no stats available
    if (!userStats.total_spins && !userStats.created_at) {
      return { segment: 'new_player', sub_segments: ['unverified'], score: 0 };
    }

    // Account age in days
    var accountAgeDays = 0;
    if (userStats.created_at) {
      var createdTime = new Date(userStats.created_at).getTime();
      var nowTime = new Date().getTime();
      accountAgeDays = Math.floor((nowTime - createdTime) / (1000 * 60 * 60 * 24));
    }

    var segment = 'casual';
    var subSegments = [];
    var score = 0;

    // NEW_PLAYER: Account < 3 days old
    if (accountAgeDays < 3) {
      segment = 'new_player';
      subSegments = ['onboarding'];
      score = 10;
    }
    // DORMANT: No activity in 3+ days but was active before
    else if (userStats.last_activity) {
      var lastActivityTime = new Date(userStats.last_activity).getTime();
      var nowTime = new Date().getTime();
      var daysSinceActivity = Math.floor((nowTime - lastActivityTime) / (1000 * 60 * 60 * 24));

      if (daysSinceActivity >= 3 && userStats.total_spins > 0) {
        segment = 'dormant';
        subSegments = ['inactive_veteran'];
        score = 20;
      }
    }

    // WHALE: Total wagered > 50000
    if (!segment.includes('new') && !segment.includes('dormant') && userStats.total_wagered > 50000) {
      segment = 'whale';
      subSegments = ['high_value'];
      score = 95;
    }
    // HIGH_ROLLER: Average bet > 100 gems
    else if (userStats.total_spins > 0) {
      var avgBet = userStats.total_wagered / userStats.total_spins;
      if (avgBet > 100) {
        segment = 'high_roller';
        subSegments = ['big_bettor'];
        score = 80;
      }
    }

    // GRINDER: 500+ total spins, plays daily (5+ of last 7 days active)
    if (segment !== 'whale' && segment !== 'dormant' && userStats.total_spins >= 500 && userStats.days_active_7 >= 5) {
      segment = 'grinder';
      subSegments = ['loyal_daily'];
      score = 75;
    }

    // AT_RISK: Declining activity (this week < 50% of last week)
    if (segment !== 'whale' && segment !== 'grinder' && segment !== 'dormant') {
      var thisWeekSpins = 0;
      var lastWeekSpins = 0;

      try {
        var thisWeek = await db.get(
          "SELECT COUNT(*) as spin_count FROM transactions WHERE user_id = ? AND type = 'spin' AND created_at > datetime('now', '-7 days')",
          [userId]
        );
        thisWeekSpins = thisWeek.spin_count || 0;

        var lastWeek = await db.get(
          "SELECT COUNT(*) as spin_count FROM transactions WHERE user_id = ? AND type = 'spin' AND created_at > datetime('now', '-14 days') AND created_at <= datetime('now', '-7 days')",
          [userId]
        );
        lastWeekSpins = lastWeek.spin_count || 0;

        if (lastWeekSpins > 0 && thisWeekSpins < (lastWeekSpins * 0.5)) {
          segment = 'at_risk';
          subSegments = ['declining_activity'];
          score = 35;
        }
      } catch (e) {
        console.warn('Unable to compute at_risk trend:', e.message);
      }
    }

    // BARGAIN_HUNTER: Claims bonuses but minimal deposits
    if (segment === 'casual' || segment === 'grinder') {
      if (userStats.bonus_claims_count > 5 && userStats.total_deposits < 500) {
        subSegments.push('bonus_seeker');
        score = Math.max(score, 40);
      }
    }

    // CASUAL: Default for moderate play (plays 1-3 days/week, < 100 spins avg per session)
    if (segment === 'casual') {
      subSegments = ['moderate_play'];
      score = 50;
    }

    return { segment: segment, sub_segments: subSegments, score: score };
  } catch (err) {
    console.warn('Segment computation error:', err.message);
    return { segment: 'new_player', sub_segments: ['error_default'], score: 0 };
  }
}

/**
 * Get personalized offer recommendations based on segment
 */
function getOfferRecommendations(segment, subSegments) {
  var recommendations = [];

  switch (segment) {
    case 'whale':
      recommendations = [
        { offer_id: 'vip_exclusive', title: 'VIP Exclusive Bonus', description: 'Premium rewards for our highest-value players' },
        { offer_id: 'highroller_tournament', title: 'High-Roller Tournament Invite', description: 'Exclusive tournament with premium prizes' },
        { offer_id: 'account_manager', title: 'Personal Account Manager', description: 'Dedicated support and personalized service' }
      ];
      break;

    case 'grinder':
      recommendations = [
        { offer_id: 'loyalty_multiplier', title: 'Loyalty Point Multiplier', description: 'Earn points faster with 2x multiplier' },
        { offer_id: 'streak_bonus', title: 'Streak Bonus', description: 'Get bonus gems for consecutive daily plays' },
        { offer_id: 'daily_challenge', title: 'Daily Challenge Bonus', description: 'Complete daily challenges for extra rewards' }
      ];
      break;

    case 'casual':
      recommendations = [
        { offer_id: 'comeback_bonus', title: 'Comeback Bonus', description: 'Bonus gems on your next deposit' },
        { offer_id: 'flash_deal', title: 'Flash Deal', description: 'Limited-time promotional offer' },
        { offer_id: 'free_spins', title: 'Free Spins', description: 'Bonus spins on select games' }
      ];
      break;

    case 'dormant':
      recommendations = [
        { offer_id: 'comeback_match', title: '200% Comeback Deposit Match', description: 'Triple your next deposit amount' },
        { offer_id: 'free_gems', title: 'Free Gems Gift', description: 'Complimentary gems to get you started' },
        { offer_id: 'returning_bonus', title: 'Exclusive Returning Player Bonus', description: 'Special welcome back offer' }
      ];
      break;

    case 'new_player':
      recommendations = [
        { offer_id: 'welcome_bonus', title: 'Welcome Bonus', description: 'Generous deposit match on first deposit' },
        { offer_id: 'tutorial_reward', title: 'Tutorial Reward', description: 'Bonus gems for completing tutorial' },
        { offer_id: 'first_deposit_match', title: 'First Deposit Match', description: '100% match on your first deposit' }
      ];
      break;

    case 'at_risk':
      recommendations = [
        { offer_id: 'retention_offer', title: 'Retention Offer - 50% Deposit Match', description: 'Get 50% bonus on your next deposit' },
        { offer_id: 'free_spins_pack', title: 'Free Spins Pack', description: 'Pack of free spins across popular games' },
        { offer_id: 'cashback_boost', title: 'Cashback Boost', description: 'Earn cashback on your play' }
      ];
      break;

    case 'high_roller':
      recommendations = [
        { offer_id: 'increased_limits', title: 'Increased Bet Limits', description: 'Higher maximum bet amounts available' },
        { offer_id: 'premium_unlock', title: 'Premium Games Unlock', description: 'Access to exclusive high-stakes games' },
        { offer_id: 'vip_wheel', title: 'VIP Wheel Spin', description: 'Spin the VIP wheel for premium rewards' }
      ];
      break;

    default:
      recommendations = [
        { offer_id: 'generic_bonus', title: 'Special Offer', description: 'Exclusive rewards waiting for you' }
      ];
  }

  return recommendations;
}

/**
 * GET /api/segments/me
 * Get current player's segment and personalized offers
 * Requires authentication
 */
router.get('/me', authenticate, async function(req, res) {
  try {
    var userId = req.user.id;

    // Check if segment is cached and fresh (< 1 hour old)
    var cached = await db.get(
      "SELECT segment, sub_segments, score, last_computed FROM player_segments WHERE user_id = ?",
      [userId]
    );

    var now = new Date();
    var isFresh = false;

    if (cached) {
      var lastComputed = new Date(cached.last_computed).getTime();
      var ageMs = now.getTime() - lastComputed;
      isFresh = ageMs < (60 * 60 * 1000); // 1 hour
    }

    var segmentData;
    if (!isFresh) {
      // Compute on-the-fly
      segmentData = await computePlayerSegment(userId);

      // Update cache
      try {
        await db.run(
          "INSERT INTO player_segments (user_id, segment, sub_segments, score, last_computed) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET segment = excluded.segment, sub_segments = excluded.sub_segments, score = excluded.score, last_computed = CURRENT_TIMESTAMP",
          [userId, segmentData.segment, JSON.stringify(segmentData.sub_segments), segmentData.score]
        );
      } catch (e) {
        // Fallback for SQLite compatibility
        try {
          await db.run(
            "DELETE FROM player_segments WHERE user_id = ?",
            [userId]
          );
          await db.run(
            "INSERT INTO player_segments (user_id, segment, sub_segments, score, last_computed) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [userId, segmentData.segment, JSON.stringify(segmentData.sub_segments), segmentData.score]
          );
        } catch (innerErr) {
          console.warn('Unable to update segment cache:', innerErr.message);
        }
      }
    } else {
      segmentData = {
        segment: cached.segment,
        sub_segments: (function() { try { return JSON.parse(cached.sub_segments || '[]'); } catch (_) { return []; } })(),
        score: cached.score
      };
    }

    var recommendations = getOfferRecommendations(segmentData.segment, segmentData.sub_segments);

    res.json({
      user_id: userId,
      segment: segmentData.segment,
      sub_segments: segmentData.sub_segments,
      score: segmentData.score,
      offer_recommendations: recommendations
    });
  } catch (err) {
    console.warn('GET /me error:', err.message);
    res.status(500).json({ error: 'Unable to fetch segment data' });
  }
});

/**
 * GET /api/segments/admin/overview
 * Admin-only: Returns segment distribution and top players
 */
router.get('/admin/overview', authenticate, async function(req, res) {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Segment distribution
    var distribution = await db.all(
      "SELECT segment, COUNT(*) as count FROM player_segments GROUP BY segment",
      []
    );

    // Top 10 whales
    var topWhales = await db.all(
      "SELECT ps.user_id, ps.segment, ps.score FROM player_segments ps WHERE segment = 'whale' ORDER BY score DESC LIMIT 10",
      []
    );

    // Top 10 at-risk
    var topAtRisk = await db.all(
      "SELECT ps.user_id, ps.segment, ps.score FROM player_segments ps WHERE segment = 'at_risk' ORDER BY score ASC LIMIT 10",
      []
    );

    res.json({
      distribution: distribution,
      top_whales: topWhales,
      top_at_risk: topAtRisk
    });
  } catch (err) {
    console.warn('GET /admin/overview error:', err.message);
    res.status(500).json({ error: 'Unable to fetch segment overview' });
  }
});

/**
 * POST /api/segments/admin/compute-all
 * Admin-only: Recompute all player segments (batch job)
 */
router.post('/admin/compute-all', authenticate, async function(req, res) {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get all users
    var users = await db.all("SELECT id FROM users LIMIT 10000", []);

    var recomputedCount = 0;
    for (var i = 0; i < users.length; i++) {
      try {
        var userId = users[i].id;
        var segmentData = await computePlayerSegment(userId);

        // Upsert segment
        try {
          await db.run(
            "INSERT INTO player_segments (user_id, segment, sub_segments, score, last_computed) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET segment = excluded.segment, sub_segments = excluded.sub_segments, score = excluded.score, last_computed = CURRENT_TIMESTAMP",
            [userId, segmentData.segment, JSON.stringify(segmentData.sub_segments), segmentData.score]
          );
        } catch (e) {
          // Fallback for SQLite
          await db.run("DELETE FROM player_segments WHERE user_id = ?", [userId]);
          await db.run(
            "INSERT INTO player_segments (user_id, segment, sub_segments, score, last_computed) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [userId, segmentData.segment, JSON.stringify(segmentData.sub_segments), segmentData.score]
          );
        }
        recomputedCount++;
      } catch (e) {
        console.warn('Error computing segment for user ' + users[i].id + ':', e.message);
      }
    }

    res.json({
      message: 'Segment recomputation complete',
      recomputed_count: recomputedCount,
      total_users: users.length
    });
  } catch (err) {
    console.warn('POST /admin/compute-all error:', err.message);
    res.status(500).json({ error: 'Batch computation failed' });
  }
});

/**
 * GET /api/segments/admin/segment/:name
 * Admin-only: Returns all players in a given segment with their stats
 */
router.get('/admin/segment/:name', authenticate, async function(req, res) {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    var segmentName = req.params.name;

    // Validate segment name
    var validSegments = ['whale', 'grinder', 'casual', 'dormant', 'new_player', 'at_risk', 'high_roller', 'bargain_hunter'];
    if (!validSegments.includes(segmentName)) {
      return res.status(400).json({ error: 'Invalid segment name' });
    }

    var players = await db.all(
      "SELECT user_id, segment, sub_segments, score FROM player_segments WHERE segment = ? ORDER BY score DESC",
      [segmentName]
    );

    res.json({
      segment: segmentName,
      count: players.length,
      players: players
    });
  } catch (err) {
    console.warn('GET /admin/segment/:name error:', err.message);
    res.status(500).json({ error: 'Unable to fetch segment players' });
  }
});

module.exports = router;
module.exports.bootstrapPlayerSegmentsTable = initializeTable;
