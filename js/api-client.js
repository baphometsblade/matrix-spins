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
  const ACCESS_STORAGE_KEY = 'rs_access_token';

  const state = {
    accessToken: sessionStorage.getItem(ACCESS_STORAGE_KEY) || null,
    user: null,
    listeners: new Set(),
  };

  function setAccessToken(t) {
    state.accessToken = t;
    if (t) sessionStorage.setItem(ACCESS_STORAGE_KEY, t);
    else sessionStorage.removeItem(ACCESS_STORAGE_KEY);
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
    setAccessToken(data.accessToken);
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
      const err = new Error(json?.error?.message || res.statusText);
      err.code = json?.error?.code;
      err.status = res.status;
      err.details = json?.error?.details;
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
      setAccessToken(out.accessToken);
      setUser(out.user);
      return out;
    },
    async login(email, password) {
      const out = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
      setAccessToken(out.accessToken);
      setUser(out.user);
      return out;
    },
    async logout() {
      try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (_) {}
      setAccessToken(null);
      setUser(null);
    },
    changePassword: (currentPassword, newPassword) =>
      apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

    // wallet
    getBalance:      () => apiFetch('/wallet/balance'),
    getTransactions: (params) => apiFetch(`/wallet/transactions${qs(params)}`),

    // games
    listGames:    (params) => apiFetch(`/games${qs(params)}`),
    getGame:      (id)     => apiFetch(`/games/${encodeURIComponent(id)}`),
    getSeeds:     ()       => apiFetch('/games/seeds/current'),
    setClientSeed:(seed)   => apiFetch('/games/seeds/client', { method: 'POST', body: { clientSeed: seed } }),
    rotateSeed:   ()       => apiFetch('/games/seeds/rotate', { method: 'POST' }),
    spin:         (gameId, betCents, opts = {}) =>
      apiFetch(`/games/${encodeURIComponent(gameId)}/spin`, {
        method: 'POST',
        body: { betCents, useFreeSpin: Boolean(opts.useFreeSpin) },
      }),
    getFreeSpins: (gameId) => apiFetch(`/games/${encodeURIComponent(gameId)}/free-spins`),
    spinHistory:  (params) => apiFetch(`/games/history/spins${qs(params)}`),
    spinDetails:  (spinId) => apiFetch(`/games/history/spins/${encodeURIComponent(spinId)}`),

    // payments
    depositCheckout: (amountCents) =>
      apiFetch('/payments/deposit/checkout', { method: 'POST', body: { amountCents } }),
    listDeposits:    (params) => apiFetch(`/payments/deposits${qs(params)}`),
    requestWithdrawal: (body) => apiFetch('/payments/withdrawals', { method: 'POST', body }),
    cancelWithdrawal:  (id)   => apiFetch(`/payments/withdrawals/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    listWithdrawals:   (params) => apiFetch(`/payments/withdrawals${qs(params)}`),

    // compliance
    getLimits:    ()   => apiFetch('/compliance/limits'),
    setLimits:    (b)  => apiFetch('/compliance/limits', { method: 'PUT', body: b }),
    selfExclude:  (b)  => apiFetch('/compliance/self-exclude', { method: 'POST', body: b }),
    endSession:   ()   => apiFetch('/compliance/session/end', { method: 'POST' }),
    submitKyc:    (b)  => apiFetch('/compliance/kyc/documents', { method: 'POST', body: b }),
    listKyc:      ()   => apiFetch('/compliance/kyc/documents'),

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

  // Helpers for the UI
  api.formatCents = function (cents, currency = 'USD') {
    const n = Number(cents) || 0;
    const sym = currency === 'USD' ? '$' : '';
    return `${sym}${(n / 100).toFixed(2)}`;
  };

  window.MatrixSpinsAPI = api;
  window.RoyalSlotsAPI = api; // backward-compat alias
})();
