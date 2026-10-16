import { JSON_SCHEMA, load, YAMLException } from "js-yaml";
import type { NodeShape } from "../contracts";

/**
 * A flowchart node's `@{ … }` data block — `A@{ shape: circle, label: "x" }`
 * — read as Mermaid 12.2.0 reads it: what is between the braces is YAML
 * under the JSON schema, a block on one line wrapped in `{ … }` first so
 * that it reads as a flow mapping (`FlowDB.addVertex`, measured with
 * `pnpm --filter siren-core probe`).
 *
 * Only what Siren can draw is read here: the shape names that are one of
 * Siren's fourteen node shapes, and a label.
 */

/**
 * Every `shape:` name that draws one of Siren's fourteen node shapes: each
 * shape's short name and every alias Mermaid 12.2.0's `shapesDefs` lists for
 * the handler its bracket spelling draws, plus the one lowercase internal
 * alias it also accepts (`doublecircle`). Case matters: Mermaid refuses any
 * name with an upper-case letter or a `_` (measured). Each shape's first name
 * is its short name.
 */
const SHAPE_NAMES: ReadonlyArray<readonly [NodeShape, readonly [string, ...string[]]]> = [
  ["rect", ["rect", "proc", "process", "rectangle"]],
  ["round", ["rounded", "event"]],
  ["stadium", ["stadium", "terminal", "pill"]],
  ["subroutine", ["fr-rect", "subprocess", "subproc", "framed-rectangle", "subroutine"]],
  ["cylinder", ["cyl", "db", "database", "cylinder"]],
  ["circle", ["circle", "circ"]],
  ["rhombus", ["diam", "decision", "diamond", "question"]],
  ["hexagon", ["hex", "hexagon", "prepare"]],
  ["parallelogram", ["lean-r", "lean-right", "in-out"]],
  ["parallelogram-alt", ["lean-l", "lean-left", "out-in"]],
  ["trapezoid", ["trap-b", "priority", "trapezoid-bottom", "trapezoid"]],
  ["trapezoid-alt", ["trap-t", "manual", "trapezoid-top", "inv-trapezoid"]],
  ["double-circle", ["dbl-circ", "double-circle", "doublecircle"]],
  ["asymmetric", ["odd"]],
];

/** Each name in `SHAPE_NAMES`, and the shape it draws. */
export const NODE_DATA_SHAPES: ReadonlyMap<string, NodeShape> = new Map(
  SHAPE_NAMES.flatMap(([shape, names]) => names.map((name) => [name, shape] as const)),
);

/**
 * The shape names Mermaid 12.2.0 draws and Siren does not yet: every name of
 * the 39 shapes `shapesDefs` documents beyond the fourteen above, and the
 * six undocumented lowercase names its shape map also accepts (`state`,
 * `choice`, `note`, `composite`, `icon`, `anchor`; measured). Told apart
 * from a name that is no shape at all only so the message can say which.
 */
const UNDRAWN_SHAPE_NAMES: ReadonlySet<string> = new Set([
  ...["datastore", "data-store", "folder", "directory", "bucket", "console", "browser", "person", "bang"],
  ...["cloud", "text", "notch-rect", "card", "notched-rectangle", "lin-rect", "lined-rectangle"],
  ...["lined-process", "lin-proc", "shaded-process", "sm-circ", "start", "small-circle", "fr-circ"],
  ...["stop", "framed-circle", "fork", "join", "hourglass", "collate", "brace", "comment", "brace-l"],
  ...["brace-r", "braces", "bolt", "com-link", "lightning-bolt", "doc", "document", "delay"],
  ...["half-rounded-rectangle", "h-cyl", "das", "horizontal-cylinder", "lin-cyl", "disk"],
  ...["lined-cylinder", "curv-trap", "curved-trapezoid", "display", "div-rect", "div-proc"],
  ...["divided-rectangle", "divided-process", "tri", "extract", "triangle", "win-pane"],
  ...["internal-storage", "window-pane", "f-circ", "junction", "filled-circle", "notch-pent"],
  ...["loop-limit", "notched-pentagon", "flip-tri", "manual-file", "flipped-triangle", "sl-rect"],
  ...["manual-input", "sloped-rectangle", "docs", "documents", "st-doc", "stacked-document"],
  ...["st-rect", "procs", "processes", "stacked-rectangle", "bow-rect", "stored-data"],
  ...["bow-tie-rectangle", "cross-circ", "summary", "crossed-circle", "tag-doc", "tagged-document"],
  ...["tag-rect", "tagged-rectangle", "tag-proc", "tagged-process", "flag", "paper-tape", "lin-doc"],
  ...["lined-document"],
  ...["state", "choice", "note", "composite", "icon", "anchor"],
]);

