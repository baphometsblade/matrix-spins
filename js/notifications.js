/**
 * Matrix Spins Casino — Notification Center & Toast System
 *
 * Features:
 *   • Bell icon with unread badge (injects into .header-right or .actions)
 *   • Dropdown notification panel
 *   • Toast notifications for real-time events
 *   • Auto-generates demo notifications
 *   • Persists read state in sessionStorage
 *
 * Usage:
 *   <link rel="stylesheet" href="css/notifications.css">
 *   <script src="js/notifications.js" defer></script>
 *   <!-- Auto-injects into page -->
 */
(function () {
  'use strict';

  // ── Demo Notifications ─────────────────────────────────────
  const DEMO_NOTIFICATIONS = [
    { id: 'n1', type: 'promo',  icon: '🎁', title: 'New Promotion Available', body: '50% Reload Bonus — deposit $50+ and get up to $250 matched. Use code RELOAD50.', time: Date.now() - 300000, read: false },
    { id: 'n2', type: 'vip',    icon: '⭐', title: 'VIP Progress Update', body: 'You\'re 1,200 XP away from Silver tier! Keep spinning to unlock weekly bonuses.', time: Date.now() - 1800000, read: false },
    { id: 'n3', type: 'win',    icon: '🏆', title: 'Jackpot Winner Nearby!', body: 'Alex T. just hit the Mini jackpot for $52.30 on Dragon Pearl Deluxe.', time: Date.now() - 3600000, read: false },
    { id: 'n4', type: 'system', icon: '🔔', title: 'Weekend Tournament Starts Friday', body: '$25,000 prize pool — all bets count toward the leaderboard. Top 50 win prizes.', time: Date.now() - 7200000, read: true },
    { id: 'n5', type: 'promo',  icon: '💰', title: 'Weekly Cashback Credited', body: '$23.40 cashback has been added to your balance from last week\'s play.', time: Date.now() - 86400000, read: true },
    { id: 'n6', type: 'system', icon: '🛡️', title: 'Security Reminder', body: 'Enable stronger passwords and review your responsible gambling limits regularly.', time: Date.now() - 172800000, read: true },
  ];

  // ── State ──────────────────────────────────────────────────
  const state = {
    notifications: [...DEMO_NOTIFICATIONS],
    open: false,
    toastQueue: [],
  };

  // Load read state
  try {
    const readIds = JSON.parse(sessionStorage.getItem('ms_notif_read') || '[]');
    state.notifications.forEach(n => { if (readIds.includes(n.id)) n.read = true; });
  } catch {}

  function saveReadState() {
    const readIds = state.notifications.filter(n => n.read).map(n => n.id);
    try { sessionStorage.setItem('ms_notif_read', JSON.stringify(readIds)); } catch {}
  }

  function unreadCount() {
    return state.notifications.filter(n => !n.read).length;
  }

  // ── Time Formatting ────────────────────────────────────────
  function timeAgo(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }

  // ── Inject DOM ─────────────────────────────────────────────
  function init() {
    // Find header container
    const headerRight = document.querySelector('.header-right') || document.querySelector('.topbar .actions');
    if (!headerRight) return; // No header found

    // Create bell button
    const bellWrap = document.createElement('div');
    bellWrap.style.cssText = 'position:relative;display:inline-flex;';
    bellWrap.innerHTML = `
      <button class="notif-bell" id="notifBell" aria-label="Notifications">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <div class="notif-badge ${unreadCount() > 0 ? '' : 'hidden'}" id="notifBadge">${unreadCount()}</div>
      </button>
      <div class="notif-panel" id="notifPanel">
        <div class="notif-panel-header">
          <h3>Notifications</h3>
          <button class="mark-read-btn" id="markAllRead">Mark all read</button>
        </div>
        <div class="notif-list" id="notifList"></div>
      </div>
    `;

    // Insert bell before the first button/link in header
    const firstBtn = headerRight.querySelector('button, a, .btn');
    if (firstBtn) {
      headerRight.insertBefore(bellWrap, firstBtn);
    } else {
      headerRight.prepend(bellWrap);
    }

    // Toast container
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toastContainer';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    renderNotifications();

    // ── Event Listeners ──────────────────────────────────────
    document.getElementById('notifBell').addEventListener('click', (e) => {
      e.stopPropagation();
      state.open = !state.open;
      document.getElementById('notifPanel').classList.toggle('open', state.open);
    });

    document.getElementById('markAllRead').addEventListener('click', () => {
      state.notifications.forEach(n => n.read = true);
      saveReadState();
      updateBadge();
      renderNotifications();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (state.open && !bellWrap.contains(e.target)) {
        state.open = false;
        document.getElementById('notifPanel').classList.remove('open');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) {
        state.open = false;
        document.getElementById('notifPanel').classList.remove('open');
      }
    });

    // Auto-generate new notifications periodically
    scheduleNewNotification();
  }

  function renderNotifications() {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (state.notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }

    list.innerHTML = state.notifications
      .sort((a, b) => b.time - a.time)
      .map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notif-icon ${n.type}">${n.icon}</div>
          <div class="notif-content">
            <div class="title">${n.title}</div>
            <div class="body">${n.body}</div>
            <div class="time">${timeAgo(n.time)}</div>
          </div>
        </div>
      `).join('');

    // Mark as read on click
    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const notif = state.notifications.find(n => n.id === item.dataset.id);
        if (notif) {
          notif.read = true;
          saveReadState();
          item.classList.remove('unread');
          updateBadge();
        }
      });
    });
  }

  function updateBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const count = unreadCount();
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  // ── Toast System ───────────────────────────────────────────
  function showToast(notification) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <div class="icon">${notification.icon}</div>
      <div class="text">
        <div class="title">${notification.title}</div>
        <div class="body">${notification.body}</div>
      </div>
      <button class="dismiss" aria-label="Dismiss">&times;</button>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    // Dismiss button
    toast.querySelector('.dismiss').addEventListener('click', () => dismissToast(toast));

    // Auto-dismiss after 6s
    setTimeout(() => dismissToast(toast), 6000);
  }

  function dismissToast(toast) {
    if (!toast || toast.classList.contains('exiting')) return;
    toast.classList.add('exiting');
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }

  // ── Auto-generate Notifications ────────────────────────────
  const AUTO_NOTIFICATIONS = [
    { type: 'win', icon: '🎰', title: 'Big Win on Neon Blitz!', body: 'Someone just hit a 45x multiplier. Try your luck!' },
    { type: 'promo', icon: '⏰', title: 'Limited Time Offer', body: 'Double XP weekend is live! All spins earn 2x VIP points.' },
    { type: 'win', icon: '💎', title: 'Jackpot Pool Growing', body: 'The Mega jackpot just passed $100K. Will you be the winner?' },
    { type: 'system', icon: '🎮', title: 'New Game Added', body: 'Crystal Caves from Shadow Works is now live. 96.8% RTP with cascading reels.' },
    { type: 'vip', icon: '🌟', title: 'Daily Login Streak', body: 'Log in tomorrow to keep your 3-day streak and earn bonus XP.' },
  ];

  let autoIdx = 0;

  function scheduleNewNotification() {
    const delay = (60 + Math.random() * 120) * 1000; // 1-3 minutes
    setTimeout(() => {
      const template = AUTO_NOTIFICATIONS[autoIdx % AUTO_NOTIFICATIONS.length];
      autoIdx++;

      const notif = {
        id: 'auto-' + Date.now(),
        ...template,
        time: Date.now(),
        read: false,
      };

      state.notifications.unshift(notif);
      if (state.notifications.length > 20) state.notifications.pop();

      updateBadge();
      renderNotifications();
      showToast(notif);

      scheduleNewNotification();
    }, delay);
  }

  // ── Public API ─────────────────────────────────────────────
  window.MatrixNotifications = {
    /** Push a custom notification */
    push(notification) {
      const n = {
        id: 'custom-' + Date.now(),
        type: notification.type || 'system',
        icon: notification.icon || '🔔',
        title: notification.title || 'Notification',
        body: notification.body || '',
        time: Date.now(),
        read: false,
      };
      state.notifications.unshift(n);
      updateBadge();
      renderNotifications();
      if (notification.toast !== false) showToast(n);
    },

    /** Show a toast only (no persistence) */
    toast(icon, title, body) {
      showToast({ icon, title, body });
    },
  };

  // ── Auto-init ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to ensure header is rendered
    setTimeout(init, 100);
  }
})();
