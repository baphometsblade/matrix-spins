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

// config.js performs all required-env checks at require-time and
// process.exits with a clear error if anything critical is missing
// — in every environment, with no silent fallbacks.

const app = express();
app.set('trust proxy', 1);

// Per-request correlation id + access log. Mounted first so every
// subsequent middleware has req.id available and every response body
// (including error bodies) already has X-Request-Id set.
app.use(require('./middleware/request-log'));

// Response timeout — default 30s, longer budget for the Stripe webhook.
app.use(require('./middleware/request-timeout')({
    defaultMs: 30000,
    paths: { '/api/payment/stripe/webhook': 60000, '/api/admin/reconcile-now': 120000 },
}));

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
            // The legacy lobby + slot code relies on hundreds of inline
            // onclick="…" handlers. Blocking them via the modern
            // script-src-attr default kills every button. Until the UI
            // is rewritten to delegate via addEventListener, we allow
            // inline attribute handlers.
            scriptSrcAttr: ["'unsafe-inline'"],
            reportUri: ['/api/csp-report'],
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
// CSP reports arrive as application/csp-report or application/reports+json.
app.use('/api/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '32kb' }));
app.use(express.json({ limit: '1mb' }));

// CSP violation reporter — logs each violation line, rate-limited so
// an attacker can't use it as a log-flood vector.
const cspReportLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many CSP reports.' },
});
app.post('/api/csp-report', cspReportLimiter, (req, res) => {
    try {
        const body = req.body || {};
        // Normalize across the legacy "csp-report" and the newer Reporting-API array envelope.
        const reports = Array.isArray(body) ? body : (body['csp-report'] ? [body['csp-report']] : [body]);
        reports.slice(0, 5).forEach(r => {
            console.warn('[csp-violation]',
                'doc=' + (r['document-uri'] || r['documentURL'] || '?'),
                'violated=' + (r['violated-directive'] || r['effectiveDirective'] || '?'),
                'blocked=' + (r['blocked-uri'] || r['blockedURL'] || '?'),
                'source=' + (r['source-file'] || r['sourceFile'] || '?') + ':' + (r['line-number'] || r['lineNumber'] || '?'));
        });
    } catch (err) {
        console.warn('[csp-violation] could not parse report:', err.message);
    }
    res.status(204).end();
});

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

// Some browsers (and scrapers) auto-request /favicon.ico even when the
// page only declares an SVG icon. Redirect to the real asset instead
// of letting it 404 — keeps the access log and devtools clean.
app.get('/favicon.ico', (_req, res) => res.redirect(301, '/favicon.svg'));

app.use(express.static(DIST_DIR, { maxAge: '1y', index: false }));

// Anything that looks like a static asset (has a file extension) and
// wasn't served above must 404 — NOT fall through to index.html. Serving
// index.html's HTML with a .css/.js/.png URL masks real broken-reference
// bugs and can confuse browsers' MIME-sniffing.
const ASSET_EXT_RE = /\.(?:css|js|mjs|map|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|json|xml|pdf|html|htm|txt|csv)$/i;
app.get('*', (req, res) => {
    if (ASSET_EXT_RE.test(req.path)) {
        return res.status(404).send('Not found.');
    }
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
    try {
        require('./services/deposit-reconciler.service').scheduleReconciler();
    } catch (err) {
        console.warn('[boot] reconciler schedule warning:', err.message);
    }
    try {
        require('./services/maintenance.service').schedule();
    } catch (err) {
        console.warn('[boot] maintenance schedule warning:', err.message);
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
