import { describe, expect, it } from "vitest";
import { readImageData } from "./imageData";

/**
 * Reading an `img:` value: only a `data:image/…` URL, whose natural size is
 * read off the data's own header, as a browser decodes it. The natural
 * sizes expected below are what Chrome reports for the same bytes
 * (`naturalWidth`/`naturalHeight`, measured for Mermaid 12.2.0's
 * `imageSquare`, which sizes the node from them).
 */

/** `bytes` as a base64 data URL of type `mime`. */
function dataUrl(mime: string, bytes: number[]): string {
  return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
}

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/** A PNG's signature and `IHDR` chunk. */
const png = (width: number, height: number) => [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(width), ...be32(height), 8, 6, 0, 0, 0,
];

/** A JPEG: SOI, a JFIF APP0, optionally an Exif APP1 naming `orientation`, then a baseline SOF0. */
function jpeg(width: number, height: number, orientation?: number): number[] {
  const app0 = [0xff, 0xe0, ...be16(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const exif =
    orientation === undefined
      ? []
      : (() => {
          // "Exif\0\0", a big-endian TIFF header, one IFD entry: 0x0112 SHORT 1 = orientation.
          const tiff = [...ascii("MM"), 0, 42, ...be32(8), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0, ...be32(0)];
          const body = [...ascii("Exif"), 0, 0, ...tiff];
          return [0xff, 0xe1, ...be16(body.length + 2), ...body];
        })();
  const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return [0xff, 0xd8, ...app0, ...exif, ...sof, 0xff, 0xd9];
}

/** A WebP RIFF holding one chunk `fourcc` with `data`. */
const webp = (fourcc: string, data: number[]) => [
  ...ascii("RIFF"), ...le16(data.length + 12), 0, 0, ...ascii("WEBP"), ...ascii(fourcc), ...le16(data.length), 0, 0, ...data,
];

describe("the natural size of a data URL's image", () => {
  it("reads a PNG's from its IHDR chunk", () => {
    expect(readImageData(dataUrl("image/png", png(40, 20)))).toEqual({ image: { width: 40, height: 20 } });
  });

  it("reads a GIF's from its logical screen", () => {
    expect(readImageData(dataUrl("image/gif", [...ascii("GIF89a"), ...le16(40), ...le16(20), 0, 0, 0]))).toEqual({
      image: { width: 40, height: 20 },
    });
  });

  it("reads a JPEG's from its frame header, past the segments before it", () => {
    expect(readImageData(dataUrl("image/jpeg", jpeg(40, 20)))).toEqual({ image: { width: 40, height: 20 } });
  });

  it("turns a JPEG its Exif orientation rotates a quarter turn, as the browser draws it", () => {
    expect(readImageData(dataUrl("image/jpeg", jpeg(40, 20, 6)))).toEqual({ image: { width: 20, height: 40 } });
    expect(readImageData(dataUrl("image/jpeg", jpeg(40, 20, 3)))).toEqual({ image: { width: 40, height: 20 } });
  });

  it("reads a WebP's from its VP8X, VP8L or VP8 chunk", () => {
    const vp8x = webp("VP8X", [0x10, 0, 0, 0, ...le24(39), ...le24(19)]);
    // VP8L: the signature 0x2f, then width-1 and height-1 in 14 bits each.
    const bits = 39 | (19 << 14);
    const vp8l = webp("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
    // VP8: a frame tag, the start code 9d 01 2a, then the width and height.
    const vp8 = webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(40), ...le16(20), 0, 0]);

    for (const bytes of [vp8x, vp8l, vp8]) {
      expect(readImageData(dataUrl("image/webp", bytes))).toEqual({ image: { width: 40, height: 20 } });
    }
  });

  it("refuses data that is not the image its type names", () => {
    expect(readImageData(dataUrl("image/png", [...ascii("GIF89a"), 1, 0, 1, 0]))).toEqual({
      problem: "The image's data is not a PNG image, so its size cannot be read. Check the data, or the type its data URL names",
    });
  });
});

describe("an `img:` that Siren does not draw", () => {
  it.each(["https://example.com/a.png", "http://example.com/a.png", "//example.com/a.png", "a.png", "file:///a.png"])(
    "refuses %s, saying Siren never fetches while drawing",
    (url) => {
      expect(readImageData(url)).toEqual({
        problem: `Siren never fetches an image while drawing, so "${url}" cannot be drawn. Embed the image as a data URL, such as img: "data:image/png;base64,…"`,
      });
    },
  );

  it("shortens a long URL in the message", () => {
    const url = `https://example.com/${"a".repeat(80)}.png`;
    const read = readImageData(url);
    expect("problem" in read && read.problem).toContain(`"${url.slice(0, 40)}…"`);
  });

  it("refuses a data URL of a type it does not draw", () => {
    expect(readImageData("data:image/bmp;base64,Qk0=")).toEqual({
      problem: 'The image is "image/bmp", which Siren does not draw. Use a PNG, GIF, JPEG, WebP or SVG data URL',
    });
    expect(readImageData("data:text/html,<script>alert(1)</script>")).toEqual({
      problem: 'The image is "text/html", which Siren does not draw. Use a PNG, GIF, JPEG, WebP or SVG data URL',
    });
  });

  it.each(["data:image/png;base64", "data:image/png;base64,@@@@", "data:image/png;base64,iVBO R"])(
    "refuses %s as a data URL that is not well-formed",
    (url) => {
      expect(readImageData(url)).toEqual({
        problem: 'The image\'s data URL is not well-formed. Write it as "data:image/png;base64," followed by the data',
      });
    },
  );

  it("refuses an image larger than 4 MB", () => {
    const url = `data:image/png;base64,${"A".repeat(Math.ceil(((4 * 1024 * 1024 + 3) * 4) / 3 / 4) * 4)}`;
    expect(readImageData(url)).toEqual({
      problem: "The image is larger than 4 MB, which Siren does not draw. Use a smaller image",
    });
  });
});

/**
 * An SVG's natural size, as Chrome reports it for an `<img>` of the same
 * data (measured): its `width` and `height` in absolute units, rounded to
 * whole pixels; a side it does not give, or gives as a percentage, taken
 * from the other through its `viewBox`'s proportions; and with neither
 * side, the `viewBox` fitted into 300 x 150, or 300 x 150 itself.
 */
describe("the natural size of an SVG data URL", () => {
  const svg = (attributes: string) =>
    `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="1" height="1"/></svg>`)}`;

  it.each([
    ['width="40" height="20"', 40, 20],
    ['width="40px" height="20px"', 40, 20],
    ['width="30pt" height="15pt"', 40, 20],
    ['width="2em" height="1em"', 32, 16],
    ['width="40.5" height="20.25"', 41, 20],
    ['width="40" viewBox="0 0 40 10"', 40, 10],
    ['width="40"', 40, 150],
    ['width="50%" height="20"', 300, 20],
    ['viewBox="0 0 40 40"', 150, 150],
    ['viewBox="0 0 40 20"', 300, 150],
    ['viewBox="0 0 20 80"', 38, 150],
    ["", 300, 150],
  ])("reads <svg %s> as %d x %d", (attributes, width, height) => {
    expect(readImageData(svg(attributes))).toEqual({ image: { width, height } });
  });

  it("reads one written as text rather than base64, after an XML declaration and a comment", () => {
    const text = '<?xml version="1.0"?><!-- a --><svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"/>';
    expect(readImageData(`data:image/svg+xml,${encodeURIComponent(text)}`)).toEqual({ image: { width: 7, height: 9 } });
  });

  it("refuses data with no <svg> element", () => {
    expect(readImageData(`data:image/svg+xml;base64,${btoa("<html></html>")}`)).toEqual({
      problem: "The image's data is not an SVG image, so its size cannot be read. Check the data, or the type its data URL names",
    });
  });
});
