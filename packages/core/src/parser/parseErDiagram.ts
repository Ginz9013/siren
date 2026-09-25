import type {
  Diagnostic,
  Direction,
  ErAttribute,
  ErCardinality,
  ErDocument,
  ErEntityDecl,
  ErRelationshipDecl,
  ErRelationshipLine,
  ErSubgraph,
  ParseResult,
  SirenTimeline,
  StyleDecl,
} from "../contracts";
import { parseStyleProperties } from "./parseDeclarationList";
import { listAcceptedHeaders, matchDiagramHeader } from "./parseDirection";
import { isTimelineHeader, parseTimelineBody } from "./parseTimelineBlock";

/** The headers a diagnostic here names, asked of the one registry that accepts them. */
const ER_HEADERS = listAcceptedHeaders(["er"]);

/**
 * A line of nothing but relationship punctuation — never a name, however
 * freely the alphabet above admits `-` and `.`.
 *
 * Mermaid's four relationship bodies are `--`, `..`, `.-` and `-.`, and its
 * lexer reads them before it reads a name. Measured, one probe per line:
 * `-` and `.` are each a whole entity, and **every** run of two or more of
 * the two characters is a parse error — `--`, `---`, `..`, `...`, `.-`,
 * `-.`, `-.-` and `.--.` all refused, with "got 'IDENTIFYING'" and "got
 * 'NON_IDENTIFYING'" naming which token the lexer found. So the boundary is
 * length, not shape, and `{2,}` is the whole rule.
 *
 * Without this, `--` on a line of its own would be drawn as a box labelled
 * `--` for a document Mermaid does not render at all.
 */
const RELATIONSHIP_BODY_ONLY_RE = /^[-.]{2,}$/;

/**
 * A **bare** entity name — one, and the alphabet every pattern below reads
 * one in. A source fragment rather than a `RegExp`, because several patterns
 * embed it and two spellings of one alphabet would be two places to drift.
 *
 * **The alphabet is Mermaid's own, measured rather than borrowed.** Its ER
 * lexer reads a name as `([^\x00-\x7F]|\w|-|\*|\.)+` (mermaid 11.17.2), and
 * the probe agrees construct by construct: `LINE-ITEM`, `A_B`, `a1`,
 * `Order2`, `P.Q`, `Ünïcode` and `中文實體` each come back as one entity,
 * while `X$Y` is a parse error. This is a **different language** from a
 * flowchart, whose ids are `\w+` plus `.` and where a dashed id is still an
 * open gap — so `\w+` was not reusable here, and copying it would have
 * refused `LINE-ITEM`, which is ordinary ER.
 *
 * `-`, `.` and `*` are each a whole name on their own (measured: all three
 * report one entity), which is why there is no "must contain a letter"
 * guard: adding one would refuse three documents Mermaid draws — and why
 * `readEntityHead` needs `RELATIONSHIP_BODY_ONLY_RE` beside it.
 */
const NAME_SOURCE = "(?:[\\w*.-]|[^\\x00-\\x7F])+";

/**
 * A **quoted** entity name — the second spelling of a name, and the one that
 * has no alphabet at all.
 *
 * Measured (mermaid 11.17.2), one probe per claim:
 *
 * - `"Customer Account" ||--o{ ORDER : places` keys the entity on
 *   `Customer Account`, quotes **stripped**, with **no `alias` field**. So
 *   this is not the alias construct: an alias leaves the id alone and
 *   changes the drawn text, while quoting changes the id itself. The two
 *   draw the same box and only `data-siren-id` parts them.
 * - `"CUSTOMER:ORDER"` and `"subgraph:1"` both parse, keyed on exactly
 *   those strings. **Anything but a quote goes in**, which is why ADR-0010's
 *   "separate the two id spaces with a character neither can spell" does not
 *   hold for this kind and `reportIdCollisions` holds the invariant instead
 *   (`buildErModel`).
 * - `"--"` is an entity named `--`, where a bare `--` is a parse error — so
 *   `RELATIONSHIP_BODY_ONLY_RE` must not reach inside the quotes.
 * - `"  padded  "` is keyed on `  padded  `, spaces intact: **not trimmed**.
 *   Trimming would key two distinct Mermaid entities on one id.
 * - `""` is a **parse error** ("Expecting ... got 'WORD'"), hence `+` and
 *   never `*`.
 * - `"A"||--o{ B : x` parses, so the closing quote is a token boundary of
 *   its own and needs no space after it.
 */
const QUOTED_NAME_SOURCE = '"[^"\\r\\n]+"';

/**
 * Either spelling of one name, for every pattern that reads one. A single
 * fragment rather than a second copy per pattern, for the reason
 * `NAME_SOURCE` gives about itself.
 */
const ANY_NAME_SOURCE = `(?:${QUOTED_NAME_SOURCE}|${NAME_SOURCE})`;

/**
 * `"Customer Account"` → `Customer Account`; `CUSTOMER` → `CUSTOMER`.
 *
 * The one place the quotes come off, so that every stage after the parser
 * sees the id Mermaid's table is keyed on and nothing has to remember which
 * spelling wrote it. Deliberately no `trim()`: see `QUOTED_NAME_SOURCE`.
 */
const unquoteName = (name: string): string =>
  name.startsWith('"') ? name.slice(1, -1) : name;

/**
 * The words a **bare** ER name may never be, whatever the alphabet allows.
 *
 * ⚠️ **This is the guard a line-as-a-stream reader cannot do without, and it
 * was found by an existing corpus row breaking.** `NAME_SOURCE` spells every
 * one of these happily, so without it `readStatements` read
 * `subgraph sales` / ... / `end` as boxes called `subgraph`, `sales` and
 * `end` — three figures Mermaid draws no box for, silently, in place of the
 * cluster it does draw (`er-subgraph`).
 *
 * Measured one probe per word (mermaid 11.17.2), bare and mid-line: `end`,
 * `subgraph`, `class`, `style` and `classDef` are each a **parse error** on
 * a line of their own, and `A end B`, `A subgraph B` and `A style B` are
 * parse errors too. Case-insensitively — `STYLE`, `Style`, `End`,
 * `SubGraph` and `classdef` all refuse the same way — so this is one set
 * read without regard to case.
 *
 * ⚠️ **`title` is deliberately absent, and that is measured too.** The ER
 * grammar names a `title` terminal, but its lexer never emits one: `title My
 * Diagram` reports **three entities**, and `A title B` reports three as
 * well. So `title` is an ordinary ER name and refusing it would cost three
 * boxes Mermaid draws.
 *
 * A **quoted** name is not asked: quoting takes anything (measured), so
 * `"end"` is an ordinary entity.
 */
const RESERVED_BARE_NAMES: ReadonlySet<string> = new Set([
  "end",
  "subgraph",
  "class",
  "style",
  "classdef",
]);

/**
 * A name in the alphabet Mermaid's **style condition** reads one in — the
 * targets of a `style` and the names a `classDef` defines.
 *
 * ⚠️ **A different alphabet from `NAME_SOURCE`, by one character, and that
 * is measured rather than tidy.** `style\b` and `classDef\b` each call
 * `this.begin("style")` (mermaid 11.17.2), and that condition's word rule is
 * `([^\x00-\x7F]|\w|-|\*)+` — the entity rule **without the `.`**. So an
 * entity Mermaid is perfectly happy to declare cannot be reached by a
 * `style` statement at all: measured, `P.Q` is one entity and
 * `style P.Q fill:red` is a **lexical error** in the same document, while
 * `class P.Q u` styles it. Spelling one alphabet for both would accept a
 * document Mermaid draws no picture for.
 */
const STYLE_NAME_SOURCE = "(?:[\\w*-]|[^\\x00-\\x7F])+";

/** One or more names of `source`, comma-separated — Mermaid's `idList`. */
const idListSource = (source: string): string => `${source}(?:\\s*,\\s*${source})*`;

/**
 * `style ORDER fill:#f96,stroke:#333` — declarations applied straight to one
 * or more entities, and the **only** statement in this kind that is read to
 * the end of its line.
 *
 * ⚠️ **It swallows everything after it, and that is the load-bearing half.**
 * `style\b` switches the lexer into its `style` condition, and the only rule
 * that leaves that condition is `[\n]+` — so the declaration list runs to the
 * newline however many words are in it. Measured one probe apiece (mermaid
 * 11.17.2):
 *
 * - `A style B fill:#f96 C` reports **one** entity, `A`. No `C`: the trailing
 *   word is another `styleComponent`, not a statement. A reader that returned
 *   to the statement stream after the declarations would draw a box Mermaid
 *   draws none for.
 * - `A style B fill:#f96` reports one entity too, so `style` is an ordinary
 *   mid-line statement rather than a line class — and naming a target does
 *   **not** declare it.
 * - `style A fill:red;B` is a **parse error**: `;` ends the declaration list
 *   without leaving the condition, so what follows has nowhere to go.
 *
 * The target list is `idList` — comma-separated, measured on `class` below
 * and the same non-terminal in Mermaid's grammar for all three statements.
 *
 * ⚠️ Not anchored on the end of the line for the reason every other pattern
 * here is not: `rest` is whatever the statement stream has left, and this
 * pattern's `.+` is what makes that remainder its own.
 */
const STYLE_RE = new RegExp(`^style\\b\\s+(${idListSource(STYLE_NAME_SOURCE)})\\s+(.+)$`, "iu");

/**
 * `classDef urgent fill:#f96,stroke:#333` — a named set of declarations,
 * applied to nothing on its own.
 *
 * `classDef\b` calls `this.begin("style")` exactly as `style\b` does, so
 * everything `STYLE_RE` says about swallowing the line and about the
 * alphabet holds here too, and the names are read in `STYLE_NAME_SOURCE`
 * rather than the entity alphabet for the same measured reason.
 *
 * **The name half is an `idList`, so one statement may define several.**
 * Measured: `classDef a,b fill:red` beside `class A b` paints `A` red, so
 * `b` really was defined by that one line. Each becomes a `StyleDecl` of its
 * own, which is what lets `resolveStyles` keep `name` a single string across
 * all five kinds.
 *
 * Read before `CLASS_RE`, which is Mermaid's own rule order (rule 41 before
 * rule 42) — though neither can claim the other's line, because `class\b`
 * needs a word boundary and `classDef` has none after `class`.
 */
