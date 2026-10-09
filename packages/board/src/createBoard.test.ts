import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoard } from "./createBoard";
import type { Board } from "./createBoard";

/** A minimal valid document: two nodes, one edge, no timeline. */
const VALID_SOURCE = `flowchart TD
A[Start] --> B[End]
`;

const FAKE_MEASURER = { measure: () => ({ width: 80, height: 32 }) };

/**
 * jsdom returns an all-zero rect by default (no real layout engine) — tests
 * that exercise viewport.ts's clamp/cursor-anchor math give the element a
 * controlled size/position via this stub, the same class of gap
 * `measureText` already works around for canvas metrics.
 */
function stubRect(
  el: Element,
  rect: { width: number; height: number; left?: number; top?: number },
): void {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width: rect.width,
    height: rect.height,
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
    x: left,
    y: top,
    toJSON: () => {},
  });
}

/** Reads the pan/zoom state off .siren-board-viewport's applied inline transform. */
function readViewportTransform(container: HTMLElement): { offsetX: number; offsetY: number; scale: number } {
  const el = container.querySelector<HTMLElement>(".siren-board-viewport")!;
  const match = el.style.transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/);
  if (match === null) {
    throw new Error(`unparseable .siren-board-viewport transform: "${el.style.transform}"`);
  }
  return { offsetX: Number(match[1]), offsetY: Number(match[2]), scale: Number(match[3]) };
}

/** The built-in bar's button with this accessible name. */
function button(container: HTMLElement, label: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(`.siren-board-controls button[aria-label="${label}"]`)!;
}

