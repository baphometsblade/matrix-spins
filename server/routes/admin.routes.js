const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Self-exclusion check for target user (admin bonuses must respect player self-exclusion)
async function checkTargetSelfExclusion(userId) {
    try {
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) return true;
    } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
    }
    try {
        const limits = await db.get('SELECT self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?', [userId]);
        if (limits) {
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            if ((limits.self_excluded_until && limits.self_excluded_until > now) ||
                (limits.cooling_off_until && limits.cooling_off_until > now)) return true;
        }
    } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
    }
    return false;
}

// Bootstrap admin audit log table
db.run(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target_user_id INTEGER,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)`).catch(() => {});

// GET /api/admin/revenue — Comprehensive P&L analytics (daily, lifetime, top players, WoW)
router.get('/revenue', async (req, res) => {
    try {
        const dailyPnl = await db.all(
            "SELECT DATE(created_at) as day, COUNT(*) as spins, " +
            "ROUND(SUM(bet_amount),2) as wagered, ROUND(SUM(win_amount),2) as paid_out, " +
            "ROUND(SUM(bet_amount)-SUM(win_amount),2) as profit " +
            "FROM spins WHERE created_at >= datetime('now','-30 days') " +
            "GROUP BY DATE(created_at) ORDER BY day DESC"
        );
        const lifetime = await db.get(
            "SELECT COUNT(DISTINCT user_id) as unique_players, COUNT(*) as total_spins, " +
            "ROUND(SUM(bet_amount),2) as total_wagered, ROUND(SUM(win_amount),2) as total_paid, " +
            "ROUND(SUM(bet_amount)-SUM(win_amount),2) as gross_profit, " +
            "ROUND(100.0*SUM(win_amount)/NULLIF(SUM(bet_amount),0),2) as actual_rtp FROM spins"
        );
        const depositsStats = await db.get(
            "SELECT COUNT(*) as total_deposits, ROUND(SUM(amount),2) as total_deposited, " +
            "COUNT(DISTINCT user_id) as depositing_players, ROUND(AVG(amount),2) as avg_deposit " +
            "FROM deposits WHERE status='completed' AND created_at >= datetime('now','-30 days')"
        );
        const withdrawalsStats = await db.get(
            "SELECT COUNT(*) as total_withdrawals, ROUND(SUM(amount),2) as total_withdrawn " +
            "FROM withdrawals WHERE status='completed' AND created_at >= datetime('now','-30 days')"
        );
        const topPlayers = await db.all(
            "SELECT u.username, u.email, COUNT(s.id) as spins, " +
            "ROUND(SUM(s.bet_amount),2) as wagered, " +
            "ROUND(SUM(s.bet_amount)-SUM(s.win_amount),2) as profit_generated, " +
            "ROUND(u.balance,2) as current_balance " +
            "FROM spins s JOIN users u ON u.id=s.user_id " +
            "GROUP BY u.id, u.username, u.email, u.balance ORDER BY profit_generated DESC LIMIT 10"
        );
        const pending = await db.get(
            "SELECT (SELECT COUNT(*) FROM deposits WHERE status='pending') as pending_deposits, " +
            "(SELECT COALESCE(SUM(amount),0) FROM deposits WHERE status='pending') as pending_deposit_value, " +
            "(SELECT COUNT(*) FROM withdrawals WHERE status='pending') as pending_withdrawals, " +
            "(SELECT COALESCE(SUM(amount),0) FROM withdrawals WHERE status='pending') as pending_withdrawal_value"
        );
        const thisWeek = await db.get(
            "SELECT ROUND(SUM(bet_amount)-SUM(win_amount),2) as profit FROM spins " +
            "WHERE created_at >= datetime('now','-7 days')"
        );
        const lastWeek = await db.get(
            "SELECT ROUND(SUM(bet_amount)-SUM(win_amount),2) as profit FROM spins " +
            "WHERE created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days')"
        );
        res.json({ lifetime, dailyPnl, deposits: depositsStats, withdrawals: withdrawalsStats, topPlayers, pending, thisWeek, lastWeek });
    } catch (e) {
        console.warn('[Admin] Revenue error:', e.message);
        res.status(500).json({ error: 'Failed to load revenue data' });
    }
});

// GET /api/admin/stats — Casino-wide statistics
router.get('/stats', async (req, res) => {
    try {
        const users = await db.get('SELECT COUNT(*) as count, SUM(balance) as totalBalance FROM users');
        const spins = await db.get('SELECT COUNT(*) as count, SUM(bet_amount) as totalWagered, SUM(win_amount) as totalPaid FROM spins');
        const deposits = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'deposit'");
        const withdrawals = await db.get("SELECT COALESCE(ABS(SUM(amount)), 0) as total FROM transactions WHERE type = 'withdrawal'");
        const pendingDeps = await db.get("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM deposits WHERE status = 'pending'");
        const pendingWds = await db.get("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'pending'");
        const gameStats = await db.all('SELECT game_id, total_spins, total_wagered, total_paid, actual_rtp FROM game_stats ORDER BY total_spins DESC LIMIT 200');

        const totalWagered = spins ? spins.totalWagered || 0 : 0;
        const totalPaid = spins ? spins.totalPaid || 0 : 0;
        const houseProfit = totalWagered - totalPaid;
        const overallRtp = totalWagered > 0 ? (totalPaid / totalWagered) : 0;

        res.json({
            overview: {
                totalUsers: users ? users.count : 0,
                totalPlayerBalance: users ? users.totalBalance || 0 : 0,
                totalSpins: spins ? spins.count : 0,
                totalWagered,
                totalPaid,
                houseProfit,
                overallRtp: (overallRtp * 100).toFixed(2) + '%',
                totalDeposits: deposits ? deposits.total : 0,
                totalWithdrawals: withdrawals ? withdrawals.total : 0,
                pendingDeposits: pendingDeps ? pendingDeps.count : 0,
                pendingDepositAmount: pendingDeps ? pendingDeps.total : 0,
                pendingWithdrawals: pendingWds ? pendingWds.count : 0,
                pendingWithdrawalAmount: pendingWds ? pendingWds.total : 0,
            },
            gameStats,
        });
    } catch (err) {
        console.warn('[Admin] Stats error:', err.message);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

// GET /api/admin/fraud-alerts — Flag suspicious user patterns
router.get('/fraud-alerts', async (req, res) => {
    try {
        const alerts = [];

        // 1. Users with high withdrawal-to-deposit ratio (potential bonus abuse)
        const wdRatio = await db.all(`
            SELECT u.id, u.username, u.balance,
                COALESCE(d.total_dep, 0) as total_deposited,
                COALESCE(w.total_wd, 0) as total_withdrawn,
                COALESCE(s.total_wagered, 0) as total_wagered
            FROM users u
            LEFT JOIN (SELECT user_id, SUM(amount) as total_dep FROM deposits WHERE status = 'completed' GROUP BY user_id) d ON d.user_id = u.id
            LEFT JOIN (SELECT user_id, SUM(amount) as total_wd FROM withdrawals WHERE status = 'completed' GROUP BY user_id) w ON w.user_id = u.id
            LEFT JOIN (SELECT user_id, SUM(bet_amount) as total_wagered FROM spins GROUP BY user_id) s ON s.user_id = u.id
            WHERE COALESCE(w.total_wd, 0) > COALESCE(d.total_dep, 0) * 1.5
            AND COALESCE(d.total_dep, 0) > 0
            ORDER BY COALESCE(w.total_wd, 0) DESC
            LIMIT 20
        `);
        wdRatio.forEach(u => {
            alerts.push({
                type: 'withdrawal_ratio',
                severity: 'high',
                userId: u.id,
                username: u.username,
                message: `Withdrew $${(u.total_withdrawn || 0).toFixed(2)} on $${(u.total_deposited || 0).toFixed(2)} deposits (${((u.total_withdrawn / u.total_deposited) * 100).toFixed(0)}% ratio)`,
                data: { deposited: u.total_deposited, withdrawn: u.total_withdrawn, wagered: u.total_wagered }
            });
        });

        // 2. Rapid deposit velocity (3+ deposits in last hour)
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const rapidDeps = await db.all(`
            SELECT d.user_id, COUNT(*) as count, SUM(d.amount) as total, u.username
            FROM deposits d
            JOIN users u ON u.id = d.user_id
            WHERE d.created_at >= ?
            GROUP BY d.user_id
            HAVING COUNT(*) >= 3
        `, [hourAgo]);
        for (const rd of rapidDeps) {
            alerts.push({
                type: 'rapid_deposits',
                severity: 'medium',
                userId: rd.user_id,
                username: rd.username || 'Unknown',
                message: `${rd.count} deposits in the last hour totaling $${(rd.total || 0).toFixed(2)}`,
                data: { count: rd.count, total: rd.total }
            });
        }

        // 3. Users with suspiciously high win rate (potential exploit)
        const highWinRate = await db.all(`
            SELECT s.user_id, u.username, COUNT(*) as total_spins,
                SUM(CASE WHEN s.win_amount > 0 THEN 1 ELSE 0 END) as wins,
                SUM(s.bet_amount) as wagered, SUM(s.win_amount) as won
            FROM spins s
            JOIN users u ON u.id = s.user_id
            GROUP BY s.user_id
            HAVING COUNT(*) >= 50
            AND (SUM(s.win_amount) * 1.0 / SUM(s.bet_amount)) > 1.2
            ORDER BY (SUM(s.win_amount) * 1.0 / SUM(s.bet_amount)) DESC
            LIMIT 10
        `);
        for (const hw of highWinRate) {
            const rtp = hw.wagered > 0 ? ((hw.won / hw.wagered) * 100).toFixed(1) : '0';
            alerts.push({
                type: 'high_win_rate',
                severity: 'high',
                userId: hw.user_id,
                username: hw.username || 'Unknown',
                message: `RTP ${rtp}% over ${hw.total_spins} spins ($${(hw.wagered || 0).toFixed(2)} wagered, $${(hw.won || 0).toFixed(2)} won)`,
                data: { spins: hw.total_spins, wagered: hw.wagered, won: hw.won, rtp: parseFloat(rtp) }
            });
        }

        // 4. Large pending withdrawals
        const largePending = await db.all(`
            SELECT w.id, w.user_id, w.amount, w.created_at, u.username
            FROM withdrawals w
            JOIN users u ON u.id = w.user_id
            WHERE w.status = 'pending' AND w.amount >= 1000
            ORDER BY w.amount DESC
        `);
        largePending.forEach(wp => {
            alerts.push({
                type: 'large_withdrawal',
                severity: 'medium',
                userId: wp.user_id,
                username: wp.username,
                message: `Pending withdrawal of $${(wp.amount || 0).toFixed(2)} since ${wp.created_at}`,
                data: { withdrawalId: wp.id, amount: wp.amount }
            });
        });

        res.json({ alerts, count: alerts.length });
    } catch (err) {
        console.warn('[Admin] Fraud alerts error:', err.message);
        res.status(500).json({ error: 'Failed to load fraud alerts' });
    }
});

// GET /api/admin/users — User list
router.get('/users', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const users = await db.all(
            'SELECT id, username, email, balance, is_admin, is_banned, created_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );
        const total = await db.get('SELECT COUNT(*) as count FROM users');

        res.json({ users, total: total ? total.count : 0 });
    } catch (err) {
        console.warn('[Admin] Users list error:', err.message);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

// GET /api/admin/user/:id — User details with transactions
router.get('/user/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const user = await db.get('SELECT id, username, email, balance, is_admin, is_banned, created_at FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const transactions = await db.all(
            'SELECT id, user_id, type, amount, balance_before, balance_after, reference, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100',
            [userId]
        );
        const spinHistory = await db.all(
            'SELECT id, game_id, bet_amount, win_amount, created_at FROM spins WHERE user_id = ? ORDER BY id DESC LIMIT 50',
            [userId]
        );

        const spinStats = await db.get(
            'SELECT COUNT(*) as totalSpins, SUM(bet_amount) as totalWagered, SUM(win_amount) as totalWon FROM spins WHERE user_id = ?',
            [userId]
        );

        res.json({ user, transactions, spinHistory, spinStats });
    } catch (err) {
        console.warn('[Admin] User detail error:', err.message);
        res.status(500).json({ error: 'Failed to load user details' });
    }
});

// POST /api/admin/user/:id/ban
router.post('/user/:id/ban', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        await db.run(
            'INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
            [req.user.id, 'ban_user', userId, JSON.stringify({ reason: req.body.reason || '' })]
        );
        await db.run('UPDATE users SET is_banned = 1 WHERE id = ?', [userId]);
        res.json({ message: 'User banned' });
    } catch (err) {
        console.warn('[Admin] Ban error:', err.message);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

// POST /api/admin/user/:id/unban
router.post('/user/:id/unban', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        await db.run(
            'INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
            [req.user.id, 'unban_user', userId, JSON.stringify({ reason: req.body.reason || '' })]
        );
        await db.run('UPDATE users SET is_banned = 0 WHERE id = ?', [userId]);
        res.json({ message: 'User unbanned' });
    } catch (err) {
        console.warn('[Admin] Unban error:', err.message);
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

// POST /api/admin/user/:id/adjust-balance
router.post('/user/:id/adjust-balance', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { amount, reason } = req.body;
        const adjustment = parseFloat(amount);

        if (!Number.isFinite(adjustment)) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        // ROUND 47: Wrap in transaction — previously, concurrent admin requests
        // could read stale balanceBefore, causing audit log inconsistencies.
        await db.beginTransaction();
        try {
            const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            if (!user) {
                await db.rollback();
                return res.status(404).json({ error: 'User not found' });
            }

            const balanceBefore = user.balance;
            const balanceAfter = Math.max(0, balanceBefore + adjustment);

            await db.run(
                'INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
                [req.user.id, 'adjust_balance', userId, JSON.stringify({ balanceBefore, balanceAfter, adjustment, reason })]
            );
            await db.run('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?', [adjustment, userId]);
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'admin_adjustment', adjustment, balanceBefore, balanceAfter, reason || 'Admin adjustment']
            );

            await db.commit();
            res.json({ balance: balanceAfter });
        } catch (txErr) {
            try { await db.rollback(); } catch (_rb) { console.warn('[admin] rollback error:', _rb.message); }
            throw txErr;
        }
    } catch (err) {
        console.warn('[Admin] Adjust balance error:', err.message);
        res.status(500).json({ error: 'Failed to adjust balance' });
    }
});

// POST /api/admin/user/:id/send-bonus — Send a targeted bonus to a player
router.post('/user/:id/send-bonus', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { amount, reason } = req.body;
        const bonusAmount = parseFloat(amount);

        if (!Number.isFinite(bonusAmount) || bonusAmount <= 0) {
            return res.status(400).json({ error: 'Bonus amount must be a positive number' });
        }
        if (bonusAmount > 50000) {
            return res.status(400).json({ error: 'Bonus cannot exceed $50,000' });
        }

        // ROUND 47: Wrap in transaction + add lifetime admin bonus cap ($10,000)
        await db.beginTransaction();
        try {
            const user = await db.get('SELECT id, username, balance FROM users WHERE id = ?', [userId]);
            if (!user) {
                await db.rollback();
                return res.status(404).json({ error: 'User not found' });
            }

            // Self-exclusion check — admin bonuses must respect player self-exclusion
            if (await checkTargetSelfExclusion(userId)) {
                await db.rollback();
                return res.status(403).json({ error: 'User is self-excluded. Cannot send bonus.' });
            }

            // Lifetime admin bonus cap: $10,000 per user
            var totalAdminBonuses = await db.get(
                "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'admin_bonus'",
                [userId]
            );
            var lifetimeTotal = totalAdminBonuses ? parseFloat(totalAdminBonuses.total) || 0 : 0;
            if (lifetimeTotal + bonusAmount > 10000) {
                await db.rollback();
                return res.status(400).json({
                    error: 'Lifetime admin bonus limit ($10,000) would be exceeded. Current total: $' + lifetimeTotal.toFixed(2),
                    lifetimeTotal: lifetimeTotal,
                    limit: 10000
                });
            }

            const balanceBefore = user.balance || 0;
            // Admin bonuses go to bonus_balance with 15x standard wagering (per CLAUDE.md)
            var wageringReq = bonusAmount * 15;

            await db.run(
                'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                [bonusAmount, wageringReq, userId]
            );
            await db.run(
                'INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
                [req.user.id, 'send_bonus', userId, JSON.stringify({ bonusAmount, wageringReq, reason })]
            );
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'admin_bonus', bonusAmount, balanceBefore, balanceBefore, reason || 'Admin bonus (bonus_balance + ' + wageringReq + 'x wagering)']
            );

            await db.commit();
            res.json({
                message: 'Bonus sent to bonus_balance with ' + wageringReq + 'x wagering requirement',
                userId,
                username: user.username,
                bonusAmount,
                wageringRequirement: wageringReq,
            });
        } catch (txErr) {
            try { await db.rollback(); } catch (_rb) { console.warn('[admin] rollback error:', _rb.message); }
            throw txErr;
        }
    } catch (err) {
        console.warn('[Admin] Send bonus error:', err.message);
        res.status(500).json({ error: 'Failed to send bonus' });
    }
});

// POST /api/admin/bulk-bonus — Send bonus to multiple users
router.post('/bulk-bonus', async (req, res) => {
    try {
        const { userIds, amount, reason } = req.body;
        const bonusAmount = parseFloat(amount);

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ error: 'userIds array is required' });
        }
        if (!Number.isFinite(bonusAmount) || bonusAmount <= 0) {
            return res.status(400).json({ error: 'Bonus amount must be a positive number' });
        }
        if (bonusAmount > 10000) {
            return res.status(400).json({ error: 'Bulk bonus cannot exceed $10,000 per user' });
        }
        if (userIds.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 users per bulk bonus' });
        }

        let credited = 0;
        for (const uid of userIds) {
            const userId = parseInt(uid);
            if (isNaN(userId)) continue;

            const user = await db.get('SELECT id, balance FROM users WHERE id = ?', [userId]);
            if (!user) continue;

            // Skip self-excluded users in bulk bonus
            if (await checkTargetSelfExclusion(userId)) continue;

            const balanceBefore = user.balance || 0;
            // Bulk bonuses go to bonus_balance with 15x standard wagering (per CLAUDE.md)
            var wageringReq = bonusAmount * 15;

            await db.run(
                'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                [bonusAmount, wageringReq, userId]
            );
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'admin_bulk_bonus', bonusAmount, balanceBefore, balanceBefore, reason || 'Admin bulk bonus (bonus_balance + wagering)']
            );
            credited++;
        }

        res.json({ message: 'Bulk bonus sent', credited, totalAmount: credited * bonusAmount });
    } catch (err) {
        console.warn('[Admin] Bulk bonus error:', err.message);
        res.status(500).json({ error: 'Failed to send bulk bonus' });
    }
});

// GET /api/admin/recent-spins
router.get('/recent-spins', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const spins = await db.all(
            `SELECT s.id, s.game_id, s.bet_amount, s.win_amount, s.created_at, u.username
             FROM spins s JOIN users u ON s.user_id = u.id
             ORDER BY s.id DESC LIMIT ?`,
            [limit]
        );
        res.json({ spins });
    } catch (err) {
        console.warn('[Admin] Recent spins error:', err.message);
        res.status(500).json({ error: 'Failed to load recent spins' });
    }
});

// GET /api/admin/profit-status — Detailed profit analysis
router.get('/profit-status', async (req, res) => {
    try {
        const config = require('../config');
        const overall = await db.get('SELECT COUNT(*) as spins, SUM(bet_amount) as wagered, SUM(win_amount) as paid FROM spins');
        const wagered = overall ? overall.wagered || 0 : 0;
        const paid = overall ? overall.paid || 0 : 0;
        const profit = wagered - paid;
        const rtp = wagered > 0 ? paid / wagered : 0;

        // Per-game breakdown
        const gameStats = await db.all('SELECT game_id, total_spins, total_wagered, total_paid, actual_rtp FROM game_stats ORDER BY total_wagered DESC LIMIT 200');

        // Hourly profit (last 24h)
        const hourlyProfit = await db.all(`
            SELECT strftime('%Y-%m-%d %H:00', created_at) as hour,
                   SUM(bet_amount) as wagered, SUM(win_amount) as paid,
                   COUNT(*) as spins
            FROM spins
            WHERE created_at > datetime('now', '-24 hours')
            GROUP BY hour ORDER BY hour
        `);

        // Top winners (potential threats to profitability)
        // NOTE: GROUP BY includes u.username for PG compat (strict non-aggregated column rule).
        // HAVING repeats the expression (PG disallows SELECT aliases in HAVING).
        const topWinners = await db.all(`
            SELECT u.username, SUM(s.win_amount - s.bet_amount) as net_win,
                   SUM(s.bet_amount) as wagered, SUM(s.win_amount) as paid,
                   COUNT(*) as spins
            FROM spins s JOIN users u ON s.user_id = u.id
            GROUP BY s.user_id, u.username
            HAVING SUM(s.win_amount - s.bet_amount) > 0
            ORDER BY net_win DESC LIMIT 10
        `);

        res.json({
            summary: {
                totalWagered: wagered,
                totalPaid: paid,
                houseProfit: profit,
                currentRTP: (rtp * 100).toFixed(2) + '%',
                targetRTP: (config.TARGET_RTP * 100).toFixed(0) + '%',
                totalSpins: overall ? overall.spins : 0,
                profitMargin: wagered > 0 ? ((1 - rtp) * 100).toFixed(2) + '%' : '0%',
                isHealthy: profit >= 0 && rtp <= config.TARGET_RTP + 0.05,
                emergencyMode: profit < (config.PROFIT_FLOOR || -500),
            },
            gameStats,
            hourlyProfit,
            topWinners,
        });
    } catch (err) {
        console.warn('[Admin] Profit status error:', err.message);
        res.status(500).json({ error: 'Failed to load profit status' });
    }
});

// POST /api/admin/house-edge/config — Update house edge config
// SECURITY: RTP capped at 96% (min 4% house edge) to guarantee profitability.
// MAX_WIN_MULTIPLIER capped at 500 to prevent catastrophic single-spin losses.
// All changes logged for audit trail.
router.post('/house-edge/config', async (req, res) => {
    try {
        const config = require('../config');
        const { targetRTP, maxWinMultiplier, profitFloor } = req.body;
        const changes = [];

        if (targetRTP !== undefined) {
            const rtp = parseFloat(targetRTP);
            // ROUND 61: Number.isFinite — isNaN allows Infinity to pass
            if (!Number.isFinite(rtp) || rtp < 0.50 || rtp > 0.96) {
                return res.status(400).json({ error: 'TARGET_RTP must be between 0.50 and 0.96 (50%-96%). Min 4% house edge required for profitability.' });
            }
            const oldRTP = config.TARGET_RTP;
            config.TARGET_RTP = rtp;
            changes.push(`TARGET_RTP: ${oldRTP} → ${rtp}`);
        }
        if (maxWinMultiplier !== undefined) {
            const mult = parseInt(maxWinMultiplier);
            if (!Number.isFinite(mult) || mult < 10 || mult > 500) {
                return res.status(400).json({ error: 'MAX_WIN_MULTIPLIER must be between 10 and 500' });
            }
            const oldMult = config.MAX_WIN_MULTIPLIER;
            config.MAX_WIN_MULTIPLIER = mult;
            changes.push(`MAX_WIN_MULTIPLIER: ${oldMult} → ${mult}`);
        }
        if (profitFloor !== undefined) {
            const floor = parseFloat(profitFloor);
            if (!Number.isFinite(floor) || floor < -1000 || floor > 0) {
                return res.status(400).json({ error: 'PROFIT_FLOOR must be between -1000 and 0' });
            }
            const oldFloor = config.PROFIT_FLOOR;
            config.PROFIT_FLOOR = floor;
            changes.push(`PROFIT_FLOOR: ${oldFloor} → ${floor}`);
        }

        // Audit log — track all config changes with admin identity
        if (changes.length > 0) {
            const adminId = req.user ? req.user.id : 'unknown';
            console.warn(`[AUDIT] House edge config changed by admin ${adminId}: ${changes.join(', ')}`);
            try {
                await db.run(
                    "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'admin_config', 0, ?)",
                    [adminId, `House edge config: ${changes.join(', ')}`]
                );
            } catch (_) { /* non-critical audit log */ }
        }

        res.json({ message: 'Config updated', config: { TARGET_RTP: config.TARGET_RTP, MAX_WIN_MULTIPLIER: config.MAX_WIN_MULTIPLIER, PROFIT_FLOOR: config.PROFIT_FLOOR } });
    } catch (err) {
        console.warn('[Admin] House edge config error:', err.message);
        res.status(500).json({ error: 'Failed to update config' });
    }
});

// GET /api/admin/pending-deposits — List deposits awaiting admin approval
router.get('/pending-deposits', async (req, res) => {
    try {
        const deposits = await db.all(
            `SELECT d.id, d.user_id, d.amount, d.currency, d.status, d.reference, d.created_at,
                    u.username, u.email
             FROM deposits d
             JOIN users u ON d.user_id = u.id
             WHERE d.status = 'pending'
             ORDER BY d.created_at ASC`
        );
        res.json({ deposits });
    } catch (err) {
        console.warn('[Admin] Pending deposits error:', err.message);
        res.status(500).json({ error: 'Failed to load pending deposits' });
    }
});

// POST /api/admin/approve-deposit — Approve a pending deposit (credit player balance + bonus to bonus_balance)
router.post('/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        if (!depositId) return res.status(400).json({ error: 'depositId is required' });

        // Atomic pre-claim: prevent two concurrent approvals from both succeeding.
        // This UPDATE only succeeds if the deposit is still 'pending', turning the
        // status check + update into a single atomic operation.
        const claimResult = await db.run("UPDATE deposits SET status = 'processing' WHERE id = ? AND status = 'pending'", [depositId]);
        if (!claimResult || claimResult.changes === 0) {
            const existing = await db.get('SELECT status FROM deposits WHERE id = ?', [depositId]);
            if (!existing) return res.status(404).json({ error: 'Deposit not found' });
            return res.status(409).json({ error: `Deposit is already ${existing.status}` });
        }

        const deposit = await db.get('SELECT id, user_id, amount, status, reference FROM deposits WHERE id = ?', [depositId]);
        if (!deposit) return res.status(404).json({ error: 'Deposit not found' });

        const user = await db.get('SELECT balance, bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?', [deposit.user_id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const cfg = require('../config');
        const balanceBefore = user.balance;
        let balanceAfter = balanceBefore + deposit.amount;

        // Determine bonus: first deposit or reload
        let bonusAmount = 0;
        let wageringMult = 0;
        let bonusType = '';
        const priorDeposits = await db.get(
            "SELECT COUNT(*) as count FROM deposits WHERE user_id = ? AND status = 'completed'",
            [deposit.user_id]
        );
        if (priorDeposits && priorDeposits.count === 0) {
            // First deposit: 100% match up to $500
            bonusAmount = Math.min(deposit.amount * (cfg.FIRST_DEPOSIT_BONUS_PCT / 100), cfg.FIRST_DEPOSIT_BONUS_MAX);
            wageringMult = cfg.FIRST_DEPOSIT_WAGERING_MULT || 45;
            bonusType = 'first_deposit_bonus';
        } else {
            // Reload deposit: 50% match up to $250
            bonusAmount = Math.min(deposit.amount * ((cfg.RELOAD_BONUS_PCT || 50) / 100), cfg.RELOAD_BONUS_MAX || 250);
            wageringMult = cfg.RELOAD_WAGERING_MULT || 30;
            bonusType = 'reload_bonus';
        }

        // Check self-exclusion before the transaction (read-only check)
        const isSelfExcluded = bonusAmount > 0 ? await checkTargetSelfExclusion(deposit.user_id) : true;

        // Wrap all balance/deposit/bonus operations in a single transaction.
        // Without this, a crash between balance credit and deposit status update
        // could credit money without marking the deposit as completed, allowing
        // the admin to approve it again (double-credit).
        await db.beginTransaction();
        try {
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);
            await db.run("UPDATE deposits SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [depositId]);
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [deposit.user_id, 'deposit', deposit.amount, balanceBefore, balanceAfter, deposit.reference || 'admin-approved']
            );

            // Credit bonus to bonus_balance with wagering requirement
            // Skip bonus for self-excluded users (deposit itself is still approved)
            if (bonusAmount > 0 && !isSelfExcluded) {
                const wagerReq = bonusAmount * wageringMult;
                await db.run(
                    'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                    [bonusAmount, wagerReq, deposit.user_id]
                );
                const refLabel = bonusType === 'first_deposit_bonus'
                    ? `FIRST-DEPOSIT-${cfg.FIRST_DEPOSIT_BONUS_PCT}PCT-MATCH (${wageringMult}x wagering)`
                    : `RELOAD-${cfg.RELOAD_BONUS_PCT || 50}PCT-MATCH (${wageringMult}x wagering)`;
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [deposit.user_id, bonusType, bonusAmount, balanceAfter, balanceAfter, refLabel]
                );
            }

            await db.commit();
        } catch (txErr) {
            await db.rollback();
            // Revert the atomic pre-claim so the deposit can be retried
            await db.run("UPDATE deposits SET status = 'pending' WHERE id = ? AND status = 'processing'", [depositId]);
            throw txErr;
        }

        const msg = bonusAmount > 0 && !isSelfExcluded
            ? `Deposit approved + $${bonusAmount.toFixed(2)} ${bonusType.replace(/_/g, ' ')} (${wageringMult}x wagering required)`
            : 'Deposit approved';
        res.json({ message: msg, depositId, amount: deposit.amount, bonus: isSelfExcluded ? 0 : bonusAmount, wageringRequired: isSelfExcluded ? 0 : bonusAmount * wageringMult, newBalance: balanceAfter });
    } catch (err) {
        console.warn('[Admin] Approve deposit error:', err.message);
        res.status(500).json({ error: 'Failed to approve deposit' });
    }
});

// POST /api/admin/reject-deposit — Reject a pending deposit
router.post('/reject-deposit', async (req, res) => {
    try {
        const { depositId, reason } = req.body;
        if (!depositId) return res.status(400).json({ error: 'depositId is required' });

        const deposit = await db.get('SELECT id, user_id, amount, status FROM deposits WHERE id = ?', [depositId]);
        if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
        if (deposit.status !== 'pending') return res.status(400).json({ error: `Deposit is already ${deposit.status}` });

        await db.run("UPDATE deposits SET status = 'rejected', completed_at = datetime('now') WHERE id = ?", [depositId]);

        res.json({ message: 'Deposit rejected', depositId, reason: reason || 'No reason provided' });
    } catch (err) {
        console.warn('[Admin] Reject deposit error:', err.message);
        res.status(500).json({ error: 'Failed to reject deposit' });
    }
});

// ═══════════════════════════════════════════════════
//  WITHDRAWAL MANAGEMENT
// ═══════════════════════════════════════════════════

// GET /api/admin/pending-withdrawals — List withdrawals awaiting admin processing
router.get('/pending-withdrawals', async (req, res) => {
    try {
        const withdrawals = await db.all(
            `SELECT w.id, w.user_id, w.amount, w.currency, w.payment_type, w.status, w.reference, w.created_at,
                    u.username, u.email, u.balance
             FROM withdrawals w
             JOIN users u ON w.user_id = u.id
             WHERE w.status = 'pending'
             ORDER BY w.created_at ASC`
        );

        // For each withdrawal, get wagering stats to help admin evaluate
        for (const w of withdrawals) {
            const deposits = await db.get(
                "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = 'completed'",
                [w.user_id]
            );
            const wagered = await db.get(
                'SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?',
                [w.user_id]
            );
            w.totalDeposited = deposits ? deposits.total : 0;
            w.totalWagered = wagered ? wagered.total : 0;
            w.wagerRatio = w.totalDeposited > 0 ? (w.totalWagered / w.totalDeposited).toFixed(1) : 'N/A';
            // Cooling-off status
            var createdTime = new Date(w.created_at).getTime();
            var hoursSince = (Date.now() - createdTime) / (1000 * 60 * 60);
            w.coolingOff = hoursSince < 24;
            w.hoursUntilEligible = w.coolingOff ? Math.ceil(24 - hoursSince) : 0;
        }

        res.json({ withdrawals });
    } catch (err) {
        console.warn('[Admin] Pending withdrawals error:', err.message);
        res.status(500).json({ error: 'Failed to load pending withdrawals' });
    }
});

// POST /api/admin/approve-withdrawal — Process and approve a pending withdrawal.
// Enforces a 24h cooling-off period — withdrawals cannot be approved until 24h after creation.
// The previous `forceApprove` bypass was removed: allowing any admin to skip the AML
// cooling-off window without a secondary approval or audit trail was a material
// insider-risk vector. Use the dedicated `/api/admin/reject-withdrawal` endpoint to
// cancel a withdrawal during the cooling-off window if needed.
router.post('/approve-withdrawal', async (req, res) => {
    try {
        const { withdrawalId } = req.body;
        if (!withdrawalId) return res.status(400).json({ error: 'withdrawalId is required' });

        const wd = await db.get('SELECT id, user_id, amount, status, created_at, account_created_at FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
        if (wd.status !== 'pending') return res.status(400).json({ error: `Withdrawal is already ${wd.status}` });

        // 24h cooling-off enforcement (hard — no bypass)
        if (wd.created_at) {
            var createdTime = new Date(wd.created_at).getTime();
            var hoursSince = (Date.now() - createdTime) / (1000 * 60 * 60);
            if (hoursSince < 24) {
                var hoursLeft = Math.ceil(24 - hoursSince);
                return res.status(400).json({
                    error: 'Cooling-off period active. Withdrawal can be processed in ' + hoursLeft + ' hour(s).',
                    coolingOff: true,
                    hoursRemaining: hoursLeft,
                    eligibleAt: new Date(createdTime + 24 * 60 * 60 * 1000).toISOString()
                });
            }
        }

        // Atomic approve — prevents two admins both approving the same withdrawal.
        var approveResult = await db.run(
            "UPDATE withdrawals SET status = 'completed', processed_at = datetime('now'), admin_note = 'Approved by admin' WHERE id = ? AND status = 'pending'",
            [withdrawalId]
        );
        if (!approveResult || approveResult.changes === 0) {
            return res.status(409).json({ error: 'Withdrawal was already processed by another admin' });
        }

        // Audit log (best-effort)
        await db.run(
            "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, 'approve_withdrawal', ?, ?, datetime('now'))",
            [req.user.id, wd.user_id, JSON.stringify({ withdrawalId, amount: wd.amount })]
        ).catch(function(_) { /* audit table may not exist in older envs */ });

        res.json({ message: 'Withdrawal approved and ready for payout', withdrawalId, amount: wd.amount });
    } catch (err) {
        console.warn('[Admin] Approve withdrawal error:', err.message);
        res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
});

// POST /api/admin/reject-withdrawal — Reject a withdrawal and refund balance
router.post('/reject-withdrawal', async (req, res) => {
    try {
        const { withdrawalId, reason } = req.body;
        if (!withdrawalId) return res.status(400).json({ error: 'withdrawalId is required' });

        const wd = await db.get('SELECT id, user_id, amount, status, created_at, account_created_at FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });
        if (wd.status !== 'pending') return res.status(400).json({ error: `Withdrawal is already ${wd.status}` });

        // Refund the balance back to the user
        const user = await db.get('SELECT balance FROM users WHERE id = ?', [wd.user_id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const balanceBefore = user.balance;
        const balanceAfter = balanceBefore + wd.amount;

        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [wd.amount, wd.user_id]);
        await db.run(
            "UPDATE withdrawals SET status = 'rejected', processed_at = datetime('now'), admin_note = ? WHERE id = ?",
            [reason || 'Rejected by admin', withdrawalId]
        );
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [wd.user_id, 'withdrawal_refund', wd.amount, balanceBefore, balanceAfter, `WDR-REJECT-${withdrawalId}`]
        );

        res.json({ message: 'Withdrawal rejected and refunded', withdrawalId, amount: wd.amount, newBalance: balanceAfter });
    } catch (err) {
        console.warn('[Admin] Reject withdrawal error:', err.message);
        res.status(500).json({ error: 'Failed to reject withdrawal' });
    }
});


// ═══════════════════════════════════════════════════════════
//  KYC VERIFICATION — Admin approval (required for withdrawals > $2,000)
// ═══════════════════════════════════════════════════════════

// GET /api/admin/kyc-pending — List users with pending KYC verification
router.get('/kyc-pending', async (req, res) => {
    try {
        const pending = await db.all(`
            SELECT u.id, u.username, u.email, u.date_of_birth, u.kyc_status,
                   v.document_type, v.submitted_at, v.notes
            FROM users u
            INNER JOIN user_verification v ON v.user_id = u.id
            WHERE v.status = 'pending'
            ORDER BY v.submitted_at ASC
            LIMIT 200
        `);
        res.json({ pending: pending || [] });
    } catch (err) {
        console.warn('[Admin] KYC pending list error:', err.message);
        res.status(500).json({ error: 'Failed to load pending verifications' });
    }
});

// POST /api/admin/kyc-approve — Approve a user's KYC verification
router.post('/kyc-approve', async (req, res) => {
    try {
        const { userId, notes } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const user = await db.get('SELECT id, username, kyc_status FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        await db.run(
            "UPDATE user_verification SET status = 'verified', verified_at = datetime('now'), notes = ? WHERE user_id = ?",
            [notes || null, userId]
        );
        await db.run(
            "UPDATE users SET kyc_status = 'verified', updated_at = datetime('now') WHERE id = ?",
            [userId]
        );

        // Audit log
        await db.run(
            "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, 'kyc_approve', ?, ?, datetime('now'))",
            [req.user.id, userId, JSON.stringify({ notes: notes || null })]
        ).catch(function(_) { /* audit table may not exist in older envs */ });

        console.warn(`[Admin] KYC approved for user ${userId} (${user.username}) by admin ${req.user.id}`);
        res.json({ success: true, userId, kyc_status: 'verified' });
    } catch (err) {
        console.warn('[Admin] KYC approve error:', err.message);
        res.status(500).json({ error: 'Failed to approve KYC' });
    }
});

// POST /api/admin/kyc-reject — Reject a user's KYC verification
router.post('/kyc-reject', async (req, res) => {
    try {
        const { userId, reason } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
            return res.status(400).json({ error: 'A rejection reason of at least 5 characters is required' });
        }

        const user = await db.get('SELECT id, username FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        await db.run(
            "UPDATE user_verification SET status = 'rejected', notes = ?, verified_at = datetime('now') WHERE user_id = ?",
            [reason.trim(), userId]
        );
        await db.run(
            "UPDATE users SET kyc_status = 'rejected', updated_at = datetime('now') WHERE id = ?",
            [userId]
        );

        await db.run(
            "INSERT INTO admin_audit_log (admin_id, action, target_user_id, details, created_at) VALUES (?, 'kyc_reject', ?, ?, datetime('now'))",
            [req.user.id, userId, JSON.stringify({ reason: reason.trim() })]
        ).catch(function(_) { /* audit table may not exist */ });

        console.warn(`[Admin] KYC rejected for user ${userId} (${user.username}) — reason: ${reason.trim()}`);
        res.json({ success: true, userId, kyc_status: 'rejected', reason: reason.trim() });
    } catch (err) {
        console.warn('[Admin] KYC reject error:', err.message);
        res.status(500).json({ error: 'Failed to reject KYC' });
    }
});

// GET /api/admin/lapsed-players — Detect inactive players for re-engagement campaigns
router.get('/lapsed-players', async (req, res) => {
    try {
        const daysThreshold = Math.max(1, parseInt(req.query.days, 10) || 7);

        // Find users who haven't spun in N+ days but have deposited before
        const lapsedPlayers = await db.all(`
            SELECT u.id, u.username, u.email, u.balance, u.created_at,
                COALESCE(d.total_deposited, 0) as total_deposited,
                COALESCE(s.total_wagered, 0) as total_wagered,
                COALESCE(s.total_spins, 0) as total_spins,
                s.last_spin
            FROM users u
            LEFT JOIN (
                SELECT user_id, SUM(amount) as total_deposited
                FROM deposits WHERE status = 'completed'
                GROUP BY user_id
            ) d ON d.user_id = u.id
            LEFT JOIN (
                SELECT user_id, SUM(bet_amount) as total_wagered, COUNT(*) as total_spins,
                       MAX(created_at) as last_spin
                FROM spins GROUP BY user_id
            ) s ON s.user_id = u.id
            WHERE u.is_banned = 0
            AND (s.last_spin IS NULL OR s.last_spin < datetime('now', '-' || ? || ' days'))
            AND COALESCE(d.total_deposited, 0) > 0
            ORDER BY COALESCE(d.total_deposited, 0) DESC
            LIMIT 100
        `, [daysThreshold]);

        // Calculate suggested bonus based on player value
        const enriched = lapsedPlayers.map(p => {
            const daysSinceActive = p.last_spin
                ? Math.floor((Date.now() - new Date(p.last_spin).getTime()) / 86400000)
                : 999;
            let suggestedBonus = 50; // base
            if (p.total_deposited > 1000) suggestedBonus = 200;
            else if (p.total_deposited > 500) suggestedBonus = 100;
            if (daysSinceActive > 30) suggestedBonus = Math.round(suggestedBonus * 1.5);
            return {
                ...p,
                daysSinceActive,
                suggestedBonus: Math.min(suggestedBonus, 500),
                tier: p.total_deposited > 1000 ? 'whale' : p.total_deposited > 500 ? 'regular' : 'casual',
            };
        });

        res.json({
            lapsedPlayers: enriched,
            count: enriched.length,
            daysThreshold,
        });
    } catch (err) {
        console.warn('[Admin] Lapsed players error:', err.message);
        res.status(500).json({ error: 'Failed to load lapsed players' });
    }
});

// ═══════════════════════════════════════════════════
//  ANALYTICS ENDPOINTS
// ═══════════════════════════════════════════════════

// GET /api/admin/analytics/retention — Cohort retention: % of users active in subsequent weeks after registration
router.get('/analytics/retention', async (req, res) => {
    try {
        const cohorts = await db.all(`
            SELECT
                strftime('%Y-W%W', u.created_at) as cohort_week,
                COUNT(DISTINCT u.id) as signups,
                COUNT(DISTINCT CASE WHEN EXISTS (
                    SELECT 1 FROM spins s WHERE s.user_id = u.id
                    AND s.created_at >= datetime(u.created_at, '+7 days')
                    AND s.created_at < datetime(u.created_at, '+14 days')
                ) THEN u.id END) as week1_active,
                COUNT(DISTINCT CASE WHEN EXISTS (
                    SELECT 1 FROM spins s WHERE s.user_id = u.id
                    AND s.created_at >= datetime(u.created_at, '+14 days')
                    AND s.created_at < datetime(u.created_at, '+21 days')
                ) THEN u.id END) as week2_active,
                COUNT(DISTINCT CASE WHEN EXISTS (
                    SELECT 1 FROM spins s WHERE s.user_id = u.id
                    AND s.created_at >= datetime(u.created_at, '+21 days')
                    AND s.created_at < datetime(u.created_at, '+28 days')
                ) THEN u.id END) as week3_active,
                COUNT(DISTINCT CASE WHEN EXISTS (
                    SELECT 1 FROM spins s WHERE s.user_id = u.id
                    AND s.created_at >= datetime(u.created_at, '+28 days')
                ) THEN u.id END) as week4_active
            FROM users u
            WHERE u.username != 'admin'
            GROUP BY cohort_week
            ORDER BY cohort_week DESC
            LIMIT 12
        `);

        const formatted = cohorts.map(c => ({
            cohort: c.cohort_week,
            signups: c.signups,
            retention: {
                week1: c.signups > 0 ? Math.round(c.week1_active / c.signups * 100) : 0,
                week2: c.signups > 0 ? Math.round(c.week2_active / c.signups * 100) : 0,
                week3: c.signups > 0 ? Math.round(c.week3_active / c.signups * 100) : 0,
                week4: c.signups > 0 ? Math.round(c.week4_active / c.signups * 100) : 0,
            }
        }));

        res.json({ cohorts: formatted });
    } catch (e) {
        console.warn('[Admin] retention analytics error:', e.message);
        res.status(500).json({ error: 'Failed to fetch retention data' });
    }
});

// GET /api/admin/analytics/kpis — Key performance indicators: DAU, WAU, MAU, ARPU, revenue
router.get('/analytics/kpis', async (req, res) => {
    try {
        const dau = await db.get(`SELECT COUNT(DISTINCT user_id) as cnt FROM spins WHERE created_at >= datetime('now', '-1 day')`);
        const wau = await db.get(`SELECT COUNT(DISTINCT user_id) as cnt FROM spins WHERE created_at >= datetime('now', '-7 days')`);
        const mau = await db.get(`SELECT COUNT(DISTINCT user_id) as cnt FROM spins WHERE created_at >= datetime('now', '-30 days')`);

        const deposits30d = await db.get(`
            SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
            FROM deposits WHERE status = 'completed' AND created_at >= datetime('now', '-30 days')
        `);

        const wagered30d = await db.get(`
            SELECT COALESCE(SUM(bet_amount), 0) as total, COALESCE(SUM(win_amount), 0) as won
            FROM spins WHERE created_at >= datetime('now', '-30 days')
        `);

        const revenue30d = (wagered30d ? wagered30d.total : 0) - (wagered30d ? wagered30d.won : 0);
        const arpu = mau && mau.cnt > 0 ? revenue30d / mau.cnt : 0;

        const totalUsers = await db.get(`SELECT COUNT(*) as cnt FROM users WHERE username != 'admin'`);
        const newUsers7d = await db.get(`SELECT COUNT(*) as cnt FROM users WHERE created_at >= datetime('now', '-7 days') AND username != 'admin'`);

        res.json({
            kpis: {
                dau: dau ? dau.cnt : 0,
                wau: wau ? wau.cnt : 0,
                mau: mau ? mau.cnt : 0,
                arpu: Math.round(arpu * 100) / 100,
                revenue30d: Math.round(revenue30d * 100) / 100,
                deposits30d: deposits30d ? { count: deposits30d.cnt, total: deposits30d.total } : { count: 0, total: 0 },
                wagered30d: wagered30d ? wagered30d.total : 0,
                totalUsers: totalUsers ? totalUsers.cnt : 0,
                newUsers7d: newUsers7d ? newUsers7d.cnt : 0
            }
        });
    } catch (e) {
        console.warn('[Admin] KPI analytics error:', e.message);
        res.status(500).json({ error: 'Failed to fetch KPIs' });
    }
});

// GET /api/admin/analytics/revenue-by-game — Revenue breakdown per game (wagered - won = house take)
router.get('/analytics/revenue-by-game', async (req, res) => {
    try {
        const games = await db.all(`
            SELECT game_id,
                   COUNT(*) as spins,
                   COUNT(DISTINCT user_id) as players,
                   COALESCE(SUM(bet_amount), 0) as wagered,
                   COALESCE(SUM(win_amount), 0) as won
            FROM spins
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY game_id
            ORDER BY (COALESCE(SUM(bet_amount), 0) - COALESCE(SUM(win_amount), 0)) DESC
            LIMIT 30
        `);

        const formatted = games.map(g => ({
            gameId: g.game_id,
            spins: g.spins,
            players: g.players,
            wagered: g.wagered,
            won: g.won,
            revenue: Math.round((g.wagered - g.won) * 100) / 100,
            rtp: g.wagered > 0 ? Math.round(g.won / g.wagered * 10000) / 100 : 0
        }));

        res.json({ games: formatted });
    } catch (e) {
        console.warn('[Admin] revenue-by-game error:', e.message);
        res.status(500).json({ error: 'Failed to fetch game revenue' });
    }
});

// GET /api/admin/analytics/vip-distribution — Count and revenue by VIP tier (computed from total wagered)
router.get('/analytics/vip-distribution', async (req, res) => {
    try {
        // VIP tier is computed from total wagered, not a DB column
        const players = await db.all(`
            SELECT u.id,
                   COALESCE(s.total_wagered, 0) as total_wagered,
                   COALESCE(d.total_deposited, 0) as total_deposited
            FROM users u
            LEFT JOIN (
                SELECT user_id, SUM(bet_amount) as total_wagered FROM spins GROUP BY user_id
            ) s ON u.id = s.user_id
            LEFT JOIN (
                SELECT user_id, SUM(amount) as total_deposited FROM deposits WHERE status = 'completed' GROUP BY user_id
            ) d ON u.id = d.user_id
            WHERE u.username != 'admin'
        `);

        // Compute VIP tiers using same thresholds as leaderboard.routes.js
        const tierBuckets = {};
        for (const p of players) {
            const w = parseFloat(p.total_wagered) || 0;
            let tier;
            if (w >= 100000) tier = 'Elite';
            else if (w >= 50000) tier = 'Diamond';
            else if (w >= 20000) tier = 'Platinum';
            else if (w >= 10000) tier = 'Gold';
            else if (w >= 5000) tier = 'Silver';
            else tier = 'Bronze';

            if (!tierBuckets[tier]) {
                tierBuckets[tier] = { vip_tier: tier, players: 0, total_deposited: 0, total_wagered: 0 };
            }
            tierBuckets[tier].players++;
            tierBuckets[tier].total_deposited += parseFloat(p.total_deposited) || 0;
            tierBuckets[tier].total_wagered += w;
        }

        // Sort by tier rank (highest first)
        const tierOrder = ['Elite', 'Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze'];
        const tiers = tierOrder
            .filter(t => tierBuckets[t])
            .map(t => tierBuckets[t]);

        res.json({ tiers });
    } catch (e) {
        console.warn('[Admin] VIP distribution error:', e.message);
        res.status(500).json({ error: 'Failed to fetch VIP distribution' });
    }
});

// GET /api/admin/analytics/top-players — Top 10 players by wagered (all time)
router.get('/analytics/top-players', async (req, res) => {
    try {
        const players = await db.all(`
            SELECT u.id, u.username, u.vip_level,
                   COALESCE(s.total_wagered, 0) as total_wagered,
                   COALESCE(s.total_won, 0)     as total_won,
                   COALESCE(d.total_deposited, 0) as total_deposited
            FROM users u
            LEFT JOIN (
                SELECT user_id,
                       SUM(bet_amount) as total_wagered,
                       SUM(win_amount) as total_won
                FROM spins GROUP BY user_id
            ) s ON u.id = s.user_id
            LEFT JOIN (
                SELECT user_id, SUM(amount) as total_deposited
                FROM deposits WHERE status = 'completed' GROUP BY user_id
            ) d ON u.id = d.user_id
            WHERE u.username != 'admin'
            ORDER BY COALESCE(s.total_wagered, 0) DESC
            LIMIT 10
        `);
        res.json({ players });
    } catch (e) {
        console.warn('[Admin] top-players error:', e.message);
        res.status(500).json({ error: 'Failed to fetch top players' });
    }
});

// ═══════════════════════════════════════════════════
//  CAMPAIGN MANAGEMENT
// ═══════════════════════════════════════════════════

// GET /api/admin/campaigns — List all campaigns
router.get('/campaigns', async (req, res) => {
    try {
        const campaignService = require('../services/campaign.service');
        const campaigns = await campaignService.getAllCampaigns();
        res.json({ campaigns });
    } catch (e) {
        console.warn('[Admin] Campaigns list error:', e.message);
        res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
});

// POST /api/admin/campaigns — Create a new campaign
router.post('/campaigns', async (req, res) => {
    try {
        const campaignService = require('../services/campaign.service');
        const { name, type, bonusPct, maxBonus, wageringMult, minDeposit, startAt, endAt, promoCode, targetSegment, maxClaims } = req.body;
        if (!name || !startAt || !endAt) return res.status(400).json({ error: 'Name, startAt, endAt required' });
        await campaignService.createCampaign({ name, type, bonusPct, maxBonus, wageringMult, minDeposit, startAt, endAt, promoCode, targetSegment, maxClaims });
        res.json({ success: true });
    } catch (e) {
        console.warn('[Admin] Create campaign error:', e.message);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

// POST /api/admin/campaigns/:id/toggle — Enable/disable a campaign
router.post('/campaigns/:id/toggle', async (req, res) => {
    try {
        const campaignService = require('../services/campaign.service');
        await campaignService.toggleCampaign(req.params.id, req.body.active);
        res.json({ success: true });
    } catch (e) {
        console.warn('[Admin] Toggle campaign error:', e.message);
        res.status(500).json({ error: 'Failed to toggle campaign' });
    }
});

// ═══════════════════════════════════════════════════
//  BONUS EVENT MANAGEMENT
// ═══════════════════════════════════════════════════

// GET /api/admin/events — List all bonus events
router.get('/events', async (req, res) => {
    try {
        const eventService = require('../services/event.service');
        const events = await eventService.getAllEvents();
        res.json({ events });
    } catch (e) {
        console.warn('[Admin] Events list error:', e.message);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// POST /api/admin/events — Create a new bonus event
router.post('/events', async (req, res) => {
    try {
        const eventService = require('../services/event.service');
        const { name, description, event_type, multiplier, target_games, start_at, end_at } = req.body;
        if (!name || !event_type || !start_at || !end_at) {
            return res.status(400).json({ error: 'name, event_type, start_at, and end_at are required' });
        }
        await eventService.createEvent({ name, description, event_type, multiplier, target_games, start_at, end_at });
        res.json({ success: true });
    } catch (e) {
        console.warn('[Admin] Create event error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

// POST /api/admin/events/:id/toggle — Enable/disable a bonus event
router.post('/events/:id/toggle', async (req, res) => {
    try {
        const eventService = require('../services/event.service');
        await eventService.toggleEvent(req.params.id, req.body.active);
        res.json({ success: true });
    } catch (e) {
        console.warn('[Admin] Toggle event error:', e.message);
        res.status(500).json({ error: 'Failed to toggle event' });
    }
});

// ═══════════════════════════════════════════════════
//  WITHDRAWAL APPROVAL ENDPOINTS (RESTful)
// ═══════════════════════════════════════════════════

// GET /api/admin/withdrawals — List withdrawals with user info, filterable by status
router.get('/withdrawals', async (req, res) => {
    try {
        const status = req.query.status || 'pending';
        const validStatuses = ['pending', 'completed', 'rejected', 'all'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status filter. Use: pending, completed, rejected, or all' });
        }

        // Support multi-status filter for admin UI: status=pending returns
        // BOTH 'pending' and 'otp_verified' so admins can see everything in
        // the review queue in one pass, with otp_verified flagged.
        let query = `
            SELECT w.id, w.user_id, w.amount, w.currency, w.payment_type, w.status,
                   w.admin_note, w.reference, w.created_at, w.processed_at,
                   w.otp_code IS NOT NULL AS otp_outstanding,
                   w.otp_verified_at,
                   u.username, u.email, u.balance
            FROM withdrawals w
            JOIN users u ON w.user_id = u.id
        `;
        const params = [];

        if (status === 'pending') {
            query += " WHERE w.status IN ('pending', 'otp_verified')";
        } else if (status !== 'all') {
            query += ' WHERE w.status = ?';
            params.push(status);
        }

        query += ' ORDER BY w.created_at ASC';

        const withdrawals = await db.all(query, params);
        res.json({ withdrawals, count: withdrawals.length, filter: status });
    } catch (err) {
        console.warn('[Admin] List withdrawals error:', err.message);
        res.status(500).json({ error: 'Failed to load withdrawals' });
    }
});

// GET /api/admin/withdrawals/:id — Get single withdrawal with enriched user details
router.get('/withdrawals/:id', async (req, res) => {
    try {
        const withdrawalId = req.params.id;

        const withdrawal = await db.get(
            `SELECT w.id, w.user_id, w.amount, w.currency, w.payment_type, w.status,
                    w.admin_note, w.reference, w.created_at, w.processed_at,
                    u.username, u.email, u.balance, u.created_at as account_created_at
             FROM withdrawals w
             JOIN users u ON w.user_id = u.id
             WHERE w.id = ?`,
            [withdrawalId]
        );

        if (!withdrawal) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }

        // Enrichment: deposit history count
        const depositStats = await db.get(
            "SELECT COUNT(*) as deposit_count, COALESCE(SUM(amount), 0) as total_deposited FROM deposits WHERE user_id = ? AND status = 'completed'",
            [withdrawal.user_id]
        );

        // Enrichment: total wagered
        const wagerStats = await db.get(
            'SELECT COALESCE(SUM(bet_amount), 0) as total_wagered, COUNT(*) as total_spins FROM spins WHERE user_id = ?',
            [withdrawal.user_id]
        );

        // Enrichment: account age in days
        const accountAgeDays = withdrawal.account_created_at
            ? Math.floor((Date.now() - new Date(withdrawal.account_created_at).getTime()) / 86400000)
            : 0;

        res.json({
            withdrawal: {
                ...withdrawal,
                depositCount: depositStats ? depositStats.deposit_count : 0,
                totalDeposited: depositStats ? depositStats.total_deposited : 0,
                totalWagered: wagerStats ? wagerStats.total_wagered : 0,
                totalSpins: wagerStats ? wagerStats.total_spins : 0,
                accountAgeDays
            }
        });
    } catch (err) {
        console.warn('[Admin] Get withdrawal detail error:', err.message);
        res.status(500).json({ error: 'Failed to load withdrawal details' });
    }
});

// POST /api/admin/withdrawals/:id/approve — Approve a pending withdrawal
// Accepts { admin_note } or { adminNotes } for compatibility with multiple UI clients.
// High-value withdrawals (≥ WITHDRAWAL_OTP_THRESHOLD) must have reached 'otp_verified'
// before approve — admins cannot bypass the email-OTP consent step.
router.post('/withdrawals/:id/approve', async (req, res) => {
    try {
        const withdrawalId = req.params.id;
        const noteRaw = req.body.admin_note || req.body.adminNotes || '';
        const admin_note = String(noteRaw || 'Approved by admin').slice(0, 500);
        const config = require('../config');

        // Precondition check: high-value withdrawals require OTP verification first
        const wd = await db.get('SELECT amount, status FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (!wd) return res.status(404).json({ error: 'Withdrawal not found' });

        const OTP_THRESHOLD = config.WITHDRAWAL_OTP_THRESHOLD || 500;
        if (wd.amount >= OTP_THRESHOLD && wd.status === 'pending') {
            return res.status(400).json({
                error: 'Withdrawal requires user email-OTP verification before admin approval.',
                otpRequired: true,
                currentStatus: wd.status,
            });
        }

        // Atomic claim: transition from pending OR otp_verified → completed.
        // Two admins cannot both approve the same withdrawal.
        const claim = await db.run(
            "UPDATE withdrawals SET status = 'completed', admin_note = ?, processed_at = datetime('now') WHERE id = ? AND status IN ('pending', 'otp_verified')",
            [admin_note, withdrawalId]
        );
        if (!claim || claim.changes === 0) {
            return res.status(409).json({ error: 'Withdrawal is not approvable (may have been processed by another admin).' });
        }

        // Read the now-claimed row for the response + audit log
        const withdrawal = await db.get('SELECT id, user_id, amount FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (withdrawal) {
            const user = await db.get('SELECT balance FROM users WHERE id = ?', [withdrawal.user_id]);
            const currentBalance = user ? user.balance : 0;
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [withdrawal.user_id, 'withdrawal_approved', withdrawal.amount, currentBalance, currentBalance, `WD-APPROVE-${withdrawalId}`]
            );
        }

        res.json({
            message: 'Withdrawal approved and ready for payout',
            withdrawalId: parseInt(withdrawalId),
            amount: withdrawal ? withdrawal.amount : null,
            admin_note
        });
    } catch (err) {
        console.warn('[Admin] Approve withdrawal error:', err.message);
        res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
});

// POST /api/admin/withdrawals/:id/reject — Reject a pending withdrawal and refund balance
// Same atomic-claim pattern as /approve. The claim MUST succeed before the
// refund UPDATE runs, otherwise a concurrent admin rejection could refund twice.
// admin_note / adminNotes both accepted for UI compatibility.
router.post('/withdrawals/:id/reject', async (req, res) => {
    try {
        const withdrawalId = req.params.id;
        const noteRaw = req.body.admin_note || req.body.adminNotes || '';
        const admin_note = String(noteRaw || '').trim();

        if (!admin_note || admin_note.length < 5) {
            return res.status(400).json({ error: 'A rejection reason of at least 5 characters is required.' });
        }

        // Step 1: Atomic claim — only one admin can transition to rejected.
        // Accepts both 'pending' (pre-OTP) and 'otp_verified' (post-OTP).
        // If changes === 0, someone else already processed it; do NOT refund.
        const claim = await db.run(
            "UPDATE withdrawals SET status = 'rejected', admin_note = ?, processed_at = datetime('now') WHERE id = ? AND status IN ('pending', 'otp_verified')",
            [admin_note.slice(0, 500), withdrawalId]
        );
        if (!claim || claim.changes === 0) {
            return res.status(409).json({ error: 'Withdrawal is not pending (may have been processed by another admin).' });
        }

        // Step 2: Safe to refund — the claim above guarantees single-processing.
        const withdrawal = await db.get('SELECT id, user_id, amount FROM withdrawals WHERE id = ?', [withdrawalId]);
        if (!withdrawal) {
            // Shouldn't happen after a successful claim, but be defensive
            return res.status(404).json({ error: 'Withdrawal not found after claim' });
        }

        const userBefore = await db.get('SELECT balance FROM users WHERE id = ?', [withdrawal.user_id]);
        const balanceBefore = (userBefore && userBefore.balance) || 0;

        // Atomic balance credit
        await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [withdrawal.amount, withdrawal.user_id]);
        const balanceAfter = balanceBefore + withdrawal.amount;

        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [withdrawal.user_id, 'withdrawal_refund', withdrawal.amount, balanceBefore, balanceAfter, `WD-REJECT-${withdrawalId}`]
        );

        res.json({
            message: 'Withdrawal rejected and amount refunded to user balance',
            withdrawalId: parseInt(withdrawalId),
            amount: withdrawal.amount,
            refundedTo: withdrawal.user_id,
            newBalance: balanceAfter,
            admin_note
        });
    } catch (err) {
        console.warn('[Admin] Reject withdrawal error:', err.message);
        res.status(500).json({ error: 'Failed to reject withdrawal' });
    }
});

// NOTE: /reject is the canonical endpoint. The admin UI calls /reject directly.
// (An earlier iteration had a /deny alias here — removed to keep one code path
// handling money.)

// ═══════════════════════════════════════════════════
//  USER ACCOUNT FREEZE
// ═══════════════════════════════════════════════════

// POST /api/admin/users/:id/freeze — Freeze or unfreeze a user account
// Frozen users (is_banned = 1) cannot spin or withdraw
router.post('/users/:id/freeze', async (req, res) => {
    try {
        // ROUND 61: parseInt — was passing raw string to DB queries
        const userId = parseInt(req.params.id);
        if (!Number.isFinite(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        const { freeze, reason } = req.body;

        if (typeof freeze !== 'boolean') {
            return res.status(400).json({ error: 'freeze (boolean) is required — true to freeze, false to unfreeze' });
        }

        const user = await db.get('SELECT id, username, is_banned, is_admin FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.is_admin) {
            return res.status(400).json({ error: 'Cannot freeze an admin account' });
        }

        const newBannedState = freeze ? 1 : 0;

        // Update the is_banned flag (used as the freeze mechanism)
        await db.run('UPDATE users SET is_banned = ? WHERE id = ?', [newBannedState, userId]);

        // Upsert user_limits with admin note for audit trail
        const existingLimits = await db.get('SELECT user_id FROM user_limits WHERE user_id = ?', [userId]);
        if (existingLimits) {
            await db.run(
                "UPDATE user_limits SET updated_at = datetime('now') WHERE user_id = ?",
                [userId]
            );
        } else {
            await db.run(
                "INSERT INTO user_limits (user_id, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))",
                [userId]
            );
        }

        // Log the freeze/unfreeze action as a transaction for audit
        const userBalance = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        const bal = userBalance ? userBalance.balance : 0;
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, freeze ? 'account_frozen' : 'account_unfrozen', 0, bal, bal, reason || (freeze ? 'Frozen by admin' : 'Unfrozen by admin')]
        );

        res.json({
            message: freeze ? 'User account frozen' : 'User account unfrozen',
            userId: parseInt(userId),
            username: user.username,
            frozen: freeze,
            reason: reason || null
        });
    } catch (err) {
        console.warn('[Admin] Freeze user error:', err.message);
        res.status(500).json({ error: 'Failed to freeze/unfreeze user' });
    }
});

// ═══════════════════════════════════════════════════
//  CONVERSION & SEGMENTATION ANALYTICS
// ═══════════════════════════════════════════════════

// GET /api/admin/conversion-funnel — Shows signup → first spin → first deposit → repeat deposit conversion
router.get('/conversion-funnel', async (req, res) => {
    try {
        const totalUsers = await db.get("SELECT COUNT(*) as count FROM users");
        const usersWithSpins = await db.get("SELECT COUNT(DISTINCT user_id) as count FROM spins");
        const usersWithDeposits = await db.get("SELECT COUNT(DISTINCT user_id) as count FROM deposits WHERE status='completed'");
        const repeatDepositors = await db.get(
            "SELECT COUNT(*) as count FROM (SELECT user_id FROM deposits WHERE status='completed' GROUP BY user_id HAVING COUNT(*) >= 2) sub"
        );
        const avgFirstDepositDays = await db.get(
            "SELECT ROUND(AVG(julianday(d.created_at) - julianday(u.created_at)),1) as avg_days " +
            "FROM (SELECT user_id, MIN(created_at) as created_at FROM deposits WHERE status='completed' GROUP BY user_id) d " +
            "JOIN users u ON u.id = d.user_id"
        );
        res.json({
            totalSignups: totalUsers?.count || 0,
            firstSpin: usersWithSpins?.count || 0,
            firstDeposit: usersWithDeposits?.count || 0,
            repeatDeposit: repeatDepositors?.count || 0,
            avgDaysToFirstDeposit: avgFirstDepositDays?.avg_days || null
        });
    } catch (e) {
        console.warn('[Admin] Conversion funnel error:', e.message);
        res.status(500).json({ error: 'Failed to load conversion data' });
    }
});

// GET /api/admin/player-segments — Player segmentation (whale/regular/casual/dormant)
router.get('/player-segments', async (req, res) => {
    try {
        const whales = await db.get(
            "SELECT COUNT(DISTINCT user_id) as count FROM spins " +
            "GROUP BY user_id HAVING SUM(bet_amount) > 10000"
        );
        // Actually need a different approach for counting segments
        const segments = await db.all(
            "SELECT CASE " +
            "  WHEN total_wagered >= 10000 THEN 'whale' " +
            "  WHEN total_wagered >= 1000 THEN 'regular' " +
            "  WHEN total_wagered >= 100 THEN 'casual' " +
            "  ELSE 'new' END as segment, " +
            "COUNT(*) as player_count, " +
            "ROUND(SUM(total_wagered),2) as total_wagered, " +
            "ROUND(SUM(total_wagered - total_paid),2) as total_profit " +
            "FROM (SELECT user_id, SUM(bet_amount) as total_wagered, SUM(win_amount) as total_paid FROM spins GROUP BY user_id) sub " +
            "GROUP BY segment ORDER BY total_wagered DESC"
        );
        const dormant = await db.get(
            "SELECT COUNT(*) as count FROM users u " +
            "WHERE u.id NOT IN (SELECT DISTINCT user_id FROM spins WHERE created_at >= datetime('now','-7 days')) " +
            "AND u.id IN (SELECT DISTINCT user_id FROM spins)"
        );
        res.json({ segments: segments || [], dormantPlayers: dormant?.count || 0 });
    } catch (e) {
        console.warn('[Admin] Player segments error:', e.message);
        res.status(500).json({ error: 'Failed to load segment data' });
    }
});

// GET /api/admin/game-profitability — Per-game profitability ranking
router.get('/game-profitability', async (req, res) => {
    try {
        const games = await db.all(
            "SELECT game_id, COUNT(*) as total_spins, COUNT(DISTINCT user_id) as unique_players, " +
            "ROUND(SUM(bet_amount),2) as total_wagered, ROUND(SUM(win_amount),2) as total_paid, " +
            "ROUND(SUM(bet_amount)-SUM(win_amount),2) as profit, " +
            "ROUND(100.0*SUM(win_amount)/NULLIF(SUM(bet_amount),0),2) as actual_rtp, " +
            "ROUND(AVG(bet_amount),2) as avg_bet " +
            "FROM spins GROUP BY game_id ORDER BY profit DESC"
        );
        res.json({ games: games || [] });
    } catch (e) {
        console.warn('[Admin] Game profitability error:', e.message);
        res.status(500).json({ error: 'Failed to load game data' });
    }
});

// GET /api/admin/nft-ledger — NFT ledger overview (deposits framed as NFT sales)
router.get('/nft-ledger', async (req, res) => {
    try {
        const summary = await db.get(
            "SELECT COUNT(*) as total_nfts, " +
            "SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) as sales, " +
            "SUM(CASE WHEN type='resale' THEN 1 ELSE 0 END) as resales, " +
            "ROUND(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),2) as total_sale_volume, " +
            "ROUND(SUM(CASE WHEN type='resale' THEN amount ELSE 0 END),2) as total_resale_volume " +
            "FROM nft_ledger"
        );
        const recent = await db.all(
            "SELECT n.token_id, n.type, n.amount, n.currency, n.created_at, u.username " +
            "FROM nft_ledger n JOIN users u ON u.id = n.user_id " +
            "ORDER BY n.created_at DESC LIMIT 20"
        );
        res.json({ summary: summary || {}, recent: recent || [] });
    } catch (e) {
        console.warn('[Admin] NFT ledger error:', e.message);
        res.status(500).json({ error: 'Failed to load NFT data' });
    }
});

// GET /api/admin/hourly-activity — Hourly activity heatmap (best times for promotions)
router.get('/hourly-activity', async (req, res) => {
    try {
        const hourly = await db.all(
            "SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, " +
            "COUNT(*) as spins, COUNT(DISTINCT user_id) as players, " +
            "ROUND(SUM(bet_amount),2) as wagered, ROUND(SUM(bet_amount)-SUM(win_amount),2) as profit " +
            "FROM spins WHERE created_at >= datetime('now','-7 days') " +
            "GROUP BY hour ORDER BY hour"
        );
        res.json({ hourly: hourly || [] });
    } catch (e) {
        console.warn('[Admin] Hourly activity error:', e.message);
        res.status(500).json({ error: 'Failed to load hourly data' });
    }
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN UI BACKING ENDPOINTS — search + dashboard KPIs
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/users/search?q=<query> — look up a user by id, username, or email
router.get('/users/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Query must be at least 2 characters' });
        }
        if (q.length > 64) {
            return res.status(400).json({ error: 'Query too long' });
        }

        const isNumericId = /^\d+$/.test(q);
        const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';

        let users;
        if (isNumericId) {
            users = await db.all(
                `SELECT id, username, email, balance, bonus_balance, wagering_requirement,
                        wagering_progress, email_verified, kyc_status, is_banned, is_admin,
                        created_at, last_login
                 FROM users
                 WHERE id = ? OR username LIKE ? OR email LIKE ?
                 ORDER BY id DESC
                 LIMIT 25`,
                [parseInt(q, 10), like, like]
            );
        } else {
            users = await db.all(
                `SELECT id, username, email, balance, bonus_balance, wagering_requirement,
                        wagering_progress, email_verified, kyc_status, is_banned, is_admin,
                        created_at, last_login
                 FROM users
                 WHERE username LIKE ? OR email LIKE ?
                 ORDER BY id DESC
                 LIMIT 25`,
                [like, like]
            );
        }

        res.json({ users: users || [] });
    } catch (err) {
        console.warn('[Admin] User search error:', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

// ═══════════════════════════════════════════════════════════════════════
//  AML (Anti-Money-Laundering) EVENT REVIEW
// ═══════════════════════════════════════════════════════════════════════

// GET /api/admin/aml-events?reviewed=false — list unreviewed AML events
router.get('/aml-events', async (req, res) => {
    try {
        const aml = require('../services/aml.service');
        const reviewedFilter = req.query.reviewed;
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

        let rows;
        if (reviewedFilter === 'true') {
            rows = await db.all(
                `SELECT e.*, u.username, u.email
                 FROM aml_events e
                 LEFT JOIN users u ON e.user_id = u.id
                 WHERE e.reviewed = 1
                 ORDER BY e.created_at DESC LIMIT ?`,
                [limit]
            ).catch(() => []);
        } else {
            rows = await aml.getUnreviewedEvents(limit);
        }

        res.json({ events: rows || [], thresholds: {
            large: aml.LARGE_TX_THRESHOLD,
            dailyAggregate: aml.DAILY_AGG_THRESHOLD,
            structuringFloor: aml.STRUCTURING_FLOOR,
            rapidTurnaroundMin: aml.RAPID_TURNAROUND_MIN,
        }});
    } catch (err) {
        console.warn('[Admin] AML list error:', err.message);
        res.status(500).json({ error: 'Failed to load AML events' });
    }
});

// POST /api/admin/aml-events/:id/review — mark an AML event as reviewed
router.post('/aml-events/:id/review', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const notes = req.body.notes ? String(req.body.notes).slice(0, 2000) : null;
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid event id' });
        }
        const aml = require('../services/aml.service');
        await aml.markReviewed(id, req.user.id, notes);
        res.json({ ok: true, id, reviewerId: req.user.id });
    } catch (err) {
        console.warn('[Admin] AML review error:', err.message);
        res.status(500).json({ error: 'Failed to mark event reviewed' });
    }
});

// GET /api/admin/stats/24h — rolling 24-hour KPIs for the admin dashboard
router.get('/stats/24h', async (req, res) => {
    try {
        const [deposits, active, withdrawals, registrations] = await Promise.all([
            db.get(
                "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM deposits WHERE status = 'completed' AND created_at >= datetime('now', '-24 hours')"
            ).catch(() => ({ total: 0, count: 0 })),
            db.get(
                "SELECT COUNT(DISTINCT user_id) as count FROM spins WHERE created_at >= datetime('now', '-24 hours')"
            ).catch(() => ({ count: 0 })),
            db.get(
                "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM withdrawals WHERE created_at >= datetime('now', '-24 hours')"
            ).catch(() => ({ total: 0, count: 0 })),
            db.get(
                "SELECT COUNT(*) as count FROM users WHERE created_at >= datetime('now', '-24 hours')"
            ).catch(() => ({ count: 0 })),
        ]);

        res.json({
            deposits_24h:      Number((deposits && deposits.total) || 0),
            deposit_count_24h: Number((deposits && deposits.count) || 0),
            withdrawals_24h:   Number((withdrawals && withdrawals.total) || 0),
            withdrawal_count_24h: Number((withdrawals && withdrawals.count) || 0),
            active_users_24h:  Number((active && active.count) || 0),
            new_users_24h:     Number((registrations && registrations.count) || 0),
        });
    } catch (err) {
        console.warn('[Admin] 24h stats error:', err.message);
        res.status(500).json({ error: 'Stats query failed' });
    }
});

module.exports = router;
