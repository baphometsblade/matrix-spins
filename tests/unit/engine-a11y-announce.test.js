'use strict';

/**
 * Locks in the screen-reader spin-outcome announcer in casino-engine.js.
 *
 * The visual .ce-winstrip is NOT an ARIA live region, so before this a
 * screen-reader player got zero feedback after a spin (no idea whether they won
 * or what their balance is) — a WCAG 2.1 AA 4.1.3 (Status Messages) gap on the
 * core gameplay loop. The engine now keeps a visually-hidden polite live region
 * (.ce-sr-announce) and writes the outcome + balance to it once per spin.
 *
 * jest can't drive the browser engine, so this guards the source contract.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'casino-engine.js'), 'utf8');
const DIST = path.join(ROOT, 'dist', 'js', 'casino-engine.js');

describe('casino-engine screen-reader spin announcer (WCAG 4.1.3)', () => {
  test('creates a polite, atomic live region (.ce-sr-announce)', () => {
    expect(SRC).toMatch(/class:\s*'ce-sr-announce'/);
    expect(SRC).toMatch(/'aria-live':\s*'polite'/);
    expect(SRC).toMatch(/'aria-atomic':\s*'true'/);
    // role=status is the appropriate implicit-live role
    expect(SRC).toMatch(/role:\s*'status'/);
  });

  test('the live region is visually hidden (sr-only), not display:none (which kills announcements)', () => {
    const rule = SRC.match(/\.ce-sr-announce\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule[1];
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/width:\s*1px/);
    expect(body).toMatch(/overflow:\s*hidden/);
    // must NOT be display:none / visibility:hidden — those suppress SR output
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
  });

  test('writes the spin outcome + balance to the announcer after a spin', () => {
    // The announce write reuses the winStrip text and the final balance.
    expect(SRC).toMatch(/this\.srAnnounce\.textContent\s*=/);
    expect(SRC).toMatch(/Balance \$\{fmt\(this\.state\.balanceCents\)\}/);
    // It must run guarded (the region may not exist on older cached engines)
    expect(SRC).toMatch(/if\s*\(this\.srAnnounce\)/);
  });

  test('dist/js/casino-engine.js mirrors the source (build/copy propagated)', () => {
    if (!fs.existsSync(DIST)) { console.warn('[engine-a11y] dist mirror missing'); return; }
    const dist = fs.readFileSync(DIST, 'utf8');
    expect(dist.includes("class: 'ce-sr-announce'")).toBe(true);
    expect(dist).toMatch(/this\.srAnnounce\.textContent\s*=/);
  });
});
