import { describe, expect, it } from "vitest";
import type { PositionedStateDiagram } from "../contracts";
import { renderStateDiagramToSVG } from "./renderStateDiagramToSVG";

const DIAGRAM: PositionedStateDiagram = {
  states: [
    { id: "Idle", x: 10, y: 20, width: 80, height: 40 },
    { id: "Running", x: 10, y: 120, width: 100, height: 40 },
  ],
  transitions: [
    {
      id: "Idle-Running",
      from: "Idle",
      to: "Running",
      points: [
        { x: 50, y: 60 },
        { x: 60, y: 120 },
      ],
      label: "start",
      labelAnchor: { x: 70, y: 90 },
    },
    {
      id: "Running-Running",
      from: "Running",
      to: "Running",
      points: [
        { x: 110, y: 130 },
        { x: 140, y: 140 },
        { x: 110, y: 150 },
      ],
      label: null,
      labelAnchor: null,
    },
  ],
  timeline: { totalSteps: 0, entries: [] },
  width: 200,
  height: 180,
};

describe("renderStateDiagramToSVG", () => {
  it("sizes the svg from the laid-out diagram", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.getAttribute("height")).toBe("180");
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 180");
  });

  it("draws one siren-state group per state, wearing its id, around a frame at its box and its label", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    const groups = Array.from(svg.querySelectorAll("g.siren-state"));
    expect(groups.map((g) => g.getAttribute("data-siren-id"))).toEqual(["Idle", "Running"]);

    const frame = groups[0].querySelector("rect.siren-state-frame")!;
    expect(frame.getAttribute("x")).toBe("10");
    expect(frame.getAttribute("y")).toBe("20");
    expect(frame.getAttribute("width")).toBe("80");
    expect(frame.getAttribute("height")).toBe("40");

    // Centred in its own box, which is where the layout measured the label to
    // fit — not at the box's corner.
    const label = groups[0].querySelector("text.siren-state-label")!;
    expect(label.textContent).toBe("Idle");
    expect(label.getAttribute("x")).toBe("50");
    expect(label.getAttribute("y")).toBe("40");
  });

  it("draws one siren-transition group per transition, wearing its id, following the routed points", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    const groups = Array.from(svg.querySelectorAll("g.siren-transition"));
    expect(groups.map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "Idle-Running",
      "Running-Running",
    ]);

    const line = groups[0].querySelector("path.siren-transition-line")!;
    expect(line.getAttribute("d")).toBe("M50,60 L60,120");
    // Explicit, not left to CSS: an open multi-segment path would otherwise
    // be painted as a filled polygon over the states it connects.
    expect(line.getAttribute("fill")).toBe("none");
  });

  it("points every transition at an arrowhead this SVG actually defines", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    for (const line of Array.from(svg.querySelectorAll("path.siren-transition-line"))) {
      const reference = line.getAttribute("marker-end");
      expect(reference).not.toBeNull();
      const marker = svg.querySelector(
        `defs > marker#${reference!.slice("url(#".length, -1)}`,
      );
      expect(marker, reference!).not.toBeNull();
      // A closed outline — the arrowhead, read as the figure it draws rather
      // than as the class that paints it.
      expect(marker!.firstElementChild!.getAttribute("d")).toContain("Z");
    }
  });

  it("scopes its marker id to this render, so two diagrams on one page keep their own arrowheads", () => {
    // `url(#id)` resolves against the whole page, never against the SVG it is
    // written in — the reason `mintIdScope` exists.
    const first = renderStateDiagramToSVG(DIAGRAM);
    const second = renderStateDiagramToSVG(DIAGRAM);

    const idOf = (svg: SVGSVGElement) => svg.querySelector("defs > marker")!.getAttribute("id");
    expect(idOf(first)).not.toBe(idOf(second));
  });

  it("draws a transition's label at its anchor, and draws none at all when it carries none", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    const labelled = svg.querySelector('g.siren-transition[data-siren-id="Idle-Running"]')!;
    const label = labelled.querySelector("text.siren-transition-label")!;
    expect(label.textContent).toBe("start");
    expect(label.getAttribute("x")).toBe("70");
    expect(label.getAttribute("y")).toBe("90");

    const unlabelled = svg.querySelector('g.siren-transition[data-siren-id="Running-Running"]')!;
    expect(unlabelled.querySelector("text")).toBeNull();
  });

  it("draws the self-transition's whole loop, not just its two ends", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    const loop = svg.querySelector(
      'g.siren-transition[data-siren-id="Running-Running"] path.siren-transition-line',
    )!;
    expect(loop.getAttribute("d")).toBe("M110,130 L140,140 L110,150");
  });

  it("draws the states before the transitions, so a line is never hidden behind a box", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    const drawn = Array.from(svg.querySelectorAll("g.siren-state, g.siren-transition")).map((g) =>
      g.getAttribute("class"),
    );
    expect(drawn).toEqual([
      "siren-state",
      "siren-state",
      "siren-transition",
      "siren-transition",
    ]);
  });
});
