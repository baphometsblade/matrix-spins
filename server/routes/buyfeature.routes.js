const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');
const gameEngine = require('../services/game-engine');
const houseEdge = require('../services/house-edge');
const games = require('../../shared/game-definitions');

const router = express.Router();

// Session win cap duration — mirrors spin.routes.js
const SESSION_CAP_DURATION_HOURS = 24;

// ─── Buy-Feature Price Multipliers ───
// Real-world buy-feature pricing from major providers (Pragmatic Play, etc.):
//   Low volatility:        60x bet  (lower risk = cheaper buy-in)
//   Medium volatility:     80x bet  (standard pricing)
//   Medium-High volatility: 90x bet
//   High volatility:      100x bet  (higher potential = premium price)
const BUY_MULTIPLIERS = {
    'low':         60,
    'medium':      80,
    'medium-high': 90,
    'high':       100,
};

function getBuyMultiplier(game) {
    const vol = (game.volatility || 'medium').toLowerCase();
    return BUY_MULTIPLIERS[vol] || BUY_MULTIPLIERS['medium'];
}

/**
 * Helper — apply win cap metadata (mirrors spin.routes.js logic)
 */
function applyWinCapMetadata(spinResult, uncappedWinAmount, cappedWinAmount) {
    if (cappedWinAmount >= uncappedWinAmount) return;

    const moneyPattern = /\$\d[\d,]*(?:\.\d{1,2})?/g;
    const cappedText = `$${cappedWinAmount.toFixed(2)}`;
    const uncappedText = `$${uncappedWinAmount.toFixed(2)}`;
    const details = (spinResult.winDetails && typeof spinResult.winDetails === 'object')
        ? { ...spinResult.winDetails }
        : { type: 'win', message: '' };

    if (typeof details.message === 'string' && details.message.length > 0) {
        const matches = details.message.match(moneyPattern);
        if (matches && matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const lastIndex = details.message.lastIndexOf(lastMatch);
            details.message = `${details.message.slice(0, lastIndex)}${cappedText}${details.message.slice(lastIndex + lastMatch.length)}`;
        } else {
            details.message = `${details.message} ${cappedText}`;
        }

        if (!/capped/i.test(details.message)) {
            details.message += ` (capped from ${uncappedText})`;
        }
    } else {
        details.message = `WIN! ${cappedText} (capped from ${uncappedText}).`;
    }

    details.capped = true;
    details.originalWinAmount = uncappedWinAmount;
    details.cappedWinAmount = cappedWinAmount;
    spinResult.winDetails = details;

    if (spinResult.freeSpinState && typeof spinResult.freeSpinState.totalWin === 'number') {
        const capDelta = uncappedWinAmount - cappedWinAmount;
        if (capDelta > 0) {
            const nextTotal = spinResult.freeSpinState.totalWin - capDelta;
            spinResult.freeSpinState.totalWin = Math.max(0, Math.round(nextTotal * 100) / 100);
        }
    }
}

// ─── GET /price/:gameId ─── Get buy-feature price for a game ───
router.get('/price/:gameId', authenticate, async (req, res) => {
    try {
        const { gameId } = req.params;

        const game = games.find(g => g.id === gameId);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        // Game must have free spins to support buy-feature
        if (!game.freeSpinsCount || game.freeSpinsCount <= 0) {
            return res.status(400).json({ error: 'This game does not support buy-feature (no free spins bonus)' });
        }

        const multiplier = getBuyMultiplier(game);
        const minBet = game.minBet || config.MIN_BET;
        const maxBet = game.maxBet || config.MAX_BET;

        res.json({
            gameId: game.id,
            multiplier,
            priceAtMinBet: Math.round(minBet * multiplier * 100) / 100,
            priceAtMaxBet: Math.round(maxBet * multiplier * 100) / 100,
        });
    } catch (err) {
        console.error('[BuyFeature] Price error:', err);
        res.status(500).json({ error: 'Failed to fetch buy-feature price' });
    }
});

