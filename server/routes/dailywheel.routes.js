const router = require('express').Router();
const crypto = require('crypto');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const bonusCap = require('../services/bonus-cap.service');
const wheelVoucher = require('../services/wheel-voucher.service');

// ════════════════════════════════════════════════════════════════════════════
// DAILY PRIZE WHEEL — one free spin per UTC day.
//
// 12 weighted segments. Cash prizes credit bonus_balance with a 15x wagering
// requirement (CLAUDE.md rule #1 — free bonuses NEVER touch withdrawable
// `balance`). "Free Spins" grants slot free spins; "Deposit Bonus" stores a
// pending voucher applied to the next real deposit. Server-side crypto RNG.
//
// 7-day streak: the spin that completes a 7-day streak is GUARANTEED to draw
// from the premium prize pool (no sub-dollar cash outcomes).
// ════════════════════════════════════════════════════════════════════════════

const CASH_WAGERING_MULTIPLIER = 15;     // standard bonus rate
const FREE_SPIN_EXPIRY_HOURS = 48;
const DEPOSIT_VOUCHER_PERCENT = 10;
const DEPOSIT_VOUCHER_MAX = 50;
const DEPOSIT_VOUCHER_DAYS = 7;

// Segment order matters — `index` is returned to the client so the wheel lands
// on the matching slice.
const WHEEL_PRIZES = [
  { key: 'c010',  kind: 'cash',          amount: 0.10, label: '$0.10',             emoji: '🪙', color: '#0f3d20', weight: 18  },
  { key: 'c025a', kind: 'cash',          amount: 0.25, label: '$0.25',             emoji: '🪙', color: '#0a2e18', weight: 16  },
  { key: 'c050a', kind: 'cash',          amount: 0.50, label: '$0.50',             emoji: '💵', color: '#0f3d20', weight: 14  },
  { key: 'c1',    kind: 'cash',          amount: 1.00, label: '$1',                emoji: '💵', color: '#0a2e18', weight: 12  },
  { key: 'c2',    kind: 'cash',          amount: 2.00, label: '$2',                emoji: '💵', color: '#0f3d20', weight: 8   },
  { key: 'fs5',   kind: 'free_spins',    value: 5,     label: '5 Free Spins',      emoji: '🎰', color: '#123b52', weight: 6   },
  { key: 'c5',    kind: 'cash',          amount: 5.00, label: '$5',                emoji: '💰', color: '#0a2e18', weight: 4   },
  { key: 'dep10', kind: 'deposit_bonus', percent: 10,  label: '10% Deposit Bonus', emoji: '🎁', color: '#3a2a05', weight: 5   },
  { key: 'c025b', kind: 'cash',          amount: 0.25, label: '$0.25',             emoji: '🪙', color: '#0a2e18', weight: 16  },
  { key: 'c050b', kind: 'cash',          amount: 0.50, label: '$0.50',             emoji: '💵', color: '#0f3d20', weight: 14  },
  { key: 'c10',   kind: 'cash',          amount: 10.00, label: '$10',              emoji: '🔥', color: '#3a1505', weight: 1.5 },
  { key: 'c50',   kind: 'cash',          amount: 50.00, label: '$50',              emoji: '👑', color: '#3a0505', weight: 0.3 },
];

// Premium pool used on the day-7 streak spin — references segment indices so the
// returned index is always a valid wheel slice.
const DAY7_POOL = [
  { index: 6,  weight: 40 }, // $5
  { index: 5,  weight: 25 }, // 5 Free Spins
  { index: 7,  weight: 20 }, // 10% Deposit Bonus
  { index: 10, weight: 12 }, // $10
  { index: 11, weight: 3  }, // $50
];

function cryptoFloat() {
  return crypto.randomBytes(4).readUInt32BE(0) / 0x100000000;
}

// Returns the winning segment index.
function selectPrizeIndex(isDay7) {
  if (isDay7) {
    const total = DAY7_POOL.reduce((s, p) => s + p.weight, 0);
    let r = cryptoFloat() * total;
    for (const p of DAY7_POOL) { r -= p.weight; if (r <= 0) return p.index; }
    return DAY7_POOL[0].index;
  }
  const total = WHEEL_PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = cryptoFloat() * total;
  for (let i = 0; i < WHEEL_PRIZES.length; i++) {
    r -= WHEEL_PRIZES[i].weight;
    if (r <= 0) return i;
  }
  return 0;
}

