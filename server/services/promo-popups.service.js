/**
 * Promotional Popup System
 * Serves time-limited offers to drive deposits and engagement
 */
const db = require('../database');

const PROMO_TYPES = {
    WELCOME_BACK: {
        id: 'welcome_back',
        title: 'Welcome Back!',
        message: 'We missed you! Here is a 50% reload bonus on your next deposit.',
        cta: 'Deposit Now',
        minInactiveDays: 3,
        bonusPct: 50,
        maxBonus: 100
    },
    HAPPY_HOUR: {
        id: 'happy_hour',
        title: 'Happy Hour Active!',
        message: 'All wins are boosted 20% for the next hour!',
        cta: 'Play Now',
        hours: [18, 19, 20, 21] // 6pm-10pm
    },
    WEEKEND_BONUS: {
        id: 'weekend_bonus',
        title: 'Weekend Special',
        message: 'Deposit this weekend and get 75% bonus up to \!',
        cta: 'Claim Bonus',
        days: [0, 6], // Sunday and Saturday
        bonusPct: 75,
        maxBonus: 150
    },
    LOW_BALANCE: {
        id: 'low_balance',
        title: 'Top Up & Play!',
        message: 'Add funds now and receive 30% extra credits instantly.',
        cta: 'Quick Deposit',
        balanceThreshold: 5,
        bonusPct: 30,
        maxBonus: 50
    },
    JACKPOT_ALERT: {
        id: 'jackpot_alert',
        title: 'Jackpot Alert!',
        message: 'The Grand Jackpot has exceeded \,000! Play jackpot slots now.',
        cta: 'Chase the Jackpot',
        jackpotThreshold: 50000
    }
};

async function getActivePromos(userId) {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    const promos = [];

    // Happy hour check
    if (PROMO_TYPES.HAPPY_HOUR.hours.includes(hour)) {
        promos.push(PROMO_TYPES.HAPPY_HOUR);
    }

    // Weekend bonus
    if (PROMO_TYPES.WEEKEND_BONUS.days.includes(day)) {
        promos.push(PROMO_TYPES.WEEKEND_BONUS);
    }

    if (userId) {
        try {
            const user = await db.get('SELECT balance, last_login FROM users WHERE id = ?', [userId]);
            if (user) {
                // Low balance prompt
                if (user.balance < PROMO_TYPES.LOW_BALANCE.balanceThreshold) {
                    promos.push(PROMO_TYPES.LOW_BALANCE);
                }
                // Welcome back
                if (user.last_login) {
                    const lastLogin = new Date(user.last_login);
                    const daysSince = (now - lastLogin) / (1000 * 60 * 60 * 24);
                    if (daysSince >= PROMO_TYPES.WELCOME_BACK.minInactiveDays) {
                        promos.push(PROMO_TYPES.WELCOME_BACK);
                    }
                }
            }
        } catch (err) {
            console.warn('[PromoPopups] Failed to fetch user promo context:', err.message);
        }
    }

    return promos;
}

module.exports = { getActivePromos, PROMO_TYPES };