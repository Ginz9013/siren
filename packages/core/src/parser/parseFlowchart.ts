import type {
  Diagnostic,
  Direction,
  FlowchartDocument,
  LinkStyleDecl,
  ParseResult,
  SirenEdge,
  SirenNode,
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
 * A node declaration, with the optional `:::name` shorthand that applies a
 * `classDef` at the declaration itself. `A[Start]:::emphasis`.
 *
 * `LABEL_CONTENT` still reads the label loosely, but it no longer gets first
 * refusal on the line: `UNIMPLEMENTED_BRACKET_FORMS` is asked first, and
 * everything it names never reaches here. Widening this pattern without
 * reading that one re-opens the bug that comment exists to close.
 */
const NODE_RE = new RegExp(
  String.raw`^(\w+)\s*\[(${LABEL_CONTENT})\]\s*(?::::(\w+))?\s*$`,
);

/**
 * Everything Mermaid writes *inside* `[...]` that is not a plain label — six
 * node shapes and two label forms — paired with the name Mermaid gives it.
 *
 * **This list is refused, not swallowed.** That is the policy, and it is the
 * whole reason this constant exists: while a construct is unimplemented,
 * reject it — never render something else in its place. `NODE_RE`'s
 * `[^\]]*` used to take any bracket content as a label, so `A[(DB)]` drew a
 * rectangle labelled `(DB)` and said nothing. That disguised *not
 * implemented* as *supported*, and it hid the gap from
 * `src/compat/corpus.ts` — the instrument built to measure exactly this. A
 * mislabelled rectangle is a worse answer than a refusal, because the author
 * never learns anything is missing.
 *
 * None of these is a permanent refusal. The shapes arrive on their own
 * board, and each `described` is written for the author who will read it:
 * it names the shape Mermaid means, so the answer is "wait" rather than
 * "rewrite your line". Whoever implements one deletes its row here — the
 * plain quoted label was a row here until quoting arrived, and `labelIn`
 * is what replaced it.
 *
 * Every form is anchored at **both ends** of the bracket content on purpose.
 * An over-tight pattern would be its own compatibility bug, traded for the
 * one it fixed: `A[a/b]`, `A[x (y)]`, `A[100%]` and `A[say "hi" now]` are
 * ordinary labels that merely *contain* a character a form also opens with,
 * and they still draw as rectangles.
 */
const UNIMPLEMENTED_BRACKET_FORMS: ReadonlyArray<{
  open: string;
  close: string;
  described: string;
}> = [
  { open: "(", close: ")", described: "a cylinder (`A[(text)]`)" },
  { open: "[", close: "]", described: "a subroutine box (`A[[text]]`)" },
  { open: "/", close: "/", described: "a parallelogram (`A[/text/]`)" },
  { open: "\\", close: "\\", described: "a parallelogram alt (`A[\\text\\]`)" },
  { open: "/", close: "\\", described: "a trapezoid (`A[/text\\]`)" },
  { open: "\\", close: "/", described: "a trapezoid alt (`A[\\text/]`)" },
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
  for (const form of UNIMPLEMENTED_BRACKET_FORMS) {
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
 * It accepts nothing — `NODE_RE` still decides what a node declaration is.
 * This pattern exists only to ask what the author meant, which needs the
 * greedy read `NODE_RE` deliberately does not have: `A[[Subroutine]]` is
 * invisible to `[^\]]*`, so without this it would fall all the way through
 * to "unrecognized line", and an author who wrote a subroutine box deserves
 * to be told Siren does not draw one yet.
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
 * **One** endpoint of an edge line: an id, free to carry the same `[label]`
 * and `:::name` an endpoint written on a line of its own may carry — the
 * shorthand works wherever a node can be written, as it does in Mermaid,
 * rather than only at a standalone declaration.
 *
 * One endpoint rather than a whole line, because a line may name any number
 * of them: `A --> B --> C` is a chain of three. The line is cut into
 * endpoints first (`splitOutsideLabel`) and each piece read with this, so
 * how many endpoints a line has is not something a pattern has to encode.
 *
 * Anchored at both ends, which is what keeps a partial read impossible: an
 * endpoint that does not match refuses the **whole** statement, so no
 * chain is ever half-consumed. That is board 3's argument for pinning
 * chains as rejected, kept rather than discarded — reading some of the
 * nodes on a line and dropping the rest would draw a diagram nobody wrote,
 * which is worse than an honest refusal.
 *
 * Its label is `LABEL_CONTENT`, the same one a standalone declaration
 * reads, because quoting works wherever a label can be written — Mermaid
 * takes `A["a]b-->c"] --> B["x, y"]:::hot`, and so does this.
 */
const ENDPOINT_RE = new RegExp(
  String.raw`^(\w+)(?:\s*\[(${LABEL_CONTENT})\])?(?:\s*:::(\w+))?$`,
);

/** The one arrow form Siren draws. Every other Mermaid arrow is a later board's. */
const ARROW = "-->";

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

/** One place a node was written on an edge line, as written there. */
interface EdgeEndpoint {
  id: string;
  label: string | undefined;
  definitionName: string | undefined;
}

/**
 * One endpoint, or `null` when the text is not one — which refuses the
 * statement it came from rather than half of it.
 */
function readEndpoint(text: string): EdgeEndpoint | null {
  const match = ENDPOINT_RE.exec(text.trim());
  if (match === null) {
    return null;
  }
  return { id: match[1], label: match[2], definitionName: match[3] };
}

/**
 * Cuts `text` at every `separator` that lies **outside** a `[...]` label.
 *
 * The bracket depth is the whole point. `;`, `&` and `-->` all mean
 * something between statements and nothing inside a label: `A[a;b]`,
 * `A[a&b]` and `A[a-->b]` are ordinary labels in Mermaid, and a splitter
 * that did not know where a label starts would cut them into nonsense —
 * the same class of bug `UNIMPLEMENTED_BRACKET_FORMS` exists to keep out.
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
 * Always returns at least one piece, and never trims: a caller that needs
 * a column needs the offsets left alone.
 */
function splitOutsideLabel(text: string, separator: string): string[] {
  const parts: string[] = [];
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
    if (text[i] === "[") {
      depth++;
      continue;
    }
    if (text[i] === "]") {
      if (depth > 0) {
        depth--;
      }
      continue;
    }
    if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
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
  let direction: Direction | null = null;
  let timeline: SirenTimeline | null = null;

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

  const addNode = (id: string, label: string, line: number, column: number) => {
    const existing = nodesById.get(id);
    if (existing === undefined) {
      nodesById.set(id, { id, label, line, column });
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
    id: string,
    label: string | undefined,
    definitionName: string | undefined,
    line: number,
    column: number,
  ) => {
    if (label !== undefined) {
      addNode(id, labelIn(label), line, column);
    } else if (!nodesById.has(id)) {
      nodesById.set(id, { id, label: id, line, column });
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

      const arrowParts = splitOutsideLabel(line, ARROW);
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
            message: `Malformed edge: missing target after "-->" in "${line}"`,
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
            refuseUnimplementedForm(endpoint.label, line, lineNumber, column),
          )
        ) {
          continue;
        }

        // Declared once each, left to right as written — before any edge, so
        // a `:::` on an endpoint two arrows along applies exactly once rather
        // than once per link it takes part in.
        for (const endpoint of written) {
          addNodeAsWritten(
            endpoint.id,
            endpoint.label,
            endpoint.definitionName,
            lineNumber,
            column,
          );
        }
        // Sources outermost, which is Mermaid's order: `FlowDB.addLink` is
        // `for (const start of _start) for (const end of _end)`, so
        // `A & B --> C & D` is A-C, A-D, B-C, B-D.
        for (let link = 0; link + 1 < chain.length; link++) {
          for (const from of chain[link]) {
            for (const to of chain[link + 1]) {
              edges.push({ from: from.id, to: to.id, line: lineNumber, column });
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

      const nodeMatch = NODE_RE.exec(line);
      if (nodeMatch !== null) {
        const [, id, label, definitionName] = nodeMatch;
        addNodeAsWritten(id, label, definitionName, lineNumber, column);
        continue;
      }

      const nodeClassMatch = NODE_CLASS_RE.exec(line);
      if (nodeClassMatch !== null) {
        const [, id, definitionName] = nodeClassMatch;
        // Written without a label, so it applies a definition and claims no
        // label — `addNodeAsWritten` holds what that means, for this spelling
        // and for an edge's bare endpoint alike.
        addNodeAsWritten(id, undefined, definitionName, lineNumber, column);
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
    styles,
    linkStyles,
    timeline,
  };

  return { document, diagnostics };
}
