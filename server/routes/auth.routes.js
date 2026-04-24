const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');
const { authenticate, blacklistToken } = require('../middleware/auth');

const crypto = require('crypto');
const fraudDetection = require('../services/fraud-detection');

const router = express.Router();
const emailService = require('../services/email.service');

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

// Dummy hash for constant-time auth when user not found (prevents timing attacks)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-never-matches', 13);

// Top ~50 breach-list passwords (condensed). A full list (hundreds of
// thousands) would belong in a file or k-anon HIBP API, but for a
// casino operator the bar is "obvious guesses MUST fail" — this
// catches every common password a bot would try first.
// Stored lowercased; comparison is also lowercased.
const COMMON_PASSWORDS = new Set([
    'password', 'password1', 'password123', 'password!', 'p@ssw0rd', 'passw0rd',
    '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyui', 'qwertyuiop',
    'letmein1', 'admin123', 'administrator', 'welcome1', 'welcome123',
    'abc12345', 'iloveyou', 'monkey123', 'dragon123', 'master123',
    'football', 'baseball', 'superman', 'batman123', 'pokemon1',
    'summer2024', 'summer2025', 'summer2026', 'winter2024', 'winter2025',
    'january1', 'december', 'ch@ng3me', 'changeme1', 'secret01', 'secret123',
    'trustno1', 'whatever', 'starwars', 'princess', 'michael1',
    'jennifer1', 'michelle', 'matthew1', 'password12',
    // casino-specific obvious guesses
    'casino123', 'jackpot1', 'winner123', 'gambler1', 'blackjack1',
    'matrix123', 'matrixspins', 'msaart2026',
]);

/**
 * Validate password strength
 * @param {string} password - The password to validate
 * @param {object} [ctx] - Optional context ({ username, email }) to block
 *                        using identity fields as the password.
 * @returns {string[]} Array of issues, empty if valid
 */
function validatePassword(password, ctx) {
    const issues = [];
    if (!password || typeof password !== 'string') {
        issues.push('at least 8 characters');
        return issues;
    }
    if (password.length < 8) issues.push('at least 8 characters');
    if (password.length > 128) issues.push('no more than 128 characters');
    if (!/[A-Z]/.test(password)) issues.push('an uppercase letter');
    if (!/[a-z]/.test(password)) issues.push('a lowercase letter');
    if (!/[0-9]/.test(password)) issues.push('a number');
    if (!/[^A-Za-z0-9]/.test(password)) issues.push('a special character');

    const lc = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lc)) {
        issues.push('(this password is on the public breach list — choose something unique)');
    }
    if (ctx && ctx.username && lc.includes(String(ctx.username).toLowerCase())) {
        issues.push('(must not contain your username)');
    }
    if (ctx && ctx.email) {
        const local = String(ctx.email).split('@')[0].toLowerCase();
        if (local && local.length >= 4 && lc.includes(local)) {
            issues.push('(must not contain your email local-part)');
        }
    }

    return issues;
}

/**
 * Calculate age from date-of-birth, matching the standard calendar algorithm
 * (handles timezone/birthday edge cases correctly — a person born 2008-04-20
 * is 18 on 2026-04-20 regardless of timezone).
 */
function calculateAge(dob, today) {
    today = today || new Date();
    let age = today.getUTCFullYear() - dob.getUTCFullYear();
    const m = today.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
    return age;
}

/** Hash a token so its plaintext is never stored. The plaintext lives only
 *  in the verification/reset email sent to the user. */
function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Generate an 8-char uppercase alphanumeric referral code */
function generateReferralCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Failed login tracking for account lockout
const failedLogins = new Map(); // userId -> { count, lockedUntil }
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Cleanup interval for failedLogins Map (every 15 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [userId, record] of failedLogins) {
        if (record.lockedUntil < now && record.count === 0) {
            failedLogins.delete(userId);
        }
    }
}, 15 * 60 * 1000);

