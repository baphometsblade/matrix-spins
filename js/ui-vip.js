// =====================================================================
// VIP / LOYALTY REWARDS MODULE
// =====================================================================
//
// Client-side VIP tier system with cashback, weekly reload bonuses,
// animated tier cards, and a full-screen modal.
//
// Depends on: constants.js (VIP_TIERS, STORAGE_KEY_VIP, VIP_WEEKLY_*),
//   globals.js (stats, balance, formatMoney, currentUser),
//   app.js (saveBalance, saveStats),
//   ui-modals.js (showToast)
//
// All functions are in the global scope (no ES modules).
// HTML + CSS injected via IIFE at load time.


// ── VIP State ────────────────────────────────────────────────
let vipState = {
    lastWeeklyReloadClaim: null,
    cashbackHistory: [],       // [{ date, amount, tier }]
    totalCashbackClaimed: 0
};

// ── Load / Save ──────────────────────────────────────────────

function loadVipState() {
    const saved = localStorage.getItem(STORAGE_KEY_VIP);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            vipState = { ...vipState, ...parsed };
        } catch (e) { /* keep defaults */ }
    }
}

function saveVipState() {
    try { localStorage.setItem(STORAGE_KEY_VIP, JSON.stringify(vipState)); } catch (e) { /* ignore */ }
}


// ── Core VIP Logic ───────────────────────────────────────────

/**
 * Returns the VIP tier object for the current player based on stats.totalWagered.
 * @returns {object} Tier object from VIP_TIERS
 */
function getVipTier() {
    const wagered = (stats && stats.totalWagered) || 0;
    let tier = VIP_TIERS[0];
    for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
        if (wagered >= VIP_TIERS[i].minWagered) {
            tier = VIP_TIERS[i];
            break;
        }
    }
    return tier;
}

/**
 * Returns the index of the current VIP tier (0-based).
 */
function getVipTierIndex() {
    const tier = getVipTier();
    return VIP_TIERS.findIndex(t => t.id === tier.id);
}

/**
 * Returns progress percentage (0-100) toward the next VIP tier.
 * Returns 100 if already at the highest tier.
 */
function getVipProgress() {
    const wagered = (stats && stats.totalWagered) || 0;
    const idx = getVipTierIndex();
    if (idx >= VIP_TIERS.length - 1) return 100;

    const current = VIP_TIERS[idx];
    const next = VIP_TIERS[idx + 1];
    const range = next.minWagered - current.minWagered;
    const progress = wagered - current.minWagered;
    return Math.min(100, Math.max(0, (progress / range) * 100));
}

/**
 * Returns the next VIP tier object, or null if at Diamond.
 */
function getNextVipTier() {
    const idx = getVipTierIndex();
    if (idx >= VIP_TIERS.length - 1) return null;
    return VIP_TIERS[idx + 1];
}

/**
 * Calculates cashback for a given wagered amount based on current tier.
 * @param {number} wageredAmount
 * @returns {number} Cashback amount in dollars
 */
function calculateCashback(wageredAmount) {
    const tier = getVipTier();
    return (wageredAmount * tier.cashbackPct) / 100;
}

/**
 * Returns milliseconds remaining until weekly reload can be claimed.
 * Returns 0 if ready to claim.
 */
function getWeeklyReloadCooldownRemaining() {
    if (!vipState.lastWeeklyReloadClaim) return 0;
    const elapsed = Date.now() - vipState.lastWeeklyReloadClaim;
    return Math.max(0, VIP_WEEKLY_RELOAD_COOLDOWN_MS - elapsed);
}

/**
 * Returns true if the player can claim the weekly reload bonus.
 */
function canClaimWeeklyReload() {
    const tier = getVipTier();
    if (tier.weeklyReloadPct <= 0) return false;
    return getWeeklyReloadCooldownRemaining() === 0;
}

/**
 * Claims the weekly reload bonus — adds funds and updates state.
 * @returns {number|false} The bonus amount, or false if not claimable
 */
function claimWeeklyReload() {
    if (!canClaimWeeklyReload()) return false;

    const tier = getVipTier();
    const bonusAmount = Math.min(
        (VIP_WEEKLY_RELOAD_BASE * tier.weeklyReloadPct) / 100,
        VIP_WEEKLY_RELOAD_MAX_BONUS
    );

    balance += bonusAmount;
    if (typeof saveBalance === 'function') saveBalance();
    if (typeof updateBalance === 'function') updateBalance();

    vipState.lastWeeklyReloadClaim = Date.now();
    saveVipState();

    showToast(`Weekly reload: +$${formatMoney(bonusAmount)}!`, 'success');

    // Re-render the modal if open
    const modal = document.querySelector('.vip-modal-wrapper');
    if (modal && modal.classList.contains('active')) {
        _renderVipModalContent();
    }

    return bonusAmount;
}


// ═══════════════════════════════════════════════════════════════
// ENHANCED PROGRESS VISUALIZATION — CSS INJECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Injects the enhanced VIP progress CSS once into the document head.
 * A style#vipEnhancedCss guard prevents double-injection.
 */
function _injectVipCss() {
    if (document.getElementById('vipEnhancedCss')) return;
    const s = document.createElement('style');
    s.id = 'vipEnhancedCss';
    s.textContent = `
/* Animated tier progress bar */
#vipProgressBarFill {
    transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
    background: linear-gradient(90deg, var(--vip-color-from, #a78bfa), var(--vip-color-to, #7c3aed));
    box-shadow: 0 0 12px var(--vip-glow, rgba(167,139,250,0.6));
    position: relative;
    overflow: hidden;
}
#vipProgressBarFill::after {
    content: '';
    position: absolute;
    top: 0; left: -100%; width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation: vipShimmer 2s infinite;
}
@keyframes vipShimmer {
    0% { left: -100%; }
    100% { left: 200%; }
}
/* Milestone markers on progress bar */
.vip-milestone-marker {
    position: absolute;
    top: 0; bottom: 0;
    width: 2px;
    background: rgba(255,255,255,0.25);
    transform: translateX(-50%);
    pointer-events: none;
}
/* Mini tier card grid (distinct from .vip-tier-card large card) */
.vip-tier-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    margin: 16px 0;
}
.vip-mini-tier-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 10px 8px;
    text-align: center;
    transition: border-color 0.3s, background 0.3s;
    position: relative;
    overflow: hidden;
}
.vip-mini-tier-card.tier-current {
    border-color: var(--vip-color-to, #7c3aed);
    background: rgba(124,58,237,0.15);
    box-shadow: 0 0 16px rgba(124,58,237,0.2);
}
.vip-mini-tier-card.tier-unlocked {
    opacity: 0.7;
}
.vip-mini-tier-card.tier-locked {
    opacity: 0.4;
}
.vip-tier-badge {
    font-size: 22px;
    margin-bottom: 4px;
}
.vip-tier-name-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-bottom: 2px;
}
.vip-tier-perk {
    font-size: 9px;
    color: #64748b;
    line-height: 1.3;
}
.vip-current-badge {
    position: absolute;
    top: 4px; right: 4px;
    background: #fbbf24;
    color: #000;
    font-size: 7px;
    font-weight: 900;
    padding: 1px 4px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
/* Wager countdown */
.vip-wager-countdown {
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 12px 16px;
    margin: 12px 0;
    display: flex;
    align-items: center;
    gap: 12px;
}
.vip-wager-amount {
    font-size: 20px;
    font-weight: 900;
    color: #fbbf24;
}
/* Enhanced progress container spacing */
#vipEnhancedProgressContainer {
    padding: 0 32px 16px;
}
#vipTierCardsContainer {
    padding: 0 32px;
}
#vipWagerCountdown {
    padding: 0 32px 16px;
}
@media (max-width: 640px) {
    #vipEnhancedProgressContainer,
    #vipTierCardsContainer,
    #vipWagerCountdown { padding-left: 16px; padding-right: 16px; }
}
`;
    document.head.appendChild(s);
}


