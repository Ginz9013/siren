import type { Direction, GraphNode, Point, PositionedNode, StyleProperty } from "../../contracts";

/**
 * The vocabulary of the **shape table**: what one flowchart node shape is,
 * as data that layout and the renderer both read.
 *
 * A shape is four answers, and nothing else in the pipeline knows a
 * shape's name:
 *
 * - `box` — how much bounding box a measured label needs (`layoutGraph`).
 * - `labelRect` — where in that box the label goes (`layoutGraph`, which
 *   hands the renderer the offset as `PositionedNode.labelOffset`).
 * - `frames` — the elements the outline is drawn with (`renderToSVG`).
 * - `outline` — the closed polygon a connector's end meets.
 *
 * A new shape is three additions: its member in the `NodeShape` union
 * (`contracts.ts`), its record in one of the group files beside this one,
 * and its names in the parser's `TABLE_SHAPE_NAMES`
 * (`parser/flowchartNodeData.ts`, which also drops them from the names not
 * drawn yet). `layoutGraph.ts` and `renderToSVG.ts` read the table and never
 * learn it exists.
 */

/** A width and a height. */
export interface Size {
  width: number;
  height: number;
}

/** A box: its top-left corner and its size. */
export interface Rect extends Size {
  x: number;
  y: number;
}

/**
 * One element a node's outline is drawn with, as data: which SVG element,
 * its geometry attributes in the order they are written, the declarations
 * the shape itself needs inline (ahead of the author's, so the author can
 * override them), and any classes it wears beside `siren-node-frame`.
 *
 * Every frame wears `siren-node-frame` — the renderer adds it — so an
 * author's `style A …` reaches every element a shape draws, and the theme
 * strokes a bar because it strokes a frame.
 */
export interface ShapeFrame {
  element: "rect" | "path" | "circle" | "line" | "g" | "image";
  attributes: ReadonlyArray<readonly [name: string, value: number | string]>;
  /** Declarations the shape owns, written inline before the author's. */
  style?: readonly StyleProperty[];
  /** Classes beside `siren-node-frame`, such as a paint (`FRAME_PAINT`). */
  classes?: readonly string[];
  /**
   * `false` for a decoration the shape keeps in its own paint whatever the
   * author's `style` says — a browser's dots, a console's prompt — so a
   * fill the author gives the node cannot paint over them. Absent, the
   * author's declarations follow the shape's own on this frame.
   */
  authorStyle?: false;
  /**
   * What a `g` frame holds: a **figure** drawn inside the node, such as an
   * icon's glyph, or an image node's `image` (with no children). A frame
   * with children is painted by the shape alone — it wears neither
   * `siren-node-frame` nor the author's declarations, which the shape has
   * already read for the colour it asks for.
   */
  children?: readonly FigureElement[];
}

/** The SVG elements a figure may be drawn with (`ShapeFrame.children`). */
export type FigureElementName =
  | "g"
  | "path"
  | "circle"
  | "ellipse"
  | "rect"
  | "line"
  | "polyline"
  | "polygon"
  | "defs"
  | "linearGradient"
  | "radialGradient"
  | "stop"
  | "clipPath"
  | "mask";

/** One element of a figure, as data: drawn with `createElementNS`, never parsed. */
export interface FigureElement {
  element: FigureElementName;
  attributes: ReadonlyArray<readonly [name: string, value: string]>;
  children: readonly FigureElement[];
}

/**
 * One node shape.
 *
 * `label` is always the **padded** label box — the measured text plus the
 * node's padding on each side, which is exactly the box a rectangle draws.
 * A shape whose Mermaid handler pads the text as a rectangle's does starts
 * from it as it is; one whose handler pads by its own multiple of the node
 * padding (a cylinder on its side, a document stack, a brace, a cloud)
 * recovers the text as `label` less `padding` on each side and pads that
 * by its own rule, with `padding` standing for Mermaid's `p` — so the shape
 * stands to a rectangle as Mermaid's does.
 */
