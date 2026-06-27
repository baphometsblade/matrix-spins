'use strict';

/**
 * Money-safety wiring locks (2026-06-27 revenue-path audit fixes).
 *
 * These are source-level assertions (the wiring lives in boot code that's
 * awkward to exercise in a unit test). They lock the audit fixes against
 * regression — a future refactor that drops any of them fails CI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const indexJs = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
const configJs = fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');

describe('revenue-path audit — wiring locks', () => {
    test('/api/spin is protected by the degraded-mode guard (no spins on ephemeral DB)', () => {
        expect(indexJs).toMatch(/app\.use\(\s*['"]\/api\/spin['"]\s*,\s*degradedModeGuard\s*\)/);
    });

    test('production fails fast on missing core secrets (does not boot half-broken)', () => {
        expect(indexJs).toMatch(/FATAL_ENV\s*=/);
        expect(indexJs).toMatch(/process\.exit\(1\)/);
        // The confirmed-present core set must be covered.
        for (const v of ['DATABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'ADMIN_PASSWORD']) {
            expect(indexJs).toContain(v);
        }
    });

    test('KYC enforcement fails CLOSED (503) in production when the module is unavailable', () => {
        // Must NOT silently next() past a money-safety check in production.
        expect(indexJs).toMatch(/KYC enforcement unavailable/);
        expect(indexJs).toMatch(/status\(503\)/);
        expect(indexJs).toMatch(/_kycCache\.failed\s*=\s*true/);
    });

    test('config exports ALLOWED_ORIGIN (Stripe redirect URLs resolve correctly)', () => {
        expect(configJs).toMatch(/ALLOWED_ORIGIN\s*:/);
    });
});
