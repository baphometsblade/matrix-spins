'use strict';

const db = require('../database');

// ── Boost Definitions ───────────────────────────────────────────────────────

const BOOSTS = [
    { type: 'xp_surge', name: 'XP Surge', duration: 30, gemCost: 200, desc: '2x XP gain on all spins' },
    { type: 'bp_rush', name: 'Battle Pass Rush', duration: 30, gemCost: 300, desc: '2x Battle Pass XP' },
    { type: 'lucky_streak', name: 'Lucky Streak', duration: 60, gemCost: 500, desc: '+5% bonus on wins' },
    { type: 'gem_miner', name: 'Gem Miner', duration: 60, gemCost: 400, desc: 'Earn 1 gem per spin' },
    { type: 'mega_boost', name: 'Mega Boost', duration: 120, gemCost: 1000, desc: 'All boosts combined' }
];

// ── Schema Init ─────────────────────────────────────────────────────────────

async function initSchema() {

    const isPg = db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
    await db.run(`CREATE TABLE IF NOT EXISTS active_boosts (
        id ${idDef},
        user_id INTEGER NOT NULL,
        boost_type TEXT NOT NULL,
        started_at ${tsType} DEFAULT ${tsDefault},
        expires_at ${tsType} NOT NULL,
        created_at ${tsType} DEFAULT ${tsDefault}
    )`);
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Return the boost definitions array.
 */
function getBoostDefs() {
    return BOOSTS;
}

/**
 * Purchase a boost for a user, deducting gems.
 */
async function purchaseBoost(userId, boostType) {

    const boost = BOOSTS.find(b => b.type === boostType);
    if (!boost) throw new Error('Invalid boost type');

    // Atomic: gem spend + boost insert in single transaction
    const gemsService = require('./gems.service');
    const modifier = '+' + boost.duration + ' minutes';

    await db.beginTransaction();
    try {
        // Atomic gem deduction with WHERE guard (prevents double-spend)
        var spendResult = await db.run(
            "UPDATE gem_balances SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?",
            [boost.gemCost, boost.gemCost, userId, boost.gemCost]
        );
        if (!spendResult || spendResult.changes === 0) {
            await db.rollback().catch(function(rbErr) { console.warn('[Boost] Rollback failed:', rbErr.message); });
            throw new Error('Insufficient gem balance');
        }

        await db.run(
            "INSERT INTO gem_transactions (user_id, type, amount, description, created_at) VALUES (?, 'spend', ?, ?, datetime('now'))",
            [userId, -boost.gemCost, 'Boost: ' + boost.name]
        );

        // Insert active boost with expiry
        var result = await db.run(
            "INSERT INTO active_boosts (user_id, boost_type, expires_at) VALUES (?, ?, datetime('now', ?))",
            [userId, boost.type, modifier]
        );
        await db.commit();
    } catch (txErr) {
        await db.rollback().catch(function(rbErr) { console.warn('[Boost] Rollback failed:', rbErr.message); });
        throw txErr;
    }

    // Fetch the inserted row to get the actual expires_at
    const inserted = await db.get(
        'SELECT expires_at FROM active_boosts WHERE id = ?',
        [result.lastID || result.id]
    );

    return {
        success: true,
        boost: {
            type: boost.type,
            name: boost.name,
            expiresAt: inserted ? inserted.expires_at : null
        }
    };
}

/**
 * Get all active (non-expired) boosts for a user.
 */
async function getActiveBoosts(userId) {

    const rows = await db.all(
        "SELECT id, boost_type, started_at, expires_at FROM active_boosts WHERE user_id = ? AND expires_at > datetime('now')",
        [userId]
    );
    return rows;
}

/**
 * Check if user has an active boost of the given type.
 * mega_boost counts as having all boost types.
 */
async function hasBoost(userId, boostType) {

    const row = await db.get(
        "SELECT id FROM active_boosts WHERE user_id = ? AND (boost_type = ? OR boost_type = 'mega_boost') AND expires_at > datetime('now') LIMIT 1",
        [userId, boostType]
    );
    return !!row;
}

/**
 * Delete all expired boosts from the table.
 */
async function cleanExpired() {

    await db.run("DELETE FROM active_boosts WHERE expires_at <= datetime('now')");
}

module.exports = { initSchema, getBoostDefs, purchaseBoost, getActiveBoosts, hasBoost, cleanExpired };
