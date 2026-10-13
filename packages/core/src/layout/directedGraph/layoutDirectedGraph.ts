/**
 * The shared layout core, on ELK: takes boxes, clusters and edges with their
 * sizes, and hands back where everything goes — boxes, the frame around each
 * cluster, and routes. It measures no text, knows no diagram kind, and draws
 * nothing — the same seam the dagre core in `../layoutDirectedGraph.ts` has
 * kept since ADR-0001, with a different engine behind it. The flowchart
 * reaches it through `layoutGraph`; class, state and ER diagrams stay on the
 * dagre core until each moves onto ELK, after which this module moves back to
 * that path and keeps this name.
 *
 * The engine is ELK's `layered` algorithm (elkjs, reached only through
 * `elkSync.ts`), configured as Mermaid 12.2.0 configures it for its own
 * default layout — see `ROOT_OPTIONS` and `CLUSTER_OPTIONS` for every option
 * and where it was read. Mermaid 12 is the baseline (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 1): what the picture looks like is
 * Mermaid's to decide, and where Siren departs from it the departure is
 * measured and written down beside the code that departs.
 */
import type { Direction, LineHop, Point } from "../../contracts";
import { LayoutEngineError, layoutWithElk, type ElkExtendedEdge, type ElkNode } from "./elkSync";
import { lineHops } from "./lineHops";

/** A box to place. Sizes are given by the caller; this module never measures. */
export interface DirectedGraphNode {
  id: string;
  width: number;
  height: number;
  /** The cluster this box (or cluster) sits inside, by that cluster's id. */
  parentId?: string;
  /**
   * Declares this node a **cluster**: the engine draws a frame around the
   * nodes that name it as their `parentId`, sized to hold them.
   * `width`/`height` are then ignored — the frame is as large as what it
   * holds, its padding and its title make it, and never smaller than its
   * title and padding.
   */
  cluster?: DirectedGraphCluster;
}

/** What makes a node a cluster: the room its frame keeps around its members, and its title. */
export interface DirectedGraphCluster {
  /** The gap between the frame and everything it holds, on every side. */
  padding: number;
  /**
   * The title's measured size. The frame keeps a band across its top for it
   * — padding, the title, padding again — and is at least as wide as the
   * title plus its padding on both sides.
   */
  title?: { width: number; height: number };
  /**
   * The direction the cluster lays its own members out in, when it declares
   * one. It holds only while no edge makes the cluster give it up — see
   * `voidedDirections` for the rule, which is Mermaid's.
   */
  direction?: Direction;
}

/** An edge to route between two boxes, addressed by the caller's own ids. */
export interface DirectedGraphEdge {
  id: string;
  from: string;
  to: string;
  /**
   * The size of the edge's label, when it has one. ELK keeps that much room
   * on the line itself and reports where it put it (`labelAnchor`).
   */
  label?: { width: number; height: number };
  /**
   * How many layers apart the edge holds its ends: `A ----> B` is 3. Absent
   * means 1, ELK's own. See `chainOf` for how a longer edge is held apart
   * and why it is a departure from Mermaid 12.
   */
  minLength?: number;
  /**
   * The radius the edge's corners will be drawn rounded with, when they will
   * be — 5 for the `rounded` curve (`ROUNDED_CORNER_RADIUS`); absent when
   * they are drawn sharp. Routing ignores it; the line hops read it, to keep
   * clear of the rounding (see `lineHops`).
   */
  cornerRadius?: number;
}

/** Everything the core needs to place a directed graph. */
export interface DirectedGraphInput {
  direction: Direction;
  /**
   * Every box and cluster, **in the model's order** — the order is input, not
   * presentation: ELK is asked to keep it (`considerModelOrder`), so two
   * siblings with nothing else to tell them apart are laid out in the order
   * they arrive here.
   */
  nodes: DirectedGraphNode[];
  /** Every edge, in the model's order, for the same reason. */
  edges: DirectedGraphEdge[];
}

/** A placed box, by its top-left corner (an SVG `<rect x y>`). */
export interface DirectedGraphNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A cluster's title centre, in the band across its frame's top. Absent for a plain box and an untitled cluster. */
  title?: Point;
}

/** A routed edge. */
export interface DirectedGraphEdgeRoute {
  id: string;
  points: Point[];
  /** Centre of the room kept for the label, on the route. Absent when the edge has no label. */
  labelAnchor?: Point;
  /**
   * Where this route jumps another that crosses it, in the order the route
   * meets them: the **line hops**, by Mermaid 12's rule (nook decision
   * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 7; see `lineHops`). They are read
   * off the finished routes and change none of them; whether they are drawn
   * is the renderer's call, by the edge's curve.
   */
  hops: LineHop[];
}

/** The placed graph: boxes and routes in their input order, and the extent that holds them. */
export interface DirectedGraphResult {
  nodes: DirectedGraphNodeBox[];
  edges: DirectedGraphEdgeRoute[];
  width: number;
  height: number;
}

/**
 * The room left around the whole drawing, on all four sides: 8, which is the
 * margin Siren's dagre core kept (`DAGRE_MARGIN`) and the one Mermaid 12.2.0
 * leaves around its own ELK drawings — measured in headless Chrome, a lone
 * `A --> B` draws its first box at (8, 8) of the picture. Mermaid gets there
 * by padding the SVG's bounding box afterwards; here it is the root graph's
 * own padding, so the extent ELK reports already includes it.
 */
export const LAYOUT_MARGIN = 8;

/** Mermaid's `dir2ElkDirection` (`elk-V4PLJRSU.mjs`, mermaid 12.2.0). */
const ELK_DIRECTION: Record<Direction, string> = {
  TB: "DOWN",
  BT: "UP",
  LR: "RIGHT",
  RL: "LEFT",
};

