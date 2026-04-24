#!/usr/bin/env node
'use strict';

/**
 * Money-safety deterministic tests.
 *
 * Covers the critical revenue-protection invariants documented in
 * CLAUDE.md (rules 1-7) plus the session-win-cap atomic clamp and
 * the spin-mutex serialisation guarantee.
 *
 *   1. spinMutex: tryAcquire is exclusive per userId
 *   2. spinMutex: release makes the slot reusable
 *   3. spinMutex: kind flag distinguishes spin vs buy_feature
 *   4. session-win-cap CASE clamp: INSERT from empty state
 *   5. session-win-cap CASE clamp: UPDATE pushes total to cap
 *   6. session-win-cap CASE clamp: UPDATE cannot exceed cap under race
 *   7. wagering_requirement: no non-atomic overwrite writes in server/
 *   8. balance: no non-atomic writes in server/
 *   9. jackpot reset: conditional UPDATE wins race only once
 *  10. buy-feature parity with spin-cap CASE + spinMutex acquire
 *  11. stripe-service uses COALESCE accumulate + does not reset progress
 */

const path = require('path');
const fs = require('fs');

let fails = 0, passes = 0;
function test(name, fn) {
    try {
        const out = fn();
        if (out && typeof out.then === 'function') {
            return out.then(() => { console.log(`  ✅ ${name}`); passes++; })
                     .catch(err => { console.log(`  ❌ ${name}: ${err.message}`); fails++; });
        }
        console.log(`  ✅ ${name}`);
        passes++;
    } catch (err) {
        console.log(`  ❌ ${name}: ${err.message}`);
        fails++;
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); }

// ──────────────────────────────────────────────────────────────────────
// Walk server/ dir and collect every .js file (for code-scan tests)
// ──────────────────────────────────────────────────────────────────────
const SERVER_DIR = path.join(__dirname, '..', 'server');
function walkJs(dir, out) {
    out = out || [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkJs(full, out);
        else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
    }
    return out;
}
const SERVER_JS = walkJs(SERVER_DIR);

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== spin-mutex ===');
// ══════════════════════════════════════════════════════════════════════
const spinMutex = require(path.join(__dirname, '..', 'server', 'services', 'spin-mutex'));

test('tryAcquire is exclusive per userId', () => {
    spinMutex._clearAll();
    assertEq(spinMutex.tryAcquire(1, 'spin'), true, 'first acquire succeeds');
    assertEq(spinMutex.tryAcquire(1, 'spin'), false, 'second acquire for same user fails');
    assertEq(spinMutex.tryAcquire(2, 'spin'), true, 'different user can still acquire');
    spinMutex._clearAll();
});

test('release makes the slot reusable', () => {
    spinMutex._clearAll();
    assertEq(spinMutex.tryAcquire(1), true);
    spinMutex.release(1);
    assertEq(spinMutex.tryAcquire(1), true, 'acquire after release succeeds');
    spinMutex._clearAll();
});

test('kind flag distinguishes spin vs buy_feature', () => {
    spinMutex._clearAll();
    spinMutex.tryAcquire(1, 'buy_feature');
    assertEq(spinMutex.activeKind(1), 'buy_feature');
    assertEq(spinMutex.tryAcquire(1, 'spin'), false, 'spin cannot race buy_feature on same user');
    spinMutex._clearAll();
});