const CLASS_DEF_RE = new RegExp(
  `^classDef\\b\\s+(${idListSource(STYLE_NAME_SOURCE)})\\s+(.+)$`,
  "iu",
);

/**
 * `class ORDER urgent` — the apply-directive as a statement of its own.
 *
 * ⚠️ **`class\b` does *not* switch the lexer condition**, unlike its two
 * neighbours, and three measured differences follow from that one fact:
 *
 * - Its operands are read in the **entity** alphabet, `.` included, so
 *   `class P.Q u` styles the entity `P.Q` that `style P.Q fill:red` cannot
 *   reach at all.
 * - It does **not** swallow the line. Measured, `class A urgent B` styles
 *   `A` *and* declares an entity `B` — Mermaid's rule is
 *   `CLASS idList idList` with no separator after it, so the statement ends
 *   the moment its second `idList` does.
 * - A **quoted** name is refused: measured, `class "Customer Account" u` is
 *   a parse error ("got 'ENTITY_NAME'"), because `idList` takes only
 *   `UNICODE_TEXT` and `STYLE_TEXT`. This pattern reads no quoted name, and
 *   the line then falls to `RESERVED_BARE_NAMES` and is refused — which is
 *   the same answer.
 *
 * ⚠️ **Both halves are `idList`, and that is this kind's own measurement.**
 * `class A,B urgent` styles both entities *and* `class A alpha,beta` gives
 * `A` both classes. A state diagram splits only the **target** half
 * (`class Busy alpha,beta` is one class literally named `alpha,beta`
 * there), so the symmetry could not be carried across and had to be
 * measured here.
 */
const CLASS_RE = new RegExp(
  `^class\\b\\s+(${idListSource(NAME_SOURCE)})\\s+(${idListSource(NAME_SOURCE)})`,
  "iu",
);

/**
 * The class **every ER entity already wears**, and the one name a `classDef`
 * here may not define.
 *
 * Measured from Mermaid's own database (11.17.2): `addEntity` creates each
 * entity with `cssClasses: "default"`, and `getCompiledStyles` resolves a
 * node's paint from `cssClasses.split(" ")`. So `classDef default fill:#abc`
 * beside a bare `A` paints `A` — confirmed with `--markup`,
 * `style="fill:#abc !important"` on its box — with no `class` statement
 * anywhere in the document.
 *
 * Siren has no implicit class in any kind, so reading this statement and
 * applying it to nothing draws a **different picture with no diagnostic**,
 * which is the one failure the compatibility condition rules out outright.
 * It is refused by name in `UNIMPLEMENTED` instead, and this is the constant
 * both halves of that refusal are spelled from.
 *
 * Case-sensitive, and that too is measured: `classDef DEFAULT fill:red`
 * keys Mermaid's class map on `DEFAULT`, which no entity's `cssClasses`
 * names, so it paints nothing there either — and nothing here. The two
 * agree, so there is nothing to refuse.
 *
 * ⚠️ **The same gap exists in `parseFlowchart` and is not this ticket's.**
 * Measured on Siren itself, `flowchart TB / classDef default fill:#abc / A`
 * reports no diagnostic and no style, exactly the silent divergence refused
 * here — an unrowed defect that predates ER styling.
 */
const DEFAULT_CLASS_NAME = "default";

/**
 * Every spelling of a cardinality, punctuation and words alike, and the
 * figure each stands for — measured one probe per spelling (mermaid
 * 11.17.2). The words are a **synonym** rather than a second construct:
 * `A one to zero or many B : x` reaches the same record as
 * `A ||--o{ B : x`.
 *
 * **Both mirror images of each pair are legal on either side**, measured
 * rather than assumed: `A o|--o{ B` reports `ZERO_OR_ONE` on the left just
 * as `A |o--o{ B` does, and `A |{--o{ B` reports `ONE_OR_MORE` just as
 * `A }|--o{ B` does. So this is one table read from both ends, not a left
 * table and a right one.
 *
 * `u` — Mermaid's fifth cardinality, `MD_PARENT` — is deliberately absent;
 * see `UNIMPLEMENTED` for what happens to it and why.
 */
const CARDINALITY_BY_SPELLING: Readonly<Record<string, ErCardinality>> = {
  "||": "onlyOne",
  one: "onlyOne",
  "only one": "onlyOne",
  "1": "onlyOne",

  "|o": "zeroOrOne",
  "o|": "zeroOrOne",
  "zero or one": "zeroOrOne",
  "one or zero": "zeroOrOne",

  "}o": "zeroOrMore",
  "o{": "zeroOrMore",
  "zero or more": "zeroOrMore",
  "zero or many": "zeroOrMore",
  "many(0)": "zeroOrMore",
  many: "zeroOrMore",
  "0+": "zeroOrMore",

  "}|": "oneOrMore",
  "|{": "oneOrMore",
  "one or more": "oneOrMore",
  "one or many": "oneOrMore",
  "many(1)": "oneOrMore",
  "1+": "oneOrMore",
};

/**
 * Every spelling of a relationship body, and the line each draws. Measured:
 * `--` and `to` report `IDENTIFYING`; `..`, `.-`, `-.` and `optionally to`
 * report `NON_IDENTIFYING` — six spellings of two values.
 */
const LINE_BY_SPELLING: Readonly<Record<string, ErRelationshipLine>> = {
  "--": "identifying",
  to: "identifying",
  "..": "nonIdentifying",
  ".-": "nonIdentifying",
  "-.": "nonIdentifying",
  "optionally to": "nonIdentifying",
};

/**
 * One alternation over `spellings`, longest first so `}|` is never read as
 * `}` plus something and `one or more` is never read as `one`.
 *
 * A spelling ending in a word character gets a `\b`, because Mermaid's own
 * rules do (`one\b`, `to\b`, `many\b`) and its entity-name rule is the
 * longest match otherwise. That `\b` is what keeps `A oneto 0+ B : x` out:
 * Mermaid reads `oneto` as one entity name and then has no cardinality, and
 * without the boundary this would read it as `one` + `to`. The spellings
 * that end in punctuation — `1+`, `0+`, `many(0)`, `||` — get none, and
 * that too is measured: `A 1+to 0+ B : x` is a relationship in Mermaid.
 */
const alternation = (spellings: readonly string[]): string =>
  [...spellings]
    .sort((a, b) => b.length - a.length)
    .map(
      (spelling) =>
        spelling.replace(/[|{}.*+?^$()[\]\\]/g, "\\$&") + (/\w$/.test(spelling) ? "\\b" : ""),
    )
    .join("|");

/**
 * One relationship:
 * `<entity> <cardinality> <body> <cardinality> <entity> : <label>`, in
 * either spelling of each of the three middle tokens — **and they mix**,
 * measured: `A one --o{ B : x` and `A ||.. many B : x` are both
 * relationships, so each token is chosen independently rather than the line
 * being in "word mode" or "punctuation mode".
 *
 * Whitespace between tokens is `\s*`, because Mermaid's lexer skips it and
 * needs none: `A||--o{B : x`, `A ||-- o{ B : x` and `A || --o{ B : x` all
 * report the same relationship as the spaced spelling.
 *
 * **The one boundary that is not optional is the left entity's.** `o` is in
 * the entity-name alphabet, and Mermaid's longest-match lexer swallows it:
 * measured, `Ao|--o{ B : x` and `Ao{--|| B : x` are both *parse errors*,
 * because the name comes back `Ao` and what is left is not a cardinality.
 * A word spelling is swallowed the same way (`Aone--o{ B : x`). So the left
 * cardinality may be glued to the name only when it starts with `|` or `}`,
 * neither of which a name can contain — which is exactly what the lookahead
 * below says. Everything to the right of the body is safe with `\s*`,
 * because the lexer starts a fresh token after one.
 *
 * The label is one token or a quoted string, and that is the boundary
 * Mermaid draws too — measured, `A ||--o{ B : two words` reports the role
 * as `two` and then declares a **third entity** called `words`. Reading the
 * whole tail as the label would draw a label Mermaid does not.
 */
const RELATIONSHIP_SOURCE =
  `^(${ANY_NAME_SOURCE})(?:\\s*(?=[|}])|\\s+)(${alternation(Object.keys(CARDINALITY_BY_SPELLING))})` +
  `\\s*(${alternation(Object.keys(LINE_BY_SPELLING))})\\s*` +
  `(${alternation(Object.keys(CARDINALITY_BY_SPELLING))})\\s*(${ANY_NAME_SOURCE})` +
  `\\s*:\\s*(${QUOTED_NAME_SOURCE}|${NAME_SOURCE})`;

/**
 * ⚠️ **Not anchored on the end of the line.** Mermaid's grammar is
 * `statements: statement | statements statement`, so a line is a *stream* of
 * statements and a relationship is only ever a prefix of what is left of one
 * — measured, `A ||--o{ B : two words` is a relationship labelled `two`
 * **plus a third entity** called `words`, and `A ||--o{ B : x C ||--o{ D :
 * y` is two relationships. `readStatements` is what reads the rest.
 */
const RELATIONSHIP_RE = new RegExp(RELATIONSHIP_SOURCE, "iu");

/**
 * The relationship at the head of `text`, and how many characters it took —
 * or `null` when `text` does not begin with one.
 *
 * Returns the whole declaration rather than a boolean so the caller cannot
 * read the two cardinalities back in the wrong order: `left` and `right`
 * are the source's own, and Mermaid's crossed `cardA`/`cardB` are never
 * spoken here (see `ErRelationshipDecl`).
 */
