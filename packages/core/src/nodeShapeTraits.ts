import type { NodeShape } from "./contracts";

/**
 * What the parser and the shape table both need to know about a flowchart
 * node shape, kept here so that neither has to read the other: the parser
 * refuses what a shape would not draw, and the shape table draws it so.
 */

/**
 * The shapes drawn at a fixed size and with no text: a label written for
 * one would not be shown, so the parser refuses it and the shape table's
 * record says `drawsLabel: false`.
 */
export const SHAPES_DRAWN_WITHOUT_TEXT: ReadonlySet<NodeShape> = new Set<NodeShape>([
  "fork",
  "hourglass",
  "bolt",
  "small-circle",
  "framed-circle",
  "filled-circle",
  "crossed-circle",
  "choice",
  "anchor",
]);

/**
 * The shapes an author's `style`, `class` or `:::` on the node does not
 * change: drawn in their own paint whatever is declared for them, so the
 * parser refuses a declaration aimed at one by name.
 */
export const SHAPES_TAKING_NO_STYLE: ReadonlySet<NodeShape> = new Set<NodeShape>(["small-circle", "anchor"]);

/** An icon's size when its node gives none: Mermaid's `assetHeight ?? 48`. */
export const DEFAULT_ICON_SIZE = 48;
