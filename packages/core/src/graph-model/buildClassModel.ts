import type {
  ClassDecl,
  ClassDocument,
  ClassMember,
  ClassModel,
  ClassModelResult,
  ClassNamespace,
  ClassNote,
  Diagnostic,
  ResolvedClass,
  ResolvedClassNamespace,
  ResolvedClassNote,
  ResolvedClassRelationship,
} from "../contracts";
import { plainLabel } from "../label/label";
import { generatedId } from "./generatedId";
import { NOTHING_OMITTED, writeAuthorStyles } from "./omitAuthorStyles";
import { resolveInteractions } from "./resolveInteractions";
import { asStyleFact, resolveStyleFacts } from "./resolveStyles";
import { resolveTimelineBlocks } from "./resolveTimeline";

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
 * The exception is author interaction and styling, where this stage
 * *judges* rather than reconciles, because it is the only stage that can.
 * A `click X href "..."` URL and a `style X fill:...` value are two sinks
 * for text the author controls: the parser records both verbatim by design,
 * and the renderer puts whatever survives into a live `href` and a live
 * `style` attribute. So the `http`/`https`/`mailto` allowlist in
 * `rejectUrl` and the rejection list `resolveStyles` applies are this
 * board's security boundary — if they admit something, nothing downstream
 * catches it. Both refuse rather than sanitize, and say so in a diagnostic.
 * The styling half of that boundary now lives in `resolveStyles`, shared
 * with every other diagram kind, rather than privately here.
 *
 * Problems come back as diagnostics rather than exceptions, and never sink
 * the whole model: a timeline entry naming an id that does not exist is
 * dropped on its own, a rejected URL costs its class a link and not its
 * box, and everything else still resolves — the same partial-failure
 * tolerance `buildFlowchartModel` and `buildSequenceModel` apply.
 */
export function buildClassModel(
  document: ClassDocument,
  omitted: ReadonlySet<string> = NOTHING_OMITTED,
): ClassModelResult {
  const diagnostics: Diagnostic[] = [];

  const classesById = resolveClasses(document, diagnostics);

  const notes = resolveNotes(document, classesById, diagnostics);

  const namespaces = resolveNamespaces(document, classesById, diagnostics);

  const classes = [...classesById.values()].map((accumulator) => accumulator.resolved);

  const relationships = assignRelationshipIds(document);

  const interactions = resolveInteractions(
    document.interactions,
    new Set(classesById.keys()),
    diagnostics,
  );

  const resolvedStyles = resolveStyleFacts(document.styles, new Set(classesById.keys()), diagnostics);
  writeAuthorStyles(resolvedStyles, (id) => classesById.get(id)?.resolved, omitted);

  // Classes, relationships, namespaces and notes share one id space, the way
  // flowchart node and edge ids do, so an author animates any element of the
  // diagram the same way — and the shared resolver never has to learn which
  // kind of element an id belongs to.
  const timelines = resolveTimelineBlocks(
    document,
    new Set([
      ...classes.map((c) => c.id),
      ...relationships.map((r) => r.id),
      ...namespaces.map((n) => n.id),
      ...notes.map((n) => n.id),
    ]),
    { connectors: relationships, noun: "relationship" },
    diagnostics,
  );

  const model: ClassModel = {
    accTitle: document.accTitle,
    accDescr: document.accDescr,
    direction: document.direction,
    classes,
    relationships,
    namespaces,
    notes,
    interactions,
    styleFacts: resolvedStyles.map((resolved) => asStyleFact(resolved, "class")),
    ...timelines,
  };

  return { model, diagnostics };
}

/**
 * One class under construction, plus the bookkeeping kept beside it
 * rather than inside it because it is not part of the model this stage
 * returns.
 */
interface ClassAccumulator {
  resolved: ResolvedClass;
  /** The line the class was first named on, when the declaration says. */
  firstLine?: number;
  /** The line its kept annotation was written on, when the declaration says. */
  annotationLine?: number;
}

