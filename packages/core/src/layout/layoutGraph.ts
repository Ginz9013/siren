import type { GraphModel, LayoutOptions, NodeShape, PositionedGraph } from "../contracts";
import { layoutDirectedGraph } from "./layoutDirectedGraph";

/** A measured label, and the bounding box a shape needs to hold one. */
interface Box {
  width: number;
  height: number;
}

/**
 * How much bounding box `shape` needs so that a `label`-sized text box fits
 * **inside the drawn outline**, rather than inside the box that outline is
 * inscribed in.
 *
 * This is the whole reason node shapes are not a renderer-only change, and
 * the one answer every shape after the diamond inherits. A rectangle *is*
 * its bounding box, so a rectangle can take the measured label unchanged;
 * every other shape is inscribed in that box and therefore cuts corners off
 * it. A diamond that circumscribed its text box the way a rectangle does
 * would cross its own label on all four diagonals.
 *
 * **The rule: the smallest box in which this shape, inscribed, still
 * contains the measured label — keeping the label's own proportions.** It is
 * a function of the label rather than a constant added to it, so a
 * one-character node stays small and a long one grows, and it is expressible
 * for every shape on the board: a hexagon's slanted ends and a circle's
 * diameter are the same question asked of a different outline.
 *
 * For a rhombus the arithmetic is exact. A diamond inscribed in `W x H` is
 * the set `|x| / (W/2) + |y| / (H/2) <= 1` about the centre, so a centred
 * `w x h` label fits exactly when `w/W + h/H <= 1`; at `W = 2w, H = 2h` that
 * sum is 1 and the label's corners lie **on** the outline. That is the
 * minimum, and it is enough because what was measured is the glyphs plus the
 * theme's padding — the corners that touch belong to the padding, not to the
 * text.
 *
 * The proportions are Siren's, not Mermaid's: the board's decision 1 says a
 * shape's *kind* is the compatibility contract and its geometry belongs to
 * the theme, exactly as ADR-0004 already says for colour and spacing.
 */
function boxForLabel(shape: NodeShape, label: Box): Box {
  switch (shape) {
    case "rhombus":
      return { width: label.width * 2, height: label.height * 2 };
    default:
      // A rectangle is its own bounding box. Every other member of
      // `NodeShape` is a spelling the parser still refuses, so none of them
      // can reach here — each arrives with the ticket that draws it, and
      // adds the case that sizes it.
      return label;
  }
}

/**
 * Computes node positions and edge paths for a resolved `GraphModel`.
 *
 * This is the flowchart adapter over `layoutDirectedGraph`: it measures each
 * node's label, asks the node's shape how much bounding box that label needs
 * (`boxForLabel`), hands the resulting sizes to the shared layout core, and
 * reattaches the flowchart's own data (labels, shapes, the resolved timeline)
 * to the coordinates that come back. All graph-layout math — and the only
 * dependency on the layout engine — lives in the shared core.
 *
 * `PositionedNode.x/y` are the top-left corner of the node's bounding box,
 * as the core returns them, so renderer code can place a `<rect>` directly.
 */
export function layoutGraph(
  graph: GraphModel,
  options: LayoutOptions,
): PositionedGraph {
  const laidOut = layoutDirectedGraph({
    rankdir: graph.direction,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      // The shape decides how much box the measured label needs; the shared
      // layout core is handed sizes and never learns a shape exists.
      ...boxForLabel(node.shape, options.measureText.measure(node.label)),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
    })),
  });

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

  const nodes = graph.nodes.map((node) => {
    const box = boxById.get(node.id)!;
    return {
      ...node,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });

  const edges = graph.edges.map((edge) => ({
    ...edge,
    points: routeById.get(edge.id)!.points,
  }));

  return {
    direction: graph.direction,
    nodes,
    edges,
    timeline: graph.timeline,
    width: laidOut.width,
    height: laidOut.height,
  };
}
