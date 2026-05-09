'use strict';

/**
 * Achievement Service — 30+ achievements across 4 categories.
 *
 * Categories:
 *   betting   — spin counts, big wins, bet sizes
 *   games     — variety / completionist
 *   social    — referrals, tournaments
 *   loyalty   — login streaks, VIP tiers, deposits
 *
 * XP from achievement points feeds into the VIP ladder.
 */

const db = require('../database');

const ACHIEVEMENTS = {
    // ── Betting ──────────────────────────────────────────────────────────
    first_spin:     { name: 'First Spin',        desc: 'Complete your first spin',        icon: '🎰', xp: 50,   points: 10,  category: 'betting' },
    ten_spins:      { name: 'Getting Started',   desc: 'Complete 10 spins',                icon: '🔟', xp: 100,  points: 20,  category: 'betting' },
    hundred_spins:  { name: 'Regular Player',    desc: 'Complete 100 spins',               icon: '💯', xp: 250,  points: 50,  category: 'betting' },
    thousand_spins: { name: 'Marathon Spinner',  desc: 'Complete 1,000 spins',             icon: '🏃', xp: 500,  points: 100, category: 'betting' },
    ten_k_spins:    { name: 'Veteran Spinner',   desc: 'Complete 10,000 spins',            icon: '🏆', xp: 1500, points: 300, category: 'betting' },
    first_win:      { name: 'Winner Winner',     desc: 'Win your first spin',              icon: '⭐', xp: 50,   points: 10,  category: 'betting' },
    big_win:        { name: 'Big Winner',        desc: 'Win 50x your bet or more',         icon: '💰', xp: 200,  points: 40,  category: 'betting' },
    mega_win:       { name: 'Mega Winner',       desc: 'Win 100x your bet or more',        icon: '🤑', xp: 500,  points: 100, category: 'betting' },
    epic_win:       { name: 'Epic Winner',       desc: 'Win 500x your bet or more',        icon: '🌟', xp: 1500, points: 300, category: 'betting' },
    high_roller:    { name: 'High Roller',       desc: 'Place a single bet of $5+',         icon: '💎', xp: 200,  points: 40,  category: 'betting' },
    whale_bet:      { name: 'Whale Bet',         desc: 'Place a single bet of $50+',        icon: '🐋', xp: 750,  points: 150, category: 'betting' },
    wager_500:      { name: 'Wager Warrior',     desc: 'Wager $500 total',                  icon: '⚔️', xp: 300,  points: 60,  category: 'betting' },
    wager_5k:       { name: 'Wager Legend',      desc: 'Wager $5,000 total',                icon: '🛡️', xp: 1000, points: 200, category: 'betting' },
    wager_50k:      { name: 'Wager Titan',       desc: 'Wager $50,000 total',               icon: '⚡', xp: 3000, points: 600, category: 'betting' },
    jackpot_winner: { name: 'Jackpot!',          desc: 'Win any jackpot',                   icon: '👑', xp: 1000, points: 200, category: 'betting' },

    // ── Games ────────────────────────────────────────────────────────────
    five_games:     { name: 'Explorer',          desc: 'Play 5 different games',            icon: '🗺️', xp: 150,  points: 30,  category: 'games' },
    ten_games:      { name: 'Adventurer',        desc: 'Play 10 different games',           icon: '🧭', xp: 300,  points: 60,  category: 'games' },
    twentyfive_games:{ name: 'Game Hunter',      desc: 'Play 25 different games',           icon: '🎯', xp: 600,  points: 120, category: 'games' },
    fifty_games:    { name: 'Game Master',       desc: 'Play 50 different games',           icon: '🎮', xp: 1200, points: 240, category: 'games' },
    hundred_games:  { name: 'Completionist',     desc: 'Play all 100 games',                icon: '💯', xp: 3000, points: 600, category: 'games' },
    feature_buy:    { name: 'Feature Buyer',     desc: 'Buy a bonus feature',               icon: '🎁', xp: 250,  points: 50,  category: 'games' },
    free_spin_win:  { name: 'Free Spin Hero',    desc: 'Win during free spins',              icon: '🎟️', xp: 200,  points: 40,  category: 'games' },

    // ── Social ───────────────────────────────────────────────────────────
    referral_made:  { name: 'Social Butterfly',  desc: 'Refer a friend who deposits',        icon: '🦋', xp: 300,  points: 60,  category: 'social' },
    referral_5:     { name: 'Influencer',        desc: 'Refer 5 friends who deposit',        icon: '📣', xp: 1000, points: 200, category: 'social' },
    tournament_join:{ name: 'Competitor',         desc: 'Join your first tournament',        icon: '🎖️', xp: 200,  points: 40,  category: 'social' },
    tournament_win: { name: 'Champion',           desc: 'Finish 1st in any tournament',      icon: '🏅', xp: 1000, points: 200, category: 'social' },
    tournament_top3:{ name: 'Podium Finisher',   desc: 'Finish top 3 in any tournament',    icon: '🥉', xp: 500,  points: 100, category: 'social' },
    leaderboard_top:{ name: 'Leaderboard Star',  desc: 'Reach top 10 on weekly leaderboard',icon: '⭐', xp: 600,  points: 120, category: 'social' },
    chat_friendly:  { name: 'Friendly',           desc: 'Send 10 chat messages',             icon: '💬', xp: 100,  points: 20,  category: 'social' },

    // ── Loyalty ──────────────────────────────────────────────────────────
    streak_3:       { name: 'Triple Threat',     desc: '3-day login streak',                icon: '3️⃣', xp: 100,  points: 20,  category: 'loyalty' },
    streak_7:       { name: 'Lucky 7',            desc: '7-day login streak',                icon: '7️⃣', xp: 250,  points: 50,  category: 'loyalty' },
    streak_30:      { name: 'Devoted',            desc: '30-day login streak',               icon: '📅', xp: 1500, points: 300, category: 'loyalty' },
    streak_100:     { name: 'Diehard',            desc: '100-day login streak',              icon: '🔥', xp: 5000, points: 1000,category: 'loyalty' },
    first_deposit:  { name: 'Investor',           desc: 'Make your first deposit',            icon: '💳', xp: 100,  points: 20,  category: 'loyalty' },
    deposit_5:      { name: 'Reliable Depositor',desc: 'Make 5 deposits',                    icon: '🏦', xp: 400,  points: 80,  category: 'loyalty' },
    wagering_done:  { name: 'Playthrough Complete', desc: 'Complete a wagering requirement',icon: '✅', xp: 250,  points: 50,  category: 'loyalty' },
    vip_silver:     { name: 'VIP Silver',          desc: 'Reach VIP Silver tier',            icon: '🥈', xp: 300,  points: 60,  category: 'loyalty' },
    vip_gold:       { name: 'VIP Gold',            desc: 'Reach VIP Gold tier',              icon: '🥇', xp: 500,  points: 100, category: 'loyalty' },
    vip_platinum:   { name: 'VIP Platinum',        desc: 'Reach VIP Platinum tier',          icon: '💎', xp: 1500, points: 300, category: 'loyalty' },
    vip_diamond:    { name: 'VIP Diamond',         desc: 'Reach VIP Diamond tier',           icon: '👑', xp: 5000, points: 1000,category: 'loyalty' }
};

