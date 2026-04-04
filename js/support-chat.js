(function() {
  'use strict';

  // API helper function
  async function api(path, opts = {}) {
    if (typeof apiRequest === 'function') return apiRequest(path, opts);
    const tokenKey = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
    const token = localStorage.getItem(tokenKey);
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {})
      }
    });
    return res.json();
  }

  // FAQ/Quick answers database
  const faqDatabase = [
    {
      keywords: ['deposit', 'how do i deposit', 'add funds', 'payment', 'credit card', 'bank'],
      answer: 'To deposit, go to your Wallet → Deposit. We accept credit cards and bank transfers. Most deposits are instant or complete within 1-2 business days.'
    },
    {
      keywords: ['rtp', 'return to player', 'payout', 'odds', 'house edge', 'percentage'],
      answer: 'Each game displays its RTP (Return to Player) percentage when you open it. RTPs range from 95-98% depending on the game. This is the expected long-term payout percentage.'
    },
    {
      keywords: ['withdraw', 'withdrawal', 'cash out', 'payout', 'how do i withdraw', 'get money'],
      answer: 'To withdraw, go to Wallet → Withdraw. Minimum withdrawal is $10. Payouts typically process within 1-5 business days depending on your payment method.'
    },
    {
      keywords: ['self-exclude', 'self exclusion', 'block account', 'limit myself', 'responsible gaming', 'problem gambling'],
      answer: 'You can self-exclude from your Profile → Settings → Responsible Gaming. You can choose to pause your account for 1 day to 5 years. We also offer deposit limits and loss limits.'
    },
    {
      keywords: ['wagering', 'wager requirement', 'playthrough', 'bonus condition', 'bonus', 'free spins'],
      answer: 'Wagering requirements are the amount you need to play through bonuses before you can cash out winnings. For example, 5x wagering means you must bet the bonus amount 5 times.'
    },
    {
      keywords: ['account verification', 'kyc', 'identity', 'verify account', 'documents', 'id'],
      answer: 'For security and compliance, we may ask for identity verification. Upload a photo ID and proof of address in your Profile → Settings. This typically takes 1-2 hours.'
    },
    {
      keywords: ['bonus', 'promotion', 'offer', 'welcome bonus', 'free spins', 'rewards'],
      answer: 'Check the Promotions page for current offers. Welcome bonuses are available to new players. Existing players get reload bonuses, free spins, and VIP rewards.'
    },
    {
      keywords: ['forgot password', 'reset password', 'login issue', 'can\'t log in', 'access account'],
      answer: 'Click "Forgot Password" on the login page and follow the reset link in your email. If you don\'t receive it, check your spam folder or contact support.'
    },
    {
      keywords: ['banned', 'account closed', 'suspended', 'locked', 'why is my account disabled'],
      answer: 'Accounts may be temporarily suspended for security reasons or policy violations. Email support@msaart.online with your username for details and resolution.'
    },
    {
      keywords: ['vip', 'vip status', 'loyalty', 'tier', 'rewards', 'level'],
      answer: 'Earn VIP status by playing regularly. Higher tiers unlock better rewards, faster withdrawals, and dedicated support. Check your VIP level in Profile → VIP.'
    }
  ];

  // State
  const state = {
    isOpen: false,
    unreadCount: 0,
    messages: [],
    container: null,
    bubble: null,
    panel: null
  };

  // Create chat bubble button
  function createChatBubble() {
    const bubble = document.createElement('button');
    bubble.id = 'support-chat-bubble';
    bubble.setAttribute('aria-label', 'Open support chat');
    bubble.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="support-chat-badge" style="display: none;">0</span>
    `;
    bubble.className = 'support-chat-bubble';

    const styles = `
      #support-chat-bubble {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        border: none;
        color: #1f2937;
        font-size: 24px;
        cursor: pointer;
        z-index: 999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
      }

      #support-chat-bubble:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(251, 191, 36, 0.5);
      }

      #support-chat-bubble svg {
        width: 24px;
        height: 24px;
      }

      .support-chat-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        background: #ef4444;
        color: white;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        font-size: 12px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #fff;
      }

      @media (max-width: 640px) {
        #support-chat-bubble {
          bottom: 70px;
          right: 10px;
          width: 48px;
          height: 48px;
        }
      }
    `;

    if (!document.getElementById('support-chat-styles')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'support-chat-styles';
      styleTag.textContent = styles;
      document.head.appendChild(styleTag);
    }

    bubble.addEventListener('click', toggle);
    return bubble;
  }

  // Create chat panel
  function createChatPanel() {
    const panel = document.createElement('div');
    panel.id = 'support-chat-panel';
    panel.className = 'support-chat-panel';

    const panelStyles = `
      #support-chat-panel {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 380px;
        max-width: 90vw;
        height: 500px;
        background: #1a1a2e;
        border-radius: 12px;
        box-shadow: 0 5px 40px rgba(0, 0, 0, 0.6);
        display: flex;
        flex-direction: column;
        z-index: 998;
        border: 1px solid #fbbf24;
        opacity: 0;
        transform: translateY(20px);
        pointer-events: none;
        transition: all 0.3s ease;
      }

      #support-chat-panel.open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: all;
      }

      .support-chat-header {
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        color: #1f2937;
        padding: 16px;
        border-radius: 11px 11px 0 0;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .support-chat-close {
        background: none;
        border: none;
        color: #1f2937;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .support-chat-close:hover {
        opacity: 0.8;
      }

      .support-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        background: #0f0f1e;
      }

      .support-chat-message {
        margin-bottom: 12px;
        animation: slideIn 0.3s ease;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .support-chat-message.user {
        text-align: right;
      }

      .support-chat-message.user .support-chat-bubble-text {
        background: #fbbf24;
        color: #1f2937;
        border-radius: 12px 12px 0 12px;
      }

      .support-chat-message.bot .support-chat-bubble-text {
        background: #374151;
        color: #e5e7eb;
        border-radius: 12px 12px 12px 0;
      }

      .support-chat-bubble-text {
        display: inline-block;
        max-width: 80%;
        padding: 10px 12px;
        font-size: 14px;
        line-height: 1.4;
        word-wrap: break-word;
      }

      .support-chat-faq {
        padding: 12px;
        border-top: 1px solid #374151;
        background: #0f0f1e;
      }

      .support-chat-faq-title {
        font-size: 12px;
        text-transform: uppercase;
        color: #9ca3af;
        margin-bottom: 8px;
        font-weight: 600;
      }

      .support-chat-faq-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 8px;
      }

      .support-chat-faq-btn {
        background: #374151;
        border: 1px solid #4b5563;
        color: #d1d5db;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .support-chat-faq-btn:hover {
        background: #fbbf24;
        color: #1f2937;
        border-color: #fbbf24;
      }

      .support-chat-input-area {
        padding: 12px;
        border-top: 1px solid #374151;
        display: flex;
        gap: 8px;
      }

      .support-chat-input {
        flex: 1;
        background: #374151;
        border: 1px solid #4b5563;
        color: #e5e7eb;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
      }

      .support-chat-input:focus {
        border-color: #fbbf24;
        box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.2);
      }

      .support-chat-input::placeholder {
        color: #9ca3af;
      }

      .support-chat-send {
        background: #fbbf24;
        border: none;
        color: #1f2937;
        padding: 10px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .support-chat-send:hover {
        background: #f59e0b;
        transform: translateY(-1px);
      }

      .support-chat-email-btn {
        background: #6366f1;
        border: none;
        color: white;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .support-chat-email-btn:hover {
        background: #4f46e5;
      }

      @media (max-width: 640px) {
        #support-chat-panel {
          width: calc(100vw - 20px);
          height: 400px;
          bottom: 70px;
          right: 10px;
        }

        .support-chat-faq-buttons {
          grid-template-columns: 1fr;
        }

        .support-chat-bubble-text {
          max-width: 100%;
        }
      }
    `;

    if (!document.getElementById('support-chat-panel-styles')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'support-chat-panel-styles';
      styleTag.textContent = panelStyles;
      document.head.appendChild(styleTag);
    }

    panel.innerHTML = `
      <div class="support-chat-header">
        <span>Support Chat</span>
        <button class="support-chat-close" aria-label="Close chat">✕</button>
      </div>
      <div class="support-chat-messages"></div>
      <div class="support-chat-faq">
        <div class="support-chat-faq-title">Quick Answers</div>
        <div class="support-chat-faq-buttons">
          <button class="support-chat-faq-btn" data-faq="How do I deposit?">How do I deposit?</button>
          <button class="support-chat-faq-btn" data-faq="What is my RTP?">What is my RTP?</button>
          <button class="support-chat-faq-btn" data-faq="How do withdrawals work?">How do withdrawals work?</button>
          <button class="support-chat-faq-btn" data-faq="How do I self-exclude?">How do I self-exclude?</button>
        </div>
      </div>
      <div class="support-chat-input-area">
        <input type="text" class="support-chat-input" placeholder="Type your question..." maxlength="500">
        <button class="support-chat-send">Send</button>
        <a class="support-chat-email-btn" href="mailto:support@msaart.online" title="Email support">Email</a>
      </div>
    `;

    const closeBtn = panel.querySelector('.support-chat-close');
    closeBtn.addEventListener('click', close);

    const input = panel.querySelector('.support-chat-input');
    const sendBtn = panel.querySelector('.support-chat-send');

    sendBtn.addEventListener('click', () => sendMessage(input));
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage(input);
    });

    const faqBtns = panel.querySelectorAll('.support-chat-faq-btn');
    faqBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const question = btn.getAttribute('data-faq');
        input.value = question;
        sendMessage(input);
      });
    });

    return panel;
  }

  // Find matching FAQ answer
  function findFaqAnswer(userMessage) {
    const lowerMsg = userMessage.toLowerCase();
    for (const faq of faqDatabase) {
      for (const keyword of faq.keywords) {
        if (lowerMsg.includes(keyword)) {
          return faq.answer;
        }
      }
    }
    return 'I\'m not sure how to answer that. Please email support@msaart.online for more help!';
  }

  // Add message to chat
  function addMessage(text, isUser = false) {
    const messagesContainer = state.panel.querySelector('.support-chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = `support-chat-message ${isUser ? 'user' : 'bot'}`;
    messageEl.innerHTML = `<div class="support-chat-bubble-text">${escapeHtml(text)}</div>`;
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (!isUser) {
      state.unreadCount++;
      updateBadge();
    }

    state.messages.push({ text, isUser, timestamp: new Date() });
  }

  // Send message and get bot response
  function sendMessage(inputEl) {
    const text = inputEl.value.trim();
    if (!text) return;

    addMessage(text, true);
    inputEl.value = '';

    setTimeout(() => {
      const answer = findFaqAnswer(text);
      addMessage(answer, false);
    }, 300);
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Update unread badge
  function updateBadge() {
    const badge = state.bubble.querySelector('.support-chat-badge');
    if (state.unreadCount > 0) {
      badge.textContent = state.unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Toggle chat panel
  function toggle() {
    if (state.isOpen) {
      close();
    } else {
      open();
    }
  }

  // Open chat
  function open() {
    if (state.isOpen) return;
    state.isOpen = true;
    state.panel.classList.add('open');
    state.unreadCount = 0;
    updateBadge();
    const input = state.panel.querySelector('.support-chat-input');
    setTimeout(() => input.focus(), 100);
  }

  // Close chat
  function close() {
    if (!state.isOpen) return;
    state.isOpen = false;
    state.panel.classList.remove('open');
  }

  // Initialize widget
  function init() {
    if (state.container) return;

    state.container = document.createElement('div');
    state.container.id = 'support-chat-container';

    state.bubble = createChatBubble();
    state.panel = createChatPanel();

    state.container.appendChild(state.bubble);
    state.container.appendChild(state.panel);

    document.body.appendChild(state.container);

    addMessage('👋 Hi! How can I help you today?', false);

    console.warn('[SupportChat] Initialized successfully');
  }

  // Public API
  window.SupportChat = {
    init,
    open,
    close,
    toggle
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
