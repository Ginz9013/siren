import type {
  ClassDecl,
  ClassDirection,
  ClassDocument,
  ClassMember,
  ClassMemberClassifier,
  ClassMemberVisibility,
  ClassNamespace,
  ClassNote,
  ClassRelationship,
  ClassRelationshipEnd,
  Diagnostic,
  ParseResult,
} from "../contracts";

const CLASS_HEADER_RE = /^classDiagram(?:-v2)?\s*$/;
/**
 * A bare `class Animal` declaration, with an optional `~generic~`
 * parameter after the name (`class Square~Shape~`).
 *
 * The generic capture is greedy on purpose: it runs to the *last* `~` on
 * the line, so a nested parameter such as `class Shelf~Map~String, List~int~~~`
 * parses with `Map~String, List~int~~` captured whole rather than being
 * rejected. Nested generics are therefore supported, not diagnosed.
 */
const CLASS_DECL_RE = /^class\s+(\w+)(?:~(.+)~)?\s*$/;
/** The opening line of a block-form declaration, `class Animal {`. */
const CLASS_BLOCK_OPEN_RE = /^class\s+(\w+)(?:~(.+)~)?\s*\{$/;
/**
 * A relationship statement: two class names, the relation token between
 * them, an optional quoted multiplicity beside each name, and an optional
 * `: label`.
 *
 * The relation token is matched as three independent parts — an optional
 * left marker, the line (`--` solid or `..` dashed), and an optional right
 * marker — rather than as an alternation of Mermaid's eight named forms.
 * That is the same decomposition the model uses, so every spelling
 * Mermaid allows, including each form's mirror image (`--|>` for `<|--`)
 * and two-headed combinations (`<|--|>`), parses without a table of
 * special cases.
 */
const RELATIONSHIP_RE =
  /^(\w+)(?:\s+"([^"]*)")?\s*(<\|?|\*|o)?(--|\.\.)(\|>|>|\*|o)?\s*(?:"([^"]*)"\s+)?(\w+)\s*(?::\s*(.*))?$/;

/**
 * An annotation on its own line inside a class block, `<<interface>>`.
 * The text between the guillemets is whatever the author chose — Mermaid
 * gives `interface`, `abstract`, `enumeration` and `service` their own
 * styling but accepts any word.
 */
const ANNOTATION_RE = /^<<(.+)>>$/;
/** The standalone form of the same thing, `<<interface>> Shape`. */
const STANDALONE_ANNOTATION_RE = /^<<(.+)>>\s+(\w+)$/;

/** The opening line of a `namespace BaseShapes {` block. */
const NAMESPACE_OPEN_RE = /^namespace\s+(\w+)\s*\{$/;

/**
 * A free note, `note "text"`. Its text is quoted, as Mermaid requires.
 */
const NOTE_RE = /^note\s+"([^"]*)"$/;
/**
 * A note attached to one class, `note for Duck "text"`. Naming a class
 * here does not declare it — only a relationship does that — so a note for
 * a class that was never declared is `buildClassModel`'s to resolve.
 */
const NOTE_FOR_RE = /^note\s+for\s+(\w+)\s+"([^"]*)"$/;

/** A `direction TB|BT|LR|RL` statement. */
const DIRECTION_RE = /^direction\s+(TB|BT|LR|RL)$/;

/** The inline member form, `Bird : +fly()`. */
const INLINE_MEMBER_RE = /^(\w+)\s*:\s*(.+)$/;
/** What a member's own name may look like, once markers and type are off. */
const MEMBER_NAME_RE = /^[A-Za-z_]\w*$/;

const VISIBILITY_MARKERS = new Set<string>(["+", "-", "#", "~"]);
const CLASSIFIER_MARKERS = new Set<string>(["*", "$"]);

/**
 * Maps a relation token's left- or right-hand marker to the endpoint it
 * draws. `<|`/`|>` is a triangle (inheritance/realization), `*` a filled
 * diamond (composition), `o` a hollow diamond (aggregation), `<`/`>` an
 * arrow (association/dependency), and a missing marker draws nothing.
 */
function endpointFor(marker: string | undefined): ClassRelationshipEnd {
  switch (marker) {
    case "<|":
    case "|>":
      return "triangle";
    case "*":
      return "diamondFilled";
    case "o":
      return "diamondHollow";
    case "<":
    case ">":
      return "arrow";
    default:
      return "none";
  }
}

