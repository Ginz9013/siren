import type { Diagnostic } from "../contracts";
import { entityCodesAsReferences, resolveCharacterReferences, resolveEntityCodes } from "./characterReferences";
import {
  plainRun,
  sameProperties,
  type Label,
  type LabelDialect,
  type LabelProblem,
  type LabelRun,
  type SourcePosition,
} from "./label";
import { prepass } from "./prepass";
import { nextTag } from "./tags";
import { attributesOf, htmlRule, refusal, type Attributes, type RunStyle, type TagRule } from "./vocabulary";

/**
 * A row break in the `sequence` dialect: Mermaid's own `/<br\s*\/?>/gi`.
 *
 * In the `html` dialect a row break is the name `br`, in any case: `<br>`,
 * `<br/>`, `<br />`, `<BR>`, `<br class="x">` and even `</br>`, which the
 * HTML parser reads as `<br>`, all break a row, and `<brx>` is another name.
 * Wider than Mermaid's own `/<br\s*\/?>/gi`, deliberately (ADR-0015): that pattern is its SVG-mode rule and has no room for an
 * attribute, but in its default HTML labels DOMPurify keeps
 * `<BR class="x">` as an element and the browser breaks the line
 * (measured), and that picture is the one Siren draws.
 *
 * In the `sequence` dialect a row break is Mermaid's narrower pattern
 * itself, because Mermaid draws sequence text in SVG mode only, where that
 * pattern is the picture: `<br>`, `<br/>`, `<br />` and `<BR>` break a row,
 * and `<br class="x">` is drawn as its characters (measured:
 * `A->>B: x<br class="x">y` is one `<text>`).
 */
const SVG_ROW_BREAK_RE = /<br\s*\/?>/gi;

/**
 * What reading one label gave: the label, and what the author has to be
 * told about it, each problem at an offset in the source that was read.
 */
export interface ReadLabelResult {
  label: Label;
  problems: LabelProblem[];
}

/**
 * The diagnostics for the problems `readLabel` found in one label, each at
 * the line and column `positionOf` gives for its offset, and whether any of
 * them is an error.
 *
 * Every parser reading labels needs this conversion, and only the position
 * arithmetic differs between them — where in the document the label's
 * offsets count from, and whether a label can span physical lines — so that
 * is the one thing a parser hands in. An error costs the whole document,
 * exactly as an unrecognized line does: a label Siren cannot draw as written
 * is not drawn some other way, which is why the caller is told.
 */
export function labelDiagnostics(
  problems: readonly LabelProblem[],
  positionOf: (offset: number) => SourcePosition,
): { diagnostics: Diagnostic[]; hasError: boolean } {
  return {
    diagnostics: problems.map(({ severity, message, offset }) => ({
      severity,
      message,
      ...positionOf(offset),
    })),
    hasError: hasError(problems),
  };
}

/** Whether any of `problems` is error-severity, which costs the document. */
function hasError(problems: readonly LabelProblem[]): boolean {
  return problems.some((problem) => problem.severity === "error");
}

/**
 * Reads what an author wrote in one label position into a `Label`, and
 * reports anything about it the author has to be told.
 *
 * `source` is the label as the parser found it, with its own syntax — the
 * quote fence, a Markdown string's backticks — already taken off;
 * `markdown` says the backticks were there, so `**`/`*`, `__`/`_`, a
 * backslash and a real line break mean something. Never throws: any input
 * reads as *some* label, and when `problems` holds an error the caller must
 * not draw it.
 *
 * Pure: the same source and options always read the same label.
 */
export function readLabel(
  source: string,
  options: { dialect: LabelDialect; markdown?: boolean },
): ReadLabelResult {
  const tagged = prepass(source, { markdown: options.markdown === true });
  const problems: LabelProblem[] = [];
  const label = labelOf(
    options.dialect === "sequence" ? sequenceRows(tagged.text) : taggedRows(tagged.text, problems),
  );
  return {
    label,
    problems: problems.map((problem) => ({ ...problem, offset: tagged.origins[problem.offset]! })),
  };
}

