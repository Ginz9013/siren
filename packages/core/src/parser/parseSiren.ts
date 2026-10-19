import type { DiagramParseResult, Diagnostic, ParseResult } from "../contracts";
import {
  type DirectivesRead,
  documentConfigOf,
  type FrontmatterRead,
  readDirectives,
  readFrontmatter,
} from "./documentConfig";
import { bareCommentError, isBareCommentLine } from "./bareCommentLine";
import { parseClassDiagram } from "./parseClassDiagram";
import { parseErDiagram } from "./parseErDiagram";
import { type DiagramKind, listAcceptedHeaders, matchDiagramHeader } from "./parseDirection";
import { parseFlowchart } from "./parseFlowchart";
import { parseSequenceDiagram } from "./parseSequenceDiagram";
import { parseStateDiagram } from "./parseStateDiagram";
import { isTimelineHeader, isTimelineVerb, unrecognizedActionMessage } from "./parseTimelineBlock";
import { styleLines, type DroppedSemicolons } from "./styleLines";
import { tagQuotesRewritten } from "./tagQuotes";

/**
 * Every spelling the language accepts, with no kind named here — so this
 * message gains a kind's headers on the day `parseDirection` does, rather
 * than on the day someone remembers that it, too, keeps a list.
 */
const HEADER_SPELLINGS = listAcceptedHeaders();

/**
 * Which parser each kind's header hands the document to. The header itself
 * is not matched here: `matchDiagramHeader` names the kind, and this record
 * only says who parses it, so the two facts cannot disagree about which
 * spellings exist.
 */
const PARSE_KIND: Record<DiagramKind, (source: string, dropped: DroppedSemicolons) => DiagramParseResult> = {
  flowchart: parseFlowchart,
  sequence: parseSequenceDiagram,
  class: parseClassDiagram,
  state: parseStateDiagram,
  er: parseErDiagram,
};

/**
 * The lines of `source` as Mermaid reads them before any diagram's grammar
 * sees them: its tag quotes rewritten (`tagQuotesRewritten`), its
 * frontmatter and directives read and blanked (`readFrontmatter`,
 * `readDirectives`), its `%%` comments removed in Mermaid's two steps, and its style-line rule
 * (`styleLines`) applied between those steps. It keeps one output line per
 * input line, so every diagnostic's line number still points at the line
 * the author wrote, and `asWritten` maps what the style-line rule changed
 * back to the source as written.
 *
 * These rules live here, in the dispatcher, rather than in each kind's
 * parser: each is one rule for the whole language, and putting them here
 * is what gives every kind the same behavior without five implementations
 * of them.
 *
 * The rule is Mermaid's (CONTEXT.md **Comment**): a comment is a whole
 * line whose first non-blank characters are `%%`, indented or not, and it
 * is removed here. A `%%` later on a line is not removed by Mermaid's
 * `cleanupComments` at all; what it means is each kind's grammar's — text
 * inside a label, a refusal after a complete statement, a comment only
 * where a kind's lexer reads one. So `lines` keeps every line of the
 * diagram as Mermaid's grammar is handed it, and each kind's parser decides.
 * A timeline block is Siren's own syntax, not Mermaid's (ADR-0017), and
 * its lines are still cut at their first `%%` — save, in a flowchart, one
 * glued to or beginning an action's target (`cutTimelineComment`). In
 * every other kind such a `%%` still opens the comment, and the action it
 * leaves with no target is noted (`commentedTargets`) so its refusal can
 * say why.
 *
 * Except a line that is nothing but `%%` (`bareCommentLines`). Mermaid's
 * `cleanupComments` removes `^\s*%%(?!{)[^\n]+\n?`, so a whole-line
 * comment needs at least one character — a space will do — after its
 * `%%`; a bare `%%` is left to the diagram's grammar. What that grammar
 * makes of it differs by kind (`BARE_COMMENT_OUTCOME`), so the line is still
 * blanked here and the kind decides, once the header is known, whether the
 * document is refused for it (ADR-0017).
 *
 * Mermaid's order matters for one thing. Its `cleanupComments` removes only
 * whole-line comments, and then its `encodeEntities` drops a style line's
 * last `;` — so on a line with a mid-line `%%`, that `;` may be after it:
 * measured (11.17.2), a state diagram's
 * `state "<span style='color:#f00;'>r</span>" as A %% x;` keeps its color's
 * `;`, so its color is an entity code and `r` is drawn uncolored. Here,
 * too, whole-line comments go first, then `styleLines`, then — in a
 * timeline block — the cut at a mid-line `%%`.
 *
 * Before any of them comes Mermaid's first step, its `cleanupText`
 * (`tagQuotesRewritten`): it runs over the document as written, comments
 * included, so a tag-shaped stretch a comment opens can still be ended by a
 * `>` on a later line. It changes no length and no line break, so it needs
 * no `asWritten`.
 *
 * Then, where Mermaid's `preprocessDiagram` reads it — after `cleanupText`,
 * before directives or comments — the frontmatter (`readFrontmatter`). Its
 * lines are blanked rather than removed, so the line count is unchanged and
 * nothing it holds, a `%%` included, is read as diagram text. It is read on
 * the document with its line breaks made `\n`, as `cleanupText` makes them;
 * the lines are split on every spelling of a line break either way, so no
 * column moves.
 *
 * Then, still before any comment, the `%%{…}%%` directives
 * (`readDirectives`), where `preprocessDiagram` reads them: each is read and
 * blanked in place, line breaks kept, wherever it stands and however many
 * lines it spans. It has to come first: the comment rule below is
 * line-wise, so it would remove only the `%%{` line of an init spread over
 * several, and leave the rest to be read as diagram text — which no diagram
 * accepts (measured on 12.2.0: Mermaid reads such an init whole and draws
 * the diagram below it).
 */
