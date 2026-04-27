# Casino — CLAUDE.md

## Project Overview

**Matrix Spins** — a browser-based slot machine casino.
Single-page app (`index.html`) served by an Express/Node server on port 3000.
80+ slot games, JWT + localStorage auth, server-side RNG verification, house-edge enforcement.

## Running the Project

```bash
npm start              # production server (port 3000)
npm run dev            # same — node server/index.js
npm run test:adapter   # query adapter unit tests (fast, no server needed)
npm run test:security  # security invariant tests (fast, static-analysis, no server)
npm run test:all       # adapter + security in one shot
npm run qa:regression  # Playwright smoke suite (must pass before committing)
```

Dev server is configured in `.claude/launch.json` — use `preview_start("Casino Server")`.

## Architecture

### Client-side (`index.html` + `js/`)

Script load order matters — dependencies flow top to bottom:

```
constants.js              ← all named constants, no dependencies
shared/game-definitions.js ← 80+ game configs (GAMES array)
shared/chrome-styles.js   ← per-game CSS theme data + PROVIDER_FULL_THEMES
house-edge-client.js      ← client RNG helper
sound-manager.js          ← Web Audio synth + provider soundscapes
animations.js             ← particle/confetti helpers + cinematic win sequences
js/globals.js             ← shared mutable state + utility functions
js/particle-engine.js     ← canvas particle system (provider-themed)
js/auth.js                ← login/register/session
js/spin-engine.js         ← grid generation, symbol helpers, RNG queue
js/win-logic.js           ← win evaluation, scatter/bonus dispatch
js/ui-lobby.js            ← lobby render, game filters, win ticker
js/ui-slot.js             ← reel UI, spin animation, slot lifecycle (~2500 lines)
js/ui-modals.js           ← settings, stats, XP, daily bonus, bonus wheel
js/ui-wallet.js           ← wallet/cashier UI
js/ui-profile.js          ← profile management
js/ui-vip.js              ← VIP system UI
js/ui-promos.js           ← promotions UI
js/qa-tools.js            ← QA panel, deterministic seed, forced outcomes
js/app.js                 ← bootstrap (initAllSystems via DOMContentLoaded), keyboard shortcuts
```

All scripts run in the **global scope** (no ES modules). Functions defined in one file are
available to all files loaded after it. `constants.js` must always be first.

### Server-side (`server/`)

Express app — JWT auth, dual-backend database (SQLite/PostgreSQL), house-edge enforcement, rate limiting.

```
server/index.js            ← entry point, middleware, route wiring, graceful shutdown
server/config.js           ← env config (DATABASE_URL selects backend)
server/database.js         ← unified async facade — run/get/all/saveToFile
server/db/sqlite-backend.js ← SQLite backend (sql.js, file-based)
server/db/pg-backend.js    ← PostgreSQL backend (pg Pool, connection pooling)
server/db/query-adapter.js ← translates SQLite SQL → PostgreSQL at runtime
server/db/schema-sqlite.js ← SQLite DDL (11 tables)
server/db/schema-pg.js     ← PostgreSQL DDL (SERIAL, NUMERIC, TIMESTAMPTZ)
server/routes/             ← auth, spin, user, admin, balance, payment routes
server/services/           ← house-edge, game-engine, RNG
server/middleware/         ← JWT verify, rate limit helpers
```

## Key Conventions