// IP-based registration rate limiter (prevents bot farm signup abuse)
const registrationAttempts = new Map(); // IP -> { count, firstAttempt }
const REG_MAX_PER_HOUR = 3;
const REG_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRegistrationRate(ip) {
    const now = Date.now();
    const record = registrationAttempts.get(ip);
    if (!record || (now - record.firstAttempt > REG_WINDOW_MS)) {
        registrationAttempts.set(ip, { count: 1, firstAttempt: now });
        return true;
    }
    if (record.count >= REG_MAX_PER_HOUR) {
        return false;
    }
    record.count++;
    return true;
}

// Clean up old registration tracking entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of registrationAttempts) {
        if (now - record.firstAttempt > REG_WINDOW_MS) registrationAttempts.delete(ip);
    }
}, 10 * 60 * 1000);
// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        // Check IP-based registration rate limit
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        if (!checkRegistrationRate(clientIp)) {
            return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
        }

        const { username, email, password, referralCode, dateOfBirth, acceptTerms } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required' });
        }

        // Age verification (18+ required for gambling) — uses UTC-safe
        // calculateAge() helper to correctly handle leap years and timezone edge cases.
        if (!dateOfBirth || typeof dateOfBirth !== 'string') {
            return res.status(400).json({ error: 'Date of birth is required' });
        }
        const dob = new Date(dateOfBirth);
        if (isNaN(dob.getTime())) {
            return res.status(400).json({ error: 'Invalid date of birth' });
        }
        // Reject future dates and unreasonable past dates (pre-1900)
        if (dob > new Date() || dob < new Date('1900-01-01')) {
            return res.status(400).json({ error: 'Invalid date of birth' });
        }
        const age = calculateAge(dob);
        if (age < 18) {
            return res.status(403).json({ error: 'You must be 18 or older to register' });
        }
        if (age > 120) {
            return res.status(400).json({ error: 'Invalid date of birth' });
        }

        // Terms & conditions acceptance required
        if (!acceptTerms) {
            return res.status(400).json({ error: 'You must accept the Terms & Conditions and Privacy Policy' });
        }
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username must be 3-20 characters' });
        }
        const passwordIssues = validatePassword(password, { username, email });
        if (passwordIssues.length > 0) {
            return res.status(400).json({ error: `Password must contain ${passwordIssues.join(', ')}` });
        }
        if (email.length > 254) {
            return res.status(400).json({ error: 'Email address too long' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
        }

        // Check existing
        const existingUser = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser) {
            return res.status(409).json({ error: 'Username or email already taken' });
        }

        // Resolve referrer if a referral code was provided
        let referrerId = null;
        if (referralCode && typeof referralCode === 'string') {
            const referrer = await db.get(
                'SELECT id FROM users WHERE referral_code = ?',
                [referralCode.trim().toUpperCase()]
            );
            if (referrer) {
                referrerId = referrer.id;
            }
        }

        // Generate a unique referral code for the new user
        let newReferralCode = generateReferralCode();
        // Retry up to 5 times on collision (extremely unlikely with 4 random bytes)
        for (let i = 0; i < 5; i++) {
            const dup = await db.get('SELECT id FROM users WHERE referral_code = ?', [newReferralCode]);
            if (!dup) break;
            newReferralCode = generateReferralCode();
        }

        const passwordHash = bcrypt.hashSync(password, 13);
        const startBalance = config.DEFAULT_BALANCE;
        const SIGNUP_WAGERING_MULT = 25;

        // Store DOB as ISO date (YYYY-MM-DD) for audit trail and future age re-verification.
        // The date_of_birth, registration_ip, and terms_accepted_at columns are declared in
        // the canonical schema (server/db/schema-sqlite.js + schema-pg.js USER_MIGRATIONS).
        const dobIso = dob.toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();

        // Signup bonus goes to bonus_balance with wagering requirement (prevents bot farm withdrawals)
        // terms_version is set so we know exactly WHICH version of the terms the user accepted
        // (required for re-consent flow when terms are materially revised)
        const result = await db.run(
            'INSERT INTO users (username, email, password_hash, balance, bonus_balance, wagering_requirement, referral_code, referred_by, email_verified, date_of_birth, registration_ip, terms_accepted_at, terms_version) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [username, email, passwordHash, startBalance, startBalance * SIGNUP_WAGERING_MULT, newReferralCode, referrerId, 0, dobIso, clientIp, nowIso, config.CURRENT_TERMS_VERSION || 1]
        );

        const userId = result.lastInsertRowid;

        // Check for multi-account fraud (fire-and-forget)
        fraudDetection.checkMultiAccountRegistration(clientIp, userId).catch(function(err) { console.warn('[Auth] Fraud check error:', err.message); });

        // Log initial bonus_balance transaction if > 0
        if (startBalance > 0) {
            await db.run(
                'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'bonus', startBalance, 0, startBalance, 'Welcome bonus (bonus credits, ' + SIGNUP_WAGERING_MULT + 'x wagering)']
            );
        }

        // Auto-grant referral bonus to both referrer and new user ($1 each)
        if (referrerId) {
            const REFERRAL_BONUS = 1.00;
            const WAGERING_MULT = 25;
            try {
                // Skip referral bonus if referrer is self-excluded
                var referrerExcluded = false;
                try {
                    var exclRow = await db.get(
                        "SELECT id FROM self_exclusions WHERE user_id = ? AND is_active = 1 AND (ends_at IS NULL OR ends_at > datetime('now'))",
                        [referrerId]
                    );
                    if (exclRow) referrerExcluded = true;
                } catch (exclErr) {
                    if (!exclErr.message || !exclErr.message.includes('no such table')) {
                        console.warn('[Auth] Referrer self-exclusion check failed:', exclErr.message);
                        referrerExcluded = true; // Fail closed
                    }
                }

                if (!referrerExcluded) {
                    // Atomic: referral record + both credits + both transaction logs
                    await db.beginTransaction();
                    try {
                        await db.run(
                            'INSERT INTO referrals (referrer_id, referred_id, bonus_amount) VALUES (?, ?, ?)',
                            [referrerId, userId, REFERRAL_BONUS]
                        );
                        await db.run(
                            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ?, referral_count = COALESCE(referral_count, 0) + 1, referral_bonus_earned = COALESCE(referral_bonus_earned, 0) + ? WHERE id = ?',
                            [REFERRAL_BONUS, REFERRAL_BONUS * WAGERING_MULT, REFERRAL_BONUS, referrerId]
                        );
                        await db.run(
                            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
                            [referrerId, REFERRAL_BONUS, 'Referral bonus — new user joined with your code']
                        );
                        await db.run(
                            'UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?',
                            [REFERRAL_BONUS, REFERRAL_BONUS * WAGERING_MULT, userId]
                        );
                        await db.run(
                            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'bonus', ?, ?)",
                            [userId, REFERRAL_BONUS, 'Welcome bonus — joined via referral code']
                        );
                        await db.commit();
                    } catch (txErr) {
                        await db.rollback().catch(function(rbErr) { console.warn('[Auth] Referral rollback failed:', rbErr.message); });
                        throw txErr;
                    }
                }
            } catch (refErr) {
                // Non-fatal: log but don't fail registration
                console.warn('[Auth] Referral bonus grant failed:', refErr.message);
            }
        }

        // Generate email verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const VERIFICATION_EXPIRY_HOURS = 24;
        const verificationExpiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

        // Store verification token
        await db.run(
            'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [userId, verificationToken, verificationExpiresAt]
        );

        // Send verification email (non-blocking)
        try {
            await emailService.sendVerificationEmail(email, username, verificationToken);
        } catch (emailErr) {
            console.warn('[Auth] Verification email failed:', emailErr.message);
        }

        const token = jwt.sign({ userId }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

        res.status(201).json({
            token,
            user: { id: userId, username, email, balance: 0, bonusBalance: startBalance, referralCode: newReferralCode, referralBonusGranted: !!referrerId },
        });
    } catch (err) {
        console.warn('[Auth] Register error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const user = await db.get('SELECT id, username, email, password_hash, is_banned, email_verified, banned_at, role, balance, is_admin, referral_code FROM users WHERE username = ? OR email = ?', [username, username]);

        // Check account lockout BEFORE bcrypt (saves CPU and prevents timing leaks)
        if (user) {
            const lockRecord = failedLogins.get(user.id);
            if (lockRecord && lockRecord.lockedUntil > Date.now()) {
                const minutesLeft = Math.ceil((lockRecord.lockedUntil - Date.now()) / 60000);
                return res.status(429).json({ error: `Account temporarily locked. Try again in ${minutesLeft} minutes.` });
            }
        }

        // Always run bcrypt comparison (constant-time — prevents user enumeration via timing)
        const hashToCompare = user ? user.password_hash : DUMMY_HASH;
        const passwordValid = bcrypt.compareSync(password, hashToCompare);

        if (!user || !passwordValid) {
            // Track failed attempts for real users
            if (user) {
                const record = failedLogins.get(user.id) || { count: 0, lockedUntil: 0 };
                record.count += 1;
                if (record.count >= MAX_FAILED_ATTEMPTS) {
                    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
                    record.count = 0;
                }
                failedLogins.set(user.id, record);
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: 'Account has been banned' });
        }

        // Successful login — clear failed attempts
        failedLogins.delete(user.id);

        const token = jwt.sign({ userId: user.id }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                balance: user.balance,
                is_admin: !!user.is_admin,
            },
        });
    } catch (err) {
        console.warn('[Auth] Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Bootstrap: create password_reset_tokens table
db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id ${idDef},
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at ${tsDef}
)`).catch(function(e) { if (e && !String(e.message || e).match(/already exists/i)) console.warn('[Auth] Password reset tokens table create failed:', e.message || e); });

// Bootstrap: create email_verification_tokens table
db.run(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id ${idDef},
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0
)`).catch(function(e) { if (e && !String(e.message || e).match(/already exists/i)) console.warn('[Auth] Email verification tokens table create failed:', e.message || e); });

