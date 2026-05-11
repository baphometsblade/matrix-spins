/**
 * Matrix Spins Casino — Notification Bell + Toast System
 *
 * Pulls notifications from /api/notifications, renders a bell icon with
 * unread badge into the page header, and listens for real-time pushes
 * via socket.io. Falls back to polling when socket.io is unavailable.
 */
(function () {
  'use strict';

  function getToken() {
    try {
      const k = (typeof STORAGE_KEY_TOKEN !== 'undefined') ? STORAGE_KEY_TOKEN : 'casinoToken';
      return localStorage.getItem(k) || localStorage.getItem('casinoToken') || localStorage.getItem('token') || '';
    } catch { return ''; }
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data || {};
  }

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function svgEl(name, attrs) {
    const ns = 'http://www.w3.org/2000/svg';
    const e = document.createElementNS(ns, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function timeAgo(ts) {
    try {
      const t = new Date(ts).getTime();
      const d = (Date.now() - t) / 1000;
      if (d < 60) return 'just now';
      if (d < 3600) return Math.floor(d / 60) + 'm ago';
      if (d < 86400) return Math.floor(d / 3600) + 'h ago';
      return Math.floor(d / 86400) + 'd ago';
    } catch { return ''; }
  }

  const ICONS = {
    bonus: '🎁', deposit: '💰', withdrawal: '💸', level_up: '⬆️',
    daily_reward: '🎯', system: '🔔', win: '🏆', promo: '✨',
    vip: '⭐', support: '💬', info: '🔔',
  };

  const state = {
    notifications: [],
    open: false,
    isAuthed: !!getToken(),
    socket: null,
    pollTimer: null,
  };

  function unreadCount() {
    let n = 0;
    for (const x of state.notifications) if (!x.read) n++;
    return n;
  }

  function locateHeaderHost() {
    return document.querySelector('.header-right')
        || document.querySelector('.topbar .actions')
        || document.querySelector('header .actions')
        || document.querySelector('header nav')
        || document.querySelector('.topnav')
        || document.querySelector('header');
  }

  function buildBellSvg() {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', width: '22', height: '22' });
    svg.appendChild(svgEl('path', { d: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9' }));
    svg.appendChild(svgEl('path', { d: 'M13.73 21a2 2 0 01-3.46 0' }));
    return svg;
  }

  function buildBell(host) {
    if (document.getElementById('msnBell')) return;
    const wrap = el('div', 'msn-bell-wrap');

    const btn = el('button', 'msn-bell', { 'aria-label': 'Notifications', id: 'msnBell', type: 'button' });
    btn.appendChild(buildBellSvg());
    const badge = el('span', 'msn-badge', { id: 'msnBadge' });
    badge.hidden = true; badge.textContent = '0';
    btn.appendChild(badge);
    wrap.appendChild(btn);

    const panel = el('div', 'msn-panel', { id: 'msnPanel' });
    const phead = el('div', 'msn-panel-head');
    const h3 = el('h3'); h3.textContent = 'Notifications'; phead.appendChild(h3);
    const mall = el('button', 'msn-mark-all', { id: 'msnMarkAll', type: 'button' });
    mall.textContent = 'Mark all read'; phead.appendChild(mall);
    panel.appendChild(phead);
    const list = el('div', 'msn-list', { id: 'msnList' });
    panel.appendChild(list);
    wrap.appendChild(panel);

    const first = host.querySelector('button, a, .btn');
    if (first) host.insertBefore(wrap, first); else host.prepend(wrap);

    btn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => closePanel());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
    mall.addEventListener('click', markAllRead);

    if (!document.getElementById('msnToasts')) {
      const t = el('div', 'msn-toasts', { id: 'msnToasts' });
      document.body.appendChild(t);
    }
  }

  function togglePanel() {
    state.open = !state.open;
    const p = document.getElementById('msnPanel');
    if (!p) return;
    p.classList.toggle('open', state.open);
    if (state.open) renderList();
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    const p = document.getElementById('msnPanel');
    if (p) p.classList.remove('open');
  }

  function renderList() {
    const list = document.getElementById('msnList');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    if (!state.isAuthed) {
      const emp = el('div', 'msn-empty');
      const a = el('a', null, { href: 'login.html' }); a.textContent = 'Log in';
      emp.appendChild(a);
      emp.appendChild(document.createTextNode(' to see notifications.'));
      list.appendChild(emp);
      return;
    }
    if (!state.notifications.length) {
      const emp = el('div', 'msn-empty'); emp.textContent = 'No notifications yet'; list.appendChild(emp); return;
    }
    state.notifications
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .forEach(n => list.appendChild(buildItem(n)));
  }

  function buildItem(n) {
    const item = el('div', 'msn-item' + (n.read ? '' : ' unread'));
    item.dataset.id = String(n.id);

    const ic = el('div', 'msn-icon ' + (n.type || 'info'));
    ic.textContent = n.icon || ICONS[n.type] || '🔔';
    item.appendChild(ic);

    const c = el('div', 'msn-content');
    const t = el('div', 'msn-title'); t.textContent = n.title || 'Notification'; c.appendChild(t);
    const b = el('div', 'msn-body'); b.textContent = n.body || ''; c.appendChild(b);
    const tm = el('div', 'msn-time'); tm.textContent = timeAgo(n.created_at); c.appendChild(tm);
    item.appendChild(c);

    item.addEventListener('click', () => {
      if (!n.read) markRead(n);
      if (n.link_action) {
        if (n.link_action === 'support') {
          if (window.MatrixSupport && window.MatrixSupport.open) window.MatrixSupport.open();
        } else if (/^https?:\/\//i.test(n.link_action) || /\.html(\?|#|$)/.test(n.link_action) || n.link_action.startsWith('/')) {
          location.href = n.link_action;
        }
      }
    });
    return item;
  }

  function updateBadge() {
    const badge = document.getElementById('msnBadge');
    if (!badge) return;
    const c = unreadCount();
    if (c > 0) {
      badge.textContent = c > 99 ? '99+' : String(c);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  async function markRead(n) {
    n.read = 1;
    updateBadge();
    renderList();
    if (typeof n.id === 'number') {
      try { await api('/api/notifications/read/' + n.id, { method: 'POST' }); } catch {}
    }
  }

  async function markAllRead() {
    state.notifications.forEach(n => n.read = 1);
    updateBadge();
    renderList();
    try { await api('/api/notifications/read-all', { method: 'POST' }); } catch {}
  }

  async function load() {
    if (!state.isAuthed) { renderList(); updateBadge(); return; }
    try {
      const data = await api('/api/notifications');
      state.notifications = (data.notifications || []).map(n => Object.assign({}, n, { icon: ICONS[n.type] || '🔔' }));
      renderList();
      updateBadge();
    } catch (err) {
      if (err.status !== 401) console.warn('[notifications] load failed:', err.message);
    }
  }

  function pushNotification(n) {
    n = Object.assign({ icon: ICONS[n.type] || '🔔', read: 0, created_at: n.created_at || new Date().toISOString() }, n);
    if (state.notifications.find(x => x.id === n.id)) return;
    state.notifications.unshift(n);
    if (state.notifications.length > 30) state.notifications.length = 30;
    updateBadge();
    if (state.open) renderList();
  }

  function showToast(n) {
    const host = document.getElementById('msnToasts');
    if (!host) return;

    const t = el('div', 'msn-toast');
    const ic = el('div', 'msn-toast-icon'); ic.textContent = n.icon || ICONS[n.type] || '🔔'; t.appendChild(ic);
    const tx = el('div', 'msn-toast-text');
    const tt = el('div', 'msn-toast-title'); tt.textContent = n.title || 'Notification'; tx.appendChild(tt);
    const tb = el('div', 'msn-toast-body'); tb.textContent = n.body || ''; tx.appendChild(tb);
    t.appendChild(tx);
    const dx = el('button', 'msn-toast-close', { 'aria-label': 'Dismiss', type: 'button' });
    dx.textContent = '×';
    t.appendChild(dx);

    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));

    const dismiss = () => {
      if (t.classList.contains('hide')) return;
      t.classList.add('hide'); t.classList.remove('show');
      setTimeout(() => t.remove(), 320);
    };
    dx.addEventListener('click', dismiss);
    setTimeout(dismiss, 6500);

    if (n.link_action) {
      t.style.cursor = 'pointer';
      t.addEventListener('click', (e) => {
        if (e.target === dx) return;
        if (n.link_action === 'support') {
          if (window.MatrixSupport && window.MatrixSupport.open) window.MatrixSupport.open();
        } else if (/^https?:\/\//i.test(n.link_action) || /\.html(\?|#|$)/.test(n.link_action) || n.link_action.startsWith('/')) {
          location.href = n.link_action;
        }
      });
    }
  }

  function connectSocket() {
    if (!window.io || !state.isAuthed) return;
    try {
      const s = window.io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
      state.socket = s;
      s.on('notification:new', (n) => {
        pushNotification(n);
        if (n.toast !== false) showToast(n);
      });
      s.on('notification:broadcast', (n) => {
        showToast({ type: 'system', title: n.title, body: n.body, link_action: n.linkAction });
      });
    } catch {}
  }

  function ensureSocketIoLoaded(cb) {
    if (window.io) return cb();
    if (document.querySelector('script[data-msc-io], script[data-msn-io]')) {
      const wait = setInterval(() => { if (window.io) { clearInterval(wait); cb(); } }, 100);
      return;
    }
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js'; s.async = true; s.setAttribute('data-msn-io', '1');
    s.onload = cb;
    s.onerror = () => { startPolling(); };
    document.head.appendChild(s);
  }

  function startPolling() {
    if (state.pollTimer || !state.isAuthed) return;
    state.pollTimer = setInterval(load, 60000);
  }

  function init(retry) {
    const host = locateHeaderHost();
    if (!host) {
      if ((retry || 0) < 10) return setTimeout(() => init((retry || 0) + 1), 250);
      return;
    }
    buildBell(host);
    load();
    if (state.isAuthed) {
      ensureSocketIoLoaded(connectSocket);
      setInterval(load, 5 * 60 * 1000);
    }
  }

  window.MatrixNotifications = {
    push(n) {
      pushNotification(Object.assign({ id: 'local-' + Date.now(), type: 'info' }, n));
      if (n.toast !== false) showToast(n);
    },
    toast(icon, title, body, link) {
      showToast({ icon, title, body, link_action: link });
    },
    reload: load,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(0));
  } else {
    setTimeout(() => init(0), 50);
  }
})();
