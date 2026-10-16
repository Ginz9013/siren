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

/** Iconify's size for an icon whose pack gives none. */
const ICONIFY_DEFAULT_SIZE = 16;

const SVG_NS = "http://www.w3.org/2000/svg";

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
    if (icon.rotate || icon.hFlip || icon.vFlip) {
      return { problem: `The icon "${name}" is rotated or flipped, which Siren does not draw. Use an icon that is not` };
    }
    const elements = readBody(icon.body, idPrefix);
    if (elements === null) {
      return { problem: `The icon "${name}" is not valid SVG, so it cannot be drawn. Use another icon` };
    }
    return {
      glyph: {
        viewBox: {
          left: icon.left ?? pack.left ?? 0,
          top: icon.top ?? pack.top ?? 0,
          width: icon.width ?? pack.width ?? ICONIFY_DEFAULT_SIZE,
          height: icon.height ?? pack.height ?? ICONIFY_DEFAULT_SIZE,
        },
        elements,
      },
    };
  }
  return {
    problem: `The icon pack "${prefix}" has no icon "${iconName}". Use an icon the pack holds, or register a pack that holds it`,
  };
}

/**
 * The icon `name` in `pack`, an alias followed to its parent with its own
 * fields laid over the parent's — or `null` when the pack holds no such
 * icon. An alias chain that loops ends as no icon.
 */
function iconIn(pack: IconifyJSON, name: string): IconifyIcon | null {
  const seen = new Set<string>();
  let overrides: Partial<IconifyIcon> = {};
  for (let current = name; !seen.has(current); ) {
    seen.add(current);
    const icon = Object.hasOwn(pack.icons, current) ? pack.icons[current] : undefined;
    if (icon !== undefined) {
      return { ...icon, ...overrides };
    }
    const alias = pack.aliases !== undefined && Object.hasOwn(pack.aliases, current) ? pack.aliases[current] : undefined;
    if (alias === undefined) {
      return null;
    }
    const { parent, ...own } = alias;
    overrides = { ...own, ...overrides };
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

/** The attributes that say where and how big: kept as written when their value passes `safeValue`. */
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
 * An icon's body as figure data, read through the allowlists above — or
 * `null` when it is not well-formed SVG.
 *
 * The body is parsed as an XML document of its own, which runs nothing and
 * fetches nothing, and only the data read off it leaves this function: the
 * renderer draws it with `createElementNS` and `setAttribute`, so no markup
 * an icon holds is ever handed to a parser in the page.
 */
function readBody(body: string, idPrefix: string): FigureElement[] | null {
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${body}</svg>`, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || root.getElementsByTagName("parsererror").length > 0) {
    return null;
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

  /** `value` as it may be drawn, references renamed — or `null` when it may not. */
  const safeValue = (value: string): string | null => {
    if (/url\s*\(/i.test(value)) {
      const local = LOCAL_REFERENCE.exec(value.trim());
      return local !== null && ids.has(local[1]!) ? `url(#${idPrefix}${local[1]})` : null;
    }
    return unsafeStyleValue(value) === null ? value : null;
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
      if (attribute.namespaceURI !== null) {
        return [];
      }
      const { name, value } = attribute;
      const drawn =
        name === "id"
          ? `${idPrefix}${value}`
          : name === "style"
            ? safeStyle(value)
            : GEOMETRY_ATTRIBUTES.has(name) || PAINT_PROPERTIES.has(name)
              ? safeValue(value)
              : null;
      return drawn === null ? [] : [[name, drawn] as const];
    }),
    children: Array.from(element.children).filter(kept).map(read),
  });
  return Array.from(root.children).filter(kept).map(read);
}
