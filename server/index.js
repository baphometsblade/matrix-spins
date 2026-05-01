/**
 * Matrix Spins Casino — Server Entry Point
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
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Environment Validation ──────────────────────────────────
// Graceful degradation: server always starts, missing services use demo stubs
const OPTIONAL_ENV = ['DATABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'ADMIN_PASSWORD'];
const missing = OPTIONAL_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.warn('[SERVER] ⚠ Missing env vars (demo mode):', missing.join(', '));
  console.warn('[SERVER]   Payment & auth routes will use demo stubs.');
  console.warn('[SERVER]   Set these in Render dashboard for full functionality.');
}

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());

// ── Compression (gzip) ──────────────────────────────────────
// Use the 'compression' package if available, otherwise skip gracefully
try {
  const compression = require('compression');
  app.use(compression({ level: 6, threshold: 1024 }));
  console.log('[SERVER] ✓ Gzip compression enabled');
} catch (_) {
  console.warn('[SERVER] ⚠ compression package not installed — run: npm install compression');
  console.warn('[SERVER]   Responses will be uncompressed (larger, slower)');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Security Headers (production-grade) ────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // CSP: allow Stripe, Google Fonts, Google Analytics, self
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.stripe.com https://www.google-analytics.com https://fonts.googleapis.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '));
  next();
});

// ── API Rate Limiting (in-memory, no dependencies) ─────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 60;       // 60 requests per minute per IP

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }

  record.count++;
  if (record.count > RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', Math.ceil((record.windowStart + RATE_LIMIT_WINDOW - now) / 1000));
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
}

// Apply rate limiting to API routes only
app.use('/api', rateLimit);

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW * 2;
  for (const [ip, record] of rateLimitMap) {
    if (record.windowStart < cutoff) rateLimitMap.delete(ip);
  }
}, 300000);

// ── Request Logging ────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/') || duration > 1000) {
      console.log(`[${req.method}] ${req.path} → ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// ── Static Files (Casino frontend) ───────────────────────────
// Cache immutable assets (JS, CSS, images, fonts) for 7 days
// HTML files get short cache with must-revalidate
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    // HTML should revalidate on each request
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    // Immutable hashed bundles
    else if (filePath.includes('bundle.') && filePath.includes('.min.')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // CSS and JS — 7 day cache
    else if (['.css', '.js'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
    // Images and fonts — 30 day cache
    else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2', '.woff'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

// ── API Routes ───────────────────────────────────────────────
try {
  const paymentRoutes = require('./routes/payment');
  app.use('/api', paymentRoutes);
  console.log('[SERVER] ✓ Payment routes loaded (deposit, withdraw, balance)');
} catch (err) {
  console.warn('[SERVER] ⚠ Payment routes not loaded (missing dependencies):', err.message);
  // Stub routes so frontend doesn't break
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

// ── Demo Admin Dashboard API (for local dev without PostgreSQL) ──
// These return realistic sample data so the admin.html dashboard works locally
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (email && password) {
    res.json({
      accessToken: 'demo-admin-token-' + Date.now(),
      user: { id: 'demo-admin', email, role: 'admin', kyc: 'verified' },
    });
  } else {
    res.status(401).json({ error: 'Email and password required' });
  }
});

app.get('/api/admin/dashboard/overview', (req, res) => {
  res.json({
    revenue: {
      totalDepositsCents: 28473925, totalWithdrawalsCents: 12847300,
      netRevenueCents: 15626625, totalWageredCents: 184729400,
      totalPayoutsCents: 168294100, ggr: 16435300,
      deposits24hCents: 847200, deposits7dCents: 5284700,
    },
    players: {
      totalUsers: 2847, new24h: 23, new7d: 156,
      active24h: 342, active7d: 1247, verifiedUsers: 891,
    },
    games: { totalGames: 100, activeGames: 100 },
    activity: {
      totalSpins: 1847293, spins24h: 24832, wagered24hCents: 4729400,
    },
  });
});

app.get('/api/admin/dashboard/revenue-chart', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const result = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const base = 200000 + Math.random() * 300000;
    result.push({
      date: d.toISOString().split('T')[0],
      depositsCents: Math.round(base),
      withdrawalsCents: Math.round(base * (0.3 + Math.random() * 0.3)),
      wageredCents: Math.round(base * 4 + Math.random() * base * 2),
      payoutsCents: Math.round(base * 3.5 + Math.random() * base * 1.5),
      ggrCents: Math.round(base * 0.5 + Math.random() * base * 0.3),
    });
  }
  res.json({ days: result });
});

app.get('/api/admin/dashboard/player-chart', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const result = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    result.push({
      date: d.toISOString().split('T')[0],
      registrations: Math.round(10 + Math.random() * 30),
      activePlayers: Math.round(200 + Math.random() * 300),
    });
  }
  res.json({ days: result });
});

app.get('/api/admin/dashboard/top-games', (req, res) => {
  const demoGames = [
    'Pharaoh\'s Fortune', 'Dragon Pearl Deluxe', 'Neon Blitz', 'Cosmic Cash',
    'Wild West Gold', 'Mystic Forest', 'Lucky Sevens', 'Ocean King',
    'Thunder Strike', 'Crystal Caves', 'Shadow Reels', 'Fire Phoenix',
    'Ice Diamonds', 'Golden Temple', 'Star Burst', 'Moon Goddess',
    'Viking Raid', 'Fruit Frenzy', 'Pirate Plunder', 'Jungle Jackpot',
  ];
  const studios = ['golden_reels', 'nebula', 'mythic_forge', 'wild_frontier', 'shadow_works', 'dragon_pearl', 'ironclad', 'cascade_labs'];
  const limit = parseInt(req.query.limit) || 20;
  const games = demoGames.slice(0, limit).map((name, i) => {
    const wagered = Math.round(500000 + Math.random() * 2000000);
    const rtp = 94 + Math.random() * 4;
    const payouts = Math.round(wagered * (rtp / 100));
    return {
      gameId: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name, category: 'slot', studioId: studios[i % studios.length],
      configuredRtp: Math.round(rtp * 100) / 100,
      actualRtp: Math.round((rtp + (Math.random() - 0.5) * 4) * 100) / 100,
      spinCount: Math.round(5000 + Math.random() * 50000),
      uniquePlayers: Math.round(50 + Math.random() * 500),
      totalWageredCents: wagered, totalPayoutsCents: payouts,
      ggrCents: wagered - payouts,
    };
  });
  games.sort((a, b) => b.spinCount - a.spinCount);
  res.json({ games });
});

app.get('/api/admin/dashboard/top-players', (req, res) => {
  const names = ['James Wilson', 'Maria Garcia', 'Alex Chen', 'Sarah Johnson', 'David Kim',
    'Emma Brown', 'Michael Davis', 'Lisa Anderson', 'Robert Taylor', 'Jennifer Martinez',
    'Chris Lee', 'Amanda White', 'Daniel Harris', 'Nicole Clark', 'Kevin Wright'];
  const countries = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'MX'];
  const players = names.map((name, i) => {
    const deposits = Math.round(100000 + Math.random() * 500000);
    const wagered = Math.round(deposits * (2 + Math.random() * 5));
    const payouts = Math.round(wagered * (0.9 + Math.random() * 0.08));
    return {
      id: 'demo-' + i, displayName: name, email: name.toLowerCase().replace(' ', '.') + '@example.com',
      countryCode: countries[i % countries.length],
      kycStatus: ['verified', 'verified', 'pending', 'verified', 'unverified'][i % 5],
      createdAt: new Date(Date.now() - Math.random() * 90 * 86400000).toISOString(),
      lastLoginAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
      balanceCents: Math.round(5000 + Math.random() * 100000),
      totalDepositsCents: deposits, totalWithdrawalsCents: Math.round(deposits * 0.4),
      totalWageredCents: wagered, totalPayoutsCents: payouts,
      ggrCents: wagered - payouts, spinCount: Math.round(500 + Math.random() * 10000),
    };
  });
  players.sort((a, b) => b.totalWageredCents - a.totalWageredCents);
  res.json({ players });
});

app.get('/api/admin/dashboard/recent-activity', (req, res) => {
  const types = ['deposit', 'bet', 'win', 'bet', 'win', 'deposit', 'bet', 'win', 'withdrawal', 'bet', 'bonus'];
  const names = ['James W.', 'Maria G.', 'Alex C.', 'Sarah J.', 'David K.', 'Emma B.', 'Michael D.'];
  const entries = [];
  for (let i = 0; i < 30; i++) {
    const type = types[i % types.length];
    let amount;
    if (type === 'deposit') amount = Math.round(5000 + Math.random() * 50000);
    else if (type === 'withdrawal') amount = -Math.round(10000 + Math.random() * 30000);
    else if (type === 'bet') amount = -Math.round(100 + Math.random() * 5000);
    else if (type === 'win') amount = Math.round(200 + Math.random() * 10000);
    else amount = Math.round(1000 + Math.random() * 5000);
    entries.push({
      id: 1000 + i, type, amountCents: amount,
      balanceAfterCents: Math.round(50000 + Math.random() * 200000),
      referenceType: type === 'bet' || type === 'win' ? 'spin' : type,
      referenceId: 'demo-' + i,
      createdAt: new Date(Date.now() - i * 120000 - Math.random() * 60000).toISOString(),
      playerName: names[i % names.length],
      playerEmail: names[i % names.length].toLowerCase().replace(' ', '.') + '@example.com',
    });
  }
  res.json({ entries });
});

console.log('[SERVER] ✓ Admin dashboard demo routes loaded');

// ── Progressive Jackpot API ─────────────────────────────────
// Four-tier progressive jackpot with simulated growth.
// In production, these values come from the database and grow
// with each bet placed (1.5% mega, 1.0% major, 0.8% minor, 0.5% mini).
const jackpotState = {
  mega:  { cents: 5000000 + Math.round(Math.random() * 12000000), growthPerSec: 127 },
  major: { cents:  500000 + Math.round(Math.random() * 1200000),  growthPerSec: 43  },
  minor: { cents:   50000 + Math.round(Math.random() * 120000),   growthPerSec: 11  },
  mini:  { cents:    5000 + Math.round(Math.random() * 12000),    growthPerSec: 3   },
};

// Tick jackpots every second
setInterval(() => {
  Object.values(jackpotState).forEach(pool => {
    pool.cents += pool.growthPerSec + Math.round((Math.random() - 0.3) * pool.growthPerSec * 0.6);
  });
}, 1000);

// Simulate occasional mini/minor wins
const recentWinners = [];
const winnerNames = ['Alex T.', 'Maria G.', 'James W.', 'Sarah K.', 'David C.', 'Emma L.', 'Chris M.'];
function simulateJackpotWin() {
  const isMini = Math.random() < 0.75;
  const tier = isMini ? 'mini' : 'minor';
  const amount = jackpotState[tier].cents;
  const winner = {
    id: 'win-' + Date.now(),
    playerName: winnerNames[Math.floor(Math.random() * winnerNames.length)],
    tier,
    amountCents: amount,
    wonAt: new Date().toISOString(),
  };
  recentWinners.unshift(winner);
  if (recentWinners.length > 10) recentWinners.pop();
  // Reset pool to seed
  jackpotState[tier].cents = tier === 'mini' ? 5000 : 50000;
  setTimeout(simulateJackpotWin, (45 + Math.random() * 75) * 1000);
}
setTimeout(simulateJackpotWin, (30 + Math.random() * 60) * 1000);

app.get('/api/jackpots', (req, res) => {
  res.json({
    pools: {
      mega:  jackpotState.mega.cents,
      major: jackpotState.major.cents,
      minor: jackpotState.minor.cents,
      mini:  jackpotState.mini.cents,
    },
    recentWinners: recentWinners.slice(0, 5),
  });
});

console.log('[SERVER] ✓ Progressive jackpot API loaded');

// ── VIP / Loyalty API ────────────────────────────────────────
const VIP_TIERS = [
  { id: 'bronze',   name: 'Bronze',   xpRequired: 0,      cashback: 0.5 },
  { id: 'silver',   name: 'Silver',   xpRequired: 5000,   cashback: 1.0 },
  { id: 'gold',     name: 'Gold',     xpRequired: 25000,  cashback: 2.0 },
  { id: 'platinum', name: 'Platinum', xpRequired: 100000, cashback: 3.5 },
  { id: 'diamond',  name: 'Diamond',  xpRequired: 500000, cashback: 5.0 },
];

app.get('/api/vip/status', (req, res) => {
  // Demo: random XP based on session
  const xp = Math.floor(Math.random() * 30000) + 500;
  let tierIdx = 0;
  for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
    if (xp >= VIP_TIERS[i].xpRequired) { tierIdx = i; break; }
  }
  res.json({
    xp,
    tier: VIP_TIERS[tierIdx],
    tierIndex: tierIdx,
    nextTier: VIP_TIERS[Math.min(tierIdx + 1, VIP_TIERS.length - 1)],
    allTiers: VIP_TIERS,
  });
});

// ── Promotions API ────────────────────────────────────────────
app.get('/api/promotions', (req, res) => {
  res.json({
    promotions: [
      { id: 'welcome', title: 'Welcome Bonus', value: '$1,000 + 50 Spins', category: 'welcome', active: true },
      { id: 'daily-spin', title: 'Daily Free Spin Wheel', value: 'Up to $100', category: 'daily', active: true },
      { id: 'weekly-cashback', title: 'Weekly Cashback', value: 'Up to 5%', category: 'cashback', active: true },
      { id: 'refer-friend', title: 'Refer a Friend', value: '$50 Each', category: 'referral', active: true },
      { id: 'mega-tournament', title: 'Weekend Mega Tournament', value: '$25,000 Pool', category: 'tournament', active: true },
      { id: 'reload-bonus', title: '50% Reload Bonus', value: 'Up to $250', category: 'cashback', active: true },
    ],
  });
});

app.post('/api/promotions/:id/claim', (req, res) => {
  res.json({ success: true, promoId: req.params.id, message: 'Promotion claimed successfully.' });
});

console.log('[SERVER] ✓ VIP & Promotions API loaded');

// ── Tournament Leaderboard API ──────────────────────────────
const TOURNAMENT_PLAYERS = [
  'CryptoKing99', 'LuckyAce77', 'SpinMaster_X', 'GoldenReels', 'NeonBlitz',
  'JackpotJane', 'DiamondDave', 'SlotSurfer22', 'MegaWins_Pro', 'PurpleHaze',
  'CasinoQueen', 'MatrixPlayer', 'TurboSpin88', 'VelvetRoller', 'ChipStacker',
  'BonusHunter', 'ReelChaser', 'WildCard_7', 'FortuneFox', 'StarSpinner'
];

app.get('/api/leaderboard', (req, res) => {
  const players = TOURNAMENT_PLAYERS.map((name, i) => {
    const base = Math.max(50000 - i * 2800 + Math.round(Math.random() * 1500), 500);
    return {
      rank: i + 1,
      name,
      avatar: name.slice(0, 2).toUpperCase(),
      spins: Math.round(base * 0.8 + Math.random() * 200),
      points: base,
      isYou: i === 11,
    };
  });

  // Assign prizes
  const prizes = [1000000, 500000, 250000];
  players.forEach((p, i) => {
    if (i < 3) p.prizeCents = prizes[i];
    else if (i < 10) p.prizeCents = 50000;
    else if (i < 25) p.prizeCents = 10000;
    else if (i < 50) p.prizeCents = 2500;
    else p.prizeCents = 0;
  });

  // Tournament end: next Sunday at midnight UTC
  const now = new Date();
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday));

  res.json({
    tournament: {
      id: 'mega-weekend-' + now.toISOString().slice(0, 10),
      name: 'Weekend Mega Tournament',
      prizePoolCents: 2500000,
      status: 'live',
      endsAt: endDate.toISOString(),
      totalPlayers: 847,
    },
    leaderboard: players,
    pastTournaments: [
      { id: 'pt1', name: 'Spring Showdown', date: '2026-04-18', participants: 1203, winner: 'CryptoKing99', prizeCents: 1500000 },
      { id: 'pt2', name: 'Lucky Streak', date: '2026-04-11', participants: 956, winner: 'SpinMaster_X', prizeCents: 1000000 },
      { id: 'pt3', name: 'Neon Nights', date: '2026-04-04', participants: 1087, winner: 'JackpotJane', prizeCents: 2000000 },
      { id: 'pt4', name: 'Diamond Rush', date: '2026-03-28', participants: 892, winner: 'GoldenReels', prizeCents: 1200000 },
    ],
  });
});

console.log('[SERVER] ✓ Tournament leaderboard API loaded');

// ── Referral API ────────────────────────────────────────────
app.get('/api/referral/stats', (req, res) => {
  res.json({
    referralCode: 'MATRIX_USER123',
    referralLink: 'https://msaart.online/?ref=MATRIX_USER123',
    stats: {
      totalReferred: 7,
      successful: 4,
      pending: 3,
      totalEarnedCents: 20000,
    },
    history: [
      { id: 'r1', friendName: 'J***n W.', joinedAt: '2026-04-20', status: 'completed', earnedCents: 5000 },
      { id: 'r2', friendName: 'S***a M.', joinedAt: '2026-04-18', status: 'completed', earnedCents: 5000 },
      { id: 'r3', friendName: 'A***x K.', joinedAt: '2026-04-15', status: 'pending', earnedCents: 0 },
      { id: 'r4', friendName: 'M***a R.', joinedAt: '2026-04-12', status: 'completed', earnedCents: 5000 },
      { id: 'r5', friendName: 'D***d L.', joinedAt: '2026-04-10', status: 'expired', earnedCents: 0 },
      { id: 'r6', friendName: 'E***a B.', joinedAt: '2026-04-08', status: 'completed', earnedCents: 5000 },
      { id: 'r7', friendName: 'R***t P.', joinedAt: '2026-04-05', status: 'pending', earnedCents: 0 },
      { id: 'r8', friendName: 'L***a C.', joinedAt: '2026-04-01', status: 'pending', earnedCents: 0 },
    ],
  });
});

console.log('[SERVER] ✓ Referral API loaded');

// ── Daily Spin Wheel API ────────────────────────────────────
const SPIN_PRIZES = [
  { id: 'p1', label: '$5 Bonus', valueCents: 500, weight: 30 },
  { id: 'p2', label: '$5 Bonus', valueCents: 500, weight: 30 },
  { id: 'p3', label: '$10 Bonus', valueCents: 1000, weight: 20 },
  { id: 'p4', label: '$10 Bonus', valueCents: 1000, weight: 20 },
  { id: 'p5', label: '$25 Bonus', valueCents: 2500, weight: 8 },
  { id: 'p6', label: '10 Free Spins', valueCents: 0, freeSpins: 10, weight: 6 },
  { id: 'p7', label: '$50 Bonus', valueCents: 5000, weight: 4 },
  { id: 'p8', label: '$100 Jackpot', valueCents: 10000, weight: 1 },
];

app.post('/api/spin-wheel', (req, res) => {
  // Weighted random selection
  const totalWeight = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * totalWeight;
  let prize = SPIN_PRIZES[0];
  for (const p of SPIN_PRIZES) {
    rand -= p.weight;
    if (rand <= 0) { prize = p; break; }
  }
  res.json({
    success: true,
    prize: { id: prize.id, label: prize.label, valueCents: prize.valueCents, freeSpins: prize.freeSpins || 0 },
    nextSpinAt: new Date(Date.now() + 86400000).toISOString(),
  });
});

console.log('[SERVER] ✓ Spin wheel API loaded');

// ── Achievements API ────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: 'first-spin', name: 'First Spin', category: 'gameplay', rarity: 'common', points: 10 },
  { id: 'century-club', name: 'Century Club', category: 'gameplay', rarity: 'uncommon', points: 25, target: 100 },
  { id: 'high-roller', name: 'High Roller', category: 'gameplay', rarity: 'rare', points: 50, target: 100000 },
  { id: 'lucky-streak', name: 'Lucky Streak', category: 'gameplay', rarity: 'epic', points: 100 },
  { id: 'jackpot-hunter', name: 'Jackpot Hunter', category: 'gameplay', rarity: 'legendary', points: 250 },
  { id: 'friendly', name: 'Friendly', category: 'social', rarity: 'common', points: 10 },
  { id: 'influencer', name: 'Influencer', category: 'social', rarity: 'uncommon', points: 25, target: 5 },
  { id: 'bronze-member', name: 'Bronze Member', category: 'vip', rarity: 'common', points: 10 },
  { id: 'welcome-aboard', name: 'Welcome Aboard', category: 'milestones', rarity: 'common', points: 10 },
  { id: 'depositor', name: 'Depositor', category: 'milestones', rarity: 'common', points: 10 },
];

app.get('/api/achievements', (req, res) => {
  // Demo: return definitions with random unlock state
  const achievements = ACHIEVEMENT_DEFS.map(a => ({
    ...a,
    unlocked: Math.random() > 0.5,
    progress: a.target ? Math.floor(Math.random() * a.target) : undefined,
    unlockedAt: Math.random() > 0.5 ? new Date(Date.now() - Math.random() * 30 * 86400000).toISOString() : null,
  }));
  const totalPoints = achievements.filter(a => a.unlocked).reduce((s, a) => s + a.points, 0);
  res.json({ achievements, totalPoints, totalAvailable: ACHIEVEMENT_DEFS.length });
});

console.log('[SERVER] ✓ Achievements API loaded');

// ── Newsletter API ──────────────────────────────────────────
const newsletterEmails = [];

app.post('/api/newsletter/subscribe', (req, res) => {
  const { email, source } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }
  if (!newsletterEmails.find(e => e.email === email)) {
    newsletterEmails.push({ email, source: source || 'unknown', subscribedAt: new Date().toISOString() });
    console.log('[SERVER] New newsletter subscriber:', email);
  }
  res.json({ success: true, message: 'Subscribed successfully' });
});

app.get('/api/admin/newsletter/subscribers', (req, res) => {
  res.json({ count: newsletterEmails.length, subscribers: newsletterEmails });
});

console.log('[SERVER] ✓ Newsletter API loaded');

// ── Health Check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    uptimeHuman: formatUptime(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    name: 'Matrix Spins Casino',
    mode: missing.length > 0 ? 'demo' : 'live',
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      rssMB: Math.round(mem.rss / 1048576),
    },
    env: {
      database: !!process.env.DATABASE_URL,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      auth: !!process.env.JWT_SECRET,
      analytics: !!process.env.GA_MEASUREMENT_ID,
    },
    newsletterSubscribers: newsletterEmails.length,
    jackpotMegaCents: jackpotState.mega.cents,
  });
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// ── Catch-all: smart static file resolution + SPA fallback ──
// 1. If the requested path maps to a real file on disk → serve it
// 2. If no extension, try appending .html for clean URLs (e.g. /faq → faq.html)
// 3. If path has /categories/ or /blog/, look in those subdirectories
// 4. Otherwise → serve index.html for SPA client-side routing
const FRONTEND_ROOT = path.join(__dirname, '..');

app.get('/{*splat}', (req, res) => {
  const reqPath = decodeURIComponent(req.path);

  // Never serve admin via catch-all
  if (reqPath === '/admin.html') {
    return res.status(404).sendFile(path.join(FRONTEND_ROOT, '404.html'));
  }

  // Strategy 1: Direct file match (handles /faq.html, /categories/egyptian-mythology.html, etc.)
  const directFile = path.join(FRONTEND_ROOT, reqPath);
  if (reqPath.match(/\.\w+$/) && fs.existsSync(directFile) && fs.statSync(directFile).isFile()) {
    return res.sendFile(directFile);
  }

  // Strategy 2: Clean URL → try appending .html (e.g. /faq → /faq.html)
  if (!reqPath.match(/\.\w+$/)) {
    const htmlFile = path.join(FRONTEND_ROOT, reqPath + '.html');
    if (fs.existsSync(htmlFile) && fs.statSync(htmlFile).isFile()) {
      return res.sendFile(htmlFile);
    }
    // Try index.html inside directory (e.g. /blog → /blog/index.html)
    const dirIndex = path.join(FRONTEND_ROOT, reqPath, 'index.html');
    if (fs.existsSync(dirIndex) && fs.statSync(dirIndex).isFile()) {
      return res.sendFile(dirIndex);
    }
  }

  // Strategy 3: File has extension but doesn't exist → 404
  if (reqPath.match(/\.\w+$/)) {
    return res.status(404).sendFile(path.join(FRONTEND_ROOT, '404.html'));
  }

  // Strategy 4: No file found, no extension → SPA fallback (lobby)
  res.sendFile(path.join(FRONTEND_ROOT, 'index.html'));
});

// ── Error Handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SERVER] Error:', err.message);
  // NEVER expose internal details (blockchain, tokens, etc.) in error responses
  res.status(500).json({
    error: 'Something went wrong. Please try again.',
    referenceNumber: 'ERR-' + Date.now().toString(36).toUpperCase()
  });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  MATRIX SPINS CASINO — Server Running');
  console.log('══════════════════════════════════════════════════');
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Mode:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Time:    ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;
