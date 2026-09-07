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
