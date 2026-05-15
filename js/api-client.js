/**
 * Matrix Spins — Frontend API Client
 *
 * Handles:
 *   • Access/refresh token storage (access in memory, refresh in HttpOnly cookie)
 *   • Automatic 401 retry with refresh
 *   • Typed helpers for every server endpoint
 *
 * Configure window.RS_API_BASE at page load (default: /api).
 */
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.RS_API_BASE) || '/api';
  const ACCESS_STORAGE_KEY = 'casinoToken';

  const state = {
    accessToken: localStorage.getItem(ACCESS_STORAGE_KEY) || null,
    user: null,
    listeners: new Set(),
  };

  function setAccessToken(t) {
    state.accessToken = t;
    if (t) localStorage.setItem(ACCESS_STORAGE_KEY, t);
    else localStorage.removeItem(ACCESS_STORAGE_KEY);
  }
  function setUser(u) {
    state.user = u;
    state.listeners.forEach((fn) => { try { fn(u); } catch (_) {} });
  }
  function onUser(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

  async function rawFetch(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
    const res = await fetch(`${API_BASE}${path}`, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res;
  }

  async function tryRefresh() {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return false;
    const data = await res.json();
    setAccessToken(data.token || data.accessToken);
    return true;
  }

  async function apiFetch(path, opts = {}) {
    let res = await rawFetch(path, opts);
    if (res.status === 401 && !opts._retried) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        res = await rawFetch(path, Object.assign({}, opts, { _retried: true }));
      }
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const errField = json?.error;
      const message = (typeof errField === 'string' ? errField : errField?.message)
        || json?.message
        || res.statusText;
      const err = new Error(message);
      err.code = (typeof errField === 'object' && errField) ? errField.code : undefined;
      err.status = res.status;
      err.details = (typeof errField === 'object' && errField) ? errField.details : undefined;
      throw err;
    }
    return json;
  }

  const api = {
    // state
    get accessToken() { return state.accessToken; },
    get user() { return state.user; },
    onUser,
    setAccessToken,

    // session lifecycle
    async loadSession() {
      if (!state.accessToken) {
        const ok = await tryRefresh();
        if (!ok) { setUser(null); return null; }
      }
      try {
        const { user } = await apiFetch('/auth/me');
        setUser(user);
        return user;
      } catch {
        setUser(null);
        return null;
      }
    },

    async register(payload) {
      const out = await apiFetch('/auth/register', { method: 'POST', body: payload });
      setAccessToken(out.token || out.accessToken);
      setUser(out.user);
      // Also store user object for compatibility with main app
      if (out.user) localStorage.setItem('casinoUser', JSON.stringify(out.user));
      return out;
    },
    async login(email, password) {
      // Server reads req.body.username but queries WHERE username=? OR email=?
      // so sending email via the 'username' field works for both username and email login
      const out = await apiFetch('/auth/login', { method: 'POST', body: { username: email, password } });
      // If 2FA is required, return the challenge to the caller WITHOUT applying
      // session. Caller must prompt for code and call verify2fa().
      if (out && out.needs2FA && out.twofaToken) return out;
      setAccessToken(out.token || out.accessToken);
      setUser(out.user);
      if (out.user) localStorage.setItem('casinoUser', JSON.stringify(out.user));
      return out;
    },
    async verify2fa(twofaToken, codeOrBackup) {
      const trimmed = String(codeOrBackup || '').trim();
      const body = /^\d{6}$/.test(trimmed)
        ? { twofaToken, code: trimmed }
        : { twofaToken, backupCode: trimmed };
      const out = await apiFetch('/2fa/login-verify', { method: 'POST', body });
      setAccessToken(out.token || out.accessToken);
      setUser(out.user);
      if (out.user) localStorage.setItem('casinoUser', JSON.stringify(out.user));
      return out;
    },
    async logout() {
      try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (_) {}
      setAccessToken(null);
      setUser(null);
      localStorage.removeItem('casinoUser');
    },
    changePassword: (currentPassword, newPassword) =>
      apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

    // wallet — server mounts balance.routes.js at /api/balance
    getBalance:      () => apiFetch('/balance/'),
    getTransactions: (params) => apiFetch(`/balance/transactions${qs(params)}`),

    // games — server mounts games-catalog.routes.js at /api/games (GET /, /:id, /search),
    // fair.routes.js at /api/fair, gamehistory.routes.js at /api/game-history.
    // The earlier consolidated /api/spin/{games,seeds,history} endpoints were
    // split into separate routers; api-client was left calling the old paths
    // and producing site-wide 404s on the account page AND on every game-page
    // engine boot (Promise.all in casino-engine._boot rejects → fatal error).
    listGames:    (params) => apiFetch(`/games/${qs(params)}`),
    getGame:      (id)     => apiFetch(`/games/${encodeURIComponent(id)}`),
    getSeeds:     ()       => apiFetch('/fair/seed'),
    spin:         (gameId, betCents, opts = {}) =>
      apiFetch('/spin/', {
        method: 'POST',
        body: { gameId, bet: betCents / 100, useFreeSpin: Boolean(opts.useFreeSpin) },
      }),
    getFreeSpins: (gameId) => apiFetch(`/freespins/available?gameId=${encodeURIComponent(gameId)}`),
    spinHistory:  (params) => apiFetch(`/game-history/${qs(params)}`),
    spinDetails:  (spinId) => apiFetch(`/game-history/${encodeURIComponent(spinId)}`),

    // payments — server mounts payment.routes.js at /api/payment (singular)
    depositCheckout: (amount) =>
      apiFetch('/payment/create-checkout', { method: 'POST', body: { amount } }),
    listDeposits:    (params) => apiFetch(`/payment/deposits${qs(params)}`),
    requestWithdrawal: (body) => apiFetch('/payment/withdraw', { method: 'POST', body }),
    cancelWithdrawal:  (id)   => apiFetch(`/payment/withdrawal/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    listWithdrawals:   (params) => apiFetch(`/payment/withdrawals${qs(params)}`),

    // compliance — server mounts at /api/payment for limits, /api/user for self-exclude
    getLimits:    ()   => apiFetch('/payment/limits'),
    setLimits:    (b)  => apiFetch('/payment/limits', { method: 'PUT', body: b }),
    selfExclude:  (b)  => apiFetch('/user/self-exclude', { method: 'POST', body: b }),
    endSession:   ()   => apiFetch('/auth/logout', { method: 'POST' }),
    submitKyc:    (b)  => apiFetch('/kyc/upload', { method: 'POST', body: b }),
    listKyc:      ()   => apiFetch('/kyc/status'),

    // public config
    publicConfig: () => apiFetch('/config/public'),
  };

  function qs(obj) {
    if (!obj) return '';
    const parts = Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }

  // Generic API call for routes not wrapped above
  api.fetch = (path, opts) => apiFetch(path, opts);

  // Helpers for the UI
  api.formatCents = function (cents, currency = 'USD') {
    const n = Number(cents) || 0;
    const sym = currency === 'USD' ? '$' : '';
    return `${sym}${(n / 100).toFixed(2)}`;
  };

  window.MatrixSpinsAPI = api;
  window.RoyalSlotsAPI = api; // backward-compat alias
})();