// ── Format Helpers ───────────────────────────────────────────

function _vipFormatCooldown(ms) {
    if (ms <= 0) return 'Ready!';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function _vipFormatWagered(amount) {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
    return `$${formatMoney(amount)}`;
}


// ═══════════════════════════════════════════════════════════════
// ENHANCED PROGRESS BAR RENDERER
// ═══════════════════════════════════════════════════════════════

/**
 * Converts a CSS hex color string to a comma-separated RGB triple.
 * @param {string} hex - e.g. '#CD7F32'
 * @returns {string} e.g. '205,127,50'
 */
function _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`
        : '167,139,250';
}

/**
 * Renders the animated enhanced progress bar into #vipEnhancedProgressContainer.
 * @param {object} tier        - current tier object from VIP_TIERS
 * @param {object|null} nextTier - next tier object or null if max tier
 * @param {number} progressPct  - 0-100
 */
function _renderEnhancedProgress(tier, nextTier, progressPct) {
    const container = document.getElementById('vipEnhancedProgressContainer');
    if (!container) return;

    const colorFrom = tier.color || '#a78bfa';
    const colorTo   = nextTier ? (nextTier.color || '#7c3aed') : '#fbbf24';
    const glow      = `rgba(${_hexToRgb(colorFrom)},0.5)`;
    const wagered   = (stats && stats.totalWagered) || 0;

    container.innerHTML = `
        <div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:700;color:${colorFrom};">${tier.icon || '\u2B50'} ${tier.name}</span>
            ${nextTier
                ? `<span style="font-size:12px;color:#64748b;">${nextTier.icon || '\u2B50'} ${nextTier.name}</span>`
                : `<span style="font-size:11px;color:#fbbf24;">MAX TIER \u{1F451}</span>`
            }
        </div>
        <div style="position:relative;background:rgba(255,255,255,0.08);border-radius:8px;height:14px;overflow:hidden;">
            <div id="vipProgressBarFill" style="
                height:100%;
                width:0%;
                border-radius:8px;
                --vip-color-from:${colorFrom};
                --vip-color-to:${colorTo};
                --vip-glow:${glow};
            "></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
            <span style="font-size:10px;color:#475569;">${Math.round(progressPct)}% to next tier</span>
            ${nextTier
                ? `<span style="font-size:10px;color:#475569;">Wager $${formatMoney(Math.max(0, nextTier.minWagered - wagered))} more</span>`
                : ''
            }
        </div>
    `;

    // Animate bar width after paint settles
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const fill = document.getElementById('vipProgressBarFill');
        if (fill) fill.style.width = progressPct + '%';
    }));
}

/**
 * Renders a mini grid of all VIP tier cards into #vipTierCardsContainer,
 * showing unlocked / current / locked state for each tier.
 * @param {number} currentTierIdx - 0-based index of the active tier
 */
function _renderTierCards(currentTierIdx) {
    const container = document.getElementById('vipTierCardsContainer');
    if (!container || typeof VIP_TIERS === 'undefined') return;

    container.innerHTML = '<div class="vip-tier-cards">' + VIP_TIERS.map((t, i) => {
        const state = i < currentTierIdx ? 'tier-unlocked'
                    : i === currentTierIdx ? 'tier-current'
                    : 'tier-locked';

        // Build up to 2 perk lines from fields that exist on the tier object
        const perkLines = [
            t.cashbackPct   ? `${t.cashbackPct}% cashback`      : null,
            t.weeklyReloadPct > 0 ? `${t.weeklyReloadPct}% reload` : null,
        ].filter(Boolean).slice(0, 2).join('<br>') || 'Base tier';

        // For current card, use its color for the border glow via inline style
        const currentStyle = i === currentTierIdx
            ? `border-color:${t.color};background:${t.color}22;box-shadow:0 0 16px ${t.color}33;`
            : '';

        return `
            <div class="vip-mini-tier-card ${state}" style="${currentStyle}">
                ${i === currentTierIdx ? '<div class="vip-current-badge">YOU</div>' : ''}
                <div class="vip-tier-badge">${t.icon || '\u2B50'}</div>
                <div class="vip-tier-name-label" style="color:${t.color || '#e2e8f0'};">${t.name}</div>
                <div class="vip-tier-perk">${perkLines}</div>
            </div>
        `;
    }).join('') + '</div>';
}

/**
 * Renders the wager-needed countdown into #vipWagerCountdown.
 * @param {object|null} nextTier       - next tier or null if max
 * @param {number}      currentWagered - stats.totalWagered
 */
function _renderWagerCountdown(nextTier, currentWagered) {
    const container = document.getElementById('vipWagerCountdown');
    if (!container) return;

    if (!nextTier) {
        container.innerHTML = `<div class="vip-wager-countdown" style="justify-content:center;">
            <span style="font-size:24px;">\u{1F451}</span>
            <div>
                <div style="font-size:14px;font-weight:800;color:#fbbf24;">Maximum Tier Reached!</div>
                <div style="font-size:11px;color:#64748b;">You have unlocked all VIP benefits.</div>
            </div>
        </div>`;
        return;
    }

    const needed = Math.max(0, nextTier.minWagered - currentWagered);
    container.innerHTML = `<div class="vip-wager-countdown">
        <span style="font-size:28px;">${nextTier.icon || '\u2B50'}</span>
        <div style="flex:1;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Wager to reach ${nextTier.name}</div>
            <div style="display:flex;align-items:baseline;gap:6px;">
                <span class="vip-wager-amount">$${formatMoney(needed)}</span>
                <span style="font-size:11px;color:#475569;">more</span>
            </div>
        </div>
    </div>`;
}


// ═══════════════════════════════════════════════════════════════
// INJECT MODAL HTML + STYLES (IIFE — runs once on load)
// ═══════════════════════════════════════════════════════════════

(function injectVipModal() {
    // ── CSS ──────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
/* ── VIP Modal Overlay ────────────────────────────────── */
.vip-modal-wrapper {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.94);
    z-index:10400;
    overflow-y: auto;
    padding: 20px;
    animation: vip-fadeIn 0.3s ease-out;
}
.vip-modal-wrapper.active {
    display: flex;
    align-items: flex-start;
    justify-content: center;
}

@keyframes vip-fadeIn {
    from { opacity: 0; transform: scale(0.97); }
    to   { opacity: 1; transform: scale(1); }
}

.vip-modal {
    width: 100%;
    max-width: 900px;
    background: linear-gradient(160deg, #0a0e1a 0%, #141226 50%, #0d1117 100%);
    border: 1px solid rgba(185, 242, 255, 0.15);
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 32px 100px rgba(0, 0, 0, 0.8), 0 0 60px rgba(185, 242, 255, 0.06);
    margin: 20px 0 40px;
}

/* ── Header ───────────────────────────────────────────── */
.vip-modal-header {
    position: relative;
    padding: 32px 32px 24px;
    background: linear-gradient(135deg, rgba(185, 242, 255, 0.06) 0%, transparent 60%);
    border-bottom: 1px solid rgba(185, 242, 255, 0.08);
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.vip-modal-header h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 900;
    letter-spacing: 2px;
    background: linear-gradient(135deg, #B9F2FF, #FFD700);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}
.vip-modal-header .vip-close-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}
.vip-modal-header .vip-close-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}

/* ── Tier Card ────────────────────────────────────────── */
.vip-tier-card {
    margin: 24px 32px;
    padding: 28px 32px;
    border-radius: 20px;
    position: relative;
    overflow: hidden;
    color: #fff;
}
.vip-tier-card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--vip-color) 0%, var(--vip-color-dark) 100%);
    opacity: 0.18;
    z-index:10400;
}
.vip-tier-card::after {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, var(--vip-color) 0%, transparent 70%);
    opacity: 0.08;
    z-index:10400;
}
.vip-tier-card > * { position: relative; z-index:10400; }

.vip-tier-card-top {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 20px;
}
.vip-tier-icon {
    font-size: 52px;
    filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
    animation: vip-icon-float 3s ease-in-out infinite;
}
@keyframes vip-icon-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-6px); }
}

.vip-tier-info h3 {
    margin: 0 0 4px;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--vip-color);
    text-shadow: 0 2px 12px rgba(0,0,0,0.5);
}
.vip-tier-info .vip-tier-subtitle {
    font-size: 13px;
    color: #94a3b8;
    letter-spacing: 1px;
}

.vip-tier-card-border {
    position: absolute;
    inset: 0;
    border-radius: 20px;
    border: 2px solid var(--vip-color);
    opacity: 0.3;
    pointer-events: none;
    z-index:10400;
}
.vip-tier-card-shimmer {
    position: absolute;
    top: 0; left: -100%;
    width: 50%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
    animation: vip-shimmer 4s ease-in-out infinite;
    z-index:10400;
    pointer-events: none;
}
@keyframes vip-shimmer {
    0%   { left: -50%; }
    100% { left: 150%; }
}

/* ── Progress Bar ─────────────────────────────────────── */
.vip-progress-section {
    padding: 0 32px 24px;
}
.vip-progress-labels {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 12px;
    color: #64748b;
}
.vip-progress-labels .vip-progress-value {
    color: #e2e8f0;
    font-weight: 700;
}
.vip-progress-track {
    width: 100%;
    height: 10px;
    background: rgba(255,255,255,0.06);
    border-radius: 5px;
    overflow: hidden;
    position: relative;
}
.vip-progress-fill {
    height: 100%;
    border-radius: 5px;
    background: linear-gradient(90deg, var(--vip-color-dark), var(--vip-color));
    transition: width 1s cubic-bezier(0.22, 1, 0.36, 1);
    position: relative;
}
.vip-progress-fill::after {
    content: '';
    position: absolute;
    right: 0;
    top: 0;
    width: 20px;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4));
    border-radius: 0 5px 5px 0;
    animation: vip-progress-pulse 2s ease-in-out infinite;
}
@keyframes vip-progress-pulse {
    0%, 100% { opacity: 0.3; }
    50%      { opacity: 1; }
}
.vip-progress-next {
    text-align: center;
    font-size: 12px;
    color: #64748b;
    margin-top: 10px;
}
.vip-progress-next strong {
    color: var(--vip-color);
}

/* ── Benefits Grid ────────────────────────────────────── */
.vip-benefits-section {
    padding: 0 32px 28px;
}
.vip-benefits-section h4 {
    font-size: 16px;
    font-weight: 800;
    color: #e2e8f0;
    letter-spacing: 1px;
    margin: 0 0 16px;
}
.vip-benefits-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}
.vip-benefit-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    font-size: 12px;
    color: #cbd5e1;
    letter-spacing: 0.3px;
}
.vip-benefit-tag .vip-benefit-check {
    color: var(--vip-color);
    font-weight: 900;
}

/* ── Weekly Reload Section ────────────────────────────── */
.vip-reload-section {
    margin: 0 32px 28px;
    padding: 20px 24px;
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 182, 212, 0.06) 100%);
    border: 1px solid rgba(16, 185, 129, 0.15);
    border-radius: 16px;
}
.vip-reload-section h4 {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 800;
    color: #34d399;
    letter-spacing: 0.5px;
}
.vip-reload-section p {
    margin: 0 0 14px;
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.5;
}
.vip-reload-btn {
    padding: 10px 28px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 1px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.25s;
    text-transform: uppercase;
}
.vip-reload-btn--active {
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    box-shadow: 0 4px 20px rgba(16, 185, 129, 0.3);
}
.vip-reload-btn--active:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 28px rgba(16, 185, 129, 0.45);
}
.vip-reload-btn--disabled {
    background: rgba(255,255,255,0.06);
    color: #475569;
    cursor: not-allowed;
}
.vip-reload-unavailable {
    font-size: 12px;
    color: #64748b;
    margin-top: 8px;
}

/* ── Cashback Summary ─────────────────────────────────── */
.vip-cashback-section {
    padding: 0 32px 28px;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}
.vip-cashback-card {
    flex: 1;
    min-width: 160px;
    padding: 18px 20px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px;
    text-align: center;
}
.vip-cashback-card .vip-cashback-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 6px;
}
.vip-cashback-card .vip-cashback-value {
    font-size: 22px;
    font-weight: 900;
    color: #e2e8f0;
}
.vip-cashback-card .vip-cashback-value--accent {
    color: var(--vip-color);
}

/* ── Tier Comparison Table ────────────────────────────── */
.vip-table-section {
    padding: 0 32px 28px;
}
.vip-table-section h4 {
    font-size: 16px;
    font-weight: 800;
    color: #e2e8f0;
    letter-spacing: 1px;
    margin: 0 0 16px;
}
.vip-comparison-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 12px;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.06);
}
.vip-comparison-table th,
.vip-comparison-table td {
    padding: 12px 14px;
    text-align: center;
    border-bottom: 1px solid rgba(255,255,255,0.04);
}
.vip-comparison-table th {
    background: rgba(255,255,255,0.04);
    color: #94a3b8;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 10px;
}
.vip-comparison-table td {
    color: #cbd5e1;
}
.vip-comparison-table tr:last-child td {
    border-bottom: none;
}
.vip-comparison-table .vip-table-current {
    background: rgba(185, 242, 255, 0.06);
}
.vip-comparison-table .vip-table-tier-cell {
    font-weight: 800;
    letter-spacing: 1px;
}

/* ── Tips Section ─────────────────────────────────────── */
.vip-tips-section {
    padding: 0 32px 32px;
}
.vip-tips-section h4 {
    font-size: 16px;
    font-weight: 800;
    color: #e2e8f0;
    letter-spacing: 1px;
    margin: 0 0 14px;
}
.vip-tips-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
}
.vip-tip-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.5;
}
.vip-tip-icon {
    font-size: 20px;
    flex-shrink: 0;
}
.vip-tip-text strong {
    color: #e2e8f0;
    display: block;
    margin-bottom: 2px;
    font-size: 13px;
}

/* ── VIP Badge (header) ───────────────────────────────── */
.vip-header-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    border: 1px solid;
    transition: all 0.25s;
    white-space: nowrap;
}
.vip-header-badge:hover {
    transform: translateY(-1px);
    filter: brightness(1.2);
}
.vip-header-badge-icon {
    font-size: 14px;
}

/* ── Responsive ───────────────────────────────────────── */
@media (max-width: 640px) {
    .vip-modal {
        border-radius: 16px;
    }
    .vip-tier-card { margin: 16px; padding: 20px; }
    .vip-progress-section,
    .vip-benefits-section,
    .vip-cashback-section,
    .vip-table-section,
    .vip-tips-section { padding-left: 16px; padding-right: 16px; }
    .vip-reload-section { margin-left: 16px; margin-right: 16px; }
    .vip-modal-header { padding: 20px 16px 16px; }
    .vip-modal-header h2 { font-size: 18px; }
    .vip-tier-icon { font-size: 36px; }
    .vip-tier-info h3 { font-size: 20px; }
    .vip-comparison-table { font-size: 10px; }
    .vip-comparison-table th,
    .vip-comparison-table td { padding: 8px 6px; }
}
`;
    document.head.appendChild(style);

    // ── HTML ─────────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'vip-modal-wrapper';
    wrapper.id = 'vipModalWrapper';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-label', 'VIP Rewards');
    wrapper.innerHTML = `<div class="vip-modal" id="vipModal"><div id="vipModalInner"></div></div>`;
    wrapper.addEventListener('click', function (e) {
        if (e.target === wrapper) hideVipModal();
    });
    document.body.appendChild(wrapper);
})();