export interface ShapeSpec {
  /**
   * The bounding box this shape needs to hold `label`. `padding` is what
   * the padded label adds to the text on each side, across and up — the
   * node padding `layoutGraph` measured — for a shape whose handler pads
   * the text its own way rather than as a rectangle does. Absent, it is
   * Mermaid's 15px each way, so a record called with a label Mermaid padded
   * reproduces Mermaid's box. `node` is the
   * node being sized, for a shape drawn from more than its label (an icon).
   */
  box(label: Size, direction: Direction, padding?: Size, node?: GraphNode): Size;
  /**
   * Where the padded label sits inside `box`. Absent, the label is centred
   * on the box, which is where every shape but a handful puts it.
   */
  labelRect?(box: Rect, label: Size, node?: GraphNode): Rect;
  /**
   * The elements the outline is drawn with, inscribed in the box layout
   * placed `node` in (its `x`, `y`, `width` and `height`). Most shapes read
   * only that box; a shape drawn from more than its label (an icon) reads
   * the node's own data too.
   */
  frames(node: PositionedNode): ShapeFrame[];
  /**
   * Where a connector meeting the node stops: a closed polygon in the
   * coordinates `frames` draws in, its last point joined back to the first
   * (which is not written again). It may cross itself — an hourglass's two
   * diagonals do, as Mermaid draws them — so a clipper takes the crossing
   * nearest the outside point rather than testing inside or outside.
   *
   * Which outline follows the shape's Mermaid handler's `intersect`: a
   * polygon's own vertices — the very points its frame is drawn through —
   * a curve sampled finely enough to stay within `OUTLINE_TOLERANCE` of it,
   * the outer silhouette of a shape drawn in parts, and the box itself
   * where the handler meets a rectangle: an invisible hit rectangle behind
   * a brace, a window, a cloud, a shape that draws no outline.
   */
  outline(node: PositionedNode): Point[];
  /**
   * `false` for a shape that draws no text at all (a fork, a small circle):
   * the renderer leaves the label out. Absent, the label is drawn. The
   * shapes that say so are `SHAPES_DRAWN_WITHOUT_TEXT` (`nodeShapeTraits.ts`),
   * the set the parser refuses a label for; a test keeps the two equal.
   */
  drawsLabel?: false;
}

/**
 * How a frame is painted: filled with the node's own fill (the theme's, or
 * the author's), with nothing, or with the colour the node's lines are
 * drawn in; neither filled nor stroked (`bare`, a text block); or with a
 * note's paint (`note`). Classes rather than inline declarations, so the timeline's highlight
 * rules — which select more classes — still outline every frame, and an
 * author's own `fill` still wins.
 */
export type FramePaint = "node" | "none" | "line" | "bare" | "note";

/** The classes each paint adds beside `siren-node-frame`. */
export const FRAME_PAINT: Readonly<Record<FramePaint, readonly string[]>> = {
  node: [],
  none: ["siren-node-hollow"],
  line: ["siren-node-ink"],
  bare: ["siren-node-bare"],
  note: ["siren-node-note"],
};

/** The label's own box, centred on `box`: where a shape with no `labelRect` puts it. */
export function centredLabel(box: Rect, label: Size): Rect {
  return {
    x: box.x + (box.width - label.width) / 2,
    y: box.y + (box.height - label.height) / 2,
    width: label.width,
    height: label.height,
  };
}

/** `points` as a closed path: `M x,y L x,y … Z`. */
export function closedPath(points: ReadonlyArray<readonly [number, number]>): string {
  return `${points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ")} Z`;
}

/** A `<path>` frame. */
export function pathFrame(d: string, extra: Omit<ShapeFrame, "element" | "attributes"> = {}): ShapeFrame {
  return { element: "path", attributes: [["d", d]], ...extra };
}

/** A `<rect>` frame covering `box`. */
export function rectFrame(box: Rect, extra: Omit<ShapeFrame, "element" | "attributes"> = {}): ShapeFrame {
  return {
    element: "rect",
    attributes: [
      ["x", box.x],
      ["y", box.y],
      ["width", box.width],
      ["height", box.height],
    ],
    ...extra,
  };
}

