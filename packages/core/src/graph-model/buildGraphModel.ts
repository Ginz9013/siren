import type { GraphModelResult, SirenDocument } from "../contracts";
import { buildClassModel } from "./buildClassModel";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { buildSequenceModel } from "./buildSequenceModel";
import { buildStateModel } from "./buildStateModel";

/**
 * Resolves a parsed `SirenDocument` into a validated model, dispatching on
 * `document.kind`: `buildFlowchartModel` for a `"flowchart"` document,
 * `buildSequenceModel` for a `"sequence"` one, `buildClassModel` for a
 * `"class"` one and `buildStateModel` for a `"state"` one.
 *
 * The document's kind travels out on the result as its tag, so a caller that
 * narrows on it is holding that kind's model — see `GraphModelResult`. This
 * function decides nothing the document did not already say: every
 * sub-builder's result type promises a model, so there is no failure to fold
 * here and no check written for a state the types say cannot happen.
 *
 * `diagnostics` is orthogonal to that promise. A sub-builder that took
 * exception to part of its document reports it here — at error severity when
 * it dropped something — and still hands back the model it built from the
 * rest.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  if (document.kind === "state") {
    const { model, diagnostics } = buildStateModel(document);
    return { kind: "state", model, diagnostics };
  }

  if (document.kind === "class") {
    const { model, diagnostics } = buildClassModel(document);
    return { kind: "class", model, diagnostics };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { kind: "sequence", model, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { kind: "flowchart", model: graph, diagnostics };
}