function asMermaidReads(source: string): {
  lines: string[];
  header: Header | null;
  timelineStart: number;
  asWritten: <T>(result: T) => T;
  droppedOn: DroppedSemicolons;
  frontmatter: FrontmatterRead;
  directives: DirectivesRead;
  bareCommentLines: BareCommentLine[];
  commentedTargets: CommentedTarget[];
} {
  const frontmatter = readFrontmatter(tagQuotesRewritten(source).split(/\r\n|\r|\n/).join("\n"));
  const directives = readDirectives(frontmatter.source);
  const linesAsWritten = directives.source.split("\n");
  const bareCommentLines = linesAsWritten.flatMap((line, index) =>
    isBareCommentLine(line) ? [{ line: index + 1, column: line.length - 1 }] : [],
  );
  const wholeLinesBlanked = linesAsWritten.map((line) =>
    line.trimStart().startsWith("%%") ? "" : line,
  );
  const read = styleLines(wholeLinesBlanked.join("\n"));
  const linesAsRead = read.source.split("\n");
  // The header, and where the timeline blocks start, are found on the lines
  // cut at their first `%%`: `flowchart TB %% x` still names a flowchart,
  // whose own parser then refuses the `%%`, and `timeline: %% x` still
  // opens a block. A timeline block is Siren's own syntax, not Mermaid's
  // (ADR-0017), so its lines keep the cut — save, in a flowchart, a `%%`
  // glued to or beginning a target (`cutTimelineComment`).
  const cut = linesAsRead.map(cutAtDoublePercent);
  const header = headerOf(cut);
  const timelineStart = header === null ? Infinity : firstTimelineHeader(cut, header.index);
  const gluedTargets = header?.kind === "flowchart";
  const lines = linesAsRead.map((line, index) =>
    index < timelineStart ? line : cutTimelineComment(line, gluedTargets),
  );
  const commentedTargets = gluedTargets
    ? []
    : linesAsRead.flatMap((line, index) => {
        const target = index < timelineStart ? null : commentedTarget(line);
        return target === null ? [] : [{ line: index + 1, action: target }];
      });
  return {
    lines,
    header,
    timelineStart,
    asWritten: read.asWritten,
    droppedOn: read.droppedOn,
    frontmatter,
    directives,
    bareCommentLines,
    commentedTargets,
  };
}

/**
 * A timeline line, outside a flowchart, whose first `%%` stands where its
 * last action's target begins (`enter %%B fade`): the `%%` opens the
 * comment there, so the cut leaves that action as `action`, a verb with no
 * target, on line `line`.
 */
interface CommentedTarget {
  line: number;
  action: string;
}

/**
 * The action left with no target when `line` is cut at its first `%%`, or
 * `null` when that `%%` does not begin a target: none on the line, one on
 * a header, one with a space or the line's end after it (a comment's own
 * form), one anywhere but the target slot — or one after a word that is
 * no timeline verb, which is what is wrong with that action.
 */
