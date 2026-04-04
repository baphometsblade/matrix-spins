/**
 * Slot Events Widget
 * Limited-time FOMO slot events system with animated banners and scarcity indicators
 */

(function() {
    'use strict';

    var events = [];
    var countdownInterval = null;
    var refreshInterval = null;
    var bannerContainer = null;

    // Helper: API request wrapper
    async function api(path, opts) {
        if (typeof apiRequest === 'function') {
            return apiRequest(path, opts);
        }

        var token = localStorage.getItem('casinoToken');
        if (!token) {
            return null;
        }

        var response = await fetch(path, {
            method: opts.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });

        if (!response.ok) {
            console.warn('[slot-events] API error:', response.status);
            return null;
        }

        return await response.json();
    }

    // Format time as MM:SS or HH:MM:SS
    function formatTime(seconds) {
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var secs = seconds % 60;

        if (hours > 0) {
            return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }

        return String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    // Calculate seconds remaining in event
    function getSecondsRemaining(endAtIso) {
        var now = Date.now();
        var endTime = new Date(endAtIso).getTime();
        return Math.max(0, Math.floor((endTime - now) / 1000));
    }

    // Calculate event progress percentage
    function getProgressPercent(startAtIso, endAtIso) {
        var now = Date.now();
        var startTime = new Date(startAtIso).getTime();
        var endTime = new Date(endAtIso).getTime();

        if (now <= startTime) return 0;
        if (now >= endTime) return 100;

        var progress = (now - startTime) / (endTime - startTime) * 100;
        return Math.floor(progress);
    }

    // Generate random player count (23-89)
    function getRandomPlayerCount() {
        return Math.floor(Math.random() * (89 - 23 + 1)) + 23;
    }

    // Create event banner HTML
    function createBanner(event) {
        var secondsRemaining = getSecondsRemaining(event.end_at);
        if (secondsRemaining <= 0) return null;

        var isLowTime = secondsRemaining < 600; // < 10 minutes
        var progressPercent = getProgressPercent(event.start_at, event.end_at);
        var playerCount = getRandomPlayerCount();

        var gameLabel = event.game_id ? 'ON ' + event.game_id.toUpperCase().replace(/-/g, ' ') : 'ALL GAMES';
        var mainText = '';

        if (event.bonus_type === 'multiplier') {
            mainText = event.bonus_value + 'X PAYOUTS ' + gameLabel + '!';
        } else if (event.bonus_type === 'free_spins') {
            mainText = event.bonus_value + ' FREE SPINS ' + gameLabel + '!';
        } else if (event.bonus_type === 'jackpot_multiplier') {
            mainText = event.bonus_value + 'X JACKPOT BOOST ' + gameLabel + '!';
        } else {
            mainText = event.bonus_value + 'X BONUS ' + gameLabel + '!';
        }

        var div = document.createElement('div');
        div.className = 'slot-event-banner';
        div.style.cssText = 'margin: 16px 0; padding: 20px; background: linear-gradient(135deg, rgba(10,5,30,0.95) 0%, rgba(20,10,40,0.95) 100%); border: 2px solid transparent; border-radius: 8px; position: relative; overflow: hidden; animation: goldShimmer 3s ease-in-out infinite;';

        // Add gold shimmer border animation
        if (!document.getElementById('slot-events-styles')) {
            var style = document.createElement('style');
            style.id = 'slot-events-styles';
            style.textContent = `
                @keyframes goldShimmer {
                    0%, 100% { border-color: rgba(255, 215, 0, 0.3); box-shadow: 0 0 15px rgba(255, 215, 0, 0.2); }
                    50% { border-color: rgba(255, 215, 0, 0.7); box-shadow: 0 0 25px rgba(255, 215, 0, 0.4); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
                .slot-event-pulsing {
                    animation: pulse 0.8s ease-in-out infinite;
                }
                @keyframes slideInDown {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .slot-event-banner {
                    animation: slideInDown 0.5s ease-out;
                }
            `;
            document.head.appendChild(style);
        }

        // Icon
        var icon = document.createElement('div');
        icon.style.cssText = 'display: inline-block; font-size: 32px; margin-right: 12px; vertical-align: middle;';
        if (event.bonus_type === 'free_spins') {
            icon.textContent = '🎁';
        } else if (event.bonus_type === 'jackpot_multiplier') {
            icon.textContent = '💎';
        } else {
            icon.textContent = '⚡';
        }

        // Title and main text
        var titleContainer = document.createElement('div');
        titleContainer.style.cssText = 'display: inline-block; vertical-align: middle;';

        var title = document.createElement('div');
        title.style.cssText = 'font-size: 14px; color: rgba(255, 215, 0, 0.8); font-weight: 600; letter-spacing: 0.5px;';
        title.textContent = event.name;

        var mainMessage = document.createElement('div');
        mainMessage.style.cssText = 'font-size: 20px; color: #ffffff; font-weight: 800; margin: 6px 0 0 0; letter-spacing: 1px;';
        mainMessage.textContent = mainText;

        titleContainer.appendChild(title);
        titleContainer.appendChild(mainMessage);

        var leftSection = document.createElement('div');
        leftSection.style.cssText = 'margin-bottom: 16px;';
        leftSection.appendChild(icon);
        leftSection.appendChild(titleContainer);

        // Countdown timer
        var countdownSection = document.createElement('div');
        countdownSection.style.cssText = 'margin: 12px 0 16px 0; display: flex; align-items: center; gap: 20px;';

        var timerLabel = document.createElement('div');
        timerLabel.style.cssText = 'font-size: 12px; color: rgba(255, 215, 0, 0.7); font-weight: 600; text-transform: uppercase;';
        timerLabel.textContent = 'ENDS IN';

        var timerValue = document.createElement('div');
        timerValue.className = 'slot-event-timer-' + event.id;
        timerValue.style.cssText = 'font-size: 24px; font-weight: 900; color: ' + (isLowTime ? '#ff4444' : '#ffd700') + '; font-family: monospace; letter-spacing: 2px;';
        timerValue.textContent = formatTime(secondsRemaining);

        countdownSection.appendChild(timerLabel);
        countdownSection.appendChild(timerValue);

        // Scarcity indicators
        var scarcitySection = document.createElement('div');
        scarcitySection.style.cssText = 'margin: 12px 0 16px 0; font-size: 12px;';

        var scarcityText = document.createElement('div');
        scarcityText.className = 'slot-event-scarcity-' + event.id;
        scarcityText.style.cssText = 'color: #ff4444; font-weight: 700; margin-bottom: 8px; animation: pulse 1.2s ease-in-out infinite;';
        scarcityText.textContent = 'ONLY ' + formatTime(secondsRemaining) + ' REMAINING!';

        var playerInfo = document.createElement('div');
        playerInfo.style.cssText = 'color: rgba(255, 215, 0, 0.7); font-size: 11px; margin-bottom: 8px;';
        playerInfo.textContent = playerCount + ' PLAYERS COMPETING';

        scarcitySection.appendChild(scarcityText);
        scarcitySection.appendChild(playerInfo);

        // Progress bar
        var progressBarOuter = document.createElement('div');
        progressBarOuter.style.cssText = 'width: 100%; height: 6px; background: rgba(255, 215, 0, 0.15); border-radius: 3px; overflow: hidden; margin-bottom: 12px;';

        var progressBarInner = document.createElement('div');
        progressBarInner.className = 'slot-event-progress-' + event.id;
        progressBarInner.style.cssText = 'height: 100%; background: linear-gradient(90deg, #ffd700, #ffed4e); width: ' + progressPercent + '%; transition: width 1s linear; border-radius: 3px;';

        progressBarOuter.appendChild(progressBarInner);

        // CTA button
        var ctaButton = document.createElement('button');
        ctaButton.style.cssText = 'padding: 12px 24px; background: linear-gradient(135deg, #ffd700, #ffed4e); color: #0a0a1a; border: none; border-radius: 6px; font-weight: 800; font-size: 14px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3); animation: ctaPulse 1.5s ease-in-out infinite;';
        ctaButton.textContent = 'PLAY NOW';
        ctaButton.onmouseover = function() {
            this.style.transform = 'scale(1.05)';
            this.style.boxShadow = '0 6px 25px rgba(255, 215, 0, 0.5)';
        };
        ctaButton.onmouseout = function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 4px 15px rgba(255, 215, 0, 0.3)';
        };
        ctaButton.onclick = function() {
            window.location.hash = '#games';
        };

        // Inject CTA pulse animation
        if (!document.getElementById('cta-pulse-style')) {
            var ctaStyle = document.createElement('style');
            ctaStyle.id = 'cta-pulse-style';
            ctaStyle.textContent = '@keyframes ctaPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }';
            document.head.appendChild(ctaStyle);
        }

        var contentWrapper = document.createElement('div');
        contentWrapper.appendChild(leftSection);
        contentWrapper.appendChild(countdownSection);
        contentWrapper.appendChild(scarcitySection);
        contentWrapper.appendChild(progressBarOuter);
        contentWrapper.appendChild(ctaButton);

        div.appendChild(contentWrapper);

        return div;
    }

    // Render all active event banners
    function renderBanners() {
        if (!bannerContainer) {
            bannerContainer = document.getElementById('slot-events-container');
            if (!bannerContainer) {
                // Try to insert after header or at top of main content
                var header = document.querySelector('header, .header, [role="banner"]');
                if (header && header.parentNode) {
                    bannerContainer = document.createElement('div');
                    bannerContainer.id = 'slot-events-container';
                    header.parentNode.insertBefore(bannerContainer, header.nextSibling);
                } else {
                    return;
                }
            }
        }

        bannerContainer.innerHTML = '';

        var activeEvents = events.filter(function(e) {
            return getSecondsRemaining(e.end_at) > 0;
        });

        if (activeEvents.length === 0) {
            removeNotificationDot();
            return;
        }

        activeEvents.forEach(function(event) {
            var banner = createBanner(event);
            if (banner) {
                bannerContainer.appendChild(banner);
            }
        });

        addNotificationDot(activeEvents.length);
    }

    // Add notification dot to events icon in nav
    function addNotificationDot(count) {
        var existingDot = document.getElementById('slot-events-dot');
        if (existingDot) {
            existingDot.textContent = count;
            return;
        }

        // Try to find events button/icon in nav
        var navButtons = document.querySelectorAll('[data-nav-item], .nav-item, [role="navigation"] button');
        var eventsButton = null;

        // Look for button containing "event" or similar
        for (var i = 0; i < navButtons.length; i++) {
            var btn = navButtons[i];
            if (btn.textContent.toLowerCase().includes('event') || btn.className.includes('event')) {
                eventsButton = btn;
                break;
            }
        }

        if (!eventsButton) {
            // If no events button found, create one or skip
            return;
        }

        var dot = document.createElement('div');
        dot.id = 'slot-events-dot';
        dot.style.cssText = 'position: absolute; top: -4px; right: -4px; background: #ff4444; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; box-shadow: 0 0 10px rgba(255, 68, 68, 0.6); animation: pulse 0.8s ease-in-out infinite;';
        dot.textContent = count;

        eventsButton.style.position = 'relative';
        eventsButton.appendChild(dot);
    }

    // Remove notification dot
    function removeNotificationDot() {
        var dot = document.getElementById('slot-events-dot');
        if (dot) {
            dot.remove();
        }
    }

    // Update all countdown timers
    function updateCountdowns() {
        events.forEach(function(event) {
            var secondsRemaining = getSecondsRemaining(event.end_at);
            var timerElem = document.querySelector('.slot-event-timer-' + event.id);
            var scarcityElem = document.querySelector('.slot-event-scarcity-' + event.id);
            var progressElem = document.querySelector('.slot-event-progress-' + event.id);

            if (timerElem) {
                timerElem.textContent = formatTime(secondsRemaining);
                // Red when < 10 min
                timerElem.style.color = secondsRemaining < 600 ? '#ff4444' : '#ffd700';
            }

            if (scarcityElem) {
                scarcityElem.textContent = 'ONLY ' + formatTime(secondsRemaining) + ' REMAINING!';
            }

            if (progressElem) {
                var progressPercent = getProgressPercent(event.start_at, event.end_at);
                progressElem.style.width = progressPercent + '%';
            }

            // Remove expired events
            if (secondsRemaining <= 0) {
                events = events.filter(function(e) { return e.id !== event.id; });
                renderBanners();
            }
        });
    }

    // Fetch active events from API
    async function fetchEvents() {
        try {
            var data = await api('/api/slot-events');
            if (data && Array.isArray(data)) {
                events = data;
                renderBanners();
            }
        } catch (err) {
            console.warn('[slot-events] Fetch failed:', err.message);
        }
    }

    // Initialize widget
    function init() {
        // Fetch events immediately
        fetchEvents();

        // Update countdowns every second
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(updateCountdowns, 1000);

        // Refresh event list every 30s
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(fetchEvents, 30000);
    }

    // Cleanup on unload
    window.addEventListener('beforeunload', function() {
        if (countdownInterval) clearInterval(countdownInterval);
        if (refreshInterval) clearInterval(refreshInterval);
    });

    // Expose public API
    window.SlotEvents = {
        init: init
    };

})();