/**
 * The options on the root graph — Mermaid 12.2.0's `createRootElkGraph`
 * (`elk-V4PLJRSU.mjs`, around line 99647) with its default configuration
 * filled in: the `elk` block of `defaultConfig.ts` (`chunk-DLUCIBNR.mjs`,
 * lines 5432–5447) and the `default` entry of `ELK_PRESETS` (line 99608).
 * Every value is Mermaid's unless its comment says otherwise.
 */
const ROOT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  // One layout pass over the whole hierarchy, so an edge between two clusters
  // is routed in the same pass as the boxes it joins.
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  // `ELK_PRESETS.default`.
  "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
  "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
  // `defaultConfig.elk`: `mergeEdges: false`, `forceNodeModelOrder: false`,
  // `considerModelOrder: "NODES_AND_EDGES"`, `layeringLayerBound: 4`.
  "elk.layered.mergeEdges": "false",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.layering.coffmanGraham.layerBound": "4",
  "spacing.baseValue": "40",
  "elk.layered.unnecessaryBendpoints": "true",
  "elk.layered.wrapping.multiEdge.improveCuts": "true",
  "elk.layered.wrapping.multiEdge.improveWrappedEdges": "true",
  "elk.layered.edgeRouting.selfLoopDistribution": "EQUALLY",
  "elk.layered.mergeHierarchyEdges": "true",
  // `PORTS_SURROUNDING` (line 99192): keeps an edge's end off a box's corner.
  "elk.spacing.portsSurrounding": "[top=12,left=12,bottom=12,right=12]",
  // Siren's, not Mermaid's: see `LAYOUT_MARGIN`.
  "elk.padding": `[top=${LAYOUT_MARGIN},left=${LAYOUT_MARGIN},bottom=${LAYOUT_MARGIN},right=${LAYOUT_MARGIN}]`,
};

/**
 * The options every cluster carries — Mermaid 12.2.0's
 * `buildSubgraphLayoutOptions` (`elk-V4PLJRSU.mjs`, around line 99284) with
 * its default configuration, less the three it decides per subgraph: its
 * padding (24 there; the caller's here), its title (see `clusterShape`) and
 * its direction (see `layoutDirectedGraph`).
 */
const CLUSTER_OPTIONS: Record<string, string> = {
  // `DEFAULT_SUBGRAPH_SPACING_BASE_VALUE`, `DEFAULT_SUBGRAPH_NODE_SPACING`.
  "spacing.baseValue": "24",
  "spacing.nodeNode": "50",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.spacing.edgeEdge": "20",
  "elk.layered.mergeEdges": "false",
  // `ELK_PRESETS.default`: `alignment`, `containerPlacement`, `cycleBreaking`.
  "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
  "elk.layered.nodePlacement.networkSimplex.nodeFlexibility": "PORT_POSITION",
  "elk.spacing.portsSurrounding": ROOT_OPTIONS["elk.spacing.portsSurrounding"],
};

/**
 * Lays out a directed graph with ELK. Pure and deterministic: the same input
 * gives the same output.
 */
