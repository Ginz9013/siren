/**
 * The layout parity metrics: pure functions over two pictures' node centers.
 *
 * A picture here is a plain object `{ [nodeId]: { x, y } }` — the center of
 * each node's box, in whatever units the picture was drawn in. Mermaid and
 * Siren draw at different scales and origins, so nothing below compares raw
 * coordinates: each picture is first normalized on its own to 0..1 on each
 * axis (min-max over its matched nodes), and every number is read from that.
 *
 * - **Structural agreement** — over every unordered pair of matched nodes, is
 *   the second node above / level with / below the first in both pictures?
 *   The share of pairs that agree, reported separately for the vertical and
 *   the horizontal relation. "Level" means within `LEVEL_TOLERANCE` of each
 *   other in normalized units, so two nodes of one dagre rank stay level
 *   despite sub-pixel noise.
 * - **Normalized position error** — the distance between a node's normalized
 *   center in the two pictures; mean and max over matched nodes, and the
 *   nodes with the largest distance.
 *
 * A node present in only one picture is unmatched: counted, listed, and kept
 * out of every metric.
 *
 * The edge metrics further down (`measureEdges`) are the other kind: they
 * read one picture's lines on their own — crossings, lines drawn across
 * nodes and group titles, reversals, detour, aspect — and the report sets
 * the two sides' numbers next to each other.
 */

/**
 * Normalized distance under which two centers count as level on an axis.
 * Chosen, not measured: half a percent of the picture is below a pixel for
 * every fixture here (the widest is under 2000px), so it only absorbs the
 * rounding of two renderers placing a row at the same height.
 */
export const LEVEL_TOLERANCE = 0.005;

/** How many of the most-displaced nodes a comparison reports. */
export const WORST_COUNT = 5;

/**
 * Min-max normalize each axis of `centers` (restricted to `ids`) to 0..1.
 * An axis on which every node sits at one coordinate has no extent to scale
 * by; every node is put at 0.5 on it, which is what "they are all level"
 * means in a 0..1 frame.
 */
function normalize(centers, ids) {
  const xs = ids.map((id) => centers[id].x);
  const ys = ids.map((id) => centers[id].y);
  const scale = (values) => {
    const min = Math.min(...values);
    const extent = Math.max(...values) - min;
    return (v) => (extent > 0 ? (v - min) / extent : 0.5);
  };
  const sx = scale(xs);
  const sy = scale(ys);
  const out = {};
  for (const id of ids) out[id] = { x: sx(centers[id].x), y: sy(centers[id].y) };
  return out;
}

/** -1, 0 or 1: where `b` sits relative to `a` along one normalized axis. */
function relation(a, b) {
  const d = b - a;
  if (Math.abs(d) <= LEVEL_TOLERANCE) return 0;
  return d > 0 ? 1 : -1;
}

/**
 * Compare two pictures of one diagram.
 *
 * @param {Record<string,{x:number,y:number}>} mermaid node centers in Mermaid's picture
 * @param {Record<string,{x:number,y:number}>} siren   node centers in Siren's picture
 * @returns {{
 *   mermaidNodes: number, sirenNodes: number, matched: number,
 *   mermaidOnly: string[], sirenOnly: string[],
 *   verticalAgreement: number|null, horizontalAgreement: number|null,
 *   pairs: number, verticalAgreed: number, horizontalAgreed: number,
 *   meanOffset: number|null, maxOffset: number|null,
 *   worst: {id:string, offset:number}[],
 * }}
 * Agreements are `null` with fewer than two matched nodes (there is no
 * pair); offsets are `null` with none. `pairs` and the two `…Agreed` counts
 * are the agreements' numerator and denominator, so a corpus can be pooled
 * (agreeing pairs summed over pairs summed) rather than averaged.
 */
