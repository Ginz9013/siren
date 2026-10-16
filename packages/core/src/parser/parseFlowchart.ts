import type {
  DiagramParseResult,
  Diagnostic,
  Direction,
  EdgeEnd,
  EdgeLine,
  FlowchartDocument,
  Interaction,
  Label,
  LabelProblem,
  LinkStyleDecl,
  LinkTarget,
  NodeShape,
  SirenEdge,
  SirenEdgeData,
  SirenNode,
  SirenSubgraph,
  NamedTimeline,
  SirenTimeline,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { plainLabel } from "../label/label";
import { labelDiagnostics, readLabel, type ReadLabelResult } from "../label/readLabel";
import { parseStyleProperties } from "./parseDeclarationList";
import { readAccDescrBlock } from "./readAccDescrBlock";
import { listAcceptedHeaders, matchClassDirection, matchFlowchartHeader } from "./parseDirection";
import { isTimelineHeader, namedTimelinesField, parseTimelineBlocks } from "./parseTimelineBlock";
import { MID_LINE_PERCENT_MESSAGE } from "./midLinePercent";
import {
  blockRunOn,
  type DataBlockProblem,
  loadDataBlock,
  type NodeDataBlock,
  NODE_DATA_OPENER,
  nodeDataEnd,
  readNodeData,
  unchangedStyleMessage,
  unshownLabelMessage,
} from "./flowchartNodeData";

/**
 * The headers this parser accepts — its own kind's and no other's, because
 * a `sequenceDiagram` line reaching here is a caller's routing mistake, not
 * something naming it would help the author fix. `parseSiren` names the
 * whole language; this names the one kind it parses.
 */
const FLOWCHART_HEADER_SPELLINGS = listAcceptedHeaders(["flowchart"]);

/**
 * What may lie inside a node's brackets, in every spelling but the three
 * round ones — between the `[` and the `]`, and the braces of a diamond or
 * a hexagon alike: either a fenced run, or a character that is neither a
 * quote nor a square bracket or brace.
 *
 * The fenced alternative is the whole point of quoting. `]` ends the
 * bracket, so an unquoted label cannot contain one — `A[a]b]` is a parse
 * error in Mermaid 11.17.2, measured against its own parser — while
 * `A["a]b"]` is the label `a]b`. A pattern that only knew about `[^\]]`
 * could strip the quotes but could never read the label they were written
 * to make possible.
 *
 * The second alternative excludes `"` as well as `]`, so a quote can only
 * be read as part of a fence that closes. That is what refuses `A["]` and
 * `A["""]` — Mermaid raises a parse error on both — instead of drawing a
 * node with a stray quote in its label, and it is also what keeps the two
 * alternatives from overlapping, so this pattern cannot backtrack
 * exponentially over a line full of quotes.
 *
 * Nor may an unquoted `[`, `{` or `}` stand there: Mermaid 12.2.0 refuses
 * every one of them inside any shape's label (`A[a}b]`, `A[a[b]`,
 * `A>a{b]`, measured), so they are refused here too (ADR-0017), with the
 * quoted fix `refuseNodeLabel` offers.
 *
 * An unquoted `(` or `)` is a label character here, and that is a known,
 * deliberate divergence in Siren's permissive direction: Mermaid 12.2.0
 * reads `P[a (b)]` as a parse error ("got 'PS'") and only accepts the
 * quoted `P["a (b)"]`. Siren draws both as the rect labelled `a (b)`.
 * Only a balanced pair is that divergence: a parenthesis with no partner
 * (`A[a)b]`, `A[a(b]`) is refused, as Mermaid refuses it, which a pattern
 * cannot count and `unpairedParenAt` does.
 * Accepting more than Mermaid breaks no Mermaid document, and refusing it
 * would take the picture away from documents that draw today (nook
 * 01M4R3RVV). It is not a corpus row, because a corpus source must be valid
 * Mermaid; `parseSiren.test.ts` pins it instead.
 *
 * Written once and shared by both readers below, so that a label means the
 * same thing on a line of its own as it does at an edge endpoint.
 */
const LABEL_CONTENT = String.raw`(?:"[^"]*"|[^\[\]{}"])*`;

/**
 * What may lie between the `(` and the `)` of a round node: the same two
 * alternatives again, with **every** bracket character excluded from the
 * unfenced alternative.
 *
 * The exclusion is what keeps `A(text)` from swallowing the three shapes
 * spelled with an inner bracket. `A((Circle))` differs from `A(Round)` by
 * one pair of parentheses and `A([Stadium])` by one pair of square
 * brackets, so a pattern that let either character into the label would
 * read a circle as a round node labelled `(Circle)` — a valid Mermaid
 * document drawn as the wrong picture with no diagnostic, which is the one
 * failure the compatibility corpus exists to keep at zero. `[` and `]` are
 * on the list for the same reason and for the cylinder's sake: `A[(DB)]`
 * is that shape's own punctuation, not a round node's label.
 *
 * Refusing them is compatibility rather than strictness: mermaid 11.17.2
 * rejects `A(a]b)`, `A(a[b)`, `A(a{b)`, `A(a}b)` and `A(a"b)` outright,
 * measured with `scripts/mermaid-probe.mjs`. What it *does* take is the
 * fenced form — `A("a)b")` is a round node labelled `a)b` — which is the
 * first alternative here, exactly as it is inside `[...]` and `{...}`.
 */
const PAREN_LABEL_CONTENT = String.raw`(?:"[^"]*"|[^()\[\]{}"])*`;

/**
 * A node's id, widened to admit `.` — the punctuation mermaid 11.17.2's own
 * id alphabet allows there, measured with `scripts/mermaid-probe.mjs`:
 * `a.b --> c` records the vertices `a.b` and `c`, and `a.-b --> c` records
 * `a.-b` and `c` — one node either way, the dot (and, in the second case,
 * the dash right after it) inside the id rather than cutting it in two.
 *
 * The second shape is not a coincidence this pattern has to special-case.
 * `RUN_OPENING_DOTTED_BODY` already refuses to read a `.-` run as the start
 * of a dotted arrow when it follows a word character — the guard board 2
 * wrote so `a.-b` would be an honest refusal rather than three nodes drawn
 * from two — so the text that reaches an id reader here can already contain
 * that run whole. This pattern is what accepts it: one or more word
 * characters, then any number of "a run of dots, optionally closed by one
 * dash, then more word characters" segments — the exact shape a guarded
 * dotted body has.
 *
 * **And `-`, wherever it cannot begin an arrow** (01M2SVAFT). Mermaid's own
 * id rule takes a dash unless the next character is `>`, `-` or `.` — the
 * three an arrow's body starts with — and that is the whole of it, measured
 * on mermaid 12.2.0: `a-b --> c` and `a-b-->c` are both the node `a-b` and an
 * edge, `a-b-c` is one node, `-a` and `a-` (before a space) are nodes,
 * `a-b---c`, `a-b==>c` and `a-b-.->c` end the id at the arrow, and `a--b`,
 * `a-.b` and `a - b` are parse errors. So a dash may open the id before a
 * word character, and may follow any run of it on the same lookahead — or
 * end it, since an endpoint arrives here trimmed and `a-`, `b --> a-` and
 * `a-:::x` all name `a-` (measured).
 */
const ID_DASH = String.raw`-(?=[^>\-.]|$)`;
/**
 * A word character of an id — and `%`, which Mermaid 12.2.0's node-string
 * alphabet takes anywhere in an id (01M4ZWT8PR, measured): `A%B --> C`,
 * `%A`, `A%`, `A-->B%C`, `A%B[lbl]`, `%-A` and `A.%B` each record the id as
 * written, and `%` alone is a node. Its `%%` is the id's too where it is
 * glued to the id (`midLinePercentAt`).
 */
const ID_CHAR_SET = String.raw`\w%`;
const ID_CHAR = `[${ID_CHAR_SET}]`;
/**
 * Every character an id may hold anywhere: `ID_CHAR`'s, and the `.` and `-`
 * `ID_RUN` admits between them — the one alphabet each hand-written id
 * boundary below is built from, so a character added to an id cannot be
 * missed at one of them.
 */
const ID_ALPHABET_SET = String.raw`${ID_CHAR_SET}.\-`;
/**
 * Where an id cannot be continuing: the character before is none of
 * `ID_ALPHABET_SET`'s. What tells an arrow's `o`/`x` marker, a dotted body's
 * `.` and a `%%` from the characters of an id they are glued to.
 */
const NOT_AFTER_ID = `(?<![${ID_ALPHABET_SET}])`;
const ID_RUN = String.raw`(?:-(?=${ID_CHAR}))?${ID_CHAR}+(?:\.+-?${ID_CHAR}*|${ID_DASH}${ID_CHAR}*)*`;

/**
 * The words Mermaid 12.2.0's flowchart lexer reads as a keyword wherever an
 * id could begin, when the next character is not `[A-Za-z0-9_]` (its rules
 * are `style\b`, `class\b`, `end\b\s*` and the rest, tried before the id
 * rule, first match wins; measured with `pnpm --filter siren-core probe`).
 * `end-x` there is the keyword `end` and then `-x`: a parse error at the top
 * level, and inside a `subgraph` the block's end and then a node `-x`.
 * Longest first, so a regular expression alternating them names
 * `flowchart-elk` before `flowchart` and `classDef` before `class`.
 *
 * Not here: `click`, `call` and `href`, read as keywords only before a
 * space (`click-x` is an id; `SPACED_KEYWORDS`), and `default`, `v` and `direction`, which the
 * grammar takes back as an id (`default-x`, `v-x`, `direction-x` are
 * nodes, measured).
 */
const ID_KEYWORDS = [
  "flowchart-elk",
  "swimlane-beta",
  "linkStyle",
  "interpolate",
  "classDef",
  "class",
  "style",
  "graph",
  "flowchart",
  "subgraph",
  "end",
  "_self",
  "_blank",
  "_parent",
  "_top",
] as const;

/**
 * A class name, in `classDef`, `class` and `:::` alike: one or more words
 * joined by `.`, `#` or `+`, each word an optional `-`, then a letter, `_`,
 * a non-ASCII character or a `\`, then any of those, digits and `-`.
 *
 * Measured in headless Chrome on Mermaid 12.2.0: Mermaid writes each
 * `classDef` as the CSS rule `.<name> > *`, and a name that makes that rule
 * parse is drawn styled (`c-d`, `c.d`, `c#d`, `c+d`, `-c`, `c-`, `cé`,
 * `c\d`), while one that does not stops the whole diagram from rendering
 * (`c%`, `1c`, `c.`, `c..d`, `c:d`, `c!` and the rest). Siren applies a class
 * by its name and writes no CSS for it, so this pattern is the whole of the
 * rule. A `-` before `>`, `-` or `.` begins an arrow there, as in an id
 * (`ID_DASH`).
 */
const CLASS_WORD = String.raw`-?[A-Za-z_\u0080-\uFFFF\\](?:[\w\u0080-\uFFFF\\]|-(?=[^>\-.]|$))*`;
const CLASS_NAME = String.raw`${CLASS_WORD}(?:[.#+]${CLASS_WORD})*`;

/** A `class` statement's target list (`CLASS_APPLY_RE`), without a group. */
const CLASS_APPLY_TARGETS = String.raw`[${ID_ALPHABET_SET}\s,]*[${ID_ALPHABET_SET},]`;

/** One of `ID_KEYWORDS`, read as the keyword: not followed by `[A-Za-z0-9_]`. */
const ID_KEYWORD = `(?:${ID_KEYWORDS.join("|")})(?![A-Za-z0-9_])`;

/** A node's id: `ID_RUN`, unless it begins with a keyword (`ID_KEYWORD`). */
const NODE_ID = `(?!${ID_KEYWORD})${ID_RUN}`;

/**
 * Every bracket spelling of a node, paired with the shape it names — the
 * one place a spelling and a shape are associated, read by the standalone
 * declaration and by an edge endpoint alike.
 *
 * `open` and `close` are what surround the label, as patterns, and
 * `content` is what the label may hold; `bracketOf` joins the three with the
 * label as its single capture group, so the patterns below can be built from
 * them without any of them learning what punctuation any shape uses. Not
 * every spelling is bracketed on both sides — the asymmetric flag opens
 * with a bare `>` — which is the reason these are patterns rather than
 * characters. A later ticket adds a row; nothing else here moves.
 *
 * Ordered, and read in order: a spelling that is a prefix of another must
 * come after it. That is why the four slanted forms precede `rect` — their
 * slashes are ordinary label characters to `LABEL_CONTENT`, so `A[/Para/]`
 * would otherwise read as a rectangle labelled `/Para/`, which is exactly
 * the swallow those forms were refused outright to prevent. The cylinder
 * precedes `rect`, and the subroutine and the stadium precede `rect` and
 * `round` respectively, for the same
 * reason, and their label patterns close the same door a second time:
 * `LABEL_CONTENT` cannot cross a `]` and `PAREN_LABEL_CONTENT` cannot cross
 * a bracket of any kind, so neither of those two pairs could swallow the
 * other whichever way round they were listed. Both belts are worn because
 * the order is a rule a reader has to keep, while the exclusions hold on
 * their own.
 *
 * The four slanted forms do not overlap each other: which shape a spelling
 * names is decided by *both* leaning characters, and a label is free to
 * contain either of them. Mermaid 11.17.2 reads `A[/a\b/]` as a
 * `lean_right` labelled `a\b` and `A[\a/\]` as a `lean_left` labelled `a/`
 * (`pnpm --filter siren-core probe`), so it is the closing pair that ends
 * the label, which is what `LABEL_CONTENT`'s backtracking gives here.
 *
 * A one-character label keeps board 4's length rule for free: `A[/]` cannot
 * match `\[/…/\]`, which needs a `/` at each end, so it stays a rectangle
 * labelled `/` — as it is in Mermaid.
 */
interface NodeSpelling {
  shape: NodeShape;
  open: string;
  content: string;
  close: string;
}

const NODE_SPELLINGS: ReadonlyArray<NodeSpelling> = [
  { shape: "parallelogram", open: String.raw`\[/`, content: LABEL_CONTENT, close: String.raw`/\]` },
  { shape: "parallelogram-alt", open: String.raw`\[\\`, content: LABEL_CONTENT, close: String.raw`\\\]` },
  { shape: "trapezoid", open: String.raw`\[/`, content: LABEL_CONTENT, close: String.raw`\\\]` },
  { shape: "trapezoid-alt", open: String.raw`\[\\`, content: LABEL_CONTENT, close: String.raw`/\]` },
  { shape: "subroutine", open: String.raw`\[\[`, content: LABEL_CONTENT, close: String.raw`\]\]` },
  // The cylinder before `rect`, for the reason the four slanted forms come
  // before it: `LABEL_CONTENT` would read `A[(DB)]` as a rectangle labelled
  // `(DB)`, which is the picture board 4 refused this spelling to stop
  // Siren drawing. Its label is a `[`-family label, `LABEL_CONTENT`, so a
  // balanced pair of parentheses inside it is the 01M4R3RVV divergence as
  // it is in a rect's (`A[(f(x))]` is the cylinder `f(x)`), and an unpaired
  // one is refused (`A[(a)b)]`): `unpairedParenAt` turns the cylinder down,
  // and the rect that would then read `(a)b)` is turned down the same way.
  { shape: "cylinder", open: String.raw`\[\(`, content: LABEL_CONTENT, close: String.raw`\)\]` },
  { shape: "rect", open: String.raw`\[`, content: LABEL_CONTENT, close: String.raw`\]` },
  { shape: "stadium", open: String.raw`\(\[`, content: LABEL_CONTENT, close: String.raw`\]\)` },
  // Three parenthesised spellings, deepest nesting first, and the label
  // pattern is what makes the order a courtesy rather than a load-bearing
  // rule: `PAREN_LABEL_CONTENT` admits no parenthesis, so a double circle
  // can never be read as a circle labelled `(Double)` nor as a round node
  // labelled `((Double))` whichever way round the three are listed.
  { shape: "double-circle", open: String.raw`\(\(\(`, content: PAREN_LABEL_CONTENT, close: String.raw`\)\)\)` },
  { shape: "circle", open: String.raw`\(\(`, content: PAREN_LABEL_CONTENT, close: String.raw`\)\)` },
  { shape: "round", open: String.raw`\(`, content: PAREN_LABEL_CONTENT, close: String.raw`\)` },
  // The two brace spellings read `LABEL_CONTENT` too, and its exclusion of
  // `{` and `}` is what lets them be told apart at all: `\{…\}` can never
  // reach across an inner brace, so `A{{Hexagon}}` is only ever read by the
  // hexagon's own pattern, never as a diamond labelled `{Hexagon}`, and the
  // two can be listed in either order. An unfenced brace inside the label is
  // not Mermaid either (`A{{a}b}}` is a parse error, as is `A{a]b}`, "got
  // 'SQE'", measured on 12.2.0), while a fenced one is a label character:
  // `A{"a}b"}` is the label `a}b` and `A{{"a}}b"}}` the hexagon `a}}b`.
  { shape: "hexagon", open: String.raw`\{\{`, content: LABEL_CONTENT, close: String.raw`\}\}` },
  // No opening bracket: `A>Flag]`. Its `>` is also the last character of
  // `-->`, and the two never collide because a line is cut into endpoints
  // at its arrows before any of these patterns is asked anything — each
  // sees one endpoint, anchored at both ends. Mermaid 11.17.2 reads
  // `A>a>b]` as the label `a>b`, so a `>` inside the label is ordinary
  // text, which is exactly what `LABEL_CONTENT` already says.
  { shape: "asymmetric", open: String.raw`>`, content: LABEL_CONTENT, close: String.raw`\]` },
  // A brace spelling: see the hexagon's row.
  { shape: "rhombus", open: String.raw`\{`, content: LABEL_CONTENT, close: String.raw`\}` },
];

/**
 * A node declaration in each spelling, with the optional `:::name`
 * shorthand that applies a `classDef` at the declaration itself.
 * `A[Start]:::emphasis`, `A{Is it ready?}:::emphasis`.
 *
 * Groups are `id`, `label`, `definitionName` in every one of them, which is
 * what lets `readNodeDeclaration` read them all with one body.
 *
 * `LABEL_CONTENT` reads a bracket's label loosely — including the fenced
 * `` "`...`" `` Markdown-string spelling, which is not a form this pattern
 * has to know exists: it captures the bracket content whole, and
 * `parseNodeLabel` is what tells a Markdown label from an ordinary one once
 * the content reaches it.
 */
const NODE_PATTERNS = NODE_SPELLINGS.map((spelling) => ({
  shape: spelling.shape,
  re: new RegExp(String.raw`^(${NODE_ID})\s*${bracketOf(spelling)}\s*(?::::(${CLASS_NAME}))?\s*$`, "d"),
}));

/**
 * Everything after a node's id as a pattern — its spelling's `open`, the
 * label as the one capture group, its `close` — with the label holding
 * `content`, or whatever else the caller asks it to hold.
 */
function bracketOf({ open, content, close }: NodeSpelling, holding: string = content): string {
  return `${open}(${holding})${close}`;
}

/**
 * The quotation mark that fences a label: `A["Quoted, with comma"]`.
 *
 * Quoting is how a Mermaid author escapes a label containing the characters
 * the grammar would otherwise eat, so the fence is **syntax** and never part
 * of the picture. Drawing it — which is what Siren used to do before the
 * construct was refused outright — punishes exactly the author who needed
 * the escape hatch.
 */
const LABEL_FENCE = '"';

/**
 * A **fenced** label: one quoted run spanning the whole of the bracket
 * content, capturing what it fences.
 *
 * One run spanning everything, rather than a quote at each end, and the
 * difference is a mangled label. `A["hi" and "bye"]` begins and ends with a
 * quote but is two runs with the author's own text between them; stripping
 * the outer pair would draw `hi" and "bye`, which nobody wrote. So this
 * pattern forbids a fence inside the fence, and content that is not one run
 * is an ordinary label with quote characters in it — the rule
 * `A[say "hi" now]` has always followed.
 */
const FENCED_LABEL_RE = /^"([^"]*)"$/;

/**
 * The label an author wrote inside `[...]`, with the fence removed when
 * there is one, and the padding around it dropped — and **where** in
 * `content` that label begins, past the quote fence and the padding, so
 * that a problem `readLabel` finds at some offset in the label can be
 * pointed at in the author's own line. Every label this parser reads has
 * its position carried this way, from the statement down to the character.
 *
 * Trimmed whether or not the label was quoted: mermaid 11.17.2 records
 * `text="padded"` for both `A[  padded  ]` and `A["  padded  "]`
 * (`node scripts/mermaid-probe.mjs`, `fc-text-label-whitespace`). Padding a
 * label is how an author lays a document out, not part of what the box
 * says, so it is dropped here rather than drawn.
 */
function labelSpan(content: string): LabelSpan {
  const fenced = FENCED_LABEL_RE.exec(content);
  const inner = fenced === null ? content : fenced[1];
  const at = (fenced === null ? 0 : LABEL_FENCE.length) + (inner.length - inner.trimStart().length);
  return { text: inner.trim(), at };
}

/** A label's text, and the offset it begins at in whatever it was cut from. */
interface LabelSpan {
  text: string;
  at: number;
}

/**
 * What is left of a fenced label once `labelSpan`'s own quote fence has come
 * off, when that remainder is itself fenced in backticks — Mermaid's
 * Markdown-string spelling: `` A["`**bold**`"] ``. Anchored at both ends,
 * the same rule `FENCED_LABEL_RE` follows: one run spanning everything left,
 * not a backtick that merely appears somewhere inside an ordinary label.
 *
 * `[\s\S]` rather than `.`, because the content between the backticks may
 * carry a real line break — see `joinMarkdownFence`, which is what lets one
 * reach here at all: mermaid 11.17.2 reads a quoted label across physical
 * source lines when the closing quote has not been reached yet, measured
 * (`scripts/mermaid-probe.mjs`, `node="A" text="line1\nline2"`), and `.`
 * does not match a newline without the `s` flag this file avoids elsewhere.
 */
const MARKDOWN_FENCE_RE = /^`([\s\S]*)`$/;

