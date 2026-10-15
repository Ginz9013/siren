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
import type { Point, SirenRenderResult } from "../contracts";
import { LABEL_CASES, labelRows, labelRuns } from "./labelCorpus";
import {
  type Box,
  distanceToPolyline,
  encloses,
  ER_SUBGRAPH,
  holds,
  interiorsMeet,
  rectBox,
  routeOf,
  subgraphFrames,
} from "./svgGeometry";

/** Which Mermaid diagram kind a case is written in. */
export type CompatKind = "flowchart" | "class" | "sequence" | "state" | "er";

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
  /**
   * Warning messages a `supported` construct is expected to report, word
   * for word — for a picture Siren draws exactly as Mermaid does while still
   * telling the author something (`linkStyle 0 interpolate zigzag` draws
   * `basis`, as Mermaid does, and names no curve). The runner fails the row
   * if one is missing, and still counts every other diagnostic as noise.
   */
  warnings?: readonly string[];
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
 * A node's drawn label rows — `labelRows` (in `labelCorpus.ts`) on that
 * node's `<text>`. `textOf` already proves the *text* survived; this is what
 * a row about a label's structure needs beyond that: proof that each row is
 * its own `tspan.siren-label-row` and that a bold/italic run actually
 * carries `font-weight`/`font-style`, not merely that the letters are on the
 * page.
 */
function nodeLabelRows(result: SirenRenderResult, id: string): string[] {
  return labelRows(svgOf(result).querySelector(`g.siren-node[data-siren-id="${id}"] text`));
}

/**
 * How far apart the rows of the first `<text>` matching `selector` are drawn:
 * the gap from each `tspan.siren-label-row`'s `y` to the next, to three
 * decimals — the line height a reader sees between two rows of one label.
 */
function rowGaps(result: SirenRenderResult, selector: string): number[] {
  const rows = Array.from(svgOf(result).querySelector(selector)?.querySelectorAll(":scope > tspan.siren-label-row") ?? []);
  const ys = rows.map((row) => Number(row.getAttribute("y")));
  return ys.slice(1).map((y, index) => Number((y - ys[index]!).toFixed(3)));
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
function edgeLabelCenter(result: SirenRenderResult, id: string): Point {
  const text = svgOf(result).querySelector(`text.siren-edge-label[data-siren-id="${id}"]`);
  if (text === null) throw new Error(`no label was drawn on edge "${id}"`);
  return { x: Number(text.getAttribute("x")), y: Number(text.getAttribute("y")) };
}

/**
 * How far a label's centre is drawn from the line it labels: the distance
 * from the `<text>` matched by `labelSelector` (its `x`/`y`, the anchor it is
 * centred on) to the nearest segment of the route of the `<path>` matched by
 * `lineSelector` (`pathPoints`: the routed points, not the curve's control
 * points).
 *
 * The reader for "the label is on its line", which is where Mermaid puts one
 * (`labelpos: "c"`): the label's space is reserved at a point the route
 * passes through. Distance rather than equality with one of the points, so
 * the reading does not depend on how many bends the engine drew.
 */
function labelDistanceFromLine(
  result: SirenRenderResult,
  labelSelector: string,
  lineSelector: string,
): number {
  const text = svgOf(result).querySelector(labelSelector);
  if (text === null) throw new Error(`nothing matched "${labelSelector}"`);
  const label = { x: Number(text.getAttribute("x")), y: Number(text.getAttribute("y")) };
  return distanceToPolyline(label, pathPoints(result, lineSelector));
}

/**
 * How close is "on the line": half a pixel. The anchor is a point the engine
 * routed the line through, so the distance is 0 up to rounding; the old
 * placement beside the line was at least 10 away (`labeloffset`).
 */
const ON_THE_LINE = 0.5;

/**
 * Throws unless the label `labelDistanceFromLine` reads is on its line,
 * naming how far off it was drawn — the number a reader needs to tell a
 * rounding slip from a label placed beside the line.
 */
function expectOnTheLine(
  what: string,
  result: SirenRenderResult,
  labelSelector: string,
  lineSelector: string,
): void {
  const distance = labelDistanceFromLine(result, labelSelector, lineSelector);
  if (!(distance <= ON_THE_LINE)) {
    throw new Error(
      `${what} is drawn ${distance} from its line, not on it (within ${ON_THE_LINE})`,
    );
  }
}

/**
 * The two ends of one edge's drawn path, read off the `d` attribute itself.
 *
 * Where a path *starts* and *stops* is the whole of what "this edge joins
 * these two things" means in a picture, and it is the only reader here that
 * can tell an edge that meets a frame from one that stops at a box inside
 * it. Everything between the ends is left alone on purpose: how many bends
 * the route takes is the layout engine's, not a fact about Mermaid.
 *
 * Off `d` still, though a connector is drawn as a curve: every curve starts
 * with `M` on the route's first point and ends with `L` on its last, so the
 * first and last commands are the route's ends whatever lies between.
 */
function edgeEnds(
  result: SirenRenderResult,
  id: string,
): { start: Point; end: Point } {
  const path = svgOf(result).querySelector(`path.siren-edge[data-siren-id="${id}"]`);
  if (path === null) throw new Error(`no edge "${id}" was drawn`);
  const points = (path.getAttribute("d") ?? "").split(/\s+/).map((command) => {
    const [x, y] = command.slice(1).split(",");
    return { x: Number(x), y: Number(y) };
  });
  return { start: points[0], end: points[points.length - 1] };
}

/**
 * **Every** point one connector's route passes through, read off the
 * `data-siren-points` its renderer writes beside `d`.
 *
 * The reader a *self-loop* needs, and the reason it is not `edgeEnds`. A
 * loop's two ends say whether it is joined to the right figure; they say
 * nothing about which side of that figure it was drawn on, and a loop around
 * a frame and a loop buried inside one can share both ends. Only the points
 * between them tell those two pictures apart, so a row asking "is this drawn
 * outside the frame" has to see all of them.
 *
 * Not off `d`: a connector is drawn as a curve (`basis` by default, as in
 * Mermaid), and a curve's `d` lists control points the line never passes
 * through, not the route. The route is kept on the path for readers like
 * this one (`drawConnectorRoute` in `renderer/connectorCurve.ts`). A path
 * without it throws rather than reading as an empty route, so a renderer
 * that stopped writing it fails every row that asks.
 *
 * Takes the selector rather than assuming one, because a flowchart edge and
 * a state transition are two elements with two class names and one question.
 */
function pathPoints(
  result: SirenRenderResult,
  selector: string,
): Point[] {
  const path = svgOf(result).querySelector(selector);
  if (path === null) throw new Error(`nothing matched "${selector}"`);
  return routeOf(path);
}

/**
 * How one flowchart edge's line joins its route — the **Curve** it was
 * drawn with, read as geometry off `d` against the route in
 * `data-siren-points`, never off a curve name:
 *
 * - `curved` — `d` holds a cubic (`C`), as `basis` draws;
 * - `rounded corners` — `d` holds quadratics (`Q`) at the route's corners,
 *   as `rounded` draws (Mermaid 12's default on ELK);
 * - `through its route` — straight segments through exactly the routed
 *   points and nothing else, as `linear` draws;
 * - `axis-aligned steps` — straight segments, every one horizontal or
 *   vertical, through points the route does not have, as `step`,
 *   `stepBefore` and `stepAfter` draw.
 *
 * **On an orthogonal route the last two look alike**, and since the flowchart
 * moved onto ELK every route is orthogonal: a staircase drawn along a route
 * that is already a staircase lies on top of it. What still tells them apart
 * is the `d` itself — d3's `Step` writes a turn for every segment (halfway
 * along it for `step`, at one end for the other two), so its points are the
 * route's plus the turns, while `linear` writes the route's and no others.
 * That is a difference in what was drawn, not in how it looks, and the rows
 * that use this say so.
 */
function edgeCurve(result: SirenRenderResult, id: string): string {
  const path = svgOf(result).querySelector(`path.siren-edge[data-siren-id="${id}"]`);
  if (path === null) throw new Error(`no edge "${id}" was drawn`);
  const d = path.getAttribute("d") ?? "";
  if (d.includes("C")) return "curved";
  if (d.includes("Q")) return "rounded corners";
  const drawn = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => `${Number(x)},${Number(y)}`);
  const route = routeOf(path).map(({ x, y }) => `${x},${y}`);
  if (JSON.stringify(drawn) === JSON.stringify(route)) return "through its route";
  const axisAligned = drawn.every((point, i) => {
    if (i === 0) return true;
    const [x0, y0] = drawn[i - 1].split(",");
    const [x1, y1] = point.split(",");
    return x0 === x1 || y0 === y1;
  });
  if (axisAligned) return "axis-aligned steps";
  throw new Error(`edge "${id}" is drawn with an unrecognized line: "${d}"`);
}

/** Every point one flowchart edge's line is drawn through. */
function edgePoints(
  result: SirenRenderResult,
  id: string,
): Point[] {
  return pathPoints(result, `path.siren-edge[data-siren-id="${id}"]`);
}

/** Every point one state transition's line is drawn through. */
function transitionPath(
  result: SirenRenderResult,
  id: string,
): Point[] {
  return pathPoints(
    result,
    `g.siren-transition[data-siren-id="${id}"] path.siren-transition-line`,
  );
}

