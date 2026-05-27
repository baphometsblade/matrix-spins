/**
 * Matrix Spins — Daily Missions Lobby Widget
 *
 * Backend route file `server/routes/dailymissions.routes.js` was fully
 * implemented but no frontend consumed it — the scout audit on
 * 2026-05-28 flagged this as the single biggest premium-feel delta
 * per LOC remaining in the codebase. This file is the consumer.
 *
 * Renders a "Today's Missions" card under the hero on the lobby for
 * authenticated players. Three mission rows per day with a progress
 * bar and a Claim button when complete. Server seed-picks the same 3
 * for all players on a given calendar day so the daily-reset feel is
 * shared.
 *
 * Public API:
 *   window.DailyMissions.refresh()  — re-fetch + re-render (call after a
 *                                     spin if you want live progress
 *                                     bars in the same lobby session)
 *
 * The card auto-mounts on DOMContentLoaded if `window.GAME_REGISTRY`
 * has loaded and the player is signed in. If they aren't signed in,
 * the card stays hidden — anon players see a clean lobby without a
 * dead "log in to view" placeholder.
 */
(function () {
    'use strict';

    var MOUNT_SELECTOR = '.how-it-works';  // mount just above "How It Works"
    var POLL_INTERVAL_MS = 60 * 1000;       // refresh every minute while the lobby is open
    var card = null;
    var pollTimer = null;

    function authHeader() {
        var t = null;
        try { t = localStorage.getItem('casinoToken'); } catch (_) {}
        return t ? { 'Authorization': 'Bearer ' + t } : null;
    }

    function fmtMoney(cents) {
        // The dailymissions backend returns reward_amount as dollars (cash),
        // not cents — different convention from /api/spin. Display directly.
        return '$' + (Number(cents) || 0).toFixed(2);
    }

    function rewardLabel(m) {
        if (m.reward_type === 'cash')   return fmtMoney(m.reward_amount);
        if (m.reward_type === 'points') return Number(m.reward_amount) + ' XP';
        return String(m.reward_amount);
    }

    function ensureCard() {
        if (card && card.isConnected) return card;
        card = document.createElement('section');
        card.className = 'daily-missions-card reveal';
        card.setAttribute('aria-label', "Today's missions");
        card.style.cssText = [
            'max-width: 1100px',
            'margin: 24px auto 8px',
            'padding: 20px 22px',
            'background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
            'border: 1px solid rgba(212, 168, 83, 0.18)',
            'border-radius: 14px',
            'color: var(--text-primary, #F0F0F5)',
        ].join(';');

        var anchor = document.querySelector(MOUNT_SELECTOR);
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(card, anchor);
        } else {
            // Fallback: append to main content
            var main = document.querySelector('.main') || document.body;
            main.appendChild(card);
        }
        return card;
    }

    function buildHeader(date) {
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;';
        var title = document.createElement('h2');
        title.textContent = "Today's Missions";
        title.style.cssText = 'margin:0;font-size:1.05rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--accent-gold-bright,#F0C66E);';
        var sub = document.createElement('span');
        sub.textContent = 'Resets at midnight UTC';
        sub.style.cssText = 'font-size:0.75rem;color:var(--text-muted,#8B95A8);';
        head.appendChild(title);
        head.appendChild(sub);
        return head;
    }

    function buildMissionRow(mission) {
        var row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:10px 18px;align-items:center;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);';

        var left = document.createElement('div');
        left.style.cssText = 'min-width:0;';
        var label = document.createElement('div');
        label.textContent = mission.label;
        label.style.cssText = 'font-size:0.92rem;font-weight:600;margin-bottom:6px;';
        left.appendChild(label);

        // Progress bar
        var barWrap = document.createElement('div');
        barWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';
        var bar = document.createElement('div');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(mission.target));
        bar.setAttribute('aria-valuenow', String(Math.min(mission.progress, mission.target)));
        bar.style.cssText = 'flex:1;height:6px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;';
        var fill = document.createElement('div');
        var pct = Math.min(100, Math.round((mission.progress / Math.max(1, mission.target)) * 100));
        fill.style.cssText = 'width:' + pct + '%;height:100%;background:linear-gradient(90deg, var(--accent-gold,#D4A853), var(--accent-gold-bright,#F0C66E));transition:width 600ms ease;';
        bar.appendChild(fill);
        var progressTxt = document.createElement('span');
        progressTxt.textContent = Math.min(mission.progress, mission.target) + ' / ' + mission.target;
        progressTxt.style.cssText = 'font-size:0.78rem;color:var(--text-secondary,#9CA3AF);font-variant-numeric:tabular-nums;min-width:54px;text-align:right;';
        barWrap.appendChild(bar);
        barWrap.appendChild(progressTxt);
        left.appendChild(barWrap);

        // Right column — reward + claim button
        var right = document.createElement('div');
        right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;';
        var reward = document.createElement('div');
        reward.textContent = rewardLabel(mission);
        reward.style.cssText = 'font-size:0.78rem;color:var(--accent-gold-bright,#F0C66E);font-weight:700;';
        right.appendChild(reward);

        if (mission.claimed) {
            var done = document.createElement('span');
            done.textContent = '✓ Claimed';
            done.style.cssText = 'font-size:0.78rem;color:var(--accent-green,#4ADE80);';
            right.appendChild(done);
        } else if (mission.completed) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Claim';
            btn.setAttribute('aria-label', 'Claim ' + mission.label + ' reward');
            btn.style.cssText = 'padding:5px 14px;border-radius:8px;border:1px solid rgba(212,168,83,0.4);background:linear-gradient(135deg,rgba(212,168,83,0.22),rgba(212,168,83,0.10));color:var(--accent-gold-bright,#F0C66E);font-weight:700;cursor:pointer;font-size:0.78rem;';
            btn.addEventListener('click', function () { claimMission(mission.slot, btn); });
            right.appendChild(btn);
        } else {
            var status = document.createElement('span');
            status.textContent = 'In progress';
            status.style.cssText = 'font-size:0.78rem;color:var(--text-muted,#8B95A8);';
            right.appendChild(status);
        }

        row.appendChild(left);
        row.appendChild(right);
        return row;
    }

    function claimMission(slot, btn) {
        var headers = authHeader();
        if (!headers) return;
        btn.disabled = true;
        btn.textContent = '…';
        fetch('/api/dailymissions/claim/' + encodeURIComponent(slot), {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (out) {
            if (out.status !== 200) {
                btn.disabled = false;
                btn.textContent = 'Retry';
                var err = out.body && out.body.error ? out.body.error : 'Claim failed';
                if (typeof showToast === 'function') showToast(err, 'error');
                return;
            }
            // Success — surface a toast + refresh the card.
            var rewardText = out.body.reward_type === 'cash'
                ? fmtMoney(out.body.reward_amount) + ' bonus credited'
                : Number(out.body.reward_amount) + ' XP earned';
            if (typeof showToast === 'function') showToast('Mission complete — ' + rewardText, 'success');
            // Defer the refetch slightly so the server's UPDATE has settled.
            setTimeout(function () { refresh(); }, 250);
        })
        .catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Retry';
            if (typeof showToast === 'function') showToast('Network error: ' + err.message, 'error');
        });
    }

    function render(data) {
        var el = ensureCard();
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(buildHeader(data.date));
        if (!data.missions || data.missions.length === 0) {
            var empty = document.createElement('p');
            empty.textContent = "Today's missions are loading — check back in a moment.";
            empty.style.cssText = 'margin:8px 0 0;color:var(--text-muted,#8B95A8);';
            el.appendChild(empty);
            return;
        }
        data.missions.forEach(function (m) { el.appendChild(buildMissionRow(m)); });
    }

    function hide() {
        if (card && card.parentNode) {
            card.parentNode.removeChild(card);
            card = null;
        }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function refresh() {
        var headers = authHeader();
        if (!headers) { hide(); return; }
        fetch('/api/dailymissions', { headers: headers })
            .then(function (r) {
                if (r.status === 401) { hide(); return null; }
                return r.json();
            })
            .then(function (data) {
                if (!data) return;
                render(data);
            })
            .catch(function (err) {
                // Silent — daily missions are non-critical. The lobby should
                // never break because the missions API is unreachable.
                if (window.console) console.warn('[DailyMissions] refresh error:', err.message);
            });
    }

    function init() {
        // Only mount on the lobby home page. Game pages and account pages
        // have their own information density — surfacing missions there
        // would compete with primary content.
        var path = window.location.pathname;
        var isLobby = path === '/' || path === '/index.html' || /\/index\.html$/.test(path);
        if (!isLobby) return;

        refresh();
        // Refresh every minute so a progress increment from a spin in a
        // background tab eventually surfaces. The lobby auth lifecycle
        // already handles token expiry; no need to layer that here.
        pollTimer = setInterval(refresh, POLL_INTERVAL_MS);

        // Wire a custom event so other modules (e.g. casino-engine after a
        // spin) can trigger a manual refresh without polling.
        window.addEventListener('daily-missions:refresh', refresh);
    }

    window.DailyMissions = { refresh: refresh, hide: hide, init: init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
