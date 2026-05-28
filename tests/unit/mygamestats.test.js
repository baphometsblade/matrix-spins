'use strict';

/**
 * Regression coverage for GET /api/games/:id/my-stats — the per-game
 * personal-stats endpoint surfaced in the slot info modal.
 *
 * Locks the contract:
 *   - 401 without auth
 *   - 404 on an unknown game id (registry validation)
 *   - zeroed shape for a player with no spins on the game
 *   - correct aggregates (count / wagered / won / biggest / net) after spins
 *   - stats are scoped to (user_id × game_id) — one player's spins on a
 *     different game must not leak into another game's totals
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.91.${Math.floor(_ip / 256)}.${_ip % 256}`; }

// A real production slug from js/game-registry.js — the route validates
// :id against the registry, so a made-up id would 404.
const GAME_A = 'golden-cherry-cascade';
const GAME_B = 'dragon-golden-fortune';

beforeAll(async () => {
    await setupTestDb();
    app = buildApp({
        routes: [
            { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
            { prefix: '/api/games', modulePath: '../../server/routes/mygamestats.routes' },
        ],
    });
});

afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'spins'); });

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

async function insertSpin(userId, gameId, bet, win) {
    const db = require('../../server/database');
    await db.run(
        'INSERT INTO spins (user_id, game_id, bet_amount, result_grid, win_amount, rng_seed) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, gameId, bet, '[]', win, 'seed']
    );
}

describe('GET /api/games/:id/my-stats', () => {
    test('returns 401 without auth', async () => {
        const res = await request(app).get(`/api/games/${GAME_A}/my-stats`);
        expect(res.statusCode).toBe(401);
    });

    test('returns 404 for an unknown game id', async () => {
        const { token } = await registerUser('unknowngame');
        const res = await request(app)
            .get('/api/games/not-a-real-game-xyz/my-stats')
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(404);
    });

    test('returns a zeroed shape for a player with no spins', async () => {
        const { token } = await registerUser('freshplayer');
        const res = await request(app)
            .get(`/api/games/${GAME_A}/my-stats`)
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.spinCount).toBe(0);
        expect(res.body.totalWagered).toBe(0);
        expect(res.body.totalWon).toBe(0);
        expect(res.body.biggestWin).toBe(0);
        expect(res.body.netResult).toBe(0);
        expect(res.body.lastPlayed).toBeNull();
    });

    test('aggregates spins correctly', async () => {
        const { token, userId } = await registerUser('activeplayer');
        // 3 spins: bets 1.00 / 2.00 / 2.00 (= 5.00), wins 0 / 10.00 / 1.00 (= 11.00)
        await insertSpin(userId, GAME_A, 1.0, 0.0);
        await insertSpin(userId, GAME_A, 2.0, 10.0);
        await insertSpin(userId, GAME_A, 2.0, 1.0);

        const res = await request(app)
            .get(`/api/games/${GAME_A}/my-stats`)
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.spinCount).toBe(3);
        expect(res.body.totalWagered).toBeCloseTo(5.0, 2);
        expect(res.body.totalWon).toBeCloseTo(11.0, 2);
        expect(res.body.biggestWin).toBeCloseTo(10.0, 2);
        expect(res.body.netResult).toBeCloseTo(6.0, 2);   // 11 - 5
        expect(res.body.averageBet).toBeCloseTo(5 / 3, 2);
        expect(res.body.lastPlayed).not.toBeNull();
    });

    test('is scoped per game — other games do not leak in', async () => {
        const { token, userId } = await registerUser('multigame');
        await insertSpin(userId, GAME_A, 1.0, 5.0);
        await insertSpin(userId, GAME_B, 99.0, 0.0); // big bet on a DIFFERENT game

        const res = await request(app)
            .get(`/api/games/${GAME_A}/my-stats`)
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.spinCount).toBe(1);
        expect(res.body.totalWagered).toBeCloseTo(1.0, 2); // NOT 100
    });
});
