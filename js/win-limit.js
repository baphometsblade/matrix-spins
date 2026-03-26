/**
 * Win Limit Safety Feature
 * Responsible gambling tool to set session win limits and auto-cashout prompts
 * IIFE pattern with localStorage persistence and in-memory session tracking
 */

window.WinLimit = (function () {
  // Configuration
  const CONFIG = {
    STORAGE_KEY: 'matrixSpins_winLimit',
    EVENT_SPIN_COMPLETE: 'spin:complete',
    DEFAULT_LIMIT: 500,
    MIN_LIMIT: 10,
    MAX_LIMIT: 10000,
  };

  // Internal state
  let state = {
    winLimit: null,
    sessionWinnings: 0,
    isLimitEnabled: false,
    limitReachedShown: false,
  };

  /**
   * Load win limit from localStorage
   */
  function loadLimitFromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        state.winLimit = parsed.amount;
        state.isLimitEnabled = parsed.enabled !== false;
        console.warn('[WinLimit] Loaded limit from storage:', state.winLimit);
      }
    } catch (err) {
      console.warn('[WinLimit] Error loading from localStorage:', err.message);
    }
  }

  /**
   * Save win limit to localStorage
   */
  function saveLimitToStorage() {
    try {
      const data = {
        amount: state.winLimit,
        enabled: state.isLimitEnabled,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
      console.warn('[WinLimit] Saved limit to storage:', state.winLimit);
    } catch (err) {
      console.warn('[WinLimit] Error saving to localStorage:', err.message);
    }
  }

  /**
   * Initialize the Win Limit module
   * Loads saved limit and sets up event listeners
   */
  function init() {
    console.warn('[WinLimit] Initializing Win Limit safety feature');
    loadLimitFromStorage();

    // Listen for spin completion events
    document.addEventListener(CONFIG.EVENT_SPIN_COMPLETE, handleSpinComplete);

    console.warn('[WinLimit] Win Limit initialized. Current limit:', state.winLimit, 'Enabled:', state.isLimitEnabled);
  }

  /**
   * Set or update the win limit
   * @param {number} amount - Win limit amount in dollars
   */
  function setLimit(amount) {
    if (typeof amount !== 'number' || amount < CONFIG.MIN_LIMIT || amount > CONFIG.MAX_LIMIT) {
      console.warn(`[WinLimit] Invalid limit amount. Must be between $${CONFIG.MIN_LIMIT} and $${CONFIG.MAX_LIMIT}`);
      return false;
    }

    state.winLimit = amount;
    state.isLimitEnabled = true;
    state.limitReachedShown = false;
    saveLimitToStorage();

    console.warn(`[WinLimit] Win limit set to $${amount}`);
    return true;
  }

  /**
   * Handle spin completion event
   * Tracks winnings and checks if limit reached
   * @param {CustomEvent} event - Spin completion event with winnings data
   */
  function handleSpinComplete(event) {
    if (!state.isLimitEnabled || !state.winLimit) {
      return;
    }

    const winAmount = event.detail?.winAmount || 0;

    if (winAmount > 0) {
      state.sessionWinnings += winAmount;
      console.warn(`[WinLimit] Session winning recorded: +$${winAmount}. Total: $${state.sessionWinnings}`);

      if (state.sessionWinnings >= state.winLimit && !state.limitReachedShown) {
        state.limitReachedShown = true;
        showWinLimitModal();
      }
    }
  }

  /**
   * Get current status of win limit feature
   * @returns {Object} Status object
   */
  function getStatus() {
    return {
      winLimit: state.winLimit,
      sessionWinnings: state.sessionWinnings,
      isEnabled: state.isLimitEnabled,
      remainingToLimit: Math.max(0, state.winLimit - state.sessionWinnings),
      hasReachedLimit: state.sessionWinnings >= state.winLimit,
    };
  }

  /**
   * Display the win limit reached modal
   */
  function showWinLimitModal() {
    // SLOT-ACTIVE GUARD
    var _sm = document.getElementById('slotModal'); if (_sm && _sm.classList.contains('active')) return;
    console.warn('[WinLimit] Displaying win limit modal. Session winnings: $' + state.sessionWinnings);

    const modalId = 'winLimitModal';
    if (document.getElementById(modalId)) {
      document.getElementById(modalId).remove();
    }

    const modal = createModal(
      modalId,
      `<div class="win-limit-modal-content">
        <div class="win-limit-icon">ðŸŽ‰</div>
        <h2>You've Reached Your Win Goal!</h2>
        <p class="win-limit-amount">$${state.winLimit}</p>
        <p class="win-limit-message">Great session! You've achieved your target winnings.</p>
        <div class="win-limit-stats">
          <div class="stat">
            <span class="stat-label">Session Winnings</span>
            <span class="stat-value">$${state.sessionWinnings.toFixed(2)}</span>
          </div>
        </div>
        <div class="win-limit-actions">
          <button class="btn-primary btn-cashout" id="btnCashOut">ðŸ’° Cash Out</button>
          <button class="btn-secondary btn-keep-playing" id="btnKeepPlaying">Continue Playing</button>
          <button class="btn-tertiary btn-increase-limit" id="btnIncreaseLimit">ðŸ“ˆ Increase Limit</button>
        </div>
      </div>`
    );

    document.body.appendChild(modal);

    // Button handlers
    document.getElementById('btnCashOut').addEventListener('click', function () {
      console.warn('[WinLimit] User clicked Cash Out');
      closeModal(modalId);
      handleCashOut();
    });

    document.getElementById('btnKeepPlaying').addEventListener('click', function () {
      console.warn('[WinLimit] User clicked Keep Playing');
      closeModal(modalId);
      state.sessionWinnings = 0;
      state.limitReachedShown = false;
      console.warn('[WinLimit] Session winnings counter reset');
    });

    document.getElementById('btnIncreaseLimit').addEventListener('click', function () {
      console.warn('[WinLimit] User clicked Increase Limit');
      closeModal(modalId);
      showSettingsModal();
    });
  }

  /**
   * Handle cash out action
   */
  function handleCashOut() {
    console.warn('[WinLimit] Initiating cash out. Final session winnings: $' + state.sessionWinnings);

    // Dispatch custom event for app to handle cash out logic
    document.dispatchEvent(
      new CustomEvent('winLimit:cashOut', {
        detail: {
          sessionWinnings: state.sessionWinnings,
          timestamp: new Date().toISOString(),
        },
      })
    );

    // Reset session tracking
    state.sessionWinnings = 0;
    state.limitReachedShown = false;
  }

  /**
   * Display settings modal for changing win limit
   */
  function showSettingsModal() {
    console.warn('[WinLimit] Displaying settings modal');

    const modalId = 'winLimitSettingsModal';
    if (document.getElementById(modalId)) {
      document.getElementById(modalId).remove();
    }

    const currentLimit = state.winLimit || CONFIG.DEFAULT_LIMIT;

    const modal = createModal(
      modalId,
      `<div class="win-limit-settings-content">
        <h2>ðŸŽ¯ Win Limit Settings</h2>
        <p class="settings-description">Set a win goal to help you play responsibly</p>

        <div class="settings-form">
          <label for="winLimitInput">Win Limit ($)</label>
          <input
            type="number"
            id="winLimitInput"
            class="win-limit-input"
            min="${CONFIG.MIN_LIMIT}"
            max="${CONFIG.MAX_LIMIT}"
            value="${currentLimit}"
            placeholder="Enter amount"
          />
          <div class="input-hint">Between $${CONFIG.MIN_LIMIT} and $${CONFIG.MAX_LIMIT}</div>
        </div>

        <div class="settings-status">
          <label class="checkbox-label">
            <input type="checkbox" id="enableWinLimit" ${state.isLimitEnabled ? 'checked' : ''} />
            <span>Enable Win Limit</span>
          </label>
        </div>

        <div class="win-limit-info">
          <p><strong>How it works:</strong> When you reach your win goal, we'll pause the game and suggest you cash out. You can choose to continue, increase the limit, or cash out.</p>
        </div>

        <div class="win-limit-actions">
          <button class="btn-primary" id="btnSaveLimit">ðŸ’¾ Save Limit</button>
          <button class="btn-secondary" id="btnCloseSettings">Close</button>
        </div>
      </div>`
    );

    document.body.appendChild(modal);

    const inputField = document.getElementById('winLimitInput');
    const checkbox = document.getElementById('enableWinLimit');

    document.getElementById('btnSaveLimit').addEventListener('click', function () {
      const newLimit = parseInt(inputField.value, 10);
      const isEnabled = checkbox.checked;

      if (setLimit(newLimit)) {
        state.isLimitEnabled = isEnabled;
        saveLimitToStorage();
        console.warn(`[WinLimit] Settings saved. Limit: $${newLimit}, Enabled: ${isEnabled}`);
        closeModal(modalId);
      }
    });

    document.getElementById('btnCloseSettings').addEventListener('click', function () {
      closeModal(modalId);
    });

    // Allow Enter key to save
    inputField.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        document.getElementById('btnSaveLimit').click();
      }
    });
  }

  /**
   * Create a modal overlay element
   * @param {string} id - Modal element ID
   * @param {string} content - HTML content
   * @returns {HTMLElement} Modal element
   */
  function createModal(id, content) {
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'win-limit-modal-overlay';
    modal.innerHTML = `
      <div class="win-limit-modal-box">
        ${content}
      </div>
    `;

    // Close on background click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal(id);
      }
    });

    return modal;
  }

  /**
   * Close a modal by ID
   * @param {string} id - Modal element ID
   */
  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.remove();
      console.warn(`[WinLimit] Modal closed: ${id}`);
    }
  }

  /**
   * Show settings modal (public method)
   */
  function showSettings() {
    showSettingsModal();
  }

  /**
   * Public API
   */
  return {
    init: init,
    setLimit: setLimit,
    getStatus: getStatus,
    showSettings: showSettings,
  };
})();

