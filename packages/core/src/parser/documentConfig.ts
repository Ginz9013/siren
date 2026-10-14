import { JSON_SCHEMA, load, YAMLException } from "js-yaml";
import type { Diagnostic } from "../contracts";

/**
 * A document's frontmatter, read as Mermaid 12.2.0 reads it, and the
 * document left behind once it is gone.
 *
 * - `source` is the document with the frontmatter's lines blanked in place:
 *   every character but the line breaks removed, so each later line keeps
 *   its number and every diagnostic still points at the line the author
 *   wrote. A document with no frontmatter comes back as it was given.
 * - `config` is the frontmatter's `config` as written — the **document
 *   config** — or `{}` when there is none.
 * - `diagnostics` says what was read and is not applied, or why the
 *   frontmatter could not be read at all; `refused` is set in that last
 *   case, when Mermaid refuses the whole document too.
 */
export interface FrontmatterRead {
  source: string;
  config: Record<string, unknown>;
  diagnostics: Diagnostic[];
  refused: boolean;
}

/**
 * Mermaid's `whitespace` (`diagram-api/regexes.ts`): one character of
 * JavaScript's `\s`, which is wider than ASCII — a no-break space indents a
 * frontmatter as well as a space does.
 */
const WHITESPACE = /\s/;

const isLineBreak = (char: string | undefined): boolean => char === "\n" || char === "\r";

/**
 * Reads the frontmatter at the top of `text`, the document after Mermaid's
 * `cleanupText` — its tag quotes rewritten and its line breaks `\n` — which
 * is where Mermaid's `preprocessDiagram` reads it: after `cleanupText` and
 * before directives or comments are touched, so a `%%` inside a frontmatter
 * is YAML, not a comment.
 *
 * The rules are Mermaid's (`processFrontmatter` over `extractFrontMatter`
 * over `matchFrontMatter`, ported rather than imported — ADR-0001):
 *
 * - **Only at the very top.** The first line may be indented by whitespace
 *   that is not a line break, and must then begin `---` with nothing but
 *   whitespace after it. A blank line above the fence, or anything else,
 *   means there is no frontmatter, and the `---` is read as diagram text —
 *   which no diagram header accepts.
 * - **Closed by the same indent.** A closing fence is a line break followed
 *   by the opening line's indent and `---`, with only whitespace up to a
 *   later line break. The frontmatter runs to the first such fence at or
 *   before the last one in the document; a document none of whose lines
 *   closes it has no frontmatter. The indent is taken off each body line
 *   that starts with it before the YAML is read.
 * - **YAML under the JSON schema** (`js-yaml`, as Mermaid uses it). A body
 *   that reads as anything but a mapping — a string, a list, nothing — is
 *   an empty frontmatter, not a mistake.
 * - **Only the keys Mermaid knows.** `config` is kept as written. A key
 *   Mermaid does not know is dropped unread, as Mermaid drops it.
 */
export function readFrontmatter(text: string): FrontmatterRead {
  const match = matchFrontmatter(text);
  if (match === undefined) {
    return { source: text, config: {}, diagnostics: [], refused: false };
  }
  const yamlBody = match.indent
    ? match.body
        .split("\n")
        .map((line) => (line.startsWith(match.indent) ? line.slice(match.indent.length) : line))
        .join("\n")
    : match.body;
  // The opening fence: line 1 always, since an indent holds no line break.
  const at = { line: 1, column: match.indent.length + 1 };
  let loaded: unknown;
  try {
    loaded = load(yamlBody, { schema: JSON_SCHEMA });
  } catch (error) {
    // Mermaid lets js-yaml's exception escape and draws nothing; so does
    // this, as a diagnostic rather than a throw.
    const reason = error instanceof YAMLException ? error.reason : String(error);
    return {
      source: text,
      config: {},
      diagnostics: [
        {
          severity: "error",
          message: `Frontmatter is not valid YAML (${reason}); Mermaid refuses the document too.`,
          ...at,
        },
      ],
      refused: true,
    };
  }
  const parsed = asMapping(loaded);
  const config = isMapping(parsed.config) ? parsed.config : {};
  if (parsed.displayMode) {
    // `processFrontmatter`: a top-level `displayMode` is Gantt's, and lands
    // in `config.gantt` beside whatever the author wrote there.
    const gantt = isMapping(config.gantt) ? config.gantt : {};
    gantt.displayMode = String(parsed.displayMode);
    config.gantt = gantt;
  }
  const diagnostics: Diagnostic[] = [];
  if (parsed.title) {
    diagnostics.push({
      severity: "warning",
      message: "Frontmatter title is read but not drawn yet; the diagram is drawn without it.",
      ...at,
    });
  }
  for (const key of Object.keys(config)) {
    diagnostics.push({ severity: "warning", message: notAppliedYet(key), ...at });
  }
  return {
    source: text.slice(0, match.length).replace(/[^\n]/g, "") + text.slice(match.length),
    config,
    diagnostics,
    refused: false,
  };
}

