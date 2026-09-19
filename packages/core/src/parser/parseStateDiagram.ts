import type {
  Diagnostic,
  ParseResult,
  StateDecl,
  StateDocument,
  StateTransition,
} from "../contracts";
import { listAcceptedHeaders, matchDiagramHeader } from "./parseDirection";

/**
 * The headers this parser accepts, asked for by kind rather than written out
 * — both spellings, from the one list the dispatcher routes by.
 */
const STATE_HEADER_SPELLINGS = listAcceptedHeaders(["state"]);

/**
 * A transition statement: two state ids either side of `-->`, with an
 * optional `: label` after the target.
 *
 * The ids are `\w+`, the alphabet every other Siren parser reads an id in.
 * That is deliberately narrower than Mermaid's, and it is what keeps
 * `[*] --> Idle` *out* of this pattern: the start/end pseudo-state is a
 * later ticket's, and a regex loose enough to match it here would declare a
 * state literally named `[*]` — a silent mis-render rather than the refusal
 * the policy asks for.
 */
const TRANSITION_RE = /^(\w+)\s*-->\s*(\w+)\s*(?::\s*(.*))?$/;

/**
 * A state written on a line of its own — `Idle`, or `state Idle` with
 * Mermaid's optional keyword in front of it. Measured: both put a state into
 * Mermaid's state table on their own, so a state nothing points at still
 * draws.
 *
 * Read *after* the transition pattern, so neither half of `A --> B` is ever
 * mistaken for one of these.
 */
const STATE_DECL_RE = /^(?:state\s+)?(\w+)$/;

/**
 * The constructs this parser can read but deliberately does not draw yet,
 * each with the name its diagnostic calls it by.
 *
 * This is CONTEXT.md's opening policy made executable: while a construct is
 * unimplemented Siren refuses it rather than drawing it wrongly, and it
 * refuses it *by name* so an author knows what to route around instead of
 * hunting a typo. Without these, two of them would not even be honest
 * refusals — `[*] --> Still` is arrow-shaped and `Idle : waiting` is
 * colon-shaped, and a looser reading of either would put a state called
 * `[*]`, or a transition to nowhere, into the picture with no diagnostic.
 *
 * Every row here is a later ticket on the same board: the pseudo-state, the
 * description forms and the composite block. They are matched *after* the
 * transition and the declaration, so nothing this parser does implement can
 * be caught by one of them.
 */
const UNIMPLEMENTED_CONSTRUCTS: readonly { name: string; pattern: RegExp }[] = [
  { name: "start/end pseudo-state `[*]`", pattern: /(^|\s)\[\*\]($|\s)/ },
  { name: "composite state", pattern: /^state\s+.*\{\s*$/ },
  // A description is the colon form with no arrow in front of it — an
  // arrowed line has already been read as a transition by the time this
  // runs — and the `state "text" as id` spelling of the same thing.
  { name: "state description", pattern: /^\w+\s*:/ },
  { name: "state description", pattern: /^state\s+".*"\s+as\s+\w+$/ },
];

/**
 * Parses Siren state-diagram source text — a `stateDiagram` (or
 * `stateDiagram-v2`) header — into a `StateDocument`. Never throws on
 * malformed input: syntax problems are reported as diagnostics, and a
 * document containing an error-severity one comes back as `null`.
 *
 * A header with nothing after it is a valid, empty diagram rather than an
 * error, the same answer `parseClassDiagram` gives: Mermaid renders it as an
 * empty canvas, and there is nothing malformed to report.
 *
 * A state named only by a transition is declared by that mention, the way
 * `parseFlowchart` declares a node named only by an edge. Repeat mentions of
 * one id are folded here rather than in the model, because a state carries
 * no payload for a later stage to reconcile: it is a name and a position.
 *
 * `%%` comments are already gone by the time this runs: `parseSiren` strips
 * them for every diagram kind before dispatching.
 */
export function parseStateDiagram(source: string): ParseResult {
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
  if (matchDiagramHeader(headerLine) !== "state") {
    diagnostics.push({
      severity: "error",
      message: `Expected ${STATE_HEADER_SPELLINGS}, found "${headerLine}"`,
      line: index + 1,
      column: headerRawLine.length - headerRawLine.trimStart().length + 1,
    });
    return { document: null, diagnostics };
  }

  index++;

  const states: StateDecl[] = [];
  const transitions: StateTransition[] = [];
  /** Every state id seen so far, however it was introduced. */
  const declaredIds = new Set<string>();
  /**
   * Whether any error-severity problem was found. Like every other Siren
   * parser, a document with one comes back as `null`: the diagnostics say
   * what is wrong, and no half-parsed document reaches the next stage.
   */
  let sawError = false;

  /**
   * Records a state the given statement named. Only the first mention
   * creates a declaration, so a state named by ten transitions is still one
   * state, positioned where it was first written.
   */
  const declareState = (id: string, line: number, column: number): void => {
    if (declaredIds.has(id)) {
      return;
    }
    declaredIds.add(id);
    states.push({ id, line, column });
  };

  for (; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const lineNumber = index + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;

    const transitionMatch = TRANSITION_RE.exec(line);
    if (transitionMatch !== null) {
      const [, from, to, label] = transitionMatch;
      declareState(from, lineNumber, column);
      declareState(to, lineNumber, column);
      transitions.push({
        from,
        to,
        // No label means `null`, and so does a `:` with nothing after it —
        // see `StateTransition.label`.
        label: label === undefined || label.trim().length === 0 ? null : label.trim(),
        sourceLine: lineNumber,
        sourceColumn: column,
      });
      continue;
    }

    const stateMatch = STATE_DECL_RE.exec(line);
    if (stateMatch !== null) {
      declareState(stateMatch[1], lineNumber, column);
      continue;
    }

    const unimplemented = UNIMPLEMENTED_CONSTRUCTS.find(({ pattern }) => pattern.test(line));
    if (unimplemented !== undefined) {
      diagnostics.push({
        severity: "error",
        message: `Siren does not draw the state diagram's ${unimplemented.name} yet: "${line}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
      continue;
    }

    diagnostics.push({
      severity: "error",
      message: `Unrecognized stateDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: StateDocument = { kind: "state", states, transitions };

  return { document, diagnostics };
}
