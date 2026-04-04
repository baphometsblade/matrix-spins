// ═══════════════════════════════════════════════════════
// PROFILE / ACCOUNT MODULE
// ═══════════════════════════════════════════════════════
//
// Client-side profile & account management modal.
// Depends on: constants.js, globals.js (formatMoney, balance,
//   currentUser, stats), auth.js (apiRequest, logout),
//   ui-modals.js (showToast, addFunds)
//
// All functions are in the global scope (no ES modules).


// ── State ────────────────────────────────────────────────
let profileData = null;
let profileActiveTab = 'overview'; // 'overview' | 'security' | 'verification' | 'limits' | 'history'
let profileHistoryPage = 1;
let profileHistoryFilter = 'all';
const PROFILE_HISTORY_PAGE_SIZE = 15;

// ── Avatar colour palette keyed by first letter ─────────
const PROFILE_AVATAR_GRADIENTS = {
    A: ['#f97316', '#ef4444'], B: ['#8b5cf6', '#6366f1'], C: ['#06b6d4', '#3b82f6'],
    D: ['#ec4899', '#f43f5e'], E: ['#10b981', '#059669'], F: ['#f59e0b', '#d97706'],
    G: ['#14b8a6', '#0d9488'], H: ['#e11d48', '#be123c'], I: ['#6366f1', '#4f46e5'],
    J: ['#22c55e', '#16a34a'], K: ['#f472b6', '#db2777'], L: ['#a855f7', '#9333ea'],
    M: ['#fb923c', '#ea580c'], N: ['#2dd4bf', '#14b8a6'], O: ['#60a5fa', '#3b82f6'],
    P: ['#c084fc', '#a855f7'], Q: ['#4ade80', '#22c55e'], R: ['#f87171', '#ef4444'],
    S: ['#fbbf24', '#f59e0b'], T: ['#38bdf8', '#0ea5e9'], U: ['#818cf8', '#6366f1'],
    V: ['#fb7185', '#f43f5e'], W: ['#a78bfa', '#8b5cf6'], X: ['#34d399', '#10b981'],
    Y: ['#fcd34d', '#fbbf24'], Z: ['#f472b6', '#ec4899']
};

function getAvatarGradient(username) {
    const letter = (username || 'A').charAt(0).toUpperCase();
    const pair = PROFILE_AVATAR_GRADIENTS[letter] || ['#fbbf24', '#f59e0b'];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

function getAvatarInitials(username) {
    if (!username) return '?';
    const parts = username.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return username.substring(0, 2).toUpperCase();
}


// ═══════════════════════════════════════════════════════
// INJECT MODAL HTML + STYLES (once)
// ═══════════════════════════════════════════════════════

(function injectProfileModal() {
    // ── CSS ──────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
/* ── Profile Modal ─────────────────────────────────── */
.profile-modal-wrapper {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    z-index:10400;
    overflow-y: auto;
    padding: 20px;
    animation: profile-fadeIn 0.25s ease-out;
}
.profile-modal-wrapper.active {
    display: flex;
    align-items: flex-start;
    justify-content: center;
}

@keyframes profile-fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}

.profile-modal {
    display: flex;
    width: 100%;
    max-width: 960px;
    min-height: 560px;
    background: linear-gradient(160deg, #0f172a 0%, #1e1b3a 100%);
    border: 1px solid rgba(251, 191, 36, 0.25);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 0 40px rgba(251, 191, 36, 0.08);
    margin-top: 30px;
    margin-bottom: 30px;
}

/* ── Sidebar ───────────────────────────────────────── */
.profile-sidebar {
    width: 220px;
    min-width: 220px;
    background: rgba(15, 23, 42, 0.8);
    border-right: 1px solid rgba(251, 191, 36, 0.15);
    padding: 28px 0 20px;
    display: flex;
    flex-direction: column;
}

.profile-sidebar-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 800;
    color: #fff;
    margin: 0 auto 12px;
    border: 3px solid rgba(251, 191, 36, 0.5);
    box-shadow: 0 4px 20px rgba(251, 191, 36, 0.2);
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
    letter-spacing: 2px;
}

.profile-sidebar-name {
    text-align: center;
    font-size: 15px;
    font-weight: 700;
    color: #e2e8f0;
    margin-bottom: 4px;
    padding: 0 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.profile-sidebar-email {
    text-align: center;
    font-size: 11px;
    color: #64748b;
    margin-bottom: 24px;
    padding: 0 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.profile-nav {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
}

.profile-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    font-size: 13px;
    font-weight: 600;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.2s;
    border-left: 3px solid transparent;
}

.profile-nav-item:hover {
    color: #e2e8f0;
    background: rgba(251, 191, 36, 0.06);
}

.profile-nav-item.active {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.1);
    border-left-color: #fbbf24;
}

.profile-nav-item .profile-nav-icon {
    font-size: 16px;
    width: 22px;
    text-align: center;
}

.profile-sidebar-footer {
    padding: 16px 20px 0;
    border-top: 1px solid rgba(100, 116, 139, 0.2);
    margin-top: 12px;
}

.profile-sidebar-footer button {
    width: 100%;
    padding: 10px;
    border: 1px solid #dc2626;
    border-radius: 8px;
    background: rgba(220, 38, 38, 0.1);
    color: #fca5a5;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
}

.profile-sidebar-footer button:hover {
    background: rgba(220, 38, 38, 0.25);
    color: #fff;
}

/* ── Main Content ──────────────────────────────────── */
.profile-content {
    flex: 1;
    padding: 32px;
    overflow-y: auto;
    max-height: 80vh;
}

.profile-close-btn {
    position: absolute;
    top: 16px;
    right: 20px;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 28px;
    cursor: pointer;
    line-height: 1;
    z-index:10400;
    transition: color 0.2s;
}
.profile-close-btn:hover { color: #fbbf24; }

.profile-section-title {
    font-size: 20px;
    font-weight: 800;
    color: #fbbf24;
    margin-bottom: 20px;
    letter-spacing: 0.5px;
}

.profile-card {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(100, 116, 139, 0.2);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 20px;
}

.profile-card-title {
    font-size: 12px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 14px;
}

/* ── Overview Tab ──────────────────────────────────── */
.profile-overview-header {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 24px;
}

.profile-avatar-large {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 36px;
    font-weight: 800;
    color: #fff;
    border: 4px solid rgba(251, 191, 36, 0.5);
    box-shadow: 0 6px 28px rgba(251, 191, 36, 0.25);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    letter-spacing: 2px;
    flex-shrink: 0;
}

.profile-header-info {
    flex: 1;
    min-width: 0;
}

.profile-header-username {
    font-size: 22px;
    font-weight: 800;
    color: #f1f5f9;
    margin-bottom: 2px;
}

.profile-header-meta {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 8px;
}

.profile-header-balance {
    display: flex;
    align-items: center;
    gap: 12px;
}

.profile-balance-amount {
    font-size: 24px;
    font-weight: 800;
    color: #fbbf24;
}

.profile-deposit-btn {
    padding: 6px 16px;
    border: 1px solid rgba(251, 191, 36, 0.4);
    border-radius: 8px;
    background: rgba(251, 191, 36, 0.12);
    color: #fbbf24;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
}
.profile-deposit-btn:hover {
    background: rgba(251, 191, 36, 0.25);
}

.profile-kyc-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    margin-top: 6px;
}
.profile-kyc-badge.unverified { background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); }
.profile-kyc-badge.pending    { background: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
.profile-kyc-badge.verified   { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }

/* Quick Stats */
.profile-quick-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 20px;
}

.profile-stat-box {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(100, 116, 139, 0.15);
    border-radius: 12px;
    padding: 14px;
    text-align: center;
}

.profile-stat-value {
    font-size: 18px;
    font-weight: 800;
    color: #fbbf24;
    margin-bottom: 4px;
}

.profile-stat-label {
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ── Form Elements ─────────────────────────────────── */
.profile-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}

.profile-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.profile-field.full-width {
    grid-column: 1 / -1;
}

.profile-field label {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.profile-field input,
.profile-field select {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(100, 116, 139, 0.3);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    color: #e2e8f0;
    outline: none;
    transition: border-color 0.2s;
    font-family: inherit;
}

.profile-field input:focus,
.profile-field select:focus {
    border-color: rgba(251, 191, 36, 0.5);
    box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.08);
}

.profile-field input::placeholder { color: #475569; }

.profile-btn {
    padding: 10px 24px;
    border: none;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.3px;
}

.profile-btn-primary {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #000;
}
.profile-btn-primary:hover {
    background: linear-gradient(135deg, #fcd34d, #fbbf24);
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(251, 191, 36, 0.3);
}

.profile-btn-danger {
    background: rgba(220, 38, 38, 0.15);
    color: #fca5a5;
    border: 1px solid rgba(220, 38, 38, 0.3);
}
.profile-btn-danger:hover {
    background: rgba(220, 38, 38, 0.3);
    color: #fff;
}

.profile-btn-outline {
    background: transparent;
    color: #94a3b8;
    border: 1px solid rgba(100, 116, 139, 0.3);
}
.profile-btn-outline:hover {
    background: rgba(100, 116, 139, 0.1);
    color: #e2e8f0;
}

.profile-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
}

/* ── Security Tab ──────────────────────────────────── */
.profile-pw-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 380px;
}

.profile-session-info {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 10px;
    border: 1px solid rgba(100, 116, 139, 0.15);
    font-size: 12px;
    color: #94a3b8;
}

.profile-session-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}

/* ── Verification Tab ──────────────────────────────── */
.profile-verify-status {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    border-radius: 14px;
    margin-bottom: 20px;
}
.profile-verify-status.unverified { background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); }
.profile-verify-status.pending    { background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.2); }
.profile-verify-status.verified   { background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); }

.profile-verify-icon {
    font-size: 36px;
}

.profile-verify-text h3 {
    font-size: 16px;
    font-weight: 700;
    color: #e2e8f0;
    margin: 0 0 4px;
}

.profile-verify-text p {
    font-size: 12px;
    color: #94a3b8;
    margin: 0;
}

.profile-benefits-list {
    list-style: none;
    padding: 0;
    margin: 0 0 20px;
}

.profile-benefits-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    font-size: 13px;
    color: #cbd5e1;
    border-bottom: 1px solid rgba(100, 116, 139, 0.1);
}

.profile-benefits-list li:last-child { border-bottom: none; }

.profile-benefit-check {
    color: #22c55e;
    font-weight: 700;
}

/* ── Limits Tab ────────────────────────────────────── */
.profile-limits-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}

.profile-limit-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.profile-limit-field label {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.profile-limit-field input,
.profile-limit-field select {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(100, 116, 139, 0.3);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    color: #e2e8f0;
    outline: none;
    transition: border-color 0.2s;
    font-family: inherit;
}

.profile-limit-field input:focus,
.profile-limit-field select:focus {
    border-color: rgba(251, 191, 36, 0.5);
}

.profile-self-exclude-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.profile-self-exclude-btn {
    padding: 8px 16px;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.08);
    color: #fca5a5;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.profile-self-exclude-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #fff;
}

.profile-rg-notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 12px;
    font-size: 12px;
    color: #93c5fd;
    line-height: 1.5;
}

.profile-rg-notice a {
    color: #60a5fa;
    text-decoration: underline;
}

/* ── History Tab ───────────────────────────────────── */
.profile-history-filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 16px;
}

.profile-filter-btn {
    padding: 6px 14px;
    border: 1px solid rgba(100, 116, 139, 0.25);
    border-radius: 20px;
    background: transparent;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}

.profile-filter-btn:hover {
    border-color: rgba(251, 191, 36, 0.3);
    color: #e2e8f0;
}

.profile-filter-btn.active {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
    border-color: rgba(251, 191, 36, 0.4);
}

.profile-history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

.profile-history-table th {
    text-align: left;
    padding: 10px 12px;
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid rgba(100, 116, 139, 0.2);
}

.profile-history-table td {
    padding: 10px 12px;
    color: #cbd5e1;
    border-bottom: 1px solid rgba(100, 116, 139, 0.08);
}

.profile-history-table tr:hover td {
    background: rgba(251, 191, 36, 0.03);
}

.profile-history-type {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
}

.profile-history-type.deposit    { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.profile-history-type.withdrawal { background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
.profile-history-type.spin       { background: rgba(99, 102, 241, 0.15); color: #a5b4fc; }
.profile-history-type.bonus      { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.profile-history-type.win        { background: rgba(16, 185, 129, 0.15); color: #34d399; }

.profile-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 16px;
}

.profile-page-btn {
    padding: 6px 14px;
    border: 1px solid rgba(100, 116, 139, 0.25);
    border-radius: 8px;
    background: transparent;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}
.profile-page-btn:hover { background: rgba(100, 116, 139, 0.1); color: #e2e8f0; }
.profile-page-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.profile-page-info {
    font-size: 12px;
    color: #64748b;
}

/* ── Empty state ───────────────────────────────────── */
.profile-empty {
    text-align: center;
    padding: 40px 20px;
    color: #64748b;
    font-size: 13px;
}

.profile-empty-icon {
    font-size: 40px;
    margin-bottom: 12px;
    opacity: 0.5;
}

/* ── Loading spinner ───────────────────────────────── */
.profile-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
}

.profile-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(251, 191, 36, 0.15);
    border-top-color: #fbbf24;
    border-radius: 50%;
    animation: profile-spin 0.8s linear infinite;
}

@keyframes profile-spin {
    to { transform: rotate(360deg); }
}

/* ── Responsible gambling banner ───────────────────── */
.profile-rg-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: rgba(251, 191, 36, 0.06);
    border: 1px solid rgba(251, 191, 36, 0.15);
    border-radius: 10px;
    font-size: 11px;
    color: #94a3b8;
    margin-top: 20px;
}

.profile-rg-banner strong {
    color: #fbbf24;
}

/* ── Mobile: horizontal tab bar ────────────────────── */
.profile-mobile-tabs {
    display: none;
    overflow-x: auto;
    gap: 4px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(100, 116, 139, 0.15);
    background: rgba(15, 23, 42, 0.6);
    -webkit-overflow-scrolling: touch;
}

.profile-mobile-tab {
    flex-shrink: 0;
    padding: 8px 14px;
    border: 1px solid rgba(100, 116, 139, 0.2);
    border-radius: 20px;
    background: transparent;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
}

.profile-mobile-tab:hover { color: #e2e8f0; }
.profile-mobile-tab.active {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
    border-color: rgba(251, 191, 36, 0.4);
}

@media (max-width: 680px) {
    .profile-modal {
        flex-direction: column;
        min-height: auto;
        margin-top: 10px;
    }
    .profile-sidebar { display: none; }
    .profile-mobile-tabs { display: flex; }
    .profile-content { padding: 20px 16px; max-height: none; }
    .profile-overview-header { flex-direction: column; text-align: center; }
    .profile-header-balance { justify-content: center; }
    .profile-quick-stats { grid-template-columns: 1fr; }
    .profile-form-grid { grid-template-columns: 1fr; }
    .profile-limits-grid { grid-template-columns: 1fr; }
}
    `;
    document.head.appendChild(style);

    // ── HTML shell ───────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.id = 'profileModal';
    wrapper.className = 'profile-modal-wrapper';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-label', 'Account profile');
    wrapper.innerHTML = `
        <div class="profile-modal" style="position:relative;">
            <button class="profile-close-btn" onclick="hideProfileModal()" title="Close" aria-label="Close profile">&times;</button>

            <!-- Sidebar (desktop) -->
            <nav class="profile-sidebar" id="profileSidebar"></nav>

            <div style="flex:1; display:flex; flex-direction:column; min-width:0;">
                <!-- Mobile tab bar -->
                <div class="profile-mobile-tabs" id="profileMobileTabs"></div>

                <!-- Main body -->
                <div class="profile-content" id="profileContent">
                    <div class="profile-loading"><div class="profile-spinner"></div></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(wrapper);

    // Close on backdrop click
    wrapper.addEventListener('click', function (e) {
        if (e.target === wrapper) hideProfileModal();
    });
})();


// ═══════════════════════════════════════════════════════
// SHOW / HIDE
// ═══════════════════════════════════════════════════════

function showProfileModal() {
    if (!currentUser) {
        showToast('Please log in to view your profile.', 'error');
        return;
    }
    const modal = document.getElementById('profileModal');
    modal.classList.add('active');
    profileActiveTab = 'overview';
    renderProfileSidebar();
    renderMobileTabs();
    loadProfile();
}

function hideProfileModal() {
    var _profModal = document.getElementById('profileModal');
    if (_profModal) _profModal.classList.remove('active');
}


// ═══════════════════════════════════════════════════════
// SIDEBAR + MOBILE TABS
// ═══════════════════════════════════════════════════════

const PROFILE_TABS = [
    { id: 'overview',     icon: '\u{1F464}', label: 'Overview' },
    { id: 'referrals',    icon: '\u{1F517}', label: 'Referrals' },
    { id: 'security',     icon: '\u{1F512}', label: 'Security' },
    { id: 'verification', icon: '\u{2705}',  label: 'Verification' },
    { id: 'limits',       icon: '\u{1F6E1}\uFE0F', label: 'Responsible Play' },
    { id: 'history',      icon: '\u{1F4CB}', label: 'History' },
    { id: 'badges',       icon: '\u{1F3C5}', label: 'Badges' },
    { id: 'gifts',        icon: '\u{1F381}', label: 'Gifts' },
    { id: 'milestones',   icon: '\u{1F3C6}', label: 'Milestones' },
    { id: 'achievements', icon: '\u{1F396}\uFE0F', label: 'Achievements' },
    { id: 'referral',     icon: '\u{1F465}', label: 'Referral' },
    { id: 'cosmetics',    icon: '\u{1F3A8}', label: 'Cosmetics' },
    { id: 'comeback', icon: '🔄', label: 'Comeback' },
    { id: 'lossstreak', icon: '💪', label: 'Loss Streak' }
];

function renderProfileSidebar() {
    const sidebar = document.getElementById('profileSidebar');
    const uname = currentUser ? currentUser.username : 'Guest';
    const email = currentUser ? (currentUser.email || '') : '';
    const grad = getAvatarGradient(uname);
    const initials = getAvatarInitials(uname);

    sidebar.innerHTML = `
        <div class="profile-sidebar-avatar" style="background:${grad};">${initials}</div>
        <div class="profile-sidebar-name">${escapeHtml(uname)}</div>
        <div class="profile-sidebar-email">${escapeHtml(email)}</div>
        <ul class="profile-nav">
            ${PROFILE_TABS.map(t => `
                <li class="profile-nav-item ${t.id === profileActiveTab ? 'active' : ''}" onclick="switchProfileTab('${t.id}')">
                    <span class="profile-nav-icon">${t.icon}</span>
                    <span>${t.label}</span>
                </li>
            `).join('')}
        </ul>
        <div class="profile-sidebar-footer">
            <button onclick="profileLogout()">Sign Out</button>
        </div>
    `;
}

function renderMobileTabs() {
    const bar = document.getElementById('profileMobileTabs');
    bar.innerHTML = PROFILE_TABS.map(t => `
        <button class="profile-mobile-tab ${t.id === profileActiveTab ? 'active' : ''}" onclick="switchProfileTab('${t.id}')">
            ${t.icon} ${t.label}
        </button>
    `).join('');
}

function switchProfileTab(tab) {
    profileActiveTab = tab;
    // Reset history pagination when switching tabs
    if (tab === 'history') {
        profileHistoryPage = 1;
        profileHistoryFilter = 'all';
    }
    renderProfileSidebar();
    renderMobileTabs();
    renderProfileContent();
}


// ═══════════════════════════════════════════════════════
// LOAD PROFILE DATA
// ═══════════════════════════════════════════════════════

async function loadProfile() {
    const content = document.getElementById('profileContent');
    content.innerHTML = '<div class="profile-loading"><div class="profile-spinner"></div></div>';

    try {
        const data = await apiRequest('/api/user/profile', { requireAuth: true });
        profileData = data;
    } catch (err) {
        // Build local profile from client state when server is unreachable
        profileData = {
            username: currentUser ? currentUser.username : 'Guest',
            email: currentUser ? (currentUser.email || '') : '',
            display_name: '',
            phone: '',
            country: '',
            date_of_birth: '',
            currency: 'USD',
            member_since: null,
            kyc_status: 'unverified',
            limits: { daily_deposit: '', weekly_deposit: '', monthly_deposit: '', daily_loss: '', session_time: '' },
            transactions: []
        };
    }

    renderProfileContent();
}


// ═══════════════════════════════════════════════════════
// MASTER RENDER
// ═══════════════════════════════════════════════════════

function renderProfileContent() {
    switch (profileActiveTab) {
        case 'overview':      renderProfileOverview(); break;
        case 'referrals':     renderReferralsTab(); break;
        case 'security':      renderSecurityTab(); break;
        case 'verification':  renderVerificationTab(); break;
        case 'limits':        renderLimitsTab(); break;
        case 'history':       renderHistoryTab(); break;
        case 'badges':        renderBadgeGallery(); break;
        case 'gifts':         renderGiftsTab(); break;
        case 'milestones':    renderMilestonesTab(); break;
        case 'achievements':  renderAchievementsTab(); break;
        case 'referral':      renderReferralTab(); break;
        case 'cosmetics':     renderCosmeticsTab(); break;
        // Non-slot games removed
        // case 'tower':         renderTowerTab(); break;
        // case 'casinowar':     renderCasinoWarTab(); break;
        // case 'letitride': renderLetItRideTab(); break;
        case 'comeback': renderComebackBonusTab(); break;
        case 'lossstreak': renderLossStreakTab(); break;
        default:              renderProfileOverview();
    }
}


// ═══════════════════════════════════════════════════════
// REFERRALS TAB
// ═══════════════════════════════════════════════════════

function _makeRewardCard(amount, label) {
    var card = document.createElement('div');
    card.className = 'referral-reward-card';
    var amtEl = document.createElement('div');
    amtEl.className = 'referral-reward-amount';
    amtEl.textContent = '$' + formatMoney(amount);
    card.appendChild(amtEl);
    var lblEl = document.createElement('div');
    lblEl.className = 'referral-reward-label';
    lblEl.textContent = label;
    card.appendChild(lblEl);
    return card;
}

function _makeStatCard(value, label) {
    var card = document.createElement('div');
    card.className = 'referral-stat-card';
    var valEl = document.createElement('div');
    valEl.className = 'referral-stat-value';
    valEl.textContent = value;
    card.appendChild(valEl);
    var lblEl = document.createElement('div');
    lblEl.className = 'referral-stat-label';
    lblEl.textContent = label;
    card.appendChild(lblEl);
    return card;
}

async function renderReferralsTab() {
    var el = document.getElementById('profileContent');
    el.textContent = '';
    var spinner = document.createElement('div');
    spinner.className = 'profile-loading';
    var sp = document.createElement('div');
    sp.className = 'profile-spinner';
    spinner.appendChild(sp);
    el.appendChild(spinner);

    // Fetch info and stats in parallel from the correct endpoints
    var infoData = null;
    var statsData = null;
    try {
        var results = await Promise.allSettled([
            apiRequest('/api/referral/info', { requireAuth: true }),
            apiRequest('/api/referral/stats', { requireAuth: true })
        ]);
        if (results[0].status === 'fulfilled') infoData = results[0].value;
        if (results[1].status === 'fulfilled') statsData = results[1].value;
    } catch (e) { /* offline — continue with defaults */ }

    var code = (infoData && infoData.code) ? infoData.code : '------';
    var referralUrl = (infoData && infoData.referralUrl)
        ? infoData.referralUrl
        : (window.location.origin + '?ref=' + code);
    var totalReferrals  = (infoData && infoData.totalReferrals  != null) ? infoData.totalReferrals  : 0;
    var pendingReferrals = (infoData && infoData.pendingReferrals != null) ? infoData.pendingReferrals : 0;
    var totalEarned     = (infoData && infoData.totalEarned     != null) ? infoData.totalEarned     : 0;
    var referrals       = (statsData && Array.isArray(statsData.referrals)) ? statsData.referrals : [];

    // Detect whether this user has already applied a referral code (any completed entry)
    var hasBeenReferred = referrals.some(function(r) { return r.status === 'completed'; });

    el.textContent = '';

    // ── Section title ────────────────────────────────────
    var header = document.createElement('h2');
    header.className = 'profile-section-title';
    header.textContent = 'Referral Program';
    el.appendChild(header);

    // ── My Referral Code card (dark green gradient) ──────
    var codeCard = document.createElement('div');
    codeCard.className = 'referral-my-code-card';

    var codeCardTitle = document.createElement('div');
    codeCardTitle.className = 'profile-card-title';
    codeCardTitle.textContent = 'MY REFERRAL CODE';
    codeCard.appendChild(codeCardTitle);

    // Big code display
    var codeRow = document.createElement('div');
    codeRow.style.cssText = 'display:flex; gap:10px; align-items:center; margin-bottom:14px;';

    var codeDisplay = document.createElement('div');
    codeDisplay.className = 'referral-code-display';
    codeDisplay.textContent = code;
    codeRow.appendChild(codeDisplay);

    var copyCodeBtn = document.createElement('button');
    copyCodeBtn.className = 'referral-copy-btn';
    copyCodeBtn.textContent = 'COPY CODE';
    copyCodeBtn.onclick = function() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(function() {
                copyCodeBtn.textContent = 'COPIED!';
                setTimeout(function() { copyCodeBtn.textContent = 'COPY CODE'; }, 2000);
            }).catch(function() {
                _referralFallbackCopy(code, copyCodeBtn, 'COPY CODE');
            });
        } else {
            _referralFallbackCopy(code, copyCodeBtn, 'COPY CODE');
        }
    };
    codeRow.appendChild(copyCodeBtn);
    codeCard.appendChild(codeRow);

    // Copy link row
    var linkRow = document.createElement('div');
    linkRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:16px;';

    var linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.readOnly = true;
    linkInput.value = referralUrl;
    linkInput.className = 'referral-link-input';
    linkRow.appendChild(linkInput);

    var copyLinkBtn = document.createElement('button');
    copyLinkBtn.className = 'referral-copy-btn';
    copyLinkBtn.textContent = 'COPY LINK';
    copyLinkBtn.onclick = function() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(referralUrl).then(function() {
                copyLinkBtn.textContent = 'COPIED!';
                setTimeout(function() { copyLinkBtn.textContent = 'COPY LINK'; }, 2000);
            }).catch(function() {
                _referralFallbackCopy(referralUrl, copyLinkBtn, 'COPY LINK');
            });
        } else {
            _referralFallbackCopy(referralUrl, copyLinkBtn, 'COPY LINK');
        }
    };
    linkRow.appendChild(copyLinkBtn);
    codeCard.appendChild(linkRow);

    // Stats summary row
    var statsRow = document.createElement('div');
    statsRow.className = 'referral-stats-row';

    var s1 = document.createElement('span');
    s1.className = 'referral-stats-item';
    var s1Label = document.createElement('span');
    s1Label.className = 'referral-stats-label';
    s1Label.textContent = 'Total Referrals';
    var s1Val = document.createElement('span');
    s1Val.className = 'referral-stats-value';
    s1Val.textContent = String(totalReferrals);
    s1.appendChild(s1Label);
    s1.appendChild(s1Val);
    statsRow.appendChild(s1);

    var s2 = document.createElement('span');
    s2.className = 'referral-stats-item';
    var s2Label = document.createElement('span');
    s2Label.className = 'referral-stats-label';
    s2Label.textContent = 'Pending';
    var s2Val = document.createElement('span');
    s2Val.className = 'referral-stats-value';
    s2Val.textContent = String(pendingReferrals);
    s2.appendChild(s2Label);
    s2.appendChild(s2Val);
    statsRow.appendChild(s2);

    var s3 = document.createElement('span');
    s3.className = 'referral-stats-item';
    var s3Label = document.createElement('span');
    s3Label.className = 'referral-stats-label';
    s3Label.textContent = 'Total Earned';
    var s3Val = document.createElement('span');
    s3Val.className = 'referral-stats-value referral-stats-value--green';
    s3Val.textContent = '$' + (typeof formatMoney === 'function' ? formatMoney(totalEarned) : Number(totalEarned).toFixed(2));
    s3.appendChild(s3Label);
    s3.appendChild(s3Val);
    statsRow.appendChild(s3);

    codeCard.appendChild(statsRow);
    el.appendChild(codeCard);

    // ── Recent referrals table ───────────────────────────
    if (referrals.length > 0) {
        var tableCard = document.createElement('div');
        tableCard.className = 'referral-table-card';

        var tableTitle = document.createElement('div');
        tableTitle.className = 'profile-card-title';
        tableTitle.textContent = 'RECENT REFERRALS';
        tableCard.appendChild(tableTitle);

        var tableWrap = document.createElement('div');
        tableWrap.style.cssText = 'overflow-x:auto;';

        var table = document.createElement('table');
        table.className = 'referral-table';

        var thead = document.createElement('thead');
        var hrow = document.createElement('tr');
        ['Username', 'Status', 'Bonus Paid', 'Date'].forEach(function(h) {
            var th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        referrals.forEach(function(r) {
            var tr = document.createElement('tr');

            // Masked username: show first 2 chars + ***
            var rawName = r.referee_username || 'Unknown';
            var masked = rawName.length > 2
                ? rawName.substring(0, 2) + '***'
                : rawName.charAt(0) + '***';

            var tdName = document.createElement('td');
            tdName.textContent = masked;
            tr.appendChild(tdName);

            var tdStatus = document.createElement('td');
            var badge = document.createElement('span');
            badge.className = 'referral-status-badge referral-status-badge--' + (r.status || 'pending');
            badge.textContent = (r.status || 'pending').charAt(0).toUpperCase() + (r.status || 'pending').slice(1);
            tdStatus.appendChild(badge);
            tr.appendChild(tdStatus);

            var tdBonus = document.createElement('td');
            var bonusPaid = r.bonus_paid != null ? r.bonus_paid : 0;
            tdBonus.textContent = bonusPaid > 0 ? ('$' + (typeof formatMoney === 'function' ? formatMoney(bonusPaid) : Number(bonusPaid).toFixed(2))) : '-';
            if (bonusPaid > 0) tdBonus.style.cssText = 'color:#22c55e; font-weight:700;';
            tr.appendChild(tdBonus);

            var tdDate = document.createElement('td');
            if (r.created_at) {
                try {
                    tdDate.textContent = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                } catch(e) {
                    tdDate.textContent = r.created_at;
                }
            } else {
                tdDate.textContent = '-';
            }
            tr.appendChild(tdDate);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        tableCard.appendChild(tableWrap);
        el.appendChild(tableCard);
    }

    // ── Apply a Referral Code card (only if not yet referred) ──
    if (!hasBeenReferred) {
        var applyCard = document.createElement('div');
        applyCard.className = 'referral-apply-card';

        var applyTitle = document.createElement('div');
        applyTitle.className = 'profile-card-title';
        applyTitle.textContent = 'APPLY A REFERRAL CODE';
        applyCard.appendChild(applyTitle);

        var applyDesc = document.createElement('p');
        applyDesc.style.cssText = 'color:#94a3b8; font-size:12px; margin-bottom:12px; line-height:1.5;';
        applyDesc.textContent = 'If a friend referred you, enter their code to claim your sign-up bonus.';
        applyCard.appendChild(applyDesc);

        var applyRow = document.createElement('div');
        applyRow.style.cssText = 'display:flex; gap:8px; align-items:center;';

        var applyInput = document.createElement('input');
        applyInput.type = 'text';
        applyInput.maxLength = 10;
        applyInput.placeholder = 'Enter referral code';
        applyInput.className = 'referral-apply-input';
        applyRow.appendChild(applyInput);

        var applyBtn = document.createElement('button');
        applyBtn.className = 'referral-copy-btn';
        applyBtn.textContent = 'APPLY';
        applyBtn.onclick = function() {
            var enteredCode = applyInput.value.trim().toUpperCase();
            if (!enteredCode) {
                _referralShowMsg(applyMsg, 'Please enter a referral code.', 'error');
                return;
            }
            applyBtn.disabled = true;
            applyBtn.textContent = '...';

            var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
            if (!token) {
                _referralShowMsg(applyMsg, 'You must be logged in to apply a referral code.', 'error');
                applyBtn.disabled = false;
                applyBtn.textContent = 'APPLY';
                return;
            }

            fetch('/api/referral/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ code: enteredCode })
            }).then(function(res) {
                return res.json().then(function(body) { return { ok: res.ok, body: body }; });
            }).then(function(result) {
                if (result.ok && result.body && result.body.success) {
                    _referralShowMsg(applyMsg, result.body.message || 'Referral code applied! Bonus credited.', 'success');
                    applyInput.value = '';
                    applyInput.disabled = true;
                    applyBtn.disabled = true;
                    applyBtn.textContent = 'APPLIED';
                } else {
                    var errMsg = (result.body && result.body.message) ? result.body.message : 'Failed to apply referral code.';
                    _referralShowMsg(applyMsg, errMsg, 'error');
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'APPLY';
                }
            }).catch(function() {
                _referralShowMsg(applyMsg, 'Network error. Please try again.', 'error');
                applyBtn.disabled = false;
                applyBtn.textContent = 'APPLY';
            });
        };
        applyRow.appendChild(applyBtn);
        applyCard.appendChild(applyRow);

        var applyMsg = document.createElement('div');
        applyMsg.className = 'referral-apply-msg';
        applyCard.appendChild(applyMsg);

        el.appendChild(applyCard);
    }
}

// Helper: clipboard fallback using textarea
function _referralFallbackCopy(text, btn, originalLabel) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = 'COPIED!';
        setTimeout(function() { btn.textContent = originalLabel; }, 2000);
    } catch(e) {
        btn.textContent = originalLabel;
    }
}