export function layoutDirectedGraph(input: DirectedGraphInput): DirectedGraphResult {
  const vertical = input.direction === "TB" || input.direction === "BT";
  const elkNodeById = new Map<string, ElkNode>();
  for (const node of input.nodes) {
    elkNodeById.set(node.id, { id: node.id, width: node.width, height: node.height });
  }
  const hasMembers = new Set(input.nodes.flatMap((node) => (node.parentId === undefined ? [] : [node.parentId])));
  // Parentage once every node exists, so a cluster may be listed after its
  // members. Children are appended in input order, which is the order ELK
  // is asked to keep.
  const topLevel: ElkNode[] = [];
  for (const node of input.nodes) {
    const elkNode = elkNodeById.get(node.id)!;
    if (node.parentId === undefined) {
      topLevel.push(elkNode);
    } else {
      const parent = elkNodeById.get(node.parentId);
      if (parent === undefined) {
        // A defect in the caller, which builds `parentId` from ids it
        // declared; reported as Siren's own error, naming the id, rather
        // than as a TypeError further in.
        throw new LayoutEngineError(
          `"${node.id}" names "${node.parentId}" as its parent cluster, which is not among the nodes`,
        );
      }
      (parent.children ??= []).push(elkNode);
    }
  }
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const voided = voidedDirections(input, nodeById);
  /** Whether this cluster is laid out in a pass of its own: it keeps a direction. */
  const ownPass = (node: DirectedGraphNode): boolean =>
    node.cluster?.direction !== undefined && !voided.has(node.id) && hasMembers.has(node.id);
  /** Whether this node, or any cluster above it, is laid out in a pass of its own. */
  const inOwnPass = (node: DirectedGraphNode | undefined): boolean =>
    node !== undefined && (ownPass(node) || inOwnPass(node.parentId === undefined ? undefined : nodeById.get(node.parentId)));
  for (const node of input.nodes) {
    if (node.cluster !== undefined) {
      const elkNode = elkNodeById.get(node.id)!;
      // Rotated only inside the root's own `INCLUDE_CHILDREN` pass; see `clusterShape`.
      Object.assign(elkNode, clusterShape(node.cluster, hasMembers.has(node.id), vertical && !inOwnPass(node)));
      if (ownPass(node)) {
        // Mermaid's `buildSubgraphLayoutOptions` for a subgraph with a `dir`:
        // laid out on its own, in its own direction, then placed in its
        // parent as one box.
        elkNode.layoutOptions = {
          ...elkNode.layoutOptions,
          "elk.algorithm": "layered",
          "elk.direction": ELK_DIRECTION[node.cluster.direction!],
          "elk.hierarchyHandling": "SEPARATE_CHILDREN",
        };
      }
    }
  }

  // Each edge becomes one ELK edge, or a chain of them through invisible
  // points when it is longer than one layer (`chainOf`). The chain's points
  // join the graph where its two ends' nearest common cluster holds them, so
  // they lay out among the boxes the edge runs between.
  //
  // An edge that runs back between clusters (`subgraphFeedbackEdges`) is
  // handed over turned round, so ELK lays it out pointing the other way; its
  // route is turned back below.
  const turned = subgraphFeedbackEdges(input.edges, nodeById);
  const chains = input.edges.map((edge, index) =>
    turned[index] ? { ...chainOf({ ...edge, from: edge.to, to: edge.from }), edge } : chainOf(edge),
  );
  for (const chain of chains) {
    for (const point of chain.points) {
      const holder = commonAncestor(chain.edge.from, chain.edge.to, nodeById);
      (holder === undefined ? topLevel : (elkNodeById.get(holder)!.children ??= [])).push(point);
    }
  }

  const root: ElkNode = {
    id: "root",
    layoutOptions: { ...ROOT_OPTIONS, "elk.direction": ELK_DIRECTION[input.direction] },
    children: topLevel,
    // Every edge on the root, as Mermaid hands them over: with
    // `INCLUDE_CHILDREN` ELK files each under the deepest graph holding both
    // its ends and reports it there (`container`), which `absoluteOrigin`
    // undoes below.
    edges: chains.flatMap((chain) => chain.segments),
  };

  const laidOut = layoutWithElk(root);

  // ELK reports every shape relative to the graph that holds it, and every
  // edge relative to its `container`; Siren's coordinates are the drawing's.
  const placed = new Map<string, { node: ElkNode; origin: Point }>();
  const collect = (children: readonly ElkNode[] | undefined, origin: Point) => {
    for (const child of children ?? []) {
      placed.set(child.id, { node: child, origin });
      collect(child.children, { x: origin.x + child.x!, y: origin.y + child.y! });
    }
  };
  collect(laidOut.children, { x: 0, y: 0 });
  const absoluteOrigin = (containerId: string | undefined): Point => {
    if (containerId === undefined || containerId === "root") return { x: 0, y: 0 };
    const { node, origin } = placed.get(containerId)!;
    return { x: origin.x + node.x!, y: origin.y + node.y! };
  };

  const nodes = input.nodes.map<DirectedGraphNodeBox>((node) => {
    const { node: box, origin } = placed.get(node.id)!;
    const x = origin.x + box.x!;
    const y = origin.y + box.y!;
    const title = node.cluster?.title;
    return {
      id: node.id,
      x,
      y,
      width: box.width!,
      height: box.height!,
      // The band is the frame's top padding, so the title's place in it is
      // known without asking ELK: centred across the frame, `padding` below
      // its top edge.
      ...(title === undefined
        ? {}
        : { title: { x: x + box.width! / 2, y: y + node.cluster!.padding + title.height / 2 } }),
    };
  });

  const routeById = new Map((laidOut.edges ?? []).map((edge) => [edge.id, edge]));
  /** One ELK edge's route and label, in the drawing's coordinates. */
  const absoluteRoute = (id: string) => {
    const routed = routeById.get(id)!;
    const origin = absoluteOrigin((routed as { container?: string }).container);
    const label = routed.labels?.[0];
    return {
      points: routeOf(routed).map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
      labelAnchor:
        label === undefined
          ? undefined
          : { x: origin.x + label.x! + label.width! / 2, y: origin.y + label.y! + label.height! / 2 },
    };
  };
  const edges = chains.map(({ edge, segments }, index) => {
    const pieces = segments.map((segment) => absoluteRoute(segment.id));
    const points = withoutStraightRuns(pieces.flatMap((piece) => piece.points));
    const route: DirectedGraphEdgeRoute = {
      id: edge.id,
      // A turned edge's route runs from its target; the caller's runs from its source.
      points: turned[index] ? points.reverse() : points,
      hops: [],
    };
    const labelAnchor = pieces.find((piece) => piece.labelAnchor !== undefined)?.labelAnchor;
    if (edge.label !== undefined && labelAnchor !== undefined) route.labelAnchor = labelAnchor;
    return route;
  });

  fitFrames(input, nodes, edges);
  straightenTerminals(
    edges,
    input.edges,
    nodes.filter((box) => nodeById.get(box.id)!.cluster === undefined),
  );

  // Last, from every finished route at once: which of two crossing routes
  // carries the hop, and how large it can be, depend on both.
  lineHops(edges.map((route, index) => ({ points: route.points, cornerRadius: input.edges[index].cornerRadius }))).forEach(
    (hops, index) => {
      edges[index].hops = hops;
    },
  );

  return {
    nodes,
    edges,
    width: laidOut.width!,
    height: laidOut.height!,
  };
}

/** The id of the cluster a node sits in, or `undefined` at the diagram's top level (or for an id not given). */
function parentLookup(nodeById: ReadonlyMap<string, DirectedGraphNode>): (id: string) => string | undefined {
  return (id) => nodeById.get(id)?.parentId;
}

/**
 * The nearest cluster holding both `a` and `b` — Mermaid's `findCommonAncestor`
 * (`elk-V4PLJRSU.mjs`, line 98673), including its two quirks: one end that
 * is itself an ancestor of the other is the answer, and an edge from a node
 * to itself answers that node's parent. `undefined` is the diagram itself.
 */
