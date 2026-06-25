/**
 * Battle Pass page logic.
 *
 * Consumes the unified, live battle-pass API (season-based service is canonical):
 *   GET  /api/battle-pass            → season + (if authed) full progress
 *   GET  /api/battle-pass/leaderboard
 *   POST /api/battle-pass/claim      { level, track:'free'|'premium' }
 *   POST /api/battle-pass/purchase   { tier:'premium' }
 *
 * Auth + CSRF are handled by js/api-client.js (window.MatrixSpinsAPI.fetch).
 * Logged-out visitors get a read-only preview (drives sign-up/conversion);
 * logged-in players see progress and can claim / go premium.
 */
(function () {
  'use strict';

  var api = window.MatrixSpinsAPI;
  var $ = function (id) { return document.getElementById(id); };

  var state = { user: null, data: null };

  // ── small DOM helper (safe construction — no innerHTML for dynamic data) ──
  function el(tag, opts, kids) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.class) node.className = opts.class;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.href != null) node.href = opts.href;
    if (opts.disabled) node.disabled = true;
    if (opts.title) node.title = opts.title;
    if (kids) kids.forEach(function (k) { if (k) node.appendChild(k); });
    return node;
  }

  var _toastTimer = null;
  function toast(msg, kind) {
    var t = $('bpToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'bp-toast show' + (kind ? ' ' + kind : '');
    if (_toastTimer) window.clearTimeout(_toastTimer);
    _toastTimer = window.setTimeout(function () { t.className = 'bp-toast'; }, 3200);
  }

  function fmtReward(r) {
    if (!r || !r.type || !(r.amount > 0)) return { text: '—', none: true };
    if (r.type === 'credits') return { text: '$' + Number(r.amount).toFixed(2) + ' bonus' };
    if (r.type === 'free_spins') return { text: r.amount + ' Free Spin' + (r.amount === 1 ? '' : 's') };
    if (r.type === 'wheel_spins') return { text: r.amount + ' Wheel Spin' + (r.amount === 1 ? '' : 's') };
    return { text: r.amount + ' ' + r.type };
  }

  // ── Topbar wiring (page-owned; unified-ux only wires the drawer) ──
  function wireTopbar() {
    var logoutBtn = $('logout');
    var chip = $('balanceChip');
    if (state.user) {
      if (logoutBtn) {
        logoutBtn.textContent = 'Sign out';
        logoutBtn.onclick = function () {
          api.logout().then(function () { window.location.href = 'index.html'; });
        };
      }
      if (chip) {
        chip.style.display = '';
        api.getBalance().then(function (b) {
          chip.textContent = api.formatCents((b && b.availableCents) || 0);
        }).catch(function () {});
      }
      var note = $('bpSignInNote');
      if (note) note.style.display = 'none';
    } else {
      if (chip) chip.style.display = 'none';
      if (logoutBtn) {
        logoutBtn.textContent = 'Sign in';
        logoutBtn.onclick = function () { window.location.href = 'login.html?next=battle-pass.html'; };
      }
      var note2 = $('bpSignInNote');
      if (note2) note2.style.display = '';
    }
  }

  // ── Renderers ──
  function renderHero(d) {
    var season = d.season || {};
    $('bpSeason').textContent = season.name ? season.name : 'Battle Pass';
    $('bpMaxLevel').textContent = '/ ' + (d.max_level || 50);
    $('bpLevel').textContent = (d.level != null ? d.level : 0);

    var hasProgress = (d.level != null);
    if (hasProgress) {
      var into = d.xp != null ? d.xp : 0;
      var need = d.next_level_xp != null ? d.next_level_xp : 0;
      $('bpXp').textContent = need > 0 ? (into + ' / ' + need + ' XP') : 'Max level';
      $('bpBar').style.width = (d.progress_to_next_level != null ? d.progress_to_next_level : 0) + '%';
    } else {
      $('bpXp').textContent = 'Sign in to track XP';
      $('bpBar').style.width = '0%';
    }

    // Premium card
    var priceEl = $('bpPremiumPrice');
    var price = d.premium_price != null ? d.premium_price : 9.99;
    priceEl.textContent = '';
    priceEl.appendChild(document.createTextNode('$' + Number(price).toFixed(2)));
    priceEl.appendChild(el('small', { text: ' / season' }));

    var action = $('bpPremiumAction');
    action.textContent = '';
    if (d.is_premium) {
      action.appendChild(el('div', { class: 'bp-premium-active', text: '✓ Premium active' }));
    } else if (state.user) {
      var buy = el('button', { class: 'btn', text: 'Unlock Premium' });
      buy.onclick = purchasePremium;
      action.appendChild(buy);
    } else {
      var link = el('a', { class: 'btn', text: 'Sign in to unlock', href: 'login.html?next=battle-pass.html' });
      action.appendChild(link);
    }
  }

  function trackNode(label, reward, opts) {
    var wrap = el('div', { class: 'bp-track' + (opts.premium ? ' premium' : '') });
    wrap.appendChild(el('div', { class: 'bp-track-label', text: label }));
    var rf = fmtReward(reward);
    wrap.appendChild(el('div', { class: 'bp-reward' + (rf.none ? ' none' : ''), text: rf.text }));
    if (reward && reward.cosmetic) wrap.appendChild(el('div', { class: 'bp-cosmetic', text: '🎁 ' + reward.cosmetic }));

    if (!rf.none) {
      var btn = buildClaimButton(reward, opts);
      if (btn) wrap.appendChild(btn);
    }
    return wrap;
  }

  function buildClaimButton(reward, opts) {
    // opts: { level, track, reached, claimed, isPremium, loggedIn }
    if (!opts.loggedIn) return null; // preview mode: no claim controls
    if (opts.claimed) {
      return el('button', { class: 'bp-claim claimed', text: 'Claimed ✓', disabled: true });
    }
    if (opts.track === 'premium' && !opts.isPremium) {
      return el('button', { class: 'bp-claim locked', text: 'Premium', disabled: true, title: 'Unlock Premium to claim' });
    }
    if (!opts.reached) {
      return el('button', { class: 'bp-claim locked', text: 'Locked', disabled: true });
    }
    var btn = el('button', { class: 'bp-claim', text: 'Claim' });
    btn.onclick = function () { claim(opts.level, opts.track, btn); };
    return btn;
  }

  function renderTiers(d) {
    var host = $('bpTiers');
    host.textContent = '';
    var tiers = d.tiers || [];
    var loggedIn = !!state.user;
    var isPremium = !!d.is_premium;
    var curLevel = d.level != null ? d.level : -1;
    var claimedFree = d.claimed_free || [];
    var claimedPremium = d.claimed_premium || [];

    tiers.forEach(function (tier) {
      var lvl = tier.level;
      var reached = loggedIn && curLevel >= lvl;
      var card = el('div', { class: 'bp-tier' + (reached ? '' : (loggedIn ? ' is-locked' : '')) + (lvl === curLevel ? ' is-current' : '') });

      var head = el('div', { class: 'bp-tier-head' });
      var lblWrap = el('div', { class: 'bp-tier-lvl' });
      lblWrap.appendChild(document.createTextNode('Level '));
      lblWrap.appendChild(document.createTextNode(String(lvl)));
      head.appendChild(lblWrap);
      var stateLbl = loggedIn ? (reached ? 'Reached' : 'Locked') : '';
      if (stateLbl) head.appendChild(el('span', { class: 'bp-tier-state' + (reached ? ' reached' : ''), text: stateLbl }));
      card.appendChild(head);

      card.appendChild(trackNode('Free', tier.free, {
        level: lvl, track: 'free', reached: reached, isPremium: isPremium, loggedIn: loggedIn,
        claimed: claimedFree.indexOf(lvl) !== -1,
      }));
      card.appendChild(trackNode('Premium', tier.premium, {
        level: lvl, track: 'premium', reached: reached, isPremium: isPremium, loggedIn: loggedIn,
        claimed: claimedPremium.indexOf(lvl) !== -1,
      }));

      host.appendChild(card);
    });
  }

  function renderLeaderboard(rows) {
    var host = $('bpLeaderboard');
    host.textContent = '';
    if (!rows || !rows.length) {
      host.appendChild(el('div', { class: 'bp-skeleton', text: 'No ranked players yet — be the first!' }));
      return;
    }
    var myId = state.user && state.user.id;
    rows.forEach(function (r, i) {
      var row = el('div', { class: 'bp-lb-row' });
      row.appendChild(el('div', { class: 'bp-lb-rank', text: '#' + (i + 1) }));
      var name = el('div', { class: 'bp-lb-name', text: r.username || 'Player' });
      if (myId && r.user_id === myId) name.appendChild(el('span', { class: 'you', text: '(you)' }));
      row.appendChild(name);
      row.appendChild(el('div', { class: 'bp-lb-meta', text: 'Lv ' + (r.level != null ? r.level : 0) + ' · ' + (r.xp != null ? r.xp : 0) + ' XP' }));
      host.appendChild(row);
    });
  }

  // ── Actions ──
  function claim(level, track, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    api.fetch('/battle-pass/claim', { method: 'POST', body: { level: level, track: track } })
      .then(function (res) {
        var rwd = res && res.reward ? fmtReward(res.reward).text : 'reward';
        toast('Claimed ' + rwd + (res && res.reward && res.reward.cosmetic ? ' + ' + res.reward.cosmetic : ''), 'success');
        return reload();
      })
      .catch(function (err) {
        toast(err && err.message ? err.message : 'Claim failed', 'error');
        return reload();
      });
  }

  function purchasePremium() {
    var price = state.data && state.data.premium_price != null ? state.data.premium_price : 9.99;
    if (!window.confirm('Unlock the Premium Battle Pass for $' + Number(price).toFixed(2) + '? This will be charged from your balance.')) return;
    api.fetch('/battle-pass/purchase', { method: 'POST', body: { tier: 'premium' } })
      .then(function () {
        toast('Premium unlocked! Enjoy the full reward track.', 'success');
        return reload();
      })
      .catch(function (err) {
        toast(err && err.message ? err.message : 'Purchase failed', 'error');
      });
  }

  // ── Data load / render ──
  function reload() {
    return Promise.all([
      api.fetch('/battle-pass').catch(function () { return null; }),
      api.fetch('/battle-pass/leaderboard').catch(function () { return { leaderboard: [] }; }),
    ]).then(function (out) {
      var data = out[0];
      var lb = out[1];
      if (!data || data.active === false) {
        $('bpSeason').textContent = 'No active season right now — check back soon.';
        $('bpTiers').textContent = '';
        renderLeaderboard((lb && lb.leaderboard) || []);
        return;
      }
      state.data = data;
      renderHero(data);
      renderTiers(data);
      renderLeaderboard((lb && lb.leaderboard) || []);
      if (state.user) {
        api.getBalance().then(function (b) {
          var chip = $('balanceChip');
          if (chip) chip.textContent = api.formatCents((b && b.availableCents) || 0);
        }).catch(function () {});
      }
    });
  }

  function init() {
    if (!api) { toast('Could not load the battle pass.', 'error'); return; }
    api.loadSession().then(function (user) {
      state.user = user || null;
      wireTopbar();
      return reload();
    }).catch(function () {
      state.user = null;
      wireTopbar();
      return reload();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