/**
 * A node label read from bracket content: the fence comes off (`labelSpan`),
 * and what is left is read by `readLabel` — as a Markdown string when the
 * author wrote the fenced `` "`...`" `` spelling, so `**`/`*` and a real
 * line break mean something there and nowhere else. The one place both
 * spellings are told apart, so a standalone declaration
 * (`readNodeDeclaration`) and an edge endpoint cannot disagree about what a
 * label means, exactly as `labelSpan` already keeps them from disagreeing
 * about quoting.
 */
function parseNodeLabel(content: string): ReadLabelResult {
  const stripped = labelSpan(content);
  const markdown = MARKDOWN_FENCE_RE.exec(stripped.text);
  return markdown === null
    ? readLabelAt(stripped, { dialect: "html" })
    : readLabelAt(
        // Past the opening backtick, which is syntax like the quote fence.
        { text: markdown[1], at: stripped.at + 1 },
        { dialect: "html", markdown: true },
      );
}

/**
 * `readLabel` over a span, with each problem's offset moved from the span's
 * own text into whatever the span was cut from — the one place that
 * arithmetic is written, for every label position this parser reads.
 */
function readLabelAt(span: LabelSpan, options: Parameters<typeof readLabel>[1]): ReadLabelResult {
  const { label, problems } = readLabel(span.text, options);
  return { label, problems: problems.map((problem) => ({ ...problem, offset: problem.offset + span.at })) };
}

/**
 * The bare `A:::emphasis` shorthand — the same application written without a
 * label. It stays a pattern of its own so that a bare `A` on a line by
 * itself keeps being an unrecognized line rather than silently declaring a
 * node: what makes this a declaration is the `:::`.
 */
const NODE_CLASS_RE = new RegExp(String.raw`^(${NODE_ID})\s*:::(${CLASS_NAME})\s*$`);

/**
 * **One** endpoint of an edge line, in each bracket spelling: an id, free to
 * carry the same label and `:::name` an endpoint written on a line of its
 * own may carry — the shorthand works wherever a node can be written, as it
 * does in Mermaid, rather than only at a standalone declaration.
 *
 * Built from `NODE_SPELLINGS`, the same table the standalone declaration is
 * built from, which is what keeps `A{X}` from meaning one thing on a line
 * of its own and another at the end of an arrow. A shape is a property of
 * the node, not of where it was mentioned.
 *
 * One endpoint rather than a whole line, because a line may name any number
 * of them: `A --> B --> C` is a chain of three. The line is cut into
 * endpoints first (`cutOutsideLabel`) and each piece read with this, so
 * how many endpoints a line has is not something a pattern has to encode.
 *
 * Anchored at both ends, which is what keeps a partial read impossible: an
 * endpoint that does not match refuses the **whole** statement, so no
 * chain is ever half-consumed. That is board 3's argument for pinning
 * chains as rejected, kept rather than discarded — reading some of the
 * nodes on a line and dropping the rest would draw a diagram nobody wrote,
 * which is worse than an honest refusal.
 *
 * Each label pattern is the one its standalone declaration reads, because
 * quoting works wherever a label can be written — Mermaid takes
 * `A["a]b-->c"] --> B["x, y"]:::hot`, and so does this.
 */
const ENDPOINT_PATTERNS = NODE_SPELLINGS.map((spelling) => ({
  shape: spelling.shape,
  // `d` for the label's own index, which `labelAt` is measured from.
  re: new RegExp(String.raw`^(${NODE_ID})\s*${bracketOf(spelling)}(?:\s*:::(${CLASS_NAME}))?$`, "d"),
}));

/**
 * An endpoint written with no bracket at all: `A`, or `A:::hot`.
 *
 * Its own pattern rather than an optional group inside each spelling's,
 * because with several spellings that group would be written once per row
 * and they would be free to disagree about what a bare mention is. What it
 * means — declaring the node only when nothing else has — is
 * `addNodeAsWritten`'s, as it has always been.
 */
const BARE_ENDPOINT_RE = new RegExp(String.raw`^(${NODE_ID})(?:\s*:::(${CLASS_NAME}))?$`);

/**
 * What may lie between the two `|` of an edge label: the same two
 * alternatives a node's label has, one `|` over.
 *
 * A fenced run, or a character that is neither the `|` ending the label nor
 * a quote — so a `|` reaches a label only through the fence that was
 * written to carry it. That is measured, not assumed: mermaid 11.17.2
 * rejects `A -->|a|b| B` with a parse error and reads `A -->|"a|b"| B` as
 * the label `a|b`. Excluding the quote from the second alternative is what
 * makes the two disjoint, so this cannot backtrack exponentially over a
 * line full of quotes — `LABEL_CONTENT`'s rule, and the same reasoning.
 *
 * `+` rather than `*`: an empty label is not a thing an author can write.
 * Mermaid rejects `A -->|| B` outright, so a bare `-->||` is left to fall
 * through as an unreadable line rather than quietly becoming an unlabelled
 * edge.
 */
const EDGE_LABEL_CONTENT = String.raw`(?:"[^"]*"|[^|"])+`;

/**
 * The `|text|` half of `A -->|yes| B`, optional and trailing the arrow it
 * labels.
 *
 * Part of the arrow token rather than a pattern of its own, because it is
 * part of the *run* that separates two endpoints: `A` and `B` are what lie
 * on either side of `-->|yes|`, and a cutter that stopped at the `-->`
 * would hand `|yes| B` to the endpoint reader as if the author had written
 * it. It is also what keeps a `;` or an `&` inside a label from being read
 * as a separator, since `cutOutsideLabel` skips a whole arrow token.
 *
 * The `\s*` is Mermaid's: `A --> |yes| B` is a document it draws
 * (measured), so the space between the arrow and its label is not a place
 * an endpoint could be.
 */
const PIPE_LABEL = String.raw`(?:\s*\|(${EDGE_LABEL_CONTENT})\|)?`;

/** What may decorate an arrow's from-end, and what may decorate its to-end. */
// An `o` or `x` right after an id character is the id's, not a marker:
// `a-o-->b` and `a.o-->b` are the nodes `a-o` and `a.o` with plain arrows in
// mermaid 12.2.0 (measured, 01M2SVAFT), since both `-` and `.` are in its id
// alphabet. Only `\w` was guarded before, which read `a.o-->b` as `a.` and
// a circle-headed arrow, silently — and so is `%` (`A%x--xB` is the node
// `A%x`, measured, 01M4ZWT8PR).
const FROM_MARKER = `<|${NOT_AFTER_ID}[ox]`;
const TO_MARKER = String.raw`[>ox]`;

/**
 * The body of a dotted line: a run of dots, closed by a dash, and opened by
 * a dash the author may leave out.
 *
 * `A -.-> B` and `A .-> B` are one arrow written two ways in mermaid
 * 11.17.2 — both `type="arrow_point" stroke="dotted" length=1`, measured
 * with `scripts/mermaid-probe.mjs` — and so are `A -.- B` and `A .- B`.
 * The **closing** dash is grammar and the opening one is decoration.
 */
const DOTTED_BODY = String.raw`-?\.+-`;

/**
 * The same body, for the one place it may **begin a run**: where a `.`
 * following a word character would be a character of an id rather than the
 * start of an arrow.
 *
 * **A dot is in Mermaid's node-id alphabet, so a leading one only opens a
 * body where an id cannot be.** This is `ARROW_TOKEN`'s `(?<!\w)[ox]` rule
 * a second time and it is here for the same reason: `a.-b --> c` is *one*
 * node called `a.-b` with one edge to `c`, and the boundary is whitespace —
 * `A .->B` is a dotted edge and `A.->B` is a parse error, all three
 * measured. Unguarded, this pattern cuts that line at the `.-` and draws
 * three nodes and two edges where Mermaid draws two and one, silently.
 * `ID_RUN` is what spells `a.-b` as one id — this guard is what leaves the
 * text for it to spell: without the guard, the `.-` would already be gone
 * as an arrow token by the time an id reader saw anything, and no widening
 * of the alphabet could put it back.
 *
 * The guard is on the dash-less spelling alone. A body that opens with a
 * dash is already unreachable from inside an id, since Mermaid ends an id
 * at a `-` followed by a `.` — `A-.->B` is an edge there, measured — so
 * guarding it as well would refuse a document Mermaid draws.
 *
 * And an `o` or an `x` that `FROM_MARKER` already took is not an id either,
 * so the dots may follow one: `A o.-o B` is a `double_arrow_circle` and
 * `A x.-x B` a `double_arrow_cross`, both dotted, both measured. A
 * lookbehind cannot see that the character was consumed as a marker, so the
 * exception restates `FROM_MARKER`'s own condition — a marker, itself not
 * inside an id — rather than simply allowing any `o` or `x`. That is what
 * keeps `Ax.-xB` refused, which is one node id in Mermaid and no edge at
 * all, measured, exactly as `Ax--xB` already was. Both guards are built
 * from the id alphabet, so a `%` is an id character to them too: `A%.-B`
 * and `A%x.-xB` are one node each, and `A%.->B` no edge (measured,
 * 01M4ZWT8PR).
 *
 * **Only a run's start needs it**, which is why there are two constants
 * rather than one guarded body everywhere. An inline label's closer cannot
 * begin inside an id, because the id ended at the opener that started the
 * run — so `A -. yes.-> B` and `A -.yes.-> B` are edges labelled "yes" in
 * Mermaid, measured, exactly as the solid `A -- yes--> B` is. Guarding the
 * closer too refused both, and refused them for the dotted stroke alone,
 * which is a rule no author could predict.
 */
const RUN_OPENING_DOTTED_BODY = `(?:-|(?<=${NOT_AFTER_ID}[ox])|(?<!${ID_CHAR}))\\.+-`;

/**
 * An arrow written as one run: a marker, a body, a marker.
 *
 * The lookahead is what stops this from swallowing the **opener** of an
 * inline-labelled arrow. `--`, `==` and `-.` are not arrows — each would
 * decompose to zero ranks, which is exactly the `minLength < 1` case
 * `readArrow` already refuses, and Mermaid says the same thing in its own
 * lexer by requiring a `[-xo>]` after the dashes before a run counts as a
 * `LINK`. Without the guard, `A -- yes --> B` would be cut at its opening
 * `--` and the label read as an endpoint; with it, the plain branch simply
 * does not match there and the labelled branch below does.
 *
 * A pre-filter, not the grammar: three characters of the right kind are
 * necessary, and the body patterns still decide what is sufficient. It
 * guards the dashed and thick bodies **only**, because the shortest dotted
 * arrow is two characters rather than three — `A .- B` is an `arrow_open`
 * Mermaid draws, measured — and a three-character pre-filter would refuse
 * it. A dotted body needs no such guard: it ends in a dash of its own, so
 * it cannot match `-.`, the one dotted opener there is.
 *
 * Taken as a function of its dotted body because there are two contexts and
 * they differ in exactly that one part — see `RUN_OPENING_DOTTED_BODY`. The
 * rest is written once, so a change to how an end is marked cannot land in
 * one context and not the other.
 */
const plainArrow = (dottedBody: string) =>
  String.raw`(${FROM_MARKER})?((?=[-=.]{2}[-=.>ox])(?:-{2,}|={2,})|~{3,}|${dottedBody})(${TO_MARKER})?`;

/** The plain arrow as it appears in a line, where it may not begin inside an id. */
const PLAIN_ARROW = plainArrow(RUN_OPENING_DOTTED_BODY);

/**
 * The plain arrow as it appears **closing an inline label**, where the run
 * it belongs to has already been opened and an id cannot be in progress.
 */
const INLINE_CLOSING_ARROW = plainArrow(DOTTED_BODY);

/**
 * The three strokes an inline-labelled arrow can be written in, each as the
 * opener that starts it, the characters its label may be made of, and the
 * body that closes it.
 *
 * **The label's alphabet is scoped to the stroke, and that is measured.**
 * `A == x --> y ==> B` is one thick edge labelled `x --> y` in mermaid
 * 11.17.2, because its lexer reads a thick label with a rule that only
 * stops at `=`. A single stroke-agnostic alphabet would cut that line at
 * the `-->` and draw three nodes. The three rows are Mermaid's own
 * `edgeText`/`thickEdgeText`/`dottedEdgeText` lexer states, one for one.
 *
 * The closing bodies are the same three this file already uses for a plain
 * arrow — the stroke an opener starts is the stroke that must close it,
 * and `A -- yes ==> B` is a parse error in Mermaid, measured. `DOTTED_BODY`
 * shared literally rather than restated, so that the closer of a labelled
 * dotted arrow and a plain one are one spelling: `A -. yes .-> B` is one
 * `arrow_point` labelled "yes", dotted, length=1, measured.
 *
 * **An opener is not a body, and the dotted pair are the reason to say so.**
 * The closer may drop its leading dash and the opener may not: `A .- yes
 * .-> B` is not a labelled edge in Mermaid at all but a chain of three
 * nodes, `A .- yes` then `yes .-> B`, measured — because `.-` is a whole
 * arrow and `-.` is the only thing that opens a dotted label. So the
 * openers stay literal while the bodies are shared.
 */
const INLINE_LABEL_STROKES = [
  { opener: String.raw`--`, alphabet: String.raw`[^-]|-(?!-)`, body: String.raw`-{2,}` },
  { opener: String.raw`==`, alphabet: String.raw`[^=]`, body: String.raw`={2,}` },
  { opener: String.raw`-\.`, alphabet: String.raw`[^.]`, body: DOTTED_BODY },
];

/**
 * `-- yes -->` — the other spelling of an edge label, written between the
 * two halves of the arrow rather than after it.
 *
 * Part of the arrow token for the same reason `PIPE_LABEL` is: it is the
 * *run* that separates `A` from `B`, so a cutter that stopped at the
 * opening `--` would hand ` yes ` to the endpoint reader as a node called
 * `yes` — which is precisely what mermaid 11.17.2 does with
 * `A ---- yes --> B`, whose four-dash opener is a whole arrow rather than
 * an opener, measured.
 *
 * Nothing here captures. What the run *means* is read back by
 * `readArrow`, which splits it with an anchored pattern of its own; this
 * one only has to end the run in the same place Mermaid's lexer does, and
 * leaving the group numbers to the plain branch is what keeps that split
 * readable.
 */
const INLINE_LABELLED_ARROW = INLINE_LABEL_STROKES.map(
  ({ opener, alphabet, body }) =>
    String.raw`(?:${FROM_MARKER})?${opener}\s*(?:${alphabet})+?\s*(?:${FROM_MARKER})?${body}(?:${TO_MARKER})?`,
).join("|");

/**
 * The run of characters that joins two endpoints — **one pattern for every
 * arrow spelling**, read as three parts rather than matched against a list
 * of thirteen names.
 *
 * `A <-.-> B` is not a fourteenth arrow: it is a dotted line with an arrow
 * at each end. The parts are exactly the axes `EdgeLine`/`EdgeEnd` name, so
 * a spelling nobody thought of composes out of the same three answers, and
 * the ones Mermaid has no name for are refused by `readArrow` rather than
 * silently read as something else.
 *
 * One pattern, used twice — sticky, to cut a line at its arrows, and
 * anchored, to read the token that cut it (`readArrow`) — because two
 * statements of one grammar are two things free to disagree about what
 * `-..->` is.
 *
 * **The run includes the edge's label, in either spelling.** `-->|yes|` and
 * `-- yes -->` are what lies between `A` and `B` just as `-->` is, so both
 * belong to the thing that separates the endpoints rather than to the
 * endpoints themselves. The consequence worth naming: everything the label
 * contains — a `;`, an `&`, another arrow — is inside a token here, so
 * `cutOutsideLabel` steps over it and the surrounding grammar never sees
 * it, which is the same protection a node's `[...]` already has.
 *
 * The labelled branch captures nothing, so the group numbers stay the plain
 * branch's and `readArrow` reads a plain token exactly as it did. A
 * labelled run is split by `INLINE_LABELLED_PARTS_RE` first and then
 * spliced back into the plain token it decorates, so there is still one
 * decomposition and not two.
 *
 * **`o` and `x` are word characters, so the leading one is only a marker
 * where an id cannot be.** Without the lookbehind, `Ax--xB` would be cut at
 * `x--x` and drawn as `A` to `B`; mermaid 11.17.2 reads it as the node `Ax`
 * and a plain `--x`, measured, and the guard is what makes this agree. `<`
 * needs no guard: no id can end in one, and `A<-->B` is a document Mermaid
 * draws.
 */
const ARROW_TOKEN = `(?:${PLAIN_ARROW}|${INLINE_LABELLED_ARROW})${PIPE_LABEL}`;

/** The sticky form, for cutting a line into endpoints at every arrow outside a label. */
const ARROW_RE = new RegExp(ARROW_TOKEN, "y");

/**
 * The anchored form, for reading a token the cut produced back as its three
 * parts: the from-end marker, the line, the to-end marker.
 *
 * The same source text, so the two cannot drift. The lookbehind costs
 * nothing here — nothing precedes position 0 — which is what lets one
 * pattern serve both readings.
 */
const ARROW_PARTS_RE = new RegExp(`^${ARROW_TOKEN}$`, "d");

/**
 * Where in an arrow `token` its `|label|` holds what Mermaid 12.2.0 refuses
 * there, what that is, and the token with the whole label quoted — or
 * `null` when it holds nothing of the kind. Measured: a bracket outside
 * quotes (`A -->|a{b| B`, and `}`, `(`, `)`, `[`, `]`) and a quote anywhere
 * but where the label opens (`A -->|a"{"b| B`, `A -->|a "b"| B`) are parse
 * errors, and so is an `@` in a first word written right after the `|`
 * (`A -->|a@b| B`, read as an edge id), while `A -->|"a{b"| B`,
 * `A -->|x a@b| B` and the other spelling, `A -- a{b --> B`, are labels as
 * written. Offsets are string indices, so a column counts
 * UTF-16 code units like every other column here.
 */
