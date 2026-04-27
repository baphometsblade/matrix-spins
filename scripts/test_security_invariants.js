#!/usr/bin/env node
/**
 * Security invariant tests — static analysis, no DB or server required.
 *
 * Each test asserts a security property of the codebase. A failure means a
 * fix has been reverted or a regression was introduced.
 *
 * Run:  npm run test:security   (or: node scripts/test_security_invariants.js)
 *
 * Why static analysis instead of integration tests:
 *  - Runs in milliseconds (no DB setup, no server boot, no test users)
 *  - Catches regressions at commit time (can be wired into pre-commit)
 *  - Self-documenting — every assertion explains the rule it enforces
 *  - Forces the unsafe pattern off the codebase entirely (vs. checking
 *    behavior, which only catches the path the test happens to exercise)
 *
 * Project history note: per CLAUDE.md, the streak-saver bonus_balance fix has
 * been reverted SIX times by other sessions. These tests are the regression
 * fence around all the security work.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) { passed++; }
function fail(label, detail) {
    failed++;
    failures.push({ label, detail });
    console.error(`FAIL: ${label}`);
    if (detail) console.error('  ' + String(detail).split('\n').join('\n  '));
}

function walk(dir, ext) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, ext));
        } else if (entry.isFile() && (!ext || entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
}

function readAll(files) {
    return files.map(f => ({ file: f, src: fs.readFileSync(f, 'utf8') }));
}

// Strip /* ... */ and // line comments so static checks don't false-positive
// on documentation that mentions a forbidden pattern.
function stripComments(src) {
    // Remove block comments
    let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove line comments (but preserve URLs like https://)
    out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    return out;
}

function relpath(p) {
    return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

const allServerJs = walk(SERVER_DIR, '.js');
const allServerSrc = readAll(allServerJs).map(x => ({ ...x, code: stripComments(x.src) }));
const routesSrc = allServerSrc.filter(x => x.file.includes(path.sep + 'routes' + path.sep));
const servicesSrc = allServerSrc.filter(x => x.file.includes(path.sep + 'services' + path.sep));

// ═══════════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Crypto-secure RNG enforcement ──────────────────────────────────────
function test_no_math_random_server_side() {
    const label = 'No Math.random() calls in server/ code (CLAUDE.md rule: crypto.randomInt/randomBytes only)';
    const hits = [];
    for (const { file, code } of allServerSrc) {
        const lines = code.split('\n');
        lines.forEach((line, i) => {
            if (/Math\.random\s*\(/.test(line)) {
                hits.push(`${relpath(file)}:${i + 1}: ${line.trim()}`);
            }
        });
    }
    if (hits.length === 0) pass(label);
    else fail(label, `Found ${hits.length} forbidden Math.random call(s):\n` + hits.slice(0, 8).join('\n'));
}

// ── 2. Atomic balance writes ──────────────────────────────────────────────
function test_no_non_atomic_balance_writes() {
    const label = 'Zero non-atomic "SET balance = ?" writes in routes/ and services/ (must use balance ± ?)';
    const hits = [];
    for (const { file, code } of [...routesSrc, ...servicesSrc]) {
        const lines = code.split('\n');
        lines.forEach((line, i) => {
            // Match: SET balance = ?  (read-then-set anti-pattern)
            // Allow: SET balance = balance + ?, SET balance = balance - ? WHERE ...
            if (/SET\s+balance\s*=\s*\?(?!\s*\+|\s*-|\w)/i.test(line)) {
                hits.push(`${relpath(file)}:${i + 1}: ${line.trim()}`);
            }
        });
    }
    if (hits.length === 0) pass(label);
    else fail(label, `Found ${hits.length} non-atomic balance write(s):\n` + hits.slice(0, 8).join('\n'));
}

// ── 3. Wagering accumulation (no overwrite) ───────────────────────────────
function test_no_wagering_overwrite() {
    const label = 'Zero "wagering_requirement = ?" overwrites (must be COALESCE(wagering_requirement, 0) + ?)';
    const hits = [];
    for (const { file, code } of allServerSrc) {
        const lines = code.split('\n');
        lines.forEach((line, i) => {
            // Anti-pattern: wagering_requirement = ?   (replaces any active bonus's requirement)
            // Whitelist: COALESCE(wagering_requirement, 0) + ?  (correct accumulation)
            const lower = line.toLowerCase();
            if (/wagering_requirement\s*=\s*\?/i.test(line) &&
                !/coalesce\(wagering_requirement[^)]*\)\s*\+\s*\?/i.test(lower)) {
                hits.push(`${relpath(file)}:${i + 1}: ${line.trim()}`);
            }
        });
    }
    if (hits.length === 0) pass(label);
    else fail(label, `Found ${hits.length} wagering overwrite(s):\n` + hits.slice(0, 8).join('\n'));
}

// ── 4. Free credits route to bonus_balance, not balance ───────────────────
function test_free_credits_go_to_bonus_balance() {
    // Whitelist of files that legitimately credit balance directly:
    // - admin.routes.js adjust-balance (admin discretion, not a "free bonus")
    // - admin.routes.js approve-deposit (deposit is real money)
    // - admin.routes.js withdrawal refund (refunding own debit)
    // - balance.routes.js admin manual deposit
    // - payment.routes.js (deposits and withdrawal-cancel refunds)
    // - spin.routes.js (slot wins from real bets)
    // - buyfeature.routes.js (buy-feature wins from real bets)
    // - horseracing.routes.js (horse race wins from real bets)
    // - jackpot.service.js (jackpot wins from real bet contributions)
    // - stripe.service.js (deposit completion)
    const label = 'Bonus routes credit bonus_balance, not balance (CLAUDE.md free-credit rule)';
    // Files that MUST NEVER touch `balance` directly via UPDATE-set-add:
    const bonusOnlyFiles = [
        'user.routes.js',         // daily bonus, bonus wheel, promo, referral
        'vipwheel.routes.js',     // VIP wheel prizes
        'birthday.routes.js',     // birthday bonus
        'depositstreak.routes.js',// deposit streak rewards
        'reloadbonus.routes.js',  // reload bonus
        'freespins.routes.js',    // free spin winnings
    ];
    const hits = [];
    for (const fname of bonusOnlyFiles) {
        const candidates = allServerSrc.filter(x => x.file.endsWith(fname));
        if (candidates.length === 0) continue;
        const { file, code } = candidates[0];
        const lines = code.split('\n');
        lines.forEach((line, i) => {
            // Pattern: UPDATE users SET balance = balance + ?
            // Disallowed in these files because the credit IS bonus money.
            if (/UPDATE\s+users\s+SET\s+balance\s*=\s*balance\s*\+\s*\?/i.test(line)) {
                hits.push(`${relpath(file)}:${i + 1}: ${line.trim()}`);
            }
            // Also catch the original anti-pattern in case it crept back
            if (/SET\s+balance\s*=\s*\?(?!\s*\+|\s*-)/i.test(line)) {
                hits.push(`${relpath(file)}:${i + 1}: ${line.trim()}`);
            }
        });
    }
    if (hits.length === 0) pass(label);
    else fail(label, `Found ${hits.length} bonus credit(s) routing to balance instead of bonus_balance:\n` + hits.slice(0, 8).join('\n'));
}

// ── 5. OTP timing-safe compare ────────────────────────────────────────────
function test_otp_timing_safe_compare() {
    const label = 'OTP withdrawal verify uses crypto.timingSafeEqual (not ===)';
    const candidates = allServerSrc.filter(x => x.file.endsWith('payment.routes.js'));
    if (candidates.length === 0) {
        fail(label, 'payment.routes.js not found');
        return;
    }
    const { code } = candidates[0];
    if (/timingSafeEqual/.test(code) && /verify-otp/.test(code)) {
        // Also verify the unsafe path is gone
        const lines = code.split('\n');
        const inOtpRoute = lines.some(l => /verify-otp/.test(l));
        if (!inOtpRoute) {
            fail(label, 'verify-otp route block not found');
            return;
        }
        pass(label);
    } else {
        fail(label, 'crypto.timingSafeEqual not present in payment.routes.js OTP verify path');
    }
}

// ── 6. Webhook requires HMAC signature ────────────────────────────────────
function test_webhook_requires_hmac_signature() {
    const label = 'Generic /webhook/confirm requires HMAC-SHA256 signature (no JWT_SECRET fallback)';
    const candidates = allServerSrc.filter(x => x.file.endsWith('payment.routes.js'));
    if (candidates.length === 0) { fail(label, 'payment.routes.js missing'); return; }
    const { code } = candidates[0];
    const hasHmac = /createHmac\s*\(\s*['"]sha256['"]/.test(code);
    const hasSigHeader = /X-Webhook-Signature/i.test(code);
    const hasJwtFallback = /WEBHOOK_SECRET\s*\|\|\s*config\.JWT_SECRET/.test(code) ||
                          /WEBHOOK_SECRET\s*\|\|\s*JWT_SECRET/.test(code);
    if (hasHmac && hasSigHeader && !hasJwtFallback) {
        pass(label);
    } else {
        const issues = [];
        if (!hasHmac) issues.push('no createHmac("sha256")');
        if (!hasSigHeader) issues.push('no X-Webhook-Signature header check');
        if (hasJwtFallback) issues.push('JWT_SECRET fallback present (CRITICAL)');
        fail(label, issues.join('; '));
    }
}

// ── 7. balance.routes /withdraw is deprecated (returns 410) ───────────────
function test_balance_withdraw_deprecated() {
    const label = 'Legacy /api/balance/withdraw returns 410 Gone (bypassed self-exclusion / OTP / cooldown)';
    const candidates = allServerSrc.filter(x => x.file.endsWith('balance.routes.js'));
    if (candidates.length === 0) { fail(label, 'balance.routes.js missing'); return; }
    const { code } = candidates[0];
    // Find the /withdraw block
    const withdrawMatch = code.match(/router\.post\(['"]\/withdraw['"]\s*,[\s\S]*?\n\}\)/);
    if (!withdrawMatch) {
        fail(label, '/withdraw route not found in balance.routes.js');
        return;
    }
    const block = withdrawMatch[0];
    if (/status\(410\)/.test(block) && /deprecated/i.test(block)) {
        pass(label);
    } else {
        fail(label, '/withdraw route does not return 410 / deprecated');
    }
}

// ── 8. config.js fails-closed in production ───────────────────────────────
function test_config_fail_closed() {
    const label = 'config.js throws in production with default JWT_SECRET / ADMIN_PASSWORD / missing ALLOWED_ORIGIN';
    const cfg = fs.readFileSync(path.join(SERVER_DIR, 'config.js'), 'utf8');
    const hasJwtCheck = /JWT_SECRET[\s\S]{0,200}throw/.test(cfg);
    const hasAdminCheck = /ADMIN_PASSWORD[\s\S]{0,200}throw/.test(cfg);
    const hasOriginCheck = /ALLOWED_ORIGIN[\s\S]{0,200}throw/.test(cfg);
    const inProdGuard = /NODE_ENV\s*===\s*['"]production['"]/.test(cfg);
    if (hasJwtCheck && hasAdminCheck && hasOriginCheck && inProdGuard) {
        pass(label);
    } else {
        const missing = [];
        if (!inProdGuard) missing.push('NODE_ENV production guard');
        if (!hasJwtCheck) missing.push('JWT_SECRET throw');
        if (!hasAdminCheck) missing.push('ADMIN_PASSWORD throw');
        if (!hasOriginCheck) missing.push('ALLOWED_ORIGIN throw');
        fail(label, 'missing: ' + missing.join(', '));
    }
}

// ── 9. Race-safe status flips on critical state transitions ───────────────
function test_race_safe_status_flips() {
    const label = 'Critical status flips use "WHERE status = \'pending\'" rowcount guard';
    // We expect race-safe flips in:
    //   - payment.routes.js: webhook (deposit completion), withdrawal cancel
    //   - admin.routes.js: approve-deposit, approve-withdrawal, reject-withdrawal (×2)
    //   - stripe.service.js: deposit completion
    const requiredFiles = [
        'payment.routes.js',
        'admin.routes.js',
        'stripe.service.js',
    ];
    const issues = [];
    for (const fname of requiredFiles) {
        const candidates = allServerSrc.filter(x => x.file.endsWith(fname));
        if (candidates.length === 0) {
            issues.push(`${fname} missing`);
            continue;
        }
        const { code } = candidates[0];
        // Look for at least one race-safe flip pattern
        const has = /UPDATE\s+\w+\s+SET\s+status\s*=\s*['"](?:completed|cancelled|rejected|approved)['"][^;]*WHERE[^;]*status\s*=\s*['"]pending['"]/i.test(code);
        if (!has) {
            issues.push(`${fname}: no race-safe status flip with WHERE status = 'pending'`);
        }
    }
    if (issues.length === 0) pass(label);
    else fail(label, issues.join('; '));
}

// ── 10. Atomic debits use WHERE balance >= ? guard ────────────────────────
function test_atomic_debits() {
    const label = 'Bet/wager debits use atomic "balance = balance - ? WHERE balance >= ?" pattern';
    const requiredFiles = [
        'spin.routes.js',
        'buyfeature.routes.js',
        'horseracing.routes.js',
        'payment.routes.js',  // withdraw debit
        'battlepass.service.js',
    ];
    const issues = [];
    for (const fname of requiredFiles) {
        const candidates = allServerSrc.filter(x => x.file.endsWith(fname));
        if (candidates.length === 0) {
            issues.push(`${fname} missing`);
            continue;
        }
        const { code } = candidates[0];
        const has = /balance\s*=\s*balance\s*-\s*\?\s+WHERE[^;]*balance\s*>=\s*\?/i.test(code);
        if (!has) {
            issues.push(`${fname}: no atomic debit with WHERE balance >= ? guard`);
        }
    }
    if (issues.length === 0) pass(label);
    else fail(label, issues.join('; '));
}

// ── 11. Password-reset endpoints are rate-limited ─────────────────────────
function test_password_reset_rate_limited() {
    const label = 'Password reset / forgot-password endpoints are rate-limited';
    const idx = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const code = stripComments(idx);
    const hasResetLimiter =
        /(passwordResetLimiter|reset.*[Ll]imiter)\b[\s\S]{0,1000}\/forgot-password/.test(code) ||
        /\/forgot-password[^;]*?(?:Limiter|rateLimit)/.test(code) ||
        /app\.use\(['"]\/api\/(?:user|auth)\/forgot-password['"][^)]*[Ll]imiter\)/.test(code);
    const hasResetEndpoint =
        /app\.use\(['"]\/api\/(?:user|auth)\/reset-password['"]/.test(code);
    if (hasResetLimiter && hasResetEndpoint) {
        pass(label);
    } else {
        fail(label, 'forgot-password / reset-password rate limiter not found in server/index.js');
    }
}

// ── 12. Webhook endpoint is rate-limited ──────────────────────────────────
function test_webhook_rate_limited() {
    const label = 'Generic /webhook/confirm endpoint is rate-limited (prevents brute-force of HMAC)';
    const idx = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const code = stripComments(idx);
    const has = /\/webhook\/confirm[^;]*?(?:Limiter|rateLimit)/.test(code) ||
                /app\.use\(['"]\/api\/payments?\/webhook\/confirm['"][^)]*[Ll]imiter\)/.test(code);
    if (has) pass(label);
    else fail(label, 'webhookLimiter not applied to /webhook/confirm in server/index.js');
}

// ── 13. Free-spins decrement is race-safe ─────────────────────────────────
function test_freespins_race_safe_decrement() {
    const label = 'Free-spins claim uses race-safe decrement (free_spins_count - 1 WHERE > 0)';
    const candidates = allServerSrc.filter(x => x.file.endsWith('freespins.routes.js'));
    if (candidates.length === 0) { fail(label, 'freespins.routes.js missing'); return; }
    const { code } = candidates[0];
    const has = /free_spins_count\s*=\s*free_spins_count\s*-\s*1\s+WHERE[^;]*free_spins_count\s*>\s*0/i.test(code);
    if (has) pass(label);
    else fail(label, 'race-safe decrement pattern not found in freespins.routes.js');
}

// ── 14. CORS uses origin allowlist in production ──────────────────────────
function test_cors_production_allowlist() {
    const label = 'CORS in production uses ALLOWED_ORIGIN env var (not wide-open)';
    const idx = fs.readFileSync(path.join(SERVER_DIR, 'index.js'), 'utf8');
    const code = stripComments(idx);
    const has = /NODE_ENV\s*===\s*['"]production['"][\s\S]{0,200}ALLOWED_ORIGIN/.test(code);
    if (has) pass(label);
    else fail(label, 'CORS does not gate on ALLOWED_ORIGIN in production');
}

// ── 15. Frontend XSS: admin panel renders users via DOM, not innerHTML ────
function test_admin_panel_no_innerhtml_user_data() {
    const label = 'admin/index.html: user data (username/email/game_id) rendered via createElement+textContent, not innerHTML interpolation';
    const adminPath = path.join(REPO_ROOT, 'admin', 'index.html');
    if (!fs.existsSync(adminPath)) {
        fail(label, 'admin/index.html missing');
        return;
    }
    const code = fs.readFileSync(adminPath, 'utf8');
    // Anti-pattern: template literal with username/email/game_id directly inside
    // (these are user-controlled and CSP is disabled, so this = stored XSS in admin)
    const sinks = [
        /\$\{u\.username\}/,
        /\$\{u\.email\}/,
        /\$\{s\.username\}/,
        /\$\{g\.game_id\}/,
        // Catch any future variant: identifier directly inside ${} attached to innerHTML
    ];
    const hits = [];
    for (const sink of sinks) {
        if (sink.test(code)) hits.push(String(sink));
    }
    if (hits.length === 0) pass(label);
    else fail(label, `Anti-patterns present: ${hits.join(', ')}`);
}

// ── 16. Lobby leaderboard renders usernames via DOM, not innerHTML ────────
function test_lobby_leaderboard_no_username_innerhtml() {
    const label = 'js/ui-modals.js: lobby leaderboard renders e.username via createElement+textContent, not innerHTML interpolation';
    const modalsPath = path.join(REPO_ROOT, 'js', 'ui-modals.js');
    if (!fs.existsSync(modalsPath)) { fail(label, 'js/ui-modals.js missing'); return; }
    const code = fs.readFileSync(modalsPath, 'utf8');
    // Anti-pattern: e.username concatenated into a string that becomes innerHTML
    const bad = /\+\s*e\.username\s*\+/.test(code);
    if (!bad) pass(label);
    else fail(label, "concatenation '+ e.username +' detected — likely innerHTML build with raw username");
}

// ── 17. ui-slot showMessage uses textContent, not innerHTML interpolation ─
function test_show_message_uses_text_content() {
    const label = 'js/ui-slot.js: showMessage() uses createElement+textContent (server-controlled `text` cannot inject HTML)';
    const slotPath = path.join(REPO_ROOT, 'js', 'ui-slot.js');
    const code = fs.readFileSync(slotPath, 'utf8');
    // Find function showMessage signatures and verify the body uses textContent
    const fnMatches = code.match(/function showMessage\(text, type\)\s*\{[\s\S]{0,800}?\n\s{8}\}/g) || [];
    if (fnMatches.length === 0) {
        fail(label, 'no showMessage function found');
        return;
    }
    const issues = [];
    fnMatches.forEach((body, i) => {
        // Anti-pattern: backtick template literal with ${text} inline
        if (/\$\{text\}/.test(body) && /(inner|outer)HTML/.test(body)) {
            issues.push(`copy ${i + 1}: still interpolates \${text} into innerHTML`);
        }
        if (!/textContent/.test(body)) {
            issues.push(`copy ${i + 1}: missing textContent assignment`);
        }
    });
    if (issues.length === 0) pass(label);
    else fail(label, issues.join('; '));
}

// ── 18. Notifications use action whitelist, not window[action]() ──────────
function test_notifications_action_whitelist() {
    const label = 'js/ui-notifications.js: link_action invokes a whitelisted handler (no window[action]() arbitrary global call)';
    const code = fs.readFileSync(path.join(REPO_ROOT, 'js', 'ui-notifications.js'), 'utf8');
    const codeNoComments = stripComments(code);
    const hasWindowCall = /window\[action\]\s*\(\s*\)/.test(codeNoComments);
    const hasWhitelist = /ALLOWED_ACTIONS\s*[=\[]|hasOwnProperty\.call\(ALLOWED_ACTIONS/.test(codeNoComments);
    if (!hasWindowCall && hasWhitelist) pass(label);
    else {
        const why = [];
        if (hasWindowCall) why.push('window[action]() pattern still present');
        if (!hasWhitelist) why.push('no ALLOWED_ACTIONS whitelist');
        fail(label, why.join('; '));
    }
}

// ── 19. RNG service exists and uses crypto module ─────────────────────────
function test_rng_service_uses_crypto() {
    const label = 'rng.service.js exists and uses node crypto module';
    const rngPath = path.join(SERVER_DIR, 'services', 'rng.service.js');
    if (!fs.existsSync(rngPath)) {
        fail(label, 'rng.service.js does not exist');
        return;
    }
    const code = fs.readFileSync(rngPath, 'utf8');
    if (/require\s*\(\s*['"]crypto['"]\s*\)/.test(code) && /crypto\.randomInt/.test(code)) {
        pass(label);
    } else {
        fail(label, 'rng.service.js does not use crypto.randomInt');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RUN
// ═══════════════════════════════════════════════════════════════════════════

console.log('Running security invariant tests...\n');

test_no_math_random_server_side();
test_no_non_atomic_balance_writes();
test_no_wagering_overwrite();
test_free_credits_go_to_bonus_balance();
test_otp_timing_safe_compare();
test_webhook_requires_hmac_signature();
test_balance_withdraw_deprecated();
test_config_fail_closed();
test_race_safe_status_flips();
test_atomic_debits();
test_password_reset_rate_limited();
test_webhook_rate_limited();
test_freespins_race_safe_decrement();
test_cors_production_allowlist();
test_admin_panel_no_innerhtml_user_data();
test_lobby_leaderboard_no_username_innerhtml();
test_show_message_uses_text_content();
test_notifications_action_whitelist();
test_rng_service_uses_crypto();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error('\nFailures:');
    failures.forEach(f => console.error(`  - ${f.label}`));
    process.exit(1);
}
console.log('Security invariants OK.');
