/**
 * Login History Tracker
 * Premium account-security feature: persistent local log of auth events
 * (login success/failure, register, logout) with device/browser context.
 * Exposes window.LoginHistory for external callers.
 */

window.LoginHistory = (function () {
  const STORAGE_KEY = 'matrixSpins_loginHistory';
  const MAX_ENTRIES = 50;

  function parseUserAgent(ua) {
    if (!ua) return { browser: 'Unknown', device: 'Unknown' };
    let browser = 'Browser';
    if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua)) browser = 'Safari';

    let device = 'Desktop';
    if (/iPhone/.test(ua)) device = 'iPhone';
    else if (/iPad/.test(ua)) device = 'iPad';
    else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    else if (/Windows/.test(ua)) device = 'Windows';
    else if (/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
    else if (/Linux/.test(ua)) device = 'Linux';
    return { browser: browser, device: device };
  }

  function read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      return [];
    }
  }

  function write(list) {
    try {
      const trimmed = list.slice(-MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (err) {
      console.warn('[LoginHistory] save failed:', err.message);
    }
  }

  function log(event) {
    if (!event || !event.type) return;
    const ua = parseUserAgent(navigator.userAgent || '');
    const entry = {
      t: Date.now(),
      type: event.type,
      outcome: event.outcome || 'success',
      username: event.username || null,
      browser: ua.browser,
      device: ua.device,
      reason: event.reason || null,
    };
    const list = read();
    list.push(entry);
    write(list);
  }

  function getHistory() {
    return read().slice().reverse();
  }

  function clearHistory() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = Date.now();
    const diffMin = Math.floor((now - ts) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + ' min ago';
    if (diffMin < 1440) return Math.floor(diffMin / 60) + ' hr ago';
    return d.toLocaleString();
  }

  function iconFor(entry) {
    if (entry.type === 'logout') return '&#128682;';
    if (entry.type === 'register') return '&#127881;';
    if (entry.outcome === 'failed') return '&#9888;';
    return '&#128273;';
  }

  function labelFor(entry) {
    const base = entry.type === 'register' ? 'Account created'
      : entry.type === 'logout' ? 'Signed out'
      : entry.outcome === 'failed' ? 'Failed sign-in attempt'
      : 'Signed in';
    return base;
  }

  function showPanel() {
    const existing = document.getElementById('loginHistoryModal');
    if (existing) existing.remove();
    const history = getHistory();
    const rows = history.length === 0
      ? '<div class="lh-empty">No recorded account activity yet.</div>'
      : history.map(function (e) {
          const warn = e.outcome === 'failed' ? ' lh-row-warn' : '';
          return '<div class="lh-row' + warn + '">' +
            '<div class="lh-icon">' + iconFor(e) + '</div>' +
            '<div class="lh-main">' +
              '<div class="lh-label">' + labelFor(e) + (e.username ? ' <span class="lh-user">(' + e.username + ')</span>' : '') + '</div>' +
              '<div class="lh-meta">' + e.device + ' &middot; ' + e.browser + ' &middot; ' + formatTime(e.t) + (e.reason ? ' &middot; ' + e.reason : '') + '</div>' +
            '</div>' +
          '</div>';
        }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'loginHistoryModal';
    overlay.className = 'lh-overlay';
    overlay.innerHTML =
      '<div class="lh-box" role="dialog" aria-labelledby="lhTitle" aria-modal="true">' +
        '<h2 id="lhTitle">Recent account activity</h2>' +
        '<p class="lh-sub">Review sign-ins from this browser. Activity is stored locally on your device.</p>' +
        '<div class="lh-list">' + rows + '</div>' +
        '<div class="lh-actions">' +
          '<button class="lh-btn lh-btn-secondary" id="lhClear">Clear history</button>' +
          '<button class="lh-btn lh-btn-primary" id="lhClose">Close</button>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    document.getElementById('lhClose').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('lhClear').addEventListener('click', function () {
      if (confirm('Clear all recorded account activity from this device?')) {
        clearHistory();
        overlay.remove();
        showPanel();
      }
    });
  }

  return {
    log: log,
    getHistory: getHistory,
    clearHistory: clearHistory,
    showPanel: showPanel,
  };
})();

(function injectLoginHistoryStyles() {
  if (document.getElementById('loginHistoryStyles')) return;
  const css =
    '.lh-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:10000;animation:lhFade .25s ease}' +
    '@keyframes lhFade{from{opacity:0}to{opacity:1}}' +
    '.lh-box{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:2px solid #d4af37;border-radius:14px;padding:28px;max-width:560px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(212,175,55,.3)}' +
    '.lh-box h2{color:#d4af37;font-size:22px;margin:0 0 6px;text-align:center}' +
    '.lh-sub{color:#b0b0b0;font-size:13px;margin:0 0 16px;text-align:center}' +
    '.lh-list{overflow:auto;flex:1;margin-bottom:16px;padding-right:4px}' +
    '.lh-empty{color:#888;font-style:italic;text-align:center;padding:30px 0}' +
    '.lh-row{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.03);margin-bottom:6px;border-left:3px solid #27ae60}' +
    '.lh-row-warn{border-left-color:#e67e22;background:rgba(230,126,34,.06)}' +
    '.lh-icon{font-size:20px;line-height:1}' +
    '.lh-main{flex:1;min-width:0}' +
    '.lh-label{color:#e0e0e0;font-size:14px;font-weight:600}' +
    '.lh-user{color:#00d4ff;font-weight:500}' +
    '.lh-meta{color:#888;font-size:12px;margin-top:2px}' +
    '.lh-actions{display:flex;gap:10px;justify-content:flex-end}' +
    '.lh-btn{padding:10px 18px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:.3px}' +
    '.lh-btn-primary{background:linear-gradient(135deg,#d4af37,#f4d03f);color:#000}' +
    '.lh-btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(212,175,55,.5)}' +
    '.lh-btn-secondary{background:rgba(224,224,224,.12);color:#e0e0e0;border:1px solid #555}' +
    '.lh-btn-secondary:hover{background:rgba(224,224,224,.2);border-color:#d4af37}' +
    '@media (max-width:600px){.lh-box{padding:20px 16px}.lh-meta{font-size:11px}}';
  const el = document.createElement('style');
  el.id = 'loginHistoryStyles';
  el.textContent = css;
  document.head.appendChild(el);
})();
