const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const lockfile = require('proper-lockfile');

const USERS_DB = path.join(__dirname, '..', 'users.json');

// User Registration
router.post('/register', async (req, res) => {
  let release;
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    release = await lockfile.lock(USERS_DB, { retries: 5 });

    const usersData = await fs.readFile(USERS_DB, 'utf8');
    const users = JSON.parse(usersData);

    if (users[username]) {
      return res.status(409).json({ message: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    users[username] = {
      password: hashedPassword,
      balance: 1000, // Starting balance
      loyaltyPoints: 0,
      progressiveJackpot: 100000,
    };

    await fs.writeFile(USERS_DB, JSON.stringify(users, null, 2));

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (release) {
      await release();
    }
  }
});

// User Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const usersData = await fs.readFile(USERS_DB, 'utf8');
    const users = JSON.parse(usersData);

    const user = users[username];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.sendStatus(401); // Unauthorized
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Forbidden
    }
    req.user = user;
    next();
  });
};

// Protected route to get user data
router.get('/user/data', authenticateToken, async (req, res) => {
  try {
    const usersData = await fs.readFile(USERS_DB, 'utf8');
    const users = JSON.parse(usersData);
    const user = users[req.user.username];

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { password, ...userData } = user;
    res.json(userData);
  } catch (error) {
    console.error('Get user data error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Protected route for slot machine spin
router.post('/spin', authenticateToken, async (req, res) => {
  let release;
  try {
    const { bet } = req.body;
    const { username } = req.user;

    if (!bet || typeof bet !== 'number' || bet <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }

    release = await lockfile.lock(USERS_DB, { retries: 5 });

    const usersData = await fs.readFile(USERS_DB, 'utf8');
    const users = JSON.parse(usersData);
    const user = users[username];

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.balance < bet) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Game Logic
    user.balance -= bet;
    const winMultiplier = Math.random() < 0.3 ? Math.floor(Math.random() * 10 + 1) : 0;
    const winAmount = bet * winMultiplier;

    if (winAmount > 0) {
      user.balance += winAmount;
    }

    user.loyaltyPoints += Math.ceil(bet * 0.1);
    user.progressiveJackpot += bet * 0.01;

    await fs.writeFile(USERS_DB, JSON.stringify(users, null, 2));

    res.json({
      winAmount,
      balance: user.balance,
      loyaltyPoints: user.loyaltyPoints,
      progressiveJackpot: user.progressiveJackpot,
    });

  } catch (error) {
    console.error('Spin error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (release) {
      await release();
    }
  }
});

module.exports = router;