/**
 * Grant an achievement to a user (idempotent — UNIQUE constraint prevents duplicates).
 * On first grant, also credits achievement_points → vip_xp.
 * Returns the achievement object with `newlyUnlocked: true` if newly granted, or null.
 */
async function grant(userId, achievementId) {
    if (!ACHIEVEMENTS[achievementId]) return null;
    try {
        const result = await db.run(
            'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
            [userId, achievementId]
        );
        if (!result || result.changes === 0) return null; // already unlocked

        const def = ACHIEVEMENTS[achievementId];
        // Credit achievement points + VIP XP atomically.
        try {
            await db.run(
                'UPDATE users SET achievement_points = COALESCE(achievement_points, 0) + ?, vip_xp = COALESCE(vip_xp, 0) + ?, vip_xp_lifetime = COALESCE(vip_xp_lifetime, 0) + ? WHERE id = ?',
                [def.points || 0, def.xp || 0, def.xp || 0, userId]
            );
        } catch (e) { /* schema columns might not exist on a fresh DB */ }

        try {
            await db.run(
                'INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)',
                [userId, 'achievement', 'Achievement Unlocked!', def.icon + ' ' + def.name + ' — ' + def.desc]
            );
        } catch (_) {}

        return Object.assign({ id: achievementId, newlyUnlocked: true }, def);
    } catch (e) {
        if (e.message && e.message.includes('duplicate')) return null;
        console.warn('[Achievement] grant error:', e.message);
        return null;
    }
}

/**
 * Check spin-based achievements after a spin completes.
 * Returns an array of newly unlocked achievements.
 */
async function checkSpinAchievements(userId, spinCount, winMultiplier, distinctGames, totalWagered, maxBet) {
    const unlocked = [];
    async function tryGrant(id) {
        const r = await grant(userId, id);
        if (r) unlocked.push(r);
    }

    if (spinCount >= 1)     await tryGrant('first_spin');
    if (spinCount >= 10)    await tryGrant('ten_spins');
    if (spinCount >= 100)   await tryGrant('hundred_spins');
    if (spinCount >= 1000)  await tryGrant('thousand_spins');
    if (spinCount >= 10000) await tryGrant('ten_k_spins');
    if (winMultiplier > 0)  await tryGrant('first_win');
    if (winMultiplier >= 50)  await tryGrant('big_win');
    if (winMultiplier >= 100) await tryGrant('mega_win');
    if (winMultiplier >= 500) await tryGrant('epic_win');
    if (distinctGames >= 5)   await tryGrant('five_games');
    if (distinctGames >= 10)  await tryGrant('ten_games');
    if (distinctGames >= 25)  await tryGrant('twentyfive_games');
    if (distinctGames >= 50)  await tryGrant('fifty_games');
    if (distinctGames >= 100) await tryGrant('hundred_games');

    const tw = totalWagered || 0;
    if (tw >= 500)   await tryGrant('wager_500');
    if (tw >= 5000)  await tryGrant('wager_5k');
    if (tw >= 50000) await tryGrant('wager_50k');

    const mb = maxBet || 0;
    if (mb >= 5)  await tryGrant('high_roller');
    if (mb >= 50) await tryGrant('whale_bet');

    return unlocked;
}

