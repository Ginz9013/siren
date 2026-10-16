import type { NodeShape } from "../../contracts";
import { BASIC_SHAPES } from "./basicShapes";
import { COMPOSITE_SHAPES } from "./compositeShapes";
import { CURVED_SHAPES } from "./curvedShapes";
import { ICON_SHAPES } from "./iconShapes";
import { IMAGE_SHAPES } from "./imageShapes";
import { LABELLESS_SHAPES } from "./labellessShapes";
import { POLYGON_SHAPES } from "./polygonShapes";
import type { ShapeSpec } from "./shape";

/**
 * Every node shape's record, one per member of `NodeShape` — the table
 * `layoutGraph` sizes a node's box and places its label from, and
 * `renderToSVG` draws its outline from.
 *
 * Gathered from one file per group of shapes, so that a group is added by
 * filling in its own file: the type below requires a record for every
 * member of `NodeShape`, so a shape named in the union and drawn by no
 * group fails to compile rather than to draw.
 */
export const SHAPES: { readonly [Shape in NodeShape]: ShapeSpec } = {
  ...BASIC_SHAPES,
  ...POLYGON_SHAPES,
  ...LABELLESS_SHAPES,
  ...CURVED_SHAPES,
  ...COMPOSITE_SHAPES,
  ...ICON_SHAPES,
  ...IMAGE_SHAPES,
};