// Helper: show apply message
function _referralShowMsg(el, text, type) {
    el.textContent = text;
    el.className = 'referral-apply-msg referral-apply-msg--' + type;
    el.style.display = 'block';
}

// ═══════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════

// ── Birthday Section ─────────────────────────────────────
function _renderBirthdaySection(container) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    if (!document.getElementById('profile-birthday-css')) {
        var s = document.createElement('style');
        s.id = 'profile-birthday-css';
        s.textContent = '.profile-birthday-section { background: #1a1a2e; border: 1px solid #4a3060; border-radius: 10px; padding: 14px; margin-top: 16px; } .profile-birthday-section h4 { color: #e040fb; margin: 0 0 8px 0; font-size: 14px; } .profile-birthday-section p { color: #aaa; font-size: 12px; margin: 4px 0; } .birthday-bonus-preview { color: #ce93d8 !important; } .birthday-form { display: flex; gap: 8px; align-items: center; margin: 10px 0; flex-wrap: wrap; } .birthday-form select { background: #2a1a3a; border: 1px solid #6a3090; color: #eee; padding: 6px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; } .birthday-save-btn { background: linear-gradient(135deg, #7b1fa2, #9c27b0); color: #fff; border: none; padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; } .birthday-msg { min-height: 16px; color: #ce93d8 !important; }';
        document.head.appendChild(s);
    }

    fetch('/api/birthday/status', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var section = document.createElement('div');
        section.className = 'profile-birthday-section';

        var title = document.createElement('h4');
        title.textContent = '\uD83C\uDF82 Birthday Bonus';
        section.appendChild(title);

        if (!data.hasBirthday) {
            var desc = document.createElement('p');
            desc.textContent = 'Set your birthday to receive annual bonus rewards!';
            section.appendChild(desc);

            var bonusInfo = document.createElement('p');
            bonusInfo.className = 'birthday-bonus-preview';
            bonusInfo.textContent = 'Birthday reward: $10 credits + 500 gems + 10 free spins';
            section.appendChild(bonusInfo);

            var form = document.createElement('div');
            form.className = 'birthday-form';

            var monthSel = document.createElement('select');
            monthSel.className = 'birthday-month-select';
            var monthOpt0 = document.createElement('option');
            monthOpt0.value = '';
            monthOpt0.textContent = 'Month';
            monthSel.appendChild(monthOpt0);
            var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            MONTHS.forEach(function(m, i) {
                var opt = document.createElement('option');
                opt.value = String(i + 1);
                opt.textContent = m;
                monthSel.appendChild(opt);
            });

            var daySel = document.createElement('select');
            daySel.className = 'birthday-day-select';
            var dayOpt0 = document.createElement('option');
            dayOpt0.value = '';
            dayOpt0.textContent = 'Day';
            daySel.appendChild(dayOpt0);
            for (var d = 1; d <= 31; d++) {
                var dopt = document.createElement('option');
                dopt.value = String(d);
                dopt.textContent = String(d);
                daySel.appendChild(dopt);
            }

            var saveBtn = document.createElement('button');
            saveBtn.className = 'birthday-save-btn';
            saveBtn.textContent = 'Save Birthday';

            var msgEl = document.createElement('p');
            msgEl.className = 'birthday-msg';

            saveBtn.addEventListener('click', function() {
                var m = parseInt(monthSel.value, 10);
                var dv = parseInt(daySel.value, 10);
                if (!m || !dv) { msgEl.textContent = 'Please select month and day.'; return; }
                var tok = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                fetch('/api/birthday/set', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month: m, day: dv })
                })
                .then(function(r) { return r.json(); })
                .then(function(result) {
                    if (result.success) {
                        msgEl.textContent = '\uD83C\uDF82 Birthday saved! You\'ll receive your bonus each year on your birthday.';
                        form.style.display = 'none';
                    } else {
                        msgEl.textContent = result.error || 'Failed to save birthday.';
                    }
                })
                .catch(function() { msgEl.textContent = 'Connection error. Try again.'; });
            });

            form.appendChild(monthSel);
            form.appendChild(daySel);
            form.appendChild(saveBtn);
            section.appendChild(form);
            section.appendChild(msgEl);
        } else if (data.isBirthday) {
            var happyMsg = document.createElement('p');
            happyMsg.textContent = data.alreadyClaimed ? '\uD83C\uDF89 Happy Birthday! Bonus already claimed today.' : '\uD83C\uDF89 Happy Birthday! Your bonus is waiting!';
            section.appendChild(happyMsg);
        } else {
            var setBdMsg = document.createElement('p');
            setBdMsg.textContent = '\u2705 Birthday set! Your annual bonus is ready for your special day.';
            section.appendChild(setBdMsg);
        }

        container.appendChild(section);
    })
    .catch(function(e) { console.warn('[Birthday]', e); });
}

