const express = require('express');
const { authenticate } = require('../middleware/auth');
const db = require('../database');
const config = require('../config');
const gameEngine = require('../services/game-engine');
const houseEdge = require('../services/house-edge');
const games = require('../../shared/game-definitions');
const path = require('path');
const fs = require('fs');

// Pre-index game definitions for O(1) lookup
const gameIndex = new Map();
(Array.isArray(games) ? games : []).forEach(g => { if (g && g.id) gameIndex.set(g.id, g); });

// ── Load game-registry.js (browser file) for hyphenated-slug game lookup ──
// The 100 game HTML pages use hyphenated IDs (e.g. 'golden-cherry-cascade')
// while game-definitions.js uses underscore IDs (e.g. 'sugar_rush').
// These are entirely different game catalogs so we need both indexed.
const slugIndex = new Map();
try {
    const registryPath = path.resolve(__dirname, '../../js/game-registry.js');
    const registryCode = fs.readFileSync(registryPath, 'utf8');
    // Evaluate in a minimal sandbox that provides 'window'
    const sandbox = { window: { STUDIO_CONFIG: {}, GAME_REGISTRY: [] } };
    (new Function('window', registryCode)).call(sandbox, sandbox.window);
    const registry = sandbox.window.GAME_REGISTRY || [];
    registry.forEach(function(entry) {
        if (!entry || !entry.id) return;
        // Build a game-engine-compatible object from registry data.
        // The game-engine requires: id, symbols, gridCols, gridRows, winType,
        // wildSymbol, scatterSymbol, rtp, bonusType, freeSpinsCount, payouts, minBet, maxBet, etc.
        const symbols = Array.isArray(entry.symbols) ? entry.symbols : ['s1','s2','s3','s4','s5','wild'];
        const wildSymbol = symbols.find(function(s) { return s.includes('wild'); }) || symbols[symbols.length - 1];
        const scatterSymbol = symbols.find(function(s) { return s.includes('scatter'); }) || symbols[symbols.length - 2];
        const reels = entry.reels || 5;
        const rows = entry.rows || 3;
        // Determine winType: small grids = classic, large grids = cluster, standard = payline
        let winType = 'payline';
        if (reels <= 3 && rows <= 3) winType = 'classic';
        else if (reels >= 6 && rows >= 5) winType = 'cluster';
        // Build standard payouts based on game structure
        const payouts = winType === 'classic'
            ? { triple: 100, double: 10, wildTriple: 150, scatterPay: 5 }
            : winType === 'cluster'
            ? { triple: 130, double: 13, wildTriple: 200, scatterPay: 5, cluster5: 5, cluster8: 15, cluster12: 50, cluster15: 140 }
            : { triple: 100, double: 10, wildTriple: 150, scatterPay: 5, payline3: 10, payline4: 50, payline5: 100 };
        const gameDef = {
            id: entry.id,
            name: entry.name || entry.id,
            provider: entry.studio || 'Matrix Spins',
            themeCategory: (entry.theme || '').toLowerCase(),
            symbols: symbols,
            gridCols: reels,
            gridRows: rows,
            template: reels <= 3 ? 'classic' : reels >= 6 ? 'scatter' : 'standard',
            winType: winType,
            clusterMin: winType === 'cluster' ? (reels >= 7 ? 5 : 8) : undefined,
            wildSymbol: wildSymbol,
            scatterSymbol: scatterSymbol,
            rtp: entry.rtp || 90,
            volatility: entry.volatility || 'medium',
            bonusType: 'free_spins',
            freeSpinsCount: 10,
            freeSpinsRetrigger: true,
            payouts: payouts,
            minBet: entry.minBet || 0.20,
            maxBet: entry.maxBet || 100,
            paylines: entry.paylines || (reels * rows),
            hot: false,
            jackpot: 0
        };
        slugIndex.set(entry.id, gameDef);
    });
    console.log(`[Spin] Loaded ${slugIndex.size} slug-indexed games from game-registry.js`);
} catch (err) {
    console.warn('[Spin] Could not load game-registry.js for slug index:', err.message);
}

// Unified lookup: checks underscore-ID gameIndex first, then hyphenated-slug slugIndex
function lookupGame(id) {
    return gameIndex.get(id) || slugIndex.get(id) || null;
}

const jackpotService = require('../services/jackpot.service');
const reengageTriggers = require('../services/reengage-triggers.service');
const playerAnalytics = require('../services/player-analytics.service');
const spinMutex = require('../services/spin-mutex');
const router = express.Router();

// ── Spin idempotency guard: prevents double-spend from concurrent requests ──
// Shared across /api/spin and /api/buy-feature via server/services/spin-mutex.js
// so a user cannot race the two endpoints against each other.
const activeSpins = {
    has: (uid) => spinMutex.isLocked(uid),
    set: (uid, _meta) => spinMutex.tryAcquire(uid, 'spin'),
    delete: (uid) => spinMutex.release(uid),
};

// ── Daily-missions helpers (shared logic, used in fire-and-forget block) ──
const DAILY_MISSION_TEMPLATES = [
    { type: 'spins', target: 5,   reward_type: 'cash',   reward_amount: 0.50, label: 'Spin 5 times'    },
    { type: 'spins', target: 10,  reward_type: 'cash',   reward_amount: 1.00, label: 'Spin 10 times'   },
    { type: 'wins',  target: 3,   reward_type: 'cash',   reward_amount: 0.50, label: 'Win 3 times'     },
    { type: 'wins',  target: 5,   reward_type: 'cash',   reward_amount: 1.00, label: 'Win 5 times'     },
    { type: 'bet',   target: 5,   reward_type: 'points', reward_amount: 50,   label: 'Wager $5 total'  },
    { type: 'bet',   target: 10,  reward_type: 'cash',   reward_amount: 0.75, label: 'Wager $10 total' },
    { type: 'spins', target: 20,  reward_type: 'points', reward_amount: 100,  label: 'Spin 20 times'   },
    { type: 'wins',  target: 10,  reward_type: 'cash',   reward_amount: 1.50, label: 'Win 10 times'    },
];

function _dmSeededPick(seed, arr, count) {
    let s = seed;
    const shuffle = arr.slice();
    for (let i = shuffle.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        const j = Math.abs(s) % (i + 1);
        [shuffle[i], shuffle[j]] = [shuffle[j], shuffle[i]];
    }
    return shuffle.slice(0, count);
}

function getDayMissions() {
    const today = new Date().toISOString().slice(0, 10);
    const seed  = today.split('-').reduce(function(acc, n) { return acc * 31 + parseInt(n, 10); }, 0);
    return _dmSeededPick(seed, DAILY_MISSION_TEMPLATES, 3).map(function(t, i) { return Object.assign({}, t, { slot: i }); });
}

let _dmSchemaReady = false;
async function ensureDailyMissionsSchema() {
    if (_dmSchemaReady) return;
    const _isPg  = db.isPg();
    const _idDef = _isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await db.run(
        'CREATE TABLE IF NOT EXISTS daily_mission_progress (' +
        '  id            ' + _idDef + ',' +
        '  user_id       INTEGER NOT NULL,' +
        '  mission_date  TEXT    NOT NULL,' +
        '  slot          INTEGER NOT NULL,' +
        '  progress      REAL    DEFAULT 0,' +
        '  completed     INTEGER DEFAULT 0,' +
        '  claimed       INTEGER DEFAULT 0,' +
        '  UNIQUE(user_id, mission_date, slot)' +
        ')'
    );
    try { await db.run('ALTER TABLE users ADD COLUMN loyalty_points INTEGER DEFAULT 0'); } catch (_) {}
    try { await db.run('ALTER TABLE users ADD COLUMN free_spin_state_json TEXT'); } catch (_) {}
    _dmSchemaReady = true;
}
// Ensure VIP columns exist
let _vipSchemaReady = false;
async function ensureVipSchema() {
    if (_vipSchemaReady) return;
    try { await db.run('ALTER TABLE users ADD COLUMN vip_level INTEGER DEFAULT 0'); } catch (_) {}
    _vipSchemaReady = true;
}


