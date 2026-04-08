const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');

// --- Sentry Error Monitoring ---
// Initialize early so all subsequent errors are captured
let Sentry;
try {
    Sentry = require('@sentry/node');
    if (process.env.SENTRY_DSN) {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: config.NODE_ENV || 'development',
            tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
            ignoreErrors: [
                'TokenExpiredError',
                'JsonWebTokenError',
                'Too many requests',
            ],
        });
        console.log('[Sentry] Error monitoring active');
    }
} catch (e) {
    // Sentry optional — continue without it
}

// -- Security: warn or block on critical env vars --
(function checkSecurityConfig() {
    const errors = [];
    const warnings = [];
    if (!process.env.JWT_SECRET) warnings.push('JWT_SECRET not set — using random key (sessions will not persist across restarts)');
    else if (process.env.JWT_SECRET.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
    if (!process.env.ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD not set — using random password (check server logs)');
    if (!process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_SECRET_KEY) warnings.push('STRIPE_WEBHOOK_SECRET not set — webhook verification disabled');
    if (!process.env.DATABASE_URL) {
        warnings.push('DATABASE_URL not set — using SQLite (data may not persist across Render deploys). Set DATABASE_URL to a PostgreSQL connection string for production use.');
    }
    // In production, JWT_SECRET too short is fatal
    if (config.NODE_ENV === 'production' && errors.length > 0) {
        console.error('\n  FATAL SECURITY ERRORS:');
        errors.forEach(e => console.error('   x ' + e));
        console.error('   Fix these in your environment variables before deploying.\n');
        process.exit(1);
    }
    if (errors.length > 0) {
        console.warn('\n  SECURITY ERRORS (non-fatal in dev):');
        errors.forEach(e => console.warn('   x ' + e));
    }
    if (warnings.length > 0) {
        console.warn('\n  SECURITY WARNINGS:');
        warnings.forEach(w => console.warn('   ! ' + w));
        console.warn('   Set these in your .env file or Render environment variables.\n');
    }
    if (!process.env.ADMIN_PASSWORD) {
        console.log('[Security] Admin password generated (set ADMIN_PASSWORD env var to use a fixed password)');
    }
}());

const { initDatabase } = require('./database');
function logError(ctx, err) { console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', ctx, msg: err.message || String(err) })); }
function logInfo(ctx, msg, data) { console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', ctx, msg, ...data })); }
function logWarn(ctx, msg, data) { console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', ctx, msg, ...data })); }

const app = express();

// Trust Render's reverse proxy so rate-limiters and IP detection use the real
// client IP rather than the load-balancer IP (which would bucket all users together)
app.set('trust proxy', 1);
app.set('etag', 'strong');

// Gzip compression - reduces bandwidth 60-80%
app.use(compression({ level: 6, threshold: 512 }));

// Per-user rate limiting (complements IP-based limits)
const userRateLimit = require('./middleware/user-ratelimit');

// NOTE: No www redirect here — Cloudflare sits in front and already handles
// SSL for both msaart.online and www.msaart.online. Adding a server-side
// redirect creates a loop because Cloudflare redirects www?bare domain.

// --- Request tracking + response time ---
const crypto = require('crypto');
app.use((req, res, next) => {
    req.id = crypto.randomBytes(4).toString('hex');
    res.setHeader('X-Request-Id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        try {
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            if (ms > 500) console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', ctx: 'slow-request', method: req.method, path: req.path, ms: Math.round(ms), requestId: req.id }));
        } catch (timerErr) { console.warn('[perf] Slow request timer error:', timerErr.message); }
    });
    next();
});
// Response time header (useful for client-side perf monitoring)
app.use((req, res, next) => {
    const hrStart = process.hrtime();
    res.on('header', () => {});
    const origEnd = res.end;
    res.end = function(...args) {
        const diff = process.hrtime(hrStart);
        const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
        if (!res.headersSent) res.setHeader('X-Response-Time', ms + 'ms');
        return origEnd.apply(this, args);
    };
    next();
});

// --- Security Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],  // casino client uses inline scripts + ethers.js CDN + onclick-polyfill needs eval + canvas-confetti
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],       // inline styles + Google Fonts
            imgSrc: ["'self'", "data:", "blob:"],           // data URIs for generated assets
            connectSrc: ["'self'", "https://api.coingecko.com", "https://cloudflare-eth.com", "https://ipapi.co"],  // API calls + crypto price feed + ETH RPC
            fontSrc: ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],                          // no Flash/Java
            frameAncestors: ["'none'"],                     // no iframing (clickjacking protection)
            baseUri: ["'self'"],                            // prevent base tag hijacking
            formAction: ["'self'"],                         // restrict form submission targets
            scriptSrcAttr: ["'unsafe-inline'"],               // allow onclick= handlers (casino client legacy; plan to migrate to addEventListener)
            upgradeInsecureRequests: [],                       // force HTTPS for all subresources
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
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Permissions-Policy: restrict sensitive browser features
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    res.setHeader('X-Download-Options', 'noopen');
    // X-Content-Type-Options: nosniff is already set by helmet — no need to duplicate
    res.setHeader('Vary', 'Accept-Encoding, Origin');
    next();
});
// In production restrict CORS to the declared origin; open in development
const corsOrigin = config.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGIN || 'https://msaart.online')
    : (process.env.ALLOWED_ORIGIN || 'http://localhost:3000');
