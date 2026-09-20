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
   * Declares this node a frame rather than a box: the children that name it
   * as `parentId` are laid out inside it, and it is placed as a cluster
   * rather than as an ordinary node.
   *
   * **What comes back for it is the box the engine placed for that cluster,
   * and nothing stronger than that.** It is *not* guaranteed to have been
   * computed from the children, and it is *not* guaranteed to enclose them.
   * Both halves of that were measured directly against `@dagrejs/dagre@3.1.1`
   * at this seam (`01M2YKWQP`) — every box handed in 60x40, graph `TB`,
   * `O > I > {A, B}` with `C` beside `I` under `O`, edges `A -> B` and
   * `A -> C`:
   *
   * | directions | `I` comes back as | `A` | `B` | `I` holds them |
   * | --- | --- | --- | --- | --- |
   * | neither frame declares one | (130,25) 140x180 | (165,50) | (175,140) | yes |
   * | `O` is `LR`, `I` declares none | (0,0) **60x40** | (0,**-45**) | (0,45) | no |
   * | `O` is `LR`, `I` is `TB` | (0,0) **60x40** | (0,**-45**) | (0,45) | no |
   *
   * The first row is the promise this field used to make outright, and it is
   * still what happens whenever no cluster *above* this one carries a
   * direction: the `width`/`height` given here are discarded outright — a
   * two-member cluster handed 0x0, 60x60 or 500x500 comes back 130x180 all
   * three times — and the box is grown to hold the members. That is a
   * discard, not a floor, which is the other reason this field's old wording
   * was no guide: the number given here neither survives nor bounds anything
   * the engine computes. Carrying a direction is not
   * itself what breaks it: a cluster with nothing nesting it comes back
   * 170x40 for `LR` and 60x130 for `TB`, computed from its children and
   * enclosing them both times.
   *
   * In the other two rows the 60x40 that comes back **is the 60x40 that went
   * in** — the engine never sized this cluster at all — and its members sit
   * at negative coordinates outside it. The engine expands a cluster carrying
   * a direction exactly one level (see `rankdirFor`, which is why those
   * members have coordinates to be outside the box *with*), and the frame it
   * stopped at keeps whatever size it was handed.
   *
   * **So a caller must grow its own frame from the contents; this box is one
   * input to that, never the answer.** All three adapters already do exactly
   * that, and none of them is being defensive: `subgraphFrames`
   * (`layoutGraph.ts`), `compositeFrames` (`layoutStateDiagram.ts`) and
   * `namespaceFrame` (`layoutClassDiagram.ts`) each take the union of this
   * box with every box it holds before adding their own padding and title
   * strip. **That union is required, not merely conservative.** Anyone
   * reading one of them as redundant and deleting the members from it would
   * draw a 60x40 frame with its whole contents outside, for exactly the
   * documents in rows two and three — a flowchart `subgraph` inside a
   * `subgraph` that declared a `direction`, which is ordinary Mermaid.
   *
   * Each adapter has to compute a frame of its own regardless, because
   * padding and title strips are that diagram kind's visual decisions and a
   * shared layout seam cannot know whether there is a title or how much room
   * it wants. Taking the union while already there is what costs nothing and
   * buys correctness. `layoutDirectedGraph.test.ts` pins the table above so
   * that a future dagre upgrade making these boxes genuinely enclosing turns
   * up as a red test rather than as silence.
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
  /**
   * The node this edge leaves, **or a cluster node it leaves the frame of**.
   * A cluster endpoint is routed through a representative member and the
   * route handed back is clipped to the frame's own box — see
   * `representativeOf` and `clipRouteEndToBox` for what that costs and why
   * it is done here rather than by the caller.
   */
  from: string;
  /** The node this edge arrives at, on the same terms as `from`. */
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

/** Whether `point` lies strictly within `box` — on the boundary is not inside. */
function strictlyInside(box: DirectedGraphLayoutNodeBox, point: Point): boolean {
  return (
    point.x > box.x &&
    point.x < box.x + box.width &&
    point.y > box.y &&
    point.y < box.y + box.height
  );
}

