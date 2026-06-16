// ═══════════════════════════════════════════════════════
// WALLET / CASHIER MODULE
// ═══════════════════════════════════════════════════════


// ── State ─────────────────────────────────────────────
let walletPaymentMethods = [];
let walletDepositHistory = [];
let walletWithdrawalHistory = [];
let walletActiveTab = 'deposit'; // 'deposit' | 'withdraw' | 'methods' | 'history'
let walletHistoryPage = 1;
let walletHistoryTotalPages = 1;
let walletAddMethodType = null; // tracks which sub-form is open
let walletSessionStartBalance = null;

/**
 * Open wallet modal directly to the withdraw tab.
 * Useful for header shortcuts and engagement nudges.
 */
function showWalletWithdraw() {
    if (!currentUser) {
        showToast('Please log in to access withdrawals.', 'error');
        return;
    }
    walletActiveTab = 'withdraw';
    const modal = document.getElementById('walletModal');
    if (!modal) return;
    modal.classList.add('active');
    const walletBal = document.getElementById('walletBalance');
    if (walletBal) walletBal.textContent = formatMoney(balance);
    loadPaymentMethods();
    renderWalletContent();
    // Highlight the correct tab
    const tabBtns = document.querySelectorAll('.wallet-tab');
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim().toLowerCase() === 'withdraw');
    });
}


// ── Payment Type Metadata ─────────────────────────────
const WALLET_PAYMENT_TYPES = {
    visa: {
        label: 'Visa',
        icon: `<span class="wallet-pay-icon wallet-pay-icon--card"><span class="wallet-pay-icon__emoji">\u{1F4B3}</span><span class="wallet-pay-icon__label">VISA</span></span>`,
        color: '#1a1f71'
    },
    mastercard: {
        label: 'Mastercard',
        icon: `<span class="wallet-pay-icon wallet-pay-icon--card"><span class="wallet-pay-icon__emoji">\u{1F4B3}</span><span class="wallet-pay-icon__label">MC</span></span>`,
        color: '#eb001b'
    },
    payid: {
        label: 'PayID',
        icon: `<span class="wallet-pay-icon wallet-pay-icon--payid"><span class="wallet-pay-icon__emoji">\u{1F4F1}</span><span class="wallet-pay-icon__label">PayID</span></span>`,
        color: '#00b2a9'
    },
    bank_transfer: {
        label: 'Bank Transfer',
        icon: `<span class="wallet-pay-icon wallet-pay-icon--bank"><span class="wallet-pay-icon__emoji">\u{1F3E6}</span><span class="wallet-pay-icon__label">Bank</span></span>`,
        color: '#2563eb'
    }
};

const WALLET_QUICK_AMOUNTS = [10, 25, 50, 100, 250];
const WALLET_DEFAULT_DEPOSIT = 25;
const WALLET_RECOMMENDED_AMOUNT = 25;


// ═══════════════════════════════════════════════════════
// SHOW / HIDE
// ═══════════════════════════════════════════════════════

function showWalletModal() {
    if (!currentUser) {
        showToast('Please log in to access the cashier.', 'error');
        return;
    }
    if (walletSessionStartBalance === null) walletSessionStartBalance = balance;
    const modal = document.getElementById('walletModal');
    if (!modal) return;
    walletActiveTab = 'deposit';
    modal.classList.add('active');
    // Sync balance display in wallet header
    const walletBal = document.getElementById('walletBalance');
    if (walletBal) walletBal.textContent = formatMoney(balance);
    loadPaymentMethods();
    // Check if user has any completed deposits (for first-deposit bonus banner)
    _checkFirstDepositStatus();
    renderWalletContent();
    // Inject gem balance badge + Gem Shop button into wallet header (once)
    _injectWalletGemBar(modal);
    // Refresh gem and loyalty balances from server
    if (typeof refreshGemBalance === 'function') refreshGemBalance();
    refreshLoyaltyBalance();
    refreshRakebackBalance();
    refreshCashbackBalance();
    // Render the full Loyalty Points card section (persistent slot above walletContent)
    _renderLoyaltySection(modal);
    // Render the Deposit Match card section below Loyalty, above Rakeback
    _renderDepositMatchSection(modal);
    // Render the Rakeback card section below Deposit Match
    _renderRakebackSection(modal);
    // Render the Daily Cashback card section below Rakeback
    _renderDailyCashbackSection(modal);
    // Render the Loyalty Shop card section below Daily Cashback
    // walletRenderLoyaltySection applies the ID guard then delegates to _renderLoyaltyShopSection
    walletRenderLoyaltySection(modal);
    // Render the VIP Deposit Bonus card section below Loyalty Shop
    walletRenderVipDepositSection(modal);
    // Render the Weekend Cashback card section below VIP Deposit Bonus
    walletRenderWeekendCashbackSection(modal);
    // Render the Win-Back Bonus card section at the top (after modal is in place)
    walletRenderWinbackSection(modal);
    // Render the VIP Deposit Bonus section (new /api/vipdeposit/ endpoints)
    walletRenderVipDepositBonusSection(modal);
    // Render the Subscription status card
    if (typeof walletRenderSubscriptionSection === 'function') walletRenderSubscriptionSection(modal);
    // Render the Loyalty Shop redeem-points section
    if (typeof walletRenderLoyaltyShopSection === 'function') walletRenderLoyaltyShopSection(modal);
    if (typeof renderLimboCard === 'function') renderLimboCard(modal);
    // Blackjack widget removed
    // Sic Bo removed
if (typeof renderRedDogCard === 'function') renderRedDogCard(modal);
    if (typeof renderDepositStreakCard === 'function') renderDepositStreakCard(modal);
    // Render the Reload Bonus card section
    _renderReloadBonusSection(modal);
    // Render the Deposit Limits section
    _renderDepositLimitsSection(modal);
}

function _injectWalletGemBar(modal) {
    if (modal.querySelector('#walletGemBar')) return; // already injected
    const header = modal.querySelector('.wallet-header');
    if (!header) return;

    const bar = document.createElement('div');
    bar.id = 'walletGemBar';
    bar.style.cssText = [
        'display:flex',
        'align-items:center',
        'justify-content:space-between',
        'padding:8px 20px',
        'background:rgba(167,139,250,0.07)',
        'border-top:1px solid rgba(167,139,250,0.15)',
        'margin-top:12px'
    ].join(';');

    const gemBadge = document.createElement('span');
    gemBadge.style.cssText = 'font-size:0.85rem;color:#a78bfa;font-weight:600;display:flex;align-items:center;gap:6px;';
    // innerHTML used here to embed the gem icon span safely (no user input involved)
    gemBadge.innerHTML = '\uD83D\uDC8E Gems: <span id="walletGemBalance" style="color:#c4b5fd;">...</span>';

    const shopBtn = document.createElement('button');
    shopBtn.textContent = '\uD83D\uDC8E Gem Shop';
    shopBtn.style.cssText = [
        'background:linear-gradient(135deg,#a78bfa,#8b5cf6)',
        'color:#fff',
        'border:none',
        'border-radius:6px',
        'padding:5px 14px',
        'font-size:0.78rem',
        'font-weight:700',
        'cursor:pointer',
        'letter-spacing:0.3px'
    ].join(';');
    shopBtn.addEventListener('click', function() {
        if (typeof openGemsShop === 'function') openGemsShop();
    });

    bar.appendChild(gemBadge);
    bar.appendChild(shopBtn);
    header.appendChild(bar);

    // ── Loyalty Points bar (injected right after gem bar) ──
    const loyaltyBar = document.createElement('div');
    loyaltyBar.id = 'walletLoyaltyBar';
    loyaltyBar.style.cssText = [
        'display:flex',
        'align-items:center',
        'justify-content:space-between',
        'padding:7px 20px',
        'background:rgba(52,211,153,0.06)',
        'border-top:1px solid rgba(52,211,153,0.12)'
    ].join(';');

    const loyaltyBadge = document.createElement('span');
    loyaltyBadge.style.cssText = 'font-size:0.82rem;color:#6ee7b7;font-weight:600;display:flex;align-items:center;gap:5px;';
    loyaltyBadge.innerHTML = '\u{1F3AF} Loyalty: <span id="walletLoyaltyPoints" style="color:#a7f3d0;">...</span> pts';

    const redeemBtn = document.createElement('button');
    redeemBtn.id = 'walletLoyaltyRedeemBtn';
    redeemBtn.textContent = 'Redeem';
    redeemBtn.title = '100 pts = $1.00 — minimum 100 pts';
    redeemBtn.style.cssText = [
        'background:linear-gradient(135deg,#34d399,#059669)',
        'color:#fff',
        'border:none',
        'border-radius:6px',
        'padding:4px 12px',
        'font-size:0.75rem',
        'font-weight:700',
        'cursor:pointer',
        'letter-spacing:0.3px'
    ].join(';');
    redeemBtn.addEventListener('click', function() {
        _redeemLoyaltyPoints();
    });

    loyaltyBar.appendChild(loyaltyBadge);
    loyaltyBar.appendChild(redeemBtn);
    header.appendChild(loyaltyBar);

    // ── Rakeback bar (weekly 1% on net losses, paid weekly) ──
    var rakeBar = document.createElement('div');
    rakeBar.id = 'walletRakebackBar';
    rakeBar.style.cssText = [
        'display:flex', 'align-items:center', 'justify-content:space-between',
        'padding:7px 20px',
        'background:rgba(251,191,36,0.06)',
        'border-top:1px solid rgba(251,191,36,0.12)'
    ].join(';');
    var rakeBadge = document.createElement('span');
    rakeBadge.style.cssText = 'font-size:0.82rem;color:#fcd34d;font-weight:600;display:flex;align-items:center;gap:5px;';
    rakeBadge.innerHTML = '\uD83D\uDCB0 Rakeback: <span id="walletRakebackAmt" style="color:#fef08a;">...</span>';
    var rakeBtn = document.createElement('button');
    rakeBtn.id = 'walletRakebackClaimBtn';
    rakeBtn.textContent = 'Claim';
    rakeBtn.title = 'Weekly 1% rakeback on net losses (paid weekly, up to $50)';
    rakeBtn.style.cssText = [
        'background:linear-gradient(135deg,#f59e0b,#d97706)',
        'color:#fff', 'border:none', 'border-radius:6px',
        'padding:4px 12px', 'font-size:0.75rem', 'font-weight:700',
        'cursor:pointer', 'letter-spacing:0.3px'
    ].join(';');
    rakeBtn.addEventListener('click', function() { _claimRakeback(); });
    rakeBar.appendChild(rakeBadge);
    rakeBar.appendChild(rakeBtn);
    header.appendChild(rakeBar);

    // ── Daily cashback bar (tiered: 2-10% of net losses past 24h) ──
    var cbBar = document.createElement('div');
    cbBar.id = 'walletCashbackBar';
    cbBar.style.cssText = [
        'display:flex', 'align-items:center', 'justify-content:space-between',
        'padding:7px 20px',
        'background:rgba(249,115,22,0.06)',
        'border-top:1px solid rgba(249,115,22,0.12)'
    ].join(';');
    var cbBadge = document.createElement('span');
    cbBadge.style.cssText = 'font-size:0.82rem;color:#fdba74;font-weight:600;display:flex;align-items:center;gap:5px;';
    cbBadge.innerHTML = '\uD83D\uDD04 Cashback: <span id="walletCashbackAmt" style="color:#fed7aa;">...</span>';
    var cbBtn = document.createElement('button');
    cbBtn.id = 'walletCashbackClaimBtn';
    cbBtn.textContent = 'Claim';
    cbBtn.title = 'Daily cashback on net losses (2-10% by VIP tier)';
    cbBtn.style.cssText = [
        'background:linear-gradient(135deg,#f97316,#ea580c)',
        'color:#fff', 'border:none', 'border-radius:6px',
        'padding:4px 12px', 'font-size:0.75rem', 'font-weight:700',
        'cursor:pointer', 'letter-spacing:0.3px'
    ].join(';');
    cbBtn.addEventListener('click', function() { _claimDailyCashback(); });
    cbBar.appendChild(cbBadge);
    cbBar.appendChild(cbBtn);
    header.appendChild(cbBar);
}

function refreshGemBalance() {
    const token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token || typeof isServerAuthToken === 'function' && !isServerAuthToken(token)) return;
    fetch('/api/gems', { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (data && typeof data.gems !== 'undefined') {
                const el = document.getElementById('walletGemBalance');
                if (el) el.textContent = (data.gems || 0).toLocaleString();
            }
        })
        .catch(function() {});
}

function refreshLoyaltyBalance() {
    const token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token || typeof isServerAuthToken === 'function' && !isServerAuthToken(token)) return;
    fetch('/api/loyaltyshop/status', { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (data && typeof data.points !== 'undefined') {
                const el = document.getElementById('walletLoyaltyPoints');
                if (el) el.textContent = (data.points || 0).toLocaleString();
                const btn = document.getElementById('walletLoyaltyRedeemBtn');
                if (btn) btn.disabled = (data.points || 0) < 100;
            }
        })
        .catch(function() {});
}

function _redeemLoyaltyPoints() {
    const el = document.getElementById('walletLoyaltyPoints');
    const currentPts = el ? parseInt(el.textContent.replace(/,/g, ''), 10) || 0 : 0;
    if (currentPts < 100) {
        if (typeof showToast === 'function') showToast('Need at least 100 loyalty pts to redeem (100 pts = $1.00)', 'info', 3000);
        return;
    }
    // Redeem in 100-pt blocks (= $1 each)
    const blocks = Math.floor(currentPts / 100);
    const redeemPts = blocks * 100;
    const creditAmt = (redeemPts / 100).toFixed(2);
    if (!confirm('Redeem ' + redeemPts.toLocaleString() + ' loyalty pts for $' + creditAmt + '?')) return;
    const token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    fetch('/api/loyaltyshop/redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: redeemPts })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (typeof showToast === 'function') showToast('\uD83C\uDFAF Redeemed ' + redeemPts.toLocaleString() + ' pts → $' + creditAmt + ' credited!', 'win', 4000);
            if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(data.newBalance);
            else if (typeof balance !== 'undefined') { balance = data.newBalance; }
            refreshLoyaltyBalance();
            refreshGemBalance();
        } else {
            if (typeof showToast === 'function') showToast(data.error || 'Redemption failed', 'error', 3000);
        }
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Redemption failed — try again', 'error', 3000);
    });
}

function refreshRakebackBalance() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token || typeof isServerAuthToken === 'function' && !isServerAuthToken(token)) return;
    fetch('/api/rakeback/status', { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return;
            var el = document.getElementById('walletRakebackAmt');
            var btn = document.getElementById('walletRakebackClaimBtn');
            var pending = parseFloat(data.pendingRakeback) || 0;
            if (el) el.textContent = '$' + pending.toFixed(2) + ' pending';
            if (btn) btn.disabled = pending < 0.01;
        })
        .catch(function() {});
}

function refreshCashbackBalance() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token || typeof isServerAuthToken === 'function' && !isServerAuthToken(token)) return;
    fetch('/api/dailycashback/status', { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return;
            var el = document.getElementById('walletCashbackAmt');
            var btn = document.getElementById('walletCashbackClaimBtn');
            if (el) {
                if (data.claimed) {
                    el.textContent = '\u2713 Claimed today';
                    el.style.color = '#86efac';
                } else if (data.eligible) {
                    el.textContent = '$' + (parseFloat(data.amount) || 0).toFixed(2) + ' available (' + (data.vipLabel || '') + ' ' + Math.round((data.cashbackRate || 0) * 100) + '%)';
                    el.style.color = '#fed7aa';
                } else {
                    el.textContent = 'None yet';
                    el.style.color = '#9ca3af';
                }
            }
            if (btn) btn.disabled = !data.eligible;
        })
        .catch(function() {});
}

function _claimRakeback() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    var btn = document.getElementById('walletRakebackClaimBtn');
    if (btn) btn.disabled = true;
    fetch('/api/rakeback/claim', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (typeof showToast === 'function') showToast('\uD83D\uDCB0 Rakeback $' + (parseFloat(data.credited) || 0).toFixed(2) + ' credited!', 'win', 4000);
            if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(data.newBalance);
            else if (typeof balance !== 'undefined') balance = data.newBalance;
            refreshRakebackBalance();
        } else {
            if (typeof showToast === 'function') showToast(data.error || 'Nothing to claim yet', 'info', 3000);
            if (btn) btn.disabled = false;
        }
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Claim failed \u2014 try again', 'error', 3000);
        if (btn) btn.disabled = false;
    });
}

function _claimDailyCashback() {
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    var btn = document.getElementById('walletCashbackClaimBtn');
    if (btn) btn.disabled = true;
    fetch('/api/dailycashback/claim', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (typeof showToast === 'function') showToast('\uD83D\uDD04 Daily Cashback $' + (parseFloat(data.credited) || 0).toFixed(2) + ' credited!', 'win', 4000);
            if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(data.newBalance);
            else if (typeof balance !== 'undefined') balance = data.newBalance;
            refreshCashbackBalance();
        } else {
            if (typeof showToast === 'function') showToast(data.error || 'Cashback not available', 'info', 3000);
            if (btn) btn.disabled = false;
        }
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Claim failed \u2014 try again', 'error', 3000);
        if (btn) btn.disabled = false;
    });
}

function _checkFirstDepositStatus() {
    if (window._walletHasCompletedDeposit !== undefined) return; // already checked
    const token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token || !isServerAuthToken(token)) { window._walletHasCompletedDeposit = false; return; }
    fetch('/api/payment/deposits?limit=200', { headers: { Authorization: 'Bearer ' + token } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (data && data.deposits) {
                const completed = data.deposits.filter(d => d.status === 'completed');
                window._walletHasCompletedDeposit = completed.length > 0;
                window._walletTotalDeposited = completed.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
                renderWalletContent(); // re-render with updated info
            }
        })
        .catch(() => {});
}


function hideWalletModal() {
    const modal = document.getElementById('walletModal');
    if (modal) modal.classList.remove('active');
    walletAddMethodType = null;
}


// ═══════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════

function switchWalletTab(tab) {
    walletActiveTab = tab;
    walletAddMethodType = null;

    // Update tab button highlights
    const tabBtns = document.querySelectorAll('.wallet-tab');
    tabBtns.forEach(btn => {
        const isActive = btn.textContent.trim().toLowerCase() === tab;
        btn.classList.toggle('active', isActive);
    });

    renderWalletContent();

    if (tab === 'history') {
        walletHistoryPage = 1;
        loadTransactionHistory(1);
    }
    if (tab === 'methods') {
        loadPaymentMethods();
    }
}


// ═══════════════════════════════════════════════════════
// MASTER RENDER
// ═══════════════════════════════════════════════════════

function renderWalletContent() {
    const container = document.getElementById('walletContent');
    if (!container) return;

    switch (walletActiveTab) {
        case 'deposit':
            renderDepositForm();
            break;
        case 'withdraw':
            renderWithdrawForm();
            break;
        case 'methods':
            renderPaymentMethods();
            break;
        case 'history':
            renderTransactionHistory(walletDepositHistory, {
                page: walletHistoryPage,
                totalPages: walletHistoryTotalPages
            });
            break;
        default:
            renderDepositForm();
    }
}


// ═══════════════════════════════════════════════════════
// PAYMENT METHODS — CRUD
// ═══════════════════════════════════════════════════════

async function loadPaymentMethods() {
    try {
        const res = await apiRequest('/api/payment/methods', { requireAuth: true });
        walletPaymentMethods = Array.isArray(res.methods) ? res.methods : [];
    } catch (err) {
        if (!err.isNetworkError) {
            console.warn('loadPaymentMethods:', err.message);
        }
        walletPaymentMethods = [];
    }
    if (walletActiveTab === 'methods') {
        renderPaymentMethods();
    }
}


function renderPaymentMethods() {
    const container = document.getElementById('walletContent');
    if (!container) return;

    const methodsList = walletPaymentMethods.length > 0
        ? walletPaymentMethods.map(m => {
            const meta = WALLET_PAYMENT_TYPES[m.type] || WALLET_PAYMENT_TYPES.visa;
            return `
                <div class="wallet-method-card${m.is_default ? ' wallet-method-card--default' : ''}">
                    <div class="wallet-method-card__icon">${meta.icon}</div>
                    <div class="wallet-method-card__info">
                        <span class="wallet-method-card__label">${escapeHtml(m.label)}</span>
                        <span class="wallet-method-card__detail">${escapeHtml(m.masked_detail || '')}</span>
                        ${m.is_default ? '<span class="wallet-method-card__badge">DEFAULT</span>' : ''}
                    </div>
                    <div class="wallet-method-card__actions">
                        ${!m.is_default ? `<button class="wallet-btn wallet-btn--sm wallet-btn--ghost" onclick="setDefaultPaymentMethod(${m.id})">Set Default</button>` : ''}
                        <button class="wallet-btn wallet-btn--sm wallet-btn--danger" onclick="removePaymentMethod(${m.id})">Remove</button>
                    </div>
                </div>`;
        }).join('')
        : '<div class="wallet-empty-state">No saved payment methods. Add one below.</div>';

    const addButtons = Object.entries(WALLET_PAYMENT_TYPES).map(([type, meta]) => `
        <button class="wallet-add-method-btn" onclick="showAddMethodForm('${type}')">
            ${meta.icon}
            <span>${meta.label}</span>
        </button>
    `).join('');

    container.innerHTML = `
        <div class="wallet-section">
            <h3 class="wallet-section__title">Saved Payment Methods</h3>
            <div class="wallet-methods-list">${methodsList}</div>
        </div>
        <div class="wallet-section">
            <h3 class="wallet-section__title">Add New Method</h3>
            <div class="wallet-add-method-grid">${addButtons}</div>
            <div id="walletAddMethodForm"></div>
        </div>`;
}


async function addPaymentMethod(type, label, details) {
    try {
        await apiRequest('/api/payment/methods', {
            method: 'POST',
            body: { type, label, details },
            requireAuth: true
        });
        showToast('Payment method added.', 'success');
        hideAddMethodForm();
        await loadPaymentMethods();
    } catch (err) {
        showToast(err.message || 'Failed to add payment method.', 'error');
    }
}


async function removePaymentMethod(id) {
    if (!confirm('Remove this payment method?')) return;
    try {
        await apiRequest(`/api/payment/methods/${id}`, {
            method: 'DELETE',
            requireAuth: true
        });
        showToast('Payment method removed.', 'success');
        await loadPaymentMethods();
    } catch (err) {
        showToast(err.message || 'Failed to remove payment method.', 'error');
    }
}


async function setDefaultPaymentMethod(id) {
    try {
        await apiRequest(`/api/payment/methods/${id}/default`, {
            method: 'PUT',
            requireAuth: true
        });
        showToast('Default payment method updated.', 'success');
        await loadPaymentMethods();
    } catch (err) {
        showToast(err.message || 'Failed to update default method.', 'error');
    }
}


// ═══════════════════════════════════════════════════════
// FIRST-DEPOSIT WELCOME BANNER
// ═══════════════════════════════════════════════════════

var _walletBannerStylesInjected = false;

function _injectFirstDepositBannerStyles() {
    if (_walletBannerStylesInjected) return;
    _walletBannerStylesInjected = true;
    var style = document.createElement('style');
    style.id = 'wallet-first-deposit-banner-styles';
    style.textContent = [
        '.wallet-first-deposit-banner{background:linear-gradient(135deg,rgba(251,191,36,0.12),rgba(217,119,6,0.06));border:1.5px solid rgba(251,191,36,0.35);border-radius:14px;padding:16px;margin-bottom:16px;text-align:center;}',
        '.wfdb-badge{display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:11px;font-weight:800;letter-spacing:1px;padding:3px 12px;border-radius:20px;margin-bottom:8px;}',
        '.wfdb-title{color:#fbbf24;font-size:17px;font-weight:900;margin-bottom:12px;}',
        '.wfdb-offers{display:flex;justify-content:center;gap:16px;margin-bottom:10px;}',
        '.wfdb-offer{display:flex;flex-direction:column;align-items:center;}',
        '.wfdb-num{color:#fff;font-size:20px;font-weight:900;line-height:1;}',
        '.wfdb-lbl{color:rgba(255,255,255,0.45);font-size:10px;margin-top:3px;}',
        '.wfdb-note{color:rgba(255,255,255,0.3);font-size:10px;}'
    ].join('');
    document.head.appendChild(style);
}

function _renderFirstDepositBanner() {
    if (localStorage.getItem('hasEverDeposited')) return '';
    _injectFirstDepositBannerStyles();
    return '<div class="wallet-first-deposit-banner">' +
        '<div class="wfdb-badge">\uD83C\uDF81 WELCOME OFFER</div>' +
        '<div class="wfdb-title">100% Match on Your First Deposit!</div>' +
        '<div class="wfdb-offers">' +
            '<div class="wfdb-offer"><span class="wfdb-num">$500</span><span class="wfdb-lbl">Max Bonus</span></div>' +
            '<div class="wfdb-offer"><span class="wfdb-num">50</span><span class="wfdb-lbl">Free Spins</span></div>' +
            '<div class="wfdb-offer"><span class="wfdb-num">+$5</span><span class="wfdb-lbl">No-Deposit Gift</span></div>' +
        '</div>' +
        '<div class="wfdb-note">Minimum deposit $10 \xB7 T&Cs apply</div>' +
    '</div>';
}

// ═══════════════════════════════════════════════════════
// DEPOSIT FORM
// ═══════════════════════════════════════════════════════

