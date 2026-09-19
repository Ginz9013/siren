import type { Direction, SirenDocument } from "../contracts";

/**
 * Every direction spelling an author may write, mapped to the one the rest of
 * the pipeline uses. `TD` is Mermaid's alias for `TB`, and this map is the
 * only place that fact is written down.
 *
 * The regexes below derive their alternation from these keys, so a spelling
 * cannot be accepted without also being given a meaning — which is the point
 * of this module. Two parsers accepting the same five spellings by way of two
 * regexes and two ternaries is how the two of them drift apart one spelling at
 * a time.
 */
const CANONICAL_DIRECTION = new Map<string, Direction>([
  ["TB", "TB"],
  ["TD", "TB"],
  ["BT", "BT"],
  ["LR", "LR"],
  ["RL", "RL"],
]);

const ALTERNATION = [...CANONICAL_DIRECTION.keys()].join("|");

/**
 * Every keyword that opens a flowchart. `graph` is Mermaid's original word
 * and still the one most documents in the wild open with; `flowchart` is the
 * modern spelling of the same diagram.
 *
 * Which one an author wrote is resolved here and nowhere else, exactly as
 * `TD` is: `matchFlowchartHeader` answers with a direction, so no caller —
 * and no document, model or renderer downstream — can tell the two apart.
 */
const FLOWCHART_KEYWORDS = ["flowchart", "graph"] as const;

const KEYWORD_ALTERNATION = FLOWCHART_KEYWORDS.join("|");

const FLOWCHART_HEADER_RE = new RegExp(
  `^(?:${KEYWORD_ALTERNATION})\\s+(${ALTERNATION})\\s*$`,
);
const CLASS_DIRECTION_RE = new RegExp(`^direction\\s+(${ALTERNATION})$`);

/**
 * The direction spellings a diagnostic teaches: the canonical ones, with
 * every alias filtered out by the one fact that makes it an alias — its key
 * and its meaning differ. `TD` is therefore absent: it parses, but `TB` is
 * the spelling to teach, and an author who wrote `TD` never sees one of
 * these messages anyway.
 */
const TAUGHT_DIRECTIONS = [...CANONICAL_DIRECTION]
  .filter(([spelling, direction]) => spelling === direction)
  .map(([spelling]) => spelling);

/**
 * The flowchart headers a diagnostic names — both keywords, every taught
 * direction, derived from the two lists the regex is derived from so the
 * message cannot name a set the parser does not accept.
 *
 * `graph` is named where `TD` is not, and the asymmetry is deliberate: an
 * author who wrote `graph SIDEWAYS` *does* reach this message, with the
 * keyword half of their line already correct. A list naming only the
 * `flowchart` spellings would send them off to rewrite the half that was
 * fine.
 */
const FLOWCHART_HEADERS = FLOWCHART_KEYWORDS.flatMap((keyword) =>
  TAUGHT_DIRECTIONS.map((direction) => `${keyword} ${direction}`),
);

/**
 * Which diagram a header opens. Taken from `SirenDocument` rather than
 * spelled again here, which is what makes a fifth kind a compile error in
 * this file the moment `contracts.ts` learns about it: the record below has
 * to gain a row, and gaining that row is the whole of teaching every
 * diagnostic in the parser what the new header looks like.
 */
export type DiagramKind = SirenDocument["kind"];

interface DiagramHeader {
  /** The spellings a diagnostic names, in the order it names them. */
  readonly spellings: readonly string[];
  /** Whether an already-trimmed line is this kind's header. */
  readonly matches: (line: string) => boolean;
}

/**
 * A diagram kind whose header is a bare keyword, with no direction or other
 * argument after it — every kind but flowchart, so far.
 *
 * The matcher is *derived from* the spellings rather than written beside
 * them, so a spelling cannot be named by a diagnostic without also being
 * accepted, nor accepted without being named. That is the same bargain
 * `CANONICAL_DIRECTION` strikes above, and it is why the alternation is
 * built here instead of each parser keeping its own literal regex: two
 * regexes for one keyword is exactly how `parseSiren` came to dispatch
 * `classDiagram-v2` while its diagnostic denied the spelling existed.
 *
 * Every Mermaid header keyword is letters, digits and `-`, none of which
 * mean anything in an alternation, so the spellings go in unescaped.
 */
function keywordHeader(...spellings: readonly string[]): DiagramHeader {
  const headerRe = new RegExp(`^(?:${spellings.join("|")})\\s*$`);
  return { spellings, matches: (line) => headerRe.test(line) };
}