export function compareLayouts(mermaid, siren) {
  const mermaidIds = Object.keys(mermaid);
  const sirenIds = Object.keys(siren);
  const ids = mermaidIds.filter((id) => Object.hasOwn(siren, id));
  const m = normalize(mermaid, ids);
  const s = normalize(siren, ids);

  let pairs = 0;
  let verticalSame = 0;
  let horizontalSame = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      pairs++;
      if (relation(m[a].y, m[b].y) === relation(s[a].y, s[b].y)) verticalSame++;
      if (relation(m[a].x, m[b].x) === relation(s[a].x, s[b].x)) horizontalSame++;
    }
  }

  const offsets = ids.map((id) => ({
    id,
    offset: Math.hypot(m[id].x - s[id].x, m[id].y - s[id].y),
  }));
  const worst = [...offsets].sort((a, b) => b.offset - a.offset).slice(0, WORST_COUNT);

  return {
    mermaidNodes: mermaidIds.length,
    sirenNodes: sirenIds.length,
    matched: ids.length,
    mermaidOnly: mermaidIds.filter((id) => !Object.hasOwn(siren, id)),
    sirenOnly: sirenIds.filter((id) => !Object.hasOwn(mermaid, id)),
    verticalAgreement: pairs > 0 ? verticalSame / pairs : null,
    horizontalAgreement: pairs > 0 ? horizontalSame / pairs : null,
    pairs,
    verticalAgreed: verticalSame,
    horizontalAgreed: horizontalSame,
    meanOffset: ids.length > 0 ? offsets.reduce((sum, o) => sum + o.offset, 0) / ids.length : null,
    maxOffset: ids.length > 0 ? Math.max(...offsets.map((o) => o.offset)) : null,
    worst,
  };
}

/**
 * The px each side draws a node's text at: Mermaid's default 16px, Siren's
 * `--siren-font-size` 14px. A Siren node `SIREN_FONT_SIZE_PX /
 * MERMAID_FONT_SIZE_PX` the size of Mermaid's is the same node drawn
 * smaller, so sizes are compared after scaling Siren's up by the inverse.
 */
export const MERMAID_FONT_SIZE_PX = 16;
export const SIREN_FONT_SIZE_PX = 14;

/**
 * Compare the sizes of the nodes two pictures drew — the measurement the
 * label-wrap board added, since a wrapped label changes a node's box before
 * it changes where the node goes.
 *
 * Each ratio is Siren's over Mermaid's, **normalized for font size**: Siren's
 * box is scaled by 16/14 first, so a node drawn exactly as Mermaid draws it,
 * at Siren's smaller text, reads ×1. The raw ratios (no scaling) are
 * reported beside them. Means are over matched nodes only; positions play
 * no part, so nothing is normalized to the picture.
 *
 * @param {Record<string,{width:number,height:number}>} mermaid node boxes in Mermaid's picture
 * @param {Record<string,{width:number,height:number}>} siren   node boxes in Siren's picture
 * @returns {{
 *   meanWidthRatio: number|null, meanHeightRatio: number|null,
 *   rawMeanWidthRatio: number|null, rawMeanHeightRatio: number|null,
 *   nodes: {id:string, mermaid:{width:number,height:number}, siren:{width:number,height:number}}[],
 * }}
 * `nodes` holds every matched node's two raw boxes, the one furthest from
 * its Mermaid size first: by the larger of its two normalized ratios'
 * distance from 1 on a log scale, so half as wide and twice as wide count
 * alike. Means are `null` with no matched node.
 */
export function compareSizes(mermaid, siren) {
  const ids = Object.keys(mermaid).filter((id) => Object.hasOwn(siren, id));
  const size = ({ width, height }) => ({ width, height });
  const nodes = ids.map((id) => ({ id, mermaid: size(mermaid[id]), siren: size(siren[id]) }));
  const raw = (node, axis) => node.siren[axis] / node.mermaid[axis];
  const normalized = (node, axis) => (raw(node, axis) * MERMAID_FONT_SIZE_PX) / SIREN_FONT_SIZE_PX;
  const distance = (node) =>
    Math.max(Math.abs(Math.log(normalized(node, "width"))), Math.abs(Math.log(normalized(node, "height"))));
  const mean = (ratio, axis) =>
    nodes.length > 0 ? nodes.reduce((sum, node) => sum + ratio(node, axis), 0) / nodes.length : null;
  return {
    meanWidthRatio: mean(normalized, "width"),
    meanHeightRatio: mean(normalized, "height"),
    rawMeanWidthRatio: mean(raw, "width"),
    rawMeanHeightRatio: mean(raw, "height"),
    nodes: [...nodes].sort((a, b) => distance(b) - distance(a)),
  };
}

