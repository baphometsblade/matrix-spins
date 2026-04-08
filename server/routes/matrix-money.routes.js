/**
 * Matrix Money Routes
 *
 * Public-facing API for the Matrix Money NFT-framed virtual currency system.
 * Wraps the existing payment/deposit/withdrawal system with NFT metadata
 * and provides endpoints for viewing NFT collectibles and transaction history.
 *
 * Purchase Matrix Money = Buy a Digital Collectible (NFT)
 * Withdraw Matrix Money = Sell back a Digital Collectible (NFT)
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');
const crypto = require('crypto');
const { mintOnDeposit, recordResaleOnWithdrawal, generateTokenId } = require('../services/nft-ledger');

const router = express.Router();

// ─── Matrix Money Package Tiers ────────────────────────────────────────────
// Each purchase buys an NFT (digital collectible) that entitles the holder
// to the corresponding amount of Matrix Money entertainment credits.
const MM_PACKAGES = [
    { id: 'mm_500',   price: 5,   credits: 500,   label: 'Bronze Collectible',   bonus: 0 },
    { id: 'mm_1100',  price: 10,  credits: 1100,  label: 'Silver Collectible',   bonus: 100 },
    { id: 'mm_3000',  price: 25,  credits: 3000,  label: 'Gold Collectible',     bonus: 500 },
    { id: 'mm_6500',  price: 50,  credits: 6500,  label: 'Platinum Collectible', bonus: 1500 },
    { id: 'mm_14000', price: 100, credits: 14000, label: 'Diamond Collectible',  bonus: 4000 },
];

// Withdrawal tiers — user sells back an NFT for the stated value
const MM_WITHDRAW_MIN = config.MIN_WITHDRAWAL || 20;
const MM_WITHDRAW_MAX = config.MAX_WITHDRAWAL || 50000;

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateReference(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET /api/matrix-money/packages — List available Matrix Money packages
// ═══════════════════════════════════════════════════════════════════════════
router.get('/packages', (req, res) => {
    res.json({
        packages: MM_PACKAGES.map(p => ({
            id: p.id,
            price: p.price,
            credits: p.credits,
            bonus: p.bonus,
            label: p.label,
            currency: config.CURRENCY || 'AUD',
            description: `Purchase the ${p.label} — a digital collectible (NFT) entitling you to ${p.credits.toLocaleString()} Matrix Money entertainment credits.`
        })),
        disclaimer: 'Matrix Money is a virtual entertainment currency with NO real-world monetary value. Each purchase constitutes the acquisition of a digital collectible (NFT).'
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /api/matrix-money/purchase — Buy a Matrix Money NFT package
// ═══════════════════════════════════════════════════════════════════════════
router.post('/purchase', authenticate, async (req, res) => {
    try {
        const { packageId, paymentType, paymentMethodId } = req.body;

        // Validate package
        const pkg = MM_PACKAGES.find(p => p.id === packageId);
        if (!pkg) {
            return res.status(400).json({ error: 'Invalid package selected' });
        }

        // Validate payment type
        const validTypes = config.PAYMENT_METHODS || ['visa', 'mastercard', 'payid', 'bank_transfer', 'crypto_btc', 'crypto_eth', 'crypto_usdt'];
        if (!paymentType || !validTypes.includes(paymentType)) {
            return res.status(400).json({ error: 'Valid payment type is required' });
        }

        // ROUND 49: Check BOTH self-exclusion tables (was only checking user_limits)
        try {
            var exclusion = await db.get(
                "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                [req.user.id]
            );
            if (exclusion) {
                return res.status(403).json({ error: 'Account is self-excluded. Purchases are disabled.' });
            }
        } catch (exclErr) {
            if (exclErr.message && exclErr.message.includes('no such table')) { /* OK */ }
            else {
                console.error('[MatrixMoney] Self-exclusion check failed:', exclErr.message);
                return res.status(500).json({ error: 'Security check failed' });
            }
        }
        // Also check user_limits table
        const limits = await db.get(
            'SELECT self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?',
            [req.user.id]
        );
        if (limits) {
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (limits.self_excluded_until && limits.self_excluded_until > now) {
                return res.status(403).json({ error: `Account is self-excluded until ${limits.self_excluded_until}` });
            }
            if (limits.cooling_off_until && limits.cooling_off_until > now) {
                return res.status(403).json({ error: `Account is in cooling-off period until ${limits.cooling_off_until}` });
            }
        }

        // Validate payment method ownership
        if (paymentMethodId) {
            const pm = await db.get(
                'SELECT id FROM payment_methods WHERE id = ? AND user_id = ?',
                [paymentMethodId, req.user.id]
            );
            if (!pm) {
                return res.status(400).json({ error: 'Invalid payment method' });
            }
        }

        const reference = generateReference('MM-PUR');
        const amount = pkg.price;

        // Create deposit record as PENDING
        // In production, this would be confirmed by Stripe webhook or crypto verification
        const depositResult = await db.run(
            'INSERT INTO deposits (user_id, amount, currency, payment_method_id, payment_type, status, reference) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, amount, config.CURRENCY || 'AUD', paymentMethodId || null, paymentType, 'pending', reference]
        );
        const depositId = depositResult.lastInsertRowid;

        // For demo/development ONLY: auto-complete the deposit and credit balance
        // In production, Stripe webhook confirmation handles this
        if (!config.STRIPE_SECRET_KEY && config.NODE_ENV !== 'production') {
            const user = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
            const balanceBefore = user ? user.balance : 0;

            // Credit the Matrix Money credits to user balance
            await db.run(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [pkg.credits, req.user.id]
            );

            // Mark deposit as completed
            await db.run(
                "UPDATE deposits SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
                [depositId]
            );

            // Log transaction
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, 'deposit', pkg.credits, balanceBefore, balanceBefore + pkg.credits, reference]
            );

            // Mint NFT on the ledger
            const tokenId = await mintOnDeposit(db, {
                userId: req.user.id,
                amount: amount,
                depositId: depositId,
                paymentType: paymentType,
                reference: reference,
                currency: config.CURRENCY || 'AUD'
            });

            // Apply bonus credits if package has bonus
            // ROUND 49: Cap bonus to remaining daily limit ($75/day global)
            let bonusAwarded = 0;
            if (pkg.bonus > 0) {
                var bonusCap = require('../services/bonus-cap.service');
                var cappedBonus = await bonusCap.capBonusAmount(req.user.id, pkg.bonus);
                if (cappedBonus > 0) {
                    await db.run(
                        'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                        [cappedBonus, cappedBonus * 10, req.user.id]
                    );
                    bonusAwarded = cappedBonus;

                    await db.run(
                        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                        [req.user.id, 'bonus', bonusAwarded, balanceBefore + pkg.credits, balanceBefore + pkg.credits, `BONUS-${reference}`]
                    );
                }
            }

            const updatedUser = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.user.id]);

            return res.json({
                success: true,
                message: `Successfully acquired ${pkg.label}! ${pkg.credits.toLocaleString()} Matrix Money credits added to your account.`,
                nft: {
                    tokenId: tokenId,
                    collection: 'Matrix Spins Digital Collectibles',
                    type: pkg.label,
                    credits: pkg.credits,
                    price: amount,
                    currency: config.CURRENCY || 'AUD'
                },
                balance: updatedUser.balance,
                bonusBalance: updatedUser.bonus_balance || 0,
                bonusAwarded: bonusAwarded,
                deposit: {
                    id: depositId,
                    reference: reference,
                    status: 'completed'
                }
            });
        }

        // Production path: deposit stays pending until Stripe/crypto confirmation
        res.json({
            success: true,
            message: `Purchase of ${pkg.label} submitted — awaiting payment confirmation.`,
            deposit: {
                id: depositId,
                amount: amount,
                credits: pkg.credits,
                reference: reference,
                status: 'pending'
            },
            nft: {
                collection: 'Matrix Spins Digital Collectibles',
                type: pkg.label,
                credits: pkg.credits,
                status: 'pending_mint'
            }
        });
    } catch (err) {
        console.warn('[MatrixMoney] Purchase error:', err.message);
        res.status(500).json({ error: 'Purchase failed. Please try again.' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /api/matrix-money/withdraw — Sell back a Matrix Money NFT
// ═══════════════════════════════════════════════════════════════════════════
router.post('/withdraw', authenticate, async (req, res) => {
    try {
        const { amount, paymentType, paymentMethodId } = req.body;
        const withdrawal = parseFloat(amount);

        if (!Number.isFinite(withdrawal) || withdrawal <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal amount' });
        }
        if (withdrawal < MM_WITHDRAW_MIN) {
            return res.status(400).json({ error: `Minimum NFT resale value is $${MM_WITHDRAW_MIN.toFixed(2)}` });
        }
        if (withdrawal > MM_WITHDRAW_MAX) {
            return res.status(400).json({ error: `Maximum NFT resale value is $${MM_WITHDRAW_MAX.toFixed(2)}` });
        }

        const validTypes = config.PAYMENT_METHODS || ['visa', 'mastercard', 'payid', 'bank_transfer', 'crypto_btc', 'crypto_eth', 'crypto_usdt'];
        if (!paymentType || !validTypes.includes(paymentType)) {
            return res.status(400).json({ error: 'Valid payment type is required' });
        }

        // Check self-exclusion
        const limits = await db.get(
            'SELECT self_excluded_until, cooling_off_until FROM user_limits WHERE user_id = ?',
            [req.user.id]
        );
        if (limits) {
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (limits.self_excluded_until && limits.self_excluded_until > now) {
                return res.status(403).json({ error: `Account is self-excluded until ${limits.self_excluded_until}` });
            }
        }

        // Check balance
        const user = await db.get('SELECT balance, bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.balance < withdrawal) {
            return res.status(400).json({ error: `Insufficient Matrix Money balance. You have M$${user.balance.toFixed(2)}` });
        }

        // Wagering requirement: must have at least 1 completed deposit and meet wagering
        const totalDeposited = await db.get(
            "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = 'completed'",
            [req.user.id]
        );
        const deposited = totalDeposited ? totalDeposited.total : 0;
        if (!deposited || deposited <= 0) {
            return res.status(400).json({ error: 'You must acquire at least one Matrix Money NFT before selling back.' });
        }

        const totalWagered = await db.get(
            'SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?',
            [req.user.id]
        );
        const wagered = totalWagered ? totalWagered.total : 0;
        if (wagered < deposited) {
            const remaining = (deposited - wagered).toFixed(2);
            return res.status(400).json({
                error: `Wagering requirement not met. Wager M$${remaining} more before selling your NFT.`,
                wagerRequired: deposited,
                wagerCompleted: wagered
            });
        }

        // Block if active bonus wagering is incomplete
        if (user.wagering_requirement > 0 && user.wagering_progress < user.wagering_requirement) {
            const pct = Math.round((user.wagering_progress / user.wagering_requirement) * 100);
            return res.status(400).json({
                error: `Bonus playthrough incomplete (${pct}%). Complete wagering requirements before selling your NFT.`
            });
        }

        // Validate payment method ownership
        if (paymentMethodId) {
            const pm = await db.get('SELECT id FROM payment_methods WHERE id = ? AND user_id = ?', [paymentMethodId, req.user.id]);
            if (!pm) return res.status(400).json({ error: 'Invalid payment method' });
        }

        const reference = generateReference('MM-WDR');
        const balanceBefore = user.balance;

        // Atomic balance deduction
        const deductResult = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [withdrawal, req.user.id, withdrawal]
        );
        if (!deductResult || deductResult.changes === 0) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Create withdrawal record
        const wdResult = await db.run(
            'INSERT INTO withdrawals (user_id, amount, currency, payment_method_id, payment_type, status, reference) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, withdrawal, config.CURRENCY || 'AUD', paymentMethodId || null, paymentType, 'pending', reference]
        );
        const withdrawalId = wdResult.lastInsertRowid;

        // Log transaction
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.id, 'withdrawal', -withdrawal, balanceBefore, balanceBefore - withdrawal, reference]
        );

        // NFT ledger: record resale
        const tokenId = await recordResaleOnWithdrawal(db, {
            userId: req.user.id,
            amount: withdrawal,
            withdrawalId: withdrawalId,
            paymentType: paymentType,
            reference: reference,
            currency: config.CURRENCY || 'AUD'
        });

        const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);

        res.json({
            success: true,
            message: `NFT resale of M$${withdrawal.toFixed(2)} submitted. Processing within ${config.WITHDRAWAL_PROCESSING_DAYS || 3} business days.`,
            nft: {
                tokenId: tokenId,
                collection: 'Matrix Spins Digital Collectibles',
                type: 'resale',
                value: withdrawal,
                currency: config.CURRENCY || 'AUD'
            },
            balance: updatedUser.balance,
            withdrawal: {
                id: withdrawalId,
                amount: withdrawal,
                reference: reference,
                status: 'pending',
                estimatedDays: (config.WITHDRAWAL_PROCESSING_DAYS || 3) + 1
            }
        });
    } catch (err) {
        console.warn('[MatrixMoney] Withdrawal error:', err.message);
        res.status(500).json({ error: 'Withdrawal failed. Please try again.' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  GET /api/matrix-money/balance — Get Matrix Money balance + NFT summary
// ═══════════════════════════════════════════════════════════════════════════
router.get('/balance', authenticate, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT balance, bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Count user's NFTs
        const nftCount = await db.get(
            'SELECT COUNT(*) as total FROM nft_ledger WHERE user_id = ?',
            [req.user.id]
        );
        const purchaseCount = await db.get(
            "SELECT COUNT(*) as total FROM nft_ledger WHERE user_id = ? AND type = 'sale'",
            [req.user.id]
        );
        const resaleCount = await db.get(
            "SELECT COUNT(*) as total FROM nft_ledger WHERE user_id = ? AND type = 'resale'",
            [req.user.id]
        );

        res.json({
            balance: user.balance,
            bonusBalance: user.bonus_balance || 0,
            wagering: {
                requirement: user.wagering_requirement || 0,
                progress: user.wagering_progress || 0,
                complete: !user.wagering_requirement || user.wagering_progress >= user.wagering_requirement
            },
            nfts: {
                total: nftCount ? nftCount.total : 0,
                purchased: purchaseCount ? purchaseCount.total : 0,
                resold: resaleCount ? resaleCount.total : 0
            }
        });
    } catch (err) {
        console.warn('[MatrixMoney] Balance error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve balance' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  GET /api/matrix-money/nfts — List user's NFT collectibles
// ═══════════════════════════════════════════════════════════════════════════
router.get('/nfts', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const nfts = await db.all(
            'SELECT token_id, type, amount, currency, metadata, created_at FROM nft_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
            [req.user.id, limit]
        );

        res.json({
            nfts: (nfts || []).map(n => ({
                tokenId: n.token_id,
                type: n.type === 'sale' ? 'purchase' : 'resale',
                amount: n.amount,
                currency: n.currency,
                collection: 'Matrix Spins Digital Collectibles',
                metadata: n.metadata ? JSON.parse(n.metadata) : {},
                mintedAt: n.created_at
            })),
            disclaimer: 'Matrix Money NFTs are digital entertainment collectibles with no real-world monetary value and cannot be transferred to third parties.'
        });
    } catch (err) {
        console.warn('[MatrixMoney] NFTs error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve NFT collection' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
//  GET /api/matrix-money/transactions — Transaction history with NFT refs
// ═══════════════════════════════════════════════════════════════════════════
router.get('/transactions', authenticate, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const transactions = await db.all(
            "SELECT type, amount, balance_before, balance_after, reference, created_at FROM transactions WHERE user_id = ? AND type IN ('deposit', 'withdrawal', 'bonus', 'first_deposit_bonus', 'reload_bonus') ORDER BY created_at DESC LIMIT ?",
            [req.user.id, limit]
        );

        res.json({
            transactions: (transactions || []).map(t => ({
                type: t.type === 'deposit' ? 'nft_purchase' : t.type === 'withdrawal' ? 'nft_resale' : t.type,
                amount: t.amount,
                balanceBefore: t.balance_before,
                balanceAfter: t.balance_after,
                reference: t.reference,
                date: t.created_at
            }))
        });
    } catch (err) {
        console.warn('[MatrixMoney] Transactions error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve transaction history' });
    }
});

module.exports = router;
