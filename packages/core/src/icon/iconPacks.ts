import type { FigureElement, FigureElementName } from "../layout/shapes/shape";
import { unsafeStyleValue } from "../unsafeStyleValue";

/**
 * The icon packs a caller registers through `render()`'s `iconPacks`
 * option, and the one question asked of them: what does the icon a node
 * names (`A@{ icon: "prefix:name" }`) draw?
 *
 * A pack is Iconify JSON handed over as data. Nothing here loads or fetches
 * anything: an icon no registered pack holds is refused, never looked for.
 */

/** One icon of an Iconify JSON pack. */
export interface IconifyIcon {
  /** The icon's SVG content, without the `<svg>` around it. */
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

/**
 * An Iconify JSON icon pack: its `prefix` is the part of an icon's name
 * before the `:`, and an icon or alias that gives no size of its own takes
 * the pack's (16 by 16 when the pack gives none either).
 */
export interface IconifyJSON {
  prefix: string;
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, Partial<IconifyIcon> & { parent: string }>;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
}

/** An icon, ready to draw: the box its content is drawn in, and the content. */
export interface IconGlyph {
  viewBox: { left: number; top: number; width: number; height: number };
  elements: readonly FigureElement[];
}

/**
 * How deep an icon's elements may nest. Reading them is recursive, so a
 * body thousands of `<g>`s deep would run out of stack; no icon needs more
 * than a handful of levels, so a body past this is refused instead.
 */
const MAX_BODY_DEPTH = 256;

/** Iconify's size for an icon whose pack gives none. */
const ICONIFY_DEFAULT_SIZE = 16;

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** The elements that may take their stops from another by `href`. */
const GRADIENTS: ReadonlySet<string> = new Set(["linearGradient", "radialGradient"]);

/**
 * The icon `name` (`prefix:name`) names in `packs`, ready to draw — or why
 * it cannot be drawn, worded for the author. `idPrefix` is put before every
 * id the icon's content declares, so that two icons drawn on one page never
 * answer each other's references.
 *
 * Packs are searched in order, and the first holding the icon wins, so two
 * packs sharing a prefix add to each other.
 */
export function resolveIcon(
  name: string,
  packs: readonly IconifyJSON[],
  idPrefix: string,
): { glyph: IconGlyph } | { problem: string } {
  // The packs are the caller's data, read at run time whatever their type
  // says: one not of Iconify JSON's shape is refused here rather than
  // thrown on below.
  if (!Array.isArray(packs)) {
    return {
      problem:
        `The "iconPacks" render option is not a list of Iconify icon packs, so the icon "${name}" cannot be drawn. ` +
        "Pass an array of packs",
    };
  }
  if (!packs.every(isPackShaped)) {
    return {
      problem:
        'The "iconPacks" render option holds something that is not an Iconify icon pack — an object with a string ' +
        `"prefix" and its "icons" — so the icon "${name}" cannot be drawn. Pass each pack's Iconify JSON as it is`,
    };
  }
  const colon = name.indexOf(":");
  const prefix = name.slice(0, colon);
  const iconName = name.slice(colon + 1);
  const named = packs.filter((pack) => pack.prefix === prefix);
  if (named.length === 0) {
    return {
      problem:
        `No icon pack "${prefix}" is registered, so the icon "${name}" cannot be drawn. ` +
        'Pass the pack\'s Iconify JSON in the "iconPacks" render option',
    };
  }
  for (const pack of named) {
    const icon = iconIn(pack, iconName);
    if (icon === null) {
      continue;
    }
    if (typeof icon.body !== "string") {
      return { problem: `The icon "${name}" has no SVG "body" text, so it cannot be drawn. Use another icon` };
    }
    const viewBox = {
      left: icon.left ?? pack.left ?? 0,
      top: icon.top ?? pack.top ?? 0,
      width: icon.width ?? pack.width ?? ICONIFY_DEFAULT_SIZE,
      height: icon.height ?? pack.height ?? ICONIFY_DEFAULT_SIZE,
    };
    if (!isDrawableBox(viewBox)) {
      return {
        problem:
          `The icon "${name}" has a box that is not a positive width and height at a numeric left and top, ` +
          "so it cannot be drawn. Use another icon",
      };
    }
    if (icon.rotate || icon.hFlip || icon.vFlip) {
      return { problem: `The icon "${name}" is rotated or flipped, which Siren does not draw. Use an icon that is not` };
    }
    const elements = readBody(icon.body, idPrefix);
    if (elements === "invalid") {
      return { problem: `The icon "${name}" is not valid SVG, so it cannot be drawn. Use another icon` };
    }
    if (elements === "too deep") {
      return {
        problem: `The icon "${name}" nests its elements more than ${MAX_BODY_DEPTH} deep, so it cannot be drawn. Use another icon`,
      };
    }
    return { glyph: { viewBox, elements } };
  }
  return {
    problem: `The icon pack "${prefix}" has no icon "${iconName}". Use an icon the pack holds, or register a pack that holds it`,
  };
}

/** Whether `value` is an object, and not an array: what a pack's `icons` and `aliases` are. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `pack` is Iconify JSON's shape as far as looking an icon up reads it. */
function isPackShaped(pack: unknown): pack is IconifyJSON {
  return (
    isRecord(pack) &&
    typeof pack.prefix === "string" &&
    isRecord(pack.icons) &&
    (pack.aliases === undefined || isRecord(pack.aliases))
  );
}

/** Whether a box can be drawn: a finite left and top, and a finite, positive width and height. */
function isDrawableBox(box: { left: unknown; top: unknown; width: unknown; height: unknown }): boolean {
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  return finite(box.left) && finite(box.top) && finite(box.width) && finite(box.height) && box.width > 0 && box.height > 0;
}

/**
 * `child`'s fields laid over `parent`'s, as Iconify merges an alias with its
 * parent: a field the child gives wins, except that a flip undoes the
 * parent's flip (`hFlip`, `vFlip` combine by exclusive or) and a rotation
 * adds to the parent's, in quarter turns modulo four.
 */
function layOver(parent: Partial<IconifyIcon>, child: Partial<IconifyIcon>): Partial<IconifyIcon> {
  return {
    ...parent,
    ...child,
    hFlip: Boolean(parent.hFlip) !== Boolean(child.hFlip),
    vFlip: Boolean(parent.vFlip) !== Boolean(child.vFlip),
    rotate: quarterTurns(Number(parent.rotate ?? 0) + Number(child.rotate ?? 0)),
  };
}

/**
 * `turns` modulo four — or `1` when it is no whole number, so that a
 * rotation the pack spells wrongly is refused as a rotation rather than
 * drawn as none.
 */
function quarterTurns(turns: number): number {
  return Number.isInteger(turns) ? ((turns % 4) + 4) % 4 : 1;
}

/**
 * The icon `name` in `pack`, an alias followed to its parent with its own
 * fields laid over the parent's (`layOver`) — or `null` when the pack holds
 * no such icon. An alias chain that loops ends as no icon.
 */
function iconIn(pack: IconifyJSON, name: string): IconifyIcon | null {
  const seen = new Set<string>();
  let overrides: Partial<IconifyIcon> = {};
  for (let current = name; !seen.has(current); ) {
    seen.add(current);
    const icon = Object.hasOwn(pack.icons, current) ? pack.icons[current] : undefined;
    if (icon !== undefined) {
      return layOver(isRecord(icon) ? (icon as Partial<IconifyIcon>) : {}, overrides) as IconifyIcon;
    }
    const alias = pack.aliases !== undefined && Object.hasOwn(pack.aliases, current) ? pack.aliases[current] : undefined;
    if (!isRecord(alias) || typeof alias.parent !== "string") {
      return null;
    }
    const { parent, ...own } = alias as Partial<IconifyIcon> & { parent: string };
    overrides = layOver(own, overrides);
    current = parent;
  }
  return null;
}

/**
 * The elements an icon may be drawn with, in the SVG namespace: shapes,
 * groups, and the paint servers, clips and masks they refer to. Anything
 * else — `script`, `foreignObject`, `use`, `image`, `a`, `style`, the
 * animation elements, a nested `svg`, text — is dropped with everything it
 * holds.
 */
const FIGURE_ELEMENTS: ReadonlySet<string> = new Set<FigureElementName>([
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
]);

/** The attributes that say where and how big: kept as written when their value passes `inertGeometry`. */
const GEOMETRY_ATTRIBUTES: ReadonlySet<string> = new Set([
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "width",
  "height",
  "points",
  "pathLength",
  "transform",
  "offset",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
]);

/**
 * The paint properties, as attributes or as declarations of a `style`
 * attribute. A value naming a `url(…)` is kept only when it names an id the
 * icon itself declares.
 */
const PAINT_PROPERTIES: ReadonlySet<string> = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "display",
  "visibility",
]);

