import { describe, expect, it } from "vitest";
import type { Direction, GraphModel, GraphNode, NodeShape, Point, PositionedGraph, PositionedNode, TextMeasurer } from "../../contracts";
import { readLabel } from "../../label/readLabel";
import { renderToSVG } from "../../renderer/renderToSVG";
import { layoutGraph } from "../layoutGraph";
import { SHAPES } from "./shapeTable";

/**
 * Every shape's **outline** — the closed polygon a connector's end is
 * clipped to — through the shape table (`SHAPES[shape].outline`), read off
 * nodes `layoutGraph` laid out.
 *
 * Which outline a shape answers with follows Mermaid 12.2.0's `intersect`
 * for that shape's handler: the drawn outline for a polygon (the same
 * vertices the frame is drawn with), the curve sampled for a round or
 * elliptical one, and the box itself for a shape whose handler intersects
 * a rectangle — an invisible hit rectangle behind a brace, a window, or a
 * shape that draws no outline at all. A cloud and a bang are the exception:
 * Mermaid meets their box, Siren the arcs it draws, so an arrow touches the
 * figure.
 */

/** 8px a character, 24px a line. */
const fakeMeasurer: TextMeasurer = {
  measure: (text: string) => ({ width: text.length * 8, height: 24 }),
};

/** How far an outline may stand from where it belongs. */
const TOLERANCE = 0.5;

/**
 * Node `A`, laid out as `shape` with `text` (a `<br>` breaks a row) and
 * whatever else `extra` gives it, in a flow running `direction`.
 */
function laidOut(shape: NodeShape, text: string, extra: Partial<GraphNode> = {}, direction: Direction = "TB"): PositionedGraph {
  const graph: GraphModel = {
    direction,
    nodes: [
      {
        id: "A",
        label: readLabel(text, { dialect: "html" }).label,
        shape,
        style: { frame: [], text: [] },
        parentId: null,
        interaction: null,
        ...extra,
      },
    ],
    edges: [],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  };
  return layoutGraph(graph, { measureText: fakeMeasurer });
}

const nodeOf = (shape: NodeShape, text: string, extra: Partial<GraphNode> = {}, direction: Direction = "TB"): PositionedNode =>
  laidOut(shape, text, extra, direction).nodes[0]!;

const ICON = { name: "t:sq", form: null, pos: "b", size: 48 } as const;
const IMAGE = {
  src: "data:image/png;base64,iVBORw0KGgo=",
  naturalWidth: 40,
  naturalHeight: 20,
  w: null,
  h: null,
  constraint: false,
  pos: "b",
} as const;

/** What a shape needs beside its label to be laid out at all. */
function extraFor(shape: NodeShape): Partial<GraphNode> {
  if (shape === "icon") return { icon: { ...ICON } };
  if (shape === "image") return { image: { ...IMAGE } };
  return {};
}

const ALL_SHAPES = Object.keys(SHAPES) as NodeShape[];

/** The labels every shape is tried with: one short, one long and two rows tall. */
const LABELS = ["x", "A rather long label<br>and a second row"];

function outlineOf(node: PositionedNode): Point[] {
  return SHAPES[node.shape].outline(node);
}

/** The four corners of `node`'s box, sorted so two sets of corners compare equal. */
function corners(node: PositionedNode): Point[] {
  return sortPoints([
    { x: node.x, y: node.y },
    { x: node.x + node.width, y: node.y },
    { x: node.x + node.width, y: node.y + node.height },
    { x: node.x, y: node.y + node.height },
  ]);
}

function sortPoints(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Which side of the line through `a` and `b` the point `c` stands: positive, negative or on it. */
function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether the segments `a`–`b` and `c`–`d` cross at a point inside both (touching does not count). */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const EPS = 1e-9;
  const [d1, d2, d3, d4] = [turn(c, d, a), turn(c, d, b), turn(a, b, c), turn(a, b, d)];
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** The pairs of edges of the closed polygon `outline`, not next to each other, that cross. */
function selfCrossings(outline: Point[]): [number, number][] {
  const n = outline.length;
  const edge = (i: number) => [outline[i]!, outline[(i + 1) % n]!] as const;
  const found: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the closing edge meets the first
      if (crosses(...edge(i), ...edge(j))) found.push([i, j]);
    }
  }
  return found;
}

/** The shapes whose outline crosses itself because Mermaid draws them so: an hourglass's two diagonals. */
const SELF_CROSSING: ReadonlySet<NodeShape> = new Set(["hourglass"]);

