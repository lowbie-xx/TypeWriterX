import { FONTS, PAPERS, PAPER_COLORS, PITCHES, RIBBONS } from "../core/catalog";
import type { Prefs } from "../core/prefs";
import { LINE_HEIGHT } from "../core/types";
import type { AppApi } from "./api";
import { h } from "./dom";

type Item =
  | { pref: keyof Prefs; type: "toggle"; label: string; hint?: string }
  | { pref: keyof Prefs; type: "range"; label: string; min: number; max: number; step: number; fmt?: (v: number) => string; hint?: string }
  | { pref: keyof Prefs; type: "select"; label: string; options: [string | number, string][]; hint?: string }
  | { pref: keyof Prefs; type: "color"; label: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: "Strike force",
    items: [
      { pref: "holdInk", type: "toggle", label: "Hold to darken", hint: "Letters land when you press, then darken the longer you hold the key — a light tap prints faint, a firm press prints bold." },
      { pref: "holdMode", type: "select", label: "Timing", options: [["adaptive", "Adaptive — learns your touch"], ["fixed", "Fixed"]] },
      { pref: "holdFullMs", type: "range", label: "Full strike at (fixed)", min: 80, max: 500, step: 10, fmt: (v) => `${v} ms` },
      { pref: "minInk", type: "range", label: "Lightest strike", min: 0.1, max: 0.9, step: 0.01, fmt: pct },
      { pref: "maxInk", type: "range", label: "Heaviest strike", min: 0.5, max: 1, step: 0.01, fmt: pct },
      { pref: "ribbonWear", type: "toggle", label: "Ribbon wear", hint: "Each band fades as you use it. Use Machine › Change Ribbon to fit a fresh one." },
      { pref: "ribbonLife", type: "range", label: "Ribbon life", min: 5000, max: 200000, step: 5000, fmt: (v) => `${(v / 1000).toFixed(0)}k strikes` },
      { pref: "jitter", type: "toggle", label: "Strike jitter", hint: "Small random variation in position, angle and ink for every strike." },
      { pref: "jitterAmount", type: "range", label: "Jitter amount", min: 0, max: 1, step: 0.05, fmt: pct },
      { pref: "typebarWear", type: "range", label: "Typebar misalignment", min: 0, max: 1, step: 0.05, fmt: pct, hint: "Each letter sits consistently a little off, like a well-used machine. Every document gets its own machine." },
      { pref: "unevenStrike", type: "range", label: "Uneven strikes", min: 0, max: 1, step: 0.05, fmt: pct },
      { pref: "inkTexture", type: "range", label: "Ink texture", min: 0, max: 1, step: 0.05, fmt: pct },
    ],
  },
  {
    title: "Tipp-Ex",
    items: [
      { pref: "tippexSize", type: "range", label: "Brush size", min: 3, max: 30, step: 1, fmt: (v) => `${v} pt` },
      { pref: "tippexOpacity", type: "range", label: "Coverage", min: 0.3, max: 1, step: 0.05, fmt: pct, hint: "Lower values let a faint ghost of the letters show through, like a thin coat." },
      { pref: "tippexColor", type: "color", label: "Fluid colour" },
      { pref: "tippexStaysOn", type: "toggle", label: "Keep brush on while typing", hint: "Off: the brush is put down as soon as you type." },
    ],
  },
  {
    title: "Carriage",
    items: [
      { pref: "viewMode", type: "select", label: "View", options: [["carriage", "Moving carriage — paper slides past the type point"], ["paper", "Fixed paper — the type point moves"]] },
      { pref: "smoothCarriage", type: "toggle", label: "Animate carriage" },
      { pref: "marginLock", type: "toggle", label: "Margin lock", hint: "The carriage stops at the right margin until you return or press Margin Release." },
      { pref: "atMargin", type: "select", label: "Keys at the margin", options: [["pileup", "Pile up on the last space"], ["block", "Jam (don't print)"]] },
      { pref: "bell", type: "toggle", label: "Margin bell" },
      { pref: "autoWrap", type: "toggle", label: "Auto-wrap words", hint: "Soft mode: words carry over to the next line by themselves." },
      { pref: "autoFeed", type: "toggle", label: "Feed a new sheet at the bottom margin" },
      { pref: "keyRepeat", type: "toggle", label: "Key repeat" },
      { pref: "arrowKeys", type: "toggle", label: "Arrow keys move carriage & platen", hint: "⌥ + arrows move by half a space or half a line." },
      { pref: "clickToPosition", type: "select", label: "Click to position", options: [["off", "Off"], ["free", "In free mode"], ["always", "Always (snaps to the grid)"]] },
      { pref: "reinsertDrift", type: "toggle", label: "Re-inserted sheets drift", hint: "Going back to a typed sheet never lines up perfectly — just like re-feeding real paper." },
      { pref: "purist", type: "toggle", label: "Purist mode (no undo)" },
    ],
  },
  {
    title: "Platen & trackpad",
    items: [
      { pref: "scrollSensitivity", type: "range", label: "Scroll sensitivity", min: 0.2, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` },
      { pref: "ratchetPx", type: "range", label: "Ratchet notch distance", min: 8, max: 90, step: 2, fmt: (v) => `${v} px` },
      { pref: "invertScroll", type: "toggle", label: "Invert scroll direction" },
      { pref: "freeSnap", type: "toggle", label: "Snap free movement to half-steps" },
    ],
  },
  {
    title: "Sound",
    items: [
      { pref: "sound", type: "toggle", label: "Sound" },
      { pref: "volume", type: "range", label: "Volume", min: 0, max: 1, step: 0.05, fmt: pct },
      { pref: "bellSound", type: "toggle", label: "Bell sound" },
      { pref: "gestureSound", type: "toggle", label: "Platen click sounds", hint: "A soft detent click while scrolling the platen or carriage." },
    ],
  },
  {
    title: "Appearance & export",
    items: [
      { pref: "desk", type: "select", label: "Desk", options: [["auto", "Match system"], ["walnut", "Walnut"], ["slate", "Slate"], ["linen", "Linen"]] },
      { pref: "showGuide", type: "toggle", label: "Show platen & type point" },
      { pref: "showScale", type: "toggle", label: "Show carriage scale" },
      { pref: "autoHideToolbar", type: "toggle", label: "Fade toolbar while typing" },
      { pref: "exportDpi", type: "select", label: "PDF / PNG resolution", options: [[150, "150 dpi — small files"], [200, "200 dpi"], [300, "300 dpi — print quality"]] },
    ],
  },
];

/** The settings drawer: the document's own setup, then app-wide preferences. */
export class SettingsPanel {
  el: HTMLElement;
  private body: HTMLElement;

  constructor(private app: AppApi) {
    this.body = h("div", { class: "drawer-body" });
    this.el = h(
      "aside",
      { id: "settings", class: "drawer", "aria-label": "Settings", inert: true },
      h("div", { class: "drawer-head" }, h("h2", null, "Settings"), h("button", { class: "close", "aria-label": "Close settings", onclick: () => this.close() }, "×")),
      this.body,
    );
  }

  get isOpen() {
    return this.el.classList.contains("open");
  }

  open() {
    this.render();
    this.el.classList.add("open");
    this.el.inert = false;
  }

  close() {
    this.el.classList.remove("open");
    this.el.inert = true;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private row(label: string, control: HTMLElement, hint?: string) {
    // Only single controls get a <label>; a label around several buttons would click the first one.
    const tag = control.matches("input, select") ? "label" : "div";
    return h(tag, { class: "row" }, h("span", { class: "row-label" }, label), control, hint ? h("small", { class: "hint" }, hint) : null);
  }

  private prefControl(item: Item): HTMLElement {
    const { app } = this;
    const v = app.prefs[item.pref];
    switch (item.type) {
      case "toggle":
        return this.row(item.label, h("input", { type: "checkbox", class: "switch", checked: !!v, onchange: (e: Event) => app.setPref(item.pref, (e.target as HTMLInputElement).checked as never) }), item.hint);
      case "range": {
        const out = h("output", null, item.fmt ? item.fmt(v as number) : String(v));
        const input = h("input", {
          type: "range",
          min: item.min,
          max: item.max,
          step: item.step,
          value: String(v),
          oninput: (e: Event) => {
            const n = +(e.target as HTMLInputElement).value;
            out.textContent = item.fmt ? item.fmt(n) : String(n);
            app.setPref(item.pref, n as never);
          },
        });
        return this.row(item.label, h("span", { class: "range" }, input, out), item.hint);
      }
      case "select":
        return this.row(
          item.label,
          h(
            "select",
            {
              onchange: (e: Event) => {
                const raw = (e.target as HTMLSelectElement).value;
                app.setPref(item.pref, (typeof item.options[0][0] === "number" ? +raw : raw) as never);
              },
            },
            ...item.options.map(([val, text]) => h("option", { value: String(val), selected: String(val) === String(v) }, text)),
          ),
          item.hint,
        );
      case "color":
        return this.row(item.label, h("input", { type: "color", value: String(v), oninput: (e: Event) => app.setPref(item.pref, (e.target as HTMLInputElement).value as never) }));
    }
  }

  private documentSection(): HTMLElement {
    const { app } = this;
    const m = app.machine;
    const s = m.s;
    const cw = m.cw;
    const typed = m.doc.sheets.some((sh) => sh.strikes.length);
    const changed = (font = false) => {
      app.docSettingsChanged({ font });
      this.render();
    };

    const bands = h(
      "div",
      { class: "bands" },
      ...s.ribbon.bands.map((col, i) =>
        h(
          "span",
          { class: "band-edit" },
          h("input", {
            type: "color",
            value: col,
            title: `Band ${i + 1}`,
            onchange: (e: Event) => {
              s.ribbon.bands[i] = (e.target as HTMLInputElement).value;
              s.ribbon.name = "Custom";
              changed();
            },
          }),
          s.ribbon.bands.length > 1
            ? h("button", {
                class: "mini",
                title: "Remove band",
                onclick: (e: Event) => {
                  e.preventDefault();
                  s.ribbon.bands.splice(i, 1);
                  m.m.ribbonUse.splice(i, 1);
                  m.m.band = Math.min(m.m.band, s.ribbon.bands.length - 1);
                  changed();
                },
              }, "×")
            : null,
        ),
      ),
      s.ribbon.bands.length < 4
        ? h("button", {
            class: "mini",
            title: "Add band",
            onclick: (e: Event) => {
              e.preventDefault();
              s.ribbon.bands.push("#b3261e");
              m.m.ribbonUse.push(0);
              changed();
            },
          }, "+")
        : null,
    );

    const num = (value: number, min: number, max: number, set: (n: number) => void) =>
      h("input", { type: "number", min, max, step: 1, value: String(value), class: "num", onchange: (e: Event) => set(Math.max(min, Math.min(max, +(e.target as HTMLInputElement).value || 0))) });

    const totalCols = Math.floor(s.paper.w / cw);
    return h(
      "section",
      null,
      h("h3", null, "This document"),
      this.row(
        "Typeface",
        h("select", { onchange: (e: Event) => { s.font = (e.target as HTMLSelectElement).value; changed(true); } }, ...FONTS.map((f) => h("option", { value: f.id, selected: f.id === s.font }, f.name))),
        "One typeface per document, like the machine it was typed on.",
      ),
      this.row(
        "Pitch",
        h("select", { disabled: typed, onchange: (e: Event) => { s.pitch = +(e.target as HTMLSelectElement).value; changed(true); } }, ...PITCHES.map((p) => h("option", { value: String(p.cpi), selected: p.cpi === s.pitch }, p.name))),
        typed ? "Fixed once typing has started." : undefined,
      ),
      this.row(
        "Paper size",
        h(
          "select",
          {
            disabled: typed,
            onchange: (e: Event) => {
              const p = PAPERS.find((x) => x.name === (e.target as HTMLSelectElement).value);
              if (p) s.paper = { ...p };
              changed();
            },
          },
          ...PAPERS.map((p) => h("option", { value: p.name, selected: p.name === s.paper.name }, p.name)),
        ),
      ),
      this.row(
        "Paper colour",
        h(
          "span",
          { class: "swatches" },
          ...PAPER_COLORS.map((pc) => h("button", { class: `swatch${pc.color === s.paperColor ? " on" : ""}`, style: { background: pc.color }, title: pc.name, onclick: (e: Event) => { e.preventDefault(); s.paperColor = pc.color; changed(); } })),
          h("input", { type: "color", value: s.paperColor, title: "Custom", onchange: (e: Event) => { s.paperColor = (e.target as HTMLInputElement).value; changed(); } }),
        ),
      ),
      this.row(
        "Ribbon",
        h(
          "select",
          {
            onchange: (e: Event) => {
              const r = RIBBONS.find((x) => x.name === (e.target as HTMLSelectElement).value);
              if (!r) return;
              s.ribbon = { name: r.name, bands: [...r.bands] };
              m.m.ribbonUse = r.bands.map(() => 0);
              m.m.band = Math.min(Math.max(m.m.band, 0), r.bands.length - 1);
              changed();
            },
          },
          ...(RIBBONS.some((r) => r.name === s.ribbon.name) ? [] : [h("option", { selected: true }, s.ribbon.name)]),
          ...RIBBONS.map((r) => h("option", { value: r.name, selected: r.name === s.ribbon.name }, r.name)),
        ),
      ),
      this.row("Ribbon bands", bands, "Up to four bands. The ribbon lever (⌘1–⌘4) chooses which one strikes."),
      h(
        "div",
        { class: "grid2" },
        this.row("Left margin (col)", num(Math.round(s.margins.left / cw), 0, totalCols - 10, (n) => { s.margins.left = n * cw; changed(); })),
        this.row("Right margin (col)", num(Math.round((s.paper.w - s.margins.right) / cw), 10, totalCols, (n) => { s.margins.right = s.paper.w - n * cw; changed(); })),
        this.row("Top margin (lines)", num(Math.round(s.margins.top / LINE_HEIGHT), 0, 30, (n) => { s.margins.top = n * LINE_HEIGHT; changed(); })),
        this.row("Bottom margin (lines)", num(Math.round(s.margins.bottom / LINE_HEIGHT), 0, 30, (n) => { s.margins.bottom = n * LINE_HEIGHT; changed(); })),
        this.row("Tab every (cols)", num(s.tabEvery, 1, 40, (n) => { s.tabEvery = n; changed(); })),
        this.row("Bell before margin (cols)", num(s.bellCols, 0, 30, (n) => { s.bellCols = n; changed(); })),
      ),
    );
  }

  render() {
    this.body.replaceChildren(
      this.documentSection(),
      ...SECTIONS.map((sec) => h("section", null, h("h3", null, sec.title), ...sec.items.map((it) => this.prefControl(it)))),
      h("p", { class: "fineprint" }, "TypeWriterX is open source under the MIT licence. Bundled typefaces are licensed under the SIL Open Font License or the Apache License 2.0."),
    );
  }
}
