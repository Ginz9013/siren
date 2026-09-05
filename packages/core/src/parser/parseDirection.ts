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

const FLOWCHART_HEADER_RE = new RegExp(`^flowchart\\s+(${ALTERNATION})\\s*$`);
const CLASS_DIRECTION_RE = new RegExp(`^direction\\s+(${ALTERNATION})$`);

/**
 * The flowchart headers a diagnostic names. `TD` is deliberately absent: it
 * parses, but `TB` is the spelling to teach, and an author who wrote `TD`
 * never sees one of these messages anyway.
 */
const FLOWCHART_HEADERS = [
  "flowchart TB",
  "flowchart BT",
  "flowchart LR",
  "flowchart RL",
] as const;

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
 * Reads a `flowchart ...` header line, returning the direction it names with
 * the `TD` alias already resolved, or `null` when the line is not one.
 *
 * The regex and the alias live behind this call rather than being exported,
 * so no caller can match the header without also resolving the alias.
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
