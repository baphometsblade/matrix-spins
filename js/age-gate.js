/**
 * Matrix Spins - Age Verification Gate
 * Auto-injecting age gate that blocks access until user confirms 18+
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ms_age_verified';
  var DENY_KEY = 'ms_age_denied';
  // Deny choices stick for 30 days. A determined user can still clear
  // localStorage, but the previous build set NO flag and just navigated
  // to google.com — pressing Back returned the user straight to a fully-
  // functional casino. The flag introduces friction; the audit row at
  // /api/age-deny is the actually-defensible compliance evidence.
  var DENY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function isVerified() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return data && data.verified === true;
    } catch (e) {
      return false;
    }
  }

  function isDenied() {
    try {
      var data = JSON.parse(localStorage.getItem(DENY_KEY));
      if (!data || !data.deniedAt) return false;
      return (Date.now() - data.deniedAt) < DENY_TTL_MS;
    } catch (e) {
      return false;
    }
  }

  function setVerified() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      verified: true,
      timestamp: Date.now()
    }));
  }

  function setDenied() {
    localStorage.setItem(DENY_KEY, JSON.stringify({
      deniedAt: Date.now()
    }));
    // Best-effort audit log so the operator can see denial events.
    // Fire-and-forget — never block the redirect on a network error.
    try {
      fetch('/api/age-deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: new Date().toISOString() }),
        keepalive: true,
      }).catch(function () {});
    } catch (_) {}
  }

  function removeOverlay(overlay) {
    overlay.classList.add('age-gate--exiting');
    document.body.classList.remove('age-gate-active');

    // CRITICAL: do NOT rely solely on `animationend` to remove the overlay.
    // animationend never fires when CSS animations are suppressed —
    // prefers-reduced-motion (animation-duration → ~0), privacy/accessibility
    // extensions that inject `* { animation: none !important }`, and
    // forced-colors / high-contrast mode all do this. Without a fallback the
    // overlay froze on screen AFTER the user confirmed (setVerified already
    // ran), permanently blocking the entire site for those users — the
    // exact "buttons don't work" report. Verified in-browser: with
    // animations disabled, the animationend-only version never removed the
    // overlay; this fallback removes it unconditionally.
    var removed = false;
    function finalize() {
      if (removed) return;
      removed = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    // Remove when the fade-out finishes (normal path)…
    overlay.addEventListener('animationend', finalize);
    // …but ALWAYS remove via a timer slightly past the 0.35s exit animation,
    // so animation-suppressed environments are never left stuck. The
    // `removed` guard makes whichever fires second a no-op.
    setTimeout(finalize, 450);
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'age-gate-overlay';
    overlay.className = 'age-gate-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'age-gate-title');

    overlay.innerHTML =
      '<div class="age-gate-card">' +
        '<div class="age-gate-logo" aria-hidden="true">' +
          '<span class="age-gate-crown">♛</span>' +
          '<span class="age-gate-brand">Matrix Spins</span>' +
        '</div>' +
        '<h2 id="age-gate-title" class="age-gate-title">Age Verification Required</h2>' +
        '<p class="age-gate-message">' +
          'This website contains content related to online gambling. ' +
          'You must be 18 years or older to access this site.' +
        '</p>' +
        '<button type="button" class="age-gate-confirm" id="age-gate-confirm">' +
          'I confirm I am 18 years of age or older' +
        '</button>' +
        '<a href="https://www.google.com" class="age-gate-deny" id="age-gate-deny">' +
          'I am under 18' +
        '</a>' +
        '<p class="age-gate-disclaimer">' +
          'By entering, you agree to our ' +
          '<a href="terms.html">Terms &amp; Conditions</a> and ' +
          '<a href="responsible-gambling.html">Responsible Gambling</a> policy.' +
        '</p>' +
      '</div>';

    return overlay;
  }

  function show() {
    if (document.getElementById('age-gate-overlay')) return;

    var overlay = createOverlay();
    document.body.appendChild(overlay);
    document.body.classList.add('age-gate-active');
    // Force reflow then add visible class — overlay starts at display:none
    // so it never flashes uncontrolled fullscreen black before JS finishes wiring.
    overlay.offsetHeight; // eslint-disable-line no-unused-expressions
    overlay.classList.add('age-gate-visible');

    var confirmBtn = document.getElementById('age-gate-confirm');
    var denyLink = document.getElementById('age-gate-deny');

    confirmBtn.addEventListener('click', function () {
      setVerified();
      removeOverlay(overlay);
    });

    denyLink.addEventListener('click', function (e) {
      e.preventDefault();
      // Persist the deny choice (sticky for 30 days — see isDenied) and
      // fire-and-forget an audit log to /api/age-deny before navigating
      // off-site. Previously the deny path navigated to google.com with
      // NO flag set, so pressing Back returned the user to a fully
      // functional casino — trivially bypassable.
      setDenied();
      window.location.href = 'https://www.google.com';
    });

    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        var focusable = overlay.querySelectorAll('button, a[href]');
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    confirmBtn.focus();
  }

  function init() {
    // Previously denied users get re-blocked for the deny window (30 days)
    // by being navigated back off-site. They can still clear localStorage,
    // but at least the back-button bypass is closed.
    if (isDenied()) {
      window.location.replace('https://www.google.com');
      return;
    }
    if (!isVerified()) {
      show();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MatrixAgeGate = {
    show: show,
    isVerified: isVerified
  };
})();