### Constants
All magic numbers live in `constants.js`. **Never** hardcode:
- localStorage key strings → use `STORAGE_KEY_*`
- Win tier thresholds → use `WIN_TIER_EPIC/MEGA/BIG/GREAT_THRESHOLD`
- XP awards → use `XP_AWARD_PER_SPIN / XP_AWARD_BIG_WIN / XP_AWARD_REGULAR_WIN`
- Timing values → use the named timing constants
- RNG algorithm constants → `FNV_OFFSET_BASIS`, `FNV_PRIME`, `DEFAULT_SEED_STATE`, etc.
- Quality tiers → `QUALITY_ULTRA/HIGH/MEDIUM/LOW/OFF`, `QUALITY_TIERS`
- Particle budgets → `PARTICLES_MAX_ULTRA/HIGH/MEDIUM/LOW`
- 3D depth → `DEPTH_WIN_FORWARD`, `DEPTH_LOSE_BACK`, `DEPTH_PERSPECTIVE`
- Screen shake → `SHAKE_EPIC/MEGA/JACKPOT_INTENSITY` and `_DURATION`
- Cinematic timing → `CINEMATIC_PAUSE` through `CINEMATIC_FADE_BACK`
- Win thresholds → `WIN_DRAMATIC/EPIC/MEGA/JACKPOT_THRESHOLD`

### State
All shared mutable state lives in `js/globals.js`:
`balance`, `currentGame`, `spinning`, `stats`, `deterministicSeed`, free-spin state, etc.

`appSettings` is initialised by calling `loadSettings()` in `initBase()` — it is **not**
lazy; it must be populated before any modal opens.

### Adding a New Setting
Three coordinated edits required:
1. Default value in `settingsDefaults` object in `js/globals.js`
2. Handler function + sync logic in `openSettingsModal()` in `js/ui-modals.js`
3. HTML control in the settings modal section of `index.html`
`settingsResetAll()` inherits new defaults automatically via `{ ...settingsDefaults }`.

### Visual Effects & Quality Tiers
`appSettings.animationQuality` (`'ultra'`/`'high'`/`'medium'`/`'low'`/`'off'`) controls all
visual effects globally. Always gate expensive effects behind quality checks:
```js
const q = appSettings.animationQuality;
if (q === 'ultra' || q === 'high') { /* 3D depth, landing tilt, full particles */ }
```

Key subsystems:
- **Particle engine** (`js/particle-engine.js`): `initParticleEngine()`, `burstParticles()`,
  `startAmbientParticles()`, `triggerWinParticles()`, `destroyParticleEngine()`
- **Sound system** (`sound-manager.js`): `SoundManager.startAmbient()`, `.stopAmbient()`,
  `.playSoundEvent()`, `.playNearMiss()`, `.playCounterTick()`, `.playReelStop()`
- **Cinematic wins** (`animations.js`): `triggerCinematicWinSequence()` orchestrates
  vignette → 3D pop → shake → text slam → particles → counter roll
- **Provider themes** (`shared/chrome-styles.js`): `PROVIDER_FULL_THEMES` has unified
  visual/particle/sound/ambient/animation config; `getProviderFullTheme(game)` resolves it

### Storage Key Aliases
Some modules use short aliases for convenience — these are defined in `globals.js` and
always point to the canonical `STORAGE_KEY_*` constant:
```js
const RECENTLY_PLAYED_KEY = STORAGE_KEY_RECENTLY_PLAYED;
const XP_STORAGE_KEY      = STORAGE_KEY_XP;
const DAILY_BONUS_KEY     = STORAGE_KEY_DAILY_BONUS;
const WHEEL_STORAGE_KEY   = STORAGE_KEY_BONUS_WHEEL;
```

## QA / Testing

```bash
npm run test:adapter    # query adapter unit tests (~17 cases, fast, no server)
npm run test:security   # security invariant static-analysis tests (~15 cases, no server)
npm run test:all        # run both above in one shot
npm run qa:regression   # full deterministic smoke test (Playwright headless, needs server up)
```

**Both `test:all` and `qa:regression` must pass before every commit.**

`test:security` (`scripts/test_security_invariants.js`) is a static-analysis
fence that catches regressions of the documented security patterns — see
"Security Invariants" below. **Do not skip or weaken** any test that fails.
If a test failure looks "wrong," the fix is to update the assertion to be
*more precise* about the rule it enforces, never to relax it.