// Rate limiting state per user
const lastSpinTime = new Map();
const freeSpinStateByUser = new Map();
// Anti-fraud spin velocity tracking per user
const spinTimestamps = new Map(); // userId -> { last: timestamp, recentSpins: [timestamps] }
const MIN_SPIN_INTERVAL_MS = 150;
const BURST_WINDOW_MS = 30000;
const BURST_MAX_SPINS = 100;
// Session win cap duration — caps reset after 24 hours
const SESSION_CAP_DURATION_HOURS = 24;

// Cleanup idle spin tracking entries every 10 minutes
setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h TTL
    for (const [uid, data] of spinTimestamps) {
        if (data.last < cutoff) spinTimestamps.delete(uid);
    }
}, 10 * 60 * 1000);

// Cleanup idle lastSpinTime entries every 10 minutes
setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000; // 1h TTL
    for (const [uid, ts] of lastSpinTime) {
        if (ts < cutoff) lastSpinTime.delete(uid);
    }
}, 10 * 60 * 1000);

// Cleanup idle freeSpinState entries every 30 minutes
setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2h TTL
    for (const [uid, state] of freeSpinStateByUser) {
        if (!state || !state.lastUpdated || state.lastUpdated < cutoff) freeSpinStateByUser.delete(uid);
    }
}, 30 * 60 * 1000);

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

// ── GET /api/spin/games/:id — fetch game configuration for the slot UI ──
router.get('/games/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || typeof id !== 'string' || id.length > 80) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }
        const game = lookupGame(id);
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        // Build response in the format casino-engine.js expects:
        // game.minBetCents, game.maxBetCents, game.betStepCents, game.name,
        // game.rtp, game.volatility, game.paylines, game.reels, game.rows
        const minBetCents = Math.round((game.minBet || 0.20) * 100);
        const maxBetCents = Math.round((game.maxBet || 100) * 100);
        const betStepCents = minBetCents; // step = minBet (standard pattern)
        const reels = game.gridCols || 5;
        const rows = game.gridRows || 3;
        // paylines: game-definitions don't always store paylines; estimate from grid
        const paylines = game.paylines || (reels * rows) || 20;
        res.json({
            game: {
                id: game.id,
                name: game.name || game.id,
                rtp: game.rtp || 90,
                volatility: game.volatility || 'medium',
                reels: reels,
                rows: rows,
                paylines: paylines,
                minBetCents: minBetCents,
                maxBetCents: maxBetCents,
                betStepCents: betStepCents,
                symbols: game.symbols || [],
                wildSymbol: game.wildSymbol || null,
                scatterSymbol: game.scatterSymbol || null,
                bonusType: game.bonusType || null,
                bonusDesc: game.bonusDesc || '',
                provider: game.provider || 'Matrix Spins',
                jackpot: game.jackpot || 0
            }
        });
    } catch (err) {
        console.error('[Spin] GET /games/:id error:', err.message);
        res.status(500).json({ error: 'Failed to load game' });
    }
});

