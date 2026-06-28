/**
 * Matrix Spins Casino — Premium Sound Engine
 * ============================================
 * 100% synthesized via the Web Audio API. NO external audio files are
 * fetched or decoded — every sound (UI clicks, reel mechanics, win
 * fanfares, choir/timpani crescendos, and the looping ambient
 * soundscapes) is generated live from oscillators, noise buffers, and
 * filters. Zero network cost, fully offline-capable.
 *
 * Signal graph
 * ------------
 *   osc / noise ─┬─▶ sfxBus    ─┐
 *                ├─▶ musicBus   ├─▶ master ─▶ destination
 *                └─▶ ambientBus ┘        │
 *                                 reverbSend ─▶ convolver ─▶ master
 *
 * Three independently toggleable buses (SFX / Music / Ambient) feed a
 * single master gain (volume + mute). A shared algorithmic reverb gives
 * the bell/choir/jackpot sounds their "hall" tail without per-voice cost.
 *
 * Autoplay policy
 * ---------------
 * Browsers start every AudioContext SUSPENDED until a user gesture, so
 * the site is effectively silent on first load. We lazily construct the
 * context on the first click / touch and resume it then — satisfying the
 * "muted until interaction" requirement for free. A persisted mute
 * preference is honoured on top of that.
 *
 * Public API (window.MatrixSound) — backward compatible with the old
 * manager (play / mute / unmute / toggleMute / setVolume / isMuted) plus
 * the new bus toggles, ambient controls, and settings panel.
 */
