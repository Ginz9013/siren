/**
 * What a flowchart node's `img:` may be, and how big the image it names is.
 *
 * Siren never fetches anything while drawing, so an image is drawn only from
 * data the document itself holds: a `data:` URL of one of the types below.
 * Its natural size — what Mermaid 12.2.0's `imageSquare` sizes the node from,
 * read there off a decoded `<img>` — is read here off the data's own header,
 * as the browser decodes it, so that layout needs no image to load.
 */

/** An image's natural size, in pixels. */
export interface ImageSize {
  width: number;
  height: number;
}

/** The largest image Siren draws, decoded: 4 MB. */
const MAX_BYTES = 4 * 1024 * 1024;

/** How much of a refused URL a message quotes. */
const QUOTED_LENGTH = 40;

/** The image types Siren draws, and the name each is called in a message. */
const FORMATS: ReadonlyMap<string, string> = new Map([
  ["image/png", "PNG"],
  ["image/gif", "GIF"],
  ["image/jpeg", "JPEG"],
  ["image/webp", "WebP"],
  ["image/svg+xml", "SVG"],
]);

/** A data URL: its type, its parameters (`;base64` among them) and its data. */
const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const MALFORMED = 'The image\'s data URL is not well-formed. Write it as "data:image/png;base64," followed by the data';

/**
 * The natural size of the image `url` holds, or why it cannot be drawn,
 * worded for the author.
 */
export function readImageData(url: string): { image: ImageSize } | { problem: string } {
  if (!/^data:/i.test(url)) {
    const quoted = url.length > QUOTED_LENGTH ? `${url.slice(0, QUOTED_LENGTH)}…` : url;
    return {
      problem:
        `Siren never fetches an image while drawing, so "${quoted}" cannot be drawn. ` +
        'Embed the image as a data URL, such as img: "data:image/png;base64,…"',
    };
  }
  const match = DATA_URL.exec(url);
  const mime = (match === null ? (/^data:([^;,]*)/i.exec(url)?.[1] ?? "") : match[1]!).trim().toLowerCase();
  const format = FORMATS.get(mime);
  if (format === undefined) {
    return {
      problem: `The image is "${mime}", which Siren does not draw. Use a PNG, GIF, JPEG, WebP or SVG data URL`,
    };
  }
  if (match === null) {
    return { problem: MALFORMED };
  }
  const base64 = match[2]!.toLowerCase().split(";").includes("base64");
  const data = match[3]!;
  if (base64 ? !BASE64.test(data) || data.length % 4 === 1 : false) {
    return { problem: MALFORMED };
  }
  if ((base64 ? Math.floor((data.length * 3) / 4) : data.length) > MAX_BYTES) {
    return { problem: "The image is larger than 4 MB, which Siren does not draw. Use a smaller image" };
  }
  const bytes = base64 ? decodeBase64(data) : decodePercent(data);
  if (bytes === null) {
    return { problem: MALFORMED };
  }
  const size = SIZE_READERS[mime]!(bytes);
  if (size === null) {
    return {
      problem: `The image's data is not ${format === "SVG" ? "an" : "a"} ${format} image, so its size cannot be read. Check the data, or the type its data URL names`,
    };
  }
  return { image: size };
}

function decodeBase64(data: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A data URL's data written without `;base64`: each `%XX` one byte, every other character its own code. */
function decodePercent(data: string): Uint8Array | null {
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === "%") {
      const hex = data.slice(i + 1, i + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) {
        return null;
      }
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      const code = data.charCodeAt(i);
      // A character past one byte is UTF-8 text, written as its bytes.
      bytes.push(...(code < 0x80 ? [code] : new TextEncoder().encode(data[i])));
    }
  }
  return Uint8Array.from(bytes);
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const le32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const startsWith = (b: Uint8Array, at: number, text: string) =>
  b.length >= at + text.length && Array.from(text).every((char, i) => b[at + i] === char.charCodeAt(0));

/** A size, or `null` when either side is not a positive number. */
const sized = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;

/** How each type's header says its size. */
const SIZE_READERS: Readonly<Record<string, (bytes: Uint8Array) => ImageSize | null>> = {
  "image/png": (b) =>
    startsWith(b, 0, "\x89PNG\r\n\x1a\n") && startsWith(b, 12, "IHDR") && b.length >= 24 ? sized(be32(b, 16), be32(b, 20)) : null,
  "image/gif": (b) => ((startsWith(b, 0, "GIF87a") || startsWith(b, 0, "GIF89a")) && b.length >= 10 ? sized(le16(b, 6), le16(b, 8)) : null),
  "image/jpeg": readJpegSize,
  "image/webp": readWebpSize,
  "image/svg+xml": readSvgSize,
};

/**
 * A JPEG's size, from its first frame header (SOF0–SOF15, past DHT, JPG and
 * DAC, which share the range), turned a quarter turn when its Exif
 * orientation says so (5–8): browsers draw a JPEG as its orientation says
 * (`image-orientation: from-image`), and report that size.
 */
function readJpegSize(b: Uint8Array): ImageSize | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) {
    return null;
  }
  let orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      return null;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = be16(b, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) {
        return null;
      }
      const height = be16(b, i + 5);
      const width = be16(b, i + 7);
      return orientation >= 5 && orientation <= 8 ? sized(height, width) : sized(width, height);
    }
    if (marker === 0xe1 && startsWith(b, i + 4, "Exif\0\0")) {
      orientation = exifOrientation(b, i + 10, i + 2 + length) ?? orientation;
    }
    i += 2 + length;
  }
  return null;
}

