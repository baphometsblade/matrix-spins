'use strict';

/**
 * Loss Limits Routes — Weekly/monthly net loss caps + per-spin max bet.
 *
 * Daily loss limit lives in user_limits.daily_loss_limit (already enforced in
 * server/services/loss-limit.service.js). This route extends to weekly &
 * monthly windows plus the new per-spin max bet (max_bet_per_spin column).
 *
 * Cooling-off rule (per CLAUDE.md compliance pattern):
 *   - Lowering a limit is INSTANT
 *   - Raising a limit requires a 24-hour cooling-off period
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

let schemaReady = false;

async function ensureSchema() {
    if (schemaReady) return;
    // Add weekly/monthly + per-spin columns to user_limits if missing.
    // ALTER TABLE ADD COLUMN errors are swallowed if the column already exists.
    const isPg = db.isPg();
    const numType = isPg ? 'NUMERIC(15,2)' : 'REAL';
    const intType = 'INTEGER';
    const altCols = [
        'ALTER TABLE user_limits ADD COLUMN weekly_loss_limit ' + numType,
        'ALTER TABLE user_limits ADD COLUMN monthly_loss_limit ' + numType,
        'ALTER TABLE user_limits ADD COLUMN max_bet_per_spin ' + numType,
        'ALTER TABLE user_limits ADD COLUMN reality_check_interval ' + intType,
        // Pending fields for 24h cooling-off on increases
        'ALTER TABLE user_limits ADD COLUMN pending_daily_loss ' + numType,
        'ALTER TABLE user_limits ADD COLUMN pending_daily_loss_at TEXT',
        'ALTER TABLE user_limits ADD COLUMN pending_weekly_loss ' + numType,
        'ALTER TABLE user_limits ADD COLUMN pending_weekly_loss_at TEXT',
        'ALTER TABLE user_limits ADD COLUMN pending_monthly_loss ' + numType,
        'ALTER TABLE user_limits ADD COLUMN pending_monthly_loss_at TEXT',
        'ALTER TABLE user_limits ADD COLUMN pending_max_bet ' + numType,
        'ALTER TABLE user_limits ADD COLUMN pending_max_bet_at TEXT'
    ];
    for (const sql of altCols) {
        try { await db.run(sql); }
        catch (err) {
            if (err.message && !/already exists|duplicate column|duplicate key/i.test(err.message)) {
                console.warn('[LossLimits] migration warn:', err.message);
            }
        }
    }
    schemaReady = true;
}

ensureSchema();

async function ensureRow(userId) {
    const existing = await db.get('SELECT user_id FROM user_limits WHERE user_id = ?', [userId]);
    if (!existing) {
        try {
            await db.run('INSERT INTO user_limits (user_id) VALUES (?)', [userId]);
        } catch (e) {
            // Race-condition safe: another concurrent request may have inserted
            if (!/UNIQUE|duplicate/i.test(e.message)) throw e;
        }
    }
}

/**
 * Compute net loss (wagered - won) over a date range from spins table.
 */
async function computeNetLoss(userId, sinceIso) {
    try {
        const row = await db.get(
            "SELECT COALESCE(SUM(bet_amount), 0) as wagered, COALESCE(SUM(win_amount), 0) as won " +
            "FROM spins WHERE user_id = ? AND created_at >= ?",
            [userId, sinceIso]
        );
        const wagered = Number(row?.wagered || 0);
        const won = Number(row?.won || 0);
        return Math.max(0, wagered - won);
    } catch (e) {
        console.warn('[LossLimits] computeNetLoss error:', e.message);
        return 0;
    }
}

function startOfTodayIso() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}
function startOfWeekIso() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}
function startOfMonthIso() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * GET /api/loss-limits
 * Returns current loss limits + usage windows + max bet + reality-check interval.
 */
router.get('/', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const userId = req.user.id;
        await ensureRow(userId);

        const row = await db.get(
            'SELECT daily_loss_limit, weekly_loss_limit, monthly_loss_limit, max_bet_per_spin, reality_check_interval, ' +
            'pending_daily_loss, pending_daily_loss_at, pending_weekly_loss, pending_weekly_loss_at, ' +
            'pending_monthly_loss, pending_monthly_loss_at, pending_max_bet, pending_max_bet_at ' +
            'FROM user_limits WHERE user_id = ?',
            [userId]
        );

        const dailyLoss = await computeNetLoss(userId, startOfTodayIso());
        const weeklyLoss = await computeNetLoss(userId, startOfWeekIso());
        const monthlyLoss = await computeNetLoss(userId, startOfMonthIso());

        const pending = [];
        const fields = [
            ['daily', 'pending_daily_loss', 'pending_daily_loss_at'],
            ['weekly', 'pending_weekly_loss', 'pending_weekly_loss_at'],
            ['monthly', 'pending_monthly_loss', 'pending_monthly_loss_at'],
            ['max_bet', 'pending_max_bet', 'pending_max_bet_at']
        ];
        if (row) {
            for (const [type, valCol, atCol] of fields) {
                if (row[valCol] !== null && row[valCol] !== undefined && row[atCol]) {
                    pending.push({ type, newLimit: row[valCol], effectiveAt: row[atCol] });
                }
            }
        }

        res.json({
            dailyLossLimit: row?.daily_loss_limit ?? null,
            weeklyLossLimit: row?.weekly_loss_limit ?? null,
            monthlyLossLimit: row?.monthly_loss_limit ?? null,
            maxBetPerSpin: row?.max_bet_per_spin ?? null,
            realityCheckInterval: row?.reality_check_interval ?? 60,
            dailyLossUsed: Number(dailyLoss.toFixed(2)),
            weeklyLossUsed: Number(weeklyLoss.toFixed(2)),
            monthlyLossUsed: Number(monthlyLoss.toFixed(2)),
            pendingIncreases: pending
        });
    } catch (err) {
        console.warn('[LossLimits] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to load loss limits' });
    }
});

