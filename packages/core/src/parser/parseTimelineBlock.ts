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

/** What one line inside a `timeline:` block contributed. */
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
export function parseTimelineLine(
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
