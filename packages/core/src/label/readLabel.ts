import type { Diagnostic } from "../contracts";
import { unsafeStyleValue } from "../unsafeStyleValue";
import {
  plainRun,
  relativeScale,
  sameProperties,
  type Label,
  type LabelDialect,
  type LabelProblem,
  type LabelRun,
  type SourcePosition,
} from "./label";

/**
 * One tag: `<`, an optional `/`, a name, then optionally whitespace and
 * attributes, an optional `/`, and `>`. An attribute value in quotes may hold
 * a `>` without ending the tag.
 *
 * It finds every tag-shaped stretch of a label, and which of them mean
 * something is `readLabel`'s question, not this pattern's: a name outside the
 * vocabulary is left in the text as the characters the author wrote.
 *
 * **A row break** is the name `br`, in any case, opened: `<br>`, `<br/>`,
 * `<br />`, `<BR>` and `<br class="x">` all break a row, and `<brx>` is
 * another name. Wider than Mermaid's own `/<br\s*\/?>/gi`, deliberately
 * (ADR-0015): that pattern is its SVG-mode rule and has no room for an
 * attribute, but in its default HTML labels DOMPurify keeps
 * `<BR class="x">` as an element and the browser breaks the line
 * (measured), and that picture is the one Siren draws.
 *
 * A row break reads the same in both dialects: it is the one tag a sequence
 * diagram honors. Mermaid draws sequence text in SVG mode only, where its
 * narrower pattern is the picture, so the ticket wiring the `sequence`
 * dialect has to decide whether an attribute-carrying `<br>` breaks there
 * too.
 */
