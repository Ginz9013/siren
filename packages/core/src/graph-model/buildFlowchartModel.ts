import type {
  AuthorStyle,
  Diagnostic,
  FlowchartDocument,
  GraphEdge,
  GraphModel,
  GraphNode,
  LinkStyleDecl,
  ResolvedSubgraph,
  SirenSubgraph,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { generatedId } from "./generatedId";
import { resolveInteractions } from "./resolveInteractions";
import { resolveStyles } from "./resolveStyles";
import { resolveTimeline, warnOnConnectorsOutlivingTheirEndpoints } from "./resolveTimeline";

/**
 * Resolves a parsed `FlowchartDocument` into a validated `GraphModel`:
 * assigns stable edge ids, dedupes nodes (last-label-wins), and resolves
 * every `timeline:` reference against real node/edge ids — dropping
 * unresolved entries (with an error diagnostic) rather than failing the
 * whole graph.
 *
 * Author styling is resolved by the shared `resolveStyles`, not here: the
 * rules for what a declaration means, and the gate ADR-0008 calls the
 * board's security boundary for styling, are written once and read by every
 * diagram kind. What is flowchart-specific is only *which ids exist* — its
 * nodes — and that is the argument this function passes.
 *
 * Its own return shape stays flowchart-only (no `model` field) — this module
 * has no reason to know sequence-diagram types exist; the dispatcher
 * (`buildGraphModel`) is what assembles the wider `GraphModelResult`.
 */
export function buildFlowchartModel(
  document: FlowchartDocument,
): { graph: GraphModel; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  const nodes = resolveNodes(document);
  // Before the edges, because an edge endpoint may name a subgraph and the
  // id it names it by is minted here.
  const { subgraphs, idByName } = resolveSubgraphs(document, nodes);
  const edges = assignEdgeIds(document, idByName);

  // Every styling statement a flowchart can write except one — `style`,
  // `classDef`, and the apply-directive in both its `class` and its `:::`
  // spelling — names a node. `linkStyle` is the exception, and it is
  // resolved separately below.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const { targetId, style } of resolveStyles(
    document.styles,
    new Set(nodeById.keys()),
    diagnostics,
  )) {
    // Every id `resolveStyles` returns is one it was handed, so this cannot
    // miss; a node nothing styled keeps the empty halves it was built with.
    //
    // Both halves are carried, not just the frame's: which of a node's
    // elements a declaration is about was settled by `resolveStyles`, and
    // re-deciding it here would be the second opinion that split is meant
    // to prevent.
    nodeById.get(targetId)!.style = style;
  }

  // The same resolver `resolveStyles` above already shares with the class
  // diagram, one URL allowlist over: nothing here looks at a node, so
  // `resolveInteractions` reads a flowchart's `click` statements without
  // knowing the kind it was handed. A node with no interaction of its own
  // keeps the `null` it was built with.
  for (const interaction of resolveInteractions(
    document.interactions,
    new Set(nodeById.keys()),
    diagnostics,
  )) {
    nodeById.get(interaction.targetId)!.interaction = interaction;
  }

  // The same resolver, the same gate, a different set of ids — reusing it
  // is what keeps `linkStyle` from growing a styling pipeline of its own.
  // What it is handed has already stopped being about indices:
  // `asStyleDeclarations` spends every address on the edge ids assigned
  // just above, so nothing past this point can name an edge by position.
  //
  // It is handed two lists rather than one, because `linkStyle` has a tier
  // `style` has not: `linkStyle default` is Mermaid's fallback for the
  // links nothing else styles, so a specific `linkStyle N` beats it for the
  // edge it names whichever order the author wrote the two in. Resolving
  // the fallback tier first and letting the specific tier land on top is
  // that rule, and it is the whole of it.
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const edgeIds = new Set(edgeById.keys());
  const { fallback, specific } = asStyleDeclarations(document.linkStyles, edges, diagnostics);

  // Within each tier nothing changes: one `resolveStyles` call per tier
  // means two `linkStyle default` statements still settle between
  // themselves by ADR-0008's last-declaration-wins, because they are one
  // tier and not one tier each.
  for (const { targetId, style } of resolveStyles(fallback, edgeIds, diagnostics)) {
    edgeById.get(targetId)!.style = style;
  }
  for (const { targetId, style } of resolveStyles(specific, edgeIds, diagnostics)) {
    const edge = edgeById.get(targetId)!;
    edge.style = overriding(edge.style, style);
  }

  // A subgraph is a timeline target on the same terms as a node and an edge:
  // it is a drawn thing with an id, and board 2's rule is that a diagram kind
  // gains animation by tagging what it draws with the ids the timeline uses.
  // A class diagram's namespace has been addressable this way since the class
  // board, and a frame nobody could name would be a decision by omission
  // rather than a feature that was not reached.
  const validTargetIds = new Set<string>([
    ...nodes.map((n) => n.id),
    ...edges.map((e) => e.id),
    ...subgraphs.map((s) => s.id),
  ]);

  const { entries, totalSteps } = resolveTimeline(document.timeline, validTargetIds, diagnostics);

  warnOnConnectorsOutlivingTheirEndpoints(entries, edges, "edge", diagnostics);

  const graph: GraphModel = {
    direction: document.direction,
    nodes,
    edges,
    subgraphs,
    accTitle: document.accTitle,
    accDescr: document.accDescr,
    timeline: { totalSteps, entries },
  };

  return { graph, diagnostics };
}

