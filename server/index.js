/**
 * Matrix Spins Casino — Server Entry Point
 *
 * Production-grade Express server serving the casino frontend + API routes.
 * - Wires ALL production routes from server/routes/
 * - Initializes PostgreSQL (with SQLite fallback in degraded mode)
 * - Mounts payment/spin/auth with rate limiting + auth + degraded-mode guards
 * - Cryptographically-secure RNG (Math.random override) loaded first
 * - Graceful shutdown, structured logging, global error handler
 */

// ── Cryptographically-secure RNG MUST load first ────────────
// Replaces Math.random() globally so any downstream code is safe.
require('./utils/secure-rng');

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { initDatabase, isDegraded, lastPgError } = require('./database');
const logger = require('./utils/logger');
const { buildHelmet, permissionsPolicy } = require('./middleware/security-headers');
const { requestLogger, getPerfSnapshot } = require('./middleware/request-logger');
const { suspiciousActivity, getBlockedIps } = require('./middleware/suspicious-activity');
const { notFoundApiHandler, globalErrorHandler } = require('./middleware/error-handler');

const app = express();
const PORT = config.PORT || process.env.PORT || 3000;

// ── Trust proxy (Render / Cloudflare) ──────────────────────
// Without this, rate limiters bucket all traffic by load-balancer IP.
app.set('trust proxy', 1);
app.set('etag', 'strong');

// ── Environment Validation ──────────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'ADMIN_PASSWORD'];
const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
  logger.warn('Missing env vars (degraded mode)', { missing });
  logger.warn('Money operations may be unavailable until set; see render.yaml + .env.example');
}

if (config.NODE_ENV === 'production') {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    logger.error('FATAL: JWT_SECRET must be at least 32 characters in production');
    process.exit(1);
  }
  const KNOWN_DEFAULTS = ['dev-secret-do-not-use-in-production', 'admin-change-me-now'];
  if (KNOWN_DEFAULTS.includes(config.JWT_SECRET)) {
    logger.error('FATAL: JWT_SECRET is a known default — set a real secret');
    process.exit(1);
  }
  if (KNOWN_DEFAULTS.includes(config.ADMIN_PASSWORD)) {
    logger.error('FATAL: ADMIN_PASSWORD is a known default — set a real password');
    process.exit(1);
  }
}