// Block wildcard + credentials in production (browsers reject it, but belt-and-suspenders)
if (config.NODE_ENV === 'production' && corsOrigin === '*') {
    console.error('FATAL: CORS origin cannot be * in production with credentials: true');
    process.exit(1);
}
app.use(cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Admin-Token'],
    maxAge: 86400 // Cache preflight for 24 hours
}));
// Stripe webhook needs the raw body (Buffer) for signature verification.
// Mount express.raw() BEFORE express.json() so the webhook path gets raw bytes.
app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
// Content-Length validation for oversized payloads (early rejection at middleware layer)
app.use((req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'], 10);
    if (contentLength > 102400) { // 100KB
        return res.status(413).json({ error: 'Payload too large' });
    }
    next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// --- Input Sanitization Middleware ---
// Runs on all requests to prevent XSS, prototype pollution, and other injection attacks
const sanitizeMiddleware = require('./middleware/sanitize');
app.use(sanitizeMiddleware);

// --- CSRF Protection Middleware ---
// Validates CSRF tokens on mutation endpoints (POST/PUT/DELETE)
const { csrfMiddleware, getCsrfTokenHandler } = require('./middleware/csrf');
const { authenticate: verifyToken } = require('./middleware/auth');
app.get('/api/csrf-token', verifyToken, getCsrfTokenHandler);
app.use(csrfMiddleware);

// --- Maintenance Mode Middleware ---
// Checks if system is under maintenance; blocks non-admin API routes
const { maintenanceMiddleware } = require('./middleware/maintenance');
app.use(maintenanceMiddleware);

// Global rate limiter — generous to accommodate page-load bursts
// (lobby fires 20+ status checks, plus polling intervals for
// live feed, jackpots, tournaments, etc.)
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3000, // 3000 requests per minute per IP (was 1000 — too aggressive
               // for a SPA that polls multiple endpoints every 15-30s)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', globalLimiter);

// Prevent caching of API responses containing sensitive data
app.use('/api/', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
});


// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 attempts per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts. Try again later.' },
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);

// Per-user auth limit: 20 requests per minute per authenticated user
const userAuthLimit = userRateLimit({ maxRequests: 120, windowMs: 60000 });
app.use('/api/auth/', userAuthLimit);

// Strict rate limit for bonus/reward endpoints (prevent rapid-fire exploitation)
const bonusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 120 attempts per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many bonus requests. Please wait.' },
});
app.use('/api/user/claim-daily-bonus', bonusLimiter);
app.use('/api/user/spin-wheel', bonusLimiter);
app.use('/api/user/redeem-promo', bonusLimiter);
app.use('/api/user/claim-loss-offer', bonusLimiter);
app.use('/api/user/claim-comeback-bonus', bonusLimiter);
// Deposit-bonus and cashback claim rate limits (prevent stacking abuse)
app.use('/api/deposit-bonus/claim', bonusLimiter);
app.use('/api/cashback/claim', bonusLimiter);

