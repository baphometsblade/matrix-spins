/* Shared client utilities for the new table games (Blackjack, Roulette, Video Poker).
 * Depends on api-client.js for token storage.
 */
(function () {
  'use strict';

  const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RED_SUITS = new Set(['H', 'D']);

  function getToken() {
    return localStorage.getItem('casinoToken') || '';
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    const tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let json = {};
    try { json = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderCard(card, opts) {
    opts = opts || {};
    const div = el('div', 'tg-card');
    if (!card || card.r === '?' || opts.back) {
      div.classList.add('tg-back');
      div.appendChild(el('span', 'rank', ' '));
      div.appendChild(el('span', 'suit', ' '));
      return div;
    }
    const isRed = RED_SUITS.has(card.s);
    div.classList.add(isRed ? 'tg-red' : 'tg-black');
    if (opts.held) div.classList.add('held');
    if (opts.deal) div.classList.add('tg-deal-anim');
    if (opts.flip) div.classList.add('tg-flip');
    const rankText = card.r === 'T' ? '10' : card.r;
    div.appendChild(el('span', 'rank', rankText));
    div.appendChild(el('span', 'center', SUIT_GLYPH[card.s] || ''));
    div.appendChild(el('span', 'suit', SUIT_GLYPH[card.s] || ''));
    return div;
  }

  function renderHand(container, handCards, opts) {
    opts = opts || {};
    container.textContent = '';
    handCards.forEach(function (c, i) {
      const o = Object.assign({}, opts);
      if (Array.isArray(opts.holds)) o.held = !!opts.holds[i];
      o.deal = opts.animateAll || false;
      const node = renderCard(c, o);
      if (opts.onClick) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', function () { opts.onClick(i, node); });
      }
      container.appendChild(node);
    });
  }

  function toast(msg, isErr) {
    document.querySelectorAll('.tg-toast').forEach(function (n) { n.remove(); });
    const t = el('div', 'tg-toast' + (isErr ? ' err' : ''), msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }

  function fmt(n) {
    return '$' + Number(n || 0).toFixed(2);
  }

  function setBalance(amount) {
    document.querySelectorAll('.tg-balance .amount').forEach(function (node) {
      node.textContent = fmt(amount);
    });
  }

  async function refreshBalance() {
    try {
      const r = await api('/balance');
      setBalance(r.balance);
      return r.balance;
    } catch (_) { return null; }
  }

  function requireAuth() {
    if (!getToken()) {
      toast('Please log in to play.', true);
      setTimeout(function () { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); }, 800);
      return false;
    }
    return true;
  }

  window.TG = { api, renderCard, renderHand, el, toast, fmt, setBalance, refreshBalance, requireAuth, SUIT_GLYPH, RED_SUITS };
})();
