'use strict';
const db = require('../database');
const config = require('../config');

/**
 * Get available bundles with calculated values
 */
function getAvailableBundles() {
    return (config.SPIN_BUNDLES || []).map(b => ({
        id: b.id,
        name: b.name,
        price: b.price,
        credits: b.credits,
        bonusCredits: Math.round(b.credits * b.bonusPct / 100),
        totalCredits: b.credits + Math.round(b.credits * b.bonusPct / 100),
        bonusPct: b.bonusPct,
        bonusWheelSpins: b.bonusWheelSpins,
        badge: b.badge,
        valuePerDollar: ((b.credits + Math.round(b.credits * b.bonusPct / 100)) / b.price).toFixed(1)
    }));
}

/**
 * Purchase a bundle - adds credits to balance with wagering requirement
 */
async function purchaseBundle(userId, bundleId) {
    const bundle = (config.SPIN_BUNDLES || []).find(b => b.id === bundleId);
    if (!bundle) throw new Error('Bundle not found');

    // Get user
    const user = await db.get('SELECT id, balance, bonus_balance, wagering_requirement FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');

    // Calculate credits
    const baseCredits = bundle.credits;
    const bonusCredits = Math.round(bundle.credits * bundle.bonusPct / 100);
    const totalCredits = baseCredits + bonusCredits;

    // Base credits go to real balance, bonus credits go to bonus_balance with wagering
    const wageringReq = bonusCredits * 15; // 15x wagering on bonus portion

    await db.run(`UPDATE users SET balance = balance + ?, bonus_balance = bonus_balance + ?,
                   wagering_requirement = wagering_requirement + ? WHERE id = ?`,
        [baseCredits, bonusCredits, wageringReq, userId]);

    // Log the purchase transaction
    const updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    await db.run(`
        INSERT INTO transactions (user_id, type, amount, balance_after, reference, created_at)
        VALUES (?, 'bundle_purchase', ?, ?, ?, datetime('now'))
    `, [userId, bundle.price, updated ? updated.balance : 0,
        'Bundle: ' + bundle.name + ' ($' + baseCredits + ' + $' + bonusCredits + ' bonus)']);

    // Record deposit for tracking
    await db.run(`
        INSERT INTO deposits (user_id, amount, method, status, created_at)
        VALUES (?, ?, 'bundle', 'completed', datetime('now'))
    `, [userId, bundle.price]);

    return {
        bundleId: bundle.id,
        bundleName: bundle.name,
        price: bundle.price,
        creditsAdded: baseCredits,
        bonusAdded: bonusCredits,
        totalAdded: totalCredits,
        wageringRequired: wageringReq,
        bonusWheelSpins: bundle.bonusWheelSpins,
        newBalance: updated ? updated.balance : 0
    };
}

/**
 * Get purchase history for a user
 */
async function getPurchaseHistory(userId) {
    const rows = await db.all(`
        SELECT amount, reference, created_at FROM transactions
        WHERE user_id = ? AND type = 'bundle_purchase'
        ORDER BY created_at DESC LIMIT 20
    `, [userId]);
    return rows;
}

module.exports = { getAvailableBundles, purchaseBundle, getPurchaseHistory };
