import { fontById } from "../core/catalog";

const loaded = new Map<string, Promise<string>>();

/** Loads a bundled font on demand and returns its CSS family name. Only the document's font is ever loaded. */
export function loadFont(id: string): Promise<string> {
  const info = fontById(id);
  let p = loaded.get(info.id);
  if (!p) {
    const family = `TWX ${info.name}`;
    p = new FontFace(family, `url(fonts/${info.file})`)
      .load()
      .then((face) => {
        document.fonts.add(face);
        return family;
      })
      .catch(() => "Courier New, monospace");
    loaded.set(info.id, p);
  }
  return p;
}

/** Font size (px == pt here) at which the face's advance width fills one character cell. */
export function fontSizeForPitch(family: string, cw: number): number {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = `100px "${family}"`;
  const sample = "MWmwil0";
  let total = 0;
  for (const ch of sample) total += ctx.measureText(ch).width;
  const advance = total / sample.length / 100;
  // Real typefaces are cut a touch smaller than their cell, so letters never touch.
  return Math.min(cw * 2.1, (cw / advance) * 0.98);
}

export const cssFont = (size: number, family: string) => `${size}px "${family}"`;
