import { FONTS, PAPERS, PAPER_COLORS, PITCHES, RIBBONS } from "../core/catalog";
import type { NewDocOptions } from "../core/document";
import type { Prefs } from "../core/prefs";
import { prettyAccel, type Commands } from "./commands";
import { h } from "./dom";

let openModal: { close: () => void } | null = null;

export const modalOpen = () => openModal !== null;
export const closeModal = () => openModal?.close();

function modal(title: string, body: HTMLElement, actions: HTMLElement[], onClose: () => void, wide = false) {
  const root = document.getElementById("modal-root")!;
  const close = () => {
    root.replaceChildren();
    root.classList.remove("open");
    openModal = null;
    onClose();
  };
  const card = h(
    "div",
    { class: `modal${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal-head" }, h("h2", null, title), h("button", { class: "close", "aria-label": "Close", onclick: close }, "×")),
    body,
    actions.length ? h("div", { class: "modal-actions" }, ...actions) : null,
  );
  root.replaceChildren(h("div", { class: "scrim", onclick: close }), card);
  root.classList.add("open");
  openModal = { close };
  (card.querySelector("button.primary, select, button") as HTMLElement | null)?.focus();
  return close;
}

/** New document: one typeface, pitch, paper and ribbon per document. */
export function newDocumentDialog(prefs: Prefs): Promise<NewDocOptions | null> {
  return new Promise((resolve) => {
    let result: NewDocOptions | null = null;
    const choice: Required<NewDocOptions> = {
      font: prefs.defaultFont,
      pitch: prefs.defaultPitch,
      paperName: prefs.defaultPaper,
      paperColor: prefs.defaultPaperColor,
      ribbonName: prefs.defaultRibbon,
    };

    const fonts = h(
      "div",
      { class: "font-grid", role: "radiogroup", "aria-label": "Typeface" },
      ...FONTS.map((f) =>
        h(
          "button",
          {
            class: `font-card${f.id === choice.font ? " on" : ""}`,
            role: "radio",
            "aria-checked": String(f.id === choice.font),
            onclick: (e: Event) => {
              choice.font = f.id;
              fonts.querySelectorAll(".font-card").forEach((c) => {
                c.classList.toggle("on", c === e.currentTarget);
                c.setAttribute("aria-checked", String(c === e.currentTarget));
              });
            },
          },
          h("span", { class: "font-sample", style: { fontFamily: `"Preview ${f.name}", monospace` } }, "The quick brown fox"),
          h("span", { class: "font-name" }, f.name),
          h("small", null, f.note),
        ),
      ),
    );

    const select = <T extends string | number>(label: string, value: T, options: [T, string][], set: (v: T) => void) =>
      h(
        "label",
        { class: "row" },
        h("span", { class: "row-label" }, label),
        h(
          "select",
          { onchange: (e: Event) => set((typeof value === "number" ? +(e.target as HTMLSelectElement).value : (e.target as HTMLSelectElement).value) as T) },
          ...options.map(([v, t]) => h("option", { value: String(v), selected: v === value }, t)),
        ),
      );

    const swatches = h(
      "span",
      { class: "swatches" },
      ...PAPER_COLORS.map((pc) =>
        h("button", {
          class: `swatch${pc.color === choice.paperColor ? " on" : ""}`,
          style: { background: pc.color },
          title: pc.name,
          "aria-label": pc.name,
          onclick: (e: Event) => {
            choice.paperColor = pc.color;
            swatches.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s === e.currentTarget));
          },
        }),
      ),
    );

    const body = h(
      "div",
      { class: "modal-body" },
      h("h3", null, "Typeface"),
      fonts,
      h(
        "div",
        { class: "grid2" },
        select("Pitch", choice.pitch, PITCHES.map((p) => [p.cpi, p.name]), (v) => (choice.pitch = v)),
        select("Paper", choice.paperName, PAPERS.map((p) => [p.name, p.name]), (v) => (choice.paperName = v)),
        select("Ribbon", choice.ribbonName, RIBBONS.map((r) => [r.name, r.name]), (v) => (choice.ribbonName = v)),
        h("div", { class: "row" }, h("span", { class: "row-label" }, "Paper colour"), swatches),
      ),
    );

    const close = modal(
      "New document",
      body,
      [
        h("button", { class: "secondary", onclick: () => close() }, "Cancel"),
        h(
          "button",
          {
            class: "primary",
            onclick: () => {
              result = { ...choice };
              close();
            },
          },
          "Insert paper",
        ),
      ],
      () => resolve(result),
      true,
    );
  });
}

export function helpDialog(commands: Commands) {
  const groups = ["Machine", "Paper", "File", "Edit", "View"] as const;
  const keys: [string, string][] = [
    ["Hold a key longer", "Strike darker (light tap = faint)"],
    ["Backspace", "Carriage back one space — nothing is erased"],
    ["Return  /  ⇧ Return", "Carriage return with / without a line feed"],
    ["Tab", "Next tab stop"],
    ["← → ↑ ↓", "Move carriage / roll platen (⌥ = half steps)"],
    ["Two-finger scroll", "Roll the platen ↕ and slide the carriage ↔ (ratchet notches, or freely with the line release)"],
    ["Pinch", "Zoom"],
    ["Two-finger rotate", "Skew the paper (free mode, rotation unlocked)"],
    ["⌥ + scroll", "Look around the desk without moving anything"],
    ["Tipp-Ex brush (⌘K)", "Drag over letters to paint them out, then type over the dried fluid"],
    ["Esc", "Put the Tipp-Ex down / close panels / leave focus mode"],
  ];
  const body = h(
    "div",
    { class: "modal-body help" },
    h("p", { class: "lede" }, "TypeWriterX behaves like a real machine: nothing is ever deleted. Overtype, paint over with Tipp-Ex, or feed a fresh sheet."),
    h("h3", null, "Typing & gestures"),
    h("dl", null, ...keys.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
    ...groups.map((g) => {
      const cmds = commands.list.filter((c) => c.menu === g && c.accel);
      return h("div", null, h("h3", null, g), h("dl", null, ...cmds.flatMap((c) => [h("dt", null, prettyAccel(c.accel)), h("dd", null, c.label.replace(/…$/, ""))])));
    }),
  );
  modal("Keys & gestures", body, [], () => {}, true);
}
