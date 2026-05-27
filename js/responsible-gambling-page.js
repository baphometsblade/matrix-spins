/* Responsible-gambling page controls — talks to /api/deposit-limits,
   /api/loss-limits, /api/session, /api/self-exclusion */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', main);

  async function main() {
    const api = window.MatrixSpinsAPI;
    const $ = (id) => document.getElementById(id);

    let user = null;
    try {
      if (api && typeof api.loadSession === 'function') {
        user = await api.loadSession();
      }
    } catch (_) { /* not logged in */ }

    if (!user) {
      $('rgLoginPrompt').style.display = '';
      return;
    }

    $('rgPanels').style.display = '';

    const fmtMoney = (n) => '$' + (Number(n) || 0).toFixed(2);
    const fetchJson = async (url, opts) => {
      const r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
      if (!r.ok) {
        let body = null;
        try { body = await r.json(); } catch (_) {}
        const err = new Error((body && body.error) || ('HTTP ' + r.status));
        err.status = r.status;
        err.body = body;
        throw err;
      }
      return r.json();
    };

    function setMsg(el, text, ok) {
      el.textContent = text || '';
      el.style.color = ok ? '#4CAF50' : (text ? '#F44336' : '');
    }

    // ─── Deposit Limits ───
    async function loadDepositLimits() {
      try {
        const data = await fetchJson('/api/deposit-limits/');
        if (data.dailyLimit !== null && data.dailyLimit !== undefined) $('dlDaily').value = data.dailyLimit;
        if (data.weeklyLimit !== null && data.weeklyLimit !== undefined) $('dlWeekly').value = data.weeklyLimit;
        if (data.monthlyLimit !== null && data.monthlyLimit !== undefined) $('dlMonthly').value = data.monthlyLimit;
        const bits = [];
        bits.push('Today: ' + fmtMoney(data.dailyUsed));
        bits.push('This week: ' + fmtMoney(data.weeklyUsed));
        bits.push('This month: ' + fmtMoney(data.monthlyUsed));
        if (data.pendingIncreases && data.pendingIncreases.length) {
          bits.push('Pending: ' + data.pendingIncreases.map(p => p.type + '→' + fmtMoney(p.newLimit)).join(', '));
        }
        $('dlUsage').textContent = bits.join(' · ');
      } catch (e) { $('dlUsage').textContent = 'Could not load deposit limit usage.'; }
    }

    $('dlSave').addEventListener('click', async () => {
      const payload = {
        dailyLimit: parseValue($('dlDaily').value),
        weeklyLimit: parseValue($('dlWeekly').value),
        monthlyLimit: parseValue($('dlMonthly').value)
      };
      setMsg($('dlMsg'), 'Saving…', true);
      try {
        const r = await fetchJson('/api/deposit-limits/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        setMsg($('dlMsg'), r.message || 'Saved.', true);
        loadDepositLimits();
      } catch (e) { setMsg($('dlMsg'), e.message, false); }
    });

    // ─── Loss Limits ───
    async function loadLossLimits() {
      try {
        const data = await fetchJson('/api/loss-limits');
        if (data.dailyLossLimit !== null) $('llDaily').value = data.dailyLossLimit;
        if (data.weeklyLossLimit !== null) $('llWeekly').value = data.weeklyLossLimit;
        if (data.monthlyLossLimit !== null) $('llMonthly').value = data.monthlyLossLimit;
        if (data.maxBetPerSpin !== null) $('maxBet').value = data.maxBetPerSpin;
        if (data.realityCheckInterval) $('realityCheck').value = String(data.realityCheckInterval);

        const bits = [];
        bits.push('Net loss today: ' + fmtMoney(data.dailyLossUsed));
        bits.push('This week: ' + fmtMoney(data.weeklyLossUsed));
        bits.push('This month: ' + fmtMoney(data.monthlyLossUsed));
        if (data.pendingIncreases && data.pendingIncreases.length) {
          bits.push('Pending: ' + data.pendingIncreases.map(p => p.type + '→' + fmtMoney(p.newLimit)).join(', '));
        }
        $('llUsage').textContent = bits.join(' · ');
      } catch (e) { $('llUsage').textContent = 'Could not load loss limit data.'; }
    }

    $('llSave').addEventListener('click', async () => {
      const payload = {
        dailyLossLimit: parseValue($('llDaily').value),
        weeklyLossLimit: parseValue($('llWeekly').value),
        monthlyLossLimit: parseValue($('llMonthly').value)
      };
      setMsg($('llMsg'), 'Saving…', true);
      try {
        const r = await fetchJson('/api/loss-limits/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        setMsg($('llMsg'), r.message || 'Saved.', true);
        loadLossLimits();
      } catch (e) { setMsg($('llMsg'), e.message, false); }
    });

    // ─── Wager / Max Bet ───
    $('wagerSave').addEventListener('click', async () => {
      setMsg($('wagerMsg'), 'Saving…', true);
      try {
        const maxBet = parseValue($('maxBet').value);
        const wagerDaily = parseValue($('wagerDaily').value);

        if (maxBet !== undefined) {
          await fetchJson('/api/loss-limits/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxBetPerSpin: maxBet })
          });
        }
        if (wagerDaily !== undefined) {
          await fetchJson('/api/session/wager-limit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: wagerDaily })
          });
        }
        setMsg($('wagerMsg'), 'Wager limits updated.', true);
        loadLossLimits();
      } catch (e) { setMsg($('wagerMsg'), e.message, false); }
    });

    // ─── Session limit + reality check ───
    async function loadSessionInfo() {
      try {
        const [statusRes, limitRes] = await Promise.all([
          fetchJson('/api/session/status').catch(() => null),
          fetchJson('/api/session/limit').catch(() => null)
        ]);
        const bits = [];
        if (statusRes && statusRes.active) {
          bits.push('Current session: ' + statusRes.elapsed + ' min');
        } else {
          bits.push('No active session');
        }
        if (limitRes && limitRes.limit !== null) {
          bits.push('Limit: ' + limitRes.limit + ' min');
          $('sessionLimit').value = limitRes.limit;
        }
        $('sessionUsage').textContent = bits.join(' · ');
      } catch (_) { $('sessionUsage').textContent = 'Could not load session info.'; }
    }

    $('sessionSave').addEventListener('click', async () => {
      setMsg($('sessionMsg'), 'Saving…', true);
      try {
        const limit = parseValue($('sessionLimit').value);
        const interval = parseInt($('realityCheck').value, 10);

        if (limit !== undefined) {
          await fetchJson('/api/session/limit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit })
          });
        }
        if ([30, 60, 120].includes(interval)) {
          await fetchJson('/api/loss-limits/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ realityCheckInterval: interval })
          });
        }
        setMsg($('sessionMsg'), 'Session settings updated.', true);
        loadSessionInfo();
      } catch (e) { setMsg($('sessionMsg'), e.message, false); }
    });

    // ─── Self-exclusion ───
    async function loadExclusionStatus() {
      try {
        const status = await fetchJson('/api/self-exclusion/status');
        const div = $('excludeStatus');
        while (div.firstChild) div.removeChild(div.firstChild);
        if (status.excluded) {
          const p = document.createElement('p');
          p.style.color = '#F44336';
          p.style.fontWeight = '700';
          if (status.type === 'permanent') {
            p.textContent = 'Your account is permanently self-excluded.';
          } else if (status.endsAt) {
            p.textContent = 'Active exclusion (' + status.type + ') until ' + new Date(status.endsAt).toLocaleString();
          } else {
            p.textContent = 'Active exclusion.';
          }
          div.appendChild(p);
        }
      } catch (_) { /* non-fatal */ }
    }

    document.querySelectorAll('[data-exclude]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const type = btn.getAttribute('data-exclude');
        const labels = {
          cooldown_24h:  '24 hours',
          cooldown_7d:   '7 days',
          cooldown_30d:  '30 days',
          cooldown_6mo:  '6 months',
          cooldown_12mo: '12 months',
          permanent:     'PERMANENTLY (cannot be undone without compliance review)'
        };
        const ok = window.confirm('Self-exclude for ' + labels[type] + '? This cannot be reversed early.');
        if (!ok) return;
        setMsg($('excludeMsg'), 'Activating…', true);
        try {
          const r = await fetchJson('/api/self-exclusion/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
          });
          setMsg($('excludeMsg'), 'Self-exclusion activated. You will be logged out.', true);
          if (r.isPermanent) {
            // CRITICAL: clear the local auth token before redirecting,
            // otherwise an excluded user who has the page open in another
            // tab (or who just opens the site again) is silently still
            // signed in. The server-side `is_active=1` flag in
            // self_exclusions does block fresh /api/* calls, but the
            // /login redirect we want to force only fires if there's no
            // stored token. Call api.logout() so the server-side session
            // is also revoked, then fall back to direct removal.
            try {
              if (window.MatrixSpinsAPI && typeof window.MatrixSpinsAPI.logout === 'function') {
                window.MatrixSpinsAPI.logout().catch(function() { /* network — keep going */ });
              }
            } catch (_e) {}
            try { localStorage.removeItem('casinoToken'); } catch (_e) {}
            try { localStorage.removeItem('casinoUser'); } catch (_e) {}
            try { localStorage.removeItem('casinoBalanceCents'); } catch (_e) {}
            try { sessionStorage.clear(); } catch (_e) {}
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);
          } else {
            loadExclusionStatus();
          }
        } catch (e) { setMsg($('excludeMsg'), e.message, false); }
      });
    });

    function parseValue(v) {
      if (v === '' || v === null || v === undefined) return null;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return null;
      return n;
    }

    // Kick off loads
    loadDepositLimits();
    loadLossLimits();
    loadSessionInfo();
    loadExclusionStatus();
  }
})();
