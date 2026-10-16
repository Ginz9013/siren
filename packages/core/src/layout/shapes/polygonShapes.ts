import type { NodeShape } from "../../contracts";
import { closedPath, edgesOf, FRAME_PAINT, pathFrame, type Rect, rectFrame, type ShapeSpec, type Size } from "./shape";

/**
 * Shape-table records for the shapes Mermaid 12.2.0 names only in a node's
 * `@{ shape: … }` block whose outline is straight lines.
 *
 * Each follows its Mermaid handler's formula (classic look), applied to the
 * padded label — the box a rectangle would draw — and the label goes where
 * that handler puts it. Proportions are Mermaid's; the path is Siren's own
 * (ADR-0004: a shape's kind is the contract, not its exact outline).
 */

/** Mermaid's flowchart node padding (`flowchart.padding`, 15px): the padding a record is told when none is given. */
const NODE_PADDING = 15;

/** Mermaid's `NOTCH_SIZE`: the side of a notched rectangle's cut corner. */
const NOTCH = 12;

/**
 * A folder's tab height for a box `height` tall. Mermaid makes the tab
 * `clamp(0.16 x body, 8, 14)` and the box `body + tab`; this is the same
 * rule solved for the tab from the whole height, so the outline can be
 * drawn from the box alone: the body is `height - tab` and `8` and `14`
 * are reached at a 58px and a 101.5px box.
 */
function folderTab(height: number): number {
  return Math.min(Math.max((height * 0.16) / 1.16, 8), 14);
}

/** Mermaid's `FRAME_WIDTH`: how far a lined rectangle's line stands in from its left edge. */
const FRAME = 8;

/** Mermaid's `rectOffset` for a window pane: the width of its top and left panes. */
const PANE = 10;

/** Mermaid's `rectOffset` for a stacked rectangle: how far each sheet stands from the next. */
const SHEET = 5;

/** Mermaid's `TAG_RATIO`: a tagged rectangle's tag, as a fraction of its height. */
const TAG = 0.2;

/** `box`'s own outline, as a closed path to which a shape adds its markings. */
function rectanglePath(box: Rect): string {
  const { left, right, top, bottom } = edgesOf(box);
  return closedPath([
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]);
}

/** A square box of side `side`. */
function squareOf(side: number): Size {
  return { width: side, height: side };
}

