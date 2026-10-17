import { describe, expect, it } from "vitest";
import { type IconifyJSON, resolveIcon } from "./iconPacks";
import { render } from "../index";

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

  it("keeps a paint or reference value only when it is a colour, a colour function, a keyword, a number or length, or a local `url(#id)`", () => {
    // Measured (headless Chrome, a local server): `mask: image-set('…' 1x)`
    // in a `style`, `mask="image-set('…' 1x)"` and `-webkit-image-set(…)`
    // each made the page request the image. Any value with a function in
    // it but a local reference or a colour function is dropped; colours,
    // keywords and numbers stay.
    expect(
      elementsOf(
        '<defs><mask id="m"/></defs>' +
          "<path d=\"M0 0\" style=\"mask: image-set('http://e/a.png' 1x); fill: #0f0; stroke-width: 2px; opacity: .5\"/>" +
          "<path d=\"M0 1\" mask=\"image-set('http://e/b.png' 1x)\" clip-path=\"-webkit-image-set('http://e/c.png' 1x)\"/>" +
          "<path d=\"M0 2\" fill=\"image-set('http://e/d.png' 1x)\" stroke=\"cross-fade(url(#m), red)\" " +
          'stroke-dasharray="2, 1 3" mask="url(#m)" fill-rule="evenodd" color="rgb(1, 2, 3)"/>' +
          "<path d=\"M0 3\" style=\"fill: element(#m); stroke: src('http://e/f.png'); color: currentColor\"/>",
      ).slice(1),
    ).toEqual([
      { element: "path", attributes: [["d", "M0 0"], ["style", "fill: #0f0; stroke-width: 2px; opacity: .5"]], children: [] },
      { element: "path", attributes: [["d", "M0 1"]], children: [] },
      {
        element: "path",
        attributes: [
          ["d", "M0 2"],
          ["stroke-dasharray", "2, 1 3"],
          ["mask", "url(#p-m)"],
          ["fill-rule", "evenodd"],
          ["color", "rgb(1, 2, 3)"],
        ],
        children: [],
      },
      { element: "path", attributes: [["d", "M0 3"], ["style", "color: currentColor"]], children: [] },
    ]);
  });

  it("keeps a transform's own functions, and no other function in a geometry value", () => {
    expect(
      elementsOf(
        '<path d="M0 0" transform="translate(1 2) rotate(45) scale(2) matrix(1 0 0 1 0 0) skewX(3)"/>' +
          "<path d=\"M0 1\" transform=\"image-set('http://e/a.png' 1x)\" x=\"calc(1px)\"/>",
      ),
    ).toEqual([
      {
        element: "path",
        attributes: [["d", "M0 0"], ["transform", "translate(1 2) rotate(45) scale(2) matrix(1 0 0 1 0 0) skewX(3)"]],
        children: [],
      },
      { element: "path", attributes: [["d", "M0 1"]], children: [] },
    ]);
  });

  it("refuses a body that is not well-formed SVG", () => {
    expect(resolveIcon("x:i", [{ prefix: "x", icons: { i: { body: "<path d='M0 0'>" } } }], "p-")).toEqual({
      problem: 'The icon "x:i" is not valid SVG, so it cannot be drawn. Use another icon',
    });
  });
});

/**
 * A pack is a caller's data, read at run time: whatever shape it arrives
 * in, looking an icon up in it gives a glyph or a problem, never a throw or
 * a glyph that cannot be drawn.
 */
describe("a pack that is not the shape of an Iconify JSON pack", () => {
  const NOT_A_PACK =
    'The "iconPacks" render option holds something that is not an Iconify icon pack — an object with a string ' +
    '"prefix" and its "icons" — so the icon "t:x" cannot be drawn. Pass each pack\'s Iconify JSON as it is';

  it.each([
    ["null", [null]],
    ["a string", ["t"]],
    ["a pack with no icons", [{ prefix: "t" }]],
    ["a pack whose prefix is not a string", [{ prefix: 1, icons: {} }]],
    ["a pack whose aliases are not an object", [{ prefix: "t", icons: {}, aliases: 5 }]],
  ])("refuses %s, saying what a pack is", (_, packs) => {
    expect(resolveIcon("t:x", packs as unknown as IconifyJSON[], "p-")).toEqual({ problem: NOT_A_PACK });
  });

  it("refuses an \"iconPacks\" option that is not a list", () => {
    expect(resolveIcon("t:x", { prefix: "t", icons: {} } as unknown as IconifyJSON[], "p-")).toEqual({
      problem:
        'The "iconPacks" render option is not a list of Iconify icon packs, so the icon "t:x" cannot be drawn. ' +
        "Pass an array of packs",
    });
  });

  it.each([
    ["no body", {}],
    ["a body that is not text", { body: 5 }],
    ["an icon that is null", null],
  ])("refuses an icon with %s", (_, icon) => {
    expect(resolveIcon("t:x", [{ prefix: "t", icons: { x: icon } } as unknown as IconifyJSON], "p-")).toEqual({
      problem: 'The icon "t:x" has no SVG "body" text, so it cannot be drawn. Use another icon',
    });
  });

  it.each([
    ["a width of 0", { width: 0 }],
    ["a negative width", { width: -24 }],
    ["a width that is not a number", { width: "abc" }],
    ["a height that is not finite", { height: Infinity }],
    ["a left that is not a number", { left: "x" }],
  ])("refuses an icon with %s, its box impossible to draw", (_, box) => {
    const pack = { prefix: "t", icons: { x: { body: "<path d='M0 0'/>", ...box } } } as unknown as IconifyJSON;
    expect(resolveIcon("t:x", [pack], "p-")).toEqual({
      problem: 'The icon "t:x" has a box that is not a positive width and height at a numeric left and top, so it cannot be drawn. Use another icon',
    });
  });

  it("refuses a pack-wide size that is impossible the same way", () => {
    const pack = { prefix: "t", width: 0, icons: { x: { body: "<path d='M0 0'/>" } } } as unknown as IconifyJSON;
    expect(resolveIcon("t:x", [pack], "p-")).toEqual({
      problem: 'The icon "t:x" has a box that is not a positive width and height at a numeric left and top, so it cannot be drawn. Use another icon',
    });
  });
});