// ── Schema bootstrap ────────────────────────────────────────────────────────
async function initializeDailyWheelTable() {
  try {
    const isPg = db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
    const dateDef = isPg ? 'DATE' : 'TEXT';
    await db.run(
      'CREATE TABLE IF NOT EXISTS daily_wheel_spins (' +
      '  id ' + idDef + ',' +
      '  user_id INTEGER NOT NULL,' +
      '  prize_type TEXT NOT NULL,' +
      '  prize_amount REAL NOT NULL,' +
      '  spin_date ' + dateDef + ',' +
      '  spun_at ' + tsDef +
      ')'
    );
    try { await db.run('ALTER TABLE daily_wheel_spins ADD COLUMN spin_date ' + dateDef); } catch (_) {}
    try { await db.run("UPDATE daily_wheel_spins SET spin_date = DATE(spun_at) WHERE spin_date IS NULL"); } catch (_) {}
    await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_wheel_user_day ON daily_wheel_spins (user_id, spin_date)');
    // Free-spins columns (also created by freespins.routes; harmless if present).
    try { await db.run('ALTER TABLE users ADD COLUMN free_spins_count INTEGER DEFAULT 0'); } catch (_) {}
    try { await db.run('ALTER TABLE users ADD COLUMN free_spins_expires TEXT DEFAULT NULL'); } catch (_) {}
    console.warn('[DailyWheel] Table initialized');
  } catch (err) {
    console.warn('[DailyWheel] Bootstrap error:', err.message);
  }
}
initializeDailyWheelTable();

async function calculateStreak(userId) {
  try {
    const rows = await db.all(
      `SELECT DATE(spun_at) as spin_date FROM daily_wheel_spins WHERE user_id = ? ORDER BY spun_at DESC LIMIT 8`,
      [userId]
    );
    if (rows.length === 0) return 0;
    let streak = 1;
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = new Date(rows[i].spin_date);
      const nxt = new Date(rows[i + 1].spin_date);
      const diffDays = Math.round((cur - nxt) / 86400000);
      if (diffDays === 1) streak++;
      else break;
    }
    return streak;
  } catch (err) {
    console.warn('[DailyWheel] streak error:', err.message);
    return 0;
  }
}

async function hasSpunToday(userId) {
  try {
    const r = await db.get(
      `SELECT id FROM daily_wheel_spins WHERE user_id = ? AND DATE(spun_at) = DATE('now')`,
      [userId]
    );
    return !!r;
  } catch (err) {
    console.warn('[DailyWheel] spunToday error:', err.message);
    return false;
  }
}

function publicPrizes() {
  return WHEEL_PRIZES.map((p, i) => ({
    index: i, kind: p.kind, label: p.label, emoji: p.emoji, color: p.color,
    amount: p.amount || 0, value: p.value || 0, percent: p.percent || 0,
  }));
}

// ── GET / — wheel status ─────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const spunToday = await hasSpunToday(userId);

    const lastSpin = await db.get(
      `SELECT prize_type, prize_amount, spun_at FROM daily_wheel_spins WHERE user_id = ? ORDER BY spun_at DESC LIMIT 1`,
      [userId]
    );
    const streak = await calculateStreak(userId);

    let nextSpinAt = null;
    if (spunToday) {
      // Next spin unlocks at the next UTC midnight.
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      nextSpinAt = next.toISOString();
    }

    let pendingVoucher = null;
    try {
      const v = await wheelVoucher.getPendingVoucher(userId);
      if (v) pendingVoucher = { percent: v.percent, maxBonus: v.max_bonus, expiresAt: v.expires_at };
    } catch (_) {}

    res.json({
      canSpin: !spunToday,
      nextSpinAt,
      lastPrize: lastSpin ? { label: lastSpin.prize_type, amount: lastSpin.prize_amount } : null,
      streak,
      day7Next: (streak + 1) % 7 === 0,
      prizes: publicPrizes(),
      pendingVoucher,
    });
  } catch (err) {
    console.warn('[DailyWheel] status error:', err.message);
    res.status(500).json({ error: 'Failed to get wheel status' });
  }
});

