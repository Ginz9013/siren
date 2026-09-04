import type { GraphModelResult, SirenDocument } from "../contracts";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { buildSequenceModel } from "./buildSequenceModel";

/**
 * Resolves a parsed `SirenDocument` into a validated graph or sequence
 * model, dispatching on `document.kind`: a `"flowchart"` document resolves
 * through `buildFlowchartModel` (existing logic, extracted verbatim — zero
 * behavior change) into `graph`; a `"sequence"` document resolves through
 * `buildSequenceModel` into `model`. Exactly one of `graph`/`model` is
 * non-null in the result.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { graph: null, model, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { graph, model: null, diagnostics };
}
