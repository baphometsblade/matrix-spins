// Security: Replace Math.random() globally with crypto-secure RNG
require('./utils/secure-rng');

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

// Per-user rate limiting (complements IP-based limits)
const userRateLimit = require('./middleware/user-ratelimit');

// NOTE: No www redirect here — Cloudflare sits in front and already handles
// SSL for both msaart.online and www.msaart.online. Adding a server-side
// redirect creates a loop because Cloudflare redirects www→bare domain.

// ─── Security Middleware ───
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],  // casino client uses inline scripts + ethers.js CDN
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],       // inline styles + Google Fonts
            imgSrc: ["'self'", "data:", "blob:"],           // data URIs for generated assets
            connectSrc: ["'self'", "https://api.coingecko.com", "https://cloudflare-eth.com"],  // API calls + crypto price feed + ETH RPC
            fontSrc: ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],                          // no Flash/Java
            frameAncestors: ["'none'"],                     // no iframing (clickjacking protection)
            baseUri: ["'self'"],                            // prevent base tag hijacking
            formAction: ["'self'"],                         // restrict form submission targets
            scriptSrcAttr: ["'unsafe-inline'"],               // allow onclick= handlers (helmet defaults to 'none')
        }
    },
    // HSTS: enforce HTTPS for 1 year with subdomains
    strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    // Referrer policy: send origin only for cross-origin requests
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false, // needed for loading cross-origin images
}));

// Permissions-Policy: restrict sensitive browser features
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
});
// In production restrict CORS to the declared origin; open in development
const corsOrigin = config.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGIN || false)
    : true;
app.use(cors({ origin: corsOrigin }));
// Stripe webhook needs the raw body (Buffer) for signature verification.
// Mount express.raw() BEFORE express.json() so the webhook path gets raw bytes.
app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// ─── Input Sanitization Middleware ───
// Runs on all requests to prevent XSS, prototype pollution, and other injection attacks
const sanitizeMiddleware = require('./middleware/sanitize');
app.use(sanitizeMiddleware);

// ─── CSRF Protection Middleware ───
// Validates CSRF tokens on mutation endpoints (POST/PUT/DELETE)
const { csrfMiddleware, getCsrfTokenHandler } = require('./middleware/csrf');
const { authenticate: verifyToken, optionalAuth } = require('./middleware/auth');
app.get('/api/csrf-token', verifyToken, getCsrfTokenHandler);
// Populate req.user from JWT (non-blocking) so CSRF middleware can identify the user
app.use(optionalAuth);
app.use(csrfMiddleware);

// ─── Maintenance Mode Middleware ───
// Checks if system is under maintenance; blocks non-admin API routes
const { maintenanceMiddleware } = require('./middleware/maintenance');
app.use(maintenanceMiddleware);

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

// Per-user auth limit: 20 requests per minute per authenticated user
const userAuthLimit = userRateLimit({ maxRequests: 20, windowMs: 60000 });
app.use('/api/auth/', userAuthLimit);

// Strict rate limit for bonus/reward endpoints (prevent rapid-fire exploitation)
const bonusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, // 5 attempts per minute per IP
    message: { error: 'Too many bonus requests. Please wait.' },
});
app.use('/api/user/claim-daily-bonus', bonusLimiter);
app.use('/api/user/spin-wheel', bonusLimiter);
app.use('/api/user/redeem-promo', bonusLimiter);
app.use('/api/user/claim-loss-offer', bonusLimiter);
app.use('/api/user/claim-comeback-bonus', bonusLimiter);

// Strict rate limit for password/account-sensitive endpoints
const sensitiveAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 min
    message: { error: 'Too many requests. Try again later.' },
});
app.use('/api/auth/forgot-password', sensitiveAuthLimiter);
app.use('/api/auth/reset-password', sensitiveAuthLimiter);
app.use('/api/user/change-password', sensitiveAuthLimiter);