/**
 * One edge's fallback declarations with a specific statement's laid over
 * them: same properties, the named ones taking the specific value.
 *
 * A tier is what an edge falls back *to*, not a set the specific statement
 * swaps out. `linkStyle default stroke:#0f0,stroke-width:4px` beside
 * `linkStyle 0 stroke:#f00` leaves edge 0 red *and* 4px wide, because the
 * author wrote the width once and never took it back — a replacement would
 * silently drop every property the specific statement did not happen to
 * mention.
 *
 * The property keeps the position of its first declaration and takes the
 * value of its last, which is the rule `resolveStyles` already applies
 * within a tier, applied here between two.
 */
function overriding(fallback: AuthorStyle, specific: AuthorStyle): AuthorStyle {
  return {
    frame: overridingProperties(fallback.frame, specific.frame),
    // Half by half, because the two tiers are two statements about the same
    // edge and each half is about a different element of it. Merging them
    // together would let a `linkStyle default color:#fff` be taken back by
    // a `linkStyle 0 stroke:#f00` that never mentioned the label.
    text: overridingProperties(fallback.text, specific.text),
  };
}

/** One half of `overriding`: the fallback's declarations with the specific statement's laid over them. */
function overridingProperties(
  fallback: readonly StyleProperty[],
  specific: readonly StyleProperty[],
): StyleProperty[] {
  const merged = new Map(fallback.map(({ property, value }) => [property, value]));
  for (const { property, value } of specific) {
    merged.set(property, value);
  }
  return [...merged].map(([property, value]) => ({ property, value }));
}

/**
 * The styling a node or an edge is built with: declared nothing, in both
 * halves.
 *
 * A fresh object each call rather than one shared constant, so two
 * unstyled elements can never end up sharing the arrays a later assignment
 * would have to be careful not to mutate.
 */
function unstyled(): AuthorStyle {
  return { frame: [], text: [] };
}

function resolveNodes(document: FlowchartDocument): GraphNode[] {
  const nodesById = new Map<string, GraphNode>();

  for (const node of document.nodes) {
    const existing = nodesById.get(node.id);
    if (existing === undefined) {
      // The shape travels with the label, from the same declaration: a
      // spelling is read once, in the parser, and this stage has no business
      // re-deciding what `A{X}` meant.
      nodesById.set(node.id, {
        id: node.id,
        label: node.label,
        shape: node.shape,
        style: unstyled(),
        // Filled in by `resolveSubgraphs`, once the blocks have ids to point
        // at. `null` here rather than left out, so a node nobody grouped is
        // in the state every reader downstream expects rather than in a
        // second one.
        parentId: null,
        // Filled in by the `resolveInteractions` loop below, for the nodes
        // an interaction actually targets. `null` here rather than left out,
        // the same empty-not-absent rule `style` and `parentId` follow.
        interaction: null,
      });
      continue;
    }
    // A later declaration's label and shape replace the earlier ones,
    // silently — the parser's rule, held here as well so a hand-built
    // document draws what the same nodes parsed would. Mermaid 11.17.2,
    // measured: `A[x]` then `A[y]` draws "y", and `A[x]` then `A{x}` a
    // diamond, each with no diagnostic.
    existing.label = node.label;
    existing.shape = node.shape;
  }

  return [...nodesById.values()];
}

