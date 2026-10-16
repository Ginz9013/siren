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

/**
 * The largest side Siren draws an image at, in natural pixels. A header may
 * say anything up to 4294967295, and Chrome reports what a valid image says
 * (measured: a 1000000 x 1 PNG is 1000000 wide; an SVG is clamped near
 * 33554428), so a node could be laid out millions of pixels wide. Refused
 * past a bound no diagram's image needs, rather than drawn at that size.
 */
const MAX_SIDE = 16384;

/** How much of a refused URL a message quotes. */
const QUOTED_LENGTH = 40;

/** The image types Siren draws: the name each is called in a message, and how its header says its size. */
const FORMATS: ReadonlyMap<string, { name: string; size: (bytes: Uint8Array) => ImageSize | "empty" | null }> = new Map([
  [
    "image/png",
    {
      name: "PNG",
      size: (b) =>
        startsWith(b, 0, "\x89PNG\r\n\x1a\n") && startsWith(b, 12, "IHDR") && b.length >= 24 ? sized(be32(b, 16), be32(b, 20)) : null,
    },
  ],
  [
    "image/gif",
    {
      name: "GIF",
      size: (b) => ((startsWith(b, 0, "GIF87a") || startsWith(b, 0, "GIF89a")) && b.length >= 10 ? sized(le16(b, 6), le16(b, 8)) : null),
    },
  ],
  ["image/jpeg", { name: "JPEG", size: readJpegSize }],
  ["image/webp", { name: "WebP", size: readWebpSize }],
  ["image/svg+xml", { name: "SVG", size: readSvgSize }],
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
  // `;base64` counts only as the last parameter, as the fetch standard
  // reads a data URL: under `;base64;charset=…` the data is text.
  const base64 = match[2]!.split(";").at(-1)!.trim().toLowerCase() === "base64";
  // ASCII whitespace in base64 data is no data: the browser strips it
  // (the fetch standard's forgiving-base64 decode), and so does this.
  const data = base64 ? match[3]!.replace(/[\t\n\f\r ]+/g, "") : match[3]!;
  if (base64 ? !BASE64.test(data) || data.length % 4 === 1 : false) {
    return { problem: MALFORMED };
  }
  // The decoded size, before anything is decoded: base64 is three bytes in
  // four characters, and text is counted byte by byte without building it.
  const length = base64 ? Math.floor((data.length * 3) / 4) : percentDecodedLength(data);
  if (length > MAX_BYTES) {
    return { problem: "The image is larger than 4 MB, which Siren does not draw. Use a smaller image" };
  }
  const bytes = base64 ? decodeBase64(data) : decodePercent(data, length);
  if (bytes === null) {
    return { problem: MALFORMED };
  }
  const size = format.size(bytes);
  if (size === "empty") {
    return {
      problem:
        'The SVG image is 0 pixels wide or tall, so nothing of it would be drawn. Give its "width" and "height" a size above 0',
    };
  }
  if (size === null) {
    return {
      problem: `The image's data is not ${format.name === "SVG" ? "an" : "a"} ${format.name} image, so its size cannot be read. Check the data, or the type its data URL names`,
    };
  }
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
    return {
      problem: `The image is ${size.width} x ${size.height} pixels, more than the ${MAX_SIDE} a side Siren draws. Use a smaller image`,
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

/**
 * How a data URL's data written without `;base64` decodes, one character
 * at a time from `i`: a `%XX` is one byte; a `%` not followed by two hex
 * digits is itself, as the fetch standard's percent-decoding leaves it; any
 * other character is its UTF-8 bytes — a surrogate pair four, a lone
 * surrogate the three of U+FFFD, as `TextEncoder` writes them. Returns how
 * many characters it read and how many bytes they are.
 */
function percentStep(data: string, i: number): { read: number; bytes: number } {
  const code = data.charCodeAt(i);
  if (code === 0x25 && /^[0-9a-f]{2}$/i.test(data.slice(i + 1, i + 3))) {
    return { read: 3, bytes: 1 };
  }
  if (code < 0x80) {
    return { read: 1, bytes: 1 };
  }
  if (code < 0x800) {
    return { read: 1, bytes: 2 };
  }
  const next = data.charCodeAt(i + 1);
  if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return { read: 2, bytes: 4 };
  }
  return { read: 1, bytes: 3 };
}

/** How many bytes `data` decodes to (`percentStep`), counted without decoding it. */
function percentDecodedLength(data: string): number {
  let length = 0;
  for (let i = 0; i < data.length; ) {
    const step = percentStep(data, i);
    length += step.bytes;
    i += step.read;
  }
  return length;
}

/** `data`, written without `;base64`, decoded into its `length` bytes (`percentStep`). */
function decodePercent(data: string, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i < data.length; ) {
    const step = percentStep(data, i);
    const code = data.charCodeAt(i);
    if (step.read === 3) {
      bytes[at++] = parseInt(data.slice(i + 1, i + 3), 16);
    } else if (step.bytes === 1) {
      bytes[at++] = code;
    } else if (step.bytes === 2) {
      bytes[at++] = 0xc0 | (code >> 6);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else if (step.bytes === 4) {
      const point = 0x10000 + ((code - 0xd800) << 10) + (data.charCodeAt(i + 1) - 0xdc00);
      bytes[at++] = 0xf0 | (point >> 18);
      bytes[at++] = 0x80 | ((point >> 12) & 0x3f);
      bytes[at++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[at++] = 0x80 | (point & 0x3f);
    } else {
      // A lone surrogate is written as U+FFFD.
      const point = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
      bytes[at++] = 0xe0 | (point >> 12);
      bytes[at++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[at++] = 0x80 | (point & 0x3f);
    }
    i += step.read;
  }
  return bytes;
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
  // An approximation: Chrome sizes `ex` from its default font's x-height,
  // which it measured as between 8 and 8.5 (`2ex` is 17, `1ex` 8).
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
 * 300 x 150 itself. A length that is no length is not given; a negative
 * one is 0, and an SVG 0 across either way is `"empty"`: Chrome draws
 * nothing of it.
 *
 * Read off the root element's start tag as text: the size is all that is
 * wanted here, and the SVG is never parsed into the page — it is drawn as
 * an image, where it runs no script and loads nothing.
 */
function readSvgSize(b: Uint8Array): ImageSize | "empty" | null {
  const attributes = svgRootAttributes(new TextDecoder().decode(b));
  if (attributes === null) {
    return null;
  }
  const givenWidth = svgLength(attributes.get("width"));
  const givenHeight = svgLength(attributes.get("height"));
  const ratio = viewBoxRatio(attributes.get("viewBox"));
  let size: ImageSize;
  if (givenWidth !== null && givenHeight !== null) {
    size = { width: givenWidth, height: givenHeight };
  } else if (givenWidth !== null) {
    size = { width: givenWidth, height: ratio === null ? DEFAULT_OBJECT.height : givenWidth / ratio };
  } else if (givenHeight !== null) {
    size = { width: ratio === null ? DEFAULT_OBJECT.width : givenHeight * ratio, height: givenHeight };
  } else if (ratio === null) {
    size = DEFAULT_OBJECT;
  } else if (ratio > DEFAULT_OBJECT.width / DEFAULT_OBJECT.height) {
    size = { width: DEFAULT_OBJECT.width, height: DEFAULT_OBJECT.width / ratio };
  } else {
    size = { width: DEFAULT_OBJECT.height * ratio, height: DEFAULT_OBJECT.height };
  }
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  return width > 0 && height > 0 ? { width, height } : "empty";
}

/**
 * The attributes of the document's root `<svg>` start tag, past a byte
 * order mark, an XML declaration, processing instructions, comments and a
 * doctype — or `null` when the document's first element is no `<svg>`.
 *
 * Every pattern here matches in time linear in the text: no two of an
 * alternation's branches, and no two adjacent repeats, can match the same
 * character, so a document written to make one backtrack cannot.
 */
function svgRootAttributes(text: string): Map<string, string> | null {
  let rest = text.replace(/^﻿/, "");
  for (;;) {
    rest = rest.trimStart();
    const skipped =
      /^<\?[\s\S]*?\?>/.exec(rest) ?? /^<!--[\s\S]*?-->/.exec(rest) ?? /^<!DOCTYPE(?:[^[\]>]|\[[^\]]*\])*>/i.exec(rest);
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
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value ?? "");
  const unit = match === null ? undefined : SVG_UNITS[match[2]!.toLowerCase()];
  // A negative length is 0, as Chrome sizes it.
  return match === null || unit === undefined ? null : Math.max(0, Number(match[1]) * unit);
}

/** A `viewBox`'s width over its height, or `null` when it gives none. */
function viewBoxRatio(value: string | undefined): number | null {
  const numbers = (value ?? "").trim().split(/[\s,]+/).map(Number);
  const [, , width, height] = numbers;
  return numbers.length === 4 && width! > 0 && height! > 0 ? width! / height! : null;
}
