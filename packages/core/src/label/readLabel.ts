import type { Diagnostic } from "../contracts";
import { unsafeStyleValue } from "../unsafeStyleValue";
import { entityCodesAsReferences, resolveCharacterReferences, resolveEntityCodes } from "./characterReferences";
import { isCssColor } from "./cssColor";
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
 * One tag, as the HTML tokenizer reads one: `<`, an optional `/`, a name —
 * a letter, then anything up to whitespace, `/` or `>`, so `my-el` is a
 * name — then anything up to the first `>` that is not inside a quoted
 * attribute value. A value is quoted only when its quote follows the `=`
 * (`<y a'b>` ends at its `>`), and a `/` anywhere in the tag is part of it
 * (`<b/x>` and `<b/ >` are both `<b>`; measured).
 *
 * Or, its second alternative, the `<` and first letter of a tag that never
 * ends — one the label ends inside, a quoted value left open included
 * (no group 2). The tokenizer starts a tag at `<` followed by a letter, or
 * by `/` and a letter, and drops a tag that reaches the end of its input,
 * so in the `html` dialect everything from that `<` on is dropped
 * (measured: `x <y` is `<p>x </p>`, and `a <y z='1> b <i>c</i>` is
 * `<p>a </p>`). A `<` before anything else is a character: `a < b`, `a <1`
 * and `a</` are drawn as written (measured).
 *
 * It finds every tag-shaped stretch of a label, and which of them mean
 * something is `readLabel`'s question, not this pattern's: in the `html`
 * dialect every one does, a name outside the vocabulary included
 * (`UNKNOWN_TAG`); in the `sequence` dialect every one but a row break is
 * left in the text as the characters the author wrote.
 *
 * **A row break** is the name `br`, in any case: `<br>`, `<br/>`,
 * `<br />`, `<BR>`, `<br class="x">` and even `</br>`, which the HTML
 * parser reads as `<br>`, all break a row, and `<brx>` is another name.
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
const TAG_RE = /<(\/?)([a-z][^\s\/>]*)(?:[^>=]|=\s*(?:"[^"]*"|'[^']*'|(?![\s"'])))*>|<\/?[a-z]/gi;

/** A row break in the `sequence` dialect: Mermaid's own `/<br\s*\/?>/gi`, one whole tag. */
const SVG_ROW_BREAK_RE = /^<br\s*\/?>$/i;

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
  /**
   * Whether its start tag opens nothing, so that its end tag finds nothing
   * of its name to close and is dropped, as the HTML parser drops it: a
   * **void** element, which has no content (`wbr`, `hr`), or one the parser
   * ignores inside a label altogether (`html`, `head`, `body`, which belong
   * to the document around it).
   */
  opensNothing?: boolean;
  /**
   * For a tag DOMPurify removes together with its content: how the parser
   * reads that content, which decides where it ends. `"raw text"` is read
   * as characters up to the tag's own end tag — so a tag inside it is text,
   * and goes with it — or to the end of the label when there is none;
   * `"rest"` is everything after the start tag, which nothing ends; and
   * `"elements"` is read as tags like any other, nested and misnested, and
   * only its text is removed.
   */
  removesContent?: "raw text" | "rest" | "elements";
  /**
   * Whether it is a **block** — ADR-0015's block layer, which it
   * approximates: its start and its end each end the row before them, as
   * the browser ends its line at the edge of a block box.
   */
  block?: boolean;
  /**
   * For a block: the names of an open element its start tag first closes,
   * as the HTML parser does — a heading closes a heading only when that is
   * the element just opened (`"current"`).
   */
  closesOpen?: { names: readonly string[]; reach: "current" | "item" };
  /** For a block whose end tag closes others of its kind: the names it closes — any heading's, any heading. */
  endsAny?: readonly string[];
  /**
   * For a block: whether an `li`, `dt` or `dd` start tag looking for the open
   * item it closes looks past it, as the HTML parser looks past `address`,
   * `div` and `p` and stops at any other block.
   */
  itemLooksPast?: boolean;
  /**
   * For a block: whether its end tag with nothing of its name open still
   * ends the row, as the HTML parser reads a stray `</p>` as an empty
   * paragraph (measured: `a</p>b` is `<p>a</p><p></p>b`).
   */
  strayEndIsEmpty?: boolean;
  /**
   * Whether every space inside it is drawn, as `white-space: pre` draws
   * them (`pre`). SVG text collapses a run of spaces and drops them at the
   * ends of a line, as HTML does elsewhere, so each is kept as a no-break
   * space, which it does not; a tab too, one space wide.
   */
  preservesSpaces?: boolean;
  /**
   * Whether it is a list item, whose first row begins with its marker
   * (`li`), and whose end tag closes nothing past a list opened inside it.
   */
  listItem?: boolean;
  /**
   * For a list: what marks the items in it — a bullet by how many lists the
   * list is nested in (`BULLETS`), or the item's number, counted from the list's
   * `start` (1 when it has none) and from an item's own `value`. An item
   * outside every list is bulleted.
   */
  list?: "bulleted" | "numbered";
  /**
   * Whether it walls off the tags open around it, as the HTML parser's
   * `marquee` does (a "scope" boundary): its start tag closes no `<p>`, an
   * end tag inside it closes nothing opened outside it, and the formatting
   * tags opened inside it are not reopened after it.
   */
  walled?: boolean;
  /**
   * For a tag in one of ADR-0015's refused layers: the kind of HTML it is,
   * which the browser draws and SVG text cannot (`REFUSED_KINDS`), and, for
   * a tag refused only when the browser shows it, the attribute that shows
   * it. Mermaid draws it; Siren reports an error-severity problem at the
   * label's first such start tag, and otherwise reads it by the rest of its
   * rule — an element that draws nothing, as `UNKNOWN_TAG`, unless it says
   * more.
   */
  refused?: { kind: RefusedKind; withAttribute?: string };
}

/**
 * ADR-0015's refused kinds of HTML: tables, ruby, images, embedded content,
 * form controls, media and interactive content.
 */