Regression verifies:
- Lobby loads + `window.render_game_to_text` is available
- Stats modal opens
- QA tools can apply a deterministic seed and force a triple outcome
- Forced spin resolves to `seven,seven,seven` with a win
- Reset with "clear deterministic seed" restores default state
- No new `console.error` / `pageerror` output

Artifacts written to `output/web-game/regression/`.
On failure: `errors.json` + `failure-shot.png` appear there.

## Security Invariants (enforced by `test:security`)

These are the rules every server-side change MUST follow. Each rule is
backed by a static test that fails at commit time if the pattern regresses.
Per project memory, the bonus_balance routing has been reverted SIX times
by other sessions — the test suite is the regression fence around all of
this work. Do not delete tests. Do not weaken assertions.

1. **No `Math.random()` server-side.** Use `crypto.randomInt(n)`,
   `crypto.randomBytes(n)`, or the helpers in `server/services/rng.service.js`.
   Math.random is V8-predictable and a direct cash-exfil vector for any
   prize-determining outcome.

2. **All balance writes are atomic.** Never `SET balance = ?` (read-then-set
   races). Use:
   - Debits: `UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?`
     and check rowcount — return 400 if 0 rows changed (concurrent debit detected).
   - Credits: `UPDATE users SET balance = balance + ? WHERE id = ?`.

3. **Wagering accumulates, never overwrites.** Always
   `wagering_requirement = COALESCE(wagering_requirement, 0) + ?`. Never
   `wagering_requirement = ?` — that pattern lets a small new bonus replace
   a large active bonus's requirement, instantly making the larger bonus
   withdrawable.

4. **Free credit → `bonus_balance`, not `balance`.** Daily bonus, bonus
   wheel, promo codes, referral bonuses (both parties), VIP wheel, birthday
   bonus, deposit-streak rewards, reload bonus, free-spin payouts, admin
   send-bonus / bulk-bonus, tournament prizes — every one of these is FREE
   money and MUST go to `bonus_balance` with appropriate wagering (15× standard,
   10× free spins, 30× deposit match, 35× reload, 45× first deposit). Direct
   `balance` credits are reserved for: real-money deposits, admin discretionary
   adjustments, win payouts from real bets, and refunds of own debits.

5. **OTP comparison is timing-safe.** `crypto.timingSafeEqual` on
   equal-length buffers (pad to constant length first). Never `===`.

6. **Webhook authentication is HMAC-only.** `/api/payment/webhook/confirm`
   requires `X-Webhook-Signature: <hex(HMAC-SHA256(rawBody, WEBHOOK_SECRET))>`.
   Never fall back to `JWT_SECRET` (cross-domain trust leak). Legacy
   plaintext-secret-in-body path gated behind explicit `WEBHOOK_ALLOW_LEGACY=1`
   env var only — for migration, not steady state.

7. **Critical state transitions use race-safe flips.** Withdrawal cancel,
   admin approve/reject withdrawal, deposit approve, jackpot pool claim,
   free-spin decrement, birthday/referral flag flip — all use
   `UPDATE ... WHERE status = 'pending'` (or equivalent guard) and check
   rowcount. Return 409 Conflict if 0 rows changed.

8. **`config.js` fails-closed in production.** Throws at module load if
   `NODE_ENV=production` and any of `JWT_SECRET`, `ADMIN_PASSWORD`,
   `ALLOWED_ORIGIN` are unset or default. Warns if `WEBHOOK_SECRET` is unset.

9. **Legacy `/api/balance/withdraw` returns 410 Gone.** It bypassed
   self-exclusion, OTP, 24h cooling-off, and bonus-wagering enforcement.
   All clients must use `POST /api/payment/withdraw`.

10. **Password-reset and webhook endpoints are rate-limited.**
    `forgot-password` / `reset-password`: 3 / 15 min per IP.
    `/webhook/confirm`: 30 / min per IP (brute-force HMAC defense).