// ─── Edge metrics ───────────────────────────────────────────────────────────
//
// The functions below read how legible a picture's lines are, from the lines
// alone: each edge is a polyline (`{ points: {x,y}[] }`, sampled along the
// drawn path in the page), each node and each group title a box
// (`{ x, y, width, height }`, **centered** on x,y — the shape `page.mjs`
// already reads node boxes in), all in one picture's own px. Nothing is
// compared across pictures: each side is measured on its own and the report
// prints the two side by side.
//
// Each function's doc says exactly what it counts and why its thresholds
// are what they are, so the method is here, not in a note. Two things are
// deliberately not measured: bends, because a rounded corner sampled along
// its arc reads as several bends where a reader sees one, and time, which
// `--virtual-time-budget` makes meaningless.

/** One SVG number, as a path's `d` writes it: `-1`, `.5`, `2.e-3`, `10`. */
const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const SEP = String.raw`[\s,]*`;
/**
 * An arc command with one parameter set: radii, rotation, the two one-digit
 * flags (which the grammar lets run straight into the next number), and the
 * end point — the end point's two halves captured with the separator between
 * them, so the chord can be written back in the writer's own punctuation.
 */
const ARC = new RegExp(
  `([Aa])${SEP}${NUMBER}${SEP}${NUMBER}${SEP}${NUMBER}${SEP}[01]${SEP}[01]${SEP}(${NUMBER})(${SEP})(${NUMBER})`,
  "g",
);

/**
 * Replace every arc in a path's `d` by a straight line to the arc's end
 * point: `A rx ry rot large sweep x y` becomes `L x y`, and relative `a`
 * becomes `l`.
 *
 * A line jump — the small half-circle one line draws where it crosses
 * another — is an arc, and it exists precisely to mark a crossing; sampled as
 * drawn, it hops over the other line and the crossing would go uncounted.
 * Its chord runs straight through the other line, so the crossing is
 * counted as if no jump were drawn. Any other arc (a rounded corner written
 * as one) loses at most a pixel or two to its chord, which no metric here
 * resolves. An arc command carrying several parameter sets after one letter
 * keeps all but its first; neither renderer writes one.
 *
 * @param {string} d a path's `d` attribute
 * @returns {string}
 */
export function straightenArcs(d) {
  return d.replace(ARC, (_, command, x, sep, y) =>
    `${command === "A" ? "L" : "l"}${x}${sep.includes(",") ? "," : sep.length > 0 ? " " : ""}${y}`,
  );
}

/**
 * Distance from either edge's end within which two edges meeting is not a
 * crossing. Edges leaving or entering one node fan out from points a few px
 * apart on its border, and a curve can cut its neighbour there; that is the
 * node, not a crossing. 14px is under the height of the smallest node
 * either renderer draws, so a real crossing beside a node is still counted.
 */
export const CROSSING_END_ZONE_PX = 14;

/**
 * Hits between one pair of edges closer than this are one crossing. A
 * crossing that lands on a sample point is found by both segments that
 * share it; two nearly tangent curves can touch several times where a reader
 * sees one meeting.
 */
const SAME_CROSSING_PX = 8;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Where segments p1→p2 and p3→p4 meet, or `null`. Ends included, so a
 * crossing that lands on a sample point is not lost between the segment
 * that ends there and the one that starts there. Parallel segments (and
 * collinear ones — two lines sharing a run are overlapping, not crossing)
 * never meet.
 */
