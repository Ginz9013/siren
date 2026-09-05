import type {
  Diagnostic,
  Direction,
  FlowchartDocument,
  LinkStyleDecl,
  ParseResult,
  SirenEdge,
  SirenNode,
  SirenTimeline,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { parseStyleProperties } from "./parseDeclarationList";
import { listAcceptedHeaders, matchFlowchartHeader } from "./parseDirection";
import { isTimelineHeader, parseTimelineBody } from "./parseTimelineBlock";

/**
 * A node declaration, with the optional `:::name` shorthand that applies a
 * `classDef` at the declaration itself. `A[Start]:::emphasis`.
 *
 * `[^\]]*` still reads the label loosely, but it no longer gets first
 * refusal on the line: `UNIMPLEMENTED_BRACKET_FORMS` is asked first, and
 * everything it names never reaches here. Widening this pattern without
 * reading that one re-opens the bug that comment exists to close.
 */
const NODE_RE = /^(\w+)\s*\[([^\]]*)\]\s*(?::::(\w+))?\s*$/;

/**
 * Everything Mermaid writes *inside* `[...]` that is not a plain label — six
 * node shapes and two label forms — paired with the name Mermaid gives it.
 *
 * **This list is refused, not swallowed.** That is the policy, and it is the
 * whole reason this constant exists: while a construct is unimplemented,
 * reject it — never render something else in its place. `NODE_RE`'s
 * `[^\]]*` used to take any bracket content as a label, so `A[(DB)]` drew a
 * rectangle labelled `(DB)` and said nothing. That disguised *not
 * implemented* as *supported*, and it hid the gap from
 * `src/compat/corpus.ts` — the instrument built to measure exactly this. A
 * mislabelled rectangle is a worse answer than a refusal, because the author
 * never learns anything is missing.
 *
 * None of these is a permanent refusal. The shapes arrive on their own
 * board and quoting on this one, and each `described` is written for the
 * author who will read it: it names the shape Mermaid means, so the answer
 * is "wait" rather than "rewrite your line". Whoever implements one deletes
 * its row here.
 *
 * Every form is anchored at **both ends** of the bracket content on purpose.
 * An over-tight pattern would be its own compatibility bug, traded for the
 * one it fixed: `A[a/b]`, `A[x (y)]`, `A[100%]` and `A[say "hi" now]` are
 * ordinary labels that merely *contain* a character a form also opens with,
 * and they still draw as rectangles.
 */
const UNIMPLEMENTED_BRACKET_FORMS: ReadonlyArray<{
  open: string;
  close: string;
  described: string;
}> = [
  { open: "(", close: ")", described: "a cylinder (`A[(text)]`)" },
  { open: "[", close: "]", described: "a subroutine box (`A[[text]]`)" },
  { open: "/", close: "/", described: "a parallelogram (`A[/text/]`)" },
  { open: "\\", close: "\\", described: "a parallelogram alt (`A[\\text\\]`)" },
  { open: "/", close: "\\", described: "a trapezoid (`A[/text\\]`)" },
  { open: "\\", close: "/", described: "a trapezoid alt (`A[\\text/]`)" },
  // Before the plain quoted label, because it is the same fence with
  // backticks inside it: the list is read most specific first, so an
  // author who wrote Markdown is told about Markdown.
  {
    open: '"`',
    close: '`"',
    described: "a Markdown string label (a quoted label fenced in backticks)",
  },
  { open: '"', close: '"', described: 'a quoted label (`A["text"]`)' },
];

/**
 * What Mermaid means by this bracket content, when it means something Siren
 * does not draw yet — as the prose a diagnostic quotes. `null` when the
 * content is an ordinary label, which is the common case.
 *
 * The length test is what keeps the fences from overlapping themselves:
 * `A[/]` is a label reading `/`, not an empty parallelogram.
 */
