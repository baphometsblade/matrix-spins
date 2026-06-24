'use strict';
const db = require('../database');

// ── Battle Pass Configuration ──────────────────────────────────────────

const SEASON_DURATION_DAYS = 30;
const MAX_LEVEL = 50;
const PREMIUM_PRICE = 9.99;
const XP_PER_LEVEL_BASE = 100;  // Level 1 needs 100 XP, scales up
const XP_PER_SPIN = 5;          // Base XP per spin
const XP_BET_MULTIPLIER = 0.5;  // Extra XP per dollar bet

// Reward tiers: level -> { free: {type, amount}, premium: {type, amount} }
// Types: 'credits', 'free_spins', 'xp_boost', 'wheel_spins'
function getRewardTiers() {
    const tiers = [];
    for (let i = 1; i <= MAX_LEVEL; i++) {
        const free = {};
        const premium = {};

        if (i % 5 === 0) {
            // Every 5 levels: significant reward (reduced — was i*10 / i*30)
            free.type = 'credits'; free.amount = Math.round(i * 0.20 * 100) / 100;
            premium.type = 'credits'; premium.amount = Math.round(i * 0.50 * 100) / 100;
        } else if (i % 3 === 0) {
            // Every 3 levels: free spins
            free.type = 'free_spins'; free.amount = Math.ceil(i / 5);
            premium.type = 'free_spins'; premium.amount = Math.ceil(i / 3) + 2;
        } else if (i % 7 === 0) {
            // Every 7 levels: wheel spins
            free.type = 'wheel_spins'; free.amount = 1;
            premium.type = 'wheel_spins'; premium.amount = 2;
        } else if (i % 2 === 0) {
            // Even levels: small credits (reduced — was i*3 / i*8)
            free.type = 'credits'; free.amount = Math.round(i * 0.05 * 100) / 100;
            premium.type = 'credits'; premium.amount = Math.round(i * 0.15 * 100) / 100;
        } else {
            // Odd levels: XP boost or small credits (reduced — was i*5)
            free.type = null; free.amount = 0; // free track skips odd non-milestone levels
            premium.type = 'credits'; premium.amount = Math.round(i * 0.10 * 100) / 100;
        }

        tiers.push({ level: i, free, premium });
    }
    // Level 50 grand finale (reduced — was $1000 / $5000)
    tiers[49].free = { type: 'credits', amount: 10 };
    tiers[49].premium = { type: 'credits', amount: 50 };

    // Premium cosmetic unlocks at milestones — presentational only (zero delivery
    // cost, high perceived value). Ride along on the existing milestone credit
    // reward; the client renders/equips them. See unification design doc.
    for (const level of Object.keys(PREMIUM_COSMETICS)) {
        const t = tiers[Number(level) - 1];
        if (t && t.premium) t.premium.cosmetic = PREMIUM_COSMETICS[level];
    }
    return tiers;
}

// Cosmetic flair granted on the PREMIUM track at milestone levels.
const PREMIUM_COSMETICS = {
    10: 'Neon Frame',
    20: 'Matrix Avatar',
    30: 'Gold Win Effect',
    40: 'Diamond Frame',
    50: 'Legendary Matrix Set',
};

const REWARD_TIERS = getRewardTiers();

// ── Schema Init ─────────────────────────────────────────────────────────

