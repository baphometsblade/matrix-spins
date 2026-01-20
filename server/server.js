require('dotenv').config(); // Load environment variables
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises; // Use promises-based fs for async operations
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const lockfile = require('proper-lockfile');

const app = express();
const port = 3000;

// Configure CORS for a specific origin
const corsOptions = {
  origin: 'http://localhost:8080',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

const DB_PATH = path.join(__dirname, 'users.json');

// --- Atomic Helper Functions with File Locking ---
// --- Atomic Helper Functions with File Locking ---
const readUsers = async () => {
    // This function is now only for reading, not for updates.
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
};

// A higher-order function to handle atomic updates to the users.json file.
// It takes a callback function that performs the desired modifications.
const updateUsersAtomically = async (updateCallback) => {
    await lockfile.lock(DB_PATH, { retries: 5 });
    try {
        const data = await fs.readFile(DB_PATH, 'utf8');
        const users = JSON.parse(data);

        // The callback receives the user data and can return a new version of it,
        // along with any other data it needs to send back.
        const result = await updateCallback(users);

        // If the callback returned new user data, write it to the file.
        if (result.updatedUsers) {
            await fs.writeFile(DB_PATH, JSON.stringify(result.updatedUsers, null, 2));
        }

        return result;
    } finally {
        await lockfile.unlock(DB_PATH);
    }
};

// --- API Endpoints ---
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        const { error } = await updateUsersAtomically(async (users) => {
            if (users.find(u => u.username === username)) {
                return { error: 'Username already exists.' };
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = { username, password: hashedPassword, balance: 1000 };
            users.push(newUser);
            return { updatedUsers: users };
        });

        if (error) {
            return res.status(400).json({ message: error });
        }

        res.status(201).json({ message: 'User registered successfully.' });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined. Please create a .env file.");
    process.exit(1);
}

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await readUsers(); // Use async read

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

app.post('/update-balance', authenticateToken, async (req, res) => {
    try {
        const { username, amount } = req.body;

        if (typeof amount !== 'number' || !isFinite(amount)) {
            return res.status(400).json({ message: 'Invalid amount provided.' });
        }
        if (req.user.username !== username) {
            return res.status(403).json({ message: 'Forbidden.' });
        }

        const { error, newBalance } = await updateUsersAtomically((users) => {
            const user = users.find(u => u.username === username);
            if (!user) {
                return { error: 'User not found.' };
            }
            user.balance += amount;
            return { updatedUsers: users, newBalance: user.balance };
        });

        if (error) {
            return res.status(404).json({ message: error });
        }

        res.json({ newBalance });
    } catch (error) {
        console.error("Update balance error:", error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

app.get('/verify-token', authenticateToken, async (req, res) => {
    // If the middleware passes, the token is valid.
    // We can now get the user's balance and send it back.
    const users = await readUsers(); // Use async read
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
