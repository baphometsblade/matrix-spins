const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { bonusGuard } = require('../middleware/bonus-guard');
const { sendPasswordReset } = require('../services/email.service');

const router = express.Router();

// ─── Validation Helpers ───

const VALID_CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP'];
const DATE_OF_BIRTH_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

// ═══════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════

// GET /api/user/profile — get full user profile
router.get('/profile', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, username, email, balance, display_name, avatar_url, phone,
                    date_of_birth, country, currency, email_verified, phone_verified,
                    kyc_status, is_admin, created_at, updated_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (err) {
        console.warn('[User] Profile fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// PUT /api/user/profile — update profile fields
router.put('/profile', authenticate, async (req, res) => {
    try {
        const { display_name, phone, date_of_birth, country, currency } = req.body;

        // Validate date_of_birth format (YYYY-MM-DD)
        if (date_of_birth !== undefined && date_of_birth !== null) {
            if (typeof date_of_birth !== 'string' || !DATE_OF_BIRTH_REGEX.test(date_of_birth)) {
                return res.status(400).json({ error: 'date_of_birth must be in YYYY-MM-DD format' });
            }
            // Basic date validity check
            const parsed = new Date(date_of_birth);
            if (isNaN(parsed.getTime())) {
                return res.status(400).json({ error: 'Invalid date_of_birth value' });
            }
        }

        // Validate country is 2-letter code
        if (country !== undefined && country !== null) {
            if (typeof country !== 'string' || !COUNTRY_CODE_REGEX.test(country)) {
                return res.status(400).json({ error: 'country must be a 2-letter ISO code (e.g. AU, US)' });
            }
        }

        // Validate currency
        if (currency !== undefined && currency !== null) {
            if (!VALID_CURRENCIES.includes(currency)) {
                return res.status(400).json({ error: `currency must be one of: ${VALID_CURRENCIES.join(', ')}` });
            }
        }

        // Validate display_name length
        if (display_name !== undefined && display_name !== null) {
            if (typeof display_name !== 'string' || display_name.length > 50) {
                return res.status(400).json({ error: 'display_name must be 50 characters or fewer' });
            }
        }

        // Build dynamic update
        const fields = [];
        const values = [];

        if (display_name !== undefined) { fields.push('display_name = ?'); values.push(display_name); }
        if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
        if (date_of_birth !== undefined) { fields.push('date_of_birth = ?'); values.push(date_of_birth); }
        if (country !== undefined) { fields.push('country = ?'); values.push(country); }
        if (currency !== undefined) { fields.push('currency = ?'); values.push(currency); }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        fields.push("updated_at = datetime('now')");
        values.push(req.user.id);

        await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

        // Return updated profile
        const updated = await db.get(
            `SELECT id, username, email, balance, display_name, avatar_url, phone,
                    date_of_birth, country, currency, email_verified, phone_verified,
                    kyc_status, is_admin, created_at, updated_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        res.json({ user: updated, message: 'Profile updated' });
    } catch (err) {
        console.warn('[User] Profile update error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// PUT /api/user/profile/avatar — update avatar URL
router.put('/profile/avatar', authenticate, async (req, res) => {
    try {
        const { avatar_url } = req.body;

        if (avatar_url === undefined || avatar_url === null) {
            return res.status(400).json({ error: 'avatar_url is required' });
        }
        if (typeof avatar_url !== 'string' || avatar_url.length > 500) {
            return res.status(400).json({ error: 'avatar_url must be a string of 500 characters or fewer' });
        }

        await db.run(
            "UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?",
            [avatar_url, req.user.id]
        );

        res.json({ avatar_url, message: 'Avatar updated' });
    } catch (err) {
        console.warn('[User] Avatar update error:', err);
        res.status(500).json({ error: 'Failed to update avatar' });
    }
});

// ═══════════════════════════════════════════════════════════
//  PLAYER STATS (server-persisted)
// ═══════════════════════════════════════════════════════════

// GET /api/user/stats — load user stats from server
router.get('/stats', authenticate, async (req, res) => {
    try {
        const row = await db.get('SELECT stats_json FROM users WHERE id = ?', [req.user.id]);
        if (!row || !row.stats_json) {
            return res.json({ stats: null });
        }
        try {
            res.json({ stats: JSON.parse(row.stats_json) });
        } catch (parseErr) {
            // Corrupted JSON — return null so client sends fresh stats
            res.json({ stats: null });
        }
    } catch (err) {
        console.warn('[User] Stats fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// PUT /api/user/stats — save user stats to server
router.put('/stats', authenticate, async (req, res) => {
    try {
        const { stats } = req.body;
        if (!stats || typeof stats !== 'object') {
            return res.status(400).json({ error: 'stats object is required' });
        }
        // Sanitize — only allow known numeric fields + safe objects
        const safe = {
            totalSpins: Math.max(0, Number(stats.totalSpins) || 0),
            totalWagered: Math.max(0, Number(stats.totalWagered) || 0),
            totalWon: Math.max(0, Number(stats.totalWon) || 0),
            biggestWin: Math.max(0, Number(stats.biggestWin) || 0),
            gamesPlayed: (stats.gamesPlayed && typeof stats.gamesPlayed === 'object') ? stats.gamesPlayed : {},
            gameStats: (stats.gameStats && typeof stats.gameStats === 'object') ? stats.gameStats : {},
            achievements: Array.isArray(stats.achievements) ? stats.achievements : [],
        };
        const json = JSON.stringify(safe);
        await db.run(
            "UPDATE users SET stats_json = ?, updated_at = datetime('now') WHERE id = ?",
            [json, req.user.id]
        );
        res.json({ message: 'Stats saved' });
    } catch (err) {
        console.warn('[User] Stats save error:', err);
        res.status(500).json({ error: 'Failed to save stats' });
    }
});

// ═══════════════════════════════════════════════════════════
//  DAILY BONUS (server-validated)
// ═══════════════════════════════════════════════════════════

// Must match DAILY_REWARDS in constants.js — server is the source of truth for payouts
const DAILY_REWARDS_SERVER = [
    { amount: 0.50,  xp: 25  },
    { amount: 0.75,  xp: 35  },
    { amount: 1.00,  xp: 50  },
    { amount: 1.50,  xp: 75  },
    { amount: 2.00,  xp: 100 },
    { amount: 3.00,  xp: 150 },
    { amount: 5.00,  xp: 250 },
];

function getTodayStr() {
    return new Date().toISOString().slice(0, 10);
}

// POST /api/user/claim-daily-bonus — server-validated daily bonus
// bonusGuard: blocks self-excluded users + enforces daily bonus cap
router.post('/claim-daily-bonus', authenticate, bonusGuard, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, balance, last_daily_claim, daily_streak FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        const today = getTodayStr();
        if (user.last_daily_claim === today) {
            return res.status(400).json({ error: 'Already claimed today', claimedToday: true });
        }

        // Streak logic: reset if missed a day
        let streak = user.daily_streak || 0;
        if (user.last_daily_claim) {
            const last = new Date(user.last_daily_claim);
            const now = new Date(today);
            const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
            if (diffDays > 1) streak = 0;
        }

        const dayIndex = Math.min(streak, DAILY_REWARDS_SERVER.length - 1);
        const reward = DAILY_REWARDS_SERVER[dayIndex];
        const newStreak = Math.min(streak + 1, 7);
        // Credit to bonus_balance with 15x wagering (revenue protection)
        await db.run(
            "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, last_daily_claim = ?, daily_streak = ?, updated_at = datetime('now') WHERE id = ?",
            [reward.amount, reward.amount * 15, today, newStreak, user.id]
        );

        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
            [user.id, reward.amount, `Daily bonus day ${dayIndex + 1} (bonus, 15x wagering)`]
        );

        const updatedDailyUser = await db.get('SELECT balance FROM users WHERE id = ?', [user.id]);
        res.json({
            awarded: true,
            amount: reward.amount,
            xp: reward.xp,
            streak: newStreak,
            newBalance: updatedDailyUser ? parseFloat(updatedDailyUser.balance) : (user.balance || 0),
        });
    } catch (err) {
        console.warn('[User] Daily bonus error:', err);
        res.status(500).json({ error: 'Failed to claim daily bonus' });
    }
});

// ═══════════════════════════════════════════════════════════
//  BONUS WHEEL (server-validated)
// ═══════════════════════════════════════════════════════════

// Must match WHEEL_SEGMENTS in constants.js — server is the source of truth for payouts
const WHEEL_SEGMENTS_SERVER = [
    { label: '$0.50', value: 0.50, xp: 20  },
    { label: '5 FS',  value: 5,    type: 'freespins', xp: 15 },
    { label: '$1',    value: 1.00, xp: 30  },
    { label: '$2',    value: 2.00, xp: 50  },
    { label: '$5',    value: 5.00, xp: 75  },
    { label: '5 FS',  value: 5,    type: 'freespins', xp: 25 },
    { label: '$0.50', value: 0.50, xp: 20  },
    { label: '$3',    value: 3.00, xp: 150 },
];
const WHEEL_COOLDOWN_HOURS = 4;

// POST /api/user/spin-wheel — server-validated bonus wheel
// bonusGuard: blocks self-excluded users + enforces daily bonus cap
router.post('/spin-wheel', authenticate, bonusGuard, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, balance, last_wheel_spin FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Validate cooldown
        if (user.last_wheel_spin) {
            const last = new Date(user.last_wheel_spin);
            const diffHours = (Date.now() - last.getTime()) / (1000 * 60 * 60);
            if (diffHours < WHEEL_COOLDOWN_HOURS) {
                const nextSpinAt = new Date(last.getTime() + WHEEL_COOLDOWN_HOURS * 3600000).toISOString();
                return res.status(400).json({ error: 'Wheel cooldown active', nextSpinAt });
            }
        }

        // Server determines the prize (RNG server-side)
        const winIndex = crypto.randomInt(WHEEL_SEGMENTS_SERVER.length);
        const seg = WHEEL_SEGMENTS_SERVER[winIndex];

        let newBalance = user.balance;
        if (!seg.type) {
            // Cash prize → bonus_balance with 15x wagering (revenue protection)
            await db.run(
                "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, last_wheel_spin = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                [seg.value, seg.value * 15, user.id]
            );
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
                [user.id, seg.value, 'Bonus wheel prize: ' + seg.label + ' (bonus, 15x wagering)']
            );
        } else {
            // Free spins — just record the spin time, no balance change
            await db.run(
                "UPDATE users SET last_wheel_spin = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                [user.id]
            );
        }

        res.json({
            winIndex,
            segment: seg,
            newBalance,
            xp: seg.xp,
        });
    } catch (err) {
        console.warn('[User] Wheel spin error:', err);
        res.status(500).json({ error: 'Failed to spin wheel' });
    }
});

// ═══════════════════════════════════════════════════════════
//  PROMO CODE REDEMPTION (server-validated)
// ═══════════════════════════════════════════════════════════

const PROMO_CODES_SERVER = {
    WELCOME10:  { type: 'one-time', cash: 10,   xp: 50,  spins: 0,  desc: '+$10 Balance!' },
    MATRIX100:  { type: 'one-time', cash: 0,    xp: 100, spins: 0,  desc: '+100 XP!' },
    FREESPIN10: { type: 'one-time', cash: 0,    xp: 0,   spins: 10, desc: '10 Free Spins!' },
    DAILY2:     { type: 'daily',    cash: 2,    xp: 25,  spins: 0,  desc: '+$2 Balance!' },
    XPBOOST:    { type: 'daily',    cash: 0,    xp: 0,   spins: 0,  desc: '2× XP Boost (20 spins)!' },
};

// bonusGuard: blocks self-excluded users + enforces daily bonus cap
router.post('/redeem-promo', authenticate, bonusGuard, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: 'Promo code is required' });
        }
        const upperCode = code.trim().toUpperCase();
        const def = PROMO_CODES_SERVER[upperCode];
        if (!def) {
            return res.status(400).json({ error: 'Unknown promo code' });
        }

        const user = await db.get(
            'SELECT id, balance, promo_codes_used FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Parse existing usage — { "CODE": true } for one-time, { "CODE": "2026-03-02" } for daily
        let used = {};
        try { used = JSON.parse(user.promo_codes_used || '{}'); } catch (e) { used = {}; }

        const today = new Date().toISOString().slice(0, 10);

        if (def.type === 'one-time' && used[upperCode]) {
            return res.status(400).json({ error: 'Already redeemed', alreadyUsed: true });
        }
        if (def.type === 'daily' && used[upperCode] === today) {
            return res.status(400).json({ error: 'Already used today', alreadyUsed: true });
        }

        // Award cash to bonus_balance with 15x wagering if applicable
        if (def.cash > 0) {
            await db.run(
                'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                [def.cash, def.cash * 15, user.id]
            );
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
                [user.id, def.cash, `Promo code: ${upperCode} (bonus, 15x wagering)`]
            );
        }

        // Mark as used
        used[upperCode] = def.type === 'daily' ? today : true;

        await db.run(
            "UPDATE users SET promo_codes_used = ?, updated_at = datetime('now') WHERE id = ?",
            [JSON.stringify(used), user.id]
        );
        const updatedPromoUser = await db.get('SELECT balance FROM users WHERE id = ?', [user.id]);
        const newBalance = updatedPromoUser ? parseFloat(updatedPromoUser.balance) : (user.balance || 0);

        res.json({
            redeemed: true,
            code: upperCode,
            desc: def.desc,
            cash: def.cash,
            xp: def.xp,
            spins: def.spins,
            newBalance
        });
    } catch (err) {
        console.warn('[User] Promo code error:', err);
        res.status(500).json({ error: 'Failed to redeem promo code' });
    }
});

// ═══════════════════════════════════════════════════════════
//  REFERRAL SYSTEM
// ═══════════════════════════════════════════════════════════

const REFERRAL_BONUS_REFERRER = 25;
const REFERRAL_BONUS_REFEREE = 10;
const REFERRAL_MIN_DEPOSIT = 10;

// GET /api/user/referral — get referral code & stats
router.get('/referral', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT referral_code, referred_by FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Count referrals
        const countResult = await db.get(
            'SELECT COUNT(*) as count FROM users WHERE referred_by = ?',
            [req.user.id]
        );
        const referralCount = countResult ? countResult.count : 0;

        // Sum bonuses earned from referrals
        const bonusResult = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND reference LIKE 'Referral bonus%'",
            [req.user.id]
        );
        const totalEarned = bonusResult ? bonusResult.total : 0;

        res.json({
            referralCode: user.referral_code,
            referralCount,
            totalEarned,
            bonusPerReferral: REFERRAL_BONUS_REFERRER,
            refereeBonusAmount: REFERRAL_BONUS_REFEREE,
            minDeposit: REFERRAL_MIN_DEPOSIT,
        });
    } catch (err) {
        console.warn('[User] Referral info error:', err);
        res.status(500).json({ error: 'Failed to fetch referral info' });
    }
});

// POST /api/user/claim-referral-bonus — called after first qualifying deposit
// Awards bonus to both referrer and referee
// bonusGuard protects the claimer (referee). Referrer is checked inline below.
router.post('/claim-referral-bonus', authenticate, bonusGuard, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, balance, referred_by, referral_bonus_paid FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.referred_by) return res.status(400).json({ error: 'No referral to claim' });
        if (user.referral_bonus_paid) return res.status(400).json({ error: 'Referral bonus already claimed' });

        // Verify first qualifying deposit exists
        const deposit = await db.get(
            "SELECT id FROM deposits WHERE user_id = ? AND status = 'completed' AND amount >= ?",
            [user.id, REFERRAL_MIN_DEPOSIT]
        );
        if (!deposit) {
            return res.status(400).json({ error: 'Qualifying deposit required', minDeposit: REFERRAL_MIN_DEPOSIT });
        }

        // Award bonus to referee → bonus_balance with 15x wagering
        await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, referral_bonus_paid = 1 WHERE id = ?',
            [REFERRAL_BONUS_REFEREE, REFERRAL_BONUS_REFEREE * 15, user.id]);
        await db.run(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
            [user.id, REFERRAL_BONUS_REFEREE, 'Referral bonus — welcome reward (bonus, 15x wagering)']
        );

        // Award bonus to referrer → bonus_balance with 15x wagering
        // bonusGuard on this route covers req.user (the referee); we must check
        // the REFERRER's self-exclusion independently before crediting them.
        const referrer = await db.get('SELECT id FROM users WHERE id = ?', [user.referred_by]);
        if (referrer) {
            let referrerExcluded = false;
            try {
                const rExcl = await db.get(
                    "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                    [referrer.id]
                );
                if (rExcl) referrerExcluded = true;
            } catch (_) { /* table may not exist — fall through */ }
            try {
                const rLim = await db.get('SELECT self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?', [referrer.id]);
                if (rLim) {
                    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
                    if ((rLim.self_excluded_until && rLim.self_excluded_until > now) ||
                        (rLim.cooling_off_until && rLim.cooling_off_until > now)) {
                        referrerExcluded = true;
                    }
                }
            } catch (_) { /* table may not exist — fall through */ }

            if (!referrerExcluded) {
                await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                    [REFERRAL_BONUS_REFERRER, REFERRAL_BONUS_REFERRER * 15, referrer.id]);
                await db.run(
                    "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
                    [referrer.id, REFERRAL_BONUS_REFERRER, 'Referral bonus — friend joined (bonus, 15x wagering)']
                );
            } else {
                console.warn('[User] Skipped referrer bonus — referrer ' + referrer.id + ' is self-excluded');
            }
        }

        const updatedRefUser = await db.get('SELECT balance FROM users WHERE id = ?', [user.id]);
        res.json({
            awarded: true,
            bonusAmount: REFERRAL_BONUS_REFEREE,
            newBalance: updatedRefUser ? parseFloat(updatedRefUser.balance) : (user.balance || 0),
        });
    } catch (err) {
        console.warn('[User] Referral bonus error:', err);
        res.status(500).json({ error: 'Failed to claim referral bonus' });
    }
});

// ═══════════════════════════════════════════════════════════
//  WAGERING STATUS
// ═══════════════════════════════════════════════════════════

// GET /api/user/wagering — get current wagering requirement status
router.get('/wagering', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        const active = user.wagering_requirement > 0 && user.wagering_progress < user.wagering_requirement;
        const pct = user.wagering_requirement > 0
            ? Math.min(100, Math.round((user.wagering_progress / user.wagering_requirement) * 100))
            : 0;

        res.json({
            bonusBalance: user.bonus_balance || 0,
            wageringRequirement: user.wagering_requirement || 0,
            wageringProgress: user.wagering_progress || 0,
            wageringRemaining: Math.max(0, (user.wagering_requirement || 0) - (user.wagering_progress || 0)),
            percentComplete: pct,
            active,
            complete: user.wagering_requirement > 0 && user.wagering_progress >= user.wagering_requirement,
        });
    } catch (err) {
        console.warn('[User] Wagering status error:', err);
        res.status(500).json({ error: 'Failed to fetch wagering status' });
    }
});

// POST /api/user/forfeit-bonus — voluntarily forfeit bonus balance to withdraw real balance
router.post('/forfeit-bonus', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT balance, bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.bonus_balance || user.bonus_balance <= 0) {
            return res.status(400).json({ error: 'No bonus balance to forfeit' });
        }

        const forfeited = user.bonus_balance;
        await db.run(
            'UPDATE users SET bonus_balance = 0, wagering_requirement = 0, wagering_progress = 0 WHERE id = ?',
            [req.user.id]
        );
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.id, 'bonus_forfeit', -forfeited, user.balance, user.balance, 'Voluntarily forfeited bonus balance']
        );

        res.json({
            forfeited,
            message: `Forfeited $${forfeited.toFixed(2)} bonus balance. You can now withdraw your real balance.`,
            balance: user.balance,
        });
    } catch (err) {
        console.warn('[User] Forfeit bonus error:', err);
        res.status(500).json({ error: 'Failed to forfeit bonus' });
    }
});

// ═══════════════════════════════════════════════════════════
//  PASSWORD MANAGEMENT
// ═══════════════════════════════════════════════════════════

// PUT /api/user/change-password — change password (authenticated)
router.put('/change-password', authenticate, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'current_password and new_password are required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        // Fetch current hash
        const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        if (!bcrypt.compareSync(current_password, user.password_hash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash and store new password
        const newHash = bcrypt.hashSync(new_password, 12);
        await db.run(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
            [newHash, req.user.id]
        );

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        console.warn('[User] Change password error:', err);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// POST /api/user/forgot-password — generate password reset token
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await db.get('SELECT id, email FROM users WHERE email = ?', [email]);
        if (!user) {
            // Return success even if user not found (prevents email enumeration)
            return res.json({ message: 'If that email is registered, a reset token has been generated' });
        }

        // Check active token limit
        const activeTokens = await db.get(
            `SELECT COUNT(*) as count FROM password_reset_tokens
             WHERE user_id = ? AND used = 0 AND expires_at > datetime('now')`,
            [user.id]
        );
        if (activeTokens && activeTokens.count >= config.PASSWORD_RESET_MAX_ACTIVE) {
            return res.status(429).json({ error: 'Too many active reset tokens. Please wait or use an existing one.' });
        }

        // Generate token
        const token = crypto.randomBytes(32).toString('hex');
        const expiryHours = config.PASSWORD_RESET_EXPIRY_HOURS;
        const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

        await db.run(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, token, expiresAt]
        );

        // Build reset URL pointing back to the app
        const origin = req.headers.origin || `https://www.msaart.online`;
        const resetUrl = `${origin}?resetToken=${token}`;

        // Send email (non-blocking — always return success to prevent email enumeration)
        sendPasswordReset(user.email, resetUrl, expiryHours).catch(err => {
            console.warn('[User] Failed to send password reset email:', err.message);
        });

        // In dev mode also log the token so it can be tested without SMTP
        if (config.NODE_ENV !== 'production') {
            console.log(`[User] Password reset token for ${email}: ${token}`);
            console.log(`[User] Reset URL: ${resetUrl}`);
        }

        res.json({ message: 'If that email is registered, a password reset link has been sent.' });
    } catch (err) {
        console.warn('[User] Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process password reset request' });
    }
});

// POST /api/user/reset-password — reset password using token
router.post('/reset-password', async (req, res) => {
    try {
        const { token, new_password } = req.body;

        if (!token || !new_password) {
            return res.status(400).json({ error: 'token and new_password are required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        // Find valid, unexpired, unused token
        const resetRecord = await db.get(
            `SELECT id, user_id FROM password_reset_tokens
             WHERE token = ? AND used = 0 AND expires_at > datetime('now')`,
            [token]
        );
        if (!resetRecord) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // Hash and update password
        const newHash = bcrypt.hashSync(new_password, 12);
        await db.run(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
            [newHash, resetRecord.user_id]
        );

        // Mark token as used
        await db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);

        res.json({ message: 'Password has been reset successfully' });
    } catch (err) {
        console.warn('[User] Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ═══════════════════════════════════════════════════════════
//  VERIFICATION / KYC
// ═══════════════════════════════════════════════════════════

// GET /api/user/verification — get KYC status
router.get('/verification', authenticate, async (req, res) => {
    try {
        const verification = await db.get(
            'SELECT user_id, status, document_type, submitted_at, verified_at, notes FROM user_verification WHERE user_id = ?',
            [req.user.id]
        );

        const user = await db.get('SELECT kyc_status FROM users WHERE id = ?', [req.user.id]);

        res.json({
            kyc_status: user ? user.kyc_status : 'unverified',
            verification: verification || null,
        });
    } catch (err) {
        console.warn('[User] Verification fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch verification status' });
    }
});

// POST /api/user/verification — submit verification
router.post('/verification', authenticate, async (req, res) => {
    try {
        const { document_type } = req.body;

        if (!document_type) {
            return res.status(400).json({ error: 'document_type is required' });
        }

        const validTypes = ['passport', 'drivers_license', 'national_id', 'utility_bill'];
        if (!validTypes.includes(document_type)) {
            return res.status(400).json({ error: `document_type must be one of: ${validTypes.join(', ')}` });
        }

        // Check if a verification record already exists
        const existing = await db.get('SELECT user_id, status FROM user_verification WHERE user_id = ?', [req.user.id]);

        if (existing) {
            // Update existing record
            await db.run(
                "UPDATE user_verification SET status = 'pending', document_type = ?, submitted_at = datetime('now'), verified_at = NULL, notes = NULL WHERE user_id = ?",
                [document_type, req.user.id]
            );
        } else {
            // Create new record
            await db.run(
                "INSERT INTO user_verification (user_id, status, document_type, submitted_at) VALUES (?, 'pending', ?, datetime('now'))",
                [req.user.id, document_type]
            );
        }

        // Update user's kyc_status
        await db.run(
            "UPDATE users SET kyc_status = 'pending', updated_at = datetime('now') WHERE id = ?",
            [req.user.id]
        );

        res.json({ message: 'Verification submitted', kyc_status: 'pending' });
    } catch (err) {
        console.warn('[User] Verification submit error:', err);
        res.status(500).json({ error: 'Failed to submit verification' });
    }
});

// ═══════════════════════════════════════════════════════════
//  TRANSACTION HISTORY
// ═══════════════════════════════════════════════════════════

// GET /api/user/transactions — paginated transaction history
router.get('/transactions', authenticate, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);
        const offset = (page - 1) * limit;
        const type = req.query.type || null;

        // Build query with optional type filter
        let countSql = 'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?';
        let dataSql = `SELECT id, type, amount, balance_before, balance_after, reference, created_at
                       FROM transactions WHERE user_id = ?`;
        const params = [req.user.id];

        if (type) {
            countSql += ' AND type = ?';
            dataSql += ' AND type = ?';
            params.push(type);
        }

        dataSql += ' ORDER BY id DESC LIMIT ? OFFSET ?';

        // Get total count
        const countResult = await db.get(countSql, params);
        const total = countResult ? countResult.total : 0;

        // Get paginated data
        const dataParams = [...params, limit, offset];
        const transactions = await db.all(dataSql, dataParams);

        res.json({
            transactions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.warn('[User] Transactions fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// ═══════════════════════════════════════════════════════════
//  ACCOUNT
// ═══════════════════════════════════════════════════════════

// POST /api/user/close-account — soft-close account
router.post('/close-account', authenticate, async (req, res) => {
    try {
        await db.run(
            "UPDATE users SET is_banned = 1, updated_at = datetime('now') WHERE id = ?",
            [req.user.id]
        );

        res.json({ message: 'Account has been closed' });
    } catch (err) {
        console.warn('[User] Close account error:', err);
        res.status(500).json({ error: 'Failed to close account' });
    }
});

module.exports = router;