async function initSchema() {
    const isPg  = db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';

    await db.run(`CREATE TABLE IF NOT EXISTS battle_pass_seasons (
        id ${idDef},
        name TEXT NOT NULL,
        starts_at ${tsType} NOT NULL,
        ends_at ${tsType} NOT NULL,
        status TEXT DEFAULT 'active'
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS battle_pass_progress (
        id ${idDef},
        user_id INTEGER NOT NULL,
        season_id INTEGER NOT NULL,
        level INTEGER DEFAULT 0,
        xp INTEGER DEFAULT 0,
        is_premium INTEGER DEFAULT 0,
        claimed_free TEXT DEFAULT '[]',
        claimed_premium TEXT DEFAULT '[]',
        UNIQUE(user_id, season_id)
    )`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nowIso() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function xpForLevel(level) {
    // Each level requires progressively more XP
    return Math.floor(XP_PER_LEVEL_BASE * (1 + (level - 1) * 0.15));
}

// ── Core Functions ──────────────────────────────────────────────────────

async function ensureActiveSeason() {
    await initSchema();
    const active = await db.get(
        "SELECT id FROM battle_pass_seasons WHERE status = 'active' AND ends_at > datetime('now')"
    );
    if (!active) {
        // Close any expired seasons
        await db.run(
            "UPDATE battle_pass_seasons SET status = 'completed' WHERE status = 'active' AND ends_at <= datetime('now')"
        );
        // Create new season
        const now = new Date();
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const name = monthNames[now.getMonth()] + ' ' + now.getFullYear() + ' Season';
        const starts = nowIso();
        const ends = new Date(Date.now() + SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000)
            .toISOString().replace('T', ' ').replace('Z', '');
        await db.run(
            "INSERT INTO battle_pass_seasons (name, starts_at, ends_at, status) VALUES (?, ?, ?, 'active')",
            [name, starts, ends]
        );
    }
}

async function getCurrentSeason() {
    await ensureActiveSeason();
    return db.get(
        "SELECT id, name, starts_at, ends_at, status FROM battle_pass_seasons WHERE status = 'active' AND ends_at > datetime('now') ORDER BY id DESC LIMIT 1"
    );
}

async function getProgress(userId) {
    const season = await getCurrentSeason();
    if (!season) return null;

    let progress = await db.get(
        "SELECT level, xp, is_premium, claimed_free, claimed_premium FROM battle_pass_progress WHERE user_id = ? AND season_id = ?",
        [userId, season.id]
    );
    if (!progress) {
        await db.run(
            "INSERT INTO battle_pass_progress (user_id, season_id) VALUES (?, ?)",
            [userId, season.id]
        );
        progress = { user_id: userId, season_id: season.id, level: 0, xp: 0, is_premium: 0, claimed_free: '[]', claimed_premium: '[]' };
    }

    const claimedFree = JSON.parse(progress.claimed_free || '[]');
    const claimedPremium = JSON.parse(progress.claimed_premium || '[]');
    const nextLevelXp = progress.level < MAX_LEVEL ? xpForLevel(progress.level + 1) : 0;

    return {
        season: { id: season.id, name: season.name, starts_at: season.starts_at, ends_at: season.ends_at },
        level: progress.level,
        xp: progress.xp,
        nextLevelXp,
        isPremium: !!progress.is_premium,
        claimedFree,
        claimedPremium,
        maxLevel: MAX_LEVEL,
        tiers: REWARD_TIERS,
        premiumPrice: PREMIUM_PRICE
    };
}

async function addXp(userId, betAmount) {
    const season = await getCurrentSeason();
    if (!season) return null;

    const xpGain = Math.max(1, Math.floor(XP_PER_SPIN + (betAmount || 0) * XP_BET_MULTIPLIER));

    let progress = await db.get(
        "SELECT level, xp FROM battle_pass_progress WHERE user_id = ? AND season_id = ?",
        [userId, season.id]
    );
    if (!progress) {
        await db.run("INSERT INTO battle_pass_progress (user_id, season_id) VALUES (?, ?)", [userId, season.id]);
        progress = { level: 0, xp: 0 };
    }

    let newXp = (progress.xp || 0) + xpGain;
    let newLevel = progress.level || 0;
    let levelsGained = 0;

    while (newLevel < MAX_LEVEL) {
        const needed = xpForLevel(newLevel + 1);
        if (newXp >= needed) {
            newXp -= needed;
            newLevel++;
            levelsGained++;
        } else {
            break;
        }
    }

    await db.run(
        "UPDATE battle_pass_progress SET xp = ?, level = ? WHERE user_id = ? AND season_id = ?",
        [newXp, newLevel, userId, season.id]
    );

    return { xpGain, newXp, newLevel, levelsGained, maxLevel: MAX_LEVEL };
}

async function buyPremium(userId) {
    const season = await getCurrentSeason();
    if (!season) throw new Error('No active season');

    // Check if already premium
    let progress = await db.get(
        "SELECT is_premium FROM battle_pass_progress WHERE user_id = ? AND season_id = ?",
        [userId, season.id]
    );
    if (progress && progress.is_premium) throw new Error('Already premium');

    // Check balance
    const user = await db.get("SELECT balance FROM users WHERE id = ?", [userId]);
    if (!user) throw new Error('User not found');
    if (user.balance < PREMIUM_PRICE) throw new Error('Insufficient balance');

    // Deduct balance (atomic with WHERE guard — prevents double-purchase race condition)
    const newBal = user.balance - PREMIUM_PRICE;
    const deductResult = await db.run("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?", [PREMIUM_PRICE, userId, PREMIUM_PRICE]);
    if (!deductResult || deductResult.changes === 0) throw new Error('Insufficient balance');

    // Log transaction
    await db.run(
        "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at) VALUES (?, 'battle_pass', ?, ?, ?, 'Premium Battle Pass', datetime('now'))",
        [userId, PREMIUM_PRICE, user.balance, newBal]
    );

    // Ensure progress row exists, then upgrade
    await db.run(
        "INSERT OR IGNORE INTO battle_pass_progress (user_id, season_id) VALUES (?, ?)",
        [userId, season.id]
    );
    await db.run(
        "UPDATE battle_pass_progress SET is_premium = 1 WHERE user_id = ? AND season_id = ?",
        [userId, season.id]
    );

    return { ok: true, newBalance: newBal };
}

async function claimReward(userId, level, track) {
    if (level < 1 || level > MAX_LEVEL) throw new Error('Invalid level');
    if (track !== 'free' && track !== 'premium') throw new Error('Invalid track');

    const season = await getCurrentSeason();
    if (!season) throw new Error('No active season');

    const progress = await db.get(
        "SELECT level, is_premium, claimed_free, claimed_premium FROM battle_pass_progress WHERE user_id = ? AND season_id = ?",
        [userId, season.id]
    );
    if (!progress) throw new Error('No progress found');
    if (progress.level < level) throw new Error('Level not reached');
    if (track === 'premium' && !progress.is_premium) throw new Error('Premium required');

    const claimedKey = track === 'free' ? 'claimed_free' : 'claimed_premium';
    const claimed = JSON.parse(progress[claimedKey] || '[]');
    if (claimed.includes(level)) throw new Error('Already claimed');

    const tier = REWARD_TIERS[level - 1];
    const reward = track === 'free' ? tier.free : tier.premium;
    if (!reward || !reward.type || reward.amount <= 0) throw new Error('No reward at this level');

    // Grant reward — credits go to bonus_balance with 20x wagering requirement
    let grantedAmount = reward.amount;
    if (reward.type === 'credits') {
        const wageringMult = 20;
        await db.run(
            "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?",
            [reward.amount, reward.amount * wageringMult, userId]
        );
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at) " +
            "VALUES (?, 'battle_pass_reward', ?, COALESCE((SELECT balance FROM users WHERE id = ?), 0), COALESCE((SELECT balance FROM users WHERE id = ?), 0), ?, datetime('now'))",
            [userId, reward.amount, userId, userId, 'BP Level ' + level + ' ' + track + ' (bonus, 20x wagering)']
        );
    }
    // For free_spins, wheel_spins: client handles via response data

    // Mark claimed
    claimed.push(level);
    await db.run(
        `UPDATE battle_pass_progress SET ${claimedKey} = ? WHERE user_id = ? AND season_id = ?`,
        [JSON.stringify(claimed), userId, season.id]
    );

    return { ok: true, reward: { type: reward.type, amount: grantedAmount, level, track, cosmetic: reward.cosmetic || null } };
}

// ── Leaderboard ──────────────────────────────────────────────────────────
// Top players in the CURRENT season, ranked by level then within-level XP.
// Read-only; drives competitive engagement (more spins → more house edge).
async function getLeaderboard(limit) {
    const season = await getCurrentSeason();
    if (!season) return [];
    const cap = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    // cap is a sanitized integer (1-100) — inlined to avoid backend LIMIT-bind quirks.
    const rows = await db.all(
        `SELECT u.id AS user_id, u.username, p.level, p.xp, p.is_premium
         FROM battle_pass_progress p
         JOIN users u ON u.id = p.user_id
         WHERE p.season_id = ?
         ORDER BY p.level DESC, p.xp DESC
         LIMIT ${cap}`,
        [season.id]
    );
    return (rows || []).map(function (r) {
        return {
            user_id: r.user_id,
            username: r.username,
            level: r.level,
            xp: r.xp,
            tier: r.is_premium ? 'premium' : 'free',
        };
    });
}

module.exports = {
    ensureActiveSeason, getCurrentSeason, getProgress, addXp,
    buyPremium, claimReward, getLeaderboard,
    PREMIUM_PRICE, MAX_LEVEL, REWARD_TIERS
};
