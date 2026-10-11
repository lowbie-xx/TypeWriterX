export interface Command {
  id: string;
  label: string;
  menu: "File" | "Edit" | "Machine" | "Paper" | "View" | "App";
  /** Tauri-style accelerator, e.g. "CmdOrCtrl+Shift+S". */
  accel?: string;
  run: () => void;
  /** Visual divider before this item in its menu. */
  sep?: boolean;
}

const KEY_CODES: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "=": "Equal",
  "-": "Minus",
  "/": "Slash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "\\": "Backslash",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
};

function codeFor(key: string) {
  if (KEY_CODES[key]) return KEY_CODES[key];
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return key;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function matches(accel: string, e: KeyboardEvent) {
  const parts = accel.split("+");
  const key = parts.pop()!;
  const want = { cmd: false, shift: false, alt: false };
  for (const p of parts) {
    if (p === "CmdOrCtrl") want.cmd = true;
    else if (p === "Shift") want.shift = true;
    else if (p === "Alt") want.alt = true;
  }
  const cmd = isMac ? e.metaKey : e.ctrlKey;
  return cmd === want.cmd && e.shiftKey === want.shift && e.altKey === want.alt && e.code === codeFor(key);
}

/** Pretty-prints an accelerator for tooltips and the help sheet. */
export function prettyAccel(accel?: string) {
  if (!accel) return "";
  const sym: Record<string, string> = isMac
    ? { CmdOrCtrl: "⌘", Shift: "⇧", Alt: "⌥", Up: "↑", Down: "↓", Left: "←", Right: "→" }
    : { CmdOrCtrl: "Ctrl+", Shift: "Shift+", Alt: "Alt+", Up: "↑", Down: "↓", Left: "←", Right: "→" };
  const parts = accel.split("+");
  const key = parts.pop()!;
  const order = ["Alt", "Shift", "CmdOrCtrl"];
  parts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return parts.map((p) => sym[p] ?? p).join("") + (sym[key] ?? key.toUpperCase());
}

export class Commands {
  list: Command[] = [];
  private lastRun = new Map<string, number>();

  add(...cmds: Command[]) {
    this.list.push(...cmds);
  }

  get(id: string) {
    return this.list.find((c) => c.id === id);
  }

  /** Runs a command. The native menu and the web view can both see one keystroke, so repeats within 120ms are dropped. */
  run(id: string) {
    const now = performance.now();
    if (now - (this.lastRun.get(id) ?? 0) < 120) return;
    this.lastRun.set(id, now);
    this.get(id)?.run();
  }

  handleKey(e: KeyboardEvent): boolean {
    const c = this.list.find((c) => c.accel && matches(c.accel, e));
    if (!c) return false;
    this.run(c.id);
    return true;
  }

  /** Builds the native macOS / Windows menu bar (desktop app only). */
  async installNativeMenu() {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
    const item = async (c: Command) => {
      const opts = { id: c.id, text: c.label, action: () => this.run(c.id) };
      try {
        return await MenuItem.new({ ...opts, accelerator: c.accel });
      } catch {
        return await MenuItem.new(opts);
      }
    };
    const section = async (menu: Command["menu"]) => {
      const items = [];
      for (const c of this.list.filter((c) => c.menu === menu)) {
        if (c.sep) items.push(await PredefinedMenuItem.new({ item: "Separator" }));
        items.push(await item(c));
      }
      return items;
    };
    const sep = () => PredefinedMenuItem.new({ item: "Separator" });

    const appMenu = await Submenu.new({
      text: "TypeWriterX",
      items: [
        await PredefinedMenuItem.new({ item: { About: { name: "TypeWriterX", version: "0.1.0", copyright: "MIT License" } } }),
        await sep(),
        ...(await section("App")),
        await sep(),
        await PredefinedMenuItem.new({ item: "Services" }),
        await sep(),
        await PredefinedMenuItem.new({ item: "Hide" }),
        await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }),
        await sep(),
        await PredefinedMenuItem.new({ item: "Quit" }),
      ],
    });
    const edit = await Submenu.new({
      text: "Edit",
      items: [
        ...(await section("Edit")),
        await sep(),
        await PredefinedMenuItem.new({ item: "Cut" }),
        await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }),
        await PredefinedMenuItem.new({ item: "SelectAll" }),
      ],
    });
    const windowMenu = await Submenu.new({
      text: "Window",
      items: [
        await PredefinedMenuItem.new({ item: "Minimize" }),
        await PredefinedMenuItem.new({ item: "Maximize" }),
        await PredefinedMenuItem.new({ item: "Fullscreen" }),
        await sep(),
        await PredefinedMenuItem.new({ item: "CloseWindow" }),
      ],
    });
    const menu = await Menu.new({
      items: [
        appMenu,
        await Submenu.new({ text: "File", items: await section("File") }),
        edit,
        await Submenu.new({ text: "Machine", items: await section("Machine") }),
        await Submenu.new({ text: "Paper", items: await section("Paper") }),
        await Submenu.new({ text: "View", items: await section("View") }),
        windowMenu,
      ],
    });
    await menu.setAsAppMenu();
  }
}
