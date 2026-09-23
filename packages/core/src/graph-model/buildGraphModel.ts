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
 * narrows on it is holding that kind's model and not a field that may still
 * be null — see `GraphModelResult`. The one thing this function decides that
 * the document did not already say is `"failed"`: a sub-builder answering
 * with no model becomes that tag, which is where the error-severity
 * diagnostic explaining why is carried.
 *
 * `buildFlowchartModel` is the one sub-builder whose result type promises a
 * model, so the flowchart arm has no failure to fold — and no check is
 * written for a state the type says cannot happen.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  if (document.kind === "state") {
    const { model, diagnostics } = buildStateModel(document);
    return model === null ? { kind: "failed", diagnostics } : { kind: "state", model, diagnostics };
  }

  if (document.kind === "class") {
    const { model, diagnostics } = buildClassModel(document);
    return model === null ? { kind: "failed", diagnostics } : { kind: "class", model, diagnostics };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return model === null
      ? { kind: "failed", diagnostics }
      : { kind: "sequence", model, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { kind: "flowchart", model: graph, diagnostics };
}
