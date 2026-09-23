/**
 * The compatibility corpus: one row per Mermaid construct, saying what Siren
 * currently does with it.
 *
 * Siren is based on Mermaid, and the condition it is held to is absolute — a
 * document that renders in Mermaid must render here. Nothing in this repo
 * failed when that stopped being true, which is how the flowchart gap reached
 * 34/39 unnoticed. This file is the instrument that notices.
 *
 * It states facts and asserts none of them: the runner, its two ratchets, and
 * the rule that a `supported` row without an `assert` is a defect all live in
 * `corpus.test.ts`.
 *
 * Growing it is every future board's job. Adding a row is adding valid
 * Mermaid, its meaning in prose, and — for anything but a `rejected` row — an
 * assert that says which picture was drawn.
 */
import type { SirenRenderResult } from "../contracts";

/** Which Mermaid diagram kind a case is written in. */
export type CompatKind = "flowchart" | "class" | "sequence" | "state";

/**
 * Where Siren stands on one Mermaid construct.
 *
 * Three states rather than two, because there are three failure modes and
 * the dangerous one is invisible to a check that only asks "were there
 * diagnostics?" — that is how this codebase's first measurement read 10/39
 * where the truth was 5/39.
 */
export type CompatStatus = "supported" | "rejected" | "silently-wrong";

/** One Mermaid construct, and what Siren currently does with it. */
export interface CompatCase {
  /** Stable id, used by the ratchet and by a ticket to say what it moved. */
  id: string;
  kind: CompatKind;
  /** Valid Mermaid. If it is not valid Mermaid, it does not belong here. */
  source: string;
  status: CompatStatus;
  /** What Mermaid means by it — prose, for the reader of a `rejected` row. */
  meaning: string;
  /**
   * Required when `status` is "supported" — a defect in the corpus when
   * absent, and a failure of the suite rather than a lint. Also required
   * when `status` is "silently-wrong", where it documents the *wrong*
   * output currently produced, so the entry is a statement of fact rather
   * than a label.
   */
  assert?: (result: SirenRenderResult) => void;
}

// ---------------------------------------------------------------------------
// Readers — what an `assert` looks at
// ---------------------------------------------------------------------------
//
// Every reader answers in strings, because an assert's whole job is to say
// what picture was drawn, and a failure that reads
// `nodes: expected ["A[DB]"], got ["A[(DB)]"]` names the bug on the spot.
// They read the rendered SVG rather than the parse tree on purpose: a silent
// mis-render is only visible in the result (see the board's test seams).

/** The rendered `<svg>`, or a thrown explanation when there was none. */
function svgOf(result: SirenRenderResult): SVGSVGElement {
  if (result.svg === null) {
    throw new Error("render() produced no <svg>");
  }
  return result.svg;
}

/**
 * Throws unless `actual` matches `expected`, naming both.
 *
 * Deliberately not vitest's `expect`: the corpus is data, and a data module
 * that imports a test framework invites the next reader to put test logic
 * in it. Comparison is by JSON text, which is exact for the string arrays
 * every reader below returns.
 */
function expectSame(what: string, actual: unknown, expected: unknown): void {
  const got = JSON.stringify(actual);
  const wanted = JSON.stringify(expected);
  if (got !== wanted) {
    throw new Error(`${what}: expected ${wanted}, got ${got}`);
  }
}

function elements(result: SirenRenderResult, selector: string): Element[] {
  return Array.from(svgOf(result).querySelectorAll(selector));
}

function idOf(element: Element): string {
  return element.getAttribute("data-siren-id") ?? "<no id>";
}

function textOf(element: Element): string {
  return element.querySelector("text")?.textContent ?? "";
}

/**
 * A Markdown-labelled node's drawn rows, read off the actual `<tspan>`
 * structure rather than off `textContent` — `textOf` above already proves
 * the *text* survived (concatenating every descendant text node, tspans
 * included), so this is what a `fc-text-*` Markdown row needs beyond that:
 * proof that each row is its own `tspan.siren-node-label-row` and that a
 * bold/italic run actually carries `font-weight`/`font-style`, not merely
 * that the letters are on the page.
 *
 * One string per row, each run's text immediately followed by `(b)`, `(i)`
 * or `(bi)` when that run carries `font-weight:bold`/`font-style:italic` —
 * nothing appended for a plain run, so a row of plain text alone reads as
 * its own text with no decoration, and a failure names the exact run that
 * disagrees rather than a diff of the whole label.
 */
function markdownRows(result: SirenRenderResult, id: string): string[] {
  const text = svgOf(result).querySelector(`g.siren-node[data-siren-id="${id}"] text`);
  if (text === null) {
    return [];
  }
  return Array.from(text.querySelectorAll("tspan.siren-node-label-row")).map((row) =>
    Array.from(row.querySelectorAll("tspan"))
      .map((run) => {
        const flags =
          (run.getAttribute("font-weight") === "bold" ? "b" : "") +
          (run.getAttribute("font-style") === "italic" ? "i" : "");
        return flags === "" ? (run.textContent ?? "") : `${run.textContent}(${flags})`;
      })
      .join(""),
  );
}

/** Every flowchart node as `id[label]`, in draw order. */
function nodes(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-node").map((g) => `${idOf(g)}[${textOf(g)}]`);
}

/** Every flowchart edge id (`A-B`), in draw order. */
function edges(result: SirenRenderResult): string[] {
  return elements(result, "path.siren-edge").map(idOf);
}

/**
 * One flowchart edge, described as the picture it draws:
 * `line from-end to-end`, e.g. `dotted none arrow` for `A -.-> B`.
 *
 * Every part is read off the drawn SVG rather than off a `data-` attribute,
 * which is the rule board 4 set when it reclassified two rows: an attribute
 * is not the picture.
 *
 * The two ends are read by **following the path's own marker reference into
 * this SVG's `<defs>` and looking at the shape inside** — never by spelling
 * a marker id, which is minted per render, and never by reading its class,
 * which says who paints it rather than what is drawn. A closed triangle, a
 * ring and two crossing strokes are three different figures, and that is
 * what is asserted.
 *
 * The line is the one part read from a class, because for a line that *is*
 * the mechanism: the renderer names `.siren-edge-dotted` / `.siren-edge-thick`
 * and the theme dashes and thickens them, which `theme/default.test.ts`
 * asserts against the resolved cascade. What this reader is for is that
 * three line styles draw three visibly different edges and that a dotted
 * edge is not quietly drawn as a solid one.
 */
function edgeDrawing(result: SirenRenderResult, id: string): string {
  const path = svgOf(result).querySelector(`path.siren-edge[data-siren-id="${id}"]`);
  if (path === null) throw new Error(`no edge "${id}" was drawn`);

  const classes = (path.getAttribute("class") ?? "").split(/\s+/);
  const line = classes.includes("siren-edge-dotted")
    ? "dotted"
    : classes.includes("siren-edge-thick")
      ? "thick"
      : "solid";

  const endAt = (side: "start" | "end"): string => {
    const reference = path.getAttribute(`marker-${side}`);
    if (reference === null) return "none";
    const marker = svgOf(result).querySelector(
      `defs > marker#${reference.slice("url(#".length, -1)}`,
    );
    if (marker === null) throw new Error(`edge "${id}" points at a marker this SVG has not got`);
    const drawn = marker.firstElementChild;
    if (drawn === null) throw new Error(`edge "${id}"'s marker draws nothing`);
    if (drawn.tagName === "circle") return "circle";
    const d = drawn.getAttribute("d") ?? "";
    // A closed outline is the arrowhead; two subpaths crossing each other
    // are the cross. Read as geometry so that reverting either drawing
    // fails this row even with every class left in place.
    if (d.includes("Z")) return "arrow";
    if ((d.match(/M/g) ?? []).length === 2) return "cross";
    throw new Error(`edge "${id}" ends in an unrecognized figure: "${d}"`);
  };

  return `${line} ${endAt("start")} ${endAt("end")}`;
}

/**
 * The text drawn on one flowchart edge, and where it was drawn.
 *
 * Read off the `<text>` in the finished SVG, not off the model: a row that
 * asked the document what the label said would pass for a renderer that
 * parsed the label and drew nothing, which is the silent mis-render this
 * instrument exists to catch. `""` when the edge draws no label at all, so
 * a swallowed label is a difference rather than a thrown error.
 */
function edgeLabel(result: SirenRenderResult, id: string): string {
  const text = svgOf(result).querySelector(`text.siren-edge-label[data-siren-id="${id}"]`);
  return text?.textContent ?? "";
}

/**
 * The inline declarations on one flowchart edge's **label**, as opposed to
 * on its line.
 *
 * Its own reader beside `edgeStyle` because the two halves of one author
 * style land on two elements, and a row that read only the line could not
 * tell "the author's `color` painted the label" from "the author's `color`
 * was dropped".
 */
function edgeLabelStyle(result: SirenRenderResult, id: string): string {
  const text = svgOf(result).querySelector(`text.siren-edge-label[data-siren-id="${id}"]`);
  if (text === null) throw new Error(`no label was drawn on edge "${id}"`);
  return text.getAttribute("style") ?? "";
}

/** Where one edge's label was drawn — the anchor layout reserved space at. */
function edgeLabelCenter(result: SirenRenderResult, id: string): { x: number; y: number } {
  const text = svgOf(result).querySelector(`text.siren-edge-label[data-siren-id="${id}"]`);
  if (text === null) throw new Error(`no label was drawn on edge "${id}"`);
  return { x: Number(text.getAttribute("x")), y: Number(text.getAttribute("y")) };
}

/**
 * The two ends of one edge's drawn path, read off the `d` attribute itself.
 *
 * Where a path *starts* and *stops* is the whole of what "this edge joins
 * these two things" means in a picture, and it is the only reader here that
 * can tell an edge that meets a frame from one that stops at a box inside
 * it. Everything between the ends is left alone on purpose: how many bends
 * the route takes is the layout engine's, not a fact about Mermaid.
 */
function edgeEnds(
  result: SirenRenderResult,
  id: string,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const path = svgOf(result).querySelector(`path.siren-edge[data-siren-id="${id}"]`);
  if (path === null) throw new Error(`no edge "${id}" was drawn`);
  const points = (path.getAttribute("d") ?? "").split(/\s+/).map((command) => {
    const [x, y] = command.slice(1).split(",");
    return { x: Number(x), y: Number(y) };
  });
  return { start: points[0], end: points[points.length - 1] };
}

/**
 * **Every** point one line is drawn through, read off a `<path>`'s own `d`.
 *
 * The reader a *self-loop* needs, and the reason it is not `edgeEnds`. A
 * loop's two ends say whether it is joined to the right figure; they say
 * nothing about which side of that figure it was drawn on, and a loop around
 * a frame and a loop buried inside one can share both ends. Only the points
 * between them tell those two pictures apart, so a row asking "is this drawn
 * outside the frame" has to see all of them.
 *
 * Takes the selector rather than assuming one, because a flowchart edge and
 * a state transition are two elements with two class names and one question.
 */
function pathPoints(
  result: SirenRenderResult,
  selector: string,
): { x: number; y: number }[] {
  const path = svgOf(result).querySelector(selector);
  if (path === null) throw new Error(`nothing matched "${selector}"`);
  return (path.getAttribute("d") ?? "")
    .split(/\s+/)
    .map((command) => command.slice(1).split(","))
    .map(([x, y]) => ({ x: Number(x), y: Number(y) }));
}

/** Every point one flowchart edge's line is drawn through. */
function edgePoints(
  result: SirenRenderResult,
  id: string,
): { x: number; y: number }[] {
  return pathPoints(result, `path.siren-edge[data-siren-id="${id}"]`);
}

/** Every point one state transition's line is drawn through. */
function transitionPath(
  result: SirenRenderResult,
  id: string,
): { x: number; y: number }[] {
  return pathPoints(
    result,
    `g.siren-transition[data-siren-id="${id}"] path.siren-transition-line`,
  );
}

/**
 * The picture's own four sides, read off the `<svg>`'s `viewBox`.
 *
 * What "it is drawn" means for anything a layout synthesises rather than
 * places: an SVG clips to its viewport, so a figure outside these four
 * numbers is not a wrong picture, it is no picture — and every reader below
 * would still find its `<path>` and report it present. A self-loop is
 * exactly that risk, because the room for one is reserved by the layout
 * engine around a node and never around a frame.
 */
function pictureBox(result: SirenRenderResult): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const [x, y, width, height] = (svgOf(result).getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  return { top: y, bottom: y + height, left: x, right: x + width };
}

/** Whether `box` holds `point`, boundary included — `insideBox`'s question, less strictly. */
function holds(
  box: { top: number; bottom: number; left: number; right: number },
  point: { x: number; y: number },
): boolean {
  const tolerance = 1e-6;
  return (
    point.x >= box.left - tolerance &&
    point.x <= box.right + tolerance &&
    point.y >= box.top - tolerance &&
    point.y <= box.bottom + tolerance
  );
}

/**
 * Whether `point` lies strictly within `box` — on the outline is not inside,
 * to the same tolerance `transitionTouches` calls a point "on" a boundary
 * with, so that the two never disagree about a point on the line.
 */
function insideBox(
  box: { top: number; bottom: number; left: number; right: number },
  point: { x: number; y: number },
): boolean {
  const tolerance = 1e-6;
  return (
    point.x > box.left + tolerance &&
    point.x < box.right - tolerance &&
    point.y > box.top + tolerance &&
    point.y < box.bottom - tolerance
  );
}

/**
 * Whether `point` sits on `box`'s own outline — within it on both axes and
 * level with one of its four sides. `transitionTouches`'s rule, over a box a
 * row already has in hand rather than over a state it names.
 */
function onBoxBoundary(
  box: { top: number; bottom: number; left: number; right: number },
  point: { x: number; y: number },
): boolean {
  const tolerance = 1e-6;
  const within =
    point.x >= box.left - tolerance &&
    point.x <= box.right + tolerance &&
    point.y >= box.top - tolerance &&
    point.y <= box.bottom + tolerance;
  const level =
    Math.abs(point.x - box.left) < tolerance ||
    Math.abs(point.x - box.right) < tolerance ||
    Math.abs(point.y - box.top) < tolerance ||
    Math.abs(point.y - box.bottom) < tolerance;
  return within && level;
}

/**
 * How far apart, along the layout's own axis, the two ends of one edge are
 * drawn — the only thing a *rank* is visible as in a rendered SVG.
 *
 * Compared between two edges of the **same document** wherever it is used,
 * never against a number: how tall one rank is belongs to the theme
 * (ADR-0004), while how many ranks apart two nodes are is the compatibility
 * contract, and only the second of those is a fact about Mermaid.
 */
function edgeSpan(result: SirenRenderResult, from: string, to: string): number {
  return Math.abs(nodeCenter(result, to).y - nodeCenter(result, from).y);
}

/**
 * The centre of one flowchart node's frame — how a direction is visible in
 * the result, the way `classBox` makes a class diagram's visible.
 *
 * The centre rather than the corner, because the two nodes of a chain rarely
 * have the same width: `A[Start]` and `B[End]` sit in one column under `TB`,
 * and only their centres say so.
 *
 * `rect.siren-node-frame` reads a rectangle, a round node, a stadium and a
 * subroutine — all four draw their box with a `<rect>`, and a subroutine's
 * two extra `<line>`s are not one. It reads **nothing** for a shape drawn
 * with a `<path>`, and throws rather than returning a wrong centre, so a
 * row that needs a diamond's position has to widen this first.
 */
function nodeCenter(result: SirenRenderResult, id: string): { x: number; y: number } {
  const { top, bottom, left, right } = nodeBox(result, id);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** One node's drawn frame as its four sides, which `nodeCenter` is the middle of. */
function nodeBox(
  result: SirenRenderResult,
  id: string,
): { top: number; bottom: number; left: number; right: number } {
  const frame = svgOf(result).querySelector(
    `g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`,
  );
  if (frame === null) throw new Error(`no node "${id}" was drawn`);
  const x = Number(frame.getAttribute("x"));
  const y = Number(frame.getAttribute("y"));
  return {
    top: y,
    bottom: y + Number(frame.getAttribute("height")),
    left: x,
    right: x + Number(frame.getAttribute("width")),
  };
}

/**
 * One subgraph frame's four sides, keyed by the **title** drawn on it.
 *
 * By the title rather than by `data-siren-id`, and that is the point of the
 * reader. A subgraph's id is generated (`subgraph:1`) precisely so that it
 * cannot be spelled by anything the author wrote; the title is what the
 * author *did* write, so it is what a row can ask about without encoding a
 * numbering rule the corpus has no business pinning.
 *
 * The frame is a `<rect>`, so this reads the same four attributes `nodeBox`
 * does — worth stating, because a shape drawn with a `<path>` reads nothing
 * there and the two readers would otherwise look interchangeable.
 */
function subgraphBox(
  result: SirenRenderResult,
  title: string,
): { top: number; bottom: number; left: number; right: number } {
  const group = elements(result, "g.siren-subgraph").find(
    (g) => g.querySelector("text.siren-subgraph-label")?.textContent === title,
  );
  const frame = group?.querySelector("rect.siren-subgraph-frame");
  if (frame === undefined || frame === null) {
    throw new Error(`no subgraph titled "${title}" was drawn`);
  }
  const x = Number(frame.getAttribute("x"));
  const y = Number(frame.getAttribute("y"));
  return {
    top: y,
    bottom: y + Number(frame.getAttribute("height")),
    left: x,
    right: x + Number(frame.getAttribute("width")),
  };
}

/** Whether `outer` wholly contains `inner` — how "it groups them" is read off a picture. */
function encloses(
  outer: { top: number; bottom: number; left: number; right: number },
  inner: { top: number; bottom: number; left: number; right: number },
): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

/**
 * One closed outline's vertices as a cycle with a canonical starting point
 * and direction, so that two paths drawing the same figure compare equal
 * however each was written. A polygon has no first vertex and no preferred
 * winding: both are the path builder's private choice, and a corpus row
 * that pinned them would fail on a rewrite that drew exactly the same
 * picture.
 */
function canonicalCycle(names: readonly string[]): string[] {
  const rotations = (list: readonly string[]): string[][] =>
    list.map((_, i) => [...list.slice(i), ...list.slice(0, i)]);
  return [...rotations(names), ...rotations([...names].reverse())].sort((a, b) =>
    a.join("|") < b.join("|") ? -1 : 1,
  )[0];
}

/**
 * Where each vertex of a `<path>` sits **inside its own bounding box**, as a
 * canonical cycle of positions: `left,top`, `right,mid`, `in-left,bottom`.
 * `in-left` is strictly between the left edge and the middle, `in-right`
 * strictly between the middle and the right edge.
 *
 * Positions rather than coordinates, because the board's decision 1 makes a
 * shape's *kind* the compatibility contract and its proportions Siren's own:
 * how far a parallelogram leans belongs to the theme, and which way it leans
 * is the shape. Coordinates would fail the day a theme changed a number
 * nobody promised, and would still pass a parallelogram leaning the wrong
 * way by the promised amount.
 */
function outlineCycle(frame: Element): string[] {
  const points = (frame.getAttribute("d") ?? "")
    .match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)
    ?.map((pair) => pair.split(",").map(Number) as [number, number]) ?? [];
  const named = positionNamer(points);
  return canonicalCycle(points.map(named));
}

