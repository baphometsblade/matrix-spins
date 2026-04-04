/**
 * Per-user rate limiting middleware
 * Implements sliding window algorithm for authenticated users
 * Falls through to IP-based rate limiting for unauthenticated requests
 */

const userStore = new Map();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Periodically clean up expired entries
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of userStore.entries()) {
    // Remove requests older than window
    data.requests = data.requests.filter(timestamp => now - timestamp < data.windowMs);
    // Remove user entry if no recent requests
    if (data.requests.length === 0) {
      userStore.delete(userId);
    }
  }
}, CLEANUP_INTERVAL);

// Graceful cleanup on process exit
process.on('exit', () => {
  clearInterval(cleanupTimer);
});

/**
 * Creates a per-user rate limiting middleware
 * @param {Object} options
 * @param {number} options.maxRequests - Maximum requests allowed in the window (default: 100)
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns {Function} Express middleware function
 */
function userRateLimit(options = {}) {
  const maxRequests = options.maxRequests || 100;
  const windowMs = options.windowMs || 60000;

  return (req, res, next) => {
    // Skip rate limiting for unauthenticated users (IP-based limiting will handle them)
    if (!req.user) {
      return next();
    }

    const userId = req.user.id;
    const now = Date.now();

    // Initialize or get user data
    if (!userStore.has(userId)) {
      userStore.set(userId, {
        requests: [],
        windowMs: windowMs,
      });
    }

    const userData = userStore.get(userId);

    // Remove requests outside the sliding window
    userData.requests = userData.requests.filter(
      timestamp => now - timestamp < windowMs
    );

    const requestCount = userData.requests.length;
    const remaining = Math.max(0, maxRequests - requestCount);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

    // Check if limit exceeded
    if (requestCount >= maxRequests) {
      const retryAfter = Math.ceil((userData.requests[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);

      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: retryAfter,
        limit: maxRequests,
        window: `${windowMs / 1000}s`,
      });
    }

    // Record this request
    userData.requests.push(now);

    next();
  };
}

module.exports = userRateLimit;
