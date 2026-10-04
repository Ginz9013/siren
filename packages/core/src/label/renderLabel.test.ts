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
