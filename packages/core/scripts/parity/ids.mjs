/**
 * Node identity across the two pictures.
 *
 * Siren puts the authored id on each node's group verbatim, as
 * `data-siren-id`. Mermaid 11.17.2 does not; it writes a DOM id of the shape
 * `<renderId>-<kind>-<authoredId>-<counter>`, measured in headless Chrome:
 *
 * | Diagram    | Node group                      | Example                   |
 * |------------|---------------------------------|---------------------------|
 * | flowchart  | `g.node`                        | `pm0-flowchart-A-0`       |
 * | state      | `g.node` (composites are        | `pm1-state-Idle-1`,       |
 * |            | `g.statediagram-cluster`)       | `pm1-state-root_start-0`  |
 * | ER         | `g.node`                        | `pm2-entity-CUSTOMER-0`   |
 *
 * `<renderId>` is the id passed to `mermaid.render`. `<counter>` is always
 * the trailing run of digits, so an authored id that itself contains dashes
 * and digits is everything between the kind and that last `-<digits>`.
 *
 * Pseudo-states do not line up: Mermaid names a top-level `[*]` start
 * `root_start`, Siren names it `start:1`. They stay unmatched rather than
 * being mapped by a guess at the numbering on both sides.
 *
 * This module runs in the parity page as well as under `node --test`, so it
 * has no imports.
 */
const NODE_ID = /^(?:flowchart|state|entity)-(.+)-\d+$/;

/**
 * The authored node id inside a Mermaid node group's DOM id, or `null` when
 * the id is not one of that render's node groups.
 *
 * @param {string} domId
 * @param {string} renderId the id passed to `mermaid.render`
 * @returns {string|null}
 */
export function mermaidNodeId(domId, renderId) {
  const prefix = `${renderId}-`;
  if (!domId.startsWith(prefix)) return null;
  const match = NODE_ID.exec(domId.slice(prefix.length));
  return match ? match[1] : null;
}