// POST /api/spin
router.post('/', authenticate, async (req, res) => {
    try {
        const { gameId, betAmount } = req.body;
        const userId = req.user.id;

        // ── Idempotency: reject if this user already has a spin in flight ──
        if (activeSpins.has(userId)) {
            return res.status(429).json({ error: 'Spin already in progress. Please wait.' });
        }
        activeSpins.set(userId, { timestamp: Date.now() });

        // IMPROVEMENT: Validate inputs before any DB queries
        if (!gameId || typeof gameId !== 'string') {
            activeSpins.delete(userId);
            return res.status(400).json({ error: 'Game ID is required' });
        }
        if (typeof gameId !== 'string' || gameId.length > 50) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: 'Invalid game ID format' });
        }
        if (typeof betAmount !== 'number' || !isFinite(betAmount) || betAmount <= 0) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: 'Valid bet amount is required' });
        }

        // ── Check self-exclusion before allowing spin ──
        const exclusion = await db.get(
            "SELECT id, user_id, is_active, ends_at FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
            [userId]
        );
        if (exclusion) {
            activeSpins.delete(userId);
            console.warn(`[Spin] User ${userId} attempted spin while self-excluded`);
            return res.status(403).json({ error: 'Your account is currently self-excluded from playing.' });
        }

        // ── Anti-fraud spin velocity check ──
        const now = Date.now();
        let userSpinData = spinTimestamps.get(userId) || { last: 0, recentSpins: [] };

        // Check minimum interval (500ms between spins)
        if (now - userSpinData.last < MIN_SPIN_INTERVAL_MS) {
            activeSpins.delete(userId);
            return res.status(429).json({ error: 'Too fast. Please slow down.' });
        }

        // Track recent spins for burst detection
        userSpinData.recentSpins = userSpinData.recentSpins.filter(t => now - t < BURST_WINDOW_MS);
        userSpinData.recentSpins.push(now);
        userSpinData.last = now;
        spinTimestamps.set(userId, userSpinData);

        // ROUND 35: BLOCK burst pattern (was only logging — users could exploit race conditions
        // in the 2-second RTP cache by flooding 100+ spins before stats update).
        // Now enforced: reject spins beyond BURST_MAX_SPINS in the burst window.
        if (userSpinData.recentSpins.length > BURST_MAX_SPINS) {
            activeSpins.delete(userId);
            console.warn(`[Spin] BLOCKED burst: User ${userId} — ${userSpinData.recentSpins.length} spins in ${BURST_WINDOW_MS}ms`);
            return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
        }

        // ── Validate game ──
        const game = lookupGame(gameId);
        if (!game) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        // ── Rental access check for locked premium games ──────────────────
        const rentalService = require('../services/rental.service');
        if (rentalService.getLockedGames().includes(gameId)) {
            const hasAccess = await rentalService.isUnlocked(userId, gameId);
            if (!hasAccess) {
                activeSpins.delete(userId);
                return res.status(403).json({
                    error: 'game_locked',
                    message: 'Purchase access to play this premium game'
                });
            }
        }

        // ── Validate bet ──
        // `let` because the bet can be overridden below to the locked
        // triggering bet when this spin is consuming a free spin.
        let bet = parseFloat(betAmount);
        // ROUND 55: Use Number.isFinite — isNaN alone allows Infinity to pass
        if (!Number.isFinite(bet) || bet <= 0) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: 'Invalid bet amount' });
        }
        if (bet < game.minBet) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: `Minimum bet is $${game.minBet}` });
        }
        if (bet > game.maxBet) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: `Maximum bet is $${game.maxBet}` });
        }
        if (bet > config.MAX_BET) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: `Maximum bet is $${config.MAX_BET}` });
        }

        // ── Daily wager limit enforcement (Responsible Gambling §12) ──
        {
            let wagerLimitRow;
            try {
                wagerLimitRow = await db.get(
                    'SELECT daily_wager_limit FROM user_limits WHERE user_id = ?', [userId]
                );
            } catch (wlErr) {
                console.warn('[Spin] Wager limit check failed:', wlErr.message);
                // Fail open — table column may not exist yet
            }
            if (wagerLimitRow && wagerLimitRow.daily_wager_limit > 0) {
                let todayWagered;
                try {
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    todayWagered = await db.get(
                        "SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ? AND created_at >= ?",
                        [userId, todayStart.toISOString()]
                    );
                } catch (twErr) {
                    console.warn('[Spin] Daily wager sum failed:', twErr.message);
                }
                if (todayWagered) {
                    const remaining = wagerLimitRow.daily_wager_limit - todayWagered.total;
                    if (remaining <= 0) {
                        activeSpins.delete(userId);
                        return res.status(400).json({
                            error: 'Daily wager limit of $' + wagerLimitRow.daily_wager_limit.toFixed(2) + ' reached. Limit resets at midnight.',
                            dailyWagerLimitReached: true
                        });
                    }
                    if (bet > remaining) {
                        activeSpins.delete(userId);
                        return res.status(400).json({
                            error: 'Bet exceeds remaining daily wager allowance ($' + remaining.toFixed(2) + ' left).',
                            dailyWagerRemaining: remaining
                        });
                    }
                }
            }
        }

        // ── ROUND 26: Max bet cap during active wagering requirement ──
        // Industry standard: players with bonus wagering active cannot bet more than
        // 10% of their wagering requirement or $10, whichever is lower.
        // Prevents clearing wagering with a single large bet to extract bonus funds.
        {
            let wagerUser;
            try {
                wagerUser = await db.get(
                    'SELECT wagering_requirement, wagering_progress FROM users WHERE id = ?',
                    [userId]
                );
            } catch (wagerErr) {
                // ROUND 31: Fail CLOSED — was catch(_){} which silently bypassed wagering bet cap.
                // If we can't check wagering, we can't allow the spin (player might be exploiting).
                console.error('[Spin] Wagering check failed:', wagerErr.message);
                activeSpins.delete(userId);
                return res.status(500).json({ error: 'Security check failed. Please try again.' });
            }
            if (wagerUser && wagerUser.wagering_requirement > 0 && wagerUser.wagering_progress < wagerUser.wagering_requirement) {
                var maxWagerBet = Math.max(1, Math.min(10, wagerUser.wagering_requirement * 0.10));
                if (bet > maxWagerBet) {
                    activeSpins.delete(userId);
                    return res.status(400).json({
                        error: 'Maximum bet while bonus wagering is active is $' + maxWagerBet.toFixed(2) + '. Complete your wagering requirement first.',
                        maxBetDuringWagering: maxWagerBet,
                        wageringRemaining: wagerUser.wagering_requirement - wagerUser.wagering_progress
                    });
                }
            }
        }

        // ── Per-spin max-bet limit (responsible-gambling user setting) ──
        try {
            const maxBetRow = await db.get(
                'SELECT max_bet_per_spin, pending_max_bet, pending_max_bet_at FROM user_limits WHERE user_id = ?',
                [userId]
            );
            if (maxBetRow) {
                let effectiveMax = maxBetRow.max_bet_per_spin;
                if (maxBetRow.pending_max_bet && maxBetRow.pending_max_bet_at &&
                    new Date(maxBetRow.pending_max_bet_at) <= new Date()) {
                    effectiveMax = maxBetRow.pending_max_bet;
                }
                if (effectiveMax !== null && effectiveMax !== undefined && bet > effectiveMax) {
                    activeSpins.delete(userId);
                    return res.status(403).json({
                        error: 'max_bet_per_spin',
                        message: 'Your per-spin max bet is $' + Number(effectiveMax).toFixed(2) + '.',
                        limit: Number(effectiveMax)
                    });
                }
            }
        } catch (mbErr) {
            // user_limits column may not exist yet — skip
            if (mbErr.message && !/no such column|column .* does not exist/i.test(mbErr.message)) {
                console.warn('[Spin] max-bet check error:', mbErr.message);
            }
        }

        // ── Weekly / Monthly loss-limit check (CLAUDE.md responsible gambling) ──
        try {
            const llRow = await db.get(
                'SELECT weekly_loss_limit, monthly_loss_limit, ' +
                'pending_weekly_loss, pending_weekly_loss_at, pending_monthly_loss, pending_monthly_loss_at ' +
                'FROM user_limits WHERE user_id = ?',
                [userId]
            );
            if (llRow) {
                const now = new Date();
                const effective = (cur, pend, pendAt) => {
                    if (pend !== null && pend !== undefined && pendAt && new Date(pendAt) <= now) return pend;
                    return cur;
                };
                const weeklyLim = effective(llRow.weekly_loss_limit, llRow.pending_weekly_loss, llRow.pending_weekly_loss_at);
                const monthlyLim = effective(llRow.monthly_loss_limit, llRow.pending_monthly_loss, llRow.pending_monthly_loss_at);

                const computeLoss = async (sinceClause) => {
                    const r = await db.get(
                        "SELECT COALESCE(SUM(bet_amount), 0) as wagered, COALESCE(SUM(win_amount), 0) as won " +
                        "FROM spins WHERE user_id = ? AND created_at >= " + sinceClause,
                        [userId]
                    );
                    return Math.max(0, Number((r?.wagered || 0)) - Number((r?.won || 0)));
                };

                if (weeklyLim !== null && weeklyLim !== undefined) {
                    const wkLoss = await computeLoss("datetime('now', '-7 days')");
                    if (wkLoss + bet > weeklyLim) {
                        activeSpins.delete(userId);
                        return res.status(403).json({
                            error: 'weekly_loss_limit',
                            message: 'Weekly loss limit reached',
                            weeklyLoss: wkLoss, limit: weeklyLim
                        });
                    }
                }
                if (monthlyLim !== null && monthlyLim !== undefined) {
                    const mLoss = await computeLoss("datetime('now', 'start of month')");
                    if (mLoss + bet > monthlyLim) {
                        activeSpins.delete(userId);
                        return res.status(403).json({
                            error: 'monthly_loss_limit',
                            message: 'Monthly loss limit reached',
                            monthlyLoss: mLoss, limit: monthlyLim
                        });
                    }
                }
            }
        } catch (llErr) {
            if (llErr.message && !/no such column|column .* does not exist/i.test(llErr.message)) {
                console.warn('[Spin] weekly/monthly loss check error:', llErr.message);
            }
        }

        // ── Daily loss limit check (before spinning) ──
        const lossLimitService = require('../services/loss-limit.service');
        const lossCheck = await lossLimitService.checkDailyLossLimit(userId, bet);
        if (!lossCheck.allowed) {
            // Re-read balance in case cashback was just credited
            activeSpins.delete(userId); // Release lock before early return
            const updatedUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            return res.status(403).json({
                error: 'daily_loss_limit',
                message: 'Daily loss limit reached',
                dailyLoss: lossCheck.dailyLoss,
                limit: lossCheck.limit,
                cashback: lossCheck.cashback,
                balance: updatedUser ? updatedUser.balance : undefined
            });
        }

        // ── Session time limit check (auto-starts session on first spin) ──
        const sessionTimer = require('../services/session-timer.service');
        const sessionCheck = await sessionTimer.checkSession(userId);
        if (!sessionCheck.allowed) {
            activeSpins.delete(userId);
            return res.status(403).json({
                error: 'session_time_limit',
                message: 'You have reached your session time limit. Please take a break and return later.',
                elapsed: sessionCheck.elapsed,
                limit: sessionCheck.limit
            });
        }

        // ── Check balance (fresh from DB) ──
        const currentUser = await db.get('SELECT balance, free_spin_state_json FROM users WHERE id = ?', [userId]);
        if (!currentUser) {
            activeSpins.delete(userId);
            return res.status(404).json({ error: 'User not found' });
        }

        // Restore free-spin state from DB if Map was cleared (e.g. server restart)
        let existingFreeSpinState = freeSpinStateByUser.get(userId) || null;
        if (!existingFreeSpinState && currentUser.free_spin_state_json) {
            try {
                const parsed = JSON.parse(currentUser.free_spin_state_json);
                if (parsed && parsed.active && parsed.remaining > 0) {
                    existingFreeSpinState = parsed;
                    freeSpinStateByUser.set(userId, parsed);
                }
            } catch (parseErr) { console.warn('[Spin] Free spin JSON parse error:', parseErr.message); }
        }
        // SECURITY: Free spins are locked to the game that awarded them.
        // Reject if user tries to use free spins on a different game.
        if (existingFreeSpinState && existingFreeSpinState.gameId && existingFreeSpinState.gameId !== gameId) {
            console.warn(`[Spin] Free spin game mismatch: user ${userId} has spins for ${existingFreeSpinState.gameId} but requested ${gameId}`);
            existingFreeSpinState = null; // Don't use mismatched free spins
        }
        const usedFreeSpin = Boolean(
            existingFreeSpinState
            && existingFreeSpinState.active
            && existingFreeSpinState.remaining > 0
        );

        // SECURITY: bet is locked to the triggering bet during a free-spin
        // round. Even if the client tampered with its UI and sent a
        // different bet, we override here so the server's game-engine
        // calculates wins against the triggering stake (industry standard
        // in every licensed gaming jurisdiction — the bonus was awarded
        // against one specific bet and its payout is pinned to it).
        if (usedFreeSpin && existingFreeSpinState && typeof existingFreeSpinState.triggerBet === 'number' && existingFreeSpinState.triggerBet > 0) {
            if (Math.abs(bet - existingFreeSpinState.triggerBet) > 0.001) {
                console.warn(`[Spin] bet-lock override: user ${userId} sent ${bet} during free spins, using locked ${existingFreeSpinState.triggerBet}`);
                bet = existingFreeSpinState.triggerBet;
            }
        }

        if (!usedFreeSpin && currentUser.balance < bet) {
            activeSpins.delete(userId);
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // ── Deduct bet (wrapped in transaction for atomicity) ──
        await db.beginTransaction();
        const balanceBefore = currentUser.balance;
        let balanceAfterBet = balanceBefore;
        if (!usedFreeSpin) {
            // Atomic: deduct only if balance is sufficient (single SQL statement)
            const deductResult = await db.run(
                'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
                [bet, userId, bet]
            );
            if (!deductResult || deductResult.changes === 0) {
                try { await db.rollback(); } catch(_rbErr) { console.warn('[Spin] balance deduct rollback error:', _rbErr.message); }
                activeSpins.delete(userId);
                return res.status(400).json({ error: 'Insufficient balance' });
            }
            balanceAfterBet = balanceBefore - bet;

            // Log bet transaction
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'bet', -bet, balanceBefore, balanceAfterBet, `spin:${gameId}`]
            );

            // Award loyalty point (fire-and-forget — never blocks spin)
            db.run(
                'UPDATE users SET loyalty_points = COALESCE(loyalty_points, 0) + 1, loyalty_lifetime = COALESCE(loyalty_lifetime, 0) + 1 WHERE id = ?',
                [userId]
            ).catch(function(err) { console.warn('[Spin] Loyalty point error:', err.message); });
        }

        // ── Resolve spin (server-side RNG + win calc) ──
        const gameStats = await houseEdge.getGameStats(db, gameId);

        // Check if user has active free spins (stored in memory per user)
        const spinResult = await gameEngine.resolveSpin(game, bet, gameStats, existingFreeSpinState, db);

        // Validate spin result structure
        if (!spinResult || typeof spinResult.winAmount !== 'number') {
            console.error('[Spin] Invalid spin result from engine:', JSON.stringify(spinResult));
            try { await db.rollback(); } catch(_rbErr) { console.warn('[Spin] invalid result rollback error:', _rbErr.message); }
            activeSpins.delete(userId);
            return res.status(500).json({ error: 'Spin failed - please try again' });
        }

        // ── Apply per-spin win cap (house protection with profit floor) ──
        const uncappedWinAmount = spinResult.winAmount;
        const cappedWinAmount = await houseEdge.capWinAmount(uncappedWinAmount, bet, game, db);
        spinResult.winAmount = cappedWinAmount;
        applyWinCapMetadata(spinResult, uncappedWinAmount, cappedWinAmount);

        // ── Bonus event payout multiplier ──
        let eventBonus = null;
        if (spinResult.winAmount > 0) {
            try {
                const eventService = require('../services/event.service');
                const activeEvent = await eventService.getActiveEventForGame(gameId, 'payout_boost');
                if (activeEvent && activeEvent.multiplier > 1) {
                    const baseWin = spinResult.winAmount;
                    // ROUND 35: Cap event multiplier to 2x max to prevent profit leaks.
                    // Previously, uncapped event multipliers could inflate wins past the house edge cap.
                    const clampedMult = Math.min(activeEvent.multiplier, 2.0);
                    const boostedWin = Math.round(baseWin * clampedMult * 100) / 100;
                    const bonusAmount = Math.round((boostedWin - baseWin) * 100) / 100;
                    spinResult.winAmount = boostedWin;
                    eventBonus = {
                        eventId: activeEvent.id,
                        eventName: activeEvent.name,
                        multiplier: clampedMult,
                        bonusAmount,
                    };
                }
            } catch (evtErr) {
                console.warn('[Spin] Event boost check error:', evtErr.message);
                // Non-blocking — proceed without boost
            }
        }

        // ── Apply active player boosts (BEFORE session cap) ────────────────
        // One DB call fetches all active boosts; avoids N separate hasBoost queries.
        let _boostWinBonus = 0;
        let _hasBpRush = false;
        let _hasGemMiner = false;
        if (!usedFreeSpin) {
            try {
                const boostService = require('../services/boost.service');
                const _activeBoosts = await boostService.getActiveBoosts(userId);
                const _hasMega = _activeBoosts.some(b => b.boost_type === 'mega_boost');
                const _hasLucky = _hasMega || _activeBoosts.some(b => b.boost_type === 'lucky_streak');
                _hasBpRush   = _hasMega || _activeBoosts.some(b => b.boost_type === 'bp_rush');
                _hasGemMiner = _hasMega || _activeBoosts.some(b => b.boost_type === 'gem_miner');
                // lucky_streak: +5% win bonus applied before session cap
                if (_hasLucky && spinResult.winAmount > 0) {
                    _boostWinBonus = Math.round(spinResult.winAmount * 0.05 * 100) / 100;
                    spinResult.winAmount = Math.round((spinResult.winAmount + _boostWinBonus) * 100) / 100;
                }
            } catch (_boostErr) {
                console.warn('[Boost] Boost check error:', _boostErr);
                // Non-blocking — proceed without boosts
            }
        }

        // ROUND 35: Re-apply win cap AFTER all multipliers (event + boost).
        // Previously, event multiplier (2x) and lucky_streak (+5%) were applied
        // AFTER capWinAmount, meaning a $500 capped win could become $1050.
        // Now we re-cap to ensure post-multiplier wins still respect house limits.
        if (spinResult.winAmount > cappedWinAmount && spinResult.winAmount > 0) {
            const reCapped = await houseEdge.capWinAmount(spinResult.winAmount, bet, game, db);
            if (reCapped < spinResult.winAmount) {
                spinResult.winAmount = reCapped;
            }
        }

        // ── Enforce session win cap (config.SESSION_WIN_CAP cumulative, persisted to DB) ──
        // Applied AFTER event multiplier + boosts so they cannot bypass the cap
        // Atomic: uses CASE clamp so concurrent spins cannot exceed the cap
        if (spinResult.winAmount > 0) {
            // Expire old sessions atomically
            await db.run(
                "UPDATE session_win_caps SET total_wins = 0, session_start = datetime('now') WHERE user_id = ? AND (julianday('now') - julianday(session_start)) * 24 >= ?",
                [userId, SESSION_CAP_DURATION_HOURS]
            );

            // Read current total — safe under single-instance because activeSpins
            // blocks concurrent spins per userId. Under multi-instance load balancing,
            // this read could be stale, allowing a user to overshoot the cap by one
            // spin's worth (the DB counter is still clamped atomically below).
            const capRow = await db.get('SELECT total_wins FROM session_win_caps WHERE user_id = ?', [userId]);
            const sessionWins = capRow ? capRow.total_wins : 0;
            const remaining = Math.max(0, config.SESSION_WIN_CAP - sessionWins);
            const sessionCapped = Math.min(spinResult.winAmount, remaining);

            if (sessionCapped < spinResult.winAmount) {
                applyWinCapMetadata(spinResult, spinResult.winAmount, sessionCapped);
                spinResult.winAmount = sessionCapped;
            }

            if (sessionCapped > 0) {
                // Atomic: clamp total_wins at SESSION_WIN_CAP to prevent concurrent spins from overshooting
                // Uses CASE instead of MIN() scalar to be PG-compatible (PG only allows MIN as aggregate)
                const clampedInsert = Math.min(sessionCapped, config.SESSION_WIN_CAP);
                await db.run(
                    `INSERT INTO session_win_caps (user_id, total_wins, session_start)
                     VALUES (?, ?, datetime('now'))
                     ON CONFLICT(user_id) DO UPDATE SET total_wins = CASE
                         WHEN session_win_caps.total_wins + ? > ? THEN ?
                         ELSE session_win_caps.total_wins + ? END`,
                    [userId, clampedInsert, sessionCapped, config.SESSION_WIN_CAP, config.SESSION_WIN_CAP, sessionCapped]
                );
            }
        }

        // Persist/clear active free-spin runtime state (Map + DB for restart-safety).
        // On the spin that FIRST activates free spins we pin the triggering
        // bet into freeSpinState.triggerBet so every subsequent spin in the
        // round is forced to use it (enforced above in the usedFreeSpin
        // override block). Industry-standard bet lock.
        if (spinResult.freeSpinState && spinResult.freeSpinState.active && spinResult.freeSpinState.remaining > 0) {
            if (typeof spinResult.freeSpinState.triggerBet !== 'number' || spinResult.freeSpinState.triggerBet <= 0) {
                spinResult.freeSpinState.triggerBet = bet;
            }
            spinResult.freeSpinState.lastUpdated = Date.now();
            freeSpinStateByUser.set(userId, spinResult.freeSpinState);
            await db.run('UPDATE users SET free_spin_state_json = ? WHERE id = ?',
                [JSON.stringify(spinResult.freeSpinState), userId]);
        } else {
            freeSpinStateByUser.delete(userId);
            await db.run('UPDATE users SET free_spin_state_json = NULL WHERE id = ?', [userId]);
        }

        // ── Credit win (atomic — prevents race condition balance overwrites) ──
        let finalBalance = balanceAfterBet;
        if (spinResult.winAmount > 0) {
            if (usedFreeSpin) {
                // Free spin winnings credit to bonus_balance with 10x wagering requirement
                // SECURITY: Accumulate wagering — don't reset progress or overwrite existing requirement
                const wageringReq = spinResult.winAmount * 10;
                await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                    [spinResult.winAmount, wageringReq, userId]);
                // Note: finalBalance shows total including bonus for display, but bonus_balance
                // is tracked separately and cannot be directly withdrawn
                finalBalance = balanceAfterBet;

                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, 'free_spin_win', spinResult.winAmount, balanceAfterBet, finalBalance, `spin:${gameId}`]
                );
            } else {
                // Regular win credits to balance
                await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [spinResult.winAmount, userId]);
                finalBalance = balanceAfterBet + spinResult.winAmount;

                await db.run(
                    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, 'win', spinResult.winAmount, balanceAfterBet, finalBalance, `spin:${gameId}`]
                );
            }
        }

        // -- Jackpot contribution + award check --
        if (!usedFreeSpin && bet > 0) {
            // Contribute to jackpot pool (await with timeout to avoid blocking spin on DB issues)
            try { await Promise.race([jackpotService.contribute(bet), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]); }
            catch (err) { console.warn('[Jackpot] Contribute error:', err.message); }

            // Check for jackpot win
            const isJackpotGame = Boolean(game.jackpot);
            const jackpotWin = await jackpotService.checkAndAward(userId, bet, game.minBet || 0.20, isJackpotGame);
            if (jackpotWin) {
                // ROUND 35: Cap jackpot win against profit floor.
                // Previously, jackpot wins bypassed capWinAmount() entirely —
                // a $50,000 Grand jackpot could drain the house to -$40,000.
                // Now jackpots are capped so house never goes below PROFIT_FLOOR.
                let jpAmount = jackpotWin.amount;
                try {
                    const jpStats = await houseEdge.getGlobalStats(db);
                    const currentProfit = jpStats ? (jpStats.wagered - jpStats.paid) : 0;
                    const profitFloor = config.PROFIT_FLOOR || 0;
                    const maxJpAllowed = Math.max(0, currentProfit - profitFloor);
                    if (jpAmount > maxJpAllowed && maxJpAllowed > 0) {
                        console.warn(`[Jackpot] Capping jackpot from $${jpAmount} to $${maxJpAllowed} (profit floor protection)`);
                        jpAmount = maxJpAllowed;
                    } else if (maxJpAllowed <= 0) {
                        console.warn(`[Jackpot] Blocking jackpot $${jpAmount} — house at/below profit floor`);
                        jpAmount = 0;
                    }
                } catch (jpCapErr) {
                    // Fail-closed: if we can't check profit, don't award jackpot
                    console.error('[Jackpot] Profit floor check failed (fail-closed):', jpCapErr.message);
                    jpAmount = 0;
                }
                jackpotWin.amount = jpAmount;

                if (jpAmount > 0) {
                    // Credit jackpot amount to user (atomic)
                    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [jpAmount, userId]);
                    const balanceBeforeJp = finalBalance;
                    finalBalance = balanceBeforeJp + jpAmount;
                    await db.run(
                        'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, 'jackpot', jackpotWin.amount, balanceBeforeJp, finalBalance, 'jackpot:' + jackpotWin.tier]
                    );
                    spinResult.jackpotWon = jackpotWin;
                }
            }
        }

        // ── Commit financial transaction (bet deduction + win credit are now atomic) ──
        await db.commit();

        // Release idempotency lock after commit
        activeSpins.delete(userId);

        // ── RTP monitoring: record bet/win for drift detection (fire-and-forget) ──
        {
            var rtpMonitor = require('../services/rtp-monitor.service');
            rtpMonitor.recordSpin(gameId, bet, spinResult.winAmount).catch(function(e) { console.warn('[RTP] recordSpin error:', e.message); });
            // Probabilistic drift check (~1% of spins to minimize overhead)
            // SECURITY: Use crypto RNG, not Math.random() (predictable in Node.js)
            if ((require('crypto').randomBytes(2).readUInt16BE(0) / 65536) < 0.01 && game.rtp) {
                rtpMonitor.checkDrift(gameId, game.rtp, 3).catch(function(e) { console.warn('[RTP] checkDrift error:', e.message); });
            }
        }

        // ── Tournament score submission (fire-and-forget) ──────────────────
        {
            const tournamentService = require('../services/tournament.service');
            const _winMult = bet > 0 ? Math.round((spinResult.winAmount / bet) * 100) / 100 : 0;
            if (_winMult > 0) {
                tournamentService.getActive().then(function(ts) {
                    ts.forEach(function(t) {
                        tournamentService.submitScore(t.id, userId, _winMult).catch(function(e) { console.warn('[Tournament] submitScore error:', e.message); });
                    });
                }).catch(function(e) { console.warn('[Tournament] getActive error:', e.message); });

                // Also record into weekly tournament_scores leaderboard
                (function() {
                    try {
                        const now = new Date();
                        const day = now.getUTCDay();
                        const daysBack = day === 0 ? 6 : day - 1;
                        const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
                        const weekStart = monday.toISOString().slice(0, 10);
                        const initScore = (_winMult * 10) + (spinResult.winAmount * 0.001);
                        db.run(
                            'INSERT INTO tournament_scores' +
                            '  (user_id, week_start, best_multiplier, total_wins, spin_count, score, updated_at)' +
                            " VALUES (?, ?, ?, ?, 1, ?, datetime('now'))" +
                            ' ON CONFLICT(user_id, week_start) DO UPDATE SET' +
                            '   spin_count      = tournament_scores.spin_count + 1,' +
                            '   total_wins      = tournament_scores.total_wins + excluded.total_wins,' +
                            '   best_multiplier = CASE WHEN excluded.best_multiplier > tournament_scores.best_multiplier THEN excluded.best_multiplier ELSE tournament_scores.best_multiplier END,' +
                            '   score           = (CASE WHEN excluded.best_multiplier > tournament_scores.best_multiplier THEN excluded.best_multiplier ELSE tournament_scores.best_multiplier END * 10) + ((tournament_scores.total_wins + excluded.total_wins) * 0.001),' +
                            "   updated_at      = datetime('now')",
                            [userId, weekStart, _winMult, spinResult.winAmount, initScore]
                        ).catch(function(e) { console.warn('[Tournament] score upsert error:', e.message); });
                    } catch (e) { console.warn('[Tournament] score update error:', e.message); }
                }());
            }
        }

        // ── Weekly contest entry (fire-and-forget) ──────────────────────
        if (!usedFreeSpin && bet > 0) {
            const contestService = require('../services/contest.service');
            contestService.recordContestEntry(userId, 'spins', 1).catch(function(e) { console.warn('[Contest] spins entry error:', e.message); });
            contestService.recordContestEntry(userId, 'total_wagered', bet).catch(function(e) { console.warn('[Contest] wagered entry error:', e.message); });
            if (spinResult.winAmount > 0) {
                contestService.recordContestEntry(userId, 'biggest_win', spinResult.winAmount).catch(function(e) { console.warn('[Contest] biggest_win error:', e.message); });
            }
        }

        // ── Hourly wager race entry (fire-and-forget) ────────────────────
        if (!usedFreeSpin && bet > 0) {
            require('../services/wagerace.service').recordWager(userId, bet).catch(function(e) { console.warn('[WageRace] recordWager error:', e.message); });
        }

        // ── Spin streak tick (fire-and-forget) ──────────────────────────
        if (!usedFreeSpin) {
            (async function () {
                try {
                    const _ssRow = await db.get('SELECT spin_streak_count, spin_streak_last FROM users WHERE id = ?', [userId]);
                    if (_ssRow !== undefined) {
                        const _ssNow = Date.now();
                        let _ssCnt = _ssRow ? (_ssRow.spin_streak_count || 0) : 0;
                        const _ssLast = _ssRow ? _ssRow.spin_streak_last : null;
                        // Reset streak if gap > 5 minutes
                        if (_ssLast && (_ssNow - new Date(_ssLast).getTime()) > 5 * 60 * 1000) _ssCnt = 0;
                        _ssCnt++;
                        await db.run('UPDATE users SET spin_streak_count = ?, spin_streak_last = ? WHERE id = ?',
                            [_ssCnt, new Date(_ssNow).toISOString().slice(0, 19).replace('T', ' '), userId]);
                    }
                } catch (_ssErr) { /* non-critical */ }
            }());
        }

        // ── Battle pass XP + gem miner boost (fire-and-forget) ──────────
        if (!usedFreeSpin && bet > 0) {
            (async function () {
                try {
                    const battlepassService = require('../services/battlepass.service');
                    await battlepassService.addXp(userId, bet);
                    if (_hasBpRush) { await battlepassService.addXp(userId, bet); } // bp_rush: 2x XP
                } catch (_bpErr) { console.warn('[BattlePass] addXp error:', _bpErr); }
            }());
            if (_hasGemMiner) {
                (async function () {
                    try {
                        await require('../services/gems.service').addGems(userId, 1, 'Boost: Gem Miner');
                    } catch (_gmErr) { console.warn('[GemMiner] addGems error:', _gmErr); }
                }());
            }
        }

        // ── Log spin ──
        await db.run(
            'INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, rng_seed) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, gameId, usedFreeSpin ? 0 : bet, JSON.stringify(spinResult.grid), spinResult.winAmount, spinResult.seed]
        );

        // ── Update game stats (house edge tracking) ──
        await houseEdge.updateGameStats(db, gameId, usedFreeSpin ? 0 : bet, spinResult.winAmount);

        // ── Accrue referral commissions on real-money spin losses ──
        // Tier 1 = 5% of net loss to direct referrer, Tier 2 = 1% to referrer's referrer.
        // Only fires for real bets within the 30-day commission window (service enforces).
        if (!usedFreeSpin && bet > 0) {
            (async function () {
                try {
                    const commissionService = require('../services/referral-commission.service');
                    await commissionService.accrueCommission(userId, bet, spinResult.winAmount);
                } catch (commErr) { console.warn('[Spin] commission accrue error:', commErr.message); }
            }());
        }

        // ── Daily challenges progress (async fire-and-forget, non-blocking) ──
        if (!usedFreeSpin) {
            (async function () {
                try {
                    const challengesService = require('../services/challenges.service');
                    const progressCalls = [
                        challengesService.updateProgress(userId, 'total_spins', 1)
                    ];
                    if (bet > 0) {
                        progressCalls.push(challengesService.updateProgress(userId, 'total_wager', bet));
                    }
                    if (spinResult.winAmount > 0) {
                        progressCalls.push(challengesService.updateProgress(userId, 'any_win', 1));
                    }
                    // big_win: only count wins >= $5 to track meaningful payouts
                    if (spinResult.winAmount >= 5) {
                        progressCalls.push(challengesService.updateProgress(userId, 'big_win', spinResult.winAmount));
                    }
                    // different_games: only increment on the first spin of this game today
                    const prevToday = await db.get(
                        "SELECT COUNT(*) as cnt FROM spins WHERE user_id = ? AND game_id = ? AND date(created_at) = date('now')",
                        [userId, gameId]
                    );
                    if (prevToday && prevToday.cnt <= 1) {
                        progressCalls.push(challengesService.updateProgress(userId, 'different_games', 1));
                    }
                    await Promise.all(progressCalls);
                } catch (e) {
                    console.warn('[Challenges] Progress error:', e);
                }
            }());
        }

        // ── Daily missions progress (async fire-and-forget, non-blocking) ──
        if (!usedFreeSpin) {
            (async function () {
                try {
                    await ensureDailyMissionsSchema();
        await ensureVipSchema();
                    const _dmToday = new Date().toISOString().slice(0, 10);
                    const _dmTemplates = getDayMissions();
                    const _dmSpins  = 1;
                    const _dmWins   = spinResult.winAmount > 0 ? 1 : 0;
                    const _dmBet    = bet || 0;
                    for (const _dmt of _dmTemplates) {
                        let _dmIncrement = 0;
                        if (_dmt.type === 'spins') _dmIncrement = _dmSpins;
                        else if (_dmt.type === 'wins')  _dmIncrement = _dmWins;
                        else if (_dmt.type === 'bet')   _dmIncrement = _dmBet;
                        if (_dmIncrement <= 0) continue;
                        const _dmUpsert = [
                            'INSERT INTO daily_mission_progress (user_id, mission_date, slot, progress, completed)',
                            'VALUES (?, ?, ?, ?, 0)',
                            'ON CONFLICT(user_id, mission_date, slot) DO UPDATE SET',
                            '  progress = MIN(daily_mission_progress.progress + ?, ?),',
                            '  completed = CASE WHEN MIN(daily_mission_progress.progress + ?, ?) >= ? THEN 1 ELSE completed END',
                        ].join(' ');
                        await db.run(_dmUpsert, [
                            userId, _dmToday, _dmt.slot, Math.min(_dmIncrement, _dmt.target),
                            _dmIncrement, _dmt.target,
                            _dmIncrement, _dmt.target, _dmt.target,
                        ]);
                    }
                } catch (_dmErr) {
                    console.warn('[DailyMissions] Progress error:', _dmErr);
                }
            }());
        }

        // ── Wagering progress tracking ──
        // Only apply wagering progress if:
        // 1. Not a free spin bet
        // 2. User has an active wagering requirement
        // 3. User hasn't met that specific requirement yet
        // Conversion only happens when the SAME bonus's wagering requirement is fully met
        // ROUND 29: Atomic wagering progress — prevents double-conversion race condition.
        // Old code: SELECT → compute → UPDATE (two concurrent spins could both convert bonus).
        // New code: Single atomic UPDATE with WHERE guard; only one spin can trigger conversion.
        if (!usedFreeSpin && bet > 0) {
            try {
                // Step 1: Atomically increment wagering_progress (capped at requirement)
                var wagerUpdateResult = await db.run(
                    `UPDATE users SET wagering_progress = MIN(COALESCE(wagering_progress, 0) + ?, COALESCE(wagering_requirement, 0))
                     WHERE id = ? AND COALESCE(wagering_requirement, 0) > 0 AND COALESCE(wagering_progress, 0) < COALESCE(wagering_requirement, 0)`,
                    [bet, userId]
                );

                // Step 2: If progress was updated, check if requirement is now met
                if (wagerUpdateResult && wagerUpdateResult.changes > 0) {
                    var wagerCheck = await db.get(
                        'SELECT wagering_requirement, wagering_progress, bonus_balance, balance FROM users WHERE id = ?',
                        [userId]
                    );
                    if (wagerCheck && wagerCheck.wagering_progress >= wagerCheck.wagering_requirement && wagerCheck.bonus_balance > 0) {
                        // Atomic conversion: zero out bonus+wagering AND add to balance in one UPDATE
                        // WHERE bonus_balance > 0 prevents double-conversion if another spin races us
                        var convResult = await db.run(
                            'UPDATE users SET balance = balance + bonus_balance, wagering_progress = 0, wagering_requirement = 0, bonus_balance = 0 WHERE id = ? AND bonus_balance > 0',
                            [userId]
                        );
                        if (convResult && convResult.changes > 0) {
                            var convertAmount = wagerCheck.bonus_balance;
                            finalBalance += convertAmount;
                            await db.run(
                                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                                [userId, 'bonus_conversion', convertAmount, wagerCheck.balance, wagerCheck.balance + convertAmount, 'Wagering requirement completed']
                            );
                            require('../services/achievement.service').grant(userId, 'wagering_done').catch(function(e) { console.warn('[Achievement] wagering_done grant error:', e.message); });
                        }
                    }
                }
            } catch (wagerErr) {
                console.warn('[Spin] Wagering progress error:', wagerErr.message);
            }
        }

        // Include wagering status in response
        let wageringStatus = null;
        try {
            const wu = await db.get(
                'SELECT bonus_balance, wagering_requirement, wagering_progress FROM users WHERE id = ?',
                [userId]
            );
            if (wu && wu.wagering_requirement > 0) {
                wageringStatus = {
                    bonusBalance: wu.bonus_balance,
                    requirement: wu.wagering_requirement,
                    progress: wu.wagering_progress,
                    complete: wu.wagering_progress >= wu.wagering_requirement,
                    pct: Math.min(100, Math.round((wu.wagering_progress / wu.wagering_requirement) * 100)),
                };
            }
        } catch (_wagerErr) { console.warn('[Wagering] status check error:', _wagerErr.message); }

        // ── Achievement check (non-blocking) ──
        let newAchievements = [];
        try {
            const achievementService = require('../services/achievement.service');
            const [spinCountRow, distinctRow, wageredRow] = await Promise.all([
                db.get('SELECT COUNT(*) as cnt FROM spins WHERE user_id = ?', [userId]),
                db.get('SELECT COUNT(DISTINCT game_id) as cnt FROM spins WHERE user_id = ?', [userId]),
                db.get('SELECT COALESCE(SUM(bet_amount), 0) as total FROM spins WHERE user_id = ?', [userId]),
            ]);
            const spinCount    = spinCountRow  ? spinCountRow.cnt   : 0;
            const distinctGames = distinctRow  ? distinctRow.cnt    : 0;
            const totalWagered = wageredRow    ? wageredRow.total   : 0;
            const winMult = bet > 0 ? spinResult.winAmount / bet : 0;
            const maxBetRow = await db.get('SELECT MAX(bet_amount) as mx FROM spins WHERE user_id = ?', [userId]);
            const maxBet = (maxBetRow && maxBetRow.mx != null) ? Number(maxBetRow.mx) : 0;
            newAchievements = await achievementService.checkSpinAchievements(userId, spinCount, winMult, distinctGames, totalWagered, maxBet);
            // jackpot_winner achievement if a jackpot was won this spin
            if (spinResult.jackpotWon) {
                const r = await achievementService.grant(userId, 'jackpot_winner');
                if (r) newAchievements.push(r);
            }
            // free_spin_win achievement if a winning spin was a free spin
            if (usedFreeSpin && spinResult.winAmount > 0) {
                const r2 = await achievementService.grant(userId, 'free_spin_win');
                if (r2) newAchievements.push(r2);
            }
        } catch (e) { console.warn('[Achievement] check error:', e.message); }

        // ── VIP XP + monthly cashback tracking (fire-and-forget) ──
        if (!usedFreeSpin && bet > 0) {
            (async function () {
                try {
                    const vipService = require('../services/vip.service');
                    const xpResult = await vipService.addXp(userId, bet);
                    // Track net loss for monthly cashback
                    const netLoss = bet - (spinResult.winAmount || 0);
                    if (netLoss > 0) {
                        await vipService.trackNetLoss(userId, netLoss);
                    }
                    // Tier-up notification (already created in vip service); also push to socket if available
                    if (xpResult && xpResult.tierUp) {
                        try {
                            const ach = require('../services/achievement.service');
                            await ach.grant(userId, 'vip_' + xpResult.newTier.toLowerCase());
                        } catch (_) {}
                    }
                } catch (e) { console.warn('[VIP] addXp error:', e.message); }
            }());
        }

        // ── Tournament spin submission (new service) ──
        if (!usedFreeSpin && bet > 0) {
            (async function () {
                try {
                    await require('../services/tournament.service').submitSpin(userId, spinResult.winAmount || 0, bet);
                } catch (e) { console.warn('[Tournament] submitSpin error:', e.message); }
            }());
        }

        // ── Slot-race spin submission ──
        // Canonical, server-trusted path. The public POST /api/slot-race/
        // record-spin endpoint that accepted client-supplied winAmount has
        // been disabled (410 Gone) because lucky_strike races compute score
        // from the raw winAmount — a fake $999k win there would have stolen
        // the prize_pool. We always submit the server-computed winAmount
        // here on every real spin.
        if (!usedFreeSpin && bet > 0) {
            (async function () {
                try {
                    const slotRace = require('../routes/slot-race.routes');
                    if (typeof slotRace.recordSpinInternal === 'function') {
                        await slotRace.recordSpinInternal(userId, {
                            betAmount: bet,
                            winAmount: spinResult.winAmount || 0,
                        });
                    }
                } catch (e) { console.warn('[SlotRace] recordSpinInternal error:', e.message); }
            }());
        }

        // ── Gems from wins (engagement incentive, fire-and-forget) ──────
        if (!usedFreeSpin && spinResult.winAmount >= 5) {
            const _gemsFromWin = Math.floor(spinResult.winAmount / 5);
            (async function () {
                try {
                    await require('../services/gems.service').addGems(
                        userId, _gemsFromWin,
                        'Win reward: $' + spinResult.winAmount.toFixed(2)
                    );
                } catch (_gfwErr) { console.warn('[Gems] Win reward error:', _gfwErr); }
            }());
        }

        // ── Response ──
        // IMPROVEMENT 40: Re-engagement triggers
        let triggers = [];
        try {
            const sessionData = {
                balance: finalBalance,
                consecutiveLosses: (spinResult.winAmount === 0) ? (userSpinData.consecutiveLosses || 0) + 1 : 0,
                spinCount: userSpinData.recentSpins ? userSpinData.recentSpins.length : 0
            };
            if (spinResult.winAmount === 0) {
                userSpinData.consecutiveLosses = sessionData.consecutiveLosses;
            } else {
                userSpinData.consecutiveLosses = 0;
            }
            // ╔══════════════════════════════════════════════════════════════════╗
            // ║  STREAK SAVER — MUST USE bonus_balance, NOT balance             ║
            // ║  This has been reverted to `balance` SIX TIMES by other         ║
            // ║  sessions. Free credits → balance = instant withdrawable cash    ║
            // ║  = REVENUE LEAK. See CLAUDE.md Rule #2.                         ║
            // ║  DO NOT CHANGE THIS TO balance. EVER.                           ║
            // ╚══════════════════════════════════════════════════════════════════╝
            if (spinResult.winAmount === 0 && sessionData.consecutiveLosses >= 10) {
                const streakBonus = Math.round(bet * 0.5 * 100) / 100;
                if (streakBonus > 0 && streakBonus <= 5) {
                    spinResult.winAmount = streakBonus;
                    spinResult.streakSaver = true;
                    await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [streakBonus, streakBonus * 10, userId]);
                    finalBalance += streakBonus;
                }
            }
            triggers = await reengageTriggers.checkTriggers(userId, sessionData);
        } catch(_trigErr) { console.warn('[Spin] re-engage trigger error:', _trigErr.message); }

        // IMPROVEMENT 41: Analytics tracking (fire-and-forget)
        playerAnalytics.track(userId, 'spin', {
            gameId, bet, win: spinResult.winAmount,
            balance: finalBalance
        }).catch(function(e) { console.warn('[Analytics] track error:', e.message); });

        // ROUND 41: VIP AUTO-PROMOTION — now uses spins table instead of transactions.
        // Previously: Used SUM(ABS(amount)) from transactions table, which could be
        // manipulated if any other code path inserts 'bet' type transactions.
        // Now: Uses SUM(bet_amount) from spins table — only real spin bets count.
        // Also: Only upgrades ONE level at a time, and uses atomic WHERE guard.
        (async function() {
            try {
                const vipTiers = [
                    { level: 1, name: 'Bronze', wagered: 500 },
                    { level: 2, name: 'Silver', wagered: 2000 },
                    { level: 3, name: 'Gold', wagered: 10000 },
                    { level: 4, name: 'Platinum', wagered: 50000 },
                    { level: 5, name: 'Diamond', wagered: 200000 }
                ];
                const stats = await db.get(
                    'SELECT COALESCE(SUM(bet_amount), 0) as total_wagered FROM spins WHERE user_id = ? AND bet_amount > 0',
                    [userId]
                );
                const user = await db.get('SELECT vip_level FROM users WHERE id = ?', [userId]);
                if (stats && user) {
                    const currentLevel = user.vip_level || 0;
                    const nextTier = vipTiers.find(t => t.level === currentLevel + 1);
                    if (nextTier && stats.total_wagered >= nextTier.wagered) {
                        // Atomic: only upgrade if still at current level (prevents race condition double-promotion)
                        await db.run(
                            'UPDATE users SET vip_level = ? WHERE id = ? AND (vip_level IS NULL OR vip_level = ?)',
                            [nextTier.level, userId, currentLevel]
                        );
                    }
                }
            } catch(_vipErr) { console.warn('[Spin] VIP auto-promotion error:', _vipErr.message); }
        }());

        res.json({
            grid: spinResult.grid,
            winAmount: spinResult.winAmount,
            winDetails: spinResult.winDetails,
            balance: finalBalance,
            freeSpinState: spinResult.freeSpinState,
            scatterTriggered: spinResult.scatterTriggered,
            freeSpinsAwarded: spinResult.freeSpinsAwarded,
            usedFreeSpin,
            jackpotWon: spinResult.jackpotWon || null,
            wageringStatus,
            newAchievements,
            eventBonus,
            lossStatus: lossCheck ? { dailyLoss: lossCheck.dailyLoss, limit: lossCheck.limit, remaining: lossCheck.remaining } : null,
            boostWinBonus: _boostWinBonus || 0,
            spinIntegrity: require('crypto').createHmac('sha256', config.JWT_SECRET).update(JSON.stringify({ g: spinResult.grid, w: spinResult.winAmount, b: finalBalance })).digest('hex').slice(0, 16),
        });

    } catch (err) {
        // Rollback any in-progress transaction to prevent partial balance changes
        try { await db.rollback(); } catch (_) { /* already rolled back or no txn */ }
        // Release idempotency lock on error
        activeSpins.delete(req.user && req.user.id);
        console.warn('[Spin] Error:', err.message);
        res.status(500).json({ error: 'Spin failed' });
    }
});