function emptyClass(id: string, firstLine?: number): ClassAccumulator {
  return {
    resolved: { id, generic: null, annotation: null, label: null, members: [], namespaceId: null },
    firstLine,
  };
}

/**
 * ` on line N` for an error to say where something was written, or nothing
 * when the declaration that wrote it carried no position.
 */
function onLine(line: number | undefined): string {
  return line === undefined ? "" : ` on line ${line}`;
}

/**
 * The error for a declaration annotating a class differently from the
 * annotation it already keeps, or `null` when it writes none or the same.
 * Measured on Mermaid 12.2.0 (Chrome): `<<interface>> A` then `<<service>>
 * A`, or both in one block, draws only «interface», the second gone with
 * no diagnostic — a picture other than the one written (ADR-0001).
 */
function annotationAfterFirst(declaration: ClassDecl, existing: ClassAccumulator): Diagnostic | null {
  const kept = existing.resolved.annotation;
  if (declaration.annotation === null || kept === null || declaration.annotation === kept) return null;
  return {
    severity: "error",
    message:
      `Class "${declaration.id}" is annotated «${declaration.annotation}» here, but it was first annotated ` +
      `«${kept}»${onLine(existing.annotationLine)}, and a class keeps its first annotation. ` +
      `Give "${declaration.id}" one annotation.`,
    line: declaration.line,
    column: declaration.column,
  };
}

/**
 * A generic as an error quotes it: each line break the parser kept as `\n`
 * written back as the `<br>` the author wrote for it.
 */
function asWritten(generic: string): string {
  return generic.replaceAll("\n", "<br>");
}

/**
 * The error for a declaration giving a class a generic other than the one
 * its first naming gave it — none, or a different one — or `null` when it
 * gives none or the same. A class keeps what its first naming gave it:
 * measured on Mermaid 12.2.0 (Chrome), `class A` then `class A~T~`, `A -->
 * C` then `class A~T~` and `class A` then `A~T~ --> B` draw `A`; `class
 * A~T~` then `class A~U~`, `A~U~ --> B` or `A~U~ : +x`, and `A~T~ --> B`
 * then `class A~U~`, draw `A<T>` — the later generic gone with no
 * diagnostic, a picture other than the one written (ADR-0001). The one
 * home of that rule: a note's target generic is held to the generic it
 * keeps (`noteTargetGenericError`).
 */
function genericAfterFirstNaming(declaration: ClassDecl, existing: ClassAccumulator): Diagnostic | null {
  if (declaration.generic === null || declaration.generic === existing.resolved.generic) return null;
  const given = asWritten(declaration.generic);
  const kept = existing.resolved.generic === null ? null : asWritten(existing.resolved.generic);
  const where = onLine(existing.firstLine);
  const id = declaration.id;
  return {
    severity: "error",
    message:
      kept === null
        ? `Class "${id}" gets the generic "${given}" here, but it was first named${where} without one, ` +
          `and a class keeps what its first naming gave it. Write "~${given}~" where "${id}" is first named.`
        : `Class "${id}" gets the generic "${given}" here, but it was first named${where} with "${kept}", ` +
          `and a class keeps what its first naming gave it. Give "${id}" one generic, where it is first named.`,
    line: declaration.line,
    column: declaration.column,
  };
}

/**
 * Folds the document's declarations into one class per id.
 *
 * The parser emits a separate `ClassDecl` for every mention of a class —
 * implicit (named by a relationship) or explicit (`class X`, `class X { ...
 * }`, `X : member`) — so a class written about on four lines arrives here
 * four times. Reconciling those is this stage's work: a class keeps the
 * position of its first mention, and its members are every declaration's,
 * in declaration order, repeats included.
 */
