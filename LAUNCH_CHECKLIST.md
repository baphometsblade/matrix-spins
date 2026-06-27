# 🚀 Matrix Spins Casino — Go-Live Launch Checklist

**Domain:** https://msaart.online  **Host:** Render (auto-deploys on push to `master`)
**Last verified:** 2026-06-28

This is the step-by-step guide to take the casino from code → earning money. Items
marked **✅ LIVE** were verified working against the production site on the date above.

---

## 0. Current Production Status (verified 2026-06-28)

| Check | Result | How verified |
|---|---|---|
| API health | ✅ `status: ok` | `GET /api/health` |
| Database (PostgreSQL) | ✅ up, **not** degraded | `GET /api/health/ready` → `db.ok:true, degraded:false` |
| User registration | ✅ HTTP 201 + JWT | `POST /api/auth/register` |
| User login | ✅ HTTP 200 + JWT | `POST /api/auth/login` (field is `username`, accepts username **or** email) |
| Stripe secret key | ✅ configured (**live mode**) | `GET /api/config/public` → `stripeAvailable:true` |
| Stripe publishable key | ✅ `pk_live_…` returned to client | `GET /api/config/public` |
| Stripe webhook secret | ✅ configured | `POST /api/payment/webhook` → `400 Missing signature` (passed the `503 not configured` gate) |
| OG / social meta tags | ✅ present + image 200 OK | `index.html` head + `GET /img/og-banner.png` (105 KB PNG) |
| SMTP / email | ⚠️ **NOT configured** | `GET /api/health/ready` → `smtp:not_configured` |
| Google Analytics 4 | ⚠️ placeholder ID (`G-XXXXXXXXXX`) — replace before launch | `index.html` `window.MS_GA_ID` |

**Bottom line:** the money-IN flow (register → login → card deposit → play) is LIVE and
functional today. Remaining launch tasks are: (1) set a real GA4 ID, (2) configure SMTP
so transactional/verification/withdrawal-OTP emails send, and (3) the operational/legal
items below.

---

## 1. Stripe — Card Payments (REQUIRED for revenue)

### 1a. Environment variables (set in Render dashboard → service → Environment)
All three are **already set live**. Confirm they are the **live-mode** keys before public launch.

| Variable | Format | Purpose | Failure mode if missing |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` | Server-side API auth (create checkout sessions, verify charges) | `/api/payment/create-checkout` → `503 Stripe not configured` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | Sent to the browser to init Stripe.js | Checkout UI can't initialise |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Verifies webhook signatures (the ONLY way a deposit gets credited) | Webhook → `503 Webhooks not configured`; **deposits charge but never credit** |

**Optional** (preset price tiers — falls back to dynamic pricing if unset, so safe to skip):
`STRIPE_PRICE_5`, `STRIPE_PRICE_10`, `STRIPE_PRICE_25`, `STRIPE_PRICE_50`, `STRIPE_PRICE_100`, `STRIPE_PRICE_250`

### 1b. Webhook registration (Stripe Dashboard → Developers → Webhooks → Add endpoint)

- **Endpoint URL:** `https://msaart.online/api/payment/webhook`
  *(This is the canonical path. `/api/stripe/webhook` and `/api/payment/stripe/webhook` are NOT the live handler — do not use them.)*
- **Events to send** (the handler processes all of these):
  - `checkout.session.completed` — **credits the deposit + applies welcome/reload bonus** (critical)
  - `payment_intent.payment_failed` — marks deposit failed
  - `charge.dispute.created` — chargeback: bans account + claws back funds
  - `charge.dispute.funds_withdrawn` — chargeback follow-up
  - `charge.refunded` — reverses a refunded deposit
- After creating the endpoint, copy its **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
- **Test it:** Stripe Dashboard → the endpoint → "Send test webhook" → `checkout.session.completed`. A correctly-signed test returns `200 {received:true}`.

