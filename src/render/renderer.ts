import type { Machine } from "../core/machine";
import type { Prefs } from "../core/prefs";
import type { Strike } from "../core/types";
import { drawPaper, drawStrike, prepareText, type StrikeStyle } from "./strikes";

export interface DeskTheme {
  desk: string;
  deskEdge: string;
  platen: [string, string, string];
}

export const DESKS: Record<"walnut" | "slate" | "linen", DeskTheme> = {
  walnut: { desk: "#26211c", deskEdge: "#1b1714", platen: ["#3d3835", "#121110", "#26221f"] },
  slate: { desk: "#1f2328", deskEdge: "#16191d", platen: ["#3a3d42", "#101214", "#24272b"] },
  linen: { desk: "#d9d3c8", deskEdge: "#cbc4b7", platen: ["#4a4542", "#151312", "#2b2724"] },
};

const MAX_LAYER_SCALE = 2.5;

/**
 * Draws the desk, sheet, ink and machine furniture onto one canvas.
 *
 * Settled strikes are rasterised once into a paper-space layer, so only the
 * strikes still being held (and darkening) are drawn each frame.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  W = 0;
  H = 0;
  zoom = 1.6;
  private userZoomed = false;
  private zoomChangedAt = 0;
  pan = { x: 0, y: 0 };
  private recentering = false;
  private cam = { x: 0, y: 0 };
  private raf = 0;
  private last = 0;
  style: StrikeStyle = { cw: 7.2, fontSize: 12, font: "12px monospace", texture: 0.5, uneven: 0.5 };
  theme: DeskTheme = DESKS.walnut;
  /** Bumped for visual changes that need the ink layer redrawn (font, prefs). */
  revision = 0;

  private layer = document.createElement("canvas");
  private layerCtx = this.layer.getContext("2d")!;
  private layerKey = "";
  private layerCount = 0;
  private held = new Set<Strike>();

  onFrame: () => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private machine: Machine,
    private prefs: () => Prefs,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get carriageView() {
    return this.prefs().viewMode === "carriage";
  }

  private get anchor() {
    return { x: this.W / 2 + this.pan.x, y: this.H * 0.56 + this.pan.y };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.userZoomed) this.zoom = this.fitZoom();
    this.request();
  }

  fitZoom() {
    const pw = this.machine.s.paper.w;
    const fit = (this.W * (this.carriageView ? 0.8 : 0.88)) / pw;
    return Math.max(0.4, Math.min(2.6, fit));
  }

  setZoom(z: number, focus?: { x: number; y: number }) {
    z = Math.max(0.35, Math.min(5, z));
    if (focus) {
      const a = this.anchor;
      const k = z / this.zoom;
      this.pan.x = focus.x - k * (focus.x - a.x) - this.W / 2;
      this.pan.y = focus.y - k * (focus.y - a.y) - this.H * 0.56;
    }
    this.zoom = z;
    this.userZoomed = true;
    this.zoomChangedAt = performance.now();
    this.request();
    // Re-rasterise the ink layer once the zoom settles.
    setTimeout(() => this.request(), 220);
  }

  resetZoom() {
    this.userZoomed = false;
    this.zoom = this.fitZoom();
    this.pan = { x: 0, y: 0 };
    this.request();
  }

  panBy(dx: number, dy: number) {
    this.pan.x += dx;
    this.pan.y += dy;
    this.recentering = false;
    this.request();
  }

  /** Glide back to the type point after looking around. */
  recenter() {
    if (this.pan.x || this.pan.y) {
      this.recentering = true;
      this.request();
    }
  }

  snapCamera() {
    this.cam = this.camTarget();
    this.request();
  }

  invalidate() {
    this.revision++;
    this.request();
  }

  request() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private camTarget() {
    const m = this.machine.m;
    if (this.carriageView) return { x: m.c + this.style.cw / 2, y: m.p };
    const P = this.machine.toPaper(m.c, m.p);
    return { x: this.machine.s.paper.w / 2, y: P.y };
  }

  private frame(now: number) {
    this.raf = 0;
    const dt = Math.min(64, now - (this.last || now));
    this.last = now;
    let animating = this.machine.tick(performance.now());

    const t = this.camTarget();
    if (!this.prefs().smoothCarriage) {
      this.cam = t;
    } else {
      const k = 1 - Math.exp(-dt / 50);
      this.cam.x += (t.x - this.cam.x) * k;
      this.cam.y += (t.y - this.cam.y) * k;
      if (Math.abs(t.x - this.cam.x) > 0.02 || Math.abs(t.y - this.cam.y) > 0.02) animating = true;
      else this.cam = t;
    }
    if (this.recentering) {
      const k = 1 - Math.exp(-dt / 90);
      this.pan.x -= this.pan.x * k;
      this.pan.y -= this.pan.y * k;
      if (Math.abs(this.pan.x) + Math.abs(this.pan.y) < 0.5) {
        this.pan = { x: 0, y: 0 };
        this.recentering = false;
      } else animating = true;
    }

    this.draw();
    this.onFrame();
    if (animating) this.request();
  }

  /** Paper coordinates → CSS pixels. */
  paperMatrix(): DOMMatrix {
    const a = this.anchor;
    const m = this.machine.m;
    let M = new DOMMatrix().translate(a.x, a.y).scale(this.zoom).translate(-this.cam.x, -this.cam.y);
    if (this.carriageView) M = M.rotate((-m.a * 180) / Math.PI).translate(-m.tx, -m.ty);
    return M;
  }

  machineMatrix(): DOMMatrix {
    const m = this.machine.m;
    return this.paperMatrix().translate(m.tx, m.ty).rotate((m.a * 180) / Math.PI);
  }

  screenToPaper(x: number, y: number) {
    const p = this.paperMatrix().inverse().transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
  }

  private setMatrix(M: DOMMatrix) {
    const d = this.dpr;
    this.ctx.setTransform(M.a * d, M.b * d, M.c * d, M.d * d, M.e * d, M.f * d);
  }

  draw() {
    const { ctx, machine } = this;
    const pr = this.prefs();
    const doc = machine.s;
    const { w, h } = doc.paper;
    const z = this.zoom;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.theme.desk;
    ctx.fillRect(0, 0, this.W, this.H);

    const a = this.anchor;
    if (this.carriageView && pr.showGuide) this.drawPlaten(a.y, z);

    this.setMatrix(this.paperMatrix());
    drawPaper(ctx, w, h, doc.paperColor, true);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    this.drawInk(w, h);
    ctx.restore();

    if (pr.showScale || pr.showGuide) {
      this.setMatrix(this.machineMatrix());
      if (pr.showScale) this.drawScale();
      if (pr.showGuide) this.drawPointer();
    }
  }

  private drawPlaten(y: number, z: number) {
    const { ctx } = this;
    const top = y - 21 * z, bot = y + 11 * z;
    const g = ctx.createLinearGradient(0, top, 0, bot);
    const [hi, mid, lo] = this.theme.platen;
    g.addColorStop(0, hi);
    g.addColorStop(0.45, mid);
    g.addColorStop(1, lo);
    ctx.fillStyle = g;
    ctx.fillRect(0, top, this.W, bot - top);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(0, top + 3 * z, this.W, 1.2 * z);
  }

  private drawInk(w: number, h: number) {
    const { ctx, machine } = this;
    const strikes = machine.sheet.strikes;
    const pr = this.prefs();
    this.style.texture = pr.inkTexture;
    this.style.uneven = pr.unevenStrike;

    // Strikes still under a held key keep darkening, so they stay "live".
    this.held = machine.heldStrikes;
    let settledEnd = strikes.length;
    for (let i = strikes.length - 1; i >= Math.max(0, strikes.length - 24); i--) {
      if (this.held.has(strikes[i])) settledEnd = i;
    }

    const now = performance.now();
    const ideal = Math.min(MAX_LAYER_SCALE, Math.max(1, Math.round(this.zoom * this.dpr * 4) / 4));
    const pinching = now - this.zoomChangedAt < 200 && this.layerKey !== "";
    const scale = pinching ? +this.layerKey.split("|")[0] : ideal;
    const key = [scale, machine.m.sheet, this.revision, machine.revision, this.style.font, this.style.texture, this.style.uneven, w, h].join("|");
    if (key !== this.layerKey || this.layerCount > settledEnd) {
      this.layerKey = key;
      this.layerCount = 0;
      this.layer.width = Math.ceil(w * scale);
      this.layer.height = Math.ceil(h * scale);
    }
    if (this.layerCount < settledEnd) {
      const lc = this.layerCtx;
      lc.setTransform(scale, 0, 0, scale, 0, 0);
      prepareText(lc, this.style);
      for (let i = this.layerCount; i < settledEnd; i++) drawStrike(lc, strikes[i], this.style);
      this.layerCount = settledEnd;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.layer, 0, 0, this.layer.width / scale, this.layer.height / scale);

    if (settledEnd < strikes.length) {
      prepareText(ctx, this.style);
      for (let i = settledEnd; i < strikes.length; i++) drawStrike(ctx, strikes[i], this.style);
    }
  }

  /** The carriage scale: column ticks, margin stops, tab stops and the bell zone. */
  private drawScale() {
    const { ctx, machine } = this;
    const m = machine.m;
    const cw = machine.cw;
    const doc = machine.s;
    const y0 = m.p + LINE_GAP;
    const hgt = 6.2;
    const x0 = this.carriageView ? -cw * 6 : 0;
    const x1 = this.carriageView ? doc.paper.w + cw * 6 : doc.paper.w;

    ctx.fillStyle = "rgba(120,130,140,0.07)";
    ctx.fillRect(x0, y0, x1 - x0, hgt);
    ctx.fillStyle = "rgba(200,60,40,0.10)";
    ctx.fillRect(machine.bellPoint, y0, machine.rightStop - machine.bellPoint, hgt);

    ctx.fillStyle = "rgba(40,40,48,0.42)";
    const cols = Math.ceil(doc.paper.w / cw);
    for (let i = 0; i <= cols; i++) {
      const x = i * cw;
      const len = i % 10 === 0 ? 2.6 : i % 5 === 0 ? 1.8 : 1;
      ctx.fillRect(x - 0.08, y0, 0.16, len);
    }
    ctx.font = "2.6px -apple-system, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let i = 10; i < cols; i += 10) ctx.fillText(String(i), i * cw, y0 + 5.6);

    // Tab stops
    ctx.fillStyle = "rgba(40,90,160,0.55)";
    const step = doc.tabEvery * cw;
    for (let x = machine.leftStop + step; x < machine.rightStop - 0.1; x += step) {
      ctx.fillRect(x - 0.35, y0 + hgt - 1.1, 0.7, 1.1);
    }
    // Margin stops
    ctx.fillStyle = "rgba(170,40,30,0.75)";
    for (const [x, dir] of [[machine.leftStop, 1], [machine.rightStop, -1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + hgt);
      ctx.lineTo(x + dir * 1.8, y0 + hgt);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Type-point indicator: a pointer on the scale and a faint cell outline. */
  private drawPointer() {
    const { ctx, machine } = this;
    const m = machine.m;
    const cw = machine.cw;
    const sess = machine.session;
    const fs = this.style.fontSize;
    const color = sess.correction
      ? "120,120,120"
      : sess.free
        ? "47,124,246"
        : sess.marginRelease
          ? "214,138,0"
          : "192,57,43";
    const cx = m.c + cw / 2;

    ctx.fillStyle = `rgba(${color},0.08)`;
    ctx.fillRect(m.c, m.p - fs * 0.78, cw, fs);
    ctx.fillStyle = `rgba(${color},0.9)`;
    const y = m.p + LINE_GAP;
    ctx.beginPath();
    ctx.moveTo(cx, y - 0.4);
    ctx.lineTo(cx - 1.5, y + 2.4);
    ctx.lineTo(cx + 1.5, y + 2.4);
    ctx.closePath();
    ctx.fill();

    if (sess.free) {
      ctx.fillStyle = `rgba(${color},0.35)`;
      ctx.fillRect(m.c - cw * 4, m.p, cw * 9, 0.18);
      ctx.fillRect(cx - 0.09, m.p - fs * 1.6, 0.18, fs * 2.2);
    }
  }
}

/** Gap between the baseline and the scale, clear of descenders. */
const LINE_GAP = 3.6;
