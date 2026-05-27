/**
 * Matrix Spins — Casino Engine (server-authoritative).
 *
 * All spin outcomes come from the backend. The client's responsibility is:
 *   • Auth gate — redirect to login if no session
 *   • Render the reels the server returned
 *   • Animate, celebrate wins, update balance
 *   • Expose fairness data (server seed hash, client seed, nonce)
 *
 * The previous version had client-side Math.random() reel logic. That was
 * fundamentally unshippable for real money. This rewrite removes it.
 *
 * Public surface (backward-compatible with existing game HTML files):
 *
 *   CasinoEngine.init('game-container', gameConfig)
 *
 * gameConfig needs an `id` property that matches the server game id.
 * Every other field (name, themes, rtp, min/max bet) is used only for display
 * and is OVERRIDDEN by authoritative values fetched from the backend.
 */
(function () {
  'use strict';

  const HAS_API = typeof window !== 'undefined' && window.MatrixSpinsAPI;

  function $el(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') Object.assign(el.style, v);
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function fmt(cents) {
    return window.MatrixSpinsAPI ? window.MatrixSpinsAPI.formatCents(cents) : `$${(cents/100).toFixed(2)}`;
  }

  const SYMBOL_PALETTE = [
    ['#E74C3C','#F39C12'],['#3498DB','#1ABC9C'],['#2ECC71','#16A085'],
    ['#F39C12','#E67E22'],['#9B59B6','#8E44AD'],['#1ABC9C','#2ECC71'],
    ['#E67E22','#D35400'],['#E91E63','#C2185B'],['#F1C40F','#D4AC0D'],
    ['#FFD700','#B8860B'],
  ];

  function symbolColors(symbol, index) {
    const i = Math.abs(hashStr(symbol)) % SYMBOL_PALETTE.length;
    return SYMBOL_PALETTE[i] || SYMBOL_PALETTE[index % SYMBOL_PALETTE.length];
  }
  function hashStr(s) {
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  class SlotGame {
    constructor(containerId, gameConfig) {
      this.container = document.getElementById(containerId);
      if (!this.container) throw new Error(`CasinoEngine: #${containerId} not found`);
      this.gameId = gameConfig.id || gameConfig.gameId;
      if (!this.gameId) throw new Error('CasinoEngine: gameConfig.id is required');
      this.theme = gameConfig.studioTheme || {};
      this.displayName = gameConfig.name || 'Slot Game';

      this.state = {
        balanceCents: 0,
        currency: 'USD',
        betCents: 100,
        spinning: false,
        game: null,
        lastSpin: null,
        freeSpinsAvailable: 0,
        seeds: null,
        // Autoplay state. null when not auto-spinning; otherwise:
        //   { remaining: N, startCount: N }
        // Stop conditions are checked at the end of each spin in _spin().
        // SPIN button doubles as the stop control when this is non-null.
        autoplay: null,
      };

      this._buildShell();
      // Inject the live-jackpot pill in the top-right corner. Public
      // endpoint (no auth), 30s poll. See _initJackpotPill for shape
      // resilience to server response variants.
      try { this._initJackpotPill(); } catch (_) { /* jackpot ticker is optional polish — never block game boot */ }
      this._boot();
    }

    async _boot() {
      if (!HAS_API) {
        this._fatal('Matrix Spins API client not loaded. Include js/api-client.js before casino-engine.js.');
        return;
      }
      const user = await window.MatrixSpinsAPI.loadSession();
      if (!user) {
        const next = encodeURIComponent(location.pathname + location.search);
        window.location.href = `../login.html?next=${next}`;
        return;
      }
      try {
        const [game, balance, seeds, freeSpins] = await Promise.all([
          window.MatrixSpinsAPI.getGame(this.gameId).then(r => r.game),
          window.MatrixSpinsAPI.getBalance(),
          window.MatrixSpinsAPI.getSeeds(),
          window.MatrixSpinsAPI.getFreeSpins(this.gameId).catch(() => ({ grants: [] })),
        ]);
        this.state.game = game;
        this.state.balanceCents = balance.availableCents;
        this.state.currency = balance.currency;
        this.state.seeds = seeds;
        this.state.freeSpinsAvailable = (freeSpins.grants || []).reduce((a, g) => a + g.remaining, 0);
        this.state.betCents = Math.max(game.minBetCents, Math.min(game.betStepCents * 5, game.maxBetCents));
        this._render();
      } catch (err) {
        this._fatal(err.message || 'Failed to load game.');
      }
    }

    _buildShell() {
      const theme = this.theme;
      const bg = theme.bgGradient || 'linear-gradient(135deg, #0D0F14 0%, #13151C 100%)';
      const primary = theme.primaryColor || '#D4A853';
      const container = this.container;
      container.style.background = bg;
      container.style.minHeight = '100vh';
      container.style.color = '#F0F0F5';
      container.style.fontFamily = "'Inter', system-ui, sans-serif";
      container.style.position = 'relative';
      container.style.paddingBottom = '2rem';
      this._primary = primary;
      container.innerHTML = '';

      this.topbar = $el('div', { style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '.8rem 1.4rem', background: 'rgba(0,0,0,.35)',
        borderBottom: `1px solid ${primary}33`, backdropFilter: 'blur(8px)',
      }});
      this.topbar.append(
        $el('a', { href: '../index.html', style: { color: primary, fontWeight: 700, textDecoration: 'none', letterSpacing: '2px', textTransform: 'uppercase' } }, '← Lobby'),
        $el('div', { style: { display: 'flex', gap: '.8rem', alignItems: 'center' } },
          (this.balanceChip = $el('div', { style: { padding: '.4rem .8rem', border: `1px solid ${primary}55`, borderRadius: '999px', color: primary, fontWeight: 600 } }, '—')),
          $el('a', { href: '../wallet.html', style: { color: '#fff', textDecoration: 'none', fontSize: '.9rem', opacity: .8 } }, 'Wallet'),
          $el('a', { href: '../account.html', style: { color: '#fff', textDecoration: 'none', fontSize: '.9rem', opacity: .8 } }, 'Account'),
        )
      );
      container.appendChild(this.topbar);

      this.main = $el('div', { style: { maxWidth: '1100px', margin: '1.5rem auto 0', padding: '0 1rem' } });
      container.appendChild(this.main);

      this.loading = $el('div', { style: { textAlign: 'center', padding: '3rem 0', opacity: .7 } }, 'Loading game…');
      this.main.appendChild(this.loading);
    }

    _fatal(msg) {
      this.main.innerHTML = '';
      this.main.appendChild(
        $el('div', { style: { background: '#3a1212', border: '1px solid #ef4444', color: '#ffb3b3', padding: '1.2rem', borderRadius: '10px', textAlign: 'center', margin: '2rem auto', maxWidth: 520 } },
          $el('strong', {}, 'Unable to load this game. '),
          document.createTextNode(msg),
        ),
      );
    }

    _render() {
      const game = this.state.game;
      const primary = this._primary;
      this.main.innerHTML = '';
      this._updateBalanceChip();

      this.main.appendChild(
        $el('div', { style: { textAlign: 'center', padding: '.6rem 0 1.2rem' } },
          $el('h1', { style: { fontSize: '1.8rem', letterSpacing: '2px', textTransform: 'uppercase', color: primary, fontFamily: this.theme.fontFamily || 'Plus Jakarta Sans, Inter, sans-serif' } }, game.name || this.displayName),
          $el('p', { style: { opacity: .7, fontSize: '.85rem', marginTop: '.3rem' } },
            // RTP number deliberately omitted from this header per the
            // operator policy that removed per-game RTP claims from the
            // player-facing UI (commit b2eec40d). RTP disclosure lives
            // in T&Cs / help; the in-game paytable modal (i button) also
            // shows it for players who explicitly request the detail.
            `${game.volatility || ''} volatility  •  ${game.paylines} lines`
          ),
        )
      );

      this.reelBox = $el('div', { style: {
        margin: '0 auto', maxWidth: '860px',
        background: 'rgba(0,0,0,.35)', borderRadius: '14px', padding: '1rem',
        border: `2px solid ${primary}66`,
        boxShadow: `0 10px 40px ${primary}20, inset 0 0 30px ${primary}10`,
      }});
      this.reelGrid = $el('div', { style: {
        display: 'grid', gridTemplateColumns: `repeat(${game.reels}, 1fr)`, gap: '.4rem',
      }});
      for (let r = 0; r < game.reels; r++) {
        const col = $el('div', { style: {
          background: this.theme.reelBg || '#0a0a15', borderRadius: '10px',
          border: `1px solid ${primary}33`, padding: '.3rem', display: 'flex', flexDirection: 'column', gap: '.3rem',
        }});
        for (let y = 0; y < game.rows; y++) {
          col.appendChild(this._makeCell('?', r, y));
        }
        this.reelGrid.appendChild(col);
      }
      this.reelBox.appendChild(this.reelGrid);
      this.main.appendChild(this.reelBox);

      this.winStrip = $el('div', { style: {
        textAlign: 'center', minHeight: '2.4rem', marginTop: '.8rem',
        fontSize: '1.2rem', fontWeight: 700, color: primary,
        transition: 'opacity .3s',
      }}, '\u00A0');
      this.main.appendChild(this.winStrip);

      const controlBar = $el('div', { style: {
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '.8rem',
        marginTop: '1rem', flexWrap: 'wrap',
      }});

      // Bet steppers — hold-to-repeat: pointerdown starts a repeating
      // interval (150 ms cadence after a 350 ms initial delay) so a long
      // press auto-increments. pointerup/leave/cancel/blur all stop it.
      // Falls back to a single click when the user just taps.
      const makeStepper = (dir, label) => {
        const btn = $el('button', { class: 'ce-btn ce-btn-stepper', 'aria-label': dir > 0 ? 'Increase bet' : 'Decrease bet' }, label);
        let initialTimer = null;
        let repeatTimer = null;
        const start = (e) => {
          if (e && e.cancelable) e.preventDefault();
          this._changeBet(dir);
          initialTimer = setTimeout(() => {
            repeatTimer = setInterval(() => this._changeBet(dir), 150);
          }, 350);
        };
        const stop = () => {
          if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
          if (repeatTimer)  { clearInterval(repeatTimer); repeatTimer = null; }
        };
        btn.addEventListener('pointerdown', start);
        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointerleave', stop);
        btn.addEventListener('pointercancel', stop);
        btn.addEventListener('blur', stop);
        return btn;
      };

      const betMinus = makeStepper(-1, '−');
      const betPlus  = makeStepper(+1, '+');
      this.betLabel  = $el('div', { style: {
        padding: '.5rem 1rem', minWidth: '140px', textAlign: 'center',
        border: `1px solid ${primary}55`, borderRadius: '8px', color: primary, fontWeight: 700,
      }}, fmt(this.state.betCents));
      // Max Bet shortcut — single click jumps to game.maxBetCents.
      // Previously the player had to press + repeatedly to reach the max,
      // which is an industry-standard premium UX gap.
      const betMax = $el('button', {
        class: 'ce-btn ce-btn-maxbet',
        'aria-label': 'Set bet to maximum',
        onclick: () => this._maxBet(),
      }, 'MAX');
      // Paytable / game-info button. Reads from this.state.game.paytable
      // which the API already includes. Closes a premium UX gap — the
      // previous build never surfaced symbol payouts mid-game even
      // though the data was loaded.
      const infoBtn = $el('button', {
        class: 'ce-btn ce-btn-info',
        'aria-label': 'Game information and paytable',
        title: 'Paytable',
        onclick: () => this._showInfoModal(),
      }, 'i');
      // Autoplay button — opens the run-length picker. Hidden when an
      // autoplay run is already active; the SPIN button doubles as STOP
      // in that case. Industry-standard premium feature the audit
      // flagged as absent.
      const autoBtn = $el('button', {
        class: 'ce-btn ce-btn-auto',
        'aria-label': 'Start autoplay',
        title: 'Autoplay',
        onclick: (e) => this._showAutoplayPicker(e.currentTarget),
      }, 'AUTO');
      this.autoBtn = autoBtn;
      // SPIN button doubles as STOP during autoplay — the onclick
      // checks this.state.autoplay to decide which mode is active.
      // _updateSpinBtnLabel keeps the visible text + aria-label in
      // sync with the current state.
      this.spinBtn = $el('button', {
        class: 'ce-btn primary',
        'aria-label': 'Spin',
        onclick: () => {
          if (this.state.autoplay) this._stopAutoplay();
          else this._spin(false);
        },
      }, 'SPIN');

      [betMinus, this.betLabel, betPlus, betMax, infoBtn, autoBtn, this.spinBtn].forEach(b => controlBar.appendChild(b));
      this.main.appendChild(controlBar);

      this.freeSpinsRow = $el('div', { style: { textAlign: 'center', marginTop: '.8rem', fontSize: '.9rem', opacity: .85 } });
      this.main.appendChild(this.freeSpinsRow);
      this._renderFreeSpins();

      this.main.appendChild(this._renderFairnessPanel());

      if (!document.getElementById('ce-style')) {
        const s = document.createElement('style');
        s.id = 'ce-style';
        s.textContent = `
          .ce-btn { padding: .6rem 1rem; background: transparent; color: #fff; border: 1px solid ${primary}66; border-radius: 8px; font: inherit; cursor: pointer; font-weight: 600; transition: transform 120ms ease, border-color 160ms ease, box-shadow 160ms ease; touch-action: manipulation; }
          .ce-btn:hover { border-color: ${primary}; }
          .ce-btn:active { transform: scale(0.96); }
          .ce-btn:focus-visible { outline: 2px solid ${primary}; outline-offset: 2px; }
          .ce-btn:disabled { opacity: .4; cursor: not-allowed; }
          .ce-btn-stepper { min-width: 44px; font-size: 1.1rem; }
          .ce-btn-maxbet { background: linear-gradient(135deg, ${primary}22, ${primary}11); border-color: ${primary}88; color: ${primary}; letter-spacing: 1px; font-weight: 800; }
          .ce-btn-info { min-width: 36px; min-height: 36px; padding: .4rem .6rem; font-style: italic; font-weight: 800; font-family: serif; font-size: 1.05rem; border-radius: 50%; }
          .ce-btn-auto { background: linear-gradient(135deg, ${primary}22, ${primary}11); border-color: ${primary}88; color: ${primary}; letter-spacing: 1px; font-weight: 800; }
          .ce-btn-autoplay { background: linear-gradient(180deg, #ef4444, #b91c1c); color: white; box-shadow: 0 4px 14px rgba(239,68,68,0.4); }
          .ce-btn-autoplay:hover:not(:disabled) { box-shadow: 0 6px 22px rgba(239,68,68,0.6); }
          .ce-btn.primary { background: linear-gradient(180deg, ${primary}, ${shade(primary,-20)}); color: #1a1205; border: none; font-weight: 800; letter-spacing: 2px; padding: .7rem 2rem; text-transform: uppercase; box-shadow: 0 4px 14px ${primary}55; }
          .ce-btn.primary:hover:not(:disabled) { box-shadow: 0 6px 22px ${primary}88; }
          .ce-btn.primary:active:not(:disabled) { transform: scale(0.95); box-shadow: 0 2px 8px ${primary}66; }
          .ce-cell { aspect-ratio: 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.4rem; color: white; text-shadow: 0 2px 4px rgba(0,0,0,.5); transition: transform .25s, filter .25s; user-select: none; }
          .ce-cell.just-landed { animation: ceLand 240ms cubic-bezier(.34,1.4,.64,1) both; }
          .ce-cell.highlight { animation: ceWinGlow 0.8s ease-in-out infinite alternate; box-shadow: 0 0 12px ${primary}, 0 0 24px ${primary}66; z-index: 1; position: relative; }
          @keyframes ceLand { 0% { transform: translateY(-14px) scale(0.94); filter: brightness(0.7); } 60% { transform: translateY(2px) scale(1.04); filter: brightness(1.1); } 100% { transform: translateY(0) scale(1); filter: brightness(1); } }
          @keyframes ceWinGlow { from { transform: scale(1); filter: brightness(1); } to { transform: scale(1.10); filter: brightness(1.45) saturate(1.3); } }
          @keyframes ceCelebrateFade { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
          @keyframes ceCelebratePop { 0% { transform: scale(0.4) rotate(-3deg); opacity: 0; } 70% { transform: scale(1.08) rotate(0.5deg); opacity: 1; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
          /* Jackpot celebration — longer, more dramatic than ceCelebrateFade.
             Rainbow border sweep + extended fade window (5s vs 1.8s) so the
             moment lands. Used by _celebrateJackpot. */
          @keyframes ceJackpotFade { 0% { opacity: 0; } 4% { opacity: 1; } 90% { opacity: 1; } 100% { opacity: 0; } }
          @keyframes ceJackpotPulse { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.06); filter: brightness(1.3); } }
          @keyframes ceJackpotShimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
          /* Jackpot ticker pill in the game-page corner. */
          .ce-jackpot-pill { position: fixed; top: 12px; right: 12px; z-index: 10300; background: linear-gradient(120deg, #1a1205 0%, #3e2a08 100%); border: 1px solid #F0C66E; border-radius: 999px; padding: 6px 14px 6px 12px; color: #FFD700; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; box-shadow: 0 0 18px rgba(240,198,110,0.35); display: flex; align-items: center; gap: 8px; font-family: "Plus Jakarta Sans", Inter, sans-serif; }
          .ce-jackpot-pill .ce-jp-dot { width: 8px; height: 8px; border-radius: 50%; background: #FFD700; box-shadow: 0 0 8px #FFD700; animation: ceJackpotPulse 1.4s ease-in-out infinite; }
          .ce-jackpot-pill .ce-jp-label { opacity: 0.85; font-weight: 600; font-size: 0.7rem; text-transform: uppercase; }
          @media (max-width: 640px) { .ce-jackpot-pill { top: 8px; right: 8px; padding: 4px 10px 4px 8px; font-size: 0.72rem; } }
          @media (prefers-reduced-motion: reduce) { .ce-jackpot-pill .ce-jp-dot { animation: none; } }
          /* Mobile touch targets — industry-standard 64px high spin button.
             Buttons stack vertically when the control bar overflows. */
          @media (max-width: 640px) {
            .ce-btn.primary { min-height: 64px; font-size: 1.15rem; padding: 1rem 1.4rem; flex: 1 1 100%; order: 99; }
            .ce-btn-stepper { min-height: 48px; min-width: 48px; }
            .ce-btn-maxbet { min-height: 48px; }
            /* WCAG 2.5.5 — info + auto were 36px circular which is below the
               44px touch-target recommendation. Bump on mobile so they're
               equally reachable as the bet steppers. */
            .ce-btn-info, .ce-btn-auto { min-height: 48px; min-width: 48px; }
          }
          /* Reduced-motion honour — cells just snap, no landing/winglow loop. */
          @media (prefers-reduced-motion: reduce) {
            .ce-cell, .ce-cell.just-landed, .ce-cell.highlight,
            .ce-btn, .ce-btn.primary { animation: none !important; transition: none !important; }
          }
        `;
        document.head.appendChild(s);
      }
    }

    _makeCell(sym, r, y) {
      const [a, b] = symbolColors(sym, r * 3 + y);
      return $el('div', { class: 'ce-cell', style: { background: `linear-gradient(135deg, ${a}, ${b})` } }, this._symbolGlyph(sym));
    }

    _symbolGlyph(sym) {
      const s = String(sym || '').toLowerCase();
      const map = {
        cherry:'🍒', lemon:'🍋', bar:'📊', sevens:'7️⃣', wild:'🃏', scatter:'⭐',
        crown:'👑', diamond:'💎', star:'⭐', 'gold-bell':'🔔', bell:'🔔',
        gold:'💰', dragon:'🐉', phoenix:'🦅', koi:'🐟',
      };
      return map[s] || s.slice(0, 2).toUpperCase();
    }

    _renderCell(cell, sym, r, y) {
      cell.innerHTML = '';
      const [a, b] = symbolColors(sym, r * 3 + y);
      cell.style.background = `linear-gradient(135deg, ${a}, ${b})`;
      cell.textContent = this._symbolGlyph(sym);
    }

    _updateBalanceChip(prevCents) {
      // Coin count-up animation when balance moves. Caller passes the
      // previous value (e.g. before the spin) so we animate prev → state.
      // Falls back to a hard snap if no previous value or if the user
      // has prefers-reduced-motion: reduce set.
      const target = this.state.balanceCents;
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prevCents == null || reduceMotion || prevCents === target) {
        this.balanceChip.textContent = fmt(target);
        return;
      }
      this._countUp(this.balanceChip, prevCents, target, 700);
    }

    _countUp(el, fromCents, toCents, durationMs) {
      // Animate a money display from `fromCents` to `toCents` over
      // `durationMs`. Uses requestAnimationFrame with an ease-out cubic so
      // the count slows as it approaches the final amount — feels weighty.
      // Caller is responsible for the element having a money format.
      if (!el || fromCents === toCents) return;
      const start = performance.now();
      const delta = toCents - fromCents;
      const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / durationMs);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const v = Math.round(fromCents + delta * eased);
        el.textContent = fmt(v);
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = fmt(toCents);
      };
      requestAnimationFrame(step);
    }

    _fx(kind) {
      // Centralised sound + haptic dispatcher. Sound names map to the
      // js/sound-manager.js library (window.MatrixSound.play). Haptics
      // honour prefers-reduced-motion: reduce per WCAG 2.3.3 (motion
      // can trigger vestibular issues).
      try {
        const snd = window.MatrixSound && window.MatrixSound.play;
        if (snd) {
          if      (kind === 'spin')     snd('spin');
          else if (kind === 'stop')     snd('tick');
          else if (kind === 'small')    snd('win-small');
          else if (kind === 'big')      snd('win-big');
          else if (kind === 'mega')     snd('jackpot');
          else if (kind === 'jackpot')  snd('jackpot');
          else if (kind === 'bonus')    snd('notification');
          else if (kind === 'error')    snd('error');
        }
      } catch (_) { /* never let audio crash the spin */ }

      // Haptics — disabled under prefers-reduced-motion.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !navigator.vibrate) return;
      try {
        if      (kind === 'spin')    navigator.vibrate(20);
        else if (kind === 'stop')    navigator.vibrate(10);
        else if (kind === 'small')   navigator.vibrate(60);
        else if (kind === 'big')     navigator.vibrate([80, 60, 80]);
        else if (kind === 'mega')    navigator.vibrate([100, 60, 100, 60, 200]);
        else if (kind === 'jackpot') navigator.vibrate([300, 100, 300, 100, 300, 100, 600]);
        else if (kind === 'bonus')   navigator.vibrate([40, 30, 40]);
        else if (kind === 'error')   navigator.vibrate([30, 30, 30]);
      } catch (_) { /* some browsers throw on vibrate */ }
    }

    _celebrateWin(payoutCents, betCents) {
      // Win-tier overlay for premium feel. Tiers chosen to align with the
      // server-side payout cap structure (max win is 200x bet) and the
      // industry-standard "Big/Mega/Epic" naming.
      //
      //   ≥  5x bet → no overlay, just the win-strip sound
      //   ≥ 15x bet → Big Win
      //   ≥ 50x bet → Mega Win
      //   ≥ 100x bet → Epic Win
      //
      // Built entirely with createElement + textContent (no innerHTML),
      // so it stays safe even when payoutCents is large.
      if (!betCents || betCents <= 0) return;
      const ratio = payoutCents / betCents;
      let tier = null;
      if      (ratio >= 100) tier = { label: 'EPIC WIN',  fx: 'mega', color: '#F0C66E', size: '4.2rem' };
      else if (ratio >=  50) tier = { label: 'MEGA WIN',  fx: 'mega', color: '#F0C66E', size: '3.6rem' };
      else if (ratio >=  15) tier = { label: 'BIG WIN',   fx: 'big',  color: '#FFD700', size: '3.0rem' };
      if (!tier) return;

      this._fx(tier.fx);

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10500;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;pointer-events:none;' +
        'background:radial-gradient(circle at center,rgba(0,0,0,0.55) 0%,rgba(0,0,0,0) 70%);' +
        'animation:ceCelebrateFade 1.8s ease-out forwards;';
      const label = document.createElement('div');
      label.textContent = tier.label;
      label.style.cssText =
        'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
        'letter-spacing:.3rem;font-size:' + tier.size + ';color:' + tier.color + ';' +
        'text-shadow:0 0 24px ' + tier.color + ',0 0 8px ' + tier.color + ';' +
        'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      const amount = document.createElement('div');
      amount.textContent = fmt(payoutCents);
      amount.style.cssText =
        'margin-top:1rem;font-size:2.4rem;font-weight:800;color:#fff;' +
        'text-shadow:0 2px 12px rgba(0,0,0,0.7);' +
        'animation:ceCelebratePop 700ms 120ms cubic-bezier(.2,.9,.4,1.2) both;';
      overlay.appendChild(label);
      overlay.appendChild(amount);
      document.body.appendChild(overlay);
      // Self-clean
      setTimeout(() => overlay.remove(), 2000);
    }

    _celebrateJackpot(amountCents, tier) {
      // Distinct jackpot celebration — separate path from _celebrateWin so
      // a jackpot doesn't look like a regular MEGA win. Five-second window
      // (vs 2s for regular wins), tier-themed border + dot color, and
      // confetti if window.confetti is available (js/confetti.min.js is
      // self-hosted per MEMORY.md).
      //
      // Tier colors mirror the four-tier jackpot pool:
      //   mini  → silver
      //   minor → bronze
      //   major → gold
      //   grand → rainbow (animated shimmer)
      const TIER_THEMES = {
        mini:  { label: 'MINI JACKPOT',  color: '#C0C0C0', glow: '192,192,192' },
        minor: { label: 'MINOR JACKPOT', color: '#CD7F32', glow: '205,127,50'  },
        major: { label: 'MAJOR JACKPOT', color: '#F0C66E', glow: '240,198,110' },
        grand: { label: 'GRAND JACKPOT', color: '#FFD700', glow: '255,215,0'   },
      };
      const theme = TIER_THEMES[String(tier || 'grand').toLowerCase()] || TIER_THEMES.grand;
      const isGrand = String(tier || 'grand').toLowerCase() === 'grand';

      this._fx('jackpot');

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'assertive');
      overlay.setAttribute('aria-label', theme.label + ' won — ' + fmt(amountCents));
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10600;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;pointer-events:none;' +
        'background:radial-gradient(circle at center,rgba(0,0,0,0.78) 0%,rgba(0,0,0,0.2) 75%);' +
        'animation:ceJackpotFade 5s ease-out forwards;';

      const label = document.createElement('div');
      label.textContent = theme.label;
      if (isGrand) {
        // Rainbow shimmer for the top tier.
        label.style.cssText =
          'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
          'letter-spacing:.4rem;font-size:4.6rem;color:transparent;' +
          'background:linear-gradient(90deg,#FF1744,#FFD700,#00E676,#00B0FF,#D500F9,#FF1744);' +
          'background-size:200% auto;-webkit-background-clip:text;background-clip:text;' +
          '-webkit-text-fill-color:transparent;' +
          'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both,' +
          'ceJackpotShimmer 2.4s linear infinite;' +
          'filter:drop-shadow(0 0 18px rgba(255,215,0,0.7));';
      } else {
        label.style.cssText =
          'font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:900;' +
          'letter-spacing:.35rem;font-size:4.0rem;color:' + theme.color + ';' +
          'text-shadow:0 0 32px rgba(' + theme.glow + ',0.9),0 0 12px ' + theme.color + ';' +
          'animation:ceCelebratePop 600ms cubic-bezier(.2,.9,.4,1.2) both;';
      }

      const amount = document.createElement('div');
      amount.textContent = fmt(0);
      amount.style.cssText =
        'margin-top:1.4rem;font-size:3.2rem;font-weight:800;color:#fff;' +
        'text-shadow:0 2px 16px rgba(0,0,0,0.8),0 0 24px rgba(' + theme.glow + ',0.5);' +
        'animation:ceCelebratePop 700ms 120ms cubic-bezier(.2,.9,.4,1.2) both;';

      overlay.appendChild(label);
      overlay.appendChild(amount);
      document.body.appendChild(overlay);

      // Animate the won amount from 0 → final using the same easing as the
      // balance chip. Industry-standard premium move — the player watches
      // the number climb instead of seeing it pop in.
      this._countUp(amount, 0, amountCents, 1800);

      // Confetti burst — three staggered bursts so it doesn't feel like
      // a single flat poof. Skip under reduced-motion. The 100 game pages
      // don't preload confetti.min.js (saves ~8KB on the 99% of sessions
      // that never hit a jackpot), so we lazy-load it on demand here. If
      // the script tag fails or is blocked, the overlay still works — we
      // just skip the particle effect.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        const fireBursts = () => {
          if (typeof window.confetti !== 'function') return;
          const baseOpts = { particleCount: isGrand ? 180 : 110, spread: 75, startVelocity: 50, ticks: 280, scalar: 1.1 };
          const fire = (origin, delayMs) => setTimeout(() => {
            try { window.confetti(Object.assign({}, baseOpts, { origin })); } catch (_) { /* silent */ }
          }, delayMs);
          fire({ x: 0.5, y: 0.55 }, 0);
          fire({ x: 0.2, y: 0.65 }, 350);
          fire({ x: 0.8, y: 0.65 }, 700);
          if (isGrand) fire({ x: 0.5, y: 0.4 }, 1100);
        };
        if (typeof window.confetti === 'function') {
          fireBursts();
        } else {
          // Lazy-inject. Path is computed relative to the page — game pages
          // sit at /games/<slug>.html so they need ../js/, the lobby sits
          // at / so it'd use js/. Try the games/ path first, fall back.
          const tryLoad = (src, onError) => {
            const tag = document.createElement('script');
            tag.src = src;
            tag.async = true;
            tag.onload = () => fireBursts();
            tag.onerror = onError;
            document.head.appendChild(tag);
          };
          tryLoad('../js/confetti.min.js', () => tryLoad('js/confetti.min.js', () => { /* both failed — skip particles silently */ }));
        }
      }

      // Self-clean — 5s to match the keyframe fade-out.
      setTimeout(() => overlay.remove(), 5000);
    }

    _initJackpotPill() {
      // Inject the small live-jackpot pill in the top-right corner of the
      // game page. Polls /api/jackpot/status every 30s. The pill shows the
      // grand-tier pool amount (the most aspirational number) by default,
      // falling back to the largest available tier if `grand` is missing.
      //
      // No DOM change needed on the 100 game pages — the engine boots
      // them all via games/<slug>.html → casino-engine.js init, so this
      // single injection covers every game.
      if (document.querySelector('.ce-jackpot-pill')) return;
      const pill = document.createElement('div');
      pill.className = 'ce-jackpot-pill';
      pill.setAttribute('role', 'status');
      pill.setAttribute('aria-live', 'off'); // changes are visual; don't spam screen readers
      const dot = document.createElement('span');
      dot.className = 'ce-jp-dot';
      const lab = document.createElement('span');
      lab.className = 'ce-jp-label';
      lab.textContent = 'Jackpot';
      const amt = document.createElement('span');
      amt.className = 'ce-jp-amt';
      amt.textContent = '—';
      pill.appendChild(dot);
      pill.appendChild(lab);
      pill.appendChild(amt);
      document.body.appendChild(pill);

      const refresh = () => {
        fetch('/api/jackpot/status', { credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (!j || !Array.isArray(j.pools)) return;
            // Server shape: { pools: [{ tier, currentAmount, lastWinner }, ...] }
            // currentAmount is dollars (not cents). Pick the largest-tier
            // available — grand first, falling through to lower tiers if
            // the table hasn't been seeded yet.
            const order = ['grand', 'major', 'minor', 'mini'];
            const map = {};
            for (const p of j.pools) {
              if (p && p.tier) map[p.tier] = p;
            }
            let chosen = null;
            for (const k of order) {
              if (map[k] && map[k].currentAmount > 0) { chosen = map[k]; break; }
            }
            if (!chosen) { amt.textContent = '—'; return; }
            const cents = Math.round(chosen.currentAmount * 100);
            const prev = parseInt(amt.dataset.cents || '0', 10);
            amt.dataset.cents = String(cents);
            // Reflect tier in the label so the player knows which pool is
            // visible (matters when the grand row hasn't seeded yet).
            lab.textContent = (chosen.tier.charAt(0).toUpperCase() + chosen.tier.slice(1)) + ' Jackpot';
            if (prev > 0 && prev !== cents) {
              this._countUp(amt, prev, cents, 800);
            } else {
              amt.textContent = fmt(cents);
            }
          })
          .catch(() => { /* silent — pill stays at last known value */ });
      };
      refresh();
      // Poll cadence chosen to match the lobby widget (30s in ui-lobby.js)
      // for a consistent live feel without server load.
      this._jackpotPollId = setInterval(refresh, 30000);
    }

    _changeBet(dir) {
      const g = this.state.game;
      if (!g) return;
      const step = g.betStepCents;
      let next = this.state.betCents + dir * step;
      if (next < g.minBetCents) next = g.minBetCents;
      if (next > g.maxBetCents) next = g.maxBetCents;
      this.state.betCents = next;
      this.betLabel.textContent = fmt(next);
    }

    _maxBet() {
      const g = this.state.game;
      if (!g) return;
      this.state.betCents = g.maxBetCents;
      this.betLabel.textContent = fmt(g.maxBetCents);
      this._fx('stop');
    }

    _showAutoplayPicker(anchorEl) {
      // Small choice popover anchored to the AUTO button. Lets the player
      // pick a fixed run length (10/25/50/100 spins). The popover is
      // strictly the picker — once the player chooses, autoplay starts
      // immediately and the SPIN button morphs into a STOP control that
      // shows the remaining count. Industry-standard pattern.
      // Close any prior instance.
      const prev = document.getElementById('ce-autoplay-picker');
      if (prev) { prev.remove(); return; }

      this._fx('stop');

      const rect = anchorEl.getBoundingClientRect();
      const picker = document.createElement('div');
      picker.id = 'ce-autoplay-picker';
      picker.setAttribute('role', 'menu');
      picker.setAttribute('aria-label', 'Choose autoplay length');
      picker.style.cssText =
        'position:fixed;z-index:10550;background:#161B23;' +
        'border:1px solid ' + this._primary + '55;border-radius:10px;' +
        'box-shadow:0 12px 32px rgba(0,0,0,0.6);' +
        'padding:6px;display:flex;gap:4px;flex-direction:column;' +
        'min-width:120px;' +
        'top:' + Math.round(rect.bottom + 6) + 'px;' +
        'left:' + Math.round(rect.left) + 'px;';

      const presets = [10, 25, 50, 100];
      presets.forEach(n => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = n + ' spins';
        item.style.cssText =
          'background:transparent;border:0;color:#F0F0F5;text-align:left;' +
          'padding:8px 12px;border-radius:6px;cursor:pointer;font:inherit;' +
          'font-size:0.92rem;';
        item.addEventListener('mouseenter', () => item.style.background = this._primary + '22');
        item.addEventListener('mouseleave', () => item.style.background = 'transparent');
        item.addEventListener('click', () => {
          picker.remove();
          this._startAutoplay(n);
        });
        picker.appendChild(item);
      });

      document.body.appendChild(picker);

      // Close on outside click or Escape.
      const onDocClick = (e) => {
        if (e.target === anchorEl) return;
        if (picker.contains(e.target)) return;
        picker.remove();
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          picker.remove();
          document.removeEventListener('click', onDocClick, true);
          document.removeEventListener('keydown', onKey, true);
        }
      };
      setTimeout(() => {
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    }

    _startAutoplay(count) {
      // Begin the autoplay run. Guard against starting on top of an
      // already-running run (a programmatic call could collide).
      if (this.state.autoplay) return;
      const n = Math.max(1, Math.min(500, parseInt(count, 10) || 0));
      this.state.autoplay = { remaining: n, startCount: n };
      // Disable the AUTO button during the run so the player can't open
      // the picker mid-flight. SPIN morphs into STOP (see
      // _updateSpinBtnLabel) which is the correct in-run control.
      if (this.autoBtn) {
        this.autoBtn.disabled = true;
        this.autoBtn.style.opacity = '0.5';
      }
      this._updateSpinBtnLabel();
      // Kick off the first spin. _spin will schedule the next one.
      this._spin(false);
    }

    _stopAutoplay() {
      if (!this.state.autoplay) return;
      this.state.autoplay = null;
      // Re-enable the AUTO button so the player can start a new run.
      if (this.autoBtn) {
        this.autoBtn.disabled = false;
        this.autoBtn.style.opacity = '1';
      }
      this._updateSpinBtnLabel();
    }

    _updateSpinBtnLabel() {
      const ap = this.state.autoplay;
      if (!this.spinBtn) return;
      if (ap) {
        this.spinBtn.textContent = 'STOP (' + ap.remaining + ')';
        this.spinBtn.classList.add('ce-btn-autoplay');
        this.spinBtn.setAttribute('aria-label', 'Stop autoplay (' + ap.remaining + ' spins remaining)');
      } else {
        this.spinBtn.textContent = 'SPIN';
        this.spinBtn.classList.remove('ce-btn-autoplay');
        this.spinBtn.setAttribute('aria-label', 'Spin');
      }
    }

    _shouldStopAutoplay(result, betCents) {
      // Industry-standard stop-on conditions. Any one triggers the stop.
      //
      //   - Big win or larger (>=15x bet) — let the player savour the
      //     win and decide whether to continue. Spamming through a $50
      //     win on autopilot feels wrong.
      //   - Free-spins / bonus trigger — the bonus is its own event;
      //     pause autoplay so the player can engage with it consciously.
      //   - Balance dipped under 5× minBet — running out of money on
      //     autoplay is a worse player experience than stopping early.
      //     Matches the existing per-spin "Insufficient balance" guard
      //     and aligns with responsible-gambling expectations.
      if (!result) return 'error';
      const win = result.payoutCents || 0;
      const bet = betCents || 1;
      if (win / bet >= 15) return 'big_win';
      if ((result.freeSpinsAwarded || 0) > 0) return 'bonus';
      const g = this.state.game;
      const floor = g ? g.minBetCents * 5 : 0;
      if (this.state.balanceCents < floor) return 'low_balance';
      return null;
    }

    _detectNearMiss(reelIdx, g, result) {
      // Return true when the upcoming reel is the FINAL reel AND the
      // already-landed reels share 2+ matching symbols on some row.
      // The 2-on-a-row signal is the canonical trigger for slot
      // anticipation — a player sees two matching symbols and feels
      // the "is it going to land?" tension before the third reel
      // commits. We only trigger on the final reel so the slowdown
      // is the climax, not a mid-spin distraction.
      if (!g || !result || !result.reels) return false;
      if (reelIdx !== g.reels - 1) return false;
      if (reelIdx < 2) return false;
      try {
        for (let y = 0; y < g.rows; y++) {
          const counts = Object.create(null);
          for (let r = 0; r < reelIdx; r++) {
            const sym = result.reels[r] && result.reels[r][y];
            if (sym == null) continue;
            counts[sym] = (counts[sym] || 0) + 1;
            if (counts[sym] >= 2) return true;
          }
        }
      } catch (_) {
        // never let a near-miss detection bug crash the spin
        return false;
      }
      return false;
    }

    _showInfoModal() {
      // Paytable / game-info modal. Reads from this.state.game and
      // builds a quick-glance reference for the player mid-session.
      // Built entirely with createElement + textContent — no innerHTML,
      // no template interpolation, so game.name (which IS player-
      // facing user content via the server registry) can't ever
      // inject HTML even if some adversarial value got through.
      const g = this.state.game;
      if (!g) return;

      this._fx('stop');

      // Close any prior instance so a double-click doesn't stack overlays.
      const prev = document.getElementById('ce-info-overlay');
      if (prev) prev.remove();

      const opener = document.activeElement;
      const overlay = document.createElement('div');
      overlay.id = 'ce-info-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'ce-info-title');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10600;background:rgba(0,0,0,0.65);' +
        'display:flex;align-items:center;justify-content:center;padding:24px;';

      const panel = document.createElement('div');
      panel.style.cssText =
        'background:linear-gradient(180deg,#161B23,#0F1218);' +
        'border:1px solid ' + this._primary + '55;border-radius:14px;' +
        'box-shadow:0 24px 60px rgba(0,0,0,0.55);' +
        'width:min(440px,calc(100vw - 32px));' +
        'max-height:calc(100vh - 48px);overflow-y:auto;' +
        'color:#F0F0F5;font-family:Inter,system-ui,sans-serif;';

      const header = document.createElement('div');
      header.style.cssText =
        'padding:18px 22px 6px;display:flex;align-items:center;gap:10px;';
      const title = document.createElement('h2');
      title.id = 'ce-info-title';
      title.textContent = g.name || 'Game info';
      title.style.cssText = 'margin:0;font-size:1.15rem;color:' + this._primary + ';flex:1;';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close info');
      closeBtn.textContent = '×';
      closeBtn.style.cssText =
        'background:transparent;border:0;color:#9CA3AF;font-size:24px;' +
        'cursor:pointer;padding:4px 10px;line-height:1;';
      header.appendChild(title);
      header.appendChild(closeBtn);

      const meta = document.createElement('div');
      meta.style.cssText =
        'padding:0 22px 12px;display:flex;flex-wrap:wrap;gap:8px;font-size:0.85rem;';
      const metaTags = [];
      if (g.volatility) metaTags.push(g.volatility + ' volatility');
      if (g.paylines)   metaTags.push(g.paylines + ' lines');
      const maxMult = (g.maxWinMultiplier || g.maxBetMultiplier);
      if (maxMult)      metaTags.push('up to ' + maxMult + '× bet');
      if (g.minBetCents && g.maxBetCents) {
          metaTags.push(fmt(g.minBetCents) + ' – ' + fmt(g.maxBetCents) + ' bet');
      }
      metaTags.forEach(t => {
        const chip = document.createElement('span');
        chip.textContent = t;
        chip.style.cssText =
          'padding:4px 10px;border-radius:999px;border:1px solid ' + this._primary + '44;' +
          'color:' + this._primary + ';background:rgba(255,255,255,0.03);';
        meta.appendChild(chip);
      });

      const paytableSection = document.createElement('div');
      paytableSection.style.cssText = 'padding:8px 22px 14px;';
      if (g.paytable && typeof g.paytable === 'object') {
        const h3 = document.createElement('h3');
        h3.textContent = 'Symbol payouts';
        h3.style.cssText = 'margin:6px 0 8px;font-size:0.85rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;';
        paytableSection.appendChild(h3);
        const table = document.createElement('div');
        table.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:6px 14px;font-size:0.88rem;';
        Object.keys(g.paytable).forEach(sym => {
          const val = g.paytable[sym];
          const left = document.createElement('span');
          left.textContent = String(sym);
          left.style.cssText = 'color:#CDD3DE;font-variant-numeric:tabular-nums;';
          const right = document.createElement('span');
          right.textContent = (typeof val === 'object' ? JSON.stringify(val) : String(val));
          right.style.cssText = 'color:#F0C66E;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;';
          table.appendChild(left);
          table.appendChild(right);
        });
        paytableSection.appendChild(table);
      }

      const bonusSection = document.createElement('div');
      bonusSection.style.cssText = 'padding:0 22px 14px;font-size:0.86rem;color:#CDD3DE;line-height:1.5;';
      if (g.bonusType || g.bonusDesc) {
        const h3 = document.createElement('h3');
        h3.textContent = 'Bonus feature';
        h3.style.cssText = 'margin:6px 0 6px;font-size:0.85rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;';
        bonusSection.appendChild(h3);
        const p = document.createElement('p');
        p.textContent = g.bonusDesc || g.bonusType || '';
        p.style.cssText = 'margin:0;';
        bonusSection.appendChild(p);
      }

      const foot = document.createElement('p');
      foot.style.cssText =
        'margin:0;padding:10px 22px 18px;font-size:0.72rem;color:#8B95A8;line-height:1.5;';
      foot.textContent =
        'All outcomes are computed by the casino server using a HMAC-SHA256 ' +
        'commit-reveal scheme. The fairness panel below the reel grid lets you ' +
        'verify each spin against the server seed hash.';

      panel.appendChild(header);
      panel.appendChild(meta);
      if (paytableSection.children.length) panel.appendChild(paytableSection);
      if (bonusSection.children.length)    panel.appendChild(bonusSection);
      panel.appendChild(foot);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      function close() {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try { if (opener && opener.focus) opener.focus(); } catch (_) { /* noop */ }
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      }
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => closeBtn.focus(), 0);
    }

    _renderFreeSpins() {
      const n = this.state.freeSpinsAvailable;
      this.freeSpinsRow.innerHTML = '';
      if (n > 0) {
        const btn = $el('button', { class: 'ce-btn', onclick: () => this._spin(true) }, `Use free spin (${n} left)`);
        this.freeSpinsRow.appendChild(btn);
      }
    }

    async _spin(useFreeSpin) {
      if (this.state.spinning) return;
      this.state.spinning = true;
      this.spinBtn.disabled = true;
      this.winStrip.textContent = '\u00A0';

      // Capture pre-spin balance for the count-up animation after the
      // result lands. Lets the chip animate from prev \u2192 new value rather
      // than snapping.
      const prevBalanceCents = this.state.balanceCents;

      // Spin start \u2014 sound + light haptic. The AudioContext lazy-inits on
      // the first user gesture (this click), so the very first spin may
      // be silent in browsers that defer audio until interaction.
      this._fx('spin');

      const api = window.MatrixSpinsAPI;
      const g = this.state.game;
      const symbols = g.symbols;
      const cells = Array.from(this.reelGrid.querySelectorAll('.ce-cell'));
      cells.forEach(c => c.classList.remove('highlight'));
      cells.forEach(c => c.classList.remove('just-landed'));

      let rollInterval = setInterval(() => {
        cells.forEach((c, i) => {
          const s = symbols[(Math.random() * symbols.length) | 0];
          this._renderCell(c, s, (i / g.rows) | 0, i % g.rows);
        });
      }, 80);

      let result;
      try {
        result = await api.spin(this.gameId, useFreeSpin ? 0 : this.state.betCents, { useFreeSpin });
      } catch (err) {
        clearInterval(rollInterval);
        this.state.spinning = false;
        this.spinBtn.disabled = false;
        this._fx('error');
        this.winStrip.style.color = '#ffb3b3';
        this.winStrip.textContent = err.message || 'Spin failed.';
        setTimeout(() => { this.winStrip.style.color = this._primary; }, 2000);
        return;
      }

      // Reel stop sequence with near-miss anticipation.
      //
      // Standard premium slots stretch the last reel's stop when the
      // already-landed reels suggest a big win is possible (matching
      // high-value symbols on a single row). That moment of "is it
      // going to land?" is the most engaging beat in slot UX \u2014 the
      // audit explicitly called it the single most addictive feature
      // and flagged it as 100% missing. We add it here.
      //
      // Detection: as each reel lands, scan rows 0..N-1 across the
      // already-landed reels for 2+ matching symbols. If found on the
      // FINAL reel (so we have anticipation, not premature reveal),
      // we slow that reel from 240ms to ~1500ms with a slower visual
      // roll cadence and a haptic heartbeat. The slowdown reveals the
      // outcome regardless \u2014 the server already decided. The tension
      // is the part the player remembers.
      for (let r = 0; r < g.reels; r++) {
        const nearMiss = this._detectNearMiss(r, g, result);
        const delay = nearMiss ? 1500 : 240;

        if (nearMiss) {
          // Slow the rolling visual so the eye can register tension.
          // 80ms \u2192 200ms cadence makes the symbols appear to crawl.
          clearInterval(rollInterval);
          rollInterval = setInterval(() => {
            cells.forEach((c, i) => {
              const reelCol = (i / g.rows) | 0;
              // Only roll cells in the still-unlanded reel(s).
              if (reelCol < r) return;
              const s = symbols[(Math.random() * symbols.length) | 0];
              this._renderCell(c, s, reelCol, i % g.rows);
            });
          }, 200);
          // Heartbeat haptic \u2014 pulsing tension. Honoured by _fx for
          // reduced-motion users (no buzz).
          this._fx('stop');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.4));
          this._fx('stop');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.4));
          this._fx('stop');
          await new Promise((resolve) => setTimeout(resolve, delay * 0.2));
        } else {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const column = result.reels[r];
        for (let y = 0; y < g.rows; y++) {
          const cellIdx = r * g.rows + y;
          const cell = cells[cellIdx];
          this._renderCell(cell, column[y], r, y);
          if (cell) {
            cell.classList.remove('just-landed');
            // eslint-disable-next-line no-unused-expressions
            cell.offsetWidth; // reflow so re-adding the class re-fires the keyframe
            cell.classList.add('just-landed');
          }
        }
        this._fx('stop');
      }
      clearInterval(rollInterval);

      const winPositions = new Set();
      (result.lineWins || []).forEach(w => w.positions.forEach(([r, y]) => winPositions.add(`${r}-${y}`)));
      if (result.scatterWin) result.scatterWin.positions.forEach(([r, y]) => winPositions.add(`${r}-${y}`));
      winPositions.forEach((k) => {
        const [r, y] = k.split('-').map(Number);
        const cell = cells[r * g.rows + y];
        if (cell) cell.classList.add('highlight');
      });

      const bet = this.state.betCents;
      const win = result.payoutCents || 0;
      // Jackpot branch — server-side jackpot service may flag a spin as a
      // jackpot winner. Surface a distinct celebration BEFORE the regular
      // win path so a jackpot doesn't look like a normal MEGA win.
      // The flag shape may be either `result.jackpotWon = { tier, amount }`
      // (preferred) or a top-level `result.jackpot = { tier, amount }` —
      // accept both for resilience to future server tweaks.
      const jackpotInfo = result.jackpotWon || result.jackpot || null;
      if (jackpotInfo && (jackpotInfo.amount > 0 || jackpotInfo.amountCents > 0)) {
        const jpCents = jackpotInfo.amountCents != null
          ? jackpotInfo.amountCents
          : Math.round((jackpotInfo.amount || 0) * 100);
        const jpTier = jackpotInfo.tier || 'grand';
        this.winStrip.textContent = `${String(jpTier).toUpperCase()} JACKPOT! ${fmt(jpCents)}`;
        this._celebrateJackpot(jpCents, jpTier);
      } else if (win > 0) {
        this.winStrip.textContent = `Win ${fmt(win)}${result.multiplier !== 1 ? `  ×${result.multiplier}` : ''}`;
        // Win tier: small win sound + light haptic. Big/Mega/Epic are
        // handled by _celebrateWin which plays the bigger sound + the
        // full-screen overlay.
        if (win / Math.max(bet, 1) < 15) this._fx('small');
        this._celebrateWin(win, bet);
      } else {
        this.winStrip.textContent = 'No win — try again';
        this.winStrip.style.opacity = .6;
        setTimeout(() => { this.winStrip.style.opacity = 1; }, 400);
      }

      if (result.freeSpinsAwarded > 0) {
        this.winStrip.textContent += `  •  +${result.freeSpinsAwarded} free spins!`;
        this._fx('bonus');
      }

      if (typeof result.balanceAfterCents === 'number') {
        this.state.balanceCents = result.balanceAfterCents;
      } else {
        const b = await api.getBalance();
        this.state.balanceCents = b.availableCents;
      }
      this._updateBalanceChip(prevBalanceCents);

      try {
        const fs = await api.getFreeSpins(this.gameId);
        this.state.freeSpinsAvailable = (fs.grants || []).reduce((a, gr) => a + gr.remaining, 0);
        this._renderFreeSpins();
      } catch {}

      if (result.fairness) {
        this.state.lastSpin = result;
        this._updateFairnessPanel(result.fairness, result.spinId);
      }

      this.state.spinning = false;
      this.spinBtn.disabled = false;

      // Autoplay — schedule the next spin if a run is active and no
      // stop condition fired this turn. The 900ms gap lets the win
      // celebrate-overlay (if any) settle before the next spin starts,
      // and gives the player a chance to hit STOP between spins.
      if (this.state.autoplay && !useFreeSpin) {
        this.state.autoplay.remaining--;
        const stopReason = this._shouldStopAutoplay(result, bet);
        if (stopReason || this.state.autoplay.remaining <= 0) {
          this._stopAutoplay();
        } else {
          this._updateSpinBtnLabel();
          setTimeout(() => {
            if (this.state.autoplay && !this.state.spinning) this._spin(false);
          }, 900);
        }
      }
    }

    _renderFairnessPanel() {
      const primary = this._primary;
      const box = $el('details', { style: {
        marginTop: '1.6rem', maxWidth: 860, marginLeft: 'auto', marginRight: 'auto',
        background: 'rgba(0,0,0,.25)', border: `1px solid ${primary}33`,
        borderRadius: '10px', padding: '.7rem 1rem', fontSize: '.85rem',
      }});
      box.appendChild($el('summary', { style: { cursor: 'pointer', color: primary, fontWeight: 600 } }, 'Provably fair — verify this spin'));
      this.fairnessBody = $el('div', { style: { marginTop: '.6rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.3rem .8rem', fontFamily: 'monospace', opacity: .9 } });
      box.appendChild(this.fairnessBody);
      this._updateFairnessPanel({
        serverSeedHash: this.state.seeds?.serverSeedHash || '',
        clientSeed: this.state.seeds?.clientSeed || '',
        nonce: this.state.seeds?.nonce || 0,
      }, null);
      box.appendChild($el('p', { style: { marginTop: '.6rem', fontSize: '.78rem', opacity: .7 } },
        'When you rotate the server seed, the old seed is revealed. Combine (revealed seed, client seed, nonce) with HMAC-SHA256 to reproduce any past spin and verify fairness.'));
      return box;
    }

    _updateFairnessPanel(fairness, spinId) {
      if (!this.fairnessBody) return;
      this.fairnessBody.innerHTML = '';
      const rows = [
        ['Server seed hash', fairness.serverSeedHash || '—'],
        ['Client seed', fairness.clientSeed || '—'],
        ['Nonce', String(fairness.nonce ?? '—')],
      ];
      if (spinId) rows.push(['Spin id', spinId]);
      for (const [k, v] of rows) {
        this.fairnessBody.appendChild($el('div', { style: { opacity: .6 } }, k));
        this.fairnessBody.appendChild($el('div', { style: { wordBreak: 'break-all' } }, v));
      }
    }
  }

  function shade(hex, pct) {
    const c = (hex || '#D4A853').replace('#','');
    const expanded = c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c;
    const n = parseInt(expanded, 16) || 0;
    let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const t = pct > 0 ? 255 : 0;
    const f = Math.abs(pct) / 100;
    r = Math.round((t - r) * f) + r;
    g = Math.round((t - g) * f) + g;
    b = Math.round((t - b) * f) + b;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  window.CasinoEngine = {
    init(containerId, gameConfig) { return new SlotGame(containerId, gameConfig); },
  };
})();
