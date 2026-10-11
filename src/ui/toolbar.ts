import { SPACINGS } from "../core/catalog";
import type { AppApi } from "./api";
import { prettyAccel } from "./commands";
import { ICONS, h, icon } from "./dom";

const tip = (app: AppApi, label: string, id?: string) => {
  const accel = id ? prettyAccel(app.commands.get(id)?.accel) : "";
  return accel ? `${label}  (${accel})` : label;
};

const spacingLabel = (s: number) => (s % 1 ? `${Math.floor(s)}½` : String(s));

/** The machine's levers along the top, plus a status pill at the bottom. */
export class Toolbar {
  el: HTMLElement;
  status: HTMLElement;
  private refs: Record<string, HTMLElement> = {};
  private ribbonEl!: HTMLElement;
  private ribbonKey = "";
  private meterFill!: HTMLElement;
  private inkFill!: HTMLElement;
  private lastMeter = -1;

  constructor(private app: AppApi, isApp: boolean) {
    const run = (id: string) => () => app.commands.run(id);
    const btn = (key: string, id: string, label: string, ic: string, extra?: HTMLElement) => {
      const b = h("button", { class: "tb-btn", title: tip(app, label, id), "aria-label": label, onclick: run(id) }, icon(ic), extra);
      this.refs[key] = b;
      return b;
    };
    const lockBtn = (key: string, id: string, label: string, ic: string) => {
      const b = h("button", { class: "tb-btn lock", title: tip(app, label, id), "aria-label": label, onclick: run(id) }, icon(ic), h("span", { class: "lock-badge" }, icon(ICONS.lock)));
      this.refs[key] = b;
      return b;
    };

    this.ribbonEl = h("div", { class: "ribbon", role: "group", "aria-label": "Ribbon lever" });

    const spacing = h(
      "select",
      {
        class: "tb-select",
        title: "Line spacing lever",
        onchange: (e: Event) => {
          app.machine.setSpacing(+(e.target as HTMLSelectElement).value);
        },
      },
      ...SPACINGS.map((s) => h("option", { value: String(s) }, `${spacingLabel(s)} line`)),
    );
    this.refs.spacing = spacing;

    this.meterFill = h("div", { class: "meter-fill" });
    this.inkFill = h("div", { class: "ink-fill" });

    this.refs.title = h("div", { class: "doc-title", "data-tauri-drag-region": true });
    this.refs.sheet = h("span", { class: "tb-label" });
    this.refs.zoom = h("button", { class: "tb-label zoom-label", title: tip(app, "Actual size", "zoomReset"), onclick: run("zoomReset") });

    this.el = h(
      "header",
      { id: "toolbar", class: isApp ? "is-app" : "", "data-tauri-drag-region": true },
      h("div", { class: "tb-group", "data-tauri-drag-region": true }, this.refs.title),
      h(
        "div",
        { class: "tb-group" },
        btn("free", "toggleFree", "Line release: free platen & carriage", ICONS.lever),
        lockBtn("lockY", "lockPlaten", "Lock platen (vertical)", ICONS.vert),
        lockBtn("lockX", "lockCarriage", "Lock carriage (horizontal)", ICONS.horz),
        lockBtn("lockRot", "lockRotation", "Lock paper rotation", ICONS.rot),
      ),
      h("div", { class: "tb-group" }, spacing, btn("mr", "marginRelease", "Margin release", ICONS.margin)),
      h(
        "div",
        { class: "tb-group" },
        h("div", { class: "ribbon-wrap", title: "Ribbon lever — ink left on this band shown beneath" }, this.ribbonEl, h("div", { class: "ink-bar" }, this.inkFill)),
        h("div", { class: "meter", title: "Strike force — hold keys longer to strike darker" }, this.meterFill),
      ),
      h("div", { class: "tb-group" }, btn("tippex", "tippex", "Tipp-Ex brush — paint over letters", ICONS.bottle), btn("tape", "correction", "Correction tape for the next letter", ICONS.tape)),
      h("div", { class: "tb-spacer", "data-tauri-drag-region": true }),
      h(
        "div",
        { class: "tb-group" },
        btn("prev", "prevSheet", "Previous sheet", ICONS.left),
        this.refs.sheet,
        btn("next", "nextSheet", "Next sheet", ICONS.right),
        btn("add", "newSheet", "Feed a new sheet", ICONS.plus),
      ),
      h("div", { class: "tb-group" }, btn("zout", "zoomOut", "Zoom out", ICONS.minus), this.refs.zoom, btn("zin", "zoomIn", "Zoom in", ICONS.plus)),
      h("div", { class: "tb-group" }, btn("view", "toggleView", "Switch carriage / paper view", ICONS.view), btn("settings", "settings", "Settings", ICONS.gear), btn("help", "help", "Keys & gestures", ICONS.help)),
    );

    this.status = h("div", { id: "status" });
  }

