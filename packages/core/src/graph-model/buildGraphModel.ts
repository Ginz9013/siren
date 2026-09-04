import type { GraphModelResult, SirenDocument } from "../contracts";
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
    // Placeholder branch: `parseSiren` can already produce a class document,
    // so this file must handle the kind for the package to type-check at all.
    // The real `buildClassModel` call lands with the ticket that writes it —
    // until then a class document resolves to an empty result rather than
    // reaching `buildFlowchartModel`, which would crash on its missing
    // `nodes`/`edges`.
    //
    // The diagnostic is what keeps that honest: without it `render()` returns
    // a null SVG and an empty diagnostics array, so an author whose document
    // is perfectly valid gets nothing at all and no reason why. Diagnostics
    // are this codebase's channel for "we understood you, but here is the
    // problem" — silence is not.
    return {
      graph: null,
      model: null,
      classModel: null,
      diagnostics: [
        {
          severity: "error",
          message:
            "Class diagrams parse but are not renderable yet — support is still being built.",
        },
      ],
    };
  }

  if (document.kind === "sequence") {
    const { model, diagnostics } = buildSequenceModel(document);
    return { graph: null, model, classModel: null, diagnostics };
  }

  const { graph, diagnostics } = buildFlowchartModel(document);
  return { graph, model: null, classModel: null, diagnostics };
}