// ── Round 25: Comprehensive bonus route rate limiting ──
// All bonus claim endpoints need per-IP limiting to prevent rapid-fire exploitation.
// Strict claim limiter: 10 claims per minute per IP (generous for legitimate use, blocks automation)
const claimLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many claim requests. Please wait.' },
});
// Daily login / daily cashback / daily missions
app.use('/api/daily-login/claim', claimLimiter);
app.use('/api/dailycashback/claim', claimLimiter);
app.use('/api/dailymissions/claim', claimLimiter);
// Wheel spins
app.use('/api/dailywheel', claimLimiter);
app.use('/api/vipwheel', claimLimiter);
// Mystery box
app.use('/api/mystery/claim', claimLimiter);
// Loss-based bonuses
app.use('/api/loss-insurance/claim', claimLimiter);
app.use('/api/losscashback/claim', claimLimiter);
app.use('/api/lossstreak', claimLimiter);
app.use('/api/comeback', claimLimiter);
// Streak / achievement bonuses
app.use('/api/streak/claim', claimLimiter);
app.use('/api/challenges/claim', claimLimiter);
app.use('/api/achievements', claimLimiter);
app.use('/api/levelupbonus', claimLimiter);
app.use('/api/spinstreak', claimLimiter);
app.use('/api/winstreak', claimLimiter);
// Deposit-related bonuses
app.use('/api/reloadbonus', claimLimiter);
app.use('/api/firstdeposit', claimLimiter);
app.use('/api/depositmatch', claimLimiter);
app.use('/api/depositstreak', claimLimiter);
// Free spins / promo codes / referrals
app.use('/api/freespins/claim', claimLimiter);
app.use('/api/promocode/redeem', claimLimiter);
app.use('/api/referral/apply', claimLimiter);
app.use('/api/referral/reward', claimLimiter);
// NFT operations
app.use('/api/nft-deposit', claimLimiter);
// Gems / loyalty
app.use('/api/gems', claimLimiter);
app.use('/api/gem-store', claimLimiter);
app.use('/api/loyalty-store', claimLimiter);
app.use('/api/loyaltyshop', claimLimiter);
// Re-engagement / session bonuses
app.use('/api/re-engagement', claimLimiter);
app.use('/api/session-reengage', claimLimiter);
// Birthday / seasonal
app.use('/api/birthday', claimLimiter);
app.use('/api/seasonal-event', claimLimiter);
// Strict rate limit for password/account-sensitive endpoints
const sensitiveAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // 15 attempts per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
});
// Extra-strict limiter for password reset (3 per hour to prevent abuse)
const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset attempts. Try again in an hour.' },
});
// Account deletion limiter (3 per hour)
const accountDeletionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many deletion requests. Please wait before trying again.' },
});
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);
// Round 27: Rate limit admin-reset endpoint (3 per hour per IP — matches password reset)
app.use('/api/auth/admin-reset', passwordResetLimiter);
app.use('/api/user/change-password', sensitiveAuthLimiter);
app.use('/api/account/request-deletion', accountDeletionLimiter);

// Strict rate limit for deposit/withdrawal endpoints
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60, // 60 per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
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

// Per-user payment limit: 5 requests per minute per authenticated user
const userPaymentLimit = userRateLimit({ maxRequests: 60, windowMs: 60000 });
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
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many admin requests. Please slow down.' },
});
app.use('/api/admin', adminLimiter);

// Spin endpoint rate limit — caps automated spin abuse at Express layer
// (in addition to the per-user in-memory check in spin.routes.js)
const spinLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180, // 3 spins per second average
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Spinning too fast. Please slow down.' },
});
app.use('/api/spin', spinLimiter);
// Cashback record endpoint — rate limit to match realistic spin rates
app.use('/api/cashback/record', spinLimiter);
// Per-user spin limit: 60 spins per minute per authenticated user
app.use('/api/spin', userRateLimit({ maxRequests: 600, windowMs: 60000 }));

