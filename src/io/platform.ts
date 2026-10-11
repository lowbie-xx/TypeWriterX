/**
 * Thin platform layer: the desktop app (Tauri) or a plain browser (the web
 * port). Everything else in the app is platform-agnostic.
 */

export interface DocHandle {
  name: string;
  path: string | null;
  /** Browser File System Access handle, when available. */
  handle?: FileSystemFileHandleLike | null;
}

export interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>;
}

export interface Platform {
  isApp: boolean;
  openDocument(): Promise<{ doc: DocHandle; text: string } | null>;
  readPath(path: string): Promise<{ doc: DocHandle; text: string }>;
  saveDocument(text: string, current: DocHandle | null): Promise<DocHandle | null>;
  /** Asks where to save. Returns the chosen name, or null if cancelled. */
  exportFiles(files: { suffix: string; data: Uint8Array | string }[], suggested: string, ext: string, label: string): Promise<string | null>;
  ask(message: string, okLabel?: string): Promise<boolean>;
  alert(message: string): Promise<void>;
  setTitle(title: string): void;
  /** Guard closing the window while there are unsaved changes. */
  onCloseRequested(isDirty: () => boolean, confirm: () => Promise<boolean>): void;
  onOpenFiles(cb: (paths: string[]) => void): void;
}

const EXT = "twx";
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stripExt = (n: string) => n.replace(/\.[^.]+$/, "");

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(s);
}

// ── Desktop (Tauri) ─────────────────────────────────────────────────────────

async function tauriPlatform(): Promise<Platform> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { listen } = await import("@tauri-apps/api/event");
  const win = getCurrentWindow();
  const filters = [{ name: "TypeWriterX Document", extensions: [EXT] }];

  const readPath = async (path: string) => {
    const text = await invoke<string>("read_text_file", { path });
    return { doc: { name: stripExt(baseName(path)), path }, text };
  };

  return {
    isApp: true,
    async openDocument() {
      const path = await dialog.open({ multiple: false, directory: false, filters });
      if (!path || Array.isArray(path)) return null;
      return readPath(path);
    },
    readPath,
    async saveDocument(text, current) {
      let path = current?.path ?? null;
      if (!path) {
        path = await dialog.save({ filters, defaultPath: `${current?.name ?? "Untitled"}.${EXT}` });
        if (!path) return null;
        if (!path.toLowerCase().endsWith(`.${EXT}`)) path += `.${EXT}`;
      }
      await invoke("write_text_file", { path, contents: text });
      return { name: stripExt(baseName(path)), path };
    },
    async exportFiles(files, suggested, ext, label) {
      let path = await dialog.save({ filters: [{ name: label, extensions: [ext] }], defaultPath: `${suggested}.${ext}` });
      if (!path) return null;
      if (!path.toLowerCase().endsWith(`.${ext}`)) path += `.${ext}`;
      const stem = path.slice(0, -(ext.length + 1));
      for (const f of files) {
        const target = `${stem}${f.suffix}.${ext}`;
        if (typeof f.data === "string") await invoke("write_text_file", { path: target, contents: f.data });
        else await invoke("write_binary_file", { path: target, base64: toBase64(f.data) });
      }
      return baseName(path);
    },
    ask: (message, okLabel = "OK") => dialog.ask(message, { title: "TypeWriterX", kind: "warning", okLabel, cancelLabel: "Cancel" }),
    alert: async (message) => {
      await dialog.message(message, { title: "TypeWriterX" });
    },
    setTitle: (t) => void win.setTitle(t).catch(() => {}),
    onCloseRequested(isDirty, confirm) {
      void win.onCloseRequested(async (e) => {
        if (isDirty() && !(await confirm())) e.preventDefault();
      });
    },
    onOpenFiles(cb) {
      void listen<string[]>("open-files", (e) => cb(e.payload));
      void invoke<string[]>("take_pending_open").then((p) => p.length && cb(p));
    },
  };
}

// ── Browser (web port) ──────────────────────────────────────────────────────

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandleLike>;
};

function download(name: string, data: Uint8Array | string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function webPlatform(): Platform {
  const w = window as PickerWindow;
  return {
    isApp: false,
    openDocument() {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = `.${EXT},application/json`;
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          resolve({ doc: { name: stripExt(f.name), path: null }, text: await f.text() });
        };
        input.click();
      });
    },
    readPath: () => Promise.reject(new Error("Paths aren't available in the browser.")),
    async saveDocument(text, current) {
      let handle = current?.handle ?? null;
      if (!handle && w.showSaveFilePicker) {
        try {
          handle = await w.showSaveFilePicker({
            suggestedName: `${current?.name ?? "Untitled"}.${EXT}`,
            types: [{ description: "TypeWriterX Document", accept: { "application/json": [`.${EXT}`] } }],
          });
        } catch {
          return null;
        }
      }
      if (handle) {
        const ws = await handle.createWritable();
        await ws.write(text);
        await ws.close();
        return { name: stripExt(handle.name), path: null, handle };
      }
      const name = current?.name ?? "Untitled";
      download(`${name}.${EXT}`, text, "application/json");
      return { name, path: null };
    },
    async exportFiles(files, suggested, ext) {
      const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "text/plain";
      for (const f of files) download(`${suggested}${f.suffix}.${ext}`, f.data, mime);
      return `${suggested}.${ext}`;
    },
    ask: async (message) => window.confirm(message),
    alert: async (message) => window.alert(message),
    setTitle: (t) => (document.title = t),
    onCloseRequested(isDirty) {
      window.addEventListener("beforeunload", (e) => {
        if (isDirty()) e.preventDefault();
      });
    },
    onOpenFiles() {},
  };
}

export async function getPlatform(): Promise<Platform> {
  if ("__TAURI_INTERNALS__" in window) return tauriPlatform();
  return webPlatform();
}
