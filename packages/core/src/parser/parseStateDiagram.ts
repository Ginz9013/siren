import type {
  Diagnostic,
  Direction,
  Label,
  ParseResult,
  SirenTimeline,
  StateDecl,
  StateDocument,
  StateNotePosition,
  StateRegion,
  StateStereotype,
  StateTransition,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { labelDiagnostics, readLabel } from "../label/readLabel";
import { parseStyleProperties } from "./parseDeclarationList";
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
const TRANSITION_RE = /^(\w+|\[\*\])\s*-->\s*(\w+|\[\*\])\s*(?::\s*(.*))?$/d;

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
 * The words Mermaid's state-diagram lexer takes for itself, and which
 * therefore **cannot name a state** where an id is read from the lexer's
 * INITIAL condition — a line of its own, or either endpoint of a transition.
 *
 * Measured against mermaid 11.17.2 with `scripts/mermaid-probe.mjs`, sixteen
 * keyword-shaped candidates in both of those positions. Exactly these seven
 * are reserved; each is a **parse error** in both positions, with the single
 * exception of `state` on a line of its own, which is tolerated and ignored
 * (see `KEYWORD_ONLY_RE`). Siren accepted all seven as ordinary ids with no
 * diagnostic, drawing a box Mermaid draws nothing for — while refusing the
 * same words' *complete* statements (`note right of A : hi`, `class A foo`),
 * so one word got opposite treatment depending on whether it was finished.
 *
 * **Derived from measurement, not from the parse error's token list.** That
 * list names `HIDE_EMPTY`, `FORK`, `JOIN`, `CHOICE`, `acc_title` and the
 * four `direction_*` tokens too, and none of those words is reserved:
 * `hide`, `end`, `direction`, `fork`, `join`, `choice`, `accTitle` and
 * `accDescr` each declare an ordinary state in both positions, because
 * Mermaid matches `direction lr`, `hide empty description` and `accTitle:`
 * as prefix-plus-argument statements rather than reserving the bare word.
 * A blacklist read off that list would refuse eight documents Mermaid draws.
 *
 * **Not global**, for the same lexical reason it exists: after the `state `
 * keyword the lexer leaves its INITIAL condition, so `state "x" as note` and
 * `state class { ... }` both render, and both are still read here. The rule
 * is applied at the two read sites rather than inside `declareState`, which
 * is what keeps those two working.
 *
 * Case-insensitive, because every one of Mermaid's lexer rules is: measured,
 * `Note`, `NOTE`, `Class`, `Style`, `Click`, `Scale` and `ClassDef` are each
 * refused exactly as their lowercase spellings are.
 */
const RESERVED_WORD_RE = /^(?:state|note|classDef|class|style|click|scale)$/i;

/**
 * The refusal for an id the author may not use, quoting their own line back
 * at them — and saying the word is *reserved*, because "unrecognized line"
 * would send them looking for a typo when what they need to do is rename the
 * state.
 */
const reservedWordRefusal = (word: string, line: string): string =>
  `Reserved stateDiagram word "${word}" cannot name a state — rename it, in "${line}"`;

/**
 * `state Idle` — the `state` keyword with an id after it and nothing else on
 * the line — **or the keyword entirely alone**. Either way: read, and then
 * ignored.
 *
 * It is the statement that opens a composite state, `state Idle {`, with its
 * brace missing. Measured (mermaid 11.17.2): Mermaid tolerates the mutilated
 * form and ignores it — no state reaches the state table, at the document's
 * level or inside a composite's block, and `Skipped`'s box is simply not
 * drawn. Measured again with the id gone too: a lone `state` is likewise no
 * parse error and likewise declares nothing, so the id is optional here
 * rather than a second rule beside this one.
 *
 * So this parser must *accept* the line and report nothing, not refuse it:
 * Mermaid draws the rest of such a document, and CONTEXT.md's compatibility
 * condition forbids trading a document Mermaid renders for no picture at all.
 * Matching here rather than falling through to the unrecognized-line
 * diagnostic below is what buys that, and declaring nothing is what stops
 * Siren drawing a box Mermaid does not.
 *
 * That lone spelling is why this is read *before* `STATE_DECL_RE`: `state`
 * is a perfectly good `\w+`, and the bare-identifier rule would otherwise
 * claim it — which is how Siren came to draw a box labelled `state`. It is
 * also the one exception to `RESERVED_WORD_RE`: `state` is reserved like the
 * other six, but tolerated in this one position where they are refused.
 *
 * Case-insensitive, as Mermaid's own lexer rule for the keyword is:
 * measured, `State Skipped`, `STATE Skipped` and a lone `State` are all
 * ignored exactly as the lowercase spellings are.
 *
 * A state some *other* line declares is untouched by this: `state Skipped`
 * followed by `A --> Skipped` still draws `Skipped`, declared by the
 * transition (measured). Nothing is captured, because nothing is read.
 */
const KEYWORD_ONLY_RE = /^state(?:\s+\w+)?$/i;

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
const STATE_DESCRIPTION_RE = /^(\w+)\s*:\s*(\S.*)$/d;

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
const QUOTED_DESCRIPTION_RE = /^state\s+"\s*([^"]*\S)\s*"\s+as\s+(\w+)$/d;

