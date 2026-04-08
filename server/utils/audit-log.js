/**
 * Audit logging utility for Matrix Spins Casino
 * Logs all financial transactions and game events for compliance
 *
 * IMPORTANT: No blockchain/crypto terminology in log messages
 * that could surface to players. Internal logs use generic terms.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('[AUDIT] Could not create log directory:', e.message);
}

/**
 * Log a transaction event
 * @param {Object} entry - Transaction data to log
 * @param {string} entry.type - Event type (deposit_success, spin_result, etc.)
 * @param {string} [entry.userId] - User involved
 * @param {number} [entry.amount] - Amount involved
 * @param {string} [entry.error] - Error message if applicable
 */
function logTransaction(entry) {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry
  };

  const line = JSON.stringify(record) + '\n';

  // Write to file (non-blocking)
  fs.appendFile(LOG_FILE, line, (err) => {
    if (err) {
      console.error('[AUDIT] Failed to write log:', err.message);
    }
  });

  // Also log to stdout for container/cloud log aggregation
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(`[AUDIT] ${line}`);
  }
}

/**
 * Read recent audit log entries
 * @param {number} count - Number of recent entries to retrieve
 * @returns {Promise<Array>} Array of log entries
 */
async function getRecentEntries(count = 100) {
  try {
    const data = await fs.promises.readFile(LOG_FILE, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    return lines.slice(-count).map(line => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

module.exports = {
  logTransaction,
  getRecentEntries
};
