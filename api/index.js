/**
 * Vercel Serverless Function — Real Production Casino API
 *
 * Mounts the actual Express app from server/index.js so Vercel deploys
 * have full revenue capability (auth, payment, spin, jackpot, etc.).
 */

let cachedApp = null;
let cachedReady = null;
let loadError = null;

function loadApp() {
  if (cachedApp || loadError) return;
  try {
    // Lazy require so we can capture errors instead of crashing the whole function
    const mod = require('../server/index.js');
    cachedApp = mod.app;
    cachedReady = mod.ensureReady;
    if (!cachedApp) loadError = new Error('server/index.js did not export `app`');
  } catch (err) {
    loadError = err;
    console.error('[Vercel] Failed to load server/index.js:', err && err.stack || err);
  }
}

module.exports = async (req, res) => {
  // ── Ultra-fast liveness probe — no Express, no DB, always 200 ──────────
  // Bypasses the full stack so load-balancers and uptime monitors get an
  // instant response even during cold starts or DB reconnection.
  const url = req.url || '';
  if (url === '/api/health/ping' || url.startsWith('/api/health/ping?')) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }));
  }

  loadApp();

  if (loadError) {
    console.error('[Vercel] Load error:', loadError.stack || loadError);
    const debug = process.env.ADMIN_PASSWORD && req.headers['x-admin-token'] === process.env.ADMIN_PASSWORD;
    return res.status(500).json({
      error: 'Server failed to initialize',
      detail: debug ? loadError.message : undefined,
      referenceNumber: 'VRC-LOAD-' + Date.now().toString(36).toUpperCase(),
    });
  }

  try {
    if (typeof cachedReady === 'function') {
      await cachedReady();
    }
    return cachedApp(req, res);
  } catch (err) {
    console.error('[Vercel] Handler error:', err && err.stack || err);
    const debug = process.env.ADMIN_PASSWORD && req.headers['x-admin-token'] === process.env.ADMIN_PASSWORD;
    return res.status(500).json({
      error: 'Internal server error',
      detail: debug ? err.message : undefined,
      referenceNumber: 'VRC-' + Date.now().toString(36).toUpperCase(),
    });
  }
};
