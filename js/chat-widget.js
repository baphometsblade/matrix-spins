/**
 * Matrix Spins Casino — Live Chat Support Widget
 *
 * Features:
 *   • Floating FAB with unread badge
 *   • Expand/collapse animation
 *   • Bot auto-responses for common questions
 *   • Quick reply buttons
 *   • Typing indicator simulation
 *   • Message history in sessionStorage
 *   • Timestamps
 *
 * Usage:
 *   <link rel="stylesheet" href="css/chat-widget.css">
 *   <script src="js/chat-widget.js" defer></script>
 *   <!-- Widget auto-injects itself into the page -->
 */
(function () {
  'use strict';

  // ── Bot Knowledge Base ─────────────────────────────────────
  const RESPONSES = [
    { patterns: [/deposit|add funds|payment/i], reply: 'To make a deposit, head to your <a href="wallet.html">Wallet</a> and click "Deposit". We accept all major cards via Stripe. Minimum deposit is $10.' },
    { patterns: [/withdraw|cash out|payout/i], reply: 'Withdrawals can be requested from your <a href="wallet.html">Wallet</a>. We support bank transfer, crypto, and card. Processing takes 1–3 business days after review.' },
    { patterns: [/bonus|promo|offer|free/i], reply: 'Check our <a href="promotions.html">Promotions</a> page for current offers! New players get $1,000 in demo credits plus 50 free spins.' },
    { patterns: [/vip|loyalty|reward|tier/i], reply: 'Every bet earns XP toward your VIP tier. Visit the <a href="vip.html">VIP Rewards</a> page to see your progress. Higher tiers unlock cashback, bonuses, and exclusive games.' },
    { patterns: [/verify|kyc|identity|document/i], reply: 'Go to <a href="account.html">Account</a> → Verification to submit your documents. We accept passport, driver\'s license, or national ID. Review takes 1–2 business days.' },
    { patterns: [/password|login|sign in|account/i], reply: 'You can change your password from <a href="account.html">Account</a> → Security. If you\'re locked out, use the "Forgot password" link on the login page.' },
    { patterns: [/fair|rng|random|seed|provably/i], reply: 'All games use provably fair algorithms. Check your seeds at <a href="account.html">Account</a> → Security → Provably Fair Seeds. You can verify any spin independently.' },
    { patterns: [/self.?exclu|gambling|addict|limit|responsible/i], reply: 'We take responsible gambling seriously. Set deposit, loss, and session limits at <a href="account.html">Account</a> → Responsible Play. Self-exclusion is also available. Need help? Contact <a href="https://www.begambleaware.org" target="_blank">BeGambleAware.org</a>.' },
    { patterns: [/jackpot|progressive|pool/i], reply: 'We have four progressive jackpot tiers: Mega, Major, Minor, and Mini. A small portion of every bet feeds the pools. The jackpot bar shows real-time amounts at the top of every page!' },
    { patterns: [/game|slot|play|spin/i], reply: 'We have 100 premium slot games from 8 studios. Browse them on our <a href="index.html">home page</a>. Use category filters to find your perfect game!' },
    { patterns: [/hello|hi|hey|sup|good/i], reply: 'Hey there! 👋 Welcome to Matrix Spins support. How can I help you today?' },
    { patterns: [/thank|thanks|thx/i], reply: 'You\'re welcome! Is there anything else I can help with? 😊' },
    { patterns: [/human|agent|real person|live agent/i], reply: 'I\'m currently an AI assistant. For complex issues, you can email us at <strong>support@matrixspins.com</strong> and a human agent will respond within 24 hours.' },
  ];

  const FALLBACK_REPLIES = [
    'I\'m not sure I understand. Could you rephrase that? You can also try asking about deposits, withdrawals, bonuses, VIP rewards, or account verification.',
    'I didn\'t quite catch that. Try asking about a specific topic like payments, promotions, or game fairness. Or type "help" for a list of things I can assist with.',
    'Hmm, I\'m not sure about that one. For complex issues, email us at <strong>support@matrixspins.com</strong> and our team will get back to you within 24 hours.',
  ];

  const QUICK_REPLIES = [
    'How do I deposit?',
    'Withdrawal status',
    'Current promotions',
    'VIP rewards',
    'Provably fair',
    'Talk to a human',
  ];

  // ── State ──────────────────────────────────────────────────
  const state = {
    open: false,
    messages: [],
    unread: 1,
    fallbackIdx: 0,
  };

  // Load from session
  try {
    const saved = sessionStorage.getItem('ms_chat_history');
    if (saved) {
      state.messages = JSON.parse(saved);
      state.unread = 0;
    }
  } catch {}

  function saveMessages() {
    try { sessionStorage.setItem('ms_chat_history', JSON.stringify(state.messages.slice(-50))); } catch {}
  }

  // ── Inject DOM ─────────────────────────────────────────────
  function init() {
    const container = document.createElement('div');
    container.id = 'chatWidgetRoot';
    container.innerHTML = `
      <button class="chat-fab" id="chatFab" aria-label="Open chat support">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <div class="unread-dot ${state.unread > 0 ? '' : 'hidden'}" id="chatUnread">${state.unread}</div>
      </button>
      <div class="chat-window" id="chatWindow">
        <div class="chat-header">
          <div class="chat-agent-avatar">
            MS
            <div class="online-dot"></div>
          </div>
          <div class="chat-header-info">
            <div class="name">Matrix Spins Support</div>
            <div class="status">Online — typically replies instantly</div>
          </div>
          <button class="chat-minimize" id="chatMinimize" aria-label="Minimize chat">−</button>
        </div>
        <div class="chat-messages" id="chatMessages"></div>
        <div class="quick-replies" id="chatQuickReplies">
          ${QUICK_REPLIES.map(q => `<button class="quick-reply" data-msg="${q}">${q}</button>`).join('')}
        </div>
        <div class="chat-input-area">
          <textarea class="chat-input" id="chatInput" placeholder="Type a message..." rows="1"></textarea>
          <button class="chat-send" id="chatSend" aria-label="Send message">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Render existing messages
    const msgArea = document.getElementById('chatMessages');
    if (state.messages.length === 0) {
      addMessage('agent', 'Hi! 👋 I\'m the Matrix Spins support bot. I can help with deposits, withdrawals, bonuses, VIP rewards, account issues, and more. What can I help you with?');
    } else {
      state.messages.forEach(m => renderMessage(m, false));
    }

    // ── Event Listeners ────────────────────────────────────────
    const fab = document.getElementById('chatFab');
    const win = document.getElementById('chatWindow');
    const input = document.getElementById('chatInput');

    fab.addEventListener('click', () => {
      state.open = !state.open;
      win.classList.toggle('open', state.open);
      fab.classList.toggle('open', state.open);
      if (state.open) {
        state.unread = 0;
        document.getElementById('chatUnread').classList.add('hidden');
        input.focus();
        msgArea.scrollTop = msgArea.scrollHeight;
      }
    });

    document.getElementById('chatMinimize').addEventListener('click', () => {
      state.open = false;
      win.classList.remove('open');
      fab.classList.remove('open');
    });

    document.getElementById('chatSend').addEventListener('click', sendMessage);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });

    // Quick replies
    document.querySelectorAll('.quick-reply').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.msg;
        sendMessage();
      });
    });
  }

  // ── Message Handling ───────────────────────────────────────
  function formatTime() {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function addMessage(role, text) {
    const msg = { role, text, time: formatTime() };
    state.messages.push(msg);
    saveMessages();
    renderMessage(msg, true);
  }

  function renderMessage(msg, animate) {
    const msgArea = document.getElementById('chatMessages');
    if (!msgArea) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.role}`;
    div.innerHTML = `<div>${msg.text}</div><div class="time">${msg.time}</div>`;
    if (!animate) div.style.animation = 'none';
    msgArea.appendChild(div);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    addMessage('user', text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));

    // Show typing indicator
    showTyping();

    // Generate response after delay
    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      hideTyping();
      const reply = findReply(text);
      addMessage('agent', reply);

      // If chat is closed, show unread badge
      if (!state.open) {
        state.unread++;
        const badge = document.getElementById('chatUnread');
        badge.textContent = state.unread;
        badge.classList.remove('hidden');
      }
    }, delay);
  }

  function findReply(text) {
    for (const r of RESPONSES) {
      if (r.patterns.some(p => p.test(text))) return r.reply;
    }
    // Cycle through fallback replies
    const reply = FALLBACK_REPLIES[state.fallbackIdx % FALLBACK_REPLIES.length];
    state.fallbackIdx++;
    return reply;
  }

  function showTyping() {
    let indicator = document.getElementById('chatTyping');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'chatTyping';
      indicator.className = 'typing-indicator';
      indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
      document.getElementById('chatMessages').appendChild(indicator);
    }
    indicator.classList.add('visible');
    document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
  }

  function hideTyping() {
    const indicator = document.getElementById('chatTyping');
    if (indicator) indicator.classList.remove('visible');
  }

  // ── Auto-init on DOM ready ─────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