function renderDepositForm() {
    const container = document.getElementById('walletContent');
    if (!container) return;

    // ── VIP Tier Progress Bar ──────────────────────────────────────────────
    const VIP_TIERS = [
        { label: 'Bronze',   min: 100,    cashback: '6%'  },
        { label: 'Silver',   min: 500,    cashback: '8%'  },
        { label: 'Gold',     min: 2000,   cashback: '10%' },
        { label: 'Platinum', min: 10000,  cashback: '15%' },
        { label: 'Diamond',  min: 50000,  cashback: '20%' }
    ];
    const totalWagered = (typeof stats !== 'undefined' ? stats.totalWagered || 0 : 0);
    let curTierIdx = -1;
    for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
        if (totalWagered >= VIP_TIERS[i].min) { curTierIdx = i; break; }
    }
    const curTier   = curTierIdx >= 0 ? VIP_TIERS[curTierIdx]     : null;
    const nextTier  = curTierIdx < VIP_TIERS.length - 1 ? VIP_TIERS[curTierIdx + 1] : null;
    const prevMin   = curTier ? curTier.min : 0;
    const pct       = nextTier ? Math.min(100, ((totalWagered - prevMin) / (nextTier.min - prevMin)) * 100) : 100;
    const tierLabel = curTier ? curTier.label : 'No Tier';
    const tierColor = curTierIdx === 4 ? '#b9f2ff' : curTierIdx === 3 ? '#e5cfff' : curTierIdx === 2 ? '#ffd700' : curTierIdx === 1 ? '#94a3b8' : '#cd7f32';
    const vipBarHtml = `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 14px;margin-bottom:10px;font-size:0.78rem;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
    <span style="color:${tierColor};font-weight:700;">${tierLabel} Tier${curTier ? ' · ' + curTier.cashback + ' cashback' : ''}</span>
    <span style="color:#94a3b8;">${nextTier ? '$' + (nextTier.min - totalWagered).toLocaleString() + ' to ' + nextTier.label + ' (' + nextTier.cashback + ' cashback)' : 'Max tier reached!'}</span>
  </div>
  <div style="background:rgba(255,255,255,0.08);border-radius:4px;height:6px;overflow:hidden;">
    <div style="width:${pct.toFixed(1)}%;height:100%;background:linear-gradient(90deg,${tierColor},#fff8);border-radius:4px;transition:width 0.4s;"></div>
  </div>
</div>`;
    // ────────────────────────────────────────────────────────────────────────

    const walletStart = walletSessionStartBalance !== null ? walletSessionStartBalance : balance;
    const netChange = balance - walletStart;
    const netClass = netChange > 0 ? 'wst-pos' : netChange < 0 ? 'wst-neg' : 'wst-neutral';
    const netSign = netChange >= 0 ? '+' : '';
    const netArrow = netChange > 0 ? '▲' : netChange < 0 ? '▼' : '–';
    const sessionTrackerHtml = `<div id="walletSessionTracker">
  <span class="wst-label">Session start:</span>
  <span class="wst-amount">$${formatMoney(walletStart)}</span>
  <span class="wst-sep">·</span>
  <span class="wst-label">Net:</span>
  <span class="wst-net ${netClass}">${netSign}$${formatMoney(Math.abs(netChange))} ${netArrow}</span>
</div>`;

    const quickBtns = WALLET_QUICK_AMOUNTS.map(amt =>
        `<button class="wallet-quick-btn${amt === WALLET_RECOMMENDED_AMOUNT ? ' wallet-quick-btn--recommended' : ''}" onclick="walletSetDepositAmount(${amt})">$${amt}${amt === WALLET_RECOMMENDED_AMOUNT ? '<span class="wallet-quick-popular">Popular</span>' : ''}</button>`
    ).join('');

    const payTypeCards = Object.entries(WALLET_PAYMENT_TYPES).map(([type, meta]) => `
        <label class="wallet-pay-card" data-type="${type}">
            <input type="radio" name="walletDepositType" value="${type}" class="wallet-pay-card__radio">
            <div class="wallet-pay-card__inner" style="--pay-accent: ${meta.color}">
                ${meta.icon}
                <span class="wallet-pay-card__name">${meta.label}</span>
            </div>
        </label>
    `).join('');

    const savedOptions = walletPaymentMethods.length > 0
        ? `<div class="wallet-field">
                <label class="wallet-label">Use Saved Method</label>
                <select id="walletSavedMethod" class="wallet-select" onchange="walletOnSavedMethodChange()">
                    <option value="">-- Select saved method --</option>
                    ${walletPaymentMethods.map(m => {
                        const meta = WALLET_PAYMENT_TYPES[m.type] || {};
                        return `<option value="${m.id}" data-type="${m.type}">${meta.label || m.type} - ${escapeHtml(m.label)}</option>`;
                    }).join('')}
                </select>
           </div>`
        : '';

    const lowBalBanner = (balance > 0 && balance < 20) ? `
    <div style="background:linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,140,0,0.05));border:1px solid rgba(255,215,0,0.3);border-radius:10px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">&#x1F381;</span>
        <div>
            <div style="font-size:0.85rem;font-weight:700;color:#ffd700;margin-bottom:2px;">50% Reload Bonus Available</div>
            <div style="font-size:0.75rem;color:#94a3b8;">Deposit now and we'll match 50% up to $250. Keep the winnings rolling!</div>
        </div>
    </div>` : '';

    container.innerHTML = _renderFirstDepositBanner() + vipBarHtml + sessionTrackerHtml + lowBalBanner + `
        <div class="wallet-section">
            <div class="wallet-balance-display">
                <span class="wallet-balance-display__label">Current Balance</span>
                <span class="wallet-balance-display__amount">$${formatMoney(balance)}</span>
            </div>
        </div>

        <div class="wallet-section">
            <h3 class="wallet-section__title">Deposit Amount</h3>
            <div class="wallet-field">
                <div class="wallet-amount-input-wrap">
                    <span class="wallet-amount-input-wrap__prefix">$</span>
                    <input type="number" id="walletDepositAmount" class="wallet-input wallet-input--amount"
                           inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9]*"
                           min="1" step="1" value="25" placeholder="0.00">
                </div>
            </div>
            <div class="wallet-quick-amounts">${quickBtns}</div>
        </div>

        <div class="wallet-section">
            <h3 class="wallet-section__title">Payment Method</h3>
            ${savedOptions}
            <div class="wallet-pay-grid">${payTypeCards}</div>
        </div>

        <div class="wallet-section wallet-section--actions">
            <div style="text-align:center;font-size:12px;color:#c084fc;margin-bottom:10px;font-weight:600">
                💎 Earn gems on every deposit — $5 = 100 gems, $50 = 1000 gems, $100+ = 2500 gems
            </div>
            <button class="wallet-btn wallet-btn--primary wallet-btn--lg" onclick="submitDeposit()">
                <span class="wallet-btn__icon">\u2B07</span> Deposit Funds
            </button>
        </div>`;

    // Pre-select first payment type
    const firstRadio = container.querySelector('.wallet-pay-card__radio');
    if (firstRadio) {
        firstRadio.checked = true;
        firstRadio.closest('.wallet-pay-card').classList.add('wallet-pay-card--selected');
    }

    // Bind radio change listeners
    container.querySelectorAll('.wallet-pay-card__radio').forEach(radio => {
        radio.addEventListener('change', () => {
            container.querySelectorAll('.wallet-pay-card').forEach(c => c.classList.remove('wallet-pay-card--selected'));
            if (radio.checked) radio.closest('.wallet-pay-card').classList.add('wallet-pay-card--selected');
        });
    });

    // First-deposit bonus banner (DOM-safe)
    if (!window._walletHasCompletedDeposit) {
        const banner = document.createElement('div');
        banner.style.cssText = 'background:linear-gradient(135deg,#ffd700,#ff8c00);color:#0d0d1a;padding:14px 18px;border-radius:10px;margin-bottom:16px;text-align:center;font-weight:700;box-shadow:0 0 20px rgba(255,215,0,0.4);';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:1.3rem;margin-bottom:4px;';
        title.textContent = '🎁 FIRST DEPOSIT BONUS';
        const desc = document.createElement('div');
        desc.style.cssText = 'font-weight:500;font-size:0.85rem;';
        desc.textContent = 'Get +$5 free credits + 1,000 💎 gems on your first deposit!';
        banner.appendChild(title);
        banner.appendChild(desc);
        container.insertBefore(banner, container.firstChild);
    }

    // Free spins display — fetched asynchronously and injected into the balance section
    walletFetchAndShowFreeSpins(container);
}


/**
 * Fetch free spins balance from GET /api/freespins/status and inject a
 * display row after the main balance in the deposit form container.
 * Requires auth; silently no-ops if not logged in or no spins.
 */
async function walletFetchAndShowFreeSpins(container) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var tokenKey = (typeof STORAGE_KEY_TOKEN !== 'undefined') ? STORAGE_KEY_TOKEN : 'casinoToken';
    var token = localStorage.getItem(tokenKey);
    if (!token) return;

    var data;
    try {
        var resp = await fetch('/api/freespins/status', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!resp.ok) return;
        data = await resp.json();
    } catch (e) {
        return;
    }

    var count = (data && data.count) ? Number(data.count) : 0;
    if (count <= 0) return; // No free spins — nothing to show

    // Find the balance display element and insert a row after it
    var balanceSection = container.querySelector('.wallet-balance-display');
    if (!balanceSection || !balanceSection.parentNode) return;

    var row = document.createElement('div');
    row.id = 'walletFreeSpinsRow';
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:8px 12px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);border-radius:8px;font-size:0.82rem;';

    var label = document.createElement('span');
    label.style.color = '#c4b5fd';
    label.textContent = 'Free Spins Available';
    row.appendChild(label);

    var badge = document.createElement('span');
    badge.style.cssText = 'font-weight:700;color:#a855f7;background:rgba(168,85,247,0.18);padding:2px 10px;border-radius:12px;';
    badge.textContent = String(count);
    row.appendChild(badge);

    if (data.expiresAt) {
        var expiry = document.createElement('div');
        expiry.style.cssText = 'font-size:0.72rem;color:#94a3b8;margin-top:4px;';
        try {
            var expDate = new Date(data.expiresAt);
            expiry.textContent = 'Expires: ' + expDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            expiry.textContent = 'Expires: ' + data.expiresAt;
        }
        row.appendChild(expiry);
    }

    // Insert the row after the balance display div (inside the same wallet-section)
    var parentSection = balanceSection.parentNode;
    parentSection.insertBefore(row, balanceSection.nextSibling);
}


function walletSetDepositAmount(amount) {
    const input = document.getElementById('walletDepositAmount');
    if (input) input.value = amount;
}


function walletOnSavedMethodChange() {
    const sel = document.getElementById('walletSavedMethod');
    if (!sel || !sel.value) return;
    const opt = sel.options[sel.selectedIndex];
    const type = opt.dataset.type;
    if (type) {
        const radio = document.querySelector(`.wallet-pay-card__radio[value="${type}"]`);
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }
    }
}


async function submitDeposit() {
    const amountInput = document.getElementById('walletDepositAmount');
    const amount = parseFloat(amountInput?.value);
    if (!Number.isFinite(amount) || amount <= 0) {
        showToast('Enter a valid deposit amount.', 'error');
        return;
    }

    const selectedRadio = document.querySelector('.wallet-pay-card__radio:checked');
    const paymentType = selectedRadio?.value;
    if (!paymentType) {
        showToast('Select a payment method.', 'error');
        return;
    }

    const savedMethodSel = document.getElementById('walletSavedMethod');
    const savedMethodId = savedMethodSel?.value || null;

    try {
        const res = await apiRequest('/api/payment/deposit', {
            method: 'POST',
            body: {
                amount,
                paymentType,
                paymentMethodId: savedMethodId ? parseInt(savedMethodId, 10) : undefined
            },
            requireAuth: true
        });

        // If the server returned an updated balance (admin-approved or instant),
        // update locally. Otherwise the deposit is pending — do NOT fake-add balance.
        if (res.deposit && res.deposit.status === 'pending') {
            showToast(
                `$${formatMoney(amount)} deposit submitted! Funds will appear once payment is confirmed.`,
                'success'
            );
            if (res.gemsAwarded > 0) {
                setTimeout(() => showToast(`\u{1F48E} +${res.gemsAwarded} gems credited to your account!`, 'success', 4000), 1500);
            }
        } else {
            const newBalance = Number(res.balance);
            if (Number.isFinite(newBalance)) {
                balance = newBalance;
                updateBalance();
                resetNudgeOnDeposit();
            }
            const gemMsg = res.gemsAwarded ? ` + \u{1F48E} ${res.gemsAwarded} gems!` : '';
            showToast(`${formatMoney(amount)} deposited successfully!${gemMsg}`, 'success');
            try { localStorage.setItem('hasEverDeposited', '1'); } catch (e) { /* ignore */ }
        }
        if (amountInput) amountInput.value = '';
        renderDepositForm(); // refresh to show updated state
    } catch (err) {
        showToast(err.message || 'Deposit failed. Please try again.', 'error');
    }
}


// ═══════════════════════════════════════════════════════
// WITHDRAWAL FORM
// ═══════════════════════════════════════════════════════

function renderWithdrawForm() {
    const container = document.getElementById('walletContent');
    if (!container) return;

    const walletStart = walletSessionStartBalance !== null ? walletSessionStartBalance : balance;
    const netChange = balance - walletStart;
    const netClass = netChange > 0 ? 'wst-pos' : netChange < 0 ? 'wst-neg' : 'wst-neutral';
    const netSign = netChange >= 0 ? '+' : '';
    const netArrow = netChange > 0 ? '▲' : netChange < 0 ? '▼' : '–';
    const sessionTrackerHtml = `<div id="walletSessionTracker">
  <span class="wst-label">Session start:</span>
  <span class="wst-amount">$${formatMoney(walletStart)}</span>
  <span class="wst-sep">·</span>
  <span class="wst-label">Net:</span>
  <span class="wst-net ${netClass}">${netSign}$${formatMoney(Math.abs(netChange))} ${netArrow}</span>
</div>`;

    const payTypeCards = Object.entries(WALLET_PAYMENT_TYPES).map(([type, meta]) => `
        <label class="wallet-pay-card" data-type="${type}">
            <input type="radio" name="walletWithdrawType" value="${type}" class="wallet-pay-card__radio">
            <div class="wallet-pay-card__inner" style="--pay-accent: ${meta.color}">
                ${meta.icon}
                <span class="wallet-pay-card__name">${meta.label}</span>
            </div>
        </label>
    `).join('');

    // Pending withdrawals section
    const pendingHtml = walletWithdrawalHistory.length > 0
        ? `<div class="wallet-section">
                <h3 class="wallet-section__title">Pending Withdrawals</h3>
                <div class="wallet-pending-list">
                    ${walletWithdrawalHistory.map(w => `
                        <div class="wallet-pending-item">
                            <div class="wallet-pending-item__info">
                                <span class="wallet-pending-item__amount">$${formatMoney(w.amount)}</span>
                                <span class="wallet-pending-item__meta">${WALLET_PAYMENT_TYPES[w.payment_type]?.label || w.payment_type} &middot; ${walletFormatDate(w.created_at)}</span>
                            </div>
                            <button class="wallet-btn wallet-btn--sm wallet-btn--danger" onclick="cancelWithdrawal(${w.id})">Cancel</button>
                        </div>
                    `).join('')}
                </div>
           </div>`
        : '';

    container.innerHTML = sessionTrackerHtml + `
        <div class="wallet-section">
            <div class="wallet-balance-display">
                <span class="wallet-balance-display__label">Available to Withdraw</span>
                <span class="wallet-balance-display__amount">$${formatMoney(balance)}</span>
            </div>
        </div>

        <div class="wallet-section">
            <h3 class="wallet-section__title">Withdrawal Amount</h3>
            <div class="wallet-field">
                <div class="wallet-amount-input-wrap">
                    <span class="wallet-amount-input-wrap__prefix">$</span>
                    <input type="number" id="walletWithdrawAmount" class="wallet-input wallet-input--amount"
                           inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9]*"
                           min="1" max="${balance}" step="1" value="" placeholder="0.00">
                </div>
            </div>
            <div class="wallet-quick-amounts">
                <button class="wallet-quick-btn" onclick="walletSetWithdrawAmount(25)">$25</button>
                <button class="wallet-quick-btn" onclick="walletSetWithdrawAmount(50)">$50</button>
                <button class="wallet-quick-btn" onclick="walletSetWithdrawAmount(100)">$100</button>
                <button class="wallet-quick-btn" onclick="walletSetWithdrawAmount('all')">All</button>
            </div>
        </div>

        <div class="wallet-section">
            <h3 class="wallet-section__title">Withdraw To</h3>
            <div class="wallet-pay-grid">${payTypeCards}</div>
        </div>

        <div class="wallet-section wallet-section--actions">
            <button class="wallet-btn wallet-btn--primary wallet-btn--lg" onclick="submitWithdrawal()">
                <span class="wallet-btn__icon">\u2B06</span> Request Withdrawal
            </button>
        </div>

        ${pendingHtml}`;

    // Pre-select first payment type
    const firstRadio = container.querySelector('.wallet-pay-card__radio');
    if (firstRadio) {
        firstRadio.checked = true;
        firstRadio.closest('.wallet-pay-card').classList.add('wallet-pay-card--selected');
    }

    container.querySelectorAll('.wallet-pay-card__radio').forEach(radio => {
        radio.addEventListener('change', () => {
            container.querySelectorAll('.wallet-pay-card').forEach(c => c.classList.remove('wallet-pay-card--selected'));
            if (radio.checked) radio.closest('.wallet-pay-card').classList.add('wallet-pay-card--selected');
        });
    });

    // Show wagering requirement progress (if stats available)
    if (typeof stats !== 'undefined' && stats.totalWagered !== undefined) {
        const totalDep = window._walletTotalDeposited || 0;
        if (totalDep > 0) {
            const wagered = stats.totalWagered || 0;
            const pct = Math.min(100, (wagered / totalDep) * 100);
            const met = wagered >= totalDep;
            const wagerDiv = document.createElement('div');
            wagerDiv.style.cssText = 'padding:12px 16px;border-radius:8px;margin-top:8px;border:1px solid ' + (met ? '#10b981' : '#fbbf24') + ';background:rgba(' + (met ? '16,185,129' : '251,191,36') + ',0.1);';
            const label = document.createElement('div');
            label.style.cssText = 'font-size:0.8rem;color:#94a3b8;margin-bottom:6px;';
            label.textContent = met ? 'Wagering requirement met' : 'Wagering requirement: ' + formatMoney(wagered) + ' / ' + formatMoney(totalDep);
            wagerDiv.appendChild(label);
            if (!met) {
                const barBg = document.createElement('div');
                barBg.style.cssText = 'height:6px;background:#1e293b;border-radius:3px;overflow:hidden;';
                const barFill = document.createElement('div');
                barFill.style.cssText = 'height:100%;border-radius:3px;background:linear-gradient(90deg,#fbbf24,#f59e0b);width:' + pct.toFixed(1) + '%;transition:width 0.3s;';
                barBg.appendChild(barFill);
                wagerDiv.appendChild(barBg);
            }
            // Insert before the actions section
            const actionsSection = container.querySelector('.wallet-section--actions');
            if (actionsSection) container.insertBefore(wagerDiv, actionsSection);
        }
    }
}


function walletSetWithdrawAmount(value) {
    const input = document.getElementById('walletWithdrawAmount');
    if (!input) return;
    if (value === 'all') {
        input.value = Math.floor(balance);
    } else {
        input.value = value;
    }
}


async function submitWithdrawal() {
    const amountInput = document.getElementById('walletWithdrawAmount');
    const amount = parseFloat(amountInput?.value);
    if (!Number.isFinite(amount) || amount <= 0) {
        showToast('Enter a valid withdrawal amount.', 'error');
        return;
    }
    if (amount > balance) {
        showToast('Insufficient balance for this withdrawal.', 'error');
        return;
    }

    const selectedRadio = document.querySelector('input[name="walletWithdrawType"]:checked');
    const paymentType = selectedRadio?.value;
    if (!paymentType) {
        showToast('Select a withdrawal method.', 'error');
        return;
    }

    try {
        const res = await apiRequest('/api/payment/withdraw', {
            method: 'POST',
            body: { amount, paymentType },
            requireAuth: true
        });

        const newBalance = Number(res.balance);
        if (Number.isFinite(newBalance)) {
            balance = newBalance;
            updateBalance();
        }

        // Add to pending list before any further UI
        if (res.withdrawal) {
            walletWithdrawalHistory.unshift(res.withdrawal);
        }

        // High-value withdrawals ≥ WITHDRAWAL_OTP_THRESHOLD require email OTP.
        // Server returns { otpRequired: true, otpExpiryMinutes } — prompt for the code.
        if (res.otpRequired && res.withdrawal && res.withdrawal.id) {
            renderWithdrawForm();
            await promptWithdrawalOtp(res.withdrawal.id, amount, res.otpExpiryMinutes || 15);
            return;
        }

        const processingDays = res.estimatedDays || 3;
        const eta = new Date(Date.now() + processingDays * 86400000);
        const etaStr = eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        showToast(res.message || `Withdrawal of $${formatMoney(amount)} submitted. Expected by ${etaStr}.`, 'success', 6000);

        renderWithdrawForm();
    } catch (err) {
        showToast(err.message || 'Withdrawal request failed.', 'error');
    }
}

/**
 * Minimal blocking prompt for withdrawal OTP entry.
 * Server has emailed a 6-digit code to the user; we loop until they
 * enter the correct code, explicitly cancel, or hit 5 wrong attempts
 * (after which the server cancels + refunds the withdrawal).
 */
async function promptWithdrawalOtp(withdrawalId, amount, expiryMinutes) {
    let attemptsLeft = 5;
    while (attemptsLeft > 0) {
        const code = window.prompt(
            `A 6-digit verification code has been emailed to confirm your $${formatMoney(amount)} withdrawal.\n\n` +
            `Enter the code (expires in ${expiryMinutes} min). Leave blank to cancel.`
        );
        if (code == null) {
            showToast('Withdrawal pending — enter the code from your email to finish it.', 'info', 6000);
            return;
        }
        const cleaned = String(code).trim();
        if (!/^\d{6}$/.test(cleaned)) {
            showToast('Code must be exactly 6 digits. Check your email.', 'error');
            continue;
        }
        try {
            await apiRequest('/api/payment/withdraw/verify-otp', {
                method: 'POST',
                body: { withdrawal_id: withdrawalId, otp: cleaned },
                requireAuth: true
            });
            showToast('Verification code accepted. Your withdrawal is queued for admin review.', 'success', 6000);
            return;
        } catch (err) {
            attemptsLeft--;
            const msg = err.message || 'Incorrect code.';
            if (attemptsLeft <= 0 || /cancelled|refunded|expired/i.test(msg)) {
                showToast(msg, 'error', 8000);
                return;
            }
            showToast(msg, 'error');
        }
    }
}


async function cancelWithdrawal(id) {
    if (!confirm('Cancel this pending withdrawal?')) return;
    try {
        const res = await apiRequest(`/api/payment/withdraw/${id}/cancel`, {
            method: 'POST',
            requireAuth: true
        });

        const newBalance = Number(res.balance);
        if (Number.isFinite(newBalance)) {
            balance = newBalance;
            updateBalance();
        }

        walletWithdrawalHistory = walletWithdrawalHistory.filter(w => w.id !== id);
        showToast('Withdrawal cancelled.', 'success');
        renderWithdrawForm();
    } catch (err) {
        showToast(err.message || 'Failed to cancel withdrawal.', 'error');
    }
}


// ═══════════════════════════════════════════════════════
// TRANSACTION HISTORY
// ═══════════════════════════════════════════════════════

async function loadTransactionHistory(page) {
    walletHistoryPage = page || 1;
    try {
        const res = await apiRequest(`/api/user/transactions?page=${walletHistoryPage}&limit=20`, {
            requireAuth: true
        });
        const transactions = Array.isArray(res.transactions) ? res.transactions : [];
        const pagination = res.pagination || { page: walletHistoryPage, totalPages: 1 };
        walletHistoryTotalPages = pagination.totalPages || 1;
        renderTransactionHistory(transactions, pagination);
    } catch (err) {
        if (!err.isNetworkError) {
            console.warn('loadTransactionHistory:', err.message);
        }
        renderTransactionHistory([], { page: 1, totalPages: 1 });
    }
}


function renderTransactionHistory(transactions, pagination) {
    const container = document.getElementById('walletContent');
    if (!container) return;

    const rows = transactions.length > 0
        ? transactions.map(tx => {
            const isCredit = tx.type === 'deposit' || tx.type === 'bonus' || tx.type === 'refund';
            const sign = isCredit ? '+' : '-';
            const colorClass = isCredit ? 'wallet-tx--credit' : 'wallet-tx--debit';
            const typeLabel = walletTxTypeLabel(tx.type);
            const txIconMap = { deposit: '💰', withdrawal: '➡️', bet: '🎰', win: '🏆', bonus: '🎁', refund: '🔄', free_spin: '⚡' };
            const icon = txIconMap[tx.type] || '💳';
            return `
                <tr class="wallet-tx-row ${colorClass}">
                    <td class="wallet-tx-cell">
                        <span class="wallet-tx-type-badge wallet-tx-type-badge--${tx.type}"><span class="wallet-tx-icon">${icon}</span> ${typeLabel}</span>
                    </td>
                    <td class="wallet-tx-cell wallet-tx-cell--amount">${sign}$${formatMoney(Math.abs(tx.amount))}</td>
                    <td class="wallet-tx-cell wallet-tx-cell--date">${walletFormatDate(tx.created_at)}</td>
                    <td class="wallet-tx-cell wallet-tx-cell--ref">${escapeHtml(tx.reference || '--')}</td>
                </tr>`;
        }).join('')
        : `<tr><td class="wallet-tx-cell wallet-tx-empty" colspan="4">No transactions found.</td></tr>`;

    const paginationHtml = pagination.totalPages > 1
        ? `<div class="wallet-pagination">
                <button class="wallet-btn wallet-btn--sm wallet-btn--ghost"
                        onclick="loadTransactionHistory(${pagination.page - 1})"
                        ${pagination.page <= 1 ? 'disabled' : ''}>
                    &laquo; Prev
                </button>
                <span class="wallet-pagination__info">Page ${pagination.page} of ${pagination.totalPages}</span>
                <button class="wallet-btn wallet-btn--sm wallet-btn--ghost"
                        onclick="loadTransactionHistory(${pagination.page + 1})"
                        ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>
                    Next &raquo;
                </button>
           </div>`
        : '';

    container.innerHTML = `
        <div class="wallet-section">
            <h3 class="wallet-section__title">Transaction History</h3>
            <div class="wallet-table-wrap">
                <table class="wallet-table">
                    <thead>
                        <tr>
                            <th class="wallet-th">Type</th>
                            <th class="wallet-th">Amount</th>
                            <th class="wallet-th">Date</th>
                            <th class="wallet-th">Reference</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${paginationHtml}
        </div>`;
}


// ═══════════════════════════════════════════════════════
// ADD PAYMENT METHOD SUB-FORM
// ═══════════════════════════════════════════════════════