// --- Health Check Routes (used by Render / load balancers) ---
// Register BEFORE static middleware so health checks are always fast & accessible
const healthRoutes = require('./routes/health.routes');

app.use('/api', require('./routes/stripe-checkout.routes')); // Sprint 379-386

// NFT deposit/withdrawal system (Sprint NFT)
const { router: nftDepositRoutes, ensureNFTTables } = require('./routes/nft-deposit.routes');
app.use('/api', nftDepositRoutes);
app.use('/api/admin', require('./routes/admin-withdrawals.routes'));
// NFT table init moved to start() — runs after initDatabase()
app.use('/api/health', healthRoutes);

// IMPROVEMENT 29: Promotional popups API
app.use('/api/promos', require('./routes/promos.routes'));

// --- API Routes ---
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

// Public maintenance status � no auth required (clients check on load)
app.get('/api/maintenance/status', (req, res) => {
    res.json({ maintenance: false, message: null });
});
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
app.use('/api/game-stats', require('./routes/gamestats.routes'));
app.use('/api/gems', require('./routes/gems.routes'));
app.use('/api/boosts', require('./routes/boost.routes'));
app.use('/api/challenges', require('./routes/challenges.routes'));
app.use('/api/battlepass', require('./routes/battlepass.routes'));
app.use('/api/battle-pass', require('./routes/battle-pass.routes'));
app.use('/api/cosmetics',  require('./routes/cosmetics.routes'));
app.use('/api/wagerace',   require('./routes/wagerace.routes'));
app.use('/api/rentals',    require('./routes/rental.routes'));
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
app.use('/api/fair',           require('./routes/fair.routes'));
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
app.use('/api/buy-feature',   require('./routes/buyfeature.routes'));
app.use('/api/xpshop',        require('./routes/xpshop.routes'));
app.use('/api/recommend',     require('./routes/recommend.routes'));
app.use('/api',               require('./routes/winback.routes'));
app.use('/api',               require('./routes/luckyhour.routes'));
app.use('/api',               require('./routes/session-insights.routes')); // Sprint 219
app.use('/api/admin',          require('./routes/admin-dashboard.routes'));  // Sprint 291-298

// --- Big-win feed — recent large wins for social proof (cached 30s) ---
let bigWinsCache = null;
let bigWinsCacheExpiry = 0;
app.get('/api/big-wins', async (req, res) => {
    try {
        const now = Date.now();
        if (!bigWinsCache || now > bigWinsCacheExpiry) {
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
            bigWinsCache = rows.map(r => ({
                amount: r.win_amount,
                gameId: r.game_id,
                player: r.display_name || r.username,
                time: r.created_at
            }));
            bigWinsCacheExpiry = now + 30000; // 30-second TTL
        }
        res.json({ wins: bigWinsCache });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch big wins' });
    }
});

// --- Jackpots plural alias (standalone GET endpoint) ---
app.get('/api/jackpots', async (req, res) => {
    try {
        const jpService = require('./services/jackpot.service');
        const levels = await jpService.getJackpotLevels();
        res.json({ jackpots: levels });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch jackpots' });
    }
});

// --- Game definitions endpoint (sanitized — no payout tables) ---
const games = require('../shared/game-definitions');
// Pre-compute sanitized list once at startup (immutable data, no need to re-map per request)
const sanitizedGames = Object.freeze(games.map(g => Object.freeze({
    id: g.id, name: g.name, provider: g.provider,
    tag: g.tag, tagClass: g.tagClass, thumbnail: g.thumbnail,
    bgGradient: g.bgGradient, symbols: g.symbols, reelBg: g.reelBg,
    accentColor: g.accentColor, gridCols: g.gridCols, gridRows: g.gridRows,
    winType: g.winType, clusterMin: g.clusterMin, wildSymbol: g.wildSymbol,
    scatterSymbol: g.scatterSymbol, bonusType: g.bonusType, bonusDesc: g.bonusDesc,
    minBet: g.minBet, maxBet: g.maxBet, hot: g.hot, jackpot: g.jackpot,
    // NOTE: payouts, multiplier arrays, etc. are INTENTIONALLY EXCLUDED
})));
const sanitizedGamesJSON = JSON.stringify({ games: sanitizedGames });
app.get('/api/games', (req, res) => {
    // Serve pre-serialized JSON — avoids re-serialization on every request
    res.setHeader('Content-Type', 'application/json');
    res.send(sanitizedGamesJSON);
});

