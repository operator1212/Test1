// Tiny procedural sound effects via WebAudio (no asset files needed).
'use strict';

const Sfx = {
  ctx: null,
  master: null,
  noiseBuf: null,
  laser: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  noise(dur, freq, q, vol, type = 'bandpass', sweepTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rand(0.8, 1.2);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },

  tone(f0, f1, dur, vol, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },

  harpoon() { this.noise(0.18, 900, 1.2, 0.8, 'bandpass', 200); this.tone(180, 60, 0.15, 0.4, 'square'); },
  thunk() { this.noise(0.12, 400, 2, 0.9, 'lowpass', 90); this.tone(120, 50, 0.1, 0.5, 'triangle'); },
  squelch() { this.noise(0.25, 700, 3, 0.9, 'bandpass', 150); this.tone(90, 40, 0.2, 0.3, 'sawtooth'); },
  whip() { this.noise(0.12, 2500, 1, 0.35, 'bandpass', 600); },
  latch() { this.noise(0.1, 300, 4, 0.7, 'lowpass', 80); },
  rip() { this.noise(0.45, 500, 1, 1.0, 'bandpass', 80); this.tone(70, 30, 0.35, 0.5, 'sawtooth'); },
  scream() { this.tone(rand(500, 700), rand(250, 350), 0.5, 0.12, 'sawtooth'); },
  denied() { this.tone(200, 120, 0.15, 0.25, 'square'); },

  laserOn(on) {
    if (!this.ctx) return;
    if (on && !this.laser) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110;
      const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 223;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 31;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 18;
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = this.ctx.createGain(); g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.22, this.ctx.currentTime + 0.05);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o.start(); o2.start(); lfo.start();
      this.laser = { o, o2, lfo, g };
    } else if (!on && this.laser) {
      const l = this.laser; this.laser = null;
      const t = this.ctx.currentTime;
      l.g.gain.cancelScheduledValues(t);
      l.g.gain.setValueAtTime(l.g.gain.value, t);
      l.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      l.o.stop(t + 0.1); l.o2.stop(t + 0.1); l.lfo.stop(t + 0.1);
    }
  },
};