function resolveClasses(
  document: ClassDocument,
  diagnostics: Diagnostic[],
): Map<string, ClassAccumulator> {
  const classesById = new Map<string, ClassAccumulator>();

  for (const declaration of document.classes) {
    const existing = classesById.get(declaration.id);
    if (existing === undefined) {
      const created = emptyClass(declaration.id, declaration.line);
      created.resolved.generic = declaration.generic;
      created.resolved.annotation = declaration.annotation;
      if (declaration.annotation !== null) created.annotationLine = declaration.line;
      created.resolved.label = declaration.label;
      classesById.set(declaration.id, created);
      addMembers(created, declaration.members);
      continue;
    }

    addMembers(existing, declaration.members);

    // An annotation and a generic are single-valued, so they cannot be
    // gathered the way members are: the first one written is kept, as
    // Mermaid 12.2.0 keeps it, dropping any other with no diagnostic
    // (measured, Chrome: `<<interface>> A` then `<<service>> A`, or both in
    // one block, draws only «interface») — a picture other than the one
    // written, so a different second one is refused (ADR-0001). An
    // annotation is first-*named*, not first-declared: the implicit
    // declaration a relationship makes carries none, and Mermaid takes a
    // later one then. A generic is first-declared (below).
    if (existing.resolved.annotation === null) {
      existing.resolved.annotation = declaration.annotation;
      if (declaration.annotation !== null) existing.annotationLine = declaration.line;
    } else {
      const conflict = annotationAfterFirst(declaration, existing);
      if (conflict !== null) diagnostics.push(conflict);
    }
    // A generic is kept from the class's first naming, even when that gave
    // none (`genericAfterFirstNaming`), and any other is refused.
    const refused = genericAfterFirstNaming(declaration, existing);
    if (refused !== null) diagnostics.push(refused);
    // A label is single-valued too, but Mermaid does not merge it the way
    // it merges those two: the *last* label written is the one drawn, with
    // no diagnostic (measured, 11.17.2: `class A["x"]` then `class A["y"]`
    // draws "y", while `class A~T~` then `class A~U~` keeps `T` and two
    // annotations draw only the first). So a later label replaces an
    // earlier one silently — what `buildFlowchartModel` does for a node
    // written with two — and a declaration that writes none leaves it alone.
    if (declaration.label !== null) {
      existing.resolved.label = declaration.label;
    }
  }

  // Defensive: an endpoint no declaration covers still gets a class, so a
  // relationship never points at nothing. The parser declares every class a
  // relationship names — the way `parseFlowchart` declares a node named
  // only by an edge — so this is unreachable for parsed documents; it
  // exists for hand-built ones and for future callers, and it is not where
  // implicit declaration lives.
  for (const relationship of document.relationships) {
    // A `()` end never became a class in the first place — see
    // `assignRelationshipIds` — so this fallback must not invent one for it.
    const endpoints: string[] = [];
    if (relationship.fromEnd !== "circle") endpoints.push(relationship.from);
    if (relationship.toEnd !== "circle") endpoints.push(relationship.to);
    for (const endpointId of endpoints) {
      if (classesById.has(endpointId)) continue;
      classesById.set(endpointId, emptyClass(endpointId));
    }
  }

  return classesById;
}

/**
 * Resolves the document's `namespace` blocks into one namespace per
 * qualified name: a namespace opened again — `namespace N { class X }` and
 * later `namespace N { class Y }` — is the same namespace, merged into one
 * frame holding every block's classes, as Mermaid 12.2.0 draws it
 * (measured; nook decision `01M51B4M3C`).
 *
 * Each gets the stable `namespace:${n}` id the timeline and the renderer
 * address it by — a 1-based counter in the order the namespaces are first
 * opened, which the parser makes document order, so an outer namespace is
 * numbered before the ones inside it, as `buildFlowchartModel` numbers
 * `subgraph:N` — while the last label the author wrote in brackets, or else
 * its own `name` (not the qualified one), becomes the frame's `label`. A nested
 * one carries the generated id of the namespace around it as its
 * `parentId`.
 *
 * The `:` separator is load-bearing, not decoration: see `generatedId`.
 *
 * Membership is recorded on both sides, so the renderer can walk from
 * either: the namespace lists its class ids, and each member class carries
 * its `namespaceId`. The two never disagree — a class a second namespace
 * tried to claim is left out of that namespace's list as well as keeping
 * its first `namespaceId`.
 *
 * A class belongs to at most one namespace, because a namespace is drawn as
 * a frame enclosing its members and one box cannot sit inside two frames.
 * The first claim wins and a claim by a *different* namespace is an error:
 * unlike a conflicting annotation, there is no reading of the source under
 * which both are satisfiable. Two blocks of one namespace naming a class are
 * one claim.
 */
