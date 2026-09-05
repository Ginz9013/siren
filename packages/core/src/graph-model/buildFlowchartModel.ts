import type {
  Diagnostic,
  FlowchartDocument,
  GraphEdge,
  GraphModel,
  GraphNode,
  LinkStyleDecl,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { resolveStyles } from "./resolveStyles";
import { resolveTimeline, warnOnConnectorsOutlivingTheirEndpoints } from "./resolveTimeline";

/**
 * Resolves a parsed `FlowchartDocument` into a validated `GraphModel`:
 * assigns stable edge ids, dedupes nodes (first-label-wins), and resolves
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

  const nodes = resolveNodes(document, diagnostics);
  const edges = assignEdgeIds(document);

  // Every styling statement a flowchart can write except one — `style`,
  // `classDef`, and the apply-directive in both its `class` and its `:::`
  // spelling — names a node. `linkStyle` is the exception, and it is
  // resolved separately below.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const { targetId, properties } of resolveStyles(
    document.styles,
    new Set(nodeById.keys()),
    diagnostics,
  )) {
    // Every id `resolveStyles` returns is one it was handed, so this cannot
    // miss; a node nothing styled keeps the empty list it was built with.
    nodeById.get(targetId)!.style = properties;
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
  for (const { targetId, properties } of resolveStyles(fallback, edgeIds, diagnostics)) {
    edgeById.get(targetId)!.style = properties;
  }
  for (const { targetId, properties } of resolveStyles(specific, edgeIds, diagnostics)) {
    const edge = edgeById.get(targetId)!;
    edge.style = overriding(edge.style, properties);
  }

  const validTargetIds = new Set<string>([
    ...nodes.map((n) => n.id),
    ...edges.map((e) => e.id),
  ]);

  const { entries, totalSteps } = resolveTimeline(document.timeline, validTargetIds, diagnostics);

  warnOnConnectorsOutlivingTheirEndpoints(entries, edges, "edge", diagnostics);

  const graph: GraphModel = {
    direction: document.direction,
    nodes,
    edges,
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
function overriding(
  fallback: readonly StyleProperty[],
  specific: readonly StyleProperty[],
): StyleProperty[] {
  const merged = new Map(fallback.map(({ property, value }) => [property, value]));
  for (const { property, value } of specific) {
    merged.set(property, value);
  }
  return [...merged].map(([property, value]) => ({ property, value }));
}

function resolveNodes(document: FlowchartDocument, diagnostics: Diagnostic[]): GraphNode[] {
  const nodesById = new Map<string, GraphNode>();

  for (const node of document.nodes) {
    const existing = nodesById.get(node.id);
    if (existing === undefined) {
      nodesById.set(node.id, { id: node.id, label: node.label, style: [] });
      continue;
    }
    if (existing.label !== node.label) {
      diagnostics.push({
        severity: "warning",
        message: `Node "${node.id}" is declared with conflicting labels ("${existing.label}" vs. "${node.label}"); keeping the first-seen label.`,
        line: node.line,
        column: node.column,
      });
    }
  }

  return [...nodesById.values()];
}

function assignEdgeIds(document: FlowchartDocument): GraphEdge[] {
  const seenPairCounts = new Map<string, number>();

  return document.edges.map((edge) => {
    const pairKey = `${edge.from}->${edge.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);

    const baseId = `${edge.from}-${edge.to}`;
    const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;

    return { id, from: edge.from, to: edge.to, style: [] };
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
