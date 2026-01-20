const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();

    if (users.find(u => u.username === username)) {
        return res.status(400).json({ message: 'Username already exists.' });
    }

    const newUser = { username, password, balance: 1000 };
    users.push(newUser);
    writeUsers(users);

    res.status(201).json({ message: 'User registered successfully.' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();

    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        res.json({
            message: 'Login successful.',
            token: `mock_token_${username}_${Date.now()}`,
            balance: user.balance
        });
    } else {
        res.status(401).json({ message: 'Invalid credentials.' });
    }
});

app.listen(port, () => {
    console.log(`Casino server listening at http://localhost:${port}`);
});