function showAddMethodForm(type) {
    walletAddMethodType = type;
    const formContainer = document.getElementById('walletAddMethodForm');
    if (!formContainer) return;

    let fieldsHtml = '';
    const meta = WALLET_PAYMENT_TYPES[type] || {};

    switch (type) {
        case 'visa':
        case 'mastercard':
            fieldsHtml = `
                <div class="wallet-field">
                    <label class="wallet-label">Name on Card</label>
                    <input type="text" id="walletMethodCardName" class="wallet-input" placeholder="John Doe" autocomplete="off">
                </div>
                <div class="wallet-field">
                    <label class="wallet-label">Card Number (last 4 digits)</label>
                    <input type="text" id="walletMethodCardLast4" class="wallet-input" maxlength="4"
                           placeholder="1234" pattern="[0-9]{4}" autocomplete="off">
                </div>`;
            break;

        case 'payid':
            fieldsHtml = `
                <div class="wallet-field">
                    <label class="wallet-label">PayID (email or phone)</label>
                    <input type="text" id="walletMethodPayId" class="wallet-input" placeholder="you@email.com or 04XX XXX XXX" autocomplete="off">
                </div>`;
            break;

        case 'bank_transfer':
            fieldsHtml = `
                <div class="wallet-field">
                    <label class="wallet-label">Account Name</label>
                    <input type="text" id="walletMethodBankName" class="wallet-input" placeholder="Account holder name" autocomplete="off">
                </div>
                <div class="wallet-field">
                    <label class="wallet-label">BSB</label>
                    <input type="text" id="walletMethodBSB" class="wallet-input" maxlength="7" placeholder="000-000" autocomplete="off">
                </div>
                <div class="wallet-field">
                    <label class="wallet-label">Account Number (last 4 digits)</label>
                    <input type="text" id="walletMethodBankLast4" class="wallet-input" maxlength="4"
                           placeholder="1234" pattern="[0-9]{4}" autocomplete="off">
                </div>`;
            break;

        case 'btc':
        case 'eth':
        case 'usdt':
            fieldsHtml = `
                <div class="wallet-field">
                    <label class="wallet-label">Account Number</label>
                    <input type="text" id="walletMethodDigitalAddr" class="wallet-input wallet-input--mono"
                           placeholder="${type === 'btc' ? 'bc1q...' : '0x...'}" autocomplete="off">
                </div>
                <div class="wallet-field">
                    <label class="wallet-label">Network</label>
                    <select id="walletMethodDigitalNetwork" class="wallet-select">
                        ${walletDigitalNetworkOptions(type)}
                    </select>
                </div>`;
            break;

        default:
            fieldsHtml = '<p class="wallet-text--muted">Unsupported payment type.</p>';
    }

    formContainer.innerHTML = `
        <div class="wallet-add-form">
            <div class="wallet-add-form__header">
                <span class="wallet-add-form__title">${meta.icon || ''} Add ${meta.label || type}</span>
                <button class="wallet-btn wallet-btn--sm wallet-btn--ghost" onclick="hideAddMethodForm()">&times;</button>
            </div>
            <div class="wallet-add-form__body">
                ${fieldsHtml}
            </div>
            <div class="wallet-add-form__footer">
                <button class="wallet-btn wallet-btn--primary" onclick="walletSubmitNewMethod('${type}')">Save Method</button>
                <button class="wallet-btn wallet-btn--ghost" onclick="hideAddMethodForm()">Cancel</button>
            </div>
        </div>`;
}


function hideAddMethodForm() {
    walletAddMethodType = null;
    const formContainer = document.getElementById('walletAddMethodForm');
    if (formContainer) formContainer.innerHTML = '';
}


function walletSubmitNewMethod(type) {
    let label = '';
    let details = {};

    switch (type) {
        case 'visa':
        case 'mastercard': {
            const name = document.getElementById('walletMethodCardName')?.value.trim();
            const last4 = document.getElementById('walletMethodCardLast4')?.value.trim();
            if (!name || !last4 || last4.length !== 4 || !/^\d{4}$/.test(last4)) {
                showToast('Please enter a valid name and last 4 card digits.', 'error');
                return;
            }
            label = `${name} ****${last4}`;
            details = { name_on_card: name, last4 };
            break;
        }

        case 'payid': {
            const payid = document.getElementById('walletMethodPayId')?.value.trim();
            if (!payid) {
                showToast('Please enter your PayID.', 'error');
                return;
            }
            label = payid;
            details = { payid };
            break;
        }

        case 'bank_transfer': {
            const accountName = document.getElementById('walletMethodBankName')?.value.trim();
            const bsb = document.getElementById('walletMethodBSB')?.value.trim();
            const last4 = document.getElementById('walletMethodBankLast4')?.value.trim();
            if (!accountName || !bsb || !last4 || last4.length !== 4 || !/^\d{4}$/.test(last4)) {
                showToast('Please fill all bank transfer fields correctly.', 'error');
                return;
            }
            label = `${accountName} (****${last4})`;
            details = { account_name: accountName, bsb, last4 };
            break;
        }

        case 'btc':
        case 'eth':
        case 'usdt': {
            const addr = document.getElementById('walletMethodDigitalAddr')?.value.trim();
            const network = document.getElementById('walletMethodDigitalNetwork')?.value;
            if (!addr) {
                showToast('Please enter an account number.', 'error');
                return;
            }
            // Show truncated address as label
            label = addr.length > 12 ? addr.slice(0, 6) + '...' + addr.slice(-4) : addr;
            details = { address: addr, network };
            break;
        }

        default:
            showToast('Unknown payment type.', 'error');
            return;
    }

    addPaymentMethod(type, label, details);
}



function walletFormatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}


function walletTxTypeLabel(type) {
    const labels = {
        deposit: 'Deposit',
        withdrawal: 'Withdrawal',
        bonus: 'Bonus',
        refund: 'Refund',
        win: 'Win',
        wager: 'Wager'
    };
    return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}


function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}


// ── Low Balance Nudge ─────────────────────────────────────────

let _nudgeShownThisSession = false;
let _nudgeTimer = null;

function checkLowBalance() {
    // Only show once per session, only when playing, only for logged-in users
    if (_nudgeShownThisSession) return;
    if (!currentUser) return;
    if (typeof balance === 'undefined' || balance >= 20) return;
    if (balance <= 0) {
        // Zero balance — show refill suggestion instead of low-balance nudge
        if (!_nudgeShownThisSession) {
            _nudgeShownThisSession = true;
            showToast('Your balance is empty! Claim your daily bonus or visit the gem store to keep playing.', 'info', 5000);
        }
        return;
    }

    // Don't show if wallet is already open
    const walletModal = document.getElementById('walletModal');
    if (walletModal && walletModal.classList.contains('active')) return;

    // Delay slightly so it doesn't interrupt spin animation
    clearTimeout(_nudgeTimer);
    _nudgeTimer = setTimeout(() => {
        const nudge = document.getElementById('lowBalanceNudge');
        if (nudge) {
            _nudgeShownThisSession = true;
            nudge.classList.add('nudge--visible');
            // Auto-hide after 12 seconds
            setTimeout(() => hideLowBalanceNudge(), 12000);
        }
    }, 1500);
}

function hideLowBalanceNudge() {
    clearTimeout(_nudgeTimer);
    const nudge = document.getElementById('lowBalanceNudge');
    if (nudge) nudge.classList.remove('nudge--visible');
}

// Reset nudge flag when balance increases (new deposit)
function resetNudgeOnDeposit() {
    _nudgeShownThisSession = false;
}


// ═══════════════════════════════════════════════════════
// LOYALTY POINTS CARD SECTION
// ═══════════════════════════════════════════════════════

/**
 * Renders (or re-renders) the full Loyalty Points card into a persistent
 * slot inside the wallet modal, between the tab bar and walletContent.
 * The card is injected once and updated in-place on subsequent calls,
 * so tab switching does not destroy it.
 *
 * Fetches live status from /api/loyaltyshop/status and builds a card
 * showing the current balance, conversion rate, lifetime total, and
 * preset redemption buttons (100 / 500 / 1000 pts).
 *
 * Uses createElement/textContent throughout — no dynamic innerHTML
 * concatenation — to satisfy the security hook rules.
 *
 * @param {HTMLElement} modal  The #walletModal element (or any ancestor
 *                             that contains .wallet-modal).
 */
function _renderLoyaltySection(modal) {
    if (!modal) return;

    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Find (or create) the persistent wrapper div that sits between the
    // .wallet-tabs bar and #walletContent.
    var walletInner = modal.querySelector('.wallet-modal');
    if (!walletInner) walletInner = modal;

    var wrapper = walletInner.querySelector('#walletLoyaltyCardWrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'walletLoyaltyCardWrapper';
        wrapper.style.cssText = 'padding:0 16px 0 16px;';
        // Insert between .wallet-tabs and #walletContent
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Remove any existing card inside the wrapper (full re-render)
    var existing = wrapper.querySelector('#walletLoyaltyCard');
    if (existing) existing.remove();

    // ── Build the card shell (shows "Loading…" state initially) ──
    var card = document.createElement('div');
    card.id = 'walletLoyaltyCard';
    card.style.cssText = [
        'background:linear-gradient(135deg,rgba(52,211,153,0.10),rgba(16,185,129,0.05))',
        'border:1.5px solid rgba(52,211,153,0.28)',
        'border-radius:14px',
        'padding:16px 18px',
        'margin:12px 0'
    ].join(';');

    // Title row
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:1rem;font-weight:800;color:#34d399;letter-spacing:0.3px;';
    title.textContent = '\u2B50 Loyalty Points';

    var rateNote = document.createElement('span');
    rateNote.style.cssText = 'font-size:0.72rem;color:#6ee7b7;opacity:0.8;';
    rateNote.textContent = '100 pts = $1.00';

    titleRow.appendChild(title);
    titleRow.appendChild(rateNote);

    // Points balance display
    var balRow = document.createElement('div');
    balRow.style.cssText = 'display:flex;align-items:baseline;gap:8px;margin-bottom:8px;';

    var pointsDisplay = document.createElement('span');
    pointsDisplay.id = 'loyaltyCardPoints';
    pointsDisplay.style.cssText = 'font-size:2rem;font-weight:900;color:#a7f3d0;line-height:1;';
    pointsDisplay.textContent = '...';

    var pointsLabel = document.createElement('span');
    pointsLabel.style.cssText = 'font-size:0.78rem;color:#6ee7b7;font-weight:600;';
    pointsLabel.textContent = 'points';

    balRow.appendChild(pointsDisplay);
    balRow.appendChild(pointsLabel);

    // Lifetime row
    var lifetimeRow = document.createElement('div');
    lifetimeRow.style.cssText = 'font-size:0.72rem;color:#6ee7b7;opacity:0.65;margin-bottom:14px;';
    var lifetimeLabel = document.createElement('span');
    lifetimeLabel.textContent = 'Lifetime total: ';
    var lifetimeValue = document.createElement('span');
    lifetimeValue.id = 'loyaltyCardLifetime';
    lifetimeValue.textContent = '...';
    lifetimeRow.appendChild(lifetimeLabel);
    lifetimeRow.appendChild(lifetimeValue);

    // Redemption buttons row
    var btnRow = document.createElement('div');
    btnRow.id = 'loyaltyCardBtnRow';
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    var PRESETS = [
        { pts: 100,  label: 'Redeem 100 pts \u2192 $1' },
        { pts: 500,  label: 'Redeem 500 pts \u2192 $5' },
        { pts: 1000, label: 'Redeem 1000 pts \u2192 $10' }
    ];

    PRESETS.forEach(function(preset) {
        var btn = document.createElement('button');
        btn.dataset.loyaltyPts = preset.pts;
        btn.textContent = preset.label;
        btn.style.cssText = [
            'flex:1 1 auto',
            'min-width:130px',
            'padding:7px 10px',
            'border:none',
            'border-radius:8px',
            'font-size:0.74rem',
            'font-weight:700',
            'cursor:not-allowed',
            'background:linear-gradient(135deg,#34d399,#059669)',
            'color:#fff',
            'letter-spacing:0.2px',
            'opacity:0.4',
            'transition:opacity 0.2s'
        ].join(';');
        btn.disabled = true; // enabled once we know the live balance
        btn.addEventListener('click', function() {
            window.redeemLoyaltyPoints(preset.pts);
        });
        btnRow.appendChild(btn);
    });

    // Assemble card
    card.appendChild(titleRow);
    card.appendChild(balRow);
    card.appendChild(lifetimeRow);
    card.appendChild(btnRow);
    wrapper.appendChild(card);

    // ── Fetch live status and populate ──
    fetch('/api/loyaltyshop/status', {
        headers: { Authorization: 'Bearer ' + token }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        if (!data) return;
        var pts = parseInt(data.points, 10) || 0;
        var lifetime = parseInt(data.lifetimePoints, 10) || 0;

        var pdEl = document.getElementById('loyaltyCardPoints');
        if (pdEl) pdEl.textContent = pts.toLocaleString();

        var ltEl = document.getElementById('loyaltyCardLifetime');
        if (ltEl) ltEl.textContent = lifetime.toLocaleString() + ' pts earned';

        // Enable/disable preset buttons based on current balance
        var btnRowEl = document.getElementById('loyaltyCardBtnRow');
        if (btnRowEl) {
            btnRowEl.querySelectorAll('button').forEach(function(btn) {
                var required = parseInt(btn.dataset.loyaltyPts, 10);
                var canAfford = pts >= required;
                btn.disabled = !canAfford;
                btn.style.opacity = canAfford ? '1' : '0.4';
                btn.style.cursor = canAfford ? 'pointer' : 'not-allowed';
            });
        }

        // Also keep the compact header bar in sync
        var headerEl = document.getElementById('walletLoyaltyPoints');
        if (headerEl) headerEl.textContent = pts.toLocaleString();
        var headerBtn = document.getElementById('walletLoyaltyRedeemBtn');
        if (headerBtn) headerBtn.disabled = pts < 100;
    })
    .catch(function() {
        var pdEl = document.getElementById('loyaltyCardPoints');
        if (pdEl) pdEl.textContent = '\u2014';
    });
}


/**
 * Globally accessible loyalty redemption function.
 * Redeems exactly `points` loyalty points (must be a multiple of 100,
 * minimum 100) and credits the equivalent cash to the player's balance.
 *
 * @param {number} points  Number of points to redeem.
 */
window.redeemLoyaltyPoints = function(points) {
    points = parseInt(points, 10) || 0;
    if (points < 100 || points % 100 !== 0) {
        if (typeof showToast === 'function') {
            showToast('Minimum redemption is 100 pts (multiples of 100 only).', 'info', 3000);
        }
        return;
    }

    var creditAmt = (points / 100).toFixed(2);
    if (!confirm('Redeem ' + points.toLocaleString() + ' loyalty pts for $' + creditAmt + '?')) return;

    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        if (typeof showToast === 'function') showToast('Please log in to redeem points.', 'error', 3000);
        return;
    }

    // Disable all preset buttons while the request is in-flight
    var btnRowEl = document.getElementById('loyaltyCardBtnRow');
    if (btnRowEl) {
        btnRowEl.querySelectorAll('button').forEach(function(btn) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });
    }

    fetch('/api/loyaltyshop/redeem', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ points: points })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            // Update global balance
            if (typeof data.newBalance !== 'undefined') {
                balance = parseFloat(data.newBalance);
                if (typeof updateBalance === 'function') updateBalance();
                if (typeof saveBalance === 'function') saveBalance();
                // Sync the wallet header balance display
                var walletBal = document.getElementById('walletBalance');
                if (walletBal) walletBal.textContent = formatMoney(balance);
            }

            if (typeof showToast === 'function') {
                showToast(
                    '\uD83C\uDFAF Redeemed ' + points.toLocaleString() + ' pts \u2192 $' + creditAmt + ' credited!',
                    'win',
                    4000
                );
            }

            // Refresh the loyalty card to show updated balance
            var walletModal = document.getElementById('walletModal');
            if (walletModal) _renderLoyaltySection(walletModal);

            // Also refresh the compact header bar
            if (typeof refreshLoyaltyBalance === 'function') refreshLoyaltyBalance();
        } else {
            if (typeof showToast === 'function') {
                showToast(data.error || 'Redemption failed — please try again.', 'error', 3500);
            }
            // Re-enable buttons on failure
            var innerBtnRow = document.getElementById('loyaltyCardBtnRow');
            if (innerBtnRow) {
                innerBtnRow.querySelectorAll('button').forEach(function(btn) {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                });
            }
        }
    })
    .catch(function() {
        if (typeof showToast === 'function') {
            showToast('Redemption failed \u2014 please try again.', 'error', 3000);
        }
        var innerBtnRow = document.getElementById('loyaltyCardBtnRow');
        if (innerBtnRow) {
            innerBtnRow.querySelectorAll('button').forEach(function(btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
            });
        }
    });
};

// ── Rakeback Section ─────────────────────────────────────────────────────────
// ── Deposit Match CSS (injected once) ────────────────────────────────────────
(function _injectDepositMatchCSS() {
    if (document.getElementById('walletDepositMatchCSS')) return;
    var s = document.createElement('style');
    s.id = 'walletDepositMatchCSS';
    s.textContent = '.wallet-deposit-match-card{background:linear-gradient(135deg,#0a1f0a,#0d2b0d);border:1px solid #22c55e;border-radius:10px;padding:14px;margin:14px 0;color:#fff;}.wallet-dm-title{font-size:15px;font-weight:700;color:#4ade80;margin:0 0 4px;}.wallet-dm-tier{font-size:12px;color:#86efac;margin:0 0 10px;}.wallet-dm-eligible-box{background:rgba(34,197,94,0.1);border:1px solid #166534;border-radius:6px;padding:10px;margin-bottom:10px;font-size:13px;color:#bbf7d0;}.wallet-dm-claim-btn{width:100%;padding:10px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-weight:700;border-radius:8px;border:none;cursor:pointer;font-size:14px;margin-top:6px;}.wallet-dm-not-eligible{font-size:13px;color:#888;margin-bottom:10px;}.wallet-dm-rates-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;}.wallet-dm-rates-table th{color:#888;font-weight:600;text-align:left;padding:3px 4px;border-bottom:1px solid #1a1a2e;}.wallet-dm-rates-table td{color:#ccc;padding:3px 4px;border-bottom:1px solid #111;}.wallet-dm-rates-table tr.current-tier td{color:#4ade80;font-weight:700;}';
    document.head.appendChild(s);
})();

/**
 * Renders a Deposit Match Bonus card below the Loyalty section in the wallet modal.
 * Shows VIP tier, eligibility status, claim button, and rates table.
 * All dynamic text uses .textContent (no innerHTML with variables).
 * @param {HTMLElement} modal  The #walletModal element (or any ancestor containing .wallet-modal)
 */
async function _renderDepositMatchSection(modal) {
    if (!modal) return;
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Find (or create) the persistent wrapper div that sits below the Loyalty card
    var walletInner = modal.querySelector('.wallet-modal');
    if (!walletInner) walletInner = modal;

    var wrapper = walletInner.querySelector('#walletDepositMatchCardWrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'walletDepositMatchCardWrapper';
        wrapper.style.cssText = 'padding:0 16px 0 16px;';
        // Insert after the loyalty card wrapper if present, else before walletContent
        var loyaltyWrapper = walletInner.querySelector('#walletLoyaltyCardWrapper');
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (loyaltyWrapper && loyaltyWrapper.nextSibling) {
            walletInner.insertBefore(wrapper, loyaltyWrapper.nextSibling);
        } else if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Remove any existing card inside the wrapper (full re-render)
    var existingCard = wrapper.querySelector('#walletDepositMatchCard');
    if (existingCard) existingCard.remove();

    // Build card shell
    var card = document.createElement('div');
    card.id = 'walletDepositMatchCard';
    card.className = 'wallet-deposit-match-card';

    // ── Header ──
    var titleEl = document.createElement('p');
    titleEl.className = 'wallet-dm-title';
    titleEl.textContent = '\uD83C\uDF81 Deposit Match Bonus';
    card.appendChild(titleEl);

    // Tier placeholder shown while loading
    var tierEl = document.createElement('p');
    tierEl.className = 'wallet-dm-tier';
    tierEl.textContent = 'Loading\u2026';
    card.appendChild(tierEl);

    wrapper.appendChild(card);

    // ── Fetch status from server ──
    var data = null;
    try {
        var resp = await fetch('/api/depositmatch/status', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (_e) {}

    if (!data) {
        tierEl.textContent = 'Could not load deposit match data.';
        tierEl.style.color = '#f87171';
        return;
    }

    var matchRate = parseFloat(data.matchRate) || 0;
    var matchCap = parseFloat(data.matchCap) || 0;
    var pendingMatch = parseFloat(data.pendingMatch) || 0;
    var lastDepositAmount = parseFloat(data.lastDepositAmount) || 0;
    var matchAmount = parseFloat(data.matchAmount) || 0;
    var vipLabel = data.vipLabel || 'Base';
    var eligible = !!data.eligible;

    // Update tier label with real data
    var matchRatePct = Math.round(matchRate * 100);
    var tierText = vipLabel + ' Tier \u2014 ' + matchRatePct + '% match up to $' + matchCap.toFixed(2);
    tierEl.textContent = tierText;

    // ── Eligible state ──
    if (eligible) {
        var eligibleBox = document.createElement('div');
        eligibleBox.className = 'wallet-dm-eligible-box';

        var eligibleMsg = document.createElement('span');
        var depositStr = '$' + lastDepositAmount.toFixed(2);
        var matchStr = '$' + matchAmount.toFixed(2);
        eligibleMsg.textContent = 'Your last deposit of ' + depositStr + ' qualifies for a ' + matchStr + ' match bonus!';
        eligibleBox.appendChild(eligibleMsg);
        card.appendChild(eligibleBox);

        var claimBtn = document.createElement('button');
        claimBtn.className = 'wallet-dm-claim-btn';
        claimBtn.textContent = 'Claim ' + matchStr + ' Match Bonus';
        claimBtn.addEventListener('click', function() {
            var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!claimToken) return;
            claimBtn.disabled = true;
            claimBtn.style.opacity = '0.6';

            fetch('/api/depositmatch/claim', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + claimToken, 'Content-Type': 'application/json' }
            })
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.success) {
                    var credited = parseFloat(result.matchAmount) || 0;
                    if (typeof showToast === 'function') {
                        showToast('\uD83C\uDF81 $' + credited.toFixed(2) + ' match bonus credited!', 'win', 4000);
                    }
                    if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                    // Replace claim button with confirmed text
                    claimBtn.remove();
                    var confirmedEl = document.createElement('div');
                    confirmedEl.style.cssText = 'color:#4ade80;font-weight:700;font-size:14px;margin-top:6px;';
                    confirmedEl.textContent = '\u2705 Claimed!';
                    card.appendChild(confirmedEl);
                } else {
                    if (typeof showToast === 'function') {
                        showToast(result.error || 'Nothing to claim right now.', 'info', 3000);
                    }
                    claimBtn.disabled = false;
                    claimBtn.style.opacity = '1';
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') {
                    showToast('Claim failed \u2014 please try again.', 'error', 3000);
                }
                claimBtn.disabled = false;
                claimBtn.style.opacity = '1';
            });
        });
        card.appendChild(claimBtn);

    } else if (pendingMatch > 0.009) {
        // ── Pending match (already accrued, not yet claimed) ──
        var pendingBox = document.createElement('div');
        pendingBox.className = 'wallet-dm-eligible-box';

        var pendingMsg = document.createElement('span');
        var pendingStr = '$' + pendingMatch.toFixed(2);
        pendingMsg.textContent = 'You have ' + pendingStr + ' pending match \u2014 claim it!';
        pendingBox.appendChild(pendingMsg);
        card.appendChild(pendingBox);

        var pendingClaimBtn = document.createElement('button');
        pendingClaimBtn.className = 'wallet-dm-claim-btn';
        pendingClaimBtn.textContent = 'Claim ' + pendingStr + ' Match Bonus';
        pendingClaimBtn.addEventListener('click', function() {
            var claimToken2 = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!claimToken2) return;
            pendingClaimBtn.disabled = true;
            pendingClaimBtn.style.opacity = '0.6';

            fetch('/api/depositmatch/claim', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + claimToken2, 'Content-Type': 'application/json' }
            })
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.success) {
                    var credited2 = parseFloat(result.matchAmount) || 0;
                    if (typeof showToast === 'function') {
                        showToast('\uD83C\uDF81 $' + credited2.toFixed(2) + ' match bonus credited!', 'win', 4000);
                    }
                    if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                    pendingClaimBtn.remove();
                    var confirmedEl2 = document.createElement('div');
                    confirmedEl2.style.cssText = 'color:#4ade80;font-weight:700;font-size:14px;margin-top:6px;';
                    confirmedEl2.textContent = '\u2705 Claimed!';
                    card.appendChild(confirmedEl2);
                } else {
                    if (typeof showToast === 'function') {
                        showToast(result.error || 'Nothing to claim right now.', 'info', 3000);
                    }
                    pendingClaimBtn.disabled = false;
                    pendingClaimBtn.style.opacity = '1';
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') {
                    showToast('Claim failed \u2014 please try again.', 'error', 3000);
                }
                pendingClaimBtn.disabled = false;
                pendingClaimBtn.style.opacity = '1';
            });
        });
        card.appendChild(pendingClaimBtn);

    } else {
        // ── Not eligible ──
        var notEligEl = document.createElement('div');
        notEligEl.className = 'wallet-dm-not-eligible';
        var depositPrompt = 'Make a deposit to unlock your ' + vipLabel + ' ' + matchRatePct + '% match bonus (up to $' + matchCap.toFixed(2) + ')';
        notEligEl.textContent = depositPrompt;
        card.appendChild(notEligEl);

        var depositNowBtn = document.createElement('button');
        depositNowBtn.className = 'wallet-dm-claim-btn';
        depositNowBtn.style.cssText = 'width:100%;padding:8px;background:linear-gradient(135deg,#374151,#1f2937);color:#9ca3af;font-weight:700;border-radius:8px;border:1px solid #374151;cursor:pointer;font-size:13px;margin-top:4px;';
        depositNowBtn.textContent = 'Deposit Now';
        depositNowBtn.addEventListener('click', function() {
            var depositSection = document.getElementById('depositSection');
            if (depositSection) depositSection.scrollIntoView({ behavior: 'smooth' });
        });
        card.appendChild(depositNowBtn);
    }

    // ── VIP Rates table ──
    var RATES_TABLE = [
        { label: 'Base',     rate: '25%',  cap: '$2.50'  },
        { label: 'Bronze',   rate: '35%',  cap: '$7'     },
        { label: 'Silver',   rate: '50%',  cap: '$15'    },
        { label: 'Gold',     rate: '60%',  cap: '$35'    },
        { label: 'Platinum', rate: '75%',  cap: '$75'    },
        { label: 'Diamond',  rate: '100%', cap: '$200'   }
    ];

    var table = document.createElement('table');
    table.className = 'wallet-dm-rates-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var thTier = document.createElement('th');
    thTier.textContent = 'VIP Tier';
    var thRate = document.createElement('th');
    thRate.textContent = 'Match Rate';
    var thCap = document.createElement('th');
    thCap.textContent = 'Max Bonus';
    headerRow.appendChild(thTier);
    headerRow.appendChild(thRate);
    headerRow.appendChild(thCap);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    RATES_TABLE.forEach(function(row) {
        var tr = document.createElement('tr');
        if (row.label === vipLabel) tr.className = 'current-tier';
        var tdLabel = document.createElement('td');
        tdLabel.textContent = row.label;
        var tdRate = document.createElement('td');
        tdRate.textContent = row.rate;
        var tdCap = document.createElement('td');
        tdCap.textContent = row.cap;
        tr.appendChild(tdLabel);
        tr.appendChild(tdRate);
        tr.appendChild(tdCap);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
}

/**
 * Renders a Weekly Rakeback card below the Loyalty section in the wallet modal.
 * Shows weekly stats, pending amount, claim button, history, and next payout countdown.
 * All dynamic text uses .textContent (no innerHTML with variables).
 * @param {HTMLElement} modal  The #walletModal element (or any ancestor containing .wallet-modal)
 */
async function _renderRakebackSection(modal) {
    if (!modal) return;
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Find (or create) the persistent wrapper div that sits below the Loyalty card
    var walletInner = modal.querySelector('.wallet-modal');
    if (!walletInner) walletInner = modal;

    var wrapper = walletInner.querySelector('#walletRakebackCardWrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'walletRakebackCardWrapper';
        wrapper.style.cssText = 'padding:0 16px 0 16px;';
        // Insert after the loyalty card wrapper if present, else before walletContent
        var loyaltyWrapper = walletInner.querySelector('#walletLoyaltyCardWrapper');
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (loyaltyWrapper && loyaltyWrapper.nextSibling) {
            walletInner.insertBefore(wrapper, loyaltyWrapper.nextSibling);
        } else if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Remove any existing card inside the wrapper (full re-render)
    var existingCard = wrapper.querySelector('#walletRakebackCard');
    if (existingCard) existingCard.remove();

    // Build card shell
    var card = document.createElement('div');
    card.id = 'walletRakebackCard';
    card.style.cssText = [
        'background:linear-gradient(135deg,rgba(251,191,36,0.10),rgba(245,158,11,0.05))',
        'border:1.5px solid rgba(251,191,36,0.28)',
        'border-radius:14px',
        'padding:16px 18px',
        'margin:12px 0'
    ].join(';');

    // ── Header ──
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:1rem;font-weight:800;color:#fbbf24;letter-spacing:0.3px;';
    title.textContent = '\u267B\uFE0F Weekly Rakeback (1%)';

    var rateNote = document.createElement('span');
    rateNote.style.cssText = 'font-size:0.72rem;color:#fde68a;opacity:0.8;';
    rateNote.textContent = '1% of net losses';

    titleRow.appendChild(title);
    titleRow.appendChild(rateNote);
    card.appendChild(titleRow);

    // ── Loading placeholder while fetching ──
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'color:#fde68a;font-size:0.82rem;opacity:0.7;margin-bottom:8px;';
    loadingEl.textContent = 'Loading\u2026';
    card.appendChild(loadingEl);

    wrapper.appendChild(card);

    // ── Fetch status from server ──
    var data = null;
    try {
        var resp = await fetch('/api/rakeback/status', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (_e) {}

    // Remove loading placeholder
    if (loadingEl.parentNode) loadingEl.remove();

    if (!data) {
        var errEl = document.createElement('div');
        errEl.style.cssText = 'color:#f87171;font-size:0.82rem;';
        errEl.textContent = 'Could not load rakeback data.';
        card.appendChild(errEl);
        return;
    }

    var pending = parseFloat(data.pendingRakeback) || 0;
    var wagered = parseFloat(data.weeklyWagered) || 0;
    var netLoss = parseFloat(data.weeklyNetLoss) || 0;

    // ── Stats row ──
    var statsRow = document.createElement('div');
    statsRow.style.cssText = 'display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap;';

    var wageredStat = document.createElement('div');
    wageredStat.style.cssText = 'font-size:0.8rem;color:#fde68a;';
    var wageredLabel = document.createElement('span');
    wageredLabel.style.cssText = 'opacity:0.7;';
    wageredLabel.textContent = 'Wagered this week: ';
    var wageredVal = document.createElement('span');
    wageredVal.style.cssText = 'font-weight:700;color:#fbbf24;';
    wageredVal.textContent = '$' + wagered.toFixed(2);
    wageredStat.appendChild(wageredLabel);
    wageredStat.appendChild(wageredVal);

    var pendingStat = document.createElement('div');
    pendingStat.style.cssText = 'font-size:0.8rem;color:#fde68a;';
    var pendingLabel = document.createElement('span');
    pendingLabel.style.cssText = 'opacity:0.7;';
    pendingLabel.textContent = 'Pending rakeback: ';
    var pendingVal = document.createElement('span');
    pendingVal.style.cssText = 'font-weight:700;color:#fbbf24;';
    pendingVal.textContent = '$' + pending.toFixed(2);
    pendingStat.appendChild(pendingLabel);
    pendingStat.appendChild(pendingVal);

    statsRow.appendChild(wageredStat);
    statsRow.appendChild(pendingStat);
    card.appendChild(statsRow);

    // ── Claim button or "keep playing" note ──
    if (pending < 0.01) {
        var keepPlayingEl = document.createElement('div');
        keepPlayingEl.style.cssText = 'font-size:0.8rem;color:#fde68a;opacity:0.7;margin-bottom:12px;font-style:italic;';
        keepPlayingEl.textContent = 'Keep playing to earn rakeback';
        card.appendChild(keepPlayingEl);
    } else {
        var claimBtn = document.createElement('button');
        claimBtn.id = 'rakebackCardClaimBtn';
        claimBtn.style.cssText = [
            'background:linear-gradient(135deg,#f59e0b,#d97706)',
            'color:#1c1917',
            'border:none',
            'border-radius:8px',
            'padding:8px 18px',
            'font-size:0.85rem',
            'font-weight:800',
            'cursor:pointer',
            'margin-bottom:12px',
            'letter-spacing:0.3px'
        ].join(';');
        claimBtn.textContent = 'Claim Rakeback ($' + pending.toFixed(2) + ')';

        claimBtn.addEventListener('click', function() {
            var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!claimToken) return;
            claimBtn.disabled = true;
            claimBtn.style.opacity = '0.6';

            fetch('/api/rakeback/claim', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + claimToken, 'Content-Type': 'application/json' }
            })
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.success) {
                    var credited = parseFloat(result.credited) || 0;
                    if (typeof balance !== 'undefined') balance = result.newBalance;
                    if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                    if (typeof showToast === 'function') {
                        showToast('\u267B\uFE0F Rakeback $' + credited.toFixed(2) + ' credited!', 'win', 4000);
                    }
                    // Re-render card with fresh data
                    var walletModal = document.getElementById('walletModal');
                    if (walletModal) _renderRakebackSection(walletModal);
                } else {
                    if (typeof showToast === 'function') {
                        showToast(result.error || 'Nothing to claim yet', 'info', 3000);
                    }
                    claimBtn.disabled = false;
                    claimBtn.style.opacity = '1';
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') {
                    showToast('Claim failed \u2014 please try again.', 'error', 3000);
                }
                claimBtn.disabled = false;
                claimBtn.style.opacity = '1';
            });
        });

        card.appendChild(claimBtn);
    }

    // ── Next automatic payout countdown ──
    if (data.nextPayoutAt) {
        var nextPayout = new Date(data.nextPayoutAt);
        var now = new Date();
        var diffMs = nextPayout - now;
        var countdownEl = document.createElement('div');
        countdownEl.style.cssText = 'font-size:0.76rem;color:#fde68a;opacity:0.75;margin-bottom:10px;';
        if (diffMs > 0) {
            var diffH = Math.floor(diffMs / 3600000);
            var diffM = Math.floor((diffMs % 3600000) / 60000);
            var countdownLabel = document.createElement('span');
            countdownLabel.textContent = 'Next automatic payout in ';
            var countdownVal = document.createElement('span');
            countdownVal.style.cssText = 'font-weight:700;color:#fbbf24;';
            countdownVal.textContent = diffH + 'h ' + diffM + 'm';
            countdownEl.appendChild(countdownLabel);
            countdownEl.appendChild(countdownVal);
        } else {
            countdownEl.textContent = 'Automatic payout processing soon\u2026';
        }
        card.appendChild(countdownEl);
    }

    // ── Recent history (last 3 entries) ──
    var history = Array.isArray(data.history) ? data.history.slice(0, 3) : [];
    if (history.length > 0) {
        var histTitle = document.createElement('div');
        histTitle.style.cssText = 'font-size:0.76rem;font-weight:700;color:#fbbf24;margin-bottom:6px;letter-spacing:0.2px;';
        histTitle.textContent = 'Recent Payouts';
        card.appendChild(histTitle);

        history.forEach(function(entry) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-top:1px solid rgba(251,191,36,0.12);';

            var dateEl = document.createElement('span');
            dateEl.style.cssText = 'font-size:0.72rem;color:#fde68a;opacity:0.7;';
            var entryDate = entry.created_at ? new Date(entry.created_at) : null;
            dateEl.textContent = entryDate ? entryDate.toLocaleDateString() : '\u2014';

            var descEl = document.createElement('span');
            descEl.style.cssText = 'font-size:0.72rem;color:#fde68a;flex:1;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            descEl.textContent = entry.description || 'Rakeback payout';

            var amtEl = document.createElement('span');
            amtEl.style.cssText = 'font-size:0.76rem;font-weight:700;color:#fbbf24;white-space:nowrap;';
            amtEl.textContent = '+$' + (parseFloat(entry.amount) || 0).toFixed(2);

            row.appendChild(dateEl);
            row.appendChild(descEl);
            row.appendChild(amtEl);
            card.appendChild(row);
        });
    }
}

