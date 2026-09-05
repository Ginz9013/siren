import type {
  Diagnostic,
  EnterExitEffect,
  HighlightEffect,
  TimelineActionKind,
  TimelineEntry,
} from "../contracts";

/**
 * The `timeline:` grammar, owned once and shared by every diagram kind that
 * animates.
 *
 * ADR-0002 puts the timeline in a block of its own, deliberately separate
 * from the diagram's structural definition — which is exactly what makes the
 * grammar shareable: the block's contents name ids and verbs and know nothing
 * about the statements above it. So a second diagram kind gains animation by
 * calling this, not by growing a second copy of the grammar that drifts from
 * the first one verb at a time.
 *
 * Lifted verbatim out of `parseFlowchart`, which now calls it: no behavior
 * change for flowcharts, and the class parser gets the identical vocabulary
 * rather than an approximation of it.
 *
 * The same argument covers the block's *body* — skip the blanks, measure each
 * line's column, hand it to the grammar, collect what comes back — which had
 * grown a copy in each of the three parsers. `parseTimelineBody` and
 * `parseTimelineBodyLine` are that loop, written once. What stays with each
 * parser is only what differs: where the block starts, and what a diagnostic
 * inside it costs that kind's document.
 */

const TIMELINE_HEADER_RE = /^timeline:\s*$/;
const TIMELINE_ENTRY_RE = /^step\s+(\d+):\s*(.+)$/;
// A verb, a target id, and an optional trailing effect token (unhighlight
// takes none; every other verb requires one — validated below, not here).
const TIMELINE_ACTION_RE = /^(\S+)\s+(\S+)(?:\s+(\S+))?$/;

const ENTER_EXIT_EFFECTS = new Set<EnterExitEffect>([
  "fade",
  "slide-left",
  "slide-right",
  "slide-top",
  "slide-bottom",
]);

const EFFECTS_BY_KIND: Readonly<
  Partial<Record<string, ReadonlySet<string> | null>>
> = {
  enter: ENTER_EXIT_EFFECTS,
  exit: ENTER_EXIT_EFFECTS,
  highlight: new Set<HighlightEffect>(["outline", "glow"]),
  unhighlight: null,
};

/** Whether `line` (already trimmed) opens the timeline block. */
export function isTimelineHeader(line: string): boolean {
  return TIMELINE_HEADER_RE.test(line);
}

/** What one line — or a whole body — inside a `timeline:` block contributed. */
export interface TimelineLineResult {
  /** The actions that line declared, in written order. */
  entries: TimelineEntry[];
  /**
   * Every problem found on that line. All are error-severity, so a caller
   * that returns no document when it saw an error can simply ask whether
   * this list is empty.
   */
  diagnostics: Diagnostic[];
}

/**
 * Parses one line inside a `timeline:` block — `step 2: enter Duck fade,
 * highlight Animal glow` — into its actions.
 *
 * A malformed action costs itself and nothing else: the others on the same
 * line are still returned, alongside a diagnostic for the one that failed.
 *
 * The step's own `:` is the only one the grammar consumes; what follows is
 * split on whitespace. A target id may therefore contain a colon of its own,
 * which is what lets `step 1: enter namespace:1 fade` address the ids
 * `buildClassModel` assigns namespaces and notes.
 */
function parseTimelineLine(
  line: string,
  lineNumber: number,
  column: number,
): TimelineLineResult {
  const entries: TimelineEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  const entryMatch = TIMELINE_ENTRY_RE.exec(line);
  if (entryMatch === null) {
    diagnostics.push({
      severity: "error",
      message: `Unrecognized timeline line: "${line}"`,
      line: lineNumber,
      column,
    });
    return { entries, diagnostics };
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
      continue;
    }

    const [, verb, targetId, effect] = actionMatch;
    const allowedEffects = EFFECTS_BY_KIND[verb];
    if (allowedEffects === undefined) {
      diagnostics.push({
        severity: "error",
        message: `Unrecognized timeline verb "${verb}" (expected "enter", "exit", "highlight", or "unhighlight")`,
        line: lineNumber,
        column,
      });
      continue;
    }
    const kind = verb as TimelineActionKind;

    if (allowedEffects === null) {
      if (effect !== undefined) {
        diagnostics.push({
          severity: "error",
          message: `"unhighlight" takes no effect, found trailing "${effect}" in "${action}"`,
          line: lineNumber,
          column,
        });
        continue;
      }
      entries.push({ kind, step, targetId, line: lineNumber, column });
      continue;
    }

    if (effect === undefined || !allowedEffects.has(effect)) {
      diagnostics.push({
        severity: "error",
        message: `Unknown ${kind} effect "${effect ?? ""}" (expected one of: ${[...allowedEffects].join(", ")})`,
        line: lineNumber,
        column,
      });
      continue;
    }

    entries.push({
      kind,
      step,
      targetId,
      effect: effect as EnterExitEffect | HighlightEffect,
      line: lineNumber,
      column,
    });
  }

  return { entries, diagnostics };
}

/**
 * Parses one raw line of a `timeline:` block's body — indentation and all.
 *
 * This is the half of the block every diagram kind repeats: a blank line
 * contributes nothing, and any other line is measured for its column and sent
 * through the grammar above. A caller keeps only the decision that is its own
 * — where the block starts, and what a diagnostic inside it costs the
 * document.
 */
export function parseTimelineBodyLine(
  rawLine: string,
  lineNumber: number,
): TimelineLineResult {
  const line = rawLine.trim();
  if (line.length === 0) {
    return { entries: [], diagnostics: [] };
  }
  const column = rawLine.length - rawLine.trimStart().length + 1;
  return parseTimelineLine(line, lineNumber, column);
}

/**
 * Drains a `timeline:` block's body — every line from `startIndex` to the end
 * of the document, since the block is a one-way switch that no statement can
 * close.
 *
 * Line numbers come from each line's index in `lines`, so a caller hands over
 * the whole document and the index just past its `timeline:` header rather
 * than a slice it would then have to renumber.
 */
export function parseTimelineBody(
  lines: readonly string[],
  startIndex: number,
): TimelineLineResult {
  const entries: TimelineEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  for (let index = startIndex; index < lines.length; index++) {
    const lineResult = parseTimelineBodyLine(lines[index], index + 1);
    entries.push(...lineResult.entries);
    diagnostics.push(...lineResult.diagnostics);
  }

  return { entries, diagnostics };
}
