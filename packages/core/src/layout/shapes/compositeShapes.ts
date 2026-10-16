import type { NodeShape } from "../../contracts";
import type { ShapeSpec } from "./shape";

/**
 * Shape-table records for the shapes drawn as a figure plus decorations (console, browser, person, bang, crossed circle, stacked and tagged documents).
 *
 * Empty until those shapes land. A shape added here, with its member in
 * `NodeShape` and its names in the parser's `SHAPE_NAMES`, is drawn
 * without any change to `layoutGraph.ts` or `renderToSVG.ts`: the
 * table in `shapeTable.ts` already spreads this record.
 */
export const COMPOSITE_SHAPES = {} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
