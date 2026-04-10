'use strict';

const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../database');
const bonusCap = require('../services/bonus-cap.service');
const { bonusGuard } = require('../middleware/bonus-guard');

// ─── Bootstrap withdrawal_offers table ───
async function bootstrapTable() {
    try {
        const isPg = db.isPg();
        const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
        await db.run(
            'CREATE TABLE IF NOT EXISTS withdrawal_offers (' +
            '  id ' + idDef + ',' +
            '  user_id INTEGER NOT NULL,' +
            '  offer_type TEXT NOT NULL,' +
            '  offer_amount REAL NOT NULL,' +
            '  withdrawal_amount REAL NOT NULL,' +
            '  accepted INTEGER DEFAULT 0,' +
            '  created_at ' + tsDef +
            ')'
        );
        console.warn('[WithdrawalEnhance] Table initialized');
    } catch (err) {
        console.warn('[WithdrawalEnhance] Bootstrap table error:', err.message);
    }
}

bootstrapTable();

// ─── GET /api/withdrawal-enhance/check ───
// Pre-withdrawal checks: balance, wagering requirements, cooldown, pending withdrawals
router.get('/check', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user balance
        const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balance = user.balance;
        const minWithdrawal = 20;
        const withdrawalFee = 0.05; // 5%

        // Get VIP tier (if available) to determine max withdrawal
        // For now, default to 5000 if not stored
        const maxWithdrawal = 5000;

        // Calculate total wagered (sum of bet_amount from spins)
        const wageredRow = await db.get(
            'SELECT COALESCE(SUM(bet_amount), 0) as total_wagered FROM spins WHERE user_id = ?',
            [userId]
        );
        const totalWagered = wageredRow ? wageredRow.total_wagered : 0;

        // Calculate total deposited
        const depositedRow = await db.get(
            'SELECT COALESCE(SUM(amount), 0) as total_deposited FROM deposits WHERE user_id = ? AND status = ?',
            [userId, 'completed']
        );
        const totalDeposited = depositedRow ? depositedRow.total_deposited : 0;

        // Wagering requirement: must wager at least 1x of total deposited
        const pendingBonusWagering = Math.max(0, totalDeposited - totalWagered);
        const canWithdraw = totalWagered >= totalDeposited;

        // Check for pending withdrawal (last 24 hours)
        const pending = await db.get(
            'SELECT id FROM withdrawals WHERE user_id = ? AND status = ?',
            [userId, 'pending']
        );

        // Check cooldown: 24 hours between withdrawals
        const lastWithdrawal = await db.get(
            'SELECT created_at FROM withdrawals WHERE user_id = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT 1',
            [userId, 'completed', 'pending']
        );

        let cooldownEndsAt = null;
        if (lastWithdrawal) {
            const lastTime = new Date(lastWithdrawal.created_at);
            const cooldownTime = new Date(lastTime.getTime() + 24 * 60 * 60 * 1000);
            const now = new Date();
            if (now < cooldownTime) {
                cooldownEndsAt = cooldownTime.toISOString();
            }
        }

        res.json({
            canWithdraw: canWithdraw && !pending && !cooldownEndsAt,
            balance: parseFloat(balance.toFixed(2)),
            minWithdrawal,
            withdrawalFee,
            maxWithdrawal,
            pendingBonusWagering: parseFloat(pendingBonusWagering.toFixed(2)),
            totalWagered: parseFloat(totalWagered.toFixed(2)),
            totalDeposited: parseFloat(totalDeposited.toFixed(2)),
            hasPendingWithdrawal: !!pending,
            cooldownEndsAt
        });
    } catch (err) {
        console.warn('[WithdrawalEnhance] Check error:', err.message);
        res.status(500).json({ error: 'Failed to check withdrawal eligibility' });
    }
});