// Strict rate limit for deposit/withdrawal endpoints
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3, // 3 per minute per IP
    message: { error: 'Too many payment requests. Please wait.' },
});
app.use('/api/payment/deposit', paymentLimiter);
app.use('/api/payment/withdraw', paymentLimiter);
app.use('/api/crypto/verify-deposit', paymentLimiter);
app.use('/api/balance/deposit', paymentLimiter);
app.use('/api/bundles/purchase', paymentLimiter);
app.use('/api/matrix-money/purchase', paymentLimiter);
app.use('/api/matrix-money/withdraw', paymentLimiter);
app.use('/api/gifts/send', paymentLimiter);

// ── Jurisdictional compliance: geo-block money-handling endpoints ──
// Inert unless ALLOWED_COUNTRIES or BLOCKED_COUNTRIES is set in env.
// See server/middleware/geo-block.js for docs.
const { geoBlock } = require('./middleware/geo-block');
app.use('/api/auth/register',           geoBlock);
app.use('/api/payment/deposit',         geoBlock);
app.use('/api/payment/withdraw',        geoBlock);
app.use('/api/payment/create-checkout', geoBlock);
app.use('/api/crypto/verify-deposit',   geoBlock);
app.use('/api/balance/deposit',         geoBlock);
app.use('/api/bundles/purchase',        geoBlock);
app.use('/api/matrix-money/purchase',   geoBlock);
app.use('/api/withdrawal-enhance',      geoBlock);

// Per-user payment limit: 5 requests per minute per authenticated user
const userPaymentLimit = userRateLimit({ maxRequests: 5, windowMs: 60000 });
app.use('/api/payment/deposit', userPaymentLimit);
app.use('/api/payment/withdraw', userPaymentLimit);
app.use('/api/crypto/verify-deposit', userPaymentLimit);
app.use('/api/balance/deposit', userPaymentLimit);
app.use('/api/bundles/purchase', userPaymentLimit);
app.use('/api/matrix-money/purchase', userPaymentLimit);
app.use('/api/matrix-money/withdraw', userPaymentLimit);

// Admin endpoint rate limit — prevent brute-force admin access
const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 per minute
    message: { error: 'Too many admin requests.' },
});
app.use('/api/admin', adminLimiter);

// Spin endpoint rate limit — caps automated spin abuse at Express layer
// (in addition to the per-user in-memory check in spin.routes.js)
const spinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 2 spins/sec sustained — matches MAX_SPINS_PER_SECOND=2
    message: { error: 'Spinning too fast. Please slow down.' },
});
app.use('/api/spin', spinLimiter);
// Per-user spin limit: 60 spins per minute per authenticated user
app.use('/api/spin', userRateLimit({ maxRequests: 60, windowMs: 60000 }));

// ─── Health Check Routes (used by Render / load balancers) ───
// Register BEFORE static middleware so health checks are always fast & accessible
const healthRoutes = require('./routes/health.routes');
app.use('/api/health', healthRoutes);

