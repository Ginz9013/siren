import type { GraphModelResult, SirenDocument } from "../contracts";
import { buildClassModel } from "./buildClassModel";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { buildSequenceModel } from "./buildSequenceModel";

/**
 * Resolves a parsed `SirenDocument` into a validated model, dispatching on
 * `document.kind`: a `"flowchart"` document resolves through
 * `buildFlowchartModel` into `graph`, a `"sequence"` document through
 * `buildSequenceModel` into `model`, and a `"class"` document through
 * `buildClassModel` into `classModel`. At most one of the three is non-null;
 * a document that fails to resolve returns all three null alongside an
 * error-severity diagnostic.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  if (document.kind === "class") {
    const { model, diagnostics } = buildClassModel(document);
    return { graph: null, model: null, classModel: model, diagnostics };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { graph: null, model, classModel: null, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { graph, model: null, classModel: null, diagnostics };
}