function readRelationship(
  text: string,
): { decl: ErRelationshipDecl; length: number } | null {
  const match = RELATIONSHIP_RE.exec(text);
  if (match === null) {
    return null;
  }
  const [, left, leftMarker, body, rightMarker, right, rawLabel] = match;
  const label = unquoteName(rawLabel);
  // Lower-cased for the lookup because Mermaid's lexer rules are all `/i` —
  // measured, `A ZERO OR ONE to many B : x` reports `ZERO_OR_ONE`, so the
  // shouted spelling is the same construct and not an entity called `ZERO`.
  const spelling = (marker: string) => marker.toLowerCase().replace(/\s+/g, " ");
  // The same over-reach guard the name alphabet needs, for the same reason:
  // `-` is a whole label on its own (measured, reported as `label="-"`),
  // and admitting it admits `--`, which Mermaid reads as a relationship
  // body and refuses ("got 'IDENTIFYING'").
  if (RELATIONSHIP_BODY_ONLY_RE.test(label)) {
    return null;
  }
  // And the reserved words, at each of the three places this pattern reads a
  // bare one. Measured: `A ||--o{ end : x`, `style ||--o{ B : x` and
  // `A ||--o{ B : end` are each refused by Mermaid — the last two as
  // *lexical* errors, because the lexer emits a keyword token wherever those
  // letters stand alone. Quoted, they are ordinary text again, which is why
  // this asks about the raw match and not the unquoted string.
  if ([left, right, rawLabel].some((text) => RESERVED_BARE_NAMES.has(text.toLowerCase()))) {
    return null;
  }
  return {
    decl: {
      // Unquoted here, once, so that every stage after this one sees the id
      // Mermaid's own table is keyed on — measured, `"Customer Account"
      // ||--o{ ORDER : places` reports `leftEntity="Customer Account"` with
      // the quotes gone.
      left: unquoteName(left),
      leftCardinality: CARDINALITY_BY_SPELLING[spelling(leftMarker)],
      line: LINE_BY_SPELLING[spelling(body)],
      rightCardinality: CARDINALITY_BY_SPELLING[spelling(rightMarker)],
      right: unquoteName(right),
      label,
    },
    length: match[0].length,
  };
}

/**
 * The document's own rank-direction statement, as its four **greedy** lexer
 * rules — one per value, in Mermaid's own order.
 *
 * ⚠️ **This rule eats its whole line, and that is measured rather than
 * inferred.** Mermaid's is `/^(?:.*direction\s+LR[^\n]*)/i`, with a leading
 * `.*` and a trailing `[^\n]*`, so it matches from the start of a line
 * whenever the keyword and one of the four values appear anywhere in it and
 * swallows everything on both sides. One probe per claim (11.17.2):
 *
 * - `XX direction LR` sets `LR` and declares **no** entity.
 * - `direction LRX` sets `LR`; the trailing `[^\n]*` takes the `X`.
 * - `mydirection LRA` sets `LR` too — the leading `.*` reaches inside a
 *   word.
 * - `A ||--o{ B : x direction LR` sets `LR` and reports **no entities and
 *   no relationship at all**.
 * - `accTitle: direction LR` sets `LR` and records **no accessible title**,
 *   which is why this is read before `ACC_TITLE_RE`.
 *
 * **Four values and `TD` is not one of them.** The ER lexer writes
 * `TB`/`BT`/`RL`/`LR` out literally and the flowchart's `TD` alias does not
 * reach this grammar, so `direction TD` matches nothing here and is two
 * ordinary entities (measured) — which the statement reader then finds.
 *
 * **The order is the tie-break**, measured on four pairs: `direction LR
 * direction TB` and `direction TB direction LR` both report `TB`,
 * `direction RL direction BT` reports `BT`, and `direction LR direction RL`
 * reports `RL`. Every one of the four rules matches such a line to the same
 * end, and jison breaks an equal-length tie by rule order — `direction_tb`,
 * `direction_bt`, `direction_rl`, `direction_lr`, read out of its own symbol
 * table. So it is **not** "the last one wins".
 *
 * Case-insensitive because the lexer is: `direction lr` reports `LR`.
 *
 * ⚠️ Read before every other statement but, like all of them, **after** the
 * in-block reader — measured, `direction LR` written *inside* an attribute
 * block is an attribute (`type="direction" name="LR"`), and the block reader
 * is what keeps it one.
 */
const DIRECTION_RULES: readonly { value: Direction; pattern: RegExp }[] = (
  ["TB", "BT", "RL", "LR"] as const
).map((value) => ({ value, pattern: new RegExp(`^.*direction\\s+${value}[^\\n]*$`, "i") }));

/** The direction `line` sets, or `null` when it sets none. */
function readDirection(line: string): Direction | null {
  return DIRECTION_RULES.find(({ pattern }) => pattern.test(line))?.value ?? null;
}

/**
 * `accTitle: text` and `accDescr: text` — the diagram's screen-reader-only
 * title and description, spelled exactly as `parseFlowchart`'s and
 * `parseSequenceDiagram`'s copies of the same two patterns. The colon is
 * required.
 *
 * **Measured for this kind rather than carried over.** `erDiagram` with
 * both statements under it reports the same two entities as the document
 * without them, so neither puts a box on the canvas; and the SVG real
 * Mermaid renders for it carries `aria-labelledby` and `aria-describedby`
 * pointing at a `<title>` and a `<desc>` that hold those strings — the
 * flowchart's arrangement exactly, `role` and all (see
 * `renderErDiagramToSVG`).
 *
 * Read before the entity patterns for the reason `DIRECTION_RE` is: both
 * words are in the entity-name alphabet, so a reader asking "is this a
 * name?" first would find one. The colon is what keeps a bare entity called
 * `accTitle` out of here — and a bare `accTitle` **is** an ordinary entity
 * (measured), so that boundary is load-bearing rather than tidy.
 *
 * Mermaid's braced multi-line spelling, `accDescr { ... }`, is deliberately
 * unread — the same line `parseFlowchart` draws — and refused by name in
 * `UNIMPLEMENTED` below, because `ENTITY_HEAD_RE` would otherwise read it
 * as an entity called `accDescr` opening an attribute block.
 */
const ACC_TITLE_RE = /^accTitle:\s*(.+)$/;
const ACC_DESCR_RE = /^accDescr:\s*(.+)$/;

/**
 * The opening line of Mermaid's **braced** `accDescr { ... }`, which this
 * parser recognizes only in order to refuse it by name.
 *
 * Measured (mermaid 11.17.2): `accDescr {` / `a long description` / `}`
 * beside `CUSTOMER` reports **one** entity, `CUSTOMER` — so the block is a
 * description and not an entity with attributes. That is `accDescr`'s alone:
 * `accTitle {` has no such rule, and `accTitle {` / `x` / `}` is a *parse
 * error* in Mermaid ("Expecting 'ATTRIBUTE_WORD'"), which is exactly an
 * entity called `accTitle` opening an attribute block with a malformed one
 * inside — the reading this parser already gives it.
 *
 * Read **before** `ENTITY_HEAD_RE`, unlike every other `UNIMPLEMENTED`
 * entry, because that pattern matches this line and would draw a box called
 * `accDescr` for a document Mermaid draws no box for at all.
 *
 * ⚠️ **This was a silently wrong picture, not merely a missing one.**
 * Measured, `accDescr {` / `string x` / `}` beside `CUSTOMER` reports one
 * entity in Mermaid; without this guard the block's body reads as a
 * perfectly well-formed attribute, so Siren drew **two** boxes — `CUSTOMER`
 * and an `accDescr` carrying a `string x` row — with no diagnostic at all.
 * A body that happens not to parse as attributes was refused instead, which
 * is why the defect could sit here unseen: it only shows when the
 * description is written in two words that look like a type and a name.
 */
