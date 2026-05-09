'use strict';

/**
 * Public profile + customization
 *   GET  /api/profile/:username       — public profile (respects privacy)
 *   GET  /api/profile/me              — current user (authenticated)
 *   PUT  /api/profile/me              — update display_name, bio, avatar, privacy
 *   GET  /api/profile/avatars         — list 20 preset Matrix-themed avatars
 */

const express = require('express');
const db = require('../database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Migrations ──────────────────────────────────────────────
[
    'bio TEXT',
    "profile_visibility TEXT DEFAULT 'public'",
    'show_on_leaderboard INTEGER DEFAULT 1',
    'show_activity_feed INTEGER DEFAULT 1',
    'profile_avatar_id TEXT',
].forEach(function(colDef) {
    db.run('ALTER TABLE users ADD COLUMN ' + colDef).catch(function(e) {
        if (e && !String(e.message || e).match(/duplicate column|already exists|no such table/i)) {
            console.warn('[Profile] users ALTER failed:', e.message || e);
        }
    });
});

// ─── 20 Matrix-themed preset avatars ─────────────────────────
const PRESET_AVATARS = [
    { id: 'neo',         name: 'Neo',          emoji: '🕶️', color: '#00FF41' },
    { id: 'trinity',     name: 'Trinity',      emoji: '🐈‍⬛', color: '#9D00FF' },
    { id: 'morpheus',    name: 'Morpheus',     emoji: '💊', color: '#FF0040' },
    { id: 'oracle',      name: 'Oracle',       emoji: '🔮', color: '#FFB000' },
    { id: 'agent',       name: 'Agent',        emoji: '🕴️', color: '#1A1A1A' },
    { id: 'glitch',      name: 'Glitch',       emoji: '⚡', color: '#00E0FF' },
    { id: 'cipher',      name: 'Cipher',       emoji: '🧬', color: '#7CFC00' },
    { id: 'sentinel',    name: 'Sentinel',     emoji: '🛸', color: '#FF6B00' },
    { id: 'architect',   name: 'Architect',    emoji: '🏛️', color: '#C0C0C0' },
    { id: 'redpill',     name: 'Red Pill',     emoji: '💉', color: '#FF1744' },
    { id: 'bluepill',    name: 'Blue Pill',    emoji: '💊', color: '#2979FF' },
    { id: 'codestream',  name: 'Code Stream',  emoji: '〰️', color: '#39FF14' },
    { id: 'phantom',     name: 'Phantom',      emoji: '👤', color: '#4B0082' },
    { id: 'hacker',      name: 'Hacker',       emoji: '💻', color: '#0AE0A0' },
    { id: 'ronin',       name: 'Ronin',        emoji: '⚔️', color: '#D4A017' },
    { id: 'spectre',     name: 'Spectre',      emoji: '👁️', color: '#8A2BE2' },
    { id: 'wraith',      name: 'Wraith',       emoji: '💀', color: '#A0A0A0' },
    { id: 'whale',       name: 'Whale',        emoji: '🐋', color: '#1E90FF' },
    { id: 'vipgold',     name: 'VIP Gold',     emoji: '👑', color: '#FFD700' },
    { id: 'matrixking',  name: 'Matrix King',  emoji: '🌀', color: '#00FFAA' },
];

// ─── Helpers ─────────────────────────────────────────────────
function isUsernameSafe(s) {
    return typeof s === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(s);
}

function publicShape(u) {
    return {
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarId: u.profile_avatar_id || null,
        avatar: PRESET_AVATARS.find(a => a.id === u.profile_avatar_id) || null,
        bio: u.bio || '',
        joinedAt: u.created_at || null,
        isVip: !!u.subscription_active,
        vipTier: u.subscription_tier || null,
        showOnLeaderboard: !!u.show_on_leaderboard,
        showActivityFeed: !!u.show_activity_feed,
    };
}

async function getStatsBlock(userId) {
    const totals = await db.get(
        `SELECT COUNT(*) AS spins,
                COALESCE(SUM(bet_amount), 0) AS wagered,
                COALESCE(MAX(win_amount), 0) AS biggest_win,
                COALESCE(MAX(CASE WHEN bet_amount > 0 THEN win_amount / bet_amount ELSE 0 END), 0) AS biggest_mult
         FROM spins WHERE user_id = ?`,
        [userId]
    ).catch(() => null);
    return {
        totalSpins: totals ? Number(totals.spins) || 0 : 0,
        totalWagered: totals ? Number(totals.wagered) || 0 : 0,
        biggestWin: totals ? Number(totals.biggest_win) || 0 : 0,
        biggestMultiplier: totals ? Number(totals.biggest_mult) || 0 : 0,
    };
}

async function getAchievements(userId) {
    try {
        return await db.all(
            `SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC LIMIT 12`,
            [userId]
        );
    } catch (_) { return []; }
}

async function isFriend(viewerId, profileUserId) {
    if (!viewerId || viewerId === profileUserId) return false;
    try {
        const row = await db.get(
            `SELECT id FROM friendships
             WHERE status = 'accepted'
               AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
             LIMIT 1`,
            [viewerId, profileUserId, profileUserId, viewerId]
        );
        return !!row;
    } catch (_) { return false; }
}

// ─── GET /api/profile/avatars ────────────────────────────────
router.get('/avatars', (req, res) => {
    res.json({ avatars: PRESET_AVATARS });
});

// ─── GET /api/profile/me ─────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
    try {
        const u = await db.get(
            `SELECT id, username, email, display_name, bio, profile_avatar_id, profile_visibility,
                    show_on_leaderboard, show_activity_feed, subscription_active, subscription_tier,
                    created_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        if (!u) return res.status(404).json({ error: 'User not found' });
        const stats = await getStatsBlock(u.id);
        const achievements = await getAchievements(u.id);
        res.json({
            profile: publicShape(u),
            email: u.email,
            privacy: {
                visibility: u.profile_visibility || 'public',
                showOnLeaderboard: !!u.show_on_leaderboard,
                showActivityFeed: !!u.show_activity_feed,
            },
            stats,
            achievements,
        });
    } catch (err) {
        logger.error('Profile me failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

// ─── PUT /api/profile/me ─────────────────────────────────────
router.put('/me', authenticate, async (req, res) => {
    try {
        const { displayName, bio, avatarId, profileVisibility, showOnLeaderboard, showActivityFeed } = req.body || {};
        const updates = [];
        const params = [];

        if (displayName !== undefined) {
            if (displayName !== null && (typeof displayName !== 'string' || displayName.length > 30)) {
                return res.status(400).json({ error: 'Display name must be ≤ 30 chars' });
            }
            updates.push('display_name = ?');
            params.push(displayName ? String(displayName).trim() : null);
        }
        if (bio !== undefined) {
            if (bio !== null && (typeof bio !== 'string' || bio.length > 280)) {
                return res.status(400).json({ error: 'Bio must be ≤ 280 chars' });
            }
            updates.push('bio = ?');
            params.push(bio ? String(bio).trim() : null);
        }
        if (avatarId !== undefined) {
            if (avatarId !== null && !PRESET_AVATARS.find(a => a.id === avatarId)) {
                return res.status(400).json({ error: 'Invalid avatar id' });
            }
            updates.push('profile_avatar_id = ?');
            params.push(avatarId || null);
        }
        if (profileVisibility !== undefined) {
            const v = String(profileVisibility).toLowerCase();
            if (!['public', 'friends', 'private'].includes(v)) {
                return res.status(400).json({ error: 'Invalid profile_visibility' });
            }
            updates.push('profile_visibility = ?');
            params.push(v);
        }
        if (showOnLeaderboard !== undefined) {
            updates.push('show_on_leaderboard = ?');
            params.push(showOnLeaderboard ? 1 : 0);
        }
        if (showActivityFeed !== undefined) {
            updates.push('show_activity_feed = ?');
            params.push(showActivityFeed ? 1 : 0);
        }

        if (!updates.length) return res.status(400).json({ error: 'No changes provided' });

        params.push(req.user.id);
        await db.run('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?', params);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Profile update failed', { error: err.message });
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ─── GET /api/profile/:username ──────────────────────────────
router.get('/:username', optionalAuth, async (req, res) => {
    try {
        const username = String(req.params.username || '');
        if (!isUsernameSafe(username)) return res.status(400).json({ error: 'Invalid username' });

        const u = await db.get(
            `SELECT id, username, display_name, bio, profile_avatar_id, profile_visibility,
                    show_on_leaderboard, show_activity_feed, subscription_active, subscription_tier,
                    is_banned, created_at
             FROM users WHERE username = ?`,
            [username]
        );
        if (!u || u.is_banned) return res.status(404).json({ error: 'User not found' });

        const viewerId = req.user ? req.user.id : null;
        const isSelf = viewerId === u.id;
        const visibility = (u.profile_visibility || 'public');

        if (!isSelf && visibility === 'private') {
            return res.status(403).json({ error: 'Profile is private' });
        }
        if (!isSelf && visibility === 'friends') {
            const friend = await isFriend(viewerId, u.id);
            if (!friend) return res.status(403).json({ error: 'Profile is friends-only' });
        }

        const stats = await getStatsBlock(u.id);
        const achievements = await getAchievements(u.id);

        res.json({
            profile: publicShape(u),
            stats,
            achievements,
            isSelf,
        });
    } catch (err) {
        logger.error('Public profile failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

module.exports = router;
module.exports.PRESET_AVATARS = PRESET_AVATARS;
