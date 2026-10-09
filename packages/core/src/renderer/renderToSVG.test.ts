import { describe, expect, it, vi } from "vitest";
import { renderToSVG } from "./renderToSVG";
import type { PositionedEdge, PositionedGraph } from "../contracts";
import { CANVAS_GUTTER } from "./sizeCanvas";
import { layoutLabel } from "../label/layoutLabel";
import { plainLabel, plainRun, type LabelRun } from "../label/label";

/**
 * A positioned node's `label` and `labelBox` for one plain row of `text`,
 * measured as layout would measure it — 8px a character, 20px a line. A
 * fixture about paint or position spreads this rather than spelling a box
 * out by hand; a test about the label's own rows builds its own.
 */
function labelled(text: string) {
  const label = plainLabel(text);
  return {
    label,
    labelBox: layoutLabel(label, { measure: (t: string) => ({ width: t.length * 8, height: 20 }) }),
  };
}

/**
 * A positioned edge's `label` for one plain row of `text`, placed at
 * `anchor` — `labelled`'s measurement, with the centre layout would have
 * reported for it.
 */
function placed(text: string, anchor: { x: number; y: number }) {
  const { label, labelBox } = labelled(text);
  return { label: { label, labelBox, anchor } };
}

/**
 * `A --> B`'s decomposition — a solid line, an arrow on the to-end only,
 * one rank long — spread into the fixture below, which is about positions
 * and paint rather than about which arrow was written. A test that *is*
 * about the arrow sets its own.
 */
const PLAIN_ARROW = {
  line: "solid",
  fromEnd: "none",
  toEnd: "arrow",
  minLength: 1,
  // An unlabelled edge: layout places a label only for an edge that asked
  // for space. A test that *is* about the label sets it.
  label: null,
} as const;

/**
 * Hand-built fixture: A -> B -> C, B pending at step 1, C pending at step 2,
 * A never mentioned in the timeline (visible from the start).
 */