function commentedTarget(line: string): string | null {
  const at = line.indexOf("%%");
  if (at === -1) return null;
  const before = line.slice(0, at);
  if (isTimelineHeader(before.trim())) return null;
  if (!beginsTarget(line, at)) return null;
  const verb = lastAction(before).trim();
  return isTimelineVerb(verb) ? verb : null;
}

/**
 * Why the action on a `CommentedTarget`'s line has no target. The id the
 * author meant cannot be named in this kind: its own grammar reads a `%%`
 * as a comment, so none of its ids begin with one.
 */
function commentAteTheTarget(verb: string): string {
  return `The "%%" after "${verb}" starts a comment, so "${verb}" has no target; an id in this diagram cannot begin with "%%"`;
}

/**
 * `diagnostics` with the timeline grammar's refusal of each
 * `commentedTargets` action — the last one on its line naming that action,
 * since the cut action is its line's last — saying why it has no target.
 */
function explainCommentedTargets(
  diagnostics: readonly Diagnostic[],
  commentedTargets: readonly CommentedTarget[],
): Diagnostic[] {
  const explained = [...diagnostics];
  for (const target of commentedTargets) {
    const refused = unrecognizedActionMessage(target.action);
    for (let index = explained.length - 1; index >= 0; index--) {
      const diagnostic = explained[index]!;
      if (diagnostic.line !== target.line || diagnostic.message !== refused) continue;
      explained[index] = { ...diagnostic, message: commentAteTheTarget(target.action) };
      break;
    }
  }
  return explained;
}

/** `line` without everything from its first `%%` on. */
function cutAtDoublePercent(line: string): string {
  const at = line.indexOf("%%");
  return at === -1 ? line : line.slice(0, at);
}

/**
 * A timeline line without its comment: everything from its first `%%` on,
 * as for every line before 01M4ZWT8PR — except, in a flowchart
 * (`gluedTargets`), a `%%` that is part of an action's target, since there
 * `%` is an id character. That is a `%%` glued to the end of a target:
 * `A%%x` is one node id (measured on Mermaid 12.2.0), so `unhighlight A%%x`
 * names that node, where the cut aimed it at `A`, silently. And it is a
 * `%%` that begins a target (`beginsTarget`): `A --> %%B` draws a node
 * `%%B`, so `enter %%B fade` names it, where the cut left the verb with no
 * target. Either way the target runs on to the next space.
 *
 * Every other `%%` opens the comment: one with a space or the line's end
 * straight after it (`enter %% note`, a comment's own form), one glued to
 * a verb or an effect (`enter A fade%% note`), every one on a header line
 * (`timeline: %%note` — a header holds no target), and every one in another
 * kind's timeline, whose ids hold no `%`.
 */
function cutTimelineComment(line: string, gluedTargets: boolean): string {
  const cut = cutAtDoublePercent(line);
  if (!gluedTargets || isTimelineHeader(cut.trim())) return cut;
  let from = 0;
  for (;;) {
    const at = line.indexOf("%%", from);
    if (at === -1) return line;
    const before = line.slice(0, at);
    const inTarget = endsInTargetSlot(before) || beginsTarget(line, at);
    if (!inTarget) return before;
    from = at + line.slice(at).search(/\s|$/);
  }
}

/**
 * A `%%` that begins a target rather than a comment: text straight after
 * it. `%% note` and a `%%` at the line's end are a comment's own form.
 */
const BEGINS_TARGET_RE = /^%%\S/;

/**
 * Whether the `%%` at `at` in a timeline line begins its last action's
 * target: it stands where that target begins (`beginsTargetSlot`) and
 * text follows it straight away (`BEGINS_TARGET_RE`). A flowchart reads it
 * as the target's; every other kind as a comment that took the target.
 */
function beginsTarget(line: string, at: number): boolean {
  return beginsTargetSlot(line.slice(0, at)) && BEGINS_TARGET_RE.test(line.slice(at));
}

/** The last comma-separated action of a timeline line read up to some point. */
function lastAction(before: string): string {
  return before.slice(before.lastIndexOf(",") + 1);
}

/**
 * Whether `before` stops partway through the target of its last action:
 * that action holds a verb and a target and nothing else, with no space
 * after the target (the `verb target [effect]` of `TIMELINE_ACTION_RE`).
 */
function endsInTargetSlot(before: string): boolean {
  return /^\s*\S+\s+\S+$/.test(lastAction(before));
}

/**
 * Whether `before` stops where the target of its last action begins: that
 * action holds a verb and the space after it, and nothing else.
 */