// ============================================================================
// ROUND 39: SERVER-SIDE GAMBLE (Double-or-Nothing)
// ============================================================================
// Previously: gamble outcome was determined client-side with Math.random(),
// allowing players to override Math.random or manipulate gambleState.amount.
// Now: server determines outcome with crypto RNG, manages balance atomically.
// ============================================================================

const rng = require('../services/rng.service');

// Gamble active sessions: userId → { amount, round, maxRound, lastGambleAt }
const activeGambles = new Map();
setInterval(() => {
    const cutoff = Date.now() - 120000; // 2min max gamble session
    for (const [uid, data] of activeGambles) {
        if (data.lastGambleAt < cutoff) activeGambles.delete(uid);
    }
}, 60000);

// POST /api/spin/gamble/start — Start a gamble session (must have a recent win)
router.post('/gamble/start', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { amount } = req.body;
        const gambleAmount = parseFloat(amount) || 0;

        // ROUND 55: Number.isFinite guards against NaN/Infinity corruption
        if (!Number.isFinite(gambleAmount) || gambleAmount <= 0 || gambleAmount > 50000) {
            return res.status(400).json({ error: 'Invalid gamble amount' });
        }

        // Self-exclusion check (must match main spin endpoint pattern with ends_at guard)
        var selfExclCheck = await db.get("SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))", [userId]);
        if (selfExclCheck) {
            return res.status(403).json({ error: 'Gambling is disabled during your self-exclusion period' });
        }

        // Verify user actually won this amount recently (last 30s)
        var recentWin = await db.get(
            "SELECT id, win_amount FROM spins WHERE user_id = ? AND win_amount >= ? AND created_at >= datetime('now', '-30 seconds') ORDER BY created_at DESC LIMIT 1",
            [userId, gambleAmount]
        );
        if (!recentWin) {
            return res.status(400).json({ error: 'No recent win matching this amount' });
        }

        // Deduct the gamble amount from balance (held in escrow during gamble)
        var deduct = await db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
            [gambleAmount, userId, gambleAmount]
        );
        if (!deduct || deduct.changes === 0) {
            return res.status(400).json({ error: 'Insufficient balance for gamble' });
        }

        activeGambles.set(userId, {
            amount: gambleAmount,
            round: 1,
            maxRound: 5,
            lastGambleAt: Date.now(),
            spinId: recentWin.id
        });

        return res.json({ success: true, amount: gambleAmount, round: 1, maxRound: 5 });
    } catch (err) {
        console.warn('[Gamble] start error:', err.message);
        return res.status(500).json({ error: 'Gamble start failed' });
    }
});

