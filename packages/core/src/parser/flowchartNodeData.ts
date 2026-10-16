import { JSON_SCHEMA, load, YAMLException } from "js-yaml";
import type { NodeShape } from "../contracts";
import { SHAPES } from "../layout/shapes/shapeTable";

/**
 * A flowchart node's `@{ … }` data block — `A@{ shape: circle, label: "x" }`
 * — read as Mermaid 12.2.0 reads it: what is between the braces is YAML
 * under the JSON schema, a block on one line wrapped in `{ … }` first so
 * that it reads as a flow mapping (`FlowDB.addVertex`, measured with
 * `pnpm --filter siren-core probe`).
 *
 * Only what Siren can draw is read here: the shape names of the shapes
 * Siren draws, and a label.
 */

/**
 * Every `shape:` name that draws one of the fourteen shapes Mermaid also
 * spells with brackets: each shape's short name and every alias Mermaid 12.2.0's `shapesDefs` lists for
 * the handler its bracket spelling draws, plus the one lowercase internal
 * alias it also accepts (`doublecircle`). Case matters: Mermaid refuses any
 * name with an upper-case letter or a `_` (measured). Each shape's first name
 * is its short name.
 */
const BRACKET_SHAPE_NAMES: ReadonlyArray<readonly [NodeShape, readonly [string, ...string[]]]> = [
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

/**
 * Every `shape:` name of the shapes Mermaid 12.2.0 names only in a `@{ … }`
 * block and Siren draws from its shape table (`layout/shapes/`): the short
 * name, every alias `shapesDefs`
 * lists for the shape's handler, and the undocumented lowercase names its
 * shape map also accepts. Measured: every alias draws what its short name
 * draws. A shape added to the table adds its row here.
 */
const TABLE_SHAPE_NAMES: ReadonlyArray<readonly [NodeShape, readonly [string, ...string[]]]> = [
  ["notched-rectangle", ["notch-rect", "card", "notched-rectangle"]],
  ["folder", ["folder", "directory"]],
  ["notched-pentagon", ["notch-pent", "loop-limit", "notched-pentagon"]],
  ["sloped-rectangle", ["sl-rect", "manual-input", "sloped-rectangle"]],
  ["triangle", ["tri", "extract", "triangle"]],
  ["flipped-triangle", ["flip-tri", "manual-file", "flipped-triangle"]],
  ["lined-rectangle", ["lin-rect", "lined-rectangle", "lined-process", "lin-proc", "shaded-process"]],
  ["divided-rectangle", ["div-rect", "div-proc", "divided-rectangle", "divided-process"]],
  ["window-pane", ["win-pane", "internal-storage", "window-pane"]],
  ["stacked-rectangle", ["st-rect", "procs", "processes", "stacked-rectangle"]],
  ["tagged-rectangle", ["tag-rect", "tagged-rectangle", "tag-proc", "tagged-process"]],
  ["text", ["text"]],
  ["composite", ["composite"]],
  ["note", ["note"]],
  ["data-store", ["datastore", "data-store"]],
  ["state", ["state"]],
  // The shapes drawn at a fixed size, with no text.
  ["fork", ["fork", "join"]],
  ["hourglass", ["hourglass", "collate"]],
  ["bolt", ["bolt", "com-link", "lightning-bolt"]],
  ["small-circle", ["sm-circ", "start", "small-circle"]],
  ["framed-circle", ["fr-circ", "stop", "framed-circle"]],
  ["filled-circle", ["f-circ", "junction", "filled-circle"]],
  ["anchor", ["anchor"]],
  ["crossed-circle", ["cross-circ", "summary", "crossed-circle"]],
  ["choice", ["choice"]],
  // The shapes with a curved outline.
  ["half-rounded-rectangle", ["delay", "half-rounded-rectangle"]],
  ["curved-trapezoid", ["curv-trap", "curved-trapezoid", "display"]],
  ["horizontal-cylinder", ["h-cyl", "das", "horizontal-cylinder"]],
  ["lined-cylinder", ["lin-cyl", "disk", "lined-cylinder"]],
  ["bow-tie-rectangle", ["bow-rect", "stored-data", "bow-tie-rectangle"]],
  ["document", ["doc", "document"]],
  ["lined-document", ["lin-doc", "lined-document"]],
  ["tagged-document", ["tag-doc", "tagged-document"]],
  ["stacked-document", ["docs", "documents", "st-doc", "stacked-document"]],
  ["flag", ["flag", "paper-tape"]],
  ["brace-left", ["brace", "comment", "brace-l"]],
  ["brace-right", ["brace-r"]],
  ["braces", ["braces"]],
];

const SHAPE_NAMES = [...BRACKET_SHAPE_NAMES, ...TABLE_SHAPE_NAMES];

/** Each name in `SHAPE_NAMES`, and the shape it draws. */
export const NODE_DATA_SHAPES: ReadonlyMap<string, NodeShape> = new Map(
  SHAPE_NAMES.flatMap(([shape, names]) => names.map((name) => [name, shape] as const)),
);

/**
 * The shape names Mermaid 12.2.0 draws and Siren does not yet: every name of
 * the shapes `shapesDefs` documents that neither list above holds, and the
 * undocumented lowercase name its shape map also accepts (`icon`; measured)
 * that Siren does not draw yet. Told apart
 * from a name that is no shape at all only so the message can say which.
 */
const UNDRAWN_SHAPE_NAMES: ReadonlySet<string> = new Set([
  // The shapes drawn as a figure
  ...["bucket", "person", "console", "browser", "cloud", "bang"],
  // An icon
  ...["icon"],
]);

/**
 * Every name in each of the three lists, for the test that keeps them
 * disjoint: a name in two of them would be drawn by whichever list is read
 * first and described wrongly by the other.
 */
export const SHAPE_NAME_LISTS: {
  readonly bracket: readonly string[];
  readonly table: readonly string[];
  readonly undrawn: readonly string[];
} = {
  bracket: BRACKET_SHAPE_NAMES.flatMap(([, names]) => names),
  table: TABLE_SHAPE_NAMES.flatMap(([, names]) => names),
  undrawn: [...UNDRAWN_SHAPE_NAMES],
};

/**
 * The examples a refused name is pointed to, introduced as examples ("such
 * as"): one short name for each of the fourteen shapes Mermaid also spells
 * with brackets. Not every shape Siren draws — a list of every one would
 * bury the answer — and a list that stays the same as the shape table grows.
 */
const SHAPE_CHOICES = BRACKET_SHAPE_NAMES.map(([, [shortName]]) => shortName).join(", ");

/** Something an `@{ … }` block says that is not drawn as written, worded for the author. */
export interface DataBlockProblem {
  severity: "error" | "warning";
  message: string;
  /**
   * Where in the block's text, between its braces, the problem stands, when
   * it is one place there (a YAML error); the block's `@` otherwise.
   */
  offset?: number;
}

/** What reading one `@{ … }` block found. */
export interface NodeData {
  problems: DataBlockProblem[];
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
 * The text between an `@{` and its `}` — a node's block or an edge's —
 * loaded as Mermaid 12.2.0 loads it: YAML under the JSON schema, a block on
 * one line wrapped in `{ … }` first so that it reads as a flow mapping
 * (`FlowDB.addVertex`, measured). Its key/value pairs, or the problem that
 * stopped it; `example` is a pair worth writing in the block at hand, for
 * the message about a block that is not pairs.
 */
export function loadDataBlock(
  written: string,
  example: string,
): { doc: Record<string, unknown> } | { problem: DataBlockProblem } {
  // Mermaid's lexer turns a line break inside a quoted string, and the
  // indentation after it, into `<br/>` before the YAML is read (measured,
  // `label: "a⏎   b"` is `a<br/>b`); a block holding a line break anywhere
  // else is block YAML, and one on one line a flow mapping.
  const content = written.replace(/"[^"]*"?/g, (string) => string.replace(/\n\s*/g, "<br/>"));
  const flowMapping = !content.includes("\n");
  const yaml = flowMapping ? `{\n${content}\n}` : `${content}\n`;
  const refused = (message: string, offset?: number) => ({
    problem: { severity: "error" as const, message, ...(offset === undefined ? {} : { offset }) },
  });
  let loaded: unknown;
  try {
    loaded = load(yaml, { schema: JSON_SCHEMA });
  } catch (error) {
    if (error instanceof YAMLException) {
      // Where the reader stopped, in the author's own text: the YAML is that
      // text, or it wrapped in `{\n` … `\n}`, so the offset moves back past the
      // wrapping and stays within the text. A string whose line breaks were
      // read as `<br/>` no longer lines up with what was written, so its
      // error stays at the `@`.
      const wrapping = flowMapping ? "{\n".length : 0;
      const offset =
        content === written ? Math.min(Math.max(error.mark.position - wrapping, 0), written.length) : undefined;
      return refused(`The "@{ … }" block is not valid YAML (${error.reason})`, offset);
    }
    throw error;
  }
  if (loaded !== null && loaded !== undefined && (typeof loaded !== "object" || Array.isArray(loaded))) {
    return refused(`Write the "@{ … }" block as "key: value" pairs, such as "${example}"`);
  }
  return { doc: (loaded ?? {}) as Record<string, unknown> };
}

/**
 * Reads the text between a node's `@{` and its `}`.
 *
 * A key Mermaid tests for truth is read only when its value is truthy, as
 * Mermaid reads it: `label: ""` and `shape:` (a null) say nothing.
 */
export function readNodeData(written: string): NodeData {
  const loaded = loadDataBlock(written, "shape: circle");
  if ("problem" in loaded) {
    return { problems: [loaded.problem], shape: null, label: null };
  }
  const { doc } = loaded;
  const problems: DataBlockProblem[] = [];
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
function readShape(value: unknown, problems: DataBlockProblem[]): NodeShape | null {
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
      message: NODE_DATA_SHAPES.has(spelled) ? `${rule}: ${spelled}` : `${rule}. Use a shape such as: ${SHAPE_CHOICES}`,
    });
  } else if (UNDRAWN_SHAPE_NAMES.has(value)) {
    problems.push({
      severity: "error",
      message: `Siren does not draw the shape "${value}" yet. Use a shape such as: ${SHAPE_CHOICES}`,
    });
  } else {
    problems.push({ severity: "error", message: `There is no shape "${value}". Use a shape such as: ${SHAPE_CHOICES}` });
  }
  return null;
}