/**
 * A function naming where a point sits inside the extent of `points` —
 * `left,top`, `right,mid`, `in-left,bottom` — shared by the polygon reader
 * above and the curved one below so that both say "in-left" about the same
 * place.
 */
function positionNamer(
  points: ReadonlyArray<readonly [number, number]>,
): (point: readonly [number, number]) => string {
  const position = (value: number, all: number[], low: string, high: string): string => {
    const min = Math.min(...all);
    const max = Math.max(...all);
    const middle = (min + max) / 2;
    if (value === min) return low;
    if (value === max) return high;
    if (value === middle) return "mid";
    return value < middle ? `in-${low}` : `in-${high}`;
  };
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return ([x, y]) =>
    `${position(x, xs, "left", "right")},${position(y, ys, "top", "bottom")}`;
}

/**
 * Every outline this corpus can name, keyed by the cycle of positions its
 * vertices occupy — and the vertices are **Mermaid's**, read off mermaid
 * 11.17.2's own polygons (`hexagon`, `lean_right`, `lean_left`,
 * `trapezoid`, `inv_trapezoid`, `rect_left_inv_arrow`), with
 * `scripts/mermaid-probe.mjs` saying which of them each spelling names.
 * Measured, not remembered — the rule every compatibility board here runs
 * on.
 *
 * The names say which way each shape faces, because that is the half of a
 * shape a wrong answer gets wrong: two parallelograms and two trapezoids
 * differ from their partners in nothing else, and a reader of a failure
 * message needs to be told which one was drawn rather than that "the path
 * had four points".
 */
const OUTLINE_NAMES = new Map<string, string>(
  (
    [
      ["diamond", ["mid,top", "right,mid", "mid,bottom", "left,mid"]],
      [
        "hexagon",
        [
          "in-left,bottom",
          "in-right,bottom",
          "right,mid",
          "in-right,top",
          "in-left,top",
          "left,mid",
        ],
      ],
      [
        "parallelogram leaning right",
        ["left,bottom", "in-right,bottom", "right,top", "in-left,top"],
      ],
      [
        "parallelogram leaning left",
        ["in-left,bottom", "right,bottom", "in-right,top", "left,top"],
      ],
      [
        "trapezoid narrowing to the top",
        ["left,bottom", "right,bottom", "in-right,top", "in-left,top"],
      ],
      [
        "trapezoid narrowing to the bottom",
        ["in-left,bottom", "in-right,bottom", "right,top", "left,top"],
      ],
      [
        "rectangle notched into its left edge",
        ["left,top", "in-left,mid", "left,bottom", "right,bottom", "right,top"],
      ],
    ] as ReadonlyArray<readonly [string, readonly string[]]>
  ).map(([name, cycle]) => [canonicalCycle(cycle).join(" "), name]),
);

/**
 * The outline one flowchart node actually draws, named from its **geometry**
 * — `"rectangle"`, `"diamond"`, `"parallelogram leaning right"` — or
 * spelled out vertex by vertex when the geometry names nothing this corpus
 * knows.
 *
 * Deliberately not read off `data-siren-shape`. That attribute is the node
 * saying what shape it is, and this corpus exists to check what was drawn:
 * board 4 reclassified `seq-loop` and `seq-alt-else` on exactly that point,
 * where `data-siren-block-kind` carried the kind and the keyword was still
 * absent from the picture. An assert that read the attribute would pass for
 * a rectangle labelled `Rhombus` with a note attached — which is not a
 * hypothetical: reverting one shape's drawing while leaving its attribute
 * in place is how each row using this reader was checked to bite.
 */
function nodeOutline(result: SirenRenderResult, id: string): string {
  const group = svgOf(result).querySelector(`g.siren-node[data-siren-id="${id}"]`);
  if (group === null) throw new Error(`no node "${id}" was drawn`);
  const frames = Array.from(group.querySelectorAll(".siren-node-frame"));
  if (frames.length === 0) {
    throw new Error(`node "${id}" drew nothing named siren-node-frame`);
  }
  const frame = frames[0];
  if (frame.tagName === "rect") return rectOutline(group, frame);
  if (frame.tagName === "circle") return ringOutline(frames);
  // Named rather than returned bare, because a tag name is a claim about
  // the *element* and this function's whole job is to say what was drawn.
  // `frame.tagName` used to be the answer here, which would have let a row
  // asserting "ellipse" pass without anyone deciding what an ellipse means.
  if (frame.tagName !== "path") return `an unnamed <${frame.tagName}> frame`;

  const d = frame.getAttribute("d") ?? "";
  // An arc is not a vertex, and `outlineCycle` reads coordinate pairs: an
  // arc command carries its radii before its endpoint, so a curved path
  // read as a polygon comes back as nonsense. The two readers are told
  // apart by the path data rather than by the shape's name, which is the
  // rule this whole file runs on.
  if (d.includes("A")) return curvedOutline(d);

  const cycle = outlineCycle(frame);
  return OUTLINE_NAMES.get(cycle.join(" ")) ?? `an unnamed path through ${cycle.join(" ")}`;
}

/**
 * The figure a set of `<circle>` frames draws, named by how many rings it
 * is and whether they are concentric.
 *
 * The count is the whole point. A double circle's *first* frame is a
 * `<circle>` exactly as a plain circle's is, so a reader that stopped at
 * the first element would name both "circle" — and a row asserting that
 * would pass for `A((Double))` where the author wrote `A(((Double)))`. The
 * second ring is the shape, in the same way a subroutine's bars are.
 *
 * Radii are compared only for being different, never for their sizes: how
 * far apart two rings sit belongs to the theme (the board's decision 1),
 * while *that* there are two of them is the shape.
 */
function ringOutline(frames: Element[]): string {
  const at = (frame: Element, name: string) => Number(frame.getAttribute(name));
  const centres = new Set(frames.map((f) => `${at(f, "cx")},${at(f, "cy")}`));
  const radii = frames.map((f) => at(f, "r"));
  if (frames.some((f) => f.tagName !== "circle")) {
    return `a mix of ${frames.map((f) => `<${f.tagName}>`).join(" and ")} frames`;
  }
  if (frames.length === 1) return "circle";
  if (frames.length === 2 && centres.size === 1 && new Set(radii).size === 2) {
    return "two concentric circles";
  }
  return `${frames.length} circles about ${centres.size} centres`;
}

/**
 * The figure a `<path>` containing elliptical arcs draws.
 *
 * Read as segments rather than as vertices, because for a curved outline
 * *which* edges are curved is the shape: a tube whose top and bottom were
 * straight lines is a rectangle, and its four corner points are identical
 * either way. `outlineCycle`'s position cycle cannot see that difference,
 * which is exactly why it is not asked.
 */
function curvedOutline(d: string): string {
  const subpaths = subpathsOf(d);
  const segments = subpaths.flat();
  const named = positionNamer(segments.flatMap((s) => [s.from, s.to]));
  const horizontal = (s: Segment) => s.from[1] === s.to[1] && s.from[0] !== s.to[0];
  const vertical = (s: Segment) => s.from[0] === s.to[0] && s.from[1] !== s.to[1];

  if (subpaths.length === 2) {
    const [tube, lid] = subpaths;
    const curves = tube.filter((s) => s.curved);
    const straights = tube.filter((s) => !s.curved);
    const top = [...curves].sort((a, b) => a.from[1] - b.from[1])[0];
    const lidEnds = new Set(lid.flatMap((s) => [named(s.from), named(s.to)]));
    const topEnds = new Set([named(top.from), named(top.to)]);
    if (
      tube.length === 4 &&
      curves.length === 2 &&
      curves.every(horizontal) &&
      straights.every(vertical) &&
      lid.length === 2 &&
      lid.every((s) => s.curved) &&
      lidEnds.size === topEnds.size &&
      [...lidEnds].every((end) => topEnds.has(end))
    ) {
      // Straight sides, curved top and bottom, and a second closed curve
      // drawn between the two ends of the top: the lid of a drum.
      return "tube with an elliptical top";
    }
  }

  return `an unnamed curved path: ${subpaths
    .map((subpath) =>
      subpath.map((s) => `${s.curved ? "curve" : "line"} ${named(s.from)}-${named(s.to)}`).join(", "),
    )
    .join(" / ")}`;
}

/** One drawn segment of a path: where it runs, and whether it bends. */
interface Segment {
  curved: boolean;
  from: [number, number];
  to: [number, number];
}

/**
 * A path's `d` as its closed subpaths, each a list of segments.
 *
 * Only the commands the flowchart renderer writes are read — `M`, `L`, `A`
 * and `Z`, all absolute — and an arc contributes its **endpoint**, which is
 * the last coordinate pair of its parameters rather than the first: an
 * arc's leading numbers are its radii, and reading them as a vertex is the
 * mistake that makes a curved outline unreadable.
 */
function subpathsOf(d: string): Segment[][] {
  const subpaths: Segment[][] = [];
  let current: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  for (const [, command, parameters] of d.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
    const numbers = parameters.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const end: [number, number] = [numbers[numbers.length - 2], numbers[numbers.length - 1]];
    if (command === "M") {
      subpaths.push([]);
      current = end;
      start = end;
      continue;
    }
    if (command === "Z") {
      if (current[0] !== start[0] || current[1] !== start[1]) {
        subpaths[subpaths.length - 1].push({ curved: false, from: current, to: start });
      }
      current = start;
      continue;
    }
    subpaths[subpaths.length - 1].push({ curved: command === "A", from: current, to: end });
    current = end;
  }
  return subpaths;
}

/**
 * The figure a `<rect>` frame draws, named by the two things that can make
 * one something other than a plain box: the corner radius the **renderer**
 * gave it, and any inner bars drawn alongside it.
 *
 * Three of Mermaid's node shapes are a rectangle — a round node, a stadium
 * and a subroutine box — so `"rect"`, the tag name, names none of them and
 * a row asserting it would pass for all four at once. That is precisely the
 * confusion board 4 reclassified two rows over, arriving among elements
 * rather than among attributes.
 *
 * The radius is read out of the frame's inline `style` because that is
 * where a shape that owns its corners writes it, and a shape whose corners
 * belong to `--siren-node-border-radius` writes nothing there at all — so
 * "no radius of its own" and "a radius of its own" are exactly the two
 * cases this has to tell apart. Half the height is a stadium's definition
 * and is named as such; anything between is a rounded corner and anything
 * else is reported verbatim rather than silently rounded to a name.
 *
 * Proportions are not asserted, only the kind: how round `A(Round)` is
 * belongs to the theme (the board's decision 1), while *that* it is rounder
 * than a box and less round than a pill is the shape.
 */
function rectOutline(group: Element, frame: Element): string {
  const height = Number(frame.getAttribute("height"));
  const declared = (frame.getAttribute("style") ?? "").match(/rx:\s*([\d.]+)px/);
  const radius = declared === null ? null : Number(declared[1]);
  const base =
    radius === null
      ? "rectangle"
      : radius === height / 2
        ? "rectangle with semicircular ends"
        : radius > 0 && radius < height / 2
          ? "rectangle with rounded corners"
          : `rectangle with a corner radius of ${radius} on a height of ${height}`;

  const bars = group.querySelectorAll("line.siren-node-frame").length;
  if (bars === 0) return base;
  if (bars === 2) return `${base} with an inner bar down each end`;
  return `${base} with ${bars} inner bars`;
}

/**
 * The inline `style` attribute on one node's frame, or `""` when it carries
 * none.
 *
 * **Not only the author's declarations, for two of the node shapes.** A
 * round node and a stadium own their corner radius rather than taking the
 * theme's, and the renderer writes it into this same attribute, ahead of
 * whatever the author declared — so an unstyled stadium reads back
 * `"rx:16px"` here, not `""`, and a styled one reads `"rx:16px;fill:#fdd"`.
 * There is nothing wrong with either picture; it is this reader whose name
 * is narrower than what it returns.
 *
 * Every row using it today asserts a plain `A[text]` rectangle, where the
 * renderer writes nothing and `""` still means "the author styled nothing".
 * A row that wants to assert styling on a *shaped* node should assert that
 * this string ends with the author's declarations rather than equals them:
 * the radius in front of them is a proportion the theme owns (the node
 * shapes board, decision 1), and pinning it here would fail the day a theme
 * changed a number nobody promised.
 */
function nodeStyle(result: SirenRenderResult, id: string): string {
  const frame = svgOf(result).querySelector(`g.siren-node[data-siren-id="${id}"] rect`);
  return frame?.getAttribute("style") ?? "";
}

/**
 * The inline author style on one state's drawn rectangle — its own box, or a
 * composite's frame — or `""` when the author styled it with nothing.
 *
 * `nodeStyle`'s answer for the other kind, and read the same way: the
 * attribute the browser will paint from, rather than anything upstream of
 * it. Equality rather than `endsWith` here, because a state's rect carries
 * no theme-owned inline declaration in front of the author's.
 */
function stateStyle(result: SirenRenderResult, id: string): string {
  const frame = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"] rect`);
  return frame?.getAttribute("style") ?? "";
}

/** The inline author style on one edge, or `""` when it carries none. */
function edgeStyle(result: SirenRenderResult, id: string): string {
  return svgOf(result).querySelector(`path.siren-edge[data-siren-id="${id}"]`)?.getAttribute("style") ?? "";
}

/** Every class-diagram class as `id`, in draw order. */
function classes(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-class").map(idOf);
}

/** The top-left corner of one class's frame — how a direction is visible in the result. */
function classBox(result: SirenRenderResult, id: string): { x: number; y: number } {
  const frame = svgOf(result).querySelector(
    `g.siren-class[data-siren-id="${id}"] rect.siren-class-frame`,
  );
  if (frame === null) throw new Error(`no class "${id}" was drawn`);
  return { x: Number(frame.getAttribute("x")), y: Number(frame.getAttribute("y")) };
}

/** Every member line drawn inside the class `id`, in draw order. */
function members(result: SirenRenderResult, id: string): string[] {
  const box = svgOf(result).querySelector(`g.siren-class[data-siren-id="${id}"]`);
  if (box === null) return [];
  return Array.from(box.querySelectorAll("text.siren-member")).map((t) => t.textContent ?? "");
}

/** Every class-diagram relationship as `id:type`, in draw order. */
function relationships(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-relationship").map(
    (g) => `${idOf(g)}:${g.getAttribute("data-siren-relationship") ?? "<none>"}`,
  );
}

/** Every text drawn anywhere in the diagram, in draw order. */
function texts(result: SirenRenderResult, selector: string): string[] {
  return elements(result, selector).map((t) => t.textContent ?? "");
}

/**
 * Every sequence participant as `id`, deduplicated — a surviving participant
 * is drawn in both the top and bottom rows under the same id, and a corpus
 * assert is about who is in the diagram, not how many times each is painted.
 */
function participants(result: SirenRenderResult): string[] {
  return [...new Set(elements(result, "g.siren-participant").map(idOf))];
}

/** Every sequence message as `id: label`, in draw order. */
function messages(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-message").map(
    (g) => `${idOf(g)}: ${g.querySelector("text.siren-message-label")?.textContent ?? ""}`,
  );
}

/**
 * One message's arrow as `line/head` — `solid/siren-arrow-filled`.
 *
 * The marker's id scope (`__` plus eight characters, minted per render) is
 * stripped: it is deliberately not reproducible between renders, so a corpus
 * assert that kept it would be asserting a random number.
 */
