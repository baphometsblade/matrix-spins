'use strict';

// Level-Up Bonus Routes
// GET  /api/levelupbonus/status  -- authenticated; returns current level and whether bonus is claimable
// POST /api/levelupbonus/claim   -- authenticated; claim bonus for leveling up

const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard }   = require('../middleware/bonus-guard'); // ROUND 46

// XP thresholds matching the client-side level system
// Level = floor(sqrt(xp / 100)) + 1  (same formula used client-side)
function xpToLevel(xp) {
  return Math.floor(Math.sqrt((xp || 0) / 100)) + 1;
}

const BONUS_PER_LEVEL = 1.00; // $1.00 per level gained

// Schema bootstrap
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  try { await db.run('ALTER TABLE users ADD COLUMN last_bonus_level INTEGER DEFAULT 1'); } catch (_) {}
  schemaReady = true;
}

// GET /status
router.get('/status', authenticate, async function(req, res) {
  try {
    await ensureSchema();
    const userId = req.user.id;

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

    const user = await db.get('SELECT xp, last_bonus_level FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const currentLevel = xpToLevel(user.xp || 0);
    const lastBonusLevel = user.last_bonus_level || 1;
    const levelsGained = Math.max(0, currentLevel - lastBonusLevel);
    return res.json({
      currentLevel,
      lastBonusLevel,
      levelsGained,
      bonusAmount: parseFloat((levelsGained * BONUS_PER_LEVEL).toFixed(2)),
      claimable: levelsGained > 0,
    });
  } catch (err) {
    console.warn('[LevelUpBonus] GET /status error:', err.message);
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

// POST /claim
router.post('/claim', authenticate, bonusGuard, async function(req, res) { // ROUND 46: Added bonusGuard
  try {
    await ensureSchema();
    const userId = req.user.id;
    const user = await db.get('SELECT xp, last_bonus_level, balance FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const currentLevel = xpToLevel(user.xp || 0);
    const lastBonusLevel = user.last_bonus_level || 1;
    const levelsGained = Math.max(0, currentLevel - lastBonusLevel);
    if (levelsGained === 0) {
      return res.json({ success: false, message: 'No new levels to claim' });
    }
    const bonus = parseFloat((levelsGained * BONUS_PER_LEVEL).toFixed(2));
    // Atomic guard: only claim if last_bonus_level hasn't been updated by a concurrent request
    const claimGuard = await db.run(
      'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, last_bonus_level = ? WHERE id = ? AND (last_bonus_level IS NULL OR last_bonus_level < ?)',
      [bonus, bonus * 15, currentLevel, userId, currentLevel]
    );
    if (!claimGuard || claimGuard.changes === 0) {
      return res.json({ success: false, message: 'No new levels to claim' });
    }
    await db.run(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
      [userId, bonus, 'Level-up bonus: reached level ' + currentLevel + ' (bonus, 15x wagering)']
    );
    const updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    return res.json({
      success: true,
      levelsGained,
      bonus,
      newLevel: currentLevel,
      newBalance: updated ? parseFloat(updated.balance) : null,
    });
  } catch (err) {
    console.warn('[LevelUpBonus] POST /claim error:', err.message);
    return res.status(500).json({ error: 'Failed to claim bonus' });
  }
});

module.exports = router;
