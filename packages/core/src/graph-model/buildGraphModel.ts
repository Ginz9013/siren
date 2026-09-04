import type { GraphModelResult, SirenDocument } from "../contracts";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { buildSequenceModel } from "./buildSequenceModel";

/**
 * Resolves a parsed `SirenDocument` into a validated model, dispatching on
 * `document.kind`: a `"flowchart"` document resolves through
 * `buildFlowchartModel` into `graph`, a `"sequence"` document through
 * `buildSequenceModel` into `model`, and a `"class"` document through
 * `buildClassModel` into `classModel`. Exactly one of the three is non-null
 * in the result.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  if (document.kind === "class") {
    // Placeholder branch: `parseSiren` can already produce a class document,
    // so this file must handle the kind for the package to type-check at all.
    // The real `buildClassModel` call lands with the ticket that writes it —
    // until then a class document resolves to an empty result rather than
    // reaching `buildFlowchartModel`, which would crash on its missing
    // `nodes`/`edges`.
    return { graph: null, model: null, classModel: null, diagnostics: [] };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { graph: null, model, classModel: null, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { graph, model: null, classModel: null, diagnostics };
}
