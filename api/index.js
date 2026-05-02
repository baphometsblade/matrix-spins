/**
 * Vercel Serverless Function — Real Production Casino API
 *
 * Mounts the actual Express app from server/index.js so Vercel deploys
 * have full revenue capability (auth, payment, spin, jackpot, etc.).
 *
 * Replaces the previous demo stub that returned hardcoded $1000 deposits.
 *
 * Environment requirements (set in Vercel dashboard):
 *   DATABASE_URL              — PostgreSQL connection string (Neon, Supabase, etc.)
 *   JWT_SECRET                — 32+ character random string
 *   STRIPE_SECRET_KEY         — sk_live_... for production
 *   STRIPE_PUBLISHABLE_KEY    — pk_live_... for production
 *   STRIPE_WEBHOOK_SECRET     — whsec_... from Stripe dashboard
 *   ADMIN_PASSWORD            — admin login password
 *   ALLOWED_ORIGIN            — https://msaart.online
 *   ALLOWED_COUNTRIES         — comma-separated ISO codes (e.g. "AU,NZ,CA,GB")
 */

const { app, ensureReady } = (() => {
  // Defer require until handler invocation so cold-start logging is captured
  return require('../server/index.js');
})();

// Vercel serverless handler — awaits DB init + route mount on cold start,
// then reuses the cached Express app for warm invocations.
module.exports = async (req, res) => {
  try {
    if (typeof ensureReady === 'function') {
      await ensureReady();
    }
    return app(req, res);
  } catch (err) {
    console.error('[Vercel] Handler error:', err && err.stack || err);
    res.status(500).json({
      error: 'Internal server error',
      referenceNumber: 'VRC-' + Date.now().toString(36).toUpperCase(),
    });
  }
};