### QA URL Parameters (manual testing)
| Param | Effect |
|---|---|
| `qaTools=1` | Auto-open QA panel |
| `openSlot=<gameId>` | Open a specific slot on load |
| `spinSeed=<seed>` | Enable seeded RNG |
| `forceOutcome=triple\|double\|loss` | Force next spin outcome |
| `forceSymbol=<symbol>` | Guide forced outcome symbol |
| `forceSpin=a,b,c` | Exact next reel symbols |
| `autoSpin=1` | Trigger one automatic spin |
| `noBonus=1` | Suppress daily bonus modal |

## Claude Code Automations

Automations live in `.claude/` (tracked in git; only `settings.local.json` is gitignored).

| What | Where | Effect |
|---|---|---|
| Pre-commit QA gate | `.claude/hooks/pre-commit-qa.js` | Blocks `git commit` if regression fails |
| `.env` write guard | `.claude/hooks/block-dotenv.js` | Blocks Claude editing `.env` |
| Hook config | `.claude/settings.json` | Registers both hooks as `PreToolUse` |
| Security reviewer | `.claude/agents/security-reviewer.md` | Audits auth, SQL, house-edge, CORS |
| New-game scaffold | `.claude/skills/new-game/SKILL.md` | `/new-game` — step-by-step slot game addition |
| context7 MCP | `.mcp.json` | Live docs for express, jwt, bcrypt, sql.js, playwright |

### Adding MCP Servers
`claude mcp add` cannot run inside a Claude Code session (nested sessions are blocked).
Edit `.mcp.json` directly instead.

## Database Backends

The app supports two database backends, selected automatically at startup:

| | SQLite (default) | PostgreSQL |
|---|---|---|
| **When** | `DATABASE_URL` not set | `DATABASE_URL` set |
| **Dependency** | `sql.js` (in-process) | `pg` (connection pool) |
| **Persistence** | `casino.db` file | Server-managed |
| **Use case** | Local dev, zero setup | Production, cloud deploy |

`npm start` without `DATABASE_URL` works exactly as before (SQLite).

**All database calls are async** (`await db.run()`, `await db.get()`, `await db.all()`).
Route files write SQLite-dialect SQL; the query adapter (`server/db/query-adapter.js`)
translates `datetime('now')`, `strftime()`, `?` params, etc. to PostgreSQL equivalents at runtime.

### PostgreSQL Gotchas (pg-backend.js)

Type parsers are registered at module load to keep SQLite/PG parity:
- `NUMERIC(15,2)` → `parseFloat` (OID 1700) — without this, money columns return strings
- `TIMESTAMPTZ` → raw string passthrough (OID 1184) — without this, dates return JS Date objects
- `BIGINT` → `parseInt` (OID 20) — `COUNT(*)` returns bigint strings in PG

**All async route handlers MUST have try/catch.** Express 4 does not catch rejected promises —
an uncaught `await db.get()` error becomes an unhandled rejection (server crash risk).

**Write PG-compatible SQL.** The query adapter handles syntax only. You must avoid:
- SELECT aliases in `HAVING` (repeat the expression instead)
- Non-aggregated columns missing from `GROUP BY` (PG is strict)
- Assuming tables have an `id` column (some use `user_id` or `game_id` as PK)

### Deployment (Render.com)

`render.yaml` provisions a free PostgreSQL database and links it via `DATABASE_URL`.
Push to main and Render auto-deploys. No ephemeral filesystem dependency.
`GET /api/health` — database ping + uptime, used by Render's `healthCheckPath`.

## Environment Setup

Create `.env` in the project root (optional — defaults work for local dev):

```bash
PORT=3000
JWT_SECRET=dev-secret-change-in-production
ADMIN_PASSWORD=admin123changeme
NODE_ENV=development
DB_PATH=./casino.db
# DATABASE_URL=postgresql://user:password@localhost:5432/matrix_spins
```

- `casino.db` is **auto-created** on first `npm start` if it doesn't exist (sql.js in-process SQLite).
- `casino.db` is gitignored — never commit it.
- No `.env` file is required for local dev; all values have safe defaults.
- Set `DATABASE_URL` to use PostgreSQL instead of SQLite.

