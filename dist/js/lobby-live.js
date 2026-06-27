/**
 * Matrix Spins — Lobby Live (3-in-1 self-injecting lobby module)
 *
 * Bundles three real-data lobby features into one defer-loaded module, in the
 * canonical self-injecting widget style of js/daily-missions.js + social-proof.js:
 *
 *   1. "X players online" header pill   — GET /api/players-online (no auth) +
 *                                          live Socket.IO `players:count` events.
 *   2. "Continue Playing" row           — GET /api/game-history/recent?limit=5
 *                                          (logged-in only; empty → renders nothing).
 *   3. "Daily Challenges" card          — GET /api/challenges (logged-in only) +
 *                                          POST /api/challenges/:id/claim (CSRF).
 *
 * NO mock data anywhere. Every value comes from a live endpoint; if an endpoint
 * is unreachable or returns nothing, the relevant piece hides cleanly — the
 * lobby must never break because a non-critical widget failed.
 *
 * Auth: token in localStorage.casinoToken (Bearer). Mutations go through the
 * global window.fetch which js/csrf-helper.js has wrapped to inject the
 * X-CSRF-Token header automatically — same path daily-missions.js relies on.
 *
 * Public API:
 *   window.LobbyLive.refresh()  — re-fetch + re-render all three features.
 */
