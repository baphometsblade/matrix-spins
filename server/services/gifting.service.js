'use strict';
const db = require('../database');
const config = require('../config');

const GIFT_CONFIG = config.GIFTING;

/**
 * Send a chip gift from one player to another.
 * Validates balance, daily limits, and amount constraints.
 */
async function sendGift(fromUserId, toUsername, amount, message) {
    if (!toUsername || typeof toUsername !== 'string') {
        throw new Error('Recipient username is required');
    }
    if (!amount || typeof amount !== 'number' || amount <= 0) {
        throw new Error('Invalid gift amount');
    }
    if (amount < GIFT_CONFIG.MIN_AMOUNT) {
        throw new Error(`Minimum gift amount is $${GIFT_CONFIG.MIN_AMOUNT}`);
    }
    if (amount > GIFT_CONFIG.MAX_AMOUNT) {
        throw new Error(`Maximum gift amount is $${GIFT_CONFIG.MAX_AMOUNT}`);
    }

    const trimmedUsername = toUsername.trim();

    // Look up recipient
    const recipient = await db.get(
        'SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)',
        [trimmedUsername]
    );
    if (!recipient) {
        throw new Error('Recipient not found');
    }
    if (recipient.id === fromUserId) {
        throw new Error('Cannot send a gift to yourself');
    }

    // Check sender balance
    const sender = await db.get(
        'SELECT id, username, balance FROM users WHERE id = ?',
        [fromUserId]
    );
    if (!sender) {
        throw new Error('Sender not found');
    }
    if (sender.balance < amount) {
        throw new Error('Insufficient balance');
    }

    // Enforce daily limits: count and total for today
    const todayGifts = await db.get(`
        SELECT COUNT(*) AS gift_count, COALESCE(SUM(amount), 0) AS gift_total
        FROM gifts
        WHERE from_user_id = ?
          AND created_at >= datetime('now', '-1 day')
    `, [fromUserId]);

    const giftCount = todayGifts ? todayGifts.gift_count : 0;
    const giftTotal = todayGifts ? todayGifts.gift_total : 0;

    if (giftCount >= GIFT_CONFIG.DAILY_LIMIT) {
        throw new Error(`Daily gift limit reached (max ${GIFT_CONFIG.DAILY_LIMIT} gifts per day)`);
    }
    if (giftTotal + amount > GIFT_CONFIG.DAILY_MAX_TOTAL) {
        const remaining = GIFT_CONFIG.DAILY_MAX_TOTAL - giftTotal;
        throw new Error(`Daily gift total limit exceeded. You can send up to $${remaining.toFixed(2)} more today`);
    }

    // Sanitize message
    const safeMessage = (message || '').toString().substring(0, 200).trim();

    // Deduct from sender
    await db.run(
        'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
        [amount, fromUserId, amount]
    );

    // Create gift record
    const result = await db.run(`
        INSERT INTO gifts (from_user_id, to_user_id, amount, message, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now'))
    `, [fromUserId, recipient.id, amount, safeMessage]);

    // Log transaction for audit
    const updatedSender = await db.get('SELECT balance FROM users WHERE id = ?', [fromUserId]);
    await db.run(`
        INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at)
        VALUES (?, 'gift_sent', ?, ?, ?, ?, datetime('now'))
    `, [fromUserId, -amount, sender.balance, updatedSender.balance,
        'Gift to ' + recipient.username]);

    console.warn('[Gifting] %s sent $%s to %s', sender.username, amount.toFixed(2), recipient.username);

    return {
        giftId: result.lastInsertRowid,
        toUsername: recipient.username,
        amount,
        message: safeMessage,
        newBalance: updatedSender.balance,
    };
}

/**
 * Get unclaimed gifts for a user.
 */
async function getPendingGifts(userId) {
    const rows = await db.all(`
        SELECT g.id, g.amount, g.message, g.created_at,
               u.username AS from_username, u.display_name AS from_display_name
        FROM gifts g
        JOIN users u ON g.from_user_id = u.id
        WHERE g.to_user_id = ? AND g.status = 'pending'
        ORDER BY g.created_at DESC
    `, [userId]);
    return rows.map(function formatPendingGift(r) {
        return {
            id: r.id,
            amount: r.amount,
            message: r.message,
            from: r.from_display_name || r.from_username,
            createdAt: r.created_at,
        };
    });
}

/**
 * Claim a pending gift, crediting the amount to the recipient.
 */
async function claimGift(giftId, userId) {
    const gift = await db.get(
        'SELECT id, from_user_id, to_user_id, amount, status FROM gifts WHERE id = ?',
        [giftId]
    );
    if (!gift) {
        throw new Error('Gift not found');
    }
    if (gift.to_user_id !== userId) {
        throw new Error('This gift is not addressed to you');
    }
    if (gift.status !== 'pending') {
        throw new Error('Gift has already been claimed');
    }

    // Credit recipient — bonus_balance with 15x wagering (prevents chip dumping/laundering)
    await db.run(
        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
        [gift.amount, gift.amount * 15, userId]
    );

    // Mark gift as claimed
    await db.run(
        "UPDATE gifts SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?",
        [giftId]
    );

    // Log transaction for audit
    const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
    const sender = await db.get('SELECT username FROM users WHERE id = ?', [gift.from_user_id]);
    await db.run(`
        INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, created_at)
        VALUES (?, 'gift_received', ?, ?, ?, ?, datetime('now'))
    `, [userId, gift.amount, updatedUser.balance - gift.amount, updatedUser.balance,
        'Gift from ' + (sender ? sender.username : 'unknown')]);

    console.warn('[Gifting] User %d claimed gift #%d ($%s)', userId, giftId, gift.amount.toFixed(2));

    return {
        giftId: gift.id,
        amount: gift.amount,
        newBalance: updatedUser.balance,
    };
}

/**
 * Get gift history (sent and received) for a user.
 */
async function getGiftHistory(userId, limit) {
    const historyLimit = Math.min(Math.max(limit || 20, 1), 50);
    const rows = await db.all(`
        SELECT g.id, g.amount, g.message, g.status, g.created_at, g.claimed_at,
               g.from_user_id, g.to_user_id,
               uf.username AS from_username, uf.display_name AS from_display_name,
               ut.username AS to_username, ut.display_name AS to_display_name
        FROM gifts g
        JOIN users uf ON g.from_user_id = uf.id
        JOIN users ut ON g.to_user_id = ut.id
        WHERE g.from_user_id = ? OR g.to_user_id = ?
        ORDER BY g.created_at DESC
        LIMIT ?
    `, [userId, userId, historyLimit]);

    return rows.map(function formatGiftHistory(r) {
        const isSent = r.from_user_id === userId;
        return {
            id: r.id,
            type: isSent ? 'sent' : 'received',
            amount: r.amount,
            message: r.message,
            status: r.status,
            otherPlayer: isSent
                ? (r.to_display_name || r.to_username)
                : (r.from_display_name || r.from_username),
            createdAt: r.created_at,
            claimedAt: r.claimed_at,
        };
    });
}

module.exports = { sendGift, getPendingGifts, claimGift, getGiftHistory };
