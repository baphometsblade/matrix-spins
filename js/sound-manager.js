/**
 * Matrix Spins Casino — Sound Effects Manager
 * Synthesized UI sounds via Web Audio API (no external files)
 * Auto-injecting IIFE with mute toggle and public API
 */
(function () {
  'use strict';

  var ctx = null;
  var masterGain = null;
  var muted = localStorage.getItem('ms_sound_muted') === 'true';
  var volume = parseFloat(localStorage.getItem('ms_sound_volume')) || 0.3;
  var initialized = false;

  // ── Helpers ──────────────────────────────────────────────────────────

  function initAudio() {
    if (initialized) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : volume;
      masterGain.connect(ctx.destination);
      initialized = true;
    } catch (e) { /* graceful degradation */ }
  }

  function ensureContext(cb) {
    if (!initialized) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(cb);
    } else {
      cb();
    }
  }

  function tone(freq, type, start, dur, vol) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  function sweep(f1, f2, type, start, dur, vol) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f1, start);
    osc.frequency.linearRampToValueAtTime(f2, start + dur);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.05);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(start);
    osc.stop(start + dur + 0.1);
  }

  // ── Sound Library ───────────────────────────────────────────────────

  var sounds = {
    click: function () {
      var t = ctx.currentTime;
      tone(1200, 'sine', t, 0.04, 0.15);
    },

    hover: function () {
      var t = ctx.currentTime;
      tone(800, 'sine', t, 0.02, 0.06);
    },

    spin: function () {
      var t = ctx.currentTime;
      sweep(200, 600, 'sawtooth', t, 0.5, 0.25);
    },

    tick: function () {
      var t = ctx.currentTime;
      tone(600, 'square', t, 0.015, 0.2);
    },

    'win-small': function () {
      var t = ctx.currentTime;
      tone(523, 'sine', t, 0.2, 0.3);
      tone(659, 'sine', t + 0.2, 0.2, 0.3);
    },

    'win-big': function () {
      var t = ctx.currentTime;
      tone(523, 'sine', t, 0.15, 0.35);
      tone(659, 'sine', t + 0.15, 0.15, 0.35);
      tone(784, 'sine', t + 0.3, 0.4, 0.35);
    },

    jackpot: function () {
      var t = ctx.currentTime;
      var notes = [523.25, 659.25, 783.99, 1046.50];
      for (var i = 0; i < notes.length; i++) {
        tone(notes[i], 'sine', t + i * 0.35, 0.6, 0.4);
        tone(notes[i] * 1.005, 'sine', t + i * 0.35, 0.7, 0.2); // chorus
      }
      // shimmer tail
      tone(1046.50, 'sine', t + 1.4, 0.6, 0.15);
      tone(1568, 'sine', t + 1.5, 0.5, 0.1);
    },

    notification: function () {
      var t = ctx.currentTime;
      tone(880, 'sine', t, 0.1, 0.2);
      tone(1046, 'sine', t + 0.1, 0.15, 0.2);
    },

    error: function () {
      var t = ctx.currentTime;
      sweep(400, 200, 'sine', t, 0.2, 0.25);
    },

    deposit: function () {
      var t = ctx.currentTime;
      sweep(2000, 800, 'sine', t, 0.08, 0.3);
      tone(1200, 'sine', t + 0.08, 0.07, 0.2);
      tone(800, 'sine', t + 0.12, 0.05, 0.15);
    }
  };

  // ── Play ────────────────────────────────────────────────────────────

  function play(name) {
    if (!initialized || muted) return;
    if (!sounds[name]) return;
    ensureContext(function () { sounds[name](); });
  }

  // ── Mute / Volume ──────────────────────────────────────────────────

  function applyVolume() {
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
  }

  function setMuted(val) {
    muted = !!val;
    localStorage.setItem('ms_sound_muted', muted);
    applyVolume();
    updateMuteButton();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('ms_sound_volume', volume);
    applyVolume();
  }

  // ── Mute Toggle Button ─────────────────────────────────────────────

  var muteBtn = null;

  function updateMuteButton() {
    if (muteBtn) muteBtn.textContent = muted ? '🔇' : '🔊';
  }

  function injectMuteButton() {
    muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.setAttribute('aria-label', 'Toggle sound');
    muteBtn.setAttribute('title', 'Toggle sound');
    updateMuteButton();

    var s = muteBtn.style;
    s.background = 'none';
    s.border = 'none';
    s.cursor = 'pointer';
    s.fontSize = '20px';
    s.lineHeight = '1';
    s.padding = '6px';
    s.borderRadius = '8px';
    s.color = '#9ca3af';
    s.transition = 'color .2s, background .2s';
    s.display = 'inline-flex';
    s.alignItems = 'center';
    s.justifyContent = 'center';
    s.verticalAlign = 'middle';

    muteBtn.addEventListener('mouseenter', function () {
      muteBtn.style.color = '#f0f0f5';
      muteBtn.style.background = 'rgba(255,255,255,0.08)';
    });
    muteBtn.addEventListener('mouseleave', function () {
      muteBtn.style.color = '#9ca3af';
      muteBtn.style.background = 'none';
    });
    muteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMuted(!muted);
    });

    // Insert into header
    var container = document.querySelector('.header-right') || document.querySelector('.actions');
    if (container) {
      var bell = container.querySelector('.notification-bell, [class*="notification"]');
      if (bell) {
        container.insertBefore(muteBtn, bell);
      } else {
        container.insertBefore(muteBtn, container.firstChild);
      }
    }
  }

  // ── Event Integration ───────────────────────────────────────────────

  function bindEvents() {
    // Custom event
    window.addEventListener('matrix-sound', function (e) {
      if (e.detail && e.detail.type) play(e.detail.type);
    });

    // Auto click sound on buttons
    document.addEventListener('click', function (e) {
      var el = e.target.closest('.btn, button');
      if (el && el !== muteBtn) play('click');
    });
  }

  // ── Init on first interaction (autoplay policy) ─────────────────────

  function onFirstInteraction() {
    initAudio();
    document.removeEventListener('click', onFirstInteraction, true);
    document.removeEventListener('touchstart', onFirstInteraction, true);
  }

  document.addEventListener('click', onFirstInteraction, true);
  document.addEventListener('touchstart', onFirstInteraction, true);

  // ── DOM Ready ───────────────────────────────────────────────────────

  function onReady() {
    injectMuteButton();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // ── Public API ──────────────────────────────────────────────────────

  window.MatrixSound = {
    play: play,
    mute: function () { setMuted(true); },
    unmute: function () { setMuted(false); },
    toggleMute: function () { setMuted(!muted); },
    setVolume: setVolume,
    isMuted: function () { return muted; }
  };

})();