// ─── POST / ─── Buy free spins and resolve the initial trigger spin ───
router.post('/', authenticate, async (req, res) => {
    try {
        const { gameId, betAmount } = req.body;
        const userId = req.user.id;

        // ── Validate game ──
        const game = games.find(g => g.id === gameId);
        if (!game) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        // ── Game must support free spins ──
        if (!game.freeSpinsCount || game.freeSpinsCount <= 0) {
            return res.status(400).json({ error: 'This game does not support buy-feature (no free spins bonus)' });
        }

        // ── Validate bet ──
        const bet = parseFloat(betAmount);
        if (isNaN(bet) || bet <= 0) {
            return res.status(400).json({ error: 'Invalid bet amount' });
        }
        if (bet < (game.minBet || config.MIN_BET)) {
            return res.status(400).json({ error: `Minimum bet is $${game.minBet || config.MIN_BET}` });
        }
        if (bet > (game.maxBet || config.MAX_BET)) {
            return res.status(400).json({ error: `Maximum bet is $${game.maxBet || config.MAX_BET}` });
        }
        if (bet > config.MAX_BET) {
            return res.status(400).json({ error: `Maximum bet is $${config.MAX_BET}` });
        }

        // ── Calculate buy price ──
        const buyMultiplier = getBuyMultiplier(game);
        const buyPrice = Math.round(bet * buyMultiplier * 100) / 100;

        // ── Check balance (fresh from DB) ──
        const currentUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (currentUser.balance < buyPrice) {
            return res.status(400).json({
                error: 'Insufficient balance',
                required: buyPrice,
                available: currentUser.balance,
            });
        }

        // ── Deduct buy price (atomic, race-safe) ──
        const balanceBefore = currentUser.balance;
        const balanceAfterBuy = Math.round((balanceBefore - buyPrice) * 100) / 100;
        const debit = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [buyPrice, userId, buyPrice]
        );
        const debitRows = (debit && (debit.changes || debit.rowCount)) || 0;
        if (debitRows === 0) {
            return res.status(400).json({ error: 'Insufficient balance (concurrent debit detected)' });
        }

        // Log buy-feature transaction
        await db.run(
            'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, 'buy_feature', -buyPrice, balanceBefore, balanceAfterBuy, `buy_feature:${gameId}`]
        );

        // ── Resolve spin with GUARANTEED free-spin trigger ──
        // We pass a freeSpinState that immediately activates the bonus round.
        // This is the core of buy-feature: the player pays the premium to skip
        // having to land scatters and goes directly into the bonus round.
        const guaranteedFreeSpinState = {
            active: true,
            remaining: game.freeSpinsCount,
            multiplier: 1,
            cascadeLevel: 0,
            totalWin: 0,
        };

        const gameStats = await houseEdge.getGameStats(db, gameId);
        const spinResult = await gameEngine.resolveSpin(game, bet, gameStats, guaranteedFreeSpinState, db);

        // ── Apply per-spin win cap (house protection) ──
        const uncappedWinAmount = spinResult.winAmount;
        const cappedWinAmount = await houseEdge.capWinAmount(uncappedWinAmount, bet, game, db);
        spinResult.winAmount = cappedWinAmount;
        applyWinCapMetadata(spinResult, uncappedWinAmount, cappedWinAmount);

        // ── Enforce session win cap ($50k cumulative ceiling) ──
        const capRow = await db.get('SELECT total_wins, session_start FROM session_win_caps WHERE user_id = ?', [userId]);
        let sessionWins = 0;
        if (capRow) {
            const sessionAge = (Date.now() - new Date(capRow.session_start + 'Z').getTime()) / 3600000;
            if (sessionAge < SESSION_CAP_DURATION_HOURS) {
                sessionWins = capRow.total_wins;
            } else {
                await db.run("UPDATE session_win_caps SET total_wins = 0, session_start = datetime('now') WHERE user_id = ?", [userId]);
            }
        }
        const remaining = Math.max(0, config.SESSION_WIN_CAP - sessionWins);
        const sessionCapped = Math.min(spinResult.winAmount, remaining);
        if (sessionCapped < spinResult.winAmount) {
            applyWinCapMetadata(spinResult, spinResult.winAmount, sessionCapped);
            spinResult.winAmount = sessionCapped;
        }
        if (sessionCapped > 0) {
            await db.run(
                `INSERT INTO session_win_caps (user_id, total_wins, session_start)
                 VALUES (?, ?, datetime('now'))
                 ON CONFLICT(user_id) DO UPDATE SET total_wins = total_wins + ?`,
                [userId, sessionCapped, sessionCapped]
            );
        }

        // ── Credit win (atomic accumulator) ──
        let finalBalance = balanceAfterBuy;
        if (spinResult.winAmount > 0) {
            finalBalance = Math.round((balanceAfterBuy + spinResult.winAmount) * 100) / 100;
            await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [spinResult.winAmount, userId]);

            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'win', spinResult.winAmount, balanceAfterBuy, finalBalance, `buy_feature_win:${gameId}`]
            );
        }

        // ── Log spin (bet_amount recorded as buyPrice for stats tracking) ──
        await db.run(
            'INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, rng_seed) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, gameId, buyPrice, JSON.stringify(spinResult.grid), spinResult.winAmount, spinResult.seed]
        );

        // ── Update game stats (house edge tracking) ──
        await houseEdge.updateGameStats(db, gameId, buyPrice, spinResult.winAmount);

        // ── Response ──
        res.json({
            grid: spinResult.grid,
            winAmount: spinResult.winAmount,
            winDetails: spinResult.winDetails,
            freeSpinsAwarded: game.freeSpinsCount,
            freeSpinState: spinResult.freeSpinState,
            balance: finalBalance,
            buyPrice,
            buyMultiplier,
        });

    } catch (err) {
        console.error('[BuyFeature] Error:', err);
        res.status(500).json({ error: 'Buy-feature failed' });
    }
});

module.exports = router;