describe("createBoard", () => {
  it("mounts a rendered SVG into the container when constructed with a source", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    const svg = container.querySelector(".siren-board-viewport svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("g.siren-node")).toHaveLength(2);
  });

  it("marks the container with the siren-board class, so board's injected chrome CSS (full-bleed sizing, SVG scale-to-fit) applies to it", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    expect(container.classList.contains("siren-board")).toBe(true);
  });

  it("injects its chrome stylesheet into document.head exactly once, no matter how many boards are created on the page", () => {
    document.head.querySelectorAll("style#siren-board-styles").forEach((el) => el.remove());

    createBoard(document.createElement("div"), { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    createBoard(document.createElement("div"), { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    expect(document.head.querySelectorAll("style#siren-board-styles")).toHaveLength(1);
  });

  it("mounts nothing until setSource is called, when constructed with no initial source", () => {
    const container = document.createElement("div");

    const board = createBoard(container, { measureText: FAKE_MEASURER });

    expect(container.querySelector(".siren-board-viewport svg")).toBeNull();
    expect(board.controller).toBeNull();
    expect(board.diagnostics).toEqual([]);
  });

  it("setSource re-renders synchronously and updates controller/diagnostics", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { measureText: FAKE_MEASURER });

    board.setSource(VALID_SOURCE);

    expect(container.querySelector(".siren-board-viewport svg")).not.toBeNull();
    expect(board.controller).not.toBeNull();
    expect(board.diagnostics).toEqual([]);
  });

  it("keeps the last successful diagram and controller visible when a later setSource fails to parse, and shows an error banner", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const svgBeforeFailure = container.querySelector(".siren-board-viewport svg");
    const controllerBeforeFailure = board.controller;

    board.setSource("this is not a valid siren document");

    expect(container.querySelector(".siren-board-viewport svg")).toBe(svgBeforeFailure);
    expect(board.controller).toBe(controllerBeforeFailure);
    expect(board.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(container.querySelector(".siren-board-error")).not.toBeNull();
  });

  it("clears a previous error banner once a later setSource succeeds again", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    board.setSource("this is not a valid siren document");
    expect(container.querySelector(".siren-board-error")).not.toBeNull();

    board.setSource(VALID_SOURCE);

    expect(container.querySelector(".siren-board-error")).toBeNull();
  });

  it("calls onDiagnostics on every setSource, including a successful render that only produced warnings", () => {
    const container = document.createElement("div");
    const seen: Array<{ severity: string }[]> = [];
    const board = createBoard(container, {
      measureText: FAKE_MEASURER,
      onDiagnostics: (diagnostics) => seen.push(diagnostics),
    });

    // Two different annotations on one class: Mermaid draws only the
    // first, so Siren draws it too and warns about the one it dropped. (A
    // flowchart node relabelled used to be the example here, until a later
    // label became the one drawn, silently, as Mermaid does.)
    const sourceWithWarningOnly = `classDiagram
class A
<<interface>> A
<<service>> A
`;
    board.setSource(sourceWithWarningOnly);

    expect(seen).toHaveLength(1);
    expect(seen[0].some((d) => d.severity === "warning")).toBe(true);
    expect(board.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  it("destroy() clears the container's mounted content and siren-board class", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    board.destroy();

    expect(container.children).toHaveLength(0);
    expect(container.classList.contains("siren-board")).toBe(false);
  });

  it("destroy() does not remove the shared injected stylesheet, and calling it twice does not throw", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    board.destroy();

    expect(document.head.querySelector("style#siren-board-styles")).not.toBeNull();
    expect(() => board.destroy()).not.toThrow();
  });

  it("renders a default Prev/Play/Next/step counter/Reset/Play interval/Full diagram/Reset view control bar unless controls: false is passed", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    const bar = container.querySelector(".siren-board-controls")!;
    expect(bar).not.toBeNull();
    expect(
      Array.from(bar.children).map((c) => `${c.tagName.toLowerCase()} ${c.getAttribute("aria-label") ?? c.className}`),
    ).toEqual([
      "button Prev",
      "button Play",
      "button Next",
      "span siren-board-controls__step",
      "button Reset",
      "select Play interval",
      "button Full diagram",
      "button Reset view",
    ]);
    const buttons = Array.from(bar.querySelectorAll("button"));
    const labels = ["Prev", "Play", "Next", "Reset", "Full diagram", "Reset view"];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(labels);
    expect(buttons.map((b) => b.title)).toEqual(labels);
    for (const button of buttons) {
      expect(button.textContent).toBe(""); // icon only: no visible text
      const icons = button.querySelectorAll("svg");
      expect(icons).toHaveLength(1);
      expect(icons[0].getAttribute("aria-hidden")).toBe("true");
      expect(icons[0].getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("controls: false renders no control bar", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER, controls: false });

    expect(container.querySelector(".siren-board-controls")).toBeNull();
  });

  it("clicking the default bar's Next button advances board.controller.currentStep", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
timeline:
enter B fade
`;
    const board = createBoard(container, { source, measureText: FAKE_MEASURER });

    const nextButton = container.querySelector<HTMLButtonElement>('button[aria-label="Next"]')!;
    nextButton.click();

    expect(board.controller!.currentStep).toBe(1);
  });

  it("clicking the default bar's Reset view button resets the pan/zoom view without changing board.controller.currentStep or totalSteps", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
timeline:
enter B fade
`;
    const board = createBoard(container, { source, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
    );
    expect(readViewportTransform(container).scale).not.toBe(1); // sanity: the wheel event actually moved the view

    const nextButton = container.querySelector<HTMLButtonElement>('button[aria-label="Next"]')!;
    nextButton.click();
    expect(board.controller!.currentStep).toBe(1);

    const resetViewButton = container.querySelector<HTMLButtonElement>('button[aria-label="Reset view"]')!;
    resetViewButton.click();

    expect(readViewportTransform(container)).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
    expect(board.controller!.currentStep).toBe(1); // step untouched by Reset view
    expect(board.controller!.totalSteps).toBe(1);
  });

  it("clicking the default bar's existing Reset button does not change the pan/zoom view", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
    );
    const zoomed = readViewportTransform(container);
    expect(zoomed.scale).not.toBe(1); // sanity: the wheel event actually moved the view

    const resetButton = container.querySelector<HTMLButtonElement>('button[aria-label="Reset"]')!;
    resetButton.click();

    expect(readViewportTransform(container)).toEqual(zoomed);
  });

  it("controls: <factory> renders the factory's element instead of the built-in bar, and calls its destroy() when the board is destroyed", () => {
    const container = document.createElement("div");
    const customElement = document.createElement("div");
    customElement.className = "my-custom-controls";
    const destroySpy = { called: false };

    const board = createBoard(container, {
      source: VALID_SOURCE,
      measureText: FAKE_MEASURER,
      controls: () => ({
        element: customElement,
        destroy: () => {
          destroySpy.called = true;
        },
      }),
    });

    expect(container.querySelector(".siren-board-controls")).toBeNull();
    expect(container.contains(customElement)).toBe(true);

    board.destroy();
    expect(destroySpy.called).toBe(true);
  });

  it("mounts the rendered SVG inside a .siren-board-viewport layer nested inside .siren-board-canvas, keeping the error banner a direct sibling of the viewport rather than inside it", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    const canvas = container.querySelector(".siren-board-canvas")!;
    const viewportEl = canvas.querySelector(":scope > .siren-board-viewport")!;
    expect(viewportEl).not.toBeNull();
    expect(viewportEl.querySelector("svg")).not.toBeNull();

    board.setSource("this is not a valid siren document");

    const banner = canvas.querySelector(":scope > .siren-board-error");
    expect(banner).not.toBeNull();
    expect(viewportEl.contains(banner)).toBe(false);
  });

  it("board.resetView() resets scale to 1.0 and offset to (0, 0), regardless of the current pan/zoom state", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
    );
    const moved = readViewportTransform(container);
    expect(moved.scale).not.toBe(1); // sanity: the wheel event actually moved the view

    board.resetView();

    expect(readViewportTransform(container)).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("a successful setSource resets the view to the initial fit-to-container state", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
    );
    expect(readViewportTransform(container).scale).not.toBe(1); // sanity

    board.setSource(VALID_SOURCE);

    expect(readViewportTransform(container)).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("a setSource call that fails to parse leaves the current pan/zoom state unchanged", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
    );
    const beforeFailure = readViewportTransform(container);
    expect(beforeFailure.scale).not.toBe(1); // sanity

    board.setSource("this is not a valid siren document");

    expect(readViewportTransform(container)).toEqual(beforeFailure);
  });

  it("a mousedown + mousemove drag sequence over the board's canvas pans the diagram at the default 1.0x fit-to-container scale — panning is not gated on zooming in first", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 130 }));

    // Within the margin band around dead center (PAN_MARGIN_RATIO 0.5 * 400 =
    // 200, * 300 = 150), the drag delta applies directly.
    expect(readViewportTransform(container)).toEqual({ offsetX: 50, offsetY: 30, scale: 1 });

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 150, clientY: 130 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 400 }));
    expect(readViewportTransform(container)).toEqual({ offsetX: 50, offsetY: 30, scale: 1 }); // stopped, stray moves are no-ops
  });

  it("a mousedown + mousemove drag sequence over the board's canvas pans the diagram by the drag delta when zoomed in; mouseup stops the pan, and further window mousemove has no effect", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    // A large wheel event deterministically saturates zoom to the 4.0x
    // clamp, giving the drag below plenty of overflow room to move within.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 200, clientY: 150, deltaY: -1_000_000, bubbles: true, cancelable: true }),
    );
    const zoomed = readViewportTransform(container);
    expect(zoomed.scale).toBe(4); // sanity: saturated the zoom-in clamp

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 130 }));
    const dragged = readViewportTransform(container);
    expect(dragged.offsetX).toBe(zoomed.offsetX + 50);
    expect(dragged.offsetY).toBe(zoomed.offsetY + 30);
    expect(dragged.scale).toBe(4); // wheel-only concern, unaffected by drag

    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 150, clientY: 130 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 400 }));
    expect(readViewportTransform(container)).toEqual(dragged); // stopped, and stray moves are no-ops
  });

  it("a mousedown on the board's canvas calls preventDefault(), so a real drag isn't hijacked by the browser's native image-drag or text-selection gesture", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });

    const mouseDownEvent = new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 100,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(mouseDownEvent, "preventDefault");
    canvas.dispatchEvent(mouseDownEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: 100 })); // cleanup: stop the drag this started
  });

  it("a mousedown on the board's canvas still takes focus off a control, as a click on the page would — preventDefault() alone would leave the play interval select focused", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // A timeline, so the select is enabled and can hold focus.
    const source = `${VALID_SOURCE}timeline:\nexit B fade\n`;
    createBoard(container, { source, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Play interval"]')!;
    select.focus();
    expect(document.activeElement).toBe(select); // sanity

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, button: 0, bubbles: true, cancelable: true }));

    expect(document.activeElement).not.toBe(select);
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: 100 })); // cleanup: stop the drag this started
    container.remove();
  });

  it("a wheel event over the board's canvas zooms cursor-anchored (the content point under the cursor stays under the cursor) and calls preventDefault()", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    const before = readViewportTransform(container);
    // Content-space point under the cursor, per the standard CSS transform
    // semantics of `translate(offsetX, offsetY) scale(scale)` applied with a
    // `transform-origin: 0 0` (the ticket's own required setup): a screen
    // point maps to content-local coordinates via (screen - offset) / scale.
    const cursorX = 250;
    const cursorY = 180;
    const localXBefore = (cursorX - before.offsetX) / before.scale;
    const localYBefore = (cursorY - before.offsetY) / before.scale;

    const wheelEvent = new WheelEvent("wheel", {
      clientX: cursorX,
      clientY: cursorY,
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(wheelEvent, "preventDefault");
    canvas.dispatchEvent(wheelEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();

    const after = readViewportTransform(container);
    expect(after.scale).not.toBe(before.scale); // sanity: the zoom actually happened
    const localXAfter = (cursorX - after.offsetX) / after.scale;
    const localYAfter = (cursorY - after.offsetY) / after.scale;
    expect(localXAfter).toBeCloseTo(localXBefore, 10);
    expect(localYAfter).toBeCloseTo(localYBefore, 10);
  });

  it("repeated zoom-in wheel events never push scale above 4.0x, and repeated zoom-out wheel events never push scale below 0.1x", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });

    for (let i = 0; i < 50; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { clientX: 200, clientY: 150, deltaY: -100, bubbles: true, cancelable: true }),
      );
      expect(readViewportTransform(container).scale).toBeLessThanOrEqual(4);
    }
    expect(readViewportTransform(container).scale).toBe(4);

    for (let i = 0; i < 50; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { clientX: 200, clientY: 150, deltaY: 100, bubbles: true, cancelable: true }),
      );
      expect(readViewportTransform(container).scale).toBeGreaterThanOrEqual(0.1);
    }
    expect(readViewportTransform(container).scale).toBeCloseTo(0.1, 10);
  });

  it("pan is clamped so scaled content larger than the container can be dragged up to a blank-space margin past its own edge, but no further", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    // Saturate zoom-in to exactly 4.0x (a spec-given constant, independent
    // of viewport.ts's internal zoom-per-tick formula): scaled content is
    // then 1600x1200 against a 400x300 container.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 200, clientY: 150, deltaY: -1_000_000, bubbles: true, cancelable: true }),
    );
    expect(readViewportTransform(container).scale).toBe(4); // sanity

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1_000_000, clientY: 1_000_000 }));
    // Dragged far positive: content's left/top edge is pinned to a margin of
    // PAN_MARGIN_RATIO (0.5) * the container's own width/height past the
    // container's near edge — 400*0.5=200, 300*0.5=150 — rather than exactly 0.
    expect(readViewportTransform(container)).toEqual({ offsetX: 200, offsetY: 150, scale: 4 });

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: -1_000_000, clientY: -1_000_000 }));
    // Dragged far negative: content's right/bottom edge is pinned to that same
    // margin past the container's far edge — offsetX/Y = width/height -
    // scaledWidth/Height - margin (400-1600-200=-1400, 300-1200-150=-1050).
    expect(readViewportTransform(container)).toEqual({ offsetX: -1400, offsetY: -1050, scale: 4 });
  });

  it("pan still moves the view — within a margin around dead center — even when zoomed-out content is smaller than the container", () => {
    const container = document.createElement("div");
    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    // Saturate zoom-out to exactly 0.1x (spec-given constant) with the wheel
    // centered on the container's own center point (200, 150 of a 400x300
    // box): cursor-anchored zoom keeps that point fixed at every step, so
    // the content lands exactly dead center regardless of the internal
    // zoom-per-tick formula — scaled content is then 40x30, dead center at
    // (400-40)/2=180, (300-30)/2=135.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 200, clientY: 150, deltaY: 1_000_000, bubbles: true, cancelable: true }),
    );
    const zoomedOut = readViewportTransform(container);
    expect(zoomedOut.scale).toBeCloseTo(0.1, 10); // sanity
    expect(zoomedOut.offsetX).toBeCloseTo(180, 10);
    expect(zoomedOut.offsetY).toBeCloseTo(135, 10);

    // A drag well inside the margin (PAN_MARGIN_RATIO 0.5 * 400 = 200, * 300
    // = 150 on each side of dead center) moves the view by the full delta —
    // panning isn't locked here just because content is smaller than the
    // container.
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50 }));
    const dragged = readViewportTransform(container);
    expect(dragged.offsetX).toBeCloseTo(230, 10); // 180 + 50
    expect(dragged.offsetY).toBeCloseTo(185, 10); // 135 + 50

    // Dragging far past the margin still hits a hard boundary — restMaxX
    // (360, i.e. rect.width - scaledWidth) + marginX (200) = 560 for X;
    // restMaxY (270) + marginY (150) = 420 for Y.
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1_000_000, clientY: 1_000_000 }));
    expect(readViewportTransform(container)).toEqual({ offsetX: 560, offsetY: 420, scale: 0.1 });
  });

  it("destroy() removes the viewport's window-level mousemove/mouseup listeners left over from an in-progress drag, so a stray window move afterward has no effect", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
    stubRect(canvas, { width: 400, height: 300 });
    const viewportEl = container.querySelector<HTMLElement>(".siren-board-viewport")!;
    // Zoom in first so the clamp range is wide open — at the default 1.0x
    // fit-to-container scale, a stray drag would be forced back to the same
    // locked-centered offset regardless of whether cleanup ran, masking the
    // very listener leak this test exists to catch.
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 200, clientY: 150, deltaY: -1_000_000, bubbles: true, cancelable: true }),
    );
    expect(readViewportTransform(container).scale).toBe(4); // sanity

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    // Drag is now in progress (window-level mousemove/mouseup attached), but
    // never released with a mouseup before destroy() runs.
    board.destroy();
    const transformAtDestroy = viewportEl.style.transform;

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 999, clientY: 999 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 999, clientY: 999 }));

    expect(viewportEl.style.transform).toBe(transformAtDestroy); // untouched by the stray drag
    expect(() => board.destroy()).not.toThrow(); // second destroy() is still a no-op
  });

  it("onStepChange fires once per step change, from either the built-in bar or a direct board.controller call, but not on construction or a no-op call", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter B fade
enter C fade
`;
    const calls: Array<[number, number]> = [];
    const board = createBoard(container, {
      source,
      measureText: FAKE_MEASURER,
      onStepChange: (current, total) => calls.push([current, total]),
    });

    expect(calls).toEqual([]); // no synthetic call on construction

    const nextButton = container.querySelector<HTMLButtonElement>('button[aria-label="Next"]')!;
    nextButton.click(); // built-in bar trigger
    expect(calls).toEqual([[1, 2]]);

    board.controller!.next(); // direct controller trigger
    expect(calls).toEqual([[1, 2], [2, 2]]);

    board.controller!.next(); // already at the last step: no-op, no callback
    expect(calls).toEqual([[1, 2], [2, 2]]);

    board.controller!.reset();
    expect(calls).toEqual([[1, 2], [2, 2], [0, 2]]);
  });

  describe("full diagram", () => {
    /**
     * By step 2, A carries a highlight class and B an exit class — the two
     * states that make the timeline's last step differ from the full diagram
     * (CONTEXT.md's "Full diagram").
     */
    const TIMELINE_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
highlight A outline
exit B fade
`;

    /** Every timeline effect class (enter/exit/highlight/pending) anywhere in the board's SVG. */
    function effectClasses(container: HTMLElement): string[] {
      const found: string[] = [];
      for (const el of Array.from(container.querySelectorAll(".siren-board-viewport svg *"))) {
        for (const c of Array.from(el.classList)) {
          if (c === "siren-pending" || /^siren-(enter|exit|highlight)-/.test(c)) found.push(c);
        }
      }
      return found;
    }

    /**
     * The viewport's markup with each render's per-SVG id scope collapsed:
     * core suffixes marker ids with a fresh `__xxxxxxxx` scope per render (so
     * two diagrams on one page never collide), which makes markup differ
     * across renders even when the drawing is identical — the same
     * normalisation core's own index.test.ts uses for "same drawing".
     */
    function sameDrawing(container: HTMLElement): string {
      return container.querySelector(".siren-board-viewport")!.innerHTML.replace(/__[0-9a-z]{8}(?![0-9a-z])/g, "__SCOPE");
    }

    it("starts with fullDiagram false", () => {
      const board = createBoard(document.createElement("div"), { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });

      expect(board.fullDiagram).toBe(false);
    });

    it("setFullDiagram(true) at step 2 draws the document without its timeline: no effect classes, no steps, onFullDiagramChange(true), and neither onStepChange nor onDiagnostics fires", () => {
      const container = document.createElement("div");
      const changes: boolean[] = [];
      const stepChanges: number[] = [];
      let diagnosticsCalls = 0;
      const board = createBoard(container, {
        source: TIMELINE_SOURCE,
        measureText: FAKE_MEASURER,
        onFullDiagramChange: (on) => changes.push(on),
        onStepChange: (current) => stepChanges.push(current),
        onDiagnostics: () => diagnosticsCalls++,
      });
      board.controller!.next();
      board.controller!.next();
      expect(effectClasses(container)).not.toEqual([]); // sanity: step 2 shows the exit and highlight
      stepChanges.length = 0;
      diagnosticsCalls = 0;

      board.setFullDiagram(true);

      expect(board.fullDiagram).toBe(true);
      expect(effectClasses(container)).toEqual([]);
      expect(container.querySelectorAll(".siren-board-viewport svg g.siren-node")).toHaveLength(3);
      expect(board.controller!.totalSteps).toBe(0);
      expect(board.controller!.currentStep).toBe(0);
      expect(changes).toEqual([true]);
      expect(stepChanges).toEqual([]);
      expect(diagnosticsCalls).toBe(0);
    });

    it("setFullDiagram(false) returns to the step shown before, drawing exactly what stepping there directly draws, with onFullDiagramChange(false) and no onStepChange", () => {
      const container = document.createElement("div");
      const changes: boolean[] = [];
      const stepChanges: number[] = [];
      const board = createBoard(container, {
        source: TIMELINE_SOURCE,
        measureText: FAKE_MEASURER,
        onFullDiagramChange: (on) => changes.push(on),
        onStepChange: (current) => stepChanges.push(current),
      });
      board.controller!.next();
      board.controller!.next();
      board.setFullDiagram(true);
      stepChanges.length = 0;

      board.setFullDiagram(false);

      const direct = document.createElement("div");
      const directBoard = createBoard(direct, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
      directBoard.controller!.next();
      directBoard.controller!.next();
      expect(board.fullDiagram).toBe(false);
      expect(board.controller!.currentStep).toBe(2);
      expect(board.controller!.totalSteps).toBe(2);
      expect(sameDrawing(container)).toBe(sameDrawing(direct));
      expect(changes).toEqual([true, false]);
      expect(stepChanges).toEqual([]);
    });

    it("setting fullDiagram to the value it already has re-renders nothing and fires no onFullDiagramChange", () => {
      const container = document.createElement("div");
      const changes: boolean[] = [];
      const board = createBoard(container, {
        source: TIMELINE_SOURCE,
        measureText: FAKE_MEASURER,
        onFullDiagramChange: (on) => changes.push(on),
      });
      const timelineSvg = container.querySelector(".siren-board-viewport svg");

      board.setFullDiagram(false);

      expect(container.querySelector(".siren-board-viewport svg")).toBe(timelineSvg);
      expect(changes).toEqual([]);

      board.setFullDiagram(true);
      const fullSvg = container.querySelector(".siren-board-viewport svg");
      board.setFullDiagram(true);

      expect(container.querySelector(".siren-board-viewport svg")).toBe(fullSvg);
      expect(changes).toEqual([true]);
    });

    it("switching the full diagram on and off leaves the view (pan/zoom) where it was", () => {
      const container = document.createElement("div");
      const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
      const canvas = container.querySelector<HTMLElement>(".siren-board-canvas")!;
      stubRect(canvas, { width: 400, height: 300 });
      canvas.dispatchEvent(
        new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
      );
      const zoomed = readViewportTransform(container);
      expect(zoomed.scale).not.toBe(1); // sanity: the wheel event actually moved the view

      board.setFullDiagram(true);
      expect(readViewportTransform(container)).toEqual(zoomed);

      board.setFullDiagram(false);
      expect(readViewportTransform(container)).toEqual(zoomed);
    });

    it("setSource while the full diagram is on draws the new document as a full diagram, and switching back starts its timeline at step 0", () => {
      const container = document.createElement("div");
      const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
      board.controller!.next();
      board.controller!.next();
      board.setFullDiagram(true);

      board.setSource(TIMELINE_SOURCE);

      expect(board.fullDiagram).toBe(true);
      expect(effectClasses(container)).toEqual([]);
      expect(board.controller!.totalSteps).toBe(0);

      board.setFullDiagram(false);

      expect(board.controller!.totalSteps).toBe(2);
      expect(board.controller!.currentStep).toBe(0);
    });

    it("on a board that has not rendered yet, setFullDiagram still switches and fires, and the first setSource that renders draws the full diagram", () => {
      const container = document.createElement("div");
      const changes: boolean[] = [];
      const board = createBoard(container, { measureText: FAKE_MEASURER, onFullDiagramChange: (on) => changes.push(on) });

      board.setFullDiagram(true);

      expect(board.fullDiagram).toBe(true);
      expect(changes).toEqual([true]);
      expect(board.controller).toBeNull();

      board.setSource(TIMELINE_SOURCE);

      expect(board.controller!.totalSteps).toBe(0);
      expect(container.querySelectorAll(".siren-board-viewport svg g.siren-node")).toHaveLength(3);
    });

    it("when the first setSource fails, setFullDiagram still switches and fires, and the next setSource that renders draws the full diagram", () => {
      const container = document.createElement("div");
      const changes: boolean[] = [];
      const board = createBoard(container, {
        source: "this is not a valid siren document",
        measureText: FAKE_MEASURER,
        onFullDiagramChange: (on) => changes.push(on),
      });

      board.setFullDiagram(true);

      expect(board.fullDiagram).toBe(true);
      expect(changes).toEqual([true]);
      expect(board.controller).toBeNull();

      board.setSource(TIMELINE_SOURCE);

      expect(board.controller!.totalSteps).toBe(0);
      expect(container.querySelectorAll(".siren-board-viewport svg g.siren-node")).toHaveLength(3);
    });

    it("after a setSource that failed, switching re-renders the last source that rendered and keeps the error banner and diagnostics", () => {
      const container = document.createElement("div");
      const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
      board.setSource("this is not a valid siren document");
      const failedDiagnostics = board.diagnostics;
      expect(failedDiagnostics.some((d) => d.severity === "error")).toBe(true); // sanity

      board.setFullDiagram(true);

      expect(board.controller!.totalSteps).toBe(0);
      expect(container.querySelectorAll(".siren-board-viewport svg g.siren-node")).toHaveLength(3);
      expect(container.querySelector(".siren-board-error")).not.toBeNull();
      expect(board.diagnostics).toBe(failedDiagnostics);

      board.setFullDiagram(false);

      expect(board.controller!.totalSteps).toBe(2);
      expect(container.querySelector(".siren-board-error")).not.toBeNull();
      expect(board.diagnostics).toBe(failedDiagnostics);
    });

    it("setFullDiagram after destroy() does nothing: no throw, no onFullDiagramChange, nothing mounted again", () => {
      const container = document.createElement("div");
      const changes: boolean[] = [];
      const board = createBoard(container, {
        source: TIMELINE_SOURCE,
        measureText: FAKE_MEASURER,
        onFullDiagramChange: (on) => changes.push(on),
      });
      board.destroy();

      expect(() => board.setFullDiagram(true)).not.toThrow();

      expect(changes).toEqual([]);
      expect(board.fullDiagram).toBe(false);
      expect(container.children).toHaveLength(0);
    });

    describe("the built-in bar's Full diagram button", () => {
      /** Which of the bar's buttons are disabled, by name. */
      function disabledButtons(container: HTMLElement): string[] {
        return Array.from(container.querySelectorAll<HTMLButtonElement>(".siren-board-controls button"))
          .filter((b) => b.disabled)
          .map((b) => b.getAttribute("aria-label")!);
      }

      it("shows the icon of what a click switches to, and swaps it on every switch, from the bar or from code", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
        const icon = () => button(container, "Full diagram").querySelector("svg")!.outerHTML;
        const offIcon = icon();

        button(container, "Full diagram").click();
        const onIcon = icon();
        expect(onIcon).not.toBe(offIcon);

        board.setFullDiagram(false);
        expect(icon()).toBe(offIcon);
        expect(button(container, "Full diagram").querySelectorAll("svg")).toHaveLength(1);
      });

      it("one click switches the full diagram on, presses the button, and disables Prev, Play, Next and Reset but not Reset view", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("false");
        expect(disabledButtons(container)).toEqual(["Prev", "Reset"]); // step 0: nothing to go back to

        button(container, "Full diagram").click();

        expect(board.fullDiagram).toBe(true);
        expect(effectClasses(container)).toEqual([]);
        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("true");
        expect(disabledButtons(container)).toEqual(["Prev", "Play", "Next", "Reset"]);
      });

      it("a second click switches it back off, releases the button, re-enables every button, and returns to the step shown before", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
        button(container, "Next").click();
        button(container, "Full diagram").click();

        button(container, "Full diagram").click();

        expect(board.fullDiagram).toBe(false);
        expect(board.controller!.currentStep).toBe(1);
        expect(board.controller!.totalSteps).toBe(2);
        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("false");
        expect(disabledButtons(container)).toEqual([]);
      });

      it("hands focus from a step button to Full diagram when a switch from code disables it", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });
        const next = container.querySelector<HTMLButtonElement>('[aria-label="Next"]')!;
        next.focus();
        expect(document.activeElement).toBe(next); // sanity

        board.setFullDiagram(true);

        expect(document.activeElement).toBe(container.querySelector('[aria-label="Full diagram"]'));
        board.destroy();
        container.remove();
      });

      it("follows board.setFullDiagram called from code, in both directions", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: TIMELINE_SOURCE, measureText: FAKE_MEASURER });

        board.setFullDiagram(true);

        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("true");
        expect(disabledButtons(container)).toEqual(["Prev", "Play", "Next", "Reset"]);

        board.setFullDiagram(false);

        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("false");
        expect(disabledButtons(container)).toEqual(["Prev", "Reset"]); // back on step 0
      });

      it("without the built-in bar — controls: false or a custom factory with no update — stepping and setFullDiagram still work and fire", () => {
        for (const controls of [false, () => ({ element: document.createElement("div") })]) {
          const container = document.createElement("div");
          const changes: boolean[] = [];
          const board = createBoard(container, {
            source: TIMELINE_SOURCE,
            measureText: FAKE_MEASURER,
            controls,
            onFullDiagramChange: (on) => changes.push(on),
          });

          board.controller!.next();
          board.setFullDiagram(true);
          board.setFullDiagram(false);

          expect(changes).toEqual([true, false]);
          expect(board.controller!.currentStep).toBe(1);
          expect(board.fullDiagram).toBe(false);
          expect(board.controller!.totalSteps).toBe(2);
        }
      });

      it("stays usable on a document with no timeline", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
        expect(board.controller!.totalSteps).toBe(0); // sanity: nothing to step through
        expect(button(container, "Full diagram").disabled).toBe(false);

        button(container, "Full diagram").click();

        expect(board.fullDiagram).toBe(true);
        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("true");

        button(container, "Full diagram").click();

        expect(board.fullDiagram).toBe(false);
        expect(button(container, "Full diagram").getAttribute("aria-pressed")).toBe("false");
      });
    });
  });

  describe("a ControlsFactory's update()", () => {
    /** Two steps, so a step change has somewhere to go in both directions. */
    const TWO_STEP_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter B fade
enter C fade
`;

    /** What the board shows, as a custom bar would read it inside update(). */
    type Seen = { total: number | null; current: number | null; fullDiagram: boolean };

    /** A custom factory whose update() records what it sees on the board each time it is called. */
    function recordingControls(seen: Seen[]) {
      return (board: Board) => ({
        element: document.createElement("div"),
        update() {
          seen.push({
            total: board.controller?.totalSteps ?? null,
            current: board.controller?.currentStep ?? null,
            fullDiagram: board.fullDiagram,
          });
        },
      });
    }

    it("is called once after every setSource that renders, and not after one that fails", () => {
      const seen: Seen[] = [];
      const board = createBoard(document.createElement("div"), {
        measureText: FAKE_MEASURER,
        controls: recordingControls(seen),
      });
      expect(seen).toEqual([]); // nothing has changed yet

      board.setSource(TWO_STEP_SOURCE);
      expect(seen).toEqual([{ total: 2, current: 0, fullDiagram: false }]);

      board.setSource("this is not a valid siren document");
      expect(seen).toHaveLength(1);

      board.setSource(VALID_SOURCE);
      expect(seen).toEqual([
        { total: 2, current: 0, fullDiagram: false },
        { total: 0, current: 0, fullDiagram: false },
      ]);
    });

    it("is called once after every step change, including a direct board.controller call, and not after a call that changes nothing", () => {
      const seen: Seen[] = [];
      const board = createBoard(document.createElement("div"), {
        source: TWO_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        controls: recordingControls(seen),
      });
      seen.length = 0; // drop the construction-time setSource

      board.controller!.next();
      board.controller!.next();
      board.controller!.next(); // already at the last step
      board.controller!.prev();
      board.controller!.reset();
      board.controller!.reset(); // already at step 0

      expect(seen.map((s) => s.current)).toEqual([1, 2, 1, 0]);
    });

    it("is called once after every fullDiagram switch, and not after setting the value it already has", () => {
      const seen: Seen[] = [];
      const board = createBoard(document.createElement("div"), {
        source: TWO_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        controls: recordingControls(seen),
      });
      board.controller!.next();
      seen.length = 0; // drop the setSource and the step

      board.setFullDiagram(true);
      board.setFullDiagram(true); // no change
      board.setFullDiagram(false);

      expect(seen).toEqual([
        { total: 0, current: 0, fullDiagram: true },
        { total: 2, current: 1, fullDiagram: false },
      ]);
    });

    it("is never called after destroy(), whatever is called on the board afterwards", () => {
      const seen: Seen[] = [];
      const board = createBoard(document.createElement("div"), {
        source: TWO_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        controls: recordingControls(seen),
      });
      const controller = board.controller!;
      seen.length = 0; // drop the construction-time setSource

      board.destroy();
      controller.next();
      board.setSource(VALID_SOURCE);
      board.setFullDiagram(true);

      expect(seen).toEqual([]);
    });
  });

  describe("the built-in bar's step counter", () => {
    /** Two steps, so the counter has somewhere to go in both directions. */
    const TWO_STEP_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter B fade
enter C fade
`;

    /** The counter's text, as a reader sees it. */
    function counter(container: HTMLElement): string | null {
      return container.querySelector(".siren-board-controls .siren-board-controls__step")?.textContent ?? null;
    }

    it("sits between Next and Reset and starts at 0 of the timeline's steps, as plain text rather than a live region", () => {
      const container = document.createElement("div");

      createBoard(container, { source: TWO_STEP_SOURCE, measureText: FAKE_MEASURER });

      expect(counter(container)).toBe("0 / 2");
      const step = container.querySelector(".siren-board-controls__step")!;
      expect(step.previousElementSibling?.getAttribute("aria-label")).toBe("Next");
      expect(step.nextElementSibling?.getAttribute("aria-label")).toBe("Reset");
      // Playback changes it on every step: announcing each one would talk over the reader.
      expect(step.hasAttribute("aria-live")).toBe(false);
      expect(step.hasAttribute("role")).toBe(false);
    });

    it("follows every step change: Next, Prev and Reset from the bar, a direct board.controller call, and setSource", () => {
      const container = document.createElement("div");
      const board = createBoard(container, { source: TWO_STEP_SOURCE, measureText: FAKE_MEASURER });
      const click = (label: string) =>
        container.querySelector<HTMLButtonElement>(`.siren-board-controls button[aria-label="${label}"]`)!.click();

      click("Next");
      expect(counter(container)).toBe("1 / 2");
      click("Next");
      expect(counter(container)).toBe("2 / 2");
      click("Prev");
      expect(counter(container)).toBe("1 / 2");
      click("Reset");
      expect(counter(container)).toBe("0 / 2");

      board.controller!.next();
      expect(counter(container)).toBe("1 / 2");

      board.setSource(`flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter B fade
enter C fade
highlight A outline
`);
      expect(counter(container)).toBe("0 / 3");
    });

    it("follows playback, one step per play interval", () => {
      vi.useFakeTimers();
      try {
        const container = document.createElement("div");
        const board = createBoard(container, { source: TWO_STEP_SOURCE, measureText: FAKE_MEASURER });

        board.play();
        expect(counter(container)).toBe("1 / 2");

        vi.advanceTimersByTime(board.playInterval);
        expect(counter(container)).toBe("2 / 2");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads 0 / 0 in the full diagram, and the step shown before once switched back", () => {
      const container = document.createElement("div");
      const board = createBoard(container, { source: TWO_STEP_SOURCE, measureText: FAKE_MEASURER });
      board.controller!.next();

      board.setFullDiagram(true);
      expect(counter(container)).toBe("0 / 0");

      board.setFullDiagram(false);
      expect(counter(container)).toBe("1 / 2");
    });

    it("reads 0 / 0, in the same place, on a document with no timeline and on a board whose render failed", () => {
      const noTimeline = document.createElement("div");
      createBoard(noTimeline, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
      expect(counter(noTimeline)).toBe("0 / 0");

      const failed = document.createElement("div");
      const board = createBoard(failed, { source: "this is not a valid siren document", measureText: FAKE_MEASURER });
      expect(board.controller).toBeNull(); // sanity: nothing rendered
      expect(counter(failed)).toBe("0 / 0");
      const step = failed.querySelector(".siren-board-controls__step")!;
      expect(step.previousElementSibling?.getAttribute("aria-label")).toBe("Next");
      expect(step.nextElementSibling?.getAttribute("aria-label")).toBe("Reset");
      // With no controller there is nowhere to step: every step button is off.
      expect(["Prev", "Next", "Reset"].filter((label) => button(failed, label).disabled)).toEqual([
        "Prev",
        "Next",
        "Reset",
      ]);
    });
  });

  describe("the built-in bar's step buttons", () => {
    /** Two steps, so there is a step strictly between the first and the last. */
    const TWO_STEP_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter B fade
enter C fade
`;

    /** Which of Prev, Play, Next and Reset are disabled, by name. */
    function disabledStepButtons(container: HTMLElement): string[] {
      return ["Prev", "Play", "Next", "Reset"].filter((label) => button(container, label).disabled);
    }

    it("disables Prev and Reset on step 0, whether reached at construction, by Reset, by a direct board.controller call or by setSource, and enables every step button on a middle step", () => {
      const container = document.createElement("div");
      const board = createBoard(container, { source: TWO_STEP_SOURCE, measureText: FAKE_MEASURER });
      expect(disabledStepButtons(container)).toEqual(["Prev", "Reset"]);

      button(container, "Next").click();
      expect(disabledStepButtons(container)).toEqual([]);

      button(container, "Reset").click();
      expect(disabledStepButtons(container)).toEqual(["Prev", "Reset"]);

      board.controller!.next();
      expect(disabledStepButtons(container)).toEqual([]);
      board.controller!.prev();
      expect(disabledStepButtons(container)).toEqual(["Prev", "Reset"]);

      board.controller!.next();
      board.setSource(TWO_STEP_SOURCE);
      expect(disabledStepButtons(container)).toEqual(["Prev", "Reset"]);
    });

    it("disables Next, but not Play, on the last step, whether reached by Next, by a direct board.controller call or by playback", () => {
      vi.useFakeTimers();
      try {
        const container = document.createElement("div");
        const board = createBoard(container, { source: TWO_STEP_SOURCE, measureText: FAKE_MEASURER });

        button(container, "Next").click();
        button(container, "Next").click();
        expect(disabledStepButtons(container)).toEqual(["Next"]);
        button(container, "Prev").click();
        expect(disabledStepButtons(container)).toEqual([]);

        board.controller!.next();
        expect(disabledStepButtons(container)).toEqual(["Next"]);

        board.controller!.reset();
        board.play();
        expect(disabledStepButtons(container)).toEqual([]); // step 1, mid-playback
        vi.advanceTimersByTime(board.playInterval);
        expect(board.controller!.currentStep).toBe(2); // sanity: played to the end
        expect(disabledStepButtons(container)).toEqual(["Next"]);
      } finally {
        vi.useRealTimers();
      }
    });

    describe("focus handoff", () => {
      /** One step, so Next on step 0 goes straight to the last step. */
      const ONE_STEP_SOURCE = `flowchart TD
A[Start] --> B[End]
timeline:
enter B fade
`;

      let container: HTMLElement;
      beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
      });
      afterEach(() => container.remove());

      it("hands focus from Next to Prev when reaching the last step disables Next, even though Prev was disabled the step before", () => {
        const board = createBoard(container, { source: ONE_STEP_SOURCE, measureText: FAKE_MEASURER });
        button(container, "Next").focus();
        expect(document.activeElement).toBe(button(container, "Next")); // sanity

        button(container, "Next").click();

        expect(document.activeElement).toBe(button(container, "Prev"));
        board.destroy();
      });

      it("hands focus from Prev to Next when going back to step 0 disables Prev, even though Next was disabled the step before", () => {
        const board = createBoard(container, { source: ONE_STEP_SOURCE, measureText: FAKE_MEASURER });
        board.controller!.next();
        button(container, "Prev").focus();
        expect(document.activeElement).toBe(button(container, "Prev")); // sanity

        button(container, "Prev").click();

        expect(document.activeElement).toBe(button(container, "Next"));
        board.destroy();
      });

      it("hands focus from Reset to Next when a click on Reset disables it", () => {
        const board = createBoard(container, { source: ONE_STEP_SOURCE, measureText: FAKE_MEASURER });
        board.controller!.next();
        button(container, "Reset").focus();
        expect(document.activeElement).toBe(button(container, "Reset")); // sanity

        button(container, "Reset").click();

        expect(document.activeElement).toBe(button(container, "Next"));
        board.destroy();
      });

      it("falls back to Full diagram when the button focus would go to is disabled too: Reset on a setSource with no timeline", () => {
        const board = createBoard(container, { source: ONE_STEP_SOURCE, measureText: FAKE_MEASURER });
        board.controller!.next();
        button(container, "Reset").focus();
        expect(document.activeElement).toBe(button(container, "Reset")); // sanity

        board.setSource(VALID_SOURCE);

        expect(disabledStepButtons(container)).toEqual(["Prev", "Play", "Next", "Reset"]); // 0 / 0
        expect(document.activeElement).toBe(button(container, "Full diagram"));
        board.destroy();
      });
    });
  });

  describe("playback", () => {
    /** Three steps, so playback has a middle step to pass through on its way to the last. */
    const THREE_STEP_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter B fade
enter C fade
highlight A outline
`;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("from step 0, play() steps at once, then once per play interval, and stops by itself on the last step", () => {
      const playback: boolean[] = [];
      const steps: number[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
        onStepChange: (current) => steps.push(current),
      });

      board.play();
      expect(board.playing).toBe(true);
      expect(board.controller!.currentStep).toBe(1);

      vi.advanceTimersByTime(1999);
      expect(board.controller!.currentStep).toBe(1); // the default interval is 2000 ms
      vi.advanceTimersByTime(1);
      expect(board.controller!.currentStep).toBe(2);
      expect(board.playing).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(board.controller!.currentStep).toBe(3);
      expect(board.playing).toBe(false);

      vi.advanceTimersByTime(10000);
      expect(board.controller!.currentStep).toBe(3);
      expect(playback).toEqual([true, false]);
      expect(steps).toEqual([1, 2, 3]); // playback's own steps fire onStepChange
    });

    it("on the last step, play() goes back to step 0 at once and takes step 1 one interval later", () => {
      const playback: boolean[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
      });
      board.controller!.next();
      board.controller!.next();
      board.controller!.next();

      board.play();
      expect(board.controller!.currentStep).toBe(0);
      expect(board.playing).toBe(true);
      expect(playback).toEqual([true]);

      vi.advanceTimersByTime(1999);
      expect(board.controller!.currentStep).toBe(0);
      vi.advanceTimersByTime(1);
      expect(board.controller!.currentStep).toBe(1);
      expect(board.playing).toBe(true);
    });

    it("play() does nothing — no callback, no throw — before the first render, without steps, in the full diagram, or while already playing", () => {
      const playback: boolean[] = [];
      const onPlaybackChange = (playing: boolean) => playback.push(playing);

      const empty = createBoard(document.createElement("div"), { measureText: FAKE_MEASURER, onPlaybackChange });
      empty.play();
      expect(empty.playing).toBe(false);

      const stepless = createBoard(document.createElement("div"), {
        source: VALID_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange,
      });
      stepless.play();
      expect(stepless.playing).toBe(false);

      const full = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange,
      });
      full.setFullDiagram(true);
      full.play();
      expect(full.playing).toBe(false);
      vi.advanceTimersByTime(10000);
      expect(playback).toEqual([]);

      const playing = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange,
      });
      playing.play();
      playing.play();
      expect(playing.controller!.currentStep).toBe(1);
      expect(playback).toEqual([true]);
    });

    it("pause() stops playback where it is, and does nothing when not playing", () => {
      const playback: boolean[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
      });
      board.pause();
      expect(playback).toEqual([]);

      board.play();
      board.pause();
      expect(board.playing).toBe(false);
      vi.advanceTimersByTime(10000);
      expect(board.controller!.currentStep).toBe(1);
      expect(playback).toEqual([true, false]);

      board.pause();
      expect(playback).toEqual([true, false]);
    });

    it.each(["next", "prev", "reset"] as const)(
      "a step changed by board.controller.%s() during playback stops it, and the step stays where it was put",
      (method) => {
        const playback: boolean[] = [];
        const board = createBoard(document.createElement("div"), {
          source: THREE_STEP_SOURCE,
          measureText: FAKE_MEASURER,
          onPlaybackChange: (playing) => playback.push(playing),
        });
        board.play(); // at step 1, so next, prev and reset all change the step

        board.controller![method]();
        const stepAfterCall = board.controller!.currentStep;

        expect(board.playing).toBe(false);
        expect(playback).toEqual([true, false]);
        vi.advanceTimersByTime(10000);
        expect(board.controller!.currentStep).toBe(stepAfterCall);
      },
    );

    it.each([
      ["renders", THREE_STEP_SOURCE],
      ["fails", "this is not a valid siren document"],
    ])("a setSource call that %s stops playback", (_, source) => {
      const playback: boolean[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
      });
      board.play();

      board.setSource(source);
      const stepAfterSetSource = board.controller!.currentStep;

      expect(board.playing).toBe(false);
      expect(playback).toEqual([true, false]);
      vi.advanceTimersByTime(10000);
      expect(board.controller!.currentStep).toBe(stepAfterSetSource);
    });

    it("switching to the full diagram stops playback, and switching back does not resume it", () => {
      const playback: boolean[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
      });
      board.play();

      board.setFullDiagram(true);
      expect(board.playing).toBe(false);
      expect(playback).toEqual([true, false]);

      vi.advanceTimersByTime(10000);
      board.setFullDiagram(false);
      expect(board.controller!.currentStep).toBe(1);
      expect(board.playing).toBe(false);
    });

    it("destroy() during playback takes no further step and fires no callback", () => {
      const playback: boolean[] = [];
      const steps: number[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
        onStepChange: (current) => steps.push(current),
      });
      board.play();
      const controller = board.controller!;

      board.destroy();
      vi.advanceTimersByTime(10000);

      expect(controller.currentStep).toBe(1);
      expect(steps).toEqual([1]);
      expect(playback).toEqual([true]);
    });

    it.each([
      // A destroyed board reports nothing more, so it never fires the closing `false`.
      ["pause()", (board: Board) => board.pause(), [true, false]],
      ["destroy()", (board: Board) => board.destroy(), [true]],
      ["setSource()", (board: Board) => board.setSource(THREE_STEP_SOURCE), [true, false]],
      ["setFullDiagram(true)", (board: Board) => board.setFullDiagram(true), [true, false]],
    ])("%s called from onStepChange during playback stops it for good", (_, stop, expectedPlayback) => {
      const playback: boolean[] = [];
      const steps: number[] = [];
      let board: Board | undefined;
      board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
        onStepChange: (current) => {
          steps.push(current);
          if (current === 1) stop(board!);
        },
      });

      board.play();
      vi.advanceTimersByTime(10000);

      expect(board.playing).toBe(false);
      expect(playback).toEqual(expectedPlayback);
      expect(steps).toEqual([1]);
    });

    it("pause() called from onPlaybackChange(true) stops play() before it steps", () => {
      const steps: number[] = [];
      let board: Board | undefined;
      board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => {
          if (playing) board!.pause();
        },
        onStepChange: (current) => steps.push(current),
      });

      board.play();
      vi.advanceTimersByTime(10000);

      expect(board.playing).toBe(false);
      expect(steps).toEqual([]);
    });

    it("play() after destroy() does nothing", () => {
      const playback: boolean[] = [];
      const steps: number[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
        onStepChange: (current) => steps.push(current),
      });
      board.destroy();

      board.play();
      vi.advanceTimersByTime(10000);

      expect(board.playing).toBe(false);
      expect(playback).toEqual([]);
      expect(steps).toEqual([]);
    });

    it("setPlayInterval() during playback times the next step from the moment it is called", () => {
      const board = createBoard(document.createElement("div"), { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER });
      board.play();
      vi.advanceTimersByTime(1500); // 500 ms short of the default 2000

      board.setPlayInterval(1000);
      expect(board.playInterval).toBe(1000);

      vi.advanceTimersByTime(999);
      expect(board.controller!.currentStep).toBe(1);
      vi.advanceTimersByTime(1);
      expect(board.controller!.currentStep).toBe(2);
      vi.advanceTimersByTime(1000);
      expect(board.controller!.currentStep).toBe(3);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "setPlayInterval(%s) throws a RangeError and keeps the interval it had",
      (ms) => {
        const board = createBoard(document.createElement("div"), { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER });

        expect(() => board.setPlayInterval(ms)).toThrow(RangeError);
        expect(board.playInterval).toBe(2000);
      },
    );

    it("BoardOptions.playInterval sets the interval playback steps by", () => {
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        playInterval: 500,
      });
      expect(board.playInterval).toBe(500);

      board.play();
      vi.advanceTimersByTime(500);
      expect(board.controller!.currentStep).toBe(2);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "createBoard with playInterval %s throws a RangeError and mounts nothing",
      (playInterval) => {
        const container = document.createElement("div");

        expect(() => createBoard(container, { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER, playInterval })).toThrow(
          RangeError,
        );
        expect(container.childNodes).toHaveLength(0);
        expect(container.classList.contains("siren-board")).toBe(false);
      },
    );

    it("a ControlsFactory's update() sees every change to playing and playInterval", () => {
      const seen: { playing: boolean; playInterval: number }[] = [];
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        controls: (b) => ({
          element: document.createElement("div"),
          update: () => seen.push({ playing: b.playing, playInterval: b.playInterval }),
        }),
      });

      board.play();
      expect(seen).toContainEqual({ playing: true, playInterval: 2000 });

      board.setPlayInterval(1000);
      expect(seen.at(-1)).toEqual({ playing: true, playInterval: 1000 });

      board.pause();
      expect(seen.at(-1)).toEqual({ playing: false, playInterval: 1000 });

      board.setPlayInterval(3000); // not playing: the bar still shows the interval
      expect(seen.at(-1)).toEqual({ playing: false, playInterval: 3000 });
    });

    it("a ControlsFactory's update() is not called by setPlayInterval with the interval it already has", () => {
      let updates = 0;
      const board = createBoard(document.createElement("div"), {
        source: THREE_STEP_SOURCE,
        measureText: FAKE_MEASURER,
        controls: () => ({ element: document.createElement("div"), update: () => updates++ }),
      });
      updates = 0; // drop the construction-time setSource

      board.setPlayInterval(2000);

      expect(updates).toBe(0);
    });

    describe("the built-in bar's Play button and interval select", () => {
      /** The built-in bar's control with this accessible name. */
      function control<T extends HTMLElement = HTMLButtonElement>(container: HTMLElement, label: string): T {
        return container.querySelector<T>(`.siren-board-controls [aria-label="${label}"]`)!;
      }

      it("a click plays, presses the button and swaps its icon to pause; a second click pauses and swaps it back", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER });
        const play = control(container, "Play");
        const icon = () => play.querySelector("svg")!.outerHTML;
        expect(play.title).toBe("Play");
        expect(play.getAttribute("aria-pressed")).toBe("false");
        const playIcon = icon();

        play.click();

        expect(board.playing).toBe(true);
        expect(board.controller!.currentStep).toBe(1);
        expect(play.getAttribute("aria-pressed")).toBe("true");
        const pauseIcon = icon();
        expect(pauseIcon).not.toBe(playIcon);
        expect(play.querySelectorAll("svg")).toHaveLength(1);

        play.click();

        expect(board.playing).toBe(false);
        expect(board.controller!.currentStep).toBe(1);
        expect(play.getAttribute("aria-pressed")).toBe("false");
        expect(icon()).toBe(playIcon);
      });

      it("is released by itself when playback reaches the last step, and when a click on Next interrupts it", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER });
        const play = control(container, "Play");

        play.click();
        vi.advanceTimersByTime(4000);

        expect(board.controller!.currentStep).toBe(3);
        expect(board.playing).toBe(false);
        expect(play.getAttribute("aria-pressed")).toBe("false");

        play.click(); // from the last step: back to step 0
        expect(play.getAttribute("aria-pressed")).toBe("true");

        control(container, "Next").click();

        expect(board.playing).toBe(false);
        expect(board.controller!.currentStep).toBe(1);
        expect(play.getAttribute("aria-pressed")).toBe("false");
      });

      it("the interval select offers 1s, 1.5s, 2s, 3s and 5s with 2s selected, and choosing one sets the play interval", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER });
        const select = control<HTMLSelectElement>(container, "Play interval");

        expect(Array.from(select.options).map((o) => [o.textContent, o.value])).toEqual([
          ["1s", "1000"],
          ["1.5s", "1500"],
          ["2s", "2000"],
          ["3s", "3000"],
          ["5s", "5000"],
        ]);
        expect(select.value).toBe("2000");

        select.value = "1500";
        select.dispatchEvent(new Event("change"));

        expect(board.playInterval).toBe(1500);
      });

      it("an interval the select does not offer — the playInterval option or setPlayInterval from code — gets an option of its own, in order, and is selected", () => {
        const container = document.createElement("div");
        const board = createBoard(container, {
          source: THREE_STEP_SOURCE,
          measureText: FAKE_MEASURER,
          playInterval: 2500,
        });
        const select = control<HTMLSelectElement>(container, "Play interval");
        const labels = () => Array.from(select.options).map((o) => o.textContent);

        expect(labels()).toEqual(["1s", "1.5s", "2s", "2.5s", "3s", "5s"]);
        expect(select.value).toBe("2500");
        expect(select.selectedOptions[0].textContent).toBe("2.5s");

        board.setPlayInterval(750);

        expect(labels()).toEqual(["0.75s", "1s", "1.5s", "2s", "3s", "5s"]);
        expect(select.value).toBe("750");

        board.setPlayInterval(3000);

        expect(labels()).toEqual(["1s", "1.5s", "2s", "3s", "5s"]);
        expect(select.value).toBe("3000");
      });

      it("Play and the interval select are disabled with nothing to play — before the first render, without steps, in the full diagram — and enabled again once there is", () => {
        const container = document.createElement("div");
        const board = createBoard(container, { measureText: FAKE_MEASURER });
        const play = control(container, "Play");
        const select = control<HTMLSelectElement>(container, "Play interval");
        const disabled = () => [play.disabled, select.disabled];
        expect(disabled()).toEqual([true, true]); // no controller yet

        board.setSource(VALID_SOURCE);
        expect(board.controller!.totalSteps).toBe(0); // sanity
        expect(disabled()).toEqual([true, true]);

        board.setSource(THREE_STEP_SOURCE);
        expect(disabled()).toEqual([false, false]);

        board.setFullDiagram(true);
        expect(disabled()).toEqual([true, true]);

        control(container, "Full diagram").click();
        expect(disabled()).toEqual([false, false]);
      });

      it("hands focus from Play or the interval select to Full diagram when a change from code disables it", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const board = createBoard(container, { source: THREE_STEP_SOURCE, measureText: FAKE_MEASURER });
        const fullDiagram = control(container, "Full diagram");

        control(container, "Play").focus();
        expect(document.activeElement).toBe(control(container, "Play")); // sanity
        board.setFullDiagram(true);
        expect(document.activeElement).toBe(fullDiagram);

        board.setFullDiagram(false);
        control<HTMLSelectElement>(container, "Play interval").focus();
        board.setSource(VALID_SOURCE); // no steps: nothing to play
        expect(document.activeElement).toBe(fullDiagram);

        board.destroy();
        container.remove();
      });
    });

    it("when play()'s immediate step is already the last, onPlaybackChange fires true and then false", () => {
      const playback: boolean[] = [];
      const board = createBoard(document.createElement("div"), {
        source: `flowchart TD
A[Start] --> B[End]
timeline:
enter B fade
`,
        measureText: FAKE_MEASURER,
        onPlaybackChange: (playing) => playback.push(playing),
      });

      board.play();

      expect(board.controller!.currentStep).toBe(1);
      expect(board.playing).toBe(false);
      expect(playback).toEqual([true, false]);
    });
  });
});