/**
 * Get all achievements for a user, with unlock state, progress hints, and reward info.
 */
async function getUserAchievements(userId) {
    const rows = await db.all(
        'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC',
        [userId]
    );
    const unlocked = {};
    rows.forEach(function (r) { unlocked[r.achievement_id] = r.unlocked_at; });

    // Pull progress stats once for the live progress bars.
    let stats = { spins: 0, distinctGames: 0, totalWagered: 0, deposits: 0, streak: 0 };
    try {
        const [spinCnt, gameCnt, wagered, depositCnt, userRow] = await Promise.all([
            db.get('SELECT COUNT(*) AS cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COUNT(DISTINCT game_id) AS cnt FROM spins WHERE user_id = ?', [userId]),
            db.get('SELECT COALESCE(SUM(bet_amount), 0) AS total FROM spins WHERE user_id = ?', [userId]),
            db.get("SELECT COUNT(*) AS cnt FROM deposits WHERE user_id = ? AND status = 'completed'", [userId]),
            db.get('SELECT COALESCE(streak_count, 0) AS s FROM users WHERE id = ?', [userId])
        ]);
        stats = {
            spins:        spinCnt    && spinCnt.cnt    != null ? Number(spinCnt.cnt)    : 0,
            distinctGames:gameCnt    && gameCnt.cnt    != null ? Number(gameCnt.cnt)    : 0,
            totalWagered: wagered    && wagered.total  != null ? Number(wagered.total)  : 0,
            deposits:     depositCnt && depositCnt.cnt != null ? Number(depositCnt.cnt) : 0,
            streak:       userRow    && userRow.s      != null ? Number(userRow.s)      : 0
        };
    } catch (_) {}

    const list = Object.keys(ACHIEVEMENTS).map(function (id) {
        const def = ACHIEVEMENTS[id];
        return Object.assign(
            { id: id, unlocked: !!unlocked[id], unlockedAt: unlocked[id] || null },
            def,
            { progress: _computeProgress(id, stats) }
        );
    });

    return {
        achievements: list,
        stats: {
            total: list.length,
            unlocked: Object.keys(unlocked).length,
            totalPoints: list.filter(function (a) { return a.unlocked; })
                .reduce(function (sum, a) { return sum + (a.points || 0); }, 0),
            totalXp: list.filter(function (a) { return a.unlocked; })
                .reduce(function (sum, a) { return sum + (a.xp || 0); }, 0)
        }
    };
}

function _computeProgress(id, s) {
    var map = {
        ten_spins:       { cur: s.spins,         goal: 10 },
        hundred_spins:   { cur: s.spins,         goal: 100 },
        thousand_spins:  { cur: s.spins,         goal: 1000 },
        ten_k_spins:     { cur: s.spins,         goal: 10000 },
        five_games:      { cur: s.distinctGames, goal: 5 },
        ten_games:       { cur: s.distinctGames, goal: 10 },
        twentyfive_games:{ cur: s.distinctGames, goal: 25 },
        fifty_games:     { cur: s.distinctGames, goal: 50 },
        hundred_games:   { cur: s.distinctGames, goal: 100 },
        wager_500:       { cur: s.totalWagered,  goal: 500 },
        wager_5k:        { cur: s.totalWagered,  goal: 5000 },
        wager_50k:       { cur: s.totalWagered,  goal: 50000 },
        deposit_5:       { cur: s.deposits,      goal: 5 },
        streak_3:        { cur: s.streak,        goal: 3 },
        streak_7:        { cur: s.streak,        goal: 7 },
        streak_30:       { cur: s.streak,        goal: 30 },
        streak_100:      { cur: s.streak,        goal: 100 }
    };
    if (!map[id]) return null;
    var p = map[id];
    return {
        current: p.cur,
        goal: p.goal,
        percent: Math.min(100, Math.floor((p.cur / p.goal) * 100))
    };
}

function getAllDefinitions() {
    return Object.keys(ACHIEVEMENTS).map(function (id) {
        return Object.assign({ id: id }, ACHIEVEMENTS[id]);
    });
}

module.exports = {
    ACHIEVEMENTS: ACHIEVEMENTS,
    grant: grant,
    checkSpinAchievements: checkSpinAchievements,
    getUserAchievements: getUserAchievements,
    getAllDefinitions: getAllDefinitions
};
