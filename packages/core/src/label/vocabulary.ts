/**
 * The `html` dialect's tag vocabulary: what each tag a label may hold does —
 * the style it sets on the runs inside it, how the HTML parser nests and
 * closes it, whether it is a block, removed with its content, or refused —
 * and how a start tag's attributes are read. Where in a label the tags are
 * is the tokenizer's (`tags.ts`), and reading them into rows is
 * `readLabel`'s.
 */
import { unsafeStyleValue } from "../unsafeStyleValue";
import { htmlText } from "./characterReferences";
import { isCssColor } from "./cssColor";
import { relativeScale, type LabelRun } from "./label";

/** What one styling tag does to a run it is open around. */
export type RunStyle = (run: LabelRun) => void;

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
 *
 * An inline tag (`InlineRule`) or a block (`BlockRule`), told apart by
 * `kind`: what only a block can be — a list, a list item, a `pre` — is a
 * field of `BlockRule` alone, and every yes-or-no fact is written out, so a
 * reader tests a value rather than whether an optional flag is there.
 */
export type TagRule = InlineRule | BlockRule;

/** What every tag in the vocabulary says, inline or block. */
interface CommonRule {
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
   * What its start tag opens:
   *
   * - `"element"` — an element, which nests like any other.
   * - `"unnested element"` — an element that first closes one of its name
   *   still open, as its end tag would: the HTML parser's rule for `a`,
   *   which cannot nest.
   * - `"nothing"` — so that its end tag finds nothing of its name to close
   *   and is dropped, as the HTML parser drops it: a **void** element, which
   *   has no content (`wbr`, `hr`), or one the parser ignores inside a label
   *   altogether (`html`, `head`, `body`, which belong to the document
   *   around it).
   */
  opens: "element" | "unnested element" | "nothing";
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
   * Whether it walls off the tags open around it, as the HTML parser's
   * `marquee` does (a "scope" boundary): its start tag closes no `<p>`, an
   * end tag inside it closes nothing opened outside it, and the formatting
   * tags opened inside it are not reopened after it.
   */
  walled: boolean;
  /**
   * For a tag in one of ADR-0015's refused layers: the kind of HTML it is,
   * which the browser draws and SVG text cannot (`sanitizer.ts` names it), and, for
   * a tag refused only when the browser shows it, the attribute that shows
   * it. Mermaid draws it; Siren reports an error-severity problem at the
   * label's first such start tag, and otherwise reads it by the rest of its
   * rule — an element that draws nothing, as `UNKNOWN_TAG`, unless it says
   * more.
   */
  refused?: { kind: RefusedKind; withAttribute?: string };
}

/** An inline tag: one that never ends a row by itself. */
export interface InlineRule extends CommonRule {
  kind: "inline";
}

/**
 * A **block** — ADR-0015's block layer, which it approximates: its start
 * and its end each end the row before them, as the browser ends its line at
 * the edge of a block box.
 */
export interface BlockRule extends CommonRule {
  kind: "block";
  /**
   * The names of an open element its start tag first closes, as the HTML
   * parser does — a heading closes a heading only when that is the element
   * just opened (`"current"`).
   */
  closesOpen?: { names: readonly string[]; reach: "current" | "item" };
  /** For a block whose end tag closes others of its kind: the names it closes — any heading's, any heading. */
  endsAny?: readonly string[];
  /**
   * Whether an `li`, `dt` or `dd` start tag looking for the open item it
   * closes looks past it, as the HTML parser looks past `address`, `div`
   * and `p` and stops at any other block.
   */
  itemLooksPast: boolean;
  /**
   * Whether its end tag with nothing of its name open still ends the row,
   * as the HTML parser reads a stray `</p>` as an empty paragraph
   * (measured: `a</p>b` is `<p>a</p><p></p>b`).
   */
  strayEndIsEmpty: boolean;
  /**
   * Whether every space inside it is drawn, as `white-space: pre` draws
   * them (`pre`). SVG text collapses a run of spaces and drops them at the
   * ends of a line, as HTML does elsewhere, so each is kept as a no-break
   * space, which it does not; a tab too, one space wide.
   */
  preservesSpaces: boolean;
  /**
   * Whether it is a list item, whose first row begins with its marker
   * (`li`), and whose end tag closes nothing past a list opened inside it.
   */
  listItem: boolean;
  /**
   * For a list: what marks the items in it — a bullet by how many lists the
   * list is nested in (`BULLETS`), or the item's number, counted from the list's
   * `start` (1 when it has none) and from an item's own `value`. An item
   * outside every list is bulleted. `null` for any other block.
   */
  list: "bulleted" | "numbered" | null;
}

