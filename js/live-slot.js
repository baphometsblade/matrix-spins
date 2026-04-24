/**
 * Live slot — classic_777.
 *
 * Opens a modal UI against /api/slot/spin. Every spin is settled on the
 * server; this file does no RNG and no balance math. It just paints the
 * reels and shows the provably-fair commit-reveal chain.
 *
 * Entry point: window.openLiveSlot(). ui-lobby.js routes
 * openSlot('classic_777') here (see js/app.js).
 */
(function () {
    'use strict';

    if (window.openLiveSlot) return; // guard against double-load

    var SYMBOL_GLYPHS = {
        cherry: '🍒',   // 🍒
        lemon:  '🍋',   // 🍋
        orange: '🍊',   // 🍊
        bar:    'BAR',
        seven:  '7',
    };
    var SYMBOL_COLORS = {
        cherry: '#ef4444',
        lemon:  '#fde047',
        orange: '#fb923c',
        bar:    '#e5e7eb',
        seven:  '#f59e0b',
    };

    var state = {
        betCents: 100,          // $1 default
        committedHash: null,    // hash the user can verify post-spin
        lastResult: null,
        spinning: false,
    };

    function fmt(cents) { return '$' + (Number(cents || 0) / 100).toFixed(2); }

    function authToken() {
        try { return localStorage.getItem('casinoToken'); } catch (e) { return null; }
    }

    function ensureModal() {
        var existing = document.getElementById('liveSlotModal');
        if (existing) return existing;
        var overlay = document.createElement('div');
        overlay.id = 'liveSlotModal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = [
            'position:fixed', 'inset:0',
            'background:rgba(0,0,0,0.85)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'z-index:9999', 'padding:16px',
        ].join(';');

        overlay.innerHTML =
            '<div id="liveSlotCard" style="' +
                'width:100%;max-width:440px;background:linear-gradient(180deg,#1a0705 0%,#2b0d07 100%);' +
                'border:1px solid #f1c40f44;border-radius:14px;padding:22px;color:#fff;font-family:system-ui,sans-serif;' +
                'box-shadow:0 18px 60px rgba(0,0,0,0.6);"' +
            '>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                    '<div><div style="font-size:11px;letter-spacing:2px;color:#f1c40f;">LIVE</div>' +
                    '<div style="font-size:20px;font-weight:800;">CLASSIC 777</div></div>' +
                    '<button id="liveSlotClose" aria-label="Close" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;">&times;</button>' +
                '</div>' +

                '<div id="liveSlotBalance" style="font-size:13px;color:#94a3b8;margin-bottom:8px;">Balance: —</div>' +

                '<div id="liveSlotReels" aria-label="Reels" style="' +
                    'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;' +
                    'background:#0b0504;border:1px solid #f1c40f44;border-radius:10px;padding:16px;' +
                    'margin-bottom:12px;">' +
                    '<div class="ls-reel" style="aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:900;background:#1a0705;border-radius:8px;">?</div>' +
                    '<div class="ls-reel" style="aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:900;background:#1a0705;border-radius:8px;">?</div>' +
                    '<div class="ls-reel" style="aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:900;background:#1a0705;border-radius:8px;">?</div>' +
                '</div>' +

                '<div id="liveSlotResult" style="min-height:22px;text-align:center;font-size:14px;font-weight:700;margin-bottom:12px;color:#fde047;"></div>' +

                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
                    '<label for="liveSlotBet" style="font-size:12px;color:#94a3b8;">Bet</label>' +
                    '<input id="liveSlotBet" type="number" step="0.10" min="0.10" max="100" value="1.00" ' +
                        'style="width:90px;padding:8px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                    '<button id="liveSlotSpin" style="flex:1;padding:12px;border-radius:8px;border:none;' +
                        'background:linear-gradient(135deg,#c0392b 0%,#f1c40f 100%);color:#111;font-weight:900;font-size:16px;letter-spacing:1px;cursor:pointer;">SPIN</button>' +
                '</div>' +

                '<details style="margin-top:8px;color:#94a3b8;font-size:12px;">' +
                    '<summary style="cursor:pointer;outline:none;">Paytable / fairness</summary>' +
                    '<div style="margin-top:8px;line-height:1.55;">' +
                        '<div>3 of a kind on the center row pays:</div>' +
                        '<div style="font-family:monospace;margin:6px 0;">' +
                            '🍒 cherry &times;3  &nbsp; ' +
                            '🍋 lemon &times;10<br>' +
                            '🍊 orange &times;15  &nbsp; ' +
                            'BAR &times;60<br>' +
                            '<span style="color:#f1c40f;">7 &times;500</span>' +
                        '</div>' +
                        '<div id="liveSlotCommit" style="margin-top:6px;">Commit hash: <span style="font-family:monospace;">loading…</span></div>' +
                        '<div id="liveSlotRevealed" style="margin-top:4px;"></div>' +
                    '</div>' +
                '</details>' +
            '</div>';

        document.body.appendChild(overlay);
        return overlay;
    }

    function setResult(text, color) {
        var el = document.getElementById('liveSlotResult');
        if (!el) return;
        el.textContent = text || '';
        el.style.color = color || '#fde047';
    }

    function paintReels(stops) {
        var reels = document.querySelectorAll('#liveSlotReels .ls-reel');
        for (var i = 0; i < reels.length; i++) {
            var sym = stops && stops[i] && stops[i].symbol;
            var glyph = SYMBOL_GLYPHS[sym] || '?';
            reels[i].textContent = glyph;
            reels[i].style.color = SYMBOL_COLORS[sym] || '#fff';
            reels[i].style.fontSize = sym === 'bar' ? '22px' : '42px';
        }
    }

    function shortHash(h) { if (!h) return '—'; return h.slice(0, 10) + '…' + h.slice(-6); }

    function updateCommitUI() {
        var el = document.getElementById('liveSlotCommit');
        if (!el) return;
        var span = el.querySelector('span');
        if (span) span.textContent = state.committedHash ? shortHash(state.committedHash) : 'loading…';
    }

    function updateRevealedUI() {
        var el = document.getElementById('liveSlotRevealed');
        if (!el) return;
        if (!state.lastResult) { el.innerHTML = ''; return; }
        var r = state.lastResult.revealed;
        var rid = state.lastResult.round_id;
        el.innerHTML =
            '<div style="margin-top:4px;">Last round revealed seed:</div>' +
            '<div style="font-family:monospace;word-break:break-all;color:#cbd5e1;">' + r.server_seed + '</div>' +
            '<div style="margin-top:4px;">sha256 of seed must equal pre-commit hash: ' +
                '<span style="font-family:monospace;">' + shortHash(r.server_seed_hash) + '</span></div>' +
            '<div style="margin-top:6px;"><a href="/verify-round.html?round=' + rid + '" target="_blank" rel="noopener" style="color:#00d4ff;">Verify this round &rarr;</a></div>';
    }

    async function fetchJSON(path, opts) {
        opts = opts || {};
        var headers = opts.headers || {};
        var tok = authToken();
        if (tok) headers['Authorization'] = 'Bearer ' + tok;
        headers['Content-Type'] = 'application/json';
        if (opts.method && opts.method !== 'GET' && window.CsrfHelper && CsrfHelper.getToken) {
            try {
                var csrf = await CsrfHelper.getToken();
                if (csrf) headers['X-CSRF-Token'] = csrf;
            } catch (e) { /* best-effort */ }
        }
        var res = await fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
        var txt = await res.text();
        var json = null; try { json = txt ? JSON.parse(txt) : null; } catch (e) {}
        return { status: res.status, body: json, raw: txt };
    }

    async function refreshBalance() {
        var r = await fetchJSON('/api/balance');
        var el = document.getElementById('liveSlotBalance');
        if (!el) return;
        if (r.status === 200 && r.body && typeof r.body.balance_cents === 'number') {
            el.textContent = 'Balance: ' + fmt(r.body.balance_cents);
            el.dataset.cents = String(r.body.balance_cents);
        } else {
            el.textContent = 'Balance: —';
        }
    }

    async function refreshCommit() {
        var r = await fetchJSON('/api/slot/commit');
        if (r.status === 200 && r.body && r.body.server_seed_hash) {
            state.committedHash = r.body.server_seed_hash;
            updateCommitUI();
        }
    }

    async function doSpin() {
        if (state.spinning) return;
        var input = document.getElementById('liveSlotBet');
        var dollars = Number(input.value);
        if (!Number.isFinite(dollars) || dollars <= 0) {
            setResult('Enter a valid bet.', '#ef4444');
            return;
        }
        state.betCents = Math.round(dollars * 100);

        state.spinning = true;
        setResult('Spinning…', '#94a3b8');
        var reels = document.querySelectorAll('#liveSlotReels .ls-reel');
        reels.forEach(function (r) { r.textContent = '☄'; r.style.color = '#f1c40f'; });

        var res = await fetchJSON('/api/slot/spin', {
            method: 'POST',
            body: { game_id: 'classic_777', bet_cents: state.betCents, client_seed: 'live-ui' },
        });

        state.spinning = false;

        if (res.status !== 200) {
            var msg = (res.body && res.body.error) || ('Error ' + res.status);
            setResult(msg, '#ef4444');
            // Re-fetch the commit — on 401 / self-exclusion we may be
            // working with a stale hash.
            refreshCommit();
            return;
        }

        state.lastResult = res.body;
        paintReels(res.body.outcome.stops);
        if (res.body.win_cents > 0) {
            setResult('WIN ' + fmt(res.body.win_cents) + ' (' + (res.body.outcome.line && res.body.outcome.line.multiplier) + 'x)', '#22c55e');
        } else {
            setResult('No win — try again.', '#94a3b8');
        }

        // Commit has rolled — display the NEW unused hash.
        state.committedHash = res.body.next_commit && res.body.next_commit.server_seed_hash;
        updateCommitUI();
        updateRevealedUI();

        var balEl = document.getElementById('liveSlotBalance');
        if (balEl) balEl.textContent = 'Balance: ' + fmt(res.body.balance_cents);
    }

    function wireEvents() {
        var closeBtn = document.getElementById('liveSlotClose');
        if (closeBtn) closeBtn.addEventListener('click', closeLiveSlot);
        var spinBtn = document.getElementById('liveSlotSpin');
        if (spinBtn) spinBtn.addEventListener('click', doSpin);
        var overlay = document.getElementById('liveSlotModal');
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeLiveSlot();
        });
    }

    function closeLiveSlot() {
        var overlay = document.getElementById('liveSlotModal');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    async function openLiveSlot() {
        // Must be signed in — otherwise the server will 401 every call.
        if (!authToken()) {
            if (typeof showAuthModal === 'function') showAuthModal();
            else if (typeof window.showToast === 'function') showToast('Please sign in to play.', 'info');
            return;
        }
        ensureModal();
        wireEvents();
        await Promise.all([refreshBalance(), refreshCommit()]);
    }

    window.openLiveSlot = openLiveSlot;
    window.closeLiveSlot = closeLiveSlot;
})();
