import dagre from "@dagrejs/dagre";
import type { Direction, Point } from "../contracts";

/** A box to place. Sizes are given by the caller; this module never measures. */
export interface DirectedGraphLayoutNode {
  id: string;
  width: number;
  height: number;
  /** Places this node inside the named cluster node. */
  parentId?: string;
  /**
   * Declares this node a frame rather than a box: its size is computed from
   * the children that name it as `parentId`, so the `width`/`height` given
   * here are ignored. The returned box is the frame enclosing those children.
   */
  isCluster?: boolean;
}

/** An edge to route between two nodes, addressed by the caller's own id. */
export interface DirectedGraphLayoutEdge {
  id: string;
  from: string;
  to: string;
  /**
   * Space to keep clear along the edge for a label. Given a size, the layout
   * pushes the ranks apart to make room and reports where the label goes as
   * the route's `labelAnchor`.
   */
  label?: { width: number; height: number };
}

/** Everything the shared layout core needs to place a directed graph. */
export interface DirectedGraphLayoutInput {
  rankdir: Direction;
  nodes: DirectedGraphLayoutNode[];
  edges: DirectedGraphLayoutEdge[];
}

/**
 * A placed box. `x`/`y` are its top-left corner (matching SVG `<rect x y>`);
 * the underlying engine reports centers and this module converts.
 */
export interface DirectedGraphLayoutNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A routed edge, in the same order as the input's edges. */
export interface DirectedGraphLayoutEdgeRoute {
  id: string;
  points: Point[];
  /** Centre of the space reserved for the label. Absent when none was asked for. */
  labelAnchor?: Point;
}

/** The placed graph: boxes, routes, and the overall bounds enclosing them. */
export interface DirectedGraphLayoutResult {
  nodes: DirectedGraphLayoutNodeBox[];
  edges: DirectedGraphLayoutEdgeRoute[];
  width: number;
  height: number;
}

/**
 * The single call site for `@dagrejs/dagre` in the pipeline. Takes sizes,
 * returns coordinates: it measures no text, knows no diagram kind, and sees
 * no labels, shapes or timelines. Pure and deterministic.
 *
 * Keeping every dagre interaction here is what ADR-0001 means by layout math
 * being an implementation detail behind our own seam.
 */
export function layoutDirectedGraph(
  input: DirectedGraphLayoutInput,
): DirectedGraphLayoutResult {
  // Compound mode is switched on only when the caller actually declares a
  // cluster. It is not free: with it on, dagre reserves extra horizontal room
  // for self-edges, which shifts the routing and the graph width of graphs
  // that have no clusters at all. Graphs that declare no parentage therefore
  // keep the exact placement they had before clusters were supported.
  const hasClusters = input.nodes.some(
    (node) => node.parentId !== undefined || node.isCluster === true,
  );

  const g = new dagre.graphlib.Graph({
    multigraph: true,
    compound: hasClusters,
  });
  g.setGraph({ rankdir: input.rankdir });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of input.nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  // Parentage is assigned only once every node exists, so a cluster may be
  // declared after the children that name it.
  for (const node of input.nodes) {
    if (node.parentId !== undefined) {
      g.setParent(node.id, node.parentId);
    }
  }

  for (const edge of input.edges) {
    g.setEdge(
      edge.from,
      edge.to,
      edge.label ? { width: edge.label.width, height: edge.label.height } : {},
      edge.id,
    );
  }

  dagre.layout(g);

  const nodes = input.nodes.map((node) => {
    const placed = g.node(node.id);
    return {
      id: node.id,
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
      width: placed.width,
      height: placed.height,
    };
  });

  const edges = input.edges.map<DirectedGraphLayoutEdgeRoute>((edge) => {
    const routed = g.edge(edge.from, edge.to, edge.id);
    const route: DirectedGraphLayoutEdgeRoute = {
      id: edge.id,
      points: routed.points.map((p: Point) => ({ x: p.x, y: p.y })),
    };
    if (edge.label) {
      route.labelAnchor = { x: routed.x, y: routed.y };
    }
    return route;
  });

  const graphLabel = g.graph();

  return {
    nodes,
    edges,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}
