import type { ErDocument, ErModelResult, ResolvedErEntity } from "../contracts";

/**
 * Resolves a parsed `ErDocument` into an `ErModel`: the entities, each named
 * once, in the order they were first named.
 *
 * **De-duplication is the whole of this stage's work today, and it is a
 * measured rule rather than tidiness.** Mermaid keys its entity table on the
 * name the author wrote, so `CUSTOMER / ORDER / CUSTOMER` reports two
 * entities with `CUSTOMER` still first (measured, mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`) — and it says nothing about the repeat, so
 * neither does this. Drawing the second box would give two elements one
 * `data-siren-id`, which makes a `timeline:` entry naming it ambiguous
 * (ADR-0009).
 *
 * `diagnostics` is empty for every document that reaches here, and the
 * result type still carries it: the shape every builder in this directory
 * has, so `buildGraphModel` folds all five the same way. `model` is
 * non-nullable for the reason `GraphModelResult` records — there is no
 * failure path here, and a nullable payload would be a state no caller can
 * reach.
 */
export function buildErModel(document: ErDocument): ErModelResult {
  const byId = new Map<string, ResolvedErEntity>();
  for (const entity of document.entities) {
    if (!byId.has(entity.name)) {
      // The name is both halves: it is what Mermaid's table is keyed on and
      // what it reports as the entity's `label`. They part company when an
      // alias lands — see `ResolvedErEntity`.
      byId.set(entity.name, { id: entity.name, label: entity.name });
    }
  }

  return {
    model: {
      entities: [...byId.values()],
      // Empty because this kind reads no `timeline:` block yet, and present
      // because `render()` builds a controller for every kind — see
      // `ErModel.timeline`.
      timeline: { totalSteps: 0, entries: [] },
    },
    diagnostics: [],
  };
}