// ─── API Routes ───
const authRoutes = require('./routes/auth.routes');
const spinRoutes = require('./routes/spin.routes');
const balanceRoutes = require('./routes/balance.routes');
const adminRoutes = require('./routes/admin.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const userRoutes = require('./routes/user.routes');
const paymentRoutes = require('./routes/payment.routes');
const jackpotRoutes = require('./routes/jackpot.routes');
const leaderboardRoutes = require('./routes/leaderboard.routes');
const tournamentRoutes = require('./routes/tournament.routes');
const feedRoutes = require('./routes/feed.routes');
const perfRoutes = require('./routes/perf.routes');

app.use('/api/perf', perfRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/spin', spinRoutes);
app.use('/api/balance', balanceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/analytics', require('./routes/admin-analytics.routes'));
app.use('/api/admin/maintenance', maintenanceRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user', require('./routes/lossstreak.routes'));
app.use('/api/user', require('./routes/vipdeposit.routes'));
app.use('/api/user', require('./routes/comeback.routes'));
app.use('/api/payment', paymentRoutes);
app.use('/api/matrix-money', require('./routes/matrix-money.routes'));
app.use('/api/crypto', require('./routes/crypto.routes'));
app.use('/api/jackpot', jackpotRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/tournament', tournamentRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/session', require('./routes/session.routes'));
app.use('/api/game-of-day', require('./routes/gameofday.routes'));
app.use('/api/featured-games', (req, res, next) => { req.url = '/featured'; next(); }, require('./routes/gameofday.routes'));
app.use('/api/game-stats', require('./routes/gamestats.routes'));
app.use('/api/gems', require('./routes/gems.routes'));
app.use('/api/boosts', require('./routes/boost.routes'));
app.use('/api/challenges', require('./routes/challenges.routes'));
app.use('/api/battle-pass', require('./routes/battle-pass.routes'));
app.use('/api/cosmetics',  require('./routes/cosmetics.routes'));
app.use('/api/wagerace',   require('./routes/wagerace.routes'));
app.use('/api/rentals',    require('./routes/rental.routes'));
// REMOVED: non-slot game
// app.use('/api/megawheel',  require('./routes/megawheel.routes'));
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
app.use('/api/slot-race',     require('./routes/slot-race.routes'));
// REMOVED: non-slot game
// app.use('/api/scratchcard',   require('./routes/scratchcard.routes'));
app.use('/api/promocode',    require('./routes/promocode.routes'));
app.use('/api/socialproof',  require('./routes/socialproof.routes'));
app.use('/api/firstdeposit', require('./routes/firstdeposit.routes'));
app.use('/api/self-exclusion', require('./routes/selfexclusion.routes'));
app.use('/api/ab', require('./routes/abtesting.routes'));
app.use('/api/deposit-limits', require('./routes/depositlimits.routes'));
app.use('/api/favorites',      require('./routes/favorites.routes'));
app.use('/api/deposit-bonus',  require('./routes/deposit-bonus.routes'));
app.use('/api/cashback',       require('./routes/cashback.routes'));
app.use('/api/player-stats',   require('./routes/playerstats.routes'));
app.use('/api/game-history',   require('./routes/gamehistory.routes'));
app.use('/api/chat',           require('./routes/chat.routes'));
app.use('/api/affiliate',      require('./routes/affiliate.routes'));
app.use('/api/admin-metrics',  require('./routes/adminmetrics.routes'));
app.use('/api/revenue-dashboard', require('./routes/revenue-dashboard.routes'));
app.use('/api/account',        require('./routes/accountdeletion.routes'));
app.use('/api/activity-log',   require('./routes/activitylog.routes'));
app.use('/api/depositmatch', require('./routes/depositmatch.routes'));
app.use('/api/loyalty', require('./routes/loyalty-store.routes'));
app.use('/api/spinstreak',   require('./routes/spinstreak.routes'));
app.use('/api/loss-insurance', require('./routes/loss-insurance.routes'));
app.use('/api/seasonal-event', require('./routes/seasonal-event.routes'));
app.use('/api/gem-store', require('./routes/gem-store.routes'));
app.use('/api/vipwheel',     require('./routes/vipwheel.routes'));
app.use('/api/dailycashback', require('./routes/dailycashback.routes'));
app.use('/api/hotgame',       require('./routes/hotgame.routes'));
app.use('/api/reloadbonus',   require('./routes/reloadbonus.routes'));
app.use('/api/loyaltyshop',   require('./routes/loyaltyshop.routes'));
app.use('/api/winstreak',     require('./routes/winstreak.routes'));
app.use('/api/referralbonus', require('./routes/referralbonus.routes'));
app.use('/api/levelupbonus',  require('./routes/levelupbonus.routes'));
app.use('/api/birthday',       require('./routes/birthday.routes'));
app.use('/api/daily-login',    require('./routes/daily-login.routes'));
app.use('/api/deposit-streak', require('./routes/depositstreak.routes'));
app.use('/api/dailymissions', require('./routes/dailymissions.routes'));
app.use('/api/feedback', require('./routes/feedback.routes'));
app.use('/api/deposit-campaigns', require('./routes/campaigns.routes'));
app.use('/api/loss-cashback',    require('./routes/losscashback.routes'));
app.use('/api/daily-wheel',      require('./routes/dailywheel.routes'));
app.use('/api/withdrawal-enhance', require('./routes/withdrawal-enhance.routes'));
app.use('/api/newsletter',       require('./routes/newsletter.routes'));
app.use('/api/premium-tournaments', require('./routes/premium-tournament.routes'));
app.use('/api/happy-hour', require('./routes/happyhour.routes'));
app.use('/api/session-reengage', require('./routes/session-reengage.routes'));
app.use('/api/session-analytics', require('./routes/session-analytics.routes'));
app.use('/api/segments',         require('./routes/player-segments.routes'));
app.use('/api/re-engagement',   require('./routes/re-engagement.routes'));
app.use('/api/dynamic-rtp',    require('./routes/dynamic-rtp.routes'));
app.use('/api/player-ltv',     require('./routes/player-ltv.routes'));
app.use('/api/revenue-analytics', require('./routes/revenue-analytics.routes'));
app.use('/api/social-jackpot',  require('./routes/social-jackpot.routes'));
app.use('/api/slot-events',      require('./routes/slotevents.routes'));
// REMOVED: non-slot game
// app.use('/api/fortunewheel',  require('./routes/fortunewheel.routes'));
// REMOVED: non-slot game
// app.use('/api/mines',         require('./routes/mines.routes'));
// REMOVED: non-slot game
// app.use('/api/crash',         require('./routes/crash.routes'));
// REMOVED: non-slot game
// app.use('/api/plinko',        require('./routes/plinko.routes'));
// REMOVED: non-slot game
// app.use('/api/hilo',          require('./routes/hilo.routes'));
// REMOVED: non-slot game
// app.use('/api/roulette',      require('./routes/roulette.routes'));
// REMOVED: non-slot game
// app.use('/api/dice',          require('./routes/dice.routes'));
// REMOVED: non-slot game
// app.use('/api/blackjack',     require('./routes/blackjack.routes'));
// REMOVED: non-slot game
// app.use('/api/videopoker',    require('./routes/videopoker.routes'));
// REMOVED: non-slot game
// app.use('/api/keno',          require('./routes/keno.routes'));
// REMOVED: non-slot game
// app.use('/api/baccarat',      require('./routes/baccarat.routes'));
// REMOVED: non-slot game
// app.use('/api/dragontiger',   require('./routes/dragontiger.routes'));
// REMOVED: non-slot game
// app.use('/api/limbo',         require('./routes/limbo.routes'));
// REMOVED: non-slot game
// app.use('/api/tower',         require('./routes/tower.routes'));
// REMOVED: non-slot game
// app.use('/api/wheel',         require('./routes/wheel.routes'));
// REMOVED: non-slot game
// app.use('/api/coinflip',      require('./routes/coinflip.routes'));
// REMOVED: non-slot game
// app.use('/api/sicbo',         require('./routes/sicbo.routes'));
// REMOVED: non-slot game
// app.use('/api/casinowar',     require('./routes/casinowar.routes'));
// REMOVED: non-slot game
// app.use('/api/reddog',        require('./routes/reddog.routes'));
// REMOVED: non-slot game
// app.use('/api/caribbeanstud',    require('./routes/caribbeanstud.routes'));
// REMOVED: non-slot game
// app.use('/api/threecardpoker',  require('./routes/threecardpoker.routes'));
// REMOVED: non-slot game
// app.use('/api/letitride',       require('./routes/letitride.routes'));
// REMOVED: non-slot game
// app.use('/api/scratch',        require('./routes/scratch.routes'));
// REMOVED: non-slot game
// app.use('/api/bigsixwheel',    require('./routes/bigsixwheel.routes'));
// REMOVED: non-slot game
// REMOVED: chuckaluck (deleted)
// REMOVED: non-slot game
// app.use('/api/moneywheel',     require('./routes/moneywheel.routes'));
// REMOVED: non-slot game
// app.use('/api/kenoturbo',      require('./routes/kenoturbo.routes'));
// REMOVED: non-slot game
// app.use('/api/horseracing',    require('./routes/horseracing.routes'));
app.use('/api/buy-feature',   require('./routes/buyfeature.routes'));
app.use('/api/xpshop',        require('./routes/xpshop.routes'));
app.use('/api/recommend',     require('./routes/recommend.routes'));
app.use('/api',               require('./routes/winback.routes'));
app.use('/api',               require('./routes/luckyhour.routes'));

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
        console.warn('[Bundle] purchase error:', e.message);
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
        console.warn('[Campaigns] Fetch error:', e.message);
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
        console.warn('[Events] Fetch error:', e.message);
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
        console.warn('[Gifting] Send error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

app.get('/api/gifts/pending', verifyToken, async (req, res) => {
    try {
        const giftingService = require('./services/gifting.service');
        const gifts = await giftingService.getPendingGifts(req.user.id);
        res.json({ gifts });
    } catch (e) {
        console.warn('[Gifting] Pending fetch error:', e.message);
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
        console.warn('[Gifting] Claim error:', e.message);
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
        console.warn('[Gifting] History fetch error:', e.message);
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
        console.warn('[Contest] Current fetch error:', e.message);
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
        console.warn('[Contest] Leaderboard fetch error:', e.message);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/contests/prizes', verifyToken, async (req, res) => {
    try {
        const contestService = require('./services/contest.service');
        const prizes = await contestService.getUserPrizes(req.user.id);
        res.json({ prizes });
    } catch (e) {
        console.warn('[Contest] Prizes fetch error:', e.message);
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

        // Atomic claim — UPDATE WHERE claimed = 0 prevents race condition double-claim
        const claimResult = await db.run(
            'UPDATE contest_prizes SET claimed = 1 WHERE id = ? AND user_id = ? AND claimed = 0',
            [prizeId, req.user.id]
        );
        if (!claimResult || claimResult.changes === 0) {
            return res.status(400).json({ error: 'Prize not found or already claimed' });
        }

        const prize = await db.get(
            'SELECT prize_amount FROM contest_prizes WHERE id = ?',
            [prizeId]
        );

        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            claimed: true,
            prizeAmount: prize.prize_amount,
            balance: user ? user.balance : 0,
            bonusBalance: user ? user.bonus_balance : 0
        });
    } catch (e) {
        console.warn('[Contest] Prize claim error:', e.message);
        res.status(500).json({ error: 'Failed to claim prize' });
    }
});

// ─── Static Files ───
// Block access to sensitive files BEFORE static middleware
app.use((req, res, next) => {
    const blocked = /\/(\.env|\.git|\.claude|package\.json|package-lock\.json|CLAUDE\.md|render\.yaml|node_modules|server|scripts|casino\.db|\.sql|\.bak|\.log|config\.js|\.dockerignore|Dockerfile)/i;
    if (blocked.test(req.path)) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
});

// Prefer bundled dist/ if it exists (production), otherwise serve from root (dev)
const distPath = path.join(__dirname, '..', 'dist');
const hasBundle = require('fs').existsSync(path.join(distPath, 'index.html'));

if (hasBundle) {
    // Production: serve from dist/
    app.use(express.static(distPath, {
        dotfiles: 'deny',
    }));
    // Also serve assets from repo root (symbols, thumbnails, backgrounds, GUI textures)
    // These aren't bundled into dist/ because they're large binary files
    app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), {
        dotfiles: 'deny',
        maxAge: '7d',       // cache assets for 7 days (they rarely change)
        immutable: true,
    }));
} else {
    // Development: serve from root
    app.use(express.static(path.join(__dirname, '..'), {
        dotfiles: 'deny',  // block dotfiles (.env, .git, etc.)
    }));
}

// Admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Free arcade — self-contained HTML games served as static files.
// /arcade or /arcade/ → arcade/index.html; /arcade/<game>.html → that file.
app.use('/arcade', express.static(
    hasBundle ? path.join(distPath, 'arcade') : path.join(__dirname, '..', 'arcade'),
    { dotfiles: 'deny', maxAge: '1d' }
));
app.get('/arcade', (req, res) => res.redirect(301, '/arcade/'));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    const indexPath = hasBundle
        ? path.join(distPath, 'index.html')
        : path.join(__dirname, '..', 'index.html');
    res.sendFile(indexPath);
});

