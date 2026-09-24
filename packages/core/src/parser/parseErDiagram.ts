import type {
  Diagnostic,
  Direction,
  ErAttribute,
  ErCardinality,
  ErDocument,
  ErEntityDecl,
  ErRelationshipDecl,
  ErRelationshipLine,
  ParseResult,
  SirenTimeline,
} from "../contracts";
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
 * reason the generic and backtick attribute rules are absent below.
 *
 * **The brace is required to end the line, and the closing one to be alone
 * on its own.** Mermaid's lexer is freer than that — `E { string a }` on one
 * line is a document it draws — and that spelling stays refused here rather
 * than half-read: an opening line this pattern declines falls through to the
 * unrecognized-line diagnostic, which costs the document, so no picture is
 * drawn for it.
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
 * ⚠️ Not anchored on the end of the line — see `RELATIONSHIP_RE` — so the
 * brace's "must end the line" rule is `readStatements`' to enforce, and it
 * does.
 */
const ENTITY_HEAD_RE = new RegExp(
  `^(${ANY_NAME_SOURCE})(?:\\s*\\[\\s*"([^"\\r\\n]+)"\\s*\\])?(\\s*\\{)?`,
  "u",
);
const ATTRIBUTE_BLOCK_CLOSE = "}";

/** One entity head, as `ENTITY_HEAD_RE` read it, and how much it took. */
interface ErEntityHead {
  name: string;
  alias: string | null;
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
  const [whole, name, alias, brace] = match;
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
    opensBlock: brace !== undefined,
    length: whole.length,
  };
}

/** Every statement one line declares, read left to right. */
interface ErLineStatements {
  /** The entities named, in source order, relationship endpoints included. */
  entities: ErEntityDecl[];
  /** The relationships named, in source order. */
  relationships: ErRelationshipDecl[];
  /** The entity whose attribute block this line opened, or `null`. */
  opensBlockOn: ErEntityDecl | null;
}

/**
 * Every statement `line` declares, or `null` when any part of it is
 * unreadable.
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
 * **A relationship is tried before a name**, because it begins with one: a
 * name-first reader would take `A` out of `A ||--o{ B : x` and then find
 * `||--o{ B : x` unreadable.
 *
 * All-or-nothing on purpose. A half-read line would put some of its boxes on
 * the canvas and drop the rest silently; returning `null` costs the document
 * and says so, which is the trade every refusal in this parser makes.
 */
function readStatements(line: string): ErLineStatements | null {
  const entities: ErEntityDecl[] = [];
  const relationships: ErRelationshipDecl[] = [];
  let opensBlockOn: ErEntityDecl | null = null;
  let rest = line;

  while (rest.length > 0) {
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
    rest = rest.slice(head.length).trimStart();

    if (head.opensBlock) {
      // **The brace has to end the line.** Mermaid's lexer is freer —
      // `E { string a }` on one line is a document it draws — and that
      // spelling stays refused here rather than half-read, which is what
      // `er-block-one-line` records.
      if (rest.length > 0) {
        return null;
      }
      opensBlockOn = declared;
    }
  }

  return { entities, relationships, opensBlockOn };
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
 * The generic and the backtick rules are deliberately absent: `list~int~ xs`
 * and `` `odd name` `` are documents Mermaid draws that this parser does not
 * implement, so they must not be half-read. Leaving them out is what refuses
 * them — the `~` and the `` ` `` reach no rule, and the line is reported as
 * unrecognized rather than quietly losing its generic argument.
 */
const ATTRIBUTE_TOKEN_RULES: readonly { kind: "key" | "word" | "comment"; pattern: RegExp }[] = [
  { kind: "key", pattern: /^\b(?:PK|FK|UK)\b/iu },
  { kind: "word", pattern: /^[*A-Za-z_À-￿][A-Za-z0-9\-_[\]().,À-￿*]*/u },
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
function tokenizeAttributeLine(line: string): AttributeToken[] | null {
  const tokens: AttributeToken[] = [];
  let rest = line;
  while (rest.length > 0) {
    const space = /^\s+/u.exec(rest);
    if (space !== null) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const rule = ATTRIBUTE_TOKEN_RULES.find(({ pattern }) => pattern.test(rest));
    if (rule === undefined) {
      // Mermaid's `.` rule, and the only characters this parser lets through
      // it are the ones its grammar names. A `~` or a backtick would reach
      // here too, and refusing them is the point — see the rule table.
      if (rest.startsWith(",")) {
        tokens.push({ kind: "punctuation", text: "," });
        rest = rest.slice(1);
        continue;
      }
      return null;
    }
    const text = rule.pattern.exec(rest)![0];
    tokens.push({ kind: rule.kind, text });
    rest = rest.slice(text.length);
  }
  return tokens;
}

/**
 * The attributes `line` declares, or `null` when it declares none this
 * parser can read.
 *
 * **Several per line, because Mermaid's grammar is `attributes: attribute |
 * attributes attribute`** — measured, `string a int b` inside a block
 * reports two attributes, exactly as the two-line spelling does. One
 * attribute is `type name`, then an optional comma-separated key list, then
 * an optional comment, and every one of those boundaries is measured:
 * `string x PK UK` (no comma) and `string x "a" PK` (comment before keys)
 * are both parse errors in Mermaid, as is a trailing comma.
 */
function readAttributes(line: string): ErAttribute[] | null {
  const tokens = tokenizeAttributeLine(line);
  if (tokens === null) {
    return null;
  }
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
  return attributes.length === 0 ? null : attributes;
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

    // Inside a block, every line is either its closing brace or attributes.
    // Read before the header check and before every statement pattern,
    // because the alphabets overlap: `string name` is two words, and a
    // reader that asked "is this an entity name?" first would find `string`
    // and declare a box.
    if (openEntity !== null) {
      if (line === ATTRIBUTE_BLOCK_CLOSE) {
        openEntity = null;
        openedAt = null;
        continue;
      }
      const attributes = readAttributes(line);
      if (attributes === null) {
        diagnostics.push({
          severity: "error",
          message: `Unrecognized erDiagram attribute: "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        continue;
      }
      openEntity.attributes.push(...attributes);
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
      // Assignment rather than "only if unset" — see `direction` above.
      direction = namedDirection;
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
    // `readStatements`. All or nothing: a line it cannot finish reading
    // contributes none of its boxes rather than some of them.
    const statements = readStatements(line);
    if (statements !== null) {
      entities.push(...statements.entities);
      relationships.push(...statements.relationships);
      if (statements.opensBlockOn !== null) {
        // A block's body is appended to this very declaration; see
        // `openEntity`.
        openEntity = statements.opensBlockOn;
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

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: ErDocument = {
    kind: "er",
    direction,
    entities,
    relationships,
    timeline,
    accTitle,
    accDescr,
  };
  return { document, diagnostics };
}
