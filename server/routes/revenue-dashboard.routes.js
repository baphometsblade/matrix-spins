'use strict';

/**
 * Admin Revenue Dashboard API
 *
 * Comprehensive real-time revenue visibility for casino owners
 *
 * Routes:
 *   GET  /api/revenue-dashboard/          — Full revenue dashboard (all metrics)
 *   GET  /api/revenue-dashboard/daily     — Daily revenue breakdown (last 30 days)
 */

const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

/**
 * Helper: Get today's date in UTC at midnight
 */
function getTodayMidnight() {
    const now = new Date();
    const utc = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    // Use SQLite-compatible format (space between date and time, not 'T')
    // ISO "2026-03-30T00:00:00.000Z" fails string comparison with SQLite "2026-03-30 00:00:00"
    return utc.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Helper: Get date N days ago at midnight UTC
 */
function getNDaysAgoMidnight(days) {
    const now = new Date();
    const target = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 0, 0, 0, 0);
    return target.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Helper: Safe query execution (returns 0 or empty if table doesn't exist)
 */
async function safeQuery(sql, params = [], defaultValue = 0) {
    try {
        const result = await db.get(sql, params);
        if (result && Object.keys(result).length > 0) {
            const firstValue = Object.values(result)[0];
            return firstValue !== null ? firstValue : defaultValue;
        }
        return defaultValue;
    } catch (err) {
        console.warn(`[RevenueDashboard] Query failed: ${err.message}`);
        return defaultValue;
    }
}

/**
 * Helper: Safe multi-row query
 */
async function safeQueryAll(sql, params = [], defaultValue = []) {
    try {
        const results = await db.all(sql, params);
        return results || defaultValue;
    } catch (err) {
        console.warn(`[RevenueDashboard] Query failed: ${err.message}`);
        return defaultValue;
    }
}

/**
 * GET /api/revenue-dashboard/
 * Full revenue dashboard with all key metrics
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        // ============================================================
        // 1. OVERVIEW — All-time aggregate metrics
        // ============================================================

        const totalUsers = await safeQuery(
            `SELECT COUNT(*) as count FROM users WHERE is_banned = 0`,
            [],
            0
        );

        const activeToday = await safeQuery(
            `SELECT COUNT(DISTINCT user_id) as count FROM spins
             WHERE created_at >= ?`,
            [getTodayMidnight()],
            0
        );

        const activeThisWeek = await safeQuery(
            `SELECT COUNT(DISTINCT user_id) as count FROM spins
             WHERE created_at >= ?`,
            [getNDaysAgoMidnight(7)],
            0
        );

        const totalSpinsRow = await safeQuery(
            `SELECT COUNT(*) as count FROM spins`,
            [],
            0
        );

        const totalWageredRow = await safeQuery(
            `SELECT COALESCE(SUM(bet_amount), 0) as amount FROM spins`,
            [],
            0
        );

        const totalWonRow = await safeQuery(
            `SELECT COALESCE(SUM(win_amount), 0) as amount FROM spins`,
            [],
            0
        );

        const totalWagered = parseFloat(totalWageredRow) || 0;
        const totalWon = parseFloat(totalWonRow) || 0;
        const houseEdge = totalWagered > 0
            ? parseFloat(((totalWagered - totalWon) / totalWagered * 100).toFixed(2))
            : 0;
        const grossRevenue = parseFloat((totalWagered - totalWon).toFixed(2));

        // ============================================================
        // 2. TODAY — Today's metrics (UTC midnight to now)
        // ============================================================

        const todayMidnight = getTodayMidnight();

        const todaySpinsRow = await safeQuery(
            `SELECT COUNT(*) as count FROM spins WHERE created_at >= ?`,
            [todayMidnight],
            0
        );

        const todayWageredRow = await safeQuery(
            `SELECT COALESCE(SUM(bet_amount), 0) as amount FROM spins
             WHERE created_at >= ?`,
            [todayMidnight],
            0
        );

        const todayWonRow = await safeQuery(
            `SELECT COALESCE(SUM(win_amount), 0) as amount FROM spins
             WHERE created_at >= ?`,
            [todayMidnight],
            0
        );

        const todayUniquePlayersRow = await safeQuery(
            `SELECT COUNT(DISTINCT user_id) as count FROM spins
             WHERE created_at >= ?`,
            [todayMidnight],
            0
        );

        const todayNewSignupsRow = await safeQuery(
            `SELECT COUNT(*) as count FROM users
             WHERE created_at >= ?`,
            [todayMidnight],
            0
        );

        const todayWagered = parseFloat(todayWageredRow) || 0;
        const todayWon = parseFloat(todayWonRow) || 0;

        // ============================================================
        // 3. TOP GAMES — Top 10 games by revenue (wagered - won)
        // ============================================================

        const topGames = await safeQueryAll(
            `SELECT
                game_id,
                COUNT(*) as totalSpins,
                COALESCE(SUM(bet_amount), 0) as totalWagered,
                COALESCE(SUM(win_amount), 0) as totalWon,
                COALESCE(SUM(bet_amount), 0) - COALESCE(SUM(win_amount), 0) as revenue,
                COALESCE(AVG(bet_amount), 0) as avgBet
             FROM spins
             GROUP BY game_id
             ORDER BY revenue DESC
             LIMIT 10`,
            [],
            []
        );

        const topGamesFormatted = topGames.map(g => ({
            game_id: g.game_id,
            totalSpins: g.totalSpins || 0,
            totalWagered: parseFloat((g.totalWagered || 0).toFixed(2)),
            totalWon: parseFloat((g.totalWon || 0).toFixed(2)),
            revenue: parseFloat((g.revenue || 0).toFixed(2)),
            avgBet: parseFloat((g.avgBet || 0).toFixed(2))
        }));

        // ============================================================
        // 4. TOP PLAYERS — Top 10 players by total wagered
        // ============================================================

        const topPlayers = await safeQueryAll(
            `SELECT
                u.id as user_id,
                u.username,
                COALESCE(SUM(s.bet_amount), 0) as totalWagered,
                COALESCE(SUM(s.win_amount), 0) as totalWon,
                COALESCE(SUM(s.bet_amount), 0) - COALESCE(SUM(s.win_amount), 0) as netLoss,
                COUNT(*) as spinCount
             FROM users u
             LEFT JOIN spins s ON u.id = s.user_id
             GROUP BY u.id, u.username
             ORDER BY totalWagered DESC
             LIMIT 10`,
            [],
            []
        );

        const topPlayersFormatted = topPlayers.map(p => ({
            user_id: p.user_id,
            username: p.username || 'Unknown',
            totalWagered: parseFloat((p.totalWagered || 0).toFixed(2)),
            totalWon: parseFloat((p.totalWon || 0).toFixed(2)),
            netLoss: parseFloat((p.netLoss || 0).toFixed(2)),
            spinCount: p.spinCount || 0
        }));

        // ============================================================
        // 5. RECENT ACTIVITY — Last 20 big wins (> $500)
        // ============================================================

        const recentActivity = await safeQueryAll(
            `SELECT
                s.id,
                s.user_id,
                u.username,
                s.game_id,
                s.bet_amount,
                s.win_amount,
                s.created_at
             FROM spins s
             LEFT JOIN users u ON s.user_id = u.id
             WHERE s.win_amount > 500
             ORDER BY s.created_at DESC
             LIMIT 20`,
            [],
            []
        );

        const recentActivityFormatted = recentActivity.map(a => ({
            id: a.id,
            user_id: a.user_id,
            username: a.username || 'Unknown',
            game_id: a.game_id,
            bet_amount: parseFloat((a.bet_amount || 0).toFixed(2)),
            win_amount: parseFloat((a.win_amount || 0).toFixed(2)),
            created_at: a.created_at
        }));

        // ============================================================
        // 6. BONUS EXPENDITURE — Total bonuses paid out
        // ============================================================

        let bonusExpenditure = { totalAmount: 0, totalClaims: 0 };
        try {
            const bonusRow = await safeQuery(
                `SELECT
                    COALESCE(SUM(amount), 0) as totalAmount,
                    COUNT(*) as totalClaims
                 FROM transactions
                 WHERE type IN ('bonus', 'daily_bonus', 'campaign_bonus', 'deposit_bonus')`,
                [],
                null
            );

            if (bonusRow !== null && typeof bonusRow === 'object') {
                bonusExpenditure = {
                    totalAmount: parseFloat((bonusRow.totalAmount || 0).toFixed(2)),
                    totalClaims: bonusRow.totalClaims || 0
                };
            }
        } catch (err) {
            console.warn('[RevenueDashboard] Bonus expenditure query failed:', err.message);
        }

        // ============================================================
        // 7. CONVERSION FUNNEL — Signup → Spin → Deposit
        // ============================================================

        const totalSignups = await safeQuery(
            `SELECT COUNT(*) as count FROM users WHERE is_banned = 0`,
            [],
            0
        );

        const usersWithSpins = await safeQuery(
            `SELECT COUNT(DISTINCT user_id) as count FROM spins`,
            [],
            0
        );

        const usersWithDeposits = await safeQuery(
            `SELECT COUNT(DISTINCT user_id) as count FROM deposits
             WHERE status = 'completed'`,
            [],
            0
        );

        const conversionRate = totalSignups > 0
            ? parseFloat((usersWithDeposits / totalSignups * 100).toFixed(2))
            : 0;

        // ============================================================
        // 8. FEATURE ENGAGEMENT — Usage of various features
        // ============================================================

        let dailyWheelSpins = 0;
        let referralCodes = 0;
        let tournamentEntries = 0;
        let newsletterSubs = 0;

        // Daily wheel spins
        try {
            const dws = await safeQuery(
                `SELECT COUNT(*) as count FROM daily_wheel_spins`,
                [],
                0
            );
            dailyWheelSpins = dws;
        } catch (err) {
            dailyWheelSpins = 0;
        }

        // Referral codes
        try {
            const rc = await safeQuery(
                `SELECT COUNT(*) as count FROM referral_codes`,
                [],
                0
            );
            referralCodes = rc;
        } catch (err) {
            referralCodes = 0;
        }

        // Tournament entries (premium tournaments)
        try {
            const pt = await safeQuery(
                `SELECT COUNT(*) as count FROM premium_tournament_entries`,
                [],
                0
            );
            tournamentEntries = pt;
        } catch (err) {
            tournamentEntries = 0;
        }

        // Newsletter subscribers
        try {
            const ns = await safeQuery(
                `SELECT COUNT(*) as count FROM newsletter_subscribers
                 WHERE unsubscribed = 0`,
                [],
                0
            );
            newsletterSubs = ns;
        } catch (err) {
            newsletterSubs = 0;
        }

        // ============================================================
        // BUILD RESPONSE
        // ============================================================

        res.json({
            timestamp: new Date().toISOString(),
            overview: {
                totalUsers,
                activeToday,
                activeThisWeek,
                totalSpins: totalSpinsRow,
                totalWagered,
                totalWon,
                houseEdge,
                grossRevenue
            },
            today: {
                spins: todaySpinsRow,
                wagered: todayWagered,
                won: todayWon,
                revenue: parseFloat((todayWagered - todayWon).toFixed(2)),
                uniquePlayers: todayUniquePlayersRow,
                newSignups: todayNewSignupsRow
            },
            topGames: topGamesFormatted,
            topPlayers: topPlayersFormatted,
            recentActivity: recentActivityFormatted,
            bonusExpenditure,
            conversionFunnel: {
                totalSignups,
                usersWithSpins,
                usersWithDeposits,
                conversionRate
            },
            featureEngagement: {
                dailyWheelSpins,
                referralCodes,
                tournamentEntries,
                newsletterSubs
            }
        });
    } catch (err) {
        console.warn('[RevenueDashboard] / error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve revenue dashboard' });
    }
});

/**
 * GET /api/revenue-dashboard/daily
 * Revenue breakdown by day for last 30 days
 */
router.get('/daily', authenticate, requireAdmin, async (req, res) => {
    try {
        // Get daily breakdown for last 30 days
        const dailyData = await safeQueryAll(
            `SELECT
                DATE(created_at) as date,
                COUNT(*) as spins,
                COALESCE(SUM(bet_amount), 0) as wagered,
                COALESCE(SUM(win_amount), 0) as won,
                COALESCE(SUM(bet_amount), 0) - COALESCE(SUM(win_amount), 0) as revenue,
                COUNT(DISTINCT user_id) as uniquePlayers
             FROM spins
             WHERE created_at >= ?
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
            [getNDaysAgoMidnight(30)],
            []
        );

        // Format the data
        const formattedDaily = dailyData.map(day => ({
            date: day.date,
            spins: day.spins || 0,
            wagered: parseFloat((day.wagered || 0).toFixed(2)),
            won: parseFloat((day.won || 0).toFixed(2)),
            revenue: parseFloat((day.revenue || 0).toFixed(2)),
            uniquePlayers: day.uniquePlayers || 0
        }));

        res.json({
            timestamp: new Date().toISOString(),
            period: 'last_30_days',
            data: formattedDaily
        });
    } catch (err) {
        console.warn('[RevenueDashboard] /daily error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve daily revenue data' });
    }
});

module.exports = router;
