import type { SoundEvent } from "../core/machine";
import type { Prefs } from "../core/prefs";

/**
 * Every sound is synthesised with WebAudio — no sample files. The audio
 * context is created lazily on the first keystroke and suspends when idle.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private idleTimer = 0;
  private lastTick = 0;

  constructor(private prefs: () => Prefs) {}

  private ensure(): AudioContext | null {
    if (!this.prefs().sound) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.master.gain.value = this.prefs().volume;
    // Release the audio device when the machine falls quiet.
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => void this.ctx?.suspend(), 8000);
    return this.ctx;
  }

  play(e: SoundEvent, amount = 0.5) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.002;
    switch (e) {
      case "key":
        this.clack(t, 0.55 + amount * 0.45, 2600 + Math.random() * 900);
        break;
      case "space":
        this.clack(t, 0.45, 1300, 0.05);
        break;
      case "backspace":
        this.clack(t, 0.35, 1800, 0.035);
        this.thump(t, 0.25, 140);
        break;
      case "jam":
        this.clack(t, 0.3, 900, 0.03);
        this.thump(t, 0.4, 90);
        break;
      case "ratchet": {
        // Platen detent: one short, dry click. Scrolling can fire dozens of
        // notches a second, so clicks are rate-limited and never overlap.
        if (!this.prefs().gestureSound) break;
        const now = performance.now();
        if (now - this.lastTick < 45) break;
        this.lastTick = now;
        this.tick(t);
        break;
      }
      case "lever":
        this.clack(t, 0.3, 3200, 0.02);
        this.clack(t + 0.03, 0.2, 2400, 0.02);
        break;
      case "release":
        this.clack(t, 0.35, 2000, 0.03);
        this.thump(t, 0.2, 180);
        break;
      case "bell":
        if (this.prefs().bellSound) this.bell(t);
        break;
      case "return":
        this.carriage(t, amount);
        break;
      case "feed":
        this.zip(t, 0.5, 18, 0.45);
        break;
    }
  }

  private noiseBurst(t: number, gain: number, freq: number, q: number, decay: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4, decay + 0.02);
  }

  private tick(t: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 3500 + Math.random() * 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.006);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4, 0.008);
  }

  /** Typebar hitting the platen: bright click with a body thump. */
  private clack(t: number, gain: number, freq: number, decay = 0.045) {
    this.noiseBurst(t, gain * 1.6, freq, 1.4, decay);
    this.noiseBurst(t + 0.004, gain * 0.7, freq * 2.3, 3, decay * 0.6);
    this.thump(t, gain * 0.5, 110 + Math.random() * 30);
  }

  private thump(t: number, gain: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** The margin bell: a struck metal dome with inharmonic partials. */
  private bell(t: number) {
    const ctx = this.ctx!;
    const base = 2093;
    for (const [ratio, gain, decay] of [[1, 0.32, 1.4], [2.76, 0.12, 0.7], [5.4, 0.06, 0.35], [0.5, 0.05, 0.9]]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    this.noiseBurst(t, 0.25, 6000, 2, 0.02);
  }

  /** Ratchet clicks while the carriage travels, then the slam at the margin stop. */
  private carriage(t: number, travel: number) {
    const dur = 0.08 + travel * 0.28;
    this.zip(t, 0.35, Math.round(4 + travel * 22), dur);
    this.clack(t + dur, 0.8, 1100, 0.08);
    this.thump(t + dur, 0.6, 85);
    this.clack(t + dur + 0.05, 0.3, 3500, 0.02);
  }

  private zip(t: number, gain: number, clicks: number, dur: number) {
    for (let i = 0; i < clicks; i++) {
      // Clicks speed up as the carriage gathers pace.
      const p = i / clicks;
      const at = t + dur * Math.sqrt(p);
      this.noiseBurst(at, gain * (0.6 + Math.random() * 0.4), 3800 + Math.random() * 800, 4, 0.012);
    }
  }
}
