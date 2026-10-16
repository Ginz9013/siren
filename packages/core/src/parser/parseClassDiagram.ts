import type {
  ClassDecl,
  Direction,
  ClassDocument,
  Interaction,
  ClassMember,
  ClassMemberClassifier,
  ClassMemberVisibility,
  ClassNamespace,
  ClassNote,
  ClassRelationship,
  ClassRelationshipEnd,
  DiagramParseResult,
  Diagnostic,
  Label,
  NamedTimeline,
  SirenTimeline,
  StyleDecl,
  StyleProperty,
} from "../contracts";
import { readLabelAt } from "../label/readLabelAt";
import { parseStyleProperties } from "./parseDeclarationList";
import { listAcceptedHeaders, matchClassDirection, matchDiagramHeader } from "./parseDirection";
import { readAccDescrBlock } from "./readAccDescrBlock";
import { isTimelineHeader, namedTimelinesField, parseTimelineBlocks } from "./parseTimelineBlock";
import { headerPercentError, midLinePercentError } from "./midLinePercent";


/**
 * `accTitle: text`, `accDescr: text` and the opening of the braced
 * `accDescr { ... }`. Whitespace may stand before the colon; **lower case
 * only**, because a class diagram's acc rules are not `/i` in Mermaid
 * 12.2.0 — `ACCTITLE: T` is a class with a member there (01M4WVVN9).
 */
const ACC_TITLE_RE = /^accTitle\s*:\s*(.+)$/;
const ACC_DESCR_RE = /^accDescr\s*:\s*(.+)$/;
const ACC_DESCR_BLOCK_RE = /^accDescr\s*\{/;
/**
 * The headers this parser accepts, asked for by kind rather than written out
 * — both spellings, from the list the dispatcher routes by. Hand-writing
 * them is what let `parseSiren` teach only `classDiagram` while this parser
 * quietly took `classDiagram-v2` as well.
 */
const CLASS_HEADER_SPELLINGS = listAcceptedHeaders(["class"]);
/**
 * The optional bracketed label a class or a namespace may carry,
 * `["label"]`, as a pattern fragment with one capture: the label without the
 * padding inside its quotes, and never empty (`[""]` is a parse error in
 * Mermaid, measured). Written once for the three patterns that take it.
 */
const BRACKETED_LABEL = String.raw`(?:\["\s*([^"]*\S)\s*"\])?`;

/**
 * The optional `:::name` a class declaration may end with, attaching a
 * `classDef` to the class it declares — one capture, the class name.
 *
 * Measured on mermaid 12.2.0: it follows the name, a `~generic~` or a
 * `["label"]`, with or without spaces on either side of the `:::`, in the
 * bare and the block form alike. Everywhere else Mermaid parse-errors on
 * it — a relationship end, a bare `X:::c`, the inline member form, after a
 * `<<annotation>>`, a list (`:::a,b`), a second `:::`, a hyphenated name —
 * so this fragment is spliced into the declaration patterns only, and every
 * other `:::` falls through to the unrecognized-line diagnostic.
 */
const STYLE_SHORTHAND = String.raw`(?:\s*:::\s*(\w+))?`;

/**
 * A bare `class Animal` declaration, with an optional `~generic~`
 * parameter after the name (`class Square~Shape~`) and an optional
 * bracketed label after that (`class Order["Order Line"]`).
 *
 * The generic capture is greedy on purpose: it runs to the *last* `~` on
 * the line, so a nested parameter such as `class Shelf~Map~String, List~int~~~`
 * parses with `Map~String, List~int~~` captured whole rather than being
 * rejected. Nested generics are therefore supported, not diagnosed.
 *
 * The label is captured without the padding inside its quotes and must hold
 * something else: `class A[""]` is a parse error in Mermaid (measured), so
 * it falls through to this parser's unrecognized-line diagnostic. Measured
 * too: a space may stand between the name and the `[`, and the label goes
 * after the generic and never before it (`class A["Lab"]~T~` is a parse
 * error). Compiled with `d` so the label's own column is the group's index.
 */
const CLASS_DECL_RE = new RegExp(
  String.raw`^class\s+(\w+)(?:~(.+)~)?\s*${BRACKETED_LABEL}${STYLE_SHORTHAND}\s*$`,
  "d",
);
/**
 * The opening line of a block-form declaration, `class Animal {`, with the
 * same optional generic, label and `:::name`. What follows the `{` on its
 * line is the block's first member line (the last capture): Mermaid 12.2.0
 * reads `class A { +int x` with the member `+int x`, and `class A { %% x`
 * with the member "%% x" — its block state has no comment rule (measured).
 * A `}` on the line closes the block there, its text after it the sixth
 * capture: `class A { +int x }` and `class A {}` are whole blocks to
 * Mermaid, which reads members up to a `}` wherever it stands (measured).
 */
const CLASS_BLOCK_OPEN_RE = new RegExp(
  String.raw`^class\s+(\w+)(?:~(.+)~)?\s*${BRACKETED_LABEL}${STYLE_SHORTHAND}\s*\{([^}]*)(?:\}(.*))?$`,
  "d",
);
/**
 * A relationship statement: two class names, the relation token between
 * them, an optional quoted multiplicity beside each name, and an optional
 * `: label`.
 *
 * The relation token is matched as three independent parts — an optional
 * left marker, the line (`--` solid or `..` dashed), and an optional right
 * marker — rather than as an alternation of Mermaid's eight named forms.
 * That is the same decomposition the model uses, so every spelling
 * Mermaid allows, including each form's mirror image (`--|>` for `<|--`)
 * and two-headed combinations (`<|--|>`), parses without a table of
 * special cases.
 *
 * Compiled with `d`, so the label's column is its group's own index.
 */
const RELATIONSHIP_RE =
  /^(\w+)(?:\s+"([^"]*)")?\s*(<\|?|\*|o|\(\))?\s*(--|\.\.)\s*(\|>|>|\*|o|\(\))?\s*(?:"([^"]*)"\s+)?(\w+)\s*(?::\s*(.*))?$/d;

/**
 * An annotation on its own line inside a class block, `<<interface>>`.
 * The text between the guillemets is whatever the author chose — Mermaid
 * gives `interface`, `abstract`, `enumeration` and `service` their own
 * styling but accepts any word.
 */
const ANNOTATION_RE = /^<<(.+)>>$/;
/** The standalone form of the same thing, `<<interface>> Shape`. */
const STANDALONE_ANNOTATION_RE = /^<<(.+)>>\s+(\w+)$/;

/**
 * The opening line of a `namespace BaseShapes {` block, with an optional
 * bracketed label after the name — `namespace Zoo["Big Zoo"] {` — spelled
 * and bounded exactly as a class's (`CLASS_DECL_RE`), all of it measured
 * the same way: a space may stand before the `[`, and `[""]` is a parse
 * error in Mermaid.
 *
 * The name may be dotted, `namespace N.M {`, each segment a `\w+` and a
 * space either side of a dot allowed, as Mermaid 12.2.0 reads it (measured).
 * A space between two words (`namespace N M {`) matches too, for the caller
 * to refuse at the name (`NAME_SPACE_RE`), as does an empty segment (`.N`,
 * `N.`, `N..M`).
 *
 * What follows the `{` on its line is the body's first statement (the
 * third capture): Mermaid 12.2.0 reads `namespace N { class A }` as N
 * holding A, its `}` closing the namespace wherever it stands (measured).
 * A `%%` there is no statement — `namespace N { %% x` is refused at it —
 * so a line with one does not open a namespace here.
 */
const NAMESPACE_OPEN_RE = new RegExp(
  String.raw`^namespace\s+((?=[\w.])\w*(?:\s*\.(?:\s*\w+)?|\s+\w+)*)\s*${BRACKETED_LABEL}\s*\{(?!\s*%%)(.*)$`,
  "d",
);

/**
 * A space between two words of a namespace name. Mermaid 12.2.0 drops it,
 * reading `namespace N M {` as the one namespace `NM` (measured: a frame
 * titled `NM`) — a name nobody wrote, with no diagnostic — so it is refused
 * (ADR-0001). A space beside a dot is none (`N . M` is `N.M`), so it is not
 * matched here.
 */
const NAME_SPACE_RE = /(?<=\w)\s+(?=\w)/g;

/**
 * The index of the first `}` in `text` that closes no `{` opened before it
 * on the same text, outside double quotes, or -1. On a namespace's line it
 * is the namespace's own `}`: `class A { +x } }` closes the class block,
 * then the namespace, and `class A["a}"] }` keeps its label's `}`
 * (measured on Mermaid 12.2.0).
 */
function unmatchedClosingBrace(text: string): number {
  let depth = 0;
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === "{") depth++;
    else if (char === "}") {
      if (depth === 0) return at;
      depth--;
    }
  }
  return -1;
}