// --- Personalized bonus offers ---
app.get('/api/offers', verifyToken, async (req, res) => {
    try {
        const bonusRules = require('./services/bonus-rules.service');
        const offers = await bonusRules.getPersonalizedOffers(req.user.id);
        res.json({ offers });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});

// --- Spin-pack bundles (cached 5 min to reduce load) ---
app.get('/api/bundles', (req, res) => {
    try {
        var cacheService = require('./services/cache.service');
        var cached = cacheService.get('bundles');
        if (cached) {
            res.set('X-Cache', 'HIT');
            return res.json(cached);
        }
        const bundleService = require('./services/bundle.service');
        var result = { bundles: bundleService.getAvailableBundles() };
        cacheService.set('bundles', result, 300);
        res.set('X-Cache', 'MISS');
        res.json(result);
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
        res.status(400).json({ error: 'Bundle purchase failed' });
    }
});

// --- Active campaigns for current user ---
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

// --- Active bonus events (with countdown) ---
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

// --- Social Gifting ---
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
        res.status(400).json({ error: 'Gift send failed' });
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
        res.status(400).json({ error: 'Gift claim failed' });
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

// --- Weekly Auto-Contests ---
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

        // Credit the prize amount to the user's bonus balance (subject to wagering)
        if (prize && prize.prize_amount > 0) {
            await db.run(
                'UPDATE users SET bonus_balance = bonus_balance + ? WHERE id = ?',
                [prize.prize_amount, req.user.id]
            );
        }

        const user = await db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            claimed: true,
            prizeAmount: prize ? prize.prize_amount : 0,
            balance: user ? user.balance : 0,
            bonusBalance: user ? user.bonus_balance : 0
        });
    } catch (e) {
        console.warn('[Contest] Prize claim error:', e.message);
        res.status(500).json({ error: 'Failed to claim prize' });
    }
});

// --- Static Files (IMPROVEMENT 50: Optimized caching) ---
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

// Fix encoding corruption at startup: Render build can double-encode UTF-8
if (hasBundle) {
    const distIndex = path.join(distPath, 'index.html');
    let buf = fs.readFileSync(distIndex);
    let fixed = 0;
    const chunks = [];
    for (let i = 0; i < buf.length; i++) {
        if (i <= buf.length - 6 && buf[i]===0xC3 && buf[i+1]===0xAF && buf[i+2]===0xC2 && buf[i+3]===0xBF && buf[i+4]===0xC2 && buf[i+5]===0xBD) {
            chunks.push(Buffer.from([0xE2,0x80,0xA2])); fixed++; i+=5;
        } else if (i <= buf.length - 3 && buf[i]===0xEF && buf[i+1]===0xBF && buf[i+2]===0xBD) {
            chunks.push(Buffer.from([0xE2,0x80,0xA2])); fixed++; i+=2;
        } else { chunks.push(Buffer.from([buf[i]])); }
    }
    if (fixed > 0) { fs.writeFileSync(distIndex, Buffer.concat(chunks)); console.log('[encoding-fix] Fixed', fixed, 'garbled sequences in dist/index.html'); }
}