// ROUND 36: Rate limit password reset — max 3 per 15 minutes per IP
var _forgotPasswordAttempts = new Map();
setInterval(function() { _forgotPasswordAttempts.clear(); }, 15 * 60 * 1000);

// IP-based rate limiting for /reset-password and /verify-email (10 attempts per 15 min)
var _resetPwAttempts = new Map();
var _verifyEmailAttempts = new Map();
setInterval(function() { _resetPwAttempts.clear(); _verifyEmailAttempts.clear(); }, 15 * 60 * 1000);

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        // Rate limit
        var fpIp = req.ip || req.connection.remoteAddress || 'unknown';
        var fpCount = _forgotPasswordAttempts.get(fpIp) || 0;
        if (fpCount >= 3) {
            return res.status(429).json({ error: 'Too many reset requests. Please try again later.' });
        }
        _forgotPasswordAttempts.set(fpIp, fpCount + 1);

        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Always return success to prevent email enumeration
        const successMsg = 'If an account with that email exists, a reset link has been sent.';

        const user = await db.get('SELECT id, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (!user) {
            return res.json({ message: successMsg });
        }

        // Generate secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const EXPIRY_HOURS = 1;
        const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

        // Invalidate any existing tokens for this user
        await db.run('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

        // Store the token (ON CONFLICT handles race condition if two requests fire simultaneously)
        await db.run(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at',
            [user.id, resetToken, expiresAt]
        );

        // Build reset URL
        const baseUrl = config.BASE_URL || 'https://msaart.online';
        const resetUrl = `${baseUrl}/?resetToken=${resetToken}`;

        // Send email (non-blocking — don't fail the request if email doesn't send)
        try {
            const emailService = require('../services/email.service');
            await emailService.sendPasswordReset(user.email, resetUrl, EXPIRY_HOURS);
        } catch (emailErr) {
            console.warn('[Auth] Password reset email failed:', emailErr.message);
        }

        res.json({ message: successMsg });
    } catch (err) {
        console.warn('[Auth] Forgot password error:', err.message);
        res.status(500).json({ error: 'Request failed' });
    }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
    try {
        var rpIp = req.ip || req.connection.remoteAddress || 'unknown';
        var rpCount = _resetPwAttempts.get(rpIp) || 0;
        if (rpCount >= 10) return res.status(429).json({ error: 'Too many reset attempts. Try again later.' });
        _resetPwAttempts.set(rpIp, rpCount + 1);

        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }
        if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]+$/.test(token)) {
            return res.status(400).json({ error: 'Invalid reset token format' });
        }

        // Find the token first so we can pass the user's identity to the password validator
        const resetRecord = await db.get(
            'SELECT t.id, t.user_id, t.token, t.expires_at, t.used, u.username, u.email FROM password_reset_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ? AND t.used = 0',
            [token]
        );

        if (!resetRecord) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        // Check expiry
        if (new Date(resetRecord.expires_at) < new Date()) {
            await db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);
            return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
        }

        // Now validate password strength with identity-contains check
        const passwordIssues = validatePassword(newPassword, { username: resetRecord.username, email: resetRecord.email });
        if (passwordIssues.length > 0) {
            return res.status(400).json({ error: `Password must contain ${passwordIssues.join(', ')}` });
        }

        // Hash new password + bump password_changed_at to invalidate existing sessions
        const passwordHash = bcrypt.hashSync(newPassword, 13);
        await db.run(
            'UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
            [passwordHash, Math.floor(Date.now() / 1000), resetRecord.user_id]
        );

        // Mark token as used
        await db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);

        // Clear any lockouts
        failedLogins.delete(resetRecord.user_id);

        res.json({ message: 'Password reset successful! You can now sign in.' });
    } catch (err) {
        console.warn('[Auth] Reset password error:', err.message);
        res.status(500).json({ error: 'Password reset failed' });
    }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'New password must be different from current password' });
        }

        // Fetch current user from database (needed for identity-contains password check)
        const user = await db.get('SELECT id, username, email, password_hash FROM users WHERE id = ?', [req.user.id]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const passwordIssues = validatePassword(newPassword, { username: user.username, email: user.email });
        if (passwordIssues.length > 0) {
            return res.status(400).json({ error: `Password must contain ${passwordIssues.join(', ')}` });
        }

        // Verify current password (bcrypt.compareSync is already constant-time)
        const passwordValid = bcrypt.compareSync(currentPassword, user.password_hash);

        if (!passwordValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const newPasswordHash = bcrypt.hashSync(newPassword, 13);

        // Update user password and record change timestamp (for token invalidation)
        const pwChangedAt = Math.floor(Date.now() / 1000);
        await db.run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [newPasswordHash, pwChangedAt, req.user.id]);

        // Blacklist the current token so user must re-login with new password
        const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
        if (token && typeof blacklistToken === 'function') blacklistToken(token);

        res.json({ message: 'Password changed successfully. Please log in again.' });
    } catch (err) {
        console.warn('[Auth] Change password error:', err.message);
        res.status(500).json({ error: 'Password change failed' });
    }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            username: req.user.username,
            email: req.user.email,
            balance: req.user.balance,
            is_admin: !!req.user.is_admin,
            referralCode: req.user.referral_code || null,
        },
    });
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
    try {
        var veIp = req.ip || req.connection.remoteAddress || 'unknown';
        var veCount = _verifyEmailAttempts.get(veIp) || 0;
        if (veCount >= 10) return res.status(429).json({ error: 'Too many verification attempts. Try again later.' });
        _verifyEmailAttempts.set(veIp, veCount + 1);

        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'Verification token is required' });
        }
        if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]+$/.test(token)) {
            return res.status(400).json({ error: 'Invalid verification token format' });
        }

        // Find the token
        const verifyRecord = await db.get(
            'SELECT id, user_id, token, expires_at, used FROM email_verification_tokens WHERE token = ? AND used = 0',
            [token]
        );

        if (!verifyRecord) {
            return res.status(400).json({ error: 'Invalid or expired verification link' });
        }

        // Check expiry
        if (new Date(verifyRecord.expires_at) < new Date()) {
            await db.run('UPDATE email_verification_tokens SET used = 1 WHERE id = ?', [verifyRecord.id]);
            return res.status(400).json({ error: 'Verification link has expired. Please request a new one.' });
        }

        // Mark email as verified
        await db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [verifyRecord.user_id]);

        // Mark token as used
        await db.run('UPDATE email_verification_tokens SET used = 1 WHERE id = ?', [verifyRecord.id]);

        res.json({ message: 'Email verified successfully!' });
    } catch (err) {
        console.warn('[Auth] Verify email error:', err.message);
        res.status(500).json({ error: 'Email verification failed' });
    }
});