/**
 * The statement that opens a composite state: `state Outer {`, or the same
 * thing written with a description on it — `state "the outer block" as Outer {`.
 *
 * **One pattern, because they open the same construct.** Measured (mermaid
 * 11.17.2, `scripts/mermaid-probe.mjs`): the quoted spelling reports one
 * composite `Outer in="root" descriptions=["the outer block"]` with its
 * members `in="root/Outer"` — the description lands in the same array
 * `Idle : text` and `state "text" as Idle` write to, and the block is the
 * same block. Measured again against the spelling that writes the two apart
 * (`state "the outer block" as Outer` above a separate `state Outer { ... }`):
 * the dumps are identical, state for state and relation for relation. So
 * this is a *second spelling of one statement* and not a construct of its
 * own, which is why the description is an optional group here rather than a
 * pattern beside this one — and why nothing new is recorded for it.
 *
 * The id is read in the same `\w+` alphabet every other endpoint here is, so
 * a composite is named by exactly the spellings a transition can name, which
 * is what makes `Start --> Outer` reach the frame rather than declare a
 * second state beside it.
 *
 * The description's own capture is `QUOTED_DESCRIPTION_RE`'s, down to the
 * `\S` that makes an empty one unmatchable: `state "" as X` is a parse error
 * in Mermaid rather than a blank description, with or without a block on it.
 *
 * Anchored on `{` at the end of the line: Mermaid's own grammar puts the
 * block's body on the lines that follow, and reading a one-line spelling
 * that Mermaid does not accept would be drawing a picture for a document
 * that does not render. That anchor is also what keeps the two spellings
 * apart from the two description patterns below, which end at the id.
 */
const COMPOSITE_OPEN_RE = /^state\s+(?:"\s*([^"]*\S)\s*"\s+as\s+)?(\w+)\s*\{$/d;

/**
 * `state Choice <<choice>>` — the marker that changes which figure a state
 * is drawn as, without changing anything about where it sits.
 *
 * Every part of this pattern is measured against mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`:
 *
 * - **Three words and no fourth.** `<<end>>`, `<<start>>` and `<<foo>>` are
 *   each *accepted and ignored* — the statement declares nothing at all, so
 *   `state X <<foo>>` above `A --> X` reports `A` before `X` and `X` with
 *   `type="default"`. They are outside this pattern deliberately: no corpus
 *   row covers them, and implementing one on the way would be inventing
 *   rather than measuring.
 * - **Case-insensitive**, as Mermaid's own lexer rule is
 *   (`/^(?:.*<<fork>>)/i`): `<<CHOICE>>`, `<<FORK>>` and `<<Join>>` each
 *   report the lowercase `type`. Unlike a note's position (see
 *   `isNotePosition`), the casing changes nothing about what Mermaid then
 *   *records*, so there is no wrong picture to decline here.
 * - **No spaces inside the angle brackets.** `state X << choice >>` is *not*
 *   a stereotype: measured, it declares nothing and `X` comes back
 *   `type="default"`, because Mermaid's rule spells the brackets literally.
 *   (The `UNIMPLEMENTED` entry this replaces allowed `\s*` there and was
 *   refusing a line Mermaid quietly ignores; the working pattern must not
 *   inherit that.)
 * - **Nothing after the marker.** `state X <<choice>> trailing` parses in
 *   Mermaid and declares a *second, phantom* state called `trailing`
 *   alongside the choice — the `.*<<choice>>` token takes the prefix as the
 *   id and the rest becomes an id of its own. Anchored on `$` here, so that
 *   line is refused rather than drawn with a box nobody wrote.
 * - **The id is read in `\w+`**, the alphabet every other state id in this
 *   file is read in. Mermaid is looser and pays for it: `state Foo Bar
 *   <<choice>>` reports a state whose id is literally `Foo Bar`, and
 *   `state "desc" as X <<choice>>` one whose id is `"desc" as X` — names no
 *   transition can ever reach, beside the `X` the author meant. Neither is
 *   covered by a corpus row, and both are refused here.
 * - **A block may not open on it**: `state X <<choice>> {` is a parse error
 *   in Mermaid, which is why there is no brace arm in this pattern.
 */
const STEREOTYPE_RE = /^state\s+(\w+)\s*<<(choice|fork|join)>>$/i;

/** The statement that closes a composite state's block. */
const COMPOSITE_CLOSE = "}";