test('isLocked returns true iff a lock is held', () => {
    spinMutex._clearAll();
    assertEq(spinMutex.isLocked(1), false);
    spinMutex.tryAcquire(1);
    assertEq(spinMutex.isLocked(1), true);
    spinMutex.release(1);
    assertEq(spinMutex.isLocked(1), false);
    spinMutex._clearAll();
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== session-win-cap atomic CASE clamp ===');
// ══════════════════════════════════════════════════════════════════════
// We test the SQL logic by simulating it in JavaScript. The CASE
// expression must clamp total_wins at SESSION_WIN_CAP no matter how
// large the incoming increment is.
const SESSION_WIN_CAP = 10000;

function simulateCaseClamp(currentTotal, increment) {
    // SQL equivalent:
    //   total_wins = CASE
    //     WHEN currentTotal + increment > SESSION_WIN_CAP THEN SESSION_WIN_CAP
    //     ELSE currentTotal + increment END
    if (currentTotal + increment > SESSION_WIN_CAP) return SESSION_WIN_CAP;
    return currentTotal + increment;
}

test('CASE clamp: fresh session accepts small win', () => {
    assertEq(simulateCaseClamp(0, 100), 100);
});

test('CASE clamp: incremental win under cap', () => {
    assertEq(simulateCaseClamp(5000, 1500), 6500);
});

test('CASE clamp: incremental win pushes to exactly cap', () => {
    assertEq(simulateCaseClamp(9000, 1000), 10000);
});

test('CASE clamp: incremental win beyond cap is clamped', () => {
    assertEq(simulateCaseClamp(9000, 2500), SESSION_WIN_CAP, 'overshoot clamped to cap');
});

test('CASE clamp: already at cap stays at cap under further wins', () => {
    assertEq(simulateCaseClamp(10000, 500), SESSION_WIN_CAP);
});

test('CASE clamp: two concurrent wins cannot exceed cap', () => {
    // Both requests read total_wins = 9500 concurrently
    // Both compute sessionCapped = min(winAmount, 10000-9500=500)
    // Both call UPDATE — the CASE clamps whichever lands second
    let total = 9500;
    total = simulateCaseClamp(total, 500); // Request A
    total = simulateCaseClamp(total, 500); // Request B
    assertEq(total, SESSION_WIN_CAP, 'DB counter cannot exceed cap');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== code-scan: non-atomic writes in server/ ===');
// ══════════════════════════════════════════════════════════════════════
// CLAUDE.md rule #4/5: `balance` and `wagering_requirement` must use
// atomic SQL (`balance = balance + ?` / `COALESCE + ?`). Scanning every
// server/ .js for bare `SET balance = ?` or
// `wagering_requirement = ?` that isn't preceded by COALESCE.

function scanForPattern(re) {
    const out = [];
    for (const file of SERVER_JS) {
        const src = fs.readFileSync(file, 'utf8');
        const lines = src.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
                out.push({ file: path.relative(SERVER_DIR, file), line: i + 1, text: lines[i].trim() });
            }
        }
    }
    return out;
}

test('no SQL writes `balance = ?` (must be balance = balance + ?)', () => {
    const bad = [];
    for (const hit of scanForPattern(/UPDATE\s+users\s+SET\s+balance\s*=\s*\?/i)) {
        bad.push(`${hit.file}:${hit.line} ${hit.text}`);
    }
    assert(bad.length === 0, `found ${bad.length} non-atomic balance writes:\n  ${bad.join('\n  ')}`);
});

test('no SQL writes `wagering_requirement = ?` without COALESCE', () => {
    const bad = [];
    for (const hit of scanForPattern(/wagering_requirement\s*=\s*\?/)) {
        // Allow if the same line uses COALESCE(wagering_requirement, 0) + ?
        if (/COALESCE\s*\(\s*wagering_requirement/i.test(hit.text)) continue;
        bad.push(`${hit.file}:${hit.line} ${hit.text}`);
    }
    assert(bad.length === 0, `found ${bad.length} non-accumulating wagering writes:\n  ${bad.join('\n  ')}`);
});

test('no SQL writes `bonus_balance = ?` without COALESCE (overwrite)', () => {
    const bad = [];
    for (const hit of scanForPattern(/bonus_balance\s*=\s*\?/)) {
        if (/COALESCE\s*\(\s*bonus_balance/i.test(hit.text)) continue;
        bad.push(`${hit.file}:${hit.line} ${hit.text}`);
    }
    assert(bad.length === 0, `found ${bad.length} non-atomic bonus_balance writes:\n  ${bad.join('\n  ')}`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== jackpot double-pay race protection ===');
// ══════════════════════════════════════════════════════════════════════
// The fix uses conditional UPDATE: `WHERE tier = ? AND current_amount = ?`.
// We verify the SQL pattern is present in both payout paths.
const JACKPOT_SRC = fs.readFileSync(path.join(SERVER_DIR, 'services', 'jackpot.service.js'), 'utf8');

test('processJackpotContribution uses conditional UPDATE with current_amount guard', () => {
    const fnMatch = JACKPOT_SRC.match(/async function processJackpotContribution[\s\S]+?^}/m);
    assert(fnMatch, 'processJackpotContribution not found');
    assert(
        /WHERE tier = \? AND current_amount = \?/.test(fnMatch[0]),
        'processJackpotContribution missing current_amount guard'
    );
});

test('checkAndAward uses conditional UPDATE with current_amount guard', () => {
    const fnMatch = JACKPOT_SRC.match(/async function checkAndAward[\s\S]+?^}/m);
    assert(fnMatch, 'checkAndAward not found');
    assert(
        /WHERE tier = \? AND current_amount = \?/.test(fnMatch[0]),
        'checkAndAward missing current_amount guard'
    );
});

test('jackpot RNG uses crypto.randomBytes (no Math.random)', () => {
    assert(/crypto\.randomBytes/.test(JACKPOT_SRC), 'jackpot must use crypto.randomBytes');
    assert(!/Math\.random\s*\(/.test(JACKPOT_SRC), 'jackpot must not use Math.random');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== buy-feature parity with spin route ===');
// ══════════════════════════════════════════════════════════════════════
const BUYFEATURE_SRC = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'buyfeature.routes.js'), 'utf8');
const SPIN_SRC = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'spin.routes.js'), 'utf8');

test('buyfeature uses atomic CASE clamp (matches spin route)', () => {
    const re = /total_wins = CASE[\s\S]*?session_win_caps\.total_wins \+ \? > \?[\s\S]*?THEN \?/;
    assert(re.test(BUYFEATURE_SRC), 'buyfeature missing atomic CASE clamp');
    assert(re.test(SPIN_SRC), 'spin.routes missing atomic CASE clamp (regression)');
});

test('buyfeature acquires and releases spinMutex', () => {
    assert(/spinMutex\.tryAcquire\(userId,\s*['"]buy_feature['"]\)/.test(BUYFEATURE_SRC), 'buyfeature missing tryAcquire');
    const releaseCount = (BUYFEATURE_SRC.match(/spinMutex\.release\(userId\)/g) || []).length;
    assert(releaseCount >= 2, `buyfeature must release on success + all error paths (got ${releaseCount})`);
});

test('spin.routes still uses spinMutex through the activeSpins adapter', () => {
    assert(/spinMutex\.(tryAcquire|release|isLocked)/.test(SPIN_SRC), 'spin.routes must use spinMutex');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== stripe deposit-bonus credits correctly ===');
// ══════════════════════════════════════════════════════════════════════
const STRIPE_SRC = fs.readFileSync(path.join(SERVER_DIR, 'services', 'stripe.service.js'), 'utf8');

test('stripe uses atomic balance = balance + ? for deposit credit', () => {
    assert(/UPDATE users SET balance = balance \+ \? WHERE id = \?/.test(STRIPE_SRC),
        'stripe must atomically credit deposit via `balance = balance + ?`');
    // And must NOT have the old broken pattern anywhere else
    assert(!/UPDATE users SET balance\s*=\s*\?\s+WHERE id = \?/.test(STRIPE_SRC),
        'stripe must not use `balance = ?` read-then-set pattern');
});

test('stripe accumulates wagering_requirement via COALESCE', () => {
    assert(
        /wagering_requirement\s*=\s*COALESCE\(\s*wagering_requirement,\s*0\s*\)\s*\+\s*\?/.test(STRIPE_SRC),
        'stripe must accumulate wagering_requirement, not overwrite'
    );
});

test('stripe preserves wagering_progress across new bonus grants', () => {
    // Locate the `if (bonusAmount > 0)` block
    const bonusBlock = STRIPE_SRC.match(/if\s*\(\s*bonusAmount\s*>\s*0\s*\)[\s\S]+?^\s{4}}/m);
    assert(bonusBlock, 'bonus block not found in stripe.service.js');
    const body = bonusBlock[0];
    // Must NOT reset progress to 0
    assert(
        !/wagering_progress\s*=\s*0/.test(body),
        'stripe must NOT reset wagering_progress when granting bonus'
    );
    // Must preserve it with COALESCE
    assert(
        /wagering_progress\s*=\s*COALESCE\(\s*wagering_progress,\s*0\s*\)/.test(body),
        'stripe should use COALESCE(wagering_progress, 0) to preserve existing progress'
    );
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== CLAUDE.md rule #6: bonusGuard on every user-claim bonus route ===');
// ══════════════════════════════════════════════════════════════════════
// Every route file that credits bonus_balance via COALESCE MUST either
// (a) import bonusGuard from middleware/bonus-guard, or
// (b) appear in the known-exempt list below (non-claim paths: signup,
//     admin, engine winnings, deposit webhooks, tournament-auto-credit)
const BONUS_GUARD_EXEMPT = new Set([
    'spin.routes.js',           // free-spin winnings credited from engine, not user-claim
    'admin.routes.js',          // admin endpoints — uses checkTargetSelfExclusion()
    'auth.routes.js',           // signup/register flow — new users by definition not self-excluded
    'payment.routes.js',        // deposit processing (Stripe webhook side-effect)
    'stripe-checkout.routes.js',// Stripe payment webhook
    'premium-tournament.routes.js', // tournament auto-settlement
    'referralbonus.routes.js',  // internal-only (verifyInternal middleware, triggered by signup)
]);

test('every user-claim bonus route imports bonusGuard', () => {
    const routesDir = path.join(SERVER_DIR, 'routes');
    const missingGuards = [];
    for (const f of fs.readdirSync(routesDir)) {
        if (!f.endsWith('.routes.js')) continue;
        const src = fs.readFileSync(path.join(routesDir, f), 'utf8');
        const creditsBonus = /bonus_balance\s*=\s*COALESCE\(\s*bonus_balance/i.test(src);
        if (!creditsBonus) continue;
        const hasGuard = /require\(.+bonus-guard['"]\)|\bbonusGuard\b/.test(src);
        if (!hasGuard && !BONUS_GUARD_EXEMPT.has(f)) {
            missingGuards.push(f);
        }
    }
    assert(missingGuards.length === 0, `routes credit bonus_balance but do not use bonusGuard:\n  ${missingGuards.join('\n  ')}`);
});

test('user.routes.js applies bonusGuard to every claim endpoint that credits bonus_balance', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    // Extract every router.post block up to the closing `});` that contains a bonus_balance COALESCE write
    const blocks = src.split(/router\.(post|put|delete)\(/g);
    const offenders = [];
    for (let i = 1; i < blocks.length; i += 2) {
        const verb = blocks[i];
        const body = blocks[i + 1] || '';
        if (!/bonus_balance\s*=\s*COALESCE\(\s*bonus_balance/i.test(body)) continue;
        // First ~200 chars of body should contain the middleware list
        const header = body.slice(0, 300);
        if (!/\bbonusGuard\b/.test(header)) {
            const match = header.match(/['"]([^'"]+)['"]/);
            offenders.push(`${verb} ${match ? match[1] : '(unknown path)'}`);
        }
    }
    assert(offenders.length === 0, `user.routes.js bonus-credit routes missing bonusGuard:\n  ${offenders.join('\n  ')}`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== Stripe deposit flow is wired into production ===');
// ══════════════════════════════════════════════════════════════════════
const INDEX_SRC = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
const SANITIZE_SRC = fs.readFileSync(path.join(SERVER_DIR, 'middleware', 'sanitize.js'), 'utf8');

test('stripe-checkout router is mounted in index.js', () => {
    assert(
        /app\.use\(\s*['"]\/api['"]\s*,\s*require\(['"]\.\/routes\/stripe-checkout\.routes['"]\)\)/.test(INDEX_SRC),
        'stripe-checkout router must be mounted — otherwise /api/payment/create-checkout + /api/payment/webhook do not exist'
    );
});

test('raw body middleware covers /api/payment/webhook BEFORE express.json()', () => {
    // Find line numbers of the raw-body mount for /api/payment/webhook and the global json parser
    const lines = INDEX_SRC.split('\n');
    const rawIdx = lines.findIndex(l => /app\.use\(\s*['"]\/api\/payment\/webhook['"]\s*,\s*express\.raw\(/.test(l));
    const jsonIdx = lines.findIndex(l => /app\.use\(\s*express\.json\(/.test(l));
    assert(rawIdx >= 0, 'raw body middleware not mounted for /api/payment/webhook');
    assert(jsonIdx >= 0, 'express.json() not found');
    assert(rawIdx < jsonIdx, 'raw body must be mounted BEFORE express.json()');
});

test('sanitize middleware skips Buffer bodies (preserves Stripe webhook payload)', () => {
    assert(
        /!\s*Buffer\.isBuffer\s*\(\s*req\.body\s*\)/.test(SANITIZE_SRC),
        'sanitize middleware must skip Buffer bodies'
    );
    // Simulate the middleware behaviour by requiring it
    const sanitizeMiddleware = require(path.join(SERVER_DIR, 'middleware', 'sanitize'));
    const buf = Buffer.from('{"type":"checkout.session.completed"}', 'utf8');
    const req = { body: buf, query: {}, params: {} };
    const res = {};
    let called = false;
    sanitizeMiddleware(req, res, () => { called = true; });
    assert(called, 'middleware should call next()');
    assert(Buffer.isBuffer(req.body), 'Buffer body must remain a Buffer after sanitize');
    assert(req.body.toString('utf8') === '{"type":"checkout.session.completed"}', 'Buffer contents must be preserved');
});

test('CSRF middleware exempts /api/payment/webhook', () => {
    const csrfSrc = fs.readFileSync(path.join(SERVER_DIR, 'middleware', 'csrf.js'), 'utf8');
    assert(
        /\^\\\/api\\\/payment\\\/webhook\$/.test(csrfSrc),
        'csrf middleware must exempt /api/payment/webhook'
    );
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== config wagering multipliers match CLAUDE.md ===');
// ══════════════════════════════════════════════════════════════════════
const CONFIG = require(path.join(SERVER_DIR, 'config'));

test('FIRST_DEPOSIT_WAGERING_MULT is 45x (CLAUDE.md)', () => {
    assertEq(CONFIG.FIRST_DEPOSIT_WAGERING_MULT, 45, 'CLAUDE.md mandates 45x first-deposit wagering');
});

test('RELOAD_WAGERING_MULT is 30x (CLAUDE.md deposit match/retention)', () => {
    assertEq(CONFIG.RELOAD_WAGERING_MULT, 30, 'CLAUDE.md mandates 30x for deposit match/retention');
});

test('SESSION_WIN_CAP is a positive finite number', () => {
    assert(Number.isFinite(CONFIG.SESSION_WIN_CAP) && CONFIG.SESSION_WIN_CAP > 0, 'SESSION_WIN_CAP must be > 0');
});

test('MAX_WIN_MULTIPLIER is a positive finite number', () => {
    assert(Number.isFinite(CONFIG.MAX_WIN_MULTIPLIER) && CONFIG.MAX_WIN_MULTIPLIER > 0, 'MAX_WIN_MULTIPLIER must be > 0');
});

test('TARGET_RTP is between 0 and 1 exclusive of both ends', () => {
    assert(CONFIG.TARGET_RTP > 0 && CONFIG.TARGET_RTP < 1, 'TARGET_RTP must be in (0,1)');
});

test('PROFIT_FLOOR is negative (house can run red before emergency)', () => {
    assert(CONFIG.PROFIT_FLOOR <= 0, 'PROFIT_FLOOR should be ≤ 0');
});

test('config uses real env values in production (no dev fallbacks)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'config.js'), 'utf8');
    // Must have requireEnv-style check for JWT_SECRET that exits in production
    assert(
        /process\.exit\(1\)/.test(src) && /NODE_ENV[^}]*production/.test(src),
        'config.js must exit if critical env vars are missing in production'
    );
    assert(/JWT_SECRET/.test(src), 'JWT_SECRET must be in config');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== degraded-mode guard protects money ops ===');
// ══════════════════════════════════════════════════════════════════════
test('degraded-mode middleware exists and exports degradedModeGuard', () => {
    const mod = require(path.join(SERVER_DIR, 'middleware', 'degraded-mode'));
    assert(typeof mod.degradedModeGuard === 'function', 'degradedModeGuard must be exported as a function');
});

test('degraded-mode middleware returns 503 when db.isDegraded() is true', () => {
    // Mock db.isDegraded by monkey-patching the database module's cache
    const dbPath = require.resolve(path.join(SERVER_DIR, 'database'));
    const origExports = require.cache[dbPath] ? require.cache[dbPath].exports : null;
    const guardPath = require.resolve(path.join(SERVER_DIR, 'middleware', 'degraded-mode'));
    // Clear the cached middleware so it picks up our mock
    delete require.cache[guardPath];
    // Install mock
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { isDegraded: () => true } };

    const { degradedModeGuard } = require(path.join(SERVER_DIR, 'middleware', 'degraded-mode'));
    let statusCode = 200;
    let body = null;
    const res = {
        status(c) { statusCode = c; return this; },
        json(b) { body = b; return this; },
    };
    let nextCalled = false;
    degradedModeGuard({}, res, () => { nextCalled = true; });

    // Restore
    require.cache[dbPath] = origExports ? { id: dbPath, filename: dbPath, loaded: true, exports: origExports } : require.cache[dbPath];
    delete require.cache[guardPath];

    assertEq(statusCode, 503, 'must return 503 when degraded');
    assert(body && body.code === 'db_degraded', 'body must carry code: db_degraded');
    assert(!nextCalled, 'next() must NOT be called when degraded');
});

test('degraded-mode middleware is applied to all money routes in index.js', () => {
    const needed = [
        '/api/payment/deposit',
        '/api/payment/withdraw',
        '/api/payment/create-checkout',
        '/api/crypto/verify-deposit',
        '/api/balance/deposit',
        '/api/bundles/purchase',
        '/api/matrix-money/purchase',
        '/api/matrix-money/withdraw',
    ];
    for (const p of needed) {
        const re = new RegExp(`app\\.use\\(\\s*['"]${p.replace(/\//g, '\\/')}['"]\\s*,\\s*degradedModeGuard\\)`);
        assert(re.test(INDEX_SRC), `missing degradedModeGuard on ${p}`);
    }
});

test('degraded-mode guard NOT applied to /api/payment/webhook (Stripe must retry)', () => {
    const re = /app\.use\(\s*['"]\/api\/payment\/webhook['"][^)]*degradedModeGuard/;
    assert(!re.test(INDEX_SRC), '/api/payment/webhook must NOT use degradedModeGuard — breaks Stripe retry');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== rate limits on money routes ===');
// ══════════════════════════════════════════════════════════════════════
test('create-checkout endpoint has paymentLimiter + userPaymentLimit', () => {
    assert(/app\.use\(\s*['"]\/api\/payment\/create-checkout['"]\s*,\s*paymentLimiter/.test(INDEX_SRC),
        'create-checkout needs per-IP paymentLimiter');
    assert(/app\.use\(\s*['"]\/api\/payment\/create-checkout['"]\s*,\s*userPaymentLimit/.test(INDEX_SRC),
        'create-checkout needs per-user userPaymentLimit');
});

test('paymentLimiter cap is ≤ 10/min (strict for money routes)', () => {
    const m = INDEX_SRC.match(/const\s+paymentLimiter\s*=\s*rateLimit\(\{[\s\S]*?max:\s*(\d+)/);
    assert(m, 'paymentLimiter definition not found');
    const max = parseInt(m[1], 10);
    assert(max > 0 && max <= 10, `paymentLimiter max should be ≤ 10/min (got ${max})`);
});

test('auth rate limits are strict enough to stop credential stuffing', () => {
    // authLimiter declaration is multi-line:
    //   const authLimiter = rateLimit({
    //       windowMs: 15 * 60 * 1000,
    //       max: 20,
    //       ...
    //   });
    const m = INDEX_SRC.match(/const\s+authLimiter\s*=\s*rateLimit\(\{[\s\S]*?windowMs:\s*([^,\n]+),[\s\S]*?max:\s*(\d+)/);
    assert(m, 'authLimiter definition not found');
    const windowExpr = m[1].trim();
    const windowMs = windowExpr.split('*').reduce((a, b) => a * parseFloat(b.trim()), 1);
    const max = parseInt(m[2], 10);
    const ratePerMin = max / (windowMs / 60000);
    // 2 attempts per minute is acceptable (we run 20/15min = 1.33/min)
    assert(ratePerMin <= 2, `auth rate limit too permissive: ${ratePerMin.toFixed(2)}/min > 2/min`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== stripe-checkout first-deposit bonus uses config multipliers ===');
// ══════════════════════════════════════════════════════════════════════
const STRIPE_CHECKOUT_SRC = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'stripe-checkout.routes.js'), 'utf8');

test('stripe-checkout reads FIRST_DEPOSIT_WAGERING_MULT from config (not hardcoded)', () => {
    assert(/config\.FIRST_DEPOSIT_WAGERING_MULT/.test(STRIPE_CHECKOUT_SRC),
        'stripe-checkout must use config.FIRST_DEPOSIT_WAGERING_MULT');
});

test('stripe-checkout reads RELOAD_WAGERING_MULT from config (not hardcoded)', () => {
    assert(/config\.RELOAD_WAGERING_MULT/.test(STRIPE_CHECKOUT_SRC),
        'stripe-checkout must use config.RELOAD_WAGERING_MULT');
});

test('stripe-checkout uses session.amount_total (not metadata) for credited amount', () => {
    assert(/session\.amount_total/.test(STRIPE_CHECKOUT_SRC),
        'stripe-checkout must verify charged amount from Stripe, not metadata');
});

test('stripe-checkout idempotency check fails CLOSED on DB error', () => {
    // Look for the critical idempotency catch block — must return 5xx not silently continue
    assert(
        /CRITICAL:\s*Idempotency check failed/i.test(STRIPE_CHECKOUT_SRC),
        'stripe-checkout must fail-closed on idempotency DB errors'
    );
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== shared deposit-checks service (RG + velocity) ===');
// ══════════════════════════════════════════════════════════════════════
const depositChecksMod = require(path.join(SERVER_DIR, 'services', 'deposit-checks.service'));

test('deposit-checks service exports the full public API', () => {
    ['checkExclusion', 'checkDepositLimits', 'checkDepositVelocity', 'runAllChecks'].forEach(fn => {
        assert(typeof depositChecksMod[fn] === 'function', `deposit-checks must export ${fn}`);
    });
});

test('runAllChecks short-circuits on exclusion → limit → velocity order', () => {
    // Source-level verification (module-internal bindings capture by closure,
    // so we verify by reading source rather than monkey-patching exports).
    const src = fs.readFileSync(path.join(SERVER_DIR, 'services', 'deposit-checks.service.js'), 'utf8');
    const body = src.match(/async function runAllChecks[\s\S]+?^}/m);
    assert(body, 'runAllChecks body not found');
    const code = body[0];
    // Order of calls must be: exclusion → limits → velocity
    const idxExcl = code.indexOf('checkExclusion(');
    const idxLim  = code.indexOf('checkDepositLimits(');
    const idxVel  = code.indexOf('checkDepositVelocity(');
    assert(idxExcl >= 0 && idxLim >= 0 && idxVel >= 0, 'all three checks must be called');
    assert(idxExcl < idxLim && idxLim < idxVel, 'call order must be exclusion → limits → velocity');
    // Each failure must short-circuit (early return)
    const shortCircuitReturns = (code.match(/return \{\s*allowed:\s*false/g) || []).length;
    assert(shortCircuitReturns >= 3, `must have 3 short-circuit returns (got ${shortCircuitReturns})`);
});

test('stripe-checkout uses shared depositChecks.runAllChecks', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'stripe-checkout.routes.js'), 'utf8');
    assert(/require\(['"]\.\.\/services\/deposit-checks\.service['"]\)/.test(src), 'stripe-checkout must import deposit-checks');
    assert(/depositChecks\.runAllChecks/.test(src), 'stripe-checkout must call runAllChecks');
});

test('matrix-money purchase uses shared depositChecks.runAllChecks', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'matrix-money.routes.js'), 'utf8');
    assert(/require\(['"]\.\.\/services\/deposit-checks\.service['"]\)/.test(src), 'matrix-money must import deposit-checks');
    assert(/depositChecks\.runAllChecks/.test(src), 'matrix-money must call runAllChecks');
});

test('payment.routes delegates to shared deposit-checks service', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');
    assert(/depositChecks\.checkExclusion|depositChecks\.checkDepositLimits|depositChecks\.checkDepositVelocity/.test(src),
        'payment.routes must delegate to shared deposit-checks');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== bundle purchase endpoint is disabled (revenue leak fix) ===');
// ══════════════════════════════════════════════════════════════════════
test('/api/bundles/purchase returns 501 until Stripe integration lands', () => {
    // Check that the endpoint source returns 501 with the documented code
    const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const bundleHandler = src.match(/app\.post\(\s*['"]\/api\/bundles\/purchase['"][\s\S]+?\n\}\);/);
    assert(bundleHandler, 'bundle purchase endpoint not found');
    assert(/status\(501\)/.test(bundleHandler[0]), 'bundle purchase must return 501 (not 200/400)');
    assert(/bundles_disabled_pending_payment_integration/.test(bundleHandler[0]), 'response must include documented code');
    // Strip comment lines before checking for purchaseBundle call
    const codeOnly = bundleHandler[0].split('\n')
        .filter(line => !/^\s*\/\//.test(line))
        .join('\n');
    assert(!/purchaseBundle\s*\(/.test(codeOnly), 'handler code must NOT credit bundle until Stripe is wired');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== admin routes require auth + admin role ===');
// ══════════════════════════════════════════════════════════════════════
test('admin.routes.js uses router.use(authenticate, requireAdmin) at top', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    assert(/router\.use\(\s*authenticate\s*,\s*requireAdmin\s*\)/.test(src),
        'admin.routes.js must enforce authenticate + requireAdmin at router level');
});

test('admin-withdrawals.routes.js uses router.use(authenticate, requireAdmin)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin-withdrawals.routes.js'), 'utf8');
    assert(/router\.use\(\s*authenticate\s*,\s*requireAdmin\s*\)/.test(src),
        'admin-withdrawals.routes.js must enforce authenticate + requireAdmin at router level');
});

test('KYC approve + reject endpoints exist on admin.routes', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    assert(/router\.post\(\s*['"]\/kyc-approve['"]/.test(src), 'admin must expose POST /kyc-approve');
    assert(/router\.post\(\s*['"]\/kyc-reject['"]/.test(src), 'admin must expose POST /kyc-reject');
    assert(/router\.get\(\s*['"]\/kyc-pending['"]/.test(src), 'admin must expose GET /kyc-pending');
});

test('withdrawal approve + deny endpoints are atomic (no double-approve race)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin-withdrawals.routes.js'), 'utf8');
    // Both must use WHERE id = ? AND status = 'pending' for atomic claim
    const approveMatch = src.match(/router\.post\(\s*['"]\/withdrawals\/:id\/approve['"][\s\S]+?^\}\);/m);
    assert(approveMatch, 'approve endpoint not found');
    assert(/WHERE id = \? AND status = 'pending'/.test(approveMatch[0]), 'approve must use atomic claim');

    const denyMatch = src.match(/router\.post\(\s*['"]\/withdrawals\/:id\/deny['"][\s\S]+?^\}\);/m);
    assert(denyMatch, 'deny endpoint not found');
    assert(/WHERE id = \? AND status = 'pending'/.test(denyMatch[0]), 'deny must use atomic claim');
});

test('admin.routes /withdrawals/:id/approve is atomic (no TOCTOU double-process)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    const approveMatch = src.match(/router\.post\(\s*['"]\/withdrawals\/:id\/approve['"][\s\S]+?^\}\);/m);
    assert(approveMatch, '/withdrawals/:id/approve not found in admin.routes.js');
    // Atomic claim must be status-guarded; post-OTP-enforcement this accepts
    // both 'pending' and 'otp_verified'.
    assert(
        /WHERE id = \? AND status IN \('pending', 'otp_verified'\)/.test(approveMatch[0]),
        '/withdrawals/:id/approve must use status-guarded claim (pending OR otp_verified)'
    );
    assert(/status\(409\)/.test(approveMatch[0]), 'approve must return 409 when claim loses race');
});

test('admin.routes /withdrawals/:id/reject is atomic — no double-refund race', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    const rejectMatch = src.match(/router\.post\(\s*['"]\/withdrawals\/:id\/reject['"][\s\S]+?^\}\);/m);
    assert(rejectMatch, '/withdrawals/:id/reject not found in admin.routes.js');
    const body = rejectMatch[0];
    // Claim must be status-guarded and precede balance refund.
    const claimIdx  = body.search(/WHERE id = \? AND status IN \('pending', 'otp_verified'\)/);
    const refundIdx = body.search(/UPDATE users SET balance = balance \+ \?/);
    assert(claimIdx >= 0, '/reject must use atomic status-guarded claim');
    assert(refundIdx >= 0, '/reject must refund balance atomically');
    assert(claimIdx < refundIdx, 'claim MUST precede refund — otherwise concurrent rejects double-refund');
    assert(/status\(409\)/.test(body), 'reject must return 409 when claim loses race');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== Stripe chargeback / dispute / refund handlers ===');
// ══════════════════════════════════════════════════════════════════════
const STRIPE_CHECKOUT_SRC_FULL = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'stripe-checkout.routes.js'), 'utf8');

test('webhook handles charge.dispute.created (chargeback)', () => {
    assert(/event\.type\s*===?\s*['"]charge\.dispute\.created['"]/.test(STRIPE_CHECKOUT_SRC_FULL),
        'webhook must handle charge.dispute.created');
});

test('webhook handles charge.dispute.funds_withdrawn', () => {
    assert(/charge\.dispute\.funds_withdrawn/.test(STRIPE_CHECKOUT_SRC_FULL),
        'webhook must handle charge.dispute.funds_withdrawn');
});

test('webhook handles charge.refunded', () => {
    assert(/event\.type\s*===?\s*['"]charge\.refunded['"]/.test(STRIPE_CHECKOUT_SRC_FULL),
        'webhook must handle charge.refunded');
});

test('webhook handles payment_intent.payment_failed', () => {
    assert(/event\.type\s*===?\s*['"]payment_intent\.payment_failed['"]/.test(STRIPE_CHECKOUT_SRC_FULL),
        'webhook must handle payment_intent.payment_failed');
});

test('chargeback handler freezes account (is_banned = 1)', () => {
    // Find the chargeback block
    const disputeIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.dispute.created');
    const refundIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.refunded');
    assert(disputeIdx > 0 && refundIdx > disputeIdx, 'ordering check');
    const disputeBlock = STRIPE_CHECKOUT_SRC_FULL.slice(disputeIdx, refundIdx);
    assert(/is_banned\s*=\s*1/.test(disputeBlock),
        'chargeback handler must set is_banned = 1');
});

test('chargeback handler clamps balance at 0 (cannot go negative)', () => {
    const disputeIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.dispute.created');
    const refundIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.refunded');
    const disputeBlock = STRIPE_CHECKOUT_SRC_FULL.slice(disputeIdx, refundIdx);
    assert(/WHEN balance - \? < 0 THEN 0/.test(disputeBlock),
        'chargeback claw-back must clamp at 0 to preserve atomic invariant');
});

test('chargeback handler wraps claw-back + freeze + tx log in DB transaction', () => {
    const disputeIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.dispute.created');
    const refundIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.refunded');
    const disputeBlock = STRIPE_CHECKOUT_SRC_FULL.slice(disputeIdx, refundIdx);
    assert(/beginTransaction\(\)/.test(disputeBlock), 'chargeback must use a DB transaction');
    assert(/commit\(\)/.test(disputeBlock), 'chargeback must commit');
    assert(/rollback/.test(disputeBlock), 'chargeback must rollback on error');
});

test('chargeback handler is idempotent (Stripe retries do NOT double-clawback)', () => {
    const disputeIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.dispute.created');
    const refundIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.refunded');
    const disputeBlock = STRIPE_CHECKOUT_SRC_FULL.slice(disputeIdx, refundIdx);
    // Must check for an existing chargeback transaction BEFORE clawing back
    assert(
        /type\s*=\s*['"]chargeback['"][\s\S]{0,200}reference LIKE/.test(disputeBlock) ||
        /alreadyClawedBack/.test(disputeBlock),
        'chargeback handler must check for duplicate DISPUTE-id before processing'
    );
});

test('refund handler is idempotent (duplicate webhook does NOT double-debit)', () => {
    const refundIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.refunded');
    const failedIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('payment_intent.payment_failed');
    const refundBlock = STRIPE_CHECKOUT_SRC_FULL.slice(refundIdx, failedIdx);
    assert(
        /alreadyRefunded/.test(refundBlock) || /type\s*=\s*['"]refund['"][\s\S]{0,100}reference = \?/.test(refundBlock),
        'refund handler must check for duplicate REFUND: reference before processing'
    );
});

test('chargeback handler returns 500 on error so Stripe retries', () => {
    const disputeIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.dispute.created');
    const refundIdx = STRIPE_CHECKOUT_SRC_FULL.indexOf('charge.refunded');
    const disputeBlock = STRIPE_CHECKOUT_SRC_FULL.slice(disputeIdx, refundIdx);
    assert(/status\(500\)/.test(disputeBlock),
        'chargeback handler must return 500 on error — idempotent retry better than silent miss');
});

test('banned_at + banned_reason + fraud_flag columns exist in both schemas', () => {
    const sqlite = fs.readFileSync(path.join(SERVER_DIR, 'db', 'schema-sqlite.js'), 'utf8');
    const pg     = fs.readFileSync(path.join(SERVER_DIR, 'db', 'schema-pg.js'), 'utf8');
    ['banned_at', 'banned_reason', 'fraud_flag', 'fraud_flag_reason'].forEach(col => {
        assert(sqlite.includes(`'${col}'`), `schema-sqlite.js must declare USER_MIGRATION for ${col}`);
        assert(pg.includes(`'${col}'`), `schema-pg.js must declare USER_MIGRATION for ${col}`);
    });
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== wagering_progress atomicity ===');
// ══════════════════════════════════════════════════════════════════════
const SPIN_SRC_FULL = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'spin.routes.js'), 'utf8');

test('wagering_progress increments use atomic MIN()', () => {
    // MIN(progress + bet, requirement) inside a single UPDATE
    assert(/wagering_progress\s*=\s*MIN\(COALESCE\(wagering_progress,\s*0\)\s*\+\s*\?/.test(SPIN_SRC_FULL),
        'wagering_progress increment must be atomic with MIN() to avoid overshoot');
});

test('wagering_progress increment only runs when requirement > 0', () => {
    assert(/COALESCE\(wagering_requirement,\s*0\)\s*>\s*0/.test(SPIN_SRC_FULL),
        'wagering increment must short-circuit when requirement = 0');
});

test('bonus → balance conversion is atomic (zeros out in single UPDATE)', () => {
    // Looking for the canonical conversion SQL
    assert(
        /UPDATE users SET balance = balance \+ bonus_balance,\s*wagering_progress = 0,\s*wagering_requirement = 0,\s*bonus_balance = 0 WHERE id = \? AND bonus_balance > 0/.test(SPIN_SRC_FULL),
        'bonus conversion must be a single atomic UPDATE with bonus_balance > 0 guard'
    );
});

test('free spins do NOT increment wagering_progress (house-funded)', () => {
    // The wagering increment block is wrapped in `if (!usedFreeSpin && bet > 0)`
    assert(/if\s*\(\s*!usedFreeSpin\s*&&\s*bet\s*>\s*0\s*\)/.test(SPIN_SRC_FULL),
        'wagering block must skip free-spin bets');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== balance reconciliation script ===');
// ══════════════════════════════════════════════════════════════════════
test('scripts/reconcile-balances.js exists and exports a main()', () => {
    const reconcilePath = path.join(__dirname, '..', 'scripts', 'reconcile-balances.js');
    assert(fs.existsSync(reconcilePath), 'reconciliation script must exist');
    const src = fs.readFileSync(reconcilePath, 'utf8');
    assert(/async function main\(\)/.test(src), 'script must define main()');
    assert(/BALANCE_TX_TYPES/.test(src), 'script must enumerate balance-affecting transaction types');
    assert(/process\.exit\(/.test(src), 'script must exit with status code');
});

test('reconciliation script exits non-zero when drift ≥ $1 detected', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reconcile-balances.js'), 'utf8');
    // Look for the serious-drift exit logic
    assert(/serious\s*>\s*0/.test(src), 'must exit non-zero on serious drift');
    assert(/Math\.abs\(.*drift.*\)\s*>=\s*1/.test(src), 'serious threshold must be |drift| ≥ $1');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== admin UI backing endpoints exist ===');
// ══════════════════════════════════════════════════════════════════════
test('admin.routes exposes GET /users/search', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    assert(/router\.get\(\s*['"]\/users\/search['"]/.test(src), 'admin must expose GET /users/search for the admin UI');
});

test('admin.routes exposes GET /stats/24h', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    assert(/router\.get\(\s*['"]\/stats\/24h['"]/.test(src), 'admin must expose GET /stats/24h for the admin UI');
});

test('admin UI file exists and avoids innerHTML with interpolated data', () => {
    const adminIndex = path.join(__dirname, '..', 'admin', 'index.html');
    assert(fs.existsSync(adminIndex), 'admin/index.html must exist');
    const html = fs.readFileSync(adminIndex, 'utf8');
    // Must NOT have template literals writing into innerHTML with user data
    // (safe DOM construction via el()/textContent only)
    assert(!/innerHTML\s*=\s*`[^`]*\$\{/.test(html),
        'admin UI must not interpolate into innerHTML (XSS risk)');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== signup enforces age 18+ and terms acceptance ===');
// ══════════════════════════════════════════════════════════════════════
test('register endpoint requires dateOfBirth and blocks under-18', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    assert(/age\s*<\s*18/.test(src), 'auth.routes must block age < 18');
    assert(/You must be 18/.test(src), 'register must show 18+ error message');
});

test('register endpoint requires terms acceptance', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    assert(/acceptTerms/.test(src), 'auth.routes must require acceptTerms');
    assert(/Terms & Conditions/.test(src), 'register must show terms message');
});

test('passwords are hashed with bcrypt rounds >= 12', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    const m = src.match(/bcrypt\.hashSync\(\s*password\s*,\s*(\d+)/);
    assert(m, 'bcrypt.hashSync call not found');
    const rounds = parseInt(m[1], 10);
    assert(rounds >= 12, `bcrypt rounds must be ≥ 12 for production (got ${rounds})`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== email verification flow integrity ===');
// ══════════════════════════════════════════════════════════════════════
test('verify-email requires 64-char hex token', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    // The token validator: token.length !== 64 && /^[a-f0-9]+$/
    assert(/token\.length\s*!==?\s*64/.test(src), 'verify-email must require 64-char token');
    assert(/\/\^\[a-f0-9\]\+\$\//.test(src), 'verify-email must require hex-only token');
});

test('verify-email rejects expired tokens', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    assert(/expires_at|expired/.test(src), 'verify-email must check token expiry');
});

test('verify-email is rate-limited (stops enumeration)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    assert(/_verifyEmailAttempts/.test(src), 'verify-email must rate-limit per IP');
});

test('withdraw requires email_verified before processing', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');
    assert(/email_verified/.test(src) && /verify.*email/i.test(src), 'withdraw must require email_verified');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== launch-readiness warnings cover critical env ===');
// ══════════════════════════════════════════════════════════════════════
test('launch-readiness warns on missing Stripe live keys', () => {
    assert(/STRIPE_SECRET_KEY is missing or not a live key/.test(INDEX_SRC), 'must warn on missing STRIPE_SECRET_KEY');
    assert(/STRIPE_WEBHOOK_SECRET is missing/.test(INDEX_SRC), 'must warn on missing STRIPE_WEBHOOK_SECRET');
    assert(/STRIPE_PUBLISHABLE_KEY is missing or not a live key/.test(INDEX_SRC), 'must warn on missing STRIPE_PUBLISHABLE_KEY');
});

test('launch-readiness warns on weak JWT_SECRET', () => {
    assert(/JWT_SECRET is weak/.test(INDEX_SRC), 'must warn on weak JWT_SECRET');
    // Must check length AND dev-default patterns
    assert(/JWT_SECRET.*length\s*<\s*32/.test(INDEX_SRC), 'must check JWT_SECRET length >= 32');
});

test('launch-readiness warns on missing SMTP config', () => {
    assert(/SMTP is not fully configured/.test(INDEX_SRC), 'must warn on missing SMTP');
});

test('launch-readiness warns on missing ADMIN_EMAIL', () => {
    assert(/ADMIN_EMAIL not set/.test(INDEX_SRC), 'must warn on missing ADMIN_EMAIL');
});

test('launch-readiness warns on missing APP_URL', () => {
    assert(/APP_URL missing/.test(INDEX_SRC), 'must warn on missing APP_URL');
});

test('launch-readiness warns on missing DATABASE_URL', () => {
    assert(/DATABASE_URL missing/.test(INDEX_SRC), 'must warn on missing DATABASE_URL');
});

test('launch-readiness warns on missing geo-block config', () => {
    assert(/ALLOWED_COUNTRIES or BLOCKED_COUNTRIES/.test(INDEX_SRC), 'must warn on missing geo config');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== AML (anti-money-laundering) service ===');
// ══════════════════════════════════════════════════════════════════════
const amlMod = require(path.join(SERVER_DIR, 'services', 'aml.service'));

test('AML service exports full public API', () => {
    ['logEvent', 'analyseDeposit', 'analyseWithdrawal', 'getUnreviewedEvents', 'markReviewed'].forEach(fn => {
        assert(typeof amlMod[fn] === 'function', `AML service must export ${fn}`);
    });
    // Thresholds exposed for admin UI
    assert(typeof amlMod.LARGE_TX_THRESHOLD === 'number', 'AML must expose LARGE_TX_THRESHOLD');
    assert(amlMod.LARGE_TX_THRESHOLD >= 10000, 'LARGE_TX_THRESHOLD must be ≥ $10k (standard AML reporting threshold)');
});

test('AML analyseDeposit flags single large transaction', async () => {
    // Validate source-level guard: large deposits hit logEvent('large_deposit', …)
    const src = fs.readFileSync(path.join(SERVER_DIR, 'services', 'aml.service.js'), 'utf8');
    const depositFn = src.match(/async function analyseDeposit[\s\S]+?^}/m);
    assert(depositFn, 'analyseDeposit fn not found');
    assert(/amount\s*>=\s*LARGE_TX_THRESHOLD/.test(depositFn[0]), 'must threshold-check at LARGE_TX_THRESHOLD');
    assert(/['"]large_deposit['"]/.test(depositFn[0]), "must log event type 'large_deposit'");
});

test('AML analyseWithdrawal flags large + rapid-turnaround', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'services', 'aml.service.js'), 'utf8');
    const wdFn = src.match(/async function analyseWithdrawal[\s\S]+?^}/m);
    assert(wdFn, 'analyseWithdrawal fn not found');
    assert(/['"]large_withdrawal['"]/.test(wdFn[0]), "must log 'large_withdrawal'");
    assert(/['"]rapid_turnaround['"]/.test(wdFn[0]), "must log 'rapid_turnaround'");
    assert(/wagerRatio\s*<\s*0\.5/.test(wdFn[0]), 'rapid-turnaround check must require < 50% wagered');
});

test('AML logEvent is fire-and-forget (never throws out)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'services', 'aml.service.js'), 'utf8');
    const logFn = src.match(/async function logEvent[\s\S]+?^}/m);
    assert(logFn, 'logEvent fn not found');
    // try/catch must surround the INSERT so AML logging never fails money ops
    assert(/try\s*\{[\s\S]*INSERT[\s\S]*\}\s*catch/.test(logFn[0]),
        'logEvent must wrap INSERT in try/catch so AML never blocks money ops');
});

test('Stripe deposit webhook calls aml.analyseDeposit', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'stripe-checkout.routes.js'), 'utf8');
    assert(/aml\.analyseDeposit\(/.test(src), 'stripe webhook must call aml.analyseDeposit on success');
});

test('Withdraw route calls aml.analyseWithdrawal', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');
    assert(/aml\.analyseWithdrawal\(/.test(src), 'withdraw route must call aml.analyseWithdrawal');
});

test('admin.routes exposes GET /aml-events + POST /aml-events/:id/review', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    assert(/router\.get\(\s*['"]\/aml-events['"]/.test(src), 'admin must expose GET /aml-events');
    assert(/router\.post\(\s*['"]\/aml-events\/:id\/review['"]/.test(src), 'admin must expose POST /aml-events/:id/review');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== session reality-check ===');
// ══════════════════════════════════════════════════════════════════════
test('/api/session/reality-check endpoint exists', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'session.routes.js'), 'utf8');
    assert(/router\.get\(\s*['"]\/reality-check['"]/.test(src), 'session.routes must expose GET /reality-check');
});

test('reality-check returns spins / wagered / won / net', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'session.routes.js'), 'utf8');
    // Look for the response shape fields
    ['sessionMinutes', 'spins', 'totalWagered', 'totalWon', 'netResult', 'dueReminder'].forEach(k => {
        assert(new RegExp(k).test(src), `reality-check response must include ${k}`);
    });
});

test('reality-check default interval is 60 minutes', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'session.routes.js'), 'utf8');
    assert(/let\s+interval\s*=\s*60/.test(src), 'default reality-check interval must be 60 minutes');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== JWT + logout security ===');
// ══════════════════════════════════════════════════════════════════════
test('logout blacklists the JWT', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    assert(/blacklistToken\(req\.token\)/.test(src), 'logout must call blacklistToken(req.token)');
});

test('authenticate middleware rejects blacklisted tokens', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'middleware', 'auth.js'), 'utf8');
    assert(/if\s*\(\s*isBlacklisted\(token\)\s*\)[\s\S]{0,100}Token has been revoked/.test(src),
        'authenticate must 401 blacklisted tokens');
});

test('authenticate invalidates tokens issued before password change', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'middleware', 'auth.js'), 'utf8');
    assert(/payload\.iat\s*<\s*user\.password_changed_at/.test(src),
        'tokens with iat < password_changed_at must be rejected');
});

test('JWT algorithm is pinned to HS256 (no algorithm confusion)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'middleware', 'auth.js'), 'utf8');
    assert(/algorithms:\s*\[\s*['"]HS256['"]\s*\]/.test(src),
        'jwt.verify must pin algorithms: [HS256] to prevent alg=none attacks');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== responsible-gambling limit increase cooling-off ===');
// ══════════════════════════════════════════════════════════════════════
test('limit decreases apply immediately, increases require 24h cooling-off', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');
    // The PUT /limits logic distinguishes isIncrease vs immediate
    assert(/isIncrease/.test(src), 'must distinguish increase vs decrease');
    assert(/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src), 'increases must be delayed 24h');
    assert(/pendingIncreases/.test(src), 'pending increases must be tracked');
});

test('self-exclusion period validated against COOLING_OFF_PERIODS config', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');
    assert(/config\.COOLING_OFF_PERIODS\.includes\(period\)/.test(src),
        'self-exclude must validate period is in config.COOLING_OFF_PERIODS');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== terms-of-service versioning ===');
// ══════════════════════════════════════════════════════════════════════
test('config declares CURRENT_TERMS_VERSION (env-overridable)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'config.js'), 'utf8');
    assert(/CURRENT_TERMS_VERSION:/.test(src), 'config must declare CURRENT_TERMS_VERSION');
    assert(/process\.env\.TERMS_VERSION/.test(src), 'CURRENT_TERMS_VERSION must be env-overridable');
});

test('users.terms_version column declared in both schemas', () => {
    const sqlite = fs.readFileSync(path.join(SERVER_DIR, 'db', 'schema-sqlite.js'), 'utf8');
    const pg = fs.readFileSync(path.join(SERVER_DIR, 'db', 'schema-pg.js'), 'utf8');
    assert(/'terms_version'/.test(sqlite), 'schema-sqlite.js must declare terms_version USER_MIGRATION');
    assert(/'terms_version'/.test(pg), 'schema-pg.js must declare terms_version USER_MIGRATION');
});

test('register stores terms_version at signup', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
    assert(/terms_version/.test(src), 'register must set terms_version on new user');
    assert(/config\.CURRENT_TERMS_VERSION/.test(src),
        'register must read from config.CURRENT_TERMS_VERSION (not hardcoded)');
});

test('user.routes exposes /terms-status + /accept-terms', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    assert(/router\.get\(\s*['"]\/terms-status['"]/.test(src), 'must expose GET /terms-status');
    assert(/router\.post\(\s*['"]\/accept-terms['"]/.test(src), 'must expose POST /accept-terms');
});

test('/terms-status reports needsReacceptance correctly', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    // Look for the needsReacceptance logic: accepted < current
    assert(/needsReacceptance:\s*accepted\s*<\s*current/.test(src),
        '/terms-status must return needsReacceptance when acceptedVersion < currentVersion');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== GDPR data export (Right of Access) ===');
// ══════════════════════════════════════════════════════════════════════
test('user.routes exposes GET /data-export', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    assert(/router\.get\(\s*['"]\/data-export['"]/.test(src), 'must expose GET /data-export');
    assert(/authenticate/.test(src), 'data-export must be behind authenticate');
});

test('data-export bundles profile + transactions + deposits + withdrawals + verifications', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    const handler = src.match(/router\.get\(\s*['"]\/data-export['"][\s\S]+?^\}\);/m);
    assert(handler, 'data-export handler not found');
    ['profile', 'transactions', 'deposits', 'withdrawals', 'verifications'].forEach(k => {
        assert(new RegExp('\\b' + k + '\\b').test(handler[0]),
            `data-export must include ${k}`);
    });
});

test('data-export response is a downloadable JSON attachment', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    const handler = src.match(/router\.get\(\s*['"]\/data-export['"][\s\S]+?^\}\);/m);
    assert(handler, 'handler not found');
    assert(/Content-Disposition/i.test(handler[0]), 'must set Content-Disposition to force download');
    assert(/attachment/.test(handler[0]), 'must be attachment not inline');
});

test('data-export includes GDPR article metadata', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'user.routes.js'), 'utf8');
    assert(/GDPR Article 15/.test(src),
        'data-export should label itself with GDPR Article 15 (Right of Access)');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== route mounting integrity ===');
// ══════════════════════════════════════════════════════════════════════
// Catch the class of bug where a route file is written but never mounted
// in index.js. Stripe-checkout hit this; fair.routes.js hit it too. We
// allowlist known-utility-only files that legitimately export without
// being mounted.
test('every *.routes.js file is either mounted or on the utility allowlist', () => {
    const UTILITY_ALLOWLIST = new Set([
        // These export helpers that OTHER code requires; they are not
        // themselves express routers that need to be mounted.
        'admin-dashboard.routes.js',   // exports in-memory store helpers
        'nft-deposit.routes.js',       // exports ensureNFTTables() used by stripe-checkout
        'session-insights.routes.js',  // not yet wired; not referenced by client
        'promos.routes.js',            // legacy — superseded by promocode.routes.js
        // admin-withdrawals.routes.js is dead code (superseded by admin.routes.js),
        // but leaving it here would mask real orphans. We explicitly acknowledge
        // it as dead-but-not-yet-deleted:
        'admin-withdrawals.routes.js',
    ]);

    const indexSrc = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const orphans = [];
    const routeFiles = fs.readdirSync(path.join(SERVER_DIR, 'routes'))
        .filter(f => f.endsWith('.routes.js'));

    for (const f of routeFiles) {
        if (UTILITY_ALLOWLIST.has(f)) continue;
        const base = f.replace('.routes.js', '');
        // Match require('./routes/base.routes') OR require('./routes/base')
        const required =
            indexSrc.includes(`./routes/${base}.routes`) ||
            indexSrc.includes(`./routes/${base}'`) ||
            indexSrc.includes(`./routes/${base}"`);
        if (!required) orphans.push(f);
    }

    assert(orphans.length === 0,
        `route files not mounted in index.js (will 404):\n  ${orphans.join('\n  ')}`);
});

test('client-called /api/fair endpoints have a mounted server route', () => {
    const indexSrc = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    assert(/app\.use\(\s*['"]\/api\/fair['"]/.test(indexSrc),
        '/api/fair must be mounted — client ui-slot.js calls /api/fair/seed and /api/fair/verify');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== graceful shutdown + process error handling ===');
// ══════════════════════════════════════════════════════════════════════
test('server handles SIGTERM with graceful DB close', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    assert(/process\.on\('SIGTERM'/.test(src), 'must handle SIGTERM');
    // SIGTERM handler must close the DB backend
    const sigtermMatch = src.match(/process\.on\('SIGTERM'[\s\S]+?\}\);/);
    assert(sigtermMatch, 'SIGTERM handler not found');
    assert(/backend\.close\(\)/.test(sigtermMatch[0]), 'SIGTERM must close DB backend before exit');
});

test('unhandledRejection does NOT exit the process (keeps serving)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const rejectMatch = src.match(/process\.on\(['"]unhandledRejection['"][\s\S]+?\}\);/);
    assert(rejectMatch, 'unhandledRejection handler not found');
    assert(!/process\.exit/.test(rejectMatch[0]),
        'unhandledRejection must NOT exit — log and keep serving');
});

test('uncaughtException exits after logging (Render restarts us)', () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const exMatch = src.match(/process\.on\(['"]uncaughtException['"][\s\S]+?\}\);/);
    assert(exMatch, 'uncaughtException handler not found');
    assert(/process\.exit\(1\)/.test(exMatch[0]),
        'uncaughtException must exit(1) so the process manager restarts us');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== withdrawal OTP end-to-end ===');
// ══════════════════════════════════════════════════════════════════════
const PAYMENT_SRC_FULL = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');

test('config declares WITHDRAWAL_OTP_THRESHOLD (env-overridable)', () => {
    const cfg = fs.readFileSync(path.join(SERVER_DIR, 'config.js'), 'utf8');
    assert(/WITHDRAWAL_OTP_THRESHOLD:/.test(cfg), 'config must declare WITHDRAWAL_OTP_THRESHOLD');
    assert(/process\.env\.WITHDRAWAL_OTP_THRESHOLD/.test(cfg), 'must be env-overridable');
    assert(/WITHDRAWAL_OTP_EXPIRY_MINUTES:/.test(cfg), 'config must declare expiry');
});

test('withdrawals schema has otp_code + otp_attempts + otp_created_at + otp_verified_at', () => {
    const sqlite = fs.readFileSync(path.join(SERVER_DIR, 'db', 'schema-sqlite.js'), 'utf8');
    const pg = fs.readFileSync(path.join(SERVER_DIR, 'db', 'schema-pg.js'), 'utf8');
    ['otp_code', 'otp_attempts', 'otp_created_at', 'otp_verified_at'].forEach(col => {
        assert(sqlite.includes(`'${col}'`), `schema-sqlite WITHDRAWAL_MIGRATIONS must include ${col}`);
        assert(pg.includes(`'${col}'`), `schema-pg WITHDRAWAL_MIGRATIONS must include ${col}`);
    });
});

test('high-value withdrawals GENERATE + email an OTP at request time', () => {
    assert(/withdrawal\s*>=\s*OTP_THRESHOLD/.test(PAYMENT_SRC_FULL),
        'withdraw route must check OTP_THRESHOLD');
    assert(/crypto\.randomBytes\(3\)\.readUIntBE\(0,\s*3\)/.test(PAYMENT_SRC_FULL),
        'OTP must be generated from crypto RNG (3 bytes → 6 digits)');
    assert(/sendWithdrawalOtp/.test(PAYMENT_SRC_FULL),
        'withdraw must call emailService.sendWithdrawalOtp');
});

test('OTP generation uses crypto, never Math.random', () => {
    // Look for the otp_code UPDATE and ensure a crypto.randomBytes call
    // precedes it within a reasonable window.
    const otpUpdateIdx = PAYMENT_SRC_FULL.indexOf('SET otp_code = ?, otp_attempts = 0, otp_created_at');
    assert(otpUpdateIdx > 0, 'OTP UPDATE statement not found');
    const precedingWindow = PAYMENT_SRC_FULL.slice(Math.max(0, otpUpdateIdx - 400), otpUpdateIdx);
    assert(/crypto\.randomBytes\(3\)\.readUIntBE\(0,\s*3\)/.test(precedingWindow),
        'OTP must be generated from crypto.randomBytes(3) (→ 6 digits) immediately before the UPDATE');
});

test('OTP verify enforces expiry from otp_created_at', () => {
    assert(/WITHDRAWAL_OTP_EXPIRY_MINUTES/.test(PAYMENT_SRC_FULL),
        'OTP verify must check expiry');
    assert(/expired/i.test(PAYMENT_SRC_FULL), 'OTP verify must return an expiry error');
});

test('resend-otp endpoint rotates + re-emails', () => {
    assert(/router\.post\(\s*['"]\/withdraw\/:id\/resend-otp['"]/.test(PAYMENT_SRC_FULL),
        'must expose POST /withdraw/:id/resend-otp');
    // Find the actual handler definition (first char of "router.post(...)"),
    // not a comment mention, then take a 2000-char window.
    const resendIdx = PAYMENT_SRC_FULL.search(/router\.post\(\s*['"]\/withdraw\/:id\/resend-otp['"]/);
    assert(resendIdx > 0, 'resend handler not found');
    const window = PAYMENT_SRC_FULL.slice(resendIdx, resendIdx + 2000);
    assert(/crypto\.randomBytes/.test(window), 'resend must rotate the code via crypto.randomBytes');
    assert(/sendWithdrawalOtp/.test(window), 'resend must re-email the code');
});

test('admin approve BLOCKS high-value withdrawals that have not passed OTP', () => {
    const adminSrc = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    const approveBlock = adminSrc.match(/router\.post\(\s*['"]\/withdrawals\/:id\/approve['"][\s\S]+?^\}\);/m);
    assert(approveBlock, 'approve block not found');
    assert(/WITHDRAWAL_OTP_THRESHOLD/.test(approveBlock[0]),
        'admin approve must reference WITHDRAWAL_OTP_THRESHOLD');
    assert(/otpRequired/.test(approveBlock[0]),
        'admin approve must return otpRequired flag when OTP not yet verified');
});

test('admin approve/reject accept BOTH pending and otp_verified status', () => {
    const adminSrc = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
    const approveBlock = adminSrc.match(/router\.post\(\s*['"]\/withdrawals\/:id\/approve['"][\s\S]+?^\}\);/m);
    const rejectBlock = adminSrc.match(/router\.post\(\s*['"]\/withdrawals\/:id\/reject['"][\s\S]+?^\}\);/m);
    assert(approveBlock && rejectBlock, 'both blocks found');
    assert(/status IN \('pending', 'otp_verified'\)/.test(approveBlock[0]),
        'approve must accept both pending and otp_verified');
    assert(/status IN \('pending', 'otp_verified'\)/.test(rejectBlock[0]),
        'reject must accept both pending and otp_verified');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== password strength + breach blocklist ===');
// ══════════════════════════════════════════════════════════════════════
const AUTH_SRC_FULL = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');

test('validatePassword rejects common breach-list passwords', () => {
    assert(/COMMON_PASSWORDS/.test(AUTH_SRC_FULL), 'must maintain a COMMON_PASSWORDS set');
    // Must include the obvious suspects
    ['password', 'password123', 'qwerty123', 'letmein1'].forEach(p => {
        assert(new RegExp(`['"]${p}['"]`).test(AUTH_SRC_FULL),
            `COMMON_PASSWORDS must include "${p}"`);
    });
});

test('validatePassword rejects passwords containing username / email', () => {
    assert(/must not contain your username/.test(AUTH_SRC_FULL),
        'must reject password containing username');
    assert(/must not contain your email/.test(AUTH_SRC_FULL),
        'must reject password containing email local-part');
});

test('validatePassword caps length at 128 chars', () => {
    assert(/no more than 128 characters/.test(AUTH_SRC_FULL),
        'must reject passwords > 128 chars (bcrypt denial-of-service guard)');
});

test('register, reset-password, change-password all pass identity context', () => {
    // Register: validatePassword(password, { username, email })
    assert(/validatePassword\(password,\s*\{\s*username,\s*email\s*\}\)/.test(AUTH_SRC_FULL),
        'register must pass { username, email } to validatePassword');
    // Reset + change both have similar patterns
    assert(/validatePassword\(newPassword,\s*\{\s*username:/.test(AUTH_SRC_FULL),
        'reset-password + change-password must pass identity context');
});

test('reset-password bumps password_changed_at (invalidates existing tokens)', () => {
    const resetIdx = AUTH_SRC_FULL.indexOf("router.post('/reset-password'");
    assert(resetIdx > 0, 'reset-password handler not found');
    const window = AUTH_SRC_FULL.slice(resetIdx, resetIdx + 2500);
    assert(/password_changed_at\s*=\s*\?/.test(window),
        'reset-password must bump password_changed_at so old JWTs are invalidated');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== idle-session timeout ===');
// ══════════════════════════════════════════════════════════════════════
const idleMod = require(path.join(SERVER_DIR, 'middleware', 'idle-timeout'));

test('idle-timeout middleware is exported + mounted globally after optionalAuth', () => {
    assert(typeof idleMod.idleTimeoutMiddleware === 'function', 'must export idleTimeoutMiddleware');
    const indexSrc = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    assert(/app\.use\(idleTimeoutMiddleware\)/.test(indexSrc),
        'idleTimeoutMiddleware must be mounted globally');
    // Must run AFTER optionalAuth (so req.user is populated)
    const optIdx = indexSrc.indexOf('app.use(optionalAuth)');
    const idleIdx = indexSrc.indexOf('app.use(idleTimeoutMiddleware)');
    assert(optIdx > 0 && idleIdx > optIdx, 'idle middleware must come after optionalAuth');
});

test('idle timeout default is reasonable (15–60 min)', () => {
    assert(idleMod.IDLE_TIMEOUT_MINUTES >= 15 && idleMod.IDLE_TIMEOUT_MINUTES <= 60,
        `IDLE_TIMEOUT_MINUTES should be 15–60 (got ${idleMod.IDLE_TIMEOUT_MINUTES})`);
});

test('idle middleware is a no-op for unauthenticated requests', () => {
    idleMod._reset();
    const { idleTimeoutMiddleware } = idleMod;
    let nextCalled = false;
    const res = { status() { return this; }, json() { return this; } };
    idleTimeoutMiddleware({}, res, () => { nextCalled = true; });
    assert(nextCalled, 'must call next() when req.user absent');
});

test('idle middleware bumps timestamp on active request (first-seen, then next tick)', () => {
    idleMod._reset();
    const { idleTimeoutMiddleware } = idleMod;
    let nextCalled = false;
    const req = { user: { id: 42 } };
    const res = { status() { return this; }, json() { return this; } };

    idleTimeoutMiddleware(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'first request must pass through');
    const t1 = idleMod._getLastSeen(42);
    assert(t1 != null, 'lastSeen should be recorded');

    // Second request a moment later — still active, still passes
    nextCalled = false;
    idleTimeoutMiddleware(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'subsequent request must pass through');
    const t2 = idleMod._getLastSeen(42);
    assert(t2 >= t1, 'lastSeen must be bumped (non-decreasing)');
    idleMod._reset();
});

test('idle middleware rejects request when idle > timeout', () => {
    idleMod._reset();
    const { idleTimeoutMiddleware, IDLE_TIMEOUT_MS } = idleMod;
    const req = { user: { id: 99 } };
    let statusCode = 200, body = null, nextCalled = false;
    const res = {
        status(c) { statusCode = c; return this; },
        json(b) { body = b; return this; },
    };

    // Seed lastSeen to (timeout + 1s) ago
    idleTimeoutMiddleware(req, res, () => { nextCalled = true; });
    // Now manually rewind the timestamp in the map
    // Use the private reset + reseed trick by reaching into the module
    const oldSeen = Date.now() - (IDLE_TIMEOUT_MS + 1000);
    // There's no public setter — use a fresh hack: reset, then set via the
    // internal map on a reimport? Instead simulate by directly manipulating
    // internal state through reset → re-call with a patched Date.now.
    const realNow = Date.now;
    Date.now = () => oldSeen;
    idleMod._reset();
    idleTimeoutMiddleware(req, res, () => {});  // seed at oldSeen
    Date.now = realNow;

    // Now a fresh request — idle > timeout should 401
    nextCalled = false;
    idleTimeoutMiddleware(req, res, () => { nextCalled = true; });
    assertEq(statusCode, 401, 'idle session must return 401');
    assert(body && body.code === 'session_idle', 'body must carry code: session_idle');
    assert(!nextCalled, 'next() must NOT be called on idle timeout');
    idleMod._reset();
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== parallel-review fixes (round 63) ===');
// ══════════════════════════════════════════════════════════════════════
const ADMIN_SRC_R63 = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'admin.routes.js'), 'utf8');
const AUTH_SRC_R63  = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'auth.routes.js'), 'utf8');
const PAY_SRC_R63   = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'payment.routes.js'), 'utf8');
const STRIPE_SRC_R63 = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'stripe-checkout.routes.js'), 'utf8');
const CRYPTO_SRC_R63 = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'crypto.routes.js'), 'utf8');
const IDLE_SRC_R63  = fs.readFileSync(path.join(SERVER_DIR, 'middleware', 'idle-timeout.js'), 'utf8');

// F1 — legacy /reject-withdrawal uses atomic status-guarded claim
test('F1: legacy /api/admin/reject-withdrawal uses atomic claim (no double-refund)', () => {
    const block = ADMIN_SRC_R63.match(/router\.post\(\s*['"]\/reject-withdrawal['"][\s\S]+?^\}\);/m);
    assert(block, '/reject-withdrawal handler not found');
    // Must use the same WHERE-status-guarded UPDATE pattern before touching balance
    const claimIdx  = block[0].search(/WHERE id = \? AND status IN \('pending', 'otp_verified'\)/);
    const refundIdx = block[0].search(/UPDATE users SET balance = balance \+ \?/);
    assert(claimIdx >= 0, '/reject-withdrawal must use status-guarded claim');
    assert(refundIdx >= 0, '/reject-withdrawal must refund atomically');
    assert(claimIdx < refundIdx, 'claim MUST precede refund — no double-refund race');
    assert(/status\(409\)/.test(block[0]), 'must 409 when claim loses the race');
});

// F3 — legacy /approve-withdrawal enforces OTP gate
test('F3: legacy /api/admin/approve-withdrawal enforces OTP gate for high-value withdrawals', () => {
    const block = ADMIN_SRC_R63.match(/router\.post\(\s*['"]\/approve-withdrawal['"][\s\S]+?^\}\);/m);
    assert(block, '/approve-withdrawal handler not found');
    assert(/WITHDRAWAL_OTP_THRESHOLD/.test(block[0]),
        '/approve-withdrawal must reference the OTP threshold');
    assert(/otpRequired/.test(block[0]),
        '/approve-withdrawal must surface otpRequired: true when the player has not passed OTP yet');
    assert(/status IN \('pending', 'otp_verified'\)/.test(block[0]),
        '/approve-withdrawal must accept both pending and otp_verified');
});

// F4 — idle-timeout cannot be bypassed by a single throwaway request
test('F4: idle-timeout uses idleRejected flag; rejection persists across retries', () => {
    assert(/idleRejected/.test(IDLE_SRC_R63),
        'idle-timeout middleware must track idleRejected flag');
    // On timeout, must flag instead of delete
    assert(/entry\.idleRejected\s*=\s*true/.test(IDLE_SRC_R63),
        'on timeout must SET entry.idleRejected, not delete the entry');
    // Login must call _reset to clear the flag
    assert(/_reset\(user\.id\)/.test(AUTH_SRC_R63) || /_reset\s*\(\s*user\.id\s*\)/.test(AUTH_SRC_R63),
        'login must call idle-timeout._reset(user.id) on successful authentication');
});

// F7 — orphan /stripe/payment-intent returns 501
test('F7: /api/payment/stripe/payment-intent is disabled (501)', () => {
    const block = PAY_SRC_R63.match(/router\.post\(\s*['"]\/stripe\/payment-intent['"][\s\S]+?\}\);/);
    assert(block, '/stripe/payment-intent handler not found');
    assert(/status\(501\)/.test(block[0]), 'must return 501');
    assert(/payment_intent_disabled_pending_webhook_handler/.test(block[0]),
        'response body must include the documented code');
    // The old handler called stripeService.createPaymentIntent; must NOT anymore
    assert(!/createPaymentIntent\s*\(/.test(block[0]),
        'disabled handler must NOT create any Stripe charges');
});

// F2 — /approve-deposit status flip inside transaction
test('F2: admin/approve-deposit status UPDATE is inside the transaction', () => {
    const block = PAY_SRC_R63.match(/router\.post\(\s*['"]\/admin\/approve-deposit['"][\s\S]+?^\}\);/m);
    assert(block, '/admin/approve-deposit handler not found');
    const beginIdx = block[0].indexOf('beginTransaction');
    const claimIdx = block[0].search(/UPDATE deposits SET status = 'completed' WHERE id = \? AND status = 'pending'/);
    assert(beginIdx > 0 && claimIdx > 0, 'both begin and claim must exist');
    assert(beginIdx < claimIdx,
        'status claim UPDATE must run INSIDE the transaction (begin precedes claim)');
    // Rollback path must exist
    assert(/await db\.rollback\(\)/.test(block[0]), 'rollback must be called if claim fails');
});

// H1 — reset + verify tokens stored as hashes
test('H1: password-reset token stored as hash(hashToken), not plaintext', () => {
    // Store side
    assert(/\[user\.id, hashToken\(resetToken\), expiresAt\]/.test(AUTH_SRC_R63),
        'reset token INSERT must wrap resetToken in hashToken()');
    // Read side
    assert(/WHERE t\.token = \? AND t\.used = 0[\s\S]{0,80}\[hashToken\(token\)\]/.test(AUTH_SRC_R63),
        'reset token lookup must hash incoming plaintext before SELECT');
});

test('H1: email verification token stored as hash(hashToken), not plaintext', () => {
    // Both write sites must use hashToken
    const writeCount = (AUTH_SRC_R63.match(/\[userId, hashToken\(verificationToken\)|\[user\.id, hashToken\(verificationToken\)/g) || []).length;
    assert(writeCount >= 2,
        `both register + resend-verification must wrap verificationToken in hashToken() (found ${writeCount})`);
    // Read side in /verify-email
    assert(/FROM email_verification_tokens WHERE token = \? AND used = 0[\s\S]{0,80}\[hashToken\(token\)\]/.test(AUTH_SRC_R63),
        '/verify-email must hash incoming plaintext before SELECT');
});

// H2 — atomic OTP attempts + timing-safe compare
test('H2: OTP attempt counter increments atomically (RETURNING or tx-wrapped UPDATE)', () => {
    // Must NOT have the old pattern: const attempts = wd.otp_attempts + 1; UPDATE SET otp_attempts = ?
    assert(!/const attempts = \(wd\.otp_attempts \|\| 0\) \+ 1;[\s\S]{0,500}UPDATE withdrawals SET otp_attempts = \?/.test(PAY_SRC_R63),
        'old non-atomic SELECT→compute→UPDATE pattern must be gone');
    // Must have the atomic increment
    assert(/UPDATE withdrawals SET otp_attempts = COALESCE\(otp_attempts, 0\) \+ 1/.test(PAY_SRC_R63),
        'OTP attempts must be incremented by an atomic UPDATE');
    // Must be guarded by status + otp_code NOT NULL to avoid racing a cancelled withdrawal
    assert(/status = 'pending' AND otp_code IS NOT NULL/.test(PAY_SRC_R63),
        'atomic increment must be guarded by status + otp_code');
});

test('H2: OTP comparison is constant-time (crypto.timingSafeEqual)', () => {
    // In the verify-otp handler
    const block = PAY_SRC_R63.match(/router\.post\(\s*['"]\/withdraw\/verify-otp['"][\s\S]+?^\}\);/m);
    assert(block, '/verify-otp handler not found');
    assert(/crypto\.timingSafeEqual/.test(block[0]),
        'OTP match must use crypto.timingSafeEqual instead of !== or ===');
});

// F5 — dispute + refund idempotency inside transaction
test('F5: dispute claw-back idempotency is atomic INSERT claim inside the transaction', () => {
    // Find the charge.dispute.created block
    const disputeIdx = STRIPE_SRC_R63.indexOf('charge.dispute.created');
    const refundIdx = STRIPE_SRC_R63.indexOf('charge.refunded');
    const disputeBlock = STRIPE_SRC_R63.slice(disputeIdx, refundIdx);

    // Must have a guarded INSERT ... WHERE NOT EXISTS as the claim
    assert(/INSERT INTO transactions[\s\S]{0,800}WHERE NOT EXISTS/.test(disputeBlock),
        'dispute claim must be INSERT ... WHERE NOT EXISTS (atomic idempotency)');
    // begin must precede the claim — claim inside the transaction
    const beginIdx = disputeBlock.indexOf('beginTransaction');
    const insIdx   = disputeBlock.search(/INSERT INTO transactions[\s\S]*?WHERE NOT EXISTS/);
    assert(beginIdx > 0 && insIdx > beginIdx,
        'idempotency claim INSERT must be INSIDE the transaction (after beginTransaction)');
});

test('F5: refund idempotency is also atomic INSERT claim inside the transaction', () => {
    const refundIdx = STRIPE_SRC_R63.indexOf('charge.refunded');
    const failedIdx = STRIPE_SRC_R63.indexOf('payment_intent.payment_failed');
    const refundBlock = STRIPE_SRC_R63.slice(refundIdx, failedIdx);

    assert(/INSERT INTO transactions[\s\S]{0,800}WHERE NOT EXISTS/.test(refundBlock),
        'refund claim must be INSERT ... WHERE NOT EXISTS');
    const beginIdx = refundBlock.indexOf('beginTransaction');
    const insIdx   = refundBlock.search(/INSERT INTO transactions[\s\S]*?WHERE NOT EXISTS/);
    assert(beginIdx > 0 && insIdx > beginIdx,
        'refund idempotency claim must be inside the transaction');
});

// F6 — crypto verify-deposit RG
test('F6: /api/crypto/verify-deposit runs full RG + velocity checks', () => {
    assert(/require\(['"]\.\.\/services\/deposit-checks\.service['"]\)/.test(CRYPTO_SRC_R63),
        'crypto.routes must import deposit-checks service');
    assert(/depositChecks\.runAllChecks/.test(CRYPTO_SRC_R63),
        'crypto verify-deposit must call runAllChecks (self-exclusion + limits + velocity)');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== CLAUDE.md rule #7: no Math.random on server side ===');
// ══════════════════════════════════════════════════════════════════════
test('no server/**/*.js uses Math.random() in RNG-critical contexts', () => {
    const badHits = [];
    for (const file of SERVER_JS) {
        const src = fs.readFileSync(file, 'utf8');
        const lines = src.split('\n');
        lines.forEach((line, i) => {
            const idx = line.search(/Math\.random\s*\(/);
            if (idx < 0) return;
            // Skip if the match is inside a comment or string literal on the same line
            const prefix = line.slice(0, idx);
            if (prefix.includes('//')) return;        // inline comment
            if (/^\s*\*/.test(line)) return;          // JSDoc line
            // Skip if wrapped in single/double quotes (naive but effective)
            const sq = (prefix.match(/'/g) || []).length;
            const dq = (prefix.match(/"/g) || []).length;
            const bq = (prefix.match(/`/g) || []).length;
            if (sq % 2 === 1 || dq % 2 === 1 || bq % 2 === 1) return; // inside a string
            badHits.push(`${path.relative(SERVER_DIR, file)}:${i + 1} ${line.trim()}`);
        });
    }
    assert(badHits.length === 0, `Math.random() found in ${badHits.length} places:\n  ${badHits.join('\n  ')}`);
});

// ══════════════════════════════════════════════════════════════════════
(async () => {
    await new Promise(r => setImmediate(r));
    console.log('\n========================================');
    console.log(`RESULT: ${passes} pass, ${fails} fail`);
    process.exit(fails ? 1 : 0);
})();