function messageArrow(result: SirenRenderResult, id: string): string {
  const path = svgOf(result).querySelector(
    `g.siren-message[data-siren-id="${id}"] path.siren-message-arrow`,
  );
  if (path === null) throw new Error(`no message "${id}" was drawn`);
  const line = path.getAttribute("stroke-dasharray") === null ? "solid" : "dotted";
  const markerEnd = path.getAttribute("marker-end");
  const head =
    markerEnd === null ? "none" : markerEnd.replace(/^url\(#(.*)__.{8}\)$/, "$1");
  return `${line}/${head}`;
}

/** Every control-flow block as `kind:id`, in draw order. */
function blocks(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-block").map(
    (g) => `${g.getAttribute("data-siren-block-kind") ?? "<none>"}:${idOf(g)}`,
  );
}

/** Every state-diagram state as `id`, in draw order. */
function states(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-state").map(idOf);
}

/**
 * The figures a state diagram can draw one state as, in the order a reader
 * of `stateFigures` sees them joined: the labelled box of an ordinary
 * state, the filled disc of a start, and the ring-plus-dot of an end.
 */
const STATE_FIGURES: readonly [selector: string, figure: string][] = [
  ["rect.siren-state-frame", "box"],
  ["rect.siren-composite-frame", "frame"],
  ["circle.siren-state-start", "disc"],
  ["circle.siren-state-end", "ring"],
  ["circle.siren-state-end-inner", "dot"],
];

/**
 * Every state as `id: figure`, in draw order — read off what is *inside*
 * each state's group.
 *
 * A pseudo-state's whole meaning is the mark it is drawn as: a row that
 * checked only the ids would pass just as happily on a start drawn as an
 * empty rectangle, which is the silent mis-render this corpus exists to
 * catch.
 */
function stateFigures(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-state").map((g) => {
    const drawn = STATE_FIGURES.filter(([selector]) => g.querySelector(selector) !== null)
      .map(([, figure]) => figure)
      .join("+");
    return `${idOf(g)}: ${drawn === "" ? "<nothing>" : drawn}`;
  });
}

/**
 * Every state-diagram transition as `id: label`, in draw order — the label
 * empty when the transition carries none, which is a picture a reader can
 * tell from one that carries an empty label only because nothing is drawn.
 */
function transitions(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-transition").map(
    (g) => `${idOf(g)}: ${g.querySelector("text.siren-transition-label")?.textContent ?? ""}`,
  );
}

/**
 * The text one state box actually draws, top to bottom.
 *
 * The reader a description row needs, because what a described state is
 * *about* is that the id stops being drawn: a row asserting only that the
 * description appears somewhere would pass on a box drawing its id and its
 * description one above the other, which is a picture Mermaid never draws.
 */
function stateRows(result: SirenRenderResult, id: string): string[] {
  const group = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"]`);
  if (group === null) throw new Error(`no state "${id}" was drawn`);
  return Array.from(group.querySelectorAll("text")).map((text) => text.textContent ?? "");
}

/**
 * The y each of one state box's rows is drawn at, in draw order, and — last
 * — the y of the divider under its title row, or `null` where it draws
 * none.
 *
 * Coordinates rather than presence, because "is there a divider?" is the
 * weaker half of the question: a line drawn above the first row or below
 * the last is still a `<line>` to find, and is the wrong picture.
 */
function stateRowGeometry(
  result: SirenRenderResult,
  id: string,
): { rowYs: number[]; dividerY: number | null } {
  const group = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"]`);
  if (group === null) throw new Error(`no state "${id}" was drawn`);
  const divider = group.querySelector("line.siren-state-divider");
  return {
    rowYs: Array.from(group.querySelectorAll("text")).map((text) =>
      Number(text.getAttribute("y")),
    ),
    dividerY: divider === null ? null : Number(divider.getAttribute("y1")),
  };
}

/**
 * One state box's centre — how a state diagram's top-to-bottom direction is
 * visible in the result rather than merely claimed.
 */
function stateCenter(result: SirenRenderResult, id: string): { x: number; y: number } {
  const frame = svgOf(result).querySelector(
    `g.siren-state[data-siren-id="${id}"] rect.siren-state-frame`,
  );
  if (frame === null) throw new Error(`no state "${id}" was drawn`);
  const number = (name: string) => Number(frame.getAttribute(name));
  return {
    x: number("x") + number("width") / 2,
    y: number("y") + number("height") / 2,
  };
}

/**
 * The rectangle one state is drawn in — a state's own box, or a composite's
 * frame. Either way the one `<rect>` in that state's group, so a row asking
 * "is this inside that?" does not have to know which figure it is asking
 * about.
 *
 * In the same edges-of-the-box shape `subgraphBox` reads a flowchart frame
 * in, so that one containment rule (`encloses`) serves both.
 */
function stateRect(
  result: SirenRenderResult,
  id: string,
): { top: number; bottom: number; left: number; right: number } {
  const rect = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"] rect`);
  if (rect === null) throw new Error(`no state "${id}" was drawn with a rectangle`);
  const number = (name: string) => Number(rect.getAttribute(name));
  return {
    top: number("y"),
    bottom: number("y") + number("height"),
    left: number("x"),
    right: number("x") + number("width"),
  };
}

/**
 * The text of the note drawn on one state, or an empty list where the state
 * carries none.
 *
 * Scoped to that state's own group on purpose: a state diagram's note has no
 * id of its own (measured — mermaid names the drawn note after its state),
 * so it is drawn *inside* the annotated state's `<g>`, and "which state is
 * this note on?" is answered by where the element lives rather than by an
 * attribute on it. A reader that searched the whole SVG would pass on a note
 * hung off the wrong state.
 */
function stateNoteText(result: SirenRenderResult, id: string): string[] {
  const group = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"]`);
  if (group === null) throw new Error(`no state "${id}" was drawn`);
  return Array.from(group.querySelectorAll("text.siren-note-text")).map(
    (text) => text.textContent ?? "",
  );
}

/** The rectangle one state's note is drawn in, in `stateRect`'s shape. */
function stateNoteRect(
  result: SirenRenderResult,
  id: string,
): { top: number; bottom: number; left: number; right: number } {
  const rect = svgOf(result).querySelector(
    `g.siren-state[data-siren-id="${id}"] rect.siren-note-frame`,
  );
  if (rect === null) throw new Error(`no note was drawn on state "${id}"`);
  const number = (name: string) => Number(rect.getAttribute(name));
  return {
    top: number("y"),
    bottom: number("y") + number("height"),
    left: number("x"),
    right: number("x") + number("width"),
  };
}

/**
 * What the connector from a state to its note ends in — `null` when it ends
 * in nothing, which is the answer mermaid gives (`arrowhead: "none"`).
 *
 * Asked as "which marker", not "is there one", so the failure names what was
 * drawn instead of saying only that something was.
 */
function stateNoteConnectorMarker(result: SirenRenderResult, id: string): string | null {
  const path = svgOf(result).querySelector(
    `g.siren-state[data-siren-id="${id}"] path.siren-note-link`,
  );
  if (path === null) throw new Error(`no note connector was drawn on state "${id}"`);
  return path.getAttribute("marker-end");
}

