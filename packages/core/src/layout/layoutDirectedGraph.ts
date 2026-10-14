/**
 * The shared layout core, on ELK: takes boxes, clusters and edges with their
 * sizes, and hands back where everything goes — boxes, the frame around each
 * cluster, and routes. It measures no text, knows no diagram kind, and draws
 * nothing — the seam ADR-0001 put layout math behind, and the one the layout
 * engine is hidden behind (nook decision `01M4VPWF5`, which amends ADR-0001;
 * only `elkSync.ts` imports elkjs). The flowchart reaches it through `layoutGraph`, the class
 * diagram through `layoutClassDiagram`, the state diagram through
 * `layoutStateDiagram` and the ER diagram through `layoutErDiagram`.
 *
 * The engine is ELK's `layered` algorithm (elkjs, reached only through
 * `elkSync.ts`), configured as Mermaid 12.2.0 configures it for its own
 * default layout — see `ROOT_OPTIONS` and `CLUSTER_OPTIONS` for every option
 * and where it was read. Mermaid 12 is the baseline (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 1): what the picture looks like is
 * Mermaid's to decide, and where Siren departs from it the departure is
 * measured and written down beside the code that departs.
 */
import type { Direction, LineHop, Point } from "../contracts";
import { LayoutEngineError, layoutWithElk, type ElkExtendedEdge, type ElkLabel, type ElkNode } from "./elkSync";
import { lineHops } from "./lineHops";

/**
 * Re-exported so a caller outside the layout core catches the engine's
 * rejection by the core's name, not the engine wrapper's.
 */
export { LayoutEngineError };

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
   * title plus its padding on both sides. The title sits centred in the band
   * unless a route crosses it there (`placeTitlesClear`).
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
   * be; absent when they are drawn sharp. The adapter that knows the edge's
   * curve supplies it. Routing ignores it; the line hops read it, to keep
   * clear of the rounding (see `lineHops`).
   */
  cornerRadius?: number;
  /**
   * How far the route must run straight out of each of its two boxes before
   * it first bends — the length of the figure the renderer draws along that
   * end, an ER cardinality marker. Measured past the rounding: the core adds
   * what `cornerRadius` cuts off a right-angled corner. Absent means no
   * floor, ELK's own runs. See `holdStraightEnds` for how it is kept and why
   * it is a departure from Mermaid 12.
   */
  straightEnds?: { start: number; end: number };
  /**
   * The labels drawn at the edge's two ends — a class relationship's
   * multiplicities — by which end and which hand of the line each belongs
   * on, with the size each needs. ELK keeps room for them beside the end
   * they belong to, and the core then moves them clear of frames and onto
   * their own hand of the line (`placeTerminalLabels`). Reported back as
   * `terminalLabelCenters`.
   */
  terminalLabels?: Partial<Record<TerminalLabelKey, DirectedGraphTerminalLabel>>;
}

/**
 * Which end of an edge a terminal label belongs to, and which hand of the
 * line — left or right of the direction the line travels from its start to
 * its end. Mermaid's names (`startLabelLeft`, `startLabelRight`,
 * `endLabelLeft`, `endLabelRight`).
 */
export type TerminalLabelKey = "startLeft" | "startRight" | "endLeft" | "endRight";

/** A terminal label's size, and the room ELK keeps around it. */
export interface DirectedGraphTerminalLabel {
  width: number;
  height: number;
  /**
   * Extra room on every side that ELK keeps clear of the label, without the
   * label growing: Mermaid's `TERMINAL_LABEL_MARKER_CLEARANCE`, 6 where the
   * end carries a marker. Absent means none.
   */
  margin?: number;
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
  /**
   * The centre of each terminal label the edge was given, by its key. A
   * label ELK did not place is absent, as it is in Mermaid.
   */
  terminalLabelCenters?: Partial<Record<TerminalLabelKey, Point>>;
}

/** The placed graph: boxes and routes in their input order, and the extent that holds them. */
export interface DirectedGraphResult {
  nodes: DirectedGraphNodeBox[];
  edges: DirectedGraphEdgeRoute[];
  width: number;
  height: number;
}

