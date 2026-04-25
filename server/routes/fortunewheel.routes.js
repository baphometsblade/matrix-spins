const _crypto = require('crypto');
function secureFloat() { return _crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; }
function secureInt(n) { return _crypto.randomInt(n); }

'use strict';

// Fortune Wheel Routes (free daily spin for all users)
// GET  /api/fortunewheel/status  -- authenticated; whether spin is available today
// POST /api/fortunewheel/spin    -- authenticated; spin the wheel, get reward

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');

// 8 wheel segments with weights (higher weight = more frequent)
const SEGMENTS = [
  { label: '$0.25 Cash',    type: 'cash',   amount: 0.25,  weight: 30 },
  { label: '$0.25 Cash',    type: 'cash',   amount: 0.25,  weight: 30 },
  { label: '$0.50 Cash',    type: 'cash',   amount: 0.50,  weight: 20 },
  { label: '$0.50 Cash',    type: 'cash',   amount: 0.50,  weight: 20 },
  { label: '$1.00 Cash',    type: 'cash',   amount: 1.00,  weight: 10 },
  { label: '50 Points',     type: 'points', amount: 50,    weight: 15 },
  { label: '100 Points',    type: 'points', amount: 100,   weight: 10 },
  { label: '3 Free Spins',  type: 'freespins', amount: 3,  weight: 15 },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickSegment() {
  const total = SEGMENTS.reduce(function(s, seg) { return s + seg.weight; }, 0);
  let r = secureFloat() * total;
  for (let i = 0; i < SEGMENTS.length; i++) {
    r -= SEGMENTS[i].weight;
    if (r <= 0) return i;
  }
  return SEGMENTS.length - 1;
}

// Schema bootstrap
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  try { await db.run('ALTER TABLE users ADD COLUMN fortune_wheel_last TEXT'); } catch (_) {}
  // Ensure free_spins_remaining column exists (may be added by freespins routes)
  try { await db.run('ALTER TABLE users ADD COLUMN free_spins_remaining INTEGER DEFAULT 0'); } catch (_) {}
  // Ensure loyalty_points column exists
  try { await db.run('ALTER TABLE users ADD COLUMN loyalty_points INTEGER DEFAULT 0'); } catch (_) {}
  schemaReady = true;
}

// GET /status
router.get('/status', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    const user = await db.get('SELECT fortune_wheel_last FROM users WHERE id = ?', [req.user.id]);
    const lastSpin = user ? user.fortune_wheel_last : null;
    const available = lastSpin !== todayStr();
    return res.json({ available, lastSpin, segments: SEGMENTS.map(function(s, i) { return { index: i, label: s.label, type: s.type }; }) });
  } catch (err) {
    console.error('[FortuneWheel] GET /status error:', err.message);
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

// POST /spin
router.post('/spin', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    const userId = req.user.id;
    const user = await db.get('SELECT fortune_wheel_last, balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const today = todayStr();
    if (user.fortune_wheel_last === today) {
      return res.status(429).json({ error: 'Already spun today', available: false });
    }

    const segIdx = pickSegment();
    const seg = SEGMENTS[segIdx];

    // Credit reward
    let newBalance = parseFloat(user.balance) || 0;
    if (seg.type === 'cash') {
      await db.run('UPDATE users SET balance = balance + ?, fortune_wheel_last = ? WHERE id = ?', [seg.amount, today, userId]);
      await db.run(
        "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
        [userId, seg.amount, 'Fortune Wheel reward: ' + seg.label]
      );
      const u = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
      newBalance = u ? parseFloat(u.balance) : newBalance + seg.amount;
    } else if (seg.type === 'points') {
      await db.run(
        'UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + ?, fortune_wheel_last = ? WHERE id = ?',
        [seg.amount, today, userId]
      );
      await db.run('UPDATE users SET fortune_wheel_last = ? WHERE id = ?', [today, userId]);
    } else if (seg.type === 'freespins') {
      await db.run(
        'UPDATE users SET free_spins_remaining = COALESCE(free_spins_remaining, 0) + ?, fortune_wheel_last = ? WHERE id = ?',
        [seg.amount, today, userId]
      );
    }

    // Always mark today's spin (in case it wasn't set above due to type)
    await db.run('UPDATE users SET fortune_wheel_last = ? WHERE id = ?', [today, userId]);

    return res.json({
      success: true,
      segmentIndex: segIdx,
      reward: { type: seg.type, amount: seg.amount, label: seg.label },
      newBalance,
    });
  } catch (err) {
    console.error('[FortuneWheel] POST /spin error:', err.message);
    return res.status(500).json({ error: 'Failed to spin' });
  }
});

module.exports = router;