function unimplementedFormIn(content: string): string | null {
  for (const form of UNIMPLEMENTED_BRACKET_FORMS) {
    if (
      content.length >= form.open.length + form.close.length &&
      content.startsWith(form.open) &&
      content.endsWith(form.close)
    ) {
      return form.described;
    }
  }
  return null;
}

/**
 * A node written with brackets, read **greedily**: the content is whatever
 * lies between the first `[` and the last `]`.
 *
 * It accepts nothing — `NODE_RE` still decides what a node declaration is.
 * This pattern exists only to ask what the author meant, which needs the
 * greedy read `NODE_RE` deliberately does not have: `A[[Subroutine]]` is
 * invisible to `[^\]]*`, so without this it would fall all the way through
 * to "unrecognized line", and an author who wrote a subroutine box deserves
 * to be told Siren does not draw one yet.
 */
const BRACKET_FORM_RE = /^\w+\s*\[(.*)\]\s*(?::::\w+)?\s*$/;

/**
 * The bare `A:::emphasis` shorthand — the same application written without a
 * label. It stays a pattern of its own so that a bare `A` on a line by
 * itself keeps being an unrecognized line rather than silently declaring a
 * node: what makes this a declaration is the `:::`.
 */
const NODE_CLASS_RE = /^(\w+)\s*:::(\w+)\s*$/;

/**
 * `A[Start] --> B[End]`, with each endpoint free to carry the same
 * `[label]` and `:::name` an endpoint written on a line of its own may
 * carry — the shorthand works wherever a node can be written, as it does in
 * Mermaid, rather than only at a standalone declaration.
 *
 * Anchored at both ends, so a chained `A --> B --> C` stays an
 * unrecognized line: chaining is a separate compatibility gap, and reading
 * the first two nodes of three while dropping the rest would be a wrong
 * answer where there is currently an honest refusal.
 */
const EDGE_RE =
  /^(\w+)(?:\s*\[([^\]]*)\])?(?:\s*:::(\w+))?\s*-->\s*(\w+)(?:\s*\[([^\]]*)\])?(?:\s*:::(\w+))?\s*$/;
const MALFORMED_EDGE_RE = /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*$/;

/**
 * `style A fill:#fdd,stroke:#c00` — author styling applied directly to one
 * node, spelled exactly as a class diagram spells it.
 */
const STYLE_RE = /^style\s+(\w+)\s+(.+)$/;

/**
 * `classDef emphasis fill:#fdd` — a named set of declarations, applied to
 * nothing on its own, spelled exactly as a class diagram spells it.
 */
const CLASS_DEF_RE = /^classDef\s+(\w+)\s+(.+)$/;

/**
 * `linkStyle 0 stroke:#f00` — the one styling statement that reaches an
 * edge, which `style` cannot: Mermaid addresses an edge by its declaration
 * index rather than by a name the author chose.
 *
 * The addresses are captured as written and left that way. Turning `0` into
 * the edge id `A-B` is `buildFlowchartModel`'s job, since only the model
 * knows which edges exist and what they are called — so this pattern is
 * deliberately incurious about whether an address is a number at all.
 *
 * The address list is greedy and backtracks the same way `CLASS_APPLY_RE`'s
 * does, which is what lets one pattern read `linkStyle 0`, `linkStyle 0,2`
 * and `linkStyle default` without three: `[\w,\s]` cannot cross the first
 * `:` of the declarations, so it gives back everything up to the space that
 * separates the two halves.
 */
const LINK_STYLE_RE = /^linkStyle\s+([\w,\s]*[\w,])\s+(.+)$/;

/**
 * `class A,B emphasis` — this kind's spelling of the apply-directive, which
 * a class diagram spells `cssClass "A,B" emphasis`. Both normalize to the
 * one `apply` kind here, so no model, renderer or test downstream learns
 * that two spellings exist.
 *
 * The target list is greedy up to the trailing name: `[\w\s,]` swallows the
 * whole tail and backtracks until a bare `\w+` is left for the definition
 * name, which is what lets `class A, B emphasis` be read the same as
 * `class A,B emphasis` without a second pattern.
 */
