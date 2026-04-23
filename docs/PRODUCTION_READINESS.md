# Matrix Spins Casino — Production Readiness Report

**Date:** 2026-04-24
**Status:** Code-level changes complete — including geo-blocking + launch self-check.
Business/legal decisions remain outstanding and CANNOT be fixed in code.

> **⚠️ DO NOT flip Stripe into live mode until every item in § 🚫 below is resolved.**
> Taking real-money wagers without a valid gambling licence in the player's
> jurisdiction is a criminal offence in most countries, including Australia.

## Summary

All code-level BLOCKING issues have been fixed in commits on `master`. The site
is **technically** ready to process real payments. It is **not legally** ready
until every non-code item in § 🚫 is done.

## ✅ Pre-launch switch checklist

Work top to bottom. Do not skip.

1. **Obtain a gambling licence** valid in every country on your `ALLOWED_COUNTRIES` list.
   Evidence = the licence certificate PDF and a written legal opinion.
2. **Obtain Stripe Gaming approval** — standard Stripe accounts are not permitted
   to process real-money wagers. Apply at <https://stripe.com/gb/contact/sales>.
3. **AUSTRAC registration** (if operating from Australia) or equivalent FIU
   registration in your jurisdiction.
4. **Select & integrate a KYC vendor** (Jumio/Onfido/Veriff/GreenID). The
   current admin-manual KYC flow does not scale past a few dozen players per day.
5. **Set production env vars** on Render (Settings → Environment):
   - `ALLOWED_COUNTRIES` — ISO-2 codes matching your licence
   - `GEO_FAIL_MODE=closed` (recommended once you verify ipapi is reliable)
   - `STRIPE_SECRET_KEY=sk_live_…` (**not** `sk_test_…`)
   - `STRIPE_WEBHOOK_SECRET=whsec_…`
   - `DATABASE_URL=postgresql://…` (managed Postgres, not SQLite)
   - `JWT_SECRET` (64 chars random)
   - `ADMIN_PASSWORD` (strong, unique)
6. **Put real DPO name + registered business address into** `terms.html` and
   `responsible-gambling.html`.
7. **Verify Stripe webhook endpoint** is registered in the Stripe dashboard
   pointing to `https://msaart.online/api/payment/stripe/webhook`.
8. **Test a $5 deposit + $5 withdrawal** end-to-end with a real card before
   opening to the public.
9. **Boot the server and read the launch-readiness warnings** printed at
   startup. All four warnings should be absent.

## ✅ Code-level fixes shipped

| Area | Fix |
|---|---|
| Registration | Added DOB + T&C acceptance fields to signup form; DOB now persisted on INSERT; age calculation uses UTC-safe helper |
| Stripe | Added idempotency keys on all `checkout.sessions.create` and `paymentIntents.create` calls (prevents double-charging on retry) |
| Stripe webhook | Fixed DB error handler that returned 2xx — now returns 500 so Stripe retries |
| Crypto deposit | Fixed `newBalance` undefined bug in response |
| KYC | Added admin `/api/admin/kyc-pending`, `/kyc-approve`, `/kyc-reject` endpoints (previously users could never reach 'verified' status) |
| Stripe payout | Removed silently-failing `stripe.payouts.create` call that sent funds to house bank instead of user (withdrawals are now explicitly manual bank transfer) |
| Cool-off UI | Now calls `/api/self-exclusion/activate` — server-enforced, not localStorage |
| Self-exclusion UI | Now calls `/api/self-exclusion/activate` — server-enforced, auto-logout on permanent |
| XSS | Fixed `data.country_name` from third-party API being rendered via `innerHTML`; same fix for admin broadcast banner |
| T&C | Currency changed USD→AUD throughout; minimum withdrawal $10→$20; AU Gambling Help Online 1800 858 858 added; BetStop self-exclusion register referenced; governing law & IGA 2001 jurisdiction clause added |
| Client-side fake money | Removed (neutralized to no-op stubs): Mini Jackpot 213, Loss Rebate 637, Deposit Streak 638, Loyalty Exchange V2, Mini-Games (coin/dice/cards), Risk Ladder, second `_jackpotPool`. All real bonuses are server-side via the existing `/api/*` routes |
| KYC submission | Client-side KYC form now submits to real `/api/user/verification` endpoint (was localStorage-only) |
| Geo-blocking | Added `server/middleware/geo-block.js` — allowlist/denylist model via `ALLOWED_COUNTRIES` / `BLOCKED_COUNTRIES` env vars. Wired into register, deposit, withdraw, crypto-verify, bundle-purchase, withdrawal-enhance. 24 h LRU cache, fail-open by default, configurable via `GEO_FAIL_MODE=closed` |
| Launch self-check | Server prints prominent warnings at boot in production if `STRIPE_SECRET_KEY` is missing/non-live, `STRIPE_WEBHOOK_SECRET` is missing, no geo env is configured, or `DATABASE_URL` is missing. Does not block startup — operators need to see the warnings in logs |
| Deposit limits | Already implemented via `user_limits` table (daily/weekly/monthly caps). Enforced in `payment.routes.js:74-116` before Stripe Checkout session creation |