/**
 * The room left around the whole drawing, on all four sides: 8, the margin
 * Mermaid 12.2.0 leaves around its own ELK drawings (and the one Siren kept
 * before it moved onto ELK) — measured in headless Chrome, a lone
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
  const rootOptions: Record<string, string> = { ...ROOT_OPTIONS, "elk.direction": ELK_DIRECTION[input.direction] };
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

  holdStraightEnds(input, nodeById, elkNodeById, rootOptions);

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
    turned[index] ? { ...chainOf({ ...edge, from: edge.to, to: edge.from }, true), edge } : chainOf(edge, false),
  );
  for (const chain of chains) {
    for (const point of chain.points) {
      const holder = commonAncestor(chain.edge.from, chain.edge.to, nodeById);
      (holder === undefined ? topLevel : (elkNodeById.get(holder)!.children ??= [])).push(point);
    }
  }

  const root: ElkNode = {
    id: "root",
    layoutOptions: rootOptions,
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
      // its top edge. `fitFrames` re-centres it and `placeTitlesClear` may
      // move it along the band.
      ...(title === undefined
        ? {}
        : { title: { x: x + box.width! / 2, y: y + node.cluster!.padding + title.height / 2 } }),
    };
  });

  const routeById = new Map((laidOut.edges ?? []).map((edge) => [edge.id, edge]));
  /** One ELK edge's route and label, in the drawing's coordinates: a segment `id` of the caller's edge `edgeId`. */
  const absoluteRoute = (id: string, edgeId: string) => {
    const routed = routeById.get(id)!;
    const origin = absoluteOrigin((routed as { container?: string }).container);
    const label = routed.labels?.find((candidate) => terminalLabelKey(candidate, edgeId) === undefined);
    return {
      points: routeOf(routed).map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
      labelAnchor:
        label === undefined
          ? undefined
          : { x: origin.x + label.x! + label.width! / 2, y: origin.y + label.y! + label.height! / 2 },
    };
  };
  const edges = chains.map(({ edge, segments }, index) => {
    const pieces = segments.map((segment) => absoluteRoute(segment.id, edge.id));
    const points = withoutStraightRuns(pieces.flatMap((piece) => piece.points));
    const route: DirectedGraphEdgeRoute = {
      id: edge.id,
      // A turned edge's route runs from its target; the caller's runs from its source.
      points: turned[index] ? points.reverse() : points,
      hops: [],
    };
    const labelAnchor = pieces.find((piece) => piece.labelAnchor !== undefined)?.labelAnchor;
    if (edge.label !== undefined && labelAnchor !== undefined) route.labelAnchor = labelAnchor;
    const terminals = terminalCentres(edge.id, segments, routeById, absoluteOrigin);
    if (terminals !== undefined) route.terminalLabelCenters = terminals;
    return route;
  });

  fitFrames(input, nodes, edges);
  centreSmallBoxesOnRoutes(input, nodes, edges, turned);
  straightenTerminals(
    edges,
    input.edges,
    nodes.filter((box) => nodeById.get(box.id)!.cluster === undefined),
  );
  placeTerminalLabels(input, nodes, edges);
  placeTitlesClear(input, nodes, edges);
  const extent = extentHoldingTerminalLabels(input, nodes, edges, { width: laidOut.width!, height: laidOut.height! });

  // Last, from every finished route at once: which of two crossing routes
  // carries the hop, and how large it can be, depend on both.
  lineHops(edges.map((route, index) => ({ points: route.points, cornerRadius: input.edges[index].cornerRadius }))).forEach(
    (hops, index) => {
      edges[index].hops = hops;
    },
  );

  return { nodes, edges, ...extent };
}

/**
 * The extent of the whole drawing once `placeTerminalLabels` has moved the
 * terminal labels: ELK's, grown to hold every terminal label with
 * `LAYOUT_MARGIN` of room around it. ELK keeps room for a label only where
 * it put it; a label moved off a frame or a line, or onto its own hand of
 * the line, can end up past that room on any side. A label past the top or
 * the left edge moves the whole drawing right or down (`nodes` and `routes`
 * in place) by as much, so nothing is drawn at a negative coordinate — as
 * nothing ELK places is, inside its padding. A post-layout pass, so it lives
 * in the core with the pass it answers (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2).
 */