// ─── Global Express Error Handler ───
// Must be defined AFTER all routes (4-parameter signature)
app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = config.NODE_ENV === 'production'
        ? 'Internal server error'
        : (err.message || 'Internal server error');
    console.warn(`[Express] Unhandled error on ${req.method} ${req.path}:`, err.stack || err);
    if (!res.headersSent) {
        res.status(status).json({ error: message });
    }
});

// ─── Start Server ───
async function start() {
    // Production safety checks — refuse to start with insecure defaults
    if (config.NODE_ENV === 'production') {
        if (config.JWT_SECRET === 'dev-secret-change-in-production') {
            console.warn('[Security] FATAL: JWT_SECRET is the default dev value. Set JWT_SECRET in .env before running in production.');
            process.exit(1);
        }
        if (config.ADMIN_PASSWORD === 'admin123changeme') {
            console.warn('[Security] FATAL: ADMIN_PASSWORD is the default dev value. Set ADMIN_PASSWORD in .env before running in production.');
            process.exit(1);
        }
    }

    await initDatabase();

    // One-time migration: fix seasonal event table columns (March 2026)
    const db = require('./database');
    try {
        await db.get("SELECT shamrock_cost FROM seasonal_event_prizes LIMIT 1");
        // Column exists — tables are correct, no migration needed
    } catch(e) {
        // Column doesn't exist or table doesn't exist — drop and let schema recreate
        try {
            await db.run('DROP TABLE IF EXISTS seasonal_event_progress');
            await db.run('DROP TABLE IF EXISTS seasonal_event_prizes');
            await db.run('DROP TABLE IF EXISTS seasonal_events');
            // Re-create with correct schema
            var isPg = !!process.env.DATABASE_URL;
            var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
            var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
            await db.run('CREATE TABLE IF NOT EXISTS seasonal_events (id ' + idDef + ', name TEXT NOT NULL, theme TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, bonus_multiplier REAL NOT NULL DEFAULT 1.0, special_currency TEXT, challenges TEXT NOT NULL, created_at ' + (isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))") + ', updated_at ' + (isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))") + ')');
            await db.run('CREATE TABLE IF NOT EXISTS seasonal_event_progress (id ' + idDef + ', user_id INTEGER NOT NULL, event_id INTEGER NOT NULL, challenge_id INTEGER NOT NULL, completed_at TEXT, shamrock_balance INTEGER NOT NULL DEFAULT 0, created_at ' + (isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))") + ', updated_at ' + (isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))") + ')');
            await db.run('CREATE TABLE IF NOT EXISTS seasonal_event_prizes (id ' + idDef + ', event_id INTEGER NOT NULL, shamrock_cost INTEGER NOT NULL, prize_type TEXT NOT NULL, prize_name TEXT NOT NULL, prize_details TEXT, created_at ' + (isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))") + ')');
            console.warn('[Migration] Recreated seasonal event tables with correct columns');
            // Seed St. Patrick's Day event
            var challenges = JSON.stringify([
                { id: 1, name: 'Spin 50 times', reward: 100 },
                { id: 2, name: 'Win $100 total', reward: 200 },
                { id: 3, name: 'Hit 3 wins in a row', reward: 150 },
                { id: 4, name: 'Play 5 different games', reward: 250 },
                { id: 5, name: 'Spin during Happy Hour', reward: 300 }
            ]);
            var eventResult = await db.run(
                'INSERT INTO seasonal_events (name, theme, start_date, end_date, bonus_multiplier, special_currency, challenges) VALUES (?,?,?,?,?,?,?)',
                ['Lucky Leprechaun Festival', 'st-patricks', '2026-03-15', '2026-03-20', 1.5, 'shamrocks', challenges]
            );
            // Seed prizes (use event id 1 as default)
            var prizes = [
                [1, 50, 'free_spins', '10 Free Spins', '{"spins":10}'],
                [1, 150, 'bonus_cash', '$5 Bonus', '{"amount":5}'],
                [1, 300, 'bonus_cash', '$15 Bonus', '{"amount":15}'],
                [1, 500, 'cosmetic', 'Lucky Clover Avatar', '{"avatar":"lucky-clover"}'],
                [1, 1000, 'combo', '$50 Bonus + Pot of Gold', '{"amount":50,"effect":"pot-of-gold"}']
            ];
            for (var p of prizes) {
                await db.run('INSERT INTO seasonal_event_prizes (event_id, shamrock_cost, prize_type, prize_name, prize_details) VALUES (?,?,?,?,?)', p);
            }
            console.warn('[Migration] Seeded St. Patricks Day event and prizes');
        } catch(e2) { console.warn('[Migration] Seasonal table migration:', e2.message); }
    }

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

    // Feedback tables auto-initialize on module load

    // ── Launch readiness self-check ──
    // In production, warn loudly (but don't hard-crash) when money-handling
    // features are enabled without the keys required to operate them.
    // The existing config.requireEnv already hard-crashes on missing JWT_SECRET
    // and ADMIN_PASSWORD. This block covers payment keys and compliance env.
    if (config.NODE_ENV === 'production') {
        const warnings = [];
        if (!config.STRIPE_SECRET_KEY || !/^sk_live_/.test(config.STRIPE_SECRET_KEY)) {
            warnings.push('STRIPE_SECRET_KEY is missing or not a live key — card deposits will fail.');
        }
        if (!config.STRIPE_WEBHOOK_SECRET) {
            warnings.push('STRIPE_WEBHOOK_SECRET is missing — webhooks cannot be verified; deposits will not credit.');
        }
        if (!process.env.ALLOWED_COUNTRIES && !process.env.BLOCKED_COUNTRIES) {
            warnings.push('No ALLOWED_COUNTRIES or BLOCKED_COUNTRIES set — geo-blocking is OFF. Payments accepted from every jurisdiction.');
        }
        if (!process.env.DATABASE_URL) {
            warnings.push('DATABASE_URL missing — running on SQLite. Production requires managed PostgreSQL for durability.');
        }
        if (warnings.length) {
            console.warn('\n' + '⚠'.repeat(25));
            console.warn('  LAUNCH READINESS WARNINGS');
            warnings.forEach(w => console.warn('   • ' + w));
            console.warn('⚠'.repeat(25) + '\n');
        }
    }

    app.listen(config.PORT, () => {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`  Matrix Spins Server running on port ${config.PORT}`);
        console.log(`  Environment: ${config.NODE_ENV}`);
        console.log(`  Open: http://localhost:${config.PORT}`);
        console.log(`  Admin: http://localhost:${config.PORT}/admin`);
        console.log(`${'='.repeat(50)}\n`);

        // Bootstrap tournament service
        const tournamentService = require('./services/tournament.service');
        tournamentService.ensureActive().catch(err => console.warn('[Tournament] Bootstrap error:', err.message));
        setInterval(() => tournamentService.tick().catch(err => console.warn('[Tournament] Tick error:', err.message)), 5 * 60 * 1000);

        // Bootstrap wager race service (hourly race, tick every 60s)
        const wageraceService = require('./services/wagerace.service');
        wageraceService.ensureActiveRace().catch(err => console.warn('[WagerRace] Bootstrap error:', err.message));
        setInterval(() => wageraceService.tick().catch(err => console.warn('[WagerRace] Tick error:', err.message)), 60 * 1000);

        // Bootstrap weekly contest service — ensure current week contest exists
        const contestService = require('./services/contest.service');
        contestService.getOrCreateCurrentContest().catch(err => console.warn('[Contest] Bootstrap error:', err.message));
        // Check for expired contests every 10 minutes
        setInterval(() => contestService.checkAndFinalizeExpired().catch(err => console.warn('[Contest] Finalize tick error:', err.message)), 10 * 60 * 1000);
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
    console.warn('Failed to start server:', err);
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

// ─── Global Process Error Handlers ───
// Catch unhandled promise rejections and uncaught exceptions to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.warn('[Server] Unhandled Promise Rejection:', reason);
    // Don't exit — let the process continue serving requests
});

process.on('uncaughtException', (err) => {
    console.warn('[Server] Uncaught Exception:', err.stack || err);
    // Exit after logging — the process manager (Render) will restart us
    process.exit(1);
});