## 🚫 Business-level items outstanding — cannot be fixed in code

These require decisions or licenses that only the operator can provide:

### 1. Jurisdictional licensing (HIGHEST PRIORITY)

Under Australia's **Interactive Gambling Act 2001 (IGA)**, offering online casino
games to Australian residents is prohibited unless the operator holds a valid
**Northern Territory** or **ACT online gambling licence**.

The site currently targets AU (og:locale=en_AU, currency=AUD, AU helplines). You
**cannot legally take real money from AU residents** without either:

- (a) Obtaining an NT/ACT interactive gambling licence (typically 3–6 months,
  requires capital, AUSTRAC registration, RG infrastructure), OR
- (b) Excluding AU residents via geo-restriction at signup AND licensing
  somewhere else (Curacao, Anjouan, Malta, etc.).

**Recommendation:** Pick your licensing jurisdiction first, then backfill
geo-blocking and T&C disclosure accordingly.

### 2. AUSTRAC AML/CTF registration

If operating under an AU licence, the operator must register with **AUSTRAC** as
a Designated Service Provider and submit:
- Threshold Transaction Reports (TTRs) for transactions ≥ $10,000
- Suspicious Matter Reports (SMRs) for ML/TF indicators
- Annual AML/CTF compliance reports

No AML reporting infrastructure exists in the codebase. If you are operating
from AU, this is a statutory requirement — not optional.

### 3. Third-party KYC document verification

Current KYC flow collects ID document images but relies on admin manual review.
For >$2,000 withdrawals the industry standard is integration with a provider
like **GreenID** (AU), **Jumio**, **Onfido**, or **Veriff** that does automated
document + liveness checks.

Without this, fraud risk is high and KYC throughput is bottlenecked by admin
availability.

### 4. Geo-blocking for restricted jurisdictions

No IP-based jurisdiction blocking is implemented. Required either:
- To block AU residents (if licensed elsewhere), OR
- To block jurisdictions where this license is not valid (US, UK, etc.)

Recommend MaxMind GeoIP2 (paid, accurate) or `ipapi.co` (free tier, existing).

### 5. DPO / Business address in Privacy Policy

AU Privacy Principles require the Data Protection Officer identity and business
registered address be disclosed. Currently only `support@msaart.online` is
listed. This is a ~30 minute edit once the operating entity is chosen.

### 6. Stripe Connect for automated payouts

Current withdrawal flow is: admin approves → admin manually bank-transfers to
user. To automate, integrate Stripe Connect — users connect a Stripe Express
account during KYC, and admin approval triggers `stripe.transfers.create` to
their connected account. This is a ~1 week engineering effort.

### 7. Provably-fair seed persistence

The `/api/fair/seed` endpoint returns a fresh seed on every request. A proper
provably-fair implementation would persist per-user seeds, increment nonce per
spin, and allow seed rotation with reveal of the old seed. The current
implementation's verification math is correct but the seed lifecycle is
missing. ~3 day engineering effort for full implementation.

## 🔐 Additional infrastructure gaps (non-BLOCKING)

| Severity | Item |
|---|---|
| HIGH | `npm audit` — 6 high-severity vulnerabilities in `@thirdweb-dev/sdk` transitive deps (`ws`, `elliptic`, `bn.js`). Blockchain stack is in simulated mode so low direct risk, but should `npm audit fix` or pin thirdweb version |
| HIGH | JWT blacklist is in-memory — logged-out tokens become valid again on restart. Move to Redis for multi-instance scaling |
| MEDIUM | PostgreSQL SSL validation disabled by default (`rejectUnauthorized: false`). Document `PGSSL_STRICT=true` / `PGSSL_CA` env vars for operators not on Render/Railway internal networks |
| MEDIUM | Rate limiters use in-memory `Map`. Move to Redis before horizontal scaling |
| LOW | CSP allows `'unsafe-inline'` and `'unsafe-eval'` — weakens XSS defense. Multi-month refactor to use `addEventListener` + nonces |

## Deployment notes

- Render auto-deploys on push to `master` (auto-detected via GitHub webhook)
- Production env vars must include: `JWT_SECRET` (32+ chars), `ADMIN_PASSWORD` (12+ chars), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RNG_SERVER_SECRET`, `DATABASE_URL`
- Server will refuse to start in production if any of these critical vars are missing (enforced by `checkSecurityConfig` in `server/index.js:33`)
- Degraded mode activates automatically when Postgres is unreachable — all money operations return 503