## Admin Panel

Static HTML panel at `admin/index.html` — open via browser after starting the server.
Calls `GET /api/admin/stats` (requires admin JWT). Admin password set via `ADMIN_PASSWORD` env var.

## Gotchas

- **Dual auth (silent fallback):** The app prefers server JWT auth but silently falls back to localStorage-only mode when the server is unreachable. Both modes are transparent to the user.
- **Port confusion:** `QUICK_START.md` references port 4173 (old static-file workflow). The real app runs on port 3000 via `npm start`. Always use `http://localhost:3000`.
- **House edge is server-enforced:** 88% RTP, $50k session win cap, 500x max win multiplier — all in `server/config.js`. Client-side win calculations are for display only; server has final say.
- **QA regression uses its own base URL:** The Playwright suite hits `http://localhost:3000` via the preview server — always run `npm start` (or `preview_start`) before `npm run qa:regression`.
- **`appSettings` is not lazy:** It must be populated before any modal opens. `loadSettings()` is called as the first line of `initBase()`. Do not call modal-open functions before `initBase()` runs.
- **Slot testing requires auth:** `openSlot()` silently no-ops when `currentUser === null`. The preview browser always starts unauthenticated. Use `npm run qa:regression` — it is the only reliable way to verify slot behaviour without a real login.
- **Modal layout timing:** `classList.add('active')` does not immediately settle flex layout or CSS transitions. Use `requestAnimationFrame(() => requestAnimationFrame(() => fn()))` (double-RAF) for any DOM measurement that depends on a freshly activated modal.
- **Reel animation state:** `reelStripData[]` in `globals.js` stores live per-column animation state (`cellH`, `visibleH`, `totalH`, `currentY`, `targetY`, `stripEl`). Any runtime resize of reel cells must update all six fields in sync or the spin animation drifts. `REEL_CELL_DIMS` (constants.js) and `REEL_STRIP_BUFFER` are the canonical sizing constants.
- **Multi-agent file contention:** When dispatching parallel agents, never assign two agents to edit the same file. Changes can be silently lost. Serialize edits to shared files (especially `index.html`, `styles.css`).
- **`typeof` guards for cross-file constants:** Code in files loaded early may reference constants from `constants.js`. Use `typeof X !== 'undefined' ? X : fallback` to tolerate load-order edge cases.
- **CSS class name collisions:** `styles.css` is ~10k lines. Always search for existing class names before adding new ones (e.g., `.reel-win-entrance` already existed when Phase 2 tried to add it).
- **QA filters asset 404s:** The QA regression script ignores `404 + "Failed to load resource"` errors since animated WebP assets load optimistically with PNG fallback.
- **Production safety guards:** `server/index.js` refuses to start in `NODE_ENV=production` if `JWT_SECRET` or `ADMIN_PASSWORD` are still default values. Set both in `.env` or environment.

## Asset Generation

AI-generated game assets via Python scripts in `scripts/`:
```bash
npm run reasset:slot-chrome          # SDXL, high contrast
npm run reasset:slot-chrome:auto     # auto engine
npm run reasset:slot-chrome:balanced # balanced style
```

Animated WebP generation (requires ComfyUI + AnimateDiff running locally):
```bash
python scripts/generate_animated_symbols.py --dry-run     # preview symbol categories
python scripts/generate_animated_backgrounds.py --dry-run  # preview background themes
```
Symbols: 15fps, 1.5s loop, ≤150KB. Backgrounds: 10fps, 3s loop, ≤400KB.
`ui-slot.js` loads `.webp` first with automatic `.png` fallback via `onerror`.

Requires Python 3.10 + configured AI image backend.

## Commit Style

Conventional commits with Co-Author trailer:
```
<type>: <short description>

<body>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Types used: `feat`, `fix`, `refactor`, `chore`, `docs`.