/**
 * Reads `source` into rows as Mermaid draws sequence text: in SVG mode
 * only, split into rows by its `/<br\s*\/?>/gi` and by nothing else. Every
 * other character is drawn as written, a `<` included — no tag is read, so
 * a `<` that would begin one in HTML cannot hide a row break behind it
 * (measured: `A->>B: x <y <br> z` draws `x <y` and `z`) — and only
 * Mermaid's entity codes resolve, because Mermaid escapes the rest of
 * sequence text, a character reference the author wrote included.
 */
function sequenceRows(source: string): LabelRun[][] {
  return source.split(SVG_ROW_BREAK_RE).map((row) => [plainRun(resolveEntityCodes(row))]);
}

/**
 * Reads the tags in `source` into rows of runs.
 *
 * The open styling tags are a stack, and a run's properties are what every
 * tag on it sets, so nesting stacks (`<b>a <i>b</i></b>`: `b` is bold and
 * italic). A tag left open runs to the end of the label, across row breaks,
 * as an element does in HTML.
 *
 * **A misnested or stray end tag never throws, and reads as the browser
 * reads it**, because DOMPurify hands Mermaid's label to the browser's HTML
 * parser and the picture is that parser's answer — measured in mermaid
 * 11.17.2's HTML labels with `scripts/mermaid-probe.mjs`:
 *
 * - An end tag with nothing of its name open is dropped
 *   (`a</b>b<i>c` → `ab<i>c</i>`).
 * - An end tag closes the innermost open tag of its name and every tag
 *   opened inside it; the **formatting** ones among those are reopened at
 *   once, and the rest stay closed. So `<b>a<i>b</b>c</i>d` keeps `c`
 *   italic (`<b>a<i>b</i></b><i>c</i>d`), while `<b>a<sub>b</b>c</sub>d`
 *   leaves `c` plain (`<b>a<sub>b</sub></b>cd`). That is the outcome of the
 *   standard's "adoption agency" steps whenever no block is open inside the
 *   misnested tag.
 * - With a block open inside it, an end tag does not close the block. A
 *   formatting tag's ends there, taking the ordinary tags between it and the
 *   block with it; any other is dropped (`<b>a<div>b</b>c</div>d` →
 *   `<b>a</b><div><b>b</b>c</div>d`). The parser also takes those ordinary
 *   tags off the text already in the block, after the fact; this reader
 *   does not go back, so that text keeps them — an approximation of a
 *   misnesting no author means.
 *
 * **Blocks** (ADR-0015's block layer, approximated as it says) end
 * the row at each edge, and edges that meet end it once: no empty row is
 * drawn between two blocks or at either end of the label, and the spaces at
 * a block edge are dropped, as the browser drops them at the ends of its line.
 * A `<br>` still draws the row it ends, empty or not. Mermaid hands the
 * browser each label inside a `<p>`, and a block's start tag closes that
 * `<p>` and every tag opened inside it, reopening the formatting ones in
 * the block: `<sub>a<div>b</div>c</sub>d` → `<p><sub>a</sub></p><div>b</div>cd`
 * (measured). A list item's marker is drawn at the start of its first row.
 * - A `q` draws its closing mark where it really closes, early or at the
 *   end of the label, and in its own style rather than the style of a tag
 *   that was open inside it (`<q>a<b>b</q>c</b>d` →
 *   `<q>a<b>b</b></q><b>c</b>d`).
 *
 * - An `<a>` start tag first closes an `<a>` still open, as its end tag
 *   would, so links never nest: `<a href='x'>1<b>2<a href='y'>3</a>4</b>5`
 *   → `<a href="x">1<b>2</b></a><b><a href="y">3</a>4</b>5`.
 *
 * The `html` dialect's reader: the `sequence` dialect reads no tag at all
 * (`sequenceRows`).
 */