function renderProfileOverview() {
    const el = document.getElementById('profileContent');
    const d = profileData || {};
    const uname = d.username || (currentUser ? currentUser.username : 'Guest');
    const email = d.email || (currentUser ? (currentUser.email || '') : '');
    const memberSince = d.member_since ? new Date(d.member_since).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Recently joined';
    const kycStatus = d.kyc_status || 'unverified';
    const kycLabels = { unverified: 'Unverified', pending: 'Pending Review', verified: 'Verified' };
    const kycIcons  = { unverified: '\u26A0\uFE0F', pending: '\u23F3', verified: '\u2705' };

    const totalWagered = stats ? stats.totalWagered : 0;
    const totalWon     = stats ? stats.totalWon : 0;
    const biggestWin   = stats ? stats.biggestWin : 0;

    // --- Extra stats ---
    const winRate    = stats && stats.totalSpins > 0 ? Math.round((stats.totalWins || 0) / stats.totalSpins * 100) : 0;
    const totalSpins = stats && stats.totalSpins || 0;

    // --- Net P&L ---
    const pnl        = totalWon - totalWagered;
    const pnlClass   = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'neutral';
    const pnlSign    = pnl >= 0 ? '+' : '';
    const pnlArrow   = pnl > 0 ? '▲' : pnl < 0 ? '▼' : '';
    const returnRate = totalWagered > 0 ? Math.round((totalWon / totalWagered) * 100) : 0;
    const rrClass    = returnRate >= 100 ? 'pos' : returnRate > 0 ? 'neutral' : 'neg';

    // --- XP progress ---
    let xpData = { level: 1, xp: 0, totalXp: 0 };
    try { const raw = localStorage.getItem('matrixXP'); if (raw) xpData = JSON.parse(raw); } catch(e) {}
    const xpForLevel  = (xpData.level || 1) * 1000;
    const xpInLevel   = (xpData.xp || 0) % xpForLevel;
    const xpPct       = Math.round((xpInLevel / xpForLevel) * 100);
    const toNextLevel = xpForLevel - xpInLevel;

    // --- CSS injection (once) ---
    if (!document.getElementById('profileEnhCss')) {
        const s = document.createElement('style');
        s.id = 'profileEnhCss';
        s.textContent = `
.profile-quick-stats { flex-wrap: wrap; }
.profile-stat-box { min-width: 80px; }
.profile-pnl-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 12px; margin: 8px 0;
  background: rgba(255,255,255,0.03); border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.07); font-size: 12px;
}
.profile-pnl-label { color: rgba(255,255,255,0.5); }
.profile-pnl-pos { color: #66bb6a; font-weight: 700; }
.profile-pnl-neg { color: #ef5350; font-weight: 700; }
.profile-pnl-neutral { color: rgba(255,255,255,0.5); }
.profile-pnl-divider { color: rgba(255,255,255,0.2); }
.profile-xp-section {
  padding: 10px 12px; margin: 8px 0;
  background: rgba(255,255,255,0.03); border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.07);
}
.profile-xp-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:12px; }
.profile-xp-level-badge { font-weight:700; color:#ffd54f; }
.profile-xp-next-label { color:rgba(255,255,255,0.4); font-size:11px; }
.profile-xp-bar-track { height:7px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; margin-bottom:5px; }
.profile-xp-bar-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#7b61ff,#00bcd4); transition:width 0.7s ease; width:0%; }
.profile-xp-counts { display:flex; justify-content:space-between; font-size:10px; color:rgba(255,255,255,0.4); }
        `;
        document.head.appendChild(s);
    }

    el.innerHTML = `
        <div class="profile-section-title">Account Overview</div>

        <div class="profile-overview-header">
            <div class="profile-avatar-large" style="background:${getAvatarGradient(uname)};">
                ${getAvatarInitials(uname)}
            </div>
            <div class="profile-header-info">
                <div class="profile-header-username">${escapeHtml(uname)}</div>
                <div class="profile-header-meta">${escapeHtml(email)} &middot; Member since ${memberSince}</div>
                <div class="profile-header-balance">
                    <span class="profile-balance-amount">$${formatMoney(balance)}</span>
                    <button class="profile-deposit-btn" onclick="hideProfileModal(); addFunds();">Deposit</button>
                </div>
                <span class="profile-kyc-badge ${kycStatus}">${kycIcons[kycStatus]} ${kycLabels[kycStatus]}</span>
            </div>
        </div>

        <div class="profile-quick-stats">
            <div class="profile-stat-box">
                <div class="profile-stat-value">$${formatMoney(totalWagered)}</div>
                <div class="profile-stat-label">Total Wagered</div>
            </div>
            <div class="profile-stat-box">
                <div class="profile-stat-value">$${formatMoney(totalWon)}</div>
                <div class="profile-stat-label">Total Won</div>
            </div>
            <div class="profile-stat-box">
                <div class="profile-stat-value">$${formatMoney(biggestWin)}</div>
                <div class="profile-stat-label">Biggest Win</div>
            </div>
            <div class="profile-stat-box">
                <div class="profile-stat-value">${winRate}%</div>
                <div class="profile-stat-label">Win Rate</div>
            </div>
            <div class="profile-stat-box">
                <div class="profile-stat-value">${totalSpins.toLocaleString()}</div>
                <div class="profile-stat-label">Total Spins</div>
            </div>
        </div>

        <div class="profile-pnl-row">
            <span class="profile-pnl-label">Net P&amp;L:</span>
            <span class="profile-pnl-${pnlClass}">${pnlSign}$${formatMoney(Math.abs(pnl))} ${pnlArrow}</span>
            <span class="profile-pnl-divider">|</span>
            <span class="profile-pnl-label">Return Rate:</span>
            <span class="profile-pnl-${rrClass}">${returnRate}%</span>
        </div>

        <div class="profile-xp-section">
            <div class="profile-xp-header">
                <span class="profile-xp-level-badge">⭐ Level ${xpData.level}</span>
                <span class="profile-xp-next-label">${toNextLevel.toLocaleString()} XP to next level</span>
            </div>
            <div class="profile-xp-bar-track">
                <div class="profile-xp-bar-fill" style="width:0%"></div>
            </div>
            <div class="profile-xp-counts">
                <span>${xpInLevel.toLocaleString()} XP</span>
                <span>${xpForLevel.toLocaleString()} XP</span>
            </div>
        </div>

        <div class="profile-card">
            <div class="profile-card-title">Edit Profile</div>
            <div class="profile-form-grid">
                <div class="profile-field">
                    <label for="profileDisplayName">Display Name</label>
                    <input type="text" id="profileDisplayName" placeholder="Your display name" value="${escapeAttr(d.display_name || '')}" maxlength="40">
                </div>
                <div class="profile-field">
                    <label for="profilePhone">Phone</label>
                    <input type="tel" id="profilePhone" placeholder="+1 (555) 000-0000" value="${escapeAttr(d.phone || '')}" maxlength="20">
                </div>
                <div class="profile-field">
                    <label for="profileCountry">Country</label>
                    <select id="profileCountry">
                        <option value="">Select country</option>
                        ${buildCountryOptions(d.country)}
                    </select>
                </div>
                <div class="profile-field">
                    <label for="profileDOB">Date of Birth</label>
                    <input type="date" id="profileDOB" value="${escapeAttr(d.date_of_birth || '')}">
                </div>
                <div class="profile-field">
                    <label for="profileCurrency">Preferred Currency</label>
                    <select id="profileCurrency">
                        ${['USD','EUR','GBP','CAD','AUD','JPY'].map(c => `<option value="${c}" ${d.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div style="margin-top:16px; display:flex; gap:10px;">
                <button class="profile-btn profile-btn-primary" onclick="saveProfile()">Save Changes</button>
            </div>
        </div>

        <div class="profile-rg-banner">
            <strong>18+</strong>
            <span>Gambling can be addictive. Play responsibly. If you need help, visit the
            <span style="color:#fbbf24; cursor:pointer; text-decoration:underline;" onclick="switchProfileTab('limits')">Responsible Play</span> section.</span>
        </div>
    `;

    // Animate XP bar after layout settles
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const fill = el.querySelector('.profile-xp-bar-fill');
        if (fill) fill.style.width = xpPct + '%';
    }));

    // Birthday section (async, appends after the rest of the overview)
    _renderBirthdaySection(el);
}


// ═══════════════════════════════════════════════════════
// SECURITY TAB
// ═══════════════════════════════════════════════════════

function renderSecurityTab() {
    const el = document.getElementById('profileContent');
    el.innerHTML = `
        <div class="profile-section-title">Security</div>

        <div class="profile-card">
            <div class="profile-card-title">Change Password</div>
            <div class="profile-pw-form">
                <div class="profile-field">
                    <label for="profileCurrentPw">Current Password</label>
                    <input type="password" id="profileCurrentPw" placeholder="Enter current password" autocomplete="current-password">
                </div>
                <div class="profile-field">
                    <label for="profileNewPw">New Password</label>
                    <input type="password" id="profileNewPw" placeholder="Min 6 characters" autocomplete="new-password">
                </div>
                <div class="profile-field">
                    <label for="profileConfirmPw">Confirm New Password</label>
                    <input type="password" id="profileConfirmPw" placeholder="Repeat new password" autocomplete="new-password">
                </div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <button class="profile-btn profile-btn-primary" onclick="changePassword()">Update Password</button>
                    <button class="profile-btn profile-btn-outline" onclick="requestPasswordReset()">Forgot Password?</button>
                </div>
            </div>
        </div>

        <div class="profile-card">
            <div class="profile-card-title">Active Session</div>
            <div class="profile-session-info">
                <span class="profile-session-dot"></span>
                <span>Current session is active &mdash; logged in as <strong style="color:#e2e8f0;">${escapeHtml(currentUser ? currentUser.username : 'Guest')}</strong></span>
            </div>
            <p style="font-size:11px; color:#64748b; margin-top:10px;">
                Your session token (JWT) is stored locally. Logging out will clear this token and end your session on this device.
            </p>
        </div>

        <div class="profile-card" style="border-color: rgba(220, 38, 38, 0.3);">
            <div class="profile-card-title" style="color:#fca5a5;">Danger Zone</div>
            <p style="font-size:12px; color:#94a3b8; margin-bottom:14px;">
                Closing your account is permanent and cannot be undone. All your data, balance, and history will be lost.
            </p>
            <button class="profile-btn profile-btn-danger" onclick="confirmCloseAccount()">Close My Account</button>
        </div>
    `;
}


// ═══════════════════════════════════════════════════════
// VERIFICATION TAB
// ═══════════════════════════════════════════════════════

function renderVerificationTab() {
    const el = document.getElementById('profileContent');
    const kycStatus = (profileData && profileData.kyc_status) || 'unverified';
    const statusConfig = {
        unverified: { icon: '\u26A0\uFE0F', title: 'Not Verified', desc: 'Complete verification to unlock full features.' },
        pending:    { icon: '\u23F3',       title: 'Pending Review', desc: 'Your verification request is being reviewed. This usually takes 1-3 business days.' },
        verified:   { icon: '\u2705',       title: 'Verified',       desc: 'Your identity has been verified. You have access to all features.' }
    };
    const cfg = statusConfig[kycStatus] || statusConfig.unverified;

    el.innerHTML = `
        <div class="profile-section-title">Identity Verification (KYC)</div>

        <div class="profile-verify-status ${kycStatus}">
            <div class="profile-verify-icon">${cfg.icon}</div>
            <div class="profile-verify-text">
                <h3>${cfg.title}</h3>
                <p>${cfg.desc}</p>
            </div>
        </div>

        <div class="profile-card">
            <div class="profile-card-title">Benefits of Verification</div>
            <ul class="profile-benefits-list">
                <li><span class="profile-benefit-check">\u2713</span> Higher deposit and withdrawal limits</li>
                <li><span class="profile-benefit-check">\u2713</span> Faster withdrawal processing</li>
                <li><span class="profile-benefit-check">\u2713</span> Access to VIP promotions and tournaments</li>
                <li><span class="profile-benefit-check">\u2713</span> Enhanced account security</li>
                <li><span class="profile-benefit-check">\u2713</span> Priority customer support</li>
            </ul>
        </div>

        ${kycStatus !== 'verified' ? `
        <div class="profile-card">
            <div class="profile-card-title">Submit Verification Request</div>
            <p style="font-size:12px; color:#94a3b8; margin-bottom:14px;">
                Select the type of identification document you would like to use for verification.
            </p>
            <div class="profile-field" style="max-width:300px; margin-bottom:16px;">
                <label for="profileDocType">Document Type</label>
                <select id="profileDocType">
                    <option value="drivers_license">Driver's License</option>
                    <option value="passport">Passport</option>
                    <option value="national_id">National ID Card</option>
                </select>
            </div>
            <button class="profile-btn profile-btn-primary" onclick="submitVerification()" ${kycStatus === 'pending' ? 'disabled' : ''}>
                ${kycStatus === 'pending' ? 'Request Pending' : 'Submit Verification Request'}
            </button>
            <p style="font-size:11px; color:#64748b; margin-top:12px; font-style:italic;">
                Submit your verification request and our team will review it within 24 hours. You will receive an email confirmation with next steps.
            </p>
        </div>
        ` : ''}

        <div class="profile-rg-banner">
            <strong>Privacy</strong>
            <span>Your personal data is encrypted and stored securely. We comply with applicable data protection regulations.</span>
        </div>
    `;
}


// ═══════════════════════════════════════════════════════
// RESPONSIBLE GAMBLING / LIMITS TAB
// ═══════════════════════════════════════════════════════

function renderLimitsTab() {
    const el = document.getElementById('profileContent');
    const lim = (profileData && profileData.limits) || {};

    el.innerHTML = `
        <div class="profile-section-title">Responsible Gambling</div>

        <div class="profile-rg-notice" style="margin-bottom:20px;">
            <span style="font-size:18px;">\u{2139}\uFE0F</span>
            <span>
                Gambling should be fun, not a source of stress. Set limits that work for you.
                If you feel you are losing control, please take a break or seek help.
                <strong>You are always in control.</strong>
            </span>
        </div>

        <div class="profile-card">
            <div class="profile-card-title">Deposit Limits</div>
            <div class="profile-limits-grid">
                <div class="profile-limit-field">
                    <label for="profileLimitDailyDeposit">Daily Limit ($)</label>
                    <input type="number" id="profileLimitDailyDeposit" placeholder="No limit" min="0" step="1" value="${escapeAttr(lim.daily_deposit || '')}">
                </div>
                <div class="profile-limit-field">
                    <label for="profileLimitWeeklyDeposit">Weekly Limit ($)</label>
                    <input type="number" id="profileLimitWeeklyDeposit" placeholder="No limit" min="0" step="1" value="${escapeAttr(lim.weekly_deposit || '')}">
                </div>
                <div class="profile-limit-field">
                    <label for="profileLimitMonthlyDeposit">Monthly Limit ($)</label>
                    <input type="number" id="profileLimitMonthlyDeposit" placeholder="No limit" min="0" step="1" value="${escapeAttr(lim.monthly_deposit || '')}">
                </div>
                <div class="profile-limit-field">
                    <label for="profileLimitDailyLoss">Daily Loss Limit ($)</label>
                    <input type="number" id="profileLimitDailyLoss" placeholder="No limit" min="0" step="1" value="${escapeAttr(lim.daily_loss || '')}">
                </div>
            </div>
        </div>

        <div class="profile-card">
            <div class="profile-card-title">Session Time Limit</div>
            <div class="profile-limit-field" style="max-width:280px;">
                <label for="profileSessionTime">Remind me after</label>
                <select id="profileSessionTime">
                    <option value="" ${!lim.session_time ? 'selected' : ''}>No limit</option>
                    <option value="30" ${lim.session_time === '30' || lim.session_time === 30 ? 'selected' : ''}>30 minutes</option>
                    <option value="60" ${lim.session_time === '60' || lim.session_time === 60 ? 'selected' : ''}>1 hour</option>
                    <option value="120" ${lim.session_time === '120' || lim.session_time === 120 ? 'selected' : ''}>2 hours</option>
                    <option value="240" ${lim.session_time === '240' || lim.session_time === 240 ? 'selected' : ''}>4 hours</option>
                    <option value="480" ${lim.session_time === '480' || lim.session_time === 480 ? 'selected' : ''}>8 hours</option>
                </select>
            </div>
        </div>

        <div style="margin-bottom:20px;">
            <button class="profile-btn profile-btn-primary" onclick="saveLimits()">Save Limits</button>
        </div>

        <div class="profile-card" style="border-color: rgba(239, 68, 68, 0.3);">
            <div class="profile-card-title" style="color:#fca5a5;">Self-Exclusion</div>
            <p style="font-size:12px; color:#94a3b8; margin-bottom:14px;">
                If you need a break from gambling, you can temporarily exclude yourself. During exclusion, you will not be able to log in or place bets.
                <strong>This action takes effect immediately and cannot be reversed until the period expires.</strong>
            </p>
            <div class="profile-self-exclude-row">
                <button class="profile-self-exclude-btn" onclick="selfExclude(24)">24 Hours</button>
                <button class="profile-self-exclude-btn" onclick="selfExclude(48)">48 Hours</button>
                <button class="profile-self-exclude-btn" onclick="selfExclude(72)">72 Hours</button>
                <button class="profile-self-exclude-btn" onclick="selfExclude(168)">1 Week</button>
                <button class="profile-self-exclude-btn" onclick="selfExclude(720)">30 Days</button>
            </div>
        </div>

        <div class="profile-rg-notice">
            <span style="font-size:18px;">\u{1F4DE}</span>
            <span>
                Need help? Contact these resources:<br>
                <a href="https://www.ncpgambling.org/" target="_blank" rel="noopener">National Council on Problem Gambling</a> &mdash; 1-800-522-4700<br>
                <a href="https://www.begambleaware.org/" target="_blank" rel="noopener">BeGambleAware</a> &mdash; 0808-8020-133<br>
                <a href="https://www.gamblingtherapy.org/" target="_blank" rel="noopener">Gambling Therapy</a> &mdash; Free online support
            </span>
        </div>
    `;
}


// ═══════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════

function renderHistoryTab() {
    const el = document.getElementById('profileContent');
    const allTx = (profileData && profileData.transactions) || [];
    const filters = ['all', 'deposit', 'withdrawal', 'spin', 'bonus'];

    const filtered = profileHistoryFilter === 'all'
        ? allTx
        : allTx.filter(tx => tx.type === profileHistoryFilter);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PROFILE_HISTORY_PAGE_SIZE));
    if (profileHistoryPage > totalPages) profileHistoryPage = totalPages;
    const start = (profileHistoryPage - 1) * PROFILE_HISTORY_PAGE_SIZE;
    const page = filtered.slice(start, start + PROFILE_HISTORY_PAGE_SIZE);

    el.innerHTML = `
        <div class="profile-section-title">Transaction History</div>

        <div class="profile-history-filters">
            ${filters.map(f => `
                <button class="profile-filter-btn ${f === profileHistoryFilter ? 'active' : ''}" onclick="setHistoryFilter('${f}')">
                    ${f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
            `).join('')}
        </div>

        ${page.length === 0 ? `
            <div class="profile-empty">
                <div class="profile-empty-icon">\u{1F4C4}</div>
                <div>No transactions found${profileHistoryFilter !== 'all' ? ' for this filter' : ''}.</div>
            </div>
        ` : `
            <div style="overflow-x:auto;">
                <table class="profile-history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Balance After</th>
                            <th>Reference</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${page.map(tx => {
                            const date = tx.date ? new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                            const amt = Number(tx.amount) || 0;
                            const amtColor = amt >= 0 ? '#34d399' : '#fca5a5';
                            const amtStr = (amt >= 0 ? '+' : '') + '$' + formatMoney(Math.abs(amt));
                            const balAfter = tx.balance_after != null ? '$' + formatMoney(tx.balance_after) : '-';
                            const ref = tx.reference || '-';
                            return `
                                <tr>
                                    <td>${date}</td>
                                    <td><span class="profile-history-type ${tx.type || ''}">${escapeHtml(tx.type || 'other')}</span></td>
                                    <td style="color:${amtColor}; font-weight:700;">${amtStr}</td>
                                    <td>${balAfter}</td>
                                    <td style="font-size:11px; color:#64748b;">${escapeHtml(ref)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="profile-pagination">
                <button class="profile-page-btn" onclick="profileHistoryPrev()" ${profileHistoryPage <= 1 ? 'disabled' : ''}>Prev</button>
                <span class="profile-page-info">Page ${profileHistoryPage} of ${totalPages}</span>
                <button class="profile-page-btn" onclick="profileHistoryNext()" ${profileHistoryPage >= totalPages ? 'disabled' : ''}>Next</button>
            </div>
        `}
    `;
}


// ═══════════════════════════════════════════════════════
// API ACTIONS
// ═══════════════════════════════════════════════════════

async function saveProfile() {
    const displayName = document.getElementById('profileDisplayName')?.value?.trim() || '';
    const phone       = document.getElementById('profilePhone')?.value?.trim() || '';
    const country     = document.getElementById('profileCountry')?.value || '';
    const dob         = document.getElementById('profileDOB')?.value || '';
    const currency    = document.getElementById('profileCurrency')?.value || 'USD';

    try {
        await apiRequest('/api/user/profile', {
            method: 'PUT',
            requireAuth: true,
            body: { display_name: displayName, phone, country, date_of_birth: dob, currency }
        });

        // Update local state
        if (profileData) {
            profileData.display_name = displayName;
            profileData.phone = phone;
            profileData.country = country;
            profileData.date_of_birth = dob;
            profileData.currency = currency;
        }

        showToast('Profile updated successfully.', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to save profile.', 'error');
    }
}

async function changePassword() {
    const currentPw = document.getElementById('profileCurrentPw')?.value || '';
    const newPw     = document.getElementById('profileNewPw')?.value || '';
    const confirmPw = document.getElementById('profileConfirmPw')?.value || '';

    if (!currentPw || !newPw) {
        showToast('Please fill in all password fields.', 'error');
        return;
    }
    if (newPw.length < 6) {
        showToast('New password must be at least 6 characters.', 'error');
        return;
    }
    if (newPw !== confirmPw) {
        showToast('New passwords do not match.', 'error');
        return;
    }

    try {
        await apiRequest('/api/user/change-password', {
            method: 'PUT',
            requireAuth: true,
            body: { current_password: currentPw, new_password: newPw }
        });

        // Clear fields
        document.getElementById('profileCurrentPw').value = '';
        document.getElementById('profileNewPw').value = '';
        document.getElementById('profileConfirmPw').value = '';

        showToast('Password changed successfully.', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to change password.', 'error');
    }
}

async function requestPasswordReset() {
    const email = currentUser ? currentUser.email : '';
    if (!email) {
        showToast('No email address on file. Please contact support.', 'error');
        return;
    }

    try {
        await apiRequest('/api/user/forgot-password', {
            method: 'POST',
            body: { email }
        });
        showToast('Password reset link sent to your email.', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to send reset link.', 'error');
    }
}

function confirmCloseAccount() {
    const confirmed = confirm(
        'WARNING: Closing your account is PERMANENT.\n\n' +
        'All your balance, history, and personal data will be deleted.\n' +
        'This action cannot be undone.\n\n' +
        'Are you sure you want to close your account?'
    );
    if (!confirmed) return;

    const doubleConfirm = confirm(
        'Final confirmation:\n\n' +
        'Type OK to permanently close your account and lose all data.\n\n' +
        'Press OK to proceed or Cancel to abort.'
    );
    if (!doubleConfirm) return;

    closeAccount();
}

async function closeAccount() {
    try {
        await apiRequest('/api/user/close-account', {
            method: 'DELETE',
            requireAuth: true
        });
        hideProfileModal();
        logout();
        showToast('Your account has been closed.', 'info');
    } catch (err) {
        showToast(err.message || 'Failed to close account.', 'error');
    }
}

async function submitVerification() {
    const docType = document.getElementById('profileDocType')?.value || 'drivers_license';

    try {
        await apiRequest('/api/user/verification', {
            method: 'POST',
            requireAuth: true,
            body: { document_type: docType }
        });

        if (profileData) profileData.kyc_status = 'pending';
        showToast('Verification request submitted. We will review your request within 1-3 business days.', 'success');
        renderVerificationTab();
        renderProfileSidebar();
    } catch (err) {
        showToast(err.message || 'Failed to submit verification request.', 'error');
    }
}

async function saveLimits() {
    const dailyDeposit   = document.getElementById('profileLimitDailyDeposit')?.value || '';
    const weeklyDeposit  = document.getElementById('profileLimitWeeklyDeposit')?.value || '';
    const monthlyDeposit = document.getElementById('profileLimitMonthlyDeposit')?.value || '';
    const dailyLoss      = document.getElementById('profileLimitDailyLoss')?.value || '';
    const sessionTime    = document.getElementById('profileSessionTime')?.value || '';

    try {
        await apiRequest('/api/payment/limits', {
            method: 'PUT',
            requireAuth: true,
            body: {
                daily_deposit: dailyDeposit ? Number(dailyDeposit) : null,
                weekly_deposit: weeklyDeposit ? Number(weeklyDeposit) : null,
                monthly_deposit: monthlyDeposit ? Number(monthlyDeposit) : null,
                daily_loss: dailyLoss ? Number(dailyLoss) : null,
                session_time: sessionTime ? Number(sessionTime) : null
            }
        });

        if (profileData) {
            profileData.limits = {
                daily_deposit: dailyDeposit,
                weekly_deposit: weeklyDeposit,
                monthly_deposit: monthlyDeposit,
                daily_loss: dailyLoss,
                session_time: sessionTime
            };
        }

        showToast('Limits saved successfully. Changes take effect immediately.', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to save limits.', 'error');
    }
}

async function selfExclude(hours) {
    const labels = { 24: '24 hours', 48: '48 hours', 72: '72 hours', 168: '1 week', 720: '30 days' };
    const label = labels[hours] || hours + ' hours';

    const confirmed = confirm(
        `Self-Exclusion: ${label}\n\n` +
        'During this period you will NOT be able to:\n' +
        '- Log in to your account\n' +
        '- Place any bets\n' +
        '- Access your balance\n\n' +
        'This cannot be reversed until the period expires.\n\n' +
        'Are you sure you want to self-exclude?'
    );
    if (!confirmed) return;

    try {
        await apiRequest('/api/payment/self-exclude', {
            method: 'POST',
            requireAuth: true,
            body: { hours }
        });
        hideProfileModal();
        logout();
        showToast(`Self-exclusion activated for ${label}. Take care of yourself.`, 'info');
    } catch (err) {
        showToast(err.message || 'Failed to activate self-exclusion.', 'error');
    }
}


// ═══════════════════════════════════════════════════════
// HISTORY PAGINATION & FILTER
// ═══════════════════════════════════════════════════════

function setHistoryFilter(filter) {
    profileHistoryFilter = filter;
    profileHistoryPage = 1;
    renderHistoryTab();
}

function profileHistoryPrev() {
    if (profileHistoryPage > 1) {
        profileHistoryPage--;
        renderHistoryTab();
    }
}

function profileHistoryNext() {
    const total = ((profileData && profileData.transactions) || []).length;
    const filtered = profileHistoryFilter === 'all'
        ? total
        : ((profileData && profileData.transactions) || []).filter(tx => tx.type === profileHistoryFilter).length;
    const totalPages = Math.max(1, Math.ceil(filtered / PROFILE_HISTORY_PAGE_SIZE));
    if (profileHistoryPage < totalPages) {
        profileHistoryPage++;
        renderHistoryTab();
    }
}


// ═══════════════════════════════════════════════════════
// BADGES TAB
// ═══════════════════════════════════════════════════════

// Canonical achievement definitions mirrored from ui-modals.js.
// These must stay in sync with ACH_DEFS in that file.
const BADGE_ACH_DEFS = [
    // Spin milestones
    { id: 'first_spin',    icon: '🎰', name: 'First Spin',       desc: 'Play your first spin',               reqType: 'spins'   },
    { id: 'spin_10',       icon: '🔄', name: 'Getting Started',  desc: 'Complete 10 spins',                  reqType: 'spins'   },
    { id: 'spin_100',      icon: '💫', name: 'Spin Master',      desc: 'Complete 100 spins',                 reqType: 'spins'   },
    { id: 'spin_500',      icon: '⚡', name: 'Centurion',        desc: 'Complete 500 spins',                 reqType: 'spins'   },
    { id: 'spin_1000',     icon: '🌀', name: 'Reel Veteran',     desc: 'Complete 1,000 spins',               reqType: 'spins'   },
    // Win milestones
    { id: 'first_win',     icon: '🏆', name: 'First Win',        desc: 'Win your first spin',                reqType: 'wins'    },
    { id: 'win_10',        icon: '💰', name: 'On a Roll',        desc: 'Win 10 times',                       reqType: 'wins'    },
    { id: 'win_50',        icon: '🤑', name: 'Lucky Streak',     desc: 'Win 50 times',                       reqType: 'wins'    },
    { id: 'win_200',       icon: '🥇', name: 'Win Connoisseur',  desc: 'Win 200 times',                      reqType: 'wins'    },
    // Big win multipliers
    { id: 'big_win',       icon: '💥', name: 'Big Winner',       desc: 'Win over 100x your bet',             reqType: 'bigWin'  },
    { id: 'mega_win',      icon: '🌟', name: 'Mega Winner',      desc: 'Win over 500x your bet',             reqType: 'bigWin'  },
    { id: 'epic_win',      icon: '🔥', name: 'Epic Winner',      desc: 'Win over 1,000x your bet',           reqType: 'bigWin'  },
    // Game variety
    { id: 'games_5',       icon: '🎮', name: 'Explorer',         desc: 'Try 5 different games',              reqType: 'games'   },
    { id: 'games_20',      icon: '🗺️', name: 'Adventurer',      desc: 'Try 20 different games',             reqType: 'games'   },
    { id: 'games_50',      icon: '🌍', name: 'Globe Trotter',    desc: 'Try 50 different games',             reqType: 'games'   },
    { id: 'games_all',     icon: '👑', name: 'Master of All',    desc: 'Try all 122 games',                  reqType: 'games'   },
    // Balance milestones
    { id: 'balance_500',   icon: '💎', name: 'Getting Rich',     desc: 'Reach a balance of $500',            reqType: 'balance' },
    { id: 'balance_1000',  icon: '💰', name: 'High Balance',     desc: 'Reach a balance of $1,000',          reqType: 'balance' },
    { id: 'balance_5000',  icon: '🏦', name: 'Bank Breaker',     desc: 'Reach a balance of $5,000',          reqType: 'balance' },
    // Wager milestones
    { id: 'wager_1k',      icon: '📊', name: 'Regular',          desc: 'Wager $1,000 total',                 reqType: 'wager'   },
    { id: 'wager_10k',     icon: '📈', name: 'Whale',            desc: 'Wager $10,000 total',                reqType: 'wager'   },
    // Bonus triggers
    { id: 'bonus_5',       icon: '🎁', name: 'Bonus Seeker',     desc: 'Trigger 5 bonus rounds',             reqType: 'bonuses' },
    { id: 'bonus_25',      icon: '🎯', name: 'Bonus Hunter',     desc: 'Trigger 25 bonus rounds',            reqType: 'bonuses' },
    // Win streak
    { id: 'streak_5',      icon: '🔥', name: 'Hot Hand',         desc: 'Win 5 spins in a row',               reqType: 'streak'  },
    { id: 'streak_10',     icon: '💠', name: 'Unstoppable',      desc: 'Win 10 spins in a row',              reqType: 'streak'  },
];

const BADGE_CATEGORY_ORDER = [
    { key: 'spins',   label: '🎰 Spin Milestones' },
    { key: 'wins',    label: '🏆 Win Milestones' },
    { key: 'bigWin',  label: '💥 Big Wins' },
    { key: 'games',   label: '🗺️ Explorer' },
    { key: 'balance', label: '💎 Balance' },
    { key: 'wager',   label: '📊 Wager' },
    { key: 'bonuses', label: '🎁 Bonus Rounds' },
    { key: 'streak',  label: '🔥 Win Streaks' },
];

function renderBadgeGallery() {
    const el = document.getElementById('profileContent');

    // Load which achievements are unlocked from localStorage
    var unlocked = [];
    try {
        var saved = JSON.parse(localStorage.getItem('matrixAchievements') || '{}');
        unlocked = Array.isArray(saved.unlocked) ? saved.unlocked : [];
    } catch(e) {}

    // Group by reqType preserving category order
    var grouped = {};
    BADGE_CATEGORY_ORDER.forEach(function(cat) { grouped[cat.key] = []; });
    BADGE_ACH_DEFS.forEach(function(ach) {
        if (grouped[ach.reqType]) grouped[ach.reqType].push(ach);
        else { grouped[ach.reqType] = [ach]; }
    });

    var earnedCount = BADGE_ACH_DEFS.filter(function(a) { return unlocked.includes(a.id); }).length;

    var html = `
        <h3 class="profile-section-title">Achievement Badges</h3>
        <p style="color:#94a3b8;font-size:12px;margin-bottom:16px;">
            ${earnedCount} / ${BADGE_ACH_DEFS.length} earned
        </p>
        <div id="profileBadgesGrid" class="badges-container">`;

    BADGE_CATEGORY_ORDER.forEach(function(cat) {
        var achs = grouped[cat.key];
        if (!achs || achs.length === 0) return;
        html += `<div class="badge-category-header">${cat.label}</div>`;
        html += `<div class="badge-grid">`;
        achs.forEach(function(ach) {
            var earned = unlocked.includes(ach.id);
            var cls = 'badge-item' + (earned ? ' earned' : ' locked');
            var tip = earned
                ? escapeAttr(ach.name + ': ' + ach.desc)
                : 'Keep playing to unlock!';
            html += `<div class="${cls}" title="${tip}">`;
            html += `<div class="badge-icon">${ach.icon}</div>`;
            html += `<div class="badge-name">${earned ? escapeHtml(ach.name) : '???'}</div>`;
            html += `</div>`;
        });
        html += `</div>`;
    });

    html += `</div>`;
    el.innerHTML = html;
}


// ═══════════════════════════════════════════════════════
// LOGOUT FROM PROFILE
// ═══════════════════════════════════════════════════════

function profileLogout() {
    hideProfileModal();
    if (typeof logout === 'function') {
        logout();
    }
}


// ═══════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════

function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str || '');
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildCountryOptions(selected) {
    const countries = [
        'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE',
        'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE', 'PT', 'NZ', 'JP',
        'KR', 'SG', 'BR', 'MX', 'IN', 'ZA', 'AE', 'PL', 'CZ', 'GR'
    ];
    const labels = {
        US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
        DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
        BE: 'Belgium', AT: 'Austria', CH: 'Switzerland', SE: 'Sweden', NO: 'Norway',
        DK: 'Denmark', FI: 'Finland', IE: 'Ireland', PT: 'Portugal', NZ: 'New Zealand',
        JP: 'Japan', KR: 'South Korea', SG: 'Singapore', BR: 'Brazil', MX: 'Mexico',
        IN: 'India', ZA: 'South Africa', AE: 'United Arab Emirates', PL: 'Poland',
        CZ: 'Czech Republic', GR: 'Greece'
    };
    return countries.map(code =>
        `<option value="${code}" ${selected === code ? 'selected' : ''}>${labels[code] || code}</option>`
    ).join('');
}


// ═══════════════════════════════════════════════════════
// REFERRAL SECTION — standalone embed helper
// ═══════════════════════════════════════════════════════
//
// renderReferralSection(container)
//
// Renders a self-contained referral UI block into `container`.
// Can be called from any page context — it fetches its own data
// and does NOT depend on the profile modal being open.
//
// Design: dark green gradient theme ("money / growth").
// All dynamic user data uses textContent. Static CSS is injected once.

function renderReferralSection(container) {
    if (!container) return;

    // Inject CSS once
    if (!document.getElementById('referralSectionCss')) {
        var style = document.createElement('style');
        style.id = 'referralSectionCss';
        style.textContent = [
            '.ref-section {',
            '  font-family: inherit;',
            '  color: #e2e8f0;',
            '}',
            '.ref-card {',
            '  background: linear-gradient(135deg, rgba(6,78,59,0.55) 0%, rgba(5,46,22,0.70) 100%);',
            '  border: 1px solid rgba(34,197,94,0.35);',
            '  border-radius: 14px;',
            '  padding: 20px;',
            '  margin-bottom: 16px;',
            '}',
            '.ref-card-title {',
            '  font-size: 11px;',
            '  font-weight: 700;',
            '  color: #4ade80;',
            '  text-transform: uppercase;',
            '  letter-spacing: 1px;',
            '  margin-bottom: 14px;',
            '}',
            '.ref-code-big {',
            '  font-size: 2rem;',
            '  font-weight: 900;',
            '  color: #4ade80;',
            '  letter-spacing: 6px;',
            '  font-family: "Courier New", monospace;',
            '  background: rgba(0,0,0,0.3);',
            '  border: 2px dashed rgba(74,222,128,0.4);',
            '  border-radius: 8px;',
            '  padding: 10px 18px;',
            '  display: inline-block;',
            '  margin-bottom: 10px;',
            '}',
            '.ref-copy-btn {',
            '  background: linear-gradient(135deg, #22c55e, #16a34a);',
            '  color: #fff;',
            '  border: none;',
            '  border-radius: 8px;',
            '  padding: 10px 18px;',
            '  font-weight: 700;',
            '  font-size: 12px;',
            '  cursor: pointer;',
            '  transition: transform 0.15s, box-shadow 0.15s;',
            '  white-space: nowrap;',
            '}',
            '.ref-copy-btn:hover {',
            '  transform: translateY(-1px);',
            '  box-shadow: 0 4px 14px rgba(34,197,94,0.35);',
            '}',
            '.ref-link-input {',
            '  flex: 1;',
            '  background: rgba(0,0,0,0.3);',
            '  border: 1px solid rgba(34,197,94,0.25);',
            '  border-radius: 8px;',
            '  padding: 9px 12px;',
            '  color: #86efac;',
            '  font-size: 12px;',
            '  font-family: "Courier New", monospace;',
            '  outline: none;',
            '}',
            '.ref-link-input:focus-visible {',
            '  outline: 2px solid #22c55e;',
            '  outline-offset: 2px;',
            '}',
            '.ref-stats-bar {',
            '  display: flex;',
            '  gap: 16px;',
            '  flex-wrap: wrap;',
            '  margin-top: 14px;',
            '  padding-top: 12px;',
            '  border-top: 1px solid rgba(34,197,94,0.2);',
            '  font-size: 12px;',
            '}',
            '.ref-stat {',
            '  display: flex;',
            '  flex-direction: column;',
            '  gap: 2px;',
            '}',
            '.ref-stat-label {',
            '  color: #6b7280;',
            '  font-size: 10px;',
            '  text-transform: uppercase;',
            '  letter-spacing: 0.5px;',
            '}',
            '.ref-stat-value {',
            '  font-weight: 800;',
            '  color: #e2e8f0;',
            '}',
            '.ref-stat-value--green { color: #4ade80; }',
            '.ref-table {',
            '  width: 100%;',
            '  border-collapse: collapse;',
            '  font-size: 12px;',
            '}',
            '.ref-table th {',
            '  text-align: left;',
            '  padding: 8px 10px;',
            '  font-size: 10px;',
            '  font-weight: 700;',
            '  color: #4ade80;',
            '  text-transform: uppercase;',
            '  letter-spacing: 0.5px;',
            '  border-bottom: 1px solid rgba(34,197,94,0.2);',
            '}',
            '.ref-table td {',
            '  padding: 8px 10px;',
            '  color: #cbd5e1;',
            '  border-bottom: 1px solid rgba(34,197,94,0.08);',
            '}',
            '.ref-badge {',
            '  display: inline-block;',
            '  padding: 2px 8px;',
            '  border-radius: 4px;',
            '  font-size: 10px;',
            '  font-weight: 700;',
            '  text-transform: uppercase;',
            '}',
            '.ref-badge--pending   { background: rgba(251,191,36,0.15);  color: #fbbf24; }',
            '.ref-badge--completed { background: rgba(34,197,94,0.15);   color: #4ade80; }',
            '.ref-apply-card {',
            '  background: linear-gradient(135deg, rgba(6,78,59,0.35) 0%, rgba(5,46,22,0.50) 100%);',
            '  border: 1px solid rgba(34,197,94,0.2);',
            '  border-radius: 14px;',
            '  padding: 20px;',
            '  margin-bottom: 16px;',
            '}',
            '.ref-apply-input {',
            '  flex: 1;',
            '  background: rgba(0,0,0,0.3);',
            '  border: 1px solid rgba(34,197,94,0.3);',
            '  border-radius: 8px;',
            '  padding: 9px 12px;',
            '  color: #e2e8f0;',
            '  font-size: 13px;',
            '  font-family: "Courier New", monospace;',
            '  text-transform: uppercase;',
            '  letter-spacing: 2px;',
            '  outline: none;',
            '}',
            '.ref-apply-input:focus { border-color: rgba(74,222,128,0.5); }',
            '.ref-msg {',
            '  margin-top: 8px;',
            '  font-size: 12px;',
            '  display: none;',
            '}',
            '.ref-msg--success { color: #4ade80; }',
            '.ref-msg--error   { color: #f87171; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // Loading state
    container.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'ref-section';

    var loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'text-align:center; padding:30px; color:#4ade80; font-size:13px;';
    loadingDiv.textContent = 'Loading referral info...';
    wrap.appendChild(loadingDiv);
    container.appendChild(wrap);

    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) {
        loadingDiv.textContent = 'Please log in to view your referral program.';
        return;
    }

    // Fetch both endpoints in parallel
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

    Promise.allSettled([
        fetch('/api/referral/info', { headers: headers }).then(function(r) { return r.json(); }),
        fetch('/api/referral/stats', { headers: headers }).then(function(r) { return r.json(); })
    ]).then(function(results) {
        var infoData  = results[0].status === 'fulfilled' ? results[0].value : null;
        var statsData = results[1].status === 'fulfilled' ? results[1].value : null;

        var code            = (infoData && infoData.code)             ? infoData.code             : '------';
        var referralUrl     = (infoData && infoData.referralUrl)      ? infoData.referralUrl      : (window.location.origin + '?ref=' + code);
        var totalReferrals  = (infoData && infoData.totalReferrals  != null) ? infoData.totalReferrals  : 0;
        var pendingReferrals = (infoData && infoData.pendingReferrals != null) ? infoData.pendingReferrals : 0;
        var totalEarned     = (infoData && infoData.totalEarned     != null) ? infoData.totalEarned     : 0;
        var referrals       = (statsData && Array.isArray(statsData.referrals)) ? statsData.referrals : [];
        var hasBeenReferred = referrals.some(function(r) { return r.status === 'completed'; });

        // Clear loading
        wrap.textContent = '';

        // ── My Code Card ───────────────────────────────────
        var codeCard = document.createElement('div');
        codeCard.className = 'ref-card';

        var codeCardTitle = document.createElement('div');
        codeCardTitle.className = 'ref-card-title';
        codeCardTitle.textContent = 'My Referral Code';
        codeCard.appendChild(codeCardTitle);

        var codeRow = document.createElement('div');
        codeRow.style.cssText = 'display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px;';

        var codeDisp = document.createElement('div');
        codeDisp.className = 'ref-code-big';
        codeDisp.textContent = code;
        codeRow.appendChild(codeDisp);

        var cpCodeBtn = document.createElement('button');
        cpCodeBtn.className = 'ref-copy-btn';
        cpCodeBtn.textContent = 'Copy Code';
        cpCodeBtn.onclick = function() {
            var txt = code;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(function() {
                    cpCodeBtn.textContent = 'Copied!';
                    setTimeout(function() { cpCodeBtn.textContent = 'Copy Code'; }, 2000);
                }).catch(function() { _refFallbackCopy(txt, cpCodeBtn, 'Copy Code'); });
            } else {
                _refFallbackCopy(txt, cpCodeBtn, 'Copy Code');
            }
        };
        codeRow.appendChild(cpCodeBtn);
        codeCard.appendChild(codeRow);

        // Share link row
        var linkRow = document.createElement('div');
        linkRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:0;';

        var linkInp = document.createElement('input');
        linkInp.type = 'text';
        linkInp.readOnly = true;
        linkInp.value = referralUrl;
        linkInp.className = 'ref-link-input';
        linkRow.appendChild(linkInp);

        var cpLinkBtn = document.createElement('button');
        cpLinkBtn.className = 'ref-copy-btn';
        cpLinkBtn.textContent = 'Copy Link';
        cpLinkBtn.onclick = function() {
            var txt = referralUrl;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(function() {
                    cpLinkBtn.textContent = 'Copied!';
                    setTimeout(function() { cpLinkBtn.textContent = 'Copy Link'; }, 2000);
                }).catch(function() { _refFallbackCopy(txt, cpLinkBtn, 'Copy Link'); });
            } else {
                _refFallbackCopy(txt, cpLinkBtn, 'Copy Link');
            }
        };
        linkRow.appendChild(cpLinkBtn);
        codeCard.appendChild(linkRow);

        // Stats bar
        var statsBar = document.createElement('div');
        statsBar.className = 'ref-stats-bar';

        function _makeRefStat(labelText, valueText, green) {
            var s = document.createElement('div');
            s.className = 'ref-stat';
            var lbl = document.createElement('div');
            lbl.className = 'ref-stat-label';
            lbl.textContent = labelText;
            var val = document.createElement('div');
            val.className = green ? 'ref-stat-value ref-stat-value--green' : 'ref-stat-value';
            val.textContent = valueText;
            s.appendChild(lbl);
            s.appendChild(val);
            return s;
        }

        statsBar.appendChild(_makeRefStat('Total Referrals', String(totalReferrals), false));
        statsBar.appendChild(_makeRefStat('Pending', String(pendingReferrals), false));
        statsBar.appendChild(_makeRefStat('Total Earned', '$' + (typeof formatMoney === 'function' ? formatMoney(totalEarned) : Number(totalEarned).toFixed(2)), true));
        codeCard.appendChild(statsBar);

        wrap.appendChild(codeCard);

        // ── Recent referrals table ─────────────────────────
        if (referrals.length > 0) {
            var tableCard = document.createElement('div');
            tableCard.className = 'ref-card';

            var tblTitle = document.createElement('div');
            tblTitle.className = 'ref-card-title';
            tblTitle.textContent = 'Recent Referrals';
            tableCard.appendChild(tblTitle);

            var tblWrap = document.createElement('div');
            tblWrap.style.cssText = 'overflow-x:auto;';

            var tbl = document.createElement('table');
            tbl.className = 'ref-table';

            var thead = document.createElement('thead');
            var hrow = document.createElement('tr');
            ['Username', 'Status', 'Bonus Paid', 'Date'].forEach(function(h) {
                var th = document.createElement('th');
                th.textContent = h;
                hrow.appendChild(th);
            });
            thead.appendChild(hrow);
            tbl.appendChild(thead);

            var tbody = document.createElement('tbody');
            referrals.forEach(function(r) {
                var tr = document.createElement('tr');

                var rawName = r.referee_username || 'Unknown';
                var masked = rawName.length > 2 ? rawName.substring(0, 2) + '***' : rawName.charAt(0) + '***';

                var tdN = document.createElement('td');
                tdN.textContent = masked;
                tr.appendChild(tdN);

                var tdS = document.createElement('td');
                var bdg = document.createElement('span');
                bdg.className = 'ref-badge ref-badge--' + (r.status || 'pending');
                bdg.textContent = (r.status || 'pending').charAt(0).toUpperCase() + (r.status || 'pending').slice(1);
                tdS.appendChild(bdg);
                tr.appendChild(tdS);

                var tdB = document.createElement('td');
                var bonusPaid = r.bonus_paid != null ? r.bonus_paid : 0;
                tdB.textContent = bonusPaid > 0 ? ('$' + (typeof formatMoney === 'function' ? formatMoney(bonusPaid) : Number(bonusPaid).toFixed(2))) : '-';
                if (bonusPaid > 0) tdB.style.cssText = 'color:#4ade80; font-weight:700;';
                tr.appendChild(tdB);

                var tdD = document.createElement('td');
                if (r.created_at) {
                    try {
                        tdD.textContent = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    } catch(e) {
                        tdD.textContent = r.created_at;
                    }
                } else {
                    tdD.textContent = '-';
                }
                tr.appendChild(tdD);

                tbody.appendChild(tr);
            });
            tbl.appendChild(tbody);
            tblWrap.appendChild(tbl);
            tableCard.appendChild(tblWrap);
            wrap.appendChild(tableCard);
        }

        // ── Apply a Referral Code (only if not yet referred) ──
        if (!hasBeenReferred) {
            var applyCard = document.createElement('div');
            applyCard.className = 'ref-apply-card';

            var applyTitle = document.createElement('div');
            applyTitle.className = 'ref-card-title';
            applyTitle.textContent = 'Apply a Referral Code';
            applyCard.appendChild(applyTitle);

            var applyDesc = document.createElement('p');
            applyDesc.style.cssText = 'color:#94a3b8; font-size:12px; margin-bottom:12px; line-height:1.5;';
            applyDesc.textContent = 'Enter a friend\'s referral code to claim your sign-up bonus.';
            applyCard.appendChild(applyDesc);

            var applyRow = document.createElement('div');
            applyRow.style.cssText = 'display:flex; gap:8px; align-items:center;';

            var applyInp = document.createElement('input');
            applyInp.type = 'text';
            applyInp.maxLength = 10;
            applyInp.placeholder = 'XXXXXX';
            applyInp.className = 'ref-apply-input';
            applyRow.appendChild(applyInp);

            var applyMsg = document.createElement('div');
            applyMsg.className = 'ref-msg';

            var applyBtn = document.createElement('button');
            applyBtn.className = 'ref-copy-btn';
            applyBtn.textContent = 'Apply';
            applyBtn.onclick = function() {
                var enteredCode = applyInp.value.trim().toUpperCase();
                if (!enteredCode) {
                    applyMsg.textContent = 'Please enter a referral code.';
                    applyMsg.className = 'ref-msg ref-msg--error';
                    applyMsg.style.display = 'block';
                    return;
                }
                applyBtn.disabled = true;
                applyBtn.textContent = '...';

                var currentToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                if (!currentToken) {
                    applyMsg.textContent = 'You must be logged in to apply a referral code.';
                    applyMsg.className = 'ref-msg ref-msg--error';
                    applyMsg.style.display = 'block';
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'Apply';
                    return;
                }

                fetch('/api/referral/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentToken },
                    body: JSON.stringify({ code: enteredCode })
                }).then(function(res) {
                    return res.json().then(function(body) { return { ok: res.ok, body: body }; });
                }).then(function(result) {
                    if (result.ok && result.body && result.body.success) {
                        var successMsg = (result.body.message) ? result.body.message : 'Referral code applied! Bonus credited.';
                        applyMsg.textContent = successMsg;
                        applyMsg.className = 'ref-msg ref-msg--success';
                        applyMsg.style.display = 'block';
                        applyInp.value = '';
                        applyInp.disabled = true;
                        applyBtn.disabled = true;
                        applyBtn.textContent = 'Applied';
                    } else {
                        var errText = (result.body && result.body.message) ? result.body.message : 'Failed to apply referral code.';
                        applyMsg.textContent = errText;
                        applyMsg.className = 'ref-msg ref-msg--error';
                        applyMsg.style.display = 'block';
                        applyBtn.disabled = false;
                        applyBtn.textContent = 'Apply';
                    }
                }).catch(function() {
                    applyMsg.textContent = 'Network error. Please try again.';
                    applyMsg.className = 'ref-msg ref-msg--error';
                    applyMsg.style.display = 'block';
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'Apply';
                });
            };
            applyRow.appendChild(applyBtn);
            applyCard.appendChild(applyRow);
            applyCard.appendChild(applyMsg);
            wrap.appendChild(applyCard);
        }
    }).catch(function() {
        wrap.textContent = '';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171; text-align:center; padding:20px; font-size:13px;';
        errDiv.textContent = 'Failed to load referral data. Please try again later.';
        wrap.appendChild(errDiv);
    });
}

// Internal clipboard fallback for renderReferralSection
function _refFallbackCopy(text, btn, label) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = label; }, 2000);
    } catch(e) {
        btn.textContent = label;
    }
}