/** One short name per shape Siren draws: what a refused name is told to choose from. */
const SHAPE_CHOICES = SHAPE_NAMES.map(([, [shortName]]) => shortName).join(", ");

/** Something a block says that is not drawn as written, worded for the author. */
export interface NodeDataProblem {
  severity: "error" | "warning";
  message: string;
}

/** What reading one `@{ … }` block found. */
export interface NodeData {
  problems: NodeDataProblem[];
  /** The shape it names, or `null` when it names none. */
  shape: NodeShape | null;
  /**
   * The label it gives, as text still to be read as a label, and whether it
   * is a Markdown label; `null` when it gives none.
   */
  label: { text: string; markdown: boolean } | null;
}

/** The keys this reader draws. */
const READ_KEYS: ReadonlySet<string> = new Set(["shape", "label", "labelType"]);

/**
 * The keys that change what Mermaid 12.2.0 draws for a node and that Siren
 * does not draw yet: an icon or an image node, its form, its label's
 * position and its size (`FlowDB.addVertex`). Any other key is read by
 * Mermaid and ignored for a node (`A@{ foo: 1 }`, measured).
 */
const UNSUPPORTED_KEYS: ReadonlySet<string> = new Set(["icon", "img", "form", "pos", "w", "h", "constraint"]);

/**
 * The `labelType` values that make a block's label an ordinary one rather
 * than a Markdown one. Mermaid 12.2.0 reads any other value, and none, as
 * `markdown` (`sanitizeNodeLabelType`; measured, `A@{ label: "**b**" }`
 * draws `b` bold, and with `labelType: text` draws `**b**`).
 */
const PLAIN_LABEL_TYPES: ReadonlySet<unknown> = new Set(["text", "string"]);

/**
 * Reads the text between a node's `@{` and its `}`.
 *
 * A key Mermaid tests for truth is read only when its value is truthy, as
 * Mermaid reads it: `label: ""` and `shape:` (a null) say nothing.
 */
export function readNodeData(written: string): NodeData {
  // Mermaid's lexer turns a line break inside a quoted string, and the
  // indentation after it, into `<br/>` before the YAML is read (measured,
  // `label: "a⏎   b"` is `a<br/>b`); a block holding a line break anywhere
  // else is block YAML, and one on one line a flow mapping.
  const content = written.replace(/"[^"]*"?/g, (string) => string.replace(/\n\s*/g, "<br/>"));
  const yaml = content.includes("\n") ? `${content}\n` : `{\n${content}\n}`;
  const refused = (message: string): NodeData => ({
    problems: [{ severity: "error", message }],
    shape: null,
    label: null,
  });
  let loaded: unknown;
  try {
    loaded = load(yaml, { schema: JSON_SCHEMA });
  } catch (error) {
    if (error instanceof YAMLException) {
      return refused(`The "@{ … }" block is not valid YAML (${error.reason})`);
    }
    throw error;
  }
  if (loaded !== null && loaded !== undefined && (typeof loaded !== "object" || Array.isArray(loaded))) {
    return refused('Write the "@{ … }" block as "key: value" pairs, such as "shape: circle"');
  }
  const doc = (loaded ?? {}) as Record<string, unknown>;
  const problems: NodeDataProblem[] = [];
  for (const key of Object.keys(doc)) {
    if (UNSUPPORTED_KEYS.has(key)) {
      problems.push({
        severity: "error",
        message: `Siren does not support "${key}" in a node's "@{ … }" block yet. Leave it out`,
      });
    } else if (!READ_KEYS.has(key)) {
      problems.push({
        severity: "warning",
        message: `"${key}" is not a key of a node's "@{ … }" block, and is ignored. Remove it`,
      });
    }
  }
  const shape = doc.shape ? readShape(doc.shape, problems) : null;
  let label: NodeData["label"] = null;
  if (doc.label && typeof doc.label === "object") {
    problems.push({ severity: "error", message: 'A label is text, such as "label: Start"' });
  } else if (doc.label) {
    label = { text: String(doc.label), markdown: !PLAIN_LABEL_TYPES.has(doc.labelType) };
  }
  return { problems, shape, label };
}

/**
 * The shape a `shape:` value names, or `null` with the reason in `problems`.
 * The checks are Mermaid 12.2.0's, in its order: a name with an upper-case
 * letter or a `_` is refused before it is looked up (`FlowDB.addVertex`).
 */
