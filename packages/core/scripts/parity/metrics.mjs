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
 */

/** Normalized distance under which two centers count as level on an axis. */
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
 *   meanOffset: number|null, maxOffset: number|null,
 *   worst: {id:string, offset:number}[],
 * }}
 * Agreements are `null` with fewer than two matched nodes (there is no
 * pair); offsets are `null` with none.
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
    meanOffset: ids.length > 0 ? offsets.reduce((sum, o) => sum + o.offset, 0) / ids.length : null,
    maxOffset: ids.length > 0 ? Math.max(...offsets.map((o) => o.offset)) : null,
    worst,
  };
}