/**
 * Flattens the document's `subgraph` tree into the list layout reads, minting
 * each block the generated id it is addressed by and writing every member's
 * parentage onto the node itself.
 *
 * **The id is generated rather than authored**, exactly as a namespace's is,
 * and the argument is ADR-0010's: a subgraph may legitimately be titled after
 * a node (mermaid 11.17.2 accepts `A[Alpha]` beside `subgraph A`, measured),
 * so the author's own word would put two unrelated drawn elements in one
 * `data-siren-id`. A colon cannot appear in a node id or in a `${from}-${to}`
 * edge id, so `subgraph:1` cannot be spelled by either.
 *
 * Pre-order, so the numbering is the order the `subgraph` keywords were
 * written — what an author counts down the page — rather than the order the
 * blocks happened to close in.
 *
 * Membership lands on `GraphNode.parentId` and nowhere else. Keeping a member
 * list here as well would be a second statement of the same fact, free to
 * disagree with the first; the frame is grown from the boxes that name it, so
 * the boxes are where the naming belongs.
 *
 * It also returns what an *edge* needs: the generated id for each authored
 * handle a block was opened with. That is the one thing `SirenSubgraph.name`
 * is kept for — the author can write `one --> two`, and this is where the
 * word they wrote becomes the id the frame is addressed by. **First block
 * wins** on a repeated handle, the same rule the parser already applies to a
 * node claimed by two blocks, so a second `subgraph one` further down cannot
 * quietly take an edge written above it.
 */
function resolveSubgraphs(
  document: FlowchartDocument,
  nodes: readonly GraphNode[],
): { subgraphs: ResolvedSubgraph[]; idByName: ReadonlyMap<string, string> } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resolved: ResolvedSubgraph[] = [];
  const idByName = new Map<string, string>();

  const visit = (subgraph: SirenSubgraph, parentId: string | null): void => {
    const id = generatedId("subgraph", resolved.length + 1);
    resolved.push({ id, label: subgraph.label, parentId, direction: subgraph.direction });
    if (subgraph.name !== null && !idByName.has(subgraph.name)) {
      idByName.set(subgraph.name, id);
    }

    for (const nodeId of subgraph.nodeIds) {
      // A member the document has no node for cannot arise from this
      // parser — a block only claims ids at the moment they are written, and
      // writing one declares it — so this is the layout declining to invent
      // parentage rather than a case with a diagnostic of its own.
      const node = nodeById.get(nodeId);
      if (node !== undefined) {
        node.parentId = id;
      }
    }

    for (const child of subgraph.subgraphs) {
      visit(child, id);
    }
  };

  for (const subgraph of document.subgraphs) {
    visit(subgraph, null);
  }

  return { subgraphs: resolved, idByName };
}

/**
 * The document's edges with their ids assigned and each endpoint resolved to
 * the thing it addresses — a node id as written, or the generated id of the
 * `subgraph` frame whose handle it names.
 *
 * **The id is spelled in the author's own words and the endpoints are not**,
 * which is the one place in this pipeline those two come apart. ADR-0010
 * separates generated ids from connector ids on the promise that no
 * `${from}-${to}` id can contain a colon, and `subgraph:1` is all colon — so
 * `one --> two` is the edge `one-two`, addressable in a `timeline:` block by
 * the words on the page, running between `subgraph:1` and `subgraph:2`. It
 * cannot collide with an edge between two *nodes* of those names, because a
 * name a block claimed is never a node: the parser takes back the node an
 * endpoint would have declared for it.
 */
