/**
 * Admin Revenue Analytics Dashboard
 * Real-time metrics, player activity, feature performance
 * Exposes: window.AdminAnalytics = { init, show, hide }
 */

(function() {
    'use strict';

    var STORAGE_KEY_TOKEN = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
    var API_BASE = '/api/admin/analytics';
    var REFRESH_INTERVAL = 60000; // 60 seconds

    var state = {
        initialized: false,
        visible: false,
        overlayEl: null,
        panelEl: null,
        currentUser: null,
        refreshTimer: null,
        lastRefresh: null
    };

    // API helper — with Authorization header
    async function api(path, opts) {
        opts = opts || {};
        var token = localStorage.getItem(STORAGE_KEY_TOKEN);
        if (!token) throw new Error('No auth token');
        var res = await fetch(path, Object.assign({}, opts, {
            headers: Object.assign(
                { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                opts.headers || {}
            )
        }));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    // Load current user from localStorage
    function loadCurrentUser() {
        var userJson = localStorage.getItem('casinoUser');
        if (!userJson) return null;
        try {
            return JSON.parse(userJson);
        } catch (e) {
            return null;
        }
    }

    // Check if current user is admin
    function isAdmin() {
        var user = loadCurrentUser();
        return user && (user.is_admin === 1 || user.is_admin === true);
    }

    // Format large numbers
    function formatNumber(val) {
        var n = parseFloat(val) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toFixed(0);
    }

    // Format currency
    function formatCurrency(val) {
        var n = parseFloat(val) || 0;
        return 'Ⓖ' + n.toFixed(0);
    }

    // Format percentage
    function formatPercent(val) {
        return parseFloat(val || 0).toFixed(2) + '%';
    }

    // Canvas-based bar chart — 30 days profit
    function drawProfitChart(canvas, data) {
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;
        var padding = 40;
        var chartWidth = w - padding * 2;
        var chartHeight = h - padding * 2;

        // Clear canvas
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, w, h);

        if (!data || data.length === 0) {
            ctx.fillStyle = '#888';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', w / 2, h / 2);
            return;
        }

        // Find min/max profit for scaling
        var maxProfit = Math.max(1, Math.max.apply(null, data.map(function(d) { return parseFloat(d.profit) || 0; })));
        var minProfit = Math.min(0, Math.min.apply(null, data.map(function(d) { return parseFloat(d.profit) || 0; })));

        var barWidth = chartWidth / data.length;
        var zeroY = padding + chartHeight - (Math.abs(minProfit) / (maxProfit - minProfit) * chartHeight);

        // Draw grid lines
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) {
            var y = padding + (i * chartHeight / 5);
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(w - padding, y);
            ctx.stroke();
        }

        // Draw zero line
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, zeroY);
        ctx.lineTo(w - padding, zeroY);
        ctx.stroke();

        // Draw bars
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        data.forEach(function(d, i) {
            var profit = parseFloat(d.profit) || 0;
            var barHeight = (profit / (maxProfit - minProfit)) * chartHeight;
            var x = padding + i * barWidth + barWidth / 2;
            var y = profit >= 0 ? zeroY - barHeight : zeroY;

            // Color: green for profit, red for loss
            ctx.fillStyle = profit >= 0 ? '#00d651' : '#ff4444';
            ctx.fillRect(x - barWidth / 2 + 2, y, barWidth - 4, barHeight);

            // Label day
            ctx.fillStyle = '#888';
            ctx.fillText(d.day ? d.day.slice(5) : '', x, h - 10);
        });

        // Draw axes
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, h - padding);
        ctx.lineTo(w - padding, h - padding);
        ctx.stroke();
    }

    // Fetch and render overview KPI cards
    async function refreshOverview() {
        try {
            var data = await api(API_BASE + '/overview');

            // Update KPI cards
            var card1 = document.getElementById('admin-kpi-users');
            if (card1) {
                card1.innerHTML =
                    '<div class="kpi-label">Total Users</div>' +
                    '<div class="kpi-value">' + formatNumber(data.totalUsers) + '</div>' +
                    '<div class="kpi-sub">Active today: ' + formatNumber(data.activeToday) + '</div>';
            }

            var card2 = document.getElementById('admin-kpi-active');
            if (card2) {
                var pct = data.totalUsers > 0 ? ((data.activeToday / data.totalUsers) * 100).toFixed(1) : 0;
                card2.innerHTML =
                    '<div class="kpi-label">Active Today</div>' +
                    '<div class="kpi-value">' + formatNumber(data.activeToday) + '</div>' +
                    '<div class="kpi-sub">' + pct + '% of total</div>';
            }

            var card3 = document.getElementById('admin-kpi-profit');
            if (card3) {
                var profitClass = data.profitToday >= 0 ? 'positive' : 'negative';
                card3.innerHTML =
                    '<div class="kpi-label">House Profit Today</div>' +
                    '<div class="kpi-value ' + profitClass + '">' + formatCurrency(data.profitToday) + '</div>' +
                    '<div class="kpi-sub">Wagered: ' + formatCurrency(data.wagerToday) + '</div>';
            }

            var card4 = document.getElementById('admin-kpi-edge');
            if (card4) {
                card4.innerHTML =
                    '<div class="kpi-label">House Edge %</div>' +
                    '<div class="kpi-value">' + formatPercent(data.houseEdgeOverall) + '</div>' +
                    '<div class="kpi-sub">Today: ' + formatPercent(data.houseEdgeToday) + '</div>';
            }

            state.lastRefresh = new Date();
        } catch (e) {
            console.warn('[AdminAnalytics] Overview refresh error:', e.message);
        }
    }

    // Fetch and render revenue chart
    async function refreshChart() {
        try {
            var response = await api(API_BASE + '/timeline');
            var data = response.timeline || [];

            var canvas = document.getElementById('admin-chart-canvas');
            if (canvas) {
                drawProfitChart(canvas, data);
            }
        } catch (e) {
            console.warn('[AdminAnalytics] Chart refresh error:', e.message);
        }
    }

    // Fetch and render players table
    async function refreshPlayers() {
        try {
            var data = await api(API_BASE + '/players');
            var tbody = document.getElementById('admin-table-players-body');
            if (!tbody) return;

            var whalers = data.topWhalers || [];
            var html = '';
            whalers.forEach(function(p) {
                var winRate = p.totalWagered > 0 ? ((p.totalWon / p.totalWagered) * 100).toFixed(1) : 0;
                html += '<tr>' +
                    '<td>' + (p.display_name || p.username) + '</td>' +
                    '<td>' + formatCurrency(p.totalWagered) + '</td>' +
                    '<td>' + p.totalSpins + '</td>' +
                    '<td>' + formatCurrency(p.currentBalance) + '</td>' +
                    '<td>' + winRate + '%</td>' +
                    '</tr>';
            });

            tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center;color:#888;">No players</td></tr>';
        } catch (e) {
            console.warn('[AdminAnalytics] Players refresh error:', e.message);
        }
    }

    // Fetch and render features table
    async function refreshFeatures() {
        try {
            var data = await api(API_BASE + '/features');
            var tbody = document.getElementById('admin-table-features-body');
            if (!tbody) return;

            var features = [
                { name: 'Battle Pass', value: data.battlepassPurchases },
                { name: 'Tournaments', value: data.tournamentEntries },
                { name: 'Referrals', value: data.referralsUsed },
                { name: 'Login Streaks', value: data.loginStreaksActive },
                { name: 'Challenges', value: data.challengeCompletions },
                { name: 'Deposit Bonuses', value: data.depositBonusesClaimed },
                { name: 'Seasonal Events', value: data.seasonalEventParticipants }
            ];

            var total = features.reduce(function(sum, f) { return sum + (f.value || 0); }, 0);
            var html = '';
            features.forEach(function(f) {
                var pct = total > 0 ? ((f.value / total) * 100).toFixed(1) : 0;
                html += '<tr>' +
                    '<td>' + f.name + '</td>' +
                    '<td>' + (f.value || 0) + '</td>' +
                    '<td><div class="mini-bar" style="width:' + pct + '%"></div></td>' +
                    '</tr>';
            });

            tbody.innerHTML = html || '<tr><td colspan="3" style="text-align:center;color:#888;">No data</td></tr>';
        } catch (e) {
            console.warn('[AdminAnalytics] Features refresh error:', e.message);
        }
    }

    // Refresh all data
    async function refreshAll() {
        var spinner = document.getElementById('admin-refresh-spinner');
        if (spinner) spinner.style.display = 'inline';

        await Promise.all([
            refreshOverview(),
            refreshChart(),
            refreshPlayers(),
            refreshFeatures()
        ]);

        if (spinner) spinner.style.display = 'none';
    }

    // Create the dashboard UI
    function createDashboardUI() {
        var overlay = document.createElement('div');
        overlay.id = 'admin-analytics-overlay';
        overlay.className = 'admin-analytics-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9000;display:none;';

        var panel = document.createElement('div');
        panel.id = 'admin-analytics-panel';
        panel.className = 'admin-analytics-panel';
        panel.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;bottom:10px;background:#0a0a1a;border:2px solid #00d651;border-radius:8px;z-index:9001;display:none;overflow:auto;font-family:"Inter",sans-serif;color:#ccc;';

        panel.innerHTML = '<div style="padding:20px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #333;padding-bottom:10px;">' +
                '<h2 style="margin:0;color:#00d651;font-size:24px;">Admin Analytics</h2>' +
                '<div>' +
                    '<button id="admin-refresh-btn" style="padding:8px 12px;background:#00d651;color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:600;margin-right:10px;">Refresh Data</button>' +
                    '<span id="admin-refresh-spinner" style="display:none;margin-right:10px;">⟳</span>' +
                    '<button id="admin-close-btn" style="padding:8px 12px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Close</button>' +
                '</div>' +
            '</div>' +
            '<div style="margin-bottom:20px;color:#888;font-size:12px;">Last refresh: <span id="admin-last-refresh">Never</span></div>' +

            // KPI Cards Row
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:30px;">' +
                '<div id="admin-kpi-users" class="admin-kpi-card" style="padding:15px;background:#1a1a2a;border:1px solid #333;border-radius:6px;"></div>' +
                '<div id="admin-kpi-active" class="admin-kpi-card" style="padding:15px;background:#1a1a2a;border:1px solid #333;border-radius:6px;"></div>' +
                '<div id="admin-kpi-profit" class="admin-kpi-card" style="padding:15px;background:#1a1a2a;border:1px solid #333;border-radius:6px;"></div>' +
                '<div id="admin-kpi-edge" class="admin-kpi-card" style="padding:15px;background:#1a1a2a;border:1px solid #333;border-radius:6px;"></div>' +
            '</div>' +

            // Revenue Chart
            '<div style="margin-bottom:30px;">' +
                '<h3 style="margin:0 0 10px 0;color:#00d651;font-size:16px;">30-Day Profit Trend</h3>' +
                '<canvas id="admin-chart-canvas" width="100%" height="250" style="width:100%;height:250px;background:#1a1a2a;border:1px solid #333;border-radius:6px;"></canvas>' +
            '</div>' +

            // Top Players Table
            '<div style="margin-bottom:30px;">' +
                '<h3 style="margin:0 0 10px 0;color:#00d651;font-size:16px;">Top Players (by Wagered)</h3>' +
                '<table style="width:100%;border-collapse:collapse;font-size:12px;color:#aaa;">' +
                    '<thead style="background:#1a1a2a;border-bottom:1px solid #333;">' +
                        '<tr><th style="padding:8px;text-align:left;">Player</th><th style="padding:8px;text-align:left;">Wagered</th><th style="padding:8px;text-align:left;">Spins</th><th style="padding:8px;text-align:left;">Balance</th><th style="padding:8px;text-align:left;">Win %</th></tr>' +
                    '</thead>' +
                    '<tbody id="admin-table-players-body"></tbody>' +
                '</table>' +
            '</div>' +

            // Features Table
            '<div style="margin-bottom:30px;">' +
                '<h3 style="margin:0 0 10px 0;color:#00d651;font-size:16px;">Feature Engagement</h3>' +
                '<table style="width:100%;border-collapse:collapse;font-size:12px;color:#aaa;">' +
                    '<thead style="background:#1a1a2a;border-bottom:1px solid #333;">' +
                        '<tr><th style="padding:8px;text-align:left;">Feature</th><th style="padding:8px;text-align:left;">Count</th><th style="padding:8px;text-align:left;">Usage %</th></tr>' +
                    '</thead>' +
                    '<tbody id="admin-table-features-body"></tbody>' +
                '</table>' +
            '</div>' +

            '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        state.overlayEl = overlay;
        state.panelEl = panel;

        // Wire events
        var closeBtn = panel.querySelector('#admin-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() { hide(); });
        }

        var refreshBtn = panel.querySelector('#admin-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() { refreshAll(); });
        }

        // Canvas resize
        var canvas = panel.querySelector('#admin-chart-canvas');
        if (canvas) {
            function resizeCanvas() {
                var rect = canvas.parentElement.getBoundingClientRect();
                canvas.width = rect.width - 2;
                canvas.height = 250;
                refreshChart();
            }
            window.addEventListener('resize', resizeCanvas);
            resizeCanvas();
        }

        state.initialized = true;
    }

    // Show dashboard
    function show() {
        if (!state.initialized) createDashboardUI();
        if (state.overlayEl) state.overlayEl.style.display = 'block';
        if (state.panelEl) state.panelEl.style.display = 'block';
        state.visible = true;
        refreshAll();

        // Auto-refresh every 60 seconds
        if (state.refreshTimer) clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(function() {
            if (state.visible) refreshAll();
        }, REFRESH_INTERVAL);
    }

    // Hide dashboard
    function hide() {
        if (state.overlayEl) state.overlayEl.style.display = 'none';
        if (state.panelEl) state.panelEl.style.display = 'none';
        state.visible = false;
        if (state.refreshTimer) clearInterval(state.refreshTimer);
    }

    // Update last refresh time display
    function updateLastRefreshDisplay() {
        var el = document.getElementById('admin-last-refresh');
        if (el && state.lastRefresh) {
            el.textContent = state.lastRefresh.toLocaleTimeString();
        }
    }

    // Update last refresh display periodically
    setInterval(updateLastRefreshDisplay, 5000);

    // Public API
    window.AdminAnalytics = {
        init: function() {
            if (!isAdmin()) {
                console.warn('[AdminAnalytics] Not admin, skipping init');
                return;
            }
            if (!state.initialized) createDashboardUI();
        },
        show: show,
        hide: hide
    };

})();
