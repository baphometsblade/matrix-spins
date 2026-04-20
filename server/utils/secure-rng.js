/**
 * Secure RNG - Replaces Math.random() globally with a cryptographically
 * secure implementation using Node.js crypto.randomBytes.
 *
 * Must be required BEFORE any game routes load (see server/index.js).
 * All existing Math.random() calls automatically become secure.
 *
 * Output range: [0, 1) - identical interface to Math.random()
 * Source: 32 bits from crypto.randomBytes / 2^32
 */
'use strict';

const { randomBytes } = require('crypto');

Math.random = function secureRandom() {
    const buf = randomBytes(4);
    return buf.readUInt32BE(0) / 0x100000000; // [0, 1) with 32-bit precision
};

console.log('[Security] Math.random() overridden with crypto.randomBytes secure RNG');