// POST /api/spin/gamble/choose — Make a red/black choice
router.post('/gamble/choose', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { choice } = req.body;

        if (!choice || !['red', 'black'].includes(choice)) {
            return res.status(400).json({ error: 'Choice must be "red" or "black"' });
        }

        const session = activeGambles.get(userId);
        if (!session) {
            return res.status(400).json({ error: 'No active gamble session' });
        }

        // Server-side crypto RNG outcome — 50/50 fair
        const outcome = rng.randomFloat() < 0.5 ? 'red' : 'black';
        const win = (outcome === choice);

        session.lastGambleAt = Date.now();

        if (win) {
            session.amount *= 2;
            // Cap gamble payout at session win cap to prevent unlimited doubling
            var gambleWinCap = config.SESSION_WIN_CAP || 5000;
            if (session.amount > gambleWinCap) session.amount = gambleWinCap;
            session.round++;

            if (session.round > session.maxRound) {
                // Max rounds reached — auto-collect
                await db.run(
                    'UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE id = ?',
                    [session.amount, userId]
                );
                activeGambles.delete(userId);

                return res.json({
                    win: true,
                    outcome: outcome,
                    amount: session.amount,
                    collected: true,
                    round: session.round - 1,
                    maxRound: session.maxRound
                });
            }

            return res.json({
                win: true,
                outcome: outcome,
                amount: session.amount,
                collected: false,
                round: session.round - 1,
                maxRound: session.maxRound
            });
        } else {
            // Lost — amount stays deducted (was escrowed on start)
            var lostAmount = session.amount;
            activeGambles.delete(userId);

            // Record gamble loss transaction
            try {
                var _glUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
                var _glBal = _glUser ? _glUser.balance : 0;
                await db.run(
                    "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, 'gamble_loss', ?, ?, ?, 'double-or-nothing')",
                    [userId, -lostAmount, _glBal + lostAmount, _glBal]
                );
            } catch (_glErr) { console.warn('[Gamble] loss transaction error:', _glErr.message); }

            return res.json({
                win: false,
                outcome: outcome,
                amount: 0,
                collected: false,
                round: session.round,
                maxRound: session.maxRound
            });
        }
    } catch (err) {
        console.warn('[Gamble] choose error:', err.message);
        return res.status(500).json({ error: 'Gamble failed' });
    }
});

// POST /api/spin/gamble/collect — Collect current gamble winnings
router.post('/gamble/collect', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const session = activeGambles.get(userId);

        if (!session) {
            return res.status(400).json({ error: 'No active gamble session' });
        }

        // Credit the current amount back to balance
        await db.run(
            'UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE id = ?',
            [session.amount, userId]
        );

        // Record gamble win transaction
        try {
            var _gwUser = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
            var _gwBal = _gwUser ? _gwUser.balance : 0;
            await db.run(
                "INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, 'gamble_win', ?, ?, ?, ?)",
                [userId, session.amount, _gwBal - session.amount, _gwBal, 'Gamble collected — round ' + (session.round - 1)]
            );
        } catch (_gwErr) { console.warn('[Gamble] win transaction error:', _gwErr.message); }

        activeGambles.delete(userId);

        var updated = await db.get('SELECT balance FROM users WHERE id = ?', [userId]);

        return res.json({
            success: true,
            collected: session.amount,
            newBalance: updated ? parseFloat(updated.balance) || 0 : 0
        });
    } catch (err) {
        console.warn('[Gamble] collect error:', err.message);
        return res.status(500).json({ error: 'Collect failed' });
    }
});

module.exports = router;
