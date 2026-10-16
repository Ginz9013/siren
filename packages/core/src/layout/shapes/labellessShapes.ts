import type { NodeShape } from "../../contracts";
import { closedPath, edgesOf, FRAME_PAINT, pathFrame, type Rect, type ShapeFrame, type ShapeSpec, type Size } from "./shape";

/**
 * Shape-table records for the shapes Mermaid 12.2.0 draws at a fixed size
 * and with no text: its handler empties the node's label before drawing,
 * so a label is never shown (the parser refuses one written for them).
 * Each box is the handler's own constant, whatever the label measures.
 *
 * Painted as Mermaid 12.2.0 paints them in its classic look, measured in
 * Chrome: where a handler asks for its line colour as a fill, the
 * stylesheet's node rule outranks it and the shape is drawn in the node's
 * fill, so only the filled circle is drawn in the line colour.
 */

/** A fork's bar: `70` across the flow, `10` along it (Mermaid's `forkJoin`). */
const FORK_LENGTH = 70;
const FORK_THICKNESS = 10;

/** How far apart a lightning bolt's two halves cross its middle (Mermaid's `gap`). */
const BOLT_GAP = 7;

/** The side of a small, a framed and a filled circle (Mermaid's `14`). */
const STATE_CIRCLE = 14;

/** A square box of side `side`. */
function squareOf(side: number): Size {
  return { width: side, height: side };
}

/** A `<circle>` of radius `r` at the centre of `box`, painted with `classes`. */
function circleFrame(box: Rect, r: number, classes: readonly string[] = []): ShapeFrame {
  const { midX, midY } = edgesOf(box);
  return {
    element: "circle",
    attributes: [
      ["cx", midX],
      ["cy", midY],
      ["r", r],
    ],
    ...(classes.length === 0 ? {} : { classes }),
  };
}

export const LABELLESS_SHAPES = {
  // `fork` (`join`; Mermaid's `forkJoin`): a bar across the flow — lying
  // down when the flow runs top to bottom, upright when it runs left to
  // right. Square-cornered, so a `<path>` the theme's corner radius cannot
  // reach.
  fork: {
    box: (_label, direction) =>
      direction === "LR" || direction === "RL"
        ? { width: FORK_THICKNESS, height: FORK_LENGTH }
        : { width: FORK_LENGTH, height: FORK_THICKNESS },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
          ]),
        ),
      ];
    },
    drawsLabel: false,
  },
  // `hourglass` (`collate`): two triangles meeting at the centre, drawn as
  // Mermaid draws it — one closed path through the top edge, the diagonal,
  // the bottom edge and back up the other diagonal.
  hourglass: {
    box: () => ({ width: 30, height: 30 }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [left, top],
            [right, top],
            [left, bottom],
            [right, bottom],
          ]),
        ),
      ];
    },
    drawsLabel: false,
  },
  // `bolt` (`com-link`, `lightning-bolt`; Mermaid's `lightningBolt`): a
  // zigzag from the top right corner to the bottom left one, its two halves
  // `BOLT_GAP` apart where they cross the middle.
  bolt: {
    box: () => ({ width: 35, height: 70 }),
    frames: (box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [right, top],
            [left, midY + BOLT_GAP / 2],
            [right - 2 * BOLT_GAP, midY + BOLT_GAP / 2],
            [left, bottom],
            [right, midY - BOLT_GAP / 2],
            [left + 2 * BOLT_GAP, midY - BOLT_GAP / 2],
          ]),
        ),
      ];
    },
    drawsLabel: false,
  },
  // `sm-circ` (`start`; Mermaid's `stateStart`): a 14px circle.
  "small-circle": {
    box: () => squareOf(STATE_CIRCLE),
    frames: (box) => [circleFrame(box, box.width / 2)],
    drawsLabel: false,
  },
  // `fr-circ` (`stop`; Mermaid's `stateEnd`): a 14px circle with one
  // `5/14` of its width across at its centre, both painted alike.
  "framed-circle": {
    box: () => squareOf(STATE_CIRCLE),
    frames: (box) => [circleFrame(box, box.width / 2), circleFrame(box, (box.width * 5) / 14 / 2)],
    drawsLabel: false,
  },
  // `f-circ` (`junction`; Mermaid's `filledCircle`): a 14px circle filled
  // in the line colour — the one shape here Mermaid's stylesheet leaves
  // painted that way. An author's `fill` still repaints it, as Mermaid's
  // `style A fill:…` does (measured).
  "filled-circle": {
    box: () => squareOf(STATE_CIRCLE),
    frames: (box) => [circleFrame(box, box.width / 2, FRAME_PAINT.line)],
    drawsLabel: false,
  },
  // `anchor` (undocumented; Mermaid's `anchor`): a 2px dot, which Mermaid
  // fills black and Siren in the line colour.
  anchor: {
    box: () => squareOf(2),
    frames: (box) => [circleFrame(box, box.width / 2, FRAME_PAINT.line)],
    drawsLabel: false,
  },
  // `cross-circ` (`summary`; Mermaid's `crossedCircle`): a 60px circle and,
  // over it, its two diameters at 45 degrees — a path of two lines, which
  // has no area to fill.
  "crossed-circle": {
    box: () => squareOf(60),
    frames: (box) => {
      const { midX, midY } = edgesOf(box);
      const r = box.width / 2;
      const a = r * Math.SQRT1_2;
      return [
        circleFrame(box, r),
        pathFrame(`M${midX - a},${midY + a} L${midX + a},${midY - a} M${midX + a},${midY + a} L${midX - a},${midY - a}`),
      ];
    },
    drawsLabel: false,
  },
  // `choice` (undocumented; Mermaid's `choice`): a 28px diamond.
  choice: {
    box: () => squareOf(28),
    frames: (box) => {
      const { left, right, top, bottom, midX, midY } = edgesOf(box);
      return [
        pathFrame(
          closedPath([
            [midX, bottom],
            [right, midY],
            [midX, top],
            [left, midY],
          ]),
        ),
      ];
    },
    drawsLabel: false,
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
