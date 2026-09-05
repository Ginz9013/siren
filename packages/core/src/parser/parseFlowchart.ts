import type {
  Diagnostic,
  Direction,
  FlowchartDocument,
  ParseResult,
  SirenEdge,
  SirenNode,
  SirenTimeline,
} from "../contracts";
import { isTimelineHeader, parseTimelineLine } from "./parseTimelineBlock";

const FLOWCHART_HEADER_RE = /^flowchart\s+(TD|LR)\s*$/;
const NODE_RE = /^(\w+)\s*\[([^\]]*)\]\s*$/;
const EDGE_RE =
  /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*(\w+)(?:\s*\[([^\]]*)\])?\s*$/;
const MALFORMED_EDGE_RE = /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*$/;

/**
 * Parses Siren flowchart source text (a `flowchart TD|LR` header, node/edge
 * declarations, and an optional `timeline:` block) into a
 * `FlowchartDocument`. Never throws on malformed input — syntax problems
 * are reported as diagnostics instead.
 *
 * Extracted verbatim from what used to be `parseSiren`'s own body — zero
 * behavior change, only the `kind: "flowchart"` tag is new.
 *
 * The `timeline:` grammar itself is no longer here: it moved to
 * `parseTimelineBlock`, which the class parser calls too, so both kinds read
 * one vocabulary instead of two copies that drift. This function still owns
 * *where* the block starts and what a diagnostic inside it costs the
 * document; only the entry grammar is shared.
 */
export function parseFlowchart(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  const nodesById = new Map<string, SirenNode>();
  const edges: SirenEdge[] = [];
  let direction: Direction | null = null;
  let timeline: SirenTimeline | null = null;

  let mode: "before-header" | "flowchart" | "timeline" = "before-header";
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
      const headerMatch = FLOWCHART_HEADER_RE.exec(line);
      if (headerMatch === null) {
        diagnostics.push({
          severity: "error",
          message: `Expected "flowchart TD" or "flowchart LR", found "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        break;
      }
      direction = headerMatch[1] as Direction;
      mode = "flowchart";
      continue;
    }

    if (isTimelineHeader(line)) {
      mode = "timeline";
      timeline = timeline ?? { entries: [] };
      continue;
    }

    if (mode === "flowchart") {
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

    if (mode === "timeline") {
      const { entries, diagnostics: lineDiagnostics } = parseTimelineLine(
        line,
        lineNumber,
        column,
      );
      diagnostics.push(...lineDiagnostics);
      // Every diagnostic the shared grammar reports is error-severity, so a
      // non-empty list is exactly the old per-branch `sawError = true`.
      if (lineDiagnostics.length > 0) {
        sawError = true;
      }
      (timeline as SirenTimeline).entries.push(...entries);
      continue;
    }
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
    timeline,
  };

  return { document, diagnostics };
}
