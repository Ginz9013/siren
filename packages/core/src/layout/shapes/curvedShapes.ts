import type { NodeShape } from "../../contracts";
import type { ShapeSpec } from "./shape";

/**
 * Shape-table records for the shapes whose outline is curved (cloud, documents, braces, wavy and rounded outlines).
 *
 * Empty until those shapes land. A shape added here, with its member in
 * `NodeShape` and its names in the parser's `SHAPE_NAMES`, is drawn
 * without any change to `layoutGraph.ts` or `renderToSVG.ts`: the
 * table in `shapeTable.ts` already spreads this record.
 */
export const CURVED_SHAPES = {} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
