/**
 * Self-Exclusion UI Module for Matrix Spins Casino
 * Responsible gambling feature — lets users voluntarily exclude themselves from play.
 */
(function() {
    'use strict';

    async function api(path, opts) {
        opts = opts || {};
        if (typeof apiRequest === 'function') return apiRequest(path, opts);
        var tokenKey = typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken';
        var token = localStorage.getItem(tokenKey);
        if (!token) return null;
        var res = await fetch(path, Object.assign({}, opts, {
            headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, opts.headers || {})
        }));
        return res.json();
    }

    function showSelfExclusionModal() {
        // Remove existing
        var existing = document.getElementById('self-exclusion-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'self-exclusion-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:20px;';

        var modal = document.createElement('div');
        modal.style.cssText = 'background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid rgba(251,191,36,0.3);border-radius:16px;max-width:480px;width:100%;padding:28px;color:#fff;font-family:inherit;max-height:90vh;overflow-y:auto;';

        modal.innerHTML = '<div style="text-align:center;margin-bottom:20px;">'
            + '<div style="font-size:32px;margin-bottom:8px;">&#9888;&#65039;</div>'
            + '<h2 style="margin:0 0 6px;font-size:20px;color:#fbbf24;">Self-Exclusion</h2>'
            + '<p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);">Take a break from playing. This cannot be reversed early.</p>'
            + '</div>'
            + '<div id="se-status-area" style="margin-bottom:18px;padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;font-size:13px;color:rgba(255,255,255,0.7);text-align:center;">Loading status...</div>'
            + '<div id="se-options" style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">'
            + '<button class="se-btn" data-type="cooldown_24h" style="' + btnStyle('#3b82f6') + '">&#9200; 24-Hour Cooldown</button>'
            + '<button class="se-btn" data-type="cooldown_7d" style="' + btnStyle('#8b5cf6') + '">&#128197; 7-Day Exclusion</button>'
            + '<button class="se-btn" data-type="cooldown_30d" style="' + btnStyle('#f97316') + '">&#128198; 30-Day Exclusion</button>'
            + '<button class="se-btn" data-type="permanent" style="' + btnStyle('#ef4444') + '">&#128683; Permanent Self-Exclusion</button>'
            + '</div>'
            + '<div id="se-confirm-area" style="display:none;margin-bottom:16px;padding:14px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:10px;">'
            + '<p id="se-confirm-text" style="margin:0 0 10px;font-size:13px;color:#fca5a5;"></p>'
            + '<textarea id="se-reason" placeholder="Reason (optional)" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:13px;resize:none;height:60px;margin-bottom:10px;"></textarea>'
            + '<div style="display:flex;gap:8px;">'
            + '<button id="se-confirm-btn" style="flex:1;padding:10px;border:none;border-radius:8px;background:#ef4444;color:#fff;font-weight:700;cursor:pointer;font-size:14px;">Confirm Exclusion</button>'
            + '<button id="se-cancel-btn" style="flex:1;padding:10px;border:none;border-radius:8px;background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-size:14px;">Cancel</button>'
            + '</div>'
            + '</div>'
            + '<div style="text-align:center;">'
            + '<button id="se-close-btn" style="padding:8px 24px;border:none;border-radius:8px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);cursor:pointer;font-size:13px;">Close</button>'
            + '</div>'
            + '<p style="margin:14px 0 0;font-size:11px;color:rgba(255,255,255,0.4);text-align:center;line-height:1.5;">If you need immediate support, contact the National Council on Problem Gambling at 1-800-522-4700 or visit <a href="https://www.ncpgambling.org" target="_blank" style="color:#fbbf24;">ncpgambling.org</a></p>';

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close handlers
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
        document.getElementById('se-close-btn').addEventListener('click', closeModal);

        // Load status
        loadStatus();

        // Button click handlers
        var selectedType = null;
        var btns = modal.querySelectorAll('.se-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function() {
                selectedType = this.getAttribute('data-type');
                var labels = { cooldown_24h: '24 hours', cooldown_7d: '7 days', cooldown_30d: '30 days', permanent: 'permanently (cannot be reversed)' };
                document.getElementById('se-confirm-text').textContent = 'You are about to exclude yourself for ' + labels[selectedType] + '. During this period you will not be able to place any bets or play any games.';
                document.getElementById('se-confirm-area').style.display = 'block';
                document.getElementById('se-options').style.display = 'none';
            });
        }

        document.getElementById('se-cancel-btn').addEventListener('click', function() {
            document.getElementById('se-confirm-area').style.display = 'none';
            document.getElementById('se-options').style.display = 'flex';
            selectedType = null;
        });

        document.getElementById('se-confirm-btn').addEventListener('click', async function() {
            if (!selectedType) return;
            var btn = this;
            btn.disabled = true;
            btn.textContent = 'Processing...';
            try {
                var reason = (document.getElementById('se-reason').value || '').trim();
                var body = { type: selectedType };
                if (reason) body.reason = reason;
                var result = await api('/api/self-exclusion/activate', { method: 'POST', body: JSON.stringify(body) });
                if (result && result.error) {
                    if (typeof showToast === 'function') showToast(result.error, 'error');
                    btn.disabled = false;
                    btn.textContent = 'Confirm Exclusion';
                    return;
                }
                if (typeof showToast === 'function') showToast('Self-exclusion activated. Take care.', 'info');
                // For permanent exclusion, log out
                if (selectedType === 'permanent') {
                    setTimeout(function() {
                        localStorage.removeItem(typeof STORAGE_KEY_TOKEN !== 'undefined' ? STORAGE_KEY_TOKEN : 'casinoToken');
                        window.location.reload();
                    }, 2000);
                } else {
                    closeModal();
                    loadStatus();
                }
            } catch (err) {
                console.warn('[SelfExclusion] Activation failed:', err);
                if (typeof showToast === 'function') showToast('Failed to activate. Please try again.', 'error');
                btn.disabled = false;
                btn.textContent = 'Confirm Exclusion';
            }
        });
    }

    async function loadStatus() {
        var area = document.getElementById('se-status-area');
        if (!area) return;
        try {
            var data = await api('/api/self-exclusion/status');
            if (!data) { area.textContent = 'Sign in to manage self-exclusion.'; return; }
            if (data.excluded) {
                var endsText = data.endsAt ? 'Ends: ' + new Date(data.endsAt).toLocaleString() : 'Permanent';
                area.innerHTML = '<div style="color:#fca5a5;font-weight:600;">&#128683; You are currently self-excluded</div>'
                    + '<div style="margin-top:4px;font-size:12px;">Type: ' + (data.type || 'N/A') + ' &mdash; ' + endsText + '</div>';
                // Hide options if already excluded
                var opts = document.getElementById('se-options');
                if (opts) opts.style.display = 'none';
            } else {
                area.innerHTML = '<div style="color:#4ade80;">&#9989; No active self-exclusion</div>'
                    + '<div style="margin-top:4px;font-size:12px;">Choose an option below if you need a break.</div>';
            }
        } catch (err) {
            console.warn('[SelfExclusion] Status check failed:', err);
            area.textContent = 'Could not load status.';
        }
    }

    function closeModal() {
        var m = document.getElementById('self-exclusion-modal');
        if (m) m.remove();
    }

    function btnStyle(color) {
        return 'width:100%;padding:12px 16px;border:none;border-radius:10px;background:' + color + ';color:#fff;font-weight:700;cursor:pointer;font-size:14px;text-align:left;transition:opacity 0.2s;';
    }

    window.SelfExclusion = {
        show: showSelfExclusionModal,
        checkStatus: loadStatus
    };
})();