// ── Daily Cashback CSS (injected once) ────────────────────────────────────────
(function _injectDailyCashbackCSS() {
    if (document.getElementById('walletDailyCashbackCSS')) return;
    var s = document.createElement('style');
    s.id = 'walletDailyCashbackCSS';
    s.textContent = [
        '#wallet-cashback-section{background:linear-gradient(135deg,rgba(249,115,22,0.10),rgba(234,88,12,0.05));border:1.5px solid rgba(249,115,22,0.28);border-radius:14px;padding:16px 18px;margin:12px 0;}',
        '.cashback-eligible-box{background:rgba(34,197,94,0.10);border-left:3px solid #22c55e;border-radius:6px;padding:10px 12px;margin-bottom:10px;font-size:0.82rem;color:#bbf7d0;}',
        '.cashback-claimed-box{background:rgba(156,163,175,0.08);border-left:3px solid #6b7280;border-radius:6px;padding:10px 12px;margin-bottom:10px;font-size:0.82rem;color:#9ca3af;}',
        '.cashback-inactive-box{background:rgba(107,114,128,0.06);border-left:3px solid rgba(107,114,128,0.3);border-radius:6px;padding:10px 12px;margin-bottom:10px;font-size:0.82rem;color:#9ca3af;}',
        '.cashback-tier-table{width:100%;border-collapse:collapse;font-size:0.72rem;margin-top:10px;}',
        '.cashback-tier-table th{color:#9ca3af;font-weight:600;text-align:left;padding:3px 4px;border-bottom:1px solid rgba(249,115,22,0.15);}',
        '.cashback-tier-table td{color:#d1d5db;padding:3px 4px;border-bottom:1px solid rgba(249,115,22,0.08);}',
        '.cashback-tier-table tr.cb-current-tier td{color:#fb923c;font-weight:700;}',
        '#wallet-loyalty-shop-section{background:linear-gradient(135deg,rgba(52,211,153,0.10),rgba(16,185,129,0.05));border:1.5px solid rgba(52,211,153,0.28);border-radius:14px;padding:16px 18px;margin:12px 0;}',
        '.loyalty-pts-display{font-size:2rem;font-weight:900;color:#a7f3d0;line-height:1;display:block;margin-bottom:2px;}',
        '.loyalty-pts-sub{font-size:0.72rem;color:#6ee7b7;opacity:0.65;margin-bottom:12px;display:block;}',
        '.loyalty-redeem-btns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}',
        '.loyalty-redeem-btns button{flex:1 1 auto;min-width:110px;padding:7px 10px;border:none;border-radius:8px;font-size:0.74rem;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#34d399,#059669);color:#fff;letter-spacing:0.2px;transition:opacity 0.2s;}',
        '.loyalty-custom-redeem{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
        '.loyalty-custom-redeem input{flex:1 1 100px;padding:7px 10px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:8px;color:#a7f3d0;font-size:0.82rem;min-width:80px;}',
        '.loyalty-custom-redeem button{padding:7px 14px;border:none;border-radius:8px;font-size:0.8rem;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#34d399,#059669);color:#fff;white-space:nowrap;}'
    ].join('');
    document.head.appendChild(s);
})();

/**
 * Renders the Daily Cashback card in the wallet modal.
 * Shows VIP tier, eligibility, claim button, and tier rate table.
 * All dynamic text uses .textContent — no innerHTML with variables.
 * @param {HTMLElement} modal  The #walletModal element
 */
async function _renderDailyCashbackSection(modal) {
    if (!modal) return;
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var walletInner = modal.querySelector('.wallet-modal');
    if (!walletInner) walletInner = modal;

    // Find or create the persistent wrapper placed after the rakeback wrapper
    var wrapper = walletInner.querySelector('#walletDailyCashbackCardWrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'walletDailyCashbackCardWrapper';
        wrapper.style.cssText = 'padding:0 16px 0 16px;';
        // Insert after rakeback wrapper if present, else before walletContent
        var rakeWrapper = walletInner.querySelector('#walletRakebackCardWrapper');
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (rakeWrapper && rakeWrapper.nextSibling) {
            walletInner.insertBefore(wrapper, rakeWrapper.nextSibling);
        } else if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Remove any existing card for full re-render
    var existingCard = wrapper.querySelector('#wallet-cashback-section');
    if (existingCard) existingCard.remove();

    // Build card shell
    var card = document.createElement('div');
    card.id = 'wallet-cashback-section';

    // ── Header row ──
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:1rem;font-weight:800;color:#fb923c;letter-spacing:0.3px;';
    title.textContent = '\uD83D\uDCB8 Daily Cashback';

    var subNote = document.createElement('span');
    subNote.style.cssText = 'font-size:0.72rem;color:#fdba74;opacity:0.8;';
    subNote.textContent = '2\u201310% of net losses';

    titleRow.appendChild(title);
    titleRow.appendChild(subNote);
    card.appendChild(titleRow);

    // Loading state
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'color:#fdba74;font-size:0.82rem;opacity:0.7;margin-bottom:8px;';
    loadingEl.textContent = 'Loading\u2026';
    card.appendChild(loadingEl);

    wrapper.appendChild(card);

    // ── Fetch status ──
    var data = null;
    try {
        var resp = await fetch('/api/dailycashback/status', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (_e) {}

    // Remove loading placeholder
    if (loadingEl.parentNode) loadingEl.remove();

    if (!data) {
        var errEl = document.createElement('div');
        errEl.style.cssText = 'color:#f87171;font-size:0.82rem;';
        errEl.textContent = 'Could not load cashback data.';
        card.appendChild(errEl);
        return;
    }

    var eligible = !!data.eligible;
    var claimed  = !!data.claimed;
    var amount   = parseFloat(data.amount) || 0;
    var netLosses = parseFloat(data.netLosses) || 0;
    var vipLabel = data.vipLabel || 'Base';
    var cashbackRate = parseFloat(data.cashbackRate) || 0;
    var cashbackCap  = parseFloat(data.cashbackCap) || 0;
    var vipLevel = parseInt(data.vipLevel, 10) || 0;

    // ── VIP badge ──
    var vipBadge = document.createElement('span');
    vipBadge.style.cssText = 'display:inline-block;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:20px;margin-bottom:10px;background:rgba(249,115,22,0.18);color:#fb923c;border:1px solid rgba(249,115,22,0.35);';
    vipBadge.textContent = vipLabel + ' \u2014 ' + Math.round(cashbackRate * 100) + '% cashback (up to $' + cashbackCap.toFixed(2) + ')';
    card.appendChild(vipBadge);

    if (claimed) {
        // ── Claimed / cooldown state ──
        var claimedBox = document.createElement('div');
        claimedBox.className = 'cashback-claimed-box';

        var claimedTitle = document.createElement('div');
        claimedTitle.style.cssText = 'font-weight:700;margin-bottom:4px;color:#9ca3af;';
        claimedTitle.textContent = '\u2713 Daily Cashback Claimed';
        claimedBox.appendChild(claimedTitle);

        // Compute next-eligible countdown from claimedAt + 24 h
        if (data.claimedAt) {
            var claimedAt = new Date(data.claimedAt);
            var nextAt = new Date(claimedAt.getTime() + 24 * 3600 * 1000);
            var nowMs  = Date.now();
            var diffMs = nextAt - nowMs;
            var countdownEl = document.createElement('div');
            countdownEl.style.cssText = 'font-size:0.78rem;color:#9ca3af;';
            if (diffMs > 0) {
                var diffH = Math.floor(diffMs / 3600000);
                var diffM = Math.floor((diffMs % 3600000) / 60000);
                countdownEl.textContent = 'Next cashback in ' + diffH + 'h ' + diffM + 'm';
            } else {
                countdownEl.textContent = 'Next cashback available now \u2014 refresh to claim.';
            }
            claimedBox.appendChild(countdownEl);
        }

        card.appendChild(claimedBox);

    } else if (eligible && amount > 0) {
        // ── Eligible / available state ──
        var eligibleBox = document.createElement('div');
        eligibleBox.className = 'cashback-eligible-box';

        var eligMsg = document.createElement('div');
        eligMsg.style.cssText = 'font-weight:700;margin-bottom:4px;color:#4ade80;font-size:0.88rem;';
        eligMsg.textContent = '\uD83D\uDCB0 Claim Your Cashback!';
        eligibleBox.appendChild(eligMsg);

        var eligDetail = document.createElement('div');
        eligDetail.style.cssText = 'font-size:0.8rem;color:#86efac;';
        var detailAmtStr = '$' + amount.toFixed(2);
        var detailPctStr = Math.round(cashbackRate * 100) + '%';
        var detailLossStr = '$' + netLosses.toFixed(2);
        eligDetail.textContent = detailAmtStr + ' available (' + detailPctStr + ' of ' + detailLossStr + ' losses)';
        eligibleBox.appendChild(eligDetail);

        card.appendChild(eligibleBox);

        var claimBtn = document.createElement('button');
        claimBtn.style.cssText = [
            'width:100%',
            'padding:10px',
            'background:linear-gradient(135deg,#f97316,#ea580c)',
            'color:#fff',
            'font-weight:800',
            'border-radius:8px',
            'border:none',
            'cursor:pointer',
            'font-size:0.88rem',
            'margin-bottom:10px',
            'letter-spacing:0.3px'
        ].join(';');
        claimBtn.textContent = 'Claim $' + amount.toFixed(2) + ' Cashback';

        claimBtn.addEventListener('click', function() {
            var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!claimToken) return;
            claimBtn.disabled = true;
            claimBtn.style.opacity = '0.6';

            fetch('/api/dailycashback/claim', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + claimToken, 'Content-Type': 'application/json' }
            })
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.success) {
                    var credited = parseFloat(result.credited) || 0;
                    if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(result.newBalance);
                    else if (typeof balance !== 'undefined') balance = result.newBalance;
                    if (typeof showToast === 'function') {
                        showToast('\uD83D\uDCB8 $' + credited.toFixed(2) + ' cashback credited!', 'win', 4000);
                    }
                    refreshCashbackBalance();
                    // Re-render section to show claimed state
                    var walletModalEl = document.getElementById('walletModal');
                    if (walletModalEl) _renderDailyCashbackSection(walletModalEl);
                } else {
                    if (typeof showToast === 'function') {
                        showToast(result.error || 'Cashback not available', 'info', 3000);
                    }
                    claimBtn.disabled = false;
                    claimBtn.style.opacity = '1';
                }
            })
            .catch(function() {
                if (typeof showToast === 'function') {
                    showToast('Claim failed \u2014 please try again.', 'error', 3000);
                }
                claimBtn.disabled = false;
                claimBtn.style.opacity = '1';
            });
        });

        card.appendChild(claimBtn);

    } else {
        // ── Not eligible / no qualifying losses ──
        var inactiveBox = document.createElement('div');
        inactiveBox.className = 'cashback-inactive-box';

        var inactiveMsg = document.createElement('div');
        inactiveMsg.style.cssText = 'font-size:0.82rem;color:#9ca3af;';
        inactiveMsg.textContent = 'No qualifying losses in the past 24 hours.';
        inactiveBox.appendChild(inactiveMsg);

        var inactiveSub = document.createElement('div');
        inactiveSub.style.cssText = 'font-size:0.75rem;color:#6b7280;margin-top:3px;';
        inactiveSub.textContent = 'Play more to earn cashback on net losses.';
        inactiveBox.appendChild(inactiveSub);

        card.appendChild(inactiveBox);
    }

    // ── VIP Tier Rate Table (static labels, current tier highlighted) ──
    var tierTableTitle = document.createElement('div');
    tierTableTitle.style.cssText = 'font-size:0.76rem;font-weight:700;color:#fb923c;margin:10px 0 4px;letter-spacing:0.2px;';
    tierTableTitle.textContent = 'Cashback Tiers';
    card.appendChild(tierTableTitle);

    var table = document.createElement('table');
    table.className = 'cashback-tier-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var th1 = document.createElement('th');
    th1.textContent = 'Tier';
    var th2 = document.createElement('th');
    th2.textContent = 'Rate';
    var th3 = document.createElement('th');
    th3.textContent = 'Cap';
    headerRow.appendChild(th1);
    headerRow.appendChild(th2);
    headerRow.appendChild(th3);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');

    // Static tier definitions — no variable interpolation
    var tierRows = [
        { name: 'Base',     rate: '2%',  cap: '$3',   level: 0 },
        { name: 'Bronze',   rate: '3%',  cap: '$5',   level: 1 },
        { name: 'Silver',   rate: '4%',  cap: '$10',  level: 2 },
        { name: 'Gold',     rate: '5%',  cap: '$20',  level: 3 },
        { name: 'Platinum', rate: '7%',  cap: '$40',  level: 4 },
        { name: 'Diamond',  rate: '10%', cap: '$100', level: 5 }
    ];

    tierRows.forEach(function(tier) {
        var tr = document.createElement('tr');
        if (tier.level === vipLevel) tr.className = 'cb-current-tier';

        var tdName = document.createElement('td');
        tdName.textContent = tier.name + (tier.level === vipLevel ? ' \u2190' : '');
        var tdRate = document.createElement('td');
        tdRate.textContent = tier.rate;
        var tdCap = document.createElement('td');
        tdCap.textContent = tier.cap;

        tr.appendChild(tdName);
        tr.appendChild(tdRate);
        tr.appendChild(tdCap);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    card.appendChild(table);
}

// ── Loyalty Shop CSS (injected once) ──────────────────────────────────────────
// (Styles already injected by _injectDailyCashbackCSS above, which includes
//  #wallet-loyalty-shop-section and associated class names.)

/**
 * Renders the Loyalty Shop card in the wallet modal.
 * Shows points balance, earning rate, progress bar, preset redeem buttons,
 * and a custom-amount redeem field.
 * All dynamic text uses .textContent — no innerHTML with variables.
 * @param {HTMLElement} modal  The #walletModal element
 */
async function _renderLoyaltyShopSection(modal) {
    if (!modal) return;
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var walletInner = modal.querySelector('.wallet-modal');
    if (!walletInner) walletInner = modal;

    // Find or create persistent wrapper placed after the cashback wrapper
    var wrapper = walletInner.querySelector('#walletLoyaltyShopCardWrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'walletLoyaltyShopCardWrapper';
        wrapper.style.cssText = 'padding:0 16px 16px 16px;';
        // Insert after cashback wrapper if present, else after rakeback, else before walletContent
        var cbWrapper = walletInner.querySelector('#walletDailyCashbackCardWrapper');
        var rakeWrapper = walletInner.querySelector('#walletRakebackCardWrapper');
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (cbWrapper && cbWrapper.nextSibling) {
            walletInner.insertBefore(wrapper, cbWrapper.nextSibling);
        } else if (rakeWrapper && rakeWrapper.nextSibling) {
            walletInner.insertBefore(wrapper, rakeWrapper.nextSibling);
        } else if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Remove any existing card for full re-render
    var existingCard = wrapper.querySelector('#wallet-loyalty-shop-section');
    if (existingCard) existingCard.remove();

    // Build card shell
    var card = document.createElement('div');
    card.id = 'wallet-loyalty-shop-section';

    // ── Header row ──
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:1rem;font-weight:800;color:#34d399;letter-spacing:0.3px;';
    title.textContent = '\u2B50 Loyalty Shop';

    var rateNote = document.createElement('span');
    rateNote.style.cssText = 'font-size:0.72rem;color:#6ee7b7;opacity:0.8;';
    rateNote.textContent = '100 pts = $1.00';

    titleRow.appendChild(title);
    titleRow.appendChild(rateNote);
    card.appendChild(titleRow);

    // Loading state
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'color:#6ee7b7;font-size:0.82rem;opacity:0.7;margin-bottom:8px;';
    loadingEl.textContent = 'Loading\u2026';
    card.appendChild(loadingEl);

    wrapper.appendChild(card);

    // ── Fetch status ──
    var data = null;
    try {
        var resp = await fetch('/api/loyaltyshop/status', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (_e) {}

    // Remove loading placeholder
    if (loadingEl.parentNode) loadingEl.remove();

    if (!data) {
        var errEl = document.createElement('div');
        errEl.style.cssText = 'color:#f87171;font-size:0.82rem;';
        errEl.textContent = 'Could not load loyalty shop data.';
        card.appendChild(errEl);
        return;
    }

    var pts          = parseInt(data.points, 10) || 0;
    var lifetimePts  = parseInt(data.lifetimePoints, 10) || 0;
    var pendingPts   = parseInt(data.pendingPoints, 10) || 0;

    // ── Points display ──
    var ptsDisplay = document.createElement('span');
    ptsDisplay.id = 'loyaltyShopPtsDisplay';
    ptsDisplay.className = 'loyalty-pts-display';
    ptsDisplay.textContent = pts.toLocaleString();
    card.appendChild(ptsDisplay);

    var ptsSub = document.createElement('span');
    ptsSub.className = 'loyalty-pts-sub';
    var subText = 'Loyalty Points';
    if (lifetimePts > 0) {
        subText += ' \u00B7 lifetime: ' + lifetimePts.toLocaleString();
    }
    if (pendingPts > 0) {
        subText += ' \u00B7 pending: +' + pendingPts.toLocaleString();
    }
    ptsSub.textContent = subText;
    card.appendChild(ptsSub);

    // ── Earning rate note ──
    var earnNote = document.createElement('div');
    earnNote.style.cssText = 'font-size:0.75rem;color:#6ee7b7;opacity:0.7;margin-bottom:10px;';
    earnNote.textContent = '1 point per spin \u00B7 100 points = $1.00';
    card.appendChild(earnNote);

    // ── Progress bar toward next 100-pt threshold ──
    var progressPts = pts % 100;
    var progressPct = progressPts; // 0-100
    var progressWrap = document.createElement('div');
    progressWrap.style.cssText = 'background:rgba(52,211,153,0.12);border-radius:6px;height:8px;margin-bottom:14px;overflow:hidden;';
    var progressBar = document.createElement('div');
    progressBar.style.cssText = 'height:100%;border-radius:6px;background:linear-gradient(90deg,#34d399,#059669);width:' + progressPct + '%;transition:width 0.4s;';
    progressWrap.appendChild(progressBar);
    card.appendChild(progressWrap);

    var progressLabel = document.createElement('div');
    progressLabel.style.cssText = 'font-size:0.72rem;color:#6ee7b7;opacity:0.6;margin-top:-10px;margin-bottom:12px;';
    progressLabel.textContent = progressPts + ' / 100 pts toward next redemption';
    card.appendChild(progressLabel);

    // ── Status message display (for success/error feedback) ──
    var statusMsg = document.createElement('div');
    statusMsg.id = 'loyaltyShopStatusMsg';
    statusMsg.style.cssText = 'font-size:0.82rem;min-height:1.2em;margin-bottom:8px;';
    card.appendChild(statusMsg);

    // ── Helper: perform redemption ──
    function doRedeem(redeemPts) {
        redeemPts = parseInt(redeemPts, 10) || 0;
        if (redeemPts < 100 || redeemPts % 100 !== 0) {
            statusMsg.style.color = '#f87171';
            statusMsg.textContent = 'Minimum 100 pts, multiples of 100 only.';
            return;
        }
        var currentPts = parseInt((document.getElementById('loyaltyShopPtsDisplay') || {}).textContent || '0', 10);
        if (redeemPts > currentPts) {
            statusMsg.style.color = '#f87171';
            statusMsg.textContent = 'Insufficient loyalty points.';
            return;
        }

        var redeemToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
        if (!redeemToken) return;

        // Disable all buttons while in-flight
        card.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });
        statusMsg.style.color = '#6ee7b7';
        statusMsg.textContent = 'Redeeming\u2026';

        fetch('/api/loyaltyshop/redeem', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + redeemToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ points: redeemPts })
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.success) {
                var credited = parseFloat(result.credited) || 0;
                if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(result.newBalance);
                else if (typeof balance !== 'undefined') balance = result.newBalance;
                statusMsg.style.color = '#4ade80';
                statusMsg.textContent = '\u2705 $' + credited.toFixed(2) + ' credited! ' + (result.newPoints || 0).toLocaleString() + ' pts remaining';
                if (typeof refreshLoyaltyBalance === 'function') refreshLoyaltyBalance();
                // Re-render to show updated balance
                var walletModalEl = document.getElementById('walletModal');
                if (walletModalEl) _renderLoyaltyShopSection(walletModalEl);
            } else {
                statusMsg.style.color = '#f87171';
                statusMsg.textContent = result.error || 'Redemption failed.';
                card.querySelectorAll('button').forEach(function(b) {
                    b.disabled = false;
                    b.style.opacity = '1';
                });
            }
        })
        .catch(function() {
            statusMsg.style.color = '#f87171';
            statusMsg.textContent = 'Redemption failed \u2014 please try again.';
            card.querySelectorAll('button').forEach(function(b) {
                b.disabled = false;
                b.style.opacity = '1';
            });
        });
    }

    // ── Preset redeem buttons ──
    var presets = [
        { pts: 100,  label: '100 pts \u2192 $1.00' },
        { pts: 500,  label: '500 pts \u2192 $5.00' },
        { pts: 1000, label: '1,000 pts \u2192 $10.00' }
    ];

    var btnRow = document.createElement('div');
    btnRow.className = 'loyalty-redeem-btns';

    presets.forEach(function(preset) {
        var btn = document.createElement('button');
        btn.textContent = preset.label;
        btn.disabled = pts < preset.pts;
        btn.style.opacity = pts >= preset.pts ? '1' : '0.4';
        btn.style.cursor = pts >= preset.pts ? 'pointer' : 'not-allowed';
        btn.addEventListener('click', function() { doRedeem(preset.pts); });
        btnRow.appendChild(btn);
    });

    card.appendChild(btnRow);

    // ── Custom redeem row ──
    var customRow = document.createElement('div');
    customRow.className = 'loyalty-custom-redeem';

    var customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '100';
    customInput.step = '100';
    customInput.placeholder = '100, 200, \u2026';
    customInput.style.cssText = 'flex:1 1 100px;padding:7px 10px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:8px;color:#a7f3d0;font-size:0.82rem;min-width:80px;';

    var customBtn = document.createElement('button');
    customBtn.textContent = 'Redeem';
    customBtn.style.cssText = 'padding:7px 14px;border:none;border-radius:8px;font-size:0.8rem;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#34d399,#059669);color:#fff;white-space:nowrap;';
    customBtn.addEventListener('click', function() {
        var val = parseInt(customInput.value, 10) || 0;
        doRedeem(val);
    });

    // ── Live credit preview label ──
    var previewLabel = document.createElement('span');
    previewLabel.id = 'loyaltyCustomPreview';
    previewLabel.style.cssText = 'font-size:0.78rem;color:#6ee7b7;min-width:72px;white-space:nowrap;';
    previewLabel.textContent = '= $0.00';

    customInput.addEventListener('input', function() {
        var v = parseInt(customInput.value, 10) || 0;
        // snap to nearest lower multiple of 100
        var snapped = Math.floor(v / 100) * 100;
        var credit = (snapped / 100).toFixed(2);
        previewLabel.textContent = snapped > 0 ? '= $' + credit + ' credits' : '= $0.00';
    });

    customRow.appendChild(customInput);
    customRow.appendChild(previewLabel);
    customRow.appendChild(customBtn);
    card.appendChild(customRow);
}

