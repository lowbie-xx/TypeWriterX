import { FONTS, PAPERS, PAPER_COLORS, RIBBONS } from "./catalog";
import { LINE_HEIGHT, type DocSettings, type MachineState, type Sheet, type Strike, type TwxDocument } from "./types";

export const FORMAT = "typewriterx";
export const FORMAT_VERSION = 1;

export interface NewDocOptions {
  font?: string;
  pitch?: number;
  paperName?: string;
  paperColor?: string;
  ribbonName?: string;
}

export function firstBaseline(s: DocSettings) {
  return s.margins.top + LINE_HEIGHT * 0.75;
}

export function createDocument(o: NewDocOptions = {}): TwxDocument {
  const paper = PAPERS.find((p) => p.name === o.paperName) ?? PAPERS[0];
  const ribbon = RIBBONS.find((r) => r.name === o.ribbonName) ?? RIBBONS[0];
  const pitch = o.pitch ?? 10;
  const cw = 72 / pitch;
  // Margins land on whole columns so the margin stops line up with the scale.
  const small = paper.w < 450;
  const marginCols = Math.round((small ? 0.5 : 1) * pitch);
  const settings: DocSettings = {
    font: o.font ?? FONTS[0].id,
    pitch,
    paper: { ...paper },
    paperColor: o.paperColor ?? PAPER_COLORS[0].color,
    margins: {
      left: marginCols * cw,
      right: 0,
      top: small ? 36 : 72,
      bottom: small ? 24 : 72,
    },
    tabEvery: 5,
    bellCols: 8,
    ribbon: { name: ribbon.name, bands: [...ribbon.bands] },
    machineSeed: Math.floor(Math.random() * 1e9),
  };
  // Right margin: same width as the left, but snapped to the column grid.
  const cols = Math.floor((paper.w - 2 * marginCols * cw) / cw);
  settings.margins.right = paper.w - (marginCols * cw + cols * cw);
  return {
    settings,
    sheets: [{ strikes: [] }],
    machine: freshMachine(settings),
  };
}

export function freshMachine(s: DocSettings): MachineState {
  return {
    sheet: 0,
    c: s.margins.left,
    p: firstBaseline(s),
    a: 0,
    tx: 0,
    ty: 0,
    band: 0,
    spacing: 1,
    ribbonUse: s.ribbon.bands.map(() => 0),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

type PackedStrike = [string, number, number, number, number, string | 0, number, number?];
/** Tipp-Ex strokes pack as ["~fx", width, colour, points]. Real strikes are always a single character. */
type PackedStroke = ["~fx", number, string, number[], number?];
const STROKE = "~fx";

/** Strikes are packed as arrays: an A4 page of 3,000 strikes saves to roughly 120 KB. */
export function serialize(doc: TwxDocument): string {
  const packed = {
    format: FORMAT,
    version: FORMAT_VERSION,
    settings: doc.settings,
    machine: { ...doc.machine, c: r2(doc.machine.c), p: r2(doc.machine.p) },
    sheets: doc.sheets.map((sh) => ({
      strikes: sh.strikes.map((s): PackedStrike | PackedStroke => {
        if (s.path) return [STROKE, r2(s.w ?? 8), s.col ?? "#fdfdfb", s.path.map(r2), r2(s.k)];
        const a: PackedStrike = [s.c, r2(s.x), r2(s.y), r4(s.r), r2(s.k), s.col ?? 0, r2(s.s)];
        if (s.cov) a.push(1);
        return a;
      }),
    })),
  };
  return JSON.stringify(packed);
}

export function deserialize(text: string): TwxDocument {
  const raw = JSON.parse(text);
  if (!raw || raw.format !== FORMAT) throw new Error("This isn't a TypeWriterX document.");
  if (raw.version > FORMAT_VERSION) throw new Error("This document was made by a newer version of TypeWriterX.");
  const base = createDocument();
  const settings: DocSettings = {
    ...base.settings,
    ...raw.settings,
    margins: { ...base.settings.margins, ...raw.settings?.margins },
    ribbon: raw.settings?.ribbon ?? base.settings.ribbon,
  };
  const sheets: Sheet[] = (raw.sheets ?? []).map((sh: { strikes: (PackedStrike | PackedStroke)[] }) => ({
    strikes: (sh.strikes ?? []).map(unpack),
  }));
  if (!sheets.length) sheets.push({ strikes: [] });
  const machine: MachineState = { ...freshMachine(settings), ...raw.machine };
  machine.sheet = Math.min(Math.max(0, machine.sheet | 0), sheets.length - 1);
  while (machine.ribbonUse.length < settings.ribbon.bands.length) machine.ribbonUse.push(0);
  return { settings, sheets, machine };
}

function unpack(a: PackedStrike | PackedStroke): Strike {
  if (a[0] === STROKE) {
    const [, w, col, pts, k] = a as PackedStroke;
    return { c: "", x: 0, y: 0, r: 0, k: k ?? 1, s: 0, col: String(col), w: +w, path: pts.map(Number) };
  }
  const p = a as PackedStrike;
  return {
    c: String(p[0]),
    x: +p[1],
    y: +p[2],
    r: +p[3] || 0,
    k: +p[4],
    col: p[5] === 0 ? null : String(p[5]),
    s: +p[6] || 0,
    ...(p[7] ? { cov: true } : {}),
  };
}