(function () {
    'use strict';

    if (window.LobbyLive && window.LobbyLive._loaded) return;

    var ONLINE_POLL_MS = 30 * 1000;      // header counter fallback poll (when no socket)
    var CHALLENGES_POLL_MS = 60 * 1000;  // daily-challenges refresh cadence
    var STYLE_ID = 'lobby-live-style';

    var onlinePollTimer = null;
    var challengesTimer = null;
    var liveSocket = null;

    /* ─────────────────────────── helpers ─────────────────────────── */

    function token() {
        try { return localStorage.getItem('casinoToken'); } catch (_) { return null; }
    }
    function isLoggedIn() { return !!token(); }

    function authHeaders() {
        var t = token();
        return t ? { 'Authorization': 'Bearer ' + t } : null;
    }

    function isLobby() {
        var path = window.location.pathname;
        return path === '/' || path === '/index.html' || /\/index\.html$/.test(path);
    }

    function fmtNum(n) {
        var v = parseInt(n, 10);
        if (!v || v < 1) return '0';
        return v.toLocaleString();
    }

    function fmtMoney(v) {
        var n = Number(v) || 0;
        // Show whole dollars without trailing .00, cents otherwise.
        return '$' + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
    }

    function toast(msg, type) {
        if (typeof showToast === 'function') { showToast(msg, type || 'success'); return; }
        // Minimal inline fallback toast.
        var t = document.createElement('div');
        t.className = 'll-toast';
        t.textContent = msg;
        t.setAttribute('role', 'status');
        document.body.appendChild(t);
        // force reflow so the transition runs
        // eslint-disable-next-line no-unused-expressions
        t.offsetWidth;
        t.classList.add('ll-toast-in');
        setTimeout(function () {
            t.classList.remove('ll-toast-in');
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
        }, 2600);
    }

    /* ─────────────────────────── styles ─────────────────────────── */

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            /* ── Feature 1: online counter pill ── */
            '.ll-online-pill{display:inline-flex;align-items:center;gap:7px;',
            '  padding:6px 12px;border-radius:var(--ms-radius-pill,9999px);',
            '  background:var(--ms-green-dim,rgba(34,197,94,0.12));',
            '  border:1px solid rgba(34,197,94,0.32);color:var(--ms-text,#e8e8f0);',
            '  font-size:0.78rem;font-weight:700;line-height:1;white-space:nowrap;',
            '  font-family:var(--ms-font-body,Inter,system-ui,sans-serif);}',
            '.ll-online-pill[hidden]{display:none;}',
            '.ll-online-dot{width:8px;height:8px;border-radius:50%;background:var(--ms-green,#22C55E);',
            '  box-shadow:0 0 8px var(--ms-green,#22C55E);animation:ll-pulse 1.6s ease-in-out infinite;}',
            '.ll-online-num{font-variant-numeric:tabular-nums;}',
            '@keyframes ll-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}',

            /* ── Feature 2: continue-playing row ── */
            '.ll-continue{max-width:1200px;margin:8px auto 4px;padding:0 16px;',
            '  font-family:var(--ms-font-body,Inter,system-ui,sans-serif);}',
            '.ll-continue h2{margin:0 0 12px;font-family:var(--ms-font-display,Oswald,Inter,sans-serif);',
            '  font-size:20px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;',
            '  color:var(--ms-text,#e8e8f0);}',
            '.ll-continue-track{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 12px;',
            '  scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}',
            '.ll-continue-track::-webkit-scrollbar{height:6px;}',
            '.ll-continue-track::-webkit-scrollbar-thumb{background:var(--ms-border-hover,rgba(255,255,255,.12));border-radius:999px;}',
            '.ll-cont-card{flex:0 0 168px;scroll-snap-align:start;border-radius:var(--ms-radius-lg,14px);',
            '  overflow:hidden;background:var(--ms-bg-card,#1e1e2e);border:1px solid var(--ms-border,rgba(255,255,255,.06));',
            '  cursor:pointer;text-align:left;padding:0;color:inherit;font:inherit;display:block;',
            '  transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;}',
            '.ll-cont-card:hover,.ll-cont-card:focus-visible{transform:translateY(-4px);',
            '  border-color:var(--ms-gold,#F0A500);box-shadow:0 10px 26px rgba(0,0,0,.45);outline:none;}',
            '.ll-cont-thumb{position:relative;width:100%;height:100px;background-size:cover;background-position:center;',
            '  display:flex;align-items:center;justify-content:center;}',
            '.ll-cont-thumb-fallback{color:#fff;font-family:var(--ms-font-display,Oswald,Inter,sans-serif);',
            '  font-weight:700;font-size:0.92rem;text-align:center;padding:8px 10px;text-shadow:0 1px 6px rgba(0,0,0,.6);',
            '  text-transform:uppercase;letter-spacing:.04em;line-height:1.2;}',
            '.ll-cont-resume{position:absolute;top:8px;left:8px;background:rgba(10,10,15,.78);',
            '  color:var(--ms-gold-light,#FFD04A);font-size:0.66rem;font-weight:800;padding:3px 8px;',
            '  border-radius:999px;letter-spacing:.04em;backdrop-filter:blur(4px);}',
            '.ll-cont-meta{padding:9px 11px 11px;}',
            '.ll-cont-name{font-size:0.84rem;font-weight:700;color:var(--ms-text,#e8e8f0);',
            '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.ll-cont-spins{font-size:0.7rem;color:var(--ms-text-muted,#66667a);margin-top:3px;}',

            /* ── Feature 3: daily challenges card ── */
            '.ll-challenges{max-width:1200px;margin:20px auto 8px;padding:20px 22px;',
            '  background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));',
            '  border:1px solid rgba(240,165,0,0.18);border-radius:var(--ms-radius-lg,14px);',
            '  color:var(--ms-text,#e8e8f0);font-family:var(--ms-font-body,Inter,system-ui,sans-serif);}',
            '.ll-ch-head{display:flex;align-items:center;justify-content:space-between;gap:12px;',
            '  margin-bottom:14px;flex-wrap:wrap;}',
            '.ll-ch-title{margin:0;font-family:var(--ms-font-display,Oswald,Inter,sans-serif);',
            '  font-size:1.05rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;',
            '  color:var(--ms-gold-light,#FFD04A);}',
            '.ll-ch-streak{font-size:0.74rem;font-weight:700;color:var(--ms-gold,#F0A500);',
            '  background:var(--ms-gold-dim,rgba(240,165,0,0.12));border:1px solid rgba(240,165,0,0.28);',
            '  padding:4px 10px;border-radius:999px;white-space:nowrap;}',
            '.ll-ch-row{display:grid;grid-template-columns:1fr auto;gap:8px 18px;align-items:center;',
            '  padding:11px 0;border-top:1px solid rgba(255,255,255,0.06);}',
            '.ll-ch-row:first-of-type{border-top:none;}',
            '.ll-ch-desc{font-size:0.9rem;font-weight:600;margin-bottom:7px;}',
            '.ll-ch-diff{font-size:0.62rem;text-transform:uppercase;letter-spacing:.06em;font-weight:800;',
            '  margin-left:8px;padding:1px 6px;border-radius:5px;color:var(--ms-bg-darkest,#0a0a0f);',
            '  background:var(--ms-text-muted,#66667a);vertical-align:middle;}',
            '.ll-ch-diff.easy{background:var(--ms-green,#22C55E);}',
            '.ll-ch-diff.medium{background:var(--ms-gold,#F0A500);}',
            '.ll-ch-diff.hard{background:var(--ms-red,#EF4444);color:#fff;}',
            '.ll-ch-barwrap{display:flex;align-items:center;gap:10px;}',
            '.ll-ch-bar{flex:1;height:6px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;}',
            '.ll-ch-fill{height:100%;background:linear-gradient(90deg,var(--ms-gold,#F0A500),var(--ms-gold-light,#FFD04A));',
            '  transition:width 600ms ease;}',
            '.ll-ch-prog{font-size:0.74rem;color:var(--ms-text-secondary,#9595a8);',
            '  font-variant-numeric:tabular-nums;min-width:52px;text-align:right;}',
            '.ll-ch-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}',
            '.ll-ch-reward{font-size:0.76rem;color:var(--ms-gold-light,#FFD04A);font-weight:700;white-space:nowrap;}',
            '.ll-ch-btn{padding:5px 14px;border-radius:8px;border:1px solid rgba(240,165,0,0.4);',
            '  background:linear-gradient(135deg,rgba(240,165,0,0.22),rgba(240,165,0,0.10));',
            '  color:var(--ms-gold-light,#FFD04A);font-weight:700;cursor:pointer;font-size:0.76rem;',
            '  font-family:inherit;transition:filter .15s ease;}',
            '.ll-ch-btn:hover:not(:disabled){filter:brightness(1.18);}',
            '.ll-ch-btn:disabled{opacity:.5;cursor:default;}',
            '.ll-ch-claimed{font-size:0.76rem;color:var(--ms-green,#22C55E);font-weight:700;}',
            '.ll-ch-locked{font-size:0.76rem;color:var(--ms-text-muted,#66667a);}',
            '.ll-ch-teaser{font-size:0.86rem;color:var(--ms-text-secondary,#9595a8);}',
            '.ll-ch-teaser a{color:var(--ms-gold-light,#FFD04A);font-weight:700;text-decoration:none;}',
            '.ll-ch-teaser a:hover{text-decoration:underline;}',

            /* ── fallback toast ── */
            '.ll-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);',
            '  background:var(--ms-bg-elevated,#222236);color:var(--ms-text,#e8e8f0);',
            '  border:1px solid rgba(240,165,0,0.4);border-radius:10px;padding:11px 18px;',
            '  font-size:0.86rem;font-weight:600;z-index:2147483000;opacity:0;pointer-events:none;',
            '  box-shadow:0 8px 28px rgba(0,0,0,.5);transition:opacity .3s ease,transform .3s ease;',
            '  font-family:var(--ms-font-body,Inter,system-ui,sans-serif);}',
            '.ll-toast.ll-toast-in{opacity:1;transform:translate(-50%,0);}',

            /* ── responsive ── */
            '@media (max-width:480px){',
            '  .ll-cont-card{flex-basis:142px;}',
            '  .ll-challenges{margin:16px 12px 8px;padding:16px;}',
            '  .ll-ch-row{grid-template-columns:1fr;}',
            '  .ll-ch-right{flex-direction:row;align-items:center;justify-content:space-between;width:100%;}',
            '}',
            '@media (prefers-reduced-motion: reduce){',
            '  .ll-online-dot{animation:none;}',
            '  .ll-cont-card,.ll-ch-fill,.ll-toast{transition:none;}',
            '}'
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ════════════════ Feature 1 — online counter ════════════════ */

    var onlinePill = null;

    function ensureOnlinePill() {
        if (onlinePill && onlinePill.isConnected) return onlinePill;
        var trust = document.querySelector('.header-trust');
        if (!trust) return null;
        onlinePill = document.createElement('div');
        onlinePill.className = 'll-online-pill';
        onlinePill.setAttribute('role', 'status');
        onlinePill.setAttribute('aria-live', 'polite');
        onlinePill.setAttribute('aria-label', 'Players online now');
        onlinePill.hidden = true;
        var dot = document.createElement('span');
        dot.className = 'll-online-dot';
        dot.setAttribute('aria-hidden', 'true');
        var num = document.createElement('span');
        num.className = 'll-online-num';
        var lbl = document.createElement('span');
        lbl.textContent = 'playing now';
        onlinePill.appendChild(dot);
        onlinePill.appendChild(num);
        onlinePill.appendChild(document.createTextNode(' '));
        onlinePill.appendChild(lbl);
        trust.appendChild(onlinePill);
        return onlinePill;
    }

    function renderOnline(online) {
        var pill = ensureOnlinePill();
        if (!pill) return;
        var n = parseInt(online, 10) || 0;
        if (n <= 0) { pill.hidden = true; return; }   // never show 0 awkwardly
        var num = pill.querySelector('.ll-online-num');
        if (num) num.textContent = fmtNum(n);
        pill.setAttribute('aria-label', fmtNum(n) + ' players playing now');
        pill.hidden = false;
    }

    function pollOnline() {
        fetch('/api/players-online', { credentials: 'omit' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) { if (data) renderOnline(data.online); })
            .catch(function () { /* silent — counter is non-critical */ });
    }

    function startOnlineSocket() {
        // Reuse an already-open jackpot socket if present, else lazily load the client.
        function attach(socket) {
            if (!socket) return false;
            try {
                socket.on('players:count', function (msg) {
                    if (msg && typeof msg.online !== 'undefined') renderOnline(msg.online);
                });
                return true;
            } catch (_) { return false; }
        }

        if (window.__jackpotSocket && attach(window.__jackpotSocket)) {
            liveSocket = window.__jackpotSocket;
            return true;
        }
        if (typeof io === 'function') {
            try {
                liveSocket = io({ transports: ['websocket', 'polling'], reconnection: true });
                attach(liveSocket);
                return true;
            } catch (_) { return false; }
        }
        return false;
    }

    function initOnline() {
        if (!ensureOnlinePill()) return;
        pollOnline();                         // immediate first paint from REST
        var socketed = startOnlineSocket();   // upgrade to live events if possible
        if (!socketed) {
            // No socket available — fall back to polling every 30s.
            if (onlinePollTimer) clearInterval(onlinePollTimer);
            onlinePollTimer = setInterval(pollOnline, ONLINE_POLL_MS);
        }
    }

    /* ════════════════ Feature 2 — continue playing ════════════════ */

    var continueRow = null;

    function buildContinueCard(game) {
        var card = document.createElement('a');
        card.className = 'll-cont-card';
        card.href = game.url || '#';
        card.setAttribute('aria-label', 'Continue playing ' + (game.name || 'game'));

        var thumb = document.createElement('div');
        thumb.className = 'll-cont-thumb';
        if (game.thumbnail) {
            thumb.style.backgroundImage = "url('" + String(game.thumbnail).replace(/'/g, '%27') + "')";
        } else {
            // Themed gradient fallback derived from the game name (deterministic hue).
            var hue = 0, name = game.name || game.slug || 'Game';
            for (var i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
            thumb.style.background = 'linear-gradient(135deg,hsl(' + hue + ',58%,30%),hsl(' + ((hue + 40) % 360) + ',62%,18%))';
            var fb = document.createElement('span');
            fb.className = 'll-cont-thumb-fallback';
            fb.textContent = name;
            thumb.appendChild(fb);
        }
        var resume = document.createElement('span');
        resume.className = 'll-cont-resume';
        resume.textContent = '▶ Continue';
        thumb.appendChild(resume);

        var meta = document.createElement('div');
        meta.className = 'll-cont-meta';
        var nm = document.createElement('div');
        nm.className = 'll-cont-name';
        nm.textContent = game.name || game.slug || 'Game';
        var sp = document.createElement('div');
        sp.className = 'll-cont-spins';
        var spins = parseInt(game.spins, 10) || 0;
        sp.textContent = spins > 0 ? (fmtNum(spins) + (spins === 1 ? ' spin' : ' spins')) : 'Recently played';
        meta.appendChild(nm);
        meta.appendChild(sp);

        card.appendChild(thumb);
        card.appendChild(meta);
        return card;
    }

    function renderContinue(games) {
        if (!games || !games.length) { hideContinue(); return; }

        if (!continueRow || !continueRow.isConnected) {
            var anchor = document.querySelector('.games-section');
            if (!anchor || !anchor.parentNode) return;
            continueRow = document.createElement('section');
            continueRow.className = 'll-continue';
            continueRow.setAttribute('aria-label', 'Continue playing');
            anchor.parentNode.insertBefore(continueRow, anchor);
        }
        while (continueRow.firstChild) continueRow.removeChild(continueRow.firstChild);

        var h2 = document.createElement('h2');
        h2.textContent = 'Continue Playing';
        continueRow.appendChild(h2);

        var track = document.createElement('div');
        track.className = 'll-continue-track';
        games.slice(0, 5).forEach(function (g) { track.appendChild(buildContinueCard(g)); });
        continueRow.appendChild(track);
    }

    function hideContinue() {
        if (continueRow && continueRow.parentNode) {
            continueRow.parentNode.removeChild(continueRow);
            continueRow = null;
        }
    }

    function refreshContinue() {
        var headers = authHeaders();
        if (!headers) { hideContinue(); return; }
        fetch('/api/game-history/recent?limit=5', { headers: headers })
            .then(function (r) {
                if (r.status === 401) { hideContinue(); return null; }
                return r.ok ? r.json() : null;
            })
            .then(function (data) {
                if (!data) return;
                renderContinue(data.games || []);
            })
            .catch(function () { /* silent — non-critical */ });
    }

    /* ════════════════ Feature 3 — daily challenges ════════════════ */

    var challengesCard = null;

    function ensureChallengesCard() {
        if (challengesCard && challengesCard.isConnected) return challengesCard;
        challengesCard = document.createElement('section');
        challengesCard.className = 'll-challenges';
        challengesCard.setAttribute('aria-label', 'Daily challenges');
        var anchor = document.querySelector('.how-it-works');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(challengesCard, anchor);
        } else {
            var games = document.querySelector('.games-section');
            if (games && games.parentNode) games.parentNode.insertBefore(challengesCard, games);
            else document.body.appendChild(challengesCard);
        }
        return challengesCard;
    }

    function buildChallengesHeader(streak) {
        var head = document.createElement('div');
        head.className = 'll-ch-head';
        var title = document.createElement('h2');
        title.className = 'll-ch-title';
        title.textContent = 'Daily Challenges';
        head.appendChild(title);
        var cur = streak && parseInt(streak.current_streak, 10) ? parseInt(streak.current_streak, 10) : 0;
        if (cur > 0) {
            var chip = document.createElement('span');
            chip.className = 'll-ch-streak';
            chip.textContent = '🔥 ' + cur + (cur === 1 ? ' day streak' : ' day streak');
            head.appendChild(chip);
        }
        return head;
    }

    function rewardText(c) {
        var parts = [];
        var credits = Number(c.reward_credits) || 0;
        var gems = parseInt(c.reward_gems, 10) || 0;
        if (credits > 0) parts.push('+' + fmtMoney(credits));
        if (gems > 0) parts.push('+' + gems + '💎');
        return parts.join('  ');
    }

    function buildChallengeRow(c) {
        var row = document.createElement('div');
        row.className = 'll-ch-row';

        var left = document.createElement('div');
        var desc = document.createElement('div');
        desc.className = 'll-ch-desc';
        desc.textContent = c.description || ('Challenge: ' + (c.challenge_type || ''));
        var diff = (c.difficulty || '').toString().toLowerCase();
        if (diff) {
            var dEl = document.createElement('span');
            dEl.className = 'll-ch-diff ' + (diff === 'easy' || diff === 'medium' || diff === 'hard' ? diff : '');
            dEl.textContent = diff;
            desc.appendChild(dEl);
        }
        left.appendChild(desc);

        var barwrap = document.createElement('div');
        barwrap.className = 'll-ch-barwrap';
        var target = Math.max(1, Number(c.target) || 1);
        var progress = Math.max(0, Number(c.progress) || 0);
        var pct = Math.min(100, Math.round((progress / target) * 100));
        var bar = document.createElement('div');
        bar.className = 'll-ch-bar';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(Math.round(target)));
        bar.setAttribute('aria-valuenow', String(Math.min(Math.round(progress), Math.round(target))));
        var fill = document.createElement('div');
        fill.className = 'll-ch-fill';
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        var prog = document.createElement('span');
        prog.className = 'll-ch-prog';
        prog.textContent = Math.min(Math.round(progress), Math.round(target)) + ' / ' + Math.round(target);
        barwrap.appendChild(bar);
        barwrap.appendChild(prog);
        left.appendChild(barwrap);

        var right = document.createElement('div');
        right.className = 'll-ch-right';
        var rwd = document.createElement('div');
        rwd.className = 'll-ch-reward';
        rwd.textContent = rewardText(c);
        right.appendChild(rwd);

        if (c.claimed) {
            var done = document.createElement('span');
            done.className = 'll-ch-claimed';
            done.textContent = 'Claimed ✓';
            right.appendChild(done);
        } else if (c.completed) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'll-ch-btn';
            btn.textContent = 'Claim';
            btn.setAttribute('aria-label', 'Claim reward for ' + (c.description || 'challenge'));
            btn.addEventListener('click', function () { claimChallenge(c.id, btn); });
            right.appendChild(btn);
        } else {
            var lock = document.createElement('span');
            lock.className = 'll-ch-locked';
            lock.textContent = 'In progress';
            right.appendChild(lock);
        }

        row.appendChild(left);
        row.appendChild(right);
        return row;
    }

    function claimChallenge(id, btn) {
        var headers = authHeaders();
        if (!headers) return;
        btn.disabled = true;
        btn.textContent = '…';
        // window.fetch is CSRF-wrapped by csrf-helper.js — it injects X-CSRF-Token.
        fetch('/api/challenges/' + encodeURIComponent(id) + '/claim', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
        })
            .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
            .then(function (out) {
                if (out.status !== 200 || !out.body || out.body.success === false) {
                    btn.disabled = false;
                    btn.textContent = 'Retry';
                    toast((out.body && out.body.error) || 'Claim failed', 'error');
                    return;
                }
                var bits = [];
                var credits = Number(out.body.credits) || 0;
                var gems = parseInt(out.body.gemsAwarded, 10) || 0;
                if (credits > 0) bits.push(fmtMoney(credits));
                if (gems > 0) bits.push(gems + ' gems');
                toast('Challenge claimed' + (bits.length ? ' — ' + bits.join(' + ') : '') + '!', 'success');
                setTimeout(refreshChallenges, 250);
            })
            .catch(function (err) {
                btn.disabled = false;
                btn.textContent = 'Retry';
                toast('Network error: ' + err.message, 'error');
            });
    }

    function renderChallengesTeaser() {
        var el = ensureChallengesCard();
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(buildChallengesHeader(null));
        var p = document.createElement('p');
        p.className = 'll-ch-teaser';
        var link = document.createElement('a');
        link.href = 'login.html';
        link.textContent = 'Log in';
        p.appendChild(link);
        p.appendChild(document.createTextNode(' to unlock daily challenges & rewards.'));
        el.appendChild(p);
    }

    function renderChallenges(data) {
        var challenges = (data && data.challenges) || [];
        if (!challenges.length) { hideChallenges(); return; }
        var el = ensureChallengesCard();
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(buildChallengesHeader(data.streak));
        challenges.forEach(function (c) { el.appendChild(buildChallengeRow(c)); });
    }

    function hideChallenges() {
        if (challengesCard && challengesCard.parentNode) {
            challengesCard.parentNode.removeChild(challengesCard);
            challengesCard = null;
        }
    }

    function refreshChallenges() {
        var headers = authHeaders();
        if (!headers) { renderChallengesTeaser(); return; }   // subtle login teaser
        fetch('/api/challenges', { headers: headers })
            .then(function (r) {
                if (r.status === 401) { renderChallengesTeaser(); return null; }
                return r.ok ? r.json() : null;
            })
            .then(function (data) {
                if (!data) return;
                renderChallenges(data);
            })
            .catch(function () { /* silent — non-critical */ });
    }

    /* ─────────────────────────── lifecycle ─────────────────────────── */

    function refresh() {
        pollOnline();
        refreshContinue();
        refreshChallenges();
    }

    function init() {
        if (!isLobby()) return;       // lobby home only
        injectStyles();

        initOnline();                 // Feature 1 — always (no auth)
        refreshContinue();            // Feature 2 — logged-in only (self-gates)
        refreshChallenges();          // Feature 3 — teaser when anon

        if (challengesTimer) clearInterval(challengesTimer);
        challengesTimer = setInterval(refreshChallenges, CHALLENGES_POLL_MS);

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) refresh();
        });
    }

    window.LobbyLive = { _loaded: true, refresh: refresh, init: init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