// ── Liveness probe — MUST be first, no DB dependency ──────────────
// Render fires the health check immediately after the process starts,
// before initDatabase() and mountAllRoutes() complete. If this isn't
// mounted early it 404s → Render marks the deploy failed → restart loop.
//
// Helmet is mounted FIRST so even this early health-check response
// carries the full HSTS / X-Content-Type-Options / Referrer-Policy /
// Permissions-Policy / X-Frame-Options stack. buildHelmet() is pure —
// no DB or async deps — so it can run before initDatabase().
// Previously the health endpoint was registered before helmet, so the
// JSON response went out with no security headers at all.
app.use(buildHelmet());
app.use(permissionsPolicy);
app.get('/api/health/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

// ── Request ID (early — used by every downstream middleware) ───
app.use((req, res, next) => {
  req.id = crypto.randomBytes(4).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

// ── Structured request/perf logging via winston ─────────────────
app.use(requestLogger());

// ── IP-based suspicious-activity guard (before rate limits) ─────
app.use(suspiciousActivity);

// ── Compression (gzip) ──────────────────────────────────────
try {
  const compression = require('compression');
  app.use(compression({ level: 6, threshold: 512 }));
} catch (_) {
  logger.warn('compression not installed — responses will be uncompressed');
}

// ── Vary header (helmet + Permissions-Policy already mounted above) ──
app.use((req, res, next) => {
  res.setHeader('Vary', 'Accept-Encoding, Origin');
  next();
});

// ── CORS ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (() => {
  if (process.env.ALLOWED_ORIGIN) {
    return process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (config.NODE_ENV === 'production') {
    return [
      'https://msaart.online',
      'https://www.msaart.online',
    ];
  }
  return ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'];
})();
app.use(cors({
  origin(origin, cb) {
    // In production, reject null/missing origins (sandboxed iframes, file:// pages)
    // In development, allow missing origin for tools like curl / Postman
    if (!origin) {
      const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
      return cb(null, isDev);
    }
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Admin-Token'],
  maxAge: 86400,
}));

// ── Stripe webhook needs raw body BEFORE express.json() ────
app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/payment/webhook',         express.raw({ type: 'application/json' }));
app.use('/api/stripe/webhook',          express.raw({ type: 'application/json' }));

// ── Body Parsers + Size Limits ─────────────────────────────
app.use((req, res, next) => {
  const len = parseInt(req.headers['content-length'], 10);
  if (len > 102400) return res.status(413).json({ error: 'Payload too large' });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
try {
  app.use(require('cookie-parser')());
} catch (_) {
  logger.warn('cookie-parser not installed — cookie middleware disabled');
}

// ── Sanitize, CSRF, Maintenance ────────────────────────────
function safeMiddleware(modulePath, name) {
  try {
    return require(modulePath);
  } catch (err) {
    logger.warn(`Middleware ${name} failed to load`, { error: err.message });
    return (req, res, next) => next();
  }
}

const sanitizeMiddleware = safeMiddleware('./middleware/sanitize', 'sanitize');
app.use(sanitizeMiddleware);

let optionalAuth = (req, res, next) => next();
let verifyToken = (req, res, next) => res.status(401).json({ error: 'Auth not loaded' });
try {
  const auth = require('./middleware/auth');
  optionalAuth = auth.optionalAuth;
  verifyToken = auth.authenticate;
} catch (err) {
  logger.warn('auth middleware failed', { error: err.message });
}
app.use('/api', optionalAuth);

try {
  const { csrfMiddleware, getCsrfTokenHandler } = require('./middleware/csrf');
  app.get('/api/csrf-token', verifyToken, getCsrfTokenHandler);
  app.use(csrfMiddleware);
} catch (err) {
  logger.warn('csrf middleware failed', { error: err.message });
}

try {
  const { maintenanceMiddleware } = require('./middleware/maintenance');
  app.use(maintenanceMiddleware);
} catch (err) {
  logger.warn('maintenance middleware failed', { error: err.message });
}

const { degradedModeGuard } = require('./middleware/degraded-mode');

// ── Rate Limiters ──────────────────────────────────────────
// General API limit: 100 req/min/IP per spec. Polling endpoints (jackpot,
// balance) are heavily cached client-side and use realtime websockets, so
// 100/min/IP is plenty for a single user; bots and scrapers get clipped.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RL_API_PER_MIN, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', globalLimiter);

// Cache-control for API responses (no caching of sensitive data)
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Auth: 5/min/IP per spec (matches password-spray budget for honest users).
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RL_AUTH_PER_MIN, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please wait a minute.' },
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/logout',   authLimiter);

const passwordResetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password',  passwordResetLimiter);

const claimLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const claimPaths = [
  '/api/daily-login/claim', '/api/dailycashback/claim', '/api/dailymissions/claim',
  '/api/dailywheel', '/api/vipwheel', '/api/mystery/claim',
  '/api/loss-insurance/claim', '/api/losscashback/claim', '/api/lossstreak', '/api/comeback',
  '/api/streak/claim', '/api/challenges/claim', '/api/levelupbonus', '/api/spinstreak',
  '/api/winstreak', '/api/reloadbonus', '/api/firstdeposit', '/api/depositmatch', '/api/depositstreak',
  '/api/freespins/claim', '/api/promocode/redeem', '/api/referral/apply', '/api/referralbonus/apply',
  '/api/gems', '/api/gem-store', '/api/loyalty-store', '/api/loyaltyshop',
  '/api/birthday', '/api/seasonal-event', '/api/re-engagement', '/api/session-reengage',
];
claimPaths.forEach(p => app.use(p, claimLimiter));

const paymentLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false });
app.use('/api/payment/deposit',         paymentLimiter);
app.use('/api/payment/withdraw',        paymentLimiter);
app.use('/api/payment/create-checkout', paymentLimiter);
app.use('/api/crypto/verify-deposit',   paymentLimiter);
app.use('/api/withdrawal-enhance',      paymentLimiter);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RL_ADMIN_PER_MIN, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Admin rate limit exceeded.' },
});
app.use('/api/admin', adminLimiter);
// The hyphenated admin prefixes are SEPARATE path segments, so the line above
// does NOT cover them. Rate-limit them too — these carry the most abuse-prone
// admin mutations (bulk withdrawal approval, mass email broadcast, RG limits).
app.use('/api/admin-withdrawals', adminLimiter);
app.use('/api/admin-email', adminLimiter);
app.use('/api/admin-rg', adminLimiter);
app.use('/api/admin-metrics', adminLimiter);

const spinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RL_SPIN_PER_MIN, 10) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Spin rate limit exceeded — slow down.' },
});
app.use('/api/spin', spinLimiter);

