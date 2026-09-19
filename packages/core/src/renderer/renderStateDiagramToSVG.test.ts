import { describe, expect, it } from "vitest";
import type { PositionedStateDiagram } from "../contracts";
import { renderStateDiagramToSVG } from "./renderStateDiagramToSVG";

const DIAGRAM: PositionedStateDiagram = {
  states: [
    { id: "Idle", kind: "state", x: 10, y: 20, width: 80, height: 40 },
    { id: "Running", kind: "state", x: 10, y: 120, width: 100, height: 40 },
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

/**
 * `[*] --> Idle` and `Idle --> [*]`, laid out: the two pseudo-states are
 * square boxes of the radius layout sized them at, and their ids are the
 * generated ones the model minted.
 */
const PSEUDO_DIAGRAM: PositionedStateDiagram = {
  states: [
    { id: "start:1", kind: "start", x: 40, y: 10, width: 14, height: 14 },
    { id: "Idle", kind: "state", x: 10, y: 60, width: 80, height: 40 },
    { id: "end:1", kind: "end", x: 40, y: 140, width: 14, height: 14 },
  ],
  transitions: [
    {
      id: "start:1-Idle",
      from: "start:1",
      to: "Idle",
      points: [
        { x: 47, y: 24 },
        { x: 47, y: 60 },
      ],
      label: null,
      labelAnchor: null,
    },
  ],
  timeline: { totalSteps: 0, entries: [] },
  width: 200,
  height: 180,
};

describe("renderStateDiagramToSVG, on the start and end pseudo-states", () => {
  it("draws a start as one filled disc centred in its box, with no frame and no label", () => {
    // UML draws a start as a filled disc, and so does Mermaid — measured
    // (11.17.2): `<circle class="state-start" r="7">` and nothing else
    // inside the node's group. Its id is generated, so drawing it as text
    // would print `start:1` at the reader.
    const svg = renderStateDiagramToSVG(PSEUDO_DIAGRAM);

    const group = svg.querySelector('g.siren-state[data-siren-id="start:1"]')!;
    expect(group).not.toBeNull();
    expect(group.querySelector("rect.siren-state-frame")).toBeNull();
    expect(group.querySelector("text")).toBeNull();

    const disc = group.querySelector("circle.siren-state-start")!;
    expect(disc.getAttribute("cx")).toBe("47");
    expect(disc.getAttribute("cy")).toBe("17");
    expect(disc.getAttribute("r")).toBe("7");
    // One circle: the start is the figure the end has an extra ring around,
    // not the same drawing.
    expect(group.querySelectorAll("circle")).toHaveLength(1);
  });

  it("draws an end as a ring around a smaller filled disc, concentric in its box", () => {
    // The other half of the UML pair, and the half Mermaid draws with two
    // nested circle outlines (measured: an outer r=7 and an inner one).
    const svg = renderStateDiagramToSVG(PSEUDO_DIAGRAM);

    const group = svg.querySelector('g.siren-state[data-siren-id="end:1"]')!;
    expect(group.querySelector("rect.siren-state-frame")).toBeNull();
    expect(group.querySelector("text")).toBeNull();

    const ring = group.querySelector("circle.siren-state-end")!;
    const inner = group.querySelector("circle.siren-state-end-inner")!;
    for (const circle of [ring, inner]) {
      expect(circle.getAttribute("cx")).toBe("47");
      expect(circle.getAttribute("cy")).toBe("147");
    }
    expect(Number(ring.getAttribute("r"))).toBe(7);
    // Inside the ring, and not a dot too small to read as one.
    expect(Number(inner.getAttribute("r"))).toBeLessThan(Number(ring.getAttribute("r")));
    expect(Number(inner.getAttribute("r"))).toBeGreaterThan(0);
  });

  it("leaves an ordinary state a labelled box when pseudo-states are in the same diagram", () => {
    // The kind decides the figure per state, not per diagram.
    const svg = renderStateDiagramToSVG(PSEUDO_DIAGRAM);

    const group = svg.querySelector('g.siren-state[data-siren-id="Idle"]')!;
    expect(group.querySelector("rect.siren-state-frame")).not.toBeNull();
    expect(group.querySelector("text.siren-state-label")!.textContent).toBe("Idle");
    expect(group.querySelector("circle")).toBeNull();
  });
});
