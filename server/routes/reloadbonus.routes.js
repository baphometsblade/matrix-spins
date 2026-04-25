'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const MATCH_PERCENT = 0.25;
const MAX_BONUS = 2.50;
const MIN_DEPOSIT = 5.00;
const COOLDOWN_DAYS = 7;

// JWT auth middleware
function verifyToken(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// Lazy schema migration — adds columns if they do not exist yet
async function ensureSchema() {
  try {
    await db.run(`ALTER TABLE users ADD COLUMN reload_bonus_claimed_at TEXT`);
  } catch (e) {
    // Column already exists — ignore
  }
  try {
    await db.run(`ALTER TABLE users ADD COLUMN reload_bonus_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists — ignore
  }
}

let schemaReady = false;
async function withSchema(req, res, next) {
  if (!schemaReady) {
    await ensureSchema();
    schemaReady = true;
  }
  next();
}

// GET /api/reloadbonus/status
router.get('/status', verifyToken, withSchema, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const user = await db.get(
      `SELECT balance, reload_bonus_claimed_at, reload_bonus_count FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const claimedAt = user.reload_bonus_claimed_at || null;
    let available = false;
    let nextAvailableAt = null;

    if (!claimedAt) {
      available = true;
    } else {
      // Check if 7 days have elapsed since last claim
      const claimedDate = new Date(claimedAt);
      const nextDate = new Date(claimedDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const now = new Date();
      if (now >= nextDate) {
        available = true;
      } else {
        available = false;
        nextAvailableAt = nextDate.toISOString();
      }
    }

    return res.json({
      eligible: available,
      available,
      balance: parseFloat(user.balance) || 0,
      matchPercent: Math.round(MATCH_PERCENT * 100),
      maxBonus: MAX_BONUS,
      minDeposit: MIN_DEPOSIT,
      claimedAt,
      claimsCount: user.reload_bonus_count || 0,
      nextAvailableAt
    });
  } catch (err) {
    console.error('[reloadbonus] GET /status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reloadbonus/claim
router.post('/claim', verifyToken, withSchema, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { depositAmount } = req.body || {};

    // If no deposit amount provided, use MIN_DEPOSIT as the basis (flat bonus mode)
    const deposit = depositAmount ? parseFloat(depositAmount) : MIN_DEPOSIT;

    const user = await db.get(
      `SELECT balance, reload_bonus_claimed_at, reload_bonus_count FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check availability
    const claimedAt = user.reload_bonus_claimed_at || null;
    let available = false;

    if (!claimedAt) {
      available = true;
    } else {
      const claimedDate = new Date(claimedAt);
      const nextDate = new Date(claimedDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const now = new Date();
      available = now >= nextDate;
    }

    if (!available) {
      const claimedDate = new Date(claimedAt);
      const nextDate = new Date(claimedDate.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      return res.status(400).json({
        error: 'Reload bonus not available yet',
        nextAvailableAt: nextDate.toISOString()
      });
    }

    // Calculate bonus and wagering. Use config wagering multiplier (35x by default).
    const config = require('../config');
    const bonus = parseFloat(Math.min(deposit * MATCH_PERCENT, MAX_BONUS).toFixed(2));
    const wageringMult = config.RELOAD_WAGERING_MULT || 35;
    const wagerReq = parseFloat((bonus * wageringMult).toFixed(2));

    // Reload bonus is FREE money → bonus_balance with accumulating wagering.
    // Atomic accumulators prevent races and overwrites.
    await db.run(
      `UPDATE users
       SET bonus_balance = COALESCE(bonus_balance, 0) + ?,
           wagering_requirement = COALESCE(wagering_requirement, 0) + ?,
           reload_bonus_claimed_at = datetime('now'),
           reload_bonus_count = COALESCE(reload_bonus_count, 0) + 1
       WHERE id = ?`,
      [bonus, wagerReq, userId]
    );

    // Insert transaction record
    await db.run(
      `INSERT INTO transactions (user_id, type, amount, description, created_at)
       VALUES (?, 'bonus', ?, ?, datetime('now'))`,
      [userId, bonus, `Weekly reload bonus (${wageringMult}x wagering)`]
    );

    return res.json({
      success: true,
      bonus,
      creditedTo: 'bonus_balance',
      wageringRequirement: wagerReq,
      message: `Reload bonus of $${bonus.toFixed(2)} credited (subject to ${wageringMult}x wagering)`
    });
  } catch (err) {
    console.error('[reloadbonus] POST /claim error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
