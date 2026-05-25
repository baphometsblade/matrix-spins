'use strict';

/**
 * Lock-in regression test for the CRITICAL exploit fixed in this commit.
 *
 * Two public endpoints — `/api/tournament/:id/record-spin` and
 * `/api/slot-race/record-spin` — used to accept `{ betAmount, winAmount }`
 * directly from the player's request body and feed those values into the
 * tournament/race leaderboard scoring. A malicious player could POST
 * `{ winAmount: 999999, betAmount: 1 }` and instantly top the leaderboard,
 * winning the prize pool. The slot-race `lucky_strike` race type was
 * especially exploitable (score = max winAmount the player has reported).
 *
 * Both endpoints are now 410 Gone. The canonical scoring path is
 * `/api/spin` which calls `tournamentService.submitSpin` and
 * `slotRace.recordSpinInternal` with the server-computed `winAmount`
 * (see `server/routes/spin.routes.js` around the post-resolve block).
 *
 * If this test fails, someone has re-introduced the score-injection
 * exploit — DO NOT MERGE.
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.77.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/tournament', modulePath: '../../server/routes/tournament.routes' },
            { prefix: '/api/slot-race', modulePath: '../../server/routes/slot-race.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users'); });

async function registerUser(username) {
    const res = await request(app)
        .post('/api/auth/register')
        .set('X-Forwarded-For', nextIp())
        .send({
            username,
            email: `${username}@test.com`,
            password: 'StrongPass1!',
            dateOfBirth: '1990-01-01',
            acceptTerms: true,
        });
    return { token: res.body.token, userId: res.body.user.id };
}

describe('Score-injection exploit is blocked', () => {
    test('POST /api/tournament/:id/record-spin rejects client-supplied winAmount with 410 Gone', async () => {
        const { token } = await registerUser('si_tournament');

        const res = await request(app)
            .post('/api/tournament/1/record-spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ winAmount: 999999, betAmount: 1 });

        expect(res.statusCode).toBe(410);
        expect(String(res.body.error || '')).toMatch(/removed for security/i);
    });

    test('POST /api/slot-race/record-spin rejects client-supplied winAmount with 410 Gone', async () => {
        const { token } = await registerUser('si_slotrace');

        const res = await request(app)
            .post('/api/slot-race/record-spin')
            .set('Authorization', `Bearer ${token}`)
            .send({ winAmount: 999999, betAmount: 1 });

        expect(res.statusCode).toBe(410);
        expect(String(res.body.error || '')).toMatch(/removed for security/i);
    });

    test('slot-race route module still exports recordSpinInternal for server-side use', async () => {
        // The 410 only blocks the public endpoint. The internal hook used by
        // /api/spin must still exist so spin.routes.js can submit trusted
        // server-computed values. If this export disappears, the slot-race
        // leaderboard stops updating silently.
        const slotRace = require('../../server/routes/slot-race.routes');
        expect(typeof slotRace.recordSpinInternal).toBe('function');
    });
});