// ═══════════════════════════════════════════════════════
// GIFTS TAB — tab entry point
// ═══════════════════════════════════════════════════════

function renderGiftsTab() {
    var el = document.getElementById('profileContent');
    if (!el) return;
    el.textContent = '';

    var header = document.createElement('h2');
    header.className = 'profile-section-title';
    header.textContent = 'Gifts';
    el.appendChild(header);

    renderGiftsSection(el);
}


// ═══════════════════════════════════════════════════════
// GIFTS SECTION — standalone embed helper
// ═══════════════════════════════════════════════════════
//
// renderGiftsSection(container)
//
// Renders a self-contained gifts UI block into `container`.
// Three sub-tabs: Send Gift | Inbox | Sent.
// All dynamic content uses textContent / createElement — no innerHTML with variables.

function renderGiftsSection(container) {
    if (!container) return;

    // ── Inject CSS once ────────────────────────────────
    if (!document.getElementById('giftsSectionCss')) {
        var style = document.createElement('style');
        style.id = 'giftsSectionCss';
        style.textContent = [
            '.gifts-section { font-family: inherit; color: #e2e8f0; }',
            '.gifts-tab-bar {',
            '  display: flex; gap: 6px; margin-bottom: 18px;',
            '}',
            '.gifts-tab-btn {',
            '  flex: 1; padding: 8px 0; border: 1px solid rgba(168,85,247,0.35);',
            '  border-radius: 8px; background: rgba(88,28,135,0.25); color: #c4b5fd;',
            '  font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.18s, color 0.18s;',
            '}',
            '.gifts-tab-btn.active {',
            '  background: linear-gradient(135deg, rgba(126,34,206,0.75), rgba(88,28,135,0.85));',
            '  color: #f3e8ff; border-color: rgba(168,85,247,0.7);',
            '}',
            '.gifts-tab-btn:hover:not(.active) { background: rgba(88,28,135,0.45); }',
            '.gifts-panel { display: none; }',
            '.gifts-panel.active { display: block; }',
            '.gifts-card {',
            '  background: linear-gradient(135deg, rgba(88,28,135,0.35) 0%, rgba(49,10,101,0.55) 100%);',
            '  border: 1px solid rgba(168,85,247,0.30); border-radius: 14px;',
            '  padding: 20px; margin-bottom: 14px;',
            '}',
            '.gifts-card-title {',
            '  font-size: 11px; font-weight: 700; letter-spacing: 1.2px;',
            '  color: #a78bfa; text-transform: uppercase; margin-bottom: 14px;',
            '}',
            '.gifts-field-row { margin-bottom: 12px; }',
            '.gifts-field-row label {',
            '  display: block; font-size: 12px; font-weight: 600;',
            '  color: #c4b5fd; margin-bottom: 5px;',
            '}',
            '.gifts-field-row input[type="text"], .gifts-field-row input[type="number"] {',
            '  width: 100%; box-sizing: border-box;',
            '  background: rgba(30,0,60,0.55); border: 1px solid rgba(168,85,247,0.40);',
            '  border-radius: 8px; color: #e2e8f0; font-size: 14px;',
            '  padding: 9px 12px; outline: none; transition: border-color 0.18s;',
            '}',
            '.gifts-field-row input:focus { border-color: rgba(168,85,247,0.85); }',
            '.gifts-send-btn {',
            '  width: 100%; padding: 11px 0; border: none; border-radius: 10px;',
            '  background: linear-gradient(135deg, #7c3aed, #5b21b6);',
            '  color: #fff; font-size: 14px; font-weight: 700; cursor: pointer;',
            '  transition: opacity 0.18s; margin-top: 4px;',
            '}',
            '.gifts-send-btn:disabled { opacity: 0.5; cursor: default; }',
            '.gifts-send-btn:hover:not(:disabled) { opacity: 0.88; }',
            '.gifts-msg {',
            '  margin-top: 10px; font-size: 13px; text-align: center;',
            '  padding: 8px 12px; border-radius: 8px; display: none;',
            '}',
            '.gifts-msg.success { background: rgba(34,197,94,0.15); color: #86efac; border: 1px solid rgba(34,197,94,0.3); }',
            '.gifts-msg.error   { background: rgba(239,68,68,0.15);  color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }',
            '.gifts-empty {',
            '  text-align: center; color: #94a3b8; font-size: 13px; padding: 28px 0;',
            '}',
            '.gift-row {',
            '  display: flex; align-items: center; gap: 12px;',
            '  border-bottom: 1px solid rgba(168,85,247,0.15);',
            '  padding: 12px 0;',
            '}',
            '.gift-row:last-child { border-bottom: none; }',
            '.gift-row-info { flex: 1; min-width: 0; }',
            '.gift-row-user { font-size: 13px; font-weight: 700; color: #ddd6fe; }',
            '.gift-row-msg  { font-size: 12px; color: #94a3b8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.gift-row-amount { font-size: 15px; font-weight: 800; color: #a78bfa; white-space: nowrap; }',
            '.gift-row-date   { font-size: 11px; color: #64748b; white-space: nowrap; }',
            '.gift-claim-btn {',
            '  padding: 7px 14px; border: none; border-radius: 8px;',
            '  background: linear-gradient(135deg, #7c3aed, #5b21b6);',
            '  color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;',
            '  white-space: nowrap; transition: opacity 0.18s;',
            '}',
            '.gift-claim-btn:disabled { opacity: 0.45; cursor: default; }',
            '.gift-claim-btn:hover:not(:disabled) { opacity: 0.84; }',
            '.gift-status-badge {',
            '  display: inline-block; font-size: 10px; font-weight: 700;',
            '  letter-spacing: 0.8px; text-transform: uppercase;',
            '  padding: 2px 8px; border-radius: 20px;',
            '}',
            '.gift-status-badge.pending { background: rgba(234,179,8,0.2); color: #fde047; border: 1px solid rgba(234,179,8,0.4); }',
            '.gift-status-badge.claimed { background: rgba(34,197,94,0.15); color: #86efac; border: 1px solid rgba(34,197,94,0.3); }',
        ].join('\n');
        document.head.appendChild(style);
    }

    // ── Root wrapper ───────────────────────────────────
    var wrap = document.createElement('div');
    wrap.className = 'gifts-section';

    // ── Sub-tab bar ────────────────────────────────────
    var tabBar = document.createElement('div');
    tabBar.className = 'gifts-tab-bar';

    var subTabs = [
        { id: 'send',  label: 'Send Gift' },
        { id: 'inbox', label: 'Inbox' },
        { id: 'sent',  label: 'Sent' }
    ];
    var activeSubTab = 'send';

    var panels = {};

    subTabs.forEach(function(t) {
        var btn = document.createElement('button');
        btn.className = 'gifts-tab-btn' + (t.id === activeSubTab ? ' active' : '');
        btn.textContent = t.label;
        btn.setAttribute('data-subtab', t.id);
        btn.addEventListener('click', function() {
            activeSubTab = t.id;
            tabBar.querySelectorAll('.gifts-tab-btn').forEach(function(b) {
                b.className = 'gifts-tab-btn' + (b.getAttribute('data-subtab') === activeSubTab ? ' active' : '');
            });
            Object.keys(panels).forEach(function(pid) {
                panels[pid].className = 'gifts-panel' + (pid === activeSubTab ? ' active' : '');
            });
            if (activeSubTab === 'inbox') _giftsLoadInbox(panels.inbox);
            if (activeSubTab === 'sent')  _giftsLoadSent(panels.sent);
        });
        tabBar.appendChild(btn);
    });
    wrap.appendChild(tabBar);

    // ── Panel: Send ────────────────────────────────────
    var sendPanel = document.createElement('div');
    sendPanel.className = 'gifts-panel active';
    panels.send = sendPanel;

    var sendCard = document.createElement('div');
    sendCard.className = 'gifts-card';

    var sendTitle = document.createElement('div');
    sendTitle.className = 'gifts-card-title';
    sendTitle.textContent = 'Send a Gift';
    sendCard.appendChild(sendTitle);

    // Recipient
    var recipientRow = document.createElement('div');
    recipientRow.className = 'gifts-field-row';
    var recipientLabel = document.createElement('label');
    recipientLabel.textContent = 'Recipient Username';
    recipientRow.appendChild(recipientLabel);
    var recipientInput = document.createElement('input');
    recipientInput.type = 'text';
    recipientInput.placeholder = 'Enter exact username';
    recipientInput.maxLength = 50;
    recipientRow.appendChild(recipientInput);
    sendCard.appendChild(recipientRow);

    // Amount
    var amountRow = document.createElement('div');
    amountRow.className = 'gifts-field-row';
    var amountLabel = document.createElement('label');
    amountLabel.textContent = 'Amount ($1 – $500)';
    amountRow.appendChild(amountLabel);
    var amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '1';
    amountInput.max = '500';
    amountInput.step = '1';
    amountInput.placeholder = '10';
    amountRow.appendChild(amountInput);
    sendCard.appendChild(amountRow);

    // Message
    var msgRow = document.createElement('div');
    msgRow.className = 'gifts-field-row';
    var msgLabel = document.createElement('label');
    msgLabel.textContent = 'Message (optional, max 100 chars)';
    msgRow.appendChild(msgLabel);
    var msgInput = document.createElement('input');
    msgInput.type = 'text';
    msgInput.maxLength = 100;
    msgInput.placeholder = 'Good luck!';
    msgRow.appendChild(msgInput);
    sendCard.appendChild(msgRow);

    // Send button
    var sendBtn = document.createElement('button');
    sendBtn.className = 'gifts-send-btn';
    sendBtn.textContent = 'Send Gift';
    sendCard.appendChild(sendBtn);

    // Feedback message
    var feedbackEl = document.createElement('div');
    feedbackEl.className = 'gifts-msg';
    sendCard.appendChild(feedbackEl);

    sendBtn.addEventListener('click', function() {
        if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
            _giftsShowMsg(feedbackEl, 'Please log in to send gifts.', false);
            return;
        }
        var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
        if (!token) {
            _giftsShowMsg(feedbackEl, 'Please log in to send gifts.', false);
            return;
        }

        var toUsername = recipientInput.value.trim();
        var amount = parseInt(amountInput.value, 10);
        var message = msgInput.value.trim();

        if (!toUsername) {
            _giftsShowMsg(feedbackEl, 'Please enter a recipient username.', false);
            return;
        }
        if (!amount || amount < 1 || amount > 500) {
            _giftsShowMsg(feedbackEl, 'Amount must be between $1 and $500.', false);
            return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
        feedbackEl.style.display = 'none';

        fetch('/api/gifts/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ toUsername: toUsername, amount: amount, message: message })
        }).then(function(res) { return res.json(); }).then(function(data) {
            if (data && data.ok) {
                // Update client balance if possible
                if (typeof balance !== 'undefined' && typeof data.newBalance === 'number') {
                    balance = data.newBalance;
                    if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                }
                _giftsShowMsg(feedbackEl, 'Gift sent successfully!', true);
                recipientInput.value = '';
                amountInput.value = '';
                msgInput.value = '';
            } else {
                var errMsg = (data && data.error) ? data.error : 'Failed to send gift.';
                _giftsShowMsg(feedbackEl, errMsg, false);
            }
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Gift';
        }).catch(function() {
            _giftsShowMsg(feedbackEl, 'Network error. Please try again.', false);
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Gift';
        });
    });

    sendPanel.appendChild(sendCard);
    wrap.appendChild(sendPanel);

    // ── Panel: Inbox ───────────────────────────────────
    var inboxPanel = document.createElement('div');
    inboxPanel.className = 'gifts-panel';
    panels.inbox = inboxPanel;
    wrap.appendChild(inboxPanel);

    // ── Panel: Sent ────────────────────────────────────
    var sentPanel = document.createElement('div');
    sentPanel.className = 'gifts-panel';
    panels.sent = sentPanel;
    wrap.appendChild(sentPanel);

    container.appendChild(wrap);
}

// ── Helpers ─────────────────────────────────────────────

function _giftsShowMsg(el, text, ok) {
    el.textContent = text;
    el.className = 'gifts-msg ' + (ok ? 'success' : 'error');
    el.style.display = 'block';
}