// ═══════════════════════════════════════════════════════════════
// MODAL SHOW / HIDE
// ═══════════════════════════════════════════════════════════════

function showVipModal() {
    loadVipState();
    _renderVipModalContent();
    document.getElementById('vipModalWrapper').classList.add('active');
}

function hideVipModal() {
    document.getElementById('vipModalWrapper').classList.remove('active');
}


// ═══════════════════════════════════════════════════════════════
// MODAL CONTENT RENDERER
// ═══════════════════════════════════════════════════════════════

function _renderVipModalContent() {
    // Inject enhanced CSS on first call (id-guarded, no-op after first run)
    _injectVipCss();

    const tier = getVipTier();
    const tierIdx = getVipTierIndex();
    const nextTier = getNextVipTier();
    const progress = getVipProgress();
    const wagered = (stats && stats.totalWagered) || 0;

    const container = document.getElementById('vipModalInner');
    if (!container) return;

    container.innerHTML = `
        <!-- Header -->
        <div class="vip-modal-header">
            <h2>VIP REWARDS</h2>
            <button class="vip-close-btn" onclick="hideVipModal()" aria-label="Close">&times;</button>
        </div>

        <!-- Tier Card -->
        ${renderVipTierCard(tier)}

        <!-- Enhanced Animated Progress Bar -->
        <div id="vipEnhancedProgressContainer"></div>

        <!-- Tier Card Grid -->
        <div id="vipTierCardsContainer"></div>

        <!-- Wager Countdown -->
        <div id="vipWagerCountdown"></div>

        <!-- Original Progress Bar (retained for layout continuity) -->
        ${_renderProgressSection(tier, nextTier, progress, wagered)}

        <!-- Current Benefits -->
        <div class="vip-benefits-section">
            <h4>YOUR BENEFITS</h4>
            <div class="vip-benefits-list">
                ${tier.benefits.map(b => `
                    <div class="vip-benefit-tag">
                        <span class="vip-benefit-check">\u2713</span> ${b}
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Weekly Reload -->
        ${_renderWeeklyReloadSection(tier)}

        <!-- Cashback Summary -->
        ${_renderCashbackSection(tier, wagered)}

        <!-- VIP Wheel -->
        <div id="vipWheelSection" style="margin:16px 0;"></div>

        <!-- Tier Comparison Table -->
        ${_renderComparisonTable(tierIdx)}

        <!-- How to Level Up -->
        ${_renderTipsSection()}
    `;

    // Animate original progress bar after DOM paint
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const fill = container.querySelector('.vip-progress-fill');
            if (fill) fill.style.width = progress + '%';
        });
    });

    // Render enhanced progress visualization widgets
    // (each function uses requestAnimationFrame internally for animation)
    _renderEnhancedProgress(tier, nextTier, progress);
    _renderTierCards(tierIdx);
    _renderWagerCountdown(nextTier, wagered);

    // Load VIP Wheel section asynchronously
    _refreshVipWheelSection();

    // Mega Wheel section (DOM-built, appended after innerHTML paint)
    _renderMegaWheelSection(container);
}

// ─── VIP Wheel ────────────────────────────────────────────────────────────────

async function _refreshVipWheelSection() {
    var el = document.getElementById('vipWheelSection');
    if (!el) return;

    var token = typeof authToken !== 'undefined' ? authToken :
                (typeof getAuthToken === 'function' ? getAuthToken() : null);
    if (!token) {
        el.innerHTML = '';
        return;
    }

    try {
        var res = await fetch('/api/vipwheel/status', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        el.innerHTML = _buildVipWheelHtml(data);
    } catch (e) {
        el.innerHTML = '';
    }
}

function _buildVipWheelHtml(status) {
    var prizesHtml = [
        { label: '500 Gems', weight: '30%' },
        { label: '$2',       weight: '25%' },
        { label: '1K Gems',  weight: '18%' },
        { label: '$5',       weight: '12%' },
        { label: '2.5K Gems',weight: '7%' },
        { label: '$10',      weight: '4%' },
        { label: '5K Gems',  weight: '3%' },
        { label: '$25',      weight: '1%' }
    ].map(function(p) {
        return '<span style="display:inline-block;padding:3px 8px;margin:2px;background:rgba(255,255,255,0.08);border-radius:12px;font-size:11px;color:#e2e8f0;">' + p.label + ' <span style="opacity:0.5;">(' + p.weight + ')</span></span>';
    }).join('');

    var actionHtml;
    if (!status.eligible) {
        actionHtml = '<div style="text-align:center;padding:10px;color:rgba(255,255,255,0.5);font-size:13px;">🔒 Reach VIP Level ' + status.vipRequired + ' ($2,000 wagered) to unlock</div>';
    } else if (!status.available) {
        var cooldownMs = new Date(status.cooldownEnds).getTime() - Date.now();
        var h = Math.floor(cooldownMs / 3600000);
        var m = Math.floor((cooldownMs % 3600000) / 60000);
        actionHtml = '<div style="text-align:center;padding:10px;">' +
            '<button disabled style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:not-allowed;">Next spin in ' + h + 'h ' + m + 'm</button>' +
            '</div>';
    } else {
        actionHtml = '<div style="text-align:center;padding:10px;">' +
            '<button onclick="spinVipWheel()" id="vipWheelSpinBtn" ' +
            'style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;padding:10px 32px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 15px rgba(124,58,237,0.4);">' +
            '🎡 Spin VIP Wheel</button>' +
            '</div>';
    }

    return '<div style="background:linear-gradient(135deg,#1e1040,#0f172a);border:1px solid rgba(139,92,246,0.35);border-radius:12px;padding:16px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
            '<span style="font-size:18px;">🎡</span>' +
            '<span style="font-size:15px;font-weight:700;color:#c4b5fd;">VIP Wheel</span>' +
            '<span style="font-size:11px;color:rgba(255,255,255,0.4);margin-left:auto;">VIP Level 3+ · 24h cooldown</span>' +
        '</div>' +
        '<div style="margin-bottom:10px;">' + prizesHtml + '</div>' +
        actionHtml +
        '</div>';
}

async function spinVipWheel() {
    var btn = document.getElementById('vipWheelSpinBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Spinning…'; }

    var token = typeof authToken !== 'undefined' ? authToken :
                (typeof getAuthToken === 'function' ? getAuthToken() : null);
    if (!token) return;

    try {
        var res = await fetch('/api/vipwheel/spin', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        var data = await res.json();
        if (!res.ok) {
            if (typeof showToast === 'function') showToast(data.error || 'Spin failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = '🎡 Spin VIP Wheel'; }
            return;
        }
        // Show prize toast
        var msg = '🎡 VIP Wheel: You won ' + data.prize.label + '!';
        if (typeof showToast === 'function') showToast(msg, 'win');
        // Update balance if credits were won
        if (data.prize.type === 'credits' && typeof saveBalance === 'function') {
            saveBalance(data.newBalance);
        }
        // Refresh wheel section to show cooldown
        _refreshVipWheelSection();
    } catch (e) {
        if (typeof showToast === 'function') showToast('Spin failed. Try again.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🎡 Spin VIP Wheel'; }
    }
}


// ═══════════════════════════════════════════════════════════════
// TIER CARD RENDERER (reusable)
// ═══════════════════════════════════════════════════════════════

/**
 * Renders a premium-looking VIP tier card.
 * @param {object} tier - A tier object from VIP_TIERS
 * @returns {string} HTML string
 */
function renderVipTierCard(tier) {
    return `
        <div class="vip-tier-card"
             style="--vip-color:${tier.color}; --vip-color-dark:${tier.colorDark};">
            <div class="vip-tier-card-border"></div>
            <div class="vip-tier-card-shimmer"></div>
            <div class="vip-tier-card-top">
                <div class="vip-tier-icon">${tier.icon}</div>
                <div class="vip-tier-info">
                    <h3>${tier.name}</h3>
                    <div class="vip-tier-subtitle">${currentUser ? currentUser.username || 'Player' : 'Player'} &bull; VIP Member</div>
                </div>
            </div>
            <div style="display:flex; gap:24px; flex-wrap:wrap;">
                <div>
                    <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Cashback Rate</div>
                    <div style="font-size:22px; font-weight:900; color:${tier.color};">${tier.cashbackPct}%</div>
                </div>
                ${tier.weeklyReloadPct > 0 ? `
                <div>
                    <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Weekly Reload</div>
                    <div style="font-size:22px; font-weight:900; color:${tier.color};">${tier.weeklyReloadPct}%</div>
                </div>
                ` : ''}
                <div>
                    <div style="font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Total Wagered</div>
                    <div style="font-size:22px; font-weight:900; color:#e2e8f0;">${_vipFormatWagered((stats && stats.totalWagered) || 0)}</div>
                </div>
            </div>
        </div>
    `;
}


// ── Section Renderers ────────────────────────────────────────

function _renderProgressSection(tier, nextTier, progress, wagered) {
    if (!nextTier) {
        return `
            <div class="vip-progress-section" style="--vip-color:${tier.color}; --vip-color-dark:${tier.colorDark};">
                <div class="vip-progress-labels">
                    <span>Progress</span>
                    <span class="vip-progress-value" style="color:${tier.color};">MAX TIER ACHIEVED</span>
                </div>
                <div class="vip-progress-track">
                    <div class="vip-progress-fill" style="width:0%; background:linear-gradient(90deg,${tier.colorDark},${tier.color});"></div>
                </div>
                <div class="vip-progress-next" style="color:${tier.color}; font-weight:700;">
                    You have reached the pinnacle of VIP status!
                </div>
            </div>
        `;
    }

    const remaining = nextTier.minWagered - wagered;
    return `
        <div class="vip-progress-section" style="--vip-color:${nextTier.color}; --vip-color-dark:${nextTier.colorDark};">
            <div class="vip-progress-labels">
                <span>Progress to <strong style="color:${nextTier.color};">${nextTier.name}</strong></span>
                <span class="vip-progress-value">${progress.toFixed(1)}%</span>
            </div>
            <div class="vip-progress-track">
                <div class="vip-progress-fill" style="width:0%; background:linear-gradient(90deg,${tier.color},${nextTier.color});"></div>
            </div>
            <div class="vip-progress-next">
                Wager <strong>$${formatMoney(remaining)}</strong> more to reach <strong>${nextTier.name}</strong>
            </div>
        </div>
    `;
}

function _renderWeeklyReloadSection(tier) {
    if (tier.weeklyReloadPct <= 0) {
        return `
            <div class="vip-reload-section">
                <h4>WEEKLY RELOAD BONUS</h4>
                <p>Unlock the weekly reload bonus by reaching <strong style="color:${VIP_TIERS[1].color};">${VIP_TIERS[1].name}</strong> tier (wager $${formatMoney(VIP_TIERS[1].minWagered)}+).</p>
                <div class="vip-reload-unavailable">Currently available from Silver tier and above.</div>
            </div>
        `;
    }

    const cooldownMs = getWeeklyReloadCooldownRemaining();
    const canClaim = cooldownMs === 0;
    const bonusAmount = Math.min(
        (VIP_WEEKLY_RELOAD_BASE * tier.weeklyReloadPct) / 100,
        VIP_WEEKLY_RELOAD_MAX_BONUS
    );

    return `
        <div class="vip-reload-section">
            <h4>WEEKLY RELOAD BONUS</h4>
            <p>As a <span style="color:${tier.color}; font-weight:700;">${tier.name}</span> member, you receive a ${tier.weeklyReloadPct}% weekly reload — up to <strong>$${formatMoney(bonusAmount)}</strong>.</p>
            ${canClaim
                ? `<button class="vip-reload-btn vip-reload-btn--active" onclick="claimWeeklyReload()">CLAIM $${formatMoney(bonusAmount)}</button>`
                : `<button class="vip-reload-btn vip-reload-btn--disabled" disabled>CLAIMED</button>
                   <div class="vip-reload-unavailable">Next reload available in ${_vipFormatCooldown(cooldownMs)}</div>`
            }
        </div>
    `;
}

function _renderCashbackSection(tier, wagered) {
    const potentialCashback = calculateCashback(wagered);
    return `
        <div class="vip-cashback-section" style="--vip-color:${tier.color};">
            <div class="vip-cashback-card">
                <div class="vip-cashback-label">Cashback Rate</div>
                <div class="vip-cashback-value vip-cashback-value--accent">${tier.cashbackPct}%</div>
            </div>
            <div class="vip-cashback-card">
                <div class="vip-cashback-label">Lifetime Cashback Value</div>
                <div class="vip-cashback-value">$${formatMoney(potentialCashback)}</div>
            </div>
            <div class="vip-cashback-card">
                <div class="vip-cashback-label">Total Claimed</div>
                <div class="vip-cashback-value">$${formatMoney(vipState.totalCashbackClaimed)}</div>
            </div>
        </div>
    `;
}

function _renderComparisonTable(currentIdx) {
    const rows = VIP_TIERS.map((t, i) => {
        const isCurrent = i === currentIdx;
        const cls = isCurrent ? ' class="vip-table-current"' : '';
        return `
            <tr${cls}>
                <td class="vip-table-tier-cell" style="color:${t.color};">${t.icon} ${t.name}${isCurrent ? ' *' : ''}</td>
                <td>${t.minWagered === 0 ? '$0' : '$' + t.minWagered.toLocaleString()}${t.maxWagered === Infinity ? '+' : ' - $' + t.maxWagered.toLocaleString()}</td>
                <td style="color:${t.color}; font-weight:700;">${t.cashbackPct}%</td>
                <td>${t.weeklyReloadPct > 0 ? t.weeklyReloadPct + '%' : '--'}</td>
                <td>${t.benefits.length} perks</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="vip-table-section">
            <h4>ALL VIP TIERS</h4>
            <div style="overflow-x:auto;">
                <table class="vip-comparison-table">
                    <thead>
                        <tr>
                            <th>Tier</th>
                            <th>Wagered</th>
                            <th>Cashback</th>
                            <th>Reload</th>
                            <th>Benefits</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function _renderTipsSection() {
    return `
        <div class="vip-tips-section">
            <h4>HOW TO LEVEL UP</h4>
            <div class="vip-tips-list">
                <div class="vip-tip-item">
                    <div class="vip-tip-icon">\u{1F3B0}</div>
                    <div class="vip-tip-text">
                        <strong>Play More Games</strong>
                        Every wager counts toward your VIP tier. Try different slots to maximise variety and entertainment.
                    </div>
                </div>
                <div class="vip-tip-item">
                    <div class="vip-tip-icon">\u{1F4B0}</div>
                    <div class="vip-tip-text">
                        <strong>Increase Your Bet Size</strong>
                        Higher bets accelerate your progress through VIP tiers. Find a comfortable level and enjoy the ride.
                    </div>
                </div>
                <div class="vip-tip-item">
                    <div class="vip-tip-icon">\u{1F4C5}</div>
                    <div class="vip-tip-text">
                        <strong>Claim Weekly Reload</strong>
                        Silver tier and above earn weekly reload bonuses. Claim them every 7 days for free bonus funds.
                    </div>
                </div>
                <div class="vip-tip-item">
                    <div class="vip-tip-icon">\u{1F525}</div>
                    <div class="vip-tip-text">
                        <strong>Stay Consistent</strong>
                        Regular play builds your lifetime wagered total. VIP status never expires once earned.
                    </div>
                </div>
            </div>
        </div>
    `;
}


// ═══════════════════════════════════════════════════════════════
// VIP BADGE (header integration)
// ═══════════════════════════════════════════════════════════════

/**
 * Renders the VIP badge into the header.
 * Call this after page load and after each spin to keep it current.
 */
function renderVipBadge() {
    loadVipState();
    const tier = getVipTier();
    let badge = document.getElementById('vipHeaderBadge');

    if (!badge) {
        badge = document.createElement('button');
        badge.id = 'vipHeaderBadge';
        badge.className = 'vip-header-badge';
        badge.setAttribute('title', 'View VIP Rewards');
        badge.setAttribute('aria-label', 'VIP Rewards');
        badge.onclick = function () { showVipModal(); };

        // Insert before the WALLET button in header-actions
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            const walletBtn = headerActions.querySelector('.btn-deposit');
            if (walletBtn) {
                headerActions.insertBefore(badge, walletBtn);
            } else {
                headerActions.prepend(badge);
            }
        }
    }

    badge.style.borderColor = tier.color;
    badge.style.color = tier.color;
    badge.style.background = `linear-gradient(135deg, ${tier.color}15, ${tier.color}08)`;
    badge.innerHTML = `<span class="vip-header-badge-icon">${tier.icon}</span> ${tier.name.toUpperCase()}`;

    updateVipMiniBar();
}