type RefusedKind = "table" | "ruby" | "image" | "embedded" | "form" | "media" | "interactive";

/**
 * How the error-severity problem for a refused tag names its kind — a
 * plural noun, after "does not draw" — and what to write instead, when
 * Mermaid has a way.
 */
const REFUSED_KINDS: Readonly<Record<RefusedKind, { phrase: string; instead?: string }>> = {
  table: { phrase: "tables" },
  ruby: { phrase: "ruby annotations" },
  image: { phrase: "images", instead: 'Draw an image with Mermaid\'s image shape, A@{ img: "…" }, instead.' },
  embedded: { phrase: "embedded content" },
  form: { phrase: "form controls" },
  media: { phrase: "media" },
  interactive: { phrase: "interactive content" },
};

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

/**
 * The attributes of `tag`, one whole start tag as `TAG_RE` matched it, each
 * value with its entity codes and character references resolved — Mermaid
 * rewrites a code in an attribute as it does one in text, and the browser
 * resolves both (measured: `<a href='?a=1#amp;b=2#35;f'>` keeps
 * `?a=1&b=2#f`).
 */
function attributesOf(tag: string, name: string): Attributes {
  const attributes = new Map<string, string>();
  const rest = tag.slice(1 + name.length, tag.endsWith("/>") ? -2 : -1);
  for (const match of rest.matchAll(ATTRIBUTE_RE)) {
    const key = match[1]!.toLowerCase();
    if (!attributes.has(key)) {
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attributes.set(key, resolveCharacterReferences(entityCodesAsReferences(value), "attribute"));
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
 *
 * Nor is a value holding an `&`: it is a code Mermaid rewrote and the browser
 * could not resolve, such as the `#f00;` of `color:#f00;background-color:#ff0;`
 * (measured: `color:&f00`), which the browser drops as a declaration it
 * cannot read. Only a family name in quotes could hold an `&` and still be
 * read, and that is given up for the simpler rule.
 */
function drawableValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || trimmed.includes("&") || unsafeStyleValue(trimmed) !== null ? null : trimmed;
}

/**
 * What `<font size>` 1–7 draws at, as a scale of the size around a label —
 * the spec's measured table: 12 / 13 / 16 / 18 / 20 / 32 / 48px where the
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
 * `value` as a color a run may be drawn in, or `null` for one that is not
 * drawn: one `drawableValue` lets through that is also a CSS color
 * (`isCssColor`) — a browser drops a color it cannot parse, and so paints
 * nothing, where SVG would paint its default black.
 */
function drawableColor(value: string | undefined): string | null {
  const drawable = drawableValue(value);
  return drawable !== null && isCssColor(drawable) ? drawable : null;
}

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

/** A block, as `TagRule.block` describes one, with what else `extra` sets. */
function block(extra: Omit<TagRule, "formatting" | "block"> = {}): TagRule {
  return { formatting: false, block: true, ...extra };
}

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * A heading: a block whose text is bold, at `factor` times the size around
 * it. One heading's start tag closes another that is the current element,
 * and any heading's end tag closes whichever is open: `<h1>a<h2>b</h2>c</h1>d`
 * is `<h1>a</h1><h2>b</h2>cd` (measured).
 */
function heading(factor: number): TagRule {
  const sized = scaled(factor);
  return block({
    closesOpen: { names: HEADINGS, reach: "current" },
    endsAny: HEADINGS,
    style: (run) => {
      bold(run);
      sized(run);
    },
  });
}

/**
 * The properties of `<span style>` Siren draws — ADR-0015's ten, in the
 * spec's order, which is the order the warning lists them in — by lower-case name: what each
 * sets on a run, given a value `drawableValue` let through. A property that
 * cannot read its value answers `null`, and is drawn as unwritten, as the
 * browser drops a declaration it cannot parse.
 */
const SPAN_STYLE_PROPERTIES: Readonly<Record<string, (value: string) => RunStyle | null>> = {
  color: (value) =>
    drawableColor(value) === null
      ? null
      : (run) => {
          run.color = value;
        },
  "background-color": (value) =>
    drawableColor(value) === null
      ? null
      : (run) => {
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
 * headless Chrome (the spec's "measured picture" table), draws `b` and
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
 *
 * The block layer's fonts are measured the same way: `h1`…`h6` bold at × 2
 * / 1.5 / 1.17 / 1 / 0.83 / 0.67, `pre` in `monospace`, `address` italic.
 * What a block also draws and Siren does not — its margins, a list's 40px
 * indent, `hr`'s rule, `marquee`'s motion — is the approximation ADR-0015
 * records.
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
      const color = drawableColor(attributes.get("color"));
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
  // ADR-0015's tags with no rendering of their own: DOMPurify keeps each,
  // and the browser draws its text and nothing else. `nobr` is in the HTML
  // parser's formatting list, `wbr` is void.
  ...Object.fromEntries(
    [
      "abbr", "acronym", "bdi", "bdo", "data", "time", "label", "output", "blink", "spacer",
      "content", "decorator", "element", "shadow", "slot", "menuitem", "map", "picture",
    ].map((name): [string, TagRule] => [name, { formatting: false }]),
  ),
  nobr: { formatting: true },
  wbr: { formatting: false, opensNothing: true },
  // Outside DOMPurify's allow-list and removed with their content, which
  // the parser reads as raw text: `a<script>b<b>c</b></script >d` is `ad`,
  // `a<script>b` is `a`, and `style` is the same (measured). `noframes`
  // measured the same, though ADR-0015 does not list it.
  ...Object.fromEntries(
    ["script", "style", "iframe", "noembed", "xmp", "noframes"].map((name): [string, TagRule] => [
      name,
      { formatting: false, removesContent: "raw text" },
    ]),
  ),
  // Outside the HTML allow-list, but DOMPurify's SVG profile keeps it, and
  // the parser reads its content as text up to `</title>`:
  // `c<title>ti<b>x</b></title>d` is `c<title>ti&lt;b&gt;x&lt;/b&gt;</title>d`
  // (measured). The browser hides it, so its content goes with it.
  title: { formatting: false, removesContent: "raw text" },
  // Nothing ends its content, not even `</plaintext>`: `<b>a</b>b<plaintext>x</plaintext>y<br><b>z</b>`
  // is `<b>a</b>b` (measured).
  plaintext: { formatting: false, removesContent: "rest" },
  // DOMPurify parses with scripting off, so its content is elements:
  // `a<noscript>b<noscript>c</noscript>d</noscript>e` is `ae`, and
  // `a<noscript>b<b>c</noscript>d</b>e` is `a<b>d</b>e` (measured).
  noscript: { formatting: false, removesContent: "elements" },
  // DOMPurify keeps these, and the parser reads their content as elements,
  // but the browser draws none of it (ADR-0015): `datalist` and `rp` are
  // `display: none`, and close at a formatting end tag around them —
  // `<b>a<datalist>c</b>d</datalist>e` is `<b>a<datalist>c</datalist></b>de`
  // (measured).
  datalist: { formatting: false, removesContent: "elements" },
  rp: { formatting: false, removesContent: "elements" },
  // Inert, and walled as `marquee` is: `<b>a<template>c</b>d</template>e` is
  // `<b>a<template>cd</template>e</b>` (measured).
  template: { formatting: false, removesContent: "elements", walled: true },
  // Void, so there is nothing in them to remove, and `display: none`:
  // `a<source>b</source>c` is `a<source>bc`, `track` and `area` the same
  // (measured).
  ...Object.fromEntries(
    ["source", "track", "area"].map((name): [string, TagRule] => [name, { formatting: false, opensNothing: true }]),
  ),
  // Inside a label the parser ignores both tags of each, so nothing closes
  // at them and their text is kept: `<body>a<sub>b</body>c</sub>d` is
  // `a<sub>bc</sub>d` (measured). `style`, the fourth tag Mermaid removes,
  // is removed with its content, above.
  // The block layer, ADR-0015's one approximation: each is a block box in
  // the browser, and Siren draws it as rows of its own.
  ...Object.fromEntries(
    [
      "blockquote", "dl", "section", "article", "aside", "center",
      "figcaption", "figure", "footer", "header", "hgroup", "main", "nav", "search", "summary",
    ].map((name): [string, TagRule] => [name, block()]),
  ),
  // A stray `</p>` is read as an empty paragraph: `a</p>b` is
  // `<p>a</p><p></p>b` (measured).
  p: block({ itemLooksPast: true, strayEndIsEmpty: true }),
  div: block({ itemLooksPast: true }),
  // `menu` and `dir` are drawn as `ul` is, by the browser's default stylesheet.
  ...Object.fromEntries(["ul", "menu", "dir"].map((name): [string, TagRule] => [name, block({ list: "bulleted" })])),
  ol: block({ list: "numbered" }),
  // Drawn still: `<b>x<marquee>a</b>c</marquee>d` is
  // `<b>x<marquee>ac</marquee>d</b>` (measured).
  marquee: block({ walled: true }),
  // Either start tag closes an open `dt` or `dd`, as `li` closes an `li`:
  // `<dt>a<dd>b</dt>c` is `<dt>a</dt><dd>bc</dd>` (measured).
  ...Object.fromEntries(
    ["dt", "dd"].map((name): [string, TagRule] => [name, block({ closesOpen: { names: ["dt", "dd"], reach: "item" } })]),
  ),
  pre: block({ style: monospace, preservesSpaces: true }),
  // A void block: `a<hr>b` is `<p>a</p><hr>b` (measured). The rule the
  // browser draws is not drawn; it is a row edge only.
  hr: block({ opensNothing: true }),
  // An `li` start tag closes an open `li`: `x<li>a<li>b` is
  // `<p>x</p><li>a</li><li>b</li>` (measured).
  li: block({ closesOpen: { names: ["li"], reach: "item" }, listItem: true }),
  address: block({ style: italic, itemLooksPast: true }),
  // Bold, at the spec's measured scales of the size around them.
  h1: heading(2),
  h2: heading(1.5),
  h3: heading(1.17),
  h4: heading(1),
  h5: heading(0.83),
  h6: heading(0.67),
  html: { formatting: false, opensNothing: true },
  head: { formatting: false, opensNothing: true },
  body: { formatting: false, opensNothing: true },
  // ADR-0015's refused layers: DOMPurify keeps each (measured), and what the
  // browser draws for it needs a layout SVG text does not have.
  ...refusedLayer("table", ["table"]),
  // A table's parts, outside a table, are ignored by the parser as `html`
  // is, start and end tags alike: `a<td>x</td>b` is `axb`, `a<col>b` is
  // `ab`, and `<td>a<sub>b</td>c</sub>d` is `a<sub>bc</sub>d` (measured).
  // Inside one the label is already refused, at `<table>`.
  ...Object.fromEntries(
    ["tr", "td", "th", "thead", "tbody", "tfoot", "caption", "col", "colgroup"].map((name): [string, TagRule] => [
      name,
      { formatting: false, opensNothing: true },
    ]),
  ),
  ...refusedLayer("ruby", ["ruby", "rt"]),
  // The embedded, form, media and interactive layer, by what each draws.
  ...refusedLayer("image", ["img"]),
  // `svg` and `math` are outside the HTML allow-list, but DOMPurify's SVG
  // and MathML profiles keep them (measured): in Mermaid an `<svg>` is an
  // empty 300×150 box and a `<math>` is MathML, neither of them text.
  ...refusedLayer("embedded", ["canvas", "svg", "math"]),
  ...refusedLayer("form", [
    "input", "button", "select", "textarea", "form", "fieldset", "legend", "option", "optgroup", "meter",
    "progress",
  ]),
  ...refusedLayer("media", ["video", "audio"]),
  ...refusedLayer("interactive", ["details"]),
  // A closed `dialog` is hidden, so it is removed with its content, as a
  // block: `a<dialog>t</dialog>b` is `<p>a</p><dialog>t</dialog>b<p></p>`
  // (measured). DOMPurify keeps `open`, and an open one is drawn, a box SVG
  // text cannot draw.
  dialog: block({ removesContent: "elements", refused: { kind: "interactive", withAttribute: "open" } }),
};

/** One refused layer's tags, each refused as `kind` (`TagRule.refused`). */
function refusedLayer(kind: RefusedKind, names: readonly string[]): Record<string, TagRule> {
  return Object.fromEntries(names.map((name): [string, TagRule] => [name, { formatting: false, refused: { kind } }]));
}

/**
 * What a tag outside `HTML_TAGS` is in the `html` dialect: an element that
 * draws nothing. DOMPurify drops a tag it does not allow and keeps its text
 * (measured: `e<foo>f</foo>g<my-el>h</my-el>i<object>j</object>k` is
 * `efghijk`), but only after the browser's parser has built the element, so
 * its end tag still closes what was opened inside it: `<foo>a<sub>b</foo>c</sub>d`
 * is `a<sub>b</sub>cd` (measured).
 */
const UNKNOWN_TAG: TagRule = { formatting: false };

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
  const written = withoutStyleSemicolons(untagged(source));
  const tagged = options.markdown === true ? markdownAsTags(written) : written;
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

/** `tagged` with every match of `pattern` rewritten into `replacement`. */
function rewritten(tagged: Tagged, pattern: RegExp, replacement: string): Tagged {
  let text = "";
  const origins: number[] = [];
  let last = 0;
  for (const match of tagged.text.matchAll(pattern)) {
    text += tagged.text.slice(last, match.index) + replacement;
    origins.push(
      ...tagged.origins.slice(last, match.index),
      ...Array.from(replacement, () => tagged.origins[match.index]!),
    );
    last = match.index + match[0].length;
  }
  text += tagged.text.slice(last);
  origins.push(...tagged.origins.slice(last));
  return { text, origins };
}

/**
 * `tagged` without the `;` Mermaid drops before it reads entity codes: the
 * last one on a line where `style` (or `classDef`), a `:` and then a `#`
 * come before it — its own `/style.*:\S*#.*;/` and `/classDef.*:\S*#.*;/`,
 * meant for a `style` statement's `fill:#f00;`, run over the whole document.
 * So `<span style='color:#0f0;'>` is a color and not the code `#0f0;`
 * (measured: Mermaid hands the browser `style="color:#0f0"`).
 *
 * Mermaid runs it over each line of the document, and a label sees only its
 * own part of one: a `;` after the label on the same line (a statement's
 * trailing `;`) is the one Mermaid drops there, and here the label's own
 * last one is.
 */
function withoutStyleSemicolons(tagged: Tagged): Tagged {
  let result = tagged;
  for (const pattern of [/style.*:\S*#.*;/g, /classDef.*:\S*#.*;/g]) {
    const dropped = new Set(Array.from(result.text.matchAll(pattern), (match) => match.index + match[0].length - 1));
    result = {
      text: result.text
        .split("")
        .filter((_, index) => !dropped.has(index))
        .join(""),
      origins: result.origins.filter((_, index) => !dropped.has(index)),
    };
  }
  return result;
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
 * **The stars and underscores pair as CommonMark pairs them**, because
 * Mermaid's Markdown reader (marked 16) does — every case below measured in
 * 11.17.2's HTML labels:
 *
 * - `_…_` is italic and `__…__` bold, as `*…*` and `**…**` are, and the
 *   two characters nest in each other (`**a _b_ c**` is bold with an
 *   italic `b`) but never pair with each other (`*a_` is drawn as written).
 * - A run of them opens only with no whitespace after it and closes only
 *   with none before it: `a * b * c`, `*a *`, `** a**` and `**a⏎**` are
 *   drawn as written, a line break counting as whitespace, and `*a * b*` is
 *   one italic `a * b`.
 * - Against punctuation, a run opens only from the outside of a word:
 *   `x**(a)**y`, `a**.b**` and `x_(a)_y` are drawn as written, while
 *   `*(a)*`, `**(a)**`, `(**a**)` and `a.**b**c` are emphasis.
 * - An underscore inside a word opens and closes nothing: `a_b_c`, `_a_b`,
 *   `a__b__c` and `x__a__y` are drawn as written, `__a_b__` is a bold
 *   `a_b`. Stars do pair inside a word: `a*b*c`, `x**a**y`.
 * - The rule of three: a run that could both open and close does not pair
 *   with one when their lengths sum to a multiple of three, so `*a**b*` is
 *   an italic `a**b` and `*foo**bar**baz*` a bold `bar` inside an italic
 *   word. Leftover delimiters stay characters: `*a**` is an italic `a`
 *   then `*`, and `***a***` bold italic.
 * - A tag the author wrote is read whole, so no `_` or `*` inside it pairs:
 *   `<a href='http://x/_a_/'>` keeps its href.
 *
 * **A backslash before ASCII punctuation escapes it**: the backslash is
 * dropped and the character is drawn as written, never a delimiter
 * (`a \*b\* c` is `<p>a *b* c</p>`, `\\` is `<p>\</p>`); before anything
 * else a backslash is a character (`a\b`, `\é`). See `unescaped`.
 *
 * **A real line break becomes `<br>`** after the pairing (measured: `**a⏎b**`
 * is `<strong>a<br>b</strong>`, `line1⏎line2` `<p>line1<br>line2</p>`),
 * except where Markdown reads it otherwise: after two spaces or a backslash
 * it is a hard break, which Mermaid hands the browser as the characters
 * written and the browser draws as one space (`hardBreaksJoined`); and a
 * blank line is a paragraph break, `</p><p>`, which no pair spans
 * (`BLANK_LINES_RE`). An ordinary label cannot carry a line break at all, so
 * rewriting it there would be a rule about nothing. Code spans and the rest
 * of Markdown's inline syntax are not read.
 *
 * Mermaid's *SVG* labels read a Markdown string differently — word by word,
 * and an italic run inside a bold one loses the bold — but that mode is the
 * DOM reference, not the picture (ADR-0015).
 */
function markdownAsTags(source: Tagged): Tagged {
  const { tagged, escaped } = unescaped(hardBreaksJoined(source));
  return rewritten(rewritten(emphasized(tagged, escaped), BLANK_LINES_RE, "<p>"), /\n/g, "<br>");
}

/**
 * A blank line, and any more after it, in a Markdown string: a paragraph
 * break, which Mermaid hands the browser as `</p><p>` (measured: `a⏎⏎b`,
 * `a⏎⏎⏎b` and `a⏎␣⏎b` are each `<p>a</p><p>b</p>`). A `<p>` start tag
 * closes the paragraph open before it, as that end tag would.
 */
const BLANK_LINES_RE = /\n[ \t]*\n\s*/g;

/**
 * `tagged` with each of Markdown's hard line breaks — a line break after two
 * or more spaces, or after a backslash no other backslash escapes — drawn
 * as the one space the browser draws it as. Mermaid hands the browser a hard
 * break as the characters written, not as a `<br>` (measured: `a␣␣⏎b` is
 * `<p>a  \nb</p>`, `a\⏎b` is `<p>a\\\nb</p>`), and the label's
 * `white-space: nowrap` collapses them into one space on the row: `a b`,
 * and `a\ b` with its backslash. Before a blank line neither is a hard
 * break (measured: `a␣␣⏎⏎b` is `<p>a  </p><p>b</p>`, `a\⏎⏎b` is
 * `<p>a\</p><p>b</p>`).
 */
function hardBreaksJoined(tagged: Tagged): Tagged {
  const notBlank = String.raw`(?![ \t]*(?:\n|$))`;
  const spaces = new RegExp(String.raw` {2,}\n` + notBlank, "g");
  const backslash = new RegExp(String.raw`(?<=(?:^|[^\\])(?:\\\\)*)\\\n` + notBlank, "g");
  return rewritten(rewritten(tagged, spaces, " "), backslash, "\\ ");
}

/**
 * `tagged` with Markdown's backslash escapes read: a backslash before an
 * ASCII punctuation character is dropped, and the character after it is
 * kept as written — `escaped` holds where each such character now is, so
 * that it is never a delimiter. A backslash before anything else is a
 * character, and so is one inside a tag the author wrote.
 *
 * Mermaid sanitizes the string before its Markdown reader sees it, so a tag
 * DOMPurify removes is gone by then, and the backslash before it escapes
 * whatever came after it (see `escapedBy`).
 */
function unescaped(tagged: Tagged): { tagged: Tagged; escaped: ReadonlySet<number> } {
  const { text } = tagged;
  const inTag = insideTags(text);
  let result = "";
  const origins: number[] = [];
  const escaped = new Set<number>();
  const copy = (from: number, to: number): void => {
    result += text.slice(from, to);
    origins.push(...tagged.origins.slice(from, to));
  };
  let last = 0;
  for (let index = 0; index < text.length; index++) {
    const target = text[index] === "\\" && !inTag(index) ? escapedBy(text, index) : undefined;
    if (target !== undefined) {
      copy(last, index);
      copy(index + 1, target);
      escaped.add(result.length);
      last = target;
      index = target;
    }
  }
  copy(last, text.length);
  origins.push(tagged.origins[text.length]!);
  return { tagged: { text: result, origins }, escaped };
}

/**
 * Where the character the backslash at `backslash` escapes is, or
 * `undefined` when it is a backslash as written: the next character, when
 * it is ASCII punctuation — past any tags DOMPurify removes before Mermaid's
 * Markdown reader runs (measured: `x\<foo>*y*` is `<p>x*y*</p>`, and both
 * `x\<b\>y` and `x\</b>y` are `<p>x\y</p>`). Those are a tag outside the
 * vocabulary, and an end tag with no start tag of its name before it; a tag
 * left unterminated takes the rest of the label with it (`a\<b` is
 * `<p>a\</p>`). A tag the vocabulary keeps reaches Markdown, so its `<` is
 * the escaped character, and it is still a tag (`x\<b>y</b>` is
 * `<p>x<b>y</b></p>`).
 */
function escapedBy(text: string, backslash: number): number | undefined {
  const tag = new RegExp(TAG_RE.source, "iy");
  let at = backslash + 1;
  for (;;) {
    tag.lastIndex = at;
    const match = tag.exec(text);
    if (match === null) {
      break;
    }
    if (!match[0].endsWith(">")) {
      return undefined;
    }
    const name = match[2]!.toLowerCase();
    const opened =
      match[1] !== "/" ||
      tagsIn(text.slice(0, backslash)).some(
        (before) => before[1] !== "/" && before[2]?.toLowerCase() === name,
      );
    if (Object.hasOwn(HTML_TAGS, name) && opened) {
      break;
    }
    at = tag.lastIndex;
  }
  return ASCII_PUNCTUATION_RE.test(text[at] ?? "") ? at : undefined;
}

/** One of the ASCII punctuation characters a Markdown backslash escapes. */
const ASCII_PUNCTUATION_RE = /^[!-/:-@[-`{-~]$/;

/**
 * Every match of `TAG_RE` in `text`, from its start: `matchAll` would
 * begin wherever the shared pattern's `lastIndex` was left, which the tag
 * reader leaves past zero when it stops early at an unterminated tag.
 */
function tagsIn(text: string): RegExpExecArray[] {
  return Array.from(text.matchAll(new RegExp(TAG_RE.source, "gi")));
}

/** Whether an offset in `text` lies inside a tag the author wrote, which Markdown reads whole. */
function insideTags(text: string): (index: number) => boolean {
  const tags = tagsIn(text).map((tag) => [tag.index, tag.index + tag[0].length] as const).filter(
    ([, end]) => text[end - 1] === ">",
  );
  return (index) => tags.some(([start, end]) => start < index && index < end);
}

/**
 * One run of `*` or `_` in a Markdown string, and what pairing made of it:
 * as a closer it is used from its left, as an opener from its right, and
 * each pair it takes part in leaves a tag where its delimiters were.
 */
interface DelimiterRun {
  character: string;
  start: number;
  length: number;
  canOpen: boolean;
  canClose: boolean;
  /** The end tags it became as a closer, innermost first, each at the delimiter it stands for. */
  closes: { tag: string; at: number }[];
  /** The start tags it became as an opener, innermost first. */
  opens: { tag: string; at: number }[];
  /** How many of its delimiters, from its left, closers used. */
  closed: number;
  /** How many of its delimiters, from its right, openers used. */
  opened: number;
}

/** How many of `run`'s delimiters are still characters. */
function unused(run: DelimiterRun): number {
  return run.length - run.closed - run.opened;
}

/**
 * `tagged` with its `*`/`_` emphasis paired into `<em>` and `<strong>`, by
 * CommonMark's delimiter-run procedure (see `markdownAsTags`).
 */
function emphasized(tagged: Tagged, escaped: ReadonlySet<number>): Tagged {
  const { text } = tagged;
  const runs = delimiterRuns(text, escaped);
  const paragraphBreaks = Array.from(text.matchAll(BLANK_LINES_RE), (match) => match.index);
  const paragraphOf = (run: DelimiterRun): number => paragraphBreaks.filter((at) => at < run.start).length;
  let openers: DelimiterRun[] = [];
  for (const [position, run] of runs.entries()) {
    // No pair spans a paragraph break (measured: `**a⏎⏎b**` is `<p>**a</p><p>b**</p>`).
    if (position > 0 && paragraphOf(run) !== paragraphOf(runs[position - 1]!)) {
      openers = [];
    }
    while (run.canClose && unused(run) > 0) {
      let index = openers.length - 1;
      while (index >= 0 && !pairs(openers[index]!, run)) {
        index--;
      }
      if (index < 0) {
        break;
      }
      const opener = openers[index]!;
      const used = unused(opener) >= 2 && unused(run) >= 2 ? 2 : 1;
      const [open, close] = used === 2 ? ["<strong>", "</strong>"] : ["<em>", "</em>"];
      opener.opened += used;
      opener.opens.push({ tag: open, at: opener.start + opener.length - opener.opened });
      run.closes.push({ tag: close, at: run.start + run.closed });
      run.closed += used;
      // The delimiters between the two can no longer pair, and a spent opener goes too.
      openers.splice(unused(opener) > 0 ? index + 1 : index);
    }
    if (run.canOpen && unused(run) > 0) {
      openers.push(run);
    }
  }

  let result = "";
  const origins: number[] = [];
  const copy = (from: number, to: number): void => {
    result += text.slice(from, to);
    origins.push(...tagged.origins.slice(from, to));
  };
  const insert = (tag: string, at: number): void => {
    result += tag;
    origins.push(...Array.from(tag, () => tagged.origins[at]!));
  };
  let last = 0;
  for (const run of runs) {
    copy(last, run.start);
    run.closes.forEach(({ tag, at }) => insert(tag, at));
    copy(run.start + run.closed, run.start + run.length - run.opened);
    [...run.opens].reverse().forEach(({ tag, at }) => insert(tag, at));
    last = run.start + run.length;
  }
  copy(last, text.length);
  origins.push(tagged.origins[text.length]!);
  return { text: result, origins };
}

/**
 * Whether `opener` can pair with `closer`: runs of one character, and —
 * CommonMark's rule of three — when either could both open and close, not
 * two whose lengths sum to a multiple of three unless both lengths are
 * multiples of three themselves.
 */
function pairs(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (opener.character !== closer.character) {
    return false;
  }
  const either = opener.canClose || closer.canOpen;
  const lengths = opener.length + closer.length;
  return !either || lengths % 3 !== 0 || (opener.length % 3 === 0 && closer.length % 3 === 0);
}

/**
 * Every run of `*` or of `_` in `text`, with whether it can open and close
 * emphasis: a run is left-flanking when no whitespace follows it and,
 * if punctuation does, whitespace or punctuation precedes it; right-flanking
 * is the mirror image. The label's ends count as whitespace. A `*` run
 * opens when left-flanking and closes when right-flanking; a `_` run inside
 * a word, both at once, does neither unless punctuation sits on the side it
 * would open or close from.
 *
 * A tag the author wrote is read whole, as Markdown reads inline HTML, so
 * no run inside one is a delimiter (`<a href='/_a_/'>` keeps its href).
 */
function delimiterRuns(text: string, escaped: ReadonlySet<number>): DelimiterRun[] {
  const inTag = insideTags(text);
  const spans = Array.from(text.matchAll(/\*+|_+/g)).flatMap((match) => unescapedSpans(match.index, match[0], escaped));
  return spans.map(({ start, written }) => {
    const before = text[start - 1] ?? " ";
    const after = text[start + written.length] ?? " ";
    const outside = (side: string): boolean => WHITESPACE_RE.test(side) || PUNCTUATION_RE.test(side);
    const leftFlanking = !WHITESPACE_RE.test(after) && (!PUNCTUATION_RE.test(after) || outside(before));
    const rightFlanking = !WHITESPACE_RE.test(before) && (!PUNCTUATION_RE.test(before) || outside(after));
    const star = written[0] === "*";
    return {
      character: written[0]!,
      start,
      length: written.length,
      canOpen: leftFlanking && (star || !rightFlanking || PUNCTUATION_RE.test(before)),
      canClose: rightFlanking && (star || !leftFlanking || PUNCTUATION_RE.test(after)),
      closes: [],
      opens: [],
      closed: 0,
      opened: 0,
    };
  }).filter((run) => !inTag(run.start));
}

/**
 * The parts of `run`, a run of one delimiter character at `start` in the
 * text, that no backslash escaped: an escaped character is a character, and
 * splits the run around it (`\**a**` is `*` then an italic `a` then `*`).
 */
function unescapedSpans(
  start: number,
  run: string,
  escaped: ReadonlySet<number>,
): { start: number; written: string }[] {
  const spans: { start: number; written: string }[] = [];
  let from = start;
  for (let index = start; index <= start + run.length; index++) {
    if (index === start + run.length || escaped.has(index)) {
      if (index > from) {
        spans.push({ start: from, written: run.slice(from - start, index - start) });
      }
      from = index + 1;
    }
  }
  return spans;
}

/** A Unicode whitespace character, as CommonMark's flanking rule counts one. */
const WHITESPACE_RE = /\s/u;

/** A Unicode punctuation or symbol character, as CommonMark's flanking rule counts one. */
const PUNCTUATION_RE = /[\p{P}\p{S}]/u;

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
 * In the `sequence` dialect every tag but a row break stays in the text, as
 * written.
 */
function taggedRows(source: string, dialect: LabelDialect, problems: LabelProblem[]): LabelRun[][] {
  /** What `name` does in this dialect, or `undefined` for a tag left as its characters. */
  const ruleOf = (name: string): TagRule | undefined =>
    dialect === "html" ? (HTML_TAGS[name] ?? UNKNOWN_TAG) : undefined;
  const rows: LabelRun[][] = [];
  let row: LabelRun[] = [];
  /**
   * Whether the current row is drawn even with nothing on it: one a `<br>`
   * began, or the label's first, is drawn; one a block edge began is drawn
   * only once something is on it.
   */
  let held = true;
  /**
   * Whether the current row began at a block edge, where the browser drops
   * the spaces at either end of its line (CSS's white-space processing). Rows
   * no block touches keep theirs, as they always have.
   */
  let edge = false;
  // Mermaid hands the browser every label inside a `<p>` of its own (measured:
  // `x` is `<p>x</p>`), so the label begins inside an open paragraph, which
  // the first block closes like any other.
  let open: OpenTag[] = dialect === "html" ? [{ name: "p", rule: HTML_TAGS.p!, style: undefined }] : [];

  /**
   * Appends `written` to the current row, styled by the tags in `stack`:
   * its spaces kept inside a `pre`, the spaces that begin a row at a block
   * edge dropped, and the markers still waiting in `stack` drawn before it.
   */
  const emit = (written: string, stack: readonly OpenTag[] = open): void => {
    const kept = stack.some((tag) => tag.rule.preservesSpaces === true) ? written.replace(/[ \t]/g, "\u00a0") : written;
    const text = edge && row.length === 0 ? kept.replace(/^[ \t\n]+/, "") : kept;
    if (text === "" || removed(stack)) {
      return;
    }
    drawMarkers(stack);
    put(text, stack);
  };

  /** Appends `text` to the current row as it stands, styled by the tags in `stack`. */
  const put = (text: string, stack: readonly OpenTag[]): void => {
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
   * Draws the markers of the list items in `stack` that have not drawn one
   * yet, outermost first, each in its item's own style, as the browser's
   * `::marker` is drawn. A marker waits for its item's first row, so an
   * item whose content begins with a block (`<li><p>a</p>`) draws it beside
   * `a` rather than on a row of its own, as the browser places it; nested
   * items that begin together draw theirs side by side.
   */
  const drawMarkers = (stack: readonly OpenTag[]): void => {
    stack.forEach((tag, depth) => {
      if (tag.marker !== undefined) {
        put(tag.marker, stack.slice(0, depth + 1));
        tag.marker = undefined;
      }
    });
  };

  /** Ends the row at the edge of a block, if anything is on it. */
  const boundary = (): void => {
    trimEnd(row);
    if (row.length > 0) {
      rows.push(row);
      row = [];
    }
    held = false;
    edge = true;
  };

  /**
   * Closes `open[index]` and every tag opened inside it, innermost first,
   * then reopens the formatting ones among those.
   */
  const close = (index: number): void => {
    // An item that closes before anything was drawn in it is still a row
    // with its marker on it.
    if (open.slice(index).some((tag) => tag.marker !== undefined) && !removed(open)) {
      drawMarkers(open);
    }
    for (let depth = open.length - 1; depth >= index; depth--) {
      const marks = open[depth]!.rule.marks;
      if (marks !== undefined) {
        emit(marks.close, open.slice(0, depth + 1));
      }
    }
    const inside = open[index]!.rule.walled === true ? [] : open.slice(index + 1);
    open = [...open.slice(0, index), ...inside.filter((tag) => tag.rule.formatting)];
  };

  /** Where the tags an end tag or a block can reach begin: at the innermost walled tag, or the bottom. */
  const floor = (): number => Math.max(0, open.map((tag) => tag.rule.walled === true).lastIndexOf(true));

  /** The innermost open tag named one of `names` that is within reach, or `-1`. */
  const reachable = (names: readonly string[]): number => {
    const index = Math.max(...names.map((name) => open.map((tag) => tag.name).lastIndexOf(name)));
    return index >= floor() ? index : -1;
  };

  /**
   * Where the open item `names` closes is, as the HTML parser looks for one
   * at an `li`, `dt` or `dd` start tag: the innermost open tag, looking past
   * inline tags and an `address`, `div` or `p`, and stopping at any other
   * block — so an `li` inside a nested list does not close the item the list
   * is in. `-1` when there is none.
   */
  const openItem = (names: readonly string[]): number => {
    for (let depth = open.length - 1; depth >= 0; depth--) {
      const tag = open[depth]!;
      if (names.includes(tag.name)) {
        return depth;
      }
      if (tag.rule.block === true && tag.rule.itemLooksPast !== true) {
        return -1;
      }
    }
    return -1;
  };

  /**
   * Opens a block: first closes an open `<p>`, as the HTML parser closes one
   * at a block's start tag, then puts the formatting tags that closed back
   * inside the block, where the parser reopens them.
   */
  const openBlock = (tag: OpenTag, attributes: Attributes): void => {
    const paragraph = tag.rule.walled === true ? -1 : reachable(["p"]);
    const reopened = paragraph === -1 ? [] : open.slice(paragraph + 1).filter((each) => each.rule.formatting);
    if (paragraph !== -1) {
      close(paragraph);
      open = open.slice(0, paragraph);
    }
    const closes = tag.rule.closesOpen;
    if (closes !== undefined) {
      const index = closes.reach === "current" ? open.length - 1 : openItem(closes.names);
      if (index !== -1 && closes.names.includes(open[index]!.name)) {
        close(index);
      }
    }
    if (tag.rule.listItem === true) {
      const at = open.map((each) => each.rule.list !== undefined).lastIndexOf(true);
      const list = open[at];
      if (list?.rule.list === "numbered") {
        const number = htmlInteger(attributes.get("value")) ?? list.next ?? 1;
        list.next = number + 1;
        tag.marker = `${number}. `;
      } else {
        const depth = open.slice(0, Math.max(0, at)).filter((each) => each.rule.list !== undefined).length;
        tag.marker = `${BULLETS[Math.min(depth, BULLETS.length - 1)]} `;
      }
    }
    if (tag.rule.list === "numbered") {
      tag.next = htmlInteger(attributes.get("start")) ?? 1;
    }
    open.push(...(tag.rule.opensNothing === true ? [] : [tag]), ...reopened);
  };

  /**
   * The characters a stretch of source between two tags draws. In the
   * `html` dialect Mermaid hands the browser its entity codes as character
   * references, among any the author wrote as such, and the browser
   * resolves them all. In the `sequence` dialect only the codes resolve:
   * Mermaid escapes the rest of sequence text, a reference the author wrote
   * included.
   */
  const textOf = (written: string): string =>
    dialect === "html"
      ? resolveCharacterReferences(entityCodesAsReferences(written), "text")
      : resolveEntityCodes(written);

  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    if (match[2] === undefined) {
      // A tag the label ends inside. In the `html` dialect it is dropped
      // with the rest of the label; in the `sequence` dialect it is text.
      if (dialect === "html") {
        emit(textOf(source.slice(lastIndex, match.index)));
        lastIndex = source.length;
        break;
      }
      continue;
    }
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    // In the `html` dialect a stray `</br>` breaks too, as the HTML parser
    // reads it as `<br>` (measured: `a</br>b` is `a<br>b`).
    const isBreak = name === "br" && (dialect === "html" || (!closing && SVG_ROW_BREAK_RE.test(match[0])));
    const rule = ruleOf(name);
    if (!isBreak && rule === undefined) {
      continue;
    }
    emit(textOf(source.slice(lastIndex, match.index)));
    lastIndex = TAG_RE.lastIndex;
    if (isBreak || rule === undefined) {
      if (removed(open)) {
        continue;
      }
      rows.push(row.length === 0 ? [plainRun("")] : row);
      row = [];
      held = true;
      edge = false;
    } else if (!closing) {
      if (rule.removesContent === "raw text" || rule.removesContent === "rest") {
        const end = new RegExp(`</${name}(?:[\\s/][^>]*)?>`, "gi");
        end.lastIndex = lastIndex;
        lastIndex = rule.removesContent === "rest" || end.exec(source) === null ? source.length : end.lastIndex;
        TAG_RE.lastIndex = lastIndex;
        continue;
      }
      // One error-severity problem per label, at its first refused tag: it
      // costs the document either way, and the label has to be rewritten
      // whichever one the author looks at first. Inside removed content the
      // tag is removed too, and costs nothing.
      const attributes = attributesOf(match[0], name);
      if (
        rule.refused !== undefined &&
        (rule.refused.withAttribute === undefined || attributes.has(rule.refused.withAttribute)) &&
        !removed(open) &&
        !hasError(problems)
      ) {
        problems.push({ severity: "error", message: refusal(name, rule.refused.kind), offset: match.index });
      }
      if (rule.opensNothing === true && rule.block !== true) {
        continue;
      }
      const already = rule.unnested === true ? open.map((tag) => tag.name).lastIndexOf(name) : -1;
      if (already !== -1) {
        close(already);
      }
      const at = match.index;
      const warn = (message: string): void => {
        problems.push({ severity: "warning", message, offset: at });
      };
      const tag = { name, rule, style: rule.attributes?.(attributes, warn) ?? rule.style };
      if (rule.block === true) {
        openBlock(tag, attributes);
      } else {
        open.push(tag);
      }
      if (rule.marks !== undefined) {
        emit(rule.marks.open);
      }
      if (rule.block === true) {
        boundary();
      }
    } else {
      const names = rule.endsAny ?? [name];
      const found = reachable(names);
      // An item's end tag does not reach past a list opened inside the item.
      const index =
        rule.listItem === true && open.slice(found + 1).some((tag) => tag.rule.list !== undefined) ? -1 : found;
      // The first block opened inside it, which its end tag does not close.
      const block = open.findIndex((tag, depth) => depth > index && tag.rule.block === true);
      if (index === -1) {
        // Nothing of its name is open: dropped.
      } else if (rule.block === true || block === -1) {
        close(index);
      } else if (rule.formatting) {
        // The HTML parser's adoption agency, with a block inside: the
        // formatting tag ends, the ordinary tags between it and the block go
        // with it, and the block and the formatting tags around it stay.
        open = open.filter(
          (tag, depth) => depth !== index && (depth < index || depth >= block || tag.rule.formatting),
        );
      }
      // A block's end tag with nothing of its name open is dropped, unless
      // the parser reads it as an empty block, whose edges end the row.
      if (rule.block === true && (index !== -1 || rule.strayEndIsEmpty === true)) {
        boundary();
      }
    }
  }
  emit(textOf(source.slice(lastIndex)));
  if (open.length > 0) {
    close(0);
  }
  if (edge) {
    trimEnd(row);
  }
  if (row.length > 0 || held || rows.length === 0) {
    rows.push(row.length === 0 ? [plainRun("")] : row);
  }
  return rows;
}

/** The error-severity problem's message for a start tag `<name>` of a refused `kind`. */
function refusal(name: string, kind: RefusedKind): string {
  const { phrase, instead } = REFUSED_KINDS[kind];
  const message = `<${name}> cannot be drawn: Siren draws labels as SVG text, not HTML, and does not draw ${phrase}.`;
  return instead === undefined ? message : `${message} ${instead}`;
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
  /** A list item's marker, until its first row draws it. */
  marker?: string | undefined;
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
