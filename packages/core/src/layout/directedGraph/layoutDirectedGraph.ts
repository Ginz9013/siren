/**
 * The shared layout core, on ELK: takes boxes, groups and edges with their
 * sizes, and hands back where everything goes. It measures no text, knows no
 * diagram kind, and draws nothing — the same seam the dagre core in
 * `../layoutDirectedGraph.ts` has kept since ADR-0001, with a different
 * engine behind it. The flowchart reaches it through `layoutGraph`; class,
 * state and ER diagrams stay on the dagre core until their own tickets of the
 * elk-migration board move them, after which this module moves back to that
 * path and keeps this name.
 *
 * The engine is ELK's `layered` algorithm (elkjs, reached only through
 * `elkSync.ts`), configured as Mermaid 12.2.0 configures it for its own
 * default layout — see `ROOT_OPTIONS` and `groupOptions` for every option and
 * where it was read. Mermaid 12 is the baseline (the elk-migration board's
 * Domain decision 1): what the picture looks like is Mermaid's to decide, and
 * where Siren departs from it the departure is measured and written down
 * beside the code that departs.
 */
import type { Direction, Point } from "../../contracts";
import { layoutWithElk, type ElkExtendedEdge, type ElkNode } from "./elkSync";

/** A box to place. Sizes are given by the caller; this module never measures. */
export interface DirectedGraphNode {
  id: string;
  width: number;
  height: number;
  /** The group this box (or group) sits inside, by that group's id. */
  parentId?: string;
  /**
   * Declares this node a **group**: a frame around the nodes that name it as
   * their `parentId`, sized by the engine to hold them. `width`/`height` are
   * then ignored — a group is as large as what it holds, its padding and its
   * title make it, and never smaller than its title and padding.
   */
  cluster?: DirectedGraphCluster;
}

/** What makes a node a group: the room it keeps around its members, and its title. */
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
   * The direction the group lays its own members out in, when it declares
   * one. It holds only while no edge makes the group give it up — see
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
}

/** Everything the core needs to place a directed graph. */
export interface DirectedGraphInput {
  direction: Direction;
  /**
   * Every box and group, **in the model's order** — the order is input, not
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
  /** A group's title centre, in the band across the frame's top. Absent for a plain box and an untitled group. */
  title?: Point;
}

