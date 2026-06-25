/**
 * Matrix Spins — Unified UX Layer
 *
 * Auto-injects on every page that loads it:
 *   • Mobile bottom nav (Home / Games / Wallet / Profile / Menu)
 *   • Hamburger drawer with full nav + balance + logout
 *   • Sound toggle button (uses existing sound-manager.js when available)
 *   • Active-link highlighting based on current pathname
 *
 * Exposes window.MSUx with:
 *   .skeleton(host, opts)   — render N shimmer rows
 *   .empty(host, opts)      — render empty state with optional CTA
 *   .error(host, opts)      — render error with retry button
 *   .toast(msg, opts)       — top-right (mobile: bottom) toast
 *   .clear(host)            — clear children
 *   .ready(fn)              — DOM-ready helper (no jQuery)
 *
 * No innerHTML anywhere — every node is built with createElement + textContent.
 * Designed to be idempotent — safe to load on every page, safe to call multiple times.
 */
(function () {
  'use strict';

  if (window.MSUx && window.MSUx._loaded) return; // singleton

  // ─── DOM helpers (textContent only, no innerHTML) ──────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach(k => {
        if (k == null) return;
        node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
      });
    }
    return node;
  }
  function clear(host) { while (host && host.firstChild) host.removeChild(host.firstChild); }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // ─── Nav definition (single source of truth) ───────────────
  const BOTTOM_NAV = [
    { href: 'index.html',        icon: '⌂', label: 'Home',    action: null },
    { href: 'index.html#games',  icon: '🎰', label: 'Games',   action: null },
    { href: 'wallet.html',       icon: '💳', label: 'Wallet',  action: null },
    { href: 'account.html',      icon: '👤', label: 'Profile', action: null },
    { href: '#',                 icon: '☰', label: 'Menu',    action: 'open-drawer' }
  ];

  const DRAWER_NAV = [
    { section: 'Play' },
    { href: 'index.html',        icon: '⌂', label: 'Home / Lobby' },
    { href: 'index.html#games',  icon: '🎰', label: 'All Games' },
    { href: 'history.html',      icon: '📊', label: 'History & Stats' },
    { href: 'tournaments.html',  icon: '🏆', label: 'Tournaments' },
    { href: 'leaderboard.html',  icon: '🥇', label: 'Leaderboard' },
    { href: 'battle-pass.html',  icon: '⚔️', label: 'Battle Pass' },
    { href: 'spin-wheel.html',   icon: '🎡', label: 'Daily Wheel' },
    { section: 'Account' },
    { href: 'wallet.html',       icon: '💳', label: 'Wallet & Deposits' },
    { href: 'account.html',      icon: '👤', label: 'My Account' },
    { href: 'vip.html',          icon: '⭐', label: 'VIP / Loyalty' },
    { href: 'achievements.html', icon: '🏅', label: 'Achievements' },
    { href: 'referral.html',     icon: '🤝', label: 'Refer a Friend' },
    { section: 'Help' },
    { href: 'promotions.html',   icon: '🎁', label: 'Promotions' },
    { href: 'faq.html',          icon: '?',  label: 'FAQ' },
    { href: 'responsible-gambling.html', icon: '🛡', label: 'Responsible Gaming' },
    { href: 'terms.html',        icon: '📜', label: 'Terms' }
  ];

  // ─── Path matching ──────────────────────────────────────────
  function currentPath() {
    let p = window.location.pathname;
    if (p === '' || p === '/') p = '/index.html';
    return p.toLowerCase();
  }
  function isActive(href) {
    if (!href || href === '#') return false;
    const p = currentPath();
    const hrefPath = '/' + href.split('#')[0].split('?')[0].toLowerCase().replace(/^\.\//, '');
    return p === hrefPath || (hrefPath !== '/index.html' && p.endsWith(hrefPath));
  }

  // ─── Sound toggle (uses sound-manager.js if present) ───────
  function getSoundState() {
    try { return localStorage.getItem('ms_sound') === 'on'; } catch (_) { return false; }
  }
  function setSoundState(on) {
    try { localStorage.setItem('ms_sound', on ? 'on' : 'off'); } catch (_) {}
    try {
      const sm = window.SoundManager || window.soundManager;
      if (sm) {
        if (typeof sm.setMuted === 'function') sm.setMuted(!on);
        else if (typeof sm.mute === 'function' && typeof sm.unmute === 'function') {
          on ? sm.unmute() : sm.mute();
        }
        if (typeof sm.setEnabled === 'function') sm.setEnabled(on);
      }
    } catch (_) {}
  }
  function buildSoundToggle() {
    const btn = el('button', {
      class: 'ms-sound-toggle ms-press',
      type: 'button',
      'aria-label': 'Toggle sound',
      title: 'Toggle sound',
      'data-state': getSoundState() ? 'on' : 'off',
      'data-keep-mobile': 'true'
    });
    btn.appendChild(el('span', { class: 'ms-sound-icon', 'aria-hidden': 'true', text: '🔊' }));
    btn.appendChild(el('span', { class: 'ms-sound-slash', 'aria-hidden': 'true' }));
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-state') !== 'on';
      btn.setAttribute('data-state', next ? 'on' : 'off');
      setSoundState(next);
      window.MSUx.toast({
        title: next ? 'Sound on' : 'Sound muted',
        msg: next ? 'Audio is now enabled.' : 'Audio has been muted.',
        kind: 'info',
        ttl: 1800
      });
    });
    setSoundState(getSoundState()); // apply initial mute state to sound manager
    return btn;
  }

  // ─── Hamburger button ──────────────────────────────────────
  function buildHamburger(onClick) {
    const btn = el('button', {
      class: 'ms-hamburger ms-press',
      type: 'button',
      'aria-label': 'Open menu',
      'aria-expanded': 'false',
      'data-keep-mobile': 'true'
    });
    btn.appendChild(el('span'));
    btn.appendChild(el('span'));
    btn.appendChild(el('span'));
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ─── Drawer ────────────────────────────────────────────────
  let _drawerOpen = false;
  let _drawerEl = null;
  let _backdropEl = null;
  let _hamburgerEl = null;

  function ensureDrawer() {
    if (_drawerEl) return _drawerEl;

    _backdropEl = el('div', { class: 'ms-drawer-backdrop', 'aria-hidden': 'true' });
    _backdropEl.addEventListener('click', closeDrawer);

    _drawerEl = el('aside', { class: 'ms-drawer', 'aria-label': 'Main menu', 'aria-hidden': 'true' });

    const header = el('div', { class: 'ms-drawer-header' });
    header.appendChild(el('a', { class: 'ms-drawer-brand', href: 'index.html', text: 'Matrix Spins' }));
    const closeBtn = el('button', { class: 'ms-drawer-close', 'aria-label': 'Close menu', text: '×' });
    closeBtn.addEventListener('click', closeDrawer);
    header.appendChild(closeBtn);
    _drawerEl.appendChild(header);

    // Balance row
    const balanceRow = el('div', { class: 'ms-drawer-balance' });
    const balLeft = el('div');
    balLeft.appendChild(el('div', { class: 'ms-bal-label', text: 'Balance' }));
    balLeft.appendChild(el('div', { class: 'ms-bal-amount', id: 'ms-drawer-balance-amount', text: '—' }));
    balanceRow.appendChild(balLeft);
    const depositBtn = el('a', {
      class: 'btn btn-inline ms-press',
      href: 'wallet.html',
      style: 'background:linear-gradient(135deg,#00ff41,#00cc34);color:#001a08;font-weight:800;text-decoration:none;padding:0.55rem 1rem;border-radius:999px;font-size:0.85rem;',
      text: 'Deposit'
    });
    balanceRow.appendChild(depositBtn);
    _drawerEl.appendChild(balanceRow);

    // Nav list
    const list = el('ul', { class: 'ms-drawer-list' });
    DRAWER_NAV.forEach(item => {
      if (item.section) {
        list.appendChild(el('li', { class: 'ms-drawer-section-title', text: item.section }));
        return;
      }
      const a = el('a', {
        href: item.href,
        class: isActive(item.href) ? 'active' : ''
      });
      a.appendChild(el('span', { class: 'ms-icon', 'aria-hidden': 'true', text: item.icon }));
      a.appendChild(el('span', { text: item.label }));
      list.appendChild(el('li', null, a));
    });
    _drawerEl.appendChild(list);

    // Footer with logout
    const footer = el('div', { class: 'ms-drawer-footer' });
    const logoutBtn = el('button', { class: 'ms-logout ms-press', text: 'Sign out' });
    logoutBtn.addEventListener('click', async () => {
      try {
        const api = window.MatrixSpinsAPI || window.RoyalSlotsAPI;
        if (api && typeof api.logout === 'function') await api.logout();
      } catch (_) {}
      window.location.href = 'index.html';
    });
    footer.appendChild(logoutBtn);
    _drawerEl.appendChild(footer);

    document.body.appendChild(_backdropEl);
    document.body.appendChild(_drawerEl);
    return _drawerEl;
  }

  function openDrawer() {
    ensureDrawer();
    _drawerEl.classList.add('open');
    _backdropEl.classList.add('open');
    _drawerEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (_hamburgerEl) _hamburgerEl.setAttribute('aria-expanded', 'true');
    _drawerOpen = true;
    refreshDrawerBalance();
  }
  function closeDrawer() {
    if (!_drawerEl) return;
    _drawerEl.classList.remove('open');
    _backdropEl.classList.remove('open');
    _drawerEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (_hamburgerEl) _hamburgerEl.setAttribute('aria-expanded', 'false');
    _drawerOpen = false;
  }
  function toggleDrawer() { _drawerOpen ? closeDrawer() : openDrawer(); }

  async function refreshDrawerBalance() {
    const target = $('#ms-drawer-balance-amount');
    if (!target) return;
    try {
      const api = window.MatrixSpinsAPI || window.RoyalSlotsAPI;
      if (!api || !api.accessToken) { target.textContent = 'Sign in'; return; }
      const b = await api.getBalance();
      target.textContent = api.formatCents(b.availableCents || 0);
    } catch (_) {
      target.textContent = '—';
    }
  }

  // ─── Bottom nav ─────────────────────────────────────────────
  function buildBottomNav() {
    if ($('.ms-bottom-nav')) return; // already present
    // Skip if the page already ships its own bottom mobile nav (e.g. index.html)
    const existing = document.querySelector('nav.mobile-nav, .bottom-nav, .mobile-bottom-nav');
    if (existing && getComputedStyle(existing).position === 'fixed') {
      // Use existing nav: just remove bottom padding so we don't double-pad
      document.documentElement.classList.add('ms-existing-bottom-nav');
      return;
    }

    const nav = el('nav', { class: 'ms-bottom-nav', 'aria-label': 'Primary' });
    const ul = el('ul', { class: 'ms-bottom-nav-list' });

    BOTTOM_NAV.forEach(item => {
      const a = el('a', {
        href: item.href,
        class: isActive(item.href) ? 'active' : '',
        'data-action': item.action || ''
      });
      a.appendChild(el('span', { class: 'ms-icon', 'aria-hidden': 'true', text: item.icon }));
      a.appendChild(el('span', { class: 'ms-label', text: item.label }));
      if (item.action === 'open-drawer') {
        a.addEventListener('click', (e) => { e.preventDefault(); openDrawer(); });
      }
      ul.appendChild(el('li', null, a));
    });

    nav.appendChild(ul);
    document.body.appendChild(nav);
  }

  // ─── Top-bar enhancement ───────────────────────────────────
  function enhanceTopbar() {
    const topbar = $('.topbar') || $('header.topbar') || $('nav.topbar')
                || $('header.header') || $('.site-header') || $('header');
    if (!topbar) return;

    // Find the existing actions container, or pick the right-most flex child to inject into.
    let actions = topbar.querySelector('.actions')
               || topbar.querySelector('.topbar-actions')
               || topbar.querySelector('.header-actions')
               || topbar.querySelector('.header-right')
               || topbar.querySelector('.nav-actions')
               || topbar.querySelector('.user-actions');
    if (!actions) {
      // Create a hosting div appended to the topbar so our buttons are reachable
      actions = el('div', { class: 'actions ms-injected-actions', style: 'display:flex;gap:0.5rem;align-items:center;margin-left:auto;' });
      topbar.appendChild(actions);
    }

    if (!actions.querySelector('.ms-sound-toggle')) {
      actions.appendChild(buildSoundToggle());
    }

    if (!actions.querySelector('.ms-hamburger')) {
      _hamburgerEl = buildHamburger(toggleDrawer);
      actions.appendChild(_hamburgerEl);
    }
  }

  // ─── Active-link sync ──────────────────────────────────────
  function syncActiveLinks() {
    $$('.ms-bottom-nav-list a, .ms-drawer-list a').forEach(a => {
      const href = a.getAttribute('href');
      a.classList.toggle('active', isActive(href));
    });
  }

  // ─── Skeleton / empty / error renderers ────────────────────
  function renderSkeleton(host, opts) {
    if (typeof host === 'string') host = $(host);
    if (!host) return;
    opts = opts || {};
    const rows = opts.rows || 4;
    const variant = opts.variant || 'lines';
    clear(host);
    if (variant === 'cards') {
      const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.75rem;' });
      for (let i = 0; i < rows; i++) grid.appendChild(el('div', { class: 'ms-skeleton card' }));
      host.appendChild(grid);
    } else {
      for (let i = 0; i < rows; i++) {
        host.appendChild(el('div', { class: 'ms-skeleton line' + (i === 0 ? ' line-lg' : '') }));
      }
    }
  }

  function renderEmpty(host, opts) {
    if (typeof host === 'string') host = $(host);
    if (!host) return;
    opts = opts || {};
    clear(host);
    const wrap = el('div', { class: 'ms-empty-state' });
    wrap.appendChild(el('div', { class: 'ms-empty-icon', text: opts.icon || '🎰' }));
    wrap.appendChild(el('h3', { class: 'ms-empty-title', text: opts.title || 'Nothing here yet' }));
    if (opts.msg) wrap.appendChild(el('p', { class: 'ms-empty-msg', text: opts.msg }));
    if (opts.cta) {
      const a = el('a', {
        class: 'ms-empty-cta ms-press',
        href: opts.cta.href || '#',
        text: opts.cta.label || 'Continue'
      });
      if (opts.cta.onClick) {
        a.addEventListener('click', (e) => { e.preventDefault(); opts.cta.onClick(); });
      }
      wrap.appendChild(a);
    }
    host.appendChild(wrap);
  }

  function renderError(host, opts) {
    if (typeof host === 'string') host = $(host);
    if (!host) return;
    opts = opts || {};
    clear(host);
    const wrap = el('div', { class: 'ms-error-state' });
    wrap.appendChild(el('div', { class: 'ms-error-icon', text: '⚠' }));
    wrap.appendChild(el('h3', { class: 'ms-error-title', text: opts.title || 'Something went wrong' }));
    wrap.appendChild(el('p', { class: 'ms-error-msg', text: opts.msg || 'We couldn\'t load this right now. Please try again.' }));
    if (opts.onRetry) {
      const btn = el('button', { class: 'ms-retry-btn ms-press', type: 'button', text: 'Try again' });
      btn.addEventListener('click', opts.onRetry);
      wrap.appendChild(btn);
    }
    host.appendChild(wrap);
  }

  // ─── Toast ──────────────────────────────────────────────────
  function ensureToastContainer() {
    let c = $('.ms-toast-container');
    if (!c) {
      c = el('div', { class: 'ms-toast-container', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(c);
    }
    return c;
  }
  function toast(opts) {
    if (typeof opts === 'string') opts = { msg: opts };
    opts = opts || {};
    const c = ensureToastContainer();
    const t = el('div', { class: 'ms-toast ' + (opts.kind || '') });
    if (opts.title) t.appendChild(el('div', { class: 'ms-toast-title', text: opts.title }));
    if (opts.msg) t.appendChild(el('div', { class: 'ms-toast-msg', text: opts.msg }));
    c.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 200ms, transform 200ms';
      t.style.opacity = '0';
      t.style.transform = 'translateX(40px)';
      setTimeout(() => t.remove(), 240);
    }, opts.ttl || 3200);
  }

  // ─── Boot ───────────────────────────────────────────────────
  function init() {
    if (document.body.classList.contains('ms-no-unified-ux')) return;
    document.documentElement.classList.add('ms-ux-ready');
    document.body.classList.add('ms-page-fade');
    enhanceTopbar();
    buildBottomNav();
    syncActiveLinks();
    window.addEventListener('hashchange', syncActiveLinks);
    window.addEventListener('popstate', syncActiveLinks);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _drawerOpen) closeDrawer();
    });
  }

  ready(init);

  // ─── Public API ────────────────────────────────────────────
  window.MSUx = {
    _loaded: true,
    skeleton: renderSkeleton,
    empty: renderEmpty,
    error: renderError,
    toast: toast,
    clear: clear,
    ready: ready,
    el: el,
    $: $,
    $$: $$,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    refreshBalance: refreshDrawerBalance,
    isActive: isActive
  };
})();