function resolveNamespaces(
  document: ClassDocument,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): ResolvedClassNamespace[] {
  /** The namespace that claimed each class first, by its qualified name. */
  const claimedBy = new Map<string, string>();
  /**
   * Each namespace, by its qualified name, in the order first opened. A
   * parent is listed before its children, so it is always here by the time
   * a child looks it up.
   */
  const byQualifiedName = new Map<string, ResolvedClassNamespace>();

  for (const block of document.namespaces) {
    let namespace = byQualifiedName.get(block.id);
    if (namespace === undefined) {
      namespace = {
        id: generatedId("namespace", byQualifiedName.size + 1),
        parentId: block.parentId === null ? null : (byQualifiedName.get(block.parentId)?.id ?? null),
        // A name is an identifier and has no tag in it to read, so a
        // namespace written without a label is labelled by its own name as
        // one plain run — `M` inside N, not the qualified `N.M`.
        label: block.label ?? plainLabel(block.name),
        classIds: [],
        noteIds: [],
      };
      byQualifiedName.set(block.id, namespace);
    } else if (block.label !== null) {
      // Measured: the last bracketed label written wins, and a block that
      // writes none keeps the one before it.
      namespace.label = block.label;
    }

    claimMembers(block, namespace, claimedBy, classesById, diagnostics);
    // A note's id is its place among the document's notes, the id
    // `resolveNotes` gives it — every note, one naming no class included.
    for (const index of block.noteIndexes) namespace.noteIds.push(generatedId("note", index + 1));
  }

  return [...byQualifiedName.values()];
}

/**
 * Makes the classes one `namespace` block names members of the namespace it
 * opens, `namespace`. `claimedBy` records which namespace, by qualified
 * name, holds each class so far: a class it already holds is skipped, and
 * one a different namespace holds stays there, with an error.
 */
