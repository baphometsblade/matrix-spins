/**
 * Royal Slots Casino — Server Entry Point
 *
 * Express server serving the casino frontend + API routes.
 * Blockchain operations are backend-only — never exposed to players.
 *
 * Usage:
 *   node Casino/server/index.js
 *   PORT=3001 node Casino/server/index.js
 */

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static Files (Casino frontend) ───────────────────────────
app.use(express.static(path.join(__dirname, '..')));

// ── API Routes ───────────────────────────────────────────────
try {
  const paymentRoutes = require('./routes/payment');
  app.use('/api', paymentRoutes);
  console.log('[SERVER] ✓ Payment routes loaded (deposit, withdraw, balance)');
} catch (err) {
  console.warn('[SERVER] ⚠ Payment routes not loaded (missing dependencies):', err.message);
  app.post('/api/deposit', (req, res) => {
    res.json({ success: true, balance: '$1000.00', referenceNumber: 'RSC-DEMO-' + Date.now() });
  });
  app.post('/api/withdraw', (req, res) => {
    res.json({ success: true, message: 'Withdrawal is being processed', referenceNumber: 'RSW-DEMO-' + Date.now() });
  });
  app.get('/api/balance/:userId', (req, res) => {
    res.json({ balance: '$1000.00' });
  });
}

try {
  const gameSessionRoutes = require('./routes/game-session');
  app.use('/api', gameSessionRoutes);
  console.log('[SERVER] ✓ Game session routes loaded (spin, session)');
} catch (err) {
  console.warn('[SERVER] ⚠ Game session routes not loaded:', err.message);
  app.post('/api/spin', (req, res) => {
    res.json({ success: true, grid: [], winAmount: 0, balance: '$1000.00' });
  });
}

// ── Health Check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    name: 'Royal Slots Casino'
  });
});

// ── Catch-all: serve index.html for SPA routes ──────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Error Handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SERVER] Error:', err.message);
  res.status(500).json({
    error: 'Something went wrong. Please try again.',
    referenceNumber: 'ERR-' + Date.now().toString(36).toUpperCase()
  });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ROYAL SLOTS CASINO — Server Running');
  console.log('══════════════════════════════════════════════════');
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Mode:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Time:    ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;