function taggedRows(source: string, problems: LabelProblem[]): LabelRun[][] {
  const rows = new RowBuilder();
  const open = new OpenElements(rows);

  /**
   * The characters a stretch of source between two tags draws: Mermaid
   * hands the browser its entity codes as character references, among any
   * the author wrote as such, and the browser resolves them all.
   */
  const textOf = (written: string): string => resolveCharacterReferences(entityCodesAsReferences(written), "text");

  let lastIndex = 0;
  let from = 0;
  for (let tag = nextTag(source, from); tag !== null; tag = nextTag(source, from)) {
    from = tag.end;
    if (tag.name === null) {
      // A tag the label ends inside, dropped with the rest of the label.
      rows.emit(textOf(source.slice(lastIndex, tag.start)), open.tags);
      lastIndex = source.length;
      break;
    }
    const { closing, name } = tag;
    // A stray `</br>` breaks too, as the HTML parser reads it as `<br>`
    // (measured: `a</br>b` is `a<br>b`).
    const rule = htmlRule(name);
    rows.emit(textOf(source.slice(lastIndex, tag.start)), open.tags);
    lastIndex = tag.end;
    if (name === "br") {
      if (!removed(open.tags)) {
        rows.lineBreak();
      }
    } else if (!closing) {
      if (rule.removesContent === "raw text" || rule.removesContent === "rest") {
        const end = new RegExp(`</${name}(?:[\\s/][^>]*)?>`, "gi");
        end.lastIndex = lastIndex;
        lastIndex = rule.removesContent === "rest" || end.exec(source) === null ? source.length : end.lastIndex;
        from = lastIndex;
        continue;
      }
      // One error-severity problem per label, at its first refused tag: it
      // costs the document either way, and the label has to be rewritten
      // whichever one the author looks at first. Inside removed content the
      // tag is removed too, and costs nothing.
      const attributes = attributesOf(tag.written, name);
      if (
        rule.refused !== undefined &&
        (rule.refused.withAttribute === undefined || attributes.has(rule.refused.withAttribute)) &&
        !removed(open.tags) &&
        !hasError(problems)
      ) {
        problems.push({ severity: "error", message: refusal(name, rule.refused.kind), offset: tag.start });
      }
      if (rule.opensNothing === true && rule.block !== true) {
        continue;
      }
      const at = tag.start;
      const warn = (message: string): void => {
        problems.push({ severity: "warning", message, offset: at });
      };
      open.start({ name, rule, style: rule.attributes?.(attributes, warn) ?? rule.style }, attributes);
      if (rule.marks !== undefined) {
        rows.emit(rule.marks.open, open.tags);
      }
      if (rule.block === true) {
        rows.boundary();
      }
    } else {
      const closed = open.end(name, rule);
      // A block's end tag with nothing of its name open is dropped, unless
      // the parser reads it as an empty block, whose edges end the row.
      if (rule.block === true && (closed || rule.strayEndIsEmpty === true)) {
        rows.boundary();
      }
    }
  }
  rows.emit(textOf(source.slice(lastIndex)), open.tags);
  open.closeAll();
  return rows.finish();
}

/**
 * The rows a label's tags are read into, as they are assembled: the rows
 * already ended, the one being drawn, how it began, and the list markers
 * still waiting for their item's first row. What each run is styled with is
 * the stack of open tags it is handed (`OpenElements`); which rows there are
 * is this.
 */
class RowBuilder {
  private readonly rows: LabelRun[][] = [];
  private row: LabelRun[] = [];
  /**
   * Whether the current row is drawn even with nothing on it: one a `<br>`
   * began, or the label's first, is drawn; one a block edge began is drawn
   * only once something is on it.
   */
  private held = true;
  /**
   * Whether the current row began at a block edge, where the browser drops
   * the spaces at either end of its line (CSS's white-space processing). Rows
   * no block touches keep theirs, as they always have.
   */
  private edge = false;
  /** Each list item's marker, until its first row draws it. */
  private readonly markers = new Map<OpenTag, string>();

