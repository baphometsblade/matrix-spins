// ═══════════════════════════════════════════════════════════════════════════
// Sound Settings UI Module — Casino Dark Theme with Gold Accents
// ═══════════════════════════════════════════════════════════════════════════
// Exposes: window.SoundSettings = { init(), show() }
// localStorage key: 'matrixSpins_soundPrefs'
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Default Preferences ──────────────────────────────────────────────
    var DEFAULT_PREFS = {
        masterVolume: 100,
        music: true,
        sfx: true,
        ambience: true,
        uiClicks: true,
        muteAll: false
    };

    var prefs = {};
    var modalElement = null;

    // ── Initialize Preferences from localStorage ──────────────────────
    function init() {
        try {
            var stored = localStorage.getItem('matrixSpins_soundPrefs');
            if (stored) {
                prefs = Object.assign({}, DEFAULT_PREFS, JSON.parse(stored));
            } else {
                prefs = Object.assign({}, DEFAULT_PREFS);
            }
        } catch (e) {
            console.warn('SoundSettings: Failed to parse stored prefs, using defaults:', e);
            prefs = Object.assign({}, DEFAULT_PREFS);
        }

        applyPreferences();
    }

    // ── Apply Preferences to Existing Sound System ───────────────────
    function applyPreferences() {
        // Set master volume in SoundManager if available
        if (typeof setSoundVolume === 'function') {
            var volumeRatio = prefs.masterVolume / 100;
            setSoundVolume(volumeRatio);
        } else if (window.SoundManager && typeof window.SoundManager.setSoundVolume === 'function') {
            var volumeRatio = prefs.masterVolume / 100;
            window.SoundManager.setSoundVolume(volumeRatio);
        }

        // Apply mute all
        if (prefs.muteAll) {
            if (typeof toggleSound === 'function') {
                toggleSound(false);
            } else if (window.SoundManager && typeof window.SoundManager.setSoundEnabled === 'function') {
                window.SoundManager.setSoundEnabled(false);
            }
        }

        // Store updated prefs
        savePref();
    }

    // ── Save Preferences to localStorage ─────────────────────────────
    function savePref() {
        try {
            localStorage.setItem('matrixSpins_soundPrefs', JSON.stringify(prefs));
        } catch (e) {
            console.warn('SoundSettings: Failed to save preferences:', e);
        }
    }

    // ── Play Preview Sound ───────────────────────────────────────────
    function playPreview() {
        if (!prefs.muteAll && typeof playSound === 'function') {
            playSound('spin');
        }
    }

    // ── Create Modal DOM ─────────────────────────────────────────────
    function createModal() {
        var container = document.createElement('div');
        container.id = 'sound-settings-overlay';
        container.innerHTML = '\
            <div class="sound-settings-modal">\
                <div class="sound-settings-header">\
                    <h2>Sound Settings</h2>\
                    <button class="sound-settings-close" aria-label="Close">&times;</button>\
                </div>\
                <div class="sound-settings-content">\
                    <!-- Master Volume -->\
                    <div class="sound-settings-group">\
                        <label for="master-volume">Master Volume</label>\
                        <div class="sound-settings-slider-container">\
                            <input type="range" id="master-volume" class="sound-settings-slider" min="0" max="100" />\
                            <span class="sound-settings-value">100%</span>\
                        </div>\
                    </div>\
                    \
                    <!-- Mute All Toggle -->\
                    <div class="sound-settings-group">\
                        <label class="sound-settings-toggle">\
                            <input type="checkbox" id="mute-all" />\
                            <span>Mute All</span>\
                        </label>\
                    </div>\
                    \
                    <!-- Category Toggles -->\
                    <div class="sound-settings-divider">Sound Categories</div>\
                    \
                    <div class="sound-settings-group">\
                        <label class="sound-settings-toggle">\
                            <input type="checkbox" id="toggle-music" />\
                            <span>Music</span>\
                        </label>\
                    </div>\
                    \
                    <div class="sound-settings-group">\
                        <label class="sound-settings-toggle">\
                            <input type="checkbox" id="toggle-sfx" />\
                            <span>SFX (Spins, Wins)</span>\
                        </label>\
                    </div>\
                    \
                    <div class="sound-settings-group">\
                        <label class="sound-settings-toggle">\
                            <input type="checkbox" id="toggle-ambience" />\
                            <span>Ambience</span>\
                        </label>\
                    </div>\
                    \
                    <div class="sound-settings-group">\
                        <label class="sound-settings-toggle">\
                            <input type="checkbox" id="toggle-ui-clicks" />\
                            <span>UI Clicks</span>\
                        </label>\
                    </div>\
                    \
                    <!-- Preview Button -->\
                    <div class="sound-settings-preview">\
                        <button id="sound-preview-btn" class="sound-settings-button">Play Preview</button>\
                    </div>\
                </div>\
            </div>\
        ';

        return container;
    }

    // ── Inject Styles ────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('sound-settings-styles')) {
            return; // Already injected
        }

        var style = document.createElement('style');
        style.id = 'sound-settings-styles';
        style.textContent = `
            #sound-settings-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.3s ease-out;
            }

            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            .sound-settings-modal {
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                border: 2px solid #fbbf24;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(251, 191, 36, 0.2);
                max-width: 400px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            .sound-settings-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                border-bottom: 1px solid rgba(251, 191, 36, 0.3);
                background: linear-gradient(135deg, rgba(26, 26, 46, 0.9) 0%, rgba(22, 33, 62, 0.9) 100%);
            }

            .sound-settings-header h2 {
                margin: 0;
                color: #fbbf24;
                font-size: 24px;
                font-weight: 600;
                letter-spacing: 0.5px;
            }

            .sound-settings-close {
                background: none;
                border: none;
                color: #fbbf24;
                font-size: 32px;
                cursor: pointer;
                padding: 0;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
                transition: all 0.2s ease;
                line-height: 1;
            }

            .sound-settings-close:hover {
                background: rgba(251, 191, 36, 0.1);
                color: #fcd34d;
            }

            .sound-settings-content {
                padding: 20px;
            }

            .sound-settings-group {
                margin-bottom: 18px;
            }

            .sound-settings-group > label:first-child:not(.sound-settings-toggle) {
                display: block;
                color: #e0e0e0;
                font-size: 14px;
                font-weight: 500;
                margin-bottom: 8px;
                letter-spacing: 0.3px;
            }

            .sound-settings-slider-container {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .sound-settings-slider {
                flex: 1;
                height: 6px;
                -webkit-appearance: none;
                appearance: none;
                background: linear-gradient(to right, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.3));
                border-radius: 3px;
                outline: none;
                cursor: pointer;
            }

            .sound-settings-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(251, 191, 36, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3);
                border: 2px solid #fbbf24;
                transition: all 0.2s ease;
            }

            .sound-settings-slider::-webkit-slider-thumb:hover {
                box-shadow: 0 4px 12px rgba(251, 191, 36, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.3);
                transform: scale(1.1);
            }

            .sound-settings-slider::-moz-range-thumb {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(251, 191, 36, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.3);
                border: 2px solid #fbbf24;
                transition: all 0.2s ease;
            }

            .sound-settings-slider::-moz-range-thumb:hover {
                box-shadow: 0 4px 12px rgba(251, 191, 36, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.3);
                transform: scale(1.1);
            }

            .sound-settings-value {
                color: #fbbf24;
                font-weight: 600;
                font-size: 14px;
                min-width: 45px;
                text-align: right;
                letter-spacing: 0.3px;
            }

            .sound-settings-toggle {
                display: flex;
                align-items: center;
                cursor: pointer;
                user-select: none;
                gap: 10px;
            }

            .sound-settings-toggle input[type="checkbox"] {
                width: 20px;
                height: 20px;
                cursor: pointer;
                accent-color: #fbbf24;
                transition: all 0.2s ease;
            }

            .sound-settings-toggle input[type="checkbox"]:hover {
                transform: scale(1.1);
            }

            .sound-settings-toggle span {
                color: #e0e0e0;
                font-size: 14px;
                font-weight: 500;
            }

            .sound-settings-divider {
                color: #fbbf24;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin: 24px 0 16px 0;
                padding-top: 16px;
                border-top: 1px solid rgba(251, 191, 36, 0.2);
            }

            .sound-settings-preview {
                margin-top: 24px;
                padding-top: 16px;
                border-top: 1px solid rgba(251, 191, 36, 0.2);
                text-align: center;
            }

            .sound-settings-button {
                background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                color: #1a1a2e;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 15px rgba(251, 191, 36, 0.3);
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }

            .sound-settings-button:hover {
                background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
                box-shadow: 0 6px 20px rgba(251, 191, 36, 0.5);
                transform: translateY(-2px);
            }

            .sound-settings-button:active {
                transform: translateY(0);
                box-shadow: 0 2px 10px rgba(251, 191, 36, 0.3);
            }

            @media (max-width: 480px) {
                .sound-settings-modal {
                    width: 95%;
                    max-height: 85vh;
                }

                .sound-settings-header h2 {
                    font-size: 20px;
                }

                .sound-settings-content {
                    padding: 16px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // ── Update Modal UI from Preferences ────────────────────────────
    function updateModalUI() {
        if (!modalElement) return;

        var masterVolumeInput = modalElement.querySelector('#master-volume');
        var masterVolumeValue = modalElement.querySelector('.sound-settings-value');
        var muteAllCheckbox = modalElement.querySelector('#mute-all');
        var musicCheckbox = modalElement.querySelector('#toggle-music');
        var sfxCheckbox = modalElement.querySelector('#toggle-sfx');
        var ambienceCheckbox = modalElement.querySelector('#toggle-ambience');
        var uiClicksCheckbox = modalElement.querySelector('#toggle-ui-clicks');

        if (masterVolumeInput) {
            masterVolumeInput.value = prefs.masterVolume;
            masterVolumeValue.textContent = prefs.masterVolume + '%';
        }
        if (muteAllCheckbox) muteAllCheckbox.checked = prefs.muteAll;
        if (musicCheckbox) musicCheckbox.checked = prefs.music;
        if (sfxCheckbox) sfxCheckbox.checked = prefs.sfx;
        if (ambienceCheckbox) ambienceCheckbox.checked = prefs.ambience;
        if (uiClicksCheckbox) uiClicksCheckbox.checked = prefs.uiClicks;
    }

    // ── Attach Event Handlers ────────────────────────────────────────
    function attachEventHandlers() {
        if (!modalElement) return;

        var overlay = modalElement;
        var closeBtn = modalElement.querySelector('.sound-settings-close');
        var masterVolumeInput = modalElement.querySelector('#master-volume');
        var masterVolumeValue = modalElement.querySelector('.sound-settings-value');
        var muteAllCheckbox = modalElement.querySelector('#mute-all');
        var musicCheckbox = modalElement.querySelector('#toggle-music');
        var sfxCheckbox = modalElement.querySelector('#toggle-sfx');
        var ambienceCheckbox = modalElement.querySelector('#toggle-ambience');
        var uiClicksCheckbox = modalElement.querySelector('#toggle-ui-clicks');
        var previewBtn = modalElement.querySelector('#sound-preview-btn');

        // Close modal
        closeBtn.addEventListener('click', hideModal);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                hideModal();
            }
        });

        // Master volume slider
        masterVolumeInput.addEventListener('input', function () {
            prefs.masterVolume = parseInt(this.value, 10);
            masterVolumeValue.textContent = prefs.masterVolume + '%';
            applyPreferences();
        });

        // Mute all toggle
        muteAllCheckbox.addEventListener('change', function () {
            prefs.muteAll = this.checked;
            if (typeof toggleSound === 'function') {
                toggleSound(!this.checked);
            } else if (window.SoundManager && typeof window.SoundManager.setSoundEnabled === 'function') {
                window.SoundManager.setSoundEnabled(!this.checked);
            }
            savePref();
        });

        // Category toggles
        musicCheckbox.addEventListener('change', function () {
            prefs.music = this.checked;
            savePref();
        });

        sfxCheckbox.addEventListener('change', function () {
            prefs.sfx = this.checked;
            savePref();
        });

        ambienceCheckbox.addEventListener('change', function () {
            prefs.ambience = this.checked;
            savePref();
        });

        uiClicksCheckbox.addEventListener('change', function () {
            prefs.uiClicks = this.checked;
            savePref();
        });

        // Preview button
        previewBtn.addEventListener('click', playPreview);
    }

    // ── Show Modal ───────────────────────────────────────────────────
    function show() {
        if (modalElement && modalElement.parentNode) {
            return; // Already shown
        }

        injectStyles();
        modalElement = createModal();
        updateModalUI();
        attachEventHandlers();
        document.body.appendChild(modalElement);
    }

    // ── Hide Modal ───────────────────────────────────────────────────
    function hideModal() {
        if (modalElement && modalElement.parentNode) {
            modalElement.parentNode.removeChild(modalElement);
            modalElement = null;
        }
    }

    // ── Expose API ───────────────────────────────────────────────────
    window.SoundSettings = {
        init: init,
        show: show,
        hidModal: hideModal,
        getPrefs: function () { return Object.assign({}, prefs); },
        setPrefs: function (newPrefs) {
            prefs = Object.assign(prefs, newPrefs);
            applyPreferences();
        }
    };

})();
