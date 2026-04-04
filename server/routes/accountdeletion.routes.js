const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

var isPg = !!process.env.DATABASE_URL;
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Bootstrap: create deletion_requests table for GDPR compliance
db.run(`CREATE TABLE IF NOT EXISTS deletion_requests (
    id ${idDef},
    user_id INTEGER NOT NULL,
    requested_at ${tsDef},
    scheduled_for TEXT NOT NULL,
    cancelled INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0
)`).catch(function(e) { if (e && !String(e.message || e).match(/already exists/i)) console.warn('[AccountDeletion] Table create failed:', e.message || e); });

/**
 * POST /api/account/request-deletion (authenticated)
 * Initiates account deletion with 14-day grace period
 * Requires password confirmation for security
 */
router.post('/request-deletion', authenticate, async (req, res) => {
    try {
        const { password } = req.body;
        const userId = req.user.id;

        if (!password) {
            return res.status(400).json({ error: 'Password is required for account deletion' });
        }

        // Fetch user from database
        const user = await db.get('SELECT id, password_hash FROM users WHERE id = ?', [userId]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify password
        const passwordValid = bcrypt.compareSync(password, user.password_hash);

        if (!passwordValid) {
            return res.status(401).json({ error: 'Password is incorrect' });
        }

        // Check if there's already a pending deletion request
        const existingRequest = await db.get(
            'SELECT id, scheduled_for FROM deletion_requests WHERE user_id = ? AND cancelled = 0 AND completed = 0',
            [userId]
        );

        if (existingRequest) {
            return res.status(409).json({
                error: 'You already have a pending deletion request',
                scheduledFor: existingRequest.scheduled_for
            });
        }

        // Calculate 14-day grace period end date
        const scheduledDate = new Date();
        scheduledDate.setDate(scheduledDate.getDate() + 14);
        const scheduledFor = scheduledDate.toISOString().slice(0, 19).replace('T', ' ');

        // Create deletion request
        const result = await db.run(
            'INSERT INTO deletion_requests (user_id, scheduled_for) VALUES (?, ?)',
            [userId, scheduledFor]
        );

        console.warn('[AccountDeletion] Deletion request created for user:', userId, 'scheduled for:', scheduledFor);

        res.status(201).json({
            message: `Account scheduled for deletion on ${new Date(scheduledFor).toLocaleDateString()}. You can cancel within 14 days.`,
            scheduledFor: scheduledFor
        });
    } catch (err) {
        console.warn('[AccountDeletion] Request deletion error:', err.message);
        res.status(500).json({ error: 'Failed to schedule account deletion' });
    }
});

/**
 * POST /api/account/cancel-deletion (authenticated)
 * Cancels a pending deletion request
 */
router.post('/cancel-deletion', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Find pending deletion request
        const deletionRequest = await db.get(
            'SELECT id FROM deletion_requests WHERE user_id = ? AND cancelled = 0 AND completed = 0',
            [userId]
        );

        if (!deletionRequest) {
            return res.status(404).json({ error: 'No pending deletion request found' });
        }

        // Cancel the deletion request
        await db.run(
            'UPDATE deletion_requests SET cancelled = 1 WHERE id = ?',
            [deletionRequest.id]
        );

        console.warn('[AccountDeletion] Deletion request cancelled for user:', userId);

        res.json({
            message: 'Account deletion cancelled. Your account is safe.'
        });
    } catch (err) {
        console.warn('[AccountDeletion] Cancel deletion error:', err.message);
        res.status(500).json({ error: 'Failed to cancel account deletion' });
    }
});

/**
 * GET /api/account/deletion-status (authenticated)
 * Check if there's a pending deletion request
 */
router.get('/deletion-status', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Find pending deletion request
        const deletionRequest = await db.get(
            'SELECT id, scheduled_for FROM deletion_requests WHERE user_id = ? AND cancelled = 0 AND completed = 0',
            [userId]
        );

        if (!deletionRequest) {
            return res.json({
                pending: false,
                scheduledFor: null
            });
        }

        res.json({
            pending: true,
            scheduledFor: deletionRequest.scheduled_for
        });
    } catch (err) {
        console.warn('[AccountDeletion] Deletion status error:', err.message);
        res.status(500).json({ error: 'Failed to check deletion status' });
    }
});

module.exports = router;
