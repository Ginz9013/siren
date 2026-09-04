import type {
  ClassDecl,
  ClassDocument,
  ClassMember,
  ClassMemberClassifier,
  ClassMemberVisibility,
  ClassRelationship,
  ClassRelationshipEnd,
  Diagnostic,
  ParseResult,
} from "../contracts";

const CLASS_HEADER_RE = /^classDiagram(?:-v2)?\s*$/;
/** A bare `class Animal` declaration. */
const CLASS_DECL_RE = /^class\s+(\w+)\s*$/;
/** The opening line of a block-form declaration, `class Animal {`. */
const CLASS_BLOCK_OPEN_RE = /^class\s+(\w+)\s*\{$/;
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
 * (`class Animal`, `class Animal { ... }`, `Animal : +fly()`), and
 * relationship statements with their optional label and multiplicity —
 * into a `ClassDocument`. Never throws on malformed input: syntax problems
 * are reported as diagnostics, and a document containing an
 * error-severity one comes back as `null`.
 *
 * A class named only by a relationship is declared by that mention, the
 * way `parseFlowchart` declares a node named only by an edge. Repeat
 * declarations of one name are *not* folded together here — that, and
 * every other cross-statement question (relationship ids, endpoint
 * resolution, timeline resolution), is `buildClassModel`'s job.
 *
 * A header with nothing after it is a valid, empty diagram rather than an
 * error: Mermaid renders it as an empty canvas, and there is nothing
 * malformed to report.
 *
 * `%%` comments are already gone by the time this runs: `parseSiren`
 * strips them for every diagram kind before dispatching.
 *
 * Not yet recognized, and therefore reported as unrecognized lines:
 * annotations, generics, `namespace`, `note`, `direction`, the
 * interaction and styling directives, and the `timeline:` block. Those
 * arrive in later tickets on this board.
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
   * Records a class named by a relationship, the way `parseFlowchart`
   * records a node named by an edge: `Animal <|-- Duck` declares both
   * classes. Only the first mention creates one, so a class named by ten
   * relationships is still one declaration — and an id that already has a
   * declaration of its own is left alone.
   */
  const declareImplicitly = (id: string, line: number, column: number) => {
    if (declaredIds.has(id)) {
      return;
    }
    declaredIds.add(id);
    classes.push({ id, generic: null, annotation: null, members: [], line, column });
  };

  for (; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const lineNumber = index + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;

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
      declareImplicitly(from, lineNumber, column);
      declareImplicitly(to, lineNumber, column);
      continue;
    }

    const blockOpenMatch = CLASS_BLOCK_OPEN_RE.exec(line);
    if (blockOpenMatch !== null) {
      const members: ClassMember[] = [];
      let closed = false;
      let bodyIndex = index + 1;

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

      declaredIds.add(blockOpenMatch[1]);
      classes.push({
        id: blockOpenMatch[1],
        generic: null,
        annotation: null,
        members,
        line: lineNumber,
        column,
      });
      // The outer loop's `index++` steps past the `}` this stopped on, or
      // past the end of input when the block was never closed.
      index = bodyIndex;
      continue;
    }

    const classDeclMatch = CLASS_DECL_RE.exec(line);
    if (classDeclMatch !== null) {
      declaredIds.add(classDeclMatch[1]);
      classes.push({
        id: classDeclMatch[1],
        generic: null,
        annotation: null,
        members: [],
        line: lineNumber,
        column,
      });
      continue;
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
        continue;
      }
      // One declaration per line, carrying that line's single member.
      // Folding repeats of the same id together is `buildClassModel`'s job.
      declaredIds.add(id);
      classes.push({
        id,
        generic: null,
        annotation: null,
        members: [member],
        line: lineNumber,
        column,
      });
      continue;
    }

    diagnostics.push({
      severity: "error",
      message: `Unrecognized classDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: ClassDocument = {
    kind: "class",
    direction: "TB",
    classes,
    relationships,
    namespaces: [],
    notes: [],
    interactions: [],
    styles: [],
    timeline: null,
  };

  return { document, diagnostics };
}
