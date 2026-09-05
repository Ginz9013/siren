import type {
  Diagnostic,
  Direction,
  FlowchartDocument,
  ParseResult,
  SirenEdge,
  SirenNode,
  SirenTimeline,
  StyleDecl,
} from "../contracts";
import { parseStyleProperties } from "./parseDeclarationList";
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
      // `targetIds` holds the one node this statement targets. It is a
      // list because the apply-directive targets many.
      styles.push({
        styleKind: "style",
        authoredAs: "style",
        targetIds: [styleMatch[1]],
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
