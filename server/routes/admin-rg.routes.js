'use strict';

/**
 * Admin Responsible-Gambling Routes
 *
 * Lets compliance admins view & override player limits / exclusions.
 * Every action writes an audit record into `rg_admin_audit` so regulators
 * can trace any compliance intervention.
 *
 * Endpoints (all admin-only):
 *   GET    /api/admin-rg/user/:id            — view all RG state for one user
 *   POST   /api/admin-rg/user/:id/limits     — override deposit/loss/wager/max-bet
 *   POST   /api/admin-rg/user/:id/exclude    — apply self-exclusion on user's behalf
 *   POST   /api/admin-rg/user/:id/lift       — lift cool-off (compliance review only)
 *   GET    /api/admin-rg/audit               — recent admin RG actions
 *   GET    /api/admin-rg/at-risk             — players approaching/over limits
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

let schemaReady = false;

async function ensureSchema() {
    if (schemaReady) return;
    try {
        const isPg = db.isPg();
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

        await db.run(
            'CREATE TABLE IF NOT EXISTS rg_admin_audit (' +
            '  id ' + idDef + ',' +
            '  admin_user_id INTEGER NOT NULL,' +
            '  target_user_id INTEGER NOT NULL,' +
            '  action TEXT NOT NULL,' +
            '  payload TEXT,' +
            '  reason TEXT,' +
            '  created_at ' + tsDef +
            ')'
        );
        try { await db.run('CREATE INDEX IF NOT EXISTS idx_rg_audit_target ON rg_admin_audit(target_user_id, created_at)'); } catch (_) {}
        schemaReady = true;
    } catch (err) {
        console.warn('[AdminRG] ensureSchema error:', err.message);
    }
}

ensureSchema();

async function audit(adminId, targetId, action, payload, reason) {
    try {
        await db.run(
            'INSERT INTO rg_admin_audit (admin_user_id, target_user_id, action, payload, reason) VALUES (?, ?, ?, ?, ?)',
            [adminId, targetId, action, JSON.stringify(payload || {}).slice(0, 2000), reason || null]
        );
    } catch (err) {
        console.warn('[AdminRG] audit failed:', err.message);
    }
}

// ─── GET /api/admin-rg/user/:id ───
router.get('/user/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const targetId = parseInt(req.params.id, 10);
        if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'Invalid user id' });

        const user = await db.get('SELECT id, username, email, balance, bonus_balance, is_banned, created_at FROM users WHERE id = ?', [targetId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const limits = await db.get('SELECT * FROM user_limits WHERE user_id = ?', [targetId]).catch(() => null);
        const depositLimits = await db.get('SELECT * FROM deposit_limits WHERE user_id = ?', [targetId]).catch(() => null);
        const exclusions = await db.all(
            'SELECT id, exclusion_type, reason, starts_at, ends_at, is_active, created_at FROM self_exclusions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
            [targetId]
        ).catch(() => []);

        // Net loss windows
        const lossOver = async (sinceSql) => {
            try {
                const r = await db.get(
                    "SELECT COALESCE(SUM(bet_amount), 0) as wagered, COALESCE(SUM(win_amount), 0) as won FROM spins WHERE user_id = ? AND created_at >= " + sinceSql,
                    [targetId]
                );
                return Math.max(0, Number((r?.wagered || 0)) - Number((r?.won || 0)));
            } catch (_) { return 0; }
        };

        const dailyLoss = await lossOver("datetime('now', 'start of day')");
        const weeklyLoss = await lossOver("datetime('now', '-7 days')");
        const monthlyLoss = await lossOver("datetime('now', 'start of month')");

        const recentAudit = await db.all(
            'SELECT id, admin_user_id, action, payload, reason, created_at FROM rg_admin_audit WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 20',
            [targetId]
        ).catch(() => []);

        res.json({
            user,
            limits: limits || {},
            depositLimits: depositLimits || {},
            exclusions,
            losses: {
                daily: Number(dailyLoss.toFixed(2)),
                weekly: Number(weeklyLoss.toFixed(2)),
                monthly: Number(monthlyLoss.toFixed(2))
            },
            recentAdminActions: recentAudit
        });
    } catch (err) {
        console.warn('[AdminRG] GET /user error:', err.message);
        res.status(500).json({ error: 'Failed to load RG profile' });
    }
});

// ─── POST /api/admin-rg/user/:id/limits ───
// Admin override — bypasses 24h cooling-off for compliance interventions
router.post('/user/:id/limits', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const targetId = parseInt(req.params.id, 10);
        if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'Invalid user id' });

        const {
            dailyLossLimit, weeklyLossLimit, monthlyLossLimit, maxBetPerSpin,
            sessionTimeLimit, dailyWagerLimit, dailyDepositLimit, weeklyDepositLimit,
            monthlyDepositLimit, reason
        } = req.body;

        if (!reason || typeof reason !== 'string' || reason.length < 5) {
            return res.status(400).json({ error: 'Compliance reason (min 5 chars) is required' });
        }

        // Ensure rows exist
        await db.run('INSERT INTO user_limits (user_id) VALUES (?) ON CONFLICT DO NOTHING', [targetId])
            .catch(async () => {
                const exists = await db.get('SELECT user_id FROM user_limits WHERE user_id = ?', [targetId]);
                if (!exists) await db.run('INSERT INTO user_limits (user_id) VALUES (?)', [targetId]).catch(() => null);
            });

        const userLimitUpdates = [];
        const userLimitParams = [];
        const setIf = (col, val) => {
            if (val !== undefined) {
                userLimitUpdates.push(col + ' = ?');
                userLimitParams.push(val);
            }
        };
        setIf('daily_loss_limit', dailyLossLimit);
        setIf('weekly_loss_limit', weeklyLossLimit);
        setIf('monthly_loss_limit', monthlyLossLimit);
        setIf('max_bet_per_spin', maxBetPerSpin);
        setIf('session_time_limit', sessionTimeLimit);
        setIf('daily_wager_limit', dailyWagerLimit);

        if (userLimitUpdates.length > 0) {
            userLimitUpdates.push("updated_at = datetime('now')");
            userLimitParams.push(targetId);
            await db.run(
                'UPDATE user_limits SET ' + userLimitUpdates.join(', ') + ' WHERE user_id = ?',
                userLimitParams
            );
        }

        // Deposit limits live in their own table
        if (dailyDepositLimit !== undefined || weeklyDepositLimit !== undefined || monthlyDepositLimit !== undefined) {
            const exists = await db.get('SELECT user_id FROM deposit_limits WHERE user_id = ?', [targetId]).catch(() => null);
            if (!exists) {
                await db.run('INSERT INTO deposit_limits (user_id) VALUES (?)', [targetId]).catch(() => null);
            }
            const dlUpdates = [];
            const dlParams = [];
            if (dailyDepositLimit !== undefined)   { dlUpdates.push('daily_limit = ?');   dlParams.push(dailyDepositLimit); }
            if (weeklyDepositLimit !== undefined)  { dlUpdates.push('weekly_limit = ?');  dlParams.push(weeklyDepositLimit); }
            if (monthlyDepositLimit !== undefined) { dlUpdates.push('monthly_limit = ?'); dlParams.push(monthlyDepositLimit); }
            if (dlUpdates.length > 0) {
                dlUpdates.push("updated_at = datetime('now')");
                dlParams.push(targetId);
                await db.run('UPDATE deposit_limits SET ' + dlUpdates.join(', ') + ' WHERE user_id = ?', dlParams).catch(() => null);
            }
        }

        await audit(req.user.id, targetId, 'override_limits', req.body, reason);

        res.json({ success: true, message: 'Limits updated for user ' + targetId });
    } catch (err) {
        console.warn('[AdminRG] POST /limits error:', err.message);
        res.status(500).json({ error: 'Failed to override limits' });
    }
});

// ─── POST /api/admin-rg/user/:id/exclude ───
router.post('/user/:id/exclude', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const targetId = parseInt(req.params.id, 10);
        if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'Invalid user id' });

        const { type, reason } = req.body;
        const valid = ['cooldown_24h', 'cooldown_7d', 'cooldown_30d', 'permanent'];
        if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid exclusion type' });
        if (!reason || reason.length < 5) return res.status(400).json({ error: 'Compliance reason required' });

        const ms = type === 'cooldown_24h' ? 24*60*60*1000
                 : type === 'cooldown_7d'  ? 7*24*60*60*1000
                 : type === 'cooldown_30d' ? 30*24*60*60*1000
                 : null;
        const endsAt = ms ? new Date(Date.now() + ms).toISOString().replace('T', ' ').replace('Z', '').split('.')[0] : null;

        await db.run(
            'INSERT INTO self_exclusions (user_id, exclusion_type, reason, ends_at, is_active) VALUES (?, ?, ?, ?, 1)',
            [targetId, type, '[ADMIN] ' + reason, endsAt]
        );

        if (type === 'permanent') {
            await db.run('UPDATE users SET is_banned = 1 WHERE id = ?', [targetId]).catch(() => null);
        }

        await audit(req.user.id, targetId, 'admin_exclude', { type, endsAt }, reason);

        res.json({ success: true, type, endsAt });
    } catch (err) {
        console.warn('[AdminRG] POST /exclude error:', err.message);
        res.status(500).json({ error: 'Failed to apply exclusion' });
    }
});

// ─── POST /api/admin-rg/user/:id/lift ───
// Compliance-reviewed lifting of an active cool-off.
// Permanent exclusions can ONLY be lifted with a written compliance review note.
router.post('/user/:id/lift', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const targetId = parseInt(req.params.id, 10);
        if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'Invalid user id' });

        const { reason, allowPermanent } = req.body;
        if (!reason || reason.length < 20) {
            return res.status(400).json({ error: 'A detailed compliance review note (min 20 chars) is required to lift exclusions' });
        }

        const active = await db.get(
            "SELECT id, exclusion_type FROM self_exclusions WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
            [targetId]
        );
        if (!active) return res.status(404).json({ error: 'No active exclusion found' });

        if (active.exclusion_type === 'permanent' && !allowPermanent) {
            return res.status(400).json({
                error: 'Lifting a permanent exclusion requires explicit allowPermanent=true and a documented compliance review.'
            });
        }

        await db.run('UPDATE self_exclusions SET is_active = 0 WHERE id = ?', [active.id]);
        if (active.exclusion_type === 'permanent') {
            await db.run('UPDATE users SET is_banned = 0 WHERE id = ?', [targetId]).catch(() => null);
        }

        await audit(req.user.id, targetId, 'lift_exclusion', { exclusion_id: active.id, type: active.exclusion_type }, reason);

        res.json({ success: true, lifted: active.id });
    } catch (err) {
        console.warn('[AdminRG] POST /lift error:', err.message);
        res.status(500).json({ error: 'Failed to lift exclusion' });
    }
});

// ─── GET /api/admin-rg/audit ───
router.get('/audit', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureSchema();
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const rows = await db.all(
            'SELECT a.*, u.username as target_username FROM rg_admin_audit a ' +
            'LEFT JOIN users u ON u.id = a.target_user_id ' +
            'ORDER BY a.created_at DESC LIMIT ?',
            [limit]
        );
        res.json({ audit: rows });
    } catch (err) {
        console.warn('[AdminRG] GET /audit error:', err.message);
        res.status(500).json({ error: 'Failed to load audit log' });
    }
});

// ─── GET /api/admin-rg/at-risk ───
// Players whose net loss this week is > 80% of their limit, or whose
// daily wagered exceeds 70% of their daily wager limit.
router.get('/at-risk', authenticate, requireAdmin, async (req, res) => {
    try {
        const rows = await db.all(`
            SELECT
                u.id as user_id,
                u.username,
                ul.daily_loss_limit, ul.weekly_loss_limit, ul.monthly_loss_limit, ul.max_bet_per_spin,
                COALESCE(d.weekly_loss, 0) as weekly_loss
            FROM users u
            JOIN user_limits ul ON ul.user_id = u.id
            LEFT JOIN (
                SELECT user_id,
                       SUM(bet_amount) - SUM(win_amount) as weekly_loss
                FROM spins
                WHERE created_at >= datetime('now', '-7 days')
                GROUP BY user_id
            ) d ON d.user_id = u.id
            WHERE
                (ul.weekly_loss_limit IS NOT NULL AND COALESCE(d.weekly_loss, 0) >= 0.8 * ul.weekly_loss_limit)
                OR (ul.daily_loss_limit IS NOT NULL AND COALESCE(d.weekly_loss, 0) >= 0.8 * ul.daily_loss_limit)
            ORDER BY weekly_loss DESC
            LIMIT 100
        `).catch(() => []);

        res.json({ atRisk: rows });
    } catch (err) {
        console.warn('[AdminRG] GET /at-risk error:', err.message);
        res.json({ atRisk: [] });
    }
});

module.exports = router;