function segmentIntersection(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/**
 * How many times two different edges cross, summed over every pair.
 *
 * A meeting within `CROSSING_END_ZONE_PX` of any of the pair's four ends is
 * not counted (a shared endpoint's fan-out), and meetings of one pair closer
 * than a few px to one another count once. An edge never crosses itself —
 * a self-loop's own ends meet by construction.
 *
 * Line jumps must already be straightened (`straightenArcs`) before the
 * edges are sampled, or the crossings they mark are hopped over.
 *
 * @param {{ points: {x:number,y:number}[] }[]} edges
 * @returns {number}
 */
export function countCrossings(edges) {
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i].points;
      const b = edges[j].points;
      const ends = [a[0], a.at(-1), b[0], b.at(-1)];
      const hits = [];
      for (let k = 1; k < a.length; k++) {
        for (let l = 1; l < b.length; l++) {
          const hit = segmentIntersection(a[k - 1], a[k], b[l - 1], b[l]);
          if (hit === null) continue;
          if (ends.some((end) => distance(end, hit) < CROSSING_END_ZONE_PX)) continue;
          if (hits.some((h) => distance(h, hit) < SAME_CROSSING_PX)) continue;
          hits.push(hit);
        }
      }
      crossings += hits.length;
    }
  }
  return crossings;
}

/**
 * How far inside a node's box a line must reach to be drawn across the node
 * rather than along its outline. A line leaving a node's side runs along the
 * neighbouring boxes' borders often enough that a pixel or two of overlap is
 * noise.
 */
export const THROUGH_NODE_MARGIN_PX = 3;

/**
 * Does segment p→q enter `box` shrunk by `margin` on every side? The open
 * inside only: touching the shrunk outline is not entering. Liang–Barsky
 * clipping, so it holds for a segment of any length — the page samples every
 * few px, but nothing here relies on that.
 */