describe("an icon body nested deeply", () => {
  const resolve = (depth: number) =>
    resolveIcon("t:x", [{ prefix: "t", icons: { x: { body: `${"<g>".repeat(depth)}<path d="M0 0"/>${"</g>".repeat(depth)}` } } }], "p-");

  it("draws one nested as deep as an icon is drawn", () => {
    expect("glyph" in resolve(100)).toBe(true);
  });

  it("refuses one nested deeper than any icon needs, rather than running out of stack", () => {
    expect(resolve(5000)).toEqual({
      problem: 'The icon "t:x" nests its elements more than 256 deep, so it cannot be drawn. Use another icon',
    });
  });
});

describe("a gradient that takes its stops from another", () => {
  it("keeps a gradient's `href` or `xlink:href` to a gradient the icon declares, renamed, and drops any other", () => {
    const resolved = resolveIcon(
      "t:x",
      [
        {
          prefix: "t",
          icons: {
            x: {
              body:
                '<defs xmlns:xlink="http://www.w3.org/1999/xlink"><linearGradient id="a"><stop offset="0"/></linearGradient>' +
                '<linearGradient id="b" href="#a"/><radialGradient id="c" xlink:href="#a"/>' +
                '<linearGradient id="d" href="#nope"/><linearGradient id="e" href="http://e/x.svg#a"/></defs>',
            },
          },
        },
      ],
      "p-",
    );
    const gradients = "glyph" in resolved ? resolved.glyph.elements[0]!.children.slice(1) : [];
    expect(gradients.map((gradient) => gradient.attributes)).toEqual([
      [["id", "p-b"], ["href", "#p-a"]],
      [["id", "p-c"], ["href", "#p-a"]],
      [["id", "p-d"]],
      [["id", "p-e"]],
    ]);
  });
});

describe("an alias's flips and rotation, laid over its parent's", () => {
  /** Whether the alias `a`, over a parent `p` with `parent`'s transformations, is drawn. */
  const drawn = (parent: object, alias: object) =>
    "glyph" in
    resolveIcon(
      "t:a",
      [{ prefix: "t", icons: { p: { body: "<path d='M0 0'/>", ...parent } }, aliases: { a: { parent: "p", ...alias } } }],
      "p-",
    );

  it("combines flips as Iconify does, each flip undoing the other, so two make none", () => {
    expect(drawn({ hFlip: true }, { hFlip: true })).toBe(true);
    expect(drawn({ vFlip: true }, { vFlip: true })).toBe(true);
    expect(drawn({ hFlip: true }, { vFlip: true })).toBe(false);
    expect(drawn({}, { hFlip: true })).toBe(false);
  });

  it("adds rotations as Iconify does, four quarter turns making none", () => {
    expect(drawn({ rotate: 2 }, { rotate: 2 })).toBe(true);
    expect(drawn({ rotate: 1 }, { rotate: 2 })).toBe(false);
  });
});

/**
 * A colour written as a colour function in an icon's paint. The function
 * may be one of the colour functions, called once with plain arguments —
 * numbers, percentages, angles, `none`, `/` and a colour space's name — and
 * nothing else: no other function, and no function inside one, since a
 * function is how a value fetches.
 */
describe("a colour function in an icon's paint", () => {
  /** The `fill` and `style` of the first path drawn for an icon whose body is `body`. */
  const drawnPaint = (body: string) => {
    const pack = { prefix: "c", width: 24, height: 24, icons: { i: { body } } };
    const result = render('flowchart TB\n  A@{ icon: "c:i" }', document.createElement("div"), { iconPacks: [pack] });
    expect(result.diagnostics).toEqual([]);
    const path = result.svg!.querySelector('g.siren-node[data-siren-id="A"] > g > path')!;
    return { fill: path.getAttribute("fill"), style: path.getAttribute("style") };
  };

  it.each([
    "rgb(1 2 3)",
    "rgba(1, 2, 3, 0.5)",
    "hsl(120deg 50% 50%)",
    "hsla(120, 50%, 50%, .5)",
    "hwb(120 10% 20% / 0.5)",
    "lab(50% 40 59.5)",
    "lch(52.2% 72.2 50 / 50%)",
    "oklab(0.4 0.1 -0.1)",
    "oklch(60% 0.15 none)",
    "color(display-p3 1 0 0 / 50%)",
  ])("keeps and draws `%s`, as an attribute or a declaration", (value) => {
    expect(drawnPaint(`<path d="M0 0" fill="${value}" style="stroke: ${value}"/>`)).toEqual({
      fill: value,
      style: `stroke: ${value}`,
    });
  });

  it.each([
    "url(http://e/a.png)",
    "var(--c)",
    "calc(1 * 2)",
    "rgb(var(--r) 2 3)",
    "rgb(calc(1) 2 3)",
    "color-mix(in srgb, red, blue)",
    "rgb(1 2 3) url(http://e/a.png)",
    "image-set('http://e/a.png' 1x)",
  ])("drops `%s`, as an attribute or a declaration", (value) => {
    expect(drawnPaint(`<path d="M0 0" fill="${value}" style="stroke: ${value}; opacity: .5"/>`)).toEqual({
      fill: null,
      style: "opacity: .5",
    });
  });
});