const TAG_RE = /<(\/?)([a-z][a-z0-9]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>/gi;

/** What one styling tag does to a run it is open around. */
type RunStyle = (run: LabelRun) => void;

const bold: RunStyle = (run) => {
  run.bold = true;
};
const italic: RunStyle = (run) => {
  run.italic = true;
};
const underline: RunStyle = (run) => {
  run.underline = true;
};
const strikethrough: RunStyle = (run) => {
  run.strikethrough = true;
};
/** Monospace replaces a family set around it, as an inner family replaces it. */
const monospace: RunStyle = (run) => {
  run.monospace = true;
  run.fontFamily = null;
};
/**
 * A mark paints its own text, which replaces a color from around it, as the
 * browser's `mark { color: black }` replaces an inherited one; and its own
 * yellow over the run's inline box, which covers a background from around
 * it. A color or background set inside the mark is set after this, and wins
 * in turn — `drawLabel` paints a marked run's background over the mark.
 */
const marked: RunStyle = (run) => {
  run.mark = true;
  run.color = null;
  run.background = null;
};

/**
 * A tag drawing its text at `factor` times the size around it. Nested, the
 * factors multiply (`<big><big>` is × 1.44), which is what a relative
 * `font-size` does; the measurement behind each factor is of one level only.
 * An absolute size around it is not one a scale can multiply, and is left
 * as written.
 */
function scaled(factor: number): RunStyle {
  return (run) => {
    const scale = relativeScale(run);
    if (scale !== null) {
      run.fontSize = { scale: scale * factor };
    }
  };
}

/**
 * `sub`/`sup`: smaller, as `small` is, and shifted off the baseline. The
 * innermost of the two decides the shift; how far a shift goes is
 * `drawLabel`'s.
 */
function shifted(baseline: "sub" | "super"): RunStyle {
  const smaller = scaled(0.833);
  return (run) => {
    smaller(run);
    run.baseline = baseline;
  };
}

/**
 * What one tag in the vocabulary does — every fact about it in one entry, so
 * that teaching `readLabel` a tag is adding one entry to `HTML_TAGS`.
 */
interface TagRule {
  /** What the tag sets on each run inside it; absent for a tag that sets nothing. */
  style?: RunStyle;
  /**
   * For a tag whose attributes say what it sets (`font`, `span`, `a`): its
   * style, read off the attributes of one start tag. Each start tag is read
   * once, where it opens, and the style it gives is the one every run inside
   * it takes — reopened, a formatting element keeps its attributes, as the
   * HTML parser's clone of it does.
   */
  attributes?: (attributes: Attributes, warn: (message: string) => void) => RunStyle | undefined;
  /**
   * Whether the HTML parser calls it a **formatting** element — one it
   * reopens after a misnested end tag closed it early (the "active
   * formatting elements" of the HTML standard's tree construction). Any
   * other element a misnested end tag closes for good.
   */
  formatting: boolean;
  /**
   * Text the browser draws on each side of the tag's content, as its
   * `::before`/`::after` generated content. Generated content takes the
   * element's own style, so each mark is read as text inside the tag, and is
   * part of the label's flattened text, because the reader sees it.
   */
  marks?: { open: string; close: string };
  /**
   * Whether its start tag first closes one of its name still open, as its
   * end tag would — the HTML parser's rule for `a`, which cannot nest.
   */
  unnested?: boolean;
}

/**
 * One start tag's attributes, by lower-case name; an attribute written with
 * no value is `""`. The first of two with one name is the one kept, as the
 * HTML parser keeps it.
 */
type Attributes = ReadonlyMap<string, string>;

/**
 * One attribute in a start tag: a name, then optionally `=` and a value in
 * double quotes, single quotes, or none.
 */
const ATTRIBUTE_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** The attributes of `tag`, one whole start tag as `TAG_RE` matched it. */
function attributesOf(tag: string, name: string): Attributes {
  const attributes = new Map<string, string>();
  const rest = tag.slice(1 + name.length, tag.endsWith("/>") ? -2 : -1);
  for (const match of rest.matchAll(ATTRIBUTE_RE)) {
    const key = match[1]!.toLowerCase();
    if (!attributes.has(key)) {
      attributes.set(key, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

/**
 * `value` as an author's style value may be drawn, or `null` for one that is
 * not drawn at all — the run is drawn as though it had not been written.
 *
 * Held to the rule every other author style value is (`unsafeStyleValue`,
 * shared with the styling statements' `resolveStyles`), so that a label's
 * `style` and `<font>` values cannot fetch, run script, or smuggle in a
 * second declaration. Refused silently rather than with `resolveStyles`'s
 * error, because a browser drawing Mermaid's label drops a value it cannot
 * use and says nothing, and an error would cost the document. An empty
 * value names nothing, and is not drawn either.
 */
function drawableValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || unsafeStyleValue(trimmed) !== null ? null : trimmed;
}

/**
 * What `<font size>` 1–7 draws at, as a scale of the size around a label —
 * the board's measured table: 12 / 13 / 16 / 18 / 20 / 32 / 48px where the
 * text around them is 16px. A size keyword is not relative to the tag
 * around it, so this replaces a scale rather than multiplying it.
 *
 * Size 5 is 20px (× 1.25) because that is what it measured *inside a
 * Mermaid label*. On a plain page the same tag measures 24px (× 1.5), the
 * figure most references give; the picture Siren is held to is Mermaid's,
 * so the label measurement wins. Remeasure before changing it.
 */
const FONT_SIZE_SCALES = [0.75, 0.8125, 1, 1.125, 1.25, 2, 3];

/**
 * The scale `<font size="…">` draws at, or `null` for a value that names
 * no size, which the browser treats as unwritten. Read as the HTML
 * standard's "legacy font size": leading whitespace, an optional sign, then
 * digits; a signed size counts from 3, and either is held to 1–7.
 */
function fontSizeScale(value: string | undefined): number | null {
  const match = value === undefined ? null : /^\s*([+-]?)(\d+)/.exec(value);
  if (match === null) {
    return null;
  }
  const digits = Number(match[2]);
  const size = match[1] === "+" ? 3 + digits : match[1] === "-" ? 3 - digits : digits;
  return FONT_SIZE_SCALES[Math.min(7, Math.max(1, size)) - 1]!;
}

/**
 * DOMPurify's `ALLOWED_URI_REGEXP` (3.4.14): an href it keeps names one of
 * these schemes, or names none — it starts with something other than a
 * letter, or its leading letters are not followed by a `:`. Measured against
 * mermaid 11.17.2 with `mermaid-probe.mjs --html`: `https:`, `HTTP:`,
 * `mailto:`, `ftp:`, `ftps:`, `tel:`, `callto:`, `sms:`, `cid:`, `xmpp:`,
 * `matrix:`, `#f`, `rel/p?q`, `//h/p` and `""` are kept; `javascript:`,
 * `data:`, `foo:bar` and `a.b:c` are not.
 */
const KEPT_URI_RE = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** What DOMPurify ignores in an href when it tests one: whitespace and controls anywhere. */
const URI_IGNORED_RE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

/**
 * What `<a href="…">` sets on its text. An href the sanitizer keeps —
 * trimmed of the whitespace around it, as it keeps it — makes the text a
 * link, which the browser draws underlined in the link color; an `<a>`
 * whose href is stripped, or that has none, is not a link in the browser
 * (measured: black, no underline), so it sets nothing.
 */
function link(written: string | undefined): RunStyle | undefined {
  const href = written?.trim();
  // An empty href is kept without the test, as DOMPurify keeps any empty value.
  if (href === undefined || (href !== "" && !KEPT_URI_RE.test(href.replace(URI_IGNORED_RE, "")))) {
    return undefined;
  }
  // The link's own color replaces one from around it, as `a:link`'s does,
  // and is the run's color like any other, so that a tag inside the link
  // replaces it in turn: a `<mark>` inside clears it to the mark's black, a
  // `<font color>` inside sets its own (measured: `<a><mark>x</mark></a>`
  // is black, `<mark><a>x</a></mark>` link blue).
  return (run) => {
    run.href = href;
    run.underline = true;
    run.color = LINK_COLOR;
  };
}

/**
 * The color a link paints its text with: the theme's link token, which
 * `default.css` sets to the browser's link blue. A `var()` the author could
 * not have written — `drawableValue` passes no author value through here.
 */
const LINK_COLOR = "var(--siren-label-link)";

/** A formatting element that sets `style`. */
function formatting(style: RunStyle): TagRule {
  return { style, formatting: true };
}

/** An ordinary (not formatting) element that sets `style`. */
function ordinary(style: RunStyle): TagRule {
  return { style, formatting: false };
}

/**
 * The properties of `<span style>` Siren draws — the board's ten, in its
 * order, which is the order the warning lists them in — by lower-case name: what each
 * sets on a run, given a value `drawableValue` let through. A property that
 * cannot read its value answers `null`, and is drawn as unwritten, as the
 * browser drops a declaration it cannot parse.
 */
const SPAN_STYLE_PROPERTIES: Readonly<Record<string, (value: string) => RunStyle | null>> = {
  color: (value) => (run) => {
    run.color = value;
  },
  "background-color": (value) => (run) => {
    run.background = value;
  },
  "font-size": (value) => {
    const relative = /^(\d*\.?\d+)(em|%)$/i.exec(value);
    if (relative === null) {
      return (run) => {
        run.fontSize = { absolute: value };
      };
    }
    return scaled(Number(relative[1]) / (relative[2] === "%" ? 100 : 1));
  },
  "font-weight": (value) => {
    const weight = value.toLowerCase();
    const bolded =
      weight === "bold" || weight === "bolder"
        ? true
        : weight === "normal" || weight === "lighter"
          ? false
          : /^\d+$/.test(weight)
            ? Number(weight) >= 600
            : null;
    return bolded === null
      ? null
      : (run) => {
          run.bold = bolded;
        };
  },
  "font-style": (value) => {
    const style = value.toLowerCase();
    const slanted = style === "italic" || style.startsWith("oblique") ? true : style === "normal" ? false : null;
    return slanted === null
      ? null
      : (run) => {
          run.italic = slanted;
        };
  },
  "font-family": (value) => (run) => {
    run.fontFamily = value;
    run.monospace = false;
  },
  // A decoration is drawn by the box declaring it across all of its text,
  // and an inner box cannot take it away, so `none` takes nothing away.
  "text-decoration": (value) => {
    const lines = value.toLowerCase().split(/\s+/);
    return (run) => {
      run.underline ||= lines.includes("underline");
      run.strikethrough ||= lines.includes("line-through");
    };
  },
  "letter-spacing": (value) => (run) => {
    run.letterSpacing = value;
  },
  "word-spacing": (value) => (run) => {
    run.wordSpacing = value;
  },
  // A box's opacity fades it and everything in it, so an opacity inside
  // another multiplies. A number or a percentage, held to 0–1, as CSS reads it.
  opacity: (value) => {
    const match = /^(\d*\.?\d+)(%?)$/.exec(value);
    if (match === null) {
      return null;
    }
    const factor = Math.min(1, Number(match[1]) / (match[2] === "%" ? 100 : 1));
    return (run) => {
      const around = run.opacity === null ? 1 : Number(run.opacity);
      run.opacity = String(Number((around * factor).toFixed(4)));
    };
  },
};

/**
 * What one `<span style="…">` sets: each declaration of a property in
 * `SPAN_STYLE_PROPERTIES`, in the order written, so a later one wins as it
 * does in CSS.
 *
 * Any other property is not drawn, and is the one thing about a label tag
 * Siren *warns* about rather than drawing or rejecting: Mermaid draws it,
 * Siren draws the label without it, and the author is told which, once per
 * `style` attribute, naming each property it ignored.
 */
function spanStyle(attributes: Attributes, warn: (message: string) => void): RunStyle {
  const styles: RunStyle[] = [];
  const ignored = new Set<string>();
  for (const declaration of (attributes.get("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const read = SPAN_STYLE_PROPERTIES[property];
    if (read === undefined) {
      ignored.add(property);
      continue;
    }
    const value = drawableValue(declaration.slice(colon + 1));
    const style = value === null ? null : read(value);
    if (style !== null) {
      styles.push(style);
    }
  }
  if (ignored.size > 0) {
    const drawn = Object.keys(SPAN_STYLE_PROPERTIES);
    warn(
      `<span style> ignores ${[...ignored].map((name) => `"${name}"`).join(", ")}: ` +
        `Siren draws only ${drawn.slice(0, -1).join(", ")} and ${drawn[drawn.length - 1]}.`,
    );
  }
  return (run) => {
    for (const style of styles) {
      style(run);
    }
  };
}

/**
 * The `html` dialect's tag vocabulary, by lower-case tag name.
 *
 * Every style is a measurement: Mermaid 11.17.2 at its default settings, in
 * headless Chrome (the board's "measured picture" table), draws `b` and
 * `strong` with `font-weight: bold`, and `i` `em` `cite` `dfn` `var` with
 * `font-style: italic` — five names for one picture, because the browser's
 * default stylesheet gives all five the same rule — `u` and `ins` with an
 * underline, `s` `strike` `del` with a line through, `code` `kbd` `samp`
 * `tt` in `monospace`, `small` at × 0.833 of the size around it and `big` at
 * × 1.2, `sub`/`sup` at × 0.833, below / above the baseline, `q` as its
 * text between `“` and `”`, and `mark` as black text on a yellow `#ff0`
 * background — paint the theme owns, so a run says only that it is marked.
 *
 * Which are formatting elements is the HTML standard's list: `b` `big`
 * `code` `em` `i` `s` `small` `strike` `strong` `tt` `u`.
 */
const HTML_TAGS: Readonly<Record<string, TagRule>> = {
  b: formatting(bold),
  strong: formatting(bold),
  i: formatting(italic),
  em: formatting(italic),
  cite: ordinary(italic),
  dfn: ordinary(italic),
  var: ordinary(italic),
  u: formatting(underline),
  ins: ordinary(underline),
  s: formatting(strikethrough),
  strike: formatting(strikethrough),
  del: ordinary(strikethrough),
  code: formatting(monospace),
  kbd: ordinary(monospace),
  samp: ordinary(monospace),
  tt: formatting(monospace),
  small: formatting(scaled(0.833)),
  big: formatting(scaled(1.2)),
  sub: ordinary(shifted("sub")),
  sup: ordinary(shifted("super")),
  mark: ordinary(marked),
  // Sets nothing on a run; draws `“` and `”` round its text (measured), so
  // `<b><q>yo</q></b>` is one bold run `“yo”`.
  q: { formatting: false, marks: { open: "\u201c", close: "\u201d" } },
  font: {
    formatting: true,
    attributes: (attributes) => (run) => {
      const color = drawableValue(attributes.get("color"));
      if (color !== null) {
        run.color = color;
      }
      const size = fontSizeScale(attributes.get("size"));
      if (size !== null) {
        run.fontSize = { scale: size };
      }
      const face = drawableValue(attributes.get("face"));
      if (face !== null) {
        run.fontFamily = face;
        run.monospace = false;
      }
    },
  },
  span: { formatting: false, attributes: spanStyle },
  // A formatting element in the HTML parser's own list, so a misnested end
  // tag reopens it like `b`. Every attribute but `href` is ignored — the
  // sanitizer drops `on*` ones, and none of the rest draws anything.
  a: { formatting: true, attributes: (attributes) => link(attributes.get("href")), unnested: true },
};

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
    hasError: problems.some((problem) => problem.severity === "error"),
  };
}

/**
 * Reads what an author wrote in one label position into a `Label`, and
 * reports anything about it the author has to be told.
 *
 * `source` is the label as the parser found it, with its own syntax — the
 * quote fence, a Markdown string's backticks — already taken off;
 * `markdown` says the backticks were there, so `**`/`*` and a real line
 * break mean something. Never throws: any input reads as *some* label, and
 * when `problems` holds an error the caller must not draw it.
 *
 * Pure: the same source and options always read the same label.
 */
export function readLabel(
  source: string,
  options: { dialect: LabelDialect; markdown?: boolean },
): ReadLabelResult {
  const tagged = options.markdown === true ? markdownAsTags(source) : untagged(source);
  const problems: LabelProblem[] = [];
  const label = labelOf(taggedRows(tagged.text, options.dialect, problems));
  return {
    label,
    problems: problems.map((problem) => ({ ...problem, offset: tagged.origins[problem.offset]! })),
  };
}

/**
 * A label's source as the tag reader reads it, and, for each of its
 * characters and for its end, the offset in what the author wrote that it
 * came from — so that a problem found in a Markdown string's rewritten text
 * is placed where the author can find it. A tag the rewrite inserted takes
 * the offset of the notation it stands for.
 */
interface Tagged {
  text: string;
  origins: readonly number[];
}

/** `source` read as written: every character is its own origin. */
function untagged(source: string): Tagged {
  return { text: source, origins: Array.from({ length: source.length + 1 }, (_, index) => index) };
}

/**
 * `tagged` with every match of `pattern` rewritten: a whole match into
 * `replacement`, or, for a pair `[open, close]`, the match's delimiters —
 * the equal stretches before and after its group 1 — into the two tags,
 * its group 1 kept as it was.
 */
function rewritten(tagged: Tagged, pattern: RegExp, replacement: string | readonly [string, string]): Tagged {
  let text = "";
  const origins: number[] = [];
  const copy = (from: number, to: number): void => {
    text += tagged.text.slice(from, to);
    origins.push(...tagged.origins.slice(from, to));
  };
  const insert = (inserted: string, at: number): void => {
    text += inserted;
    origins.push(...Array.from(inserted, () => tagged.origins[at]!));
  };
  let last = 0;
  for (const match of tagged.text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    copy(last, start);
    if (typeof replacement === "string") {
      insert(replacement, start);
    } else {
      const delimiter = (match[0].length - match[1]!.length) / 2;
      insert(replacement[0], start);
      copy(start + delimiter, end - delimiter);
      insert(replacement[1], end - delimiter);
    }
    last = end;
  }
  copy(last, tagged.text.length);
  origins.push(tagged.origins[tagged.text.length]!);
  return { text, origins };
}

/**
 * A Markdown string's own notation, rewritten as the tags it stands for —
 * which is what Mermaid does with it: its HTML labels turn the string into
 * HTML (`**` into `<strong>`, `*` into `<em>`, a line break into `<br>`) and
 * the browser reads that HTML, tags the author wrote included. So the two
 * notations are one vocabulary, and everything the tags do the stars do:
 * they stack (`**a <i>b</i>**` and `**bold *and* still**` both draw a bold
 * italic run), and a pair spans a row break (`**a<br>b**` is bold on both
 * rows). Each of those measured in mermaid 11.17.2's HTML labels, as
 * `<strong>a <i>b</i></strong>`, `<strong>bold <em>and</em> still</strong>`
 * and `<strong>a<br>b</strong>`.
 *
 * A real line break becomes `<br>` first (measured: `**a⏎b**` is
 * `<strong>a<br>b</strong>`); an ordinary label cannot carry one at all, so
 * rewriting it there would be a rule about nothing. Then every `**…**`
 * pair, then every `*…*` pair, each the shortest that closes: the bold pass
 * goes first so that `**bold**` is one bold run rather than two italic runs
 * sharing a doubled star, and the italic pass goes over its output so that
 * a `*` pair inside a bold one is still read.
 *
 * **A pair opens at stars with no whitespace after them and closes at stars
 * with none before them** — the whitespace half of CommonMark's flanking
 * rule, which is what Mermaid's Markdown reader applies. Measured in
 * 11.17.2's HTML labels: `a * b * c`, `*a *`, `**a **` and `** a**` are drawn
 * as written, stars and all, and `*a * b*` is one italic `a * b`. An italic
 * star may not sit against another star either, so the second star of a
 * `**` that opened nothing (`** a**`) or closed nothing (`**a **`) does not
 * pair on its own.
 *
 * Not the whole of CommonMark, and so not the whole of Mermaid's reading:
 * its punctuation half is not applied (`x**(a)**y` is drawn as written in
 * Mermaid, and bold here), nor `_`/`__` emphasis (`_a_` is italic in
 * Mermaid, measured, and drawn as written here).
 *
 * Mermaid's *SVG* labels read a Markdown string differently — word by word,
 * and an italic run inside a bold one loses the bold — but that mode is the
 * DOM reference, not the picture (ADR-0015).
 */
function markdownAsTags(source: string): Tagged {
  const broken = rewritten(untagged(source), /\n/g, "<br>");
  const bolded = rewritten(broken, /\*\*(?!\s)(.*?)(?<!\s)\*\*/g, ["<strong>", "</strong>"]);
  return rewritten(bolded, /\*(?![\s*])(.*?)(?<![\s*])\*/g, ["<em>", "</em>"]);
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
 *   standard's "adoption agency" steps whenever no block element is open
 *   inside the misnested one, which no tag this reader honors is.
 * - A `q` draws its closing mark where it really closes, early or at the
 *   end of the label, and in its own style rather than the style of a tag
 *   that was open inside it (`<q>a<b>b</q>c</b>d` →
 *   `<q>a<b>b</b></q><b>c</b>d`).
 *
 * - An `<a>` start tag first closes an `<a>` still open, as its end tag
 *   would, so links never nest: `<a href='x'>1<b>2<a href='y'>3</a>4</b>5`
 *   → `<a href="x">1<b>2</b></a><b><a href="y">3</a>4</b>5`.
 *
 * A tag whose name the dialect does not know stays in the text, as written.
 */
function taggedRows(source: string, dialect: LabelDialect, problems: LabelProblem[]): LabelRun[][] {
  const vocabulary: Readonly<Record<string, TagRule>> = dialect === "html" ? HTML_TAGS : {};
  const rows: LabelRun[][] = [];
  let row: LabelRun[] = [];
  let open: OpenTag[] = [];

  /** Appends `text` to the current row, styled by the tags in `stack`. */
  const emit = (text: string, stack: readonly OpenTag[] = open): void => {
    if (text === "") {
      return;
    }
    const run = plainRun(text);
    for (const tag of stack) {
      tag.style?.(run);
    }
    const last = row[row.length - 1];
    if (last !== undefined && sameProperties(last, run)) {
      last.text += text;
    } else {
      row.push(run);
    }
  };

  /**
   * Closes `open[index]` and every tag opened inside it, innermost first,
   * then reopens the formatting ones among those.
   */
  const close = (index: number): void => {
    for (let depth = open.length - 1; depth >= index; depth--) {
      const marks = vocabulary[open[depth]!.name]!.marks;
      if (marks !== undefined) {
        emit(marks.close, open.slice(0, depth + 1));
      }
    }
    const inside = open.slice(index + 1);
    open = [...open.slice(0, index), ...inside.filter((tag) => vocabulary[tag.name]!.formatting)];
  };

  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const isBreak = name === "br" && !closing;
    if (!isBreak && !(name in vocabulary)) {
      continue;
    }
    emit(source.slice(lastIndex, match.index));
    lastIndex = TAG_RE.lastIndex;
    if (isBreak) {
      rows.push(row.length === 0 ? [plainRun("")] : row);
      row = [];
    } else if (!closing) {
      const rule = vocabulary[name]!;
      const already = rule.unnested === true ? open.map((tag) => tag.name).lastIndexOf(name) : -1;
      if (already !== -1) {
        close(already);
      }
      const at = match.index;
      const warn = (message: string): void => {
        problems.push({ severity: "warning", message, offset: at });
      };
      open.push({ name, style: rule.attributes?.(attributesOf(match[0], name), warn) ?? rule.style });
      if (rule.marks !== undefined) {
        emit(rule.marks.open);
      }
    } else {
      const index = open.map((tag) => tag.name).lastIndexOf(name);
      if (index !== -1) {
        close(index);
      }
    }
  }
  emit(source.slice(lastIndex));
  if (open.length > 0) {
    close(0);
  }
  rows.push(row.length === 0 ? [plainRun("")] : row);
  return rows;
}

/** A tag open around the text being read: its name, and what it sets on a run. */
interface OpenTag {
  name: string;
  style: RunStyle | undefined;
}

/** A label of these rows, with the flattened `text` every plain-string reader takes. */
function labelOf(rows: LabelRun[][]): Label {
  return {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
}
