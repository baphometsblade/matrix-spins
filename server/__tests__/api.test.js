const request = require('supertest');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const apiRoutes = require('../routes/api');

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

const USERS_DB = path.join(__dirname, '..', 'users.json');

beforeEach(async () => {
  await fs.writeFile(USERS_DB, JSON.stringify({}));
});

describe('API Endpoints', () => {
  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password',
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('message', 'User registered successfully');
  });

  it('should not register a user with a duplicate username', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password',
      });
    const res = await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password',
      });
    expect(res.statusCode).toEqual(409);
  });

  it('should log in a user and return a token', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password',
      });
    const res = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'password',
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('token');
  });

  it('should not log in a user with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'wrongpassword',
      });
    expect(res.statusCode).toEqual(401);
  });

  it('should access protected user data with a valid token', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password',
      });
    const loginRes = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'password',
      });
    const token = loginRes.body.token;
    const res = await request(app)
      .get('/api/user/data')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('balance', 1000);
  });

  it('should perform a spin and update user data', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password',
      });
    const loginRes = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'password',
      });
    const token = loginRes.body.token;
    const res = await request(app)
      .post('/api/spin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        bet: 10,
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('balance');
    expect(res.body).toHaveProperty('winAmount');
    expect(res.body).toHaveProperty('loyaltyPoints');
    expect(res.body).toHaveProperty('progressiveJackpot');
    expect(res.body).toHaveProperty('reels');
    expect(res.body).toHaveProperty('isJackpotWin');
  });
});