function beginsTargetSlot(before: string): boolean {
  return /^\s*\S+\s+$/.test(lastAction(before));
}

/** Where a line that is nothing but `%%` starts its `%%`, as the author wrote it. */
interface BareCommentLine {
  line: number;
  column: number;
}

const BARE_COMMENT_DRAWN = bareCommentError({ drawnAs: 'so this line is a node named "%%"' });
const BARE_COMMENT_REFUSED = bareCommentError();

/**
 * What a kind makes of a bare `%%` line: refused with this message, read as
 * a comment, or handed to the kind's own parser, which reads it by where it
 * stands.
 */
type BareCommentOutcome = { refused: string } | "comment" | "handed";

/**
 * What Mermaid makes of a bare `%%` line in each kind (measured on 12.2.0),
 * given whether the line stands below the kind's header. Sequence and state
 * diagrams read it as a comment after all (their lexers have a `%%` rule of
 * their own), so it means here what it means there. A class diagram reads it
 * by where it stands — a class block's member `%%`, nothing between
 * statements, a parse error in a namespace's body — so the line is handed
 * to `parseClassDiagram`, which knows where it stands. A flowchart draws the
 * line as a node below its header and refuses the document above it; an ER
 * diagram refuses it anywhere. A record rather than a switch, as
 * `PARSE_KIND` is, so a new kind cannot arrive without this decision.
 */
const BARE_COMMENT_OUTCOME: Record<DiagramKind, (belowHeader: boolean) => BareCommentOutcome> = {
  flowchart: (belowHeader) => ({ refused: belowHeader ? BARE_COMMENT_DRAWN : BARE_COMMENT_REFUSED }),
  sequence: () => "comment",
  class: (belowHeader) => (belowHeader ? "handed" : "comment"),
  state: () => "comment",
  er: () => ({ refused: BARE_COMMENT_REFUSED }),
};

/** `BARE_COMMENT_OUTCOME` for the line `at`, in a document of `header`'s kind; a comment where no kind is named. */
function bareCommentOutcome(header: Header | null, at: BareCommentLine): BareCommentOutcome {
  return header?.kind ? BARE_COMMENT_OUTCOME[header.kind](at.line > header.index + 1) : "comment";
}

/**
 * `lines` with each bare `%%` line in `bareCommentLines` above
 * `timelineStart` that `header`'s kind is handed (`BARE_COMMENT_OUTCOME`)
 * put back, at its column.
 */
function withBareCommentLines(
  lines: readonly string[],
  header: Header | null,
  timelineStart: number,
  bareCommentLines: readonly BareCommentLine[],
): readonly string[] {
  const handed = bareCommentLines.filter((at) => at.line - 1 < timelineStart && bareCommentOutcome(header, at) === "handed");
  if (handed.length === 0) return lines;
  const restored = [...lines];
  for (const at of handed) restored[at.line - 1] = `${" ".repeat(at.column - 1)}%%`;
  return restored;
}

/**
 * Sniffs the first non-blank line of Siren source text and dispatches to
 * `parseFlowchart` (a `flowchart TB|BT|LR|RL` header, or the same header
 * written with Mermaid's original `graph` keyword) or `parseSequenceDiagram`
 * (`sequenceDiagram` header), after reading the whole document as Mermaid
 * does — tag quotes, frontmatter, directives, `%%` comments and the
 * style-line rule (`asMermaidReads`). Each kind is handed its lines as
 * Mermaid's grammar is, up to its first timeline header, and reads a
 * mid-line `%%` itself; a timeline block's lines are cut at their first
 * `%%`.
 * Never throws on malformed input — an unrecognized header is reported as
 * a diagnostic instead.
 *
 * The **document config** — the frontmatter's merged with the directives'
 * (`documentConfigOf`), each init's `config` moved under the key of the kind
 * the header names — is `config` on the result, added after `asWritten` has
 * moved the diagram's positions: it is the author's data as written, and a
 * config key spelled `line` or `column` is not a position to move. Its
 * diagnostics come first, as its lines do. The frontmatter's `siren:` is
 * `siren` on the result, added the same way and on every outcome, a refused
 * diagram's included — but not a refused frontmatter's, which has none. A
 * frontmatter Mermaid refuses — one that is not YAML, or whose
 * `displayMode` has no mapping to go into — refuses the whole document
 * here too, as its one error, and the diagram below it is not read; so does
 * a wrap directive Mermaid cannot write into a bare-word init. So does a
 * line that is nothing but `%%` in a flowchart or an ER diagram, outside
 * its timeline blocks, one error at each such line's `%%` (ADR-0017):
 * Mermaid does not read it as a comment there.
 */
