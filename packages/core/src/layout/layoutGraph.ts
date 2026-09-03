import dagre from "@dagrejs/dagre";
import type {
  GraphModel,
  LayoutOptions,
  PositionedGraph,
} from "../contracts";

/**
 * Computes node positions and edge paths for a resolved `GraphModel` using
 * `@dagrejs/dagre` for rank/position assignment. `PositionedNode.x/y` are
 * the top-left corner of the node's bounding box (dagre itself reports
 * node centers; this module converts to top-left so downstream renderer
 * code can place a `<rect>` directly).
 */
export function layoutGraph(
  graph: GraphModel,
  options: LayoutOptions,
): PositionedGraph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: graph.direction });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const { width, height } = options.measureText.measure(node.label);
    g.setNode(node.id, { width, height });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to, {}, edge.id);
  }

  dagre.layout(g);

  const nodes = graph.nodes.map((node) => {
    const laidOut = g.node(node.id);
    return {
      ...node,
      x: laidOut.x - laidOut.width / 2,
      y: laidOut.y - laidOut.height / 2,
      width: laidOut.width,
      height: laidOut.height,
    };
  });

  const edges = graph.edges.map((edge) => {
    const laidOut = g.edge(edge.from, edge.to, edge.id);
    return {
      ...edge,
      points: laidOut.points.map((p: { x: number; y: number }) => ({
        x: p.x,
        y: p.y,
      })),
    };
  });

  const graphLabel = g.graph();

  return {
    direction: graph.direction,
    nodes,
    edges,
    timeline: graph.timeline,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}
