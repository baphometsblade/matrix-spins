(function() {
  'use strict';

  const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
  const WARNING_TIME = 25 * 60 * 1000; // 25 minutes in milliseconds
  const COUNTDOWN_DURATION = 5 * 60; // 5 minutes in seconds
  const THROTTLE_INTERVAL = 30 * 1000; // 30 seconds in milliseconds
  const STORAGE_TOKEN_KEY = 'casinoToken';

  let lastActivityTime = null;
  let idleTimer = null;
  let countdownTimer = null;
  let warningModalShown = false;
  let lastThrottleTime = 0;

  // Inject modal styles
  function injectStyles() {
    if (document.getElementById('session-timeout-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'session-timeout-styles';
    style.textContent = `
      #session-timeout-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      }

      #session-timeout-modal-content {
        background-color: #1a1a2e;
        border: 2px solid #ffd700;
        border-radius: 12px;
        padding: 40px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.9);
      }

      #session-timeout-modal-title {
        color: #ffd700;
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 20px;
      }

      #session-timeout-modal-message {
        color: #ffffff;
        font-size: 16px;
        margin-bottom: 20px;
        line-height: 1.5;
      }

      #session-timeout-countdown {
        color: #ffd700;
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 30px;
      }

      #session-timeout-button {
        background-color: #ffd700;
        color: #1a1a2e;
        border: none;
        border-radius: 6px;
        padding: 12px 30px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      #session-timeout-button:hover {
        background-color: #ffed4e;
        transform: scale(1.05);
      }

      #session-timeout-button:active {
        transform: scale(0.98);
      }
    `;

    document.head.appendChild(style);
  }

  // Check if user is logged in
  function isLoggedIn() {
    return !!localStorage.getItem(STORAGE_TOKEN_KEY);
  }

  // Update last activity time with throttling
  function updateActivity() {
    const now = Date.now();

    // Throttle to once per 30 seconds to avoid performance impact
    if (now - lastThrottleTime < THROTTLE_INTERVAL) {
      return;
    }

    lastThrottleTime = now;
    lastActivityTime = now;

    // Hide warning modal if user is active again
    if (warningModalShown) {
      hideWarningModal();
    }

    // Reset the idle timer
    resetTimer();
  }

  // Show warning modal
  function showWarningModal() {
    if (warningModalShown) {
      return;
    }

    warningModalShown = true;

    const modal = document.createElement('div');
    modal.id = 'session-timeout-modal';

    const content = document.createElement('div');
    content.id = 'session-timeout-modal-content';

    const title = document.createElement('div');
    title.id = 'session-timeout-modal-title';
    title.textContent = 'Are you still there?';

    const message = document.createElement('div');
    message.id = 'session-timeout-modal-message';
    message.textContent = 'Your session will expire due to inactivity. Please confirm to continue.';

    const countdown = document.createElement('div');
    countdown.id = 'session-timeout-countdown';
    countdown.textContent = 'Time remaining: 5:00';

    const button = document.createElement('button');
    button.id = 'session-timeout-button';
    button.textContent = "I'm Still Here";
    button.addEventListener('click', function() {
      hideWarningModal();
      reset();
    });

    content.appendChild(title);
    content.appendChild(message);
    content.appendChild(countdown);
    content.appendChild(button);

    modal.appendChild(content);
    document.body.appendChild(modal);

    // Start countdown timer
    startCountdownTimer(countdown);
  }

  // Hide warning modal
  function hideWarningModal() {
    warningModalShown = false;

    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    const modal = document.getElementById('session-timeout-modal');
    if (modal) {
      modal.remove();
    }
  }

  // Start countdown timer that updates every second
  function startCountdownTimer(countdownElement) {
    let secondsRemaining = COUNTDOWN_DURATION;

    countdownTimer = setInterval(function() {
      secondsRemaining--;

      if (secondsRemaining < 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        logout();
        return;
      }

      const minutes = Math.floor(secondsRemaining / 60);
      const seconds = secondsRemaining % 60;
      const timeString = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
      countdownElement.textContent = 'Time remaining: ' + timeString;
    }, 1000);
  }

  // Handle auto-logout
  async function logout() {
    hideWarningModal();

    // Try to call logout API
    if (typeof logout === 'function' && logout.name !== 'logout') {
      try {
        await api('/api/session/logout', { method: 'POST' });
      } catch (err) {
        console.warn('Session logout API call failed:', err);
      }
    }

    // Clear token and reload
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    window.location.reload();
  }

  // API helper function
  async function api(path, opts = {}) {
    if (typeof apiRequest === 'function') {
      return apiRequest(path, opts);
    }

    const tokenKey = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : STORAGE_TOKEN_KEY;
    const token = localStorage.getItem(tokenKey);

    if (!token) {
      return null;
    }

    try {
      const res = await fetch(path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(opts.headers || {})
        }
      });

      return res.json();
    } catch (err) {
      console.warn('API request failed:', err);
      return null;
    }
  }

  // Reset the idle timer
  function resetTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(function() {
      // Show warning at 25 minutes
      showWarningModal();

      // Auto-logout at 30 minutes (5 minutes after warning)
      setTimeout(function() {
        if (warningModalShown) {
          logout();
        }
      }, 5 * 60 * 1000);
    }, WARNING_TIME);
  }

  // Initialize session timeout
  function init() {
    // Only initialize if user is logged in
    if (!isLoggedIn()) {
      return;
    }

    // Inject styles
    injectStyles();

    // Set initial activity time
    lastActivityTime = Date.now();

    // Attach event listeners for user activity
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

    events.forEach(function(eventName) {
      document.addEventListener(eventName, updateActivity, { passive: true });
    });

    // Start the idle timer
    resetTimer();
  }

  // Reset idle timeout (public API)
  function reset() {
    if (!isLoggedIn()) {
      return;
    }

    updateActivity();
  }

  // Get current idle time in seconds (public API)
  function getIdleTime() {
    if (!lastActivityTime) {
      return 0;
    }

    return Math.floor((Date.now() - lastActivityTime) / 1000);
  }

  // Expose public API
  window.SessionTimeout = {
    init: init,
    reset: reset,
    getIdleTime: getIdleTime
  };

})();