// ── Geo-Block REMOVED — the casino is open to all jurisdictions. No
// country/IP gating on registration or payments. (Operator decision; ensure
// licensing covers your served markets.) ───────────────────
// ── Degraded-Mode Guard on money endpoints ─────────────────
// Stripe webhook is INTENTIONALLY excluded — we still need to receive
// confirmations for in-flight payments when PG reconnects.
app.use('/api/payment/deposit',  degradedModeGuard);
app.use('/api/payment/withdraw', degradedModeGuard);
app.use('/api/payment/create-checkout', degradedModeGuard);
app.use('/api/balance',          degradedModeGuard);
app.use('/api/crypto',           degradedModeGuard);
app.use('/api/withdrawal-enhance', degradedModeGuard);

// ── KYC enforcement on money endpoints ─────────────────────
// Lazy-resolves so kyc.routes module loads after DB init (its migrations
// would no-op otherwise and the column wouldn't be created).
const _kycCache = {};
function _kycMw(name) {
  return function(req, res, next) {
    if (!_kycCache.loaded) {
      try {
        _kycCache.mod = require('./routes/kyc.routes');
        _kycCache.loaded = true;
      } catch (err) {
        logger.warn('KYC enforcement load failed — passing through', { error: err.message });
        _kycCache.loaded = true;
        _kycCache.mod = null;
      }
    }
    if (!_kycCache.mod || typeof _kycCache.mod[name] !== 'function') return next();
    return _kycCache.mod[name](req, res, next);
  };
}
// Withdrawals: BLOCKED unless KYC tier allows (basic+)
app.use('/api/payment/withdraw',   _kycMw('enforceWithdrawalKyc'));
app.use('/api/withdrawal-enhance', _kycMw('enforceWithdrawalKyc'));
app.use('/api/crypto/withdraw',    _kycMw('enforceWithdrawalKyc'));
// Deposits: cap by tier (unverified $500, basic $5k, full unlimited)
app.use('/api/payment/deposit',         _kycMw('enforceDepositCap'));
app.use('/api/payment/create-checkout', _kycMw('enforceDepositCap'));

// ── Safe Route Loader (deferred — runs after initDatabase) ─
// Routes' fire-and-forget table bootstraps need a live DB connection.
// Mounting them at module-load time produces noisy errors and broken tables.
const loadedRoutes = [];
const failedRoutes = [];
let routesMounted = false;
function mount(prefix, modulePath, label) {
  try {
    const mod = require(modulePath);
    const router = mod && mod.router ? mod.router : mod;
    app.use(prefix, router);
    loadedRoutes.push({ prefix, label: label || modulePath });
  } catch (err) {
    failedRoutes.push({ prefix, modulePath, error: err.message });
    logger.warn('Route mount failed', { prefix, modulePath, error: err.message });
  }
}

