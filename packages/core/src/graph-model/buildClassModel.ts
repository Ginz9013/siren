import type {
  ClassDecl,
  ClassDocument,
  ClassMember,
  ClassModel,
  ClassModelResult,
  Diagnostic,
  ResolvedClass,
  ResolvedClassNamespace,
  ResolvedClassNote,
  ResolvedClassRelationship,
  ResolvedTimeline,
  ResolvedTimelineEntry,
} from "../contracts";

/**
 * Resolves a parsed `ClassDocument` into a validated `ClassModel`: repeat
 * declarations of one class merged into a single class, relationship,
 * namespace and note ids assigned, namespace membership and note attachment
 * resolved, and the `timeline:` block resolved against every one of those
 * ids.
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

  const classesById = resolveClasses(document, diagnostics);

  const namespaces = resolveNamespaces(document, classesById, diagnostics);

  const notes = resolveNotes(document, classesById, diagnostics);

  const classes = [...classesById.values()].map((accumulator) => accumulator.resolved);

  const relationships = assignRelationshipIds(document);

  const model: ClassModel = {
    direction: document.direction,
    classes,
    relationships,
    namespaces,
    notes,
    // Parsed but not yet resolved. The parser captures `click`/`callback`/
    // `link` and `style`/`classDef`/`cssClass` as structured declarations
    // and deliberately does not judge them — this stage owns the `http`/
    // `https`/`mailto` URL allowlist and the `url(`/`expression(` rejection
    // list. Until that lands, every such declaration is dropped here
    // without a diagnostic, so a document using them renders as though it
    // had not. Nothing downstream draws them yet either, which is the only
    // reason silence is tolerable rather than a bug.
    interactions: [],
    styles: [],
    timeline: resolveTimeline(
      document,
      new Set([
        ...classes.map((c) => c.id),
        ...relationships.map((r) => r.id),
        ...namespaces.map((n) => n.id),
        ...notes.map((n) => n.id),
      ]),
      diagnostics,
    ),
  };

  return { model, diagnostics };
}

/**
 * One class under construction, plus the set of member line texts it has
 * already taken — the bookkeeping the union in `addMembers` needs, kept
 * beside the class rather than inside it because it is not part of the
 * model this stage returns.
 */
interface ClassAccumulator {
  resolved: ResolvedClass;
  memberKeys: Set<string>;
}