// ROUND 36: Rate limit resend-verification — max 3 per 15 minutes per IP
var _resendVerifyAttempts = new Map();
setInterval(function() { _resendVerifyAttempts.clear(); }, 15 * 60 * 1000);

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
    try {
        var rvIp = req.ip || req.connection.remoteAddress || 'unknown';
        var rvCount = _resendVerifyAttempts.get(rvIp) || 0;
        if (rvCount >= 3) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        _resendVerifyAttempts.set(rvIp, rvCount + 1);

        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const successMsg = 'If an account with that email exists and is not verified, a new verification link has been sent.';

        const user = await db.get('SELECT id, username, email, email_verified FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (!user) {
            return res.json({ message: successMsg });
        }

        // If already verified, return success without doing anything
        if (user.email_verified) {
            return res.json({ message: 'Email is already verified.' });
        }

        // Invalidate any existing tokens for this user
        await db.run('UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

        // Generate new verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const VERIFICATION_EXPIRY_HOURS = 24;
        const verificationExpiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

        // Store verification token
        await db.run(
            'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, verificationToken, verificationExpiresAt]
        );

        // Send verification email (non-blocking)
        try {
            await emailService.sendVerificationEmail(user.email, user.username, verificationToken);
        } catch (emailErr) {
            console.warn('[Auth] Resend verification email failed:', emailErr.message);
        }

        res.json({ message: successMsg });
    } catch (err) {
        console.warn('[Auth] Resend verification error:', err.message);
        res.status(500).json({ error: 'Request failed' });
    }
});