/**
 * Every accepted header in the language, by kind — the one list, and the
 * reason `listAcceptedHeaders` exists rather than each parser quoting its
 * own keyword into its own message.
 *
 * Flowchart is the kind that cannot be a `keywordHeader`: its header carries
 * a direction, so its matcher is `FLOWCHART_HEADER_RE` and accepts one
 * spelling its `spellings` deliberately omit — `TD`, for the reason
 * `TAUGHT_DIRECTIONS` gives. Every other kind's two halves are the same
 * list, and adding a kind means adding one row here and nothing else.
 */
const DIAGRAM_HEADERS: Record<DiagramKind, DiagramHeader> = {
  flowchart: {
    spellings: FLOWCHART_HEADERS,
    matches: (line) => FLOWCHART_HEADER_RE.test(line),
  },
  sequence: keywordHeader("sequenceDiagram"),
  class: keywordHeader("classDiagram", "classDiagram-v2"),
  // Two spellings of one kind, exactly as the class diagram's are: measured
  // against mermaid 11.17.2, `stateDiagram` and `stateDiagram-v2` both report
  // the diagram type `stateDiagram`. Collapsing them here is what keeps that
  // fact in one place rather than in a parser and a diagnostic separately.
  state: keywordHeader("stateDiagram", "stateDiagram-v2"),
};

const EVERY_KIND = Object.keys(DIAGRAM_HEADERS) as DiagramKind[];

/**
 * Quotes a list of spellings the way every diagnostic in this parser names a
 * set the author could have written: `"a"`, `"a" or "b"`, `"a", "b", or "c"`.
 *
 * The two-item form drops the comma because a two-item list reads as a
 * choice rather than an enumeration — which is what the class diagram's
 * message said by hand before this function existed, and it stays true now
 * that the same code prints the flowchart's eight.
 */
function quoteList(spellings: readonly string[]): string {
  const quoted = spellings.map((spelling) => `"${spelling}"`);
  if (quoted.length <= 1) {
    return quoted.join("");
  }
  if (quoted.length === 2) {
    return `${quoted[0]} or ${quoted[1]}`;
  }
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
}

/**
 * Formats the headers a diagnostic teaches: the given kinds' spellings, or —
 * with no argument — every kind the language has, which is what the
 * dispatcher wants and what keeps its message correct on the day a kind is
 * added without anyone remembering this call exists.
 *
 * Shared so that a kind's own parser and the dispatcher cannot drift into
 * naming different sets, and so that neither can name a set the matcher
 * above does not accept.
 */
export function listAcceptedHeaders(kinds: readonly DiagramKind[] = EVERY_KIND): string {
  return quoteList(kinds.flatMap((kind) => DIAGRAM_HEADERS[kind].spellings));
}

/**
 * Reads a header line — already trimmed — and answers which diagram it
 * opens, or `null` when it opens none.
 *
 * This is the only way to ask, which is the point: the regexes and the
 * spellings stay unexported, so a parser can neither match a header with a
 * private copy of the pattern nor quote a spelling into a message without
 * going through `listAcceptedHeaders`. A kind's own parser asks the same
 * question the dispatcher does and compares the answer against itself, so
 * `parseSequenceDiagram` rejects `classDiagram` by the same rule that sends
 * it elsewhere.
 */
export function matchDiagramHeader(line: string): DiagramKind | null {
  return EVERY_KIND.find((kind) => DIAGRAM_HEADERS[kind].matches(line)) ?? null;
}

/**
 * Reads a `flowchart ...` or `graph ...` header line, returning the direction
 * it names with the `TD` alias already resolved, or `null` when the line is
 * not one.
 *
 * The regex and both aliases live behind this call rather than being
 * exported, so no caller can match the header without also resolving them —
 * and the answer is a direction, which is why no caller can learn which of
 * the two keywords was written.
 */
export function matchFlowchartHeader(line: string): Direction | null {
  const match = FLOWCHART_HEADER_RE.exec(line);
  return match === null ? null : (CANONICAL_DIRECTION.get(match[1]) ?? null);
}

/**
 * Reads a class diagram's `direction ...` statement, on the same terms as
 * `matchFlowchartHeader`: the direction with the alias resolved, or `null`.
 */
export function matchClassDirection(line: string): Direction | null {
  const match = CLASS_DIRECTION_RE.exec(line);
  return match === null ? null : (CANONICAL_DIRECTION.get(match[1]) ?? null);
}
