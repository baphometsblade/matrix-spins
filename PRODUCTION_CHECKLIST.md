# Matrix Spins Casino — Production Deployment Checklist

## BEFORE GOING LIVE: Required Environment Variables

Set these in the **Render Dashboard** (not in render.yaml or .env):

### CRITICAL (won't take money without these)

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/dbname`) | **SQLite data is lost on every Render deploy.** You MUST use PostgreSQL for production. Get a free PG from [Neon](https://neon.tech) or Render's managed PG. |
| `JWT_SECRET` | A random 64+ char string (generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) | If not set, a random secret is generated on every deploy — **all user sessions are invalidated on each deploy**. |
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_live_...`) | Required for deposits. Without it, deposit endpoints return 503. |
| `STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key (`pk_live_...`) | Required for frontend payment forms. |
| `STRIPE_WEBHOOK_SECRET` | Your Stripe webhook signing secret (`whsec_...`) | Required to verify deposit confirmations. Without it, deposits stay "pending" forever. |
| `ADMIN_PASSWORD` | A strong password for the admin account | Default is randomly generated — set a known value to access `/admin`. |
| `NODE_ENV` | `production` | Already set in render.yaml. |

### IMPORTANT (recommended for full functionality)

| Variable | Value | Why |
|---|---|---|
| `SMTP_HOST` | Email server hostname | For password reset emails |
| `SMTP_PORT` | `587` | TLS port |
| `SMTP_USER` | Email username | Auth for SMTP |
| `SMTP_PASS` | Email password | Auth for SMTP |
| `SMTP_FROM` | `"Matrix Spins" <noreply@msaart.online>` | From address |
| `ADMIN_EMAIL` | Your email | For admin notifications |
| `SENTRY_DSN` | Sentry project DSN | Error monitoring |

### OPTIONAL (blockchain audit trail — can skip)

| Variable | Value | Why |
|---|---|---|
| `CONTRACT_ADDRESS` | Polygon ERC-1155 contract | Blockchain audit trail (simulated if not set) |
| `WALLET_PRIVATE_KEY` | Deployer wallet key | For minting/burning tokens |
| `THIRDWEB_SECRET_KEY` | Thirdweb API key | SDK authentication |

## Stripe Webhook Setup

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://msaart.online/api/payment/stripe/webhook`
3. Select events: `checkout.session.completed`, `payment_intent.succeeded`
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET`

## PostgreSQL Setup

1. Create a PostgreSQL database (Render managed PG, Neon, or Supabase)
2. Set `DATABASE_URL` in Render environment
3. On next deploy, the server auto-creates all tables via schema-pg.js
4. Verify with: `curl https://msaart.online/api/health` → `{"db":"ok"}`

## Pre-Launch Verification

After setting all env vars and deploying:

- [ ] `curl https://msaart.online/api/health` returns `{"status":"ok","db":"ok"}`
- [ ] Register a new account at msaart.online
- [ ] Make a test deposit ($2 minimum) via Stripe
- [ ] Verify deposit shows as "pending" until webhook fires
- [ ] Verify balance is credited after Stripe confirms
- [ ] Spin a game — verify server-side RNG (check /api/debug/dist for bundle)
- [ ] Attempt a withdrawal — verify email verification + wagering checks work
- [ ] Check admin panel at `/admin` with your ADMIN_PASSWORD
- [ ] Verify leaderboard, jackpot pools, and daily login work

## What's Already Production-Ready

- ✅ Server-side RNG (crypto.randomBytes, not Math.random)
- ✅ Atomic SQL balance operations (no read-then-set)
- ✅ JWT authentication with 4h expiry
- ✅ Rate limiting on all sensitive endpoints
- ✅ CORS, CSP, Helmet security headers
- ✅ Stripe Checkout + webhook verification
- ✅ Wagering requirements on all bonuses
- ✅ Self-exclusion + responsible gambling tools
- ✅ bonusGuard middleware on all bonus claim routes
- ✅ No mock payments (503 if Stripe not configured)
- ✅ No demo mode (disabled)
- ✅ No simulated player counts (real DB only)
- ✅ 88% RTP with house edge protection

## Legal Requirements (Your Responsibility)

- [ ] Obtain a gambling license for your jurisdiction
- [ ] Verify terms.html and responsible-gambling.html are compliant
- [ ] Set up age verification (KYC) for your market
- [ ] Configure self-exclusion integration with your regulator
- [ ] Set up AML (Anti-Money Laundering) monitoring for large transactions