function commonAncestor(
  a: string,
  b: string,
  nodeById: ReadonlyMap<string, DirectedGraphNode>,
): string | undefined {
  const parentOf = parentLookup(nodeById);
  if (a === b) return parentOf(a);
  const seen = new Set<string>();
  for (let id: string | undefined = a; id !== undefined; id = parentOf(id)) {
    if (id === b) return id;
    seen.add(id);
  }
  for (let id: string | undefined = b; id !== undefined; id = parentOf(id)) {
    if (seen.has(id)) return id;
  }
  return undefined;
}

/** The longest first (or last) run of a route `straightenTerminals` will straighten past. */
const TERMINAL_RUN_MAX = 30;
/** The widest sidestep it takes out. */
const TERMINAL_JOG_MAX = 16;
/** Below this, two coordinates are one: a run is horizontal or vertical, a sidestep no sidestep. */
const JOG_EPSILON = 0.01;

/**
 * Takes the short sidestep out of the ends of a route — Mermaid 12.2.0's
 * `straightenEdgeTerminals` (`elk-V4PLJRSU.mjs`, line 100248), on by default
 * (`straightenEdges: true` in `defaultConfig.elk`, `chunk-DLUCIBNR.mjs`
 * line 5435). ELK often leaves a route a few pixels out of line with the end
 * it leaves or enters — where it passes a frame's port, or where ports on
 * one side are spread apart — and draws the difference as a kink right at
 * the box: a run of at most 30px, a sidestep of at most 16px, and on in the
 * same direction.
 *
 * The rule, Mermaid's, per route in input order, its start then its end: the
 * sidestep is removed by moving the run after it into line with the end —
 * the run up to the next bend, which is then lengthened or shortened along
 * its own axis, so the route stays orthogonal and both its ends stay where
 * ELK put them. A run that reaches the route's far end is not moved. A route
 * is straightened only if that crosses no other route more often (counting
 * every route's current shape) and runs across no more labels, its own
 * label carried along with the run it sits on (`carryLabel`).
 *
 * **And, departing from Mermaid, only if it runs through no more boxes.**
 * Mermaid's check counts crossings and labels but not boxes, and a sidestep
 * is often there to clear one: `subgraph F { U, L }` with `U --> L`,
 * `U --> I`, `L --> I` leaves U 14px to the left of the run that passes L,
 * and moving that run into line with U's port would draw U --> I through L.
 * An edge across a box it does not join reads as joining it, the misreading
 * this migration exists to remove (nook decision `01M4VBHWYKNH91NXFD4ZF9MQDD`,
 * under rule 1 of `01M4VANRC6B2C14NHVC2KRZ9Y8`). Measured on the flowchart
 * parity fixtures, the parity numbers are the same with and without it; laid
 * out with the fixed-width measurer, it keeps one route of
 * `example-flowchart-edges` from running through a box.
 */
function straightenTerminals(
  routes: DirectedGraphEdgeRoute[],
  inputs: readonly DirectedGraphEdge[],
  boxes: readonly DirectedGraphNodeBox[],
): void {
  type Label = { centre: Point; size: { width: number; height: number } } | undefined;
  const labels: Label[] = routes.map((route, index) =>
    route.labelAnchor === undefined || inputs[index].label === undefined
      ? undefined
      : { centre: route.labelAnchor, size: inputs[index].label! },
  );
  const covers = (points: readonly Point[], label: Label) =>
    label !== undefined &&
    points.some((point, index) => index > 0 && segmentMeetsBox(points[index - 1], point, label.centre, label.size));
  /** How many boxes other than its own ends `points` runs through. */
  const boxesCrossed = (points: readonly Point[], edge: DirectedGraphEdge) =>
    boxes.filter(
      (box) =>
        box.id !== edge.from &&
        box.id !== edge.to &&
        covers(points, { centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, size: box }),
    ).length;
  routes.forEach((route, index) => {
    const original = route.points;
    const { points: moved, runs } = withoutTerminalJogs(original);
    if (runs.length === 0) return;
    // Moving the run can put its far end on the next bend, or in line with
    // the run after it: the route would keep a segment of no length, or a
    // point that does not bend. The same cleanup as ELK's routes drops both.
    const points = withoutStraightRuns(moved);
    const label = labels[index];
    const carried = label === undefined ? undefined : { centre: carryLabel(label.centre, runs), size: label.size };
    let crossingsBefore = 0;
    let crossingsAfter = 0;
    let coveredBefore = 0;
    let coveredAfter = 0;
    routes.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      crossingsBefore += crossingCount(original, other.points);
      crossingsAfter += crossingCount(points, other.points);
      coveredBefore += Number(covers(other.points, label)) + Number(covers(original, labels[otherIndex]));
      coveredAfter += Number(covers(other.points, carried)) + Number(covers(points, labels[otherIndex]));
    });
    if (crossingsAfter > crossingsBefore || coveredAfter > coveredBefore) return;
    if (boxesCrossed(points, inputs[index]) > boxesCrossed(original, inputs[index])) return;
    route.points = points;
    if (carried !== undefined) {
      route.labelAnchor = carried.centre;
      labels[index] = carried;
    }
  });
}

/** A run `withoutTerminalJogs` moved: where it ran, and where it runs now. */
interface MovedRun {
  was: [Point, Point];
  now: [Point, Point];
}

/** `points` with the sidestep taken out of each end that has one, and the runs that moved to do it. */
function withoutTerminalJogs(points: readonly Point[]): { points: Point[]; runs: MovedRun[] } {
  const runs: MovedRun[] = [];
  let current = [...points];
  const front = withoutLeadingJog(current);
  if (front !== undefined) {
    current = front.points;
    runs.push(front.run);
  }
  const back = withoutLeadingJog([...current].reverse());
  if (back !== undefined) {
    current = back.points.reverse();
    runs.push(back.run);
  }
  return { points: current, runs };
}

