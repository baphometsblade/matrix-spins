'use strict';

/**
 * Helmet-based security headers, configured to match the casino's CSP needs.
 *
 * We use helmet for the standard hardening (HSTS, X-Content-Type-Options,
 * Referrer-Policy, X-Frame-Options, X-Permitted-Cross-Domain-Policies, etc.)
 * but keep our hand-tuned CSP since it lists every allowlisted CDN.
 */

const helmet = require('helmet');

const CSP_DIRECTIVES = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://js.stripe.com', 'https://www.googletagmanager.com', 'https://www.google-analytics.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
    connectSrc: ["'self'", 'https://api.stripe.com', 'https://www.google-analytics.com', 'https://api.coingecko.com', 'https://cloudflare-eth.com', 'https://ipapi.co', 'wss:', 'https:'],
    frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: [],
};

function buildHelmet() {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: CSP_DIRECTIVES,
        },
        crossOriginEmbedderPolicy: false, // Stripe + 3rd-party embeds break under COEP
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        frameguard: { action: 'deny' },
        permittedCrossDomainPolicies: { permittedPolicies: 'none' },
        dnsPrefetchControl: { allow: false },
        xssFilter: true,
        noSniff: true,
        ieNoOpen: true,
        hidePoweredBy: true,
        originAgentCluster: true,
    });
}

// Permissions-Policy header (helmet doesn't ship this by default in v6)
function permissionsPolicy(req, res, next) {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
}

module.exports = { buildHelmet, permissionsPolicy, CSP_DIRECTIVES };
