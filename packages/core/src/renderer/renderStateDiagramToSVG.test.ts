import { describe, expect, it } from "vitest";
import type { PositionedStateDiagram } from "../contracts";
import { renderStateDiagramToSVG } from "./renderStateDiagramToSVG";

const DIAGRAM: PositionedStateDiagram = {
  states: [
    {
      id: "Idle",
      kind: "state",
      x: 10,
      y: 20,
      width: 80,
      height: 40,
      rows: [{ text: "Idle", y: 40 }],
      dividerY: null,
    },
    {
      id: "Running",
      kind: "state",
      x: 10,
      y: 120,
      width: 100,
      height: 40,
      rows: [{ text: "Running", y: 140 }],
      dividerY: null,
    },
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
    { id: "start:1", kind: "start", x: 40, y: 10, width: 14, height: 14, rows: [], dividerY: null },
    {
      id: "Idle",
      kind: "state",
      x: 10,
      y: 60,
      width: 80,
      height: 40,
      rows: [{ text: "Idle", y: 80 }],
      dividerY: null,
    },
    { id: "end:1", kind: "end", x: 40, y: 140, width: 14, height: 14, rows: [], dividerY: null },
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

/**
 * A described state beside an undescribed one, laid out: `s : waiting for
 * work` draws its description where its id used to go, `Plain` still draws
 * its id, and `t` carries the three rows and the divider a state with two
 * or more descriptions is given.
 */
const DESCRIBED_DIAGRAM: PositionedStateDiagram = {
  states: [
    {
      id: "s",
      kind: "state",
      x: 10,
      y: 20,
      width: 160,
      height: 40,
      rows: [{ text: "waiting for work", y: 40 }],
      dividerY: null,
    },
    {
      id: "Plain",
      kind: "state",
      x: 10,
      y: 120,
      width: 100,
      height: 40,
      rows: [{ text: "Plain", y: 140 }],
      dividerY: null,
    },
    {
      id: "t",
      kind: "state",
      x: 10,
      y: 220,
      width: 160,
      height: 120,
      rows: [
        { text: "title row", y: 240 },
        { text: "second", y: 290 },
        { text: "third", y: 320 },
      ],
      dividerY: 260,
    },
  ],
  transitions: [],
  timeline: { totalSteps: 0, entries: [] },
  width: 300,
  height: 360,
};

describe("renderStateDiagramToSVG, on a described state", () => {
  it("draws the rows the layout measured, at the y it measured each one at", () => {
    // A described state draws its description and not its id — measured
    // (mermaid 11.17.2): once `s : text` is written, `s` appears nowhere in
    // the picture. By here the question is already settled: layout hands
    // over the rows, and this draws them.
    const svg = renderStateDiagramToSVG(DESCRIBED_DIAGRAM);

    const described = svg.querySelector('g.siren-state[data-siren-id="s"]')!;
    const texts = Array.from(described.querySelectorAll("text"));
    expect(texts.map((text) => text.textContent)).toEqual(["waiting for work"]);
    expect(texts[0].getAttribute("y")).toBe("40");
    // Centred in its own box, as the id it replaced was.
    expect(texts[0].getAttribute("x")).toBe("90");

    // An undescribed state is untouched by any of this: its one row is its
    // id, and it still draws it.
    const plain = svg.querySelector('g.siren-state[data-siren-id="Plain"]')!;
    expect(plain.querySelector("text.siren-state-label")!.textContent).toBe("Plain");

    // Three rows, each at its own y — a renderer that centred every row in
    // the box would stack all three on one line and draw one smudge.
    const titled = svg.querySelector('g.siren-state[data-siren-id="t"]')!;
    const rows = Array.from(titled.querySelectorAll("text"));
    expect(rows.map((text) => text.textContent)).toEqual(["title row", "second", "third"]);
    expect(rows.map((text) => text.getAttribute("y"))).toEqual(["240", "290", "320"]);
  });
});

describe("renderStateDiagramToSVG, on a state with two or more descriptions", () => {
  it("draws the divider under the title row, and draws none where the layout measured none", () => {
    // Measured (mermaid 11.17.2, `--markup`): two or more descriptions are
    // drawn as `rect.outer.title-state` *plus* a `line.divider`, the first
    // description titling the box above the line and the rest below it —
    // while one description gets a plain rounded rect with no line in it.
    const svg = renderStateDiagramToSVG(DESCRIBED_DIAGRAM);

    const titled = svg.querySelector('g.siren-state[data-siren-id="t"]')!;
    const divider = titled.querySelector("line.siren-state-divider");
    expect(divider).not.toBeNull();
    expect(divider!.getAttribute("y1")).toBe("260");
    expect(divider!.getAttribute("y2")).toBe("260");
    // Spanning the frame, so it reads as part of the box rather than as a
    // stray line beside it.
    expect(divider!.getAttribute("x1")).toBe("10");
    expect(divider!.getAttribute("x2")).toBe("170");

    // The first description titles the box and the rest are its
    // description rows — two classes, because a theme that cannot tell the
    // title row from the rows below it cannot weight one differently.
    expect(titled.querySelector("text.siren-state-label")!.textContent).toBe("title row");
    expect(
      Array.from(titled.querySelectorAll("text.siren-state-description")).map(
        (text) => text.textContent,
      ),
    ).toEqual(["second", "third"]);

    // One description, and none at all: no line, and the one row each
    // draws is the box's title.
    for (const id of ["s", "Plain"]) {
      const group = svg.querySelector(`g.siren-state[data-siren-id="${id}"]`)!;
      expect(group.querySelector("line"), id).toBeNull();
      expect(group.querySelector("text")!.getAttribute("class"), id).toBe("siren-state-label");
    }
  });
});

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
  });});

