/**
 * Reading a label: `readLabel`, which reads what an author wrote in one
 * label position into a `Label` and the problems to report, and
 * `labelDiagnostics`, which turns those problems into a parser's
 * diagnostics.
 *
 * What is read first is the pre-pass's (`prepass.ts`); the `sequence`
 * dialect is read by `sequenceText.ts`. What this module itself does is the
 * `html` dialect's tree: the stack of elements the HTML parser would build
 * from the tags (`tags.ts`) as the vocabulary describes them
 * (`vocabulary.ts`) — what each start and end tag opens, closes and
 * reopens. The rest it hands on: what the sanitizer removes or Siren
 * refuses to `sanitizer.ts`, what a stretch of text draws to
 * `characterReferences.ts`, and the rows the text is put on to `rows.ts`.
 */
import type { Diagnostic } from "../contracts";
import { htmlText } from "./characterReferences";
import type { Label, LabelDialect, LabelProblem, LabelRun, SourcePosition } from "./label";
import { prepass } from "./prepass";
import { RowBuilder } from "./rows";
import { removed, removedThrough, refusalOf, type StartTag } from "./sanitizer";
import { sequenceRows } from "./sequenceText";
import { nextTag } from "./tags";
import { attributesOf, htmlRule, type Attributes, type BlockRule, type RunStyle, type TagRule } from "./vocabulary";

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
 * A row break is the name `br`, in any case: `<br>`, `<br/>`, `<br />`,
 * `<BR>`, `<br class="x">` and even `</br>`, which the HTML parser reads as
 * `<br>`, all break a row, and `<brx>` is another name. Wider than
 * Mermaid's own `/<br\s*\/?>/gi`, deliberately (ADR-0015): that pattern is
 * its SVG-mode rule and has no room for an attribute, but in its default
 * HTML labels DOMPurify keeps `<BR class="x">` as an element and the
 * browser breaks the line (measured), and that picture is the one Siren
 * draws.
 *
 * The `html` dialect's reader: the `sequence` dialect reads no tag at all
 * (`sequenceText.ts`).
 */
function taggedRows(source: string, problems: LabelProblem[]): LabelRun[][] {
  const rows = new RowBuilder();
  const open = new OpenElements(rows);

  let lastIndex = 0;
  let from = 0;
  for (let tag = nextTag(source, from); tag !== null; tag = nextTag(source, from)) {
    from = tag.end;
    open.text(htmlText(source.slice(lastIndex, tag.start), "text"));
    if (tag.name === null) {
      // A tag the label ends inside, dropped with the rest of the label.
      lastIndex = source.length;
      break;
    }
    const { closing, name } = tag;
    // A stray `</br>` breaks too, as the HTML parser reads it as `<br>`
    // (measured: `a</br>b` is `a<br>b`).
    const rule = htmlRule(name);
    lastIndex = tag.end;
    // Inside content the sanitizer removes as elements, a tag still opens
    // and closes, but draws nothing and costs nothing.
    const drawn = !removed(open.tags);
    if (name === "br") {
      if (drawn) {
        rows.lineBreak();
      }
    } else if (!closing) {
      const start: StartTag = { name, rule, attributes: attributesOf(tag.written, name) };
      const resume = removedThrough(source, start, tag.end);
      if (resume !== null) {
        lastIndex = resume;
        from = resume;
        continue;
      }
      // One error-severity problem per label, at its first refused tag: it
      // costs the document either way, and the label has to be rewritten
      // whichever one the author looks at first.
      const { attributes } = start;
      const refused = drawn && !hasError(problems) ? refusalOf(start, tag.start) : null;
      if (refused !== null) {
        problems.push(refused);
      }
      if (rule.opens === "nothing" && rule.kind === "inline") {
        continue;
      }
      const at = tag.start;
      const warn = (message: string): void => {
        problems.push({ severity: "warning", message, offset: at });
      };
      open.start({ name, rule, style: rule.attributes?.(attributes, warn) ?? rule.style }, attributes);
      if (rule.kind === "block") {
        rows.boundary();
      }
    } else {
      const closed = open.end(name, rule);
      // A block's end tag with nothing of its name open is dropped, unless
      // the parser reads it as an empty block, whose edges end the row.
      if (rule.kind === "block" && (closed || rule.strayEndIsEmpty)) {
        rows.boundary();
      }
    }
  }
  open.text(htmlText(source.slice(lastIndex), "text"));
  open.closeAll();
  return rows.finish();
}

