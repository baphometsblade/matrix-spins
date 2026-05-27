'use strict';

/**
 * Lock-in regression test for the current house-edge configuration.
 *
 * Iteration log:
 *  - 2026-05-26 morning: TARGET_RTP 0.86 → 0.75 (25% house edge)
 *  - 2026-05-26 later: TARGET_RTP 0.75 → 0.80 (20% house edge) AND the
 *    operator removed all per-game RTP claims from the player-facing UI.
 *
 * The tests assert two invariants:
 *
 *   A. House-edge math is consistent end-to-end at 80% target.
 *      Three code layers must move together for the configured edge
 *      to actually deliver in production:
 *        1. server/config.js TARGET_RTP — the global throttle target
 *        2. server/services/house-edge.js safety clamp lower bound 0.65
 *           (anything above 0.80 would silently round the 0.80 target
 *           back up — but 0.65 also keeps room for future lower targets)
 *        3. shared/game-definitions.js + js/game-registry.js per-game rtp
 *           all at 80 so scaleWinForRTP converges to the same target
 *
 *   B. The lobby renderGames code path does NOT display a per-game RTP
 *      number to players. The operator removed the on-card RTP stat tag,
 *      the aria-label RTP fragment, and the hero-stats "Avg. RTP" item.
 *      Reintroducing any of them silently is what this regression catches.
 *      (RTP disclosure must still live in T&Cs / help — those are not
 *      tested here because they're regulator-facing, not lobby-facing.)
 *
 * If any one of these invariants regresses, the build fails. DO NOT MERGE
 * on red — silent reintroduction of the on-card RTP claim is exactly the
 * misrepresentation regulators flag.
 */

const fs = require('fs');
const path = require('path');

const INDEX_HTML = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.html'),
    'utf8'
);

describe('House edge — 80% configuration is locked in', () => {
    test('config.TARGET_RTP is 0.80 (20% house edge)', () => {
        const config = require('../../server/config');
        expect(config.TARGET_RTP).toBeCloseTo(0.80, 4);
    });

    test('house-edge.js scaleWinForRTP clamp still permits targets ≥ 0.65', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'server', 'services', 'house-edge.js'),
            'utf8'
        );
        // The clamp line: `targetRTP = Math.max(0.65, Math.min(0.97, targetRTP));`
        // 0.80 falls inside [0.65, 0.97] so no clamp adjustment is forced.
        expect(src).toMatch(/Math\.max\(\s*0\.65\s*,\s*Math\.min\(\s*0\.97/);
    });

    test('all 100 games have rtp === 80 in shared/game-definitions.js', () => {
        const games = require('../../shared/game-definitions');
        expect(games.length).toBe(100);
        for (const g of games) {
            expect(typeof g.rtp).toBe('number');
            expect(g.rtp).toBe(80);
        }
    });

    test('client-side js/game-registry.js per-game rtp matches server-side', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'js', 'game-registry.js'),
            'utf8'
        );
        const matches = src.match(/rtp:\s*(\d+(?:\.\d+)?)/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(100);
        for (const m of matches) {
            const v = parseFloat(m.replace(/rtp:\s*/, ''));
            expect(v).toBe(80);
        }
    });
});

describe('Lobby UI — no per-game RTP claim on player-facing surfaces', () => {
    test('renderGames stat-tags do not include the rtp-tag stat', () => {
        // The inline renderGames script in index.html used to emit
        //   <div class="stat-tag rtp-tag" title="Return to Player">${game.rtp}%</div>
        // The operator removed that line on 2026-05-26 because player-facing
        // RTP claims need to be either accurate-and-displayed or absent.
        // Asserting absence catches silent reintroduction.
        expect(INDEX_HTML).not.toMatch(/class="stat-tag rtp-tag"/);
        expect(INDEX_HTML).not.toMatch(/title="Return to Player"/);
    });

    test('game card aria-label does not include the RTP percent fragment', () => {
        // The aria-label builder used to push 'RTP X percent' as one of
        // the announced fragments for SR users. That was removed alongside
        // the visual rtp-tag — SR users hear the same info sighted users
        // see (or in this case, don't see).
        expect(INDEX_HTML).not.toMatch(/ariaParts\.push\(\s*['"]RTP /);
    });

    test('hero stats block does not contain "Avg. RTP" rendered item', () => {
        // The stat-item at the top of the lobby that read "96%  Avg. RTP"
        // was replaced with a "100%  Provably Fair" badge. The number is
        // still in T&Cs / help, where regulators expect it. We target the
        // exact rendered DOM pattern ( stat-label">Avg. RTP ) rather than
        // the bare phrase so our own change-log comments don't trip the
        // regex.
        expect(INDEX_HTML).not.toMatch(/class="stat-label"[^>]*>Avg\.\s*RTP/);
        expect(INDEX_HTML).not.toMatch(/data-count="96"[^>]*data-suffix="%"/);
    });

    test('showcase-card-rtp element does not concatenate a per-game RTP number', () => {
        // Previous template literal:
        //   '<div class="showcase-card-rtp">RTP ' + g.rtp + '% · ' + g.studio + '</div>'
        // Now omits the RTP prefix and the g.rtp expression entirely.
        expect(INDEX_HTML).not.toMatch(/showcase-card-rtp[^"']*"[^>]*>RTP ['"][\s+]*\+[\s+]*g\.rtp/);
        expect(INDEX_HTML).not.toMatch(/'RTP '\s*\+\s*g\.rtp/);
    });
});