/** Mermaid's `straightenFront`: the sidestep out of the start of `points`, if it has one. */
function withoutLeadingJog(points: readonly Point[]): { points: Point[]; run: MovedRun } | undefined {
  if (points.length < 5) return undefined;
  const [p0, p1, p2, p3] = points;
  const axis = axisOf(p0, p1);
  if (axis === undefined || axisOf(p2, p3) !== axis || axisOf(p1, p2) !== (axis === "h" ? "v" : "h")) return undefined;
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > TERMINAL_RUN_MAX) return undefined;
  const sidestep = axis === "h" ? Math.abs(p2.y - p1.y) : Math.abs(p2.x - p1.x);
  if (sidestep < JOG_EPSILON || sidestep > TERMINAL_JOG_MAX) return undefined;
  const onward =
    axis === "h" ? Math.sign(p1.x - p0.x) === Math.sign(p3.x - p2.x) : Math.sign(p1.y - p0.y) === Math.sign(p3.y - p2.y);
  if (!onward) return undefined;
  let last = 3;
  while (last + 1 < points.length && axisOf(points[last], points[last + 1]) === axis) last++;
  if (last === points.length - 1) return undefined;
  const moved = [...points];
  for (let i = 2; i <= last; i++) {
    moved[i] = axis === "h" ? { x: points[i].x, y: p0.y } : { x: p0.x, y: points[i].y };
  }
  const run: MovedRun = { was: [points[2], points[last]], now: [moved[2], moved[last]] };
  moved.splice(1, 2);
  return { points: moved, run };
}

/** `"h"` or `"v"` for a horizontal or vertical segment; `undefined` for a point or a slant. */
function axisOf(a: Point, b: Point): "h" | "v" | undefined {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx > JOG_EPSILON && dy <= JOG_EPSILON) return "h";
  if (dy > JOG_EPSILON && dx <= JOG_EPSILON) return "v";
  return undefined;
}

/**
 * Where a label goes when the run under it moves — Mermaid's
 * `projectLabelOntoStraightenedRun`: to the same fraction along the moved run
 * as it sat along the nearest of the runs before they moved.
 */
function carryLabel(centre: Point, runs: readonly MovedRun[]): Point {
  let best: { distance: number; point: Point } | undefined;
  for (const { was, now } of runs) {
    const t = fractionAlong(centre, was[0], was[1]);
    const before = pointAlong(was[0], was[1], t);
    const distance = Math.hypot(before.x - centre.x, before.y - centre.y);
    if (best === undefined || distance < best.distance) best = { distance, point: pointAlong(now[0], now[1], t) };
  }
  return best!.point;
}

function fractionAlong(p: Point, a: Point, b: Point): number {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSquared === 0) return 0;
  return Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSquared));
}

