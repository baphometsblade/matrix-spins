/**
 * Matrix Spins - Age Verification Gate
 * Auto-injecting age gate that blocks access until user confirms 18+
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ms_age_verified';

  function isVerified() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return data && data.verified === true;
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

  function removeOverlay(overlay) {
    overlay.classList.add('age-gate--exiting');
    document.body.classList.remove('age-gate-active');
    overlay.addEventListener('animationend', function () {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
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
