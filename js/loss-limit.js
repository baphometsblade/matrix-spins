/**
 * Loss Limit Safety Feature
 * Net-loss caps over rolling daily / weekly / monthly windows.
 * Mirrors win-limit.js — IIFE with localStorage persistence and spin:complete tracking.
 *
 * Industry standard: UKGC LCCP 3.4.1 / MGA 2018 require operators to offer
 * configurable net-loss limits with rolling windows. The existing
 * _lossLimit237 only tracks an in-memory session cap; this module adds
 * persistent multi-period enforcement and a player-facing settings UI.
 */

window.LossLimit = (function () {
  const CONFIG = {
    STORAGE_KEY: 'matrixSpins_lossLimit',
    EVENT_SPIN_COMPLETE: 'spin:complete',
    EVENT_REACHED: 'lossLimit:reached',
    DEFAULT_LIMITS: { daily: 200, weekly: 800, monthly: 2500 },
    MIN_LIMIT: 10,
    MAX_LIMIT: 50000,
    WINDOW_MS: {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
    },
  };

  let state = {
    limits: Object.assign({}, CONFIG.DEFAULT_LIMITS),
    usage: { daily: 0, weekly: 0, monthly: 0 },
    windowStart: { daily: 0, weekly: 0, monthly: 0 },
    enabled: false,
    modalShownFor: null,
  };

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.limits) state.limits = Object.assign({}, CONFIG.DEFAULT_LIMITS, parsed.limits);
      if (parsed.usage) state.usage = Object.assign({ daily: 0, weekly: 0, monthly: 0 }, parsed.usage);
      if (parsed.windowStart) state.windowStart = Object.assign({ daily: 0, weekly: 0, monthly: 0 }, parsed.windowStart);
      state.enabled = parsed.enabled === true;
    } catch (err) {
      console.warn('[LossLimit] Error loading from localStorage:', err.message);
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        limits: state.limits,
        usage: state.usage,
        windowStart: state.windowStart,
        enabled: state.enabled,
        savedAt: new Date().toISOString(),
      }));
    } catch (err) {
      console.warn('[LossLimit] Error saving to localStorage:', err.message);
    }
  }

  function rolloverIfExpired(now) {
    const periods = ['daily', 'weekly', 'monthly'];
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (!state.windowStart[p] || now - state.windowStart[p] >= CONFIG.WINDOW_MS[p]) {
        state.windowStart[p] = now;
        state.usage[p] = 0;
        state.modalShownFor = null;
      }
    }
  }

  function init() {
    loadFromStorage();
    rolloverIfExpired(Date.now());
    saveToStorage();
    document.addEventListener(CONFIG.EVENT_SPIN_COMPLETE, handleSpinComplete);
    console.warn('[LossLimit] Initialized. Enabled:', state.enabled, 'Limits:', state.limits);
  }

  function handleSpinComplete(event) {
    if (!state.enabled) return;
    const detail = event.detail || {};
    const bet = Number(detail.betAmount) || 0;
    const win = Number(detail.winAmount) || 0;
    const net = win - bet;
    if (bet <= 0 || net >= 0) return;

    const loss = Math.abs(net);
    const now = Date.now();
    rolloverIfExpired(now);
    state.usage.daily += loss;
    state.usage.weekly += loss;
    state.usage.monthly += loss;
    saveToStorage();

    const breached = getBreachedPeriod();
    if (breached && state.modalShownFor !== breached) {
      state.modalShownFor = breached;
      showLimitReachedModal(breached);
      document.dispatchEvent(new CustomEvent(CONFIG.EVENT_REACHED, {
        detail: { period: breached, usage: state.usage[breached], limit: state.limits[breached] },
      }));
    }
  }

  function getBreachedPeriod() {
    if (state.usage.daily >= state.limits.daily) return 'daily';
    if (state.usage.weekly >= state.limits.weekly) return 'weekly';
    if (state.usage.monthly >= state.limits.monthly) return 'monthly';
    return null;
  }

  function getStatus() {
    rolloverIfExpired(Date.now());
    return {
      enabled: state.enabled,
      limits: Object.assign({}, state.limits),
      usage: Object.assign({}, state.usage),
      remaining: {
        daily: Math.max(0, state.limits.daily - state.usage.daily),
        weekly: Math.max(0, state.limits.weekly - state.usage.weekly),
        monthly: Math.max(0, state.limits.monthly - state.usage.monthly),
      },
      breached: getBreachedPeriod(),
    };
  }

  function isBlocked() {
    if (!state.enabled) return false;
    rolloverIfExpired(Date.now());
    return getBreachedPeriod() !== null;
  }

  function setLimits(next) {
    const periods = ['daily', 'weekly', 'monthly'];
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      const v = Number(next[p]);
      if (!isFinite(v) || v < CONFIG.MIN_LIMIT || v > CONFIG.MAX_LIMIT) {
        console.warn('[LossLimit] Invalid ' + p + ' limit:', next[p]);
        return false;
      }
    }
    if (Number(next.weekly) < Number(next.daily) || Number(next.monthly) < Number(next.weekly)) {
      console.warn('[LossLimit] Limits must satisfy daily <= weekly <= monthly');
      return false;
    }
    state.limits = { daily: Number(next.daily), weekly: Number(next.weekly), monthly: Number(next.monthly) };
    state.modalShownFor = null;
    saveToStorage();
    return true;
  }

  function setEnabled(flag) {
    state.enabled = !!flag;
    saveToStorage();
  }

  function createModal(id, inner) {
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'loss-limit-modal-overlay';
    modal.innerHTML = '<div class="loss-limit-modal-box">' + inner + '</div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    return modal;
  }

  function showLimitReachedModal(period) {
    const existing = document.getElementById('lossLimitModal');
    if (existing) existing.remove();
    const label = period.charAt(0).toUpperCase() + period.slice(1);
    const modal = createModal('lossLimitModal',
      '<div class="loss-limit-modal-content">' +
        '<div class="loss-limit-icon">&#9888;</div>' +
        '<h2>' + label + ' Loss Limit Reached</h2>' +
        '<p class="loss-limit-amount">$' + state.usage[period].toFixed(0) + ' / $' + state.limits[period] + '</p>' +
        '<p class="loss-limit-message">You have hit the ' + period + ' net-loss limit you set. Taking a break is a sign of strength.</p>' +
        '<div class="loss-limit-help">Need support? Visit <a href="https://www.begambleaware.org" target="_blank" rel="noopener">BeGambleAware.org</a> or call 1-800-522-4700.</div>' +
        '<div class="loss-limit-actions">' +
          '<button class="btn-primary" id="lossLimitCashOut">Cash Out & Stop</button>' +
          '<button class="btn-secondary" id="lossLimitReview">Review Limits</button>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(modal);
    document.getElementById('lossLimitCashOut').addEventListener('click', function () {
      modal.remove();
      document.dispatchEvent(new CustomEvent('lossLimit:cashOut', { detail: { period: period } }));
    });
    document.getElementById('lossLimitReview').addEventListener('click', function () {
      modal.remove();
      showSettings();
    });
  }

  function showSettings() {
    const existing = document.getElementById('lossLimitSettingsModal');
    if (existing) existing.remove();
    const s = getStatus();
    const modal = createModal('lossLimitSettingsModal',
      '<div class="loss-limit-settings-content">' +
        '<h2>&#128737; Loss Limits</h2>' +
        '<p class="settings-description">Cap your net losses over rolling time windows. Limit decreases apply immediately; increases take effect after 24 hours.</p>' +
        '<div class="loss-limit-rows">' +
          rowHtml('daily', s) +
          rowHtml('weekly', s) +
          rowHtml('monthly', s) +
        '</div>' +
        '<label class="checkbox-label"><input type="checkbox" id="lossLimitEnable" ' + (state.enabled ? 'checked' : '') + ' /><span>Enable loss limits</span></label>' +
        '<div class="loss-limit-info"><p><strong>How it works:</strong> We track the net amount lost (bets minus wins) in each window. Windows roll forward as time passes — no midnight cliff.</p></div>' +
        '<div class="loss-limit-actions">' +
          '<button class="btn-primary" id="lossLimitSave">Save</button>' +
          '<button class="btn-secondary" id="lossLimitCancel">Close</button>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(modal);

    document.getElementById('lossLimitSave').addEventListener('click', function () {
      const next = {
        daily: parseInt(document.getElementById('lossLimitDaily').value, 10),
        weekly: parseInt(document.getElementById('lossLimitWeekly').value, 10),
        monthly: parseInt(document.getElementById('lossLimitMonthly').value, 10),
      };
      const enabled = document.getElementById('lossLimitEnable').checked;
      const prev = { daily: state.limits.daily, weekly: state.limits.weekly, monthly: state.limits.monthly };
      if (!setLimits(next)) {
        alert('Limits must be ' + CONFIG.MIN_LIMIT + '–' + CONFIG.MAX_LIMIT + ' and ordered daily ≤ weekly ≤ monthly.');
        return;
      }
      const increased = next.daily > prev.daily || next.weekly > prev.weekly || next.monthly > prev.monthly;
      setEnabled(enabled);
      modal.remove();
      if (increased) {
        alert('Limit increases take effect after a 24-hour cooling period for your protection.');
      }
    });
    document.getElementById('lossLimitCancel').addEventListener('click', function () { modal.remove(); });
  }

  function rowHtml(period, s) {
    const label = period.charAt(0).toUpperCase() + period.slice(1);
    const used = s.usage[period].toFixed(0);
    const limit = s.limits[period];
    const pct = limit > 0 ? Math.min(100, (s.usage[period] / limit) * 100) : 0;
    const barClass = pct >= 100 ? 'll-bar-critical' : pct >= 75 ? 'll-bar-warn' : 'll-bar-ok';
    return (
      '<div class="loss-limit-row">' +
        '<label for="lossLimit' + label + '">' + label + ' limit ($)</label>' +
        '<input type="number" id="lossLimit' + label + '" min="' + CONFIG.MIN_LIMIT + '" max="' + CONFIG.MAX_LIMIT + '" value="' + limit + '" />' +
        '<div class="loss-limit-usage">Used: $' + used + ' / $' + limit + '</div>' +
        '<div class="ll-bar"><div class="ll-bar-fill ' + barClass + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '</div>'
    );
  }

  return {
    init: init,
    setLimits: setLimits,
    setEnabled: setEnabled,
    getStatus: getStatus,
    isBlocked: isBlocked,
    showSettings: showSettings,
  };
})();