function refusedInPipeLabel(
  token: string,
): { at: number; refused: "bracket" | "quote" | "at"; character: string; fixed: string } | null {
  const match = ARROW_PARTS_RE.exec(token);
  const content = match?.[4];
  if (content === undefined) {
    return null;
  }
  const contentAt = match!.indices![4]![0];
  // A quoted run where the label opens is the label's own; past it, only
  // what stands outside quotes is the author's text.
  // A quoted run opens the label only right after the `|`: a space before
  // it is a parse error in Mermaid 12.2.0 (`| "a" |`, measured).
  let from = 0;
  if (content.startsWith(LABEL_FENCE)) {
    const closingFence = content.indexOf(LABEL_FENCE, 1);
    if (closingFence === -1) {
      return null;
    }
    from = closingFence + 1;
  }
  // An `@` in a word written right after the `|`, unless a `{` follows it:
  // `|a@{b}|` is refused at its brace instead (measured).
  const idAt = /^[^\s"]*?@(?!\{)/.exec(content)?.[0].length ?? 0;
  const atIndex = idAt - 1;
  for (let index = from; index < content.length; index++) {
    const character = content[index]!;
    if (character !== LABEL_FENCE && !LABEL_BRACKETS.includes(character) && index !== atIndex) {
      continue;
    }
    const label = content.trim().replaceAll(LABEL_FENCE, "");
    return {
      at: contentAt + index,
      refused: character === LABEL_FENCE ? "quote" : index === atIndex ? "at" : "bracket",
      character,
      fixed: `${token.slice(0, contentAt)}"${label}"${token.slice(contentAt + content.length)}`,
    };
  }
  return null;
}

/**
 * The anchored form that splits an **inline-labelled** run back into the
 * three things it says: the marker its opener carried, the label, and the
 * arrow that closed it.
 *
 * Lazy text with the closer anchored to the end, so the split is the one
 * whose tail is a whole arrow — and there is only one, because an arrow
 * carries no spaces. The stroke alphabets that decided where the run *ends*
 * are `INLINE_LABELLED_ARROW`'s and are not repeated here: by the time this
 * pattern is handed a token, the run has already been delimited.
 *
 * **A plain arrow can match it, and that is why `readArrow` does not ask it
 * first.** This comment used to claim the opposite — that a non-empty label
 * plus a whole trailing arrow left `---->` no way to be both — and the
 * claim held only while every dotted body opened with a dash. It does not
 * now: `-...->` splits as the opener `-.`, the label `.` and the closer
 * `.->`, which reads as a one-rank dotted arrow labelled "." where Mermaid
 * records `length=3` and no label. So this pattern is no longer a test of
 * *whether* a token is labelled; it is only the split, applied to a token
 * `ARROW_PARTS_RE` has already found no plain reading for.
 */
const INLINE_LABELLED_PARTS_RE = new RegExp(
  String.raw`^(${FROM_MARKER})?(--|==|-\.)\s*(.+?)\s*(${INLINE_CLOSING_ARROW})$`,
  "d",
);

/** The stroke each inline-label opener starts, which its closer must agree with. */
const OPENER_LINE: Record<string, EdgeLine> = {
  "--": "solid",
  "==": "thick",
  "-.": "dotted",
};

/**
 * What joins the endpoints of one **group** — the several nodes an edge
 * line may name at one end of an arrow, as in `A & B --> C`.
 */
const GROUP_SEPARATOR = "&";

/**
 * Where in `line` — cut at its arrows as `parts`, starting at `partAt` —
 * stands each group separator without whitespace on both sides. Mermaid
 * 12.2.0 joins a group only at a spaced `&`, measured: one glued to an id is
 * a character of it (`A%&B-->C`, `A&B-->C` and `A & B&C --> D` record the
 * single ids `A%&B`, `A&B` and `B&C`, drawing no group), and one with a
 * space on one side only, or after a bracket, is a parse error (`A &B-->C`,
 * `B& C`, `A[x]&B-->C`). The first is a picture other than the one written,
 * refused under ADR-0001; the rest are refused as Mermaid refuses them
 * (ADR-0017). An `&` inside a label is text, and `cutOutsideLabel` never
 * cuts there.
 */
function unspacedGroupSeparators(line: string, parts: readonly string[], partAt: readonly number[]): number[] {
  return parts.flatMap((part, index) => {
    const { parts: pieces, separators } = cutOutsideLabel(part, GROUP_SEPARATOR);
    const pieceAt = offsetsOf(pieces, separators);
    return separators
      .map((_, at) => partAt[index]! + pieceAt[at + 1]! - GROUP_SEPARATOR.length)
      .filter((at) => !/\s/.test(line[at - 1] ?? "") || !/\s/.test(line[at + 1] ?? ""));
  });
}

/** `line` with one space on each side of every group separator at `unspaced`. */
function spacedGroupSeparators(line: string, unspaced: readonly number[]): string {
  let spaced = "";
  let from = 0;
  for (const at of unspaced) {
    spaced += `${line.slice(from, at).trimEnd()} ${GROUP_SEPARATOR} `;
    from = at + GROUP_SEPARATOR.length;
    while (/\s/.test(line[from] ?? "")) {
      from++;
    }
  }
  return spaced + line.slice(from);
}

/**
 * What ends a statement written inside a line, so that a line is not
 * necessarily one statement: `A --> B; B --> C`.
 *
 * A **separator that is also allowed to trail**, which is what Mermaid does
 * — checked against its own flowchart parser, which takes `A --> B;`,
 * `A --> B; B --> C`, `A --> B ; ; B --> C` and a line that is nothing but
 * `;` alike. An empty statement is legal there and is simply nothing, so
 * asking whether `;` "terminates" or "separates" has one answer here:
 * it ends a statement, and what lies between two of them may be nothing.
 */
const STATEMENT_END = ";";

/**
 * The three statements that carry a **declaration list**, where a `;` is
 * not a statement end but a value the security gate has to see.
 *
 * The one place `;` stops separating, and a deliberate divergence from
 * Mermaid rather than an oversight. Mermaid does end the statement there —
 * `style A fill:red;position:fixed,stroke:#c00` leaves it holding
 * `fill:red` and invents a **node** called `position:fixed,stroke:#c00`
 * (measured, 11.17.2) — which is a silent mis-render, the exact failure
 * mode this board exists to
 * remove. Siren instead hands the whole list to `resolveStyles`, whose gate
 * refuses a value containing `;` by name: "would smuggle in a second
 * declaration". Splitting here would delete that diagnostic and quietly
 * apply the half of the value that came first.
 *
 * A `;` that merely *trails* such a statement is still spare, so
 * `classDef hot fill:red;` reads as `classDef hot fill:red` does.
 *
 * A line where a `#` follows the `:` never gets here with its last `;`:
 * Mermaid's style-line rule (`styleLines`, which `parseSiren` applies to
 * the whole document) has dropped it already, so
 * `style A fill:#fdd;position:fixed,stroke:#c00` is one declaration,
 * `fill:#fddposition:fixed`, which is what Mermaid records too (measured,
 * 11.17.2: `styles=["fill:#fddposition:fixed","stroke:#c00"]`).
 */
const DECLARATION_LIST_KEYWORDS = ["style", "classDef", "linkStyle"] as const;

/**
 * What a `style`, `classDef` or `linkStyle` declaration list cannot hold,
 * each a parse or lexical error in Mermaid 12.2.0's grammar there
 * (measured): an `@{`, an `@`, a `{` or a `}` (`fill:@{x`, `fill:a@b`,
 * `fill:a{b`, `fill:a}b`), and any run an arrow is made of — two or more
 * dashes (`stroke:a--b`, `fill:a-->b`, `stroke:var(--x)`), a dash and dots
 * (`fill:a-.b`), and any `=` or `~` (`fill:a=b`, `fill:a==>b`,
 * `fill:a~~~b`), or a dash before a `>` (`fill:a->b`). A single dash, or
 * dots then a dash, is a value (`fill:a-b`, `fill:a.-b`). So is none of a
 * bracket or a `|`: `(`, `)`, `[`, `]` and `|` are parse errors there too —
 * which refuses every CSS function, `rgb(255,0,0)` and `var(--x)` included,
 * since Mermaid draws nothing at all for one (measured in headless Chrome).
 * And no `"`: `font-family:"a b"` is a parse error, `font-family:'a b'` a
 * value.
 * Each run is matched whole, so a message quotes the arrow or run as
 * written rather than a piece of it.
 */
const STYLE_VALUE_REFUSED_RE = /@\{|[@{}()[\]|"]|-{2,}>?|->|-\.+-*>?|=+>?|~+/;

/**
 * What to write instead of a style value refused at `refused`: a colour
 * function's colour written as a hex colour, worked out when it is an
 * `rgb(r,g,b)` of whole numbers, and a hex colour or a name otherwise —
 * which is how Mermaid takes a colour; a `"` as a `'`; anything else is
 * left out.
 */
function styleValueFix(text: string, refused: RegExpExecArray): string {
  if (refused[0] === '"') {
    return "Write the quotes as single quotes";
  }
  if (refused[0] !== "(") {
    return "Leave it out";
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/.exec(
    text.slice(text.lastIndexOf(":", refused.index) + 1).trimStart(),
  );
  if (rgb !== null && rgb[0].startsWith("rgb(")) {
    const hex = rgb
      .slice(1, 4)
      .map((channel) => Math.min(Number(channel), 255).toString(16).padStart(2, "0"))
      .join("");
    return `Write the color as #${hex}`;
  }
  return "Write a color as a hex color or a name, such as #f00";
}
const DECLARATION_LIST_RE = new RegExp(`^(?:${DECLARATION_LIST_KEYWORDS.join("|")})\\s`);

/** What an end marker draws, by the character that wrote it. */
const END_FOR_MARKER: Record<string, EdgeEnd> = {
  ">": "arrow",
  o: "circle",
  x: "cross",
};

/**
 * Which end marker may open a token that closes with a given one. A token
 * decorates its from-end only by *repeating* its to-end marker, `<` being
 * the opening spelling of `>`.
 *
 * Measured, not assumed. In mermaid 11.17.2 a leading marker is read as one
 * only when it matches the trailing one: `o--o` is `double_arrow_circle`
 * while `o--x` is a plain `arrow_cross` whose leading `o` silently becomes
 * part of the *length* (`length=2`), and `<-.-` is a plain `arrow_open`
 * whose `<` disappears entirely. Those two are Mermaid drawing a picture
 * nobody asked for and saying nothing, so `readArrow` refuses them — the
 * exception CONTEXT.md carves out, recorded beside the code that takes it.
 */
const OPENING_MARKER: Record<string, string> = { ">": "<", o: "o", x: "x" };

/** The three axes, the distance and the label one arrow token decomposes into. */
interface ArrowForm {
  line: EdgeLine;
  fromEnd: EdgeEnd;
  toEnd: EdgeEnd;
  minLength: number;
  /** What the author wrote on the edge, or `null` when they wrote nothing. */
  label: string | null;
  /** Where `label` begins in the arrow token, for positioning its problems; `0` without one. */
  labelAt: number;
}

/**
 * What one arrow token means, or `null` when it is not a form Siren draws —
 * which refuses the statement rather than half of it, exactly as an
 * unreadable endpoint does.
 *
 * **The whole of the decomposition, in one place.** The line comes from the
 * character the body is made of, each end from the marker on its own side,
 * and the distance from how long the body is:
 *
 * - `-` is `solid`, `=` is `thick`, and a body carrying dots is `dotted` —
 *   mermaid 11.17.2's `stroke`, which it reports as `normal`/`thick`/
 *   `dotted` for exactly these three spellings.
 * - The **to**-end is the trailing marker and the **from**-end is a leading
 *   one that repeats it. Which end a lone marker lands on was measured:
 *   `A --o B` is `arrow_circle`, which Mermaid turns into
 *   `arrowTypeStart: "none"` and `arrowTypeEnd: "arrow_circle"`.
 * - The distance is the token's length past the shortest spelling of it:
 *   `-->` and `---` are both 1, and every further character is one more
 *   rank (`---->` is 3, `-----` is 3). A dotted token counts its dots
 *   instead (`-.->` is 1, `-..->` is 2) — Mermaid's own rule, and the
 *   reason this is not simply "count the dashes".
 *
 * A body of `--` with no marker at all is the one token this can be handed
 * that means nothing: it would be zero ranks long, and Mermaid rejects
 * `A -- B` outright. It is refused here rather than excluded from the
 * pattern, so that the grammar stays one expression.
 */
function readArrow(token: string): ArrowForm | null {
  const match = ARROW_PARTS_RE.exec(token);
  if (match === null) {
    return null;
  }
  const [, start, body, end, pipeLabel] = match;
  // `ARROW_TOKEN` has two branches and only the plain one captures, so a
  // token with no body reached here through the **labelled** branch and is
  // read by the split below instead.
  //
  // **Which branch is asked first is load-bearing, and it is asked in the
  // order `ARROW_TOKEN` itself asks.** That pattern prefers its plain
  // branch, so a token the cutter produced from the plain branch is a plain
  // token — and a reader that tried the labelled split first would be free
  // to disagree with the cut that made the token. It did: once a dotted
  // body may open without its dash, `-...->` can be split as the opener
  // `-.`, the label `.` and the closer `.->`, which is a one-rank dotted
  // arrow labelled "." where Mermaid records `length=3` and no label at
  // all. Asking in `ARROW_TOKEN`'s own order makes the two agree by
  // construction rather than by a rule stated twice.
  if (body === undefined) {
    return readInlineLabelledArrow(token);
  }
  const span = pipeLabel === undefined ? null : pipeLabelSpan(pipeLabel);
  const label = span === null ? null : span.text;
  const labelAt = span === null ? 0 : match.indices![4]![0] + span.at;
  if (label === "") {
    // `A -->|""| B`: a fence with nothing in it is not a label an author
    // can write, and reading it as an unlabelled edge would be the silent
    // mis-render this parser refuses everywhere else.
    return null;
  }

  // An invisible edge takes no marker at either end: Mermaid 12.2.0 refuses
  // `A ~~~> B`, `A <~~~ B` and `A o~~~ B` (measured).
  const invisible = body.startsWith("~");
  if (invisible && (start !== undefined || end !== undefined)) {
    return null;
  }
  const dots = body.length - body.replace(/\./g, "").length;
  const line: EdgeLine =
    dots > 0 ? "dotted" : body.startsWith("=") ? "thick" : invisible ? "invisible" : "solid";
  // Past the shortest spelling: `-->` (three characters, one of them the
  // marker) and `---` are both one rank, so an unmarked body is measured
  // against three characters and a marked one against two plus its marker.
  const minLength = dots > 0 ? dots : body.length - (end === undefined ? 2 : 1);
  if (minLength < 1) {
    return null;
  }

  const toEnd = end === undefined ? "none" : END_FOR_MARKER[end];
  if (start === undefined) {
    return { line, fromEnd: "none", toEnd, minLength, label, labelAt };
  }
  if (end === undefined || start !== OPENING_MARKER[end]) {
    return null;
  }
  return { line, fromEnd: toEnd, toEnd, minLength, label, labelAt };
}

/**
 * What one **inline-labelled** run means — `-- yes -->` and its two
 * siblings — or `null` when it is not a form Siren draws.
 *
 * Reached only from `readArrow`, and only for a token the plain reading
 * could not account for, which is what keeps one decomposition rather than
 * two.
 */
function readInlineLabelledArrow(token: string): ArrowForm | null {
  const inline = INLINE_LABELLED_PARTS_RE.exec(token);
  if (inline === null) {
    // The one spelling that reaches `ARROW_TOKEN`'s labelled branch and
    // still has no split: an inline label *and* a pipe label on one arrow,
    // `A -- x -->|y| B`, which mermaid 11.17.2 rejects too, measured.
    // Refusing it here is what keeps that a diagnostic rather than a crash.
    return null;
  }
  const [, openMarker, opener, text, closer] = inline;
  // **The opener contributes exactly one thing: a from-end marker.**
  // Everything else — the line, the to-end, the length — comes from the
  // half that closes, which is `destructLink`'s own rule in mermaid
  // 11.17.2 and was measured through it: `A -- yes ---> B` is `length=2`
  // though its opener is the two characters a one-rank arrow opens with.
  //
  // So the run is spliced back into the plain token it decorates and read
  // by the decomposition that already exists. `<-- yes -->` becomes
  // `<-->`, which means the agreement rule between the two markers is not
  // restated here: `<-- yes --x` splices to `<--x` and is refused by
  // `OPENING_MARKER` exactly as the unlabelled spelling is.
  const form = readArrow((openMarker ?? "") + closer);
  // The stroke an opener starts is the stroke that must close it —
  // `A -- yes ==> B` and `A == yes --> B` are both parse errors in
  // Mermaid (`destructLink` returns `INVALID` when the two disagree),
  // measured. Asked of the decomposed line rather than of the closer's
  // characters, so there is one place that decides what `-.` draws.
  if (form === null || form.line !== OPENER_LINE[opener]) {
    return null;
  }
  const span = edgeLabelSpan(text);
  return span.text === ""
    ? null
    : { ...form, label: span.text, labelAt: inline.indices![3]![0] + span.at };
}

/**
 * The label an author wrote on an edge, and where in `content` it begins,
 * with the fence removed and the
 * padding dropped — the padding outside the fence and the padding inside it
 * alike, exactly as `labelSpan` drops a node's.
 *
 * The outer `.trim()` runs before the fence is read rather than relying on
 * `labelSpan`'s own, because it is what lets the fenced pattern match at all
 * when an author padded outside the quotes — `A -- "yes" --> B` has
 * nothing to do with `^"..."$` until the surrounding spaces are gone. (A
 * `|label|` may not be padded before its quote: see `pipeLabelSpan`.)
 */
function edgeLabelSpan(content: string): LabelSpan {
  const span = labelSpan(content.trim());
  return { text: span.text, at: content.length - content.trimStart().length + span.at };
}

/**
 * A `|label|`'s text and where it begins: a quoted run opening the label
 * loses its quotes and keeps what follows it, as Mermaid 12.2.0 joins the
 * two (`|"a" b|` is `a b`, `|"a"b|` is `ab`, measured), and anything else
 * is read as `edgeLabelSpan` reads it. A quote anywhere else, a space
 * before the opening one included, is refused by `refusedInPipeLabel`
 * before this is asked.
 */
function pipeLabelSpan(content: string): LabelSpan {
  const closingFence = content.startsWith(LABEL_FENCE) ? content.indexOf(LABEL_FENCE, 1) : -1;
  if (closingFence === -1 || content.slice(closingFence + 1).trim() === "") {
    return edgeLabelSpan(content);
  }
  const joined = content.slice(1, closingFence) + content.slice(closingFence + 1);
  return { text: joined.trim(), at: LABEL_FENCE.length + (joined.length - joined.trimStart().length) };
}

/** One place a node was written on an edge line, as written there. */
interface EdgeEndpoint {
  id: string;
  label: string | undefined;
  /**
   * Where `label`'s bracket content begins in the statement it was written
   * in, so a problem inside the label can be reported at its own column.
   * `0`, and never read, when there is no label.
   */
  labelAt: number;
  definitionName: string | undefined;
  /**
   * The shape its spelling named. `"rect"` for a bare mention, which is
   * what a bare mention has always meant — it is now said rather than
   * assumed.
   */
  shape: NodeShape;
  /**
   * The `@{ … }` block written right after it, when there is one: where its
   * `@` stands in the statement, and the text between its braces.
   */
  data?: { at: number; content: string };
}

/**
 * One endpoint, or `null` when the text is not one — which refuses the
 * statement it came from rather than half of it.
 *
 * A node may end with an `@{ … }` block, written right after the rest of
 * it with no space (`A@{ … }`, `A[x]@{ … }`, `A:::c@{ … }`), and nothing
 * may follow the block: Mermaid 12.2.0 refuses `A[x] @{ … }` and
 * `A@{ … }:::c` (measured). What is before the block is read as any other
 * endpoint is.
 */
function readEndpoint(text: string, at: number): EdgeEndpoint | null {
  const trimmed = text.trim();
  const block = nodeDataBlocksOf(trimmed)[0];
  if (block === undefined) {
    return readEndpointWithoutData(text, at);
  }
  const head = trimmed.slice(0, block.at);
  if (block.end !== trimmed.length || head !== head.trimEnd()) {
    return null;
  }
  const lead = text.length - text.trimStart().length;
  const endpoint = readEndpointWithoutData(head, at + lead);
  if (endpoint === null) {
    return null;
  }
  return { ...endpoint, data: { at: at + lead + block.at, content: trimmed.slice(block.at + NODE_DATA_OPENER.length, block.end - 1) } };
}

/**
 * One endpoint written without an `@{ … }` block.
 *
 * The bracket spellings are tried before the bare form, since only they can
 * carry a label; the bare form is what is left.
 */
function readEndpointWithoutData(text: string, at: number): EdgeEndpoint | null {
  const trimmed = text.trim();
  const lead = text.length - text.trimStart().length;
  for (const { shape, re } of ENDPOINT_PATTERNS) {
    const match = re.exec(trimmed);
    if (match !== null && unpairedParenAt(match[2]) === null) {
      const labelAt = at + lead + match.indices![2]![0];
      return { id: match[1], label: match[2], labelAt, definitionName: match[3], shape };
    }
  }
  const bare = BARE_ENDPOINT_RE.exec(trimmed);
  if (bare === null) {
    return null;
  }
  return { id: bare[1], label: undefined, labelAt: 0, definitionName: bare[2], shape: "rect" };
}

/**
 * One node declaration written on a line of its own, in whichever spelling
 * the author used — or `null` when the line is not one.
 *
 * The bracket spelling is what makes it a declaration: a bare `A` on a line
 * by itself stays an unrecognized line, and `A:::name` is `NODE_CLASS_RE`'s.
 */
function readNodeDeclaration(line: string): EdgeEndpoint | null {
  for (const { shape, re } of NODE_PATTERNS) {
    const match = re.exec(line);
    if (match !== null && unpairedParenAt(match[2]) === null) {
      return {
        id: match[1],
        label: match[2],
        labelAt: match.indices![2]![0],
        definitionName: match[3],
        shape,
      };
    }
  }
  return null;
}

/**
 * Every node spelling once more, its label free to hold anything — never to
 * draw a node, only to say why `NODE_PATTERNS` refused one: which shape the
 * author was writing, and where in its label the character is that the
 * shape's own `content` cannot hold.
 */
const ANY_LABEL_PATTERNS = NODE_SPELLINGS.map((spelling) => ({
  content: new RegExp(`^(?:${spelling.content})$`),
  // The spelling's own closer with a space after it, which ends the label
  // there: `A[x] B[y]` is two nodes, not the label `x] B[y` (sticky, asked
  // at each character).
  closedThenSpace: new RegExp(String.raw`${spelling.close}\s`, "y"),
  re: new RegExp(String.raw`^(${ID_RUN})\s*${bracketOf(spelling, ".*")}\s*(?::::(${CLASS_NAME}))?\s*$`, "d"),
}));

/** The characters a bracket spelling is made of, which a label can hold only quoted. */
const LABEL_BRACKETS = "()[]{}";

/**
 * Why a node written as `text` — one declaration or one endpoint, trimmed —
 * was refused, when the reason is an unquoted bracket character in its
 * label, and where in `text` that character stands; `null` otherwise, left
 * to the generic "Unrecognized" error.
 *
 * Measured on Mermaid 12.2.0: each of `( ) [ ] { }` written unquoted in a
 * label is a parse error, whichever shape holds it (`A[a]b]` "got 'SQE'",
 * `A(a)b)`, `A{a]b}` "got 'SQE'", `A[[a)b]]` "got 'PE'"), and the quoted
 * label is drawn (`A("a)b")`, `A{"a]b"}`, `A[["a]b"]]`). So the fix is the
 * same for every shape: quote the whole label.
 */
function refuseNodeLabel(text: string): { message: string; offset: number } | null {
  for (const { content, closedThenSpace, re } of ANY_LABEL_PATTERNS) {
    const match = re.exec(text);
    if (match === null) {
      continue;
    }
    const [labelStart, labelEnd] = match.indices![2]!;
    const label = match[2];
    let refusedAt = unpairedParenAt(label);
    let twoNodes = false;
    for (const [i, char] of unquotedCharacters(label)) {
      closedThenSpace.lastIndex = i;
      if (closedThenSpace.test(label)) {
        twoNodes = true;
        break;
      }
      if (i < (refusedAt ?? label.length) && LABEL_BRACKETS.includes(char) && !content.test(char)) {
        refusedAt = i;
      }
    }
    // Quoting that would join two nodes into one label is no fix; the
    // generic error says the line cannot be read, which is the truth.
    if (twoNodes) {
      return null;
    }
    if (refusedAt !== null) {
      const fixed = `${text.slice(0, labelStart)}"${label.replaceAll(LABEL_FENCE, "")}"${text.slice(labelEnd)}`;
      return {
        message: `A node label without quotes cannot hold "${label[refusedAt]}". Put the whole label in quotes: ${fixed}`,
        offset: labelStart + refusedAt,
      };
    }
  }
  return null;
}

/**
 * An edge id, `A e1@--> B`: an id and an `@` written right before an arrow,
 * after a space. Mermaid 12.2.0 accepts one before every arrow spelling, and
 * takes any run of characters but a space or a `"` as the id (`e$1@`, `é1@`;
 * measured) — Siren keeps it to `ID_RUN`, the alphabet of a node id, and
 * refuses the rest. Cutting the line at its arrows leaves the id at the end
 * of the piece before one, so that is where this looks; the id is the first
 * group.
 */
const EDGE_ID_RE = /^.*\S\s+([^\s"]+)@$/d;

/**
 * What an edge's `@{ … }` block says, loaded as a node's block is
 * (`loadDataBlock`), and what is wrong with it. Mermaid 12.2.0 reads three
 * keys for an edge (`FlowDB.addVertex`, measured) — `animate`, tested for
 * truth; `animation`, a class named `edge-animation-<value>` that only
 * `fast` and `slow` style; and `curve` — and reads and ignores any other
 * (`e1@{ label: x }` draws no label, measured).
 */
function readEdgeData(written: string): {
  problems: DataBlockProblem[];
  data: Omit<SirenEdgeData, "line" | "column">;
} {
  const loaded = loadDataBlock(written, "curve: linear");
  if ("problem" in loaded) {
    return { problems: [loaded.problem], data: {} };
  }
  const problems: DataBlockProblem[] = [];
  const data: Omit<SirenEdgeData, "line" | "column"> = {};
  for (const [key, value] of Object.entries(loaded.doc)) {
    if (key === "animate") {
      data.animate = Boolean(value);
    } else if (key === "animation") {
      if (value === "fast" || value === "slow") {
        data.animation = value;
      } else {
        problems.push({ severity: "error", message: `There is no animation "${String(value)}". Use fast or slow` });
      }
    } else if (key === "curve") {
      if (typeof value === "string") {
        data.curve = value;
      } else {
        problems.push({ severity: "error", message: 'A curve is a name, such as "curve: linear"' });
      }
    } else {
      problems.push({
        severity: "warning",
        message: `"${key}" is not a key of an edge's "@{ … }" block, and is ignored. Remove it`,
      });
    }
  }
  return { problems, data };
}

/**
 * A keyword an edge id cannot begin with: `ID_KEYWORDS`, read as a node id
 * reads them, and `default`. Measured on Mermaid 12.2.0: `A end-x@--> B`,
 * `A style.x@--> B` and `A default@--> B` are parse errors, the keyword read
 * as the keyword, while `endx@`, `defaultx@`, `click@` and `v@` are ids.
 */
const EDGE_ID_KEYWORD_RE = new RegExp(`^(?:${ID_KEYWORDS.join("|")}|default)(?![A-Za-z0-9_])`);

/** An edge id as written, `e1` of `A e1@--> B`. */
interface EdgeIdWritten {
  id: string;
  /** Where the id starts in the piece before its arrow. */
  offset: number;
  /** Whether it is spelled in `ID_RUN`'s alphabet. */
  spelled: boolean;
}

/**
 * The edge id each arrow of a statement was written with, read off the
 * piece before it — never the whole line, so a label's own text
 * (`A["p q@-->r"]`, `A[x y@-z]`) is never taken for an id — and `parts`
 * with each id blanked out: the id's characters become spaces, so every
 * offset into the statement still lands where it did.
 */
function takeEdgeIds(
  parts: readonly string[],
  arrows: readonly string[],
): { parts: string[]; ids: (EdgeIdWritten | null)[] } {
  const ids: (EdgeIdWritten | null)[] = [];
  const blanked = parts.map((part, index) => {
    const kept = part.trimEnd();
    const id = index < arrows.length ? EDGE_ID_RE.exec(kept) : null;
    if (index < arrows.length) {
      ids.push(
        id === null ? null : { id: id[1], offset: id.indices![1]![0], spelled: AUTHORED_ID_RE.test(id[1]) },
      );
    }
    if (id === null) {
      return part;
    }
    const start = id.indices![1]![0];
    return kept.slice(0, start) + " ".repeat(kept.length - start) + part.slice(kept.length);
  });
  return { parts: blanked, ids };
}

/**
 * Why a node written as `text` — one declaration or one endpoint, trimmed —
 * was refused, and where in `text` to point, for the three reasons this
 * parser can name: an id that begins with a keyword, where its `@{ … }`
 * block stands, or an unquoted bracket in its label. `null` leaves it to
 * the generic "Unrecognized" error.
 */
function refuseNode(
  text: string,
  writtenAs: "an edge endpoint" | "a statement",
): { message: string; offset: number } | null {
  return (
    refuseKeywordId(text, writtenAs === "an edge endpoint") ??
    refuseNodeData(text) ??
    refuseClassName(text) ??
    refuseNodeLabel(text)
  );
}

/** `CLASS_NAME`, anchored at both ends. */
const CLASS_NAME_RE = new RegExp(`^${CLASS_NAME}$`);

/**
 * Where a class name stands in a text, read loosely — any run without a
 * space — so a name `CLASS_NAME` refuses can be named: in a `classDef`, in
 * a `class` statement's last word, or after a `:::` that ends the text.
 * `applies` says whether the name is applied to a node (`class`, `:::`)
 * rather than defined (`classDef`), which decides what a `,` in it means.
 */
const LOOSE_CLASS_NAMES: ReadonlyArray<{ re: RegExp; applies: boolean }> = [
  { re: /^classDef\s+(\S+)\s+\S/d, applies: false },
  { re: new RegExp(String.raw`^class\s+${CLASS_APPLY_TARGETS}\s+(\S+)\s*$`, "d"), applies: true },
  { re: /:::(\S+)\s*$/d, applies: true },
];

/**
 * What, inside a loosely read class name, says the run is something else
 * going on — an arrow (`--`, `==`, `~~`, `-.`, `->`), a bracket, an edge
 * label's `|`, a quote, a `%%` or another `:::` — so it is no class name to
 * blame: `A:::c~~~B`, `A:::c[x]`, `A:::c|x|`.
 */
const NOT_A_CLASS_NAME_RE = /--|==|~~|-\.|->|:::|%%|[[\](){}|"]/;

/** What a class name may hold, said to an author whose name holds something else. */
const CLASS_NAME_RULE =
  'Use letters (of any script), digits, "_", "\\" and single "-" signs, with no digit first, ' +
  'and ".", "#" or "+" only between such words.';

/**
 * Why a statement or a node written as `text` was refused, when the reason
 * is a class name `CLASS_NAME` does not read (`c%`, `1c`, `c..d`), and
 * where in `text` that name stands. Measured in headless Chrome on Mermaid
 * 12.2.0: each makes the CSS rule `.<name> > *` it writes fail to parse,
 * and the diagram is not drawn.
 */
function refuseClassName(text: string): { message: string; offset: number } | null {
  for (const { re, applies } of LOOSE_CLASS_NAMES) {
    const match = re.exec(text);
    const name = match?.[1];
    if (match === null || name === undefined || CLASS_NAME_RE.test(name) || NOT_A_CLASS_NAME_RE.test(name)) {
      continue;
    }
    // `class A c,d`, `A:::c,d`: the one class `c,d`, which no `classDef`
    // defines (`classDef c,d` defines `c` and `d`), so Mermaid 12.2.0 draws
    // the node unstyled with no diagnostic (measured).
    if (applies && name.split(",").every((part) => CLASS_NAME_RE.test(part))) {
      return {
        message:
          `"${name}" is read as one class name, which no classDef defines, so no style reaches the node. ` +
          "Apply one class at a time.",
        offset: match.indices![1]![0],
      };
    }
    return { message: `"${name}" cannot be a class name. ${CLASS_NAME_RULE}`, offset: match.indices![1]![0] };
  }
  return null;
}

/** `ID_KEYWORD` at the start of a text; the match is the keyword, its lookahead being zero-width. */
const KEYWORD_ID_RE = new RegExp(`^${ID_KEYWORD}`);

/**
 * What an author wrote as an id at the start of a text: up to whitespace,
 * any of `[ ] ( ) { }`, a `:` (of `:::`), an `@` (of `@{`) or a `>` (of an
 * asymmetric node) — so `end&x` is taken whole, as the author wrote it.
 */
const LEADING_ID_RE = /^[^\s[\](){}:@>]+/;

/**
 * Why a node written as `text` was refused, when the reason is an id that
 * begins with a keyword (`ID_KEYWORDS`): `end-x`, `style.x`, `end[x]`. The
 * keyword must be followed by something other than a space — `end B` is no
 * id, and a statement such as `style A` is not this mistake — or, when
 * `wholeTextIsId` (an edge's end, a `style` or `class` target), be the
 * whole of it (`A --> end`), which as a statement is a stray `end` instead.
 * The fix offered is the id in camel case (`endX`), or with `Node` after a
 * bare keyword.
 */
function refuseKeywordId(text: string, wholeTextIsId: boolean): { message: string; offset: number } | null {
  const keyword = KEYWORD_ID_RE.exec(text)?.[0];
  const after = keyword === undefined ? "" : text.slice(keyword.length);
  if (keyword === undefined || (after === "" && !wholeTextIsId) || /^\s/.test(after)) {
    return null;
  }
  return { message: keywordIdMessage(LEADING_ID_RE.exec(text)![0], keyword), offset: 0 };
}

/**
 * The refusal of an id that begins with a keyword, with a fix: the id in
 * camel case (`end-x` → `endX`), or with `Node` after a bare keyword.
 */
function keywordIdMessage(id: string, keyword: string): string {
  const [first, ...rest] = id.split(/[^A-Za-z0-9_]+/).filter((part) => part !== "");
  const fix =
    rest.length === 0 ? `${first}Node` : first + rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
  return `"${id}" begins with the keyword "${keyword}", and is read as that keyword. Rename it, such as ${fix}.`;
}

/**
 * The words Mermaid 12.2.0's lexer reads as a keyword only before
 * whitespace (`click[\s]+`, `call[\s]+`, `href[\s]`), so `click-x` and
 * `click[x]` are ids and an endpoint `click` before a space is not.
 */
const SPACED_KEYWORDS: ReadonlySet<string> = new Set(["click", "call", "href"]);

/**
 * Why a node written as `text` with an `@{ … }` block was refused, when the
 * reason is where the block stands, and where in `text` to point; `null`
 * when it has no block, or the block is not the reason. Mermaid 12.2.0
 * refuses each of these (measured): a space before the `@` (`A[x] @{ … }`,
 * "got 'SHAPE_DATA'"), anything after the `}` (`A@{ … }:::c`, `A@{ … } x`),
 * and a second block (`A@{ … }@{ … }`, read as one, "missed comma"). A block
 * never closed reads to the end of the document.
 */
function refuseNodeData(text: string): { message: string; offset: number } | null {
  const block = nodeDataBlocksOf(text)[0];
  if (block === undefined) {
    return null;
  }
  if (block.end === null) {
    return { message: `The "${NODE_DATA_OPENER}" is never closed. End the block with "}"`, offset: block.at };
  }
  const head = text.slice(0, block.at);
  const written = text.slice(block.at, block.end);
  if (head !== head.trimEnd()) {
    return {
      message:
        `Write "${NODE_DATA_OPENER}" right after the node, with no space: ` +
        withBlocksElided(`${head.trimEnd()}${text.slice(block.at)}`),
      offset: block.at,
    };
  }
  const rest = text.slice(block.end);
  const restAt = block.end + rest.length - rest.trimStart().length;
  const definition = new RegExp(String.raw`^\s*:::(${CLASS_NAME})`).exec(rest);
  if (definition !== null) {
    return {
      message:
        `Write ":::${definition[1]}" before the "${NODE_DATA_OPENER} … }" block: ` +
        withBlocksElided(`${head}:::${definition[1]}${written}`),
      offset: restAt,
    };
  }
  if (rest.trimStart().startsWith(NODE_DATA_OPENER)) {
    return {
      message: `A node takes one "${NODE_DATA_OPENER} … }" block. Write all its keys in the first, separated by ","`,
      offset: restAt,
    };
  }
  // `A@{ … } & B` with no arrow: a group, not text after the block, so it
  // gets whatever a bare `A & B` line gets rather than a fix that drops `B`.
  if (rest.trimStart().startsWith(GROUP_SEPARATOR)) {
    return null;
  }
  if (rest.trim() !== "") {
    return {
      message: `Nothing may follow a node's "${NODE_DATA_OPENER} … }" block: "${quotedOnOneLine(rest.trim())}"`,
      offset: restAt,
    };
  }
  return refuseNodeLabel(head);
}

/**
 * Where the first unquoted parenthesis with no partner stands in a label's
 * bracket content, or `null` when every one pairs up — a `)` with no `(`
 * before it, or else the first `(` never closed.
 *
 * Asked of every label a node spelling reads, because a pattern cannot count:
 * `LABEL_CONTENT` lets a parenthesis in, for the 01M4R3RVV divergence, and
 * only a balanced pair is that divergence. One with no partner is refused,
 * as Mermaid 12.2.0 refuses it (`A[a)b]` "got 'PE'", `A{a)b}`, measured) —
 * and it is what told a cylinder from a rect: `A[(a)b)]` is no cylinder, and
 * without this it was drawn as the rect `(a)b)`.
 */
function unpairedParenAt(label: string): number | null {
  const opened: number[] = [];
  for (const [i, char] of unquotedCharacters(label)) {
    if (char === "(") {
      opened.push(i);
    } else if (char === ")" && opened.pop() === undefined) {
      return i;
    }
  }
  return opened[0] ?? null;
}

/**
 * The characters of a label's bracket content that stand outside its quoted
 * runs, each with its offset — what every rule about unquoted label text
 * walks, so the rules cannot disagree about where a quote begins and ends.
 * The fences themselves are not yielded.
 */
function* unquotedCharacters(label: string): Generator<[number, string]> {
  let quoted = false;
  for (let i = 0; i < label.length; i++) {
    const char = label[i]!;
    if (char === LABEL_FENCE) {
      quoted = !quoted;
    } else if (!quoted) {
      yield [i, char];
    }
  }
}

/**
 * The separator that begins at `index`, or `null` when none does.
 *
 * Two kinds, because two of the three things that cut a flowchart line are
 * fixed characters and the third is a grammar. A `RegExp` is matched
 * **sticky**, so it can only match at exactly this index — a search would
 * find the next arrow somewhere down the line and cut there, silently
 * swallowing everything in between.
 */
function separatorAt(text: string, index: number, separator: string | RegExp): string | null {
  if (typeof separator === "string") {
    return text.startsWith(separator, index) ? separator : null;
  }
  separator.lastIndex = index;
  return separator.exec(text)?.[0] ?? null;
}

/**
 * Cuts `text` at every `separator` that lies **outside** the text a
 * statement holds, returning both the pieces and the separators that cut
 * them. The one scanner every flowchart reader that cuts a line shares —
 * at `;`, at `&`, at an arrow and at a `%%` (`midLinePercentAt`) — so no two
 * of them can disagree about where a label starts and ends.
 *
 * The separators are returned because one caller cares what cut its line:
 * `;` and `&` are single characters that mean one thing, but an arrow is a
 * **pattern**, and `A --> B -.-> C` is cut by two different tokens carrying
 * two different pictures. A cutter that returned only the pieces would leave
 * that caller re-finding the tokens it had already matched.
 *
 * What it steps over is what Mermaid 12.2.0's flowchart lexer reads as text,
 * each measured with `scripts/mermaid-probe.mjs`:
 *
 * - **A label, in any of its brackets.** `;`, `&`, `-->` and `%%` all mean
 *   something between statements and nothing inside a label: `A[a;b]`,
 *   `A{a-->b}`, `A(a&b)` and `A[a %% b]` are ordinary labels. A depth
 *   rather than a flag, because `A{{a}}` opens two and `A([a])` one of
 *   each. Any closer closes one: Mermaid refuses every label with a closer
 *   that is not its own (`A[a)b]`, `A{a]b}`, `A(a}b)`, `A>a)b]` — "got
 *   'PE'", "'SQE'", "'DIAMOND_STOP'", measured), so pairing each closer with
 *   its opener would only keep such a label whole — `A[a)-->b] --> B` drawn
 *   as one node rather than refused.
 * - **An asymmetric node's label**, opened by a `>` written right after an
 *   id and closed by `]`: `A>a;b]`, `A>a-->b]` and `A>a&b]` are the labels
 *   "a;b", "a-->b" and "a&b" (measured). Written after a space it opens
 *   nothing (`A >a]` is a parse error), and an arrow's own `>` never reaches
 *   this rule, its token being stepped over whole.
 * - **A quoted string, wherever it stands.** The `]` inside `A["a]b-->c"]` is
 *   a character of the label, and so is the `;` inside
 *   `click A "https://x.org/a;b" "t;u"`, which Mermaid accepts with both
 *   strings whole. A `"` in a declaration list (`style A fill:"#fdd;x"`)
 *   fences too, which changes nothing there: `splitStatements` hands a
 *   declaration list the rest of its line as written, and the gate refuses it.
 * - **A node's `@{ … }` block**, from its `@{` to the `}` closing it
 *   (`nodeDataEnd`).
 * - **An arrow's own label.** The two edge-label spellings put the author's
 *   text where the grammar reads its punctuation: mermaid 11.17.2 reads
 *   `A -- a;b --> B` as one edge labelled `a;b`, measured. Stepping over the
 *   whole run rather than tracking a depth, because an edge label has no
 *   closing character of its own to count: `-->|a;b|` and `-- a;b -->` are
 *   each one token, and `ARROW_RE` is the one statement of where they end.
 *
 * Always returns at least one piece, and one fewer separator than pieces,
 * and never trims: a caller that needs a column needs the offsets left
 * alone. `blocks` are the `@{ … }` blocks it stepped over.
 */
function cutOutsideLabel(
  text: string,
  separator: string | RegExp,
): { parts: string[]; separators: string[]; blocks: NodeDataBlock[] } {
  const parts: string[] = [];
  const separators: string[] = [];
  const blocks: NodeDataBlock[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === LABEL_FENCE) {
      quoted = !quoted;
      continue;
    }
    if (quoted) {
      continue;
    }
    if (depth === 0 && text.startsWith(NODE_DATA_OPENER, i)) {
      // A node's `@{ … }` block, stepped over whole to the `}` that closes
      // it: what is inside is YAML, and Mermaid 12.2.0 reads an arrow, an
      // `&` or an unpaired `(` there as text (`A@{ label: f(x } --> B`,
      // measured). One never closed runs to the end of the text.
      const end = nodeDataEnd(text, i);
      blocks.push({ at: i, end });
      i = (end ?? text.length) - 1;
      continue;
    }
    if (LABEL_OPENERS.includes(char) || (depth === 0 && char === ASYMMETRIC_OPENER && i > 0 && ID_CHAR_RE.test(text[i - 1]!))) {
      depth++;
      continue;
    }
    if (LABEL_CLOSERS.includes(char)) {
      if (depth > 0) {
        depth--;
      }
      continue;
    }
    if (depth > 0) {
      continue;
    }
    const cut = separatorAt(text, i, separator);
    if (cut !== null) {
      parts.push(text.slice(start, i));
      separators.push(cut);
      i += cut.length - 1;
      start = i + 1;
      continue;
    }
    if (separator !== ARROW_RE) {
      const arrow = separatorAt(text, i, ARROW_RE);
      if (arrow !== null) {
        i += arrow.length - 1;
      }
    }
  }
  parts.push(text.slice(start));
  return { parts, separators, blocks };
}

/**
 * The `@{ … }` blocks `text` holds where a node can stand — outside a
 * label, a quoted string and an arrow's own label, which `cutOutsideLabel`
 * steps over: an `@{` in any of them is text (`A -- x@{y --> B` is the
 * edge label `x@{y`, measured on Mermaid 12.2.0).
 */
function nodeDataBlocksOf(text: string): NodeDataBlock[] {
  return cutOutsideLabel(text, ARROW_RE).blocks;
}

/** What opens and what closes a label's bracket, in any pairing (see `cutOutsideLabel`). */
const LABEL_OPENERS = "[{(";
const LABEL_CLOSERS = "]})";

/** What opens an asymmetric node's label, right after its id (`A>a]`). */
const ASYMMETRIC_OPENER = ">";

/**
 * One id character (`ID_CHAR`), the kind an asymmetric opener must follow:
 * `A%>a;b]` is the node `A%` labelled "a;b" (measured, 01M4ZWT8PR).
 */
const ID_CHAR_RE = new RegExp(ID_CHAR);

/**
 * `text` with each `@{ … }` block in it passed through `rewrite` — the one
 * walk the two below share, so they agree on where a block is.
 */
function mapNodeDataBlocks(text: string, rewrite: (block: string) => string): string {
  let out = "";
  let from = 0;
  for (const { at, end } of nodeDataBlocksOf(text)) {
    const stop = end ?? text.length;
    out += text.slice(from, at) + rewrite(text.slice(at, stop));
    from = stop;
  }
  return out + text.slice(from);
}

/**
 * Author text as a message quotes it: on one line. A statement an `@{ … }`
 * block carried across lines holds their breaks inside the block, and
 * each, with the indentation around it, is quoted as one space:
 * `A@{ shape: circle } --> B C`. A break anywhere else — inside a Markdown
 * string, say — is the author's and stays.
 */
function quotedOnOneLine(text: string): string {
  return mapNodeDataBlocks(text, (block) => block.replace(/\s*\n\s*/g, " "));
}

/**
 * A fix as a message suggests it: each `@{ … }` block written across lines
 * shown as `@{ … }`, since flattened onto one line its YAML would no longer
 * be what the author wrote (`shape: circle label: x` is not two keys).
 */
function withBlocksElided(text: string): string {
  return mapNodeDataBlocks(text, (block) => (block.includes("\n") ? `${NODE_DATA_OPENER} … }` : block));
}

/** `cutOutsideLabel` for the two callers whose separator says nothing worth keeping. */
function splitOutsideLabel(text: string, separator: string): string[] {
  return cutOutsideLabel(text, separator).parts;
}

/**
 * One statement, with where it was written: its text, the line it starts on
 * and the column it starts at. What a diagnostic about something inside it
 * is positioned from.
 */
interface Statement {
  text: string;
  line: number;
  column: number;
}

/**
 * The line and column of the character at `offset` in `statement`'s text. A
 * statement is a slice of its source line as written, so a position in it
 * is a column once the statement's own column is added — except that a
 * Markdown string's fence (`joinMarkdownFences`) or an `@{ … }` block may
 * have carried the statement across physical lines, so every line break
 * before the position moves it one line down and restarts the column count.
 */
function positionIn(statement: Statement, offset: number): { line: number; column: number } {
  return positionAfterBreaks(lineBreaksOf(statement.text), offset, statement.line, statement.column);
}

/** The offset of every line break in `text`, in order. */
function lineBreaksOf(text: string): number[] {
  const breaks: number[] = [];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    breaks.push(at);
  }
  return breaks;
}

/**
 * Where `offset` stands in a text whose line breaks are at `breaks` and
 * whose first character is at `line`:`column`: each break before it moves
 * it a line down and restarts the column count. The breaks are searched by
 * halving, so asking for many offsets in one long text stays cheap.
 */
function positionAfterBreaks(
  breaks: readonly number[],
  offset: number,
  line: number,
  column: number,
): { line: number; column: number } {
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (breaks[middle]! < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low === 0 ? { line, column: column + offset } : { line: line + low, column: offset - breaks[low - 1]! };
}

/**
 * Where each of `parts` begins in the text `cutOutsideLabel` cut them from:
 * the parts and the separators between them lie end to end, so each part
 * starts where everything before it ends.
 */
function offsetsOf(parts: readonly string[], separators: readonly string[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  parts.forEach((part, index) => {
    offsets.push(at);
    at += part.length + (separators[index]?.length ?? 0);
  });
  return offsets;
}

/**
 * The statements one source line carries, each with the column it starts
 * at — so a diagnostic on the second statement of a line points at the
 * second statement rather than at the line.
 *
 * Empty pieces are dropped rather than diagnosed, which is what makes `;`
 * both a separator and a terminator at once: a trailing `;`, a doubled one
 * and a line that is only `;` all leave nothing behind, exactly as in
 * Mermaid. A blank line falls out of the same rule, with no case of its
 * own.
 */
function splitStatements(rawLine: string): { text: string; column: number }[] {
  const statements: { text: string; column: number }[] = [];
  let offset = 0;
  for (const piece of splitOutsideLabel(rawLine, STATEMENT_END)) {
    const text = piece.trim();
    if (text.length > 0) {
      const column = offset + (piece.length - piece.trimStart().length) + 1;
      if (DECLARATION_LIST_RE.test(text)) {
        // Runs to the end of the line, minus whatever `;` trails it — see
        // `DECLARATION_LIST_RE`. Taken from the raw line so that the `;`
        // characters inside the list survive verbatim for the gate to read.
        statements.push({
          text: rawLine.slice(column - 1).replace(/[\s;]+$/, ""),
          column,
        });
        return statements;
      }
      if (ACC_TITLE_RE.test(text) || ACC_DESCR_RE.test(text)) {
        // An accessibility line keeps all of the line after its `:`, a `;`
        // included (`accTitle: a; B --> C` is the title `a; B --> C` in
        // Mermaid 12.2.0, measured), so it ends the line's statements.
        statements.push({ text: rawLine.slice(column - 1).trimEnd(), column });
        return statements;
      }
      statements.push({ text, column });
    }
    offset += piece.length + STATEMENT_END.length;
  }
  return statements;
}

/**
 * Where in `text` a `%%` stands outside every piece of text the statement
 * holds (`cutOutsideLabel`'s), or `null` when every `%%` in it is inside one
 * (or there is none). Inside text a `%%` is text: Mermaid 12.2.0 keeps
 * `A[a %% b]`, `A["a %% b"]`, `A -->|a %% b| B`, `A -- a %% b --> B` and
 * `click A "u" "a %% b"` as written, measured.
 */
function midLinePercentAt(text: string): number | null {
  const { parts, separators } = cutOutsideLabel(text, MID_LINE_PERCENT_RE);
  const offsets = offsetsOf(parts, separators);
  const writesNodes = !NO_NODE_STATEMENT_RE.test(text);
  for (let cut = 0; cut < separators.length; cut++) {
    const at = offsets[cut]! + parts[cut]!.length;
    // A `%%` begins an id only where a statement writes nodes, and only when
    // no space follows it (`A --> %%` ends the statement): `%% x` is a
    // comment's own spelling, and Mermaid 12.2.0 refuses `A --> %% x`
    // (measured).
    const spaced = /\s/.test(text[at + 2] ?? "");
    if (!writesNodes || spaced || !opensEndpoint(text.slice(0, at))) {
      return at;
    }
  }
  return null;
}

/**
 * A statement that writes no node, by its keyword: a `%%` in it begins no
 * id, whatever stands before it (`class A c --> %%x` and
 * `click A "u" "t" --> %%x` are parse errors in Mermaid 12.2.0, measured).
 */
const NO_NODE_STATEMENT_KEYWORDS = [
  ...DECLARATION_LIST_KEYWORDS,
  "class",
  "click",
  "accTitle",
  "accDescr",
  "subgraph",
  "direction",
] as const;
const NO_NODE_STATEMENT_RE = new RegExp(`^(?:${NO_NODE_STATEMENT_KEYWORDS.join("|")})\\s`);

/**
 * Whether an endpoint begins right after `before`: it ends with an arrow
 * (its `|label|` included) or with an `&` that has a space on each side,
 * then nothing but spaces. A `%%` there begins an id, not a comment:
 * Mermaid 12.2.0 draws `A --> %%B`, `A-->%%B`, `A -->|l| %%B`,
 * `A -- t --> %%B` and `A & %%B` with a node `%%B` (measured).
 */
function opensEndpoint(before: string): boolean {
  if (SPACED_GROUP_SEPARATOR_AT_END_RE.test(before)) {
    return true;
  }
  const { parts, separators } = cutOutsideLabel(before, ARROW_RE);
  return separators.length > 0 && parts[parts.length - 1]!.trim() === "";
}

/** Why a statement after a `;` that begins with `%%` is refused (`A;%%B`). */
const PERCENT_AFTER_SEMICOLON_MESSAGE =
  'A "%%" after ";" begins a statement, so it is read as a node, not a comment. ' +
  "Move the comment to a line of its own.";

/** An `&` with a space on each side, at the end of a text but for spaces. */
const SPACED_GROUP_SEPARATOR_AT_END_RE = /\s&\s+$/;

/**
 * What `midLinePercentAt` looks for: a `%%` that does not continue an id.
 * `%` is an id character (`ID_CHAR`), so one glued to the end of an id is
 * the id's own — measured on Mermaid 12.2.0, `A%%B`, `A%%B --> C`,
 * `A-->B%%C`, `A%%` and `A%% --> B` record the ids `A%%B`, `B%%C` and `A%%`
 * (01M4ZWT8PR). Written after a space or a bracket it begins no id this
 * parser reads: `A %% x` and `A %%B` are parse errors there, measured —
 * except where an endpoint begins (`opensEndpoint`).
 */
const MID_LINE_PERCENT_RE = new RegExp(`${NOT_AFTER_ID}%%`, "y");

/**
 * The opening statement of a `subgraph` block, and everything the author
 * wrote after the keyword. What that tail *means* is `readSubgraphTitle`'s;
 * this pattern only says a block opens here.
 *
 * Split in two because the tail has three spellings and only one of them is
 * a bare word — a single pattern would either have to alternate three ways
 * inline or, worse, accept a tail it cannot read and lose the diagnostic.
 */
const SUBGRAPH_OPEN_RE = /^subgraph\s+(\S.*)$/d;

/** The statement that closes a `subgraph` block. Mermaid's own keyword, lowercase. */
const SUBGRAPH_END = "end";

/** `end` and more after a space (`end B`): the block's end, and what follows it. */
const END_THEN_MORE_RE = /^end\s+(\S.*)$/;

/**
 * `one[Two Words]` — the spelling that gives a subgraph a handle *and* a
 * title, and the only one where the two differ. Its content is read by the
 * same `LABEL_CONTENT` every node label goes through, so `subgraph
 * one["a, b"]` fences exactly as `A["a, b"]` does.
 */
const SUBGRAPH_TITLED_RE = new RegExp(String.raw`^(${ID_RUN})\s*\[(${LABEL_CONTENT})\]$`, "d");

/**
 * A bare authored id and nothing else — `Ingest`, `A`, `a.-b`.
 *
 * `ID_RUN` is this file's own answer to the shape ADR-0010 leans on: neither
 * a `\w` nor a `%` nor a `.` nor the one dash this pattern admits is a
 * colon, which is what still makes a generated id unspellable by an
 * authored one here. Read in two places here, for two different things that
 * are both that shape — a subgraph written with a bare title (mermaid
 * 11.17.2 records it as both id and title) and a node written as nothing but
 * its id inside a block.
 */
const AUTHORED_ID_RE = new RegExp(`^${ID_RUN}$`);

/** A node written as nothing but its id: `AUTHORED_ID_RE`, unless it begins with a keyword. */
const AUTHORED_NODE_ID_RE = new RegExp(`^${NODE_ID}$`);

/**
 * What the tail of a `subgraph` statement names — the author's handle and
 * the title drawn on the frame — or `null` when it is a spelling Siren does
 * not read.
 *
 * The three spellings and what mermaid 11.17.2 makes of each were measured
 * with `scripts/mermaid-probe.mjs`, not recalled:
 *
 *     subgraph Ingest            id="Ingest"    title="Ingest"
 *     subgraph "Two Words"       id="subGraph0" title="Two Words"
 *     subgraph one[Two Words]    id="one"       title="Two Words"
 *
 * A quoted title is a handle only when it holds no whitespace — Mermaid
 * 12.2.0 records `subgraph "t"` as id `t` (measured) — and the quoted
 * spellings Mermaid reads beyond these (`"t"zz`, `"t" [x]`) follow that
 * rule; see `handleOfQuoted`.
 *
 * The middle one is why `name` is nullable rather than defaulted to the
 * title: Mermaid mints a handle the author never wrote and could not have
 * predicted, so there is no name here for anything to be addressed by.
 */
function readSubgraphTitle(
  tail: string,
): ({ name: string | null } & ReadLabelResult) | null {
  const titled = SUBGRAPH_TITLED_RE.exec(tail);
  if (titled !== null) {
    const content = labelSpan(titled[2]);
    return {
      name: titled[1],
      ...readLabelAt({ text: content.text, at: titled.indices![2]![0] + content.at }, { dialect: "html" }),
    };
  }
  const quotedTitled = QUOTED_HANDLE_TITLED_RE.exec(tail);
  if (quotedTitled !== null) {
    // `subgraph "t" [x]`: the quoted run is the handle, the bracket the
    // title (measured: id `t`, title `x`).
    const content = labelSpan(quotedTitled[4]);
    return {
      name: handleOfQuoted(quotedTitleRunText(quotedTitled)),
      ...readLabelAt(
        { text: content.text, at: quotedTitled.indices![4]![0] + content.at },
        { dialect: "html" },
      ),
    };
  }
  const fenced = FENCED_LABEL_RE.exec(tail);
  if (fenced !== null) {
    return {
      name: handleOfQuoted(fenced[1]),
      ...readLabelAt({ text: fenced[1], at: LABEL_FENCE.length }, { dialect: "html" }),
    };
  }
  const quotedWithWords = QUOTED_TITLE_WITH_WORDS_RE.exec(tail);
  if (quotedWithWords !== null && !endsWithEnd(tail)) {
    // `subgraph "t" zz`: the quoted text and the words after it are one
    // title, `t zz`, under no handle (measured, `subGraph0`); `subgraph
    // "t"zz` is one word, `tzz`, and so the handle too (measured).
    const text = quotedTitleRunText(quotedWithWords);
    return {
      name: handleOfQuoted(text),
      ...readLabelAt({ text, at: LABEL_FENCE.length }, { dialect: "html" }),
    };
  }
  if (AUTHORED_ID_RE.test(tail)) {
    // A bare word is the handle and the title at once, and has no tag in it.
    return { name: tail, label: plainLabel(tail), problems: [] };
  }
  if (BARE_TITLE_WITH_PERCENTS_RE.test(tail) && !tail.split(/\s+/).includes(SUBGRAPH_END)) {
    // `subgraph S %% zz`: no handle at all, and the whole run is the title.
    return titleWithoutHandle(tail);
  }
  if (BARE_TITLE_WORDS_RE.test(tail) && !endsWithEnd(tail)) {
    // `subgraph S a & b`: several words are one title, the whole run, under
    // no handle (measured, `subGraph0`).
    return titleWithoutHandle(tail);
  }
  return null;
}

/**
 * `subgraph s1 ["t"] zz` — a bracketed title with more after it. Mermaid
 * 12.2.0 refuses it (measured, "Expecting 'SEMI', 'NEWLINE', 'EOF', got
 * 'SPACE'"): the bracket closes the statement.
 */
const SUBGRAPH_TITLED_THEN_MORE_RE = new RegExp(
  String.raw`^(${ID_RUN})\s*\[(${LABEL_CONTENT})\]\s+(\S.*)$`,
  "d",
);

/**
 * Why a `subgraph` statement's tail that `readSubgraphTitle` cannot read is
 * refused, and where in the tail to point — or `null` when the tail is
 * nothing this can explain, left to the generic "Unrecognized" error.
 */
function refuseSubgraphTitle(tail: string): { message: string; offset: number } | null {
  // `subgraph S@{ shape: circle }`: Mermaid 12.2.0 refuses a block there
  // (measured, "got 'SHAPE_DATA'").
  const data = nodeDataBlocksOf(tail)[0];
  if (data !== undefined) {
    const without = tail.slice(0, data.at) + tail.slice(data.end ?? tail.length);
    return {
      message: `A subgraph takes no "${NODE_DATA_OPENER} … }" block. Leave the block out: subgraph ${without.trim()}`,
      offset: data.at,
    };
  }
  const titledThenMore = SUBGRAPH_TITLED_THEN_MORE_RE.exec(tail);
  if (titledThenMore !== null) {
    const [, name, content, more] = titledThenMore;
    return {
      message:
        `Text after a subgraph's bracketed title: "${more}". A title in brackets ends the line; ` +
        `move the text inside the brackets: subgraph ${name}["${labelSpan(content).text} ${more}"]`,
      offset: titledThenMore.indices![3]![0],
    };
  }
  if (!/\s/.test(tail) && tail !== SUBGRAPH_END) {
    return null;
  }
  // The fix both refusals below offer: the whole tail as one quoted title,
  // with the quotes already in it dropped so the suggestion is one string.
  const quoteTheTitle = `Put the whole title in quotes: subgraph "${tail.replaceAll(LABEL_FENCE, "")}"`;
  // Past a leading quoted title, which holds anything: `"t" a,b` breaks at
  // its `,`, not inside the quotes.
  const wordsAt = LEADING_QUOTED_TITLE_RE.exec(tail)?.[0].length ?? 0;
  const broken = TITLE_WORD_BREAK_RE.exec(tail.slice(wordsAt));
  if (broken === null && endsWithEnd(tail)) {
    return {
      message:
        `A subgraph title cannot end with the word "${SUBGRAPH_END}", which closes the block. ` +
        quoteTheTitle,
      offset: tail.lastIndexOf(SUBGRAPH_END),
    };
  }
  // A `"` is no break Mermaid makes (`a"b` is text there), so no fix is
  // offered for it here; the generic error stands.
  if (broken === null || broken[0] === LABEL_FENCE) {
    return null;
  }
  return {
    message:
      `A subgraph title without quotes cannot hold "${broken[0]}". ` +
      quoteTheTitle,
    offset: wordsAt + broken.index,
  };
}

/** The quoted title a `QUOTED_TITLE_WITH_WORDS_RE` tail starts with. */
const LEADING_QUOTED_TITLE_RE = /^"[^"]*"(?=\s)/;

/**
 * The handle a quoted subgraph header gives its block: the text itself, as
 * Mermaid 12.2.0 records it, unless that text holds whitespace — then
 * Mermaid mints `subGraph0` and the block has none (measured: `subgraph
 * "t"` is id `t`, `subgraph "Two Words"` and `subgraph " t "` are
 * `subGraph0`). Like any handle it is only ever the name an edge reaches the
 * frame by; the frame's own id stays generated (ADR-0010).
 */
function handleOfQuoted(text: string): string | null {
  return text === "" || /\s/.test(text) ? null : text;
}

/**
 * Whether a subgraph title's last word is `end`. Mermaid 12.2.0 reads that
 * word as the block's own end, swallowing the next line into the title
 * (measured: `subgraph S a end` records the title "S a end\nA" and leaves
 * `A` outside the frame) — a picture nobody wrote, so no title Siren draws
 * ends with it. An `end` anywhere else is an ordinary word (measured:
 * `subgraph S end b` is the title "S end b").
 */
function endsWithEnd(tail: string): boolean {
  return tail.split(/\s+/).at(-1) === SUBGRAPH_END;
}

/**
 * A subgraph title the author gave no handle for, drawn as the text written:
 * `readSubgraphTitle`'s reading of `subgraph S %% zz`, and the stand-in a
 * refused opener still opens its block with, so its `end` closes it.
 */
function titleWithoutHandle(text: string): { name: null } & ReadLabelResult {
  return { name: null, label: plainLabel(text), problems: [] };
}

/**
 * A subgraph's bare name followed by a `%%` and plain words — which is not
 * a name and a comment but one title: Mermaid 12.2.0 reads the run of words
 * after `subgraph` as its text, so `subgraph S %% zz` records the title
 * "S %% zz" under a generated id (measured, `subGraph0`). Only words: a
 * bracket, a quote, a tag or an arrow after the `%%` is a parse error there
 * (measured: `got 'PS'`, `'STR'`, `'TAGSTART'`, `'LINK'`), and so is the
 * diagnostic here; and a word that is `end`, which Mermaid reads as the
 * block's own end swallowing the next line (`subgraph S %% end`), is no word
 * of a title Siren draws — `readSubgraphTitle` asks that of `SUBGRAPH_END`,
 * while `%%end` is a word like any other (measured: title "S %% %%end").
 */
const BARE_TITLE_WITH_PERCENTS_RE = new RegExp(String.raw`^${ID_RUN}\s+%%[\w%]*(?:\s+[\w%]+)*$`);

/** The characters a `TITLE_WORD` is made of, as a character-class body. */
const TITLE_WORD_CHARS = String.raw`\p{L}\p{N}_&.!:?/#*+'$^\\\x60%-`;

/** The spellings no `TITLE_WORD` holds, though each is made of its characters. */
const TITLE_WORD_BREAKS = String.raw`(?:--|-\.|:::)`;

/**
 * One word of a subgraph title written without quotes: the characters
 * Mermaid 12.2.0's `textNoTags` reads into a title, measured one probe per
 * character — letters and digits in any script, and `_ & . ! : ? / # * + '
 * $ ^ \ \` % -`. Every other character is a parse error there (`,` `(` `)`
 * `[` `]` `{` `|` `<` `>` `=` `~` `@`), and so are the link and class
 * spellings `--`, `-.` and `:::` even inside a word (`got 'EDGE_TEXT'`,
 * `'STYLE_SEPARATOR'`). A `"` inside a word is left out: Mermaid reads
 * `a"b` as text, but a quote here is where this file's label fences start.
 */
const TITLE_WORD = String.raw`(?!\S*${TITLE_WORD_BREAKS})[${TITLE_WORD_CHARS}]+`;

/**
 * The first thing in a run of unquoted title words that no `TITLE_WORD`
 * holds — what `refuseSubgraphTitle` points at.
 */
const TITLE_WORD_BREAK_RE = new RegExp(String.raw`${TITLE_WORD_BREAKS}|[^\s${TITLE_WORD_CHARS}]`, "u");

/** One or more `TITLE_WORD`s, each after whitespace. */
const TITLE_WORDS = String.raw`(?:\s+${TITLE_WORD})+`;

/**
 * A quoted title and the words after it, the first optionally glued to the
 * closing quote, from the start of a subgraph's tail: groups 1 to 3 are the
 * quoted text, the glued word and the spaced words (`quotedTitleRunText`).
 * The run `QUOTED_TITLE_WITH_WORDS_RE` reads alone and
 * `QUOTED_HANDLE_TITLED_RE` reads before a bracket.
 */
const QUOTED_TITLE_RUN = String.raw`^"([^"]*)"(${TITLE_WORD})?(${TITLE_WORDS})?`;

/** The text a `QUOTED_TITLE_RUN` match spells: `t zz` for `"t" zz`, `tzz` for `"t"zz`. */
function quotedTitleRunText([, quoted, glued = "", spaced = ""]: RegExpExecArray): string {
  return quoted + glued + spaced;
}

/**
 * `subgraph "t" zz`, `subgraph "t"zz` — a quoted title with words after it,
 * the first of them optionally glued to the closing quote. Mermaid 12.2.0
 * joins it all into one title, `t zz` or `tzz` (measured). The quoted title
 * alone is `FENCED_LABEL_RE`'s, asked first.
 */
const QUOTED_TITLE_WITH_WORDS_RE = new RegExp(String.raw`${QUOTED_TITLE_RUN}$`, "u");

/**
 * `subgraph "t" [x]` — `QUOTED_TITLE_WITH_WORDS_RE`'s run followed by a
 * bracketed title. Mermaid 12.2.0 makes the run the id and the bracket the
 * title, exactly as for `subgraph t[x]` (measured: `"t" [x]`, `"t"[x]` and
 * `"t"zz [x]` are ids `t`, `t`, `tzz`; `"a b" [x]` and `"t" zz [x]` are ids
 * holding a space, which no edge can spell).
 */
const QUOTED_HANDLE_TITLED_RE = new RegExp(String.raw`${QUOTED_TITLE_RUN}\s*\[(${LABEL_CONTENT})\]$`, "du");

/**
 * `subgraph S a & b`, `subgraph S a b c` — a title of several words with no
 * quotes. Mermaid 12.2.0 reads the whole run as the title and gives the
 * block a generated id (measured, `subGraph0`): the first word is no handle
 * once another word follows it.
 */
const BARE_TITLE_WORDS_RE = new RegExp(String.raw`^${TITLE_WORD}${TITLE_WORDS}$`, "u");

/**
 * `direction LR` written inside a `subgraph` block — a per-cluster rank
 * direction, read onto that block alone.
 *
 * Measured, not recalled: mermaid 11.17.2 records it as `dir="LR"` on that
 * subgraph and leaves the document's own direction where the header put it
 * (`scripts/mermaid-probe.mjs`). `layoutDirectedGraph` honors it the way
 * Mermaid 12's ELK layout does: a cluster carrying a direction of its own
 * lays its children out in it, independent of the outer graph's, for as
 * long as no edge voids it (the **Boundary-crossing edge** rule; see
 * `voidedDirections`).
 *
 * Which values are directions is `matchClassDirection`'s, not this file's:
 * the spelling, the alias (`TD` → `TB`), and the diagnostic-worthy set of
 * five are already settled there for the header, and a second list here
 * would only give the two a chance to drift. This file's own pattern,
 * `DIRECTION_LINE_RE`, decides no value — it only says where one ends, so
 * text trailing it (`direction LR zz`, which Mermaid 12.2.0 reads as `LR`)
 * is set aside with a warning.
 *
 * Scoped to *inside* a block on purpose. At the top level of a flowchart
 * Mermaid 12.2.0 accepts `direction LR` on any line and ignores it — the
 * recorded direction stays the header's, measured first line and last — so
 * Siren draws the same picture and warns that the line does nothing, naming
 * the header that would.
 */

/**
 * A `direction` statement cut after its two-letter value, and whatever
 * trails that on the line — the value checked by `matchClassDirection`, the
 * trailing text ignored with a warning, as Mermaid 12.2.0's lexer swallows
 * it (measured). Only the cut is this pattern's; which values are directions
 * stays `matchClassDirection`'s.
 */
const DIRECTION_LINE_RE = /^(direction\s+(\S{2}))(.*)$/d;

/** The window target mermaid 11.17.2's grammar accepts as an `href` interaction's fourth argument — see `LinkTarget`. */
const LINK_TARGETS: readonly LinkTarget[] = ["_blank", "_self", "_top", "_parent"];

/**
 * `click A href "https://example.com"`, with Mermaid's optional trailing
 * tooltip string and optional trailing window target — the 2-, 3- and
 * 4-argument forms, `click A href "url" ["tip"] [_blank|_self|_top|_parent]`.
 *
 * Anchored with `$`, exactly as the class diagram's own `CLICK_HREF_RE` is,
 * so a fifth token — or a target that is not one of `LinkTarget`'s four —
 * falls all the way through to "Unrecognized flowchart line" rather than
 * silently matching a truncated read of it (measured: mermaid's own grammar
 * has exactly these four as a fixed `LINK_TARGET` lexer token, and a fifth
 * is a parse error there too).
 *
 * The URL is captured as written, exactly as the class diagram's does — the
 * `http`/`https`/`mailto` allowlist is `resolveInteractions`' job, not this
 * parser's, and that resolver is shared rather than copied.
 */
const CLICK_HREF_RE = new RegExp(
  String.raw`^click\s+(${ID_RUN})\s+href\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+(${LINK_TARGETS.join("|")}))?$`,
);

/**
 * `click A call callbackFn()`, with an optional literal argument and
 * Mermaid's optional trailing tooltip: `click A call fn("arg") "tip"`.
 *
 * Spelled exactly as the class diagram's `CLICK_CALL_RE` is. `click A myFn`
 * — the bare callback-name shorthand — has no parentheses to match this
 * pattern's `\(([^)]*)\)`, so it falls through to `CLICK_CALL_BARE_RE` below
 * rather than being silently read as a call with no arguments here.
 */
const CLICK_CALL_RE = new RegExp(
  String.raw`^click\s+(${ID_RUN})\s+call\s+(\w+)\(([^)]*)\)(?:\s+"([^"]*)")?$`,
);

/**
 * `click A myFn` — Mermaid's bare callback-name shorthand for
 * `click A call myFn()`. Parsed into the exact same `Interaction` shape
 * (`interactionKind: "call"`, `action: "myFn"`, `argument: null`): `render()`'s
 * `onClick` already reports the clicked node's own id for every `call`
 * interaction regardless of which click spelling produced it, so there is no
 * separate semantic here to model — reusing the `call` shape is not a
 * simplification, it is the correct reading.
 *
 * Checked after `CLICK_CALL_RE`, so a name followed by parens is still read
 * by that pattern: this one's `(\w+)$` has no `(...)` to match, so
 * `click A call myFn()` never reaches here in the first place, and ordering
 * only matters for defense in depth.
 */
const CLICK_CALL_BARE_RE = new RegExp(String.raw`^click\s+(${ID_RUN})\s+(\w+)$`);

/**
 * `click A "https://example.com"` — Mermaid's bare-quoted-string shorthand
 * for `click A href "https://example.com"` with the `href` keyword omitted.
 * It takes the same optional tooltip and target as `CLICK_HREF_RE`, and is
 * parsed into the exact same `Interaction` shape (`interactionKind: "href"`,
 * the string as `action`): measured against real Mermaid 11.17.2,
 * `click A "url" "tip" _blank` draws what `click A href "url" "tip" _blank`
 * does, and each part may be left out the same way. Also measured against
 * real Mermaid 11.17.2, `click A "tip"` renders `<a href="tip">` — the
 * quoted string becomes the href value regardless of whether it looks like a
 * URL, so this is a keyword-omitting shorthand, not a tooltip-only concept.
 * The `http`/`https`/`mailto` allowlist that rejects a non-URL string like
 * `"tip"` is `resolveInteractions`' job, not this parser's, exactly as it is
 * for `CLICK_HREF_RE`.
 *
 * Checked after `CLICK_HREF_RE`, `CLICK_CALL_RE` and `CLICK_CALL_BARE_RE`.
 * There is no ordering hazard with any of them: `CLICK_HREF_RE` requires the
 * literal word `href` this pattern never has, `CLICK_CALL_RE` requires
 * `call fn(...)`, and `CLICK_CALL_BARE_RE`'s `(\w+)$` cannot match a quoted
 * string — `\w` excludes the `"` characters this pattern's payload is
 * bracketed by.
 */
const CLICK_HREF_BARE_RE = new RegExp(
  String.raw`^click\s+(${ID_RUN})\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+(${LINK_TARGETS.join("|")}))?$`,
);

/**
 * `accTitle: text` — screen-reader-only. The colon is required, and may
 * have whitespace before it: `accTitle : hi` is "hi" (measured, 12.2.0).
 *
 * **Lower case only, unlike the sequence and ER spellings.** Measured on
 * 12.2.0, a flowchart's `ACCTITLE: x`, `ACCDESCR: x` and `ACCDESCR {` are
 * parse errors: its lexer's acc rules are not `/i`. So these three patterns
 * are not either.
 */
const ACC_TITLE_RE = /^accTitle\s*:\s*(.+)$/;

/** `accDescr: text` — screen-reader-only, the description counterpart of `accTitle`, read the same way. */
const ACC_DESCR_RE = /^accDescr\s*:\s*(.+)$/;

/**
 * Whether `line` is a statement that holds text to the end of its line — a
 * declaration list or an accessibility line — so a `%%` or an arrow in it is
 * that text, never a comment or an edge (measured on Mermaid 12.2.0:
 * `style A fill:#f00 %% x`, `accTitle: a --> b`).
 */
function holdsTextToItsEnd(line: string): boolean {
  return DECLARATION_LIST_RE.test(line) || ACC_TITLE_RE.test(line) || ACC_DESCR_RE.test(line);
}

/**
 * The opening of the braced `accDescr { ... }` block, which runs to the first
 * `}` on this line or a later one and is read by the shared
 * `readAccDescrBlock` (01M4WS1P6). Matched against a whole line, before it
 * is split into statements, because the block is the one statement that
 * spans lines.
 */
const ACC_DESCR_BLOCK_RE = /^\s*accDescr\s*\{/;

/**
 * Strips one layer of surrounding quotes from a `call fn("arg")` argument,
 * and reads an empty argument list as no argument at all.
 *
 * Duplicated from `parseClassDiagram`'s function of the same name rather
 * than imported — that one is private to its module, and pulling it out
 * into a shared file for seven lines used by exactly two callers would be
 * the kind of premature sharing `resolveInteractions` itself was not: this
 * one is small enough that two copies cost less than a third module.
 */
function callArgument(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const quoted = /^"([^"]*)"$/.exec(trimmed);
  return quoted === null ? trimmed : quoted[1];
}

/**
 * `style A fill:#fdd,stroke:#c00` — author styling applied directly to one
 * node, spelled exactly as a class diagram spells it.
 */
const STYLE_RE = new RegExp(String.raw`^style\s+(${ID_RUN})\s+(.+)$`, "d");

/**
 * `classDef emphasis fill:#fdd` — a named set of declarations, applied to
 * nothing on its own, spelled exactly as a class diagram spells it; or
 * several names joined by `,` (`classDef a,b fill:#fdd`), each defined.
 */
const CLASS_DEF_RE = new RegExp(String.raw`^classDef\s+(${CLASS_NAME}(?:,${CLASS_NAME})*)\s+(.+)$`);

/**
 * `linkStyle 0 stroke:#f00` — the one styling statement that reaches an
 * edge, which `style` cannot: Mermaid addresses an edge by its declaration
 * index rather than by a name the author chose.
 *
 * The addresses are captured as written and left that way. Turning `0` into
 * the edge id `A-B` is `buildFlowchartModel`'s job, since only the model
 * knows which edges exist and what they are called — so this pattern is
 * deliberately incurious about whether an address is a number at all.
 *
 * The address list is greedy and backtracks the same way `CLASS_APPLY_RE`'s
 * does, which is what lets one pattern read `linkStyle 0`, `linkStyle 0,2`
 * and `linkStyle default` without three: `[\w,\s]` cannot cross the first
 * `:` of the declarations, so it gives back everything up to the space that
 * separates the two halves.
 *
 * Left as `\w` alone, unlike `CLASS_APPLY_RE`'s target list: an address here
 * is a declaration index or the literal word `default`, never a node id, so
 * widening the id alphabet for `.` gives this list nothing to admit.
 */
const LINK_STYLE_RE = /^linkStyle\s+([\w,\s]*[\w,])\s+(.+)$/;

/**
 * `linkStyle default interpolate step` and `linkStyle 0,2 interpolate linear
 * stroke:#f00` — a `linkStyle` that chooses the **Curve** its edges are
 * drawn with, optionally followed by the declarations an ordinary
 * `linkStyle` takes. Tried before `LINK_STYLE_RE`, which would otherwise
 * read `default interpolate` as an address list and the curve name as a
 * declaration.
 *
 * Mermaid 11.17.2's grammar (`linkStyleStatement`, productions 124-127 of
 * the flowchart parser in `dist/mermaid.js`) is
 *
 *     LINKSTYLE SPACE (DEFAULT | numList) SPACE INTERPOLATE SPACE alphaNum
 *       [SPACE stylesOpt]
 *
 * with `numList` = `NUM (COMMA NUM)*`, and the action calls
 * `updateLinkInterpolate(addresses, alphaNum)` before `updateLink` for the
 * declarations. Differences, all on the lenient side and all shared with
 * `LINK_STYLE_RE`:
 *
 * - The address list is the same `[\w,\s]` run `LINK_STYLE_RE` reads, so
 *   `0, 1` (a parse error in Mermaid, measured) and `default,0` (likewise)
 *   are read here, and a non-index address is diagnosed by the model in the
 *   one wording every `linkStyle` gets.
 * - The curve name is any run of non-space characters, where Mermaid's is
 *   its `alphaNum` token run. No curve name either side recognizes contains
 *   anything else, and an unrecognized one is diagnosed by the model.
 * - An index past the last edge: Mermaid's `updateLinkInterpolate` has no
 *   bounds check (unlike `updateLink`), so it throws a `TypeError` writing
 *   to `this.edges[pos].interpolate`. Siren reports the index error every
 *   `linkStyle` gets (`buildFlowchartModel`) and draws the rest.
 * - `interpolate` is matched case-sensitively, as Mermaid's lexer
 *   (`/^(?:interpolate\b)/`) does. The address list is lazy so that it
 *   stops at the first `interpolate`.
 */
const LINK_STYLE_INTERPOLATE_RE = /^linkStyle\s+([\w,\s]*?[\w,])\s+interpolate\s+(\S+)(?:\s+(.+))?$/;

/**
 * `class A,B emphasis` — this kind's spelling of the apply-directive, which
 * a class diagram spells `cssClass "A,B" emphasis`. Both normalize to the
 * one `apply` kind here, so no model, renderer or test downstream learns
 * that two spellings exist.
 *
 * The target list is greedy up to the trailing name: its class swallows the
 * whole tail and backtracks until a bare `\w+` is left for the definition
 * name, which is what lets `class A, B emphasis` be read the same as
 * `class A,B emphasis` without a second pattern. The `.` in that class is
 * this ticket's: `class a.b,c.d hot` is a target list of two dotted ids,
 * matching what `STYLE_RE`'s single target and `NODE_CLASS_RE`'s shorthand
 * already accept. The whole id alphabet is (`ID_ALPHABET_SET`), so a `%`
 * and a `-` are too: `class A%B,C%%D hot`, `class a-b,c hot` (measured,
 * 01M4ZWT8PR).
 */
const CLASS_APPLY_RE = new RegExp(String.raw`^class\s+(${CLASS_APPLY_TARGETS})\s+(${CLASS_NAME})\s*$`, "d");

/**
 * Splits the comma-separated target list an apply-directive (`class A,B
 * name`) and a `linkStyle 0,2` both write, discarding the empty segments a
 * trailing or doubled comma leaves behind.
 *
 * It answers nothing about what the segments *are*. Whether an id names a
 * node is `resolveStyles`' question, asked once against the model's ids;
 * whether an address names an edge is `buildFlowchartModel`'s. Naming
 * something in a styling statement does not declare it, in either spelling.
 */
function splitTargetIds(text: string): string[] {
  return text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Whether `text`, scanned left to right, ends with a Markdown label's fence
 * (`` "` `` … `` `" ``) still open — the two-character opener seen and its
 * closer not yet.
 *
 * Scoped to exactly those two character pairs, which is what keeps this from
 * firing on anything else this grammar writes: a quote and a backtick never
 * land next to each other outside a Markdown label's fence, so an ordinary
 * line — a `style` declaration, a `click ... "tip"`, a plain quoted label —
 * can never be mistaken for one that continues.
 */
function markdownFenceIsOpenAtEndOf(text: string): boolean {
  let open = false;
  for (let i = 0; i < text.length - 1; i++) {
    if (!open && text[i] === '"' && text[i + 1] === "`") {
      open = true;
      i++;
    } else if (open && text[i] === "`" && text[i + 1] === '"') {
      open = false;
      i++;
    }
  }
  return open;
}

/**
 * Joins a Markdown label's fence back into one physical line when the
 * author's closing backtick lies on a later one — `` A["`line1 `` on one
 * line and `` line2`"]  `` on the next, which mermaid 11.17.2 reads as a
 * single vertex labelled `"line1\nline2"` (measured,
 * `scripts/mermaid-probe.mjs`). Every other construct in this grammar is
 * read one physical line at a time; this is the one place that is not
 * enough, because a Markdown label is the one place Mermaid's own lexer
 * keeps reading past a line break in search of the quote that closes it.
 *
 * **Lines keep their positions, not their count.** The physical lines a
 * fence swallows are blanked rather than removed, so every line number after
 * the join still means what it meant before: `splitStatements` already
 * treats a blank line as carrying no statements, so a blanked line costs
 * nothing downstream, and the merged text lands on the line the fence
 * opened on — the line a diagnostic about it should point at anyway.
 *
 * A fence still open at the end of the document is left merged through to
 * the last line: whatever statement pattern is then asked to read it finds
 * an unclosed fence in its capture and fails to match, which is the same
 * "unrecognized line" a Mermaid author sees for any other malformed
 * statement, not a crash.
 */
function joinMarkdownFences(lines: readonly string[]): string[] {
  const joined = [...lines];
  for (let i = 0; i < joined.length; i++) {
    let text = joined[i];
    let end = i;
    while (markdownFenceIsOpenAtEndOf(text) && end + 1 < joined.length) {
      end++;
      text += "\n" + joined[end];
    }
    if (end !== i) {
      joined[i] = text;
      for (let blank = i + 1; blank <= end; blank++) {
        joined[blank] = "";
      }
      i = end;
    }
  }
  return joined;
}

/**
 * Parses Siren flowchart source text (a `flowchart TB|BT|LR|RL` header — or
 * `graph`, Mermaid's original spelling of the same word — node/edge
 * declarations, author styling statements, and an optional `timeline:` block) into a
 * `FlowchartDocument`. Never throws on malformed input — syntax problems
 * are reported as diagnostics instead.
 *
 * The `timeline:` block itself is no longer parsed here: its grammar and its
 * body drain both live in `parseTimelineBlock`, which all three diagram kinds
 * call, so they read one vocabulary instead of copies that drift. This
 * function still owns *where* the block starts and what a diagnostic inside
 * it costs the document, and nothing else about it.
 */
export function parseFlowchart(source: string): DiagramParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = joinMarkdownFences(source.split(/\r\n|\r|\n/));
  // The lines whose statement an `@{ … }` block has already run on into
  // the lines after it (`runOn`), so a block never closed runs on once.
  const ranOn = new Set<number>();

  const nodesById = new Map<string, SirenNode>();
  const edges: SirenEdge[] = [];
  const styles: StyleDecl[] = [];
  const linkStyles: LinkStyleDecl[] = [];
  const interactions: Interaction[] = [];
  const subgraphs: SirenSubgraph[] = [];
  let direction: Direction | null = null;
  // The edge ids refused so far (`A e1@--> B`), so a later `e1@{ … }` is
  // told it is that edge's data rather than a node's.
  const edgeIds = new Set<string>();
  // The keyword the header was written with, `flowchart` or `graph`, so a
  // fix this parser suggests for the header is spelled the author's way.
  let headerKeyword = "";
  let timeline: SirenTimeline | null = null;
  let namedTimelines: NamedTimeline<SirenTimeline>[] = [];
  let accTitle: string | null = null;
  let accDescr: string | null = null;

  /**
   * The `subgraph` blocks currently open, innermost last, each remembered
   * alongside the statement that opened it so an unterminated one can be
   * quoted back at the author in their own words.
   */
  const openBlocks: { subgraph: SirenSubgraph; statement: string; line: number; column: number }[] =
    [];

  /** Every node id some subgraph has already claimed — the first claim wins. */
  const claimedNodeIds = new Set<string>();

  /**
   * Every node this parse declared *only* because an edge endpoint mentioned
   * it bare — no label, no bracket, no line of its own — paired with the
   * block that claimed it as a member, if any.
   *
   * An endpoint that turns out to name a `subgraph` addresses that block's
   * frame, so the node provisionally declared for it is taken back once the
   * whole document has been read. It cannot be decided while the line is
   * read: a subgraph may legitimately be declared *below* the edge naming
   * it. The claim is carried alongside so that `subgraph outer / one --> B /
   * end` does not leave `outer` holding a member that no longer exists.
   *
   * Only a *bare* mention is provisional. `one[Label]` and a bare `one` on a
   * line of its own are declarations the author made in their own right, and
   * they keep their box beside the frame — which is what mermaid 11.17.2
   * does for `A[Alpha]` beside `subgraph A`, measured, and what ADR-0010's
   * generated subgraph id exists to keep apart.
   */
  const provisionalEndpointNodes = new Map<string, SirenSubgraph | null>();

  /**
   * Every node id written with an `@{ … }` block, with where its first `@`
   * stands — so a block on an id that turns out to name a `subgraph` can be
   * refused there once the whole document has been read, the subgraph
   * being free to be declared below it.
   */
  const nodeDataAt = new Map<string, { line: number; column: number }>();
  /**
   * Every node id the author wrote a label for — in brackets or as a
   * block's `label:` — with where the last one stands, so that a label
   * written for a shape that draws no text can be refused there once the
   * node's final shape is known.
   */
  const labelWrittenAt = new Map<string, { line: number; column: number }>();

  let mode: "before-header" | "flowchart" = "before-header";
  let sawError = false;

  /**
   * Reads the declaration list of a `style`/`classDef` statement, turning
   * each segment that is not a `property:value` pair into an error
   * diagnostic on that statement's line. The split itself is
   * `parseStyleProperties`' — shared with the class diagram — because every
   * kind's styling statements read one declaration list; only where the
   * diagnostic lands is this parser's to know.
   */
  const readStyleProperties = (text: string, statement: Statement): StyleProperty[] | null => {
    // Read before the declarations are split, as Mermaid 12.2.0's grammar
    // reads them: an `@`, a brace or an arrow anywhere in them is a parse
    // error there (measured), so it refuses the statement. The declarations
    // are the end of the statement, which places what refused them.
    const refused = STYLE_VALUE_REFUSED_RE.exec(text);
    if (refused !== null) {
      diagnostics.push({
        severity: "error",
        message: `A style declaration cannot hold "${refused[0]}": ${text}. ${styleValueFix(text, refused)}`,
        ...positionIn(statement, statement.text.length - text.length + refused.index),
      });
      sawError = true;
      return null;
    }
    const { properties, malformed } = parseStyleProperties(text);
    for (const segment of malformed) {
      diagnostics.push({
        severity: "error",
        message: `"${segment}" is not a style declaration. Write each declaration as property:value, such as stroke:#f00`,
        line: statement.line,
        column: statement.column,
      });
      sawError = true;
    }
    return properties;
  };

  /**
   * One `linkStyle` statement, in either spelling — plain, or with an
   * `interpolate` clause — built in one place so the two cannot drift.
   *
   * The addresses go through untouched — see `LINK_STYLE_RE` — and so does
   * the curve name: which edges an address names, and which names Siren
   * draws, are the model's questions. The declarations do not: they are read
   * by the same splitter `style` and `classDef` use, so all three statements
   * accept one declaration list and diagnose a bad segment in one wording.
   */
  const readLinkStyle = (
    addresses: string,
    declarations: string | undefined,
    statement: Statement,
    interpolate?: string,
  ): LinkStyleDecl | null => {
    const properties = declarations === undefined ? [] : readStyleProperties(declarations, statement);
    return properties === null
      ? null
      : {
          targets: splitTargetIds(addresses),
          ...(interpolate === undefined ? {} : { interpolate }),
          properties,
          line: statement.line,
          column: statement.column,
        };
  };

  /**
   * Records the `:::name` shorthand as what it is: the apply-directive,
   * written at the declaration instead of on a line of its own. It produces
   * the same statement `class A name` produces, so nothing downstream — the
   * shared resolver included — learns that the shorthand exists.
   *
   * `authoredAs` is `:::` rather than `class` because it is what a
   * diagnostic may quote, and an author who wrote `A:::ghost` never wrote
   * the word `class`.
   */
  const applyAtDeclaration = (
    id: string,
    definitionName: string,
    line: number,
    column: number,
  ) => {
    styles.push({
      styleKind: "apply",
      authoredAs: ":::",
      targetIds: [id],
      name: definitionName,
      properties: [],
      line,
      column,
    });
  };

  const addNode = (
    id: string,
    label: Label,
    shape: NodeShape,
    line: number,
    column: number,
  ) => {
    const existing = nodesById.get(id);
    if (existing === undefined) {
      nodesById.set(id, { id, label, shape, line, column });
      return;
    }
    // A later bracket replaces an earlier one — its label and its shape
    // both, silently — and the node keeps the place it was first written in.
    // Mermaid 11.17.2, measured: `A[x]` then `A[y]` draws "y", and `A[x]`
    // then `A{x}` draws a diamond, each with no diagnostic. The author's
    // later word is the one used, so there is no mistake here to warn about.
    nodesById.set(id, { ...existing, label, shape });
  };

  /**
   * Turns the problems `readLabel` found in one label into diagnostics, each
   * at the line and column of the character it is about — `at` being where
   * the label's offsets count from, in `statement`'s own text (`positionIn`).
   *
   * An error costs the whole document, exactly as an unrecognized line does:
   * a label Siren cannot draw as written is not drawn some other way.
   */
  const reportLabelProblems = (problems: LabelProblem[], statement: Statement, at: number) => {
    const reported = labelDiagnostics(problems, (offset) => positionIn(statement, at + offset));
    diagnostics.push(...reported.diagnostics);
    if (reported.hasError) {
      sawError = true;
    }
  };

  /**
   * Reads one place a node was written — a line of its own or either end of
   * an edge — with whatever it was written with there.
   *
   * The three spellings differ only in what they hand this function, which
   * is why they share it: the shorthand works wherever a node can be
   * written, so where it was written must not be what decides what it does.
   *
   * The label and the definition are independent. A label declares, so a
   * labelled mention goes through `addNode` and replaces whatever bracket
   * came before it; an unlabelled one only applies, so it declares the node just
   * when nothing else has and leaves a label written elsewhere for that id
   * alone. That second rule is ticket 04's, for the standalone `A:::name`,
   * and an edge's bare endpoint has always followed it — they are one rule
   * written once here rather than two copies free to drift.
   *
   * `label` is bracket content as written, so the fence comes off here —
   * once, for every place a label can appear, which is why `A["x, y"]` on
   * a line of its own and at an edge endpoint cannot disagree about what
   * the author wrote. `parseNodeLabel` is what removes it, through
   * `labelSpan`, so a Markdown label is told apart from an ordinary one in
   * the one place both spellings already meet.
   */
  /**
   * What a node's `@{ … }` block says, laid over whatever the rest of the
   * place it was written in already gave the node.
   */
  const applyNodeData = (id: string, data: NonNullable<EdgeEndpoint["data"]>, statement: Statement) => {
    const node = nodesById.get(id)!;
    const read = readNodeData(data.content);
    for (const { severity, message, offset } of read.problems) {
      // At the place in the block a problem names, past its `@{`; else at the `@`.
      const at = offset === undefined ? data.at : data.at + NODE_DATA_OPENER.length + offset;
      diagnostics.push({ severity, message, ...positionIn(statement, at) });
      if (severity === "error") {
        sawError = true;
      }
    }
    if (read.shape !== null) {
      node.shape = read.shape;
    }
    if (read.label !== null) {
      // The label is the YAML string's value, not text as written, so a
      // problem in it is reported at the block's `@` rather than at a
      // character the author may have spelled differently.
      const { label, problems } = readLabel(read.label.text, { dialect: "html", markdown: read.label.markdown });
      reportLabelProblems(
        problems.map((problem) => ({ ...problem, offset: 0 })),
        statement,
        data.at,
      );
      node.label = label;
      labelWrittenAt.set(id, positionIn(statement, data.at));
    }
    if (read.icon !== null) {
      node.icon = { ...read.icon, ...positionIn(statement, data.at) };
      // An icon node given no label draws none (Mermaid 12.2.0's
      // `addVertex`: no `label:`, and no text but the id).
      if (read.icon.name !== null && read.label === null && node.label.text === id) {
        node.label = plainLabel("");
      }
    }
  };

  const addNodeAsWritten = (
    { id, label, labelAt, definitionName, shape, data }: EdgeEndpoint,
    statement: Statement,
    /**
     * Where this mention was written. Only an *edge endpoint* can mean a
     * subgraph's frame rather than a node — that is Mermaid's rule and the
     * reason this parameter exists — so a bare mention there declares the
     * node provisionally, while the same spelling on a line of its own
     * declares it outright.
     */
    writtenAs: "an edge endpoint" | "a declaration" = "a declaration",
  ) => {
    // An id an edge was given earlier makes the block that edge's data, as
    // Mermaid 12.2.0 reads it (measured: `e1@{ animate: true }` after
    // `A e1@--> B`; with no such edge it is a node `e1`).
    // On a line of its own only: as an edge's endpoint (`C --> e1@{ … }`)
    // it is a node, which the edge id then clashes with.
    if (data !== undefined && edgeIds.has(id) && writtenAs === "a declaration") {
      const read = readEdgeData(data.content);
      for (const { severity, message, offset } of read.problems) {
        const at = offset === undefined ? data.at : data.at + NODE_DATA_OPENER.length + offset;
        diagnostics.push({ severity, message, ...positionIn(statement, at) });
        if (severity === "error") {
          sawError = true;
        }
      }
      // The edge the id names, and only it: a repeated id is the model's to
      // refuse, and leaves this block on the first edge written with it.
      const edge = edges.find((written) => written.id === id);
      if (edge !== undefined) {
        // The place kept is the curve's, once a block has set one: it is
        // what decides the curve against a `linkStyle N interpolate`, and a
        // later block saying nothing about the curve must not move it.
        const keepsPlace = edge.data?.curve !== undefined && read.data.curve === undefined;
        const place = keepsPlace ? { line: edge.data!.line, column: edge.data!.column } : positionIn(statement, data.at);
        edge.data = { ...edge.data, ...read.data, ...place };
      }
      return;
    }
    const undeclared = !nodesById.has(id);

    // Membership is claimed here, at the one place a node is *written*, for
    // the same reason the label rules live here: where it was written must
    // not decide what it means. An edge endpoint, a declaration on a line of
    // its own and the `:::` shorthand all reach this function, and all three
    // put a node inside the block they were written in — which is what
    // mermaid 11.17.2 does, measured.
    //
    // The innermost open block claims it, and only if nothing has: a node
    // already inside a subgraph stays there however many later blocks name
    // it, which is how an edge drawn *out* of a group does not move its
    // source into the group at the other end.
    const innermost = openBlocks[openBlocks.length - 1];
    let claimedBy: SirenSubgraph | null = null;
    if (innermost !== undefined && !claimedNodeIds.has(id)) {
      claimedNodeIds.add(id);
      innermost.subgraph.nodeIds.push(id);
      claimedBy = innermost.subgraph;
    }
    const { line, column } = statement;
    if (label !== undefined) {
      const read = parseNodeLabel(label);
      reportLabelProblems(read.problems, statement, labelAt);
      addNode(id, read.label, shape, line, column);
      labelWrittenAt.set(id, positionIn(statement, labelAt));
    } else if (undeclared) {
      nodesById.set(id, { id, label: plainLabel(id), shape, line, column });
    }
    if (data !== undefined) {
      applyNodeData(id, data, statement);
      if (!nodeDataAt.has(id)) {
        nodeDataAt.set(id, positionIn(statement, data.at));
      }
    }
    if (definitionName !== undefined) {
      applyAtDeclaration(id, definitionName, line, column);
    }

    // A bare edge endpoint declares its node provisionally; anything else —
    // a label written here, or the same id written anywhere as a declaration
    // — settles it as a node the author asked for, whatever a `subgraph`
    // further down happens to be called.
    if (writtenAs === "an edge endpoint" && label === undefined) {
      if (undeclared) {
        provisionalEndpointNodes.set(id, claimedBy);
      }
    } else {
      provisionalEndpointNodes.delete(id);
    }
  };

  // Labelled because a line is no longer necessarily one statement: two of
  // the branches below end the whole document rather than the statement,
  // and they have to say which loop they mean.
  readLines: for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const rawLineNumber = i + 1;
    // Where an offset in `rawLine` stands in the source. A raw line may hold
    // line breaks — a Markdown fence (`joinMarkdownFences`) or an `@{ … }`
    // block (`runOn`) carries the lines it joins — and each one moves what
    // follows it a line down and restarts the column count.
    const rawBreaks = lineBreaksOf(rawLine);
    const rawPosition = (offset: number) => positionAfterBreaks(rawBreaks, offset, rawLineNumber, 1);

    // The braced accDescr, read across lines before the line is split into
    // statements. What follows its `}` goes back into `lines` at the `}`
    // line, blanked to its column, to be read as that line's statements.
    if (mode === "flowchart" && ACC_DESCR_BLOCK_RE.test(rawLine)) {
      const block = readAccDescrBlock(lines, i, rawLine.indexOf("{"));
      if (!block.closed) {
        diagnostics.push({
          severity: "error",
          message: "Unclosed `accDescr { ... }` block: no `}` ends the description it opens",
          line: rawLineNumber,
          column: rawLine.length - rawLine.trimStart().length + 1,
        });
        sawError = true;
        break readLines;
      }
      accDescr = block.description;
      if (block.rest === null) {
        i = block.closeIndex;
      } else {
        lines[block.closeIndex] = block.rest;
        i = block.closeIndex - 1;
      }
      continue;
    }

    for (const [pieceIndex, piece] of splitStatements(rawLine).entries()) {
      const line = piece.text;
      // Where the statement begins in `rawLine`, and so in the source.
      const rawAt = piece.column - 1;
      const { line: lineNumber, column } = rawPosition(rawAt);
      const statement: Statement = { text: line, line: lineNumber, column };
      // Where a `%%` stands outside the statement's text, read once for every
      // branch below that asks; and the statement up to it.
      const percentAt = midLinePercentAt(line);
      const beforePercent = percentAt === null ? line : line.slice(0, percentAt).trimEnd();
      // A node's `@{ … }` block not closed on this line runs on into the
      // lines after it: the statement is written back into this line,
      // blanked up to its column, with those lines joined to it and blanked,
      // and the line is read again from there. Asked only where a node is
      // written, so that an `@{` in any other statement is never a block.
      const runOn = (blocks: readonly NodeDataBlock[]): boolean => {
        if (blocks.at(-1)?.end !== null || ranOn.has(i)) {
          return false;
        }
        const { text, taken } = blockRunOn(line, lines, i + 1, nodeDataBlocksOf);
        if (taken === 0) {
          return false;
        }
        lines[i] = rawLine.slice(0, rawAt).replace(/[^\n]/g, " ") + text;
        lines.fill("", i + 1, i + 1 + taken);
        ranOn.add(i);
        return true;
      };
      // The ids a `style` or `class` statement targets, `targets` standing
      // at `at` in it, refused when one begins with a keyword (`style end-x
      // fill:red` is a parse error in Mermaid 12.2.0, measured) — true when
      // one was, which ends the statement.
      const refuseKeywordTargets = (targets: string, at: number): boolean => {
        let offset = at;
        for (const segment of targets.split(",")) {
          const lead = segment.length - segment.trimStart().length;
          const refusal = refuseKeywordId(segment.trim(), true);
          if (refusal !== null) {
            diagnostics.push({
              severity: "error",
              message: refusal.message,
              ...positionIn(statement, offset + lead),
            });
            sawError = true;
            return true;
          }
          offset += segment.length + 1;
        }
        return false;
      };
      // An `&` with no node on one side, or without a space on each side,
      // in `parts` (standing at `partAt`), refused — true when one was,
      // which ends the statement.
      const refuseMalformedGroups = (parts: readonly string[], partAt: readonly number[]): boolean => {
        // An `&` with no node on one side (`& A`, `A &`, `A & --> B`): a
        // parse error in Mermaid 12.2.0 (measured), and no spacing fixes it.
        for (const [index, part] of parts.entries()) {
          const { parts: pieces, separators } = cutOutsideLabel(part, GROUP_SEPARATOR);
          const pieceAt = offsetsOf(pieces, separators);
          const blank = separators.length === 0 ? -1 : pieces.findIndex((piece) => piece.trim() === "");
          if (blank !== -1) {
            const before = blank < separators.length;
            const ampersandAt = partAt[index]! + (before ? pieceAt[blank]! + pieces[blank]!.length : pieceAt[blank]! - 1);
            diagnostics.push({
              severity: "error",
              message:
                `An "${GROUP_SEPARATOR}" joins two nodes, and this one has none ${before ? "before" : "after"} it. ` +
                `Write a node there, or leave the "${GROUP_SEPARATOR}" out.`,
              ...positionIn(statement, ampersandAt),
            });
            sawError = true;
            return true;
          }
        }
        const unspaced = unspacedGroupSeparators(line, parts, partAt);
        if (unspaced.length === 0) {
          return false;
        }
        diagnostics.push({
          severity: "error",
          message:
            `An "${GROUP_SEPARATOR}" joins nodes only with a space on each side. ` +
            `Write: ${withBlocksElided(spacedGroupSeparators(line, unspaced))}`,
          ...positionIn(statement, unspaced[0]!),
        });
        sawError = true;
        return true;
      };
      // An endpoint that is nothing but `click`, `call` or `href`
      // (`SPACED_KEYWORDS`) where whitespace or the line's end follows it,
      // which Mermaid 12.2.0 reads as that keyword (measured: `A --> click`
      // and `click --> A` are refused or drawn empty). `A --> click;B`,
      // `click[x]` and `click-->B` are ids. `pieces` are the endpoints as
      // written, each at its offset; true when one was refused.
      const refuseSpacedKeywordIds = (
        pieces: readonly { text: string; at: number }[],
        endpoints: readonly EdgeEndpoint[],
      ): boolean => {
        // A `;` right after the statement, with no space: `A --> click;B` is
        // an id, `A --> click ;B` the keyword (measured).
        const followedBySemicolon = rawLine[rawAt + line.length] === STATEMENT_END;
        const at = endpoints.findIndex(
          (endpoint, index) =>
            SPACED_KEYWORDS.has(endpoint.id) &&
            endpoint.label === undefined &&
            endpoint.data === undefined &&
            endpoint.definitionName === undefined &&
            (/\s$/.test(pieces[index]!.text) || (index === endpoints.length - 1 && !followedBySemicolon)),
        );
        if (at === -1) {
          return false;
        }
        const piece = pieces[at]!;
        const id = endpoints[at]!.id;
        diagnostics.push({
          severity: "error",
          message: keywordIdMessage(id, id),
          ...positionIn(statement, piece.at + piece.text.length - piece.text.trimStart().length),
        });
        sawError = true;
        return true;
      };
      // One endpoint of an edge or a group that could not be read, as
      // written and at its offset in the statement: refused at the reason
      // `refuseNode` names, or the whole statement as unrecognized.
      const refuseUnreadableEndpoint = (piece: { text: string; at: number }) => {
        const lead = piece.text.length - piece.text.trimStart().length;
        const nodeRefusal = refuseNode(piece.text.trim(), "an edge endpoint");
        diagnostics.push({
          severity: "error",
          message: nodeRefusal?.message ?? `Unrecognized flowchart line: "${quotedOnOneLine(line)}"`,
          ...positionIn(statement, nodeRefusal === null ? 0 : piece.at + lead + nodeRefusal.offset),
        });
        sawError = true;
      };
      const refusePercent = () => {
        diagnostics.push({
          severity: "error",
          // A statement after a `;` that begins with `%%` (`A;%%B`, `A --> B;
          // %%c`): Mermaid 12.2.0 draws it as a node `%%B` (measured), which
          // an author writing a comment there did not mean.
          message: percentAt === 0 && pieceIndex > 0 ? PERCENT_AFTER_SEMICOLON_MESSAGE : MID_LINE_PERCENT_MESSAGE,
          ...positionIn(statement, percentAt!),
        });
        sawError = true;
      };

      if (mode === "before-header") {
        const headerDirection = matchFlowchartHeader(line);
        if (headerDirection === null) {
          // `flowchart TB %% x`: a header Mermaid refuses for its `%%`
          // (measured, "Expecting 'NEWLINE', got 'NODE_STRING'") is told so.
          if (percentAt === null) {
            diagnostics.push({
              severity: "error",
              message: `Expected ${FLOWCHART_HEADER_SPELLINGS}, found "${line}"`,
              line: lineNumber,
              column,
            });
          } else {
            refusePercent();
          }
          sawError = true;
          break readLines;
        }
        direction = headerDirection;
        headerKeyword = line.slice(0, line.search(/\s/));
        mode = "flowchart";
        continue;
      }

      if (isTimelineHeader(line)) {
        // The first header ends the diagram body for good: every line after
        // it belongs to some timeline block, so a statement written there is
        // a timeline diagnostic rather than structure. Splitting the blocks
        // and reading them is `parseTimelineBlocks`'s job; what stays here
        // is only this parser's own decision: where the first block starts,
        // and that a diagnostic inside any of them costs the whole document.
        const blocks = parseTimelineBlocks(lines, i);
        diagnostics.push(...blocks.diagnostics);
        // Every diagnostic the shared grammar reports is error-severity, so a
        // non-empty list is exactly the old per-branch `sawError = true`.
        if (blocks.diagnostics.length > 0) {
          sawError = true;
        }
        timeline = blocks.timeline;
        namedTimelines = blocks.namedTimelines;
        break readLines;
      }

      // Asked before the line is cut at its arrows, because a title is a
      // place where an arrow means nothing: `subgraph "A --> B"` is one
      // block with a punctuated name, not a malformed edge.
      const subgraphOpenMatch = SUBGRAPH_OPEN_RE.exec(line);
      if (subgraphOpenMatch !== null) {
        // `subgraph end` is no handle: Mermaid 12.2.0 reads the `end` as the
        // block's own (measured), so it is refused below as a title ending
        // with that word is.
        let title = subgraphOpenMatch[1] === SUBGRAPH_END ? null : readSubgraphTitle(subgraphOpenMatch[1]);
        if (title === null && percentAt !== null) {
          // Refused for its `%%`, but still a block: its `end` closes it, so
          // the one mistake is reported once rather than again at the `end`.
          refusePercent();
          title = titleWithoutHandle(subgraphOpenMatch[1]);
        }
        const refusal = title === null ? refuseSubgraphTitle(subgraphOpenMatch[1]) : null;
        if (refusal !== null) {
          // Refused, but still a block, as a `%%` above is: its `end` closes
          // it, so the one mistake is reported once.
          diagnostics.push({
            severity: "error",
            message: refusal.message,
            ...positionIn(statement, subgraphOpenMatch.indices![1]![0] + refusal.offset),
          });
          sawError = true;
          title = titleWithoutHandle(subgraphOpenMatch[1]);
        }
        if (title === null) {
          diagnostics.push({
            severity: "error",
            message: `Unrecognized flowchart line: "${quotedOnOneLine(line)}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }
        reportLabelProblems(title.problems, statement, subgraphOpenMatch.indices![1]![0]);
        const subgraph: SirenSubgraph = {
          name: title.name,
          label: title.label,
          nodeIds: [],
          subgraphs: [],
          // Filled in below when the block's own body writes a `direction`
          // line; `null` here rather than left out, the empty-not-absent
          // rule every other optional statement in this parser follows.
          direction: null,
          line: lineNumber,
          column,
        };
        // Into the block that encloses it, or into the document when there
        // is none — the tree `FlowchartDocument.subgraphs` is the root of.
        const enclosing = openBlocks[openBlocks.length - 1];
        (enclosing === undefined ? subgraphs : enclosing.subgraph.subgraphs).push(subgraph);
        openBlocks.push({ subgraph, statement: line, line: lineNumber, column });
        continue;
      }

      if (beforePercent === SUBGRAPH_END && openBlocks.length > 0) {
        // `end %% x` is refused for its `%%`, and still ends its block, so
        // the one mistake is not reported again as an unterminated block.
        if (percentAt !== null) {
          refusePercent();
        }
        openBlocks.pop();
        continue;
      }

      // `end B` inside a block: Mermaid 12.2.0 ends the block at `end` and
      // reads `B` (`B[x]`, `B --> C`) outside it (measured), a picture of
      // neither. Refused, the block left open for the author's own `end`.
      const endThenMore = END_THEN_MORE_RE.exec(beforePercent);
      if (endThenMore !== null && openBlocks.length > 0) {
        diagnostics.push({
          severity: "error",
          message:
            `"${SUBGRAPH_END}" ends the subgraph here, and "${endThenMore[1]}" after it is read outside the block. ` +
            `Write "${SUBGRAPH_END}" on a line of its own.`,
          line: lineNumber,
          column,
        });
        sawError = true;
        continue;
      }

      // Read up to a `%%`: Mermaid's direction token is
      // `.*direction\s+LR[^\n]*`, so whatever trails it on the line is
      // taken with it (measured, `direction LR %% x` is `dir: "LR"`, and
      // so are `direction LR zz` and `direction LRzz`).
      const directionLine = DIRECTION_LINE_RE.exec(beforePercent);
      const blockDirection = directionLine === null ? null : matchClassDirection(directionLine[1]);
      if (directionLine !== null && blockDirection !== null) {
        if (openBlocks.length > 0) {
          openBlocks[openBlocks.length - 1].subgraph.direction = blockDirection;
          const trailing = directionLine[3];
          const ignored = trailing.trimStart();
          if (ignored !== "") {
            diagnostics.push({
              severity: "warning",
              message: `Text after "direction ${directionLine[2]}" is ignored: "${ignored}". Remove it.`,
              ...positionIn(statement, directionLine.indices![3]![0] + trailing.length - ignored.length),
            });
          }
        } else {
          diagnostics.push({
            severity: "warning",
            message:
              `"${beforePercent}" outside a subgraph has no effect. ` +
              `Set the diagram's direction on its first line instead: ${headerKeyword} ${blockDirection}`,
            line: lineNumber,
            column,
          });
        }
        continue;
      }

      // A `%%` after a complete statement, with no text around it to belong
      // to. Asked after the statements that do hold text to the end of their
      // line — a subgraph's title, a block's direction — and before any
      // reading of what is left, so the author is told what the `%%` is
      // rather than that the line is unreadable. A declaration list and an
      // accessibility line keep everything they hold, a `%%` included, as
      // Mermaid does (measured: `style A fill:#f00 %% x` records
      // `fill:#f00 %% x`, `accTitle: t %% x` the title `t %% x`).
      const keepsItsText = holdsTextToItsEnd(line);
      if (percentAt !== null && !keepsItsText) {
        refusePercent();
        continue;
      }

      // A declaration list is not a place where an arrow means anything —
      // the same rule `splitStatements` already applies to `;` there, and
      // the reason it has to be applied here too now that the separator is
      // a pattern: `style A --my-token:4` carries a `--`, and cutting the
      // statement at it would refuse a styling declaration as a malformed
      // edge. Mermaid rejects that particular line as well, so nothing
      // Mermaid draws turns on this; what turns on it is which diagnostic
      // an author gets, and "not an arrow Siren draws" is the wrong one to
      // hand someone who wrote a `style` statement.
      //
      // Nor is an accessibility line: Mermaid 12.2.0 keeps all of
      // `accTitle: a --> b` as the title and draws no edge (measured).
      const {
        parts: arrowParts,
        separators: arrowTokens,
        blocks: lineBlocks,
      } = keepsItsText
        ? { parts: [line], separators: [] as string[], blocks: [] }
        : cutOutsideLabel(line, ARROW_RE);
      if (arrowParts.length > 1) {
        if (runOn(lineBlocks)) {
          i--;
          continue readLines;
        }
        // Every outcome below ends the statement. An arrow says the author
        // meant an edge, so a statement carrying one is never handed on to
        // the node and styling patterns to be read as something else.
        const last = arrowParts[arrowParts.length - 1];
        if (
          last.trim().length === 0 &&
          arrowParts.slice(0, -1).every((part) => part.trim().length > 0)
        ) {
          diagnostics.push({
            severity: "error",
            // The token the author actually wrote, not `-->`: with thirteen
            // spellings, quoting one of them at an author who wrote another
            // sends them looking for a typo they did not make.
            message:
              `Malformed edge: missing target after "${arrowTokens[arrowTokens.length - 1]}" ` +
              `in "${quotedOnOneLine(line)}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }

        // Read before any endpoint is, and before anything is declared: a
        // token Siren does not draw refuses the whole statement, the same
        // rule an unreadable endpoint follows, so no chain is ever
        // half-consumed.
        const arrows = arrowTokens.map(readArrow);
        const unreadable = arrowTokens.find((_, index) => arrows[index] === null);
        if (unreadable !== undefined) {
          diagnostics.push({
            severity: "error",
            message: `Siren does not draw the arrow "${unreadable}" yet: "${quotedOnOneLine(line)}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }

        // A group per arrow-separated piece: one end of an arrow may name
        // several nodes, `A & B --> C`.
        //
        // Each endpoint is handed where it starts in the statement, so a
        // label's problem is reported at its own column: the pieces and the
        // separators that cut them lie end to end, and add up to the line.
        const partAt = offsetsOf(arrowParts, arrowTokens);
        const refusedLabels = arrowTokens.map(refusedInPipeLabel);
        const refusedLabelAt = refusedLabels.findIndex((found) => found !== null);
        if (refusedLabelAt !== -1) {
          const { at, refused, character, fixed } = refusedLabels[refusedLabelAt]!;
          const tokenAt = partAt[refusedLabelAt]! + arrowParts[refusedLabelAt]!.length;
          const fixedLine = line.slice(0, tokenAt) + fixed + line.slice(tokenAt + arrowTokens[refusedLabelAt]!.length);
          diagnostics.push({
            severity: "error",
            message:
              (refused === "quote"
                ? "An edge label can be quoted only as a whole. "
                : refused === "at"
                  ? `An edge label without quotes cannot begin with a word holding "${character}". `
                  : `An edge label without quotes cannot hold "${character}". `) +
              `Put the whole label in quotes: ${withBlocksElided(fixedLine)}`,
            ...positionIn(statement, tokenAt + at),
          });
          sawError = true;
          continue;
        }
        // An arrow's own id, `A e1@--> B`, taken off the piece before it
        // before any piece is read as nodes.
        const { parts: endpointParts, ids: linkIds } = takeEdgeIds(arrowParts, arrowTokens);
        const misspelled = linkIds.findIndex((linkId) => linkId !== null && !linkId.spelled);
        if (misspelled !== -1) {
          const { id, offset } = linkIds[misspelled]!;
          diagnostics.push({
            severity: "error",
            message:
              `The edge id "${id}" holds a character an id cannot. ` +
              'Write it with letters, digits, "_", "-", "." and "%" only',
            ...positionIn(statement, partAt[misspelled]! + offset),
          });
          sawError = true;
          continue;
        }
        const keywordId = linkIds.findIndex((linkId) => linkId !== null && EDGE_ID_KEYWORD_RE.test(linkId.id));
        if (keywordId !== -1) {
          const { id, offset } = linkIds[keywordId]!;
          diagnostics.push({
            severity: "error",
            message: keywordIdMessage(id, EDGE_ID_KEYWORD_RE.exec(id)![0]),
            ...positionIn(statement, partAt[keywordId]! + offset),
          });
          sawError = true;
          continue;
        }
        if (refuseMalformedGroups(endpointParts, partAt)) {
          continue;
        }
        // Each piece kept beside what it read as, so an unreadable one can be
        // explained in its own words, at its own column.
        const pieces: { text: string; at: number }[] = [];
        const groups: (EdgeEndpoint | null)[][] = endpointParts.map((part, index) => {
          const { parts, separators } = cutOutsideLabel(part, GROUP_SEPARATOR);
          const pieceAt = offsetsOf(parts, separators);
          return parts.map((piece, at) => {
            pieces.push({ text: piece, at: partAt[index]! + pieceAt[at]! });
            return readEndpoint(piece, partAt[index]! + pieceAt[at]!);
          });
        });
        const unreadableAt = groups.flat().findIndex((endpoint) => endpoint === null);
        if (unreadableAt !== -1) {
          // One unreadable endpoint refuses the whole statement — the rule
          // `ENDPOINT_RE` is anchored for. Nothing has been declared yet, so
          // there is no half-drawn chain to take back.
          const piece = pieces[unreadableAt]!;
          refuseUnreadableEndpoint(piece);
          continue;
        }

        // Every endpoint read, so the casts below are the narrowing the
        // check above earned.
        const chain = groups as EdgeEndpoint[][];
        const written = chain.flat();
        if (refuseSpacedKeywordIds(pieces, written)) {
          continue;
        }
        // An id names one edge, and an arrow joining a group draws several:
        // Mermaid 12.2.0 gives the id to one of them — the last of `A & B
        // e1@--> C`, the first of `A e1@--> B & C` — and none to the rest
        // (measured), so which one it names is not what was written.
        const grouped = linkIds.findIndex(
          (linkId, link) => linkId !== null && (chain[link]!.length > 1 || chain[link + 1]!.length > 1),
        );
        if (grouped !== -1) {
          const { id, offset } = linkIds[grouped]!;
          diagnostics.push({
            severity: "error",
            message:
              `The edge id "${id}" names one edge, but this arrow draws one for each node joined by "${GROUP_SEPARATOR}". ` +
              "Write the edge it names on a line of its own",
            ...positionIn(statement, partAt[grouped]! + offset),
          });
          sawError = true;
          continue;
        }

        // Declared once each, left to right as written — before any edge, so
        // a `:::` on an endpoint two arrows along applies exactly once rather
        // than once per link it takes part in.
        for (const endpoint of written) {
          addNodeAsWritten(endpoint, statement, "an edge endpoint");
        }
        // Sources outermost, which is Mermaid's order: `FlowDB.addLink` is
        // `for (const start of _start) for (const end of _end)`, so
        // `A & B --> C & D` is A-C, A-D, B-C, B-D.
        for (let link = 0; link + 1 < chain.length; link++) {
          // Every edge of one link wears that link's own arrow: in
          // `A & B -.-> C` both edges are dotted, and in `A --> B ==> C` the
          // second is thick and the first is not.
          const arrow = arrows[link]!;
          // Read once per arrow rather than once per edge it draws: `A & B
          // -->|x| C` is two edges wearing the one label the author wrote.
          // The token sits right after the part it follows.
          const tokenAt = partAt[link]! + arrowParts[link]!.length;
          const linkId = linkIds[link] ?? null;
          let idField: Pick<SirenEdge, "id" | "idLine" | "idColumn"> = {};
          if (linkId !== null) {
            edgeIds.add(linkId.id);
            // A block on this id written above the edge was read as a
            // node's: Mermaid 12.2.0 draws that node, and the edge without
            // the data (measured).
            const blockAt = nodeDataAt.get(linkId.id);
            if (blockAt !== undefined) {
              diagnostics.push({
                severity: "error",
                message:
                  `The "${NODE_DATA_OPENER} … }" block on "${linkId.id}" is written before the edge "${linkId.id}", ` +
                  `so it declares a node "${linkId.id}" instead. Move it below the edge`,
                ...blockAt,
              });
              sawError = true;
            }
            const { line: idLine, column: idColumn } = positionIn(statement, partAt[link]! + linkId.offset);
            idField = { id: linkId.id, idLine, idColumn };
          }
          let label: Label | null = null;
          if (arrow.label !== null) {
            const read = readLabelAt({ text: arrow.label, at: arrow.labelAt }, { dialect: "html" });
            reportLabelProblems(read.problems, statement, tokenAt);
            label = read.label;
          }
          for (const from of chain[link]) {
            for (const to of chain[link + 1]) {
              const { labelAt: _labelAt, ...form } = arrow;
              edges.push({
                from: from.id,
                to: to.id,
                ...form,
                label,
                ...idField,
                sourceLine: lineNumber,
                sourceColumn: column,
              });
            }
          }
        }
        continue;
      }

      // Checked before `CLASS_DEF_RE` and before the node-declaration
      // fallback, so `click A href "..."` is never misread as either — a
      // click statement carries no arrow, so it never reached the block
      // above, but it does reach every pattern below unless it is refused
      // here first.
      // Checked before the node-declaration fallback for the same reason
      // `click` is: an unrecognized-line diagnostic would otherwise be the
      // result, exactly as it was before these two existed. Last write wins
      // on a repeat — no diagnostic — matching `parseSequenceDiagram`'s
      // `ACC_TITLE_RE` handling.
      const accTitleMatch = ACC_TITLE_RE.exec(line);
      if (accTitleMatch !== null) {
        accTitle = accTitleMatch[1].trim();
        continue;
      }

      const accDescrMatch = ACC_DESCR_RE.exec(line);
      if (accDescrMatch !== null) {
        accDescr = accDescrMatch[1].trim();
        continue;
      }

      const clickHrefMatch = CLICK_HREF_RE.exec(line);
      if (clickHrefMatch !== null) {
        // Naming a node here does not declare it, exactly as naming one in a
        // `linkStyle` address does not: only an edge or a declaration of its
        // own does that. An interaction on a node that was never declared is
        // `buildFlowchartModel`'s to resolve.
        interactions.push({
          interactionKind: "href",
          targetId: clickHrefMatch[1],
          action: clickHrefMatch[2],
          argument: null,
          tooltip: clickHrefMatch[3] ?? null,
          linkTarget: (clickHrefMatch[4] as LinkTarget | undefined) ?? null,
          line: lineNumber,
          column,
        });
        continue;
      }

      const clickCallMatch = CLICK_CALL_RE.exec(line);
      if (clickCallMatch !== null) {
        interactions.push({
          interactionKind: "call",
          targetId: clickCallMatch[1],
          action: clickCallMatch[2],
          argument: callArgument(clickCallMatch[3]),
          tooltip: clickCallMatch[4] ?? null,
          line: lineNumber,
          column,
        });
        continue;
      }

      const clickCallBareMatch = CLICK_CALL_BARE_RE.exec(line);
      if (clickCallBareMatch !== null) {
        interactions.push({
          interactionKind: "call",
          targetId: clickCallBareMatch[1],
          action: clickCallBareMatch[2],
          argument: null,
          tooltip: null,
          line: lineNumber,
          column,
        });
        continue;
      }

      const clickHrefBareMatch = CLICK_HREF_BARE_RE.exec(line);
      if (clickHrefBareMatch !== null) {
        interactions.push({
          interactionKind: "href",
          targetId: clickHrefBareMatch[1],
          action: clickHrefBareMatch[2],
          argument: null,
          tooltip: clickHrefBareMatch[3] ?? null,
          linkTarget: (clickHrefBareMatch[4] as LinkTarget | undefined) ?? null,
          line: lineNumber,
          column,
        });
        continue;
      }

      const classDefMatch = CLASS_DEF_RE.exec(line);
      if (classDefMatch !== null) {
        // A definition targets nothing: which nodes end up with it is decided
        // by whoever applies it, in `resolveStyles`' own pass. Checked before
        // `style` and before a node declaration only because it is the more
        // specific keyword, not because the order can matter.
        // `classDef c,d …` defines each name with the one declaration list,
        // as Mermaid 12.2.0 does (measured: both `c` and `d` are styled).
        const properties = readStyleProperties(classDefMatch[2], statement);
        if (properties === null) {
          continue;
        }
        for (const name of classDefMatch[1].split(",")) {
          styles.push({
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name,
            properties,
            line: lineNumber,
            column,
          });
        }
        continue;
      }

      const classApplyMatch = CLASS_APPLY_RE.exec(line);
      if (classApplyMatch !== null) {
        if (refuseKeywordTargets(classApplyMatch[1], classApplyMatch.indices![1]![0])) {
          continue;
        }
        styles.push({
          styleKind: "apply",
          authoredAs: "class",
          targetIds: splitTargetIds(classApplyMatch[1]),
          name: classApplyMatch[2],
          properties: [],
          line: lineNumber,
          column,
        });
        continue;
      }

      const interpolateMatch = LINK_STYLE_INTERPOLATE_RE.exec(line);
      if (interpolateMatch !== null) {
        const linkStyle = readLinkStyle(interpolateMatch[1], interpolateMatch[3], statement, interpolateMatch[2]);
        if (linkStyle !== null) {
          linkStyles.push(linkStyle);
        }
        continue;
      }

      const linkStyleMatch = LINK_STYLE_RE.exec(line);
      if (linkStyleMatch !== null) {
        const linkStyle = readLinkStyle(linkStyleMatch[1], linkStyleMatch[2], statement);
        if (linkStyle !== null) {
          linkStyles.push(linkStyle);
        }
        continue;
      }

      const styleMatch = STYLE_RE.exec(line);
      if (styleMatch !== null) {
        if (refuseKeywordTargets(styleMatch[1], styleMatch.indices![1]![0])) {
          continue;
        }
        // Naming a node in a `style` statement does not declare it: styling is
        // about something that already exists, and whether it does is
        // `resolveStyles`' question, asked once against the model's ids.
        //
        // `targetIds` holds the one node this statement targets. It is a
        // list because the apply-directive targets many.
        const properties = readStyleProperties(styleMatch[2], statement);
        if (properties === null) {
          continue;
        }
        styles.push({
          styleKind: "style",
          authoredAs: "style",
          targetIds: [styleMatch[1]],
          name: null,
          properties,
          line: lineNumber,
          column,
        });
        continue;
      }

      // A node written with an `@{ … }` block on a line of its own; read as
      // an edge's endpoint is, since the two spellings are one.
      if (runOn(lineBlocks)) {
        i--;
        continue readLines;
      }

      // A group of nodes with no arrow, `A & B[x]`: each drawn as it would
      // be on a line of its own, as Mermaid 12.2.0 draws them (measured).
      // Every piece is read before any is declared, so an unreadable one
      // refuses the whole statement, at itself. A line that begins with a
      // keyword (`end&x`) is that keyword's mistake, not a group's.
      const { parts: groupParts, separators: groupSeparators } = cutOutsideLabel(line, GROUP_SEPARATOR);
      if (groupParts.length > 1 && refuseKeywordId(line, false) === null) {
        if (refuseMalformedGroups([line], [0])) {
          continue;
        }
        const groupAt = offsetsOf(groupParts, groupSeparators);
        const members = groupParts.map((part, index) => readEndpoint(part, groupAt[index]!));
        const unreadable = members.findIndex((member) => member === null);
        if (unreadable !== -1) {
          refuseUnreadableEndpoint({ text: groupParts[unreadable]!, at: groupAt[unreadable]! });
          continue;
        }
        const groupPieces = groupParts.map((text, index) => ({ text, at: groupAt[index]! }));
        if (refuseSpacedKeywordIds(groupPieces, members as EdgeEndpoint[])) {
          continue;
        }
        for (const member of members as EdgeEndpoint[]) {
          addNodeAsWritten(member, statement);
        }
        continue;
      }

      const withData = lineBlocks.length === 0 ? null : readEndpoint(line, 0);
      if (withData !== null) {
        addNodeAsWritten(withData, statement);
        continue;
      }

      const declared = readNodeDeclaration(line);
      if (declared !== null) {
        addNodeAsWritten(declared, statement);
        continue;
      }

      const nodeClassMatch = NODE_CLASS_RE.exec(line);
      if (nodeClassMatch !== null) {
        const [, id, definitionName] = nodeClassMatch;
        // Written without a label and without a bracket, so it applies a
        // definition, claims no label and names no shape — `addNodeAsWritten`
        // holds what that means, for this spelling and for an edge's bare
        // endpoint alike.
        addNodeAsWritten({ id, label: undefined, labelAt: 0, definitionName, shape: "rect" }, statement);
        continue;
      }

      // A bare id on a line of its own, inside a block or not. mermaid
      // 11.17.2 records it as a vertex — and, when it sits inside a
      // `subgraph`, as a member of that block too — measured with
      // `scripts/mermaid-probe.mjs`. `flowchart TB / Orphan / A --> B`
      // records the vertices `Orphan`, `A` and `B`, and `flowchart TB /
      // Orphan` on its own records `Orphan`: a bare id is a vertex
      // declaration at the top level exactly as it is inside a block.
      //
      // It claims no label and names no shape, exactly as an edge's bare
      // endpoint does; `addNodeAsWritten` holds what that means for both,
      // including the default label (the id itself) both spellings share
      // with the bracketed `Orphan[Orphan]` form.
      //
      // Asked last, after every keyword and every other spelling, so nothing
      // that means something else can be swallowed as a node — `A:::name`
      // is `NODE_CLASS_RE`'s own shape and has already been read by a branch
      // above. `end` needs naming explicitly rather than falling out of that
      // same logic: inside an open block it is consumed above, but a *stray*
      // `end` (no block open) reaches this line exactly as `Orphan` does,
      // and `ID_RUN` matches it too. Swallowing it as a node named "end" would
      // hide a mistyped or dangling `end` behind a silent, useless vertex
      // instead of the diagnostic below — so it is excluded by name, not by
      // block state.
      if (line !== SUBGRAPH_END && AUTHORED_NODE_ID_RE.test(line)) {
        addNodeAsWritten(
          { id: line, label: undefined, labelAt: 0, definitionName: undefined, shape: "rect" },
          statement,
        );
        continue;
      }

      const nodeRefusal = refuseNode(line, "a statement");
      diagnostics.push({
        severity: "error",
        message: nodeRefusal?.message ?? `Unrecognized flowchart line: "${quotedOnOneLine(line)}"`,
        ...positionIn(statement, nodeRefusal?.offset ?? 0),
      });
      sawError = true;
      continue;
    }
  }

  // An edge whose endpoint names a subgraph addresses that block's *frame*,
  // so the node the endpoint provisionally declared is taken back.
  //
  // Mermaid draws exactly this: `One --> Two`, where both are subgraphs, is
  // an edge between the two frames — mermaid 11.17.2 records vertices for
  // both names alongside the subgraphs and its renderer joins the clusters,
  // measured. The frame is what it draws, and a box labelled `One` beside a
  // frame of the same name is what it does *not*.
  //
  // What stays in `edges` is the name as written. Turning it into the
  // frame's id is `buildFlowchartModel`'s — a subgraph's id is generated
  // (ADR-0010) and does not exist yet at this stage, which is the same
  // reason `SirenSubgraph` carries no id either.
  //
  // Asked after the whole document has been read, because a subgraph may be
  // declared below the edge that names it.
  const subgraphNames = new Set<string>();
  const collectNames = (blocks: readonly SirenSubgraph[]): void => {
    for (const block of blocks) {
      if (block.name !== null) {
        subgraphNames.add(block.name);
      }
      collectNames(block.subgraphs);
    }
  };
  collectNames(subgraphs);

  // A subgraph's id given an `@{ … }` block. Mermaid 12.2.0 draws nothing of
  // it: a block after `subgraph S` is the frame's data, which draws no shape,
  // and one before it gives a node the frame then stands in for (measured).
  for (const [id, position] of nodeDataAt) {
    if (subgraphNames.has(id)) {
      diagnostics.push({
        severity: "error",
        message: `"${id}" is a subgraph, and a subgraph takes no "${NODE_DATA_OPENER} … }" block. Leave the block out`,
        ...position,
      });
      sawError = true;
    }
  }

  // A label written for a shape that draws no text, refused where it was
  // written: Mermaid 12.2.0 empties it and draws the bare shape (measured).
  for (const [id, position] of labelWrittenAt) {
    const node = nodesById.get(id);
    const message = node === undefined ? null : unshownLabelMessage(node.shape, node.label.text);
    if (message !== null) {
      diagnostics.push({ severity: "error", message, ...position });
      sawError = true;
    }
  }

  // A `style`, `class` or `:::` naming a node drawn in its own paint,
  // refused where it is written: it would change nothing (measured).
  for (const decl of styles) {
    if (decl.styleKind === "classDef") {
      continue;
    }
    for (const id of decl.targetIds) {
      const node = nodesById.get(id);
      const message = node === undefined ? null : unchangedStyleMessage(node.shape, id);
      if (message !== null) {
        diagnostics.push({
          severity: "error",
          message,
          ...(decl.line === undefined ? {} : { line: decl.line }),
          ...(decl.column === undefined ? {} : { column: decl.column }),
        });
        sawError = true;
      }
    }
  }

  for (const [id, claimedBy] of provisionalEndpointNodes) {
    if (!subgraphNames.has(id)) {
      continue;
    }
    nodesById.delete(id);
    // The membership goes with the node. `subgraph outer / one --> B / end`
    // would otherwise leave `outer` holding a member id nothing declares,
    // and layout grows a frame from the boxes that name it.
    if (claimedBy !== null) {
      claimedBy.nodeIds = claimedBy.nodeIds.filter((member) => member !== id);
    }
  }

  // A block the author never closed, reported in the words they opened it
  // with. One diagnostic per unclosed block, innermost first, so nesting is
  // described rather than summarized — the same answer `parseClassDiagram`
  // gives an unterminated `namespace`.
  for (const block of [...openBlocks].reverse()) {
    diagnostics.push({
      severity: "error",
      message: `Unterminated "${block.statement}" block: missing matching "${SUBGRAPH_END}"`,
      line: block.line,
      column: block.column,
    });
    sawError = true;
  }

  if (mode === "before-header" || direction === null) {
    return { document: null, diagnostics };
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: FlowchartDocument = {
    kind: "flowchart",
    direction,
    nodes: Array.from(nodesById.values()),
    edges,
    subgraphs,
    styles,
    linkStyles,
    interactions,
    accTitle,
    accDescr,
    timeline,
    ...namedTimelinesField(namedTimelines),
  };

  return { document, diagnostics };
}
