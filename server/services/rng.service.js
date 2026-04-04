const crypto = require('crypto');

/**
 * Cryptographically secure RNG service.
 * Uses Node.js crypto.randomInt() for uniform random integers.
 */

// Generate a random integer in [0, max) using crypto
function randomInt(max) {
    return crypto.randomInt(max);
}

// Generate a random float in [0, 1) using crypto
function randomFloat() {
    const bytes = crypto.randomBytes(4);
    return bytes.readUInt32BE(0) / 0x100000000;
}

// Pick a random element from an array
function pickRandom(arr) {
    return arr[randomInt(arr.length)];
}

// Pick a random element with weighted probabilities
// weights is an array of numbers (same length as arr)
function pickWeighted(arr, weights) {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let roll = randomFloat() * totalWeight;
    for (let i = 0; i < arr.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return arr[i];
    }
    return arr[arr.length - 1];
}

// Generate a unique seed string for audit trail
function generateSeed() {
    return crypto.randomBytes(16).toString('hex');
}

module.exports = {
    randomInt,
    randomFloat,
    random: randomFloat,  // alias — drop-in replacement for Math.random()
    pickRandom,
    pickWeighted,
    generateSeed,
};
