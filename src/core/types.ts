/** All geometry is in PostScript points (1/72 inch), measured on the sheet. */

export interface Strike {
  /** Character struck. */
  c: string;
  /** Left edge of the character cell, on the sheet. */
  x: number;
  /** Baseline, on the sheet. */
  y: number;
  /** Rotation in radians (paper skew plus jitter). */
  r: number;
  /** Ink density 0..1. Mutable while the key is still held down. */
  k: number;
  /** Ink colour, or null for a stencil (blind, inkless) strike. */
  col: string | null;
  /** Correction cover-up strike (paints paper colour over what's beneath). */
  cov?: boolean;
  /** Per-strike random seed 0..1 (drives uneven inking and texture offset). */
  s: number;
  /**
   * Tipp-Ex: a brushed whiteout stroke instead of a letter. Flat [x0, y0, x1, y1, …]
   * on the sheet, painted at width `w`. Kept in typing order so later strikes land on top.
   */
  path?: number[];
  w?: number;
}

export interface Sheet {
  strikes: Strike[];
}

export interface Ribbon {
  name: string;
  /** 1–4 ink bands, top to bottom, as the lever selects them. */
  bands: string[];
}

export interface PaperSize {
  name: string;
  w: number;
  h: number;
}

export interface DocSettings {
  font: string;
  /** Characters per inch: 10 (pica), 12 (elite), 15 (micro). */
  pitch: number;
  paper: PaperSize;
  paperColor: string;
  margins: { left: number; right: number; top: number; bottom: number };
  /** Tab stop every N columns from the left margin. */
  tabEvery: number;
  /** The bell rings this many columns before the right margin. */
  bellCols: number;
  ribbon: Ribbon;
  /** Seeds each document's own "machine": its consistent typebar misalignments. */
  machineSeed: number;
}

/** Where the carriage, platen and paper are, saved with the document. */
export interface MachineState {
  sheet: number;
  /** Carriage position: distance from the left edge of the sheet (machine axis). */
  c: number;
  /** Platen position: distance from the top of the sheet to the baseline (machine axis). */
  p: number;
  /** Paper skew (radians) and offset. Paper = Rotate(a) * machine + (tx, ty). */
  a: number;
  tx: number;
  ty: number;
  /** Ribbon lever: band index, or -1 for stencil. */
  band: number;
  /** Line spacing lever: 1, 1.5, 2, 2.5, 3. */
  spacing: number;
  /** Strikes taken from each band, for ribbon wear. */
  ribbonUse: number[];
}

export interface TwxDocument {
  settings: DocSettings;
  sheets: Sheet[];
  machine: MachineState;
}

/** Lines per inch on every typewriter: one line is 12pt. */
export const LINE_HEIGHT = 12;
