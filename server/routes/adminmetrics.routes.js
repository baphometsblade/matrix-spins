const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

// Helper: Check admin access
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.is_admin !== 1) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// GET /api/admin-metrics/overview — Returns today's KPIs
router.get('/overview', authenticate, requireAdmin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Revenue today: total wagered - total paid out
        const revenueData = await db.get(
            "SELECT " +
            "ROUND(COALESCE(SUM(bet_amount), 0), 2) as total_wagered, " +
            "ROUND(COALESCE(SUM(win_amount), 0), 2) as total_paid_out " +
            "FROM spins " +
            "WHERE DATE(created_at) = ?",
            [today]
        );

        const totalWagered = revenueData?.total_wagered || 0;
        const totalPaidOut = revenueData?.total_paid_out || 0;
        const revenue = totalWagered - totalPaidOut;

        // Total deposits today
        const depositsData = await db.get(
            "SELECT ROUND(COALESCE(SUM(amount), 0), 2) as total " +
            "FROM deposits " +
            "WHERE status = 'completed' AND DATE(created_at) = ?",
            [today]
        );
        const totalDeposits = depositsData?.total || 0;

        // Total withdrawals today
        const withdrawalsData = await db.get(
            "SELECT ROUND(COALESCE(SUM(amount), 0), 2) as total " +
            "FROM withdrawals " +
            "WHERE status = 'completed' AND DATE(created_at) = ?",
            [today]
        );
        const totalWithdrawals = withdrawalsData?.total || 0;

        // New registrations today
        const registrationsData = await db.get(
            "SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = ?",
            [today]
        );
        const newRegistrations = registrationsData?.count || 0;

        // Active players today (distinct users who spun)
        const activePlayersData = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM spins WHERE DATE(created_at) = ?",
            [today]
        );
        const activePlayers = activePlayersData?.count || 0;

        // Average session value (total wagered / distinct users)
        const avgSessionValue = activePlayers > 0 ? totalWagered / activePlayers : 0;

        res.json({
            date: today,
            revenue: parseFloat(revenue.toFixed(2)),
            totalDeposits: parseFloat(totalDeposits.toFixed(2)),
            totalWithdrawals: parseFloat(totalWithdrawals.toFixed(2)),
            newRegistrations,
            activePlayers,
            averageSessionValue: parseFloat(avgSessionValue.toFixed(2))
        });
    } catch (err) {
        console.warn('[AdminMetrics] Overview error:', err.message);
        res.status(500).json({ error: 'Failed to load overview metrics' });
    }
});

// GET /api/admin-metrics/trends — Returns daily trends for the last 30 days
router.get('/trends', authenticate, requireAdmin, async (req, res) => {
    try {
        const trends = await db.all(
            "SELECT " +
            "DATE(created_at) as date, " +
            "ROUND(COALESCE(SUM(bet_amount), 0), 2) as wagered, " +
            "ROUND(COALESCE(SUM(bet_amount) - SUM(win_amount), 0), 2) as revenue, " +
            "COUNT(*) as total_spins, " +
            "COUNT(DISTINCT user_id) as active_users " +
            "FROM spins " +
            "WHERE created_at >= datetime('now', '-30 days') " +
            "GROUP BY DATE(created_at) " +
            "ORDER BY date DESC",
            []
        );

        // Fetch deposits and withdrawals by day
        const depositsByDay = await db.all(
            "SELECT " +
            "DATE(created_at) as date, " +
            "ROUND(COALESCE(SUM(amount), 0), 2) as total " +
            "FROM deposits " +
            "WHERE status = 'completed' AND created_at >= datetime('now', '-30 days') " +
            "GROUP BY DATE(created_at)",
            []
        );

        const withdrawalsByDay = await db.all(
            "SELECT " +
            "DATE(created_at) as date, " +
            "ROUND(COALESCE(SUM(amount), 0), 2) as total " +
            "FROM withdrawals " +
            "WHERE status = 'completed' AND created_at >= datetime('now', '-30 days') " +
            "GROUP BY DATE(created_at)",
            []
        );

        const newUsersByDay = await db.all(
            "SELECT " +
            "DATE(created_at) as date, " +
            "COUNT(*) as count " +
            "FROM users " +
            "WHERE created_at >= datetime('now', '-30 days') " +
            "GROUP BY DATE(created_at)",
            []
        );

        // Create maps for faster lookup
        const depositsMap = {};
        const withdrawalsMap = {};
        const newUsersMap = {};

        depositsByDay.forEach(row => {
            depositsMap[row.date] = row.total || 0;
        });

        withdrawalsByDay.forEach(row => {
            withdrawalsMap[row.date] = row.total || 0;
        });

        newUsersByDay.forEach(row => {
            newUsersMap[row.date] = row.count || 0;
        });

        // Merge all data
        const result = trends.map(trend => ({
            date: trend.date,
            revenue: parseFloat((trend.revenue || 0).toFixed(2)),
            deposits: depositsMap[trend.date] || 0,
            withdrawals: withdrawalsMap[trend.date] || 0,
            newUsers: newUsersMap[trend.date] || 0,
            activeUsers: trend.active_users || 0,
            totalSpins: trend.total_spins || 0
        }));

        res.json({ trends: result });
    } catch (err) {
        console.warn('[AdminMetrics] Trends error:', err.message);
        res.status(500).json({ error: 'Failed to load trends' });
    }
});