/**
 * A free note, `note "text"`. Its text is quoted, as Mermaid requires, and
 * read as a label — see `ClassNote.label`. Both note patterns are compiled
 * with `d`, so the label's column is its group's own index.
 */
const NOTE_RE = /^note\s+"([^"]*)"$/d;
/**
 * A note attached to one class, `note for Duck "text"`. Naming a class
 * here does not declare it — only a relationship does that — so a note for
 * a class that was never declared is `buildClassModel`'s to resolve.
 */
const NOTE_FOR_RE = /^note\s+for\s+(\w+)\s+"([^"]*)"$/d;

/** A `direction TB|BT|LR|RL` statement. */

/**
 * `click Shape href "https://example.com"`, with Mermaid's optional
 * trailing tooltip string.
 *
 * The URL is captured as written. Whether it is a URL this renderer is
 * willing to emit — the `http`/`https`/`mailto` allowlist that rejects
 * `javascript:` and `data:` — is deliberately *not* decided here; see the
 * note on `parseClassDiagram` about where that check lives.
 */
const CLICK_HREF_RE = /^click\s+(\w+)\s+href\s+"([^"]*)"(?:\s+"([^"]*)")?$/;

/**
 * `click Shape call callbackFn()`, with an optional literal argument and
 * Mermaid's optional trailing tooltip: `click Shape call fn("arg") "tip"`.
 *
 * The argument is captured as one raw string rather than a parsed list —
 * `Interaction.argument` is a single string, and a caller-supplied
 * handler receives whatever the author wrote.
 */
const CLICK_CALL_RE = /^click\s+(\w+)\s+call\s+(\w+)\(([^)]*)\)(?:\s+"([^"]*)")?$/;

/**
 * `callback Shape "callbackFn"` and `link Shape "https://example.com"` —
 * Mermaid's older spellings of `click ... call` and `click ... href`, each
 * with the same optional trailing tooltip. They produce the same
 * `Interaction` shapes as their `click` equivalents: they are
 * spellings, not separate concepts.
 */
const CALLBACK_RE = /^callback\s+(\w+)\s+"([^"]*)"(?:\s+"([^"]*)")?$/;
const LINK_RE = /^link\s+(\w+)\s+"([^"]*)"(?:\s+"([^"]*)")?$/;

/**
 * `style Shape fill:#fdd,stroke:#c00` — author styling applied directly to
 * one class.
 */
const STYLE_RE = /^style\s+(\w+)\s+(.+)$/;

/**
 * `classDef emphasis fill:#fdd` — a named set of declarations, applied to
 * nothing on its own, and `cssClass "Shape,Other" emphasis` — the
 * statement that applies one to a quoted, comma-separated target list.
 *
 * The two are kept as separate declarations rather than being resolved
 * against each other here: pairing a `cssClass` with its `classDef`, in
 * either source order, is `resolveStyles`' job.
 *
 * `cssClass` is this kind's spelling of the apply-directive — a flowchart
 * writes `class` — so it is normalized to the `apply` kind here, the way
 * `parseDirection` normalizes `TD` to `TB`. The spelling itself is carried
 * on as `authoredAs`, because it is the word a diagnostic has to quote.
 */
const CLASS_DEF_RE = /^classDef\s+(\w+)\s+(.+)$/;
const CSS_CLASS_RE = /^cssClass\s+"([^"]*)"\s+(\w+)$/;

/**
 * Where `line`'s first `%%` outside a quoted string starts, or `-1`. A
 * quoted note, label or url holds its `%%` as text, as Mermaid 12.2.0's
 * class lexer reads a string whole.
 */
