import type {
  ClassDecl,
  ClassDocument,
  ClassModel,
  ClassModelResult,
  Diagnostic,
  ResolvedClass,
  ResolvedClassRelationship,
  ResolvedTimeline,
  ResolvedTimelineEntry,
} from "../contracts";

/**
 * Resolves a parsed `ClassDocument` into a validated `ClassModel`: repeat
 * declarations of one class merged into a single class, relationship ids
 * assigned, and the `timeline:` block resolved against both sets of ids.
 *
 * The division of labour with the parser is the point of this stage. The
 * parser *declares* — it emits a separate `ClassDecl` for every mention of a
 * class, implicit (named by a relationship) or explicit, just as
 * `parseFlowchart` declares a node named only by an edge. This stage
 * *reconciles* those declarations into one class per id. Nothing here
 * reinterprets what the author wrote: members, relationship types, labels
 * and multiplicity pass through verbatim.
 *
 * Problems come back as diagnostics rather than exceptions, and never sink
 * the whole model: a timeline entry naming an id that does not exist is
 * dropped on its own, and everything else still resolves — the same
 * partial-failure tolerance `buildFlowchartModel` and `buildSequenceModel`
 * apply.
 */
export function buildClassModel(document: ClassDocument): ClassModelResult {
  const diagnostics: Diagnostic[] = [];

  const classes = resolveClasses(document, diagnostics);

  const relationships = assignRelationshipIds(document);

  const model: ClassModel = {
    direction: document.direction,
    classes,
    relationships,
    // Namespaces, notes, interactions and styles resolve in later tickets on
    // this board (a class's `namespaceId` is left null here for the same
    // reason). No document can currently carry them: the parser does not yet
    // recognize any of the statements that produce them.
    namespaces: [],
    notes: [],
    interactions: [],
    styles: [],
    timeline: resolveTimeline(
      document,
      new Set([...classes.map((c) => c.id), ...relationships.map((r) => r.id)]),
      diagnostics,
    ),
  };

  return { model, diagnostics };
}

/**
 * Folds the document's declarations into one class per id.
 *
 * The parser emits a separate `ClassDecl` for every mention of a class —
 * implicit (named by a relationship) or explicit (`class X`, `class X { ...
 * }`, `X : member`) — so a class written about on four lines arrives here
 * four times. Reconciling those is this stage's work: a class keeps the
 * position of its first mention, and its members are the union of every
 * declaration's, in declaration order.
 */
function resolveClasses(document: ClassDocument, diagnostics: Diagnostic[]): ResolvedClass[] {
  const classesById = new Map<string, ResolvedClass>();

  for (const declaration of document.classes) {
    const existing = classesById.get(declaration.id);
    if (existing === undefined) {
      classesById.set(declaration.id, {
        id: declaration.id,
        generic: declaration.generic,
        annotation: declaration.annotation,
        members: [...declaration.members],
        namespaceId: null,
      });
      continue;
    }

    existing.members.push(...declaration.members);

    // An annotation and a generic are single-valued, so they cannot be
    // unioned the way members are: the first declaration that names one
    // wins. First-*named*, not first-declared — the implicit declaration a
    // relationship makes carries neither, and it is usually the one that
    // introduced the class, so taking its nulls would discard whatever the
    // explicit declaration said.
    existing.annotation = mergeAttribute(
      existing.annotation,
      declaration.annotation,
      "annotations",
      "annotation",
      declaration,
      diagnostics,
    );
    existing.generic = mergeAttribute(
      existing.generic,
      declaration.generic,
      "generics",
      "generic",
      declaration,
      diagnostics,
    );
  }

  // Defensive: an endpoint no declaration covers still gets a class, so a
  // relationship never points at nothing. The parser declares every class a
  // relationship names — the way `parseFlowchart` declares a node named
  // only by an edge — so this is unreachable for parsed documents; it
  // exists for hand-built ones and for future callers, and it is not where
  // implicit declaration lives.
  for (const relationship of document.relationships) {
    for (const endpointId of [relationship.from, relationship.to]) {
      if (classesById.has(endpointId)) continue;
      classesById.set(endpointId, {
        id: endpointId,
        generic: null,
        annotation: null,
        members: [],
        namespaceId: null,
      });
    }
  }

  return [...classesById.values()];
}

