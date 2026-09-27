import { describe, expect, it, vi } from "vitest";
import { createBoard } from "./createBoard";

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

    const sourceWithWarningOnly = `flowchart TD
A[Start] --> B[End]
A[Different] --> B[End]
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

  it("renders a default Prev/Next/Reset/Reset view control bar unless controls: false is passed", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    const bar = container.querySelector(".siren-board-controls")!;
    expect(bar).not.toBeNull();
    const buttons = Array.from(bar.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Prev", "Next", "Reset", "Reset view"]);
    expect(buttons.map((b) => b.title)).toEqual(["Prev", "Next", "Reset", "Reset view"]);
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
step 1: enter B fade
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
step 1: enter B fade
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
step 1: enter B fade
step 2: enter C fade
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
});