/**
 * `points` with one end moved out onto `box`'s own boundary: the run of
 * points lying inside `box` at that end is dropped, and the place the route
 * crosses out of the box is put in their place.
 *
 * **Exported because the frame a caller draws may be bigger than the box
 * this module placed.** `layoutGraph` grows a subgraph's frame outward from
 * the cluster box — padding all round, and a title strip along the top — so
 * an edge clipped here to the cluster box would end up *inside* the drawn
 * frame by exactly that much. Rather than teach this module about title
 * strips, the growing caller re-clips with the same function against the box
 * it actually draws. One implementation, applied twice in two coordinate
 * spaces, instead of two implementations free to disagree about what "on the
 * boundary" means.
 *
 * The crossing point is `boundaryPoint`'s — a ray from the box's centre
 * toward the first point outside it — rather than the exact intersection of
 * the polyline's own crossing segment with the box. The two agree whenever
 * the route leaves along the axis it was ranked on, which is every case
 * dagre produces for an edge between two ranks, and where they differ the
 * answer is still a point on the boundary in the direction the route is
 * travelling.
 *
 * A route lying wholly inside the box is returned untouched: there is no
 * point outside to aim at, and the only construct that produces one is a
 * self-edge on a cluster, whose loop dagre draws around the representative
 * member.
 */