/**
 * Resolves the `timeline:` block against the ids this model just assigned —
 * class ids and relationship ids share one namespace, exactly as flowchart
 * node and edge ids do, so an author addresses either kind of element the
 * same way. An entry naming an id that exists in neither is dropped with an
 * error diagnostic, leaving the rest of the timeline and the model intact.
 *
 * Only reference resolution, deliberately: the further ordering rules
 * `buildFlowchartModel` applies — deduping repeat `enter`/`exit` actions and
 * rejecting an action that fires before its target is visible — are not part
 * of this ticket, and belong with the ticket that animates class diagrams.
 */
function resolveTimeline(
  document: ClassDocument,
  validTargetIds: Set<string>,
  diagnostics: Diagnostic[],
): ResolvedTimeline {
  const entries: ResolvedTimelineEntry[] = [];
  let totalSteps = 0;

  if (document.timeline === null) {
    return { totalSteps, entries };
  }

  for (const entry of document.timeline.entries) {
    if (!validTargetIds.has(entry.targetId)) {
      diagnostics.push({
        severity: "error",
        message: `timeline: references unknown id "${entry.targetId}"`,
        line: entry.line,
        column: entry.column,
      });
      continue;
    }

    entries.push({
      kind: entry.kind,
      step: entry.step,
      targetId: entry.targetId,
      effect: entry.effect,
    });

    if (entry.step > totalSteps) {
      totalSteps = entry.step;
    }
  }

  return { totalSteps, entries };
}

/**
 * Gives every relationship the id the timeline and the renderer address it
 * by. Everything else about the relationship — its line style, its two
 * endpoint markers, its label and its multiplicity strings — passes through
 * exactly as written: this stage validates and identifies, it does not
 * reinterpret.
 */
function assignRelationshipIds(document: ClassDocument): ResolvedClassRelationship[] {
  // `${from}-${to}`, then `#2`, `#3`, ... for repeats of the same ordered
  // pair — the flowchart edge-id convention exactly, so one timeline
  // vocabulary addresses both diagram kinds.
  const seenPairCounts = new Map<string, number>();

  return document.relationships.map((relationship) => {
    const pairKey = `${relationship.from}->${relationship.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);
    const baseId = `${relationship.from}-${relationship.to}`;

    return {
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      from: relationship.from,
      to: relationship.to,
      line: relationship.line,
      fromEnd: relationship.fromEnd,
      toEnd: relationship.toEnd,
      label: relationship.label,
      fromMultiplicity: relationship.fromMultiplicity,
      toMultiplicity: relationship.toMultiplicity,
    };
  });
}

/**
 * Merges one single-valued class attribute across two declarations of the
 * same class: the first non-null value wins, and two different non-null
 * values are a warning rather than an error — both declarations are
 * perfectly well-formed on their own, and the diagram still renders with
 * the first. Mirrors `buildFlowchartModel`'s conflicting-node-label rule.
 */
function mergeAttribute(
  kept: string | null,
  incoming: string | null,
  plural: string,
  singular: string,
  declaration: ClassDecl,
  diagnostics: Diagnostic[],
): string | null {
  if (incoming === null) return kept;
  if (kept === null) return incoming;
  if (kept === incoming) return kept;

  diagnostics.push({
    severity: "warning",
    message:
      `Class "${declaration.id}" is declared with conflicting ${plural} ` +
      `("${kept}" vs. "${incoming}"); keeping the first-seen ${singular}.`,
    line: declaration.line,
    column: declaration.column,
  });
  return kept;
}