function assignEdgeIds(
  document: FlowchartDocument,
  idByName: ReadonlyMap<string, string>,
): GraphEdge[] {
  const seenPairCounts = new Map<string, number>();

  return document.edges.map((edge) => {
    const pairKey = `${edge.from}->${edge.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);

    const baseId = `${edge.from}-${edge.to}`;
    const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;

    // The arrow travels with the edge, from the token the parser read: a
    // spelling is decomposed once, and this stage has no business
    // re-deciding what `A -.-> B` meant — the rule `shape` already follows
    // one function up.
    return {
      id,
      from: idByName.get(edge.from) ?? edge.from,
      to: idByName.get(edge.to) ?? edge.to,
      line: edge.line,
      fromEnd: edge.fromEnd,
      toEnd: edge.toEnd,
      minLength: edge.minLength,
      label: edge.label,
      style: unstyled(),
    };
  });
}

/**
 * Rewrites each `linkStyle` statement as the `StyleDecl` the shared
 * resolver reads, turning every address the author wrote into the id of the
 * edge it names, and sorting the statements into the two tiers a
 * `linkStyle` document has.
 *
 * A statement lands in `fallback` when it names `default` and in `specific`
 * otherwise. A statement naming `default` beside an index is wholly a
 * fallback statement: `default` already covers every edge of that same
 * statement, index included, with those same declarations, so the index
 * changes nothing it says — it only still has to resolve, so that an index
 * naming no edge is diagnosed rather than waved through.
 *
 * **This is where an index stops existing.** Mermaid addresses an edge by
 * its declaration position and everything downstream of the model addresses
 * it by id, so one of the two has to end somewhere; it ends here, in the
 * one function that can see both. The result is indistinguishable from a
 * `style` statement — same kind, same `targetIds`, same trip through the
 * same gate — which is why no layout, renderer or timeline code has to know
 * that `linkStyle` exists.
 *
 * `authoredAs` stays `linkStyle` because a diagnostic may quote it, and an
 * author who wrote `linkStyle 0` never wrote the word `style`.
 */
function asStyleDeclarations(
  linkStyles: readonly LinkStyleDecl[],
  edges: readonly GraphEdge[],
  diagnostics: Diagnostic[],
): { fallback: StyleDecl[]; specific: StyleDecl[] } {
  const fallback: StyleDecl[] = [];
  const specific: StyleDecl[] = [];

  for (const linkStyle of linkStyles) {
    const declaration: StyleDecl = {
      styleKind: "style",
      authoredAs: "linkStyle",
      targetIds: linkStyle.targets.flatMap((target) =>
        resolveAddress(target, edges, linkStyle, diagnostics),
      ),
      name: null,
      properties: linkStyle.properties,
      line: linkStyle.line,
      column: linkStyle.column,
    };
    // Every statement reaches exactly one tier, so the gate inside
    // `resolveStyles` still sees each written declaration once and a
    // refused value is still reported once, at the line that wrote it.
    (linkStyle.targets.includes(EVERY_EDGE) ? fallback : specific).push(declaration);
  }

  return { fallback, specific };
}

/** A zero-based edge declaration index, and nothing else — not `-1`, not `1.5`. */
const EDGE_INDEX_RE = /^\d+$/;

/** Mermaid's `linkStyle default`: the author's document-wide default for edges. */
const EVERY_EDGE = "default";

/**
 * The edge ids one authored address names: one for an index that lands,
 * every id for `default`, none for an address that names no edge.
 *
 * An address that names nothing costs itself and not the statement beside
 * it, which is the rule `resolveStyles` already applies to an unknown id —
 * so a `linkStyle 0,x` still paints edge 0, and the author is told about
 * `x` rather than left to notice.
 *
 * `default` is spent here, on the ids that exist, rather than carried
 * downstream as a wildcard. That is the same rule an index follows and it
 * buys the same thing: nothing past the model has to know an edge can be
 * addressed by anything but its id. What it does not buy is the precedence
 * between the two spellings — a fallback that beat a specific statement
 * merely by being written below it would diverge from Mermaid — so that is
 * decided by which tier the statement is sorted into, one caller up.
 */
function resolveAddress(
  target: string,
  edges: readonly GraphEdge[],
  linkStyle: LinkStyleDecl,
  diagnostics: Diagnostic[],
): string[] {
  if (target === EVERY_EDGE) {
    return edges.map((edge) => edge.id);
  }

  if (!EDGE_INDEX_RE.test(target)) {
    diagnostics.push({
      severity: "error",
      message: `linkStyle addresses "${target}", which is neither an edge index nor "default"; dropping the declaration.`,
      line: linkStyle.line,
      column: linkStyle.column,
    });
    return [];
  }

  const index = Number(target);
  const edge = edges[index];
  if (edge === undefined) {
    diagnostics.push({
      severity: "error",
      message: `linkStyle index ${index} addresses no edge in a document with ${edges.length} edge${edges.length === 1 ? "" : "s"}; dropping the declaration.`,
      line: linkStyle.line,
      column: linkStyle.column,
    });
    return [];
  }
  return [edge.id];
}
