'use strict';

/**
 * AES-256-GCM symmetric encryption for sensitive at-rest data
 * (e.g. TOTP secrets stored in users.totp_secret).
 *
 * Key derivation: SHA-256 of JWT_SECRET. Same secret already protects
 * session tokens; rotating JWT_SECRET also invalidates encrypted secrets,
 * which is the desired blast radius.
 *
 * Format: <iv-hex>:<authtag-hex>:<ciphertext-hex>
 */

const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
    return crypto.createHash('sha256').update(String(config.JWT_SECRET || '')).digest();
}

function encrypt(plaintext) {
    if (plaintext == null) return null;
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(blob) {
    if (!blob || typeof blob !== 'string') return null;
    const parts = blob.split(':');
    if (parts.length !== 3) return null;
    try {
        const iv = Buffer.from(parts[0], 'hex');
        const tag = Buffer.from(parts[1], 'hex');
        const ct = Buffer.from(parts[2], 'hex');
        const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
        decipher.setAuthTag(tag);
        const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
        return dec.toString('utf8');
    } catch (_) {
        return null;
    }
}

module.exports = { encrypt, decrypt };