/**
 * POST /api/loss-limits/set
 * Set loss limits + per-spin max bet + reality-check interval.
 *
 * Body (all optional):
 *   { dailyLossLimit, weeklyLossLimit, monthlyLossLimit,
 *     maxBetPerSpin, realityCheckInterval }
 *
 * Lowering: instant. Raising: 24-hour cooling-off.
 */
router.post('/set', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const userId = req.user.id;
        await ensureRow(userId);

        const {
            dailyLossLimit, weeklyLossLimit, monthlyLossLimit,
            maxBetPerSpin, realityCheckInterval
        } = req.body;

        const validate = (v, name, max) => {
            if (v === undefined || v === null) return v;
            if (!Number.isFinite(v) || v < 0 || v > max) {
                throw new Error(name + ' must be a number between 0 and ' + max);
            }
            return v;
        };

        try {
            validate(dailyLossLimit, 'dailyLossLimit', 100000);
            validate(weeklyLossLimit, 'weeklyLossLimit', 500000);
            validate(monthlyLossLimit, 'monthlyLossLimit', 2000000);
            validate(maxBetPerSpin, 'maxBetPerSpin', 500);
        } catch (vErr) {
            return res.status(400).json({ error: vErr.message });
        }

        if (realityCheckInterval !== undefined && realityCheckInterval !== null) {
            if (![30, 60, 120].includes(parseInt(realityCheckInterval, 10))) {
                return res.status(400).json({ error: 'realityCheckInterval must be 30, 60, or 120 minutes' });
            }
        }

        const current = await db.get(
            'SELECT daily_loss_limit, weekly_loss_limit, monthly_loss_limit, max_bet_per_spin FROM user_limits WHERE user_id = ?',
            [userId]
        );

        const updates = [];
        const params = [];
        const pendingIncreases = [];
        const now = new Date();
        const effectiveAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 19).replace('T', ' ');

        const tryApply = (newVal, currentVal, immediateCol, pendingCol, pendingAtCol, label) => {
            if (newVal === undefined) return;
            if (newVal === null || currentVal === null || currentVal === undefined || newVal <= currentVal) {
                // Immediate (lowering or first-time)
                updates.push(immediateCol + ' = ?'); params.push(newVal);
                updates.push(pendingCol + ' = NULL');
                updates.push(pendingAtCol + ' = NULL');
            } else {
                // Increase — schedule pending
                updates.push(pendingCol + ' = ?'); params.push(newVal);
                updates.push(pendingAtCol + ' = ?'); params.push(effectiveAt);
                pendingIncreases.push({ type: label, newLimit: newVal, effectiveAt });
            }
        };

        tryApply(dailyLossLimit, current?.daily_loss_limit, 'daily_loss_limit', 'pending_daily_loss', 'pending_daily_loss_at', 'daily');
        tryApply(weeklyLossLimit, current?.weekly_loss_limit, 'weekly_loss_limit', 'pending_weekly_loss', 'pending_weekly_loss_at', 'weekly');
        tryApply(monthlyLossLimit, current?.monthly_loss_limit, 'monthly_loss_limit', 'pending_monthly_loss', 'pending_monthly_loss_at', 'monthly');
        tryApply(maxBetPerSpin, current?.max_bet_per_spin, 'max_bet_per_spin', 'pending_max_bet', 'pending_max_bet_at', 'max_bet');

        if (realityCheckInterval !== undefined && realityCheckInterval !== null) {
            updates.push('reality_check_interval = ?');
            params.push(parseInt(realityCheckInterval, 10));
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push("updated_at = datetime('now')");
        params.push(userId);

        await db.run(
            'UPDATE user_limits SET ' + updates.join(', ') + ' WHERE user_id = ?',
            params
        );

        // Audit trail
        try {
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, 0, 0, 0, ?)",
                [userId, 'rg_limit_change', JSON.stringify({
                    dailyLossLimit, weeklyLossLimit, monthlyLossLimit,
                    maxBetPerSpin, realityCheckInterval, pendingIncreases
                }).slice(0, 500)]
            );
        } catch (_) { /* audit non-fatal */ }

        res.json({
            success: true,
            message: pendingIncreases.length
                ? 'Limits updated. Increases will take effect after a 24-hour cooling-off period.'
                : 'Limits updated successfully.',
            pendingIncreases
        });
    } catch (err) {
        console.warn('[LossLimits] /set error:', err.message);
        res.status(500).json({ error: 'Failed to update loss limits' });
    }
});

