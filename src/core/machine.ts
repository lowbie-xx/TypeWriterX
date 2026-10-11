import { firstBaseline } from "./document";
import { StrikeForce, clamp01, hashString, mulberry32, ribbonFactor } from "./ink";
import type { Prefs } from "./prefs";
import { LINE_HEIGHT, type MachineState, type Strike, type TwxDocument } from "./types";

export type SoundEvent =
  | "key"
  | "space"
  | "backspace"
  | "bell"
  | "return"
  | "ratchet"
  | "jam"
  | "feed"
  | "lever"
  | "release";

/** Lever and lock positions for this session (they aren't saved with the document). */
export interface Session {
  /** Line-release lever: the platen and carriage move freely and margins don't lock. */
  free: boolean;
  lockX: boolean;
  lockY: boolean;
  lockRot: boolean;
  /** Margin release, held until the next carriage return. */
  marginRelease: boolean;
  /** One-shot correction tape: the next strike covers instead of inks. */
  correction: boolean;
  /** Tipp-Ex brush: the pointer paints whiteout instead of moving the carriage. */
  tippex: boolean;
}

interface Held {
  strike: Strike;
  t0: number;
  mult: number;
}

interface UndoEntry {
  sheet: number;
  len: number;
  before: MachineState;
  after?: MachineState;
  added?: Strike[];
  moved?: { s: Strike; x: number; y: number }[];
}

const snapshot = (m: MachineState): MachineState => ({ ...m, ribbonUse: [...m.ribbonUse] });

export class Machine {
  session: Session = {
    free: false,
    lockX: false,
    lockY: false,
    lockRot: false,
    marginRelease: false,
    correction: false,
    tippex: false,
  };
  readonly force: StrikeForce;
  /** Live strength of the most recent strike, for the toolbar meter. */
  lastStrength = 0;

  private held = new Map<string, Held>();
  /** The Tipp-Ex stroke being brushed right now, if any. */
  private stroke: Strike | null = null;
  private strokeEntry: UndoEntry | null = null;
  /** Bumped when strikes change other than by being appended (undo, wrap, load…). */
  revision = 0;
  private bellRung = false;
  private word: Strike[] = [];
  private wordStartC = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  onSound: (e: SoundEvent, amount?: number) => void = () => {};
  /** `content` is true when strikes or document settings changed (as opposed to just moving). */
  onChange: (content: boolean) => void = () => {};

  constructor(
    public doc: TwxDocument,
    private prefs: () => Prefs,
  ) {
    this.force = new StrikeForce(prefs);
  }

  // ── geometry ──────────────────────────────────────────────────────────────
  get s() {
    return this.doc.settings;
  }
  get m() {
    return this.doc.machine;
  }
  get cw() {
    return 72 / this.s.pitch;
  }
  get sheet() {
    return this.doc.sheets[this.m.sheet];
  }
  get leftStop() {
    return this.s.margins.left;
  }
  get rightStop() {
    return this.s.paper.w - this.s.margins.right;
  }
  get bellPoint() {
    return this.rightStop - this.s.bellCols * this.cw;
  }
  get lineAdvance() {
    return LINE_HEIGHT * this.m.spacing;
  }
  get column() {
    return (this.m.c - this.leftStop) / this.cw + 1;
  }
  get line() {
    return (this.m.p - firstBaseline(this.s)) / LINE_HEIGHT + 1;
  }
  get canUndo() {
    return !this.prefs().purist && this.undoStack.length > 0;
  }
  get canRedo() {
    return !this.prefs().purist && this.redoStack.length > 0;
  }
  get isHolding() {
    return this.held.size > 0;
  }

  /** Strikes that are still changing (held keys, the stroke being brushed). */
  get heldStrikes(): Set<Strike> {
    const set = new Set<Strike>();
    for (const h of this.held.values()) set.add(h.strike);
    if (this.stroke) set.add(this.stroke);
    return set;
  }

