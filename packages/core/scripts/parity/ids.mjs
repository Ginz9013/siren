/**
 * Node identity across the two pictures.
 *
 * Siren puts the authored id on each node's group verbatim, as
 * `data-siren-id`. Mermaid 12.2.0 does not; it writes a DOM id of the shape
 * `<renderId>-<kind>-<authoredId>-<counter>`. The flowchart, state and ER
 * shapes were measured in headless Chrome on Mermaid 11.17.2 and re-checked
 * against 12.2.0's dist (`chunks/mermaid.esm/`); the class shape was measured
 * on 12.2.0:
 *
 * | Diagram    | Node group                      | Example                   |
 * |------------|---------------------------------|---------------------------|
 * | flowchart  | `g.node`                        | `pm0-flowchart-A-0`       |
 * | state      | `g.node` (composites are        | `pm1-state-Idle-1`,       |
 * |            | `g.statediagram-cluster`)       | `pm1-state-root_start-0`  |
 * | ER         | `g.node`                        | `pm2-entity-CUSTOMER-0`   |
 * | class      | `g.node`                        | `pm0-classId-Shape-0`     |
 *
 * In 12.2.0 the prefixes come from `chunk-LJKG65JO.mjs` line 59
 * (`"flowchart-"`), `stateDiagram-v2-MYRXERYP.mjs` line 1022 (`stateDomId`),
 * `erDiagram-VZDIDQZ7.mjs` line 1080 (`entity-${name}-${size}`) and
 * `classDiagram-v2-K6ZTA64I.mjs` line 1305 (`ClassDB.addClass`, which mints
 * `"classId-" + name + "-" + counter`).
 *
 * `<renderId>` is the id passed to `mermaid.render`. `<counter>` is always
 * the trailing run of digits, so an authored id that itself contains dashes
 * and digits is everything between the kind and that last `-<digits>`.
 *
 * Pseudo-states do not line up: Mermaid names a top-level `[*]` start
 * `root_start`, Siren names it `start:1`. They stay unmatched rather than
 * being mapped by a guess at the numbering on both sides. A class note
 * (`pm0-note0`) is left unmatched the same way: Siren names it `note:1`.
 *
 * This module runs in the parity page as well as under `node --test`, so it
 * has no imports.
 */
const NODE_ID = /^(?:flowchart|state|entity|classId)-(.+)-\d+$/;

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
