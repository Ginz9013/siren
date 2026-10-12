import { describe, expect, it } from "vitest";
import {
  distanceToPolyline,
  ER_SUBGRAPH,
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
