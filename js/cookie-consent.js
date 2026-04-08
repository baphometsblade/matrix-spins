/**
 * Cookie Consent Manager
 * Implements GDPR/CCPA compliant cookie consent banner with preference management
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'matrixSpins_cookieConsent';
  const PREFERENCES_KEY = 'matrixSpins_cookiePreferences';

  // Default preferences
  const DEFAULT_PREFERENCES = {
    essential: true,
    analytics: false,
    marketing: false
  };

  // Internal state
  let consentGiven = false;
  let preferences = { ...DEFAULT_PREFERENCES };
  let bannerElement = null;
  let preferencesPanel = null;

  /**
   * Initialize the cookie consent system
   */
  function init() {
    // Check if consent has already been given
    const storedConsent = localStorage.getItem(STORAGE_KEY);

    if (storedConsent) {
      consentGiven = true;
      try {
        preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || JSON.stringify(DEFAULT_PREFERENCES));
      } catch (e) {
        console.warn('Failed to parse stored cookie preferences', e);
        preferences = { ...DEFAULT_PREFERENCES };
      }
    } else {
      // Show banner if no consent given
      showBanner();
    }
  }

  /**
   * Create and display the cookie consent banner
   */
  function showBanner() {
    // Prevent duplicate banners
    if (bannerElement) {
      return;
    }

    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie Consent');
    banner.innerHTML = `
      <div class="cookie-banner-content">
        <div class="cookie-banner-text">
          <p>We use cookies to enhance your gaming experience and analyze site traffic.</p>
          <a href="/privacy" class="cookie-privacy-link">Privacy Policy</a>
        </div>
        <div class="cookie-banner-actions">
          <button id="cookie-manage-btn" class="cookie-btn cookie-btn-secondary" aria-label="Manage cookie preferences">
            Manage Preferences
          </button>
          <button id="cookie-accept-btn" class="cookie-btn cookie-btn-primary" aria-label="Accept all cookies">
            Accept All
          </button>
        </div>
      </div>
    `;

    // Add styles
    injectStyles();

    // Append to body
    document.body.appendChild(banner);
    bannerElement = banner;

    // Add event listeners
    var _acceptBtn = document.getElementById('cookie-accept-btn');
    var _manageBtn = document.getElementById('cookie-manage-btn');
    if (_acceptBtn) _acceptBtn.addEventListener('click', acceptAll);
    if (_manageBtn) _manageBtn.addEventListener('click', openPreferencesPanel);

    // Trigger animation
    requestAnimationFrame(() => {
      banner.classList.add('show');
    });
  }

  /**
   * Open the preferences management panel
   */
  function openPreferencesPanel() {
    if (preferencesPanel) {
      preferencesPanel.classList.add('show');
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'cookie-preferences-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Cookie Preferences');
    panel.innerHTML = `
      <div class="preferences-panel-overlay"></div>
      <div class="preferences-panel-content">
        <h2>Cookie Preferences</h2>

        <div class="preferences-group">
          <div class="preference-item">
            <div class="preference-header">
              <label for="cookie-essential">Essential Cookies</label>
              <span class="preference-badge">Always On</span>
            </div>
            <p class="preference-description">Required for basic site functionality. Cannot be disabled.</p>
            <input
              type="checkbox"
              id="cookie-essential"
              class="preference-toggle"
              checked
              disabled
            >
          </div>

          <div class="preference-item">
            <div class="preference-header">
              <label for="cookie-analytics">Analytics Cookies</label>
            </div>
            <p class="preference-description">Help us understand how you use our site to improve your experience.</p>
            <input
              type="checkbox"
              id="cookie-analytics"
              class="preference-toggle"
              data-preference="analytics"
            >
          </div>

          <div class="preference-item">
            <div class="preference-header">
              <label for="cookie-marketing">Marketing Cookies</label>
            </div>
            <p class="preference-description">Used to show you relevant content and advertisements.</p>
            <input
              type="checkbox"
              id="cookie-marketing"
              class="preference-toggle"
              data-preference="marketing"
            >
          </div>
        </div>

        <div class="preferences-actions">
          <button id="cookie-preferences-close" class="cookie-btn cookie-btn-secondary">
            Cancel
          </button>
          <button id="cookie-preferences-save" class="cookie-btn cookie-btn-primary">
            Save Preferences
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    preferencesPanel = panel;

    // Set initial state of toggles
    document.getElementById('cookie-analytics').checked = preferences.analytics;
    document.getElementById('cookie-marketing').checked = preferences.marketing;

    // Add event listeners
    var _prefClose = document.getElementById('cookie-preferences-close');
    var _prefSave = document.getElementById('cookie-preferences-save');
    var _prefOverlay = document.querySelector('.preferences-panel-overlay');
    if (_prefClose) _prefClose.addEventListener('click', closePreferencesPanel);
    if (_prefSave) _prefSave.addEventListener('click', savePreferences);
    if (_prefOverlay) _prefOverlay.addEventListener('click', closePreferencesPanel);

    // Close panel on Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        closePreferencesPanel();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    // Trigger animation
    requestAnimationFrame(() => {
      panel.classList.add('show');
    });
  }

  /**
   * Close the preferences panel
   */
  function closePreferencesPanel() {
    if (preferencesPanel) {
      preferencesPanel.classList.remove('show');
      setTimeout(() => {
        if (preferencesPanel && preferencesPanel.parentNode) {
          preferencesPanel.parentNode.removeChild(preferencesPanel);
          preferencesPanel = null;
        }
      }, 300);
    }
  }

  /**
   * Save user preferences and hide banner
   */
  function savePreferences() {
    preferences.analytics = document.getElementById('cookie-analytics').checked;
    preferences.marketing = document.getElementById('cookie-marketing').checked;

    storeConsent();
    closePreferencesPanel();
    hideBanner();
  }

  /**
   * Accept all cookies
   */
  function acceptAll() {
    preferences = {
      essential: true,
      analytics: true,
      marketing: true
    };

    storeConsent();
    hideBanner();
  }

  /**
   * Store consent in localStorage
   */
  function storeConsent() {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      consentGiven = true;
      console.warn('Cookie preferences saved');
    } catch (e) {
      console.warn('Failed to store cookie preferences', e);
    }
  }

  /**
   * Hide the consent banner
   */
  function hideBanner() {
    if (bannerElement) {
      bannerElement.classList.remove('show');
      setTimeout(() => {
        if (bannerElement && bannerElement.parentNode) {
          bannerElement.parentNode.removeChild(bannerElement);
          bannerElement = null;
        }
      }, 300);
    }
  }

  /**
   * Check if user has given consent
   */
  function hasConsented() {
    return consentGiven;
  }

  /**
   * Get current cookie preferences
   */
  function getPreferences() {
    return { ...preferences };
  }

  /**
   * Inject CSS styles
   */
  function injectStyles() {
    if (document.getElementById('cookie-consent-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'cookie-consent-styles';
    style.textContent = `
      /* Cookie Consent Banner */
      #cookie-consent-banner {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background-color: rgba(20, 20, 30, 0.95);
        border-top: 2px solid #d4af37;
        padding: 20px;
        z-index: 9999;
        transform: translateY(100%);
        transition: transform 0.3s ease-out;
        backdrop-filter: blur(10px);
      }

      #cookie-consent-banner.show {
        transform: translateY(0);
      }

      .cookie-banner-content {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
      }

      .cookie-banner-text {
        flex: 1;
        min-width: 200px;
      }

      .cookie-banner-text p {
        margin: 0 0 8px 0;
        color: #ffffff;
        font-size: 14px;
        line-height: 1.5;
      }

      .cookie-privacy-link {
        color: #d4af37;
        text-decoration: none;
        font-size: 13px;
        transition: color 0.2s;
      }

      .cookie-privacy-link:hover {
        color: #ffd700;
        text-decoration: underline;
      }

      .cookie-banner-actions {
        display: flex;
        gap: 10px;
        flex-shrink: 0;
      }

      /* Cookie Buttons */
      .cookie-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .cookie-btn:hover {
        transform: translateY(-1px);
      }

      .cookie-btn:active {
        transform: translateY(0);
      }

      .cookie-btn-primary {
        background-color: #d4af37;
        color: #1a1a2e;
      }

      .cookie-btn-primary:hover {
        background-color: #ffd700;
        box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);
      }

      .cookie-btn-secondary {
        background-color: rgba(255, 255, 255, 0.15);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.3);
      }

      .cookie-btn-secondary:hover {
        background-color: rgba(255, 255, 255, 0.25);
        border-color: rgba(255, 255, 255, 0.5);
      }

      /* Preferences Panel */
      #cookie-preferences-panel {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease-out;
      }

      #cookie-preferences-panel.show {
        opacity: 1;
        pointer-events: auto;
      }

      .preferences-panel-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
      }

      .preferences-panel-content {
        position: relative;
        background-color: #1a1a2e;
        border: 1px solid #d4af37;
        border-radius: 8px;
        padding: 30px;
        max-width: 450px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      }

      .preferences-panel-content h2 {
        margin: 0 0 25px 0;
        color: #d4af37;
        font-size: 22px;
      }

      .preferences-group {
        margin-bottom: 25px;
      }

      .preference-item {
        margin-bottom: 20px;
        padding: 15px;
        background-color: rgba(212, 175, 55, 0.05);
        border-radius: 6px;
        border-left: 3px solid #d4af37;
      }

      .preference-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .preference-header label {
        color: #ffffff;
        font-weight: 600;
        font-size: 15px;
        margin: 0;
      }

      .preference-badge {
        display: inline-block;
        background-color: #d4af37;
        color: #1a1a2e;
        padding: 4px 8px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .preference-description {
        color: #b0b0b0;
        font-size: 13px;
        margin: 0 0 12px 0;
        line-height: 1.4;
      }

      .preference-toggle {
        width: 20px;
        height: 20px;
        cursor: pointer;
        accent-color: #d4af37;
      }

      .preference-toggle:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .preferences-actions {
        display: flex;
        gap: 10px;
        margin-top: 25px;
        padding-top: 20px;
        border-top: 1px solid rgba(212, 175, 55, 0.2);
      }

      .preferences-actions button {
        flex: 1;
      }

      /* Mobile Responsive */
      @media (max-width: 768px) {
        .cookie-banner-content {
          flex-direction: column;
          align-items: stretch;
        }

        .cookie-banner-actions {
          flex-direction: column;
          width: 100%;
        }

        .cookie-btn {
          width: 100%;
        }

        .preferences-panel-content {
          width: 95%;
          padding: 20px;
        }

        .preferences-panel-content h2 {
          font-size: 18px;
        }

        .preference-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .preference-badge {
          margin-top: 6px;
        }
      }

      /* Accessibility */
      .cookie-btn:focus,
      .preference-toggle:focus {
        outline: 2px solid #d4af37;
        outline-offset: 2px;
      }

      #cookie-consent-banner:focus-within {
        box-shadow: inset 0 0 0 2px #d4af37;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Public API exposed to window
   */
  window.CookieConsent = {
    init,
    hasConsented,
    getPreferences
  };

  /**
   * Auto-initialize on DOM ready
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