export function parseSiren(source: string): ParseResult {
  const {
    lines,
    header,
    timelineStart,
    asWritten,
    droppedOn,
    frontmatter,
    directives,
    bareCommentLines,
    commentedTargets,
  } = asMermaidReads(source);
  for (const read of [frontmatter, directives]) {
    if (read.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { document: null, diagnostics: read.diagnostics, config: {}, siren: frontmatter.siren };
    }
  }
  // One reading of the header serves both: `dispatch` hands the document to
  // the kind it names, and Mermaid's `detectInit` files an init's `config`
  // under that kind's diagram type. A timeline block is not Mermaid's to
  // read (ADR-0017: the document without its timeline blocks is the Mermaid
  // one), so a bare `%%` inside one stays a comment. The first timeline
  // header after the diagram's header ends the diagram body, as every kind's
  // parser ends it.
  const bareCommentRefusals = bareCommentLines.flatMap((at): Diagnostic[] => {
    if (at.line - 1 >= timelineStart) return [];
    const outcome = bareCommentOutcome(header, at);
    return typeof outcome === "string" ? [] : [{ severity: "error", message: outcome.refused, ...at }];
  });
  if (bareCommentRefusals.length > 0) {
    return { document: null, diagnostics: bareCommentRefusals, config: {}, siren: frontmatter.siren };
  }
  const documentConfig = documentConfigOf(frontmatter, directives, header?.kind ?? null);
  const parsed = dispatch(withBareCommentLines(lines, header, timelineStart, bareCommentLines), header, droppedOn);
  const { document, diagnostics } = asWritten({
    ...parsed,
    diagnostics: explainCommentedTargets(parsed.diagnostics, commentedTargets),
  });
  return {
    document,
    diagnostics: [...documentConfig.diagnostics, ...diagnostics],
    config: documentConfig.config,
    siren: frontmatter.siren,
  };
}

/**
 * The document's header: the first line of `lines` that is not blank, its
 * index, and the kind it names (`null` when it names none). `null` when
 * every line is blank.
 */
interface Header {
  index: number;
  kind: DiagramKind | null;
}

function headerOf(lines: readonly string[]): Header | null {
  const index = lines.findIndex((line) => line.trim().length > 0);
  return index === -1 ? null : { index, kind: matchDiagramHeader(lines[index]!.trim()) };
}

/**
 * The index of the first timeline header below the diagram's header at
 * `headerIndex` — where its body ends and its timeline blocks begin —
 * or `Infinity` when the document has none.
 */
function firstTimelineHeader(lines: readonly string[], headerIndex: number): number {
  const index = lines.findIndex((line, i) => i > headerIndex && isTimelineHeader(line.trim()));
  return index === -1 ? Infinity : index;
}

/**
 * `parseSiren`'s reading of `lines`, the document without its whole-line comments and
 * with Mermaid's style-line rule applied, whose `header` is `asMermaidReads`':
 * every position it finds is in those lines.
 */
function dispatch(lines: readonly string[], header: Header | null, dropped: DroppedSemicolons): DiagramParseResult {
  if (header === null) {
    const diagnostics: Diagnostic[] = [
      {
        severity: "error",
        message: `Empty document: expected a ${HEADER_SPELLINGS} header`,
        line: 1,
        column: 1,
      },
    ];
    return { document: null, diagnostics };
  }

  if (header.kind !== null) {
    // The source every per-kind parser sees, whole-line comments removed. Line count and
    // line order are untouched, so their diagnostics' line numbers still
    // match the document the author wrote. `dropped` says where the
    // style-line rule took a `;` out of a line, for a kind whose refusal
    // must name one; the text it hands over is the same either way.
    return PARSE_KIND[header.kind](lines.join("\n"), dropped);
  }

  const rawLine = lines[header.index]!;
  const trimmed = rawLine.trim();
  const column = rawLine.length - rawLine.trimStart().length + 1;
  const diagnostics: Diagnostic[] = [
    {
      severity: "error",
      message: `Expected ${HEADER_SPELLINGS}, found "${trimmed}"`,
      line: header.index + 1,
      column,
    },
  ];
  return { document: null, diagnostics };
}