function mountAllRoutes() {
  if (routesMounted) return;
  routesMounted = true;

// ── Production Routes (95+ files in server/routes/) ────────
// Auth, payment, spin (revenue-critical) FIRST.
mount('/api/auth',     './routes/auth.routes',      'auth');
mount('/api/spin',     './routes/spin.routes',      'spin');
mount('/api/balance',  './routes/balance.routes',   'balance');
mount('/api/payment',  './routes/payment.routes',   'payment (Stripe + crypto)');
mount('/api',          './routes/stripe-checkout.routes', 'stripe-checkout');
mount('/api/user',     './routes/user.routes',      'user');
mount('/api/admin',    './routes/admin.routes',     'admin');
mount('/api/admin/analytics', './routes/admin-analytics.routes', 'admin-analytics');
mount('/api/admin-metrics', './routes/adminmetrics.routes', 'admin-metrics');

// Compliance audit logs
mount('/api/age-deny', './routes/age-deny.routes', 'age-deny-audit');

// Per-game personal stats (premium retention feature)
mount('/api/games', './routes/mygamestats.routes', 'my-game-stats');

// Money / withdrawals
mount('/api/withdrawal-enhance', './routes/withdrawal-enhance.routes', 'withdrawal-enhance');
mount('/api/crypto',             './routes/crypto.routes',             'crypto');
mount('/api/matrix-money',       './routes/matrix-money.routes',       'matrix-money');
mount('/api/nft-deposit',        './routes/nft-deposit.routes',        'nft-deposit');

// Game ecosystem
mount('/api/jackpot',     './routes/jackpot.routes',     'jackpot');
mount('/api/leaderboard', './routes/leaderboard.routes', 'leaderboard');
mount('/api/tournament',  './routes/tournament.routes',  'tournament');
mount('/api/tournaments', './routes/tournament.routes',  'tournaments-alias');
mount('/api/premium-tournaments', './routes/premium-tournament.routes', 'premium-tournament');
mount('/api/feed',        './routes/feed.routes',        'feed');
mount('/api/perf',        './routes/perf.routes',        'perf');
mount('/api/session',     './routes/session.routes',     'session');
mount('/api/game-of-day', './routes/gameofday.routes',   'game-of-day');
mount('/api/game-stats',  './routes/gamestats.routes',   'game-stats');
mount('/api/game-history', './routes/gamehistory.routes', 'game-history');
mount('/api/sessions',     './routes/sessions.routes',    'sessions (history-derived)');
mount('/api/player-stats', './routes/playerstats.routes', 'player-stats');
mount('/api/fair',        './routes/fair.routes',        'fair (provably-fair)');
mount('/api/buy-feature', './routes/buyfeature.routes',  'buy-feature');
mount('/api/dynamic-rtp', './routes/dynamic-rtp.routes', 'dynamic-rtp');
mount('/api/recommend',   './routes/recommend.routes',   'recommend');
mount('/api/games',       './routes/games-catalog.routes', 'games-catalog (search + analytics)');

// Bonuses & promotions
mount('/api/promocode',     './routes/promocode.routes',     'promocode');
mount('/api/welcome-bonus', './routes/welcome-bonus.routes', 'welcome-bonus');
mount('/api/bonus-history', './routes/bonus-history.routes', 'bonus-history');
mount('/api/bonus-forfeit', './routes/bonus-forfeit.routes', 'bonus-forfeit');
mount('/api/firstdeposit',  './routes/firstdeposit.routes',  'firstdeposit');
mount('/api/reloadbonus',   './routes/reloadbonus.routes',   'reloadbonus');
mount('/api/depositmatch',  './routes/depositmatch.routes',  'depositmatch');
mount('/api/vipdeposit',   './routes/vipdeposit.routes',    'vipdeposit');
mount('/api/deposit-bonus', './routes/deposit-bonus.routes', 'deposit-bonus');
mount('/api/deposit-streak', './routes/depositstreak.routes', 'deposit-streak');
mount('/api/cashback',      './routes/cashback.routes',      'cashback');
mount('/api/dailycashback', './routes/dailycashback.routes', 'dailycashback');
mount('/api/loss-cashback', './routes/losscashback.routes',  'loss-cashback');
mount('/api/loss-insurance', './routes/loss-insurance.routes', 'loss-insurance');
mount('/api/freespins',     './routes/freespins.routes',     'freespins');
mount('/api/dailywheel',    './routes/dailywheel.routes',    'dailywheel');
mount('/api/daily-wheel',   './routes/dailywheel.routes',    'daily-wheel-alias');
mount('/api/vipwheel',      './routes/vipwheel.routes',      'vipwheel');
mount('/api/mystery',       './routes/mystery.routes',       'mystery');
mount('/api/birthday',      './routes/birthday.routes',      'birthday');
mount('/api/daily-login',   './routes/daily-login.routes',   'daily-login');
mount('/api/dailymissions', './routes/dailymissions.routes', 'dailymissions');
mount('/api/seasonal-event', './routes/seasonal-event.routes', 'seasonal-event');
mount('/api/levelupbonus',  './routes/levelupbonus.routes',  'levelupbonus');
mount('/api/spinstreak',    './routes/spinstreak.routes',    'spinstreak');
mount('/api/winstreak',     './routes/winstreak.routes',     'winstreak');
mount('/api/lossstreak',    './routes/lossstreak.routes',    'lossstreak');
mount('/api/streak',        './routes/streak.routes',        'streak');
mount('/api/comeback',      './routes/comeback.routes',      'comeback');
mount('/api/winback',       './routes/winback.routes',       'winback');
mount('/api/re-engagement', './routes/re-engagement.routes', 're-engagement');
mount('/api/session-reengage', './routes/session-reengage.routes', 'session-reengage');
mount('/api/happy-hour',    './routes/happyhour.routes',     'happy-hour');
mount('/api/luckyhours',    './routes/luckyhours.routes',    'luckyhours');
mount('/api/luckyhour',     './routes/luckyhour.routes',     'luckyhour');
mount('/api/hotgame',       './routes/hotgame.routes',       'hotgame');
mount('/api/socialproof',   './routes/socialproof.routes',   'socialproof');
mount('/api/social-jackpot', './routes/social-jackpot.routes', 'social-jackpot');
mount('/api/slot-events',   './routes/slotevents.routes',    'slot-events');
mount('/api/slot-race',     './routes/slot-race.routes',     'slot-race');
mount('/api/wagerace',      './routes/wagerace.routes',      'wagerace');
mount('/api/rakeback',      './routes/rakeback.routes',      'rakeback');
mount('/api/subscription',  './routes/subscription.routes',  'subscription');
mount('/api/battle-pass',   './routes/battle-pass.routes',   'battle-pass');
mount('/api/battlepass',    './routes/battle-pass.routes',   'battlepass-alias');

// Identity / 2FA / KYC / Social
mount('/api/2fa',            './routes/twofa.routes',         '2fa (TOTP)');
mount('/api/kyc',            './routes/kyc.routes',           'kyc');
mount('/api/admin/kyc',          './routes/admin-kyc.routes',          'admin-kyc');
mount('/api/admin/setup-status', './routes/setup-status.routes',      'admin-setup-status');
mount('/api/profile',        './routes/profile.routes',       'profile');
mount('/api/friends',        './routes/friends.routes',       'friends');
mount('/api/activity-feed',  './routes/activity-feed.routes', 'activity-feed');
mount('/api/user-search',    './routes/user-search.routes',   'user-search');

// Engagement systems
mount('/api/vip',           './routes/vip.routes',           'vip-loyalty');
mount('/api/achievements',  './routes/achievements.routes',  'achievements');
mount('/api/challenges',    './routes/challenges.routes',    'challenges');
mount('/api/milestones',    './routes/milestones.routes',    'milestones');
mount('/api/notifications', './routes/notifications.routes', 'notifications');
mount('/api/cosmetics',     './routes/cosmetics.routes',     'cosmetics');
mount('/api/gems',          './routes/gems.routes',          'gems');
mount('/api/gem-store',     './routes/gem-store.routes',     'gem-store');
mount('/api/loyalty-store', './routes/loyalty-store.routes', 'loyalty-store');
mount('/api/loyaltyshop',   './routes/loyaltyshop.routes',   'loyaltyshop');
mount('/api/loyalty',       './routes/loyalty-store.routes', 'loyalty-alias');
mount('/api/boosts',        './routes/boost.routes',         'boost');
mount('/api/rentals',       './routes/rental.routes',        'rental');
mount('/api/gifts',         './routes/gifts.routes',         'gifts');
mount('/api/referral',      './routes/referral.routes',      'referral');
mount('/api/referralbonus', './routes/referralbonus.routes', 'referralbonus');
mount('/api/referral-commission', './routes/referral-commission.routes', 'referral-commission');
mount('/api/affiliate',     './routes/affiliate.routes',     'affiliate');
mount('/api/xpshop',        './routes/xpshop.routes',        'xpshop');
mount('/api/abtesting',     './routes/abtesting.routes',     'abtesting');
mount('/api/ab',            './routes/abtesting.routes',     'ab-alias');
mount('/api/chat',          './routes/chat.routes',          'chat');
mount('/api/support',       './routes/support.routes',       'support (live chat)');
mount('/api/feedback',      './routes/feedback.routes',      'feedback');
mount('/api/favorites',     './routes/favorites.routes',     'favorites');

// Compliance / responsible-gambling
mount('/api/self-exclusion', './routes/selfexclusion.routes', 'self-exclusion');
mount('/api/deposit-limits', './routes/depositlimits.routes', 'deposit-limits');
mount('/api/loss-limits',    './routes/loss-limits.routes',   'loss-limits');
mount('/api/admin-rg',       './routes/admin-rg.routes',      'admin-rg');
mount('/api/account',        './routes/accountdeletion.routes', 'account-deletion');
mount('/api/activity-log',   './routes/activitylog.routes',  'activity-log');
mount('/api/maintenance',    './routes/maintenance.routes',  'maintenance');

// Analytics
mount('/api/segments',          './routes/player-segments.routes',     'player-segments');
mount('/api/player-ltv',        './routes/player-ltv.routes',          'player-ltv');
mount('/api/revenue-analytics', './routes/revenue-analytics.routes',   'revenue-analytics');
mount('/api/revenue-dashboard', './routes/revenue-dashboard.routes',   'revenue-dashboard');
mount('/api/session-analytics', './routes/session-analytics.routes',   'session-analytics');
mount('/api/campaigns',         './routes/campaigns.routes',           'campaigns');
mount('/api/deposit-campaigns', './routes/campaigns.routes',           'deposit-campaigns-alias');

// Health + newsletter + SEO (dynamic sitemap/robots)
mount('/api/health',     './routes/health.routes',     'health');
mount('/api/newsletter', './routes/newsletter.routes', 'newsletter');
mount('/api/bundles',    './routes/bundles.routes',    'bundles (stub — 501 until Stripe wired)');
mount('/',               './routes/seo.routes',        'seo (sitemap, robots, structured-data)');

// Email (preferences + admin broadcast)
mount('/api/email',         './routes/email.routes',        'email-preferences');
mount('/api/admin-email',   './routes/admin-email.routes',  'admin-email-broadcast');

// Crypto deposit (multi-currency BTC/ETH/USDT)
mount('/api/crypto-deposit', './routes/crypto-deposit.routes', 'crypto-deposit (BTC/ETH/USDT)');

// Payment methods + receipts
mount('/api/payment-methods', './routes/payment-methods.routes', 'payment-methods');
mount('/api/receipts',        './routes/receipts.routes',        'transaction-receipts');

// Withdrawal admin queue
mount('/api/admin-withdrawals', './routes/admin-withdrawals.routes', 'admin-withdrawal-queue');

// Table games removed - slots only casino
// mount('/api/blackjack',   './routes/blackjack.routes',   'blackjack');
// mount('/api/roulette',    './routes/roulette.routes',    'roulette');
// mount('/api/video-poker', './routes/video-poker.routes', 'video-poker');

  // close mountAllRoutes()
}

