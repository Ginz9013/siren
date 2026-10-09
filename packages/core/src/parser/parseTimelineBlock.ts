import type {
  Diagnostic,
  EnterExitEffect,
  HighlightEffect,
  NamedTimeline,
  SirenTimeline,
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
 * The same argument covers the block's *body* — skip the blanks, number and
 * measure each line, hand it to the grammar, collect what comes back — which
 * had grown a copy in each of the three parsers. `parseTimelineBody` is that
 * loop, written once. What stays with each
 * parser is only what differs: where the block starts, and what a diagnostic
 * inside it costs that kind's document.
 */

// `timeline:` or `timeline <name>:`. The name is captured loosely — anything
// up to the colon that starts with neither a space nor a colon — so that a
// malformed name is still read as a header and reported as one, rather than
// falling through to the action grammar as a verb nobody recognizes.
const TIMELINE_HEADER_RE = /^timeline(?:\s+([^:\s][^:]*?))?\s*:\s*$/;
// What a well-formed name is. Narrow on purpose: a name is what a caller
// passes to select a block, so it should survive a URL, an attribute and a
// shell without quoting.
const TIMELINE_NAME_RE = /^[A-Za-z0-9_-]+$/;
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

/** Whether `line` (already trimmed) opens a timeline block, named or not. */
export function isTimelineHeader(line: string): boolean {
  return TIMELINE_HEADER_RE.test(line);
}

/** The name a header line declares, or `null` for the unnamed `timeline:`. */
function headerName(line: string): string | null {
  return TIMELINE_HEADER_RE.exec(line)?.[1] ?? null;
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
 * Parses one line inside a `timeline:` block — `enter Duck fade, highlight
 * Animal glow` — into the actions of step `step`.
 *
 * The line carries no step number of its own: ADR-0012 makes a line's step its
 * place in the block, which the caller counts. So the whole line is the action
 * list, and a retired `enter Duck fade` is simply an action nobody
 * recognizes.
 *
 * A malformed action costs itself and nothing else: the others on the same
 * line are still returned, alongside a diagnostic for the one that failed.
 *
 * Each action is split on whitespace and nothing else, so a target id may
 * contain a colon, which is what lets `enter namespace:1 fade` address the
 * ids `buildClassModel` assigns namespaces and notes.
 */
function parseTimelineLine(
  line: string,
  step: number,
  lineNumber: number,
  column: number,
): TimelineLineResult {
  const entries: TimelineEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  const actions = line.split(",").map((part) => part.trim());

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
 * Reads one timeline block's body — every line from `startIndex` up to the
 * next timeline header or the end of the document, whichever comes first. No
 * statement closes a block; only another block's header does.
 *
 * This is the half of the block every diagram kind repeats: a blank line
 * contributes nothing, and any other line is the next step (ADR-0012),
 * measured for its column and sent through the grammar above. A line counts
 * as a step whether or not its actions parse, so fixing a typo never
 * renumbers the lines after it.
 *
 * Line numbers come from each line's index in `lines`, so a caller hands over
 * the whole document and the index just past the block's header rather than
 * a slice it would then have to renumber.
 */
export function parseTimelineBody(
  lines: readonly string[],
  startIndex: number,
): TimelineLineResult {
  return readBody(lines, startIndex).result;
}

/** `parseTimelineBody`, plus the index it stopped at: the next header, or `lines.length`. */
function readBody(
  lines: readonly string[],
  startIndex: number,
): { result: TimelineLineResult; endIndex: number } {
  const entries: TimelineEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  let step = 0;

  let index = startIndex;
  for (; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (isTimelineHeader(line)) break;

    step++;
    const column = rawLine.length - rawLine.trimStart().length + 1;
    const lineResult = parseTimelineLine(line, step, index + 1, column);
    entries.push(...lineResult.entries);
    diagnostics.push(...lineResult.diagnostics);
  }

  return { result: { entries, diagnostics }, endIndex: index };
}

/**
 * Reported on the later of an unnamed and a named header, whichever order
 * they come in. The unnamed `timeline:` is shorthand for "this document's one
 * timeline", which stops being true the moment a second block exists — and
 * a name for the first block is the author's to choose, not ours to invent.
 */
const MIXED_HEADERS = {
  severity: "error",
  message:
    'An unnamed "timeline:" block cannot share a document with named ones; name every block, or declare only the unnamed one',
} as const;

/**
 * Every timeline block a document declares: the unnamed `timeline:` block, or
 * the named `timeline <name>:` blocks in the order written.
 */
export interface TimelineBlocks {
  /** The unnamed `timeline:` block, or `null` when the document has none. */
  timeline: SirenTimeline | null;
  /** The named blocks, in document order. */
  namedTimelines: NamedTimeline<SirenTimeline>[];
  /** Every problem in any block or header. All are error-severity. */
  diagnostics: Diagnostic[];
}

/**
 * Reads every timeline block from the first header (at `headerIndex`) to the
 * end of the document.
 *
 * The first header is the one-way switch out of the diagram body, so from
 * here on every line belongs to some block; each header simply ends the block
 * before it. Every block's steps count from 1, because each is a timeline in
 * its own right — a named block behaves exactly as it would if it were the
 * document's only one.
 */
export function parseTimelineBlocks(
  lines: readonly string[],
  headerIndex: number,
): TimelineBlocks {
  let timeline: SirenTimeline | null = null;
  const namedTimelines: NamedTimeline<SirenTimeline>[] = [];
  const diagnostics: Diagnostic[] = [];
  const headerLineByName = new Map<string, number>();

  let index = headerIndex;
  while (index < lines.length) {
    const rawHeader = lines[index];
    const name = headerName(rawHeader.trim());
    const headerAt = {
      line: index + 1,
      column: rawHeader.length - rawHeader.trimStart().length + 1,
    };
    const { result, endIndex } = readBody(lines, index + 1);

    const block: SirenTimeline = { entries: result.entries };
    if (name === null) {
      // ADR-0012 used to make a second `timeline:` an unrecognized action,
      // since nothing could close the first block. Now a header does close
      // one, so the second is a header in its own right — and the problem
      // with it is that "unnamed" only means "the one timeline", which a
      // document cannot have two of.
      if (namedTimelines.length > 0) {
        diagnostics.push({ ...MIXED_HEADERS, ...headerAt });
      } else if (timeline !== null) {
        diagnostics.push({
          severity: "error",
          message:
            'A document declares at most one unnamed "timeline:" block; name each block ("timeline <name>:") to declare several',
          ...headerAt,
        });
      }
      timeline = block;
    } else {
      const firstDeclaredOn = headerLineByName.get(name);
      if (!TIMELINE_NAME_RE.test(name)) {
        diagnostics.push({
          severity: "error",
          message: `Invalid timeline name "${name}" (a name is letters, digits, "_" and "-")`,
          ...headerAt,
        });
      } else if (timeline !== null) {
        diagnostics.push({ ...MIXED_HEADERS, ...headerAt });
      } else if (firstDeclaredOn !== undefined) {
        // The later header is the one reported: the earlier block was fine
        // until this one arrived, and naming the line it is on lets the
        // author decide which of the two to rename.
        diagnostics.push({
          severity: "error",
          message: `Timeline "${name}" is already declared on line ${firstDeclaredOn}`,
          ...headerAt,
        });
      } else {
        headerLineByName.set(name, headerAt.line);
      }
      namedTimelines.push({ name, timeline: block });
    }
    diagnostics.push(...result.diagnostics);
    index = endIndex;
  }

  return { timeline, namedTimelines, diagnostics };
}

/**
 * `{ namedTimelines }` when there are any, `{}` when there are none — spread
 * into a document or a model, so that one without named blocks carries
 * exactly the fields it always did. A document with one unnamed block is
 * then not merely rendered the same as before but *is* the same value, and
 * the field set each stage pins down only grows for a document that uses the
 * new form.
 */
export function namedTimelinesField<T>(
  namedTimelines: NamedTimeline<T>[],
): { namedTimelines?: NamedTimeline<T>[] } {
  return namedTimelines.length > 0 ? { namedTimelines } : {};
}
