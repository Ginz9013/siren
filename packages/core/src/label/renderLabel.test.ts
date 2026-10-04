/**
 * The label vocabulary's behavior through `render()` that the compatibility
 * corpus has no status for: a label Siren draws *and* warns about.
 */
import { describe, expect, it } from "vitest";
import { render } from "../index";

describe("render() with a <span style> Siren draws only part of", () => {
  // The board: a property outside the ten is not drawn, and the author is
  // told, once per `style` attribute, at the tag — while the rest of the
  // label, and the document, are drawn.
  it("draws the label and warns at the <span> naming the properties it ignored", () => {
    const container = document.createElement("div");

    const result = render(
      `flowchart TB
  A["ab <span style='color: red; border: 1px solid'>c</span>"] --> B`,
      container,
    );

    expect(result.svg).not.toBeNull();
    expect(result.svg!.querySelector('g.siren-node[data-siren-id="A"] text')?.textContent).toBe("ab c");
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message:
          '<span style> ignores "border": Siren draws only color, background-color, font-size, ' +
          "font-weight, font-style, font-family, text-decoration, letter-spacing, word-spacing and opacity.",
        line: 2,
        column: 9,
      },
    ]);
  });
});

describe("render() with a label link inside a node link", () => {
  // The board: with a node `click` link, both links are kept — the label's
  // on its own text, the node's everywhere else (measured: Mermaid wraps the
  // node in an `<a>` and keeps the label's `<a>` inside it).
  it("keeps the node's <a> around the node and the label's <a> inside it", () => {
    const container = document.createElement("div");

    const result = render(
      `flowchart TB
  A["x <a href='https://in.example'>l</a>"]
  click A href "https://out.example"`,
      container,
    );

    expect(result.diagnostics).toEqual([]);
    const outer = result.svg!.querySelector('a[href="https://out.example"]');
    expect(outer?.querySelector('g.siren-node[data-siren-id="A"]')).not.toBeNull();
    const inner = outer!.querySelector('g.siren-node[data-siren-id="A"] text a[href="https://in.example"]');
    expect(inner?.textContent).toBe("l");
  });
});

describe("render() with a tag Siren refuses", () => {
  /** The diagnostics `render()` reports for `source`, and whether it drew anything. */
  function rendered(source: string) {
    const result = render(source, document.createElement("div"));
    return { drawn: result.svg !== null, diagnostics: result.diagnostics };
  }

  // ADR-0015: a refused layer is an error at the tag, and the document is
  // not drawn, as an unrecognized line is not.
  it("refuses the document with an error at the tag's own line and column", () => {
    const { drawn, diagnostics } = rendered(`flowchart TB
  A["x <table><tr><td>a</td></tr></table>"] --> B`);

    expect(drawn).toBe(false);
    expect(diagnostics.map(({ severity, line, column }) => ({ severity, line, column }))).toEqual([
      { severity: "error", line: 2, column: 8 },
    ]);
    expect(diagnostics[0]!.message).toBe(
      "<table> cannot be drawn: Siren draws labels as SVG text, not HTML, and does not draw tables.",
    );
  });

  it("places the error in a Markdown string on the source line the tag is written on", () => {
    const { drawn, diagnostics } = rendered(`flowchart TB
  A["\`**a**
b <img src='x.png'>\`"]`);

    expect(drawn).toBe(false);
    expect(diagnostics.map(({ severity, line, column }) => ({ severity, line, column }))).toEqual([
      { severity: "error", line: 3, column: 3 },
    ]);
  });

  // Mermaid draws sequence text in SVG mode, where the tag is its characters.
  it("draws a sequence message's tag as its characters, with no diagnostic", () => {
    const { drawn, diagnostics } = rendered(`sequenceDiagram
  A->>B: a <table> b`);

    expect(drawn).toBe(true);
    expect(diagnostics).toEqual([]);
  });
});
