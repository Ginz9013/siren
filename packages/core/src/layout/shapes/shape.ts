import type { Direction, StyleProperty } from "../../contracts";

/**
 * The vocabulary of the **shape table**: what one flowchart node shape is,
 * as data that layout and the renderer both read.
 *
 * A shape is three answers, and nothing else in the pipeline knows a
 * shape's name:
 *
 * - `box` — how much bounding box a measured label needs (`layoutGraph`).
 * - `labelRect` — where in that box the label goes (`layoutGraph`, which
 *   hands the renderer the offset as `PositionedNode.labelOffset`).
 * - `frames` — the elements the outline is drawn with (`renderToSVG`).
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
  element: "rect" | "path" | "circle" | "line";
  attributes: ReadonlyArray<readonly [name: string, value: number | string]>;
  /** Declarations the shape owns, written inline before the author's. */
  style?: readonly StyleProperty[];
  /** Classes beside `siren-node-frame`, such as a paint (`FRAME_PAINT`). */
  classes?: readonly string[];
}

/**
 * One node shape.
 *
 * `label` is always the **padded** label box — the measured label plus the
 * node's padding, which is exactly the box a rectangle draws — so every
 * shape's arithmetic starts from the box a plain `A[text]` would have.
 */
export interface ShapeSpec {
  /** The bounding box this shape needs to hold `label`. */
  box(label: Size, direction: Direction): Size;
  /**
   * Where the padded label sits inside `box`. Absent, the label is centred
   * on the box, which is where every shape but a handful puts it.
   */
  labelRect?(box: Rect, label: Size): Rect;
  /** The elements the outline is drawn with, inscribed in `box`. */
  frames(box: Rect): ShapeFrame[];
  /**
   * `false` for a shape that draws no text at all (a fork, a small circle):
   * the renderer leaves the label out. Absent, the label is drawn.
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
