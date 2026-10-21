import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewport } from "./viewport";

/**
 * jsdom returns an all-zero rect by default (no real layout engine), which
 * makes viewport.ts's clamp collapse every pan/zoom to a no-op — give the
 * surface a controlled size so wheel and drag actually move the view.
 */
function stubRect(el: Element, rect: { width: number; height: number }): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width: rect.width,
    height: rect.height,
    left: 0,
    top: 0,
    right: rect.width,
    bottom: rect.height,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
}

/** The view as the content layer's inline transform states it. */
function readContentTransform(content: HTMLElement): { x: string; y: string; scale: string } {
  const match = content.style.transform.match(/^translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)$/);
  if (match === null) throw new Error(`unparseable viewport transform: "${content.style.transform}"`);
  return { x: `${match[1]}px`, y: `${match[2]}px`, scale: match[3]! };
}

/** The view as the surface's private custom properties publish it. */
function readViewVars(surface: HTMLElement): { x: string; y: string; scale: string } {
  return {
    x: surface.style.getPropertyValue("--_siren-board-view-x"),
    y: surface.style.getPropertyValue("--_siren-board-view-y"),
    scale: surface.style.getPropertyValue("--_siren-board-view-scale"),
  };
}

function makeSurface(): HTMLElement {
  const surface = document.createElement("div");
  document.body.appendChild(surface);
  stubRect(surface, { width: 400, height: 300 });
  return surface;
}

/** One wheel notch toward the reader, over a point inside the surface: zooms in, cursor-anchored. */
function zoomIn(surface: HTMLElement): void {
  surface.dispatchEvent(
    new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -500, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("createViewport publishes its view on the surface", () => {
  it("publishes the identity view (0px, 0px, 1) on creation", () => {
    const surface = makeSurface();
    createViewport(surface);

    expect(readViewVars(surface)).toEqual({ x: "0px", y: "0px", scale: "1" });
  });

  it("after a wheel zoom, publishes the same view the content's transform applies", () => {
    const surface = makeSurface();
    const viewport = createViewport(surface);

    zoomIn(surface);

    const transform = readContentTransform(viewport.content);
    expect(transform.scale).not.toBe("1"); // sanity: the wheel event actually zoomed
    expect(transform.x).not.toBe("0px"); // sanity: cursor-anchored zoom moved the offset too
    expect(readViewVars(surface)).toEqual(transform);
  });

  it("after a drag, publishes the same view the content's transform applies", () => {
    const surface = makeSurface();
    const viewport = createViewport(surface);

    surface.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 130 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 150, clientY: 130 }));

    const transform = readContentTransform(viewport.content);
    expect(transform).toEqual({ x: "50px", y: "30px", scale: "1" }); // sanity: within the margin band the delta applies directly
    expect(readViewVars(surface)).toEqual(transform);
  });

  it("resetView() publishes the identity view again", () => {
    const surface = makeSurface();
    const viewport = createViewport(surface);
    zoomIn(surface);
    expect(readViewVars(surface).scale).not.toBe("1"); // sanity: the view moved first

    viewport.resetView();

    expect(readViewVars(surface)).toEqual({ x: "0px", y: "0px", scale: "1" });
  });

  it("destroy() removes all three properties, leaving the surface as it found it", () => {
    const surface = makeSurface();
    const viewport = createViewport(surface);
    zoomIn(surface);

    viewport.destroy();

    expect(readViewVars(surface)).toEqual({ x: "", y: "", scale: "" });
    expect(surface.getAttribute("style") ?? "").not.toContain("--_siren-board-view");
  });
});
