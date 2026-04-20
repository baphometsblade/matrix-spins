'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, is_admin: !!user.is_admin },
        config.JWT_SECRET,
        { expiresIn: '30d' }
    );
}

function verifyTokenString(token) {
    try {
        return jwt.verify(token, config.JWT_SECRET);
    } catch (err) {
        return null;
    }
}

function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyTokenString(token) : null;
    if (!payload) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = payload;
    next();
}

function authenticateOptional(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyTokenString(token) : null;
    if (payload) req.user = payload;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
}

module.exports = { authenticate, authenticateOptional, requireAdmin, signToken, verifyTokenString };