// ── POST /spin ───────────────────────────────────────────────────────────────
router.post('/spin', authenticate, bonusGuard, async (req, res) => {
  try {
    const userId = req.user.id;

    if (await hasSpunToday(userId)) {
      return res.status(400).json({ error: 'You have already spun today. Come back tomorrow!' });
    }

    // Self-exclusion — fail CLOSED.
    try {
      const exclusion = await db.get(
        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
        [userId]
      );
      if (exclusion) return res.status(403).json({ error: 'Your account is self-excluded' });
    } catch (exclErr) {
      console.error('[DailyWheel] Self-exclusion check failed:', exclErr.message);
      return res.status(500).json({ error: 'Security check failed. Please try again.' });
    }

    const streakBefore = await calculateStreak(userId);
    const isDay7 = (streakBefore + 1) % 7 === 0;
    const index = selectPrizeIndex(isDay7);
    const prize = WHEEL_PRIZES[index];

    let creditedCash = 0;
    let freeSpinsGranted = 0;
    let voucher = null;

    // Record the spin FIRST (the UNIQUE (user_id, spin_date) index is the true
    // one-per-day guarantee against the midnight TOCTOU race).
    await db.beginTransaction();
    try {
      try {
        await db.run(
          `INSERT INTO daily_wheel_spins (user_id, prize_type, prize_amount, spin_date) VALUES (?, ?, ?, DATE('now'))`,
          [userId, prize.label, prize.amount || 0]
        );
      } catch (insertErr) {
        await db.rollback();
        const msg = String(insertErr && insertErr.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('duplicate')) {
          return res.status(400).json({ error: 'You have already spun today' });
        }
        throw insertErr;
      }

      if (prize.kind === 'cash') {
        // Respect the global daily bonus cap.
        let amount = prize.amount;
        try {
          const cap = await bonusCap.checkDailyCap(userId);
          if (cap && cap.remaining < amount) amount = Math.round(cap.remaining * 100) / 100;
        } catch (_) {}
        if (amount > 0) {
          const wagerReq = Math.round(amount * CASH_WAGERING_MULTIPLIER * 100) / 100;
          await db.run(
            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
            [amount, wagerReq, userId]
          );
          await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
            [userId, 'daily_bonus', amount, userId, userId, 'Daily Wheel: ' + prize.label + ' (' + CASH_WAGERING_MULTIPLIER + 'x wagering)']
          );
          creditedCash = amount;
        }
      } else if (prize.kind === 'free_spins') {
        const expires = new Date(Date.now() + FREE_SPIN_EXPIRY_HOURS * 3600000).toISOString().slice(0, 19).replace('T', ' ');
        await db.run(
          'UPDATE users SET free_spins_count = COALESCE(free_spins_count, 0) + ?, free_spins_expires = ? WHERE id = ?',
          [prize.value, expires, userId]
        );
        freeSpinsGranted = prize.value;
      }
      // deposit_bonus handled post-commit (its own table + service).

      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch (_) {}
      throw txErr;
    }

    if (prize.kind === 'deposit_bonus') {
      try {
        const g = await wheelVoucher.grantDepositVoucher(userId, DEPOSIT_VOUCHER_PERCENT, DEPOSIT_VOUCHER_MAX, DEPOSIT_VOUCHER_DAYS);
        voucher = { percent: DEPOSIT_VOUCHER_PERCENT, maxBonus: DEPOSIT_VOUCHER_MAX, expiresAt: g && g.expiresAt };
      } catch (_) {}
    }

    const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [userId]);
    const newStreak = await calculateStreak(userId);

    res.json({
      prize: {
        index,
        kind: prize.kind,
        label: prize.label,
        emoji: prize.emoji,
        amount: prize.amount || 0,
        value: prize.value || 0,
        percent: prize.percent || 0,
      },
      creditedCash,
      freeSpinsGranted,
      voucher,
      day7Bonus: isDay7,
      newBalance: user ? user.balance : 0,
      newBonusBalance: user ? (user.bonus_balance || 0) : 0,
      streak: newStreak,
    });
  } catch (err) {
    console.warn('[DailyWheel] spin error:', err.message);
    res.status(500).json({ error: 'Failed to spin wheel' });
  }
});

// ── GET /history ─────────────────────────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const spins = await db.all(
      `SELECT id, prize_type, prize_amount, spun_at FROM daily_wheel_spins WHERE user_id = ? ORDER BY spun_at DESC LIMIT 30`,
      [userId]
    );
    res.json({ spins, count: spins.length });
  } catch (err) {
    console.warn('[DailyWheel] history error:', err.message);
    res.status(500).json({ error: 'Failed to get spin history' });
  }
});

// Test hooks (pure functions — no DB).
router._test = { WHEEL_PRIZES, DAY7_POOL, selectPrizeIndex, publicPrizes };

module.exports = router;