function buildFixture(): PositionedGraph {
  return {
    direction: "TB",
    nodes: [
      { id: "A", ...labelled("Start"), x: 0, y: 0, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "B", ...labelled("Process"), x: 0, y: 100, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "C", ...labelled("End"), x: 0, y: 200, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
    ],
    edges: [
      {
        id: "A-B",
        from: "A",
        to: "B",
        ...PLAIN_ARROW,
        style: { frame: [], text: [] },
        points: [
          { x: 40, y: 20 },
          { x: 40, y: 100 },
        ],
      },
      {
        id: "B-C",
        from: "B",
        to: "C",
        ...PLAIN_ARROW,
        style: { frame: [], text: [] },
        points: [
          { x: 40, y: 120 },
          { x: 40, y: 200 },
        ],
      },
    ],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: {
      totalSteps: 2,
      entries: [
        { kind: "enter", step: 1, targetId: "B", effect: "fade" },
        { kind: "enter", step: 2, targetId: "C", effect: "fade" },
      ],
    },
    width: 80,
    height: 240,
  };
}

/**
 * Hand-built fixture whose timeline mixes the verbs: X has only an `exit`
 * action, Y only a `highlight`, Z an `enter`. None of them may make this
 * renderer stamp anything — step 0 belongs to the controller.
 */
function buildNonEnterFixture(): PositionedGraph {
  return {
    direction: "TB",
    nodes: [
      { id: "X", ...labelled("ExitOnly"), x: 0, y: 0, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "Y", ...labelled("HighlightOnly"), x: 0, y: 100, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "Z", ...labelled("EntersLater"), x: 0, y: 200, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
    ],
    edges: [],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: {
      totalSteps: 2,
      entries: [
        { kind: "exit", step: 1, targetId: "X", effect: "fade" },
        { kind: "highlight", step: 2, targetId: "Y", effect: "outline" },
        { kind: "enter", step: 1, targetId: "Z", effect: "fade" },
      ],
    },
    width: 80,
    height: 240,
  };
}

/**
 * The `<marker>` one edge path points at, found by following its own
 * `marker-end` rather than by naming an id.
 *
 * No test may spell a marker id: since marker ids became scoped per render
 * (`mintIdScope` in renderToSVG.ts), the id is a freshly minted name and the
 * only durable fact about it is that the reference resolves inside this same
 * SVG.
 */
function markerFor(svg: SVGSVGElement, edgeId: string): SVGElement {
  const path = svg.querySelector(`path.siren-edge[data-siren-id="${edgeId}"]`);
  const reference = path?.getAttribute("marker-end") ?? "";
  expect(reference).toMatch(/^url\(#.+\)$/);
  const marker = svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)}`);
  expect(marker).not.toBeNull();
  return marker as SVGElement;
}

describe("renderToSVG", () => {
  it("renders one siren-node group per node and one siren-edge path per edge, each carrying data-siren-id", () => {
    const svg = renderToSVG(buildFixture());

    const nodeGroups = svg.querySelectorAll("g.siren-node");
    const edgePaths = svg.querySelectorAll("path.siren-edge");

    expect(nodeGroups).toHaveLength(3);
    expect(edgePaths).toHaveLength(2);

    expect(Array.from(nodeGroups).map((g) => g.getAttribute("data-siren-id")).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(Array.from(edgePaths).map((p) => p.getAttribute("data-siren-id")).sort()).toEqual([
      "A-B",
      "B-C",
    ]);
  });

  it("leaves step-0 pending state to the controller, stamping siren-pending on nothing whatever the timeline declares", () => {
    // The renderer draws the diagram; `createAnimationController.reset()`
    // establishes step 0, from `computeClassStateAtStep(timeline, 0)`. Held
    // here so a private "which elements start pending" copy cannot grow back
    // in this file and drift from the controller's own notion of step 0.
    expect(renderToSVG(buildFixture()).querySelectorAll(".siren-pending")).toHaveLength(0);
    expect(renderToSVG(buildNonEnterFixture()).querySelectorAll(".siren-pending")).toHaveLength(0);
  });

  it("gives every node a rect sized to width/height and a text with the node's exact label", () => {
    const svg = renderToSVG(buildFixture());

    const nodeB = svg.querySelector('g.siren-node[data-siren-id="B"]')!;
    const rect = nodeB.querySelector("rect")!;
    const text = nodeB.querySelector("text")!;

    expect(rect).not.toBeNull();
    expect(rect.getAttribute("width")).toBe("80");
    expect(rect.getAttribute("height")).toBe("40");
    expect(text).not.toBeNull();
    expect(text.textContent).toBe("Process");
  });

  it("names each node's rect siren-node-frame, so the theme paints the rect itself and not a descendant", () => {
    const svg = renderToSVG(buildFixture());

    // The class diagram already works this way (`<rect class="siren-class-frame">`
    // inside `<g class="siren-class">`), and ADR-0008 is written in those terms:
    // an author's `style` directive is emitted onto the element the theme styles,
    // so the two kinds have to name that element the same way. Without a class of
    // its own the flowchart frame is reachable only as `.siren-node rect` — an
    // anonymous descendant, which is the one shape ADR-0008's placement argument
    // tells an author not to reason about.
    const frames = Array.from(svg.querySelectorAll("g.siren-node > rect"));
    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.getAttribute("class"))).toEqual([
      "siren-node-frame",
      "siren-node-frame",
      "siren-node-frame",
    ]);

    // `data-siren-id` and the animation classes stay on the enclosing `<g>`;
    // the frame gains a class, it does not take the group's identity over.
    for (const frame of frames) {
      expect(frame.getAttribute("data-siren-id")).toBeNull();
    }
  });

  it("draws a rhombus node as a diamond path inscribed in its box, still named siren-node-frame and still carrying the author's style", () => {
    // Board 4's policy leaves no third option: a shape that parsed but drew
    // a rectangle would be a valid Mermaid document rendered into the wrong
    // picture with no diagnostic, which is the one failure mode the corpus
    // exists to keep at zero. So the diamond is drawn here, in the same
    // commit that reads it.
    //
    // A `<path>` rather than a `<rect>`, and the class stays: ADR-0008 puts
    // an author's inline declarations on the element the theme paints
    // directly, and board 3 named that element `siren-node-frame`. A frame
    // wearing a different class would silently stop taking `style A
    // fill:#f00` — the author's declaration would land nowhere and say so
    // nowhere.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("Is it ready?"),
          shape: "rhombus",
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
          parentId: null,
          interaction: null,
        },
        {
          id: "B",
          ...labelled("Done"),
          shape: "rect",
          x: 10,
          y: 200,
          width: 80,
          height: 40,
          style: { frame: [], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 260,
    };

    const svg = renderToSVG(graph);

    const groupA = svg.querySelector('g.siren-node[data-siren-id="A"]')!;
    const frameA = groupA.querySelector(".siren-node-frame")!;

    expect(frameA.tagName).toBe("path");
    // The four vertices of the diamond inscribed in `10,20 200x60`: top,
    // right, bottom, left, closed. Inscribed rather than approximated, so
    // that the box layout reserved and the outline drawn are the same
    // figure — which is what makes the fit `layoutGraph` computed true of
    // the picture rather than only of the numbers.
    expect(frameA.getAttribute("d")).toBe("M110,20 L210,50 L110,80 L10,50 Z");
    // No `x`/`y`/`width`/`height`: a `<path>` reads none of them, and
    // leaving them behind would suggest a rect is still in play.
    expect(frameA.getAttribute("x")).toBeNull();
    expect(frameA.getAttribute("width")).toBeNull();

    // The author's declaration still lands, on the element the theme paints.
    expect(frameA.getAttribute("style")).toBe("fill:#f00");

    // `data-siren-id` and the animation classes stay on the `<g>`, exactly
    // where a rect node has them, so the timeline reaches a diamond without
    // learning that shapes exist.
    expect(frameA.getAttribute("data-siren-id")).toBeNull();
    expect(groupA.getAttribute("data-siren-id")).toBe("A");

    // The label is drawn at the centre of the box, which is the centre of
    // the diamond inscribed in it.
    const textA = groupA.querySelector("text")!;
    expect(textA.textContent).toBe("Is it ready?");
    expect([textA.getAttribute("x"), textA.getAttribute("y")]).toEqual(["110", "50"]);

    // A rect node is untouched: still a `<rect>`, still sized to its box.
    const frameB = svg.querySelector('g.siren-node[data-siren-id="B"] .siren-node-frame')!;
    expect(frameB.tagName).toBe("rect");
    expect([frameB.getAttribute("width"), frameB.getAttribute("height")]).toEqual(["80", "40"]);
  });

  it("draws each path-outlined shape inscribed in its box, and makes the two parallelograms lean opposite ways and the two trapezoids too", () => {
    // The criterion this ticket exists to keep: a test that only checked
    // "a `<path>` was drawn" would pass with all four of these identical,
    // which is exactly the class of bug board 4's corpus exists to catch.
    // So the geometry is asserted, and then asserted again as a
    // *relationship* — each pair is a mirror of the other — so that a
    // future change cannot satisfy the numbers by accident.
    //
    // One box for all six, `10,20 200x60`, so the six `d` strings are
    // directly comparable by eye. `SHAPE_LEAN` puts the hexagon's end inset
    // and the flag's notch at `60/4 = 15`, and the parallelograms' slant
    // and the trapezoids' inset at `60/2 = 30`.
    const shapes = [
      "hexagon",
      "parallelogram",
      "parallelogram-alt",
      "trapezoid",
      "trapezoid-alt",
      "asymmetric",
    ] as const;
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: shapes.map((shape) => ({
        id: shape,
        ...labelled(shape),
        shape,
        x: 10,
        y: 20,
        width: 200,
        height: 60,
        style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
        parentId: null,
        interaction: null,
      })),
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 100,
    };

    const svg = renderToSVG(graph);

    const frameOf = (shape: string) =>
      svg.querySelector(`g.siren-node[data-siren-id="${shape}"] .siren-node-frame`)!;
    const dOf = (shape: string) => frameOf(shape).getAttribute("d");

    for (const shape of shapes) {
      // A `<path>`, still named `siren-node-frame`, still taking the
      // author's declaration — ADR-0008's placement is a property of the
      // frame, not of the element that happens to draw it.
      expect([shape, frameOf(shape).tagName]).toEqual([shape, "path"]);
      expect([shape, frameOf(shape).getAttribute("style")]).toEqual([shape, "fill:#f00"]);
      // No leftover rect geometry: a `<path>` reads none of it, and leaving
      // it behind would suggest a rect is still in play.
      expect([shape, frameOf(shape).getAttribute("width")]).toEqual([shape, null]);
    }

    // Inscribed in the box, corner by corner.
    expect(dOf("hexagon")).toBe("M25,20 L195,20 L210,50 L195,80 L25,80 L10,50 Z");
    expect(dOf("parallelogram")).toBe("M40,20 L210,20 L180,80 L10,80 Z");
    expect(dOf("parallelogram-alt")).toBe("M10,20 L180,20 L210,80 L40,80 Z");
    expect(dOf("trapezoid")).toBe("M40,20 L180,20 L210,80 L10,80 Z");
    expect(dOf("trapezoid-alt")).toBe("M10,20 L210,20 L180,80 L40,80 Z");
    // A rectangle with a chevron cut into its **left** edge whose apex
    // points right, at mid-height; the right edge stays flat. Measured
    // from mermaid 11.17.2 rather than recalled: `A>Flag]` is `type="odd"`,
    // drawn by `rect_left_inv_arrow`, and a real render of it produces
    // `M-31.75 -16.5 ... -23.5 0 ... -31.75 16.5 ... 23.5 16.5 ... 23.5
    // -16.5` — left corners at -31.75, the mid-left vertex indented right
    // to -23.5, the right edge flat at 23.5.
    expect(dOf("asymmetric")).toBe("M10,20 L210,20 L210,80 L10,80 L25,50 Z");

    // And now the relationships, which is what makes the four distinct
    // rather than merely four strings. Each `d` is read back into points.
    const pointsOf = (shape: string) =>
      dOf(shape)!
        .match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)!
        .map((pair) => pair.split(",").map(Number) as [number, number]);
    /** The x-range of an outline's edge at one height. */
    const edgeAt = (shape: string, y: number) => {
      const xs = pointsOf(shape)
        .filter(([, py]) => py === y)
        .map(([px]) => px)
        .sort((a, b) => a - b);
      return [xs[0], xs[xs.length - 1]] as [number, number];
    };

    // The parallelograms: one puts its top edge to the right of its bottom
    // edge, the other to the left. Stated as a shift so that "opposite" is
    // the assertion rather than two unrelated numbers.
    const shift = (shape: string) => {
      const [topLeft] = edgeAt(shape, 20);
      const [bottomLeft] = edgeAt(shape, 80);
      return topLeft - bottomLeft;
    };
    expect(shift("parallelogram")).toBeGreaterThan(0);
    expect(shift("parallelogram-alt")).toBe(-shift("parallelogram"));

    // The trapezoids: one is narrow at the top and wide at the bottom, the
    // other the reverse — and each is the other flipped, not merely
    // different from it.
    const widths = (shape: string) => {
      const [tl, tr] = edgeAt(shape, 20);
      const [bl, br] = edgeAt(shape, 80);
      return [tr - tl, br - bl] as [number, number];
    };
    const [trapTop, trapBottom] = widths("trapezoid");
    const [altTop, altBottom] = widths("trapezoid-alt");
    expect(trapTop).toBeLessThan(trapBottom);
    expect(altTop).toBeGreaterThan(altBottom);
    expect([altTop, altBottom]).toEqual([trapBottom, trapTop]);

    // The two pairs are not each other either: a parallelogram's top and
    // bottom edges are the same length, a trapezoid's are not.
    expect(widths("parallelogram")[0]).toBe(widths("parallelogram")[1]);
    expect(widths("parallelogram-alt")[0]).toBe(widths("parallelogram-alt")[1]);
  });

  it("gives a round node and a stadium a corner radius of their own, written inline so no theme token can flatten them, and leaves a rect's corners to the theme", () => {
    // **The decision this ticket exists to make.** The theme sets `rx:
    // var(--siren-node-border-radius)` on `.siren-node-frame`, so for these
    // two a shape and a documented token both want to set one property.
    //
    // The rule: *a shape named for its corners owns them; the token rounds
    // the shapes whose corners are only decoration.* A stadium's ends are
    // semicircles or it is not a stadium, and a round node that a retuned
    // token could flatten into a rectangle would have lost the one thing
    // that makes it a distinct shape — which the board's decision 1 makes
    // the compatibility contract. So the renderer writes the radius out of
    // the node's own height, and writes it as an **inline declaration**:
    // that is the level of the cascade no author stylesheet outranks
    // without `!important`, where a presentation attribute would lose to
    // the theme's own class rule (ADR-0008's argument, one property over).
    //
    // A plain rectangle gets none, which is what leaves the token reaching
    // it: nothing here overrides the theme, so `--siren-node-border-radius`
    // is still the whole story for `A[text]`.
    //
    // The numbers are `SHAPE_LEAN`'s, and deliberately the same ones layout
    // sized the box with — a stadium `60/2 = 30`, a round node `60/4 = 15`.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: (["round", "stadium", "subroutine", "rect"] as const).map((shape) => ({
        id: shape,
        ...labelled(shape),
        shape,
        x: 10,
        y: 20,
        width: 200,
        height: 60,
        style: { frame: [], text: [] },
        parentId: null,
        interaction: null,
      })),
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 100,
    };

    const svg = renderToSVG(graph);
    const frameOf = (shape: string) =>
      svg.querySelector(`g.siren-node[data-siren-id="${shape}"] .siren-node-frame`)!;

    // All four are still a `<rect>` sized to the box: these shapes differ
    // from a rectangle in their corners and their markings, not in the
    // element that draws them.
    for (const shape of ["round", "stadium", "subroutine", "rect"]) {
      expect([shape, frameOf(shape).tagName]).toEqual([shape, "rect"]);
      expect([
        shape,
        frameOf(shape).getAttribute("x"),
        frameOf(shape).getAttribute("y"),
        frameOf(shape).getAttribute("width"),
        frameOf(shape).getAttribute("height"),
      ]).toEqual([shape, "10", "20", "200", "60"]);
    }

    expect(frameOf("stadium").getAttribute("style")).toBe("rx:30px");
    expect(frameOf("round").getAttribute("style")).toBe("rx:15px");
    // Half the height exactly, or the ends are not semicircles.
    expect(Number(frameOf("stadium").getAttribute("style")!.match(/rx:(\d+)px/)![1])).toBe(60 / 2);
    // And the two are told apart: a round corner is strictly rounder than a
    // square one and strictly less round than a semicircular end, so the
    // three rect shapes are three pictures.
    const radius = (shape: string) =>
      Number((frameOf(shape).getAttribute("style") ?? "").match(/rx:(\d+(?:\.\d+)?)px/)?.[1] ?? 0);
    expect(radius("round")).toBeGreaterThan(0);
    expect(radius("round")).toBeLessThan(radius("stadium"));

    // A rectangle and a subroutine write no radius at all, so the theme's
    // token is what rounds them — the same corner a flowchart node has had
    // since before shapes existed.
    expect(frameOf("rect").getAttribute("style")).toBeNull();
    expect(frameOf("subroutine").getAttribute("style")).toBeNull();

    // Inline, not a presentation attribute. A `rx="30"` attribute loses to
    // *any* stylesheet rule, so the theme's `.siren-node-frame { rx:
    // var(--siren-node-border-radius) }` would silently flatten the stadium
    // back to 6px and nothing in the picture would say why.
    expect(frameOf("stadium").getAttribute("rx")).toBeNull();
    expect(frameOf("round").getAttribute("rx")).toBeNull();
  });

  it("writes a shaped frame's own geometry ahead of the author's declarations, so `style A` still lands and still wins", () => {
    // Two writers, one `style` attribute. The shape's radius goes first and
    // the author's declarations after, so an author who explicitly names
    // `rx` overrides the shape — the same order of authority ADR-0008 gives
    // an author over the theme — while an author who names anything else
    // gets it *in addition to* a stadium that is still a stadium.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("Stadium"),
          shape: "stadium",
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 100,
    };

    const frame = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"] .siren-node-frame')!;

    expect(frame.getAttribute("style")).toBe("rx:30px;fill:#f00");
  });

  it("draws a subroutine as its box plus an inner bar down each end, every one of them named siren-node-frame", () => {
    // The one shape here that draws more than one element, and the place a
    // second class would get invented. It is not: both bars carry
    // `siren-node-frame`, which is what makes them part of the same
    // styling story as the box — the theme strokes them with everything
    // else, and an author's `style A stroke:#00f` recolors the bars along
    // with the outline instead of leaving them behind in the old color.
    //
    // The inset is `SHAPE_LEAN.subroutine x height = 60/8 = 7.5` from each
    // end, which is the same number layout used to widen the box, so the
    // label sits between the bars rather than across one.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("Subroutine"),
          shape: "subroutine",
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          style: { frame: [{ property: "stroke", value: "#00f" }], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 100,
    };

    const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
    const frames = Array.from(group.querySelectorAll(".siren-node-frame"));

    expect(frames.map((f) => f.tagName)).toEqual(["rect", "line", "line"]);
    // The box first, so the bars are drawn over its fill rather than under
    // it.
    expect([
      frames[0].getAttribute("x"),
      frames[0].getAttribute("width"),
      frames[0].getAttribute("height"),
    ]).toEqual(["10", "200", "60"]);
    // Full height, one inset in from each end.
    expect(frames.slice(1).map((f) => [
      f.getAttribute("x1"),
      f.getAttribute("y1"),
      f.getAttribute("x2"),
      f.getAttribute("y2"),
    ])).toEqual([
      ["17.5", "20", "17.5", "80"],
      ["202.5", "20", "202.5", "80"],
    ]);

    // The author's declaration lands on all three, so the bars cannot look
    // detached from the box they mark.
    expect(frames.map((f) => f.getAttribute("style"))).toEqual([
      "stroke:#00f",
      "stroke:#00f",
      "stroke:#00f",
    ]);

    // And no class of their own: a bar the theme would have to learn about
    // separately is exactly what `theme/default.test.ts`'s coverage net
    // cannot see.
    expect(frames.map((f) => f.getAttribute("class"))).toEqual([
      "siren-node-frame",
      "siren-node-frame",
      "siren-node-frame",
    ]);
  });

  it("draws a circle as a `<circle>` inscribed in its box, with no rect geometry left behind", () => {
    // A `<circle>` rather than a `<path>` of arcs, because the element says
    // what the figure is and its `r` is the whole geometry — and rather
    // than an `<ellipse>`, because an ellipse reads `rx` and `ry` as CSS
    // geometry properties and the theme sets `rx` on `.siren-node-frame`.
    // A circle reads neither, so the token cannot deform it: ticket 03's
    // question about who owns a radius has no purchase here, which is the
    // answer rather than an omission.
    //
    // The box is square because `layoutGraph` makes it square; taking the
    // smaller of the two axes is what keeps the figure a circle rather than
    // an ellipse if one ever arrives that is not.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("Circle"),
          shape: "circle",
          x: 10,
          y: 20,
          width: 200,
          height: 200,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 240,
    };

    const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
    const frames = Array.from(group.querySelectorAll(".siren-node-frame"));

    expect(frames.map((f) => f.tagName)).toEqual(["circle"]);
    // Centred in the box, and touching all four of its edges.
    expect([
      frames[0].getAttribute("cx"),
      frames[0].getAttribute("cy"),
      frames[0].getAttribute("r"),
    ]).toEqual(["110", "120", "100"]);
    // No leftover rect geometry: a `<circle>` reads none of it, and leaving
    // it behind would suggest a rect is still in play.
    expect(frames[0].getAttribute("width")).toBeNull();
    // ADR-0008's placement, unchanged by the element under it.
    expect(frames[0].getAttribute("style")).toBe("fill:#f00");
  });

  it("draws a double circle as two concentric rings, both named siren-node-frame so an author's fill paints the whole shape", () => {
    // The same question a subroutine's inner bars asked, and the same
    // answer: a shape drawn in more than one element wears one name across
    // all of them. An author's `style A fill:#fdd` that reached the outer
    // ring and not the inner one would leave a white disc floating inside a
    // coloured circle, which is not the picture anyone asked for — and a
    // `siren-node-ring` class of its own would be a class the default theme
    // has to learn about separately, invisible to its coverage net.
    //
    // The rings differ by `SHAPE_LEAN["double-circle"] x height = 160/16 =
    // 10`, the same gap layout enlarged the box by, so the label sits
    // inside the inner ring rather than across it.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("Double"),
          shape: "double-circle",
          x: 10,
          y: 20,
          width: 160,
          height: 160,
          style: { frame: [{ property: "fill", value: "#fdd" }], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 180,
      height: 200,
    };

    const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
    const frames = Array.from(group.querySelectorAll(".siren-node-frame"));

    expect(frames.map((f) => f.tagName)).toEqual(["circle", "circle"]);
    // Concentric, and two different radii — one ring drawn twice would be
    // a plain circle with the word "double" attached to it.
    expect(frames.map((f) => [f.getAttribute("cx"), f.getAttribute("cy")])).toEqual([
      ["90", "100"],
      ["90", "100"],
    ]);
    // The outer touches the box; the inner is inset by the gap.
    expect(frames.map((f) => f.getAttribute("r"))).toEqual(["80", "70"]);

    // Both take the author's declaration, so the fill is one shape's fill
    // rather than the outer ring's.
    expect(frames.map((f) => f.getAttribute("style"))).toEqual(["fill:#fdd", "fill:#fdd"]);
    expect(frames.map((f) => f.getAttribute("class"))).toEqual([
      "siren-node-frame",
      "siren-node-frame",
    ]);
  });

  it("draws a cylinder as one path: a tube closed by arcs, with the lid drawn across its top as a second closed subpath", () => {
    // The shape board 4 measured as producing "a rectangle labelled `(DB)`
    // with no diagnostic" — the swallow the whole compatibility policy was
    // written around. What makes it a cylinder rather than that rectangle
    // is the **lid**: a full ellipse across the top, whose lower half is
    // the line an author reads as the top of a drum. A tube without it is a
    // rounded rectangle.
    //
    // One `<path>` with two closed subpaths, rather than a path and an
    // `<ellipse>`. An ellipse reads `rx`/`ry` as CSS geometry properties
    // and the theme sets `rx` on `.siren-node-frame`, so the lid would be
    // flattened to the token's 6px by a rule written about a rectangle's
    // corners — ticket 03's cascade argument, arriving at a shape whose
    // radius is not decoration but the figure itself. A `<path>` reads
    // neither property, so nothing can deform it. Both subpaths wind the
    // same way, so the default nonzero fill paints one solid drum rather
    // than cutting the lid out as a hole.
    //
    // `SHAPE_LEAN.cylinder x height = 160/8 = 20` is the lid's vertical
    // semi-axis, the same number layout made room for.
    const graph: PositionedGraph = {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("DB"),
          shape: "cylinder",
          x: 10,
          y: 20,
          width: 200,
          height: 160,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 220,
      height: 200,
    };

    const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
    const frames = Array.from(group.querySelectorAll(".siren-node-frame"));

    expect(frames.map((f) => f.tagName)).toEqual(["path"]);
    const d = frames[0].getAttribute("d")!;

    // The tube: across the top on an arc, down the right side, back across
    // the bottom on an arc, and closed up the left side. Then the lid: the
    // same ellipse drawn whole, between the same two points.
    expect(d).toBe(
      "M10,40 A100,20 0 0 1 210,40 L210,160 A100,20 0 0 1 10,160 Z " +
        "M10,40 A100,20 0 0 1 210,40 A100,20 0 0 1 10,40 Z",
    );

    // What that string means, stated as geometry so the intent survives a
    // rewrite: two closed subpaths, the top and bottom curved, and the lid
    // an ellipse as wide as the tube sitting at its top. One explicit `L`
    // and not two — the right side is drawn, and the left is the straight
    // line `Z` closes with.
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(d.match(/A/g)).toHaveLength(4);
    expect(d.match(/L/g)).toHaveLength(1);
    // Every arc has the box's half-width and the lid's semi-axis as radii,
    // so the top, the bottom and the lid are one ellipse drawn three times.
    expect([...d.matchAll(/A([\d.]+),([\d.]+)/g)].map((m) => [m[1], m[2]])).toEqual([
      ["100", "20"],
      ["100", "20"],
      ["100", "20"],
      ["100", "20"],
    ]);

    // No leftover rect geometry, and ADR-0008's placement unchanged.
    expect(frames[0].getAttribute("width")).toBeNull();
    expect(frames[0].getAttribute("style")).toBe("fill:#f00");
  });

  it("names each node's shape on its group as data, in addition to drawing it — never instead of it", () => {
    // On the `<g>`, which is the element that already *is* the node: it
    // carries `data-siren-id` and the animation classes, while the frame is
    // one of the things the node draws. A later shape draws more than one
    // frame element (a double circle draws two), and the node would then
    // have two places claiming to say what shape it is.
    //
    // The attribute is written for every node, rect included, because
    // `GraphNode.shape` is required: a reader must never have to read a
    // missing attribute as "rect".
    //
    // And it is written *as well as* drawing the diamond, never instead of
    // it. Board 4 reclassified two corpus rows on exactly that point —
    // `data-siren-block-kind` carries a sequence block's kind and the
    // keyword is still not drawn, so the picture is still wrong. An
    // attribute is not the picture.
    const graph: PositionedGraph = {
      ...buildFixture(),
      nodes: [
        {
          id: "A",
          ...labelled("Is it ready?"),
          shape: "rhombus",
          x: 0,
          y: 0,
          width: 200,
          height: 60,
          style: { frame: [], text: [] },
          parentId: null,
          interaction: null,
        },
        {
          id: "B",
          ...labelled("Done"),
          shape: "rect",
          x: 0,
          y: 100,
          width: 80,
          height: 40,
          style: { frame: [], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
    };

    const svg = renderToSVG(graph);

    expect(
      Array.from(svg.querySelectorAll("g.siren-node")).map((g) => [
        g.getAttribute("data-siren-id"),
        g.getAttribute("data-siren-shape"),
        g.querySelector(".siren-node-frame")!.tagName,
      ]),
    ).toEqual([
      ["A", "rhombus", "path"],
      ["B", "rect", "rect"],
    ]);
  });

  it("sizes the root svg to the graph's full width/height via width/height and viewBox", () => {
    const svg = renderToSVG(buildFixture());

    // Fixture: width: 80, height: 240.
    // The layout's extent plus `CANVAS_GUTTER` on every side, the
    // gutter taken into the viewBox's origin — see `sizeCanvas`.
    const g = CANVAS_GUTTER;
    expect(svg.getAttribute("width")).toBe(String(80 + g * 2));
    expect(svg.getAttribute("height")).toBe(String(240 + g * 2));
    expect(svg.getAttribute("viewBox")).toBe(`${-g} ${-g} ${80 + g * 2} ${240 + g * 2}`);
  });

  it("centers each node's text within its rect instead of leaving it at the default (0,0)", () => {
    const svg = renderToSVG(buildFixture());

    const nodeB = svg.querySelector('g.siren-node[data-siren-id="B"]')!;
    const text = nodeB.querySelector("text")!;

    // Fixture B: x=0, y=100, width=80, height=40 -> center is (40, 120).
    expect(text.getAttribute("x")).toBe("40");
    expect(text.getAttribute("y")).toBe("120");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("dominant-baseline")).toBe("middle");
  });

  it("renders a label containing markup-looking text as literal textContent, never as parsed markup", () => {
    const graph = buildFixture();
    Object.assign(graph.nodes[0]!, labelled("<script>alert(1)</script>"));

    const svg = renderToSVG(graph);

    const nodeA = svg.querySelector('g.siren-node[data-siren-id="A"]')!;
    const text = nodeA.querySelector("text")!;

    expect(text.textContent).toBe("<script>alert(1)</script>");
    expect(svg.querySelectorAll("script")).toHaveLength(0);
  });

  it("marks every edge path with an arrow marker defined in this same SVG's defs", () => {
    const svg = renderToSVG(buildFixture());

    const edgePaths = Array.from(svg.querySelectorAll("path.siren-edge"));
    expect(edgePaths.length).toBeGreaterThan(0);
    for (const path of edgePaths) {
      const reference = path.getAttribute("marker-end");
      // Not a literal id: the id is minted per render, so what has to hold is
      // that the reference resolves *here* — a reference resolving elsewhere
      // is the cross-diagram bug scoping exists to prevent.
      expect(reference).toMatch(/^url\(#.+\)$/);
      const id = reference!.slice("url(#".length, -1);
      expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
    }
  });

  it("sizes the arrow marker so its tip lands exactly on the path's endpoint, with no overshoot into the node, and stays a fixed absolute size regardless of stroke-width", () => {
    const svg = renderToSVG(buildFixture());

    const marker = markerFor(svg, "A-B");

    // markerUnits must be userSpaceOnUse, not the SVG default (strokeWidth) —
    // otherwise the marker silently doubles in size whenever an edge's
    // stroke-width increases (e.g. on highlight), which is not what "the
    // arrow tip is too big" or "pierces into the node" should ever depend
    // on.
    expect(marker.getAttribute("markerUnits")).toBe("userSpaceOnUse");

    // The tip must sit exactly at refX (the point that gets placed on the
    // path's actual endpoint) — any smaller refX means the tip overshoots
    // past the endpoint and visually pierces into the node it points at.
    const markerWidth = Number(marker.getAttribute("markerWidth"));
    const refX = Number(marker.getAttribute("refX"));
    expect(refX).toBe(markerWidth);

    // Small absolute footprint (down from the original 10x10 pierce-prone
    // marker).
    expect(markerWidth).toBeLessThanOrEqual(8);
    expect(Number(marker.getAttribute("markerHeight"))).toBeLessThanOrEqual(6);
  });

  it("gives the arrow tip a themeable class instead of relying on the SVG fill default", () => {
    const svg = renderToSVG(buildFixture());

    // The marker's arrowhead <path> had no fill/class at all, which meant
    // it silently defaulted to SVG's initial fill (black) rather than
    // tracking the edge's own color — invisible against a dark theme's
    // near-black background (reported by the user testing the dark-theme
    // toggle demo). It must carry a class the shipped theme can target,
    // the same way every other themeable part of the SVG does.
    const arrowPath = markerFor(svg, "A-B").querySelector("path")!;
    expect(arrowPath.getAttribute("class")).toBe("siren-arrow-fill");
    expect(arrowPath.getAttribute("fill")).toBeNull();
  });

  it("emits the node's resolved author styling as an inline style attribute on its frame rect, in declaration order", () => {
    // On the rect, not the enclosing <g>: the theme selects
    // `.siren-node-frame` directly, so an inline declaration there outranks
    // it without `!important`, while the same declaration on the group would
    // only ever be inherited by the frame and lose to the theme's own rule
    // (ADR-0008).
    const graph = buildFixture();
    graph.nodes[0].style = {
      frame: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ],
      text: [],
    };

    const svg = renderToSVG(graph);

    const frame = svg.querySelector('g.siren-node[data-siren-id="A"] rect.siren-node-frame')!;
    expect(frame.getAttribute("style")).toBe("fill:#fdd;stroke:#c00");
    expect(
      svg.querySelector('g.siren-node[data-siren-id="A"]')!.getAttribute("style"),
    ).toBeNull();
  });

  it("leaves an unstyled node's frame without a style attribute at all, rather than an empty one", () => {
    const svg = renderToSVG(buildFixture());

    for (const frame of Array.from(svg.querySelectorAll("rect.siren-node-frame"))) {
      expect(frame.getAttribute("style")).toBeNull();
    }
  });

  it("emits an edge's resolved author styling as an inline style attribute on its path, leaving an unstyled edge without one", () => {
    // On the path itself, because that is the element the theme's
    // `.siren-edge { stroke: ... }` paints — an inline declaration there
    // outranks it without `!important` (ADR-0008).
    const graph = buildFixture();
    graph.edges[0].style = {
      frame: [
        { property: "stroke", value: "#f00" },
        { property: "stroke-width", value: "4px" },
      ],
      text: [],
    };

    const svg = renderToSVG(graph);

    const path = (id: string) => svg.querySelector(`path.siren-edge[data-siren-id="${id}"]`)!;
    expect(path("A-B").getAttribute("style")).toBe("stroke:#f00;stroke-width:4px");
    expect(path("B-C").getAttribute("style")).toBeNull();
  });

  it("gives a styled edge an arrowhead of its own stroke color, and leaves every unstyled edge sharing the theme's marker", () => {
    // This reverses what ticket 05 pinned here. That test asserted the honest
    // consequence of one shared `<marker>` — `stroke` recolored the line and
    // left the head the theme's color — and named a marker per edge as the
    // fix a different ticket would have to make. This is that ticket:
    // Mermaid colors the whole arrow, and now so does Siren.
    //
    // A marker still does not inherit from the path referencing it; nothing
    // about SVG changed. What changed is that an edge naming a color is given
    // a marker carrying it, as an inline `fill` that outranks the theme's
    // `.siren-arrow-fill` rule without `!important`.
    const graph = buildFixture();
    graph.edges[0].style = { frame: [{ property: "stroke", value: "#f00" }], text: [] };

    const svg = renderToSVG(graph);

    expect(svg.querySelectorAll("defs marker")).toHaveLength(2);

    const styledHead = markerFor(svg, "A-B").querySelector("path")!;
    expect(styledHead.getAttribute("class")).toBe("siren-arrow-fill");
    expect(styledHead.getAttribute("style")).toBe("fill:#f00");

    const themeHead = markerFor(svg, "B-C").querySelector("path")!;
    expect(themeHead.getAttribute("class")).toBe("siren-arrow-fill");
    expect(themeHead.getAttribute("fill")).toBeNull();
    expect(themeHead.getAttribute("style")).toBeNull();

    expect(markerFor(svg, "A-B")).not.toBe(markerFor(svg, "B-C"));
  });
  it("colors the arrowhead with the `stroke` the line actually takes — the last one declared, whatever its case", () => {
    // The declarations are emitted verbatim into one inline attribute, so the
    // browser paints the line with the *last* `stroke` in the list, matching
    // case-insensitively as CSS does. An arrowhead reading the first one
    // would give a two-color arrow, which is worse than the single-color one
    // this ticket replaced.
    const graph = buildFixture();
    graph.edges[0].style = {
      frame: [
        { property: "stroke", value: "#f00" },
        { property: "stroke-width", value: "4px" },
        { property: "STROKE", value: "#00f" },
      ],
      text: [],
    };

    const svg = renderToSVG(graph);

    expect(svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!.getAttribute("style")).toBe(
      "stroke:#f00;stroke-width:4px;STROKE:#00f",
    );
    expect(markerFor(svg, "A-B").querySelector("path")!.getAttribute("style")).toBe("fill:#00f");
  });
});

/**
 * What an arrow token's decomposition draws.
 *
 * The class renderer is the template throughout: it already draws a
 * different marker at either end of a line and mints one def per endpoint
 * shape (`END_MARKER_NAME`, `buildEndpointMarker`). What is new here is the
 * *matrix* — board 3 mints an arrowhead per stroke colour so a styled edge's
 * whole arrow takes it, and an end now has a shape as well as a colour.
 */
describe("the line and the two ends an edge is drawn with", () => {
  /** One edge, drawn with the given decomposition, and nothing else in the graph. */
  function drawEdge(
    over: Partial<PositionedEdge> = {},
    edges?: PositionedEdge[],
  ): SVGSVGElement {
    const graph = buildFixture();
    const [first] = graph.edges;
    graph.edges = edges ?? [{ ...first, ...over }];
    return renderToSVG(graph);
  }

  const edgePath = (svg: SVGSVGElement, id = "A-B") =>
    svg.querySelector(`path.siren-edge[data-siren-id="${id}"]`)!;

  /** The `<marker>` a reference resolves to inside this same SVG, never by name. */
  const markerAt = (svg: SVGSVGElement, path: Element, side: "start" | "end") => {
    const reference = path.getAttribute(`marker-${side}`);
    if (reference === null) return null;
    return svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)}`);
  };

  it("draws no marker at an end the token decorates with nothing", () => {
    // `A --- B` is a line and nothing else. An open link that kept the
    // arrowhead would be the plain arrow it is written to not be.
    const svg = drawEdge({ toEnd: "none" });
    const path = edgePath(svg);

    expect(path.getAttribute("marker-end")).toBeNull();
    expect(path.getAttribute("marker-start")).toBeNull();
    expect(svg.querySelectorAll("defs marker")).toHaveLength(0);
  });

  it("draws a lone marker at the to-end only", () => {
    const svg = drawEdge({ toEnd: "circle" });
    const path = edgePath(svg);

    expect(path.getAttribute("marker-start")).toBeNull();
    expect(markerAt(svg, path, "end")).not.toBeNull();
  });

  it("draws a marker at each end of a `<-->`, and one def serves both", () => {
    // `orient="auto-start-reverse"`, the class renderer's trick: the same
    // def points outward whether it is applied as `marker-start` or
    // `marker-end`, so a two-headed edge needs one def and not two.
    const svg = drawEdge({ fromEnd: "arrow", toEnd: "arrow" });
    const path = edgePath(svg);

    expect(path.getAttribute("marker-start")).toBe(path.getAttribute("marker-end"));
    expect(svg.querySelectorAll("defs marker")).toHaveLength(1);
    expect(markerAt(svg, path, "start")!.getAttribute("orient")).toBe("auto-start-reverse");
  });

  it("draws each end's own shape: an arrow is filled, a circle is hollow, a cross is two open strokes", () => {
    // The three shapes are told apart by what they are made of, not by a
    // name: measured in mermaid 11.17.2, `arrow_circle` is `{ type:
    // "circle", fill: false }` — a stroked, unfilled ring — and its cross is
    // the two-stroke path `M 1,1 l 9,9 M 10,1 l -9,9`.
    //
    // The classes are the ones the other two renderers already use, so the
    // theme paints all three without learning a name: a filled head is
    // `siren-arrow-fill`, a hollow one `siren-arrow-hollow` (outlined in the
    // line's colour, filled with the *surface* so the line does not show
    // through its middle — the class renderer's rule) and an open one
    // `siren-arrow-stroke`.
    const shapeOf = (toEnd: PositionedEdge["toEnd"]) => {
      const svg = drawEdge({ toEnd });
      const marker = markerAt(svg, edgePath(svg), "end")!;
      const drawn = marker.firstElementChild!;
      return [drawn.tagName, drawn.getAttribute("class")];
    };

    expect([shapeOf("arrow"), shapeOf("circle"), shapeOf("cross")]).toEqual([
      ["path", "siren-arrow-fill"],
      ["circle", "siren-arrow-hollow"],
      ["path", "siren-arrow-stroke"],
    ]);
  });

  it("names a dotted and a thick line on the path, and leaves a solid one with the class every edge has", () => {
    // Three lines, three different pictures, and the difference is carried
    // by a class rather than an inline declaration — see `EDGE_LINE_CLASS`
    // for the cascade that decides. A solid line is the base rule, so it
    // gains nothing: the only class it needs is the one every edge wears.
    const classOf = (line: PositionedEdge["line"]) =>
      edgePath(drawEdge({ line })).getAttribute("class");

    expect([classOf("solid"), classOf("dotted"), classOf("thick")]).toEqual([
      "siren-edge",
      "siren-edge siren-edge-dotted",
      "siren-edge siren-edge-thick",
    ]);
  });

  it("keeps `.siren-edge` on every line, so the theme, an author style and the timeline still reach it", () => {
    // The line's own class is *added to* the name every edge has always had,
    // never substituted for it. A dotted edge that stopped being a
    // `.siren-edge` would silently lose the theme's stroke, `linkStyle`'s
    // landing place and the animation controller's target in one step.
    const svg = drawEdge({ line: "dotted" });

    expect(svg.querySelectorAll("path.siren-edge")).toHaveLength(1);
    expect(edgePath(svg).getAttribute("data-siren-id")).toBe("A-B");
  });

  it("leaves an author's own declarations to win the property they name", () => {
    // The collision this ticket had to decide: a thick line wants
    // `stroke-width` and so does `linkStyle 0 stroke-width:6px`. The
    // author's declaration is written inline and outranks any stylesheet
    // rule, so the author wins that property — and only that property: the
    // line keeps its class, so a `linkStyle 0 stroke:#f00` recolours a
    // thick edge without thinning it.
    const svg = drawEdge({
      line: "thick",
      style: { frame: [{ property: "stroke-width", value: "6px" }], text: [] },
    });

    expect(edgePath(svg).getAttribute("class")).toBe("siren-edge siren-edge-thick");
    expect(edgePath(svg).getAttribute("style")).toBe("stroke-width:6px");
  });

  it("mints one marker for one shape in one colour, however many edges draw it", () => {
    // The obvious wrong turn, and the reason this is asserted rather than
    // assumed: a matrix keyed by anything per-edge would mint a def per
    // edge, and fifty edges under one `linkStyle default` would carry fifty
    // copies of one picture.
    const base = buildFixture().edges[0];
    const svg = drawEdge({}, [
      { ...base, id: "A-B" },
      { ...base, id: "B-C" },
      { ...base, id: "C-D" },
    ]);

    expect(svg.querySelectorAll("defs marker")).toHaveLength(1);
    expect(edgePath(svg, "A-B").getAttribute("marker-end")).toBe(
      edgePath(svg, "C-D").getAttribute("marker-end"),
    );
  });

  it("mints a marker per (shape, colour) pair, and only for the pairs something draws", () => {
    // Two shapes in two colours is four *possible* markers and this
    // document draws three of them, so three is what it emits: the matrix
    // is populated by the edges, never enumerated up front.
    const base = buildFixture().edges[0];
    const red = { frame: [{ property: "stroke", value: "#f00" }], text: [] };
    const svg = drawEdge({}, [
      { ...base, id: "A-B", toEnd: "arrow" },
      { ...base, id: "B-C", toEnd: "circle" },
      { ...base, id: "C-D", toEnd: "arrow", style: red },
      // A second edge of the same pair as the one before it: same shape,
      // same colour, so it must not mint a fourth.
      { ...base, id: "D-E", toEnd: "arrow", style: red },
    ]);

    expect(svg.querySelectorAll("defs marker")).toHaveLength(3);
    expect(edgePath(svg, "C-D").getAttribute("marker-end")).toBe(
      edgePath(svg, "D-E").getAttribute("marker-end"),
    );
    expect(edgePath(svg, "A-B").getAttribute("marker-end")).not.toBe(
      edgePath(svg, "C-D").getAttribute("marker-end"),
    );
  });

  it("paints a styled edge's colour where each shape actually shows it", () => {
    // A filled head takes the colour as its `fill`; a hollow ring and an
    // open cross take it as their `stroke`. Painting a ring's fill would
    // give a filled dot in the author's colour — the wrong shape, in the
    // right colour — and painting an open cross's fill would draw nothing
    // at all.
    const colouredEnd = (toEnd: PositionedEdge["toEnd"]) => {
      const svg = drawEdge({
        toEnd,
        style: { frame: [{ property: "stroke", value: "#f00" }], text: [] },
      });
      const marker = markerAt(svg, edgePath(svg), "end")!;
      return marker.firstElementChild!.getAttribute("style");
    };

    expect([colouredEnd("arrow"), colouredEnd("circle"), colouredEnd("cross")]).toEqual([
      "fill:#f00",
      "stroke:#f00",
      "stroke:#f00",
    ]);
  });

  it("gives both ends of a two-headed styled edge the one coloured def", () => {
    const svg = drawEdge({
      fromEnd: "arrow",
      toEnd: "arrow",
      style: { frame: [{ property: "stroke", value: "#f00" }], text: [] },
    });
    const path = edgePath(svg);

    expect(svg.querySelectorAll("defs marker")).toHaveLength(1);
    expect(path.getAttribute("marker-start")).toBe(path.getAttribute("marker-end"));
  });
});

