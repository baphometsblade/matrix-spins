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
        cellNodes: null,        // {col,row} -> reel cell element, populated at modal open
        bonusSession: null,     // active free-spin session, mirrored from server
        quickSpin: false,       // turbo / animation skip
        anteEnabled: false,     // ante bet adds 25% cost for boosted bonus
    };

    // Per-game paytable HTML — game definitions don't change at
    // runtime, so the rendered HTML is stable. Cache to skip the
    // string build on repeated openings of the same game.
    var paytableHtmlCache = Object.create(null);

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
        if (paytableHtmlCache[def.id]) return paytableHtmlCache[def.id];
        var html = renderPaytableHtml(def);
        paytableHtmlCache[def.id] = html;
        return html;
    }

    function renderPaytableHtml(def) {
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
                '<div id="liveSlotBonus" style="display:none;font-size:13px;background:rgba(241,196,15,0.08);' +
                    'border:1px solid rgba(241,196,15,0.3);border-radius:6px;padding:6px 10px;margin-bottom:8px;text-align:center;"></div>' +

                buildReelsGrid(def) +

                '<div id="liveSlotResult" style="min-height:22px;text-align:center;font-size:14px;font-weight:700;margin-bottom:12px;color:#fde047;"></div>' +

                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
                    '<label for="liveSlotBet" style="font-size:12px;color:#94a3b8;">Bet</label>' +
                    '<input id="liveSlotBet" type="number" step="0.10" ' +
                        'min="' + minDollars + '" max="' + maxDollars + '" value="' + minDollars + '" ' +
                        'style="width:90px;padding:8px;border-radius:6px;border:1px solid #374151;background:#0b0504;color:#fff;font-weight:700;">' +
                    '<button id="liveSlotSpin" style="flex:1;padding:12px;border-radius:8px;border:none;' +
                        'background:linear-gradient(135deg,#c0392b 0%,#f1c40f 100%);color:#111;font-weight:900;font-size:16px;letter-spacing:1px;cursor:pointer;">SPIN</button>' +
                '</div>' +

                // Bet shortcuts: 25% / 50% / MAX of the user's balance,
                // clamped to game's min/max. Industry-standard quick-bet
                // controls. The MIN button drops to game's floor.
                '<div id="liveSlotBetShortcuts" style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;">' +
                    '<button class="ls-bet-shortcut" data-pct="min" style="flex:1;padding:5px;border-radius:5px;border:1px solid #374151;background:transparent;color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer;">MIN</button>' +
                    '<button class="ls-bet-shortcut" data-pct="0.25" style="flex:1;padding:5px;border-radius:5px;border:1px solid #374151;background:transparent;color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer;">25%</button>' +
                    '<button class="ls-bet-shortcut" data-pct="0.5" style="flex:1;padding:5px;border-radius:5px;border:1px solid #374151;background:transparent;color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer;">50%</button>' +
                    '<button class="ls-bet-shortcut" data-pct="max" style="flex:1;padding:5px;border-radius:5px;border:1px solid #374151;background:transparent;color:#94a3b8;font-size:11px;font-weight:700;cursor:pointer;">MAX</button>' +
                '</div>' +

                // Industry-standard premium controls: quick-spin toggle
                // (animation skip), ante bet (+25% bet, easier bonus
                // trigger and bigger free-spin count), buy bonus
                // (instantly enter free spins for 100× bet).
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:11px;color:#94a3b8;">' +
                    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;">' +
                        '<input type="checkbox" id="liveSlotQuickSpin"> Turbo' +
                    '</label>' +
                    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;" title="Pay 25% extra; bonus trigger drops to 2 scatters and free-spin count is +50%.">' +
                        '<input type="checkbox" id="liveSlotAnte"> Ante (+25%)' +
                    '</label>' +
                    '<button id="liveSlotBuyBonus" style="margin-left:auto;padding:6px 10px;border-radius:5px;border:1px solid #f1c40f55;background:rgba(241,196,15,0.08);color:#f1c40f;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.5px;">BUY BONUS &middot; 100×</button>' +
                    '<button id="liveSlotInfo" style="padding:6px 10px;border-radius:5px;border:1px solid #374151;background:transparent;color:#cbd5e1;font-size:11px;font-weight:700;cursor:pointer;" title="Game info, paytable, paylines, RTP">i</button>' +
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
     * Industry-standard win-celebration tiers. Threshold ratios match
     * Pragmatic / NetEnt convention:
     *   ≥10× bet  → "BIG WIN"
     *   ≥25× bet  → "MEGA WIN"
     *   ≥50× bet  → "EPIC WIN"
     *   ≥100× bet → "MAX WIN"
     *
     * Renders an animated overlay with the tier label and the win
     * amount counting up. Tap-to-dismiss; auto-clears after 3.5s.
     */
    function showWinCelebration(winCents, betCents) {
        if (!winCents || !betCents) return;
        var ratio = winCents / betCents;
        var tier = null, color = '#22c55e';
        if (ratio >= 100) { tier = 'MAX WIN';  color = '#fde047'; }
        else if (ratio >= 50)  { tier = 'EPIC WIN'; color = '#a855f7'; }
        else if (ratio >= 25)  { tier = 'MEGA WIN'; color = '#22d3ee'; }
        else if (ratio >= 10)  { tier = 'BIG WIN';  color = '#22c55e'; }
        if (!tier) return;
        var existing = document.getElementById('liveSlotWinCelebration');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        var card = document.getElementById('liveSlotCard');
        if (!card) return;
        var el = document.createElement('div');
        el.id = 'liveSlotWinCelebration';
        el.style.cssText = [
            'position:absolute', 'inset:0',
            'display:flex', 'flex-direction:column',
            'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.78)',
            'border-radius:14px', 'cursor:pointer',
            'animation:lsCelebrationIn 0.4s ease-out',
            'z-index:5',
        ].join(';');
        el.innerHTML =
            '<div style="font-size:28px;font-weight:900;letter-spacing:2px;color:' + color + ';' +
                'text-shadow:0 0 30px ' + color + 'aa, 0 4px 20px rgba(0,0,0,0.6);' +
                'animation:lsCelebrationPulse 1.4s ease-in-out infinite;">' + tier + '</div>' +
            '<div id="liveSlotWinCelebrationAmount" style="font-size:42px;font-weight:900;color:#fff;margin-top:6px;' +
                'text-shadow:0 4px 20px rgba(0,0,0,0.7);">$0.00</div>' +
            '<div style="font-size:11px;color:#94a3b8;margin-top:14px;letter-spacing:1px;">' +
                Math.round(ratio) + '× BET &middot; tap to dismiss' +
            '</div>';
        // Position relative to card for inset:0 to mean "fill the card"
        var origPos = window.getComputedStyle(card).position;
        if (origPos === 'static') card.style.position = 'relative';
        card.appendChild(el);
        // Count-up animation
        var amountEl = document.getElementById('liveSlotWinCelebrationAmount');
        var startTs = Date.now();
        var dur = state.quickSpin ? 600 : 1500;
        function tick() {
            var t = Math.min(1, (Date.now() - startTs) / dur);
            // ease-out cubic
            var eased = 1 - Math.pow(1 - t, 3);
            var v = Math.round(winCents * eased);
            if (amountEl) amountEl.textContent = fmt(v);
            if (t < 1) requestAnimationFrame(tick);
        }
        tick();
        var dismiss = function () { if (el && el.parentNode) el.parentNode.removeChild(el); };
        el.addEventListener('click', dismiss);
        setTimeout(dismiss, dur + (state.quickSpin ? 1500 : 3500));
    }

    // Inject the keyframes once at module load — much smaller than
    // shipping a full-blown CSS file.
    (function injectCelebrationStyles() {
        if (document.getElementById('lsCelebrationStyles')) return;
        var s = document.createElement('style');
        s.id = 'lsCelebrationStyles';
        s.textContent =
            '@keyframes lsCelebrationIn{from{opacity:0;transform:scale(0.92);}to{opacity:1;transform:scale(1);}}' +
            '@keyframes lsCelebrationPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.07);}}';
        document.head.appendChild(s);
    })();

    /**
     * Render reel cells. Universal games come back with a 2-D
     * `outcome.grid[col][row]`; tuned games keep the legacy
     * `outcome.stops[i].symbol` (single row). We accept both.
     */
    // Cache reel cell DOM nodes once at modal open so paintReels()
    // and highlightWinningCells() don't pay a querySelector on every
    // cell on every spin. A 7×7 grid was running 49 selectors per
    // spin; this drops to one map lookup per cell.
    function cacheCellNodes() {
        state.cellNodes = Object.create(null);
        var nodes = document.querySelectorAll('#liveSlotReels .ls-reel');
        for (var i = 0; i < nodes.length; i++) {
            var key = nodes[i].getAttribute('data-cell');
            if (key) state.cellNodes[key] = nodes[i];
        }
    }
    function cellAt(c, r) {
        return state.cellNodes ? state.cellNodes[c + ',' + r] : null;
    }

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
                var cell = cellAt(c, r);
                if (!cell) continue;
                var sym = symAt(c, r);
                var glyph = glyphFor(sym);
                cell.textContent = glyph;
                cell.style.color = colorFor(sym);
                cell.style.background = '#1a0705';
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
            var cell = cellAt(c, r);
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
            // Quick-spin halves the pacing.
            await new Promise(function (r) { setTimeout(r, state.quickSpin ? 180 : 350); });
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
        if (state.cellNodes) {
            for (var key in state.cellNodes) {
                var cell = state.cellNodes[key];
                cell.textContent = '☄';
                cell.style.color = '#f1c40f';
            }
        }

        // Don't echo the client seed back — let the server use the
        // persistent value the user set via the "Your client seed"
        // panel. The post-spin response's `revealed.client_seed`
        // remains the source of truth for "what was actually used".
        // If we're inside a free-spin session, send the session id and
        // skip the bet — the server won't debit.
        var spinBody;
        if (state.bonusSession) {
            spinBody = { bonus_session_id: state.bonusSession.id };
        } else {
            spinBody = { game_id: state.gameId, bet_cents: state.betCents };
            if (state.anteEnabled) spinBody.ante = true;
        }
        var res = await fetchJSON('/api/slot/spin', {
            method: 'POST',
            body: spinBody,
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
            // Win celebration tier overlay for ≥10× bet wins.
            // bet_cents on the response is 0 during a free-spin
            // session — fall back to the session's original_bet_cents
            // so the ratio is honest. Skip celebrations during turbo
            // unless the win is genuinely massive.
            var celebBet = Number(res.body.bet_cents)
                || (state.bonusSession && state.bonusSession.original_bet_cents)
                || state.betCents;
            if (celebBet > 0) showWinCelebration(res.body.win_cents, celebBet);
        } else {
            setResult('No win — try again.', '#94a3b8');
        }

        // Commit has rolled — display the NEW unused hash.
        state.committedHash = res.body.next_commit && res.body.next_commit.server_seed_hash;
        updateCommitUI();
        updateRevealedUI();

        var balEl = document.getElementById('liveSlotBalance');
        if (balEl) balEl.textContent = 'Balance: ' + fmt(res.body.balance_cents);

        // Bonus-session lifecycle. The server sends `bonus_session` on
        // every response: null when not in a bonus, an active session
        // when one was just opened or is still running, or a completed
        // session on the final spin. The UI mirrors that state.
        var bs = res.body.bonus_session || null;
        var prevBs = state.bonusSession;
        state.bonusSession = bs && bs.status === 'active' ? bs : null;
        updateBonusUI(bs, prevBs);
    }

    function updateBonusUI(bs, prevBs) {
        var bonusEl = document.getElementById('liveSlotBonus');
        if (!bonusEl) return;
        if (state.bonusSession) {
            bonusEl.style.display = '';
            bonusEl.innerHTML =
                '<span style="color:#fde047;font-weight:800">FREE SPINS</span> &middot; ' +
                state.bonusSession.spins_remaining + ' left &middot; ' +
                'won ' + fmt(state.bonusSession.total_win_cents);
            // Disable bet input while a bonus is running.
            var betInput = document.getElementById('liveSlotBet');
            if (betInput) betInput.disabled = true;
        } else if (bs && bs.status === 'completed') {
            bonusEl.style.display = '';
            bonusEl.innerHTML =
                '<span style="color:#22c55e;font-weight:800">BONUS COMPLETE</span> &middot; total ' +
                fmt(bs.total_win_cents) + ' over ' + bs.spins_consumed + ' spins';
            var betInput2 = document.getElementById('liveSlotBet');
            if (betInput2) betInput2.disabled = false;
        } else if (prevBs && !state.bonusSession) {
            // Bonus just ended without a final-status payload — clear UI.
            bonusEl.style.display = 'none';
            var betInput3 = document.getElementById('liveSlotBet');
            if (betInput3) betInput3.disabled = false;
        } else {
            bonusEl.style.display = 'none';
        }
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
        // Bet shortcuts
        document.querySelectorAll('.ls-bet-shortcut').forEach(function (btn) {
            btn.addEventListener('click', function () {
                applyBetShortcut(btn.getAttribute('data-pct'));
            });
        });
        // Turbo / quick spin toggle
        var turboCb = document.getElementById('liveSlotQuickSpin');
        if (turboCb) turboCb.addEventListener('change', function () {
            state.quickSpin = !!turboCb.checked;
        });
        // Ante
        var anteCb = document.getElementById('liveSlotAnte');
        if (anteCb) anteCb.addEventListener('change', function () {
            state.anteEnabled = !!anteCb.checked;
            updateBetMultiplierLabel();
        });
        // Bonus buy
        var buyBtn = document.getElementById('liveSlotBuyBonus');
        if (buyBtn) buyBtn.addEventListener('click', doBuyBonus);
        // Game info
        var infoBtn = document.getElementById('liveSlotInfo');
        if (infoBtn) infoBtn.addEventListener('click', openInfoModal);
    }

    /**
     * Update the bet shortcut buttons' visual hint when ante is on —
     * effective cost is 1.25× the displayed value so the user knows.
     */
    function updateBetMultiplierLabel() {
        var spinBtn = document.getElementById('liveSlotSpin');
        if (!spinBtn) return;
        spinBtn.textContent = state.anteEnabled ? 'SPIN +25%' : 'SPIN';
    }

    /**
     * Bet-shortcut handler. `min` and `max` clamp to the game's range;
     * percentage shortcuts use the user's current balance (read from
     * the displayed amount, since the engine is the source of truth
     * and we don't store balance separately).
     */
    function applyBetShortcut(pct) {
        var input = document.getElementById('liveSlotBet');
        if (!input || !state.gameDef) return;
        var min = state.gameDef.min_bet_cents / 100;
        var max = state.gameDef.max_bet_cents / 100;
        var target;
        if (pct === 'min') target = min;
        else if (pct === 'max') target = max;
        else {
            // Percentage of balance: read from the balance label.
            var balEl = document.getElementById('liveSlotBalance');
            var balCents = balEl ? Number(balEl.dataset.cents || 0) : 0;
            var balDollars = balCents / 100;
            target = balDollars * Number(pct);
        }
        // Clamp to game range; round to step (0.10).
        target = Math.max(min, Math.min(max, target || 0));
        target = Math.max(min, Math.round(target * 10) / 10);
        input.value = target.toFixed(2);
        state.betCents = Math.round(target * 100);
    }

    /**
     * Bonus Buy click. Confirms the price, calls /api/slot/buy-bonus,
     * and on success switches the UI into bonus mode (the next spin
     * is a free spin, no debit).
     */
    async function doBuyBonus() {
        if (state.spinning) return;
        if (state.bonusSession) {
            setResult('Already in a bonus session.', '#94a3b8');
            return;
        }
        var input = document.getElementById('liveSlotBet');
        var dollars = Number(input && input.value);
        if (!Number.isFinite(dollars) || dollars <= 0) {
            setResult('Enter a valid bet first.', '#ef4444');
            return;
        }
        state.betCents = Math.round(dollars * 100);
        var price = state.betCents * 100; // BONUS_BUY_PRICE_MULT
        var ok = window.confirm('Buy free spins for ' + fmt(price) + ' (100× your bet)?');
        if (!ok) return;
        state.spinning = true;
        setResult('Buying bonus…', '#94a3b8');
        var res = await fetchJSON('/api/slot/buy-bonus', {
            method: 'POST',
            body: { game_id: state.gameId, bet_cents: state.betCents },
        });
        state.spinning = false;
        if (res.status !== 200) {
            setResult((res.body && res.body.error) || 'Bonus buy failed.', '#ef4444');
            return;
        }
        if (res.body.bonus_session) {
            state.bonusSession = res.body.bonus_session;
            updateBonusUI(res.body.bonus_session, null);
            setResult('Bonus opened — press Spin to play!', '#fde047');
            // Refresh balance display from the response.
            var balEl = document.getElementById('liveSlotBalance');
            if (balEl) {
                balEl.textContent = 'Balance: ' + fmt(res.body.balance_cents);
                balEl.dataset.cents = String(res.body.balance_cents);
            }
        }
    }

    /**
     * Game-info modal: full paytable, RTP, volatility, bonus
     * description, win-celebration tier thresholds. Renders inside
     * a sub-overlay on top of the live-slot modal.
     */
    function openInfoModal() {
        var existing = document.getElementById('liveSlotInfoModal');
        if (existing) { existing.style.display = 'flex'; return; }
        var def = state.gameDef;
        if (!def) return;
        var modal = document.createElement('div');
        modal.id = 'liveSlotInfoModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;';
        var rtpPct = (def.rtp != null ? (def.rtp * 100).toFixed(2) : '—') + '%';
        var symbolsList = (def.symbols || []).map(function (s) {
            return '<span style="display:inline-block;padding:4px 8px;margin:2px;background:rgba(255,255,255,0.06);border-radius:4px;font-family:monospace;font-size:11px;">' + s + '</span>';
        }).join('');
        modal.innerHTML =
            '<div style="background:#0d1117;border:1px solid #f1c40f55;border-radius:12px;padding:24px;max-width:500px;width:100%;max-height:88vh;overflow:auto;color:#e0e0e0;font-family:system-ui,sans-serif;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">' +
                    '<div><div style="font-size:11px;letter-spacing:2px;color:#f1c40f;">GAME INFO</div>' +
                        '<div style="font-size:18px;font-weight:800;">' + (def.name || def.id) + '</div></div>' +
                    '<button id="liveSlotInfoClose" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;">&times;</button>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:13px;">' +
                    '<div><span style="color:#94a3b8;">RTP</span> <strong>' + rtpPct + '</strong></div>' +
                    '<div><span style="color:#94a3b8;">Grid</span> <strong>' + def.cols + '×' + def.rows + '</strong></div>' +
                    '<div><span style="color:#94a3b8;">Win type</span> <strong>' + def.win_type + '</strong></div>' +
                    '<div><span style="color:#94a3b8;">Bonus</span> <strong>' + (def.bonus_type || '—') + '</strong></div>' +
                '</div>' +
                (def.bonus_desc ? '<div style="font-size:13px;color:#cbd5e1;margin-bottom:14px;line-height:1.5;">' + def.bonus_desc + '</div>' : '') +
                '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">Symbols</div>' +
                '<div style="margin-bottom:14px;">' + symbolsList + '</div>' +
                '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">Paytable</div>' +
                '<div style="margin-bottom:14px;">' + buildPaytableHtml(def) + '</div>' +
                '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">Win tiers</div>' +
                '<div style="font-size:12px;color:#cbd5e1;line-height:1.7;">' +
                    '<div><span style="color:#22c55e;font-weight:800;">BIG WIN</span> &middot; 10× bet</div>' +
                    '<div><span style="color:#22d3ee;font-weight:800;">MEGA WIN</span> &middot; 25× bet</div>' +
                    '<div><span style="color:#a855f7;font-weight:800;">EPIC WIN</span> &middot; 50× bet</div>' +
                    '<div><span style="color:#fde047;font-weight:800;">MAX WIN</span> &middot; 100× bet</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        var closeBtn = document.getElementById('liveSlotInfoClose');
        if (closeBtn) closeBtn.addEventListener('click', function () { modal.style.display = 'none'; });
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.style.display = 'none';
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
        // Cell nodes belong to the removed modal — drop the references
        // so a stale cache can't accidentally bind a re-opened modal's
        // queries to detached DOM.
        state.cellNodes = null;
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
        state.bonusSession = null;
        ensureModal();
        cacheCellNodes();
        wireEvents();
        await Promise.all([
            refreshBalance(),
            refreshCommit(),
            refreshClientSeed(),
            refreshBonusSession(),
        ]);
    }

    async function refreshBonusSession() {
        var r = await fetchJSON('/api/slot/bonus-session');
        if (r.status === 200 && r.body && r.body.bonus_session) {
            // Only restore if the server's active session is for the
            // game we just opened — different game means it's stale to
            // this modal even though it's still live for the user.
            var bs = r.body.bonus_session;
            if (bs.game_id === state.gameId && bs.status === 'active') {
                state.bonusSession = bs;
                updateBonusUI(bs, null);
            }
        }
    }

    window.openLiveSlot = openLiveSlot;
    window.closeLiveSlot = closeLiveSlot;
})();