  /** Gives the list item `item` its `marker`, drawn at the start of its first row. */
  awaitMarker(item: OpenTag, marker: string): void {
    this.markers.set(item, marker);
  }

  /** Whether any of `tags` is a list item whose marker is still waiting. */
  waiting(tags: readonly OpenTag[]): boolean {
    return tags.some((tag) => this.markers.has(tag));
  }

  /**
   * Appends `written` to the current row, styled by the tags in `stack`:
   * its spaces kept inside a `pre`, the spaces that begin a row at a block
   * edge dropped, and the markers still waiting in `stack` drawn before it.
   */
  emit(written: string, stack: readonly OpenTag[]): void {
    const kept = stack.some((tag) => tag.rule.preservesSpaces === true) ? written.replace(/[ \t]/g, " ") : written;
    const text = this.edge && this.row.length === 0 ? kept.replace(/^[ \t\n]+/, "") : kept;
    if (text === "" || removed(stack)) {
      return;
    }
    this.drawMarkers(stack);
    this.put(text, stack);
  }

  /**
   * Draws the markers of the list items in `stack` that have not drawn one
   * yet, outermost first, each in its item's own style, as the browser's
   * `::marker` is drawn. A marker waits for its item's first row, so an
   * item whose content begins with a block (`<li><p>a</p>`) draws it beside
   * `a` rather than on a row of its own, as the browser places it; nested
   * items that begin together draw theirs side by side.
   */
  drawMarkers(stack: readonly OpenTag[]): void {
    stack.forEach((tag, depth) => {
      const marker = this.markers.get(tag);
      if (marker !== undefined) {
        this.put(marker, stack.slice(0, depth + 1));
        this.markers.delete(tag);
      }
    });
  }

  /** Ends the row at a `<br>`, which draws the row it ends, empty or not. */
  lineBreak(): void {
    this.rows.push(this.row.length === 0 ? [plainRun("")] : this.row);
    this.row = [];
    this.held = true;
    this.edge = false;
  }

  /** Ends the row at the edge of a block, if anything is on it. */
  boundary(): void {
    trimEnd(this.row);
    if (this.row.length > 0) {
      this.rows.push(this.row);
      this.row = [];
    }
    this.held = false;
    this.edge = true;
  }

  /** The rows, the current one ended as the label's end ends it. */
  finish(): LabelRun[][] {
    if (this.edge) {
      trimEnd(this.row);
    }
    if (this.row.length > 0 || this.held || this.rows.length === 0) {
      this.rows.push(this.row.length === 0 ? [plainRun("")] : this.row);
    }
    return this.rows;
  }

  /** Appends `text` to the current row as it stands, styled by the tags in `stack`. */
  private put(text: string, stack: readonly OpenTag[]): void {
    const run = plainRun(text);
    for (const tag of stack) {
      tag.style?.(run);
    }
    const last = this.row[this.row.length - 1];
    if (last !== undefined && sameProperties(last, run)) {
      last.text += text;
    } else {
      this.row.push(run);
    }
  }
}

/**
 * The tags open around the text being read, innermost last — the HTML
 * parser's stack of open elements, as far as a label needs it: what a start
 * or end tag closes, which formatting tags are reopened, where a wall stops
 * an end tag, and the numbers a numbered list counts. What closing a tag
 * draws — a `q`'s closing mark, a waiting list marker — it hands to `rows`.
 */
class OpenElements {
  private open: OpenTag[];
  private readonly rows: RowBuilder;

  constructor(rows: RowBuilder) {
    this.rows = rows;
    // Mermaid hands the browser every label inside a `<p>` of its own (measured:
    // `x` is `<p>x</p>`), so the label begins inside an open paragraph, which
    // the first block closes like any other.
    this.open = [{ name: "p", rule: htmlRule("p"), style: undefined }];
  }

