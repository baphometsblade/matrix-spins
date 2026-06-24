# Battle-Pass Unification — Design

**Date:** 2026-06-25
**Status:** Approved (user delegated direction: "decide what is best for the most profitable casino")

## Problem

Two independent battle-pass implementations existed, decoupled (commit 908508af) but not
unified:

1. **SERVICE** `server/services/battlepass.service.js` — season-based. Tables
   `battle_pass_seasons` + `battle_pass_progress` (keyed by `user_id, season_id`).
   Auto-creates a fresh monthly season; 50 levels; cash $9.99 premium; computed credit
   rewards → `bonus_balance` @ 20× wagering. **Receives spin XP** via
   `spin.routes.js:1064` (`battlepassService.addXp`). This path WORKS.

2. **ROUTE** `server/routes/battle-pass.routes.js` (mounted `/api/battle-pass` +
   `/api/battlepass`) — pass-based. Tables `battle_passes`, `battle_pass_user_progress`,
   `battle_pass_purchases`, `battle_pass_claims`, `bp_xp_rate_log`. 30 levels; gem-priced
   premium/elite; static milestone rewards. This is the user-facing API.

**Bug:** spin XP accrues in the SERVICE's table, but the ROUTE reads its own table → the
`/api/battle-pass` progress display always shows xp=0/level=1.

**Two aggravating facts discovered:**
- No frontend currently consumes `/api/battle-pass` (the only client reference *suppresses*
  the `.battle-pass-fab`). So "user-facing UI" = the JSON contract; reshaping it breaks no
  rendered page.
- The route's single season (`Matrix Rising`, 2026-03-01 → 2026-04-30) is **already expired**
  as of 2026-06-25 → the route returns `{active:false}` / 404 in production. The route system
  is effectively dormant/broken; the service is live.

## Decision: Service-canonical (option a), enriched

Make the season-based SERVICE the single source of truth. Rewrite the ROUTE into a thin
presentation layer that delegates all progression to the service, so spin XP is reflected.

**Rationale (profit + risk):**
- Lowest risk: the service already receives spin XP; we never touch the money-critical spin
  write path. We change only the read side (the route).
- Auto-rotating monthly seasons = perpetual re-engagement / FOMO (the route lacks rotation
  and is expired).
- Direct cash $9.99 premium = real-money revenue (atomic, balance-guarded `buyPremium`).
- Add cosmetic milestone rewards (zero delivery cost, whale appeal) + a leaderboard
  (competitive grind → more spins → more house edge).
- All credit rewards remain `bonus_balance` + 20× wagering (CLAUDE.md rule 1 — no leak).

**Explicitly deferred (out of scope, documented for future):** the route's *elite* tier and
gem-pricing. Adding an `elite` tier needs a new column on `battle_pass_progress` (an ALTER on
a live PG table) — exactly the schema-drift/degraded-mode class of incident this repo has been
bitten by. The working battle pass + cosmetics + leaderboard already far outweighs the marginal
elite upsell. Revisit as a dedicated, migration-gated change.

## API contract (canonical, served by the service)

All routes keep their paths so any future/legacy client keeps working.

- `GET /api/battle-pass/` — public season info (+ user progress if authed).
- `GET /api/battle-pass/progress` — authed; full progress from `service.getProgress`.
- `POST /api/battle-pass/purchase` — authed + rate-limit + self-exclusion; `service.buyPremium`
  (cash $9.99). Accepts `{tier:'premium'}`; `elite` → 400 (retired).
- `POST /api/battle-pass/claim` — authed + `bonusGuard`; `{level, track:'free'|'premium'}` →
  `service.claimReward`.
- `GET /api/battle-pass/leaderboard` — public; top players in the current season.
- `POST /api/battle-pass/add-xp` — **deprecated no-op** (returns current progress). Spins award
  XP server-side; a client add-xp would double-count and was an XP-farming vector.

Response mapper emits both service-native fields (`level`, `xp`, `nextLevelXp`, `isPremium`,
`claimedFree/Premium`, `tiers`) and legacy aliases (`current_level`, `xp_for_next_level`,
`progress_to_next_level`, `season_number`, `tier`, `claimed_levels`).

## Retirement (non-destructive)

Stop all reads/writes of `battle_passes`, `battle_pass_user_progress`,
`battle_pass_purchases`, `battle_pass_claims`, `bp_xp_rate_log` in app code (delete
`_ensureBattlePassData` and the route's pass-based queries). **Do NOT `DROP`** these tables —
dropping live tables in a raced, multi-deploy (Render/Vercel/Neon) money DB is needlessly
destructive. The CREATE-TABLE definitions stay in `schema-*.js` as inert; removing the route's
bootstrap actually *reduces* creator-drift. `admin-analytics` switches its "battle pass
purchases" metric from `battle_pass_purchases` to premium count on `battle_pass_progress`.

## Reward model (service)

`REWARD_TIERS` (computed, 50 levels) gains an additive `cosmetic` label on the **premium**
track at milestones (10/20/30/40/50). Cosmetics are presentational metadata echoed on claim;
they require no new claim type and don't alter the credit-grant path.

## Testing

`tests/integration/battle-pass-unification.test.js` (supertest over the test app with
`/api/auth`, `/api/spin`, `/api/battle-pass`):
1. **Core proof:** `service.addXp(userId, bet)` (what the spin does) → `GET /progress` reflects
   level/xp. Deterministic.
2. **Live proof:** real `POST /api/spin` → poll `GET /progress` until xp>0 (fire-and-forget
   addXp). Proves the end-to-end seam.
3. Public `GET /` returns an active season.
4. `POST /purchase` premium → balance debited, subsequent progress `is_premium`.
5. `POST /claim` free at a reached level → `bonus_balance` + wagering credited, `claimed_free`
   includes level.
6. Leaderboard includes the player.

Plus: existing `insert-fixes.test.js` regression (tables still exist) stays green;
`qa:schema` + `qa:inserts` stay clean (no new columns; fewer INSERTs); full jest green.