/**
 * POST /api/loss-limits/cancel-pending
 * Cancel a pending limit increase (always allowed since it makes the user safer).
 *
 * Body: { type: 'daily'|'weekly'|'monthly'|'max_bet' }
 */
router.post('/cancel-pending', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const userId = req.user.id;
        const { type } = req.body;

        const map = {
            daily: ['pending_daily_loss', 'pending_daily_loss_at'],
            weekly: ['pending_weekly_loss', 'pending_weekly_loss_at'],
            monthly: ['pending_monthly_loss', 'pending_monthly_loss_at'],
            max_bet: ['pending_max_bet', 'pending_max_bet_at']
        };

        if (!map[type]) {
            return res.status(400).json({ error: 'Invalid type' });
        }

        const [valCol, atCol] = map[type];
        await db.run(
            'UPDATE user_limits SET ' + valCol + ' = NULL, ' + atCol + ' = NULL WHERE user_id = ?',
            [userId]
        );

        res.json({ success: true, message: 'Pending increase cancelled.' });
    } catch (err) {
        console.warn('[LossLimits] /cancel-pending error:', err.message);
        res.status(500).json({ error: 'Failed to cancel pending limit' });
    }
});

/**
 * GET /api/loss-limits/check
 * Pre-bet sanity check: { allowed, reason }
 *
 * Query: ?bet=<amount>
 */
router.get('/check', authenticate, async (req, res) => {
    try {
        await ensureSchema();
        const userId = req.user.id;
        const bet = parseFloat(req.query.bet);

        if (!Number.isFinite(bet) || bet < 0) {
            return res.status(400).json({ error: 'Invalid bet amount' });
        }

        await ensureRow(userId);

        const row = await db.get(
            'SELECT daily_loss_limit, weekly_loss_limit, monthly_loss_limit, max_bet_per_spin, ' +
            'pending_daily_loss, pending_daily_loss_at, pending_weekly_loss, pending_weekly_loss_at, ' +
            'pending_monthly_loss, pending_monthly_loss_at, pending_max_bet, pending_max_bet_at ' +
            'FROM user_limits WHERE user_id = ?',
            [userId]
        );

        if (!row) return res.json({ allowed: true });

        const now = new Date();
        const effectiveLimit = (current, pending, pendingAt) => {
            if (pending !== null && pending !== undefined && pendingAt && new Date(pendingAt) <= now) {
                return pending;
            }
            return current;
        };

        // Per-spin max bet
        const maxBet = effectiveLimit(row.max_bet_per_spin, row.pending_max_bet, row.pending_max_bet_at);
        if (maxBet !== null && maxBet !== undefined && bet > maxBet) {
            return res.json({
                allowed: false,
                reason: 'max_bet_per_spin',
                message: 'Your max bet per spin is $' + Number(maxBet).toFixed(2) + '.',
                limit: maxBet
            });
        }

        // Loss limits — bet itself doesn't necessarily increase loss but worst case it adds bet
        const checks = [
            ['daily',   effectiveLimit(row.daily_loss_limit,   row.pending_daily_loss,   row.pending_daily_loss_at),   startOfTodayIso()],
            ['weekly',  effectiveLimit(row.weekly_loss_limit,  row.pending_weekly_loss,  row.pending_weekly_loss_at),  startOfWeekIso()],
            ['monthly', effectiveLimit(row.monthly_loss_limit, row.pending_monthly_loss, row.pending_monthly_loss_at), startOfMonthIso()]
        ];

        for (const [period, limit, since] of checks) {
            if (limit === null || limit === undefined) continue;
            const used = await computeNetLoss(userId, since);
            if (used + bet > limit) {
                return res.json({
                    allowed: false,
                    reason: period + '_loss_limit',
                    message: 'Your ' + period + ' loss limit of $' + Number(limit).toFixed(2) +
                             ' would be exceeded. Current ' + period + ' loss: $' + used.toFixed(2) + '.',
                    limit: Number(limit),
                    used: Number(used.toFixed(2))
                });
            }
        }

        res.json({ allowed: true });
    } catch (err) {
        console.warn('[LossLimits] /check error:', err.message);
        // Fail open — never block play on infrastructure errors
        res.json({ allowed: true });
    }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