function _giftsFormatDate(str) {
    if (!str) return '';
    try {
        var d = new Date(str);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch(e) { return str; }
}

function _giftsLoadInbox(panel) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    panel.textContent = '';
    var spinner = document.createElement('div');
    spinner.className = 'profile-loading';
    var sp = document.createElement('div');
    sp.className = 'profile-spinner';
    spinner.appendChild(sp);
    panel.appendChild(spinner);

    fetch('/api/gifts/inbox', {
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(res) { return res.json(); }).then(function(data) {
        panel.textContent = '';

        var card = document.createElement('div');
        card.className = 'gifts-card';

        var cardTitle = document.createElement('div');
        cardTitle.className = 'gifts-card-title';
        cardTitle.textContent = 'Pending Gifts';
        card.appendChild(cardTitle);

        var gifts = (data && Array.isArray(data.gifts)) ? data.gifts : [];

        if (gifts.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'gifts-empty';
            empty.textContent = 'No pending gifts';
            card.appendChild(empty);
        } else {
            gifts.forEach(function(gift) {
                var row = document.createElement('div');
                row.className = 'gift-row';
                row.setAttribute('data-gift-id', String(gift.id));

                var info = document.createElement('div');
                info.className = 'gift-row-info';

                var userEl = document.createElement('div');
                userEl.className = 'gift-row-user';
                userEl.textContent = 'From: ' + (gift.fromUsername || '—');
                info.appendChild(userEl);

                if (gift.message) {
                    var msgEl = document.createElement('div');
                    msgEl.className = 'gift-row-msg';
                    msgEl.textContent = gift.message;
                    info.appendChild(msgEl);
                }

                var dateEl = document.createElement('div');
                dateEl.className = 'gift-row-date';
                dateEl.textContent = _giftsFormatDate(gift.createdAt);
                info.appendChild(dateEl);

                row.appendChild(info);

                var amtEl = document.createElement('div');
                amtEl.className = 'gift-row-amount';
                amtEl.textContent = '$' + Number(gift.amount).toFixed(2);
                row.appendChild(amtEl);

                var claimBtn = document.createElement('button');
                claimBtn.className = 'gift-claim-btn';
                claimBtn.textContent = 'Claim $' + Number(gift.amount).toFixed(2);
                claimBtn.addEventListener('click', function() {
                    claimBtn.disabled = true;
                    claimBtn.textContent = 'Claiming…';

                    var currentToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                    if (!currentToken) { claimBtn.textContent = 'Error'; return; }

                    fetch('/api/gifts/claim/' + gift.id, {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + currentToken }
                    }).then(function(res) { return res.json(); }).then(function(resp) {
                        if (resp && resp.ok) {
                            if (typeof balance !== 'undefined' && typeof resp.newBalance === 'number') {
                                balance = resp.newBalance;
                                if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                            }
                            // Remove the row from DOM
                            var rowEl = card.querySelector('[data-gift-id="' + gift.id + '"]');
                            if (rowEl) rowEl.parentNode.removeChild(rowEl);
                            // If no rows remain, show empty state
                            if (card.querySelectorAll('.gift-row').length === 0) {
                                var emptyEl = document.createElement('div');
                                emptyEl.className = 'gifts-empty';
                                emptyEl.textContent = 'No pending gifts';
                                card.appendChild(emptyEl);
                            }
                        } else {
                            claimBtn.disabled = false;
                            claimBtn.textContent = 'Claim $' + Number(gift.amount).toFixed(2);
                        }
                    }).catch(function() {
                        claimBtn.disabled = false;
                        claimBtn.textContent = 'Claim $' + Number(gift.amount).toFixed(2);
                    });
                });
                row.appendChild(claimBtn);

                card.appendChild(row);
            });
        }

        panel.appendChild(card);
    }).catch(function() {
        panel.textContent = '';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171; text-align:center; padding:20px; font-size:13px;';
        errDiv.textContent = 'Failed to load inbox. Please try again later.';
        panel.appendChild(errDiv);
    });
}

function _giftsLoadSent(panel) {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    panel.textContent = '';
    var spinner = document.createElement('div');
    spinner.className = 'profile-loading';
    var sp = document.createElement('div');
    sp.className = 'profile-spinner';
    spinner.appendChild(sp);
    panel.appendChild(spinner);

    fetch('/api/gifts/sent', {
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(res) { return res.json(); }).then(function(data) {
        panel.textContent = '';

        var card = document.createElement('div');
        card.className = 'gifts-card';

        var cardTitle = document.createElement('div');
        cardTitle.className = 'gifts-card-title';
        cardTitle.textContent = 'Sent Gifts';
        card.appendChild(cardTitle);

        var gifts = (data && Array.isArray(data.gifts)) ? data.gifts : [];

        if (gifts.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'gifts-empty';
            empty.textContent = 'No gifts sent yet';
            card.appendChild(empty);
        } else {
            gifts.forEach(function(gift) {
                var row = document.createElement('div');
                row.className = 'gift-row';

                var info = document.createElement('div');
                info.className = 'gift-row-info';

                var userEl = document.createElement('div');
                userEl.className = 'gift-row-user';
                userEl.textContent = 'To: ' + (gift.toUsername || '—');
                info.appendChild(userEl);

                if (gift.message) {
                    var msgEl = document.createElement('div');
                    msgEl.className = 'gift-row-msg';
                    msgEl.textContent = gift.message;
                    info.appendChild(msgEl);
                }

                var dateEl = document.createElement('div');
                dateEl.className = 'gift-row-date';
                dateEl.textContent = _giftsFormatDate(gift.createdAt);
                info.appendChild(dateEl);

                row.appendChild(info);

                var amtEl = document.createElement('div');
                amtEl.className = 'gift-row-amount';
                amtEl.textContent = '$' + Number(gift.amount).toFixed(2);
                row.appendChild(amtEl);

                var statusBadge = document.createElement('span');
                var statusStr = gift.status || 'pending';
                statusBadge.className = 'gift-status-badge ' + statusStr;
                statusBadge.textContent = statusStr.charAt(0).toUpperCase() + statusStr.slice(1);
                row.appendChild(statusBadge);

                card.appendChild(row);
            });
        }

        panel.appendChild(card);
    }).catch(function() {
        panel.textContent = '';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171; text-align:center; padding:20px; font-size:13px;';
        errDiv.textContent = 'Failed to load sent gifts. Please try again later.';
        panel.appendChild(errDiv);
    });
}


// ═══════════════════════════════════════════════════════
// MILESTONES / ACHIEVEMENTS / REFERRAL — CSS (injected once)
// ═══════════════════════════════════════════════════════

(function injectMilestonesAchievementsReferralCss() {
    if (document.getElementById('milestoneAchieveReferralCss')) return;
    var style = document.createElement('style');
    style.id = 'milestoneAchieveReferralCss';
    style.textContent = [
        '.profile-milestone-bar { height:8px; background:#222; border-radius:4px; overflow:hidden; margin:6px 0; }',
        '.profile-milestone-fill { height:100%; background:linear-gradient(90deg,#f59e0b,#fcd34d); border-radius:4px; transition:width 0.3s; }',
        '.profile-milestone-item { display:flex; align-items:center; gap:8px; padding:5px 0; font-size:13px; border-bottom:1px solid #1a1a3a; }',
        '.profile-milestone-item:last-child { border-bottom:none; }',
        '.profile-milestone-check { font-size:14px; width:20px; text-align:center; }',
        '.profile-milestone-label { flex:1; color:#ccc; }',
        '.profile-milestone-reward { font-size:11px; color:#888; }',
        '.profile-claim-btn { padding:8px 16px; background:linear-gradient(135deg,#f59e0b,#d97706); color:#000; font-weight:700; border-radius:8px; border:none; cursor:pointer; font-size:13px; margin-top:8px; width:100%; }',
        '.profile-achieve-item { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px solid #1a1a3a; }',
        '.profile-achieve-item:last-child { border-bottom:none; }',
        '.profile-achieve-icon { font-size:22px; line-height:1; }',
        '.profile-achieve-body { flex:1; }',
        '.profile-achieve-name { font-size:13px; font-weight:600; color:#e2e8f0; }',
        '.profile-achieve-desc { font-size:11px; color:#888; margin-top:2px; }',
        '.profile-achieve-claim-btn { padding:4px 10px; background:linear-gradient(135deg,#6c63ff,#a78bfa); color:#fff; font-weight:700; border-radius:6px; border:none; cursor:pointer; font-size:11px; }',
        '.profile-achieve-claimed { font-size:12px; color:#4ade80; }',
        '.profile-achieve-locked { font-size:12px; color:#555; }',
        '.profile-referral-code-box { background:#111; border:2px solid #6c63ff; border-radius:8px; padding:12px 16px; text-align:center; font-size:24px; font-weight:900; color:#ffd700; letter-spacing:4px; margin:8px 0; }',
        '.profile-referral-copy-btn { width:100%; padding:8px; background:linear-gradient(135deg,#6c63ff,#a78bfa); color:#fff; font-weight:700; border-radius:8px; border:none; cursor:pointer; font-size:13px; margin-bottom:10px; }',
        '.profile-referral-stats { font-size:13px; color:#888; text-align:center; }',
        '.profile-referral-stats strong { color:#e2e8f0; }',
        '.profile-referral-note { font-size:12px; color:#6c63ff; text-align:center; margin-top:8px; }'
    ].join('\n');
    document.head.appendChild(style);
})();


// ═══════════════════════════════════════════════════════
// MILESTONES TAB
// ═══════════════════════════════════════════════════════

function renderMilestonesTab() {
    var el = document.getElementById('profileContent');
    if (!el) return;
    el.textContent = '';

    injectMilestonesAchievementsReferralCss();

    var header = document.createElement('h2');
    header.className = 'profile-section-title';
    header.textContent = 'Milestones';
    el.appendChild(header);

    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
        var authMsg = document.createElement('div');
        authMsg.style.cssText = 'color:#94a3b8;text-align:center;padding:28px 0;font-size:13px;';
        authMsg.textContent = 'Please log in to view milestones.';
        el.appendChild(authMsg);
        return;
    }
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'color:#94a3b8;text-align:center;padding:28px 0;font-size:13px;';
    loadingDiv.textContent = 'Loading milestones…';
    el.appendChild(loadingDiv);

    fetch('/api/milestones/status', {
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(res) { return res.json(); }).then(function(data) {
        if (el.contains(loadingDiv)) el.removeChild(loadingDiv);

        var card = document.createElement('div');
        card.className = 'profile-card';

        var cardTitle = document.createElement('div');
        cardTitle.className = 'profile-card-title';
        cardTitle.textContent = 'Your Progress';
        card.appendChild(cardTitle);

        var totalSpins = Number(data.totalSpins) || 0;
        var totalSpinsEl = document.createElement('div');
        totalSpinsEl.style.cssText = 'font-size:15px;color:#e2e8f0;margin-bottom:10px;';
        totalSpinsEl.textContent = 'Total Spins: ' + totalSpins;
        card.appendChild(totalSpinsEl);

        var nextMilestone = Number(data.nextMilestone) || 0;
        var spinsUntilNext = Number(data.spinsUntilNext) || 0;
        var nextLabel = data.nextMilestoneLabel || '';

        if (nextMilestone > 0) {
            var progressLabel = document.createElement('div');
            progressLabel.style.cssText = 'font-size:12px;color:#94a3b8;margin-bottom:4px;';
            progressLabel.textContent = spinsUntilNext + ' spins until next milestone';
            card.appendChild(progressLabel);

            var barWrap = document.createElement('div');
            barWrap.className = 'profile-milestone-bar';
            var fill = document.createElement('div');
            fill.className = 'profile-milestone-fill';
            var pct = Math.min(100, Math.round((totalSpins / nextMilestone) * 100));
            fill.style.width = pct + '%';
            barWrap.appendChild(fill);
            card.appendChild(barWrap);

            var nextLabelEl = document.createElement('div');
            nextLabelEl.style.cssText = 'font-size:12px;color:#94a3b8;margin-top:4px;';
            nextLabelEl.textContent = 'Next: ' + nextLabel + ' (' + nextMilestone + ' spins)';
            card.appendChild(nextLabelEl);
        }

        if (data.pendingClaim && data.pendingMilestone) {
            var pm = data.pendingMilestone;
            var claimBtn = document.createElement('button');
            claimBtn.className = 'profile-claim-btn';

            var rewardParts = [];
            if (pm.gems) rewardParts.push('+' + pm.gems + '\uD83D\uDC8E');
            if (pm.credits) rewardParts.push('+$' + Number(pm.credits).toFixed(2));
            var rewardStr = rewardParts.join(' ');
            claimBtn.textContent = '\uD83C\uDF81 Claim: ' + (pm.label || '') + ' \u2014 ' + rewardStr;

            claimBtn.addEventListener('click', function() {
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming\u2026';
                var claimToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                if (!claimToken) { claimBtn.textContent = 'Error'; return; }
                fetch('/api/milestones/claim', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + claimToken, 'Content-Type': 'application/json' }
                }).then(function(r) { return r.json(); }).then(function(res) {
                    if (res.success) {
                        if (typeof showToast === 'function') {
                            var toastGems = res.gems ? ('+' + res.gems + '\uD83D\uDC8E') : '';
                            showToast('\uD83C\uDF89 Milestone: ' + (res.label || '') + '! ' + toastGems);
                        }
                        if (typeof updateBalanceDisplay === 'function' && res.newBalance !== undefined) {
                            updateBalanceDisplay(res.newBalance);
                        }
                        renderMilestonesTab();
                    } else {
                        claimBtn.disabled = false;
                        claimBtn.textContent = 'Claim failed \u2014 try again';
                    }
                }).catch(function() {
                    claimBtn.disabled = false;
                    claimBtn.textContent = 'Claim failed \u2014 try again';
                });
            });
            card.appendChild(claimBtn);
        }

        el.appendChild(card);

        var listCard = document.createElement('div');
        listCard.className = 'profile-card';

        var listTitle = document.createElement('div');
        listTitle.className = 'profile-card-title';
        listTitle.textContent = 'All Milestones';
        listCard.appendChild(listTitle);

        var MILESTONE_DEFS = [
            { spins: 100,   gems: 50,   credits: 0,  label: 'First Century' },
            { spins: 250,   gems: 100,  credits: 0,  label: 'Quarter Thousand' },
            { spins: 500,   gems: 200,  credits: 1,  label: 'Half Grand' },
            { spins: 1000,  gems: 400,  credits: 2,  label: 'One Grand' },
            { spins: 2500,  gems: 750,  credits: 5,  label: 'Two-Five Hundred' },
            { spins: 5000,  gems: 1500, credits: 10, label: 'Five Grand' },
            { spins: 10000, gems: 3000, credits: 25, label: 'Ten Grand' }
        ];

        MILESTONE_DEFS.forEach(function(m) {
            var item = document.createElement('div');
            item.className = 'profile-milestone-item';

            var check = document.createElement('span');
            check.className = 'profile-milestone-check';
            check.textContent = totalSpins >= m.spins ? '\u2705' : '\u2B55';
            item.appendChild(check);

            var lbl = document.createElement('span');
            lbl.className = 'profile-milestone-label';
            lbl.textContent = m.label + ' (' + m.spins + ' spins)';
            item.appendChild(lbl);

            var reward = document.createElement('span');
            reward.className = 'profile-milestone-reward';
            var rParts = [];
            if (m.gems) rParts.push(m.gems + '\uD83D\uDC8E');
            if (m.credits) rParts.push('$' + m.credits.toFixed(2));
            reward.textContent = rParts.join(' ');
            item.appendChild(reward);

            listCard.appendChild(item);
        });

        el.appendChild(listCard);
    }).catch(function() {
        if (el.contains(loadingDiv)) el.removeChild(loadingDiv);
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171;text-align:center;padding:20px;font-size:13px;';
        errDiv.textContent = 'Failed to load milestones. Please try again later.';
        el.appendChild(errDiv);
    });
}


// ═══════════════════════════════════════════════════════
// ACHIEVEMENTS TAB
// ═══════════════════════════════════════════════════════

function renderAchievementsTab() {
    if (typeof _renderAchievementsSection === 'function') {
        _renderAchievementsSection();
    }
}

function renderTowerTab() {
    return;
}
// ═══════════════════════════════════════════════════════
// REFERRAL TAB
// ═══════════════════════════════════════════════════════

function renderReferralTab() {
    var el = document.getElementById('profileContent');
    if (!el) return;
    el.textContent = '';

    injectMilestonesAchievementsReferralCss();

    var header = document.createElement('h2');
    header.className = 'profile-section-title';
    header.textContent = 'Referral Program';
    el.appendChild(header);

    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
        var authMsg = document.createElement('div');
        authMsg.style.cssText = 'color:#94a3b8;text-align:center;padding:28px 0;font-size:13px;';
        authMsg.textContent = 'Please log in to view your referral code.';
        el.appendChild(authMsg);
        return;
    }
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'color:#94a3b8;text-align:center;padding:28px 0;font-size:13px;';
    loadingDiv.textContent = 'Loading referral info\u2026';
    el.appendChild(loadingDiv);

    fetch('/api/referralbonus/mycode', {
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(res) { return res.json(); }).then(function(data) {
        if (el.contains(loadingDiv)) el.removeChild(loadingDiv);

        var card = document.createElement('div');
        card.className = 'profile-card';

        var cardTitle = document.createElement('div');
        cardTitle.className = 'profile-card-title';
        cardTitle.textContent = 'Your Referral Code';
        card.appendChild(cardTitle);

        var codeLabel = document.createElement('div');
        codeLabel.style.cssText = 'font-size:12px;color:#94a3b8;margin-bottom:4px;';
        codeLabel.textContent = 'Share this code with friends:';
        card.appendChild(codeLabel);

        var codeBox = document.createElement('div');
        codeBox.className = 'profile-referral-code-box';
        codeBox.textContent = data.code || '\u2014';
        card.appendChild(codeBox);

        var copyCode = data.code || '';
        var copyBtn = document.createElement('button');
        copyBtn.className = 'profile-referral-copy-btn';
        copyBtn.textContent = 'Copy Code';
        copyBtn.addEventListener('click', function() {
            if (!copyCode) return;
            navigator.clipboard.writeText(copyCode).then(function() {
                copyBtn.textContent = 'Copied!';
                setTimeout(function() { copyBtn.textContent = 'Copy Code'; }, 2000);
            }).catch(function() {
                copyBtn.textContent = 'Copy failed';
                setTimeout(function() { copyBtn.textContent = 'Copy Code'; }, 2000);
            });
        });
        card.appendChild(copyBtn);

        var statsEl = document.createElement('div');
        statsEl.className = 'profile-referral-stats';
        var totalReferrals = Number(data.totalReferrals) || 0;
        var totalEarned = Number(data.totalEarned) || 0;

        var refStrong = document.createElement('strong');
        refStrong.textContent = String(totalReferrals);
        statsEl.appendChild(refStrong);
        statsEl.appendChild(document.createTextNode(' friends referred \u00B7 '));
        var earnedStrong = document.createElement('strong');
        earnedStrong.textContent = '$' + totalEarned.toFixed(2);
        statsEl.appendChild(earnedStrong);
        statsEl.appendChild(document.createTextNode(' earned'));
        card.appendChild(statsEl);

        var noteEl = document.createElement('div');
        noteEl.className = 'profile-referral-note';
        noteEl.textContent = 'Earn $1 for each friend who joins using your code!';
        card.appendChild(noteEl);

        el.appendChild(card);
    }).catch(function() {
        if (el.contains(loadingDiv)) el.removeChild(loadingDiv);
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171;text-align:center;padding:20px;font-size:13px;';
        errDiv.textContent = 'Failed to load referral info. Please try again later.';
        el.appendChild(errDiv);
    });
}


// ═══════════════════════════════════════════════════════
// COSMETICS TAB — CSS (injected once)
// ═══════════════════════════════════════════════════════

function injectGiftsCosmeticsCss() {
    if (document.getElementById('profile-gc-css')) return;
    var style = document.createElement('style');
    style.id = 'profile-gc-css';
    style.textContent = [
        '.cosmetics-subtabs { display:flex; gap:6px; margin-bottom:18px; }',
        '.cosmetics-subtab-btn {',
        '  flex:1; padding:8px 0; border:1px solid rgba(168,85,247,0.35);',
        '  border-radius:8px; background:rgba(88,28,135,0.25); color:#c4b5fd;',
        '  font-size:13px; font-weight:600; cursor:pointer; transition:background 0.18s,color 0.18s;',
        '}',
        '.cosmetics-subtab-btn.active {',
        '  background:linear-gradient(135deg,rgba(126,34,206,0.75),rgba(88,28,135,0.85));',
        '  color:#f3e8ff; border-color:rgba(168,85,247,0.7);',
        '}',
        '.cosmetics-subtab-btn:hover:not(.active) { background:rgba(88,28,135,0.45); }',
        '.cosmetics-panel { display:none; }',
        '.cosmetics-panel.active { display:block; }',
        '.cosmetics-shop-section { margin-bottom:22px; }',
        '.cosmetics-shop-section-title {',
        '  font-size:11px; font-weight:700; letter-spacing:1.2px; color:#a78bfa;',
        '  text-transform:uppercase; margin-bottom:12px;',
        '}',
        '.cosmetics-shop-grid {',
        '  display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px;',
        '}',
        '.cosmetics-item-card {',
        '  background:linear-gradient(135deg,rgba(88,28,135,0.35) 0%,rgba(49,10,101,0.55) 100%);',
        '  border:1px solid rgba(168,85,247,0.30); border-radius:12px;',
        '  padding:14px 12px; display:flex; flex-direction:column; gap:8px;',
        '  position:relative; transition:border-color 0.18s;',
        '}',
        '.cosmetics-item-card:hover { border-color:rgba(168,85,247,0.65); }',
        '.cosmetics-item-name { font-size:13px; font-weight:700; color:#e2e8f0; line-height:1.3; }',
        '.cosmetics-item-badges { display:flex; flex-wrap:wrap; gap:4px; }',
        '.cosmetics-item-price {',
        '  font-size:13px; font-weight:800; color:#c4b5fd; margin-top:auto;',
        '}',
        '.badge-limited {',
        '  display:inline-block; font-size:9px; font-weight:800; letter-spacing:0.8px;',
        '  text-transform:uppercase; padding:2px 7px; border-radius:20px;',
        '  background:rgba(239,68,68,0.2); color:#fca5a5; border:1px solid rgba(239,68,68,0.4);',
        '}',
        '.badge-rarity-common {',
        '  display:inline-block; font-size:9px; font-weight:700; letter-spacing:0.6px;',
        '  text-transform:uppercase; padding:2px 7px; border-radius:20px;',
        '  background:rgba(100,116,139,0.2); color:#94a3b8; border:1px solid rgba(100,116,139,0.35);',
        '}',
        '.badge-rarity-rare {',
        '  display:inline-block; font-size:9px; font-weight:700; letter-spacing:0.6px;',
        '  text-transform:uppercase; padding:2px 7px; border-radius:20px;',
        '  background:rgba(59,130,246,0.2); color:#93c5fd; border:1px solid rgba(59,130,246,0.4);',
        '}',
        '.badge-rarity-epic {',
        '  display:inline-block; font-size:9px; font-weight:700; letter-spacing:0.6px;',
        '  text-transform:uppercase; padding:2px 7px; border-radius:20px;',
        '  background:rgba(168,85,247,0.2); color:#d8b4fe; border:1px solid rgba(168,85,247,0.4);',
        '}',
        '.badge-rarity-legendary {',
        '  display:inline-block; font-size:9px; font-weight:700; letter-spacing:0.6px;',
        '  text-transform:uppercase; padding:2px 7px; border-radius:20px;',
        '  background:rgba(234,179,8,0.2); color:#fde047; border:1px solid rgba(234,179,8,0.5);',
        '}',
        '.cosmetics-buy-btn {',
        '  width:100%; padding:8px 0; border:none; border-radius:8px;',
        '  background:linear-gradient(135deg,#7c3aed,#5b21b6);',
        '  color:#fff; font-size:12px; font-weight:700; cursor:pointer; transition:opacity 0.18s;',
        '}',
        '.cosmetics-buy-btn:disabled { opacity:0.45; cursor:default; }',
        '.cosmetics-buy-btn:hover:not(:disabled) { opacity:0.84; }',
        '.cosmetics-buy-btn.owned {',
        '  background:rgba(34,197,94,0.15); color:#86efac;',
        '  border:1px solid rgba(34,197,94,0.3); cursor:default;',
        '}',
        '.cosmetics-equip-btn {',
        '  width:100%; padding:8px 0; border:none; border-radius:8px;',
        '  background:linear-gradient(135deg,#0284c7,#0369a1);',
        '  color:#fff; font-size:12px; font-weight:700; cursor:pointer; transition:opacity 0.18s;',
        '}',
        '.cosmetics-equip-btn:disabled { opacity:0.45; cursor:default; }',
        '.cosmetics-equip-btn.equipped {',
        '  background:rgba(34,197,94,0.15); color:#86efac;',
        '  border:1px solid rgba(34,197,94,0.3); cursor:default;',
        '}',
        '.cosmetics-equip-btn:hover:not(:disabled):not(.equipped) { opacity:0.84; }',
        '.cosmetics-empty {',
        '  text-align:center; color:#94a3b8; font-size:13px; padding:32px 0;',
        '}'
    ].join('\n');
    document.head.appendChild(style);
}


// ═══════════════════════════════════════════════════════
// COSMETICS TAB
// ═══════════════════════════════════════════════════════

function renderCosmeticsTab() {
    var el = document.getElementById('profileContent');
    if (!el) return;
    el.textContent = '';

    injectGiftsCosmeticsCss();

    var header = document.createElement('h2');
    header.className = 'profile-section-title';
    header.textContent = 'Cosmetics';
    el.appendChild(header);

    // Sub-tab bar: Shop / Inventory
    var subTabBar = document.createElement('div');
    subTabBar.className = 'cosmetics-subtabs';

    var shopBtn = document.createElement('button');
    shopBtn.className = 'cosmetics-subtab-btn active';
    shopBtn.textContent = '\uD83D\uDED2 Shop';
    shopBtn.setAttribute('data-ctab', 'shop');
    subTabBar.appendChild(shopBtn);

    var invBtn = document.createElement('button');
    invBtn.className = 'cosmetics-subtab-btn';
    invBtn.textContent = '\uD83C\uDF92 Inventory';
    invBtn.setAttribute('data-ctab', 'inventory');
    subTabBar.appendChild(invBtn);

    el.appendChild(subTabBar);

    // Panels
    var shopPanel = document.createElement('div');
    shopPanel.className = 'cosmetics-panel active';
    shopPanel.setAttribute('data-cpanel', 'shop');
    el.appendChild(shopPanel);

    var invPanel = document.createElement('div');
    invPanel.className = 'cosmetics-panel';
    invPanel.setAttribute('data-cpanel', 'inventory');
    el.appendChild(invPanel);

    function _switchCosmeticsTab(tabId) {
        subTabBar.querySelectorAll('.cosmetics-subtab-btn').forEach(function(b) {
            b.className = 'cosmetics-subtab-btn' + (b.getAttribute('data-ctab') === tabId ? ' active' : '');
        });
        el.querySelectorAll('.cosmetics-panel').forEach(function(p) {
            p.className = 'cosmetics-panel' + (p.getAttribute('data-cpanel') === tabId ? ' active' : '');
        });
        if (tabId === 'shop') _cosmeticsLoadShop(shopPanel);
        if (tabId === 'inventory') _cosmeticsLoadInventory(invPanel);
    }

    shopBtn.addEventListener('click', function() { _switchCosmeticsTab('shop'); });
    invBtn.addEventListener('click', function() { _switchCosmeticsTab('inventory'); });

    // Load shop by default
    _cosmeticsLoadShop(shopPanel);
}


