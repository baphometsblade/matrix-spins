'use strict';

const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');

// Bootstrap tables + seed (delayed to ensure DB is initialized)
setTimeout(async function() {
  try {
    var _isPg  = db.isPg();
    var _idDef = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    var _tsType    = _isPg ? 'TIMESTAMPTZ' : 'TEXT';
    var _tsDefault = _isPg ? 'NOW()' : "(datetime('now'))";
    await db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
    id ${_idDef},
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    reward_gems INTEGER DEFAULT 0,
    reward_credits REAL DEFAULT 0,
    reward_spins INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 0,
    uses_count INTEGER DEFAULT 0,
    expires_at TEXT DEFAULT NULL,
    active INTEGER DEFAULT 1,
    created_at ${_tsType} DEFAULT ${_tsDefault}
  )`);

    await db.run(`CREATE TABLE IF NOT EXISTS promo_redemptions (
    id ${_idDef},
    user_id INTEGER NOT NULL,
    code_id INTEGER NOT NULL,
    redeemed_at ${_tsType} DEFAULT ${_tsDefault},
    UNIQUE(user_id, code_id)
  )`);

    // No seeded codes — promo codes only exist when an admin creates them
    // via /api/promocode/create. Users see an empty list until then.
  } catch(e) { console.warn('[Promocode] Bootstrap failed:', e.message); }
}, 3000);

// POST /api/promocode/redeem
router.post('/redeem', authenticate, bonusGuard, async function(req, res) {
  try {
    var userId = req.user.id;

        // ROUND 34: Self-exclusion check (regulatory compliance)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [userId]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[SelfExcl] Check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }

    var code = (req.body.code || '').trim().toUpperCase().slice(0, 32);
    if (!code) return res.status(400).json({ error: 'Code is required' });

    // ROUND 55: Rate limit — max 10 promo attempts per 10 minutes per user
    // Prevents brute-force code guessing
    try {
        var recentAttempts = await db.get(
            "SELECT COUNT(*) as cnt FROM promo_redemptions WHERE user_id = ? AND redeemed_at >= datetime('now', '-10 minutes')",
            [userId]
        );
        if (recentAttempts && recentAttempts.cnt >= 10) {
            return res.status(429).json({ error: 'Too many promo code attempts. Please wait.' });
        }
    } catch (_rateErr) {
        // Table may not exist yet — continue (fail-open is acceptable for rate limiting)
    }

    var row = await db.get('SELECT id, code, expires_at, max_uses, reward_gems, reward_credits, reward_spins, active FROM promo_codes WHERE UPPER(code) = ? AND active = 1', [code]);
    if (!row) return res.status(404).json({ error: 'Invalid code' });

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code has expired' });
    }
    // ROUND 42: Wrap entire redemption in transaction — uses_count increment,
    // redemption record, and reward credit are all-or-nothing. Previously: uses_count
    // was incremented separately from redemption INSERT, creating race windows.
    await db.beginTransaction();
    try {
      // Atomic: increment uses_count only if under limit
      if (row.max_uses > 0) {
        var usesResult = await db.run(
          'UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ? AND uses_count < ?',
          [row.id, row.max_uses]
        );
        if (!usesResult || usesResult.changes === 0) {
          await db.rollback();
          return res.status(400).json({ error: 'Code has reached its usage limit' });
        }
      } else {
        await db.run('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ?', [row.id]);
      }

      // INSERT redemption with unique constraint — prevents double-redeem
      await db.run('INSERT INTO promo_redemptions (user_id, code_id) VALUES (?, ?)', [userId, row.id]);

      // Credit rewards
      if (row.reward_gems > 0) {
        await db.run('UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?', [row.reward_gems, userId]);
      }
      if (row.reward_credits > 0) {
        await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [row.reward_credits, row.reward_credits * 15, userId]);
        await db.run('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?)',
          [userId, 'promo', row.reward_credits, userId, userId, 'Promo code: ' + row.code + ' (bonus, 15x wagering)']);
      }

      await db.commit();
    } catch (txErr) {
      try { await db.rollback(); } catch(_rbErr) { console.warn('[PromoCode] rollback error:', _rbErr.message); }
      // UNIQUE constraint violation = already redeemed
      if (txErr.message && txErr.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'You have already redeemed this code' });
      }
      throw txErr;
    }

    var user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      reward: { gems: row.reward_gems, credits: row.reward_credits, spins: row.reward_spins },
      newBalance: user ? user.balance : 0
    });
  } catch(err) {
    console.warn('[PromoCode] Redemption error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/promocode/list — admin only
router.get('/list', authenticate, requireAdmin, async function(req, res) {
  try {
    var codes = await db.all('SELECT id, code, expires_at, max_uses, uses_count, reward_gems, reward_credits, reward_spins, active, created_at FROM promo_codes ORDER BY created_at DESC LIMIT 100');
    return res.json({ codes: codes });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/promocode/create — admin only
router.post('/create', authenticate, requireAdmin, async function(req, res) {
  try {
    var { code, type, reward_gems, reward_credits, reward_spins, max_uses, expires_at } = req.body;
    if (!code || !type) return res.status(400).json({ error: 'code and type are required' });
    var upper = code.trim().toUpperCase();
    await db.run(
      'INSERT INTO promo_codes (code, type, reward_gems, reward_credits, reward_spins, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [upper, type, reward_gems || 0, reward_credits || 0, reward_spins || 0, max_uses || 0, expires_at || null]
    );
    return res.json({ success: true, code: upper });
  } catch(err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Code already exists' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/promocode/deactivate — admin only
router.post('/deactivate', authenticate, requireAdmin, async function(req, res) {
  try {
    var id = parseInt(req.body.id, 10);
    if (!id) return res.status(400).json({ error: 'id required' });
    var result = await db.run('UPDATE promo_codes SET active = 0 WHERE id = ?', [id]);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Code not found' });
    }
    return res.json({ success: true });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/promocode/stats/:id — admin only — usage stats
router.get('/stats/:id', authenticate, requireAdmin, async function(req, res) {
  try {
    var id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id required' });
    var code = await db.get('SELECT id, code, uses_count, max_uses, reward_gems, reward_credits FROM promo_codes WHERE id = ?', [id]);
    if (!code) return res.status(404).json({ error: 'Not found' });
    var redemptions = await db.all(
      'SELECT user_id, redeemed_at FROM promo_redemptions WHERE code_id = ? ORDER BY redeemed_at DESC LIMIT 100',
      [id]
    );
    return res.json({ code: code, redemptions: redemptions });
  } catch(err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