/**
 * Public entry point for rendering the loyalty points balance + redeem section
 * inside the wallet modal.  Delegates to _renderLoyaltyShopSection (the full
 * async implementation) with an ID guard so duplicate calls are no-ops.
 *
 * Layout rendered by the delegate:
 *   - Section header "⭐ Loyalty Shop" + "100 pts = $1.00" rate note
 *   - Large points balance display
 *   - Lifetime earned + pending points
 *   - Earning rate note (1 point per spin)
 *   - Progress bar toward next 100-pt redemption threshold
 *   - If >= 100 pts: preset redeem buttons + custom amount input with live
 *     "$X.XX credits" preview + Redeem button
 *   - If < 100 pts: "Earn points by playing slots!" hint + progress text
 *
 * @param {HTMLElement} parentContainer  The #walletModal element (or .wallet-modal inner element).
 */
async function walletRenderLoyaltySection(parentContainer) {
    if (!parentContainer) return;
    // ID guard: skip if section wrapper already exists in DOM
    if (document.getElementById('walletLoyaltyShopCardWrapper')) return;
    await _renderLoyaltyShopSection(parentContainer);
}

// ── VIP Deposit Bonus CSS (injected once) ─────────────────────────────────────
(function _injectVipDepositCSS() {
    if (document.getElementById('vipDeposit-css')) return;
    var s = document.createElement('style');
    s.id = 'vipDeposit-css';
    s.textContent = [
        '#vipDepositSection{background:linear-gradient(135deg,rgba(234,179,8,0.10),rgba(161,98,7,0.06));border:1.5px solid rgba(234,179,8,0.30);border-radius:14px;padding:16px 18px;margin:12px 0;}',
        '#wallet-vip-deposit-card .vip-deposit-tier-badge{display:inline-block;font-size:0.72rem;font-weight:700;padding:2px 10px;border-radius:20px;margin-bottom:10px;background:rgba(234,179,8,0.18);color:#fbbf24;border:1px solid rgba(234,179,8,0.38);}',
        '#wallet-vip-deposit-card .vip-deposit-stat{font-size:0.82rem;color:#fde68a;margin-bottom:6px;}',
        '#wallet-vip-deposit-card .vip-deposit-stat span{color:#fbbf24;font-weight:700;}',
        '#wallet-vip-deposit-card .vip-deposit-input{width:100%;box-sizing:border-box;padding:8px 12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.28);border-radius:8px;color:#fde68a;font-size:0.85rem;margin-top:8px;margin-bottom:6px;}',
        '#wallet-vip-deposit-card .vip-deposit-preview{font-size:0.80rem;color:#6ee7b7;margin-bottom:10px;min-height:1.1em;}',
        '#wallet-vip-deposit-card .vip-deposit-claim-btn{width:100%;padding:10px 0;border:none;border-radius:9px;font-size:0.88rem;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#fbbf24,#d97706);color:#1c1400;letter-spacing:0.3px;transition:opacity 0.15s;}',
        '#wallet-vip-deposit-card .vip-deposit-claim-btn:hover{opacity:0.88;}',
        '#wallet-vip-deposit-card .vip-deposit-cooldown{font-size:0.80rem;color:#9ca3af;padding:8px 0 4px;}',
        '#wallet-vip-deposit-card .vip-deposit-hint{font-size:0.75rem;color:#6b7280;margin-top:4px;}',
        '#wallet-vip-deposit-card .vip-deposit-progression{font-size:0.72rem;color:#78716c;margin-top:12px;border-top:1px solid rgba(234,179,8,0.15);padding-top:10px;line-height:1.5;}'
    ].join('');
    document.head.appendChild(s);
})();

/**
 * Public entry point — renders the VIP Deposit Bonus card inside the wallet modal.
 * Applies an ID guard so duplicate calls are no-ops.
 *
 * Fetches GET /api/user/vip-deposit-bonus (auth required) and renders:
 *   - VIP tier info: name, match%, maxBonus
 *   - Lifetime wagered amount
 *   - If available: deposit amount input + live bonus preview + Claim button
 *   - If on cooldown: next-available date + helper note
 *   - Tier progression note at the bottom
 *
 * On claim success: shows feedback label and calls updateBalanceDisplay(newBalance).
 *
 * @param {HTMLElement} parentContainer  The #walletModal element.
 */
async function walletRenderVipDepositSection(parentContainer) {
    if (!parentContainer) return;
    // ID guard
    if (document.getElementById('vipDepositSection')) return;
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var walletInner = parentContainer.querySelector('.wallet-modal');
    if (!walletInner) walletInner = parentContainer;

    // Create wrapper (placed after walletLoyaltyShopCardWrapper if present, else appended)
    var wrapper = document.createElement('div');
    wrapper.id = 'vipDepositSection';
    wrapper.style.cssText = 'padding:0 16px 0 16px;';

    var loyaltyWrapper = walletInner.querySelector('#walletLoyaltyShopCardWrapper');
    if (loyaltyWrapper && loyaltyWrapper.nextSibling) {
        walletInner.insertBefore(wrapper, loyaltyWrapper.nextSibling);
    } else if (loyaltyWrapper) {
        walletInner.appendChild(wrapper);
    } else {
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Build card shell
    var card = document.createElement('div');
    card.id = 'wallet-vip-deposit-card';

    // Header row
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:1rem;font-weight:800;color:#fbbf24;letter-spacing:0.3px;';
    title.textContent = '\uD83D\uDC51 VIP Deposit Bonus';

    titleRow.appendChild(title);
    card.appendChild(titleRow);

    // Loading placeholder
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'color:#fde68a;font-size:0.82rem;opacity:0.7;margin-bottom:8px;';
    loadingEl.textContent = 'Loading\u2026';
    card.appendChild(loadingEl);

    wrapper.appendChild(card);

    // Fetch VIP deposit bonus status
    var data = null;
    try {
        var resp = await fetch('/api/user/vip-deposit-bonus', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (_e) {}

    // Remove loading placeholder
    if (loadingEl.parentNode) loadingEl.remove();

    if (!data) {
        var errEl = document.createElement('div');
        errEl.style.cssText = 'color:#f87171;font-size:0.82rem;';
        errEl.textContent = 'Could not load VIP deposit bonus data.';
        card.appendChild(errEl);
        return;
    }

    var tier = data.tier || {};
    var tierName = tier.name || 'Base';
    var matchPct = parseInt(tier.matchPercent, 10) || 0;
    var maxBonus = parseFloat(tier.maxBonus) || 0;
    var lifetimeWagered = parseFloat(data.lifetimeWagered) || 0;
    var available = !!data.available;
    var nextAvailableAt = data.nextAvailableAt || null;
    var minDeposit = parseFloat(data.minDepositRequired) || 20;
    var wageringMult = parseInt(data.wageringMultiplier, 10) || 30;

    // Tier badge
    var badge = document.createElement('div');
    badge.className = 'vip-deposit-tier-badge';
    badge.textContent = 'Your Tier: ' + tierName + ' \u2014 ' + matchPct + '% match, up to $' + maxBonus.toFixed(0);
    card.appendChild(badge);

    // Lifetime wagered stat
    var wageredStat = document.createElement('div');
    wageredStat.className = 'vip-deposit-stat';
    var wageredLabel = document.createTextNode('Total wagered: ');
    var wageredValue = document.createElement('span');
    wageredValue.textContent = '$' + lifetimeWagered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    wageredStat.appendChild(wageredLabel);
    wageredStat.appendChild(wageredValue);
    card.appendChild(wageredStat);

    if (available) {
        // Deposit amount input
        var inputLabel = document.createElement('div');
        inputLabel.style.cssText = 'font-size:0.78rem;color:#fde68a;margin-top:10px;margin-bottom:2px;';
        inputLabel.textContent = 'Deposit amount (min $' + minDeposit.toFixed(0) + '):';
        card.appendChild(inputLabel);

        var amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.min = String(minDeposit);
        amountInput.step = '1';
        amountInput.className = 'vip-deposit-input';
        amountInput.placeholder = 'e.g. 50';
        card.appendChild(amountInput);

        // Live bonus preview
        var previewEl = document.createElement('div');
        previewEl.className = 'vip-deposit-preview';
        previewEl.textContent = 'Estimated bonus: $0.00';
        card.appendChild(previewEl);

        amountInput.addEventListener('input', function () {
            var amt = parseFloat(amountInput.value) || 0;
            if (amt < minDeposit) {
                previewEl.textContent = 'Estimated bonus: $0.00';
                return;
            }
            var bonus = Math.min(amt * (matchPct / 100), maxBonus);
            previewEl.textContent = 'Estimated bonus: $' + bonus.toFixed(2) + ' (' + wageringMult + 'x wagering required)';
        });

        // Claim button
        var claimBtn = document.createElement('button');
        claimBtn.className = 'vip-deposit-claim-btn';
        claimBtn.textContent = 'Claim VIP Bonus';
        card.appendChild(claimBtn);

        // Feedback label (hidden until claim)
        var feedbackEl = document.createElement('div');
        feedbackEl.style.cssText = 'font-size:0.82rem;color:#6ee7b7;margin-top:8px;min-height:1.1em;';
        feedbackEl.textContent = '';
        card.appendChild(feedbackEl);

        claimBtn.addEventListener('click', async function () {
            var depositAmt = parseFloat(amountInput.value) || 0;
            if (depositAmt < minDeposit) {
                feedbackEl.style.color = '#f87171';
                feedbackEl.textContent = 'Minimum deposit is $' + minDeposit.toFixed(2) + '.';
                return;
            }
            claimBtn.disabled = true;
            claimBtn.textContent = 'Claiming\u2026';
            var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            var claimData = null;
            try {
                var claimResp = await fetch('/api/user/claim-vip-deposit-bonus', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + claimToken
                    },
                    body: JSON.stringify({ depositAmount: depositAmt })
                });
                if (claimResp.ok) claimData = await claimResp.json();
            } catch (_e) {}

            if (claimData && claimData.success) {
                feedbackEl.style.color = '#6ee7b7';
                feedbackEl.textContent = '+$' + parseFloat(claimData.bonus).toFixed(2) + ' bonus added! (Tier: ' + (claimData.tier || tierName) + ')';
                claimBtn.disabled = true;
                claimBtn.textContent = 'Bonus Claimed';
                if (typeof updateBalanceDisplay === 'function') {
                    updateBalanceDisplay(claimData.newBalance);
                }
            } else {
                feedbackEl.style.color = '#f87171';
                feedbackEl.textContent = 'Claim failed. Please try again.';
                claimBtn.disabled = false;
                claimBtn.textContent = 'Claim VIP Bonus';
            }
        });

    } else {
        // Cooldown state
        var cooldownEl = document.createElement('div');
        cooldownEl.className = 'vip-deposit-cooldown';

        var cooldownText = document.createTextNode('Next available: ');
        cooldownEl.appendChild(cooldownText);

        var cooldownDate = document.createElement('span');
        cooldownDate.style.cssText = 'color:#d1d5db;font-weight:600;';
        if (nextAvailableAt) {
            var nextDate = new Date(nextAvailableAt);
            cooldownDate.textContent = nextDate.toLocaleString();
        } else {
            cooldownDate.textContent = 'Not yet available';
        }
        cooldownEl.appendChild(cooldownDate);
        card.appendChild(cooldownEl);

        var hintEl = document.createElement('div');
        hintEl.className = 'vip-deposit-hint';
        hintEl.textContent = 'Available weekly for verified deposits';
        card.appendChild(hintEl);
    }

    // Tier progression note
    var progressionEl = document.createElement('div');
    progressionEl.className = 'vip-deposit-progression';
    progressionEl.textContent = 'Bronze\u2192Silver at $1k wagered \u2022 Gold at $5k \u2022 Platinum at $20k \u2022 Diamond at $50k';
    card.appendChild(progressionEl);
}

/**
 * Renders the Weekend VIP Cashback card section in the wallet modal.
 * Shows cashback status (active/inactive) with relevant details.
 *
 * @param {HTMLElement} parentContainer  The #walletModal element.
 */
async function walletRenderWeekendCashbackSection(parentContainer) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // ID guard - only render once
    if (document.getElementById('walletWeekendCashbackSection')) return;

    // Inject CSS once
    if (!document.getElementById('weekendCashback-css')) {
        var s = document.createElement('style');
        s.id = 'weekendCashback-css';
        s.textContent = '.wallet-weekend-cashback { background: linear-gradient(135deg, #1a2a1a, #1e3a1e); border: 1px solid #2d5a2d; border-radius: 12px; padding: 16px; margin-bottom: 16px; } .wallet-weekend-cashback.active { border-color: #4CAF50; } .wallet-weekend-cashback h4 { color: #66bb6a; margin: 0 0 8px 0; font-size: 14px; } .wallet-weekend-cashback p { color: #aaa; font-size: 12px; margin: 4px 0; } .wallet-weekend-cashback .cashback-active-badge { background: #4CAF50; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; }';
        document.head.appendChild(s);
    }

    // Create placeholder card immediately so UI isn't empty while loading
    var section = document.createElement('div');
    section.id = 'walletWeekendCashbackSection';
    section.className = 'wallet-weekend-cashback';
    parentContainer.appendChild(section);

    var data = null;
    try {
        var resp = await fetch('/api/user/weekend-cashback', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) {
            data = await resp.json();
        }
    } catch (e) {
        console.warn('[WeekendCashback]', e);
    }

    if (data && data.active === true) {
        // Active cashback state
        section.classList.add('active');

        var activeHeader = document.createElement('h4');

        var giftSpan = document.createTextNode('\uD83C\uDF81 Weekend Cashback ');
        activeHeader.appendChild(giftSpan);

        var badge = document.createElement('span');
        badge.className = 'cashback-active-badge';
        badge.textContent = 'ACTIVE';
        activeHeader.appendChild(badge);
        section.appendChild(activeHeader);

        var rateP = document.createElement('p');
        var rateText = document.createElement('strong');
        rateText.style.color = '#81c784';
        rateText.textContent = (data.cashbackPercent || 15) + '% cashback on losses this weekend';
        rateP.appendChild(rateText);
        section.appendChild(rateP);

        if (data.minLoss) {
            var minP = document.createElement('p');
            minP.textContent = 'Minimum loss to qualify: $' + parseFloat(data.minLoss).toFixed(2);
            section.appendChild(minP);
        }

        if (data.maxCashback) {
            var maxP = document.createElement('p');
            maxP.textContent = 'Maximum cashback: $' + parseFloat(data.maxCashback).toFixed(2);
            section.appendChild(maxP);
        }

        if (data.periodEnd) {
            var endP = document.createElement('p');
            endP.textContent = 'Period ends: ' + new Date(data.periodEnd).toLocaleString();
            section.appendChild(endP);
        }

        if (data.eligibleTier) {
            var tierP = document.createElement('p');
            tierP.textContent = 'Your tier: ' + data.eligibleTier;
            section.appendChild(tierP);
        }

    } else if (data && data.active === false) {
        // Inactive / not yet weekend state
        var inactiveHeader = document.createElement('h4');
        inactiveHeader.textContent = '\uD83C\uDF81 Weekend VIP Cashback';
        section.appendChild(inactiveHeader);

        var descP = document.createElement('p');
        descP.textContent = '15% cashback on losses every weekend for eligible VIP players';
        section.appendChild(descP);

        var scheduleP = document.createElement('p');
        if (data.periodEnd) {
            scheduleP.textContent = 'Next cashback window: ' + new Date(data.periodEnd).toLocaleString();
        } else {
            scheduleP.textContent = 'Available on weekends';
        }
        section.appendChild(scheduleP);

        if (data.eligibleTier) {
            var tierNoteP = document.createElement('p');
            tierNoteP.textContent = 'Your tier: ' + data.eligibleTier;
            section.appendChild(tierNoteP);
        }

    } else {
        // Error or no data — show eligibility info card
        var infoHeader = document.createElement('h4');
        infoHeader.textContent = '\uD83C\uDF81 Weekend VIP Cashback';
        section.appendChild(infoHeader);

        var infoP = document.createElement('p');
        infoP.textContent = 'VIP players receive cashback on weekend losses. Reach Silver tier or above to unlock this benefit.';
        section.appendChild(infoP);
    }
}

/**
 * Renders the Win-Back Bonus status card in the wallet modal.
 * Shows active bonus balance and remaining wagering requirement when the
 * player has a win-back bonus that has not yet been fully cleared.
 *
 * @param {HTMLElement} parentContainer  The #walletModal element.
 */
async function walletRenderWinbackSection(parentContainer) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;
    if (document.getElementById('walletWinbackSection')) return;

    // Inject CSS once
    if (!document.getElementById('walletWinback-css')) {
        var s = document.createElement('style');
        s.id = 'walletWinback-css';
        s.textContent = '#walletWinbackSection { background: linear-gradient(135deg,#1a1200,#2d2000); border:1px solid rgba(251,191,36,0.5); border-radius:12px; padding:14px; margin-bottom:14px; } .wb-title { color:#fbbf24; font-size:14px; font-weight:700; margin:0 0 8px 0; } .wb-row { display:flex; justify-content:space-between; color:#aaa; font-size:12px; margin:4px 0; } .wb-row span:last-child { color:#fff; font-weight:600; } .wb-cta { background:linear-gradient(135deg,#d97706,#f59e0b); color:#000; font-weight:700; padding:8px 16px; border-radius:8px; border:none; cursor:pointer; font-size:13px; margin-top:10px; width:100%; }';
        document.head.appendChild(s);
    }

    // Create placeholder section immediately — no flash / layout shift
    var section = document.createElement('div');
    section.id = 'walletWinbackSection';
    parentContainer.appendChild(section);

    var data = null;
    try {
        var resp = await fetch('/api/user/winback-status', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) {
            data = await resp.json();
        }
    } catch (e) {
        console.warn('[Winback]', e);
    }

    // No active winback — silently remove the placeholder and bail out
    if (!data || data.hasActiveWinback !== true) {
        if (section.parentNode) {
            section.parentNode.removeChild(section);
        }
        return;
    }

    // ── Title ─────────────────────────────────────────────────────────────
    var title = document.createElement('p');
    title.className = 'wb-title';
    title.textContent = '\uD83C\uDF81 Win-Back Bonus Active';
    section.appendChild(title);

    // ── Bonus balance row ─────────────────────────────────────────────────
    var balRow = document.createElement('div');
    balRow.className = 'wb-row';

    var balLabel = document.createElement('span');
    balLabel.textContent = 'Bonus Credits:';
    balRow.appendChild(balLabel);

    var balValue = document.createElement('span');
    balValue.textContent = '$' + parseFloat(data.bonusBalance || 0).toFixed(2);
    balRow.appendChild(balValue);

    section.appendChild(balRow);

    // ── Wagering requirement row ──────────────────────────────────────────
    var wagRow = document.createElement('div');
    wagRow.className = 'wb-row';

    var wagLabel = document.createElement('span');
    wagLabel.textContent = 'Wagering Required:';
    wagRow.appendChild(wagLabel);

    var wagValue = document.createElement('span');
    wagValue.textContent = '$' + parseFloat(data.wageringRequirement || 0).toFixed(2);
    wagRow.appendChild(wagValue);

    section.appendChild(wagRow);

    // ── Helper line ───────────────────────────────────────────────────────
    var helpRow = document.createElement('div');
    helpRow.className = 'wb-row';

    var helpSpan = document.createElement('span');
    helpSpan.textContent = 'Wager $' + parseFloat(data.wageringRequirement || 0).toFixed(2) + ' to release your bonus';
    helpRow.appendChild(helpSpan);

    section.appendChild(helpRow);

    // ── CTA button ────────────────────────────────────────────────────────
    var cta = document.createElement('button');
    cta.className = 'wb-cta';
    cta.textContent = 'Play any slot to wager through your bonus!';
    cta.addEventListener('click', function () {
        if (typeof showWalletModal === 'function') {
            var modal = document.getElementById('walletModal');
            if (modal) modal.classList.remove('active');
        }
    });
    section.appendChild(cta);
}

/**
 * Renders the VIP Deposit Bonus section in the wallet modal.
 * Uses /api/vipdeposit/ endpoints.  Shows tier badge, bonus details,
 * and a claim button when the bonus is available.
 *
 * @param {HTMLElement} parentContainer  The #walletModal element.
 */