if (hasBundle) {
    // Production: serve hashed assets with long-term caching (immutable)
    app.use('/dist', express.static(path.join(__dirname, '..', 'dist'), {
        maxAge: '365d',
        immutable: true,
        etag: true
    }));
    // Production: serve from dist/
    app.use(express.static(distPath, {
        dotfiles: 'deny',
        maxAge: '1h',
        etag: true,
        lastModified: true,
        setHeaders: function(res, filePath) {
            if (/bundle\.[a-f0-9]+\.js|styles\.[a-f0-9]+\.css/.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        }
    }));
    // Also serve assets from repo root (symbols, thumbnails, backgrounds, GUI textures)
    // These aren't bundled into dist/ because they're large binary files
    app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), {
        dotfiles: 'deny',
        maxAge: '7d',       // cache assets for 7 days (they rarely change)
        immutable: true,
    }));
    // Fallback: serve unbundled CSS/JS from repo root (not yet in dist bundle)
    app.use(express.static(path.join(__dirname, '..'), {
        dotfiles: 'deny',
        maxAge: '1h',
    }));
} else {
    // Development: serve from root
    app.use(express.static(path.join(__dirname, '..'), {
        dotfiles: 'deny',  // block dotfiles (.env, .git, etc.)
    }));
}

// Admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // If requesting a .html file that doesn't exist, serve 404 page
    if (req.path.endsWith('.html')) {
        const fourOhFour = hasBundle
            ? path.join(distPath, '404.html')
            : path.join(__dirname, '..', '404.html');
        return res.status(404).sendFile(fourOhFour);
    }
    const indexPath = hasBundle
        ? path.join(distPath, 'index.html')
        : path.join(__dirname, '..', 'index.html');
    res.sendFile(indexPath);
});

// --- Global Express Error Handler ---
// Must be defined AFTER all routes (4-parameter signature)
app.use((err, req, res, _next) => {
    // ROUND 47: Auto-rollback any open transaction on unhandled error.
    // Prevents connection leaks in PostgreSQL and stale transaction flags in SQLite.
    try {
        const db = require('./database');
        db.rollback().catch(function(e) { if (e) console.warn('[global-error-handler] Rollback failed:', e.message); });
    } catch (rbLoadErr) { console.warn('[global-error-handler] DB module load failed:', rbLoadErr.message); }

    const status = err.status || err.statusCode || 500;
    const message = config.NODE_ENV === 'production'
        ? 'Internal server error'
        : (err.message || 'Internal server error');
    logError(`${req.method} ${req.path}`, err);
    // Report 5xx errors to Sentry (skip 4xx client errors)
    if (status >= 500 && Sentry && process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { method: req.method, path: req.path, requestId: req.id } });
    }
    if (!res.headersSent) {
        const response = { error: message, requestId: req.id };
        // Only include stack trace in development
        if (config.NODE_ENV !== 'production' && err.stack) {
            response.stack = err.stack;
        }
        res.status(status).json(response);
    }
});

