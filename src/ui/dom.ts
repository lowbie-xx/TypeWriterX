type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny hyperscript helper: h("button", { class: "x", onclick }, "Label"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (k === "class") el.className = String(v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k in el && !k.includes("-")) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Inline SVG icon from a 16×16 path set (stroke = currentColor). */
export function icon(paths: string, fill = false): SVGSVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML =
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="${fill ? "currentColor" : "none"}" ` +
    `stroke="${fill ? "none" : "currentColor"}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return wrap.firstChild as SVGSVGElement;
}

export const ICONS = {
  lever: '<path d="M3 13 L11 4"/><circle cx="11.6" cy="3.4" r="1.9"/><path d="M1.5 13.5h6"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.3"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  vert: '<path d="M8 2v12M5 4.5 8 2l3 2.5M5 11.5 8 14l3-2.5"/>',
  horz: '<path d="M2 8h12M4.5 5 2 8l2.5 3M11.5 5 14 8l-2.5 3"/>',
  rot: '<path d="M12.5 6.5A5 5 0 1 0 13 9"/><path d="M13 3.5v3h-3"/>',
  margin: '<path d="M3 2v12M13 2v12"/><path d="M6 8h6M10 6l2 2-2 2"/>',
  bottle: '<path d="M6.5 1.8h3v2.4h-3z"/><path d="M5.6 4.2h4.8l.9 2v7.3a.8.8 0 0 1-.8.8H5.5a.8.8 0 0 1-.8-.8V6.2z"/><path d="M5 9h6"/>',
  tape: '<rect x="1.8" y="5" width="12.4" height="6" rx="1"/><path d="M5 5v6M11 5v6"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/>',
  help: '<circle cx="8" cy="8" r="6.3"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  left: '<path d="M10 3 5 8l5 5"/>',
  right: '<path d="M6 3l5 5-5 5"/>',
  sheet: '<path d="M4 1.8h5.5L12 4.3v9.9H4z"/><path d="M9.5 1.8v2.5H12"/>',
  view: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 9.5h12"/>',
};
