import type {
  Diagnostic,
  Direction,
  FlowchartDocument,
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
 */
const NODE_RE = /^(\w+)\s*\[([^\]]*)\]\s*(?::::(\w+))?\s*$/;

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
 *
 * `linkStyle` is still an unrecognized line, so an author who writes one is
 * told so rather than being silently ignored until it lands.
 */
const CLASS_DEF_RE = /^classDef\s+(\w+)\s+(.+)$/;

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
 * Splits the `A,B` target list of an apply-directive, discarding the empty
 * segments a trailing or doubled comma leaves behind. Whether each id names
 * a node that exists is `resolveStyles`' question, asked once against the
 * model's ids — naming a node in a styling statement does not declare it.
 */
function splitTargetIds(text: string): string[] {
  return text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Parses Siren flowchart source text (a `flowchart TB|BT|LR|RL` header, node/edge
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
    timeline,
  };

  return { document, diagnostics };
}
