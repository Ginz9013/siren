import type { NodeShape } from "../../contracts";
import type { ShapeSpec } from "./shape";

/**
 * Shape-table records for the shapes that draw no text (fork, hourglass, bolt, the small circles, choice, anchor).
 *
 * Empty until those shapes land. A shape added here, with its member in
 * `NodeShape` and its names in the parser's `SHAPE_NAMES`, is drawn
 * without any change to `layoutGraph.ts` or `renderToSVG.ts`: the
 * table in `shapeTable.ts` already spreads this record.
 */
export const LABELLESS_SHAPES = {} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
