import type { Prefs } from "./prefs";

/**
 * Strike force from key-hold duration.
 *
 * Mac keyboards report no pressure, but how long a key stays down tracks how
 * firmly it was pressed surprisingly well. The glyph lands at keydown and then
 * "settles" darker the longer the key is held. In adaptive mode, durations are
 * judged against your own recent median, so a typist with a quick touch still
 * gets the full range.
 */
export class StrikeForce {
  private recent: number[] = [];
  private sorted = 95;

  constructor(private prefs: () => Prefs) {}

  /** 0..1 strength for a key held `ms` so far. */
  strength(ms: number): number {
    const p = this.prefs();
    if (!p.holdInk) return 0.6;
    if (p.holdMode === "fixed") {
      return clamp01((ms - 25) / Math.max(40, p.holdFullMs - 25));
    }
    if (ms <= 0) return 0;
    // Median hold maps to 0.5; ~1.8× the median reaches full strength.
    return clamp01(0.5 + 0.6 * Math.log2(ms / this.sorted));
  }

  /** Feed back a completed hold so the adaptive model tracks your touch. */
  record(ms: number) {
    if (ms < 15 || ms > 900) return;
    this.recent.push(ms);
    if (this.recent.length > 60) this.recent.shift();
    const s = [...this.recent].sort((a, b) => a - b);
    this.sorted = s[Math.floor(s.length / 2)];
  }

  get median() {
    return this.sorted;
  }

  /** Ink density for a strength, before ribbon wear and jitter. */
  ink(strength: number): number {
    const p = this.prefs();
    return p.minInk + (p.maxInk - p.minInk) * strength;
  }
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Small deterministic PRNG, so documents render the same each time they open. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * How much ink is left on a band. A ribbon fades with use and is never
 * perfectly even along its length, so wear adds a slow wobble too.
 */
export function ribbonFactor(use: number, life: number, enabled: boolean): number {
  if (!enabled) return 1;
  const worn = Math.min(1, use / Math.max(1000, life));
  const wobble = 0.05 * Math.sin(use * 0.0131) + 0.035 * Math.sin(use * 0.0717 + 1.3);
  return Math.max(0.3, 1 - 0.6 * worn + wobble);
}
