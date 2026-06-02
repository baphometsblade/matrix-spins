'use strict';

/**
 * Lock-in for the browser slot engine's spin-response handling.
 *
 * BUG (fixed 2026-06-03): the casino engine and the /api/spin route spoke
 * different vocabularies. The server returns
 *     { grid, winAmount (dollars), balance (dollars), winDetails, ... }
 * but the engine read
 *     { reels, payoutCents, balanceAfterCents, lineWins, ... }.
 * So `result.reels[r]` (the reel-stop loop) threw on EVERY spin and the UI
 * hung (spin button stuck disabled, no win shown). Together with the
 * `bet`/`betAmount` field mismatch (see tests/integration/spin-flow.test.js)
 * the browser slot UI could never complete a single spin.
 *
 * Fix: js/casino-engine.js `_normalizeSpinResult()` bridges the two shapes
 * before the reel-stop loop. These source-level assertions fail if the bridge
 * is removed or stops mapping the load-bearing fields. (The engine is a browser
 * module that needs window/document, so we lock the contract at the source
 * level — the live behaviour is covered by manual + preview verification.)
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../js/casino-engine.js'),
  'utf8'
);

describe('casino-engine spin-response normalization', () => {
  test('defines _normalizeSpinResult and calls it before the reel-stop loop', () => {
    expect(SRC).toMatch(/_normalizeSpinResult\s*\(/);
    // It must be invoked on the spin result (not just defined).
    expect(SRC).toMatch(/result\s*=\s*this\._normalizeSpinResult\(\s*result\s*\)/);
  });

  test('maps the server fields onto the engine field names', () => {
    const body = SRC.slice(SRC.indexOf('_normalizeSpinResult'));
    // grid -> reels
    expect(body).toMatch(/\.reels\s*=\s*r\.grid/);
    // winAmount (dollars) -> payoutCents (×100)
    expect(body).toMatch(/payoutCents\s*=\s*Math\.round\(\s*r\.winAmount\s*\*\s*100\s*\)/);
    // balance (dollars) -> balanceAfterCents (×100)
    expect(body).toMatch(/balanceAfterCents\s*=\s*Math\.round\(\s*r\.balance\s*\*\s*100\s*\)/);
    // multiplier must default (avoids "×undefined" in the win strip)
    expect(body).toMatch(/multiplier/);
    // lineWins must default to an array (the highlight loop does lineWins.forEach)
    expect(body).toMatch(/lineWins/);
  });

  test('the reel-stop loop still reads result.reels (the field the bridge fills)', () => {
    expect(SRC).toMatch(/result\.reels\[\s*r\s*\]/);
  });
});