(function () {
  'use strict';

  // ── Persisted settings ──────────────────────────────────────────────
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } }
  function clamp01(v) { if (isNaN(v)) return 0.5; return Math.max(0, Math.min(1, v)); }

  var muted = lsGet('ms_sound_muted', 'false') === 'true';
  var volume = clamp01(parseFloat(lsGet('ms_sound_volume', '0.5')));
  var sfxOn = lsGet('ms_sfx_enabled', 'true') !== 'false';
  var musicOn = lsGet('ms_music_enabled', 'true') !== 'false';
  var ambientOn = lsGet('ms_ambient_enabled', 'false') === 'true';

  // ── Audio graph ─────────────────────────────────────────────────────
  var ctx = null, master = null, sfxBus = null, musicBus = null, ambientBus = null;
  var reverb = null, reverbSend = null, noiseBuf = null;
  var initialized = false;

  function makeNoiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Synthesised impulse response: exponentially-decaying noise → a clean,
  // bright "hall" reverb with no external IR file.
  function makeImpulse(seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function initAudio() {
    if (initialized) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();

      master = ctx.createGain();
      master.gain.value = muted ? 0.0001 : volume;
      master.connect(ctx.destination);

      sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.85; musicBus.connect(master);
      ambientBus = ctx.createGain(); ambientBus.gain.value = 0.0001; ambientBus.connect(master);

      // Shared reverb send.
      try {
        reverb = ctx.createConvolver();
        reverb.buffer = makeImpulse(2.2, 2.8);
        reverbSend = ctx.createGain();
        reverbSend.gain.value = 0.85;
        reverbSend.connect(reverb);
        reverb.connect(master);
      } catch (e) { reverb = null; reverbSend = null; }

      noiseBuf = makeNoiseBuffer(2.0);
      initialized = true;

      // Anything requested before the context existed starts now.
      if (pendingAmbient) startAmbient(pendingAmbient);
    } catch (e) { /* graceful degradation — site works without audio */ }
  }

  function ensureContext(cb) {
    if (!initialized) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(cb).catch(function () { /* ignore */ });
    } else {
      cb();
    }
  }

  function smooth(param, val) {
    try { param.setTargetAtTime(val, ctx ? ctx.currentTime : 0, 0.03); }
    catch (e) { try { param.value = val; } catch (_) { /* noop */ } }
  }

  // ── Low-level synthesis primitives ──────────────────────────────────
  // Each returns its envelope gain (already connected to `out` + optional
  // reverb send) so callers can build richer voices on top.

  function envGain(start, dur, peak, out, attack, rev) {
    var g = ctx.createGain();
    attack = attack || 0.008;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.connect(out || sfxBus);
    if (rev && reverbSend) {
      var s = ctx.createGain();
      s.gain.value = rev;
      g.connect(s);
      s.connect(reverbSend);
    }
    return g;
  }

  function tone(freq, type, start, dur, vol, out, opts) {
    opts = opts || {};
    var osc = ctx.createOscillator();
    var g = envGain(start, dur, vol, out, opts.attack, opts.rev);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, start);
    osc.connect(g);
    osc.start(start);
    osc.stop(start + dur + 0.06);
  }

  function sweep(f1, f2, type, start, dur, vol, out, opts) {
    opts = opts || {};
    var osc = ctx.createOscillator();
    var g = envGain(start, dur, vol, out, opts.attack || 0.006, opts.rev);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f1, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), start + dur);
    osc.connect(g);
    osc.start(start);
    osc.stop(start + dur + 0.08);
  }

  function noiseHit(start, dur, vol, filtType, filtFreq, q, out, opts) {
    opts = opts || {};
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var g = envGain(start, dur, vol, out, opts.attack || 0.004, opts.rev);
    if (filtType) {
      var f = ctx.createBiquadFilter();
      f.type = filtType;
      f.frequency.setValueAtTime(filtFreq, start);
      if (q) f.Q.value = q;
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    src.start(start, Math.random() * 1.5);
    src.stop(start + dur + 0.1);
  }

  function noiseSweep(f1, f2, start, dur, vol, out, q) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q || 1.2;
    f.frequency.setValueAtTime(f1, start);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f2), start + dur);
    var g = envGain(start, dur, vol, out, 0.01);
    src.connect(f); f.connect(g);
    src.start(start, Math.random() * 1.5);
    src.stop(start + dur + 0.1);
  }

  // ── Instrument helpers (built on the primitives) ────────────────────

  // Brass = detuned saws shaped by a swelling low-pass (the formant sweep
  // that gives a trumpet its "blat" attack).
  function brass(freq, start, dur, vol, out) {
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 1.2, start);
    f.frequency.linearRampToValueAtTime(freq * 4.5, start + 0.06);
    f.frequency.linearRampToValueAtTime(freq * 1.7, start + dur);
    f.Q.value = 1.1;
    var g = envGain(start, dur, vol, out, 0.02, 0.18);
    f.connect(g);
    var dets = [0, 9, -9];
    for (var i = 0; i < dets.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, start);
      o.detune.setValueAtTime(dets[i], start);
      o.connect(f);
      o.start(start);
      o.stop(start + dur + 0.06);
    }
  }

  // Orchestral timpani: a pitched membrane (fast downward glide) plus a
  // low noise "body" thump.
  function timpani(start, out) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    var g = envGain(start, 0.5, 0.24, out, 0.004, 0.25);
    o.frequency.setValueAtTime(180, start);
    o.frequency.exponentialRampToValueAtTime(68, start + 0.18);
    o.connect(g);
    o.start(start);
    o.stop(start + 0.55);
    noiseHit(start, 0.12, 0.09, 'lowpass', 220, 0.6, out);
  }

  // Slow string-like swell pad (saw stack into a lowpass, long attack).
  function swellPad(freqs, start, dur, out) {
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.07, start + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.7;
      o.frequency.value = freqs[i];
      o.detune.value = (i % 2 ? 7 : -7);
      o.connect(f); f.connect(g); g.connect(out);
      if (reverbSend) { var s = ctx.createGain(); s.gain.value = 0.2; g.connect(s); s.connect(reverbSend); }
      o.start(start); o.stop(start + dur + 0.1);
    }
  }

  // Choir "aah" pad: detuned saws through a formant band-pass with a
  // gentle vibrato LFO and a long sustain — the "moment" sound.
  function choirPad(freqs, start, dur, out) {
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.055, start + 0.45);
      g.gain.setValueAtTime(0.055, start + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freqs[i] * 2.2;
      f.Q.value = 3;
      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 5 + i * 0.3;
      var lg = ctx.createGain();
      lg.gain.value = 4.5;
      lfo.connect(lg); lg.connect(o.detune);
      o.frequency.value = freqs[i];
      o.connect(f); f.connect(g); g.connect(out);
      if (reverbSend) { var s = ctx.createGain(); s.gain.value = 0.55; g.connect(s); s.connect(reverbSend); }
      o.start(start); o.stop(start + dur + 0.15);
      lfo.start(start); lfo.stop(start + dur + 0.15);
    }
  }

  function chord(freqs, start, dur, vol, out, type, rev) {
    for (var i = 0; i < freqs.length; i++) {
      tone(freqs[i], type || 'sine', start, dur, vol, out, { rev: rev || 0 });
    }
  }

  // ── SFX library (routes through the SFX bus) ────────────────────────
  var SFX = {
    click: function (out) {
      var t = ctx.currentTime;
      tone(1500, 'sine', t, 0.03, 0.10, out);
      tone(2400, 'sine', t, 0.018, 0.04, out);
    },
    hover: function (out) {
      tone(900, 'sine', ctx.currentTime, 0.02, 0.05, out);
    },
    toggle: function (out) {
      var t = ctx.currentTime;
      tone(680, 'square', t, 0.04, 0.10, out);
      tone(1020, 'square', t + 0.05, 0.05, 0.09, out);
    },
    'bet-up': function (out) {
      var t = ctx.currentTime;
      tone(620, 'triangle', t, 0.05, 0.12, out);
      tone(930, 'triangle', t + 0.03, 0.06, 0.10, out);
    },
    'bet-down': function (out) {
      var t = ctx.currentTime;
      tone(560, 'triangle', t, 0.05, 0.12, out);
      tone(380, 'triangle', t + 0.03, 0.06, 0.10, out);
    },
    spin: function (out) {
      // Mechanical whoosh + rising pitch (reels winding up to speed).
      var t = ctx.currentTime;
      sweep(150, 540, 'sawtooth', t, 0.55, 0.09, out);
      noiseSweep(500, 3200, t, 0.5, 0.06, out, 1.0);
      tone(70, 'sine', t, 0.2, 0.09, out); // low motor thrum
    },
    'reel-stop': function (out, opts) {
      // Heavy metallic thud with a descending pitch; each reel is tuned a
      // little lower than the last (opts.reel) so a 5-reel stop walks down
      // a satisfying staircase instead of five identical clunks.
      var t = ctx.currentTime;
      var reel = (opts && opts.reel) || 0;
      var base = 232 - reel * 16;
      sweep(base * 1.7, base * 0.55, 'square', t, 0.13, 0.15, out);
      tone(base, 'triangle', t, 0.17, 0.12, out, { detune: 5 });
      tone(base * 2.01, 'sine', t, 0.10, 0.045, out); // metallic ring partial
      noiseHit(t, 0.05, 0.16, 'lowpass', 380, 0.7, out); // thud transient
    },
    scatter: function (out) {
      // Ethereal bell chime — inharmonic partials + long reverberant tail.
      var t = ctx.currentTime;
      var f = 880;
      var parts = [1, 2.76, 5.4, 8.9];
      var vols = [0.15, 0.085, 0.05, 0.028];
      for (var i = 0; i < parts.length; i++) {
        tone(f * parts[i], 'sine', t, 1.6, vols[i], out, { rev: 0.5, attack: 0.004 });
      }
      tone(f * 1.5, 'sine', t + 0.04, 1.2, 0.045, out, { rev: 0.5 });
    },
    wild: function (out) {
      // Electric zap into a reverb wash.
      var t = ctx.currentTime;
      sweep(2600, 180, 'sawtooth', t, 0.22, 0.12, out, { rev: 0.35 });
      noiseSweep(4000, 700, t, 0.2, 0.09, out, 6);
      tone(120, 'square', t, 0.08, 0.07, out);
    },
    coin: function (out) {
      // Bright metallic clink (credited coin).
      var t = ctx.currentTime;
      tone(2100, 'triangle', t, 0.06, 0.10, out);
      tone(3200, 'sine', t + 0.005, 0.05, 0.05, out);
      tone(1560, 'square', t, 0.03, 0.035, out);
    },
    'balance-ding': function (out) {
      // Soft cash-register ding (balance settled).
      var t = ctx.currentTime;
      tone(1318.51, 'sine', t, 0.18, 0.11, out, { rev: 0.2 });
      tone(1975.53, 'sine', t + 0.02, 0.22, 0.07, out, { rev: 0.2 });
    },
    'jackpot-tick': function (out) {
      // Quiet heartbeat pulse (lub-dub) — jackpot meter contribution /
      // near-miss tension.
      var t = ctx.currentTime;
      tone(78, 'sine', t, 0.10, 0.09, out);
      tone(66, 'sine', t + 0.16, 0.13, 0.07, out);
    },
    error: function (out) {
      // Low buzz (insufficient funds / failed action).
      var t = ctx.currentTime;
      sweep(220, 110, 'sawtooth', t, 0.28, 0.12, out);
      tone(110, 'square', t, 0.28, 0.05, out);
    },
    notification: function (out) {
      var t = ctx.currentTime;
      tone(880, 'sine', t, 0.1, 0.11, out);
      tone(1174.66, 'sine', t + 0.1, 0.16, 0.11, out, { rev: 0.2 });
    },
    deposit: function (out) {
      var t = ctx.currentTime;
      sweep(2000, 800, 'sine', t, 0.08, 0.15, out);
      tone(1200, 'sine', t + 0.08, 0.07, 0.11, out);
      tone(1600, 'sine', t + 0.13, 0.18, 0.09, out, { rev: 0.2 });
    }
  };

  // ── Musical library (routes through the Music bus) ──────────────────
  var MUSIC = {
    'win-small': function (out) {
      // Bright ascending 3-note arpeggio.
      var t = ctx.currentTime;
      var notes = [659.25, 830.61, 987.77]; // E5 G#5 B5
      for (var i = 0; i < notes.length; i++) {
        tone(notes[i], 'triangle', t + i * 0.09, 0.22, 0.17, out, { rev: 0.15 });
        tone(notes[i] * 2, 'sine', t + i * 0.09, 0.18, 0.05, out);
      }
    },
    'win-medium': function (out) {
      // Triumphant 5-note brass fanfare.
      var t = ctx.currentTime;
      var notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      for (var i = 0; i < notes.length; i++) brass(notes[i], t + i * 0.12, 0.34, 0.15, out);
      chord([523.25, 659.25, 783.99], t + 0.62, 0.6, 0.09, out, 'sawtooth', 0.3);
    },
    'win-big': function (out) {
      // Epic orchestral swell with timpani hits.
      var t = ctx.currentTime;
      timpani(t, out); timpani(t + 0.28, out);
      swellPad([261.63, 329.63, 392.0, 523.25], t, 1.5, out);
      var notes = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) brass(notes[i], t + 0.5 + i * 0.14, 0.5, 0.15, out);
    },
    'win-mega': function (out) {
      // Full crescendo with choir-pad sustain.
      var t = ctx.currentTime;
      timpani(t, out); timpani(t + 0.2, out); timpani(t + 0.4, out);
      var notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      for (var i = 0; i < notes.length; i++) brass(notes[i], t + i * 0.11, 0.42, 0.16, out);
      choirPad([523.25, 659.25, 783.99, 1046.5], t + 0.5, 2.4, out);
      for (var j = 0; j < 7; j++) {
        tone(1600 + Math.random() * 1500, 'sine', t + 0.6 + j * 0.08, 0.5, 0.035, out, { rev: 0.5 });
      }
    },
    jackpot: function (out) {
      // Grand jackpot — climbing chimes, brass, choir, and a sparkle tail.
      var t = ctx.currentTime;
      timpani(t, out);
      var notes = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) {
        tone(notes[i], 'sine', t + i * 0.33, 0.6, 0.17, out, { rev: 0.4 });
        brass(notes[i], t + i * 0.33, 0.55, 0.09, out);
      }
      choirPad([523.25, 783.99, 1046.5], t + 1.2, 2.0, out);
      for (var j = 0; j < 9; j++) {
        tone(1500 + Math.random() * 1700, 'sine', t + 1.3 + j * 0.07, 0.6, 0.045, out, { rev: 0.5 });
      }
    },
    freespins: function (out) {
      // Magical shimmer cascade (free-spins / bonus trigger).
      var t = ctx.currentTime;
      var scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1318.51, 1567.98];
      for (var i = 0; i < 14; i++) {
        var n = scale[i % scale.length] * (i < 8 ? 1 : 2);
        tone(n, 'sine', t + i * 0.05, 0.5, 0.065, out, { rev: 0.5 });
        tone(n * 1.005, 'triangle', t + i * 0.05, 0.4, 0.025, out);
      }
      chord([523.25, 659.25, 783.99, 1046.5], t + 0.7, 1.2, 0.07, out, 'sine', 0.4);
    }
  };

  // Legacy / spec-name aliases so both vocabularies resolve.
  var ALIASES = {
    'spin-start': 'spin',
    'button-click': 'click',
    'win-big': 'win-big',
    tick: 'jackpot-tick'
  };

  function findSound(name) {
    if (SFX[name]) return { fn: SFX[name], bus: 'sfx' };
    if (MUSIC[name]) return { fn: MUSIC[name], bus: 'music' };
    return null;
  }

  function play(name, opts) {
    if (!initialized || muted) return;
    if (ALIASES[name]) name = ALIASES[name];
    var entry = findSound(name);
    if (!entry) return;
    if (entry.bus === 'sfx' && !sfxOn) return;
    if (entry.bus === 'music' && !musicOn) return;
    var busNode = entry.bus === 'music' ? musicBus : sfxBus;
    ensureContext(function () {
      try { entry.fn(busNode, opts); } catch (e) { /* never let a sound crash gameplay */ }
    });
  }

  // ── Ambient soundscapes (procedural, looping, route through Ambient bus)
  //
  // Each builder wires a small local sub-mix into the ambient bus and
  // returns a teardown fn. A shared helper cleans up oscillators, noise
  // sources, scheduling intervals, and fades the layer out smoothly.

  var ambientStop = null;       // teardown for the running soundscape
  var currentAmbientCat = null; // last requested category
  var pendingAmbient = null;    // requested before the context existed

  function teardown(g, nodes, timers) {
    var i;
    for (i = 0; i < timers.length; i++) clearInterval(timers[i]);
    try {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    } catch (e) { /* noop */ }
    setTimeout(function () {
      for (var j = 0; j < nodes.length; j++) {
        try { nodes[j].stop(); } catch (e) { /* not a source */ }
        try { nodes[j].disconnect(); } catch (e) { /* noop */ }
      }
      try { g.disconnect(); } catch (e) { /* noop */ }
    }, 700);
  }

  function rampUp(param, to, secs) {
    try {
      var t = ctx.currentTime;
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(to, t + secs);
    } catch (e) { try { param.value = to; } catch (_) { /* noop */ } }
  }

  // A continuously-running filtered-noise bed (wind / waves / fire / hum).
  function noiseBed(g, nodes, vol, filtType, filtFreq, q) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filtType; f.frequency.value = filtFreq; f.Q.value = q || 0.6;
    var bg = ctx.createGain(); bg.gain.value = vol;
    src.connect(f); f.connect(bg); bg.connect(g);
    src.start(ctx.currentTime, Math.random() * 1.5);
    nodes.push(src);
    return f; // caller may LFO-modulate the filter
  }

  // A slow LFO that sweeps a target AudioParam (filter motion / swell).
  function lfoOn(nodes, target, rate, depth, center) {
    var lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = rate;
    var lg = ctx.createGain(); lg.gain.value = depth;
    lfo.connect(lg); lg.connect(target);
    if (center !== undefined) { try { target.value = center; } catch (e) { /* noop */ } }
    lfo.start();
    nodes.push(lfo);
    return lfo;
  }

  var AMBIENTS = {
    // Egyptian — desert wind with distant drums.
    egyptian: function (g, nodes, timers) {
      var lp = noiseBed(g, nodes, 0.26, 'lowpass', 560, 0.6);
      lfoOn(nodes, lp.frequency, 0.07, 280, 560);
      timers.push(setInterval(function () {
        if (muted) return;
        var t = ctx.currentTime;
        var o = ctx.createOscillator(); o.type = 'sine';
        var dg = envGain(t, 0.45, 0.2, g, 0.005, 0.3);
        o.frequency.setValueAtTime(124, t);
        o.frequency.exponentialRampToValueAtTime(58, t + 0.22);
        o.connect(dg); o.start(t); o.stop(t + 0.5);
      }, 1700));
    },
    // Ocean — rolling waves with the odd seagull.
    ocean: function (g, nodes, timers) {
      // Build the bed straight into an amplitude stage we can LFO so the
      // wave volume swells in and out (rather than modulating the filter).
      var lp = noiseBed(g, nodes, 1.0, 'lowpass', 700, 0.5);
      var amp = ctx.createGain(); amp.gain.value = 0.22;
      lp.disconnect();
      lp.connect(amp); amp.connect(g);
      lfoOn(nodes, amp.gain, 0.12, 0.14, 0.22);
      lfoOn(nodes, lp.frequency, 0.1, 260, 700);
      timers.push(setInterval(function () {
        if (muted || Math.random() > 0.5) return;
        var t = ctx.currentTime;
        sweep(1400, 1900, 'sine', t, 0.18, 0.05, g, { rev: 0.4 });
        sweep(1850, 1500, 'sine', t + 0.2, 0.16, 0.045, g, { rev: 0.4 });
      }, 5200));
    },
    // Forest / nature — gentle breeze with bird calls.
    forest: function (g, nodes, timers) {
      var bp = noiseBed(g, nodes, 0.16, 'bandpass', 900, 0.4);
      lfoOn(nodes, bp.frequency, 0.13, 400, 900);
      timers.push(setInterval(function () {
        if (muted || Math.random() > 0.6) return;
        var t = ctx.currentTime;
        var base = 2200 + Math.random() * 1200;
        for (var k = 0; k < 3; k++) {
          tone(base + (k % 2 ? 250 : 0), 'sine', t + k * 0.08, 0.07, 0.05, g, { rev: 0.3 });
        }
      }, 3400));
    },
    // Space — deep hum with radar pings.
    space: function (g, nodes, timers) {
      var freqs = [55, 82.5, 110];
      for (var i = 0; i < freqs.length; i++) {
        var o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sine';
        o.frequency.value = freqs[i];
        o.detune.value = (i % 2 ? 5 : -5);
        var og = ctx.createGain(); og.gain.value = 0.09;
        o.connect(og); og.connect(g);
        o.start(); nodes.push(o);
      }
      var lp = noiseBed(g, nodes, 0.05, 'lowpass', 240, 0.5);
      lfoOn(nodes, lp.frequency, 0.05, 120, 240);
      timers.push(setInterval(function () {
        if (muted) return;
        var t = ctx.currentTime;
        tone(1760, 'sine', t, 0.12, 0.06, g, { rev: 0.6 });
        tone(1760, 'sine', t + 0.28, 0.1, 0.035, g, { rev: 0.6 });
      }, 4300));
    },
    // Fire — crackling flames.
    fire: function (g, nodes, timers) {
      var lp = noiseBed(g, nodes, 0.2, 'lowpass', 420, 0.7);
      lfoOn(nodes, lp.frequency, 0.6, 120, 420);
      timers.push(setInterval(function () {
        if (muted) return;
        var n = 1 + (Math.random() * 3 | 0);
        for (var k = 0; k < n; k++) {
          var t = ctx.currentTime + Math.random() * 0.25;
          noiseHit(t, 0.03, 0.06 + Math.random() * 0.05, 'highpass', 2200 + Math.random() * 1500, 1, g);
        }
      }, 380));
    },
    // Neon / cyberpunk — electronic ambient drone.
    neon: function (g, nodes, timers) {
      var drone = [73.42, 110, 146.83];
      for (var i = 0; i < drone.length; i++) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = drone[i];
        o.detune.value = (i % 2 ? 8 : -8);
        var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 4;
        var og = ctx.createGain(); og.gain.value = 0.06;
        o.connect(f); f.connect(og); og.connect(g);
        o.start(); nodes.push(o);
        if (i === 0) lfoOn(nodes, f.frequency, 0.15, 380, 600);
      }
      timers.push(setInterval(function () {
        if (muted || Math.random() > 0.55) return;
        var t = ctx.currentTime;
        var seq = [440, 660, 587.33, 880];
        var n = seq[Math.random() * seq.length | 0];
        tone(n, 'square', t, 0.06, 0.04, g, { rev: 0.4 });
        tone(n * 1.5, 'square', t + 0.1, 0.05, 0.03, g, { rev: 0.4 });
      }, 2600));
    },
    // Default — subtle casino-floor murmur.
    'default': function (g, nodes, timers) {
      var lp = noiseBed(g, nodes, 0.12, 'lowpass', 480, 0.4);
      lfoOn(nodes, lp.frequency, 0.09, 160, 480);
      timers.push(setInterval(function () {
        if (muted || Math.random() > 0.4) return;
        var t = ctx.currentTime;
        tone(1046.5 + (Math.random() * 200 - 100), 'sine', t, 0.16, 0.025, g, { rev: 0.5 });
      }, 6000));
    }
  };

  function startAmbient(cat) {
    if (!cat) return;
    currentAmbientCat = cat;
    if (!ambientOn) return;             // opt-in only
    if (!initialized) { pendingAmbient = cat; return; }
    var key = AMBIENTS[cat] ? cat : 'default';
    stopAmbient();
    ensureContext(function () {
      try {
        var g = ctx.createGain();
        g.gain.value = 0.0001;
        g.connect(ambientBus);
        rampUp(g.gain, 1.0, 2.0);
        // Lift the ambient bus from silence the first time it's used.
        smooth(ambientBus.gain, 1.0);
        var nodes = [], timers = [];
        AMBIENTS[key](g, nodes, timers);
        ambientStop = function () { teardown(g, nodes, timers); };
      } catch (e) { /* ambience is optional polish */ }
    });
    pendingAmbient = null;
  }

  function stopAmbient() {
    if (ambientStop) { try { ambientStop(); } catch (e) { /* noop */ } ambientStop = null; }
  }

  // ── Master mute / volume ────────────────────────────────────────────
  function applyVolume() { if (master) smooth(master.gain, muted ? 0.0001 : volume); }

  function setMuted(val) {
    muted = !!val;
    lsSet('ms_sound_muted', muted);
    applyVolume();
    updateButtons();
  }

  function setVolume(v) {
    volume = clamp01(v);
    lsSet('ms_sound_volume', volume);
    applyVolume();
    updateButtons();
  }

  function setSfxEnabled(v) { sfxOn = !!v; lsSet('ms_sfx_enabled', sfxOn); }
  function setMusicEnabled(v) { musicOn = !!v; lsSet('ms_music_enabled', musicOn); }
  function setAmbientEnabled(v) {
    ambientOn = !!v;
    lsSet('ms_ambient_enabled', ambientOn);
    if (ambientOn) { startAmbient(currentAmbientCat || pendingAmbient || 'default'); }
    else { stopAmbient(); }
  }

  // ── Settings panel + header button ──────────────────────────────────
  var headerBtn = null;

  function updateButtons() {
    var glyph = muted ? '🔇' : '🔊';
    if (headerBtn) headerBtn.textContent = glyph;
    syncPanel();
  }

  function injectPanelStyle() {
    if (document.getElementById('ms-sound-style')) return;
    var css =
      '#ms-sound-overlay{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}' +
      '#ms-sound-panel{width:min(92vw,360px);background:linear-gradient(160deg,#0b140d,#070b08);' +
      'border:1px solid rgba(0,255,65,.35);border-radius:16px;box-shadow:0 0 40px rgba(0,255,65,.18),0 18px 50px rgba(0,0,0,.6);' +
      "color:#d6ffe0;font-family:'Inter',system-ui,sans-serif;padding:20px 20px 22px;}" +
      '#ms-sound-panel h3{margin:0 0 4px;font-size:1.05rem;letter-spacing:.04em;color:#00ff41;display:flex;align-items:center;gap:8px;}' +
      '#ms-sound-panel .ms-sub{margin:0 0 16px;font-size:.74rem;opacity:.6;}' +
      '#ms-sound-panel .ms-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid rgba(0,255,65,.08);}' +
      '#ms-sound-panel .ms-row label{font-size:.86rem;}' +
      '#ms-sound-panel input[type=range]{width:100%;accent-color:#00ff41;margin-top:10px;cursor:pointer;}' +
      '#ms-sound-panel .ms-vol{font-variant-numeric:tabular-nums;font-size:.78rem;color:#00ff41;opacity:.85;}' +
      '.ms-switch{position:relative;width:44px;height:24px;flex:0 0 auto;}' +
      '.ms-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;}' +
      '.ms-switch .ms-track{position:absolute;inset:0;background:#243027;border-radius:999px;transition:background .2s;}' +
      '.ms-switch .ms-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#7d8a80;transition:transform .2s,background .2s;}' +
      '.ms-switch input:checked~.ms-track{background:rgba(0,255,65,.28);}' +
      '.ms-switch input:checked~.ms-track .ms-knob{transform:translateX(20px);background:#00ff41;}' +
      '#ms-sound-panel .ms-close{margin-top:18px;width:100%;padding:11px;border:none;border-radius:10px;cursor:pointer;' +
      'background:linear-gradient(180deg,#00ff41,#00b62e);color:#04210c;font-weight:700;letter-spacing:.05em;font-size:.85rem;}' +
      '@media (prefers-reduced-motion: reduce){.ms-switch .ms-knob,.ms-switch .ms-track{transition:none;}}';
    var st = document.createElement('style');
    st.id = 'ms-sound-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function makeSwitch(checked, onChange) {
    var wrap = document.createElement('span');
    wrap.className = 'ms-switch';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    var track = document.createElement('span');
    track.className = 'ms-track';
    var knob = document.createElement('span');
    knob.className = 'ms-knob';
    track.appendChild(knob);
    wrap.appendChild(input);
    wrap.appendChild(track);
    input.addEventListener('change', function () { onChange(input.checked); });
    wrap._input = input;
    return wrap;
  }

  var panelRefs = null;

  function syncPanel() {
    if (!panelRefs) return;
    if (panelRefs.master) { panelRefs.master.value = String(Math.round(volume * 100)); }
    if (panelRefs.volLabel) { panelRefs.volLabel.textContent = Math.round(volume * 100) + '%'; }
    if (panelRefs.mute) panelRefs.mute._input.checked = !muted;
    if (panelRefs.sfx) panelRefs.sfx._input.checked = sfxOn;
    if (panelRefs.music) panelRefs.music._input.checked = musicOn;
    if (panelRefs.ambient) panelRefs.ambient._input.checked = ambientOn;
  }

  function row(labelText, control) {
    var r = document.createElement('div');
    r.className = 'ms-row';
    var l = document.createElement('label');
    l.textContent = labelText;
    r.appendChild(l);
    r.appendChild(control);
    return r;
  }

  function closeSettings() {
    var ov = document.getElementById('ms-sound-overlay');
    if (ov) ov.remove();
    panelRefs = null;
    document.removeEventListener('keydown', onPanelKey);
  }

  function onPanelKey(e) { if (e.key === 'Escape') closeSettings(); }

  function openSettings() {
    initAudio(); // counts as a user gesture → unlocks audio
    if (document.getElementById('ms-sound-overlay')) return;
    injectPanelStyle();

    var overlay = document.createElement('div');
    overlay.id = 'ms-sound-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Sound settings');

    var panel = document.createElement('div');
    panel.id = 'ms-sound-panel';

    var h = document.createElement('h3');
    h.appendChild(document.createTextNode('🔊 Sound'));
    var sub = document.createElement('p');
    sub.className = 'ms-sub';
    sub.textContent = 'Premium synthesized audio — no downloads.';
    panel.appendChild(h);
    panel.appendChild(sub);

    // Master volume.
    var volWrap = document.createElement('div');
    var volTop = document.createElement('div');
    volTop.className = 'ms-row';
    volTop.style.borderTop = 'none';
    var volLbl = document.createElement('label');
    volLbl.textContent = 'Master volume';
    var volVal = document.createElement('span');
    volVal.className = 'ms-vol';
    volVal.textContent = Math.round(volume * 100) + '%';
    volTop.appendChild(volLbl);
    volTop.appendChild(volVal);
    var slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.value = String(Math.round(volume * 100));
    slider.setAttribute('aria-label', 'Master volume');
    slider.addEventListener('input', function () {
      var v = parseInt(slider.value, 10) / 100;
      if (muted && v > 0) setMuted(false);
      setVolume(v);
      volVal.textContent = Math.round(v * 100) + '%';
    });
    volWrap.appendChild(volTop);
    volWrap.appendChild(slider);
    panel.appendChild(volWrap);

    // Toggles.
    var muteSw = makeSwitch(!muted, function (on) { setMuted(!on); });
    var sfxSw = makeSwitch(sfxOn, function (on) { setSfxEnabled(on); if (on) play('click'); });
    var musicSw = makeSwitch(musicOn, function (on) { setMusicEnabled(on); if (on) play('win-small'); });
    var ambSw = makeSwitch(ambientOn, function (on) { setAmbientEnabled(on); });

    panel.appendChild(row('Sound on', muteSw));
    panel.appendChild(row('Sound effects', sfxSw));
    panel.appendChild(row('Music & wins', musicSw));
    panel.appendChild(row('Ambient soundscape', ambSw));

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ms-close';
    close.textContent = 'Done';
    close.addEventListener('click', closeSettings);
    panel.appendChild(close);

    overlay.appendChild(panel);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSettings(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onPanelKey);

    panelRefs = { master: slider, volLabel: volVal, mute: muteSw, sfx: sfxSw, music: musicSw, ambient: ambSw };
  }

  // Header button (non-game pages that expose .header-right / .actions).
  // Game pages get their own control via the casino engine, which calls
  // MatrixSound.openSettings().
  function injectHeaderButton() {
    if (headerBtn) return;
    var container = document.querySelector('.header-right') || document.querySelector('.actions');
    if (!container) return;
    headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.setAttribute('aria-label', 'Sound settings');
    headerBtn.setAttribute('title', 'Sound settings');
    headerBtn.textContent = muted ? '🔇' : '🔊';
    var s = headerBtn.style;
    s.background = 'none'; s.border = 'none'; s.cursor = 'pointer'; s.fontSize = '20px';
    s.lineHeight = '1'; s.padding = '6px'; s.borderRadius = '8px'; s.color = '#9ca3af';
    s.transition = 'color .2s, background .2s'; s.display = 'inline-flex';
    s.alignItems = 'center'; s.justifyContent = 'center'; s.verticalAlign = 'middle';
    headerBtn.addEventListener('mouseenter', function () {
      headerBtn.style.color = '#f0f0f5'; headerBtn.style.background = 'rgba(255,255,255,0.08)';
    });
    headerBtn.addEventListener('mouseleave', function () {
      headerBtn.style.color = '#9ca3af'; headerBtn.style.background = 'none';
    });
    headerBtn.addEventListener('click', function (e) { e.stopPropagation(); openSettings(); });
    var bell = container.querySelector('.notification-bell, [class*="notification"]');
    if (bell) container.insertBefore(headerBtn, bell);
    else container.insertBefore(headerBtn, container.firstChild);
  }

  // ── Event integration ───────────────────────────────────────────────
  function bindEvents() {
    window.addEventListener('matrix-sound', function (e) {
      if (e.detail && e.detail.type) play(e.detail.type, e.detail.opts);
    });
    // Subtle tactile click on interactive controls (skips our own button).
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('.btn, button');
      if (el && el !== headerBtn && !el.closest('#ms-sound-panel')) play('click');
    });
  }

  // ── Unlock audio on first user gesture (autoplay policy) ────────────
  function onFirstInteraction() {
    initAudio();
    document.removeEventListener('click', onFirstInteraction, true);
    document.removeEventListener('touchstart', onFirstInteraction, true);
    document.removeEventListener('keydown', onFirstInteraction, true);
  }
  document.addEventListener('click', onFirstInteraction, true);
  document.addEventListener('touchstart', onFirstInteraction, true);
  document.addEventListener('keydown', onFirstInteraction, true);

  function onReady() {
    injectHeaderButton();
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
    setMasterVolume: setVolume,
    getVolume: function () { return volume; },
    isMuted: function () { return muted; },
    setSfxEnabled: setSfxEnabled,
    setMusicEnabled: setMusicEnabled,
    setAmbientEnabled: setAmbientEnabled,
    isSfxEnabled: function () { return sfxOn; },
    isMusicEnabled: function () { return musicOn; },
    isAmbientEnabled: function () { return ambientOn; },
    startAmbient: startAmbient,
    stopAmbient: stopAmbient,
    openSettings: openSettings,
    closeSettings: closeSettings
  };

})();
