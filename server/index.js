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
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { initDatabase, isDegraded, lastPgError } = require('./database');

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
  console.warn('[SERVER] Missing env vars (degraded mode):', missing.join(', '));
  console.warn('[SERVER]   Money operations may be unavailable until set.');
  console.warn('[SERVER]   See render.yaml + .env.example for required values.');
}

if (config.NODE_ENV === 'production') {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('[SERVER] FATAL: JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
  const KNOWN_DEFAULTS = ['dev-secret-do-not-use-in-production', 'admin-change-me-now'];
  if (KNOWN_DEFAULTS.includes(config.JWT_SECRET)) {
    console.error('[SERVER] FATAL: JWT_SECRET is a known default — set a real secret.');
    process.exit(1);
  }
  if (KNOWN_DEFAULTS.includes(config.ADMIN_PASSWORD)) {
    console.error('[SERVER] FATAL: ADMIN_PASSWORD is a known default — set a real password.');
    process.exit(1);
  }
}

// ── Request ID + Slow Request Logging ──────────────────────
app.use((req, res, next) => {
  req.id = crypto.randomBytes(4).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (req.path.startsWith('/api/') || ms > 1000) {
      console.log(`[${req.method}] ${req.path} ${res.statusCode} ${Math.round(ms)}ms id=${req.id}`);
    }
  });
  next();
});

// ── Compression (gzip) ──────────────────────────────────────
try {
  const compression = require('compression');
  app.use(compression({ level: 6, threshold: 512 }));
} catch (_) {
  console.warn('[SERVER] compression not installed — responses will be uncompressed');
}

// ── Security Headers ────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Vary', 'Accept-Encoding, Origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.stripe.com https://www.google-analytics.com https://api.coingecko.com https://cloudflare-eth.com https://ipapi.co",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
});

// ── CORS ────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (() => {
  if (process.env.ALLOWED_ORIGIN) {
    return process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (config.NODE_ENV === 'production') {
    return [
      'https://royal-slots-casino.vercel.app',
      'https://royal-slots-casino.vercel.app',
      'https://royal-slots-casino.vercel.app',
    ];
  }
  return ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'];
})();
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (origin.endsWith('.vercel.app')) return cb(null, true);
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
  console.warn('[SERVER] cookie-parser not installed — cookie middleware disabled');
}

// ── Sanitize, CSRF, Maintenance ────────────────────────────
function safeMiddleware(modulePath, name) {
  try {
    return require(modulePath);
  } catch (err) {
    console.warn(`[SERVER] Middleware ${name} failed to load: ${err.message}`);
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
  console.warn('[SERVER] auth middleware failed:', err.message);
}
app.use('/api', optionalAuth);

try {
  const { csrfMiddleware, getCsrfTokenHandler } = require('./middleware/csrf');
  app.get('/api/csrf-token', verifyToken, getCsrfTokenHandler);
  app.use(csrfMiddleware);
} catch (err) {
  console.warn('[SERVER] csrf middleware failed:', err.message);
}

try {
  const { maintenanceMiddleware } = require('./middleware/maintenance');
  app.use(maintenanceMiddleware);
} catch (err) {
  console.warn('[SERVER] maintenance middleware failed:', err.message);
}

const { degradedModeGuard } = require('./middleware/degraded-mode');
const { geoBlock } = require('./middleware/geo-block');

// ── Rate Limiters ──────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3000,
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

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login',    authLimiter);

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

const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/admin', adminLimiter);

const spinLimiter = rateLimit({ windowMs: 60 * 1000, max: 180, standardHeaders: true, legacyHeaders: false });
app.use('/api/spin', spinLimiter);

// ── Geo-Block (only active if ALLOWED_COUNTRIES is set) ────
app.use('/api/auth/register', geoBlock);
app.use('/api/payment',       geoBlock);

// ── Degraded-Mode Guard on money endpoints ─────────────────
// Stripe webhook is INTENTIONALLY excluded — we still need to receive
// confirmations for in-flight payments when PG reconnects.
app.use('/api/payment/deposit',  degradedModeGuard);
app.use('/api/payment/withdraw', degradedModeGuard);
app.use('/api/payment/create-checkout', degradedModeGuard);
app.use('/api/balance',          degradedModeGuard);
app.use('/api/crypto',           degradedModeGuard);
app.use('/api/withdrawal-enhance', degradedModeGuard);

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
    console.warn(`[SERVER] Route mount failed: ${prefix} (${modulePath}) — ${err.message}`);
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
mount('/api/player-stats', './routes/playerstats.routes', 'player-stats');
mount('/api/fair',        './routes/fair.routes',        'fair (provably-fair)');
mount('/api/buy-feature', './routes/buyfeature.routes',  'buy-feature');
mount('/api/dynamic-rtp', './routes/dynamic-rtp.routes', 'dynamic-rtp');
mount('/api/recommend',   './routes/recommend.routes',   'recommend');

// Bonuses & promotions
mount('/api/promocode',     './routes/promocode.routes',     'promocode');
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

// Engagement systems
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
mount('/api/affiliate',     './routes/affiliate.routes',     'affiliate');
mount('/api/xpshop',        './routes/xpshop.routes',        'xpshop');
mount('/api/abtesting',     './routes/abtesting.routes',     'abtesting');
mount('/api/ab',            './routes/abtesting.routes',     'ab-alias');
mount('/api/chat',          './routes/chat.routes',          'chat');
mount('/api/feedback',      './routes/feedback.routes',      'feedback');
mount('/api/favorites',     './routes/favorites.routes',     'favorites');

// Compliance / responsible-gambling
mount('/api/self-exclusion', './routes/selfexclusion.routes', 'self-exclusion');
mount('/api/deposit-limits', './routes/depositlimits.routes', 'deposit-limits');
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

// Health + newsletter
mount('/api/health',     './routes/health.routes',     'health');
mount('/api/newsletter', './routes/newsletter.routes', 'newsletter');

  // close mountAllRoutes()
}