/** The four edges and the centre of `box`, the coordinates every outline is written in. */
export function edgesOf(box: Rect): { left: number; right: number; top: number; bottom: number; midX: number; midY: number } {
  return {
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
    midX: box.x + box.width / 2,
    midY: box.y + box.height / 2,
  };
}

/**
 * How far a figure's label stands from the figure — an icon's or an
 * image's (Mermaid's `labelPadding`, 8 when the node has a label).
 */
export const FIGURE_LABEL_GAP = 8;

/** The corners of `box`, clockwise from its top left: the outline of every shape whose edges meet its box. */
export function boxOutline(box: Rect): Point[] {
  const { left, right, top, bottom } = edgesOf(box);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/** A point written as `[x, y]`, the form a polygon's vertices are listed in. */
export type Vertex = readonly [number, number];

/** `vertices` as points. */
export function pointsOf(vertices: readonly Vertex[]): Point[] {
  return vertices.map(([x, y]) => ({ x, y }));
}

/**
 * A shape drawn as one closed polygon through `vertices`, which is also its
 * outline — one list of points, so the figure drawn and the outline an edge
 * meets cannot drift apart.
 */
export function polygonShape(vertices: (box: Rect) => Vertex[]): Pick<ShapeSpec, "frames" | "outline"> {
  return {
    frames: (box) => [pathFrame(closedPath(vertices(box)))],
    outline: (box) => pointsOf(vertices(box)),
  };
}

/** How far a sampled curve's outline may stray from the curve, in pixels. */
export const OUTLINE_TOLERANCE = 0.25;

/**
 * Points along the ellipse about `cx,cy` of radii `rx` and `ry`, from angle
 * `from` to angle `to` (radians, y down, so a growing angle turns
 * clockwise on screen), both ends included.
 *
 * Spaced so that no chord strays from the arc by more than
 * `OUTLINE_TOLERANCE`: a chord across a step `dt` of a curve whose second
 * derivative is at most `max(rx, ry)` strays at most `dt² x max(rx, ry) / 8`.
 */
export function arcPoints(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Point[] {
  const reach = Math.max(rx, ry);
  const sweep = Math.abs(to - from);
  const step = reach > 0 ? Math.sqrt((8 * OUTLINE_TOLERANCE) / reach) : sweep;
  const count = Math.max(1, Math.ceil(sweep / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / count;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/**
 * `points` as an outline: a point that repeats the one before it dropped,
 * and the first not written again at the end — where two pieces of an
 * outline meet, each has the point they share.
 */
export function closedOutline(points: readonly Point[]): Point[] {
  const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  const kept = points.filter((point, i) => i === 0 || !near(point, points[i - 1]!));
  while (kept.length > 1 && near(kept[0]!, kept.at(-1)!)) {
    kept.pop();
  }
  return kept;
}

/** The circle of radius `r` about the centre of `box`, sampled. */
export function circleOutline(box: Rect, r: number): Point[] {
  const { midX, midY } = edgesOf(box);
  return closedOutline(arcPoints(midX, midY, r, r, 0, 2 * Math.PI));
}

/**
 * The outline of a figure with its label beside it — an icon's, an
 * image's: `figure`, and a strip `labelWidth` wide (centred, no wider than
 * the box) running from the figure to the far edge of `box`, below it or,
 * with `above`, above it. Eight corners, clockwise from the top left.
 */
export function figureOutline(box: Rect, figure: Rect, labelWidth: number, above: boolean): Point[] {
  const { left, right, top, bottom } = edgesOf(figure);
  const { midX } = edgesOf(box);
  const half = Math.min(labelWidth, box.width) / 2;
  if (above) {
    const stripTop = box.y;
    return closedOutline([
      { x: midX - half, y: stripTop },
      { x: midX + half, y: stripTop },
      { x: midX + half, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
      { x: left, y: top },
      { x: midX - half, y: top },
    ]);
  }
  const stripBottom = box.y + box.height;
  return closedOutline([
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: midX + half, y: bottom },
    { x: midX + half, y: stripBottom },
    { x: midX - half, y: stripBottom },
    { x: midX - half, y: bottom },
    { x: left, y: bottom },
  ]);
}