/** The orientation an Exif block's first IFD names, or `null`. */
function exifOrientation(b: Uint8Array, tiff: number, end: number): number | null {
  const little = startsWith(b, tiff, "II");
  if (!little && !startsWith(b, tiff, "MM")) {
    return null;
  }
  const u16 = (at: number) => (little ? le16(b, at) : be16(b, at));
  const u32 = (at: number) => (little ? le32(b, at) : be32(b, at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) {
    return null;
  }
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) {
      return null;
    }
    if (u16(entry) === 0x0112) {
      return u16(entry + 8);
    }
  }
  return null;
}

/** A WebP's size, from its first chunk: the extended (VP8X), lossless (VP8L) or lossy (VP8) header. */
function readWebpSize(b: Uint8Array): ImageSize | null {
  if (!startsWith(b, 0, "RIFF") || !startsWith(b, 8, "WEBP")) {
    return null;
  }
  if (startsWith(b, 12, "VP8X") && b.length >= 30) {
    return sized(1 + le24(b, 24), 1 + le24(b, 27));
  }
  if (startsWith(b, 12, "VP8L") && b.length >= 25 && b[20] === 0x2f) {
    const bits = le32(b, 21);
    return sized(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
  }
  if (startsWith(b, 12, "VP8 ") && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return sized(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff);
  }
  return null;
}

/** Pixels per unit of each absolute length an SVG's `width` and `height` may be written in (`em` at 16px). */
const SVG_UNITS: Readonly<Record<string, number>> = {
  "": 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: 16,
  ex: 8,
};

/** The box a replaced element with no size of its own is drawn in (CSS's default object size). */
const DEFAULT_OBJECT = { width: 300, height: 150 };

/**
 * An SVG's natural size as Chrome reports it for an `<img>` of the same
 * data (measured): `width` and `height` in absolute units, rounded to whole
 * pixels; a side not given — or given as a percentage — taken from the
 * other through the `viewBox`'s proportions, else from the default object
 * size; with neither side, the `viewBox` fitted into 300 x 150, or
 * 300 x 150 itself.
 *
 * Read off the root element's start tag as text: the size is all that is
 * wanted here, and the SVG is never parsed into the page — it is drawn as
 * an image, where it runs no script and loads nothing.
 */
function readSvgSize(b: Uint8Array): ImageSize | null {
  const attributes = svgRootAttributes(new TextDecoder().decode(b));
  if (attributes === null) {
    return null;
  }
  const width = svgLength(attributes.get("width"));
  const height = svgLength(attributes.get("height"));
  const ratio = viewBoxRatio(attributes.get("viewBox"));
  let size: ImageSize;
  if (width !== null && height !== null) {
    size = { width, height };
  } else if (width !== null) {
    size = { width, height: ratio === null ? DEFAULT_OBJECT.height : width / ratio };
  } else if (height !== null) {
    size = { width: ratio === null ? DEFAULT_OBJECT.width : height * ratio, height };
  } else if (ratio === null) {
    size = DEFAULT_OBJECT;
  } else if (ratio > DEFAULT_OBJECT.width / DEFAULT_OBJECT.height) {
    size = { width: DEFAULT_OBJECT.width, height: DEFAULT_OBJECT.width / ratio };
  } else {
    size = { width: DEFAULT_OBJECT.height * ratio, height: DEFAULT_OBJECT.height };
  }
  return sized(Math.round(size.width), Math.round(size.height));
}

/**
 * The attributes of the document's root `<svg>` start tag, past a byte
 * order mark, an XML declaration, processing instructions, comments and a
 * doctype — or `null` when the document's first element is no `<svg>`.
 */
function svgRootAttributes(text: string): Map<string, string> | null {
  let rest = text.replace(/^﻿/, "");
  for (;;) {
    rest = rest.trimStart();
    const skipped =
      /^<\?[\s\S]*?\?>/.exec(rest) ?? /^<!--[\s\S]*?-->/.exec(rest) ?? /^<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/i.exec(rest);
    if (skipped === null) {
      break;
    }
    rest = rest.slice(skipped[0].length);
  }
  const open = /^<(?:[A-Za-z_][\w.-]*:)?svg(?=[\s/>])/.exec(rest);
  if (open === null) {
    return null;
  }
  const attributes = new Map<string, string>();
  const attribute = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  attribute.lastIndex = open[0].length;
  for (let found = attribute.exec(rest); found !== null; found = attribute.exec(rest)) {
    attributes.set(found[1]!, found[2] ?? found[3]!);
  }
  return attributes;
}

/** An SVG length in pixels, or `null` when it is absent, relative (`%`) or not a length. */
function svgLength(value: string | undefined): number | null {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value ?? "");
  const unit = match === null ? undefined : SVG_UNITS[match[2]!.toLowerCase()];
  return match === null || unit === undefined ? null : Number(match[1]) * unit;
}

/** A `viewBox`'s width over its height, or `null` when it gives none. */
function viewBoxRatio(value: string | undefined): number | null {
  const numbers = (value ?? "").trim().split(/[\s,]+/).map(Number);
  const [, , width, height] = numbers;
  return numbers.length === 4 && width! > 0 && height! > 0 ? width! / height! : null;
}
