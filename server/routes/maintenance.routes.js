const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const MAINTENANCE_FILE = path.join(__dirname, '..', 'data', 'maintenance.json');

/**
 * Helper to read maintenance state from disk
 */
function readMaintenanceState() {
    try {
        const data = fs.readFileSync(MAINTENANCE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.warn('[Maintenance Routes] Failed to read state:', err.message);
        return {
            enabled: false,
            message: 'Matrix Spins is undergoing scheduled maintenance. We\'ll be back shortly!',
            startedAt: null,
            updatedAt: null
        };
    }
}

/**
 * Helper to write maintenance state to disk
 */
function writeMaintenanceState(state) {
    try {
        fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
        console.warn('[Maintenance Routes] Failed to write state:', err.message);
        throw err;
    }
}

// All maintenance routes require authentication + admin role
router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/maintenance/status
 * Returns current maintenance state
 */
router.get('/status', async (req, res) => {
    try {
        const state = readMaintenanceState();
        res.json({
            enabled: state.enabled,
            message: state.message,
            startedAt: state.startedAt,
            updatedAt: state.updatedAt
        });
    } catch (err) {
        console.warn('[Maintenance Routes] GET /status error:', err.message);
        res.status(500).json({ error: 'Failed to fetch maintenance status' });
    }
});

/**
 * POST /api/admin/maintenance/enable
 * Enables maintenance mode
 * Optional body: { message: "Custom maintenance message" }
 */
router.post('/enable', async (req, res) => {
    try {
        const state = readMaintenanceState();
        const now = new Date().toISOString();

        state.enabled = true;
        if (req.body && req.body.message) {
            state.message = String(req.body.message).slice(0, 500);
        }
        if (!state.startedAt) {
            state.startedAt = now;
        }
        state.updatedAt = now;

        writeMaintenanceState(state);

        console.warn(`[Maintenance] Maintenance mode ENABLED by admin ${req.user.username}`);

        res.json({
            success: true,
            message: 'Maintenance mode enabled',
            state: {
                enabled: state.enabled,
                message: state.message,
                startedAt: state.startedAt,
                updatedAt: state.updatedAt
            }
        });
    } catch (err) {
        console.warn('[Maintenance Routes] POST /enable error:', err.message);
        res.status(500).json({ error: 'Failed to enable maintenance mode' });
    }
});

/**
 * POST /api/admin/maintenance/disable
 * Disables maintenance mode
 */
router.post('/disable', async (req, res) => {
    try {
        const state = readMaintenanceState();
        const now = new Date().toISOString();

        state.enabled = false;
        state.updatedAt = now;

        writeMaintenanceState(state);

        console.warn(`[Maintenance] Maintenance mode DISABLED by admin ${req.user.username}`);

        res.json({
            success: true,
            message: 'Maintenance mode disabled',
            state: {
                enabled: state.enabled,
                message: state.message,
                startedAt: state.startedAt,
                updatedAt: state.updatedAt
            }
        });
    } catch (err) {
        console.warn('[Maintenance Routes] POST /disable error:', err.message);
        res.status(500).json({ error: 'Failed to disable maintenance mode' });
    }
});

module.exports = router;
