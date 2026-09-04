import type {
  ClassDecl,
  ClassDocument,
  ClassMember,
  ClassModel,
  ClassModelResult,
  ClassStyleDecl,
  ClassStyleProperty,
  Diagnostic,
  ResolvedClass,
  ResolvedClassInteraction,
  ResolvedClassNamespace,
  ResolvedClassNote,
  ResolvedClassRelationship,
  ResolvedClassStyle,
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
 * The exception is author interaction and styling, where this stage
 * *judges* rather than reconciles, because it is the only stage that can.
 * A `click X href "..."` URL and a `style X fill:...` value are two sinks
 * for text the author controls: the parser records both verbatim by design,
 * and the renderer puts whatever survives into a live `href` and a live
 * `style` attribute. So the `http`/`https`/`mailto` allowlist in
 * `rejectUrl` and the rejection list in `rejectStyleProperty` are this
 * board's security boundary — if they admit something, nothing downstream
 * catches it. Both refuse rather than sanitize, and say so in a diagnostic.
 *
 * Problems come back as diagnostics rather than exceptions, and never sink
 * the whole model: a timeline entry naming an id that does not exist is
 * dropped on its own, a rejected URL costs its class a link and not its
 * box, and everything else still resolves — the same partial-failure
 * tolerance `buildFlowchartModel` and `buildSequenceModel` apply.
 */
export function buildClassModel(document: ClassDocument): ClassModelResult {
  const diagnostics: Diagnostic[] = [];

  const classesById = resolveClasses(document, diagnostics);

  const namespaces = resolveNamespaces(document, classesById, diagnostics);

  const notes = resolveNotes(document, classesById, diagnostics);

  const classes = [...classesById.values()].map((accumulator) => accumulator.resolved);

  const relationships = assignRelationshipIds(document);

  const interactions = resolveInteractions(document, classesById, diagnostics);

  const styles = resolveStyles(document, classesById, diagnostics);

  const model: ClassModel = {
    direction: document.direction,
    classes,
    relationships,
    namespaces,
    notes,
    interactions,
    styles,
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
 * What separates a generated id's kind from its number — `namespace:1`,
 * `note:1`.
 *
 * A colon rather than the `-` these ids used to use, because classes,
 * relationships, namespaces and notes share one id space and `-` is already
 * spoken for: a relationship's id is `${from}-${to}`, so a class named
 * `namespace` pointing at a class named `1` produces `namespace-1` — the
 * same string the first namespace held. Both `timeline:` addressing and
 * `data-siren-id` were then ambiguous, with no diagnostic to say so.
 *
 * A class id is `\w+` (the parser's rule), which cannot contain a `:`, so
 * no relationship id can ever spell one of these. The separator makes the
 * collision structurally impossible rather than merely unlikely, which is
 * why this is a constant with a reason attached and not an incidental `-`.
 *
 * The cost is that an author addressing a namespace in a `timeline:` block
 * writes `step 1: enter namespace:1 fade`. The timeline entry grammar takes
 * everything after the step's own colon and splits it on whitespace, so a
 * colon inside the id is read as part of the id.
 */
const ID_SEPARATOR = ":";

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
 * `namespace:${n}` id the timeline and the renderer address it by — a
 * 1-based counter in document order, the same convention
 * `buildSequenceModel` gives its blocks — while the name the author wrote
 * becomes the frame's `label`.
 *
 * The `:` separator is load-bearing, not decoration: see `ID_SEPARATOR`.
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
    const id = `namespace${ID_SEPARATOR}${index + 1}`;
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
 * measuring exists.
 *
 * The two spellings have since diverged on purpose, and must not be
 * "fixed" to match. This composes the **authored** spelling; layout
 * composes the **drawn** one, which converts a generic's `~T~` into the
 * `<T>` Mermaid draws. That is fine — a union key only has to be
 * consistent with itself, and it is computed at one stage from one source.
 *
 * The one visible consequence: a class declaring both `+List~int~ items`
 * and `+List<int> items` keeps two members here, because they are two
 * keys, and layout then draws the same line twice. Collapsing that would
 * mean keying on the drawn spelling, which means composing the line once
 * in this stage and carrying it on the contract for layout to draw.
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
 * `note:${n}` id the timeline and the renderer address it by, and an
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
 * ones written after it — a timeline referring to `note:3` keeps referring
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

    notes.push({
      id: `note${ID_SEPARATOR}${index + 1}`,
      text: note.text,
      targetId: note.targetId,
    });
  });

  return notes;
}

/**
 * The URL schemes a `click X href "..."` may navigate to. An allowlist, not
 * a blocklist: `javascript:`, `data:` and `vbscript:` are the famous
 * script-bearing schemes, but they are not the only ones a browser or an
 * OS handler will act on, and a list of the ones we happen to know about
 * would silently admit the next one.
 */
const ALLOWED_URL_SCHEMES = new Set<string>(["http:", "https:", "mailto:"]);

/** The allowlist as a diagnostic reads it. */
const ALLOWED_SCHEMES_PHRASE = "only http:, https: and mailto: are allowed";

/**
 * A URL's scheme grammar, per RFC 3986: a letter, then letters, digits and
 * `+`, `-`, `.`.
 */
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/**
 * The characters removed from a URL before its scheme is read: every ASCII
 * control character, plus space and DEL. Written as a source pattern rather
 * than a literal so the file holds no raw control bytes.
 */
const STRIPPED = "[\\u0000-\\u0020\\u007f]";

/**
 * Decides whether an author-written `href` may be emitted, returning `null`
 * when it may and the clause a diagnostic should carry when it may not.
 *
 * **This is the board's security boundary for URLs.** The parser records
 * whatever the author typed and judges none of it, and the renderer puts
 * the survivors into a live `href`, so a URL this function admits is a URL
 * a reader can be made to navigate to.
 *
 * The rules, in the order they apply:
 *
 * - Leading whitespace and control characters are stripped, and whitespace
 *   and control characters are removed from the candidate scheme, *before*
 *   the scheme is read. A browser does the same, so a `javascript:` URL with
 *   a tab, a newline or a NUL wedged into the word — or leading spaces in
 *   front of it — navigates exactly like the plain spelling. Matching on
 *   the raw text is the classic way an allowlist is walked past.
 *   The rule is deliberately stricter than the URL spec (which only strips
 *   tab and newline): a legitimate scheme contains none of these characters,
 *   so the worst an over-strict reading costs is a diagnostic on a URL that
 *   was already unusable.
 * - A URL beginning `//` — or the `\\` a browser reads as `//` — is
 *   rejected. It carries no scheme of its own, adopting instead whatever
 *   the page was served over, so it is an off-site navigation wearing the
 *   costume of a path.
 * - A URL with a scheme must have one from `ALLOWED_URL_SCHEMES`.
 * - Anything else has no scheme at all — `./docs/shape.html`, `#shape` —
 *   and resolves against the document. The allowlist rejects dangerous
 *   schemes; it does not demand absolute URLs.
 */
function rejectUrl(url: string): string | null {
  const leading = url.replace(new RegExp(`^${STRIPPED}+`), "");

  if (/^[/\\][/\\]/.test(leading)) {
    return `uses a scheme-relative URL ("${url}"), which adopts the page's scheme`;
  }

  const colon = leading.indexOf(":");
  if (colon === -1) {
    return null;
  }

  const candidate = leading.slice(0, colon).replace(new RegExp(STRIPPED, "g"), "");
  if (!URL_SCHEME_RE.test(candidate)) {
    // Not a scheme at all: the `:` belongs to a path or a fragment, as in
    // `./a:b`. A relative URL, and allowed.
    return null;
  }

  const scheme = `${candidate.toLowerCase()}:`;
  if (ALLOWED_URL_SCHEMES.has(scheme)) {
    return null;
  }
  return `uses the disallowed URL scheme "${scheme}"`;
}

/**
 * Resolves the document's `click`/`link`/`callback` statements into the
 * model's interactions.
 *
 * Naming a class here does not declare it, exactly as naming one in a `note
 * for` does not: an interaction is about a class that already exists, so an
 * unknown target is a typo. The interaction is dropped on its own and the
 * rest of the model still resolves.
 */
function resolveInteractions(
  document: ClassDocument,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): ResolvedClassInteraction[] {
  const interactions: ResolvedClassInteraction[] = [];

  for (const interaction of document.interactions) {
    if (!classesById.has(interaction.classId)) {
      diagnostics.push({
        severity: "error",
        message: `click "${interaction.classId}" references a class that does not exist; dropping the interaction.`,
        line: interaction.line,
        column: interaction.column,
      });
      continue;
    }

    if (interaction.interactionKind === "href") {
      const rejection = rejectUrl(interaction.action);
      if (rejection !== null) {
        diagnostics.push({
          severity: "error",
          message: `click "${interaction.classId}" ${rejection}; ${ALLOWED_SCHEMES_PHRASE}; dropping the interaction.`,
          line: interaction.line,
          column: interaction.column,
        });
        continue;
      }
    }

    interactions.push({
      classId: interaction.classId,
      interactionKind: interaction.interactionKind,
      action: interaction.action,
      argument: interaction.argument,
      tooltip: interaction.tooltip,
    });
  }

  return interactions;
}

/**
 * What a style property may be spelled as: a plain CSS identifier, with the
 * leading `-`/`--` a vendor prefix or a custom property needs.
 *
 * Anything else is refused rather than escaped. The parser splits a
 * declaration on its first `:`, so a property is whatever text preceded it —
 * `a;b` in `style Shape a;b:red` — and a name carrying a `;` or a `{` is not
 * a property an author meant to write, it is a second declaration trying to
 * ride along inside the first.
 */
const CSS_PROPERTY_RE = /^-{0,2}[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * The CSS functions an author's style value may not use, with why.
 *
 * `url(` fetches: it turns a diagram into a beacon that reports every reader
 * to whoever wrote the document, and in some contexts loads code.
 * `expression(` is legacy IE and executes script outright. Both are matched
 * case-insensitively and with optional space before the paren — the value is
 * refused, not sanitized, so being broader than the CSS grammar costs a
 * diagnostic on an unusable declaration and nothing else.
 *
 * A deliberately short list. It is not "every way CSS can fetch" — the
 * board named these two — so a future value-bearing sink (`image-set(`,
 * `-moz-binding`) belongs here, and this is the one place to add it.
 */
const REJECTED_VALUE_FUNCTIONS: { pattern: RegExp; name: string; why: string }[] = [
  { pattern: /url\s*\(/i, name: "url(", why: "can fetch a remote resource" },
  { pattern: /expression\s*\(/i, name: "expression(", why: "can execute script" },
];

/**
 * Filters one statement's declarations down to the ones that may be
 * emitted, diagnosing each rejection at the statement that wrote it.
 *
 * **This is the board's security boundary for styling.** These declarations
 * become an inline `style` attribute on a rendered element, so whatever
 * survives here is whatever the browser is asked to do.
 *
 * A rejection takes the declaration, never the statement: the other
 * declarations of a `style Shape fill:url(#evil),stroke:#c00` still apply.
 * And a rejection is reported where the value is *written* — so a bad
 * `classDef` is reported once, at the `classDef`, rather than once per class
 * that applies it, because that is the line the author has to edit.
 */
function acceptedProperties(
  declaration: ClassStyleDecl,
  diagnostics: Diagnostic[],
): ClassStyleProperty[] {
  const accepted: ClassStyleProperty[] = [];

  for (const property of declaration.properties) {
    const problem = rejectStyleProperty(property);
    if (problem !== null) {
      diagnostics.push({
        severity: "error",
        message: problem,
        line: declaration.line,
        column: declaration.column,
      });
      continue;
    }
    accepted.push(property);
  }

  return accepted;
}

/**
 * The reason one declaration may not be emitted, or `null` when it may.
 */
function rejectStyleProperty({ property, value }: ClassStyleProperty): string | null {
  if (!CSS_PROPERTY_RE.test(property)) {
    return `Style property "${property}" is not a plain CSS identifier; dropping the declaration.`;
  }

  for (const rejected of REJECTED_VALUE_FUNCTIONS) {
    if (rejected.pattern.test(value)) {
      return `Style value for "${property}" uses "${rejected.name}", which ${rejected.why}; dropping the declaration.`;
    }
  }

  // A value is one declaration's worth of CSS. A `;` inside it can only be
  // an attempt at a second one — the parser splits on the first `:`, so
  // `fill:#fdd;position:fixed` arrives here as a single value. Whether it
  // would actually smuggle depends on how the renderer serializes the
  // attribute; refusing it here means the answer does not matter.
  if (value.includes(";")) {
    return `Style value for "${property}" contains ";", which would smuggle in a second declaration; dropping the declaration.`;
  }

  return null;
}

/**
 * Resolves the document's `style`/`classDef`/`cssClass` statements into one
 * entry per styled class, carrying the declarations that class ends up with.
 *
 * Three statements, two roles. A `classDef` only *defines* a named set of
 * declarations and applies to nothing; a `cssClass` applies one to a list of
 * classes; a `style` applies declarations straight to one class. So the
 * `classDef`s are collected first, in a pass of their own — a `cssClass` is
 * allowed to name a `classDef` written below it, and the parser deliberately
 * leaves that pairing here.
 *
 * The second pass then walks the document in order and applies what each
 * statement contributes. Application order is what settles a disagreement:
 * a property declared twice for one class keeps the position of its first
 * declaration and takes the value of its last, so a `style` written after a
 * `cssClass` overrides the `classDef` it applied. That is the same answer
 * the CSS cascade gives for one element's inline declarations, decided here
 * so the renderer emits a set with no repeats rather than relying on it.
 *
 * Only classes that end up with at least one declaration appear in the
 * result, so a class whose every declaration was rejected is absent rather
 * than present-and-empty — the renderer's "no styles, no `style` attribute"
 * case, reached without it having to test for an empty list.
 */
function resolveStyles(
  document: ClassDocument,
  classesById: Map<string, ClassAccumulator>,
  diagnostics: Diagnostic[],
): ResolvedClassStyle[] {
  const definitions = new Map<string, ClassStyleProperty[]>();
  for (const declaration of document.styles) {
    if (declaration.styleKind !== "classDef" || declaration.name === null) continue;
    definitions.set(declaration.name, acceptedProperties(declaration, diagnostics));
  }

  /** Each styled class's declarations so far, in first-declared order. */
  const byClassId = new Map<string, Map<string, string>>();

  for (const declaration of document.styles) {
    if (declaration.styleKind === "classDef") continue;

    let applied: ClassStyleProperty[];
    if (declaration.styleKind === "cssClass") {
      const defined = definitions.get(declaration.name ?? "");
      if (defined === undefined) {
        // Applying a name nothing defines is a typo, and a silent one:
        // without this the class is simply not styled, and the author is
        // left comparing two spellings by eye.
        diagnostics.push({
          severity: "error",
          message: `cssClass applies "${declaration.name}", which no classDef defines; dropping the declaration.`,
          line: declaration.line,
          column: declaration.column,
        });
        continue;
      }
      applied = defined;
    } else {
      applied = acceptedProperties(declaration, diagnostics);
    }

    for (const classId of declaration.classIds) {
      // Naming a class in a styling statement does not declare it, exactly
      // as `note for` and `click` do not: styling is about a class that
      // already exists. One unknown target drops itself, not the statement,
      // so the other targets of a `cssClass "A,Ghost"` still get styled.
      if (!classesById.has(classId)) {
        diagnostics.push({
          severity: "error",
          message: `${declaration.styleKind} "${classId}" references a class that does not exist; dropping the declaration.`,
          line: declaration.line,
          column: declaration.column,
        });
        continue;
      }

      let properties = byClassId.get(classId);
      if (properties === undefined) {
        properties = new Map<string, string>();
        byClassId.set(classId, properties);
      }
      for (const { property, value } of applied) {
        properties.set(property, value);
      }
    }
  }

  return [...byClassId]
    .filter(([, properties]) => properties.size > 0)
    .map(([classId, properties]) => ({
      classId,
      properties: [...properties].map(([property, value]) => ({ property, value })),
    }));
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