// GET /api/admin-metrics/top-games — Returns top 10 games by revenue
router.get('/top-games', authenticate, requireAdmin, async (req, res) => {
    try {
        const topGames = await db.all(
            "SELECT " +
            "game_id, " +
            "ROUND(COALESCE(SUM(bet_amount), 0), 2) as total_wagered, " +
            "ROUND(COALESCE(SUM(win_amount), 0), 2) as total_paid_out, " +
            "ROUND(COALESCE(SUM(bet_amount) - SUM(win_amount), 0), 2) as revenue, " +
            "COUNT(*) as total_spins, " +
            "ROUND(100.0 * COALESCE(SUM(win_amount), 0) / NULLIF(SUM(bet_amount), 0), 2) as rtp " +
            "FROM spins " +
            "GROUP BY game_id " +
            "ORDER BY revenue DESC " +
            "LIMIT 10",
            []
        );

        const result = topGames.map(game => ({
            gameId: game.game_id,
            gameName: game.game_id, // Display game_id as name (could be enhanced with game_names table)
            totalSpins: game.total_spins || 0,
            totalWagered: parseFloat((game.total_wagered || 0).toFixed(2)),
            totalPaidOut: parseFloat((game.total_paid_out || 0).toFixed(2)),
            revenue: parseFloat((game.revenue || 0).toFixed(2)),
            rtp: parseFloat((game.rtp || 0).toFixed(2))
        }));

        res.json({ topGames: result });
    } catch (err) {
        console.warn('[AdminMetrics] Top games error:', err.message);
        res.status(500).json({ error: 'Failed to load top games' });
    }
});

// GET /api/admin-metrics/conversion — Returns conversion funnel
router.get('/conversion', authenticate, requireAdmin, async (req, res) => {
    try {
        // Total registered users
        const registeredUsers = await db.get(
            "SELECT COUNT(*) as count FROM users",
            []
        );
        const totalRegistered = registeredUsers?.count || 0;

        // Users who made at least one deposit
        const depositedUsers = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM deposits WHERE status = 'completed'",
            []
        );
        const firstDepositCount = depositedUsers?.count || 0;

        // Users who played 10+ spins
        const active10SpinsUsers = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM " +
            "(SELECT user_id, COUNT(*) as spin_count FROM spins GROUP BY user_id HAVING COUNT(*) >= 10)",
            []
        );
        const tenPlusSpinsCount = active10SpinsUsers?.count || 0;

        // Users who deposited 2+ times
        const multiDepositUsers = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM " +
            "(SELECT user_id, COUNT(*) as deposit_count FROM deposits WHERE status = 'completed' GROUP BY user_id HAVING COUNT(*) >= 2)",
            []
        );
        const twoDepositCount = multiDepositUsers?.count || 0;

        // Churn rate: users inactive 7+ days / total users
        // Users are considered inactive if they have no spins in the last 7 days
        const inactiveUsers = await db.get(
            "SELECT COUNT(*) as count FROM users WHERE id NOT IN " +
            "(SELECT DISTINCT user_id FROM spins WHERE created_at >= datetime('now', '-7 days'))",
            []
        );
        const inactiveCount = inactiveUsers?.count || 0;
        const churnRate = totalRegistered > 0 ? ((inactiveCount / totalRegistered) * 100).toFixed(2) : 0;

        res.json({
            registeredUsersTotal: totalRegistered,
            firstDepositUsers: firstDepositCount,
            tenPlusSpinsUsers: tenPlusSpinsCount,
            twoDepositUsers: twoDepositCount,
            churnRate: parseFloat(churnRate)
        });
    } catch (err) {
        console.warn('[AdminMetrics] Conversion error:', err.message);
        res.status(500).json({ error: 'Failed to load conversion metrics' });
    }
});

module.exports = router;
