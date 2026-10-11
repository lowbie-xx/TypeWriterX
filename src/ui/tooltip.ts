import { h } from "./dom";

const DELAY = 250;

/**
 * Quick tooltips. Native `title` tooltips wait about a second, so every
 * element with a title is converted to data-tip and shown by this instead.
 */
export function installTooltips(enabled: () => boolean, root: HTMLElement = document.body) {
  const tip = h("div", { id: "tooltip", role: "tooltip" });
  document.body.append(tip);
  let current: HTMLElement | null = null;
  let timer = 0;

  const adopt = (el: Element) => {
    if (!(el instanceof HTMLElement) || !el.title) return;
    if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", el.title);
    el.dataset.tip = el.title;
    el.removeAttribute("title");
  };
  const adoptAll = (node: ParentNode) => node.querySelectorAll("[title]").forEach(adopt);
  adoptAll(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") adopt(r.target as Element);
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) {
          adopt(n);
          adoptAll(n);
        }
      });
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });

  const hide = () => {
    clearTimeout(timer);
    current = null;
    tip.classList.remove("show");
  };

  const show = (el: HTMLElement) => {
    tip.textContent = el.dataset.tip ?? "";
    tip.classList.add("show");
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    const below = r.bottom + 8 + t.height < window.innerHeight;
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - t.height - 8}px`;
  };

  root.addEventListener("pointerover", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tip]");
    if (el === current) return;
    hide();
    if (!el || !enabled()) return;
    current = el;
    timer = window.setTimeout(() => show(el), DELAY);
  });
  root.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide();
  });
  root.addEventListener("pointerdown", hide);
  window.addEventListener("keydown", hide, true);
  window.addEventListener("blur", hide);
}
