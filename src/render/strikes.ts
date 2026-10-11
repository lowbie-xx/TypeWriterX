import type { Strike } from "../core/types";
import { INK_TEXEL, inkPattern, paperGrain } from "./textures";

export interface StrikeStyle {
  cw: number;
  fontSize: number;
  font: string;
  texture: number;
  uneven: number;
}

/** Sets the font on a context; call once before a run of drawStrike calls. */
export function prepareText(ctx: CanvasRenderingContext2D, st: StrikeStyle) {
  ctx.font = st.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
}

/**
 * Draws one strike in paper coordinates. Ink is multiplied onto what's
 * beneath, so overstrikes and mixed ribbon colours darken like real ink.
 */
export function drawStrike(ctx: CanvasRenderingContext2D, s: Strike, st: StrikeStyle) {
  if (s.path) return drawTippex(ctx, s);
  ctx.save();
  ctx.translate(s.x + st.cw / 2, s.y);
  if (s.r) ctx.rotate(s.r);

  if (s.col === null) {
    // Stencil position: the typeface embosses the paper without ink.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.5 * s.k;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(s.c, -0.18, -0.18);
    ctx.globalAlpha = 0.28 * s.k;
    ctx.fillStyle = "rgba(60,50,40,0.6)";
    ctx.fillText(s.c, 0.18, 0.22);
    ctx.restore();
    return;
  }

  if (s.cov) {
    // Correction tape: chalky paper-coloured cover-up, slightly oversized.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.93;
    ctx.fillStyle = s.col;
    ctx.strokeStyle = s.col;
    ctx.lineWidth = st.fontSize * 0.07;
    ctx.fillText(s.c, 0, 0);
    ctx.strokeText(s.c, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = fineGrain(ctx);
    ctx.fillText(s.c, 0, 0);
    ctx.restore();
    return;
  }

  const fill = inkPattern(ctx, s.col, st.texture);
  if (typeof fill !== "string") {
    // Offset the texture per strike so no two letters wear identically.
    fill.setTransform(new DOMMatrix([INK_TEXEL, 0, 0, INK_TEXEL, s.s * 97, s.s * 61]));
  }
  ctx.fillStyle = fill;
  ctx.globalCompositeOperation = "multiply";

  // An uneven strike lands harder on one side of the slug.
  const u = st.uneven * ((s.s * 7.31) % 1);
  ctx.globalAlpha = s.k * (1 - 0.45 * u);
  ctx.fillText(s.c, 0, 0);
  if (u > 0.04) {
    const side = Math.floor(s.s * 4);
    const w = st.cw, h = st.fontSize;
    ctx.beginPath();
    if (side === 0) ctx.rect(-w, -h, w, h * 1.5);
    else if (side === 1) ctx.rect(0, -h, w, h * 1.5);
    else if (side === 2) ctx.rect(-w, -h, w * 2, h * 0.62);
    else ctx.rect(-w, -h * 0.38, w * 2, h);
    ctx.clip();
    ctx.globalAlpha = s.k * 0.45 * u;
    ctx.fillText(s.c, 0, 0);
  }
  // Heavy strikes squash a little extra ink outward.
  if (s.k > 0.82) {
    ctx.globalAlpha = (s.k - 0.82) * 1.4;
    ctx.fillText(s.c, 0.14, 0.06);
  }
  ctx.restore();
}

/** Paper sheet: colour and fibres. Draw in paper coordinates. */
export function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, shadow: boolean) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = fineGrain(ctx);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Tipp-Ex: a soft, feathered coat of whiteout. Several concentric passes give
 * it a thin edge and a fuller middle; at lower coverage a faint ghost of the
 * letters beneath shows through, as with a thin real coat.
 */
function drawTippex(ctx: CanvasRenderingContext2D, s: Strike) {
  const pts = s.path!;
  const w = s.w ?? 8;
  const cover = Math.max(0.05, Math.min(1, s.k));
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  if (pts.length === 2) path.lineTo(pts[0] + 0.01, pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.col ?? "#fdfdfb";

  // Barely-there rim where the fluid sits proud of the paper.
  ctx.globalAlpha = 0.05 * cover;
  ctx.strokeStyle = "#6b5f4a";
  ctx.lineWidth = w + 0.6;
  ctx.stroke(path);

  // Feathered body: each pass narrower, building up opacity toward the centre.
  ctx.strokeStyle = s.col ?? "#fdfdfb";
  const passes = [
    [1.0, 0.3],
    [0.86, 0.4],
    [0.7, 0.5],
  ];
  for (const [scale, a] of passes) {
    ctx.globalAlpha = a * cover;
    ctx.lineWidth = w * scale;
    ctx.stroke(path);
  }

  // Dried-fluid texture: paper fibres faintly over the top.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = fineGrain(ctx);
  ctx.lineWidth = w * 0.9;
  ctx.stroke(path);
  ctx.restore();
}

/** Paper-fibre pattern at its natural scale in paper space. */
function fineGrain(ctx: CanvasRenderingContext2D) {
  const grain = paperGrain(ctx);
  grain.setTransform(new DOMMatrix([0.25, 0, 0, 0.25, 0, 0]));
  return grain;
}
