import type {
  Diagnostic,
  ParseResult,
  SirenTimeline,
  StateDecl,
  StateDocument,
  StateTransition,
} from "../contracts";
import {
  listAcceptedHeaders,
  matchClassDirection,
  matchDiagramHeader,
} from "./parseDirection";
import { isTimelineHeader, parseTimelineBody } from "./parseTimelineBlock";

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
 * A state written on a line of its own — `Idle`. Measured: a bare identifier
 * puts a state into Mermaid's state table on its own, so a state nothing
 * points at still draws.
 *
 * The `state` keyword is **not** an optional prefix on it — see
 * `KEYWORD_ONLY_RE` below, which is the line this one used to swallow.
 *
 * Read *after* the transition pattern, so neither half of `A --> B` is ever
 * mistaken for one of these.
 */
const STATE_DECL_RE = /^(\w+)$/;

/**
 * `state Idle` — the `state` keyword with an id after it and nothing else on
 * the line. **Read, and then ignored.**
 *
 * It is the statement that opens a composite state, `state Idle {`, with its
 * brace missing. Measured (mermaid 11.17.2): Mermaid tolerates the mutilated
 * form and ignores it — no state reaches the state table, at the document's
 * level or inside a composite's block, and `Skipped`'s box is simply not
 * drawn.
 *
 * So this parser must *accept* the line and report nothing, not refuse it:
 * Mermaid draws the rest of such a document, and CONTEXT.md's compatibility
 * condition forbids trading a document Mermaid renders for no picture at all.
 * Matching here rather than falling through to the unrecognized-line
 * diagnostic below is what buys that, and declaring nothing is what stops
 * Siren drawing a box Mermaid does not.
 *
 * A state some *other* line declares is untouched by this: `state Skipped`
 * followed by `A --> Skipped` still draws `Skipped`, declared by the
 * transition (measured). Nothing is captured, because nothing is read.
 */
const KEYWORD_ONLY_RE = /^state\s+\w+$/;

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
 * The statement that opens a composite state: `state Outer {`.
 *
 * The id is read in the same `\w+` alphabet every other endpoint here is, so
 * a composite is named by exactly the spellings a transition can name, which
 * is what makes `Start --> Outer` reach the frame rather than declare a
 * second state beside it.
 *
 * Anchored on `{` at the end of the line: Mermaid's own grammar puts the
 * block's body on the lines that follow, and reading a one-line spelling
 * that Mermaid does not accept would be drawing a picture for a document
 * that does not render.
 */
const COMPOSITE_OPEN_RE = /^state\s+(\w+)\s*\{$/;

/** The statement that closes a composite state's block. */
const COMPOSITE_CLOSE = "}";

/**
 * The constructs this parser reads well enough to *recognize* and does not
 * implement — each refused **by name**, in the author's own words.
 *
 * CONTEXT.md's opening policy is what makes this a table rather than a
 * silence: while a construct is unimplemented, Siren rejects it and says
 * what is missing, so an author knows to route around it. Every one of
 * these is valid Mermaid (measured against 11.17.2 with
 * `scripts/mermaid-probe.mjs`) and carries a `rejected` row in the
 * compatibility corpus, which is where the measurement of each one lives.
 * Falling through to `Unrecognized stateDiagram line` would tell the author
 * their document is malformed — a different claim, and an untrue one.
 *
 * Read **last**, after every construct this parser does implement, so a
 * pattern here can never shadow a working one: `direction LR` inside a
 * composite is read above and only a document-level one reaches this, and
 * `state Outer {` likewise, so only the quoted spelling arrives. Each
 * pattern is anchored on the *statement* rather than on a bare word, which
 * is what leaves a state the author simply named `note` or `class` alone.
 */
const UNIMPLEMENTED: readonly { pattern: RegExp; name: (match: RegExpExecArray) => string }[] = [
  {
    // Measured: a closed set of three, recorded as a `type` on the state
    // itself (`type="choice"`) rather than as a state of its own.
    pattern: /<<\s*(choice|fork|join)\s*>>/,
    name: (match) => `the "<<${match[1]}>>" stereotype`,
  },
  {
    // Measured: the note hangs off the state it names, as
    // `note={"position":"right of","text":"..."}` — **not** a separate note
    // collection the way a class diagram's is.
    pattern: /^note\s+\S/,
    name: () => 'a "note" annotation',
  },
  {
    // Measured: synthesises `divider`-typed states and re-parents the
    // members under them — and Mermaid's own ids for those dividers carry a
    // random component (`id-g8d8ncxe8va-1`), so an implementation must mint
    // its own through `generatedId` rather than copy Mermaid's.
    pattern: /^-{2,}$/,
    name: () => 'the "--" concurrency divider',
  },
  {
    // Measured: a state diagram supports author styling too — the state
    // carries a `classes` array and `getClasses()` returns the definitions.
    pattern: /^classDef\s+\S/,
    name: () => 'the "classDef" author-style directive',
  },
  {
    // The apply-directive, `class Busy urgent`. Two arguments, so a lone
    // `class` stays the ordinary state id it is.
    pattern: /^class\s+\S+\s+\S/,
    name: () => 'the "class" author-style directive',
  },
  {
    // Measured: legal at the document's own level, where it sets the whole
    // diagram's rank direction. Inside a composite it is implemented and is
    // read before this table.
    pattern: /^direction\s+\S+$/,
    name: () => 'a document-level "direction" statement',
  },
  {
    // `state "Label" as Outer { ... }` — the quoted-description spelling
    // *with a block*. Measured: a composite `Outer` whose `descriptions`
    // hold the quoted text and whose members nest under it, so it is both
    // constructs at once. `COMPOSITE_OPEN_RE` matches only `state \w+ {`,
    // and the description spelling above matches only a line with no block
    // on it, so this falls between them.
    pattern: /^state\s+"[^"]*"\s+as\s+\w+\s*\{$/,
    name: () => "a composite state opened with a quoted description",
  },
];

