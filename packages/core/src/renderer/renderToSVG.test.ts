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
      { id: "A", label: "Start", x: 0, y: 0, width: 80, height: 40, style: { frame: [], text: [] } },
      { id: "B", label: "Process", x: 0, y: 100, width: 80, height: 40, style: { frame: [], text: [] } },
      { id: "C", label: "End", x: 0, y: 200, width: 80, height: 40, style: { frame: [], text: [] } },
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
      { id: "X", label: "ExitOnly", x: 0, y: 0, width: 80, height: 40, style: { frame: [], text: [] } },
      { id: "Y", label: "HighlightOnly", x: 0, y: 100, width: 80, height: 40, style: { frame: [], text: [] } },
      { id: "Z", label: "EntersLater", x: 0, y: 200, width: 80, height: 40, style: { frame: [], text: [] } },
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
