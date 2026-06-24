'use strict';

/**
 * Battle Pass — user-facing HTTP API.
 *
 * UNIFICATION (2026-06-25): this route is a thin presentation layer over the
 * season-based service (server/services/battlepass.service.js), which is the
 * single source of truth for battle-pass progression. Spins award XP via
 * battlepassService.addXp (spin.routes.js), so delegating here means the
 * user-facing /api/battle-pass now reflects the XP that spins actually award.
 *
 * The previous pass-based implementation (battle_passes / battle_pass_user_progress
 * / battle_pass_purchases / battle_pass_claims / bp_xp_rate_log) is RETIRED: this
 * route no longer reads or writes those tables. Their CREATE TABLE definitions
 * remain inert in server/db/schema-*.js (not dropped — dropping live tables in a
 * multi-deploy money DB is needlessly destructive).
 *
 * Canonical model (from the service): 50 levels, cash $9.99 premium, free/premium
 * tracks, computed credit rewards (→ bonus_balance @ 20x wagering) + premium
 * cosmetic milestones, auto-rotating monthly seasons.
 *
 * See docs/superpowers/specs/2026-06-25-battle-pass-unification-design.md.
 */

const router = require('express').Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const db = require('../database');
const rateLimit = require('express-rate-limit');
const bp = require('../services/battlepass.service');

const purchaseLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many purchase attempts, please slow down' },
});

function userIdOf(req) {
    return req.user && (req.user.id || req.user.userId);
}

// Map service.getProgress(...) → canonical API shape. Emits service-native fields
// plus legacy aliases so any current/future client keeps working.
function toApiProgress(p) {
    if (!p) return null;
    const nextLevelXp = p.nextLevelXp || 0;
    const progressPct = nextLevelXp > 0
        ? Math.max(0, Math.min(100, Math.floor((p.xp / nextLevelXp) * 100)))
        : 100;
    const claimedFree = p.claimedFree || [];
    const claimedPremium = p.claimedPremium || [];
    return {
        active: true,
        season: p.season,
        season_number: p.season ? p.season.id : null,   // legacy alias
        name: p.season ? p.season.name : null,           // legacy alias
        level: p.level,
        current_level: p.level,                          // legacy alias
        xp: p.xp,                                         // XP within the current level
        next_level_xp: nextLevelXp,
        xp_for_next_level: nextLevelXp,                  // legacy alias
        progress_to_next_level: progressPct,
        max_level: p.maxLevel,
        tier: p.isPremium ? 'premium' : 'free',
        is_premium: p.isPremium,
        premium_price: p.premiumPrice,
        claimed_free: claimedFree,
        claimed_premium: claimedPremium,
        claimed_levels: Array.from(new Set(claimedFree.concat(claimedPremium))),
        tiers: p.tiers,
    };
}

// Self-exclusion gate for money-moving actions that don't run bonusGuard.
async function blockedBySelfExclusion(userId, res, noun) {
    try {
        const exclusion = await db.get(
            "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            res.status(403).json({ error: `Account is self-excluded. ${noun} are disabled.` });
            return true;
        }
    } catch (exclErr) {
        if (exclErr.message && exclErr.message.includes('no such table')) return false; // OK
        console.error('[BattlePass] Self-exclusion check failed:', exclErr.message);
        res.status(500).json({ error: 'Security check failed' });
        return true;
    }
    return false;
}

// GET / — public season basics (+ user progress if authenticated)
router.get('/', optionalAuth, async (req, res) => {
    try {
        const userId = userIdOf(req);
        if (userId) {
            const p = await bp.getProgress(userId);
            if (p) return res.json(toApiProgress(p));
        }
        const season = await bp.getCurrentSeason();
        if (!season) return res.json({ active: false, message: 'No active battle pass' });
        return res.json({
            active: true,
            season: { id: season.id, name: season.name, starts_at: season.starts_at, ends_at: season.ends_at },
            season_number: season.id,
            name: season.name,
            max_level: bp.MAX_LEVEL,
            premium_price: bp.PREMIUM_PRICE,
            tiers: bp.REWARD_TIERS,
        });
    } catch (err) {
        console.warn('[BattlePass] GET / error:', err.message);
        res.status(500).json({ error: 'Failed to load battle pass' });
    }
});