// ── Health Check (always available) ────────────────────────
app.get('/api/health-summary', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: isDegraded() ? 'degraded' : 'ok',
    degraded: isDegraded(),
    pgError: lastPgError() || null,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    name: 'Matrix Spins Casino',
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      rssMB: Math.round(mem.rss / 1048576),
    },
    env: {
      database: !!process.env.DATABASE_URL,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      auth: !!process.env.JWT_SECRET,
    },
    routesLoaded: loadedRoutes.length,
    routesFailed: failedRoutes.length,
  });
});

// ── Diagnostic: list routes (admin only) ───────────────────
app.get('/api/debug/routes', (req, res) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ loaded: loadedRoutes, failed: failedRoutes });
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
    console.log('[SERVER] Serving production bundle from /dist');
    app.use('/dist', express.static(distPath, { maxAge: '365d', immutable: true, etag: true }));
    app.use(express.static(distPath, {
      dotfiles: 'deny',
      maxAge: '1h',
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (/bundle\.[a-f0-9]+\.(min\.)?js|styles\.[a-f0-9]+\.(min\.)?css/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (ext === '.html') {
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
          res.setHeader('Cache-Control', 'public, max-age=604800');
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
  app.get('/{*splat}', (req, res) => {
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

  // Global error handler (4-arg, must be last)
  app.use((err, req, res, _next) => {
    try {
      const db = require('./database');
      if (typeof db.rollback === 'function') {
        db.rollback().catch(e => console.warn('[err-handler] rollback:', e && e.message));
      }
    } catch (_) {}
    console.error('[SERVER]', req.method, req.path, '→', err.message, 'id=', req.id);
    console.error('[SERVER] stack:', err.stack);
    const status = err.status || err.statusCode || 500;
    const debug = process.env.ADMIN_PASSWORD && req.headers['x-debug-token'] === process.env.ADMIN_PASSWORD;
    const message = (config.NODE_ENV === 'production' && !debug) ? 'Internal server error' : (err.message || 'Internal server error');
    if (!res.headersSent) {
      res.status(status).json({
        error: message,
        stack: debug && err.stack ? err.stack.split('\n').slice(0, 10) : undefined,
        requestId: req.id,
        referenceNumber: 'ERR-' + Date.now().toString(36).toUpperCase(),
      });
    }
  });
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
    console.warn('[SERVER] audit_log table init failed:', e.message);
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
      console.warn(`[SERVER] schema init ${sp} failed: ${err.message}`);
    }
  }

  try {
    const nftRoutes = require('./routes/nft-deposit.routes');
    if (typeof nftRoutes.ensureNFTTables === 'function') {
      await nftRoutes.ensureNFTTables();
    }
  } catch (err) {
    console.warn('[SERVER] NFT tables init deferred:', err.message);
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
      console.error('[SERVER] Database init failed (continuing in degraded mode):', err.message);
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
    console.warn('[SERVER] scheduler failed:', err.message);
  }

  const server = app.listen(PORT, () => {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  MATRIX SPINS CASINO — Server Running');
    console.log('══════════════════════════════════════════════════');
    console.log(`  URL:           http://localhost:${PORT}`);
    console.log(`  Mode:          ${config.NODE_ENV}`);
    console.log(`  Routes loaded: ${loadedRoutes.length}`);
    console.log(`  Routes failed: ${failedRoutes.length}`);
    console.log(`  DB degraded:   ${isDegraded()}`);
    console.log(`  Time:          ${new Date().toISOString()}`);
    console.log('══════════════════════════════════════════════════');
    console.log('');
  });
  app.set('server', server);

  // Tournament service bootstrap
  try {
    const tournament = require('./services/tournament.service');
    if (typeof tournament.ensureActive === 'function') {
      tournament.ensureActive().catch(e => console.warn('[Tournament] bootstrap:', e.message));
      setInterval(() => tournament.tick && tournament.tick().catch(e => console.warn('[Tournament] tick:', e.message)), 5 * 60 * 1000);
    }
  } catch (_) {}

  // Wager race service bootstrap
  try {
    const wager = require('./services/wagerace.service');
    if (typeof wager.ensureActiveRace === 'function') {
      wager.ensureActiveRace().catch(e => console.warn('[WagerRace] bootstrap:', e.message));
      setInterval(() => wager.tick && wager.tick().catch(e => console.warn('[WagerRace] tick:', e.message)), 60 * 1000);
    }
  } catch (_) {}

  return server;
}

// ── Graceful Shutdown ─────────────────────────────────────
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] Received ${signal}, shutting down gracefully...`);

  const httpServer = app.get('server');
  if (httpServer) {
    httpServer.close(() => console.log('[SERVER] HTTP closed'));
  }

  setTimeout(() => process.exit(1), 15000).unref();

  await new Promise(r => setTimeout(r, 3000));

  try {
    const { getBackend } = require('./database');
    const backend = getBackend();
    if (backend) {
      if (typeof backend._flushToDisk === 'function') backend._flushToDisk();
      if (typeof backend.close === 'function') await backend.close();
    }
  } catch (e) {
    console.warn('[SERVER] DB close error:', e.message);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[SERVER] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err && err.stack || err);
  // Render restarts on exit; let it
  setTimeout(() => process.exit(1), 100).unref();
});

// Only start if invoked directly (not when imported by Vercel adapter)
if (require.main === module) {
  start().catch(err => {
    console.error('[SERVER] FATAL start error:', err);
    process.exit(1);
  });
}

module.exports = { app, start, ensureReady };
