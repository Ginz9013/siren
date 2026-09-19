import type { GraphModelResult, SirenDocument } from "../contracts";
import { buildClassModel } from "./buildClassModel";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { buildSequenceModel } from "./buildSequenceModel";
import { buildStateModel } from "./buildStateModel";

/**
 * Resolves a parsed `SirenDocument` into a validated model, dispatching on
 * `document.kind`: a `"flowchart"` document resolves through
 * `buildFlowchartModel` into `graph`, a `"sequence"` document through
 * `buildSequenceModel` into `model`, a `"class"` document through
 * `buildClassModel` into `classModel`, and a `"state"` document through
 * `buildStateModel` into `stateModel`. At most one of the four is non-null;
 * a document that fails to resolve returns all four null alongside an
 * error-severity diagnostic.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  if (document.kind === "state") {
    const { model, diagnostics } = buildStateModel(document);
    return { graph: null, model: null, classModel: null, stateModel: model, diagnostics };
  }

  if (document.kind === "class") {
    const { model, diagnostics } = buildClassModel(document);
    return { graph: null, model: null, classModel: model, stateModel: null, diagnostics };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { graph: null, model, classModel: null, stateModel: null, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { graph, model: null, classModel: null, stateModel: null, diagnostics };
}