async function walletRenderVipDepositBonusSection(parentContainer) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // ID guard — remove stale element so it refreshes on wallet reopen
    var existing = parentContainer.querySelector('#walletVipDepositSection');
    if (existing) {
        existing.parentNode.removeChild(existing);
    }

    // Inject CSS once
    if (!document.getElementById('wallet-vip-deposit-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'wallet-vip-deposit-css';
        styleEl.textContent = [
            '#walletVipDepositSection {',
            '  background: #1a1a2e;',
            '  border-radius: 12px;',
            '  padding: 14px;',
            '  margin-bottom: 14px;',
            '}',
            '#walletVipDepositSection.tier-gold   { border: 1px solid #f0a500; }',
            '#walletVipDepositSection.tier-silver { border: 1px solid #aaa; }',
            '#walletVipDepositSection.tier-bronze { border: 1px solid #cd7f32; }',
            '.wvdb-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }',
            '.wvdb-headline { color:#fbbf24; font-size:14px; font-weight:800; }',
            '.wvdb-tier-badge { font-size:11px; font-weight:700; padding:3px 8px; border-radius:20px; text-transform:capitalize; }',
            '.wvdb-tier-badge.gold   { background:#f0a500; color:#000; }',
            '.wvdb-tier-badge.silver { background:#aaa;    color:#000; }',
            '.wvdb-tier-badge.bronze { background:#cd7f32; color:#fff; }',
            '.wvdb-detail { color:#ccc; font-size:12px; margin:4px 0; }',
            '.wvdb-detail span { color:#fff; font-weight:600; }',
            '.wvdb-status-row { display:flex; align-items:center; gap:8px; margin-top:10px; }',
            '.wvdb-badge { font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; }',
            '.wvdb-badge.available   { background:#27ae60; color:#fff; }',
            '.wvdb-badge.deposit-req { background:#f39c12; color:#fff; }',
            '.wvdb-badge.cooldown    { background:#666;    color:#fff; }',
            '.wvdb-next { font-size:11px; color:#999; margin-top:4px; }',
            '.wvdb-claim-btn { margin-top:10px; width:100%; padding:9px 0; border:none; border-radius:8px; cursor:pointer; font-weight:700; font-size:13px; background:linear-gradient(135deg,#d97706,#f59e0b); color:#000; }',
            '.wvdb-claim-btn:disabled { opacity:0.55; cursor:not-allowed; }',
            '.wvdb-feedback { font-size:12px; margin-top:6px; min-height:1em; }'
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    // Fetch status
    var data = null;
    try {
        var resp = await fetch('/api/vipdeposit/vip-deposit-bonus', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (err) {
        console.warn('[VipDepositBonus]', err);
    }

    // If no data or tier is none, don't render anything
    if (!data || data.tier === 'none' || !data.tier) return;

    var section = document.createElement('div');
    section.id = 'walletVipDepositSection';
    section.classList.add('tier-' + data.tier);
    parentContainer.appendChild(section);

    // ── Header row ────────────────────────────────────────────────────────
    var header = document.createElement('div');
    header.className = 'wvdb-header';

    var headline = document.createElement('span');
    headline.className = 'wvdb-headline';
    headline.textContent = 'VIP Deposit Match';
    header.appendChild(headline);

    var tierBadge = document.createElement('span');
    tierBadge.className = 'wvdb-tier-badge ' + data.tier;
    tierBadge.textContent = data.tier.charAt(0).toUpperCase() + data.tier.slice(1);
    header.appendChild(tierBadge);

    section.appendChild(header);

    // ── Detail rows ───────────────────────────────────────────────────────
    var bonusRow = document.createElement('div');
    bonusRow.className = 'wvdb-detail';
    var bonusLabel = document.createTextNode('Bonus: ');
    var bonusVal = document.createElement('span');
    bonusVal.textContent = data.bonusPct + '% on your next deposit';
    bonusRow.appendChild(bonusLabel);
    bonusRow.appendChild(bonusVal);
    section.appendChild(bonusRow);

    var capRow = document.createElement('div');
    capRow.className = 'wvdb-detail';
    var capLabel = document.createTextNode('Cap: ');
    var capVal = document.createElement('span');
    capVal.textContent = 'Up to $' + data.bonusCap;
    capRow.appendChild(capLabel);
    capRow.appendChild(capVal);
    section.appendChild(capRow);

    var wageredRow = document.createElement('div');
    wageredRow.className = 'wvdb-detail';
    var wageredLabel = document.createTextNode('Lifetime wagered: ');
    var wageredVal = document.createElement('span');
    wageredVal.textContent = '$' + (parseFloat(data.lifetimeWagered) || 0).toFixed(2) + ' wagered';
    wageredRow.appendChild(wageredLabel);
    wageredRow.appendChild(wageredVal);
    section.appendChild(wageredRow);

    // ── Status section ────────────────────────────────────────────────────
    var statusRow = document.createElement('div');
    statusRow.className = 'wvdb-status-row';

    var statusBadge = document.createElement('span');
    statusBadge.className = 'wvdb-badge';

    if (data.available && data.hasMinDeposit) {
        // Available — show claim button
        statusBadge.classList.add('available');
        statusBadge.textContent = 'Available';
        statusRow.appendChild(statusBadge);
        section.appendChild(statusRow);

        var claimBtn = document.createElement('button');
        claimBtn.className = 'wvdb-claim-btn';
        claimBtn.textContent = 'Claim Now';
        section.appendChild(claimBtn);

        var feedbackEl = document.createElement('div');
        feedbackEl.className = 'wvdb-feedback';
        section.appendChild(feedbackEl);

        claimBtn.addEventListener('click', async function () {
            claimBtn.disabled = true;
            claimBtn.textContent = 'Claiming\u2026';
            var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            var claimResult = null;
            try {
                var claimResp = await fetch('/api/vipdeposit/claim-vip-deposit-bonus', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + claimToken
                    }
                });
                claimResult = await claimResp.json();
            } catch (claimErr) {
                console.warn('[VipDepositBonus claim]', claimErr);
            }

            if (claimResult && claimResult.success) {
                feedbackEl.style.color = '#6ee7b7';
                feedbackEl.textContent = 'Bonus granted: $' + parseFloat(claimResult.bonus).toFixed(2) + '!';
                claimBtn.textContent = 'Claimed';
                claimBtn.disabled = true;
                if (typeof updateBalanceDisplay === 'function') {
                    updateBalanceDisplay(claimResult.newBalance);
                }
            } else {
                feedbackEl.style.color = '#f87171';
                feedbackEl.textContent = (claimResult && claimResult.error) ? claimResult.error : 'Claim failed. Please try again.';
                claimBtn.disabled = false;
                claimBtn.textContent = 'Claim Now';
            }
        });

    } else if (data.available && !data.hasMinDeposit) {
        // Available but needs deposit first
        statusBadge.classList.add('deposit-req');
        statusBadge.textContent = 'Deposit Required';
        statusRow.appendChild(statusBadge);
        section.appendChild(statusRow);

        var depositHint = document.createElement('div');
        depositHint.className = 'wvdb-next';
        depositHint.textContent = 'Make a qualifying deposit to activate your VIP match bonus.';
        section.appendChild(depositHint);

    } else {
        // On cooldown
        statusBadge.classList.add('cooldown');
        statusBadge.textContent = 'On Cooldown';
        statusRow.appendChild(statusBadge);
        section.appendChild(statusRow);

        if (data.nextAvailableAt) {
            var nextEl = document.createElement('div');
            nextEl.className = 'wvdb-next';
            var nextDate = new Date(data.nextAvailableAt);
            var nextText = document.createTextNode('Next available: ');
            var nextDateSpan = document.createElement('span');
            nextDateSpan.style.cssText = 'color:#d1d5db; font-weight:600;';
            nextDateSpan.textContent = nextDate.toLocaleString();
            nextEl.appendChild(nextText);
            nextEl.appendChild(nextDateSpan);
            section.appendChild(nextEl);
        }
    }
}

// ---------------------------------------------------------------------------
// Subscription status card
// ---------------------------------------------------------------------------
async function walletRenderSubscriptionSection(parentContainer) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Idempotency guard
    if (document.getElementById('subscriptionSection')) return;

    // Inject CSS once
    if (!document.getElementById('subscription-section-css')) {
        var s = document.createElement('style');
        s.id = 'subscription-section-css';
        s.textContent = [
            '#subscriptionSection {',
            '  background:#1a1a2e;',
            '  border-radius:12px;',
            '  padding:14px;',
            '  margin-bottom:14px;',
            '  border:1px solid #2d2d44;',
            '}',
            '#subscriptionSection.sub-bronze { border-color:#cd7f32; }',
            '#subscriptionSection.sub-silver { border-color:#aaa; }',
            '#subscriptionSection.sub-gold   { border-color:#f0a500; }',
            '.wsub-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }',
            '.wsub-headline { color:#a78bfa; font-size:14px; font-weight:800; }',
            '.wsub-tier-badge { font-size:11px; font-weight:700; padding:3px 8px; border-radius:20px; text-transform:capitalize; }',
            '.wsub-tier-badge.bronze { background:#cd7f32; color:#fff; }',
            '.wsub-tier-badge.silver { background:#aaa;    color:#000; }',
            '.wsub-tier-badge.gold   { background:#f0a500; color:#000; }',
            '.wsub-inactive { color:#999; font-size:12px; margin:6px 0 0; }',
            '.wsub-expiry { color:#ccc; font-size:12px; margin:4px 0; }',
            '.wsub-expiry span { color:#fff; font-weight:600; }',
            '.wsub-claim-btn { margin-top:10px; width:100%; padding:9px 0; border:none; border-radius:8px; cursor:pointer; font-weight:700; font-size:13px; background:linear-gradient(135deg,#7c3aed,#a78bfa); color:#fff; }',
            '.wsub-claim-btn:disabled { opacity:0.55; cursor:not-allowed; }',
            '.wsub-feedback { font-size:12px; margin-top:6px; min-height:1em; }',
            '.wsub-skeleton { background:#2d2d44; border-radius:6px; height:14px; margin:6px 0; animation:wsub-pulse 1.4s ease-in-out infinite; }',
            '.wsub-skeleton.wide { width:70%; }',
            '.wsub-skeleton.narrow { width:40%; }',
            '@keyframes wsub-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }'
        ].join('\n');
        document.head.appendChild(s);
    }

    // Build container
    var section = document.createElement('div');
    section.id = 'subscriptionSection';

    var header = document.createElement('div');
    header.className = 'wsub-header';

    var headline = document.createElement('div');
    headline.className = 'wsub-headline';
    headline.textContent = 'Subscription';
    header.appendChild(headline);
    section.appendChild(header);

    // Loading skeleton
    var sk1 = document.createElement('div');
    sk1.className = 'wsub-skeleton wide';
    var sk2 = document.createElement('div');
    sk2.className = 'wsub-skeleton narrow';
    section.appendChild(sk1);
    section.appendChild(sk2);

    parentContainer.appendChild(section);

    // Fetch status
    var data = null;
    try {
        var resp = await fetch('/api/subscription/status', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) data = await resp.json();
    } catch (err) {
        console.warn('[SubscriptionSection]', err);
    }

    // Remove skeletons
    if (sk1.parentNode) sk1.parentNode.removeChild(sk1);
    if (sk2.parentNode) sk2.parentNode.removeChild(sk2);

    if (!data) {
        // Error state
        var errEl = document.createElement('div');
        errEl.className = 'wsub-inactive';
        errEl.textContent = 'Unable to load subscription status.';
        section.appendChild(errEl);
        return;
    }

    if (!data.active) {
        // No active subscription
        var inactiveEl = document.createElement('div');
        inactiveEl.className = 'wsub-inactive';
        inactiveEl.textContent = 'No active subscription. Upgrade to Bronze, Silver, or Gold for daily rewards and exclusive perks.';
        section.appendChild(inactiveEl);
        return;
    }

    // Active subscription — add tier border
    var tierClass = (data.tier === 'gold' || data.tier === 'silver' || data.tier === 'bronze') ? ('sub-' + data.tier) : '';
    if (tierClass) section.classList.add(tierClass);

    // Tier badge in header
    var tierBadge = document.createElement('div');
    tierBadge.className = 'wsub-tier-badge';
    if (data.tier) tierBadge.classList.add(data.tier);
    tierBadge.textContent = data.tier ? (data.tier.charAt(0).toUpperCase() + data.tier.slice(1)) : 'Active';
    header.appendChild(tierBadge);

    // Expiry date
    if (data.expiresAt) {
        var expiryEl = document.createElement('div');
        expiryEl.className = 'wsub-expiry';
        var expiryLabel = document.createTextNode('Expires: ');
        var expirySpan = document.createElement('span');
        var expDate = new Date(data.expiresAt);
        expirySpan.textContent = expDate.toLocaleDateString();
        expiryEl.appendChild(expiryLabel);
        expiryEl.appendChild(expirySpan);
        section.appendChild(expiryEl);
    }

    // Claim daily reward button
    var claimBtn = document.createElement('button');
    claimBtn.className = 'wsub-claim-btn';

    var feedbackEl = document.createElement('div');
    feedbackEl.className = 'wsub-feedback';

    if (data.dailyClaimedToday) {
        claimBtn.disabled = true;
        claimBtn.textContent = 'Claimed Today \u2713';
    } else {
        claimBtn.textContent = 'Claim Daily Reward';
        claimBtn.addEventListener('click', async function () {
            claimBtn.disabled = true;
            claimBtn.textContent = 'Claiming\u2026';
            var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            var result = null;
            try {
                var claimResp = await fetch('/api/subscription/claim-daily', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + claimToken
                    }
                });
                result = await claimResp.json();
            } catch (claimErr) {
                console.warn('[SubscriptionSection claim]', claimErr);
            }

            if (result && result.success) {
                feedbackEl.style.color = '#6ee7b7';
                feedbackEl.textContent = result.message || 'Daily reward claimed!';
                claimBtn.textContent = 'Claimed Today \u2713';
                claimBtn.disabled = true;
                if (typeof updateBalanceDisplay === 'function') {
                    updateBalanceDisplay(result.newBalance);
                }
                if (typeof showToast === 'function') {
                    showToast(result.message || 'Subscription daily reward claimed!', 'success');
                }
            } else {
                feedbackEl.style.color = '#f87171';
                feedbackEl.textContent = (result && result.message) ? result.message : 'Claim failed. Please try again.';
                claimBtn.disabled = false;
                claimBtn.textContent = 'Claim Daily Reward';
            }
        });
    }

    section.appendChild(claimBtn);
    section.appendChild(feedbackEl);
}

// ---------------------------------------------------------------------------
// Loyalty Shop — redeem loyalty points for cash
// ---------------------------------------------------------------------------
async function walletRenderLoyaltyShopSection(parentContainer) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Idempotency guard
    if (document.getElementById('loyaltyShopSection')) return;

    // Inject CSS once
    if (!document.getElementById('loyalty-shop-css')) {
        var s = document.createElement('style');
        s.id = 'loyalty-shop-css';
        s.textContent = [
            '#loyaltyShopSection {',
            '  background:#1a1a2e;',
            '  border-radius:12px;',
            '  padding:14px;',
            '  margin-bottom:14px;',
            '  border:1px solid #2d2d44;',
            '}',
            '.wls-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }',
            '.wls-headline { color:#a78bfa; font-size:14px; font-weight:800; }',
            '.wls-points { color:#fbbf24; font-size:22px; font-weight:800; margin:6px 0; }',
            '.wls-lifetime { color:#999; font-size:11px; margin-bottom:8px; }',
            '.wls-rate { color:#ccc; font-size:12px; margin-bottom:12px; padding:6px 10px; background:#12121e; border-radius:8px; display:inline-block; }',
            '.wls-redeem-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; }',
            '.wls-input { flex:1; padding:8px 10px; border:1px solid #3d3d5c; border-radius:8px; background:#12121e; color:#fff; font-size:14px; font-weight:600; outline:none; }',
            '.wls-input:focus { border-color:#7c3aed; }',
            '.wls-estimate { color:#4ade80; font-size:13px; font-weight:600; min-height:1.2em; margin-bottom:8px; }',
            '.wls-redeem-btn { width:100%; padding:10px 0; border:none; border-radius:8px; cursor:pointer; font-weight:700; font-size:13px; background:linear-gradient(135deg,#7c3aed,#a78bfa); color:#fff; transition:opacity 0.2s; }',
            '.wls-redeem-btn:disabled { opacity:0.55; cursor:not-allowed; }',
            '.wls-feedback { font-size:12px; margin-top:6px; min-height:1em; }',
            '.wls-skeleton { background:#2d2d44; border-radius:6px; height:14px; margin:6px 0; animation:wls-pulse 1.4s ease-in-out infinite; }',
            '.wls-skeleton.wide { width:70%; }',
            '.wls-skeleton.narrow { width:40%; }',
            '.wls-error-msg { color:#f87171; font-size:12px; margin-top:8px; }',
            '@keyframes wls-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }'
        ].join('\n');
        document.head.appendChild(s);
    }

    // Build container
    var section = document.createElement('div');
    section.id = 'loyaltyShopSection';

    // Header
    var header = document.createElement('div');
    header.className = 'wls-header';
    var headline = document.createElement('span');
    headline.className = 'wls-headline';
    headline.textContent = '\uD83C\uDFEA Loyalty Shop';
    header.appendChild(headline);
    section.appendChild(header);

    // Loading skeleton
    var skelWide = document.createElement('div');
    skelWide.className = 'wls-skeleton wide';
    section.appendChild(skelWide);
    var skelNarrow = document.createElement('div');
    skelNarrow.className = 'wls-skeleton narrow';
    section.appendChild(skelNarrow);

    parentContainer.appendChild(section);

    // Fetch status
    var statusData = null;
    try {
        var resp = await fetch('/api/loyaltyshop/status', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        statusData = await resp.json();
    } catch (err) {
        // Remove skeletons and show error
        skelWide.remove();
        skelNarrow.remove();
        var errMsg = document.createElement('div');
        errMsg.className = 'wls-error-msg';
        errMsg.textContent = 'Could not load loyalty points. Try again later.';
        section.appendChild(errMsg);
        return;
    }

    // Remove skeletons
    skelWide.remove();
    skelNarrow.remove();

    // Points display
    var pointsEl = document.createElement('div');
    pointsEl.className = 'wls-points';
    pointsEl.textContent = '\uD83D\uDC8E ' + (statusData.points || 0).toLocaleString() + ' points';
    section.appendChild(pointsEl);

    // Lifetime points
    var lifetimeEl = document.createElement('div');
    lifetimeEl.className = 'wls-lifetime';
    lifetimeEl.textContent = 'Lifetime earned: ' + (statusData.lifetimePoints || 0).toLocaleString() + ' points';
    section.appendChild(lifetimeEl);

    // Conversion rate info
    var rateEl = document.createElement('div');
    rateEl.className = 'wls-rate';
    rateEl.textContent = '100 points = $1.00';
    section.appendChild(rateEl);

    // Redeem row: input + estimate
    var redeemRow = document.createElement('div');
    redeemRow.className = 'wls-redeem-row';
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'wls-input';
    input.placeholder = 'Points to redeem';
    input.min = '100';
    input.step = '100';
    input.max = String(statusData.points || 0);
    redeemRow.appendChild(input);
    section.appendChild(redeemRow);

    // Estimate display
    var estimateEl = document.createElement('div');
    estimateEl.className = 'wls-estimate';
    section.appendChild(estimateEl);

    // Update estimate on input
    input.addEventListener('input', function () {
        var val = parseInt(input.value, 10);
        if (!val || val < 100 || isNaN(val)) {
            estimateEl.textContent = '';
            return;
        }
        var dollars = (val / 100).toFixed(2);
        estimateEl.textContent = '= $' + dollars;
    });

    // Redeem button
    var redeemBtn = document.createElement('button');
    redeemBtn.className = 'wls-redeem-btn';
    redeemBtn.textContent = 'Redeem';
    section.appendChild(redeemBtn);

    // Feedback area
    var feedbackEl = document.createElement('div');
    feedbackEl.className = 'wls-feedback';
    section.appendChild(feedbackEl);

    // Redeem handler
    redeemBtn.addEventListener('click', async function () {
        var pts = parseInt(input.value, 10);
        if (!pts || pts < 100 || pts % 100 !== 0) {
            feedbackEl.style.color = '#f87171';
            feedbackEl.textContent = 'Enter a multiple of 100 (minimum 100).';
            return;
        }
        if (pts > (statusData.points || 0)) {
            feedbackEl.style.color = '#f87171';
            feedbackEl.textContent = 'Not enough points.';
            return;
        }
        redeemBtn.disabled = true;
        redeemBtn.textContent = 'Redeeming\u2026';
        feedbackEl.textContent = '';
        try {
            var rToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            var rResp = await fetch('/api/loyaltyshop/redeem', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + rToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ points: pts })
            });
            var data = await rResp.json();
            if (rResp.ok && data.success) {
                // Update balance
                if (typeof updateBalanceDisplay === 'function' && data.newBalance !== undefined) {
                    updateBalanceDisplay(data.newBalance);
                }
                // Update points display
                statusData.points = data.remainingPoints !== undefined ? data.remainingPoints : (statusData.points - pts);
                pointsEl.textContent = '\uD83D\uDC8E ' + statusData.points.toLocaleString() + ' points';
                input.max = String(statusData.points);
                input.value = '';
                estimateEl.textContent = '';
                feedbackEl.style.color = '#4ade80';
                var dollarStr = data.dollarValue !== undefined ? '$' + Number(data.dollarValue).toFixed(2) : '$' + (pts / 100).toFixed(2);
                feedbackEl.textContent = 'Redeemed ' + dollarStr + ' successfully!';
                redeemBtn.textContent = 'Redeem';
                redeemBtn.disabled = false;
                if (typeof showToast === 'function') {
                    showToast('Redeemed ' + dollarStr + ' from loyalty points!', 'success');
                }
            } else {
                feedbackEl.style.color = '#f87171';
                feedbackEl.textContent = (data && data.error) ? data.error : 'Redemption failed. Try again.';
                redeemBtn.textContent = 'Redeem';
                redeemBtn.disabled = false;
            }
        } catch (e) {
            feedbackEl.style.color = '#f87171';
            feedbackEl.textContent = 'Network error. Please try again.';
            redeemBtn.textContent = 'Redeem';
            redeemBtn.disabled = false;
        }
    });
}

// ── Limbo Quick-Game Card ──────────────────────────────────────────────
function renderLimboCard(parentContainer) {
    // TABLE GAMES REMOVED — slots only casino
    console.log('Limbo: table games removed, skipping render');
    return;

    if (document.getElementById('limboCard')) return;

    // ── inject CSS once ──
    if (!document.getElementById('limbo-card-css')) {
        var style = document.createElement('style');
        style.id = 'limbo-card-css';
        style.textContent = [
            '#limboCard { background:linear-gradient(135deg,rgba(30,20,50,0.95),rgba(15,10,35,0.98)); border:1px solid rgba(167,139,250,0.3); border-radius:16px; padding:20px 24px; margin:18px 20px; box-shadow:0 4px 24px rgba(0,0,0,0.3); }',
            '#limboCard .limbo-title { font-size:18px; font-weight:700; color:#e0d4ff; margin-bottom:14px; display:flex; align-items:center; gap:8px; }',
            '#limboCard .limbo-row { display:flex; gap:12px; margin-bottom:10px; align-items:center; flex-wrap:wrap; }',
            '#limboCard .limbo-field { display:flex; flex-direction:column; gap:4px; flex:1; min-width:100px; }',
            '#limboCard .limbo-field label { font-size:12px; color:#a5b4fc; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }',
            '#limboCard .limbo-field input { background:rgba(255,255,255,0.06); border:1px solid rgba(167,139,250,0.25); border-radius:8px; padding:8px 12px; color:#fff; font-size:15px; font-weight:600; outline:none; width:100%; box-sizing:border-box; }',
            '#limboCard .limbo-field input:focus { border-color:rgba(167,139,250,0.6); box-shadow:0 0 8px rgba(167,139,250,0.15); }',
            '#limboCard .limbo-info { display:flex; gap:18px; margin-bottom:14px; flex-wrap:wrap; }',
            '#limboCard .limbo-stat { font-size:13px; color:#c4b5fd; }',
            '#limboCard .limbo-stat span { font-weight:700; color:#e0d4ff; }',
            '#limboCard .limbo-play-btn { width:100%; padding:12px; border:none; border-radius:10px; font-size:16px; font-weight:700; cursor:pointer; background:linear-gradient(135deg,#7c3aed,#6d28d9); color:#fff; letter-spacing:0.5px; transition:all 0.2s; }',
            '#limboCard .limbo-play-btn:hover:not(:disabled) { background:linear-gradient(135deg,#8b5cf6,#7c3aed); transform:translateY(-1px); box-shadow:0 4px 16px rgba(124,58,237,0.3); }',
            '#limboCard .limbo-play-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; }',
            '#limboCard .limbo-result { margin-top:14px; padding:12px 16px; border-radius:10px; text-align:center; font-size:14px; font-weight:600; display:none; }',
            '#limboCard .limbo-result.win { background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.3); color:#4ade80; }',
            '#limboCard .limbo-result.loss { background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#f87171; }',
            '#limboCard .limbo-result-multiplier { font-size:28px; font-weight:800; margin-bottom:4px; }',
            '#limboCard .limbo-result-text { font-size:13px; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ── build card ──
    var card = document.createElement('div');
    card.id = 'limboCard';

    var title = document.createElement('div');
    title.className = 'limbo-title';
    title.textContent = '\u26A1 Limbo \u2014 Quick Bet';
    card.appendChild(title);

    // Row: bet + target
    var row = document.createElement('div');
    row.className = 'limbo-row';

    var betField = document.createElement('div');
    betField.className = 'limbo-field';
    var betLabel = document.createElement('label');
    betLabel.textContent = 'Bet Amount ($)';
    var betInput = document.createElement('input');
    betInput.type = 'number';
    betInput.id = 'limboBetInput';
    betInput.min = '0.25';
    betInput.step = '0.25';
    betInput.value = '1.00';
    betField.appendChild(betLabel);
    betField.appendChild(betInput);
    row.appendChild(betField);

    var targetField = document.createElement('div');
    targetField.className = 'limbo-field';
    var targetLabel = document.createElement('label');
    targetLabel.textContent = 'Target Multiplier';
    var targetInput = document.createElement('input');
    targetInput.type = 'number';
    targetInput.id = 'limboTargetInput';
    targetInput.min = '1.01';
    targetInput.step = '0.01';
    targetInput.value = '2.00';
    targetField.appendChild(targetLabel);
    targetField.appendChild(targetInput);
    row.appendChild(targetField);

    card.appendChild(row);

    // Info: win chance + potential payout
    var info = document.createElement('div');
    info.className = 'limbo-info';

    var chanceStat = document.createElement('div');
    chanceStat.className = 'limbo-stat';
    chanceStat.textContent = 'Win chance: ';
    var chanceVal = document.createElement('span');
    chanceVal.id = 'limboChanceVal';
    chanceVal.textContent = '48.5%';
    chanceStat.appendChild(chanceVal);
    info.appendChild(chanceStat);

    var payoutStat = document.createElement('div');
    payoutStat.className = 'limbo-stat';
    payoutStat.textContent = 'Potential payout: ';
    var payoutVal = document.createElement('span');
    payoutVal.id = 'limboPayoutVal';
    payoutVal.textContent = '$2.00';
    payoutStat.appendChild(payoutVal);
    info.appendChild(payoutStat);

    card.appendChild(info);

    // Play button
    var playBtn = document.createElement('button');
    playBtn.className = 'limbo-play-btn';
    playBtn.id = 'limboPlayBtn';
    playBtn.textContent = 'PLAY';
    card.appendChild(playBtn);

    // Result area
    var resultDiv = document.createElement('div');
    resultDiv.className = 'limbo-result';
    resultDiv.id = 'limboResultArea';
    var resultMult = document.createElement('div');
    resultMult.className = 'limbo-result-multiplier';
    resultMult.id = 'limboResultMult';
    resultDiv.appendChild(resultMult);
    var resultText = document.createElement('div');
    resultText.className = 'limbo-result-text';
    resultText.id = 'limboResultText';
    resultDiv.appendChild(resultText);
    card.appendChild(resultDiv);

    parentContainer.appendChild(card);

    // ── helpers ──
    function updateLimboInfo() {
        var t = parseFloat(targetInput.value) || 1.01;
        if (t < 1.01) t = 1.01;
        var b = parseFloat(betInput.value) || 0.25;
        if (b < 0.25) b = 0.25;
        var chance = Math.min(97, (0.97 / t) * 100).toFixed(1);
        chanceVal.textContent = chance + '%';
        payoutVal.textContent = '$' + (b * t).toFixed(2);
    }

    betInput.addEventListener('input', updateLimboInfo);
    targetInput.addEventListener('input', updateLimboInfo);

    // ── animated counter ──
    function animateLimboCounter(from, to, duration, callback) {
        var start = performance.now();
        var el = document.getElementById('limboResultMult');
        if (!el) { callback(); return; }
        function tick(now) {
            var elapsed = now - start;
            var progress = Math.min(elapsed / duration, 1);
            // ease-out cubic
            var ease = 1 - Math.pow(1 - progress, 3);
            var current = from + (to - from) * ease;
            el.textContent = current.toFixed(2) + 'x';
            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                el.textContent = to.toFixed(2) + 'x';
                callback();
            }
        }
        requestAnimationFrame(tick);
    }

    // ── play handler ──
    playBtn.addEventListener('click', async function() {
        if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
            if (typeof showToast === 'function') showToast('Please log in to play Limbo.', 'error');
            return;
        }
        var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
        if (!token) {
            if (typeof showToast === 'function') showToast('Please log in to play Limbo.', 'error');
            return;
        }

        var bet = parseFloat(betInput.value);
        var target = parseFloat(targetInput.value);
        if (!bet || bet < 0.25) {
            if (typeof showToast === 'function') showToast('Minimum bet is $0.25', 'error');
            return;
        }
        if (!target || target < 1.01) {
            if (typeof showToast === 'function') showToast('Minimum target is 1.01x', 'error');
            return;
        }

        playBtn.disabled = true;
        playBtn.textContent = 'PLAYING...';
        resultDiv.style.display = 'none';
        resultDiv.classList.remove('win', 'loss');

        try {
            var resp = await fetch('/api/limbo/play', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ bet: bet, target: target })
            });
            var data = await resp.json();
            if (!resp.ok) {
                if (typeof showToast === 'function') showToast((data && data.error) || 'Limbo play failed', 'error');
                playBtn.disabled = false;
                playBtn.textContent = 'PLAY';
                return;
            }

            // Show result with animated counter
            resultDiv.style.display = 'block';
            var resultVal = parseFloat(data.result) || 1.0;
            var isWin = !!data.win;

            resultDiv.classList.remove('win', 'loss');
            resultMult.textContent = '1.00x';
            resultText.textContent = '';

            animateLimboCounter(1.0, resultVal, 800, function() {
                resultDiv.classList.add(isWin ? 'win' : 'loss');
                if (isWin) {
                    resultText.textContent = 'You won $' + Number(data.payout).toFixed(2) + '!';
                } else {
                    resultText.textContent = 'You lost $' + Number(bet).toFixed(2);
                }
            });

            if (isWin && data.newBalance !== undefined) {
                if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(data.newBalance);
            } else if (data.newBalance !== undefined) {
                if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(data.newBalance);
            }
        } catch (e) {
            console.warn('Limbo play error:', e);
            if (typeof showToast === 'function') showToast('Network error. Please try again.', 'error');
        }

        playBtn.disabled = false;
        playBtn.textContent = 'PLAY';
    });
}

