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
 * An entity name on a line of its own.
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
 * guard: adding one would refuse three documents Mermaid draws.
 */
const ENTITY_NAME_RE = /^(?:[\w*.-]|[^\x00-\x7F])+$/u;

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
 * The entity-name alphabet again, as a source fragment, so the relationship
 * pattern below reads a name in exactly the language `ENTITY_NAME_RE` does.
 * Two spellings of one alphabet would be two places for it to drift.
 */
const NAME_SOURCE = "(?:[\\w*.-]|[^\\x00-\\x7F])+";

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
  `^(${NAME_SOURCE})(?:\\s*(?=[|}])|\\s+)(${alternation(Object.keys(CARDINALITY_BY_SPELLING))})` +
  `\\s*(${alternation(Object.keys(LINE_BY_SPELLING))})\\s*` +
  `(${alternation(Object.keys(CARDINALITY_BY_SPELLING))})\\s*(${NAME_SOURCE})` +
  `\\s*:\\s*("[^"\\r\\n]+"|${NAME_SOURCE})`;

const RELATIONSHIP_RE = new RegExp(`${RELATIONSHIP_SOURCE}\\s*$`, "iu");

/**
 * The same relationship with something *after* its label — Mermaid's next
 * statement on the same line, which this parser refuses by name rather than
 * swallowing into the label. See the `UNIMPLEMENTED` entry that uses it.
 */
const RELATIONSHIP_THEN_MORE_RE = new RegExp(`${RELATIONSHIP_SOURCE}\\s+\\S`, "iu");

/**
 * The relationship `line` declares, or `null` when it declares none.
 *
 * Returns the whole declaration rather than a boolean so the caller cannot
 * read the two cardinalities back in the wrong order: `left` and `right`
 * are the source's own, and Mermaid's crossed `cardA`/`cardB` are never
 * spoken here (see `ErRelationshipDecl`).
 */
function readRelationship(line: string): ErRelationshipDecl | null {
  const match = RELATIONSHIP_RE.exec(line);
  if (match === null) {
    return null;
  }
  const [, left, leftMarker, body, rightMarker, right, rawLabel] = match;
  const label = rawLabel.startsWith('"') ? rawLabel.slice(1, -1) : rawLabel;
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
  return {
    left,
    leftCardinality: CARDINALITY_BY_SPELLING[spelling(leftMarker)],
    line: LINE_BY_SPELLING[spelling(body)],
    rightCardinality: CARDINALITY_BY_SPELLING[spelling(rightMarker)],
    right,
    label,
  };
}

/**
 * The document's own rank-direction statement: `direction LR`, and the three
 * other spellings.
 *
 * **Anchored on the whole statement, and on the four canonical values.**
 * Measured (mermaid 11.17.2): `direction` on a line of its own is an
 * ordinary **entity** called `direction`, and `direction TD` is **two**
 * entities — the ER lexer writes `TB`/`BT`/`RL`/`LR` out literally and the
 * flowchart's `TD` alias does not reach this grammar. So a pattern reaching
 * for a bare keyword would swallow one box, and a fifth spelling here would
 * swallow two.
 *
 * Case-insensitive because the lexer is: `direction lr` reports `LR`.
 *
 * ⚠️ Read **before** `ENTITY_HEAD_RE` is consulted but, like every statement
 * here, after the in-block reader — measured, `direction LR` written *inside*
 * an attribute block is an attribute (`type="direction" name="LR"`), not a
 * direction, and the block reader is what keeps it one.
 */
const DIRECTION_RE = /^direction\s+(TB|BT|RL|LR)\s*$/i;

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
 * ⚠️ **Both trailing groups are optional, so this matches a bare name too**
 * — which is why `readEntityHead` refuses to answer unless one of them is
 * present. Without that guard it would declare an entity called `--`, the
 * very line `RELATIONSHIP_BODY_ONLY_RE` exists to keep out.
 */
const ENTITY_HEAD_RE =
  /^((?:[\w*.-]|[^\x00-\x7F])+)(?:\s*\[\s*"([^"\r\n]+)"\s*\])?\s*(\{)?$/u;
const ATTRIBUTE_BLOCK_CLOSE = "}";

/** One entity head, as `ENTITY_HEAD_RE` read it. */
interface ErEntityHead {
  name: string;
  alias: string | null;
  opensBlock: boolean;
}

/**
 * The entity `line` declares with an alias, a block, or both — or `null`
 * when it declares neither, which is every line a *bare* name already took
 * and every line that is no entity head at all.
 */
function readEntityHead(line: string): ErEntityHead | null {
  const match = ENTITY_HEAD_RE.exec(line);
  if (match === null) {
    return null;
  }
  const [, name, alias, brace] = match;
  if (alias === undefined && brace === undefined) {
    return null;
  }

  return { name, alias: alias ?? null, opensBlock: brace !== undefined };
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
    pattern: /^(?:[\w*.-]|[^\x00-\x7F])+\s+u(?=[-.|])/u,
    name: 'the "u" (MD_PARENT) relationship cardinality',
  },
  {
    // A relationship this parser *can* read, with something written after
    // its label. Measured, and it is not a longer label: `A ||--o{ B : two
    // words` reports the role as `two` and then declares a **third entity**
    // called `words`, because Mermaid's grammar runs several statements on
    // one line (`A B C` is three entities). Reading the tail as the label
    // would draw a label Mermaid never draws and lose a box it does.
    //
    // Anchored on a whole readable relationship rather than on "a line with
    // spaces in it", so the quoted spelling — `: "two words"`, measured to
    // be one role with a space in it — is untouched.
    pattern: RELATIONSHIP_THEN_MORE_RE,
    name: "a second statement after a relationship on the same line",
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
    pattern: /^(?:[\w*.-]|[^\x00-\x7F])+\s*\[\s*[^"\s]/u,
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

    // Before the entity patterns, because `direction` is in the entity-name
    // alphabet: a reader that asked "is this a name?" first would find one
    // and declare a box for a line that declares none.
    const namedDirection = DIRECTION_RE.exec(line);
    if (namedDirection !== null) {
      // Assignment rather than "only if unset" — see `direction` above.
      direction = namedDirection[1].toUpperCase() as Direction;
      continue;
    }

    if (ENTITY_NAME_RE.test(line) && !RELATIONSHIP_BODY_ONLY_RE.test(line)) {
      entities.push({ name: line, alias: null, attributes: [] });
      continue;
    }

    const relationship = readRelationship(line);
    if (relationship !== null) {
      // Both endpoints join the one entity list, in the order the line names
      // them — measured, a relationship declares its entities exactly as a
      // bare name does and Mermaid's table interleaves the two kinds of
      // statement in first-mention order. `buildErModel` de-duplicates.
      entities.push(
        { name: relationship.left, alias: null, attributes: [] },
        { name: relationship.right, alias: null, attributes: [] },
      );
      relationships.push(relationship);
      continue;
    }

    // An alias and an attribute block each declare their entity exactly as a
    // bare name does (measured), so both enter the same list here — and a
    // line writing both declares one entity carrying both, which is why they
    // are read together. A block's body is appended to this very
    // declaration; see `openEntity`.
    const head = readEntityHead(line);
    if (head !== null) {
      const declared: ErEntityDecl = { name: head.name, alias: head.alias, attributes: [] };
      entities.push(declared);
      if (head.opensBlock) {
        openEntity = declared;
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

  const document: ErDocument = { kind: "er", direction, entities, relationships, timeline };
  return { document, diagnostics };
}
