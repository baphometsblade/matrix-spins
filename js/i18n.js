(function() {
  'use strict';

  const DEFAULT_LOCALE = 'en';
  const STORAGE_KEY = 'i18n_locale';

  const translations = {
    en: {
      'nav.lobby': 'Lobby',
      'nav.wallet': 'Cashier',
      'nav.profile': 'Profile',
      'nav.vip': 'VIP Club',
      'nav.promos': 'Promotions',
      'game.spin': 'SPIN',
      'game.bet': 'Bet',
      'game.win': 'Win!',
      'game.autoSpin': 'Auto Spin',
      'auth.login': 'Login',
      'auth.register': 'Register',
      'auth.logout': 'Logout',
      'wallet.deposit': 'Deposit',
      'wallet.withdraw': 'Withdraw',
      'wallet.balance': 'Balance',
      'rg.selfExclusion': 'Self-Exclusion',
      'rg.depositLimits': 'Deposit Limits',
      'rg.sessionTimeout': 'Session Timeout'
    },
    es: {
      'nav.lobby': 'Vestíbulo',
      'nav.wallet': 'Cajero',
      'nav.profile': 'Perfil',
      'nav.vip': 'Club VIP',
      'nav.promos': 'Promociones',
      'game.spin': 'GIRAR',
      'game.bet': 'Apuesta',
      'game.win': '¡Ganaste!',
      'game.autoSpin': 'Giro Automático',
      'auth.login': 'Iniciar Sesión',
      'auth.register': 'Registrarse',
      'auth.logout': 'Cerrar Sesión',
      'wallet.deposit': 'Depositar',
      'wallet.withdraw': 'Retirar',
      'wallet.balance': 'Saldo',
      'rg.selfExclusion': 'Autoexclusión',
      'rg.depositLimits': 'Límites de Depósito',
      'rg.sessionTimeout': 'Tiempo de Sesión'
    }
  };

  let currentLocale = DEFAULT_LOCALE;

  /**
   * Detects browser language preference
   * @returns {string} Language code (e.g., 'en', 'es')
   */
  function detectBrowserLanguage() {
    const storedLocale = localStorage.getItem(STORAGE_KEY);
    if (storedLocale && translations[storedLocale]) {
      return storedLocale;
    }

    const browserLang = navigator.language || navigator.userLanguage || '';
    const langCode = browserLang.split('-')[0].toLowerCase();

    if (translations[langCode]) {
      return langCode;
    }

    return DEFAULT_LOCALE;
  }

  /**
   * Initialize i18n framework
   */
  function init() {
    currentLocale = detectBrowserLanguage();
  }

  /**
   * Get translated string for a key
   * Falls back to English if translation is missing
   * @param {string} key - Translation key (e.g., 'nav.lobby')
   * @returns {string} Translated string or key if not found
   */
  function t(key) {
    if (!key || typeof key !== 'string') {
      console.warn('[i18n] Invalid key provided to t():', key);
      return '';
    }

    const locale = currentLocale;

    if (translations[locale] && translations[locale][key]) {
      return translations[locale][key];
    }

    if (locale !== DEFAULT_LOCALE && translations[DEFAULT_LOCALE][key]) {
      return translations[DEFAULT_LOCALE][key];
    }

    console.warn('[i18n] Missing translation for key:', key, 'in locale:', locale);
    return key;
  }

  /**
   * Set the current locale and persist preference
   * @param {string} locale - Language code (e.g., 'en', 'es')
   */
  function setLocale(locale) {
    if (!translations[locale]) {
      console.warn('[i18n] Locale not supported:', locale);
      return;
    }

    currentLocale = locale;
    localStorage.setItem(STORAGE_KEY, locale);

    // Dispatch custom event for reactive updates
    if (window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('i18n:localeChanged', { detail: { locale } }));
    }
  }

  /**
   * Get the current locale code
   * @returns {string} Current locale code
   */
  function getLocale() {
    return currentLocale;
  }

  /**
   * Show language picker dropdown UI
   * Creates a floating dropdown in bottom-right corner
   */
  function showLanguagePicker() {
    const existingPicker = document.getElementById('i18n-language-picker');
    if (existingPicker) {
      existingPicker.remove();
      return;
    }

    const picker = document.createElement('div');
    picker.id = 'i18n-language-picker';
    picker.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 10000;
      font-family: Arial, sans-serif;
      min-width: 150px;
      overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      background: #f5f5f5;
      padding: 10px 12px;
      border-bottom: 1px solid #eee;
      font-weight: bold;
      font-size: 13px;
      color: #333;
    `;
    header.textContent = currentLocale === 'es' ? 'Idioma' : 'Language';

    const optionsContainer = document.createElement('div');

    const locales = [
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Español' }
    ];

    locales.forEach(locale => {
      const option = document.createElement('button');
      option.style.cssText = `
        display: block;
        width: 100%;
        padding: 10px 12px;
        border: none;
        background: ${currentLocale === locale.code ? '#e8f4f8' : 'white'};
        color: ${currentLocale === locale.code ? '#0066cc' : '#333'};
        text-align: left;
        cursor: pointer;
        font-size: 13px;
        font-weight: ${currentLocale === locale.code ? 'bold' : 'normal'};
        transition: background 0.2s;
      `;
      option.textContent = locale.label;

      option.onmouseover = function() {
        if (currentLocale !== locale.code) {
          this.style.background = '#f9f9f9';
        }
      };

      option.onmouseout = function() {
        if (currentLocale !== locale.code) {
          this.style.background = 'white';
        }
      };

      option.onclick = function() {
        setLocale(locale.code);
        picker.remove();
      };

      optionsContainer.appendChild(option);
    });

    picker.appendChild(header);
    picker.appendChild(optionsContainer);
    document.body.appendChild(picker);

    // Close picker on outside click
    function closeOnClickOutside(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closeOnClickOutside);
      }
    }

    setTimeout(() => {
      document.addEventListener('click', closeOnClickOutside);
    }, 0);
  }

  /**
   * Get available locales
   * @returns {string[]} Array of supported locale codes
   */
  function getAvailableLocales() {
    return Object.keys(translations);
  }

  /**
   * Get all translations for a specific locale
   * @param {string} locale - Language code
   * @returns {Object} Translation dictionary or empty object if locale not found
   */
  function getTranslations(locale) {
    return translations[locale] || {};
  }

  // Expose public API
  window.I18n = {
    init,
    t,
    setLocale,
    getLocale,
    showLanguagePicker,
    getAvailableLocales,
    getTranslations
  };

})();
