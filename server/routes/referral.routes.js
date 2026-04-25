const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../database');

// ─── Lazy schema init ─────────────────────────────────────────────────────────
let schemaReady = false;

async function ensureSchema() {
    if (schemaReady) return;

    // Add referral_code column to users if it doesn't exist yet
    try {
        await db.run('ALTER TABLE users ADD COLUMN referral_code TEXT');
    } catch (e) {
        // Column already exists — safe to ignore
    }

    const isPg  = !!process.env.DATABASE_URL;
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";

    // Create referrals table
    await db.run(`
        CREATE TABLE IF NOT EXISTS referrals (
            id          ${idDef},
            referrer_id INTEGER NOT NULL,
            referee_id  INTEGER NOT NULL,
            status      TEXT    DEFAULT 'pending',
            bonus_paid  REAL    DEFAULT 0,
            created_at  ${tsType}    DEFAULT ${tsDefault}
        )
    `);

    schemaReady = true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode() {
    return _crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function getOrCreateCode(userId) {
    var user = await db.get('SELECT referral_code FROM users WHERE id = ?', [userId]);
    if (user && user.referral_code) return user.referral_code;

    // Generate a unique code (retry on collision)
    var code;
    var attempts = 0;
    do {
        code = generateCode();
        var existing = await db.get('SELECT id FROM users WHERE referral_code = ?', [code]);
        if (!existing) break;
        attempts++;
    } while (attempts < 10);

    await db.run('UPDATE users SET referral_code = ? WHERE id = ?', [code, userId]);
    return code;
}

// ─── GET /api/referral/info ───────────────────────────────────────────────────
// Returns the authenticated user's referral code, full share URL and summary stats.
router.get('/info', authenticate, async (req, res) => {
    try {
        await ensureSchema();

        var userId = req.user.id;
        var code   = await getOrCreateCode(userId);

        var host = (req.headers.host || 'localhost:3000');
        var protocol = req.secure ? 'https' : 'http';
        var referralUrl = protocol + '://' + host + '?ref=' + code;

        var totalRow = await db.get(
            'SELECT COUNT(*) AS cnt FROM referrals WHERE referrer_id = ?',
            [userId]
        );
        var pendingRow = await db.get(
            "SELECT COUNT(*) AS cnt FROM referrals WHERE referrer_id = ? AND status = 'pending'",
            [userId]
        );
        var earnedRow = await db.get(
            "SELECT COALESCE(SUM(bonus_paid), 0) AS total FROM referrals WHERE referrer_id = ? AND status = 'completed'",
            [userId]
        );

        res.json({
            code,
            referralUrl,
            totalReferrals:   (totalRow   && totalRow.cnt)   || 0,
            pendingReferrals: (pendingRow && pendingRow.cnt) || 0,
            totalEarned:      (earnedRow  && parseFloat(earnedRow.total)) || 0
        });
    } catch (err) {
        console.error('[Referral] GET /info error:', err.message);
        res.status(500).json({ error: 'Failed to fetch referral info' });
    }
});

// ─── POST /api/referral/apply ─────────────────────────────────────────────────
// Apply someone else's referral code to the current user's account (one-time).
router.post('/apply', authenticate, async (req, res) => {
    try {
        await ensureSchema();

        var userId = req.user.id;
        var code   = (req.body && req.body.code) ? String(req.body.code).trim().toUpperCase() : '';

        if (!code) {
            return res.status(400).json({ error: 'Referral code is required' });
        }

        // Find the referrer by code
        var referrer = await db.get('SELECT id FROM users WHERE referral_code = ?', [code]);
        if (!referrer) {
            return res.status(400).json({ error: 'Invalid referral code' });
        }

        if (referrer.id === userId) {
            return res.status(400).json({ error: 'You cannot refer yourself' });
        }

        // Check if this user has already been referred by anyone
        var alreadyReferred = await db.get(
            'SELECT id FROM referrals WHERE referee_id = ?',
            [userId]
        );
        if (alreadyReferred) {
            return res.status(400).json({ error: 'You have already used a referral code' });
        }

        // Create the pending referral record
        await db.run(
            "INSERT INTO referrals (referrer_id, referee_id, status, bonus_paid) VALUES (?, ?, 'pending', 0)",
            [referrer.id, userId]
        );

        res.json({ success: true, message: 'Referral code applied! Bonus will be credited on first deposit.' });
    } catch (err) {
        console.error('[Referral] POST /apply error:', err.message);
        res.status(500).json({ error: 'Failed to apply referral code' });
    }
});

// ─── GET /api/referral/stats ──────────────────────────────────────────────────
// Returns the last 20 referrals made by the authenticated user, with masked usernames.
router.get('/stats', authenticate, async (req, res) => {
    try {
        await ensureSchema();

        var userId = req.user.id;

        var rows = await db.all(
            `SELECT r.id,
                    COALESCE(u.display_name, u.username) AS referee_username,
                    r.status,
                    r.bonus_paid,
                    r.created_at
             FROM referrals r
             JOIN users u ON u.id = r.referee_id
             WHERE r.referrer_id = ?
             ORDER BY r.created_at DESC
             LIMIT 20`,
            [userId]
        );

        // Mask referee username: first 2 chars + ***
        var referrals = (rows || []).map(function (row) {
            var name = row.referee_username || '??';
            var masked = name.length > 2
                ? name.substring(0, 2) + '***'
                : name.charAt(0) + '***';
            return {
                id:               row.id,
                referee_username: masked,
                status:           row.status,
                bonus_paid:       row.bonus_paid || 0,
                created_at:       row.created_at
            };
        });

        res.json({ referrals });
    } catch (err) {
        console.error('[Referral] GET /stats error:', err.message);
        res.status(500).json({ error: 'Failed to fetch referral stats' });
    }
});

module.exports = router;