// ── Cosmetics: load shop ─────────────────────────────────

function _cosmeticsLoadShop(panel) {
    panel.textContent = '';

    var spinner = document.createElement('div');
    spinner.className = 'profile-loading';
    var sp = document.createElement('div');
    sp.className = 'profile-spinner';
    spinner.appendChild(sp);
    panel.appendChild(spinner);

    // Fetch shop (public) and inventory (auth, optional) in parallel
    var token = null;
    if (typeof isServerAuthToken === 'function' && isServerAuthToken()) {
        token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    }

    var shopPromise = fetch('/api/cosmetics/shop').then(function(r) { return r.json(); });
    var invPromise = token
        ? fetch('/api/cosmetics/inventory', { headers: { 'Authorization': 'Bearer ' + token } }).then(function(r) { return r.json(); })
        : Promise.resolve({ inventory: [] });

    Promise.all([shopPromise, invPromise]).then(function(results) {
        var shopData = results[0];
        var invData = results[1];
        panel.textContent = '';

        var shop = (shopData && shopData.shop) ? shopData.shop : {};
        var inventory = (invData && Array.isArray(invData.inventory)) ? invData.inventory : [];

        // Build a set of owned item IDs for quick lookup
        var ownedIds = {};
        inventory.forEach(function(it) { ownedIds[it.item_id] = it; });

        var categories = [
            { key: 'avatarFrames',  label: 'Avatar Frames' },
            { key: 'cardThemes',    label: 'Card Themes' },
            { key: 'spinEffects',   label: 'Spin Effects' }
        ];

        var hasAny = false;

        categories.forEach(function(cat) {
            var items = (Array.isArray(shop[cat.key])) ? shop[cat.key] : [];
            if (items.length === 0) return;
            hasAny = true;

            var section = document.createElement('div');
            section.className = 'cosmetics-shop-section';

            var sectionTitle = document.createElement('div');
            sectionTitle.className = 'cosmetics-shop-section-title';
            sectionTitle.textContent = cat.label;
            section.appendChild(sectionTitle);

            var grid = document.createElement('div');
            grid.className = 'cosmetics-shop-grid';

            items.forEach(function(item) {
                var card = document.createElement('div');
                card.className = 'cosmetics-item-card';

                var nameEl = document.createElement('div');
                nameEl.className = 'cosmetics-item-name';
                nameEl.textContent = item.name || item.id;
                card.appendChild(nameEl);

                var badgeRow = document.createElement('div');
                badgeRow.className = 'cosmetics-item-badges';

                // Rarity badge
                var rarity = (item.rarity || 'common').toLowerCase();
                var rarityBadge = document.createElement('span');
                rarityBadge.className = 'badge-rarity-' + rarity;
                rarityBadge.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
                badgeRow.appendChild(rarityBadge);

                // Limited badge
                if (item.is_limited) {
                    var limitedBadge = document.createElement('span');
                    limitedBadge.className = 'badge-limited';
                    limitedBadge.textContent = item.limited_label || 'Limited';
                    badgeRow.appendChild(limitedBadge);
                }

                card.appendChild(badgeRow);

                var priceEl = document.createElement('div');
                priceEl.className = 'cosmetics-item-price';
                priceEl.textContent = '\uD83D\uDC8E ' + (item.gem_price !== undefined ? item.gem_price : '?');
                card.appendChild(priceEl);

                var buyBtn = document.createElement('button');
                var isOwned = Boolean(ownedIds[item.id]);

                if (isOwned) {
                    buyBtn.className = 'cosmetics-buy-btn owned';
                    buyBtn.textContent = '\u2713 Owned';
                    buyBtn.disabled = true;
                } else {
                    buyBtn.className = 'cosmetics-buy-btn';
                    buyBtn.textContent = 'Buy';
                    buyBtn.addEventListener('click', function() {
                        if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
                            if (typeof showToast === 'function') showToast('Please log in to purchase items.');
                            return;
                        }
                        var currentToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                        if (!currentToken) return;

                        buyBtn.disabled = true;
                        buyBtn.textContent = 'Buying\u2026';

                        fetch('/api/cosmetics/purchase', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentToken },
                            body: JSON.stringify({ itemId: item.id })
                        }).then(function(res) { return res.json(); }).then(function(data) {
                            if (data && data.success) {
                                buyBtn.className = 'cosmetics-buy-btn owned';
                                buyBtn.textContent = '\u2713 Owned';
                                buyBtn.disabled = true;
                                ownedIds[item.id] = { item_id: item.id, category: cat.key, equipped: false };
                                if (typeof showToast === 'function') showToast('Purchased! \uD83C\uDF89');
                            } else {
                                var errMsg = (data && data.error) ? data.error : 'Purchase failed.';
                                if (errMsg === 'already own') errMsg = 'Already owned';
                                if (errMsg === 'Not enough gems') errMsg = 'Need more gems \uD83D\uDC8E';
                                if (typeof showToast === 'function') showToast(errMsg);
                                buyBtn.disabled = false;
                                buyBtn.textContent = 'Buy';
                            }
                        }).catch(function() {
                            if (typeof showToast === 'function') showToast('Network error. Please try again.');
                            buyBtn.disabled = false;
                            buyBtn.textContent = 'Buy';
                        });
                    });
                }

                card.appendChild(buyBtn);
                grid.appendChild(card);
            });

            section.appendChild(grid);
            panel.appendChild(section);
        });

        if (!hasAny) {
            var emptyEl = document.createElement('div');
            emptyEl.className = 'cosmetics-empty';
            emptyEl.textContent = 'No items available in the shop right now.';
            panel.appendChild(emptyEl);
        }

    }).catch(function() {
        panel.textContent = '';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171;text-align:center;padding:24px;font-size:13px;';
        errDiv.textContent = 'Failed to load shop. Please try again later.';
        panel.appendChild(errDiv);
    });
}


// ── Cosmetics: load inventory ────────────────────────────

function _cosmeticsLoadInventory(panel) {
    panel.textContent = '';

    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
        var authMsg = document.createElement('div');
        authMsg.className = 'cosmetics-empty';
        authMsg.textContent = 'Please log in to view your inventory.';
        panel.appendChild(authMsg);
        return;
    }
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var spinner = document.createElement('div');
    spinner.className = 'profile-loading';
    var sp = document.createElement('div');
    sp.className = 'profile-spinner';
    spinner.appendChild(sp);
    panel.appendChild(spinner);

    // Fetch inventory + shop (for item names/details)
    var invPromise = fetch('/api/cosmetics/inventory', { headers: { 'Authorization': 'Bearer ' + token } }).then(function(r) { return r.json(); });
    var shopPromise = fetch('/api/cosmetics/shop').then(function(r) { return r.json(); });

    Promise.all([invPromise, shopPromise]).then(function(results) {
        var invData = results[0];
        var shopData = results[1];
        panel.textContent = '';

        var inventory = (invData && Array.isArray(invData.inventory)) ? invData.inventory : [];

        if (inventory.length === 0) {
            var emptyEl = document.createElement('div');
            emptyEl.className = 'cosmetics-empty';
            emptyEl.textContent = 'You don\'t own any cosmetics yet. Visit the Shop!';
            panel.appendChild(emptyEl);
            return;
        }

        // Build item detail lookup from shop data
        var itemDetails = {};
        var shop = (shopData && shopData.shop) ? shopData.shop : {};
        var allShopItems = [].concat(
            Array.isArray(shop.avatarFrames) ? shop.avatarFrames : [],
            Array.isArray(shop.cardThemes) ? shop.cardThemes : [],
            Array.isArray(shop.spinEffects) ? shop.spinEffects : []
        );
        allShopItems.forEach(function(it) { itemDetails[it.id] = it; });

        var grid = document.createElement('div');
        grid.className = 'cosmetics-shop-grid';

        inventory.forEach(function(owned) {
            var detail = itemDetails[owned.item_id] || {};
            var card = document.createElement('div');
            card.className = 'cosmetics-item-card';

            var nameEl = document.createElement('div');
            nameEl.className = 'cosmetics-item-name';
            nameEl.textContent = detail.name || owned.item_id;
            card.appendChild(nameEl);

            var catEl = document.createElement('div');
            catEl.style.cssText = 'font-size:11px;color:#94a3b8;';
            // Humanise category
            var catMap = { avatarFrames: 'Avatar Frame', cardThemes: 'Card Theme', spinEffects: 'Spin Effect' };
            catEl.textContent = catMap[owned.category] || owned.category || 'Item';
            card.appendChild(catEl);

            if (detail.rarity) {
                var rarity = detail.rarity.toLowerCase();
                var rarityBadge = document.createElement('span');
                rarityBadge.className = 'badge-rarity-' + rarity;
                rarityBadge.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
                card.appendChild(rarityBadge);
            }

            var equipBtn = document.createElement('button');
            if (owned.equipped) {
                equipBtn.className = 'cosmetics-equip-btn equipped';
                equipBtn.textContent = '\u2713 Equipped';
                equipBtn.disabled = true;
            } else {
                equipBtn.className = 'cosmetics-equip-btn';
                equipBtn.textContent = 'Equip';
                equipBtn.addEventListener('click', function() {
                    var currentToken = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                    if (!currentToken) return;

                    equipBtn.disabled = true;
                    equipBtn.textContent = 'Equipping\u2026';

                    fetch('/api/cosmetics/equip', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentToken },
                        body: JSON.stringify({ itemId: owned.item_id })
                    }).then(function(res) { return res.json(); }).then(function(data) {
                        if (data && data.success) {
                            // Mark previously equipped items in same category as unequipped in UI
                            grid.querySelectorAll('.cosmetics-equip-btn.equipped').forEach(function(b) {
                                b.className = 'cosmetics-equip-btn';
                                b.textContent = 'Equip';
                                b.disabled = false;
                            });
                            equipBtn.className = 'cosmetics-equip-btn equipped';
                            equipBtn.textContent = '\u2713 Equipped';
                            equipBtn.disabled = true;
                            owned.equipped = true;
                            if (typeof showToast === 'function') showToast('Equipped!');
                        } else {
                            var errMsg = (data && data.error) ? data.error : 'Equip failed.';
                            if (typeof showToast === 'function') showToast(errMsg);
                            equipBtn.disabled = false;
                            equipBtn.textContent = 'Equip';
                        }
                    }).catch(function() {
                        if (typeof showToast === 'function') showToast('Network error. Please try again.');
                        equipBtn.disabled = false;
                        equipBtn.textContent = 'Equip';
                    });
                });
            }

            card.appendChild(equipBtn);
            grid.appendChild(card);
        });

        panel.appendChild(grid);

    }).catch(function() {
        panel.textContent = '';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f87171;text-align:center;padding:24px;font-size:13px;';
        errDiv.textContent = 'Failed to load inventory. Please try again later.';
        panel.appendChild(errDiv);
    });
}


// ═══════════════════════════════════════════════════════
// ACHIEVEMENTS SECTION
// ═══════════════════════════════════════════════════════

function _renderAchievementsSection() {
    // Idempotency guard — remove stale section if switching back to this tab
    var existing = document.getElementById('achievementsSection');
    if (existing) existing.parentNode.removeChild(existing);

    // CSS injection (once per page load)
    if (!document.getElementById('achievements-section-css')) {
        var s = document.createElement('style');
        s.id = 'achievements-section-css';
        s.textContent = [
            '.ach-section { max-width:700px; }',
            '.ach-summary { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }',
            '.ach-summary-chip { background:#1e293b; border:1px solid #334155; border-radius:8px; padding:10px 16px; font-size:13px; color:#94a3b8; display:flex; flex-direction:column; align-items:center; min-width:120px; }',
            '.ach-summary-chip strong { font-size:18px; color:#e2e8f0; margin-bottom:2px; }',
            '.ach-list { display:flex; flex-direction:column; gap:10px; }',
            '.ach-card { background:#1e293b; border:1px solid #334155; border-radius:10px; padding:14px 16px; display:flex; gap:14px; align-items:flex-start; transition:opacity .2s; }',
            '.ach-card.locked { opacity:.55; }',
            '.ach-card-icon { font-size:28px; flex-shrink:0; line-height:1; padding-top:2px; }',
            '.ach-card-body { flex:1; min-width:0; }',
            '.ach-card-name { font-size:14px; font-weight:600; color:#e2e8f0; margin-bottom:2px; }',
            '.ach-card-desc { font-size:12px; color:#94a3b8; margin-bottom:8px; }',
            '.ach-progress-wrap { background:#0f172a; border-radius:4px; height:6px; overflow:hidden; margin-bottom:6px; }',
            '.ach-progress-fill { height:100%; background:linear-gradient(90deg,#6366f1,#a78bfa); border-radius:4px; transition:width .4s; }',
            '.ach-progress-label { font-size:11px; color:#64748b; }',
            '.ach-reward-label { font-size:12px; color:#94a3b8; margin-top:6px; }',
            '.ach-card-meta { flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:6px; font-size:12px; }',
            '.ach-unlocked-badge { color:#4ade80; font-weight:600; }',
            '.ach-unlock-date { color:#64748b; font-size:11px; }',
            '.ach-locked-badge { color:#64748b; }',
            '.ach-skeleton { background:#1e293b; border-radius:10px; height:76px; animation:achPulse 1.4s ease-in-out infinite; }',
            '@keyframes achPulse { 0%,100%{opacity:.5} 50%{opacity:1} }',
            '.ach-error { color:#f87171; text-align:center; padding:24px; font-size:13px; }',
            '.ach-empty { color:#94a3b8; text-align:center; padding:28px 0; font-size:13px; }'
        ].join('\n');
        document.head.appendChild(s);
    }

    var el = document.getElementById('profileContent');
    if (!el) return;
    el.textContent = '';

    // Section root
    var section = document.createElement('div');
    section.id = 'achievementsSection';
    section.className = 'ach-section';

    // Page header
    var pageHeader = document.createElement('h2');
    pageHeader.className = 'profile-section-title';
    pageHeader.textContent = 'Achievements';
    section.appendChild(pageHeader);

    el.appendChild(section);

    // Auth guard
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) {
        var authMsg = document.createElement('div');
        authMsg.className = 'ach-empty';
        authMsg.textContent = 'Please log in to view achievements.';
        section.appendChild(authMsg);
        return;
    }
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Loading skeleton (3 placeholder cards)
    var skeletonWrap = document.createElement('div');
    skeletonWrap.className = 'ach-list';
    skeletonWrap.id = 'achSkeletonWrap';
    for (var si = 0; si < 3; si++) {
        var sk = document.createElement('div');
        sk.className = 'ach-skeleton';
        skeletonWrap.appendChild(sk);
    }
    section.appendChild(skeletonWrap);

    fetch('/api/achievements/', {
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(res) { return res.json(); }).then(function(data) {
        // Remove skeleton
        var skEl = document.getElementById('achSkeletonWrap');
        if (skEl && skEl.parentNode) skEl.parentNode.removeChild(skEl);

        var achievements = data.achievements || [];
        var unlockedCount = typeof data.unlockedCount === 'number'
            ? data.unlockedCount
            : achievements.filter(function(a) { return a.isUnlocked; }).length;
        var gemsEarned    = typeof data.gemsEarned    === 'number' ? data.gemsEarned    : 0;
        var creditsEarned = typeof data.creditsEarned === 'number' ? data.creditsEarned : 0;

        // Summary chips
        var summary = document.createElement('div');
        summary.className = 'ach-summary';

        var chipUnlocked = document.createElement('div');
        chipUnlocked.className = 'ach-summary-chip';
        var chipUnlockedStrong = document.createElement('strong');
        chipUnlockedStrong.textContent = unlockedCount + ' / ' + achievements.length;
        chipUnlocked.appendChild(chipUnlockedStrong);
        chipUnlocked.appendChild(document.createTextNode('Unlocked'));
        summary.appendChild(chipUnlocked);

        if (gemsEarned > 0) {
            var chipGems = document.createElement('div');
            chipGems.className = 'ach-summary-chip';
            var chipGemsStrong = document.createElement('strong');
            chipGemsStrong.textContent = gemsEarned + ' \uD83D\uDC8E';
            chipGems.appendChild(chipGemsStrong);
            chipGems.appendChild(document.createTextNode('Gems Earned'));
            summary.appendChild(chipGems);
        }

        if (creditsEarned > 0) {
            var chipCredits = document.createElement('div');
            chipCredits.className = 'ach-summary-chip';
            var chipCreditsStrong = document.createElement('strong');
            chipCreditsStrong.textContent = '$' + (creditsEarned / 100).toFixed(2);
            chipCredits.appendChild(chipCreditsStrong);
            chipCredits.appendChild(document.createTextNode('Credits Earned'));
            summary.appendChild(chipCredits);
        }

        section.appendChild(summary);

        if (achievements.length === 0) {
            var emptyEl = document.createElement('div');
            emptyEl.className = 'ach-empty';
            emptyEl.textContent = 'No achievements available yet.';
            section.appendChild(emptyEl);
            return;
        }

        var list = document.createElement('div');
        list.className = 'ach-list';

        achievements.forEach(function(ach) {
            var card = document.createElement('div');
            card.className = ach.isUnlocked ? 'ach-card' : 'ach-card locked';

            // Icon
            var iconEl = document.createElement('div');
            iconEl.className = 'ach-card-icon';
            iconEl.textContent = ach.isUnlocked ? '\uD83C\uDFC5' : '\uD83D\uDD12';
            card.appendChild(iconEl);

            // Body: name, desc, progress, reward
            var body = document.createElement('div');
            body.className = 'ach-card-body';

            var nameEl = document.createElement('div');
            nameEl.className = 'ach-card-name';
            nameEl.textContent = ach.name || '';
            body.appendChild(nameEl);

            var descEl = document.createElement('div');
            descEl.className = 'ach-card-desc';
            descEl.textContent = ach.desc || '';
            body.appendChild(descEl);

            // Progress bar (shown for all — full for unlocked)
            var prog    = typeof ach.progress === 'number' ? ach.progress : 0;
            var tgt     = typeof ach.target   === 'number' && ach.target > 0 ? ach.target : 1;
            var pct     = Math.min(100, Math.round((prog / tgt) * 100));

            var progressWrap = document.createElement('div');
            progressWrap.className = 'ach-progress-wrap';
            var barFill = document.createElement('div');
            barFill.className = 'ach-progress-fill';
            barFill.style.width = pct + '%';
            progressWrap.appendChild(barFill);
            body.appendChild(progressWrap);

            var progLabel = document.createElement('div');
            progLabel.className = 'ach-progress-label';
            progLabel.textContent = prog + ' / ' + tgt;
            body.appendChild(progLabel);

            // Reward label
            if (ach.rewardType && ach.rewardAmount) {
                var rewardEl = document.createElement('div');
                rewardEl.className = 'ach-reward-label';
                var rewardIcon = ach.rewardType === 'gems' ? '\uD83D\uDC8E' : '\uD83D\uDCB0';
                var rewardValue = ach.rewardType === 'credits'
                    ? '$' + (Number(ach.rewardAmount) / 100).toFixed(2)
                    : ach.rewardAmount + ' gems';
                rewardEl.textContent = rewardIcon + ' ' + rewardValue;
                body.appendChild(rewardEl);
            }

            card.appendChild(body);

            // Right-side meta: unlock state
            var meta = document.createElement('div');
            meta.className = 'ach-card-meta';

            if (ach.isUnlocked) {
                var unlockedBadge = document.createElement('div');
                unlockedBadge.className = 'ach-unlocked-badge';
                unlockedBadge.textContent = '\u2705 Unlocked';
                meta.appendChild(unlockedBadge);

                if (ach.unlockedAt) {
                    var dateEl = document.createElement('div');
                    dateEl.className = 'ach-unlock-date';
                    try {
                        var d = new Date(ach.unlockedAt);
                        dateEl.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                    } catch (e) {
                        dateEl.textContent = String(ach.unlockedAt);
                    }
                    meta.appendChild(dateEl);
                }
            } else {
                var lockedBadge = document.createElement('div');
                lockedBadge.className = 'ach-locked-badge';
                lockedBadge.textContent = '\uD83D\uDD12 Locked';
                meta.appendChild(lockedBadge);
            }

            card.appendChild(meta);
            list.appendChild(card);
        });

        section.appendChild(list);

    }).catch(function() {
        // Remove skeleton on error
        var skElErr = document.getElementById('achSkeletonWrap');
        if (skElErr && skElErr.parentNode) skElErr.parentNode.removeChild(skElErr);

        var errDiv = document.createElement('div');
        errDiv.className = 'ach-error';
        errDiv.textContent = 'Failed to load achievements. Please try again later.';
        section.appendChild(errDiv);
    });
}


// ═══════════════════════════════════════════════════════
// TOWER CLIMB MINI-GAME
// ═══════════════════════════════════════════════════════

function renderTowerGameWidget() {
    return;
}


// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// CASINO WAR TAB + WIDGET
// ═══════════════════════════════════════════════════════

function renderCasinoWarTab() {
    return;
}