  private buildRibbon() {
    const { app } = this;
    const bands = app.machine.s.ribbon.bands;
    const key = bands.join(",");
    if (key === this.ribbonKey) return;
    this.ribbonKey = key;
    this.ribbonEl.replaceChildren(
      ...bands.map((col, i) =>
        h("button", {
          class: "band",
          style: { background: col },
          title: tip(app, `Ribbon band ${i + 1}`, `band${i + 1}`),
          "aria-label": `Ribbon band ${i + 1}`,
          onclick: () => app.commands.run(`band${i + 1}`),
        }),
      ),
      h("button", { class: "band stencil", title: tip(app, "Stencil (no ink)", "stencil"), "aria-label": "Stencil", onclick: () => app.commands.run("stencil") }),
    );
  }

  update() {
    const { machine, renderer } = this.app;
    const s = machine.session;
    const r = this.refs;
    this.buildRibbon();
    r.title.textContent = `${this.app.dirty ? "• " : ""}${this.app.docName}`;
    r.free.classList.toggle("on", s.free);
    r.lockY.classList.toggle("on", s.lockY);
    r.lockX.classList.toggle("on", s.lockX);
    r.lockRot.classList.toggle("on", s.lockRot);
    r.mr.classList.toggle("on", s.marginRelease);
    r.tippex.classList.toggle("on", s.tippex);
    r.tape.classList.toggle("on", s.correction);
    (r.spacing as HTMLSelectElement).value = String(machine.m.spacing);
    [...this.ribbonEl.children].forEach((b, i) => {
      const band = i === this.ribbonEl.children.length - 1 ? -1 : i;
      b.classList.toggle("on", machine.m.band === band);
    });
    const n = machine.doc.sheets.length;
    r.sheet.textContent = `Sheet ${machine.m.sheet + 1} of ${n}`;
    r.prev.toggleAttribute("disabled", machine.m.sheet === 0);
    r.next.toggleAttribute("disabled", machine.m.sheet >= n - 1);
    r.zoom.textContent = `${Math.round(renderer.zoom * 100)}%`;
    this.inkFill.style.width = `${Math.round(machine.ribbonLeft * 100)}%`;

    const flags = [
      s.free && "Free",
      Math.abs(machine.m.a) > 1e-4 && `Skew ${((machine.m.a * 180) / Math.PI).toFixed(1)}°`,
      s.marginRelease && "Margin released",
      s.tippex && "Tipp-Ex — drag to paint, Esc to finish",
      s.correction && "Correction tape",
      machine.m.band < 0 && "Stencil",
    ].filter(Boolean);
    const col = machine.column, line = machine.line;
    const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1));
    this.status.textContent = [`Col ${fmt(col)}`, `Line ${fmt(line)}`, ...flags].join("  ·  ");
    this.updateMeter();
  }

  /** Strike meter: cheap enough to call every animation frame. */
  updateMeter() {
    const z = `${Math.round(this.app.renderer.zoom * 100)}%`;
    if (this.refs.zoom.textContent !== z) this.refs.zoom.textContent = z;
    const v = Math.round(this.app.machine.lastStrength * 100);
    if (v === this.lastMeter) return;
    this.lastMeter = v;
    this.meterFill.style.height = `${Math.max(6, v)}%`;
  }
}
