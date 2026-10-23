import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { DEFAULT_TYPOGRAPHY, render, type RenderOptions } from "./index";
import type { TextMeasurer } from "./contracts";

/**
 * `render()`'s `typography` option, observed where it lands: the geometry of
 * the SVG it draws. The measurer here answers as a font of `fontSize` px
 * would — glyphs 0.6 × the size wide, a line 1.5 × the size tall, and a
 * constant padding of 16px across and 11px down — which is the contract
 * `typography.fontSize` puts on a caller's `measureText`.
 */
function measurerAt(fontSize: number): TextMeasurer {
  return {
    measure: (text) => ({ width: Array.from(text).length * fontSize * 0.6 + 16, height: fontSize * 1.5 + 11 }),
  };
}

function draw(source: string, options: RenderOptions = {}): SVGSVGElement {
  const container = document.createElement("div");
  const { svg, diagnostics } = render(source, container, options);
  expect(diagnostics).toEqual([]);
  return svg!;
}

describe("DEFAULT_TYPOGRAPHY", () => {
  it("is the default theme's sizes — 14px text, 12px connector labels, an 18px title — and frozen", () => {
    expect(DEFAULT_TYPOGRAPHY).toEqual({ fontSize: 14, labelFontSize: 12, titleFontSize: 18 });
    expect(Object.isFrozen(DEFAULT_TYPOGRAPHY)).toBe(true);
  });
});

describe("render() refuses a typography that is not a finite positive px size", () => {
  const fields = ["fontSize", "labelFontSize", "titleFontSize"] as const;
  const bad = [0, -14, Number.NaN, Number.POSITIVE_INFINITY];
  for (const field of fields) {
    for (const value of bad) {
      it(`throws a RangeError naming ${field} for ${value}, leaving the container untouched`, () => {
        const container = document.createElement("div");
        container.innerHTML = "<p>before</p>";
        expect(() => render("flowchart TD\n  A --> B", container, { typography: { [field]: value } })).toThrow(
          new RegExp(field),
        );
        expect(() => render("flowchart TD\n  A --> B", container, { typography: { [field]: value } })).toThrow(
          RangeError,
        );
        expect(container.innerHTML).toBe("<p>before</p>");
      });
    }
  }
});

/** A number attribute of the one element `selector` finds in `svg`. */
function attr(svg: SVGSVGElement, selector: string, name: string): number {
  const element = svg.querySelector(selector);
  expect(element, selector).not.toBeNull();
  return Number(element!.getAttribute(name));
}

const nodeHeight = (svg: SVGSVGElement, id: string) => attr(svg, `[data-siren-id="${id}"] .siren-node-frame`, "height");

describe("a flowchart node at typography.fontSize", () => {
  const source = 'flowchart TD\n  A["one<br>two"]\n  B[one]';

  it("spaces its rows a line of fontSize × 1.5 apart: at 28px, a second row adds 42px", () => {
    const svg = draw(source, { measureText: measurerAt(28), typography: { fontSize: 28 } });
    expect(nodeHeight(svg, "A") - nodeHeight(svg, "B")).toBe(28 * 1.5);
  });

  it("keeps a one-row node exactly as much taller than the measurer's answer as it is at the default size", () => {
    const large = draw(source, { measureText: measurerAt(28), typography: { fontSize: 28 } });
    const base = draw(source, { measureText: measurerAt(14) });
    // The measurer's padding (11px down) is the same at both sizes, so the
    // frame around one row is the measurer's answer plus the same room.
    expect(nodeHeight(large, "B") - measurerAt(28).measure("one").height).toBe(
      nodeHeight(base, "B") - measurerAt(14).measure("one").height,
    );
  });
});

/** The rows `id`'s label is drawn as, by their text. */
const rowsOf = (svg: SVGSVGElement, selector: string) =>
  Array.from(svg.querySelectorAll(`${selector} .siren-label-row`), (row) => row.textContent);

describe("a flowchart label wraps at the width for the size it is drawn at", () => {
  it("breaks a long node label into the same rows at twice the size", () => {
    const source = 'flowchart TD\n  A["the quick brown fox jumps over the lazy dog and keeps on running far away"]';
    const base = rowsOf(draw(source, { measureText: measurerAt(14) }), '[data-siren-id="A"]');
    const large = rowsOf(draw(source, { measureText: measurerAt(28), typography: { fontSize: 28 } }), '[data-siren-id="A"]');
    expect(base.length).toBeGreaterThan(1);
    expect(large).toEqual(base);
  });

  it("breaks a long edge label into the same rows at twice its labelFontSize", () => {
    const source = 'flowchart TD\n  A -- "the quick brown fox jumps over the lazy dog and keeps on running" --> B';
    const base = rowsOf(draw(source, { measureText: measurerAt(14) }), ".siren-edge-label");
    const large = rowsOf(
      draw(source, { measureText: measurerAt(14), typography: { labelFontSize: 24 } }),
      ".siren-edge-label",
    );
    expect(base.length).toBeGreaterThan(1);
    expect(large).toEqual(base);
  });
});

/**
 * A measurer whose whole answer, padding included, is proportional to the
 * size it measures at — so whatever a label is scaled to, it is that
 * label's own size times a constant, and two renders can be compared exactly.
 */