function segmentEntersBox(p, q, box, margin) {
  const left = box.x - box.width / 2 + margin;
  const right = box.x + box.width / 2 - margin;
  const top = box.y - box.height / 2 + margin;
  const bottom = box.y + box.height / 2 - margin;
  if (left >= right || top >= bottom) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [step, room] of [
    [-dx, p.x - left],
    [dx, right - p.x],
    [-dy, p.y - top],
    [dy, bottom - p.y],
  ]) {
    if (step === 0) {
      if (room <= 0) return false;
    } else {
      const t = room / step;
      if (step < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 < t1;
}

/** Does the polyline enter `box` shrunk by `margin`? */
const edgeEntersBox = (points, box, margin) =>
  points.some((p, i) => i > 0 && segmentEntersBox(points[i - 1], p, box, margin));

/** How far `p` is from `box` (0 on or inside it). */
function distanceToBox(p, box) {
  const dx = Math.max(Math.abs(p.x - box.x) - box.width / 2, 0);
  const dy = Math.max(Math.abs(p.y - box.y) - box.height / 2, 0);
  return Math.hypot(dx, dy);
}

/** Index of the node nearest `p`, or -1 with none. */
function nearestNode(p, nodes) {
  let best = -1;
  let bestDistance = Infinity;
  nodes.forEach((box, i) => {
    const d = distanceToBox(p, box);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/**
 * Each edge's two end nodes: the node nearest its first point and the one
 * nearest its last. Read off the geometry rather than the document because
 * the two renderers name an edge's ends differently in their DOM and the
 * picture is what a reader sees. An edge ending on a group's frame is given
 * the nearest node instead, which can be a member it then "passes through";
 * no fixture here has one deep enough inside its group for that to happen.
 */
const endNodes = (edge, nodes) => [nearestNode(edge.points[0], nodes), nearestNode(edge.points.at(-1), nodes)];

/**
 * How many edges are drawn across a node that is neither of their ends —
 * the reader follows the line into a box it does not belong to.
 *
 * A line counts as across a box when it reaches more than
 * `THROUGH_NODE_MARGIN_PX` inside it. Each edge counts once, however many
 * boxes it crosses.
 *
 * @param {{ points: {x:number,y:number}[] }[]} edges
 * @param {{ x:number, y:number, width:number, height:number }[]} nodes centered boxes
 * @returns {number}
 */
export function countThroughNodes(edges, nodes) {
  return edges.filter((edge) => {
    const ends = endNodes(edge, nodes);
    return nodes.some((box, i) => !ends.includes(i) && edgeEntersBox(edge.points, box, THROUGH_NODE_MARGIN_PX));
  }).length;
}

/**
 * How far inside a title's box a line must reach to be drawn across it. A
 * title's box is its text's, tight to the glyphs, so even a pixel over it is
 * a line through the words.
 */
export const THROUGH_TITLE_MARGIN_PX = 1;

/**
 * How many edges are drawn across a group's title — the text of a subgraph,
 * namespace, composite state or ER subgraph block. No title is ever an
 * edge's end, so every edge is checked against every title; each edge counts
 * once.
 *
 * @param {{ points: {x:number,y:number}[] }[]} edges
 * @param {{ x:number, y:number, width:number, height:number }[]} titles centered boxes
 * @returns {number}
 */
export function countThroughTitles(edges, titles) {
  return edges.filter((edge) => titles.some((box) => edgeEntersBox(edge.points, box, THROUGH_TITLE_MARGIN_PX))).length;
}

/**
 * How far past its ends' span a line may go on either axis before it counts
 * as a reversal. Rounded corners, arrowheads' set-back and a port a few px
 * along a node's side all stray a little; a reader notices a line that heads
 * the wrong way and turns back.
 */
export const REVERSAL_OVERSHOOT_PX = 10;

/** Is this edge a self-loop: do both its ends land on one node? */
function isSelfLoop(edge, nodes) {
  const [from, to] = endNodes(edge, nodes);
  return from === to;
}

/**
 * How many edges overshoot and turn back: on either axis, the line reaches
 * more than `REVERSAL_OVERSHOOT_PX` beyond the span between its own two ends
 * (going down past both, then up to the target; running right past the
 * target, then back). A self-loop always leaves its node's span and comes
 * back, so it is never counted.
 *
 * @param {{ points: {x:number,y:number}[] }[]} edges
 * @param {{ x:number, y:number, width:number, height:number }[]} nodes centered boxes
 * @returns {number}
 */
export function countReversals(edges, nodes) {
  return edges.filter((edge) => {
    if (isSelfLoop(edge, nodes)) return false;
    const { points } = edge;
    const start = points[0];
    const end = points.at(-1);
    const overshoot = (axis) => {
      const values = points.map((p) => p[axis]);
      return Math.max(
        Math.min(start[axis], end[axis]) - Math.min(...values),
        Math.max(...values) - Math.max(start[axis], end[axis]),
      );
    };
    return Math.max(overshoot("x"), overshoot("y")) > REVERSAL_OVERSHOOT_PX;
  }).length;
}

/**
 * The mean, over edges, of how much longer the drawn line is than the
 * straight distance between its two ends: ×1 is a straight line, ×1.4 a line
 * 40% longer than it had to be. Self-loops are kept out — their ends are a
 * few px apart however far they travel. The straight distance is floored at
 * 1px, so two ends drawn on top of each other cannot divide by zero.
 *
 * @param {{ points: {x:number,y:number}[] }[]} edges
 * @param {{ x:number, y:number, width:number, height:number }[]} nodes centered boxes
 * @returns {number|null} `null` with no edge that is not a self-loop
 */
export function meanDetour(edges, nodes) {
  const ratios = edges
    .filter((edge) => !isSelfLoop(edge, nodes))
    .map(({ points }) => {
      let length = 0;
      for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
      return length / Math.max(1, distance(points[0], points.at(-1)));
    });
  return ratios.length > 0 ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null;
}

/**
 * Every edge metric of one picture, plus its aspect ratio.
 *
 * @param {{
 *   edges: { points: {x:number,y:number}[] }[],
 *   nodes: { x:number, y:number, width:number, height:number }[],
 *   titles: { x:number, y:number, width:number, height:number }[],
 *   width: number, height: number,
 * }} picture one side's sampled lines, centered node and title boxes, and
 *   the size of everything it drew
 * @returns {{
 *   edges: number, crossings: number, throughNodes: number,
 *   throughTitles: number, reversals: number,
 *   detour: number|null, aspect: number|null,
 * }}
 * `aspect` is width over height — over 1 is wider than tall — and `null` for
 * a picture with no height.
 */
export function measureEdges({ edges, nodes, titles, width, height }) {
  return {
    edges: edges.length,
    crossings: countCrossings(edges),
    throughNodes: countThroughNodes(edges, nodes),
    throughTitles: countThroughTitles(edges, titles),
    reversals: countReversals(edges, nodes),
    detour: meanDetour(edges, nodes),
    aspect: height > 0 ? width / height : null,
  };
}
