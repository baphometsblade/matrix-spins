const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, 'users.json');

// --- Helper Functions ---
const readUsers = () => {
    const data = fs.readFileSync(DB_PATH);
    return JSON.parse(data);
};

const writeUsers = (users) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
};

// --- API Endpoints ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();

    if (users.find(u => u.username === username)) {
        return res.status(400).json({ message: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { username, password: hashedPassword, balance: 1000 };
    users.push(newUser);
    writeUsers(users);

    res.status(201).json({ message: 'User registered successfully.' });
});

const JWT_SECRET = 'your_super_secret_key_that_should_be_in_an_env_file';

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();

    const user = users.find(u => u.username === username);

    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.json({
            message: 'Login successful.',
            token: token,
            balance: user.balance
        });
    } else {
        res.status(401).json({ message: 'Invalid credentials.' });
    }
});

// --- JWT Security Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Invalid token
        req.user = user;
        next();
    });
};

app.post('/update-balance', authenticateToken, (req, res) => {
    const { username, amount } = req.body;
    const users = readUsers();

    const user = users.find(u => u.username === username);

    if (user) {
        user.balance += amount;
        writeUsers(users);
        res.json({ newBalance: user.balance });
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

app.get('/verify-token', authenticateToken, (req, res) => {
    // If the middleware passes, the token is valid.
    // We can now get the user's balance and send it back.
    const users = readUsers();
    const user = users.find(u => u.username === req.user.username);
    if (user) {
        res.json({
            message: 'Token is valid.',
            username: user.username,
            balance: user.balance
        });
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

app.listen(port, () => {
    console.log(`Casino server listening at http://localhost:${port}`);
});