const ACC_DESCR_BRACED_RE = /^accDescr\s*\{$/;

/**
 * `subgraph s1`, `subgraph s1["My Title"]`, `subgraph s1 [Bracket Title]` —
 * a cluster's opening line, and the **one statement in this kind that owns
 * its whole line**.
 *
 * ⚠️ **Anchored on the end of the line, unlike every other pattern here,
 * and that is measured rather than cautious.** Mermaid's rule is
 * `subgraphHeader: SUBGRAPH entityName separator`, so the header needs a
 * separator after it and the only one that works is a newline: measured
 * (mermaid 11.17.2), `subgraph s1 A end` is a parse error ("Expecting
 * 'EOF', 'NEWLINE', 'SQS', 'SEMI', got 'UNICODE_TEXT'") and `subgraph s1;`
 * is a parse error too ("got ';'"). A pattern that let the statement stream
 * carry on after the header would accept a document Mermaid draws no
 * picture for. Its closing `end` is the exact opposite — an ordinary
 * statement in that stream, read in `readLine` — and the asymmetry is
 * Mermaid's, measured on both halves: `A end` closes the block after
 * declaring `A`, and `end B` declares `B` outside it.
 *
 * **The name is mandatory and is an ER entity name, either spelling.**
 * Measured: a bare `subgraph` is a parse error, `subgraph a.b` keys the
 * block on `a.b`, `subgraph "My Cluster"` keys it on `My Cluster` with the
 * quotes stripped, and `subgraph My Cluster` unquoted is a parse error. So
 * this reads `ANY_NAME_SOURCE` and nothing wider — a flowchart's
 * `subgraph Two Words` does not reach this grammar.
 *
 * **The bracketed title is optional and its quotes are optional too.**
 * Measured, `s1["My Title"]` and `s1 [Bracket Title]` both answer with the
 * text between the brackets, and `s1[a   b]` answers `"a b"` — Mermaid's
 * `subgraphTitle` is a list of words joined with a single space, which is
 * why `subgraphTitleOf` below collapses a run of whitespace instead of
 * carrying it.
 */
const SUBGRAPH_HEAD_RE = new RegExp(
  `^subgraph\\b\\s*(${ANY_NAME_SOURCE})(?:\\s*\\[\\s*([^\\]\\r\\n]+?)\\s*\\])?$`,
  "iu",
);

/**
 * The text a header's brackets drew, as Mermaid joins it: quotes off if it
 * wrote any, and every run of whitespace inside it one space.
 *
 * The quotes are stripped by `unquoteName` rather than by a branch of the
 * pattern above, so the one place this file takes quotes off stays one
 * place.
 */
function subgraphTitleOf(raw: string): string {
  return unquoteName(raw).replace(/\s+/g, " ");
}

/**
 * `end` — the statement that closes a cluster, spelled as Mermaid's own
 * lexer rule `end\b\s*`, trailing whitespace and all.
 *
 * **A statement in the line's stream and not a line class**, measured both
 * ways round (mermaid 11.17.2): `A end` declares `A` inside the block and
 * then closes it, and `end B` closes the block and then declares `B`
 * outside it. A reader that required `end` to stand alone would refuse two
 * documents Mermaid draws.
 *
 * Read **after** the three styling statements, because `style\b` and
 * `classDef\b` switch Mermaid's lexer into a condition where `end` is an
 * ordinary word — measured, `style end fill:red` is a `style` statement
 * targeting a name called `end`, not a block being closed.
 */
const END_RE = /^end\b\s*/iu;

/**
 * An entity's **head**: its name, its alias if it wrote one, and the brace
 * that opens its attribute block if it opened one.
 *
 * One pattern rather than two, because the two constructs compose and
 * Mermaid composes them in one place: measured, `CUSTOMER["Customer
 * Account"] {` with `string n` under it reports a single entity carrying
 * both the alias and the attribute. Read by two patterns, whichever ran
 * second would have to re-read the name, and a document writing both would
 * reach only one of them.
 *
 * **The alias.** Measured (mermaid 11.17.2): `CUSTOMER["Customer Account"]`
 * comes back `label="CUSTOMER" alias="Customer Account"`, so the brackets
 * add a field and do not rename the entity — and the box draws the alias
 * (measured with `--markup`). Three boundaries, each measured:
 *
 * - **The quotes are required and may not be empty.** `A[""]` is a parse
 *   error in Mermaid ("Expecting 'UNICODE_TEXT', ... got 'WORD'"), so
 *   `[^"]+` rather than `[^"]*`.
 * - **`A [ "spaced" ]` is the same entity** — measured, alias `spaced` —
 *   because the lexer skips whitespace between tokens, so `\s*` sits at
 *   each seam.
 * - **The line has to end there.** Measured, `A["one"] ||--|| B : r` is a
 *   *parse error* in Mermaid — an alias does not attach to a relationship —
 *   so a pattern that let the line run on would draw a relationship Mermaid
 *   refuses.
 *
 * The one alias spelling it deliberately does *not* read is Mermaid's
 * bracketless one: `A[Unquoted]` is an alias there too (measured), and it is
 * refused **by name** in `UNIMPLEMENTED` rather than half-read, for the
 * reason the bracketless alias is.
 *
 * **The brace needs no line of its own.** It is a *mode switch* rather than
 * a line ending — measured, `E { string a }` and the three-line spelling
 * report the same record — so this pattern says only that a block opened
 * here, and `readLine` reads whatever follows in the block's own alphabet.
 *
 * ⚠️ **Both trailing groups are optional, so this reads a bare name too** —
 * which is the whole point now that a line is a stream: a name, a name with
 * an alias, and a name opening a block are one statement with two optional
 * tails, and measured they mix freely within a line. `A["x"] B` is an
 * aliased `A` and a bare `B`, `A B["x"]` is a bare `A` and an aliased `B`,
 * and `A B {` with `string n` under it puts that attribute on **`B`**.
 *
 * The name is either spelling (`ANY_NAME_SOURCE`), because the two
 * constructs compose: measured, `"A B" ["alias"]` reports `label="A B"
 * alias="alias"`, and `"A B" {` with `string n` under it reports that entity
 * carrying that attribute.
 *
 * **And `:::`, between the alias and the brace** — the apply-directive
 * written onto the declaration instead of as a statement of its own. It is
 * a third optional tail rather than a pattern of its own for the reason the
 * alias is not one: measured (mermaid 11.17.2), Mermaid has a separate
 * grammar production for every combination — `A:::u`, `A["Alias"]:::u`,
 * `A:::u { ... }`, `A["Alias"]:::u { ... }` — and in every one of them the
 * `:::` sits **after** the brackets and **before** the brace. The other
 * order is refused: `A:::u["Alias"]` is a parse error ("got 'SQS'"), so a
 * pattern that read the three tails in any order would accept a document
 * Mermaid draws no picture for.
 *
 * Its class list is an `idList` in the **entity** alphabet — `:::` changes
 * no lexer condition, so `A:::alpha,beta` gives `A` both classes exactly as
 * `class A alpha,beta` does (measured). `A:::` alone is a parse error, which
 * is why the group is `+` and not `*`.
 *
 * ⚠️ Not anchored on the end of the line — see `RELATIONSHIP_RE`.
 */
const ENTITY_HEAD_RE = new RegExp(
  `^(${ANY_NAME_SOURCE})(?:\\s*\\[\\s*"([^"\\r\\n]+)"\\s*\\])?` +
    `(?::::(${idListSource(NAME_SOURCE)}))?(\\s*\\{)?`,
  "u",
);
const ATTRIBUTE_BLOCK_CLOSE = "}";

/** One entity head, as `ENTITY_HEAD_RE` read it, and how much it took. */
interface ErEntityHead {
  name: string;
  alias: string | null;
  /** The classes a `:::` applied to it, in source order; empty when it wrote none. */
  classes: string[];
  opensBlock: boolean;
  length: number;
}

/**
 * The entity at the head of `text`, or `null` when `text` does not begin
 * with one.
 */
function readEntityHead(text: string): ErEntityHead | null {
  const match = ENTITY_HEAD_RE.exec(text);
  if (match === null) {
    return null;
  }
  const [whole, name, alias, classes, brace] = match;
  // The over-reach guard the name alphabet needs: `-` and `.` are each a
  // whole name, so the alphabet admits `--`, which Mermaid's lexer reads as
  // a relationship body and refuses. Quoted, the same characters *are* a
  // name (measured, `"--"` is an entity), so this only ever asks about the
  // bare spelling.
  if (
    !name.startsWith('"') &&
    (RELATIONSHIP_BODY_ONLY_RE.test(name) || RESERVED_BARE_NAMES.has(name.toLowerCase()))
  ) {
    return null;
  }

  return {
    name: unquoteName(name),
    alias: alias ?? null,
    classes: classes === undefined ? [] : splitIdList(classes),
    opensBlock: brace !== undefined,
    length: whole.length,
  };
}

/** Everything one line declares, read left to right. */
interface ErLineReading {
  /** The entities named, in source order, relationship endpoints included. */
  entities: ErEntityDecl[];
  /** The relationships named, in source order. */
  relationships: ErRelationshipDecl[];
  /**
   * The styling statements named, in source order, already stamped with the
   * position of the line that wrote them.
   */
  styles: StyleDecl[];
  /**
   * The segments of a declaration list that were not `property:value` pairs
   * — handed back rather than diagnosed here, because this reader has no
   * diagnostics list and the caller is the one holding the line's position.
   */
  malformedStyles: string[];
  /**
   * The entity whose attribute block is still open where the line ends, or
   * `null` when none is — the reader's mode, handed back so the next line
   * starts in it.
   */
  openEntity: ErEntityDecl | null;
  /**
   * Every entity this line declared paired with the `subgraph` block that
   * was open where it stood, in source order — `null` for one declared
   * outside every block.
   *
   * Handed back rather than written straight onto the block, because this
   * reader is all-or-nothing: a line it cannot finish must claim no members
   * at all, exactly as it contributes no boxes. The caller replays this
   * once the whole line has read.
   */
  memberships: { name: string; block: ErSubgraph | null }[];
  /**
   * How many `subgraph` blocks are still open where the line ends — the
   * `end` statements it read, subtracted from the depth it began at.
   *
   * A count rather than a stack, because `end` only ever pops: a header
   * owns its own line (`SUBGRAPH_HEAD_RE`), so nothing inside a line can
   * push. The caller truncates its own stack to this.
   */
  remainingOpenBlocks: number;
}

/**
 * Everything `line` declares, given the block it began inside — or `null`
 * when any part of it is unreadable.
 *
 * **A line is a stream, not a statement.** Mermaid's grammar is `statements:
 * statement | statements statement` with no separator of its own, so
 * `CUSTOMER ORDER LINE-ITEM` is **three** entities (measured) and the
 * whole-line anchor this reader replaced refused an ordinary document
 * outright. Three gaps that looked separate are this one construct:
 * `direction TD` is two entities because no direction rule matches it,
 * `A ||--o{ B : two words` is a relationship labelled `two` plus an entity
 * called `words`, and `A B ||--o{ C : x` is a bare `A` before a
 * relationship between `B` and `C`.
 *
 * ⚠️ **And the braces are inside that stream, not around it.** An attribute
 * block is a *lexer condition* rather than a run of lines: `{` switches in,
 * `}` pops straight back out (`popState(); return 18`), and a newline means
 * nothing to either — Mermaid's block condition skips newlines with a rule
 * of its own. Measured, one probe apiece: `E { string a }` and the
 * three-line spelling report the **same** record; `E { string a } F` is that
 * entity and then a bare `F`; `A B { string a }` puts the attribute on `B`;
 * `E { string a } A ||--o{ B : x` is a filled block and then a relationship;
 * and a block may equally open mid-line and close two lines later, or open
 * on its own line and close mid-line with statements after it. That is why
 * the open entity is a *parameter* here rather than a line class the caller
 * decides between: the mode changes mid-line, so only the reader that walks
 * the line can track it.
 *
 * **A relationship is tried before a name**, because it begins with one: a
 * name-first reader would take `A` out of `A ||--o{ B : x` and then find
 * `||--o{ B : x` unreadable.
 *
 * All-or-nothing on purpose, and that is why the attributes are buffered
 * rather than appended as they are read: a half-read line would put some of
 * its boxes on the canvas and drop the rest silently, and an entity that
 * arrived on an earlier line would keep the attributes of a line that was
 * refused. Returning `null` costs the document and says so, which is the
 * trade every refusal in this parser makes.
 */
function readLine(
  line: string,
  openEntity: ErEntityDecl | null,
  where: { line: number; column: number },
  openBlocks: readonly ErSubgraph[],
): ErLineReading | null {
  const entities: ErEntityDecl[] = [];
  const relationships: ErRelationshipDecl[] = [];
  const styles: StyleDecl[] = [];
  const malformedStyles: string[] = [];
  const memberships: { name: string; block: ErSubgraph | null }[] = [];
  /**
   * How deep into `openBlocks` the reader still is. Decremented by `end`,
   * and the block at the top of what is left is the one an entity declared
   * here belongs to.
   */
  let depth = openBlocks.length;
  const claim = (name: string): void => {
    memberships.push({ name, block: depth === 0 ? null : openBlocks[depth - 1] });
  };
  /**
   * The attributes each entity gained on this line, held back until the
   * whole line has been read — see the all-or-nothing paragraph above.
   */
  const appends: { entity: ErEntityDecl; attributes: ErAttribute[] }[] = [];
  let open = openEntity;
  let rest = line;

  while (rest.length > 0) {
    if (open !== null) {
      // Inside the block condition, where `}` is the way out and everything
      // else is attributes. Read before the statement patterns, because the
      // alphabets overlap: `string name` is two words, and a reader that
      // asked "is this an entity name?" first would find `string` and
      // declare a box.
      if (rest.startsWith(ATTRIBUTE_BLOCK_CLOSE)) {
        open = null;
        rest = rest.slice(ATTRIBUTE_BLOCK_CLOSE.length).trimStart();
        continue;
      }
      const read = readAttributes(rest);
      if (read === null) {
        return null;
      }
      appends.push({ entity: open, attributes: read.attributes });
      rest = rest.slice(read.length).trimStart();
      continue;
    }

    // The styling statements, read **before** the entity patterns, because
    // every one of their keywords is spelled by the name alphabet and a
    // reader asking "is this a name?" first would find one. They stay out of
    // `RESERVED_BARE_NAMES`' way rather than replacing it: measured, those
    // same words are still refused where a *name* belongs (`A ||--o{ style :
    // x` is a parse error), so the reservation is what a word falls back to
    // once no statement here has claimed it.
    const style = STYLE_RE.exec(rest);
    if (style !== null) {
      const { properties, malformed } = parseStyleProperties(style[2]);
      malformedStyles.push(...malformed);
      styles.push({
        styleKind: "style",
        authoredAs: "style",
        targetIds: splitIdList(style[1]),
        name: null,
        properties,
        line: where.line,
        column: where.column,
      });
      // The whole remainder of the line, not `style[0].length`: the lexer
      // stays in its `style` condition until the newline, so there is no
      // statement after this one to return to. See `STYLE_RE`.
      break;
    }

    const classDef = CLASS_DEF_RE.exec(rest);
    if (classDef !== null) {
      const names = splitIdList(classDef[1]);
      // ⚠️ **`default` is a class every ER entity already wears**, so this
      // one name reaches boxes no statement mentions — see
      // `IMPLICIT_DEFAULT_CLASS_RE`. Refused rather than read, because
      // reading it and applying it to nothing would draw a different picture
      // from Mermaid's with no diagnostic at all.
      if (names.includes(DEFAULT_CLASS_NAME)) {
        return null;
      }
      const { properties, malformed } = parseStyleProperties(classDef[2]);
      malformedStyles.push(...malformed);
      // One `StyleDecl` per name, because `name` is a single string in the
      // shared contract and `classDef a,b fill:red` defines two — measured.
      // The declarations are the same list for each, and a malformed one is
      // reported once, at the line that wrote it, rather than once per name.
      for (const name of names) {
        styles.push({
          styleKind: "classDef",
          authoredAs: "classDef",
          targetIds: [],
          name,
          properties,
          line: where.line,
          column: where.column,
        });
      }
      // Swallows the line for the reason `style` does: same lexer condition.
      break;
    }

    const apply = CLASS_RE.exec(rest);
    if (apply !== null) {
      // One `StyleDecl` per class name, in the order the author wrote them
      // — which is what gives the stacking its answer: measured, a later
      // class wins a property both name (`class A alpha,beta` paints
      // `beta`'s fill) while a property only the earlier one names survives,
      // and that is exactly what `resolveStyles` does with a sequence of
      // applications.
      for (const name of splitIdList(apply[2])) {
        styles.push({
          styleKind: "apply",
          authoredAs: "class",
          targetIds: splitIdList(apply[1]),
          name,
          properties: [],
          line: where.line,
          column: where.column,
        });
      }
      // Its own length, not the line's: `class` never left the initial
      // condition, so the stream continues. See `CLASS_RE`.
      // Its own length, not the line's: `class` never left the initial
      // condition, so the stream continues. See `CLASS_RE`.
      rest = rest.slice(apply[0].length).trimStart();
      continue;
    }

    // The cluster's closing statement. Read here — after the three styling
    // keywords and before a name can be found — for the reason `END_RE`
    // gives, and refused outright where nothing is open: measured, a stray
    // `end` is a parse error in Mermaid ("got 'END'"), so reading it as
    // nothing would accept a document Mermaid draws no picture for.
    const end = END_RE.exec(rest);
    if (end !== null) {
      if (depth === 0) {
        return null;
      }
      depth -= 1;
      rest = rest.slice(end[0].length).trimStart();
      continue;
    }

    const relationship = readRelationship(rest);
    if (relationship !== null) {
      // Both endpoints join the one entity list, in the order the line names
      // them — measured, a relationship declares its entities exactly as a
      // bare name does and Mermaid's table interleaves the two kinds of
      // statement in first-mention order. `buildErModel` de-duplicates.
      entities.push(
        { name: relationship.decl.left, alias: null, attributes: [] },
        { name: relationship.decl.right, alias: null, attributes: [] },
      );
      // **Both endpoints join the open block**, measured rather than
      // assumed: `subgraph sales / CUSTOMER ||--o{ ORDER : places / end`
      // answers `nodes:["CUSTOMER","ORDER"]`, because Mermaid's
      // relationship production hands both names up to the block that
      // holds it exactly as a bare name is handed up.
      claim(relationship.decl.left);
      claim(relationship.decl.right);
      relationships.push(relationship.decl);
      rest = rest.slice(relationship.length).trimStart();
      continue;
    }

    const head = readEntityHead(rest);
    if (head === null) {
      return null;
    }
    const declared: ErEntityDecl = { name: head.name, alias: head.alias, attributes: [] };
    entities.push(declared);
    claim(declared.name);
    // `A:::urgent` is `class A urgent` written onto the declaration — one
    // construct in two spellings (measured: both reach `setClass` and leave
    // `cssClasses="default urgent"`), so it becomes the same `apply` and
    // differs only in the keyword a diagnostic would quote.
    for (const name of head.classes) {
      styles.push({
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: [declared.name],
        name,
        properties: [],
        line: where.line,
        column: where.column,
      });
    }
    rest = rest.slice(head.length).trimStart();

    if (head.opensBlock) {
      open = declared;
    }
  }

  for (const { entity, attributes } of appends) {
    entity.attributes.push(...attributes);
  }
  return {
    entities,
    relationships,
    styles,
    malformedStyles,
    openEntity: open,
    memberships,
    remainingOpenBlocks: depth,
  };
}

/**
 * One `idList` as its members — `A,B` and `A, B` alike, measured: a space
 * after the comma is spare in Mermaid's lexer, which skips whitespace
 * between tokens in both the initial and the `style` condition.
 *
 * Empty segments are dropped, so a stray comma costs nothing here; the
 * patterns that feed this cannot produce one anyway.
 */
function splitIdList(text: string): string[] {
  return text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Mermaid's in-block lexer, rule for rule and **in its own order**, because
 * inside `{ ... }` the order is what the measurements turn on.
 *
 * Its block condition (mermaid 11.17.2) admits exactly these: whitespace,
 * `\b((?:PK)|(?:FK)|(?:UK))\b`, a `~`-delimited generic, the word rule
 * `[*A-Za-z_À-￿][A-Za-z0-9\-_\[\]().,À-￿*]*`, a
 * backtick, `"[^"]*"`, a newline, `}`, and `.` for anything else. Jison
 * takes the **first** rule that matches rather than the longest, and that
 * single fact explains three measurements at once:
 *
 * - `string c UK,PK "both"` splits, because `UK` is taken by the key rule
 *   before the word rule can swallow `UK,PK` whole (the word alphabet
 *   contains the comma). The leftover `,` falls to `.` and becomes the
 *   list separator.
 * - `string x,y` does **not** split, because `x` is no key and the word
 *   rule then takes `x,y` entire — so the comma is a separator only
 *   between keys.
 * - `string UK.y` and `PK x` are parse errors, because the key rule fires
 *   wherever those two letters stand alone, including where a type or a
 *   name was wanted.
 *
 * ⚠️ **The generic rule's place in this order is load-bearing, not tidy.**
 * It is read before the word rule *and* before the comment rule, and the
 * second of those is measurable: `string x "a~b~"` is a **parse error** in
 * Mermaid, because the generic rule reaches the quoted string first, takes
 * it whole, and leaves a third bare word where the grammar wanted a
 * comment. Put the comment rule first and Siren would accept a line Mermaid
 * draws no picture for at all. `string x "has ~ tilde"` is the control: its
 * tilde is not closed inside the quotes, so the generic rule declines and
 * the comment rule has it.
 */
const ATTRIBUTE_TOKEN_RULES: readonly { kind: "key" | "word" | "comment"; pattern: RegExp }[] = [
  { kind: "key", pattern: /^\b(?:PK|FK|UK)\b/iu },
  /**
   * Mermaid's generic rule, `([^\s]*)[~].*[~]([^\s]*)`, character for
   * character — and a **word** like any other, because its action returns
   * the same `ATTRIBUTE_WORD` the plain word rule does, with the whole match
   * as its text. So the tildes are **kept** and the type is drawn verbatim
   * (measured: `list~int~ codes` → `type="list~int~"`), unlike a class
   * diagram's generic, which is re-spelled into angle brackets. Nothing
   * downstream takes it apart, which is why there is no `ErAttribute` field
   * for a type argument: Mermaid records none either.
   *
   * ⚠️ **`.*`, not `[^\s]*`** — twice over, and both halves are measured:
   * a space goes *inside* the delimiters (`list~a b~ spaced` is one type and
   * one name), and the greed runs to the **last** tilde on the line, so
   * `list~int~ x~y~ z` is one attribute typed `list~int~ x~y~` rather than
   * two. It cannot run further than that: `.` does not match a newline, and
   * the leading `[^\s]*` has to reach its first tilde without crossing
   * whitespace, so the token is confined to the line it starts on however
   * greedy its middle is.
   *
   * A generic stands wherever a word does, the name position included
   * (measured: `x list~int~` → `name="list~int~"`).
   */
  { kind: "word", pattern: /^[^\s]*~.*~[^\s]*/u },
  { kind: "word", pattern: /^[*A-Za-z_À-￿][A-Za-z0-9\-_[\]().,À-￿*]*/u },
  /**
   * Mermaid's backtick rules, three of them folded into one pattern —
   * `` [`] `` opens the `block_bq` condition, `` [^`]+ `` there is the
   * word, and `` [`] `` closes it. The two backticks emit **no token at
   * all**, which is the whole of the construct: they are delimiters that
   * vanish, and the word is what stood between them. So `` `odd name` ``
   * reports `name="odd name"` (measured) — the **opposite** of the generic
   * rule above, whose delimiters are part of its word.
   *
   * ⚠️ **This is how an attribute gets a character its alphabet refuses.**
   * The word rule two lines up admits no space, colon, brace, tilde or
   * quote; measured, `` string `a:b{}~"c` `` carries all five through
   * untouched, the brace included — it does not close the block from inside
   * the quotes. A key word goes through too: `` string `PK` `` is a name,
   * where a bare `string PK` is a parse error, because the key rule never
   * gets to look once the condition has switched.
   *
   * Because the delimiters are token-less rather than part of the word, two
   * runs may touch: `` `a``b` `` is a type and a name (measured), not one
   * word with backticks in the middle.
   *
   * ⚠️ **One measured divergence, taken deliberately.** Mermaid's
   * `` [^`]+ `` matches a newline, so a backticked word may span lines —
   * measured, `` string `a `` over `` b` `` is one attribute named
   * `` a\n    b ``, indentation included. This reader works a line at a
   * time, so `[^`]+` is spelled against one line and both halves are
   * refused instead: the document costs and says so, where a single-line
   * cell drawn for a two-line name would be the silent kind of wrong. A
   * backtick with no partner anywhere is a parse error in Mermaid too, so
   * that half agrees rather than diverging.
   *
   * Group 1 rather than the whole match, which is what strips the quotes —
   * see `tokenizeAttributeLine`.
   */
  { kind: "word", pattern: /^`([^`]+)`/u },
  { kind: "comment", pattern: /^"[^"]*"/u },
];

interface AttributeToken {
  kind: "key" | "word" | "comment" | "punctuation";
  text: string;
}

/**
 * `line` as the token stream Mermaid's block lexer would produce, or `null`
 * when a character reaches no rule of its own.
 *
 * A character that falls to Mermaid's `.` rule becomes a one-character
 * `punctuation` token, which is how `,` — a token the grammar names but the
 * lexer has no rule for inside a block — comes to separate two keys.
 */
function tokenizeAttributeLine(text: string): { tokens: AttributeToken[]; length: number } | null {
  const tokens: AttributeToken[] = [];
  let rest = text;
  while (rest.length > 0) {
    // Mermaid's rule 31, the way out of the block condition — and the
    // reason this reader hands back a length: what follows the brace is
    // statements again, on the same line, and only the caller knows how to
    // read those.
    if (rest.startsWith(ATTRIBUTE_BLOCK_CLOSE)) {
      break;
    }
    const space = /^\s+/u.exec(rest);
    if (space !== null) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const rule = ATTRIBUTE_TOKEN_RULES.find(({ pattern }) => pattern.test(rest));
    if (rule === undefined) {
      // Mermaid's `.` rule, and the only characters this parser lets through
      // it are the ones its grammar names. A lone `~` reaches here — the
      // generic rule needs its closing tilde — and so does a backtick with
      // no partner on the line, and refusing both is the point: measured,
      // `list~int xs` is a parse error in Mermaid too.
      if (rest.startsWith(",")) {
        tokens.push({ kind: "punctuation", text: "," });
        rest = rest.slice(1);
        continue;
      }
      return null;
    }
    const match = rule.pattern.exec(rest)!;
    // The token's text is group 1 where a rule has one and the whole match
    // otherwise — the one place a rule's delimiters come off, and the
    // difference between the two constructs above: the generic rule
    // captures nothing and keeps its tildes, the backtick rule captures
    // what stood between the quotes and loses them.
    tokens.push({ kind: rule.kind, text: match[1] ?? match[0] });
    rest = rest.slice(match[0].length);
  }
  return { tokens, length: text.length - rest.length };
}

/**
 * The attributes at the head of `text`, and how many characters they took —
 * or `null` when it declares none this parser can read.
 *
 * **Several per line, because Mermaid's grammar is `attributes: attribute |
 * attributes attribute`** — measured, `string a int b` inside a block
 * reports two attributes, exactly as the two-line spelling does. One
 * attribute is `type name`, then an optional comma-separated key list, then
 * an optional comment, and every one of those boundaries is measured:
 * `string x PK UK` (no comma) and `string x "a" PK` (comment before keys)
 * are both parse errors in Mermaid, as is a trailing comma.
 *
 * It stops at the closing brace rather than at the end of the line, because
 * the block ends where that brace is and not where the line does — see
 * `readLine`.
 */
function readAttributes(text: string): { attributes: ErAttribute[]; length: number } | null {
  const tokenized = tokenizeAttributeLine(text);
  if (tokenized === null) {
    return null;
  }
  const { tokens, length } = tokenized;
  const attributes: ErAttribute[] = [];
  let at = 0;
  const peek = (): AttributeToken | undefined => tokens[at];
  while (at < tokens.length) {
    const type = peek();
    if (type?.kind !== "word") return null;
    at += 1;
    const name = peek();
    if (name?.kind !== "word") return null;
    at += 1;

    const keys: string[] = [];
    if (peek()?.kind === "key") {
      keys.push(tokens[at].text);
      at += 1;
      while (peek()?.kind === "punctuation" && peek()?.text === ",") {
        at += 1;
        const next = peek();
        if (next?.kind !== "key") return null;
        keys.push(next.text);
        at += 1;
      }
    }

    let comment = "";
    if (peek()?.kind === "comment") {
      comment = tokens[at].text.slice(1, -1);
      at += 1;
    }

    attributes.push({ type: type.text, name: name.text, keys, comment });
  }
  return attributes.length === 0 ? null : { attributes, length };
}

/**
 * The constructs this parser reads well enough to *recognize* and does not
 * implement — each refused **by name**, in the author's own words.
 *
 * CONTEXT.md's opening policy is what makes this a table rather than a
 * silence, and `parseStateDiagram` carries the same one for the same reason:
 * while a construct is unimplemented, Siren rejects it and says what is
 * missing, so an author knows to route around it. Every entry is valid
 * Mermaid (measured against 11.17.2 with `scripts/mermaid-probe.mjs`) and
 * carries a `rejected` row in the compatibility corpus, which is where the
 * measurement of each lives. Falling through to `Unrecognized erDiagram
 * line` would tell the author their document is malformed — a different
 * claim, and an untrue one.
 *
 * Read **last**, after every construct this parser does implement, so a
 * pattern here can never shadow a working one. Each is anchored on the
 * *statement* rather than on a bare word, which is what leaves an entity the
 * author simply named `direction` or `to` alone.
 *
 * The table shrinks as constructs land. Every one of these has a ticket.
 */
const UNIMPLEMENTED: readonly { pattern: RegExp; name: string }[] = [
  {
    // **Mermaid's fifth cardinality**, and the one this parser does not
    // draw. Measured: its `Cardinality` enum has five members, the fifth
    // being `MD_PARENT`, whose lexer rule is `u(?=[.\-|])` — so `u` is a
    // marker only when a body follows it immediately, which makes it a
    // *left-hand* spelling and nothing else (`A ||--u B : x` is a parse
    // error, "got 'UNICODE_TEXT'"). `A u--o{ B : x` renders, and what
    // Mermaid draws for it is an edge with `marker-end` only and **no
    // `marker-start` at all**, because `md_parent` names no marker in its
    // own table.
    //
    // Nothing in the document says what a missing marker means, so it is
    // refused by name rather than guessed at. The lookahead is what leaves
    // an entity called `u` — or `usage` — alone; both are ordinary names
    // (measured).
    // Either spelling of the left name, measured: `"A" u--o{ B : x` reports
    // `leftCard="MD_PARENT"` exactly as the unquoted spelling does.
    pattern: new RegExp(`^${ANY_NAME_SOURCE}\\s+u(?=[-.|])`, "u"),
    name: 'the "u" (MD_PARENT) relationship cardinality',
  },
  {
    // The **bracketless** alias, which `ENTITY_ALIAS_RE` deliberately does
    // not read. Measured: `A[Unquoted]` records `alias="Unquoted"` exactly
    // as the quoted spelling does, so it is a document Mermaid draws and
    // must be refused by name rather than reported as malformed.
    //
    // The lookahead is what keeps the quoted spelling out of this table now
    // that it is implemented: a line reaching here opened its brackets on
    // something other than a `"`.
    // Either spelling of the name, measured: `"A B"[Unquoted]` reports
    // `label="A B" alias="Unquoted"`, so a quoted name takes the bracketless
    // alias too and must be refused by the same name rather than falling
    // through to the generic message.
    pattern: new RegExp(`^${ANY_NAME_SOURCE}\\s*\\[\\s*[^"\\s]`, "u"),
    name: "an entity alias written without quotes",
  },
  {
    // The implicit `default` class — see `DEFAULT_CLASS_NAME` for what it
    // reaches and why reading it would be worse than refusing it.
    //
    // The pattern finds `default` as a whole member of the `classDef`'s name
    // list, wherever in the list it stands. `\b` after it is what leaves
    // `classDef defaulting fill:red` alone: the leading group needs a comma
    // to consume a name, so it cannot eat `defaulting`, and matching
    // `default` inside that word then fails the boundary.
    pattern: new RegExp(
      `\\bclassDef\\b\\s+(?:${STYLE_NAME_SOURCE}\\s*,\\s*)*${DEFAULT_CLASS_NAME}\\b`,
      "u",
    ),
    name: 'the implicit "default" class every entity wears',
  },
];

/**
 * The refusal for `line`, or `null` when this parser has no name for what is
 * wrong with it and the generic unrecognized-line message is the honest
 * answer.
 */
function unimplementedIn(line: string): string | null {
  for (const { pattern, name } of UNIMPLEMENTED) {
    if (pattern.test(line)) {
      return `Unimplemented erDiagram construct: ${name}, in "${line}"`;
    }
  }
  return null;
}

/**
 * Parses Siren ER-diagram source text — an `erDiagram` header and the
 * entities declared under it. Never throws: a malformed line is reported as
 * a diagnostic and costs the document.
 */
export function parseErDiagram(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const entities: ErEntityDecl[] = [];
  const relationships: ErRelationshipDecl[] = [];
  let sawError = false;
  let sawHeader = false;
  /**
   * The entity whose attribute block the reader is inside, or `null` between
   * blocks. Attributes are appended to it as they are read, so the block's
   * body lands on the declaration the opening line pushed rather than on a
   * second entry for the same name.
   */
  let openEntity: ErEntityDecl | null = null;
  /**
   * Where that block was opened, kept so the unclosed-block diagnostic can
   * point at the line the author wrote rather than at the end of the file.
   */
  let openedAt: { line: string; lineNumber: number; column: number } | null = null;
  /**
   * The rank direction the last `direction` statement named — `TB` until one
   * does, which is Mermaid's own initial value.
   *
   * **Last wins**, measured rather than derived: `direction LR` then
   * `direction RL` reports `RL`, and the reverse pair reports `LR`, because
   * Mermaid's `setDirection(dir)` is a plain assignment. That is
   * `parseClassDiagram`'s rule and the **opposite** of
   * `parseStateDiagram`'s first-wins — two different answers already in this
   * repo, which is exactly why this one was measured and not inherited.
   */
  let direction: Direction = "TB";
  /**
   * The `timeline:` block, once one has been opened. `null` until then,
   * which is what tells `buildErModel` the document declares no animation at
   * all, as opposed to declaring an empty block.
   */
  let timeline: SirenTimeline | null = null;
  /**
   * The screen-reader-only title and description, `null` until a statement
   * names one. **Last wins** for each, measured rather than assumed:
   * `accTitle: first` then `accTitle: second`, with `accDescr: one` then
   * `accDescr: two`, renders a `<title>` reading `second` and a `<desc>`
   * reading `two` (mermaid 11.17.2). Same rule as `direction` one field up,
   * and the opposite of the **first**-wins an ER alias takes — three rules
   * in one parser, each measured on its own construct.
   */
  let accTitle: string | null = null;
  let accDescr: string | null = null;
  /**
   * Whether the reader is inside a `accDescr { ... }` block it has already
   * refused by name. Its body is prose rather than ER, so every line of it
   * is dropped until the closing brace — see `ACC_DESCR_BRACED_RE`.
   */
  let drainingAccDescr = false;
  /**
   * The author's styling statements in written order, definitions and
   * apply-directives alike. Left unpaired here on purpose: an
   * apply-directive may name a `classDef` written below it — measured,
   * `A / class A u / classDef u fill:red` paints `A` — and pairing them is
   * `resolveStyles`' job, which is where the other four kinds leave it too.
   */
  const styles: StyleDecl[] = [];
  /**
   * The `subgraph` blocks written at the top level, in source order; a
   * nested one is inside its parent's own `subgraphs` instead.
   */
  const subgraphs: ErSubgraph[] = [];
  /**
   * The blocks still open, outermost first — the reader's second mode,
   * beside `openEntity`. A header pushes (it owns its line) and every `end`
   * inside a line pops, which is why `readLine` reports a remaining depth
   * rather than a stack of its own.
   */
  let openBlocks: ErSubgraph[] = [];
  /**
   * Where each open block was opened, so an unclosed-block diagnostic can
   * point at the header the author wrote rather than at the end of the
   * file — the same debt `openedAt` pays for an attribute block.
   */
  let blockOpenedAt: { line: string; lineNumber: number; column: number }[] = [];
  /**
   * Every block's name and the header that wrote it, in source order — kept
   * for the one refusal below that cannot be a line pattern, because what
   * is wrong with the line is somewhere else in the document.
   */
  const blockHeaders: { name: string; line: string; lineNumber: number; column: number }[] = [];
  /**
   * The names of the blocks whose `end` the reader has already passed —
   * Mermaid's `subGraphLookup`, which `addSubGraph` fills at the closing
   * `end` and not at the header.
   *
   * ⚠️ **The refusal below turns on this rather than on the whole
   * document's blocks, and that is measured.** A `style s1 fill:#f96`
   * written *above* `subgraph s1 ... end` reaches `addCssStyles` before the
   * name is registered and paints nothing — `cssStyles` comes back empty —
   * which is the very picture `resolveStyles` already produces by dropping
   * an unknown target. Refusing that document would cost a picture Mermaid
   * draws.
   */
  const registeredBlocks = new Set<string>();

  /**
   * Everything one line's reading contributes, taken in one place so the
   * two callers of `readLine` cannot drift apart about what a line may
   * carry — the in-block caller reads the same statements once its brace
   * closes mid-line.
   *
   * A malformed declaration is diagnosed *here* rather than in `readLine`,
   * which holds no diagnostics list; the message is
   * `parseStateDiagram`'s and `parseClassDiagram`'s word for word, because
   * it is the same mistake in a different kind's document.
   */
  const take = (
    reading: ErLineReading,
    lineNumber: number,
    column: number,
    line: string,
  ): void => {
    entities.push(...reading.entities);
    // Membership is replayed here rather than written as the line was read,
    // so a line that turned out unreadable claims no members — the
    // all-or-nothing rule `readLine` already keeps for boxes. A name is
    // listed once per block however many times the line mentions it:
    // measured, `subgraph s1 / A / A / end` answers `nodes:["A"]`, because
    // Mermaid's `uniq` runs over the block's own list.
    for (const { name, block } of reading.memberships) {
      if (block !== null && !block.entityNames.includes(name)) {
        block.entityNames.push(name);
      }
    }
    for (const closed of openBlocks.slice(reading.remainingOpenBlocks)) {
      registeredBlocks.add(closed.name);
    }
    openBlocks = openBlocks.slice(0, reading.remainingOpenBlocks);
    blockOpenedAt = blockOpenedAt.slice(0, reading.remainingOpenBlocks);

    // ⚠️ **A cluster is a legal style target in this kind, and painting it
    // is not implemented** — so the directive is refused by name rather
    // than dropped. Measured from Mermaid's own ER database (11.17.2):
    // `addCssStyles` and `setClass` each look up `this.entities.get(id)`
    // **and** `this.subGraphLookup.get(id)`, and `style s1 fill:#f96` below
    // `subgraph s1 ... end` comes back as `cssStyles:["fill:#f96"]` on the
    // cluster, `class s1 urgent` as `classes:["urgent"]` on it. That is the
    // opposite of a relationship, which reaches neither map and is dropped
    // here on purpose (see `resolveStyles`' call in `buildErModel`).
    //
    // Asked after the truncation above so that an `end` earlier on this
    // very line has already registered its block, which is the order
    // Mermaid reads the two statements in.
    for (const style of reading.styles) {
      for (const targetId of style.targetIds) {
        if (!registeredBlocks.has(targetId)) continue;
        diagnostics.push({
          severity: "error",
          message:
            `Unimplemented erDiagram construct: a \`${style.authoredAs}\` statement ` +
            `painting a \`subgraph\` cluster ("${targetId}"), in "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
      }
    }
    relationships.push(...reading.relationships);
    styles.push(...reading.styles);
    for (const segment of reading.malformedStyles) {
      diagnostics.push({
        severity: "error",
        message: `Unrecognized style declaration: "${segment}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
    }
  };

  const lines = source.split(/\r\n|\r|\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const lineNumber = index + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;

    // The `timeline:` block ends the diagram body and runs to the end of the
    // document — the one-way switch every other kind makes, so an ER
    // statement written after it is a timeline diagnostic rather than
    // silently parsing as structure. Draining the body is
    // `parseTimelineBody`'s job; what stays here is where the block starts,
    // and that a diagnostic inside it costs the whole document.
    //
    // ⚠️ Read **after** the header (a document opening with `timeline:` has
    // no diagram to animate, and the header diagnostic is the one that says
    // so) and **before** the in-block reader, so `timeline:` written while
    // an attribute block is still open opens the timeline and leaves the
    // unclosed block to be reported by name below. The alternative — letting
    // the in-block reader see it first — answers an author who wrote a
    // timeline with "Unrecognized erDiagram attribute", which names the
    // wrong problem.
    if (sawHeader && isTimelineHeader(line)) {
      const { entries, diagnostics: bodyDiagnostics } = parseTimelineBody(lines, index + 1);
      diagnostics.push(...bodyDiagnostics);
      if (bodyDiagnostics.length > 0) {
        sawError = true;
      }
      timeline = { entries };
      break;
    }

    // Inside a refused `accDescr { ... }`, every line is prose. Read before
    // the attribute-block reader, which those two can never both be true
    // for: this block is entered without an `openEntity`, because no entity
    // was declared for it.
    if (drainingAccDescr) {
      if (line === ATTRIBUTE_BLOCK_CLOSE) {
        drainingAccDescr = false;
      }
      continue;
    }

    // A line that *starts* inside a block. It need not end inside one —
    // `string a } F` closes the block and declares an entity, measured — so
    // the whole line goes to `readLine` with the open entity, exactly as a
    // line outside a block goes to it with `null`. What this branch decides
    // is only which two things the block-mode start implies: that the
    // header, `direction` and the accessibility statements are not
    // consulted (measured — `direction LR` inside a block is an attribute),
    // and that an unreadable line is reported as an **attribute** rather
    // than as a line, which is what an author who is inside a block wrote.
    if (openEntity !== null) {
      const reading = readLine(line, openEntity, { line: lineNumber, column }, openBlocks);
      if (reading === null) {
        diagnostics.push({
          severity: "error",
          message: `Unrecognized erDiagram attribute: "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        continue;
      }
      take(reading, lineNumber, column, line);
      if (reading.openEntity !== openEntity) {
        // Either the block closed, or it closed and another opened on the
        // same line; `openedAt` follows so an unclosed-block diagnostic
        // still points at the line that opened the block it names.
        openEntity = reading.openEntity;
        openedAt = openEntity === null ? null : { line, lineNumber, column };
      }
      continue;
    }

    // The header, asked of the shared registry rather than of a private copy
    // of the pattern — the rule `parseStateDiagram` already follows, so this
    // parser and the dispatcher cannot disagree about which spellings exist.
    if (!sawHeader) {
      if (matchDiagramHeader(line) !== "er") {
        diagnostics.push({
          severity: "error",
          message: `Expected ${ER_HEADERS}, found "${line}"`,
          line: lineNumber,
          column,
        });
        return { document: null, diagnostics };
      }
      sawHeader = true;
      continue;
    }

    // **First of all the statements**, because its rule swallows the line it
    // is written on and everything already on it. Measured, one probe apiece:
    // `A ||--o{ B : x direction LR` reports no entity and no relationship,
    // and `accTitle: direction LR` records no accessible title — so a reader
    // that asked "is this an accTitle?" or "is this a relationship?" first
    // would answer a question Mermaid never reaches. See `DIRECTION_RULES`.
    const namedDirection = readDirection(line);
    if (namedDirection !== null) {
      // ⚠️ **The same statement means two different things depending on
      // where it stands**, and that is Mermaid's own action rather than a
      // convenience here: `if (!yy.subgraphDepth) setDirection(value) else
      // hand it up to the block`. Measured, `direction RL / subgraph s1 /
      // direction LR / ... / end / direction BT` answers `dir:"LR"` on the
      // cluster and `getDirection() === "BT"` for the document — so a
      // reader that set the document's from inside a block would turn the
      // whole picture on a line that was never about it.
      //
      // Assignment either way, because last wins in both places — measured
      // on the document (`LR` then `RL` answers `RL`) and inside a block
      // (two `direction`s in one block answer with the second).
      const innermost = openBlocks[openBlocks.length - 1];
      if (innermost === undefined) {
        direction = namedDirection;
      } else {
        innermost.direction = namedDirection;
      }
      continue;
    }

    // The cluster's opening line, read after `direction` for the reason
    // every statement here is: that rule swallows the line it is written on
    // from the very first character. Measured, `subgraph s1 direction LR`
    // sets the **document's** direction and opens no block at all — its
    // trailing `end` is then a parse error, which is what Siren answers too
    // once `readLine` finds that `end` with nothing open.
    const header = SUBGRAPH_HEAD_RE.exec(line);
    if (header !== null && !RESERVED_BARE_NAMES.has(header[1].toLowerCase())) {
      const name = unquoteName(header[1]);
      const opened: ErSubgraph = {
        name,
        // The title if the header wrote one, otherwise the name — measured,
        // `subgraph s1` answers `title:"s1"`.
        label: header[2] === undefined ? name : subgraphTitleOf(header[2]),
        direction: null,
        entityNames: [],
        subgraphs: [],
      };
      const parent = openBlocks[openBlocks.length - 1];
      (parent === undefined ? subgraphs : parent.subgraphs).push(opened);
      openBlocks.push(opened);
      blockOpenedAt.push({ line, lineNumber, column });
      blockHeaders.push({ name, line, lineNumber, column });
      continue;
    }

    // Before the entity patterns: `accTitle` and `accDescr` are both
    // ordinary entity names in this alphabet — measured, a bare `accTitle`
    // is a box — so the colon is the whole of the boundary, and a reader
    // asking "is this a name?" first would never see it.
    const namedAccTitle = ACC_TITLE_RE.exec(line);
    if (namedAccTitle !== null) {
      accTitle = namedAccTitle[1].trim();
      continue;
    }

    const namedAccDescr = ACC_DESCR_RE.exec(line);
    if (namedAccDescr !== null) {
      accDescr = namedAccDescr[1].trim();
      continue;
    }

    // The braced spelling, refused by name here rather than in the table at
    // the bottom, because `ENTITY_HEAD_RE` below would otherwise claim it —
    // see `ACC_DESCR_BRACED_RE`.
    //
    // The body is then drained to its closing brace rather than read, so the
    // refusal is **one** diagnostic naming the construct instead of that one
    // plus a line of prose reported as an unrecognized statement: the
    // description is text, and telling an author their sentence is malformed
    // ER says the wrong thing twice over.
    if (ACC_DESCR_BRACED_RE.test(line)) {
      diagnostics.push({
        severity: "error",
        message:
          "Unimplemented erDiagram construct: the multi-line `accDescr { ... }` " +
          `description, in "${line}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
      drainingAccDescr = true;
      continue;
    }

    // Every remaining statement, read left to right across the line — see
    // `readLine`. All or nothing: a line it cannot finish reading
    // contributes none of its boxes rather than some of them.
    const reading = readLine(line, null, { line: lineNumber, column }, openBlocks);
    if (reading !== null) {
      take(reading, lineNumber, column, line);
      if (reading.openEntity !== null) {
        // A block left open where the line ended; its body is appended to
        // this very declaration as the next lines are read. A block that
        // opened *and closed* on this line has already had its attributes
        // appended and leaves nothing here to do.
        openEntity = reading.openEntity;
        openedAt = { line, lineNumber, column };
      }
      continue;
    }

    // Read last, so nothing here can shadow a construct this parser does
    // implement: a line only reaches the table once every working pattern
    // above has declined it.
    diagnostics.push({
      severity: "error",
      message: unimplementedIn(line) ?? `Unrecognized erDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
  }

  if (!sawHeader) {
    diagnostics.push({
      severity: "error",
      message: `Empty document: expected a ${ER_HEADERS} header`,
      line: 1,
      column: 1,
    });
    return { document: null, diagnostics };
  }

  // A block the author never closed. Measured: Mermaid refuses such a
  // document outright ("Parse error"), so reading it as if the brace were
  // there would draw a picture for a document Mermaid draws nothing for —
  // the one direction the absolute compatibility condition rules out.
  if (openedAt !== null) {
    diagnostics.push({
      severity: "error",
      message: `Unclosed erDiagram attribute block: "${openedAt.line}"`,
      line: openedAt.lineNumber,
      column: openedAt.column,
    });
    sawError = true;
  }

  // ⚠️ **A name worn by an entity and by a cluster at once, refused by
  // name — the silent mis-render this construct arrives with.**
  //
  // Measured (mermaid 11.17.2), and the same answer whichever statement
  // comes first: `subgraph s1 / A / end / s1 ||--|| B : r` records a
  // phantom entity `entity-s1-1` that `getData()` throws away, handing the
  // edge the **cluster** `s1` as its start; a bare `s1` after the block
  // records the same phantom and `getData()` drops it too; and writing the
  // relationship *before* the block leaves the edge pointing at a node
  // `getData()` does not carry. In every one of them Mermaid draws **no
  // box** for `s1` — the frame has taken the name.
  //
  // Every reading this parser has is an ordinary entity, so it would draw
  // that box: a third figure beside the frame, with no diagnostic anywhere.
  // Refused instead, at the header rather than at the mention, because the
  // construct is the *sharing* and neither half is wrong on its own.
  // Order-independent for the same reason, which is also what keeps it out
  // of `UNIMPLEMENTED`: no pattern over one line can see the other half.
  const mentioned = new Set(entities.map((entity) => entity.name));
  for (const header of blockHeaders) {
    if (!mentioned.has(header.name)) continue;
    diagnostics.push({
      severity: "error",
      message:
        "Unimplemented erDiagram construct: an entity sharing its name with a " +
        `\`subgraph\` cluster ("${header.name}"), in "${header.line}"`,
      line: header.lineNumber,
      column: header.column,
    });
    sawError = true;
  }

  // A cluster the author never closed. Measured: Mermaid refuses such a
  // document outright ("Parse error ... got 'EOF'"), so reading it as if
  // the `end` were there would draw a picture for a document Mermaid draws
  // nothing for — the same trade the unclosed attribute block makes, and
  // reported per block so an author who forgot two `end`s is told twice.
  for (const opened of blockOpenedAt) {
    diagnostics.push({
      severity: "error",
      message: `Unclosed erDiagram subgraph block: "${opened.line}"`,
      line: opened.lineNumber,
      column: opened.column,
    });
    sawError = true;
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: ErDocument = {
    kind: "er",
    direction,
    entities,
    relationships,
    subgraphs,
    styles,
    timeline,
    accTitle,
    accDescr,
  };
  return { document, diagnostics };
}