// GET /progress — authenticated user's detailed progress
router.get('/progress', authenticate, async (req, res) => {
    try {
        const p = await bp.getProgress(req.user.id);
        if (!p) return res.status(404).json({ error: 'No active battle pass' });
        res.json(toApiProgress(p));
    } catch (err) {
        console.warn('[BattlePass] GET /progress error:', err.message);
        res.status(500).json({ error: 'Failed to load progress' });
    }
});

// POST /purchase — buy the premium pass (cash $9.99). Elite tier is retired.
router.post('/purchase', authenticate, purchaseLimit, async (req, res) => {
    try {
        const userId = req.user.id;
        if (await blockedBySelfExclusion(userId, res, 'Purchases')) return;

        const tier = req.body && req.body.tier;
        if (tier && tier !== 'premium') {
            return res.status(400).json({ error: 'Invalid tier. Only "premium" is available.' });
        }

        let result;
        try {
            result = await bp.buyPremium(userId);
        } catch (buyErr) {
            const msg = buyErr.message || 'Purchase failed';
            if (msg === 'Already premium') return res.status(400).json({ error: msg });
            if (msg === 'Insufficient balance') return res.status(400).json({ error: msg });
            if (msg === 'No active season') return res.status(404).json({ error: 'No active battle pass' });
            throw buyErr;
        }

        res.json({
            success: true,
            tier: 'premium',
            price: bp.PREMIUM_PRICE,
            new_balance: result.newBalance,
        });
    } catch (err) {
        console.warn('[BattlePass] POST /purchase error:', err.message);
        res.status(500).json({ error: 'Purchase failed' });
    }
});

// POST /claim — claim a reward for a reached level on a track (free|premium)
router.post('/claim', authenticate, bonusGuard, async (req, res) => {
    try {
        const userId = req.user.id;
        const level = req.body && req.body.level;
        const track = (req.body && req.body.track) || 'free';

        if (!Number.isInteger(level) || level < 1 || level > bp.MAX_LEVEL) {
            return res.status(400).json({ error: `Invalid level. Must be 1-${bp.MAX_LEVEL}.` });
        }
        if (track !== 'free' && track !== 'premium') {
            return res.status(400).json({ error: 'Invalid track. Must be free or premium.' });
        }

        let result;
        try {
            result = await bp.claimReward(userId, level, track);
        } catch (claimErr) {
            const msg = claimErr.message || 'Claim failed';
            // Expected business-rule rejections → 400 (not a server error)
            const businessRules = [
                'Invalid level', 'Invalid track', 'No active season', 'No progress found',
                'Level not reached', 'Premium required', 'Already claimed', 'No reward at this level',
            ];
            if (businessRules.includes(msg)) return res.status(400).json({ error: msg });
            throw claimErr;
        }

        res.json({
            success: true,
            level,
            track,
            reward: result.reward,
        });
    } catch (err) {
        console.warn('[BattlePass] POST /claim error:', err.message);
        res.status(500).json({ error: 'Claim failed' });
    }
});

// GET /leaderboard — top players in the current season (public)
router.get('/leaderboard', optionalAuth, async (req, res) => {
    try {
        const leaderboard = await bp.getLeaderboard(req.query && req.query.limit);
        res.json({ leaderboard });
    } catch (err) {
        console.warn('[BattlePass] GET /leaderboard error:', err.message);
        res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});

// POST /add-xp — DEPRECATED no-op. XP is awarded server-side on every spin
// (spin.routes.js → battlepassService.addXp). A client-driven add-xp would
// double-count and was an XP-farming vector, so it no longer mutates state.
// Returns current progress for backward compatibility.
router.post('/add-xp', authenticate, async (req, res) => {
    try {
        const p = await bp.getProgress(req.user.id);
        res.json({
            success: true,
            deprecated: true,
            message: 'XP is awarded automatically from gameplay; this endpoint no longer adds XP.',
            total_xp: p ? p.xp : 0,
            current_level: p ? p.level : 0,
        });
    } catch (err) {
        console.warn('[BattlePass] POST /add-xp error:', err.message);
        res.status(500).json({ error: 'Failed to load progress' });
    }
});

module.exports = router;
