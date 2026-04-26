(function() {
  'use strict';

  const STORAGE_KEY = 'ms_cookie_consent';
  const EVENT_NAME = 'cookie-consent-updated';

  const defaultPreferences = {
    essential: true,
    analytics: false,
    marketing: false,
    personalization: false
  };

  function getStoredConsent() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function saveConsent(preferences) {
    const consent = {
      accepted: true,
      preferences: { ...preferences, essential: true },
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: consent }));
    return consent;
  }

  function createToggle(id, label, description, checked, disabled) {
    return `
      <div class="mcc-pref-item">
        <div class="mcc-pref-info">
          <label class="mcc-pref-label" for="mcc-toggle-${id}">${label}</label>
          <p class="mcc-pref-desc">${description}</p>
        </div>
        <label class="mcc-toggle${disabled ? ' mcc-toggle--disabled' : ''}">
          <input type="checkbox" id="mcc-toggle-${id}" data-category="${id}"
            ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span class="mcc-toggle-slider"></span>
        </label>
      </div>`;
  }

  function injectStyles() {
    if (document.getElementById('mcc-styles-link')) return;
    const link = document.createElement('link');
    link.id = 'mcc-styles-link';
    link.rel = 'stylesheet';
    link.href = '/css/cookie-consent.css';
    document.head.appendChild(link);
  }

  function buildBanner() {
    const wrapper = document.createElement('div');
    wrapper.id = 'mcc-wrapper';
    wrapper.innerHTML = `
      <div id="mcc-banner" class="mcc-banner" role="dialog" aria-label="Cookie consent">
        <div class="mcc-banner-inner">
          <p class="mcc-banner-text">
            We use cookies to enhance your gaming experience, analyze site traffic, and personalize content.
          </p>
          <div class="mcc-banner-actions">
            <button id="mcc-accept-all" class="mcc-btn mcc-btn--primary">Accept All</button>
            <button id="mcc-reject" class="mcc-btn mcc-btn--secondary">Reject Non-Essential</button>
            <button id="mcc-customize" class="mcc-btn mcc-btn--link">Customize</button>
          </div>
        </div>
      </div>

      <div id="mcc-overlay" class="mcc-overlay" aria-hidden="true">
        <div class="mcc-panel" role="dialog" aria-label="Cookie preferences">
          <div class="mcc-panel-header">
            <h2 class="mcc-panel-title">Cookie Preferences</h2>
            <button id="mcc-panel-close" class="mcc-panel-close" aria-label="Close">&times;</button>
          </div>
          <div class="mcc-panel-body">
            ${createToggle('essential', 'Essential Cookies', 'Required for the site to function. These cannot be disabled.', true, true)}
            ${createToggle('analytics', 'Analytics Cookies', 'Help us understand how visitors interact with our site to improve performance.', false, false)}
            ${createToggle('marketing', 'Marketing Cookies', 'Used to deliver relevant advertisements and track campaign effectiveness.', false, false)}
            ${createToggle('personalization', 'Personalization Cookies', 'Allow us to remember your preferences and tailor your experience.', false, false)}
          </div>
          <div class="mcc-panel-footer">
            <button id="mcc-save-prefs" class="mcc-btn mcc-btn--primary">Save Preferences</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function bindEvents(wrapper) {
    const banner = wrapper.querySelector('#mcc-banner');
    const overlay = wrapper.querySelector('#mcc-overlay');

    wrapper.querySelector('#mcc-accept-all').addEventListener('click', function() {
      saveConsent({ essential: true, analytics: true, marketing: true, personalization: true });
      hideBanner(banner);
    });

    wrapper.querySelector('#mcc-reject').addEventListener('click', function() {
      saveConsent({ ...defaultPreferences });
      hideBanner(banner);
    });

    wrapper.querySelector('#mcc-customize').addEventListener('click', function() {
      openPanel(overlay);
    });

    wrapper.querySelector('#mcc-panel-close').addEventListener('click', function() {
      closePanel(overlay);
    });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closePanel(overlay);
    });

    wrapper.querySelector('#mcc-save-prefs').addEventListener('click', function() {
      const prefs = { essential: true };
      overlay.querySelectorAll('input[data-category]').forEach(function(input) {
        prefs[input.dataset.category] = input.checked;
      });
      saveConsent(prefs);
      closePanel(overlay);
      hideBanner(banner);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !overlay.classList.contains('mcc-hidden')) {
        closePanel(overlay);
      }
    });
  }

  function showBanner(banner) {
    banner.classList.remove('mcc-hidden');
    banner.classList.add('mcc-visible');
  }

  function hideBanner(banner) {
    banner.classList.remove('mcc-visible');
    banner.classList.add('mcc-hidden');
  }

  function openPanel(overlay) {
    var stored = getStoredConsent();
    if (stored && stored.preferences) {
      overlay.querySelectorAll('input[data-category]').forEach(function(input) {
        if (!input.disabled) {
          input.checked = !!stored.preferences[input.dataset.category];
        }
      });
    }
    overlay.classList.remove('mcc-hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closePanel(overlay) {
    overlay.classList.add('mcc-hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function init() {
    injectStyles();
    var wrapper = buildBanner();
    var banner = wrapper.querySelector('#mcc-banner');
    var overlay = wrapper.querySelector('#mcc-overlay');

    overlay.classList.add('mcc-hidden');

    if (getStoredConsent()) {
      banner.classList.add('mcc-hidden');
    } else {
      requestAnimationFrame(function() {
        showBanner(banner);
      });
    }

    bindEvents(wrapper);
  }

  /* Public API */
  window.MatrixCookieConsent = {
    show: function() {
      var banner = document.querySelector('#mcc-banner');
      if (banner) showBanner(banner);
    },
    getPreferences: function() {
      var stored = getStoredConsent();
      return stored ? stored.preferences : { ...defaultPreferences };
    },
    reset: function() {
      localStorage.removeItem(STORAGE_KEY);
      var banner = document.querySelector('#mcc-banner');
      if (banner) showBanner(banner);
      var overlay = document.querySelector('#mcc-overlay');
      if (overlay) {
        overlay.querySelectorAll('input[data-category]').forEach(function(input) {
          if (!input.disabled) input.checked = false;
        });
        closePanel(overlay);
      }
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: null }));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
