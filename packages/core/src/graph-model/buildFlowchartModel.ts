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
import { CURVES, FLOWCHART_DEFAULT_CURVE, isCurve, isMermaidOnlyCurve, type Curve } from "../curve/curve";
import { generatedId } from "./generatedId";
import { resolveInteractions } from "./resolveInteractions";
import { resolveStyles } from "./resolveStyles";
import { resolveTimelineBlocks } from "./resolveTimeline";

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
  reportAuthoredEdgeIdClashes(document, nodes, idByName, edges, diagnostics);

  // Every styling statement a flowchart can write except one — `style`,
  // `classDef`, and the apply-directive in both its `class` and its `:::`
  // spelling — names a node. `linkStyle` is the exception, and it is
  // resolved separately below.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // An id the author gave an edge, named by one of those node statements,
  // is the edge's: Mermaid 12.2.0 draws `class e1 c` as the edge painted
  // with `c`, and `style e1 …` as nothing at all (measured), so the class is
  // applied below and the `style` refused.
  const idLineByEdgeId = new Map(
    document.edges.flatMap((edge) => (edge.id === undefined ? [] : [[edge.id, edge.idLine ?? 0] as const])),
  );
  const edgeClasses: StyleDecl[] = [];
  const nodeStyles = document.styles.map((declaration) => {
    if (declaration.styleKind === "classDef") {
      return declaration;
    }
    const onEdges = declaration.targetIds.filter((id) => !nodeById.has(id) && idLineByEdgeId.has(id));
    for (const id of onEdges) {
      if (declaration.styleKind === "style") {
        diagnostics.push({
          severity: "error",
          message: `"${id}" is an edge, and style reaches only a node. Style an edge with linkStyle and its number`,
          line: declaration.line,
          column: declaration.column,
        });
      } else if ((declaration.line ?? 0) < idLineByEdgeId.get(id)!) {
        // Mermaid applies a class to an edge only once the edge exists.
        diagnostics.push({
          severity: "error",
          message: `The class statement names the edge "${id}" above the line it is written on, so it reaches nothing. Move it below the edge`,
          line: declaration.line,
          column: declaration.column,
        });
      } else {
        edgeClasses.push({ ...declaration, targetIds: [id] });
      }
    }
    return onEdges.length === 0
      ? declaration
      : { ...declaration, targetIds: declaration.targetIds.filter((id) => !onEdges.includes(id)) };
  });
  for (const { targetId, style } of resolveStyles(
    withImplicitDefaultClass(nodeStyles, [...nodeById.keys()]),
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
  // An id the author gave an edge is no node, so a click naming it is told
  // that, rather than that it names nothing: Mermaid 12.2.0 makes nothing
  // clickable for `click e1 …` after `A e1@--> B` (measured).
  const nodeInteractions = document.interactions.filter((interaction) => {
    if (nodeById.has(interaction.targetId) || !idLineByEdgeId.has(interaction.targetId)) {
      return true;
    }
    diagnostics.push({
      severity: "error",
      message: `"${interaction.targetId}" is an edge, and a click reaches only a node. Leave the click out, or name a node`,
      line: interaction.line,
      column: interaction.column,
    });
    return false;
  });
  for (const interaction of resolveInteractions(nodeInteractions, new Set(nodeById.keys()), diagnostics)) {
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
  const addressed = addressLinkStyles(document.linkStyles, edges, diagnostics);
  const { fallback, specific } = asStyleDeclarations(addressed);

  // Within each tier nothing changes: one `resolveStyles` call per tier
  // means two `linkStyle default` statements still settle between
  // themselves by ADR-0008's last-declaration-wins, because they are one
  // tier and not one tier each.
  // A class applied to an edge is the tier beneath both: Mermaid writes its
  // declarations first and the `linkStyle`'s after them (measured, a
  // `linkStyle` written above the `class` still wins). A class that would
  // animate the edge is refused: Mermaid animates it with keyframes of its
  // own, which this stylesheet does not carry, and the edge's own
  // `e1@{ animate: true }` says the same thing.
  const classDefs = document.styles.filter((declaration) => declaration.styleKind === "classDef");
  for (const { targetId, style } of resolveStyles([...classDefs, ...edgeClasses], edgeIds, diagnostics)) {
    const animating = style.frame.some(({ property }) => property === "animation");
    if (animating) {
      const applied = edgeClasses.find((declaration) => declaration.targetIds.includes(targetId))!;
      diagnostics.push({
        severity: "error",
        message: `A class cannot animate the edge "${targetId}". Write ${targetId}@{ animate: true } below the edge instead`,
        line: applied.line,
        column: applied.column,
      });
    }
    edgeById.get(targetId)!.style = {
      ...style,
      frame: style.frame.filter(({ property }) => property !== "animation"),
    };
  }
  for (const { targetId, style } of resolveStyles(fallback, edgeIds, diagnostics)) {
    const edge = edgeById.get(targetId)!;
    edge.style = overriding(edge.style, style);
  }
  for (const { targetId, style } of resolveStyles(specific, edgeIds, diagnostics)) {
    const edge = edgeById.get(targetId)!;
    edge.style = overriding(edge.style, style);
  }

  // The curve rides the same two tiers, from the same resolved addresses,
  // so an index that names no edge is diagnosed once, above, and not again.
  // An edge no `interpolate` reached is left without one, which the
  // renderer draws on the default — see `GraphEdge.curve`.
  for (const [targetId, curve] of resolveCurves(addressed, diagnostics)) {
    edgeById.get(targetId)!.curve = curve;
  }

  // What an edge's own `e1@{ … }` data says: its animation, and its curve
  // on the terms `GraphEdge.curve` states against `linkStyle`.
  applyEdgeData(document, edges, addressed, diagnostics);

  // A subgraph is a timeline target on the same terms as a node and an edge:
  // it is a drawn thing with an id, and board 2's rule is that a diagram kind
  // gains animation by tagging what it draws with the ids the timeline uses.
  // A class diagram's namespace has been addressable this way since the class
  // board, and a frame nobody could name would be a decision by omission
  // rather than a feature that was not reached.
  const targetIds = [...nodes.map((n) => n.id), ...edges.map((e) => e.id), ...subgraphs.map((s) => s.id)];
  const validTargetIds = new Set<string>();
  // An id two drawn things answer to — the node `A-B` and the edge
  // `A --> B` — which a timeline cannot name. An edge id the author wrote
  // never lands here: one that clashes is refused above.
  const ambiguousTargetIds = new Set<string>();
  for (const id of targetIds) {
    if (validTargetIds.has(id)) {
      ambiguousTargetIds.add(id);
    }
    validTargetIds.add(id);
  }

  const timelines = resolveTimelineBlocks(
    document,
    validTargetIds,
    { connectors: edges, noun: "edge" },
    diagnostics,
    { ambiguousTargetIds },
  );

  const graph: GraphModel = {
    direction: document.direction,
    nodes,
    edges,
    subgraphs,
    accTitle: document.accTitle,
    accDescr: document.accDescr,
    ...timelines,
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

    // An id the author gave the edge itself (`A e1@--> B`) replaces the
    // derived one, and still counts as a repeat of its pair: Mermaid 12.2.0
    // numbers a pair's edges across all of them, named or not (measured), so
    // naming one edge never renumbers another.
    const baseId = `${edge.from}-${edge.to}`;
    const id = edge.id ?? (occurrence === 1 ? baseId : `${baseId}#${occurrence}`);

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
 * Refuses an id the author gave an edge (`A e1@--> B`) that something else
 * already answers to, at the id: a timeline action or a `data-siren-id`
 * lookup naming it would otherwise reach two things. Measured on Mermaid
 * 12.2.0, such a document is drawn wrong rather than refused — after `A
 * e1@--> B`, a line `e1` draws no node at all.
 */
function reportAuthoredEdgeIdClashes(
  document: FlowchartDocument,
  nodes: readonly GraphNode[],
  subgraphIdByName: ReadonlyMap<string, string>,
  edges: readonly GraphEdge[],
  diagnostics: Diagnostic[],
): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const written = document.edges;
  const indicesById = new Map<string, number[]>();
  edges.forEach(({ id }, index) => {
    const indices = indicesById.get(id);
    if (indices === undefined) {
      indicesById.set(id, [index]);
    } else {
      indices.push(index);
    }
  });
  written.forEach((edge, index) => {
    if (edge.id === undefined) {
      return;
    }
    if (nodeIds.has(edge.id)) {
      diagnostics.push({
        severity: "error",
        message: `The edge id "${edge.id}" is already the id of the node "${edge.id}". Give the edge another id`,
        line: edge.idLine,
        column: edge.idColumn,
      });
      return;
    }
    // A subgraph's name is what an edge endpoint addresses its frame by, so
    // an edge answering to it too would leave `C --> S` meaning two things.
    if (subgraphIdByName.has(edge.id)) {
      diagnostics.push({
        severity: "error",
        message: `The edge id "${edge.id}" is already the name of the subgraph "${edge.id}". Give the edge another id`,
        line: edge.idLine,
        column: edge.idColumn,
      });
      return;
    }
    // The edge that holds the id first: any edge whose id was derived from
    // its ends (`C-D`, `C-D#2`), or one named the same way earlier — so two
    // edges given one id are reported once, at the second.
    const holder = (indicesById.get(edge.id) ?? []).find(
      (at) => at !== index && (written[at]!.id === undefined || at < index),
    );
    if (holder !== undefined) {
      const { from, to } = written[holder]!;
      diagnostics.push({
        severity: "error",
        message:
          `The edge id "${edge.id}" of ${edge.from} --> ${edge.to} is already the id of the edge ${from} --> ${to}. ` +
          "Give the edge another id",
        line: edge.idLine,
        column: edge.idColumn,
      });
    }
  });
}

/**
 * The two tiers a `linkStyle` document has: `default`'s fallback, and the
 * numbered statements that beat it for the edges they name.
 */
type LinkStyleTier = "fallback" | "specific";

/**
 * One value per tier, each made fresh by `make` — the one shape both things
 * a `linkStyle` says (its declarations, its curve) are sorted into, so each
 * caller writes `tiers[tier]` rather than choosing between two variables.
 */
function byTier<T>(make: () => T): Record<LinkStyleTier, T> {
  return { fallback: make(), specific: make() };
}

/**
 * One `linkStyle` statement with its addresses spent: the edge ids it names
 * and the tier it sits on.
 */
interface AddressedLinkStyle {
  linkStyle: LinkStyleDecl;
  tier: LinkStyleTier;
  targetIds: string[];
}

/**
 * Turns every address each `linkStyle` statement wrote into the ids of the
 * edges it names, once, for both things a statement can say about them —
 * its declarations and its curve — so an address that names nothing is
 * reported once however many of the two the statement wrote.
 *
 * **This is where an index stops existing.** Mermaid addresses an edge by
 * its declaration position and everything downstream of the model addresses
 * it by id, so one of the two has to end somewhere; it ends here, in the
 * one function that can see both.
 *
 * It is also where a statement's tier is decided. A statement lands in
 * `fallback` when it names `default` and in `specific` otherwise. A
 * statement naming `default` beside an index is wholly a fallback statement:
 * `default` already covers every edge of that same statement, index
 * included, with those same declarations, so the index changes nothing it
 * says — it only still has to resolve, so that an index naming no edge is
 * diagnosed rather than waved through.
 */
function addressLinkStyles(
  linkStyles: readonly LinkStyleDecl[],
  edges: readonly GraphEdge[],
  diagnostics: Diagnostic[],
): AddressedLinkStyle[] {
  return linkStyles.map((linkStyle) => ({
    linkStyle,
    tier: linkStyle.targets.includes(EVERY_EDGE) ? "fallback" : "specific",
    targetIds: linkStyle.targets.flatMap((target) =>
      resolveAddress(target, edges, linkStyle, diagnostics),
    ),
  }));
}

/**
 * Rewrites each addressed `linkStyle` statement as the `StyleDecl` the
 * shared resolver reads, sorted into the two tiers a `linkStyle` document
 * has.
 *
 * The result is indistinguishable from a `style` statement — same kind,
 * same `targetIds`, same trip through the same gate — which is why no
 * layout, renderer or timeline code has to know that `linkStyle` exists.
 *
 * `authoredAs` stays `linkStyle` because a diagnostic may quote it, and an
 * author who wrote `linkStyle 0` never wrote the word `style`.
 */
function asStyleDeclarations(
  addressed: readonly AddressedLinkStyle[],
): Record<LinkStyleTier, StyleDecl[]> {
  const tiers = byTier<StyleDecl[]>(() => []);

  for (const { linkStyle, tier, targetIds } of addressed) {
    const declaration: StyleDecl = {
      styleKind: "style",
      authoredAs: "linkStyle",
      targetIds,
      name: null,
      properties: linkStyle.properties,
      line: linkStyle.line,
      column: linkStyle.column,
    };
    // Every statement reaches exactly one tier, so the gate inside
    // `resolveStyles` still sees each written declaration once and a
    // refused value is still reported once, at the line that wrote it.
    tiers[tier].push(declaration);
  }

  return tiers;
}

/**
 * The curve each edge a `linkStyle … interpolate` reached is drawn with.
 * Edges absent from the result carry no curve and are drawn on the default.
 *
 * The tiers are the declarations' tiers: an index's curve beats
 * `default`'s for the edge it names whichever is written first, and within
 * a tier the last statement written wins. Mermaid reads it the same way at
 * draw time (`rawEdge.interpolate || edges.defaultInterpolate`), with one
 * quirk not copied: it also stamps the `default` curve current when an edge
 * is *declared* onto that edge, so a second `linkStyle default interpolate`
 * written after the edge does not reach it (measured, 11.17.2). Here a tier
 * is one setting, wherever the edges sit.
 */
function resolveCurves(
  addressed: readonly AddressedLinkStyle[],
  diagnostics: Diagnostic[],
): Map<string, Curve> {
  // `null` is a statement that chose a curve Siren cannot draw: it still
  // takes its tier's place for the edges it names, so the edge falls through
  // to the tier below rather than to an earlier statement of its own tier.
  const tiers = byTier(() => new Map<string, Curve | null>());
  for (const { linkStyle, tier, targetIds } of addressed) {
    const { interpolate, line, column } = linkStyle;
    if (interpolate === undefined) {
      continue;
    }
    const curve = drawableCurve(interpolate, line, column, diagnostics);
    for (const id of targetIds) {
      tiers[tier].set(id, curve);
    }
  }

  const curves = new Map<string, Curve>();
  for (const tier of [tiers.fallback, tiers.specific]) {
    for (const [id, curve] of tier) {
      if (curve !== null) {
        curves.set(id, curve);
      }
    }
  }
  return curves;
}

/**
 * Lays each edge's `e1@{ … }` data onto the edge it was written for, which
 * `assignEdgeIds` built in the same order.
 *
 * The animation is Mermaid 12.2.0's reading: `animation` names the speed
 * whatever `animate` says, and `animate` alone, tested for truth, is
 * `fast`. The curve is the one a `linkStyle N interpolate` written later
 * does not take back: Mermaid sets an edge's one curve as each is read, so
 * the later of the two wins, and either beats `linkStyle default`.
 */
function applyEdgeData(
  document: FlowchartDocument,
  edges: readonly GraphEdge[],
  addressed: readonly AddressedLinkStyle[],
  diagnostics: Diagnostic[],
): void {
  // Where the last `linkStyle N interpolate` naming each edge was written.
  const interpolatedAt = new Map<string, number>();
  for (const { linkStyle, tier, targetIds } of addressed) {
    if (tier === "specific" && linkStyle.interpolate !== undefined) {
      for (const id of targetIds) {
        interpolatedAt.set(id, linkStyle.line ?? 0);
      }
    }
  }
  document.edges.forEach(({ data }, index) => {
    if (data === undefined) {
      return;
    }
    const edge = edges[index]!;
    const animation = data.animation ?? (data.animate === true ? "fast" : undefined);
    if (animation !== undefined) {
      edge.animation = animation;
      // The march's dash beats an author's (Mermaid writes it
      // `!important`, measured), so none is handed on to be drawn.
      edge.style = {
        ...edge.style,
        frame: edge.style.frame.filter(({ property }) => property !== "stroke-dasharray"),
      };
    }
    if (data.curve === undefined) {
      return;
    }
    if (isMermaidOnlyCurve(data.curve) || !isCurve(data.curve)) {
      diagnostics.push({
        severity: "error",
        message: isMermaidOnlyCurve(data.curve)
          ? `The curve "${data.curve}" is one Siren does not draw yet. ${CURVES_SIREN_DRAWS}`
          : `There is no curve "${data.curve}". ${CURVES_SIREN_DRAWS}`,
        line: data.line,
        column: data.column,
      });
      return;
    }
    if ((interpolatedAt.get(edge.id) ?? -1) < data.line) {
      edge.curve = data.curve;
    }
  });
}

/** The fix both curve diagnostics end on: the names an `interpolate` can take. */
const CURVES_SIREN_DRAWS = `Curves: ${CURVES.join(", ")}.`;

/**
 * The curve an `interpolate` clause's name draws, diagnosing the two names
 * that are not one of Siren's `CURVES` differently:
 *
 * - a curve Mermaid draws and Siren does not is an **error** and `null` —
 *   the author asked for a picture this renderer cannot give them, so the
 *   edge keeps its fallback rather than pretending;
 * - a name Mermaid does not know either is a **warning** and `rounded` —
 *   that is the picture Mermaid draws for it, so Siren can match it and
 *   only needs to say the name was not a curve.
 */
function drawableCurve(
  name: string,
  line: number | undefined,
  column: number | undefined,
  diagnostics: Diagnostic[],
): Curve | null {
  if (isMermaidOnlyCurve(name)) {
    diagnostics.push({
      severity: "error",
      message: `linkStyle interpolate "${name}" is a curve Siren does not draw yet; the edges it addresses keep their fallback curve. ${CURVES_SIREN_DRAWS}`,
      line,
      column,
    });
    return null;
  }
  if (!isCurve(name)) {
    // Mermaid 12.2.0 draws every flowchart edge its default ELK layout
    // routed as `rounded`, whatever was written (`applyElkEdgeLayout`; and
    // measured in headless Chrome — `linkStyle 1 interpolate wobbly` draws
    // that edge with `Q` corners), and the edge still leaves the tier below —
    // so this is a picture Siren *can* match, and only a warning.
    diagnostics.push({
      severity: "warning",
      message: `linkStyle interpolate "${name}" names no curve; drawing ${FLOWCHART_DEFAULT_CURVE}. ${CURVES_SIREN_DRAWS}`,
      line,
      column,
    });
    return FLOWCHART_DEFAULT_CURVE;
  }
  return name;
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

/**
 * The flowchart's styling statements with one more in front: `default`
 * applied to every node, when the document defines a `classDef default`.
 *
 * Mermaid creates every vertex already wearing a class called `default`, so
 * `classDef default fill:#abc` paints each node with no statement applying
 * it — and paints it under everything else (measured on 12.2.0, 01M39F94W):
 * a node that also wears `urgent` takes `urgent`'s fill and keeps
 * `default`'s stroke, a `style` beats it, the definition may follow the
 * nodes, and a subgraph's frame is not painted. Put first, the implicit
 * application is the earliest statement of the class tier `resolveStyles`
 * applies before `style`s, which is exactly that lowest place — so the
 * shared resolver needs no idea of an implicit class. Only flowcharts: a
 * class diagram paints nothing for it, a state diagram refuses it, and an
 * ER diagram refuses it by name.
 *
 * Nothing is added without the definition, so a document that never says
 * `default` draws exactly as before and is warned about nothing.
 */
function withImplicitDefaultClass(styles: readonly StyleDecl[], nodeIds: string[]): readonly StyleDecl[] {
  const definition = styles.find((style) => style.styleKind === "classDef" && style.name === "default");
  if (definition === undefined) return styles;
  return [
    {
      styleKind: "apply",
      authoredAs: "class",
      targetIds: nodeIds,
      name: "default",
      properties: [],
      line: definition.line,
      column: definition.column,
    },
    ...styles,
  ];
}