function emptyClass(id: string): ClassAccumulator {
  return {
    resolved: { id, generic: null, annotation: null, members: [], namespaceId: null },
    memberKeys: new Set<string>(),
  };
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
function resolveClasses(
  document: ClassDocument,
  diagnostics: Diagnostic[],
): Map<string, ClassAccumulator> {
  const classesById = new Map<string, ClassAccumulator>();

  for (const declaration of document.classes) {
    const existing = classesById.get(declaration.id);
    if (existing === undefined) {
      const created = emptyClass(declaration.id);
      created.resolved.generic = declaration.generic;
      created.resolved.annotation = declaration.annotation;
      classesById.set(declaration.id, created);
      addMembers(created, declaration.members);
      continue;
    }

    addMembers(existing, declaration.members);

    // An annotation and a generic are single-valued, so they cannot be
    // unioned the way members are: the first declaration that names one
    // wins. First-*named*, not first-declared — the implicit declaration a
    // relationship makes carries neither, and it is usually the one that
    // introduced the class, so taking its nulls would discard whatever the
    // explicit declaration said.
    existing.resolved.annotation = mergeAttribute(
      existing.resolved.annotation,
      declaration.annotation,
      "annotations",
      "annotation",
      declaration,
      diagnostics,
    );
    existing.resolved.generic = mergeAttribute(
      existing.resolved.generic,
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
      classesById.set(endpointId, emptyClass(endpointId));
    }
  }

  return classesById;
}

/**
 * Resolves the document's `namespace` blocks: each gets the stable
 * `namespace-${n}` id the timeline and the renderer address it by — a
 * 1-based counter in document order, the same convention
 * `buildSequenceModel` gives its blocks — while the name the author wrote
 * becomes the frame's `label`.
 *
 * Membership is recorded on both sides, so the renderer can walk from
 * either: the namespace lists its class ids, and each member class carries
 * its `namespaceId`. The two never disagree — a class a second namespace
 * tried to claim is left out of that namespace's list as well as keeping
 * its first `namespaceId`.
 *
 * A class belongs to at most one namespace, because a namespace is drawn as
 * a frame enclosing its members and one box cannot sit inside two frames.
 * The first claim wins and the second is an error: unlike a conflicting
 * annotation, there is no reading of the source under which both are
 * satisfiable.
 */
function resolveNamespaces(
  document: ClassDocument,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): ResolvedClassNamespace[] {
  /** The namespace that claimed each class first, by its author-written name. */
  const claimedBy = new Map<string, string>();

  return document.namespaces.map((namespace, index) => {
    const id = `namespace-${index + 1}`;
    const classIds: string[] = [];

    for (const classId of namespace.classIds) {
      const claimant = claimedBy.get(classId);
      if (claimant !== undefined) {
        diagnostics.push({
          severity: "error",
          message:
            `Class "${classId}" is named by more than one namespace ` +
            `("${claimant}" and "${namespace.id}"); keeping the first.`,
          line: namespace.line,
          column: namespace.column,
        });
        continue;
      }

      // A namespace naming a class nothing else declares creates it, the
      // same way a relationship endpoint does: naming a class is a way of
      // introducing one, and a frame with a hole where a member should be
      // helps nobody.
      let member = classesById.get(classId);
      if (member === undefined) {
        member = emptyClass(classId);
        classesById.set(classId, member);
      }
      member.resolved.namespaceId = id;
      claimedBy.set(classId, namespace.id);
      classIds.push(classId);
    }

    return { id, label: namespace.id, classIds };
  });
}

/**
 * Adds one declaration's members to a class as a **union**: a member whose
 * rendered line text the class already carries is dropped, so `Animal :
 * +int age` written on two lines yields one line, not two. The first copy
 * is the one kept, along with its source position.
 *
 * The identity of a member is the text it is drawn as — `+int age`,
 * `+swim() bool` — because that is exactly what a reader sees repeated.
 * Two members differing in visibility, type, parameters, return type or
 * classifier draw differently and are therefore different members, even
 * when they share a name; Mermaid lets a class carry both, and so does
 * this.
 */
function addMembers(target: ClassAccumulator, members: ClassMember[]): void {
  for (const member of members) {
    const key = memberLineText(member);
    if (target.memberKeys.has(key)) continue;
    target.memberKeys.add(key);
    target.resolved.members.push(member);
  }
}

/**
 * The text a member is drawn as, rebuilt from the parts the parser kept —
 * the union key above. Deliberately duplicated from the layout stage's own
 * copy rather than shared: the model must not depend on layout (the
 * dependency runs the other way), and this stage needs the rule before any
 * measuring exists. If the two ever disagree, the layout's spelling is the
 * one the reader sees, and this one should follow it.
 */
function memberLineText(member: ClassMember): string {
  const visibility = member.visibility ?? "";
  const classifier = member.classifier ?? "";
  if (member.memberKind === "method") {
    const returnType = member.returnType === null ? "" : ` ${member.returnType}`;
    return `${visibility}${member.name}(${member.parameters ?? ""})${returnType}${classifier}`;
  }
  const type = member.type === null ? "" : `${member.type} `;
  return `${visibility}${type}${member.name}${classifier}`;
}

/**
 * Resolves the document's `note` statements: each gets the stable
 * `note-${n}` id the timeline and the renderer address it by, and an
 * attached note's target is looked up among the classes.
 *
 * Naming a class in a `note for X` does not declare it — unlike a
 * relationship endpoint or a namespace member, where the name *is* the way
 * the class enters the diagram. A note is about something that already
 * exists, so an unknown target is a typo: the note is dropped with an error
 * and the rest of the model still resolves.
 *
 * The id comes from the note's position in the source rather than from its
 * position among the survivors, so dropping one note never renumbers the
 * ones written after it — a timeline referring to `note-3` keeps referring
 * to the same note whether or not the second one resolved.
 */
function resolveNotes(
  document: ClassDocument,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): ResolvedClassNote[] {
  const notes: ResolvedClassNote[] = [];

  document.notes.forEach((note, index) => {
    if (note.targetId !== null && !classesById.has(note.targetId)) {
      diagnostics.push({
        severity: "error",
        message: `note for "${note.targetId}" references a class that does not exist; dropping the note.`,
        line: note.line,
        column: note.column,
      });
      return;
    }

    notes.push({ id: `note-${index + 1}`, text: note.text, targetId: note.targetId });
  });

  return notes;
}

/**
 * Resolves the `timeline:` block against the ids this model just assigned —
 * classes, relationships, namespaces and notes share one id space, extending
 * the way flowchart node and edge ids do, so an author animates any element
 * of the diagram the same way. An entry naming an id none of them holds is
 * dropped with an error diagnostic, leaving the rest of the timeline and the
 * model intact.
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
