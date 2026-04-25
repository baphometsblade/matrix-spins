const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// --- Referral Bonus Routes ---
// GET  /api/referralbonus/mycode        -- authenticated; returns referral code + stats
// GET  /api/referralbonus/check/:code   -- public; validates a referral code
// POST /api/referralbonus/apply         -- internal (X-Internal-Secret header); credits both parties

const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const db       = require('../database');
const { JWT_SECRET } = require('../config');

const REFERRAL_BONUS_AMOUNT = 1.0; // $1 credited to both referrer and new user

// --- Auth middleware (JWT Bearer) ---
function verifyToken(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Internal-call middleware (X-Internal-Secret header) ---
function verifyInternal(req, res, next) {
  const secret = req.headers['x-internal-secret'] || '';
  if (secret !== JWT_SECRET) {
    return res.status(403).json({ error: 'Forbidden: invalid internal secret' });
  }
  next();
}

// --- Schema bootstrap (lazy, runs once) ---
let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  // Add referral columns to users table; ignore error if already present
  const cols = [
    'ALTER TABLE users ADD COLUMN referral_code TEXT',
    'ALTER TABLE users ADD COLUMN referral_count INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN referral_bonus_earned REAL DEFAULT 0',
  ];
  for (const sql of cols) {
    try { await db.run(sql); } catch (_) {}
  }

  const isPg  = !!process.env.DATABASE_URL;
  const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
  const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";

  await db.run(
    'CREATE TABLE IF NOT EXISTS referrals (' +
    '  id           ' + idDef + ',' +
    '  referrer_id  INTEGER NOT NULL,' +
    '  referred_id  INTEGER NOT NULL,' +
    '  bonus_amount REAL    DEFAULT 2.0,' +
    '  created_at   ' + tsType + '    DEFAULT ' + tsDefault + ',' +
    '  UNIQUE(referred_id)' +
    ')'
  );

  schemaReady = true;
}

// --- Code generation helper ---
// Format: REF + userId zero-padded to 6 digits + 3 random uppercase letters
// e.g. REF000042XYZ
function buildCode(userId) {
  const padded  = String(userId).padStart(6, '0');
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let suffix    = '';
  for (let i = 0; i < 3; i++) {
    suffix += letters.charAt(secureInt(letters.length));
  }
  return 'REF' + padded + suffix;
}

// Get existing code or generate + persist a new one
async function getOrCreateCode(userId) {
  const row = await db.get('SELECT referral_code FROM users WHERE id = ?', [userId]);
  if (row && row.referral_code) return row.referral_code;

  let code;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = buildCode(userId);
    const existing  = await db.get('SELECT id FROM users WHERE referral_code = ?', [candidate]);
    if (!existing) { code = candidate; break; }
  }
  if (!code) code = buildCode(userId); // last-resort fallback

  await db.run('UPDATE users SET referral_code = ? WHERE id = ?', [code, userId]);
  return code;
}

// --- GET /api/referralbonus/mycode ---
// Returns the authenticated user's referral code plus aggregate stats.
router.get('/mycode', verifyToken, async function(req, res) {
  try {
    await ensureSchema();
    const userId = req.user.id;
    const code   = await getOrCreateCode(userId);
    const user = await db.get('SELECT referral_count, referral_bonus_earned FROM users WHERE id = ?', [userId]);
    return res.json({
      code,
      referralCount: (user && user.referral_count)        || 0,
      bonusEarned:   (user && user.referral_bonus_earned)  || 0,
    });
  } catch (err) {
    console.error('[ReferralBonus] GET /mycode error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch referral code' });
  }
});

// --- GET /api/referralbonus/check/:code ---
// Public endpoint -- validates a code without exposing internal user IDs.
router.get('/check/:code', async function(req, res) {
  try {
    await ensureSchema();
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ valid: false, error: 'Code is required' });
    }
    const referrer = await db.get('SELECT id, username, display_name FROM users WHERE referral_code = ?', [code]);
    if (!referrer) {
      return res.json({ valid: false, referrerUsername: null });
    }
    // Expose display name (or username) -- never the internal ID
    const displayName = (referrer.display_name && referrer.display_name.trim())
      ? referrer.display_name.trim()
      : referrer.username;
    return res.json({ valid: true, referrerUsername: displayName });
  } catch (err) {
    console.error('[ReferralBonus] GET /check error:', err.message);
    return res.status(500).json({ error: 'Failed to validate referral code' });
  }
});

// --- POST /api/referralbonus/apply ---
// Requires header: X-Internal-Secret: <JWT_SECRET>
// Body: { code: string, newUserId: number }
router.post('/apply', verifyInternal, async function(req, res) {
  try {
    await ensureSchema();
    const code      = String((req.body && req.body.code)       || '').trim().toUpperCase();
    const newUserId = parseInt((req.body && req.body.newUserId) || 0, 10);
    if (!code || !newUserId) {
      return res.status(400).json({ success: false, message: 'code and newUserId are required' });
    }
    // Resolve the referrer by code
    const referrer = await db.get('SELECT id FROM users WHERE referral_code = ?', [code]);
    if (!referrer) {
      return res.status(400).json({ success: false, message: 'Invalid referral code' });
    }
    if (referrer.id === newUserId) {
      return res.status(400).json({ success: false, message: 'Self-referral is not permitted' });
    }
    // Confirm new user exists
    const newUser = await db.get('SELECT id FROM users WHERE id = ?', [newUserId]);
    if (!newUser) {
      return res.status(404).json({ success: false, message: 'New user not found' });
    }
    // Insert referral record; UNIQUE(referred_id) prevents duplicates
    try {
      await db.run('INSERT INTO referrals (referrer_id, referred_id, bonus_amount) VALUES (?, ?, ?)', [referrer.id, newUserId, REFERRAL_BONUS_AMOUNT]);
    } catch (uniqueErr) {
      // UNIQUE constraint violation -- user has already been referred
      return res.status(409).json({ success: false, message: 'This user has already been referred' });
    }
    // Credit referrer: balance + running totals
    await db.run(
      'UPDATE users SET balance = balance + ?, referral_count = COALESCE(referral_count, 0) + 1, referral_bonus_earned = COALESCE(referral_bonus_earned, 0) + ? WHERE id = ?',
      [REFERRAL_BONUS_AMOUNT, REFERRAL_BONUS_AMOUNT, referrer.id]
    );
    await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
      [referrer.id, REFERRAL_BONUS_AMOUNT, 'Referral bonus -- new user joined with your code']);
    // Grant referral_made achievement to the referrer (idempotent)
    require('../services/achievement.service').grant(referrer.id, 'referral_made').catch(function() {});
    // Credit new user: balance only
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [REFERRAL_BONUS_AMOUNT, newUserId]);
    await db.run("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
      [newUserId, REFERRAL_BONUS_AMOUNT, 'Welcome bonus -- joined via referral code']);
    return res.json({
      success: true,
      message: '$' + REFERRAL_BONUS_AMOUNT.toFixed(2) + ' credited to both the referrer and the new user',
    });
  } catch (err) {
    console.error('[ReferralBonus] POST /apply error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to apply referral bonus' });
  }
});

module.exports = router;