function claimMembers(
  block: ClassNamespace,
  namespace: ResolvedClassNamespace,
  claimedBy: Map<string, string>,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): void {
  for (const classId of block.classIds) {
    const claimant = claimedBy.get(classId);
    if (claimant === block.id) continue;
    if (claimant !== undefined) {
      diagnostics.push({
        severity: "error",
        message:
          `Class "${classId}" is named by more than one namespace ` +
          `("${claimant}" and "${block.id}"), and a class can sit in only one; ` +
          `keeping it in "${claimant}". Name it in only one of the namespaces.`,
        line: block.line,
        column: block.column,
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
    member.resolved.namespaceId = namespace.id;
    claimedBy.set(classId, block.id);
    namespace.classIds.push(classId);
  }
}

/**
 * Adds one declaration's members to a class, every one of them, in the
 * order written: Mermaid 12.2.0 draws a member written twice twice —
 * `A : +x` on two lines, `+x` twice in one block, or `class A { +x }`
 * declared twice (measured, Chrome) — so a repeat is kept, not merged.
 */
function addMembers(target: ClassAccumulator, members: ClassMember[]): void {
  target.resolved.members.push(...members);
}

/**
 * The error for a note whose target carries a generic other than the one
 * its class was first named with — `class`'s kept generic, the rule
 * `genericAfterFirstNaming` keeps — or that names no class at all; `null`
 * when it carries none or the class's own. Mermaid 12.2.0 reads a note's
 * target by its name alone (measured, Chrome: `class A~T~` then `note for
 * A~T~ "n"` draws `A<T>` with the note; `class A` or `class A~U~` then
 * `note for A~T~ "n"` draws `A` or `A<U>`, the `T` gone with no diagnostic),
 * so any other generic is a picture other than the one written (ADR-0001).
 */
function noteTargetGenericError(note: ClassNote, target: ClassAccumulator | undefined): Diagnostic | null {
  if (note.targetGeneric === undefined || target?.resolved.generic === note.targetGeneric) return null;
  const written = asWritten(note.targetGeneric);
  const where = onLine(target?.firstLine);
  const has =
    target === undefined
      ? "is never named"
      : target.resolved.generic === null
        ? `was first named${where} without one`
        : `was first named${where} with "${asWritten(target.resolved.generic)}"`;
  const id = note.targetId;
  return {
    severity: "error",
    message:
      `The note for "${id}~${written}~" names the generic "${written}", but class "${id}" ${has}, ` +
      `so "${written}" would not be drawn. ` +
      `Write the note for "${id}" alone, or give "${id}" that generic where it is first named.`,
    line: note.line,
    column: note.column,
  };
}

/**
 * Resolves the document's `note` statements: each gets the stable
 * `note:${n}` id the timeline and the renderer address it by, and an
 * attached note's target is looked up among the classes.
 *
 * Naming a class in a `note for X` does not declare it — unlike a
 * relationship endpoint or a namespace member, where the name *is* the way
 * the class enters the diagram. When X is no class of the diagram, Mermaid
 * 12.2.0 still draws the note, with no connector and no class X (measured),
 * so the note is kept as a free one — in the namespace it was written in,
 * if any — with a warning, since the name is most likely a typo.
 *
 * The id comes from the note's position in the source, so `note:3` names
 * the third note written whatever became of the ones before it.
 */
function resolveNotes(
  document: ClassDocument,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): ResolvedClassNote[] {
  const notes: ResolvedClassNote[] = [];

  document.notes.forEach((note, index) => {
    let targetId = note.targetId;
    const targetGenericError = targetId === null ? null : noteTargetGenericError(note, classesById.get(targetId));
    if (targetGenericError !== null) {
      diagnostics.push(targetGenericError);
    } else if (targetId !== null && !classesById.has(targetId)) {
      diagnostics.push({
        severity: "warning",
        message:
          `note for "${targetId}" names no class in this diagram, so the note is not attached to anything. ` +
          `Check the name, or declare the class with "class ${targetId}".`,
        line: note.line,
        column: note.column,
      });
    }
    // A note naming no class is kept as a free note, whichever diagnostic
    // it got.
    if (targetId !== null && !classesById.has(targetId)) targetId = null;

    notes.push({
      id: generatedId("note", index + 1),
      label: note.label,
      targetId,
    });
  });

  return notes;
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
  // A `()` end names a lollipop interface, not a class (measured against
  // real Mermaid — see `ClassRelationshipEnd`), so `from`/`to` on that side
  // need an id of their own rather than the class id `relationship.from`/
  // `.to` would otherwise be. `generatedId` (ADR-0010) is that id, counted
  // across every lollipop end in document order — the same convention
  // `namespace:n` and `note:n` use, and the reason two relationships that
  // happen to name the same interface (`Duck ()-- Quacks` twice) still get
  // two distinct, independently positioned nodes: each occurrence takes the
  // next counter value rather than being keyed by the name it wrote.
  let interfaceOccurrence = 0;

  return document.relationships.map((relationship) => {
    const pairKey = `${relationship.from}->${relationship.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);
    const baseId = `${relationship.from}-${relationship.to}`;
    const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;

    const isFromInterface = relationship.fromEnd === "circle";
    const isToInterface = relationship.toEnd === "circle";

    return {
      id,
      from: isFromInterface
        ? generatedId("interface", ++interfaceOccurrence)
        : relationship.from,
      to: isToInterface ? generatedId("interface", ++interfaceOccurrence) : relationship.to,
      line: relationship.line,
      fromEnd: relationship.fromEnd,
      toEnd: relationship.toEnd,
      label: relationship.label,
      fromMultiplicity: relationship.fromMultiplicity,
      toMultiplicity: relationship.toMultiplicity,
      fromInterfaceLabel: isFromInterface ? relationship.from : null,
      toInterfaceLabel: isToInterface ? relationship.to : null,
    };
  });
}