/** Whether two rectangles share any area — "these are two figures, not one". */
function overlaps(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** One state's centre, for a row reading a direction off the picture. */
function stateRectCenter(
  result: SirenRenderResult,
  id: string,
): { x: number; y: number } {
  const box = stateRect(result, id);
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

/**
 * Whether one end of a transition's drawn line sits on the boundary of the
 * rectangle drawn for `id` — on it, neither inside nor short of it.
 *
 * The question an edge naming a composite raises. The layout engine cannot
 * route to a frame, so the route is taken through a member of it and clipped
 * back; a row asking only "was a path drawn?" would pass on an arrowhead
 * buried inside the frame, pointing at that stand-in.
 */
function transitionTouches(
  result: SirenRenderResult,
  transitionId: string,
  end: "start" | "end",
  stateId: string,
): boolean {
  const path = svgOf(result).querySelector(
    `g.siren-transition[data-siren-id="${transitionId}"] path.siren-transition-line`,
  );
  if (path === null) throw new Error(`no transition "${transitionId}" was drawn`);
  const points = (path.getAttribute("d") ?? "")
    .split(" ")
    .map((step) => step.slice(1).split(","))
    .map(([x, y]) => ({ x: Number(x), y: Number(y) }));
  const point = end === "start" ? points[0] : points[points.length - 1];

  const box = stateRect(result, stateId);
  const tolerance = 1e-6;
  const within =
    point.x >= box.left - tolerance &&
    point.x <= box.right + tolerance &&
    point.y >= box.top - tolerance &&
    point.y <= box.bottom + tolerance;
  const onAnEdge =
    Math.abs(point.x - box.left) < tolerance ||
    Math.abs(point.x - box.right) < tolerance ||
    Math.abs(point.y - box.top) < tolerance ||
    Math.abs(point.y - box.bottom) < tolerance;
  return within && onAnEdge;
}

/**
 * The distinct coordinates one transition's line is drawn through, read off
 * the `<path>`'s own `d`.
 *
 * Distinct, because the question a self-loop raises is whether a *loop* was
 * drawn: a route that collapsed onto a single point still leaves a `<path>`
 * in the SVG to find, and draws nothing at all.
 */
function transitionPoints(result: SirenRenderResult, id: string): string[] {
  const path = svgOf(result).querySelector(
    `g.siren-transition[data-siren-id="${id}"] path.siren-transition-line`,
  );
  if (path === null) throw new Error(`no transition "${id}" was drawn`);
  return [...new Set((path.getAttribute("d") ?? "").split(" "))];
}

/** Whether the diagram drew anything at all under `selector`. */
function drew(result: SirenRenderResult, selector: string): boolean {
  return elements(result, selector).length > 0;
}

/**
 * Every measured case: valid Mermaid on the left, what Siren does with it on
 * the right.
 *
 * Seeded from `.dev/mermaid-compatibility-gaps.md` and then **re-measured**
 * through `render()`, because that document is the record of one probe
 * rather than an authority.
 */
export const COMPAT_CASES: readonly CompatCase[] = [
  // -------------------------------------------------------------------------
  // flowchart — header
  // -------------------------------------------------------------------------
  {
    id: "fc-header-flowchart-tb",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] --> B[End]`,
    status: "supported",
    meaning: "`flowchart TB` opens a top-to-bottom flowchart.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  {
    id: "fc-header-flowchart-td",
    kind: "flowchart",
    source: `flowchart TD
      A[Start] --> B[End]`,
    status: "supported",
    meaning: "`TD` is Mermaid's alias for `TB`, not a fifth direction.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  {
    id: "fc-header-graph-tb",
    kind: "flowchart",
    source: `graph TB
      A[Start] --> B[End]`,
    status: "supported",
    meaning: "`graph` is Mermaid's older spelling of `flowchart`, and still valid.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
      // The direction the header named, read off the picture: `TB` puts the
      // target below its source. Asserting the nodes alone would pass for a
      // document whose header word was accepted and whose direction was not.
      const from = nodeCenter(result, "A");
      const to = nodeCenter(result, "B");
      expectSame("B is drawn below A", to.y > from.y, true);
      expectSame("and in the same column", to.x === from.x, true);
    },
  },
  {
    id: "fc-header-graph-lr",
    kind: "flowchart",
    source: `graph LR
      A[Start] --> B[End]`,
    status: "supported",
    meaning: "`graph LR` opens a left-to-right flowchart.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
      // `LR` lays the same two nodes out as a row, which is what separates
      // this entry from the one above: both headers parse, and only the
      // geometry says the direction survived the alias.
      const from = nodeCenter(result, "A");
      const to = nodeCenter(result, "B");
      expectSame("B is drawn to the right of A", to.x > from.x, true);
      expectSame("and in the same row", to.y === from.y, true);
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — node shapes
  // -------------------------------------------------------------------------
  {
    id: "fc-shape-round",
    kind: "flowchart",
    source: `flowchart TB
      A(Round)`,
    status: "supported",
    meaning: "`A(text)` is a rounded rectangle labelled `text`.",
    assert: (result) => {
      // The parentheses are syntax, so they are no more part of the label
      // than the brackets of `A[text]` are.
      expectSame("nodes", nodes(result), ["A[Round]"]);
      // The picture, not the claim. A rectangle is still a rectangle here,
      // so what separates the two is the corner the *renderer* gave it —
      // read off the frame rather than off `data-siren-shape`, which would
      // pass for a plain box with the word "round" attached.
      expectSame("outline", nodeOutline(result, "A"), "rectangle with rounded corners");
    },
  },
  {
    id: "fc-shape-stadium",
    kind: "flowchart",
    source: `flowchart TB
      A([Stadium])`,
    status: "supported",
    meaning: "`A([text])` is a stadium — a pill — labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Stadium]"]);
      // Semicircular, not merely rounded: the radius is exactly half the
      // height, which is the whole difference between this row and the one
      // above and the one thing a stadium cannot be without.
      expectSame("outline", nodeOutline(result, "A"), "rectangle with semicircular ends");
    },
  },
  {
    id: "fc-shape-subroutine",
    kind: "flowchart",
    source: `flowchart TB
      A[[Subroutine]]`,
    status: "supported",
    meaning: "`A[[text]]` is a subroutine box labelled `text`.",
    assert: (result) => {
      // Both brackets are syntax. A reader that took only the outer pair
      // would draw a rectangle labelled `[Subroutine]`, which is the
      // swallow this row spent four boards being refused to prevent.
      expectSame("nodes", nodes(result), ["A[Subroutine]"]);
      // The bars are the shape. Without them it is a rectangle, whatever
      // the attribute says.
      expectSame("outline", nodeOutline(result, "A"), "rectangle with an inner bar down each end");
    },
  },
  {
    id: "fc-shape-circle",
    kind: "flowchart",
    source: `flowchart TB
      A((Circle))`,
    status: "supported",
    meaning: "`A((text))` is a circle labelled `text`.",
    assert: (result) => {
      // Both pairs of parentheses are syntax. A reader that took only the
      // outer pair would draw a round node labelled `(Circle)`, which is
      // the swallow this row spent four boards being refused to prevent.
      expectSame("nodes", nodes(result), ["A[Circle]"]);
      // The picture, not the claim: a figure with no corners at all,
      // rather than a box with the word "circle" in an attribute.
      expectSame("outline", nodeOutline(result, "A"), "circle");
    },
  },
  {
    id: "fc-shape-asymmetric",
    kind: "flowchart",
    source: `flowchart TB
      A>Asymmetric]`,
    status: "supported",
    meaning: "`A>text]` is an asymmetric flag shape labelled `text`.",
    assert: (result) => {
      // The `>` is syntax, so it is no more part of the label than the
      // brackets of `A[text]` are — and it is the one spelling here with no
      // opening bracket at all.
      expectSame("nodes", nodes(result), ["A[Asymmetric]"]);
      // Which way the flag faces is the whole of this shape, and it is
      // measured rather than recalled: mermaid 11.17.2 reads this as
      // `type="odd"` and draws it with `rect_left_inv_arrow`, whose two
      // left corners sit further left than the mid-height vertex between
      // them — a notch cut into the left edge, pointing right, which is the
      // `>` of the spelling drawn.
      expectSame("outline", nodeOutline(result, "A"), "rectangle notched into its left edge");
    },
  },
  {
    id: "fc-shape-rhombus",
    kind: "flowchart",
    source: `flowchart TB
      A{Rhombus}`,
    status: "supported",
    meaning: "`A{text}` is a decision rhombus labelled `text`.",
    assert: (result) => {
      // The braces are syntax, so they are no more part of the label than
      // the brackets of `A[text]` are.
      expectSame("nodes", nodes(result), ["A[Rhombus]"]);
      // And the picture, not the claim: a diamond is drawn, rather than a
      // rectangle with the shape written on it in an attribute.
      expectSame("outline", nodeOutline(result, "A"), "diamond");
    },
  },
  {
    id: "fc-shape-hexagon",
    kind: "flowchart",
    source: `flowchart TB
      A{{Hexagon}}`,
    status: "supported",
    meaning: "`A{{text}}` is a hexagon labelled `text`.",
    assert: (result) => {
      // Both braces are syntax. A reader that took only the outer pair
      // would draw a diamond labelled `{Hexagon}`, which is the swallow
      // this row spent four boards being refused to prevent.
      expectSame("nodes", nodes(result), ["A[Hexagon]"]);
      expectSame("outline", nodeOutline(result, "A"), "hexagon");
    },
  },
  {
    id: "fc-shape-double-circle",
    kind: "flowchart",
    source: `flowchart TB
      A(((Double)))`,
    status: "supported",
    meaning: "`A(((text)))` is a double circle labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Double]"]);
      // Two rings, and the second one is the whole shape: a row asserting
      // "circle" would pass for `A((Double))`, which is a different
      // spelling of a different figure.
      expectSame("outline", nodeOutline(result, "A"), "two concentric circles");
    },
  },
  {
    id: "fc-shape-cylinder",
    kind: "flowchart",
    source: `flowchart TB
      A[(DB)]`,
    status: "supported",
    meaning: "`A[(text)]` is a cylinder labelled `text` — the label carries no parentheses.",
    assert: (result) => {
      // **The row this whole instrument was built around.** Board 4
      // measured this document as drawing a rectangle labelled `(DB)` with
      // no diagnostic — a valid Mermaid document rendered as a different
      // picture, silently — and refused the spelling to make the gap
      // honest. The parentheses are syntax, so the label is `DB`.
      expectSame("nodes", nodes(result), ["A[DB]"]);
      // And the lid is what a rectangle cannot fake: an ellipse drawn
      // across the top of the tube, which is the line an author reads as a
      // drum. Without it this is a rounded rectangle again.
      expectSame("outline", nodeOutline(result, "A"), "tube with an elliptical top");
    },
  },
  {
    id: "fc-shape-parallelogram",
    kind: "flowchart",
    source: `flowchart TB
      A[/Process/]`,
    status: "supported",
    meaning: "`A[/text/]` is a parallelogram labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Process]"]);
      // Mermaid calls this one `lean_right` and draws its top edge to the
      // right of its bottom edge. Leaning is the only thing that separates
      // it from the row below, so a row that asserted "a path of four
      // points" would pass for its own mirror image.
      expectSame("outline", nodeOutline(result, "A"), "parallelogram leaning right");
    },
  },
  {
    id: "fc-shape-parallelogram-alt",
    kind: "flowchart",
    source: `flowchart TB
      A[\\Process\\]`,
    status: "supported",
    meaning: "`A[\\text\\]` is a parallelogram leaning the other way, labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Process]"]);
      // `lean_left`: the mirror of the row above, and the reason Mermaid
      // has two spellings at all.
      expectSame("outline", nodeOutline(result, "A"), "parallelogram leaning left");
    },
  },
  {
    id: "fc-shape-trapezoid",
    kind: "flowchart",
    source: `flowchart TB
      A[/Trapezoid\\]`,
    status: "supported",
    meaning: "`A[/text\\]` is a trapezoid labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Trapezoid]"]);
      // The two leaning characters lean the way the two sloping sides do:
      // narrow top, wide bottom.
      expectSame("outline", nodeOutline(result, "A"), "trapezoid narrowing to the top");
    },
  },
  {
    id: "fc-shape-trapezoid-alt",
    kind: "flowchart",
    source: `flowchart TB
      A[\\Trapezoid/]`,
    status: "supported",
    meaning: "`A[\\text/]` is an inverted trapezoid labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Trapezoid]"]);
      // Mermaid's `inv_trapezoid`: wide top, narrow bottom — the row above
      // turned over.
      expectSame("outline", nodeOutline(result, "A"), "trapezoid narrowing to the bottom");
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — node ids
  // -------------------------------------------------------------------------
  {
    id: "fc-node-id-dot",
    kind: "flowchart",
    source: `flowchart TB
      a.b --> c`,
    status: "supported",
    meaning:
      "A node id may contain a `.`. mermaid 11.17.2 records `a.b --> c` as " +
      "the vertices `a.b` and `c` joined by `L_a.b_c_0`, and `a.-b --> c` " +
      "as the vertices `a.-b` and `c` joined by `L_a.-b_c_0` — one node " +
      "either way, with the dot inside its name " +
      "(`node scripts/mermaid-probe.mjs`). **A node-id gap, not an arrow " +
      "one**: the dotted arrow spellings beside it were already supported, " +
      "and the guard that keeps `a.-b` from being cut at its `.-` is what " +
      "leaves the text for the widened id alphabet (`ID_RUN` in " +
      "`parseFlowchart.ts`) to read whole, rather than a chain of three " +
      "nodes Mermaid never drew. The sharper case was a line that declares " +
      "nothing else: in `flowchart TB / A --> B / C.-D` Mermaid draws A, B " +
      "and a third node `C.-D`, and Siren used to refuse the *whole " +
      "document* over that third line — a picture Mermaid renders becoming " +
      "no picture at all — which `parseFlowchart.test.ts`'s \"declares a " +
      "bare id whose \\`.-\\` looks like a dotted-arrow opener\" test now " +
      "pins directly. Widening the id alphabet reached every endpoint " +
      "reader, the `:::` shorthand and the `style`/`class` directives' " +
      "target lists.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["a.b[a.b]", "c[c]"]);
      expectSame("edges", edges(result), ["a.b-c"]);
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — edges
  // -------------------------------------------------------------------------
  {
    id: "fc-edge-open",
    kind: "flowchart",
    source: `flowchart TB
      A --- B`,
    status: "supported",
    meaning: "`A --- B` is an open link: a line with no arrowhead.",
    assert: (result) => {
      expectSame("edges", edges(result), ["A-B"]);
      // No marker at either end, which is the whole of what `---` says. An
      // open link that kept the arrowhead would be the `-->` it is written
      // to not be, and nothing but the ends tells them apart.
      expectSame("edge", edgeDrawing(result, "A-B"), "solid none none");
    },
  },
  {
    id: "fc-edge-dotted",
    kind: "flowchart",
    source: `flowchart TB
      A -.-> B`,
    status: "supported",
    meaning: "`A -.-> B` is a dotted arrow.",
    assert: (result) => {
      expectSame("edge", edgeDrawing(result, "A-B"), "dotted none arrow");
    },
  },
  {
    id: "fc-edge-dotted-open",
    kind: "flowchart",
    source: `flowchart TB
      A -.- B`,
    status: "supported",
    meaning: "`A -.- B` is a dotted line with no arrowhead.",
    assert: (result) => {
      // The row that proves the two axes are independent rather than a list
      // of names: Mermaid does tell `-.-` from `-.->` (`arrow_open` versus
      // `arrow_point`, both `stroke="dotted"`, measured), and so must this.
      expectSame("edge", edgeDrawing(result, "A-B"), "dotted none none");
    },
  },
  {
    id: "fc-edge-dotted-short",
    kind: "flowchart",
    source: `flowchart TB
      A .-> B
      B .- C
      C -. yes .-> D`,
    status: "supported",
    meaning:
      "A dotted arrow may be written without its leading dash, and its " +
      "short body closes an inline label as the long one does: mermaid " +
      "11.17.2 reads `A .-> B` as `type=\"arrow_point\" stroke=\"dotted\" " +
      "length=1`, `A .- B` as the `arrow_open` of the same, and " +
      "`A -. yes .-> B` as that arrow labelled `yes` " +
      "(`node scripts/mermaid-probe.mjs`).",
    assert: (result) => {
      expectSame("edges", edges(result), ["A-B", "B-C", "C-D"]);
      // The **drawn** line and ends, not "it parsed". The short spelling
      // has to arrive at the very picture the long one does — the two rows
      // above — or it is a spelling this parser accepts and then draws as
      // something else, which is worse than the rejection it replaced.
      expectSame("edge", edgeDrawing(result, "A-B"), "dotted none arrow");
      expectSame("edge", edgeDrawing(result, "B-C"), "dotted none none");
      expectSame("edge", edgeDrawing(result, "C-D"), "dotted none arrow");
      expectSame("label", edgeLabel(result, "C-D"), "yes");
    },
  },
  {
    id: "fc-edge-thick",
    kind: "flowchart",
    source: `flowchart TB
      A ==> B`,
    status: "supported",
    meaning: "`A ==> B` is a thick arrow.",
    assert: (result) => {
      expectSame("edge", edgeDrawing(result, "A-B"), "thick none arrow");
    },
  },
  {
    id: "fc-edge-thick-open",
    kind: "flowchart",
    source: `flowchart TB
      A === B`,
    status: "supported",
    meaning: "`A === B` is a thick line with no arrowhead.",
    assert: (result) => {
      expectSame("edge", edgeDrawing(result, "A-B"), "thick none none");
    },
  },
  {
    id: "fc-edge-circle-end",
    kind: "flowchart",
    source: `flowchart TB
      A --o B`,
    status: "supported",
    meaning: "`A --o B` ends in a circle rather than an arrowhead.",
    assert: (result) => {
      // At the **to**-end, measured rather than recalled: mermaid 11.17.2
      // reads this as `arrow_circle` and turns it into
      // `arrowTypeStart: "none", arrowTypeEnd: "arrow_circle"`. A row that
      // only asserted "a circle somewhere" would pass for its mirror image.
      expectSame("edge", edgeDrawing(result, "A-B"), "solid none circle");
    },
  },
  {
    id: "fc-edge-cross-end",
    kind: "flowchart",
    source: `flowchart TB
      A --x B`,
    status: "supported",
    meaning: "`A --x B` ends in a cross.",
    assert: (result) => {
      expectSame("edge", edgeDrawing(result, "A-B"), "solid none cross");
    },
  },
  {
    id: "fc-edge-bidirectional",
    kind: "flowchart",
    source: `flowchart TB
      A <--> B`,
    status: "supported",
    meaning: "`A <--> B` carries an arrowhead at both ends.",
    assert: (result) => {
      expectSame("edge", edgeDrawing(result, "A-B"), "solid arrow arrow");
    },
  },
  {
    id: "fc-edge-long",
    kind: "flowchart",
    // Two chains in one document, which is what makes the claim assertable
    // at all: a long arrow's meaning is *comparative* — further apart than
    // a plain one — and an assert sees one render. Both chains are here so
    // the comparison is between two edges of one picture, with no number
    // from outside it.
    source: `flowchart TB
      A --> B
      C ----> D`,
    status: "supported",
    meaning: "A longer arrow spans more ranks; `A ----> B` still means A to B.",
    assert: (result) => {
      // Still one edge from A to B: a long arrow is not a chain through
      // invisible nodes, and nothing new is declared by writing one.
      expectSame("edges", edges(result), ["A-B", "C-D"]);
      expectSame("edge", edgeDrawing(result, "C-D"), "solid none arrow");
      // The rank distance, which is the only part of an arrow token that is
      // not about drawing. Mermaid hands its parsed `length` to dagre as
      // `minlen` (measured: `length=3` for `---->`, `length=1` for `-->`),
      // so the target sits further down the rank order and the drawn
      // diagram differs. Drawing both alike would be a silent mis-render by
      // this instrument's own definition.
      const plain = edgeSpan(result, "A", "B");
      const long = edgeSpan(result, "C", "D");
      if (!(long > plain)) {
        throw new Error(`a long arrow spans ${long}, no more than a plain one's ${plain}`);
      }
    },
  },
  {
    id: "fc-edge-pipe-label",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] -->|yes| B[End]`,
    status: "supported",
    meaning: "`A -->|text| B` labels the edge `text`.",
    assert: (result) => {
      // Drawn, not merely parsed: the text is read off the SVG.
      expectSame("label", edgeLabel(result, "A-B"), "yes");
      // A label decorates an arrow rather than replacing one, so every axis
      // of the token is untouched — measured, mermaid 11.17.2 records
      // `type="arrow_point" stroke="normal" length=1` for this line.
      expectSame("edge", edgeDrawing(result, "A-B"), "solid none arrow");
      // And the space is real, asserted as the drawn text landing **clear
      // of both boxes**. Not as a comparison against an unlabelled edge in
      // the same document, which is the shape `fc-edge-long` uses and which
      // does not work here: ranks belong to the whole graph, so a second
      // unlabelled chain is pushed apart by this label too and the two
      // spans come out equal. What is left, and what the reader of a
      // picture would check, is that the label sits in a gap rather than
      // over an endpoint — which it can only do if layout kept one.
      const label = edgeLabelCenter(result, "A-B");
      if (!(label.y > nodeBox(result, "A").bottom && label.y < nodeBox(result, "B").top)) {
        throw new Error(
          `the label is drawn at y=${label.y}, not between A (ends ${nodeBox(result, "A").bottom}) and B (starts ${nodeBox(result, "B").top})`,
        );
      }
    },
  },
  {
    id: "fc-edge-inline-label",
    kind: "flowchart",
    source: `flowchart TB
      A -- yes --> B`,
    status: "supported",
    meaning: "`A -- text --> B` is the other spelling of an edge label.",
    assert: (result) => {
      // The same label on the same edge as the row above, drawn the same
      // way — which is the whole content of "the other spelling". Measured:
      // mermaid 11.17.2 records `text="yes"` on an `arrow_point`/`normal`/
      // `length=1` edge for both, and its database keeps no trace of which
      // one it read.
      expectSame("label", edgeLabel(result, "A-B"), "yes");
      expectSame("edge", edgeDrawing(result, "A-B"), "solid none arrow");
      // Not a node called `yes`, which is what Mermaid itself does with
      // `A ---- yes --> B` (measured) and what a splitter that took the
      // opener for an arrow would do here.
      expectSame("nodes", nodes(result), ["A[A]", "B[B]"]);
    },
  },
  {
    id: "fc-edge-chained",
    kind: "flowchart",
    source: `flowchart TB
      A --> B --> C`,
    status: "supported",
    meaning: "A chain declares both edges: A to B and B to C.",
    assert: (result) => {
      // The ids, not the count: `timeline:` and `linkStyle` both address an
      // edge as `${from}-${to}`, so two edges named wrong is a different
      // picture from two edges named right.
      expectSame("nodes", nodes(result), ["A[A]", "B[B]", "C[C]"]);
      expectSame("edges", edges(result), ["A-B", "B-C"]);
    },
  },
  {
    id: "fc-self-edge",
    kind: "flowchart",
    source: `flowchart TB
      A --> A`,
    status: "supported",
    meaning:
      "A node may name itself at both ends of an edge: `A --> A` is one " +
      "node with a loop returning to it. The loop is drawn **joined to that " +
      "node** — an arrow onto itself that does not touch itself is not the " +
      "construct. Siren synthesises the geometry (`selfLoopAroundBox`) " +
      "because the layout engine's own answer for a self-edge touches " +
      "nothing: measured against `@dagrejs/dagre@3.1.1`, a 24x32 box at " +
      "x 0..24 comes back with its loop routed at x 52..76, clear of the " +
      "node and past the graph width it reports (74). Mermaid does not use " +
      "that route either — mermaid 11.17.2 computes the loop in closed form " +
      "from the node's own box instead (`getSelfLoopPoints`, reached from " +
      "`prepareLayoutForDagre`'s `edge.start === edge.end` branch), with " +
      "both ends on the side of the box and a bounded bulge past it.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]"]);
      expectSame("edges", edges(result), ["A-A"]);

      const box = nodeBox(result, "A");
      const loop = edgePoints(result, "A-A");
      expectSame(
        `the loop is drawn through more than one point (got ${JSON.stringify(loop)})`,
        loop.length > 1,
        true,
      );
      expectSame(
        `the loop starts on the node's own outline (at ${JSON.stringify(loop[0])}, node ${JSON.stringify(box)})`,
        onBoxBoundary(box, loop[0]),
        true,
      );
      expectSame(
        `and ends on it (at ${JSON.stringify(loop[loop.length - 1])})`,
        onBoxBoundary(box, loop[loop.length - 1]),
        true,
      );
      // Beside the node rather than across it, and inside the picture: an
      // SVG clips to its viewport, so a loop drawn outside the `viewBox`
      // leaves a `<path>` here and nothing on screen.
      expectSame(
        "no point of the loop is inside the node's own box",
        loop.filter((point) => insideBox(box, point)),
        [],
      );
      expectSame(
        `the whole loop is inside the picture ${JSON.stringify(pictureBox(result))}`,
        loop.filter((point) => !holds(pictureBox(result), point)),
        [],
      );
    },
  },
  {
    id: "fc-self-edge-lr",
    kind: "flowchart",
    source: `flowchart LR
      A --> A`,
    status: "supported",
    meaning:
      "The same loop under `LR`. Its own row because the engine reserves " +
      "the room for a self-edge on its *order* axis, which turns with the " +
      "rank direction — measured through this module's layout seam, a " +
      "three-node chain carrying one self-edge reports 90 wide instead of " +
      "40 under `TB` and 60 tall instead of 20 under `LR` — so a loop that " +
      "is attached and inside the picture in one direction proves nothing " +
      "about the other.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]"]);
      expectSame("edges", edges(result), ["A-A"]);

      const box = nodeBox(result, "A");
      const loop = edgePoints(result, "A-A");
      expectSame(
        `the loop starts on the node's own outline (at ${JSON.stringify(loop[0])}, node ${JSON.stringify(box)})`,
        onBoxBoundary(box, loop[0]),
        true,
      );
      expectSame(
        `and ends on it (at ${JSON.stringify(loop[loop.length - 1])})`,
        onBoxBoundary(box, loop[loop.length - 1]),
        true,
      );
      expectSame(
        "no point of the loop is inside the node's own box",
        loop.filter((point) => insideBox(box, point)),
        [],
      );
      expectSame(
        `the whole loop is inside the picture ${JSON.stringify(pictureBox(result))}`,
        loop.filter((point) => !holds(pictureBox(result), point)),
        [],
      );
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — statement composition
  // -------------------------------------------------------------------------
  {
    id: "fc-stmt-ampersand",
    kind: "flowchart",
    source: `flowchart TB
      A & B --> C`,
    status: "supported",
    meaning: "`A & B --> C` declares two edges, A to C and B to C.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]", "C[C]"]);
      // Both pairings, and neither an `A-B` the `&` never asked for.
      expectSame("edges", edges(result), ["A-C", "B-C"]);
    },
  },
  {
    id: "fc-stmt-semicolon",
    kind: "flowchart",
    source: `flowchart TB
      A --> B; B --> C;`,
    status: "supported",
    meaning: "`;` separates statements written on one line.",
    assert: (result) => {
      // Two statements on one line, and the trailing `;` adds no third.
      expectSame("nodes", nodes(result), ["A[A]", "B[B]", "C[C]"]);
      expectSame("edges", edges(result), ["A-B", "B-C"]);
    },
  },
  {
    id: "fc-stmt-bare-node",
    kind: "flowchart",
    source: `flowchart TB
      Orphan
      A --> B`,
    status: "supported",
    meaning:
      "A node id on a line of its own declares that node. mermaid 11.17.2 " +
      "records three vertices for this document — `Orphan`, `A` and `B` — " +
      "and one edge, so the standalone node is drawn with nothing joined " +
      "to it (`node scripts/mermaid-probe.mjs`). Siren's statement dispatch " +
      "now reads a bare id at the top level exactly as it already did " +
      "inside a `subgraph` block, so `Orphan` declares a node with its " +
      "default label — its own id — same as the bracketed `Orphan[Orphan]` " +
      "spelling.",
    assert: (result) => {
      // Three vertices — the standalone `Orphan` plus the edge's `A` and
      // `B` — and one edge, matching mermaid 11.17.2's own count for this
      // document.
      expectSame("nodes", nodes(result), ["Orphan[Orphan]", "A[A]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  {
    id: "fc-stmt-subgraph",
    kind: "flowchart",
    source: `flowchart TB
      subgraph one
        A --> B
      end`,
    status: "supported",
    meaning: "`subgraph ... end` groups nodes inside a labelled frame.",
    assert: (result) => {
      // The nodes are still ordinary nodes and the edge is still `A-B`:
      // grouping changes where a box goes, not what it is called.
      expectSame("nodes", nodes(result), ["A[A]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);

      // "Groups" read off the picture rather than off a parse tree: the
      // frame is drawn, it carries the author's title, and it encloses both
      // boxes. A frame drawn somewhere else would satisfy "it parsed".
      const frame = subgraphBox(result, "one");
      expectSame("frame encloses A", encloses(frame, nodeBox(result, "A")), true);
      expectSame("frame encloses B", encloses(frame, nodeBox(result, "B")), true);
    },
  },
  {
    id: "fc-subgraph-direction",
    kind: "flowchart",
    source: `flowchart TB
      subgraph one
        direction LR
        A --> B
      end`,
    status: "supported",
    meaning:
      "`direction LR` inside a subgraph lays that group out left-to-right while the rest of the diagram keeps the header's direction.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);

      // The picture, not the claim: the header said `TB`, so the only way
      // `B` can land beside `A` rather than below it is the subgraph's own
      // `direction LR` actually reaching layout.
      const from = nodeCenter(result, "A");
      const to = nodeCenter(result, "B");
      expectSame("B is drawn to the right of A", to.x > from.x, true);
      expectSame("and in the same row", to.y === from.y, true);

      // Still an ordinary frame, on the same terms `fc-stmt-subgraph`
      // already checks: a `direction` inside the block does not stop it
      // enclosing its own members.
      const frame = subgraphBox(result, "one");
      expectSame("frame encloses A", encloses(frame, nodeBox(result, "A")), true);
      expectSame("frame encloses B", encloses(frame, nodeBox(result, "B")), true);
    },
  },
  {
    id: "fc-subgraph-direction-nested",
    kind: "flowchart",
    source: `flowchart TB
      subgraph Outer
        direction LR
        subgraph Inner
          A --> B
        end
        Inner --> C
      end`,
    status: "supported",
    meaning:
      "The row above's construct with a subgraph nested inside the one " +
      "carrying the `direction`. **A frame that declares no `direction` is " +
      "laid out in the document's, not in the enclosing frame's.** Measured " +
      "against mermaid 11.17.2 with `scripts/mermaid-probe.mjs --markup`: `A` " +
      "at `translate(63, 68)`, `B` at `translate(63, 208)`, `C` at " +
      "`translate(220.5, 53)` — `A` and `B` on one x exactly, `B` below `A`, " +
      "so `Inner` uses the header's `TB`, while `Outer`'s own `LR` is what " +
      "puts `C` beside it. Measured against `@dagrejs/dagre@3.1.1` directly: " +
      "a cluster given a `rankdir` of its own has its children expanded " +
      "exactly one level, so until `01M2XJWM4` `Inner` came back at the size " +
      "it was handed and `A` and `B` came back with `x`/`y` of `undefined` — " +
      "which this pipeline subtracted from until it had `NaN` in 29 " +
      "attributes and said nothing (`01M2WQV0`), and then refused outright " +
      "(`01M2XJVPX`). What draws it is giving a cluster with no direction of " +
      "its own but a directed ancestor the document's own `rankdir`, which " +
      "is both the value Mermaid's meaning asks for and the thing that makes " +
      "the engine expand it.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]", "C[C]"]);

      const a = nodeCenter(result, "A");
      const b = nodeCenter(result, "B");
      const c = nodeCenter(result, "C");

      // The measurement above, as the picture rather than as "it rendered".
      // `Inner` inheriting `Outer`'s `LR` would draw every figure this row
      // names, report nothing, and put `B` to the *right* of `A`; the
      // equality of these two x's is the only thing that tells the correct
      // picture from that one.
      expectSame("A and B are drawn in one column", a.x, b.x);
      expectSame("B below A — `Inner` lays out in the document's `TB`", b.y > a.y, true);
      expectSame("C beside them — `Outer`'s own `LR`", c.x > a.x, true);

      // And the frames still hold what they group, which is what `NaN`
      // coordinates took away from this document for as long as it drew one.
      const inner = subgraphBox(result, "Inner");
      const outer = subgraphBox(result, "Outer");
      expectSame("Inner encloses A", encloses(inner, nodeBox(result, "A")), true);
      expectSame("Inner encloses B", encloses(inner, nodeBox(result, "B")), true);
      expectSame("Outer encloses Inner", encloses(outer, inner), true);
      expectSame("Outer encloses C", encloses(outer, nodeBox(result, "C")), true);
    },
  },
  {
    id: "fc-subgraph-edge",
    kind: "flowchart",
    source: `flowchart TB
      subgraph one
        A
      end
      subgraph two
        B
      end
      one --> two`,
    status: "supported",
    meaning: "An edge may name a subgraph at either end, joining the two frames rather than two boxes.",
    assert: (result) => {
      // The names the edge used are the *frames*, so the document draws two
      // boxes and not four: no stray `one` beside the frame of that name.
      expectSame("nodes", nodes(result), ["A[A]", "B[B]"]);
      expectSame("edges", edges(result), ["one-two"]);

      const one = subgraphBox(result, "one");
      const two = subgraphBox(result, "two");
      const { start, end } = edgeEnds(result, "one-two");

      // The picture, not the claim. `TB`, so the edge leaves `one` through
      // the bottom of its frame and arrives at `two` through the top of its
      // — which is what makes this an edge between two frames rather than
      // between two of their members.
      expectSame("the edge leaves the bottom of `one`'s frame", start.y, one.bottom);
      expectSame("the edge arrives at the top of `two`'s frame", end.y, two.top);
      expectSame(
        "and it spans the gap between them",
        start.x >= one.left && start.x <= one.right && end.x >= two.left && end.x <= two.right,
        true,
      );

      // Not on a member's box, and not at the origin — the two ways an edge
      // that had not really been routed to the frames could still satisfy
      // "a path was drawn".
      expectSame(
        "the edge clears A's box on the way out",
        start.y > nodeBox(result, "A").bottom,
        true,
      );
      expectSame(
        "and stops short of B's box on the way in",
        end.y < nodeBox(result, "B").top,
        true,
      );
    },
  },
  {
    id: "fc-subgraph-self-edge",
    kind: "flowchart",
    source: `flowchart TB
      subgraph one
        A
      end
      one --> one`,
    status: "supported",
    meaning:
      "A subgraph may name itself at both ends of an edge, drawing a loop " +
      "around its own **frame** — mermaid 11.17.2 renders it as the edge " +
      "`L_one_one_0` alongside the `one` cluster, measured. Siren draws it " +
      "outside the frame with both ends on the frame's own boundary. It used " +
      "to draw the loop dagre gave the member standing in for the frame, " +
      "which landed *inside* the frame beside `A`: the right edge attached " +
      "to the wrong figure, with no diagnostic saying so. The clip that puts " +
      "an ordinary frame-to-frame edge on the frame boundary could never " +
      "have fixed it — a self-loop never leaves the box, so there is no " +
      "point outside it to aim at — so the geometry is synthesised instead " +
      "(`selfLoopAroundBox`), for a frame and a plain node alike.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]"]);
      expectSame("edges", edges(result), ["one-one"]);

      // Outside the frame, and joined to it. Both halves are needed: a loop
      // asserted only to touch the frame is satisfied by one drawn across
      // the inside of it, which is exactly the picture this row used to
      // record.
      const frame = subgraphBox(result, "one");
      const loop = edgePoints(result, "one-one");
      expectSame(
        `the loop is drawn through more than one point (got ${JSON.stringify(loop)})`,
        loop.length > 1,
        true,
      );
      expectSame(
        `no point of the loop is inside the frame ${JSON.stringify(frame)}`,
        loop.filter((point) => insideBox(frame, point)),
        [],
      );
      const { start, end } = edgeEnds(result, "one-one");
      expectSame(
        `the loop starts on the frame's own boundary (at ${JSON.stringify(start)})`,
        onBoxBoundary(frame, start),
        true,
      );
      expectSame(
        `and ends on it (at ${JSON.stringify(end)})`,
        onBoxBoundary(frame, end),
        true,
      );
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — label text
  // -------------------------------------------------------------------------
  {
    id: "fc-text-plain",
    kind: "flowchart",
    source: `flowchart TB
      A[Plain label]`,
    status: "supported",
    meaning: "`A[text]` is a rectangle labelled `text`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Plain label]"]);
    },
  },
  {
    id: "fc-text-quoted",
    kind: "flowchart",
    source: `flowchart TB
      A["Quoted, with comma"]`,
    status: "supported",
    meaning: "Quotes fence a label containing punctuation; the quotes are not part of it.",
    assert: (result) => {
      // The comma survives and the quotes do not. Drawing them was the
      // silent mis-render this row was seeded for: an author reaching for
      // the escape hatch got it printed back at them.
      expectSame("nodes", nodes(result), ["A[Quoted, with comma]"]);
    },
  },
  {
    id: "fc-text-brace-arrow",
    kind: "flowchart",
    source: `flowchart TB
      A{a-->b}`,
    status: "supported",
    meaning:
      "A brace opens a label as surely as a bracket does, so an arrow " +
      "written inside one is label text: mermaid 11.17.2 reads this as a " +
      "single `diamond` vertex with `text=\"a-->b\"` and no edge at all " +
      "(`node scripts/mermaid-probe.mjs`).",
    assert: (result) => {
      // One node, labelled with the arrow. A statement splitter that knew
      // about `[` and not about `{` cut this line at the arrow and refused
      // the halves -- an author was told a document Mermaid draws is
      // unrecognizable, which is the condition this corpus exists to hold.
      expectSame("nodes", nodes(result), ["A[a-->b]"]);
      // And nothing was drawn between the halves it used to be cut into.
      expectSame("edges", edges(result), []);
      // Still the shape its braces name, so the fix to the splitter did not
      // cost the spelling its meaning.
      expectSame("outline", nodeOutline(result, "A"), "diamond");
    },
  },
  {
    id: "fc-text-label-whitespace",
    kind: "flowchart",
    source: `flowchart TB
      A[  padded  ] --> B["  padded  "]`,
    status: "supported",
    meaning:
      "Mermaid trims the whitespace around a label, quoted or not: mermaid " +
      "11.17.2 records `text=\"padded\"` for both of these vertices " +
      "(`node scripts/mermaid-probe.mjs`). Padding a label is how an author " +
      "lays a document out; it is not part of what the box says.",
    assert: (result) => {
      // Both boxes drop the padding they were written with, uniformly
      // across the quoted and the unquoted spelling -- one trim in the
      // parser's label reader, not a quoting-specific fix.
      expectSame("nodes", nodes(result), ["A[padded]", "B[padded]"]);
    },
  },
  {
    id: "fc-text-markdown",
    kind: "flowchart",
    source: `flowchart TB
      A["\`**bold**\`"]`,
    status: "supported",
    meaning:
      "A Markdown string label draws `**bold**` as bold text: mermaid " +
      "11.17.2 sets `font-weight: bold` on the run and nothing else, " +
      "measured (`htmlLabels: false`, a throwaway mermaid-probe.mjs-based " +
      "script).",
    assert: (result) => {
      // The plain text still reads right off `textContent` — tspans concatenate.
      expectSame("nodes", nodes(result), ["A[bold]"]);
      // And the run that carries it is drawn bold, not merely spelled "bold".
      expectSame("markdown rows", markdownRows(result, "A"), ["bold(b)"]);
    },
  },
  {
    id: "fc-text-italic",
    kind: "flowchart",
    source: `flowchart TB
      A["\`*italic*\`"]`,
    status: "supported",
    meaning:
      "A Markdown string label draws `*italic*` as italic text: mermaid " +
      "11.17.2 sets `font-style: italic` on the run and nothing else, " +
      "measured — the other half of the axis `fc-text-markdown`'s bold " +
      "measures, independent rather than a second spelling of the same rule.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[italic]"]);
      expectSame("markdown rows", markdownRows(result, "A"), ["italic(i)"]);
    },
  },
  {
    id: "fc-text-multiline",
    kind: "flowchart",
    // The continuation line is flush left on purpose: mermaid 11.17.2 reads
    // a Markdown label's fence across physical source lines (measured,
    // `node="A" text="line1\nline2"`), and the embedded line break is
    // whatever text sits between the two physical lines verbatim — an
    // indented continuation would put leading spaces on "line2" that nobody
    // wrote as part of the label.
    source: `flowchart TB
      A["\`line1
line2\`"]`,
    status: "supported",
    meaning:
      "A Markdown label's fence may close on a later physical line than it " +
      "opened on, and mermaid 11.17.2 reads the line break in between as " +
      "part of the label: one vertex, `text=\"line1\\nline2\"`, `labelType=" +
      '"markdown"` (measured). Drawn as two rows rather than one line with a ' +
      "literal backslash-n in it.",
    assert: (result) => {
      // Two sibling `<tspan>` rows, not one text node with a `\n` in it —
      // `textContent` concatenates them with nothing in between (no
      // separator a DOM ever inserts between sibling elements), so the
      // line break these two rows draw is visible in *where* the SVG puts
      // them, not in this string. `markdownRows` is the assert that reads
      // that structure; this is only proof the letters themselves made it.
      expectSame("nodes", nodes(result), ["A[line1line2]"]);
      expectSame("markdown rows", markdownRows(result, "A"), ["line1", "line2"]);
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — author styling
  // -------------------------------------------------------------------------
  {
    id: "fc-style-style",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] --> B[End]
      style A fill:#fdd`,
    status: "supported",
    meaning: "`style A fill:#fdd` paints that one node's frame.",
    assert: (result) => {
      expectSame("node A's inline style", nodeStyle(result, "A"), "fill:#fdd");
      expectSame("node B's inline style", nodeStyle(result, "B"), "");
    },
  },
  {
    id: "fc-style-classdef",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] --> B[End]
      classDef emphasis fill:#fdd
      class A emphasis`,
    status: "supported",
    meaning: "`classDef` names a set of declarations; `class A name` applies it.",
    assert: (result) => {
      expectSame("node A's inline style", nodeStyle(result, "A"), "fill:#fdd");
      expectSame("node B's inline style", nodeStyle(result, "B"), "");
    },
  },
  {
    id: "fc-style-linkstyle",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] --> B[End]
      linkStyle 0 stroke:#f00`,
    status: "supported",
    meaning: "`linkStyle 0` styles the first declared edge — the only directive that reaches one.",
    assert: (result) => {
      expectSame("edge A-B's inline style", edgeStyle(result, "A-B"), "stroke:#f00");
    },
  },

  {
    id: "fc-style-linkstyle-color",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] -->|yes| B[End]
      linkStyle 0 stroke:#f00,color:#0f0`,
    status: "supported",
    meaning:
      "`linkStyle`'s `color` paints the edge's *label*, and its other " +
      "declarations paint the line. Measured with " +
      "`node scripts/mermaid-probe.mjs --paint`: mermaid 11.17.2 renders " +
      "`linkStyle 0 color:#ff0000` as `fill:#ff0000 !important` on the " +
      "label's `<text>` (and as `color:#ff0000 !important` on its `<span>` " +
      "when it draws labels as HTML), while `stroke` lands on the path.",
    assert: (result) => {
      // The two halves, on the two elements. `fill` on the label rather
      // than `color`, because `color` names no paint in an SVG document —
      // the translation is ADR-0008's and is made once, in the model.
      expectSame("edge A-B's label style", edgeLabelStyle(result, "A-B"), "fill:#0f0");
      expectSame("edge A-B's line style", edgeStyle(result, "A-B"), "stroke:#f00");
    },
  },

  // -------------------------------------------------------------------------
  // flowchart — interaction and accessibility
  // -------------------------------------------------------------------------
  {
    id: "fc-click-href",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A href "https://example.com"`,
    status: "supported",
    meaning: "`click A href \"url\"` makes the node a link.",
    assert: (result) => {
      const link = svgOf(result).querySelector(
        'a.siren-link > g.siren-node[data-siren-id="A"]',
      );
      if (link === null) throw new Error('node "A" was not wrapped in an <a class="siren-link">');
      expectSame(
        "A's link href",
        link.parentElement?.getAttribute("href"),
        "https://example.com",
      );
    },
  },
  {
    id: "fc-click-call",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A call showDetails()`,
    status: "supported",
    meaning: "`click A call fn()` makes the node call back into the host.",
    assert: (result) => {
      const node = svgOf(result).querySelector('g.siren-node[data-siren-id="A"]');
      if (node === null) throw new Error('no node "A" was drawn');
      expectSame("A's click callback", node.getAttribute("data-siren-click"), "showDetails");
      expectSame("A's click argument", node.getAttribute("data-siren-click-arg"), null);
    },
  },
  {
    id: "fc-click-target",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A href "https://example.com" "tip" _blank`,
    status: "supported",
    meaning:
      "`click A href \"url\" \"tip\" _blank` opens the link in a new tab — the " +
      "target attribute trailing the tooltip, one of Mermaid's four " +
      "`LINK_TARGET` values (`_blank`/`_self`/`_top`/`_parent`). Mermaid's own " +
      "rendered SVG carries no `target` attribute for any of them (measured); " +
      "Siren's `<a href>` has no JS bind-time layer to fall back on, so it " +
      "sets `target` itself, plus `rel=\"noopener noreferrer\"` against " +
      "reverse tabnabbing — a deliberate, measured mechanism divergence, not " +
      "a mis-render.",
    assert: (result) => {
      const link = svgOf(result).querySelector(
        'a.siren-link > g.siren-node[data-siren-id="A"]',
      );
      if (link === null) throw new Error('node "A" was not wrapped in an <a class="siren-link">');
      expectSame("A's link target", link.parentElement?.getAttribute("target"), "_blank");
      expectSame(
        "A's link rel",
        link.parentElement?.getAttribute("rel"),
        "noopener noreferrer",
      );
    },
  },
  {
    id: "fc-click-bare-callback",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A myFn`,
    status: "supported",
    meaning:
      "`click A myFn` is Mermaid's bare callback-name shorthand for " +
      "`click A call myFn()`. It parses into the same call interaction Siren " +
      "already draws: `render()`'s `onClick` reports the clicked node's own " +
      "id for every `call` interaction regardless of which click spelling " +
      "produced it, so the bare form and `call fn()` land on exactly the " +
      "same wire shape.",
    assert: (result) => {
      const node = svgOf(result).querySelector('g.siren-node[data-siren-id="A"]');
      if (node === null) throw new Error('no node "A" was drawn');
      expectSame("A's click callback", node.getAttribute("data-siren-click"), "myFn");
      expectSame("A's click argument", node.getAttribute("data-siren-click-arg"), null);
    },
  },
  {
    id: "fc-click-bare-href",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A "https://example.com"`,
    status: "supported",
    meaning:
      "`click A \"url\"` is Mermaid's bare-quoted-string shorthand for " +
      "`click A href \"url\"` with the `href` keyword omitted — measured " +
      "against real Mermaid 11.17.2 with `scripts/mermaid-probe.mjs`: " +
      "`click A \"tip\"` renders `<a href=\"tip\">`, the quoted string becomes " +
      "the href value regardless of whether it looks like a URL, not a " +
      "tooltip-only concept. It parses into the same href interaction Siren " +
      "already draws for `click A href \"url\"`, so it renders the same " +
      "`<a class=\"siren-link\">` wrapper.",
    assert: (result) => {
      const link = svgOf(result).querySelector(
        'a.siren-link > g.siren-node[data-siren-id="A"]',
      );
      if (link === null) throw new Error('node "A" was not wrapped in an <a class="siren-link">');
      expectSame(
        "A's link href",
        link.parentElement?.getAttribute("href"),
        "https://example.com",
      );
    },
  },
  {
    id: "fc-acc-title",
    kind: "flowchart",
    source: `flowchart TB
      accTitle: A short title
      A[Start] --> B[End]`,
    status: "supported",
    meaning:
      "`accTitle:` gives the diagram its accessible title, drawn as the " +
      "SVG's own <title> element — never on the canvas — with the root " +
      "wired to it via aria-labelledby.",
    assert: (result) => {
      const svg = svgOf(result);
      const title = svg.querySelector("title");
      if (title === null) throw new Error("no <title> was drawn");
      expectSame("the accessible title text", title.textContent, "A short title");
      expectSame(
        "the root svg is labelled by that title",
        svg.getAttribute("aria-labelledby"),
        title.getAttribute("id"),
      );
    },
  },
  {
    id: "fc-acc-descr",
    kind: "flowchart",
    source: `flowchart TB
      accDescr: A longer description
      A[Start] --> B[End]`,
    status: "supported",
    meaning:
      "`accDescr:` gives the diagram its accessible description, drawn as " +
      "the SVG's own <desc> element — never on the canvas — with the root " +
      "wired to it via aria-describedby.",
    assert: (result) => {
      const svg = svgOf(result);
      const desc = svg.querySelector("desc");
      if (desc === null) throw new Error("no <desc> was drawn");
      expectSame("the accessible description text", desc.textContent, "A longer description");
      expectSame(
        "the root svg is described by that desc",
        svg.getAttribute("aria-describedby"),
        desc.getAttribute("id"),
      );
    },
  },
  {
    id: "fc-comment-trailing",
    kind: "flowchart",
    source: `flowchart TB
      A --> B %% this edge is the point`,
    status: "supported",
    meaning: "`%%` starts a comment running to the end of the line; an edge creates both nodes.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  // -------------------------------------------------------------------------
  // classDiagram
  // -------------------------------------------------------------------------
  {
    id: "cls-class-bare",
    kind: "class",
    source: `classDiagram
      class Animal`,
    status: "supported",
    meaning: "`class X` declares an empty class box named X.",
    assert: (result) => {
      expectSame("classes", classes(result), ["Animal"]);
      expectSame("Animal's members", members(result, "Animal"), []);
    },
  },
  {
    id: "cls-class-block",
    kind: "class",
    source: `classDiagram
      class Animal {
        +int age
        +bark() bool
      }`,
    status: "supported",
    meaning: "A block body declares the class's attributes and methods.",
    assert: (result) => {
      expectSame("classes", classes(result), ["Animal"]);
      expectSame("Animal's members", members(result, "Animal"), ["+int age", "+bark() bool"]);
    },
  },
  {
    id: "cls-inline-member",
    kind: "class",
    source: `classDiagram
      Animal : +int age`,
    status: "supported",
    meaning: "`X : member` declares X and gives it one member, without a block.",
    assert: (result) => {
      expectSame("classes", classes(result), ["Animal"]);
      expectSame("Animal's members", members(result, "Animal"), ["+int age"]);
    },
  },
  {
    id: "cls-rel-inheritance",
    kind: "class",
    source: `classDiagram
      Animal <|-- Dog`,
    status: "supported",
    meaning: "`A <|-- B` is inheritance: B extends A. Both classes are declared by it.",
    assert: (result) => {
      expectSame("classes", classes(result), ["Animal", "Dog"]);
      expectSame("relationships", relationships(result), ["Animal-Dog:inheritance"]);
    },
  },
  {
    id: "cls-rel-composition",
    kind: "class",
    source: `classDiagram
      Car *-- Engine`,
    status: "supported",
    meaning: "`A *-- B` is composition: B's lifetime is A's.",
    assert: (result) => {
      expectSame("relationships", relationships(result), ["Car-Engine:composition"]);
    },
  },
  {
    id: "cls-rel-aggregation",
    kind: "class",
    source: `classDiagram
      Team o-- Player`,
    status: "supported",
    meaning: "`A o-- B` is aggregation: A holds B, which outlives it.",
    assert: (result) => {
      expectSame("relationships", relationships(result), ["Team-Player:aggregation"]);
    },
  },
  {
    id: "cls-rel-dependency",
    kind: "class",
    source: `classDiagram
      Order ..> Payment`,
    status: "supported",
    meaning: "`A ..> B` is a dependency: a dashed line with an open arrowhead.",
    assert: (result) => {
      expectSame("relationships", relationships(result), ["Order-Payment:dependency"]);
    },
  },
  {
    id: "cls-rel-label-multiplicity",
    kind: "class",
    source: `classDiagram
      Customer "1" --> "*" Order : places`,
    status: "supported",
    meaning: "A relationship may carry a `: label` and a multiplicity at each end.",
    assert: (result) => {
      expectSame("relationships", relationships(result), ["Customer-Order:association"]);
      expectSame("relationship label", texts(result, "text.siren-relationship-label"), ["places"]);
      expectSame("multiplicities", texts(result, "text.siren-multiplicity"), ["1", "*"]);
    },
  },
  {
    id: "cls-annotation",
    kind: "class",
    source: `classDiagram
      class Shape {
        <<interface>>
        +area() float
      }`,
    status: "supported",
    meaning: "`<<interface>>` annotates the class it is written in, drawn in guillemets.",
    assert: (result) => {
      expectSame("annotations", texts(result, "text.siren-class-annotation"), ["«interface»"]);
      expectSame("Shape's members", members(result, "Shape"), ["+area() float"]);
    },
  },
  {
    id: "cls-namespace",
    kind: "class",
    source: `classDiagram
      namespace Zoo {
        class Lion
      }`,
    status: "supported",
    meaning: "`namespace X { ... }` frames the classes declared inside it.",
    assert: (result) => {
      expectSame("classes", classes(result), ["Lion"]);
      expectSame("namespace ids", texts(result, "text.siren-namespace-label"), ["Zoo"]);
      expectSame("a namespace frame was drawn", drew(result, "g.siren-namespace"), true);
    },
  },
  {
    id: "cls-note",
    kind: "class",
    source: `classDiagram
      class Lion
      note for Lion "the only social cat"`,
    status: "supported",
    meaning: "`note for X \"text\"` draws an annotation box connected to X.",
    assert: (result) => {
      expectSame("note text", texts(result, "text.siren-note-text"), ["the only social cat"]);
      expectSame("a connector to the class was drawn", drew(result, "path.siren-note-link"), true);
    },
  },
  {
    id: "cls-direction",
    kind: "class",
    source: `classDiagram
      direction LR
      Animal <|-- Dog`,
    status: "supported",
    meaning: "`direction LR` lays the diagram out left-to-right, so a subclass sits beside its parent.",
    assert: (result) => {
      const parent = classBox(result, "Animal");
      const child = classBox(result, "Dog");
      expectSame("Dog is drawn to the right of Animal", child.x > parent.x, true);
      expectSame("and not below it", child.y === parent.y, true);
    },
  },
  {
    id: "cls-lollipop",
    kind: "class",
    source: `classDiagram
      Duck ()-- Quacks`,
    status: "supported",
    meaning:
      "`A ()-- B` is a lollipop: B exposes an interface that A consumes. Measured against " +
      "real Mermaid (mermaid-probe.mjs): the `()` side (\"Duck\") never becomes a class — " +
      "only \"Quacks\" does — and the connecting line gets a circle marker at the lollipop end.",
    assert: (result) => {
      expectSame("Quacks is drawn as a class", classes(result), ["Quacks"]);
      expectSame(
        "the relationship is drawn as a lollipop",
        relationships(result),
        ["Duck-Quacks:lollipop"],
      );
      expectSame(
        "the interface name is drawn as its own label",
        texts(result, "text.siren-relationship-interface-label"),
        ["Duck"],
      );
    },
  },
  // -------------------------------------------------------------------------
  // sequenceDiagram
  // -------------------------------------------------------------------------
  {
    id: "seq-participant-alias",
    kind: "sequence",
    source: `sequenceDiagram
      participant A as Alice
      participant B as Bob
      A->>B: Hello`,
    status: "supported",
    meaning: "`participant X as Label` declares a lane keyed X but drawn as Label.",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame("drawn labels", texts(result, "g.siren-participant text"), [
        "Alice",
        "Bob",
        "Alice",
        "Bob",
      ]);
    },
  },
  {
    id: "seq-actor",
    kind: "sequence",
    source: `sequenceDiagram
      actor A
      participant B
      A->>B: Hello`,
    status: "supported",
    meaning: "`actor X` draws the lane's head as a stick figure rather than a box.",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame(
        "the actor is drawn as a stick figure",
        drew(result, `g.siren-participant[data-siren-id="A"] circle`),
        true,
      );
      expectSame(
        "and the participant as a box",
        drew(result, `g.siren-participant[data-siren-id="B"] rect`),
        true,
      );
    },
  },
  {
    id: "seq-message-solid",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>B: Hello`,
    status: "supported",
    meaning: "`A->>B: text` is a solid line with a filled arrowhead, labelled `text`.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-B: Hello"]);
      expectSame("A-B's arrow", messageArrow(result, "A-B"), "solid/siren-arrow-filled");
    },
  },
  {
    id: "seq-message-dotted-reply",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>B: Hello
      B-->>A: Hi`,
    status: "supported",
    meaning: "`-->>` is the dotted reply arrow: same head, dashed line.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-B: Hello", "B-A: Hi"]);
      expectSame("B-A's arrow", messageArrow(result, "B-A"), "dotted/siren-arrow-filled");
    },
  },
  {
    id: "seq-self-message",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      A->>A: reconsider`,
    status: "supported",
    meaning: "A message may name one participant twice, drawn as a loop back to its own lane.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-A: reconsider"]);
    },
  },
  {
    id: "seq-loop",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      loop every minute
        A->>B: poll
      end`,
    status: "supported",
    meaning:
      "`loop label ... end` frames the messages it wraps, and Mermaid draws the " +
      "keyword `loop` in a corner tag on that frame, beside the condition — " +
      "which Mermaid itself brackets: `every minute` draws as `[every minute]`.",
    assert: (result) => {
      expectSame("blocks", blocks(result), ["loop:loop:1"]);
      expectSame(
        "the condition is drawn bracketed",
        texts(result, "text.siren-block-label"),
        ["[every minute]"],
      );
      expectSame("the keyword is drawn", texts(result, "text.siren-block-keyword"), ["loop"]);
      expectSame("messages", messages(result), ["A-B: poll"]);
    },
  },
  {
    id: "seq-alt-else",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      alt is ok
        A->>B: proceed
      else is not
        A->>B: stop
      end`,
    status: "supported",
    meaning:
      "`alt`/`else` frames two branches divided by a line. Measured against " +
      "real Mermaid: only `alt`, the header, draws a corner-tag keyword — " +
      "`else` draws none of its own, however many branches there are — and " +
      "every branch's condition is bracketed (`is ok` draws as `[is ok]`).",
    assert: (result) => {
      expectSame("blocks", blocks(result), ["alt:alt:1"]);
      expectSame("messages", messages(result), ["A-B: proceed", "A-B#2: stop"]);
      expectSame("a divider was drawn between the branches", drew(result, "line.siren-block-divider"), true);
      expectSame(
        "both branch conditions are drawn bracketed",
        texts(result, "text.siren-block-label"),
        ["[is ok]", "[is not]"],
      );
      expectSame(
        "only the header's keyword is drawn, never the divider's",
        texts(result, "text.siren-block-keyword"),
        ["alt"],
      );
    },
  },
  {
    id: "seq-create-destroy",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      create participant B
      A->>B: are you there
      B-->>A: yes
      destroy B`,
    status: "supported",
    meaning: "`create` starts a lifeline partway down; `destroy` ends it with an X.",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame("a destroy mark was drawn", drew(result, "path.siren-destroy-mark"), true);
    },
  },
  {
    id: "seq-autonumber",
    kind: "sequence",
    source: `sequenceDiagram
      autonumber
      participant A
      participant B
      A->>B: first
      A->>B: second`,
    status: "supported",
    meaning: "`autonumber` numbers every message from 1, in order.",
    assert: (result) => {
      expectSame("autonumbers", texts(result, "text.siren-autonumber"), ["1", "2"]);
    },
  },
  {
    id: "seq-activation-shorthand",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>+B: request
      B-->>-A: response`,
    status: "supported",
    meaning:
      "The shorthand for `activate`/`deactivate`, drawn as a bar on a lane — " +
      "and the two markers name *different* lanes. `+` activates the lifeline " +
      "the arrow points at (the message's target); `-` deactivates the " +
      "lifeline the arrow starts from (the message's sender). In the " +
      "canonical request/response pair above both land on B, which is why the " +
      "pair reads as one bar and why the rule is easy to mis-state. " +
      "Measured in mermaid 11.17.2 with `scripts/mermaid-probe.mjs`, not " +
      "remembered: it records an activation start on B for `A->>+B` and an " +
      "activation end on **B** for `B-->>-A`, and writing `A->>-B` instead " +
      "fails with `Trying to inactivate an inactive participant (A)` — the " +
      "sender.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-B: request", "B-A: response"]);
      // Both markers land on B, so this reads as one bar, not two.
      const bars = svgOf(result).querySelectorAll("rect.siren-activation-bar");
      expectSame("exactly one activation bar was drawn", bars.length, 1);
    },
  },
  {
    id: "seq-activate",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>B: request
      activate B
      B-->>A: response
      deactivate B`,
    status: "supported",
    meaning: "`activate X` / `deactivate X` is the long form of the same activation bar.",
    assert: (result) => {
      const bars = svgOf(result).querySelectorAll("rect.siren-activation-bar");
      expectSame("exactly one activation bar was drawn", bars.length, 1);
    },
  },
  {
    id: "seq-note-over",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      note over A,B: they agree`,
    status: "supported",
    meaning: "`note over A,B: text` draws a note spanning both lanes.",
    assert: (result) => {
      expectSame("the note text is drawn", texts(result, "text.siren-note-text"), [
        "they agree",
      ]);
      expectSame("a note frame was drawn", drew(result, "rect.siren-note-frame"), true);
    },
  },
  {
    id: "seq-note-right-of",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      note right of A: thinking`,
    status: "supported",
    meaning: "`note right of X: text` draws a note beside one lane.",
    assert: (result) => {
      expectSame("the note text is drawn", texts(result, "text.siren-note-text"), ["thinking"]);
    },
  },
  {
    id: "seq-acc-title",
    kind: "sequence",
    source: `sequenceDiagram
      accTitle: A short title
      participant A
      participant B
      A->>B: Hello`,
    status: "supported",
    meaning:
      "`accTitle:` gives the diagram its accessible title, drawn as the " +
      "SVG's own <title> element — never on the canvas — with the root " +
      "wired to it via aria-labelledby.",
    assert: (result) => {
      const svg = svgOf(result);
      const title = svg.querySelector("title");
      if (title === null) throw new Error("no <title> was drawn");
      expectSame("the accessible title text", title.textContent, "A short title");
      expectSame(
        "the root svg is labelled by that title",
        svg.getAttribute("aria-labelledby"),
        title.getAttribute("id"),
      );
    },
  },
  {
    id: "seq-link",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      link A: Dashboard @ https://example.com`,
    status: "supported",
    meaning:
      "`link X: Label @ url` hangs a menu entry off the participant. " +
      "Mermaid's popup menu is not reproducible in a static SVG (measured: " +
      "it is a `display:none` panel toggled by JS), so this reuses the " +
      "kind-agnostic href interaction class/flowchart already share — X's " +
      "box becomes a plain navigable link, with Label as its tooltip.",
    assert: (result) => {
      const link = svgOf(result).querySelector("a.siren-link");
      if (link === null) throw new Error("no link was drawn");
      expectSame("the link navigates to the given url", link.getAttribute("href"), "https://example.com");
      const group = link.querySelector('g.siren-participant[data-siren-id="A"]');
      expectSame("it wraps the participant's own group", group !== null, true);
      expectSame(
        "Label reaches the reader as the participant's tooltip",
        group?.querySelector("title")?.textContent,
        "Dashboard",
      );
    },
  },
  // -------------------------------------------------------------------------
  // stateDiagram
  // -------------------------------------------------------------------------
  {
    id: "st-header-v1",
    kind: "state",
    source: `stateDiagram
      Idle --> Running`,
    status: "supported",
    meaning:
      "`stateDiagram` opens a state diagram. Measured (mermaid 11.17.2): it " +
      "and `stateDiagram-v2` report the same diagram type, so they are one " +
      "kind written two ways.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running"]);
      expectSame("transitions", transitions(result), ["Idle-Running: "]);
    },
  },
  {
    id: "st-header-v2",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Running`,
    status: "supported",
    meaning:
      "`stateDiagram-v2` is the modern spelling of the same header, and lays " +
      "the diagram out top to bottom — the direction Mermaid reports for a " +
      "state diagram that names none.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running"]);
      expectSame("transitions", transitions(result), ["Idle-Running: "]);
      // The direction, read off the picture: asserting the two states alone
      // would pass for a document laid out sideways.
      expectSame(
        "Running is drawn below Idle",
        stateCenter(result, "Running").y > stateCenter(result, "Idle").y,
        true,
      );
    },
  },
  {
    id: "st-state-bare",
    kind: "state",
    source: `stateDiagram-v2
      Lonely`,
    status: "supported",
    meaning:
      "A bare identifier on a line of its own declares a state. Measured: it " +
      "enters Mermaid's state table with no transition needed, so a state " +
      "nothing points at still draws.",
    assert: (result) => {
      expectSame("states", states(result), ["Lonely"]);
      expectSame("transitions", transitions(result), []);
      expectSame(
        "its name is drawn in the box",
        texts(result, "g.siren-state text.siren-state-label"),
        ["Lonely"],
      );
    },
  },
  {
    id: "st-state-keyword-only",
    kind: "state",
    source: `stateDiagram-v2
      state Skipped
      Lonely`,
    status: "supported",
    meaning:
      "`state X` on a line of its own declares **nothing**. Measured (mermaid " +
      "11.17.2): it puts no state into the state table and is not a parse " +
      "error either — it is the composite opener `state X {` with its brace " +
      "missing, which Mermaid tolerates and ignores. The control is " +
      "`st-state-bare` beside it: the *bare* identifier spelling of the same " +
      "line does declare a state, and the keyword is not an optional prefix " +
      "on it.",
    assert: (result) => {
      // `Lonely` is here so the absence is read off a picture that was
      // actually drawn: a row asserting an empty diagram would pass just as
      // happily on a render that produced nothing at all.
      expectSame("states", states(result), ["Lonely"]);
      expectSame(
        "no box is drawn for the skipped state",
        texts(result, "g.siren-state text.siren-state-label"),
        ["Lonely"],
      );
      expectSame("transitions", transitions(result), []);
    },
  },
  {
    id: "st-state-keyword-bare",
    kind: "state",
    source: `stateDiagram-v2
      state
      Lonely`,
    status: "supported",
    meaning:
      "The `state` keyword **entirely alone** on a line declares nothing " +
      "either. Measured (mermaid 11.17.2): it is not a parse error and puts " +
      "no state into the state table — `state X` truncated one argument " +
      "further, tolerated and ignored the same way. It is the one word of " +
      "the seven Mermaid reserves that survives in this position: the other " +
      "six (`note`, `classDef`, `class`, `style`, `click`, `scale`) are a " +
      "parse error on a line of their own, and all seven are a parse error " +
      "as a transition endpoint, so none of those is a construct with a row " +
      "to own.",
    assert: (result) => {
      // `Lonely` is the control, for the reason `st-state-keyword-only` has
      // one: the absence has to be read off a picture that was drawn, or a
      // render that produced nothing at all would pass too.
      expectSame("states", states(result), ["Lonely"]);
      expectSame(
        "no box is drawn for the lone keyword",
        texts(result, "g.siren-state text.siren-state-label"),
        ["Lonely"],
      );
      expectSame("transitions", transitions(result), []);
    },
  },
  {
    id: "st-transition",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Running
      Running --> Done`,
    status: "supported",
    meaning:
      "`A --> B` is a transition from A to B, and declares both states. " +
      "Written with no label, it draws no label — Mermaid reports the " +
      "relation title as empty, and an empty label is not a label.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running", "Done"]);
      expectSame("transitions", transitions(result), ["Idle-Running: ", "Running-Done: "]);
      expectSame("no transition drew a label", texts(result, "text.siren-transition-label"), []);
    },
  },
  {
    id: "st-transition-label",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Running : start the job`,
    status: "supported",
    meaning:
      "`A --> B : text` labels the transition. Measured: the text rides on " +
      "the relation itself (`relationTitle`), not on a statement of its own.",
    assert: (result) => {
      expectSame("transitions", transitions(result), ["Idle-Running: start the job"]);
      // Drawn on the line rather than merely present somewhere: the label
      // belongs to the transition's own group.
      expectSame(
        "the label is drawn inside the transition's group",
        texts(result, 'g.siren-transition[data-siren-id="Idle-Running"] text'),
        ["start the job"],
      );
    },
  },
  {
    id: "st-self-transition",
    kind: "state",
    source: `stateDiagram-v2
      Running --> Running : retry`,
    status: "supported",
    meaning:
      "`A --> A` is the 'stays in this state' loop, and legitimate syntax " +
      "rather than an error. Measured: one state, one relation onto itself, " +
      "drawn as a loop **joined to that state's own box** — an arrow onto " +
      "itself that does not touch itself is not the construct.",
    assert: (result) => {
      expectSame("states", states(result), ["Running"]);
      expectSame("transitions", transitions(result), ["Running-Running: retry"]);
      // A drawn loop and not a point: a route collapsed onto one coordinate
      // leaves a `<path>` to find and draws nothing.
      const drawn = transitionPoints(result, "Running-Running");
      expectSame(
        `the loop is drawn through more than one point (got ${JSON.stringify(drawn)})`,
        drawn.length > 1,
        true,
      );

      // Joined to the box, outside it, and inside the picture. The layout
      // engine's own self-edge route is none of the three: measured against
      // `@dagrejs/dagre@3.1.1`, a 24x32 box at x 0..24 has its loop routed
      // at x 52..76, clear of the box and past the graph width it reports.
      const box = stateRect(result, "Running");
      const loop = transitionPath(result, "Running-Running");
      expectSame(
        `the loop starts on the state's own outline (at ${JSON.stringify(loop[0])}, box ${JSON.stringify(box)})`,
        onBoxBoundary(box, loop[0]),
        true,
      );
      expectSame(
        `and ends on it (at ${JSON.stringify(loop[loop.length - 1])})`,
        onBoxBoundary(box, loop[loop.length - 1]),
        true,
      );
      expectSame(
        "no point of the loop is inside the state's own box",
        loop.filter((point) => insideBox(box, point)),
        [],
      );
      expectSame(
        `the whole loop is inside the picture ${JSON.stringify(pictureBox(result))}`,
        loop.filter((point) => !holds(pictureBox(result), point)),
        [],
      );
    },
  },
  {
    id: "st-start-pseudo-state",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Idle`,
    status: "supported",
    meaning:
      "`[*]` on the *from* side of an arrow is the level's start " +
      "pseudo-state — where the machine begins. Measured: the relation " +
      "comes back from `root_start`, a node of Mermaid's own making that " +
      "the author never declared, and it is drawn as a filled disc rather " +
      "than as a labelled box.",
    assert: (result) => {
      // The figure, not just the id: a start drawn as an empty rectangle
      // would satisfy an id-only check and be the wrong picture.
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "Idle: box",
      ]);
      expectSame("transitions", transitions(result), ["start:1-Idle: "]);
      // Nothing is written on the disc. Its id is generated, so a label
      // would print `start:1` at a reader who never wrote it.
      expectSame(
        "no text is drawn inside the start pseudo-state",
        texts(result, 'g.siren-state[data-siren-id="start:1"] text'),
        [],
      );
    },
  },
  {
    id: "st-end-pseudo-state",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> [*]`,
    status: "supported",
    meaning:
      "`[*]` on the *to* side is the level's end pseudo-state, and a " +
      "different node from the start — measured, Mermaid reports this " +
      "relation as reaching `root_end`, never `root_start`. UML draws it " +
      "as a ring around a filled disc.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "Idle: box",
        "end:1: ring+dot",
      ]);
      expectSame("transitions", transitions(result), ["Idle-end:1: "]);
      // The arrow ends at the ring rather than starting from it: `[*]` read
      // as one pseudo-state for both jobs would reverse this.
      expectSame(
        "the transition is drawn from the state to the end",
        elements(result, "g.siren-transition").map((g) => idOf(g)),
        ["Idle-end:1"],
      );
    },
  },
  {
    id: "st-pseudo-state-one-per-level",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Idle
      [*] --> Busy
      Idle --> [*]
      Busy --> [*]`,
    status: "supported",
    meaning:
      "`[*]` is one start and one end *per level*, not one per occurrence. " +
      "Measured: both `[*] -->` relations come back from the same " +
      "`root_start` and both `--> [*]` relations reach the same " +
      "`root_end`, so four lines draw four arrows between four states — " +
      "not six.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "Idle: box",
        "Busy: box",
        "end:1: ring+dot",
      ]);
      expectSame("transitions", transitions(result), [
        "start:1-Idle: ",
        "start:1-Busy: ",
        "Idle-end:1: ",
        "Busy-end:1: ",
      ]);
      // Said again as a count, because this is the half of the construct
      // most easily got wrong and the ids above would still read plausibly
      // if a second disc had been drawn on top of the first.
      expectSame(
        "exactly one start disc and one end ring are drawn",
        [
          elements(result, "circle.siren-state-start").length,
          elements(result, "circle.siren-state-end").length,
        ],
        [1, 1],
      );
    },
  },
  {
    id: "st-start-to-end",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> [*]`,
    status: "supported",
    meaning:
      "`[*] --> [*]` is legal, and it is one relation between two " +
      "different nodes — measured: `root_start → root_end`. Which " +
      "pseudo-state `[*]` names is decided by the side of the arrow it " +
      "sits on, so this is not a self-loop.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "end:1: ring+dot",
      ]);
      expectSame("transitions", transitions(result), ["start:1-end:1: "]);
      // Two distinct states, which is what makes this not a loop.
      expectSame("two states were drawn", elements(result, "g.siren-state").length, 2);
    },
  },
  {
    id: "st-pseudo-state-authored-name",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> root_start
      root_start --> B`,
    status: "supported",
    meaning:
      "A state the author names `root_start` is an ordinary state, and the " +
      "start pseudo-state is untouched by it: three nodes, two edges. " +
      "**Siren diverges from Mermaid here, and the divergence removes a " +
      "bug** — measured (11.17.2), Mermaid draws two nodes and the " +
      "relations `root_start → root_start` and `root_start → B`: its start " +
      "pseudo-state is spelled `root_start`, an ordinary `\\w+` name, so " +
      "the author's own state swallows it and the start's edge becomes a " +
      "self-loop nobody wrote, with no diagnostic. Siren's generated ids " +
      "carry a colon (ADR-0010) and authored ids are `\\w+`, so the " +
      "collision cannot be constructed. This is CONTEXT.md's one exception " +
      "to the absolute condition: Mermaid's own silent mis-renders.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "root_start: box",
        "B: box",
      ]);
      expectSame("transitions", transitions(result), [
        "start:1-root_start: ",
        "root_start-B: ",
      ]);
      // The author's own name is drawn on the author's own box, and the
      // self-loop Mermaid invents here is absent.
      expectSame(
        "the authored state keeps its name",
        texts(result, 'g.siren-state[data-siren-id="root_start"] text.siren-state-label'),
        ["root_start"],
      );
      expectSame(
        "no self-loop was invented",
        elements(result, "g.siren-transition").some((g) => idOf(g) === "root_start-root_start"),
        false,
      );
    },
  },
  {
    id: "st-description-colon",
    kind: "state",
    source: `stateDiagram-v2
      Idle : waiting for work
      Idle --> Running`,
    status: "supported",
    meaning:
      "`s : text` describes the state `s`. Measured (mermaid 11.17.2): the " +
      "text lands in `s`'s `descriptions` array, the id is unchanged, and " +
      "the **id stops being drawn** — the description is what the box " +
      "holds, the same split a flowchart's `A[label]` draws between the id " +
      "that addresses a node and the text that is drawn in it. An " +
      "undescribed state in the same diagram still draws its id.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running"]);
      expectSame("the described state's rows", stateRows(result, "Idle"), [
        "waiting for work",
      ]);
      expectSame("the undescribed state's rows", stateRows(result, "Running"), ["Running"]);
      // The id still addresses the state, which is what makes this a
      // description and not a rename.
      expectSame("transitions", transitions(result), ["Idle-Running: "]);
      // One description is a plain box: measured, Mermaid draws it with the
      // same rounded rect an undescribed state gets and no divider at all.
      expectSame(
        "one description draws no divider",
        stateRowGeometry(result, "Idle").dividerY,
        null,
      );
    },
  },
  {
    id: "st-description-quoted",
    kind: "state",
    source: `stateDiagram-v2
      state "waiting for work" as Idle
      Idle --> Running`,
    status: "supported",
    meaning:
      "`state \"text\" as s` is the other spelling of the very same thing, " +
      "and **not a rename** — the reading the keyword `as` invites. " +
      "Measured: the text lands in the same `descriptions` array and the " +
      "state is still `Idle`, so a transition still names it `Idle`. The " +
      "picture is the one `Idle : waiting for work` draws, down to the " +
      "undescribed state beside it keeping its id.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running"]);
      expectSame("the described state's rows", stateRows(result, "Idle"), [
        "waiting for work",
      ]);
      expectSame("the undescribed state's rows", stateRows(result, "Running"), ["Running"]);
      // The id survives the quoted spelling: a rename would leave nothing
      // called `Idle` for this transition to join.
      expectSame("transitions", transitions(result), ["Idle-Running: "]);
      expectSame(
        "one description draws no divider",
        stateRowGeometry(result, "Idle").dividerY,
        null,
      );
    },
  },
  {
    id: "st-description-accumulates",
    kind: "state",
    source: `stateDiagram-v2
      Idle : waiting for work
      state "nothing queued" as Idle
      Idle --> Running`,
    status: "supported",
    meaning:
      "Descriptions **accumulate**, and the two spellings share one list: " +
      "measured, `Idle : waiting for work` followed by " +
      "`state \"nothing queued\" as Idle` reports " +
      "`descriptions=[\"waiting for work\",\"nothing queued\"]` on the one " +
      "state. Two or more of them are drawn as a titled box — measured " +
      "with `--markup`: `rect.outer.title-state` plus a `line.divider`, " +
      "the **first** description titling the box above the line and the " +
      "rest below it.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running"]);
      // Both rows, in written order — a second description is another line
      // of text rather than a correction of the first.
      expectSame("the described state's rows", stateRows(result, "Idle"), [
        "waiting for work",
        "nothing queued",
      ]);
      // The first description is the row that titles the box.
      expectSame(
        "the title row",
        texts(result, 'g.siren-state[data-siren-id="Idle"] text.siren-state-label'),
        ["waiting for work"],
      );
      // And the divider is *between* them: a line drawn above the title row
      // or below the last row is still a `<line>` to find, and is the wrong
      // picture.
      const { rowYs, dividerY } = stateRowGeometry(result, "Idle");
      expectSame(
        `the divider sits between the two rows (rows at ${JSON.stringify(rowYs)}, divider at ${dividerY})`,
        dividerY !== null && dividerY > rowYs[0] && dividerY < rowYs[1],
        true,
      );
      expectSame("transitions", transitions(result), ["Idle-Running: "]);
    },
  },
  {
    id: "st-composite",
    kind: "state",
    source: `stateDiagram-v2
      state Outer {
        Idle --> Busy
      }`,
    status: "supported",
    meaning:
      "`state X { ... }` is a composite state: a state that holds a state " +
      "machine of its own. Measured (mermaid 11.17.2, `--markup`): the " +
      "block opens a level — the states inside it report `in=\"root/Outer\"` " +
      "— and it is drawn as a `g.statediagram-cluster`, a titled frame " +
      "around them rather than a box beside them.",
    assert: (result) => {
      // The frame is its own figure: a composite drawn as an ordinary box
      // would satisfy an id-only check and be the wrong picture.
      expectSame("states and their figures", stateFigures(result), [
        "Outer: frame",
        "Idle: box",
        "Busy: box",
      ]);
      expectSame("transitions", transitions(result), ["Idle-Busy: "]);
      // Titled with the author's own word — a composite's id is the name
      // they wrote, unlike a flowchart subgraph's generated one.
      expectSame(
        "the frame's title",
        texts(result, 'g.siren-state[data-siren-id="Outer"] text.siren-composite-label'),
        ["Outer"],
      );
      // "Around", as geometry: a frame drawn beside what it holds is still
      // a frame to find, and is the wrong picture.
      for (const member of ["Idle", "Busy"]) {
        expectSame(
          `${member} is drawn inside the frame`,
          encloses(stateRect(result, "Outer"), stateRect(result, member)),
          true,
        );
      }
    },
  },
  {
    id: "st-composite-nested",
    kind: "state",
    source: `stateDiagram-v2
      state Outer {
        Beside --> Also
        state Inner {
          Deep --> Deeper
        }
      }`,
    status: "supported",
    meaning:
      "Composite states nest: a block may open another. Measured: the " +
      "innermost states report `in=\"root/Outer/Inner\"`, so this is a frame " +
      "inside a frame and not two frames side by side.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "Outer: frame",
        "Beside: box",
        "Also: box",
        "Inner: frame",
        "Deep: box",
        "Deeper: box",
      ]);
      expectSame(
        "the inner frame is drawn inside the outer one",
        encloses(stateRect(result, "Outer"), stateRect(result, "Inner")),
        true,
      );
      expectSame("the inner frame holds its own", encloses(stateRect(result, "Inner"), stateRect(result, "Deep")), true);
      expectSame(
        "a state written beside the inner block is in the outer frame only",
        [encloses(stateRect(result, "Outer"), stateRect(result, "Beside")), encloses(stateRect(result, "Inner"), stateRect(result, "Beside"))],
        [true, false],
      );
    },
  },
  {
    id: "st-composite-transition-endpoint",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Outer
      state Outer {
        Inner --> Other
      }
      Outer --> Done`,
    status: "supported",
    meaning:
      "A transition may name a composite at either end. Measured: " +
      "`[*] --> Outer` and `Outer --> Done` are recorded as relations " +
      "`in=\"root\"` naming `Outer` itself, so the arrow joins the **frame**, " +
      "not a state inside it.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "Outer: frame",
        "Inner: box",
        "Other: box",
        "Done: box",
      ]);
      expectSame("transitions", transitions(result), [
        "start:1-Outer: ",
        "Inner-Other: ",
        "Outer-Done: ",
      ]);
      // On the frame's own boundary, as geometry. The layout engine cannot
      // route to a frame, so the route goes through a member and is clipped
      // back — a row asking only "was a path drawn?" would pass on an
      // arrowhead buried inside the frame, pointing at that stand-in.
      expectSame(
        "the arrow into the composite ends on the frame",
        transitionTouches(result, "start:1-Outer", "end", "Outer"),
        true,
      );
      expectSame(
        "the arrow out of the composite starts on the frame",
        transitionTouches(result, "Outer-Done", "start", "Outer"),
        true,
      );
    },
  },
  {
    id: "st-composite-self-transition",
    kind: "state",
    source: `stateDiagram-v2
      Running --> Running : heartbeat
      state Running {
        Fetching --> Publishing
      }`,
    status: "supported",
    meaning:
      "A composite may name itself at both ends of a transition, and the " +
      "loop belongs to the **frame**: drawn outside it, with both ends on " +
      "the frame's own outline. Not inside it beside a member, which is " +
      "what the layout engine's own self-edge route gives — a frame's " +
      "transition is routed through a member standing in for it, so that " +
      "member's loop lands in the middle of the frame and reads as the " +
      "member's. `examples/state-core.srn` ships this construct on the " +
      "gallery page (`Running --> Running : heartbeat`, `Running` " +
      "composite), which is why it is measured here rather than left to " +
      "the flowchart row that found it.",
    assert: (result) => {
      expectSame("states and their figures", stateFigures(result), [
        "Running: frame",
        "Fetching: box",
        "Publishing: box",
      ]);
      expectSame("transitions", transitions(result), [
        "Running-Running: heartbeat",
        "Fetching-Publishing: ",
      ]);

      const frame = stateRect(result, "Running");
      const loop = transitionPath(result, "Running-Running");
      expectSame(
        `the loop is drawn through more than one point (got ${JSON.stringify(loop)})`,
        loop.length > 1,
        true,
      );
      // The half that separates "a loop was drawn" from "drawn on the right
      // side of the frame": every point outside, not merely the two ends on
      // the outline. A loop drawn across the inside of the frame can have
      // both ends on it too.
      expectSame(
        `no point of the loop is inside the frame ${JSON.stringify(frame)}`,
        loop.filter((point) => insideBox(frame, point)),
        [],
      );
      expectSame(
        `the loop starts on the frame's own outline (at ${JSON.stringify(loop[0])})`,
        onBoxBoundary(frame, loop[0]),
        true,
      );
      expectSame(
        `and ends on it (at ${JSON.stringify(loop[loop.length - 1])})`,
        onBoxBoundary(frame, loop[loop.length - 1]),
        true,
      );
      // And nowhere near the member it used to be drawn around.
      expectSame(
        "no point of the loop is inside a member of the frame",
        loop.filter((point) => insideBox(stateRect(result, "Fetching"), point)),
        [],
      );
      expectSame(
        `the whole loop is inside the picture ${JSON.stringify(pictureBox(result))}`,
        loop.filter((point) => !holds(pictureBox(result), point)),
        [],
      );
    },
  },
  {
    id: "st-composite-direction",
    kind: "state",
    source: `stateDiagram-v2
      Before --> Outer
      state Outer {
        direction LR
        First --> Second
      }`,
    status: "supported",
    meaning:
      "`direction LR` inside a composite is that block's own rank " +
      "direction. Measured: mermaid 11.17.2 records it on the composite and " +
      "leaves the document's own direction `TB`, so the block alone lays " +
      "out sideways.",
    assert: (result) => {
      const centre = (id: string) => stateRectCenter(result, id);
      // Sideways inside the block, read off the picture: `Second` to the
      // right of `First`, and on the same row.
      expectSame(
        `Second is drawn right of First (${JSON.stringify([centre("First"), centre("Second")])})`,
        centre("Second").x > centre("First").x,
        true,
      );
      expectSame(
        "and on the same row",
        Math.abs(centre("Second").y - centre("First").y) < 1,
        true,
      );
      // Top to bottom outside it: a `direction` that leaked to the document
      // would draw this pair side by side instead.
      expectSame(
        "the composite is still drawn below the state pointing at it",
        centre("Outer").y > centre("Before").y,
        true,
      );
    },
  },
  {
    id: "st-composite-pseudo-state",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Outer
      state Outer {
        [*] --> Inner
        Inner --> [*]
      }
      Outer --> [*]`,
    status: "supported",
    meaning:
      "A composite's `[*]` is **that composite's** start and end, not the " +
      "document's. Measured: the inner relation comes back from " +
      "`Outer_start in=\"root/Outer\"` while the outer one comes from " +
      "`root_start` — two different start pseudo-states, one per level, and " +
      "the same for the two ends.",
    assert: (result) => {
      // Four pseudo-states, two per level, each drawn as its own mark.
      // Siren's generated ids number the levels (ADR-0010), the document's
      // first.
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "Outer: frame",
        "start:2: disc",
        "Inner: box",
        "end:2: ring+dot",
        "end:1: ring+dot",
      ]);
      expectSame("transitions", transitions(result), [
        "start:1-Outer: ",
        "start:2-Inner: ",
        "Inner-end:2: ",
        "Outer-end:1: ",
      ]);
      // And the inner level really is inside the frame: a `[*]` read as the
      // document's would draw its arrow from outside it.
      expectSame("the inner state is inside the frame", encloses(stateRect(result, "Outer"), stateRect(result, "Inner")), true);
    },
  },
  // The six constructs the State Diagram board deliberately left out. Each
  // one is valid Mermaid, measured against 11.17.2 with
  // `scripts/mermaid-probe.mjs`, and each arrived here `rejected` — refused
  // **by name** by `parseStateDiagram`'s `UNIMPLEMENTED` table rather than
  // swallowed or reported as a malformed line. They were this file's first
  // `rejected` rows since the flowchart backlog closed, and they are honest
  // backlog: written down so the gap is measured rather than forgotten.
  //
  // A row leaves by *starting to work*, and four have: `st-direction-document`,
  // `st-composite-quoted-description`, `st-author-style` and `st-note` are
  // `supported` now, each with an assert reading the rendered SVG. The two
  // still marked `rejected` below are what is left of the six.
  {
    id: "st-stereotype-choice",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Idle
      state Choice <<choice>>
      Idle --> Choice
      Choice --> Busy`,
    status: "rejected",
    meaning:
      "`<<choice>>`, `<<fork>>` and `<<join>>` mark a state as a pseudo-state " +
      "drawn as a diamond or a bar rather than as a box. Measured: a closed " +
      "set of three, recorded as a `type` field on the state itself " +
      "(`id=\"Choice\" type=\"choice\"`) — the state keeps its authored id and " +
      "its place in the relations, so this is a change of figure, not a " +
      "change of structure.",
  },
  {
    id: "st-note",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Busy
      note right of Idle : waiting for work`,
    status: "supported",
    meaning:
      "A note attached to one state, on the left or the right of it. " +
      "Measured: the note hangs off **the state itself** as " +
      "`note={\"position\":\"right of\",\"text\":\"waiting for work\"}` — not a " +
      "separate note collection the way a class diagram's is, so a state " +
      "carries at most one and it is addressable only through that state. " +
      "Measured again, and this is what decided the field is singular rather " +
      "than a list: a second `note ... of Idle` **replaces** the first, " +
      "whichever sides the two were written on. Measured with `--markup` and " +
      "against mermaid's own graph construction: the note is a **node of the " +
      "layout graph**, drawn as its own `g.node.statediagram-note` and joined " +
      "to its state by an edge built with `arrowhead: \"none\"` and the class " +
      "`note-edge`, which mermaid's stylesheet dashes " +
      "(`stroke-dasharray: 5`). The position is spent entirely as that " +
      "edge's **direction** — `right of` builds `state → note`, `left of` " +
      "builds `note → state` — so the two words are rank-relative: left and " +
      "right under `direction LR`, above and below under the default `TB`. " +
      "Siren draws it the same way, through the same shared layout core, " +
      "because it is the same mechanism. The note has **no id**: mermaid " +
      "names the drawn one after its state (`state-Idle----note-1`) and the " +
      "author writes none, so it is not a timeline target (ADR-0009) and is " +
      "drawn inside the annotated state's own group, animating with it.",
    assert: (result) => {
      // The note itself, read off the picture: its text, drawn inside the
      // group of the state it annotates. A row checking only that the words
      // appear somewhere would pass on a note drawn beside the wrong state.
      expectSame("the note's text is drawn on Idle", stateNoteText(result, "Idle"), [
        "waiting for work",
      ]);
      expectSame("and on no other state", stateNoteText(result, "Busy"), []);
      // A figure of its own, not a row inside the box: the note's rect and
      // the state's rect do not overlap.
      expectSame(
        `the note is a separate box (${JSON.stringify([stateRect(result, "Idle"), stateNoteRect(result, "Idle")])})`,
        overlaps(stateRect(result, "Idle"), stateNoteRect(result, "Idle")),
        false,
      );
      // Placed as the author's `right of` asks under this document's own
      // direction, which is `TB` — so after the state, exactly as mermaid's
      // `state → note` edge ranks it.
      expectSame(
        "the note is drawn after Idle along the diagram's direction",
        stateNoteRect(result, "Idle").top >= stateRect(result, "Idle").bottom,
        true,
      );
      // The connector mermaid draws too, tying the two figures together —
      // and with no arrowhead, which is what keeps it from reading as a
      // transition into the note.
      expectSame(
        "a connector joins them",
        drew(result, 'g.siren-state[data-siren-id="Idle"] path.siren-note-link'),
        true,
      );
      expectSame("with no arrowhead", stateNoteConnectorMarker(result, "Idle"), null);
      // And no fourth timeline target was invented for it: the ids in the
      // picture are the two states and the one transition, and nothing else.
      expectSame("no id is minted for the note", states(result), ["Idle", "Busy"]);
      expectSame("and the transition is still the only connector id", transitions(result), [
        "Idle-Busy: ",
      ]);
    },
  },
  {
    id: "st-concurrency-divider",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Active
      state Active {
        Reading --> Parsing
        --
        Logging --> Flushed
      }`,
    status: "rejected",
    meaning:
      "`--` inside a composite splits it into concurrent regions. Measured: " +
      "Mermaid synthesises `divider`-typed states and re-parents each " +
      "region's members under one of them (`in=\"root/Active/divider-id-1\"`), " +
      "and **their ids carry a random component** — the second divider came " +
      "back as `id-g8d8ncxe8va-1`, a different string on every run. So an " +
      "implementation must mint its own ids through `generatedId` (ADR-0010) " +
      "and must not copy Mermaid's, which are not reproducible.",
  },
  {
    id: "st-author-style",
    kind: "state",
    source: `stateDiagram-v2
      classDef urgent fill:#f96
      Idle --> Busy
      class Busy urgent`,
    status: "supported",
    meaning:
      "`classDef` defines a named set of declarations and the apply-directive " +
      "`class Busy urgent` applies it. Measured: a state diagram supports " +
      "both — the state carries a `classes` array (`classes=[\"urgent\"]`) and " +
      "`getClasses()` returns the definitions, the same shape a flowchart's " +
      "and a class diagram's already have. Measured again with `--markup`: " +
      "mermaid 11.17.2 puts the class on the state's own `<g>` and emits " +
      "`#id .urgent rect { fill:#f96 !important }` beside it, and the drawn " +
      "`rect.basic.label-container` comes back carrying `fill:#f96` — so the " +
      "author's declaration reaches the **figure**, not only the database. " +
      "Two more halves of the construct, measured the same way: a state " +
      "wearing two classes takes them from two `class` statements (a comma " +
      "list in the *class-name* position is read as one name — " +
      "`class Busy a,b` reports `classes=[\"a,b\"]`), and they stack in " +
      "**application order**, the later value winning a property both declare " +
      "while the properties themselves merge; a comma list in the *target* " +
      "position does split (`class Busy,Done urgent` styles both). Siren " +
      "resolves all of that in the shared `resolveStyles`, which already gave " +
      "a flowchart and a class diagram the identical rules.",
    assert: (result) => {
      // Read off the picture, not off the model: the declaration has to be
      // on the element the browser paints, or the row would pass on a
      // `classes` array nothing draws — which is exactly the shape of
      // "parses with no diagnostic and renders wrong" this file exists to
      // catch.
      expectSame(
        "the author's `fill` is on the styled state's own rect",
        stateStyle(result, "Busy"),
        "fill:#f96",
      );
      // And the contrast that says it was *applied* rather than painted on
      // everything: the state no `class` statement named carries no inline
      // declaration at all.
      expectSame("and the unstyled state carries none", stateStyle(result, "Idle"), "");
    },
  },
  {
    id: "st-direction-document",
    kind: "state",
    source: `stateDiagram-v2
      direction LR
      Idle --> Busy
      Busy --> Done`,
    status: "supported",
    meaning:
      "`direction LR` written at the document's own level, outside any " +
      "composite, sets the whole diagram's rank direction. Measured: the " +
      "document reports `direction LR`, and mermaid 11.17.2 draws these " +
      "three states at x = 28, 158 and 288 with every one of them at y = 18 " +
      "— sideways, on one row. The **first** such statement wins and a " +
      "later one at the same level is inert (measured: `direction LR` then " +
      "`direction RL` still reports `LR`), which is where this kind parts " +
      "company with a class diagram's last-wins rule. A composite's own " +
      "`direction` (`st-composite-direction`) is the other half of the " +
      "construct and governs that block alone.",
    assert: (result) => {
      const centre = (id: string) => stateRectCenter(result, id);
      // Sideways, read off the picture: each successor to the right of the
      // state pointing at it. Under the `TB` a document naming no direction
      // gets, these three are stacked instead.
      expectSame(
        `Busy is drawn right of Idle (${JSON.stringify([centre("Idle"), centre("Busy")])})`,
        centre("Busy").x > centre("Idle").x,
        true,
      );
      expectSame(
        `and Done right of Busy (${JSON.stringify(centre("Done"))})`,
        centre("Done").x > centre("Busy").x,
        true,
      );
      // And on one row, which is what says the rank direction reached the
      // layout rather than the boxes merely differing in width.
      expectSame(
        "all three are drawn on one row",
        [centre("Busy").y - centre("Idle").y, centre("Done").y - centre("Idle").y].filter(
          (gap) => Math.abs(gap) >= 1,
        ),
        [],
      );
    },
  },
  {
    id: "st-composite-quoted-description",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Outer
      state "the outer block" as Outer {
        First --> Second
      }`,
    status: "supported",
    meaning:
      "The quoted-description spelling with a block on it. Measured: one " +
      "composite `Outer` carrying `descriptions=[\"the outer block\"]` with " +
      "`First` and `Second` nested `in=\"root/Outer\"` — both constructs at " +
      "once, and the *same* document the two written apart produce " +
      "(`state \"the outer block\" as Outer` above a separate " +
      "`state Outer { ... }` dumps state for state and relation for " +
      "relation identically). **Where the description is drawn** is the " +
      "half a `descriptions` check cannot see, so it was measured too, with " +
      "`--markup`: it is the frame's `g.cluster-label`, in the strip along " +
      "the top — the text that would have read `Outer` had no description " +
      "been written, with the members below it inside `rect.inner`. So the " +
      "description **replaces the frame's title**; it is not a second row " +
      "beside it and not a box of its own.",
    assert: (result) => {
      // A frame, not a box: the block half of the line survived. A row that
      // read only the text would pass on a description drawn in an ordinary
      // state box with `First` and `Second` stranded beside it.
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "Outer: frame",
        "First: box",
        "Second: box",
      ]);
      // And the description half survived, drawn — read out of the picture,
      // not off the model. `Outer` appears nowhere in this group, which is
      // the part that says the description *replaced* the title rather than
      // joining it.
      expectSame("the frame's text", stateRows(result, "Outer"), ["the outer block"]);
      expectSame(
        "and it is the frame's title, not a state box's label",
        texts(result, 'g.siren-state[data-siren-id="Outer"] text.siren-composite-label'),
        ["the outer block"],
      );
      // In the strip along the top, as geometry: a title drawn level with
      // the members it encloses, or below them, is still a title to find and
      // is the wrong picture.
      const { rowYs, dividerY } = stateRowGeometry(result, "Outer");
      expectSame(
        `the title sits above every member (title at ${rowYs[0]}, first member's top at ${stateRect(result, "First").top})`,
        rowYs[0] < stateRect(result, "First").top &&
          rowYs[0] < stateRect(result, "Second").top,
        true,
      );
      // No divider under it: the line under a described *state*'s title row
      // closes a compartment, and what is under this strip is the members'
      // own boxes.
      expectSame("a frame's title strip closes no compartment", dividerY, null);
      // "Under it", as containment — the members are the block's, not the
      // document's.
      for (const member of ["First", "Second"]) {
        expectSame(
          `${member} is drawn inside the frame`,
          encloses(stateRect(result, "Outer"), stateRect(result, member)),
          true,
        );
      }
      // The id survives the description, exactly as it does without a block:
      // `[*] --> Outer` still reaches the frame.
      expectSame("transitions", transitions(result), [
        "start:1-Outer: ",
        "First-Second: ",
      ]);
    },
  },
];
