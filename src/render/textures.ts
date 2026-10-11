import { mulberry32 } from "../core/ink";

/** Paper-space size of one texel in the ink texture, in points. */
export const INK_TEXEL = 0.11;
const TILE = 128;

/** Smooth value noise in a tileable square, values 0..1. */
function valueNoise(size: number, cells: number, rng: () => number): Float32Array {
  const grid = new Float32Array(cells * cells).map(() => rng());
  const out = new Float32Array(size * size);
  const step = size / cells;
  for (let y = 0; y < size; y++) {
    const gy = y / step, y0 = Math.floor(gy) % cells, y1 = (y0 + 1) % cells, fy = gy - Math.floor(gy);
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const gx = x / step, x0 = Math.floor(gx) % cells, x1 = (x0 + 1) % cells, fx = gx - Math.floor(gx);
      const sx = fx * fx * (3 - 2 * fx);
      const a = grid[y0 * cells + x0], b = grid[y0 * cells + x1];
      const c = grid[y1 * cells + x0], d = grid[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

let inkNoise: Float32Array | null = null;
function getInkNoise() {
  if (inkNoise) return inkNoise;
  const rng = mulberry32(1337);
  const blob = valueNoise(TILE, 8, rng);
  const mid = valueNoise(TILE, 32, rng);
  inkNoise = new Float32Array(TILE * TILE);
  for (let i = 0; i < inkNoise.length; i++) {
    // Ribbon fabric weave + uneven inking + occasional dry specks.
    const fine = rng();
    const speck = rng() < 0.035 ? 0.75 : 0;
    inkNoise[i] = Math.min(1, 0.4 * blob[i] + 0.35 * mid[i] + 0.25 * fine + speck);
  }
  return inkNoise;
}

export function parseHex(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const inkCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/** A tileable, speckled ink fill for a ribbon colour (cached per context). */
export function inkPattern(ctx: CanvasRenderingContext2D, color: string, texture: number): CanvasPattern | string {
  if (texture <= 0.01) return color;
  let map = inkCache.get(ctx);
  if (!map) inkCache.set(ctx, (map = new Map()));
  const key = color + "|" + texture.toFixed(2);
  const hit = map.get(key);
  if (hit) return hit;
  const noise = getInkNoise();
  const cv = document.createElement("canvas");
  cv.width = cv.height = TILE;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(TILE, TILE);
  const [r, gr, b] = parseHex(color);
  for (let i = 0; i < noise.length; i++) {
    const a = 1 - texture * 0.85 * noise[i];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gr;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.max(0, Math.min(255, a * 255));
  }
  g.putImageData(img, 0, 0);
  const pat = ctx.createPattern(cv, "repeat")!;
  if (map.size > 24) map.clear();
  map.set(key, pat);
  return pat;
}

let grainCanvas: HTMLCanvasElement | null = null;

/** Faint paper fibres, drawn over the paper colour. */
export function paperGrain(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (!grainCanvas) {
    const size = 256;
    const rng = mulberry32(42);
    const blob = valueNoise(size, 16, rng);
    grainCanvas = document.createElement("canvas");
    grainCanvas.width = grainCanvas.height = size;
    const g = grainCanvas.getContext("2d")!;
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      // Mostly fine fibre noise, with only a whisper of cloudiness.
      const v = blob[i] * 0.25 + rng() * 0.75;
      const dark = v > 0.5;
      const shade = dark ? 70 : 255;
      img.data[i * 4] = shade;
      img.data[i * 4 + 1] = shade - (dark ? 5 : 0);
      img.data[i * 4 + 2] = shade - (dark ? 15 : 0);
      img.data[i * 4 + 3] = Math.abs(v - 0.5) * 2 * 11;
    }
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(grainCanvas, "repeat")!;
}