/**
 * The shapes whose outline crosses itself exactly when the frame Mermaid
 * draws does: a bang so narrow for its height that the scallops down its
 * two sides dip past each other.
 */
const CROSSING_WHERE_DRAWN: ReadonlySet<NodeShape> = new Set(["bang"]);

describe("every shape's outline", () => {
  const cases = ALL_SHAPES.flatMap((shape) => LABELS.map((text) => [shape, text] as const));

  it.each(cases)("%s (%s) is a closed polygon inside the node's box", (shape, text) => {
    const node = nodeOf(shape, text, extraFor(shape));
    const outline = outlineOf(node);

    expect(outline.length).toBeGreaterThanOrEqual(3);
    // Closed by joining the last point to the first: the first is not
    // written again at the end, and no point repeats the one before it.
    const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
    expect(same(outline[0]!, outline.at(-1)!)).toBe(false);
    outline.forEach((point, i) => {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      if (i > 0) expect(same(point, outline[i - 1]!)).toBe(false);
      expect(point.x).toBeGreaterThanOrEqual(node.x - TOLERANCE);
      expect(point.x).toBeLessThanOrEqual(node.x + node.width + TOLERANCE);
      expect(point.y).toBeGreaterThanOrEqual(node.y - TOLERANCE);
      expect(point.y).toBeLessThanOrEqual(node.y + node.height + TOLERANCE);
    });
    // No two edges cross, but where Mermaid's own outline does.
    if (SELF_CROSSING.has(shape)) {
      expect(selfCrossings(outline)).not.toEqual([]);
    } else if (CROSSING_WHERE_DRAWN.has(shape)) {
      const drawn = sampledPath(firstFrameD(laidOut(shape, text, extraFor(shape))), 40);
      expect(selfCrossings(outline).length > 0).toBe(selfCrossings(drawn).length > 0);
    } else {
      expect(selfCrossings(outline)).toEqual([]);
    }
  });

  it.each([
    ["an icon in a square", { icon: { ...ICON, form: "square" } }],
    ["an icon in a rounded square", { icon: { ...ICON, form: "rounded" } }],
    ["an icon in a circle", { icon: { ...ICON, form: "circle" } }],
    ["an icon labelled above", { icon: { ...ICON, pos: "t" } }],
  ] as const)("%s is a closed polygon inside the node's box", (_name, extra) => {
    for (const text of ["", ...LABELS]) {
      const node = nodeOf("icon", text, extra);
      for (const point of outlineOf(node)) {
        expect(point.x).toBeGreaterThanOrEqual(node.x - TOLERANCE);
        expect(point.x).toBeLessThanOrEqual(node.x + node.width + TOLERANCE);
        expect(point.y).toBeGreaterThanOrEqual(node.y - TOLERANCE);
        expect(point.y).toBeLessThanOrEqual(node.y + node.height + TOLERANCE);
      }
    }
  });
});

describe("a shape whose edges meet a rectangle", () => {
  // Mermaid's handler intersects the node's box (`intersect.rect`, or a
  // polygon of the box's own corners): a plain or round-cornered box, a
  // box with markings inside it, a window, a shape drawn with no outline,
  // and the invisible hit rectangle behind a brace.
  it.each([
    "rect",
    "round",
    "subroutine",
    "lined-rectangle",
    "divided-rectangle",
    "window-pane",
    "tagged-rectangle",
    "text",
    "composite",
    "note",
    "data-store",
    "state",
    "fork",
    "brace-left",
    "brace-right",
    "braces",
    "console",
    "browser",
  ] as const)("%s outlines its box", (shape) => {
    for (const text of LABELS) {
      const node = nodeOf(shape, text);
      expect(sortPoints(outlineOf(node))).toEqual(corners(node));
    }
  });

  it("fork in a flow running left to right outlines its upright bar", () => {
    const node = nodeOf("fork", "x", {}, "LR");
    expect(node.height).toBeGreaterThan(node.width);
    expect(sortPoints(outlineOf(node))).toEqual(corners(node));
  });

  it("an icon in a circle outlines its whole box, label and all", () => {
    const node = nodeOf("icon", "Hi", { icon: { ...ICON, form: "circle" } });
    expect(sortPoints(outlineOf(node))).toEqual(corners(node));
  });

  it("an icon or an image with no label outlines its box", () => {
    for (const node of [nodeOf("icon", "", { icon: { ...ICON } }), nodeOf("image", "", { image: { ...IMAGE } })]) {
      expect(sortPoints(outlineOf(node))).toEqual(corners(node));
    }
  });
});

