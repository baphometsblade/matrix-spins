/**
 * Server-side RNG for Matrix Spins Casino
 * Cryptographically secure random number generation for fair gameplay
 */

const crypto = require('crypto');

/**
 * Generate a deterministic seed from user/game context + timestamp
 * Used for audit replay capability
 * @param {string} userId - User identifier
 * @param {string} gameId - Game identifier
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Hex seed string
 */
// Per-process random secret used when RNG_SERVER_SECRET env var is missing.
// Generated once at startup so all seeds within the same process are consistent,
// but differs across restarts (no predictable fallback).
let _processSecret;
function getServerSecret() {
  if (process.env.RNG_SERVER_SECRET) return process.env.RNG_SERVER_SECRET;
  if (!_processSecret) {
    _processSecret = crypto.randomBytes(64).toString('hex');
    console.warn('[RNG] WARNING: RNG_SERVER_SECRET not set — using per-process random secret. Seed audit replay will NOT work across restarts. Set RNG_SERVER_SECRET in your environment for production.');
  }
  return _processSecret;
}

function generateSeed(userId, gameId, timestamp) {
  const serverSecret = getServerSecret();
  const data = `${serverSecret}:${userId}:${gameId}:${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a random float between 0 and 1 from a seed
 * @param {string} seed - Hex seed string
 * @param {number} index - Position index for multiple values from same seed
 * @returns {number} Float between 0 (inclusive) and 1 (exclusive)
 */
function seededRandom(seed, index = 0) {
  const hash = crypto.createHash('sha256')
    .update(`${seed}:${index}`)
    .digest('hex');
  // Use first 8 hex chars (32 bits) for the float
  const value = parseInt(hash.substring(0, 8), 16);
  return value / 0x100000000;
}

/**
 * Generate a random integer in range [min, max] from a seed
 * @param {string} seed - Hex seed string
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @param {number} index - Position index
 * @returns {number} Random integer in range
 */
function seededRandomInt(seed, min, max, index = 0) {
  const r = seededRandom(seed, index);
  return Math.floor(r * (max - min + 1)) + min;
}

/**
 * Generate a cryptographically secure random integer
 * (non-seeded, for cases where replay isn't needed)
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {number} Random integer
 */
function secureRandomInt(min, max) {
  const range = max - min + 1;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8) || 1;
  const maxValid = Math.floor(256 ** bytesNeeded / range) * range;
  let value;
  do {
    value = crypto.randomBytes(bytesNeeded).readUIntBE(0, bytesNeeded);
  } while (value >= maxValid);
  return (value % range) + min;
}

module.exports = {
  generateSeed,
  seededRandom,
  seededRandomInt,
  secureRandomInt
};