/** A reference to an element of the same document, and nothing else: `url(#id)`. */
const LOCAL_REFERENCE = /^url\(\s*#([^)\s]+)\s*\)$/;

/**
 * A paint or reference value that can fetch nothing, other than a local
 * `url(#id)`: one or more `#hex` colours, keywords (`none`, `currentColor`,
 * `red`, `evenodd`, `round`) or numbers with or without a unit (`2`, `.5`,
 * `2px`, `50%`), apart by spaces or commas (`stroke-dasharray: 2, 1 3`).
 *
 * An allowlist, deliberately, and one without a single `(`: a CSS function
 * is how a value fetches — `url(`, and `image-set(`, `-webkit-image-set(`,
 * `cross-fade(`, `element(`, `src(` beside it, each of which made Chrome
 * request an image from an icon's `mask` or `fill` (measured) — and new
 * ones arrive with browsers. A colour written as `rgb(…)` is dropped with
 * them; an icon pack's colours are `#hex` or `currentColor` in practice.
 */
const INERT_PAINT_VALUE =
  /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z-]*|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?:[a-zA-Z]+|%)?)(?:(?:\s*,\s*|\s+)(?:#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z-]*|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?:[a-zA-Z]+|%)?))*$/;

/** The functions a `transform` or `gradientTransform` is written with, none of which fetches. */
const TRANSFORM_FUNCTIONS: ReadonlySet<string> = new Set(["matrix", "translate", "scale", "rotate", "skewx", "skewy"]);

/**
 * Whether a geometry attribute's `value` can fetch nothing: no function at
 * all, or — in a `transform` or `gradientTransform` — only the transform
 * functions. Numbers, units, keywords and path data hold no `(`.
 */
function inertGeometry(name: string, value: string): boolean {
  if (!value.includes("(")) return unsafeStyleValue(value) === null;
  if (name !== "transform" && name !== "gradientTransform") return false;
  const calls = value.match(/[a-zA-Z-]*\s*\(/g) ?? [];
  return (
    calls.every((call) => TRANSFORM_FUNCTIONS.has(call.replace(/[\s(]/g, "").toLowerCase())) &&
    /^[\sa-zA-Z0-9.,eE+\-()]*$/.test(value)
  );
}

/**
 * An icon's body as figure data, read through the allowlists above — or
 * `"invalid"` when it is not well-formed SVG, `"too deep"` when its elements
 * nest past `MAX_BODY_DEPTH`.
 *
 * The body is parsed as an XML document of its own, which runs nothing and
 * fetches nothing, and only the data read off it leaves this function: the
 * renderer draws it with `createElementNS` and `setAttribute`, so no markup
 * an icon holds is ever handed to a parser in the page.
 */
function readBody(body: string, idPrefix: string): FigureElement[] | "invalid" | "too deep" {
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${body}</svg>`, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || root.getElementsByTagName("parsererror").length > 0) {
    return "invalid";
  }
  // Measured without recursion, before anything below recurses.
  const pending: [Element, number][] = [[root, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [element, depth] = next;
    if (depth > MAX_BODY_DEPTH) {
      return "too deep";
    }
    for (const child of Array.from(element.children)) pending.push([child, depth + 1]);
  }
  const kept = (element: Element) => element.namespaceURI === SVG_NS && FIGURE_ELEMENTS.has(element.localName);
  // The ids the drawn elements declare: the only targets a reference may keep.
  const ids = new Set<string>();
  const collect = (element: Element) => {
    if (!kept(element)) {
      return;
    }
    const id = element.getAttributeNS(null, "id");
    if (id) {
      ids.add(id);
    }
    Array.from(element.children).forEach(collect);
  };
  Array.from(root.children).forEach(collect);

  /**
   * A paint or reference `value` as it may be drawn — a local `url(#id)` to
   * an id the icon declares, renamed, or a value `INERT_PAINT_VALUE` passes
   * — or `null` when it may not.
   */
  const safeValue = (value: string): string | null => {
    const trimmed = value.trim();
    const local = LOCAL_REFERENCE.exec(trimmed);
    if (local !== null) {
      return ids.has(local[1]!) ? `url(#${idPrefix}${local[1]})` : null;
    }
    return INERT_PAINT_VALUE.test(trimmed) ? trimmed : null;
  };
  const safeStyle = (style: string): string | null => {
    const declarations = style.split(";").flatMap((declaration) => {
      const colon = declaration.indexOf(":");
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = safeValue(declaration.slice(colon + 1).trim());
      return colon > 0 && PAINT_PROPERTIES.has(property) && value !== null ? [`${property}: ${value}`] : [];
    });
    return declarations.length === 0 ? null : declarations.join("; ");
  };
  const read = (element: Element): FigureElement => ({
    element: element.localName as FigureElementName,
    attributes: Array.from(element.attributes).flatMap((attribute) => {
      // A gradient may take its stops from another the icon declares
      // (`href="#a"`, or the older `xlink:href`): kept as `href`, renamed
      // with the ids. Any other link is dropped with the rest.
      if (
        GRADIENTS.has(element.localName) &&
        attribute.localName === "href" &&
        (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NS)
      ) {
        const target = /^#(\S+)$/.exec(attribute.value.trim());
        return target !== null && ids.has(target[1]!) ? [["href", `#${idPrefix}${target[1]}`] as const] : [];
      }
      if (attribute.namespaceURI !== null) {
        return [];
      }
      const { name, value } = attribute;
      const drawn =
        name === "id"
          ? `${idPrefix}${value}`
          : name === "style"
            ? safeStyle(value)
            : PAINT_PROPERTIES.has(name)
              ? safeValue(value)
              : GEOMETRY_ATTRIBUTES.has(name) && inertGeometry(name, value)
                ? value
                : null;
      return drawn === null ? [] : [[name, drawn] as const];
    }),
    children: Array.from(element.children).filter(kept).map(read),
  });
  return Array.from(root.children).filter(kept).map(read);
}