/** The vertices of the first subpath of `d` — `M x,y L x,y … Z` — as points. */
function firstSubpath(d: string): Point[] {
  const [first] = d.split(/(?=M)/);
  return Array.from(first!.matchAll(/[ML](-?[\d.e+-]+),(-?[\d.e+-]+)/g), ([, x, y]) => ({ x: Number(x), y: Number(y) }));
}

/** The `d` of the first frame `node` is drawn with. */
function firstFrameD(graph: PositionedGraph): string {
  const frame = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"] .siren-node-frame')!;
  return frame.getAttribute("d")!;
}

describe("a polygon's outline", () => {
  // Mermaid meets these at the polygon it draws — for a stack of sheets,
  // the silhouette of the stack; for a wavy edge, the 51 points it samples
  // the wave at — and Siren's outline is the very vertices of its frame.
  it.each([
    "asymmetric",
    "rhombus",
    "hexagon",
    "parallelogram",
    "parallelogram-alt",
    "trapezoid",
    "trapezoid-alt",
    "notched-rectangle",
    "folder",
    "notched-pentagon",
    "sloped-rectangle",
    "triangle",
    "flipped-triangle",
    "stacked-rectangle",
    "fork",
    "hourglass",
    "bolt",
    "choice",
    "document",
    "lined-document",
    "tagged-document",
    "stacked-document",
    "flag",
  ] as const)("%s is the vertices its frame is drawn through", (shape) => {
    for (const text of LABELS) {
      const graph = laidOut(shape, text);
      expect(outlineOf(graph.nodes[0]!)).toEqual(firstSubpath(firstFrameD(graph)));
    }
  });
});

/** `n + 1` points along the segment from `a` to `b`. */
function segment(a: Point, b: Point, n = 400): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** `n + 1` points along the ellipse about `cx,cy` of radii `rx`, `ry`, from angle `from` to `to` (y down). */
function ellipse(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n = 4000): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** How far `p` stands from the segment `a`–`b`. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far `p` stands from the closed polygon `outline`. */
function toOutline(p: Point, outline: Point[]): number {
  return Math.min(...outline.map((a, i) => toSegment(p, a, outline[(i + 1) % outline.length]!)));
}

/** How far `p` stands from the nearest of `samples`, a curve sampled densely. */
function toSamples(p: Point, samples: Point[]): number {
  let least = Infinity;
  for (const s of samples) least = Math.min(least, Math.hypot(p.x - s.x, p.y - s.y));
  return least;
}

/** Mermaid's ellipse for a cylinder's end of major radius `major`: `major / (2.5 + diameter / 50)`. */
const minorOf = (major: number) => major / (2.5 + (2 * major) / 50);

/**
 * The shape's true boundary in `node`'s box, sampled densely from its
 * formula: its straight sides as segments, its round parts as the circle or
 * ellipse they are cut from.
 */
