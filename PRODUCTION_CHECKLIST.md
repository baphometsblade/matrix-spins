# Matrix Spins Casino — Production Launch Checklist

Everything the operator needs to flip from test environment to real money.

## 1. Required Environment Variables

Set these in the Render Dashboard (NOT in `render.yaml` or `.env`). The
server prints a loud `LAUNCH READINESS WARNINGS` banner on startup
listing anything still missing.

### CRITICAL — won't take money without these

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) | SQLite data is wiped on every Render deploy. Use managed PG (Neon, Supabase, Render PG). While PG is unreachable the `degradedModeGuard` middleware returns 503 on all money ops so nothing is charged unrecoverably. |
| `JWT_SECRET` | 48+ random chars (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`) | Signs user sessions. The launch-readiness check rejects common defaults (`dev-secret`, `change-me`, `password`, `123`, anything < 32 chars). |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Deposits return 503 without it. Test keys (`sk_test_...`) trigger a launch warning. |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | Client-side Stripe.js won't initialise without it. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Webhook signature verification. Without it every deposit stays `pending`. |
| `ADMIN_PASSWORD` | Strong password | Required to sign into the admin console at `/admin`. |
| `NODE_ENV` | `production` | Enables the launch-readiness check + strict CORS + geo-blocking. |
| `APP_URL` | `https://msaart.online` | Stripe success/cancel redirects. Wrong value sends users to localhost. |

### IMPORTANT — withdrawals and emails don't work without these

| Variable | Value | Why |
|---|---|---|
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | SMTP relay creds | Password reset, email verification, and high-value **withdrawal OTP** emails. Without SMTP, users can register but can't complete email verification, and can't confirm high-value withdrawals — so they can't withdraw over `WITHDRAWAL_OTP_THRESHOLD`. |
| `SMTP_FROM` | `"Matrix Spins" <noreply@msaart.online>` | From header on all outbound email. |
| `SMTP_PORT` | `587` | STARTTLS by default. |
| `ADMIN_EMAIL` | `ops@msaart.online` | Operator contact for chargeback / AML / fraud alerts. |
| `ALLOWED_COUNTRIES` / `BLOCKED_COUNTRIES` | `AU,NZ,CA` etc. | Geo-blocks payment endpoints. Inert unless one of these is set — launch warning fires. |
| `ALLOWED_ORIGIN` | `https://msaart.online` | Tightens CORS in production. |

### RECOMMENDED — reduce fraud / operational load

| Variable | Value | Why |
|---|---|---|
| `WITHDRAWAL_OTP_THRESHOLD` | `500` (default) | Withdrawals ≥ this value must pass email-OTP before admin can approve. Raises or lowers friction. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` (default) | Forces re-auth after N minutes of inactivity, on top of the 7-day JWT. |
| `TERMS_VERSION` | `1`, `2`, ... | Bump whenever `terms.html` changes materially — forces every existing user through re-acceptance via `/api/user/terms-status`. |
| `WEBHOOK_SECRET` | Random string | Generic payment-confirm webhook (`/api/payment/webhook/confirm`) requires this. Not the Stripe webhook. |

## 2. Stripe Webhook Setup

In the [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks):

1. Add endpoint: **`https://msaart.online/api/payment/webhook`**
   (NOT `/stripe/webhook` — the canonical route is `/payment/webhook`;
   an older `/stripe/webhook` path exists but no handler is mounted there.)
2. Subscribe to:
   - `checkout.session.completed` — credits the balance on success
   - `payment_intent.payment_failed` — marks stalled deposits failed
   - `charge.refunded` — admin-initiated refund; claws back balance, clamped ≥ 0
   - `charge.dispute.created` — chargeback; claws back balance + freezes account with reason `chargeback_dispute:<id>`
   - `charge.dispute.funds_withdrawn` — same claw-back (both events are idempotent via `DISPUTE-<id>` transaction-log key)
3. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.

Disputes and refunds are claim-gated via the transaction log so Stripe retries (or simultaneous `dispute.created` + `funds_withdrawn`) can't double-debit.

## 3. PostgreSQL Setup

1. Provision a Postgres instance (Render managed, Neon, Supabase).
2. Set `DATABASE_URL` in Render env. Schema auto-migrates on next boot
   via `server/db/schema-pg.js` (tables + USER_MIGRATIONS + WITHDRAWAL_MIGRATIONS).
3. Verify: `curl https://msaart.online/api/health` returns `{"status":"ok"}`.
4. If PG is down at boot the server falls back to SQLite + enters degraded
   mode. `/api/payment/deposit`, `/api/payment/withdraw`, `/api/payment/create-checkout`,
   `/api/bundles/purchase`, `/api/matrix-money/*` all return
   `503 { code: 'db_degraded' }` so nothing is charged unrecoverably. The
   Stripe webhook is intentionally NOT gated (Stripe retries until PG is back).

## 4. Admin Account

Before shipping:

1. Create an admin user directly in the DB: `UPDATE users SET is_admin = 1 WHERE username = '<admin_user>'`
2. Sign in at `https://msaart.online/admin` with that account's credentials.
3. You'll see tabs for:
   - **Pending withdrawals** — approve/reject. High-value rows show
     "awaiting OTP" badge and disable Approve until the player verifies.
   - **Pending KYC** — approve/reject submitted verifications.
   - **AML review** — unreviewed large-transaction / structured-deposit / rapid-turnaround events.
   - **User lookup** — id / username / email search with balance + wagering status.
4. All admin routes are protected by `router.use(authenticate, requireAdmin)`.
   CSRF-exempt for the Stripe webhook path only.

## 5. Pre-Launch Smoke Test

Run against the live URL:

```bash
CASINO_URL=https://msaart.online npm run audit:smoke
```

Exercises: register → profile → terms-status → prices → limits → session
→ reality-check → GDPR-export → bundle-501 → logout-then-token-rejection.

Other useful scripts:

```bash
npm run audit:slots:fast    # 100-game structural + paytable + engine + money-safety
npm run audit:reconcile     # Verifies Σ(signed tx) ≈ users.balance for every user
npm run audit:client-routes # Catches client fetch('/api/X') calls with no server mount
```

## 6. Manual Launch Verification

After setting all env vars and deploying:

- [ ] `curl https://msaart.online/api/health` → `{"status":"ok"}`
- [ ] Log in to `/admin` and confirm all 4 tabs load
- [ ] Register a test account at msaart.online (age 18+)
- [ ] Click email verification link → `email_verified = 1`
- [ ] Set a daily deposit limit via `PUT /api/payment/limits` — verify the cooling-off delay on subsequent increases
- [ ] Make a test deposit via Stripe ($5 minimum) — confirm `checkout.session.completed` webhook fires and balance credits
- [ ] Spin a game — check `/api/fair/seed` returns the server seed hash
- [ ] Request a withdrawal < $500 — verify pending, admin approve works
- [ ] Request a withdrawal ≥ $500 — verify OTP email arrives, code entry works, admin sees "OTP verified" badge before approve
- [ ] Check the session reality-check: after 60 min of play, `/api/session/reality-check` returns `dueReminder: true`
- [ ] Download your own data: `GET /api/user/data-export` returns a JSON attachment (GDPR Art. 15)
- [ ] Idle for 30+ min with a stale JWT → next request returns 401 `{ code: 'session_idle' }`

## 7. Ongoing Operator Tasks

| Cadence | Task |
|---|---|
| Daily | Review AML tab for unreviewed events (CTR/SAR decisions) |
| Daily | Process pending withdrawals (approve or reject with reason ≥ 5 chars) |
| Daily | Process pending KYC verifications (admin notifies user on reject) |
| Weekly | Run `npm run audit:reconcile` — verify no balance drift |
| Weekly | Review chargeback disputes in Stripe dashboard |
| Per terms change | Bump `TERMS_VERSION` env var to force re-acceptance |
| Per security patch | Rotate `JWT_SECRET` (invalidates all sessions; users must log in again) |

## 8. What's Production-Ready Right Now

### Money safety (136+ deterministic tests)

- Server-side RNG via `crypto.randomBytes` only (no `Math.random` anywhere)
- Per-user `spin-mutex` shared across `/api/spin` + `/api/buy-feature` (no double-spend)
- Atomic balance operations everywhere — no `UPDATE balance = ?`
- Atomic `session_win_caps` CASE clamp at `SESSION_WIN_CAP`
- Atomic `wagering_progress` increment with `MIN()` cap at requirement
- Atomic bonus→balance conversion with `bonus_balance > 0` guard
- Jackpot pool double-pay protection via `WHERE current_amount = ?` conditional reset
- Stripe webhook: full event coverage (success, chargeback, refund, failed) all idempotent
- Chargeback clamps balance at 0 + freezes account + writes audit transaction
- Atomic withdrawal approve/reject via `WHERE status IN ('pending','otp_verified')`
- TOCTOU-safe withdrawal reject (claim before refund)
- Withdrawal OTP end-to-end: generate → email → expire (15 min) → verify → admin gate
- Balance reconciliation script: `Σ(signed tx) ≈ balance` for every user

### Responsible gambling (UK GC / AU / EU standard)

- Age 18+ enforced at register; DOB stored for audit
- Terms acceptance required + versioned; re-accept flow on material change
- Self-exclusion + cooling-off (configurable periods)
- Deposit limits: daily + weekly + monthly (decrease immediate, increase 24h cooling-off)
- Daily loss limit + session time limit enforced server-side
- Reality-check endpoint (`/api/session/reality-check`) with session stats + `dueReminder`
- Self-excluded user cannot deposit OR receive referral bonus (inline referrer check)

### Compliance

- AML event logger: large deposits ≥ $10k, structured deposits ($8k+ with $10k 24h aggregate), rapid-turnaround (deposit→withdraw within 60 min with < 50% wagered)
- GDPR Art. 15 data export (`GET /api/user/data-export`) — single-request JSON of profile + all tx + deposits + withdrawals + KYC
- KYC verification flow (user submits, admin approves/rejects)
- KYC required for withdrawals > $2,000 (AML threshold)
- Lifetime $5k cap for unverified accounts
- 24h deposit hold before withdrawal (anti-laundering)
- 20x deposit-to-withdrawal ratio cap
- 5x free-bonus playthrough before withdrawal
- `bonusGuard` on all 40+ bonus claim routes (self-exclusion + daily cap)

### Authentication + session security

- bcrypt rounds 13 on password hashing
- Password strength: ≥ 8 chars + upper/lower/digit/special
- Password breach blocklist (top ~50 common) + identity-contains check + 128-char cap
- JWT blacklist on logout
- Tokens with `iat <` user.password_changed_at are invalidated
- jwt.verify pinned to `algorithms: ['HS256']` (no alg=none)
- Server-side idle timeout (30 min default, env-overridable)
- Email verification required before withdrawal
- Rate limits: 200/min global, 20/15min auth, 3/min payment, 5/min bonus, 5/15min sensitive-auth

### Security headers (helmet)

- HSTS 1 year, includeSubDomains, preload
- X-Frame-Options: deny via `frameAncestors: none` CSP
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera/microphone/geolocation blocked; payment=self
- Prototype-pollution rejected in sanitize middleware

### Observability

- `/api/health` — public DB ping (200 during cold start, 503 after 60s if still down)
- `/api/health/detailed` (admin-only) — memory, DB response time, user counts
- `/api/build` — commit + deploy timestamp
- `/api/admin/stats/24h` — rolling 24h deposits / withdrawals / active users / new users
- `process.on('unhandledRejection')` logs + keeps serving
- `process.on('uncaughtException')` logs + exits 1 for process manager restart
- Graceful SIGTERM/SIGINT with DB drain

## 9. Legal / Jurisdiction (Operator Responsibility)

- [ ] Gambling license for your jurisdiction (AU, NZ, EU, UK — all separate regimes)
- [ ] `terms.html` reviewed by a lawyer in your jurisdiction
- [ ] `privacy.html` GDPR-compliant if accepting EU users
- [ ] Configure `ALLOWED_COUNTRIES` / `BLOCKED_COUNTRIES` to match licence scope
- [ ] Register for AUSTRAC / FinCEN / equivalent and file CTRs for detected AML events
- [ ] Integrate with any regulator-mandated self-exclusion register (GAMSTOP etc.)
- [ ] Dispute and chargeback handling playbook