// ═══════════════════════════════════════════════════════════════
// VIP MINI PROGRESS BAR
// ═══════════════════════════════════════════════════════════════

/**
 * Updates the persistent mini VIP progress bar shown in the header
 * (#vipMiniBar / #vipMiniFill / #vipMiniText).
 * Safe to call at any time -- exits early if elements are absent.
 */
function updateVipMiniBar() {
    var fill  = document.getElementById('vipMiniFill');
    var label = document.getElementById('vipMiniText');
    var bar   = document.getElementById('vipMiniBar');
    if (!fill || !label || !bar) return;

    var tier     = getVipTier();
    var progress = getVipProgress();   // 0-100
    var next     = getNextVipTier();

    // Width + colour
    fill.style.width      = Math.min(progress, 100) + '%';
    fill.style.background = tier.color || '#ffd700';

    // Label: "$X to NextTier" or "MAX"
    if (next) {
        var needed = Math.max(0, next.minWagered - ((stats && stats.totalWagered) || 0));
        label.textContent = '$' + (needed >= 1000
            ? (needed / 1000).toFixed(1) + 'k'
            : needed.toFixed(0)) + ' to ' + next.name;
    } else {
        label.textContent = tier.icon + ' MAX';
    }

    // Tooltip
    bar.title = 'VIP: ' + tier.name + ' (' + Math.round(progress) + '% to ' +
                (next ? next.name : 'Max') + ')';
}
window.updateVipMiniBar = updateVipMiniBar;