// ── Health Check (always available) ────────────────────────
app.get('/api/health-summary', async (req, res) => {
  const mem = process.memoryUsage();
  let dbOk = false, dbResponseMs = null;
  try {
    const db = require('./database');
    const t = Date.now();
    await Promise.race([
      db.get('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('db ping timeout')), 2000)),
    ]);
    dbResponseMs = Date.now() - t;
    dbOk = true;
  } catch (_) { dbOk = false; }

  res.json({
    status: isDegraded() || !dbOk ? 'degraded' : 'ok',
    degraded: isDegraded(),
    pgError: (lastPgError() ? 'PG connection error' : null),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    name: 'Matrix Spins Casino',
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      rssMB: Math.round(mem.rss / 1048576),
      externalMB: Math.round((mem.external || 0) / 1048576),
    },
    db: {
      ok: dbOk,
      responseMs: dbResponseMs,
    },
    env: {
      database: !!process.env.DATABASE_URL,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      auth: !!process.env.JWT_SECRET,
      adminApiKey: !!process.env.ADMIN_API_KEY,
      logging: { dir: logger.logDir, fileTransports: !!logger.canWriteFiles },
    },
    routesLoaded: loadedRoutes.length,
    routesFailed: failedRoutes.length,
    nodeVersion: process.version,
  });
});

