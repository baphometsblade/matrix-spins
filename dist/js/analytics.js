/**
 * Matrix Spins Casino — Analytics & Conversion Tracking
 * Auto-injecting IIFE for GA4 integration, conversion events,
 * UTM handling, Core Web Vitals, and user property management.
 * Domain: msaart.online
 */
(function () {
  'use strict';

  var GA_ID = window.MS_GA_ID || 'G-XXXXXXXXXX';
  var DEBUG = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var gaReady = false;

  // ---------- Consent ----------
  function hasAnalyticsConsent() {
    try {
      var consent = JSON.parse(localStorage.getItem('ms_cookie_consent'));
      return consent && consent.analytics === true;
    } catch (_) {
      return false;
    }
  }

  // ---------- Load GA4 ----------
  function loadGA4() {
    if (!hasAnalyticsConsent()) {
      window.gtag = noop;
      log('Analytics consent not granted — GA4 disabled');
      return;
    }

    try {
      var script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
      script.onerror = function () {
        log('GA4 script blocked or failed to load');
        gaReady = false;
        window.gtag = noop;
      };
      document.head.appendChild(script);

      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };

      gtag('js', new Date());

      gtag('consent', 'default', {
        analytics_storage: 'granted',
        ad_storage: 'denied'
      });

      gtag('config', GA_ID, {
        send_page_view: false,
        enhanced_measurement: true,
        cookie_domain: 'auto',
        cookie_flags: 'SameSite=None;Secure'
      });

      gaReady = true;
      log('GA4 initialised with ID ' + GA_ID);
    } catch (e) {
      window.gtag = noop;
      log('GA4 init error: ' + e.message);
    }
  }

  // ---------- Helpers ----------
  function noop() {}

  function log() {
    if (DEBUG && console && console.log) {
      console.log.apply(console, ['[MatrixAnalytics]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function safeGtag() {
    if (gaReady && typeof window.gtag === 'function') {
      window.gtag.apply(null, arguments);
    }
    if (DEBUG) { log('event:', arguments[1], arguments[2]); }
  }

  // ---------- UTM Parameters ----------
  function captureUTM() {
    try {
      var params = new URLSearchParams(window.location.search);
      var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
      var utm = {};
      var found = false;
      keys.forEach(function (k) {
        var v = params.get(k);
        if (v) { utm[k] = v; found = true; }
      });
      if (found) {
        sessionStorage.setItem('ms_utm_params', JSON.stringify(utm));
      }
    } catch (_) {}
  }

  function getUTM() {
    try {
      return JSON.parse(sessionStorage.getItem('ms_utm_params')) || {};
    } catch (_) {
      return {};
    }
  }

  function mergeUTM(params) {
    var utm = getUTM();
    var merged = {};
    for (var k in params) { if (params.hasOwnProperty(k)) merged[k] = params[k]; }
    for (var u in utm) { if (utm.hasOwnProperty(u)) merged[u] = utm[u]; }
    return merged;
  }

  // ---------- User Properties ----------
  function syncUserProperties() {
    try {
      var raw = sessionStorage.getItem('ms_user') || sessionStorage.getItem('user');
      if (!raw) return;
      var user = JSON.parse(raw);
      if (user.id) {
        safeGtag('set', { user_id: String(user.id) });
      }
      var props = {};
      if (user.vip_tier !== undefined) props.vip_tier = user.vip_tier;
      if (user.created_at) {
        var age = Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000);
        props.account_age_days = age;
      }
      props.has_deposited = !!localStorage.getItem('ms_first_deposit');
      safeGtag('set', 'user_properties', props);
      log('User properties synced', props);
    } catch (_) {}
  }

  // ---------- Conversion Events ----------
  function bindConversionEvents() {
    on('matrix-signup', function () {
      track('sign_up', { method: 'matrix' });
    });

    on('matrix-login', function () {
      track('login', { method: 'matrix' });
    });

    on('matrix-deposit', function (e) {
      var amount = (e.detail && e.detail.amount) || 0;
      track('deposit', { value: amount, currency: 'USD' });

      if (!localStorage.getItem('ms_first_deposit')) {
        localStorage.setItem('ms_first_deposit', Date.now().toString());
        track('first_deposit', { value: amount, currency: 'USD' });
      }
    });

    on('matrix-checkout-start', function () {
      track('begin_checkout');
    });

    on('matrix-deposit-success', function (e) {
      var detail = (e && e.detail) || {};
      track('purchase', {
        value: detail.amount || 0,
        currency: detail.currency || 'USD',
        transaction_id: detail.transaction_id || ''
      });
    });

    on('matrix-spin', function (e) {
      var detail = (e && e.detail) || {};
      track('spin', {
        game_name: detail.game || '',
        bet_amount: detail.bet || 0
      });
    });

    on('matrix-vip-upgrade', function (e) {
      var detail = (e && e.detail) || {};
      track('level_up', {
        level: detail.tier || '',
        character: 'vip'
      });
    });

    on('matrix-share', function (e) {
      var detail = (e && e.detail) || {};
      track('share', {
        method: detail.method || 'referral',
        content_type: 'referral_link'
      });
    });

    on('matrix-tutorial-complete', function () {
      track('tutorial_complete');
    });
  }

  function on(eventName, handler) {
    document.addEventListener(eventName, handler);
  }

  // ---------- Page View Tracking ----------
  function trackPageView() {
    track('page_view', {
      page_location: window.location.href,
      page_title: document.title
    });
  }

  function bindSPANavigation() {
    window.addEventListener('hashchange', function () {
      trackPageView();
    });

    var _pushState = history.pushState;
    if (_pushState) {
      history.pushState = function () {
        _pushState.apply(history, arguments);
        trackPageView();
      };
    }

    var _replaceState = history.replaceState;
    if (_replaceState) {
      history.replaceState = function () {
        _replaceState.apply(history, arguments);
        trackPageView();
      };
    }

    window.addEventListener('popstate', function () {
      trackPageView();
    });
  }

  // ---------- Core Web Vitals ----------
  function trackWebVitals() {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      // LCP
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        if (last) track('web_vitals', { metric: 'LCP', value: Math.round(last.startTime) });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}

    try {
      // FID
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries[0]) track('web_vitals', { metric: 'FID', value: Math.round(entries[0].processingStart - entries[0].startTime) });
      }).observe({ type: 'first-input', buffered: true });
    } catch (_) {}

    try {
      // CLS
      var clsValue = 0;
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (!entry.hadRecentInput) clsValue += entry.value;
        });
        track('web_vitals', { metric: 'CLS', value: Math.round(clsValue * 1000) / 1000 });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (_) {}
  }

  // ---------- Public API ----------
  function track(eventName, params) {
    var merged = mergeUTM(params || {});
    safeGtag('event', eventName, merged);
  }

  function setUserId(id) {
    if (id) {
      safeGtag('set', { user_id: String(id) });
      log('User ID set:', id);
    }
  }

  function setGAId(measurementId) {
    if (measurementId && typeof measurementId === 'string') {
      GA_ID = measurementId;
      if (gaReady) {
        gtag('config', GA_ID, { send_page_view: false, enhanced_measurement: true });
      }
      log('GA ID updated to', GA_ID);
    }
  }

  window.MatrixAnalytics = {
    track: track,
    setUserId: setUserId,
    setGAId: setGAId
  };

  // ---------- Initialise ----------
  function init() {
    captureUTM();
    loadGA4();
    syncUserProperties();
    bindConversionEvents();
    trackPageView();
    bindSPANavigation();
    trackWebVitals();
    log('Initialisation complete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