/**
 * The refusal for `line`, or `null` when this parser has no name for what is
 * wrong with it and the generic unrecognized-line message is the honest
 * answer.
 */
function unimplementedIn(line: string): string | null {
  for (const { pattern, name } of UNIMPLEMENTED) {
    const match = pattern.exec(line);
    if (match !== null) {
      return `Unimplemented stateDiagram construct: ${name(match)}, in "${line}"`;
    }
  }
  return null;
}

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
 * A `timeline:` block ends the diagram body and runs to the end of the
 * document, exactly as it does in a flowchart and a class diagram — and it is
 * read by the same grammar, `parseTimelineBlock`, rather than by a fourth copy
 * of it here. Nothing about a timeline entry is diagram-kind-specific
 * (ADR-0002 keeps the block separate from the structural definition precisely
 * so it can name any id), so the ids in it are resolved by `buildStateModel`
 * and validated nowhere else.
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

  /**
   * The `timeline:` block, once one has been opened. `null` until then, which
   * is what tells `buildStateModel` the document declares no animation at all
   * (as opposed to declaring an empty block).
   */
  let timeline: SirenTimeline | null = null;

  /** Every state declared so far, by the id the author named it with. */
  const declaredById = new Map<string, StateDecl>();

  /**
   * The composite states whose blocks are open, outermost first, each
   * remembered with the statement that opened it so an unterminated one can
   * be reported in the author's own words.
   */
  const openBlocks: { state: StateDecl; statement: string; line: number; column: number }[] =
    [];

  /** The level a statement read right now belongs to: the innermost open block, or the document's own. */
  const currentParentId = (): string | null =>
    openBlocks.length === 0 ? null : openBlocks[openBlocks.length - 1].state.id;

  /**
   * Records a state the given statement named, and hands back its one
   * declaration. Only the first mention creates it, so a state named by ten
   * transitions is still one state, positioned where it was first written —
   * and a later line describing it adds to the declaration already there.
   *
   * **A later block may still claim it.** A state written at the document's
   * level and then named inside a composite belongs to that composite, and
   * the *first* block to name it keeps it against every later one — the rule
   * `parseFlowchart` already applies to a subgraph's members, applied here
   * rather than invented a second time (see `StateDecl.parentId`). Only an
   * unclaimed state moves, which is what makes the first claim the one that
   * counts.
   */
  const declareState = (id: string, line: number, column: number): StateDecl => {
    const already = declaredById.get(id);
    if (already !== undefined) {
      // A block naming a composite that is currently open — its own id, or
      // an enclosing one — claims nothing: a frame cannot be inside itself,
      // and `Outer --> Inner` written inside `state Outer { }` is a
      // transition out of the frame rather than a membership statement.
      if (already.parentId === null && !openBlocks.some((block) => block.state.id === id)) {
        already.parentId = currentParentId();
      }
      return already;
    }
    const declaration: StateDecl = {
      id,
      kind: "state",
      descriptions: [],
      parentId: currentParentId(),
      // Filled in below if this state turns out to be a composite whose
      // block writes a `direction` of its own.
      direction: null,
      line,
      column,
    };
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
   * **A level, not a document**: a composite state's block is a level of
   * its own, and its `[*]` is that composite's start rather than the
   * document's — measured (mermaid 11.17.2): `state Outer { [*] --> Inner }`
   * reports `Outer_start in="root/Outer"`, with the document's own
   * `root_start` nowhere in it. So the fold is keyed by the level a `[*]`
   * was written at, which is the innermost open block or the document
   * itself.
   */
  const declaredPseudoKinds = new Map<string | null, Set<"start" | "end">>();
  const declarePseudoState = (
    kind: "start" | "end",
    line: number,
    column: number,
  ): void => {
    const parentId = currentParentId();
    const atThisLevel = declaredPseudoKinds.get(parentId) ?? new Set<"start" | "end">();
    declaredPseudoKinds.set(parentId, atThisLevel);
    if (atThisLevel.has(kind)) {
      return;
    }
    atThisLevel.add(kind);
    // No id: the author never named this, and an id for a thing nobody
    // named is a *generated* id, which `buildStateModel` mints (ADR-0010).
    // No descriptions either, and never any: `[*]` is not an id, so there
    // is no spelling of either description form that names a pseudo-state.
    // And never a direction: only a composite has a block to write one in.
    states.push({ id: null, kind, descriptions: [], parentId, direction: null, line, column });
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

    if (isTimelineHeader(line)) {
      // Read *before* every structural pattern, and once read the block runs
      // to the end of the document — the same one-way switch `parseFlowchart`
      // and `parseClassDiagram` make, so a transition written after
      // `timeline:` is a timeline diagnostic rather than silently parsing as
      // structure. Draining it is `parseTimelineBody`'s job; what stays here
      // is only what is this parser's own: where the block starts, and that a
      // diagnostic inside it costs the whole document.
      //
      // An unterminated composite block is still reported below: the loop
      // breaks, and the `openBlocks` pass runs either way, so `state Outer {`
      // followed by `timeline:` is two problems and names both.
      const { entries, diagnostics: bodyDiagnostics } = parseTimelineBody(lines, index + 1);
      diagnostics.push(...bodyDiagnostics);
      if (bodyDiagnostics.length > 0) {
        sawError = true;
      }
      timeline = { entries };
      break;
    }

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
        // Which level the transition was written at — the only thing that
        // says which start or end pseudo-state a `null` endpoint means, now
        // that there is one pair per level rather than one per document.
        parentId: currentParentId(),
        sourceLine: lineNumber,
        sourceColumn: column,
      });
      continue;
    }

    // Read before the bare-state and description patterns for the reason the
    // transition is: `state Outer {` must never be mistaken for one of them.
    const compositeOpenMatch = COMPOSITE_OPEN_RE.exec(line);
    if (compositeOpenMatch !== null) {
      // Declared first, at the level that *holds* it, and only then pushed:
      // a composite is a state of the enclosing level, not of its own.
      const composite = declareState(compositeOpenMatch[1], lineNumber, column);
      // A state a transition already named is the same state, now known to
      // be a frame — so the kind is upgraded rather than a second
      // declaration made.
      composite.kind = "composite";
      openBlocks.push({ state: composite, statement: line, line: lineNumber, column });
      continue;
    }

    if (line === COMPOSITE_CLOSE && openBlocks.length > 0) {
      openBlocks.pop();
      continue;
    }

    // `direction` is read *inside* a block only, and onto that block alone —
    // measured: mermaid 11.17.2 records it on the composite and leaves the
    // document's own direction where the header put it. Read with
    // `matchClassDirection` rather than a pattern of this file's own, so the
    // five spellings and the `TD` alias cannot drift between two regexes;
    // the name is the class diagram's only because that is where the
    // statement was first read.
    //
    // At the document's own level this parser does not read one yet, so
    // `direction` there stays an unrecognized line rather than being
    // silently accepted and ignored.
    if (openBlocks.length > 0) {
      const blockDirection = matchClassDirection(line);
      if (blockDirection !== null) {
        openBlocks[openBlocks.length - 1].state.direction = blockDirection;
        continue;
      }
    }

    const stateMatch = STATE_DECL_RE.exec(line);
    if (stateMatch !== null) {
      declareState(stateMatch[1], lineNumber, column);
      continue;
    }

    // Accepted and dropped on the floor — the one construct here that is
    // read without producing anything. See `KEYWORD_ONLY_RE`: Mermaid
    // ignores it, so ignoring it is the compatible answer, and a diagnostic
    // would be the incompatible one.
    if (KEYWORD_ONLY_RE.test(line)) {
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

    // Read last, so nothing here can shadow a construct this parser does
    // implement: a line only reaches the table once every working pattern
    // above has declined it.
    const unimplemented = unimplementedIn(line);
    diagnostics.push({
      severity: "error",
      message: unimplemented ?? `Unrecognized stateDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
  }

  // A block the author never closed, reported in the words they opened it
  // with — one diagnostic per unclosed block, innermost first, so nesting is
  // described rather than summarized. The answer `parseFlowchart` gives an
  // unterminated `subgraph` and `parseClassDiagram` an unterminated
  // `namespace`.
  for (const block of [...openBlocks].reverse()) {
    diagnostics.push({
      severity: "error",
      message: `Unterminated "${block.statement}" block: missing matching "${COMPOSITE_CLOSE}"`,
      line: block.line,
      column: block.column,
    });
    sawError = true;
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: StateDocument = { kind: "state", states, transitions, timeline };

  return { document, diagnostics };
}
