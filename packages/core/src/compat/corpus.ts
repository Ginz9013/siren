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
export type CompatKind = "flowchart" | "class" | "sequence";

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

/** Every flowchart node as `id[label]`, in draw order. */
function nodes(result: SirenRenderResult): string[] {
  return elements(result, "g.siren-node").map((g) => `${idOf(g)}[${textOf(g)}]`);
}

/** Every flowchart edge id (`A-B`), in draw order. */
function edges(result: SirenRenderResult): string[] {
  return elements(result, "path.siren-edge").map(idOf);
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
  const frame = svgOf(result).querySelector(
    `g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`,
  );
  if (frame === null) throw new Error(`no node "${id}" was drawn`);
  return {
    x: Number(frame.getAttribute("x")) + Number(frame.getAttribute("width")) / 2,
    y: Number(frame.getAttribute("y")) + Number(frame.getAttribute("height")) / 2,
  };
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
  // flowchart — edges
  // -------------------------------------------------------------------------
  {
    id: "fc-edge-open",
    kind: "flowchart",
    source: `flowchart TB
      A --- B`,
    status: "rejected",
    meaning: "`A --- B` is an open link: a line with no arrowhead.",
  },
  {
    id: "fc-edge-dotted",
    kind: "flowchart",
    source: `flowchart TB
      A -.-> B`,
    status: "rejected",
    meaning: "`A -.-> B` is a dotted arrow.",
  },
  {
    id: "fc-edge-thick",
    kind: "flowchart",
    source: `flowchart TB
      A ==> B`,
    status: "rejected",
    meaning: "`A ==> B` is a thick arrow.",
  },
  {
    id: "fc-edge-circle-end",
    kind: "flowchart",
    source: `flowchart TB
      A --o B`,
    status: "rejected",
    meaning: "`A --o B` ends in a circle rather than an arrowhead.",
  },
  {
    id: "fc-edge-cross-end",
    kind: "flowchart",
    source: `flowchart TB
      A --x B`,
    status: "rejected",
    meaning: "`A --x B` ends in a cross.",
  },
  {
    id: "fc-edge-bidirectional",
    kind: "flowchart",
    source: `flowchart TB
      A <--> B`,
    status: "rejected",
    meaning: "`A <--> B` carries an arrowhead at both ends.",
  },
  {
    id: "fc-edge-long",
    kind: "flowchart",
    source: `flowchart TB
      A ----> B`,
    status: "rejected",
    meaning: "A longer arrow spans more ranks; `A ----> B` still means A to B.",
  },
  {
    id: "fc-edge-pipe-label",
    kind: "flowchart",
    source: `flowchart TB
      A -->|yes| B`,
    status: "rejected",
    meaning: "`A -->|text| B` labels the edge `text`.",
  },
  {
    id: "fc-edge-inline-label",
    kind: "flowchart",
    source: `flowchart TB
      A -- yes --> B`,
    status: "rejected",
    meaning: "`A -- text --> B` is the other spelling of an edge label.",
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
    id: "fc-stmt-subgraph",
    kind: "flowchart",
    source: `flowchart TB
      subgraph one
        A --> B
      end`,
    status: "rejected",
    meaning: "`subgraph ... end` groups nodes inside a labelled frame.",
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
    status: "silently-wrong",
    meaning:
      "Mermaid trims the whitespace around a label, quoted or not: mermaid " +
      "11.17.2 records `text=\"padded\"` for both of these vertices " +
      "(`node scripts/mermaid-probe.mjs`). Padding a label is how an author " +
      "lays a document out; it is not part of what the box says.",
    assert: (result) => {
      // Both boxes keep the spaces they were padded with, and neither says
      // anything about it -- a wider box with the label off its own centre,
      // and no diagnostic. Uniform across the quoted and the unquoted
      // spelling, which is why this is one row: it is one missing trim in
      // the parser, not a quoting bug.
      expectSame("nodes", nodes(result), ["A[  padded  ]", "B[  padded  ]"]);
    },
  },
  {
    id: "fc-text-markdown",
    kind: "flowchart",
    source: `flowchart TB
      A["\`**bold**\`"]`,
    status: "rejected",
    meaning: "A Markdown string draws **bold** as bold text.",
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

  // -------------------------------------------------------------------------
  // flowchart — interaction and accessibility
  // -------------------------------------------------------------------------
  {
    id: "fc-click-href",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A href "https://example.com"`,
    status: "rejected",
    meaning: "`click A href \"url\"` makes the node a link.",
  },
  {
    id: "fc-click-call",
    kind: "flowchart",
    source: `flowchart TB
      A[Start]
      click A call showDetails()`,
    status: "rejected",
    meaning: "`click A call fn()` makes the node call back into the host.",
  },
  {
    id: "fc-acc-title",
    kind: "flowchart",
    source: `flowchart TB
      accTitle: A short title
      A[Start] --> B[End]`,
    status: "rejected",
    meaning: "`accTitle:` gives the diagram its accessible title.",
  },
  {
    id: "fc-acc-descr",
    kind: "flowchart",
    source: `flowchart TB
      accDescr: A longer description
      A[Start] --> B[End]`,
    status: "rejected",
    meaning: "`accDescr:` gives the diagram its accessible description.",
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
    status: "rejected",
    meaning: "`A ()-- B` is a lollipop: B exposes an interface that A consumes.",
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
    status: "silently-wrong",
    meaning:
      "`loop label ... end` frames the messages it wraps, and Mermaid draws the " +
      "keyword `loop` in a corner tag on that frame.",
    assert: (result) => {
      // What is drawn: the frame, the label, the messages. What is NOT drawn:
      // the keyword. `data-siren-block-kind` carries it, but an attribute is
      // not the picture -- a reader of the SVG cannot tell this frame from an
      // `opt`, a `par` or a `critical`, and those mean different things.
      expectSame("blocks", blocks(result), ["loop:loop:1"]);
      expectSame("block label", texts(result, "text.siren-block-label"), ["every minute"]);
      expectSame("messages", messages(result), ["A-B: poll"]);
      expectSame("the keyword is nowhere in the drawing", drew(result, "text.siren-block-keyword"), false);
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
    status: "silently-wrong",
    meaning:
      "`alt`/`else` frames two branches divided by a line, and Mermaid draws " +
      "`alt` and `else` as corner tags beside each branch's label.",
    assert: (result) => {
      // Both branch labels and the divider are drawn; only the two keywords are
      // missing. The same one gap as `seq-loop`, and it is why these two are
      // the cases the board carries forward: their exit is drawing the keyword,
      // not rejecting the construct.
      expectSame("blocks", blocks(result), ["alt:alt:1"]);
      expectSame("messages", messages(result), ["A-B: proceed", "A-B#2: stop"]);
      expectSame("a divider was drawn between the branches", drew(result, "line.siren-block-divider"), true);
      expectSame("neither keyword is in the drawing", drew(result, "text.siren-block-keyword"), false);
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
    status: "rejected",
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
    status: "rejected",
    meaning: "`activate X` / `deactivate X` is the long form of the same activation bar.",
  },
  {
    id: "seq-note-over",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      participant B
      note over A,B: they agree`,
    status: "rejected",
    meaning: "`note over A,B: text` draws a note spanning both lanes.",
  },
  {
    id: "seq-note-right-of",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      note right of A: thinking`,
    status: "rejected",
    meaning: "`note right of X: text` draws a note beside one lane.",
  },
  {
    id: "seq-acc-title",
    kind: "sequence",
    source: `sequenceDiagram
      accTitle: A short title
      participant A
      participant B
      A->>B: Hello`,
    status: "rejected",
    meaning: "`accTitle:` gives the diagram its accessible title.",
  },
  {
    id: "seq-link",
    kind: "sequence",
    source: `sequenceDiagram
      participant A
      link A: Dashboard @ https://example.com`,
    status: "rejected",
    meaning: "`link X: Label @ url` hangs a menu entry off the participant.",
  },
];