function renderCasinoWarCard() {
    // Idempotency guard
    if (document.getElementById('casinoWarCard')) return;

    // Auth gate
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // CSS injection with ID guard
    if (!document.getElementById('casino-war-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'casino-war-css';
        styleEl.textContent = [
            '.cw-widget { padding: 20px; max-width: 480px; margin: 0 auto; }',
            '.cw-title { font-size: 1.4em; font-weight: bold; color: #fff; margin-bottom: 16px; text-align: center; }',
            '.cw-controls { display: flex; gap: 8px; align-items: center; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }',
            '.cw-bet-label { color: #aaa; font-size: 0.9em; }',
            '.cw-bet-input { width: 80px; padding: 6px 8px; border-radius: 6px; border: 1px solid #555; background: #1a1a2e; color: #fff; font-size: 1em; text-align: center; }',
            '.cw-play-btn { padding: 8px 28px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; font-size: 1em; transition: opacity 0.15s; color: #fff; background: linear-gradient(135deg, #dc2626, #ef4444); }',
            '.cw-play-btn:hover { opacity: 0.85; }',
            '.cw-play-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
            '.cw-battlefield { display: flex; gap: 40px; justify-content: center; align-items: center; margin-bottom: 20px; min-height: 160px; }',
            '.cw-side { display: flex; flex-direction: column; align-items: center; gap: 8px; }',
            '.cw-side-label { color: #94a3b8; font-size: 0.85em; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }',
            '.cw-card { width: 80px; height: 112px; border-radius: 10px; background: #1e1e3a; border: 2px solid #444; display: flex; flex-direction: column; align-items: center; justify-content: center; user-select: none; transition: all 0.3s; }',
            '.cw-card.empty { border-style: dashed; border-color: #333; }',
            '.cw-card.win-glow { border-color: #4ade80; box-shadow: 0 0 16px rgba(74,222,128,0.5); }',
            '.cw-card.lose-dim { opacity: 0.5; }',
            '.cw-card-rank { font-size: 1.8em; font-weight: bold; line-height: 1; }',
            '.cw-card-suit { font-size: 1.5em; line-height: 1; margin-top: 4px; }',
            '.cw-card.red .cw-card-rank, .cw-card.red .cw-card-suit { color: #ef4444; }',
            '.cw-card.black .cw-card-rank, .cw-card.black .cw-card-suit { color: #e2e8f0; }',
            '.cw-vs { font-size: 1.6em; font-weight: bold; color: #555; }',
            '.cw-status { text-align: center; padding: 10px; font-size: 1.1em; font-weight: bold; min-height: 36px; }',
            '.cw-status.win { color: #4ade80; }',
            '.cw-status.lose { color: #f87171; }',
            '.cw-status.info { color: #88f; }',
            '.cw-status.war { color: #fbbf24; text-shadow: 0 0 8px rgba(251,191,36,0.4); }',
            '.cw-war-actions { display: flex; gap: 10px; justify-content: center; margin-bottom: 16px; }',
            '.cw-war-btn { padding: 8px 22px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; font-size: 1em; transition: opacity 0.15s; color: #fff; }',
            '.cw-war-btn:hover { opacity: 0.85; }',
            '.cw-war-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
            '.cw-war-btn.go { background: linear-gradient(135deg, #d97706, #f59e0b); }',
            '.cw-war-btn.surrender { background: linear-gradient(135deg, #64748b, #94a3b8); }',
            '.cw-war-cards { display: flex; gap: 40px; justify-content: center; align-items: center; margin-bottom: 16px; min-height: 0; overflow: hidden; transition: min-height 0.3s; }',
            '.cw-war-cards.visible { min-height: 140px; }',
            '.cw-war-side { display: flex; flex-direction: column; align-items: center; gap: 6px; }',
            '.cw-war-side-label { color: #fbbf24; font-size: 0.75em; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }'
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    var el = document.getElementById('profileContent');
    if (!el) return;
    el.textContent = '';

    // ── Game state ──
    var cwState = {
        phase: 'idle',  // 'idle' | 'playing' | 'tie' | 'war' | 'done'
        bet: 1.00,
        playerCard: null,
        dealerCard: null,
        playerWarCard: null,
        dealerWarCard: null
    };

    // ── Helpers ──
    function isRedSuit(suit) {
        return suit === '\u2665' || suit === '\u2666';
    }

    function buildCardEl(card, extraClass) {
        var cardEl = document.createElement('div');
        var classes = 'cw-card';
        if (!card) {
            classes += ' empty';
            cardEl.className = classes;
            return cardEl;
        }
        if (isRedSuit(card.suit)) {
            classes += ' red';
        } else {
            classes += ' black';
        }
        if (extraClass) classes += ' ' + extraClass;
        cardEl.className = classes;

        var rankEl = document.createElement('div');
        rankEl.className = 'cw-card-rank';
        rankEl.textContent = card.rank;
        cardEl.appendChild(rankEl);

        var suitEl = document.createElement('div');
        suitEl.className = 'cw-card-suit';
        suitEl.textContent = card.suit;
        cardEl.appendChild(suitEl);

        return cardEl;
    }

    // ── Container ──
    var widget = document.createElement('div');
    widget.id = 'casinoWarCard';
    widget.className = 'cw-widget';

    // ── Title ──
    var title = document.createElement('div');
    title.className = 'cw-title';
    title.textContent = '\u2694\uFE0F Casino War';
    widget.appendChild(title);

    // ── Controls ──
    var controlsRow = document.createElement('div');
    controlsRow.className = 'cw-controls';

    var betLabel = document.createElement('span');
    betLabel.className = 'cw-bet-label';
    betLabel.textContent = 'Bet $';
    controlsRow.appendChild(betLabel);

    var betInput = document.createElement('input');
    betInput.type = 'number';
    betInput.className = 'cw-bet-input';
    betInput.min = '0.25';
    betInput.step = '0.25';
    betInput.value = '1.00';
    controlsRow.appendChild(betInput);

    var playBtn = document.createElement('button');
    playBtn.className = 'cw-play-btn';
    playBtn.textContent = 'PLAY';
    playBtn.addEventListener('click', doPlay);
    controlsRow.appendChild(playBtn);

    widget.appendChild(controlsRow);

    // ── Battlefield (player card vs dealer card) ──
    var battlefield = document.createElement('div');
    battlefield.className = 'cw-battlefield';

    var playerSide = document.createElement('div');
    playerSide.className = 'cw-side';
    var playerLabel = document.createElement('div');
    playerLabel.className = 'cw-side-label';
    playerLabel.textContent = 'You';
    playerSide.appendChild(playerLabel);
    var playerCardSlot = document.createElement('div');
    playerCardSlot.className = 'cw-card empty';
    playerSide.appendChild(playerCardSlot);
    battlefield.appendChild(playerSide);

    var vsEl = document.createElement('div');
    vsEl.className = 'cw-vs';
    vsEl.textContent = 'VS';
    battlefield.appendChild(vsEl);

    var dealerSide = document.createElement('div');
    dealerSide.className = 'cw-side';
    var dealerLabel = document.createElement('div');
    dealerLabel.className = 'cw-side-label';
    dealerLabel.textContent = 'Dealer';
    dealerSide.appendChild(dealerLabel);
    var dealerCardSlot = document.createElement('div');
    dealerCardSlot.className = 'cw-card empty';
    dealerSide.appendChild(dealerCardSlot);
    battlefield.appendChild(dealerSide);

    widget.appendChild(battlefield);

    // ── War action buttons (hidden initially) ──
    var warActions = document.createElement('div');
    warActions.className = 'cw-war-actions';
    warActions.style.display = 'none';

    var goWarBtn = document.createElement('button');
    goWarBtn.className = 'cw-war-btn go';
    goWarBtn.textContent = 'Go to War';
    goWarBtn.addEventListener('click', doWar);
    warActions.appendChild(goWarBtn);

    var surrenderBtn = document.createElement('button');
    surrenderBtn.className = 'cw-war-btn surrender';
    surrenderBtn.textContent = 'Surrender';
    surrenderBtn.addEventListener('click', doSurrender);
    warActions.appendChild(surrenderBtn);

    widget.appendChild(warActions);

    // ── War cards area (hidden initially) ──
    var warCardsArea = document.createElement('div');
    warCardsArea.className = 'cw-war-cards';

    var warPlayerSide = document.createElement('div');
    warPlayerSide.className = 'cw-war-side';
    var warPlayerLabel = document.createElement('div');
    warPlayerLabel.className = 'cw-war-side-label';
    warPlayerLabel.textContent = 'Your War Card';
    warPlayerSide.appendChild(warPlayerLabel);
    var warPlayerCardSlot = document.createElement('div');
    warPlayerCardSlot.className = 'cw-card empty';
    warPlayerSide.appendChild(warPlayerCardSlot);
    warCardsArea.appendChild(warPlayerSide);

    var warVsEl = document.createElement('div');
    warVsEl.className = 'cw-vs';
    warVsEl.textContent = 'VS';
    warCardsArea.appendChild(warVsEl);

    var warDealerSide = document.createElement('div');
    warDealerSide.className = 'cw-war-side';
    var warDealerLabel = document.createElement('div');
    warDealerLabel.className = 'cw-war-side-label';
    warDealerLabel.textContent = 'Dealer War Card';
    warDealerSide.appendChild(warDealerLabel);
    var warDealerCardSlot = document.createElement('div');
    warDealerCardSlot.className = 'cw-card empty';
    warDealerSide.appendChild(warDealerCardSlot);
    warCardsArea.appendChild(warDealerSide);

    widget.appendChild(warCardsArea);

    // ── Status ──
    var statusEl = document.createElement('div');
    statusEl.className = 'cw-status info';
    statusEl.textContent = 'Place your bet and press PLAY to start.';
    widget.appendChild(statusEl);

    el.appendChild(widget);

    // ── UI update helpers ──
    function setStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'cw-status ' + (type || 'info');
    }

    function renderMainCards(pCard, dCard, result) {
        // Replace player card slot
        var pClass = '';
        var dClass = '';
        if (result === 'win') { pClass = 'win-glow'; dClass = 'lose-dim'; }
        else if (result === 'lose') { pClass = 'lose-dim'; dClass = 'win-glow'; }

        var newPlayerCard = buildCardEl(pCard, pClass);
        playerSide.replaceChild(newPlayerCard, playerSide.lastChild);

        var newDealerCard = buildCardEl(dCard, dClass);
        dealerSide.replaceChild(newDealerCard, dealerSide.lastChild);
    }

    function renderWarCards(pwCard, dwCard, result) {
        warCardsArea.className = 'cw-war-cards visible';

        var pClass = '';
        var dClass = '';
        if (result === 'win') { pClass = 'win-glow'; dClass = 'lose-dim'; }
        else if (result === 'lose') { pClass = 'lose-dim'; dClass = 'win-glow'; }

        var newWPCard = buildCardEl(pwCard, pClass);
        warPlayerSide.replaceChild(newWPCard, warPlayerSide.lastChild);

        var newWDCard = buildCardEl(dwCard, dClass);
        warDealerSide.replaceChild(newWDCard, warDealerSide.lastChild);
    }

    function resetUI() {
        cwState.phase = 'idle';
        cwState.playerCard = null;
        cwState.dealerCard = null;
        cwState.playerWarCard = null;
        cwState.dealerWarCard = null;

        // Reset main cards to empty
        var emptyP = buildCardEl(null);
        playerSide.replaceChild(emptyP, playerSide.lastChild);
        var emptyD = buildCardEl(null);
        dealerSide.replaceChild(emptyD, dealerSide.lastChild);

        // Hide war area
        warCardsArea.className = 'cw-war-cards';
        var emptyWP = buildCardEl(null);
        warPlayerSide.replaceChild(emptyWP, warPlayerSide.lastChild);
        var emptyWD = buildCardEl(null);
        warDealerSide.replaceChild(emptyWD, warDealerSide.lastChild);

        warActions.style.display = 'none';
        playBtn.textContent = 'PLAY';
        playBtn.disabled = false;
        setStatus('Place your bet and press PLAY to start.', 'info');
    }

    function lockPlay(locked) {
        playBtn.disabled = locked;
        betInput.disabled = locked;
    }

    // ── PLAY ──
    function doPlay() {
        if (cwState.phase === 'done') {
            resetUI();
            return;
        }
        if (cwState.phase !== 'idle') return;

        var betVal = parseFloat(betInput.value);
        if (isNaN(betVal) || betVal < 0.25) {
            setStatus('Minimum bet is $0.25', 'lose');
            return;
        }
        cwState.bet = betVal;

        lockPlay(true);
        setStatus('Dealing...', 'info');

        fetch('/api/casinowar/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ bet: betVal })
        }).then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
        .then(function(result) {
            if (!result.ok) {
                setStatus(result.data.error || 'Failed to play', 'lose');
                lockPlay(false);
                return;
            }
            var d = result.data;
            cwState.playerCard = d.playerCard;
            cwState.dealerCard = d.dealerCard;

            if (d.result === 'win') {
                cwState.phase = 'done';
                renderMainCards(d.playerCard, d.dealerCard, 'win');
                var payoutStr = typeof formatMoney === 'function' ? formatMoney(d.payout) : d.payout.toFixed(2);
                setStatus('You win! Higher card! +$' + payoutStr, 'win');
                if (typeof updateBalanceDisplay === 'function' && d.newBalance !== undefined) {
                    updateBalanceDisplay(d.newBalance);
                }
                playBtn.textContent = 'PLAY AGAIN';
                playBtn.disabled = false;
            } else if (d.result === 'lose') {
                cwState.phase = 'done';
                renderMainCards(d.playerCard, d.dealerCard, 'lose');
                setStatus('Dealer wins!', 'lose');
                if (typeof updateBalanceDisplay === 'function' && d.newBalance !== undefined) {
                    updateBalanceDisplay(d.newBalance);
                }
                playBtn.textContent = 'PLAY AGAIN';
                playBtn.disabled = false;
            } else if (d.result === 'tie') {
                cwState.phase = 'tie';
                renderMainCards(d.playerCard, d.dealerCard, null);
                setStatus('WAR! Cards are tied! Go to War or Surrender?', 'war');
                warActions.style.display = 'flex';
                if (typeof updateBalanceDisplay === 'function' && d.newBalance !== undefined) {
                    updateBalanceDisplay(d.newBalance);
                }
            }
        }).catch(function() {
            setStatus('Network error. Try again.', 'lose');
            lockPlay(false);
        });
    }

    // ── GO TO WAR ──
    function doWar() {
        if (cwState.phase !== 'tie') return;

        warActions.style.display = 'none';
        setStatus('Going to war...', 'info');
        goWarBtn.disabled = true;
        surrenderBtn.disabled = true;

        fetch('/api/casinowar/war', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ bet: cwState.bet, warBet: cwState.bet })
        }).then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
        .then(function(result) {
            if (!result.ok) {
                setStatus(result.data.error || 'War failed', 'lose');
                goWarBtn.disabled = false;
                surrenderBtn.disabled = false;
                warActions.style.display = 'flex';
                return;
            }
            var d = result.data;
            cwState.phase = 'done';
            cwState.playerWarCard = d.playerWarCard;
            cwState.dealerWarCard = d.dealerWarCard;

            renderWarCards(d.playerWarCard, d.dealerWarCard, d.result);

            if (d.result === 'win') {
                var payoutStr = typeof formatMoney === 'function' ? formatMoney(d.payout) : d.payout.toFixed(2);
                setStatus('You won the war! +$' + payoutStr, 'win');
            } else {
                setStatus('Dealer wins the war!', 'lose');
            }

            if (typeof updateBalanceDisplay === 'function' && d.newBalance !== undefined) {
                updateBalanceDisplay(d.newBalance);
            }

            playBtn.textContent = 'PLAY AGAIN';
            playBtn.disabled = false;
            goWarBtn.disabled = false;
            surrenderBtn.disabled = false;
        }).catch(function() {
            setStatus('Network error. Try again.', 'lose');
            goWarBtn.disabled = false;
            surrenderBtn.disabled = false;
            warActions.style.display = 'flex';
        });
    }

    // ── SURRENDER ──
    function doSurrender() {
        if (cwState.phase !== 'tie') return;

        cwState.phase = 'done';
        warActions.style.display = 'none';

        // Surrender loses half the bet
        var lostHalf = cwState.bet / 2;
        var lostStr = typeof formatMoney === 'function' ? formatMoney(lostHalf) : lostHalf.toFixed(2);
        setStatus('Surrendered. You lose $' + lostStr + '.', 'lose');

        playBtn.textContent = 'PLAY AGAIN';
        playBtn.disabled = false;
    }
}
// LET IT RIDE TAB
// ═══════════════════════════════════════════════════════

function renderLetItRideTab() {
    return;
}

function renderLetItRideWidget() {
    return;

}


// ═══════════════════════════════════════════════════════
//  COMEBACK BONUS TAB & WIDGET
// ═══════════════════════════════════════════════════════

function renderComebackBonusTab() {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var profileContent = document.querySelector('.profile-tab-content') || document.querySelector('.profile-content');
    if (!profileContent) return;

    // Inject CSS once
    if (!document.getElementById('comebackBonusTabCSS')) {
        var style = document.createElement('style');
        style.id = 'comebackBonusTabCSS';
        style.textContent = [
            '.comeback-tab-wrap { max-width: 620px; margin: 0 auto; padding: 20px; font-family: inherit; }',
            '.comeback-header { text-align: center; margin-bottom: 24px; }',
            '.comeback-header h2 { font-size: 1.6em; margin: 0 0 6px 0; color: #f5c842; }',
            '.comeback-header p { color: #bbb; margin: 0; font-size: 0.95em; }',
            '.comeback-status-card { background: linear-gradient(135deg, #2a1f00 0%, #1a1200 100%); border: 1px solid #f5c84233; border-radius: 14px; padding: 28px; margin-bottom: 22px; text-align: center; position: relative; overflow: hidden; }',
            '.comeback-status-card::before { content: ""; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle at center, rgba(245,200,66,0.04) 0%, transparent 70%); pointer-events: none; }',
            '.comeback-tier-badge { display: inline-block; font-size: 2.2em; margin-bottom: 10px; }',
            '.comeback-tier-label { font-size: 1.15em; font-weight: 700; margin-bottom: 6px; }',
            '.comeback-tier-gold .comeback-tier-label { color: #ffd700; }',
            '.comeback-tier-silver .comeback-tier-label { color: #c0c0c0; }',
            '.comeback-tier-bronze .comeback-tier-label { color: #cd7f32; }',
            '.comeback-status-card.comeback-tier-gold { border-color: #ffd70066; }',
            '.comeback-status-card.comeback-tier-silver { border-color: #c0c0c066; }',
            '.comeback-status-card.comeback-tier-bronze { border-color: #cd7f3266; }',
            '.comeback-amount { font-size: 2em; font-weight: 800; color: #f5c842; margin: 10px 0; }',
            '.comeback-amount-label { font-size: 0.85em; color: #999; margin-bottom: 14px; }',
            '.comeback-claim-btn { background: linear-gradient(135deg, #f5c842, #d4a017); color: #1a1200; border: none; padding: 14px 44px; border-radius: 10px; font-size: 1.1em; font-weight: 700; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 1px; }',
            '.comeback-claim-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(245,200,66,0.4); }',
            '.comeback-claim-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }',
            '.comeback-claim-btn.claimed { background: linear-gradient(135deg, #2d8c3e, #1a6b2a); color: #fff; }',
            '.comeback-not-eligible { background: #1a1a2e; border: 1px solid #333; border-radius: 14px; padding: 30px; text-align: center; }',
            '.comeback-not-eligible-icon { font-size: 2.5em; margin-bottom: 12px; }',
            '.comeback-not-eligible h3 { color: #ddd; margin: 0 0 8px 0; font-size: 1.15em; }',
            '.comeback-not-eligible p { color: #888; margin: 0; font-size: 0.9em; }',
            '.comeback-wagering-info { background: #111827; border: 1px solid #374151; border-radius: 10px; padding: 16px; margin-top: 18px; text-align: center; }',
            '.comeback-wagering-info span { color: #f59e0b; font-weight: 600; }',
            '.comeback-wagering-info p { color: #9ca3af; margin: 4px 0 0 0; font-size: 0.85em; }',
            '.comeback-tier-table { width: 100%; border-collapse: collapse; margin-top: 22px; border-radius: 10px; overflow: hidden; }',
            '.comeback-tier-table th { background: #1f2937; color: #d1d5db; padding: 10px 14px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }',
            '.comeback-tier-table td { padding: 10px 14px; border-bottom: 1px solid #1f2937; color: #ccc; font-size: 0.9em; }',
            '.comeback-tier-table tr:last-child td { border-bottom: none; }',
            '.comeback-tier-table tr:nth-child(even) { background: #0d111b; }',
            '.comeback-tier-table tr:nth-child(odd) { background: #111827; }',
            '.comeback-tier-icon { margin-right: 6px; }',
            '.comeback-loading { text-align: center; padding: 40px; color: #888; }',
            '.comeback-loading-spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid #333; border-top-color: #f5c842; border-radius: 50%; animation: comebackSpin 0.8s linear infinite; margin-bottom: 10px; }',
            '@keyframes comebackSpin { to { transform: rotate(360deg); } }',
            '.comeback-error { background: #2d1111; border: 1px solid #7f1d1d; border-radius: 10px; padding: 16px; text-align: center; color: #fca5a5; margin-top: 12px; }',
            '.comeback-cooldown { color: #f59e0b; font-size: 0.9em; margin-top: 8px; }',
            '.comeback-section-title { color: #d1d5db; font-size: 1em; font-weight: 600; margin: 24px 0 10px 0; }',
        ].join('\n');
        document.head.appendChild(style);
    }

    // Clear content
    profileContent.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'comeback-tab-wrap';

    // Header
    var header = document.createElement('div');
    header.className = 'comeback-header';
    var h2 = document.createElement('h2');
    h2.textContent = '\uD83D\uDD04 Comeback Bonus';
    header.appendChild(h2);
    var subtitle = document.createElement('p');
    subtitle.textContent = 'Had a tough session? We\'ve got your back with a comeback bonus.';
    header.appendChild(subtitle);
    wrap.appendChild(header);

    // Loading state
    var loadingDiv = document.createElement('div');
    loadingDiv.className = 'comeback-loading';
    var spinner = document.createElement('div');
    spinner.className = 'comeback-loading-spinner';
    loadingDiv.appendChild(spinner);
    var loadText = document.createElement('div');
    loadText.textContent = 'Checking eligibility...';
    loadingDiv.appendChild(loadText);
    wrap.appendChild(loadingDiv);

    // Container for dynamic content
    var dynamicContainer = document.createElement('div');
    dynamicContainer.id = 'comebackDynamicContent';
    wrap.appendChild(dynamicContainer);

    // Tier breakdown table (always shown)
    var tableTitle = document.createElement('div');
    tableTitle.className = 'comeback-section-title';
    tableTitle.textContent = 'Tier Breakdown';
    wrap.appendChild(tableTitle);

    var table = document.createElement('table');
    table.className = 'comeback-tier-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var thTier = document.createElement('th');
    thTier.textContent = 'Tier';
    headerRow.appendChild(thTier);
    var thLoss = document.createElement('th');
    thLoss.textContent = 'Min Session Loss';
    headerRow.appendChild(thLoss);
    var thPct = document.createElement('th');
    thPct.textContent = 'Bonus %';
    headerRow.appendChild(thPct);
    var thRange = document.createElement('th');
    thRange.textContent = 'Bonus Range';
    headerRow.appendChild(thRange);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var tiers = [
        { icon: '\uD83E\uDD47', name: 'Gold', loss: '$500+', pct: '10%', range: '$25 \u2013 $100' },
        { icon: '\uD83E\uDD48', name: 'Silver', loss: '$200+', pct: '8%', range: '$10 \u2013 $50' },
        { icon: '\uD83E\uDD49', name: 'Bronze', loss: '$50+', pct: '5%', range: '$2.50 \u2013 $25' }
    ];
    for (var t = 0; t < tiers.length; t++) {
        var tr = document.createElement('tr');
        var tdTier = document.createElement('td');
        var tierIconSpan = document.createElement('span');
        tierIconSpan.className = 'comeback-tier-icon';
        tierIconSpan.textContent = tiers[t].icon;
        tdTier.appendChild(tierIconSpan);
        var tierNameSpan = document.createElement('span');
        tierNameSpan.textContent = tiers[t].name;
        tdTier.appendChild(tierNameSpan);
        tr.appendChild(tdTier);

        var tdLoss = document.createElement('td');
        tdLoss.textContent = tiers[t].loss;
        tr.appendChild(tdLoss);

        var tdPct = document.createElement('td');
        tdPct.textContent = tiers[t].pct;
        tr.appendChild(tdPct);

        var tdRange = document.createElement('td');
        tdRange.textContent = tiers[t].range;
        tr.appendChild(tdRange);

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    profileContent.appendChild(wrap);

    // Fetch eligibility
    fetch('/api/user/comeback-bonus', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        loadingDiv.style.display = 'none';
        _renderComebackResult(dynamicContainer, data, token);
    })
    .catch(function(err) {
        loadingDiv.style.display = 'none';
        var errDiv = document.createElement('div');
        errDiv.className = 'comeback-error';
        errDiv.textContent = 'Could not check eligibility. Please try again later.';
        dynamicContainer.appendChild(errDiv);
        console.warn('Comeback bonus eligibility check failed:', err);
    });
}

function _renderComebackResult(container, data, token) {
    container.innerHTML = '';

    var fmtMoney = function(x) {
        return typeof formatMoney === 'function' ? formatMoney(x) : '$' + x.toFixed(2);
    };

    if (data.eligible) {
        var tierMap = {
            gold:   { icon: '\uD83E\uDD47', cls: 'comeback-tier-gold',   label: 'Gold Tier' },
            silver: { icon: '\uD83E\uDD48', cls: 'comeback-tier-silver', label: 'Silver Tier' },
            bronze: { icon: '\uD83E\uDD49', cls: 'comeback-tier-bronze', label: 'Bronze Tier' }
        };
        var tierInfo = tierMap[data.tier] || tierMap.bronze;

        var card = document.createElement('div');
        card.className = 'comeback-status-card ' + tierInfo.cls;

        var badgeDiv = document.createElement('div');
        badgeDiv.className = 'comeback-tier-badge';
        badgeDiv.textContent = tierInfo.icon;
        card.appendChild(badgeDiv);

        var tierLabel = document.createElement('div');
        tierLabel.className = 'comeback-tier-label';
        tierLabel.textContent = tierInfo.label;
        card.appendChild(tierLabel);

        var amountLabel = document.createElement('div');
        amountLabel.className = 'comeback-amount-label';
        amountLabel.textContent = 'Comeback Bonus Available';
        card.appendChild(amountLabel);

        var amountDiv = document.createElement('div');
        amountDiv.className = 'comeback-amount';
        amountDiv.textContent = fmtMoney(data.amount);
        card.appendChild(amountDiv);

        var claimBtn = document.createElement('button');
        claimBtn.className = 'comeback-claim-btn';
        claimBtn.textContent = 'CLAIM BONUS';
        claimBtn.id = 'comebackClaimBtn';

        var claimFeedback = document.createElement('div');
        claimFeedback.id = 'comebackClaimFeedback';

        claimBtn.addEventListener('click', function() {
            claimBtn.disabled = true;
            claimBtn.textContent = 'CLAIMING...';
            _claimComebackBonus(token, claimBtn, claimFeedback, card, fmtMoney);
        });

        card.appendChild(claimBtn);
        card.appendChild(claimFeedback);

        if (data.message) {
            var msgDiv = document.createElement('div');
            msgDiv.className = 'comeback-cooldown';
            msgDiv.textContent = data.message;
            card.appendChild(msgDiv);
        }

        container.appendChild(card);
    } else {
        var notEligible = document.createElement('div');
        notEligible.className = 'comeback-not-eligible';

        var neIcon = document.createElement('div');
        neIcon.className = 'comeback-not-eligible-icon';
        neIcon.textContent = '\uD83D\uDCAA';
        notEligible.appendChild(neIcon);

        var neTitle = document.createElement('h3');
        neTitle.textContent = 'No Comeback Bonus Available';
        notEligible.appendChild(neTitle);

        var neMsg = document.createElement('p');
        neMsg.textContent = data.message || 'Keep playing \u2014 you may qualify soon!';
        notEligible.appendChild(neMsg);

        container.appendChild(notEligible);
    }
}

function _claimComebackBonus(token, btn, feedbackEl, card, fmtMoney) {
    fetch('/api/user/claim-comeback-bonus', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success) {
            btn.textContent = '\u2714 CLAIMED';
            btn.className = 'comeback-claim-btn claimed';
            btn.disabled = true;

            if (typeof updateBalanceDisplay === 'function' && data.balance != null) {
                updateBalanceDisplay(data.balance);
            }

            feedbackEl.innerHTML = '';
            var wagerInfo = document.createElement('div');
            wagerInfo.className = 'comeback-wagering-info';

            var wagerTitle = document.createElement('div');
            var wagerSpan = document.createElement('span');
            wagerSpan.textContent = fmtMoney(data.bonusAmount) + ' added to bonus balance!';
            wagerTitle.appendChild(wagerSpan);
            wagerInfo.appendChild(wagerTitle);

            var wagerDetail = document.createElement('p');
            var wagerReq = data.wageringRequired || 10;
            wagerDetail.textContent = 'Wagering requirement: ' + wagerReq + 'x playthrough (' + fmtMoney(data.bonusAmount * wagerReq) + ' total wager needed)';
            wagerInfo.appendChild(wagerDetail);

            if (data.tier) {
                var tierNote = document.createElement('p');
                var tierNames = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
                tierNote.textContent = 'Tier: ' + (tierNames[data.tier] || data.tier);
                tierNote.style.marginTop = '6px';
                tierNote.style.color = '#d1d5db';
                wagerInfo.appendChild(tierNote);
            }

            feedbackEl.appendChild(wagerInfo);
        } else {
            btn.textContent = 'CLAIM BONUS';
            btn.disabled = false;
            var errDiv = document.createElement('div');
            errDiv.className = 'comeback-error';
            errDiv.textContent = data.error || data.message || 'Could not claim bonus. Please try again.';
            feedbackEl.innerHTML = '';
            feedbackEl.appendChild(errDiv);
        }
    })
    .catch(function(err) {
        btn.textContent = 'CLAIM BONUS';
        btn.disabled = false;
        var errDiv = document.createElement('div');
        errDiv.className = 'comeback-error';
        errDiv.textContent = 'Network error. Please try again later.';
        feedbackEl.innerHTML = '';
        feedbackEl.appendChild(errDiv);
        console.warn('Comeback bonus claim failed:', err);
    });
}