const CLASS_APPLY_RE = /^class\s+([\w\s,]*[\w,])\s+(\w+)\s*$/;

/**
 * Splits the comma-separated target list an apply-directive (`class A,B
 * name`) and a `linkStyle 0,2` both write, discarding the empty segments a
 * trailing or doubled comma leaves behind.
 *
 * It answers nothing about what the segments *are*. Whether an id names a
 * node is `resolveStyles`' question, asked once against the model's ids;
 * whether an address names an edge is `buildFlowchartModel`'s. Naming
 * something in a styling statement does not declare it, in either spelling.
 */
function splitTargetIds(text: string): string[] {
  return text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Parses Siren flowchart source text (a `flowchart TB|BT|LR|RL` header — or
 * `graph`, Mermaid's original spelling of the same word — node/edge
 * declarations, author styling statements, and an optional `timeline:` block) into a
 * `FlowchartDocument`. Never throws on malformed input — syntax problems
 * are reported as diagnostics instead.
 *
 * The `timeline:` block itself is no longer parsed here: its grammar and its
 * body drain both live in `parseTimelineBlock`, which all three diagram kinds
 * call, so they read one vocabulary instead of copies that drift. This
 * function still owns *where* the block starts and what a diagnostic inside
 * it costs the document, and nothing else about it.
 */
export function parseFlowchart(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  const nodesById = new Map<string, SirenNode>();
  const edges: SirenEdge[] = [];
  const styles: StyleDecl[] = [];
  const linkStyles: LinkStyleDecl[] = [];
  let direction: Direction | null = null;
  let timeline: SirenTimeline | null = null;

  let mode: "before-header" | "flowchart" = "before-header";
  let sawError = false;

  /**
   * Reads the declaration list of a `style`/`classDef` statement, turning
   * each segment that is not a `property:value` pair into an error
   * diagnostic on that statement's line. The split itself is
   * `parseStyleProperties`' — shared with the class diagram — because every
   * kind's styling statements read one declaration list; only where the
   * diagnostic lands is this parser's to know.
   */
  const readStyleProperties = (
    text: string,
    lineNumber: number,
    column: number,
  ): StyleProperty[] => {
    const { properties, malformed } = parseStyleProperties(text);
    for (const segment of malformed) {
      diagnostics.push({
        severity: "error",
        message: `Unrecognized style declaration: "${segment}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
    }
    return properties;
  };

  /**
   * Records the `:::name` shorthand as what it is: the apply-directive,
   * written at the declaration instead of on a line of its own. It produces
   * the same statement `class A name` produces, so nothing downstream — the
   * shared resolver included — learns that the shorthand exists.
   *
   * `authoredAs` is `:::` rather than `class` because it is what a
   * diagnostic may quote, and an author who wrote `A:::ghost` never wrote
   * the word `class`.
   */
  const applyAtDeclaration = (
    id: string,
    definitionName: string,
    line: number,
    column: number,
  ) => {
    styles.push({
      styleKind: "apply",
      authoredAs: ":::",
      targetIds: [id],
      name: definitionName,
      properties: [],
      line,
      column,
    });
  };

  /**
   * Refuses one place a node was written, when what was written there is a
   * bracket form Siren does not draw yet — naming which one. `true` when the
   * line was refused, so the caller stops reading it.
   *
   * Shared by the two places a label can appear, for the reason
   * `addNodeAsWritten` is shared: where a node was written must not decide
   * what it means, so `A[(DB)] --> B` cannot quietly draw the cylinder that
   * `A[(DB)]` on a line of its own refuses.
   */
  const refuseUnimplementedForm = (
    content: string | undefined,
    line: string,
    lineNumber: number,
    column: number,
  ): boolean => {
    const form = content === undefined ? null : unimplementedFormIn(content);
    if (form === null) {
      return false;
    }
    diagnostics.push({
      severity: "error",
      message: `Siren does not draw ${form} yet: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
    return true;
  };

  const addNode = (id: string, label: string, line: number, column: number) => {
    const existing = nodesById.get(id);
    if (existing === undefined) {
      nodesById.set(id, { id, label, line, column });
      return;
    }
    if (existing.label !== label) {
      diagnostics.push({
        severity: "warning",
        message: `Node "${id}" redeclared with a different label ("${existing.label}" kept, "${label}" ignored)`,
        line,
        column,
      });
    }
  };

  /**
   * Reads one place a node was written — a line of its own or either end of
   * an edge — with whatever it was written with there.
   *
   * The three spellings differ only in what they hand this function, which
   * is why they share it: the shorthand works wherever a node can be
   * written, so where it was written must not be what decides what it does.
   *
   * The label and the definition are independent. A label declares, so a
   * labelled mention goes through `addNode` and can raise the redeclaration
   * warning; an unlabelled one only applies, so it declares the node just
   * when nothing else has and leaves a label written elsewhere for that id
   * alone. That second rule is ticket 04's, for the standalone `A:::name`,
   * and an edge's bare endpoint has always followed it — they are one rule
   * written once here rather than two copies free to drift.
   */
  const addNodeAsWritten = (
    id: string,
    label: string | undefined,
    definitionName: string | undefined,
    line: number,
    column: number,
  ) => {
    if (label !== undefined) {
      addNode(id, label, line, column);
    } else if (!nodesById.has(id)) {
      nodesById.set(id, { id, label: id, line, column });
    }
    if (definitionName !== undefined) {
      applyAtDeclaration(id, definitionName, line, column);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNumber = i + 1;
    const line = rawLine.trim();
    const column = rawLine.length - rawLine.trimStart().length + 1;

    if (line.length === 0) {
      continue;
    }

    if (mode === "before-header") {
      const headerDirection = matchFlowchartHeader(line);
      if (headerDirection === null) {
        diagnostics.push({
          severity: "error",
          message: `Expected ${listAcceptedHeaders()}, found "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        break;
      }
      direction = headerDirection;
      mode = "flowchart";
      continue;
    }

    if (isTimelineHeader(line)) {
      // Once the block is open it runs to the end of the document, so the
      // header is read once and never looked for again — a second
      // `timeline:` is a line inside the block, which the shared grammar
      // reports as unrecognized exactly as it does for the other two kinds.
      // Draining is `parseTimelineBody`'s job; what stays here is only this
      // parser's own decision: where the block starts, and that a diagnostic
      // inside it costs the whole document.
      const { entries, diagnostics: bodyDiagnostics } = parseTimelineBody(
        lines,
        i + 1,
      );
      diagnostics.push(...bodyDiagnostics);
      // Every diagnostic the shared grammar reports is error-severity, so a
      // non-empty list is exactly the old per-branch `sawError = true`.
      if (bodyDiagnostics.length > 0) {
        sawError = true;
      }
      timeline = { entries };
      break;
    }

    const edgeMatch = EDGE_RE.exec(line);
    if (edgeMatch !== null) {
      const [, fromId, fromLabel, fromDefinition, toId, toLabel, toDefinition] =
        edgeMatch;
      if (
        refuseUnimplementedForm(fromLabel, line, lineNumber, column) ||
        refuseUnimplementedForm(toLabel, line, lineNumber, column)
      ) {
        continue;
      }
      addNodeAsWritten(fromId, fromLabel, fromDefinition, lineNumber, column);
      addNodeAsWritten(toId, toLabel, toDefinition, lineNumber, column);
      edges.push({ from: fromId, to: toId, line: lineNumber, column });
      continue;
    }

    const malformedEdgeMatch = MALFORMED_EDGE_RE.exec(line);
    if (malformedEdgeMatch !== null) {
      diagnostics.push({
        severity: "error",
        message: `Malformed edge: missing target after "-->" in "${line}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
      continue;
    }

    const classDefMatch = CLASS_DEF_RE.exec(line);
    if (classDefMatch !== null) {
      // A definition targets nothing: which nodes end up with it is decided
      // by whoever applies it, in `resolveStyles`' own pass. Checked before
      // `style` and before a node declaration only because it is the more
      // specific keyword, not because the order can matter.
      styles.push({
        styleKind: "classDef",
        authoredAs: "classDef",
        targetIds: [],
        name: classDefMatch[1],
        properties: readStyleProperties(classDefMatch[2], lineNumber, column),
        line: lineNumber,
        column,
      });
      continue;
    }

    const classApplyMatch = CLASS_APPLY_RE.exec(line);
    if (classApplyMatch !== null) {
      styles.push({
        styleKind: "apply",
        authoredAs: "class",
        targetIds: splitTargetIds(classApplyMatch[1]),
        name: classApplyMatch[2],
        properties: [],
        line: lineNumber,
        column,
      });
      continue;
    }

    const linkStyleMatch = LINK_STYLE_RE.exec(line);
    if (linkStyleMatch !== null) {
      // The address goes through untouched — see `LINK_STYLE_RE`. The
      // declarations do not: they are read by the same splitter `style` and
      // `classDef` use, so all three statements accept one declaration list
      // and diagnose a bad segment in one wording.
      linkStyles.push({
        targets: splitTargetIds(linkStyleMatch[1]),
        properties: readStyleProperties(linkStyleMatch[2], lineNumber, column),
        line: lineNumber,
        column,
      });
      continue;
    }

    const styleMatch = STYLE_RE.exec(line);
    if (styleMatch !== null) {
      // Naming a node in a `style` statement does not declare it: styling is
      // about something that already exists, and whether it does is
      // `resolveStyles`' question, asked once against the model's ids.
      //
      // `targetIds` holds the one node this statement targets. It is a
      // list because the apply-directive targets many.
      styles.push({
        styleKind: "style",
        authoredAs: "style",
        targetIds: [styleMatch[1]],
        name: null,
        properties: readStyleProperties(styleMatch[2], lineNumber, column),
        line: lineNumber,
        column,
      });
      continue;
    }

    const bracketFormMatch = BRACKET_FORM_RE.exec(line);
    if (bracketFormMatch !== null) {
      // Asked before `NODE_RE`, because `NODE_RE` would take the form's own
      // punctuation as a label — which is the swallow this refuses.
      if (
        refuseUnimplementedForm(
          bracketFormMatch[1],
          line,
          lineNumber,
          column,
        )
      ) {
        continue;
      }
    }

    const nodeMatch = NODE_RE.exec(line);
    if (nodeMatch !== null) {
      const [, id, label, definitionName] = nodeMatch;
      addNodeAsWritten(id, label, definitionName, lineNumber, column);
      continue;
    }

    const nodeClassMatch = NODE_CLASS_RE.exec(line);
    if (nodeClassMatch !== null) {
      const [, id, definitionName] = nodeClassMatch;
      // Written without a label, so it applies a definition and claims no
      // label — `addNodeAsWritten` holds what that means, for this spelling
      // and for an edge's bare endpoint alike.
      addNodeAsWritten(id, undefined, definitionName, lineNumber, column);
      continue;
    }

    diagnostics.push({
      severity: "error",
      message: `Unrecognized flowchart line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
    continue;
  }

  if (mode === "before-header" || direction === null) {
    return { document: null, diagnostics };
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: FlowchartDocument = {
    kind: "flowchart",
    direction,
    nodes: Array.from(nodesById.values()),
    edges,
    styles,
    linkStyles,
    timeline,
  };

  return { document, diagnostics };
}
