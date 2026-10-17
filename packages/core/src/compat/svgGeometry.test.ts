import { describe, expect, it } from "vitest";
import {
  distanceToPolyline,
  ER_SUBGRAPH,
  frameOutline,
  holds,
  rectBox,
  routeOf,
  subgraphFrames,
} from "./svgGeometry";

const SVG_NS = "http://www.w3.org/2000/svg";

/** An `<svg>` holding exactly the markup given — a picture with known answers. */
function svgOf(markup: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.innerHTML = markup;
  return svg;
}

describe("rectBox", () => {
  it("reads a rect's four sides off x, y, width and height", () => {
    const rect = svgOf(`<rect x="10" y="20" width="30" height="40"/>`).querySelector("rect")!;

    expect(rectBox(rect)).toEqual({ top: 20, bottom: 60, left: 10, right: 40 });
  });
});

describe("subgraphFrames", () => {
  it("reads each subgraph frame by the title drawn on it, in draw order", () => {
    const svg = svgOf(
      `<g class="siren-subgraph">` +
        `<rect class="siren-subgraph-frame" x="0" y="0" width="100" height="50"/>` +
        `<text class="siren-subgraph-label">one</text></g>` +
        // A group drawn without its frame: kept, with no box.
        `<g class="siren-subgraph"><text class="siren-subgraph-label">bare</text></g>` +
        `<g class="siren-subgraph">` +
        `<rect class="siren-subgraph-frame" x="5" y="5" width="10" height="10"/>` +
        `<text class="siren-subgraph-label">two</text></g>`,
    );

    expect(subgraphFrames(svg)).toEqual([
      { title: "one", box: { top: 0, bottom: 50, left: 0, right: 100 } },
      { title: "bare", box: null },
      { title: "two", box: { top: 5, bottom: 15, left: 5, right: 15 } },
    ]);
  });

  it("reads another kind's groups by that kind's selectors", () => {
    const svg = svgOf(
      `<g class="siren-subgraph">` +
        `<rect class="siren-subgraph-frame" x="0" y="0" width="100" height="50"/>` +
        `<text class="siren-subgraph-label">flowchart</text></g>` +
        `<g class="siren-er-subgraph">` +
        `<rect class="siren-er-subgraph-frame" x="1" y="2" width="3" height="4"/>` +
        `<text class="siren-er-subgraph-label">sales</text></g>`,
    );

    expect(subgraphFrames(svg, ER_SUBGRAPH)).toEqual([
      { title: "sales", box: { top: 2, bottom: 6, left: 1, right: 4 } },
    ]);
  });
});

describe("holds", () => {
  const box = { top: 0, bottom: 10, left: 0, right: 10 };

  it("counts the outline as in", () => {
    expect(holds(box, { x: 10, y: 5 }, 0)).toBe(true);
  });

  it("allows exactly the tolerance it is given past the outline", () => {
    expect(holds(box, { x: 10.5, y: 5 }, 0)).toBe(false);
    expect(holds(box, { x: 10.5, y: 5 }, 1)).toBe(true);
  });
});