// ═══════════════════════════════════════════════════════════════
// VIP INLINE BADGE HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Returns HTML for a small VIP tier pill badge.
 * tierName: e.g. 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite'
 * Pass null/undefined to get an empty string (not logged in / unranked).
 */
function getVipBadgeHtml(tierName) {
    if (!tierName) return '';
    var slug = String(tierName).toLowerCase().replace(/\s+/g, '-');
    return '<span class="vip-inline-badge vip-badge-' + slug + '">' + tierName + '</span>';
}


// ═══════════════════════════════════════════════════════════════
// VIP TIER-UP CELEBRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Call with the tier index that was current BEFORE wagered was incremented.
 * If the player has crossed into a higher tier, fires the celebration modal.
 */
function checkAndFireVipTierUp(prevIndex) {
    var newIndex = getVipTierIndex();
    if (newIndex <= prevIndex) return; // no change or regression
    var tier = getVipTier();
    showVipTierUpModal(tier);
}
window.checkAndFireVipTierUp = checkAndFireVipTierUp;

function showVipTierUpModal(tier) {
    // Remove existing if any
    var existing = document.getElementById('vipTierUpModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'vipTierUpModal';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:10400',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.85)', 'backdrop-filter:blur(6px)',
        'animation:vipTuFadeIn 0.4s ease'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
        'background:linear-gradient(160deg,#0a0a1a,#12122a)',
        'border:2px solid ' + (tier.color || '#ffd700'),
        'box-shadow:0 0 60px ' + (tier.color || '#ffd700') + '55',
        'border-radius:20px', 'padding:44px 52px', 'text-align:center',
        'max-width:380px', 'width:90%',
        'animation:vipTuPop 0.5s cubic-bezier(0.34,1.56,0.64,1)'
    ].join(';');

    // Inject keyframes once
    if (!document.getElementById('_vipTuStyles')) {
        var s = document.createElement('style');
        s.id = '_vipTuStyles';
        s.textContent = [
            '@keyframes vipTuFadeIn{from{opacity:0}to{opacity:1}}',
            '@keyframes vipTuPop{from{transform:scale(0.6);opacity:0}to{transform:scale(1);opacity:1}}',
            '@keyframes vipTuFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}'
        ].join('');
        document.head.appendChild(s);
    }

    var icon = document.createElement('div');
    icon.textContent = tier.icon || '⭐';
    icon.style.cssText = 'font-size:72px;margin-bottom:12px;animation:vipTuFloat 2s ease-in-out infinite;display:block';

    var headline = document.createElement('div');
    headline.textContent = 'VIP TIER UP!';
    headline.style.cssText = 'font-size:13px;letter-spacing:4px;color:#aaa;margin-bottom:6px;font-weight:700';

    var tierName = document.createElement('div');
    tierName.textContent = tier.name || 'Silver';
    tierName.style.cssText = [
        'font-size:42px', 'font-weight:900', 'letter-spacing:2px',
        'color:' + (tier.color || '#ffd700'),
        'text-shadow:0 0 30px ' + (tier.color || '#ffd700') + '88',
        'margin-bottom:10px'
    ].join(';');

    var subtitle = document.createElement('div');
    subtitle.textContent = 'You\'ve unlocked enhanced rewards!';
    subtitle.style.cssText = 'font-size:14px;color:#888;margin-bottom:28px';

    var btn = document.createElement('button');
    btn.textContent = '✨ View Benefits';
    btn.style.cssText = [
        'background:linear-gradient(135deg,' + (tier.color || '#ffd700') + ',' + (tier.color || '#ffd700') + 'aa)',
        'border:none', 'border-radius:12px', 'padding:14px 36px',
        'font-size:16px', 'font-weight:800', 'color:#000', 'cursor:pointer',
        'box-shadow:0 6px 20px ' + (tier.color || '#ffd700') + '44',
        'letter-spacing:1px', 'margin-right:12px'
    ].join(';');
    btn.onclick = function() {
        overlay.remove();
        if (typeof showVipModal === 'function') showVipModal();
    };

    var skipBtn = document.createElement('button');
    skipBtn.textContent = 'Continue Playing';
    skipBtn.style.cssText = 'background:none;border:1px solid #444;border-radius:10px;padding:14px 24px;color:#888;cursor:pointer;font-size:14px';
    skipBtn.onclick = function() { overlay.remove(); };

    var btnRow = document.createElement('div');
    btnRow.appendChild(btn);
    btnRow.appendChild(skipBtn);

    card.appendChild(icon);
    card.appendChild(headline);
    card.appendChild(tierName);
    card.appendChild(subtitle);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Sound + particles
    if (typeof SoundManager !== 'undefined' && SoundManager.playSoundEvent) {
        SoundManager.playSoundEvent('level_up');
    }
    if (typeof burstParticles === 'function') {
        burstParticles(window.innerWidth / 2, window.innerHeight / 2, 80, [tier.color || '#ffd700', '#fff', '#ffb300']);
    }

    // Auto-close after 8 seconds
    setTimeout(function() {
        if (document.getElementById('vipTierUpModal')) overlay.remove();
    }, 8000);
}