// ── Diagnostic: list routes (admin API key only) ───────────
function adminGuard(req, res) {
  const expected = process.env.ADMIN_API_KEY || process.env.ADMIN_PASSWORD;
  if (!expected) { res.status(503).json({ error: 'admin key not configured' }); return false; }
  const provided = req.headers['x-admin-api-key'] || req.headers['x-admin-token'];
  if (!provided || provided !== expected) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}
app.get('/api/debug/routes', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ loaded: loadedRoutes, failed: failedRoutes });
});

// ── Diagnostic: rolling perf snapshot ─────────────────────
app.get('/api/debug/perf', (req, res) => {
  if (!adminGuard(req, res)) return;
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  res.json({ endpoints: getPerfSnapshot(limit), generatedAt: new Date().toISOString() });
});

// ── Diagnostic: blocked IPs from suspicious-activity ──────
app.get('/api/debug/blocked-ips', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ blocked: getBlockedIps(), generatedAt: new Date().toISOString() });
});

// ── Static Files / SPA fallback / error handler ────────────
// Bound after routes so /api/* always wins over the catch-all.
const FRONTEND_ROOT = path.join(__dirname, '..');
const distPath = path.join(FRONTEND_ROOT, 'dist');
const hasBundle = fs.existsSync(path.join(distPath, 'index.html'));
let catchAllBound = false;
function bindCatchAll() {
  if (catchAllBound) return;
  catchAllBound = true;

  // Block sensitive paths from static serving
  app.use((req, res, next) => {
    const blocked = /\/(\.env|\.git|\.claude|package\.json|package-lock\.json|CLAUDE\.md|render\.yaml|node_modules|server|scripts|casino\.db|\.sql|\.bak|\.log|config\.js|\.dockerignore|Dockerfile)/i;
    if (blocked.test(req.path)) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  });

  if (hasBundle) {
    logger.info('Serving production bundle from /dist');
    app.use('/dist', express.static(distPath, { maxAge: '365d', immutable: true, etag: true }));
    app.use(express.static(distPath, {
      dotfiles: 'deny',
      maxAge: '1h',
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (/bundle\.[a-f0-9]+\.(min\.)?js|styles\.[a-f0-9]+\.(min\.)?css/.test(filePath)) {
          // Content-hashed bundles never change for a given URL → cache forever.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (ext === '.html') {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (ext === '.js' || ext === '.css') {
          // UNHASHED client modules — casino-engine.js, api-client.js,
          // css/*.css, etc. The 100 game pages reference these by a plain
          // path with NO content hash, so a long max-age served stale
          // code for up to an hour after every fix shipped (this is why
          // a reel/UI fix appeared "not to work" until the cache expired).
          // Revalidate on every load via ETag: a 304 is a few hundred
          // bytes, and fixes reach players immediately.
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
      },
    }));
    app.use('/assets', express.static(path.join(FRONTEND_ROOT, 'assets'), { dotfiles: 'deny', maxAge: '7d', immutable: true }));
    app.use(express.static(FRONTEND_ROOT, { dotfiles: 'deny', maxAge: '1h' }));
  } else {
    app.use(express.static(FRONTEND_ROOT, {
      dotfiles: 'deny',
      maxAge: '7d',
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.html') {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (['.css', '.js'].includes(ext)) {
          // Was max-age=604800 (7 DAYS) — unhashed client JS/CSS would be
          // a week stale after a deploy. Revalidate via ETag so fixes
          // ship immediately. (Hashed bundles aren't served by this dev
          // branch; in production the bundle branch above handles them.)
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2', '.woff'].includes(ext)) {
          res.setHeader('Cache-Control', 'public, max-age=2592000');
        }
      },
    }));
  }

  // Admin dashboard
  app.use('/admin', express.static(path.join(FRONTEND_ROOT, 'admin')));

  // SPA fallback (path-traversal safe)
  const resolvedRoot = path.resolve(FRONTEND_ROOT);
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found', path: req.path });
    }
    const reqPath = decodeURIComponent(req.path);
    const resolved = path.resolve(FRONTEND_ROOT, '.' + reqPath);
    if (!resolved.startsWith(resolvedRoot)) {
      return res.status(404).send('Not found');
    }
    if (reqPath.match(/\.\w+$/) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return res.sendFile(resolved);
    }
    if (!reqPath.match(/\.\w+$/)) {
      const html = resolved + '.html';
      if (fs.existsSync(html) && fs.statSync(html).isFile()) return res.sendFile(html);
      const dirIdx = path.join(resolved, 'index.html');
      if (fs.existsSync(dirIdx) && fs.statSync(dirIdx).isFile()) return res.sendFile(dirIdx);
    }
    if (reqPath.match(/\.\w+$/)) {
      const fourOhFour = path.join(FRONTEND_ROOT, '404.html');
      if (fs.existsSync(fourOhFour)) return res.status(404).sendFile(fourOhFour);
      return res.status(404).send('Not found');
    }
    const indexPath = hasBundle ? path.join(distPath, 'index.html') : path.join(FRONTEND_ROOT, 'index.html');
    res.sendFile(indexPath);
  });

  // Global error handler (4-arg, must be last) — winston-backed, redacts in prod
  app.use(globalErrorHandler);
}