function pointAlong(a: Point, b: Point, t: number): Point {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** How many times two routes cross, counting only proper crossings — Mermaid's `crossingCount`. */
function crossingCount(a: readonly Point[], b: readonly Point[]): number {
  const side = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const opposite = (m: number, n: number) => (m > 0 && n < 0) || (m < 0 && n > 0);
  let count = 0;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (
        opposite(side(b[j - 1], b[j], a[i - 1]), side(b[j - 1], b[j], a[i])) &&
        opposite(side(a[i - 1], a[i], b[j - 1]), side(a[i - 1], a[i], b[j]))
      ) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Whether the segment from `a` to `b` meets the box centred on `centre` —
 * Mermaid's `segmentHitsBox`. Not only a segment through the box's inside
 * counts: one lying along an edge of the box, for any length, meets it too.
 * One that touches the box at a single point does not.
 */
function segmentMeetsBox(a: Point, b: Point, centre: Point, size: { width: number; height: number }): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  for (const [p, q] of [
    [-dx, a.x - (centre.x - size.width / 2)],
    [dx, centre.x + size.width / 2 - a.x],
    [-dy, a.y - (centre.y - size.height / 2)],
    [dy, centre.y + size.height / 2 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) {
      enter = Math.max(enter, q / p);
    } else {
      leave = Math.min(leave, q / p);
    }
  }
  return enter < leave;
}

/**
 * Pulls each cluster's frame in to what it holds — Mermaid 12.2.0's
 * `evenGroupFrames` (`elk-V4PLJRSU.mjs`, line 99981), which it runs on every
 * ELK layout before reading the edges. ELK grows a frame for more than its
 * members: under `INCLUDE_CHILDREN` it routes edges that leave a cluster
 * partly inside the frame, and a crossing among them, or a lane they share,
 * widens or deepens it. Measured in headless Chrome against Mermaid 12.2.0:
 * `subgraph G { A, B }` whose edges to `Y` and `Z` cross on the way out
 * draws G 117 tall, title band included, the crossing below the frame;
 * ELK's own frame is 72px deeper.
 *
 * The rule, innermost cluster first so an outer frame fits the inner one
 * already fitted: the left, right and bottom sides move in to one padding
 * beyond the members (a member cluster by its fitted frame; a zero-size point
 * of a long edge's chain is no member), and beyond every point of an edge
 * with both ends inside the cluster and the end of an edge that ends on the
 * cluster itself — so an edge routed within the frame stays within it, and
 * one that ends on the frame still ends on its outline. A side only ever
 * moves in, never out; the top stays, with the title band under it. The
 * frame is never narrower than its title and twice its padding, widened about
 * its centre and kept within ELK's frame. The title is re-centred across the
 * fitted frame.
 *
 * Mermaid's sides and floor, Siren's numbers: Mermaid pulls every frame in
 * to a fixed 24px (`SUBGRAPH_PADDING`, line 99194) and floors it at the
 * title plus the padding once (`groupTitleWidth`); Siren uses the cluster's
 * own padding (12 in the flowchart) and the `title.width + 2 × padding` floor
 * `clusterShape` asks ELK for. Siren's title band is built from the padding
 * twice, and Mermaid's 24 measured worse against Mermaid's own pictures
 * (nook decision `01M4VDB3XG71N3R1EN5J94JMZ4`).
 *
 * This moves a frame after ELK placed it, and in the core only: adapters
 * never adjust a frame, and a post-layout pass Mermaid's ELK adapter runs is
 * ported here and nowhere else (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`,
 * rule 2). Every member, route and route end stays where ELK put it.
 */
function fitFrames(
  input: DirectedGraphInput,
  boxes: readonly DirectedGraphNodeBox[],
  routes: readonly DirectedGraphEdgeRoute[],
): void {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const membersOf = new Map<string, DirectedGraphNode[]>();
  for (const node of input.nodes) {
    if (node.parentId !== undefined) membersOf.set(node.parentId, [...(membersOf.get(node.parentId) ?? []), node]);
  }
  const within = (id: string, into = new Set<string>()): Set<string> => {
    for (const member of membersOf.get(id) ?? []) {
      into.add(member.id);
      within(member.id, into);
    }
    return into;
  };
  const fit = (node: DirectedGraphNode): void => {
    const members = membersOf.get(node.id) ?? [];
    for (const member of members) if (member.cluster !== undefined) fit(member);
    if (node.cluster === undefined || members.length === 0) return;
    const frame = boxById.get(node.id)!;
    const held = members.map((member) => boxById.get(member.id)!).filter((box) => box.width > 0 && box.height > 0);
    if (held.length === 0) return;
    const inside = within(node.id);
    const lane: Point[] = [];
    input.edges.forEach((edge, index) => {
      const points = routes[index].points;
      if (inside.has(edge.from) && inside.has(edge.to)) {
        lane.push(...points);
        return;
      }
      if (edge.from === node.id) lane.push(points[0]);
      if (edge.to === node.id) lane.push(points[points.length - 1]);
    });
    const xs = [...held.flatMap((box) => [box.x, box.x + box.width]), ...lane.map((point) => point.x)];
    const ys = [...held.flatMap((box) => [box.y, box.y + box.height]), ...lane.map((point) => point.y)];
    const { padding, title } = node.cluster;
    const left = Math.max(frame.x, Math.min(...xs) - padding);
    const right = Math.min(frame.x + frame.width, Math.max(...xs) + padding);
    const bottom = Math.min(frame.y + frame.height, Math.max(...ys) + padding);
    const floor = (title?.width ?? 0) + 2 * padding;
    let x = left;
    let width = right - left;
    if (width < floor) {
      width = Math.min(floor, frame.width);
      x = Math.max(frame.x, Math.min(left - (width - (right - left)) / 2, frame.x + frame.width - width));
    }
    const height = bottom - frame.y;
    if (width <= 0 || height <= 0) return;
    frame.x = x;
    frame.width = width;
    frame.height = height;
    if (frame.title !== undefined) frame.title = { x: x + width / 2, y: frame.title.y };
  };
  for (const node of input.nodes) if (node.parentId === undefined) fit(node);
}

/**
 * Which edges run back between clusters, by input index — Mermaid 12.2.0's
 * `findSubgraphFeedbackEdges` (`elk-V4PLJRSU.mjs`, line 98706), which its
 * `reverseSubgraphFeedbackEdges` (line 99533) applies by default
 * (`orientFeedbackEdges: true` in `defaultConfig.elk`, `chunk-DLUCIBNR.mjs`
 * line 5449): every flagged edge goes to ELK with its source and target
 * swapped, and its route is turned back afterwards.
 *
 * The rule: each edge is lifted to the nearest cluster holding both its ends
 * (`commonAncestor`) and seen there as an edge between the two children of
 * that cluster it runs between — a member of a nested cluster stands for the
 * cluster. Self-loops, and edges with one end the cluster holding the other,
 * are left out. Each level is walked depth-first, in the order its nodes
 * first appear on its edges, starting from the ones nothing points at; an
 * edge that leads back to a node still on the walk is a back edge. A back
 * edge is flagged only when at least one of its ends was lifted — when it
 * runs between clusters rather than between two boxes side by side, which
 * ELK's own cycle breaking is left to settle.
 *
 * Why it matters: ELK breaks cycles among boxes, and a cycle among *frames*
 * (`S1 { A, C }`, `S2 { B }`, `A --> B`, `B --> C`) is no cycle among boxes,
 * so nothing stops it stacking the frames in either order. Measured in
 * headless Chrome against Mermaid 12.2.0: that document draws S1 above S2,
 * A and C side by side, B under both. On the `garden-network` parity fixture —
 * five subgraphs in a frame-level cycle — handing the edges over unturned
 * mirrored Siren's picture left to right against Mermaid's (25.8% of node
 * pairs in the same left/right order; 92.6% with this).
 */
function subgraphFeedbackEdges(
  edges: readonly DirectedGraphEdge[],
  nodeById: ReadonlyMap<string, DirectedGraphNode>,
): boolean[] {
  const parentOf = parentLookup(nodeById);
  /** The child of `ancestor` (or top-level node, for the diagram) that holds `id`, or `id` itself. */
  const childOf = (id: string, ancestor: string | undefined): string => {
    let current = id;
    while (parentOf(current) !== ancestor) current = parentOf(current)!;
    return current;
  };
  interface Lifted {
    index: number;
    from: string;
    to: string;
    /** Whether either end was lifted to a cluster above it. */
    lifted: boolean;
  }
  const levels = new Map<string | undefined, Lifted[]>();
  edges.forEach((edge, index) => {
    if (edge.from === edge.to) return;
    const ancestor = commonAncestor(edge.from, edge.to, nodeById);
    if (ancestor === edge.from || ancestor === edge.to) return;
    const from = childOf(edge.from, ancestor);
    const to = childOf(edge.to, ancestor);
    const level = levels.get(ancestor) ?? [];
    level.push({ index, from, to, lifted: from !== edge.from || to !== edge.to });
    levels.set(ancestor, level);
  });

  const flags = edges.map(() => false);
  for (const level of levels.values()) {
    const out = new Map<string, Lifted[]>();
    const inDegree = new Map<string, number>();
    for (const edge of level) {
      for (const node of [edge.from, edge.to]) {
        if (!out.has(node)) {
          out.set(node, []);
          inDegree.set(node, 0);
        }
      }
      out.get(edge.from)!.push(edge);
      inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
    }
    const nodes = [...out.keys()];
    const state = new Map<string, "on the walk" | "done">();
    for (const start of [...nodes.filter((node) => inDegree.get(node) === 0), ...nodes]) {
      if (state.has(start)) continue;
      state.set(start, "on the walk");
      const walk = [{ node: start, next: 0 }];
      while (walk.length > 0) {
        const step = walk[walk.length - 1];
        const leaving = out.get(step.node)!;
        if (step.next >= leaving.length) {
          state.set(step.node, "done");
          walk.pop();
          continue;
        }
        const edge = leaving[step.next++];
        const seen = state.get(edge.to);
        if (seen === "on the walk") {
          flags[edge.index] = edge.lifted;
        } else if (seen === undefined) {
          state.set(edge.to, "on the walk");
          walk.push({ node: edge.to, next: 0 });
        }
      }
    }
  }
  return flags;
}

/** An input edge as ELK is handed it: the edges it became, and the invisible points between them. */
interface Chain {
  edge: DirectedGraphEdge;
  segments: ElkExtendedEdge[];
  points: ElkNode[];
}

/**
 * One input edge as ELK edges. Usually one, carrying the label; an edge with
 * a `minLength` of `k > 1` becomes a chain of `k` edges through `k - 1`
 * zero-size points, which ELK's layering must put in `k - 1` layers of their
 * own between the two ends — the one way to ask ELK `layered` for a minimum
 * edge length, since it has no per-edge option for it. The points are
 * internal: `layoutDirectedGraph` stitches the chain's routes back into one
 * route and returns no box for them.
 *
 * **This is a departure from Mermaid 12.** Mermaid 12.2.0 computes `minlen`
 * for `A ----> B` and hands it to ELK, which reads no such option: measured
 * in headless Chrome, `A ----> B` beside `A --> C` draws both targets in one
 * row, with coordinates identical to `A --> B`. Mermaid's own documentation
 * says each extra dash spans another rank, so its picture contradicts the
 * document and Siren draws what the document says (nook decision
 * `01M4VA6MS4MCTFFJJWEZR453YS`, under rule 1 of `01M4VANRC6B2C14NHVC2KRZ9Y8`).
 *
 * A label goes on the middle edge of the chain, so it sits halfway along.
 * ELK gives a labelled edge a layer of its own for its label, so a labelled
 * edge spans one more layer than an unlabelled one of the same length, under
 * any `minLength`. A self-loop is never chained: its ends are one box.
 */
function chainOf(edge: DirectedGraphEdge): Chain {
  const length = edge.from === edge.to ? 1 : Math.max(1, Math.floor(edge.minLength ?? 1));
  const label =
    edge.label === undefined
      ? undefined
      : [
          {
            text: edge.id,
            width: edge.label.width,
            height: edge.label.height,
            // Inline and centred on the line — Mermaid's `addEdgesToElkGraph`
            // (`elk-V4PLJRSU.mjs`, around line 99784), measured in Chrome:
            // `A -->|yes| B` under Mermaid 12.2.0 draws "yes" centred on the
            // vertical line, with the gap between the boxes grown to hold it
            // (101 instead of 40).
            layoutOptions: { "elk.edgeLabels.inline": "true", "elk.edgeLabels.placement": "CENTER" },
          },
        ];
  if (length === 1) {
    return {
      edge,
      segments: [{ id: edge.id, sources: [edge.from], targets: [edge.to], ...(label ? { labels: label } : {}) }],
      points: [],
    };
  }
  // A NUL in the ids: no id a caller builds from a document can contain one.
  const pointId = (index: number) => `${edge.id}\u0000chain\u0000${index}`;
  const points = Array.from({ length: length - 1 }, (_, index) => ({ id: pointId(index), width: 0, height: 0 }));
  const stops = [edge.from, ...points.map((point) => point.id), edge.to];
  const labelled = Math.floor(length / 2);
  const segments = stops.slice(1).map<ElkExtendedEdge>((to, index) => ({
    id: `${edge.id}\u0000segment\u0000${index}`,
    sources: [stops[index]],
    targets: [to],
    ...(label && index === labelled ? { labels: label } : {}),
  }));
  return { edge, segments, points };
}

/**
 * `points` with every repeated point and every point in the middle of a
 * straight run dropped: a chain's routes meet end to end at its invisible
 * points, and a route ELK passes through a frame's boundary keeps a bend
 * point there that does not bend.
 */
function withoutStraightRuns(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last !== undefined && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) continue;
    const before = kept.at(-2);
    // Straight on, not doubling back: a turn of 180° is a bend worth keeping.
    if (
      before !== undefined &&
      last !== undefined &&
      ((Math.abs(before.x - last.x) < 1e-6 && Math.abs(last.x - point.x) < 1e-6) ||
        (Math.abs(before.y - last.y) < 1e-6 && Math.abs(last.y - point.y) < 1e-6)) &&
      (last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y) > 0
    ) {
      kept[kept.length - 1] = point;
      continue;
    }
    kept.push(point);
  }
  return kept;
}