describe("routeOf", () => {
  it("reads the route off data-siren-points, not off the curve in d", () => {
    const path = svgOf(
      `<path d="M0,0 C1,1 2,2 3,3" data-siren-points="0,0 10,20 30,40"/>`,
    ).querySelector("path")!;

    expect(routeOf(path)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it("throws for a connector that carries no route", () => {
    const path = svgOf(`<path class="siren-edge" d="M0,0 L1,1"/>`).querySelector("path")!;

    expect(() => routeOf(path)).toThrow(/carries no data-siren-points/);
  });
});

describe("distanceToPolyline", () => {
  // An L: down x = 0 from (0,0) to (0,10), then along y = 10 to (10,10).
  const route = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];

  it("measures to the nearest segment, square to it", () => {
    expect(distanceToPolyline({ x: 3, y: 4 }, route)).toBe(3);
    expect(distanceToPolyline({ x: 5, y: 14 }, route)).toBe(4);
  });

  it("measures past a segment's end to that end", () => {
    // Beyond (10,10) along the second leg: 3-4-5 from that corner.
    expect(distanceToPolyline({ x: 13, y: 14 }, route)).toBe(5);
  });

  it("is zero on the line", () => {
    expect(distanceToPolyline({ x: 0, y: 7 }, route)).toBe(0);
  });
});

/** The one element `markup` draws. */
function elementOf(markup: string): Element {
  return svgOf(markup).firstElementChild!;
}

const pt = (x: number, y: number) => ({ x, y });

describe("frameOutline, of a frame drawn with straight lines", () => {
  it("reads a square-cornered rect as its four sides, closed", () => {
    expect(frameOutline(elementOf(`<rect x="10" y="20" width="30" height="40"/>`))).toEqual([
      [pt(10, 20), pt(40, 20), pt(40, 60), pt(10, 60), pt(10, 20)],
    ]);
  });

  it("reads a polygon through its points, closed", () => {
    expect(frameOutline(elementOf(`<polygon points="5,0 10,5 5,10 0,5"/>`))).toEqual([
      [pt(5, 0), pt(10, 5), pt(5, 10), pt(0, 5), pt(5, 0)],
    ]);
  });

  it("reads a line as its one segment", () => {
    expect(frameOutline(elementOf(`<line x1="1" y1="2" x2="3" y2="4"/>`))).toEqual([[pt(1, 2), pt(3, 4)]]);
  });

  it("reads a path's subpaths, absolute and relative, each closed where it says Z", () => {
    expect(
      frameOutline(elementOf(`<path d="M0,0 L10,0 H20 V5 Z M30,30 l5,0 h5 v5"/>`)),
    ).toEqual([
      [pt(0, 0), pt(10, 0), pt(20, 0), pt(20, 5), pt(0, 0)],
      [pt(30, 30), pt(35, 30), pt(40, 30), pt(40, 35)],
    ]);
  });
});

/** How far `point` stands from the nearest of `outline`'s polylines. */
function offOutline(point: { x: number; y: number }, outline: { x: number; y: number }[][]): number {
  return Math.min(...outline.map((line) => distanceToPolyline(point, line)));
}

/** The point at `degrees` (y down) on the circle about `cx,cy` of radius `r`. */
function onCircle(cx: number, cy: number, r: number, degrees: number) {
  const t = (degrees * Math.PI) / 180;
  return pt(cx + r * Math.cos(t), cy + r * Math.sin(t));
}

describe("frameOutline, of a frame drawn with curves", () => {
  // Sampled, so asked to within a tenth of a pixel rather than exactly.
  const NEAR = 0.1;

  it("samples a circle all the way round", () => {
    const outline = frameOutline(elementOf(`<circle cx="50" cy="50" r="10"/>`));

    for (const degrees of [0, 45, 100, 200, 315]) {
      expect(offOutline(onCircle(50, 50, 10, degrees), outline)).toBeLessThan(NEAR);
    }
    expect(offOutline(pt(60, 60), outline)).toBeGreaterThan(1);
  });

  it.each([
    ["a style declaration", `<rect x="0" y="0" width="40" height="20" style="rx:5px"/>`],
    ["an attribute", `<rect x="0" y="0" width="40" height="20" rx="5"/>`],
  ])("rounds a rect's corners given by %s", (_how, markup) => {
    const outline = frameOutline(elementOf(markup));

    // A side, away from the corners, is where it was.
    expect(offOutline(pt(20, 0), outline)).toBeLessThan(1e-9);
    expect(offOutline(pt(40, 10), outline)).toBeLessThan(1e-9);
    // Each corner is cut off by a quarter circle of radius 5.
    expect(offOutline(onCircle(5, 5, 5, 225), outline)).toBeLessThan(NEAR);
    expect(offOutline(onCircle(35, 15, 5, 45), outline)).toBeLessThan(NEAR);
    expect(offOutline(pt(0, 0), outline)).toBeGreaterThan(1);
    expect(offOutline(pt(40, 20), outline)).toBeGreaterThan(1);
  });

  it("takes the last radius a rect's style declares, as the cascade does", () => {
    // The shape's own radius first, an author's declaration after it.
    const outline = frameOutline(elementOf(`<rect x="0" y="0" width="40" height="20" style="rx:4px; rx:0"/>`));

    expect(outline).toEqual([[pt(0, 0), pt(40, 0), pt(40, 20), pt(0, 20), pt(0, 0)]]);
  });

  it.each([
    ["absolute", `<path d="M0,10 A10,10 0 0 1 20,10"/>`],
    ["relative", `<path d="M0,10 a10,10 0 0,1 20,0"/>`],
  ])("samples an arc spelled %s along the side its sweep flag names", (_how, markup) => {
    const outline = frameOutline(elementOf(markup));

    // Clockwise on screen from the left end to the right: over the top.
    expect(offOutline(pt(10, 0), outline)).toBeLessThan(NEAR);
    expect(offOutline(onCircle(10, 10, 10, 225), outline)).toBeLessThan(NEAR);
    expect(offOutline(pt(10, 20), outline)).toBeGreaterThan(1);
  });

  it("reads an arc that ends where it starts as no curve at all", () => {
    // SVG 1.1 F.6.2: an arc whose endpoints are identical is omitted.
    expect(frameOutline(elementOf(`<path d="M0,0 A5,5 0 0 1 0,0 L10,0"/>`))).toEqual([
      [pt(0, 0), pt(0, 0), pt(10, 0)],
    ]);
  });

  it("grows an arc whose radii cannot span its ends until they just do", () => {
    const outline = frameOutline(elementOf(`<path d="M0,0 a1,1 0 0,1 20,0"/>`));

    expect(offOutline(pt(10, -10), outline)).toBeLessThan(NEAR);
  });
});
