/**
 * Vercel Serverless Function — API Routes for Matrix Spins Casino
 * Wraps the Express API endpoints for serverless deployment.
 */
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Environment (graceful degradation) ──
const missing = ['DATABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY'].filter(v => !process.env[v]);
if (missing.length > 0) {
  console.warn('[API] Demo mode — missing:', missing.join(', '));
}

// ── Health Check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    name: 'Matrix Spins Casino',
    mode: missing.length > 0 ? 'demo' : 'live',
    platform: 'vercel',
  });
});

// ── Auth ─────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (email && password) {
    res.json({
      accessToken: 'demo-token-' + Date.now(),
      user: { id: 'demo-user', email, role: 'admin', kyc: 'verified' },
    });
  } else {
    res.status(401).json({ error: 'Email and password required' });
  }
});

// ── Payment Stubs ────────────────────────────────────────────
app.post('/api/deposit', (req, res) => {
  res.json({ success: true, balance: '$1000.00', referenceNumber: 'RSC-' + Date.now().toString(36).toUpperCase() });
});

app.post('/api/withdraw', (req, res) => {
  res.json({ success: true, message: 'Withdrawal is being processed', referenceNumber: 'RSW-' + Date.now().toString(36).toUpperCase() });
});

app.get('/api/balance/:userId', (req, res) => {
  res.json({ balance: '$1000.00' });
});

// ── Progressive Jackpot ──────────────────────────────────────
const BASE_TIME = Date.now();
app.get('/api/jackpots', (req, res) => {
  const elapsed = (Date.now() - BASE_TIME) / 1000;
  res.json({
    pools: {
      mega:  Math.round(5000000 + elapsed * 127 + Math.random() * 50000),
      major: Math.round(500000 + elapsed * 43 + Math.random() * 10000),
      minor: Math.round(50000 + elapsed * 11 + Math.random() * 3000),
      mini:  Math.round(5000 + elapsed * 3 + Math.random() * 500),
    },
    recentWinners: [
      { id: 'w1', playerName: 'Alex T.', tier: 'mini', amountCents: 8420, wonAt: new Date(Date.now() - 300000).toISOString() },
      { id: 'w2', playerName: 'Maria G.', tier: 'minor', amountCents: 67300, wonAt: new Date(Date.now() - 900000).toISOString() },
      { id: 'w3', playerName: 'James W.', tier: 'mini', amountCents: 4200, wonAt: new Date(Date.now() - 1800000).toISOString() },
    ],
  });
});

// ── VIP ──────────────────────────────────────────────────────
const VIP_TIERS = [
  { id: 'bronze', name: 'Bronze', xpRequired: 0, cashback: 0.5 },
  { id: 'silver', name: 'Silver', xpRequired: 5000, cashback: 1.0 },
  { id: 'gold', name: 'Gold', xpRequired: 25000, cashback: 2.0 },
  { id: 'platinum', name: 'Platinum', xpRequired: 100000, cashback: 3.5 },
  { id: 'diamond', name: 'Diamond', xpRequired: 500000, cashback: 5.0 },
];

app.get('/api/vip/status', (req, res) => {
  const xp = Math.floor(Math.random() * 30000) + 500;
  let tierIdx = 0;
  for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
    if (xp >= VIP_TIERS[i].xpRequired) { tierIdx = i; break; }
  }
  res.json({ xp, tier: VIP_TIERS[tierIdx], tierIndex: tierIdx, nextTier: VIP_TIERS[Math.min(tierIdx + 1, VIP_TIERS.length - 1)], allTiers: VIP_TIERS });
});

// ── Promotions ───────────────────────────────────────────────
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

// ── Leaderboard ──────────────────────────────────────────────
const TOURNAMENT_PLAYERS = ['CryptoKing99', 'LuckyAce77', 'SpinMaster_X', 'GoldenReels', 'NeonBlitz', 'JackpotJane', 'DiamondDave', 'SlotSurfer22', 'MegaWins_Pro', 'PurpleHaze', 'CasinoQueen', 'MatrixPlayer', 'TurboSpin88', 'VelvetRoller', 'ChipStacker', 'BonusHunter', 'ReelChaser', 'WildCard_7', 'FortuneFox', 'StarSpinner'];

