/**
 * Request validation middleware for Matrix Spins Casino
 * Validates incoming requests, user IDs, and monetary amounts
 */

/**
 * General request validation middleware
 * Ensures request body exists and has required structure
 */
function validateRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'Invalid request body'
    });
  }

  // Sanitize string fields to prevent injection
  for (const key of Object.keys(req.body)) {
    if (typeof req.body[key] === 'string') {
      req.body[key] = req.body[key].trim();
    }
  }

  next();
}

/**
 * Validate a user ID string
 * @param {string} userId - User ID to validate
 * @returns {boolean} True if valid
 */
function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') return false;
  if (userId.length < 1 || userId.length > 128) return false;
  // Allow alphanumeric, hyphens, underscores
  return /^[a-zA-Z0-9_-]+$/.test(userId);
}

/**
 * Validate a monetary amount (in cents)
 * @param {number} amountInCents - Amount in cents to validate
 * @returns {boolean} True if valid
 */
function validateAmount(amountInCents) {
  if (typeof amountInCents !== 'number') return false;
  if (!Number.isFinite(amountInCents)) return false;
  if (amountInCents <= 0) return false;
  if (amountInCents > 100000000) return false; // Max $1,000,000
  if (!Number.isInteger(amountInCents)) return false;
  return true;
}

module.exports = {
  validateRequest,
  validateUserId,
  validateAmount
};