/** The runs of `route` that are neither horizontal nor vertical — none, on an orthogonal route. */
function slantedRuns(route: Point[]): string[] {
  return route.slice(1).flatMap((point, index) => {
    const previous = route[index];
    return Math.abs(point.x - previous.x) < 1e-6 || Math.abs(point.y - previous.y) < 1e-6
      ? []
      : [`(${previous.x}, ${previous.y}) → (${point.x}, ${point.y})`];
  });
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
function pictureBox(result: SirenRenderResult): Box {
  const [x, y, width, height] = (svgOf(result).getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  return { top: y, bottom: y + height, left: x, right: x + width };
}

/**
 * How near a computed point has to be to an outline to count as on it: a
 * rounding allowance, so a point the layout put exactly on a side is not
 * read as one side of it or the other. `holds`, `insideBox`, `onBoxBoundary`
 * and `transitionTouches` all read with it, so they never disagree about a point.
 */
const ON_OUTLINE = 1e-6;

/**
 * Whether `point` lies strictly within `box` — on the outline is not inside,
 * to the same tolerance `transitionTouches` calls a point "on" a boundary
 * with, so that the two never disagree about a point on the line.
 */
function insideBox(
  box: Box,
  point: Point,
): boolean {
  return (
    point.x > box.left + ON_OUTLINE &&
    point.x < box.right - ON_OUTLINE &&
    point.y > box.top + ON_OUTLINE &&
    point.y < box.bottom - ON_OUTLINE
  );
}

/**
 * Whether `point` sits on `box`'s own outline — within it on both axes and
 * level with one of its four sides. `transitionTouches`'s rule, over a box a
 * row already has in hand rather than over a state it names.
 */
function onBoxBoundary(
  box: Box,
  point: Point,
): boolean {
  const within = holds(box, point, ON_OUTLINE);
  const level =
    Math.abs(point.x - box.left) < ON_OUTLINE ||
    Math.abs(point.x - box.right) < ON_OUTLINE ||
    Math.abs(point.y - box.top) < ON_OUTLINE ||
    Math.abs(point.y - box.bottom) < ON_OUTLINE;
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
function nodeCenter(result: SirenRenderResult, id: string): Point {
  const { top, bottom, left, right } = nodeBox(result, id);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** One node's drawn frame as its four sides, which `nodeCenter` is the middle of. */
function nodeBox(
  result: SirenRenderResult,
  id: string,
): Box {
  const frame = svgOf(result).querySelector(
    `g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`,
  );
  if (frame === null) throw new Error(`no node "${id}" was drawn`);
  return rectBox(frame);
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
): Box {
  const box = subgraphFrames(svgOf(result)).find((drawn) => drawn.title === title)?.box;
  if (box === undefined || box === null) {
    throw new Error(`no subgraph titled "${title}" was drawn`);
  }
  return box;
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

/**
 * The inline author style one class box is painted with, as two halves:
 * `frame` from its `rect.siren-class-frame` and `name` from its
 * `text.siren-class-name` — `""` for a half the author styled with nothing.
 *
 * `nodeStyle` and `stateStyle`'s answer for this kind, read the same way:
 * the attribute the browser will paint from, rather than the model upstream
 * of it. Two halves because the author's `color` lands on the label and not
 * on the frame, so a reader of the rectangle alone could not tell "the
 * label was recoloured" from "the `color` was dropped".
 */
function classStyle(result: SirenRenderResult, id: string): { frame: string; name: string } {
  const g = svgOf(result).querySelector(`g.siren-class[data-siren-id="${id}"]`);
  if (g === null) throw new Error(`no class "${id}" was drawn`);
  return {
    frame: g.querySelector("rect.siren-class-frame")?.getAttribute("style") ?? "",
    name: g.querySelector("text.siren-class-name")?.getAttribute("style") ?? "",
  };
}

/** Every class-diagram class as `id`, in draw order. */
function classes(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-class").map(idOf);
}

/** The top-left corner of one class's frame — how a direction is visible in the result. */
function classBox(result: SirenRenderResult, id: string): Point {
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

/** The sequence lanes left to right, read off the lifelines' x positions. */
function laneOrder(result: SirenRenderResult): string[] {
  return elements(result, "line.siren-lifeline")
    .sort((a, b) => Number(a.getAttribute("x1")) - Number(b.getAttribute("x1")))
    .map(idOf);
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

/** One drawn sequence arrow: its message's id, where it starts and ends, and its row. */
interface DrawnArrow {
  id: string;
  fromX: number;
  toX: number;
  y: number;
}

/** Every sequence message's arrow, read off its path (`M fromX,y L toX,y`), in draw order. */
function messageArrows(result: SirenRenderResult): DrawnArrow[] {
  return elements(result, "g.siren-message").map((g) => {
    const [fromX, y, toX] = [...(g.querySelector("path.siren-message-arrow")?.getAttribute("d") ?? "").matchAll(/-?[\d.]+/g)].map(Number);
    return { id: idOf(g), fromX: fromX!, toX: toX!, y: y! };
  });
}

/** `below <message>` for a drawing at `y` on no arrow: the last arrow above it, or the top row. */
function belowArrow(arrows: readonly DrawnArrow[], y: number): string {
  const above = arrows.filter((arrow) => arrow.y < y).sort((a, b) => b.y - a.y)[0];
  return `below ${above?.id ?? "the top row"}`;
}

/**
 * Where a destroyed participant's lifeline ends, read off the drawn picture:
 * `tip of <message>` or `tail of <message>` when its X mark sits on that end
 * of a message's arrow, `below <message>` when it sits on no arrow (on a row
 * of its own, under the last arrow above it), each followed by
 * `, lifeline stops there` when the lifeline's bottom is the mark's centre.
 * The words name the relation a reader sees — the X on the arrow the
 * participant receives or sends — rather than coordinates no assert could
 * hold still.
 */
function lifelineEnd(result: SirenRenderResult, participantId: string): string {
  const mark = svgOf(result).querySelector(`path.siren-destroy-mark[data-siren-id="${participantId}"]`);
  if (mark === null) return "no destroy mark";
  const [left, top, right, bottom] = [...(mark.getAttribute("d") ?? "").matchAll(/-?[\d.]+/g)].map(Number);
  const centre = { x: (left! + right!) / 2, y: (top! + bottom!) / 2 };
  const lifeline = svgOf(result).querySelector(`line.siren-lifeline[data-siren-id="${participantId}"]`);
  const stops = Number(lifeline?.getAttribute("y2")) === centre.y ? ", lifeline stops there" : "";

  const arrows = messageArrows(result);
  for (const arrow of arrows) {
    if (arrow.y !== centre.y) continue;
    if (arrow.toX === centre.x) return `tip of ${arrow.id}${stops}`;
    if (arrow.fromX === centre.x) return `tail of ${arrow.id}${stops}`;
  }
  return `${belowArrow(arrows, centre.y)}${stops}`;
}

/**
 * Where a created participant's box is drawn, read off the picture:
 * `centred on <message>, whose arrow stops at its left edge` (or right edge,
 * or `runs to its lane` when it does not stop short) when the box's centre
 * is on a message's arrow ending at that participant, `below <message>` when
 * it sits on no arrow (on a row of its own, under the last arrow above it).
 * The words name what a reader sees — the box on the arrow that creates the
 * participant — rather than coordinates no assert could hold still.
 */
function createdBox(result: SirenRenderResult, participantId: string): string {
  const rect = participantRects(result, participantId)[0];
  if (rect === undefined) return "no box";
  const [x, y, width, height] = ["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
  const centre = { x: x! + width! / 2, y: y! + height! / 2 };

  const ends: [number, string][] = [
    [x!, "stops at its left edge"],
    [x! + width!, "stops at its right edge"],
    [centre.x, "runs to its lane"],
  ];
  const arrows = messageArrows(result);
  for (const arrow of arrows) {
    if (arrow.y !== centre.y) continue;
    const end = ends.find(([at]) => at === arrow.toX)?.[1] ?? `ends at x ${arrow.toX}`;
    return `centred on ${arrow.id}, whose arrow ${end}`;
  }
  return belowArrow(arrows, centre.y);
}

/**
 * How a sequence participant is drawn, as positions to compare with another
 * participant's rather than to hold still: the y of every box drawn for it
 * (top row, and bottom row when it has one) and its lifeline's span. Two
 * participants drawn alike — boxes in the same rows, lifelines from the same
 * top to the same bottom — read the same here.
 */
function participantRows(result: SirenRenderResult, participantId: string): string {
  const svg = svgOf(result);
  const boxes = participantRects(result, participantId).map((rect) => rect.getAttribute("y"));
  const lifeline = svg.querySelector(`line.siren-lifeline[data-siren-id="${participantId}"]`);
  return `boxes at y ${boxes.join(", ")}; lifeline ${lifeline?.getAttribute("y1")}..${lifeline?.getAttribute("y2")}`;
}

/**
 * Where a sequence participant's bottom-row box ends, as the bottom edge of
 * the box drawn for it after its top one, or `null` when it is drawn only
 * once. Read off `rect`s, so for a `participant` and not an `actor`.
 */
function bottomRowEdge(result: SirenRenderResult, participantId: string): number | null {
  const rect = participantRects(result, participantId)[1];
  return rect === undefined ? null : Number(rect.getAttribute("y")) + Number(rect.getAttribute("height"));
}

/** A sequence participant's top box, as its left edge and width. */
function topBox(result: SirenRenderResult, participantId: string): { left: number; width: number } {
  const rect = participantRects(result, participantId)[0];
  return { left: Number(rect?.getAttribute("x")), width: Number(rect?.getAttribute("width")) };
}

/**
 * The `rect`s drawn for a sequence participant, in document order: its top
 * box first, then its bottom-row box when it has one. None for an `actor`.
 */
function participantRects(result: SirenRenderResult, participantId: string): Element[] {
  return Array.from(svgOf(result).querySelectorAll(`g.siren-participant[data-siren-id="${participantId}"] rect`));
}

/** The horizontal gap between two neighbouring participants' top boxes, `leftId`'s right edge to `rightId`'s left. */
function laneGap(result: SirenRenderResult, leftId: string, rightId: string): number {
  const left = topBox(result, leftId);
  return topBox(result, rightId).left - (left.left + left.width);
}

/** Where a sequence participant's lifeline ends, as its drawn `y2`. */
function lifelineBottom(result: SirenRenderResult, participantId: string): string | null {
  return svgOf(result).querySelector(`line.siren-lifeline[data-siren-id="${participantId}"]`)?.getAttribute("y2") ?? null;
}

/**
 * Where a created actor's creating message ends, read off the drawn figure:
 * `<message> stops at its left arm tip, <n> short of its lane` (or right),
 * or `<message> ends at x <n>` when the arrow meets no arm tip. The arms
 * are the figure's widest stroke, so its leftmost and rightmost line ends
 * are the tips; the lane is the lifeline's x. `createdBox` asks the same of
 * a box, which an actor does not have.
 */
function createdFigureArrow(result: SirenRenderResult, participantId: string): string {
  const svg = svgOf(result);
  const figure = svg.querySelector(`g.siren-participant[data-siren-id="${participantId}"]`);
  const lifeline = svg.querySelector(`line.siren-lifeline[data-siren-id="${participantId}"]`);
  if (figure === null || lifeline === null) return "no figure";
  const xs = Array.from(figure.querySelectorAll("line")).flatMap((line) =>
    ["x1", "x2"].map((name) => Number(line.getAttribute(name))),
  );
  const lane = Number(lifeline.getAttribute("x1"));
  const tips: [number, string][] = [
    [Math.min(...xs), "left"],
    [Math.max(...xs), "right"],
  ];
  const arrow = messageArrows(result).find((candidate) => candidate.id.endsWith(`-${participantId}`));
  if (arrow === undefined) return "no arrow to it";
  const tip = tips.find(([at]) => at === arrow.toX)?.[1];
  if (tip === undefined) return `${arrow.id} ends at x ${arrow.toX}`;
  return `${arrow.id} stops at its ${tip} arm tip, ${Math.abs(lane - arrow.toX)} short of its lane`;
}

/** Every control-flow block as `kind:id`, in draw order. */
function blocks(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-block").map(
    (g) => `${g.getAttribute("data-siren-block-kind") ?? "<none>"}:${idOf(g)}`,
  );
}

/**
 * Every ER entity as `id[label]` — the two halves an alias will one day pull
 * apart, read off the picture rather than off the model. `nodes` above reads
 * a flowchart's in exactly this shape, and for the same reason: a failure
 * that says `expected ["CUSTOMER[CUSTOMER]"], got ["CUSTOMER[]"]` names the
 * bug on the spot.
 */
function erEntities(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-er-entity").map(
    (g) => `${idOf(g)}[${textOf(g)}]`,
  );
}

/**
 * One ER cluster frame's four sides, keyed by the **title** drawn on it.
 *
 * By the title rather than by `data-siren-id`, for the reason `subgraphBox`
 * gives about a flowchart's: a cluster's id is generated (`subgraph:1`)
 * precisely so that it cannot be spelled by anything the author wrote, and
 * the title is what the author *did* write — so a row can ask about it
 * without encoding a numbering rule the corpus has no business pinning.
 */
function erSubgraphBox(
  result: SirenRenderResult,
  title: string,
): Box {
  const box = subgraphFrames(svgOf(result), ER_SUBGRAPH).find(
    (drawn) => drawn.title === title,
  )?.box;
  if (box === undefined || box === null) {
    throw new Error(`no ER cluster titled "${title}" was drawn`);
  }
  return box;
}

/**
 * The rectangle one ER entity is drawn in, in the edges-of-the-box shape
 * `stateRect` and `subgraphBox` already use, so the shared containment and
 * overlap rules serve this kind too.
 */
function erEntityRect(
  result: SirenRenderResult,
  id: string,
): Box {
  const rect = svgOf(result).querySelector(
    `g.siren-er-entity[data-siren-id="${id}"] rect.siren-er-entity-frame`,
  );
  if (rect === null) throw new Error(`no entity "${id}" was drawn with a rectangle`);
  return rectBox(rect);
}

/**
 * Every ER relationship as
 * `id: <from marker>-<line>-<to marker>`, read out of the *picture*.
 *
 * The two markers are read from the `marker-start` / `marker-end` the line
 * carries, with the render's own id scope stripped off, and the line from
 * whether it was drawn dashed. That is the whole of what the drawn
 * relationship says, and reading it end by end is what makes a row able to
 * claim the sides were not swapped — Mermaid's own record of the pair is
 * crossed over (`cardA` is the marker next to `entityB`), so a row that
 * only counted markers would pass with every relationship drawn backwards.
 */
function erRelationships(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-er-relationship").map((g) => {
    const line = g.querySelector("path.siren-er-relationship-line");
    if (line === null) throw new Error(`relationship "${idOf(g)}" drew no line`);
    // `url(#siren-er-only-one__k3f9a1x2)` → `only-one`. The scope after the
    // `__` is minted per render (`mintIdScope`) and is cut off rather than
    // matched — no `siren-*` name contains an underscore, which is what
    // that separator exists for.
    const marker = (attribute: string): string => {
      const value = line.getAttribute(attribute) ?? "";
      const name = /url\(#siren-er-(.+)__.{8}\)$/.exec(value);
      return name === null ? `<no ${attribute}>` : name[1];
    };
    const dashed = line.getAttribute("stroke-dasharray") !== null ? "dashed" : "solid";
    return `${idOf(g)}: ${marker("marker-start")}-${dashed}-${marker("marker-end")}`;
  });
}

/** The glyphs one cardinality's `<marker>` is built from, nearest the box first. */
function erCardinalityGlyphs(result: SirenRenderResult, name: string): string[] {
  const marker = svgOf(result).querySelector(`defs marker[id^="siren-er-${name}__"]`);
  if (marker === null) throw new Error(`no <marker> was defined for "${name}"`);
  const refX = Number(marker.getAttribute("refX"));
  // How far out along the line each glyph sits: `0` is the box's edge.
  const placed = Array.from(marker.children).map((glyph) => {
    const className = glyph.getAttribute("class") ?? "";
    if (className.includes("siren-er-cardinality-bar")) {
      return { glyph: "bar", out: refX - Number(glyph.getAttribute("x1")) };
    }
    if (className.includes("siren-er-cardinality-circle")) {
      return { glyph: "circle", out: refX - Number(glyph.getAttribute("cx")) };
    }
    const xs = Array.from(
      (glyph.getAttribute("d") ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g),
      (pair) => Number(pair[1]),
    );
    return { glyph: "crows-foot", out: refX - Math.max(...xs) };
  });
  return placed.sort((a, b) => a.out - b.out).map((entry) => entry.glyph);
}

/**
 * Where one ER relationship's drawn label sits.
 *
 * The label is found by the relationship's id, not inside its line group: it
 * is a group of its own, drawn after every line (ADR-0016).
 */
function erRelationshipLabelAnchor(
  result: SirenRenderResult,
  id: string,
): { text: string; x: number; y: number } {
  const text = svgOf(result).querySelector(
    `g.siren-er-relationship-labels[data-siren-id="${id}"] text.siren-er-relationship-label`,
  );
  if (text === null) throw new Error(`no relationship "${id}" drew a label`);
  return {
    text: text.textContent ?? "",
    x: Number(text.getAttribute("x")),
    y: Number(text.getAttribute("y")),
  };
}

/**
 * Every point one ER relationship's line is routed through, `from` end
 * first — off `data-siren-points` (`pathPoints`), because the line is drawn
 * rounded and its `d` holds control points the line never passes through.
 */
function erRelationshipRoute(result: SirenRenderResult, id: string): Point[] {
  return pathPoints(
    result,
    `g.siren-er-relationship[data-siren-id="${id}"] path.siren-er-relationship-line`,
  );
}

/**
 * The lines each cell of one column of an ER entity's attribute table draws,
 * top to bottom — one entry per cell, and in it one string per line a
 * reader sees.
 *
 * Read off the row tspans when the cell has them and off the `<text>` when
 * it is one plain line, so a cell drawn as `a` over `b` reads `["a", "b"]`
 * and one drawn as the single line `ab` reads `["ab"]` — the difference
 * `erAttributeRows`, which flattens each cell to its `textContent`, cannot
 * see.
 */
function erAttributeLines(result: SirenRenderResult, id: string, column: string): string[][] {
  return Array.from(
    svgOf(result).querySelectorAll(
      `g.siren-er-entity[data-siren-id="${id}"] text.siren-er-attribute-${column}`,
    ),
  )
    .sort((a, b) => Number(a.getAttribute("y")) - Number(b.getAttribute("y")))
    .map((text) => {
      const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
      return rows.length === 0 ? [text.textContent ?? ""] : rows.map((row) => row.textContent ?? "");
    });
}

/**
 * One ER entity's attribute table as drawn, one string per row, each cell
 * written `column=text` and ordered by where it was actually placed.
 *
 * Read off the picture twice over: the rows are grouped by the `y` the cells
 * were drawn at and ordered left to right by their `x`, so a table whose
 * cells carry the right classes and the wrong coordinates — every column
 * heaped at one edge, or two rows interleaved — reads back differently here.
 * A reader that trusted document order could not tell those apart.
 */
function erAttributeRows(result: SirenRenderResult, id: string): string[] {
  const cells = Array.from(
    svgOf(result).querySelectorAll(
      `g.siren-er-entity[data-siren-id="${id}"] text.siren-er-attribute`,
    ),
  ).map((text) => ({
    column: /siren-er-attribute-([a-z]+)/.exec(text.getAttribute("class") ?? "")?.[1] ?? "?",
    text: text.textContent ?? "",
    x: Number(text.getAttribute("x")),
    y: Number(text.getAttribute("y")),
  }));
  const rowYs = [...new Set(cells.map((cell) => cell.y))].sort((a, b) => a - b);
  return rowYs.map((y) =>
    cells
      .filter((cell) => cell.y === y)
      .sort((a, b) => a.x - b.x)
      .map((cell) => `${cell.column}=${cell.text}`)
      .join(" | "),
  );
}

/**
 * The inline author style on one ER entity's drawn rectangle, or `""` when
 * the author styled it with nothing.
 *
 * `nodeStyle` and `stateStyle`'s answer for this kind, read the same way:
 * the attribute the browser will paint from, rather than anything upstream
 * of it. Equality rather than `endsWith`, because an entity's frame carries
 * no theme-owned inline declaration in front of the author's — it is a
 * plain rectangle whose corner radius is a CSS custom property.
 */
function erEntityStyle(result: SirenRenderResult, id: string): string {
  const frame = svgOf(result).querySelector(
    `g.siren-er-entity[data-siren-id="${id}"] rect.siren-er-entity-frame`,
  );
  if (frame === null) throw new Error(`no entity "${id}" was drawn with a rectangle`);
  return frame.getAttribute("style") ?? "";
}

/**
 * Every ER cluster as drawn, in draw order: its title, the inline author
 * style on its frame `<rect>`, and the one on its title `<text>` — `""` for
 * none. Read off the drawn elements because that is where an author's
 * `style s1` / `class s1` either lands or silently does not: the model
 * holding the declaration proves nothing about the picture.
 */
function erSubgraphStyles(
  result: SirenRenderResult,
): { title: string; frame: string; text: string }[] {
  return elements(result, "g.siren-er-subgraph").map((g) => ({
    title: g.querySelector("text.siren-er-subgraph-label")?.textContent ?? "",
    frame: g.querySelector("rect.siren-er-subgraph-frame")?.getAttribute("style") ?? "",
    text: g.querySelector("text.siren-er-subgraph-label")?.getAttribute("style") ?? "",
  }));
}

/**
 * The inline author style on every **text** one ER entity draws — its name
 * first, then each attribute cell in the order `erAttributeRows` reads them.
 *
 * Its own reader beside `erEntityStyle` for the reason `edgeLabelStyle` is
 * one: the two halves of an author's style land on different elements, so a
 * row that read only the rectangle could not tell "the author's `color`
 * painted the label" from "it was dropped". One entry per drawn text, so a
 * row that loses the last attribute cell's paint is a difference in the
 * list's *length* as well as its contents.
 */
function erEntityTextStyles(result: SirenRenderResult, id: string): string[] {
  const g = svgOf(result).querySelector(`g.siren-er-entity[data-siren-id="${id}"]`);
  if (g === null) throw new Error(`no entity "${id}" was drawn`);
  return Array.from(g.querySelectorAll("text")).map(
    (text) => text.getAttribute("style") ?? "",
  );
}

/**
 * The rules drawn inside one entity box, as `horizontal` or `vertical` plus
 * the coordinate each runs along — enough for a row to say how many columns
 * the table really has without counting cells a second time.
 */
function erEntityDividers(result: SirenRenderResult, id: string): string[] {
  return Array.from(
    svgOf(result).querySelectorAll(
      `g.siren-er-entity[data-siren-id="${id}"] line.siren-er-entity-divider`,
    ),
  ).map((line) => {
    const number = (name: string) => Number(line.getAttribute(name));
    return number("y1") === number("y2")
      ? `horizontal@${number("y1")}`
      : `vertical@${number("x1")}`;
  });
}

/** Where one ER entity's drawn name sits, so a row can ask whether it is inside its own box. */
function erLabelAnchor(result: SirenRenderResult, id: string): Point {
  const text = svgOf(result).querySelector(
    `g.siren-er-entity[data-siren-id="${id}"] text.siren-er-entity-label`,
  );
  if (text === null) throw new Error(`no entity "${id}" drew a name`);
  return { x: Number(text.getAttribute("x")), y: Number(text.getAttribute("y")) };
}

/** Every state-diagram state as `id`, in draw order. */
function states(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-state").map(idOf);
}

/**
 * The figures a state diagram can draw one state as, in the order a reader
 * of `stateFigures` sees them joined: the labelled box of an ordinary
 * state, the diamond of a `<<choice>>`, the solid bar a `<<fork>>` and a
 * `<<join>>` share, the filled disc of a start, and the ring-plus-dot of an
 * end.
 *
 * The diamond is told from the box by its *element* rather than by its
 * class, deliberately: both wear `.siren-state-frame`, because a diamond is
 * this state's frame drawn as a different shape (the rule a flowchart's
 * `.siren-node-frame` already follows), so `rect` versus `polygon` is what
 * separates them and a reader that asked only about the class would call a
 * diamond a box.
 */
const STATE_FIGURES: readonly [selector: string, figure: string][] = [
  ["rect.siren-state-frame", "box"],
  ["polygon.siren-state-frame", "diamond"],
  ["rect.siren-state-bar", "bar"],
  ["rect.siren-composite-frame", "frame"],
  // A concurrent region's own frame: untitled and dashed where a
  // composite's is titled and solid, so it is a figure of its own rather
  // than a second spelling of `frame`, and a row that could not tell them
  // apart would pass on a region drawn as the block it divides.
  ["rect.siren-state-region", "region"],
  ["circle.siren-state-start", "disc"],
  ["circle.siren-state-end", "ring"],
  ["circle.siren-state-end-inner", "dot"],
];

/**
 * The box one state's drawn figure occupies, as `width×height` — read off
 * the `<rect>` a box or a bar is drawn as, or off the corner points of the
 * `<polygon>` a diamond is.
 *
 * Sizes as text rather than numbers, so a failure reads
 * `expected ["Choice: 28×28"], got ["Choice: 70×10"]` and names the figure
 * that came out the wrong shape on the spot. A row that asked only "is a
 * polygon there?" would pass on a diamond drawn at a box's size, which is a
 * picture Mermaid never draws.
 */
function stateFigureSize(result: SirenRenderResult, id: string): string {
  const group = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"]`);
  if (group === null) throw new Error(`no state "${id}" was drawn`);

  const polygon = group.querySelector("polygon");
  if (polygon !== null) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pair of (polygon.getAttribute("points") ?? "").trim().split(/\s+/)) {
      const [x, y] = pair.split(",").map(Number);
      xs.push(x);
      ys.push(y);
    }
    return `${Math.max(...xs) - Math.min(...xs)}×${Math.max(...ys) - Math.min(...ys)}`;
  }

  const rect = group.querySelector("rect");
  if (rect === null) throw new Error(`state "${id}" was drawn with neither a rect nor a polygon`);
  return `${rect.getAttribute("width")}×${rect.getAttribute("height")}`;
}

/**
 * The corner points of the `<polygon>` one state is drawn as, relative to
 * the middle of its own box — `top`, `right`, `bottom` and `left` when the
 * four sit at the edge midpoints, which is what makes the figure a diamond
 * rather than some other quadrilateral of the same size.
 *
 * Named rather than numeric because the numbers move with the layout while
 * the *shape* does not: this is the assertion that a choice is drawn as a
 * diamond, and it survives every repositioning that is none of its business.
 */
function polygonCorners(result: SirenRenderResult, id: string): string[] {
  const polygon = svgOf(result).querySelector(
    `g.siren-state[data-siren-id="${id}"] polygon`,
  );
  if (polygon === null) throw new Error(`no polygon was drawn for state "${id}"`);
  const points = (polygon.getAttribute("points") ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map(([x, y]) => {
    if (x === midX && y === Math.min(...ys)) return "top";
    if (x === Math.max(...xs) && y === midY) return "right";
    if (x === midX && y === Math.max(...ys)) return "bottom";
    if (x === Math.min(...xs) && y === midY) return "left";
    return `${x},${y}`;
  });
}

/** The text drawn inside one state's own group — empty where it draws none. */
function stateTexts(result: SirenRenderResult, id: string): string[] {
  const group = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"]`);
  if (group === null) throw new Error(`no state "${id}" was drawn`);
  return Array.from(group.querySelectorAll("text")).map((text) => text.textContent ?? "");
}

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
 *
 * The label is found by the transition's id, not inside its line group: it
 * is a group of its own, drawn after every line (ADR-0016).
 */
function transitions(result: SirenRenderResult): string[] {
  const svg = svgOf(result);
  return elements(result, "g.siren-transition").map((g) => {
    const label = svg.querySelector(
      `g.siren-transition-labels[data-siren-id="${idOf(g)}"] text.siren-transition-label`,
    );
    return `${idOf(g)}: ${label?.textContent ?? ""}`;
  });
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
function stateCenter(result: SirenRenderResult, id: string): Point {
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
): Box {
  const rect = svgOf(result).querySelector(`g.siren-state[data-siren-id="${id}"] rect`);
  if (rect === null) throw new Error(`no state "${id}" was drawn with a rectangle`);
  return rectBox(rect);
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
): Box {
  const rect = svgOf(result).querySelector(
    `g.siren-state[data-siren-id="${id}"] rect.siren-note-frame`,
  );
  if (rect === null) throw new Error(`no note was drawn on state "${id}"`);
  return rectBox(rect);
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

/** One state's centre, for a row reading a direction off the picture. */
function stateRectCenter(
  result: SirenRenderResult,
  id: string,
): Point {
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
  const within = holds(box, point, ON_OUTLINE);
  const onAnEdge =
    Math.abs(point.x - box.left) < ON_OUTLINE ||
    Math.abs(point.x - box.right) < ON_OUTLINE ||
    Math.abs(point.y - box.top) < ON_OUTLINE ||
    Math.abs(point.y - box.bottom) < ON_OUTLINE;
  return within && onAnEdge;
}

/**
 * The distinct coordinates one transition's route passes through, read off
 * the `<path>`'s `data-siren-points` (see `pathPoints` for why not `d`).
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
  return [...new Set(routeOf(path).map(({ x, y }) => `${x},${y}`))];
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
    id: "fc-node-id-dash",
    kind: "flowchart",
    source: `flowchart TB
      a-b-->c-d
      x.o-->y`,
    status: "supported",
    meaning:
      "A node id may hold `-` wherever the next character is not `>`, `-` or " +
      "`.`, the three that begin an arrow — Mermaid's own id rule. Measured " +
      "on 12.2.0: `a-b-->c-d` is the nodes `a-b` and `c-d` and one edge, with " +
      "no space needed before the arrow; `a-b-c`, `-a` and `a-` are ids; " +
      "`a--b`, `a-.b` and `a - b` are parse errors. Siren refused every dash " +
      "id (01M2SVAFT). Widening the alphabet moved the arrow markers' guard " +
      "with it: an `o` or `x` right after an id character is the id's, so " +
      "`x.o-->y` is the node `x.o` and a plain arrow, as Mermaid reads it — " +
      "Siren used to read it as `x.` and a circle-headed arrow, silently.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["a-b[a-b]", "c-d[c-d]", "x.o[x.o]", "y[y]"]);
      expectSame("edges", edges(result), ["a-b-c-d", "x.o-y"]);
    },
  },
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
  // flowchart — a node declared twice
  // -------------------------------------------------------------------------
  {
    id: "fc-node-relabelled",
    kind: "flowchart",
    source: `flowchart TB
      A[x] --> B
      A[y]`,
    status: "supported",
    meaning:
      "A node written with a second, different label is drawn with the " +
      "**last** one, where it was first written, and with no diagnostic. " +
      "Measured (mermaid 11.17.2, `node scripts/mermaid-probe.mjs --html`): " +
      "`A[x]` then `A[y]` records `id=\"A\" text=\"y\"` and draws " +
      "`<p>y</p>`. Siren used to keep the first label and warn; the later " +
      "word is the one the author's diagram uses, so there is nothing to " +
      "warn about. A bare mention (`A --> C` after `A[x]`) changes nothing, " +
      "in either.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[y]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  {
    id: "fc-node-reshaped",
    kind: "flowchart",
    source: `flowchart TB
      A[x]
      A{x}`,
    status: "supported",
    meaning:
      "The shape follows the same rule as the label: the last bracket " +
      "written is the shape drawn, even when the label is unchanged. " +
      "Measured (mermaid 11.17.2): `A[x]` then `A{x}` records " +
      "`type=\"diamond\"`. Siren used to keep the first shape, silently, " +
      "because its redeclaration check compared labels only.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[x]"]);
      expectSame("outline", nodeOutline(result, "A"), "diamond");
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
      // not about drawing. Mermaid 11.17.2 handed its parsed `length` to
      // dagre as `minlen` (measured: `length=3` for `---->`, `length=1` for
      // `-->`). Mermaid 12.2.0 on ELK still computes it and ELK reads no
      // such option, so it draws both alike (measured in headless Chrome:
      // identical coordinates) — a picture that contradicts the document,
      // which Siren does not copy: the shared layout core holds the ends
      // apart with a chain of invisible points (nook decision
      // `01M4VA6MS4MCTFFJJWEZR453YS`). Drawing both alike would
      // be a silent mis-render by this instrument's own definition.
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
      // And on the line, as Mermaid draws it (`labelpos: "c"`), not beside it.
      expectOnTheLine(
        "the label",
        result,
        'text.siren-edge-label[data-siren-id="A-B"]',
        'path.siren-edge[data-siren-id="A-B"]',
      );
      // And readable where the line runs under it: Mermaid paints a
      // translucent fill behind every edge label (measured, 11.17.2:
      // `.labelBkg` and `.edgeLabel` over the label's box). Siren's is a rect
      // wearing the label's id, so a timeline entry on the edge reaches it
      // with the text (ADR-0009), drawn before the text it sits under.
      expectSame(
        "the label's background",
        elements(result, "rect.siren-connector-label-background").map(idOf),
        ["A-B"],
      );
      const drawn = elements(result, "*");
      const background = svgOf(result).querySelector("rect.siren-connector-label-background")!;
      const text = svgOf(result).querySelector('text.siren-edge-label[data-siren-id="A-B"]')!;
      expectSame(
        "the background is painted under the label's text",
        drawn.indexOf(background) < drawn.indexOf(text),
        true,
      );
    },
  },
  {
    id: "fc-edge-label-br",
    kind: "flowchart",
    source: `flowchart TB
      A -->|"yes<br/>no"| B`,
    status: "supported",
    meaning:
      "`<br>` in an edge label is a line break, as it is in a node's: the edge " +
      "label is one of the positions ADR-0015 reads with the whole tag " +
      "vocabulary, and Mermaid draws `yes` over `no` there in both its HTML " +
      "and its SVG labels. Siren used to draw `yes<br/>no` literally.",
    assert: (result) => {
      expectSame(
        "label rows",
        labelRows(svgOf(result).querySelector('text.siren-edge-label[data-siren-id="A-B"]')),
        ["yes", "no"],
      );
    },
  },
  {
    id: "fc-label-line-height",
    kind: "flowchart",
    source: `flowchart TB
      A["first<br/>second"] -->|"yes<br/>no"| B`,
    status: "supported",
    meaning:
      "A label's rows are one line apart, and a line is 1.5 times the font " +
      "size: mermaid 11.17.2 draws its 16px label text on 24px lines (measured: " +
      "a node of two `<br>` rows is a 48px `<div>`, of five wrapped rows " +
      "120px; an edge label the same). Siren's node text is 14px, so its rows " +
      "are 21px apart; an edge label is 12px, so 18px. The shape's padding is " +
      "around the rows once, not around each.",
    assert: (result) => {
      expectSame("node label row gaps", rowGaps(result, 'g.siren-node[data-siren-id="A"] text'), [21]);
      expectSame("edge label row gaps", rowGaps(result, 'text.siren-edge-label[data-siren-id="A-B"]'), [18]);
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
      "construct. ELK routes it, as it does for Mermaid 12.2.0 (measured " +
      "in headless Chrome: a small orthogonal loop off the node's left side " +
      "under `TB`, `[[28,27],[8,27],[8,34],[28,34]]` for a box at x 28). " +
      "Under dagre Siren had to synthesise the loop (`selfLoopAroundBox`), " +
      "because dagre's own route for a self-edge touched nothing.",
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
        loop.filter((point) => !holds(pictureBox(result), point, ON_OUTLINE)),
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
        loop.filter((point) => !holds(pictureBox(result), point, ON_OUTLINE)),
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
      "laid out in the enclosing frame's.** Measured against Mermaid 12.2.0's " +
      "default (ELK) layout in headless Chrome: `A` at (56, 104), `B` at " +
      "(232, 104), `C` at (432, 92) — `A` and `B` in one row, `C` beyond " +
      "them: `Outer` is laid out in a pass of its own in `LR`, and `Inner`, " +
      "saying nothing, is laid out in that pass. Mermaid 11.17.2 (dagre) drew " +
      "the opposite — `A` over `B` in the header's `TB` — and Siren drew that " +
      "while it was on dagre; this row followed the measurement when the " +
      "flowchart moved to ELK (nook `01M4VA67H`). The dagre history: a " +
      "cluster given a `rankdir` of its own had its children expanded exactly " +
      "one level, so this document once drew `NaN` into 29 attributes and " +
      "said nothing (`01M2WQV0`), then was refused (`01M2XJVPX`), then drawn " +
      "(`01M2XJWM4`).",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]", "C[C]"]);

      const a = nodeCenter(result, "A");
      const b = nodeCenter(result, "B");
      const c = nodeCenter(result, "C");

      // The measurement above, as the picture rather than as "it rendered".
      // `Inner` laid out in the header's `TB` would draw every figure this
      // row names, report nothing, and put `B` *below* `A`; the equality of
      // these two y's is what tells the current picture from that one.
      expectSame("A and B are drawn in one row", a.y, b.y);
      expectSame("B right of A — `Inner` lays out in `Outer`'s `LR`", b.x > a.x, true);
      expectSame("C beyond them — `Outer`'s own `LR`", c.x > b.x, true);

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
    id: "fc-subgraph-direction-crossed",
    kind: "flowchart",
    source: `flowchart TB
      subgraph one
        direction LR
        A --> B
      end
      B --> C`,
    status: "supported",
    meaning:
      "A subgraph's `direction` applies only while no " +
      "**Boundary-crossing edge** (`CONTEXT.md`) voids it. Mermaid 12.2.0's " +
      "rule (`configureCrossHierarchyEdges`, measured in headless Chrome): " +
      "an edge whose ends have different parents puts every group between " +
      "them back into its parent's layout pass. `B --> C` leaves `one`, so " +
      "its members follow the header's `TB`.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]", "C[C]"]);
      expectSame("edges", edges(result), ["A-B", "B-C"]);

      // The header's `TB`, read off the picture: `B` a rank below `A`.
      // `direction LR` reaching layout would put `B` beside `A` instead.
      expectSame(
        "B is drawn below A",
        nodeBox(result, "B").top > nodeBox(result, "A").bottom,
        true,
      );

      // Both still routed from box to box: A's bottom down to B's top.
      expectSame("A-B leaves A's bottom", edgePoints(result, "A-B")[0].y, nodeBox(result, "A").bottom);
      expectSame("A-B reaches B's top", edgePoints(result, "A-B").at(-1)!.y, nodeBox(result, "B").top);

      const frame = subgraphBox(result, "one");
      expectSame("frame encloses A", encloses(frame, nodeBox(result, "A")), true);
      expectSame("frame encloses B", encloses(frame, nodeBox(result, "B")), true);
      expectSame("frame does not enclose C", encloses(frame, nodeBox(result, "C")), false);
    },
  },
  {
    id: "fc-subgraph-title-br",
    kind: "flowchart",
    source: `flowchart TB
      subgraph S["a<br/>b"]
        A
      end`,
    status: "supported",
    meaning:
      "`<br>` in a subgraph's title is a line break, as it is in a node's " +
      "label: a title is one of the positions ADR-0015 reads with the whole " +
      "tag vocabulary, and Mermaid draws `a` over `b` there. Siren used to " +
      "draw `a<br/>b` literally. The frame's title strip holds both rows, so " +
      "the node it groups is still drawn below them.",
    assert: (result) => {
      const title = svgOf(result).querySelector("g.siren-subgraph text.siren-subgraph-label");
      expectSame("title rows", labelRows(title), ["a", "b"]);
      // The title is read back by its flattened text, which `textContent`
      // concatenates with nothing between the rows.
      const frame = subgraphBox(result, "ab");
      expectSame("S encloses A", encloses(frame, nodeBox(result, "A")), true);
      const rows = Array.from(title?.querySelectorAll(":scope > tspan.siren-label-row") ?? []);
      const lastRowY = Number(rows[rows.length - 1]?.getAttribute("y"));
      expectSame("the title's last row is above A", lastRowY < nodeBox(result, "A").top, true);
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
      "outside the frame with both ends on the frame's own boundary, routed " +
      "by ELK as Mermaid 12.2.0's is (measured: a loop off the frame's left " +
      "side). Under dagre it once drew the loop dagre gave the member " +
      "standing in for the frame, *inside* the frame beside `A` — the right " +
      "edge attached to the wrong figure, with no diagnostic saying so — and " +
      "then a loop synthesised around the frame (`selfLoopAroundBox`).",
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
      expectSame("label rows", nodeLabelRows(result, "A"), ["bold(b)"]);
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
      expectSame("label rows", nodeLabelRows(result, "A"), ["italic(i)"]);
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
      // them, not in this string. `nodeLabelRows` is the assert that reads
      // that structure; this is only proof the letters themselves made it.
      expectSame("nodes", nodes(result), ["A[line1line2]"]);
      expectSame("label rows", nodeLabelRows(result, "A"), ["line1", "line2"]);
    },
  },

  // Automatic wrapping (the label-wrap ADR, nook `01M4R4WDZ`). Mermaid
  // wraps a node's label at 200px of its 16px text; Siren at 175px of its
  // 14px, the same number of characters to a row. The wrap width bounds the
  // text alone, as Mermaid's `<div>` does; the measurer's padding goes
  // outside it. Under the default measurer (8px a character, plus 16px of
  // padding) 21 characters fit in 175px and 22 do not, and a wrapped
  // label's box is 175 + 16 = 191, while the flowchart node enlarges only
  // padding to twice the original, giving 175 + 32 = 207. Each
  // `meaning` quotes the lines mermaid 11.17.2 drew (headless Chrome, one
  // line per distinct glyph top in the label's `<div>`); the rows Siren
  // draws differ only because the default measurer is wider than Chrome's
  // font.
  {
    id: "fc-label-wrap-latin",
    kind: "flowchart",
    source: `flowchart TD
      A[This is a fairly long English label that should certainly exceed two hundred pixels of width]`,
    status: "supported",
    meaning:
      "A node label wider than Mermaid's wrapping width (200px) is wrapped, " +
      "Latin text at its spaces only, and the label's box is then exactly " +
      "that width: mermaid 11.17.2 draws it in a 200px-wide `<div>` as " +
      "`This is a fairly long English ` / `label that should certainly ` / " +
      "`exceed two hundred pixels ` / `of width`, in a 260px-wide node " +
      "(measured).",
    assert: (result) => {
      expectSame("label rows", nodeLabelRows(result, "A"), [
        "This is a fairly long",
        "English label that",
        "should certainly",
        "exceed two hundred",
        "pixels of width",
      ]);
      // A rectangle keeps 175px of text and enlarges only the measurer's
      // 16px of padding to 32px.
      const box = nodeBox(result, "A");
      expectSame("node width", box.right - box.left, 207);
    },
  },
  {
    id: "fc-label-wrap-cjk",
    kind: "flowchart",
    source: `flowchart TD
      A[這是一個沒有任何空白而且相當長的中文節點標籤用來測試換行行為是否會在字元之間斷開]`,
    status: "supported",
    meaning:
      "A CJK label with no space in it is wrapped between any two " +
      "characters: mermaid 11.17.2 draws `這是一個沒有任何空白而且` / " +
      "`相當長的中文節點標籤用來` / `測試換行行為是否會在字元` / `之間斷開` " +
      "in a 200px-wide `<div>` (measured).",
    assert: (result) => {
      // 21 characters, then the other 19.
      expectSame("label rows", nodeLabelRows(result, "A"), [
        "這是一個沒有任何空白而且相當長的中文節點標",
        "籤用來測試換行行為是否會在字元之間斷開",
      ]);
      const box = nodeBox(result, "A");
      expectSame("node width", box.right - box.left, 207);
    },
  },
  {
    id: "fc-label-wrap-mixed",
    kind: "flowchart",
    source: `flowchart TD
      P["Watering 灌溉控制器 (Rain / Pump / Wells)"]`,
    status: "supported",
    meaning:
      "A label mixing CJK and Latin text is wrapped by both rules at once — " +
      "garden-network's watering node: mermaid 11.17.2 draws " +
      "`Watering 灌溉控制器 (Rain ` / `/ Pump / Wells)` in a 200px-wide " +
      "`<div>` (measured).",
    assert: (result) => {
      // Mermaid's own two lines, less the space each first line ends with.
      expectSame("label rows", nodeLabelRows(result, "P"), ["Watering 灌溉控制器 (Rain", "/ Pump / Wells)"]);
      const box = nodeBox(result, "P");
      expectSame("node width", box.right - box.left, 207);
    },
  },
  {
    id: "fc-label-wrap-br",
    kind: "flowchart",
    source: `flowchart TD
      A["short<br>a much longer second line that goes well past two hundred pixels"]`,
    status: "supported",
    meaning:
      "A `<br>` still ends its line, and each line it leaves is wrapped on " +
      "its own: mermaid 11.17.2 draws `short` / `a much longer second line ` " +
      "/ `that goes well past two ` / `hundred pixels` in a 200px-wide " +
      "`<div>` (measured) — the short first line is not filled from the next.",
    assert: (result) => {
      expectSame("label rows", nodeLabelRows(result, "A"), [
        "short",
        "a much longer second",
        "line that goes well",
        "past two hundred",
        "pixels",
      ]);
      const box = nodeBox(result, "A");
      expectSame("node width", box.right - box.left, 207);
    },
  },
  {
    id: "fc-label-wrap-long-word",
    kind: "flowchart",
    source: `flowchart TD
      A[a Pneumonoultramicroscopicsilicovolcanoconiosis case]`,
    status: "supported",
    meaning:
      "A word wider than the wrapping width is not cut: it stands on a row " +
      "of its own and the label widens to it. mermaid 11.17.2 draws `a ` / " +
      "`Pneumonoultramicroscopicsilicovolcanoconiosis ` / `case` in a " +
      "`<div>` widened from 200px to 346px, in a 406px-wide node (measured).",
    assert: (result) => {
      expectSame("label rows", nodeLabelRows(result, "A"), [
        "a",
        "Pneumonoultramicroscopicsilicovolcanoconiosis",
        "case",
      ]);
      // The word's 45 characters are 360px of text, and the box is that
      // row with the measurer's padding doubled to 32px — wider than 207.
      const box = nodeBox(result, "A");
      expectSame("node width", box.right - box.left, 392);
    },
  },
  {
    id: "fc-edge-label-wrap",
    kind: "flowchart",
    source: `flowchart TD
      A[Start] -->|this edge label is long enough to go well past two hundred pixels wide| B[End]`,
    status: "supported",
    meaning:
      "An edge label wider than Mermaid's wrapping width (200px of its 16px " +
      "text) is wrapped as a node's is: mermaid 11.17.2 draws `this edge " +
      "label is long ` / `enough to go well past two ` / `hundred pixels " +
      "wide` in a 200px-wide `<div>` (measured). Siren draws an edge label " +
      "at 12px, so it wraps at 150px of text, the same number of characters " +
      "to a row, and the label's background covers the wrapped box.",
    assert: (result) => {
      // At 12px the default measurer is 12/14 of its 8px a character and
      // 16px of padding, so 21 characters fit in 150px and 22 do not.
      const text = svgOf(result).querySelector('text.siren-edge-label[data-siren-id="A-B"]');
      expectSame("label rows", labelRows(text), [
        "this edge label is",
        "long enough to go",
        "well past two hundred",
        "pixels wide",
      ]);
      // The background is the wrapped box: 150px of text and the padding.
      const background = svgOf(result).querySelector('rect.siren-connector-label-background[data-siren-id="A-B"]')!;
      expectSame(
        "background width",
        Math.round(Number(background.getAttribute("width")) * 1000) / 1000,
        Math.round((150 + (16 * 12) / 14) * 1000) / 1000,
      );
    },
  },
  {
    id: "fc-subgraph-title-no-wrap",
    kind: "flowchart",
    source: `flowchart TD
      subgraph G[This subgraph title is long enough to go well past two hundred pixels wide in Mermaid]
        A[One] --> B[Two]
      end`,
    status: "supported",
    meaning:
      "A subgraph's title is never wrapped, however long: mermaid 11.17.2 " +
      "draws it on one line in a 617px-wide `<div>` with " +
      "`white-space: nowrap`, and the frame grows to hold it (625px, " +
      "measured).",
    assert: (result) => {
      const title = "This subgraph title is long enough to go well past two hundred pixels wide in Mermaid";
      expectSame("title rows", labelRows(svgOf(result).querySelector("text.siren-subgraph-label")), [title]);
      // The frame holds the whole unwrapped title: its 85 characters, 696px.
      const frame = subgraphBox(result, title);
      expectSame("frame holds the title", frame.right - frame.left >= title.length * 8 + 16, true);
    },
  },

  {
    id: "fc-label-tag-quotes",
    kind: "flowchart",
    source: `flowchart TB
      A["<span style="color:red">t</span>"]
      B["<span style="font-family:'x'">u</span>"]`,
    status: "supported",
    meaning:
      "Before any diagram reads a line, Mermaid rewrites each `=\"\u2026\"` " +
      "inside a tag-shaped stretch `/<(\\w+)([^>]*)>/` as `='\u2026'` (its " +
      "`cleanupText`, over the whole document). So a double-quoted " +
      "attribute inside a quoted label no longer ends the label's quotes: " +
      "`A[\"<span style=\"color:red\">t</span>\"]` is a red `t`. And a " +
      "double-quoted value holding a `'` is cut short by it: " +
      "`style=\"font-family:'x'\"` becomes `style='font-family:'x''`, whose " +
      "value is `font-family:` — no family at all. Measured (mermaid 11.17.2, " +
      "`--html`): `<span style=\"color:red\">t</span>` and " +
      "`<span style=\"font-family:\">u</span>`. Siren used to draw `\"t\"` and " +
      "`\"u\"`, quotes and all.",
    assert: (result) => {
      const text = (id: string) => svgOf(result).querySelector(`g.siren-node[data-siren-id="${id}"] text`);
      expectSame("A's runs", labelRuns(text("A"), "style"), ["t[style=fill: red]"]);
      expectSame("B's runs", labelRuns(text("B"), "style", "font-family"), ["u"]);
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
    id: "fc-style-style-line-semicolon",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] --> B[End]
      style A fill:#fdd;position:fixed,stroke:#c00`,
    status: "supported",
    meaning:
      "A `;` inside a `style` statement's list, on a line where a `#` follows " +
      "the `:`, is the one Mermaid's style-line rule drops before it parses, " +
      "so the two declarations around it run together: measured (mermaid " +
      "11.17.2), `A` records `styles=[\"fill:#fddposition:fixed\",\"stroke:#c00\"]`. " +
      "The `;` never reaches the declaration gate, so nothing is refused or " +
      "reported; the browser is handed a `fill` it cannot read, and the " +
      "`stroke` beside it.",
    assert: (result) => {
      expectSame("node A's inline style", nodeStyle(result, "A"), "fill:#fddposition:fixed;stroke:#c00");
      expectSame("node B's inline style", nodeStyle(result, "B"), "");
      expectSame("no diagnostic", result.diagnostics, []);
    },
  },
  {
    id: "fc-style-beats-class",
    kind: "flowchart",
    source: `flowchart TB
      classDef alpha fill:#f00,stroke:#00f
      A
      style A fill:#0ff
      class A alpha`,
    status: "supported",
    meaning:
      "A `style` beats an applied class **whichever is written first**. " +
      "Measured on 12.2.0 (flowchart): with `style` above the `class` line the " +
      "target still paints the `style`'s `fill`, keeping the class's " +
      "`stroke` — `fill:#0ff !important;stroke:#00f !important`. Siren used " +
      "to let the later line win, drawing the class's `fill` with no " +
      "diagnostic (01M39F9N1; ADR-0008's 2026-10-14 amendment).",
    assert: (result) => {
      expectSame("A's frame", nodeStyle(result, "A"), "fill:#0ff;stroke:#00f");
    },
  },
  {
    id: "fc-style-classdef-default",
    kind: "flowchart",
    source: `flowchart TB
      A --> B
      B --> C
      classDef default fill:#abc,stroke:#00f
      classDef urgent fill:#f00
      class B urgent
      style C fill:#0f0`,
    status: "supported",
    meaning:
      "`classDef default` styles **every** node without being applied: " +
      "Mermaid creates each vertex already wearing a class called `default`. " +
      "Measured on 12.2.0 (`--markup`): A paints `fill:#abc;stroke:#00f`; B, " +
      "which also wears `urgent`, paints `fill:#f00;stroke:#00f` — `default` " +
      "is the lowest class, so `urgent` overrides the fill it shares and the " +
      "stroke survives; a `style` beats it as it beats any class; the line " +
      "may come after the nodes; and a subgraph's frame is not painted. Siren " +
      "used to record the definition and apply it to nothing, with no " +
      "diagnostic (01M39F94W). Flowchart only: re-measured, a class diagram " +
      "paints nothing for it, a state diagram refuses it, and ER refuses it " +
      "by name (`er-style-classdef-default`).",
    assert: (result) => {
      expectSame("A wears only default", nodeStyle(result, "A"), "fill:#abc;stroke:#00f");
      expectSame("B's own class overrides default's fill", nodeStyle(result, "B"), "fill:#f00;stroke:#00f");
      expectSame("a style overrides default", nodeStyle(result, "C"), "fill:#0f0;stroke:#00f");
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
    id: "fc-style-class-unknown-target",
    kind: "flowchart",
    source: `flowchart TB
      A[Start] --> B[End]
      classDef emphasis fill:#fdd
      class Ghost,A emphasis`,
    status: "supported",
    meaning:
      "Applying a class to an id the document never declares is **accepted " +
      "and silent**: the unknown target drops itself, the targets that do " +
      "exist are still styled, and nothing is reported. Measured (mermaid " +
      "11.17.2, `scripts/mermaid-probe.mjs`): this source reports `A` with " +
      "`classes=[\"emphasis\"]`, `B` with `classes=[]`, and **no vertex named " +
      "`Ghost` at all** — the name is neither styled nor declared, and no " +
      "error is raised. The unknown target is written **first** on purpose: " +
      "it is the order that tells \"drop this target\" apart from \"stop " +
      "reading this statement\", and both orders were measured (`class " +
      "A,Ghost emphasis` and `class Ghost,A emphasis` both give `A` " +
      "`classes=[\"emphasis\"]`). The same measurement in the other two kinds that " +
      "share `resolveStyles`: a class diagram's `cssClass \"Ghost\" urgent` " +
      "likewise adds no class and says nothing. A state diagram's database " +
      "records `class Ghost urgent` as a state `Ghost` carrying the class, " +
      "but re-measured on 12.2.0 with `--markup` no figure is drawn for it " +
      "(01M37GQRM), so the picture agrees there too; this row is written " +
      "for a flowchart because that is where the measurement was first " +
      "made. " +
      "Siren used to raise an error-severity diagnostic here in all three " +
      "kinds — a divergence it invented, and the reason this construct " +
      "could not be recorded as supported until now.",
    assert: (result) => {
      // The half that says the statement was not sunk: the target that does
      // exist still gets the declaration, so "drop the unknown target" did
      // not quietly become "drop the statement".
      expectSame("the target that exists is still styled", nodeStyle(result, "A"), "fill:#fdd");
      expectSame("and the node no statement named carries none", nodeStyle(result, "B"), "");
      // The half that says the unknown target was not *declared* into
      // existence: naming an id in a styling statement is not a way to
      // create it, so the picture holds exactly the two nodes the author
      // drew. Read off the drawn elements, because a `Ghost` that reached
      // the model but drew nothing would pass the two asserts above.
      expectSame("no third node was conjured by naming it", nodes(result), ["A[Start]", "B[End]"]);
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

  // A fan in every `interpolate` row below: each route turns two corners on
  // its way from A, which is what gives `basis` and `rounded` corners to
  // draw differently. ELK's routes are orthogonal, so `step` and `linear`
  // differ in `d` rather than in the picture (`edgeCurve` says how).
  {
    id: "fc-linkstyle-interpolate-default",
    kind: "flowchart",
    source: `flowchart TD
      A --> B
      A --> C
      linkStyle default interpolate step`,
    status: "supported",
    meaning:
      "`linkStyle default interpolate step` draws every edge with d3's " +
      "`curveStep`: horizontal and vertical segments only.",
    assert: (result) => {
      expectSame("edge A-B's line", edgeCurve(result, "A-B"), "axis-aligned steps");
      expectSame("edge A-C's line", edgeCurve(result, "A-C"), "axis-aligned steps");
    },
  },
  {
    id: "fc-linkstyle-interpolate-index",
    kind: "flowchart",
    source: `flowchart TD
      A --> B
      A --> C
      linkStyle 0 interpolate linear`,
    status: "supported",
    meaning:
      "`linkStyle 0 interpolate linear` draws the first declared edge as " +
      "straight segments through its route; the other edge keeps Mermaid " +
      "12's default, `rounded`.",
    assert: (result) => {
      expectSame("edge A-B's line", edgeCurve(result, "A-B"), "through its route");
      expectSame("edge A-C's line", edgeCurve(result, "A-C"), "rounded corners");
    },
  },
  {
    id: "fc-linkstyle-interpolate-with-declarations",
    kind: "flowchart",
    source: `flowchart TD
      A --> B
      A --> C
      linkStyle 1 interpolate step stroke:#f00`,
    status: "supported",
    meaning:
      "`interpolate` and declarations on one line: Mermaid's grammar reads " +
      "`linkStyle <n> interpolate <curve> <styles>` as both a curve and a " +
      "style for the same edges.",
    assert: (result) => {
      expectSame("edge A-C's line", edgeCurve(result, "A-C"), "axis-aligned steps");
      expectSame("edge A-C's inline style", edgeStyle(result, "A-C"), "stroke:#f00");
      expectSame("edge A-B's line", edgeCurve(result, "A-B"), "rounded corners");
    },
  },
  {
    id: "fc-linkstyle-interpolate-index-beats-default",
    kind: "flowchart",
    source: `flowchart TD
      A --> B
      A --> C
      linkStyle 0 interpolate linear
      linkStyle default interpolate step`,
    status: "supported",
    meaning:
      "An index's curve beats `default`'s for the edge it names, even when " +
      "`default` is written after it — Mermaid draws " +
      "`rawEdge.interpolate || edges.defaultInterpolate` (measured, 11.17.2).",
    assert: (result) => {
      expectSame("edge A-B's line", edgeCurve(result, "A-B"), "through its route");
      expectSame("edge A-C's line", edgeCurve(result, "A-C"), "axis-aligned steps");
    },
  },
  {
    id: "fc-linkstyle-interpolate-unimplemented-rejected",
    kind: "flowchart",
    source: `flowchart TD
      A --> B
      A --> C
      linkStyle 0 interpolate cardinal`,
    status: "rejected",
    meaning:
      "`cardinal` is one of seven curves Mermaid draws (with `bumpX`, " +
      "`bumpY`, `catmullRom`, `monotoneX`, `monotoneY`, `natural`) that " +
      "Siren does not implement yet. Refused with an error naming it; the " +
      "edge is drawn with its fallback curve.",
  },
  {
    id: "fc-linkstyle-interpolate-unknown",
    kind: "flowchart",
    source: `flowchart TD
      A --> B
      A --> C
      linkStyle default interpolate step
      linkStyle 0 interpolate zigzag`,
    status: "supported",
    meaning:
      "A name that is no curve at all is drawn `rounded`, as Mermaid 12.2.0 " +
      "draws every edge its ELK layout routed (measured in headless Chrome: " +
      "`linkStyle 1 interpolate wobbly` draws that edge with `Q` corners). " +
      "An unknown name on an index still takes that edge off `default`'s " +
      "curve, as it did under 11.17.2. Siren also warns that the name " +
      "exists nowhere.",
    warnings: [
      'linkStyle interpolate "zigzag" names no curve; drawing rounded, as Mermaid does. ' +
        "Curves: basis, linear, step, stepBefore, stepAfter, rounded.",
    ],
    assert: (result) => {
      expectSame("edge A-B's line", edgeCurve(result, "A-B"), "rounded corners");
      expectSame("edge A-C's line", edgeCurve(result, "A-C"), "axis-aligned steps");
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
    id: "fc-click-bare-href-tooltip",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A "https://example.com" "Open it"`,
    status: "supported",
    meaning:
      "`click A \"url\" \"tip\"` — the bare shorthand with a tooltip. Measured " +
      "against Mermaid 11.17.2: accepted, the node is clickable and carries " +
      "`title=\"tip\"`, exactly as `click A href \"url\" \"tip\"`. Siren " +
      "draws the tooltip as the node group's leading <title>.",
    assert: (result) => {
      const link = svgOf(result).querySelector("a.siren-link");
      if (link === null) throw new Error("no <a class=\"siren-link\"> was drawn");
      expectSame("the href", link.getAttribute("href"), "https://example.com");
      expectSame("the target", link.getAttribute("target"), null);
      const group = link.querySelector('g.siren-node[data-siren-id="A"]');
      expectSame("it wraps the node", group !== null, true);
      expectSame(
        "the tooltip, as the node's leading <title>",
        group?.firstElementChild?.tagName === "title" ? group.firstElementChild.textContent : null,
        "Open it",
      );
    },
  },
  {
    id: "fc-click-bare-href-target",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A "https://example.com" _blank`,
    status: "supported",
    meaning:
      "`click A \"url\" _blank` — the bare shorthand with a target. Measured " +
      "against Mermaid 11.17.2 (securityLevel loose): `<a href=\"url\" " +
      "target=\"_blank\">`, as the href form draws.",
    assert: (result) => {
      const link = svgOf(result).querySelector("a.siren-link");
      if (link === null) throw new Error("no <a class=\"siren-link\"> was drawn");
      expectSame("the href", link.getAttribute("href"), "https://example.com");
      expectSame("the target", link.getAttribute("target"), "_blank");
      const group = link.querySelector('g.siren-node[data-siren-id="A"]');
      expectSame("it wraps the node", group !== null, true);
      expectSame(
        "the tooltip, as the node's leading <title>",
        group?.firstElementChild?.tagName === "title" ? group.firstElementChild.textContent : null,
        null,
      );
    },
  },
  {
    id: "fc-click-bare-href-tooltip-target",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A "https://example.com" "Open it" _blank`,
    status: "supported",
    meaning:
      "`click A \"url\" \"tip\" _blank` — tooltip and target together. " +
      "Measured against Mermaid 11.17.2: identical to `click A href \"url\" " +
      "\"tip\" _blank`.",
    assert: (result) => {
      const link = svgOf(result).querySelector("a.siren-link");
      if (link === null) throw new Error("no <a class=\"siren-link\"> was drawn");
      expectSame("the href", link.getAttribute("href"), "https://example.com");
      expectSame("the target", link.getAttribute("target"), "_blank");
      const group = link.querySelector('g.siren-node[data-siren-id="A"]');
      expectSame("it wraps the node", group !== null, true);
      expectSame(
        "the tooltip, as the node's leading <title>",
        group?.firstElementChild?.tagName === "title" ? group.firstElementChild.textContent : null,
        "Open it",
      );
    },
  },
  {
    id: "fc-acc-descr-multiline",
    kind: "flowchart",
    source: `flowchart TB
      accDescr {
        how the order
          moves along
      } A[Start] --> B[End]`,
    status: "supported",
    meaning:
      "`accDescr`'s braced spelling in a flowchart. Measured on 12.2.0: the " +
      "description is the block's lines with their indent dropped, \"how the " +
      "order\\nmoves along\", and what follows the `}` is the next statement — " +
      "here the whole edge. Read by the same `readAccDescrBlock` the sequence " +
      "and ER parsers use (01M4WS1P6). Lower case only, unlike those two: a " +
      "flowchart's `ACCDESCR {` is a parse error.",
    assert: (result) => {
      expectSame("the accessible description text", svgOf(result).querySelector("desc")?.textContent, "how the order\nmoves along");
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
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
    status: "rejected",
    meaning:
      "⚠️ **Not valid Mermaid, and here for that reason**: until 01M4Z7TQRE " +
      "this row was `supported`, read as an edge with a comment after it. " +
      "Only a whole line is a comment — Mermaid 12.2.0's `cleanupComments` " +
      "removes `^\\s*%%(?!{)[^\\n]+\\n?` and nothing mid-line — and the " +
      "flowchart lexer has no `%%` rule of its own (`%` is a node-string " +
      "character), so this `%%` reaches the grammar after a complete edge and " +
      "is a parse error, measured: \"Expecting 'SEMI', 'NEWLINE', 'EOF', " +
      "'AMP', 'START_LINK', 'LINK', 'LINK_ID', got 'NODE_STRING'\". Siren " +
      "refuses it too (ADR-0017), with an error at the `%%` saying a mid-line " +
      "`%%` is not a comment and, if it is one, to move it to a line of its own. A comment " +
      "on its own line renders in both.",
  },
  {
    id: "fc-comment-mid-line-text",
    kind: "flowchart",
    source: `flowchart TB
      A[50 %% done] -->|a %% b| B`,
    status: "supported",
    meaning:
      "A `%%` inside a label is text, not a comment: Mermaid 12.2.0 records " +
      "the node text `50 %% done` and the edge text `a %% b` (measured). " +
      "Siren used to cut the line at the first `%%`, refusing the truncated " +
      "label.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[50 %% done]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);
      expectSame("edge A-B's label", edgeLabel(result, "A-B"), "a %% b");
    },
  },
  // -------------------------------------------------------------------------
  // classDiagram
  // -------------------------------------------------------------------------
  {
    id: "cls-acc",
    kind: "class",
    source: `classDiagram
      accTitle: Orders
      accDescr: how orders move
      class Order`,
    status: "supported",
    meaning:
      "`accTitle:` and `accDescr:` give a class diagram its accessible title " +
      "and description, a `<title>` and a `<desc>` on the root, drawn nowhere " +
      "on the canvas — as Mermaid 12.2.0 writes them for every kind. Lower " +
      "case only in this kind: `ACCTITLE: T` is the class `ACCTITLE` with the " +
      "member `T` there. Siren drew classes called `accTitle` and `accDescr`, " +
      "each with the text as a member, with no diagnostic (01M4WVVN9).",
    assert: (result) => {
      const svg = svgOf(result);
      const title = svg.querySelector(":scope > title");
      const desc = svg.querySelector(":scope > desc");
      expectSame("the accessible title", title?.textContent, "Orders");
      expectSame("the accessible description", desc?.textContent, "how orders move");
      expectSame("labelled by it", svg.getAttribute("aria-labelledby"), title?.getAttribute("id"));
      expectSame("described by it", svg.getAttribute("aria-describedby"), desc?.getAttribute("id"));
      expectSame("no class is drawn for either line", classes(result), ["Order"]);
    },
  },
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
      // Drawn on its line, as Mermaid draws an edge label (`labelpos: "c"`).
      expectOnTheLine(
        "the label",
        result,
        'g.siren-relationship-labels[data-siren-id="Customer-Order"] text.siren-relationship-label',
        'g.siren-relationship[data-siren-id="Customer-Order"] path.siren-relationship-line',
      );
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
  {
    id: "cls-class-relabelled",
    kind: "class",
    source: `classDiagram
      class Order["x"]
      class Order["y"]`,
    status: "supported",
    meaning:
      "A class written with a second, different label is drawn with the " +
      "**last** one, and with no diagnostic. Measured (mermaid 11.17.2, " +
      "`node scripts/mermaid-probe.mjs --html`): `class A[\"x\"]` then " +
      "`class A[\"y\"]` records `label=\"y\"` and draws `<p>y</p>`. Siren " +
      "used to keep the first label and warn. A label is the exception " +
      "among the single-valued properties of a class: a second generic or " +
      "annotation is still dropped with a warning, because Mermaid keeps " +
      "the first of those (`class A~T~` then `class A~U~` records " +
      "`type=\"T\"`; two annotations draw only the first).",
    assert: (result) => {
      expectSame("classes", classes(result), ["Order"]);
      const name = svgOf(result).querySelector(
        'g.siren-class[data-siren-id="Order"] text.siren-class-name',
      );
      expectSame("the name's rows", labelRows(name), ["y"]);
    },
  },
  {
    id: "cls-class-label-br",
    kind: "class",
    source: `classDiagram
      class Order["Order<br/>Line"]`,
    status: "supported",
    meaning:
      "`class X[\"label\"]` draws the label in place of the name, and `<br>` in " +
      "it is a line break: a class label is one of the positions ADR-0015 " +
      "reads with the whole tag vocabulary. Measured (mermaid 11.17.2, " +
      "`--paint`): `class A[\"Order<br/>Line\"]` draws `Order` over `Line` in " +
      "both label modes, and a label replaces the generic too " +
      "(`class A~T~[\"Lab\"]` draws `Lab`). Siren used to reject the bracket " +
      "outright. The name band is sized for both rows.",
    assert: (result) => {
      const group = 'g.siren-class[data-siren-id="Order"]';
      const name = svgOf(result).querySelector(`${group} text.siren-class-name`);
      expectSame("the name's rows", labelRows(name), ["Order", "Line"]);
      const frame = svgOf(result).querySelector(`${group} rect.siren-class-frame`);
      const top = Number(frame?.getAttribute("y"));
      const bottom = top + Number(frame?.getAttribute("height"));
      const rowYs = Array.from(name?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit inside the box (rows at ${JSON.stringify(rowYs)}, box ${top}..${bottom})`,
        rowYs.length === 2 && rowYs.every((y) => y > top && y < bottom),
        true,
      );
    },
  },
  {
    id: "cls-relationship-label-br",
    kind: "class",
    source: `classDiagram
      Order --> Line : holds<br/>many`,
    status: "supported",
    meaning:
      "`<br>` in a relationship's `: label` is a line break, as it is on a " +
      "flowchart edge. Measured (mermaid 11.17.2, `--paint`): `A --> B : " +
      "a<br/>b` draws `a` over `b` in both label modes. Siren used to draw " +
      "`holds<br/>many` literally. Drawn centred on the space layout kept " +
      "clear for it, which is now the label box's centre rather than its " +
      "baseline.",
    assert: (result) => {
      expectSame(
        "the label's rows",
        labelRows(
          svgOf(result).querySelector(
            'g.siren-relationship-labels[data-siren-id="Order-Line"] text.siren-relationship-label',
          ),
        ),
        ["holds", "many"],
      );
    },
  },
  {
    id: "cls-label-line-height",
    kind: "class",
    source: `classDiagram
      class Order["Order<br/>Line"]
      Order --> Line : holds<br/>many`,
    status: "supported",
    meaning:
      "A class's label and a relationship's label are rows one line apart, a " +
      "line being 1.5 times the font size: mermaid 11.17.2 draws a two-row " +
      "relationship label as a 48px `<div>` of 16px text (measured). Siren's " +
      "class label is 14px, 21px apart; its relationship label is 12px, 18px " +
      "apart.",
    assert: (result) => {
      expectSame("class label row gaps", rowGaps(result, "text.siren-class-name"), [21]);
      expectSame(
        "relationship label row gaps",
        rowGaps(result, 'g.siren-relationship-labels[data-siren-id="Order-Line"] text.siren-relationship-label'),
        [18],
      );
    },
  },
  // Automatic wrapping (the label-wrap ADR, nook `01M4R4WDZ`, and its
  // amendment `01M4R7HBG`), measured on mermaid 11.17.2: a relationship's
  // label wraps at 200px of its 16px text; a class's name and a note do not.
  {
    id: "cls-relationship-label-wrap",
    kind: "class",
    source: `classDiagram
      Animal --> Dog : this relation label is long enough to go well past two hundred pixels wide`,
    status: "supported",
    meaning:
      "A relationship label wider than Mermaid's wrapping width wraps: " +
      "mermaid 11.17.2 draws this one as `this relation label is long ` / " +
      "`enough to go well past two ` / `hundred pixels wide` in a 200px " +
      "`<div>` (measured), as a flowchart edge label. Siren draws a " +
      "relationship label at 12px, so it wraps at 150px of text, Mermaid's " +
      "200px scaled to that size (the label-wrap ADR, nook `01M4R4WDZ`): " +
      "the same number of characters to a row.",
    assert: (result) => {
      // At 12px the default measurer is 12/14 of its 8px a character, so 21
      // characters fit in 150px and 22 do not.
      expectSame(
        "relationship label rows",
        labelRows(
          svgOf(result).querySelector(
            'g.siren-relationship-labels[data-siren-id="Animal-Dog"] text.siren-relationship-label',
          ),
        ),
        ["this relation label", "is long enough to go", "well past two hundred", "pixels wide"],
      );
    },
  },
  {
    id: "cls-class-name-no-wrap",
    kind: "class",
    source: `classDiagram
      class Animal["This is a fairly long English class label that should exceed two hundred pixels"]`,
    status: "supported",
    meaning:
      "A class's name is never wrapped, however long: mermaid 11.17.2 draws " +
      "this one `white-space: nowrap` on one 577px row, in a 601px box " +
      "(measured), and a long unspaced name the same. Siren keeps it on one " +
      "row and grows the box to hold it (the label-wrap ADR, nook " +
      "`01M4R4WDZ`).",
    assert: (result) => {
      const name = "This is a fairly long English class label that should exceed two hundred pixels";
      expectSame(
        "class name rows",
        labelRows(svgOf(result).querySelector('g.siren-class[data-siren-id="Animal"] text.siren-class-name')),
        [name],
      );
      const frame = svgOf(result).querySelector('g.siren-class[data-siren-id="Animal"] rect.siren-class-frame');
      expectSame(
        "the box holds the name",
        Number(frame?.getAttribute("width")) >= name.length * 8 + 16,
        true,
      );
    },
  },
  {
    id: "cls-note-no-wrap",
    kind: "class",
    source: `classDiagram
      class Dog
      note for Dog "this note text is long enough to go well past two hundred pixels wide surely"`,
    status: "supported",
    meaning:
      "A class diagram's note is not wrapped, unlike a state diagram's: " +
      "mermaid 11.17.2 gives its `<div>` `white-space: break-spaces` and a " +
      "200px `max-width`, but draws it as a table, which `max-width` does " +
      "not narrow, so the text stays on one 544px row in a 556 × 36 note " +
      "(measured). Siren keeps it on one row (the label-wrap ADR's " +
      "amendment, nook `01M4R7HBG`, leaves a class note to this measurement).",
    assert: (result) => {
      const note = "this note text is long enough to go well past two hundred pixels wide surely";
      expectSame("note rows", labelRows(svgOf(result).querySelector("g.siren-note text.siren-note-text")), [note]);
      const frame = svgOf(result).querySelector("g.siren-note rect.siren-note-frame");
      expectSame(
        "the note holds the text",
        Number(frame?.getAttribute("width")) >= note.length * 8 + 16,
        true,
      );
    },
  },
  {
    id: "cls-member-no-wrap",
    kind: "class",
    source: `classDiagram
      class Dog {
        +String aVeryLongMemberNameThatGoesOnAndOn with some words past two hundred pixels
      }`,
    status: "supported",
    meaning:
      "A class's member line is never wrapped, however long: mermaid 11.17.2 " +
      "draws this one `white-space: nowrap` on one 661px row, and a long " +
      "method signature the same (measured). The label-wrap ADR (nook " +
      "`01M4R4WDZ`, as amended by `01M4R7HBG`) wraps none of a class's " +
      "compartments; Siren keeps the member on one row and grows the box to " +
      "hold it.",
    assert: (result) => {
      const member = "+String aVeryLongMemberNameThatGoesOnAndOn with some words past two hundred pixels";
      expectSame("Dog's members", members(result, "Dog"), [member]);
      const text = svgOf(result).querySelector('g.siren-class[data-siren-id="Dog"] text.siren-member');
      expectSame("the member is one row", text?.querySelectorAll("tspan.siren-label-row").length ?? 0, 0);
      const frame = svgOf(result).querySelector('g.siren-class[data-siren-id="Dog"] rect.siren-class-frame');
      expectSame(
        "the box holds the member",
        Number(frame?.getAttribute("width")) >= member.length * 8,
        true,
      );
    },
  },
  {
    id: "cls-note-br",
    kind: "class",
    source: `classDiagram
      class Duck
      note for Duck "can fly<br/>can swim"`,
    status: "supported",
    meaning:
      "`<br>` in a note is a line break. The board had inferred this position " +
      "rather than measured it, so it was measured (mermaid 11.17.2, " +
      "`--paint`, `htmlLabels: true`): `note for A \"n<br/>m <i>q</i>r\"` " +
      "reads `nm qr`, two rows with the tags honored, and a free note the " +
      "same. Siren used to draw the note's text literally. The note's box is " +
      "sized for both rows.",
    assert: (result) => {
      const text = svgOf(result).querySelector("g.siren-note text.siren-note-text");
      expectSame("the note's rows", labelRows(text), ["can fly", "can swim"]);
      const frame = svgOf(result).querySelector("g.siren-note rect.siren-note-frame");
      const top = Number(frame?.getAttribute("y"));
      const bottom = top + Number(frame?.getAttribute("height"));
      const rowYs = Array.from(text?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit inside the note (rows at ${JSON.stringify(rowYs)}, note ${top}..${bottom})`,
        rowYs.length === 2 && rowYs.every((y) => y > top && y < bottom),
        true,
      );
    },
  },
  {
    id: "cls-namespace-label-br",
    kind: "class",
    source: `classDiagram
      namespace Zoo["Big<br/>Zoo"] {
        class Lion
      }`,
    status: "supported",
    meaning:
      "`namespace X[\"label\"] {` labels the frame, and `<br>` in it is a line " +
      "break. Not on the board's table of measured places, so measured " +
      "(mermaid 11.17.2, `--paint`): `namespace Zoo[\"Big<br/>Zoo <b>x</b>\"] {` " +
      "keeps `Zoo` as the cluster's id and draws `Big` over `Zoo x`. Siren " +
      "used to reject the bracket outright. The frame's label strip holds " +
      "both rows, so the class is drawn below them.",
    assert: (result) => {
      const label = svgOf(result).querySelector("g.siren-namespace text.siren-namespace-label");
      expectSame("the label's rows", labelRows(label), ["Big", "Zoo"]);
      const rows = Array.from(label?.querySelectorAll(":scope > tspan.siren-label-row") ?? []);
      const lastRowY = Number(rows[rows.length - 1]?.getAttribute("y"));
      const lionTop = classBox(result, "Lion").y;
      expectSame(
        `the label's last row is above Lion (at ${lastRowY}, Lion's top at ${lionTop})`,
        lastRowY < lionTop,
        true,
      );
    },
  },
  {
    id: "cls-member-tags-literal",
    kind: "class",
    source: `classDiagram
      class Order {
        +id<br/>int
        +<b>id</b> int
      }`,
    status: "supported",
    meaning:
      "A member is not a label: Mermaid escapes a member's text in both label " +
      "modes (measured, mermaid 11.17.2, `--paint`), so `+id<br/>int` draws " +
      "the characters `+id<br>int` — Mermaid's own `/<br\\s*\\/?>/gi` respells " +
      "the break first — and `+<b>id</b> int` draws its tags as written. Siren " +
      "used to reject `+id<br/>int` as an unrecognized member.",
    assert: (result) => {
      expectSame("Order's members", members(result, "Order"), ["+id<br>int", "+<b>id</b> int"]);
    },
  },
  {
    id: "cls-member-tags-literal-rejected",
    kind: "class",
    source: `classDiagram
      class A {
        +int <b>id</b>
        +x<br class="y">z
      }`,
    status: "rejected",
    meaning:
      "The same rule as `cls-member-tags-literal`, in two spellings Siren " +
      "cannot read yet. Mermaid escapes a member's text in both label modes " +
      "(measured, mermaid 11.17.2, `--html`: the members' labels are " +
      "`+int &lt;b&gt;id&lt;/b&gt;` and `+x&lt;br class=\"y\"&gt;z`), so it " +
      "draws `+int <b>id</b>` and `+x<br class=\"y\">z` as characters — " +
      "and a `<br>` with an attribute is not one of the spellings its " +
      "`/<br\\s*\\/?>/gi` respells. Those characters are not quite the ones " +
      "written: the member's text passes through DOMPurify before it is " +
      "escaped, and the `\"` is DOMPurify's re-serialization, not the " +
      "author's quote — Mermaid's whole-document `cleanupText` has already " +
      "made it `class='y'`. Re-measured (T23): `+x<br class=\"a'b\">z` is " +
      "drawn `+x<br class=\"a\">z` (the rewrite's `'a'b'` cut short), and " +
      "`+x<br class = \"y\">z` is drawn `+x<br class=\"y\">z`. Siren refuses both as unrecognized " +
      "members: a member's name is read as an identifier, and `<b>id</b>` " +
      "after a type, or `x<br class=\"y\">z` with a space inside it, is not " +
      "one. Its exit is implementation — a member whose text is not a typed " +
      "identifier kept and drawn as characters, as Mermaid does, including " +
      "the tag DOMPurify re-serializes.",
  },
  {
    id: "cls-class-label-tag-quotes",
    kind: "class",
    source: `classDiagram
      class B["<span style="color:red">t</span>"]`,
    status: "supported",
    meaning:
      "Before any diagram reads a line, Mermaid rewrites each `=\"\u2026\"` " +
      "inside a tag-shaped stretch `/<(\\w+)([^>]*)>/` as `='\u2026'` (its " +
      "`cleanupText`, over the whole document). So a class label may " +
      "hold a double-quoted attribute inside its own quotes. Measured " +
      "(mermaid 11.17.2): the label is `<span style=\"color:red\">t</span>`.",
    assert: (result) => {
      const name = svgOf(result).querySelector('g.siren-class[data-siren-id="B"] text.siren-class-name');
      expectSame("B's runs", labelRuns(name, "style"), ["t[style=fill: red]"]);
    },
  },
  {
    id: "cls-style-statement",
    kind: "class",
    source: `classDiagram
      class Order
      class Other
      style Order fill:#f96,stroke:#00f,color:#0a0`,
    status: "supported",
    meaning:
      "`style X decls` writes declarations straight onto one class box. " +
      "Measured in headless Chrome (mermaid 12.2.0, computed style): Order's " +
      "frame paints `fill:rgb(255, 153, 102)` and `stroke:rgb(0, 0, 255)`, " +
      "its label `color:rgb(0, 170, 0)` — the `color` reaches the text — and " +
      "Other keeps the palette (`fill:rgb(240, 253, 250)`). jsdom's markup " +
      "shows no `fill` anywhere for it, which is why 01M4WT4KY measured in a " +
      "real browser.",
    assert: (result) => {
      expectSame("Order's paint", classStyle(result, "Order"), {
        frame: "fill:#f96;stroke:#00f",
        name: "fill:#0a0",
      });
      expectSame("Other is unstyled", classStyle(result, "Other"), { frame: "", name: "" });
    },
  },
  {
    id: "cls-style-cssclass",
    kind: "class",
    source: `classDiagram
      class Early
      class Late
      class Plain
      cssClass "Early" urgent
      classDef urgent fill:#f96,stroke:#00f,color:#0a0
      cssClass "Late" urgent`,
    status: "supported",
    meaning:
      "`cssClass \"X\" c` applies the `classDef c` declarations to a class " +
      "box, and Siren paints them **whichever side of the `classDef` line " +
      "the `cssClass` is written on**. Mermaid 12.2.0 does not: measured in " +
      "headless Chrome (computed style, this source), Early — applied before " +
      "the `classDef` — paints `fill:rgb(255, 153, 102)`, " +
      "`stroke:rgb(0, 0, 255)` and a label `color:rgb(0, 170, 0)`, while " +
      "Late — applied after it — wears the class " +
      "(`class=\"node default urgent\"`) and paints nothing of it: palette " +
      "`fill:rgb(240, 253, 250)`, `stroke:rgb(45, 212, 191)`, label " +
      "`rgb(40, 37, 61)`. A `classDef` names its declarations for every box " +
      "wearing the class and says nothing about line order, so this is " +
      "CONTEXT.md's third rule: Mermaid's picture contradicts the document, " +
      "and Siren draws what the document says (01M4WT4KY). The target must " +
      "be quoted: `cssClass Order urgent` is a Mermaid parse error " +
      "(`Expecting 'STR', got 'ALPHA'`).",
    assert: (result) => {
      const urgent = { frame: "fill:#f96;stroke:#00f", name: "fill:#0a0" };
      expectSame("applied before the classDef", classStyle(result, "Early"), urgent);
      expectSame("applied after the classDef", classStyle(result, "Late"), urgent);
      expectSame("the class no cssClass named", classStyle(result, "Plain"), { frame: "", name: "" });
    },
  },
  {
    id: "cls-style-shorthand",
    kind: "class",
    source: `classDiagram
      class Early:::urgent
      classDef urgent fill:#f96,stroke:#00f,color:#0a0
      class Late:::urgent
      class Plain`,
    status: "supported",
    meaning:
      "`class X:::c` declares a class and attaches the `classDef c` " +
      "declarations to it, and Siren paints them **whichever side of the " +
      "`classDef` line the attach is written on**. Mermaid 12.2.0 does not: " +
      "measured in headless Chrome (computed style, this source), Early — " +
      "attached before the `classDef` — paints `fill:rgb(255, 153, 102)`, " +
      "`stroke:rgb(0, 0, 255)` and a label `color:rgb(0, 170, 0)`, while " +
      "Late — attached after it — wears the class " +
      "(`class=\"node default urgent\"`) and paints nothing of it: palette " +
      "`fill:rgb(240, 253, 250)`, `stroke:rgb(45, 212, 191)`, label " +
      "`rgb(40, 37, 61)`. A `classDef` names its declarations for every box " +
      "wearing the class and says nothing about line order, so this is " +
      "CONTEXT.md's third rule: Mermaid's picture contradicts the document, " +
      "and Siren draws what the document says (01M4WT4KY). Siren used to " +
      "refuse the line as unrecognized. Where Mermaid takes `:::` at all, " +
      "measured: after the name, a `~generic~` or a `[\"label\"]`, with or " +
      "without spaces round it, and in the block form's opening line. " +
      "Everywhere else it is a parse error — a relationship end " +
      "(`X:::c --> Y`, `Y --> X:::c`), a bare `X:::c`, the inline member " +
      "form, after an annotation, a list (`:::c,d`), a second `:::`, and a " +
      "hyphenated name — and Siren refuses those too.",
    assert: (result) => {
      const urgent = { frame: "fill:#f96;stroke:#00f", name: "fill:#0a0" };
      expectSame("attached before the classDef", classStyle(result, "Early"), urgent);
      expectSame("attached after the classDef", classStyle(result, "Late"), urgent);
      expectSame("the class no attach named", classStyle(result, "Plain"), { frame: "", name: "" });
    },
  },
  {
    id: "cls-style-shorthand-block",
    kind: "class",
    source: `classDiagram
      classDef urgent fill:#f96,stroke:#00f,color:#0a0
      class Order:::urgent {
        +int id
      }`,
    status: "supported",
    meaning:
      "`:::c` on a block-form declaration's opening line attaches the class " +
      "just as `class X:::c` does, members and all. Measured on mermaid " +
      "12.2.0 (headless Chrome): `class X:::c {` and `class X:::c{` both draw " +
      "X with its members and `class=\"node default c\"`. The attach is " +
      "written after the `classDef` here, so Mermaid paints nothing of it " +
      "(palette `fill:rgb(253, 244, 255)`); Siren paints it, by the rule-3 " +
      "divergence `cls-style-shorthand` records.",
    assert: (result) => {
      expectSame("Order's paint", classStyle(result, "Order"), {
        frame: "fill:#f96;stroke:#00f",
        name: "fill:#0a0",
      });
      expectSame("Order's members", members(result, "Order"), ["+int id"]);
    },
  },
  {
    id: "cls-comment-mid-line-text",
    kind: "class",
    source: `classDiagram
      class Order {
        +int total %% in cents
      }
      Order --> Line : holds %% one or more
      note for Order "paid %% or not"`,
    status: "supported",
    meaning:
      "A `%%` in a member, a relationship's label or a note's text is text, " +
      "not a comment: Mermaid 12.2.0's `cleanupComments` removes whole-line " +
      "comments only, and the class grammar reads each of these to the " +
      "line's end or the closing quote, `%%` included (measured: the member " +
      "`+int total %% in cents`, the label `holds %% one or more`, the note " +
      "`paid %% or not`). Siren used to cut each line at its first `%%`.",
    assert: (result) => {
      expectSame("Order's members", members(result, "Order"), ["+int total %% in cents"]);
      expectSame("relationship label", texts(result, "text.siren-relationship-label"), ["holds %% one or more"]);
      expectSame("note text", texts(result, "text.siren-note-text"), ["paid %% or not"]);
    },
  },
  {
    id: "cls-comment-last-line",
    kind: "class",
    source: `classDiagram
      direction LR %% left to right
      Animal <|-- Duck %% the last line`,
    status: "supported",
    meaning:
      "The class lexer reads a `%%` as a comment where a token ends, and " +
      "its rule swallows the line break after it. After `direction` that " +
      "costs nothing; after a relationship the next line would run on into " +
      "it, so the comment holds only on the document's last line, as here. " +
      "Measured on Mermaid 12.2.0: drawn left to right, `Duck` inheriting " +
      "from `Animal`, no trace of either comment.",
    assert: (result) => {
      expectSame("classes", classes(result), ["Animal", "Duck"]);
      expectSame("relationships", relationships(result).length, 1);
      expectSame("Duck right of Animal", classBox(result, "Duck").x > classBox(result, "Animal").x, true);
      expectSame("no comment drawn", texts(result, "text").some((text) => text.includes("%%")), false);
    },
  },
  {
    id: "cls-comment-mid-document",
    kind: "class",
    source: `classDiagram
      Animal <|-- Duck %% ducks are animals
      Animal <|-- Fish`,
    status: "rejected",
    meaning:
      "⚠️ **Not valid Mermaid, and here for that reason.** The class " +
      "lexer's `%%` rules swallow the line break after the comment, so " +
      "`Animal <|-- Fish` runs on into the first relationship and Mermaid " +
      "12.2.0 refuses the document (\"Expecting 'NEWLINE', 'EOF', 'LABEL', " +
      "got 'EXTENSION'\", measured). Siren refuses it too (ADR-0017), with an error at the `%%` " +
      "saying a mid-line `%%` is not a comment and, if it is one, to move it " +
      "to a line of its own. Siren used to cut the line at the `%%`. A " +
      "comment on its own line renders in both.",
  },
  {
    id: "cls-comment-after-annotation",
    kind: "class",
    source: `classDiagram
      class Shape {
        <<interface>> %% drawn as a member
        +area() double
      }`,
    status: "rejected",
    meaning:
      "⚠️ **Mermaid accepts this and draws something else.** Inside a " +
      "class block, `<<interface>> %% …` is no annotation to Mermaid 12.2.0 " +
      "but a member, drawn `<> %% drawn as a member` with the " +
      "`<interface>` stripped as a tag (measured) — neither the annotation " +
      "nor the text, with no diagnostic. Siren refuses it (ADR-0001), with " +
      "an error at the `%%`. Siren used to cut the line and draw the " +
      "annotation. The comment on its own line renders in both.",
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
    warnings: [
      'The destroyed participant "B" has no destroying message, so the destroy draws nothing: its lifeline runs to the bottom. A message sent by or to it right after the destroy ends it there.',
    ],
    meaning:
      "`create` starts a lifeline partway down: `A->>B: are you there` is " +
      "B's creating message, so B's box is drawn on that arrow. Nothing " +
      "follows the `destroy`, so it has no destroying message to pair with. " +
      "Measured on 12.2.0: Mermaid accepts this and draws B as if it were " +
      "never destroyed — no closing box on any arrow, the lifeline running " +
      "on to the bottom row, where B gets a box level with A's (y 234 " +
      "both). Siren draws the same: no X, B's lifeline down to where A's " +
      "ends and a bottom-row box there, nothing in the `destroy`'s place " +
      "(nook 01M4YWYFJ), and warns that the `destroy` draws nothing. " +
      "Nothing but declarations comes before the `create`, so B's lane is " +
      "where a declared B's would be (measured: x 200 either way).",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame("no destroy mark was drawn", drew(result, "path.siren-destroy-mark"), false);
      expectSame("B's box is on its creating message", createdBox(result, "B"), "centred on A-B, whose arrow stops at its left edge");
      expectSame("B's lifeline runs as far down as A's", lifelineBottom(result, "B"), lifelineBottom(result, "A"));
      expectSame("B is drawn in the bottom row, level with A", bottomRowEdge(result, "B"), bottomRowEdge(result, "A"));
    },
  },
  {
    id: "seq-creating-message",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      A->>A: before
      create participant C
      A->>C: make
      A->>C: again`,
    status: "supported",
    meaning:
      "`create participant C` is a declaration about the next message, which " +
      "must be sent to C: its creating message. Measured on 12.2.0: " +
      "accepted; C's box is centred on `A->>C: make`'s arrow, which stops " +
      "short of the box, C's lifeline starts at the box's bottom, and the " +
      "`create` takes no row of its own. Siren draws the box there too, the " +
      "arrow ending at its edge; `again` runs on to C's lane as any message " +
      "does. Never destroyed, C also gets a box in the bottom row, level " +
      "with A's, and — `A->>A: before` being drawn before the `create` — " +
      "its lane sits half its width further right than a declared C's " +
      "would (`seq-created-lane-offset`).",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-A: before", "A-C: make", "A-C#2: again"]);
      expectSame("C's box is on its creating message", createdBox(result, "C"), "centred on A-C, whose arrow stops at its left edge");
      expectSame("C is drawn in the bottom row, level with A", bottomRowEdge(result, "C"), bottomRowEdge(result, "A"));
    },
  },
  {
    id: "seq-created-lane-offset",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      A->>A: before
      create participant B
      A->>B: make
      participant C
      B->>C: pass on`,
    status: "supported",
    meaning:
      "A participant created after something is already drawn. Measured on " +
      "12.2.0 (layout stubs, 150-wide boxes, 50 between lanes): B's box " +
      "starts at x 275 where a declared B's would start at 200 — 125 past " +
      "A's box rather than 50, half its own width more " +
      "(`addActorRenderingData`'s `prevMargin += actor.width / 2`) — and C " +
      "follows it, 50 past B, the whole diagram 75 wider; `create actor B` " +
      "moves the same. B, never destroyed, also gets a box in the bottom " +
      "row, level with A's and C's. Mermaid moves a lane only when " +
      "anything — a message, note, activation, block or `autonumber` — " +
      "comes before its `create`; after declarations alone it stays put " +
      "(`seq-create-destroy`). Siren draws the same: the gap before B's box " +
      "is the plain gap plus half B's width, and B's bottom-row box is " +
      "level with A's.",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B", "C"]);
      expectSame(
        "the gap before B's box is the one after it plus half B's width",
        laneGap(result, "A", "B") - laneGap(result, "B", "C"),
        topBox(result, "B").width / 2,
      );
      expectSame("B is drawn in the bottom row, level with A", bottomRowEdge(result, "B"), bottomRowEdge(result, "A"));
      expectSame("C is drawn in the bottom row, level with A", bottomRowEdge(result, "C"), bottomRowEdge(result, "A"));
    },
  },
  {
    id: "seq-create-actor-long-label",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      create actor C as Carol the very long-named customer
      A->>C: make`,
    status: "supported",
    meaning:
      "A created `actor` whose label is far wider than its stick figure. " +
      "Mermaid 12.2.0 draws the figure a fixed `ACTOR_TYPE_WIDTH` (36) wide " +
      "whatever the label and stops the creating arrow against that figure " +
      "(`ACTOR_TYPE_WIDTH / 2 + 3`, measured: the arrow's line ends 28 short " +
      "of the lane, its 7px marker included), not against the label. Siren " +
      "draws its figure 36 wide too, the label free to be wider beneath it, " +
      "and stops the arrow at the figure's near arm tip, 18 from the lane, " +
      "as it stops one at a box's near edge (nook 01M4YVB29).",
    assert: (result) => {
      expectSame("C's figure is on its creating message", createdFigureArrow(result, "C"), "A-C stops at its left arm tip, 18 short of its lane");
    },
  },
  {
    id: "seq-create-next-message-sent-by-created",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      create participant C
      C->>A: hi`,
    status: "rejected",
    meaning:
      "`create participant C` declares that the next message is C's " +
      "creating message, which must be sent to C; one C sends does not " +
      "count. Measured on 12.2.0: Mermaid refuses the document (\"The " +
      "created participant … does not have an associated creating message " +
      "after its declaration\"). Siren refuses it too, with an error at the " +
      "`create` line saying the next message must be sent to C.",
  },
  {
    id: "seq-create-without-creating-message",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      create participant C
      A->>B: hi`,
    status: "rejected",
    meaning:
      "The next message after `create participant C` joins A and B, so C " +
      "has no creating message. Measured on 12.2.0: Mermaid refuses the " +
      "document, as for a message C sends. Siren refuses it with the same " +
      "error at the `create` line. Refused documents cost an author nothing " +
      "Mermaid gave them.",
  },
  {
    id: "seq-create-at-end",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      A->>A: think
      create participant C`,
    status: "supported",
    warnings: [
      'The created participant "C" has no creating message, so the create draws nothing: its lifeline starts at the top. A message sent to it right after the create starts it there.',
    ],
    meaning:
      "A `create` with no message after it has nothing to pair with. " +
      "Measured on 12.2.0: accepted, with no error, and C drawn much as a " +
      "declared participant is — its box in the top row and again in the " +
      "bottom row, its lifeline full height — with no row for the `create`, " +
      "though its lane sits half a box further right (`addActorRenderingData` " +
      "keeps a created actor's `prevMargin`). `create actor C` draws its " +
      "figure the same way. Siren draws C's rows exactly as it draws A's " +
      "(nook 01M4YWYFJ) but does not model that x offset for a `create` " +
      "with no creating message — the model reads it as a declaration, " +
      "keeping no trace of the `create` — laying C's lane out as a " +
      "declared one's, and warns that the `create` draws nothing. A " +
      "created participant with a creating message does move " +
      "(`seq-created-lane-offset`).",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "C"]);
      expectSame("C is drawn as A is, top row to bottom row", participantRows(result, "C"), participantRows(result, "A"));
    },
  },
  {
    id: "seq-create-note-before-creating-message",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      create participant C
      note over A: aside
      A->>C: make`,
    status: "rejected",
    meaning:
      "A note between `create participant C` and `A->>C: make`. Measured on " +
      "12.2.0: accepted, with no error, but Mermaid draws C's box at the top " +
      "and runs the arrow to C's lane as if C were never created — its " +
      "drawing pairs the `create` with the record right after it, here the " +
      "note. A wrong picture with no diagnostic, so Siren refuses it " +
      "(ADR-0001's exception, nook 01M4YS7DV8), with an error at the " +
      "`create` line saying the message must come right after the `create`, " +
      "with no note in between. The same holds for an `activate`, a " +
      "`deactivate`, an `autonumber`, a block boundary, or another `create` " +
      "or `destroy` in between, on either declaration.",
  },
  {
    id: "seq-destroying-message-received",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>B: hi
      destroy B
      A->>B: bye
      A->>A: carry on`,
    status: "supported",
    meaning:
      "`destroy B` is a declaration about the next message, which B must " +
      "send or receive: its destroying message. Measured on 12.2.0: " +
      "accepted, and B's lifeline ends on `A->>B: bye`'s own row (Mermaid " +
      "centres B's closing box on that arrow), with no row for the " +
      "`destroy` itself. Siren draws its X there, on the arrow's tip, and " +
      "says nothing — the arrow reaches B before B stops.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-B: hi", "A-B#2: bye", "A-A: carry on"]);
      expectSame("B ends on the destroying message's tip", lifelineEnd(result, "B"), "tip of A-B#2, lifeline stops there");
    },
  },
  {
    id: "seq-destroy-without-destroying-message",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      participant C
      A->>B: hi
      destroy B
      A->>C: unrelated`,
    status: "rejected",
    meaning:
      "`destroy B` declares that the next message is B's destroying " +
      "message, which B must send or receive. Here the next message joins A " +
      "and C. Measured on 12.2.0: Mermaid refuses the document (\"The " +
      "destroyed participant … does not have an associated destroying " +
      "message after its declaration\"). Siren refuses it too, with an " +
      "error at the `destroy` line saying the next message must be sent by " +
      "or to B. Refused documents cost an author nothing Mermaid gave them.",
  },
  {
    id: "seq-destroying-message-sent",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>B: hi
      destroy B
      B-->>A: bye`,
    status: "supported",
    meaning:
      "A destroying message may be sent by the destroyed participant as " +
      "well as to it. Measured on 12.2.0: accepted, B's lifeline ends on " +
      "`B-->>A: bye`'s row. Siren's X sits on the arrow's tail, on B's lane.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-B: hi", "B-A: bye"]);
      expectSame("B ends on the destroying message's tail", lifelineEnd(result, "B"), "tail of B-A, lifeline stops there");
    },
  },
  {
    id: "seq-destroy-two-at-end",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      participant C
      A->>B: hi
      A->>C: hi
      destroy B
      destroy C`,
    status: "supported",
    warnings: [
      'The destroyed participant "B" has no destroying message, so the destroy draws nothing: its lifeline runs to the bottom. A message sent by or to it right after the destroy ends it there.',
      'The destroyed participant "C" has no destroying message, so the destroy draws nothing: its lifeline runs to the bottom. A message sent by or to it right after the destroy ends it there.',
    ],
    meaning:
      "Two `destroy` lines with no message after either: neither has a " +
      "destroying message to pair with, the second one first or not. " +
      "Measured on 12.2.0: accepted, and drawn exactly as a lone `destroy` " +
      "at the end is — B and C as if never destroyed, boxes in the top and " +
      "bottom rows, no row for either `destroy`. A note or a block's `end` " +
      "after a lone `destroy` draws the same. Siren draws B and C exactly " +
      "as it draws A, with no X (nook 01M4YWYFJ), and warns at each " +
      "`destroy`. A message after the two would refuse the first, which " +
      "Mermaid would not draw (nook 01M4YS7DV8).",
    assert: (result) => {
      expectSame("no destroy mark was drawn", drew(result, "path.siren-destroy-mark"), false);
      expectSame("B is drawn as A is", participantRows(result, "B"), participantRows(result, "A"));
      expectSame("C is drawn as A is", participantRows(result, "C"), participantRows(result, "A"));
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
    id: "seq-acc-descr",
    kind: "sequence",
    source: `sequenceDiagram
      accDescr: how a browser asks for orders
      A->>B: Hello`,
    status: "supported",
    meaning:
      "`accDescr:` gives the diagram its screen-reader-only description, a " +
      "`<desc>` on the `<svg>` that the root names with aria-describedby — " +
      "Mermaid 12.2.0 writes both in the `render()` code every kind shares, " +
      "the same as `er-acc-descr`. Nothing is drawn on the canvas.",
    assert: (result) => {
      const svg = svgOf(result);
      const desc = svg.querySelector(":scope > desc");
      if (desc === null) throw new Error("no <desc> was drawn");
      expectSame("the accessible description text", desc.textContent, "how a browser asks for orders");
      expectSame("the root svg is described by that desc", svg.getAttribute("aria-describedby"), desc.getAttribute("id"));
      expectSame("no accessible title was invented", svg.querySelector(":scope > title"), null);
    },
  },
  {
    id: "seq-acc-descr-multiline",
    kind: "sequence",
    source: `sequenceDiagram
      accDescr {
        how a browser
        asks for orders
      }
      A->>B: Hello`,
    status: "supported",
    meaning:
      "`accDescr`'s braced spelling. Measured on 12.2.0: the description is " +
      "the block's lines with each one's leading whitespace dropped, " +
      "\"how a browser\\nasks for orders\". Its own row because it is its own " +
      "statement in Mermaid's grammar (`acc_descr_multiline_value`).",
    assert: (result) => {
      expectSame(
        "the accessible description text",
        svgOf(result).querySelector(":scope > desc")?.textContent,
        "how a browser\nasks for orders",
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
  {
    id: "seq-link-mention",
    kind: "sequence",
    source: `sequenceDiagram
      link C: Docs @ https://example.com
      A->>B: hi
      link B: Home @ https://example.org`,
    status: "supported",
    meaning:
      "A `link` names its participant the way a message does. Measured on " +
      "12.2.0: `link C` creates lane C where it is written — first here, so " +
      "the lanes are C, A, B — and `link B` reaches B, which only the " +
      "message created.",
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["C", "A", "B"]);
      // Each participant box is drawn at the top and again at the bottom, as
      // Mermaid draws it, so each link appears twice; one of each is enough.
      const hrefs = new Set(
        Array.from(svgOf(result).querySelectorAll("a.siren-link")).map(
          (a) => `${a.querySelector("g.siren-participant")?.getAttribute("data-siren-id")} ${a.getAttribute("href")}`,
        ),
      );
      expectSame("both participants link out", [...hrefs], ["C https://example.com", "B https://example.org"]);
    },
  },
  {
    id: "seq-links-menu",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      A->>B: hi
      links A: {"Home": "https://x.com", "Docs": "https://d.com"}
      link A: Home @ https://z.com
      link A: Wiki @ https://w.com`,
    status: "supported",
    meaning:
      "`links A: {json}` gives A one link per entry, and `link A:` lines add " +
      "to the same set. Measured on 12.2.0: A.links = {Home: z, Docs: d, " +
      "Wiki: w} — document order, a later Home replacing the earlier one's " +
      "url in its place. Mermaid shows them as a menu when A is clicked, by " +
      "JavaScript; Siren draws the same links, in the same order, as a menu " +
      "of real links under A's box, shown on hover or focus by CSS alone " +
      "(decision on 01M3NM3BZ). A's box itself links nowhere.",
    assert: (result) => {
      const svg = svgOf(result);
      const menus = Array.from(svg.querySelectorAll("g.siren-link-menu"));
      // A is drawn at the top and again at the bottom, as Mermaid draws it,
      // and each box carries the menu.
      expectSame("a menu on each of A's boxes", menus.length, 2);
      for (const menu of menus) {
        expectSame(
          "the links, merged in document order",
          Array.from(menu.querySelectorAll("a")).map((a) => `${a.textContent} ${a.getAttribute("href")}`),
          ["Home https://z.com", "Docs https://d.com", "Wiki https://w.com"],
        );
      }
      expectSame(
        "A's box is not itself a link",
        svg.querySelector('g.siren-participant[data-siren-id="A"]')?.closest("a") ?? null,
        null,
      );
    },
  },
  {
    id: "seq-link-repeated",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      link A: Home @ https://x.com
      link A: Docs @ https://d.com`,
    status: "supported",
    meaning:
      "Two `link` lines on one participant give it two links (12.2.0: " +
      "A.links = {Home, Docs}). Siren used to keep only the last one; both " +
      "now reach its menu.",
    assert: (result) => {
      const menu = svgOf(result).querySelector("g.siren-link-menu");
      expectSame(
        "both links, in order",
        Array.from(menu?.querySelectorAll("a") ?? []).map((a) => a.getAttribute("href")),
        ["https://x.com", "https://d.com"],
      );
    },
  },
  {
    id: "seq-links-mention",
    kind: "sequence",
    source: `sequenceDiagram
      links C: {"Docs": "https://example.com"}
      A->>B: hi
      links B: {"Home": "https://example.org"}`,
    status: "supported",
    meaning:
      "`links` names its participant the way `link` does. Measured on " +
      "12.2.0: `links C` before the message creates lane C first (C, A, B), " +
      "and `links B` reaches B, which only the message created. One link " +
      "is no menu: the box itself is the link, as with `link`.",
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["C", "A", "B"]);
      const hrefs = new Set(
        Array.from(svgOf(result).querySelectorAll("a.siren-link")).map(
          (a) => `${a.querySelector("g.siren-participant")?.getAttribute("data-siren-id")} ${a.getAttribute("href")}`,
        ),
      );
      expectSame("each box links out", [...hrefs], ["C https://example.com", "B https://example.org"]);
    },
  },
  {
    id: "seq-links-not-json",
    kind: "sequence",
    source: `sequenceDiagram
      links C: not-json
      A->>B: hi`,
    status: "supported",
    meaning:
      "Mermaid 12.2.0 ignores a `links` whose text is not a JSON object " +
      "without a word (C.links stays {}), but still creates lane C where it " +
      "is written. Siren draws the same lanes and says why C has no links.",
    warnings: ["links C: the text after the colon is not JSON; no link is added"],
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["C", "A", "B"]);
      expectSame("no link", svgOf(result).querySelector("a"), null);
    },
  },
  {
    id: "seq-links-non-object",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      links A: ["https://x.com", "https://y.com"]`,
    status: "supported",
    meaning:
      "Mermaid 12.2.0 reads `links` with `JSON.parse` and walks the result " +
      "with `for...in`, so JSON that is not an object still gives links " +
      "(measured: an array gives A.links = {\"0\": x, \"1\": y}, the string " +
      "\"ab\" gives {\"0\": \"a\", \"1\": \"b\"}, and 5 or null gives {}), and " +
      "it draws them as a menu labelled 0, 1. Siren draws the same menu. An " +
      "entry whose value is not a string is recorded as written ({\"H\": 5}); " +
      "Mermaid then fails to render the diagram (`url.trim is not a " +
      "function`) for 5, true or an object, and links null, false or 0 to " +
      "about:blank. Siren draws such an entry with the value's text as its " +
      "href and a warning.",
    assert: (result) => {
      const menu = svgOf(result).querySelector("g.siren-link-menu");
      expectSame(
        "links labelled by index, in order",
        Array.from(menu?.querySelectorAll("a") ?? []).map((a) => `${a.textContent} ${a.getAttribute("href")}`),
        ["0 https://x.com", "1 https://y.com"],
      );
    },
  },
  {
    id: "seq-implicit-participants",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: hi
      B-->>A: ok`,
    status: "supported",
    meaning:
      "A participant nothing declares is created where it is first named — " +
      "measured against Mermaid 11.17.2: two participant lanes, A then B, " +
      "and both messages. The most common way sequence diagrams are written.",
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["A", "B"]);
      expectSame("messages", messages(result), ["A-B: hi", "B-A: ok"]);
    },
  },
  {
    id: "seq-implicit-mixed-order",
    kind: "sequence",
    source: `sequenceDiagram
      participant P
      loop again
        Q->>R: x
      end
      alt yes
        S->>P: y
      else no
        T->>P: z
      end`,
    status: "supported",
    meaning:
      "Lanes follow first mention, declaration or reference alike, block " +
      "bodies included — measured against Mermaid 11.17.2: P, Q, R, S, T.",
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["P", "Q", "R", "S", "T"]);
    },
  },
  {
    id: "seq-declare-after-use",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: x
      actor B as Bee`,
    status: "supported",
    meaning:
      "A declaration after the first mention applies its label and kind to " +
      "the existing lane without moving it — measured against Mermaid " +
      "11.17.2: A, B, with B drawn as the actor Bee.",
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["A", "B"]);
      expectSame("B's label", texts(result, 'g.siren-participant[data-siren-id="B"] text')[0], "Bee");
      expectSame("B is an actor", drew(result, 'g.siren-participant[data-siren-id="B"] circle'), true);
    },
  },
  {
    id: "seq-case-note",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      Note LEFT OF A: left
      NOTE Right Of A: right
      note Over A,B: both`,
    status: "supported",
    meaning:
      "`note` and its position words are read in any case (measured: `Note`, " +
      "`NOTE`, `note LEFT OF`, `note Right of`, `note Over`), and the note is " +
      "drawn on the side the words name — `LEFT OF` on the left.",
    assert: (result) => {
      expectSame("every note is drawn", texts(result, "text.siren-note-text"), [
        "left",
        "right",
        "both",
      ]);
      const lifeline = elements(result, 'line.siren-lifeline[data-siren-id="A"]')[0];
      const lifelineX = Number(lifeline.getAttribute("x1"));
      const frames = elements(result, "rect.siren-note-frame");
      const left = frames[0];
      const right = frames[1];
      expectSame(
        "LEFT OF ends left of A's lifeline",
        Number(left.getAttribute("x")) + Number(left.getAttribute("width")) <= lifelineX,
        true,
      );
      expectSame("Right Of starts right of A's lifeline", Number(right.getAttribute("x")) >= lifelineX, true);
    },
  },
  {
    id: "seq-case-participant",
    kind: "sequence",
    source: `sequenceDiagram
      Participant A AS Alice
      ACTOR B
      A->>B: Hello`,
    status: "supported",
    meaning:
      "`participant`, `actor` and `as` are read in any case (measured: " +
      "`Participant`, `PARTICIPANT B AS Bee`, `Actor`, `ACTOR`); the id and " +
      "the label keep the case the author wrote.",
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame("A is drawn under its alias", texts(result, 'g.siren-participant[data-siren-id="A"] text'), [
        "Alice",
        "Alice",
      ]);
      expectSame("B is an actor", drew(result, 'g.siren-participant[data-siren-id="B"] circle'), true);
    },
  },
  {
    id: "seq-case-blocks",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      Loop every minute
        A->>B: poll
      End
      ALT fresh
        B-->>A: data
      Else stale
        B-->>A: marker
      END
      Opt warm
        A->>B: hint
      end
      Par one
        A->>B: task
      And two
        B->>A: task
      end
      Critical lock
        A->>B: take
      Option timeout
        B-->>A: busy
      end
      Break fatal
        B--xA: abort
      end
      Rect rgb(240, 248, 255)
        A->>B: shaded
      End`,
    status: "supported",
    meaning:
      "Every block keyword and its terminators are read in any case " +
      "(measured: `Loop … End`, `ALT … Else … END`, `Opt`, `Par`/`And`, " +
      "`Critical`/`Option`, `Break`, `Rect`).",
    assert: (result) => {
      expectSame("blocks", blocks(result), [
        "loop:loop:1",
        "alt:alt:1",
        "opt:opt:1",
        "par:par:1",
        "critical:critical:1",
        "break:break:1",
        "rect:rect:1",
      ]);
    },
  },
  {
    id: "seq-case-lifecycle",
    kind: "sequence",
    source: `sequenceDiagram
      Box Aqua Front
        participant A
      End
      participant B
      AutoNumber
      A->>B: one
      ACTIVATE B
      B-->>A: two
      Deactivate B
      AUTONUMBER OFF
      Create participant C
      A->>C: three
      DESTROY C
      C-->>A: four`,
    status: "supported",
    meaning:
      "`box`, `autonumber` (and `autonumber off`), `activate`, `deactivate`, " +
      "`create` and `destroy` are read in any case (measured: `Box … END`, " +
      "`Autonumber`, `AUTONUMBER`, `Activate`, `DEACTIVATE`, `Create " +
      "participant`, `Destroy`). `C-->>A: four` is C's destroying message, " +
      "so `DESTROY C` draws its X (measured on 12.2.0: C's closing box on " +
      "that arrow); with no message after it, it would draw nothing.",
    assert: (result) => {
      expectSame("the box grouping is drawn", drew(result, 'g.siren-box[data-siren-id="box:1"]'), true);
      expectSame("the two numbered messages", texts(result, "text.siren-autonumber"), ["1", "2"]);
      expectSame("one activation bar", elements(result, "rect.siren-activation-bar").length, 1);
      expectSame("C is created", participants(result), ["A", "B", "C"]);
      expectSame("C is destroyed", drew(result, 'path.siren-destroy-mark[data-siren-id="C"]'), true);
    },
  },
  {
    id: "seq-case-title-link",
    kind: "sequence",
    source: `sequenceDiagram
      TITLE Checkout
      AccTitle: Checkout flow
      participant A
      Link A: Home @ https://example.com`,
    status: "supported",
    meaning:
      "`title`, `accTitle` and `link` are read in any case (measured: `Title`, " +
      "`TITLE`, `AccTitle:`, `Link`, `LINK`).",
    assert: (result) => {
      expectSame("the title is drawn", texts(result, "text.siren-title"), ["Checkout"]);
      expectSame("the accessible title", svgOf(result).querySelector(":scope > title")?.textContent, "Checkout flow");
      expectSame(
        "A links to the url",
        svgOf(result).querySelector("a.siren-link")?.getAttribute("href"),
        "https://example.com",
      );
    },
  },
  {
    id: "seq-title-colon",
    kind: "sequence",
    source: `sequenceDiagram
      title: Checkout: happy path
      participant A`,
    status: "supported",
    meaning:
      "`title: text` is the colon spelling of `title text`; the first colon " +
      "and the whitespace after it are the separator, so a later colon stays " +
      "in the title (measured on 12.2.0: \"Checkout: happy path\"). The space " +
      "is required — Mermaid rejects `title:Checkout`.",
    assert: (result) => {
      expectSame("the title is drawn", texts(result, "text.siren-title"), ["Checkout: happy path"]);
    },
  },
  {
    id: "seq-label-line-height",
    kind: "sequence",
    source: `sequenceDiagram
      participant A as Web<br/>Client
      A->>B: first<br/>second
      Note over A: n one<br/>n two`,
    status: "supported",
    meaning:
      "Sequence text is SVG in Mermaid, not an HTML label, and its rows are " +
      "not 1.5 font sizes apart. mermaid 11.17.2 at 16px (measured): a " +
      "message's, a note's and a block condition's rows are 19px apart; a " +
      "participant's and a box caption's 16px (each row's `dy` 8px either " +
      "side of the centre). At Siren's 14px: 16.625 and 14.",
    assert: (result) => {
      expectSame("participant row gaps", rowGaps(result, 'g.siren-participant[data-siren-id="A"] text'), [14]);
      expectSame("message row gaps", rowGaps(result, "text.siren-message-label"), [16.625]);
      expectSame("note row gaps", rowGaps(result, "text.siren-note-text"), [16.625]);
    },
  },
  {
    id: "seq-one-row-label-spacing",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: a
      A->>B: b
      alt c
        A->>B: d
      else e
        A->>B: f
      end`,
    status: "supported",
    meaning:
      "A one-row message or condition takes no more room than its band: " +
      "consecutive messages are one 40px message row apart, a block's first " +
      "message sits its 20px margin, 30px header band and a message row below " +
      "the message before it, and an `else` branch's first message a 10px gap, " +
      "a 30px divider band and a message row below the last message of the " +
      "branch before. Only a label's rows past the first add height — never " +
      "the measurer's padding around them.",
    assert: (result) => {
      const arrowYs = elements(result, "g.siren-message").map((g) =>
        Number(/,(-?[\d.]+)/.exec(g.querySelector("path")?.getAttribute("d") ?? "")?.[1]),
      );
      const gaps = arrowYs.slice(1).map((y, index) => y - arrowYs[index]!);
      expectSame("gaps between the message arrows", gaps, [40, 20 + 30 + 40, 10 + 30 + 40]);
    },
  },
  {
    id: "seq-participant-label-br",
    kind: "sequence",
    source: `sequenceDiagram
      participant A as Web<br/>Client
      A->>A: hi`,
    status: "supported",
    meaning:
      "`<br>` in a participant's alias is a line break. Sequence text is SVG in " +
      "both of Mermaid's label modes, so ADR-0015 reads it with `<br>` and " +
      "entity codes only. Measured (mermaid 11.17.2, `--paint`): `participant " +
      "A as Web<br/>Client` draws `Web` over `Client`, in the top and the " +
      "bottom row. Siren used to draw `Web<br/>Client` literally. The box is " +
      "sized for both rows.",
    assert: (result) => {
      const group = 'g.siren-participant[data-siren-id="A"]';
      const labels = Array.from(svgOf(result).querySelectorAll(`${group} text`));
      expectSame("both rows of the label", labels.map(labelRows), [
        ["Web", "Client"],
        ["Web", "Client"],
      ]);
      const frame = svgOf(result).querySelector(`${group} rect`);
      const top = Number(frame?.getAttribute("y"));
      const bottom = top + Number(frame?.getAttribute("height"));
      const rowYs = Array.from(
        labels[0]?.querySelectorAll(":scope > tspan.siren-label-row") ?? [],
      ).map((row) => Number(row.getAttribute("y")));
      expectSame(
        `both rows sit inside the box (rows at ${JSON.stringify(rowYs)}, box ${top}..${bottom})`,
        rowYs.length === 2 && rowYs.every((y) => y > top && y < bottom),
        true,
      );
    },
  },
  {
    id: "seq-message-br",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: first<br/>second`,
    status: "supported",
    meaning:
      "`<br>` in a message is a line break. Measured (mermaid 11.17.2, " +
      "`--paint`): `A->>A: x<br/>y` draws `x` over `y`. Siren used to draw " +
      "`first<br/>second` literally. The rows stand on the arrow, and the " +
      "message sits a row further down to make room for them.",
    assert: (result) => {
      const group = 'g.siren-message[data-siren-id="A-B"]';
      const label = svgOf(result).querySelector(`${group} text.siren-message-label`);
      expectSame("the message's rows", labelRows(label), ["first", "second"]);
      const arrowPath = svgOf(result).querySelector(`${group} path`)?.getAttribute("d") ?? "";
      const arrowY = Number(/,(-?[\d.]+)/.exec(arrowPath)?.[1]);
      const rowYs = Array.from(label?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows are above the arrow (rows at ${JSON.stringify(rowYs)}, arrow at ${arrowY})`,
        rowYs.length === 2 && rowYs.every((y) => y < arrowY),
        true,
      );
    },
  },
  {
    id: "seq-message-tags-literal",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: <b>bold</b> msg`,
    status: "supported",
    meaning:
      "Every tag but `<br>` in sequence text is drawn as the characters " +
      "written: Mermaid draws sequence text as SVG in both label modes, so " +
      "there the literal tag *is* the picture (ADR-0015). Measured (mermaid " +
      "11.17.2, `--paint`): `A->>B: <b>bold</b> msg` draws the one `<text>` " +
      "`<b>bold</b> msg`, not bold.",
    assert: (result) => {
      expectSame(
        "the message is drawn as written",
        labelRows(svgOf(result).querySelector("text.siren-message-label")),
        ["<b>bold</b> msg"],
      );
    },
  },
  {
    id: "seq-message-br-after-open-angle",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: x <y <br> z`,
    status: "supported",
    meaning:
      "Only Mermaid's `/<br\\s*\\/?>/gi` breaks sequence text, and every " +
      "other character is drawn as written, a `<` included, so a `<` that " +
      "would begin an HTML tag cannot hide the `<br>` after it. Measured " +
      "(mermaid 11.17.2, `--paint`): `A->>B: x <y <br> z` draws two " +
      "`<text>` rows, `x <y` and `z`.",
    assert: (result) => {
      expectSame(
        "the message breaks at its <br>",
        labelRows(svgOf(result).querySelector("text.siren-message-label")).map((row) => row.trim()),
        ["x <y", "z"],
      );
    },
  },
  {
    id: "seq-message-entity-codes",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: x #quot; #35; #hearts; z`,
    status: "supported",
    meaning:
      "Entity codes resolve in sequence text, as in every other label: " +
      "`#quot;` is `\"`, `#35;` is `#` and `#hearts;` is `♥`. Measured " +
      "(mermaid 11.17.2, `--paint`): the message draws the one `<text>` " +
      "`x \" # ♥ z`.",
    assert: (result) => {
      expectSame(
        "the message's codes are resolved",
        labelRows(svgOf(result).querySelector("text.siren-message-label")),
        ['x " # \u2665 z'],
      );
    },
  },
  {
    id: "seq-message-tag-quotes",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: a<b c="d">e say "hi"`,
    status: "supported",
    meaning:
      "Before any diagram reads its text, Mermaid rewrites each `=\"\u2026\"` " +
      "inside a tag-shaped stretch `<name\u2026>` as `='\u2026'` (its `cleanupText`), " +
      "and a `\"` anywhere else is kept. Sequence text reads no tag, so the " +
      "rewrite is drawn. Measured (mermaid 11.17.2, `--paint`): " +
      "`A->>B: a<b c=\"d\">e say \"hi\"` draws the one `<text>` " +
      "`a<b c='d'>e say \"hi\"`.",
    assert: (result) => {
      expectSame(
        "the tag's quotes are rewritten, the rest kept",
        labelRows(svgOf(result).querySelector("text.siren-message-label")),
        ["a<b c='d'>e say \"hi\""],
      );
    },
  },
  {
    id: "seq-note-br",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      Note over A: a<br/>b`,
    status: "supported",
    meaning:
      "`<br>` in a note is a line break. Measured (mermaid 11.17.2, " +
      "`--paint`): `Note over A: a<br/>b` draws `a` over `b`. Siren used to " +
      "draw `a<br/>b` literally. The note's box is sized for both rows.",
    assert: (result) => {
      const text = svgOf(result).querySelector("g.siren-note text.siren-note-text");
      expectSame("the note's rows", labelRows(text), ["a", "b"]);
      const frame = svgOf(result).querySelector("g.siren-note rect.siren-note-frame");
      const top = Number(frame?.getAttribute("y"));
      const bottom = top + Number(frame?.getAttribute("height"));
      const rowYs = Array.from(text?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit inside the note (rows at ${JSON.stringify(rowYs)}, note ${top}..${bottom})`,
        rowYs.length === 2 && rowYs.every((y) => y > top && y < bottom),
        true,
      );
    },
  },
  {
    id: "seq-block-condition-br",
    kind: "sequence",
    source: `sequenceDiagram
      loop every<br/>day
        A->>B: hi
      end
      alt c1<br/>c2
        A->>B: z
      else e1<br/>e2
        A->>B: w
      end`,
    status: "supported",
    meaning:
      "`<br>` in a block's condition, and in each branch's, is a line break, " +
      "and the brackets Mermaid draws around a condition go around all of " +
      "its rows. Not on the board's table of measured places, so measured " +
      "(mermaid 11.17.2, `--paint`): `loop every<br/>day` draws `[every` over " +
      "`day]`, and `alt c1<br/>c2` / `else e1<br/>e2` draw `[c1` over `c2]` " +
      "and `[e1` over `e2]`. Siren used to draw them literally. The header " +
      "and the divider are made a row taller, so no message is drawn over a " +
      "condition.",
    assert: (result) => {
      const conditionsOf = (id: string) =>
        Array.from(
          svgOf(result).querySelectorAll(
            `g.siren-block[data-siren-id="${id}"] > text.siren-block-label`,
          ),
        );
      const rowsIn = (id: string) => conditionsOf(id).map(labelRows);
      expectSame("the loop's condition", rowsIn("loop:1"), [["[every", "day]"]]);
      expectSame("the alt's conditions", rowsIn("alt:1"), [
        ["[c1", "c2]"],
        ["[e1", "e2]"],
      ]);
      const lastRowY = (id: string, index: number) => {
        const label = conditionsOf(id)[index];
        const rows = Array.from(label?.querySelectorAll(":scope > tspan.siren-label-row") ?? []);
        return Number(rows[rows.length - 1]?.getAttribute("y"));
      };
      const arrowY = (id: string) => {
        const group = `g.siren-message[data-siren-id="${id}"]`;
        const path = svgOf(result).querySelector(`${group} path`)?.getAttribute("d") ?? "";
        return Number(/,(-?[\d.]+)/.exec(path)?.[1]);
      };
      expectSame(
        "each branch's message is below its condition's last row",
        [
          arrowY("A-B") > lastRowY("loop:1", 0),
          arrowY("A-B#2") > lastRowY("alt:1", 0),
          arrowY("A-B#3") > lastRowY("alt:1", 1),
        ],
        [true, true, true],
      );
    },
  },
  {
    id: "seq-box-label-br",
    kind: "sequence",
    source: `sequenceDiagram
      box Aqua Grp<br/>two
        participant A
      end
      A->>A: hi`,
    status: "supported",
    meaning:
      "`<br>` in a box's label is a line break. Not on the board's table of " +
      "measured places, so measured (mermaid 11.17.2, `--paint`): `box " +
      "aqua Grp<br/>two` and `box Grp<br/>two` both draw `Grp` over `two`. " +
      "(The probe writes the color in lower case: under jsdom Mermaid tests a " +
      "box color by how `Option().style` serializes it, so `Aqua` reads as " +
      "part of the label there, as it does not in a browser.) Siren used to " +
      "draw `Grp<br/>two` literally. The caption band above the participants " +
      "holds both rows.",
    assert: (result) => {
      const label = svgOf(result).querySelector("g.siren-box text.siren-box-label");
      expectSame("the label's rows", labelRows(label), ["Grp", "two"]);
      const rows = Array.from(label?.querySelectorAll(":scope > tspan.siren-label-row") ?? []);
      const lastRowY = Number(rows[rows.length - 1]?.getAttribute("y"));
      const participantTop = Number(
        svgOf(result).querySelector('g.siren-participant[data-siren-id="A"] rect')?.getAttribute("y"),
      );
      expectSame(
        `the label's last row is above A (at ${lastRowY}, A's top at ${participantTop})`,
        lastRowY < participantTop,
        true,
      );
    },
  },
  {
    id: "seq-message-tag-quotes-across-lines",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: a<b c="d"
      B->>A: e`,
    status: "supported",
    meaning:
      "Before any diagram reads a line, Mermaid rewrites each `=\"\u2026\"` " +
      "inside a tag-shaped stretch `/<(\\w+)([^>]*)>/` as `='\u2026'` (its " +
      "`cleanupText`, over the whole document). The stretch is the " +
      "document's, not one label's: `[^>]*` crosses a line break, so " +
      "`a<b c=\"d\"`, whose own line has no `>`, is ended by the next line's " +
      "`->>`. Measured (mermaid 11.17.2): the first message is stored " +
      "`a<b c='d'`. Siren used to apply the rewrite to one label at a time, " +
      "and drew `a<b c=\"d\"`.",
    assert: (result) => {
      expectSame(
        "the messages",
        elements(result, "text.siren-message-label").map((text) => text.textContent),
        ["a<b c='d'", "e"],
      );
    },
  },
  {
    id: "seq-comment-mid-line-text",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: 50%% done
      note over B: a %% b`,
    status: "supported",
    meaning:
      "A `%%` in a message's or a note's text is text, not a comment: " +
      "Mermaid 12.2.0's `cleanupComments` removes whole-line comments only, " +
      "and the sequence lexer's text rule reads on past a `%%`, so it " +
      "records the message `50%% done` and the note `a %% b` (measured). " +
      "Siren used to cut the line at the first `%%` and drew `50` and `a`.",
    assert: (result) => {
      expectSame("messages", messages(result), ["A-B: 50%% done"]);
      expectSame("the note", texts(result, "g.siren-note text"), ["a %% b"]);
    },
  },
  {
    id: "seq-comment-in-participant-name",
    kind: "sequence",
    source: `sequenceDiagram
      participant A %% the caller
      A->>B: hi`,
    status: "supported",
    meaning:
      "Once `participant` has started a name, Mermaid 12.2.0's lexer reads " +
      "it to the line's end, `%%` included: this declares a participant " +
      "named `A %% the caller`, and the `A` of `A->>B` is another one — " +
      "three lanes, measured. Siren used to cut the line at the `%%` and " +
      "drew two.",
    assert: (result) => {
      expectSame("lanes", laneOrder(result), ["A %% the caller", "A", "B"]);
      expectSame("messages", messages(result), ["A-B: hi"]);
    },
  },
  {
    id: "seq-comment-after-deactivate",
    kind: "sequence",
    source: `sequenceDiagram
      A->>B: hi
      activate B
      B->>A: there
      deactivate B %% done with B`,
    status: "rejected",
    meaning:
      "⚠️ **Not valid Mermaid, and here for that reason.** Mermaid 12.2.0 " +
      "reads `deactivate B %% done with B` as deactivating a participant " +
      "named `B %% done with B`, which has no activation, and refuses the " +
      "document (\"Trying to inactivate an inactive participant\", " +
      "measured). Siren refuses it too (ADR-0017), with an error at the `%%` " +
      "saying a mid-line `%%` is not a comment and, if it is one, to move it " +
      "to a line of its own. Siren used to cut the line at the `%%` and draw " +
      "the deactivation. A comment on its own line renders in both.",
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
    id: "st-acc",
    kind: "state",
    source: `stateDiagram-v2
      accTitle: Orders
      accDescr: how orders move
      Idle --> Busy`,
    status: "supported",
    meaning:
      "`accTitle:` and `accDescr:` give a state diagram its accessible title " +
      "and description, a `<title>` and a `<desc>` on the root that " +
      "aria-labelledby/aria-describedby name, drawn nowhere on the canvas — " +
      "Mermaid 12.2.0 writes both for this kind as for every other (any " +
      "case, space allowed before the colon, the braced block too). Siren " +
      "read both lines as descriptions and drew states called `accTitle` " +
      "and `accDescr`, with no diagnostic (01M4WVVN9).",
    assert: (result) => {
      const svg = svgOf(result);
      const title = svg.querySelector(":scope > title");
      const desc = svg.querySelector(":scope > desc");
      expectSame("the accessible title", title?.textContent, "Orders");
      expectSame("the accessible description", desc?.textContent, "how orders move");
      expectSame("labelled by it", svg.getAttribute("aria-labelledby"), title?.getAttribute("id"));
      expectSame("described by it", svg.getAttribute("aria-describedby"), desc?.getAttribute("id"));
      expectSame("no state is drawn for either line", states(result), ["Idle", "Busy"]);
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
    id: "st-bare-ids-one-line",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Busy
      direction sideways
      Foo Bar --> Done`,
    status: "supported",
    meaning:
      "Several statements on one line: a bare id ends its statement at the " +
      "whitespace after it, and the rest of the line is the next one. " +
      "Measured on 12.2.0: `direction sideways` declares two states called " +
      "`direction` and `sideways` (`direction` is not reserved, so this is " +
      "not a direction statement), and `Foo Bar --> Done` declares Foo and " +
      "the transition Bar → Done. General, not a few words': `Foo Bar`, " +
      "`A B C`, `hide X`, `fork X` and `end X` all read the same way. A " +
      "reserved word is never split off.",
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Busy", "direction", "sideways", "Foo", "Bar", "Done"]);
      expectSame("transitions", transitions(result), ["Idle-Busy: ", "Bar-Done: "]);
    },
  },
  {
    id: "st-state-keyword-description",
    kind: "state",
    source: `stateDiagram-v2
      state : hi
      Lonely`,
    status: "supported",
    meaning:
      "`state : text` declares **nothing**, as `state` alone does. Measured " +
      "(mermaid 12.2.0): no state enters the table and nothing is an error, " +
      "while every other reserved word as a description's subject — `note " +
      ": hi`, `style : hi`, `href : hi` and the rest — is a parse error, " +
      "which Siren now refuses by name too. Siren used to declare a state " +
      "called `state` here (01M2ZQQQ6).",
    assert: (result) => {
      expectSame("states", states(result), ["Lonely"]);
      expectSame(
        "no box is drawn for the keyword",
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
      // wears the transition's own id, in the label group drawn after every
      // line (ADR-0016).
      expectSame(
        "the label is drawn in the transition's label group",
        texts(result, 'g.siren-transition-labels[data-siren-id="Idle-Running"] text'),
        ["start the job"],
      );
      // And centred on that line, as Mermaid draws an edge label (`labelpos: "c"`).
      expectOnTheLine(
        "the label",
        result,
        'g.siren-transition-labels[data-siren-id="Idle-Running"] text.siren-transition-label',
        'g.siren-transition[data-siren-id="Idle-Running"] path.siren-transition-line',
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

      // Joined to the box, outside it, inside the picture, and orthogonal:
      // Mermaid 12.2.0 routes the loop with ELK, as runs off one side of the
      // box and back.
      const box = stateRect(result, "Running");
      const loop = transitionPath(result, "Running-Running");
      expectSame("every run of the loop is horizontal or vertical", slantedRuns(loop), []);
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
        loop.filter((point) => !holds(pictureBox(result), point, ON_OUTLINE)),
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
    id: "st-lone-pseudo-start",
    kind: "state",
    source: `stateDiagram-v2
      [*]
      [*] --> Idle`,
    status: "supported",
    meaning:
      "`[*]` on a line of its own is the level's start pseudo-state. Measured " +
      "on 12.2.0 (`--markup`): the start disc is drawn, and the transition " +
      "after it leaves from that same disc rather than a second one — one " +
      "start per level, as two `[*] -->` lines share one. Inside a composite " +
      "it is that composite's start. Siren refused the line (01M4WSRMX).",
    assert: (result) => {
      expectSame("one start disc and the state", stateFigures(result), ["start:1: disc", "Idle: box"]);
      expectSame("transitions", transitions(result), ["start:1-Idle: "]);
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
    id: "st-description-br",
    kind: "state",
    source: `stateDiagram-v2
      s1 : a<br/>b
      s1 --> s2`,
    status: "supported",
    meaning:
      "`<br>` in a description is a line break: a description is one of the " +
      "positions ADR-0015 reads with the whole tag vocabulary. Measured " +
      "(mermaid 11.17.2): with `htmlLabels: true` the label reads `ab`, two " +
      "rows, and with `--markup` the SVG mode draws two `title-row` tspans. " +
      "Siren used to draw `a<br/>b` literally. The box is sized for both " +
      "rows, and one description — however many rows — draws no divider.",
    assert: (result) => {
      const label = svgOf(result).querySelector(
        'g.siren-state[data-siren-id="s1"] text.siren-state-label',
      );
      expectSame("the description's rows", labelRows(label), ["a", "b"]);
      const box = stateRect(result, "s1");
      const rowYs = Array.from(label?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit inside the box (rows at ${JSON.stringify(rowYs)}, box ${JSON.stringify(box)})`,
        rowYs.length === 2 && rowYs.every((y) => y > box.top && y < box.bottom),
        true,
      );
      expectSame("one description draws no divider", stateRowGeometry(result, "s1").dividerY, null);
    },
  },
  {
    id: "st-description-br-accumulates",
    kind: "state",
    source: `stateDiagram-v2
      s1 : a<br/>b
      s1 : c<br>d`,
    status: "supported",
    meaning:
      "Each description is a label of its own, so each may break its own " +
      "rows. Measured with `--markup` (mermaid 11.17.2): two label groups " +
      "of two `title-row` tspans each, with `line.divider` **between the " +
      "groups** — under every row of the first description, not under its " +
      "first row.",
    assert: (result) => {
      const group = 'g.siren-state[data-siren-id="s1"]';
      const title = svgOf(result).querySelector(`${group} text.siren-state-label`);
      const description = svgOf(result).querySelector(`${group} text.siren-state-description`);
      expectSame("the title's rows", labelRows(title), ["a", "b"]);
      expectSame("the description's rows", labelRows(description), ["c", "d"]);
      const rowYs = [title, description].flatMap((text) =>
        Array.from(text?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map((row) =>
          Number(row.getAttribute("y")),
        ),
      );
      const { dividerY } = stateRowGeometry(result, "s1");
      expectSame(
        `the divider sits between b and c (rows at ${JSON.stringify(rowYs)}, divider at ${dividerY})`,
        dividerY !== null && dividerY > rowYs[1] && dividerY < rowYs[2],
        true,
      );
    },
  },
  {
    id: "st-transition-label-br",
    kind: "state",
    source: `stateDiagram-v2
      s1 --> s2 : a<br/>b`,
    status: "supported",
    meaning:
      "`<br>` in a transition label is a line break, as it is on a " +
      "flowchart edge. Measured (mermaid 11.17.2, `htmlLabels: true`): " +
      "`s1 --> s2 : t<br/>u` draws `t` over `u`. Siren used to draw " +
      "`a<br/>b` literally. Drawn centred on the space layout kept clear for " +
      "it, which is now the label box's centre rather than its baseline.",
    assert: (result) => {
      expectSame(
        "the label's rows",
        labelRows(
          svgOf(result).querySelector(
            'g.siren-transition-labels[data-siren-id="s1-s2"] text.siren-transition-label',
          ),
        ),
        ["a", "b"],
      );
    },
  },
  {
    id: "st-label-line-height",
    kind: "state",
    source: `stateDiagram-v2
      s1 : a<br/>b
      s1 --> s2 : t<br/>u`,
    status: "supported",
    meaning:
      "A state's description and a transition label are rows one line apart, " +
      "a line being 1.5 times the font size: mermaid 11.17.2 draws both on " +
      "24px lines at 16px (measured: a two-row description is a 48px `<div>` " +
      "in a 64px state, a one-row one 24px in 40px). Siren's description is " +
      "14px, 21px apart; its transition label is 12px, 18px apart.",
    assert: (result) => {
      expectSame("description row gaps", rowGaps(result, 'g.siren-state[data-siren-id="s1"] text'), [21]);
      expectSame(
        "transition label row gaps",
        rowGaps(result, 'g.siren-transition-labels[data-siren-id="s1-s2"] text.siren-transition-label'),
        [18],
      );
    },
  },
  {
    id: "st-composite-title-br",
    kind: "state",
    source: `stateDiagram-v2
      state "a<br/>b" as Outer {
        First
      }`,
    status: "supported",
    meaning:
      "`<br>` in a composite's quoted title is a line break. The board had " +
      "inferred this position rather than measured it, so it was measured " +
      "(mermaid 11.17.2, `--paint`, `htmlLabels: true`): " +
      "`state \"c<br/>d\" as X {` titles its cluster `cd`, two rows, and " +
      "`<b>`/`<i>` are honored there as in a description. The title strip " +
      "holds both rows, so the member is drawn below them.",
    assert: (result) => {
      const title = svgOf(result).querySelector(
        'g.siren-state[data-siren-id="Outer"] text.siren-composite-label',
      );
      expectSame("the title's rows", labelRows(title), ["a", "b"]);
      const rows = Array.from(title?.querySelectorAll(":scope > tspan.siren-label-row") ?? []);
      const lastRowY = Number(rows[rows.length - 1]?.getAttribute("y"));
      expectSame(
        `the title's last row is above First (at ${lastRowY}, First's top at ${stateRect(result, "First").top})`,
        lastRowY < stateRect(result, "First").top,
        true,
      );
    },
  },
  {
    id: "st-note-br",
    kind: "state",
    source: `stateDiagram-v2
      s1 --> s2
      note right of s1 : a<br/>b`,
    status: "supported",
    meaning:
      "`<br>` in a note is a line break. Like a composite's title, this " +
      "position was inferred by the board and then measured (mermaid " +
      "11.17.2, `--paint`, `htmlLabels: true`): `note right of s1 : n<br/>m` " +
      "reads `nm`, two rows, and `note left of s2 : p<i>q</i>r` reads `pqr` — " +
      "the full dialect. The note's box is sized for both rows.",
    assert: (result) => {
      const text = svgOf(result).querySelector(
        'g.siren-state[data-siren-id="s1"] text.siren-note-text',
      );
      expectSame("the note's rows", labelRows(text), ["a", "b"]);
      const box = stateNoteRect(result, "s1");
      const rowYs = Array.from(text?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit inside the note (rows at ${JSON.stringify(rowYs)}, note ${JSON.stringify(box)})`,
        rowYs.length === 2 && rowYs.every((y) => y > box.top && y < box.bottom),
        true,
      );
    },
  },
  {
    id: "st-description-wrap",
    kind: "state",
    source: `stateDiagram-v2
      S : The quick brown fox jumps over the lazy dog and keeps running far away
      [*] --> S`,
    status: "supported",
    meaning:
      "A state's description wider than Mermaid's wrapping width wraps: " +
      "mermaid 11.17.2 draws this one as `The quick brown fox jumps ` / " +
      "`over the lazy dog and ` / `keeps running far away` in a 200px " +
      "`<div>`, a 216 × 88 state (measured); a quoted name " +
      "(`state \"…\" as S`) wraps the same. Siren draws it at 14px, so it " +
      "wraps at 175px of text, the same number of characters to a row, and " +
      "the state is that width plus the label's padding and the state's.",
    assert: (result) => {
      // The default measurer is 8px a character, so 21 characters fit in
      // 175px and 22 do not; its 16px of padding sits outside the text.
      expectSame(
        "description rows",
        labelRows(svgOf(result).querySelector('g.siren-state[data-siren-id="S"] text.siren-state-label')),
        ["The quick brown fox", "jumps over the lazy", "dog and keeps running", "far away"],
      );
      const box = stateRect(result, "S");
      // 175px of text, 16px of measurer padding, 14px of state padding each side.
      expectSame("state width", box.right - box.left, 175 + 16 + 14 * 2);
    },
  },
  {
    id: "st-transition-label-wrap",
    kind: "state",
    source: `stateDiagram-v2
      A --> B : The quick brown fox jumps over the lazy dog and keeps running far away`,
    status: "supported",
    meaning:
      "A transition label wider than Mermaid's wrapping width wraps: mermaid " +
      "11.17.2 draws this one in three rows in a 200px `<div>` (measured), " +
      "as a flowchart edge label. Siren draws a transition label at 12px, so " +
      "it wraps at 150px of text, the same number of characters to a row.",
    assert: (result) => {
      // At 12px the default measurer is 12/14 of its 8px a character, so 21
      // characters fit in 150px and 22 do not.
      expectSame(
        "transition label rows",
        labelRows(
          svgOf(result).querySelector(
            'g.siren-transition-labels[data-siren-id="A-B"] text.siren-transition-label',
          ),
        ),
        ["The quick brown fox", "jumps over the lazy", "dog and keeps running", "far away"],
      );
    },
  },
  {
    id: "st-note-wrap",
    kind: "state",
    source: `stateDiagram-v2
      A --> B
      note right of A : The quick brown fox jumps over the lazy dog and keeps running far away`,
    status: "supported",
    meaning:
      "A state diagram's note wider than Mermaid's wrapping width wraps: " +
      "mermaid 11.17.2 draws this one, and the same text in a " +
      "`note right of A` … `end note` block, in three rows in a 200px " +
      "`<div>`, a 230 × 102 note (measured). Siren draws a note at 14px, so " +
      "it wraps at 175px of text, and the note is that width plus the " +
      "label's padding and the note's.",
    assert: (result) => {
      expectSame(
        "note rows",
        labelRows(svgOf(result).querySelector('g.siren-state[data-siren-id="A"] text.siren-note-text')),
        ["The quick brown fox", "jumps over the lazy", "dog and keeps running", "far away"],
      );
      const box = stateNoteRect(result, "A");
      // 175px of text, 16px of measurer padding, 10px of note padding each side.
      expectSame("note width", box.right - box.left, 175 + 16 + 10 * 2);
    },
  },
  {
    id: "st-composite-title-no-wrap",
    kind: "state",
    source: `stateDiagram-v2
      state "The quick brown fox jumps over the lazy dog and keeps running far away" as Outer {
        A --> B
      }`,
    status: "supported",
    meaning:
      "A composite's title is never wrapped: mermaid 11.17.2 draws it " +
      "`white-space: nowrap` on one 525px row however long it is (measured), " +
      "as it does a flowchart subgraph's title. Siren keeps it on one row and " +
      "grows the frame to hold it.",
    assert: (result) => {
      const title = "The quick brown fox jumps over the lazy dog and keeps running far away";
      expectSame(
        "title rows",
        labelRows(
          svgOf(result).querySelector('g.siren-state[data-siren-id="Outer"] text.siren-composite-label'),
        ),
        [title],
      );
      const frame = stateRect(result, "Outer");
      expectSame("frame holds the title", frame.right - frame.left >= title.length * 8 + 16, true);
    },
  },
  {
    id: "st-composite-description-no-wrap",
    kind: "state",
    source: `stateDiagram-v2
      Outer : The quick brown fox jumps over the lazy dog and keeps running far away
      state Outer {
        A --> B
      }`,
    status: "supported",
    meaning:
      "A composite's own description is its title, and is not wrapped: " +
      "mermaid 11.17.2 draws `Outer : …` beside `state Outer { … }` (written " +
      "in either order) as the cluster's label, `white-space: nowrap`, one " +
      "525px row (measured) — not as a wrapped description. Mermaid cannot " +
      "give a composite both a quoted title and a description (`Group nodes " +
      "can only have label`), so there is never a description row below a " +
      "title to wrap on its own.",
    assert: (result) => {
      const title = "The quick brown fox jumps over the lazy dog and keeps running far away";
      expectSame(
        "title rows",
        labelRows(
          svgOf(result).querySelector('g.siren-state[data-siren-id="Outer"] text.siren-composite-label'),
        ),
        [title],
      );
      const frame = stateRect(result, "Outer");
      expectSame("frame holds the title", frame.right - frame.left >= title.length * 8 + 16, true);
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
      "the frame's own outline, as orthogonal runs. Measured in headless " +
      "Chrome against Mermaid 12.2.0: ELK routes `C --> C` as a loop off " +
      "the frame's side, and the block keeps its own `direction` — both " +
      "ends share a parent. (On dagre this took a member standing in for " +
      "the frame and a loop synthesised outside it; the shared ELK core " +
      "routes it as it is.) `examples/state-core.srn` ships this construct on the " +
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
      expectSame("every run of the loop is horizontal or vertical", slantedRuns(loop), []);
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
        loop.filter((point) => !holds(pictureBox(result), point, ON_OUTLINE)),
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
      "out sideways — while the composite has no **Boundary-crossing " +
      "edge** (`CONTEXT.md`). `Before --> Outer` names the composite " +
      "itself from outside, which is not one: its two ends share a parent, " +
      "and measured in headless Chrome, Mermaid 12.2.0 keeps `direction LR` " +
      "here (`st-composite-direction-crossed` is the other half).",
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
    id: "st-composite-direction-crossed",
    kind: "state",
    source: `stateDiagram-v2
      state Outer {
        direction LR
        First --> Second
      }
      Second --> After`,
    status: "supported",
    meaning:
      "`st-composite-direction` with one transition leaving the " +
      "composite. Its `direction` applies only while it has no " +
      "**Boundary-crossing edge** (`CONTEXT.md`). Mermaid 12.2.0's rule, " +
      "on ELK: a transition whose two ends have different parents puts " +
      "every composite on the way up to their common ancestor back into " +
      "its parent's layout pass (`configureCrossHierarchyEdges`, " +
      "`elk-V4PLJRSU.mjs`). `Second --> After` leaves `Outer`, so its " +
      "states follow the document's `TB`.",
    assert: (result) => {
      const centre = (id: string) => stateRectCenter(result, id);
      // The document's `TB` inside the block: `Second` below `First`, not
      // beside it as `direction LR` would put it.
      expectSame(
        `Second is drawn below First (${JSON.stringify([centre("First"), centre("Second")])})`,
        centre("Second").y > centre("First").y,
        true,
      );
      expectSame("After is drawn below Second", centre("After").y > centre("Second").y, true);
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
  // A row leaves by *starting to work*, and five have:
  // `st-direction-document`, `st-composite-quoted-description`,
  // `st-author-style`, `st-note` and `st-stereotype-choice` are `supported`
  // now, each with an assert reading the rendered SVG. The one still marked
  // `rejected` below is what is left of the six.
  {
    id: "st-stereotype-choice",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Idle
      state Choice <<choice>>
      state Split <<fork>>
      state Merge <<join>>
      Idle --> Choice
      Choice --> Split
      Split --> Merge
      Merge --> Busy`,
    status: "supported",
    meaning:
      "`<<choice>>`, `<<fork>>` and `<<join>>` mark a state as a pseudo-state " +
      "drawn as a diamond or a bar rather than as a box. Measured: a closed " +
      "set of three, recorded as a `type` field on the state itself " +
      "(`id=\"Choice\" type=\"choice\"`) — the state keeps its authored id and " +
      "its place in the relations, so this is a change of figure, not a " +
      "change of structure. Measured with `--markup` and with a reading of " +
      "each drawn path's own extent, on this very document: `Choice` is a " +
      "diamond spanning `x[-14,14] y[-14,14]` about its centre — 28 × 28 — " +
      "and `Split` and `Merge` come back as **the same path**, " +
      "`M-35 -5 L35 -5 L35 5 L-35 5`, a 70 × 10 bar, so fork and join are " +
      "one figure with two spellings. **None of the three is drawn with a " +
      "label**: mermaid's `forkJoin` shape sets `node.label = \"\"` and none " +
      "of the three `<g>`s comes back with a label child, where `Idle`'s " +
      "beside them does. The bar turns with the direction of **its own " +
      "level**: 10 × 70 under `direction LR` and 70 × 10 under `TB`, `BT`, " +
      "`RL` and `TD` alike (mermaid tests `dir === \"LR\"` exactly), and a " +
      "composite naming no direction runs `TB` even inside a document that " +
      "says `LR`. Three more things measured and deliberately not built, " +
      "each refused by name rather than half-drawn: a stereotype written " +
      "*below* its state's first mention is inert in mermaid too " +
      "(`addState` guards the field with `if (!state.type)`), which Siren " +
      "copies; `<<end>>`, `<<start>>` and any other word is accepted and " +
      "**ignored** by mermaid, declaring nothing at all; and `[[fork]]` is a " +
      "second spelling of the marker that no row here covers.",
    assert: (result) => {
      // The figures, read off the picture. A row checking only that nothing
      // was rejected would pass on all five states drawn as boxes, which is
      // exactly the silent mis-render this corpus exists to catch.
      expectSame("each state draws the figure mermaid draws", stateFigures(result), [
        "start:1: disc",
        "Idle: box",
        "Choice: diamond",
        "Split: bar",
        "Merge: bar",
        "Busy: box",
      ]);
      // And at the size mermaid draws it: a diamond at a box's size, or a
      // bar as tall as it is wide, is a different picture from mermaid's
      // and one no reader would recognize.
      expectSame("the choice is 28 × 28", stateFigureSize(result, "Choice"), "28×28");
      expectSame("the fork's bar is 70 × 10", stateFigureSize(result, "Split"), "70×10");
      expectSame("the join's is the same bar", stateFigureSize(result, "Merge"), "70×10");
      // A diamond and not merely a quadrilateral of the right extent: the
      // four corners sit at the midpoints of its box's edges.
      expectSame("the choice's corners make a diamond", polygonCorners(result, "Choice"), [
        "top",
        "right",
        "bottom",
        "left",
      ]);
      // No label on any of the three, and the ordinary states beside them
      // still carry theirs — so "draws nothing" is this figure's rule and
      // not a label that went missing everywhere.
      for (const id of ["Choice", "Split", "Merge"]) {
        expectSame(`${id} draws no text`, stateTexts(result, id), []);
      }
      expectSame("Idle still draws its own", stateTexts(result, "Idle"), ["Idle"]);
      // **It kept its place in the relations.** The whole claim of the
      // construct: the state carries the author's own id and a transition
      // reaches it at either end, so the three sit in the chain rather than
      // beside it.
      expectSame("every transition still joins the states it names", transitions(result), [
        "start:1-Idle: ",
        "Idle-Choice: ",
        "Choice-Split: ",
        "Split-Merge: ",
        "Merge-Busy: ",
      ]);
    },
  },
  {
    id: "st-note-pseudo-start",
    kind: "state",
    source: `stateDiagram-v2
      [*] --> Idle
      Idle --> [*]
      note right of [*] : begins here`,
    status: "supported",
    meaning:
      "A note on `[*]` hangs on the level's **start** pseudo-state, whichever " +
      "`[*]` the author meant. Measured on 12.2.0: the note lands on " +
      "`root_start` (on `C_start` inside `state C`), never on an end, and is " +
      "drawn as an ordinary note beside the start disc. A level whose only " +
      "`[*]` is an end makes Mermaid invent a start with no shape and fail to " +
      "render, so Siren refuses that document, saying why (01M36DWFN).",
    assert: (result) => {
      expectSame("the note is drawn on the start disc", stateNoteText(result, "start:1"), ["begins here"]);
      expectSame("and not on the end", stateNoteText(result, "end:1"), []);
    },
  },
  {
    id: "st-note-multiline",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Busy
      note right of Idle
        line one

          line two
      end note`,
    status: "supported",
    meaning:
      "The multi-line note, `note … of X` with no colon, running to `end " +
      "note`. Measured on 12.2.0: the text reaches the state with its source " +
      "indentation (`\"line one\\n      line two\"`), but the drawn note is one " +
      "row per non-blank line with no leading space — `line one`, `line two` " +
      "— so the rows are what Siren reads (01M36DWFN).",
    assert: (result) => {
      expectSame(
        "one row per line, no indent, no blank row",
        labelRows(svgOf(result).querySelector('g.siren-state[data-siren-id="Idle"] text.siren-note-text')),
        ["line one", "line two"],
      );
    },
  },
  {
    id: "st-note-position-case",
    kind: "state",
    source: `stateDiagram-v2
      direction LR
      Idle --> Busy
      note LEFT OF Busy : shouty`,
    status: "supported",
    meaning:
      "A note's side in any case — **the first corpus row of CONTEXT.md's " +
      "third rule** (decided on 01M36DWFN, 2026-09-23). Mermaid 12.2.0 " +
      "accepts `note LEFT OF Busy`, records the position verbatim as " +
      "`\"LEFT OF\"`, and then picks the side with an exact `=== \"left of\"`, " +
      "so it draws the note on the **right**, exactly where `right of` would " +
      "put it — the opposite of what the line says, with no diagnostic. " +
      "Mermaid's *record* is right and only its drawing is wrong, so this is " +
      "still a measurement of meaning against picture: the document names " +
      "the left, and Siren draws the left. The row asserts Siren's picture.",
    assert: (result) => {
      const note = stateNoteRect(result, "Busy");
      const box = stateRect(result, "Busy");
      expectSame(
        `the note is drawn left of Busy (${JSON.stringify([note, box])})`,
        note.right <= box.left,
        true,
      );
    },
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
        interiorsMeet(stateRect(result, "Idle"), stateNoteRect(result, "Idle")),
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
    status: "supported",
    meaning:
      "`--` inside a composite splits it into concurrent regions. Measured: " +
      "Mermaid synthesises a `divider`-typed state **per region** and " +
      "re-parents that region's members under it " +
      "(`in=\"root/Active/divider-id-1\"`), so `n` dividers make `n + 1` " +
      "levels and everything above the first `--` is already in one. An " +
      "empty region is a region (`--` twice in a row reports three dividers " +
      "with the middle one holding nothing), `--` is one lexer token so " +
      "`----` is two dividers, and an odd run of dashes (`-`, `---`) is a " +
      "lexical error rather than a longer divider. A `--` at the document's " +
      "own level is a parse error, and Siren refuses it by name. " +
      "**Their ids carry a random component** — the second divider came " +
      "back as `id-g8d8ncxe8va-1`, a different string on every run — so " +
      "Siren mints its own through `generatedId` (`region:1`, ADR-0010) and " +
      "copies none of Mermaid's; the same document renders to the same ids " +
      "every time here, which is the one thing Mermaid cannot do. Measured " +
      "again by rendering: mermaid draws each region as a `rect.divider` " +
      "inside a cluster with no label in it at all, dashed by its own " +
      "stylesheet (`stroke-dasharray: 10,10`), and lays the regions **side " +
      "by side** under `TB` — the two region groups came back " +
      "`translate(35, 37.5)` and `translate(125, 37.5)`, one y and two x — " +
      "while each region's own members stack in a column. On ELK, Mermaid " +
      "12.2.0 gives the block and each region a direction of their own, " +
      "`TB` unless one is written, so a region's members stack in a column " +
      "under a document-level `LR` too, and the regions — unconnected " +
      "clusters in the block's own pass — are packed by ELK side by side " +
      "or one above the other by their size (measured: its 136-wide state " +
      "boxes stack them). Siren gets that arrangement from the same engine " +
      "rather than by arranging it. A `direction` statement belongs to " +
      "the **region** it sits in rather than to the block (implemented, " +
      "`StateRegion.direction`). One measured gap left open, not covered " +
      "by a row: a transition **crossing** two regions is " +
      "legal in both, but mermaid flattens the block when it sees one " +
      "(every node came back in a single column, the region frames drawn " +
      "empty around nothing) where Siren keeps each state in the region " +
      "that first named it and routes the transition between the two " +
      "frames.",
    assert: (result) => {
      // The structure: a frame holding two region frames, each holding its
      // own pair — read as figures so a region drawn as the block it
      // divides, or not drawn at all, names itself on the spot.
      expectSame("states and their figures", stateFigures(result), [
        "start:1: disc",
        "Active: frame",
        "region:1: region",
        "region:2: region",
        "Reading: box",
        "Parsing: box",
        "Logging: box",
        "Flushed: box",
      ]);

      // Membership, as geometry rather than as parentage: each region holds
      // its own two states and neither of the other's.
      expectSame(
        "the block encloses both regions",
        [
          encloses(stateRect(result, "Active"), stateRect(result, "region:1")),
          encloses(stateRect(result, "Active"), stateRect(result, "region:2")),
        ],
        [true, true],
      );
      expectSame(
        "the first region holds its own pair and nothing else",
        [
          encloses(stateRect(result, "region:1"), stateRect(result, "Reading")),
          encloses(stateRect(result, "region:1"), stateRect(result, "Parsing")),
          encloses(stateRect(result, "region:1"), stateRect(result, "Logging")),
          encloses(stateRect(result, "region:1"), stateRect(result, "Flushed")),
        ],
        [true, true, false, false],
      );
      expectSame(
        "the second region holds its own pair and nothing else",
        [
          encloses(stateRect(result, "region:2"), stateRect(result, "Logging")),
          encloses(stateRect(result, "region:2"), stateRect(result, "Flushed")),
          encloses(stateRect(result, "region:2"), stateRect(result, "Reading")),
          encloses(stateRect(result, "region:2"), stateRect(result, "Parsing")),
        ],
        [true, true, false, false],
      );

      // Side by side, which is what "concurrent" looks like under `TB`:
      // ELK packs the two unconnected regions by their size, and boxes this
      // narrow pack side by side (Mermaid 12.2.0's 136-wide boxes stack).
      const [one, two] = [stateRect(result, "region:1"), stateRect(result, "region:2")];
      expectSame(
        "the two regions are drawn side by side, not stacked",
        one.right <= two.left || two.right <= one.left,
        true,
      );

      // No text on either: a region's id is generated, so drawing it would
      // put a string the author never wrote on the picture — and mermaid's
      // own divider group holds no label element at all.
      expectSame("a region draws no text", stateTexts(result, "region:1"), []);
      expectSame("neither does the second", stateTexts(result, "region:2"), []);
    },
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
    id: "st-style-statement",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Busy
      Busy --> Done
      state Group {
        Inner
      }
      style Busy fill:#f00
      style Idle,Done stroke:#00f
      style Group fill:#ff0`,
    status: "supported",
    meaning:
      "`style X decls` writes declarations straight onto a state, with no " +
      "`classDef` between. Measured (mermaid 12.2.0, `--markup`): Busy's " +
      "rect carries `fill:#f00 !important`, and a comma list in the target " +
      "position styles each state named. Added straight as `supported` — no " +
      "`rejected` row ever recorded it, so the `REJECTED` ratchet does not " +
      "move. With a space after the comma Mermaid paints `B decls` onto A " +
      "instead; Siren styles both, by CONTEXT.md's third rule (`STYLE_RE` " +
      "in `parseStateDiagram.ts`). On a composite, Mermaid paints nothing — " +
      "the frame's `rect.outer` carries no style — although `class Group u` " +
      "does reach it (the class lands on the composite's `<g>`, and " +
      "`.u rect` paints the frame). The line names the composite, so Siren " +
      "paints its frame for `style` as it does for `class`: the third rule " +
      "again, Mermaid's picture contradicting the document.",
    assert: (result) => {
      expectSame("Busy's own rect carries the fill", stateStyle(result, "Busy"), "fill:#f00");
      expectSame("a composite's frame is styled too", stateStyle(result, "Group"), "fill:#ff0");
      expectSame("each state in the comma list is styled", stateStyle(result, "Idle"), "stroke:#00f");
      expectSame("the last one too", stateStyle(result, "Done"), "stroke:#00f");
    },
  },
  {
    id: "st-class-name-tail",
    kind: "state",
    source: `stateDiagram-v2
      classDef u fill:#00f
      Idle --> Busy
      class Busy a,b
      class Idle`,
    status: "supported",
    meaning:
      "An apply-directive's class name is the whole rest of the line. " +
      "Measured on 12.2.0: `class Busy a,b` gives Busy `classes=[\"a,b\"]` " +
      "(drawn as `class=\"node a,b …\"`, one CSS class), and `class Idle` " +
      "gives `[\"\"]` — both draw, and neither paints anything, since no " +
      "classDef carries those names. Siren draws the same unstyled picture " +
      "and says why in two warnings; it used to refuse the document.",
    warnings: [
      'class applies "a,b", which no classDef defines; dropping the declaration.',
      'class names no class to apply; nothing is applied, in "class Idle"',
    ],
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Busy"]);
      expectSame("Busy is unstyled", stateStyle(result, "Busy"), "");
      expectSame("Idle is unstyled", stateStyle(result, "Idle"), "");
    },
  },
  {
    id: "st-style-beats-class",
    kind: "state",
    source: `stateDiagram-v2
      classDef alpha fill:#f00,stroke:#00f
      Idle --> Busy
      style Busy fill:#0ff
      class Busy alpha`,
    status: "supported",
    meaning:
      "A `style` beats an applied class **whichever is written first**. " +
      "Measured on 12.2.0 (state): with `style` above the `class` line the " +
      "target still paints the `style`'s `fill`, keeping the class's " +
      "`stroke` — `fill:#0ff !important;stroke:#00f !important`. Siren used " +
      "to let the later line win, drawing the class's `fill` with no " +
      "diagnostic (01M39F9N1; ADR-0008's 2026-10-14 amendment). The state half could only appear once `style X` was read (01M36C24S).",
    assert: (result) => {
      expectSame("Busy's rect", stateStyle(result, "Busy"), "fill:#0ff;stroke:#00f");
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
  {
    id: "st-label-tag-quotes",
    kind: "state",
    source: `stateDiagram-v2
      state "<span style="color:red">t</span>" as S
      S --> T : <span style="color:blue">u</span>`,
    status: "supported",
    meaning:
      "Before any diagram reads a line, Mermaid rewrites each `=\"\u2026\"` " +
      "inside a tag-shaped stretch `/<(\\w+)([^>]*)>/` as `='\u2026'` (its " +
      "`cleanupText`, over the whole document). So a state's quoted " +
      "description may hold a double-quoted attribute. Measured (mermaid " +
      "11.17.2, `--html`): `<span style=\"color:red\">t</span>` and the " +
      "transition's `<span style=\"color:blue\">u</span>`.",
    assert: (result) => {
      const label = svgOf(result).querySelector('g.siren-state[data-siren-id="S"] text.siren-state-label');
      expectSame("S's runs", labelRuns(label, "style"), ["t[style=fill: red]"]);
      const transition = svgOf(result).querySelector("text.siren-transition-label");
      expectSame("the transition's runs", labelRuns(transition, "style"), ["u[style=fill: blue]"]);
    },
  },
  {
    id: "st-comment-mid-line-text",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Busy : start %% by hand
      Busy : working %% hard`,
    status: "supported",
    meaning:
      "A `%%` in a transition's label or a state's description is text, not " +
      "a comment: Mermaid 12.2.0's `cleanupComments` removes whole-line " +
      "comments only, and the state lexer's text rules read on past a `%%` " +
      "(measured: the label `start %% by hand`, the description " +
      "`working %% hard`). Siren used to cut each line at its first `%%`.",
    assert: (result) => {
      expectSame("transitions", transitions(result), ["Idle-Busy: start %% by hand"]);
      expectSame("Busy's rows", stateRows(result, "Busy"), ["working %% hard"]);
    },
  },
  {
    id: "st-comment-after-token",
    kind: "state",
    source: `stateDiagram-v2 %% the lifecycle
      [*] --> Idle %% where it starts
      state Busy { %% the busy part
        Working
      } %% done
      Idle --> Busy`,
    status: "supported",
    meaning:
      "The state lexer has a `%%` rule of its own, `%%(?!\\{)[^\\n]*`, " +
      "that reads a comment wherever a token ends — after the header, a " +
      "transition, a composite's `{` and `}` — and leaves the line break " +
      "alone, so it holds on any line. Measured on Mermaid 12.2.0: drawn " +
      "exactly as the document without the four comments.",
    assert: (result) => {
      expectSame("transitions", transitions(result), ["start:1-Idle: ", "Idle-Busy: "]);
      expectSame("no comment drawn", texts(result, "text").some((text) => text.includes("%%")), false);
    },
  },
  {
    id: "st-comment-run-into-header",
    kind: "state",
    source: `stateDiagram-v2%% the lifecycle
      Idle --> Busy`,
    status: "rejected",
    meaning:
      "⚠️ **Not valid Mermaid, and here for that reason.** Run straight " +
      "into the header, a `%%` is no comment: Mermaid 12.2.0 refuses the " +
      "document (\"Expecting 'SPACE', 'NL', 'SD', got 'ID'\", measured). " +
      "Siren refuses it too (ADR-0017), with an error at the `%%`. Siren " +
      "used to cut the line at the `%%`. A space before the `%%` makes it a " +
      "comment in both.",
  },
  {
    id: "st-comment-in-class-name",
    kind: "state",
    source: `stateDiagram-v2
      classDef busy fill:#f96
      Idle --> Busy
      class Busy busy %% while working`,
    status: "supported",
    meaning:
      "A `%%` in a `class` statement is part of its class names, not a " +
      "comment: the state lexer reads the statement to the line's end, so " +
      "Mermaid 12.2.0 records the class `busy %% while working` and draws " +
      "Busy with `class=\"node busy %% while working statediagram-state\"` " +
      "(measured, `--markup`) — split on whitespace, `busy` paints Busy " +
      "exactly as `class Busy busy` does, and `%%`, `while` and `working` " +
      "paint nothing, since no classDef names them. Siren reads the names " +
      "the same way, paints `busy`, and warns about the three it cannot " +
      "find. It used to refuse the document.",
    warnings: [
      'class applies "%%", which no classDef defines; dropping the declaration.',
      'class applies "while", which no classDef defines; dropping the declaration.',
      'class applies "working", which no classDef defines; dropping the declaration.',
    ],
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Busy"]);
      expectSame("Busy is painted with busy", stateStyle(result, "Busy"), "fill:#f96");
      expectSame("Idle is unstyled", stateStyle(result, "Idle"), "");
    },
  },
  {
    id: "st-comment-after-note-opener",
    kind: "state",
    source: `stateDiagram-v2
      Idle --> Busy
      note right of Idle %% why it waits
        waiting for work
      end note`,
    status: "supported",
    meaning:
      "A `%%` after a block note's opener is the note's first line of text, " +
      "not a comment: Mermaid 12.2.0 records the note text " +
      "`%% why it waits\\nwaiting for work` (measured), the text rule " +
      "starting where the target ends — as a class body's `{ %% …` keeps " +
      "`%% …` as a member. Siren draws the same two rows. It used to refuse " +
      "the document.",
    assert: (result) => {
      expectSame(
        "the note's rows",
        labelRows(svgOf(result).querySelector('g.siren-state[data-siren-id="Idle"] text.siren-note-text')),
        ["%% why it waits", "waiting for work"],
      );
    },
  },
  // -------------------------------------------------------------------------
  // erDiagram
  // -------------------------------------------------------------------------
  {
    id: "er-entities",
    kind: "er",
    source: `erDiagram
      CUSTOMER
      ORDER
      LINE-ITEM`,
    status: "supported",
    meaning:
      "`erDiagram` opens an entity-relationship diagram, and a bare name on " +
      "a line of its own declares an entity. Measured (mermaid 11.17.2, " +
      "`scripts/mermaid-probe.mjs`): an entity with **no relationship at " +
      "all** enters the entity table and is drawn — three names report " +
      "three entities, `shape=\"erBox\"` each, and no relationships — so a " +
      "relationship is not what declares an entity. `LINE-ITEM` is one " +
      "entity and not two: Mermaid's ER lexer reads a name as " +
      "`([^\\x00-\\x7F]|\\w|-|\\*|\\.)+`, a **different alphabet** from a " +
      "flowchart id's, where a hyphen is still an open gap. There is one " +
      "header spelling and no `-v2` alias: the detector's `/^\\s*erDiagram/` " +
      "fires on `erDiagram-v2` but the lexer's keyword token stops at the " +
      "`\\b`, so that document is this header plus an entity called `-v2`.",
    assert: (result) => {
      expectSame("entities and their drawn names", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
        "LINE-ITEM[LINE-ITEM]",
      ]);
      // Each name inside the box that names it. A row reading only the text
      // would pass on three names drawn in a heap at the origin with three
      // empty boxes elsewhere.
      for (const id of ["CUSTOMER", "ORDER", "LINE-ITEM"]) {
        const box = erEntityRect(result, id);
        const anchor = erLabelAnchor(result, id);
        expectSame(
          `${id}'s name is drawn inside ${id}'s own box`,
          anchor.x > box.left &&
            anchor.x < box.right &&
            anchor.y > box.top &&
            anchor.y < box.bottom,
          true,
        );
      }
      // And three boxes, not one drawn three times: measured with
      // `--markup`, Mermaid places unrelated entities side by side at the
      // same y (`translate(28, 18)` and `translate(208, 18)`), which is what
      // a shared rank produces. Asserting they do not overlap is the part a
      // count of `<rect>`s cannot see.
      expectSame(
        "the three boxes are drawn clear of one another",
        [
          interiorsMeet(erEntityRect(result, "CUSTOMER"), erEntityRect(result, "ORDER")),
          interiorsMeet(erEntityRect(result, "ORDER"), erEntityRect(result, "LINE-ITEM")),
        ],
        [false, false],
      );
    },
  },
  {
    id: "er-relationship",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER |o..|{ LINE-ITEM : contains`,
    status: "supported",
    meaning:
      "A relationship joins two entities, with a cardinality at each end and " +
      "a label after the colon. Measured: the first line reports " +
      "`leftCard=\"ONLY_ONE\" relType=\"IDENTIFYING\" " +
      "rightCard=\"ZERO_OR_MORE\"` and declares both entities along the way. " +
      "The word spelling `CUSTOMER one to zero or more ORDER : places` " +
      "reports the *same* relationship, so the two are one construct, and " +
      "they mix freely (`CUSTOMER one --o{ ORDER : places`). The `: label` " +
      "is **required** — `CUSTOMER ||--|| ORDER` is a parse error in " +
      "Mermaid.\n\n" +
      "⚠️ **Mermaid records the two cardinalities crossed over.** " +
      "`CUSTOMER ||--o{ ORDER : places` comes back `cardA=\"ZERO_OR_MORE\" " +
      "cardB=\"ONLY_ONE\"` — `cardA` is the marker written next to " +
      "`entityB`. Its own renderer undoes the swap (`arrowTypeStart` is read " +
      "out of `cardB`), so Mermaid's *picture* is right and only its field " +
      "names lie; an implementation written from those names draws every " +
      "relationship backwards. Both sources here are asymmetric for that " +
      "reason: `||--||`, `}|--|{` and `|o--o|` are drawn identically either " +
      "way round and would pass a swapped implementation.\n\n" +
      "The figures are Mermaid's own marker definitions, measured: a " +
      "cardinality is two glyphs, the one against the box saying *one* (a " +
      "bar) or *many* (a closed almond of two quadratic curves — **not** " +
      "three prongs, whatever \"crow's foot\" suggests) and the one further " +
      "out saying *mandatory* (a bar) or *optional* (a small circle filled " +
      "with the surface color). `--` is drawn solid and `..` dashed " +
      "(`stroke-dasharray: 8,8`), and the label goes at the middle of the " +
      "line.\n\n" +
      "Not covered by this row, and still refused by name: `u`, Mermaid's " +
      "fifth cardinality (`MD_PARENT`), which it parses and then draws with " +
      "no marker at all on that end.\n\n" +
      "⚠️ **The ids read back below are `CUSTOMER:ORDER` and " +
      "`ORDER:LINE-ITEM` — a colon, where every other kind joins a " +
      "connector's endpoints with `-`.** This row is why the difference is " +
      "not cosmetic: its own second relationship would have been " +
      "`ORDER-LINE-ITEM` under the shared spelling, and that is a legal ER " +
      "entity name, one rename away from this document drawing a box and a " +
      "line under one `data-siren-id`. `er-relationship-id-space` is the " +
      "row that measures the collision itself.",
    assert: (result) => {
      // End by end, with the render's own id scope stripped: which marker
      // is at which end is the whole claim, so a reader of a failure here
      // sees the swap rather than a count that happens to match.
      expectSame("relationships and the marker at each end", erRelationships(result), [
        "CUSTOMER:ORDER: only-one-solid-zero-or-more",
        "ORDER:LINE-ITEM: zero-or-one-dashed-one-or-more",
      ]);

      // And each marker really is the figure Mermaid draws, glyph by glyph,
      // nearest the entity box first. A marker with the same parts in the
      // other order is a different cardinality.
      expectSame("the figure `||` draws", erCardinalityGlyphs(result, "only-one"), [
        "bar",
        "bar",
      ]);
      expectSame("the figure `|o` draws", erCardinalityGlyphs(result, "zero-or-one"), [
        "bar",
        "circle",
      ]);
      expectSame("the figure `|{` draws", erCardinalityGlyphs(result, "one-or-more"), [
        "crows-foot",
        "bar",
      ]);
      expectSame("the figure `o{` draws", erCardinalityGlyphs(result, "zero-or-more"), [
        "crows-foot",
        "circle",
      ]);

      // Three boxes, not two: a relationship declares its entities, so
      // `LINE-ITEM` is drawn although no line of its own names it.
      expectSame("entities and their drawn names", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
        "LINE-ITEM[LINE-ITEM]",
      ]);

      // The label is drawn between the two boxes it joins rather than
      // merely somewhere in the picture — the check that makes this a
      // reading of the drawing and not of the text.
      const places = erRelationshipLabelAnchor(result, "CUSTOMER:ORDER");
      expectSame("the first relationship's drawn label", places.text, "places");
      expectSame(
        "`places` is drawn in the gap between CUSTOMER and ORDER",
        places.y > erEntityRect(result, "CUSTOMER").bottom &&
          places.y < erEntityRect(result, "ORDER").top,
        true,
      );
      // And centred on the relationship's own line, as Mermaid draws an edge
      // label (`labelpos: "c"`).
      expectOnTheLine(
        "`places`",
        result,
        'g.siren-er-relationship-labels[data-siren-id="CUSTOMER:ORDER"] text.siren-er-relationship-label',
        'g.siren-er-relationship[data-siren-id="CUSTOMER:ORDER"] path.siren-er-relationship-line',
      );

      // And the relationship really moved the boxes apart: two entities a
      // relationship joins sit on consecutive ranks, where two unrelated
      // ones share one (measured with `--markup`).
      expectSame(
        "the three boxes are drawn clear of one another",
        [
          interiorsMeet(erEntityRect(result, "CUSTOMER"), erEntityRect(result, "ORDER")),
          interiorsMeet(erEntityRect(result, "ORDER"), erEntityRect(result, "LINE-ITEM")),
        ],
        [false, false],
      );
    },
  },
  {
    id: "er-relationship-id-space",
    kind: "er",
    source: `erDiagram
      LINE-ITEM
      LINE ||--o{ ITEM : x`,
    status: "supported",
    meaning:
      "**Three boxes and a line, all four addressable apart** — the row " +
      "that pins this kind's id space rather than any one construct in it. " +
      "Every element Siren stamps `data-siren-id` on is a `timeline:` " +
      "target (ADR-0009), and `createAnimationController` resolves a target " +
      "with `querySelectorAll`, so two elements wearing one id make an " +
      "entry naming it apply to both.\n\n" +
      "This document is the shortest one where that used to happen. A " +
      "relationship's id was `${from}-${to}`, which for `LINE ||--o{ ITEM` " +
      "is `LINE-ITEM` — and `LINE-ITEM` on the line above is a perfectly " +
      "legal entity name, because this kind's name alphabet is " +
      "`([^\\x00-\\x7F]|\\w|-|\\*|\\.)+` (measured from Mermaid's own lexer) " +
      "and `-` is inside it. The box and the line came out with the same " +
      "id and **no diagnostic at all**.\n\n" +
      "The id is now `${from}:${to}`, so the line is `LINE:ITEM`. Measured, " +
      "a colon cannot be written anywhere an unquoted ER name is read — " +
      "`A:B`, `A:B ||--o{ C : has`, `A ||--o{ C:D : has`, `A { str:ing x }` " +
      "and `A { string x:y }` are each a Mermaid parse error (11.17.2). " +
      "⚠️ That makes the colon **strictly better than the hyphen, not " +
      "impossible to collide**: a *quoted* name takes one, and " +
      "`\"CUSTOMER:ORDER\" ||--|| X : y` parses. What holds the invariant is " +
      "`reportIdCollisions` in `buildErModel`, which compares the ids " +
      "actually minted; this row is what says the ids it compares are all " +
      "different for the document that used to defeat them.\n\n" +
      "⚠️ The other four kinds keep `${from}-${to}` and are right to: their " +
      "authored ids are `\\w+`, which cannot contain a hyphen, so the " +
      "collision this row exists for is unconstructible there. Making all " +
      "five match would change three kinds' public `data-siren-id` surface " +
      "to fix a problem only this one has.",
    assert: (result) => {
      // The whole claim, read off the drawing: every `data-siren-id` the
      // render stamped. Four figures and four ids — under the old spelling
      // this was four figures and **three** ids, which is exactly what no
      // assert was watching for.
      //
      // Sorted, because what matters here is the id *space* and not the
      // order the groups happen to sit in the DOM; a row that pinned the
      // drawing order as well would fail for a reason that has nothing to
      // do with what it is about.
      //
      // A relationship's label group is left out, and on purpose: it is
      // part of the relationship's figure, wearing the line's id so one
      // timeline entry reaches both (ADR-0016) — a sharing that is the
      // design, not the collision this row watches for.
      const ids = elements(result, "[data-siren-id]:not(g.siren-er-relationship-labels)")
        .map(idOf)
        .sort();
      expectSame("every drawn figure's id", ids, [
        "ITEM",
        "LINE",
        "LINE-ITEM",
        "LINE:ITEM",
      ]);
      expectSame("no two of them are the same string", new Set(ids).size, ids.length);
      expectSame(
        "the label wears its relationship's id",
        elements(result, "g.siren-er-relationship-labels").map(idOf),
        ["LINE:ITEM"],
      );

      // And the box that shares the *spelling* is still the box: a reader
      // of the failure above should not have to wonder whether the entity
      // survived at all.
      expectSame("entities and their drawn names", erEntities(result), [
        "LINE-ITEM[LINE-ITEM]",
        "LINE[LINE]",
        "ITEM[ITEM]",
      ]);
    },
  },
  {
    id: "er-attributes",
    kind: "er",
    source: `erDiagram
      CUSTOMER {
        string name
        int age PK "the age"
        string c UK,PK "both"
      }
      ORDER {
        string(99) code
        int[] xs
      }`,
    status: "supported",
    meaning:
      "A brace block after an entity lists its attributes, each of them " +
      "`type name [keys] [comment]`. Measured (mermaid 11.17.2, " +
      "`scripts/mermaid-probe.mjs`): they are recorded *under* an entity " +
      "that still enters the table as `CUSTOMER`, so the block declares the " +
      "entity as surely as a bare name does, and `int age PK \"the age\"` " +
      "comes back `{type:\"int\", name:\"age\", keys:[\"PK\"], " +
      "comment:\"the age\"}`.\n\n" +
      "⚠️ **The comma splits the keys.** `string c UK,PK \"both\"` reports " +
      "`keys: [\"UK\", \"PK\"]` — two of them — because Mermaid's in-block " +
      "lexer takes `\\b(PK|FK|UK)\\b` *before* its word rule and leaves the " +
      "`,` to separate them. This is the **opposite** of the comma one kind " +
      "over: a state diagram's `class Busy alpha,beta` yields a single " +
      "literal name `\"alpha,beta\"` (measured, `01M368GZR`). It is also " +
      "the opposite of the comma two fields to the right, where `\"x, y\"` " +
      "is one comment. Three key kinds and no more: `string c UK,XX " +
      "\"both\"` is a parse error in Mermaid, not an attribute with a key " +
      "called `XX`.\n\n" +
      "The type is a word in a **third** alphabet — " +
      "`[*A-Za-z_\\u00C0-\\uFFFF][A-Za-z0-9\\-_\\[\\]().,\\u00C0-\\uFFFF*]*` " +
      "— so `string(99)` and `int[]` are each one type, and `int 1st` is a " +
      "parse error because a word may not begin with a digit.\n\n" +
      "Drawn as a table: measured with `--markup`, the name takes a row of " +
      "its own with a full-width rule under it, and the four fields are " +
      "left-aligned in columns carrying `attribute-type`, `attribute-name`, " +
      "`attribute-keys` and `attribute-comment`, with the keys re-joined " +
      "(`attribute.keys.join()`) for display. A column **no attribute uses " +
      "is dropped** — Mermaid's `keysPresent`/`commentPresent` zero its " +
      "width and skip the rule beside it — which is why `ORDER` here is two " +
      "columns and one rule where `CUSTOMER` is four and three. That last " +
      "fact is the one `--markup` cannot show: the probe's `getBBox` stub " +
      "reports a constant width for every label, empty ones included, so " +
      "both flags come back true there whatever the document says. It is " +
      "read out of Mermaid's own `erBox` renderer instead.\n\n" +
      "Siren draws no alternating row fill. Mermaid separates its rows by " +
      "shading them rather than by ruling between them (its horizontal-rule " +
      "loop runs over a single offset), and a shade is a *paint* — the " +
      "theme's, by ADR-0008 — where the rules are the figure.",
    assert: (result) => {
      // The comment-present case and the comment-absent one, side by side:
      // `CUSTOMER` writes keys and comments and gets all four columns,
      // `ORDER` writes neither and gets two. A reader of the first alone
      // could not tell a dropped column from a blank one.
      expectSame("CUSTOMER's attribute rows", erAttributeRows(result, "CUSTOMER"), [
        "type=string | name=name | keys= | comment=",
        "type=int | name=age | keys=PK | comment=the age",
        "type=string | name=c | keys=UK,PK | comment=both",
      ]);
      expectSame("ORDER's attribute rows", erAttributeRows(result, "ORDER"), [
        "type=string(99) | name=code",
        "type=int[] | name=xs",
      ]);

      // Four columns need three rules between them and two need one, each
      // under the single full-width rule that closes the name row.
      const customerRules = erEntityDividers(result, "CUSTOMER");
      const orderRules = erEntityDividers(result, "ORDER");
      expectSame(
        "how many rules each table is drawn with",
        [customerRules.length, orderRules.length],
        [4, 2],
      );
      expectSame(
        "one full-width rule apiece, under the name row",
        [
          customerRules.filter((rule) => rule.startsWith("horizontal")).length,
          orderRules.filter((rule) => rule.startsWith("horizontal")).length,
        ],
        [1, 1],
      );

      // And the table is drawn *inside the box that owns it*, with the name
      // above the rule rather than on top of the rows. Both are silent
      // defects: text spilling out of its frame, or a name centred in the
      // whole box, draws with no diagnostic anywhere.
      const box = erEntityRect(result, "CUSTOMER");
      const rule = Number(
        svgOf(result)
          .querySelector(
            'g.siren-er-entity[data-siren-id="CUSTOMER"] line.siren-er-entity-divider',
          )
          ?.getAttribute("y1"),
      );
      expectSame(
        "CUSTOMER's name is drawn above the rule that closes its name row",
        erLabelAnchor(result, "CUSTOMER").y < rule && rule < box.bottom,
        true,
      );
      const cells = Array.from(
        svgOf(result).querySelectorAll(
          'g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-attribute',
        ),
      );
      expectSame(
        "every one of CUSTOMER's cells is drawn inside CUSTOMER's own box",
        cells.filter((cell) => {
          const x = Number(cell.getAttribute("x"));
          const y = Number(cell.getAttribute("y"));
          return !(x > box.left && x < box.right && y > rule && y < box.bottom);
        }).length,
        0,
      );

      // The two boxes are still two boxes: a table that grew past its frame
      // would be invisible to every check above and obvious here.
      expectSame(
        "the two boxes are drawn clear of one another",
        interiorsMeet(erEntityRect(result, "CUSTOMER"), erEntityRect(result, "ORDER")),
        false,
      );
    },
  },
  {
    id: "er-alias",
    kind: "er",
    source: `erDiagram
      CUSTOMER["Customer Account"] {
        string code
      }
      ORDER`,
    status: "supported",
    meaning:
      "A bracketed quoted string after an entity's name is its alias — the " +
      "text drawn in place of the name. Measured: one entity comes back " +
      "`label=\"CUSTOMER\" alias=\"Customer Account\"`, so the alias sits " +
      "*beside* the name rather than replacing it, and the name stays what " +
      "addresses the entity — while `--markup` shows the **box** reading " +
      "\"Customer Account\". So the alias splits `id` from `label`, which is " +
      "what keeps a `timeline:` target (ADR-0009 — a target is an id) " +
      "pointing at the same entity after it is renamed on screen. The alias " +
      "and an attribute block compose: measured, this very document reports " +
      "one entity carrying both. ⚠️ **Not a state diagram's `state \"text\" " +
      "as s`**, which is a *description* recorded beside the id and leaves " +
      "the drawn name alone — two different mechanisms with two different " +
      "pictures.",
    assert: (result) => {
      // The two halves, read off the picture: `data-siren-id` is still the
      // authored name and the name row draws the alias. A row asserting
      // only the text would pass with the id renamed too, which is the
      // defect that breaks every timeline entry naming this entity.
      expectSame(
        "CUSTOMER is addressed by its name and titled with its alias",
        [
          erEntities(result).map((entity) => entity.split("[")[0]),
          texts(result, 'g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-entity-label'),
        ],
        [["CUSTOMER", "ORDER"], ["Customer Account"]],
      );
      // The un-aliased entity beside it is the control: a renderer drawing
      // *every* box from some second field would fail here rather than
      // going unnoticed.
      expectSame(
        "ORDER, which wrote no alias, is still titled with its own name",
        texts(result, 'g.siren-er-entity[data-siren-id="ORDER"] text.siren-er-entity-label'),
        ["ORDER"],
      );
      // And the alias did not cost the entity its table: measured, this
      // document reports the attribute under the aliased entity.
      expectSame(
        "the aliased entity still draws its one attribute row",
        texts(result, 'g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-attribute'),
        ["string", "code"],
      );
      // The name is drawn inside the box it titles, above the rule that
      // closes the name row — the alias is longer than the name, so a box
      // measured against the name it replaced would be too narrow and the
      // text would spill out of its own frame with no diagnostic anywhere.
      const box = erEntityRect(result, "CUSTOMER");
      const anchor = erLabelAnchor(result, "CUSTOMER");
      expectSame(
        "the alias is drawn inside CUSTOMER's own box",
        anchor.x > box.left && anchor.x < box.right && anchor.y > box.top && anchor.y < box.bottom,
        true,
      );
      expectSame(
        "the two boxes are drawn clear of one another",
        interiorsMeet(erEntityRect(result, "CUSTOMER"), erEntityRect(result, "ORDER")),
        false,
      );
    },
  },
  {
    id: "er-alias-br",
    kind: "er",
    source: `erDiagram
      CUSTOMER["Customer<br/>Record"]`,
    status: "supported",
    meaning:
      "`<br>` in an entity's alias is a line break: an alias is one of the " +
      "positions ADR-0015 reads with the whole tag vocabulary. Measured " +
      "(mermaid 11.17.2, `--html`): `CUSTOMER[\"Customer<br/>Record\"]` is " +
      "the node label `<p>Customer<br>Record</p>`. Siren used to draw " +
      "`Customer<br/>Record` literally. The name row is sized for both rows, " +
      "and the entity is still addressed by its name.",
    assert: (result) => {
      const label = svgOf(result).querySelector(
        'g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-entity-label',
      );
      expectSame("the alias's rows", labelRows(label), ["Customer", "Record"]);
      const box = erEntityRect(result, "CUSTOMER");
      const rowYs = Array.from(label?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit inside the box (rows at ${JSON.stringify(rowYs)}, box ${box.top}..${box.bottom})`,
        rowYs.length === 2 && rowYs.every((y) => y > box.top && y < box.bottom),
        true,
      );
    },
  },
  {
    id: "er-relationship-label-br",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : "places<br/>many"`,
    status: "supported",
    meaning:
      "`<br>` in a relationship's quoted `: label` is a line break. Measured " +
      "(mermaid 11.17.2, `--html`): `CUSTOMER ||--o{ ORDER : " +
      "\"places<br/>many\"` is the edge label `<p>places<br>many</p>`. Siren " +
      "used to draw `places<br/>many` literally. The layout holds the two " +
      "ranks far enough apart for both rows.",
    assert: (result) => {
      const label = svgOf(result).querySelector(
        'g.siren-er-relationship-labels[data-siren-id="CUSTOMER:ORDER"] text.siren-er-relationship-label',
      );
      expectSame("the label's rows", labelRows(label), ["places", "many"]);
      expectSame(
        "the two boxes are drawn clear of one another",
        interiorsMeet(erEntityRect(result, "CUSTOMER"), erEntityRect(result, "ORDER")),
        false,
      );
    },
  },
  {
    id: "er-comment-mid-line-text",
    kind: "er",
    source: `erDiagram
      direction LR %% left to right
      CUSTOMER ||--o{ ORDER : "places %% one or more"
      ORDER {
        int total "in cents %% before tax"
        string \`ship %% to\`
      }`,
    status: "supported",
    meaning:
      "A `%%` in a relationship's quoted label, an attribute's quoted " +
      "comment or a backticked attribute name is text, not a comment: " +
      "Mermaid 12.2.0's `cleanupComments` removes whole-line comments only, " +
      "and the ER lexer reads each of these to its closing quote or " +
      "backtick, `%%` included (measured: the label `places %% one or " +
      "more`, the comment `in cents %% before tax`, the name `ship %% to`). " +
      "A line naming `direction LR` is swallowed whole by the lexer's " +
      "direction rule, `%%` and all, so it is drawn left to right. Siren " +
      "used to cut each line at its first `%%`.",
    assert: (result) => {
      const label = svgOf(result).querySelector(
        'g.siren-er-relationship-labels[data-siren-id="CUSTOMER:ORDER"] text.siren-er-relationship-label',
      );
      expectSame("the label", labelRows(label), ["places %% one or more"]);
      expectSame("ORDER's attributes", erAttributeRows(result, "ORDER"), [
        "type=int | name=total | comment=in cents %% before tax",
        "type=string | name=ship %% to | comment=",
      ]);
      expectSame(
        "ORDER right of CUSTOMER",
        erEntityRect(result, "ORDER").left > erEntityRect(result, "CUSTOMER").right,
        true,
      );
    },
  },
  {
    id: "er-comment-after-statement",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : places %% one or more
      ORDER ||--|{ LINE-ITEM : contains`,
    status: "rejected",
    meaning:
      "⚠️ **Not valid Mermaid, and here for that reason.** The ER lexer " +
      "has no `%` rule, so outside a quoted string or a backticked name a " +
      "`%%` is a stray character and Mermaid 12.2.0 refuses the document " +
      "(\"Expecting 'EOF', 'NEWLINE' …, got '%'\", measured). Siren refuses " +
      "it too (ADR-0017), with an error at the `%%` saying a mid-line `%%` " +
      "is not a comment and, if it is one, to move it to a line of its own. " +
      "Siren used to cut the line at the `%%`. A comment on its own line " +
      "renders in both.",
  },
  {
    id: "er-label-line-height",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : "places<br/>many"`,
    status: "supported",
    meaning:
      "A relationship's label is rows one line apart, a line being 1.5 times " +
      "the font size: mermaid 11.17.2 draws its 14px ER edge label on 21px " +
      "lines (measured: `places<br/>many` is a 42px `<div>`). Siren draws it " +
      "at 12px, so 18px apart.",
    assert: (result) => {
      expectSame(
        "relationship label row gaps",
        rowGaps(result, 'g.siren-er-relationship-labels[data-siren-id="CUSTOMER:ORDER"] text.siren-er-relationship-label'),
        [18],
      );
    },
  },
  // Automatic wrapping (the label-wrap ADR, nook `01M4R4WDZ`, and its
  // amendment `01M4R7HBG`), measured on mermaid 11.17.2: a relationship's
  // label wraps at 200px of its 14px text; an entity's name and an
  // attribute's comment do not.
  {
    id: "er-relationship-label-wrap",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : "every customer may place orders through the web store each week"`,
    status: "supported",
    meaning:
      "A relationship label wider than Mermaid's wrapping width wraps: " +
      "mermaid 11.17.2 draws this one, at 14px on 21px lines, as `every " +
      "customer may place ` / `orders through the web store ` / `each week` " +
      "in a 200px `<div>` (measured). Siren draws it at 12px, so it wraps at " +
      "200 × 12/14 ≈ 171.43px of text — Mermaid's 200px scaled by the size " +
      "Siren draws the label at over the 14px Mermaid draws it at (the " +
      "label-wrap ADR, nook `01M4R4WDZ`, as amended by `01M4R7HBG`), so a " +
      "row holds as much as Mermaid's — and the layout holds the two " +
      "entities apart for every row.",
    assert: (result) => {
      // At 12px the default measurer is 12/14 of its 8px a character, so 24
      // characters (164.57px) fit in 171.43px and 26 (178.29px) do not.
      expectSame(
        "relationship label rows",
        labelRows(
          svgOf(result).querySelector(
            'g.siren-er-relationship-labels[data-siren-id="CUSTOMER:ORDER"] text.siren-er-relationship-label',
          ),
        ),
        ["every customer may place", "orders through the web", "store each week"],
      );
      expectSame(
        "the two boxes are drawn clear of one another",
        interiorsMeet(erEntityRect(result, "CUSTOMER"), erEntityRect(result, "ORDER")),
        false,
      );
    },
  },
  {
    id: "er-entity-name-no-wrap",
    kind: "er",
    source: `erDiagram
      P["This is a fairly long English entity label that should exceed two hundred pixels"]`,
    status: "supported",
    meaning:
      "An entity's name is never wrapped, however long: mermaid 11.17.2 " +
      "draws this alias `white-space: nowrap` on one 561px row, in a 611px " +
      "box (measured), and a long unspaced name on one row too. Siren keeps " +
      "it on one row and grows the box to hold it (the label-wrap ADR, nook " +
      "`01M4R4WDZ`).",
    assert: (result) => {
      const name = "This is a fairly long English entity label that should exceed two hundred pixels";
      expectSame(
        "entity name rows",
        labelRows(svgOf(result).querySelector('g.siren-er-entity[data-siren-id="P"] text.siren-er-entity-label')),
        [name],
      );
      const box = erEntityRect(result, "P");
      expectSame("the box holds the name", box.right - box.left >= name.length * 8 + 16, true);
    },
  },
  {
    id: "er-attribute-comment-no-wrap",
    kind: "er",
    source: `erDiagram
      ORDER {
        string id PK "this attribute comment is long enough to go well past two hundred pixels wide"
      }`,
    status: "supported",
    meaning:
      "An attribute's comment is never wrapped, however long: mermaid " +
      "11.17.2 draws this one `white-space: nowrap` on one 566px row " +
      "(measured). The label-wrap ADR (nook `01M4R4WDZ`, as amended by " +
      "`01M4R7HBG`) wraps only an ER relationship's label; Siren keeps the " +
      "comment on one row and grows the table to hold it.",
    assert: (result) => {
      const comment = "this attribute comment is long enough to go well past two hundred pixels wide";
      expectSame(
        "comment rows",
        labelRows(
          svgOf(result).querySelector('g.siren-er-entity[data-siren-id="ORDER"] text.siren-er-attribute-comment'),
        ),
        [comment],
      );
      const box = erEntityRect(result, "ORDER");
      expectSame("the box holds the comment", box.right - box.left >= comment.length * 8, true);
    },
  },
  {
    id: "er-attribute-comment-br",
    kind: "er",
    source: `erDiagram
      CUSTOMER {
        string name "a<br/>b"
      }`,
    status: "supported",
    meaning:
      "`<br>` in an attribute's comment is a line break. Measured (mermaid " +
      "11.17.2, `--html`): `string name \"a<br/>b\"` is the cell label " +
      "`<p>a<br>b</p>`. The type and the name beside it are not labels and " +
      "are drawn as written. Siren used to draw `a<br/>b` literally. The " +
      "attribute's row is as tall as the comment's two rows.",
    assert: (result) => {
      const group = 'g.siren-er-entity[data-siren-id="CUSTOMER"]';
      const comment = svgOf(result).querySelector(`${group} text.siren-er-attribute-comment`);
      expectSame("the comment's rows", labelRows(comment), ["a", "b"]);
      expectSame(
        "the type and name cells, drawn as written",
        texts(result, `${group} text.siren-er-attribute-type, ${group} text.siren-er-attribute-name`),
        ["string", "name"],
      );
      const divider = svgOf(result).querySelector(`${group} line.siren-er-entity-divider`);
      const top = Number(divider?.getAttribute("y1"));
      const bottom = erEntityRect(result, "CUSTOMER").bottom;
      const rowYs = Array.from(
        comment?.querySelectorAll(":scope > tspan.siren-label-row") ?? [],
      ).map((row) => Number(row.getAttribute("y")));
      expectSame(
        `both rows sit in the attribute's row (rows at ${JSON.stringify(rowYs)}, row ${top}..${bottom})`,
        rowYs.length === 2 && rowYs.every((y) => y > top && y < bottom),
        true,
      );
    },
  },
  {
    id: "er-alias-unquoted",
    kind: "er",
    source: `erDiagram
      CUSTOMER[Account]
      ORDER`,
    status: "supported",
    meaning:
      "The **bracketless** spelling of the alias above. Measured (mermaid " +
      "11.17.2, `scripts/mermaid-probe.mjs`): `CUSTOMER[Account]` reports " +
      "`label=\"CUSTOMER\" alias=\"Account\"` — the very two fields " +
      "`CUSTOMER[\"Account\"]` writes — so the quotes are punctuation around " +
      "one construct rather than a second construct, and the picture is the " +
      "one `er-alias` asserts: the box draws the alias, the table stays keyed " +
      "on `CUSTOMER`, and it composes with `:::`, with an attribute block and " +
      "with the statement after it exactly as the quoted spelling does.\n\n" +
      "⚠️ **Its alphabet is not the quoted spelling's, and this row's own " +
      "source used to claim otherwise.** It was written `CUSTOMER[Customer " +
      "Account]`, which mermaid 11.17.2 **refuses**: \"Expecting 'SQE', got " +
      "'UNICODE_TEXT'\". A bracketless alias is a *single* `entityName` token " +
      "— the production is `entityName SQS entityName SQE` — where the " +
      "`subgraph` title one construct over is a *list of words* " +
      "(`subgraphTitle: subgraphTitle word`, which is why `subgraph s1[a   b]` " +
      "answers `\"a b\"`). Two words in an alias is a parse error, and so is " +
      "any word an earlier lexer rule claims: `end`, `class`, `classDef`, " +
      "`subgraph`, `erDiagram`, the cardinality and body words `one`, `many` " +
      "and `to`, a `u` followed by `.`, `-` or `|`, a leading relationship " +
      "body, and a digit-headed word that is not wholly a number — `[0-9]+` " +
      "carries no word boundary, so `A[1abc]`, `A[9-9]` and `A[1.5.7]` all " +
      "refuse while `A[123]` and `A[1.5]` do not. Siren answers every one of " +
      "them with the generic unrecognized-line message, which is what Mermaid " +
      "says about them: the document is malformed, not unimplemented.",
    assert: (result) => {
      // The two halves this construct is *about*, and the ones two agents
      // have already swapped: `data-siren-id` is the authored name and the
      // name row draws the alias. A reader that let the brackets rename the
      // entity would pass a row asserting only the drawn text — and would
      // break every `timeline:` entry naming `CUSTOMER` (ADR-0009: a target
      // is an id).
      expectSame(
        "CUSTOMER is addressed by its name and titled with its bracketless alias",
        [
          erEntities(result).map((entity) => entity.split("[")[0]),
          texts(result, 'g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-entity-label'),
        ],
        [["CUSTOMER", "ORDER"], ["Account"]],
      );
      // The control beside it, as in `er-alias`: an entity that wrote no
      // alias is still titled with its own name, so a renderer drawing every
      // box from some second field fails here rather than passing unnoticed.
      expectSame(
        "ORDER, which wrote no alias, is still titled with its own name",
        texts(result, 'g.siren-er-entity[data-siren-id="ORDER"] text.siren-er-entity-label'),
        ["ORDER"],
      );
    },
  },
  {
    id: "er-direction",
    kind: "er",
    source: `erDiagram
      direction LR
      CUSTOMER ||--o{ ORDER : places`,
    status: "supported",
    meaning:
      "`direction LR` sets the whole diagram's rank direction. Measured: " +
      "this document reports `LR` where one naming no direction reports " +
      "`TB`, so it genuinely governs the layout. Four spellings and **no " +
      "`TD`** — the ER lexer writes `TB`/`BT`/`RL`/`LR` out literally, so " +
      "`direction TD` is measured to be two ordinary entities. ⚠️ **Last " +
      "wins**, measured rather than derived: `setDirection(dir)` is a plain " +
      "assignment, so `direction LR` then `direction RL` reports `RL` — the " +
      "class diagram's rule and the *opposite* of the state diagram's " +
      "first-wins. Read and dropped, a diagram the author asked to run left " +
      "to right and got drawn top to bottom is exactly the silent " +
      "mis-render the other ratchet in `corpus.test.ts` counts: every " +
      "diagnostic empty, a picture drawn, and only the coordinates " +
      "disagreeing — which is why this row's assert compares them.\n\n" +
      "The relationship read back below is `CUSTOMER:ORDER`: this kind " +
      "joins a connector's two endpoint names with a **colon** rather than " +
      "the `-` the other four use, because an ER entity name may contain a " +
      "hyphen and so a `${from}-${to}` id can spell one (see " +
      "`er-relationship-id-space`). Nothing about the direction depends on " +
      "the spelling; the id appears here only because this row reads the " +
      "relationship back by it.",
    assert: (result) => {
      const customer = erEntityRect(result, "CUSTOMER");
      const order = erEntityRect(result, "ORDER");

      // A relationship puts the two entities on consecutive ranks, so the
      // axis they are separated along *is* the direction. Under `LR` the
      // second box is clear to the right of the first.
      expectSame(
        "ORDER is placed to the right of CUSTOMER, not below it",
        customer.right <= order.left,
        true,
      );
      // And they share a band of rows, which `TB` cannot produce — this is
      // the half that fails when a layout pins the direction to its own
      // default, since the ordering check above would still hold for boxes
      // stacked on a diagonal.
      expectSame(
        "the two boxes overlap vertically, as only a left-to-right rank can",
        customer.top < order.bottom && order.top < customer.bottom,
        true,
      );
      // The picture is still the picture: both boxes, their names, and the
      // relationship between them. A "direction" that lost a box would
      // satisfy every geometric claim above vacuously.
      expectSame("both entities are drawn, under their own names", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
      ]);
      expectSame("the relationship is drawn between them", erRelationships(result), [
        "CUSTOMER:ORDER: only-one-solid-zero-or-more",
      ]);
    },
  },
  // ---------------------------------------------------------------------------
  // The thirteen constructs the ER board deliberately left out.
  // ---------------------------------------------------------------------------
  //
  // Every one is valid Mermaid, re-measured against 11.17.2 with
  // `scripts/mermaid-probe.mjs` for this row rather than taken from the
  // ticket that noticed it, and every one is **refused** today: the document
  // costs and no picture is drawn. Most are refused **by name** — some from
  // `parseErDiagram`'s `UNIMPLEMENTED` table, some from a check that no line
  // pattern could make (a cluster and an entity sharing a name, a directive
  // painting a cluster) — and the rest fall to the generic unrecognized-line
  // message. Writing them down is the point: this is the honest backlog,
  // measured rather than remembered.
  //
  // ⚠️ **"Valid Mermaid" is a claim about this row's source, and it has been
  // wrong once.** `er-alias-unquoted` sat here with the source
  // `CUSTOMER[Customer Account]`, which mermaid 11.17.2 **refuses** — so the
  // row recorded a refusal Siren was right to make for a reason that was not
  // true, and the construct it meant to name went unmeasured. Re-measure the
  // source, not only the construct.
  {
    id: "er-name-cardinality-word",
    kind: "er",
    source: `erDiagram
      CUSTOMER one ORDER`,
    status: "rejected",
    meaning:
      "⚠️ **Siren draws three boxes for a document Mermaid refuses to " +
      "parse, and says nothing.** Measured: `erDiagram / CUSTOMER one " +
      "ORDER` is a parse error, `got 'ONLY_ONE'` — `one` is a cardinality " +
      "keyword, and its lexer rule outranks the name rule, so the word can " +
      "never stand where a name belongs. Siren reads the line as this " +
      "kind's statement stream and declares `CUSTOMER`, `one` and `ORDER`.\n\n" +
      "The whole family behaves this way, measured one probe per spelling: " +
      "`to`, `one` and `many` alone are each a parse error and each a box " +
      "here; the multi-word spellings are worse arithmetic — `only one` is " +
      "a parse error and **two** boxes, `zero or one` a parse error and " +
      "**three**. `A to B` draws three boxes. `to ||--o{ B : x` draws a " +
      "whole relationship.\n\n" +
      "⚠️ **This is not `RESERVED_BARE_NAMES`, and that is the point.** " +
      "That set holds `end`, `subgraph`, `class`, `style` and `classDef`, " +
      "each added by the ticket that made its keyword a statement opener. " +
      "A cardinality word was never a statement opener, so nothing ever " +
      "had a reason to reserve it, and no row named it until " +
      "`01M39812J` measured the alias alphabet and walked into the same " +
      "lexer rules from the other side.\n\n" +
      "The exit is implementation, not refusal of the document: these are " +
      "documents Mermaid refuses outright, so Siren refusing them costs an " +
      "author nothing they had. What it costs today is a picture that " +
      "disagrees with Mermaid's with no diagnostic to notice it by. The " +
      "multi-word spellings are the part that is not a one-line fix — they " +
      "have to be caught in the statement stream rather than in a name " +
      "predicate.\n\n" +
      "Control group, both sides agreeing and measured alongside: `0+`, " +
      "`1+` and `many(0)` are refused here too, `1` is an entity in both " +
      "(`ENTITY_ONE`), and `title` is an ordinary name in both.\n\n" +
      "**Refused since `01M3C621W`** (re-measured on 12.2.0): the name " +
      "position now reads its head the way the lexer does — keywords and " +
      "the multi-word cardinalities first, `\\b` and all (`to-do` and " +
      "`style-x` are refused, `only` and `oneX` are names) — so Siren " +
      "refuses the whole family, as Mermaid does, instead of drawing it. " +
      "Moved here from `silently-wrong`, as this row said it would be.",
  },
  {
    id: "er-name-digit-head",
    kind: "er",
    source: `erDiagram
      123abc`,
    status: "supported",
    meaning:
      "⚠️ **Mermaid draws two boxes, Siren draws one, and nothing says " +
      "so.** Measured: `123abc` reports entities `123` and `abc`, because " +
      "the `NUM` rule is `[0-9]+` with **no word boundary** — it takes the " +
      "digits and hands the rest back to the stream, which reads it as a " +
      "second name. `1-2` is the same shape: two entities, `1` and `-2`. " +
      "Siren's name alphabet has no such seam, so each is one box carrying " +
      "the whole string.\n\n" +
      "⚠️ **The same lexer rule reads two ways in two positions, and that " +
      "is why this could not be fixed where it was found.** `01M39812J` " +
      "wrote `readsAsOneEntityName` to give a **bracketless alias** this " +
      "alphabet, where `A[1abc]` really is a parse error (the grammar wants " +
      "`]`). Reusing that predicate in the name position would refuse `1-2` " +
      "— a document Mermaid draws two boxes for. Refusal is the wrong " +
      "answer here; **splitting** is the right one.\n\n" +
      "So the exit is implementation, and it is the same implementation " +
      "`er-name-cardinality-word` wants: a name position that reads the way " +
      "Mermaid's lexer reads, rather than the way a single regular " +
      "expression happens to.\n\n" +
      "**Supported since `01M3C621W`**: the name position splits at the end " +
      "of a leading number as the lexer does (`123abc` → `123`, `abc`; " +
      "`1-2` → `1`, `-2`; `1.5.7` → `1.5`, `.7`, re-measured on 12.2.0), " +
      "while a relationship's right end or label must still be one token.",
    assert: (result) => {
      // Split where Mermaid's NUM rule ends: the digits, then the rest.
      expectSame("two boxes, split at the number", erEntities(result), ["123[123]", "abc[abc]"]);
    },
  },
  {
    id: "er-md-parent-cardinality",
    kind: "er",
    source: `erDiagram
      A u--o{ B : x`,
    status: "rejected",
    meaning:
      "`u` is Mermaid's **fifth** cardinality, `MD_PARENT`. Measured: its " +
      "`Cardinality` enum has five members and this is the last; its lexer " +
      "rule is `u(?=[.\\-|])`, so `u` is a marker only when a relationship " +
      "body follows it immediately — which makes it a **left-hand spelling " +
      "only** (`A ||--u B : x` and `A u--u B : x` are parse errors, \"got " +
      "'UNICODE_TEXT'\"), and leaves an entity called `u`, or `usage`, an " +
      "ordinary name on either end of a relationship and on a line of its " +
      "own. It takes all four bodies (`--`, `..`, `.-`, `-.`) and every " +
      "right-hand cardinality, and the rule is case-insensitive like the " +
      "rest of that lexer, so `A U--o{ B : x` is the same construct.\n\n" +
      "**Re-judged against CONTEXT.md's third rule, and the refusal stands " +
      "— as a decision, not an omission.** What Mermaid draws is an edge " +
      "with a `marker-end` (the right end's own, `er-zeroOrMoreEnd` for " +
      "`o{`) and **no `marker-start` at all**. The question the third rule " +
      "asks is whether that blank is what `MD_PARENT` looks like or a table " +
      "lookup that failed, and Mermaid's source answers it: `arrowTypesMap` " +
      "in `chunks/mermaid.core/chunk-OSK3NFVY.mjs` lists `only_one`, " +
      "`zero_or_one`, `one_or_more` and `zero_or_more` and **no " +
      "`md_parent`**, so `addEdgeMarker` takes its `if (!arrowTypeInfo)` " +
      "branch, logs `Unknown arrow type: md_parent` and returns without " +
      "setting the attribute — the warning fires verbatim when this very " +
      "document is rendered, and the SVG defines only those eight ER " +
      "markers. It is a **lookup miss**: the enum gained a member and the " +
      "marker table did not follow.\n\n" +
      "So the third rule's condition is met — the document names a " +
      "cardinality on that end and the picture shows none — but the rule " +
      "says to draw *what the document says*, and nothing says what figure " +
      "`MD_PARENT` is. The only trace of one left in 11.17.2 is " +
      "`dist/diagrams/er/erMarkers.d.ts`, which still **declares** " +
      "`MD_PARENT_START` and `MD_PARENT_END` for a module no bundle " +
      "contains: the legacy ER renderer had the marker and the unified one " +
      "did not carry it over, and the shape went with it. Siren cannot draw " +
      "a figure that cannot be read anywhere, and copying \"no marker\" " +
      "would encode a logged internal failure as a construct — a left end " +
      "an author could not tell from any other, with no diagnostic. It " +
      "stays refused **by name**. Its exit is a figure: a version of " +
      "Mermaid that draws one, or a specification that says what one looks " +
      "like. Named in the `er-relationship` row as the one piece of that " +
      "construct left out.",
  },
  {
    id: "er-attribute-generic",
    kind: "er",
    source: `erDiagram
      ORDER {
        list~int~ codes
        map~string,list~int~~ index
        x list~int~
      }`,
    status: "supported",
    meaning:
      "A `~`-delimited generic type inside an attribute block. Measured " +
      "(mermaid 11.17.2, `scripts/mermaid-probe.mjs`): the attribute comes " +
      "back `type=\"list~int~\" name=\"codes\"` — the tildes are **kept**, so " +
      "Mermaid draws the type cell verbatim, tildes and all, rather than " +
      "rewriting it into angle brackets the way a class diagram's generic " +
      "is. There is no inner structure anywhere in its record: its lexer " +
      "rule `([^\\s]*)[~].*[~]([^\\s]*)` returns the **whole match** as one " +
      "`ATTRIBUTE_WORD`, the same token the plain word rule returns, so " +
      "`list~int~` is a word that happens to contain tildes and not a type " +
      "with an argument.\n\n" +
      "⚠️ **`.*` is greedy, and both halves of that matter.** " +
      "`map~string,list~int~~ index` comes back entire — a reader that " +
      "stopped at the first closing tilde would report `map~string,list~int~` " +
      "and leave a stray `~` — and `list~int~ x~y~ z`, which this row does " +
      "not draw because the corpus cannot tell one wide cell from two, is " +
      "**one** attribute typed `list~int~ x~y~` (pinned at the parser " +
      "seam instead). A generic also stands in the *name* position: " +
      "measured, `x list~int~` reports `name=\"list~int~\"`, which is the " +
      "third row here.\n\n" +
      "The rule's place in Mermaid's block lexer is read before the word " +
      "rule *and* before the comment rule, and the second is measurable: " +
      "`string x \"a~b~\"` is a parse error there, because the generic rule " +
      "eats the quoted string. `parseErDiagram` keeps that order.",
    assert: (result) => {
      // Two columns, because no attribute here writes a key or a comment —
      // and the text of each cell verbatim, which is the whole claim: a
      // parser that stripped the delimiters would draw `list` and `int`, or
      // `list<int>`, and every other assertion in this row would still hold.
      expectSame("ORDER's attribute rows", erAttributeRows(result, "ORDER"), [
        "type=list~int~ | name=codes",
        "type=map~string,list~int~~ | name=index",
        "type=x | name=list~int~",
      ]);
      // The box is still a box with a name on it: a table drawn for an
      // entity nobody can find is not the picture Mermaid draws.
      expectSame("the entity is drawn under its own name", erEntities(result), ["ORDER[ORDER]"]);
    },
  },
  {
    id: "er-attribute-backtick",
    kind: "er",
    source: `erDiagram
      ORDER {
        string \`odd name\`
        \`odd type\` x
        string \`PK\`
        string \`a:b{}~"c\`
      }`,
    status: "supported",
    meaning:
      "A backtick-quoted word, which is how an attribute gets a character " +
      "its own alphabet refuses. Measured (mermaid 11.17.2, " +
      "`scripts/mermaid-probe.mjs`): `string `odd name`` comes back " +
      "`type=\"string\" name=\"odd name\"` — the backticks are **stripped** " +
      "and the space survives, the exact opposite of the generic above " +
      "whose delimiters are kept. Read out of Mermaid's lexer, that is not " +
      "a convention but a mechanism: the opening backtick enters the " +
      "`block_bq` condition and emits **no token**, the run of " +
      "non-backticks after it emits the word, and the closing backtick pops " +
      "the state and emits none either.\n\n" +
      "⚠️ **What goes in is what the word alphabet " +
      "(`[*A-Za-z_\\u00C0-\\uFFFF][A-Za-z0-9\\-_\\[\\]().,\\u00C0-\\uFFFF*]*`) " +
      "keeps out.** Measured, `` string `a:b{}~\"c` `` reports " +
      "`name=\"a:b{}~\\\"c\"` — a colon, both braces, a tilde and a double " +
      "quote, all ordinary text. The brace is the one worth naming: it does " +
      "**not** close the attribute block from inside the quotes. And " +
      "`` string `PK` `` is a name rather than a key (measured), where a " +
      "bare `string PK` is a parse error, because the key rule never gets " +
      "to look once the condition has switched.\n\n" +
      "Either position takes one: `` `odd type` x `` reports " +
      "`type=\"odd type\"`. The spelling Siren does **not** read is " +
      "Mermaid's multi-line one — `` [^`]+ `` matches a newline, so a " +
      "backticked word may span lines — and that is refused rather than " +
      "half-read; see `parseErDiagram`'s rule table.",
    assert: (result) => {
      // The backticks are gone and everything between them is drawn, which
      // is the whole claim of the row: a parser that left the quotes on
      // would draw ``odd name`` here and pass every other assertion below.
      // The second row is the same claim in the type column, and the third
      // says the key rule did not fire — a key would move `PK` into a
      // `keys` cell of its own and give this table a third column.
      expectSame("ORDER's attribute rows", erAttributeRows(result, "ORDER"), [
        "type=string | name=odd name",
        "type=odd type | name=x",
        "type=string | name=PK",
        'type=string | name=a:b{}~"c',
      ]);
      // Two columns and two rules: the keys column is dropped, so `PK` is
      // genuinely a name and not a key drawn in the wrong place.
      expectSame(
        "the table is two columns wide, so no key was read",
        erEntityDividers(result, "ORDER").length,
        2,
      );
      // And the brace inside the quotes did not close the block: an entity
      // is drawn, under its own name, carrying all four rows above.
      expectSame("the entity is drawn under its own name", erEntities(result), ["ORDER[ORDER]"]);
    },
  },
  {
    id: "er-attribute-backtick-multiline",
    kind: "er",
    source: `erDiagram
      ORDER {
        string \`a
        b\` PK
        int z
      }`,
    status: "supported",
    meaning:
      "**A backticked word may span lines**, the half of " +
      "`er-attribute-backtick` that did not land with it. Measured (mermaid " +
      "12.2.0): the `block_bq` condition's word rule is `` [^`]+ ``, and that " +
      "character class matches a newline like any other character, so the run " +
      "between the two backticks simply continues onto the next line. Mermaid " +
      "records one attribute, `type=\"string\"`, `name=\"a\\n        b\"` — " +
      "the line break **and the source's own indentation** in the name — then " +
      "the key after the closing backtick, and `int z` as a second " +
      "attribute.\n\n" +
      "What it **draws** is the measured answer to the question the record " +
      "left open: `--markup` shows the name cell as two row tspans, `a` and " +
      "`b` — two lines, the indentation gone (a blank line inside the run " +
      "draws no row of its own). Siren keeps the record as Mermaid keeps it " +
      "and draws the cell the same way: one row per line, trimmed, in a row " +
      "of the table tall enough for both.\n\n" +
      "Truly unterminated — a backtick with no partner anywhere after it — is " +
      "a parse error in Mermaid too, and refused here; asserted in " +
      "`parseErDiagram.test.ts`.",
    assert: (result) => {
      // The drawn name cell, line by line: two lines, `a` over `b`. A reader
      // that drew the record verbatim would give one cell `a\n        b`
      // (one line once SVG collapses it), and one that dropped the break
      // would give `ab` or `a b` — each reads differently here.
      expectSame("ORDER's name cells, line by line", erAttributeLines(result, "ORDER", "name"), [
        ["a", "b"],
        ["z"],
      ]);
      // And the rest of the row followed the closing backtick: the key is
      // `string`'s, and `int z` is a second attribute, not part of the name.
      expectSame("ORDER's key cells", erAttributeLines(result, "ORDER", "keys"), [["PK"], [""]]);
      expectSame("ORDER's type cells", erAttributeLines(result, "ORDER", "type"), [["string"], ["int"]]);
    },
  },
  {
    id: "er-block-one-line",
    kind: "er",
    source: `erDiagram
      E { string a } F`,
    status: "supported",
    meaning:
      "An attribute block opened, filled and closed on one line — and then " +
      "a further statement after it, because the two are the same " +
      "measurement. Measured (mermaid 11.17.2, `scripts/mermaid-probe.mjs`): " +
      "`E { string a }` reports one entity carrying one attribute, " +
      "**identical** to the three-line spelling, and `E { string a } F` " +
      "reports that entity and then a bare `F`.\n\n" +
      "⚠️ **So this is not a second construct but the first one read " +
      "properly.** A brace is a *lexer condition switch*, not a line " +
      "ending: `{` enters the block condition, `}` runs `popState()` and " +
      "hands the rest of the line back to the statement stream " +
      "`er-statements-one-line` already records, and the block condition " +
      "has a newline rule of its own so a line break means nothing inside " +
      "it either. Measured, the mode changes mid-line in both directions — " +
      "`A B { string a }` puts the attribute on `B`, " +
      "`E { string a } A ||--o{ B : x` is a filled block then a " +
      "relationship, and a block may open mid-line and close two lines " +
      "later. Siren used to require the opening brace to end its line and " +
      "the closing one to stand alone; it now tracks the mode across the " +
      "line, which is what `readLine` does.\n\n" +
      "The one-line spellings this row cannot show are pinned at the parser " +
      "seam instead, since the picture cannot tell them apart: `E {}` is an " +
      "entity with no attributes rather than a refusal, and `E {string a}` " +
      "with no spaces is the same document.",
    assert: (result) => {
      // Both boxes, which is the claim the row turns on: `F` is only drawn
      // if the closing brace really returned the reader to the statement
      // stream instead of ending the line.
      expectSame("both entities are drawn, under their own names", erEntities(result), [
        "E[E]",
        "F[F]",
      ]);
      // The attribute landed on `E` and nowhere else — a reader that lost
      // the mode could plausibly hang it on `F`, and both boxes would still
      // be here.
      expectSame("E's attribute rows", erAttributeRows(result, "E"), ["type=string | name=a"]);
      expectSame("F has no attribute table at all", erAttributeRows(result, "F"), []);
    },
  },
  {
    id: "er-subgraph",
    kind: "er",
    source: `erDiagram
      subgraph sales
        direction LR
        CUSTOMER ||--o{ ORDER : places
      end
      WAREHOUSE`,
    status: "supported",
    meaning:
      "ER genuinely has clusters. Measured: `getSubGraphs()` answers with " +
      "one entry — `{id:\"sales\", title:\"sales\", nodes:[\"CUSTOMER\",\"ORDER\"], " +
      "dir:\"LR\", classes:[], cssStyles:[]}` — while `getEntities()` reports " +
      "all three entities flat, so membership lives on the **cluster** and " +
      "not on the entity. The `dir` is the cluster's own rank direction, " +
      "independent of the document's — `getDirection()` stays `TB` for this " +
      "very source — which is the half a flowchart subgraph already needed " +
      "`layoutDirectedGraph` to place. A whole construct rather than a " +
      "spelling.\n\n" +
      "Rendered by mermaid with `--markup` it is a `g.cluster` holding a " +
      "`<rect>` and a `g.cluster-label`: the same two elements a flowchart " +
      "subgraph draws, which is why Siren draws the same figure here under " +
      "this kind's own `siren-er-subgraph` classes. Both endpoints of a " +
      "relationship written inside the block are members of it (measured — " +
      "`nodes:[\"CUSTOMER\",\"ORDER\"]` for exactly these two lines), and " +
      "`WAREHOUSE` outside it belongs to no block.",
    assert: (result) => {
      // All three boxes are drawn, flat, exactly as `getEntities()` reports
      // them — a cluster groups entities, it does not consume them.
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
        "WAREHOUSE[WAREHOUSE]",
      ]);
      expectSame("the relationship drawn", erRelationships(result), [
        "CUSTOMER:ORDER: only-one-solid-zero-or-more",
      ]);

      // The frame, read off the picture by the title the author wrote.
      const frame = erSubgraphBox(result, "sales");
      expectSame("the frame holds CUSTOMER", encloses(frame, erEntityRect(result, "CUSTOMER")), true);
      expectSame("the frame holds ORDER", encloses(frame, erEntityRect(result, "ORDER")), true);
      // And nothing else: `WAREHOUSE` is outside every block, so a frame
      // reaching it would be membership invented out of nothing.
      expectSame(
        "the frame does not hold WAREHOUSE",
        encloses(frame, erEntityRect(result, "WAREHOUSE")),
        false,
      );

      // ⚠️ **The block's own `direction LR`, read as geometry and not as a
      // field.** The document is `TB`, and a relationship puts its two
      // entities on consecutive ranks — so `LR` is what puts `ORDER` to the
      // right of `CUSTOMER` rather than below it. A cluster that silently
      // took the document's direction would draw every figure asserted
      // above and report nothing; this one line is what tells the two
      // pictures apart.
      const customer = erEntityRect(result, "CUSTOMER");
      const order = erEntityRect(result, "ORDER");
      expectSame("ORDER is beside CUSTOMER, not below it", customer.right <= order.left, true);
    },
  },
  {
    id: "er-subgraph-direction-crossed",
    kind: "er",
    source: `erDiagram
      subgraph sales
        direction LR
        CUSTOMER ||--o{ ORDER : places
      end
      ORDER ||--|{ LINE-ITEM : contains`,
    status: "supported",
    meaning:
      "`er-subgraph` with one relationship leaving the block. Its " +
      "`direction` applies only while it has no **Boundary-crossing " +
      "edge** (`CONTEXT.md`). Mermaid's rule, under its default ELK layout: " +
      "Mermaid 12.2.0's `configureCrossHierarchyEdges` puts a cluster an " +
      "edge leaves back into its parent's layout pass, and with it into its " +
      "parent's direction — the rule the shared layout core holds for every " +
      "kind (`voidedDirections`). `ORDER ||--|{ LINE-ITEM` leaves `sales`, so " +
      "its members follow the document's `TB`.",
    assert: (result) => {
      const frame = erSubgraphBox(result, "sales");
      expectSame("the frame holds CUSTOMER", encloses(frame, erEntityRect(result, "CUSTOMER")), true);
      expectSame("the frame holds ORDER", encloses(frame, erEntityRect(result, "ORDER")), true);
      expectSame(
        "the frame does not hold LINE-ITEM",
        encloses(frame, erEntityRect(result, "LINE-ITEM")),
        false,
      );
      // The document's `TB` inside the cluster: `ORDER` below `CUSTOMER`,
      // where `direction LR` would have put it beside.
      expectSame(
        "ORDER is below CUSTOMER, not beside it",
        erEntityRect(result, "CUSTOMER").bottom <= erEntityRect(result, "ORDER").top,
        true,
      );
    },
  },
  {
    id: "er-subgraph-title",
    kind: "er",
    source: `erDiagram
      subgraph s1["Order pipeline"]
        CUSTOMER ||--o{ ORDER : places
      end`,
    status: "supported",
    meaning:
      "The titled spelling of a cluster header. Measured (mermaid 11.17.2), " +
      "`subgraph s1[\"My Title\"]` answers `{id:\"s1\", title:\"My Title\"}` and " +
      "`subgraph s1 [Bracket Title]` answers `title:\"Bracket Title\"` — so " +
      "the brackets carry the drawn text, the quotes inside them are " +
      "optional, and the **id stays the bare name**. `subgraph s1[a   b]` " +
      "answers `\"a b\"`, because Mermaid's `subgraphTitle` is a list of " +
      "words joined with one space.\n\n" +
      "⚠️ **Two boundaries this row exists to hold.** A bare `subgraph` " +
      "with no name at all is a *parse error* here (\"Expecting " +
      "'UNICODE_TEXT', 'NUM', 'ENTITY_NAME', 'DECIMAL_NUM', 'ENTITY_ONE', " +
      "got 'NEWLINE'\"), unlike a flowchart's, which mints `subGraph0`; and " +
      "the header owns its line — `subgraph s1 A end` and `subgraph s1;` " +
      "are both parse errors, because the grammar is `SUBGRAPH entityName " +
      "separator` and the separator has to be a newline.",
    assert: (result) => {
      // The drawn title is the author's, and the id it is addressed by is
      // not — which is the whole of what the brackets change.
      const frame = erSubgraphBox(result, "Order pipeline");
      expectSame(
        "the frame holds both entities",
        encloses(frame, erEntityRect(result, "CUSTOMER")) &&
          encloses(frame, erEntityRect(result, "ORDER")),
        true,
      );
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
      ]);
    },
  },
  {
    id: "er-subgraph-label-br",
    kind: "er",
    source: `erDiagram
      subgraph s1["Order<br/>pipeline"]
        CUSTOMER
      end`,
    status: "supported",
    meaning:
      "`<br>` in a cluster's quoted title is a line break. Measured (mermaid " +
      "11.17.2, `--html`): `subgraph s1[\"My<br/>Title <b>x</b>\"]` is the " +
      "cluster label `<p>My<br>Title <b>x</b></p>` — the whole tag " +
      "vocabulary, read once the title's words are joined with one space. " +
      "Siren used to draw `Order<br/>pipeline` literally. The strip along " +
      "the frame's top holds both rows. (An *unquoted* title holding a tag " +
      "is a parse error in Mermaid and is not this row.)",
    assert: (result) => {
      const group = svgOf(result).querySelector('g.siren-er-subgraph[data-siren-id="subgraph:1"]');
      const title = group?.querySelector("text.siren-er-subgraph-label") ?? null;
      expectSame("the title's rows", labelRows(title), ["Order", "pipeline"]);
      const frame = group?.querySelector("rect.siren-er-subgraph-frame");
      const top = Number(frame?.getAttribute("y"));
      const member = erEntityRect(result, "CUSTOMER");
      const rowYs = Array.from(title?.querySelectorAll(":scope > tspan.siren-label-row") ?? []).map(
        (row) => Number(row.getAttribute("y")),
      );
      expectSame(
        `both rows sit in the strip above the member (rows at ${JSON.stringify(rowYs)}, strip ${top}..${member.top})`,
        rowYs.length === 2 && rowYs.every((y) => y > top && y < member.top),
        true,
      );
    },
  },
  {
    id: "er-subgraph-nested",
    kind: "er",
    source: `erDiagram
      subgraph outer
        direction LR
        subgraph inner
          A ||--|| B : r
        end
        C
      end`,
    status: "supported",
    meaning:
      "A cluster inside a cluster, with the **outer** one carrying the " +
      "`direction` — the shape that drew an entire NaN diagram with zero " +
      "diagnostics before `01M2XJWM4` (whose guard, removed with the dagre " +
      "core, named it by id). Measured, mermaid accepts it: `getSubGraphs()` answers " +
      "`[{id:\"inner\", nodes:[\"A\",\"B\"]}, {id:\"outer\", " +
      "nodes:[\"inner\",\"C\"], dir:\"LR\"}]` — in *closing* order, with the " +
      "inner block listed as a member of the outer one — and `getData()` " +
      "reports `inner` carrying `parentId:\"outer\"`.\n\n" +
      "**A frame that declares no `direction` of its own is laid out in the " +
      "enclosing frame's.** Measured against Mermaid 12.2.0's default (ELK) " +
      "layout in headless Chrome: `A` and `B` are drawn side by side in one " +
      "row inside `inner` — `outer` is laid out in a pass of its own in `LR`, " +
      "and `inner`, saying nothing, is laid out in that pass — the picture " +
      "`fc-subgraph-direction-nested` measured for the flowchart, through the " +
      "same ELK adapter. Mermaid 11.17.2 (dagre) stacked them in the " +
      "document's `TB`, and Siren drew that while ER was on dagre; this row " +
      "followed the measurement when ER moved to ELK.",
    assert: (result) => {
      const outer = erSubgraphBox(result, "outer");
      const inner = erSubgraphBox(result, "inner");
      expectSame("inner holds A", encloses(inner, erEntityRect(result, "A")), true);
      expectSame("inner holds B", encloses(inner, erEntityRect(result, "B")), true);
      expectSame("outer holds inner", encloses(outer, inner), true);
      expectSame("outer holds C", encloses(outer, erEntityRect(result, "C")), true);
      // `inner` declares no direction, so it is laid out in `outer`'s `LR`
      // and `A` and `B` sit side by side — the document's `TB` reaching
      // them, stacking them, is the picture this line tells it from.
      const a = erEntityRect(result, "A");
      const b = erEntityRect(result, "B");
      expectSame("B right of A — inner lays out in outer's LR", a.right <= b.left, true);
    },
  },
  {
    id: "er-subgraph-duplicate-member",
    kind: "er",
    source: `erDiagram
      subgraph outer
        A
        subgraph inner
          A
          B
        end
      end
      A ||--|| B : r`,
    status: "supported",
    meaning:
      "An entity named inside two blocks. Measured: Mermaid's `makeUniq` " +
      "runs inside `addSubGraph`, which fires at the closing `end`, and it " +
      "drops a name some already-closed block has taken — so " +
      "`getSubGraphs()` answers `inner` holding `[\"A\",\"B\"]` and `outer` " +
      "holding only `[\"inner\"]`. **The inner block keeps it, although the " +
      "outer one was opened first**, because the rule is closing order and " +
      "not opening order. Mermaid says so only in a `log.warn`, so nothing " +
      "in the picture reports it and nothing here does either.\n\n" +
      "Resolving membership in the order the keywords were written would " +
      "put `A` in `outer`, draw a perfectly good picture, and report " +
      "nothing — which is why this is a row and not a comment.",
    assert: (result) => {
      const outer = erSubgraphBox(result, "outer");
      const inner = erSubgraphBox(result, "inner");
      const a = erEntityRect(result, "A");
      // `A` is inside `inner`, which is inside `outer` — so being inside
      // `outer` proves nothing on its own, and the inner frame is what the
      // claim rests on.
      expectSame("inner holds A", encloses(inner, a), true);
      expectSame("outer holds inner", encloses(outer, inner), true);
    },
  },
  {
    id: "er-subgraph-entity-name",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A
      end
      s1 ||--o{ B : r`,
    status: "supported",
    meaning:
      "A relationship endpoint naming a `subgraph` cluster joins the cluster's " +
      "**frame**, and no box is drawn for the name.\n\n" +
      "Measured (mermaid 12.2.0): the relationship production calls " +
      "`addEntity` on both endpoints unconditionally and only then asks " +
      "`subGraphLookup.has(...)`, so the document records a phantom entity " +
      "`entity-s1-1` that `getData()` throws away, and hands the edge the " +
      "cluster `s1` as its start (`getData.edges` answers " +
      "`{start:\"s1\", end:\"entity-B-2\"}`). In headless Chrome the " +
      "drawing has two entity boxes (`A`, `B`) and one frame, and the line " +
      "runs from the frame's bottom edge to `B`'s top edge with its markers " +
      "at those two ends. Siren resolves the endpoint to the frame in " +
      "`buildErModel`, and the shared ELK core routes to the frame itself, " +
      "as it does for `fc-subgraph-edge`.",
    assert: (result) => {
      // No third figure: the name belongs to the frame, not to a box.
      expectSame("the entities as drawn", erEntities(result), ["A[A]", "B[B]"]);
      expectSame("the relationship and its markers", erRelationships(result), [
        "s1:B: only-one-solid-zero-or-more",
      ]);
      const frame = erSubgraphBox(result, "s1");
      const route = erRelationshipRoute(result, "s1:B");
      const start = route[0];
      const end = route[route.length - 1];
      // The picture, not the claim: `TB`, so the line leaves the frame
      // through its bottom edge and arrives at the top of `B`'s box, which
      // is where Mermaid 12.2.0 draws it.
      expectSame("the line starts on the frame's boundary", onBoxBoundary(frame, start), true);
      expectSame("on its bottom edge", start.y, frame.bottom);
      expectSame("and ends on B's top edge", end.y, erEntityRect(result, "B").top);
    },
  },
  {
    id: "er-subgraph-endpoint-before-block",
    kind: "er",
    source: `erDiagram
      s1 ||--o{ B : r
      subgraph s1
        A
      end`,
    status: "supported",
    meaning:
      "`er-subgraph-entity-name` with the relationship written **above** the " +
      "block: the line still joins the frame `s1`, and no box is drawn for " +
      "the name.\n\n" +
      "⚠️ **Mermaid 12.2.0 itself fails to render this order** — measured in " +
      "headless Chrome, `render()` throws `JsonImportException: Referenced " +
      "shape does not exist: entity-s1-0`: the relationship recorded the " +
      "phantom entity before the block existed, its edge points at that " +
      "phantom, and `getData()` then drops the phantom because the name has " +
      "become a cluster's. The document is unambiguous — the same statements " +
      "as the other order, which Mermaid draws frame-to-box — so Siren draws " +
      "that picture in both orders (user decision, 2026-10-14; CONTEXT.md's " +
      "rule for where Mermaid's own output contradicts the document).",
    assert: (result) => {
      expectSame("the entities as drawn", erEntities(result), ["B[B]", "A[A]"]);
      expectSame("the relationship and its markers", erRelationships(result), [
        "s1:B: only-one-solid-zero-or-more",
      ]);
      const frame = erSubgraphBox(result, "s1");
      const route = erRelationshipRoute(result, "s1:B");
      expectSame("the line starts on the frame's boundary", onBoxBoundary(frame, route[0]), true);
      expectSame(
        "and ends on B's boundary",
        onBoxBoundary(erEntityRect(result, "B"), route[route.length - 1]),
        true,
      );
    },
  },
  {
    id: "er-subgraph-endpoint-both-clusters",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A
      end
      subgraph s2
        C
      end
      s1 ||--o{ s2 : r`,
    status: "supported",
    meaning:
      "Both ends of one relationship may name a cluster: the line joins the " +
      "two frames, and neither name draws a box.\n\n" +
      "Measured (mermaid 12.2.0, headless Chrome): two entity boxes (`A`, " +
      "`C`), two frames, and the line from `s1`'s bottom edge to `s2`'s top " +
      "edge, a cardinality marker at each — the flowchart's `fc-subgraph-edge` " +
      "picture, in this kind.",
    assert: (result) => {
      expectSame("the entities as drawn", erEntities(result), ["A[A]", "C[C]"]);
      expectSame("the relationship and its markers", erRelationships(result), [
        "s1:s2: only-one-solid-zero-or-more",
      ]);
      const route = erRelationshipRoute(result, "s1:s2");
      const start = route[0];
      const end = route[route.length - 1];
      expectSame("the line leaves the bottom of `s1`'s frame", start.y, erSubgraphBox(result, "s1").bottom);
      expectSame("and arrives at the top of `s2`'s", end.y, erSubgraphBox(result, "s2").top);
      expectSame("on `s1`'s boundary", onBoxBoundary(erSubgraphBox(result, "s1"), start), true);
      expectSame("and on `s2`'s", onBoxBoundary(erSubgraphBox(result, "s2"), end), true);
    },
  },
  {
    id: "er-subgraph-endpoint-self",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A
      end
      s1 ||--o{ s1 : r`,
    status: "supported",
    meaning:
      "A relationship from a cluster to itself is a loop on the **frame**, " +
      "and no box is drawn for the name.\n\n" +
      "Measured (mermaid 12.2.0, headless Chrome): one entity box (`A`), one " +
      "frame, and the line leaving the frame's left edge and coming back to " +
      "it lower down — outside the frame, not through `A`. ELK routes a " +
      "cluster's self-loop itself; there is no special case here.",
    assert: (result) => {
      expectSame("the entities as drawn", erEntities(result), ["A[A]"]);
      expectSame("the relationship and its markers", erRelationships(result), [
        "s1:s1: only-one-solid-zero-or-more",
      ]);
      const frame = erSubgraphBox(result, "s1");
      const route = erRelationshipRoute(result, "s1:s1");
      expectSame("the loop starts on the frame's boundary", onBoxBoundary(frame, route[0]), true);
      expectSame(
        "and comes back to it",
        onBoxBoundary(frame, route[route.length - 1]),
        true,
      );
      expectSame(
        "at a different point",
        route[0].x === route[route.length - 1].x && route[0].y === route[route.length - 1].y,
        false,
      );
      // Around the frame, not buried in it: a loop drawn inside would cross
      // the member it is not about.
      expectSame(
        "and runs outside the frame between them",
        route.every((point) => !insideBox(frame, point)),
        true,
      );
    },
  },
  {
    id: "er-subgraph-endpoint-nested",
    kind: "er",
    source: `erDiagram
      subgraph outer
        subgraph inner
          A
        end
        C
      end
      inner ||--o{ B : r`,
    status: "supported",
    meaning:
      "A cluster nested in another may be a relationship's end: the line " +
      "joins the **inner** frame and crosses the outer one, and no box is " +
      "drawn for the name.\n\n" +
      "Measured (mermaid 12.2.0, headless Chrome): three entity boxes (`A`, " +
      "`C`, `B`), two frames, and the line from `inner`'s bottom edge — not " +
      "`outer`'s — down to `B`'s top edge.",
    assert: (result) => {
      expectSame("the entities as drawn", erEntities(result), ["A[A]", "C[C]", "B[B]"]);
      expectSame("the relationship and its markers", erRelationships(result), [
        "inner:B: only-one-solid-zero-or-more",
      ]);
      const inner = erSubgraphBox(result, "inner");
      const route = erRelationshipRoute(result, "inner:B");
      expectSame("the line starts on the inner frame's boundary", onBoxBoundary(inner, route[0]), true);
      expectSame("on its bottom edge", route[0].y, inner.bottom);
      expectSame(
        "not on the outer frame's",
        onBoxBoundary(erSubgraphBox(result, "outer"), route[0]),
        false,
      );
      expectSame("and ends on B's top edge", route[route.length - 1].y, erEntityRect(result, "B").top);
    },
  },
  {
    id: "er-subgraph-style",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A ||--|| B : r
      end
      style s1 fill:#f96`,
    status: "supported",
    meaning:
      "⚠️ **A cluster is a legal `style` target in this kind**, measured " +
      "and not assumed — which is the opposite of a relationship, whose id " +
      "reaches nothing at all (`er-style-target-colon`). Mermaid's ER " +
      "`addCssStyles` looks up `this.entities.get(id)` **and** " +
      "`this.subGraphLookup.get(id)`; this very document answers " +
      "`getSubGraphs() -> [{id:\"s1\", …, cssStyles:[\"fill:#f96\"]}]`, " +
      "and mermaid 12.2.0 draws the cluster's rect `fill:#f96 !important` " +
      "(headless Chrome, computed fill `rgb(255, 153, 102)`).\n\n" +
      "Siren paints the frame `<rect>` with the declaration inline (ADR-0008). " +
      "The author names the block; the frame's id is the generated " +
      "`subgraph:1`, and `buildErModel` rewrites the one into the other in " +
      "the set it hands `resolveStyles` (01M3BXN5N). Read off the drawn " +
      "frame, because a declaration that reached the model and not the " +
      "picture would leave every diagnostic empty.",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#f96", text: "" },
      ]);
    },
  },
  {
    id: "er-subgraph-class",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A ||--|| B : r
      end
      classDef urgent fill:#f96
      class s1 urgent`,
    status: "supported",
    meaning:
      "The row above's construct under the other keyword, and a row of its " +
      "own for the reason `er-style-class-statement` is one beside " +
      "`er-style-statement`: `style\\b` and `classDef\\b` switch Mermaid's " +
      "lexer into a condition that runs to the newline while `class\\b` " +
      "switches nothing, so the two are not one idea however alike they " +
      "look.\n\n" +
      "Measured, `setClass` reaches `this.subGraphLookup` exactly as " +
      "`addCssStyles` does: this document answers `getSubGraphs() -> " +
      "[{id:\"s1\", classes:[\"urgent\"], …}]`, and mermaid 12.2.0 draws the " +
      "cluster `g.cluster urgent` with its rect `fill:#f96 !important`.\n\n" +
      "The third spelling is **not** a gap: `subgraph s1:::urgent` is a " +
      "parse error in Mermaid (\"Expecting 'EOF', 'NEWLINE', 'SQS', " +
      "'SEMI', got 'STYLE_SEPARATOR'\"), so there is nothing there to " +
      "implement.",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#f96", text: "" },
      ]);
    },
  },
  {
    id: "er-subgraph-style-above-block",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#f96
      style s1 fill:#f96
      class s1 urgent
      subgraph s1
        A ||--|| B : r
      end`,
    status: "supported",
    meaning:
      "**Order-sensitive, measured.** Mermaid's `addSubGraph` registers a " +
      "block's name at its closing `end`, so a `style` or `class` written " +
      "*above* the block looks the name up before it exists and paints " +
      "nothing: mermaid 12.2.0 draws this cluster's rect with no style at " +
      "all (computed fill the theme's `rgb(249, 249, 251)`), and no error. " +
      "Siren draws the same — an unstyled frame, no diagnostic — because " +
      "the parser resolves a block name only against the blocks already " +
      "closed (`ErStyleDecl.clusterTargets`).",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "", text: "" },
      ]);
    },
  },
  {
    id: "er-subgraph-class-before-classdef",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A ||--|| B : r
      end
      class s1 urgent
      classDef urgent fill:#f96`,
    status: "supported",
    meaning:
      "Only the *block* must come first; the `classDef` need not. Measured " +
      "(mermaid 12.2.0): `class s1 urgent` above `classDef urgent` still " +
      "paints the cluster `fill:#f96 !important` — the class is looked up " +
      "when the picture is drawn, not when `setClass` runs. Siren's shared " +
      "`resolveStyles` pairs a definition with its directive in any order.",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#f96", text: "" },
      ]);
    },
  },
  {
    id: "er-subgraph-style-beats-class",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A ||--|| B : r
      end
      classDef urgent fill:#f00,stroke:#00f
      style s1 fill:#0ff
      class s1 urgent`,
    status: "supported",
    meaning:
      "A cluster follows the entity's rule (`er-style-beats-class`): " +
      "`style` beats an applied class **whichever is written first**. " +
      "Measured (mermaid 12.2.0), both orders draw the cluster rect " +
      "`fill:#0ff !important;stroke:#00f !important` — the `style`'s fill, " +
      "the class's stroke. Siren gets it from `resolveStyles`' two tiers " +
      "(ADR-0008, 2026-10-14 amendment), unchanged.",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#0ff;stroke:#00f", text: "" },
      ]);
    },
  },
  {
    id: "er-subgraph-class-entity-and-cluster",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A ||--|| B : r
      end
      classDef urgent fill:#f96
      class A,s1 urgent`,
    status: "supported",
    meaning:
      "One `class` statement listing an entity and a cluster paints both. " +
      "Measured (mermaid 12.2.0): `A`'s box and the `s1` rect both come out " +
      "`rgb(255, 153, 102)`, `B` keeps its palette fill — `setClass` tries " +
      "both maps for every id it is given.",
    assert: (result) => {
      expectSame("A's box", erEntityStyle(result, "A"), "fill:#f96");
      expectSame("B's box", erEntityStyle(result, "B"), "");
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#f96", text: "" },
      ]);
    },
  },
  {
    id: "er-subgraph-style-color",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A ||--|| B : r
      end
      style s1 fill:#f96,color:#0a0`,
    status: "supported",
    meaning:
      "An author's `color` on a cluster reaches its **title**, the one text " +
      "a cluster draws. Measured (mermaid 12.2.0, headless Chrome): the " +
      "cluster label's computed colour is `rgb(0, 170, 0)`, the rect's fill " +
      "`#f96`; the same holds through `classDef … color:#0a0` + `class`. " +
      "Siren routes `color` to the title's `<text>` spelled `fill`, the " +
      "word SVG paints text with (ADR-0008's label amendment), and leaves it " +
      "off the frame. The entities inside are not recoloured — measured, " +
      "neither box changes.",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#f96", text: "fill:#0a0" },
      ]);
      expectSame("A's box", erEntityStyle(result, "A"), "");
    },
  },
  {
    id: "er-subgraph-class-nested",
    kind: "er",
    source: `erDiagram
      subgraph outer
        subgraph inner
          A ||--|| B : r
        end
        C
      end
      classDef urgent fill:#f96
      class outer urgent`,
    status: "supported",
    meaning:
      "A class on an outer cluster stays on the outer cluster. Measured " +
      "(mermaid 12.2.0): `outer`'s rect is `fill:#f96 !important` while " +
      "`inner`'s carries no style and keeps the theme's fill, and no entity " +
      "changes — nothing cascades from a block to what it holds, as nothing " +
      "cascades between Siren's targets (ADR-0008).",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "outer", frame: "fill:#f96", text: "" },
        { title: "inner", frame: "", text: "" },
      ]);
      expectSame("C's box", erEntityStyle(result, "C"), "");
    },
  },
  {
    id: "er-subgraph-style-shared-name",
    kind: "er",
    source: `erDiagram
      subgraph s1
        A
      end
      style s1 fill:#f96
      subgraph s1
        B
      end
      style s1 stroke:#00f`,
    status: "supported",
    meaning:
      "Two blocks may share a name, and a `style` reaches the one **closed " +
      "most recently** before it. Measured (mermaid 12.2.0, `getSubGraphs`): " +
      "the first block, holding `A`, answers `cssStyles:[\"fill:#f96\"]` and " +
      "the second, holding `B`, `cssStyles:[\"stroke:#00f\"]` — " +
      "`subGraphLookup` is a map each `end` overwrites. Drawn in that order " +
      "here, each frame wearing its own generated id.",
    assert: (result) => {
      expectSame("the clusters as drawn", erSubgraphStyles(result), [
        { title: "s1", frame: "fill:#f96", text: "" },
        { title: "s1", frame: "stroke:#00f", text: "" },
      ]);
    },
  },
  {
    id: "er-style-statement",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : places
      style ORDER fill:#f96,stroke:#333`,
    status: "supported",
    meaning:
      "`style <entity> <declarations>` applies declarations to one entity " +
      "directly. Measured: `ORDER` comes back with " +
      "`cssStyles=[\"fill:#f96\",\"stroke:#333\"]` while its `cssClasses` stays " +
      "`\"default\"` — so the declarations hang off the entity itself, the " +
      "same shape a flowchart's `style` produces (`fc-style-style`). The " +
      "comma splits the declaration list and nothing else.\n\n" +
      "⚠️ **The statement runs to the end of its line**, which no other ER " +
      "statement does: `style\\b` switches Mermaid's lexer into a condition " +
      "whose only exit is the newline, so `style A fill:#f96 C` draws no box " +
      "called `C` (measured) — `er-style-statement-swallows-line` is the row " +
      "for that half.",
    assert: (result) => {
      // Read off the picture: the declarations on the box the author named,
      // and nothing on the box they did not.
      expectSame("ORDER's inline style", erEntityStyle(result, "ORDER"), "fill:#f96;stroke:#333");
      expectSame("CUSTOMER's inline style", erEntityStyle(result, "CUSTOMER"), "");
      // Both boxes are still drawn, and the relationship with them: the
      // statement styles the diagram, it does not declare or consume it.
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
      ]);
    },
  },
  {
    id: "er-style-statement-swallows-line",
    kind: "er",
    source: `erDiagram
      A style B fill:#f96 C`,
    status: "supported",
    meaning:
      "The half of `style` that parts it from every other statement in this " +
      "kind. Mermaid's `style\\b` rule calls `this.begin(\"style\")`, and the " +
      "only rule leaving that condition is `[\\n]+` — so the declaration list " +
      "runs to the newline. Measured: `A style B fill:#f96 C` reports **one** " +
      "entity, `A`. `C` is another `styleComponent` and not a statement, and " +
      "`B` is a target rather than a declaration, so neither becomes a box.\n\n" +
      "Its own row because the failure is silent in both directions: a " +
      "reader returning to the statement stream draws a `C` Mermaid draws " +
      "none for, and one treating the target as a declaration draws a `B`. " +
      "`er-style-class-statement` is the deliberate contrast — `class` " +
      "changes no lexer condition and so does **not** swallow its line.",
    assert: (result) => {
      expectSame("the entities drawn", erEntities(result), ["A[A]"]);
    },
  },
  {
    id: "er-style-class-statement",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#f96
      A
      class A urgent B`,
    status: "supported",
    meaning:
      "`class` is the one styling keyword that changes no lexer condition, " +
      "so its statement ends where its second `idList` does. Measured: " +
      "`class A urgent B` styles `A` **and** declares an entity `B` — " +
      "Mermaid's rule is `CLASS idList idList` with no separator after it.\n\n" +
      "Read beside `er-style-statement-swallows-line`, which is the same " +
      "shape under `style` and comes out the other way. A reader treating " +
      "\"a styling keyword\" as one idea gets one of the two wrong, and both " +
      "failures are silent.",
    assert: (result) => {
      expectSame("the entities drawn", erEntities(result), ["A[A]", "B[B]"]);
      expectSame("A's inline style", erEntityStyle(result, "A"), "fill:#f96");
      expectSame("B's inline style", erEntityStyle(result, "B"), "");
    },
  },
  {
    id: "er-style-class-stacked",
    kind: "er",
    source: `erDiagram
      classDef alpha fill:#f00,stroke:#00f
      classDef beta fill:#0f0
      A
      class A alpha,beta`,
    status: "supported",
    meaning:
      "Two answers in one row, both measured with `--markup` (mermaid " +
      "11.17.2).\n\n" +
      "**The comma splits the class-name half too**, which is this kind's " +
      "own rule: `class A alpha,beta` gives `A` `cssClasses=\"default alpha " +
      "beta\"`. A **state diagram** reads that operand as a bare `\\w+` and " +
      "yields one class literally named `alpha,beta`, matching no definition " +
      "and painting nothing (`01M368GZR`), so the symmetry could not be " +
      "carried across.\n\n" +
      "**And the stacking is first position, last value**: the drawn box " +
      "reads `fill:#0f0 !important;stroke:#00f !important` — `beta` wins the " +
      "`fill` both declare, while the `stroke` only `alpha` declares " +
      "survives, and `fill` keeps the position `alpha` gave it. Reversing " +
      "the two `class` statements reverses only the `fill`, measured.",
    assert: (result) => {
      // The whole string, in order: dropping `beta` leaves `fill:#f00`,
      // dropping `alpha` loses the `stroke`, and re-ordering the halves
      // moves `fill` behind `stroke`. Each is a different picture and none
      // of them says anything.
      expectSame("A's inline style", erEntityStyle(result, "A"), "fill:#0f0;stroke:#00f");
    },
  },
  {
    id: "er-style-classdef",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#f96,stroke:#333
      CUSTOMER ||--o{ ORDER : places
      class ORDER urgent`,
    status: "supported",
    meaning:
      "`classDef` names a set of declarations and `class <entity> <name>` " +
      "applies it. Measured, and **both halves land**: `getClasses()` " +
      "answers with `urgent -> {id:\"urgent\", styles:[\"fill:#f96\"," +
      "\"stroke:#333\"], textStyles:[]}`, and the entity's `cssClasses` " +
      "becomes `\"default urgent\"` — the identical pair a flowchart " +
      "(`fc-style-classdef`) and a class diagram already produce.\n\n" +
      "The definition may be written **above or below** the directive " +
      "applying it (measured both ways), which is why the parser records the " +
      "two unpaired and `resolveStyles` matches them up.",
    assert: (result) => {
      expectSame("ORDER's inline style", erEntityStyle(result, "ORDER"), "fill:#f96;stroke:#333");
      expectSame("CUSTOMER's inline style", erEntityStyle(result, "CUSTOMER"), "");
    },
  },
  {
    id: "er-style-classdef-color",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#000,color:#fff
      ORDER:::urgent {
        string id PK
      }`,
    status: "supported",
    meaning:
      "Where an author's `color` lands in this kind, measured with " +
      "`--markup` rather than carried over: it reaches the entity's name " +
      "label **and every attribute cell in the same box** — one `<text " +
      "style=\"fill:#fff !important\">` apiece on `name`, `attribute-type`, " +
      "`attribute-name`, `attribute-keys` and `attribute-comment`. A `class` " +
      "names the entity and not one of its rows, so recolouring a box means " +
      "its whole table.\n\n" +
      "The `color` → `fill` respelling is `resolveStyles`', shared with " +
      "three other kinds: SVG paints a `<text>` with `fill`, and an inline " +
      "`color` would sit in a property that never reaches it.",
    assert: (result) => {
      // The frame keeps only the frame's half, and every text keeps only the
      // text's: a renderer that wrote both onto both would repaint the
      // letters the box's colour and hide them, saying nothing.
      expectSame("ORDER's frame", erEntityStyle(result, "ORDER"), "fill:#000");
      // The name and all three drawn cells, as one list — so dropping the
      // last cell's paint is a change in length as well as in contents.
      expectSame("every text ORDER draws", erEntityTextStyles(result, "ORDER"), [
        "fill:#fff",
        "fill:#fff",
        "fill:#fff",
        "fill:#fff",
      ]);
      // And the table is still the table: the paint did not move a cell.
      expectSame("ORDER's attribute rows", erAttributeRows(result, "ORDER"), [
        "type=string | name=id | keys=PK",
      ]);
    },
  },
  {
    id: "er-style-class-shorthand",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER:::urgent`,
    status: "supported",
    meaning:
      "`:::` is the apply-directive written onto the entity instead of as a " +
      "statement of its own. Measured: `ORDER:::urgent` reaches the same " +
      "record the `class ORDER urgent` statement does — `cssClasses=\"default " +
      "urgent\"` — so the two are one construct in two spellings. **No " +
      "`classDef` is needed for it**, measured: the source here declares " +
      "none and the class still lands, which is what keeps this row " +
      "measuring `:::` and not the `classDef` line beside it.\n\n" +
      "⚠️ **The statement shape itself now works — this row is refused by " +
      "something else, and the difference matters.** " +
      "`er-style-class-shorthand-defined` is the same construct with a " +
      "`classDef` beside it and is supported. What refuses *this* source is " +
      "the missing definition: `resolveStyles` reports `::: applies " +
      "\"urgent\", which no classDef defines` at error severity, a rule " +
      "settled for every kind that styles (`fc-style-class-unknown-name` " +
      "and `01M36C2S4` drew the line between an unknown **target**, dropped " +
      "in silence as Mermaid drops it, and an unknown **name**, which still " +
      "speaks). Mermaid draws this document and paints nothing, so Siren is " +
      "the stricter of the two here — a divergence this row now measures " +
      "rather than one it hides, and the reason the number fell by two and " +
      "not by three.\n\n" +
      "**Supported since `01M39FAVK`.** That rule is a **warning** now, in " +
      "all four kinds that style: re-measured on 12.2.0, ER, flowchart, " +
      "class and state diagrams each accept an undefined class name, " +
      "record it and paint nothing, so the picture is Mermaid's and only " +
      "the author is told. The unknown-target / unknown-name distinction " +
      "survives, as a warning versus silence.",
    warnings: ['::: applies "urgent", which no classDef defines; dropping the declaration.'],
    assert: (result) => {
      expectSame("ORDER is drawn, unstyled, as Mermaid draws it", erEntityStyle(result, "ORDER"), "");
      expectSame("the entities drawn", erEntities(result), ["CUSTOMER[CUSTOMER]", "ORDER[ORDER]"]);
    },
  },
  {
    id: "er-style-class-shorthand-defined",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#f96
      CUSTOMER ||--o{ ORDER : places
      ORDER:::urgent`,
    status: "supported",
    meaning:
      "`:::` as its own statement shape, with the definition it names in the " +
      "document. Measured, this reaches exactly the record " +
      "`class ORDER urgent` does, so the two spellings are one construct — " +
      "and the directive **rides on an entity declaration**, which is why " +
      "reading it meant widening the entity-head pattern rather than adding " +
      "a keyword.\n\n" +
      "Its own row beside `er-style-class-shorthand` because that one's " +
      "source names no `classDef` and so measures a different thing: " +
      "Siren's diagnostic for an undefined class name. This row is the " +
      "statement shape on its own.",
    assert: (result) => {
      expectSame("ORDER's inline style", erEntityStyle(result, "ORDER"), "fill:#f96");
      expectSame("CUSTOMER's inline style", erEntityStyle(result, "CUSTOMER"), "");
      // The entity is still declared by the line that styles it, and the
      // relationship that also names it is still drawn once.
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
      ]);
      expectSame("the relationships drawn", erRelationships(result), [
        "CUSTOMER:ORDER: only-one-solid-zero-or-more",
      ]);
    },
  },
  {
    id: "er-style-class-shorthand-relationship",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#f96
      classDef calm fill:#9cf
      CUSTOMER:::urgent ||--o{ ORDER:::calm : places`,
    status: "supported",
    meaning:
      "`:::` on a relationship's ends. Mermaid's grammar has a production " +
      "for `entityName ::: idList relSpec entityName ::: idList : role`, so " +
      "either end, or both, may carry a class list. Measured on 12.2.0: " +
      "this document paints `CUSTOMER` `fill:#f96` and `ORDER` `fill:#9cf` " +
      "(`--markup`, `style=\"fill:… !important\"` on each box), and the " +
      "relationship is recorded as `leftEntity=\"CUSTOMER\"` / " +
      "`rightEntity=\"ORDER\"` — the class never reaches it, so its id stays " +
      "`CUSTOMER:ORDER` and not `CUSTOMER:::urgent:ORDER`. One end alone, a " +
      "quoted name (`\"Customer Account\":::x`), a class list (`A:::x,w`) " +
      "and a cardinality glued on (`A:::x||--o{`) are each measured to " +
      "behave the same way.\n\n" +
      "The `:::` sits between the name and the cardinality — never after a " +
      "bracketed alias, which a relationship end cannot carry at all " +
      "(`A[\"Al\"]:::x ||--o{ B : y` is a parse error). Without a label the " +
      "line is still refused, as in Mermaid (`A:::x ||--o{ B:::z` → parse " +
      "error).",
    assert: (result) => {
      expectSame("CUSTOMER's inline style", erEntityStyle(result, "CUSTOMER"), "fill:#f96");
      expectSame("ORDER's inline style", erEntityStyle(result, "ORDER"), "fill:#9cf");
      expectSame("the entities drawn", erEntities(result), ["CUSTOMER[CUSTOMER]", "ORDER[ORDER]"]);
      expectSame("the relationships drawn", erRelationships(result), [
        "CUSTOMER:ORDER: only-one-solid-zero-or-more",
      ]);
    },
  },
  {
    id: "er-style-class-shorthand-spaced",
    kind: "er",
    source: `erDiagram
      classDef urgent fill:#f96
      classDef calm fill:#9cf
      CUSTOMER :::urgent ||--o{ ORDER ::: calm : places
      ITEM ::: calm , urgent`,
    status: "supported",
    meaning:
      "`:::` with whitespace around it. Mermaid's lexer skips whitespace " +
      "between any two tokens and `:::` is a token of its own, so the " +
      "spaced spellings are the same construct as the glued ones. Measured " +
      "on 12.2.0 (`--markup`): `CUSTOMER` is painted `fill:#f96`, `ORDER` " +
      "`fill:#9cf`, and `ITEM` — `calm` then `urgent` — `fill:#f96`, the " +
      "later class winning; the relationship is still recorded between " +
      "`CUSTOMER` and `ORDER`. `A ::: x`, `A::: x`, `A[\"al\"] ::: x` and " +
      "`A ::: x { int y }` are each measured to give the class too. Until " +
      "ticket backlog-batch-1014/07 Siren read `:::` only glued to the name " +
      "and refused every spaced spelling as an unrecognized line. A newline " +
      "is not whitespace here: `A :::` with the list on the next line is a " +
      "parse error in Mermaid (\"got 'NEWLINE'\"), and refused here.",
    assert: (result) => {
      expectSame("CUSTOMER's inline style", erEntityStyle(result, "CUSTOMER"), "fill:#f96");
      expectSame("ORDER's inline style", erEntityStyle(result, "ORDER"), "fill:#9cf");
      expectSame("ITEM's inline style", erEntityStyle(result, "ITEM"), "fill:#f96");
      expectSame("the relationships drawn", erRelationships(result), [
        "CUSTOMER:ORDER: only-one-solid-zero-or-more",
      ]);
    },
  },
  {
    id: "er-class-reserved-word",
    kind: "er",
    source: `erDiagram
      A
      class A end`,
    status: "rejected",
    meaning:
      "⚠️ **Not valid Mermaid, and here for that reason**: until 01M3BXNYR " +
      "Siren read this as \"apply the class `end` to `A`\" while Mermaid " +
      "refuses it, and no row said so. `class\\b` switches no lexer " +
      "condition, so `end` is lexed as the `END` keyword — measured on " +
      "12.2.0, a parse error, `got 'END'`. Siren now refuses it by name " +
      "(\"Reserved word … cannot stand in a class list\").\n\n" +
      "Measured position by position, for every word of " +
      "`RESERVED_BARE_NAMES` (`end`, `subgraph`, `class`, `style`, " +
      "`classDef`, any case): Mermaid refuses one in **either half** of a " +
      "`class` statement (`class end u`, `class A u,end`) and after `:::` " +
      "(`A:::end`, `A:::u,end`, `A:::end ||--o{ B : y`, " +
      "`A ||--o{ B:::end : y`), and at the head of a member (`end-x`, but " +
      "not `endx`). It **accepts** them as a `style` target or a `classDef` " +
      "name (`style end fill:red`, `classDef end fill:red`), because " +
      "`style\\b` and `classDef\\b` switch to a condition with no keywords — " +
      "so those are left alone. A quoted class name is refused by Mermaid " +
      "anyway (`class A \"end\"` → `got 'ENTITY_NAME'`).\n\n" +
      "**Not only those five words** (backlog-batch-1014/07). A class-list " +
      "member is `UNICODE_TEXT` alone, so every lexer rule that outranks the " +
      "name rule refuses one. Measured on 12.2.0, one probe per word in each " +
      "of the seven positions above (`class A w`, `class w A`, " +
      "`class A x,w`, `A:::w`, `A:::x,w`, `A:::w ||--o{ B : y`, " +
      "`A ||--o{ B:::w : y`): the cardinality and body words — `one` " +
      "(`got 'ONLY_ONE'`), `many` (`'ZERO_OR_MORE'`), `to` " +
      "(`'IDENTIFYING'`) — `erDiagram` (`'ER_DIAGRAM'`) and `u-x` / `u.x` " +
      "(`'MD_PARENT'`), any case; and a member opening a multi-word " +
      "cardinality or a glued one (`class A zero or more`, " +
      "`A:::only one to many B : y`, `A:::u||--o{ B : y`). Siren read every " +
      "one as an ordinary class — `class A zero or more` even as the class " +
      "`zero` and two entities, `or` and `more` — and refuses them now with " +
      "the same \"Reserved word\" diagnostic. `only`, `zero`, `u` and `ux` " +
      "alone are ordinary classes in Mermaid and here.\n\n" +
      "**And a number.** The lexer's number rules come before its name rule " +
      "too, with no word boundary, so `class A 2` and `class A 1abc` " +
      "(`got 'NUM'`), `A:::1.5` (`'DECIMAL_NUM'`) and `A:::1` " +
      "(`'ENTITY_ONE'`) are each refused in every position, while `A:::x1` " +
      "is a class. Siren refuses a digit-headed member by name (\"Number … " +
      "cannot stand in a class list\"). The row's status and count do not " +
      "move: one construct, measured wider.",
  },
  {
    id: "er-style-target-colon",
    kind: "er",
    source: `erDiagram
      CUSTOMER ||--o{ ORDER : places
      style CUSTOMER:ORDER fill:#f96`,
    status: "rejected",
    meaning:
      "**The most natural thing an author would write to style a " +
      "relationship, and Mermaid draws garbage for it.** A relationship's " +
      "id is `${from}:${to}` (01M3977716), so `style CUSTOMER:ORDER " +
      "fill:#f96` is the obvious spelling — and `er-style-statement` " +
      "records the measurement that says it cannot work: `addCssStyles` " +
      "reaches only `entities` and `subGraphs`, never a relationship.\n\n" +
      "What Mermaid does instead is worse than refusing. Its `style` " +
      "condition's word rule is `([^\\x00-\\x7F]|\\w|-|\\*)+`, which has no " +
      "colon, and the condition skips whitespace while `style: style " +
      "styleComponent` concatenates with no separator. Measured with " +
      "`--markup`: **`CUSTOMER`'s own rect comes out carrying " +
      "`style=\":ORDERfill !important\"`** — a declaration that is not a " +
      "declaration, on an element the author never named, with no error " +
      "anywhere. The relationship is left alone, as the database says it " +
      "must be.\n\n" +
      "So this is the **exception to the absolute condition**, in the form " +
      "CONTEXT.md states it: Mermaid renders it, but Mermaid renders it " +
      "*wrong* and says nothing, so Siren refuses rather than copying the " +
      "bug. The refusal **names the reason** (01M39FA7F): the diagnostic " +
      "says relationships cannot be styled in erDiagram, that " +
      "`CUSTOMER:ORDER` names the relationship between `CUSTOMER` and " +
      "`ORDER`, and that `style` reaches only entities and subgraphs — so " +
      "the author learns they are styling something that " +
      "cannot be styled, not that their line is malformed. Re-measured on " +
      "12.2.0: the rect still carries `style=\":ORDERfill !important\"`.\n\n" +
      "This row is mine, not `01M3977QT`'s. It measured that a " +
      "relationship cannot be styled and drew the right conclusion for the " +
      "target set, but read this document as painting nothing; the `rect` " +
      "says otherwise. The conclusion survives the correction — a " +
      "relationship id must stay out of the style target set — and the " +
      "document itself needed a row.",
  },
  {
    id: "er-style-classdef-default",
    kind: "er",
    source: `erDiagram
      classDef default fill:#abc
      CUSTOMER`,
    status: "rejected",
    meaning:
      "⚠️ **Every ER entity already wears a class called `default`.** " +
      "Measured from Mermaid's own database: `addEntity` creates each entity " +
      "with `cssClasses: \"default\"` and `getCompiledStyles` resolves paint " +
      "from `cssClasses.split(\" \")`, so `classDef default fill:#abc` paints " +
      "`CUSTOMER` — confirmed with `--markup`, `style=\"fill:#abc " +
      "!important\"` on its box — with no `class` statement anywhere.\n\n" +
      "Siren has no implicit class in any kind, so reading this statement " +
      "and applying it to nothing would draw a **different picture with no " +
      "diagnostic**. Refused by name instead, which is what keeps it out of " +
      "`SILENTLY_WRONG`. Written when ER styling landed, because that is " +
      "when the statement became readable at all.\n\n" +
      "⚠️ **The same gap is open in the flowchart and has no row.** Measured " +
      "on Siren itself: `flowchart TB / classDef default fill:#abc / A` " +
      "reports no diagnostic and paints nothing, which is exactly the silent " +
      "divergence refused here. That is `parseFlowchart`'s to fix and was " +
      "outside this ticket's write scope.",
  },
  {
    id: "er-statements-one-line",
    kind: "er",
    source: `erDiagram
      CUSTOMER ORDER LINE-ITEM`,
    status: "supported",
    meaning:
      "Mermaid's ER grammar runs several statements on one line: measured, " +
      "`CUSTOMER ORDER LINE-ITEM` reports **three** entities. This is the " +
      "construct underneath three separate-looking gaps. `direction TD` is " +
      "two entities (`direction` and `TD`) rather than a direction, because " +
      "the ER lexer writes `TB`/`BT`/`RL`/`LR` out literally and the " +
      "flowchart's `TD` alias never reaches this grammar. `A ||--o{ B : two " +
      "words` is a relationship whose label is `two` plus a third entity " +
      "called `words`. And Mermaid's own direction rule is spelled " +
      "`.*direction\\s+LR[^\\n]*`, so `XX direction LR` sets the direction and " +
      "swallows the rest of the line, declaring no entity at all.\n\n" +
      "Reading a line as a **stream** of statements is what closes all four " +
      "at once — and what makes `RESERVED_BARE_NAMES` load-bearing: `end`, " +
      "`subgraph`, `class`, `style` and `classDef` are spelled by the name " +
      "alphabet but are each a parse error in Mermaid, so a stream that read " +
      "them as names drew boxes for `er-subgraph` that Mermaid draws no box " +
      "for.",
    assert: (result) => {
      // Three boxes from one line, read off the picture. The id is what
      // says the line was split rather than swallowed: a single box labelled
      // "CUSTOMER ORDER LINE-ITEM" would satisfy any assert that only
      // counted characters.
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
        "LINE-ITEM[LINE-ITEM]",
      ]);
    },
  },
  {
    id: "er-entity-name-quoted",
    kind: "er",
    source: `erDiagram
      "Customer Account" ||--o{ ORDER : places`,
    status: "supported",
    meaning:
      "A quoted entity name, which is how a name gets a space in it. " +
      "Measured: the entity is keyed on `Customer Account` with the quotes " +
      "**stripped** — `label=\"Customer Account\"`, no `alias` field at all — " +
      "and the relationship names it the same way. So this is not the alias " +
      "construct: an alias leaves the id alone and changes the drawn text, " +
      "while a quoted name changes **both**, which makes the id a string no " +
      "`ENTITY_NAME_RE` alphabet can spell.",
    assert: (result) => {
      // Read off the picture as `id[label]`, because the id is the whole of
      // what parts this construct from the alias one: `er-alias-unquoted`'s
      // sibling `CUSTOMER["Customer Account"]` draws the very same words and
      // keeps `data-siren-id="CUSTOMER"`. An assert on the drawn text alone
      // could not tell the two apart.
      expectSame("the entities drawn", erEntities(result), [
        "Customer Account[Customer Account]",
        "ORDER[ORDER]",
      ]);
      expectSame("the relationship drawn", erRelationships(result), [
        "Customer Account:ORDER: only-one-solid-zero-or-more",
      ]);
    },
  },
  {
    id: "er-acc-title",
    kind: "er",
    source: `erDiagram
      accTitle: Order book
      CUSTOMER ||--o{ ORDER : places`,
    status: "supported",
    meaning:
      "The diagram's screen-reader-only title. Measured: `getAccTitle()` " +
      "answers `\"Order book\"` and the entity table is untouched, so it " +
      "draws nothing on the canvas and is a `<title>` on the `<svg>` — the " +
      "same construct `fc-acc-title` and `seq-acc-title` already cover for " +
      "two other kinds, and real Mermaid wires this kind's root with " +
      "`aria-labelledby` exactly as it wires a flowchart's.",
    assert: (result) => {
      const svg = svgOf(result);
      const title = svg.querySelector("title");
      if (title === null) throw new Error("no <title> was drawn");
      expectSame("the accessible title text", title.textContent, "Order book");
      expectSame(
        "the root svg is labelled by that title",
        svg.getAttribute("aria-labelledby"),
        title.getAttribute("id"),
      );
      // Nothing on the canvas: the statement is a box in no picture Mermaid
      // draws, and the entity table is the same two entries with or without
      // it (measured).
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
      ]);
    },
  },
  {
    id: "er-acc-descr",
    kind: "er",
    source: `erDiagram
      accDescr: how orders relate to customers
      CUSTOMER ||--o{ ORDER : places`,
    status: "supported",
    meaning:
      "The screen-reader-only description, `accTitle`'s twin. Measured: " +
      "`getAccDescription()` answers `\"how orders relate to customers\"` and " +
      "nothing else changes. Its own row rather than a line in the one " +
      "above because Mermaid gives it its own statement, its own store and " +
      "its own multi-line `accDescr { ... }` spelling — and `fc-acc-title` " +
      "and `fc-acc-descr` are already two rows for that reason. The braced " +
      "spelling is `er-acc-descr-multiline`.",
    assert: (result) => {
      const svg = svgOf(result);
      const desc = svg.querySelector("desc");
      if (desc === null) throw new Error("no <desc> was drawn");
      expectSame(
        "the accessible description text",
        desc.textContent,
        "how orders relate to customers",
      );
      expectSame(
        "the root svg is described by that desc",
        svg.getAttribute("aria-describedby"),
        desc.getAttribute("id"),
      );
      // The twin assertion to `er-acc-title`'s: a document writing only the
      // description gets only the description, and no `<title>` appears
      // beside it.
      expectSame("no accessible title was invented", svg.querySelector("title"), null);
      expectSame("the entities drawn", erEntities(result), [
        "CUSTOMER[CUSTOMER]",
        "ORDER[ORDER]",
      ]);
    },
  },
  {
    id: "er-case-acc",
    kind: "er",
    source: `erDiagram
      ACCTITLE: Order book
      AccDescr : how orders relate to customers
      CUSTOMER`,
    status: "supported",
    meaning:
      "`accTitle` and `accDescr` in any case, with whitespace allowed before " +
      "the colon — the one pair of ER keywords that was still read in lower " +
      "case only. Measured on 12.2.0: `ACCTITLE: hi`, `ACCDESCR: hi` and " +
      "`accTitle : hi` each set the field and draw no box.",
    assert: (result) => {
      const svg = svgOf(result);
      expectSame("the accessible title text", svg.querySelector("title")?.textContent, "Order book");
      expectSame(
        "the accessible description text",
        svg.querySelector("desc")?.textContent,
        "how orders relate to customers",
      );
      expectSame("the entities drawn", erEntities(result), ["CUSTOMER[CUSTOMER]"]);
    },
  },
  {
    id: "er-style-beats-class",
    kind: "er",
    source: `erDiagram
      classDef alpha fill:#f00,stroke:#00f
      A
      style A fill:#0ff
      A:::alpha`,
    status: "supported",
    meaning:
      "A `style` beats an applied class **whichever is written first**. " +
      "Measured on 12.2.0 (ER, with `:::`): with `style` above the `class` line the " +
      "target still paints the `style`'s `fill`, keeping the class's " +
      "`stroke` — `fill:#0ff !important;stroke:#00f !important`. Siren used " +
      "to let the later line win, drawing the class's `fill` with no " +
      "diagnostic (01M39F9N1; ADR-0008's 2026-10-14 amendment).",
    assert: (result) => {
      expectSame("A's box", erEntityStyle(result, "A"), "fill:#0ff;stroke:#00f");
    },
  },
  {
    id: "er-acc-descr-multiline",
    kind: "er",
    source: `erDiagram
      accDescr {
        string x
      }
      CUSTOMER`,
    status: "supported",
    meaning:
      "`accDescr`'s **braced** spelling, the multi-line description. " +
      "Measured: this document reports exactly one entity, `CUSTOMER` — the " +
      "block is prose and puts no box on the canvas. `accTitle {` has no " +
      "such rule and is a *parse error* in Mermaid, so the brace belongs to " +
      "this word alone.\n\n" +
      "⚠️ **This row was found while implementing `er-acc-descr`, and it " +
      "was a silently wrong picture rather than a missing one.** " +
      "`ENTITY_HEAD_RE` matches `accDescr {` exactly as it matches " +
      "`CUSTOMER {`, and `string x` is a well-formed attribute, so Siren " +
      "drew **two** boxes for it — `CUSTOMER`, and an `accDescr` carrying a " +
      "`string x` row — with no diagnostic of any severity. It hid because " +
      "a description written in anything but two attribute-shaped words " +
      "was refused instead. `parseErDiagram` now names it and drains the " +
      "block, so the body's prose is not reported as malformed ER on top of " +
      "the refusal.\n\n" +
      "The same hole stayed open in capitals until `01M4WAFD4`: the guard " +
      "was case-sensitive, so `ACCDESCR {` / `string x` / `}` — the same " +
      "block in Mermaid 12.2.0 — drew the two boxes again. It is refused by " +
      "name in any case now.\n\n" +
      "**Supported since `01M4WS1P6`**: the block is read as the description " +
      "through the shared `readAccDescrBlock`, exactly as a flowchart's and a " +
      "sequence diagram's are (measured on 12.2.0: indent and blank lines go, " +
      "an empty block is no description, what follows `}` is the next " +
      "statement) — so the body is never an entity's attributes, in any case.",
    assert: (result) => {
      expectSame("the accessible description text", svgOf(result).querySelector("desc")?.textContent, "string x");
      expectSame("one entity, and no box called accDescr", erEntities(result), ["CUSTOMER[CUSTOMER]"]);
    },
  },

  {
    id: "er-label-tag-quotes",
    kind: "er",
    source: `erDiagram
      CUSTOMER["<span style="color:red">t</span>"] {
        string id "<span style="color:red">c</span>"
      }
      CUSTOMER ||--o{ ORDER : "<span style="color:red">r</span>"`,
    status: "supported",
    meaning:
      "Before any diagram reads a line, Mermaid rewrites each `=\"\u2026\"` " +
      "inside a tag-shaped stretch `/<(\\w+)([^>]*)>/` as `='\u2026'` (its " +
      "`cleanupText`, over the whole document). So an alias, a comment " +
      "and a relationship label may each hold a double-quoted attribute " +
      "inside their own quotes. Measured (mermaid 11.17.2, `--html`): the " +
      "alias, the comment and the label are each a red " +
      "`<span style=\"color:red\">`.",
    assert: (result) => {
      const group = 'g.siren-er-entity[data-siren-id="CUSTOMER"]';
      const alias = svgOf(result).querySelector(`${group} text.siren-er-entity-label`);
      const comment = svgOf(result).querySelector(`${group} text.siren-er-attribute-comment`);
      const label = svgOf(result).querySelector("text.siren-er-relationship-label");
      expectSame("the alias's runs", labelRuns(alias, "style"), ["t[style=fill: red]"]);
      expectSame("the comment's runs", labelRuns(comment, "style"), ["c[style=fill: red]"]);
      expectSame("the label's runs", labelRuns(label, "style"), ["r[style=fill: red]"]);
    },
  },

  // -------------------------------------------------------------------------
  // document config — frontmatter (ADR-0017)
  // -------------------------------------------------------------------------
  //
  // Written as joined lines rather than template literals: a frontmatter
  // must open at the document's first character and close at the same
  // indent, which an indented template would break. Every source below was
  // measured on mermaid 12.2.0 with the probe and draws the diagram shown.
  {
    id: "doc-frontmatter-flowchart",
    kind: "flowchart",
    source: ["---", "title: Checkout", "config:", "  theme: forest", "---", "flowchart TD", "  A[Start] --> B[End]"].join(
      "\n",
    ),
    status: "supported",
    meaning:
      "A frontmatter at the top of the document carries its document config " +
      "(`config`) and a `title`; Mermaid reads both and draws the flowchart " +
      "below them. Siren draws the same flowchart, keeps the config as " +
      "written, and says that neither the title nor the theme is applied yet.",
    warnings: [
      "Frontmatter title is read but not drawn yet; the diagram is drawn without it.",
      'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
    ],
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  {
    id: "doc-frontmatter-sequence",
    kind: "sequence",
    source: ["---", "config:", "  look: handDrawn", "---", "sequenceDiagram", "  A->>B: Hello"].join("\n"),
    status: "supported",
    meaning: "A sequence diagram below a frontmatter is drawn as one without it.",
    warnings: ['Document config "look" is read but not applied yet; the diagram is drawn without it.'],
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame("messages", messages(result), ["A-B: Hello"]);
    },
  },
  {
    id: "doc-frontmatter-class",
    kind: "class",
    source: [
      "---",
      "config:",
      "  theme: dark",
      "  class:",
      "    hideEmptyMembersBox: true",
      "---",
      "classDiagram",
      "  Animal <|-- Dog",
    ].join("\n"),
    status: "supported",
    meaning:
      "A class diagram below a frontmatter is drawn as one without it; each " +
      "top-level config key, a diagram-specific block like `class` included, " +
      "is reported once.",
    warnings: [
      'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
      'Document config "class" is read but not applied yet; the diagram is drawn without it.',
    ],
    assert: (result) => {
      expectSame("classes", classes(result), ["Animal", "Dog"]);
      expectSame("relationships", relationships(result), ["Animal-Dog:inheritance"]);
    },
  },
  {
    id: "doc-frontmatter-state",
    kind: "state",
    source: ["---", "displayMode: compact", "---", "stateDiagram-v2", "  Idle --> Running"].join("\n"),
    status: "supported",
    meaning:
      "A top-level `displayMode` is folded into `config.gantt.displayMode`, " +
      "as Mermaid's `processFrontmatter` folds it, and so is reported as the " +
      "`gantt` key; the state diagram below is drawn as one without it.",
    warnings: ['Document config "gantt" is read but not applied yet; the diagram is drawn without it.'],
    assert: (result) => {
      expectSame("states", states(result), ["Idle", "Running"]);
      expectSame("transitions", transitions(result), ["Idle-Running: "]);
    },
  },
  {
    id: "doc-frontmatter-er",
    kind: "er",
    source: [
      "---",
      "config:",
      "  themeVariables:",
      "    primaryColor: '#ffcc00'",
      "---",
      "erDiagram",
      "  CUSTOMER ||--o{ ORDER : places",
    ].join("\n"),
    status: "supported",
    meaning: "An ER diagram below a frontmatter is drawn as one without it.",
    warnings: ['Document config "themeVariables" is read but not applied yet; the diagram is drawn without it.'],
    assert: (result) => {
      expectSame("entities", erEntities(result), ["CUSTOMER[CUSTOMER]", "ORDER[ORDER]"]);
    },
  },
  {
    id: "doc-frontmatter-unknown-key",
    kind: "flowchart",
    source: ["---", "siren:", "  roles:", "    warning: urgent", "---", "flowchart TD", "  A --> B"].join("\n"),
    status: "supported",
    meaning:
      "Mermaid drops a frontmatter key it does not know, unread, and draws " +
      "the diagram. ADR-0017 rests on that: it is the one place Siren-only " +
      "meaning may live outside a timeline block and the document still be " +
      "Mermaid. Siren drops it too, in silence, until a later board gives " +
      "`siren:` a meaning — this row is the regression guard that Mermaid " +
      "still accepts it.",
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[A]", "B[B]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },

  // -------------------------------------------------------------------------
  // document config — `%%{init}%%` directives (ADR-0017)
  // -------------------------------------------------------------------------
  //
  // Joined lines for the same reason as the frontmatter rows above. Every
  // source below was measured on mermaid 12.2.0 with the probe and draws the
  // diagram shown; the config each reads was measured with `mermaid.parse`.
  {
    id: "doc-init-multiline",
    kind: "flowchart",
    source: [
      "%%{",
      "  init: {",
      '    "theme": "dark",',
      '    "flowchart": {"curve": "basis"}',
      "  }",
      "}%%",
      "flowchart TD",
      "  A[Start] --> B[End]",
    ].join("\n"),
    status: "supported",
    meaning:
      "An init directive may spread over several lines; Mermaid removes it " +
      "whole, reads its settings, and draws the flowchart below. Siren " +
      "removes it whole too — none of its lines is left behind as diagram " +
      "text — keeps its settings, and says that none is applied yet.",
    warnings: [
      'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
      'Document config "flowchart" is read but not applied yet; the diagram is drawn without it.',
    ],
    assert: (result) => {
      expectSame("nodes", nodes(result), ["A[Start]", "B[End]"]);
      expectSame("edges", edges(result), ["A-B"]);
    },
  },
  {
    id: "doc-init-over-frontmatter",
    kind: "sequence",
    source: [
      "---",
      "config:",
      "  theme: forest",
      "  look: handDrawn",
      "---",
      '%%{init: {"theme": "dark"}}%%',
      "sequenceDiagram",
      "  A->>B: Hello",
    ].join("\n"),
    status: "supported",
    meaning:
      "A frontmatter and an init directive may both set a key; Mermaid " +
      "merges the init over the frontmatter, so `theme` is `dark` and `look` " +
      "is kept, and draws the sequence diagram. Siren merges them the same " +
      "way and reports each key once, neither applied yet.",
    warnings: [
      'Document config "look" is read but not applied yet; the diagram is drawn without it.',
      'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
    ],
    assert: (result) => {
      expectSame("participants", participants(result), ["A", "B"]);
      expectSame("messages", messages(result), ["A-B: Hello"]);
    },
  },

  // -------------------------------------------------------------------------
  // labels — the HTML tag vocabulary (ADR-0015), kept in `labelCorpus.ts`
  // -------------------------------------------------------------------------
  ...LABEL_CASES,
];
