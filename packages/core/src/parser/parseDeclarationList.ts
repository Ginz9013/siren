import type { StyleProperty } from "../contracts";

/**
 * Splits a declaration list on the commas that separate declarations,
 * ignoring the ones inside a value's parentheses. Only a comma at paren
 * depth 0 is a separator, so `fill:rgb(255, 0, 0)` stays one declaration
 * rather than becoming three fragments, two of which have no `:` and would
 * be diagnosed as malformed.
 *
 * An unbalanced parenthesis is treated as a problem with that value, never
 * with the list: an unclosed `(` runs to the end of the list, keeping the
 * text inside one value rather than dropping it, and a stray `)` is
 * ignored — the depth floor is 0 — so the declarations after it still
 * separate normally. Whether such a value is usable is `resolveStyles`'
 * judgement, as it is for every other value here.
 */
function splitDeclarations(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      segments.push(text.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(text.slice(start));
  return segments;
}

/**
 * Splits a `fill:#fdd,stroke:#c00` declaration list into its pairs,
 * preserving author order. Only the first `:` of a segment separates
 * property from value, so a value containing a colon survives intact.
 *
 * A segment with no `:` at all has no readable shape, so it is returned in
 * `malformed` for the caller to diagnose. Both callers spell that
 * diagnostic `Unrecognized style declaration: "<segment>"` on the
 * statement's own line; the split is shared, the sentence is not, because
 * only the caller knows where the statement sits.
 *
 * The values themselves are not inspected here. Rejecting `url(` and
 * `expression(` is `resolveStyles`' job, and it is the only place that
 * judgement is made — ADR-0008 calls that gate the styling security
 * boundary, and a second opinion in a parser is how one boundary becomes
 * two that disagree.
 *
 * This module exists because every diagram kind's `style`, `classDef` and
 * apply-directive read the same declaration list. `parseFlowchart` and
 * `parseClassDiagram` held a copy each — byte-identical bodies, which is
 * the state just before they stop being identical.
 */
export function parseStyleProperties(text: string): {
  properties: StyleProperty[];
  malformed: string[];
} {
  const properties: StyleProperty[] = [];
  const malformed: string[] = [];
  for (const segment of splitDeclarations(text)) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      malformed.push(trimmed);
      continue;
    }
    properties.push({
      property: trimmed.slice(0, separator).trim(),
      value: trimmed.slice(separator + 1).trim(),
    });
  }
  return { properties, malformed };
}