/**
 * The concurrency divider: a line of **nothing but `--`, one or more times
 * over**, which splits the composite block it sits in into concurrent
 * regions.
 *
 * The repetition is not generosity, it is the lexer: measured (mermaid
 * 11.17.2), `--` is one token and a line of `----` is therefore *two*
 * dividers — it reports three regions with an empty one in the middle,
 * exactly as two `--` lines on their own do, and `------` reports four. An
 * **odd** run is not a longer divider but a lexical error: both `-` and
 * `---` are rejected outright ("Unrecognized text"), which is why this is
 * `(?:--)+` and not `-{2,}` — the latter, which the unimplemented table
 * used while the construct was refused, would now read `---` as a divider
 * where Mermaid reads it as nothing at all.
 *
 * Anchored on the whole trimmed line, so a `--` inside a label
 * (`A --> B : go -- now`) or a description is untouched: measured, neither
 * produces a divider.
 */
const DIVIDER_RE = /^(?:--)+$/;

/**
 * `note right of Idle : waiting for work` — a note written onto one state,
 * on the side the author named.
 *
 * Every part of this pattern is measured against mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`:
 *
 * - **Two positions and no third.** `note over Idle : hovering` is a
 *   *lexical* error, not a note drawn over the box, so `over` is a sequence
 *   diagram's word and not this kind's.
 * - **The target is read in `\w+`**, the alphabet every other state id in
 *   this file is read in — so `note right of [*] : text`, which Mermaid does
 *   accept (it attaches the note to the level's *start* pseudo-state,
 *   measured), is deliberately not matched here and is refused by name in
 *   `UNIMPLEMENTED` instead.
 * - **The text may not contain a colon.** `note right of Idle : a : b : c`
 *   is a parse error in Mermaid, so a second colon is not text — it is a
 *   malformed line, and letting `.*` swallow it would draw a picture for a
 *   document that does not render.
 * - **The text may not be empty.** `note right of Idle :` is a lexical error
 *   too, which is what the leading `\S` here refuses — the same guard
 *   `STATE_DESCRIPTION_RE` carries for `Empty :`, and for the same measured
 *   reason.
 */
const NOTE_RE = /^note\s+((?:left|right)\s+of)\s+(\w+)\s*:\s*([^:]*\S)\s*$/di;

/**
 * The two positions, as `StateNotePosition` spells them — and the gate that
 * keeps `NOTE_RE`'s case-insensitivity off them.
 *
 * The `note` keyword itself is case-insensitive in Mermaid's lexer, measured:
 * `Note right of Idle : cased` reads exactly as the lowercase spelling does,
 * so refusing it would cost a document Mermaid draws correctly. **The
 * position is a different matter.** Measured, `note RIGHT OF Idle : shouty`
 * also parses — and Mermaid records the position *verbatim*
 * (`"RIGHT OF"`), then decides which side to draw on with an exact
 * `position === "left of"` comparison. So `note LEFT OF X : t` renders in
 * Mermaid as a **right-of** note: a wrong picture with no diagnostic, from
 * Mermaid's own case sensitivity. Siren will neither copy that nor silently
 * pick the other side, so an uncanonical spelling is declined here and
 * refused as an unrecognized line — CONTEXT.md's one exception to the
 * compatibility condition, applied where it was written for.
 */
const isNotePosition = (spelling: string): spelling is StateNotePosition =>
  spelling === "left of" || spelling === "right of";

/**
 * `note "floating" as N` — the note spelling that belongs to no state.
 *
 * Read, and then ignored, exactly as `KEYWORD_ONLY_RE`'s `state Skipped` is,
 * and for the same measured reason: mermaid 11.17.2 **parses this line and
 * records nothing for it**. No state `N` reaches the state table, no note
 * reaches any state, and `--markup` shows the diagram drawn with only the
 * states its other lines declare. So Mermaid renders such a document, and
 * refusing it here would trade a document that renders for no picture at
 * all — the trade CONTEXT.md's compatibility condition forbids. Reporting
 * nothing is what stops Siren drawing a box Mermaid does not.
 *
 * Case-insensitive, as every one of Mermaid's lexer rules is: measured,
 * `NOTE "floating" as N` and `note "floating" AS N` are ignored exactly as
 * the lowercase spelling is.
 */
const FLOATING_NOTE_RE = /^note\s+"[^"]*"\s+as\s+\w+$/i;

/**
 * `classDef urgent fill:#f96` — a named set of declarations, applied to
 * nothing on its own, spelled exactly as a flowchart and a class diagram
 * spell it.
 */
const CLASS_DEF_RE = /^classDef\s+(\w+)\s+(.+)$/;