### 1c. Stripe account readiness
- [ ] Stripe account is **activated** (out of test mode, business details + bank account submitted).
- [ ] Payout bank account connected (this is how withdrawn revenue reaches you).
- [ ] `ALLOWED_ORIGIN` (and/or `APP_URL`) points at `https://msaart.online` so success/cancel redirects work (✅ set in `render.yaml` → `https://msaart.online,https://www.msaart.online`).

---

## 2. Database — PostgreSQL (REQUIRED — all persistence)

The casino runs on PostgreSQL in production (SQLite is dev-only fallback). When PG is
unreachable the site enters **degraded mode** and all money ops return `503`.

**Default (recommended):** `render.yaml` provisions a Render-managed Postgres
(`matrix-spins-db`, plan `basic-256mb`) and auto-wires `DATABASE_URL` via `fromDatabase`.
No manual connection string needed.

**Alternative — Neon PostgreSQL:** If you prefer Neon (or any external PG):
1. Create a Neon project → copy the **pooled** connection string
   (`postgresql://user:pass@…-pooler.region.aws.neon.tech/db?sslmode=require`).
2. In `render.yaml`, remove the `databases:` block + the `fromDatabase` wiring, add:
   ```yaml
   - key: DATABASE_URL
     sync: false
   ```
3. Paste the Neon string into Render dashboard → Environment → `DATABASE_URL`.

> ⚠️ Do **not** use Render's *free* Postgres or Neon's free tier for production — the free
> tiers expire / exhaust compute quota and reproduce the exact degraded-mode outage
> documented in project history.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | Full connection string; must allow SSL (`sslmode=require` for Neon) |

- [ ] `GET /api/health/ready` returns `degraded:false`.
- [ ] `GET /api/health/db-error` returns `"Database healthy — no degraded state."`

---

## 3. Security Secrets (REQUIRED)

| Variable | Requirement | Failure mode |
|---|---|---|
| `JWT_SECRET` | **48+ random chars** (use `openssl rand -base64 48`) | Logins fail / tokens forgeable. `render.yaml` auto-generates a unique value (`generateValue:true`). |
| `ADMIN_PASSWORD` | Strong unique password | Admin dashboard locked. Auto-generated by `render.yaml` — read it from the Render dashboard after first deploy. |
| `ADMIN_API_KEY` | Random | Programmatic admin endpoints. Auto-generated. |

- [ ] `JWT_SECRET` is set and ≥ 48 chars (NOT the dev fallback `dev-secret-do-not-use-in-production`).
- [ ] You have recorded `ADMIN_PASSWORD` from the Render dashboard (Environment tab).

---

## 4. Email / SMTP (RECOMMENDED — currently NOT configured)

