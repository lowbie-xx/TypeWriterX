import type { PaperSize, Ribbon } from "./types";

export interface FontInfo {
  id: string;
  name: string;
  file: string;
  note: string;
}

/** Bundled, openly licensed faces (see public/fonts/licenses). */
export const FONTS: FontInfo[] = [
  { id: "special-elite", name: "Special Elite", file: "SpecialElite-Regular.ttf", note: "Worn, inky manual typewriter" },
  { id: "courier-prime", name: "Courier Prime", file: "CourierPrime-Regular.ttf", note: "Clean office Courier" },
  { id: "cutive-mono", name: "Cutive Mono", file: "CutiveMono-Regular.ttf", note: "Light 1950s portable" },
  { id: "sometype-mono", name: "Sometype Mono", file: "SometypeMono.ttf", note: "Crisp typewriter-inspired mono" },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", file: "IBMPlexMono-Regular.ttf", note: "Modern electric (golf-ball) feel" },
];

export const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];

const MM = 72 / 25.4;

export const PAPERS: PaperSize[] = [
  { name: "A4", w: 210 * MM, h: 297 * MM },
  { name: "US Letter", w: 612, h: 792 },
  { name: "US Legal", w: 612, h: 1008 },
  { name: "A5", w: 148 * MM, h: 210 * MM },
  { name: "Index card 5×3", w: 360, h: 216 },
  { name: "Postcard 6×4", w: 432, h: 288 },
];

export const PAPER_COLORS: { name: string; color: string }[] = [
  { name: "Bond white", color: "#fbfaf6" },
  { name: "Cream", color: "#f6efdc" },
  { name: "Onionskin", color: "#eeede6" },
  { name: "Aged", color: "#e9ddbd" },
  { name: "Manila", color: "#e8d6a4" },
  { name: "Blue carbon copy", color: "#e3e9ef" },
];

export const RIBBONS: Ribbon[] = [
  { name: "Black", bands: ["#1d1b1c"] },
  { name: "Black / Red", bands: ["#1d1b1c", "#b3261e"] },
  { name: "Navy", bands: ["#1f2f6b"] },
  { name: "Navy / Red", bands: ["#1f2f6b", "#b3261e"] },
  { name: "Purple (copying)", bands: ["#4a2a6e"] },
  { name: "Sepia / Green", bands: ["#5a3a1f", "#23533b"] },
  { name: "Four colour", bands: ["#1d1b1c", "#b3261e", "#1f3f8a", "#22663f"] },
];

export const PITCHES = [
  { cpi: 10, name: "Pica (10 cpi)" },
  { cpi: 12, name: "Elite (12 cpi)" },
  { cpi: 15, name: "Micro (15 cpi)" },
];

export const SPACINGS = [1, 1.5, 2, 2.5, 3];
