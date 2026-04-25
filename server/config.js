require('dotenv').config();

// ─── Fail-closed in production ───
// These checks run at module load — any consumer that requires('./config')
// will fail before it can use a default secret.
const NODE_ENV = process.env.NODE_ENV || 'development';
if (NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-in-production') {
        throw new Error(
            '[config] JWT_SECRET must be set to a strong random value in production. ' +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }
    if (process.env.JWT_SECRET.length < 32) {
        throw new Error('[config] JWT_SECRET must be at least 32 characters in production');
    }
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123changeme') {
        throw new Error('[config] ADMIN_PASSWORD must be set to a non-default value in production');
    }
    if (!process.env.ALLOWED_ORIGIN) {
        throw new Error('[config] ALLOWED_ORIGIN must be set in production (e.g. https://msaart.online)');
    }
    if (!process.env.WEBHOOK_SECRET) {
        // Not a hard fail — webhook is optional — but log a clear warning
        console.warn('[config] WARNING: WEBHOOK_SECRET unset in production — generic /webhook/confirm will refuse all requests');
    }
}

module.exports = {
    PORT: parseInt(process.env.PORT, 10) || 3000,
    JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    JWT_EXPIRES_IN: '7d',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123changeme',
    NODE_ENV: NODE_ENV,
    DB_PATH: process.env.DB_PATH || './casino.db',
    DATABASE_URL: process.env.DATABASE_URL || null,

    // Game limits
    MAX_SPINS_PER_SECOND: 2,
    MIN_BET: 0.20,
    MAX_BET: 50000,
    DEFAULT_BALANCE: 1000,
    DEMO_BALANCE: 5000,

    // House edge — guaranteed profit
    TARGET_RTP: 0.86,              // 86% payout = 14% house edge
    RTP_ADJUSTMENT_THRESHOLD: 0.02,
    MAX_WIN_MULTIPLIER: 200,       // No single spin can win more than 200x bet
    PROFIT_FLOOR: -500,            // Emergency mode if house is down $500+
    SESSION_WIN_CAP: 10000,        // Player can't win more than $10k per session
    MAX_PAYOUT_PROFIT_PCT: 0.20,   // Single payout never exceeds 20% of total site profit
    MIN_WIN_MULTIPLIER_FLOOR: 2,   // Minimum win floor (2x bet) to keep game playable at low profit

    // Stripe integration (optional — falls back to mock payments if unset)
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || null,

    // Payment configuration
    CURRENCY: 'AUD',
    MIN_DEPOSIT: 5,
    MAX_DEPOSIT: 100000,
    MIN_WITHDRAWAL: 20,
    MAX_WITHDRAWAL: 50000,
    WITHDRAWAL_PROCESSING_DAYS: 3,
    PAYMENT_METHODS: ['visa', 'mastercard', 'payid', 'bank_transfer', 'crypto_btc', 'crypto_eth', 'crypto_usdt'],

    // First-deposit bonus
    FIRST_DEPOSIT_BONUS_PCT: 50,     // 50% match
    FIRST_DEPOSIT_BONUS_MAX: 200,    // cap at $200
    FIRST_DEPOSIT_WAGERING_MULT: 40,  // 40x playthrough on first deposit bonus
    RELOAD_BONUS_PCT: 25,             // 25% match on reload deposits
    RELOAD_BONUS_MAX: 100,            // cap reload bonus at $100
    RELOAD_WAGERING_MULT: 35,         // 35x playthrough on reload bonus

    // Password reset
    PASSWORD_RESET_EXPIRY_HOURS: 1,
    PASSWORD_RESET_MAX_ACTIVE: 3,

    // Email / SMTP (optional — password reset emails require these to be set)
    SMTP_HOST:   process.env.SMTP_HOST   || null,
    SMTP_PORT:   parseInt(process.env.SMTP_PORT, 10) || 587,
    SMTP_SECURE: process.env.SMTP_SECURE === 'true',   // true = SSL/465, false = STARTTLS/587
    SMTP_USER:   process.env.SMTP_USER   || null,
    SMTP_PASS:   process.env.SMTP_PASS   || null,
    SMTP_FROM:   process.env.SMTP_FROM   || '"Matrix Spins" <noreply@msaart.online>',

    // Jackpot pooling
    JACKPOT_CONTRIBUTION_RATE: 0.005,   // 0.5% of every bet feeds jackpot pool
    JACKPOT_TIERS: {
        mini:  { seed: 100,   mustHitAt: 500 },
        minor: { seed: 500,   mustHitAt: 2500 },
        major: { seed: 2500,  mustHitAt: 15000 },
        grand: { seed: 25000, mustHitAt: 100000 }
    },
    JACKPOT_MINI_WIN_CHANCE: 0.001,     // 0.1% per spin
    JACKPOT_MINOR_WIN_CHANCE: 0.0002,   // 0.02% per spin
    JACKPOT_MAJOR_WIN_CHANCE: 0.00004,  // 0.004% per spin
    JACKPOT_GRAND_WIN_CHANCE: 0.000005, // 0.0005% per spin

    // Loss-limit cashback
    DAILY_LOSS_LIMIT_DEFAULT: 500,          // default daily loss limit ($)
    LOSS_CASHBACK_RATE: 0.05,               // 5% cashback on losses when limit hit
    LOSS_CASHBACK_MAX: 50,                  // max $50 cashback per day
    LOSS_CASHBACK_VIP_RATES: {              // higher cashback for VIP tiers
        0: 0.05, 1: 0.06, 2: 0.08,
        3: 0.10, 4: 0.12, 5: 0.15
    },

    // Spin-pack bundles
    SPIN_BUNDLES: [
        { id: 'starter', name: 'Starter Pack', price: 9.99, credits: 15, bonusPct: 50, bonusWheelSpins: 0, badge: '' },
        { id: 'silver', name: 'Silver Bundle', price: 24.99, credits: 40, bonusPct: 60, bonusWheelSpins: 1, badge: '🥈' },
        { id: 'gold', name: 'Gold Bundle', price: 49.99, credits: 85, bonusPct: 70, bonusWheelSpins: 2, badge: '🥇' },
        { id: 'diamond', name: 'Diamond Bundle', price: 99.99, credits: 180, bonusPct: 80, bonusWheelSpins: 3, badge: '💎' },
        { id: 'whale', name: 'Whale Package', price: 249.99, credits: 500, bonusPct: 100, bonusWheelSpins: 5, badge: '🐋' },
    ],

    // Responsible gambling defaults
    DEFAULT_DAILY_DEPOSIT_LIMIT: null,   // No limit by default
    DEFAULT_SESSION_TIME_LIMIT: null,    // No limit by default
    COOLING_OFF_PERIODS: [24, 48, 72, 168, 720], // Hours: 1d, 2d, 3d, 1w, 30d

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