  toPaper(c: number, p: number) {
    const { a, tx, ty } = this.m;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x: cos * c - sin * p + tx, y: sin * c + cos * p + ty };
  }

  toMachine(x: number, y: number) {
    const { a, tx, ty } = this.m;
    const cos = Math.cos(a), sin = Math.sin(a);
    const dx = x - tx, dy = y - ty;
    return { c: cos * dx + sin * dy, p: -sin * dx + cos * dy };
  }

  /** Swap in a different document (open / new). */
  load(doc: TwxDocument) {
    this.doc = doc;
    this.held.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.word = [];
    this.bellRung = this.m.c >= this.bellPoint;
    this.session.marginRelease = false;
    this.session.correction = false;
    this.stroke = null;
    this.revision++;
    this.onChange(false);
  }

  // ── Tipp-Ex ───────────────────────────────────────────────────────────────

  toggleTippex(on = !this.session.tippex) {
    this.session.tippex = on;
    this.onSound("lever");
    this.onChange(false);
  }

  /** Start brushing whiteout at a point on the sheet. */
  beginStroke(x: number, y: number) {
    const pr = this.prefs();
    this.strokeEntry = this.beginUndo(snapshot(this.m));
    this.stroke = { c: "", x: 0, y: 0, r: 0, k: pr.tippexOpacity, s: Math.random(), col: pr.tippexColor, w: pr.tippexSize, path: [x, y] };
    this.sheet.strikes.push(this.stroke);
    this.onChange(true);
  }

  extendStroke(x: number, y: number) {
    const path = this.stroke?.path;
    if (!path) return;
    const lx = path[path.length - 2], ly = path[path.length - 1];
    if (Math.hypot(x - lx, y - ly) < 0.5) return;
    path.push(x, y);
    this.onChange(true);
  }

  endStroke() {
    if (!this.stroke) return;
    this.stroke = null;
    this.commitUndo(this.strokeEntry);
    this.strokeEntry = null;
    this.onChange(true);
  }

  // ── striking ──────────────────────────────────────────────────────────────

  /** A printable key went down. `code` pairs it with its keyup for hold-to-darken. */
  press(ch: string, code: string | null, now: number) {
    const pr = this.prefs();
    const sess = this.session;
    const locked = !sess.free && !sess.marginRelease && this.m.c >= this.rightStop - 0.01;
    let advance = true;
    const before = snapshot(this.m);
    let moved: UndoEntry["moved"];

    if (locked) {
      if (pr.autoWrap) {
        moved = this.wrapWord();
      } else if (pr.marginLock) {
        if (pr.atMargin === "block") {
          this.onSound("jam");
          return;
        }
        // Keys pile up on the same spot, as on a machine at its margin stop.
        advance = false;
      }
    }

    // Taken after any wrap, which may have fed a new sheet.
    const entry = this.beginUndo(before);
    if (entry && moved) entry.moved = moved;

    const m = this.m, cw = this.cw;
    const startC = m.c;
    const origin = this.toPaper(m.c, m.p);
    const cos = Math.cos(m.a), sin = Math.sin(m.a);

    // Each typebar has its own consistent misalignment, plus a little random wobble.
    let dx = 0, dy = 0, dr = 0;
    if (pr.typebarWear > 0) {
      const rng = mulberry32(hashString(ch, this.s.machineSeed));
      dx += (rng() - 0.5) * 0.7 * pr.typebarWear;
      dy += (rng() - 0.5) * 0.9 * pr.typebarWear;
      dr += (rng() - 0.5) * 0.035 * pr.typebarWear;
    }
    let mult = 1;
    if (pr.jitter) {
      const j = pr.jitterAmount;
      dx += (Math.random() - 0.5) * 0.3 * j;
      dy += (Math.random() - 0.5) * 0.5 * j;
      dr += (Math.random() - 0.5) * 0.016 * j;
      mult *= 1 + (Math.random() - 0.5) * 0.18 * j;
    }

    const x = origin.x + cos * dx - sin * dy;
    const y = origin.y + sin * dx + cos * dy;
    const onPaper = x + cw / 2 > 0 && x + cw / 2 < this.s.paper.w && y > 2 && y < this.s.paper.h + 2;

    let col: string | null = null;
    let cov = false;
    if (sess.correction) {
      col = this.s.paperColor;
      cov = true;
      sess.correction = false;
    } else if (m.band >= 0) {
      const band = Math.min(m.band, this.s.ribbon.bands.length - 1);
      col = this.s.ribbon.bands[band];
      mult *= ribbonFactor(m.ribbonUse[band] ?? 0, pr.ribbonLife, pr.ribbonWear);
      m.ribbonUse[band] = (m.ribbonUse[band] ?? 0) + 1;
    }

    const strength = this.force.strength(code ? 0 : this.force.median);
    const strike: Strike = {
      c: ch,
      x,
      y,
      r: m.a + dr,
      k: cov ? 0.95 : clamp01(this.force.ink(strength) * mult),
      col,
      s: Math.random(),
      ...(cov ? { cov: true } : {}),
    };

    if (onPaper) {
      this.sheet.strikes.push(strike);
      if (!this.word.length) this.wordStartC = startC;
      this.word.push(strike);
      if (code && !cov) this.held.set(code, { strike, t0: now, mult });
    }
    this.lastStrength = strength;
    this.onSound("key", strength);

    if (advance) this.advance(cw);
    this.commitUndo(entry);
    this.onChange(true);
  }

  /** Called every animation frame while keys are down; darkens held strikes. Returns true if any are still held. */
  tick(now: number): boolean {
    for (const [code, h] of this.held) {
      const ms = now - h.t0;
      const st = this.force.strength(ms);
      h.strike.k = clamp01(this.force.ink(st) * h.mult);
      this.lastStrength = st;
      if (ms > 700) this.held.delete(code);
    }
    return this.held.size > 0;
  }

  release(code: string, now: number) {
    const h = this.held.get(code);
    if (!h) return;
    const ms = now - h.t0;
    h.strike.k = clamp01(this.force.ink(this.force.strength(ms)) * h.mult);
    this.force.record(ms);
    this.held.delete(code);
    this.onChange(true);
  }

  releaseAll(now: number) {
    for (const code of [...this.held.keys()]) this.release(code, now);
  }

  // ── carriage ──────────────────────────────────────────────────────────────

  private advance(dc: number) {
    const before = this.m.c;
    this.m.c = Math.min(this.m.c + dc, this.s.paper.w);
    const bp = this.bellPoint;
    if (!this.bellRung && before < bp && this.m.c >= bp) {
      this.bellRung = true;
      if (this.prefs().bell) this.onSound("bell");
    }
  }

  space() {
    const pr = this.prefs();
    this.word = [];
    if (!this.session.free && !this.session.marginRelease && this.m.c >= this.rightStop - 0.01) {
      if (pr.autoWrap) return this.carriageReturn(true);
      if (pr.marginLock) return this.onSound("jam");
    }
    this.onSound("space");
    this.advance(this.cw);
    this.onChange(false);
  }

  backspace() {
    this.word = [];
    const inMargin = this.m.c < this.leftStop - 0.01;
    const min = inMargin || this.session.free || this.session.marginRelease ? 0 : this.leftStop;
    if (this.m.c <= min + 0.01) return this.onSound("jam");
    this.m.c = Math.max(min, this.m.c - this.cw);
    if (this.m.c < this.bellPoint) this.bellRung = false;
    this.onSound("backspace");
    this.onChange(false);
  }

  /** Half-space key: nudges the carriage half a character. */
  halfSpace(dir: 1 | -1) {
    this.word = [];
    this.m.c = Math.max(0, Math.min(this.s.paper.w, this.m.c + (dir * this.cw) / 2));
    this.onSound("backspace");
    this.onChange(false);
  }

  /** Arrow keys: move the carriage a whole character without striking. */
  stepCarriage(dir: 1 | -1) {
    if (dir < 0) return this.backspace();
    this.word = [];
    if (!this.session.free && !this.session.marginRelease && this.m.c >= this.rightStop - 0.01 && this.prefs().marginLock) {
      return this.onSound("jam");
    }
    this.onSound("space");
    this.advance(this.cw);
    this.onChange(false);
  }

  /** Slide the carriage whole characters (trackpad scroll in ratchet mode). One click, no key sounds. */
  slideCarriage(cols: number) {
    if (!cols) return;
    this.word = [];
    const locked = !this.session.free && !this.session.marginRelease && this.prefs().marginLock;
    const min = this.m.c < this.leftStop - 0.01 || !locked ? 0 : this.leftStop;
    const max = locked && this.m.c <= this.rightStop + 0.01 ? this.rightStop : this.s.paper.w;
    const target = Math.max(min, Math.min(max, this.m.c + cols * this.cw));
    if (Math.abs(target - this.m.c) < 0.01) return;
    if (target > this.m.c) this.advance(target - this.m.c);
    else {
      this.m.c = target;
      if (this.m.c < this.bellPoint) this.bellRung = false;
    }
    this.onSound("ratchet");
    this.onChange(false);
  }

  tab() {
    this.word = [];
    const step = this.s.tabEvery * this.cw;
    const n = Math.floor((this.m.c - this.leftStop) / step + 1e-6) + 1;
    let target = this.leftStop + n * step;
    if (!this.session.free && !this.session.marginRelease && this.prefs().marginLock) target = Math.min(target, this.rightStop);
    if (target <= this.m.c + 0.01) return this.onSound("jam");
    this.onSound("space");
    this.advance(target - this.m.c);
    this.onChange(false);
  }

  carriageReturn(lineFeed: boolean) {
    const travel = Math.abs(this.m.c - this.leftStop) / Math.max(1, this.rightStop - this.leftStop);
    this.word = [];
    this.m.c = this.leftStop;
    this.bellRung = false;
    this.session.marginRelease = false;
    this.onSound("return", travel);
    if (lineFeed) this.feedLines(this.m.spacing, false);
    this.onChange(false);
  }

  /** Roll the platen by `lines` single-line notches (negative rolls back). */
  feedLines(lines: number, sound = true) {
    this.m.p += lines * LINE_HEIGHT;
    if (sound) this.onSound("ratchet");
    this.afterPlatenMove();
    this.onChange(false);
  }

  /** Free (line-release) movement. Locks and optional snapping apply. */
  moveFree(dc: number, dp: number) {
    const sess = this.session;
    if (sess.lockX) dc = 0;
    if (sess.lockY) dp = 0;
    if (!dc && !dp) return;
    this.word = [];
    this.m.c = Math.max(-this.cw, Math.min(this.s.paper.w, this.m.c + dc));
    this.m.p += dp;
    this.afterPlatenMove();
    this.onChange(false);
  }

  /** Snap the free position onto half-character / half-line positions. */
  snapToGrid() {
    const half = this.cw / 2;
    this.m.c = this.leftStop + Math.round((this.m.c - this.leftStop) / half) * half;
    const base = firstBaseline(this.s);
    this.m.p = base + Math.round((this.m.p - base) / (LINE_HEIGHT / 2)) * (LINE_HEIGHT / 2);
  }

  /** Move the type point to a spot on the sheet (click-to-position). */
  placeAt(x: number, y: number, snap: boolean) {
    const t = this.toMachine(x, y);
    // The type point sits on the baseline; clicks land mid-letter, so drop a little.
    let c = t.c - this.cw / 2;
    let p = t.p + LINE_HEIGHT * 0.3;
    if (snap) {
      c = this.leftStop + Math.round((c - this.leftStop) / this.cw) * this.cw;
      p = this.m.p + Math.round((p - this.m.p) / LINE_HEIGHT) * LINE_HEIGHT;
    }
    this.word = [];
    this.m.c = Math.max(0, Math.min(this.s.paper.w - this.cw / 2, c));
    this.m.p = p;
    this.bellRung = this.m.c >= this.bellPoint;
    this.afterPlatenMove();
    this.onSound("ratchet");
    this.onChange(false);
  }

  private afterPlatenMove() {
    const h = this.s.paper.h;
    // The platen only has so much travel above and below the sheet.
    this.m.p = Math.max(-LINE_HEIGHT * 4, Math.min(h + LINE_HEIGHT * 4, this.m.p));
    if (this.prefs().autoFeed && !this.session.free && this.m.p > h - this.s.margins.bottom + 0.01) {
      this.feedSheet();
    }
  }

  /** Rotate the sheet in the machine about the type point. Returns false if rotation is locked. */
  rotatePaper(delta: number): boolean {
    if (this.session.lockRot) return false;
    this.setSkew(this.m.a + delta);
    return true;
  }

  setSkew(a: number) {
    const m = this.m;
    const pin = this.toPaper(m.c, m.p);
    m.a = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, a));
    const cos = Math.cos(m.a), sin = Math.sin(m.a);
    m.tx = pin.x - (cos * m.c - sin * m.p);
    m.ty = pin.y - (sin * m.c + cos * m.p);
    this.onChange(false);
  }

  straighten() {
    this.setSkew(0);
  }

  // ── levers ────────────────────────────────────────────────────────────────

  setBand(i: number) {
    const max = this.s.ribbon.bands.length - 1;
    this.m.band = i < 0 ? -1 : Math.min(i, max);
    this.onSound("lever");
    this.onChange(false);
  }

  setSpacing(sp: number) {
    this.m.spacing = sp;
    this.onSound("lever");
    this.onChange(false);
  }

  toggleFree() {
    this.session.free = !this.session.free;
    this.onSound("release");
    this.onChange(false);
  }

  toggleMarginRelease() {
    this.session.marginRelease = !this.session.marginRelease;
    this.onSound("release");
    this.onChange(false);
  }

  toggleCorrection() {
    this.session.correction = !this.session.correction;
    this.onSound("lever");
    this.onChange(false);
  }

  changeRibbon() {
    this.m.ribbonUse = this.s.ribbon.bands.map(() => 0);
    this.onSound("lever");
    this.onChange(true);
  }

  /** 0..1 ink left on the current band. */
  get ribbonLeft() {
    if (this.m.band < 0) return 1;
    const use = this.m.ribbonUse[this.m.band] ?? 0;
    return Math.max(0, 1 - use / Math.max(1000, this.prefs().ribbonLife));
  }

  // ── sheets ────────────────────────────────────────────────────────────────

  /** Roll out the current sheet and feed in the next (or a fresh one). */
  feedSheet() {
    if (this.m.sheet + 1 >= this.doc.sheets.length) this.doc.sheets.push({ strikes: [] });
    this.gotoSheet(this.m.sheet + 1);
    this.onSound("feed");
  }

  insertSheet() {
    this.doc.sheets.splice(this.m.sheet + 1, 0, { strikes: [] });
    this.gotoSheet(this.m.sheet + 1);
    this.onSound("feed");
    this.onChange(true);
  }

  gotoSheet(i: number) {
    if (i < 0 || i >= this.doc.sheets.length) return;
    const m = this.m;
    m.sheet = i;
    m.c = this.leftStop;
    m.p = firstBaseline(this.s);
    m.a = m.tx = m.ty = 0;
    // Re-inserting a sheet that's already been typed on never lines up perfectly.
    if (this.prefs().reinsertDrift && this.sheet.strikes.length) {
      m.a = (Math.random() - 0.5) * 0.012;
      m.tx = (Math.random() - 0.5) * 2.4;
      m.ty = (Math.random() - 0.5) * 2.4;
    }
    this.word = [];
    this.bellRung = false;
    this.session.marginRelease = false;
    this.onChange(false);
  }

  deleteSheet() {
    if (this.doc.sheets.length <= 1) {
      this.doc.sheets[0].strikes = [];
    } else {
      this.doc.sheets.splice(this.m.sheet, 1);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.gotoSheet(Math.min(this.m.sheet, this.doc.sheets.length - 1));
    this.onChange(true);
  }

  // ── auto-wrap (soft mode) ─────────────────────────────────────────────────

  /** Returns the strikes it moved (with their old positions) for undo. */
  private wrapWord(): UndoEntry["moved"] {
    const width = this.rightStop - this.leftStop;
    const wordWidth = this.m.c - this.wordStartC;
    const p0 = this.m.p;
    const fits = this.word.length && wordWidth < width * 0.6;
    const feeds = this.prefs().autoFeed && p0 + this.lineAdvance > this.s.paper.h - this.s.margins.bottom;
    if (!fits || feeds) {
      this.carriageReturn(true);
      return undefined;
    }
    // Carry the unfinished word down to the next line.
    const dc = this.leftStop - this.wordStartC;
    const dp = this.lineAdvance;
    const cos = Math.cos(this.m.a), sin = Math.sin(this.m.a);
    const dx = cos * dc - sin * dp, dy = sin * dc + cos * dp;
    const moved = this.word.map((s) => ({ s, x: s.x, y: s.y }));
    for (const s of this.word) {
      s.x += dx;
      s.y += dy;
    }
    this.revision++;
    this.m.c = this.leftStop + wordWidth;
    this.m.p += dp;
    this.bellRung = false;
    this.onSound("return", 0.3);
    return moved;
  }

  // ── undo ──────────────────────────────────────────────────────────────────

  private beginUndo(before: MachineState): UndoEntry | null {
    if (this.prefs().purist) return null;
    return { sheet: this.m.sheet, len: this.sheet.strikes.length, before };
  }

  private commitUndo(e: UndoEntry | null) {
    if (!e) return;
    this.undoStack.push(e);
    if (this.undoStack.length > 3000) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    const e = this.canUndo ? this.undoStack.pop() : undefined;
    if (!e) return;
    const sheet = this.doc.sheets[e.sheet];
    if (!sheet) return;
    this.held.clear();
    e.added = sheet.strikes.splice(e.len);
    this.revision++;
    if (e.moved) e.moved = this.swapPositions(e.moved);
    e.after = snapshot(this.m);
    this.doc.machine = snapshot(e.before);
    this.word = [];
    this.redoStack.push(e);
    this.onSound("backspace");
    this.onChange(true);
  }

  redo() {
    const e = this.canRedo ? this.redoStack.pop() : undefined;
    if (!e || !e.after || !e.added) return;
    const sheet = this.doc.sheets[e.sheet];
    if (!sheet) return;
    sheet.strikes.push(...e.added);
    if (e.moved) e.moved = this.swapPositions(e.moved);
    this.revision++;
    this.doc.machine = snapshot(e.after);
    this.undoStack.push(e);
    this.onSound("key", 0.5);
    this.onChange(true);
  }

  private swapPositions(list: { s: Strike; x: number; y: number }[]) {
    return list.map(({ s, x, y }) => {
      const prev = { s, x: s.x, y: s.y };
      s.x = x;
      s.y = y;
      return prev;
    });
  }
}
