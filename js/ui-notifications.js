(function() {
  'use strict';

  var _bellEl = null;
  var _badgeEl = null;
  var _panelEl = null;
  var _panelOpen = false;
  var _pollTimer = null;
  var _stylesInjected = false;
  var _unreadCount = 0;

  function getToken() {
    var key = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
    return localStorage.getItem(key) || '';
  }

  function typeIcon(type) {
    var map = {
      money: '💰', rakeback: '💰', milestone: '🎯', luckyhours: '🌟',
      bonus: '🎁', achievement: '🏆', freespins: '🎰', scratchcard: '🎴',
      mystery: '🎲', streak: '🔥', subscription: '💳', info: '🔔'
    };
    return map[type] || '🔔';
  }

  function timeAgo(dateStr) {
    var diff = Date.now() - new Date(dateStr).getTime();
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'notifStyles';
    s.textContent = [
      '#notifBellWrap{position:relative;display:inline-flex;align-items:center;vertical-align:middle}',
      '#notifBell{background:none;border:none;cursor:pointer;font-size:18px;padding:4px 8px;',
      'color:rgba(255,255,255,.75);transition:color .2s;line-height:1}',
      '#notifBell:hover{color:#fff}',
      '#notifBadge{position:absolute;top:0;right:2px;background:#ef4444;color:#fff;',
      'font-size:10px;font-weight:800;border-radius:999px;min-width:16px;height:16px;',
      'line-height:16px;text-align:center;padding:0 3px;display:none;pointer-events:none}',
      '#notifBadge.visible{display:block}',
      '#notifPanel{display:none;position:fixed;top:64px;right:12px;width:340px;max-width:95vw;',
      'background:#0d0d1a;border:1px solid rgba(255,255,255,.12);border-radius:14px;',
      'box-shadow:0 8px 40px rgba(0,0,0,.7);z-index:20000;overflow:hidden}',
      '#notifPanel.active{display:block}',
      '.np-header{display:flex;align-items:center;justify-content:space-between;',
      'padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08)}',
      '.np-header-title{font-size:14px;font-weight:800;color:#fff}',
      '.np-read-all{background:none;border:none;color:rgba(255,255,255,.4);',
      'font-size:12px;cursor:pointer;padding:0}',
      '.np-read-all:hover{color:rgba(255,255,255,.7)}',
      '.np-list{max-height:380px;overflow-y:auto}',
      '.np-item{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;',
      'border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:background .15s}',
      '.np-item:hover{background:rgba(255,255,255,.04)}',
      '.np-item.unread{background:rgba(255,255,255,.03)}',
      '.np-icon{font-size:20px;flex-shrink:0;margin-top:1px}',
      '.np-content{flex:1;min-width:0}',
      '.np-title{font-size:13px;font-weight:700;color:rgba(255,255,255,.75);',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.np-item.unread .np-title{color:#fff}',
      '.np-body{font-size:12px;color:rgba(255,255,255,.4);margin-top:2px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.np-time{font-size:10px;color:rgba(255,255,255,.25);margin-top:3px}',
      '.np-arrow{flex-shrink:0;align-self:center;font-size:16px;color:rgba(255,255,255,.2)}',
      '.np-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;',
      'flex-shrink:0;align-self:center;margin-left:4px}',
      '.np-empty{padding:28px 16px;text-align:center;color:rgba(255,255,255,.3);font-size:13px}',
    ].join('');
    document.head.appendChild(s);
  }

  function buildBell() {
    if (_bellEl) return;
    var navArea = document.querySelector('.nav-buttons')
      || document.querySelector('.casino-nav')
      || document.querySelector('nav');
    if (!navArea) return;
    var wrap = document.createElement('span');
    wrap.id = 'notifBellWrap';
    wrap.innerHTML = '<button id="notifBell" title="Notifications">🔔</button>'
      + '<span id="notifBadge"></span>';
    navArea.appendChild(wrap);
    _bellEl = document.getElementById('notifBell');
    _badgeEl = document.getElementById('notifBadge');
    _bellEl.addEventListener('click', togglePanel);
  }

  function buildPanel() {
    if (_panelEl) return;
    _panelEl = document.createElement('div');
    _panelEl.id = 'notifPanel';
    _panelEl.innerHTML = [
      '<div class="np-header">',
      '<span class="np-header-title">🔔 Notifications</span>',
      '<button class="np-read-all" id="npReadAll">Mark all read</button>',
      '</div>',
      '<div class="np-list" id="npList">',
      '<div class="np-empty">No notifications yet</div>',
      '</div>',
    ].join('');
    document.body.appendChild(_panelEl);
    document.getElementById('npReadAll').onclick = markAllRead;
    document.addEventListener('click', function(e) {
      if (!_panelOpen) return;
      if (_panelEl && _panelEl.contains(e.target)) return;
      if (_bellEl && _bellEl.contains(e.target)) return;
      closePanel();
    });
  }

  function togglePanel() {
    if (_panelOpen) closePanel(); else openPanel();
  }

  function openPanel() {
    if (!_panelEl) return;
    _panelOpen = true;
    _panelEl.classList.add('active');
    pollNotifications();
  }

  function closePanel() {
    if (!_panelEl) return;
    _panelOpen = false;
    _panelEl.classList.remove('active');
  }

  function updateBadge(count) {
    _unreadCount = count;
    if (!_badgeEl) return;
    if (count > 0) {
      _badgeEl.textContent = count > 9 ? '9+' : String(count);
      _badgeEl.classList.add('visible');
    } else {
      _badgeEl.classList.remove('visible');
    }
  }

  function markAllRead() {
    var token = getToken();
    if (!token) return;
    fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function() {
      updateBadge(0);
      if (!_panelEl) return;
      _panelEl.querySelectorAll('.np-item').forEach(function(el) {
        el.classList.remove('unread');
      });
      _panelEl.querySelectorAll('.np-dot').forEach(function(el) {
        el.remove();
      });
    }).catch(function() {});
  }

  function markRead(id) {
    var token = getToken();
    if (!token) return;
    fetch('/api/notifications/read/' + id, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).catch(function() {});
  }

  function renderNotifications(notifications) {
    var listEl = document.getElementById('npList');
    if (!listEl) return;
    if (!notifications || !notifications.length) {
      listEl.innerHTML = '<div class="np-empty">You\'re all caught up! 🎉</div>';
      return;
    }
    // XSS-safe rebuild: createElement + textContent. Whitelist of safe
    // link_action handlers — the server cannot name arbitrary globals like
    // withdrawAll, closeAccount, initiateDeposit, etc. n.id is no longer
    // interpolated into a data-id attribute value where it could break out.
    var ALLOWED_ACTIONS = {
      open_wallet:  function() { if (typeof showWalletModal === 'function') showWalletModal(); },
      open_promo:   function() { if (typeof openPromoCode === 'function') openPromoCode(); },
      open_profile: function() { if (typeof showProfileModal === 'function') showProfileModal(); },
      open_vip:     function() { if (typeof showVipModal === 'function') showVipModal(); },
      open_lobby:   function() { if (typeof showLobby === 'function') showLobby(); },
      open_daily:   function() { if (typeof openDailyBonus === 'function') openDailyBonus(); },
      open_wheel:   function() { if (typeof openBonusWheel === 'function') openBonusWheel(); }
    };
    listEl.replaceChildren();
    notifications.forEach(function(n) {
      var item = document.createElement('div');
      item.className = 'np-item' + (n.read ? '' : ' unread');
      // Store the id as a textual data-id, but also keep a JS-side reference
      // so we never re-read it from the attribute (defence in depth).
      var safeId = String(n.id == null ? '' : n.id);
      item.setAttribute('data-id', safeId);
      var iconSpan = document.createElement('span');
      iconSpan.className = 'np-icon';
      iconSpan.textContent = String(typeIcon(n.type) || '');
      item.appendChild(iconSpan);
      var content = document.createElement('div');
      content.className = 'np-content';
      var titleDiv = document.createElement('div');
      titleDiv.className = 'np-title';
      titleDiv.textContent = String(n.title == null ? '' : n.title);
      var bodyDiv = document.createElement('div');
      bodyDiv.className = 'np-body';
      bodyDiv.textContent = String(n.body == null ? '' : n.body);
      var timeDiv = document.createElement('div');
      timeDiv.className = 'np-time';
      timeDiv.textContent = String(timeAgo(n.created_at) || '');
      content.appendChild(titleDiv);
      content.appendChild(bodyDiv);
      content.appendChild(timeDiv);
      item.appendChild(content);
      if (!n.read) {
        var dotSpan = document.createElement('span');
        dotSpan.className = 'np-dot';
        item.appendChild(dotSpan);
      }
      var actionFn = null;
      if (n.link_action && Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, n.link_action)) {
        actionFn = ALLOWED_ACTIONS[n.link_action];
        var arrowSpan = document.createElement('span');
        arrowSpan.className = 'np-arrow';
        arrowSpan.textContent = '\u203A';
        item.appendChild(arrowSpan);
      }
      item.addEventListener('click', function() {
        if (safeId) markRead(safeId);
        item.classList.remove('unread');
        var d = item.querySelector('.np-dot');
        if (d) d.remove();
        if (actionFn) {
          closePanel();
          try { actionFn(); } catch (_e) { /* swallow handler errors */ }
        }
      });
      listEl.appendChild(item);
    });
  }

  function pollNotifications() {
    var token = getToken();
    if (!token) return;
    fetch('/api/notifications', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        updateBadge(d.unreadCount || 0);
        if (_panelOpen) renderNotifications(d.notifications || []);
      })
      .catch(function() {});
  }

  function init() {
    injectStyles();
    buildBell();
    buildPanel();
    setTimeout(function() {
      pollNotifications();
      _pollTimer = setInterval(pollNotifications, 30000);
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.openNotificationsPanel = openPanel;
  window.closeNotificationsPanel = closePanel;
  window.pollNotifications = pollNotifications;

}());