/**
 * Why a label written for a node of `shape` is refused, or `null` when the
 * shape draws text. A shape whose shape-table record draws no label (a
 * fork, a small circle) would drop it: Mermaid 12.2.0 empties the label of
 * each such shape before drawing it, so the author's text vanishes with no
 * word said (measured).
 */
export function unshownLabelMessage(shape: NodeShape, label: string): string | null {
  if (SHAPES[shape].drawsLabel !== false) {
    return null;
  }
  return (
    `The shape "${shape}" draws no text, so the label "${label}" would not be shown. ` +
    "Remove the label, or use a shape that draws text"
  );
}

/** Where one `@{ … }` block stands: its `@`, and past its `}` (`null` when nothing closes it). */
export interface NodeDataBlock {
  at: number;
  end: number | null;
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
  return closingBraceIn(text, at + NODE_DATA_OPENER.length, false);
}

/**
 * The text of a statement whose last `@{ … }` block is not closed on its
 * own line, run on into `lines` from `from` until the `}` closing it — the
 * multi-line block Mermaid 12.2.0 reads as block YAML (`A@{` ⏎
 * `shape: circle` ⏎ `}`, measured) — and how many of those lines it took.
 * A block never closed takes every line. A line the block closes on may
 * open another (`} --> B@{`), which runs on in turn.
 *
 * `blocksOf` says where a text's blocks stand, so that an `@{` the text
 * holds as text (an arrow's label, a quoted string) opens none. Each line
 * is looked at once: the open block's quotes are carried from line to
 * line, since rescanning the joined text at every line would be quadratic
 * in a block never closed.
 */
