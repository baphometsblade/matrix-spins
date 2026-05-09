/**
 * Matrix Spins Casino — Live Support Chat Widget
 *
 * Real-time, socket.io-powered chat between players and support agents.
 * Falls back to REST when socket.io is unavailable. Auto-injects on every
 * page that includes this script.
 */
(function () {
  'use strict';

  if (location.pathname.startsWith('/admin')) return;

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
    const res = await fetch(path, { ...opts, headers });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data || {};
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeFmt(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (sameDay) return hh + ':' + mm;
      return d.toLocaleDateString() + ' ' + hh + ':' + mm;
    } catch { return ''; }
  }

  const state = {
    open: false,
    conversationId: null,
    messages: [],
    canned: [],
    socket: null,
    isAuthed: !!getToken(),
    typingTimeout: null,
    agentTypingTimeout: null,
    unreadCount: 0,
  };

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function buildDom() {
    const root = el('div'); root.id = 'ms-support-chat';

    // FAB
    const fab = el('button', 'msc-fab');
    fab.id = 'msc-fab';
    fab.setAttribute('aria-label', 'Open support chat');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="msc-fab-badge" id="msc-fab-badge" hidden>0</span>';
    root.appendChild(fab);

    // Panel skeleton (static markup — no user data)
    const panel = el('div', 'msc-panel');
    panel.id = 'msc-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Support chat');
    panel.innerHTML = [
      '<header class="msc-header">',
      '  <div class="msc-title">',
      '    <div class="msc-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/></svg></div>',
      '    <div><div class="msc-name">Matrix Support</div><div class="msc-status"><span class="msc-dot"></span><span id="msc-status-text">Online · typically replies in minutes</span></div></div>',
      '  </div>',
      '  <button class="msc-close" id="msc-close" aria-label="Close">&times;</button>',
      '</header>',
      '<div class="msc-quick" id="msc-quick"></div>',
      '<div class="msc-thread" id="msc-thread" aria-live="polite"></div>',
      '<div class="msc-typing" id="msc-typing" hidden><span class="msc-typing-dot"></span><span class="msc-typing-dot"></span><span class="msc-typing-dot"></span><span class="msc-typing-label">Support is typing…</span></div>',
      '<form class="msc-input-form" id="msc-form">',
      '  <textarea class="msc-input" id="msc-input" placeholder="Type a message…" rows="1" maxlength="2000"></textarea>',
      '  <button class="msc-send" id="msc-send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
      '</form>',
      '<div class="msc-foot"><span id="msc-foot-text">Powered by Matrix Spins</span></div>',
    ].join('');
    root.appendChild(panel);

    document.body.appendChild(root);
    return root;
  }

  function renderMessages() {
    const thread = document.getElementById('msc-thread');
    if (!thread) return;
    while (thread.firstChild) thread.removeChild(thread.firstChild);
    if (!state.isAuthed) {
      const empty = el('div', 'msc-empty');
      const p1 = el('p'); p1.innerHTML = '<strong>Sign in to chat with support.</strong>'; empty.appendChild(p1);
      const p2 = el('p'); p2.innerHTML = 'Already have an account? <a href="login.html">Log in</a> · New here? <a href="signup.html">Create account</a>'; empty.appendChild(p2);
      const p3 = el('p', 'msc-empty-sub'); p3.innerHTML = 'For urgent issues email <a href="mailto:support@matrixspins.com">support@matrixspins.com</a>'; empty.appendChild(p3);
      thread.appendChild(empty);
      return;
    }
    if (!state.messages.length) {
      const e0 = el('div', 'msc-empty'); e0.textContent = 'Loading conversation…'; thread.appendChild(e0); return;
    }
    state.messages.forEach(m => thread.appendChild(buildMessage(m)));
    thread.scrollTop = thread.scrollHeight;
  }

  function buildMessage(m) {
    const row = el('div', m.sender_type === 'user' ? 'msc-msg user' : (m.sender_type === 'agent' ? 'msc-msg agent' : 'msc-msg system'));
    if (m._failed) row.classList.add('failed');
    if (m._pending) row.classList.add('pending');

    const head = el('div', 'msc-msg-head');
    const sender = el('span', 'msc-sender');
    sender.textContent = m.sender_type === 'user' ? 'You' : (m.sender_name || (m.sender_type === 'agent' ? 'Support Agent' : 'Matrix Spins'));
    head.appendChild(sender);
    const time = el('span', 'msc-time');
    time.textContent = timeFmt(m.created_at);
    head.appendChild(time);
    row.appendChild(head);

    const bubble = el('div', 'msc-bubble');
    bubble.textContent = m.body;  // textContent: safe by construction
    row.appendChild(bubble);

    if (m.sender_type === 'user') {
      const meta = el('div', 'msc-meta');
      const r = el('span', 'msc-read');
      r.textContent = m._failed ? '! failed' : (m._pending ? '…' : (m.read_by_agent ? '✓✓' : '✓'));
      r.title = m._failed ? 'Failed to send' : (m._pending ? 'Sending' : (m.read_by_agent ? 'Read by agent' : 'Sent'));
      meta.appendChild(r);
      row.appendChild(meta);
    }
    return row;
  }

  function renderQuick() {
    const q = document.getElementById('msc-quick');
    if (!q) return;
    while (q.firstChild) q.removeChild(q.firstChild);
    if (!state.canned.length || !state.isAuthed) return;
    state.canned.slice(0, 6).forEach(c => {
      const b = el('button', 'msc-chip', { type: 'button' });
      b.textContent = c.label;
      b.addEventListener('click', () => sendMessage(c.label));
      q.appendChild(b);
    });
  }

  function updateBadge() {
    const b = document.getElementById('msc-fab-badge');
    if (!b) return;
    if (state.unreadCount > 0) {
      b.textContent = state.unreadCount > 9 ? '9+' : String(state.unreadCount);
      b.hidden = false;
    } else { b.hidden = true; }
  }

  function showAgentTyping() {
    const t = document.getElementById('msc-typing');
    if (!t) return;
    t.hidden = false;
    if (state.agentTypingTimeout) clearTimeout(state.agentTypingTimeout);
    state.agentTypingTimeout = setTimeout(() => { t.hidden = true; }, 4000);
  }

  async function loadConversation() {
    if (!state.isAuthed) return;
    try {
      const data = await api('/api/support/messages');
      state.conversationId = data.conversation && data.conversation.id;
      state.messages = data.messages || [];
      state.unreadCount = data.unread || 0;
      renderMessages();
      updateBadge();
    } catch (err) {
      const t = document.getElementById('msc-thread');
      if (t) {
        while (t.firstChild) t.removeChild(t.firstChild);
        const e0 = el('div', 'msc-empty');
        e0.textContent = 'Could not load support chat. ';
        const btn = el('button', 'msc-link', { type: 'button' });
        btn.textContent = 'Retry';
        btn.addEventListener('click', loadConversation);
        e0.appendChild(btn);
        t.appendChild(e0);
      }
    }
  }

  async function loadCanned() {
    try {
      const data = await api('/api/support/canned');
      state.canned = data.responses || [];
      renderQuick();
    } catch {}
  }

  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || !state.isAuthed) return;

    const optimistic = {
      id: 'tmp-' + Date.now(),
      sender_type: 'user',
      sender_name: 'You',
      body: text,
      created_at: new Date().toISOString(),
      read_by_agent: 0,
      _pending: true,
    };
    state.messages.push(optimistic);
    renderMessages();

    const input = document.getElementById('msc-input');
    if (input) { input.value = ''; autoSize(input); }

    try {
      const data = await api('/api/support/send', { method: 'POST', body: JSON.stringify({ body: text }) });
      const idx = state.messages.findIndex(m => m.id === optimistic.id);
      if (idx >= 0 && data && data.message) state.messages[idx] = data.message;
      renderMessages();
    } catch (err) {
      const idx = state.messages.findIndex(m => m.id === optimistic.id);
      if (idx >= 0) { state.messages[idx]._failed = true; state.messages[idx]._pending = false; }
      renderMessages();
      showError(err.message || 'Failed to send');
    }
  }

  function showError(msg) {
    const foot = document.getElementById('msc-foot-text');
    if (!foot) return;
    foot.textContent = msg;
    foot.style.color = '#ff5577';
    setTimeout(() => { foot.textContent = 'Powered by Matrix Spins'; foot.style.color = ''; }, 4000);
  }

  function autoSize(el2) {
    el2.style.height = 'auto';
    el2.style.height = Math.min(120, el2.scrollHeight) + 'px';
  }

  function open() {
    const panel = document.getElementById('msc-panel');
    if (!panel) return;
    panel.hidden = false;
    state.open = true;
    document.getElementById('msc-fab').classList.add('msc-fab-open');
    requestAnimationFrame(() => panel.classList.add('msc-panel-open'));
    state.unreadCount = 0;
    updateBadge();
    if (state.isAuthed) {
      api('/api/support/read', { method: 'POST' }).catch(() => {});
      if (!state.messages.length) loadConversation();
    }
    setTimeout(() => { const i = document.getElementById('msc-input'); if (i) i.focus(); }, 250);
  }

  function close() {
    const panel = document.getElementById('msc-panel');
    if (!panel) return;
    panel.classList.remove('msc-panel-open');
    state.open = false;
    document.getElementById('msc-fab').classList.remove('msc-fab-open');
    setTimeout(() => { panel.hidden = true; }, 200);
  }

  function connectSocket() {
    if (!window.io || !state.isAuthed) return;
    try {
      const s = window.io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
      state.socket = s;
      s.on('connect', () => s.emit('support:join'));
      s.on('support:agent_message', (data) => {
        if (!data || !data.message) return;
        if (state.messages.find(m => m.id === data.message.id)) return;
        state.messages.push(data.message);
        if (!state.open) state.unreadCount++;
        renderMessages();
        updateBadge();
        if (state.open) {
          api('/api/support/read', { method: 'POST' }).catch(() => {});
        } else if (window.MatrixNotifications && window.MatrixNotifications.toast) {
          window.MatrixNotifications.toast('💬', 'New message from Support', data.message.body);
        }
      });
      s.on('support:agent_typing', () => showAgentTyping());
      s.on('support:status', (data) => {
        if (data && data.status === 'resolved') showError('This conversation was marked resolved by support.');
      });
    } catch (err) {
      console.warn('[chat-widget] socket connect failed:', err.message);
    }
  }

  function ensureSocketIoLoaded(cb) {
    if (window.io) return cb();
    if (document.querySelector('script[data-msc-io]')) {
      const wait = setInterval(() => { if (window.io) { clearInterval(wait); cb(); } }, 100);
      return;
    }
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.async = true;
    s.setAttribute('data-msc-io', '1');
    s.onload = cb;
    s.onerror = () => console.warn('[chat-widget] socket.io client failed to load');
    document.head.appendChild(s);
  }

  function init() {
    if (document.getElementById('ms-support-chat')) return;
    buildDom();

    document.getElementById('msc-fab').addEventListener('click', () => state.open ? close() : open());
    document.getElementById('msc-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) close(); });

    const form = document.getElementById('msc-form');
    const input = document.getElementById('msc-input');
    form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.value); }
    });
    input.addEventListener('input', () => {
      autoSize(input);
      if (state.socket) {
        if (state.typingTimeout) return;
        state.socket.emit('support:typing');
        state.typingTimeout = setTimeout(() => { state.typingTimeout = null; }, 1500);
      }
    });

    if (state.isAuthed) {
      loadConversation();
      loadCanned();
      ensureSocketIoLoaded(connectSocket);
    } else {
      renderMessages();
    }

    window.MatrixSupport = { open, close, reload: loadConversation, send: sendMessage, isAuthed: () => state.isAuthed };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 50);
  }
})();
