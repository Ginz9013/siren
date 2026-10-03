import { describe, expect, it } from "vitest";
import type { Label, LabelBox, PositionedStateDiagram } from "../contracts";
import { plainLabel, plainRun } from "../label/label";
import { renderStateDiagramToSVG } from "./renderStateDiagramToSVG";
import { CANVAS_GUTTER } from "./sizeCanvas";

/** A label of these rows, each one plain run — what `a<br/>b` reads as. */
const rowsLabel = (...rows: string[]): Label => ({
  text: rows.join("\n"),
  rows: rows.map((row) => [plainRun(row)]),
});

/**
 * A box for `rowsLabel(...rows)` as a measurer answering 8px a character
 * and 24px a row, with no padding, would measure it — written out here so
 * no measurer is involved: the renderer draws what layout reported.
 */
const boxOf = (...rows: string[]): LabelBox => ({
  width: Math.max(...rows.map((row) => row.length * 8)),
  height: rows.length * 24,
  rows: rows.map((row, index) => ({
    y: index * 24 + 12,
    height: 24,
    width: row.length * 8,
    runs: [{ x: 0, width: row.length * 8 }],
  })),
});

/** One label of a state's box: `text` as one plain run, centred on `y`. */
const stateLabel = (text: string, y: number) => ({
  label: plainLabel(text),
  labelBox: boxOf(text),
  y,
});

