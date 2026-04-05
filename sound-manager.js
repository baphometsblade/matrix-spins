// ═══════════════════════════════════════════════════════════════════════════
// Casino Sound Manager - Standalone Sound System Module
// ═══════════════════════════════════════════════════════════════════════════
// Load via <script src="sound-manager.js"></script> before app.js.
// Exposes global functions: getAudioContext, playSound, toggleSound,
// updateSoundButton, setSoundVolume  and the SoundManager namespace.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ────────────────────────────────────────────────────────────
    var soundEnabled = localStorage.getItem('soundEnabled') === 'true';

    var soundVolume = (function () {
        var stored = parseFloat(localStorage.getItem('casinoSoundVolume'));
        return isNaN(stored) ? 0.5 : Math.max(0.0, Math.min(1.0, stored));
    })();

    // Shared AudioContext - reuse a single instance to avoid browser limits
    var sharedAudioContext = null;

    // ── AudioContext Helper ──────────────────────────────────────────────
    function getAudioContext() {
        if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume();
        }
        return sharedAudioContext;
    }

    // ── Play Sound ──────────────────────────────────────────────────────
    // ── Provider SFX Themes ───────────────────────────────────────────────
    var PROVIDER_SFX_THEMES = {
        novaspin: {
            // Sci-fi electronic — sawtooth/square waves, high frequencies, rapid arpeggios
            spin:     { waveType: 'sine',     freqs: [800, 1200, 1600],              dur: 0.10, spacing: 0.035 },
            win:      { waveType: 'sine',     freqs: [880, 1108, 1318],              dur: 0.18, spacing: 0.06  },
            bigwin:   { waveType: 'sine',     freqs: [880, 1108, 1318, 1760],        dur: 0.35, spacing: 0.055 },
            ambient:  { waveType: 'sawtooth', freq: 110,  filterFreq: 800,  filterQ: 5, gain: 0.08, type: 'drone' },
            scatter:  { waveType: 'square',   freqs: [1600, 2000, 2400, 1800],       dur: 0.12, spacing: 0.03  },
            megawin:  { waveType: 'sawtooth', freqs: [880, 1108, 1318, 1760, 2200, 2640], dur: 0.30, spacing: 0.045 },
            jackpot:  { waveType: 'square',   freqs: [880, 1108, 1318, 1760, 2200, 2640, 3300], dur: 0.40, spacing: 0.05 },
            nearmiss: { waveType: 'sawtooth', freqs: [440, 415],                     dur: 0.35 },
            hover:    { waveType: 'square',   freq: 2400,                            dur: 0.025 },
            count:    { waveType: 'square',   freq: 1800,                            dur: 0.02  },
            reelstop: { waveType: 'sawtooth', freq: 180,                             dur: 0.06  },
        },
        'mythic-forge': {
            // Heavenly/orchestral — sine/triangle waves, harmonic intervals, slow arpeggios
            spin:     { waveType: 'sine',     freqs: [523, 659, 784],                dur: 0.18, spacing: 0.07  },
            win:      { waveType: 'sine',     freqs: [523, 659, 784, 1047],          dur: 0.38, spacing: 0.09  },
            bigwin:   { waveType: 'sine',     freqs: [523, 659, 784, 988, 1047],     dur: 0.55, spacing: 0.09  },
            ambient:  { waveType: 'sine',     freq: 174,  filterFreq: 600,  filterQ: 2, gain: 0.06, type: 'drone' },
            scatter:  { waveType: 'sine',     freqs: [1047, 1318, 1568, 2093],       dur: 0.25, spacing: 0.10  },
            megawin:  { waveType: 'sine',     freqs: [523, 659, 784, 988, 1047, 1318, 1568], dur: 0.50, spacing: 0.08 },
            jackpot:  { waveType: 'sine',     freqs: [523, 659, 784, 988, 1047, 1318, 1568, 2093], dur: 0.60, spacing: 0.09 },
            nearmiss: { waveType: 'triangle', freqs: [392, 370],                     dur: 0.50 },
            hover:    { waveType: 'sine',     freq: 1568,                            dur: 0.04  },
            count:    { waveType: 'sine',     freq: 1047,                            dur: 0.03  },
            reelstop: { waveType: 'triangle', freq: 220,                             dur: 0.08  },
        },
        ironclad: {
            // Industrial/earthy — square waves, low frequencies, staccato
            spin:     { waveType: 'triangle', freqs: [220, 277, 330],                dur: 0.18, spacing: 0.06  },
            win:      { waveType: 'triangle', freqs: [220, 330, 440],                dur: 0.35, spacing: 0.09  },
            bigwin:   { waveType: 'triangle', freqs: [110, 165, 220, 330],           dur: 0.55, spacing: 0.09  },
            ambient:  { waveType: 'square',   freq: 55,   filterFreq: 300,  filterQ: 8, gain: 0.05, type: 'drone' },
            scatter:  { waveType: 'square',   freqs: [330, 440, 330, 550],           dur: 0.10, spacing: 0.05  },
            megawin:  { waveType: 'square',   freqs: [110, 165, 220, 330, 440, 550], dur: 0.45, spacing: 0.07  },
            jackpot:  { waveType: 'square',   freqs: [110, 165, 220, 330, 440, 550, 660], dur: 0.55, spacing: 0.08 },
            nearmiss: { waveType: 'square',   freqs: [165, 155],                     dur: 0.30 },
            hover:    { waveType: 'square',   freq: 660,                             dur: 0.02  },
            count:    { waveType: 'square',   freq: 440,                             dur: 0.02  },
            reelstop: { waveType: 'square',   freq: 80,                              dur: 0.07  },
        },
        'golden-reels': {
            // Luxe/elegant — sine waves, warm frequencies, smooth legato
            spin:     { waveType: 'sine',     freqs: [1046, 1318, 1568],             dur: 0.08, spacing: 0.04  },
            win:      { waveType: 'sine',     freqs: [1047, 1319, 1568, 2093],       dur: 0.22, spacing: 0.06  },
            bigwin:   { waveType: 'sine',     freqs: [1047, 1319, 1568, 2093, 2637], dur: 0.40, spacing: 0.055 },
            ambient:  { waveType: 'sine',     freq: 220,  filterFreq: 1200, filterQ: 1, gain: 0.06, type: 'drone' },
            scatter:  { waveType: 'sine',     freqs: [1568, 2093, 2637, 3136],       dur: 0.20, spacing: 0.08  },
            megawin:  { waveType: 'sine',     freqs: [1047, 1319, 1568, 2093, 2637, 3136], dur: 0.45, spacing: 0.06 },
            jackpot:  { waveType: 'sine',     freqs: [1047, 1319, 1568, 2093, 2637, 3136, 3951], dur: 0.55, spacing: 0.065 },
            nearmiss: { waveType: 'sine',     freqs: [523, 494],                     dur: 0.45 },
            hover:    { waveType: 'sine',     freq: 2093,                            dur: 0.035 },
            count:    { waveType: 'sine',     freq: 1568,                            dur: 0.025 },
            reelstop: { waveType: 'sine',     freq: 262,                             dur: 0.09  },
        },
        vaultx: {
            // Techy/tense — sawtooth waves, minor intervals, staccato clicks
            spin:     { waveType: 'sawtooth', freqs: [110, 165],                     dur: 0.14, spacing: 0.07  },
            win:      { waveType: 'sawtooth', freqs: [165, 220, 277],                dur: 0.28, spacing: 0.07  },
            bigwin:   { waveType: 'sawtooth', freqs: [110, 165, 220, 277],           dur: 0.45, spacing: 0.07  },
            ambient:  { waveType: 'sawtooth', freq: 73,   filterFreq: 400,  filterQ: 10, gain: 0.04, type: 'drone' },
            scatter:  { waveType: 'sawtooth', freqs: [277, 330, 415, 277],           dur: 0.10, spacing: 0.04  },
            megawin:  { waveType: 'sawtooth', freqs: [110, 165, 220, 277, 330, 415], dur: 0.38, spacing: 0.06  },
            jackpot:  { waveType: 'sawtooth', freqs: [110, 165, 220, 277, 330, 415, 554], dur: 0.50, spacing: 0.065 },
            nearmiss: { waveType: 'sawtooth', freqs: [220, 208],                     dur: 0.30 },
            hover:    { waveType: 'sawtooth', freq: 880,                             dur: 0.02  },
            count:    { waveType: 'sawtooth', freq: 554,                             dur: 0.018 },
            reelstop: { waveType: 'sawtooth', freq: 95,                              dur: 0.05  },
        },
        solstice: {
            // Eastern/mystical — triangle waves, pentatonic scale, medium tempo
            spin:     { waveType: 'sine',     freqs: [293, 329, 392],                dur: 0.22, spacing: 0.09  },
            win:      { waveType: 'sine',     freqs: [293, 349, 440, 587],           dur: 0.45, spacing: 0.11  },
            bigwin:   { waveType: 'sine',     freqs: [220, 293, 349, 440, 587],      dur: 0.65, spacing: 0.11  },
            ambient:  { waveType: 'triangle', freq: 146,  filterFreq: 500,  filterQ: 3, gain: 0.06, type: 'drone' },
            scatter:  { waveType: 'triangle', freqs: [587, 659, 784, 880],           dur: 0.18, spacing: 0.09  },
            megawin:  { waveType: 'triangle', freqs: [293, 349, 440, 587, 659, 880], dur: 0.55, spacing: 0.09  },
            jackpot:  { waveType: 'triangle', freqs: [220, 293, 349, 440, 587, 659, 880], dur: 0.70, spacing: 0.10 },
            nearmiss: { waveType: 'triangle', freqs: [349, 330],                     dur: 0.40 },
            hover:    { waveType: 'triangle', freq: 880,                             dur: 0.035 },
            count:    { waveType: 'triangle', freq: 659,                             dur: 0.025 },
            reelstop: { waveType: 'triangle', freq: 165,                             dur: 0.08  },
        },
        'shadow-works': {
            // Gothic/eerie — sawtooth waves, dissonant intervals, slow with reverb
            spin:     { waveType: 'square',   freqs: [233, 277],                     dur: 0.16, spacing: 0.08  },
            win:      { waveType: 'square',   freqs: [233, 277, 311],                dur: 0.32, spacing: 0.08  },
            bigwin:   { waveType: 'square',   freqs: [185, 233, 277, 311],           dur: 0.50, spacing: 0.08  },
            ambient:  { waveType: 'sawtooth', freq: 82,   filterFreq: 350,  filterQ: 7, gain: 0.05, type: 'drone' },
            scatter:  { waveType: 'sawtooth', freqs: [311, 370, 415, 466],           dur: 0.22, spacing: 0.10  },
            megawin:  { waveType: 'sawtooth', freqs: [185, 233, 277, 311, 370, 466], dur: 0.55, spacing: 0.09  },
            jackpot:  { waveType: 'sawtooth', freqs: [185, 233, 277, 311, 370, 466, 554], dur: 0.65, spacing: 0.095 },
            nearmiss: { waveType: 'sawtooth', freqs: [277, 262],                     dur: 0.50 },
            hover:    { waveType: 'square',   freq: 622,                             dur: 0.03  },
            count:    { waveType: 'square',   freq: 466,                             dur: 0.025 },
            reelstop: { waveType: 'sawtooth', freq: 100,                             dur: 0.10  },
        },
        'wild-frontier': {
            // Retro 8-bit — square waves, classic game frequencies, fast bleeps
            spin:     { waveType: 'square',   freqs: [440, 660],                     dur: 0.07, spacing: 0.04  },
            win:      { waveType: 'square',   freqs: [440, 554, 660, 880],           dur: 0.16, spacing: 0.045 },
            bigwin:   { waveType: 'square',   freqs: [440, 554, 660, 880, 1108],     dur: 0.28, spacing: 0.045 },
            ambient:  { waveType: 'square',   freq: 110,  filterFreq: 500,  filterQ: 4, gain: 0.04, type: 'drone' },
            scatter:  { waveType: 'square',   freqs: [1320, 1760, 2200, 1320],       dur: 0.06, spacing: 0.03  },
            megawin:  { waveType: 'square',   freqs: [440, 554, 660, 880, 1108, 1320], dur: 0.22, spacing: 0.04 },
            jackpot:  { waveType: 'square',   freqs: [440, 554, 660, 880, 1108, 1320, 1760], dur: 0.30, spacing: 0.04 },
            nearmiss: { waveType: 'square',   freqs: [330, 311],                     dur: 0.20 },
            hover:    { waveType: 'square',   freq: 1760,                            dur: 0.02  },
            count:    { waveType: 'square',   freq: 1320,                            dur: 0.015 },
            reelstop: { waveType: 'square',   freq: 150,                             dur: 0.04  },
        },
    };

    // ── Aliases: map new studio theme keys to closest SFX configs ──
    PROVIDER_SFX_THEMES.goldenreels  = PROVIDER_SFX_THEMES['golden-reels'];
    PROVIDER_SFX_THEMES.nebula       = PROVIDER_SFX_THEMES['mythic-forge'];
    PROVIDER_SFX_THEMES.mythicforge  = PROVIDER_SFX_THEMES.solstice;
    PROVIDER_SFX_THEMES.wildfrontier = PROVIDER_SFX_THEMES['golden-reels'];
    PROVIDER_SFX_THEMES.shadowworks  = PROVIDER_SFX_THEMES['shadow-works'];
    PROVIDER_SFX_THEMES.dragonpearl  = PROVIDER_SFX_THEMES.vaultx;
    PROVIDER_SFX_THEMES.ironclad     = PROVIDER_SFX_THEMES.ironclad;
    PROVIDER_SFX_THEMES.cascadelabs  = PROVIDER_SFX_THEMES.novaspin;

    function playProviderSound(soundType, game) {
        var key   = (typeof getGameChromeStyle === 'function' && game) ? getGameChromeStyle(game) : '';
        var theme = PROVIDER_SFX_THEMES[key];
        if (!theme || !theme[soundType]) { playSound(soundType); return; }
        if (!soundEnabled) return;
        try {
            var audioContext = getAudioContext();
            var profile = theme[soundType];
            if (!profile.freqs || !Array.isArray(profile.freqs)) { playSound(soundType); return; }
            var now = audioContext.currentTime;
            profile.freqs.forEach(function(freq, i) {
                var osc  = audioContext.createOscillator();
                var gain = audioContext.createGain();
                osc.type = profile.waveType;
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.frequency.value = freq;
                var t = now + i * profile.spacing;
                gain.gain.setValueAtTime(0.18 * soundVolume, t);
                gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, t + profile.dur);
                osc.start(t);
                osc.stop(t + profile.dur + 0.02);
            });
        } catch(e) { /* ignore audio errors in headless environments */ }
    }

    function playSound(type) {
        if (!soundEnabled) return;

        try {
            var audioContext = getAudioContext();
            var gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);

            var now = audioContext.currentTime;

            switch (type) {
                case 'spin':
                    // Classic spin start sound - rising pitch
                    {
                        var osc = audioContext.createOscillator();
                        osc.connect(gainNode);
                        gainNode.gain.setValueAtTime(0.3 * soundVolume, now);
                        gainNode.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.15);
                        osc.frequency.setValueAtTime(300, now);
                        osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
                        osc.start(now);
                        osc.stop(now + 0.15);
                    }
                    break;

                case 'click':
                    // UI button click - short percussive sound
                    {
                        var osc = audioContext.createOscillator();
                        osc.connect(gainNode);
                        gainNode.gain.setValueAtTime(0.15 * soundVolume, now);
                        gainNode.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.05);
                        osc.frequency.value = 1200;
                        osc.start(now);
                        osc.stop(now + 0.05);
                    }
                    break;

                case 'win':
                    // Regular win - ascending two notes
                    {
                        [523, 659].forEach(function (freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.2 * soundVolume, now + i * 0.1);
                            gain.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.3 + i * 0.1);
                            osc.start(now + i * 0.1);
                            osc.stop(now + 0.3 + i * 0.1);
                        });
                    }
                    break;

                case 'bigwin':
                    // Big win - triumphant chord with flourish
                    {
                        var freqs = [523, 659, 784, 988]; // C-E-G-B chord
                        freqs.forEach(function (freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.15 * soundVolume, now + i * 0.08);
                            gain.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.8 + i * 0.08);
                            osc.start(now + i * 0.08);
                            osc.stop(now + 0.8 + i * 0.08);
                        });
                    }
                    break;

                case 'megawin':
                    // Mega win - dramatic ascending sweep with multiple flourishes
                    {
                        var sweepFreqs = [440, 554, 659, 784, 988, 1047]; // A-C#-E-G-B-C
                        sweepFreqs.forEach(function (freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.1 * soundVolume, now + i * 0.06);
                            gain.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 1.2 + i * 0.06);
                            osc.start(now + i * 0.06);
                            osc.stop(now + 1.2 + i * 0.06);
                        });
                    }
                    break;

                case 'freespin':
                    // Free spin activated - magical ascending three-note sequence
                    {
                        var freqs = [587, 659, 784]; // D-E-G
                        freqs.forEach(function (freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.2 * soundVolume, now + i * 0.15);
                            gain.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.5 + i * 0.15);
                            osc.start(now + i * 0.15);
                            osc.stop(now + 0.5 + i * 0.15);
                        });
                    }
                    break;

                case 'toggle':
                    // Sound toggle - neutral beep
                    {
                        var osc = audioContext.createOscillator();
                        osc.connect(gainNode);
                        gainNode.gain.setValueAtTime(0.15 * soundVolume, now);
                        gainNode.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.1);
                        osc.frequency.value = 700;
                        osc.start(now);
                        osc.stop(now + 0.1);
                    }
                    break;

                case 'scatter':
                    // Scatter symbol - magical glimmer sound
                    {
                        var osc = audioContext.createOscillator();
                        osc.connect(gainNode);
                        gainNode.gain.setValueAtTime(0.15 * soundVolume, now);
                        gainNode.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.25);
                        osc.frequency.setValueAtTime(1200, now);
                        osc.frequency.exponentialRampToValueAtTime(1800, now + 0.25);
                        osc.start(now);
                        osc.stop(now + 0.25);
                    }
                    break;

                case 'bonus':
                    // Bonus feature triggered - celebratory sound
                    {
                        var freqs = [659, 784, 880]; // E-G-A
                        freqs.forEach(function (freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.15 * soundVolume, now + i * 0.12);
                            gain.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.6 + i * 0.12);
                            osc.start(now + i * 0.12);
                            osc.stop(now + 0.6 + i * 0.12);
                        });
                    }
                    break;

                case 'lose':
                    // Lose/no win - descending two-note sequence
                    {
                        [440, 330].forEach(function (freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.1 * soundVolume, now + i * 0.15);
                            gain.gain.exponentialRampToValueAtTime(0.01 * soundVolume, now + 0.25 + i * 0.15);
                            osc.start(now + i * 0.15);
                            osc.stop(now + 0.25 + i * 0.15);
                        });
                    }
                    break;

                case 'coin_land':
                    // Coin locks in Hold & Win — bright metallic clink
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sine';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(1200, now);
                        osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
                        gain.gain.setValueAtTime(0.18 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.18);
                        osc.start(now);
                        osc.stop(now + 0.2);
                    }
                    break;

                case 'level_up':
                    // Chamber Spins level advance — ascending 4-note fanfare
                    {
                        [523, 659, 784, 1047].forEach(function(freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.type = 'square';
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.12 * soundVolume, now + i * 0.09);
                            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.28 + i * 0.09);
                            osc.start(now + i * 0.09);
                            osc.stop(now + 0.30 + i * 0.09);
                        });
                    }
                    break;

                case 'mystery_reveal':
                    // Mystery Stacks reveal — swoosh followed by bright pop
                    {
                        var oscS = audioContext.createOscillator();
                        var gainS = audioContext.createGain();
                        oscS.type = 'sawtooth';
                        oscS.connect(gainS);
                        gainS.connect(audioContext.destination);
                        oscS.frequency.setValueAtTime(1800, now);
                        oscS.frequency.exponentialRampToValueAtTime(400, now + 0.25);
                        gainS.gain.setValueAtTime(0.08 * soundVolume, now);
                        gainS.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.25);
                        oscS.start(now);
                        oscS.stop(now + 0.26);
                        var oscP = audioContext.createOscillator();
                        var gainP = audioContext.createGain();
                        oscP.type = 'sine';
                        oscP.connect(gainP);
                        gainP.connect(audioContext.destination);
                        oscP.frequency.value = 1400;
                        gainP.gain.setValueAtTime(0.20 * soundVolume, now + 0.22);
                        gainP.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.45);
                        oscP.start(now + 0.22);
                        oscP.stop(now + 0.46);
                    }
                    break;

                case 'wild_meter_tick':
                    // Wild Meter accumulation — short electric click
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'square';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.value = 800 + Math.random() * 200;
                        gain.gain.setValueAtTime(0.10 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.07);
                        osc.start(now);
                        osc.stop(now + 0.08);
                    }
                    break;

                case 'sticky_lock':
                    // Wild locks sticky during free spins — magnetic snap + sustain
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sine';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(600, now);
                        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.06);
                        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.20);
                        gain.gain.setValueAtTime(0.16 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.25);
                        osc.start(now);
                        osc.stop(now + 0.26);
                    }
                    break;

                case 'wild_walk':
                    // Walking wild shifts left — short whoosh
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sawtooth';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(900, now);
                        osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
                        gain.gain.setValueAtTime(0.12 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.18);
                        osc.start(now);
                        osc.stop(now + 0.18);
                    }
                    break;

                case 'streak_hit':
                    // Win streak milestone — bright ascending triple ping
                    {
                        [880, 1108, 1320].forEach(function(freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.type = 'sine';
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.14 * soundVolume, now + i * 0.07);
                            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.22 + i * 0.07);
                            osc.start(now + i * 0.07);
                            osc.stop(now + 0.23 + i * 0.07);
                        });
                    }
                    break;
                case 'wild_mult':
                    // Multiplier wild activates — quick pop + ascending sine
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sine';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(440, now);
                        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.10);
                        gain.gain.setValueAtTime(0.20 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.18);
                        osc.start(now);
                        osc.stop(now + 0.20);
                    }
                    break;

                case 'mult_rise':
                    // Increasing multiplier ticks up — short bright ping
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'triangle';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(660, now);
                        osc.frequency.exponentialRampToValueAtTime(990, now + 0.08);
                        gain.gain.setValueAtTime(0.15 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.12);
                        osc.start(now);
                        osc.stop(now + 0.13);
                    }
                    break;

                case 'buy_feature':
                    // Buy Feature purchased — cash register chime
                    {
                        [523, 784, 1047, 1568].forEach(function(freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.type = 'sine';
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.16 * soundVolume, now + i * 0.06);
                            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.25 + i * 0.06);
                            osc.start(now + i * 0.06);
                            osc.stop(now + 0.26 + i * 0.06);
                        });
                    }
                    break;

                case 'cascade_hit':
                    // Cascade pop — each level of cascade gets a higher note
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'square';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(330, now);
                        osc.frequency.exponentialRampToValueAtTime(660, now + 0.07);
                        gain.gain.setValueAtTime(0.12 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.10);
                        osc.start(now);
                        osc.stop(now + 0.11);
                    }
                    break;

                case 'wild_expand':
                    // Expanding wild whoosh — downward sweep then ring
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sawtooth';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(800, now);
                        osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
                        gain.gain.setValueAtTime(0.18 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.22);
                        osc.start(now);
                        osc.stop(now + 0.23);
                    }
                    break;

                case 'respin_lock':
                    // Symbol locks in — mechanical click + buzz
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'triangle';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(220, now);
                        osc.frequency.setValueAtTime(180, now + 0.04);
                        gain.gain.setValueAtTime(0.22 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.12);
                        osc.start(now);
                        osc.stop(now + 0.13);
                    }
                    break;

                case 'wheel_spin':
                    // Prize wheel spins — rapid tick accelerating
                    {
                        var tickCount = 8;
                        for (var i = 0; i < tickCount; i++) {
                            (function(idx) {
                                var osc = audioContext.createOscillator();
                                var gain = audioContext.createGain();
                                osc.type = 'triangle';
                                osc.connect(gain);
                                gain.connect(audioContext.destination);
                                var delay = idx * Math.max(0.02, 0.12 - idx * 0.012);
                                osc.frequency.value = 440 + idx * 30;
                                gain.gain.setValueAtTime(0.10 * soundVolume, now + delay);
                                gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + delay + 0.06);
                                osc.start(now + delay);
                                osc.stop(now + delay + 0.07);
                            })(i);
                        }
                    }
                    break;

                case 'colossal_land':
                    // Giant symbol lands — deep thud + shimmer
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sine';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(80, now);
                        osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
                        gain.gain.setValueAtTime(0.35 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.25);
                        osc.start(now);
                        osc.stop(now + 0.26);
                    }
                    break;

                case 'collect_tick':
                    // Symbol collected — ascending pip
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sine';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(880, now);
                        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.06);
                        gain.gain.setValueAtTime(0.12 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.09);
                        osc.start(now);
                        osc.stop(now + 0.10);
                    }
                    break;

                case 'wild_reel':
                    // Wild reel sweep — descending shimmer
                    {
                        var osc = audioContext.createOscillator();
                        var gain = audioContext.createGain();
                        osc.type = 'sine';
                        osc.connect(gain);
                        gain.connect(audioContext.destination);
                        osc.frequency.setValueAtTime(1200, now);
                        osc.frequency.exponentialRampToValueAtTime(300, now + 0.22);
                        gain.gain.setValueAtTime(0.18 * soundVolume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.28);
                        osc.start(now);
                        osc.stop(now + 0.29);
                    }
                    break;

                case 'both_ways_hit':
                    // Both-ways reverse win — mirror ping
                    {
                        [660, 880].forEach(function(freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.type = 'triangle';
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.14 * soundVolume, now + i * 0.05);
                            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.15 + i * 0.05);
                            osc.start(now + i * 0.05);
                            osc.stop(now + 0.16 + i * 0.05);
                        });
                    }
                    break;

                case 'jackpot_hit':
                    // Random jackpot — triumphant ascending fanfare
                    {
                        [261, 329, 392, 523, 659, 784].forEach(function(freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.type = 'sine';
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.22 * soundVolume, now + i * 0.08);
                            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.30 + i * 0.08);
                            osc.start(now + i * 0.08);
                            osc.stop(now + 0.32 + i * 0.08);
                        });
                    }
                    break;

                case 'jackpot':
                    // Epic win tier — grand ascending fanfare (longer than bigwin/megawin)
                    {
                        [261, 329, 392, 523, 659, 784, 1047].forEach(function(freq, i) {
                            var osc = audioContext.createOscillator();
                            var gain = audioContext.createGain();
                            osc.type = 'sine';
                            osc.connect(gain);
                            gain.connect(audioContext.destination);
                            osc.frequency.value = freq;
                            gain.gain.setValueAtTime(0.20 * soundVolume, now + i * 0.07);
                            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 1.0 + i * 0.07);
                            osc.start(now + i * 0.07);
                            osc.stop(now + 1.0 + i * 0.07 + 0.02);
                        });
                    }
                    break;

                default:
                    // Unknown sound type — log for debugging, no crash
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('SoundManager: unknown playSound type "' + type + '"');
                    }
                    break;
            }
        } catch (e) {
            // Silently ignore audio errors in headless/automated environments
        }
    }

    // ── Toggle Sound On/Off ─────────────────────────────────────────────
    function toggleSound() {
        soundEnabled = !soundEnabled;
        try { localStorage.setItem('soundEnabled', soundEnabled); } catch (_) {}
        var btn = document.getElementById('soundToggle');
        if (btn) {
            btn.textContent = soundEnabled ? '\u{1F50A}' : '\u{1F507}';
            btn.title = soundEnabled ? 'Sound ON' : 'Sound OFF';
        }

        if (soundEnabled) {
            playSound('toggle');
        }
    }

    // ── Update Sound Button State ───────────────────────────────────────
    function updateSoundButton() {
        var btn = document.getElementById('soundToggle');
        if (btn) {
            btn.textContent = soundEnabled ? '\u{1F50A}' : '\u{1F507}';
            btn.title = soundEnabled ? 'Sound ON' : 'Sound OFF';
        }
    }

    // ── Volume Control (new feature) ────────────────────────────────────
    function setSoundVolume(vol) {
        soundVolume = Math.max(0.0, Math.min(1.0, parseFloat(vol) || 0));
        try { localStorage.setItem('casinoSoundVolume', soundVolume); } catch (_) {}
    }

    // ── Ambient Drone State ─────────────────────────────────────────────
    var ambientNodes = null; // { osc, filter, gain, ctx } — active drone chain
    var ambientFadeTimer = null;

    // ── Dynamic Music Layer State ─────────────────────────────────────
    var dynamicLayers = [];       // array of { osc, filter, gain } per active layer
    var currentLayerIndex = -1;   // currently active layer (-1 = none)

    // ── Helper: resolve provider key ──────────────────────────────────
    function resolveProviderKey(providerKey) {
        if (providerKey && PROVIDER_SFX_THEMES[providerKey]) return providerKey;
        // Fallback: try to derive from currentGame via getGameChromeStyle
        if (typeof currentGame !== 'undefined' && currentGame && typeof getGameChromeStyle === 'function') {
            var key = getGameChromeStyle(currentGame);
            if (PROVIDER_SFX_THEMES[key]) return key;
        }
        return '';
    }

    // ── Helper: safe appSettings access ───────────────────────────────
    function getAppSettings() {
        return (typeof appSettings !== 'undefined' && appSettings) ? appSettings : {};
    }

    // ── Start Ambient Drone ───────────────────────────────────────────
    function startAmbient(providerKey) {
        var settings = getAppSettings();
        if (settings.ambientMusic === false) return;
        if (!soundEnabled) return;

        // Stop any existing ambient first
        stopAmbient();

        var key = resolveProviderKey(providerKey);
        if (!key) return;
        var theme = PROVIDER_SFX_THEMES[key];
        if (!theme || !theme.ambient) return;
        var profile = theme.ambient;

        try {
            var ctx = getAudioContext();
            var osc = ctx.createOscillator();
            var filter = ctx.createBiquadFilter();
            var gainNode = ctx.createGain();

            osc.type = profile.waveType || 'sine';
            osc.frequency.value = profile.freq || 110;

            filter.type = 'lowpass';
            filter.frequency.value = profile.filterFreq || 600;
            filter.Q.value = profile.filterQ || 3;

            var targetGain = (profile.gain || SOUND_AMBIENT_VOLUME) * soundVolume;
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 1.5);

            osc.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(ctx.destination);
            osc.start(ctx.currentTime);

            ambientNodes = { osc: osc, filter: filter, gain: gainNode, ctx: ctx };
        } catch (e) { /* ignore audio errors */ }
    }

    // ── Stop Ambient Drone ────────────────────────────────────────────
    function stopAmbient() {
        if (ambientFadeTimer) { clearTimeout(ambientFadeTimer); ambientFadeTimer = null; }
        if (!ambientNodes) return;
        try {
            var ctx = ambientNodes.ctx;
            var g = ambientNodes.gain;
            var o = ambientNodes.osc;
            g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
            g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
            ambientFadeTimer = setTimeout(function () {
                try { o.stop(); } catch (e) { /* already stopped */ }
                try { o.disconnect(); g.disconnect(); ambientNodes.filter.disconnect(); } catch (e2) {}
                ambientNodes = null;
                ambientFadeTimer = null;
            }, 900);
        } catch (e) { ambientNodes = null; }
    }

    // ── Dynamic Music Layer System ────────────────────────────────────
    // Layers: 0 = ambient only, 1 = +rhythmic pulse, 2 = +excitement,
    //         3 = bonus theme, 4 = full fanfare
    var LAYER_CONFIGS = [
        // Layer 0: ambient drone only (handled by startAmbient)
        null,
        // Layer 1: rhythmic low pulse
        { waveType: 'triangle', freq: 110, filterFreq: 300, filterQ: 6, gain: 0.06, lfoFreq: 2.0  },
        // Layer 2: excitement — mid-range warble
        { waveType: 'sawtooth', freq: 220, filterFreq: 800, filterQ: 4, gain: 0.05, lfoFreq: 4.0  },
        // Layer 3: bonus theme — bright accent
        { waveType: 'sine',     freq: 440, filterFreq: 1500, filterQ: 2, gain: 0.07, lfoFreq: 6.0  },
        // Layer 4: full fanfare — rich harmonic
        { waveType: 'square',   freq: 330, filterFreq: 2000, filterQ: 3, gain: 0.06, lfoFreq: 8.0  },
    ];

    function playDynamicLayer(layerIndex) {
        var settings = getAppSettings();
        if (settings.ambientMusic === false) return;
        if (!soundEnabled) return;
        if (layerIndex < 0 || layerIndex > 4) return;
        if (layerIndex === currentLayerIndex) return;

        // Fade out layers above the target index
        while (dynamicLayers.length > layerIndex) {
            var removed = dynamicLayers.pop();
            if (removed) {
                try {
                    removed.gain.gain.setValueAtTime(removed.gain.gain.value, removed.ctx.currentTime);
                    removed.gain.gain.linearRampToValueAtTime(0, removed.ctx.currentTime + 0.5);
                    (function (r) {
                        setTimeout(function () {
                            try { r.osc.stop(); } catch (e) {}
                            try { if (r.lfo) r.lfo.stop(); } catch (e) {}
                            try { r.osc.disconnect(); r.gain.disconnect(); r.filter.disconnect(); if (r.lfo) r.lfo.disconnect(); if (r.lfoGain) r.lfoGain.disconnect(); } catch (e) {}
                        }, 600);
                    })(removed);
                } catch (e) { /* ignore */ }
            }
        }

        // Add layers up to the target index
        try {
            var ctx = getAudioContext();
            for (var i = dynamicLayers.length; i <= layerIndex; i++) {
                var cfg = LAYER_CONFIGS[i];
                if (!cfg) { dynamicLayers.push(null); continue; }

                var osc = ctx.createOscillator();
                var filter = ctx.createBiquadFilter();
                var gainNode = ctx.createGain();
                var lfo = ctx.createOscillator();
                var lfoGain = ctx.createGain();

                osc.type = cfg.waveType;
                osc.frequency.value = cfg.freq;

                filter.type = 'lowpass';
                filter.frequency.value = cfg.filterFreq;
                filter.Q.value = cfg.filterQ;

                var targetGain = (cfg.gain || 0.05) * soundVolume;
                gainNode.gain.setValueAtTime(0, ctx.currentTime);
                gainNode.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 0.6);

                // LFO for rhythmic modulation
                lfo.type = 'sine';
                lfo.frequency.value = cfg.lfoFreq || 2.0;
                lfoGain.gain.value = targetGain * 0.5;
                lfo.connect(lfoGain);
                lfoGain.connect(gainNode.gain);

                osc.connect(filter);
                filter.connect(gainNode);
                gainNode.connect(ctx.destination);
                osc.start(ctx.currentTime);
                lfo.start(ctx.currentTime);

                dynamicLayers.push({ osc: osc, filter: filter, gain: gainNode, lfo: lfo, lfoGain: lfoGain, ctx: ctx });
            }
        } catch (e) { /* ignore audio errors */ }

        currentLayerIndex = layerIndex;
    }

    // ── Play Sound Event by Name ──────────────────────────────────────
    function playSoundEvent(eventName, providerKey) {
        if (!soundEnabled) return;
        var settings = getAppSettings();

        // Gate by settings category
        var winEvents = { scatter: 1, megawin: 1, jackpot: 1, nearmiss: 1 };
        var uiEvents  = { hover: 1, count: 1, reelstop: 1 };

        if (winEvents[eventName] && settings.winSounds === false) return;
        if (uiEvents[eventName] && settings.uiSounds === false) return;

        var key = resolveProviderKey(providerKey);
        var theme = key ? PROVIDER_SFX_THEMES[key] : null;
        var profile = theme ? theme[eventName] : null;

        if (!profile) {
            // Fallback to generic playSound for recognized event names
            if (typeof playSound === 'function') playSound(eventName);
            return;
        }

        try {
            var ctx = getAudioContext();
            var now = ctx.currentTime;

            if (profile.freqs) {
                // Multi-note arpeggio/sequence
                profile.freqs.forEach(function (freq, i) {
                    var osc  = ctx.createOscillator();
                    var gain = ctx.createGain();
                    osc.type = profile.waveType || 'sine';
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;

                    var volume = 0.18 * soundVolume;
                    var t = now + i * (profile.spacing || 0.06);
                    gain.gain.setValueAtTime(volume, t);
                    gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, t + (profile.dur || 0.2));
                    osc.start(t);
                    osc.stop(t + (profile.dur || 0.2) + 0.02);
                });
            } else if (profile.freq) {
                // Single note
                var osc  = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = profile.waveType || 'sine';
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = profile.freq;

                var volume = 0.15 * soundVolume;
                gain.gain.setValueAtTime(volume, now);
                gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + (profile.dur || 0.05));
                osc.start(now);
                osc.stop(now + (profile.dur || 0.05) + 0.01);
            }
        } catch (e) { /* ignore audio errors */ }
    }

    // ── Near-Miss Tension Sound ───────────────────────────────────────
    function playNearMiss(providerKey) {
        if (!soundEnabled) return;
        var settings = getAppSettings();
        if (settings.winSounds === false) return;

        var key = resolveProviderKey(providerKey);
        var theme = key ? PROVIDER_SFX_THEMES[key] : null;
        var profile = (theme && theme.nearmiss) ? theme.nearmiss : { waveType: 'sine', freqs: [440, 415], dur: 0.35 };

        try {
            var ctx = getAudioContext();
            var now = ctx.currentTime;

            if (profile.freqs && profile.freqs.length >= 2) {
                // Two-note dissonant slide for tension
                var osc  = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = profile.waveType || 'sine';
                osc.connect(gain);
                gain.connect(ctx.destination);

                var dur = profile.dur || 0.35;
                var volume = 0.12 * soundVolume;
                osc.frequency.setValueAtTime(profile.freqs[0], now);
                osc.frequency.linearRampToValueAtTime(profile.freqs[1], now + dur);
                gain.gain.setValueAtTime(volume, now);
                gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + dur);
                osc.start(now);
                osc.stop(now + dur + 0.02);
            }
        } catch (e) { /* ignore audio errors */ }
    }

    // ── Balance Counter Tick ──────────────────────────────────────────
    function playCounterTick(speed) {
        if (!soundEnabled) return;
        var settings = getAppSettings();
        if (settings.uiSounds === false) return;

        try {
            var ctx = getAudioContext();
            var now = ctx.currentTime;

            // Speed factor: 0-1, higher = shorter/higher tick
            var s = Math.max(0, Math.min(1, speed || 0.5));
            var freq = 800 + s * 1200;  // 800-2000 Hz range
            var dur  = 0.03 - s * 0.015; // 0.03 - 0.015s range

            var osc  = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'square';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;

            var volume = 0.08 * soundVolume;
            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + dur);
            osc.start(now);
            osc.stop(now + dur + 0.005);
        } catch (e) { /* ignore audio errors */ }
    }

    // ── Button Hover Micro-Sound ──────────────────────────────────────
    function playHoverSound() {
        if (!soundEnabled) return;
        var settings = getAppSettings();
        if (settings.uiSounds === false) return;

        try {
            var ctx = getAudioContext();
            var now = ctx.currentTime;

            var osc  = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 1800;

            var volume = 0.06 * soundVolume;
            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + 0.025);
            osc.start(now);
            osc.stop(now + 0.035);
        } catch (e) { /* ignore audio errors */ }
    }

    // ── Reel Stop Thud ────────────────────────────────────────────────
    function playReelStop(columnIndex, providerKey) {
        if (!soundEnabled) return;
        var settings = getAppSettings();
        if (settings.uiSounds === false) return;

        var key = resolveProviderKey(providerKey);
        var theme = key ? PROVIDER_SFX_THEMES[key] : null;
        var profile = (theme && theme.reelstop) ? theme.reelstop : { waveType: 'triangle', freq: 150, dur: 0.06 };

        try {
            var ctx = getAudioContext();
            var now = ctx.currentTime;

            // Slightly different pitch per column: higher columns get slightly higher pitch
            var col = (typeof columnIndex === 'number') ? columnIndex : 0;
            var pitchOffset = col * 15; // 15 Hz per column step

            var osc  = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = profile.waveType || 'triangle';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = (profile.freq || 150) + pitchOffset;

            var dur = profile.dur || 0.06;
            var volume = 0.14 * soundVolume;
            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001 * soundVolume, now + dur);
            osc.start(now);
            osc.stop(now + dur + 0.01);
        } catch (e) { /* ignore audio errors */ }
    }

    // ── Expose as globals (backward compatible) ─────────────────────────
    window.getAudioContext   = getAudioContext;
    window.playSound         = playSound;
    window.playProviderSound = playProviderSound;
    window.toggleSound       = toggleSound;
    window.updateSoundButton = updateSoundButton;
    window.setSoundVolume    = setSoundVolume;

    // ── Also expose via SoundManager namespace ──────────────────────────
    // ── Cleanup: close AudioContext on page unload to prevent leaks ──
    window.addEventListener('pagehide', function () {
        if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
            try { sharedAudioContext.close(); } catch (_) {}
            sharedAudioContext = null;
        }
    });

    // ── Suspend AudioContext when tab is hidden (saves battery/CPU) ──
    document.addEventListener('visibilitychange', function () {
        if (!sharedAudioContext) return;
        if (document.hidden && sharedAudioContext.state === 'running') {
            sharedAudioContext.suspend();
        } else if (!document.hidden && soundEnabled && sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume();
        }
    });

    window.SoundManager = {
        getAudioContext:    getAudioContext,
        playSound:          playSound,
        toggleSound:        toggleSound,
        updateSoundButton:  updateSoundButton,
        setSoundVolume:     setSoundVolume,
        playProviderSound:  playProviderSound,

        // Phase 4: Enhanced sound system
        startAmbient:       startAmbient,
        stopAmbient:        stopAmbient,
        playDynamicLayer:   playDynamicLayer,
        playSoundEvent:     playSoundEvent,
        playNearMiss:       playNearMiss,
        playCounterTick:    playCounterTick,
        playHoverSound:     playHoverSound,
        playReelStop:       playReelStop,

        /** Read-only accessors for current state */
        get soundEnabled() { return soundEnabled; },
        get soundVolume()  { return soundVolume; },

        /** Allow external code to set enabled state directly */
        setSoundEnabled: function (val) {
            soundEnabled = !!val;
            try { localStorage.setItem('soundEnabled', soundEnabled); } catch (_) {}
            updateSoundButton();
        }
    };
})();
