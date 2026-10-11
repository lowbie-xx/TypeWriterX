/** App-wide preferences (not stored in documents). Persisted in localStorage. */
export interface Prefs {
  // Strike force — stand-ins for key pressure, which Macs can't sense.
  holdInk: boolean;
  holdMode: "adaptive" | "fixed";
  holdFullMs: number;
  minInk: number;
  maxInk: number;
  ribbonWear: boolean;
  /** Strikes until a band reaches its faintest. */
  ribbonLife: number;
  jitter: boolean;
  jitterAmount: number;
  typebarWear: number;
  unevenStrike: number;
  inkTexture: number;

  // Tipp-Ex brush
  tippexSize: number;
  tippexColor: string;
  /** How much the fluid hides what's beneath (thin coats let letters ghost through). */
  tippexOpacity: number;
  /** Keep the brush in hand while typing, instead of putting it down at the first key. */
  tippexStaysOn: boolean;

  // Carriage & paper
  viewMode: "carriage" | "paper";
  smoothCarriage: boolean;
  marginLock: boolean;
  atMargin: "pileup" | "block";
  bell: boolean;
  autoWrap: boolean;
  autoFeed: boolean;
  keyRepeat: boolean;
  arrowKeys: boolean;
  clickToPosition: "off" | "free" | "always";
  purist: boolean;
  reinsertDrift: boolean;

  // Platen & trackpad
  scrollSensitivity: number;
  ratchetPx: number;
  invertScroll: boolean;
  freeSnap: boolean;

  // Sound
  sound: boolean;
  volume: number;
  bellSound: boolean;
  /** Detent clicks while scrolling the platen / carriage. */
  gestureSound: boolean;

  // Export
  exportDpi: number;

  // Appearance
  desk: "auto" | "walnut" | "slate" | "linen";
  showGuide: boolean;
  showScale: boolean;
  autoHideToolbar: boolean;

  // New document defaults
  defaultFont: string;
  defaultPitch: number;
  defaultPaper: string;
  defaultPaperColor: string;
  defaultRibbon: string;
}

export const DEFAULT_PREFS: Prefs = {
  holdInk: true,
  holdMode: "adaptive",
  holdFullMs: 220,
  minInk: 0.45,
  maxInk: 1,
  ribbonWear: true,
  ribbonLife: 40000,
  jitter: true,
  jitterAmount: 0.5,
  typebarWear: 0.5,
  unevenStrike: 0.5,
  inkTexture: 0.55,

  tippexSize: 9,
  tippexColor: "#fdfdfb",
  tippexOpacity: 0.8,
  tippexStaysOn: true,

  viewMode: "carriage",
  smoothCarriage: true,
  marginLock: true,
  atMargin: "pileup",
  bell: true,
  autoWrap: false,
  autoFeed: true,
  keyRepeat: false,
  arrowKeys: true,
  clickToPosition: "free",
  purist: false,
  reinsertDrift: true,

  scrollSensitivity: 1,
  ratchetPx: 28,
  invertScroll: false,
  freeSnap: false,

  sound: true,
  volume: 0.6,
  bellSound: true,
  gestureSound: true,

  exportDpi: 200,

  desk: "auto",
  showGuide: true,
  showScale: true,
  autoHideToolbar: true,

  defaultFont: "special-elite",
  defaultPitch: 10,
  defaultPaper: "A4",
  defaultPaperColor: "#fbfaf6",
  defaultRibbon: "Black / Red",
};

const KEY = "typewriterx.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: run on defaults */
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
