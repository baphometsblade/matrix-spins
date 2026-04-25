const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { initDatabase } = require('./database');

const app = express();

// Trust Render's reverse proxy so rate-limiters and IP detection use the real
// client IP rather than the load-balancer IP (which would bucket all users together)
app.set('trust proxy', 1);

// NOTE: No www redirect here — Cloudflare sits in front and already handles
// SSL for both msaart.online and www.msaart.online. Adding a server-side
// redirect creates a loop because Cloudflare redirects www→bare domain.

// ─── Security Middleware ───
app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for the casino client
}));
// In production restrict CORS to the declared origin; open in development.
// config.js fails-closed if ALLOWED_ORIGIN is unset in production, so this is just defensive.
const corsOrigin = config.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGIN || false)
    : true;
app.use(cors({ origin: corsOrigin, credentials: false }));
// Stripe webhook needs the raw body (Buffer) for signature verification.
// Mount express.raw() BEFORE express.json() so the webhook path gets raw bytes.
app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// Global rate limiter
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200, // 200 requests per minute
    message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', globalLimiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per 15 min
    message: { error: 'Too many auth attempts. Try again later.' },
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);

// Password-reset / change-password limiter — prevents enumeration + brute-force
// of reset tokens (3 attempts per 15 min per IP)
const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { error: 'Too many password reset attempts. Try again later.' },
});
app.use('/api/user/forgot-password', passwordResetLimiter);
app.use('/api/user/reset-password', passwordResetLimiter);
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);

// Generic webhook is unauthenticated and fires balance credits — needs strict rate limit
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // legitimate processor traffic shouldn't exceed this
    message: { error: 'Too many webhook calls. Please wait.' },
});
app.use('/api/payment/webhook/confirm', webhookLimiter);
app.use('/api/payments/webhook/confirm', webhookLimiter);

// Strict rate limit for bonus/reward endpoints (prevent rapid-fire exploitation)
const bonusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, // 5 attempts per minute per IP
    message: { error: 'Too many bonus requests. Please wait.' },
});
app.use('/api/user/claim-daily-bonus', bonusLimiter);
app.use('/api/user/spin-wheel', bonusLimiter);
app.use('/api/user/redeem-promo', bonusLimiter);

// Strict rate limit for deposit/withdrawal endpoints
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3, // 3 per minute per IP
    message: { error: 'Too many payment requests. Please wait.' },
});
app.use('/api/payment/deposit', paymentLimiter);
app.use('/api/payment/withdraw', paymentLimiter);
app.use('/api/balance/deposit', paymentLimiter);
app.use('/api/bundles/purchase', paymentLimiter);
app.use('/api/gifts/send', paymentLimiter);

// ─── Health Check (used by Render / load balancers) ───
app.get('/api/health', async (req, res) => {
    try {
        const db = require('./database');
        await db.get('SELECT 1');
        res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
        res.status(503).json({ status: 'error', message: err.message });
    }
});

// ─── API Routes ───
const authRoutes = require('./routes/auth.routes');
const spinRoutes = require('./routes/spin.routes');
const balanceRoutes = require('./routes/balance.routes');
const adminRoutes = require('./routes/admin.routes');
const userRoutes = require('./routes/user.routes');
const paymentRoutes = require('./routes/payment.routes');
const jackpotRoutes = require('./routes/jackpot.routes');
const leaderboardRoutes = require('./routes/leaderboard.routes');
const tournamentRoutes = require('./routes/tournament.routes');
const feedRoutes = require('./routes/feed.routes');