Without SMTP the site still takes deposits, but these break:
- Email verification emails (new signups can't verify)
- **Withdrawal OTP** emails (withdrawals ≥ `$500` require an emailed OTP → can't complete)
- Password-reset emails
- Deposit confirmation emails

Set in Render dashboard (e.g. SendGrid, Mailgun, AWS SES, or any SMTP relay):

| Variable | Example | Notes |
|---|---|---|
| `SMTP_HOST` | `smtp.sendgrid.net` | Presence of this flips `health.ready` smtp → `configured` |
| `SMTP_PORT` | `587` | 587 (STARTTLS) or 465 (SSL) |
| `SMTP_SECURE` | `false` | `true` only for port 465 |
| `SMTP_USER` | `apikey` | Provider username |
| `SMTP_PASS` | *secret* | Provider password / API key |
| `SMTP_FROM` | `"Matrix Spins" <noreply@msaart.online>` | From header |
| `ADMIN_EMAIL` | `admin@msaart.online` | Receives operator alerts |

- [ ] SMTP configured and a test email received.
- [ ] Sender domain has SPF + DKIM records (so mail isn't spam-filtered).

---

## 5. Google Analytics 4 (RECOMMENDED)

GA4 is already wired through `js/analytics.js` (consent-gated, GDPR-safe — it only loads
`gtag.js` after the visitor accepts analytics cookies).

- [ ] In GA4: Admin → Data Streams → create a Web stream for `msaart.online` → copy the **Measurement ID** (`G-XXXXXXXXXX`).
- [ ] In `index.html`, replace the placeholder: `window.MS_GA_ID = 'G-XXXXXXXXXX';` → your real ID.
- [ ] Run `npm run build` (propagates to `dist/index.html`) and push.

> Do not paste a raw `<script src="googletagmanager.com/gtag/js">` tag — it would fire GA
> before cookie consent and double-count. The `MS_GA_ID` hand-off is the correct integration.

---

## 6. Social / SEO Meta Tags (✅ DONE)

Already present in `index.html`: `og:title`, `og:description`, `og:image`
(`https://msaart.online/img/og-banner.png`, verified 200 OK), `og:url`, `og:type`,
`twitter:card` (summary_large_image), `twitter:title/description/image`, canonical link,
and JSON-LD structured data (WebSite + Organization).

- [ ] (Optional) Validate share previews: [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) and [Twitter Card Validator] — paste `https://msaart.online`.

---

## 7. Monetization Configuration (✅ verified in `server/config.js`)

| Lever | Value | Where |
|---|---|---|
| House edge / RTP | **80% RTP = 20% house edge** | `TARGET_RTP: 0.80` |
| Max single-spin win | 200× bet | `MAX_WIN_MULTIPLIER: 200` |
| Session win cap | $10,000 | `SESSION_WIN_CAP` |
| Min deposit | $5 | `MIN_DEPOSIT` |
| Min / max withdrawal | $20 / $50,000 | `MIN_WITHDRAWAL` / `MAX_WITHDRAWAL` |
| Withdrawal processing | 3 days | `WITHDRAWAL_PROCESSING_DAYS` |
| Withdrawal OTP threshold | $500 | `WITHDRAWAL_OTP_THRESHOLD` |
| First-deposit bonus | 100% match up to $500, **45× wagering** | `FIRST_DEPOSIT_*` |
| Reload bonus | 25% up to $100, **30× wagering** | `RELOAD_*` |
| Bonus money | Always credited to `bonus_balance` (non-withdrawable until wagered) | webhook handler |
| Promo codes | Active | `server/routes/promocode.routes.js` |

> Bonuses correctly hit `bonus_balance` with accumulating `wagering_requirement` per the
> revenue-protection rules — confirmed in `stripe-checkout.routes.js` webhook handler.

---

## 8. Domain & Deploy

- [ ] DNS for `msaart.online` (+ `www`) points at Render (Cloudflare in front handles www → bare).
- [ ] HTTPS certificate active (Render auto-provisions; Cloudflare full/strict).
- [ ] `ALLOWED_ORIGIN` matches the served domain(s) (CORS + Stripe redirects).
- [ ] Push to `master` triggers Render auto-deploy; `buildCommand` runs `npm run build`.
- [ ] Post-deploy: `GET /api/health/ready` is green.

---

## 9. Admin Account

- [ ] Log into the admin dashboard at `/admin` with `matrix` / `ADMIN_PASSWORD` (from Render env).
- [ ] Change the admin password immediately after first login.
- [ ] Confirm admin can see deposits/withdrawals and approve a test withdrawal.

---

## 10. Pre-Launch Smoke Test (run against live)

1. [ ] Register a fresh account → 201 + token.
2. [ ] Log in → 200 + token.
3. [ ] Create a Stripe checkout for a small amount → redirects to Stripe.
4. [ ] Complete payment with a **real card** (live mode) → balance credited + first-deposit bonus appears in `bonus_balance`.
5. [ ] Play a spin → bet debits, wins pay.
6. [ ] Request a withdrawal → 10-layer gate stack enforces KYC/wagering/limits as expected.
7. [ ] Confirm the Stripe webhook delivered `200` in the Stripe Dashboard event log.

---

## ⚖️ Operator Responsibility — Licensing

Geo-blocking has been **removed** from the server (open to all jurisdictions). You are
responsible for holding a gambling licence covering every market you serve, or re-introducing
a geo-gate before operating where one is legally required. Setting `ALLOWED_COUNTRIES` has
no effect in the current build.