export const POLYGON_SHAPES = {
  // `notch-rect` (Mermaid's `card`): a rectangle with its top-left corner
  // cut at 45 degrees, `NOTCH` along each side; the box grows by the notch.
  "notched-rectangle": {
    box: (label) => ({ width: label.width + NOTCH, height: label.height }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [left + NOTCH, top],
            [right, top],
            [right, bottom],
            [left, bottom],
            [left, top + NOTCH],
          ]),
        ),
      ];
    },
  },
  // `folder`: a tab along the top left, `max(0.38 x W, 28)` wide, over a
  // body as tall as a rectangle's; at least 90px wide. The label is centred
  // on the body.
  folder: {
    box: (label) => ({
      width: Math.max(label.width, 90),
      height: label.height + Math.min(Math.max(label.height * 0.16, 8), 14),
    }),
    labelRect: (box, label) => {
      const tab = folderTab(box.height);
      return {
        x: box.x + (box.width - label.width) / 2,
        y: box.y + tab + (box.height - tab - label.height) / 2,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const tab = folderTab(box.height);
      const tabWidth = Math.max(box.width * 0.38, 28);
      return [
        pathFrame(
          closedPath([
            [left, top],
            [left + tabWidth, top],
            [left + tabWidth, top + tab],
            [right, top + tab],
            [right, bottom],
            [left, bottom],
          ]),
        ),
      ];
    },
  },
  // `notch-pent` (Mermaid's `trapezoidalPentagon`, a loop limit): as big as
  // a rectangle, both top corners cut — the top edge spans the middle 80%
  // of the width and each side starts a fifth of the height down.
  "notched-pentagon": {
    box: (label) => label,
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const inset = box.width * 0.1;
      const drop = box.height * 0.2;
      return [
        pathFrame(
          closedPath([
            [left + inset, top],
            [right - inset, top],
            [right, top + drop],
            [right, bottom],
            [left, bottom],
            [left, top + drop],
          ]),
        ),
      ];
    },
  },
  // `sl-rect` (Mermaid's `slopedRect`, a manual input): a rectangle as big
  // as a plain one with a slope above it half its height, rising from the
  // left to the top right corner. The label is centred on the rectangle,
  // which leaves it a sixth of the box below the box's centre.
  "sloped-rectangle": {
    box: (label) => ({ width: label.width, height: label.height * 1.5 }),
    labelRect: (box, label) => ({
      x: box.x + (box.width - label.width) / 2,
      y: box.y + box.height / 3 + ((box.height * 2) / 3 - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [left, top + box.height / 3],
            [left, bottom],
            [right, bottom],
            [right, top],
          ]),
        ),
      ];
    },
  },
  // `tri` (Mermaid's `triangle`, an extract) and `flip-tri` (its
  // `flippedTriangle`, a manual file): an isosceles triangle in a square box
  // whose side is the label's width plus its height, so the label standing
  // on the wide side has its far corners on the two slopes.
  triangle: {
    box: (label) => squareOf(label.width + label.height),
    labelRect: (box, label) => ({
      x: box.x + (box.width - label.width) / 2,
      y: box.y + box.height - label.height,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, right, top, bottom, midX } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [left, bottom],
            [right, bottom],
            [midX, top],
          ]),
        ),
      ];
    },
  },
  "flipped-triangle": {
    box: (label) => squareOf(label.width + label.height),
    labelRect: (box, label) => ({
      x: box.x + (box.width - label.width) / 2,
      y: box.y,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, right, top, bottom, midX } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [left, top],
            [right, top],
            [midX, bottom],
          ]),
        ),
      ];
    },
  },
  // `lin-rect` (Mermaid's `shadedProcess`): a rectangle `2 x FRAME` wider
  // than a plain one with a line down it `FRAME` in from the left; the
  // label is centred on what lies right of the line.
  "lined-rectangle": {
    box: (label) => ({ width: label.width + 2 * FRAME, height: label.height }),
    labelRect: (box, label) => ({
      x: box.x + FRAME + (box.width - FRAME - label.width) / 2,
      y: box.y + (box.height - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, top, bottom } = edgesOf(box);
      return [pathFrame(`${rectanglePath(box)} M${left + FRAME},${top} L${left + FRAME},${bottom}`)];
    },
  },
  // `div-rect` (Mermaid's `dividedRectangle`): a band a fifth of a plain
  // rectangle's height across the top, under which the label is centred.
  "divided-rectangle": {
    box: (label) => ({ width: label.width, height: label.height * 1.2 }),
    labelRect: (box, label) => {
      const band = box.height / 6;
      return {
        x: box.x + (box.width - label.width) / 2,
        y: box.y + band + (box.height - band - label.height) / 2,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const { left, right, top } = edgesOf(box);
      const band = top + box.height / 6;
      return [pathFrame(`${rectanglePath(box)} M${left},${band} L${right},${band}`)];
    },
  },
  // `win-pane` (Mermaid's `windowPane`, internal storage): `PANE` bigger
  // than a plain rectangle each way, with a line `PANE` below the top and
  // one `PANE` right of the left edge; the label is centred on the big pane.
  "window-pane": {
    box: (label) => ({ width: label.width + PANE, height: label.height + PANE }),
    labelRect: (box, label) => ({
      x: box.x + PANE + (box.width - PANE - label.width) / 2,
      y: box.y + PANE + (box.height - PANE - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      return [
        pathFrame(
          `${rectanglePath(box)} M${left},${top + PANE} L${right},${top + PANE} M${left + PANE},${top} L${left + PANE},${bottom}`,
        ),
      ];
    },
  },
  // `st-rect` (Mermaid's `multiRect`, processes): three sheets `SHEET`
  // apart, the front one at the bottom left, so the box is `2 x SHEET`
  // bigger each way than a plain rectangle and the label is centred on the
  // front sheet. Drawn as Mermaid draws it: the stack's silhouette, then
  // the middle sheet's visible edges over it, both filled.
  "stacked-rectangle": {
    box: (label) => ({ width: label.width + 2 * SHEET, height: label.height + 2 * SHEET }),
    labelRect: (box, label) => ({
      x: box.x + (box.width - 2 * SHEET - label.width) / 2,
      y: box.y + 2 * SHEET + (box.height - 2 * SHEET - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const o = SHEET;
      return [
        pathFrame(
          closedPath([
            [left, top + 2 * o],
            [left, bottom],
            [right - 2 * o, bottom],
            [right - 2 * o, bottom - o],
            [right - o, bottom - o],
            [right - o, bottom - 2 * o],
            [right, bottom - 2 * o],
            [right, top],
            [left + 2 * o, top],
            [left + 2 * o, top + o],
            [left + o, top + o],
            [left + o, top + 2 * o],
          ]),
        ),
        pathFrame(
          closedPath([
            [left + o, top + 2 * o],
            [right - 2 * o, top + 2 * o],
            [right - 2 * o, bottom - o],
            [right - o, bottom - o],
            [right - o, top + o],
            [left + o, top + o],
          ]),
        ),
      ];
    },
  },
  // `tag-rect` (Mermaid's `taggedRect`): a rectangle with a right-angled
  // tag in its bottom right corner, `TAG x H` on a side and filled like the
  // body; the box is that much wider than a plain rectangle.
  "tagged-rectangle": {
    box: (label) => ({ width: label.width + TAG * label.height, height: label.height }),
    frames: (box) => {
      const { right, bottom } = edgesOf(box);
      const tag = TAG * box.height;
      return [
        pathFrame(rectanglePath(box)),
        pathFrame(
          closedPath([
            [right - tag, bottom],
            [right, bottom],
            [right, bottom - tag],
          ]),
        ),
      ];
    },
  },
  // `text` (Mermaid's `text`): a rectangle as big as a plain one that is
  // neither filled nor stroked, so the label alone shows. Its frame is
  // still a frame — an author's `style` and a highlight both reach it.
  text: {
    box: (label) => label,
    frames: (box) => [rectFrame(box, { classes: FRAME_PAINT.bare })],
  },
  // `composite` (undocumented; Mermaid draws `<rect class="basic cluster
  // composite">`): a group's frame standing alone as a node — as big as a
  // rectangle, and painted as a subgraph's frame is, stroked and unfilled.
  composite: {
    box: (label) => label,
    frames: (box) => [rectFrame(box, { classes: FRAME_PAINT.none })],
  },
  // `note` (undocumented; Mermaid's `note`): a rectangle as big as a plain
  // one, wearing a note's paint.
  note: {
    box: (label) => label,
    frames: (box) => [rectFrame(box, { classes: FRAME_PAINT.note })],
  },
  // `datastore` (Mermaid's `datastore`): a rectangle wider than a plain one
  // by twice the node padding across — Mermaid hands `drawRect`
  // `labelPaddingX: padding x 2`, the node padding once more on each side,
  // Siren's own when laid out and Mermaid's 15px when none is given — whose
  // stroke is dashed by its own width and height, so that only the
  // top and the bottom are drawn. Its corners are square — a rounded corner
  // would lengthen the path and slide the dashes off the edges — and both
  // declarations are the shape's, ahead of any the author writes.
  "data-store": {
    box: (label, _direction, padding = { width: NODE_PADDING, height: NODE_PADDING }) => ({
      width: label.width + 2 * padding.width,
      height: label.height,
    }),
    frames: (box) => [
      rectFrame(box, {
        style: [
          { property: "rx", value: "0px" },
          { property: "stroke-dasharray", value: `${box.width} ${box.height}` },
        ],
      }),
    ],
  },
  // `state` (undocumented; Mermaid's `state`): a rectangle as big as a
  // plain one with 5px corners the shape owns, as Mermaid's handler asks
  // for. **A recorded divergence:** that handler calls `drawRect` without
  // the label padding it needs, so Mermaid 12.2.0 draws a `<rect>` sized
  // `NaN` and only the label shows (measured in Chrome); Siren draws the
  // rectangle the document names (CONTEXT.md, "When Mermaid itself is the
  // one drawing it wrongly").
  state: {
    box: (label) => label,
    frames: (box) => [rectFrame(box, { style: [{ property: "rx", value: "5px" }] })],
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