// ─── POST /api/withdrawal-enhance/offer ───
// Generate a personalized counter-offer to prevent withdrawal
router.post('/offer', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { amount } = req.body;

        const withdrawalAmount = parseFloat(amount);
        if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal amount' });
        }

        const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!user || user.balance < withdrawalAmount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Generate offer based on withdrawal amount
        let offerType, offerAmount, description, ctaText, bonusAmount;

        if (withdrawalAmount < 50) {
            // Small withdrawal: offer 25% bonus
            offerType = 'small_bonus';
            offerAmount = withdrawalAmount * 0.25;
            bonusAmount = offerAmount;
            description = `Stay and play! We'll add $${offerAmount.toFixed(2)} to your balance if you keep playing.`;
            ctaText = 'Claim 25% bonus';
        } else if (withdrawalAmount >= 50 && withdrawalAmount <= 200) {
            // Medium withdrawal: offer 50% deposit match
            offerType = 'deposit_match';
            offerAmount = withdrawalAmount * 0.5;
            bonusAmount = offerAmount;
            description = `Great opportunity! Deposit $${(withdrawalAmount / 2).toFixed(2)} and we'll match it 50% for a total of $${offerAmount.toFixed(2)} extra.`;
            ctaText = 'Accept 50% match';
        } else {
            // Large withdrawal: VIP upgrade + 100% match
            offerType = 'vip_upgrade';
            offerAmount = withdrawalAmount; // 100% match
            bonusAmount = offerAmount;
            description = `Exclusive VIP offer! Get upgraded to VIP status and receive a 100% bonus match ($${offerAmount.toFixed(2)}) on your next deposit.`;
            ctaText = 'Upgrade to VIP';
        }

        // Record the offer in the database
        const result = await db.run(
            'INSERT INTO withdrawal_offers (user_id, offer_type, offer_amount, withdrawal_amount, accepted) VALUES (?, ?, ?, ?, ?)',
            [userId, offerType, offerAmount, withdrawalAmount, 0]
        );

        const offerId = result.lastInsertRowid;

        res.json({
            offer: {
                id: offerId,
                type: offerType,
                amount: withdrawalAmount,
                description,
                bonusAmount: parseFloat(bonusAmount.toFixed(2)),
                ctaText
            }
        });
    } catch (err) {
        console.warn('[WithdrawalEnhance] Offer generation error:', err.message);
        res.status(500).json({ error: 'Failed to generate offer' });
    }
});

// ─── POST /api/withdrawal-enhance/accept-offer ───
// Accept a retention offer and credit the bonus
router.post('/accept-offer', authenticate, bonusGuard, async (req, res) => {
    try {
        const userId = req.user.id;

        // SECURITY: Self-exclusion check — no retention bonuses for excluded users
        // ROUND 30: Fail CLOSED on DB error (was silently continuing)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [userId]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Bonuses are disabled.' });
            }
        } catch (exclErr) {
            console.error('[WithdrawalEnhance] Self-exclusion check failed:', exclErr.message);
            return res.status(500).json({ error: 'Security check failed. Please try again.' });
        }

        const { offerId } = req.body;

        if (!offerId) {
            return res.status(400).json({ error: 'Missing offerId' });
        }

        // Validate offer exists and belongs to user
        const offer = await db.get(
            'SELECT id, user_id, offer_type, offer_amount, withdrawal_amount, accepted FROM withdrawal_offers WHERE id = ?',
            [offerId]
        );

        if (!offer) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        if (offer.user_id !== userId) {
            return res.status(403).json({ error: 'Offer does not belong to you' });
        }

        if (offer.accepted) {
            return res.status(400).json({ error: 'Offer already accepted' });
        }

        // Get current user balance
        const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balanceBefore = user.balance;

        // ROUND 35: Block bonus stacking — don't accept retention offers while
        // existing wagering requirements are still in progress. This prevents
        // users from diluting their effective playthrough per bonus dollar.
        const userWager = await db.get(
            'SELECT wagering_requirement, wagering_progress FROM users WHERE id = ?',
            [userId]
        );
        if (userWager && userWager.wagering_requirement > 0 &&
            (userWager.wagering_progress || 0) < userWager.wagering_requirement) {
            return res.status(400).json({
                error: 'Complete your current bonus wagering before accepting new offers',
                pendingWagering: Math.round((userWager.wagering_requirement - (userWager.wagering_progress || 0)) * 100) / 100
            });
        }

        // SECURITY: Apply global daily bonus cap
        const cappedAmount = await bonusCap.capBonusAmount(userId, offer.offer_amount);
        if (cappedAmount <= 0) {
            return res.status(400).json({ error: 'Daily bonus limit reached. Try again tomorrow.' });
        }
        const bonusAmount = cappedAmount;

        // SECURITY: Credit bonus + set wagering requirement in transaction
        // Without wagering, user could accept bonus and immediately withdraw
        const RETENTION_WAGERING_MULTIPLIER = 30; // 30x playthrough before withdrawal
        const wageringRequired = Math.round(bonusAmount * RETENTION_WAGERING_MULTIPLIER * 100) / 100;

        await db.beginTransaction();
        try {
            // ROUND 57: Single atomic UPDATE — bonus + wagering in one statement
            // Previously two separate UPDATEs; if second failed, bonus credited without wagering
            await db.run(
                'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, wagering_progress = COALESCE(wagering_progress, 0) WHERE id = ?',
                [bonusAmount, wageringRequired, userId]
            );

            // Mark offer as accepted
            await db.run('UPDATE withdrawal_offers SET accepted = 1 WHERE id = ?', [offerId]);

            // Cancel the pending withdrawal that triggered this offer.
            // The withdrawal amount was already deducted from balance when the withdrawal
            // was created. If we don't cancel it, the user gets BOTH the bonus AND the
            // withdrawal payout — a direct revenue loss.
            const pendingWd = await db.get(
                "SELECT id, amount FROM withdrawals WHERE user_id = ? AND status = 'pending' AND amount = ? ORDER BY id DESC LIMIT 1",
                [userId, offer.withdrawal_amount]
            );
            if (pendingWd) {
                await db.run(
                    "UPDATE withdrawals SET status = 'cancelled', admin_note = 'User accepted retention offer', processed_at = datetime('now') WHERE id = ?",
                    [pendingWd.id]
                );
                // Refund the withdrawal amount back to withdrawable balance
                await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [pendingWd.amount, userId]);
                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, 'withdrawal_cancel', pendingWd.amount, balanceBefore, balanceBefore + pendingWd.amount, `retention-cancel-wd-${pendingWd.id}`]
                );
            }

            // Record bonus transaction (balance_before reflects post-refund if withdrawal was cancelled)
            const effectiveBalanceBefore = pendingWd ? (balanceBefore + pendingWd.amount) : balanceBefore;
            const balanceAfter = effectiveBalanceBefore + bonusAmount;
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'bonus', bonusAmount, effectiveBalanceBefore, balanceAfter, `retention-offer-${offerId}`]
            );

            await db.commit();
        } catch (txErr) {
            await db.rollback();
            throw txErr;
        }

        // Re-read actual balance after transaction (withdrawal refund + bonus)
        const updatedUser = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [userId]);
        const finalBalance = updatedUser ? updatedUser.balance : balanceBefore;

        res.json({
            success: true,
            message: `Bonus of $${bonusAmount.toFixed(2)} credited to your account!`,
            newBalance: parseFloat(finalBalance.toFixed(2)),
            offerType: offer.offer_type
        });
    } catch (err) {
        console.warn('[WithdrawalEnhance] Accept offer error:', err.message);
        res.status(500).json({ error: 'Failed to accept offer' });
    }
});

