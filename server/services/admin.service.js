'use strict';

/**
 * Admin bootstrap. On server start, if ADMIN_USERNAME + ADMIN_PASSWORD
 * are configured and no user with that username exists, create one with
 * is_admin=true. If it exists but the password differs, update the hash.
 *
 * This keeps admin access reproducible across deployments without
 * shipping a credential in git.
 */

const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../database');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

async function bootstrap() {
    if (!config.ADMIN_PASSWORD) return;
    try {
        const existing = await db.get('SELECT id, password_hash, is_admin FROM users WHERE lower(username) = lower(?)', [ADMIN_USERNAME]);
        const hash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
        if (!existing) {
            const isPg = db.kind === 'pg';
            const dob = '1970-01-01';
            await db.run(
                isPg
                    ? 'INSERT INTO users (username, email, password_hash, date_of_birth, is_admin) VALUES (?, ?, ?, ?, true)'
                    : 'INSERT INTO users (username, email, password_hash, date_of_birth, is_admin) VALUES (?, ?, ?, ?, 1)',
                [ADMIN_USERNAME, ADMIN_USERNAME + '@matrix-spins.local', hash, dob]
            );
            console.log('[admin] bootstrapped admin user "' + ADMIN_USERNAME + '"');
            return;
        }
        // Rotate the hash if it differs (i.e., ADMIN_PASSWORD has been changed
        // in the environment since the last boot).
        const matches = await bcrypt.compare(config.ADMIN_PASSWORD, existing.password_hash);
        const isPg = db.kind === 'pg';
        if (!matches || !existing.is_admin) {
            await db.run(
                isPg
                    ? 'UPDATE users SET password_hash = ?, is_admin = true WHERE id = ?'
                    : 'UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?',
                [hash, existing.id]
            );
            console.log('[admin] updated admin user "' + ADMIN_USERNAME + '"');
        }
    } catch (err) {
        console.error('[admin] bootstrap failed:', err);
    }
}

module.exports = { bootstrap, ADMIN_USERNAME };