/**
 * The warning for a top-level document config key Siren reads and keeps but
 * does not act on yet (ADR-0017's first step: read every key, apply none).
 * Mermaid would apply it, so the picture differs, and saying so beats
 * dropping it in silence.
 */
function notAppliedYet(key: string): string {
  return `Document config "${key}" is read but not applied yet; the diagram is drawn without it.`;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What `extractFrontMatter` keeps of a loaded body: a mapping, or nothing at all. */
function asMapping(value: unknown): Record<string, unknown> {
  return isMapping(value) ? value : {};
}

/**
 * Mermaid's `matchFrontMatter`, step for step: where the frontmatter at the
 * top of `text` is, as its opening line's `indent`, the YAML `body` between
 * the fences, and the `length` of text it takes up — which runs past the
 * closing fence through the last line break of the whitespace after it, so
 * it always ends on a line break. `undefined` when `text` has none.
 */
function matchFrontmatter(text: string): { indent: string; body: string; length: number } | undefined {
  let cursor = 0;
  while (cursor < text.length && WHITESPACE.test(text[cursor]!) && !isLineBreak(text[cursor])) {
    cursor++;
  }
  const indent = text.slice(0, cursor);
  if (!text.startsWith("---", cursor)) {
    return undefined;
  }
  const openingEnds: number[] = [];
  for (let i = cursor + 3; i < text.length && WHITESPACE.test(text[i]!); i++) {
    if (isLineBreak(text[i])) {
      openingEnds.push(i);
    }
  }
  if (openingEnds.length === 0) {
    return undefined;
  }
  const closingFence = `${indent}---`;
  const closingEnd = (i: number): number =>
    isLineBreak(text[i]) && text.startsWith(closingFence, i + 1)
      ? lastLineBreakInWhitespaceRun(text, i + 1 + closingFence.length)
      : -1;
  let lastClosingFence = -1;
  for (let i = openingEnds[0]! + 1; i < text.length; i++) {
    if (closingEnd(i) !== -1) {
      lastClosingFence = i;
    }
  }
  if (lastClosingFence === -1) {
    return undefined;
  }
  let openingEnd = openingEnds[0]!;
  for (const candidate of openingEnds) {
    if (candidate < lastClosingFence) {
      openingEnd = candidate;
    }
  }
  const bodyStart = openingEnd + 1;
  for (let i = bodyStart; i <= lastClosingFence; i++) {
    const matchEnd = closingEnd(i);
    if (matchEnd !== -1) {
      return { indent, body: text.slice(bodyStart, i), length: matchEnd + 1 };
    }
  }
  return undefined;
}

/**
 * Mermaid's `lastLineBreakInWhitespaceRun`: the index of the last line break
 * in the run of whitespace starting at `from`, or `-1` when the run holds
 * none — so a closing fence followed by more text on its own line, or by the
 * end of the document, closes nothing.
 */
function lastLineBreakInWhitespaceRun(text: string, from: number): number {
  let index = -1;
  for (let i = from; i < text.length && WHITESPACE.test(text[i]!); i++) {
    if (isLineBreak(text[i])) {
      index = i;
    }
  }
  return index;
}