/**
 * `class Busy urgent` — the apply-directive, in this kind's spelling of it.
 *
 * The **target list** is comma-separated and the **class name** is not, and
 * that asymmetry is measured rather than assumed (mermaid 11.17.2):
 *
 *     class Busy,Done urgent    →  classes=["urgent"] on *both* states
 *     class Busy, Done urgent   →  the same, so a space after the comma is spare
 *     class Busy alpha,beta     →  classes=["alpha,beta"] — one class name,
 *                                  matching no `classDef`, painting nothing
 *
 * So the second capture is a single `\w+`: a state wearing two classes is
 * written as two `class` statements, and measured, those *do* stack
 * (`classes=["alpha","beta"]`).
 *
 * The target list is greedy and backtracks, the way `parseFlowchart`'s
 * `CLASS_APPLY_RE` does — `[\w\s,]` cannot cross the space before the class
 * name and gives it back — which is what reads `class A,B x` and
 * `class A, B x` with one pattern instead of two. The alphabet is `\w`
 * alone, without the flowchart's `.`, because a state id is read in `\w+`
 * everywhere else in this file.
 *
 * **Two operands, both required.** A lone `class` is a whole-document parse
 * error in Mermaid (measured), and this pattern declining it is what leaves
 * it to `RESERVED_WORD_RE` — the reservation that exists for exactly this
 * statement.
 */
const CLASS_APPLY_RE = /^class\s+([\w\s,]*[\w,])\s+(\w+)\s*$/;

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
 * pattern here can never shadow a working one. Each pattern is anchored on
 * the *statement* rather than on a bare word, which is what leaves a state
 * the author simply named `note` or `class` alone.
 *
 * The table shrinks as constructs land: a composite opened with a quoted
 * description used to sit here, and left by being implemented rather than by
 * having its message reworded (`COMPOSITE_OPEN_RE` reads both spellings now),
 * and so did author styling (`CLASS_DEF_RE` and `CLASS_APPLY_RE`).
 */