export function clipRouteEndToBox(
  points: readonly Point[],
  box: DirectedGraphLayoutNodeBox,
  end: "start" | "end",
): Point[] {
  const ordered = end === "start" ? [...points] : [...points].reverse();

  let first = 0;
  while (first < ordered.length && strictlyInside(box, ordered[first])) {
    first++;
  }
  if (first === ordered.length) {
    return [...points];
  }

  const outside = ordered[first];
  const crossing = boundaryPoint(box, outside.x, outside.y);
  const kept = ordered.slice(first);
  const clipped =
    crossing.x === outside.x && crossing.y === outside.y ? kept : [crossing, ...kept];

  return end === "start" ? clipped : clipped.reverse();
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
 * Thrown by `layoutDirectedGraph` when the engine handed back something other
 * than a finite box for a node it was given — no entry at all, or an entry
 * whose `x`, `y`, `width` or `height` is `undefined`, `NaN` or infinite.
 *
 * **A thrown error rather than a diagnostic returned alongside a result,
 * because there is no result.** Every other stage of this pipeline reports
 * problems as `Diagnostic`s it accumulates and carries on with, which works
 * because those problems are *local*: one unresolved timeline reference costs
 * that reference and nothing else. A node with no coordinates is not local —
 * the graph's own bounds are computed over it, so it takes the `<svg>`'s
 * `width`, `height` and `viewBox` down with it, and every edge routed to it.
 * There is no partial picture left to hand back, so this module has nothing
 * to return and says so in the one way a function with no answer can.
 *
 * `render()` catches it at each of its three layout call sites and converts
 * it to the error-severity diagnostic an author sees; `Diagnostic`'s contract
 * — returned from `render()`, never thrown — is therefore unchanged. This
 * type is exported for that conversion and for nothing else: a caller
 * matching on it by name is matching on "this document cannot be laid out",
 * which is the whole of its meaning.
 */
export class UnplacedNodesError extends Error {
  /** The nodes the engine left without coordinates, in the caller's own order. */
  readonly nodeIds: readonly string[];

  constructor(nodeIds: readonly string[]) {
    super(
      `Layout produced no coordinates for ${nodeIds
        .map((id) => `"${id}"`)
        .join(", ")}. The known cause is a cluster carrying a direction of ` +
        `its own that has another cluster as a direct child: the layout ` +
        `engine expands such a cluster exactly one level, leaving the nested ` +
        `frame unexpanded and everything inside it unplaced (01M2WQV0). ` +
        `This document cannot be drawn.`,
    );
    this.name = "UnplacedNodesError";
    this.nodeIds = nodeIds;
  }
}

/** Whether the engine really placed this node: four finite numbers, not `undefined`. */
function isPlaced(placed: { x?: number; y?: number; width?: number; height?: number } | undefined): boolean {
  return (
    placed !== undefined &&
    Number.isFinite(placed.x) &&
    Number.isFinite(placed.y) &&
    Number.isFinite(placed.width) &&
    Number.isFinite(placed.height)
  );
}

/**
 * The single call site for `@dagrejs/dagre` in the pipeline. Takes sizes,
 * returns coordinates: it measures no text, knows no diagram kind, and sees
 * no labels, shapes or timelines. Pure and deterministic.
 *
 * Throws `UnplacedNodesError` when the engine did not place every node it was
 * given. See that type for why this one failure is a throw rather than a
 * value.
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

  // Which nodes have children, and each node by its id. Both are needed
  // *before* the nodes go in, because what direction a cluster is laid out in
  // depends on what the clusters above it declared — see `rankdirFor`.
  const childrenOf = new Map<string, DirectedGraphLayoutNode[]>();
  for (const node of input.nodes) {
    if (node.parentId !== undefined) {
      childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
    }
  }
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));

  /**
   * The direction this node's own children are laid out in: what the caller
   * declared, or — for a cluster inside one that declared a direction — the
   * **graph's own** `rankdir`.
   *
   * That second case is compensation for the engine, and both halves of it
   * are measured. A cluster carrying a `rankdir` has its children expanded
   * exactly one level: a child that is itself a cluster is kept at the size it
   * was handed and everything below it is never positioned at all
   * (`01M2WQV0`). Giving that child a `rankdir` of its own is what makes the
   * engine expand it too — the single difference between the combination that
   * fails and the three around it that do not.
   *
   * **The value is the graph's direction rather than the parent's**, and that
   * is Mermaid's meaning rather than a convenient default: mermaid 11.17.2
   * draws `Outer` with `direction LR` holding an `Inner` with none by putting
   * `Inner`'s two members in one *column* (`A` and `B` at the same x) and
   * `Inner` beside `C`. A frame that says nothing about its direction takes
   * the document's, and the enclosing frame's `LR` governs only its own rank.
   *
   * Nothing is added where nothing is broken: a graph with no direction
   * declared on any cluster keeps every `rankdir` absent and stays on the
   * engine's ordinary compound path, placing exactly what it placed before.
   */
  const rankdirFor = (node: DirectedGraphLayoutNode): Direction | undefined => {
    if (node.rankdir !== undefined) return node.rankdir;
    if (!childrenOf.has(node.id)) return undefined;
    return hasDirectedAncestor(node) ? input.rankdir : undefined;
  };

  /**
   * Whether any cluster above `node` declared a direction of its own.
   *
   * **Any ancestor, not the parent**, because the engine's one level of
   * expansion applies at every depth: a compensation that reached only the
   * children of the cluster that declared the direction would hand *those*
   * children a `rankdir`, which makes each of them a cluster-with-a-direction
   * whose own cluster children are then the ones left unexpanded. The defect
   * would move one level down per level of nesting rather than go away —
   * measured, on three levels of cluster with the direction written at the
   * top.
   */
  const hasDirectedAncestor = (node: DirectedGraphLayoutNode): boolean => {
    for (
      let ancestor = node.parentId === undefined ? undefined : nodeById.get(node.parentId);
      ancestor !== undefined;
      ancestor =
        ancestor.parentId === undefined ? undefined : nodeById.get(ancestor.parentId)
    ) {
      if (ancestor.rankdir !== undefined) return true;
    }
    return false;
  };

  for (const node of input.nodes) {
    const rankdir = rankdirFor(node);
    g.setNode(node.id, {
      width: node.width,
      height: node.height,
      ...(rankdir === undefined ? {} : { rankdir }),
    });
  }

  // Parentage is assigned only once every node exists, so a cluster may be
  // declared after the children that name it.
  for (const node of input.nodes) {
    if (node.parentId !== undefined) {
      g.setParent(node.id, node.parentId);
    }
  }

  // Which node stands in for which endpoint. An edge whose endpoint is a
  // cluster cannot be handed to dagre as written — `dagre.layout()` throws
  // `Cannot set properties of undefined (setting 'rank')`, verified directly
  // against `@dagrejs/dagre@3.1.1` — so the cluster is swapped for one of its
  // own members on the way in and the route is clipped back to the frame on
  // the way out. That is Mermaid's own strategy for the same construct
  // (`findNonClusterChild` in its `mermaid-graphlib.js`), reached
  // independently here because dagre offers no flag to turn the behavior on.
  // The parentage it reads is `childrenOf`, built above for `rankdirFor`.

  /**
   * The node dagre is handed in `id`'s place: `id` itself unless it has
   * children, and otherwise the **first leaf below it in a depth-first walk
   * of the caller's own node order**.
   *
   * Two things make that the choice rather than a nicer-sounding one. It is
   * a *leaf*, because a leaf is exactly what dagre treats as an ordinary
   * node — clusterhood is not `isCluster` here but "something named me as
   * its parent", so a childless cluster needs no proxy at all and gets none.
   * And it is the *first* such leaf in input order, because the caller's
   * order is the author's order and nothing else about the graph is stable
   * enough to choose by: picking by placement would depend on the layout
   * this call is computing.
   *
   * Which member it is never shows in the picture — the route is clipped to
   * the frame before it is returned — so the choice decides only which side
   * of the frame the edge leaves from, and it decides it the same way every
   * run.
   */
  const representativeOf = (id: string): string => {
    const children = childrenOf.get(id);
    return children === undefined ? id : representativeOf(children[0].id);
  };

  const proxied = input.edges.map((edge) => ({
    edge,
    from: representativeOf(edge.from),
    to: representativeOf(edge.to),
  }));

  for (const { edge, from, to } of proxied) {
    g.setEdge(
      from,
      to,
      {
        ...(edge.label ? { width: edge.label.width, height: edge.label.height } : {}),
        ...(edge.minlen === undefined ? {} : { minlen: edge.minlen }),
      },
      edge.id,
    );
  }

  dagre.layout(g);

  // Checked before a single subtraction, and checked for *finiteness* rather
  // than for the construct that is known to produce it. `undefined - 30` is
  // `NaN`, and `NaN` propagates silently through every arithmetic step below
  // it — into the boxes, into the routes computed from them, and into the
  // bounds computed from those — so the only place this can be caught while
  // it still names something is here, at the boundary where the engine's
  // answer arrives. Testing the *shape of the answer* also means any future
  // source of a missing coordinate is caught by the same line, rather than by
  // a second special case written after the next silent mis-render is found.
  const placements = input.nodes.map((node) => ({ node, placed: g.node(node.id) }));
  const unplaced = placements
    .filter(({ placed }) => !isPlaced(placed))
    .map(({ node }) => node.id);
  if (unplaced.length > 0) {
    throw new UnplacedNodesError(unplaced);
  }

  const nodes = placements.map(({ node, placed }) => ({
    id: node.id,
    x: placed.x - placed.width / 2,
    y: placed.y - placed.height / 2,
    width: placed.width,
    height: placed.height,
  }));

  // Keyed for the fallback below: an edge with either endpoint inside a
  // per-cluster `rankdir` never gets `points` back from
  // `recursiveClusterLayout` (verified directly against `@dagrejs/dagre`:
  // node positions come back correct, but every edge touching that cluster's
  // descendants — inside it or crossing its boundary — comes back with an
  // empty label, `{}`, no matter how deep the nesting). Dagre's own
  // undocumented gap, not this module's; the fallback below is what keeps a
  // subgraph's own `direction` from taking its members' edges down with it.
  const boxById = new Map(nodes.map((node) => [node.id, node]));

  const edges = proxied.map<DirectedGraphLayoutEdgeRoute>(({ edge, from, to }) => {
    const routed = g.edge(from, to, edge.id);
    // The fallback is drawn between the boxes the *caller* named, not
    // between the proxies: a cluster endpoint's own box is what the edge is
    // meant to touch, so the straight line already arrives where the clip
    // below would have put it.
    const routedPoints: Point[] =
      routed.points ??
      straightLineRoute(boxById.get(edge.from)!, boxById.get(edge.to)!);

    // Back out of the proxy. Dagre routed from a *member* of the frame, so
    // the run of the route still inside the frame is what the picture must
    // not show; clipping each proxied end to its own cluster box is what
    // turns an edge between two members into an edge between two frames.
    let points = routedPoints.map((p: Point) => ({ x: p.x, y: p.y }));
    if (from !== edge.from) {
      points = clipRouteEndToBox(points, boxById.get(edge.from)!, "start");
    }
    if (to !== edge.to) {
      points = clipRouteEndToBox(points, boxById.get(edge.to)!, "end");
    }

    const route: DirectedGraphLayoutEdgeRoute = { id: edge.id, points };
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
