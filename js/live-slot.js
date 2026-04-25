/**
 * Live slot — game-agnostic.
 *
 * Opens a modal UI against /api/slot/spin for whichever game id is
 * passed to openLiveSlot(gameId). All game-specific data (reel count,
 * symbols, paytable, bet limits) comes from /api/slot/games at open
 * time; this file does no RNG and no balance math, just paints the
 * reels and shows the provably-fair commit-reveal chain.
 *
 * Entry point: window.openLiveSlot(gameId). ui-slot.js routes any
 * lobby tile with `liveMode: true` here (see shared/game-definitions.js
 * + js/ui-slot.js).
 */
(function () {
    'use strict';

    if (window.openLiveSlot) return; // guard against double-load

    // Static glyph + color tables. New symbols added by future games
    // pick up sensible defaults (see glyphFor / colorFor below) so
    // adding a game purely server-side doesn't render '?' cells until
    // an art entry lands here.
    var SYMBOL_GLYPHS = {
        cherry: '🍒', lemon: '🍋', orange: '🍊', bar: 'BAR', seven: '7',
        neon: 'NEON', pulse: '~', star: '★', comet: '☄', nova: '✦',
    };
    var SYMBOL_COLORS = {
        cherry: '#ef4444', lemon: '#fde047', orange: '#fb923c', bar: '#e5e7eb', seven: '#f59e0b',
        neon: '#22d3ee',   pulse: '#a855f7', star: '#facc15',   comet: '#60a5fa', nova: '#f472b6',
    };
    function glyphFor(sym) { return SYMBOL_GLYPHS[sym] || (sym ? sym.slice(0, 3).toUpperCase() : '?'); }
    function colorFor(sym) { return SYMBOL_COLORS[sym] || '#fff'; }

    var state = {
        gameId: null,
        gameDef: null,          // /api/slot/games row for the open game
        betCents: 100,
        committedHash: null,
        clientSeed: null,       // persistent seed loaded from /api/slot/client-seed
        lastResult: null,
        spinning: false,
    };

    function fmt(cents) { return '$' + (Number(cents || 0) / 100).toFixed(2); }
    function authToken() {
        try { return localStorage.getItem('casinoToken'); } catch (e) { return null; }
    }

    function reelCellHtml(fontSize) {
        return '<div class="ls-reel" style="aspect-ratio:1/1;display:flex;align-items:center;' +
            'justify-content:center;font-size:' + fontSize + 'px;font-weight:900;' +
            'background:#1a0705;border-radius:8px;">?</div>';
    }

    function buildReelsGrid(def) {
        var n = def.reels_count;
        // 3 reels at 42px is the classic; 5 reels in a 440-wide modal
        // need to drop to 28px so the glyphs don't clip.
        var fontSize = n >= 5 ? 28 : 42;
        var cells = '';
        for (var i = 0; i < n; i++) cells += reelCellHtml(fontSize);
        return '<div id="liveSlotReels" aria-label="Reels" style="display:grid;' +
            'grid-template-columns:repeat(' + n + ',1fr);gap:8px;background:#0b0504;' +
            'border:1px solid #f1c40f44;border-radius:10px;padding:16px;margin-bottom:12px;">' +
            cells + '</div>';
    }

    function buildPaytableHtml(def) {
        var rows = Object.keys(def.paytable).map(function (sym) {
            return '<div><span style="color:' + colorFor(sym) + ';font-weight:800;">' +
                glyphFor(sym) + '</span> ' + sym + ' &times;' + def.paytable[sym] + '</div>';
        }).join('');
        return '<div>' + def.reels_count + ' of a kind on the center row pays:</div>' +
            '<div style="font-family:monospace;margin:6px 0;line-height:1.7">' + rows + '</div>';
    }

    function ensureModal() {
        var existing = document.getElementById('liveSlotModal');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        var def = state.gameDef;
        var minDollars = (def.min_bet_cents / 100).toFixed(2);
        var maxDollars = (def.max_bet_cents / 100).toFixed(2);

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
                'width:100%;max-width:520px;background:linear-gradient(180deg,#1a0705 0%,#2b0d07 100%);' +
                'border:1px solid #f1c40f44;border-radius:14px;padding:22px;color:#fff;font-family:system-ui,sans-serif;' +
                'box-shadow:0 18px 60px rgba(0,0,0,0.6);"' +
            '>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                    '<div><div style="font-size:11px;letter-spacing:2px;color:#f1c40f;">LIVE</div>' +
                    '<div id="liveSlotTitle" style="font-size:20px;font-weight:800;">' + (def.name || def.id).toUpperCase() + '</div></div>' +
                    '<button id="liveSlotClose" aria-label="Close" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;">&times;</button>' +
                '</div>' +

                '<div id="liveSlotBalance" style="font-size:13px;color:#94a3b8;margin-bottom:8px;">Balance: —</div>' +

                buildReelsGrid(def) +

                '<div id="liveSlotResult" style="min-height:22px;text-align:center;font-size:14px;font-weight:700;margin-bottom:12px;color:#fde047;"></div>' +

                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
                    '<label for="liveSlotBet" style="font-size:12px;color:#94a3b8;">Bet</label>' +
                    '<input id="liveSlotBet" type="number" step="0.10" ' +
                        'min="' + minDollars + '" max="' + maxDollars + '" value="' + minDollars + '" ' +
                        'style="width:90px;padding:8px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                    '<button id="liveSlotSpin" style="flex:1;padding:12px;border-radius:8px;border:none;' +
                        'background:linear-gradient(135deg,#c0392b 0%,#f1c40f 100%);color:#111;font-weight:900;font-size:16px;letter-spacing:1px;cursor:pointer;">SPIN</button>' +
                '</div>' +

                '<details style="margin-top:8px;color:#94a3b8;font-size:12px;">' +
                    '<summary style="cursor:pointer;outline:none;">Paytable / fairness</summary>' +
                    '<div style="margin-top:8px;line-height:1.55;">' +
                        '<div id="liveSlotPaytable">' + buildPaytableHtml(def) + '</div>' +
                        '<div id="liveSlotCommit" style="margin-top:6px;">Commit hash: <span style="font-family:monospace;">loading…</span></div>' +
                        '<div id="liveSlotRevealed" style="margin-top:4px;"></div>' +
                        '<div id="liveSlotPfSettings" style="margin-top:10px;border-top:1px solid #f1c40f22;padding-top:8px;">' +
                            '<div style="font-weight:700;color:#cbd5e1;margin-bottom:4px;">Your client seed</div>' +
                            '<div style="font-size:11px;color:#9aa1ad;margin-bottom:6px;">Set ahead of the next spin so the server cannot tailor its committed seed to yours. 1–64 printable ASCII chars.</div>' +
                            '<div style="display:flex;gap:6px;align-items:center;">' +
                                '<input id="liveSlotClientSeedInput" type="text" maxlength="64" ' +
                                    'style="flex:1;min-width:0;padding:6px;border-radius:6px;border:1px solid #374151;' +
                                    'background:#0b0504;color:#fff;font-family:monospace;font-size:12px;" />' +
                                '<button id="liveSlotClientSeedSave" style="padding:6px 10px;border-radius:6px;' +
                                    'border:none;background:#f1c40f;color:#111;font-weight:800;cursor:pointer;">Save</button>' +
                            '</div>' +
                            '<div id="liveSlotClientSeedMsg" style="font-size:11px;margin-top:4px;color:#94a3b8;">&nbsp;</div>' +
                        '</div>' +
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
            reels[i].textContent = glyphFor(sym);
            reels[i].style.color = colorFor(sym);
            // Wide-text symbols like "BAR" / "NEON" get a smaller font
            // so they don't overflow the cell.
            var glyph = glyphFor(sym);
            reels[i].style.fontSize = (glyph.length > 1 ? 22 : (state.gameDef.reels_count >= 5 ? 28 : 42)) + 'px';
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
            '<div style="margin-top:4px;">Client seed used: <span style="font-family:monospace;color:#cbd5e1;">' + r.client_seed + '</span> &nbsp; nonce <span style="font-family:monospace;">' + r.nonce + '</span></div>' +
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

    async function refreshClientSeed() {
        var r = await fetchJSON('/api/slot/client-seed');
        if (r.status === 200 && r.body && typeof r.body.client_seed === 'string') {
            state.clientSeed = r.body.client_seed;
            var input = document.getElementById('liveSlotClientSeedInput');
            if (input) input.value = state.clientSeed;
        }
    }

    async function saveClientSeed() {
        var input = document.getElementById('liveSlotClientSeedInput');
        var msg = document.getElementById('liveSlotClientSeedMsg');
        if (!input || !msg) return;
        var val = input.value;
        var r = await fetchJSON('/api/slot/client-seed', { method: 'PUT', body: { client_seed: val } });
        if (r.status === 200) {
            state.clientSeed = r.body.client_seed;
            msg.textContent = 'Saved. Next spin uses this seed.';
            msg.style.color = '#22c55e';
        } else {
            msg.textContent = (r.body && r.body.error) || 'Save failed.';
            msg.style.color = '#ef4444';
        }
    }

    async function doSpin() {
        if (state.spinning) return;
        var def = state.gameDef;
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

        // Don't echo the client seed back — let the server use the
        // persistent value the user set via the "Your client seed"
        // panel. The post-spin response's `revealed.client_seed`
        // remains the source of truth for "what was actually used".
        var res = await fetchJSON('/api/slot/spin', {
            method: 'POST',
            body: { game_id: state.gameId, bet_cents: state.betCents },
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
        // Expose for browser-smoke assertions; harmless in production
        // (the round details are already echoed in the visible reveal
        // panel for the user who just made the spin).
        try { window.__lastSlotResult = res.body; } catch (e) { /* noop */ }
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
        var saveBtn = document.getElementById('liveSlotClientSeedSave');
        if (saveBtn) saveBtn.addEventListener('click', saveClientSeed);
        var overlay = document.getElementById('liveSlotModal');
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeLiveSlot();
        });
    }

    function closeLiveSlot() {
        var overlay = document.getElementById('liveSlotModal');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        state.gameId = null;
        state.gameDef = null;
    }

    async function openLiveSlot(gameId) {
        gameId = gameId || 'classic_777';
        if (!authToken()) {
            if (typeof showAuthModal === 'function') showAuthModal();
            else if (typeof window.showToast === 'function') showToast('Please sign in to play.', 'info');
            return;
        }
        var listRes = await fetchJSON('/api/slot/games');
        var list = (listRes.body && listRes.body.games) || [];
        var def = list.find(function (g) { return g.id === gameId; });
        if (!def) {
            if (typeof window.showToast === 'function') showToast('Game not available right now.', 'error');
            return;
        }
        state.gameId = gameId;
        state.gameDef = def;
        state.betCents = def.min_bet_cents;
        state.committedHash = null;
        state.lastResult = null;
        ensureModal();
        wireEvents();
        await Promise.all([refreshBalance(), refreshCommit(), refreshClientSeed()]);
    }

    window.openLiveSlot = openLiveSlot;
    window.closeLiveSlot = closeLiveSlot;
})();
