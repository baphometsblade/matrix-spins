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
      };

      this._buildShell();
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
            `${(game.rtp * 100).toFixed(2)}% RTP  •  ${game.volatility || ''} volatility  •  ${game.paylines} lines`
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

      const betMinus = $el('button', { class: 'ce-btn', onclick: () => this._changeBet(-1) }, '−');
      const betPlus  = $el('button', { class: 'ce-btn', onclick: () => this._changeBet(+1) }, '+');
      this.betLabel  = $el('div', { style: {
        padding: '.5rem 1rem', minWidth: '140px', textAlign: 'center',
        border: `1px solid ${primary}55`, borderRadius: '8px', color: primary, fontWeight: 700,
      }}, fmt(this.state.betCents));
      this.spinBtn = $el('button', { class: 'ce-btn primary', onclick: () => this._spin(false) }, 'SPIN');

      [betMinus, this.betLabel, betPlus, this.spinBtn].forEach(b => controlBar.appendChild(b));
      this.main.appendChild(controlBar);

      this.freeSpinsRow = $el('div', { style: { textAlign: 'center', marginTop: '.8rem', fontSize: '.9rem', opacity: .85 } });
      this.main.appendChild(this.freeSpinsRow);
      this._renderFreeSpins();

      this.main.appendChild(this._renderFairnessPanel());

      if (!document.getElementById('ce-style')) {
        const s = document.createElement('style');
        s.id = 'ce-style';
        s.textContent = `
          .ce-btn { padding: .6rem 1rem; background: transparent; color: #fff; border: 1px solid ${primary}66; border-radius: 8px; font: inherit; cursor: pointer; font-weight: 600; }
          .ce-btn:hover { border-color: ${primary}; }
          .ce-btn:disabled { opacity: .4; cursor: not-allowed; }
          .ce-btn.primary { background: linear-gradient(180deg, ${primary}, ${shade(primary,-20)}); color: #1a1205; border: none; font-weight: 800; letter-spacing: 2px; padding: .7rem 2rem; text-transform: uppercase; }
          .ce-cell { aspect-ratio: 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.4rem; color: white; text-shadow: 0 2px 4px rgba(0,0,0,.5); transition: transform .25s; user-select: none; }
          .ce-cell.highlight { animation: ceFlash 0.9s ease-in-out infinite alternate; }
          @keyframes ceFlash { from { transform: scale(1); filter: brightness(1); } to { transform: scale(1.08); filter: brightness(1.35); } }
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

    _updateBalanceChip() {
      this.balanceChip.textContent = fmt(this.state.balanceCents);
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

      const api = window.MatrixSpinsAPI;
      const g = this.state.game;
      const symbols = g.symbols;
      const cells = Array.from(this.reelGrid.querySelectorAll('.ce-cell'));
      cells.forEach(c => c.classList.remove('highlight'));

      const rollInterval = setInterval(() => {
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
        this.winStrip.style.color = '#ffb3b3';
        this.winStrip.textContent = err.message || 'Spin failed.';
        setTimeout(() => { this.winStrip.style.color = this._primary; }, 2000);
        return;
      }

      for (let r = 0; r < g.reels; r++) {
        await new Promise((resolve) => setTimeout(resolve, 240));
        const column = result.reels[r];
        for (let y = 0; y < g.rows; y++) {
          const cellIdx = r * g.rows + y;
          this._renderCell(cells[cellIdx], column[y], r, y);
        }
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

      if (result.payoutCents > 0) {
        this.winStrip.textContent = `Win ${fmt(result.payoutCents)}${result.multiplier !== 1 ? `  ×${result.multiplier}` : ''}`;
      } else {
        this.winStrip.textContent = 'No win — try again';
        this.winStrip.style.opacity = .6;
        setTimeout(() => { this.winStrip.style.opacity = 1; }, 400);
      }

      if (result.freeSpinsAwarded > 0) {
        this.winStrip.textContent += `  •  +${result.freeSpinsAwarded} free spins!`;
      }

      if (typeof result.balanceAfterCents === 'number') {
        this.state.balanceCents = result.balanceAfterCents;
      } else {
        const b = await api.getBalance();
        this.state.balanceCents = b.availableCents;
      }
      this._updateBalanceChip();

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
