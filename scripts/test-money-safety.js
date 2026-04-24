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
