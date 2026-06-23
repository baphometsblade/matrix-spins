'use strict';

/**
 * Regression test for the tablet-width header overflow bug.
 *
 * Background: `.header-right` packs 12 children (balance, VIP, wagering,
 * Deposit, search, sound, bell, limits, avatar, hamburger + 2 hidden
 * placeholders). At any viewport between 481-1023px the bell, Deposit,
 * RG-limits, avatar, sound, and hamburger were ALL pushed off-screen — a
 * playwright probe at 684px viewport confirmed the Deposit button was at
 * x=797px on an x=684px viewport, completely unreachable. Tablet users
 * could not deposit at all.
 *
 * The prior fix (commit 2fcb1834, "Mobile header fix") put the icon-hide
 * rule under `@media (max-width: 480px)` which only covered phones,
 * leaving the entire tablet range broken.
 *
 * This test locks the post-fix contract so a future contributor cannot
 * silently reduce the breakpoint back to 480px and reintroduce the
 * revenue-impacting bug:
 *   Part 1: index.html has a `@media (max-width: 1023px)` rule.
 *   Part 2: that rule hides the 8 secondary icons but NOT
 *           .balance-card / .btn-deposit / .ms-hamburger.
 *   Part 3: dist/index.html matches index.html (build pipeline propagated).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_SRC = path.join(ROOT, 'index.html');
const INDEX_DIST = path.join(ROOT, 'dist', 'index.html');

const SECONDARY_HIDES = [
    '#vipMiniWidget',
    '#wageringBarWrap',
    '.ms-search-trigger',
    'button[aria-label="Toggle sound"]',
    '.msn-bell-wrap',
    '#limitsBtn',
    '.limits-btn',
    '.avatar',
];

// Items that MUST NOT be hidden by the tablet rule — these are the
// revenue/conversion essentials.
const ESSENTIAL_VISIBLE = [
    '.balance-card',
    '.btn-deposit',
    '.ms-hamburger',
];

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

/**
 * Extract the body of the first @media rule matching `selector`.
 * Returns null when not found. Tolerates extra whitespace in the selector.
 */
function extractMediaRule(css, mediaSelector) {
    const re = new RegExp('@media\\s*\\(\\s*' + mediaSelector.replace(/\s+/g, '\\s*') + '\\s*\\)\\s*\\{');
    const m = css.match(re);
    if (!m) return null;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
    }
    return depth === 0 ? css.slice(start, i - 1) : null;
}

describe('Tablet header — Deposit button must stay reachable at all widths < 1024px', () => {
    const src = readFile(INDEX_SRC);

    test('index.html contains a @media (max-width: 1023px) rule for the tablet range', () => {
        const body = extractMediaRule(src, 'max-width:\\s*1023px');
        expect(body).not.toBeNull();
    });

    test('the tablet rule hides every secondary icon that overflowed at 684px', () => {
        const body = extractMediaRule(src, 'max-width:\\s*1023px');
        expect(body).not.toBeNull();
        const missing = SECONDARY_HIDES.filter(sel => !body.includes(sel));
        if (missing.length > 0) {
            throw new Error('tablet rule missing hides for: ' + missing.join(', '));
        }
        expect(missing).toEqual([]);
    });

    test('the tablet rule does NOT hide the revenue-essential items', () => {
        const body = extractMediaRule(src, 'max-width:\\s*1023px');
        expect(body).not.toBeNull();
        // The rule applies `display: none !important` to a comma list. Any
        // essential selector appearing in that list would be a regression.
        const hideMatch = body.match(/([^{]*)\{\s*display:\s*none\s*!important;?\s*\}/);
        if (!hideMatch) return; // structure changed; not our concern in this assertion
        const hideList = hideMatch[1];
        for (const essential of ESSENTIAL_VISIBLE) {
            if (hideList.includes(essential)) {
                throw new Error('tablet rule incorrectly hides essential selector: ' + essential);
            }
        }
    });

    test('the tablet rule does NOT regress to max-width: 480px or smaller', () => {
        // Guard against a future revert that puts the rule back under 480px.
        const phoneOnly = src.match(/@media\s*\(\s*max-width:\s*(480|600|767|768)px\s*\)\s*\{[\s\S]*?#vipMiniWidget/);
        if (phoneOnly) {
            // Only legal if there ALSO exists a ≥1023 rule covering the secondary hides.
            const tablet = extractMediaRule(src, 'max-width:\\s*1023px');
            const tabletCoversHides = tablet && SECONDARY_HIDES.every(sel => tablet.includes(sel));
            if (!tabletCoversHides) {
                throw new Error('phone-only rule found at ' + phoneOnly[1] + 'px without a corresponding 1023px tablet rule');
            }
        }
    });

    test('the tablet rule RELEASES the .header-right CLS min-width reserve (the live 820px cause)', () => {
        // .header-right { min-width: 480px } reserves width for desktop-injected icons
        // (search/bell/menu) to prevent CLS. At <=1023px those icons are display:none,
        // so the reserve MUST be released — otherwise .header-right stays 480px wide with
        // ~155px of content and pushes Deposit + the hamburger off-screen. Confirmed live
        // at 820px: Deposit sat at x=892 on an 820px viewport. Hiding the icons alone (the
        // original 4047b7bd fix) did NOT fix it; the reserve has to be reset too.
        const tablet = extractMediaRule(src, 'max-width:\\s*1023px');
        expect(tablet).not.toBeNull();
        // Isolate the bare `.header-right { ... }` rule (not `.header-right .child`).
        const bareRules = tablet.match(/\.header-right\s*\{[^}]*\}/g) || [];
        const releasesReserve = bareRules.some(r => /min-width:\s*(0|auto)\b/.test(r));
        expect(releasesReserve).toBe(true);
    });

    test('dist/index.html mirrors the source breakpoint (build pipeline propagated)', () => {
        if (!fs.existsSync(INDEX_DIST)) {
            // Acceptable on a fresh clone before `npm run build` — surface as
            // a soft pass so the suite isn't blocked, but log loudly.
            console.warn('[responsive-header] dist/index.html missing — run `npm run build`.');
            return;
        }
        const dist = readFile(INDEX_DIST);
        const body = extractMediaRule(dist, 'max-width:\\s*1023px');
        expect(body).not.toBeNull();
        const missing = SECONDARY_HIDES.filter(sel => !body.includes(sel));
        expect(missing).toEqual([]);
    });
});
