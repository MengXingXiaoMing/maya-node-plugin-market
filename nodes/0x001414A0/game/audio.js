/* ==========================================================================
   锻剑纳贡 · 音效（WebAudio 实时合成，无外部音频资源）
   ========================================================================== */

(function () {
  'use strict';

  class ForgeAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noise = null;
      this.enabled = true;
      this.volume = 0.65;
      this.ambient = null;
    }

    ensure() {
      if (!this.enabled) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        this.noise = this._makeNoise(2);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.03);
      }
      if (!on) this.stopAmbient();
      else if (this.ctx) this.startAmbient();
    }

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.enabled ? this.volume : 0,
          this.ctx.currentTime,
          0.03
        );
      }
    }

    _makeNoise(seconds) {
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
      return buf;
    }

    _tone(freq, duration, gain, type, delay, endFreq) {
      const ctx = this.ctx;
      if (!ctx) return;
      const now = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.04);
    }

    _noiseBurst(duration, freq, q, gain, type, delay) {
      const ctx = this.ctx;
      if (!ctx) return;
      const now = ctx.currentTime + (delay || 0);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = type || 'bandpass';
      filter.frequency.setValueAtTime(freq, now);
      filter.Q.value = q || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start(now);
      src.stop(now + duration + 0.03);
    }

    startAmbient() {
      const ctx = this.ensure();
      if (!ctx || this.ambient) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start();

      const drone = ctx.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = 48;
      const dg = ctx.createGain();
      dg.gain.value = 0.018;
      drone.connect(dg);
      dg.connect(this.master);
      drone.start();

      this.ambient = { src, drone, g, dg };
    }

    stopAmbient() {
      if (!this.ambient) return;
      const { src, drone, g, dg } = this.ambient;
      try {
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        dg.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
        src.stop(this.ctx.currentTime + 0.8);
        drone.stop(this.ctx.currentTime + 0.8);
      } catch (e) { /* ignore */ }
      this.ambient = null;
    }

    /* 铁锤砸在剑上 */
    hammer(strong) {
      if (!this.ensure()) return;
      const now = this.ctx.currentTime;
      const base = strong ? 380 : 330;
      const partials = [
        [base, 0.22, 0.32],
        [base * 2.03, 0.14, 0.26],
        [base * 3.42, 0.08, 0.19],
        [base * 5.1, 0.04, 0.13]
      ];
      partials.forEach((p, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(p[0], now);
        osc.frequency.exponentialRampToValueAtTime(p[0] * 0.99, now + p[2]);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(p[1], now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p[2]);
        osc.connect(g);
        g.connect(this.master);
        osc.start(now);
        osc.stop(now + p[2] + 0.03);
      });
      this._noiseBurst(0.1, strong ? 2800 : 2100, 0.8, strong ? 0.3 : 0.2);
    }

    success() {
      if (!this.ensure()) return;
      this._tone(660, 0.32, 0.07, 'sine', 0.01);
      this._tone(990, 0.28, 0.04, 'sine', 0.05);
    }

    great() {
      if (!this.ensure()) return;
      [784, 988, 1318, 1568].forEach((f, i) => this._tone(f, 0.5, 0.055, 'sine', i * 0.055));
      this._noiseBurst(0.22, 4200, 0.7, 0.09, 'bandpass', 0.02);
    }

    hold() {
      if (!this.ensure()) return;
      this._tone(300, 0.22, 0.06, 'triangle');
      this._tone(450, 0.18, 0.025, 'sine', 0.02);
    }

    damage() {
      if (!this.ensure()) return;
      this._noiseBurst(0.18, 1100, 0.6, 0.18, 'bandpass');
      this._tone(210, 0.2, 0.09, 'square', 0, 95);
    }

    shatter() {
      if (!this.ensure()) return;
      this._noiseBurst(0.6, 2400, 0.4, 0.32, 'highpass');
      this._noiseBurst(0.4, 800, 0.6, 0.24, 'lowpass');
      this._tone(170, 0.5, 0.12, 'sawtooth', 0, 40);
      this._tone(80, 0.6, 0.1, 'sine', 0.02, 34);
    }

    frenzy() {
      if (!this.ensure()) return;
      [440, 660, 880, 1320].forEach((f, i) => this._tone(f, 0.7, 0.045, 'sine', i * 0.03));
      this._noiseBurst(0.7, 3000, 0.5, 0.08, 'bandpass', 0.02);
    }

    bell() {
      if (!this.ensure()) return;
      [880, 1320, 1760, 2640].forEach((f, i) => this._tone(f, 1.4, 0.05 / (i + 1), 'sine', i * 0.01));
    }

    coin() {
      if (!this.ensure()) return;
      this._tone(988, 0.14, 0.055, 'sine');
      this._tone(1480, 0.18, 0.04, 'sine', 0.06);
    }

    relic() {
      if (!this.ensure()) return;
      [523, 784, 1046, 1568].forEach((f, i) => this._tone(f, 0.55, 0.045, 'sine', i * 0.07));
      this._noiseBurst(0.35, 5200, 0.7, 0.05, 'bandpass', 0.05);
    }

    heat() {
      if (!this.ensure()) return;
      this._noiseBurst(1.3, 700, 0.3, 0.12, 'lowpass');
      this._tone(70, 1.2, 0.05, 'sine', 0, 120);
    }

    roar() {
      if (!this.ensure()) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(46, now + 0.9);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.9);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      osc.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 1.2);
      this._noiseBurst(0.9, 320, 0.4, 0.16, 'lowpass', 0.05);
    }

    gate() {
      if (!this.ensure()) return;
      this._noiseBurst(0.35, 180, 0.5, 0.14, 'lowpass');
      this._tone(120, 0.4, 0.08, 'triangle', 0, 70);
    }

    ui() {
      if (!this.ensure()) return;
      this._tone(880, 0.05, 0.03, 'triangle');
    }

    error() {
      if (!this.ensure()) return;
      this._tone(160, 0.16, 0.07, 'square', 0, 110);
    }
  }

  window.ForgeAudio = ForgeAudio;
})();
