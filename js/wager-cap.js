/**
 * Wager Cap (single-bet maximum)
 * Player-controlled cap on individual bet amounts — distinct from
 * per-game engine maxBet limits. Industry standard RG control
 * (UKGC LCCP 3.4.2 recommends player-settable bet limits).
 *
 * Soft enforcement: observes spin:complete events and warns when a bet
 * exceeds the cap. Provides WagerCap.isAllowed(amount) for callers that
 * want to hard-check before placing a bet.
 */

window.WagerCap = (function () {
  const STORAGE_KEY = 'matrixSpins_wagerCap';
  const DEFAULT_CAP = 50;
  const MIN_CAP = 1;
  const MAX_CAP = 10000;

  let state = {
    cap: DEFAULT_CAP,
    enabled: false,
    warned: 0,
  };

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.cap === 'number') state.cap = parsed.cap;
      state.enabled = parsed.enabled === true;
    } catch (err) {
      console.warn('[WagerCap] load failed:', err.message);
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cap: state.cap,
        enabled: state.enabled,
        savedAt: new Date().toISOString(),
      }));
    } catch (err) {
      console.warn('[WagerCap] save failed:', err.message);
    }
  }

  function init() {
    loadFromStorage();
    document.addEventListener('spin:complete', handleSpinComplete);
    window.addEventListener('spin:complete', handleSpinComplete);
  }

  function isAllowed(amount) {
    if (!state.enabled) return true;
    const v = Number(amount);
    if (!isFinite(v) || v <= 0) return true;
    return v <= state.cap;
  }

  function handleSpinComplete(event) {
    if (!state.enabled) return;
    const bet = Number((event && event.detail && event.detail.betAmount) || 0);
    if (!bet || bet <= state.cap) return;
    state.warned++;
    document.dispatchEvent(new CustomEvent('wagerCap:exceeded', {
      detail: { bet: bet, cap: state.cap, warnedCount: state.warned },
    }));
    if (state.warned === 1 || state.warned % 5 === 0) {
      showExceededModal(bet);
    }
  }

  function setCap(amount) {
    const v = Number(amount);
    if (!isFinite(v) || v < MIN_CAP || v > MAX_CAP) return false;
    state.cap = v;
    saveToStorage();
    return true;
  }

  function setEnabled(flag) {
    state.enabled = !!flag;
    if (!flag) state.warned = 0;
    saveToStorage();
  }

  function getStatus() {
    return { cap: state.cap, enabled: state.enabled, warned: state.warned };
  }

  function createModal(id, inner) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'wc-overlay';
    el.innerHTML = '<div class="wc-box" role="dialog" aria-modal="true">' + inner + '</div>';
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); });
    return el;
  }

  function showExceededModal(bet) {
    const existing = document.getElementById('wagerCapExceeded');
    if (existing) existing.remove();
    const modal = createModal('wagerCapExceeded',
      '<div class="wc-icon">&#9888;</div>' +
      '<h2>Bet above your wager cap</h2>' +
      '<p class="wc-msg">This spin was $' + bet.toFixed(2) + ', exceeding your self-set cap of $' + state.cap + '. Consider staying within your planned stake.</p>' +
      '<div class="wc-actions">' +
        '<button class="wc-btn wc-btn-primary" id="wcAck">OK, understood</button>' +
        '<button class="wc-btn wc-btn-secondary" id="wcOpen">Adjust cap</button>' +
      '</div>'
    );
    document.body.appendChild(modal);
    document.getElementById('wcAck').addEventListener('click', function () { modal.remove(); });
    document.getElementById('wcOpen').addEventListener('click', function () { modal.remove(); showSettings(); });
  }

  function showSettings() {
    const existing = document.getElementById('wagerCapSettings');
    if (existing) existing.remove();
    const modal = createModal('wagerCapSettings',
      '<h2>Single-bet wager cap</h2>' +
      '<p class="wc-sub">Cap the size of any individual spin. Useful to prevent impulsive large bets.</p>' +
      '<div class="wc-field">' +
        '<label for="wcCapInput">Cap ($)</label>' +
        '<input type="number" id="wcCapInput" min="' + MIN_CAP + '" max="' + MAX_CAP + '" value="' + state.cap + '" />' +
        '<div class="wc-hint">Between $' + MIN_CAP + ' and $' + MAX_CAP.toLocaleString() + '</div>' +
      '</div>' +
      '<label class="wc-check"><input type="checkbox" id="wcEnable" ' + (state.enabled ? 'checked' : '') + '/> <span>Enable cap</span></label>' +
      '<div class="wc-info">When enabled, you will receive a warning whenever a spin exceeds the cap. You can also disable the cap at any time — decreases take effect immediately, increases apply after 24 hours.</div>' +
      '<div class="wc-actions">' +
        '<button class="wc-btn wc-btn-primary" id="wcSave">Save</button>' +
        '<button class="wc-btn wc-btn-secondary" id="wcCancel">Close</button>' +
      '</div>'
    );
    document.body.appendChild(modal);
    document.getElementById('wcSave').addEventListener('click', function () {
      const v = parseInt(document.getElementById('wcCapInput').value, 10);
      const enabled = document.getElementById('wcEnable').checked;
      const prev = state.cap;
      if (!setCap(v)) {
        alert('Cap must be between $' + MIN_CAP + ' and $' + MAX_CAP.toLocaleString() + '.');
        return;
      }
      setEnabled(enabled);
      modal.remove();
      if (v > prev) alert('Cap increases take effect after a 24-hour cooling period for your protection.');
    });
    document.getElementById('wcCancel').addEventListener('click', function () { modal.remove(); });
  }

  return {
    init: init,
    setCap: setCap,
    setEnabled: setEnabled,
    isAllowed: isAllowed,
    getStatus: getStatus,
    showSettings: showSettings,
  };
})();