/**
 * Parses one member line of a class — `+int size`, `-String name`,
 * `+swim() bool`, `draw()*` — into its parts, or returns `null` when the
 * line is not a member at all (the caller turns that into a diagnostic).
 *
 * Each part is kept as the author wrote it, so the renderer can print the
 * line back verbatim: a `+` stays a `+`, a type stays whatever text stood
 * before the name, and a parameter list stays the raw text between the
 * parens.
 *
 * A leading `~` is read as the package-visibility marker, never as the
 * opening of a `~generic~` — that ambiguity is Mermaid's own, and Mermaid
 * resolves it the same way.
 */
function parseMember(text: string, line: number, column: number): ClassMember | null {
  let rest = text.trim();

  let classifier: ClassMemberClassifier | null = null;
  const lastChar = rest.slice(-1);
  if (CLASSIFIER_MARKERS.has(lastChar)) {
    classifier = lastChar as ClassMemberClassifier;
    rest = rest.slice(0, -1).trim();
  }

  let visibility: ClassMemberVisibility | null = null;
  const firstChar = rest.slice(0, 1);
  if (VISIBILITY_MARKERS.has(firstChar)) {
    visibility = firstChar as ClassMemberVisibility;
    rest = rest.slice(1).trim();
  }

  const openParen = rest.indexOf("(");
  if (openParen !== -1) {
    const closeParen = rest.lastIndexOf(")");
    if (closeParen < openParen) {
      return null;
    }
    const name = rest.slice(0, openParen).trim();
    if (!MEMBER_NAME_RE.test(name)) {
      return null;
    }
    const returnType = rest.slice(closeParen + 1).trim();
    return {
      memberKind: "method",
      visibility,
      classifier,
      name,
      type: null,
      parameters: rest.slice(openParen + 1, closeParen),
      returnType: returnType.length > 0 ? returnType : null,
      line,
      column,
    };
  }

  const tokens = rest.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const name = tokens[tokens.length - 1];
  if (!MEMBER_NAME_RE.test(name)) {
    return null;
  }
  return {
    memberKind: "attribute",
    visibility,
    classifier,
    // Mermaid writes an attribute's type before its name (`+int size`), so
    // the last token is the name and anything before it is the type.
    name,
    type: tokens.length > 1 ? tokens.slice(0, -1).join(" ") : null,
    parameters: null,
    returnType: null,
    line,
    column,
  };
}

/**
 * Parses Siren class-diagram source text — a `classDiagram` (or
 * `classDiagram-v2`) header, class declarations in all three forms
 * (`class Animal`, `class Animal { ... }`, `Animal : +fly()`),
 * relationship statements with their optional label and multiplicity,
 * `<<annotation>>` markers, `~generic~` parameters, `namespace` blocks,
 * `note` statements and `direction` — into a `ClassDocument`. Never throws
 * on malformed input: syntax problems are reported as diagnostics, and a
 * document containing an error-severity one comes back as `null`.
 *
 * A class named only by a relationship is declared by that mention, the
 * way `parseFlowchart` declares a node named only by an edge. Repeat
 * declarations of one name are *not* folded together here — that, and
 * every other cross-statement question (relationship ids, endpoint
 * resolution, note attachment, timeline resolution), is
 * `buildClassModel`'s job. That is why a standalone `<<interface>> Shape`
 * produces its own annotation-only declaration rather than reaching back
 * into an earlier one: every statement contributes a declaration, and the
 * model merges them.
 *
 * A header with nothing after it is a valid, empty diagram rather than an
 * error: Mermaid renders it as an empty canvas, and there is nothing
 * malformed to report.
 *
 * `%%` comments are already gone by the time this runs: `parseSiren`
 * strips them for every diagram kind before dispatching.
 *
 * Not yet recognized, and therefore reported as unrecognized lines: the
 * interaction and styling directives (`click`, `callback`, `style`,
 * `classDef`, `cssClass`) and the `timeline:` block. Those arrive in later
 * tickets on this board.
 */