const TRUE_BOUNDARY: Partial<Record<NodeShape, (n: PositionedNode) => Point[]>> = {
  stadium: (n) => {
    const r = n.height / 2;
    const [l, t, rt, b, my] = [n.x, n.y, n.x + n.width, n.y + n.height, n.y + n.height / 2];
    return [
      ...segment({ x: l + r, y: t }, { x: rt - r, y: t }),
      ...ellipse(rt - r, my, r, r, -Math.PI / 2, Math.PI / 2),
      ...segment({ x: rt - r, y: b }, { x: l + r, y: b }),
      ...ellipse(l + r, my, r, r, Math.PI / 2, (3 * Math.PI) / 2),
    ];
  },
  cylinder: (n) => {
    const rx = n.width / 2;
    const ry = n.height / 8;
    const [l, t, rt, b, mx] = [n.x, n.y, n.x + n.width, n.y + n.height, n.x + n.width / 2];
    return [
      ...ellipse(mx, t + ry, rx, ry, Math.PI, 2 * Math.PI),
      ...segment({ x: rt, y: t + ry }, { x: rt, y: b - ry }),
      ...ellipse(mx, b - ry, rx, ry, 0, Math.PI),
      ...segment({ x: l, y: b - ry }, { x: l, y: t + ry }),
    ];
  },
  "half-rounded-rectangle": (n) => {
    const r = n.height / 2;
    const [l, t, rt, b, my] = [n.x, n.y, n.x + n.width, n.y + n.height, n.y + n.height / 2];
    return [
      ...segment({ x: l, y: t }, { x: rt - r, y: t }),
      ...ellipse(rt - r, my, r, r, -Math.PI / 2, Math.PI / 2),
      ...segment({ x: rt - r, y: b }, { x: l, y: b }),
      ...segment({ x: l, y: b }, { x: l, y: t }),
    ];
  },
  "curved-trapezoid": (n) => {
    const r = n.height / 2;
    const point = n.height / 4;
    const [l, t, rt, b, my] = [n.x, n.y, n.x + n.width, n.y + n.height, n.y + n.height / 2];
    return [
      ...segment({ x: l + point, y: t }, { x: rt - r, y: t }),
      ...ellipse(rt - r, my, r, r, -Math.PI / 2, Math.PI / 2),
      ...segment({ x: rt - r, y: b }, { x: l + point, y: b }),
      ...segment({ x: l + point, y: b }, { x: l, y: my }),
      ...segment({ x: l, y: my }, { x: l + point, y: t }),
    ];
  },
  "horizontal-cylinder": (n) => {
    const ry = n.height / 2;
    const rx = minorOf(ry);
    const [l, t, rt, b, my] = [n.x, n.y, n.x + n.width, n.y + n.height, n.y + n.height / 2];
    return [
      ...segment({ x: l + rx, y: t }, { x: rt - rx, y: t }),
      ...ellipse(rt - rx, my, rx, ry, -Math.PI / 2, Math.PI / 2),
      ...segment({ x: rt - rx, y: b }, { x: l + rx, y: b }),
      ...ellipse(l + rx, my, rx, ry, Math.PI / 2, (3 * Math.PI) / 2),
    ];
  },
  "lined-cylinder": (n) => {
    const rx = n.width / 2;
    const ry = minorOf(rx);
    const [l, t, rt, b, mx] = [n.x, n.y, n.x + n.width, n.y + n.height, n.x + n.width / 2];
    return [
      ...ellipse(mx, t + ry, rx, ry, Math.PI, 2 * Math.PI),
      ...segment({ x: rt, y: t + ry }, { x: rt, y: b - ry }),
      ...ellipse(mx, b - ry, rx, ry, 0, Math.PI),
      ...segment({ x: l, y: b - ry }, { x: l, y: t + ry }),
    ];
  },
  "bow-tie-rectangle": (n) => {
    const ry = n.height / 2;
    const rx = minorOf(ry);
    const [l, t, rt, b, my] = [n.x, n.y, n.x + n.width, n.y + n.height, n.y + n.height / 2];
    return [
      ...segment({ x: rt, y: t }, { x: l + rx, y: t }),
      ...ellipse(l + rx, my, rx, ry, Math.PI / 2, (3 * Math.PI) / 2),
      ...segment({ x: l + rx, y: b }, { x: rt, y: b }),
      // The right end curves in: the left half of an ellipse about the right edge.
      ...ellipse(rt, my, rx, ry, Math.PI / 2, (3 * Math.PI) / 2),
    ];
  },
  bucket: (n) => {
    const ry = Math.min(Math.max(n.width * 0.08, 5), 12);
    const half = n.width / 2;
    const base = half * 0.72;
    const [l, t, rt, b, mx] = [n.x, n.y, n.x + n.width, n.y + n.height, n.x + n.width / 2];
    return [
      ...ellipse(mx, t + ry, half, ry, Math.PI, 2 * Math.PI),
      ...segment({ x: rt, y: t + ry }, { x: mx + base, y: b - ry }),
      ...ellipse(mx, b - ry, base, ry, 0, Math.PI),
      ...segment({ x: mx - base, y: b - ry }, { x: l, y: t + ry }),
    ];
  },
  person: (n) => {
    const R = Math.min(Math.max(n.width * 0.23, 16), 56);
    const neck = 2 * R - 0.27 * R;
    const [l, t, rt, b, mx] = [n.x, n.y, n.x + n.width, n.y + n.height, n.x + n.width / 2];
    const bodyTop = t + neck;
    const c = Math.min(n.width * 0.177, (n.height - neck) * 0.45);
    // The head meets the body's top where the circle crosses it.
    const meet = Math.asin((neck - R) / R);
    const chord = R * Math.cos(meet);
    return [
      ...ellipse(mx, t + R, R, R, Math.PI - meet, 2 * Math.PI + meet),
      ...segment({ x: mx + chord, y: bodyTop }, { x: rt - c, y: bodyTop }),
      ...ellipse(rt - c, bodyTop + c, c, c, -Math.PI / 2, 0),
      ...segment({ x: rt, y: bodyTop + c }, { x: rt, y: b - c }),
      ...ellipse(rt - c, b - c, c, c, 0, Math.PI / 2),
      ...segment({ x: rt - c, y: b }, { x: l + c, y: b }),
      ...ellipse(l + c, b - c, c, c, Math.PI / 2, Math.PI),
      ...segment({ x: l, y: b - c }, { x: l, y: bodyTop + c }),
      ...ellipse(l + c, bodyTop + c, c, c, Math.PI, (3 * Math.PI) / 2),
      ...segment({ x: l + c, y: bodyTop }, { x: mx - chord, y: bodyTop }),
    ];
  },
};