describe("renderStateDiagramToSVG, on a composite state", () => {
  it("draws it as an unfilled frame with its title in the strip along the top", () => {
    // Measured with `--markup` (mermaid 11.17.2): a composite is a
    // `g.statediagram-cluster` — a frame with the composite's own name
    // drawn on a strip along its top, and its members inside it. Siren
    // draws that as its own `siren-*` figure rather than copying Mermaid's
    // two-rect construction; what is owed is the figure.
    const svg = renderStateDiagramToSVG({
      states: [
        {
          id: "Outer",
          kind: "composite",
          x: 5,
          y: 10,
          width: 200,
          height: 150,
          rows: [{ text: "Outer", y: 30 }],
          dividerY: null,
        },
        {
          id: "Idle",
          kind: "state",
          x: 40,
          y: 60,
          width: 80,
          height: 40,
          rows: [{ text: "Idle", y: 80 }],
          dividerY: null,
        },
      ],
      transitions: [],
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 180,
    });

    // One group, wearing the composite's own id — a composite is a state,
    // addressed the way every other state is, and its id is the author's own
    // word rather than a generated one.
    const group = svg.querySelector('g.siren-state[data-siren-id="Outer"]')!;
    expect(group).not.toBeNull();

    const frame = group.querySelector("rect.siren-composite-frame")!;
    expect(frame.getAttribute("x")).toBe("5");
    expect(frame.getAttribute("y")).toBe("10");
    expect(frame.getAttribute("width")).toBe("200");
    expect(frame.getAttribute("height")).toBe("150");

    // The title, at the row layout measured for it, centred across the
    // frame.
    const title = group.querySelector("text.siren-composite-label")!;
    expect(title.textContent).toBe("Outer");
    expect(title.getAttribute("x")).toBe("105");
    expect(title.getAttribute("y")).toBe("30");

    // And not a state's own box: `.siren-state-frame` is filled, so a
    // composite drawn with one would hide everything inside it.
    expect(group.querySelector("rect.siren-state-frame")).toBeNull();
    expect(group.querySelector("text.siren-state-label")).toBeNull();
  });
});
