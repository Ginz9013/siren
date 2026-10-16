import { describe, expect, it } from "vitest";
import { type IconifyJSON, resolveIcon } from "./iconPacks";

/**
 * Looking an icon up in the packs a caller registered, and turning its SVG
 * body into the data a node's glyph is drawn from.
 *
 * The packs are Iconify JSON (`prefix`, `icons`, a default `width` and
 * `height` of 16 when the pack gives none), handed over as data: nothing is
 * fetched.
 */

const PACK: IconifyJSON = {
  prefix: "t",
  width: 24,
  height: 24,
  icons: {
    sq: { body: '<path d="M0 0h24v24H0z" fill="currentColor"/>' },
    wide: { body: '<path d="M0 0h48v24H0z"/>', width: 48 },
  },
};

describe("looking an icon up", () => {
  it("finds an icon by `prefix:name`, its box the pack's own size", () => {
    const resolved = resolveIcon("t:sq", [PACK], "p-");

    expect(resolved).toEqual({
      glyph: {
        viewBox: { left: 0, top: 0, width: 24, height: 24 },
        elements: [
          {
            element: "path",
            attributes: [
              ["d", "M0 0h24v24H0z"],
              ["fill", "currentColor"],
            ],
            children: [],
          },
        ],
      },
    });
  });

  it("uses an icon's own width over the pack's, and 16 when neither gives one", () => {
    const wide = resolveIcon("t:wide", [PACK], "p-");
    const bare = resolveIcon("b:x", [{ prefix: "b", icons: { x: { body: "<path d='M0 0h1'/>" } } }], "p-");

    expect("glyph" in wide && wide.glyph.viewBox).toEqual({ left: 0, top: 0, width: 48, height: 24 });
    expect("glyph" in bare && bare.glyph.viewBox).toEqual({ left: 0, top: 0, width: 16, height: 16 });
  });

  it("searches the packs in order, so a later pack sharing a prefix adds icons", () => {
    const more: IconifyJSON = { prefix: "t", icons: { extra: { body: "<circle r='2'/>" } } };

    expect("glyph" in resolveIcon("t:extra", [PACK, more], "p-")).toBe(true);
    expect("glyph" in resolveIcon("t:sq", [PACK, more], "p-")).toBe(true);
  });

  it("follows an alias to its parent", () => {
    const aliased: IconifyJSON = { ...PACK, aliases: { square: { parent: "sq" } } };

    expect(resolveIcon("t:square", [aliased], "p-")).toEqual(resolveIcon("t:sq", [PACK], "p-"));
  });

  it("refuses a prefix no pack registers, saying how to register one", () => {
    expect(resolveIcon("fa:user", [PACK], "p-")).toEqual({
      problem:
        'No icon pack "fa" is registered, so the icon "fa:user" cannot be drawn. ' +
        'Pass the pack\'s Iconify JSON in the "iconPacks" render option',
    });
  });

  it("refuses a name the registered packs do not hold", () => {
    expect(resolveIcon("t:nope", [PACK], "p-")).toEqual({
      problem: 'The icon pack "t" has no icon "nope". Use an icon the pack holds, or register a pack that holds it',
    });
  });

  it("refuses an alias that rotates or flips its parent", () => {
    const flipped: IconifyJSON = { ...PACK, aliases: { back: { parent: "sq", hFlip: true } } };

    expect(resolveIcon("t:back", [flipped], "p-")).toEqual({
      problem: 'The icon "t:back" is rotated or flipped, which Siren does not draw. Use an icon that is not',
    });
  });
});

/**
 * An icon's body is SVG someone else wrote, so it is read through an
 * allowlist: only drawing elements and their geometry and paint survive.
 * Script, event handlers, links, anything that fetches and anything that
 * embeds other content are dropped, and the ids it declares are renamed so
 * that its references stay its own.
 */
describe("what an icon's body may draw", () => {
  /** The figure the body `body` reads as, in a 24px pack `x`. */
  const elementsOf = (body: string) => {
    const resolved = resolveIcon("x:i", [{ prefix: "x", width: 24, height: 24, icons: { i: { body } } }], "p-");
    if (!("glyph" in resolved)) {
      throw new Error(resolved.problem);
    }
    return resolved.glyph.elements;
  };

  it("drops a <script>, a <foreignObject>, a <use>, an <image>, an <a>, a <style> and an animation, with what they hold", () => {
    expect(
      elementsOf(
        "<script>alert(1)</script>" +
          '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>' +
          '<use href="https://example.com/a.svg#i"/>' +
          '<image href="https://example.com/a.png"/>' +
          '<a href="javascript:alert(1)"><path d="M0 0"/></a>' +
          "<style>path{fill:url(https://example.com/x)}</style>" +
          '<set attributeName="fill" to="red"/>' +
          '<animate attributeName="href" to="javascript:alert(1)"/>' +
          '<svg><path d="M1 1"/></svg>' +
          '<circle r="2"/>',
      ),
    ).toEqual([{ element: "circle", attributes: [["r", "2"]], children: [] }]);
  });

  it("drops event handlers, links and attributes it does not know, keeping geometry and paint", () => {
    expect(
      elementsOf(
        '<path d="M0 0h4" onclick="alert(1)" onload="alert(1)" href="#x" xlink:href="#x" ' +
          'xmlns:xlink="http://www.w3.org/1999/xlink" data-x="1" fill="currentColor" stroke-width="2" ' +
          'transform="rotate(45)" opacity=".5" fill-rule="evenodd"/>',
      ),
    ).toEqual([
      {
        element: "path",
        attributes: [
          ["d", "M0 0h4"],
          ["fill", "currentColor"],
          ["stroke-width", "2"],
          ["transform", "rotate(45)"],
          ["opacity", ".5"],
          ["fill-rule", "evenodd"],
        ],
        children: [],
      },
    ]);
  });

  it("renames the ids it declares and the `url(#…)` references to them, dropping a reference to anything else", () => {
    expect(
      elementsOf(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>' +
          '<path d="M0 0" fill="url(#g)" stroke="url(#elsewhere)" clip-path="url(https://example.com/c#k)"/>',
      ),
    ).toEqual([
      {
        element: "defs",
        attributes: [],
        children: [
          {
            element: "linearGradient",
            attributes: [["id", "p-g"]],
            children: [
              {
                element: "stop",
                attributes: [
                  ["offset", "0"],
                  ["stop-color", "red"],
                ],
                children: [],
              },
            ],
          },
        ],
      },
      { element: "path", attributes: [["d", "M0 0"], ["fill", "url(#p-g)"]], children: [] },
    ]);
  });

  it("keeps a `style` attribute's paint declarations and drops the rest, and any value that fetches", () => {
    expect(
      elementsOf('<path d="M0 0" style="fill:red; stroke: url(https://example.com/x); position: fixed; opacity:.5"/>'),
    ).toEqual([{ element: "path", attributes: [["d", "M0 0"], ["style", "fill: red; opacity: .5"]], children: [] }]);
  });

  it("refuses a body that is not well-formed SVG", () => {
    expect(resolveIcon("x:i", [{ prefix: "x", icons: { i: { body: "<path d='M0 0'>" } } }], "p-")).toEqual({
      problem: 'The icon "x:i" is not valid SVG, so it cannot be drawn. Use another icon',
    });
  });
});
