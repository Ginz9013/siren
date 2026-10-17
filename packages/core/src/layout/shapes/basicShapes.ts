import type { NodeShape } from "../../contracts";
import { arcPoints, boxOutline, circleOutline, closedOutline, edgesOf, pathFrame, polygonShape, type Rect, rectFrame, type ShapeFrame, type ShapeSpec, type Size } from "./shape";

/**
 * The fourteen shapes Mermaid spells with brackets (`A[x]`, `A{x}`,
 * `A((x))`, …), as shape-table records.
 *
 * Every one is drawn **inscribed in its bounding box**, and each box is the
 * smallest in which that inscribed outline still contains the padded label,
 * keeping the label's proportions — so a one-character node stays small and
 * a long one grows. A rectangle *is* its bounding box and takes the label
 * unchanged; every other shape cuts corners off that box and so needs more
 * of it. For a rhombus the arithmetic is exact: a diamond inscribed in
 * `W x H` holds a centred `w x h` label exactly when `w/W + h/H <= 1`, which
 * `W = 2w, H = 2h` meets with the label's corners on the outline.
 */

/**
 * How far a shape's outline leans in from the bounding box it is inscribed
 * in, **per side, as a fraction of the box's height** — the one number that
 * decides both how much box a label needs and where the outline's corners
 * go. One constant per shape, read by that shape's `box` and its `frames`
 * alike, so the room reserved and the figure drawn cannot drift into a
 * label crossing its own frame.
 *
 * `lean` means a different thing to each outline and the same number does
 * for all of them: a hexagon's end inset, a parallelogram's slant, a
 * trapezoid's inset per side, the asymmetric flag's notch depth, a round
 * node's and a stadium's corner radius, a subroutine's bar inset. Each
 * displaces exactly `lean x height` horizontally at the height where a
 * centred label meets it, so all of them size as `W = w + 2 x lean x h,
 * H = h`.
 *
 * The last two displace vertically instead: a double circle's `lean` is the
 * gap between its rings, and a cylinder's the vertical semi-axis of the
 * ellipse its lid and its bulge are halves of.
 *
 * A stadium's `1/2` is not chosen — its ends are semicircles or it is not a
 * stadium. The rest are Siren's own proportions and happen to agree with
 * Mermaid 11.17.2's, measured off its rendered polygons.
 */
export const SHAPE_LEAN = {
  hexagon: 1 / 4,
  parallelogram: 1 / 2,
  "parallelogram-alt": 1 / 2,
  trapezoid: 1 / 2,
  "trapezoid-alt": 1 / 2,
  asymmetric: 1 / 4,
  round: 1 / 4,
  stadium: 1 / 2,
  subroutine: 1 / 8,
  "double-circle": 1 / 16,
  cylinder: 1 / 8,
} as const satisfies Partial<Record<NodeShape, number>>;

/** A shape whose outline leans `SHAPE_LEAN[shape] x height` in per side, and no taller than its label. */
function leaningBox(shape: keyof typeof SHAPE_LEAN): (label: Size) => Size {
  return (label) => ({ width: label.width + 2 * SHAPE_LEAN[shape] * label.height, height: label.height });
}

/**
 * A `<rect>` frame whose corner radius the shape owns, written as an inline
 * `rx` declaration rather than an attribute: a presentation attribute loses
 * to the theme's `.siren-node-frame { rx: … }`, and a stadium's ends are
 * the shape, not a decoration a token may flatten. The author's own `rx`
 * is written after it and still wins.
 */
function roundedRect(box: Rect, radius: number): ShapeFrame {
  return rectFrame(box, { style: [{ property: "rx", value: `${radius}px` }] });
}

/**
 * Concentric `<circle>` rings, outer first so the inner ring is stroked
 * over the outer's fill. A `<circle>` rather than an `<ellipse>`, whose
 * `rx` the theme's border-radius token would reach; inscribed using the
 * smaller axis so the figure stays round.
 */
function rings(box: Rect, radii: (radius: number) => number[]): ShapeFrame[] {
  const { midX, midY } = edgesOf(box);
  return radii(Math.min(box.width, box.height) / 2).map((r) => ({
    element: "circle",
    attributes: [
      ["cx", midX],
      ["cy", midY],
      ["r", r],
    ],
  }));
}

