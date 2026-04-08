/**
 * Admin Revenue Analytics Routes
 * Real-time revenue metrics, player activity, and feature performance
 * All endpoints require admin authentication
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../database');

const cache = require('../services/cache.service');
const router = express.Router();

// All admin analytics routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Helper: Safe query that returns 0 on table-not-found errors
async function safeCount(sql, params) {
    try {
        var row = await db.get(sql, params || []);
        return row ? (Object.values(row)[0] || 0) : 0;
    } catch(e) {
        return 0;
    }
}

// Helper: Detect PostgreSQL vs SQLite
var isPg = !!process.env.DATABASE_URL;
var dateFunc = isPg ? "CURRENT_DATE::text" : "date('now')";

// GET /api/admin/analytics/overview — Key metrics (cached 60s, parallelized)
router.get('/overview', async (req, res) => {
    try {
        // Cache expensive aggregations for 60 seconds — admin dashboard refreshes don't need real-time
        var cached = cache.get('admin_analytics_overview');
        if (cached) {
            return res.json(cached);
        }

        var weekDateFilter = isPg ? "CURRENT_DATE::text - '7 days'::interval" : "date('now', '-7 days')";

        // Parallelize all 10 independent queries (was sequential — 10 round trips → 1)
        var [totalUsers, activeToday, wagerToday, winToday, wagerWeek, winWeek, wagerAllTime, winAllTime, depositBonusGiven, cashbackGiven, referralGiven] = await Promise.all([
            safeCount("SELECT COUNT(*) as count FROM users", []),
            safeCount("SELECT COUNT(DISTINCT user_id) as count FROM spins WHERE DATE(created_at) = " + dateFunc, []),
            safeCount("SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE DATE(created_at) = " + dateFunc, []),
            safeCount("SELECT COALESCE(SUM(win_amount), 0) as total FROM spins WHERE DATE(created_at) = " + dateFunc, []),
            safeCount("SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE DATE(created_at) >= " + weekDateFilter, []),
            safeCount("SELECT COALESCE(SUM(win_amount), 0) as total FROM spins WHERE DATE(created_at) >= " + weekDateFilter, []),
            safeCount("SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins", []),
            safeCount("SELECT COALESCE(SUM(win_amount), 0) as total FROM spins", []),
            safeCount("SELECT COALESCE(SUM(amount), 0) as total FROM deposit_bonus_claims", []),
            safeCount("SELECT COALESCE(SUM(amount), 0) as total FROM cashback_claims", []),
            safeCount("SELECT COALESCE(SUM(bonus_amount), 0) as total FROM referral_bonuses", [])
        ]);

        var houseEdgeToday = wagerToday > 0 ? ((wagerToday - winToday) / wagerToday * 100) : 0;
        var houseEdgeOverall = wagerAllTime > 0 ? ((wagerAllTime - winAllTime) / wagerAllTime * 100) : 0;

        var result = {
            totalUsers: parseInt(totalUsers) || 0,
            activeToday: parseInt(activeToday) || 0,
            wagerToday: parseFloat(wagerToday) || 0,
            winToday: parseFloat(winToday) || 0,
            profitToday: parseFloat(wagerToday - winToday) || 0,
            wagerWeek: parseFloat(wagerWeek) || 0,
            winWeek: parseFloat(winWeek) || 0,
            profitWeek: parseFloat(wagerWeek - winWeek) || 0,
            wagerAllTime: parseFloat(wagerAllTime) || 0,
            winAllTime: parseFloat(winAllTime) || 0,
            profitAllTime: parseFloat(wagerAllTime - winAllTime) || 0,
            houseEdgeToday: parseFloat(houseEdgeToday.toFixed(2)) || 0,
            houseEdgeOverall: parseFloat(houseEdgeOverall.toFixed(2)) || 0,
            depositBonusGiven: parseFloat(depositBonusGiven) || 0,
            cashbackGiven: parseFloat(cashbackGiven) || 0,
            referralGiven: parseFloat(referralGiven) || 0
        };
        cache.set('admin_analytics_overview', result, 60); // Cache for 60 seconds
        res.json(result);
    } catch (e) {
        console.warn('[AdminAnalytics] Overview error:', e.message);
        res.status(500).json({ error: 'Failed to load overview metrics' });
    }
});

// GET /api/admin/analytics/players — Top players by various metrics
router.get('/players', async (req, res) => {
    try {
        // Top 10 by total wagered (whales)
        var topWhalers = await db.all(
            "SELECT u.id, u.username, u.display_name, u.email, " +
            "COUNT(s.id) as totalSpins, " +
            "COALESCE(SUM(s.bet_amount), 0) as totalWagered, " +
            "COALESCE(SUM(s.win_amount), 0) as totalWon, " +
            "COALESCE(u.balance, 0) as currentBalance " +
            "FROM spins s " +
            "JOIN users u ON s.user_id = u.id " +
            "GROUP BY u.id, u.username, u.display_name, u.email, u.balance " +
            "ORDER BY totalWagered DESC LIMIT 10",
            []
        );

        // Top 10 by total spins (grinders)
        var topGrinders = await db.all(
            "SELECT u.id, u.username, u.display_name, u.email, " +
            "COUNT(s.id) as totalSpins, " +
            "COALESCE(SUM(s.bet_amount), 0) as totalWagered, " +
            "COALESCE(SUM(s.win_amount), 0) as totalWon, " +
            "COALESCE(u.balance, 0) as currentBalance " +
            "FROM spins s " +
            "JOIN users u ON s.user_id = u.id " +
            "GROUP BY u.id, u.username, u.display_name, u.email, u.balance " +
            "ORDER BY totalSpins DESC LIMIT 10",
            []
        );

        // Top 10 by gems balance (richest)
        var topRichest = await db.all(
            "SELECT id, username, display_name, email, COALESCE(balance, 0) as balance, " +
            "COALESCE(bonus_balance, 0) as bonusBalance " +
            "FROM users " +
            "ORDER BY balance DESC LIMIT 10",
            []
        );

        // Recently active players (last 24h)
        var recentlyActive = await db.all(
            "SELECT DISTINCT u.id, u.username, u.display_name, u.email, " +
            "MAX(s.created_at) as lastActiveAt, " +
            "COUNT(s.id) as spinsLast24h, " +
            "COALESCE(SUM(s.bet_amount), 0) as wageredLast24h, " +
            "COALESCE(u.balance, 0) as currentBalance " +
            "FROM spins s " +
            "JOIN users u ON s.user_id = u.id " +
            "WHERE DATE(s.created_at) = " + dateFunc + " " +
            "GROUP BY u.id, u.username, u.display_name, u.email, u.balance " +
            "ORDER BY lastActiveAt DESC LIMIT 20",
            []
        );

        res.json({
            topWhalers: topWhalers || [],
            topGrinders: topGrinders || [],
            topRichest: topRichest || [],
            recentlyActive: recentlyActive || []
        });
    } catch (e) {
        console.warn('[AdminAnalytics] Players error:', e.message);
        res.status(500).json({ error: 'Failed to load player metrics' });
    }
});

// GET /api/admin/analytics/features — Feature engagement
router.get('/features', async (req, res) => {
    try {
        // Battle pass purchases count
        var battlepassPurchases = await safeCount(
            "SELECT COUNT(*) as count FROM battle_pass_purchases",
            []
        );

        // Tournament entries count
        var tournamentEntries = await safeCount(
            "SELECT COUNT(*) as count FROM tournament_entries",
            []
        );

        // Referral codes used
        var referralsUsed = await safeCount(
            "SELECT COUNT(*) as count FROM referral_uses",
            []
        );

        // Daily login streaks active
        var loginStreaksActive = await safeCount(
            "SELECT COUNT(*) as count FROM daily_login_streaks WHERE is_active = 1",
            []
        );

        // Loyalty points redeemed
        var loyaltyRedeemed = await safeCount(
            "SELECT COALESCE(SUM(points_spent), 0) as total FROM loyalty_redemptions",
            []
        );

        // Deposit bonuses claimed
        var depositBonusesClaimed = await safeCount(
            "SELECT COUNT(*) as count FROM deposit_bonus_claims",
            []
        );

        // Challenge completions
        var challengeCompletions = await safeCount(
            "SELECT COUNT(*) as count FROM challenge_completions",
            []
        );

        // Seasonal event participation
        var seasonalEventParticipants = await safeCount(
            "SELECT COUNT(DISTINCT user_id) as count FROM seasonal_event_progress",
            []
        );

        res.json({
            battlepassPurchases: parseInt(battlepassPurchases) || 0,
            tournamentEntries: parseInt(tournamentEntries) || 0,
            referralsUsed: parseInt(referralsUsed) || 0,
            loginStreaksActive: parseInt(loginStreaksActive) || 0,
            loyaltyRedeemed: parseFloat(loyaltyRedeemed) || 0,
            depositBonusesClaimed: parseInt(depositBonusesClaimed) || 0,
            challengeCompletions: parseInt(challengeCompletions) || 0,
            seasonalEventParticipants: parseInt(seasonalEventParticipants) || 0
        });
    } catch (e) {
        console.warn('[AdminAnalytics] Features error:', e.message);
        res.status(500).json({ error: 'Failed to load feature metrics' });
    }
});

// GET /api/admin/analytics/timeline — Daily stats for last 30 days
router.get('/timeline', async (req, res) => {
    try {
        var timeline = await db.all(
            "SELECT DATE(created_at) as day, " +
            "COUNT(DISTINCT user_id) as activeUsers, " +
            "COUNT(*) as totalSpins, " +
            "COALESCE(SUM(bet_amount), 0) as wagered, " +
            "COALESCE(SUM(win_amount), 0) as won, " +
            "COALESCE(SUM(bet_amount) - SUM(win_amount), 0) as profit " +
            "FROM spins " +
            "WHERE DATE(created_at) >= " +
            (isPg ? "CURRENT_DATE::text - '30 days'::interval" : "date('now', '-30 days')") +
            " GROUP BY DATE(created_at) " +
            "ORDER BY day ASC",
            []
        );

        res.json({
            timeline: timeline || []
        });
    } catch (e) {
        console.warn('[AdminAnalytics] Timeline error:', e.message);
        res.status(500).json({ error: 'Failed to load timeline data' });
    }
});

module.exports = router;