/**
 * ADR-0015's refused kinds of HTML: tables, ruby, images, embedded content,
 * form controls, media and interactive content.
 */
export type RefusedKind = "table" | "ruby" | "image" | "embedded" | "form" | "media" | "interactive";

/**
 * One start tag's attributes, by lower-case name; an attribute written with
 * no value is `""`. The first of two with one name is the one kept, as the
 * HTML parser keeps it.
 */
export type Attributes = ReadonlyMap<string, string>;

/**
 * One attribute in a start tag: a name, then optionally `=` and a value in
 * double quotes, single quotes, or none.
 */
const ATTRIBUTE_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * The attributes of `tag`, one whole start tag as `nextTag` read it, each
 * value with its entity codes and character references resolved — Mermaid
 * rewrites a code in an attribute as it does one in text, and the browser
 * resolves both (measured: `<a href='?a=1#amp;b=2#35;f'>` keeps
 * `?a=1&b=2#f`).
 */
export function attributesOf(tag: string, name: string): Attributes {
  const attributes = new Map<string, string>();
  const rest = tag.slice(1 + name.length, tag.endsWith("/>") ? -2 : -1);
  for (const match of rest.matchAll(ATTRIBUTE_RE)) {
    const key = match[1]!.toLowerCase();
    if (!attributes.has(key)) {
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attributes.set(key, htmlText(value, "attribute"));
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

/**
 * An inline tag, with what `extra` sets: unless it says otherwise, an
 * ordinary (not formatting) element that sets nothing.
 */
function inline(extra: Partial<Omit<InlineRule, "kind">> = {}): InlineRule {
  return { kind: "inline", formatting: false, opens: "element", walled: false, ...extra };
}

/** A formatting element that sets `style`. */
function formatting(style: RunStyle): TagRule {
  return inline({ style, formatting: true });
}

/** An ordinary (not formatting) element that sets `style`. */
function ordinary(style: RunStyle): TagRule {
  return inline({ style });
}

/**
 * A block, as `BlockRule` describes one, with what `extra` sets: unless it
 * says otherwise, an ordinary element that is no list and no list item.
 */
function block(extra: Partial<Omit<BlockRule, "kind">> = {}): BlockRule {
  return {
    kind: "block",
    formatting: false,
    opens: "element",
    walled: false,
    itemLooksPast: false,
    strayEndIsEmpty: false,
    preservesSpaces: false,
    listItem: false,
    list: null,
    ...extra,
  };
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
  q: inline({ marks: { open: "\u201c", close: "\u201d" } }),
  font: inline({
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
  }),
  span: inline({ attributes: spanStyle }),
  // A formatting element in the HTML parser's own list, so a misnested end
  // tag reopens it like `b`. Every attribute but `href` is ignored — the
  // sanitizer drops `on*` ones, and none of the rest draws anything.
  a: inline({ formatting: true, attributes: (attributes) => link(attributes.get("href")), opens: "unnested element" }),
  // ADR-0015's tags with no rendering of their own: DOMPurify keeps each,
  // and the browser draws its text and nothing else. `nobr` is in the HTML
  // parser's formatting list, `wbr` is void.
  ...Object.fromEntries(
    [
      "abbr", "acronym", "bdi", "bdo", "data", "time", "label", "output", "blink", "spacer",
      "content", "decorator", "element", "shadow", "slot", "menuitem", "map", "picture",
    ].map((name): [string, TagRule] => [name, inline()]),
  ),
  nobr: inline({ formatting: true }),
  wbr: inline({ opens: "nothing" }),
  // Outside DOMPurify's allow-list and removed with their content, which
  // the parser reads as raw text: `a<script>b<b>c</b></script >d` is `ad`,
  // `a<script>b` is `a`, and `style` is the same (measured). `noframes`
  // measured the same, though ADR-0015 does not list it.
  ...Object.fromEntries(
    ["script", "style", "iframe", "noembed", "xmp", "noframes"].map((name): [string, TagRule] => [
      name,
      inline({ removesContent: "raw text" }),
    ]),
  ),
  // Outside the HTML allow-list, but DOMPurify's SVG profile keeps it, and
  // the parser reads its content as text up to `</title>`:
  // `c<title>ti<b>x</b></title>d` is `c<title>ti&lt;b&gt;x&lt;/b&gt;</title>d`
  // (measured). The browser hides it, so its content goes with it.
  title: inline({ removesContent: "raw text" }),
  // Nothing ends its content, not even `</plaintext>`: `<b>a</b>b<plaintext>x</plaintext>y<br><b>z</b>`
  // is `<b>a</b>b` (measured).
  plaintext: inline({ removesContent: "rest" }),
  // DOMPurify parses with scripting off, so its content is elements:
  // `a<noscript>b<noscript>c</noscript>d</noscript>e` is `ae`, and
  // `a<noscript>b<b>c</noscript>d</b>e` is `a<b>d</b>e` (measured).
  noscript: inline({ removesContent: "elements" }),
  // DOMPurify keeps these, and the parser reads their content as elements,
  // but the browser draws none of it (ADR-0015): `datalist` and `rp` are
  // `display: none`, and close at a formatting end tag around them —
  // `<b>a<datalist>c</b>d</datalist>e` is `<b>a<datalist>c</datalist></b>de`
  // (measured).
  datalist: inline({ removesContent: "elements" }),
  rp: inline({ removesContent: "elements" }),
  // Inert, and walled as `marquee` is: `<b>a<template>c</b>d</template>e` is
  // `<b>a<template>cd</template>e</b>` (measured).
  template: inline({ removesContent: "elements", walled: true }),
  // Void, so there is nothing in them to remove, and `display: none`:
  // `a<source>b</source>c` is `a<source>bc`, `track` and `area` the same
  // (measured).
  ...Object.fromEntries(
    ["source", "track", "area"].map((name): [string, TagRule] => [name, inline({ opens: "nothing" })]),
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
  hr: block({ opens: "nothing" }),
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
  html: inline({ opens: "nothing" }),
  head: inline({ opens: "nothing" }),
  body: inline({ opens: "nothing" }),
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
      inline({ opens: "nothing" }),
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
  return Object.fromEntries(names.map((name): [string, TagRule] => [name, inline({ refused: { kind } })]));
}

/**
 * What a tag outside `HTML_TAGS` is in the `html` dialect: an element that
 * draws nothing. DOMPurify drops a tag it does not allow and keeps its text
 * (measured: `e<foo>f</foo>g<my-el>h</my-el>i<object>j</object>k` is
 * `efghijk`), but only after the browser's parser has built the element, so
 * its end tag still closes what was opened inside it: `<foo>a<sub>b</foo>c</sub>d`
 * is `a<sub>b</sub>cd` (measured).
 */
const UNKNOWN_TAG: TagRule = inline();

/**
 * What the tag `name` (lower-case) does in the `html` dialect: its entry in
 * the vocabulary, or, for a name outside it, `UNKNOWN_TAG`.
 */
export function htmlRule(name: string): TagRule {
  return Object.hasOwn(HTML_TAGS, name) ? HTML_TAGS[name]! : UNKNOWN_TAG;
}

/**
 * Whether `name` (lower-case) is in the vocabulary — a tag DOMPurify keeps,
 * so that it reaches Mermaid's Markdown reader, where a tag outside it is
 * already gone.
 */
export function inVocabulary(name: string): boolean {
  return Object.hasOwn(HTML_TAGS, name);
}