  /** The open tags, outermost first: what styles the text read now. */
  get tags(): readonly OpenTag[] {
    return this.open;
  }

  /**
   * Opens `tag`, read from a start tag with `attributes`: first closing an
   * open tag of its name when it cannot nest, and, for a block, what its
   * start tag closes (`openBlock`).
   */
  start(tag: OpenTag, attributes: Attributes): void {
    const already = tag.rule.unnested === true ? this.open.map((each) => each.name).lastIndexOf(tag.name) : -1;
    if (already !== -1) {
      this.close(already);
    }
    if (tag.rule.block === true) {
      this.openBlock(tag, attributes);
    } else {
      this.open.push(tag);
    }
  }

  /**
   * Reads an end tag `</name>`, whose rule is `rule`, and answers whether it
   * found an open tag to end — a stray one is dropped.
   */
  end(name: string, rule: TagRule): boolean {
    const found = this.reachable(rule.endsAny ?? [name]);
    // An item's end tag does not reach past a list opened inside the item.
    const index =
      rule.listItem === true && this.open.slice(found + 1).some((tag) => tag.rule.list !== undefined) ? -1 : found;
    // The first block opened inside it, which its end tag does not close.
    const block = this.open.findIndex((tag, depth) => depth > index && tag.rule.block === true);
    if (index === -1) {
      // Nothing of its name is open: dropped.
    } else if (rule.block === true || block === -1) {
      this.close(index);
    } else if (rule.formatting) {
      // The HTML parser's adoption agency, with a block inside: the
      // formatting tag ends, the ordinary tags between it and the block go
      // with it, and the block and the formatting tags around it stay.
      this.open = this.open.filter(
        (tag, depth) => depth !== index && (depth < index || depth >= block || tag.rule.formatting),
      );
    }
    return index !== -1;
  }

  /** Closes every tag still open, as the end of the label does. */
  closeAll(): void {
    if (this.open.length > 0) {
      this.close(0);
    }
  }

  /**
   * Closes `open[index]` and every tag opened inside it, innermost first,
   * then reopens the formatting ones among those.
   */
  private close(index: number): void {
    // An item that closes before anything was drawn in it is still a row
    // with its marker on it.
    if (this.rows.waiting(this.open.slice(index)) && !removed(this.open)) {
      this.rows.drawMarkers(this.open);
    }
    for (let depth = this.open.length - 1; depth >= index; depth--) {
      const marks = this.open[depth]!.rule.marks;
      if (marks !== undefined) {
        this.rows.emit(marks.close, this.open.slice(0, depth + 1));
      }
    }
    const inside = this.open[index]!.rule.walled === true ? [] : this.open.slice(index + 1);
    this.open = [...this.open.slice(0, index), ...inside.filter((tag) => tag.rule.formatting)];
  }

  /** Where the tags an end tag or a block can reach begin: at the innermost walled tag, or the bottom. */
  private floor(): number {
    return Math.max(0, this.open.map((tag) => tag.rule.walled === true).lastIndexOf(true));
  }

  /** The innermost open tag named one of `names` that is within reach, or `-1`. */
  private reachable(names: readonly string[]): number {
    const index = Math.max(...names.map((name) => this.open.map((tag) => tag.name).lastIndexOf(name)));
    return index >= this.floor() ? index : -1;
  }

  /**
   * Where the open item `names` closes is, as the HTML parser looks for one
   * at an `li`, `dt` or `dd` start tag: the innermost open tag, looking past
   * inline tags and an `address`, `div` or `p`, and stopping at any other
   * block — so an `li` inside a nested list does not close the item the list
   * is in. `-1` when there is none.
   */
  private openItem(names: readonly string[]): number {
    for (let depth = this.open.length - 1; depth >= 0; depth--) {
      const tag = this.open[depth]!;
      if (names.includes(tag.name)) {
        return depth;
      }
      if (tag.rule.block === true && tag.rule.itemLooksPast !== true) {
        return -1;
      }
    }
    return -1;
  }

