# Casino Project Rules

## CRITICAL: Revenue Protection Rules

These rules exist because they have been violated repeatedly, causing direct revenue loss.

### 1. ALL free bonuses MUST use `bonus_balance` with wagering requirements

**NEVER** credit free bonus money to `balance` (withdrawable). Always use:
```sql
UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?
```

Wagering multipliers:
- Standard bonuses: 15x
- Loss compensation (cashback, insurance, streak saver): 10x
- Battle pass: 20x
- Deposit match / retention: 30x
- First deposit: 45x

### 2. Streak saver in spin.routes.js MUST use bonus_balance

The streak saver (~line 847-856) gives free credits after 10 consecutive losses. This has been reverted to `balance` **4 times** by other sessions. It MUST remain:
```javascript
await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [streakBonus, streakBonus * 10, userId]);
```
**NOT** `UPDATE users SET balance = balance + ?`. Free credits to `balance` = instant withdrawable cash = revenue leak.

### 3. Retention bonus in withdrawal-enhance.routes.js MUST use bonus_balance

The accept-offer endpoint must credit `bonus_balance`, not `balance`.

### 4. Balance operations MUST be atomic

Use `balance = balance + ?` or `balance = balance - ? WHERE balance >= ?`, **never** `balance = ?` (read-then-set race condition).

### 5. Wagering requirements MUST accumulate

Use `wagering_requirement = COALESCE(wagering_requirement, 0) + ?`, **never** `wagering_requirement = ?` (overwrites existing requirements).

### 6. All bonus claim routes MUST use `bonusGuard` middleware

Every POST route that credits bonus_balance needs:
```javascript
const { bonusGuard } = require('../middleware/bonus-guard');
router.post('/claim', authenticate, bonusGuard, async (req, res) => { ... });
```
This enforces self-exclusion checks and daily bonus caps.

### 7. No Math.random() on server side

Use `crypto.randomBytes()` for all server-side randomness. `Math.random()` is predictable in Node.js. The first line of `server/index.js` MUST be `require('./utils/secure-rng');` — this monkey-patches `Math.random` globally to use `crypto.randomBytes`, providing belt-and-suspenders protection against any forgotten `Math.random()` call.

### 8. server/index.js MUST mount production routes from server/routes/

**NEVER** ship a `server/index.js` that returns hardcoded demo data (e.g. `'$1000.00'` for deposits). The 95+ files in `server/routes/` ARE the casino — they handle auth, payments, spins, jackpots, withdrawals, bonuses. If `server/index.js` doesn't `require()` and `app.use()` them, the site cannot earn money.

Required structure:
1. `require('./utils/secure-rng');` — first line
2. Setup middleware (cors, security headers, rate limits)
3. `await initDatabase()` — must complete BEFORE routes mount (route bootstrap creates tables)
4. Mount all routes from `server/routes/` — use a safe loader with try/catch per route
5. Bind static files + SPA fallback + error handler AFTER routes (Express middleware order)
6. `app.listen()` last

The `ensureReady()` helper handles the async init order. Vercel adapter at `api/index.js` calls it on cold start.

### 9. NEVER create stub route files that mask production failures

The deleted `server/routes/payment.js` and `server/routes/game-session.js` were 60-line stubs that the catch-block fallback in `server/index.js` would mount when the real routes failed to load. This meant **deposits silently returned hardcoded $1000** if a require error occurred — masking the real bug while leaking revenue capability.

If a route fails to load, log the error and let the API return 503 — never substitute fake data.

## Deployment

### Render
- `render.yaml` declares env vars; set secrets (Stripe, DATABASE_URL, ADMIN_PASSWORD) manually in dashboard.
- Health check: `/api/health`
- Server runs `node server/index.js` (port from `$PORT`)
- Site shows "degraded mode" banner when PostgreSQL is unreachable; money operations return 503

### Vercel
- `vercel.json` rewrites `/api/(.*)` → `/api/index.js`
- `api/index.js` is the serverless adapter — wraps the real Express app from `server/index.js`
- Same env vars required as Render (DATABASE_URL, JWT_SECRET, STRIPE_*, etc.)
- Use Vercel as failover when Render is down; both deployments share the same database

### Required environment variables for revenue
| Variable | Required for | Failure mode |
|---|---|---|
| `DATABASE_URL` | All persistence | Degraded mode, money ops blocked |
| `JWT_SECRET` (32+ chars) | Auth | Logins fail |
| `STRIPE_SECRET_KEY` | Card deposits | Deposits return error |
| `STRIPE_WEBHOOK_SECRET` | Async deposit confirmation | Webhooks unverified |
| `STRIPE_PUBLISHABLE_KEY` | Frontend Stripe.js | Checkout UI broken |
| `ADMIN_PASSWORD` | Admin dashboard | Admin login disabled |
| `ALLOWED_ORIGIN` | CORS + Stripe redirect URLs | Frontend cannot call API; checkout redirects fall back to https://msaart.online |

> **Geo-gating REMOVED (commit 819a9018):** the server no longer enforces `ALLOWED_COUNTRIES` — there is no country/IP gate on registration or payments (`server/index.js`: "Geo-Block REMOVED — open to all jurisdictions"). This is an **operator responsibility**: you must ensure your gambling licence covers every market you serve, or re-introduce a geo-gate before operating in a jurisdiction that legally requires one. Setting `ALLOWED_COUNTRIES` currently has no effect.

## Workflow
- Commit directly to `master` (no feature branches)
- Run `npm run qa:regression` before every commit
- Push to `origin/master` after every commit
- Verify on live site (msaart.online), not locally
