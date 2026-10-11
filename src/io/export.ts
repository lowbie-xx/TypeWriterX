import type { Prefs } from "../core/prefs";
import { LINE_HEIGHT, type Sheet, type Strike, type TwxDocument } from "../core/types";
import { drawPaper, drawStrike, prepareText, type StrikeStyle } from "../render/strikes";

// ── Reading order (plain text + the PDF's searchable layer) ─────────────────

export interface TextLine {
  x: number;
  y: number;
  /** Leading columns from the sheet's leftmost character. */
  indent: number;
  text: string;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function coveredBy(s: Strike, stroke: Strike, cw: number, fs: number) {
  const pts = stroke.path!;
  const cx = s.x + cw / 2, cy = s.y - fs * 0.3;
  const r = (stroke.w ?? 8) / 2 + fs * 0.12;
  if (pts.length === 2) return Math.hypot(cx - pts[0], cy - pts[1]) <= r;
  for (let i = 2; i < pts.length; i += 2) {
    if (segDist(cx, cy, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]) <= r) return true;
  }
  return false;
}

/**
 * Turns a sheet's strikes into lines of text. Overstruck cells keep the last
 * character typed; anything later painted over with Tipp-Ex or correction
 * tape is dropped.
 */
export function sheetLines(sheet: Sheet, cw: number, fs: number): TextLine[] {
  const list = sheet.strikes;
  const visible: { s: Strike; order: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.path || s.cov || s.col === null || !s.c.trim()) continue;
    let erased = false;
    for (let j = i + 1; j < list.length && !erased; j++) {
      const t = list[j];
      if (t.path) erased = coveredBy(s, t, cw, fs);
      else if (t.cov) erased = Math.abs(t.x - s.x) < cw / 2 && Math.abs(t.y - s.y) < LINE_HEIGHT / 2;
    }
    if (!erased) visible.push({ s, order: i });
  }
  if (!visible.length) return [];

  const minX = Math.min(...visible.map((v) => v.s.x));
  visible.sort((a, b) => a.s.y - b.s.y);
  const rows: (typeof visible)[] = [];
  for (const v of visible) {
    const row = rows[rows.length - 1];
    if (row && v.s.y - row[0].s.y < LINE_HEIGHT * 0.45) row.push(v);
    else rows.push([v]);
  }

  return rows.map((row) => {
    const cells = new Map<number, { ch: string; order: number }>();
    for (const { s, order } of row) {
      const col = Math.round((s.x - minX) / cw);
      const prev = cells.get(col);
      if (!prev || prev.order < order) cells.set(col, { ch: s.c, order });
    }
    const cols = [...cells.keys()];
    const lo = Math.min(...cols), hi = Math.max(...cols);
    let text = "";
    for (let c = lo; c <= hi; c++) text += cells.get(c)?.ch ?? " ";
    const y = row.reduce((a, v) => a + v.s.y, 0) / row.length;
    return { x: minX + lo * cw, y, indent: lo, text };
  });
}

export function toPlainText(doc: TwxDocument, fs: number): string {
  const cw = 72 / doc.settings.pitch;
  return (
    doc.sheets
      .map((sheet) => {
        let out = "";
        let prevY: number | null = null;
        for (const l of sheetLines(sheet, cw, fs)) {
          if (prevY !== null) {
            const gap = Math.max(1, Math.min(60, Math.round((l.y - prevY) / LINE_HEIGHT)));
            out += "\n".repeat(gap);
          }
          out += " ".repeat(l.indent) + l.text;
          prevY = l.y;
        }
        return out;
      })
      .join("\n\f\n") + "\n"
  );
}

// ── Raster pages ────────────────────────────────────────────────────────────

export function renderSheet(doc: TwxDocument, index: number, dpi: number, style: StrikeStyle, prefs: Prefs) {
  const { w, h } = doc.settings.paper;
  const k = dpi / 72;
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * k);
  cv.height = Math.round(h * k);
  const ctx = cv.getContext("2d", { alpha: false })!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, w, h, doc.settings.paperColor, false);
  const st = { ...style, texture: prefs.inkTexture, uneven: prefs.unevenStrike };
  prepareText(ctx, st);
  for (const s of doc.sheets[index].strikes) drawStrike(ctx, s, st);
  return cv;
}

async function canvasBytes(cv: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, type, quality));
  if (!blob) throw new Error("Couldn't encode the page image.");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function toPngs(doc: TwxDocument, dpi: number, style: StrikeStyle, prefs: Prefs) {
  const out: { suffix: string; data: Uint8Array }[] = [];
  for (let i = 0; i < doc.sheets.length; i++) {
    const cv = renderSheet(doc, i, dpi, style, prefs);
    out.push({ suffix: doc.sheets.length > 1 ? `-${i + 1}` : "", data: await canvasBytes(cv, "image/png") });
    cv.width = cv.height = 0;
  }
  return out;
}

// ── PDF: exact page images plus an invisible, selectable text layer ─────────

const latin1 = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

function pdfString(t: string) {
  let out = "";
  for (const ch of t) {
    const code = ch.codePointAt(0)!;
    const c = code >= 32 && code < 256 && !(code >= 127 && code < 160) ? ch : "?";
    out += c === "(" || c === ")" || c === "\\" ? "\\" + c : c;
  }
  return `(${out})`;
}

export async function toPdf(doc: TwxDocument, dpi: number, style: StrikeStyle, prefs: Prefs): Promise<Uint8Array> {
  const { w, h } = doc.settings.paper;
  const cw = 72 / doc.settings.pitch;
  // Courier's advance is exactly 0.6 em, so this font size matches the pitch.
  const textSize = cw / 0.6;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const put = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? latin1(b) : b;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = pos;
    put(`${n} 0 obj\n`);
    body();
    put("\nendobj\n");
  };

  const n = doc.sheets.length;
  const pageIds = Array.from({ length: n }, (_, i) => 4 + i * 3);
  put("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`));
  obj(3, () => put("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"));

  for (let i = 0; i < n; i++) {
    const [pageId, contentId, imageId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const cv = renderSheet(doc, i, dpi, style, prefs);
    const jpeg = await canvasBytes(cv, "image/jpeg", 0.9);
    const [iw, ih] = [cv.width, cv.height];
    cv.width = cv.height = 0;

    let content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q\nBT 3 Tr /F1 ${textSize.toFixed(3)} Tf\n`;
    for (const l of sheetLines(doc.sheets[i], cw, style.fontSize)) {
      content += `1 0 0 1 ${l.x.toFixed(2)} ${(h - l.y).toFixed(2)} Tm ${pdfString(l.text)} Tj\n`;
    }
    content += "ET";
    const contentBytes = latin1(content);

    obj(pageId, () =>
      put(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    obj(contentId, () => {
      put(`<< /Length ${contentBytes.length} >>\nstream\n`);
      put(contentBytes);
      put("\nendstream");
    });
    obj(imageId, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      put(jpeg);
      put("\nendstream");
    });
  }

  const xref = pos;
  const count = 4 + n * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  put(table);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info << /Producer (TypeWriterX) >> >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