/** A round shape's boundary: the circle inscribed in its box. */
const circleBoundary = (n: PositionedNode) =>
  ellipse(n.x + n.width / 2, n.y + n.height / 2, Math.min(n.width, n.height) / 2, Math.min(n.width, n.height) / 2, 0, 2 * Math.PI);

for (const shape of ["circle", "double-circle", "small-circle", "framed-circle", "filled-circle", "anchor", "crossed-circle"] as const) {
  TRUE_BOUNDARY[shape] = circleBoundary;
}

describe("a curved shape's outline", () => {
  // Mermaid meets these at a polygon it samples off the curve (a circle's
  // own formula, for a circle); Siren samples its own curve, finely enough
  // that the outline never strays from it by more than half a pixel —
  // neither at a point it samples nor between two.
  it.each(Object.keys(TRUE_BOUNDARY) as NodeShape[])("%s stays within half a pixel of its curve, all the way round", (shape) => {
    for (const text of LABELS) {
      const node = nodeOf(shape, text);
      const outline = outlineOf(node);
      const truth = TRUE_BOUNDARY[shape]!(node);
      const midpoints = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length]!;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      });
      for (const p of [...outline, ...midpoints]) {
        expect(toSamples(p, truth)).toBeLessThanOrEqual(TOLERANCE);
      }
      // And the whole curve is outlined, not some of it.
      for (const p of truth.filter((_, i) => i % 10 === 0)) {
        expect(toOutline(p, outline)).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  it("a big circle stays within half a pixel of its curve", () => {
    const node = nodeOf("circle", Array(8).fill("A rather long label").join("<br>"));
    const outline = outlineOf(node);
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const r = node.width / 2;
    expect(r).toBeGreaterThan(100);
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      expect(Math.abs(Math.hypot(a.x - cx, a.y - cy) - r)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(Math.hypot((a.x + b.x) / 2 - cx, (a.y + b.y) / 2 - cy) - r)).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});

describe("a labelled icon's or image's outline", () => {
  // Mermaid meets a labelled icon or image at the figure and, below it (or
  // above it, with `pos: t`), a strip as wide as the label's text running
  // from the figure to the far edge of the box: a polygon of eight corners.
  // "A much longer label" is 152px of text, wider than the 48px icon.
  const strip = (node: PositionedNode, figure: { width: number; height: number }, text: number, above: boolean) => {
    const midX = node.x + node.width / 2;
    const top = node.y;
    const bottom = node.y + node.height;
    const [figTop, figBottom] = above ? [bottom - figure.height, bottom] : [top, top + figure.height];
    const [stripTop, stripBottom] = above ? [top, figTop] : [figBottom, bottom];
    return sortPoints([
      { x: midX - figure.width / 2, y: figTop },
      { x: midX + figure.width / 2, y: figTop },
      { x: midX - figure.width / 2, y: figBottom },
      { x: midX + figure.width / 2, y: figBottom },
      { x: midX - text / 2, y: stripTop },
      { x: midX + text / 2, y: stripTop },
      { x: midX - text / 2, y: stripBottom },
      { x: midX + text / 2, y: stripBottom },
    ]);
  };

  it.each([
    ["no form, a short label", "Hi", { ...ICON }, 48, 16],
    ["no form, a long label", "A much longer label", { ...ICON }, 48, 152],
    ["a square, a short label", "Hi", { ...ICON, form: "square" }, 63, 16],
    ["a rounded square, a long label", "A much longer label", { ...ICON, form: "rounded" }, 63, 152],
    ["a square, its label above", "Hi", { ...ICON, form: "square", pos: "t" }, 63, 16],
  ] as const)("an icon with %s", (_name, text, icon, side, textWidth) => {
    const node = nodeOf("icon", text, { icon });
    const outline = outlineOf(node);
    expect(outline).toHaveLength(8);
    expect(sortPoints(outline)).toEqual(strip(node, { width: side, height: side }, textWidth, icon.pos === "t"));
  });

  it.each([
    ["below", "b"],
    ["above", "t"],
  ] as const)("an image labelled %s", (_name, pos) => {
    // A labelled image is at least 120 wide; this one is 40 x 20 natural.
    const node = nodeOf("image", "Hi", { image: { ...IMAGE, pos } });
    const outline = outlineOf(node);
    expect(outline).toHaveLength(8);
    expect(sortPoints(outline)).toEqual(strip(node, { width: 120, height: 20 }, 16, pos === "t"));
  });
});

/**
 * `n + 1` points along the SVG arc from `from` written `a rx,ry rotation
 * large,sweep dx,dy`, worked out from the SVG arc implementation notes
 * (endpoint to centre parameterisation, radii scaled up when too small).
 */
function svgArc(from: Point, rx0: number, ry0: number, rotation: number, large: number, sweep: number, dx: number, dy: number, n = 2000): Point[] {
  const to = { x: from.x + dx, y: from.y + dy };
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const hx = (from.x - to.x) / 2;
  const hy = (from.y - to.y) / 2;
  const x1 = cos * hx + sin * hy;
  const y1 = -sin * hx + cos * hy;
  const lambda = (x1 * x1) / (rx0 * rx0) + (y1 * y1) / (ry0 * ry0);
  const rx = lambda > 1 ? rx0 * Math.sqrt(lambda) : rx0;
  const ry = lambda > 1 ? ry0 * Math.sqrt(lambda) : ry0;
  const sign = large === sweep ? -1 : 1;
  const k = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const start = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  let delta = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - start;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = start + (delta * i) / n;
    return {
      x: cx + rx * cos * Math.cos(t) - ry * sin * Math.sin(t),
      y: cy + rx * sin * Math.cos(t) + ry * cos * Math.sin(t),
    };
  });
}

/** The curve a `d` of `M`, relative `a`, `H`, `V` and `Z` draws, sampled densely: `n + 1` points an arc. */
function sampledPath(d: string, n = 2000): Point[] {
  const tokens = d.match(/[MaHVZ]|-?[\d.]+(?:e[+-]?\d+)?/g)!;
  const points: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  let start: Point = at;
  for (let i = 0; i < tokens.length; ) {
    const command = tokens[i++]!;
    const next = () => Number(tokens[i++]);
    if (command === "M") {
      at = { x: next(), y: next() };
      start = at;
    } else if (command === "a") {
      const arc = svgArc(at, next(), next(), next(), next(), next(), next(), next(), n);
      points.push(...arc);
      at = arc.at(-1)!;
    } else if (command === "H") {
      const to = { x: next(), y: at.y };
      points.push(...segment(at, to));
      at = to;
    } else if (command === "V") {
      const to = { x: at.x, y: next() };
      points.push(...segment(at, to));
      at = to;
    } else if (command === "Z") {
      points.push(...segment(at, start));
      at = start;
    } else {
      throw new Error(`unexpected ${command} in ${d}`);
    }
  }
  return points;
}

describe("a cloud's and a bang's outline", () => {
  // Mermaid meets a cloud and a bang at their box, which leaves an arrow
  // short of the arcs; Siren meets the arcs it draws, sampled finely enough
  // that the outline never strays from them by more than half a pixel.
  it.each(["cloud", "bang"] as const)("%s stays within half a pixel of the arcs it is drawn with, all the way round", (shape) => {
    for (const text of [...LABELS, "a<br>b<br>c<br>d<br>e<br>f"]) {
      const graph = laidOut(shape, text);
      const outline = outlineOf(graph.nodes[0]!);
      const truth = sampledPath(firstFrameD(graph));
      const midpoints = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length]!;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      });
      for (const p of [...outline, ...midpoints]) {
        expect(toSamples(p, truth)).toBeLessThanOrEqual(TOLERANCE);
      }
      for (const p of truth.filter((_, i) => i % 10 === 0)) {
        expect(toOutline(p, outline)).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });
});