app.get('/api/leaderboard', (req, res) => {
  const players = TOURNAMENT_PLAYERS.map((name, i) => {
    const base = Math.max(50000 - i * 2800 + Math.round(Math.random() * 1500), 500);
    return { rank: i + 1, name, avatar: name.slice(0, 2).toUpperCase(), spins: Math.round(base * 0.8 + Math.random() * 200), points: base, isYou: i === 11 };
  });
  const prizes = [1000000, 500000, 250000];
  players.forEach((p, i) => { p.prizeCents = i < 3 ? prizes[i] : i < 10 ? 50000 : i < 25 ? 10000 : 0; });
  const now = new Date();
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday));
  res.json({
    tournament: { id: 'mega-' + now.toISOString().slice(0, 10), name: 'Weekend Mega Tournament', prizePoolCents: 2500000, status: 'live', endsAt: endDate.toISOString(), totalPlayers: 847 },
    leaderboard: players,
  });
});

// ── Referral ─────────────────────────────────────────────────
app.get('/api/referral/stats', (req, res) => {
  res.json({
    referralCode: 'MATRIX_USER123',
    referralLink: 'https://msaart.online/?ref=MATRIX_USER123',
    stats: { totalReferred: 7, successful: 4, pending: 3, totalEarnedCents: 20000 },
    history: [
      { id: 'r1', friendName: 'J***n W.', joinedAt: '2026-04-20', status: 'completed', earnedCents: 5000 },
      { id: 'r2', friendName: 'S***a M.', joinedAt: '2026-04-18', status: 'completed', earnedCents: 5000 },
      { id: 'r3', friendName: 'A***x K.', joinedAt: '2026-04-15', status: 'pending', earnedCents: 0 },
    ],
  });
});

// ── Spin Wheel ───────────────────────────────────────────────
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
  const totalWeight = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * totalWeight;
  let prize = SPIN_PRIZES[0];
  for (const p of SPIN_PRIZES) { rand -= p.weight; if (rand <= 0) { prize = p; break; } }
  res.json({ success: true, prize: { id: prize.id, label: prize.label, valueCents: prize.valueCents, freeSpins: prize.freeSpins || 0 }, nextSpinAt: new Date(Date.now() + 86400000).toISOString() });
});

// ── Achievements ─────────────────────────────────────────────
app.get('/api/achievements', (req, res) => {
  const defs = [
    { id: 'first-spin', name: 'First Spin', category: 'gameplay', rarity: 'common', points: 10 },
    { id: 'century-club', name: 'Century Club', category: 'gameplay', rarity: 'uncommon', points: 25, target: 100 },
    { id: 'high-roller', name: 'High Roller', category: 'gameplay', rarity: 'rare', points: 50, target: 100000 },
    { id: 'lucky-streak', name: 'Lucky Streak', category: 'gameplay', rarity: 'epic', points: 100 },
    { id: 'jackpot-hunter', name: 'Jackpot Hunter', category: 'gameplay', rarity: 'legendary', points: 250 },
  ];
  const achievements = defs.map(a => ({ ...a, unlocked: Math.random() > 0.5, progress: a.target ? Math.floor(Math.random() * a.target) : undefined }));
  res.json({ achievements, totalPoints: achievements.filter(a => a.unlocked).reduce((s, a) => s + a.points, 0), totalAvailable: defs.length });
});

// ── Newsletter ───────────────────────────────────────────────
app.post('/api/newsletter/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }
  console.log('[API] Newsletter subscriber:', email);
  res.json({ success: true, message: 'Subscribed successfully' });
});

// ── Spin (game) ──────────────────────────────────────────────
app.post('/api/spin', (req, res) => {
  res.json({ success: true, grid: [], winAmount: 0, balance: '$1000.00' });
});

// ── Admin Dashboard ──────────────────────────────────────────
app.get('/api/admin/dashboard/overview', (req, res) => {
  res.json({
    revenue: { totalDepositsCents: 28473925, totalWithdrawalsCents: 12847300, netRevenueCents: 15626625, deposits24hCents: 847200 },
    players: { totalUsers: 2847, new24h: 23, active24h: 342 },
    games: { totalGames: 100, activeGames: 100 },
    activity: { totalSpins: 1847293, spins24h: 24832 },
  });
});

// Export for Vercel
module.exports = app;
