/* Matrix Spins — PWA Install + Update Notification
 * - Registers /sw.js once
 * - Handles beforeinstallprompt: shows "Add to Home Screen" banner (deferrable)
 * - Detects new SW + shows "Update available" toast with reload action
 * - Reads/respects user dismissal so we don't nag forever
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  // Don't show install prompt if already running standalone
  var standalone = matchMedia('(display-mode: standalone)').matches ||
                   navigator.standalone === true;

  // Don't show in admin
  if (location.pathname.indexOf('/admin') === 0) return;

  var DISMISS_KEY = 'pwa_install_dismissed_until';
  var deferredPrompt = null;

  // ─── 1. Register service worker ──────────────────────────────
  function registerSW() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (reg) {
        // New SW found while page is open
        reg.addEventListener('updatefound', function () {
          var newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(reg);
            }
          });
        });

        // Periodic update check (every 30 min on same tab)
        setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn('SW registration failed:', err);
      });

    // When the new SW takes control, reload exactly once so the page picks
    // up the freshest static assets.
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  }

  // ─── 2. Install prompt ───────────────────────────────────────
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (standalone) return;
    var dismissUntil = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (Date.now() < dismissUntil) return;
    // Show after a small delay so it doesn't fight initial paint
    setTimeout(showInstallBanner, 8000);
  });

  window.addEventListener('appinstalled', function () {
    hideInstallBanner();
    deferredPrompt = null;
    try { localStorage.removeItem(DISMISS_KEY); } catch (_) {}
  });

  function showInstallBanner() {
    if (!deferredPrompt) return;
    if (document.getElementById('pwaInstallBanner')) return;

    var banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install Matrix Spins');
    banner.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:18px',
      'transform:translateX(-50%)',
      'max-width:420px', 'width:calc(100% - 24px)',
      'background:linear-gradient(180deg,#0d2818 0%,#0a0a0a 100%)',
      'color:#00ff41', 'border:1px solid #00ff41',
      'border-radius:12px', 'padding:14px 16px',
      'font-family:Inter,system-ui,sans-serif', 'font-size:14px',
      'box-shadow:0 10px 40px rgba(0,255,65,0.25),0 4px 14px rgba(0,0,0,0.6)',
      'z-index:99999', 'display:flex', 'align-items:center', 'gap:12px',
      'animation:pwaSlideUp .35s ease-out'
    ].join(';');

    var icon = document.createElement('img');
    icon.src = '/assets/icon-192.svg';
    icon.alt = '';
    icon.width = 44; icon.height = 44;
    icon.style.cssText = 'flex:0 0 auto;border-radius:8px';

    var text = document.createElement('div');
    text.style.cssText = 'flex:1;line-height:1.35';
    var t1 = document.createElement('strong');
    t1.style.cssText = 'display:block;color:#fff;font-size:14px';
    t1.textContent = 'Install Matrix Spins';
    var t2 = document.createElement('span');
    t2.style.cssText = 'display:block;font-size:12px;opacity:.85';
    t2.textContent = 'Add to home screen for faster access.';
    text.appendChild(t1); text.appendChild(t2);

    var installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.textContent = 'Install';
    installBtn.style.cssText = [
      'background:#00ff41', 'color:#000',
      'border:0', 'border-radius:8px', 'padding:10px 14px',
      'font-weight:700', 'cursor:pointer',
      'font-size:13px', 'letter-spacing:.04em'
    ].join(';');
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome !== 'accepted') {
          // Snooze for 14 days on dismiss
          try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 14 * 86400 * 1000)); } catch (_) {}
        }
        deferredPrompt = null;
        hideInstallBanner();
      });
    });

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.textContent = '×';
    dismissBtn.style.cssText = [
      'background:transparent', 'color:#00ff41',
      'border:0', 'font-size:22px', 'cursor:pointer',
      'padding:4px 8px', 'line-height:1'
    ].join(';');
    dismissBtn.addEventListener('click', function () {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 14 * 86400 * 1000)); } catch (_) {}
      hideInstallBanner();
    });

    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(installBtn);
    banner.appendChild(dismissBtn);

    if (!document.getElementById('pwaInstallStyles')) {
      var st = document.createElement('style');
      st.id = 'pwaInstallStyles';
      st.textContent = '@keyframes pwaSlideUp{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(banner);
  }

  function hideInstallBanner() {
    var b = document.getElementById('pwaInstallBanner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  // ─── 3. Update banner ────────────────────────────────────────
  function showUpdateBanner(reg) {
    if (document.getElementById('pwaUpdateBanner')) return;

    var banner = document.createElement('div');
    banner.id = 'pwaUpdateBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px',
      'background:#0a0a0a', 'color:#00ff41',
      'border:1px solid #00ff41', 'border-radius:12px',
      'padding:12px 16px', 'font-family:Inter,system-ui,sans-serif',
      'font-size:13px', 'z-index:99999',
      'box-shadow:0 8px 28px rgba(0,255,65,0.25)',
      'display:flex', 'gap:12px', 'align-items:center',
      'max-width:340px'
    ].join(';');

    var msg = document.createElement('div');
    msg.style.cssText = 'flex:1';
    var ml1 = document.createElement('strong');
    ml1.style.cssText = 'display:block;color:#fff';
    ml1.textContent = 'New version available';
    var ml2 = document.createElement('span');
    ml2.style.cssText = 'display:block;font-size:12px;opacity:.85';
    ml2.textContent = 'Reload to get the latest features.';
    msg.appendChild(ml1); msg.appendChild(ml2);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload';
    btn.style.cssText = [
      'background:#00ff41', 'color:#000', 'border:0',
      'border-radius:8px', 'padding:8px 12px',
      'font-weight:700', 'cursor:pointer'
    ].join(';');
    btn.addEventListener('click', function () {
      if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    });

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.style.cssText = 'background:transparent;color:#00ff41;border:0;font-size:20px;cursor:pointer';
    dismiss.addEventListener('click', function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    });

    banner.appendChild(msg); banner.appendChild(btn); banner.appendChild(dismiss);
    document.body.appendChild(banner);
  }

  // ─── kickoff ─────────────────────────────────────────────────
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
})();
