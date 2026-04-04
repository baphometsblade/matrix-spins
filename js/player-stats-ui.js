(function() {
  'use strict';

  const STORAGE_KEY_TOKEN = 'casinoToken';

  async function api(path, opts) {
    opts = opts || {};
    if (typeof apiRequest === 'function') return apiRequest(path, opts);
    var token = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (!token) return null;
    var res = await fetch(path, Object.assign({}, opts, {
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {},
        opts.headers || {}
      )
    }));
    return res.json();
  }

  function formatCurrency(amount) {
    return '$' + parseFloat(amount || 0).toFixed(2);
  }

  function getStreakInfo(data) {
    if (!data) return { type: 'unknown', count: 0 };

    var totalWon = parseFloat(data.totalWon || 0);
    var totalWagered = parseFloat(data.totalWagered || 0);

    if (totalWon > totalWagered) {
      return { type: 'win', count: '✓' };
    } else if (totalWon < totalWagered) {
      return { type: 'loss', count: '✗' };
    }
    return { type: 'break', count: '−' };
  }

  function createModal() {
    var modal = document.createElement('div');
    modal.id = 'player-stats-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
    `;

    modal.innerHTML = `
      <style>
        #player-stats-modal * {
          box-sizing: border-box;
        }

        .stats-modal-content {
          background: #1a1a2e;
          border: 2px solid #fbbf24;
          border-radius: 12px;
          padding: 30px;
          max-width: 900px;
          width: 100%;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-height: 90vh;
          overflow-y: auto;
        }

        .stats-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
          border-bottom: 1px solid #fbbf24;
          padding-bottom: 15px;
        }

        .stats-modal-header h1 {
          font-size: 28px;
          margin: 0;
          color: #fbbf24;
        }

        .stats-close-btn {
          background: #fbbf24;
          color: #1a1a2e;
          border: none;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 20px;
          font-weight: bold;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.3s;
        }

        .stats-close-btn:hover {
          background: #fcd34d;
        }

        .member-info {
          background: rgba(251, 191, 36, 0.1);
          border-left: 3px solid #fbbf24;
          padding: 15px;
          margin-bottom: 25px;
          border-radius: 6px;
          font-size: 14px;
        }

        .stats-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }

        .stat-card {
          background: rgba(251, 191, 36, 0.05);
          border: 1px solid #fbbf24;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          transition: all 0.3s;
        }

        .stat-card:hover {
          background: rgba(251, 191, 36, 0.15);
          transform: translateY(-2px);
        }

        .stat-label {
          font-size: 12px;
          color: #aaa;
          text-transform: uppercase;
          margin-bottom: 10px;
          letter-spacing: 0.5px;
        }

        .stat-value {
          font-size: 20px;
          font-weight: bold;
          color: #fbbf24;
          word-break: break-word;
        }

        .stat-value.positive {
          color: #10b981;
        }

        .stat-value.negative {
          color: #ef4444;
        }

        .chart-section {
          background: rgba(251, 191, 36, 0.05);
          border: 1px solid #fbbf24;
          border-radius: 8px;
          padding: 25px;
          margin-bottom: 30px;
        }

        .chart-title {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 20px;
          color: #fbbf24;
        }

        .chart-bars {
          display: flex;
          align-items: flex-end;
          justify-content: space-around;
          height: 150px;
          gap: 4px;
        }

        .chart-bar {
          flex: 1;
          background: linear-gradient(to top, #fbbf24, #fcd34d);
          border-radius: 4px 4px 0 0;
          min-height: 4px;
          max-width: 50px;
          position: relative;
          transition: all 0.3s;
        }

        .chart-bar:hover {
          background: linear-gradient(to top, #f59e0b, #fbbf24);
          opacity: 0.9;
        }

        .chart-bar-label {
          position: absolute;
          bottom: -20px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          color: #aaa;
          white-space: nowrap;
        }

        .highlight-section {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        }

        .highlight-card {
          background: rgba(251, 191, 36, 0.05);
          border: 1px solid #fbbf24;
          border-radius: 8px;
          padding: 20px;
        }

        .highlight-label {
          font-size: 12px;
          color: #aaa;
          text-transform: uppercase;
          margin-bottom: 10px;
          letter-spacing: 0.5px;
        }

        .highlight-value {
          font-size: 16px;
          font-weight: bold;
          color: #fbbf24;
          word-break: break-word;
        }

        .streak-indicator {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .streak-badge {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: bold;
        }

        .streak-badge.win {
          background: rgba(16, 185, 129, 0.2);
          color: #10b981;
        }

        .streak-badge.loss {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        .streak-badge.break {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
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

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid #ef4444;
          color: #fca5a5;
          padding: 15px;
          border-radius: 6px;
          margin-bottom: 20px;
        }

        @media (max-width: 768px) {
          .stats-modal-content {
            padding: 20px;
          }

          .stats-modal-header h1 {
            font-size: 22px;
          }

          .stats-cards-grid {
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 10px;
          }

          .stat-card {
            padding: 15px;
          }

          .stat-value {
            font-size: 16px;
          }

          .chart-bars {
            height: 120px;
          }

          .highlight-section {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <div class="stats-modal-content">
        <div class="stats-modal-header">
          <h1>Player Statistics</h1>
          <button class="stats-close-btn" aria-label="Close">&times;</button>
        </div>

        <div id="stats-container">
          <div style="text-align: center; padding: 40px;">
            <div class="loading-spinner"></div>
            <p style="color: #aaa; margin-top: 15px;">Loading your stats...</p>
          </div>
        </div>
      </div>
    `;

    return modal;
  }

  function renderStats(statsData, historyData) {
    var container = document.getElementById('stats-container');
    if (!container) return;

    var streak = getStreakInfo(statsData);
    var memberSince = statsData.memberSince ? new Date(statsData.memberSince).toLocaleDateString() : 'Unknown';
    var favoriteGame = statsData.favoriteGame || 'Not determined';

    var chartBarsHtml = '';
    if (historyData && historyData.length > 0) {
      var maxWagered = Math.max.apply(null, historyData.map(function(d) { return parseFloat(d.wagered || 0); }));
      chartBarsHtml = historyData.map(function(day, idx) {
        var wagered = parseFloat(day.wagered || 0);
        var heightPercent = maxWagered > 0 ? (wagered / maxWagered) * 100 : 0;
        var date = day.date ? new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        return `
          <div class="chart-bar" style="height: ${heightPercent}%;" title="${formatCurrency(wagered)}">
            <div class="chart-bar-label">${date}</div>
          </div>
        `;
      }).join('');
    }

    var netPnL = parseFloat(statsData.netPnL || 0);
    var pnLClass = netPnL > 0 ? 'positive' : (netPnL < 0 ? 'negative' : '');
    var pnLSymbol = netPnL >= 0 ? '+' : '';

    container.innerHTML = `
      <div class="member-info">
        <strong style="color: #fbbf24;">Member since:</strong> ${memberSince}
      </div>

      <div class="stats-cards-grid">
        <div class="stat-card">
          <div class="stat-label">Total Spins</div>
          <div class="stat-value">${parseInt(statsData.totalSpins || 0).toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Wagered</div>
          <div class="stat-value">${formatCurrency(statsData.totalWagered)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Won</div>
          <div class="stat-value" style="color: #10b981;">${formatCurrency(statsData.totalWon)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net P&L</div>
          <div class="stat-value ${pnLClass}">${pnLSymbol}${formatCurrency(netPnL)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Biggest Win</div>
          <div class="stat-value" style="color: #10b981;">${formatCurrency(statsData.biggestWin)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Bet</div>
          <div class="stat-value">${formatCurrency(statsData.avgBet)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessions</div>
          <div class="stat-value">${parseInt(statsData.sessions || 0).toLocaleString()}</div>
        </div>
      </div>

      ${chartBarsHtml ? `
        <div class="chart-section">
          <div class="chart-title">Last 14 Days - Daily Wagered</div>
          <div class="chart-bars">
            ${chartBarsHtml}
          </div>
        </div>
      ` : ''}

      <div class="highlight-section">
        <div class="highlight-card">
          <div class="highlight-label">Favorite Game</div>
          <div class="highlight-value">${favoriteGame}</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-label">Current Streak</div>
          <div class="streak-indicator">
            <div class="streak-badge ${streak.type}">${streak.count}</div>
            <span style="color: #aaa;">${streak.type === 'win' ? 'Winning' : (streak.type === 'loss' ? 'Losing' : 'Break-even')}</span>
          </div>
        </div>
      </div>
    `;
  }

  function showError(message) {
    var container = document.getElementById('stats-container');
    if (!container) return;

    container.innerHTML = `
      <div class="error-message">
        <strong>Error loading stats:</strong> ${message}
      </div>
    `;
  }

  window.PlayerStatsUI = {
    show: function() {
      var modal = document.getElementById('player-stats-modal');
      if (!modal) {
        modal = createModal();
        document.body.appendChild(modal);
      }

      modal.style.display = 'flex';

      var closeBtn = modal.querySelector('.stats-close-btn');
      if (closeBtn) {
        closeBtn.onclick = function() {
          window.PlayerStatsUI.hide();
        };
      }

      modal.onclick = function(e) {
        if (e.target === modal) {
          window.PlayerStatsUI.hide();
        }
      };

      (async function() {
        try {
          var statsResponse = await api('/api/player-stats/');
          if (!statsResponse) {
            showError('Failed to fetch player stats. Please ensure you are logged in.');
            return;
          }

          var historyResponse = await api('/api/player-stats/history?days=14');
          var historyData = historyResponse && historyResponse.data ? historyResponse.data : [];

          renderStats(statsResponse, historyData);
        } catch (error) {
          console.warn('Error loading player stats:', error);
          showError('An error occurred while loading your stats. Please try again.');
        }
      })();
    },

    hide: function() {
      var modal = document.getElementById('player-stats-modal');
      if (modal) {
        modal.style.display = 'none';
      }
    }
  };
})();