app.use('/api/auth', authRoutes);
app.use('/api/spin', spinRoutes);
app.use('/api/balance', balanceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/jackpot', jackpotRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/session', require('./routes/session.routes'));
app.use('/api/game-of-day', require('./routes/gameofday.routes'));
app.use('/api/game-stats', require('./routes/gamestats.routes'));
app.use('/api/gems', require('./routes/gems.routes'));
app.use('/api/boosts', require('./routes/boost.routes'));
app.use('/api/challenges', require('./routes/challenges.routes'));
app.use('/api/battlepass', require('./routes/battlepass.routes'));
app.use('/api/cosmetics',  require('./routes/cosmetics.routes'));
app.use('/api/wagerace',   require('./routes/wagerace.routes'));
app.use('/api/rentals',    require('./routes/rental.routes'));
app.use('/api/megawheel',  require('./routes/megawheel.routes'));
app.use('/api/referral',   require('./routes/referral.routes'));
app.use('/api/achievements', require('./routes/achievements.routes'));
app.use('/api/gifts',      require('./routes/gifts.routes'));
app.use('/api/rakeback',   require('./routes/rakeback.routes'));
app.use('/api/mystery',      require('./routes/mystery.routes'));
app.use('/api/streak',       require('./routes/streak.routes'));
app.use('/api/subscription', require('./routes/subscription.routes'));
app.use('/api/luckyhours',    require('./routes/luckyhours.routes'));
app.use('/api/milestones',    require('./routes/milestones.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));
app.use('/api/freespins',     require('./routes/freespins.routes'));
app.use('/api/scratchcard',   require('./routes/scratchcard.routes'));
app.use('/api/promocode',    require('./routes/promocode.routes'));
app.use('/api/socialproof',  require('./routes/socialproof.routes'));
app.use('/api/firstdeposit', require('./routes/firstdeposit.routes'));
app.use('/api/depositmatch', require('./routes/depositmatch.routes'));
app.use('/api/spinstreak',   require('./routes/spinstreak.routes'));
app.use('/api/vipwheel',     require('./routes/vipwheel.routes'));
app.use('/api/dailycashback', require('./routes/dailycashback.routes'));
app.use('/api/hotgame',       require('./routes/hotgame.routes'));
app.use('/api/reloadbonus',   require('./routes/reloadbonus.routes'));
app.use('/api/loyaltyshop',   require('./routes/loyaltyshop.routes'));
app.use('/api/winstreak',     require('./routes/winstreak.routes'));
app.use('/api/referralbonus', require('./routes/referralbonus.routes'));
app.use('/api/levelupbonus',  require('./routes/levelupbonus.routes'));
app.use('/api/birthday',       require('./routes/birthday.routes'));
app.use('/api/deposit-streak', require('./routes/depositstreak.routes'));
app.use('/api/dailymissions', require('./routes/dailymissions.routes'));
app.use('/api/fortunewheel',  require('./routes/fortunewheel.routes'));
app.use('/api/mines',         require('./routes/mines.routes'));
app.use('/api/crash',         require('./routes/crash.routes'));
app.use('/api/plinko',        require('./routes/plinko.routes'));
app.use('/api/hilo',          require('./routes/hilo.routes'));
app.use('/api/roulette',      require('./routes/roulette.routes'));
app.use('/api/dice',          require('./routes/dice.routes'));
app.use('/api/blackjack',     require('./routes/blackjack.routes'));
app.use('/api/videopoker',    require('./routes/videopoker.routes'));
app.use('/api/keno',          require('./routes/keno.routes'));
app.use('/api/baccarat',      require('./routes/baccarat.routes'));
app.use('/api/dragontiger',   require('./routes/dragontiger.routes'));
app.use('/api/limbo',         require('./routes/limbo.routes'));
app.use('/api/tower',         require('./routes/tower.routes'));
app.use('/api/wheel',         require('./routes/wheel.routes'));
app.use('/api/coinflip',      require('./routes/coinflip.routes'));
app.use('/api/sicbo',         require('./routes/sicbo.routes'));
app.use('/api/casinowar',     require('./routes/casinowar.routes'));
app.use('/api/reddog',        require('./routes/reddog.routes'));
app.use('/api/caribbeanstud',    require('./routes/caribbeanstud.routes'));
app.use('/api/threecardpoker',  require('./routes/threecardpoker.routes'));
app.use('/api/letitride',       require('./routes/letitride.routes'));
app.use('/api/scratch',        require('./routes/scratch.routes'));
app.use('/api/bigsixwheel',    require('./routes/bigsixwheel.routes'));
app.use('/api/chuckaluck',     require('./routes/chuckaluck.routes'));
app.use('/api/moneywheel',     require('./routes/moneywheel.routes'));
app.use('/api/kenoturbo',      require('./routes/kenoturbo.routes'));
app.use('/api/horseracing',    require('./routes/horseracing.routes'));
app.use('/api/buy-feature',   require('./routes/buyfeature.routes'));
app.use('/api/xpshop',        require('./routes/xpshop.routes'));

// ─── Big-win feed — recent large wins for social proof ───
app.get('/api/big-wins', async (req, res) => {
    try {
        const db = require('./database');
        const rows = await db.all(`
            SELECT s.win_amount, s.game_id, s.created_at,
                   u.username, u.display_name
            FROM spins s
            JOIN users u ON s.user_id = u.id
            WHERE s.win_amount >= 50
            ORDER BY s.created_at DESC
            LIMIT 20
        `);
        const wins = rows.map(r => ({
            amount: r.win_amount,
            gameId: r.game_id,
            player: r.display_name || r.username,
            time: r.created_at
        }));
        res.json({ wins });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch big wins' });
    }
});

// ─── Jackpots plural alias (standalone GET endpoint) ───
app.get('/api/jackpots', async (req, res) => {
    try {
        const jpService = require('./services/jackpot.service');
        const levels = await jpService.getJackpotLevels();
        res.json({ jackpots: levels });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch jackpots' });
    }
});

// ─── Game definitions endpoint (sanitized — no payout tables) ───
const games = require('../shared/game-definitions');
app.get('/api/games', (req, res) => {
    const sanitized = games.map(g => ({
        id: g.id,
        name: g.name,
        provider: g.provider,
        tag: g.tag,
        tagClass: g.tagClass,
        thumbnail: g.thumbnail,
        bgGradient: g.bgGradient,
        symbols: g.symbols,
        reelBg: g.reelBg,
        accentColor: g.accentColor,
        gridCols: g.gridCols,
        gridRows: g.gridRows,
        winType: g.winType,
        clusterMin: g.clusterMin,
        wildSymbol: g.wildSymbol,
        scatterSymbol: g.scatterSymbol,
        bonusType: g.bonusType,
        bonusDesc: g.bonusDesc,
        minBet: g.minBet,
        maxBet: g.maxBet,
        hot: g.hot,
        jackpot: g.jackpot,
        // NOTE: payouts, multiplier arrays, etc. are INTENTIONALLY EXCLUDED
    }));
    res.json({ games: sanitized });
});

const { authenticate: verifyToken } = require('./middleware/auth');

// ─── Personalized bonus offers ───
app.get('/api/offers', verifyToken, async (req, res) => {
    try {
        const bonusRules = require('./services/bonus-rules.service');
        const offers = await bonusRules.getPersonalizedOffers(req.user.id);
        res.json({ offers });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});

// ─── Spin-pack bundles ───
app.get('/api/bundles', async (req, res) => {
    try {
        const bundleService = require('./services/bundle.service');
        res.json({ bundles: bundleService.getAvailableBundles() });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch bundles' });
    }
});

app.post('/api/bundles/purchase', verifyToken, async (req, res) => {
    try {
        const bundleService = require('./services/bundle.service');
        const { bundleId } = req.body;
        if (!bundleId) return res.status(400).json({ error: 'Bundle ID required' });
        const result = await bundleService.purchaseBundle(req.user.id, bundleId);
        res.json(result);
    } catch (e) {
        console.error('[Bundle] purchase error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

// ─── Active campaigns for current user ───
app.get('/api/campaigns', verifyToken, async (req, res) => {
    try {
        const campaignService = require('./services/campaign.service');
        const campaigns = await campaignService.getActiveCampaigns(req.user.id);
        res.json({ campaigns });
    } catch (e) {
        console.error('[Campaigns] Fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
});

// ─── Active bonus events (with countdown) ───
app.get('/api/events/active', verifyToken, async (req, res) => {
    try {
        const eventService = require('./services/event.service');
        const events = await eventService.getActiveEvents();
        const nowMs = Date.now();
        const enriched = events.map(function (e) {
            const endMs = new Date(e.end_at).getTime();
            const secondsRemaining = Math.max(0, Math.floor((endMs - nowMs) / 1000));
            return {
                id: e.id,
                name: e.name,
                description: e.description,
                eventType: e.event_type,
                multiplier: e.multiplier,
                targetGames: e.target_games,
                startAt: e.start_at,
                endAt: e.end_at,
                secondsRemaining,
            };
        });
        res.json({ events: enriched });
    } catch (e) {
        console.error('[Events] Fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch active events' });
    }
});

// ─── Social Gifting ───
app.post('/api/gifts/send', verifyToken, async (req, res) => {
    try {
        const giftingService = require('./services/gifting.service');
        const { toUsername, amount, message } = req.body;
        if (!toUsername) return res.status(400).json({ error: 'Recipient username is required' });
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'Valid gift amount is required' });
        }
        const result = await giftingService.sendGift(req.user.id, toUsername, amount, message);
        res.json(result);
    } catch (e) {
        console.error('[Gifting] Send error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

app.get('/api/gifts/pending', verifyToken, async (req, res) => {
    try {
        const giftingService = require('./services/gifting.service');
        const gifts = await giftingService.getPendingGifts(req.user.id);
        res.json({ gifts });
    } catch (e) {
        console.error('[Gifting] Pending fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch pending gifts' });
    }
});

app.post('/api/gifts/:id/claim', verifyToken, async (req, res) => {
    try {
        const giftingService = require('./services/gifting.service');
        const giftId = parseInt(req.params.id, 10);
        if (!giftId || isNaN(giftId)) return res.status(400).json({ error: 'Invalid gift ID' });
        const result = await giftingService.claimGift(giftId, req.user.id);
        res.json(result);
    } catch (e) {
        console.error('[Gifting] Claim error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

app.get('/api/gifts/history', verifyToken, async (req, res) => {
    try {
        const giftingService = require('./services/gifting.service');
        const limit = parseInt(req.query.limit, 10) || 20;
        const history = await giftingService.getGiftHistory(req.user.id, limit);
        res.json({ history });
    } catch (e) {
        console.error('[Gifting] History fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch gift history' });
    }
});

// ─── Weekly Auto-Contests ───
app.get('/api/contests/current', verifyToken, async (req, res) => {
    try {
        const contestService = require('./services/contest.service');
        await contestService.checkAndFinalizeExpired();
        const contest = await contestService.getOrCreateCurrentContest();
        if (!contest) return res.json({ contest: null });

        const defaultMetric = config.CONTESTS.DEFAULT_METRIC;
        const userRank = await contestService.getUserRank(contest.id, req.user.id, defaultMetric);

        const entries = {};
        for (const metric of contestService.VALID_METRICS) {
            entries[metric] = await contestService.getUserRank(contest.id, req.user.id, metric);
        }

        res.json({ contest, entries, defaultMetric, userRank });
    } catch (e) {
        console.error('[Contest] Current fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch current contest' });
    }
});

app.get('/api/contests/leaderboard', verifyToken, async (req, res) => {
    try {
        const contestService = require('./services/contest.service');
        const metric = req.query.metric || config.CONTESTS.DEFAULT_METRIC;
        if (!contestService.VALID_METRICS.includes(metric)) {
            return res.status(400).json({ error: 'Invalid metric type' });
        }

        await contestService.checkAndFinalizeExpired();
        const contest = await contestService.getOrCreateCurrentContest();
        if (!contest) return res.json({ leaderboard: [], contest: null });

        const leaderboard = await contestService.getLeaderboard(contest.id, metric, 25);
        const userRank = await contestService.getUserRank(contest.id, req.user.id, metric);

        res.json({ leaderboard, contest, metric, userRank });
    } catch (e) {
        console.error('[Contest] Leaderboard fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/contests/prizes', verifyToken, async (req, res) => {
    try {
        const contestService = require('./services/contest.service');
        const prizes = await contestService.getUserPrizes(req.user.id);
        res.json({ prizes });
    } catch (e) {
        console.error('[Contest] Prizes fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch prizes' });
    }
});

app.post('/api/contests/prizes/:id/claim', verifyToken, async (req, res) => {
    try {
        const db = require('./database');
        const prizeId = parseInt(req.params.id, 10);
        if (!prizeId || isNaN(prizeId)) {
            return res.status(400).json({ error: 'Invalid prize ID' });
        }

        const prize = await db.get(
            'SELECT * FROM contest_prizes WHERE id = ? AND user_id = ?',
            [prizeId, req.user.id]
        );
        if (!prize) return res.status(404).json({ error: 'Prize not found' });
        if (prize.claimed) return res.status(400).json({ error: 'Prize already claimed' });

        await db.run('UPDATE contest_prizes SET claimed = 1 WHERE id = ?', [prizeId]);

        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            claimed: true,
            prizeAmount: prize.prize_amount,
            balance: user ? user.balance : 0,
            bonusBalance: user ? user.bonus_balance : 0
        });
    } catch (e) {
        console.error('[Contest] Prize claim error:', e.message);
        res.status(500).json({ error: 'Failed to claim prize' });
    }
});

// ─── Static Files ───
// Serve the casino client from the project root
app.use(express.static(path.join(__dirname, '..')));

// Admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── Start Server ───
async function start() {
    // Production safety checks — refuse to start with insecure defaults
    if (config.NODE_ENV === 'production') {
        if (config.JWT_SECRET === 'dev-secret-change-in-production') {
            console.error('[Security] FATAL: JWT_SECRET is the default dev value. Set JWT_SECRET in .env before running in production.');
            process.exit(1);
        }
        if (config.ADMIN_PASSWORD === 'admin123changeme') {
            console.error('[Security] FATAL: ADMIN_PASSWORD is the default dev value. Set ADMIN_PASSWORD in .env before running in production.');
            process.exit(1);
        }
    }

    await initDatabase();

    // Seed jackpot pool (4 tiers: mini, minor, major, grand)
    const jackpotService = require('./services/jackpot.service');
    await jackpotService.initJackpotPool();

    // Initialise gem tables (gem_balances, gem_transactions)
    const gemsService = require('./services/gems.service');
    await gemsService.initSchema();

    // Initialise boost tables (active_boosts)
    const boostService = require('./services/boost.service');
    await boostService.initSchema();

    // Initialise new feature tables (challenges, battlepass, cosmetics, wagerace, rentals, megawheel)
    const challengesService = require('./services/challenges.service');
    await challengesService.initSchema();
    const cosmeticsService = require('./services/cosmetics.service');
    await cosmeticsService.initSchema();
    const wageraceService = require('./services/wagerace.service');
    await wageraceService.initSchema();
    const rentalService = require('./services/rental.service');
    await rentalService.initSchema();
    const megawheelService = require('./services/megawheel.service');
    await megawheelService.initSchema();

    app.listen(config.PORT, () => {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`  Matrix Spins Server running on port ${config.PORT}`);
        console.log(`  Environment: ${config.NODE_ENV}`);
        console.log(`  Open: http://localhost:${config.PORT}`);
        console.log(`  Admin: http://localhost:${config.PORT}/admin`);
        console.log(`${'='.repeat(50)}\n`);

        // Bootstrap tournament service
        const tournamentService = require('./services/tournament.service');
        tournamentService.ensureActive().catch(err => console.error('[Tournament] Bootstrap error:', err.message));
        setInterval(() => tournamentService.tick().catch(err => console.error('[Tournament] Tick error:', err.message)), 5 * 60 * 1000);

        // Bootstrap wager race service (hourly race, tick every 60s)
        const wageraceService = require('./services/wagerace.service');
        wageraceService.ensureActiveRace().catch(err => console.error('[WagerRace] Bootstrap error:', err.message));
        setInterval(() => wageraceService.tick().catch(err => console.error('[WagerRace] Tick error:', err.message)), 60 * 1000);

        // Bootstrap weekly contest service — ensure current week contest exists
        const contestService = require('./services/contest.service');
        contestService.getOrCreateCurrentContest().catch(err => console.error('[Contest] Bootstrap error:', err.message));
        // Check for expired contests every 10 minutes
        setInterval(() => contestService.checkAndFinalizeExpired().catch(err => console.error('[Contest] Finalize tick error:', err.message)), 10 * 60 * 1000);
    });

    // Start background scheduler (re-engagement emails, P&L reports)
    try {
        const scheduler = require('./services/scheduler.service');
        scheduler.start();
    } catch (e) {
        console.warn('[Scheduler] Failed to start:', e.message);
    }
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

// ─── Graceful Shutdown ───
// Drain the database connection pool (PostgreSQL) or save file (SQLite) on exit
process.on('SIGTERM', async () => {
    console.log('[Server] SIGTERM received, shutting down gracefully…');
    try {
        const { getBackend } = require('./database');
        const backend = getBackend();
        if (backend && typeof backend.close === 'function') {
            await backend.close();
        }
    } catch (e) { /* backend not initialized yet */ }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[Server] SIGINT received, shutting down…');
    try {
        const { getBackend } = require('./database');
        const backend = getBackend();
        if (backend && typeof backend.close === 'function') {
            await backend.close();
        }
    } catch (e) { /* backend not initialized yet */ }
    process.exit(0);
});
