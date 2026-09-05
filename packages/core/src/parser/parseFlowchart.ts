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
import { listAcceptedHeaders, matchFlowchartHeader } from "./parseDirection";
import { isTimelineHeader, parseTimelineBody } from "./parseTimelineBlock";

const NODE_RE = /^(\w+)\s*\[([^\]]*)\]\s*$/;
const EDGE_RE =
  /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*(\w+)(?:\s*\[([^\]]*)\])?\s*$/;
const MALFORMED_EDGE_RE = /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*$/;

/**
 * `style A fill:#fdd,stroke:#c00` — author styling applied directly to one
 * node, spelled exactly as a class diagram spells it.
 *
 * Only `style` is recognized here. `classDef`, `class` and the `A:::name`
 * shorthand are still unrecognized lines, so an author who writes one is
 * told so rather than being silently ignored until they land.
 */
const STYLE_RE = /^style\s+(\w+)\s+(.+)$/;

/**
 * Splits a declaration list on the commas that separate declarations,
 * ignoring the ones inside a value's parentheses — so `fill:rgb(255, 0, 0)`
 * stays one declaration rather than three fragments, two of which have no
 * `:` and would be diagnosed as malformed.
 *
 * An unbalanced parenthesis is treated as a problem with that value, never
 * with the list: an unclosed `(` runs to the end of the list and a stray `)`
 * is ignored, so the declarations after it still separate normally.
 */
function splitDeclarations(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      segments.push(text.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(text.slice(start));
  return segments;
}

/**
 * Splits a `fill:#fdd,stroke:#c00` declaration list into its pairs,
 * preserving author order. Only the first `:` of a segment separates
 * property from value, so a value containing a colon survives intact.
 *
 * A segment with no `:` at all has no readable shape, so it is returned in
 * `malformed` for the caller to diagnose.
 *
 * The values themselves are not inspected here. Rejecting `url(` and
 * `expression(` is `resolveStyles`' job, and it is the only place that
 * judgement is made — ADR-0008 calls that gate the styling security
 * boundary, and a second opinion in a parser is how one boundary becomes
 * two that disagree.
 */
function parseStyleProperties(text: string): {
  properties: StyleProperty[];
  malformed: string[];
} {
  const properties: StyleProperty[] = [];
  const malformed: string[] = [];
  for (const segment of splitDeclarations(text)) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      malformed.push(trimmed);
      continue;
    }
    properties.push({
      property: trimmed.slice(0, separator).trim(),
      value: trimmed.slice(separator + 1).trim(),
    });
  }
  return { properties, malformed };
}

/**
 * Parses Siren flowchart source text (a `flowchart TB|BT|LR|RL` header, node/edge
 * declarations, and an optional `timeline:` block) into a
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
      const [, fromId, fromLabel, toId, toLabel] = edgeMatch;
      if (fromLabel !== undefined) {
        addNode(fromId, fromLabel, lineNumber, column);
      } else if (!nodesById.has(fromId)) {
        nodesById.set(fromId, { id: fromId, label: fromId, line: lineNumber, column });
      }
      if (toLabel !== undefined) {
        addNode(toId, toLabel, lineNumber, column);
      } else if (!nodesById.has(toId)) {
        nodesById.set(toId, { id: toId, label: toId, line: lineNumber, column });
      }
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

    const styleMatch = STYLE_RE.exec(line);
    if (styleMatch !== null) {
      const { properties, malformed } = parseStyleProperties(styleMatch[2]);
      for (const segment of malformed) {
        diagnostics.push({
          severity: "error",
          message: `Unrecognized style declaration: "${segment}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
      }
      // Naming a node in a `style` statement does not declare it: styling is
      // about something that already exists, and whether it does is
      // `resolveStyles`' question, asked once against the model's ids.
      //
      // `classIds` holds the one node this statement targets. It is a list
      // because the apply-directive targets many.
      styles.push({
        styleKind: "style",
        authoredAs: "style",
        classIds: [styleMatch[1]],
        name: null,
        properties,
        line: lineNumber,
        column,
      });
      continue;
    }

    const nodeMatch = NODE_RE.exec(line);
    if (nodeMatch !== null) {
      const [, id, label] = nodeMatch;
      addNode(id, label, lineNumber, column);
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