// --- Start Server ---
async function start() {
    // Production safety checks — refuse to start with insecure defaults
    if (config.NODE_ENV === 'production') {
        if (config.JWT_SECRET === 'dev-secret-change-in-production') {
            console.warn('[Security] FATAL: JWT_SECRET is the default dev value. Set JWT_SECRET in .env before running in production.');
            process.exit(1);
        }
        if (config.ADMIN_PASSWORD === 'admin123changeme' || !config.ADMIN_PASSWORD) {
            console.warn('[Security] WARNING: ADMIN_PASSWORD should be set via environment variable in production.');
        }
    }

    await initDatabase();

    // ── Create audit_log table for financial operation tracking ──
    const db = require('./database');
    try {
        await db.run(
            "CREATE TABLE IF NOT EXISTS audit_log (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
            "event_type TEXT NOT NULL, " +
            "user_id INTEGER, " +
            "amount REAL, " +
            "reference TEXT, " +
            "details TEXT, " +
            "created_at TEXT DEFAULT (datetime('now')))"
        );
    } catch (_) { /* table may already exist */ }

    // One-time migration: fix seasonal event table columns (March 2026)
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

    // Initialize NFT tables (must run after initDatabase)
    await ensureNFTTables().catch(err => console.warn('[NFT] Table init deferred:', err.message));

    // Feedback tables auto-initialize on module load

    // Store server reference for graceful shutdown
    const server = app.listen(config.PORT, () => {
        // Expose server ref for shutdown handler
        app.set('server', server);
        console.log(`\n${'='.repeat(50)}`);
        console.log(`  Matrix Spins Server running on port ${config.PORT}`);
        console.log(`  Environment: ${config.NODE_ENV}`);
        console.log(`  Open: http://localhost:${config.PORT}`);
        console.log(`  Admin: http://localhost:${config.PORT}/admin`);
        console.log(`${'='.repeat(50)}\n`);

        // Startup banner with config summary (structured JSON logging)
        logInfo('startup', 'Server started', {
            port: config.PORT,
            env: config.NODE_ENV,
            corsOrigin: typeof corsOrigin === 'string' ? corsOrigin : 'dynamic'
        });

        // Force-reset admin credentials on every startup (guarantees login works)
        (async function() {
            try {
                var bcrypt = require('bcryptjs');
                var hash = bcrypt.hashSync(config.ADMIN_PASSWORD, 12);
                var adminUser = config.ADMIN_USERNAME || 'matrix';
                // Update or create 'admin'
                var existing = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
                if (existing) {
                    await db.run('UPDATE users SET password_hash = ?, is_admin = 1 WHERE username = ?', [hash, 'admin']);
                } else {
                    await db.run('INSERT INTO users (username, email, password_hash, balance, is_admin) VALUES (?, ?, ?, ?, ?)',
                        ['admin', 'admin@matrixspins.com', hash, 0, 1]);
                }
                // Update or create configured admin
                if (adminUser !== 'admin') {
                    var ex2 = await db.get('SELECT id FROM users WHERE username = ?', [adminUser]);
                    if (ex2) {
                        await db.run('UPDATE users SET password_hash = ?, is_admin = 1 WHERE username = ?', [hash, adminUser]);
                    } else {
                        await db.run('INSERT INTO users (username, email, password_hash, balance, is_admin) VALUES (?, ?, ?, ?, ?)',
                            [adminUser, adminUser + '@matrixspins.com', hash, 0, 1]);
                    }
                }
                console.log('[Admin] Credentials synced (' + (process.env.ADMIN_PASSWORD ? 'env' : 'generated') + ')');
            } catch (e) {
                console.warn('[Admin] Credential sync failed:', e.message);
            }
        })();

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

// --- Graceful Shutdown ---
// Stop accepting new connections, drain in-flight requests, then close DB
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logInfo('shutdown', `Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    const httpServer = app.get('server');
    if (httpServer) {
        httpServer.close(() => logInfo('shutdown', 'HTTP server closed'));
    }

    // Force exit after 15 seconds as safety net
    setTimeout(() => {
        logWarn('shutdown', 'Forced exit after timeout');
        process.exit(1);
    }, 15000).unref();

    // Wait for in-flight requests to drain (up to 5 seconds)
    await new Promise(r => setTimeout(r, 5000));

    // Flush and close database
    try {
        const { getBackend } = require('./database');
        const backend = getBackend();
        if (backend) {
            // SQLite: flush debounced writes and checkpoint WAL
            if (typeof backend._flushToDisk === 'function') {
                backend._flushToDisk();
                logInfo('shutdown', 'SQLite data flushed to disk');
            }
            if (typeof backend.close === 'function') {
                await backend.close();
                logInfo('shutdown', 'Database connection closed');
            }
        }
    } catch (e) {
        logError('shutdown', e);
    }

    logInfo('shutdown', 'Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Global Process Error Handlers ---
// Catch unhandled promise rejections and uncaught exceptions to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.warn('[Server] Unhandled Promise Rejection:', reason);
    if (Sentry && process.env.SENTRY_DSN) Sentry.captureException(reason || new Error('Unhandled rejection'));
    // Don't exit — let the process continue serving requests
});

process.on('uncaughtException', (err) => {
    console.warn('[Server] Uncaught Exception:', err.stack || err);
    if (Sentry && process.env.SENTRY_DSN) {
        Sentry.captureException(err);
    }
    // Don't exit — let the process continue serving requests
});