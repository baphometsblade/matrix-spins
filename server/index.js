'use strict';

/**
 * Matrix Spins — production server.
 *
 * Responsibilities (this file):
 *   - boot: config + DB + middleware
 *   - mount real routes that exist in ./routes/
 *   - serve static frontend (dist/)
 *
 * Route files live in ./routes/. If you add a new one, add one mount.
 * Legacy mounts that used to reference un-committed route files have
 * been removed — this server now actually boots.
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./database');
const { initDatabase } = db;
const sanitize = require('./middleware/sanitize');
const userRateLimit = require('./middleware/user-ratelimit');
const { csrfMiddleware, getCsrfTokenHandler } = require('./middleware/csrf');
const { authenticate, authenticateOptional } = require('./middleware/auth');
const { maintenanceMiddleware } = require('./middleware/maintenance');

/* ─── Startup safety ─── */
(function productionSafety() {
    if (config.NODE_ENV !== 'production') return;
    const errs = [];
    if (!process.env.JWT_SECRET) errs.push('JWT_SECRET is required in production.');
    if (!process.env.ADMIN_PASSWORD) errs.push('ADMIN_PASSWORD is required in production.');
    if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
        errs.push('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing; webhook signatures cannot be verified.');
    }
    if (errs.length) {
        console.error('[Security] Refusing to start in production with insecure config:');
        errs.forEach(e => console.error('  • ' + e));
        process.exit(1);
    }
})();

const app = express();
app.set('trust proxy', 1);

// Per-request correlation id + access log. Mounted first so every
// subsequent middleware has req.id available and every response body
// (including error bodies) already has X-Request-Id set.
app.use(require('./middleware/request-log'));

/* ─── Security headers ─── */
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://js.stripe.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://*.stripe.com'],
            connectSrc: ["'self'", 'https://api.stripe.com', 'https://api.coingecko.com'],
            fontSrc: ["'self'", 'data:', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
            frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
        },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
}));

app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
});

const corsOrigin = config.NODE_ENV === 'production'
    ? (config.ALLOWED_ORIGIN || false)
    : true;
app.use(cors({ origin: corsOrigin }));

/* ─── Body parsing ─── */
// Stripe webhook needs the raw body BEFORE express.json() runs.
app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

/* ─── Cross-cutting middleware ─── */
app.use(sanitize);
app.use(maintenanceMiddleware);

/* ─── Rate limiting ─── */
app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
}));
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts. Try again later.' },
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/', userRateLimit({ maxRequests: 60, windowMs: 60000 }));

const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many payment requests. Please wait.' },
});
app.use('/api/deposit', paymentLimiter);
app.use('/api/deposit', userRateLimit({ maxRequests: 20, windowMs: 60000 }));

/* ─── Stripe webhook — MUST be mounted BEFORE csrfMiddleware,
 *    because Stripe does not participate in our CSRF scheme and the
 *    body is the raw bytes we already parsed. ─── */
app.use('/api/payment/stripe/webhook', require('./routes/stripe-webhook.routes'));

/* ─── Auth-aware CSRF ───
 * Read auth BEFORE csrf so CSRF can bind tokens to the current user id.
 */
app.use('/api', authenticateOptional);
app.get('/api/csrf-token', getCsrfTokenHandler);
app.use('/api', csrfMiddleware);

/* ─── Routes ─── */
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/stripe/config', require('./routes/stripe-config.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/auth/2fa', require('./routes/twofa.routes').router);
app.use('/api/balance', require('./routes/balance.routes'));
app.use('/api/deposit', require('./routes/deposit.routes'));
app.use('/api/nfts', require('./routes/nft.routes'));
app.use('/api/user', require('./routes/user.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

/* ─── 404 for unknown API routes ─── */
app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
});

/* ─── Static frontend ─── */
const DIST_DIR = path.join(__dirname, '..', 'dist');
app.use(express.static(DIST_DIR, { maxAge: '1y', index: false }));
app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

/* ─── Error handler ─── */
app.use((err, _req, res, _next) => {
    console.error('[unhandled]', err);
    const payload = { error: 'Internal server error.' };
    if (config.NODE_ENV !== 'production') payload.detail = err.message;
    res.status(err.status || 500).json(payload);
});

/* ─── Start ─── */
async function start() {
    try {
        await initDatabase();
    } catch (err) {
        console.error('[boot] database init failed:', err);
        process.exit(1);
    }
    try {
        await require('./services/admin.service').bootstrap();
    } catch (err) {
        console.warn('[boot] admin bootstrap warning:', err.message);
    }
    const server = app.listen(config.PORT, () => {
        console.log(`[boot] Matrix Spins listening on :${config.PORT} (${config.NODE_ENV})`);
        console.log(`[boot] Stripe: ${config.hasStripe ? 'configured' : 'missing (deposits disabled)'}, webhook: ${config.hasWebhookSecret ? 'configured' : 'missing'}`);
    });
    ['SIGTERM', 'SIGINT'].forEach(sig => {
        process.on(sig, async () => {
            console.log(`[boot] ${sig} received, shutting down`);
            server.close(async () => {
                try { await db.close(); } catch (err) { console.warn('[boot] db close warning:', err.message); }
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10000).unref();
        });
    });
    process.on('unhandledRejection', err => {
        console.error('[boot] unhandled promise rejection:', err);
    });
}

if (require.main === module) {
    start();
}

module.exports = app;
