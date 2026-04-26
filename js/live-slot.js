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

    // Symbol display table. Catalog symbols (s1_*, s2_*, …, wild_*) are
    // rendered with a short rank label; legacy classic_777 / neon_burst
    // glyphs keep their unicode glyph. New game symbols fall through to
    // a 3-letter abbreviation so a server-only game still shows
    // recognizable cells until art ships.
    var SYMBOL_GLYPHS = {
        cherry: '🍒', lemon: '🍋', orange: '🍊', bar: 'BAR', seven: '7',
        neon: 'NEON', pulse: '~', star: '★', comet: '☄', nova: '✦',
    };
    var SYMBOL_COLORS = {
        cherry: '#ef4444', lemon: '#fde047', orange: '#fb923c', bar: '#e5e7eb', seven: '#f59e0b',
        neon: '#22d3ee',   pulse: '#a855f7', star: '#facc15',   comet: '#60a5fa', nova: '#f472b6',
    };
    // Catalog symbols look like s1_lollipop / s2_gummy_bear / wild_sugar.
    // Render rank ribbons (S1..S5, WILD) so each cell is legible without
    // per-symbol art. Color ramps run high-pay → low-pay.
    var RANK_COLORS = ['#94a3b8', '#22d3ee', '#a855f7', '#f59e0b', '#ef4444'];
    function rankFromSymbol(sym) {
        if (!sym) return null;
        if (/^wild[_ ]/.test(sym) || sym === 'wild') return { label: 'WILD', color: '#fde047' };
        var m = /^s(\d+)/.exec(sym);
        if (m) {
            var i = Math.min(RANK_COLORS.length - 1, Math.max(0, Number(m[1]) - 1));
            return { label: 'S' + m[1], color: RANK_COLORS[i] };
        }
        return null;
    }
    function glyphFor(sym) {
        if (SYMBOL_GLYPHS[sym]) return SYMBOL_GLYPHS[sym];
        var r = rankFromSymbol(sym);
        if (r) return r.label;
        return sym ? sym.slice(0, 3).toUpperCase() : '?';
    }
    function colorFor(sym) {
        if (SYMBOL_COLORS[sym]) return SYMBOL_COLORS[sym];
        var r = rankFromSymbol(sym);
        if (r) return r.color;
        return '#fff';
    }

    // Number of grid rows for a given game definition. Tuned games
    // (classic_777, neon_burst) come back from /api/slot/games without
    // a `rows` field and are single-row; universal games declare both
    // `cols` and `rows` so we can lay out a true 2-D grid.
    function rowsOf(def) { return Math.max(1, Number(def.rows) || 1); }
    function colsOf(def) { return Math.max(1, Number(def.cols) || Number(def.reels_count) || 3); }

    var state = {
        gameId: null,
        gameDef: null,          // /api/slot/games row for the open game
        betCents: 100,
        committedHash: null,
        clientSeed: null,       // persistent seed loaded from /api/slot/client-seed
        lastResult: null,
        spinning: false,
        autoCancel: false,      // user-driven stop flag for the auto-spin loop
    };

    function fmt(cents) { return '$' + (Number(cents || 0) / 100).toFixed(2); }
    function authToken() {
        try { return localStorage.getItem('casinoToken'); } catch (e) { return null; }
    }

    function reelCellHtml(fontSize, key) {
        return '<div class="ls-reel" data-cell="' + key + '" style="aspect-ratio:1/1;display:flex;align-items:center;' +
            'justify-content:center;font-size:' + fontSize + 'px;font-weight:900;' +
            'background:#1a0705;border-radius:8px;transition:background 0.2s ease;">?</div>';
    }

    function buildReelsGrid(def) {
        var cols = colsOf(def);
        var rows = rowsOf(def);
        // Font size scales with grid density: a 7×7 grid in a 520-wide
        // modal can't render 28px glyphs without clipping.
        var maxDim = Math.max(cols, rows);
        var fontSize = maxDim >= 7 ? 14 : maxDim >= 6 ? 18 : maxDim >= 5 ? 22 : 36;
        var cells = '';
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                cells += reelCellHtml(fontSize, c + ',' + r);
            }
        }
        return '<div id="liveSlotReels" aria-label="Reels" style="display:grid;' +
            'grid-template-columns:repeat(' + cols + ',1fr);gap:6px;background:#0b0504;' +
            'border:1px solid #f1c40f44;border-radius:10px;padding:12px;margin-bottom:12px;">' +
            cells + '</div>';
    }

    function paytableHeader(def) {
        switch (def.win_type) {
            case 'cluster':
                return 'Cluster of ' + (def.cluster_min || 5) + '+ matching symbols pays:';
            case 'classic':
                return colsOf(def) + ' of a kind on the line pays:';
            case 'payline':
            default:
                return 'Matching symbols left-to-right on a payline:';
        }
    }

    function buildPaytableHtml(def) {
        var pt = def.paytable || {};
        // Catalog payouts use category keys (cluster5/cluster8/...,
        // payline3/4/5, triple/double/wildTriple, scatterPay) rather
        // than per-symbol multipliers. Render the category that
        // matches the game's win_type and skip empty fields.
        var prettyKey = function (k) {
            if (k === 'cluster5')  return 'Cluster 5–7';
            if (k === 'cluster8')  return 'Cluster 8–11';
            if (k === 'cluster12') return 'Cluster 12–14';
            if (k === 'cluster15') return 'Cluster 15+';
            if (k === 'payline3')  return '3 in a row';
            if (k === 'payline4')  return '4 in a row';
            if (k === 'payline5')  return '5 in a row';
            if (k === 'triple')    return 'Three of a kind';
            if (k === 'double')    return 'Two of a kind';
            if (k === 'wildTriple')return 'Three wilds';
            if (k === 'scatterPay')return 'Per scatter';
            return k;
        };
        var keys;
        if (def.win_type === 'cluster') keys = ['cluster5', 'cluster8', 'cluster12', 'cluster15', 'wildTriple', 'scatterPay'];
        else if (def.win_type === 'payline') keys = ['payline3', 'payline4', 'payline5', 'wildTriple', 'scatterPay'];
        else if (def.win_type === 'classic') {
            // Per-symbol pay table on classic single-payline games.
            keys = (def.symbols || []).filter(function (s) { return pt[s] != null; });
            return '<div>' + paytableHeader(def) + '</div>' +
                '<div style="font-family:monospace;margin:6px 0;line-height:1.7">' +
                keys.map(function (sym) {
                    return '<div><span style="color:' + colorFor(sym) + ';font-weight:800;">' +
                        glyphFor(sym) + '</span> ' + sym + ' &times;' + pt[sym] + '</div>';
                }).join('') + '</div>';
        } else {
            keys = Object.keys(pt);
        }
        var rows = keys
            .filter(function (k) { return pt[k] != null && Number(pt[k]) > 0; })
            .map(function (k) {
                return '<div>' + prettyKey(k) + ' &mdash; pays ' +
                    '<span style="color:#fde047;font-weight:800">×' + pt[k] + ' bet</span></div>';
            }).join('');
        var rtp = (typeof def.rtp === 'number') ? (def.rtp * 100).toFixed(2) + '% RTP' : '';
        return '<div>' + paytableHeader(def) + '</div>' +
            '<div style="font-family:monospace;margin:6px 0;line-height:1.7">' + rows + '</div>' +
            (rtp ? '<div style="color:#94a3b8;font-size:11px;">' + rtp + '</div>' : '');
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

                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:#94a3b8;flex-wrap:wrap;">' +
                    '<label for="liveSlotAutoCount">Auto</label>' +
                    '<select id="liveSlotAutoCount" style="padding:6px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                        '<option value="0">Off</option>' +
                        '<option value="10">10×</option>' +
                        '<option value="25">25×</option>' +
                        '<option value="50">50×</option>' +
                        '<option value="100">100×</option>' +
                    '</select>' +
                    '<label for="liveSlotAutoStop" title="Auto stops when a single spin pays at least this much">stop on win ≥ $</label>' +
                    '<input id="liveSlotAutoStop" type="number" step="0.10" min="0" value="0" ' +
                        'style="width:70px;padding:6px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                    '<button id="liveSlotAutoCancel" style="margin-left:auto;padding:6px 10px;border-radius:5px;border:1px solid #374151;background:transparent;color:#cbd5e1;font-size:11px;cursor:pointer;display:none;">Stop</button>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:#94a3b8;flex-wrap:wrap;">' +
                    '<label for="liveSlotAutoLoss" title="Auto stops once net session loss reaches this much">stop on session loss ≥ $</label>' +
                    '<input id="liveSlotAutoLoss" type="number" step="0.10" min="0" value="0" ' +
                        'style="width:70px;padding:6px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                    '<label for="liveSlotAutoFloor" title="Auto stops if balance falls below this">stop if balance &lt; $</label>' +
                    '<input id="liveSlotAutoFloor" type="number" step="0.10" min="0" value="0" ' +
                        'style="width:70px;padding:6px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                '</div>' +

                '<details style="margin-top:8px;color:#94a3b8;font-size:12px;">' +
                    '<summary style="cursor:pointer;outline:none;">Paytable / fairness</summary>' +
                    '<div style="margin-top:8px;line-height:1.55;">' +
                        '<div id="liveSlotPaytable">' + buildPaytableHtml(def) + '</div>' +
                        '<div id="liveSlotCommit" style="margin-top:6px;display:flex;align-items:center;gap:8px;">Commit hash: <span style="font-family:monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">loading…</span><button id="liveSlotRotateBtn" title="Reveal current server seed and roll a fresh one" style="padding:4px 8px;border-radius:5px;border:1px solid #f1c40f55;background:transparent;color:#f1c40f;font-size:11px;font-weight:700;cursor:pointer;">Rotate</button></div>' +
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

    /**
     * Render reel cells. Universal games come back with a 2-D
     * `outcome.grid[col][row]`; tuned games keep the legacy
     * `outcome.stops[i].symbol` (single row). We accept both.
     */
    function paintReels(outcome) {
        var def = state.gameDef;
        var cols = colsOf(def);
        var rows = rowsOf(def);
        var maxDim = Math.max(cols, rows);
        var baseFont = maxDim >= 7 ? 14 : maxDim >= 6 ? 18 : maxDim >= 5 ? 22 : 36;
        function symAt(c, r) {
            if (outcome && Array.isArray(outcome.grid) && outcome.grid[c]) {
                return outcome.grid[c][r];
            }
            // Tuned single-row game: use stops[c].symbol.
            if (r === 0 && outcome && Array.isArray(outcome.stops) && outcome.stops[c]) {
                var s = outcome.stops[c];
                return typeof s === 'string' ? s : s && s.symbol;
            }
            return null;
        }
        for (var c = 0; c < cols; c++) {
            for (var r = 0; r < rows; r++) {
                var sel = '#liveSlotReels [data-cell="' + c + ',' + r + '"]';
                var cell = document.querySelector(sel);
                if (!cell) continue;
                var sym = symAt(c, r);
                cell.textContent = glyphFor(sym);
                cell.style.color = colorFor(sym);
                cell.style.background = '#1a0705';
                var glyph = glyphFor(sym);
                cell.style.fontSize = (glyph.length > 2 ? Math.max(11, baseFont - 6) : baseFont) + 'px';
            }
        }
    }

    function highlightWinningCells(outcome) {
        if (!outcome) return;
        // Universal games attach `outcome.lines` with cluster cells or
        // payline indices; tuned games keep `outcome.line.symbols`.
        var lines = outcome.lines || (outcome.line ? [outcome.line] : []);
        if (!lines.length) return;
        var def = state.gameDef;
        var rows = rowsOf(def);
        function highlight(c, r) {
            var sel = '#liveSlotReels [data-cell="' + c + ',' + r + '"]';
            var cell = document.querySelector(sel);
            if (cell) cell.style.background = 'linear-gradient(180deg,#3d2a08,#1a1004)';
        }
        lines.forEach(function (l) {
            if (Array.isArray(l.cells)) {
                // cluster pays
                l.cells.forEach(function (xy) { highlight(xy[0], xy[1]); });
            } else if (l.scatter && l.count) {
                // any-position scatter pay — highlight all scatter cells
                var cols = colsOf(def);
                var sc = def.scatter_symbol;
                if (!sc || !outcome.grid) return;
                for (var c = 0; c < cols; c++) {
                    for (var r = 0; r < rows; r++) {
                        if (outcome.grid[c] && outcome.grid[c][r] === sc) highlight(c, r);
                    }
                }
            } else if (typeof l.line === 'number' && Number.isFinite(l.length)) {
                // payline run, leftmost-aligned, length cells. The payline
                // index references the canonical 5×3 / 3×3 grid lines.
                // We don't know which row each column lands on without
                // re-deriving the payline; fall back to highlighting the
                // run on row 0 (visually clear that something paid).
                for (var i = 0; i < l.length; i++) highlight(i, 0);
            }
        });
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

    async function rotateCommit() {
        var btn = document.getElementById('liveSlotRotateBtn');
        if (btn) btn.disabled = true;
        var r = await fetchJSON('/api/slot/rotate-commit', { method: 'POST' });
        if (btn) btn.disabled = false;
        if (r.status !== 200) {
            setResult((r.body && r.body.error) || 'Rotate failed.', '#ef4444');
            return;
        }
        // Show the revealed seed transiently in the result line; the
        // Commit display rolls to the new hash.
        state.committedHash = r.body.next_commit && r.body.next_commit.server_seed_hash;
        updateCommitUI();
        setResult('Server seed rotated. Old seed revealed: ' + shortHash(r.body.revealed.server_seed), '#94a3b8');
    }

    function readDollarsCents(id) {
        var input = document.getElementById(id);
        var v = input ? Number(input.value) : 0;
        return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
    }

    function autoStopThresholdCents() { return readDollarsCents('liveSlotAutoStop'); }
    function autoLossLimitCents()     { return readDollarsCents('liveSlotAutoLoss'); }
    function autoBalanceFloorCents()  { return readDollarsCents('liveSlotAutoFloor'); }

    function autoCount() {
        var sel = document.getElementById('liveSlotAutoCount');
        var n = sel ? Number(sel.value) : 0;
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }

    function setAutoUI(running) {
        var cancelBtn = document.getElementById('liveSlotAutoCancel');
        if (cancelBtn) cancelBtn.style.display = running ? '' : 'none';
        ['liveSlotAutoCount', 'liveSlotAutoStop', 'liveSlotAutoLoss', 'liveSlotAutoFloor'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.disabled = running;
        });
    }

    async function runAutoLoop(total) {
        state.autoCancel = false;
        setAutoUI(true);
        var bigWinCents = autoStopThresholdCents();
        var lossLimitCents = autoLossLimitCents();
        var floorCents = autoBalanceFloorCents();
        var sessionLossCents = 0; // cumulative bet - win across the loop, ≥0
        var done = 0;
        var stoppedReason = null;
        for (var i = 0; i < total; i++) {
            if (state.autoCancel) { stoppedReason = 'cancelled'; break; }
            await doSingleSpin(); // sets state.lastResult or null on error
            done = i + 1;
            if (!state.lastResult) { stoppedReason = 'error'; break; }
            var win = Number(state.lastResult.win_cents || 0);
            var bet = Number(state.lastResult.bet_cents || 0);
            var bal = Number(state.lastResult.balance_cents || 0);
            sessionLossCents += (bet - win);
            if (sessionLossCents < 0) sessionLossCents = 0; // never negative — winning sessions don't earn headroom
            if (bigWinCents > 0 && win >= bigWinCents) { stoppedReason = 'big_win'; break; }
            if (lossLimitCents > 0 && sessionLossCents >= lossLimitCents) { stoppedReason = 'loss_cap'; break; }
            if (floorCents > 0 && bal < floorCents) { stoppedReason = 'balance_floor'; break; }
            // Light pacing so the rate limit (30/10s) never trips on
            // a turbo-spin user. ~350ms gives ~3/s — well under cap.
            await new Promise(function (r) { setTimeout(r, 350); });
        }
        setAutoUI(false);
        var spinsLabel = done + ' spin' + (done === 1 ? '' : 's');
        if (stoppedReason === 'big_win') {
            setResult('Auto-spin stopped on a big win after ' + spinsLabel + '.', '#22c55e');
        } else if (stoppedReason === 'loss_cap') {
            setResult('Auto-spin stopped — session loss cap reached after ' + spinsLabel + ' (lost ' + fmt(sessionLossCents) + ').', '#ef4444');
        } else if (stoppedReason === 'balance_floor') {
            setResult('Auto-spin stopped — balance dropped below your floor after ' + spinsLabel + '.', '#ef4444');
        } else if (stoppedReason === 'cancelled') {
            setResult('Auto-spin cancelled after ' + spinsLabel + '.', '#94a3b8');
        } else if (stoppedReason === 'error') {
            // setResult was already updated by doSingleSpin's error path
        } else {
            setResult('Auto-spin done — ' + spinsLabel + ' completed.', '#94a3b8');
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
        // Auto-spin entry: if a count > 0 is selected and we're not
        // already running, kick off the loop. Single-spin click is
        // the natural fall-through.
        var n = autoCount();
        if (n > 0 && !state.spinning) {
            await runAutoLoop(n);
            return;
        }
        await doSingleSpin();
    }

    async function doSingleSpin() {
        if (state.spinning) return;
        var def = state.gameDef;
        var input = document.getElementById('liveSlotBet');
        var dollars = Number(input.value);
        if (!Number.isFinite(dollars) || dollars <= 0) {
            setResult('Enter a valid bet.', '#ef4444');
            state.lastResult = null;
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
            state.lastResult = null;
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
        paintReels(res.body.outcome);
        highlightWinningCells(res.body.outcome);
        if (res.body.win_cents > 0) {
            // Tuned games carry a single `line.multiplier`; universal
            // games carry `lines[]` (zero-or-more cluster/payline hits).
            var msg = 'WIN ' + fmt(res.body.win_cents);
            var line = res.body.outcome && res.body.outcome.line;
            var lines = res.body.outcome && res.body.outcome.lines;
            if (line && line.multiplier) {
                msg += ' (' + line.multiplier + 'x)';
            } else if (Array.isArray(lines) && lines.length) {
                var hits = lines.length === 1 ? '1 line' : lines.length + ' lines';
                msg += ' on ' + hits;
            }
            setResult(msg, '#22c55e');
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
        var rotateBtn = document.getElementById('liveSlotRotateBtn');
        if (rotateBtn) rotateBtn.addEventListener('click', rotateCommit);
        var autoCancelBtn = document.getElementById('liveSlotAutoCancel');
        if (autoCancelBtn) autoCancelBtn.addEventListener('click', function () { state.autoCancel = true; });
        var overlay = document.getElementById('liveSlotModal');
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeLiveSlot();
        });
    }

    function closeLiveSlot() {
        // Cancel any in-flight auto-spin so the loop stops on the next
        // iteration even though the modal is gone.
        state.autoCancel = true;
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