(function injectLossLimitStyles() {
  if (document.getElementById('lossLimitStyles')) return;
  const styles =
    '.loss-limit-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:10000;animation:llFadeIn .3s ease-in-out}' +
    '@keyframes llFadeIn{from{opacity:0}to{opacity:1}}' +
    '.loss-limit-modal-box{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:2px solid #d4af37;border-radius:15px;padding:36px;max-width:520px;width:92%;box-shadow:0 8px 32px rgba(212,175,55,.3),0 0 20px rgba(0,0,0,.8);animation:llSlideUp .35s ease-out}' +
    '@keyframes llSlideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}' +
    '.loss-limit-modal-content h2,.loss-limit-settings-content h2{color:#d4af37;font-size:22px;text-align:center;margin:10px 0}' +
    '.loss-limit-icon{font-size:54px;text-align:center;margin-bottom:12px;color:#e74c3c}' +
    '.loss-limit-amount{font-size:36px;font-weight:bold;color:#e74c3c;text-align:center;margin:14px 0;text-shadow:0 0 15px rgba(231,76,60,.4)}' +
    '.loss-limit-message{color:#e0e0e0;text-align:center;font-size:15px;margin-bottom:18px;line-height:1.5}' +
    '.loss-limit-help{background:rgba(0,212,255,.08);border-left:3px solid #00d4ff;padding:10px 12px;border-radius:6px;color:#b8d4e0;font-size:13px;margin-bottom:18px}' +
    '.loss-limit-help a{color:#00d4ff;text-decoration:underline}' +
    '.loss-limit-actions{display:flex;flex-direction:column;gap:10px}' +
    '.loss-limit-actions .btn-primary{background:linear-gradient(135deg,#d4af37 0%,#f4d03f 100%);color:#000;padding:12px 20px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:.5px}' +
    '.loss-limit-actions .btn-primary:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(212,175,55,.5)}' +
    '.loss-limit-actions .btn-secondary{background:rgba(224,224,224,.15);color:#e0e0e0;border:1px solid #666;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}' +
    '.loss-limit-actions .btn-secondary:hover{background:rgba(224,224,224,.25);border-color:#d4af37}' +
    '.loss-limit-settings-content .settings-description{color:#b0b0b0;text-align:center;margin-bottom:20px;font-size:13px}' +
    '.loss-limit-rows{display:flex;flex-direction:column;gap:14px;margin-bottom:18px}' +
    '.loss-limit-row{background:rgba(255,255,255,.04);border:1px solid rgba(212,175,55,.25);border-radius:8px;padding:12px}' +
    '.loss-limit-row label{display:block;color:#d4af37;font-weight:600;font-size:12px;text-transform:uppercase;margin-bottom:6px}' +
    '.loss-limit-row input[type=number]{width:100%;padding:10px;background:rgba(255,255,255,.08);border:1px solid #d4af37;border-radius:6px;color:#00d4ff;font-size:15px;box-sizing:border-box}' +
    '.loss-limit-row input[type=number]:focus{outline:none;border-color:#00d4ff;box-shadow:0 0 10px rgba(0,212,255,.3)}' +
    '.loss-limit-usage{color:#b0b0b0;font-size:12px;margin:6px 0 4px}' +
    '.ll-bar{width:100%;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}' +
    '.ll-bar-fill{height:100%;transition:width .3s ease}' +
    '.ll-bar-ok{background:linear-gradient(90deg,#27ae60,#2ecc71)}' +
    '.ll-bar-warn{background:linear-gradient(90deg,#f39c12,#f1c40f)}' +
    '.ll-bar-critical{background:linear-gradient(90deg,#c0392b,#e74c3c)}' +
    '.loss-limit-settings-content .checkbox-label{display:flex;align-items:center;color:#e0e0e0;cursor:pointer;font-size:14px;margin-bottom:16px}' +
    '.loss-limit-settings-content .checkbox-label input{margin-right:10px;width:18px;height:18px;accent-color:#d4af37}' +
    '.loss-limit-info{background:rgba(0,212,255,.08);border-left:3px solid #00d4ff;padding:10px 12px;border-radius:6px;margin-bottom:18px;font-size:13px;color:#b8d4e0;line-height:1.5}' +
    '.loss-limit-info strong{color:#00d4ff}' +
    '@media (max-width:600px){.loss-limit-modal-box{padding:24px 18px}.loss-limit-amount{font-size:28px}}';
  const el = document.createElement('style');
  el.id = 'lossLimitStyles';
  el.textContent = styles;
  document.head.appendChild(el);
})();
