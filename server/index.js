/**
 * Royal Slots Casino Server Entry Point
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const distDir = path.join(__dirname, '..', 'dist');
const hasBundle = fs.existsSync(path.join(distDir, 'index.html'));
console.log('[SERVER] Bundle mode: ' + (hasBundle ? 'ON' : 'OFF'));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (hasBundle) {
  app.use(express.static(distDir, { maxAge: '1y', immutable: true, index: false }));
  app.use(express.static(path.join(__dirname, '..'), { maxAge: '1h', index: false }));
} else {
  app.use(express.static(path.join(__dirname, '..')));
}

try {
  var paymentRoutes = require('./routes/payment');
  app.use('/api', paymentRoutes);
  console.log('[SERVER] Payment routes loaded');
} catch (err) {
  console.warn('[SERVER] Payment routes not loaded:', err.message);
  app.post('/api/deposit', function(req, res) { res.json({ success: true, balance: '$1000.00' }); });
  app.post('/api/withdraw', function(req, res) { res.json({ success: true, message: 'Processing' }); });
  app.get('/api/balance/:userId', function(req, res) { res.json({ balance: '$1000.00' }); });
}

try {
  var gameSessionRoutes = require('./routes/game-session');
  app.use('/api', gameSessionRoutes);
  console.log('[SERVER] Game session routes loaded');
} catch (err) {
  console.warn('[SERVER] Game session routes not loaded:', err.message);
  app.post('/api/spin', function(req, res) { res.json({ success: true, grid: [], winAmount: 0 }); });
}

// Stripe checkout routes use /payment/* paths so mount at /api/
try {
  var stripeRoutes = require('./routes/stripe-checkout.routes');
  app.use('/api', stripeRoutes);
  console.log('[SERVER] Stripe checkout routes loaded');
} catch (err) {
  console.warn('[SERVER] Stripe checkout routes not loaded:', err.message);
}

var routesDir = path.join(__dirname, 'routes');
var autoLoaded = 0;
var autoFailed = 0;
try {
  var routeFiles = fs.readdirSync(routesDir).filter(function(f) { return f.endsWith('.routes.js'); });
  var skip = { 'payment.routes.js': true, 'game-session.routes.js': true, 'stripe-checkout.routes.js': true };
  routeFiles.forEach(function(file) {
    if (skip[file]) return;
    var routeName = file.replace('.routes.js', '');
    try {
      var router = require(path.join(routesDir, file));
      app.use('/api/' + routeName, router);
      autoLoaded++;
    } catch (e) {
      autoFailed++;
      console.warn('[SERVER] Failed to load ' + file + ': ' + e.message);
    }
  });
  console.log('[SERVER] Auto-loaded ' + autoLoaded + ' route modules (' + autoFailed + ' failed)');
} catch (dirErr) {
  console.warn('[SERVER] Could not read routes dir:', dirErr.message);
}

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(), version: '1.0.0', name: 'Matrix Spins Casino', bundleMode: hasBundle, routesLoaded: autoLoaded, routesFailed: autoFailed });
});

app.get('*', function(req, res) {
  if (hasBundle) { res.sendFile(path.join(distDir, 'index.html')); }
  else { res.sendFile(path.join(__dirname, '..', 'index.html')); }
});

app.use(function(err, req, res, next) {
  console.error('[SERVER] Error:', err.message);
  res.status(500).json({ error: 'Something went wrong.', referenceNumber: 'ERR-' + Date.now().toString(36).toUpperCase() });
});

async function startServer() {
  try {
    await db.initDatabase();
    console.log('[SERVER] Database initialized');
  } catch (err) {
    console.error('[SERVER] Database init failed:', err.message);
  }
  app.listen(PORT, function() {
    console.log('ROYAL SLOTS CASINO Server Running on port ' + PORT);
  });
}

startServer();
module.exports = app;