// ═══════════════════════════════════════════════════════════════════════════════
// REALITY CHECK TIMER - Responsible Gambling Feature
// ═══════════════════════════════════════════════════════════════════════════════
// Periodic modal reminder (configurable interval) showing session summary.
// Pauses gameplay and prompts informed decision-making about continued play.
// ═══════════════════════════════════════════════════════════════════════════════

window.RealityCheck = (function() {
    'use strict';

    // ──────────────────────────────────────────────────────────────
    // CONFIGURATION & STATE
    // ──────────────────────────────────────────────────────────────

    const STORAGE_KEY_INTERVAL = 'realityCheckInterval';
    const STORAGE_KEY_SESSION = 'realityCheckSession';
    const DEFAULT_INTERVAL_MINUTES = 30;

    let initialized = false;
    let timerHandle = null;
    let sessionData = {
        startTime: null,
        startBalance: null,
        spins: 0,
        totalWagered: 0,
        totalWon: 0,
        pausedAutoSpin: false
    };

    // ──────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ──────────────────────────────────────────────────────────────

    function init() {
        if (initialized) return;
        initialized = true;

        // Capture session start state
        sessionData.startTime = Date.now();
        sessionData.startBalance = typeof balance !== 'undefined' ? balance : 0;

        console.warn('[RealityCheck] Initialized — session start balance: $' + sessionData.startBalance.toFixed(2));

        // Listen for spin completion events
        window.addEventListener('spin:complete', _onSpinComplete);

        // Load saved interval preference
        const savedInterval = localStorage.getItem(STORAGE_KEY_INTERVAL);
        if (savedInterval) {
            const minutes = parseInt(savedInterval, 10);
            _startTimer(minutes);
        } else {
            _startTimer(DEFAULT_INTERVAL_MINUTES);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // SPIN TRACKING
    // ──────────────────────────────────────────────────────────────

    var SPIN_REALITY_CHECK_INTERVAL = 100; // Show reality check every N spins

    function _onSpinComplete(evt) {
        sessionData.spins += 1;
        const detail = evt.detail || {};
        const betAmount = detail.betAmount || 0;
        const winAmount = detail.winAmount || 0;

        sessionData.totalWagered += betAmount;
        sessionData.totalWon += winAmount;

        // §12 Responsible Gambling: reality check after every 100 spins
        if (sessionData.spins > 0 && sessionData.spins % SPIN_REALITY_CHECK_INTERVAL === 0) {
            console.warn('[RealityCheck] 100-spin reality check triggered at spin #' + sessionData.spins);
            _pauseGameAndShowModal();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // TIMER MANAGEMENT
    // ──────────────────────────────────────────────────────────────

    function _startTimer(minutes) {
        // Clear any existing timer
        if (timerHandle) clearTimeout(timerHandle);

        const ms = minutes * 60 * 1000;
        console.warn('[RealityCheck] Timer started for ' + minutes + ' minutes');

        timerHandle = setTimeout(function() {
            timerHandle = null;
            _pauseGameAndShowModal();
        }, ms);
    }

    function setInterval(minutes) {
        if (!initialized) {
            console.warn('[RealityCheck] Not initialized. Call init() first.');
            return;
        }

        // Validate input
        if (typeof minutes !== 'number' || minutes < 5) {
            console.warn('[RealityCheck] Invalid interval: ' + minutes + '. Using default.');
            minutes = DEFAULT_INTERVAL_MINUTES;
        }

        // Save preference
        localStorage.setItem(STORAGE_KEY_INTERVAL, minutes.toString());
        console.warn('[RealityCheck] Interval updated to ' + minutes + ' minutes');

        // Restart timer with new interval
        _startTimer(minutes);
    }

    // ──────────────────────────────────────────────────────────────
    // GAME PAUSE & MODAL DISPLAY
    // ──────────────────────────────────────────────────────────────

    function _pauseGameAndShowModal() {
        // Stop auto-spin if active
        if (typeof autoSpinActive !== 'undefined' && autoSpinActive) {
            sessionData.pausedAutoSpin = true;
            autoSpinActive = false;
            console.warn('[RealityCheck] Auto-spin paused for reality check');
        }

        // Pause spinning (prevent new spins)
        if (typeof spinning !== 'undefined') {
            window.spinPausedForRealityCheck = true;
        }

        _showRealityCheckModal();
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL RENDERING
    // ──────────────────────────────────────────────────────────────

    function _showRealityCheckModal() {
        // Remove any existing modal
        const existing = document.getElementById('realityCheckModal');
        if (existing) existing.remove();

        // Calculate session stats
        const now = Date.now();
        const sessionMinutes = Math.floor((now - sessionData.startTime) / 60000);
        const currentBalance = typeof balance !== 'undefined' ? balance : 0;
        const netWinLoss = currentBalance - sessionData.startBalance;
        const averageBet = sessionData.spins > 0 ?
            (sessionData.totalWagered / sessionData.spins) : 0;

        // Create modal HTML
        const modalHTML = `
            <div id="realityCheckModal" class="reality-check-overlay">
                <div class="reality-check-modal">
                    <div class="reality-check-header">
                        <h2>⏸ Reality Check</h2>
                        <p class="reality-check-subtitle">You've been playing for <strong>${sessionMinutes}</strong> minute${sessionMinutes !== 1 ? 's' : ''}</p>
                    </div>

                    <div class="reality-check-stats">
                        <div class="reality-check-stat-group">
                            <div class="reality-check-stat">
                                <span class="reality-check-stat-label">Session Time</span>
                                <span class="reality-check-stat-value">${_formatTime(sessionMinutes)}</span>
                            </div>
                            <div class="reality-check-stat">
                                <span class="reality-check-stat-label">Total Spins</span>
                                <span class="reality-check-stat-value">${sessionData.spins}</span>
                            </div>
                        </div>

                        <div class="reality-check-stat-group">
                            <div class="reality-check-stat">
                                <span class="reality-check-stat-label">Total Wagered</span>
                                <span class="reality-check-stat-value">$${sessionData.totalWagered.toFixed(2)}</span>
                            </div>
                            <div class="reality-check-stat">
                                <span class="reality-check-stat-label">Average Bet</span>
                                <span class="reality-check-stat-value">$${averageBet.toFixed(2)}</span>
                            </div>
                        </div>

                        <div class="reality-check-stat-group">
                            <div class="reality-check-stat">
                                <span class="reality-check-stat-label">Total Won</span>
                                <span class="reality-check-stat-value">$${sessionData.totalWon.toFixed(2)}</span>
                            </div>
                            <div class="reality-check-stat ${netWinLoss < 0 ? 'negative' : 'positive'}">
                                <span class="reality-check-stat-label">Net Win/Loss</span>
                                <span class="reality-check-stat-value">${netWinLoss >= 0 ? '+' : ''}$${netWinLoss.toFixed(2)}</span>
                            </div>
                        </div>

                        <div class="reality-check-balance-row">
                            <div class="reality-check-balance">
                                <span class="reality-check-balance-label">Session Start Balance</span>
                                <span class="reality-check-balance-value">$${sessionData.startBalance.toFixed(2)}</span>
                            </div>
                            <div class="reality-check-balance">
                                <span class="reality-check-balance-label">Current Balance</span>
                                <span class="reality-check-balance-value">$${currentBalance.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="reality-check-message">
                        <p>Please take a moment to review your session. Gambling should always be fun and within your means.</p>
                    </div>

                    <div class="reality-check-buttons">
                        <button id="realityCheckContinue" class="reality-check-btn btn-continue">
                            Continue Playing
                        </button>
                        <button id="realityCheckBreak" class="reality-check-btn btn-break">
                            Take a Break
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Insert modal into DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Wire up button handlers
        document.getElementById('realityCheckContinue').addEventListener('click', _handleContinue);
        document.getElementById('realityCheckBreak').addEventListener('click', _handleBreak);

        console.warn('[RealityCheck] Modal displayed');
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL ACTIONS
    // ──────────────────────────────────────────────────────────────

    function _handleContinue() {
        const modal = document.getElementById('realityCheckModal');
        if (modal) modal.remove();

        // Resume game
        window.spinPausedForRealityCheck = false;

        // Restore auto-spin if it was paused
        if (sessionData.pausedAutoSpin && typeof autoSpinActive !== 'undefined') {
            autoSpinActive = true;
            sessionData.pausedAutoSpin = false;
            console.warn('[RealityCheck] Auto-spin resumed');
        }

        // Restart timer for next check
        const savedInterval = localStorage.getItem(STORAGE_KEY_INTERVAL);
        const minutes = savedInterval ? parseInt(savedInterval, 10) : DEFAULT_INTERVAL_MINUTES;
        _startTimer(minutes);

        console.warn('[RealityCheck] Player continued playing');
    }

    function _handleBreak() {
        const modal = document.getElementById('realityCheckModal');
        if (modal) modal.remove();

        window.spinPausedForRealityCheck = false;

        console.warn('[RealityCheck] Player took a break');

        // Attempt to return to lobby or logout
        // Check for common functions in the app
        if (typeof returnToLobby === 'function') {
            returnToLobby();
        } else if (typeof goToLobby === 'function') {
            goToLobby();
        } else if (typeof logout === 'function') {
            logout();
        } else {
            // Fallback: navigate to index
            window.location.href = '/';
        }
    }

    // ──────────────────────────────────────────────────────────────
    // UTILITY FUNCTIONS
    // ──────────────────────────────────────────────────────────────

    function _formatTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        if (hours > 0) {
            return hours + 'h ' + mins + 'm';
        } else {
            return mins + 'm';
        }
    }

    function showNow() {
        // SLOT-ACTIVE GUARD: defer reality check until after slot closes
        var _sm = document.getElementById('slotModal'); if (_sm && _sm.classList.contains('active')) { setTimeout(showNow, 10000); return; }
        if (!initialized) {
            console.warn('[RealityCheck] Not initialized. Call init() first.');
            return;
        }

        _pauseGameAndShowModal();
    }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC API
    // ──────────────────────────────────────────────────────────────

    return {
        init: init,
        setInterval: setInterval,
        showNow: showNow
    };

})();

// ═══════════════════════════════════════════════════════════════════════════════
// INLINE STYLES
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    const styles = `
/* Reality Check Modal Overlay */
#realityCheckModal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    backdrop-filter: blur(3px);
    animation: realityCheckFadeIn 0.3s ease-out;
}

@keyframes realityCheckFadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

/* Modal Container */
.reality-check-modal {
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
    border: 2px solid #ff9800;
    border-radius: 16px;
    padding: 32px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(255, 152, 0, 0.3), 0 0 40px rgba(255, 152, 0, 0.1);
    animation: realityCheckSlideUp 0.4s cubic-bezier(0.23, 1, 0.320, 1);
}

@keyframes realityCheckSlideUp {
    from {
        transform: translateY(40px);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

/* Header */
.reality-check-header {
    text-align: center;
    margin-bottom: 28px;
    border-bottom: 1px solid rgba(255, 152, 0, 0.2);
    padding-bottom: 16px;
}

.reality-check-header h2 {
    font-size: 28px;
    font-weight: 700;
    color: #fff;
    margin: 0 0 8px 0;
    letter-spacing: 0.5px;
}

.reality-check-subtitle {
    font-size: 14px;
    color: #ff9800;
    margin: 0;
    font-weight: 500;
}

/* Stats Grid */
.reality-check-stats {
    margin-bottom: 24px;
}

.reality-check-stat-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
}

.reality-check-stat {
    background: rgba(255, 152, 0, 0.05);
    border: 1px solid rgba(255, 152, 0, 0.15);
    border-radius: 8px;
    padding: 12px;
    text-align: center;
    transition: all 0.2s ease;
}

.reality-check-stat:hover {
    background: rgba(255, 152, 0, 0.1);
    border-color: rgba(255, 152, 0, 0.3);
}

.reality-check-stat-label {
    display: block;
    font-size: 12px;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    font-weight: 500;
}

.reality-check-stat-value {
    display: block;
    font-size: 18px;
    font-weight: 700;
    color: #ff9800;
    font-family: 'JetBrains Mono', monospace;
}

.reality-check-stat.negative .reality-check-stat-value {
    color: #ff6b6b;
}

.reality-check-stat.positive .reality-check-stat-value {
    color: #51cf66;
}

/* Balance Row */
.reality-check-balance-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
    padding: 16px;
    background: rgba(255, 152, 0, 0.08);
    border: 1px solid rgba(255, 152, 0, 0.2);
    border-radius: 8px;
}

.reality-check-balance {
    text-align: center;
}

.reality-check-balance-label {
    display: block;
    font-size: 12px;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    font-weight: 500;
}

.reality-check-balance-value {
    display: block;
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    font-family: 'JetBrains Mono', monospace;
}

/* Message */
.reality-check-message {
    background: rgba(255, 152, 0, 0.05);
    border-left: 3px solid #ff9800;
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 24px;
}

.reality-check-message p {
    font-size: 14px;
    color: #ccc;
    margin: 0;
    line-height: 1.5;
}

/* Buttons */
.reality-check-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

.reality-check-btn {
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.btn-continue {
    background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
    color: #fff;
    box-shadow: 0 4px 15px rgba(255, 152, 0, 0.3);
}

.btn-continue:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 25px rgba(255, 152, 0, 0.4);
}

.btn-continue:active {
    transform: translateY(0);
}

.btn-break {
    background: linear-gradient(135deg, #424242 0%, #212121 100%);
    color: #ff9800;
    border: 1px solid #ff9800;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
}

.btn-break:hover {
    background: linear-gradient(135deg, #555 0%, #333 100%);
    box-shadow: 0 6px 25px rgba(255, 152, 0, 0.2);
    transform: translateY(-2px);
}

.btn-break:active {
    transform: translateY(0);
}

/* Scrollbar styling */
.reality-check-modal::-webkit-scrollbar {
    width: 8px;
}

.reality-check-modal::-webkit-scrollbar-track {
    background: rgba(255, 152, 0, 0.05);
    border-radius: 4px;
}

.reality-check-modal::-webkit-scrollbar-thumb {
    background: rgba(255, 152, 0, 0.3);
    border-radius: 4px;
}

.reality-check-modal::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 152, 0, 0.5);
}
    `;

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.id = 'realityCheckStyles';
    styleEl.textContent = styles;
    if (document.head) {
        document.head.appendChild(styleEl);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            document.head.appendChild(styleEl);
        });
    }
})();

console.log('[RealityCheck] Module loaded — call window.RealityCheck.init() to start');