  /**
   * Opens a block: first closes an open `<p>`, as the HTML parser closes one
   * at a block's start tag, then puts the formatting tags that closed back
   * inside the block, where the parser reopens them.
   */
  private openBlock(tag: OpenTag, attributes: Attributes): void {
    const paragraph = tag.rule.walled === true ? -1 : this.reachable(["p"]);
    const reopened = paragraph === -1 ? [] : this.open.slice(paragraph + 1).filter((each) => each.rule.formatting);
    if (paragraph !== -1) {
      this.close(paragraph);
      this.open = this.open.slice(0, paragraph);
    }
    const closes = tag.rule.closesOpen;
    if (closes !== undefined) {
      const index = closes.reach === "current" ? this.open.length - 1 : this.openItem(closes.names);
      if (index !== -1 && closes.names.includes(this.open[index]!.name)) {
        this.close(index);
      }
    }
    if (tag.rule.listItem === true) {
      const at = this.open.map((each) => each.rule.list !== undefined).lastIndexOf(true);
      const list = this.open[at];
      if (list?.rule.list === "numbered") {
        const number = htmlInteger(attributes.get("value")) ?? list.next ?? 1;
        list.next = number + 1;
        this.rows.awaitMarker(tag, `${number}. `);
      } else {
        const depth = this.open.slice(0, Math.max(0, at)).filter((each) => each.rule.list !== undefined).length;
        this.rows.awaitMarker(tag, `${BULLETS[Math.min(depth, BULLETS.length - 1)]} `);
      }
    }
    if (tag.rule.list === "numbered") {
      tag.next = htmlInteger(attributes.get("start")) ?? 1;
    }
    this.open.push(...(tag.rule.opensNothing === true ? [] : [tag]), ...reopened);
  }
}

/** Drops the spaces that end `row`, and any run they were all of. */
function trimEnd(row: LabelRun[]): void {
  while (row.length > 0) {
    const last = row[row.length - 1]!;
    last.text = last.text.replace(/[ \t\n]+$/, "");
    if (last.text !== "") {
      return;
    }
    row.pop();
  }
}

/**
 * The bullets of a bulleted list, by how many lists of either kind it is
 * inside: the browser's default stylesheet draws `disc`, `circle` inside one
 * (`ul ul, ol ul { list-style-type: circle }`), and `square` inside two or
 * more (`ol ol ul, ol ul ul, ul ol ul, ul ul ul { list-style-type: square }`)
 * — Chromium's `html.css`, the copy jsdom ships as `default-stylesheet.js`.
 */
const BULLETS = ["\u2022", "\u25e6", "\u25aa"];

/**
 * `value` read by the HTML standard's rules for parsing integers, as the
 * browser reads `<ol start>` and `<li value>`: leading whitespace, an optional
 * `-` or `+`, then digits, whatever follows them ignored; `null` for a value
 * with no digits there, which the browser treats as unwritten.
 */
function htmlInteger(value: string | undefined): number | null {
  const match = value === undefined ? null : /^[\t\n\f\r ]*([+-]?)(\d+)/.exec(value);
  return match === null ? null : (match[1] === "-" ? -1 : 1) * Number(match[2]);
}

/** Whether a tag in `stack` removes its content, so nothing inside it is drawn. */
function removed(stack: readonly OpenTag[]): boolean {
  return stack.some((tag) => tag.rule.removesContent === "elements");
}

/** A tag open around the text being read: its name, its rule, and what it sets on a run. */
interface OpenTag {
  name: string;
  rule: TagRule;
  style: RunStyle | undefined;
  /** For a numbered list: the number its next item draws, unless the item gives its own. */
  next?: number;
}

/** A label of these rows, with the flattened `text` every plain-string reader takes. */
function labelOf(rows: LabelRun[][]): Label {
  return {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
}