// ── Service schema init (called from ensureReady) ──────────
async function initSchemas() {
  try {
    const db = require('./database');
    const isPg = typeof db.isPg === 'function' && db.isPg();
    const idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";
    await db.run(
      `CREATE TABLE IF NOT EXISTS audit_log (
        id ${idDef},
        event_type TEXT NOT NULL,
        user_id INTEGER,
        amount REAL,
        reference TEXT,
        details TEXT,
        created_at ${tsDef}
      )`
    );
  } catch (e) {
    logger.warn('audit_log table init failed', { error: e.message });
  }

  const schemaInits = [
    './services/jackpot.service',
    './services/gems.service',
    './services/boost.service',
    './services/challenges.service',
    './services/cosmetics.service',
    './services/wagerace.service',
    './services/rental.service',
    './services/megawheel.service',
  ];
  for (const sp of schemaInits) {
    try {
      const svc = require(sp);
      if (typeof svc.initSchema === 'function') await svc.initSchema();
      else if (typeof svc.initJackpotPool === 'function') await svc.initJackpotPool();
    } catch (err) {
      logger.warn(`schema init failed`, { service: sp, error: err.message });
    }
  }

  try {
    const nftRoutes = require('./routes/nft-deposit.routes');
    if (typeof nftRoutes.ensureNFTTables === 'function') {
      await nftRoutes.ensureNFTTables();
    }
  } catch (err) {
    logger.warn('NFT tables init deferred', { error: err.message });
  }
}

// ── Async Setup (DB + routes + service schemas) ────────────
let setupPromise = null;
async function ensureReady() {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      await initDatabase();
    } catch (err) {
      logger.error('Database init failed (continuing in degraded mode)', { error: err.message, stack: err.stack });
    }
    // Mount routes AFTER DB is ready — fire-and-forget bootstraps now succeed
    mountAllRoutes();
    // Bind the catch-all/static (must come after routes)
    bindCatchAll();
    // Initialise service schemas + audit log
    await initSchemas();
  })();
  return setupPromise;
}