/* ============================================================
   * ============================================================ */
// Blackjack mini-game removed (slots only)


// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// RED DOG CARD GAME
// ═══════════════════════════════════════════════════════

function renderRedDogCard(parentContainer) {
    // TABLE GAMES REMOVED — slots only casino
    console.log('Red Dog: table games removed, skipping render');
    return;

    if (document.getElementById('redDogCard')) return;

    /* ── CSS (inject once) ───────────────────────────────── */
    if (!document.getElementById('redDogCardCSS')) {
        var style = document.createElement('style');
        style.id = 'redDogCardCSS';
        style.textContent = [
            '#redDogCard{background:linear-gradient(135deg,rgba(40,10,10,0.96),rgba(60,15,15,0.98));border-radius:16px;padding:20px 24px;margin:18px 20px;border:1px solid rgba(220,38,38,0.35);position:relative;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.3)}',
            '#redDogCard::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#dc2626,#ef4444,transparent)}',
            '.rd-title{font-size:1.25rem;font-weight:700;color:#ef4444;margin-bottom:14px;text-align:center}',
            '.rd-bet-row{display:flex;gap:10px;align-items:center;justify-content:center;margin-bottom:14px}',
            '.rd-bet-input{width:90px;padding:8px 10px;border-radius:8px;border:1px solid rgba(220,38,38,0.4);background:rgba(0,0,0,0.45);color:#fff;font-size:0.95rem;text-align:center;outline:none}',
            '.rd-bet-input:focus{border-color:rgba(220,38,38,0.7);box-shadow:0 0 8px rgba(220,38,38,0.2)}',
            '.rd-btn{padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-weight:700;font-size:0.9rem;text-transform:uppercase;transition:all 0.2s}',
            '.rd-btn:disabled{opacity:0.45;cursor:not-allowed}',
            '.rd-btn:hover:not(:disabled){filter:brightness(1.15);transform:translateY(-1px)}',
            '.rd-deal-btn{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;width:100%;padding:12px;border-radius:10px;font-size:1rem;letter-spacing:0.5px;margin-top:8px}',
            '.rd-deal-btn:hover:not(:disabled){background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 4px 16px rgba(220,38,38,0.3)}',
            '.rd-raise-btn{background:linear-gradient(135deg,#f59e0b,#d97706);color:#1a1a2e}',
            '.rd-stand-btn{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}',
            '.rd-cards-area{display:flex;gap:12px;justify-content:center;align-items:center;margin:18px 0;min-height:80px;flex-wrap:wrap}',
            '.rd-card{display:inline-flex;align-items:center;justify-content:center;width:56px;height:78px;border-radius:8px;background:#fff;color:#222;font-size:1.15rem;font-weight:700;border:2px solid #ccc;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:transform 0.3s}',
            '.rd-card.red{color:#d32f2f}',
            '.rd-card.facedown{background:linear-gradient(135deg,#7f1d1d,#991b1b);color:transparent;border-color:#dc2626}',
            '.rd-card.facedown::after{content:"?";color:rgba(255,255,255,0.3);font-size:1.4rem}',
            '.rd-card.reveal{animation:rdReveal 0.4s ease-out}',
            '@keyframes rdReveal{0%{transform:rotateY(90deg) scale(0.8)}100%{transform:rotateY(0) scale(1)}}',
            '.rd-spread-indicator{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:60px}',
            '.rd-spread-label{font-size:0.7rem;color:#999;text-transform:uppercase;letter-spacing:0.5px}',
            '.rd-spread-value{font-size:1.4rem;font-weight:800;color:#fbbf24}',
            '.rd-spread-payout{font-size:0.75rem;color:#a3a3a3}',
            '.rd-actions{display:flex;gap:10px;justify-content:center;margin-top:14px}',
            '.rd-result{text-align:center;font-size:1.05rem;font-weight:700;min-height:26px;margin-top:12px;padding:10px;border-radius:10px;display:none}',
            '.rd-result.win{display:block;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80}',
            '.rd-result.loss{display:block;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171}',
            '.rd-result.push{display:block;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);color:#fbbf24}',
            '.rd-rules{font-size:0.72rem;color:#737373;text-align:center;margin-top:10px;line-height:1.4}'
        ].join('\n');
        document.head.appendChild(style);
    }

    /* ── DOM structure ────────────────────────────────────── */
    var card = document.createElement('div');
    card.id = 'redDogCard';

    var titleEl = document.createElement('div');
    titleEl.className = 'rd-title';
    titleEl.textContent = '\uD83D\uDC15 Red Dog';
    card.appendChild(titleEl);

    // Bet row
    var betRow = document.createElement('div');
    betRow.className = 'rd-bet-row';

    var betLabel = document.createElement('span');
    betLabel.textContent = 'Bet: $';
    betLabel.style.color = '#ccc';
    betRow.appendChild(betLabel);

    var betInput = document.createElement('input');
    betInput.type = 'number';
    betInput.className = 'rd-bet-input';
    betInput.min = '0.50';
    betInput.step = '0.50';
    betInput.value = '1.00';
    betRow.appendChild(betInput);

    card.appendChild(betRow);

    // Deal button
    var dealBtn = document.createElement('button');
    dealBtn.className = 'rd-btn rd-deal-btn';
    dealBtn.textContent = 'DEAL';
    card.appendChild(dealBtn);

    // Cards area
    var cardsArea = document.createElement('div');
    cardsArea.className = 'rd-cards-area';
    card.appendChild(cardsArea);

    // Actions row (raise/stand) — hidden initially
    var actionsRow = document.createElement('div');
    actionsRow.className = 'rd-actions';
    actionsRow.style.display = 'none';

    var raiseBtn = document.createElement('button');
    raiseBtn.className = 'rd-btn rd-raise-btn';
    raiseBtn.textContent = 'RAISE (2x)';
    actionsRow.appendChild(raiseBtn);

    var standBtn = document.createElement('button');
    standBtn.className = 'rd-btn rd-stand-btn';
    standBtn.textContent = 'STAND';
    actionsRow.appendChild(standBtn);

    card.appendChild(actionsRow);

    // Result display
    var resultDisplay = document.createElement('div');
    resultDisplay.className = 'rd-result';
    card.appendChild(resultDisplay);

    // Rules text
    var rulesEl = document.createElement('div');
    rulesEl.className = 'rd-rules';
    rulesEl.textContent = 'Spread 1\u21925:1 | Spread 2\u21924:1 | Spread 3\u21922:1 | Spread 4+\u21921:1 | Pair match\u219211:1';
    card.appendChild(rulesEl);

    parentContainer.appendChild(card);

    /* ── Helpers ──────────────────────────────────────────── */
    var SUIT_SYMBOLS = { hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660' };

    function rdCardText(c) {
        return (c.rank || '') + (SUIT_SYMBOLS[c.suit] || c.suit || '');
    }

    function rdIsRed(c) {
        return c.suit === 'hearts' || c.suit === 'diamonds';
    }

    function rdMakeCardEl(c, facedown) {
        var el = document.createElement('div');
        el.className = 'rd-card';
        if (facedown) {
            el.classList.add('facedown');
        } else {
            if (rdIsRed(c)) el.classList.add('red');
            el.textContent = rdCardText(c);
        }
        return el;
    }

    function rdGetAuthHeaders() {
        if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return null;
        var tokenKey = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
        var token = localStorage.getItem(tokenKey);
        if (!token) return null;
        return {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        };
    }

    function rdRenderSpread(spreadVal) {
        var indicator = document.createElement('div');
        indicator.className = 'rd-spread-indicator';

        var spreadLabel = document.createElement('div');
        spreadLabel.className = 'rd-spread-label';

        var spreadValue = document.createElement('div');
        spreadValue.className = 'rd-spread-value';

        var payoutInfo = document.createElement('div');
        payoutInfo.className = 'rd-spread-payout';

        if (spreadVal === -1) {
            spreadLabel.textContent = 'PAIR';
            spreadValue.textContent = '=';
            payoutInfo.textContent = 'Push or 11:1';
        } else if (spreadVal === 0) {
            spreadLabel.textContent = 'CONSECUTIVE';
            spreadValue.textContent = '\u2194';
            payoutInfo.textContent = 'Push';
        } else {
            spreadLabel.textContent = 'SPREAD';
            spreadValue.textContent = String(spreadVal);
            var payout = spreadVal === 1 ? '5:1' : spreadVal === 2 ? '4:1' : spreadVal === 3 ? '2:1' : '1:1';
            payoutInfo.textContent = payout;
        }

        indicator.appendChild(spreadLabel);
        indicator.appendChild(spreadValue);
        indicator.appendChild(payoutInfo);
        return indicator;
    }

    /* ── Game state ───────────────────────────────────────── */
    var rdCurrentGameId = null;
    var rdCard1 = null;
    var rdCard2 = null;

    function rdResetUI() {
        cardsArea.textContent = '';
        resultDisplay.textContent = '';
        resultDisplay.className = 'rd-result';
        resultDisplay.style.display = 'none';
        actionsRow.style.display = 'none';
        dealBtn.disabled = false;
        dealBtn.textContent = 'DEAL';
        rdCurrentGameId = null;
        rdCard1 = null;
        rdCard2 = null;
    }

    function rdShowResult(text, cls) {
        resultDisplay.textContent = text;
        resultDisplay.className = 'rd-result';
        if (cls) resultDisplay.classList.add(cls);
        resultDisplay.style.display = 'block';
    }

    function rdRevealThirdCard(card3Data, win, payout, profit, newBal, isPush) {
        // Clear cards area and rebuild with all three
        cardsArea.textContent = '';

        var c1El = rdMakeCardEl(rdCard1, false);
        cardsArea.appendChild(c1El);

        // Spread indicator stays
        var spread = Math.abs(rdCard1.value - rdCard2.value) - 1;
        if (rdCard1.value === rdCard2.value) spread = -1;
        cardsArea.appendChild(rdRenderSpread(spread < -1 ? 0 : spread));

        var c2El = rdMakeCardEl(rdCard2, false);
        cardsArea.appendChild(c2El);

        // Arrow
        var arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:1.5rem;color:#fbbf24;margin:0 6px;';
        arrow.textContent = '\u2192';
        cardsArea.appendChild(arrow);

        // Third card with reveal animation
        var c3El = rdMakeCardEl(card3Data, false);
        c3El.classList.add('reveal');
        cardsArea.appendChild(c3El);

        // Show result
        actionsRow.style.display = 'none';

        if (isPush) {
            rdShowResult('Consecutive \u2014 Push! Bet returned.', 'push');
        } else if (win) {
            rdShowResult('Between! Won +$' + profit.toFixed(2), 'win');
        } else {
            rdShowResult('Not between \u2014 Lost', 'loss');
        }

        // Update balance
        if (typeof updateBalanceDisplay === 'function' && newBal !== undefined) {
            updateBalanceDisplay(newBal);
        }

        // Show play again after a beat
        setTimeout(function() {
            dealBtn.disabled = false;
            dealBtn.textContent = 'PLAY AGAIN';
        }, 800);
    }

    /* ── DEAL ─────────────────────────────────────────────── */
    dealBtn.addEventListener('click', async function() {
        if (rdCurrentGameId) {
            // Play Again mode — reset and allow new deal
            rdResetUI();
            return;
        }

        var headers = rdGetAuthHeaders();
        if (!headers) {
            if (typeof showToast === 'function') showToast('Please log in to play.', 'error');
            return;
        }

        var betVal = parseFloat(betInput.value);
        if (isNaN(betVal) || betVal < 0.50) {
            if (typeof showToast === 'function') showToast('Minimum bet is $0.50', 'error');
            return;
        }

        dealBtn.disabled = true;
        dealBtn.textContent = 'DEALING...';
        resultDisplay.style.display = 'none';
        resultDisplay.textContent = '';
        cardsArea.textContent = '';

        try {
            var resp = await fetch('/api/reddog/deal', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ bet: betVal })
            });
            var data = await resp.json();
            if (!resp.ok) {
                if (typeof showToast === 'function') showToast(data.error || 'Deal failed.', 'error');
                dealBtn.disabled = false;
                dealBtn.textContent = 'DEAL';
                return;
            }

            rdCurrentGameId = data.gameId;
            rdCard1 = data.card1;
            rdCard2 = data.card2;

            // Render card1, spread indicator, card2
            var c1El = rdMakeCardEl(data.card1, false);
            c1El.classList.add('reveal');
            cardsArea.appendChild(c1El);

            cardsArea.appendChild(rdRenderSpread(data.spread));

            var c2El = rdMakeCardEl(data.card2, false);
            c2El.classList.add('reveal');
            cardsArea.appendChild(c2El);

            // Third card placeholder (facedown)
            var arrow = document.createElement('span');
            arrow.style.cssText = 'font-size:1.5rem;color:#fbbf24;margin:0 6px;';
            arrow.textContent = '\u2192';
            cardsArea.appendChild(arrow);

            var c3Placeholder = document.createElement('div');
            c3Placeholder.className = 'rd-card facedown';
            cardsArea.appendChild(c3Placeholder);

            // If consecutive (spread=0), auto-resolve as push
            if (data.spread === 0) {
                // Consecutive — auto-stand (server will push)
                dealBtn.disabled = true;
                actionsRow.style.display = 'none';
                setTimeout(async function() {
                    try {
                        var standResp = await fetch('/api/reddog/stand', {
                            method: 'POST',
                            headers: rdGetAuthHeaders(),
                            body: JSON.stringify({ gameId: rdCurrentGameId })
                        });
                        var standData = await standResp.json();
                        if (standResp.ok) {
                            rdRevealThirdCard(standData.card3, standData.win, standData.payout, standData.profit, standData.newBalance, true);
                        } else {
                            rdShowResult('Error: ' + (standData.error || 'Unknown'), 'loss');
                            dealBtn.disabled = false;
                            dealBtn.textContent = 'PLAY AGAIN';
                        }
                    } catch (e2) {
                        console.warn('Red Dog stand error:', e2);
                        rdShowResult('Network error.', 'loss');
                        dealBtn.disabled = false;
                        dealBtn.textContent = 'PLAY AGAIN';
                    }
                }, 600);
            } else if (data.spread === -1) {
                // Pair — auto-draw third card for 11:1 chance
                dealBtn.disabled = true;
                actionsRow.style.display = 'none';
                setTimeout(async function() {
                    try {
                        var pairResp = await fetch('/api/reddog/stand', {
                            method: 'POST',
                            headers: rdGetAuthHeaders(),
                            body: JSON.stringify({ gameId: rdCurrentGameId })
                        });
                        var pairData = await pairResp.json();
                        if (pairResp.ok) {
                            rdRevealThirdCard(pairData.card3, pairData.win, pairData.payout, pairData.profit, pairData.newBalance, false);
                        } else {
                            rdShowResult('Error: ' + (pairData.error || 'Unknown'), 'loss');
                            dealBtn.disabled = false;
                            dealBtn.textContent = 'PLAY AGAIN';
                        }
                    } catch (e3) {
                        console.warn('Red Dog pair draw error:', e3);
                        rdShowResult('Network error.', 'loss');
                        dealBtn.disabled = false;
                        dealBtn.textContent = 'PLAY AGAIN';
                    }
                }, 600);
            } else {
                // Normal spread — show raise/stand buttons
                actionsRow.style.display = 'flex';
                raiseBtn.disabled = false;
                standBtn.disabled = false;
            }

        } catch (e) {
            console.warn('Red Dog deal error:', e);
            if (typeof showToast === 'function') showToast('Network error.', 'error');
            dealBtn.disabled = false;
            dealBtn.textContent = 'DEAL';
        }
    });

    /* ── RAISE ────────────────────────────────────────────── */
    raiseBtn.addEventListener('click', async function() {
        if (!rdCurrentGameId) return;

        var headers = rdGetAuthHeaders();
        if (!headers) return;

        raiseBtn.disabled = true;
        standBtn.disabled = true;

        try {
            var resp = await fetch('/api/reddog/raise', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ gameId: rdCurrentGameId })
            });
            var data = await resp.json();
            if (!resp.ok) {
                if (typeof showToast === 'function') showToast(data.error || 'Raise failed.', 'error');
                raiseBtn.disabled = false;
                standBtn.disabled = false;
                return;
            }

            rdRevealThirdCard(data.card3, data.win, data.payout, data.profit, data.newBalance, false);

        } catch (e) {
            console.warn('Red Dog raise error:', e);
            if (typeof showToast === 'function') showToast('Network error.', 'error');
            raiseBtn.disabled = false;
            standBtn.disabled = false;
        }
    });

    /* ── STAND ────────────────────────────────────────────── */
    standBtn.addEventListener('click', async function() {
        if (!rdCurrentGameId) return;

        var headers = rdGetAuthHeaders();
        if (!headers) return;

        raiseBtn.disabled = true;
        standBtn.disabled = true;

        try {
            var resp = await fetch('/api/reddog/stand', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ gameId: rdCurrentGameId })
            });
            var data = await resp.json();
            if (!resp.ok) {
                if (typeof showToast === 'function') showToast(data.error || 'Stand failed.', 'error');
                raiseBtn.disabled = false;
                standBtn.disabled = false;
                return;
            }

            rdRevealThirdCard(data.card3, data.win, data.payout, data.profit, data.newBalance, false);

        } catch (e) {
            console.warn('Red Dog stand error:', e);
            if (typeof showToast === 'function') showToast('Network error.', 'error');
            raiseBtn.disabled = false;
            standBtn.disabled = false;
        }
    });
}

/* ── Money Wheel ─────────────────────────────────────────────── */
// ═══════════════════════════════════════════════════════
/* ═══════════════════════════════════════════════════════════════════════════
   Deposit Streak Card — 7-day progressive deposit reward tracker
   ═══════════════════════════════════════════════════════════════════════════ */
