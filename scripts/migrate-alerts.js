'use strict';

/**
 * One-shot migration: replace alert() with showToast() in js/ui-slot.js.
 *
 * Strategy:
 *   - The audit produced a line-number → severity map. For each entry we
 *     locate the alert() call and rewrite it to:
 *
 *         if (typeof showToast === 'function') showToast(<args>, '<sev>');
 *         else alert(<args>);
 *
 *   - We preserve the original alert() as a fallback so:
 *       (a) standalone test harnesses that don't define showToast still work
 *       (b) blocking-acknowledgement alerts that should NEVER be silent are
 *           the only `alert(` calls remaining and stand out in code review
 *
 *   - The 11 "blocking" alerts identified by the audit are NOT in MIGRATE —
 *     they need real modals (2FA backup code, self-exclusion confirm,
 *     session expiry, age-gate, etc.) and are tracked in a follow-up TODO
 *     printed at the end of this script.
 *
 * After this runs once, the migration script is deleted from the tree.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'js', 'ui-slot.js');

// Line → severity, derived from the audit report. Lines that take blocking
// acknowledgement (2FA backup code, session expiry, age-gate, GDPR delete,
// multiline detail dumps, etc.) are deliberately omitted.
const MIGRATE = {
    15627: 'info',     // 'No spin history to export yet.'
    16417: 'error',    // 'Minimum deposit is $10'
    16422: 'info',     // 'Please use the payment system to make a deposit.'
    16424: 'warning',  // 'Please register or log in to make a deposit.'
    16432: 'error',    // 'Minimum withdrawal is $20'
    16437: 'info',     // 'Please use the withdrawal system…'
    16439: 'warning',  // 'Please register or log in to request a withdrawal.'
    16510: 'error',    // 'Minimum cashback claim is $5'
    16513: 'info',     // 'Cashback is processed automatically by the server.'
    16584: 'info',     // 'Come back tomorrow for another free spin!'
    16589: 'success',  // 'Spin recorded! Log in to claim your bonus wheel prize.'
    16632: 'error',    // 'Please enter a valid email address'
    16639: 'success',  // 'Thanks for subscribing!'
    16884: 'info',     // 'No audit events to export.'
    16910: 'error',    // 'Insufficient balance. Bonus buy costs $…'
    18262: 'success',  // 'Deposit limit removed.'
    18267: 'success',  // 'Daily deposit limit set to $…'
    18484: 'success',  // duplicate (removed)
    18489: 'success',  // duplicate (set)
    18793: 'warning',  // 'No player found for: …'
    18796: 'error',    // 'Search error: …'
    18811: 'success',  // 'Broadcast sent to N players.'
    18812: 'error',    // 'Broadcast error: …'
    19026: 'success',  // 'Joined tournament!'
    19027: 'error',    // 'Could not join: …'
    19075: 'warning',  // 'Verification result: …'
    19078: 'error',    // 'Verification unavailable…'
    19117: 'success',  // 'Documents submitted for review.'
    19163: 'error',    // 'Please enter a valid 6-digit code.'
    19166: 'success',  // 'Two-Factor Authentication enabled successfully!'
    19248: 'success',  // 'Your data has been exported.'
    19626: 'success',  // 'Thanks for rating us … stars!'
    19676: 'error',    // 'Minimum deposit is $1'
    19677: 'error',    // 'Maximum deposit is $10,000'
    19713: 'error',    // 'Payment error. Please try again.'
    19717: 'error',    // 'Connection error: …'
    19856: 'error',    // 'Minimum withdrawal is $20.'
    19860: 'error',    // 'Invalid amount.'
    19861: 'success',  // 'Withdrawal of $… submitted.'
    19923: 'info',     // 'No cashback available yet.'
    19925: 'success',  // 'Cashback claimed: $…'
    20481: 'error',    // 'Please enter a valid email.'
    21094: 'error',    // 'Enter a username'
    21095: 'error',    // 'Insufficient balance'
    21434: 'error',    // 'Insufficient balance'
    21476: 'success',  // 'Player … banned'
    21477: 'success',  // 'Player … muted for 24h'
    21478: 'success',  // 'Warning sent to …'
    21994: 'info',     // 'No play history available'
    22581: 'error',    // 'Insufficient balance'
    23257: 'error',    // 'Please fill all fields'
    23263: 'warning',  // 'Please log in first.'
    23272: 'error',    // 'Verification submission failed: …'
    23278: 'error',    // 'Network error submitting verification.'
    23305: 'error',    // 'Please enter your date of birth'
    23854: 'warning',  // 'Please complete KYC verification before withdrawing.'
    23872: 'error',    // 'Minimum withdrawal is $20'
    23873: 'error',    // 'Insufficient balance'
    23928: 'error',    // 'Please fill all fields'
    24815: 'success',  // 'Withdrawal … approved!…'
    24819: 'error',    // 'Error: …'
    24834: 'success',  // 'Withdrawal … denied.'
    24838: 'error',    // 'Error: …'
};

// 11 blocking alerts that must stay (or become modals) — keep these untouched.
const KEEP = [16838, 18252, 18474, 18791, 19073, 19191, 19257, 19263, 23259, 23307];

function migrate() {
    const src = fs.readFileSync(TARGET, 'utf8');
    const lines = src.split(/\r?\n/);

    let replaced = 0;
    let skipped = 0;
    const failedLines = [];

    for (const [lineStr, sev] of Object.entries(MIGRATE)) {
        const lineNum = parseInt(lineStr, 10);
        const idx = lineNum - 1;
        if (idx < 0 || idx >= lines.length) {
            failedLines.push({ line: lineNum, reason: 'out of range' });
            continue;
        }
        const line = lines[idx];

        // Idempotency: if the line already contains the showToast wrapper
        // from a prior run, skip — we don't want to re-wrap.
        if (line.includes("showToast(")) {
            skipped++;
            continue;
        }

        // Find the first `alert(` token anywhere on the line — it can be
        // nested inside `if (...) { alert(...); return; }`, inside a `.then`
        // callback, etc. Then bracket-depth-scan to find the matching `)`.
        const open = line.indexOf('alert(');
        if (open < 0) {
            failedLines.push({ line: lineNum, reason: 'no alert( on line', content: line });
            continue;
        }

        // Don't mistake `myalert(` or `xalert(` for `alert(` — must be
        // preceded by start-of-line, whitespace, or punctuation.
        const prev = open === 0 ? '' : line[open - 1];
        if (prev && /[A-Za-z0-9_$]/.test(prev)) {
            failedLines.push({ line: lineNum, reason: 'alert is suffix of identifier', content: line });
            continue;
        }

        const argStart = open + 'alert('.length;
        let depth = 1;
        let inStr = null;
        let i = argStart;
        for (; i < line.length; i++) {
            const ch = line[i];
            if (inStr) {
                if (ch === '\\') { i++; continue; }
                if (ch === inStr) inStr = null;
                continue;
            }
            if (ch === '\'' || ch === '"' || ch === '`') { inStr = ch; continue; }
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth !== 0) {
            failedLines.push({ line: lineNum, reason: 'unbalanced parens', content: line });
            continue;
        }

        const args = line.slice(argStart, i);
        // Eat the optional `;` that follows the alert call (very common).
        let afterEnd = i + 1;
        if (line[afterEnd] === ';') afterEnd++;

        const before = line.slice(0, open);
        const after = line.slice(afterEnd);
        const replacement =
            `if (typeof showToast === 'function') showToast(${args}, '${sev}'); ` +
            `else alert(${args});`;
        const newLine = before + replacement + after;

        lines[idx] = newLine;
        replaced++;
    }

    fs.writeFileSync(TARGET, lines.join('\n'), 'utf8');

    console.log(`[migrate-alerts] replaced: ${replaced}/${Object.keys(MIGRATE).length}`);
    console.log(`[migrate-alerts] skipped:  ${skipped}`);
    console.log(`[migrate-alerts] kept (blocking): ${KEEP.length} alerts at lines ${KEEP.join(', ')}`);
    if (failedLines.length) {
        console.log('[migrate-alerts] FAILED to migrate (inspect manually):');
        for (const f of failedLines) {
            console.log(`  L${f.line}: ${f.reason}` + (f.content ? ` — ${f.content.slice(0, 100)}` : ''));
        }
    }
}

migrate();