/**
 * CSS Styles for Win Limit Feature
 * Dark casino theme with gold accents
 */
(function injectStyles() {
  const styleId = 'winLimitStyles';
  if (document.getElementById(styleId)) {
    return;
  }

  const styles = `
    /* Win Limit Modal Overlay */
    .win-limit-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.3s ease-in-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    /* Modal Box */
    .win-limit-modal-box {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 2px solid #d4af37;
      border-radius: 15px;
      padding: 40px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(212, 175, 55, 0.3), 0 0 20px rgba(0, 0, 0, 0.8);
      animation: slideUp 0.4s ease-out;
    }

    @keyframes slideUp {
      from {
        transform: translateY(30px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    /* Win Limit Modal Content */
    .win-limit-modal-content h2 {
      color: #d4af37;
      font-size: 24px;
      margin: 15px 0;
      text-align: center;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }

    .win-limit-icon {
      font-size: 60px;
      text-align: center;
      margin-bottom: 20px;
      animation: bounce 0.6s ease-in-out;
    }

    @keyframes bounce {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-15px);
      }
    }

    .win-limit-amount {
      font-size: 48px;
      font-weight: bold;
      color: #00d4ff;
      text-align: center;
      margin: 20px 0;
      text-shadow: 0 0 15px rgba(0, 212, 255, 0.5);
    }

    .win-limit-message {
      color: #e0e0e0;
      text-align: center;
      font-size: 16px;
      margin-bottom: 25px;
    }

    .win-limit-stats {
      background: rgba(212, 175, 55, 0.1);
      border-left: 3px solid #d4af37;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 25px;
    }

    .stat {
      display: flex;
      justify-content: space-between;
      color: #e0e0e0;
      margin: 8px 0;
    }

    .stat-label {
      color: #b8860b;
    }

    .stat-value {
      color: #00d4ff;
      font-weight: bold;
    }

    /* Actions */
    .win-limit-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .btn-primary,
    .btn-secondary,
    .btn-tertiary {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn-primary {
      background: linear-gradient(135deg, #d4af37 0%, #f4d03f 100%);
      color: #000;
      box-shadow: 0 4px 15px rgba(212, 175, 55, 0.4);
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(212, 175, 55, 0.6);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-secondary {
      background: rgba(224, 224, 224, 0.15);
      color: #e0e0e0;
      border: 1px solid #666;
    }

    .btn-secondary:hover {
      background: rgba(224, 224, 224, 0.25);
      border-color: #d4af37;
    }

    .btn-tertiary {
      background: rgba(0, 212, 255, 0.1);
      color: #00d4ff;
      border: 1px solid #00d4ff;
    }

    .btn-tertiary:hover {
      background: rgba(0, 212, 255, 0.2);
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
    }

    /* Settings Modal */
    .win-limit-settings-content h2 {
      color: #d4af37;
      font-size: 24px;
      margin-bottom: 10px;
      text-align: center;
    }

    .settings-description {
      color: #b0b0b0;
      text-align: center;
      margin-bottom: 25px;
      font-size: 14px;
    }

    .settings-form {
      margin-bottom: 25px;
    }

    .settings-form label {
      display: block;
      color: #d4af37;
      font-weight: 600;
      margin-bottom: 8px;
      text-transform: uppercase;
      font-size: 13px;
    }

    .win-limit-input {
      width: 100%;
      padding: 12px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid #d4af37;
      border-radius: 6px;
      color: #00d4ff;
      font-size: 16px;
      box-sizing: border-box;
      transition: border-color 0.3s ease;
    }

    .win-limit-input:focus {
      outline: none;
      border-color: #00d4ff;
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
    }

    .input-hint {
      color: #888;
      font-size: 12px;
      margin-top: 6px;
    }

    .settings-status {
      margin-bottom: 25px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      color: #e0e0e0;
      cursor: pointer;
      font-size: 14px;
    }

    .checkbox-label input {
      margin-right: 10px;
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: #d4af37;
    }

    .win-limit-info {
      background: rgba(0, 212, 255, 0.08);
      border-left: 3px solid #00d4ff;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 25px;
      font-size: 13px;
    }

    .win-limit-info p {
      color: #b8d4e0;
      margin: 0;
      line-height: 1.5;
    }

    .win-limit-info strong {
      color: #00d4ff;
    }

    /* Responsive */
    @media (max-width: 600px) {
      .win-limit-modal-box {
        padding: 30px 20px;
      }

      .win-limit-amount {
        font-size: 36px;
      }

      .win-limit-modal-content h2 {
        font-size: 20px;
      }

      .btn-primary,
      .btn-secondary,
      .btn-tertiary {
        font-size: 14px;
        padding: 10px 20px;
      }
    }
  `;

  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
})();