function proportionalMeasurerAt(fontSize: number): TextMeasurer {
  return { measure: (text) => ({ width: (Array.from(text).length * 0.6 + 1) * fontSize, height: 2 * fontSize }) };
}

const edgeLabelBackground = (svg: SVGSVGElement) => ({
  width: attr(svg, ".siren-connector-label-background", "width"),
  height: attr(svg, ".siren-connector-label-background", "height"),
});

describe("a flowchart edge label at typography.labelFontSize", () => {
  const source = 'flowchart LR\n  A -- "edge label" --> B';

  it("draws its background twice as wide and tall at 24px as at the default 12px", () => {
    const base = edgeLabelBackground(draw(source, { measureText: measurerAt(14) }));
    const large = edgeLabelBackground(draw(source, { measureText: measurerAt(14), typography: { labelFontSize: 24 } }));
    expect(large.width).toBeCloseTo(base.width * 2, 9);
    expect(large.height).toBeCloseTo(base.height * 2, 9);
  });

  it("does not follow fontSize: a 24px label is the same box whether the text around it is 14px or 28px", () => {
    const at14 = edgeLabelBackground(
      draw(source, { measureText: proportionalMeasurerAt(14), typography: { labelFontSize: 24 } }),
    );
    const at28 = edgeLabelBackground(
      draw(source, { measureText: proportionalMeasurerAt(28), typography: { fontSize: 28, labelFontSize: 24 } }),
    );
    expect(at28.width).toBeCloseTo(at14.width, 9);
    expect(at28.height).toBeCloseTo(at14.height, 9);
  });
});

describe("a flowchart subgraph's title band at typography.fontSize", () => {
  const source = 'flowchart TD\n  subgraph S["first<br>second"]\n    A\n  end';
  const titleRowYs = (svg: SVGSVGElement) =>
    Array.from(svg.querySelectorAll(".siren-subgraph-label .siren-label-row"), (row) => Number(row.getAttribute("y")));

  it("spaces the title's rows a 28px line (42px) apart, and makes its band that much taller", () => {
    const base = draw(source, { measureText: measurerAt(28) });
    const large = draw(source, { measureText: measurerAt(28), typography: { fontSize: 28 } });
    const [first, second] = titleRowYs(large);
    expect(second! - first!).toBe(42);
    // The same measurer both times, so all the title's box gains is its
    // second line's 42 − 21 = 21px; the title is centred in its band, so its
    // centre moves half that far down from the frame's top.
    const titleCentre = (svg: SVGSVGElement) =>
      attr(svg, ".siren-subgraph-label", "y") - attr(svg, ".siren-subgraph-frame", "y");
    expect(titleCentre(large) - titleCentre(base)).toBe(21 / 2);
  });
});

describe("an author's absolute px run counts against typography.fontSize", () => {
  const source = 'flowchart TD\n  A["a<span style=\'font-size:28px;background-color:#ff0\'>bb</span>"]\n  B[abb]';
  const options = { measureText: measurerAt(28), typography: { fontSize: 28 } };

  it("lays a 28px run out at scale 1 when the text is 28px: the node is as tall as a plain one", () => {
    const svg = draw(source, options);
    expect(nodeHeight(svg, "A")).toBe(nodeHeight(svg, "B"));
  });

  it("draws the run's background where layout measured it: its text's width, one 42px line tall, on the row", () => {
    const svg = draw(source, options);
    const background = '[data-siren-id="A"] .siren-label-background';
    // "bb" at 28px is 2 × 16.8 wide, less nothing: the measurer's padding is
    // the row's, not the run's.
    expect(attr(svg, background, "width")).toBeCloseTo(2 * 28 * 0.6, 9);
    expect(attr(svg, background, "height")).toBe(42);
    const row = svg.querySelector('[data-siren-id="A"] .siren-label-row')!;
    expect(attr(svg, background, "y") + 42 / 2).toBe(Number(row.getAttribute("y")));
  });
});

/**
 * The repository's `examples/` documents — every kind, with edge labels,
 * subgraphs, namespaces, composites, titles and inline styles among them —
 * read off disk relative to this file (see `index.test.ts` for why through
 * a binding).
 */
const TEST_FILE_URL = import.meta.url;
const EXAMPLES_DIR = new URL("../../../examples/", TEST_FILE_URL);
const examples = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith(".srn"));

/**
 * `svg.outerHTML` with each render's minted id scope (`mintIdScope`, random
 * per render) written as one placeholder, so two renders of one picture
 * compare equal.
 */
const markup = (svg: SVGSVGElement) => svg.outerHTML.replace(/__[0-9a-z]{8}\b/g, "__scope");

describe("the default typography draws the picture drawn without one", () => {
  it("is checked on a document of each of the five kinds", () => {
    for (const kind of ["flowchart", "class", "er", "state", "sequence"]) {
      expect(examples.some((name) => name.startsWith(`${kind}-`)), kind).toBe(true);
    }
  });

  for (const name of examples) {
    it(`${name}: leaving typography out, passing {}, and passing DEFAULT_TYPOGRAPHY draw the same SVG`, () => {
      const source = readFileSync(new URL(name, EXAMPLES_DIR), "utf8");
      const omitted = markup(draw(source));
      expect(markup(draw(source, { typography: {} }))).toBe(omitted);
      expect(markup(draw(source, { typography: DEFAULT_TYPOGRAPHY }))).toBe(omitted);
    });
  }
});