/**
 * The clusters whose declared direction does not hold: Mermaid 12.2.0's
 * `configureCrossHierarchyEdges` and `setIncludeChildrenPolicy`
 * (`elk-V4PLJRSU.mjs`, around line 99889), which force a cluster back into its
 * parent's layout pass — and so into its parent's direction.
 *
 * The rule: an edge whose two ends have different parents voids every
 * cluster on the way up from each end to the two ends' nearest common
 * ancestor — the end itself when it is a cluster, and the common ancestor too
 * when that is a cluster rather than the diagram. An edge whose ends share a
 * parent voids nothing, which is why `C --> G` from beside a cluster leaves
 * the cluster its direction.
 *
 * Measured in headless Chrome against Mermaid 12.2.0's default layout: a
 * TB diagram with `subgraph one` declaring `direction LR` around `A --> B` draws A and B side by side; adding
 * `C --> A` stacks them; adding `C --> one` instead keeps the row; adding
 * `B --> one` stacks them. And one case where this is not the dagre-era
 * **Boundary-crossing edge** rule: `O` with `direction LR` holding a cluster
 * `I` (holding `A`) and `B`, with `A --> B` — no edge leaves `O`, and Mermaid
 * stacks `A` above `B` all the same, because `A` and `B` have different
 * parents and their common ancestor is `O`.
 */
