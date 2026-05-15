/**
 * Matrix Spins Casino — Progressive Jackpot System
 *
 * Four-tier progressive jackpot with real-time ticker animation:
 *   • Mega   — starts $50,000, seeded from 1.5% of every bet
 *   • Major  — starts $5,000,  seeded from 1.0% of every bet
 *   • Minor  — starts $500,    seeded from 0.8% of every bet
 *   • Mini   — starts $50,     seeded from 0.5% of every bet
 *
 * In demo mode (no API), uses simulated growth with random variance.
 * In live mode, polls /api/jackpots every 5 seconds.
 */
(function () {
  'use strict';

  // ── Jackpot Pool Configuration ─────────────────────────────
  const TIERS = [
    { id: 'mega',  label: 'Mega',  seed: 5000000,  growthPerSec: 127, variance: 80 },
    { id: 'major', label: 'Major', seed:  500000,  growthPerSec: 43,  variance: 25 },
    { id: 'minor', label: 'Minor', seed:   50000,  growthPerSec: 11,  variance: 8  },
    { id: 'mini',  label: 'Mini',  seed:    5000,  growthPerSec: 3,   variance: 2  },
  ];

  // ── State ──────────────────────────────────────────────────
  const state = {
    pools: {},
    interval: null,
    tickInterval: null,
    winners: [],
    winnerTimeout: null,
  };

  // Initialize pools with seed + random accumulated amount
  TIERS.forEach(t => {
    const accumulated = Math.round(t.seed * (0.3 + Math.random() * 2.5));
    state.pools[t.id] = t.seed + accumulated;
  });

  // ── Formatting ─────────────────────────────────────────────
  function formatJackpot(cents) {
    const dollars = cents / 100;
    if (dollars >= 1000000) return '$' + (dollars / 1000000).toFixed(2) + 'M';
    if (dollars >= 10000)   return '$' + (dollars / 1000).toFixed(1) + 'K';
    return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── DOM Rendering ──────────────────────────────────────────

  /**
   * Render the jackpot bar (compact, for header area)
   * @param {HTMLElement} container
   */
  function renderBar(container) {
    if (!container) return;
    container.innerHTML = TIERS.map(t =>
      `<div class="jackpot-pool">
        <span class="jackpot-tier ${t.id}">${t.label}</span>
        <span class="jackpot-value ${t.id}" data-jackpot="${t.id}">${formatJackpot(state.pools[t.id])}</span>
      </div>`
    ).join('');
  }

  /**
   * Render the hero widget (large, for landing page)
   * @param {HTMLElement} container
   */
  function renderHero(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="label">Progressive Jackpot</div>
      <div class="mega-amount" data-jackpot-hero="mega">${formatJackpot(state.pools.mega)}</div>
      <div class="sub-text">and growing every second...</div>
      <div class="jackpot-tiers-row">
        ${TIERS.slice(1).map(t =>
          `<div class="tier-mini">
            <div class="name">${t.label}</div>
            <div class="amount ${t.id}" data-jackpot-hero="${t.id}">${formatJackpot(state.pools[t.id])}</div>
          </div>`
        ).join('')}
      </div>
    `;
  }

  // ── Tick Animation ─────────────────────────────────────────
  function tick() {
    TIERS.forEach(t => {
      // Add growth with slight random variance for realism
      const growth = t.growthPerSec + Math.round((Math.random() - 0.3) * t.variance);
      state.pools[t.id] += Math.max(0, growth);

      // Update all matching DOM elements
      document.querySelectorAll(`[data-jackpot="${t.id}"]`).forEach(el => {
        el.textContent = formatJackpot(state.pools[t.id]);
        el.classList.add('ticking');
        setTimeout(() => el.classList.remove('ticking'), 150);
      });

      document.querySelectorAll(`[data-jackpot-hero="${t.id}"]`).forEach(el => {
        el.textContent = formatJackpot(state.pools[t.id]);
      });
    });
  }

  // ── Winner Simulation ──────────────────────────────────────
  const DEMO_NAMES = [
    'Alex T.', 'Maria G.', 'James W.', 'Sarah K.', 'David C.',
    'Emma L.', 'Chris M.', 'Lisa R.', 'Ryan P.', 'Jennifer H.',
    'Kevin S.', 'Amanda B.', 'Michael F.', 'Nicole D.', 'Steven A.',
  ];

  function simulateWinners() {
    // Randomly trigger a mini or minor jackpot win every 45-120s
    const delay = (45 + Math.random() * 75) * 1000;
    state.winnerTimeout = setTimeout(() => {
      const tierIdx = Math.random() < 0.75 ? 3 : 2; // 75% mini, 25% minor
      const tier = TIERS[tierIdx];
      const amount = state.pools[tier.id];
      const winner = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];

      // Reset pool
      state.pools[tier.id] = tier.seed;

      // Show toast
      showWinnerToast(winner, tier.label, amount);

      // Continue simulation
      simulateWinners();
    }, delay);
  }

  function showWinnerToast(name, tierLabel, amountCents) {
    let toast = document.getElementById('jackpotWinnerToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'jackpotWinnerToast';
      toast.className = 'winner-toast';
      toast.innerHTML = `
        <div class="trophy">🏆</div>
        <div class="info">
          <div class="title"></div>
          <div class="detail"></div>
        </div>
        <div class="amount"></div>
      `;
      document.body.appendChild(toast);
    }

    toast.querySelector('.title').textContent = `${tierLabel} Jackpot Winner!`;
    toast.querySelector('.detail').textContent = `${name} just hit the ${tierLabel.toLowerCase()} jackpot`;
    toast.querySelector('.amount').textContent = formatJackpot(amountCents);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 6000);
    });
  }

  // ── Live API Mode ──────────────────────────────────────────
  async function fetchLivePools() {
    try {
      const res = await fetch('/api/jackpots');
      if (!res.ok) return;
      const data = await res.json();
      if (data.pools) {
        TIERS.forEach(t => {
          if (data.pools[t.id] != null) state.pools[t.id] = data.pools[t.id];
        });
      }
      if (data.recentWinners && data.recentWinners.length > 0) {
        const latest = data.recentWinners[0];
        if (!state.winners.includes(latest.id)) {
          state.winners.push(latest.id);
          showWinnerToast(latest.playerName, latest.tier, latest.amountCents);
        }
      }
    } catch {
      // Silently fall back to demo tick growth
    }
  }

  // ── Public API ─────────────────────────────────────────────
  window.MatrixJackpot = {
    /**
     * Initialize the jackpot system
     * @param {Object} opts - { barEl, heroEl, liveApi: boolean }
     */
    init(opts = {}) {
      // Render initial UI
      if (opts.barEl) renderBar(opts.barEl);
      if (opts.heroEl) renderHero(opts.heroEl);

      // Start tick animation (every 1s)
      if (!state.tickInterval) {
        state.tickInterval = setInterval(tick, 1000);
      }

      // Live API polling or demo winner simulation
      if (opts.liveApi) {
        fetchLivePools();
        state.interval = setInterval(fetchLivePools, 5000);
      } else {
        simulateWinners();
      }
    },

    /** Get current pool values */
    getPools() {
      return { ...state.pools };
    },

    /** Format cents to jackpot display */
    format: formatJackpot,

    /** Stop all timers */
    destroy() {
      clearInterval(state.tickInterval);
      clearInterval(state.interval);
      clearTimeout(state.winnerTimeout);
      state.tickInterval = null;
      state.interval = null;
    },
  };
})();
