'use strict';
const db = require('../database');

// Achievement definitions
const ACHIEVEMENTS = {
    first_spin:     { name: 'First Spin',         desc: 'Complete your first spin',         icon: '🎰', xp: 50 },
    ten_spins:      { name: 'Getting Started',    desc: 'Complete 10 spins',                icon: '🔟', xp: 100 },
    hundred_spins:  { name: 'Regular Player',     desc: 'Complete 100 spins',               icon: '💯', xp: 250 },
    thousand_spins: { name: 'High Roller',        desc: 'Complete 1,000 spins',             icon: '🏆', xp: 500 },
    first_win:      { name: 'Winner Winner',      desc: 'Win your first spin',              icon: '⭐', xp: 50 },
    big_win:        { name: 'Big Winner',          desc: 'Win 50x your bet or more',         icon: '💰', xp: 200 },
    mega_win:       { name: 'Mega Winner',         desc: 'Win 100x your bet or more',        icon: '🤑', xp: 500 },
    jackpot_winner: { name: 'Jackpot!',            desc: 'Win any jackpot',                  icon: '👑', xp: 1000 },
    first_deposit:  { name: 'Investor',            desc: 'Make your first deposit',          icon: '💳', xp: 100 },
    vip_bronze:     { name: 'VIP Bronze',          desc: 'Reach VIP Bronze tier',            icon: '🥉', xp: 150 },
    vip_silver:     { name: 'VIP Silver',          desc: 'Reach VIP Silver tier',            icon: '🥈', xp: 300 },
    vip_gold:       { name: 'VIP Gold',            desc: 'Reach VIP Gold tier',              icon: '🥇', xp: 500 },
    five_games:     { name: 'Explorer',            desc: 'Play 5 different games',           icon: '🗺️', xp: 150 },
    ten_games:      { name: 'Adventurer',          desc: 'Play 10 different games',          icon: '🧭', xp: 300 },
    wagering_done:  { name: 'Playthrough Complete',desc: 'Complete a wagering requirement',  icon: '✅', xp: 250 },
    streak_7:       { name: 'Lucky 7',             desc: '7-day login streak',               icon: '7️⃣', xp: 200 },
    tournament_win: { name: 'Champion',            desc: 'Win a tournament',                 icon: '🏅', xp: 500 },
    referral_made:  { name: 'Social Butterfly',    desc: 'Refer a friend who deposits',      icon: '🦋', xp: 300 },
};

/**
 * Grant an achievement to a user (idempotent — UNIQUE constraint prevents duplicates).
 * Returns the achievement object with `newlyUnlocked: true` if newly granted, or null.
 */
async function grant(userId, achievementId) {
    if (!ACHIEVEMENTS[achievementId]) return null;
    try {
        const result = await db.run(
            `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)`,
            [userId, achievementId]
        );
        // Check if it was actually inserted (not ignored)
        if (result && result.changes > 0) {
            return { id: achievementId, ...ACHIEVEMENTS[achievementId], newlyUnlocked: true };
        }
        return null; // Already had it
    } catch (e) {
        // PG uses ON CONFLICT DO NOTHING instead of OR IGNORE
        // The query adapter handles this, but catch duplicate key errors gracefully
        if (e.message && e.message.includes('duplicate')) return null;
        console.warn('[Achievement] grant error:', e.message);
        return null;
    }
}

/**
 * Check spin-based achievements after a spin completes.
 * Returns an array of newly unlocked achievements.
 */
async function checkSpinAchievements(userId, spinCount, winMultiplier, distinctGames, totalWagered) {
    const unlocked = [];

    if (spinCount >= 1)    { const r = await grant(userId, 'first_spin');     if (r) unlocked.push(r); }
    if (spinCount >= 10)   { const r = await grant(userId, 'ten_spins');      if (r) unlocked.push(r); }
    if (spinCount >= 100)  { const r = await grant(userId, 'hundred_spins');  if (r) unlocked.push(r); }
    if (spinCount >= 1000) { const r = await grant(userId, 'thousand_spins'); if (r) unlocked.push(r); }
    if (winMultiplier > 0) { const r = await grant(userId, 'first_win');      if (r) unlocked.push(r); }
    if (winMultiplier >= 50)  { const r = await grant(userId, 'big_win');     if (r) unlocked.push(r); }
    if (winMultiplier >= 100) { const r = await grant(userId, 'mega_win');    if (r) unlocked.push(r); }
    if (distinctGames >= 5)   { const r = await grant(userId, 'five_games');  if (r) unlocked.push(r); }
    if (distinctGames >= 10)  { const r = await grant(userId, 'ten_games');   if (r) unlocked.push(r); }
    // VIP tier achievements — awarded once per lifetime wagering threshold
    const tw = totalWagered || 0;
    if (tw >= 5000)  { const r = await grant(userId, 'vip_bronze'); if (r) unlocked.push(r); }
    if (tw >= 10000) { const r = await grant(userId, 'vip_silver'); if (r) unlocked.push(r); }
    if (tw >= 20000) { const r = await grant(userId, 'vip_gold');   if (r) unlocked.push(r); }

    return unlocked;
}

/**
 * Get all achievements unlocked by a user, enriched with definition data.
 */
async function getUserAchievements(userId) {
    const rows = await db.all(
        `SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC`,
        [userId]
    );
    return rows.map(r => ({
        id: r.achievement_id,
        ...(ACHIEVEMENTS[r.achievement_id] || { name: r.achievement_id, desc: '', icon: '❓', xp: 0 }),
        unlockedAt: r.unlocked_at
    }));
}

/**
 * Get all achievement definitions (for displaying locked/unlocked state on the client).
 */
function getAllDefinitions() {
    return Object.entries(ACHIEVEMENTS).map(([id, def]) => ({ id, ...def }));
}

module.exports = { ACHIEVEMENTS, grant, checkSpinAchievements, getUserAchievements, getAllDefinitions };
