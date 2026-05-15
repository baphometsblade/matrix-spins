/**
 * Matrix Spins Casino - Email Capture / Lead Generation System
 * Auto-injecting IIFE for newsletter popup with exit-intent,
 * timer, and scroll-depth triggers.
 */
(function () {
  'use strict';

  var STORAGE_KEYS = {
    subscribed: 'ms_email_subscribed',
    dismissed: 'ms_email_dismissed',
    pending: 'ms_pending_emails'
  };

  var DISMISS_COOLDOWN_DAYS = 7;
  var TIMER_DELAY_MS = 45000;
  var SCROLL_THRESHOLD = 0.6;
  var SUCCESS_AUTO_CLOSE_MS = 3000;

  var shown = false;
  var overlay = null;

  function getStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }

  function setStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* quota */ }
  }

  function getUTMParams() {
    var params = {};
    var search = window.location.search.substring(1);
    if (!search) return params;
    search.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0] && kv[0].indexOf('utm_') === 0) {
        params[kv[0]] = decodeURIComponent(kv[1] || '');
      }
    });
    return params;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  function shouldSuppress() {
    if (getStorage(STORAGE_KEYS.subscribed)) return true;
    var dismissed = getStorage(STORAGE_KEYS.dismissed);
    if (dismissed && dismissed.timestamp) {
      var elapsed = Date.now() - dismissed.timestamp;
      if (elapsed < DISMISS_COOLDOWN_DAYS * 86400000) return true;
    }
    var user = getStorage('ms_user') || getStorage('user_session');
    if (user && user.hasDeposited) return true;
    if (document.body.classList.contains('age-gate-active')) return true;
    if (document.querySelector('.mx-tour-overlay')) return true;
    if (document.querySelector('.mcc-overlay:not(.mcc-hidden)')) return true;
    if (document.querySelector('.mcc-banner.mcc-visible')) return true;
    return false;
  }

  function injectCSS() {
    if (document.querySelector('link[data-ms-email-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/email-capture.css';
    link.setAttribute('data-ms-email-css', '');
    document.head.appendChild(link);
  }

  function buildPopup() {
    overlay = document.createElement('div');
    overlay.className = 'ms-ec-overlay';
    overlay.innerHTML =
      '<div class="ms-ec-card" role="dialog" aria-modal="true" aria-label="Email signup offer">' +
        '<button class="ms-ec-close" aria-label="Close">&times;</button>' +
        '<div class="ms-ec-body">' +
          '<div class="ms-ec-emoji" aria-hidden="true">&#127873;</div>' +
          '<h2 class="ms-ec-title">Get 50 Free Spins!</h2>' +
          '<p class="ms-ec-sub">Join 10,000+ players. Enter your email for exclusive bonuses, free spins, and VIP offers.</p>' +
          '<form class="ms-ec-form" novalidate>' +
            '<div class="ms-ec-field">' +
              '<input type="email" class="ms-ec-input" placeholder="you@example.com" autocomplete="email" required />' +
              '<span class="ms-ec-error" aria-live="polite">Please enter a valid email</span>' +
            '</div>' +
            '<button type="submit" class="ms-ec-submit">Claim My Spins</button>' +
          '</form>' +
          '<button class="ms-ec-dismiss-link">No thanks, I don\'t want free spins</button>' +
          '<p class="ms-ec-privacy">We respect your privacy. Unsubscribe anytime.</p>' +
        '</div>' +
        '<div class="ms-ec-success" style="display:none;">' +
          '<div class="ms-ec-check" aria-hidden="true">&#10003;</div>' +
          '<h2 class="ms-ec-title">Check your inbox!</h2>' +
          '<p class="ms-ec-sub">Your free spins are on the way.</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    bindEvents();
  }

  function bindEvents() {
    var card = overlay.querySelector('.ms-ec-card');
    var form = overlay.querySelector('.ms-ec-form');
    var input = overlay.querySelector('.ms-ec-input');
    var errorEl = overlay.querySelector('.ms-ec-error');
    var closeBtn = overlay.querySelector('.ms-ec-close');
    var dismissLink = overlay.querySelector('.ms-ec-dismiss-link');
    closeBtn.addEventListener('click', dismiss);
    dismissLink.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('ms-ec-visible')) dismiss();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!isValidEmail(email)) {
        errorEl.classList.add('ms-ec-error--show');
        input.classList.add('ms-ec-input--invalid');
        return;
      }
      errorEl.classList.remove('ms-ec-error--show');
      input.classList.remove('ms-ec-input--invalid');
      submitEmail(email);
    });
    input.addEventListener('input', function () {
      errorEl.classList.remove('ms-ec-error--show');
      input.classList.remove('ms-ec-input--invalid');
    });
  }

  function submitEmail(email) {
    showSuccess();
    var payload = { email: email, source: 'popup', utm_params: getUTMParams() };
    fetch('/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('Server ' + res.status);
      setStorage(STORAGE_KEYS.subscribed, { email: email, timestamp: Date.now() });
    }).catch(function () {
      var pending = getStorage(STORAGE_KEYS.pending) || [];
      pending.push({ email: email, timestamp: Date.now(), payload: payload });
      setStorage(STORAGE_KEYS.pending, pending);
      setStorage(STORAGE_KEYS.subscribed, { email: email, timestamp: Date.now() });
    });
  }

  function showSuccess() {
    var body = overlay.querySelector('.ms-ec-body');
    var success = overlay.querySelector('.ms-ec-success');
    body.style.display = 'none';
    success.style.display = '';
    setTimeout(close, SUCCESS_AUTO_CLOSE_MS);
  }

  function show() {
    if (shown || shouldSuppress()) return;
    shown = true;
    injectCSS();
    buildPopup();
    overlay.offsetHeight;
    overlay.classList.add('ms-ec-visible');
  }

  function showWithRetry() {
    if (shouldSuppress()) { setTimeout(showWithRetry, 5000); return; }
    show();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('ms-ec-visible');
    setTimeout(function () {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
    }, 300);
  }

  function dismiss() {
    setStorage(STORAGE_KEYS.dismissed, { timestamp: Date.now() });
    close();
  }

  function initTriggers() {
    if (shouldSuppress()) return;
    document.addEventListener('mouseleave', function onLeave(e) {
      if (e.clientY <= 0) {
        document.removeEventListener('mouseleave', onLeave);
        showWithRetry();
      }
    });
    setTimeout(function () { showWithRetry(); }, TIMER_DELAY_MS);
    var scrollFired = false;
    window.addEventListener('scroll', function onScroll() {
      if (scrollFired) return;
      var scrolled = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
      if (scrolled >= SCROLL_THRESHOLD) {
        scrollFired = true;
        window.removeEventListener('scroll', onScroll);
        showWithRetry();
      }
    }, { passive: true });
  }

  window.MatrixEmailCapture = {
    show: function () { shown = false; show(); },
    isSubscribed: function () { return !!getStorage(STORAGE_KEYS.subscribed); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTriggers);
  } else {
    initTriggers();
  }
})();
