require('dotenv').config();

// In production, these MUST be set as real environment variables.
// The server refuses to start with insecure defaults in production.
const isProd = (process.env.NODE_ENV === 'production');

function requireEnv(key, fallback) {
    const val = process.env[key];
    if (!val) {
        if (isProd) {
            // Warn instead of exit — serverless platforms (Vercel, Render) need
            // the process to start so health checks can return diagnostic info.
            // Routes that depend on this env var will fail at request time
            // (degraded mode, missing-env error responses), not at boot.
            console.error(`[Config] WARNING: ${key} not set in production — using insecure fallback. Set this env var in your platform dashboard.`);
        }
        return fallback;
    }
    return val;
}

module.exports = {
    PORT: parseInt(process.env.PORT, 10) || 3000,
    JWT_SECRET: requireEnv('JWT_SECRET', 'dev-secret-do-not-use-in-production'),
    JWT_EXPIRES_IN: '7d',
    ADMIN_PASSWORD: requireEnv('ADMIN_PASSWORD', 'admin-change-me-now'),
    NODE_ENV: process.env.NODE_ENV || 'development',
    DB_PATH: process.env.DB_PATH || './casino.db',
    DATABASE_URL: process.env.DATABASE_URL || null,

    // Game limits
    MAX_SPINS_PER_SECOND: 2,
    MIN_BET: 0.20,
    MAX_BET: 50000,
    DEFAULT_BALANCE: 0,          // New accounts start at $0 — must deposit to play
    DEMO_BALANCE: 1000,          // Demo/guest mode balance

    // House edge — guaranteed profit
    TARGET_RTP: 0.86,              // 86% payout = 14% house edge
    RTP_ADJUSTMENT_THRESHOLD: 0.02,
    MAX_WIN_MULTIPLIER: 200,       // No single spin can win more than 200x bet
    PROFIT_FLOOR: -500,            // Emergency mode if house is down $500+
    SESSION_WIN_CAP: 10000,        // Player can't win more than $10k per session
    MAX_PAYOUT_PROFIT_PCT: 0.20,   // Single payout never exceeds 20% of total site profit
    MIN_WIN_MULTIPLIER_FLOOR: 2,   // Minimum win floor (2x bet) to keep game playable at low profit

    // Stripe integration
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || null,

    // Crypto / MetaMask integration
    CRYPTO_WALLET_ADDRESS: process.env.CRYPTO_WALLET_ADDRESS || null,
    BTC_WALLET_ADDRESS: process.env.BTC_WALLET_ADDRESS || null,
    ETH_RPC_URL: process.env.ETH_RPC_URL || 'https://cloudflare-eth.com',
    ETH_CHAIN_ID: parseInt(process.env.ETH_CHAIN_ID, 10) || 1,
    CRYPTO_MIN_CONFIRMATIONS: parseInt(process.env.CRYPTO_MIN_CONFIRMATIONS, 10) || 2,
    ETH_AUD_FALLBACK_RATE: parseFloat(process.env.ETH_AUD_FALLBACK_RATE) || 5000,

    // Payment configuration
    CURRENCY: 'AUD',
    MIN_DEPOSIT: 5,
    MAX_DEPOSIT: 100000,
    MIN_WITHDRAWAL: 20,
    MAX_WITHDRAWAL: 50000,
    WITHDRAWAL_PROCESSING_DAYS: 3,
    PAYMENT_METHODS: ['visa', 'mastercard', 'payid', 'bank_transfer', 'crypto_btc', 'crypto_eth', 'crypto_usdt'],

    // Withdrawal OTP: withdrawals at or above this threshold require email
    // OTP verification before admin can approve them. Protects against
    // account-takeover theft of accumulated balance.
    WITHDRAWAL_OTP_THRESHOLD: parseFloat(process.env.WITHDRAWAL_OTP_THRESHOLD) || 500,
    WITHDRAWAL_OTP_EXPIRY_MINUTES: 15,

    // First-deposit bonus (wagering mults per CLAUDE.md revenue-protection rules)
    FIRST_DEPOSIT_BONUS_PCT: 100,     // 100% match
    FIRST_DEPOSIT_BONUS_MAX: 500,     // cap at $500
    FIRST_DEPOSIT_WAGERING_MULT: 45,  // 45x playthrough on first deposit bonus (CLAUDE.md)
    RELOAD_BONUS_PCT: 25,             // 25% match on reload deposits
    RELOAD_BONUS_MAX: 100,            // cap reload bonus at $100
    RELOAD_WAGERING_MULT: 30,         // 30x playthrough on reload — deposit match/retention (CLAUDE.md)

    // Password reset
    PASSWORD_RESET_EXPIRY_HOURS: 1,
    PASSWORD_RESET_MAX_ACTIVE: 3,

    // Terms of Service — bump this whenever legal copy changes materially.
    // Users whose users.terms_version < CURRENT_TERMS_VERSION will be
    // forced to re-accept via GET /api/user/terms-status before they can
    // perform money operations.
    CURRENT_TERMS_VERSION: parseInt(process.env.TERMS_VERSION, 10) || 1,

    // Email / SMTP
    SMTP_HOST:   process.env.SMTP_HOST   || null,
    SMTP_PORT:   parseInt(process.env.SMTP_PORT, 10) || 587,
    SMTP_SECURE: process.env.SMTP_SECURE === 'true',
    SMTP_USER:   process.env.SMTP_USER   || null,
    SMTP_PASS:   process.env.SMTP_PASS   || null,
    SMTP_FROM:   process.env.SMTP_FROM   || '"Matrix Spins" <noreply@msaart.online>',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || null,

    // Jackpot pooling
    JACKPOT_CONTRIBUTION_RATE: 0.005,
    JACKPOT_TIERS: {
        mini:  { seed: 100,   mustHitAt: 500 },
        minor: { seed: 500,   mustHitAt: 2500 },
        major: { seed: 2500,  mustHitAt: 15000 },
        grand: { seed: 25000, mustHitAt: 100000 }
    },
    JACKPOT_MINI_WIN_CHANCE: 0.001,
    JACKPOT_MINOR_WIN_CHANCE: 0.0002,
    JACKPOT_MAJOR_WIN_CHANCE: 0.00004,
    JACKPOT_GRAND_WIN_CHANCE: 0.000005,

    // Loss-limit cashback
    DAILY_LOSS_LIMIT_DEFAULT: 500,
    LOSS_CASHBACK_RATE: 0.05,
    LOSS_CASHBACK_MAX: 50,
    LOSS_CASHBACK_VIP_RATES: {
        0: 0.05, 1: 0.06, 2: 0.08,
        3: 0.10, 4: 0.12, 5: 0.15
    },

    // Spin-pack bundles
    SPIN_BUNDLES: [
        { id: 'starter', name: 'Starter Pack',    price: 9.99,   credits: 15,  bonusPct: 50,  bonusWheelSpins: 0, badge: '' },
        { id: 'silver',  name: 'Silver Bundle',   price: 24.99,  credits: 40,  bonusPct: 60,  bonusWheelSpins: 1, badge: '' },
        { id: 'gold',    name: 'Gold Bundle',     price: 49.99,  credits: 85,  bonusPct: 70,  bonusWheelSpins: 2, badge: '' },
        { id: 'diamond', name: 'Diamond Bundle',  price: 99.99,  credits: 180, bonusPct: 80,  bonusWheelSpins: 3, badge: '' },
        { id: 'whale',   name: 'Whale Package',   price: 249.99, credits: 500, bonusPct: 100, bonusWheelSpins: 5, badge: '' },
    ],

    // Responsible gambling defaults
    DEFAULT_DAILY_DEPOSIT_LIMIT: null,
    DEFAULT_SESSION_TIME_LIMIT: null,
    COOLING_OFF_PERIODS: [24, 48, 72, 168, 720],

    // Social gifting
    GIFTING: {
        MIN_AMOUNT: 10,
        MAX_AMOUNT: 200,
        DAILY_LIMIT: 3,
        DAILY_MAX_TOTAL: 500,
    },

    // Weekly auto-contests
    CONTESTS: {
        PRIZES: {
            1: 200,
            2: 75, 3: 75,
            4: 40, 5: 40, 6: 40, 7: 40, 8: 40, 9: 40, 10: 40,
            11: 20, 12: 20, 13: 20, 14: 20, 15: 20, 16: 20, 17: 20, 18: 20, 19: 20, 20: 20,
            21: 20, 22: 20, 23: 20, 24: 20, 25: 20
        },
        PRIZE_WAGERING: 15,
        DEFAULT_METRIC: 'total_wagered'
    },
};