/**
 * An edge's label is drawn where layout kept space for it, in an element the
 * theme can name — the port of what `renderClassDiagramToSVG` has done with
 * a relationship's label since the class board.
 */
describe("the label drawn on an edge", () => {
  /** One edge carrying `label`, anchored where the fixture's route already runs. */
  function drawLabelled(over: Partial<PositionedEdge>): SVGSVGElement {
    const graph = buildFixture();
    const [first] = graph.edges;
    graph.edges = [{ ...first, ...over }];
    return renderToSVG(graph);
  }

  it("draws the label at the anchor layout reserved for it", () => {
    // The anchor comes from layout and is used as given — a renderer that
    // recomputed a mid-point from `points` would put the text across the
    // line rather than in the space made beside it.
    const svg = drawLabelled(placed("yes", { x: 55, y: 60 }));
    const text = svg.querySelector("text.siren-edge-label")!;

    expect(text.textContent).toBe("yes");
    expect(text.getAttribute("x")).toBe("55");
    expect(text.getAttribute("y")).toBe("60");
  });

  it("mints its own class rather than borrowing the class diagram's", () => {
    // A sibling of `.siren-relationship-label`, not the same name. Every
    // `siren-*` class in this codebase is named for the construct it draws,
    // and a *relationship* is the class diagram's construct while an *edge*
    // is the flowchart's — `.siren-edge` and `.siren-relationship-line`
    // already split that way for the connector itself. Sharing one name
    // would mean a consumer restyling class-diagram relationship labels
    // silently restyled every flowchart edge label too, which is the
    // consequence a theming contract must not have (ADR-0004).
    const svg = drawLabelled(placed("yes", { x: 55, y: 60 }));

    expect(svg.querySelectorAll(".siren-relationship-label")).toHaveLength(0);
    expect(svg.querySelectorAll(".siren-edge-label")).toHaveLength(1);
  });

  it("draws nothing at all for an edge that carries no label", () => {
    // An empty `<text>` is a paintless element the theme has to reach and a
    // node in every consumer's DOM for nothing. The class renderer already
    // returns `null` here rather than an empty element; this is that rule.
    const svg = drawLabelled({ label: null });

    expect(svg.querySelectorAll("text.siren-edge-label")).toHaveLength(0);
  });

  it("names the edge it belongs to, so the timeline moves the two together", () => {
    // A timeline target is an id, not an element (ADR-0009): `exit A-B fade`
    // has to take the label with the line it is written on, exactly as a
    // sequence participant's several drawn elements move together.
    const svg = drawLabelled(placed("yes", { x: 55, y: 60 }));

    expect(
      Array.from(svg.querySelectorAll('[data-siren-id="A-B"]')).map((el) => el.tagName),
    ).toEqual(["path", "text"]);
  });
});