// ═══════════════════════════════════════════════════════════════
// VIP ACCELERATOR NUDGE
// Shows a deposit CTA when the player is 60–95% of the way to
// the next VIP tier. Throttled to once per 10 minutes.
// ═══════════════════════════════════════════════════════════════

var _lastVipNudge = 0;
var _vipNudgeCooldown = 10 * 60 * 1000; // 10 minutes

/**
 * Checks whether the player is within the 60–95% progress window
 * toward the next VIP tier and, if so, shows the accelerator overlay.
 * Throttled so it fires at most once per 10 minutes.
 */
function checkVipAcceleratorNudge() {
    if (typeof currentUser === 'undefined' || !currentUser || currentUser.isGuest) return;
    var now = Date.now();
    if (now - _lastVipNudge < _vipNudgeCooldown) return;

    var wagered = (stats && stats.totalWagered) || 0;
    var idx = getVipTierIndex();

    // Already at the highest tier — nothing to promote
    if (idx >= VIP_TIERS.length - 1) return;

    var currentTier = VIP_TIERS[idx];
    var nextTier    = VIP_TIERS[idx + 1];
    var rangeTotal  = nextTier.minWagered - currentTier.minWagered;
    var rangeProgress = wagered - currentTier.minWagered;
    var progress = rangeTotal > 0 ? rangeProgress / rangeTotal : 0;

    // Only nudge when 60–95% of the way to the next tier
    if (progress < 0.60 || progress >= 0.95) return;

    _lastVipNudge = now;

    var needed = nextTier.minWagered - wagered;
    _showVipAcceleratorOverlay(nextTier, needed, progress);
}