// ═══════════════════════════════════════════════════════
//  COMEBACK BONUS WIDGET (embeddable elsewhere)
// ═══════════════════════════════════════════════════════

function renderComebackBonusWidget() {
    if (document.getElementById('comebackBonusWidget')) return;
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    // Inject widget CSS once
    if (!document.getElementById('comebackWidgetCSS')) {
        var style = document.createElement('style');
        style.id = 'comebackWidgetCSS';
        style.textContent = [
            '.comeback-widget { background: linear-gradient(135deg, #2a1f00 0%, #1a1200 100%); border: 1px solid #f5c84233; border-radius: 12px; padding: 18px; margin: 12px 0; position: relative; overflow: hidden; }',
            '.comeback-widget::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(ellipse at top right, rgba(245,200,66,0.06) 0%, transparent 70%); pointer-events: none; }',
            '.comeback-widget-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; position: relative; }',
            '.comeback-widget-icon { font-size: 1.5em; }',
            '.comeback-widget-title { font-size: 1.05em; font-weight: 700; color: #f5c842; }',
            '.comeback-widget-body { position: relative; }',
            '.comeback-widget-amount { font-size: 1.6em; font-weight: 800; color: #f5c842; text-align: center; margin: 8px 0; }',
            '.comeback-widget-tier { text-align: center; margin-bottom: 10px; font-size: 0.9em; color: #bbb; }',
            '.comeback-widget-claim { display: block; width: 100%; background: linear-gradient(135deg, #f5c842, #d4a017); color: #1a1200; border: none; padding: 11px 0; border-radius: 8px; font-size: 1em; font-weight: 700; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.5px; }',
            '.comeback-widget-claim:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(245,200,66,0.35); }',
            '.comeback-widget-claim:disabled { opacity: 0.4; cursor: not-allowed; }',
            '.comeback-widget-claim.claimed { background: linear-gradient(135deg, #2d8c3e, #1a6b2a); color: #fff; }',
            '.comeback-widget-msg { text-align: center; color: #888; font-size: 0.85em; margin-top: 6px; }',
            '.comeback-widget-wager { background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 10px; margin-top: 10px; text-align: center; font-size: 0.82em; color: #9ca3af; }',
            '.comeback-widget-wager strong { color: #f59e0b; }',
            '.comeback-widget-loading { text-align: center; padding: 16px; color: #888; font-size: 0.9em; }',
            '.comeback-widget-error { color: #fca5a5; text-align: center; font-size: 0.85em; padding: 8px; }',
        ].join('\n');
        document.head.appendChild(style);
    }

    var widget = document.createElement('div');
    widget.className = 'comeback-widget';
    widget.id = 'comebackBonusWidget';

    var widgetHeader = document.createElement('div');
    widgetHeader.className = 'comeback-widget-header';
    var wIcon = document.createElement('span');
    wIcon.className = 'comeback-widget-icon';
    wIcon.textContent = '\uD83D\uDD04';
    widgetHeader.appendChild(wIcon);
    var wTitle = document.createElement('span');
    wTitle.className = 'comeback-widget-title';
    wTitle.textContent = 'Comeback Bonus';
    widgetHeader.appendChild(wTitle);
    widget.appendChild(widgetHeader);

    var widgetBody = document.createElement('div');
    widgetBody.className = 'comeback-widget-body';

    var loadingEl = document.createElement('div');
    loadingEl.className = 'comeback-widget-loading';
    loadingEl.textContent = 'Checking...';
    widgetBody.appendChild(loadingEl);

    widget.appendChild(widgetBody);

    var fmtMoney = function(x) {
        return typeof formatMoney === 'function' ? formatMoney(x) : '$' + x.toFixed(2);
    };

    fetch('/api/user/comeback-bonus', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        widgetBody.innerHTML = '';

        if (data.eligible) {
            var tierIcons = { gold: '\uD83E\uDD47', silver: '\uD83E\uDD48', bronze: '\uD83E\uDD49' };
            var tierNames = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

            var tierDiv = document.createElement('div');
            tierDiv.className = 'comeback-widget-tier';
            tierDiv.textContent = (tierIcons[data.tier] || '') + ' ' + (tierNames[data.tier] || 'Bonus') + ' Tier';
            widgetBody.appendChild(tierDiv);

            var amountDiv = document.createElement('div');
            amountDiv.className = 'comeback-widget-amount';
            amountDiv.textContent = fmtMoney(data.amount);
            widgetBody.appendChild(amountDiv);

            var claimBtn = document.createElement('button');
            claimBtn.className = 'comeback-widget-claim';
            claimBtn.textContent = 'CLAIM';

            var feedbackDiv = document.createElement('div');
            feedbackDiv.id = 'comebackWidgetFeedback';

            claimBtn.addEventListener('click', function() {
                claimBtn.disabled = true;
                claimBtn.textContent = 'CLAIMING...';

                fetch('/api/user/claim-comeback-bonus', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                })
                .then(function(res) { return res.json(); })
                .then(function(claimData) {
                    if (claimData.success) {
                        claimBtn.textContent = '\u2714 CLAIMED';
                        claimBtn.className = 'comeback-widget-claim claimed';
                        claimBtn.disabled = true;

                        if (typeof updateBalanceDisplay === 'function' && claimData.balance != null) {
                            updateBalanceDisplay(claimData.balance);
                        }

                        feedbackDiv.innerHTML = '';
                        var wagerBox = document.createElement('div');
                        wagerBox.className = 'comeback-widget-wager';
                        var strongEl = document.createElement('strong');
                        strongEl.textContent = fmtMoney(claimData.bonusAmount);
                        wagerBox.appendChild(strongEl);
                        var wagerText = document.createTextNode(' added! ' + (claimData.wageringRequired || 10) + 'x playthrough required.');
                        wagerBox.appendChild(wagerText);
                        feedbackDiv.appendChild(wagerBox);
                    } else {
                        claimBtn.textContent = 'CLAIM';
                        claimBtn.disabled = false;
                        feedbackDiv.innerHTML = '';
                        var errEl = document.createElement('div');
                        errEl.className = 'comeback-widget-error';
                        errEl.textContent = claimData.error || claimData.message || 'Could not claim.';
                        feedbackDiv.appendChild(errEl);
                    }
                })
                .catch(function() {
                    claimBtn.textContent = 'CLAIM';
                    claimBtn.disabled = false;
                    feedbackDiv.innerHTML = '';
                    var errEl = document.createElement('div');
                    errEl.className = 'comeback-widget-error';
                    errEl.textContent = 'Network error.';
                    feedbackDiv.appendChild(errEl);
                });
            });

            widgetBody.appendChild(claimBtn);
            widgetBody.appendChild(feedbackDiv);

            if (data.message) {
                var msgEl = document.createElement('div');
                msgEl.className = 'comeback-widget-msg';
                msgEl.textContent = data.message;
                widgetBody.appendChild(msgEl);
            }
        } else {
            var noEligible = document.createElement('div');
            noEligible.className = 'comeback-widget-msg';
            noEligible.textContent = data.message || 'Keep playing \u2014 you may qualify soon!';
            widgetBody.appendChild(noEligible);
        }
    })
    .catch(function() {
        widgetBody.innerHTML = '';
        var errEl = document.createElement('div');
        errEl.className = 'comeback-widget-error';
        errEl.textContent = 'Could not load comeback bonus.';
        widgetBody.appendChild(errEl);
    });

    return widget;
}


// ═══════════════════════════════════════════════════════
// LOSS STREAK SAFETY NET TAB & WIDGET
// ═══════════════════════════════════════════════════════

function renderLossStreakTab() {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return;

    var profileContent = document.querySelector('.profile-tab-content') || document.querySelector('.profile-content');
    if (!profileContent) return;
    profileContent.innerHTML = '';

    // --- inject CSS once ---
    if (!document.getElementById('lossStreakTabCSS')) {
        var style = document.createElement('style');
        style.id = 'lossStreakTabCSS';
        style.textContent = [
            '.ls-tab-wrap { max-width: 620px; margin: 0 auto; padding: 20px 10px; font-family: inherit; }',
            '.ls-tab-title { font-size: 1.6rem; font-weight: 700; color: #e0f0ff; margin-bottom: 6px; }',
            '.ls-tab-subtitle { font-size: 0.92rem; color: #8ab4d8; margin-bottom: 22px; }',
            '.ls-offer-card { background: linear-gradient(135deg, #1a2e44 0%, #15304a 100%); border: 1px solid #2a5a7e; border-radius: 14px; padding: 24px; margin-bottom: 20px; position: relative; overflow: hidden; }',
            '.ls-offer-card::before { content: ""; position: absolute; top: -40px; right: -40px; width: 120px; height: 120px; background: radial-gradient(circle, rgba(60,180,130,0.15) 0%, transparent 70%); pointer-events: none; }',
            '.ls-offer-badge { display: inline-block; background: linear-gradient(135deg, #2d8a6e, #3cb88a); color: #fff; font-size: 0.78rem; font-weight: 700; padding: 4px 12px; border-radius: 20px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; }',
            '.ls-offer-headline { font-size: 1.25rem; font-weight: 700; color: #7dd8b0; margin-bottom: 8px; }',
            '.ls-offer-desc { font-size: 0.9rem; color: #a0c4d8; line-height: 1.55; margin-bottom: 18px; }',
            '.ls-deposit-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }',
            '.ls-deposit-label { font-size: 0.88rem; color: #8ab4d8; white-space: nowrap; }',
            '.ls-deposit-input { width: 110px; padding: 10px 12px; border-radius: 8px; border: 1px solid #2a5a7e; background: #0e1e30; color: #e0f0ff; font-size: 1rem; outline: none; transition: border-color 0.2s; }',
            '.ls-deposit-input:focus { border-color: #3cb88a; }',
            '.ls-preview { font-size: 0.92rem; color: #7dd8b0; background: rgba(60,180,130,0.1); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; border: 1px solid rgba(60,180,130,0.2); min-height: 20px; }',
            '.ls-claim-btn { display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #2d8a6e, #3cb88a); color: #fff; font-size: 1rem; font-weight: 700; border: none; border-radius: 10px; cursor: pointer; transition: transform 0.15s, box-shadow 0.2s; letter-spacing: 0.3px; }',
            '.ls-claim-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(60,180,130,0.35); }',
            '.ls-claim-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }',
            '.ls-success-card { background: linear-gradient(135deg, #142e1e 0%, #1a3a28 100%); border: 1px solid #2d8a5e; border-radius: 14px; padding: 24px; margin-bottom: 20px; text-align: center; }',
            '.ls-success-icon { font-size: 2.4rem; margin-bottom: 8px; }',
            '.ls-success-title { font-size: 1.15rem; font-weight: 700; color: #7dd8b0; margin-bottom: 6px; }',
            '.ls-success-detail { font-size: 0.9rem; color: #a0d4b8; line-height: 1.5; margin-bottom: 4px; }',
            '.ls-wager-note { font-size: 0.82rem; color: #8ab4a0; background: rgba(45,138,110,0.12); border-radius: 8px; padding: 8px 12px; margin-top: 12px; display: inline-block; }',
            '.ls-not-eligible { background: linear-gradient(135deg, #1a2636 0%, #1e2e42 100%); border: 1px solid #2a4060; border-radius: 14px; padding: 24px; margin-bottom: 20px; text-align: center; }',
            '.ls-not-icon { font-size: 2rem; margin-bottom: 8px; }',
            '.ls-not-title { font-size: 1.05rem; font-weight: 600; color: #8ab4d8; margin-bottom: 6px; }',
            '.ls-not-desc { font-size: 0.88rem; color: #6a94b4; line-height: 1.5; }',
            '.ls-explainer { background: rgba(20,40,60,0.6); border: 1px solid #1e3a54; border-radius: 12px; padding: 20px; margin-top: 10px; }',
            '.ls-explainer-title { font-size: 1rem; font-weight: 700; color: #8ab4d8; margin-bottom: 12px; }',
            '.ls-step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }',
            '.ls-step-num { flex-shrink: 0; width: 28px; height: 28px; background: linear-gradient(135deg, #2a5a7e, #3a7aa0); color: #fff; font-size: 0.82rem; font-weight: 700; border-radius: 50%; display: flex; align-items: center; justify-content: center; }',
            '.ls-step-text { font-size: 0.88rem; color: #a0c4d8; line-height: 1.45; padding-top: 3px; }',
            '.ls-loading { text-align: center; padding: 40px 0; color: #6a94b4; font-size: 0.95rem; }',
            '.ls-error { text-align: center; padding: 20px; color: #d88a8a; font-size: 0.9rem; background: rgba(180,60,60,0.1); border-radius: 10px; border: 1px solid rgba(180,60,60,0.2); margin-bottom: 16px; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // --- build wrapper ---
    var wrap = document.createElement('div');
    wrap.className = 'ls-tab-wrap';

    var title = document.createElement('div');
    title.className = 'ls-tab-title';
    title.textContent = '\uD83D\uDCAA Loss Streak Safety Net';
    wrap.appendChild(title);

    var subtitle = document.createElement('div');
    subtitle.className = 'ls-tab-subtitle';
    subtitle.textContent = 'We\'ve got your back when luck isn\'t on your side.';
    wrap.appendChild(subtitle);

    // --- content area (populated by fetch) ---
    var contentArea = document.createElement('div');
    contentArea.id = 'lsTabContent';
    wrap.appendChild(contentArea);

    // --- explainer section (always visible) ---
    var explainer = document.createElement('div');
    explainer.className = 'ls-explainer';

    var explainerTitle = document.createElement('div');
    explainerTitle.className = 'ls-explainer-title';
    explainerTitle.textContent = 'How the Safety Net Works';
    explainer.appendChild(explainerTitle);

    var steps = [
        { num: '1', text: 'Play normally. We track your recent spin outcomes.' },
        { num: '2', text: 'If 8 or more of your last 10 spins are losses, you qualify.' },
        { num: '3', text: 'Make a deposit of $10 or more and we\'ll match 50% (up to $25).' },
        { num: '4', text: 'Bonus goes to your bonus balance with a 15x wagering requirement.' },
        { num: '5', text: 'Cooldown: you can use the safety net once every 4 hours.' }
    ];

    for (var si = 0; si < steps.length; si++) {
        var stepRow = document.createElement('div');
        stepRow.className = 'ls-step';

        var stepNum = document.createElement('div');
        stepNum.className = 'ls-step-num';
        stepNum.textContent = steps[si].num;
        stepRow.appendChild(stepNum);

        var stepText = document.createElement('div');
        stepText.className = 'ls-step-text';
        stepText.textContent = steps[si].text;
        stepRow.appendChild(stepText);

        explainer.appendChild(stepRow);
    }

    wrap.appendChild(explainer);
    profileContent.appendChild(wrap);

    // --- loading state ---
    var loading = document.createElement('div');
    loading.className = 'ls-loading';
    loading.textContent = 'Checking eligibility...';
    contentArea.appendChild(loading);

    // --- fetch eligibility ---
    fetch('/api/user/loss-streak-offer', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        contentArea.innerHTML = '';

        if (data.eligible && data.offer) {
            // ---- ELIGIBLE: show offer card ----
            var card = document.createElement('div');
            card.className = 'ls-offer-card';

            var badge = document.createElement('span');
            badge.className = 'ls-offer-badge';
            badge.textContent = 'Safety Net Active';
            card.appendChild(badge);

            var headline = document.createElement('div');
            headline.className = 'ls-offer-headline';
            headline.textContent = (data.offer.matchPct || 50) + '% Deposit Match (up to $' + (data.offer.maxMatch || 25) + ')';
            card.appendChild(headline);

            var desc = document.createElement('div');
            desc.className = 'ls-offer-desc';
            desc.textContent = 'Tough run? Make a deposit and we\'ll boost your balance. Minimum deposit: $' + (data.offer.minDeposit || 10) + '.';
            card.appendChild(desc);

            // deposit input row
            var depositRow = document.createElement('div');
            depositRow.className = 'ls-deposit-row';

            var depositLabel = document.createElement('span');
            depositLabel.className = 'ls-deposit-label';
            depositLabel.textContent = 'Deposit amount:';
            depositRow.appendChild(depositLabel);

            var depositInput = document.createElement('input');
            depositInput.className = 'ls-deposit-input';
            depositInput.type = 'number';
            depositInput.min = String(data.offer.minDeposit || 10);
            depositInput.step = '1';
            depositInput.value = String(data.offer.minDeposit || 10);
            depositInput.placeholder = '$' + (data.offer.minDeposit || 10);
            depositRow.appendChild(depositInput);

            card.appendChild(depositRow);

            // preview
            var preview = document.createElement('div');
            preview.className = 'ls-preview';
            card.appendChild(preview);

            var matchPct = data.offer.matchPct || 50;
            var maxMatch = data.offer.maxMatch || 25;
            var minDep = data.offer.minDeposit || 10;

            function updatePreview() {
                var val = parseFloat(depositInput.value);
                if (isNaN(val) || val < minDep) {
                    preview.textContent = 'Enter at least $' + minDep + ' to see your bonus.';
                    return;
                }
                var bonus = Math.min(val * (matchPct / 100), maxMatch);
                bonus = Math.floor(bonus * 100) / 100;
                preview.textContent = 'Deposit $' + val.toFixed(0) + ' \u2192 Get $' + bonus.toFixed(2) + ' bonus';
            }
            updatePreview();
            depositInput.addEventListener('input', updatePreview);

            // claim button
            var claimBtn = document.createElement('button');
            claimBtn.className = 'ls-claim-btn';
            claimBtn.textContent = 'CLAIM SAFETY NET BONUS';
            card.appendChild(claimBtn);

            claimBtn.addEventListener('click', function() {
                var amt = parseFloat(depositInput.value);
                if (isNaN(amt) || amt < minDep) {
                    preview.textContent = 'Minimum deposit is $' + minDep + '.';
                    return;
                }
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming...';

                fetch('/api/user/claim-loss-offer', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ depositAmount: amt })
                })
                .then(function(res) { return res.json(); })
                .then(function(result) {
                    if (result.success) {
                        contentArea.innerHTML = '';

                        var successCard = document.createElement('div');
                        successCard.className = 'ls-success-card';

                        var successIcon = document.createElement('div');
                        successIcon.className = 'ls-success-icon';
                        successIcon.textContent = '\u2705';
                        successCard.appendChild(successIcon);

                        var successTitle = document.createElement('div');
                        successTitle.className = 'ls-success-title';
                        successTitle.textContent = 'Safety Net Bonus Claimed!';
                        successCard.appendChild(successTitle);

                        var bonusDetail = document.createElement('div');
                        bonusDetail.className = 'ls-success-detail';
                        bonusDetail.textContent = 'Bonus added: $' + (result.bonusAmount || 0).toFixed(2);
                        successCard.appendChild(bonusDetail);

                        if (typeof result.balance !== 'undefined') {
                            var balDetail = document.createElement('div');
                            balDetail.className = 'ls-success-detail';
                            balDetail.textContent = 'Cash balance: $' + parseFloat(result.balance).toFixed(2);
                            successCard.appendChild(balDetail);
                        }

                        if (typeof result.bonusBalance !== 'undefined') {
                            var bonBalDetail = document.createElement('div');
                            bonBalDetail.className = 'ls-success-detail';
                            bonBalDetail.textContent = 'Bonus balance: $' + parseFloat(result.bonusBalance).toFixed(2);
                            successCard.appendChild(bonBalDetail);
                        }

                        var wagerNote = document.createElement('div');
                        wagerNote.className = 'ls-wager-note';
                        var wagerMult = result.wageringRequired || 15;
                        var wagerTotal = ((result.bonusAmount || 0) * wagerMult).toFixed(2);
                        wagerNote.textContent = wagerMult + 'x playthrough required \u2014 wager $' + wagerTotal + ' to unlock bonus funds.';
                        successCard.appendChild(wagerNote);

                        contentArea.appendChild(successCard);
                    } else {
                        claimBtn.disabled = false;
                        claimBtn.textContent = 'CLAIM SAFETY NET BONUS';
                        preview.textContent = result.error || 'Could not claim. Please try again.';
                    }
                })
                .catch(function() {
                    claimBtn.disabled = false;
                    claimBtn.textContent = 'CLAIM SAFETY NET BONUS';
                    preview.textContent = 'Network error. Please try again.';
                });
            });

            contentArea.appendChild(card);

        } else {
            // ---- NOT ELIGIBLE ----
            var notCard = document.createElement('div');
            notCard.className = 'ls-not-eligible';

            var notIcon = document.createElement('div');
            notIcon.className = 'ls-not-icon';
            notIcon.textContent = '\uD83D\uDEE1\uFE0F';
            notCard.appendChild(notIcon);

            var notTitle = document.createElement('div');
            notTitle.className = 'ls-not-title';
            notTitle.textContent = 'Safety Net Standing By';
            notCard.appendChild(notTitle);

            var notDesc = document.createElement('div');
            notDesc.className = 'ls-not-desc';
            notDesc.textContent = data.message || 'Keep playing \u2014 safety net activates after 8 losses in 10 spins. We\'ll be here if you need us.';
            notCard.appendChild(notDesc);

            contentArea.appendChild(notCard);
        }
    })
    .catch(function() {
        contentArea.innerHTML = '';
        var errDiv = document.createElement('div');
        errDiv.className = 'ls-error';
        errDiv.textContent = 'Could not check loss streak eligibility. Please try again later.';
        contentArea.appendChild(errDiv);
    });
}


function renderLossStreakWidget() {
    if (typeof isServerAuthToken !== 'function' || !isServerAuthToken()) return null;
    var token = localStorage.getItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
    if (!token) return null;

    if (document.getElementById('lossStreakWidget')) return null;

    // --- inject widget CSS once ---
    if (!document.getElementById('lossStreakWidgetCSS')) {
        var wStyle = document.createElement('style');
        wStyle.id = 'lossStreakWidgetCSS';
        wStyle.textContent = [
            '.ls-widget { background: linear-gradient(135deg, #142838 0%, #183048 100%); border: 1px solid #2a5a7e; border-radius: 12px; padding: 16px; margin-bottom: 16px; position: relative; overflow: hidden; }',
            '.ls-widget::after { content: ""; position: absolute; bottom: -20px; left: -20px; width: 80px; height: 80px; background: radial-gradient(circle, rgba(60,180,130,0.1) 0%, transparent 70%); pointer-events: none; }',
            '.ls-widget-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }',
            '.ls-widget-icon { font-size: 1.3rem; }',
            '.ls-widget-title { font-size: 0.95rem; font-weight: 700; color: #7dd8b0; }',
            '.ls-widget-body { min-height: 30px; }',
            '.ls-widget-eligible { font-size: 0.88rem; color: #3cb88a; font-weight: 600; margin-bottom: 6px; }',
            '.ls-widget-detail { font-size: 0.82rem; color: #8ab4d8; line-height: 1.4; margin-bottom: 10px; }',
            '.ls-widget-btn { display: inline-block; padding: 8px 18px; background: linear-gradient(135deg, #2d8a6e, #3cb88a); color: #fff; font-size: 0.85rem; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; transition: transform 0.15s; }',
            '.ls-widget-btn:hover { transform: translateY(-1px); }',
            '.ls-widget-standby { font-size: 0.85rem; color: #6a94b4; }',
            '.ls-widget-loading { font-size: 0.84rem; color: #6a94b4; }',
            '.ls-widget-error { font-size: 0.84rem; color: #d88a8a; }'
        ].join('\n');
        document.head.appendChild(wStyle);
    }

    var widget = document.createElement('div');
    widget.className = 'ls-widget';
    widget.id = 'lossStreakWidget';

    var header = document.createElement('div');
    header.className = 'ls-widget-header';

    var icon = document.createElement('span');
    icon.className = 'ls-widget-icon';
    icon.textContent = '\uD83D\uDCAA';
    header.appendChild(icon);

    var wTitle = document.createElement('span');
    wTitle.className = 'ls-widget-title';
    wTitle.textContent = 'Loss Streak Safety Net';
    header.appendChild(wTitle);

    widget.appendChild(header);

    var widgetBody = document.createElement('div');
    widgetBody.className = 'ls-widget-body';
    widget.appendChild(widgetBody);

    var loadingEl = document.createElement('div');
    loadingEl.className = 'ls-widget-loading';
    loadingEl.textContent = 'Checking...';
    widgetBody.appendChild(loadingEl);

    // --- fetch status ---
    fetch('/api/user/loss-streak-offer', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        widgetBody.innerHTML = '';

        if (data.eligible && data.offer) {
            var eligLine = document.createElement('div');
            eligLine.className = 'ls-widget-eligible';
            eligLine.textContent = 'Safety net available!';
            widgetBody.appendChild(eligLine);

            var detailLine = document.createElement('div');
            detailLine.className = 'ls-widget-detail';
            detailLine.textContent = (data.offer.matchPct || 50) + '% match up to $' + (data.offer.maxMatch || 25) + ' on your next deposit (min $' + (data.offer.minDeposit || 10) + ').';
            widgetBody.appendChild(detailLine);

            var viewBtn = document.createElement('button');
            viewBtn.className = 'ls-widget-btn';
            viewBtn.textContent = 'View Offer';
            viewBtn.addEventListener('click', function() {
                if (typeof switchProfileTab === 'function') {
                    switchProfileTab('lossstreak');
                }
            });
            widgetBody.appendChild(viewBtn);
        } else {
            var standby = document.createElement('div');
            standby.className = 'ls-widget-standby';
            standby.textContent = data.message || 'Standing by \u2014 activates after 8 losses in 10 spins.';
            widgetBody.appendChild(standby);
        }
    })
    .catch(function() {
        widgetBody.innerHTML = '';
        var errEl = document.createElement('div');
        errEl.className = 'ls-widget-error';
        errEl.textContent = 'Could not load loss streak status.';
        widgetBody.appendChild(errEl);
    });

    return widget;
}
