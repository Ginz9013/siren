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
  /**
   * Lays this cluster's own children out in this direction, independent of
   * the outer graph's `rankdir` — dagre's `recursiveClusterLayout`, switched
   * on for exactly this node by giving it a `rankdir` of its own (verified
   * directly against `@dagrejs/dagre` before this field existed: a cluster
   * node carrying `rankdir` gets its children laid out as a sub-graph of
   * their own, then integrated back as a fixed-size block). Meaningless on a
   * node that is not a cluster, and absent for one that is when its members
   * take the outer graph's own direction, exactly as before this field
   * existed.
   */
  rankdir?: Direction;
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
  /**
   * How many ranks apart this edge must hold its endpoints. Absent means
   * one — the engine's own default — so a caller with no notion of edge
   * length passes nothing and gets the placement it always had.
   *
   * Spelled with dagre's own word, like `rankdir` above and for the same
   * reason: this seam is where the engine's vocabulary is allowed, and
   * nowhere else. A flowchart edge carries it as `minLength`, which is
   * what it means rather than what dagre calls it.
   */
  minlen?: number;
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

/** The middle of the segment from `a` to `b`. */
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Where the straight line from `box`'s centre to the point `(towardX,
 * towardY)` crosses `box`'s own boundary — the classic rectangle/ray
 * intersection, scaling the direction vector down by whichever of the two
 * half-extents it would first cross.
 */
function boundaryPoint(
  box: DirectedGraphLayoutNodeBox,
  towardX: number,
  towardY: number,
): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }
  const scale = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * A two-point straight route between two boxes, clipped to each box's own
 * boundary — the fallback for the one case dagre's `recursiveClusterLayout`
 * does not route at all (see the call site).
 *
 * **An approximation of dagre's own routing, and the reason it is a safe one
 * is measured rather than argued.** Dagre drops the *routes* for these edges
 * but still runs its *positioning* phase over them: the ranks it would have
 * bent a route through are still spread apart to make room for it. Probed
 * directly against `@dagrejs/dagre@3.1.1` with the shapes that would break a
 * naive straight line — a five-node chain with a four-rank skip edge across
 * it, three branches converging on one node, and an edge crossing into the
 * cluster from outside — and in every one the straight centre-to-centre
 * segment stays clear of every other node's box, because the skipped ranks
 * were displaced to leave exactly that lane open.
 *
 * What it is *not* is dagre's own bent polyline: an edge that dagre would
 * have drawn with a bend here is drawn as one segment instead. That is a
 * simplification of the same connection between the same two boxes, not a
 * different picture — and it is confined to a construct that drew no picture
 * at all until this field existed.
 */
function straightLineRoute(
  from: DirectedGraphLayoutNodeBox,
  to: DirectedGraphLayoutNodeBox,
): Point[] {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  return [
    boundaryPoint(from, toCenter.x, toCenter.y),
    boundaryPoint(to, fromCenter.x, fromCenter.y),
  ];
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
    g.setNode(node.id, {
      width: node.width,
      height: node.height,
      ...(node.rankdir === undefined ? {} : { rankdir: node.rankdir }),
    });
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
      {
        ...(edge.label ? { width: edge.label.width, height: edge.label.height } : {}),
        ...(edge.minlen === undefined ? {} : { minlen: edge.minlen }),
      },
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

  // Keyed for the fallback below: an edge with either endpoint inside a
  // per-cluster `rankdir` never gets `points` back from
  // `recursiveClusterLayout` (verified directly against `@dagrejs/dagre`:
  // node positions come back correct, but every edge touching that cluster's
  // descendants — inside it or crossing its boundary — comes back with an
  // empty label, `{}`, no matter how deep the nesting). Dagre's own
  // undocumented gap, not this module's; the fallback below is what keeps a
  // subgraph's own `direction` from taking its members' edges down with it.
  const boxById = new Map(nodes.map((node) => [node.id, node]));

  const edges = input.edges.map<DirectedGraphLayoutEdgeRoute>((edge) => {
    const routed = g.edge(edge.from, edge.to, edge.id);
    const points: Point[] =
      routed.points ??
      straightLineRoute(boxById.get(edge.from)!, boxById.get(edge.to)!);
    const route: DirectedGraphLayoutEdgeRoute = {
      id: edge.id,
      points: points.map((p: Point) => ({ x: p.x, y: p.y })),
    };
    if (edge.label) {
      route.labelAnchor =
        routed.x === undefined || routed.y === undefined
          ? midpoint(points[0], points[points.length - 1])
          : { x: routed.x, y: routed.y };
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
