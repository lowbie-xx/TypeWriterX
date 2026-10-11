import type { Machine } from "../core/machine";
import type { Prefs } from "../core/prefs";

export interface KeyboardHost {
  machine: Machine;
  prefs: () => Prefs;
  /** Handles ⌘/Ctrl shortcuts; returns true if one matched. */
  shortcut(e: KeyboardEvent): boolean;
  /** True while a dialog or the settings drawer has focus. */
  blocked(): boolean;
  escape(): void;
  afterKey(): void;
}

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement && t.id !== "key-sink" && (t.matches("input, select, textarea, button") || t.isContentEditable);

/** A single printable character (including one outside the Basic Multilingual Plane). */
const isPrintable = (key: string) => [...key].length === 1 && key !== " ";

/**
 * Typing goes through a hidden textarea so dead keys and input methods can
 * still compose accented letters. Ordinary keys are taken at keydown, so the
 * keyup can tell us how long each key was held.
 */
export function installKeyboard(host: KeyboardHost, sink: HTMLTextAreaElement) {
  const { machine } = host;

  const focusSink = () => {
    // Never yank focus from a control the user is in (e.g. an open dropdown).
    if (host.blocked() || isField(document.activeElement)) return;
    if (document.activeElement !== sink) sink.focus({ preventScroll: true });
  };
  const inToolbar = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("#toolbar");

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.metaKey || e.ctrlKey) {
        if (host.shortcut(e)) e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        host.escape();
        e.preventDefault();
        return;
      }
      // A toolbar button or dropdown keeps focus after a click; typing goes back to the paper.
      if (inToolbar(e.target) && !(e.target instanceof HTMLSelectElement && e.key.startsWith("Arrow"))) {
        (e.target as HTMLElement).blur();
        sink.focus({ preventScroll: true });
      } else if (host.blocked() || isField(e.target)) return;
      if (e.key === "Dead") return; // let the sink compose it

      const pr = host.prefs();
      const nav = e.key.startsWith("Arrow");
      if (e.repeat && !pr.keyRepeat && !nav) {
        e.preventDefault();
        return;
      }
      const now = performance.now();
      switch (e.key) {
        case "Backspace":
          machine.backspace();
          break;
        case "Enter":
          machine.carriageReturn(!e.shiftKey);
          break;
        case "Tab":
          machine.tab();
          break;
        case " ":
          machine.space();
          break;
        case "ArrowLeft":
        case "ArrowRight":
          if (!pr.arrowKeys) return;
          if (e.altKey) machine.halfSpace(e.key === "ArrowLeft" ? -1 : 1);
          else machine.stepCarriage(e.key === "ArrowLeft" ? -1 : 1);
          break;
        case "ArrowUp":
        case "ArrowDown":
          if (!pr.arrowKeys) return;
          machine.feedLines((e.key === "ArrowUp" ? -1 : 1) * (e.altKey ? 0.5 : machine.m.spacing));
          break;
        default:
          if (!isPrintable(e.key)) return;
          machine.press(e.key, e.code, now);
      }
      e.preventDefault();
      host.afterKey();
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      machine.release(e.code, performance.now());
    },
    true,
  );

  // Composed characters (é, ñ, emoji picker…) strike at a normal weight. Engines
  // disagree on whether compositionend or input comes first, so de-duplicate.
  let recent = { data: "", t: 0 };
  const strikeText = (data: string) => {
    const now = performance.now();
    if (data === recent.data && now - recent.t < 80) return;
    recent = { data, t: now };
    for (const ch of data) if (ch.trim()) machine.press(ch, null, now);
    host.afterKey();
  };
  sink.addEventListener("compositionend", (e) => {
    if (e.data) strikeText(e.data);
    sink.value = "";
  });
  sink.addEventListener("input", (e) => {
    const ie = e as InputEvent;
    if (ie.isComposing) return;
    if (ie.data) strikeText(ie.data);
    sink.value = "";
  });

  window.addEventListener("blur", () => machine.releaseAll(performance.now()));
  sink.addEventListener("blur", () => setTimeout(focusSink, 0));
  // Once a control is finished with, hand the keyboard back to the paper.
  document.addEventListener("change", (e) => {
    if (inToolbar(e.target)) setTimeout(() => (e.target as HTMLElement).blur(), 0);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target !== sink) setTimeout(focusSink, 0);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!isField(e.target)) setTimeout(focusSink, 0);
  });
  focusSink();
  return focusSink;
}