/**
 * A subgraph is drawn as a labelled frame *behind* what it groups — one
 * `<g class="siren-subgraph">` holding a `<rect class="siren-subgraph-frame">`
 * and a `<text class="siren-subgraph-label">`, the shape
 * `renderClassDiagramToSVG` already gives a namespace.
 *
 * Two things about it are load-bearing rather than incidental, and both are
 * asserted here. Paint order: the frames come first in document order, so the
 * boxes they enclose are drawn *over* them rather than hidden behind them.
 * And `data-siren-id`: a subgraph is a timeline target under its generated
 * id (ADR-0010), so the frame has to carry that id or `enter subgraph:1 fade`
 * resolves in the model and moves nothing in the picture.
 */
describe("renderToSVG — a subgraph", () => {
  const framed = (subgraphs: PositionedGraph["subgraphs"]): SVGSVGElement =>
    renderToSVG({
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...labelled("Start"),
          shape: "rect",
          x: 40,
          y: 60,
          width: 80,
          height: 40,
          style: { frame: [], text: [] },
          parentId: "subgraph:1",
          interaction: null,
        },
      ],
      edges: [],
      subgraphs,
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 300,
      height: 300,
    });

  const oneFrame = [
    {
      id: "subgraph:1",
      ...placed("Ingest", { x: 90, y: 38 }),
      x: 20,
      y: 20,
      width: 140,
      height: 100,
    },
  ];

  it("draws a titled frame at the box the layout grew", () => {
    const svg = framed(oneFrame);

    const frame = svg.querySelector("g.siren-subgraph rect.siren-subgraph-frame")!;
    expect(frame).not.toBeNull();
    expect([
      frame.getAttribute("x"),
      frame.getAttribute("y"),
      frame.getAttribute("width"),
      frame.getAttribute("height"),
    ]).toEqual(["20", "20", "140", "100"]);

    const title = svg.querySelector("g.siren-subgraph text.siren-subgraph-label")!;
    expect(title.textContent).toBe("Ingest");
    // At the anchor layout reserved a strip for, not computed here from the
    // frame: the strip is what the frame was grown to hold, and a renderer
    // recomputing it would be a second opinion free to disagree.
    expect([title.getAttribute("x"), title.getAttribute("y")]).toEqual(["90", "38"]);
  });

  it("carries the id a timeline names it by", () => {
    const svg = framed(oneFrame);

    const group = svg.querySelector("g.siren-subgraph")!;
    expect(group.getAttribute("data-siren-id")).toBe("subgraph:1");
  });

  it("draws every frame before any node, so a frame never hides what it groups", () => {
    const svg = framed(oneFrame);

    const drawn = Array.from(svg.children)
      .filter((child) => child.tagName === "g")
      .map((child) => child.getAttribute("class"));
    expect(drawn).toEqual(["siren-subgraph", "siren-node"]);
  });

  it("draws nothing at all when the document declares no subgraph", () => {
    const svg = framed([]);

    expect(svg.querySelectorAll(".siren-subgraph")).toHaveLength(0);
  });
});

