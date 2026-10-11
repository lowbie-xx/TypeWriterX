import "./style.css";
import { Sound } from "./audio/sound";
import { FONTS } from "./core/catalog";
import { createDocument, deserialize, serialize, type NewDocOptions } from "./core/document";
import { Machine } from "./core/machine";
import { loadPrefs, savePrefs, type Prefs } from "./core/prefs";
import type { TwxDocument } from "./core/types";
import { installKeyboard } from "./input/keyboard";
import { installPointer } from "./input/pointer";
import { toPdf, toPlainText, toPngs } from "./io/export";
import { getPlatform, type DocHandle, type Platform } from "./io/platform";
import { cssFont, fontSizeForPitch, loadFont } from "./render/fonts";
import { DESKS, Renderer } from "./render/renderer";
import type { AppApi } from "./ui/api";
import { Commands } from "./ui/commands";
import { closeModal, helpDialog, modalOpen, newDocumentDialog } from "./ui/dialogs";
import { h } from "./ui/dom";
import { SettingsPanel } from "./ui/settings";
import { Toolbar } from "./ui/toolbar";
import { installTooltips } from "./ui/tooltip";

const AUTOSAVE_KEY = "typewriterx.autosave";

class App implements AppApi {
  prefs: Prefs = loadPrefs();
  machine: Machine;
  renderer: Renderer;
  commands = new Commands();
  sound = new Sound(() => this.prefs);
  toolbar: Toolbar;
  settings: SettingsPanel;
  docHandle: DocHandle = { name: "Untitled", path: null };
  dirty = false;
  private autosaveDirty = false;
  private updateCursor: () => void = () => {};
  private toastEl = h("div", { id: "toast", role: "status", "aria-live": "polite" });
  private toastTimer = 0;
  private typingTimer = 0;
  private uiQueued = false;

  constructor(private platform: Platform, doc: TwxDocument) {
    const getPrefs = () => this.prefs;
    this.machine = new Machine(doc, getPrefs);

    const canvas = h("canvas", { id: "stage", "aria-label": "Typewriter page" });
    const sink = h("textarea", { id: "key-sink", "aria-label": "Typewriter keyboard input", autocapitalize: "off", autocomplete: "off", spellcheck: false });
    this.renderer = new Renderer(canvas, this.machine, getPrefs);
    this.registerCommands();
    this.toolbar = new Toolbar(this, platform.isApp);
    this.settings = new SettingsPanel(this);
    document.getElementById("app")!.append(canvas, this.toolbar.el, this.toolbar.status, this.settings.el, this.toastEl, sink, h("div", { id: "modal-root" }));

    installTooltips(() => this.prefs.tooltips);
    this.machine.onSound = (e, a) => this.sound.play(e, a);
    this.machine.onChange = (content) => {
      if (content) this.markDirty();
      this.renderer.request();
      this.queueUi();
    };
    this.renderer.onFrame = () => this.toolbar.updateMeter();

    installKeyboard(
      {
        machine: this.machine,
        prefs: getPrefs,
        shortcut: (e) => this.commands.handleKey(e),
        blocked: () => modalOpen() || this.settings.el.contains(document.activeElement),
        escape: () => this.escape(),
        afterKey: () => this.afterKey(),
      },
      sink,
    );
    this.updateCursor = installPointer(canvas, this.machine, this.renderer, getPrefs, (msg) => this.toast(msg));
    window.addEventListener("pointermove", () => document.body.classList.remove("typing"));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyDesk());

    platform.onCloseRequested(
      () => this.dirty,
      () => platform.ask("You have unsaved changes. Close anyway?", "Close"),
    );
    platform.onOpenFiles((paths) => paths[0] && void this.openPath(paths[0]));
    if (platform.isApp) void this.commands.installNativeMenu().catch((e) => console.warn("menu", e));
    setInterval(() => this.autosave(), 10000);
    window.addEventListener("pagehide", () => this.autosave());