function percentOutsideQuotes(line: string): number {
  const match = /^(?:[^"%]|"[^"]*"|%(?!%))*%%/.exec(line);
  return match === null ? -1 : match[0].length - 2;
}

/**
 * `text` as a Markdown code span: fenced by one backtick more than the
 * longest run of them inside it, and padded with a space when it starts or
 * ends with one — so a quoted statement holding quotes or backticks reads
 * whole.
 */
function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

/**
 * `text` with each entity code (`#lt;`, `#59;`) written over by `#`s of its
 * length, so a search for `;` finds only the `;`s Mermaid 12.2.0's lexer
 * sees: it encodes every `/#\w+;/` before lexing (measured: `A : +x #59; y`
 * and `class A { +x #59; y }` each draw one member). Positions are kept.
 */
function maskEntityCodes(text: string): string {
  return text.replace(/#\w+;/g, (code) => "#".repeat(code.length));
}

/**
 * The statements after which Mermaid 12.2.0's class lexer reads a `%%` as a
 * comment: its rules `%%(?!\{)*[^\n]*(\r?\n?)+` and `%%[^\n]*(\r?\n)*` match
 * where such a statement's last token ends. Both swallow the line break
 * after the comment, so the next statement runs on into this one, which the
 * grammar refuses — the comment holds only on the document's last line
 * (measured: `A <|-- B %% x` alone is drawn without it, and followed by
 * `class C` is "Expecting 'NEWLINE', 'EOF' …"). The same after a
 * relationship with multiplicities, a note, a `cssClass`, a `click`, a
 * `link`, a `callback` and a standalone annotation.
 */
const STATEMENTS_A_COMMENT_MAY_FOLLOW = [
  RELATIONSHIP_RE,
  NOTE_RE,
  NOTE_FOR_RE,
  CSS_CLASS_RE,
  CLICK_HREF_RE,
  CLICK_CALL_RE,
  CALLBACK_RE,
  LINK_RE,
  STANDALONE_ANNOTATION_RE,
];

/** The kind of statement the class-diagram statement parser read a line as. */
type StatementKind =
  | "direction"
  | "accessibility"
  | "namespace"
  | "note"
  | "interaction"
  | "style"
  | "annotation"
  | "relationship"
  | "class"
  | "member";

/**
 * The statements a `namespace` body may hold: a class declaration in any
 * form, a note, a nested namespace — and a comment, which never reaches
 * here as a statement. Mermaid 12.2.0's grammar takes nothing else there
 * (measured: a relationship, `<<annotation>> A`, `direction`, `style`,
 * `classDef`, `cssClass`, `click`, `link`, `callback`, an inline member and
 * `accTitle` / `accDescr` are each "Expecting 'NAMESPACE', 'CLASS',
 * 'NOTE_FOR', 'NOTE', got …"). The one place that rule lives: every other
 * statement is refused where it stands in a namespace (ADR-0017).
 */
const NAMESPACE_BODY_KINDS: ReadonlySet<StatementKind> = new Set(["namespace", "class", "note"]);

/** The inline member form, `Bird : +fly()`. */
const INLINE_MEMBER_RE = /^(\w+)\s*:\s*(.+)$/d;
/**
 * What a member's own name may look like, once markers and type are off: an
 * identifier, which a `<br>` (already respelled by `MEMBER_BREAK_RE`) may
 * stand inside — `+id<br>int` is one name, as Mermaid reads it.
 */
const MEMBER_NAME_RE = /^[A-Za-z_]\w*(?:<br>\w*)*$/;
/**
 * Mermaid's own row-break pattern, which it applies to a member's text and
 * then escapes the result rather than reading it as markup — measured
 * (mermaid 11.17.2, `--paint`, both label modes): `+id<br/>int` and
 * `+id<BR/>int` both draw the characters `+id<br>int`, while a
 * `<br class="x">` its pattern does not match is drawn exactly as written.
 */
const MEMBER_BREAK_RE = /<br\s*\/?>/gi;

const VISIBILITY_MARKERS = new Set<string>(["+", "-", "#", "~"]);
const CLASSIFIER_MARKERS = new Set<string>(["*", "$"]);

/**
 * Strips one layer of surrounding quotes from a `call fn("arg")`
 * argument, and reads an empty argument list as no argument at all.
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
 * Maps a relation token's left- or right-hand marker to the endpoint it
 * draws. `<|`/`|>` is a triangle (inheritance/realization), `*` a filled
 * diamond (composition), `o` a hollow diamond (aggregation), `<`/`>` an
 * arrow (association/dependency), and a missing marker draws nothing.
 */
function endpointFor(marker: string | undefined): ClassRelationshipEnd {
  switch (marker) {
    case "<|":
    case "|>":
      return "triangle";
    case "*":
      return "diamondFilled";
    case "o":
      return "diamondHollow";
    case "<":
    case ">":
      return "arrow";
    case "()":
      return "circle";
    default:
      return "none";
  }
}

/**
 * Parses one member line of a class — `+int size`, `-String name`,
 * `+swim() bool`, `draw()*` — into its parts, or returns `null` when the
 * line is not a member at all (the caller turns that into a diagnostic).
 *
 * Each part is kept as the author wrote it, so the renderer can print the
 * line back verbatim: a `+` stays a `+`, a type stays whatever text stood
 * before the name, and a parameter list stays the raw text between the
 * parens.
 *
 * A leading `~` is read as the package-visibility marker, never as the
 * opening of a `~generic~` — that ambiguity is Mermaid's own, and Mermaid
 * resolves it the same way.
 *
 * **A member is not a label** (ADR-0015), so nothing here goes through
 * `readLabel`: Mermaid escapes a member's text in both label modes, and the
 * one thing it does to it first — respelling `<br/>`, `<br />` and `<BR>`
 * as `<br>` — is done here too (`MEMBER_BREAK_RE`), so `+id<br/>int` is drawn as the
 * characters `+id<br>int` and `+<b>id</b> int` as written.
 */
function parseMember(text: string, line: number, column: number): ClassMember | null {
  let rest = text.trim().replace(MEMBER_BREAK_RE, "<br>");

  let classifier: ClassMemberClassifier | null = null;
  const lastChar = rest.slice(-1);
  if (CLASSIFIER_MARKERS.has(lastChar)) {
    classifier = lastChar as ClassMemberClassifier;
    rest = rest.slice(0, -1).trim();
  }

  let visibility: ClassMemberVisibility | null = null;
  const firstChar = rest.slice(0, 1);
  if (VISIBILITY_MARKERS.has(firstChar)) {
    visibility = firstChar as ClassMemberVisibility;
    rest = rest.slice(1).trim();
  }

  const openParen = rest.indexOf("(");
  if (openParen !== -1) {
    const closeParen = rest.lastIndexOf(")");
    if (closeParen < openParen) {
      return null;
    }
    const name = rest.slice(0, openParen).trim();
    if (!MEMBER_NAME_RE.test(name)) {
      return null;
    }
    const returnType = rest.slice(closeParen + 1).trim();
    return {
      memberKind: "method",
      visibility,
      classifier,
      name,
      type: null,
      parameters: rest.slice(openParen + 1, closeParen),
      returnType: returnType.length > 0 ? returnType : null,
      line,
      column,
    };
  }

  const tokens = rest.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const name = tokens[tokens.length - 1];
  if (!MEMBER_NAME_RE.test(name)) {
    return null;
  }
  return {
    memberKind: "attribute",
    visibility,
    classifier,
    // Mermaid writes an attribute's type before its name (`+int size`), so
    // the last token is the name and anything before it is the type.
    name,
    type: tokens.length > 1 ? tokens.slice(0, -1).join(" ") : null,
    parameters: null,
    returnType: null,
    line,
    column,
  };
}

/**
 * Parses Siren class-diagram source text — a `classDiagram` (or
 * `classDiagram-v2`) header, class declarations in all three forms
 * (`class Animal`, `class Animal { ... }`, `Animal : +fly()`),
 * relationship statements with their optional label and multiplicity,
 * `<<annotation>>` markers, `~generic~` parameters, `namespace` blocks,
 * `note` statements, `direction`, the interaction directives (`click ...
 * href`, `click ... call`, and their `link`/`callback` spellings) and the
 * styling directives (`style`, `classDef`, `cssClass`) — into a
 * `ClassDocument`. Never throws on malformed input: syntax problems are
 * reported as diagnostics, and a document containing an error-severity one
 * comes back as `null`.
 *
 * A class named only by a relationship is declared by that mention, the
 * way `parseFlowchart` declares a node named only by an edge. Repeat
 * declarations of one name are *not* folded together here — that, and
 * every other cross-statement question (relationship ids, endpoint
 * resolution, note attachment, timeline resolution), is
 * `buildClassModel`'s job. That is why a standalone `<<interface>> Shape`
 * produces its own annotation-only declaration rather than reaching back
 * into an earlier one: every statement contributes a declaration, and the
 * model merges them.
 *
 * A header with nothing after it is a valid, empty diagram rather than an
 * error: Mermaid renders it as an empty canvas, and there is nothing
 * malformed to report.
 *
 * Whole-line `%%` comments are already gone by the time this runs:
 * `parseSiren` blanks them before dispatching, and hands this parser every
 * other line as written. A `%%` later on a line is read as Mermaid 12.2.0's
 * class grammar reads it (CONTEXT.md **Comment**): as text where the line
 * holds text — a member, a label, a note, a declaration list — as a comment
 * after `direction`, and after another complete statement only on the
 * document's last line (`STATEMENTS_A_COMMENT_MAY_FOLLOW`); anywhere else
 * it is refused at the `%%` (`midLinePercentError`).
 *
 * **Interaction and styling are validated for syntax shape only, and that
 * is deliberate.** A `click X href "javascript:alert(1)"` and a
 * `style X fill:url(#evil)` are well-formed statements, so they parse here
 * with no diagnostic and reach the model as ordinary declarations.
 *
 * Both are refused downstream, and by two separate gates in two separate
 * modules. Which is which is worth naming exactly, because a check added to
 * the wrong one is a check that guards one diagram kind and silently misses
 * the other:
 *
 * - The `http`/`https`/`mailto` URL allowlist lives in `buildClassModel`'s
 *   `resolveInteractions`. `click`/`link`/`callback` are class-diagram
 *   directives and no other parser produces one, so that gate has no second
 *   caller to be shared with.
 * - The style-value gate — the plain-CSS-identifier rule for a property
 *   name, and the refusal of a value carrying `url(`, `expression(`, `;` or
 *   a backslash — lives in `graph-model/resolveStyles.ts`, which every
 *   diagram kind that accepts author styling calls. **That module is what
 *   ADR-0008 means by the security boundary for styling**: the one place a
 *   value is checked before a renderer emits it verbatim into an inline
 *   `style` attribute, and no renderer re-checks anything. It was a private
 *   function of `buildClassModel` while the class diagram was the only kind
 *   that styled anything; the flowchart made it the second caller and it
 *   was lifted out rather than copied. A newly rejected property, value
 *   shape or sink belongs there and nowhere else.
 *
 * Both gates run today. A refused declaration is dropped with an
 * error-severity diagnostic reported at the line that wrote it, and its
 * siblings in the same statement still apply.
 *
 * The split between this file and those two is not an oversight: this
 * parser answers "what did the author write", the model answers "is that
 * safe to render", and putting the second question here would mean a
 * hostile URL silently changed what the document *is* rather than being
 * reported as the error it is. Every value captured by this function is
 * therefore untrusted until the model has passed it.
 *
 * The first timeline header ends the diagram body, and the timeline blocks
 * run from there to the end of the document, exactly as they do in a
 * flowchart — and they are parsed by the same grammar, `parseTimelineBlock`,
 * rather than by a second copy of it here.
 * Nothing about a timeline entry is diagram-kind-specific (ADR-0002 keeps the
 * block separate from the structural definition precisely so it can name any
 * id), so the ids in it are resolved by `buildClassModel` and validated
 * nowhere else.
 */
export function parseClassDiagram(source: string): DiagramParseResult {
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
  // A `%%` after the header is refused at the `%%`, written with a space
  // before it or without, and with nothing below it too: measured, Mermaid
  // reads `classDiagram %% x` as "Expecting 'NEWLINE', got 'EOF'".
  const headerPercent = headerPercentError(headerRawLine, index + 1, "class", { spacedIsComment: false });
  if (headerPercent !== null) {
    return { document: null, diagnostics: [headerPercent] };
  }
  if (matchDiagramHeader(headerLine) !== "class") {
    diagnostics.push({
      severity: "error",
      message: `Expected ${CLASS_HEADER_SPELLINGS}, found "${headerLine}"`,
      line: index + 1,
      column: headerRawLine.length - headerRawLine.trimStart().length + 1,
    });
    return { document: null, diagnostics };
  }

  index++;

  // The index of the document's last statement line: the last non-blank
  // line above the first timeline header. Mermaid never sees a timeline
  // block, and whole-line comments are already blank here, so this is the
  // line Mermaid's lexer finds last — the one line where a `%%` after a
  // statement is a comment (`STATEMENTS_A_COMMENT_MAY_FOLLOW`).
  const timelineAt = lines.findIndex((candidate, at) => at >= index && isTimelineHeader(candidate.trim()));
  let lastStatementIndex = (timelineAt === -1 ? lines.length : timelineAt) - 1;
  while (lastStatementIndex >= index && lines[lastStatementIndex].trim().length === 0) {
    lastStatementIndex--;
  }

  const classes: ClassDecl[] = [];
  const relationships: ClassRelationship[] = [];
  const namespaces: ClassNamespace[] = [];
  const notes: ClassNote[] = [];
  const interactions: Interaction[] = [];
  const styles: StyleDecl[] = [];
  /** Every class id seen so far, however it was introduced. */
  const declaredIds = new Set<string>();
  /**
   * Whether any error-severity problem was found. Like the flowchart and
   * sequence parsers, a document with one is returned as `null`: the
   * diagnostics say what is wrong, and no half-parsed document reaches the
   * next stage.
   */
  let sawError = false;
  /**
   * The class block closed last, and the index of the line its `}` stands
   * on — so a member on the next line can be refused as the misplaced `}`
   * it most likely is, rather than as an unrecognized line.
   */
  let lastClosedBlock: { id: string; closedAt: number } | null = null;
  /** How many `namespace` blocks enclose the statement being parsed. */
  let namespaceDepth = 0;
  /**
   * The innermost `namespace` block enclosing the statement being parsed, or
   * `null` at the top level: what a qualified name is built from, and where
   * a note written there is recorded.
   */
  let enclosingNamespace: ClassNamespace | null = null;
  /**
   * The `}`s written after a block's own `}` on its line, each closing one
   * of the namespaces around it in turn — `class A {` ⏎ `+x }}` closes A,
   * then its namespace, as Mermaid 12.2.0 reads it (measured). Each
   * namespace the block stands in takes one as it returns, and the one
   * taking the last refuses the text after them (`after`, starting at
   * `line`:`column`) as text after its own `}`.
   */
  let pendingNamespaceCloses: { count: number; after: string; line: number; column: number } | null = null;
  let accTitle: string | null = null;
  let accDescr: string | null = null;
  /**
   * The document's layout direction. `TB` until a `direction` statement
   * says otherwise; a second one wins over the first, the way a later
   * assignment wins in every other statement-ordered format.
   */
  let direction: Direction = "TB";
  /**
   * The `timeline:` block, once one has been opened. `null` until then, which
   * is what tells `buildClassModel` the document declares no animation at all
   * (as opposed to declaring an empty block).
   */
  let timeline: SirenTimeline | null = null;
  /** The named `timeline <name>:` blocks, once the first has been opened. */
  let namedTimelines: NamedTimeline<SirenTimeline>[] = [];

  /**
   * Adds a declaration to the document, and — when it was written inside a
   * `namespace` block — names it as a member of that namespace. A class
   * declared twice inside one namespace is named once.
   */
  const declareClass = (declaration: ClassDecl, namespaceMembers: string[] | null) => {
    declaredIds.add(declaration.id);
    classes.push(declaration);
    if (namespaceMembers !== null && !namespaceMembers.includes(declaration.id)) {
      namespaceMembers.push(declaration.id);
    }
  };

  /**
   * Records the `:::name` a declaration ended with as the apply directive
   * `cssClass "id" name` would produce, so `resolveStyles` pairs it with its
   * `classDef` in either source order and nothing downstream learns a third
   * spelling exists. `authoredAs` is `:::`, the word a diagnostic quotes,
   * as in a flowchart and an ER diagram.
   *
   * **A deliberate divergence from Mermaid (CONTEXT.md rule 3).** Measured,
   * 12.2.0: a `:::name` or `cssClass` attach is painted only when it is
   * written *before* its `classDef`; written after, the box wears the
   * class but paints none of it, with no diagnostic, though the
   * `classDef` names its declarations unambiguously. Siren pairs them in either order. Recorded in the
   * corpus rows `cls-style-cssclass` and `cls-style-shorthand`, and on nook
   * 01M4WT4KY.
   */
  const attachShorthand = (
    id: string,
    name: string | undefined,
    line: number,
    column: number,
  ) => {
    if (name === undefined) return;
    styles.push({
      styleKind: "apply",
      authoredAs: ":::",
      targetIds: [id],
      name,
      properties: [],
      line,
      column,
    });
  };

  /**
   * Records a class named by a relationship, the way `parseFlowchart`
   * records a node named by an edge: `Animal <|-- Duck` declares both
   * classes. Only the first mention creates one, so a class named by ten
   * relationships is still one declaration — and an id that already has a
   * declaration of its own is left alone.
   */
  const declareImplicitly = (
    id: string,
    line: number,
    column: number,
    namespaceMembers: string[] | null,
  ) => {
    if (declaredIds.has(id)) {
      return;
    }
    declareClass(
      { id, generic: null, annotation: null, label: null, members: [], line, column },
      namespaceMembers,
    );
  };

  /**
   * Reads the declaration list of a `style`/`classDef` statement, turning
   * each segment that is not a `property:value` pair into an error
   * diagnostic on that statement's line.
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
   * Reads the label one capture group of a statement's match holds, and
   * records its diagnostics (`readLabelAt`): every label here is a capture
   * of one of this parser's own patterns over the trimmed line, each
   * compiled with the `d` flag, and no class-diagram statement holding a
   * label spans physical lines, so the line's own indent (`column`) is all
   * the position it needs.
   *
   * Read in the full `html` dialect wherever it is called (ADR-0015). Never
   * called for a member: Mermaid escapes a member's text in both label
   * modes, so a member is kept as written — see `parseMember`.
   *
   * An error costs the whole document, exactly as an unrecognized line does.
   */
  const readLabelIn = (
    match: RegExpExecArray,
    group: number,
    lineNumber: number,
    column: number,
  ): Label => {
    const read = readLabelAt(match, group, { line: lineNumber, column }, "html");
    diagnostics.push(...read.diagnostics);
    if (read.hasError) {
      sawError = true;
    }
    return read.label;
  };

  /**
   * Reads `after`, the text after the `}` closing `owner` `id`'s block on
   * its line, starting at `line`:`column`. The `}`s it opens with, up to
   * one for each of the `enclosing` namespaces around that block, close
   * those namespaces (`pendingNamespaceCloses`), and what follows them is
   * refused by the outermost one closed; with no such `}`, all of `after`
   * is refused here as the block's own (`refuseTextAfterBrace`).
   */
  const readAfterClosingBrace = (
    owner: "class" | "namespace",
    id: string,
    after: string,
    enclosing: number,
    line: number,
    column: number,
  ): void => {
    let consumed = 0;
    let count = 0;
    while (count < enclosing) {
      const brace = /^\s*\}/.exec(after.slice(consumed));
      if (brace === null) break;
      consumed += brace[0].length;
      count++;
    }
    if (count === 0) {
      refuseTextAfterBrace(owner, id, after, line, column);
      return;
    }
    pendingNamespaceCloses = { count, after: after.slice(consumed), line, column: column + consumed };
  };

  /**
   * Refuses what follows the `}` closing `owner` `id`'s block on its line —
   * `after`, starting at `line`:`column` — unless it is only whitespace.
   * Mermaid 12.2.0 refuses a statement there ("… got 'ALPHA'"), a second
   * `}` ("… got 'STRUCT_STOP'") and a `%%` ("… got 'PCT'"), on the last
   * line too (measured), so each is an error (ADR-0017): a `%%` at the
   * `%%`, as everywhere a mid-line one is refused, anything else at the text.
   * A namespace's `}` is measured the same way.
   */
  const refuseTextAfterBrace = (
    owner: "class" | "namespace",
    id: string,
    after: string,
    line: number,
    column: number,
  ): void => {
    const text = after.trim();
    if (text.length === 0) return;
    const at = column + after.length - after.trimStart().length;
    diagnostics.push(
      text.startsWith("%%")
        ? midLinePercentError(line, at)
        : {
            severity: "error",
            message:
              `Unexpected text after the "}" that closes ${owner} "${id}": "${text}". ` +
              "Remove it, or start the next statement on a line of its own.",
            line,
            column: at,
          },
    );
    sawError = true;
  };

  /**
   * Parses the statement starting at `startIndex` and returns the index of
   * the last line it consumed — the same line for a one-line statement, the
   * closing `}` for a block form; the caller advances past that — and the
   * kind of statement it read the line as, `null` when it read none. A
   * statement refused for a problem of its own still reports its kind — the
   * inline member `A : +x; y` is a `"member"` refused for its `;` — so a
   * namespace around it refuses its placement too, both being true; only a
   * line no statement reads (an unrecognized line, a member after a block's
   * `}`) is `null`.
   *
   * `namespaceMembers` is the class-id list of the `namespace` block this
   * statement sits inside, or `null` at the top level. A class declared
   * here joins that list.
   */
  const parseStatement = (
    startIndex: number,
    namespaceMembers: string[] | null,
  ): { lastIndex: number; read: StatementKind | null } => {
    const rawLine = lines[startIndex];
    const line = rawLine.trim();
    if (line.length === 0) {
      return { lastIndex: startIndex, read: null };
    }

    const lineNumber = startIndex + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;

    const directionStatement = matchClassDirection(line);
    if (directionStatement !== null) {
      direction = directionStatement;
      return { lastIndex: startIndex, read: "direction" };
    }

    // The two accessibility statements (01M4WVVN9), read before the member
    // syntax `Class : member`, which would otherwise take `accTitle: T` for
    // a class called `accTitle` with the member `T` — the box Siren used to
    // draw. Lower case only, as Mermaid 12.2.0's class lexer reads them:
    // `ACCTITLE: T` *is* that class, measured.
    const accTitleMatch = ACC_TITLE_RE.exec(line);
    if (accTitleMatch !== null) {
      accTitle = accTitleMatch[1].trim();
      return { lastIndex: startIndex, read: "accessibility" };
    }
    const accDescrMatch = ACC_DESCR_RE.exec(line);
    if (accDescrMatch !== null) {
      accDescr = accDescrMatch[1].trim();
      return { lastIndex: startIndex, read: "accessibility" };
    }
    if (ACC_DESCR_BLOCK_RE.test(line)) {
      // Read as in every kind (`readAccDescrBlock`), except that a class
      // diagram's lexer refuses an *empty* block as well as an unclosed one
      // (both parse errors, measured), so both are refused here.
      const block = readAccDescrBlock(lines, startIndex, rawLine.indexOf("{"));
      if (!block.closed || block.description === null) {
        diagnostics.push({
          severity: "error",
          message: block.closed
            ? "Empty `accDescr { }` block: a class diagram needs a description inside it"
            : "Unclosed `accDescr { ... }` block: no `}` ends the description it opens",
          line: lineNumber,
          column,
        });
        sawError = true;
        return { lastIndex: block.closed ? block.closeIndex : lines.length, read: "accessibility" };
      }
      accDescr = block.description;
      if (block.rest === null) return { lastIndex: block.closeIndex, read: "accessibility" };
      lines[block.closeIndex] = block.rest;
      return { lastIndex: block.closeIndex - 1, read: "accessibility" };
    }

    const namespaceOpenMatch = NAMESPACE_OPEN_RE.exec(line);
    if (namespaceOpenMatch !== null) {
      const classIds: string[] = [];
      let closed = false;
      let heldStatement = false;
      let bodyIndex = startIndex + 1;
      namespaceDepth++;

      // Recorded as it opens, so the blocks inside it follow it: the order
      // `buildClassModel` numbers `namespace:N` in, outer first. A block is
      // known by its qualified name — Mermaid 12.2.0's `resolveQualifiedId`
      // — so the `M` written inside N is `N.M`, a namespace apart from a
      // top-level `M` (measured: two frames). A dotted name is the same
      // nesting written on one line: `namespace N.M {` opens N, then the M
      // inside it, the block's label and classes going to M alone
      // (measured; a space either side of a dot is read as none). Each
      // segment it passes through is recorded as a namespace with nothing
      // of its own, which `buildClassModel` merges with any block of that
      // name.
      const outerNamespace = enclosingNamespace;
      const writtenName = namespaceOpenMatch[1];
      const nameSpace = new RegExp(NAME_SPACE_RE).exec(writtenName);
      if (nameSpace !== null) {
        // Refused once, at the word after the space, and the block read on
        // as the namespace Mermaid draws, so its `}` closes it rather than
        // being refused as well.
        const undotted = writtenName.replace(/\s*\.\s*/g, ".");
        diagnostics.push({
          severity: "error",
          message:
            `Namespace name "${writtenName}" has a space in it: a namespace name cannot. ` +
            `Write "${undotted.replace(NAME_SPACE_RE, "")}" or "${undotted.replace(NAME_SPACE_RE, "_")}" instead.`,
          line: lineNumber,
          column: column + namespaceOpenMatch.indices![1]![0] + nameSpace.index + nameSpace[0].length,
        });
        sawError = true;
      }
      const writtenSegments = writtenName
        .replace(NAME_SPACE_RE, "")
        .split(".")
        .map((segment) => segment.trim());
      let segments = writtenSegments.filter((segment) => segment.length > 0);
      if (segments.length < writtenSegments.length) {
        // Measured: Mermaid 12.2.0 refuses `namespace .N`, `namespace N.`
        // and `namespace N..M` ("… got 'DOT'"), and an empty part names
        // nothing, so it is refused (ADR-0017). The block is still read, as
        // the namespace its named parts spell, so its `}` closes it rather
        // than being refused as well.
        const fixed = segments.join(".");
        diagnostics.push({
          severity: "error",
          message:
            `Namespace name "${namespaceOpenMatch[1]}" has an empty part: each part between dots needs a name. ` +
            (fixed.length > 0 ? `Write "${fixed}" instead.` : "Give the namespace a name."),
          line: lineNumber,
          column: column + namespaceOpenMatch.indices![1]![0],
        });
        sawError = true;
        if (segments.length === 0) segments = [namespaceOpenMatch[1]];
      }
      /** The entry for `segment` inside the namespace `parent`, holding `members`. */
      const blockEntry = (segment: string, parent: string | null, members: string[]): ClassNamespace => ({
        id: parent === null ? segment : `${parent}.${segment}`,
        name: segment,
        parentId: parent,
        label: null,
        classIds: members,
        noteIndexes: [],
        line: lineNumber,
        column,
      });
      let parentId = outerNamespace?.id ?? null;
      for (const segment of segments.slice(0, -1)) {
        const ancestor = blockEntry(segment, parentId, []);
        namespaces.push(ancestor);
        parentId = ancestor.id;
      }
      const namespace = blockEntry(segments[segments.length - 1]!, parentId, classIds);
      namespaces.push(namespace);
      enclosingNamespace = namespace;

      /**
       * Reads `text`, standing at `offset` on line `index`, as one of the
       * namespace's statements, up to a `}` closing nothing opened before it
       * on that text — the namespace's own, which Mermaid 12.2.0 reads
       * wherever it stands (`class B }`, measured). The text is read in
       * place, its columns kept. Returns the index of the last line read.
       */
      const readBodyText = (index: number, text: string, offset: number): number => {
        const brace = unmatchedClosingBrace(text);
        lines[index] = " ".repeat(offset) + (brace === -1 ? text : text.slice(0, brace));
        // The body is parsed by the same statement parser as the top
        // level, which is what lets a namespace hold block-form classes:
        // the inner call consumes that class's own `}`, so it is never
        // mistaken for the namespace's.
        const holdsStatement = lines[index].trim().length > 0;
        heldStatement ||= holdsStatement;
        // A statement no namespace may hold is still parsed — so a block
        // form consumes its own lines, its `}` never mistaken for the
        // namespace's — and then refused. A line read as no statement is
        // refused as that alone: moving it out would not make it one.
        const { lastIndex, read } = holdsStatement
          ? parseStatement(index, classIds)
          : { lastIndex: index, read: null };
        if (read !== null && !NAMESPACE_BODY_KINDS.has(read)) {
          // Pushed after the statement is parsed, so the statement's own
          // errors (`A : ???`, a `%%` after it) come first, then where it
          // stands — in that order for every statement, by design. Quoted
          // as the statement parser read the line, a `%%` after it cut.
          const statementLine = lines[index];
          diagnostics.push({
            severity: "error",
            message:
              `${codeSpan(statementLine.trim())} cannot be written inside "namespace ${namespaceOpenMatch[1]}": ` +
              "only classes, notes and namespaces go there. Move it outside the namespace.",
            line: index + 1,
            column: statementLine.length - statementLine.trimStart().length + 1,
          });
          sawError = true;
        }
        if (pendingNamespaceCloses !== null) {
          const pending = pendingNamespaceCloses;
          pending.count--;
          if (pending.count === 0) {
            pendingNamespaceCloses = null;
            refuseTextAfterBrace("namespace", namespaceOpenMatch[1], pending.after, pending.line, pending.column);
          }
          closed = true;
          return lastIndex;
        }
        if (brace === -1) return lastIndex;
        readAfterClosingBrace(
          "namespace",
          namespaceOpenMatch[1],
          text.slice(brace + 1),
          namespaceDepth - 1,
          index + 1,
          offset + brace + 2,
        );
        closed = true;
        return index;
      };

      // Text after the `{` is the body's first statement.
      const firstStatement = namespaceOpenMatch[3];
      if (firstStatement.trim().length > 0) {
        bodyIndex = readBodyText(startIndex, firstStatement, column - 1 + namespaceOpenMatch.indices![3]![0]);
        if (!closed) bodyIndex++;
      }

      for (; !closed && bodyIndex < lines.length; bodyIndex++) {
        const bodyRawLine = lines[bodyIndex];
        const bodyLine = bodyRawLine.trim();
        if (bodyLine.length === 0) {
          continue;
        }
        // A line opening with `}` closes the namespace, any text after it
        // refused (`} %% x` at its `%%`, measured "… got 'PCT'").
        bodyIndex = readBodyText(bodyIndex, bodyLine, bodyRawLine.length - bodyRawLine.trimStart().length);
        if (closed) break;
      }

      if (closed && !heldStatement) {
        // Measured: Mermaid 12.2.0 refuses `namespace N {}` and a body of
        // blank lines alike ("… got 'STRUCT_STOP'"), and an empty cluster
        // has no use, so it is refused (ADR-0017).
        diagnostics.push({
          severity: "error",
          message:
            `Empty "namespace ${namespaceOpenMatch[1]}" block: a namespace needs at least one statement inside it. ` +
            "Add a class to it, or remove the namespace.",
          line: lineNumber,
          column,
        });
        sawError = true;
      }

      if (!closed) {
        diagnostics.push({
          severity: "error",
          message: `Unterminated "namespace ${namespaceOpenMatch[1]}" block: missing matching "}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
      }

      namespace.label =
        namespaceOpenMatch[2] === undefined
          ? null
          : readLabelIn(namespaceOpenMatch, 2, lineNumber, column);
      enclosingNamespace = outerNamespace;
      namespaceDepth--;
      return { lastIndex: bodyIndex, read: "namespace" };
    }

    // A note written in a namespace is that namespace's, drawn inside its
    // frame — `note for X` too, wherever X stands (measured, Mermaid
    // 12.2.0) — so it is recorded on the innermost block around it.
    const noteForMatch = NOTE_FOR_RE.exec(line);
    if (noteForMatch !== null) {
      enclosingNamespace?.noteIndexes.push(notes.length);
      notes.push({
        label: readLabelIn(noteForMatch, 2, lineNumber, column),
        targetId: noteForMatch[1],
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "note" };
    }

    const noteMatch = NOTE_RE.exec(line);
    if (noteMatch !== null) {
      enclosingNamespace?.noteIndexes.push(notes.length);
      notes.push({
        label: readLabelIn(noteMatch, 1, lineNumber, column),
        targetId: null,
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "note" };
    }

    const clickHrefMatch = CLICK_HREF_RE.exec(line);
    if (clickHrefMatch !== null) {
      // Naming a class here does not declare it, exactly as naming one in a
      // `note for` does not: only a `class` statement or a relationship
      // does. An interaction on a class that was never declared is
      // `buildClassModel`'s to resolve.
      interactions.push({
        interactionKind: "href",
        targetId: clickHrefMatch[1],
        action: clickHrefMatch[2],
        argument: null,
        tooltip: clickHrefMatch[3] ?? null,
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "interaction" };
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
      return { lastIndex: startIndex, read: "interaction" };
    }

    const callbackMatch = CALLBACK_RE.exec(line);
    if (callbackMatch !== null) {
      interactions.push({
        interactionKind: "call",
        targetId: callbackMatch[1],
        action: callbackMatch[2],
        argument: null,
        tooltip: callbackMatch[3] ?? null,
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "interaction" };
    }

    const linkMatch = LINK_RE.exec(line);
    if (linkMatch !== null) {
      interactions.push({
        interactionKind: "href",
        targetId: linkMatch[1],
        action: linkMatch[2],
        argument: null,
        tooltip: linkMatch[3] ?? null,
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "interaction" };
    }

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
      return { lastIndex: startIndex, read: "style" };
    }

    const cssClassMatch = CSS_CLASS_RE.exec(line);
    if (cssClassMatch !== null) {
      // Paired with its `classDef` in either order — a divergence from
      // Mermaid 12.2.0, which paints it only when written first; see
      // `attachShorthand`.
      styles.push({
        styleKind: "apply",
        authoredAs: "cssClass",
        targetIds: cssClassMatch[1]
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
        name: cssClassMatch[2],
        properties: [],
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "style" };
    }

    const styleMatch = STYLE_RE.exec(line);
    if (styleMatch !== null) {
      // `targetIds` is a list because `cssClass` targets many; a `style`
      // statement fills it with its single target.
      styles.push({
        styleKind: "style",
        authoredAs: "style",
        targetIds: [styleMatch[1]],
        name: null,
        properties: readStyleProperties(styleMatch[2], lineNumber, column),
        line: lineNumber,
        column,
      });
      return { lastIndex: startIndex, read: "style" };
    }

    const standaloneAnnotationMatch = STANDALONE_ANNOTATION_RE.exec(line);
    if (standaloneAnnotationMatch !== null) {
      // One declaration per statement, exactly as the inline member form
      // does: this contributes an annotation and nothing else, and
      // `buildClassModel` folds it into the class's other declarations.
      const [, annotationText, id] = standaloneAnnotationMatch;
      declareClass(
        {
          id,
          generic: null,
          annotation: annotationText.trim(),
          label: null,
          members: [],
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      return { lastIndex: startIndex, read: "annotation" };
    }

    // Mermaid's lexer reads `:::` as the style separator wherever it stands
    // outside quotes, and only a class declaration takes one
    // (`STYLE_SHORTHAND`). So a relationship or an inline member holding
    // one is a parse error there, measured — `Y --> X:::c` is not a
    // relationship labelled `::c`, and `X:::c --> Y` is not the member
    // `::c --> Y`. Such a line falls through to the unrecognized-line
    // diagnostic. Quoted text is no separator: it is stripped first.
    const holdsShorthand = line.replace(/"[^"]*"/g, '""').includes(":::");

    const relationshipMatch = holdsShorthand ? null : RELATIONSHIP_RE.exec(line);
    if (relationshipMatch !== null) {
      const [
        ,
        from,
        fromMultiplicity,
        leftMarker,
        lineToken,
        rightMarker,
        toMultiplicity,
        to,
        labelSource,
      ] = relationshipMatch;
      const fromEnd = endpointFor(leftMarker);
      const toEnd = endpointFor(rightMarker);
      relationships.push({
        from,
        to,
        line: lineToken === ".." ? "dashed" : "solid",
        fromEnd,
        toEnd,
        // No label means `null`, and so does a `:` with nothing after it. The
        // capture starts past the padding after the colon, and the line is
        // already trimmed, so the label is the capture as it stands.
        label:
          labelSource === undefined || labelSource.length === 0
            ? null
            : readLabelIn(relationshipMatch, 8, lineNumber, column),
        fromMultiplicity: fromMultiplicity ?? null,
        toMultiplicity: toMultiplicity ?? null,
        sourceLine: lineNumber,
        sourceColumn: column,
      });
      // A `()` (lollipop) end names an interface, not a class — Mermaid
      // never adds that side to the class list (measured: `Duck ()--
      // Quacks` produces a class for "Quacks" only). `buildClassModel`
      // resolves the lollipop side into its own synthetic node instead.
      if (fromEnd !== "circle") declareImplicitly(from, lineNumber, column, namespaceMembers);
      if (toEnd !== "circle") declareImplicitly(to, lineNumber, column, namespaceMembers);
      return { lastIndex: startIndex, read: "relationship" };
    }

    const blockOpenMatch = CLASS_BLOCK_OPEN_RE.exec(line);
    if (blockOpenMatch !== null) {
      attachShorthand(blockOpenMatch[1], blockOpenMatch[4], lineNumber, column);
      const members: ClassMember[] = [];
      // Annotations inside the block are emitted as their own declarations
      // (`readMemberLine`), so the block declaration itself never carries one.
      let closed = false;
      let bodyIndex = startIndex + 1;

      /**
       * Reads one member line of the block — `text`, written at
       * `memberLine`:`memberColumn` — as an annotation or a member.
       */
      const readMemberLine = (text: string, memberLine: number, memberColumn: number) => {
        // Checked before `parseMember`, which would read `<<interface>>`
        // as a nameless member and reject it.
        //
        // Each annotation line becomes its own annotation-only declaration of
        // the class, exactly as a standalone `<<interface>> Shape` does,
        // rather than being collapsed into one value here. Collapsing meant
        // two conflicting annotations inside one block silently kept the
        // last, while two across separate declarations warned and kept the
        // first — the same authoring mistake diagnosed two different ways
        // depending on where it was written. Emitting both lets
        // `buildClassModel`'s merge be the single rule for either spelling.
        //
        // An annotation with a `%%` after it is refused at the `%%`: Mermaid
        // 12.2.0 reads `<<interface>> %% x` as no annotation but a member,
        // drawn "<> %% x" with the `<interface>` stripped as a tag (measured)
        // — a picture of neither, with no diagnostic (ADR-0001).
        const annotationComment = /^<<.+>>\s*(?=%%)/.exec(text);
        if (annotationComment !== null) {
          diagnostics.push(midLinePercentError(memberLine, memberColumn + annotationComment[0].length));
          sawError = true;
          return;
        }
        const annotationMatch = ANNOTATION_RE.exec(text);
        if (annotationMatch !== null) {
          declareClass(
            {
              id: blockOpenMatch[1],
              generic: blockOpenMatch[2] ?? null,
              annotation: annotationMatch[1].trim(),
              label: null,
              members: [],
              line: memberLine,
              column: memberColumn,
            },
            namespaceMembers,
          );
          return;
        }

        // A `;` outside a method's parentheses and a `~generic~` is two
        // members run together, which Mermaid 12.2.0 draws as one:
        // `+int x; +foo()` is the single method `+int x; +foo()`, and
        // `+int x; y` the single attribute `+int x; y` (measured) — so it is
        // refused even where Siren could read the text as one member, and
        // the error says how to write two (ADR-0001). Inside `(…)` or `~…~`
        // it is what was written: `+foo(a; b)` keeps the parameters `a; b`.
        // A `;` ending the member separates nothing: `+int x;` is one
        // attribute to Mermaid as written, refused only as unrecognized.
        // An entity code's own `;` is no `;` at all (`maskEntityCodes`).
        const separated = maskEntityCodes(text)
          .replace(/\([^)]*\)|~[^~]*~/g, "")
          .replace(/;\s*$/, "")
          .includes(";")
          ? '. A ";" does not separate members: write each member on a line of its own.'
          : "";
        const member = separated === "" ? parseMember(text, memberLine, memberColumn) : null;
        if (member === null) {
          diagnostics.push({
            severity: "error",
            message: `Unrecognized class member: "${text}"${separated}`,
            line: memberLine,
            column: memberColumn,
          });
          sawError = true;
          return;
        }
        members.push(member);
      };

      const firstMember = blockOpenMatch[5];
      if (firstMember.trim().length > 0) {
        const offset = blockOpenMatch.indices![5]![0] + firstMember.length - firstMember.trimStart().length;
        readMemberLine(firstMember.trim(), lineNumber, column + offset);
      }

      // A block closed on its own opening line consumes no line after it.
      if (blockOpenMatch[6] !== undefined) {
        readAfterClosingBrace(
          "class",
          blockOpenMatch[1],
          blockOpenMatch[6],
          namespaceDepth,
          lineNumber,
          column + blockOpenMatch.indices![6]![0],
        );
        closed = true;
        bodyIndex = startIndex;
      }

      for (; !closed && bodyIndex < lines.length; bodyIndex++) {
        const bodyRawLine = lines[bodyIndex];
        const bodyLine = bodyRawLine.trim();
        if (bodyLine.length === 0) {
          continue;
        }
        const bodyColumn = bodyRawLine.length - bodyRawLine.trimStart().length + 1;
        // A `}` closes the block wherever it stands, after a member on that
        // member's line too, as Mermaid 12.2.0 reads `+int y }` (measured).
        const brace = bodyLine.indexOf("}");
        if (brace !== -1) {
          const member = bodyLine.slice(0, brace).trimEnd();
          if (member.length > 0) {
            readMemberLine(member, bodyIndex + 1, bodyColumn);
          }
          readAfterClosingBrace(
            "class",
            blockOpenMatch[1],
            bodyLine.slice(brace + 1),
            namespaceDepth,
            bodyIndex + 1,
            bodyColumn + brace + 1,
          );
          closed = true;
          break;
        }
        readMemberLine(bodyLine, bodyIndex + 1, bodyColumn);
      }

      if (closed) {
        lastClosedBlock = { id: blockOpenMatch[1], closedAt: bodyIndex };
      } else {
        diagnostics.push({
          severity: "error",
          message: `Unterminated "class ${blockOpenMatch[1]}" block: missing matching "}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
      }

      declareClass(
        {
          id: blockOpenMatch[1],
          generic: blockOpenMatch[2] ?? null,
          annotation: null,
          label:
            blockOpenMatch[3] === undefined
              ? null
              : readLabelIn(blockOpenMatch, 3, lineNumber, column),
          members,
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      // The `}` this stopped on, or the end of input when the block was
      // never closed.
      return { lastIndex: bodyIndex, read: "class" };
    }

    const classDeclMatch = CLASS_DECL_RE.exec(line);
    if (classDeclMatch !== null) {
      attachShorthand(classDeclMatch[1], classDeclMatch[4], lineNumber, column);
      declareClass(
        {
          id: classDeclMatch[1],
          generic: classDeclMatch[2] ?? null,
          annotation: null,
          label:
            classDeclMatch[3] === undefined
              ? null
              : readLabelIn(classDeclMatch, 3, lineNumber, column),
          members: [],
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      return { lastIndex: startIndex, read: "class" };
    }

    const inlineMemberMatch = holdsShorthand ? null : INLINE_MEMBER_RE.exec(line);
    if (inlineMemberMatch !== null) {
      const [, id, memberText] = inlineMemberMatch;
      // Measured: Mermaid 12.2.0's lexer refuses a `;` anywhere in an inline
      // member — between two members, ending one, inside `(…)`, `~…~` or
      // quotes alike ("Lexical error … Unrecognized text" at the `;`) — so
      // Siren refuses every one there (ADR-0017), unlike a class block,
      // which keeps a `;` inside a method's parentheses. The `;` ending an
      // entity code is the code's (`maskEntityCodes`).
      const semicolon = maskEntityCodes(line).indexOf(";", inlineMemberMatch.indices![2]![0]);
      if (semicolon !== -1) {
        diagnostics.push({
          severity: "error",
          message:
            `A ";" cannot be written in the member "${memberText}": it does not separate members. ` +
            'Write each member on a line of its own, with no ";".',
          line: lineNumber,
          column: column + semicolon,
        });
        sawError = true;
        return { lastIndex: startIndex, read: "member" };
      }
      const member = parseMember(memberText, lineNumber, column);
      if (member === null) {
        diagnostics.push({
          severity: "error",
          message: `Unrecognized class member: "${memberText}"`,
          line: lineNumber,
          column,
        });
        sawError = true;
        return { lastIndex: startIndex, read: "member" };
      }
      // One declaration per line, carrying that line's single member.
      // Folding repeats of the same id together is `buildClassModel`'s job.
      declareClass(
        {
          id,
          generic: null,
          annotation: null,
          label: null,
          members: [member],
          line: lineNumber,
          column,
        },
        namespaceMembers,
      );
      return { lastIndex: startIndex, read: "member" };
    }

    // A `%%` no statement above holds as text. After a statement in
    // `STATEMENTS_A_COMMENT_MAY_FOLLOW` it is a comment on the last line and
    // refused on any other; after `direction` it is a comment wherever it
    // stands (measured:
    // `direction LR %% x` then `class A` draws); after a class declaration
    // or a namespace's `{` it is refused always (measured: `class A %% x`,
    // `class A~T~ %% x`, `class A:::c %% x` and `namespace N { %% x` are
    // parse errors even on the last line, the lexer reading its `%` as
    // `PCT` there). Refused at the `%%` (ADR-0017) — and the statement
    // before it still read, so a namespace's body is not misread as well.
    const percent = percentOutsideQuotes(line);
    if (percent !== -1) {
      const before = line.slice(0, percent).trimEnd();
      const followsCommentable =
        !before.includes(":::") && STATEMENTS_A_COMMENT_MAY_FOLLOW.some((pattern) => pattern.test(before));
      const isComment =
        matchClassDirection(before) !== null || (followsCommentable && startIndex === lastStatementIndex);
      const isRefused =
        !isComment && (followsCommentable || CLASS_DECL_RE.test(before) || NAMESPACE_OPEN_RE.test(before));
      if (isComment || isRefused) {
        if (isRefused) {
          diagnostics.push(midLinePercentError(lineNumber, column + percent));
          sawError = true;
        }
        lines[startIndex] = rawLine.slice(0, column - 1) + before;
        return parseStatement(startIndex, namespaceMembers);
      }
    }

    // A member on the line after a class block's `}` (blank lines aside) is
    // most likely a `}` written too early — Mermaid 12.2.0 refuses it
    // ("… got 'PLUS'", measured) — so the error says which `}` to move.
    let previous = startIndex - 1;
    while (previous >= 0 && lines[previous].trim().length === 0) previous--;
    if (
      lastClosedBlock !== null &&
      lastClosedBlock.closedAt === previous &&
      parseMember(line, lineNumber, column) !== null
    ) {
      diagnostics.push({
        severity: "error",
        message:
          `Member "${line}" is outside class "${lastClosedBlock.id}": the "}" on line ${previous + 1} already closed its block. ` +
          'Move the "}" below the class\'s last member.',
        line: lineNumber,
        column,
      });
      sawError = true;
      return { lastIndex: startIndex, read: null };
    }

    diagnostics.push({
      severity: "error",
      message: `Unrecognized classDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
    return { lastIndex: startIndex, read: null };
  };

  for (; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (isTimelineHeader(line)) {
      // The first header ends the diagram body for good — the same one-way
      // switch `parseFlowchart` makes, so a class statement written after it
      // is a timeline diagnostic rather than silently parsing as structure.
      // Splitting and reading the blocks is `parseTimelineBlocks`'s job, so
      // this parser keeps only the decision that is its own: where the first
      // block starts, and that a diagnostic inside any of them costs the
      // whole document.
      const blocks = parseTimelineBlocks(lines, index);
      diagnostics.push(...blocks.diagnostics);
      if (blocks.diagnostics.length > 0) {
        sawError = true;
      }
      timeline = blocks.timeline;
      namedTimelines = blocks.namedTimelines;
      break;
    }

    index = parseStatement(index, null).lastIndex;
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: ClassDocument = {
    kind: "class",
    accTitle,
    accDescr,
    direction,
    classes,
    relationships,
    namespaces,
    notes,
    interactions,
    styles,
    timeline,
    ...namedTimelinesField(namedTimelines),
  };

  return { document, diagnostics };
}