export function blockRunOn(
  text: string,
  lines: readonly string[],
  from: number,
  blocksOf: (text: string) => readonly NodeDataBlock[],
): { text: string; taken: number } {
  let joined = text;
  let taken = 0;
  let { open, quoted } = openBlockAtEnd(text, blocksOf);
  while (open && from + taken < lines.length) {
    const line = lines[from + taken]!;
    taken++;
    joined += "\n" + line;
    const close = closingBraceIn(line, 0, quoted);
    if (close === null) {
      quoted = quotedAtEnd(line, quoted);
    } else {
      ({ open, quoted } = openBlockAtEnd(line.slice(close), blocksOf));
    }
  }
  return { text: joined, taken };
}

/**
 * Whether `text` ends inside an `@{ … }` block it opens, and if so whether
 * inside one of that block's strings.
 */
function openBlockAtEnd(
  text: string,
  blocksOf: (text: string) => readonly NodeDataBlock[],
): { open: boolean; quoted: boolean } {
  const last = blocksOf(text).at(-1);
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
 * Where, past the `}` closing an open block, `text` goes on — read from
 * `from`, the block's string open there when `quoted` — or `null` when no
 * `}` closes it.
 */
function closingBraceIn(text: string, from: number, quoted: boolean): number | null {
  let open = quoted;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '"') {
      open = !open;
    } else if (!open && text[i] === "}") {
      return i + 1;
    }
  }
  return null;
}
