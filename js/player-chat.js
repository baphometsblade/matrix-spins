(function() {
  'use strict';

  const PROFANITY_FILTER = [
    'badword1', 'badword2', 'badword3', 'badword4', 'badword5',
    'offensive', 'inappropriate', 'vulgar', 'crude', 'nasty',
    'spam', 'scam', 'hack', 'cheat', 'bot'
  ];

  const RATE_LIMIT_MS = 5000; // 5 seconds between messages
  const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
  const MAX_MESSAGE_LENGTH = 200;
  const MESSAGES_TO_FETCH = 50;

  let lastMessageSentAt = 0;
  let lastFetchedMessageId = 0;
  let pollIntervalId = null;
  let chatPanel = null;
  let chatFeed = null;
  let messageInput = null;
  let sendButton = null;
  let rateLimitDisplay = null;
  let isVisible = false;

  function initDOM() {
    // Create chat panel HTML
    const panelHTML = `
      <div id="player-chat-panel" class="player-chat-panel">
        <div class="player-chat-header">
          <h3>Player Chat</h3>
          <button id="chat-close-btn" class="chat-close-btn" aria-label="Close chat">×</button>
        </div>
        <div id="chat-feed" class="chat-feed">
          <div class="chat-loading">Loading messages...</div>
        </div>
        <div class="player-chat-footer">
          <div id="chat-rate-limit" class="chat-rate-limit"></div>
          <div class="chat-input-wrapper">
            <textarea
              id="chat-message-input"
              class="chat-message-input"
              placeholder="Type a message... (max 200 characters)"
              maxlength="${MAX_MESSAGE_LENGTH}"
              rows="2"
            ></textarea>
            <button id="chat-send-btn" class="chat-send-btn">Send</button>
          </div>
          <div id="chat-char-count" class="chat-char-count">0/${MAX_MESSAGE_LENGTH}</div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', panelHTML);

    // Create chat toggle button in lobby area
    const lobbyContainer = document.querySelector('.lobby') || document.querySelector('main');
    if (lobbyContainer) {
      const chatButtonHTML = `
        <button id="chat-toggle-btn" class="chat-toggle-btn" title="Open Player Chat">
          <span class="chat-icon">💬</span>
          <span class="chat-label">Chat</span>
        </button>
      `;
      lobbyContainer.insertAdjacentHTML('afterbegin', chatButtonHTML);
    }

    // Get references
    chatPanel = document.getElementById('player-chat-panel');
    chatFeed = document.getElementById('chat-feed');
    messageInput = document.getElementById('chat-message-input');
    sendButton = document.getElementById('chat-send-btn');
    rateLimitDisplay = document.getElementById('chat-rate-limit');

    const toggleBtn = document.getElementById('chat-toggle-btn');
    const closeBtn = document.getElementById('chat-close-btn');
    const charCountDisplay = document.getElementById('chat-char-count');

    // Event listeners
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggle);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', hide);
    }

    if (sendButton) {
      sendButton.addEventListener('click', sendMessage);
    }

    if (messageInput) {
      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      messageInput.addEventListener('input', () => {
        charCountDisplay.textContent = `${messageInput.value.length}/${MAX_MESSAGE_LENGTH}`;
      });
    }

    // Add styles
    injectStyles();
  }

  function injectStyles() {
    if (document.getElementById('player-chat-styles')) return;

    const styles = `
      <style id="player-chat-styles">
        .player-chat-panel {
          position: fixed;
          right: 20px;
          bottom: 20px;
          width: 350px;
          height: 550px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border: 2px solid #d4af37;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(212, 175, 55, 0.2);
          z-index: 9998;
          animation: slideIn 0.3s ease-out;
          transform: translateX(380px);
          transition: transform 0.3s ease-out;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        .player-chat-panel.visible {
          transform: translateX(0);
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(380px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .player-chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          border-bottom: 2px solid #d4af37;
          background: linear-gradient(90deg, #0f3460 0%, #16213e 100%);
        }

        .player-chat-header h3 {
          margin: 0;
          color: #d4af37;
          font-size: 16px;
          font-weight: 600;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .chat-close-btn {
          background: none;
          border: none;
          color: #d4af37;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s, transform 0.2s;
        }

        .chat-close-btn:hover {
          color: #fff;
          transform: scale(1.1);
        }

        .chat-feed {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .chat-message {
          background: rgba(79, 39, 131, 0.3);
          border-left: 3px solid #d4af37;
          padding: 10px;
          border-radius: 6px;
          animation: fadeIn 0.3s ease-out;
          word-wrap: break-word;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .chat-message-username {
          color: #d4af37;
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .chat-message-timestamp {
          color: #888;
          font-size: 11px;
          margin-left: 8px;
        }

        .chat-message-text {
          color: #e0e0e0;
          font-size: 13px;
          line-height: 1.4;
        }

        .chat-loading {
          color: #888;
          text-align: center;
          padding: 20px;
          font-size: 12px;
        }

        .player-chat-footer {
          padding: 12px;
          border-top: 2px solid #d4af37;
          background: linear-gradient(90deg, #0f3460 0%, #16213e 100%);
        }

        .chat-rate-limit {
          color: #d4af37;
          font-size: 11px;
          margin-bottom: 8px;
          min-height: 14px;
          text-transform: uppercase;
          font-weight: 500;
        }

        .chat-rate-limit.limited {
          color: #ff6b6b;
        }

        .chat-input-wrapper {
          display: flex;
          gap: 8px;
          margin-bottom: 6px;
        }

        .chat-message-input {
          flex: 1;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid #d4af37;
          color: #e0e0e0;
          padding: 8px;
          border-radius: 6px;
          font-family: inherit;
          font-size: 12px;
          resize: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .chat-message-input:focus {
          outline: none;
          border-color: #ffd700;
          box-shadow: 0 0 10px rgba(212, 175, 55, 0.3);
        }

        .chat-message-input::placeholder {
          color: #666;
        }

        .chat-send-btn {
          background: linear-gradient(135deg, #d4af37 0%, #ffd700 100%);
          border: none;
          color: #000;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
          text-transform: uppercase;
        }

        .chat-send-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(212, 175, 55, 0.4);
        }

        .chat-send-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .chat-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .chat-char-count {
          text-align: right;
          color: #888;
          font-size: 11px;
        }

        .chat-toggle-btn {
          position: fixed;
          right: 20px;
          bottom: 20px;
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #d4af37 0%, #ffd700 100%);
          border: 2px solid #0f3460;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          z-index: 9997;
          box-shadow: 0 4px 12px rgba(212, 175, 55, 0.4);
          transition: all 0.3s ease;
          animation: pulse 2s infinite;
        }

        .chat-toggle-btn:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 16px rgba(212, 175, 55, 0.6);
        }

        .chat-toggle-btn.hidden {
          display: none;
        }

        @keyframes pulse {
          0%, 100% { box-shadow: 0 4px 12px rgba(212, 175, 55, 0.4); }
          50% { box-shadow: 0 4px 16px rgba(212, 175, 55, 0.6); }
        }

        .chat-icon {
          font-size: 24px;
        }

        .chat-label {
          font-size: 10px;
          font-weight: 600;
          color: #0f3460;
          text-transform: uppercase;
        }

        /* Scrollbar styling */
        .chat-feed::-webkit-scrollbar {
          width: 6px;
        }

        .chat-feed::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }

        .chat-feed::-webkit-scrollbar-thumb {
          background: #d4af37;
          border-radius: 3px;
        }

        .chat-feed::-webkit-scrollbar-thumb:hover {
          background: #ffd700;
        }

        @media (max-width: 600px) {
          .player-chat-panel {
            width: calc(100% - 40px);
            height: 70vh;
            right: 20px;
            bottom: 80px;
          }

          .chat-toggle-btn {
            right: 20px;
            bottom: 20px;
          }
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }

  function filterProfanity(text) {
    let filtered = text;
    PROFANITY_FILTER.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      filtered = filtered.replace(regex, '*'.repeat(word.length));
    });
    return filtered;
  }

  function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  function renderMessages(messages) {
    if (!chatFeed) return;

    const shouldScroll = chatFeed.scrollTop + chatFeed.clientHeight >= chatFeed.scrollHeight - 50;

    const messagesHTML = messages.map(msg => `
      <div class="chat-message">
        <div class="chat-message-username">
          ${escapeHtml(msg.username)}
          <span class="chat-message-timestamp">${formatTimestamp(msg.created_at)}</span>
        </div>
        <div class="chat-message-text">${escapeHtml(msg.message)}</div>
      </div>
    `).join('');

    chatFeed.innerHTML = messagesHTML || '<div class="chat-loading">No messages yet. Be the first to chat!</div>';

    if (shouldScroll) {
      setTimeout(() => {
        chatFeed.scrollTop = chatFeed.scrollHeight;
      }, 0);
    }

    if (messages.length > 0) {
      lastFetchedMessageId = Math.max(...messages.map(m => m.id));
    }
  }

  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  async function fetchMessages() {
    try {
      const params = new URLSearchParams();
      if (lastFetchedMessageId > 0) {
        params.append('since', lastFetchedMessageId);
      }

      const response = await fetch(`/api/chat/messages?${params.toString()}`);

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[PlayerChat] Not authenticated');
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.messages && Array.isArray(data.messages)) {
        renderMessages(data.messages);
      }
    } catch (error) {
      console.warn('[PlayerChat] Failed to fetch messages:', error.message);
    }
  }

  async function sendMessage() {
    if (!messageInput) return;

    const text = messageInput.value.trim();

    if (!text) {
      console.warn('[PlayerChat] Empty message');
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageSentAt;

    if (timeSinceLastMessage < RATE_LIMIT_MS) {
      const secondsRemaining = Math.ceil((RATE_LIMIT_MS - timeSinceLastMessage) / 1000);
      console.warn(`[PlayerChat] Rate limited. Wait ${secondsRemaining}s`);
      return;
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      console.warn(`[PlayerChat] Message exceeds ${MAX_MESSAGE_LENGTH} characters`);
      return;
    }

    // Disable send button during request
    if (sendButton) {
      sendButton.disabled = true;
    }

    try {
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: text })
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[PlayerChat] Not authenticated');
          return;
        }
        if (response.status === 400) {
          const error = await response.json();
          console.warn('[PlayerChat] Invalid message:', error.message);
          return;
        }
        if (response.status === 429) {
          console.warn('[PlayerChat] Rate limited by server');
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      lastMessageSentAt = Date.now();
      messageInput.value = '';
      document.getElementById('chat-char-count').textContent = `0/${MAX_MESSAGE_LENGTH}`;
      updateRateLimitDisplay();

      // Fetch updated messages immediately
      await fetchMessages();
    } catch (error) {
      console.warn('[PlayerChat] Failed to send message:', error.message);
    } finally {
      if (sendButton) {
        sendButton.disabled = false;
      }
    }
  }

  function updateRateLimitDisplay() {
    if (!rateLimitDisplay) return;

    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageSentAt;
    const isLimited = timeSinceLastMessage < RATE_LIMIT_MS;

    if (isLimited) {
      const secondsRemaining = Math.ceil((RATE_LIMIT_MS - timeSinceLastMessage) / 1000);
      rateLimitDisplay.textContent = `⏱ Wait ${secondsRemaining}s before next message`;
      rateLimitDisplay.classList.add('limited');
    } else {
      rateLimitDisplay.textContent = '✓ Ready to send';
      rateLimitDisplay.classList.remove('limited');
    }
  }

  function startPolling() {
    if (pollIntervalId) return;

    // Fetch immediately
    fetchMessages();

    // Then poll
    pollIntervalId = setInterval(() => {
      if (isVisible) {
        fetchMessages();
        updateRateLimitDisplay();
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  function init() {
    if (!chatPanel) {
      initDOM();
    }
    startPolling();
  }

  function show() {
    if (!chatPanel) {
      initDOM();
    }
    isVisible = true;
    chatPanel.classList.add('visible');
    const toggleBtn = document.getElementById('chat-toggle-btn');
    if (toggleBtn) {
      toggleBtn.classList.add('hidden');
    }
    startPolling();
    setTimeout(() => {
      if (messageInput) messageInput.focus();
      if (chatFeed) chatFeed.scrollTop = chatFeed.scrollHeight;
    }, 100);
  }

  function hide() {
    if (!chatPanel) return;
    isVisible = false;
    chatPanel.classList.remove('visible');
    const toggleBtn = document.getElementById('chat-toggle-btn');
    if (toggleBtn) {
      toggleBtn.classList.remove('hidden');
    }
  }

  function toggle() {
    if (isVisible) {
      hide();
    } else {
      show();
    }
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API
  window.PlayerChat = {
    init,
    show,
    hide,
    toggle
  };
})();