// ── Start Server ───────────────────────────────────────────
async function start() {
  await ensureReady();

  // Background scheduler (re-engagement emails, daily reports)
  try {
    const scheduler = require('./services/scheduler.service');
    if (typeof scheduler.start === 'function') scheduler.start();
  } catch (err) {
    logger.warn('scheduler failed', { error: err.message });
  }

  // Email queue worker (retries failed sends with exponential backoff)
  try {
    const emailService = require('./services/email.service');
    if (typeof emailService.startWorker === 'function') {
      emailService.startWorker(60_000); // process queue every 60s
    }
  } catch (err) {
    console.warn('[SERVER] email worker failed:', err.message);
  }

  const httpServer = http.createServer(app);

  // ── Realtime (Socket.IO) ────────────────────────────────
  let io = null;
  try {
    const realtime = require('./services/realtime.service');
    io = realtime.init(httpServer);
    if (io) {
      try {
        const notify = require('./services/notification.service');
        if (typeof notify.setIO === 'function') notify.setIO(io);
      } catch (_) { /* notification service optional */ }
    }
  } catch (err) {
    logger.warn('realtime init failed', { error: err.message });
  }

  // Periodic jackpot broadcast (every 4s) for animated counters across clients
  try {
    const realtime = require('./services/realtime.service');
    const jackpotService = require('./services/jackpot.service');
    setInterval(async () => {
      try {
        if (!realtime.isAttached()) return;
        const levels = await jackpotService.getJackpotLevels();
        realtime.broadcastJackpotPools(levels);
      } catch (e) { /* swallow — purely cosmetic */ }
    }, 4000).unref();
  } catch (_) { /* services unavailable */ }

  const server = httpServer.listen(PORT, () => {
    logger.info('Matrix Spins Casino — server listening', {
      url: `http://localhost:${PORT}`,
      mode: config.NODE_ENV,
      routesLoaded: loadedRoutes.length,
      routesFailed: failedRoutes.length,
      dbDegraded: isDegraded(),
      realtime: !!io,
      logDir: logger.logDir,
      fileLogs: !!logger.canWriteFiles,
    });
  });
  app.set('server', server);
  app.set('io', io);

  // Tournament service bootstrap
  try {
    const tournament = require('./services/tournament.service');
    if (typeof tournament.ensureActive === 'function') {
      tournament.ensureActive().catch(e => logger.warn('Tournament bootstrap', { error: e.message }));
      setInterval(() => tournament.tick && tournament.tick().catch(e => logger.warn('Tournament tick', { error: e.message })), 5 * 60 * 1000);
    }
  } catch (_) {}

  // Wager race service bootstrap
  try {
    const wager = require('./services/wagerace.service');
    if (typeof wager.ensureActiveRace === 'function') {
      wager.ensureActiveRace().catch(e => logger.warn('WagerRace bootstrap', { error: e.message }));
      setInterval(() => wager.tick && wager.tick().catch(e => logger.warn('WagerRace tick', { error: e.message })), 60 * 1000);
    }
  } catch (_) {}

  return server;
}

// ── Graceful Shutdown ─────────────────────────────────────
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Received signal, shutting down gracefully', { signal });

  const httpServer = app.get('server');
  if (httpServer) {
    httpServer.close(() => logger.info('HTTP server closed'));
  }

  // Hard-fail timer — never let shutdown hang past 15s
  const hardKill = setTimeout(() => {
    logger.error('Graceful shutdown timed out — force exit');
    process.exit(1);
  }, 15000);
  hardKill.unref();

  // Drain in-flight requests (3s)
  await new Promise(r => setTimeout(r, 3000));

  try {
    const { getBackend } = require('./database');
    const backend = getBackend();
    if (backend) {
      if (typeof backend._flushToDisk === 'function') backend._flushToDisk();
      if (typeof backend.close === 'function') await backend.close();
      logger.info('Database closed cleanly');
    }
  } catch (e) {
    logger.warn('DB close error during shutdown', { error: e.message });
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Unhandled rejection', { error: err.message, stack: err.stack });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err && err.message, stack: err && err.stack });
  // Render/Vercel will restart on exit; bail out so the process doesn't run in
  // an undefined state. Give logger a tick to flush.
  setTimeout(() => process.exit(1), 250).unref();
});

// Only start if invoked directly (not when imported by Vercel adapter)
if (require.main === module) {
  start().catch(err => {
    logger.error('FATAL start error', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { app, start, ensureReady };