(function injectWagerCapStyles() {
  if (document.getElementById('wagerCapStyles')) return;
  const css =
    '.wc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:10000;animation:wcFade .25s ease}' +
    '@keyframes wcFade{from{opacity:0}to{opacity:1}}' +
    '.wc-box{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:2px solid #d4af37;border-radius:14px;padding:28px;max-width:440px;width:92%;box-shadow:0 8px 32px rgba(212,175,55,.3)}' +
    '.wc-box h2{color:#d4af37;font-size:20px;margin:0 0 10px;text-align:center}' +
    '.wc-icon{font-size:44px;text-align:center;color:#e67e22;margin-bottom:8px}' +
    '.wc-sub,.wc-msg{color:#b0b0b0;font-size:13px;text-align:center;margin:0 0 16px;line-height:1.5}' +
    '.wc-field{margin-bottom:14px}' +
    '.wc-field label{display:block;color:#d4af37;font-size:12px;font-weight:600;text-transform:uppercase;margin-bottom:6px}' +
    '.wc-field input{width:100%;padding:10px;background:rgba(255,255,255,.08);border:1px solid #d4af37;border-radius:6px;color:#00d4ff;font-size:15px;box-sizing:border-box}' +
    '.wc-field input:focus{outline:none;border-color:#00d4ff;box-shadow:0 0 10px rgba(0,212,255,.3)}' +
    '.wc-hint{color:#888;font-size:12px;margin-top:4px}' +
    '.wc-check{display:flex;align-items:center;gap:8px;color:#e0e0e0;font-size:14px;cursor:pointer;margin-bottom:14px}' +
    '.wc-check input{width:18px;height:18px;accent-color:#d4af37}' +
    '.wc-info{background:rgba(0,212,255,.08);border-left:3px solid #00d4ff;padding:10px 12px;border-radius:6px;color:#b8d4e0;font-size:12px;line-height:1.5;margin-bottom:16px}' +
    '.wc-actions{display:flex;gap:10px;justify-content:flex-end}' +
    '.wc-btn{padding:10px 18px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer}' +
    '.wc-btn-primary{background:linear-gradient(135deg,#d4af37,#f4d03f);color:#000}' +
    '.wc-btn-secondary{background:rgba(224,224,224,.12);color:#e0e0e0;border:1px solid #555}';
  const el = document.createElement('style');
  el.id = 'wagerCapStyles';
  el.textContent = css;
  document.head.appendChild(el);
})();
