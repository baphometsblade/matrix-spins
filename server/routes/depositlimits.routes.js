/**
 * Deposit Limits API Routes
 *
 * Responsible gambling feature allowing users to set daily, weekly, or monthly
 * deposit limits. Limits can only be lowered immediately; raising a limit
 * requires a 24-hour cooling-off period.
 */

'use strict';

const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/deposit-limits/
 * Returns current limits and usage for the authenticated user.
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get current limits
        const limits = await db.get(
            `SELECT daily_limit, weekly_limit, monthly_limit,
                    pending_daily_limit, pending_daily_effective_at,
                    pending_weekly_limit, pending_weekly_effective_at,
                    pending_monthly_limit, pending_monthly_effective_at
             FROM deposit_limits WHERE user_id = ?`,
            [userId]
        );

        // Initialize limits object
        const response = {
            dailyLimit: null,
            weeklyLimit: null,
            monthlyLimit: null,
            dailyUsed: 0,
            weeklyUsed: 0,
            monthlyUsed: 0,
            pendingIncreases: []
        };

        if (limits) {
            response.dailyLimit = limits.daily_limit;
            response.weeklyLimit = limits.weekly_limit;
            response.monthlyLimit = limits.monthly_limit;

            // Track pending increases
            if (limits.pending_daily_limit && limits.pending_daily_effective_at) {
                response.pendingIncreases.push({
                    type: 'daily',
                    newLimit: limits.pending_daily_limit,
                    effectiveAt: limits.pending_daily_effective_at
                });
            }
            if (limits.pending_weekly_limit && limits.pending_weekly_effective_at) {
                response.pendingIncreases.push({
                    type: 'weekly',
                    newLimit: limits.pending_weekly_limit,
                    effectiveAt: limits.pending_weekly_effective_at
                });
            }
            if (limits.pending_monthly_limit && limits.pending_monthly_effective_at) {
                response.pendingIncreases.push({
                    type: 'monthly',
                    newLimit: limits.pending_monthly_limit,
                    effectiveAt: limits.pending_monthly_effective_at
                });
            }
        }

        // Query deposits for usage calculation
        // Daily: deposits from today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyDeposits = await db.all(
            `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
             WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
            [userId, today.toISOString().slice(0, 19).replace('T', ' ')]
        );
        response.dailyUsed = dailyDeposits[0]?.total || 0;

        // Weekly: deposits from last 7 days
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const weeklyDeposits = await db.all(
            `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
             WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
            [userId, weekAgo.toISOString().slice(0, 19).replace('T', ' ')]
        );
        response.weeklyUsed = weeklyDeposits[0]?.total || 0;

        // Monthly: deposits from start of current month
        const monthStart = new Date(today);
        monthStart.setDate(1);

        const monthlyDeposits = await db.all(
            `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
             WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
            [userId, monthStart.toISOString().slice(0, 19).replace('T', ' ')]
        );
        response.monthlyUsed = monthlyDeposits[0]?.total || 0;

        res.json(response);
    } catch (err) {
        console.warn('[DepositLimits] Get limits error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve deposit limits' });
    }
});

/**
 * POST /api/deposit-limits/set
 * Set or update deposit limits.
 *
 * Request body:
 * {
 *   dailyLimit?: number | null,
 *   weeklyLimit?: number | null,
 *   monthlyLimit?: number | null
 * }
 *
 * Limits can only be LOWERED immediately.
 * RAISING a limit requires a 24-hour cooling-off period.
 */
router.post('/set', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { dailyLimit, weeklyLimit, monthlyLimit } = req.body;

        // Validate input
        if (dailyLimit !== undefined && dailyLimit !== null && (!Number.isFinite(dailyLimit) || dailyLimit < 0)) {
            return res.status(400).json({ error: 'Daily limit must be a non-negative number or null' });
        }
        if (weeklyLimit !== undefined && weeklyLimit !== null && (!Number.isFinite(weeklyLimit) || weeklyLimit < 0)) {
            return res.status(400).json({ error: 'Weekly limit must be a non-negative number or null' });
        }
        if (monthlyLimit !== undefined && monthlyLimit !== null && (!Number.isFinite(monthlyLimit) || monthlyLimit < 0)) {
            return res.status(400).json({ error: 'Monthly limit must be a non-negative number or null' });
        }

        // Get current limits
        let currentLimits = await db.get(
            `SELECT daily_limit, weekly_limit, monthly_limit,
                    pending_daily_limit, pending_daily_effective_at,
                    pending_weekly_limit, pending_weekly_effective_at,
                    pending_monthly_limit, pending_monthly_effective_at
             FROM deposit_limits WHERE user_id = ?`,
            [userId]
        );

        // If no record exists, create one
        if (!currentLimits) {
            await db.run(
                `INSERT INTO deposit_limits (user_id, daily_limit, weekly_limit, monthly_limit)
                 VALUES (?, ?, ?, ?)`,
                [userId, dailyLimit !== undefined ? dailyLimit : null,
                         weeklyLimit !== undefined ? weeklyLimit : null,
                         monthlyLimit !== undefined ? monthlyLimit : null]
            );
            return res.json({ message: 'Deposit limits set successfully' });
        }

        // Process each limit change
        let updates = [];
        let pendingUpdates = [];
        const now = new Date();
        const effectiveAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h from now

        // Daily limit
        if (dailyLimit !== undefined) {
            const currentDaily = currentLimits.daily_limit;
            if (currentDaily === null || dailyLimit <= currentDaily) {
                // Immediate lowering or removal
                updates.push(['daily_limit', dailyLimit]);
                // Clear any pending increase
                pendingUpdates.push(['pending_daily_limit', null]);
                pendingUpdates.push(['pending_daily_effective_at', null]);
            } else {
                // Increase requires 24h cooling-off
                pendingUpdates.push(['pending_daily_limit', dailyLimit]);
                pendingUpdates.push(['pending_daily_effective_at', effectiveAt.toISOString().slice(0, 19).replace('T', ' ')]);
            }
        }

        // Weekly limit
        if (weeklyLimit !== undefined) {
            const currentWeekly = currentLimits.weekly_limit;
            if (currentWeekly === null || weeklyLimit <= currentWeekly) {
                // Immediate lowering or removal
                updates.push(['weekly_limit', weeklyLimit]);
                // Clear any pending increase
                pendingUpdates.push(['pending_weekly_limit', null]);
                pendingUpdates.push(['pending_weekly_effective_at', null]);
            } else {
                // Increase requires 24h cooling-off
                pendingUpdates.push(['pending_weekly_limit', weeklyLimit]);
                pendingUpdates.push(['pending_weekly_effective_at', effectiveAt.toISOString().slice(0, 19).replace('T', ' ')]);
            }
        }

        // Monthly limit
        if (monthlyLimit !== undefined) {
            const currentMonthly = currentLimits.monthly_limit;
            if (currentMonthly === null || monthlyLimit <= currentMonthly) {
                // Immediate lowering or removal
                updates.push(['monthly_limit', monthlyLimit]);
                // Clear any pending increase
                pendingUpdates.push(['pending_monthly_limit', null]);
                pendingUpdates.push(['pending_monthly_effective_at', null]);
            } else {
                // Increase requires 24h cooling-off
                pendingUpdates.push(['pending_monthly_limit', monthlyLimit]);
                pendingUpdates.push(['pending_monthly_effective_at', effectiveAt.toISOString().slice(0, 19).replace('T', ' ')]);
            }
        }

        // Build and execute update query
        let setClauses = [];
        let params = [];

        for (const [col, val] of updates) {
            setClauses.push(`${col} = ?`);
            params.push(val);
        }
        for (const [col, val] of pendingUpdates) {
            setClauses.push(`${col} = ?`);
            params.push(val);
        }

        // Always update the updated_at timestamp
        setClauses.push('updated_at = ?');
        params.push(new Date().toISOString().slice(0, 19).replace('T', ' '));

        params.push(userId);

        if (setClauses.length > 1) { // More than just updated_at
            await db.run(
                `UPDATE deposit_limits SET ${setClauses.join(', ')} WHERE user_id = ?`,
                params
            );
        }

        // Prepare response message
        let message = 'Deposit limits updated successfully';
        if (pendingUpdates.length > 0) {
            message += '. Some limit increases will take effect in 24 hours.';
        }

        res.json({ message });
    } catch (err) {
        console.warn('[DepositLimits] Set limits error:', err.message);
        res.status(500).json({ error: 'Failed to set deposit limits' });
    }
});

/**
 * GET /api/deposit-limits/check
 * Quick check if a deposit of a given amount is allowed.
 *
 * Query params:
 * - amount: number (required) — the deposit amount to check
 *
 * Response:
 * {
 *   allowed: boolean,
 *   reason?: string
 * }
 */
router.get('/check', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const amount = parseFloat(req.query.amount);

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount required' });
        }

        // Get current limits
        const limits = await db.get(
            `SELECT daily_limit, weekly_limit, monthly_limit,
                    pending_daily_limit, pending_daily_effective_at,
                    pending_weekly_limit, pending_weekly_effective_at,
                    pending_monthly_limit, pending_monthly_effective_at
             FROM deposit_limits WHERE user_id = ?`,
            [userId]
        );

        const response = { allowed: true };

        if (!limits) {
            return res.json(response); // No limits set
        }

        // Determine effective limits (check if pending limits are now active)
        const now = new Date();
        let effectiveDailyLimit = limits.daily_limit;
        let effectiveWeeklyLimit = limits.weekly_limit;
        let effectiveMonthlyLimit = limits.monthly_limit;

        // Check pending daily limit
        if (limits.pending_daily_limit !== null && limits.pending_daily_effective_at) {
            if (new Date(limits.pending_daily_effective_at) <= now) {
                effectiveDailyLimit = limits.pending_daily_limit;
            }
        }
        // Check pending weekly limit
        if (limits.pending_weekly_limit !== null && limits.pending_weekly_effective_at) {
            if (new Date(limits.pending_weekly_effective_at) <= now) {
                effectiveWeeklyLimit = limits.pending_weekly_limit;
            }
        }
        // Check pending monthly limit
        if (limits.pending_monthly_limit !== null && limits.pending_monthly_effective_at) {
            if (new Date(limits.pending_monthly_effective_at) <= now) {
                effectiveMonthlyLimit = limits.pending_monthly_limit;
            }
        }

        // Calculate daily usage
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyDeposits = await db.all(
            `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
             WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
            [userId, today.toISOString().slice(0, 19).replace('T', ' ')]
        );
        const dailyUsed = dailyDeposits[0]?.total || 0;

        // Check daily limit
        if (effectiveDailyLimit !== null && (dailyUsed + amount) > effectiveDailyLimit) {
            response.allowed = false;
            response.reason = `Daily deposit limit of $${effectiveDailyLimit.toFixed(2)} exceeded. Current usage: $${dailyUsed.toFixed(2)}.`;
            return res.json(response);
        }

        // Calculate weekly usage
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const weeklyDeposits = await db.all(
            `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
             WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
            [userId, weekAgo.toISOString().slice(0, 19).replace('T', ' ')]
        );
        const weeklyUsed = weeklyDeposits[0]?.total || 0;

        // Check weekly limit
        if (effectiveWeeklyLimit !== null && (weeklyUsed + amount) > effectiveWeeklyLimit) {
            response.allowed = false;
            response.reason = `Weekly deposit limit of $${effectiveWeeklyLimit.toFixed(2)} exceeded. Current usage: $${weeklyUsed.toFixed(2)}.`;
            return res.json(response);
        }

        // Calculate monthly usage
        const monthStart = new Date(today);
        monthStart.setDate(1);

        const monthlyDeposits = await db.all(
            `SELECT COALESCE(SUM(amount), 0) as total FROM deposits
             WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
            [userId, monthStart.toISOString().slice(0, 19).replace('T', ' ')]
        );
        const monthlyUsed = monthlyDeposits[0]?.total || 0;

        // Check monthly limit
        if (effectiveMonthlyLimit !== null && (monthlyUsed + amount) > effectiveMonthlyLimit) {
            response.allowed = false;
            response.reason = `Monthly deposit limit of $${effectiveMonthlyLimit.toFixed(2)} exceeded. Current usage: $${monthlyUsed.toFixed(2)}.`;
            return res.json(response);
        }

        res.json(response);
    } catch (err) {
        console.warn('[DepositLimits] Check limit error:', err.message);
        res.status(500).json({ error: 'Failed to check deposit limit' });
    }
});

module.exports = router;
