import type { GraphModelResult, SirenDocument } from "../contracts";
import { buildClassModel } from "./buildClassModel";
import { buildErModel } from "./buildErModel";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { omittedStyleNames } from "./omitAuthorStyles";
import { buildSequenceModel } from "./buildSequenceModel";
import { buildStateModel } from "./buildStateModel";

/** What `buildGraphModel` takes besides the document. */
export interface BuildGraphModelOptions {
  /**
   * The author style properties to leave off every target's `style`, on the
   * terms of `RenderOptions.omitAuthorStyles` — each model builder strikes
   * them after taking its style facts, so the facts still state what the
   * author wrote.
   */
  omitAuthorStyles?: readonly string[];
}

/**
 * Resolves a parsed `SirenDocument` into a validated model, dispatching on
 * `document.kind`: `buildFlowchartModel` for a `"flowchart"` document,
 * `buildSequenceModel` for a `"sequence"` one, `buildClassModel` for a
 * `"class"` one, `buildStateModel` for a `"state"` one and `buildErModel`
 * for an `"er"` one.
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
export function buildGraphModel(document: SirenDocument, options: BuildGraphModelOptions = {}): GraphModelResult {
  const omitted = omittedStyleNames(options.omitAuthorStyles);

  if (document.kind === "er") {
    const { model, diagnostics } = buildErModel(document, omitted);
    return { kind: "er", model, diagnostics };
  }

  if (document.kind === "state") {
    const { model, diagnostics } = buildStateModel(document, omitted);
    return { kind: "state", model, diagnostics };
  }

  if (document.kind === "class") {
    const { model, diagnostics } = buildClassModel(document, omitted);
    return { kind: "class", model, diagnostics };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { kind: "sequence", model, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document, omitted);
  return { kind: "flowchart", model: graph, diagnostics };
}