/**
 * Renders a bottom-right overlay nudging the player to deposit and
 * wager toward the next VIP tier.
 * @param {object} nextTier  - VIP_TIERS entry for the target tier
 * @param {number} needed    - Dollar amount still needed to reach that tier
 * @param {number} progress  - Fraction (0–1) already completed
 */
function _showVipAcceleratorOverlay(nextTier, needed, progress) {
    var existing = document.getElementById('vipAccelOverlay');
    if (existing) existing.remove();

    var color = nextTier.color || '#ffd700';
    var pct   = Math.round(progress * 100);

    var overlay = document.createElement('div');
    overlay.id = 'vipAccelOverlay';
    overlay.style.cssText = [
        'position:fixed', 'bottom:90px', 'right:20px', 'z-index:10400',
        'background:linear-gradient(135deg,#1a1a2e,#16213e)',
        'border:2px solid ' + color,
        'border-radius:16px', 'padding:20px', 'max-width:300px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6),0 0 20px ' + color + '40',
        'animation:vipSlideIn 0.4s ease-out'
    ].join(';');

    // Header row
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;color:' + color + ';font-size:1rem';
    title.textContent = (nextTier.icon || '\uD83D\uDC51') + ' ' + nextTier.name + ' VIP within reach!';

    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer;padding:0 4px';
    closeBtn.textContent = '\u2715';
    closeBtn.onclick = function() {
        var el = document.getElementById('vipAccelOverlay');
        if (el) el.remove();
    };

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body text
    var body = document.createElement('div');
    body.style.cssText = 'color:#ccc;font-size:0.82rem;margin-bottom:12px';
    body.textContent = "You're " + pct + '% there. Wager $' + Math.ceil(needed).toLocaleString() + ' more to unlock ' + nextTier.name + ' perks.';

    // Progress bar
    var barTrack = document.createElement('div');
    barTrack.style.cssText = 'background:#0d0d1a;border-radius:8px;height:8px;margin-bottom:14px;overflow:hidden';

    var barFill = document.createElement('div');
    barFill.style.cssText = [
        'background:linear-gradient(90deg,' + color + ',#fff)',
        'height:100%', 'width:' + pct + '%',
        'border-radius:8px', 'transition:width 0.5s'
    ].join(';');

    barTrack.appendChild(barFill);

    // Button row
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px';

    var depositBtn = document.createElement('button');
    depositBtn.style.cssText = [
        'flex:1',
        'background:linear-gradient(135deg,' + color + ',#ff8c00)',
        'color:#0d0d1a', 'border:none', 'border-radius:8px',
        'padding:10px', 'font-weight:700', 'cursor:pointer', 'font-size:0.85rem'
    ].join(';');
    depositBtn.textContent = '\uD83D\uDCB3 Deposit Now';
    depositBtn.onclick = function() {
        var el = document.getElementById('vipAccelOverlay');
        if (el) el.remove();
        if (typeof openWalletModal === 'function') openWalletModal();
    };

    var detailsBtn = document.createElement('button');
    detailsBtn.style.cssText = [
        'flex:0 0 auto',
        'background:#1a1a2e',
        'border:1px solid ' + color,
        'color:' + color,
        'border-radius:8px', 'padding:10px', 'cursor:pointer', 'font-size:0.85rem'
    ].join(';');
    detailsBtn.textContent = 'Details';
    detailsBtn.onclick = function() {
        var el = document.getElementById('vipAccelOverlay');
        if (el) el.remove();
        if (typeof openVipModal === 'function') openVipModal();
    };

    btnRow.appendChild(depositBtn);
    btnRow.appendChild(detailsBtn);

    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.appendChild(barTrack);
    overlay.appendChild(btnRow);

    // Inject slide-in keyframe once
    if (!document.getElementById('vipAccelStyle')) {
        var s = document.createElement('style');
        s.id = 'vipAccelStyle';
        s.textContent = '@keyframes vipSlideIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(s);
    }

    document.body.appendChild(overlay);

    // Auto-dismiss after 15 seconds
    setTimeout(function() {
        var el = document.getElementById('vipAccelOverlay');
        if (!el) return;
        el.style.transition = 'opacity 0.5s';
        el.style.opacity = '0';
        setTimeout(function() {
            var el2 = document.getElementById('vipAccelOverlay');
            if (el2) el2.remove();
        }, 500);
    }, 15000);
}

// Expose on window so ui-slot.js can call it after each wager increment
window.checkVipAcceleratorNudge = checkVipAcceleratorNudge;

// ═══════════════════════════════════════════════════════════════
// MEGA WHEEL SECTION
// ═══════════════════════════════════════════════════════════════