function readShape(value: unknown, problems: NodeDataProblem[]): NodeShape | null {
  if (typeof value !== "string") {
    problems.push({ severity: "error", message: 'A shape is a name, such as "shape: circle"' });
    return null;
  }
  const shape = NODE_DATA_SHAPES.get(value);
  if (shape !== undefined) {
    return shape;
  }
  if (value !== value.toLowerCase() || value.includes("_")) {
    const spelled = value.toLowerCase().replaceAll("_", "-");
    const rule = `There is no shape "${value}". Shape names are lower-case, with "-" between words`;
    problems.push({
      severity: "error",
      message: NODE_DATA_SHAPES.has(spelled) ? `${rule}: ${spelled}` : `${rule}. Use one of: ${SHAPE_CHOICES}`,
    });
  } else if (UNDRAWN_SHAPE_NAMES.has(value)) {
    problems.push({
      severity: "error",
      message: `Siren does not draw the shape "${value}" yet. Use one of: ${SHAPE_CHOICES}`,
    });
  } else {
    problems.push({ severity: "error", message: `There is no shape "${value}". Use one of: ${SHAPE_CHOICES}` });
  }
  return null;
}

/** What opens a node's data block, right after the node: `A@{`. */
export const NODE_DATA_OPENER = "@{";

/**
 * Where the `}` closing the `@{` at `at` stands, plus one — or `null` when
 * the text ends first. Mermaid's lexer reads a `"` inside the block as
 * opening or closing a string, and a `}` inside a string as text
 * (`A@{ label: "a}b" }` is the label `a}b`, measured).
 */
export function nodeDataEnd(text: string, at: number): number | null {
  let quoted = false;
  for (let i = at + NODE_DATA_OPENER.length; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === "}") {
      return i + 1;
    }
  }
  return null;
}

/**
 * Every `@{ … }` block in `text` written outside a label's brackets and
 * outside a quoted string: where its `@` stands, and where it ends
 * (`nodeDataEnd`), `null` when nothing closes it — which is then the last.
 */
function* nodeDataBlocks(text: string): Generator<{ at: number; end: number | null }> {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      quoted = !quoted;
    } else if (quoted) {
      continue;
    } else if (depth === 0 && text.startsWith(NODE_DATA_OPENER, i)) {
      const end = nodeDataEnd(text, i);
      yield { at: i, end };
      if (end === null) {
        return;
      }
      i = end - 1;
    } else if ("[{(".includes(char)) {
      depth++;
    } else if ("]})".includes(char) && depth > 0) {
      depth--;
    }
  }
}

/** The first `@{ … }` block in `text` (`nodeDataBlocks`), or `null` when there is none. */
export function nodeDataBlockIn(text: string): { at: number; end: number | null } | null {
  return nodeDataBlocks(text).next().value ?? null;
}

/**
 * Joins an `@{ … }` block back into one physical line when the `}` closing
 * it lies on a later one — the multi-line block Mermaid 12.2.0 reads as
 * block YAML (`A@{` ⏎ `shape: circle` ⏎ `}`, measured). The rule
 * `joinMarkdownFences` follows: the lines a block swallows are blanked
 * rather than removed, so every later line keeps its number, and the
 * joined text lands on the line the block opens on. A block never closed
 * is joined through to the last line.
 */
export function joinNodeDataBlocks(lines: readonly string[]): string[] {
  const joined = [...lines];
  for (let i = 0; i < joined.length; i++) {
    let text = joined[i]!;
    let end = i;
    // Each pass looks only at what it has not seen: the open block's own
    // quotes carried from line to line until its `}`, and then the rest of
    // that line for a further block. Rescanning the joined text at every
    // line would be quadratic in a block never closed.
    let { open, quoted } = openBlockAtEnd(text);
    while (open && end + 1 < joined.length) {
      end++;
      const line = joined[end]!;
      text += "\n" + line;
      const close = closingBraceIn(line, quoted);
      if (close === null) {
        quoted = quotedAtEnd(line, quoted);
        continue;
      }
      ({ open, quoted } = openBlockAtEnd(line.slice(close)));
    }
    if (end > i) {
      joined[i] = text;
      joined.fill("", i + 1, end + 1);
      i = end;
    }
  }
  return joined;
}

/**
 * Whether `text` ends inside an `@{ … }` block it opens, and if so whether
 * inside one of that block's strings.
 */
function openBlockAtEnd(text: string): { open: boolean; quoted: boolean } {
  const last = [...nodeDataBlocks(text)].at(-1);
  if (last === undefined || last.end !== null) {
    return { open: false, quoted: false };
  }
  return { open: true, quoted: quotedAtEnd(text.slice(last.at + NODE_DATA_OPENER.length)) };
}

/** Whether a block's string is open at the end of `text`, given whether it was at its start. */
function quotedAtEnd(text: string, quoted = false): boolean {
  let open = quoted;
  for (const char of text) {
    if (char === '"') {
      open = !open;
    }
  }
  return open;
}

/**
 * Where, past the `}` closing an open block, `text` goes on — the block's
 * string open at its start when `quoted` — or `null` when no `}` closes it.
 */
function closingBraceIn(text: string, quoted: boolean): number | null {
  let open = quoted;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      open = !open;
    } else if (!open && text[i] === "}") {
      return i + 1;
    }
  }
  return null;
}
