'use strict';

/**
 * RFC 6238 TOTP + RFC 4648 base32. No external deps.
 *
 * verifyCode() accepts a ±1-step window so a user tapping at second 29
 * of a 30-second cycle isn't rejected. Timing-safe compare, constant
 * work per check regardless of match location.
 */

const crypto = require('crypto');

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALGORITHM = 'sha1';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (let i = 0; i < buf.length; i++) {
        value = (value << 8) | buf[i];
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    const bytes = [];
    let bits = 0;
    let value = 0;
    for (let i = 0; i < clean.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(clean[i]);
        if (idx === -1) throw new Error('Invalid base32 character');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

function generateSecret(byteLen = 20) {
    return base32Encode(crypto.randomBytes(byteLen));
}

function counterBuffer(counter) {
    const buf = Buffer.alloc(8);
    // counter fits in 53-bit precision, split into high/low 32-bit
    const high = Math.floor(counter / 0x100000000);
    const low = counter % 0x100000000;
    buf.writeUInt32BE(high, 0);
    buf.writeUInt32BE(low, 4);
    return buf;
}

function generateHOTP(secretBase32, counter) {
    const key = base32Decode(secretBase32);
    const mac = crypto.createHmac(ALGORITHM, key).update(counterBuffer(counter)).digest();
    const offset = mac[mac.length - 1] & 0x0f;
    const truncated = ((mac[offset] & 0x7f) << 24) |
                      ((mac[offset + 1] & 0xff) << 16) |
                      ((mac[offset + 2] & 0xff) << 8) |
                      (mac[offset + 3] & 0xff);
    const code = truncated % Math.pow(10, DIGITS);
    return String(code).padStart(DIGITS, '0');
}

function generateTOTP(secretBase32, { now = Date.now(), period = PERIOD_SECONDS } = {}) {
    const counter = Math.floor((now / 1000) / period);
    return generateHOTP(secretBase32, counter);
}

function verifyCode(secretBase32, code, { now = Date.now(), period = PERIOD_SECONDS, window = 1 } = {}) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    const counter = Math.floor((now / 1000) / period);
    let matched = false;
    for (let w = -window; w <= window; w++) {
        const candidate = generateHOTP(secretBase32, counter + w);
        // timing-safe equality per candidate so we don't early-exit
        if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) matched = true;
    }
    return matched;
}

function otpauthUrl({ issuer, account, secretBase32 }) {
    const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
    const params = new URLSearchParams({
        secret: secretBase32,
        issuer,
        algorithm: ALGORITHM.toUpperCase(),
        digits: String(DIGITS),
        period: String(PERIOD_SECONDS),
    });
    return 'otpauth://totp/' + label + '?' + params.toString();
}

module.exports = {
    generateSecret,
    generateTOTP,
    verifyCode,
    otpauthUrl,
    base32Encode,
    base32Decode,
    PERIOD_SECONDS,
    DIGITS,
};
