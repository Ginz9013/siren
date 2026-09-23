import { describe, expect, it } from "vitest";
import type { PositionedErDiagram } from "../contracts";
import { renderErDiagramToSVG } from "./renderErDiagramToSVG";

const diagram = (
  entities: PositionedErDiagram["entities"],
  bounds: { width: number; height: number } = { width: 400, height: 100 },
): PositionedErDiagram => ({
  entities,
  timeline: { totalSteps: 0, entries: [] },
  ...bounds,
});

const CUSTOMER = { id: "CUSTOMER", label: "CUSTOMER", x: 10, y: 20, width: 92, height: 40 };

describe("renderErDiagramToSVG", () => {
  it("sizes the root svg from the bounds layout reported", () => {
    const svg = renderErDiagramToSVG(diagram([CUSTOMER], { width: 400, height: 100 }));

    expect(svg.getAttribute("width")).toBe("400");
    expect(svg.getAttribute("height")).toBe("100");
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 100");
  });

  it("draws one box per entity, at the box layout placed", () => {
    // Measured with `--markup` (mermaid 11.17.2): an entity is drawn as a
    // `rect.basic.label-container` — a plain rectangle carrying no `rx` — so
    // that is the figure, and its corner radius stays the theme's the way a
    // flowchart rectangle's does.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER]));

    const frames = Array.from(svg.querySelectorAll("rect.siren-er-entity-frame"));
    expect(frames).toHaveLength(1);
    expect(
      ["x", "y", "width", "height"].map((name) => frames[0].getAttribute(name)),
    ).toEqual(["10", "20", "92", "40"]);
    // Not written inline, so a consumer redeclaring the theme's token can
    // actually round it — the argument ADR-0008 makes for a flowchart frame.
    expect(frames[0].getAttribute("rx")).toBeNull();
  });

  it("draws the entity's name inside its own box, not merely somewhere in the picture", () => {
    // The assertion that makes this a *picture* check rather than a text
    // check: a label drawn at the origin while its box sits elsewhere still
    // has the right characters in it.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER]));

    const label = svg.querySelector("text.siren-er-entity-label");
    expect(label?.textContent).toBe("CUSTOMER");

    const x = Number(label?.getAttribute("x"));
    const y = Number(label?.getAttribute("y"));
    expect(x).toBeGreaterThan(CUSTOMER.x);
    expect(x).toBeLessThan(CUSTOMER.x + CUSTOMER.width);
    expect(y).toBeGreaterThan(CUSTOMER.y);
    expect(y).toBeLessThan(CUSTOMER.y + CUSTOMER.height);
  });

  it("puts each entity's id on its group, so a timeline entry can name it", () => {
    // ADR-0009: a timeline target is an id, and the id lands on the
    // enclosing `<g>` rather than on the parts inside it — the same place
    // `.siren-node`, `.siren-class` and `.siren-state` carry theirs, so one
    // controller drives an entity's box and its label together.
    const svg = renderErDiagramToSVG(
      diagram([CUSTOMER, { ...CUSTOMER, id: "ORDER", label: "ORDER", x: 150 }]),
    );

    const groups = Array.from(svg.querySelectorAll("g.siren-er-entity"));
    expect(groups.map((group) => group.getAttribute("data-siren-id"))).toEqual([
      "CUSTOMER",
      "ORDER",
    ]);
    // The frame and the label are inside the group that names them, which is
    // what makes the id reach both.
    for (const group of groups) {
      expect(group.querySelector("rect.siren-er-entity-frame")).not.toBeNull();
      expect(group.querySelector("text.siren-er-entity-label")).not.toBeNull();
    }
  });

  it("draws an empty document as an empty picture rather than throwing", () => {
    const svg = renderErDiagramToSVG(diagram([], { width: 0, height: 0 }));

    expect(svg.querySelectorAll("g.siren-er-entity")).toHaveLength(0);
    expect(svg.getAttribute("viewBox")).toBe("0 0 0 0");
  });
});
