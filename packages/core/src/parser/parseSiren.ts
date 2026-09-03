import type {
  Diagnostic,
  Direction,
  EnterEffect,
  ParseResult,
  SirenDocument,
  SirenEdge,
  SirenNode,
  SirenTimeline,
  TimelineEntry,
} from "../contracts";

const FLOWCHART_HEADER_RE = /^flowchart\s+(TD|LR)\s*$/;
const TIMELINE_HEADER_RE = /^timeline:\s*$/;
const NODE_RE = /^(\w+)\s*\[([^\]]*)\]\s*$/;
const EDGE_RE =
  /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*(\w+)(?:\s*\[([^\]]*)\])?\s*$/;
const MALFORMED_EDGE_RE = /^(\w+)(?:\s*\[([^\]]*)\])?\s*-->\s*$/;
const TIMELINE_ENTRY_RE = /^step\s+(\d+):\s*(.+)$/;
const TIMELINE_ACTION_RE = /^enter\s+(\S+)\s+(\S+)$/;

const KNOWN_EFFECTS: ReadonlySet<string> = new Set<EnterEffect>(["fade"]);

/**
 * Parses Siren source text (a `flowchart TD|LR` header, node/edge
 * declarations, and an optional `timeline:` block) into a `SirenDocument`.
 * Never throws on malformed input — syntax problems are reported as
 * diagnostics instead.
 */
export function parseSiren(source: string): ParseResult {
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

    if (TIMELINE_HEADER_RE.test(line)) {
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
      const entryMatch = TIMELINE_ENTRY_RE.exec(line);
      if (entryMatch === null) {
        diagnostics.push({
          severity: "error",
          message: `Unrecognized timeline line: "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        continue;
      }

      const step = Number.parseInt(entryMatch[1], 10);
      const actions = entryMatch[2].split(",").map((part) => part.trim());
      for (const action of actions) {
        const actionMatch = TIMELINE_ACTION_RE.exec(action);
        if (actionMatch === null) {
          diagnostics.push({
            severity: "error",
            message: `Unrecognized timeline action: "${action}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }
        const [, targetId, effect] = actionMatch;
        if (!KNOWN_EFFECTS.has(effect)) {
          diagnostics.push({
            severity: "error",
            message: `Unknown enter effect "${effect}" (only "fade" is supported)`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }
        const entry: TimelineEntry = {
          step,
          targetId,
          effect: effect as EnterEffect,
          line: lineNumber,
          column,
        };
        (timeline as SirenTimeline).entries.push(entry);
      }
      continue;
    }
  }

  if (mode === "before-header" || direction === null) {
    return { document: null, diagnostics };
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: SirenDocument = {
    direction,
    nodes: Array.from(nodesById.values()),
    edges,
    timeline,
  };

  return { document, diagnostics };
}