function renderDepositStreakCard(parentContainer) {
    if (document.getElementById('depositStreakCard')) return;

    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    /* ── Fallback reward table (used if API unavailable) ── */
    var STREAK_REWARDS = {
        1: { gems: 100, credits: 0, label: '100 Gems' },
        2: { gems: 150, credits: 0, label: '150 Gems' },
        3: { gems: 300, credits: 2.00, label: '300 Gems + $2' },
        4: { gems: 300, credits: 0, label: '300 Gems' },
        5: { gems: 500, credits: 5.00, label: '500 Gems + $5' },
        6: { gems: 500, credits: 0, label: '500 Gems' },
        7: { gems: 1000, credits: 10.00, label: 'MEGA: 1000 Gems + $10' }
    };
    var STREAK_MAX = 7;

    function fmtMoney(x) {
        return typeof formatMoney === 'function' ? formatMoney(x) : '$' + x.toFixed(2);
    }

    /* ── CSS injection ── */
    if (!document.getElementById('deposit-streak-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'deposit-streak-css';
        styleEl.textContent = [
            '#depositStreakCard{background:linear-gradient(135deg,#1a0a00 0%,#2d1100 40%,#4a1a00 100%);border:2px solid #ff6b00;border-radius:16px;padding:24px;margin-top:18px;position:relative;overflow:hidden}',
            '#depositStreakCard::before{content:"";position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,107,0,0.06) 0%,transparent 70%);animation:dsFireGlow 4s ease-in-out infinite}',
            '@keyframes dsFireGlow{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}',
            '.ds-title{font-size:22px;font-weight:800;color:#ff8c00;text-align:center;margin-bottom:6px;position:relative;text-shadow:0 0 20px rgba(255,140,0,0.5)}',
            '.ds-subtitle{font-size:13px;color:#cc8844;text-align:center;margin-bottom:20px;position:relative}',
            '.ds-tracker{display:flex;justify-content:space-between;gap:6px;margin-bottom:18px;position:relative}',
            '.ds-day{flex:1;display:flex;flex-direction:column;align-items:center;padding:10px 4px;border-radius:12px;background:rgba(0,0,0,0.4);border:2px solid rgba(255,107,0,0.15);transition:all 0.3s ease;position:relative;min-width:0}',
            '.ds-day.ds-completed{background:linear-gradient(135deg,rgba(34,120,15,0.35) 0%,rgba(60,160,30,0.2) 100%);border-color:#4caf50;box-shadow:0 0 10px rgba(76,175,80,0.3)}',
            '.ds-day.ds-completed .ds-day-num{color:#66bb6a}',
            '.ds-day.ds-current{background:linear-gradient(135deg,rgba(255,107,0,0.25) 0%,rgba(255,60,0,0.15) 100%);border-color:#ff8c00;box-shadow:0 0 20px rgba(255,140,0,0.4);animation:dsPulseDay 2s ease-in-out infinite}',
            '@keyframes dsPulseDay{0%,100%{box-shadow:0 0 15px rgba(255,140,0,0.3);transform:scale(1)}50%{box-shadow:0 0 30px rgba(255,140,0,0.6);transform:scale(1.04)}}',
            '.ds-day.ds-future{opacity:0.45}',
            '.ds-day.ds-mega{border-color:#ffd700 !important}',
            '.ds-day.ds-mega.ds-current{box-shadow:0 0 25px rgba(255,215,0,0.5);animation:dsMegaPulse 2s ease-in-out infinite}',
            '@keyframes dsMegaPulse{0%,100%{box-shadow:0 0 20px rgba(255,215,0,0.4);transform:scale(1)}50%{box-shadow:0 0 40px rgba(255,215,0,0.8);transform:scale(1.06)}}',
            '.ds-day-num{font-size:11px;font-weight:700;color:#aa6633;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px}',
            '.ds-day-gem{font-size:16px;margin-bottom:2px}',
            '.ds-day-gem-count{font-size:12px;font-weight:700;color:#ff8c00;white-space:nowrap}',
            '.ds-day-credit{font-size:10px;font-weight:600;color:#4caf50;margin-top:2px;white-space:nowrap}',
            '.ds-day-check{font-size:18px;color:#4caf50;margin-bottom:2px}',
            '.ds-mega-label{position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#ffd700,#ff8c00);color:#1a0a00;font-size:8px;font-weight:900;padding:2px 6px;border-radius:4px;white-space:nowrap;letter-spacing:1px;z-index:1}',
            '.ds-status-bar{text-align:center;padding:12px 16px;border-radius:10px;position:relative;margin-bottom:14px}',
            '.ds-status-bar.ds-deposited{background:linear-gradient(135deg,rgba(76,175,80,0.2),rgba(76,175,80,0.1));border:1px solid rgba(76,175,80,0.4)}',
            '.ds-status-bar.ds-pending{background:linear-gradient(135deg,rgba(255,107,0,0.2),rgba(255,60,0,0.1));border:1px solid rgba(255,107,0,0.4)}',
            '.ds-status-text{font-size:14px;font-weight:700}',
            '.ds-status-bar.ds-deposited .ds-status-text{color:#66bb6a}',
            '.ds-status-bar.ds-pending .ds-status-text{color:#ff8c00}',
            '.ds-progress-wrap{position:relative;height:8px;background:rgba(0,0,0,0.5);border-radius:4px;margin-bottom:14px;overflow:hidden}',
            '.ds-progress-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#ff4500,#ff8c00,#ffd700);transition:width 1s ease;position:relative}',
            '.ds-progress-fill::after{content:"";position:absolute;top:0;right:0;width:20px;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3));animation:dsShimmer 1.5s infinite}',
            '@keyframes dsShimmer{0%{opacity:0}50%{opacity:1}100%{opacity:0}}',
            '.ds-best-streak{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.2);border-radius:10px;position:relative}',
            '.ds-best-icon{font-size:20px}',
            '.ds-best-text{font-size:13px;color:#ccaa66}',
            '.ds-best-num{font-size:18px;font-weight:800;color:#ffd700;text-shadow:0 0 10px rgba(255,215,0,0.5)}',
            '.ds-fire-trail{position:absolute;bottom:0;left:0;width:100%;height:40px;background:linear-gradient(to top,rgba(255,69,0,0.1),transparent);pointer-events:none}',
            '.ds-loading{text-align:center;padding:30px;color:#aa6633;font-size:14px;position:relative}',
            '.ds-loading::after{content:"";display:inline-block;width:16px;height:16px;border:2px solid #ff6b00;border-top-color:transparent;border-radius:50%;animation:dsSpin 0.8s linear infinite;margin-left:8px;vertical-align:middle}',
            '@keyframes dsSpin{to{transform:rotate(360deg)}}',
            '.ds-error{text-align:center;padding:20px;color:#ff6b6b;font-size:13px;position:relative}',
            '.ds-streak-count{font-size:36px;font-weight:900;text-align:center;margin-bottom:4px;position:relative;background:linear-gradient(180deg,#ffd700 0%,#ff8c00 50%,#ff4500 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-shadow:none;filter:drop-shadow(0 0 8px rgba(255,140,0,0.4))}',
            '.ds-streak-label{font-size:12px;color:#aa6633;text-align:center;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;position:relative}'
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    /* ── Card container ── */
    var card = document.createElement('div');
    card.id = 'depositStreakCard';

    /* Loading state */
    var loadingEl = document.createElement('div');
    loadingEl.className = 'ds-loading';
    loadingEl.textContent = 'Loading streak data';
    card.appendChild(loadingEl);

    parentContainer.appendChild(card);

    /* ── Fetch streak status ── */
    fetch('/api/deposit-streak/status', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) {
        if (!res.ok) throw new Error('Streak data unavailable');
        return res.json();
    })
    .then(function(data) {
        var streak = data.streak || 0;
        var nextDay = data.nextDay || (streak + 1);
        var streakMax = data.streakMax || STREAK_MAX;
        var depositedToday = !!data.depositedToday;
        var rewards = data.rewards || STREAK_REWARDS;
        var bestStreak = data.bestStreak || streak;

        /* Clear loading */
        card.innerHTML = '';

        /* ── Fire trail decoration ── */
        var fireTrail = document.createElement('div');
        fireTrail.className = 'ds-fire-trail';
        card.appendChild(fireTrail);

        /* ── Title ── */
        var titleEl = document.createElement('div');
        titleEl.className = 'ds-title';
        titleEl.textContent = '\uD83D\uDD25 Deposit Streak';
        card.appendChild(titleEl);

        /* ── Subtitle ── */
        var subtitleEl = document.createElement('div');
        subtitleEl.className = 'ds-subtitle';
        subtitleEl.textContent = 'Deposit daily to unlock bigger rewards!';
        card.appendChild(subtitleEl);

        /* ── Large streak count ── */
        var countEl = document.createElement('div');
        countEl.className = 'ds-streak-count';
        countEl.textContent = streak + ' / ' + streakMax;
        card.appendChild(countEl);

        var countLabel = document.createElement('div');
        countLabel.className = 'ds-streak-label';
        countLabel.textContent = streak === 0 ? 'No Active Streak' : 'Day Streak';
        card.appendChild(countLabel);

        /* ── Progress bar ── */
        var progressWrap = document.createElement('div');
        progressWrap.className = 'ds-progress-wrap';
        var progressFill = document.createElement('div');
        progressFill.className = 'ds-progress-fill';
        var pct = streakMax > 0 ? Math.min((streak / streakMax) * 100, 100) : 0;
        progressFill.style.width = '0%';
        progressWrap.appendChild(progressFill);
        card.appendChild(progressWrap);

        /* Animate progress bar after render */
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                progressFill.style.width = pct + '%';
            });
        });

        /* ── 7-day tracker ── */
        var tracker = document.createElement('div');
        tracker.className = 'ds-tracker';

        for (var d = 1; d <= streakMax; d++) {
            (function(day) {
                var dayReward = rewards[day] || STREAK_REWARDS[day] || { gems: 0, credits: 0, label: '' };
                var dayEl = document.createElement('div');
                dayEl.className = 'ds-day';

                var isCompleted = day <= streak;
                var isCurrent = day === nextDay;
                var isMega = day === streakMax;

                if (isCompleted) {
                    dayEl.classList.add('ds-completed');
                } else if (isCurrent) {
                    dayEl.classList.add('ds-current');
                } else {
                    dayEl.classList.add('ds-future');
                }

                if (isMega) {
                    dayEl.classList.add('ds-mega');
                    var megaLabel = document.createElement('div');
                    megaLabel.className = 'ds-mega-label';
                    megaLabel.textContent = 'MEGA';
                    dayEl.appendChild(megaLabel);
                }

                /* Day number */
                var dayNum = document.createElement('div');
                dayNum.className = 'ds-day-num';
                dayNum.textContent = 'Day ' + day;
                dayEl.appendChild(dayNum);

                if (isCompleted) {
                    /* Show checkmark for completed days */
                    var checkEl = document.createElement('div');
                    checkEl.className = 'ds-day-check';
                    checkEl.textContent = '\u2714';
                    dayEl.appendChild(checkEl);
                } else {
                    /* Gem icon */
                    var gemIcon = document.createElement('div');
                    gemIcon.className = 'ds-day-gem';
                    gemIcon.textContent = '\uD83D\uDC8E';
                    dayEl.appendChild(gemIcon);
                }

                /* Gem count */
                var gemCount = document.createElement('div');
                gemCount.className = 'ds-day-gem-count';
                var gemVal = dayReward.gems || 0;
                gemCount.textContent = gemVal > 0 ? gemVal.toLocaleString() : '';
                dayEl.appendChild(gemCount);

                /* Credit bonus (if applicable) */
                var creditVal = dayReward.credits || 0;
                if (creditVal > 0) {
                    var creditEl = document.createElement('div');
                    creditEl.className = 'ds-day-credit';
                    creditEl.textContent = '+' + fmtMoney(creditVal);
                    dayEl.appendChild(creditEl);
                }

                tracker.appendChild(dayEl);
            })(d);
        }

        card.appendChild(tracker);

        /* ── Status bar ── */
        var statusBar = document.createElement('div');
        statusBar.className = 'ds-status-bar';

        var statusText = document.createElement('div');
        statusText.className = 'ds-status-text';

        if (depositedToday) {
            statusBar.classList.add('ds-deposited');
            statusText.textContent = '\u2714 Deposited Today \u2014 Streak Secured!';
        } else if (streak === 0) {
            statusBar.classList.add('ds-pending');
            statusText.textContent = '\uD83D\uDD25 Make a deposit to start your streak!';
        } else {
            statusBar.classList.add('ds-pending');
            statusText.textContent = '\u26A0 Deposit today to continue your streak!';
        }

        statusBar.appendChild(statusText);

        /* Show next reward preview when not deposited */
        if (!depositedToday && nextDay <= streakMax) {
            var nextReward = rewards[nextDay] || STREAK_REWARDS[nextDay];
            if (nextReward) {
                var previewEl = document.createElement('div');
                previewEl.style.cssText = 'font-size:12px;color:#cc8844;margin-top:6px;';
                var previewLabel = nextReward.label || (nextReward.gems + ' Gems');
                previewEl.textContent = 'Next reward: ' + previewLabel;
                statusBar.appendChild(previewEl);
            }
        }

        /* Show completion message for full streak */
        if (streak >= streakMax && depositedToday) {
            statusText.textContent = '\uD83C\uDF1F Streak Complete! All rewards claimed!';
            statusBar.className = 'ds-status-bar ds-deposited';
        }

        card.appendChild(statusBar);

        /* ── Best streak badge ── */
        var bestVal = Math.max(bestStreak, streak);
        if (bestVal > 0) {
            var bestRow = document.createElement('div');
            bestRow.className = 'ds-best-streak';

            var bestIcon = document.createElement('span');
            bestIcon.className = 'ds-best-icon';
            bestIcon.textContent = '\uD83C\uDFC6';
            bestRow.appendChild(bestIcon);

            var bestText = document.createElement('span');
            bestText.className = 'ds-best-text';
            bestText.textContent = 'Personal Best:';
            bestRow.appendChild(bestText);

            var bestNum = document.createElement('span');
            bestNum.className = 'ds-best-num';
            bestNum.textContent = bestVal + ' Day' + (bestVal !== 1 ? 's' : '');
            bestRow.appendChild(bestNum);

            if (bestVal >= streakMax) {
                var crownEl = document.createElement('span');
                crownEl.style.cssText = 'font-size:18px;';
                crownEl.textContent = '\uD83D\uDC51';
                bestRow.appendChild(crownEl);
            }

            card.appendChild(bestRow);
        }
    })
    .catch(function(err) {
        console.warn('Deposit streak load error:', err);
        card.innerHTML = '';

        var errorEl = document.createElement('div');
        errorEl.className = 'ds-error';
        errorEl.textContent = 'Could not load streak data. Try again later.';
        card.appendChild(errorEl);
    });
}

// ═══════════════════════════════════════════════════════
// RELOAD BONUS CARD
// ═══════════════════════════════════════════════════════
async function _renderReloadBonusSection(modal) {
    if (!modal || modal.querySelector('#walletReloadBonusCard')) return;
    if (!currentUser) return;

    // Inject CSS once
    if (!document.getElementById('reload-bonus-css')) {
        var s = document.createElement('style');
        s.id = 'reload-bonus-css';
        s.textContent = [
            '.rb-card{background:linear-gradient(135deg,#1a0a2e,#2e1a3e);border:1px solid rgba(168,85,247,0.4);border-radius:10px;padding:14px;margin:14px 0;color:#fff;}',
            '.rb-title{font-size:15px;font-weight:700;color:#c084fc;margin:0 0 4px;}',
            '.rb-desc{font-size:12px;color:rgba(255,255,255,0.6);margin:0 0 10px;line-height:1.4;}',
            '.rb-eligible{background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:6px;padding:10px;margin-bottom:10px;font-size:13px;color:#e9d5ff;text-align:center;}',
            '.rb-claim-btn{width:100%;padding:10px;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;font-weight:700;border-radius:8px;border:none;cursor:pointer;font-size:14px;margin-top:6px;transition:all 0.2s;}',
            '.rb-claim-btn:hover:not(:disabled){transform:scale(1.02);box-shadow:0 0 16px rgba(168,85,247,0.5);}',
            '.rb-claim-btn:disabled{opacity:0.4;cursor:not-allowed;}',
            '.rb-cooldown{font-size:12px;color:#888;text-align:center;margin-top:6px;}'
        ].join('');
        document.head.appendChild(s);
    }

    var card = document.createElement('div');
    card.id = 'walletReloadBonusCard';
    card.className = 'rb-card';

    var title = document.createElement('div');
    title.className = 'rb-title';
    title.textContent = '\uD83D\uDD04 Weekly Reload Bonus';
    card.appendChild(title);

    var desc = document.createElement('div');
    desc.className = 'rb-desc';
    desc.textContent = '25% match on your next deposit (up to $2.50) — resets every 7 days.';
    card.appendChild(desc);

    var content = document.createElement('div');
    content.textContent = 'Loading...';
    content.style.fontSize = '12px';
    content.style.color = '#888';
    card.appendChild(content);

    // Insert above walletContent or at end
    var walletContent = modal.querySelector('#walletContent');
    if (walletContent) {
        walletContent.parentNode.insertBefore(card, walletContent);
    } else {
        modal.appendChild(card);
    }

    try {
        var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
        if (!token) { card.style.display = 'none'; return; }
        var res = await fetch('/api/reloadbonus/status', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) { card.style.display = 'none'; return; }
        var data = await res.json();

        content.innerHTML = '';

        if (data.eligible || data.available) {
            var eligibleBox = document.createElement('div');
            eligibleBox.className = 'rb-eligible';
            eligibleBox.innerHTML = '\u2728 <strong>Reload Bonus Available!</strong><br>Deposit $' + data.minDeposit.toFixed(2) + '+ to get 25% match (up to $' + data.maxBonus.toFixed(2) + ')';
            content.appendChild(eligibleBox);

            var claimBtn = document.createElement('button');
            claimBtn.className = 'rb-claim-btn';
            claimBtn.textContent = 'CLAIM RELOAD BONUS';
            claimBtn.onclick = async function() {
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming...';
                try {
                    var claimRes = await fetch('/api/reloadbonus/claim', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({})
                    });
                    var claimData = await claimRes.json();
                    if (claimData.success) {
                        if (typeof showToast === 'function') showToast('\uD83C\uDF89 Reload bonus of $' + claimData.bonus.toFixed(2) + ' added to bonus balance!', 'success');
                        content.innerHTML = '<div class="rb-eligible" style="color:#86efac;border-color:#22c55e;">\u2705 Bonus claimed! $' + claimData.bonus.toFixed(2) + ' added to bonus balance.</div>';
                        if (typeof updateBalance === 'function') updateBalance();
                    } else {
                        claimBtn.disabled = false;
                        claimBtn.textContent = 'CLAIM RELOAD BONUS';
                        if (typeof showToast === 'function') showToast(claimData.error || 'Could not claim bonus', 'error');
                    }
                } catch (e) {
                    claimBtn.disabled = false;
                    claimBtn.textContent = 'CLAIM RELOAD BONUS';
                }
            };
            content.appendChild(claimBtn);
        } else {
            var cooldown = document.createElement('div');
            cooldown.className = 'rb-cooldown';
            if (data.nextAvailableAt) {
                var nextDate = new Date(data.nextAvailableAt);
                var now = new Date();
                var diffMs = nextDate - now;
                var days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                cooldown.textContent = '\u23F3 Next reload bonus available in ' + days + ' day' + (days === 1 ? '' : 's');
            } else {
                cooldown.textContent = 'Reload bonus not available yet.';
            }
            content.appendChild(cooldown);
        }
    } catch (err) {
        content.textContent = '';
        card.style.display = 'none';
    }
}

/**
 * Render Deposit Limits section showing current limits and usage,
 * with inline form to set/update limits.
 */
async function _renderDepositLimitsSection(modal) {
    if (!modal) return;
    if (!currentUser) return;

    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Inject CSS once
    if (!document.getElementById('deposit-limits-css')) {
        var s = document.createElement('style');
        s.id = 'deposit-limits-css';
        s.textContent = [
            '.dl-card{background:linear-gradient(135deg,rgba(217,119,6,0.08),rgba(180,83,9,0.05));border:1.5px solid rgba(217,119,6,0.25);border-radius:12px;padding:16px;margin:14px 0;color:#fff;}',
            '.dl-title{font-size:15px;font-weight:800;color:#fbbf24;margin:0 0 10px;letter-spacing:0.3px;display:flex;align-items:center;gap:6px;}',
            '.dl-limit-row{background:rgba(0,0,0,0.3);border-radius:8px;padding:10px 12px;margin-bottom:8px;}',
            '.dl-limit-label{font-size:12px;color:#d97706;font-weight:600;margin-bottom:4px;}',
            '.dl-limit-display{display:flex;align-items:center;gap:8px;margin-bottom:6px;}',
            '.dl-limit-amount{font-size:18px;font-weight:700;color:#fbbf24;font-family:monospace;}',
            '.dl-limit-status{font-size:11px;color:rgba(255,255,255,0.6);}',
            '.dl-progress-bar{width:100%;height:6px;background:rgba(0,0,0,0.5);border-radius:3px;overflow:hidden;margin-bottom:4px;}',
            '.dl-progress-fill{height:100%;background:linear-gradient(90deg,#d97706,#f97316);transition:width 0.3s;}',
            '.dl-progress-text{font-size:10px;color:rgba(255,255,255,0.5);text-align:right;}',
            '.dl-button-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
            '.dl-set-btn{flex:1;min-width:120px;padding:8px 12px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;transition:all 0.2s;}',
            '.dl-set-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 4px 12px rgba(217,119,6,0.4);}',
            '.dl-set-btn:disabled{opacity:0.5;cursor:not-allowed;}',
            '.dl-form-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;align-items:center;justify-content:center;}',
            '.dl-form-overlay.active{display:flex;}',
            '.dl-form-modal{background:rgba(17,24,39,0.95);border:1.5px solid rgba(217,119,6,0.3);border-radius:10px;padding:20px;max-width:400px;width:90%;max-height:80vh;overflow-y:auto;}',
            '.dl-form-title{font-size:16px;font-weight:800;color:#fbbf24;margin-bottom:14px;letter-spacing:0.3px;}',
            '.dl-form-group{margin-bottom:12px;}',
            '.dl-form-label{display:block;font-size:12px;color:#fbbf24;font-weight:600;margin-bottom:4px;}',
            '.dl-form-input{width:100%;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid rgba(217,119,6,0.3);border-radius:6px;color:#fff;font-size:13px;font-family:monospace;}',
            '.dl-form-input:focus{outline:none;border-color:rgba(217,119,6,0.6);box-shadow:0 0 8px rgba(217,119,6,0.2);}',
            '.dl-form-note{font-size:11px;color:rgba(255,255,255,0.6);margin-top:3px;line-height:1.4;}',
            '.dl-form-buttons{display:flex;gap:8px;margin-top:16px;}',
            '.dl-form-save{flex:1;padding:10px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;transition:all 0.2s;}',
            '.dl-form-save:hover:not(:disabled){transform:scale(1.02);box-shadow:0 0 12px rgba(217,119,6,0.4);}',
            '.dl-form-save:disabled{opacity:0.5;cursor:not-allowed;}',
            '.dl-form-cancel{flex:1;padding:10px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid rgba(217,119,6,0.2);border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;transition:all 0.2s;}',
            '.dl-form-cancel:hover{background:rgba(0,0,0,0.5);}',
            '.dl-no-limit{color:#6ee7b7;font-style:italic;}'
        ].join('');
        document.head.appendChild(s);
    }

    // Create or get the wrapper
    var walletInner = modal.querySelector('.wallet-modal') || modal;
    var wrapper = walletInner.querySelector('#walletDepositLimitsWrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'walletDepositLimitsWrapper';
        wrapper.style.cssText = 'padding:0 16px;';
        var walletContentEl = walletInner.querySelector('#walletContent');
        if (walletContentEl) {
            walletInner.insertBefore(wrapper, walletContentEl);
        } else {
            walletInner.appendChild(wrapper);
        }
    }

    // Remove existing card
    var existing = wrapper.querySelector('#walletDepositLimitsCard');
    if (existing) existing.remove();

    // Create the card
    var card = document.createElement('div');
    card.id = 'walletDepositLimitsCard';
    card.className = 'dl-card';

    // Title
    var title = document.createElement('div');
    title.className = 'dl-title';
    title.textContent = '🔒 Deposit Limits';
    card.appendChild(title);

    // Limits container
    var limitsContainer = document.createElement('div');
    limitsContainer.id = 'dlLimitsContainer';
    card.appendChild(limitsContainer);

    // Buttons row
    var btnRow = document.createElement('div');
    btnRow.className = 'dl-button-row';

    var setLimitsBtn = document.createElement('button');
    setLimitsBtn.className = 'dl-set-btn';
    setLimitsBtn.textContent = '⚙️ Set/Update Limits';
    btnRow.appendChild(setLimitsBtn);

    card.appendChild(btnRow);
    wrapper.appendChild(card);

    // Form overlay (hidden until button clicked)
    var formOverlay = document.createElement('div');
    formOverlay.id = 'dlFormOverlay';
    formOverlay.className = 'dl-form-overlay';

    var formModal = document.createElement('div');
    formModal.className = 'dl-form-modal';

    var formTitle = document.createElement('div');
    formTitle.className = 'dl-form-title';
    formTitle.textContent = 'Set Your Deposit Limits';
    formModal.appendChild(formTitle);

    // Form inputs
    var dailyGroup = document.createElement('div');
    dailyGroup.className = 'dl-form-group';
    dailyGroup.innerHTML = '<label class="dl-form-label">Daily Limit ($)</label><input class="dl-form-input" id="dlDailyInput" type="number" min="0" step="0.01" placeholder="0 for no limit">';
    formModal.appendChild(dailyGroup);

    var weeklyGroup = document.createElement('div');
    weeklyGroup.className = 'dl-form-group';
    weeklyGroup.innerHTML = '<label class="dl-form-label">Weekly Limit ($)</label><input class="dl-form-input" id="dlWeeklyInput" type="number" min="0" step="0.01" placeholder="0 for no limit">';
    formModal.appendChild(weeklyGroup);

    var monthlyGroup = document.createElement('div');
    monthlyGroup.className = 'dl-form-group';
    monthlyGroup.innerHTML = '<label class="dl-form-label">Monthly Limit ($)</label><input class="dl-form-input" id="dlMonthlyInput" type="number" min="0" step="0.01" placeholder="0 for no limit">';
    formModal.appendChild(monthlyGroup);

    var noteEl = document.createElement('div');
    noteEl.className = 'dl-form-note';
    noteEl.textContent = '📋 Note: Raising limits has a 24-hour cooling-off period. Enter 0 or leave blank for no limit.';
    formModal.appendChild(noteEl);

    // Form buttons
    var formBtnRow = document.createElement('div');
    formBtnRow.className = 'dl-form-buttons';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'dl-form-save';
    saveBtn.textContent = 'Save Limits';
    saveBtn.onclick = function() { _saveLimits(modal, token, formOverlay); };
    formBtnRow.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'dl-form-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = function() { formOverlay.classList.remove('active'); };
    formBtnRow.appendChild(cancelBtn);

    formModal.appendChild(formBtnRow);
    formOverlay.appendChild(formModal);
    document.body.appendChild(formOverlay);

    // Set Limits button click handler
    setLimitsBtn.onclick = function() {
        formOverlay.classList.add('active');
    };

    // Close overlay when clicking outside modal
    formOverlay.addEventListener('click', function(e) {
        if (e.target === formOverlay) {
            formOverlay.classList.remove('active');
        }
    });

    // Fetch and display limits
    try {
        var resp = await fetch('/api/deposit-limits/', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!resp.ok) {
            limitsContainer.textContent = 'Could not load deposit limits.';
            return;
        }
        var data = await resp.json();

        // Clear container
        limitsContainer.innerHTML = '';

        // Helper to format limit display
        function displayLimit(label, amount, usage) {
            var row = document.createElement('div');
            row.className = 'dl-limit-row';

            var labelEl = document.createElement('div');
            labelEl.className = 'dl-limit-label';
            labelEl.textContent = label;
            row.appendChild(labelEl);

            var displayEl = document.createElement('div');
            displayEl.className = 'dl-limit-display';

            var amountEl = document.createElement('span');
            amountEl.className = 'dl-limit-amount';
            if (amount <= 0) {
                amountEl.textContent = 'No limit set';
                amountEl.className += ' dl-no-limit';
            } else {
                amountEl.textContent = '$' + parseFloat(amount).toFixed(2);
            }
            displayEl.appendChild(amountEl);

            if (usage !== undefined && amount > 0) {
                var statusEl = document.createElement('span');
                statusEl.className = 'dl-limit-status';
                var usageStr = ' (' + parseFloat(usage).toFixed(2) + ' used)';
                statusEl.textContent = usageStr;
                displayEl.appendChild(statusEl);
            }

            row.appendChild(displayEl);

            // Progress bar if usage exists and limit is set
            if (usage !== undefined && amount > 0) {
                var barContainer = document.createElement('div');
                barContainer.className = 'dl-progress-bar';

                var barFill = document.createElement('div');
                barFill.className = 'dl-progress-fill';
                var pct = Math.min(100, (usage / amount) * 100);
                barFill.style.width = pct + '%';
                barContainer.appendChild(barFill);

                row.appendChild(barContainer);

                var pctText = document.createElement('div');
                pctText.className = 'dl-progress-text';
                pctText.textContent = pct.toFixed(1) + '% used';
                row.appendChild(pctText);
            }

            limitsContainer.appendChild(row);
        }

        // Display each limit
        displayLimit('Daily Limit', data.dailyLimit || 0, data.dailyUsage || 0);
        displayLimit('Weekly Limit', data.weeklyLimit || 0, data.weeklyUsage || 0);
        displayLimit('Monthly Limit', data.monthlyLimit || 0, data.monthlyUsage || 0);

        // Populate form inputs for editing
        var dailyInput = document.getElementById('dlDailyInput');
        var weeklyInput = document.getElementById('dlWeeklyInput');
        var monthlyInput = document.getElementById('dlMonthlyInput');

        if (dailyInput && data.dailyLimit > 0) dailyInput.value = parseFloat(data.dailyLimit).toFixed(2);
        if (weeklyInput && data.weeklyLimit > 0) weeklyInput.value = parseFloat(data.weeklyLimit).toFixed(2);
        if (monthlyInput && data.monthlyLimit > 0) monthlyInput.value = parseFloat(data.monthlyLimit).toFixed(2);

    } catch (err) {
        console.warn('[Deposit Limits] Error fetching limits:', err);
        limitsContainer.textContent = 'Unable to load deposit limits at this time.';
    }
}

/**
 * Save new deposit limits via POST /api/deposit-limits/
 */
async function _saveLimits(modal, token, formOverlay) {
    var dailyInput = document.getElementById('dlDailyInput');
    var weeklyInput = document.getElementById('dlWeeklyInput');
    var monthlyInput = document.getElementById('dlMonthlyInput');

    if (!dailyInput || !weeklyInput || !monthlyInput) return;

    var daily = parseFloat(dailyInput.value) || 0;
    var weekly = parseFloat(weeklyInput.value) || 0;
    var monthly = parseFloat(monthlyInput.value) || 0;

    // Basic validation
    if ((daily < 0 || daily > 999999) || (weekly < 0 || weekly > 999999) || (monthly < 0 || monthly > 999999)) {
        if (typeof showToast === 'function') {
            showToast('Please enter valid limit amounts (0-999999)', 'error', 3000);
        }
        return;
    }

    try {
        var resp = await fetch('/api/deposit-limits/', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dailyLimit: daily,
                weeklyLimit: weekly,
                monthlyLimit: monthly
            })
        });

        var result = await resp.json();

        if (result.success) {
            formOverlay.classList.remove('active');
            if (typeof showToast === 'function') {
                showToast('✅ Deposit limits saved successfully!', 'success', 3000);
            }
            // Refresh the limits display
            await _renderDepositLimitsSection(modal);
        } else {
            if (typeof showToast === 'function') {
                showToast(result.error || 'Failed to save limits', 'error', 3000);
            }
        }
    } catch (err) {
        console.warn('[Deposit Limits] Error saving limits:', err);
        if (typeof showToast === 'function') {
            showToast('Error saving limits. Please try again.', 'error', 3000);
        }
    }
}