describe("renderToSVG's accTitle/accDescr", () => {
  it("draws accTitle as the SVG's own <title>, wiring aria-labelledby to it, with no role attribute", () => {
    const svg = renderToSVG({ ...buildFixture(), accTitle: "A short title" });

    const title = svg.querySelector("title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("A short title");
    expect(svg.getAttribute("aria-labelledby")).toBe(title!.getAttribute("id"));
    expect(svg.querySelector("desc")).toBeNull();
    expect(svg.getAttribute("aria-describedby")).toBeNull();
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("draws accDescr as the SVG's own <desc>, wiring aria-describedby to it, with no role attribute", () => {
    const svg = renderToSVG({ ...buildFixture(), accDescr: "A longer description" });

    const desc = svg.querySelector("desc");
    expect(desc).not.toBeNull();
    expect(desc!.textContent).toBe("A longer description");
    expect(svg.getAttribute("aria-describedby")).toBe(desc!.getAttribute("id"));
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.getAttribute("aria-labelledby")).toBeNull();
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("draws <title> before <desc> and wires both aria attributes when both are present", () => {
    const svg = renderToSVG({
      ...buildFixture(),
      accTitle: "A short title",
      accDescr: "A longer description",
    });

    const children = Array.from(svg.children);
    const titleIndex = children.findIndex((child) => child.tagName === "title");
    const descIndex = children.findIndex((child) => child.tagName === "desc");
    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(descIndex).toBeGreaterThan(titleIndex);
    expect(svg.getAttribute("aria-labelledby")).toBe(children[titleIndex]!.getAttribute("id"));
    expect(svg.getAttribute("aria-describedby")).toBe(children[descIndex]!.getAttribute("id"));
  });

  it("draws neither <title> nor <desc> nor any aria attribute when the document declares neither", () => {
    const svg = renderToSVG(buildFixture());

    expect(svg.querySelector("title")).toBeNull();
    expect(svg.querySelector("desc")).toBeNull();
    expect(svg.getAttribute("aria-labelledby")).toBeNull();
    expect(svg.getAttribute("aria-describedby")).toBeNull();
    expect(svg.getAttribute("role")).toBeNull();
  });
});

describe("a Markdown-labelled node's drawn text", () => {
  /** `labelled`, for a label of several rows of runs rather than one plain one. */
  function rowsLabelled(rows: LabelRun[][]) {
    const label = { text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"), rows };
    return {
      label,
      labelBox: layoutLabel(label, { measure: (t: string) => ({ width: t.length * 8, height: 20 }) }),
    };
  }

  function markdownFixture(): PositionedGraph {
    return {
      direction: "TB",
      nodes: [
        {
          id: "A",
          ...rowsLabelled([[{ ...plainRun("bold"), bold: true }], [plainRun("plain")]]),
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          shape: "rect",
          style: { frame: [], text: [] },
          parentId: null,
          interaction: null,
        },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
      width: 80,
      height: 40,
    };
  }

  it("draws one tspan.siren-label-row per line, each carrying that line's text", () => {
    const svg = renderToSVG(markdownFixture());

    const rows = svg.querySelectorAll('g.siren-node[data-siren-id="A"] text > tspan.siren-label-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toBe("bold");
    expect(rows[1]!.textContent).toBe("plain");
  });

  it("sets font-weight=bold only on a bold run, and omits it on a plain run", () => {
    const svg = renderToSVG(markdownFixture());

    const rows = svg.querySelectorAll('g.siren-node[data-siren-id="A"] text > tspan.siren-label-row');
    const boldRun = rows[0]!.querySelector("tspan")!;
    const unstyledRun = rows[1]!.querySelector("tspan")!;
    expect(boldRun.getAttribute("font-weight")).toBe("bold");
    expect(boldRun.getAttribute("font-style")).toBeNull();
    expect(unstyledRun.getAttribute("font-weight")).toBeNull();
    expect(unstyledRun.getAttribute("font-style")).toBeNull();
  });

  it("sets font-style=italic only on an italic run, and centers the block's rows around the node's own center", () => {
    const graph = markdownFixture();
    graph.nodes[0] = {
      ...graph.nodes[0],
      ...rowsLabelled([[{ ...plainRun("italic"), italic: true }], [plainRun("plain")]]),
    };

    const svg = renderToSVG(graph);

    const rows = svg.querySelectorAll('g.siren-node[data-siren-id="A"] text > tspan.siren-label-row');
    const italicRun = rows[0]!.querySelector("tspan")!;
    expect(italicRun.getAttribute("font-style")).toBe("italic");
    expect(italicRun.getAttribute("font-weight")).toBeNull();

    // node.y + node.height/2 == 20; two rows of height 20 each, spread
    // symmetrically above and below that center.
    const rowYs = Array.from(rows).map((row) => Number(row.getAttribute("y")));
    expect(rowYs[0]).toBe(10);
    expect(rowYs[1]).toBe(30);
  });

  it("draws a one-row plain label as the text's own textContent, with no row tspans", () => {
    const svg = renderToSVG(buildFixture());

    const text = svg.querySelector('g.siren-node[data-siren-id="A"] text')!;
    expect(text.textContent).toBe("Start");
    expect(text.querySelectorAll("tspan.siren-label-row")).toHaveLength(0);
  });
});

/**
 * No tag `readLabel` honors yet paints behind its text, so `drawLabel` never
 * hands back a background — but where the renderer puts one is this file's
 * contract, not the label module's, and it is fixed now so that the tickets
 * adding `<mark>` and `background-color` only have to draw. The real
 * `drawLabel` is delegated to unchanged, except that a label whose text
 * holds `▨` comes back with one `<rect class="test-background">`.
 */
vi.mock("../label/drawLabel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../label/drawLabel")>();
  return {
    ...actual,
    drawLabel: (...args: Parameters<typeof actual.drawLabel>) => {
      const drawn = actual.drawLabel(...args);
      if (!args[0].text.includes("▨")) {
        return drawn;
      }
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "test-background");
      return { ...drawn, backgrounds: [rect] };
    },
  };
});

describe("what a label paints behind its text", () => {
  /** Whether `parent` holds a test background, and it comes before `text` — document order is paint order. */
  function paintedBehind(parent: Element, text: Element | null): boolean {
    const children = Array.from(parent.children);
    const background = parent.querySelector(":scope > rect.test-background");
    return (
      background !== null &&
      text !== null &&
      text.parentElement === parent &&
      children.indexOf(background) < children.indexOf(text)
    );
  }

  it("goes into the node's group, before its text", () => {
    const graph = buildFixture();
    Object.assign(graph.nodes[0]!, labelled("▨ Start"));

    const svg = renderToSVG(graph);

    const group = svg.querySelector('g.siren-node[data-siren-id="A"]')!;
    expect(paintedBehind(group, group.querySelector(":scope > text"))).toBe(true);
  });

  it("goes before an edge's label", () => {
    const graph = buildFixture();
    const [first] = graph.edges;
    graph.edges = [{ ...first!, ...placed("▨ yes", { x: 55, y: 60 }) }];

    const svg = renderToSVG(graph);

    expect(paintedBehind(svg, svg.querySelector("text.siren-edge-label"))).toBe(true);
  });

  it("goes into a subgraph's group, before its title", () => {
    const graph = buildFixture();
    graph.subgraphs = [
      {
        id: "subgraph:1",
        ...placed("▨ Ingest", { x: 90, y: 38 }),
        x: 20,
        y: 20,
        width: 140,
        height: 100,
      },
    ];

    const svg = renderToSVG(graph);

    const group = svg.querySelector("g.siren-subgraph")!;
    expect(paintedBehind(group, group.querySelector("text.siren-subgraph-label"))).toBe(true);
  });
});

/**
 * Mermaid's layer order, which ADR-0016 adopts: `clusters → edgePaths →
 * edgeLabels → nodes` (mermaid 11.17.2, `chunk-ZAI7H55H.mjs`). SVG has no
 * z-index, so the order is the document's, and these tests read it there.
 *
 * The fixture is the case the order exists for: two labelled edges, a
 * subgraph, and nodes — enough that "every edge before every node" and
 * "every label after every edge" are each a claim about more than one
 * element, so an order that interleaves one edge's path with the next
 * edge's label cannot pass by having only one of each.
 */
describe("the order a flowchart's layers are painted in", () => {
  function layered(): SVGSVGElement {
    const graph = buildFixture();
    const [first, second] = graph.edges;
    graph.edges = [
      { ...first!, ...placed("▨ yes", { x: 55, y: 60 }) },
      { ...second!, ...placed("no", { x: 55, y: 160 }) },
    ];
    graph.subgraphs = [
      { id: "subgraph:1", ...placed("Ingest", { x: 90, y: 38 }), x: 20, y: 20, width: 140, height: 100 },
    ];
    return renderToSVG(graph);
  }

  /** Each match of `selector`, as its position in the document — which is its position in paint order. */
  function positions(svg: SVGSVGElement, selector: string): number[] {
    const all = Array.from(svg.querySelectorAll("*"));
    const found = Array.from(svg.querySelectorAll(selector)).map((el) => all.indexOf(el));
    expect(found.length).toBeGreaterThan(0);
    return found;
  }

  it("draws every edge's line above the frames and under every node", () => {
    const svg = layered();

    const edges = positions(svg, "path.siren-edge");
    expect(Math.min(...edges)).toBeGreaterThan(Math.max(...positions(svg, "g.siren-subgraph *")));
    expect(Math.max(...edges)).toBeLessThan(Math.min(...positions(svg, "g.siren-node")));
  });

  it("draws every edge label, and what it paints behind its text, above every line and under every node", () => {
    // Above *every* line, not only its own: an edge drawn after this label's
    // would otherwise run across it. That is the guarantee ADR-0016 takes
    // from Mermaid's separate `edgeLabels` layer.
    const svg = layered();

    const labels = positions(svg, "text.siren-edge-label, svg > rect.test-background");
    expect(labels).toHaveLength(3);
    expect(Math.min(...labels)).toBeGreaterThan(Math.max(...positions(svg, "path.siren-edge")));
    expect(Math.max(...labels)).toBeLessThan(Math.min(...positions(svg, "g.siren-node")));
  });
});