function voidedDirections(
  input: DirectedGraphInput,
  nodeById: ReadonlyMap<string, DirectedGraphNode>,
): Set<string> {
  const parentOf = parentLookup(nodeById);
  const voided = new Set<string>();
  for (const edge of input.edges) {
    if (parentOf(edge.from) === parentOf(edge.to)) continue;
    const ancestor = commonAncestor(edge.from, edge.to, nodeById);
    for (const end of [edge.from, edge.to]) {
      for (let id: string | undefined = end; id !== undefined; id = parentOf(id)) {
        voided.add(id);
        if (id === ancestor) break;
      }
    }
  }
  return voided;
}

/**
 * The ELK shape of a cluster: its padding with the title band folded into the
 * top, and a minimum width that holds the title.
 *
 * **The title is not handed to ELK as a label, deliberately.** Mermaid does
 * hand it over — as the subgraph's node label, placed `[H_CENTER V_TOP,
 * INSIDE]` with the `NODE_LABELS` size constraint — and under a vertical
 * direction ELK sizes the frame in its own rotated frame of reference and
 * applies the title's *width* to the frame's *height*. Measured with elkjs
 * 0.12.0 and 0.9.3 alike: a cluster holding one 20x20 box under a 200-wide
 * title comes back 52 wide and 224 tall under `DOWN`, 224x76 under `RIGHT`;
 * Mermaid 12.2.0's own options reproduce it (200x271.5 for a 152-wide member
 * under a 261.5-wide title), and Mermaid repairs the frame afterwards in
 * `evenGroupFrames` while the space ELK reserved stays reserved. The core
 * ports that repair (`fitFrames`; post-layout passes Mermaid runs live in the
 * core, never in an adapter — nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`,
 * rule 2), but a frame pulled in after layout leaves the reserved space as a
 * gap around it, so the title is not left for it to fix: asking ELK for the
 * right box is.
 *
 * So the band is padding: the top padding is the caller's padding, the
 * title's height and the padding again, and the title's place in it is then
 * known exactly (`layoutDirectedGraph` computes its centre). The width floor
 * is `nodeSize.minimum`, which has the same rotation: a cluster sized inside
 * the root's `INCLUDE_CHILDREN` pass under `DOWN` or `UP` reads the minimum's
 * two numbers swapped, while one laid out in a pass of its own
 * (`SEPARATE_CHILDREN`) reads them as written — measured, both versions,
 * every combination of root and cluster direction. `contentAlignment` turns
 * with it.
 *
 * A cluster with no members is laid out as an ordinary box, the title and its
 * padding on every side.
 */
function clusterShape(cluster: DirectedGraphCluster, hasMembers: boolean, rotated: boolean): Partial<ElkNode> {
  const { padding, title } = cluster;
  const titleWidth = title?.width ?? 0;
  const titleHeight = title?.height ?? 0;
  if (!hasMembers) {
    return { width: titleWidth + 2 * padding, height: titleHeight + 2 * padding };
  }
  const band = title === undefined ? padding : padding + titleHeight + padding;
  const minimumWidth = titleWidth + 2 * padding;
  return {
    layoutOptions: {
      ...CLUSTER_OPTIONS,
      "elk.padding": `[top=${band},left=${padding},bottom=${padding},right=${padding}]`,
      "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
      "elk.nodeSize.minimum": rotated ? `(0, ${minimumWidth})` : `(${minimumWidth}, 0)`,
      // A frame widened for its title holds its members centred beneath it,
      // as Mermaid 12.2.0 draws it (measured: a 152-wide box under a
      // 261.5-wide title sits at the frame's centre to within 0.1px). Rotated
      // like the minimum, measured the same way: in the root's pass under
      // `DOWN`/`UP`, `V_CENTER` is what centres across the frame.
      "elk.contentAlignment": rotated ? "V_CENTER" : "H_CENTER",
    },
  };
}

/**
 * An edge's route as one list of points: its section's start, bends and end.
 * ELK's `layered` algorithm answers every edge with exactly one section.
 */
function routeOf(edge: ElkExtendedEdge): Point[] {
  const section = edge.sections![0];
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
    x: point.x,
    y: point.y,
  }));
}
