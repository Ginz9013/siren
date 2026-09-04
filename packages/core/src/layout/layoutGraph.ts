import type {
  Direction,
  GraphModel,
  LayoutOptions,
  PositionedGraph,
} from "../contracts";
import {
  layoutDirectedGraph,
  type RankDirection,
} from "./layoutDirectedGraph";

/**
 * Maps the flowchart header's direction vocabulary onto the shared layout
 * core's rank directions. Mermaid writes top-down as `TD`; the graph
 * literature — and `layoutDirectedGraph` — calls it `TB`.
 */
function rankDirectionFor(direction: Direction): RankDirection {
  return direction === "LR" ? "LR" : "TB";
}

/**
 * Computes node positions and edge paths for a resolved `GraphModel`.
 *
 * This is the flowchart adapter over `layoutDirectedGraph`: it measures each
 * node's label, hands the resulting sizes to the shared layout core, and
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
    rankdir: rankDirectionFor(graph.direction),
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      ...options.measureText.measure(node.label),
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