// Emergency admin password reset — runs on every server startup via init
// Also callable via secret endpoint for manual reset
// ROUND 27 SECURITY: Uses separate ADMIN_RESET_SECRET (not JWT_SECRET).
// If ADMIN_RESET_SECRET is not set, this endpoint is DISABLED for safety.
router.post('/admin-reset', async (req, res) => {
    try {
        var adminResetSecret = process.env.ADMIN_RESET_SECRET;
        if (!adminResetSecret || adminResetSecret.length < 32) {
            return res.status(503).json({ error: 'Admin reset not configured. Set ADMIN_RESET_SECRET env var (32+ chars).' });
        }
        var secret = req.body.secret;
        if (typeof secret !== 'string' || secret.length < 32) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        // Constant-time comparison to prevent timing attacks
        var crypto = require('crypto');
        var isValid = false;
        try {
            isValid = crypto.timingSafeEqual(Buffer.from(secret, 'utf8'), Buffer.from(adminResetSecret, 'utf8'));
        } catch (_) { isValid = false; }
        if (!isValid) {
            console.warn('[Auth] Failed admin-reset attempt from IP:', req.ip);
            return res.status(403).json({ error: 'Forbidden' });
        }
        var hash = bcrypt.hashSync(config.ADMIN_PASSWORD, 13);
        var adminUser = config.ADMIN_USERNAME || 'matrix';

        // Update or create 'admin' user
        var existing = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
        if (existing) {
            await db.run('UPDATE users SET password_hash = ?, is_admin = 1 WHERE username = ?', [hash, 'admin']);
        } else {
            await db.run('INSERT INTO users (username, email, password_hash, balance, is_admin) VALUES (?, ?, ?, ?, ?)',
                ['admin', 'admin@matrixspins.com', hash, 0, 1]);
        }

        // Update or create configured admin user
        if (adminUser !== 'admin') {
            var existingNew = await db.get('SELECT id FROM users WHERE username = ?', [adminUser]);
            if (existingNew) {
                await db.run('UPDATE users SET password_hash = ?, is_admin = 1 WHERE username = ?', [hash, adminUser]);
            } else {
                await db.run('INSERT INTO users (username, email, password_hash, balance, is_admin) VALUES (?, ?, ?, ?, ?)',
                    [adminUser, adminUser + '@matrixspins.com', hash, 0, 1]);
            }
        }

        res.json({ ok: true, message: 'Admin credentials reset successfully' });
    } catch (err) {
        console.warn('[Auth] Admin reset error:', err.message);
        res.status(500).json({ error: 'Reset failed' });
    }
});

// --- Logout: blacklist current JWT ---
router.post('/logout', authenticate, (req, res) => {
    blacklistToken(req.token);
    res.json({ ok: true, message: 'Logged out successfully' });
});

module.exports = router;
