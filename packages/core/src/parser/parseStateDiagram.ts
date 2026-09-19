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
 * A transition statement: two endpoints either side of `-->`, with an
 * optional `: label` after the target.
 *
 * An endpoint is either an authored id — `\w+`, the alphabet every other
 * Siren parser reads an id in, and deliberately narrower than Mermaid's —
 * or the literal `[*]`, which names no state at all but the level's start
 * or end pseudo-state. The two spellings are alternatives inside one group
 * rather than a looser `.+`, so nothing else bracket-shaped is read as an
 * endpoint and a state literally named `[*]` stays unconstructible.
 */
const TRANSITION_RE = /^(\w+|\[\*\])\s*-->\s*(\w+|\[\*\])\s*(?::\s*(.*))?$/;

/** The one spelling of a pseudo-state endpoint, as an author writes it. */
const PSEUDO_STATE = "[*]";

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
 * A description written onto a state — `Idle : waiting for work`.
 *
 * Read *after* the transition pattern, so the `: label` half of
 * `A --> B : text` is never mistaken for one: what makes this a description
 * rather than a transition label is that no arrow precedes the colon.
 *
 * The text is whatever follows the colon, and the line has already been
 * trimmed, so the capture is the trimmed description Mermaid records
 * (measured: `Trim :    padded   ` reports `descriptions=["padded"]`).
 * `\S` at its head makes a description of nothing unmatchable, because
 * `Empty :` is a **parse error in Mermaid** (measured, 11.17.2) rather than
 * an empty description — so it falls through to this parser's own
 * unrecognized-line diagnostic instead of entering a state table.
 */
const STATE_DESCRIPTION_RE = /^(\w+)\s*:\s*(\S.*)$/;

/**
 * The other spelling of the very same thing — `state "waiting" as Idle`.
 *
 * **Not a rename**, which is the reading `as` invites: measured (mermaid
 * 11.17.2), this lands in the described state's `descriptions` array and
 * leaves its id alone, so `Idle` is still what a transition names. It is
 * therefore read into the same list the colon spelling writes to, and which
 * spelling was written is recorded nowhere.
 *
 * The capture is the quoted text with any surrounding spaces taken off, so
 * both spellings of one description are one string. `\S` inside makes an
 * empty description unmatchable for the same measured reason `Empty :` is:
 * `state "" as X` is a **parse error in Mermaid**, not a state with a blank
 * description.
 */
const QUOTED_DESCRIPTION_RE = /^state\s+"\s*([^"]*\S)\s*"\s+as\s+(\w+)$/;

/**
 * The constructs this parser can read but deliberately does not draw yet,
 * each with the name its diagnostic calls it by.
 *
 * This is CONTEXT.md's opening policy made executable: while a construct is
 * unimplemented Siren refuses it rather than drawing it wrongly, and it
 * refuses it *by name* so an author knows what to route around instead of
 * hunting a typo.
 *
 * Every row here is a later ticket on the same board — the composite block
 * is what is left of them. Rows are matched *after* every construct this
 * parser does implement, so nothing it draws can be caught by one of them.
 */
const UNIMPLEMENTED_CONSTRUCTS: readonly { name: string; pattern: RegExp }[] = [
  { name: "composite state", pattern: /^state\s+.*\{\s*$/ },
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
  /**
   * Whether any error-severity problem was found. Like every other Siren
   * parser, a document with one comes back as `null`: the diagnostics say
   * what is wrong, and no half-parsed document reaches the next stage.
   */
  let sawError = false;

  /** Every state declared so far, by the id the author named it with. */
  const declaredById = new Map<string, StateDecl>();

  /**
   * Records a state the given statement named, and hands back its one
   * declaration. Only the first mention creates it, so a state named by ten
   * transitions is still one state, positioned where it was first written —
   * and a later line describing it adds to the declaration already there.
   */
  const declareState = (id: string, line: number, column: number): StateDecl => {
    const already = declaredById.get(id);
    if (already !== undefined) {
      return already;
    }
    const declaration: StateDecl = { id, kind: "state", descriptions: [], line, column };
    declaredById.set(id, declaration);
    states.push(declaration);
    return declaration;
  };

  /**
   * Records one description on the state it was written for, declaring that
   * state if this is the first line to name it — `Lonely : waits` is a
   * declaration as well as a description, measured.
   *
   * Descriptions **accumulate** rather than replace: measured, `s : first`
   * followed by `s : second` reports `descriptions=["first","second"]`, so
   * a second description is a second line of text and not a correction of
   * the first.
   */
  const describeState = (
    id: string,
    description: string,
    line: number,
    column: number,
  ): void => {
    declareState(id, line, column).descriptions.push(description);
  };

  /**
   * Records the level's start or end pseudo-state, at the first `[*]` that
   * asked for it.
   *
   * **One per level, not one per occurrence** — measured against mermaid
   * 11.17.2: two `[*] --> ...` lines both came back from a single
   * `root_start`, and two `... --> [*]` lines both reached a single
   * `root_end`. Folding them here is the same rule `declareState` applies
   * to a state named five times, and the parser is the one place that rule
   * lives for either.
   *
   * This parser reads one level — the root — because that is all
   * `stateDiagram` syntax offers until a composite state opens a second
   * one, which is still refused above. A composite's own `[*]` belongs to
   * *its* level; when that lands, this pair becomes one pair per open
   * level rather than a different mechanism.
   */
  const declaredPseudoKinds = new Set<"start" | "end">();
  const declarePseudoState = (
    kind: "start" | "end",
    line: number,
    column: number,
  ): void => {
    if (declaredPseudoKinds.has(kind)) {
      return;
    }
    declaredPseudoKinds.add(kind);
    // No id: the author never named this, and an id for a thing nobody
    // named is a *generated* id, which `buildStateModel` mints (ADR-0010).
    // No descriptions either, and never any: `[*]` is not an id, so there
    // is no spelling of either description form that names a pseudo-state.
    states.push({ id: null, kind, descriptions: [], line, column });
  };

  /**
   * One side of a transition, as the transition itself records it: the
   * authored id, or `null` for `[*]` — declaring the pseudo-state that
   * side means on the way.
   *
   * Which pseudo-state `[*]` names is decided by the side alone: on the
   * from side it is the level's start, on the to side its end. Measured —
   * they are two different pseudo-states, not one node used twice.
   */
  const readEndpoint = (
    spelling: string,
    side: "start" | "end",
    line: number,
    column: number,
  ): string | null => {
    if (spelling === PSEUDO_STATE) {
      declarePseudoState(side, line, column);
      return null;
    }
    declareState(spelling, line, column);
    return spelling;
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
      const [, fromSpelling, toSpelling, label] = transitionMatch;
      // Read in written order, so that `[*] --> Idle` declares the start
      // pseudo-state before `Idle` — first-mention order, which is the
      // order Mermaid's own state table reports and the order the diagram
      // is drawn in.
      const from = readEndpoint(fromSpelling, "start", lineNumber, column);
      const to = readEndpoint(toSpelling, "end", lineNumber, column);
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

    const descriptionMatch = STATE_DESCRIPTION_RE.exec(line);
    if (descriptionMatch !== null) {
      describeState(descriptionMatch[1], descriptionMatch[2], lineNumber, column);
      continue;
    }

    // The quoted spelling writes the same description onto the same state,
    // through the same call: the two are one construct, and the only
    // difference between the branches is which capture holds which half.
    const quotedMatch = QUOTED_DESCRIPTION_RE.exec(line);
    if (quotedMatch !== null) {
      describeState(quotedMatch[2], quotedMatch[1], lineNumber, column);
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