function extentHoldingTerminalLabels(
  input: DirectedGraphInput,
  nodes: DirectedGraphNodeBox[],
  routes: DirectedGraphEdgeRoute[],
  laidOut: { width: number; height: number },
): { width: number; height: number } {
  let [left, top, right, bottom] = [0, 0, laidOut.width, laidOut.height];
  routes.forEach((route, index) => {
    for (const [key, centre] of Object.entries(route.terminalLabelCenters ?? {})) {
      const box = cornersOf(centre, input.edges[index].terminalLabels![key as TerminalLabelKey]!);
      left = Math.min(left, box.x1 - LAYOUT_MARGIN);
      top = Math.min(top, box.y1 - LAYOUT_MARGIN);
      right = Math.max(right, box.x2 + LAYOUT_MARGIN);
      bottom = Math.max(bottom, box.y2 + LAYOUT_MARGIN);
    }
  });
  if (left < 0 || top < 0) {
    const move = (point: Point): Point => ({ x: point.x - left, y: point.y - top });
    for (const box of nodes) {
      box.x -= left;
      box.y -= top;
      if (box.title !== undefined) box.title = move(box.title);
    }
    for (const route of routes) {
      route.points = route.points.map(move);
      if (route.labelAnchor !== undefined) route.labelAnchor = move(route.labelAnchor);
      for (const [key, centre] of Object.entries(route.terminalLabelCenters ?? {})) {
        route.terminalLabelCenters![key as TerminalLabelKey] = move(centre);
      }
    }
  }
  return { width: right - left, height: bottom - top };
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

/**
 * The clearance ELK keeps between a port and each end of the side it is on:
 * `elk.spacing.portsSurrounding` in `ROOT_OPTIONS`, Mermaid's
 * `PORTS_SURROUNDING_MARGIN`.
 */
const PORTS_SURROUNDING_MARGIN = 12;

/**
 * Moves each box too small for ELK's port clearance onto the route at it —
 * Mermaid 12.2.0's `alignDegenerateNodeToAnchor` (`elk-V4PLJRSU.mjs`, line
 * 100618), which its `applyElkEdgeLayout` (line 100294) runs on every ELK
 * layout before anything else reads the routes.
 *
 * ELK keeps a port 12px from each end of a side (`PORTS_SURROUNDING_MARGIN`),
 * and a side shorter than twice that has no room for it: the port ends up
 * off the side's middle, and the route leaves a 14px disc 3px off its
 * centre. Measured in headless Chrome against Mermaid 12.2.0, `[*] --> Idle`
 * draws the start disc and Idle on one vertical line.
 *
 * The rule, Mermaid's: edges in input order, each one's end where ELK starts
 * it and then the end where ELK ends it (a turned edge, `subgraphFeedbackEdges`,
 * starts at the caller's `to`). Where the route meets the box's top or
 * bottom and the box is narrower than twice the clearance — or meets a side
 * and the box is shorter than that — the box moves along that side until its
 * middle is on the route. Each box moves at most once, for the first route
 * that reaches it. A post-layout pass Mermaid's ELK adapter runs, so it
 * lives in the core (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2). A
 * cluster is never moved.
 *
 * Every other route at a moved box is then put back on its outline
 * (`reattachEnd`): ELK spreads the ports on a side a few pixels apart, and on
 * a box this narrow some land past its corner, or on a side the move carried
 * away. Mermaid does the same — it runs each route to the moved box's centre
 * and cuts it at the outline (`applyElkEdgeLayout`, line 100384); measured in
 * headless Chrome, with `[*] --> A` and `[*] --> B` the second line leaves
 * the start disc 2px off its centre and still touches it.
 */
function centreSmallBoxesOnRoutes(
  input: DirectedGraphInput,
  boxes: readonly DirectedGraphNodeBox[],
  routes: readonly DirectedGraphEdgeRoute[],
  turned: readonly boolean[],
): void {
  const boxById = new Map(
    boxes.filter((_, index) => input.nodes[index].cluster === undefined).map((box) => [box.id, box]),
  );
  const aligned = new Set<string>();
  const moved = new Set<string>();
  const align = (id: string, anchor: Point) => {
    const box = boxById.get(id);
    if (box === undefined || aligned.has(id)) return;
    const tolerance = 0.5;
    const alongWidth =
      Math.abs(anchor.y - box.y) <= tolerance || Math.abs(anchor.y - (box.y + box.height)) <= tolerance;
    if ((alongWidth ? box.width : box.height) >= 2 * PORTS_SURROUNDING_MARGIN) return;
    aligned.add(id);
    const [x, y] = alongWidth ? [anchor.x - box.width / 2, box.y] : [box.x, anchor.y - box.height / 2];
    if (x !== box.x || y !== box.y) moved.add(id);
    box.x = x;
    box.y = y;
  };
  input.edges.forEach((edge, index) => {
    const points = routes[index].points;
    const [first, last] = [points[0], points[points.length - 1]];
    if (turned[index]) {
      align(edge.to, last);
      align(edge.from, first);
    } else {
      align(edge.from, first);
      align(edge.to, last);
    }
  });
  input.edges.forEach((edge, index) => {
    const route = routes[index];
    // Each end against the box it is drawn at: a turned edge starts at `to`.
    const [startId, endId] = turned[index] ? [edge.to, edge.from] : [edge.from, edge.to];
    if (moved.has(endId)) route.points = reattachEnd(route.points, boxById.get(endId)!);
    if (moved.has(startId)) route.points = reattachEnd([...route.points].reverse(), boxById.get(startId)!).reverse();
  });
}

/**
 * `points` with its last point put back on `box`'s outline, the route kept
 * orthogonal. The last run keeps its axis: it is lengthened or shortened
 * along it to the side it enters by, and where it would miss that side it
 * is moved across, into line with the side's nearest end — taking the bend
 * before it along, or, where there is no bend before it, with a sidestep
 * added halfway along the run. An end already on the outline is left as it is.
 */
function reattachEnd(points: Point[], box: DirectedGraphNodeBox): Point[] {
  if (points.length < 2) return points;
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  const axis = axisOf(before, end);
  if (axis === undefined) return points;
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  // Along the run: the side facing where the route comes from. Across it:
  // the nearest point that side has.
  const [along, across] = axis === "v" ? (["y", "x"] as const) : (["x", "y"] as const);
  const [low, high] = axis === "v" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
  const [acrossLow, acrossHigh] = axis === "v" ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
  const side = before[along] <= low ? low : before[along] >= high ? high : undefined;
  if (side === undefined) return points;
  const line = clamp(end[across], acrossLow, acrossHigh);
  const point = (alongValue: number, acrossValue: number): Point =>
    axis === "v" ? { x: acrossValue, y: alongValue } : { x: alongValue, y: acrossValue };
  const result = points.slice(0, -1);
  if (line !== end[across]) {
    if (result.length === 1 || axisOf(result[result.length - 2], before) === axis) {
      const halfway = (before[along] + side) / 2;
      result.push(point(halfway, before[across]), point(halfway, line));
    } else {
      result[result.length - 1] = point(before[along], line);
    }
  }
  result.push(point(side, line));
  return result;
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
 * Moves each cluster's title along its band, out of the way of the routes
 * that cross the band.
 *
 * **This is a departure from Mermaid 12.** Mermaid 12.2.0 centres the title
 * (a flowchart subgraph is a `rect` cluster, `chunk-LJKG65JO.mjs` line 1076,
 * and `rect` translates its label to the frame's centre less half the
 * label's width, `chunk-3YANZBYF.mjs` line 235), ELK puts the cluster's
 * first members under it, and an edge entering or leaving through the top
 * runs straight through the title's words (22 edges on the flowchart parity
 * fixtures). ELK cannot keep routes off the band: measured with elkjs
 * 0.9.3, the title handed over as the cluster's node label (`[H_CENTER,
 * V_TOP, INSIDE]`) is routed straight through; ports on the frame are
 * placed in line with the member they lead to whatever `portConstraints`
 * say (`FIXED_RATIO` throws); a title-sized child takes a slot beside the
 * first members rather than a band above them. So the core moves the title
 * after layout (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2), and
 * leaves every route as it is: taking routes round the title instead was
 * measured and rejected for the overshoots and detours it adds. The
 * departure and its numbers are nook decision `01M4VFW4XGRGSMTMQ12HME145W`.
 *
 * The rule, per titled cluster: every route segment, and every terminal
 * label (`placeTerminalLabels`), that reaches into the title's height blocks
 * its horizontal extent, widened by half the cluster's padding. A centred title clear of every blocked stretch stays
 * centred. Otherwise the title goes to the place nearest the centre that
 * clears them all, at the band's height and at least half a padding inside
 * the frame's sides; with no such place it stays centred — the frame is
 * never widened. The band is across the frame's top in every direction
 * (`clusterShape`), so the rule is the same under TB, BT, LR and RL. Under
 * LR and RL an edge meets a cluster at its sides, level with the member it
 * leads to, so no route has been seen to cross the band there.
 */
function placeTitlesClear(
  input: DirectedGraphInput,
  boxes: readonly DirectedGraphNodeBox[],
  routes: readonly DirectedGraphEdgeRoute[],
): void {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  for (const node of input.nodes) {
    const size = node.cluster?.title;
    const frame = boxById.get(node.id)!;
    if (size === undefined || frame.title === undefined) continue;
    const margin = node.cluster!.padding / 2;
    const top = frame.title.y - size.height / 2;
    const bottom = frame.title.y + size.height / 2;
    // Every stretch of the band a route runs through, widened by the margin.
    const blocked: [number, number][] = [];
    for (const route of routes) {
      route.points.forEach((point, index) => {
        if (index === 0) return;
        const previous = route.points[index - 1];
        if (Math.max(point.y, previous.y) <= top || Math.min(point.y, previous.y) >= bottom) return;
        blocked.push([Math.min(point.x, previous.x) - margin, Math.max(point.x, previous.x) + margin]);
      });
    }
    // And every terminal label that reaches into the title's height, the
    // same way: unlike an edge's centre label, which ELK places in a layer
    // and never in a band, an end label is placed beside the route's end,
    // and an end inside the frame puts it up in the band (nook decision
    // `01M4VHSY2W1Q9E5QCA51F1TCJM`, which measures it).
    routes.forEach((route, index) => {
      for (const [key, centre] of Object.entries(route.terminalLabelCenters ?? {})) {
        const label = input.edges[index].terminalLabels![key as TerminalLabelKey]!;
        if (centre.y + label.height / 2 <= top || centre.y - label.height / 2 >= bottom) continue;
        blocked.push([centre.x - label.width / 2 - margin, centre.x + label.width / 2 + margin]);
      }
    });
    const half = size.width / 2;
    const clear = (x: number) => blocked.every(([left, right]) => right <= x - half || left >= x + half);
    const centre = frame.x + frame.width / 2;
    if (clear(centre)) continue;
    // Where the title's centre may go: half a padding inside the frame's sides.
    const lowest = frame.x + margin + half;
    const highest = frame.x + frame.width - margin - half;
    if (highest < lowest) continue;
    // The title fits against either side of a blocked stretch, or against a
    // side of the frame; of the places that clear every route, the nearest
    // the centre.
    const places = [lowest, highest, ...blocked.flatMap(([left, right]) => [left - half, right + half])].filter(
      (x) => x >= lowest && x <= highest && clear(x),
    );
    if (places.length === 0) continue;
    const x = places.reduce((best, place) => (Math.abs(place - centre) < Math.abs(best - centre) ? place : best));
    frame.title = { x, y: frame.title.y };
  }
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
 * fitted frame (and may then be moved along its band, `placeTitlesClear`).
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
 * pairs in the same left/right order; 92.1% with this).
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
function chainOf(edge: DirectedGraphEdge, turned: boolean): Chain {
  const length = edge.from === edge.to ? 1 : Math.max(1, Math.floor(edge.minLength ?? 1));
  const terminals = terminalElkLabels(edge, turned);
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
      segments: [
        {
          id: edge.id,
          sources: [edge.from],
          targets: [edge.to],
          ...withLabels([...(label ?? []), ...terminals.tail, ...terminals.head]),
        },
      ],
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
    ...withLabels([
      ...(label && index === labelled ? label : []),
      ...(index === 0 ? terminals.tail : []),
      ...(index === length - 1 ? terminals.head : []),
    ]),
  }));
  return { edge, segments, points };
}

/** `{ labels }` when there are any, so an edge with none carries no empty list. */
function withLabels(labels: ElkLabel[]): { labels?: ElkLabel[] } {
  return labels.length === 0 ? {} : { labels };
}

const TERMINAL_LABEL_KEYS: readonly TerminalLabelKey[] = ["startLeft", "startRight", "endLeft", "endRight"];

/**
 * The id a terminal label is handed to ELK with: its edge's id and its key,
 * joined by a NUL no caller's id holds. The id is how the label is found
 * again in ELK's answer.
 */
const terminalLabelId = (edgeId: string, key: TerminalLabelKey) => `${edgeId}\u0000${key}`;

/** Which terminal label of the caller's edge `edgeId` an ELK label is, or `undefined` for its centre label. */
function terminalLabelKey(label: ElkLabel, edgeId: string): TerminalLabelKey | undefined {
  return TERMINAL_LABEL_KEYS.find((key) => label.id === terminalLabelId(edgeId, key));
}

/**
 * An edge's terminal labels as ELK labels — Mermaid 12.2.0's
 * `terminalElkLabels` (`elk-V4PLJRSU.mjs`, line 99827): each placed `TAIL`
 * (at the edge's start) or `HEAD` (at its end), as large as the label plus
 * its margin on every side, so ELK keeps room beside the end for it.
 *
 * Split by which end of the **ELK** edge each goes to. A turned edge
 * (`subgraphFeedbackEdges`) is handed to ELK end first, so its start labels
 * go to ELK's head and its end labels to ELK's tail: each stays at the end
 * of the line it belongs to. **A departure from Mermaid 12**, which turns the
 * edge and leaves the placements as they were, so a multiplicity on a turned
 * edge lands at the other class (nook decision `01M4VHSY2W1Q9E5QCA51F1TCJM`).
 */
function terminalElkLabels(edge: DirectedGraphEdge, turned: boolean): { tail: ElkLabel[]; head: ElkLabel[] } {
  const tail: ElkLabel[] = [];
  const head: ElkLabel[] = [];
  for (const key of TERMINAL_LABEL_KEYS) {
    const size = edge.terminalLabels?.[key];
    if (size === undefined) continue;
    const atTail = key.startsWith("start") !== turned;
    const margin = size.margin ?? 0;
    (atTail ? tail : head).push({
      id: terminalLabelId(edge.id, key),
      // ELK skips a label without text; the key will do.
      text: key,
      width: size.width + 2 * margin,
      height: size.height + 2 * margin,
      layoutOptions: { "elk.edgeLabels.placement": atTail ? "TAIL" : "HEAD" },
    });
  }
  return { tail, head };
}

/**
 * Where ELK put an edge's terminal labels, by key, in the drawing's
 * coordinates — Mermaid's reading in `applyElkEdgeLayout` (`elk-V4PLJRSU.mjs`,
 * line 100408): the centre of the box ELK placed, margin included, which is
 * the label's centre; a label ELK left at the origin is not placed.
 */
function terminalCentres(
  edgeId: string,
  segments: readonly ElkExtendedEdge[],
  routeById: ReadonlyMap<string, ElkExtendedEdge>,
  absoluteOrigin: (containerId: string | undefined) => Point,
): Partial<Record<TerminalLabelKey, Point>> | undefined {
  let centres: Partial<Record<TerminalLabelKey, Point>> | undefined;
  for (const segment of segments) {
    const routed = routeById.get(segment.id)!;
    const origin = absoluteOrigin((routed as { container?: string }).container);
    for (const label of routed.labels ?? []) {
      const key = terminalLabelKey(label, edgeId);
      if (key === undefined || (!label.x && !label.y)) continue;
      (centres ??= {})[key] = {
        x: origin.x + label.x! + label.width! / 2,
        y: origin.y + label.y! + label.height! / 2,
      };
    }
  }
  return centres;
}

/** A label's box by its two corners, Mermaid's `labelBox`. */
interface Corners {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const cornersOf = (centre: Point, size: { width: number; height: number }): Corners => ({
  x1: centre.x - size.width / 2,
  y1: centre.y - size.height / 2,
  x2: centre.x + size.width / 2,
  y2: centre.y + size.height / 2,
});

const cornersOverlap = (a: Corners, b: Corners) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

const segmentMeetsCorners = (a: Point, b: Point, box: Corners) =>
  segmentMeetsBox(
    a,
    b,
    { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 },
    { width: box.x2 - box.x1, height: box.y2 - box.y1 },
  );

/** How close a terminal label slid along its line may come to a frame: Mermaid's `TERMINAL_LABEL_FRAME_CLEARANCE`. */
const TERMINAL_LABEL_FRAME_CLEARANCE = 2;

/**
 * Moves each terminal label off any frame it overlaps and onto its own hand
 * of the line — Mermaid 12.2.0's `slideTerminalLabelsOffFrames` and
 * `putTerminalLabelsOnTheirSide` (`elk-V4PLJRSU.mjs`, lines 100547 and
 * 100580), with the obstacles of its `terminalLabelObstacles` (line 100479),
 * which its `applyElkEdgeLayout` runs on every ELK layout after
 * straightening the ends. Post-layout passes Mermaid's ELK adapter runs live
 * in the core (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2).
 *
 * The obstacles: every box that is not a cluster, every edge's centre label,
 * every side of every cluster's frame, every route segment but the one the
 * label is being moved along, and every other terminal label.
 *
 * - **Off frames, and off everything else.** A label that overlaps a
 *   frame's side slides along the segment it sits beside (the route's first
 *   for a start label, its last for an end label), a pixel at a time each
 *   way, to the nearest place still beside that segment where it is clear of
 *   every obstacle and 2px clear of every frame. With no such place it
 *   stays.
 *
 *   **Siren slides a label struck by any obstacle, not only a frame — a
 *   departure from Mermaid 12**, whose pass starts only for a label across a
 *   frame. ELK keeps room for an end label beside its own end but not clear
 *   of a neighbouring edge that leaves the same side: measured with the
 *   class adapter, `Keeper "1" --> "*" Animal` beside `Keeper -- Habitat`
 *   and `Habitat --* Animal` draws "*" across Habitat's line under TB, and
 *   "1" across it under LR. A multiplicity on another relationship's line
 *   reads as that line's. And where its own side of the line has no clear
 *   place, Siren tries the same across the line — the place mirrored across
 *   it, then sliding from there — where Mermaid leaves the label where it
 *   is: a neighbouring line can run alongside the whole segment (nook
 *   decision `01M4VHSY2W1Q9E5QCA51F1TCJM`, under rule 1 of
 *   `01M4VANRC6B2C14NHVC2KRZ9Y8`).
 * - **On its own hand.** A label on the wrong hand of that segment — a
 *   `…Right` label on its left, a `…Left` one on its right — is mirrored
 *   across the segment's line, if the mirrored place is clear.
 *
 * Mermaid first moves each label by however far its edge's end moved after
 * layout (`followMovedEndpoints`): Mermaid clips and shortens a route's ends
 * for its markers. The core moves no route's end — `straightenTerminals`
 * keeps both — so there is nothing to follow.
 */
function placeTerminalLabels(
  input: DirectedGraphInput,
  boxes: readonly DirectedGraphNodeBox[],
  routes: readonly DirectedGraphEdgeRoute[],
): void {
  const clusterIds = new Set(input.nodes.filter((node) => node.cluster !== undefined).map((node) => node.id));
  const nodeBoxes = boxes
    .filter((box) => !clusterIds.has(box.id))
    .map((box) => ({ x1: box.x, y1: box.y, x2: box.x + box.width, y2: box.y + box.height }));
  const frameSides = boxes
    .filter((box) => clusterIds.has(box.id))
    .flatMap((box): [Point, Point][] => {
      const [x1, y1, x2, y2] = [box.x, box.y, box.x + box.width, box.y + box.height];
      return [
        [{ x: x1, y: y1 }, { x: x2, y: y1 }],
        [{ x: x2, y: y1 }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: x1, y: y2 }],
        [{ x: x1, y: y2 }, { x: x1, y: y1 }],
      ];
    });
  const centreLabels = routes.flatMap((route, index) => {
    const size = input.edges[index].label;
    return route.labelAnchor === undefined || size === undefined ? [] : [cornersOf(route.labelAnchor, size)];
  });
  const hitsFrame = (box: Corners, clearance = 0) => {
    const padded = { x1: box.x1 - clearance, y1: box.y1 - clearance, x2: box.x2 + clearance, y2: box.y2 + clearance };
    return frameSides.some(([a, b]) => segmentMeetsCorners(a, b, padded));
  };
  const blocked = (box: Corners, edgeIndex: number, key: TerminalLabelKey, segment: number, clearance = 0) =>
    nodeBoxes.some((node) => cornersOverlap(box, node)) ||
    centreLabels.some((label) => cornersOverlap(box, label)) ||
    hitsFrame(box, clearance) ||
    routes.some((other, otherIndex) =>
      other.points.some(
        (point, i, all) =>
          i < all.length - 1 && !(otherIndex === edgeIndex && i === segment) && segmentMeetsCorners(point, all[i + 1], box),
      ),
    ) ||
    routes.some((other, otherIndex) =>
      Object.entries(other.terminalLabelCenters ?? {}).some(([otherKey, centre]) => {
        const size = input.edges[otherIndex].terminalLabels?.[otherKey as TerminalLabelKey];
        return !(otherIndex === edgeIndex && otherKey === key) && size !== undefined && cornersOverlap(box, cornersOf(centre, size));
      }),
    );

  /** Each placed terminal label with the segment it sits beside — Mermaid's `placedTerminalLabels`. */
  function* placed() {
    for (const [edgeIndex, route] of routes.entries()) {
      const points = route.points;
      if (points.length < 2 || route.terminalLabelCenters === undefined) continue;
      for (const key of TERMINAL_LABEL_KEYS) {
        const centre = route.terminalLabelCenters[key];
        const size = input.edges[edgeIndex].terminalLabels?.[key];
        if (centre === undefined || size === undefined) continue;
        const atStart = key.startsWith("start");
        const segment = atStart ? 0 : points.length - 2;
        const [from, to] = [points[segment], points[segment + 1]];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length === 0) continue;
        yield { route, edgeIndex, key, centre, size, atStart, segment, from, to, length };
      }
    }
  }

  for (const { route, edgeIndex, key, centre, size, atStart, segment, from, to, length } of placed()) {
    const where = cornersOf(centre, size);
    if (!blocked(where, edgeIndex, key, segment)) continue;
    const [far, end] = atStart ? [to, from] : [from, to];
    const dir = { x: (end.x - far.x) / length, y: (end.y - far.y) / length };
    const halfExtent = (Math.abs(dir.x) * size.width + Math.abs(dir.y) * size.height) / 2;
    const along = (c: Point) => (c.x - end.x) * dir.x + (c.y - end.y) * dir.y;
    const onSegment = (c: Point) => along(c) + halfExtent <= 0 && along(c) - halfExtent >= -length;
    const clear = (c: Point) =>
      onSegment(c) && !blocked(cornersOf(c, size), edgeIndex, key, segment, TERMINAL_LABEL_FRAME_CLEARANCE);
    /** The nearest place along the segment from `start`, a pixel at a time each way, that is clear. */
    const slide = (start: Point): Point | undefined => {
      for (let step = 1; step <= length; step++) {
        const found = [step, -step]
          .map((shift) => ({ x: start.x + shift * dir.x, y: start.y + shift * dir.y }))
          .find(clear);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    // Siren's: with no clear place on its own side of the line, the other
    // side — the label's own hand is a preference, a label on a line is a
    // misreading.
    const normal = { x: -dir.y, y: dir.x };
    const offset = (centre.x - end.x) * normal.x + (centre.y - end.y) * normal.y;
    const mirrored = { x: centre.x - 2 * offset * normal.x, y: centre.y - 2 * offset * normal.y };
    const found = slide(centre) ?? (offset === 0 ? undefined : clear(mirrored) ? mirrored : slide(mirrored));
    if (found !== undefined) route.terminalLabelCenters![key] = found;
  }

  for (const { route, edgeIndex, key, centre, size, segment, from, to, length } of placed()) {
    const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
    const offset = (centre.x - from.x) * normal.x + (centre.y - from.y) * normal.y;
    if (offset === 0 || offset > 0 === key.endsWith("Right")) continue;
    const mirrored = { x: centre.x - 2 * offset * normal.x, y: centre.y - 2 * offset * normal.y };
    if (!blocked(cornersOf(mirrored, size), edgeIndex, key, segment)) route.terminalLabelCenters![key] = mirrored;
  }
}

/**
 * How close two coordinates are to count as one: ELK's coordinates are
 * floats, and a run it draws straight can differ by rounding noise.
 */
const SAME_COORDINATE = 1e-6;

/** Whether `a` and `b` are one coordinate, to within `SAME_COORDINATE`. */
const sameCoordinate = (a: number, b: number): boolean => Math.abs(a - b) < SAME_COORDINATE;

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
    if (last !== undefined && sameCoordinate(last.x, point.x) && sameCoordinate(last.y, point.y)) continue;
    const before = kept.at(-2);
    // Straight on, not doubling back: a turn of 180° is a bend worth keeping.
    if (
      before !== undefined &&
      last !== undefined &&
      ((sameCoordinate(before.x, last.x) && sameCoordinate(last.x, point.x)) ||
        (sameCoordinate(before.y, last.y) && sameCoordinate(last.y, point.y))) &&
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
 * `B --> one` stacks them. And one case where this is not the rule Siren
 * kept before it moved onto ELK: `O` with `direction LR` holding a cluster
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
 * known exactly (`layoutDirectedGraph` computes its centre;
 * `placeTitlesClear` moves it along the band, never out of it, where a route
 * crosses it). The width floor is `nodeSize.minimum`, which has the same
 * rotation: a cluster sized inside the root's `INCLUDE_CHILDREN` pass under
 * `DOWN` or `UP` reads the minimum's two numbers swapped, while one laid out
 * in a pass of its own (`SEPARATE_CHILDREN`) reads them as written —
 * measured, both versions, every combination of root and cluster direction.
 * `contentAlignment` turns with it.
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
 * The ELK spacing a graph gives each of the runs between a box and the first
 * bend after it, unless told otherwise: half its `spacing.baseValue` — 20 on
 * the root, and the 30 `CLUSTER_OPTIONS` names in a cluster. Measured with
 * elkjs 0.9.3 on `A --> B` with a label: the route leaves A, runs 20 and
 * bends; the same in a cluster runs 30.
 */
const ROOT_STRAIGHT_RUN = Number(ROOT_OPTIONS["spacing.baseValue"]) / 2;
const CLUSTER_STRAIGHT_RUN = Number(CLUSTER_OPTIONS["elk.layered.spacing.edgeNodeBetweenLayers"]);
/**
 * How far a self-loop runs out of its box before it turns, unless told
 * otherwise: ELK's `spacing.nodeSelfLoop`, half the graph's
 * `spacing.baseValue` — measured, 20 on the root and 12 in a cluster.
 */
const ROOT_SELF_LOOP_RUN = Number(ROOT_OPTIONS["spacing.baseValue"]) / 2;
const CLUSTER_SELF_LOOP_RUN = Number(CLUSTER_OPTIONS["spacing.baseValue"]) / 2;

/**
 * Asks ELK for runs long enough to hold each edge's `straightEnds`, by
 * raising two of its spacings where an edge needs more than they give.
 *
 * **A departure from Mermaid 12.2.0**, which asks for nothing of the kind:
 * measured in headless Chrome, its ER routes leave a box by as little as 6px
 * of straight line before the rounded corner (a self-relationship) and
 * 12.9px on most ends, while its cardinality markers reach up to 34px out
 * along the line — so its crow's feet stick out past the bend, off the line
 * they belong to. Recorded under rule 1 of nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, with the measurements, as nook decision
 * `01M4VP6AVMYHJ9HDE0KST32ATA`.
 *
 * ELK keeps no per-edge length, so the floor is a graph's: each graph — the
 * root, or a cluster — that directly holds a box an edge ends at takes
 * `elk.layered.spacing.edgeNodeBetweenLayers` of at least that end's
 * `straightEnds` plus the rounding a right-angled corner cuts
 * (`cornerRadius × √2`, `cornerCut`'s 7.07 at radius 5). That spacing is the
 * room ELK leaves between a layer of boxes and the first vertical run in the
 * channel beside it, so every route out of a box in that graph runs at least
 * that far before it bends. A self-loop is routed by another spacing,
 * `elk.spacing.nodeSelfLoop` — how far it runs out before turning back —
 * which ELK reads per box through `elk.spacing.individual`, so only the box
 * the loop is on is given it. Neither spacing is ever lowered below what the
 * graph gives already, and an input with no `straightEnds` is laid out
 * exactly as before.
 */
function holdStraightEnds(
  input: DirectedGraphInput,
  nodeById: ReadonlyMap<string, DirectedGraphNode>,
  elkNodeById: ReadonlyMap<string, ElkNode>,
  rootOptions: Record<string, string>,
): void {
  /** By the id of the graph holding the box, `undefined` for the root. */
  const runs = new Map<string | undefined, number>();
  /** By the id of the box a self-loop is on. */
  const loops = new Map<string, number>();
  const raise = <K>(map: Map<K, number>, key: K, length: number) =>
    map.set(key, Math.max(map.get(key) ?? 0, length));
  for (const edge of input.edges) {
    if (edge.straightEnds === undefined) continue;
    const rounding = (edge.cornerRadius ?? 0) * Math.SQRT2;
    const { start, end } = edge.straightEnds;
    if (edge.from === edge.to) {
      raise(loops, edge.from, Math.max(start, end) + rounding);
      continue;
    }
    raise(runs, nodeById.get(edge.from)?.parentId, start + rounding);
    raise(runs, nodeById.get(edge.to)?.parentId, end + rounding);
  }
  for (const [graphId, length] of runs) {
    const options = graphId === undefined ? rootOptions : elkNodeById.get(graphId)!.layoutOptions!;
    const given = graphId === undefined ? ROOT_STRAIGHT_RUN : CLUSTER_STRAIGHT_RUN;
    if (length > given) options["elk.layered.spacing.edgeNodeBetweenLayers"] = String(length);
  }
  for (const [nodeId, length] of loops) {
    const given = nodeById.get(nodeId)!.parentId === undefined ? ROOT_SELF_LOOP_RUN : CLUSTER_SELF_LOOP_RUN;
    if (length <= given) continue;
    const elkNode = elkNodeById.get(nodeId)!;
    elkNode.layoutOptions = { ...elkNode.layoutOptions, "elk.spacing.individual": `elk.spacing.nodeSelfLoop:${length}` };
  }
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