/** A routed edge. */
export interface DirectedGraphEdgeRoute {
  id: string;
  points: Point[];
  /** Centre of the room kept for the label, on the route. Absent when the edge has no label. */
  labelAnchor?: Point;
  /**
   * Where this route jumps another with a small arc. Always empty for now:
   * the board's T03 fills it, and the field exists ahead of it so the
   * renderer's input keeps one shape.
   */
  hops: Point[];
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
  // One layout pass over the whole hierarchy, so an edge between two groups
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
 * The options every group carries — Mermaid 12.2.0's
 * `buildSubgraphLayoutOptions` (`elk-V4PLJRSU.mjs`, around line 99284) with
 * its default configuration, less the three it decides per subgraph: its
 * padding (24 there; the caller's here), its title (see `groupShape`) and
 * its direction (see `layoutDirectedGraph`).
 */
const GROUP_OPTIONS: Record<string, string> = {
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
  // Parentage once every node exists, so a group may be listed after its
  // members. Children are appended in input order, which is the order ELK
  // is asked to keep.
  const topLevel: ElkNode[] = [];
  for (const node of input.nodes) {
    const elkNode = elkNodeById.get(node.id)!;
    if (node.parentId === undefined) {
      topLevel.push(elkNode);
    } else {
      const parent = elkNodeById.get(node.parentId)!;
      (parent.children ??= []).push(elkNode);
    }
  }
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const voided = voidedDirections(input, nodeById);
  /** Whether this group is laid out in a pass of its own: it keeps a direction. */
  const ownPass = (node: DirectedGraphNode): boolean =>
    node.cluster?.direction !== undefined && !voided.has(node.id) && hasMembers.has(node.id);
  /** Whether this node, or any group above it, is laid out in a pass of its own. */
  const inOwnPass = (node: DirectedGraphNode | undefined): boolean =>
    node !== undefined && (ownPass(node) || inOwnPass(node.parentId === undefined ? undefined : nodeById.get(node.parentId)));
  for (const node of input.nodes) {
    if (node.cluster !== undefined) {
      const elkNode = elkNodeById.get(node.id)!;
      // Rotated only inside the root's own `INCLUDE_CHILDREN` pass; see `groupShape`.
      Object.assign(elkNode, groupShape(node.cluster, hasMembers.has(node.id), vertical && !inOwnPass(node)));
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
  // join the graph where its two ends' nearest common group holds them, so
  // they lay out among the boxes the edge runs between.
  const chains = input.edges.map((edge) => chainOf(edge));
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
  const edges = chains.map(({ edge, segments }) => {
    const pieces = segments.map((segment) => absoluteRoute(segment.id));
    const route: DirectedGraphEdgeRoute = {
      id: edge.id,
      points: withoutStraightRuns(pieces.flatMap((piece) => piece.points)),
      hops: [],
    };
    const labelAnchor = pieces.find((piece) => piece.labelAnchor !== undefined)?.labelAnchor;
    if (edge.label !== undefined && labelAnchor !== undefined) route.labelAnchor = labelAnchor;
    return route;
  });

  return {
    nodes,
    edges,
    width: laidOut.width!,
    height: laidOut.height!,
  };
}

/**
 * The nearest group holding both `a` and `b` — Mermaid's `findCommonAncestor`
 * (`elk-V4PLJRSU.mjs`, line 98673), including its two quirks: one end that
 * is itself an ancestor of the other is the answer, and an edge from a node
 * to itself answers that node's parent. `undefined` is the diagram itself.
 */
function commonAncestor(
  a: string,
  b: string,
  nodeById: ReadonlyMap<string, DirectedGraphNode>,
): string | undefined {
  const parentOf = (id: string): string | undefined => nodeById.get(id)?.parentId;
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
 * document and Siren draws what the document says (the migration's Domain
 * decision 9; see the nook decision on `---->`).
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
 * The groups whose declared direction does not hold: Mermaid 12.2.0's
 * `configureCrossHierarchyEdges` and `setIncludeChildrenPolicy`
 * (`elk-V4PLJRSU.mjs`, around line 99889), which force a group back into its
 * parent's layout pass — and so into its parent's direction.
 *
 * The rule: an edge whose two ends have different parents voids every group
 * on the way up from each end to the two ends' nearest common ancestor —
 * the end itself when it is a group, and the common ancestor too when that
 * is a group rather than the diagram. An edge whose ends share a parent
 * voids nothing, which is why `C --> G` from beside a group leaves the group
 * its direction.
 *
 * Measured in headless Chrome against Mermaid 12.2.0's default layout
 * (elk-migration T02): a TB diagram with `subgraph one` declaring
 * `direction LR` around `A --> B` draws A and B side by side; adding
 * `C --> A` stacks them; adding `C --> one` instead keeps the row; adding
 * `B --> one` stacks them. And one case where this is not the dagre-era
 * **Boundary-crossing edge** rule: `O` with `direction LR` holding a group
 * `I` (holding `A`) and `B`, with `A --> B` — no edge leaves `O`, and Mermaid
 * stacks `A` above `B` all the same, because `A` and `B` have different
 * parents and their common ancestor is `O`.
 */
function voidedDirections(
  input: DirectedGraphInput,
  nodeById: ReadonlyMap<string, DirectedGraphNode>,
): Set<string> {
  const parentOf = (id: string): string | undefined => nodeById.get(id)?.parentId;
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
 * The ELK shape of a group: its padding with the title band folded into the
 * top, and a minimum width that holds the title.
 *
 * **The title is not handed to ELK as a label, deliberately.** Mermaid does
 * hand it over — as the group's node label, placed `[H_CENTER V_TOP,
 * INSIDE]` with the `NODE_LABELS` size constraint — and under a vertical
 * direction ELK sizes the frame in its own rotated frame of reference and
 * applies the title's *width* to the frame's *height*. Measured with elkjs
 * 0.12.0 and 0.9.3 alike: a group holding one 20x20 box under a 200-wide
 * title comes back 52 wide and 224 tall under `DOWN`, 224x76 under `RIGHT`;
 * Mermaid 12.2.0's own options reproduce it (200x271.5 for a 152-wide member
 * under a 261.5-wide title), and Mermaid repairs the frame afterwards in
 * `evenGroupFrames` while the space ELK reserved stays reserved. Domain
 * decision 2 of the migration leaves geometry to the engine alone, so the
 * repair is not available here; asking ELK for the right box is.
 *
 * So the band is padding: the top padding is the caller's padding, the
 * title's height and the padding again, and the title's place in it is then
 * known exactly (`layoutDirectedGraph` computes its centre). The width floor
 * is `nodeSize.minimum`, which has the same rotation: a group sized inside
 * the root's `INCLUDE_CHILDREN` pass under `DOWN` or `UP` reads the minimum's
 * two numbers swapped, while one laid out in a pass of its own
 * (`SEPARATE_CHILDREN`) reads them as written — measured, both versions,
 * every combination of root and group direction. `contentAlignment` turns
 * with it.
 *
 * A group with no members is laid out as an ordinary box, the title and its
 * padding on every side.
 */
function groupShape(cluster: DirectedGraphCluster, hasMembers: boolean, rotated: boolean): Partial<ElkNode> {
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
      ...GROUP_OPTIONS,
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
