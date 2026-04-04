'use strict';

const db = require('../database');

// ── Gem Pack Definitions ─────────────────────────────────────────────────────

const GEM_PACKS = [
    { id: 'starter', price: 4.99, gems: 500, bonus: 0 },
    { id: 'value', price: 9.99, gems: 1100, bonus: 10 },
    { id: 'premium', price: 24.99, gems: 3000, bonus: 20 },
    { id: 'elite', price: 49.99, gems: 6500, bonus: 30 },
    { id: 'whale', price: 99.99, gems: 14000, bonus: 40 },
];

// ── Schema Init ──────────────────────────────────────────────────────────────

async function initSchema() {
    const isPg      = !!process.env.DATABASE_URL;
    const tsType    = isPg ? 'TIMESTAMPTZ' : 'TEXT';
    const tsDefault = isPg ? 'NOW()' : "(datetime('now'))";
    const idDef     = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await db.run(`CREATE TABLE IF NOT EXISTS gem_balances (
        user_id INTEGER PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        total_purchased INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0,
        updated_at ${tsType}
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS gem_transactions (
        id ${idDef},
        user_id INTEGER,
        type TEXT,
        amount INTEGER,
        description TEXT,
        created_at ${tsType} DEFAULT ${tsDefault}
    )`);
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Get the gem balance for a user. If no row exists, insert one with 0.
 */
async function getBalance(userId) {

    let row = await db.get('SELECT balance FROM gem_balances WHERE user_id = ?', [userId]);
    if (!row) {
        await db.run(
            "INSERT INTO gem_balances (user_id, balance, total_purchased, total_spent, updated_at) VALUES (?, 0, 0, 0, datetime('now'))",
            [userId]
        );
        row = { balance: 0 };
    }
    return { gems: row.balance };
}

/**
 * Purchase a gem pack using the user's credit balance.
 */
async function purchaseGems(userId, packId) {

    const pack = GEM_PACKS.find(p => p.id === packId);
    if (!pack) throw new Error('Invalid gem pack');

    // Wrap entire purchase in transaction — if gem credit or log INSERT
    // fails after balance deduction, everything rolls back (no lost funds)
    await db.beginTransaction();
    try {
        // Atomic balance deduction — prevents race condition double-purchase
        const deductResult = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [pack.price, userId, pack.price]
        );
        if (!deductResult || deductResult.changes === 0) {
            await db.rollback();
            throw new Error('Insufficient credit balance');
        }

        // Calculate total gems including bonus
        const bonusGems = pack.bonus > 0 ? Math.floor(pack.gems * pack.bonus / 100) : 0;
        const totalGems = pack.gems + bonusGems;

        // Upsert gem balance
        const existing = await db.get('SELECT balance FROM gem_balances WHERE user_id = ?', [userId]);
        if (existing) {
            await db.run(
                "UPDATE gem_balances SET balance = balance + ?, total_purchased = total_purchased + ?, updated_at = datetime('now') WHERE user_id = ?",
                [totalGems, totalGems, userId]
            );
        } else {
            await db.run(
                "INSERT INTO gem_balances (user_id, balance, total_purchased, total_spent, updated_at) VALUES (?, ?, ?, 0, datetime('now'))",
                [userId, totalGems, totalGems]
            );
        }

        // Log gem transaction
        await db.run(
            "INSERT INTO gem_transactions (user_id, type, amount, description, created_at) VALUES (?, 'purchase', ?, ?, datetime('now'))",
            [userId, totalGems, 'Purchased ' + pack.id + ' pack (' + pack.gems + ' + ' + bonusGems + ' bonus)']
        );

        await db.commit();

        // Get updated balances (outside transaction — read-only)
        const updatedGems = await db.get('SELECT balance FROM gem_balances WHERE user_id = ?', [userId]);
        const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);

        return {
            success: true,
            gemsAdded: totalGems,
            newGemBalance: updatedGems ? updatedGems.balance : totalGems,
            newCreditBalance: updatedUser ? updatedUser.balance : 0,
        };
    } catch (txErr) {
        try { await db.rollback(); } catch (rbErr) { console.warn('[Gems] Purchase rollback failed:', rbErr.message); }
        throw txErr;
    }
}

/**
 * Spend gems (e.g. for in-game purchases).
 */
async function spendGems(userId, amount, description) {

    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid gem amount');

    // Atomic gem deduction + audit log in single transaction
    await db.beginTransaction();
    try {
        const spendResult = await db.run(
            "UPDATE gem_balances SET balance = balance - ?, total_spent = total_spent + ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?",
            [amount, amount, userId, amount]
        );
        if (!spendResult || spendResult.changes === 0) {
            await db.rollback().catch(function(rbErr) { console.warn('[Gems] Rollback failed:', rbErr.message); });
            throw new Error('Insufficient gem balance');
        }

        await db.run(
            "INSERT INTO gem_transactions (user_id, type, amount, description, created_at) VALUES (?, 'spend', ?, ?, datetime('now'))",
            [userId, -amount, description || 'Gem spend']
        );
        await db.commit();
    } catch (txErr) {
        await db.rollback().catch(function(rbErr) { console.warn('[Gems] spendGems rollback failed:', rbErr.message); });
        throw txErr;
    }

    const updated = await db.get('SELECT balance FROM gem_balances WHERE user_id = ?', [userId]);
    return { success: true, newBalance: updated ? updated.balance : 0 };
}

/**
 * Add gems as a reward (e.g. achievements, daily bonus, etc.).
 */
async function addGems(userId, amount, description) {

    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid gem amount');

    // Atomic upsert — INSERT or UPDATE in one statement, prevents race condition duplicate inserts
    await db.run(
        "INSERT INTO gem_balances (user_id, balance, total_purchased, total_spent, updated_at) VALUES (?, ?, 0, 0, datetime('now')) " +
        "ON CONFLICT(user_id) DO UPDATE SET balance = gem_balances.balance + ?, updated_at = datetime('now')",
        [userId, amount, amount]
    );

    await db.run(
        "INSERT INTO gem_transactions (user_id, type, amount, description, created_at) VALUES (?, 'reward', ?, ?, datetime('now'))",
        [userId, amount, description || 'Gem reward']
    );

    const updated = await db.get('SELECT balance FROM gem_balances WHERE user_id = ?', [userId]);
    return { success: true, newBalance: updated ? updated.balance : 0 };
}

/**
 * Get recent gem transaction history for a user.
 */
async function getHistory(userId, limit = 20) {

    const rows = await db.all(
        'SELECT id, type, amount, description, created_at FROM gem_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, limit]
    );
    return rows;
}

module.exports = { GEM_PACKS, initSchema, getBalance, purchaseGems, spendGems, addGems, getHistory };
