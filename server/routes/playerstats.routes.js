'use strict';

/**
 * Player Lifetime Value (LTV) Tracker & Whale Detection API
 *
 * Routes:
 *   GET  /api/player-stats/me              — Player's own stats dashboard
 *   GET  /api/player-stats/admin/whales    — Top players by revenue (admin)
 *   GET  /api/player-stats/admin/segments  — Player segments & concentration (admin)
 *   POST /api/player-stats/admin/refresh   — Recalculate all player LTVs (admin)
 *   GET  /api/player-stats/admin/at-risk   — Churning risk players (admin)
 */

const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Helper: Get whale tier based on total_deposited
function getWhaleTier(totalDeposited) {
    if (totalDeposited >= 10000) return 'megawhale';
    if (totalDeposited >= 2000) return 'whale';
    if (totalDeposited >= 500) return 'shark';
    if (totalDeposited >= 100) return 'dolphin';
    return 'minnow';
}

// Helper: Get whale tier label with emoji/descriptor
function getWhaleTierLabel(tier) {
    const labels = {
        megawhale: '🦣 Mega Whale ($10k+)',
        whale: '🐋 Whale ($2k-$9.9k)',
        shark: '🦈 Shark ($500-$1.9k)',
        dolphin: '🐬 Dolphin ($100-$499)',
        minnow: '🐟 Minnow ($0-$99)'
    };
    return labels[tier] || 'Unknown';
}