export function parseClassDiagram(source: string): ParseResult {
  const lines = source.split(/\r\n|\r|\n/);
  const diagnostics: Diagnostic[] = [];

  let index = 0;
  while (index < lines.length && lines[index].trim().length === 0) {
    index++;
  }

  if (index >= lines.length) {
    return { document: null, diagnostics };
  }

  const headerRawLine = lines[index];
  const headerLine = headerRawLine.trim();
  if (!CLASS_HEADER_RE.test(headerLine)) {
    diagnostics.push({
      severity: "error",
      message: `Expected "classDiagram" or "classDiagram-v2", found "${headerLine}"`,
      line: index + 1,
      column: headerRawLine.length - headerRawLine.trimStart().length + 1,
    });
    return { document: null, diagnostics };
  }

  index++;

  const classes: ClassDecl[] = [];
  const relationships: ClassRelationship[] = [];
  const namespaces: ClassNamespace[] = [];
  const notes: ClassNote[] = [];
  /** Every class id seen so far, however it was introduced. */
  const declaredIds = new Set<string>();
  /**
   * Whether any error-severity problem was found. Like the flowchart and
   * sequence parsers, a document with one is returned as `null`: the
   * diagnostics say what is wrong, and no half-parsed document reaches the
   * next stage.
   */
  let sawError = false;
  /**
   * The document's layout direction. `TB` until a `direction` statement
   * says otherwise; a second one wins over the first, the way a later
   * assignment wins in every other statement-ordered format.
   */
  let direction: ClassDirection = "TB";

  /**
   * Adds a declaration to the document, and — when it was written inside a
   * `namespace` block — names it as a member of that namespace. A class
   * declared twice inside one namespace is named once.
   */
  const declareClass = (declaration: ClassDecl, namespaceMembers: string[] | null) => {
    declaredIds.add(declaration.id);
    classes.push(declaration);
    if (namespaceMembers !== null && !namespaceMembers.includes(declaration.id)) {
      namespaceMembers.push(declaration.id);
    }
  };

  /**
   * Records a class named by a relationship, the way `parseFlowchart`
   * records a node named by an edge: `Animal <|-- Duck` declares both
   * classes. Only the first mention creates one, so a class named by ten
   * relationships is still one declaration — and an id that already has a
   * declaration of its own is left alone.
   */
  const declareImplicitly = (
    id: string,
    line: number,
    column: number,
    namespaceMembers: string[] | null,
  ) => {
    if (declaredIds.has(id)) {
      return;
    }
    declareClass(
      { id, generic: null, annotation: null, members: [], line, column },
      namespaceMembers,
    );
  };

  /**
   * Parses the statement starting at `startIndex` and returns the index of
   * the last line it consumed: the same line for a one-line statement, the
   * closing `}` for a block form. The caller advances past that.
   *
   * `namespaceMembers` is the class-id list of the `namespace` block this
   * statement sits inside, or `null` at the top level. A class declared
   * here joins that list.
   */
  const parseStatement = (startIndex: number, namespaceMembers: string[] | null): number => {
    const rawLine = lines[startIndex];
    const line = rawLine.trim();
    if (line.length === 0) {
      return startIndex;
    }

    const lineNumber = startIndex + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;

    const directionMatch = DIRECTION_RE.exec(line);
    if (directionMatch !== null) {
      direction = directionMatch[1] as ClassDirection;
      return startIndex;
    }

    const namespaceOpenMatch = NAMESPACE_OPEN_RE.exec(line);
    if (namespaceOpenMatch !== null) {
      const classIds: string[] = [];
      let closed = false;
      let bodyIndex = startIndex + 1;

      for (; bodyIndex < lines.length; bodyIndex++) {
        const bodyLine = lines[bodyIndex].trim();
        if (bodyLine.length === 0) {
          continue;
        }
        if (bodyLine === "}") {
          closed = true;
          break;
        }
        // The body is parsed by the same statement parser as the top
        // level, which is what lets a namespace hold block-form classes:
        // the inner call consumes that class's own `}`, so it is never
        // mistaken for the namespace's.
        bodyIndex = parseStatement(bodyIndex, classIds);
      }

      if (!closed) {
        diagnostics.push({
          severity: "error",
          message: `Unterminated "namespace ${namespaceOpenMatch[1]}" block: missing matching "}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
      }

      namespaces.push({ id: namespaceOpenMatch[1], classIds, line: lineNumber, column });
      return bodyIndex;
    }

    const noteForMatch = NOTE_FOR_RE.exec(line);
    if (noteForMatch !== null) {
      notes.push({
        text: noteForMatch[2],
        targetId: noteForMatch[1],
        line: lineNumber,
        column,
      });
      return startIndex;
    }

    const noteMatch = NOTE_RE.exec(line);
    if (noteMatch !== null) {
      notes.push({ text: noteMatch[1], targetId: null, line: lineNumber, column });
      return startIndex;
    }

    const standaloneAnnotationMatch = STANDALONE_ANNOTATION_RE.exec(line);
    if (standaloneAnnotationMatch !== null) {
      // One declaration per statement, exactly as the inline member form
      // does: this contributes an annotation and nothing else, and
      // `buildClassModel` folds it into the class's other declarations.
      const [, annotationText, id] = standaloneAnnotationMatch;
      declareClass(
        {
          id,
          generic: null,
          annotation: annotationText.trim(),
          members: [],
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      return startIndex;
    }

    const relationshipMatch = RELATIONSHIP_RE.exec(line);
    if (relationshipMatch !== null) {
      const [
        ,
        from,
        fromMultiplicity,
        leftMarker,
        lineToken,
        rightMarker,
        toMultiplicity,
        to,
        label,
      ] = relationshipMatch;
      relationships.push({
        from,
        to,
        line: lineToken === ".." ? "dashed" : "solid",
        fromEnd: endpointFor(leftMarker),
        toEnd: endpointFor(rightMarker),
        label: label === undefined || label.trim().length === 0 ? null : label.trim(),
        fromMultiplicity: fromMultiplicity ?? null,
        toMultiplicity: toMultiplicity ?? null,
        sourceLine: lineNumber,
        sourceColumn: column,
      });
      declareImplicitly(from, lineNumber, column, namespaceMembers);
      declareImplicitly(to, lineNumber, column, namespaceMembers);
      return startIndex;
    }

    const blockOpenMatch = CLASS_BLOCK_OPEN_RE.exec(line);
    if (blockOpenMatch !== null) {
      const members: ClassMember[] = [];
      let annotation: string | null = null;
      let closed = false;
      let bodyIndex = startIndex + 1;

      for (; bodyIndex < lines.length; bodyIndex++) {
        const bodyRawLine = lines[bodyIndex];
        const bodyLine = bodyRawLine.trim();
        if (bodyLine.length === 0) {
          continue;
        }
        if (bodyLine === "}") {
          closed = true;
          break;
        }

        // Checked before `parseMember`, which would read `<<interface>>`
        // as a nameless member and reject it.
        const annotationMatch = ANNOTATION_RE.exec(bodyLine);
        if (annotationMatch !== null) {
          annotation = annotationMatch[1].trim();
          continue;
        }

        const member = parseMember(
          bodyLine,
          bodyIndex + 1,
          bodyRawLine.length - bodyRawLine.trimStart().length + 1,
        );
        if (member === null) {
          diagnostics.push({
            severity: "error",
            message: `Unrecognized class member: "${bodyLine}"`,
            line: bodyIndex + 1,
            column: bodyRawLine.length - bodyRawLine.trimStart().length + 1,
          });
          sawError = true;
          continue;
        }
        members.push(member);
      }

      if (!closed) {
        diagnostics.push({
          severity: "error",
          message: `Unterminated "class ${blockOpenMatch[1]}" block: missing matching "}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
      }

      declareClass(
        {
          id: blockOpenMatch[1],
          generic: blockOpenMatch[2] ?? null,
          annotation,
          members,
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      // The `}` this stopped on, or the end of input when the block was
      // never closed.
      return bodyIndex;
    }

    const classDeclMatch = CLASS_DECL_RE.exec(line);
    if (classDeclMatch !== null) {
      declareClass(
        {
          id: classDeclMatch[1],
          generic: classDeclMatch[2] ?? null,
          annotation: null,
          members: [],
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      return startIndex;
    }

    const inlineMemberMatch = INLINE_MEMBER_RE.exec(line);
    if (inlineMemberMatch !== null) {
      const [, id, memberText] = inlineMemberMatch;
      const member = parseMember(memberText, lineNumber, column);
      if (member === null) {
        diagnostics.push({
          severity: "error",
          message: `Unrecognized class member: "${memberText}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        return startIndex;
      }
      // One declaration per line, carrying that line's single member.
      // Folding repeats of the same id together is `buildClassModel`'s job.
      declareClass(
        {
          id,
          generic: null,
          annotation: null,
          members: [member],
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      return startIndex;
    }

    diagnostics.push({
      severity: "error",
      message: `Unrecognized classDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
    return startIndex;
  };

  for (; index < lines.length; index++) {
    index = parseStatement(index, null);
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: ClassDocument = {
    kind: "class",
    direction,
    classes,
    relationships,
    namespaces,
    notes,
    interactions: [],
    styles: [],
    timeline: null,
  };

  return { document, diagnostics };
}
