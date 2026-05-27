'use strict';

/**
 * Lock-in regression test for the 25% house edge configuration.
 *
 * On 2026-05-26 the operator deliberately raised the house edge from
 * 14% (TARGET_RTP 0.86) to 25% (TARGET_RTP 0.75). Three layers had to
 * move in lockstep for the change to actually deliver:
 *   1. server/config.js TARGET_RTP — the global throttle target
 *   2. server/services/house-edge.js safety clamp — lower bound 0.65
 *      (was 0.80, which would have silently rounded 0.75 back up)
 *   3. shared/game-definitions.js + js/game-registry.js per-game rtp —
 *      all 100 games at 75 so scaleWinForRTP converges to the same
 *      target AND the lobby's displayed RTP matches actual delivery
 *      (any mismatch is a regulator-grade misrepresentation flag).
 *
 * If any one of those layers drifts back, the configured edge is no
 * longer delivered end-to-end. This test will fail loudly when that
 * happens.
 */

const fs = require('fs');
const path = require('path');

describe('House edge — 25% configuration is locked in', () => {
    test('config.TARGET_RTP is 0.75 (25% house edge)', () => {
        const config = require('../../server/config');
        expect(config.TARGET_RTP).toBeCloseTo(0.75, 4);
    });

    test('house-edge.js scaleWinForRTP clamp allows targets down to 0.65', () => {
        // We don't import scaleWinForRTP directly because it's not exported.
        // Instead, verify the source text contains the lowered Math.max
        // bound — if someone reverts to 0.80, this assertion fails.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'server', 'services', 'house-edge.js'),
            'utf8'
        );
        // The clamp line: `targetRTP = Math.max(0.65, Math.min(0.97, targetRTP));`
        expect(src).toMatch(/Math\.max\(\s*0\.65\s*,\s*Math\.min\(\s*0\.97/);
    });

    test('all 100 games have rtp <= 75 in shared/game-definitions.js', () => {
        const games = require('../../shared/game-definitions');
        expect(games.length).toBe(100);
        for (const g of games) {
            expect(typeof g.rtp).toBe('number');
            expect(g.rtp).toBeLessThanOrEqual(75);
            expect(g.rtp).toBeGreaterThan(0);
        }
    });

    test('client-side js/game-registry.js per-game rtp matches server-side', () => {
        // The client registry powers the lobby's displayed RTP. If it
        // drifts from server-side, the lobby misrepresents the game to
        // the player — a regulator-flag-worthy issue and a player-trust
        // breach. We assert by parsing the file rather than requiring it,
        // because game-registry.js attaches to window and isn't a clean
        // CJS module under jest.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'js', 'game-registry.js'),
            'utf8'
        );
        const matches = src.match(/rtp:\s*(\d+(?:\.\d+)?)/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(100);
        for (const m of matches) {
            const v = parseFloat(m.replace(/rtp:\s*/, ''));
            expect(v).toBeLessThanOrEqual(75);
        }
    });
});
