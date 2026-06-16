/**
 * Game History / Spin History Viewer
 * IIFE module: window.GameHistory = { show(), init() }
 *
 * Features:
 * - Paginated spin history table
 * - Color-coded results (green=wins, red=losses, gold=jackpots)
 * - Summary stats at top
 * - Filter by game name or date range
 * - Load more / pagination
 * - Dark casino theme with gold accents
 */

(function() {
  'use strict';

  const STORAGE_KEY_TOKEN = 'casinoToken';
  const API_BASE = '/api/game-history';
  let currentPage = 1;
  let currentGame = null;
  let currentDateFrom = null;
  let currentDateTo = null;
  let totalPages = 1;

  /**
   * Helper: API request
   */
  async function api(path, opts) {
    opts = opts || {};
    if (typeof apiRequest === 'function') return apiRequest(path, opts);
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (!token) return null;
    const res = await fetch(path, Object.assign({}, opts, {
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {},
        opts.headers || {}
      )
    }));
    return res.json();
  }

  /**
   * Format currency
   */
  function formatCurrency(amount) {
    return '$' + parseFloat(amount || 0).toFixed(2);
  }

  /**
   * Format date/time
   */
  function formatDateTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Get color class for result type
   */
  function getResultColor(resultType) {
    switch(resultType) {
      case 'jackpot':
        return '#fbbf24'; // gold
      case 'win':
        return '#10b981'; // green
      case 'loss':
        return '#ef4444'; // red
      case 'break-even':
        return '#9ca3af'; // gray
      default:
        return '#ffffff';
    }
  }

  /**
   * Get result label
   */
  function getResultLabel(resultType) {
    switch(resultType) {
      case 'jackpot':
        return '🎉 JACKPOT';
      case 'win':
        return '✓ WIN';
      case 'loss':
        return '✗ LOSS';
      case 'break-even':
        return '= BREAK';
      default:
        return resultType;
    }
  }

  /**
   * Create modal structure
   */
  function createModal() {
    let modal = document.getElementById('game-history-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'game-history-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    modal.innerHTML = `
      <style>
        #game-history-modal * {
          box-sizing: border-box;
        }

        .game-history-content {
          background: #1a1a2e;
          border: 2px solid #fbbf24;
          border-radius: 12px;
          padding: 30px;
          max-width: 1200px;
          width: 100%;
          color: #ffffff;
          max-height: 90vh;
          overflow-y: auto;
        }

        .game-history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #fbbf24;
          padding-bottom: 15px;
        }

        .game-history-header h1 {
          font-size: 28px;
          margin: 0;
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.3);
        }

        .game-history-close {
          background: #fbbf24;
          color: #1a1a2e;
          border: none;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 20px;
          font-weight: bold;
          transition: all 0.2s ease;
        }

        .game-history-close:hover {
          background: #f59e0b;
          transform: scale(1.1);
        }

        .game-history-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }

        .summary-card {
          background: linear-gradient(135deg, #2d2d44, #1a1a2e);
          border-left: 4px solid #fbbf24;
          padding: 20px;
          border-radius: 8px;
          text-align: center;
        }

        .summary-card-label {
          font-size: 12px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
        }

        .summary-card-value {
          font-size: 24px;
          font-weight: bold;
          color: #fbbf24;
        }

        .summary-card-value.negative {
          color: #ef4444;
        }

        .summary-card-value.positive {
          color: #10b981;
        }

        .game-history-filters {
          background: linear-gradient(135deg, #2d2d44, #1a1a2e);
          border: 1px solid #fbbf24;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 30px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
        }

        .filter-group label {
          font-size: 12px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 8px;
        }

        .filter-group input,
        .filter-group select {
          background: #1a1a2e;
          border: 1px solid #fbbf24;
          color: #ffffff;
          padding: 10px;
          border-radius: 6px;
          font-family: inherit;
          font-size: 14px;
        }

        .filter-group input:focus,
        .filter-group select:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 10px rgba(251, 191, 36, 0.3);
        }

        .filter-buttons {
          display: flex;
          gap: 10px;
          align-items: flex-end;
        }

        .filter-btn {
          background: #fbbf24;
          color: #1a1a2e;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.2s ease;
          font-size: 14px;
        }

        .filter-btn:hover {
          background: #f59e0b;
          transform: translateY(-2px);
        }

        .filter-btn:active {
          transform: translateY(0);
        }

        .game-history-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
        }

        .game-history-table thead {
          background: linear-gradient(90deg, #2d2d44, #1a1a2e);
          border-bottom: 2px solid #fbbf24;
        }

        .game-history-table th {
          padding: 15px;
          text-align: left;
          font-size: 12px;
          color: #fbbf24;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: bold;
        }

        .game-history-table tbody tr {
          border-bottom: 1px solid #2d2d44;
          transition: background 0.2s ease;
        }

        .game-history-table tbody tr:hover {
          background: rgba(251, 191, 36, 0.05);
        }

        .game-history-table td {
          padding: 15px;
          font-size: 14px;
        }

        .result-cell {
          font-weight: bold;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .result-badge {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .amount-cell {
          font-weight: 500;
        }

        .multiplier-cell {
          color: #fbbf24;
          font-weight: bold;
        }

        .game-history-pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #fbbf24;
        }

        .pagination-info {
          color: #9ca3af;
          font-size: 14px;
          margin: 0 20px;
        }

        .load-more-btn {
          background: #fbbf24;
          color: #1a1a2e;
          border: none;
          padding: 12px 30px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.2s ease;
          font-size: 14px;
        }

        .load-more-btn:hover {
          background: #f59e0b;
          transform: translateY(-2px);
        }

        .load-more-btn:active {
          transform: translateY(0);
        }

        .load-more-btn:disabled {
          background: #6b7280;
          cursor: not-allowed;
          opacity: 0.6;
          transform: none;
        }

        .loading-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(251, 191, 36, 0.3);
          border-radius: 50%;
          border-top-color: #fbbf24;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: #9ca3af;
        }

        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 15px;
        }

        .empty-state-text {
          font-size: 16px;
        }

        @media (max-width: 768px) {
          .game-history-content {
            padding: 20px;
          }

          .game-history-header {
            flex-direction: column;
            gap: 15px;
            align-items: flex-start;
          }

          .game-history-summary {
            grid-template-columns: 1fr 1fr;
          }

          .game-history-table {
            font-size: 12px;
          }

          .game-history-table th,
          .game-history-table td {
            padding: 10px 8px;
          }

          .game-history-filters {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <div class="game-history-content">
        <div class="game-history-header">
          <h1>🎰 Game History</h1>
          <button class="game-history-close" aria-label="Close">&times;</button>
        </div>

        <div class="game-history-summary" id="gameHistorySummary">
          <div class="summary-card">
            <div class="summary-card-label">Total Spins</div>
            <div class="summary-card-value" id="summarySpins">-</div>
          </div>
          <div class="summary-card">
            <div class="summary-card-label">Total Wagered</div>
            <div class="summary-card-value" id="summaryWagered">-</div>
          </div>
          <div class="summary-card">
            <div class="summary-card-label">Total Won</div>
            <div class="summary-card-value" id="summaryWon">-</div>
          </div>
          <div class="summary-card">
            <div class="summary-card-label">Net P&L</div>
            <div class="summary-card-value" id="summaryNetPL">-</div>
          </div>
        </div>

        <div class="game-history-filters">
          <div class="filter-group">
            <label>Game Name</label>
            <input type="text" id="filterGame" placeholder="All games" />
          </div>
          <div class="filter-group">
            <label>From Date</label>
            <input type="datetime-local" id="filterDateFrom" />
          </div>
          <div class="filter-group">
            <label>To Date</label>
            <input type="datetime-local" id="filterDateTo" />
          </div>
          <div class="filter-buttons">
            <button class="filter-btn" id="filterApplyBtn">Apply Filters</button>
            <button class="filter-btn" id="filterResetBtn">Reset</button>
          </div>
        </div>

        <table class="game-history-table">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Game</th>
              <th>Bet</th>
              <th>Win</th>
              <th>Multiplier</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody id="gameHistoryTable">
            <tr>
              <td colspan="6" style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: #9ca3af; margin-top: 15px;">Loading history...</p>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="game-history-pagination">
          <span class="pagination-info">
            Page <span id="paginationCurrent">1</span> of <span id="paginationTotal">1</span>
          </span>
          <button class="load-more-btn" id="loadMoreBtn">Load More</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  /**
   * Load summary stats
   */
  async function loadSummary() {
    try {
      const data = await api(API_BASE + '/summary');
      if (data && !data.error) {
        var _elSpins = document.getElementById('summarySpins');
        var _elWagered = document.getElementById('summaryWagered');
        var _elWon = document.getElementById('summaryWon');
        if (_elSpins) _elSpins.textContent = data.totalSpins;
        if (_elWagered) _elWagered.textContent = formatCurrency(data.totalWagered);
        if (_elWon) _elWon.textContent = formatCurrency(data.totalWon);

        const netPLElem = document.getElementById('summaryNetPL');
        if (netPLElem) { netPLElem.textContent = formatCurrency(data.netPl); netPLElem.className = 'summary-card-value ' + (data.netPl >= 0 ? 'positive' : 'negative'); }
      }
    } catch (err) {
      console.warn('[GameHistory] Failed to load summary:', err);
    }
  }

  /**
   * Load paginated history
   */
  async function loadHistory(page = 1) {
    try {
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', 20);
      if (currentGame) params.append('game', currentGame);
      if (currentDateFrom) params.append('from', currentDateFrom);
      if (currentDateTo) params.append('to', currentDateTo);

      const url = API_BASE + '?' + params.toString();
      const data = await api(url);

      if (data && !data.error) {
        currentPage = data.page;
        totalPages = data.totalPages;

        const tbody = document.getElementById('gameHistoryTable');
        const rows = data.data.map(spin => {
          const resultColor = getResultColor(spin.resultType);
          const resultLabel = getResultLabel(spin.resultType);

          return `
            <tr>
              <td>${formatDateTime(spin.timestamp)}</td>
              <td>${escapeHtml(spin.gameName)}</td>
              <td class="amount-cell">${formatCurrency(spin.betAmount)}</td>
              <td class="amount-cell">${formatCurrency(spin.winAmount)}</td>
              <td class="multiplier-cell">${spin.multiplier}x</td>
              <td>
                <div class="result-cell">
                  <div class="result-badge" style="background-color: ${resultColor};"></div>
                  <span style="color: ${resultColor};">${resultLabel}</span>
                </div>
              </td>
            </tr>
          `;
        });

        if (rows.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6">
                <div class="empty-state">
                  <div class="empty-state-icon">🔍</div>
                  <div class="empty-state-text">No spins found matching your filters.</div>
                </div>
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = rows.join('');
        }

        var _elPgCur = document.getElementById('paginationCurrent');
        var _elPgTot = document.getElementById('paginationTotal');
        if (_elPgCur) _elPgCur.textContent = currentPage;
        if (_elPgTot) _elPgTot.textContent = totalPages;

        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) { loadMoreBtn.disabled = currentPage >= totalPages; loadMoreBtn.textContent = currentPage >= totalPages ? 'No More Spins' : 'Load More'; }
      }
    } catch (err) {
      console.warn('[GameHistory] Failed to load history:', err);
      document.getElementById('gameHistoryTable').innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: #ef4444; padding: 40px;">
            Error loading history. Please try again.
          </td>
        </tr>
      `;
    }
  }

  /**
   * Show modal and load data
   */
  function show() {
    const modal = createModal();
    modal.style.display = 'flex';

    // Reset pagination
    currentPage = 1;
    currentGame = null;
    currentDateFrom = null;
    currentDateTo = null;

    // Clear filters
    document.getElementById('filterGame').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';

    // Load data
    loadSummary();
    loadHistory(1);
  }

  /**
   * Close modal
   */
  function closeModal() {
    const modal = document.getElementById('game-history-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Initialize event listeners
   */
  var _initDone = false;
  function init() {
    if (_initDone) return;
    _initDone = true;
    const modal = createModal();

    // Close button
    modal.querySelector('.game-history-close').addEventListener('click', closeModal);

    // Click outside modal to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Keyboard escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        closeModal();
      }
    });

    // Apply filters
    document.getElementById('filterApplyBtn').addEventListener('click', () => {
      currentGame = document.getElementById('filterGame').value.trim() || null;
      currentDateFrom = document.getElementById('filterDateFrom').value || null;
      currentDateTo = document.getElementById('filterDateTo').value || null;
      currentPage = 1;
      loadHistory(1);
    });

    // Reset filters
    document.getElementById('filterResetBtn').addEventListener('click', () => {
      document.getElementById('filterGame').value = '';
      document.getElementById('filterDateFrom').value = '';
      document.getElementById('filterDateTo').value = '';
      currentGame = null;
      currentDateFrom = null;
      currentDateTo = null;
      currentPage = 1;
      loadHistory(1);
    });

    // Load more button
    document.getElementById('loadMoreBtn').addEventListener('click', () => {
      if (currentPage < totalPages) {
        loadHistory(currentPage + 1);
      }
    });
  }

  // Export public API
  window.GameHistory = {
    show: show,
    init: init,
    close: closeModal
  };

})();