    this.applyDesk();
    void this.applyFont();
    this.renderer.snapCamera();
    this.refreshUi();
  }

  // ── AppApi ────────────────────────────────────────────────────────────────

  get docName() {
    return this.docHandle.name;
  }

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    this.prefs[key] = value;
    savePrefs(this.prefs);
    if (key === "desk") this.applyDesk();
    if (key === "viewMode") {
      this.renderer.resetZoom();
      this.renderer.snapCamera();
    }
    if (key === "inkTexture" || key === "unevenStrike") this.renderer.invalidate();
    this.renderer.request();
    this.refreshUi();
  }

  docSettingsChanged(opts: { font?: boolean } = {}) {
    this.markDirty();
    if (opts.font) void this.applyFont();
    this.renderer.invalidate();
    this.refreshUi();
  }

  toast(message: string) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2200);
  }

  // ── state ─────────────────────────────────────────────────────────────────

  private markDirty() {
    this.autosaveDirty = true;
    if (!this.dirty) {
      this.dirty = true;
      this.refreshTitle();
    }
  }

  private queueUi() {
    if (this.uiQueued) return;
    this.uiQueued = true;
    requestAnimationFrame(() => {
      this.uiQueued = false;
      this.refreshUi();
    });
  }

  private refreshUi() {
    this.toolbar.update();
    this.updateCursor();
    this.refreshTitle();
  }

  private refreshTitle() {
    this.platform.setTitle(`${this.dirty ? "• " : ""}${this.docHandle.name} — TypeWriterX`);
  }

  private applyDesk() {
    let d = this.prefs.desk;
    if (d === "auto") d = window.matchMedia("(prefers-color-scheme: dark)").matches ? "walnut" : "linen";
    document.body.dataset.desk = d;
    this.renderer.theme = DESKS[d];
    this.renderer.request();
  }

  private async applyFont() {
    const s = this.machine.s;
    const family = await loadFont(s.font);
    const cw = 72 / s.pitch;
    const fontSize = fontSizeForPitch(family, cw);
    this.renderer.style = { ...this.renderer.style, cw, fontSize, font: cssFont(fontSize, family) };
    this.renderer.invalidate();
  }

  private afterKey() {
    this.renderer.recenter();
    if (this.machine.session.tippex && !this.prefs.tippexStaysOn) this.machine.toggleTippex(false);
    if (this.prefs.autoHideToolbar) {
      document.body.classList.add("typing");
      clearTimeout(this.typingTimer);
    }
  }

  private escape() {
    if (modalOpen()) return closeModal();
    if (this.settings.isOpen) return this.settings.close();
    if (this.machine.session.tippex) return this.machine.toggleTippex(false);
    if (document.body.classList.contains("focus")) return this.commands.run("focus");
  }

  private loadDoc(doc: TwxDocument, handle: DocHandle, dirty = false) {
    this.machine.load(doc);
    this.docHandle = handle;
    this.dirty = dirty;
    this.autosaveDirty = true;
    this.renderer.resetZoom();
    this.renderer.snapCamera();
    void this.applyFont();
    if (this.settings.isOpen) this.settings.render();
    this.refreshUi();
  }

  private autosave() {
    if (!this.autosaveDirty) return;
    this.autosaveDirty = false;
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({ name: this.docHandle.name, path: this.docHandle.path, dirty: this.dirty, data: serialize(this.machine.doc) }),
      );
    } catch {
      /* storage full or unavailable: the document itself is unaffected */
    }
  }

  // ── file operations ───────────────────────────────────────────────────────

  private async confirmDiscard() {
    return !this.dirty || this.platform.ask("Discard unsaved changes to this document?", "Discard");
  }

  async newDocument(force = false) {
    if (!force && !(await this.confirmDiscard())) return;
    const opts = await newDocumentDialog(this.prefs);
    if (!opts) return;
    this.rememberDefaults(opts);
    this.loadDoc(createDocument(opts), { name: "Untitled", path: null });
  }

  private rememberDefaults(o: NewDocOptions) {
    Object.assign(this.prefs, {
      defaultFont: o.font,
      defaultPitch: o.pitch,
      defaultPaper: o.paperName,
      defaultPaperColor: o.paperColor,
      defaultRibbon: o.ribbonName,
    });
    savePrefs(this.prefs);
  }

  async open() {
    if (!(await this.confirmDiscard())) return;
    try {
      const r = await this.platform.openDocument();
      if (r) this.loadDoc(deserialize(r.text), r.doc);
    } catch (e) {
      await this.platform.alert(`Couldn't open that file.\n\n${(e as Error).message ?? e}`);
    }
  }

  async openPath(path: string) {
    if (!(await this.confirmDiscard())) return;
    try {
      const r = await this.platform.readPath(path);
      this.loadDoc(deserialize(r.text), r.doc);
    } catch (e) {
      await this.platform.alert(`Couldn't open that file.\n\n${(e as Error).message ?? e}`);
    }
  }

  async save(as = false) {
    try {
      const target = as ? { name: this.docHandle.name, path: null } : this.docHandle;
      const saved = await this.platform.saveDocument(serialize(this.machine.doc), target);
      if (!saved) return;
      this.docHandle = saved;
      this.dirty = false;
      this.autosaveDirty = true;
      this.refreshUi();
      this.toast(`Saved “${saved.name}”`);
    } catch (e) {
      await this.platform.alert(`Couldn't save.\n\n${(e as Error).message ?? e}`);
    }
  }

  async export(kind: "pdf" | "png" | "txt") {
    const doc = this.machine.doc;
    const style = this.renderer.style;
    const dpi = this.prefs.exportDpi;
    try {
      this.toast(kind === "txt" ? "Exporting text…" : "Rendering pages…");
      await new Promise((r) => setTimeout(r, 30));
      let files: { suffix: string; data: Uint8Array | string }[];
      if (kind === "pdf") files = [{ suffix: "", data: await toPdf(doc, dpi, style, this.prefs) }];
      else if (kind === "png") files = await toPngs(doc, dpi, style, this.prefs);
      else files = [{ suffix: "", data: toPlainText(doc, style.fontSize) }];
      const label = kind === "pdf" ? "PDF Document" : kind === "png" ? "PNG Image" : "Plain Text";
      const name = await this.platform.exportFiles(files, this.docHandle.name, kind, label);
      if (name) this.toast(files.length > 1 ? `Exported ${files.length} pages` : `Exported “${name}”`);
    } catch (e) {
      await this.platform.alert(`Export failed.\n\n${(e as Error).message ?? e}`);
    }
  }

  private rotateBy(degrees: number) {
    if (!this.machine.rotatePaper((degrees * Math.PI) / 180)) this.toast("Paper rotation is locked — unlock it with ⌥⌘R");
  }

  // ── commands ──────────────────────────────────────────────────────────────

  private registerCommands() {
    const m = () => this.machine;
    const r = () => this.renderer;
    const sess = () => this.machine.session;
    const flip = (label: string, get: () => boolean, set: (v: boolean) => void) => () => {
      set(!get());
      this.machine.onSound("release");
      this.toast(`${label} ${get() ? "on" : "off"}`);
      this.refreshUi();
    };

    this.commands.add(
      { id: "settings", label: "Settings…", menu: "App", accel: "CmdOrCtrl+,", run: () => this.settings.toggle() },

      { id: "new", label: "New Document…", menu: "File", accel: "CmdOrCtrl+N", run: () => void this.newDocument() },
      { id: "open", label: "Open…", menu: "File", accel: "CmdOrCtrl+O", run: () => void this.open() },
      { id: "save", label: "Save", menu: "File", accel: "CmdOrCtrl+S", run: () => void this.save(), sep: true },
      { id: "saveAs", label: "Save As…", menu: "File", accel: "CmdOrCtrl+Shift+S", run: () => void this.save(true) },
      { id: "exportPdf", label: "Export PDF…", menu: "File", accel: "CmdOrCtrl+E", run: () => void this.export("pdf"), sep: true },
      { id: "exportPng", label: "Export PNG…", menu: "File", accel: "CmdOrCtrl+Shift+E", run: () => void this.export("png") },
      { id: "exportTxt", label: "Export Plain Text…", menu: "File", accel: "CmdOrCtrl+Alt+E", run: () => void this.export("txt") },

      { id: "undo", label: "Undo Strike", menu: "Edit", accel: "CmdOrCtrl+Z", run: () => (this.prefs.purist ? this.toast("Purist mode: no undo") : m().undo()) },
      { id: "redo", label: "Redo Strike", menu: "Edit", accel: "CmdOrCtrl+Shift+Z", run: () => m().redo() },

      { id: "toggleFree", label: "Line Release (Free Movement)", menu: "Machine", accel: "CmdOrCtrl+L", run: () => { m().toggleFree(); this.toast(sess().free ? "Line release: free movement" : "Ratchet engaged"); } },
      { id: "lockPlaten", label: "Lock Platen (Vertical)", menu: "Machine", accel: "CmdOrCtrl+Alt+P", run: flip("Platen lock", () => sess().lockY, (v) => (sess().lockY = v)) },
      { id: "lockCarriage", label: "Lock Carriage (Horizontal)", menu: "Machine", accel: "CmdOrCtrl+Alt+C", run: flip("Carriage lock", () => sess().lockX, (v) => (sess().lockX = v)) },
      { id: "lockRotation", label: "Lock Paper Rotation", menu: "Machine", accel: "CmdOrCtrl+Alt+R", run: flip("Rotation lock", () => sess().lockRot, (v) => (sess().lockRot = v)) },
      { id: "rotateLeft", label: "Rotate Paper Anticlockwise", menu: "Machine", accel: "CmdOrCtrl+Alt+Left", run: () => this.rotateBy(-0.5) },
      { id: "rotateRight", label: "Rotate Paper Clockwise", menu: "Machine", accel: "CmdOrCtrl+Alt+Right", run: () => this.rotateBy(0.5) },
      { id: "straighten", label: "Straighten Paper", menu: "Machine", accel: "CmdOrCtrl+Alt+A", run: () => m().straighten() },
      { id: "marginRelease", label: "Margin Release", menu: "Machine", accel: "CmdOrCtrl+Shift+M", run: () => m().toggleMarginRelease(), sep: true },
      { id: "halfUp", label: "Half Line Up", menu: "Machine", accel: "CmdOrCtrl+Up", run: () => m().feedLines(-0.5) },
      { id: "halfDown", label: "Half Line Down", menu: "Machine", accel: "CmdOrCtrl+Down", run: () => m().feedLines(0.5) },
      { id: "halfBack", label: "Half Space Back", menu: "Machine", accel: "CmdOrCtrl+Left", run: () => m().halfSpace(-1) },
      { id: "halfFwd", label: "Half Space Forward", menu: "Machine", accel: "CmdOrCtrl+Right", run: () => m().halfSpace(1) },
      { id: "tippex", label: "Tipp-Ex Brush", menu: "Machine", accel: "CmdOrCtrl+K", run: () => m().toggleTippex(), sep: true },
      { id: "correction", label: "Correction Tape (Next Letter)", menu: "Machine", accel: "CmdOrCtrl+Shift+K", run: () => m().toggleCorrection() },
      ...[1, 2, 3, 4].map((i) => ({
        id: `band${i}`,
        label: `Ribbon Band ${i}`,
        menu: "Machine" as const,
        accel: `CmdOrCtrl+${i}`,
        sep: i === 1,
        run: () => (i <= this.machine.s.ribbon.bands.length ? m().setBand(i - 1) : this.toast(`This ribbon has ${this.machine.s.ribbon.bands.length} band(s)`)),
      })),
      { id: "stencil", label: "Stencil (No Ink)", menu: "Machine", accel: "CmdOrCtrl+5", run: () => m().setBand(-1) },
      { id: "changeRibbon", label: "Change Ribbon", menu: "Machine", run: () => { m().changeRibbon(); this.toast("Fresh ribbon fitted"); } },

      { id: "newSheet", label: "Feed New Sheet", menu: "Paper", accel: "CmdOrCtrl+Shift+N", run: () => { m().insertSheet(); r().snapCamera(); } },
      { id: "prevSheet", label: "Previous Sheet", menu: "Paper", accel: "CmdOrCtrl+[", run: () => { m().gotoSheet(m().m.sheet - 1); r().snapCamera(); } },
      { id: "nextSheet", label: "Next Sheet", menu: "Paper", accel: "CmdOrCtrl+]", run: () => { m().gotoSheet(m().m.sheet + 1); r().snapCamera(); } },
      {
        id: "deleteSheet",
        label: "Remove This Sheet…",
        menu: "Paper",
        sep: true,
        run: async () => {
          if (await this.platform.ask("Remove this sheet and everything typed on it? This can't be undone.", "Remove")) {
            m().deleteSheet();
            r().snapCamera();
          }
        },
      },

      { id: "zoomIn", label: "Zoom In", menu: "View", accel: "CmdOrCtrl+=", run: () => r().setZoom(r().zoom * 1.15) },
      { id: "zoomOut", label: "Zoom Out", menu: "View", accel: "CmdOrCtrl+-", run: () => r().setZoom(r().zoom / 1.15) },
      { id: "zoomReset", label: "Fit to Window", menu: "View", accel: "CmdOrCtrl+0", run: () => r().resetZoom() },
      { id: "toggleView", label: "Carriage / Paper View", menu: "View", accel: "CmdOrCtrl+Shift+P", run: () => this.setPref("viewMode", this.prefs.viewMode === "carriage" ? "paper" : "carriage"), sep: true },
      { id: "focus", label: "Focus Mode", menu: "View", accel: "CmdOrCtrl+Shift+F", run: () => { document.body.classList.toggle("focus"); this.renderer.resize(); } },
      { id: "help", label: "Keys & Gestures", menu: "View", accel: "CmdOrCtrl+/", run: () => helpDialog(this.commands), sep: true },
    );
  }
}

async function boot() {
  // Preview faces for the New Document dialog (fetched only when shown).
  const style = document.createElement("style");
  style.textContent = FONTS.map((f) => `@font-face{font-family:"Preview ${f.name}";src:url(fonts/${f.file});font-display:swap}`).join("");
  document.head.append(style);

  const platform = await getPlatform();
  const prefs = loadPrefs();
  let doc: TwxDocument | null = null;
  let handle: DocHandle = { name: "Untitled", path: null };
  let dirty = false;
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null");
    if (saved?.data) {
      doc = deserialize(saved.data);
      handle = { name: saved.name ?? "Untitled", path: saved.path ?? null };
      dirty = !!saved.dirty;
    }
  } catch {
    doc = null;
  }
  const first = !doc;
  const app = new App(
    platform,
    doc ??
      createDocument({
        font: prefs.defaultFont,
        pitch: prefs.defaultPitch,
        paperName: prefs.defaultPaper,
        paperColor: prefs.defaultPaperColor,
        ribbonName: prefs.defaultRibbon,
      }),
  );
  if (import.meta.env.DEV) (window as unknown as { twx: App }).twx = app;
  app.docHandle = handle;
  app.dirty = dirty;
  if (first) void app.newDocument(true);
}

void boot();