// Bootstrap: ensure player_ltv table exists with indexes
async function ensureLtvTable() {
    try {
        const isPg = db.isPg();

        if (isPg) {
            // PostgreSQL version
            await db.run(`
                CREATE TABLE IF NOT EXISTS player_ltv (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
                    total_deposited NUMERIC(15,2) DEFAULT 0,
                    total_withdrawn NUMERIC(15,2) DEFAULT 0,
                    total_wagered NUMERIC(15,2) DEFAULT 0,
                    total_won NUMERIC(15,2) DEFAULT 0,
                    net_revenue NUMERIC(15,2) DEFAULT 0,
                    session_count INTEGER DEFAULT 0,
                    last_active TIMESTAMPTZ,
                    whale_tier VARCHAR(20) DEFAULT 'minnow',
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
        } else {
            // SQLite version
            await db.run(`
                CREATE TABLE IF NOT EXISTS player_ltv (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER UNIQUE NOT NULL,
                    total_deposited REAL DEFAULT 0,
                    total_withdrawn REAL DEFAULT 0,
                    total_wagered REAL DEFAULT 0,
                    total_won REAL DEFAULT 0,
                    net_revenue REAL DEFAULT 0,
                    session_count INTEGER DEFAULT 0,
                    last_active TEXT,
                    whale_tier TEXT DEFAULT 'minnow',
                    updated_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);
        }

        // Create indexes for common queries
        await db.run(`CREATE INDEX IF NOT EXISTS idx_player_ltv_user ON player_ltv(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_player_ltv_whale_tier ON player_ltv(whale_tier)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_player_ltv_net_revenue ON player_ltv(net_revenue DESC)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_player_ltv_last_active ON player_ltv(last_active)`);
    } catch (err) {
        console.warn('[PlayerStats] Error bootstrapping LTV table:', err.message);
    }
}

// NOTE: ensureLtvTable() is called from index.js after DB init (not at module load)

/**
 * GET /api/player-stats/me
 * Player's own stats dashboard - combines LTV data with calculated metrics
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user info
        const userRow = await db.get(
            'SELECT username, created_at FROM users WHERE id = ?',
            [userId]
        );

        // Get or create LTV record
        let ltvRow = await db.get('SELECT user_id, last_active FROM player_ltv WHERE user_id = ?', [userId]);

        if (!ltvRow) {
            // Create new LTV record if it doesn't exist
            await db.run(
                `INSERT INTO player_ltv (user_id, total_deposited, total_withdrawn, total_wagered, total_won,
                    net_revenue, session_count, last_active, whale_tier)
                 VALUES (?, 0, 0, 0, 0, 0, 0, NULL, 'minnow')`,
                [userId]
            );
            ltvRow = await db.get('SELECT user_id, last_active FROM player_ltv WHERE user_id = ?', [userId]);
        }

        // Get spin stats (overrides/updates LTV aggregates)
        const spinStats = await db.get(
            `SELECT
                COUNT(*) as total_spins,
                COALESCE(SUM(bet_amount), 0) as total_wagered,
                COALESCE(SUM(win_amount), 0) as total_won,
                COALESCE(MAX(win_amount), 0) as biggest_win,
                COALESCE(AVG(bet_amount), 0) as avg_bet
             FROM spins WHERE user_id = ?`,
            [userId]
        );

        // Get deposit/withdrawal totals
        const depositRow = await db.get(
            `SELECT COALESCE(SUM(amount), 0) as total_deposits
             FROM deposits WHERE user_id = ? AND status = 'completed'`,
            [userId]
        );

        const withdrawalRow = await db.get(
            `SELECT COALESCE(SUM(amount), 0) as total_withdrawals
             FROM withdrawals WHERE user_id = ? AND status = 'processed'`,
            [userId]
        );

        // Session count (distinct play days)
        const sessionCount = await db.get(
            `SELECT COUNT(DISTINCT DATE(created_at)) as session_count FROM spins WHERE user_id = ?`,
            [userId]
        );

        // Most played game
        const favoriteGame = await db.get(
            `SELECT game_id, COUNT(*) as spin_count FROM spins WHERE user_id = ?
             GROUP BY game_id ORDER BY spin_count DESC LIMIT 1`,
            [userId]
        );

        // Calculate aggregates
        const totalDeposited = parseFloat(depositRow.total_deposits) || 0;
        const totalWithdrawn = parseFloat(withdrawalRow.total_withdrawals) || 0;
        const totalWagered = parseFloat(spinStats.total_wagered) || 0;
        const totalWon = parseFloat(spinStats.total_won) || 0;
        const netRevenue = totalDeposited - totalWithdrawn;
        const whaleTier = getWhaleTier(totalDeposited);

        // Calculate win/loss streak
        const recentSpins = await db.all(
            `SELECT win_amount, bet_amount FROM spins WHERE user_id = ?
             ORDER BY created_at DESC LIMIT 10`,
            [userId]
        );

        let winStreak = 0, lossStreak = 0;
        if (recentSpins.length > 0) {
            let streakType = recentSpins[0].win_amount > recentSpins[0].bet_amount ? 'win' : 'loss';
            for (const spin of recentSpins) {
                const won = spin.win_amount > spin.bet_amount;
                if ((won && streakType === 'win') || (!won && streakType === 'loss')) {
                    if (streakType === 'win') winStreak++; else lossStreak++;
                } else break;
            }
        }

        res.json({
            username: userRow?.username || 'Player',
            memberSince: userRow?.created_at,
            whaleTier: whaleTier,
            whaleTierLabel: getWhaleTierLabel(whaleTier),

            // Financials
            totalDeposited: parseFloat(totalDeposited.toFixed(2)),
            totalWithdrawn: parseFloat(totalWithdrawn.toFixed(2)),
            netPlayer: parseFloat(netRevenue.toFixed(2)),

            // Play metrics
            totalSpins: spinStats.total_spins || 0,
            totalWagered: parseFloat(totalWagered.toFixed(2)),
            totalWon: parseFloat(totalWon.toFixed(2)),
            netPL: parseFloat((totalWon - totalWagered).toFixed(2)),

            // Streaks & game info
            winStreak,
            lossStreak,
            biggestSingleWin: parseFloat((spinStats.biggest_win || 0).toFixed(2)),
            averageBetSize: parseFloat((spinStats.avg_bet || 0).toFixed(2)),
            favoriteGame: favoriteGame?.game_id || null,
            favoriteGameSpins: favoriteGame?.spin_count || 0,

            // Session info
            sessionCount: sessionCount.session_count || 0,
            lastActive: ltvRow?.last_active || null
        });
    } catch (err) {
        console.warn('[PlayerStats] /me error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve player stats' });
    }
});

/**
 * GET /api/player-stats/admin/whales
 * List top 50 players by net revenue (whale detection)
 */
router.get('/admin/whales', authenticate, requireAdmin, async (req, res) => {
    try {
        const whales = await db.all(
            `SELECT
                p.id,
                u.username,
                p.whale_tier,
                p.total_deposited,
                p.total_withdrawn,
                p.total_wagered,
                p.net_revenue,
                p.session_count,
                p.last_active,
                CASE
                    WHEN p.last_active IS NULL OR
                         (julianday('now') - julianday(p.last_active)) > 7
                    THEN 1 ELSE 0
                END as at_risk_7days
             FROM player_ltv p
             LEFT JOIN users u ON p.user_id = u.id
             WHERE u.id IS NOT NULL
             ORDER BY p.net_revenue DESC
             LIMIT 50`,
            []
        );

        // For PostgreSQL compatibility, handle date math differently
        let finalWhales = whales;
        if (!whales[0] || whales[0].at_risk_7days === undefined) {
            // Re-fetch with PostgreSQL-friendly date logic
            finalWhales = await db.all(
                `SELECT
                    p.id,
                    u.username,
                    p.whale_tier,
                    p.total_deposited,
                    p.total_withdrawn,
                    p.total_wagered,
                    p.net_revenue,
                    p.session_count,
                    p.last_active
                 FROM player_ltv p
                 LEFT JOIN users u ON p.user_id = u.id
                 WHERE u.id IS NOT NULL
                 ORDER BY p.net_revenue DESC
                 LIMIT 50`,
                []
            );
        }

        // Enrich with at-risk flag
        const nowTime = new Date();
        const enriched = finalWhales.map(w => ({
            ...w,
            total_deposited: parseFloat(w.total_deposited) || 0,
            total_withdrawn: parseFloat(w.total_withdrawn) || 0,
            total_wagered: parseFloat(w.total_wagered) || 0,
            net_revenue: parseFloat(w.net_revenue) || 0,
            at_risk: !w.last_active || (nowTime - new Date(w.last_active)) > (7 * 24 * 60 * 60 * 1000)
        }));

        res.json({
            count: enriched.length,
            topPlayers: enriched,
            generatedAt: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[PlayerStats] /admin/whales error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve whale list' });
    }
});

/**
 * GET /api/player-stats/admin/segments
 * Player segments: tier breakdown, average LTV, revenue concentration
 */
router.get('/admin/segments', authenticate, requireAdmin, async (req, res) => {
    try {
        // Count players per tier
        const tiers = ['megawhale', 'whale', 'shark', 'dolphin', 'minnow'];
        const segments = {};
        let totalRevenue = 0;
        let totalPlayers = 0;

        for (const tier of tiers) {
            const tierData = await db.get(
                `SELECT
                    COUNT(*) as player_count,
                    COALESCE(AVG(net_revenue), 0) as avg_ltv,
                    COALESCE(SUM(net_revenue), 0) as total_revenue,
                    COALESCE(AVG(total_deposited), 0) as avg_deposited,
                    COALESCE(AVG(total_wagered), 0) as avg_wagered
                 FROM player_ltv WHERE whale_tier = ?`,
                [tier]
            );

            segments[tier] = {
                playerCount: tierData.player_count || 0,
                avgLTV: parseFloat((tierData.avg_ltv || 0).toFixed(2)),
                totalRevenue: parseFloat((tierData.total_revenue || 0).toFixed(2)),
                avgDeposited: parseFloat((tierData.avg_deposited || 0).toFixed(2)),
                avgWagered: parseFloat((tierData.avg_wagered || 0).toFixed(2))
            };

            totalRevenue += parseFloat(tierData.total_revenue || 0);
            totalPlayers += tierData.player_count || 0;
        }

        // Revenue concentration: % from top 10% of players
        const topTenPercent = Math.max(1, Math.ceil(totalPlayers * 0.1));
        const topRevenueRow = await db.get(
            `SELECT COALESCE(SUM(net_revenue), 0) as top_10_revenue
             FROM (
                SELECT net_revenue FROM player_ltv
                WHERE net_revenue > 0
                ORDER BY net_revenue DESC
                LIMIT ?
             )`,
            [topTenPercent]
        );

        const concentrationPct = totalRevenue > 0
            ? ((parseFloat(topRevenueRow.top_10_revenue || 0) / totalRevenue) * 100).toFixed(2)
            : 0;

        res.json({
            totalPlayers,
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            segments,
            revenueConcentration: {
                topTenPercentPlayers: topTenPercent,
                topTenPercentRevenue: parseFloat(concentrationPct),
                insight: `Top ${topTenPercent} players (${topTenPercent / totalPlayers * 100 || 0}% of base) generate ${concentrationPct}% of revenue`
            }
        });
    } catch (err) {
        console.warn('[PlayerStats] /admin/segments error:', err.message);
        res.status(500).json({ error: 'Failed to calculate segments' });
    }
});

/**
 * POST /api/player-stats/admin/refresh
 * Recalculate all player LTV from source tables
 */
router.post('/admin/refresh', authenticate, requireAdmin, async (req, res) => {
    try {
        // Get all users
        const users = await db.all('SELECT id FROM users WHERE is_banned = 0 LIMIT 10000', []);

        let updated = 0;
        let created = 0;

        for (const user of users) {
            const userId = user.id;

            // Aggregate deposits (completed only)
            const depRow = await db.get(
                `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
                 WHERE user_id = ? AND status = 'completed'`,
                [userId]
            );

            // Aggregate withdrawals (processed only)
            const wthRow = await db.get(
                `SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals
                 WHERE user_id = ? AND status = 'processed'`,
                [userId]
            );

            // Aggregate spins
            const spinRow = await db.get(
                `SELECT
                    COUNT(*) as spin_count,
                    COALESCE(SUM(bet_amount), 0) as total_wagered,
                    COALESCE(SUM(win_amount), 0) as total_won
                 FROM spins WHERE user_id = ?`,
                [userId]
            );

            // Session count (distinct dates)
            const sessionRow = await db.get(
                `SELECT COUNT(DISTINCT DATE(created_at)) as session_count FROM spins WHERE user_id = ?`,
                [userId]
            );

            // Last active
            const lastActiveRow = await db.get(
                `SELECT MAX(created_at) as last_active FROM spins WHERE user_id = ?`,
                [userId]
            );

            const totalDeposited = parseFloat(depRow.total || 0);
            const totalWithdrawn = parseFloat(wthRow.total || 0);
            const totalWagered = parseFloat(spinRow.total_wagered || 0);
            const totalWon = parseFloat(spinRow.total_won || 0);
            const netRevenue = totalDeposited - totalWithdrawn;
            const whaleTier = getWhaleTier(totalDeposited);
            const sessionCount = sessionRow.session_count || 0;
            const lastActive = lastActiveRow.last_active || null;

            // Upsert LTV record
            const exists = await db.get('SELECT id FROM player_ltv WHERE user_id = ?', [userId]);

            if (exists) {
                await db.run(
                    `UPDATE player_ltv SET
                        total_deposited = ?, total_withdrawn = ?, total_wagered = ?,
                        total_won = ?, net_revenue = ?, session_count = ?,
                        last_active = ?, whale_tier = ?, updated_at = datetime('now')
                     WHERE user_id = ?`,
                    [totalDeposited, totalWithdrawn, totalWagered, totalWon, netRevenue,
                     sessionCount, lastActive, whaleTier, userId]
                );
                updated++;
            } else {
                await db.run(
                    `INSERT INTO player_ltv (user_id, total_deposited, total_withdrawn, total_wagered,
                        total_won, net_revenue, session_count, last_active, whale_tier)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, totalDeposited, totalWithdrawn, totalWagered, totalWon, netRevenue,
                     sessionCount, lastActive, whaleTier]
                );
                created++;
            }
        }

        res.json({
            message: 'LTV refresh completed',
            usersProcessed: users.length,
            recordsCreated: created,
            recordsUpdated: updated,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[PlayerStats] /admin/refresh error:', err.message);
        res.status(500).json({ error: 'Failed to refresh LTV data' });
    }
});

/**
 * GET /api/player-stats/admin/at-risk
 * Players at risk of churning: high-value players with no recent activity
 * Filters: $100+ deposited, no play in 3+ days
 */
router.get('/admin/at-risk', authenticate, requireAdmin, async (req, res) => {
    try {
        // Players with $100+ deposits who haven't played in 3+ days
        const atRiskPlayers = await db.all(
            `SELECT
                p.id,
                u.username,
                p.whale_tier,
                p.total_deposited,
                p.total_withdrawn,
                p.net_revenue,
                p.session_count,
                p.last_active,
                CASE
                    WHEN p.last_active IS NULL THEN 999
                    ELSE (julianday('now') - julianday(p.last_active))
                END as days_inactive
             FROM player_ltv p
             LEFT JOIN users u ON p.user_id = u.id
             WHERE p.total_deposited >= 100
                AND (p.last_active IS NULL OR (julianday('now') - julianday(p.last_active)) >= 3)
             ORDER BY p.net_revenue DESC
             LIMIT 100`,
            []
        );

        // Fallback for PostgreSQL
        let finalPlayers = atRiskPlayers;
        if (!atRiskPlayers[0] || atRiskPlayers[0].days_inactive === undefined) {
            finalPlayers = await db.all(
                `SELECT
                    p.id,
                    u.username,
                    p.whale_tier,
                    p.total_deposited,
                    p.total_withdrawn,
                    p.net_revenue,
                    p.session_count,
                    p.last_active
                 FROM player_ltv p
                 LEFT JOIN users u ON p.user_id = u.id
                 WHERE p.total_deposited >= 100
                 ORDER BY p.net_revenue DESC
                 LIMIT 100`,
                []
            );
        }

        // Enrich with days_inactive calculation
        const nowTime = new Date();
        const enriched = finalPlayers
            .map(p => {
                let daysInactive = 999;
                if (p.last_active) {
                    const lastDate = new Date(p.last_active);
                    daysInactive = Math.floor((nowTime - lastDate) / (24 * 60 * 60 * 1000));
                }
                return {
                    ...p,
                    total_deposited: parseFloat(p.total_deposited) || 0,
                    total_withdrawn: parseFloat(p.total_withdrawn) || 0,
                    net_revenue: parseFloat(p.net_revenue) || 0,
                    days_inactive: daysInactive
                };
            })
            .filter(p => p.days_inactive >= 3);

        res.json({
            count: enriched.length,
            atRiskPlayers: enriched,
            hint: 'These high-value players have not played in 3+ days. Consider re-engagement campaigns.',
            generatedAt: new Date().toISOString()
        });
    } catch (err) {
        console.warn('[PlayerStats] /admin/at-risk error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve at-risk players' });
    }
});

module.exports = router;
module.exports.ensureLtvTable = ensureLtvTable;