function _renderMegaWheelSection(container) {
    // Auth guard
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Inject CSS once
    if (!document.getElementById('mega-wheel-css')) {
        var style = document.createElement('style');
        style.id = 'mega-wheel-css';
        style.textContent = [
            '.mega-wheel-section { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.07); }',
            '.mega-wheel-section h4 { color: #e2b96a; font-size: 14px; margin: 0 0 12px; }',
            '.mega-wheel-tiers { display: flex; gap: 8px; margin-bottom: 14px; }',
            '.mega-wheel-tier-btn { flex: 1; padding: 6px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.05); color: #ccc; font-size: 11px; cursor: pointer; }',
            '.mega-wheel-tier-btn.active { border-color: #e2b96a; background: rgba(226,185,106,0.15); color: #e2b96a; }',
            '.mega-wheel-visual { width: 160px; height: 160px; border-radius: 50%; margin: 0 auto 12px; background: conic-gradient(#7c3aed 0deg 40deg,#e2b96a 40deg 80deg,#0d9488 80deg 120deg,#7c3aed 120deg 160deg,#e2b96a 160deg 200deg,#0d9488 200deg 240deg,#7c3aed 240deg 280deg,#e2b96a 280deg 320deg,#0d9488 320deg 360deg); border: 3px solid #e2b96a; position: relative; }',
            '.mega-wheel-spinning { animation: megaWheelSpin 3s cubic-bezier(0.17,0.67,0.12,0.99) forwards; }',
            '@keyframes megaWheelSpin { from { transform: rotate(0deg); } to { transform: rotate(2880deg); } }',
            '.mega-wheel-spin-btn { display: block; width: 100%; padding: 10px; background: linear-gradient(135deg,#7c3aed,#9333ea); border: none; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; margin-bottom: 8px; }',
            '.mega-wheel-spin-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
            '.mega-wheel-result { text-align: center; font-size: 14px; color: #4ade80; padding: 8px; border-radius: 6px; background: rgba(34,197,94,0.1); }',
            '.mega-wheel-result.error { color: #f87171; background: rgba(248,113,113,0.1); }'
        ].join(' ');
        document.head.appendChild(style);
    }

    // Build section wrapper
    var section = document.createElement('div');
    section.className = 'mega-wheel-section';

    // Header
    var heading = document.createElement('h4');
    heading.textContent = '\uD83C\uDF61 Mega Wheel';
    section.appendChild(heading);

    // Gems balance display
    var gemsRow = document.createElement('div');
    gemsRow.style.cssText = 'font-size:12px;color:#a78bfa;margin-bottom:10px;text-align:center;';
    var gemsVal = (typeof window._gemsBalance === 'number') ? window._gemsBalance : '...';
    gemsRow.textContent = '\uD83D\uDC8E Gems: ' + gemsVal;
    section.appendChild(gemsRow);

    // Fetch gems balance to update display
    (function() {
        fetch('/api/gems/balance', { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (d && typeof d.balance === 'number') {
                    if (typeof window._gemsBalance === 'undefined' || window._gemsBalance !== d.balance) {
                        window._gemsBalance = d.balance;
                    }
                    gemsRow.textContent = '\uD83D\uDC8E Gems: ' + d.balance;
                }
            })
            .catch(function() {});
    })();

    // Tier buttons
    var tierConfig = [
        { id: 'basic', label: 'Basic (50\uD83D\uDC8E)',   cost: 50  },
        { id: 'super', label: 'Super (200\uD83D\uDC8E)',  cost: 200 },
        { id: 'mega',  label: 'Mega (500\uD83D\uDC8E)',   cost: 500 }
    ];
    var activeTier = 'basic';

    var tierRow = document.createElement('div');
    tierRow.className = 'mega-wheel-tiers';

    var tierBtns = [];
    tierConfig.forEach(function(tc) {
        var btn = document.createElement('button');
        btn.className = 'mega-wheel-tier-btn' + (tc.id === activeTier ? ' active' : '');
        btn.textContent = tc.label;
        btn.onclick = function() {
            activeTier = tc.id;
            tierBtns.forEach(function(b, i) {
                if (tierConfig[i].id === activeTier) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
            var active = tierConfig.filter(function(t) { return t.id === activeTier; })[0];
            costSpan.textContent = 'Cost: ' + active.cost + ' \uD83D\uDC8E';
        };
        tierRow.appendChild(btn);
        tierBtns.push(btn);
    });
    section.appendChild(tierRow);

    // Wheel visual
    var wheelDiv = document.createElement('div');
    wheelDiv.className = 'mega-wheel-visual';
    section.appendChild(wheelDiv);

    // Spin button
    var spinBtn = document.createElement('button');
    spinBtn.className = 'mega-wheel-spin-btn';
    spinBtn.textContent = 'SPIN';
    section.appendChild(spinBtn);

    // Cost display (created before onclick, referenced above)
    var costSpan = document.createElement('div');
    costSpan.style.cssText = 'text-align:center;font-size:11px;color:#9ca3af;margin-bottom:8px;';
    costSpan.textContent = 'Cost: 50 \uD83D\uDC8E';
    section.insertBefore(costSpan, spinBtn);

    // Result display
    var resultDiv = document.createElement('div');
    section.appendChild(resultDiv);

    // Spin handler
    spinBtn.onclick = function() {
        spinBtn.disabled = true;
        spinBtn.textContent = 'Spinning\u2026';
        resultDiv.className = '';
        resultDiv.textContent = '';

        wheelDiv.classList.add('mega-wheel-spinning');

        var tier = activeTier;
        fetch('/api/megawheel/spin', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tier: tier })
        })
        .then(function(res) {
            return res.json().then(function(data) {
                return { ok: res.ok, data: data };
            });
        })
        .then(function(result) {
            setTimeout(function() {
                wheelDiv.classList.remove('mega-wheel-spinning');
                spinBtn.disabled = false;
                spinBtn.textContent = 'SPIN';

                if (!result.ok) {
                    resultDiv.className = 'mega-wheel-result error';
                    if (result.data && result.data.error === 'Insufficient gems') {
                        resultDiv.textContent = '\u274C Not enough gems! Earn more by spinning slots.';
                    } else {
                        resultDiv.textContent = '\u274C Spin failed. Please try again.';
                    }
                    return;
                }

                var prize = result.data.prize;
                resultDiv.className = 'mega-wheel-result';
                resultDiv.textContent = '\uD83C\uDF89 You won: ' + prize.label + '!';

                // Update gems balance display
                var gemCost = result.data.gemCost;
                if (typeof window._gemsBalance === 'number' && typeof gemCost === 'number') {
                    window._gemsBalance = Math.max(0, window._gemsBalance - gemCost);
                    gemsRow.textContent = '\uD83D\uDC8E Gems: ' + window._gemsBalance;
                }

                // Update cash balance if cash prize
                if (prize.type === 'credits') {
                    if (typeof updateBalance === 'function') updateBalance();
                    if (typeof saveBalance === 'function' && typeof balance !== 'undefined') {
                        saveBalance(balance + prize.amount);
                    }
                }
            }, 3000);
        })
        .catch(function() {
            setTimeout(function() {
                wheelDiv.classList.remove('mega-wheel-spinning');
                spinBtn.disabled = false;
                spinBtn.textContent = 'SPIN';
                resultDiv.className = 'mega-wheel-result error';
                resultDiv.textContent = '\u274C Network error. Please try again.';
            }, 3000);
        });
    };

    container.appendChild(section);
}

// Periodic check every 30 s — catches cases where stats update outside of spins
setInterval(function() {
    if (typeof currentUser !== 'undefined' && currentUser && !currentUser.isGuest) {
        if (typeof checkVipAcceleratorNudge === 'function') checkVipAcceleratorNudge();
    }
}, 30000);
