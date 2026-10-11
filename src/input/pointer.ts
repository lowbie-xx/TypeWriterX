import type { Machine } from "../core/machine";
import type { Prefs } from "../core/prefs";
import type { Renderer } from "../render/renderer";

interface GestureEvent extends UIEvent {
  scale: number;
  rotation: number;
  clientX: number;
  clientY: number;
}

/**
 * Trackpad and mouse:
 * - two-finger scroll rolls the platen (vertical) and slides the carriage
 *   (horizontal), in ratchet notches or freely with the line release;
 * - pinch zooms, and a two-finger rotate skews the paper in free mode;
 * - ⌥ + scroll looks around the desk without moving the machine;
 * - with the Tipp-Ex brush, dragging paints whiteout on the sheet.
 */
export function installPointer(canvas: HTMLCanvasElement, machine: Machine, renderer: Renderer, prefs: () => Prefs) {
  let accX = 0, accY = 0;
  let lastWheel = 0;
  // Unsnapped free position, so snapping doesn't eat small movements.
  let raw = { c: 0, p: 0 };
  let rawFrom = { c: NaN, p: NaN };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const pr = prefs();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? renderer.H : 1;
      let dx = e.deltaX * unit, dy = e.deltaY * unit;

      // Pinch-to-zoom arrives as ctrl+wheel in most engines.
      if (e.ctrlKey) {
        renderer.setZoom(renderer.zoom * Math.exp(-dy * 0.01), local(e));
        return;
      }
      if (e.altKey) {
        renderer.panBy(-dx, -dy);
        return;
      }
      if (pr.invertScroll) {
        dx = -dx;
        dy = -dy;
      }
      const now = performance.now();
      if (now - lastWheel > 250) accX = accY = 0;
      lastWheel = now;
      const sens = pr.scrollSensitivity;

      if (machine.session.free) {
        const m = machine.m;
        if (m.c !== rawFrom.c || m.p !== rawFrom.p) raw = { c: m.c, p: m.p };
        const z = renderer.zoom;
        const dc = machine.session.lockX ? 0 : (dx * sens) / z;
        const dp = machine.session.lockY ? 0 : (dy * sens) / z;
        raw.c += dc;
        raw.p += dp;
        machine.moveFree(raw.c - m.c, raw.p - m.p);
        if (pr.freeSnap) machine.snapToGrid();
        rawFrom = { c: machine.m.c, p: machine.m.p };
        return;
      }

      // Ratchet: whole-line notches on the platen, whole characters on the carriage.
      // Take the dominant axis so a vertical swipe doesn't nudge the carriage.
      if (Math.abs(dx) > Math.abs(dy) * 1.5) dy = 0;
      else dx = 0;
      if (!machine.session.lockY) accY += dy * sens;
      if (!machine.session.lockX) accX += dx * sens;
      const step = pr.ratchetPx;
      const lines = Math.trunc(accY / step);
      if (lines) {
        accY -= lines * step;
        machine.feedLines(lines);
      }
      const cols = Math.trunc(accX / step);
      if (cols) {
        accX -= cols * step;
        machine.slideCarriage(cols);
      }
    },
    { passive: false },
  );

  // Safari / WKWebView trackpad gestures: pinch and rotate.
  let startZoom = 1;
  let lastRot = 0;
  canvas.addEventListener("gesturestart", (ev) => {
    const e = ev as GestureEvent;
    e.preventDefault();
    startZoom = renderer.zoom;
    lastRot = e.rotation;
  });
  canvas.addEventListener("gesturechange", (ev) => {
    const e = ev as GestureEvent;
    e.preventDefault();
    renderer.setZoom(startZoom * e.scale, local(e));
    const d = e.rotation - lastRot;
    lastRot = e.rotation;
    if (d) machine.rotatePaper((d * Math.PI) / 180);
  });
  canvas.addEventListener("gestureend", (ev) => ev.preventDefault());

  // Mouse / single-finger click.
  let brushing = false;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const pt = local(e);
    const paper = renderer.screenToPaper(pt.x, pt.y);
    if (machine.session.tippex) {
      brushing = true;
      canvas.setPointerCapture(e.pointerId);
      machine.beginStroke(paper.x, paper.y);
      return;
    }
    const mode = prefs().clickToPosition;
    if (mode === "always" || (mode === "free" && machine.session.free)) {
      machine.placeAt(paper.x, paper.y, !machine.session.free);
      renderer.recenter();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!brushing) return;
    // Coalesced events give smooth strokes on fast drags.
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced && coalesced.length ? coalesced : [e];
    for (const ev of events) {
      const pt = local(ev);
      const paper = renderer.screenToPaper(pt.x, pt.y);
      machine.extendStroke(paper.x, paper.y);
    }
  });
  const end = () => {
    if (!brushing) return;
    brushing = false;
    machine.endStroke();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  /** Cursor: a Tipp-Ex brush circle sized to the stroke, or a crosshair in free mode. */
  return function updateCursor() {
    if (machine.session.tippex) {
      const d = Math.max(4, Math.min(120, prefs().tippexSize * renderer.zoom));
      const s = Math.ceil(d + 4), r = d / 2, c = s / 2;
      const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'>` +
        `<circle cx='${c}' cy='${c}' r='${r}' fill='rgba(255,255,255,0.35)' stroke='black' stroke-opacity='0.55' stroke-width='1'/>` +
        `<circle cx='${c}' cy='${c}' r='${Math.max(0.5, r - 1)}' fill='none' stroke='white' stroke-opacity='0.8' stroke-width='1'/></svg>`;
      canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
    } else if (machine.session.free || prefs().clickToPosition === "always") {
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "default";
    }
  };
}
