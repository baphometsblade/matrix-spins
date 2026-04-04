require('dotenv').config();

module.exports = {
    PORT: parseInt(process.env.PORT, 10) || 3000,
    JWT_SECRET: process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex'),
    // ROUND 36: Reduced from 7d to 4h — industry standard for financial apps.
    // 7 days was too long; a stolen token could drain an account for a week.
    JWT_EXPIRES_IN: '4h',
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'matrix',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || require('crypto').randomBytes(16).toString('hex'),
    NODE_ENV: process.env.NODE_ENV || 'development',
    DB_PATH: process.env.DB_PATH || './casino.db',
    DATABASE_URL: process.env.DATABASE_URL || null,

    // Game limits
    MAX_SPINS_PER_SECOND: 2,
    MIN_BET: 0.20,
    MAX_BET: 1000,
    DEFAULT_BALANCE: 5,                // Lower start encourages first deposit
    DEMO_BALANCE: 5000,

    // House edge â€” guaranteed profit
    TARGET_RTP: 0.88,              // 88% payout = 12% house edge (better retention, more volume)
    RTP_ADJUSTMENT_THRESHOLD: 0.02,
    MAX_WIN_MULTIPLIER: 250,       // Higher potential wins = more excitement & play       // No single spin can win more than 150x bet
    // ROUND 32: PROFIT_FLOOR raised from -100 to 0 — house should NEVER go negative.
    // Previous value let the house lose $100 before emergency mode kicked in.
    PROFIT_FLOOR: 0,
    // ROUND 60: Reduced from $5K to $3K — $5K session cap was overly generous
    SESSION_WIN_CAP: 3000,         // Max win per 24h session ($3k) — server authoritative
    // ROUND 60: Tightened from 12% to 8% — protects house from large single-spin payouts
    MAX_PAYOUT_PROFIT_PCT: 0.08,   // Single payout never exceeds 8% of total site profit
    MIN_WIN_MULTIPLIER_FLOOR: 1.5, // Minimum win floor (1.5x bet) to keep game playable at low profit

    // Stripe integration (optional â€” falls back to mock payments if unset)
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || null,

    // Crypto / MetaMask integration
    CRYPTO_WALLET_ADDRESS: process.env.CRYPTO_WALLET_ADDRESS || null,  // Owner's ETH receiving wallet
    BTC_WALLET_ADDRESS: process.env.BTC_WALLET_ADDRESS || null,        // Owner's BTC receiving wallet
    ETH_RPC_URL: process.env.ETH_RPC_URL || 'https://cloudflare-eth.com',
    ETH_CHAIN_ID: parseInt(process.env.ETH_CHAIN_ID, 10) || 1,         // 1 = Ethereum Mainnet
    CRYPTO_MIN_CONFIRMATIONS: parseInt(process.env.CRYPTO_MIN_CONFIRMATIONS, 10) || 2,
    ETH_AUD_FALLBACK_RATE: parseFloat(process.env.ETH_AUD_FALLBACK_RATE) || 5000,

    // Payment configuration
    CURRENCY: 'AUD',
    MIN_DEPOSIT: 2,                // Lower barrier to first deposit
    MAX_DEPOSIT: 10000,
    MIN_WITHDRAWAL: 20,
    MAX_WITHDRAWAL: 50000,
    WITHDRAWAL_PROCESSING_DAYS: 3,
    PAYMENT_METHODS: ['visa', 'mastercard', 'payid', 'bank_transfer', 'crypto_btc', 'crypto_eth', 'crypto_usdt'],

    // First-deposit bonus
    FIRST_DEPOSIT_BONUS_PCT: 100,    // 100% match - industry standard for acquisition     // 50% match
    FIRST_DEPOSIT_BONUS_MAX: 500,    // Higher cap attracts bigger first deposits    // cap at $200
    FIRST_DEPOSIT_WAGERING_MULT: 45,  // Higher wagering = more house edge revenue  // 40x playthrough on first deposit bonus
    RELOAD_BONUS_PCT: 25,             // 25% match on reload deposits
    RELOAD_BONUS_MAX: 100,            // cap reload bonus at $100
    RELOAD_WAGERING_MULT: 35,         // 35x playthrough on reload bonus

    // Password reset
    PASSWORD_RESET_EXPIRY_HOURS: 1,
    PASSWORD_RESET_MAX_ACTIVE: 3,

    // Email / SMTP (optional â€” password reset emails require these to be set)
    SMTP_HOST:   process.env.SMTP_HOST   || null,
    SMTP_PORT:   parseInt(process.env.SMTP_PORT, 10) || 587,
    SMTP_SECURE: process.env.SMTP_SECURE === 'true',   // true = SSL/465, false = STARTTLS/587
    SMTP_USER:   process.env.SMTP_USER   || null,
    SMTP_PASS:   process.env.SMTP_PASS   || null,
    SMTP_FROM:   process.env.SMTP_FROM   || '"Matrix Spins" <noreply@msaart.online>',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || null,

    // Jackpot pooling
    // ROUND 58: Raised contribution to 2% and halved win chances — old 0.8% rate
    // couldn't sustain seed amounts; jackpots were net negative for the house
    JACKPOT_CONTRIBUTION_RATE: 0.02,    // 2% of every bet feeds jackpot pool
    JACKPOT_TIERS: {
        mini:  { seed: 50,    mustHitAt: 500 },
        minor: { seed: 250,   mustHitAt: 2500 },
        major: { seed: 1000,  mustHitAt: 15000 },
        grand: { seed: 10000, mustHitAt: 100000 }
    },
    JACKPOT_MINI_WIN_CHANCE: 0.0005,    // 0.05% per spin (was 0.1%)
    JACKPOT_MINOR_WIN_CHANCE: 0.0001,   // 0.01% per spin (was 0.02%)
    JACKPOT_MAJOR_WIN_CHANCE: 0.00002,  // 0.002% per spin (was 0.004%)
    JACKPOT_GRAND_WIN_CHANCE: 0.0000025, // 0.00025% per spin (was 0.0005%)

    // Loss-limit cashback
    DAILY_LOSS_LIMIT_DEFAULT: 500,          // default daily loss limit ($)
    // ROUND 58: Reduced from 8% to 5%, cap from $100 to $50 — old values too generous
    LOSS_CASHBACK_RATE: 0.05,               // 5% cashback on losses when limit hit
    LOSS_CASHBACK_MAX: 50,                   // max $50 cashback per day
    LOSS_CASHBACK_VIP_RATES: {              // higher cashback for VIP tiers
        0: 0.05, 1: 0.06, 2: 0.08,
        3: 0.10, 4: 0.12, 5: 0.15
    },

    // Spin-pack bundles
    SPIN_BUNDLES: [
        { id: 'starter', name: 'Starter Pack', price: 4.99, credits: 8, bonusPct: 60, bonusWheelSpins: 0, badge: '' },
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