const UNIMPLEMENTED: readonly { pattern: RegExp; name: (match: RegExpExecArray) => string }[] = [
  {
    // The note construct itself is implemented (`NOTE_RE`); these are the
    // two spellings of it that are not, each measured to be valid Mermaid
    // and each left here so it is refused by name rather than as a
    // malformed line.
    //
    // Measured: `note right of [*] : the beginning` attaches the note to the
    // level's **start** pseudo-state — `root_start` — whichever side of an
    // arrow the author's `[*]` lines put it on (a document whose only `[*]`
    // is an *end* still reports the note on `root_start`, with the end left
    // bare). Siren's pseudo-states carry generated ids and no note, so this
    // is a gap and says so.
    pattern: /^note\s+(?:left|right)\s+of\s+\[\*\]/,
    name: () => 'a note on a "[*]" pseudo-state',
  },
  {
    // Measured: `note right of Idle` with no colon opens the multi-line
    // form, whose text runs to a closing `end note` and reaches the state as
    // one string with newlines in it. A single-line note is `NOTE_RE`'s;
    // this spelling needs a drawn box of several rows and has none.
    pattern: /^note\s+(?:left|right)\s+of\s+\w+\s*$/,
    name: () => 'a multi-line "note ... end note"',
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
   * The author's styling statements in written order, definitions and
   * apply-directives alike. Left unpaired here on purpose: an
   * apply-directive may name a `classDef` written below it, and pairing
   * them is `resolveStyles`' job.
   */
  const styles: StyleDecl[] = [];
  /**
   * Whether any error-severity problem was found. Like every other Siren
   * parser, a document with one comes back as `null`: the diagnostics say
   * what is wrong, and no half-parsed document reaches the next stage.
   */
  let sawError = false;

  /**
   * The document's own rank direction, once a statement at the document's
   * level has named one — `null` until then, which is both "the author has
   * named none, so `TB`" and "the next one to arrive is the one that
   * counts".
   *
   * **First wins**, which is where this kind parts company with
   * `parseClassDiagram`'s last-wins assignment. Measured against mermaid
   * 11.17.2: `direction LR` then `direction RL` reports `LR`, and the
   * reverse pair reports `RL`, because its database answers `getDirection()`
   * with `rootDoc.find((doc) => doc.stmt === "dir")` — the first such
   * statement, with every later one left inert rather than overwriting it.
   * Assigning here the way the class diagram does would draw the second
   * document sideways where Mermaid draws it bottom-up.
   */
  let documentDirection: Direction | null = null;

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

  /**
   * How many `--` lines each composite's block has carried so far, by that
   * composite's id — so the region a statement is written in is that count,
   * and the number of regions the block ends up with is that count plus one.
   *
   * Keyed by the composite rather than held on the `openBlocks` entry so
   * that a block reopened under the same name (`state Outer { }` written
   * twice) goes on counting where it left off, the way every other thing a
   * composite accumulates does.
   */
  const dividersByComposite = new Map<string, number>();

  /**
   * The `direction` statement written in each region, keyed by the region it
   * was written in. Kept here rather than assigned to the composite as it is
   * read, because whether that block *has* regions is not known until the
   * whole block has been read: a `--` may come after the `direction`.
   *
   * Resolved once the document is complete — onto the region for a divided
   * block, and onto the composite itself for an undivided one, whose whole
   * block is its only region.
   */
  const directionByRegion = new Map<string, Direction>();

  /** The key `directionByRegion` and the region list agree on. `\u0000` cannot occur in a `\w+` id. */
  const regionKey = (parentId: string, index: number): string => `${parentId}\u0000${index}`;

  /**
   * Reads the declaration list of a `classDef` statement, turning each
   * segment that is not a `property:value` pair into an error diagnostic on
   * that statement's line — the answer `parseClassDiagram` and
   * `parseFlowchart` already give, reached through the same shared splitter
   * so that `fill:rgb(255, 0, 0)` stays one declaration in all three.
   */
  const readStyleProperties = (
    text: string,
    lineNumber: number,
    column: number,
  ): StyleProperty[] => {
    const { properties, malformed } = parseStyleProperties(text);
    for (const segment of malformed) {
      diagnostics.push({
        severity: "error",
        message: `Unrecognized style declaration: "${segment}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
    }
    return properties;
  };

  /** The level a statement read right now belongs to: the innermost open block, or the document's own. */
  const currentParentId = (): string | null =>
    openBlocks.length === 0 ? null : openBlocks[openBlocks.length - 1].state.id;

  /**
   * Which region of that level a statement read right now belongs to: how
   * many `--` lines the innermost open block has carried, and `null` at the
   * document's own level, where a `--` is a parse error and there are no
   * regions to be in.
   *
   * Recorded on every statement inside every block, and *unrecorded* at the
   * end for the blocks that turned out to carry no `--` at all — see the
   * pass below, and `StateDecl.regionIndex`, which is `null` for exactly
   * those.
   */
  const currentRegionIndex = (): number | null => {
    const parentId = currentParentId();
    return parentId === null ? null : (dividersByComposite.get(parentId) ?? 0);
  };

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
        // The region travels with the level: a state claimed by a block
        // joins the region that claimed it, not the region-less document
        // level it was first written at.
        already.regionIndex = currentRegionIndex();
      }
      return already;
    }
    const declaration: StateDecl = {
      id,
      kind: "state",
      // Filled in by the stereotype statement when *this* line is that
      // statement; a `<<choice>>` written after the state was first named
      // is inert, measured (see `STEREOTYPE_RE`).
      stereotype: null,
      descriptions: [],
      parentId: currentParentId(),
      // Which concurrent region of that level. Provisional until the
      // document is complete: a level that turns out to carry no `--` has
      // no regions, and every member of it is reset to `null` below.
      regionIndex: currentRegionIndex(),
      // Filled in below if this state turns out to be a composite whose
      // block writes a `direction` of its own.
      direction: null,
      // Filled in by `annotateState` if a `note ... of` statement names this
      // state — at most one, whatever the author writes.
      note: null,
      line,
      column,
    };
    declaredById.set(id, declaration);
    states.push(declaration);
    return declaration;
  };

  /**
   * Reads the label one capture group of a statement's match holds, and
   * turns whatever `readLabel` found in it into diagnostics at the line and
   * column of the character each problem is about.
   *
   * Every label this parser reads is a capture of one of its own patterns
   * over the trimmed line, each compiled with the `d` flag, so where the
   * label begins in the line is the group's own index and nothing is
   * re-derived by searching the text for itself — and a state diagram's
   * statement never spans physical lines, so a position in the line is a
   * column once the line's own indent (`column`) is added. The same
   * conversion `parseFlowchart`'s `reportLabelProblems` makes, without the
   * line-break walk only a Markdown string there needs.
   *
   * Read in the full `html` dialect wherever it is called: measured (mermaid
   * 11.17.2, `--paint`, `htmlLabels: true`), a description, a transition
   * label, a composite's quoted title and a note all honor the tags rather
   * than draw them — see `StateDecl.descriptions` and `StateNote.label`.
   *
   * An error costs the whole document, exactly as an unrecognized line does.
   */
  const readLabelIn = (
    match: RegExpExecArray,
    group: number,
    lineNumber: number,
    column: number,
  ): Label => {
    const [start] = match.indices![group]!;
    const { label, problems } = readLabel(match[group]!, { dialect: "html" });
    const reported = labelDiagnostics(problems, (offset) => ({
      line: lineNumber,
      column: column + start + offset,
    }));
    diagnostics.push(...reported.diagnostics);
    if (reported.hasError) {
      sawError = true;
    }
    return label;
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
    description: Label,
    line: number,
    column: number,
  ): void => {
    declareState(id, line, column).descriptions.push(description);
  };

  /**
   * Records the note written onto a state, declaring that state if this is
   * the first line to name it — `note right of Ghost : who?` is a
   * declaration as well as a note, measured (mermaid 11.17.2 reports a state
   * `Ghost` carrying the note and nothing pointing at it).
   *
   * **Replaces rather than accumulates**, which is where this parts company
   * with `describeState` one function up, and the difference is measured
   * rather than assumed: two descriptions on one state stack into a list,
   * while a second note on one state **overwrites** the first — whichever
   * sides they were written on (`note right of Idle : first` then
   * `note left of Idle : second` reports the one note
   * `{"position":"left of","text":"second"}`). A state carries at most one.
   */
  const annotateState = (
    id: string,
    position: StateNotePosition,
    label: Label,
    line: number,
    column: number,
  ): void => {
    declareState(id, line, column).note = { position, label };
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
  const declaredPseudoKinds = new Map<string, Set<"start" | "end">>();
  const declarePseudoState = (
    kind: "start" | "end",
    line: number,
    column: number,
  ): void => {
    const parentId = currentParentId();
    const regionIndex = currentRegionIndex();
    // Keyed by the **region** as well as the block, because a `--` makes
    // one block several levels: measured (mermaid 11.17.2), a `[*]` in each
    // of two regions comes back as two different starts,
    // `divider-id-1_start` and the second divider's own.
    const atThisLevel =
      declaredPseudoKinds.get(`${parentId}\u0000${regionIndex}`) ??
      new Set<"start" | "end">();
    declaredPseudoKinds.set(`${parentId}\u0000${regionIndex}`, atThisLevel);
    if (atThisLevel.has(kind)) {
      return;
    }
    atThisLevel.add(kind);
    // No id: the author never named this, and an id for a thing nobody
    // named is a *generated* id, which `buildStateModel` mints (ADR-0010).
    // No descriptions either, and never any: `[*]` is not an id, so there
    // is no spelling of either description form that names a pseudo-state.
    // And never a direction: only a composite has a block to write one in.
    // No note either: `note right of [*]` is refused by name (see
    // `UNIMPLEMENTED`), so nothing can reach a pseudo-state to write one.
    states.push({
      id: null,
      kind,
      // And never a stereotype: `state <<choice>>` names no state, and
      // `[*]` is not an id, so no statement can mark a pseudo-state.
      stereotype: null,
      descriptions: [],
      parentId,
      regionIndex,
      direction: null,
      note: null,
      line,
      column,
    });
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
      const [, fromSpelling, toSpelling, labelSource] = transitionMatch;
      // A word of Mermaid's own on either side. Refused before either
      // endpoint is read, so a transition with one bad end declares
      // *neither* state and leaves no half-built line behind — Mermaid
      // rejects the whole document, and there is no picture to be partly
      // faithful to. Both ends are reported, so a line that names two
      // reserved words says so twice rather than sending the author back
      // for a second run.
      //
      // Unlike a line of its own, this position has no exception for
      // `state`: measured, all seven are a parse error here.
      const reservedEnds = [fromSpelling, toSpelling].filter((spelling) =>
        RESERVED_WORD_RE.test(spelling),
      );
      if (reservedEnds.length > 0) {
        for (const word of reservedEnds) {
          diagnostics.push({
            severity: "error",
            message: reservedWordRefusal(word, line),
            line: lineNumber,
            column,
          });
        }
        sawError = true;
        continue;
      }
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
        // The capture starts past the padding after the colon, and the line
        // is already trimmed, so the label is the capture as it stands.
        label:
          labelSource === undefined || labelSource.length === 0
            ? null
            : readLabelIn(transitionMatch, 3, lineNumber, column),
        // Which level the transition was written at — the only thing that
        // says which start or end pseudo-state a `null` endpoint means, now
        // that there is one pair per level rather than one per document.
        parentId: currentParentId(),
        // And which region of it, for the same reason: a `--` makes one
        // block several levels, each with a `[*]` pair of its own
        // (measured — each divider comes back with its own `_start`).
        regionIndex: currentRegionIndex(),
        sourceLine: lineNumber,
        sourceColumn: column,
      });
      continue;
    }

    // Read before the bare-state and description patterns for the reason the
    // transition is: `state Outer {` must never be mistaken for one of them.
    const compositeOpenMatch = COMPOSITE_OPEN_RE.exec(line);
    if (compositeOpenMatch !== null) {
      const [, quotedDescription, compositeId] = compositeOpenMatch;
      // Declared first, at the level that *holds* it, and only then pushed:
      // a composite is a state of the enclosing level, not of its own.
      const composite = declareState(compositeId, lineNumber, column);
      // A state a transition already named is the same state, now known to
      // be a frame — so the kind is upgraded rather than a second
      // declaration made.
      composite.kind = "composite";
      // The quoted spelling's description, through the very call the two
      // description statements use: a composite's descriptions are the same
      // accumulating list an ordinary state's are, so `Outer : text` written
      // elsewhere adds a row to this one rather than contradicting it.
      if (quotedDescription !== undefined) {
        describeState(
          compositeId,
          readLabelIn(compositeOpenMatch, 1, lineNumber, column),
          lineNumber,
          column,
        );
      }
      openBlocks.push({ state: composite, statement: line, line: lineNumber, column });
      continue;
    }

    if (line === COMPOSITE_CLOSE && openBlocks.length > 0) {
      openBlocks.pop();
      continue;
    }

    // The concurrency divider, read right after the two statements that open
    // and close a block because it is the third statement about a block's
    // own shape — and before every pattern that reads a *state*, none of
    // which can match a line of dashes anyway.
    //
    // A `--` at the document's own level is **refused**, measured rather
    // than chosen: mermaid 11.17.2 rejects such a document outright
    // ("Expecting ... got 'INVALID'"), so there is no picture to be
    // compatible with and accepting it would be Siren drawing something
    // Mermaid will not.
    const dividerMatch = DIVIDER_RE.exec(line);
    if (dividerMatch !== null) {
      const blockId = currentParentId();
      if (blockId === null) {
        diagnostics.push({
          severity: "error",
          message:
            `A "--" concurrency divider belongs inside a composite state's ` +
            `block, in "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        continue;
      }
      // One region per `--` token, not per line: `----` is two of them and
      // opens two regions, leaving an empty one between (measured — see
      // `DIVIDER_RE`).
      dividersByComposite.set(
        blockId,
        (dividersByComposite.get(blockId) ?? 0) + line.length / 2,
      );
      continue;
    }

    // The stereotype marker. Read before the bare-state and description
    // patterns for the reason `state Outer {` is — a statement opening with
    // the `state` keyword must never be claimed by one of them — and before
    // `KEYWORD_ONLY_RE`, which would otherwise have to be careful not to.
    const stereotypeMatch = STEREOTYPE_RE.exec(line);
    if (stereotypeMatch !== null) {
      const [, stereotypeId, spelling] = stereotypeMatch;
      // **Only the line that first names the state takes the marker.**
      // Measured (mermaid 11.17.2): `A --> X` followed by
      // `state X <<choice>>` reports `id="X" type="default"` — `addState`
      // guards the field with `if (!state.type)` and an existing state
      // always has one, so a stereotype written below its state is inert.
      // Assigning unconditionally would draw a diamond where Mermaid draws
      // a box. (The opposite of the way a later `state X { }` upgrades
      // `kind` to `composite`, which Mermaid *does* do — `if (!state.doc)`,
      // and a state without a block has none.)
      const alreadyNamed = declaredById.has(stereotypeId);
      // Declared here when nothing has named it yet, and mentioned at this
      // level when something has — the same call every other statement makes.
      const stereotyped = declareState(stereotypeId, lineNumber, column);
      if (!alreadyNamed) {
        // Lowercased, not kept as written: Mermaid's lexer rule is
        // case-insensitive and its record is not, so `<<CHOICE>>` and
        // `<<choice>>` are one value and the casing is recorded nowhere.
        stereotyped.stereotype = spelling.toLowerCase() as StateStereotype;
      }
      continue;
    }

    // One statement, two levels. Inside a block it is that block's own rank
    // direction and touches nothing else — measured: mermaid 11.17.2 keeps
    // it in the composite's own doc and leaves the document's direction
    // where the header put it. At the document's own level it is the whole
    // diagram's, and there the *first* one wins (see `documentDirection`).
    //
    // Read with `matchClassDirection` rather than a pattern of this file's
    // own, so the five spellings and the `TD` alias cannot drift between two
    // regexes; the name is the class diagram's only because that is where
    // the statement was first read.
    const statementDirection = matchClassDirection(line);
    if (statementDirection !== null) {
      if (openBlocks.length > 0) {
        // Onto the **region** it was written in, which for an undivided
        // block is the whole block and lands on the composite below.
        // Measured (mermaid 11.17.2): in a divided block the statement turns
        // its own region and leaves the others alone — `direction LR` above
        // the `--` lays region one out left-to-right and region two
        // top-to-bottom, and moving it below the `--` swaps which one turns.
        // Both `!`s are the same fact: a block is open, so there is a
        // current level, and a composite is authored so its id is never
        // `null`.
        directionByRegion.set(
          regionKey(currentParentId()!, currentRegionIndex()!),
          statementDirection,
        );
      } else if (documentDirection === null) {
        documentDirection = statementDirection;
      }
      continue;
    }

    // Accepted and dropped on the floor — the one construct here that is
    // read without producing anything. See `KEYWORD_ONLY_RE`: Mermaid
    // ignores it, so ignoring it is the compatible answer, and a diagnostic
    // would be the incompatible one.
    //
    // Read *before* the bare-state pattern, because a lone `state` matches
    // both and only this answer is Mermaid's.
    if (KEYWORD_ONLY_RE.test(line)) {
      continue;
    }

    // The two author-styling statements. Recorded, never paired: a `classDef`
    // defines and applies to nothing, an apply-directive names its targets,
    // and `resolveStyles` matches them up in either source order.
    //
    // Read *before* the bare-state and description patterns, so neither can
    // claim a statement that opens with one of these two reserved words —
    // and read *after* them in the file's reading order only in the sense
    // that they are still behind every transition and composite pattern
    // above, which no `classDef`/`class` line can match.
    const classDefMatch = CLASS_DEF_RE.exec(line);
    if (classDefMatch !== null) {
      styles.push({
        styleKind: "classDef",
        authoredAs: "classDef",
        targetIds: [],
        name: classDefMatch[1],
        properties: readStyleProperties(classDefMatch[2], lineNumber, column),
        line: lineNumber,
        column,
      });
      continue;
    }

    const classApplyMatch = CLASS_APPLY_RE.exec(line);
    if (classApplyMatch !== null) {
      styles.push({
        styleKind: "apply",
        authoredAs: "class",
        // The comma list is the *target* half, measured: `class Busy,Done
        // urgent` styles both states. Empty segments are dropped so a
        // trailing comma costs nothing.
        targetIds: classApplyMatch[1]
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
        name: classApplyMatch[2],
        properties: [],
        line: lineNumber,
        column,
      });
      continue;
    }

    // A note, written onto the state it names. Read before the bare-state
    // and description patterns for the reason `classDef` is: neither may
    // claim a statement opening with one of the words this parser reserves.
    const noteMatch = NOTE_RE.exec(line);
    if (noteMatch !== null && isNotePosition(noteMatch[1])) {
      const [, position, targetId] = noteMatch;
      annotateState(
        targetId,
        position,
        readLabelIn(noteMatch, 3, lineNumber, column),
        lineNumber,
        column,
      );
      continue;
    }

    // Accepted and dropped on the floor, the second construct here read
    // without producing anything — see `FLOATING_NOTE_RE`: Mermaid parses it
    // and records nothing, so recording nothing is the compatible answer.
    if (FLOATING_NOTE_RE.test(line)) {
      continue;
    }

    const stateMatch = STATE_DECL_RE.exec(line);
    if (stateMatch !== null) {
      // A word of Mermaid's own, written where a state id belongs. Refused
      // rather than declared: Mermaid does not draw this document at all,
      // and drawing a box for it is the silently-wrong answer this replaces.
      // `state` never reaches here — `KEYWORD_ONLY_RE` above took it.
      if (RESERVED_WORD_RE.test(stateMatch[1])) {
        diagnostics.push({
          severity: "error",
          message: reservedWordRefusal(stateMatch[1], line),
          line: lineNumber,
          column,
        });
        sawError = true;
        continue;
      }
      declareState(stateMatch[1], lineNumber, column);
      continue;
    }

    const descriptionMatch = STATE_DESCRIPTION_RE.exec(line);
    if (descriptionMatch !== null) {
      describeState(
        descriptionMatch[1],
        readLabelIn(descriptionMatch, 2, lineNumber, column),
        lineNumber,
        column,
      );
      continue;
    }

    // The quoted spelling writes the same description onto the same state,
    // through the same call: the two are one construct, and the only
    // difference between the branches is which capture holds which half.
    const quotedMatch = QUOTED_DESCRIPTION_RE.exec(line);
    if (quotedMatch !== null) {
      describeState(
        quotedMatch[2],
        readLabelIn(quotedMatch, 1, lineNumber, column),
        lineNumber,
        column,
      );
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

  /**
   * The regions every divided block ended up with, and the two things that
   * can only be settled once the whole document has been read.
   *
   * A block's `--` count is not known while it is being read, so every
   * statement inside every block has recorded a region index and every
   * `direction` statement has been filed under the region it sat in. Here
   * the blocks that carried no `--` give both back: their members' indices
   * return to `null`, and the `direction` filed under their one notional
   * region lands on the composite itself, which is where an undivided
   * block's direction has always lived.
   *
   * `n` dividers make `n + 1` regions, including any that hold nothing —
   * measured: two `--` in a row report three dividers with the middle one
   * empty, so an empty region is a region and not a line to be collapsed.
   */
  const dividers = (parentId: string | null): number =>
    parentId === null ? 0 : (dividersByComposite.get(parentId) ?? 0);

  const regions: StateRegion[] = [];
  for (const state of states) {
    // A composite is authored, so its id is never `null` — the narrowing is
    // for the type, which allows one for the pseudo-states this skips.
    if (state.kind !== "composite" || state.id === null) {
      continue;
    }
    const compositeId = state.id;
    const count = dividers(compositeId);
    if (count === 0) {
      state.direction = directionByRegion.get(regionKey(compositeId, 0)) ?? null;
      continue;
    }
    for (let index = 0; index <= count; index++) {
      regions.push({
        parentId: compositeId,
        index,
        direction: directionByRegion.get(regionKey(compositeId, index)) ?? null,
      });
    }
  }
  for (const state of states) {
    if (dividers(state.parentId) === 0) {
      state.regionIndex = null;
    }
  }
  for (const transition of transitions) {
    if (dividers(transition.parentId) === 0) {
      transition.regionIndex = null;
    }
  }

  const document: StateDocument = {
    kind: "state",
    // `TB` is Mermaid's own default for a document that names no direction,
    // measured: the header alone reports `TB`.
    direction: documentDirection ?? "TB",
    states,
    transitions,
    regions,
    styles,
    timeline,
  };

  return { document, diagnostics };
}