const DIAGRAM: PositionedStateDiagram = {
  states: [
    {
      id: "Idle",
      kind: "state",
      stereotype: null,
      x: 10,
      y: 20,
      width: 80,
      height: 40,
      labels: [stateLabel("Idle", 40)],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
    {
      id: "Running",
      kind: "state",
      stereotype: null,
      x: 10,
      y: 120,
      width: 100,
      height: 40,
      labels: [stateLabel("Running", 140)],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
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
      label: plainLabel("start"),
      labelAnchor: { x: 70, y: 90 },
      labelBox: boxOf("start"),
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
      labelBox: null,
    },
  ],
  timeline: { totalSteps: 0, entries: [] },
  width: 200,
  height: 180,
};

describe("renderStateDiagramToSVG", () => {
  it("sizes the svg from the laid-out diagram", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    // The layout's extent plus `CANVAS_GUTTER` on every side, the
    // gutter taken into the viewBox's origin — see `sizeCanvas`.
    const g = CANVAS_GUTTER;
    expect(svg.getAttribute("width")).toBe(String(200 + g * 2));
    expect(svg.getAttribute("height")).toBe(String(180 + g * 2));
    expect(svg.getAttribute("viewBox")).toBe(`${-g} ${-g} ${200 + g * 2} ${180 + g * 2}`);
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

  it("draws a state's note as a box of text joined by a connector, inside the state's own group", () => {
    // Three parts, the same three a class diagram's note is drawn from and
    // through the same classes, because it is the same figure: a frame at
    // the box the layout placed, the text centred in it, and the dashed
    // connector the theme paints `.siren-note-link`.
    //
    // **Inside the annotated state's `<g>`, wearing no id of its own.**
    // Measured: Mermaid's note carries a name derived from its state
    // (`state-Idle----note-1`) and the author never writes one, so there is
    // no id for a `timeline:` block to name (ADR-0009) — and minting one
    // here would invent an author-facing handle Mermaid has no spelling for.
    // Living in the state's group is what makes it animate with the state
    // it hangs off, which is the only animation it can have.
    const noted: PositionedStateDiagram = {
      ...DIAGRAM,
      states: [
        {
          ...DIAGRAM.states[0],
          note: {
            label: plainLabel("waiting for work"),
            labelBox: boxOf("waiting for work"),
            x: 120,
            y: 10,
            width: 60,
            height: 30,
            connector: [
              { x: 90, y: 40 },
              { x: 120, y: 25 },
            ],
          },
        },
        DIAGRAM.states[1],
      ],
    };

    const svg = renderStateDiagramToSVG(noted);

    const group = svg.querySelector('g.siren-state[data-siren-id="Idle"]')!;
    const frame = group.querySelector("rect.siren-note-frame")!;
    expect(frame.getAttribute("x")).toBe("120");
    expect(frame.getAttribute("y")).toBe("10");
    expect(frame.getAttribute("width")).toBe("60");
    expect(frame.getAttribute("height")).toBe("30");

    const text = group.querySelector("text.siren-note-text")!;
    expect(text.textContent).toBe("waiting for work");
    expect(text.getAttribute("x")).toBe("150");
    expect(text.getAttribute("y")).toBe("25");

    const link = group.querySelector("path.siren-note-link")!;
    expect(link.getAttribute("d")).toBe("M90,40 L120,25");
    // An open multi-segment path would otherwise be painted as a filled
    // polygon, the reason every other connector here carries this too.
    expect(link.getAttribute("fill")).toBe("none");
    // No arrowhead: measured, Mermaid builds this edge with
    // `arrowhead: "none"`, and a head would read as a transition into the
    // note rather than a line tying it to its state.
    expect(link.getAttribute("marker-end")).toBeNull();

    // Nothing inside the note wears an id, and no second group appeared for
    // it: the note is part of its state, not a figure beside it.
    expect(
      Array.from(svg.querySelectorAll("[data-siren-id]")).map((e) =>
        e.getAttribute("data-siren-id"),
      ),
    ).toEqual(["Idle", "Running", "Idle-Running", "Running-Running"]);

    // A state the author wrote no note on draws none of the three.
    const plain = svg.querySelector('g.siren-state[data-siren-id="Running"]')!;
    expect(plain.querySelector(".siren-note-frame")).toBeNull();
    expect(plain.querySelector(".siren-note-text")).toBeNull();
    expect(plain.querySelector(".siren-note-link")).toBeNull();
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
    { id: "start:1", kind: "start", stereotype: null, x: 40, y: 10, width: 14, height: 14, labels: [], style: { frame: [], text: [] }, dividerY: null, note: null },
    {
      id: "Idle",
      kind: "state",
      stereotype: null,
      x: 10,
      y: 60,
      width: 80,
      height: 40,
      labels: [stateLabel("Idle", 80)],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
    { id: "end:1", kind: "end", stereotype: null, x: 40, y: 140, width: 14, height: 14, labels: [], style: { frame: [], text: [] }, dividerY: null, note: null },
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
      labelBox: null,
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
      stereotype: null,
      x: 10,
      y: 20,
      width: 160,
      height: 40,
      labels: [stateLabel("waiting for work", 40)],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
    {
      id: "Plain",
      kind: "state",
      stereotype: null,
      x: 10,
      y: 120,
      width: 100,
      height: 40,
      labels: [stateLabel("Plain", 140)],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
    {
      id: "t",
      kind: "state",
      stereotype: null,
      x: 10,
      y: 220,
      width: 160,
      height: 120,
      labels: [
        stateLabel("title row", 240),
        stateLabel("second", 290),
        stateLabel("third", 320),
      ],
      style: { frame: [], text: [] },
      dividerY: 260,
      note: null,
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

/**
 * One state per stereotype, each at the box `layoutStateDiagram` sizes for
 * its figure — a 28 × 28 square for the diamond, a 70 × 10 bar for a fork
 * under `TB`, and the same bar turned through a right angle for a join at a
 * level running `LR`.
 */
const STEREOTYPE_DIAGRAM: PositionedStateDiagram = {
  states: [
    {
      id: "Choice",
      kind: "state",
      stereotype: "choice",
      x: 40,
      y: 10,
      width: 28,
      height: 28,
      labels: [],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
    {
      id: "Split",
      kind: "state",
      stereotype: "fork",
      x: 20,
      y: 100,
      width: 70,
      height: 10,
      labels: [],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
    {
      id: "Merge",
      kind: "state",
      stereotype: "join",
      x: 50,
      y: 160,
      width: 10,
      height: 70,
      labels: [],
      style: { frame: [], text: [] },
      dividerY: null,
      note: null,
    },
  ],
  transitions: [],
  timeline: { totalSteps: 0, entries: [] },
  width: 200,
  height: 260,
};

describe("renderStateDiagramToSVG, on a stereotyped state", () => {
  it("draws a `<<choice>>` as a diamond filling its box, with no rectangle and no label", () => {
    // Measured (mermaid 11.17.2, `--markup` and a reading of the path's own
    // extent): the choice's `<g>` holds a diamond spanning `x[-14,14]
    // y[-14,14]` about the node's centre and **no label child at all**,
    // where the `Idle` beside it has one. So the four corners are the box's
    // edge midpoints, and there is nothing to write.
    const svg = renderStateDiagramToSVG(STEREOTYPE_DIAGRAM);

    const group = svg.querySelector('g.siren-state[data-siren-id="Choice"]')!;
    expect(group).not.toBeNull();
    expect(group.querySelector("text")).toBeNull();
    expect(group.querySelector("rect")).toBeNull();

    // The diamond wears the frame class whatever element draws it — the rule
    // `renderToSVG` already applies to a flowchart's diamond, so an author's
    // `class Choice urgent` lands on the figure rather than on an anonymous
    // descendant.
    const diamond = group.querySelector("polygon.siren-state-frame")!;
    expect(diamond).not.toBeNull();
    // Top, right, bottom, left of the 28 × 28 box at (40, 10).
    expect(diamond.getAttribute("points")).toBe("54,10 68,24 54,38 40,24");
  });

  it("draws a `<<fork>>` and a `<<join>>` as the same solid bar, at whatever box layout gave it", () => {
    // Measured: fork and join come back from Mermaid as the *same* path,
    // `M-35 -5 L35 -5 L35 5 L-35 5` — one figure with two spellings, so one
    // class draws both and nothing here asks which of the two it is. Which
    // way the bar lies is already in the box: layout turned it, measuring
    // the level's own direction.
    const svg = renderStateDiagramToSVG(STEREOTYPE_DIAGRAM);

    const bars = Array.from(svg.querySelectorAll("rect.siren-state-bar")).map((bar) => [
      bar.parentElement!.getAttribute("data-siren-id"),
      bar.getAttribute("x"),
      bar.getAttribute("y"),
      bar.getAttribute("width"),
      bar.getAttribute("height"),
    ]);
    expect(bars).toEqual([
      ["Split", "20", "100", "70", "10"],
      ["Merge", "50", "160", "10", "70"],
    ]);

    // Neither draws a label, for the reason the choice draws none: Mermaid's
    // `forkJoin` shape blanks it outright.
    for (const id of ["Split", "Merge"]) {
      const group = svg.querySelector(`g.siren-state[data-siren-id="${id}"]`)!;
      expect(group.querySelector("text"), id).toBeNull();
      expect(group.querySelector("rect.siren-state-frame"), id).toBeNull();
    }
  });
});

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
          stereotype: null,
          x: 5,
          y: 10,
          width: 200,
          height: 150,
          labels: [stateLabel("Outer", 30)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
        },
        {
          id: "Idle",
          kind: "state",
          stereotype: null,
          x: 40,
          y: 60,
          width: 80,
          height: 40,
          labels: [stateLabel("Idle", 80)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
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

  it("draws a note written on the composite itself, inside the composite's own group", () => {
    // Measured (mermaid 11.17.2): `note right of Outer : about the composite`
    // records the note on the composite's own record, exactly as it does on
    // an ordinary state — one statement, one field — so the frame carries
    // the same three note parts a box does, in the group wearing the
    // composite's id.
    const svg = renderStateDiagramToSVG({
      states: [
        {
          id: "Outer",
          kind: "composite",
          stereotype: null,
          x: 5,
          y: 10,
          width: 200,
          height: 150,
          labels: [stateLabel("Outer", 30)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: {
            label: plainLabel("about the block"),
            labelBox: boxOf("about the block"),
            x: 230,
            y: 60,
            width: 90,
            height: 30,
            connector: [
              { x: 205, y: 75 },
              { x: 230, y: 75 },
            ],
          },
        },
      ],
      transitions: [],
      timeline: { totalSteps: 0, entries: [] },
      width: 340,
      height: 180,
    });

    const group = svg.querySelector('g.siren-state[data-siren-id="Outer"]')!;
    expect(group.querySelector("rect.siren-note-frame")!.getAttribute("x")).toBe("230");
    expect(group.querySelector("text.siren-note-text")!.textContent).toBe("about the block");
    expect(group.querySelector("path.siren-note-link")!.getAttribute("d")).toBe("M205,75 L230,75");
  });

  it("leaves step-0 pending state to the controller, stamping siren-pending on none of the three addressable kinds", () => {
    // The guard `renderToSVG` and `renderClassDiagramToSVG` already carry,
    // written here the moment this kind started reading a `timeline:` block.
    // Step 0 is `createAnimationController(...).reset()`'s, computed from
    // `computeClassStateAtStep(timeline, 0)`; a copy of the "elements with an
    // `enter` action start hidden" rule in this file would be a second
    // opinion that has to agree with the controller's forever, by hand. Two
    // such copies were deleted from this codebase once already.
    const svg = renderStateDiagramToSVG({
      states: [
        {
          id: "Outer",
          kind: "composite",
          stereotype: null,
          x: 5,
          y: 10,
          width: 200,
          height: 150,
          labels: [stateLabel("Outer", 30)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
        },
        {
          id: "Idle",
          kind: "state",
          stereotype: null,
          x: 40,
          y: 60,
          width: 80,
          height: 40,
          labels: [stateLabel("Idle", 80)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
        },
      ],
      transitions: [
        {
          id: "Idle-Outer",
          from: "Idle",
          to: "Outer",
          points: [
            { x: 50, y: 60 },
            { x: 60, y: 120 },
          ],
          label: null,
          labelAnchor: null,
          labelBox: null,
        },
      ],
      // Every one of the three kinds given an `enter` at step 1, so a
      // renderer deciding step 0 for itself would hide all of them.
      timeline: {
        totalSteps: 1,
        entries: [
          { kind: "enter", step: 1, targetId: "Outer", effect: "fade" },
          { kind: "enter", step: 1, targetId: "Idle", effect: "fade" },
          { kind: "enter", step: 1, targetId: "Idle-Outer", effect: "fade" },
        ],
      },
      width: 220,
      height: 180,
    });

    expect(svg.querySelectorAll(".siren-pending")).toHaveLength(0);
  });

  it("writes the author's resolved declarations onto the drawn shape and every row of text", () => {
    // Inline, and on the drawn shape rather than the enclosing `<g>` —
    // ADR-0008's cascade reason, the same one `renderClassDiagramToSVG`
    // gives: the theme styles `.siren-state-frame` and `.siren-state-label`
    // directly, so an inline declaration on those elements outranks it
    // without `!important`, while the same one on the `<g>` would only be
    // *inherited* and lose.
    //
    // Every row, not only the title: measured (mermaid 11.17.2), a `class`
    // names the state and not one of its lines, and Mermaid's generated rule
    // is scoped to the whole node.
    const svg = renderStateDiagramToSVG({
      states: [
        {
          id: "Busy",
          kind: "state",
          stereotype: null,
          x: 10,
          y: 20,
          width: 80,
          height: 60,
          labels: [
            stateLabel("Busy", 35),
            stateLabel("working", 65),
          ],
          style: {
            frame: [
              { property: "fill", value: "#f96" },
              { property: "stroke", value: "#00f" },
            ],
            text: [{ property: "fill", value: "#fff" }],
          },
          dividerY: 50,
          note: null,
        },
        {
          id: "Idle",
          kind: "state",
          stereotype: null,
          x: 10,
          y: 120,
          width: 80,
          height: 40,
          labels: [stateLabel("Idle", 140)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
        },
      ],
      transitions: [],
      timeline: { totalSteps: 0, entries: [] },
      width: 200,
      height: 200,
    });

    const busy = svg.querySelector('g.siren-state[data-siren-id="Busy"]')!;
    expect(busy.querySelector("rect.siren-state-frame")!.getAttribute("style")).toBe(
      "fill:#f96;stroke:#00f",
    );
    expect(
      Array.from(busy.querySelectorAll("text")).map((t) => t.getAttribute("style")),
    ).toEqual(["fill:#fff", "fill:#fff"]);

    // An unstyled state gets **no** `style` attribute at all, rather than an
    // empty one: an empty attribute is still a declaration block the cascade
    // has to consider, and it would read as "this state was styled".
    const idle = svg.querySelector('g.siren-state[data-siren-id="Idle"]')!;
    expect(idle.querySelector("rect.siren-state-frame")!.hasAttribute("style")).toBe(false);
    expect(idle.querySelector("text")!.hasAttribute("style")).toBe(false);
  });

  it("reaches a composite's frame and its title, which is where Mermaid puts it too", () => {
    // Measured (mermaid 11.17.2): `class Outer urgent` on a composite lands
    // the class on the cluster's own `<g>` —
    // `class="urgent statediagram-state statediagram-cluster"` — and its
    // generated rule (`#id .urgent rect { ... }`) paints the frame's rects.
    // So a class applied to a composite reaches its frame, and this is the
    // assertion that Siren's does too.
    const svg = renderStateDiagramToSVG({
      states: [
        {
          id: "Outer",
          kind: "composite",
          stereotype: null,
          x: 5,
          y: 10,
          width: 200,
          height: 150,
          labels: [stateLabel("Outer", 30)],
          style: {
            frame: [{ property: "stroke", value: "#00f" }],
            text: [{ property: "fill", value: "#fff" }],
          },
          dividerY: null,
          note: null,
        },
      ],
      transitions: [],
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 180,
    });

    const outer = svg.querySelector('g.siren-state[data-siren-id="Outer"]')!;
    expect(outer.querySelector("rect.siren-composite-frame")!.getAttribute("style")).toBe(
      "stroke:#00f",
    );
    expect(outer.querySelector("text.siren-composite-label")!.getAttribute("style")).toBe(
      "fill:#fff",
    );
  });
});

describe("renderStateDiagramToSVG, on a concurrent region", () => {
  it("draws it as an untitled frame wearing its generated id, and nothing else", () => {
    // Measured with `--markup` (mermaid 11.17.2): a concurrent region comes
    // back as a `g.statediagram-cluster` holding exactly one element — a
    // `rect.divider` — with **no label** anywhere inside it, and mermaid's
    // own stylesheet gives that rect `stroke-dasharray: 10,10`. So the
    // figure is a dashed frame around the region's members, and there is
    // nothing to write on it: the id is generated, so drawing it would put
    // a string the author never wrote on the picture.
    const svg = renderStateDiagramToSVG({
      states: [
        {
          id: "Active",
          kind: "composite",
          stereotype: null,
          x: 5,
          y: 10,
          width: 300,
          height: 200,
          labels: [stateLabel("Active", 30)],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
        },
        {
          id: "region:1",
          kind: "region",
          stereotype: null,
          x: 20,
          y: 50,
          width: 130,
          height: 140,
          labels: [],
          style: { frame: [], text: [] },
          dividerY: null,
          note: null,
        },
      ],
      transitions: [],
      timeline: { totalSteps: 0, entries: [] },
      width: 320,
      height: 220,
    });

    // A `siren-state` group like every other frame, so a `timeline:` entry
    // and the theme's highlight rules reach it through the one selector
    // they already use — wearing the id `buildStateModel` minted.
    const group = svg.querySelector('g.siren-state[data-siren-id="region:1"]')!;
    expect(group).not.toBeNull();

    const frame = group.querySelector("rect.siren-state-region")!;
    expect([
      frame.getAttribute("x"),
      frame.getAttribute("y"),
      frame.getAttribute("width"),
      frame.getAttribute("height"),
    ]).toEqual(["20", "50", "130", "140"]);

    // No title, and not the composite's figure either: a region is
    // untitled, and `.siren-composite-frame` is the rounded, solid-outlined
    // one the block around it takes.
    expect(group.querySelector("text")).toBeNull();
    expect(group.querySelector("rect.siren-composite-frame")).toBeNull();
    expect(group.querySelector("rect.siren-state-frame")).toBeNull();

    // And the composite beside it is untouched — the two frames are two
    // figures, not one drawn twice.
    const block = svg.querySelector('g.siren-state[data-siren-id="Active"]')!;
    expect(block.querySelector("rect.siren-composite-frame")).not.toBeNull();
    expect(block.querySelector("rect.siren-state-region")).toBeNull();
  });
});

/**
 * Every label a state diagram draws goes through `drawLabel` (ADR-0015), so
 * a label of more than one row is one `<tspan class="siren-label-row">` per
 * row, each at the y its row's centre sits at — the box's top, which is
 * `anchor.y - height / 2`, plus the row's own `y` in the box.
 */
describe("renderStateDiagramToSVG — labels", () => {
  /** Each row tspan of `text`, as `[its text, its y]`. */
  const rowsOf = (text: Element | null) =>
    Array.from(text!.querySelectorAll("tspan.siren-label-row")).map((row) => [
      row.textContent,
      row.getAttribute("y"),
    ]);

  it("draws a description of two rows as two row tspans, centred on the y layout reported", () => {
    const diagram: PositionedStateDiagram = {
      ...DIAGRAM,
      states: [
        {
          ...DIAGRAM.states[0],
          labels: [{ label: rowsLabel("a", "b"), labelBox: boxOf("a", "b"), y: 40 }],
        },
      ],
      transitions: [],
    };

    const label = renderStateDiagramToSVG(diagram).querySelector("text.siren-state-label");

    // Centred on 40: the box's top is 40 - 24 = 16, its rows at 12 and 36.
    expect(rowsOf(label)).toEqual([
      ["a", "28"],
      ["b", "52"],
    ]);
  });

  it("draws a transition label of two rows centred on its anchor", () => {
    const diagram: PositionedStateDiagram = {
      ...DIAGRAM,
      transitions: [
        {
          ...DIAGRAM.transitions[0],
          label: rowsLabel("t", "u"),
          labelBox: boxOf("t", "u"),
          labelAnchor: { x: 70, y: 90 },
        },
      ],
    };

    const label = renderStateDiagramToSVG(diagram).querySelector("text.siren-transition-label");

    // Centred on the anchor, the centre of the box layout kept clear: the
    // box's top is 90 - 24 = 66, its rows at 12 and 36.
    expect(rowsOf(label)).toEqual([
      ["t", "78"],
      ["u", "102"],
    ]);
    expect(label!.getAttribute("dominant-baseline")).toBe("middle");
  });

  it("draws a note of two rows centred in its box", () => {
    const diagram: PositionedStateDiagram = {
      ...DIAGRAM,
      states: [
        {
          ...DIAGRAM.states[0],
          note: {
            label: rowsLabel("n", "m"),
            labelBox: boxOf("n", "m"),
            x: 120,
            y: 10,
            width: 60,
            height: 64,
            connector: [
              { x: 90, y: 40 },
              { x: 120, y: 42 },
            ],
          },
        },
      ],
    };

    const text = renderStateDiagramToSVG(diagram).querySelector("text.siren-note-text");

    // Centred on the box's middle, 10 + 32 = 42: the label's top is 18.
    expect(rowsOf(text)).toEqual([
      ["n", "30"],
      ["m", "54"],
    ]);
  });

  it("draws a composite's title of two rows in its strip", () => {
    const diagram: PositionedStateDiagram = {
      ...DIAGRAM,
      states: [
        {
          ...DIAGRAM.states[0],
          kind: "composite",
          labels: [{ label: rowsLabel("c", "d"), labelBox: boxOf("c", "d"), y: 36 }],
        },
      ],
      transitions: [],
    };

    const title = renderStateDiagramToSVG(diagram).querySelector("text.siren-composite-label");

    expect(rowsOf(title)).toEqual([
      ["c", "24"],
      ["d", "48"],
    ]);
  });

  it("keeps a label of one plain run as the text's own content, with no row tspans", () => {
    const svg = renderStateDiagramToSVG(DIAGRAM);

    for (const text of Array.from(svg.querySelectorAll("text"))) {
      expect(text.querySelector("tspan"), text.textContent!).toBeNull();
    }
    expect(svg.querySelector("text.siren-state-label")!.textContent).toBe("Idle");
    expect(svg.querySelector("text.siren-transition-label")!.textContent).toBe("start");
  });
});