/**
 * The tags open around the text being read, innermost last — the HTML
 * parser's stack of open elements, as far as a label needs it: what a start
 * or end tag closes, which formatting tags are reopened, where a wall stops
 * an end tag, the numbers a numbered list counts, and the list markers still
 * waiting for their item's first row. It draws onto `rows` each stretch of
 * text, styled by the tags open around it, and what opening or closing a
 * tag draws — a `q`'s marks, a waiting list marker; `rows` knows nothing of
 * the tags.
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

  /** Draws `written`, a stretch of text between two tags, styled by the open tags. */
  text(written: string): void {
    this.draw(written, this.open);
  }

  /**
   * Opens `tag`, read from a start tag with `attributes`: first closing an
   * open tag of its name when it cannot nest, and, for a block, what its
   * start tag closes (`openBlock`); then draws its opening mark, if it has one.
   */
  start(tag: OpenTag, attributes: Attributes): void {
    const already =
      tag.rule.opens === "unnested element" ? this.open.map((each) => each.name).lastIndexOf(tag.name) : -1;
    if (already !== -1) {
      this.close(already);
    }
    if (tag.rule.kind === "block") {
      this.openBlock(tag, tag.rule, attributes);
    } else {
      this.open.push(tag);
    }
    if (tag.rule.marks !== undefined) {
      this.draw(tag.rule.marks.open, this.open);
    }
  }

  /**
   * Reads an end tag `</name>`, whose rule is `rule`, and answers whether it
   * found an open tag to end — a stray one is dropped.
   */
  end(name: string, rule: TagRule): boolean {
    const found = this.reachable((rule.kind === "block" ? rule.endsAny : undefined) ?? [name]);
    // An item's end tag does not reach past a list opened inside the item.
    const index =
      rule.kind === "block" && rule.listRole === "item" && this.open.slice(found + 1).some(isList) ? -1 : found;
    // The first block opened inside it, which its end tag does not close.
    const block = this.open.findIndex((tag, depth) => depth > index && tag.rule.kind === "block");
    if (index === -1) {
      // Nothing of its name is open: dropped.
    } else if (rule.kind === "block" || block === -1) {
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
    if (this.open.slice(index).some((tag) => tag.marker !== undefined) && !removed(this.open)) {
      this.drawMarkers(this.open);
    }
    for (let depth = this.open.length - 1; depth >= index; depth--) {
      const marks = this.open[depth]!.rule.marks;
      if (marks !== undefined) {
        this.draw(marks.close, this.open.slice(0, depth + 1));
      }
    }
    const inside = this.open[index]!.rule.walled ? [] : this.open.slice(index + 1);
    this.open = [...this.open.slice(0, index), ...inside.filter((tag) => tag.rule.formatting)];
  }

  /**
   * Draws `written` styled by the tags in `stack`, its spaces kept inside a
   * `pre`, and the markers still waiting in `stack` before it — unless
   * nothing of it is drawn there, at a block edge or inside removed content.
   */
  private draw(written: string, stack: readonly OpenTag[]): void {
    if (removed(stack)) {
      return;
    }
    const text = this.rows.drawnText(written, {
      preservesSpaces: stack.some(({ rule }) => rule.kind === "block" && rule.preservesSpaces),
    });
    if (text === "") {
      return;
    }
    this.drawMarkers(stack);
    this.rows.put(text, stylesOf(stack));
  }

  /**
   * Draws the markers of the list items in `stack` that have not drawn one
   * yet, outermost first, each in its item's own style, as the browser's
   * `::marker` is drawn. A marker waits for its item's first row, so an
   * item whose content begins with a block (`<li><p>a</p>`) draws it beside
   * `a` rather than on a row of its own, as the browser places it; nested
   * items that begin together draw theirs side by side.
   */
  private drawMarkers(stack: readonly OpenTag[]): void {
    stack.forEach((tag, depth) => {
      if (tag.marker !== undefined) {
        this.rows.put(tag.marker, stylesOf(stack.slice(0, depth + 1)));
        tag.marker = undefined;
      }
    });
  }

  /** Where the tags an end tag or a block can reach begin: at the innermost walled tag, or the bottom. */
  private floor(): number {
    return Math.max(0, this.open.map((tag) => tag.rule.walled).lastIndexOf(true));
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
      if (tag.rule.kind === "block" && !tag.rule.itemLooksPast) {
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
  private openBlock(tag: OpenTag, rule: BlockRule, attributes: Attributes): void {
    const paragraph = rule.walled ? -1 : this.reachable(["p"]);
    const reopened = paragraph === -1 ? [] : this.open.slice(paragraph + 1).filter((each) => each.rule.formatting);
    if (paragraph !== -1) {
      this.close(paragraph);
      this.open = this.open.slice(0, paragraph);
    }
    const closes = rule.closesOpen;
    if (closes !== undefined) {
      const index = closes.reach === "current" ? this.open.length - 1 : this.openItem(closes.names);
      if (index !== -1 && closes.names.includes(this.open[index]!.name)) {
        this.close(index);
      }
    }
    if (rule.listRole === "item") {
      const at = this.open.map(isList).lastIndexOf(true);
      const list = this.open[at];
      if (list !== undefined && listOf(list) === "numbered") {
        const number = htmlInteger(attributes.get("value")) ?? list.next ?? 1;
        list.next = number + 1;
        tag.marker = `${number}. `;
      } else {
        const depth = this.open.slice(0, Math.max(0, at)).filter(isList).length;
        tag.marker = `${BULLETS[Math.min(depth, BULLETS.length - 1)]} `;
      }
    }
    if (rule.listRole === "numbered") {
      tag.next = htmlInteger(attributes.get("start")) ?? 1;
    }
    this.open.push(...(rule.opens === "nothing" ? [] : [tag]), ...reopened);
  }
}

/** The kind of list `tag` is, or `null` for a tag that is none. */
function listOf(tag: OpenTag): "bulleted" | "numbered" | null {
  const role = tag.rule.kind === "block" ? tag.rule.listRole : null;
  return role === "item" ? null : role;
}

/** Whether `tag` is a list. */
function isList(tag: OpenTag): boolean {
  return listOf(tag) !== null;
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

/** A tag open around the text being read: its name, its rule, and what it sets on a run. */
interface OpenTag {
  name: string;
  rule: TagRule;
  style: RunStyle | undefined;
  /** For a numbered list: the number its next item draws, unless the item gives its own. */
  next?: number;
  /** For a list item: its marker, until its first row draws it. */
  marker?: string;
}

/** What the tags in `stack` set on a run, outermost first. */
function stylesOf(stack: readonly OpenTag[]): RunStyle[] {
  return stack.flatMap(({ style }) => (style === undefined ? [] : [style]));
}

/** A label of these rows, with the flattened `text` every plain-string reader takes. */
function labelOf(rows: LabelRun[][]): Label {
  return {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
}
