'use strict';

/**
 * Client-code no-undef gate (regression lock).
 *
 * Background: the browser modules under js/ are excluded from the main
 * eslint run via .eslintignore, so they had ZERO no-undef coverage. That
 * gap let a `ReferenceError: api is not defined` ship to production
 * (commit e4c25de4) — `const api = window.MatrixSpinsAPI` was declared
 * only inside _spin(), but _spinWithRetry()/_reconcilePendingSpin()
 * referenced a bare `api` from sibling scope. Under 'use strict' that
 * throws on EVERY spin. jest passed because it exercises server routes
 * via supertest, never the browser spin path.
 *
 * This test runs `npm run lint:client` (a strict no-undef eslint pass
 * over the self-contained client modules, using .eslintrc.client.json)
 * and fails the suite if any client module references an undefined
 * identifier. It closes the exact gap that caused the outage.
 *
 * Pure child-process shell-out — no DB, no mocks. ~3-5s.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('client modules — no-undef gate', () => {
    test('lint:client passes (no undefined identifiers in browser modules)', () => {
        let failed = false;
        let output = '';
        try {
            // npm is invoked via the platform shell. On Windows the npm
            // shim is npm.cmd; execFileSync with shell:true resolves both.
            output = execFileSync('npm', ['run', '--silent', 'lint:client'], {
                cwd: ROOT,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
        } catch (err) {
            failed = true;
            output = (err.stdout || '') + (err.stderr || '');
        }
        if (failed) {
            throw new Error(
                'Client no-undef lint failed — a browser module references an ' +
                'undefined identifier (e.g. a method-local const used from a ' +
                'sibling method, like the `api` ReferenceError that broke every ' +
                'spin in commit e4c25de4). Run `npm run lint:client` to see ' +
                'details.\n\n' + output
            );
        }
        expect(failed).toBe(false);
    });
});
