'use strict';

/**
 * Lock-in for the GET /api/balance response contract.
 *
 * BUG (fixed 2026-06-03): the route returned only `{ balance }` (dollars), but
 * the wallet UI (wallet.html) and the slot engine boot (casino-engine.js) read
 * cents-suffixed fields — availableCents / balanceCents / lockedCents. So every
 * balance on the site rendered $0.00 (wallet tiles, topbar chip, game-page boot).
 * This was the same class of client↔server field mismatch that broke spins, and
 * invisible for the same reason: API tests asserted on the server's `{ balance }`
 * shape and never exercised the browser's `*Cents` reads.
 *
 * The route now ALSO emits bonusBalance + balanceCents/availableCents/lockedCents/
 * totalCents (keeping `balance` in dollars for back-compat). These assertions fail
 * if any of those fields is dropped again.
 */

const { setupTestDb, teardownTestDb, resetTables } = require('../helpers/test-db');
const { buildApp } = require('../helpers/test-app');
const request = require('supertest');

let app;
let _ip = 0;
function nextIp() { _ip++; return `10.61.${Math.floor(_ip / 256)}.${_ip % 256}`; }

beforeAll(async () => {
  await setupTestDb();
  app = buildApp({
    routes: [
      { prefix: '/api/auth', modulePath: '../../server/routes/auth.routes' },
      { prefix: '/api/balance', modulePath: '../../server/routes/balance.routes' },
    ],
  });
});
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await resetTables('users', 'transactions'); });

async function registerWithBalances(username, balance, bonus) {
  const reg = await request(app).post('/api/auth/register').set('X-Forwarded-For', nextIp()).send({
    username, email: `${username}@test.com`, password: 'StrongPass1!',
    dateOfBirth: '1990-01-01', acceptTerms: true,
  });
  const token = reg.body.token;
  const userId = reg.body.user.id;
  const db = require('../../server/database');
  await db.run('UPDATE users SET balance = ?, bonus_balance = ? WHERE id = ?', [balance, bonus, userId]);
  return token;
}

describe('GET /api/balance — cents-field contract', () => {
  test('emits availableCents / balanceCents / lockedCents / totalCents + bonusBalance', async () => {
    const token = await registerWithBalances('bal_contract', 64.81, 9200.13);
    const res = await request(app).get('/api/balance').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    // back-compat dollars field still present
    expect(res.body.balance).toBeCloseTo(64.81, 2);
    // the cents fields the wallet + engine read — must be integers in CENTS
    expect(res.body.availableCents).toBe(6481);
    expect(res.body.balanceCents).toBe(6481);
    expect(res.body.lockedCents).toBe(920013);
    expect(res.body.totalCents).toBe(6481 + 920013);
    expect(res.body.bonusBalance).toBeCloseTo(9200.13, 2);
    // never NaN/undefined (the symptom of the bug)
    for (const k of ['availableCents', 'balanceCents', 'lockedCents', 'totalCents']) {
      expect(Number.isInteger(res.body[k])).toBe(true);
    }
  });

  test('zero balances return 0 cents, not undefined', async () => {
    const token = await registerWithBalances('bal_zero', 0, 0);
    const res = await request(app).get('/api/balance').set('Authorization', `Bearer ${token}`);
    expect(res.body.availableCents).toBe(0);
    expect(res.body.lockedCents).toBe(0);
    expect(res.body.totalCents).toBe(0);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/balance');
    expect(res.statusCode).toBe(401);
  });
});
