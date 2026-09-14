import type {
  Diagnostic,
  Direction,
  EdgeEnd,
  EdgeLine,
  FlowchartDocument,
  LinkStyleDecl,
  NodeShape,
  ParseResult,
  SirenEdge,
  SirenNode,
  SirenSubgraph,
  SirenTimeline,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { parseStyleProperties } from "./parseDeclarationList";
import { listAcceptedHeaders, matchFlowchartHeader } from "./parseDirection";
import { isTimelineHeader, parseTimelineBody } from "./parseTimelineBlock";

/**
 * What may lie between the `[` and the `]` of a node: either a fenced run,
 * or a character that is not the `]` ending the bracket.
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
 * Written once and shared by both readers below, so that a label means the
 * same thing on a line of its own as it does at an edge endpoint.
 */
const LABEL_CONTENT = String.raw`(?:"[^"]*"|[^\]"])*`;

/**
 * What may lie between the `{` and the `}` of a diamond: the same two
 * alternatives `LABEL_CONTENT` offers, with the brace pair standing in for
 * the bracket pair.
 *
 * `{` is excluded as well as `}`, and that exclusion is what lets the two
 * brace spellings be told apart at all. Ticket 01 wrote it so a hexagon
 * could not be swallowed as a diamond labelled `{Hexagon}` while a hexagon
 * was undrawn; now that both are drawn it does the same work from the other
 * side — `\{…\}` can never reach across an inner brace, so `A{{Hexagon}}`
 * is only ever read by the hexagon's own pattern and the two can be listed
 * in either order without one eating the other.
 *
 * An **unfenced** brace inside the label is not Mermaid: it reads `A{{a}b}}`
 * as a parse error, so refusing it here is compatibility rather than
 * strictness.
 *
 * A *fenced* brace is still a label character, exactly as a fenced `]` is:
 * mermaid 11.17.2 reads `A{"a}b"}` as the label `a}b`, `A{"x{y"}` as `x{y`
 * and `A{{"a}}b"}}` as the hexagon `a}}b`, measured with
 * `scripts/mermaid-probe.mjs`.
 */
const BRACE_LABEL_CONTENT = String.raw`(?:"[^"]*"|[^{}"])*`;

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
 * Every bracket spelling of a node, paired with the shape it names — the
 * one place a spelling and a shape are associated, read by the standalone
 * declaration and by an edge endpoint alike.
 *
 * `bracket` is everything after the id as a pattern, with the label as its
 * single capture group, so the two patterns below can be built from it
 * without either of them learning what punctuation any shape uses. Not
 * every spelling is bracketed on both sides — the asymmetric flag opens
 * with a bare `>` — which is the reason this is a pattern rather than an
 * open/close pair. A later ticket adds a row; nothing else here moves.
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
 * (`pnpm --filter @siren/core probe`), so it is the closing pair that ends
 * the label, which is what `LABEL_CONTENT`'s backtracking gives here.
 *
 * A one-character label keeps board 4's length rule for free: `A[/]` cannot
 * match `\[/…/\]`, which needs a `/` at each end, so it stays a rectangle
 * labelled `/` — as it is in Mermaid.
 */
const NODE_SPELLINGS: ReadonlyArray<{ shape: NodeShape; bracket: string }> = [
  { shape: "parallelogram", bracket: String.raw`\[/(${LABEL_CONTENT})/\]` },
  { shape: "parallelogram-alt", bracket: String.raw`\[\\(${LABEL_CONTENT})\\\]` },
  { shape: "trapezoid", bracket: String.raw`\[/(${LABEL_CONTENT})\\\]` },
  { shape: "trapezoid-alt", bracket: String.raw`\[\\(${LABEL_CONTENT})/\]` },
  { shape: "subroutine", bracket: String.raw`\[\[(${LABEL_CONTENT})\]\]` },
  // The cylinder before `rect`, for the reason the four slanted forms come
  // before it: `LABEL_CONTENT` would read `A[(DB)]` as a rectangle labelled
  // `(DB)`, which is the picture board 4 refused this spelling to stop
  // Siren drawing. Its label pattern closes the same door a second time —
  // `PAREN_LABEL_CONTENT` cannot cross a bracket of any kind, so a
  // rectangle's label can never be mistaken for a cylinder's either.
  { shape: "cylinder", bracket: String.raw`\[\((${PAREN_LABEL_CONTENT})\)\]` },
  { shape: "rect", bracket: String.raw`\[(${LABEL_CONTENT})\]` },
  { shape: "stadium", bracket: String.raw`\(\[(${LABEL_CONTENT})\]\)` },
  // Three parenthesised spellings, deepest nesting first, and the label
  // pattern is what makes the order a courtesy rather than a load-bearing
  // rule: `PAREN_LABEL_CONTENT` admits no parenthesis, so a double circle
  // can never be read as a circle labelled `(Double)` nor as a round node
  // labelled `((Double))` whichever way round the three are listed.
  { shape: "double-circle", bracket: String.raw`\(\(\((${PAREN_LABEL_CONTENT})\)\)\)` },
  { shape: "circle", bracket: String.raw`\(\((${PAREN_LABEL_CONTENT})\)\)` },
  { shape: "round", bracket: String.raw`\((${PAREN_LABEL_CONTENT})\)` },
  { shape: "hexagon", bracket: String.raw`\{\{(${BRACE_LABEL_CONTENT})\}\}` },
  // No opening bracket: `A>Flag]`. Its `>` is also the last character of
  // `-->`, and the two never collide because a line is cut into endpoints
  // at its arrows before any of these patterns is asked anything — each
  // sees one endpoint, anchored at both ends. Mermaid 11.17.2 reads
  // `A>a>b]` as the label `a>b`, so a `>` inside the label is ordinary
  // text, which is exactly what `LABEL_CONTENT` already says.
  { shape: "asymmetric", bracket: String.raw`>(${LABEL_CONTENT})\]` },
  { shape: "rhombus", bracket: String.raw`\{(${BRACE_LABEL_CONTENT})\}` },
];

/**
 * A node declaration in each spelling, with the optional `:::name`
 * shorthand that applies a `classDef` at the declaration itself.
 * `A[Start]:::emphasis`, `A{Is it ready?}:::emphasis`.
 *
 * Groups are `id`, `label`, `definitionName` in every one of them, which is
 * what lets `readNodeDeclaration` read them all with one body.
 *
 * `LABEL_CONTENT` still reads a bracket's label loosely, but it no longer
 * gets first refusal on the line: `UNIMPLEMENTED_LABEL_FORMS` is asked
 * first, and the one form it names never reaches here. Widening these
 * patterns without reading that one re-opens the bug that comment exists to
 * close.
 */
const NODE_PATTERNS = NODE_SPELLINGS.map(({ shape, bracket }) => ({
  shape,
  re: new RegExp(String.raw`^(\w+)\s*${bracket}\s*(?::::(\w+))?\s*$`),
}));

/**
 * Everything Mermaid writes *inside* `[...]` that is **still** not a plain
 * label, paired with the name Mermaid gives it. **No node shape is left
 * here.** The four slanted forms left when `NODE_SPELLINGS` learned to read
 * them, the subroutine box left when it did, and the cylinder — the last of
 * them, and the row this list was first written for — left with the three
 * shapes drawn with a curve. What remains is one *label* form, which is why
 * this no longer says "bracket forms": the shapes it was named for are all
 * drawn.
 *
 * **This list is refused, not swallowed.** That is the policy, and it is the
 * whole reason this constant survives its last shape: while a construct is
 * unimplemented, reject it — never render something else in its place.
 * `NODE_RE`'s `[^\]]*` used to take any bracket content as a label, so
 * `A[(DB)]` drew a rectangle labelled `(DB)` and said nothing. That
 * disguised *not implemented* as *supported*, and it hid the gap from
 * `src/compat/corpus.ts` — the instrument built to measure exactly this. A
 * mislabelled rectangle is a worse answer than a refusal, because the author
 * never learns anything is missing.
 *
 * The one row left is not a permanent refusal either. Its `described` is
 * written for the author who will read it: it names what Mermaid means, so
 * the answer is "wait" rather than "rewrite your line". Whoever implements
 * it deletes the row, and with it this constant, `unimplementedFormIn`,
 * `BRACKET_FORM_RE` and `refuseUnimplementedForm` — the plain quoted label
 * was a row here until quoting arrived, and `labelIn` is what replaced it.
 *
 * The form is anchored at **both ends** of the bracket content on purpose.
 * An over-tight pattern would be its own compatibility bug, traded for the
 * one it fixed: `A[a/b]`, `A[x (y)]`, `A[100%]` and `A[say "hi" now]` are
 * ordinary labels that merely *contain* a character a form also opens with,
 * and they still draw as rectangles.
 */
const UNIMPLEMENTED_LABEL_FORMS: ReadonlyArray<{
  open: string;
  close: string;
  described: string;
}> = [
  // A Markdown string, which is the label fence with backticks inside it.
  // Read before `labelIn` strips that fence, so an author who wrote
  // Markdown is told about Markdown rather than handed a label with
  // backticks and asterisks in it — half-implementing the feature would
  // draw `**bold**` where Mermaid draws bold text, which is the swallow
  // this whole list exists to refuse.
  {
    open: '"`',
    close: '`"',
    described: "a Markdown string label (a quoted label fenced in backticks)",
  },
];

/**
 * What Mermaid means by this bracket content, when it means something Siren
 * does not draw yet — as the prose a diagnostic quotes. `null` when the
 * content is an ordinary label, which is the common case.
 *
 * The length test is what keeps the fences from overlapping themselves:
 * `A[/]` is a label reading `/`, not an empty parallelogram.
 */
function unimplementedFormIn(content: string): string | null {
  for (const form of UNIMPLEMENTED_LABEL_FORMS) {
    if (
      content.length >= form.open.length + form.close.length &&
      content.startsWith(form.open) &&
      content.endsWith(form.close)
    ) {
      return form.described;
    }
  }
  return null;
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
 * there is one. Ordinary content is returned untouched, which is the common
 * case.
 */
function labelIn(content: string): string {
  const fenced = FENCED_LABEL_RE.exec(content);
  return fenced === null ? content : fenced[1];
}

/**
 * A node written with brackets, read **greedily**: the content is whatever
 * lies between the first `[` and the last `]`.
 *
 * It accepts nothing — the patterns above still decide what a node
 * declaration is. This pattern exists only to ask what the author meant,
 * which needs the greedy read those deliberately do not have: a form whose
 * content carries a `]` of its own is invisible to `LABEL_CONTENT`, so
 * without this it would fall all the way through to "unrecognized line"
 * rather than to a diagnostic naming the shape Mermaid means.
 */
const BRACKET_FORM_RE = /^\w+\s*\[(.*)\]\s*(?::::\w+)?\s*$/;

/**
 * The bare `A:::emphasis` shorthand — the same application written without a
 * label. It stays a pattern of its own so that a bare `A` on a line by
 * itself keeps being an unrecognized line rather than silently declaring a
 * node: what makes this a declaration is the `:::`.
 */
const NODE_CLASS_RE = /^(\w+)\s*:::(\w+)\s*$/;

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
const ENDPOINT_PATTERNS = NODE_SPELLINGS.map(({ shape, bracket }) => ({
  shape,
  re: new RegExp(String.raw`^(\w+)\s*${bracket}(?:\s*:::(\w+))?$`),
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
const BARE_ENDPOINT_RE = /^(\w+)(?:\s*:::(\w+))?$/;

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
const FROM_MARKER = String.raw`<|(?<!\w)[ox]`;
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
 * Siren's ids are `\w+` and cannot spell `a.-b` under either reading, so
 * what the guard buys is not that document but the *diagnostic*: it is
 * refused rather than quietly redrawn.
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
 * all, measured, exactly as `Ax--xB` already was.
 *
 * **Only a run's start needs it**, which is why there are two constants
 * rather than one guarded body everywhere. An inline label's closer cannot
 * begin inside an id, because the id ended at the opener that started the
 * run — so `A -. yes.-> B` and `A -.yes.-> B` are edges labelled "yes" in
 * Mermaid, measured, exactly as the solid `A -- yes--> B` is. Guarding the
 * closer too refused both, and refused them for the dotted stroke alone,
 * which is a rule no author could predict.
 */
const RUN_OPENING_DOTTED_BODY = String.raw`(?:-|(?<=(?<!\w)[ox])|(?<!\w))\.+-`;

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
  String.raw`(${FROM_MARKER})?((?=[-=.]{2}[-=.>ox])(?:-{2,}|={2,})|${dottedBody})(${TO_MARKER})?`;

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
const ARROW_PARTS_RE = new RegExp(`^${ARROW_TOKEN}$`);

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
 * `style A fill:#fdd;position:fixed,stroke:#c00` leaves it holding
 * `fill:#fdd` and invents a **node** called `position:fixed,stroke:#c00` —
 * which is a silent mis-render, the exact failure mode this board exists to
 * remove. Siren instead hands the whole list to `resolveStyles`, whose gate
 * refuses a value containing `;` by name: "would smuggle in a second
 * declaration". Splitting here would delete that diagnostic and quietly
 * apply the half of the value that came first.
 *
 * A `;` that merely *trails* such a statement is still spare, so
 * `classDef hot fill:#fdd;` reads as `classDef hot fill:#fdd` does.
 */
const DECLARATION_LIST_RE = /^(?:style|classDef|linkStyle)\s/;

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
  const label = pipeLabel === undefined ? null : edgeLabelIn(pipeLabel);
  if (label === "") {
    // `A -->|""| B`: a fence with nothing in it is not a label an author
    // can write, and reading it as an unlabelled edge would be the silent
    // mis-render this parser refuses everywhere else.
    return null;
  }

  const dots = body.length - body.replace(/\./g, "").length;
  const line: EdgeLine = dots > 0 ? "dotted" : body.startsWith("=") ? "thick" : "solid";
  // Past the shortest spelling: `-->` (three characters, one of them the
  // marker) and `---` are both one rank, so an unmarked body is measured
  // against three characters and a marked one against two plus its marker.
  const minLength = dots > 0 ? dots : body.length - (end === undefined ? 2 : 1);
  if (minLength < 1) {
    return null;
  }

  const toEnd = end === undefined ? "none" : END_FOR_MARKER[end];
  if (start === undefined) {
    return { line, fromEnd: "none", toEnd, minLength, label };
  }
  if (end === undefined || start !== OPENING_MARKER[end]) {
    return null;
  }
  return { line, fromEnd: toEnd, toEnd, minLength, label };
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
  const label = edgeLabelIn(text);
  return label === "" ? null : { ...form, label };
}

/**
 * The label an author wrote on an edge, with the fence removed and the
 * padding dropped.
 *
 * Trimmed, unlike a node's label, and the difference is Mermaid's rather
 * than a choice made here: an edge label reaches Mermaid's own database
 * already trimmed in every spelling — `A -->|  yes  | B`,
 * `A --   yes   --> B` and `A -->|"  yes  "| B` all record `text="yes"`,
 * measured. A node's label does not (`fc-text-label-whitespace`), and that
 * divergence is a corpus row rather than a precedent to spread.
 *
 * Trimmed on both sides of the fence, so the padding an author put inside
 * the quotes and the padding they put outside them are dropped alike.
 */
function edgeLabelIn(content: string): string {
  return labelIn(content.trim()).trim();
}

/** One place a node was written on an edge line, as written there. */
interface EdgeEndpoint {
  id: string;
  label: string | undefined;
  definitionName: string | undefined;
  /**
   * The shape its spelling named. `"rect"` for a bare mention, which is
   * what a bare mention has always meant — it is now said rather than
   * assumed.
   */
  shape: NodeShape;
}

/**
 * One endpoint, or `null` when the text is not one — which refuses the
 * statement it came from rather than half of it.
 *
 * The bracket spellings are tried before the bare form, since only they can
 * carry a label; the bare form is what is left.
 */
function readEndpoint(text: string): EdgeEndpoint | null {
  const trimmed = text.trim();
  for (const { shape, re } of ENDPOINT_PATTERNS) {
    const match = re.exec(trimmed);
    if (match !== null) {
      return { id: match[1], label: match[2], definitionName: match[3], shape };
    }
  }
  const bare = BARE_ENDPOINT_RE.exec(trimmed);
  if (bare === null) {
    return null;
  }
  return { id: bare[1], label: undefined, definitionName: bare[2], shape: "rect" };
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
    if (match !== null) {
      return { id: match[1], label: match[2], definitionName: match[3], shape };
    }
  }
  return null;
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
 * Cuts `text` at every `separator` that lies **outside** a `[...]` label,
 * returning both the pieces and the separators that cut them.
 *
 * The separators are returned because one of the three callers cares what
 * cut its line: `;` and `&` are single characters that mean one thing, but
 * an arrow is a **pattern**, and `A --> B -.-> C` is cut by two different
 * tokens carrying two different pictures. A cutter that returned only the
 * pieces would leave that caller re-finding the tokens it had already
 * matched.
 *
 * The label depth is the whole point. `;`, `&` and `-->` all mean
 * something between statements and nothing inside a label: `A[a;b]`,
 * `A[a&b]` and `A[a-->b]` are ordinary labels in Mermaid, and a splitter
 * that did not know where a label starts would cut them into nonsense —
 * the same class of bug `UNIMPLEMENTED_LABEL_FORMS` exists to keep out.
 *
 * **A brace opens a label as surely as a bracket does, and so does a
 * parenthesis.** Counting only `[`/`]` made three spellings of one idea
 * disagree: `A["a-->b"]` worked while `A{a-->b}` and `A(a-->b)` — a diamond
 * and a round node, both labelled `a-->b` in mermaid 11.17.2, measured with
 * `scripts/mermaid-probe.mjs` — were cut at the arrow and refused. One
 * depth over all three pairs is what makes them agree, and it has to be a
 * depth rather than a flag because `A{{a-->b}}` opens two and `A([a-->b])`
 * opens one of each.
 *
 * Depth alone is not enough once a label may be fenced, which is why the
 * fence is tracked here too: the `]` inside `A["a]b-->c"]` is a character
 * of the label, and a splitter that counted it would come back out to
 * depth 0 and then cut the line at the `-->` that is also part of it.
 *
 * The fence only fences **inside** a bracket, which is where Mermaid's
 * grammar has a string at all. That is what leaves `DECLARATION_LIST_RE`'s
 * divergence untouched: a `"` in `style A fill:"#fdd;x"` is not a fence,
 * so the `;` there still reaches the security gate that refuses it.
 *
 * Always returns at least one piece, and one fewer separator than pieces,
 * and never trims: a caller that needs a column needs the offsets left
 * alone.
 */
function cutOutsideLabel(
  text: string,
  separator: string | RegExp,
): { parts: string[]; separators: string[] } {
  const parts: string[] = [];
  const separators: string[] = [];
  let depth = 0;
  let fenced = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (depth > 0 && text[i] === LABEL_FENCE) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    if (text[i] === "[" || text[i] === "{" || text[i] === "(") {
      depth++;
      continue;
    }
    if (text[i] === "]" || text[i] === "}" || text[i] === ")") {
      if (depth > 0) {
        depth--;
      }
      continue;
    }
    if (depth === 0) {
      const cut = separatorAt(text, i, separator);
      if (cut !== null) {
        parts.push(text.slice(start, i));
        separators.push(cut);
        i += cut.length - 1;
        start = i + 1;
        continue;
      }
      if (separator !== ARROW_RE) {
        // **An arrow's own label is a label.** The two edge-label spellings
        // put the author's text where the grammar reads its punctuation,
        // and a `;` there is a character rather than the end of a
        // statement: mermaid 11.17.2 reads `A -- a;b --> B` as one edge
        // labelled `a;b`, measured. Statements are split before arrows are
        // found, so without this the label is two half-statements and two
        // diagnostics.
        //
        // Stepping over the whole run rather than tracking a depth,
        // because an edge label has no closing character of its own to
        // count: `-->|a;b|` and `-- a;b -->` are each one token, and
        // `ARROW_RE` is the one statement of where they end.
        const arrow = separatorAt(text, i, ARROW_RE);
        if (arrow !== null) {
          i += arrow.length - 1;
        }
      }
    }
  }
  parts.push(text.slice(start));
  return { parts, separators };
}

/** `cutOutsideLabel` for the two callers whose separator says nothing worth keeping. */
function splitOutsideLabel(text: string, separator: string): string[] {
  return cutOutsideLabel(text, separator).parts;
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
      statements.push({ text, column });
    }
    offset += piece.length + STATEMENT_END.length;
  }
  return statements;
}

/**
 * The opening statement of a `subgraph` block, and everything the author
 * wrote after the keyword. What that tail *means* is `readSubgraphTitle`'s;
 * this pattern only says a block opens here.
 *
 * Split in two because the tail has three spellings and only one of them is
 * a bare word — a single pattern would either have to alternate three ways
 * inline or, worse, accept a tail it cannot read and lose the diagnostic.
 */
const SUBGRAPH_OPEN_RE = /^subgraph\s+(\S.*)$/;

/** The statement that closes a `subgraph` block. Mermaid's own keyword, lowercase. */
const SUBGRAPH_END = "end";

/**
 * `one[Two Words]` — the spelling that gives a subgraph a handle *and* a
 * title, and the only one where the two differ. Its content is read by the
 * same `LABEL_CONTENT` every node label goes through, so `subgraph
 * one["a, b"]` fences exactly as `A["a, b"]` does.
 */
const SUBGRAPH_TITLED_RE = new RegExp(String.raw`^(\w+)\s*\[(${LABEL_CONTENT})\]$`);

/**
 * A bare authored id and nothing else — `Ingest`, `A`.
 *
 * `\w+` is the shape every parser in this repo gives an id, and ADR-0010
 * leans on it: a `\w` cannot be a colon, which is what makes a generated id
 * unspellable by an authored one. Read in two places here, for two different
 * things that are both that shape — a subgraph written with a bare title
 * (mermaid 11.17.2 records it as both id and title) and a node written as
 * nothing but its id inside a block.
 */
const AUTHORED_ID_RE = /^\w+$/;

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
 * The middle one is why `name` is nullable rather than defaulted to the
 * title: Mermaid mints a handle the author never wrote and could not have
 * predicted, so there is no name here for anything to be addressed by.
 */
function readSubgraphTitle(
  tail: string,
): { name: string | null; label: string } | null {
  const titled = SUBGRAPH_TITLED_RE.exec(tail);
  if (titled !== null) {
    return { name: titled[1], label: labelIn(titled[2]) };
  }
  const fenced = FENCED_LABEL_RE.exec(tail);
  if (fenced !== null) {
    return { name: null, label: fenced[1] };
  }
  if (AUTHORED_ID_RE.test(tail)) {
    return { name: tail, label: tail };
  }
  return null;
}

/**
 * `direction LR` written inside a `subgraph` block — a per-cluster rank
 * direction, which Siren refuses by name rather than reading and dropping.
 *
 * Measured, not recalled: mermaid 11.17.2 records it as `dir="LR"` on that
 * subgraph and leaves the document's own direction where the header put it
 * (`scripts/mermaid-probe.mjs`). Honoring it means laying each subgraph out
 * as a diagram of its own and composing the results, because dagre carries
 * exactly one `rankdir` per graph and `layoutDirectedGraph` takes it as a
 * graph-level field. That is a layout feature of its own size.
 *
 * The alternative is not "ignore it". A group drawn top-to-bottom where the
 * author wrote left-to-right is the wrong picture with nothing in it to
 * notice — a silent mis-render by the compatibility corpus's own definition,
 * and the state this project's absolute condition exists to keep out. So the
 * line is named in a diagnostic and the document is refused, exactly as an
 * undrawn arrow spelling and an undrawn bracket form already are.
 *
 * Scoped to *inside* a block on purpose. At the top level of a flowchart
 * mermaid 11.17.2 accepts `direction LR` and ignores it — the recorded
 * direction stays `TB`, measured — so there is nothing there for Siren to be
 * behind on, and it stays an unrecognized line.
 */
const SUBGRAPH_DIRECTION_RE = /^direction\s+\w+$/;

/**
 * `style A fill:#fdd,stroke:#c00` — author styling applied directly to one
 * node, spelled exactly as a class diagram spells it.
 */
const STYLE_RE = /^style\s+(\w+)\s+(.+)$/;

/**
 * `classDef emphasis fill:#fdd` — a named set of declarations, applied to
 * nothing on its own, spelled exactly as a class diagram spells it.
 */
const CLASS_DEF_RE = /^classDef\s+(\w+)\s+(.+)$/;

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
 */
const LINK_STYLE_RE = /^linkStyle\s+([\w,\s]*[\w,])\s+(.+)$/;

/**
 * `class A,B emphasis` — this kind's spelling of the apply-directive, which
 * a class diagram spells `cssClass "A,B" emphasis`. Both normalize to the
 * one `apply` kind here, so no model, renderer or test downstream learns
 * that two spellings exist.
 *
 * The target list is greedy up to the trailing name: `[\w\s,]` swallows the
 * whole tail and backtracks until a bare `\w+` is left for the definition
 * name, which is what lets `class A, B emphasis` be read the same as
 * `class A,B emphasis` without a second pattern.
 */
const CLASS_APPLY_RE = /^class\s+([\w\s,]*[\w,])\s+(\w+)\s*$/;

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
export function parseFlowchart(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  const nodesById = new Map<string, SirenNode>();
  const edges: SirenEdge[] = [];
  const styles: StyleDecl[] = [];
  const linkStyles: LinkStyleDecl[] = [];
  const subgraphs: SirenSubgraph[] = [];
  let direction: Direction | null = null;
  let timeline: SirenTimeline | null = null;

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
   * Every edge statement, with the endpoint ids it named — kept so that an
   * edge addressing a subgraph can be refused after the whole document has
   * been read. It cannot be refused while the line is read: a subgraph may
   * legitimately be declared *below* the edge that names it.
   */
  const edgeStatements: { ids: string[]; text: string; line: number; column: number }[] = [];

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

  /**
   * Refuses one place a node was written, when what was written there is a
   * bracket form Siren does not draw yet — naming which one. `true` when the
   * line was refused, so the caller stops reading it.
   *
   * Shared by the two places a label can appear, for the reason
   * `addNodeAsWritten` is shared: where a node was written must not decide
   * what it means, so `A[(DB)] --> B` cannot quietly draw the cylinder that
   * `A[(DB)]` on a line of its own refuses.
   */
  const refuseUnimplementedForm = (
    content: string | undefined,
    line: string,
    lineNumber: number,
    column: number,
  ): boolean => {
    const form = content === undefined ? null : unimplementedFormIn(content);
    if (form === null) {
      return false;
    }
    diagnostics.push({
      severity: "error",
      message: `Siren does not draw ${form} yet: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
    return true;
  };

  const addNode = (
    id: string,
    label: string,
    shape: NodeShape,
    line: number,
    column: number,
  ) => {
    const existing = nodesById.get(id);
    if (existing === undefined) {
      nodesById.set(id, { id, label, shape, line, column });
      return;
    }
    if (existing.label !== label) {
      diagnostics.push({
        severity: "warning",
        message: `Node "${id}" redeclared with a different label ("${existing.label}" kept, "${label}" ignored)`,
        line,
        column,
      });
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
   * labelled mention goes through `addNode` and can raise the redeclaration
   * warning; an unlabelled one only applies, so it declares the node just
   * when nothing else has and leaves a label written elsewhere for that id
   * alone. That second rule is ticket 04's, for the standalone `A:::name`,
   * and an edge's bare endpoint has always followed it — they are one rule
   * written once here rather than two copies free to drift.
   *
   * `label` is bracket content as written, so the fence comes off here —
   * once, for every place a label can appear, which is why `A["x, y"]` on
   * a line of its own and at an edge endpoint cannot disagree about what
   * the author wrote.
   */
  const addNodeAsWritten = (
    { id, label, definitionName, shape }: EdgeEndpoint,
    line: number,
    column: number,
  ) => {
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
    if (innermost !== undefined && !claimedNodeIds.has(id)) {
      claimedNodeIds.add(id);
      innermost.subgraph.nodeIds.push(id);
    }
    if (label !== undefined) {
      addNode(id, labelIn(label), shape, line, column);
    } else if (!nodesById.has(id)) {
      nodesById.set(id, { id, label: id, shape, line, column });
    }
    if (definitionName !== undefined) {
      applyAtDeclaration(id, definitionName, line, column);
    }
  };

  // Labelled because a line is no longer necessarily one statement: two of
  // the branches below end the whole document rather than the statement,
  // and they have to say which loop they mean.
  readLines: for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNumber = i + 1;

    for (const statement of splitStatements(rawLine)) {
      const line = statement.text;
      const column = statement.column;

      if (mode === "before-header") {
        const headerDirection = matchFlowchartHeader(line);
        if (headerDirection === null) {
          diagnostics.push({
            severity: "error",
            message: `Expected ${listAcceptedHeaders()}, found "${line}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          break readLines;
        }
        direction = headerDirection;
        mode = "flowchart";
        continue;
      }

      if (isTimelineHeader(line)) {
        // Once the block is open it runs to the end of the document, so the
        // header is read once and never looked for again — a second
        // `timeline:` is a line inside the block, which the shared grammar
        // reports as unrecognized exactly as it does for the other two kinds.
        // Draining is `parseTimelineBody`'s job; what stays here is only this
        // parser's own decision: where the block starts, and that a diagnostic
        // inside it costs the whole document.
        const { entries, diagnostics: bodyDiagnostics } = parseTimelineBody(
          lines,
          i + 1,
        );
        diagnostics.push(...bodyDiagnostics);
        // Every diagnostic the shared grammar reports is error-severity, so a
        // non-empty list is exactly the old per-branch `sawError = true`.
        if (bodyDiagnostics.length > 0) {
          sawError = true;
        }
        timeline = { entries };
        break readLines;
      }

      // Asked before the line is cut at its arrows, because a title is a
      // place where an arrow means nothing: `subgraph "A --> B"` is one
      // block with a punctuated name, not a malformed edge.
      const subgraphOpenMatch = SUBGRAPH_OPEN_RE.exec(line);
      if (subgraphOpenMatch !== null) {
        const title = readSubgraphTitle(subgraphOpenMatch[1]);
        if (title === null) {
          diagnostics.push({
            severity: "error",
            message: `Unrecognized flowchart line: "${line}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }
        const subgraph: SirenSubgraph = {
          name: title.name,
          label: title.label,
          nodeIds: [],
          subgraphs: [],
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

      if (line === SUBGRAPH_END && openBlocks.length > 0) {
        openBlocks.pop();
        continue;
      }

      if (openBlocks.length > 0 && SUBGRAPH_DIRECTION_RE.test(line)) {
        diagnostics.push({
          severity: "error",
          message: `Siren does not lay a subgraph out in its own direction yet: "${line}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
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
      const { parts: arrowParts, separators: arrowTokens } = DECLARATION_LIST_RE.test(line)
        ? { parts: [line], separators: [] as string[] }
        : cutOutsideLabel(line, ARROW_RE);
      if (arrowParts.length > 1) {
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
            message: `Malformed edge: missing target after "${arrowTokens[arrowTokens.length - 1]}" in "${line}"`,
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
            message: `Siren does not draw the arrow "${unreadable}" yet: "${line}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }

        // A group per arrow-separated piece: one end of an arrow may name
        // several nodes, `A & B --> C`.
        const groups: (EdgeEndpoint | null)[][] = arrowParts.map((part) =>
          splitOutsideLabel(part, GROUP_SEPARATOR).map(readEndpoint),
        );
        if (groups.flat().some((endpoint) => endpoint === null)) {
          // One unreadable endpoint refuses the whole statement — the rule
          // `ENDPOINT_RE` is anchored for. Nothing has been declared yet, so
          // there is no half-drawn chain to take back.
          diagnostics.push({
            severity: "error",
            message: `Unrecognized flowchart line: "${line}"`,
            line: lineNumber,
            column,
          });
          sawError = true;
          continue;
        }

        // Every endpoint read, so the casts below are the narrowing the
        // check above earned.
        const chain = groups as EdgeEndpoint[][];
        const written = chain.flat();

        // Asked of every endpoint before any of them is declared, so a shape
        // written anywhere on the line refuses the line rather than leaving
        // the endpoints before it drawn. `some` stops at the first, which is
        // one diagnostic per statement.
        if (
          written.some((endpoint) =>
            refuseUnimplementedForm(
              // Only a `[...]` label can carry one of those forms. The
              // punctuation another spelling fences is that spelling's own
              // content: mermaid 11.17.2 reads `A{"(DB)"}` as a diamond
              // labelled `(DB)`, not as a cylinder, so asking this of a
              // brace's label would refuse a document Mermaid draws.
              endpoint.shape === "rect" ? endpoint.label : undefined,
              line,
              lineNumber,
              column,
            ),
          )
        ) {
          continue;
        }

        edgeStatements.push({
          ids: written.map((endpoint) => endpoint.id),
          text: line,
          line: lineNumber,
          column,
        });

        // Declared once each, left to right as written — before any edge, so
        // a `:::` on an endpoint two arrows along applies exactly once rather
        // than once per link it takes part in.
        for (const endpoint of written) {
          addNodeAsWritten(endpoint, lineNumber, column);
        }
        // Sources outermost, which is Mermaid's order: `FlowDB.addLink` is
        // `for (const start of _start) for (const end of _end)`, so
        // `A & B --> C & D` is A-C, A-D, B-C, B-D.
        for (let link = 0; link + 1 < chain.length; link++) {
          // Every edge of one link wears that link's own arrow: in
          // `A & B -.-> C` both edges are dotted, and in `A --> B ==> C` the
          // second is thick and the first is not.
          const arrow = arrows[link]!;
          for (const from of chain[link]) {
            for (const to of chain[link + 1]) {
              edges.push({
                from: from.id,
                to: to.id,
                ...arrow,
                sourceLine: lineNumber,
                sourceColumn: column,
              });
            }
          }
        }
        continue;
      }

      const classDefMatch = CLASS_DEF_RE.exec(line);
      if (classDefMatch !== null) {
        // A definition targets nothing: which nodes end up with it is decided
        // by whoever applies it, in `resolveStyles`' own pass. Checked before
        // `style` and before a node declaration only because it is the more
        // specific keyword, not because the order can matter.
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
          targetIds: splitTargetIds(classApplyMatch[1]),
          name: classApplyMatch[2],
          properties: [],
          line: lineNumber,
          column,
        });
        continue;
      }

      const linkStyleMatch = LINK_STYLE_RE.exec(line);
      if (linkStyleMatch !== null) {
        // The address goes through untouched — see `LINK_STYLE_RE`. The
        // declarations do not: they are read by the same splitter `style` and
        // `classDef` use, so all three statements accept one declaration list
        // and diagnose a bad segment in one wording.
        linkStyles.push({
          targets: splitTargetIds(linkStyleMatch[1]),
          properties: readStyleProperties(linkStyleMatch[2], lineNumber, column),
          line: lineNumber,
          column,
        });
        continue;
      }

      const styleMatch = STYLE_RE.exec(line);
      if (styleMatch !== null) {
        // Naming a node in a `style` statement does not declare it: styling is
        // about something that already exists, and whether it does is
        // `resolveStyles`' question, asked once against the model's ids.
        //
        // `targetIds` holds the one node this statement targets. It is a
        // list because the apply-directive targets many.
        styles.push({
          styleKind: "style",
          authoredAs: "style",
          targetIds: [styleMatch[1]],
          name: null,
          properties: readStyleProperties(styleMatch[2], lineNumber, column),
          line: lineNumber,
          column,
        });
        continue;
      }

      const bracketFormMatch = BRACKET_FORM_RE.exec(line);
      if (bracketFormMatch !== null) {
        // Asked before `NODE_RE`, because `NODE_RE` would take the form's own
        // punctuation as a label — which is the swallow this refuses.
        if (
          refuseUnimplementedForm(
            bracketFormMatch[1],
            line,
            lineNumber,
            column,
          )
        ) {
          continue;
        }
      }

      const declared = readNodeDeclaration(line);
      if (declared !== null) {
        addNodeAsWritten(declared, lineNumber, column);
        continue;
      }

      const nodeClassMatch = NODE_CLASS_RE.exec(line);
      if (nodeClassMatch !== null) {
        const [, id, definitionName] = nodeClassMatch;
        // Written without a label and without a bracket, so it applies a
        // definition, claims no label and names no shape — `addNodeAsWritten`
        // holds what that means, for this spelling and for an edge's bare
        // endpoint alike.
        addNodeAsWritten(
          { id, label: undefined, definitionName, shape: "rect" },
          lineNumber,
          column,
        );
        continue;
      }

      // A bare id inside a block, which is how a node with no edges joins a
      // group. mermaid 11.17.2 records it as a vertex *and* a member of that
      // block, measured with `scripts/mermaid-probe.mjs`.
      //
      // **The block scope is Siren's own, not Mermaid's — and this comment
      // used to claim the opposite, citing the probe while it did.** It said
      // Mermaid "records nothing at all" for a bare id at the top level.
      // That is false, re-measured three ways: `flowchart TB / Orphan /
      // A --> B` records the vertices `Orphan`, `A` and `B`, and
      // `flowchart TB / Orphan` on its own records `Orphan`. A bare id is a
      // vertex declaration there exactly as it is in here.
      //
      // So the top-level form is a construct Mermaid draws and Siren refuses,
      // falling through to the `Unrecognized flowchart line` below and taking
      // the whole document down with it. That gap is honest backlog and it
      // has a row — **`fc-stmt-bare-node` in `src/compat/corpus.ts`**, which
      // carries the measurement so the next reader finds it rather than
      // re-deriving it. Its exit is widening this condition; it is not
      // another measurement, and nothing here is already correct.
      //
      // Left as backlog rather than widened in passing, because dropping the
      // `openBlocks` guard changes which lines a whole document may contain,
      // and this branch is asked last precisely so that nothing meaning
      // something else is swallowed as a node. Whoever widens it owns
      // re-checking that, which is a ticket rather than an edit.
      //
      // It claims no label and names no shape, exactly as an edge's bare
      // endpoint does; `addNodeAsWritten` holds what that means for both.
      //
      // Asked last, after every keyword and every other spelling, so nothing
      // that means something else can be swallowed as a node — `end` and
      // `A:::name` are both `\w`-only lines and both have already been read
      // by the branches above.
      if (openBlocks.length > 0 && AUTHORED_ID_RE.test(line)) {
        addNodeAsWritten(
          { id: line, label: undefined, definitionName: undefined, shape: "rect" },
          lineNumber,
          column,
        );
        continue;
      }

      diagnostics.push({
        severity: "error",
        message: `Unrecognized flowchart line: "${line}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
      continue;
    }
  }

  // An edge whose endpoint names a subgraph, refused rather than drawn.
  //
  // Mermaid draws this: `One --> Two`, where both are subgraphs, is an edge
  // between the two *frames* — mermaid 11.17.2 records vertices for both
  // names alongside the subgraphs and its renderer joins the clusters
  // (measured). Siren has no such routing, and left alone it would declare
  // two ordinary nodes and draw a box labelled `One` beside the frame of the
  // same name, with no diagnostic at all. That is a `silently-wrong` case
  // this ticket would have *created*, and the corpus's policy on those says
  // their destination is zero — so it is refused by name and recorded as
  // backlog instead.
  //
  // Asked after the whole document has been read, because a subgraph may be
  // declared below the edge that names it, and one diagnostic per statement
  // rather than per endpoint.
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

  for (const statement of edgeStatements) {
    const named = statement.ids.find((id) => subgraphNames.has(id));
    if (named === undefined) {
      continue;
    }
    diagnostics.push({
      severity: "error",
      message: `Siren does not draw an edge to the subgraph "${named}" yet: "${statement.text}"`,
      line: statement.line,
      column: statement.column,
    });
    sawError = true;
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
    timeline,
  };

  return { document, diagnostics };
}
