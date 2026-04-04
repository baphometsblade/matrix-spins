/**
 * Loading Screen Module
 * Displays a stylish loading overlay with rotating tips when opening games
 */
window.LoadingScreen = (function() {
  'use strict';

  // Tips pool for rotating display
  const TIPS = [
    'Set a budget before you play and stick to it.',
    'The RTP for this game is [rtp]% — meaning $[rtp] is returned for every $100 wagered on average.',
    'Take regular breaks — it helps you make better decisions.',
    'Slots are random — previous results don\'t affect future spins.',
    'Higher volatility means bigger but less frequent wins.',
    'Check your play history in your profile to track your activity.',
    'Use self-exclusion tools if you need a break.'
  ];

  // DOM elements
  let overlay = null;
  let timeoutId = null;
  let tipRotationId = null;
  let currentTipIndex = 0;
  let currentRtp = null;

  /**
   * Create the loading screen HTML structure
   */
  function createLoadingScreen() {
    const container = document.createElement('div');
    container.id = 'loading-screen-overlay';
    container.innerHTML = `
      <div class="loading-screen-content">
        <div class="casino-logo">
          <svg viewBox="0 0 100 100" class="logo-icon">
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="2"/>
            <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
            <text x="50" y="58" text-anchor="middle" font-size="32" font-weight="bold" fill="currentColor">♠</text>
          </svg>
        </div>
        <h1 class="loading-text">Loading <span class="game-name"></span>...</h1>
        <div class="tip-container">
          <p class="tip-text"></p>
        </div>
        <div class="progress-wrapper">
          <div class="progress-bar"></div>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #loading-screen-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1426 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        animation: fadeIn 0.4s ease-in-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes fadeOut {
        from {
          opacity: 1;
        }
        to {
          opacity: 0;
        }
      }

      #loading-screen-overlay.fade-out {
        animation: fadeOut 0.4s ease-in-out forwards;
      }

      .loading-screen-content {
        text-align: center;
        max-width: 500px;
        padding: 40px;
      }

      .casino-logo {
        margin-bottom: 30px;
      }

      .logo-icon {
        width: 100px;
        height: 100px;
        color: #d4af37;
        animation: pulse 1.5s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.6;
          transform: scale(1.1);
        }
      }

      .loading-text {
        font-size: 28px;
        font-weight: 300;
        color: #ffffff;
        margin: 0 0 30px 0;
        letter-spacing: 1px;
      }

      .game-name {
        color: #d4af37;
        font-weight: 600;
      }

      .tip-container {
        background: rgba(212, 175, 55, 0.05);
        border: 1px solid rgba(212, 175, 55, 0.3);
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 30px;
        min-height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tip-text {
        font-size: 14px;
        color: #c9b89d;
        margin: 0;
        line-height: 1.6;
        animation: tipFade 0.5s ease-in-out;
      }

      @keyframes tipFade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .progress-wrapper {
        background: rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 2px;
        overflow: hidden;
        height: 6px;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #d4af37 0%, #ffd700 50%, #d4af37 100%);
        border-radius: 12px;
        width: 0%;
        transition: width 2s cubic-bezier(0.4, 0.0, 0.2, 1);
      }

      #loading-screen-overlay.loading-complete .progress-bar {
        width: 100%;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(container);
    return container;
  }

  /**
   * Get the next tip from the pool
   */
  function getNextTip() {
    const tip = TIPS[currentTipIndex];
    currentTipIndex = (currentTipIndex + 1) % TIPS.length;

    if (currentRtp && tip.includes('[rtp]')) {
      return tip.replace(/\[rtp\]/g, currentRtp);
    }
    return tip;
  }

  /**
   * Update the displayed tip
   */
  function updateTip() {
    if (!overlay) return;

    const tipElement = overlay.querySelector('.tip-text');
    if (tipElement) {
      tipElement.textContent = getNextTip();
    }
  }

  /**
   * Show the loading screen
   */
  function show(gameName, gameRtp) {
    try {
      if (gameName === undefined || gameName === null) {
        console.warn('LoadingScreen.show(): gameName is required');
        return;
      }

      // Initialize state
      currentRtp = gameRtp || null;
      currentTipIndex = 0;

      // Create overlay if not already present
      if (!overlay) {
        overlay = createLoadingScreen();
      } else {
        overlay.classList.remove('fade-out');
      }

      // Update game name
      const gameNameElement = overlay.querySelector('.game-name');
      if (gameNameElement) {
        gameNameElement.textContent = gameName;
      }

      // Display initial tip
      updateTip();

      // Rotate tips every 1 second
      tipRotationId = setInterval(updateTip, 1000);

      // Animate progress bar
      overlay.classList.remove('loading-complete');
      setTimeout(() => {
        overlay.classList.add('loading-complete');
      }, 50);

      // Auto-hide after 2.5 seconds
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        hide();
      }, 2500);

    } catch (error) {
      console.warn('LoadingScreen.show() error:', error.message);
    }
  }

  /**
   * Hide the loading screen
   */
  function hide() {
    try {
      if (!overlay) return;

      // Clear rotation interval
      if (tipRotationId) {
        clearInterval(tipRotationId);
        tipRotationId = null;
      }

      // Clear auto-hide timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Fade out animation
      overlay.classList.add('fade-out');

      // Remove from DOM after animation completes
      setTimeout(() => {
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
          overlay = null;
        }
      }, 400);

    } catch (error) {
      console.warn('LoadingScreen.hide() error:', error.message);
    }
  }

  // Public API
  return {
    show: show,
    hide: hide
  };

})();