// ─── GET /api/withdrawal-enhance/admin/stats ───
// Withdrawal analytics for admins
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        // Total withdrawal requests
        const totalRow = await db.get(
            'SELECT COUNT(*) as count FROM withdrawals'
        );
        const totalWithdrawals = totalRow ? totalRow.count : 0;

        // Total prevented (offers accepted)
        const preventedRow = await db.get(
            'SELECT COUNT(*) as count FROM withdrawal_offers WHERE accepted = 1'
        );
        const totalPrevented = preventedRow ? preventedRow.count : 0;

        // Total fees collected (5% on all withdrawals)
        const feesRow = await db.get(
            'SELECT COALESCE(SUM(amount * 0.05), 0) as total_fees FROM withdrawals WHERE status IN (?, ?)',
            ['completed', 'pending']
        );
        const totalFeesCollected = feesRow ? feesRow.total_fees : 0;

        // Average withdrawal amount
        const avgRow = await db.get(
            'SELECT AVG(amount) as avg_amount FROM withdrawals'
        );
        const avgWithdrawalAmount = avgRow ? avgRow.avg_amount : 0;

        // Retention rate: (prevented / total)
        const retentionRate = totalWithdrawals > 0 ? (totalPrevented / totalWithdrawals) * 100 : 0;

        // Total bonus amount offered to prevent withdrawals
        const bonusRow = await db.get(
            'SELECT COALESCE(SUM(offer_amount), 0) as total_offered FROM withdrawal_offers WHERE accepted = 1'
        );
        const totalBonusOffered = bonusRow ? bonusRow.total_offered : 0;

        res.json({
            stats: {
                totalWithdrawalRequests: totalWithdrawals,
                totalWithdrawalsPrevented: totalPrevented,
                totalFeesCollected: parseFloat(totalFeesCollected.toFixed(2)),
                averageWithdrawalAmount: parseFloat(avgWithdrawalAmount.toFixed(2)),
                retentionRate: parseFloat(retentionRate.toFixed(2)),
                totalBonusOffered: parseFloat(totalBonusOffered.toFixed(2))
            }
        });
    } catch (err) {
        console.warn('[WithdrawalEnhance] Admin stats error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve stats' });
    }
});

module.exports = router;