export const BASIC_SHAPES = {
  // A rectangle is its own bounding box. Its corners are the theme's
  // (`--siren-node-border-radius`), so it declares none.
  rect: {
    outline: boxOutline,
    box: (label) => label,
    frames: (box) => [rectFrame(box)],
  },
  round: {
    // Edges meet the box its corners are rounded off, as Mermaid's do.
    outline: boxOutline,
    box: leaningBox("round"),
    frames: (box) => [roundedRect(box, SHAPE_LEAN.round * box.height)],
  },
  stadium: {
    box: leaningBox("stadium"),
    frames: (box) => [roundedRect(box, SHAPE_LEAN.stadium * box.height)],
    outline: (box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      const r = SHAPE_LEAN.stadium * box.height;
      return closedOutline([
        { x: left + r, y: top },
        ...arcPoints(right - r, midY, r, r, -Math.PI / 2, Math.PI / 2),
        { x: left + r, y: bottom },
        ...arcPoints(left + r, midY, r, r, Math.PI / 2, (3 * Math.PI) / 2),
      ]);
    },
  },
  // A box with an inner bar down each end, inset by the lean; the label
  // goes between the bars. The bars are `<line>`s — a stroke, not an area
  // that would take the frame's fill.
  subroutine: {
    // Its bars stand inside the box, so edges meet the box.
    outline: boxOutline,
    box: leaningBox("subroutine"),
    frames: (box) => {
      const inset = SHAPE_LEAN.subroutine * box.height;
      const { left, right, top, bottom } = edgesOf(box);
      return [
        rectFrame(box),
        ...[left + inset, right - inset].map(
          (x): ShapeFrame => ({
            element: "line",
            attributes: [
              ["x1", x],
              ["y1", top],
              ["x2", x],
              ["y2", bottom],
            ],
          }),
        ),
      ];
    },
  },
  // The only basic shape that grows in **height**: its lid, a whole ellipse
  // of vertical semi-axis `r = lean x H` inside the top edge, reaches `2r`
  // down, and the label is centred, so the box clears `2r` on both sides of
  // centre — `H = h / (1 - 4 x lean)`.
  //
  // Two closed subpaths in one `d`, wound the same way so the nonzero fill
  // adds them: the tube, then the whole lid over it. A `<path>` reads no
  // `rx`, so the theme's corner token cannot flatten the lid.
  cylinder: {
    box: (label) => ({ width: label.width, height: label.height / (1 - 4 * SHAPE_LEAN.cylinder) }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const r = SHAPE_LEAN.cylinder * box.height;
      const rx = box.width / 2;
      const lid = top + r;
      const base = bottom - r;
      const arc = (x: number, y: number) => `A${rx},${r} 0 0 1 ${x},${y}`;
      return [
        pathFrame(
          `M${left},${lid} ${arc(right, lid)} L${right},${base} ${arc(left, base)} Z ` +
            `M${left},${lid} ${arc(right, lid)} ${arc(left, lid)} Z`,
        ),
      ];
    },
    // The silhouette: the top half of the lid, the sides, and the bottom
    // half of the base — where Mermaid meets a cylinder.
    outline: (box) => {
      const { top, bottom, midX } = edgesOf(box);
      const r = SHAPE_LEAN.cylinder * box.height;
      const rx = box.width / 2;
      return closedOutline([
        ...arcPoints(midX, top + r, rx, r, Math.PI, 2 * Math.PI),
        ...arcPoints(midX, bottom - r, rx, r, 0, Math.PI),
      ]);
    },
  },
  // The smallest circle containing the centred label has its diagonal as
  // diameter. Not capped: a cap is a circle that clips its own label.
  circle: {
    box: (label) => {
      const diameter = Math.hypot(label.width, label.height);
      return { width: diameter, height: diameter };
    },
    frames: (box) => rings(box, (radius) => [radius]),
    outline: (box) => circleOutline(box, Math.min(box.width, box.height) / 2),
  },
  // The label belongs inside the **inner** ring, so the inner circle takes
  // a plain circle's diameter and the box adds the ring gap on each side.
  "double-circle": {
    box: (label) => {
      const diameter = Math.hypot(label.width, label.height) / (1 - 2 * SHAPE_LEAN["double-circle"]);
      return { width: diameter, height: diameter };
    },
    frames: (box) => rings(box, (radius) => [radius, radius - SHAPE_LEAN["double-circle"] * box.height]),
    // Edges meet the outer ring.
    outline: (box) => circleOutline(box, Math.min(box.width, box.height) / 2),
  },
  // A rectangle with a chevron cut into its **left** edge, apex pointing
  // right at mid-height (Mermaid's `rect_left_inv_arrow`, measured).
  asymmetric: {
    box: leaningBox("asymmetric"),
    ...polygonShape((box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      const d = SHAPE_LEAN.asymmetric * box.height;
      return [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left + d, midY],
      ];
    }),
  },
  // The midpoint of each of the four sides.
  rhombus: {
    box: (label) => ({ width: label.width * 2, height: label.height * 2 }),
    ...polygonShape((box) => {
      const { left, right, top, bottom, midX, midY } = edgesOf(box);
      return [
        [midX, top],
        [right, midY],
        [midX, bottom],
        [left, midY],
      ];
    }),
  },
  // Flat top and bottom inset by `m` at each end, a point at mid-height on
  // each side.
  hexagon: {
    box: leaningBox("hexagon"),
    ...polygonShape((box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      const m = SHAPE_LEAN.hexagon * box.height;
      return [
        [left + m, top],
        [right - m, top],
        [right, midY],
        [right - m, bottom],
        [left + m, bottom],
        [left, midY],
      ];
    }),
  },
  // Leaning right: the top edge sits `s` right of the bottom one
  // (Mermaid's `lean_right`).
  parallelogram: {
    box: leaningBox("parallelogram"),
    ...polygonShape((box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const s = SHAPE_LEAN.parallelogram * box.height;
      return [
        [left + s, top],
        [right, top],
        [right - s, bottom],
        [left, bottom],
      ];
    }),
  },
  // Leaning left — the mirror of `parallelogram`.
  "parallelogram-alt": {
    box: leaningBox("parallelogram-alt"),
    ...polygonShape((box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const s = SHAPE_LEAN["parallelogram-alt"] * box.height;
      return [
        [left, top],
        [right - s, top],
        [right, bottom],
        [left + s, bottom],
      ];
    }),
  },
  // Narrow top, wide bottom: `A[/x\]`.
  trapezoid: {
    box: leaningBox("trapezoid"),
    ...polygonShape((box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const s = SHAPE_LEAN.trapezoid * box.height;
      return [
        [left + s, top],
        [right - s, top],
        [right, bottom],
        [left, bottom],
      ];
    }),
  },
  // Wide top, narrow bottom: `A[\x/]`.
  "trapezoid-alt": {
    box: leaningBox("trapezoid-alt"),
    ...polygonShape((box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const s = SHAPE_LEAN["trapezoid-alt"] * box.height;
      return [
        [left, top],
        [right, top],
        [right - s, bottom],
        [left + s, bottom],
      ];
    }),
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
