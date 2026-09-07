import type { Direction } from "../contracts";

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
 * Formats the accepted headers the way every header diagnostic in this parser
 * lists them, optionally followed by the other diagram kinds' headers. Shared
 * so the dispatcher and the flowchart parser cannot drift into naming
 * different sets.
 */
export function listAcceptedHeaders(alsoAccepted: readonly string[] = []): string {
  const quoted = [...FLOWCHART_HEADERS, ...alsoAccepted].map((header) => `"${header}"`);
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
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
