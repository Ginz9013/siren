import { describe, expect, it } from "vitest";
import { renderToSVG } from "./renderToSVG";
import type { PositionedGraph } from "../contracts";

/**
 * Hand-built fixture: A -> B -> C, B pending at step 1, C pending at step 2,
 * A never mentioned in the timeline (visible from the start).
 */
function buildFixture(): PositionedGraph {
  return {
    direction: "TB",
    nodes: [
      { id: "A", label: "Start", x: 0, y: 0, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] } },
      { id: "B", label: "Process", x: 0, y: 100, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] } },
      { id: "C", label: "End", x: 0, y: 200, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] } },
    ],
    edges: [
      {
        id: "A-B",
        from: "A",
        to: "B",
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
        style: { frame: [], text: [] },
        points: [
          { x: 40, y: 120 },
          { x: 40, y: 200 },
        ],
      },
    ],
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
      { id: "X", label: "ExitOnly", x: 0, y: 0, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] } },
      { id: "Y", label: "HighlightOnly", x: 0, y: 100, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] } },
      { id: "Z", label: "EntersLater", x: 0, y: 200, width: 80, height: 40, shape: "rect", style: { frame: [], text: [] } },
    ],
    edges: [],
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
          label: "Is it ready?",
          shape: "rhombus",
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
        },
        {
          id: "B",
          label: "Done",
          shape: "rect",
          x: 10,
          y: 200,
          width: 80,
          height: 40,
          style: { frame: [], text: [] },
        },
      ],
      edges: [],
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
        label: shape,
        shape,
        x: 10,
        y: 20,
        width: 200,
        height: 60,
        style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
      })),
      edges: [],
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
        label: shape,
        shape,
        x: 10,
        y: 20,
        width: 200,
        height: 60,
        style: { frame: [], text: [] },
      })),
      edges: [],
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
          label: "Stadium",
          shape: "stadium",
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
        },
      ],
      edges: [],
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
          label: "Subroutine",
          shape: "subroutine",
          x: 10,
          y: 20,
          width: 200,
          height: 60,
          style: { frame: [{ property: "stroke", value: "#00f" }], text: [] },
        },
      ],
      edges: [],
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
          label: "Circle",
          shape: "circle",
          x: 10,
          y: 20,
          width: 200,
          height: 200,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
        },
      ],
      edges: [],
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
          label: "Double",
          shape: "double-circle",
          x: 10,
          y: 20,
          width: 160,
          height: 160,
          style: { frame: [{ property: "fill", value: "#fdd" }], text: [] },
        },
      ],
      edges: [],
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
          label: "DB",
          shape: "cylinder",
          x: 10,
          y: 20,
          width: 200,
          height: 160,
          style: { frame: [{ property: "fill", value: "#f00" }], text: [] },
        },
      ],
      edges: [],
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
          label: "Is it ready?",
          shape: "rhombus",
          x: 0,
          y: 0,
          width: 200,
          height: 60,
          style: { frame: [], text: [] },
        },
        {
          id: "B",
          label: "Done",
          shape: "rect",
          x: 0,
          y: 100,
          width: 80,
          height: 40,
          style: { frame: [], text: [] },
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
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("height")).toBe("240");
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 240");
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
    graph.nodes[0]!.label = "<script>alert(1)</script>";

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
