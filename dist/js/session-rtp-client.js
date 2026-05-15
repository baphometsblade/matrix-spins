'use strict';

/**
 * Session RTP Client
 *
 * Tracks local session behavior and sends data to the backend's dynamic RTP manager
 * after each spin. RTP adjustments are invisible to players — this module exists
 * purely to feed the revenue optimization engine.
 *
 * Usage:
 *   window.SessionRTPClient.init(userId, sessionId);
 *   window.SessionRTPClient.onSpinResult({ won: true, amount: 50, bet: 10, balance: 450 });
 *   const stats = window.SessionRTPClient.getSessionStats();
 */

(function() {
  'use strict';

  var SessionRTPClient = {
    /**
     * Session state — initialized per session
     */
    _sessionId: null,
    _userId: null,
    _spinCount: 0,
    _consecutiveLosses: 0,
    _betHistory: [],      // Last 10 bets (for pattern detection)
    _sessionStartTime: null,
    _sessionWagered: 0,
    _sessionDeposit: 0,
    _lastSpinBalance: 0,

    /**
     * init(userId, sessionId, initialDeposit)
     *
     * Initialize the session tracker. Call this once per session.
     *
     * @param {number} userId — User ID
     * @param {string} sessionId — Unique session identifier
     * @param {number} initialDeposit — Starting balance (used for recovery calculations)
     */
    init: function(userId, sessionId, initialDeposit) {
      if (!userId || !sessionId) {
        console.warn('[SessionRTPClient] init() requires userId and sessionId');
        return;
      }

      this._userId = parseInt(userId, 10);
      this._sessionId = String(sessionId).trim();
      this._sessionDeposit = parseFloat(initialDeposit) || 0;
      this._sessionStartTime = Date.now();
      this._spinCount = 0;
      this._consecutiveLosses = 0;
      this._betHistory = [];
      this._sessionWagered = 0;
      this._lastSpinBalance = this._sessionDeposit;

      // removed: production logging
    },

    /**
     * onSpinResult(spinResult)
     *
     * Called after each spin. Records the outcome and sends session data to the backend.
     *
     * @param {object} spinResult — Spin outcome
     *   {
     *     won: boolean,      — Did the spin result in a win?
     *     amount: number,    — Winnings (0 if loss)
     *     bet: number,       — Bet amount for this spin
     *     balance: number    — Current balance after the spin
     *   }
     */
    onSpinResult: function(spinResult) {
      if (!this._sessionId || !this._userId) {
        console.warn('[SessionRTPClient] Session not initialized. Call init() first.');
        return;
      }

      var won = spinResult.won === true;
      var amount = parseFloat(spinResult.amount) || 0;
      var bet = parseFloat(spinResult.bet) || 0;
      var balance = parseFloat(spinResult.balance) || 0;

      // Update spin count
      this._spinCount += 1;

      // Track wagered amount
      this._sessionWagered += bet;

      // Update consecutive losses
      if (won) {
        this._consecutiveLosses = 0;
      } else {
        this._consecutiveLosses += 1;
      }

      // Keep bet history (last 10 bets for pattern detection)
      this._betHistory.push(bet);
      if (this._betHistory.length > 10) {
        this._betHistory.shift();
      }

      // Update last spin balance
      this._lastSpinBalance = balance;

      // Send session data to backend (fire-and-forget)
      this._sendAdjustment({
        won: won,
        amount: amount,
        bet: bet,
        balance: balance
      });
    },

    /**
     * getSessionStats()
     *
     * Get current session statistics. For analytics and debugging.
     *
     * @return {object} Session stats
     */
    getSessionStats: function() {
      var now = Date.now();
      var elapsedMs = this._sessionStartTime ? now - this._sessionStartTime : 0;

      return {
        sessionId: this._sessionId,
        userId: this._userId,
        spinCount: this._spinCount,
        consecutiveLosses: this._consecutiveLosses,
        sessionWagered: parseFloat(this._sessionWagered.toFixed(2)),
        sessionDeposit: parseFloat(this._sessionDeposit.toFixed(2)),
        currentBalance: parseFloat(this._lastSpinBalance.toFixed(2)),
        sessionElapsedMs: elapsedMs,
        sessionElapsedMin: parseFloat((elapsedMs / 60000).toFixed(2)),
        betHistory: this._betHistory.slice()  // Return copy
      };
    },

    /**
     * ─────────────────────────────────────────────────────────────
     * INTERNAL: Send adjustment to backend
     * ─────────────────────────────────────────────────────────────
     */
    _sendAdjustment: function(spinResult) {
      var stats = this.getSessionStats();

      var payload = {
        sessionId: this._sessionId,
        spinData: {
          won: spinResult.won,
          amount: spinResult.amount,
          bet: spinResult.bet,
          balance: spinResult.balance,
          consecutiveLosses: stats.consecutiveLosses,
          sessionWagered: stats.sessionWagered,
          sessionElapsedMs: stats.sessionElapsedMs,
          betHistory: stats.betHistory
        }
      };

      // Fire-and-forget POST to /api/dynamic-rtp/adjust
      // Use fetch with no error handling (graceful degradation)
      if (typeof fetch !== 'undefined') {
        fetch('/api/dynamic-rtp/adjust', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this._getToken(),
            'X-CSRF-Token': this._getCsrfToken()
          },
          body: JSON.stringify(payload)
        }).catch(function(err) {
          // Silently ignore fetch errors (fire-and-forget)
          // In production, you might log to a different endpoint
        });
      }
    },

    /**
     * ─────────────────────────────────────────────────────────────
     * INTERNAL: Get JWT token from localStorage
     * ─────────────────────────────────────────────────────────────
     */
    _getToken: function() {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('authToken') || '';
      }
      return '';
    },

    /**
     * ─────────────────────────────────────────────────────────────
     * INTERNAL: Get CSRF token from DOM
     * ─────────────────────────────────────────────────────────────
     */
    _getCsrfToken: function() {
      // Try to find CSRF token in meta tag
      var metaTag = null;
      if (typeof document !== 'undefined') {
        metaTag = document.querySelector('meta[name="csrf-token"]');
      }
      if (metaTag) {
        return metaTag.getAttribute('content') || '';
      }
      return '';
    }
  };

  // Expose to window
  if (typeof window !== 'undefined') {
    window.SessionRTPClient = SessionRTPClient;
  }

  // Also export for module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionRTPClient;
  }
})();
