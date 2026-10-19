import type {
  Diagnostic,
  ResolvedStyle,
  ResolvedStyleFact,
  StyleDecl,
  StyleFact,
  StyleProperty,
  StyleSource,
} from "../contracts";
import { unsafeStyleValue } from "../unsafeStyleValue";

/**
 * Resolves a document's `style`/`classDef`/apply-directive statements into
 * one entry per styled target, carrying the declarations that target ends
 * up with.
 *
 * Written once and shared by every diagram kind that accepts author
 * styling, for the same reason `resolveTimeline` is: its inputs are
 * kind-agnostic. It takes what the author declared plus the set of ids that
 * actually exist, and reports problems into a diagnostics list. Nothing
 * here looks at a node, a class or a participant — so a flowchart and a
 * class diagram get the identical rules rather than two copies that drift
 * apart one tie-break at a time. Board 2 spent four tickets deleting copies
 * made for exactly that reason.
 *
 * Three statements, two roles. A `classDef` only *defines* a named set of
 * declarations and applies to nothing; an apply-directive applies one to a
 * list of targets; a `style` applies declarations straight to one target.
 * So the `classDef`s are collected first, in a pass of their own — an
 * apply-directive is allowed to name a `classDef` written below it, and the
 * parser deliberately leaves that pairing here.
 *
 * The second pass then walks the document in order and applies what each
 * statement contributes. Application order is what settles a disagreement:
 * a property declared twice for one target keeps the position of its first
 * declaration and takes the value of its last, so a `style` written after
 * an apply-directive overrides the `classDef` it applied. That is the same
 * answer the CSS cascade gives for one element's inline declarations,
 * decided here so the renderer emits a set with no repeats rather than
 * relying on it.
 *
 * Each target's surviving declarations are split by the element they are
 * about: `color` is the author's word for the label text and everything
 * else is about the shape drawn behind it. The split is made here rather
 * than in a renderer because it is a rule about what a declaration
 * *means*, which is this module's subject, and because two renderers that
 * each decided it could disagree — the same reason the validation gate
 * lives here and the renderers re-check nothing.
 *
 * Only targets that end up with at least one declaration appear in the
 * result, so a target whose every declaration was rejected is absent rather
 * than present-and-empty — the renderer's "no styles, no `style` attribute"
 * case, reached without it having to test for an empty list. *
 * **Every `targetId` in the result is one of `validTargetIds`** — a target
 * the document names but nothing declares is dropped here, silently, the
 * way Mermaid drops it. That is a promise callers lean on rather than a
 * detail: `buildFlowchartModel` writes each result straight onto
 * `nodeById.get(targetId)!`, so a result naming an unknown id would crash
 * `render()` with a TypeError instead of returning a diagnostic (found by
 * mutation, 01M37GQS1). `resolveStyles.test.ts` pins it.
 *
 * Each result also keeps its provenance — the classes that reached the
 * target, and the statement each surviving declaration came from — which is
 * what `render()` reports as `SirenRenderResult.styles`. It is worked out
 * in the same pass rather than reconstructed afterwards, so the fact a
 * caller reads cannot follow a cascade other than the one painted.
 *
 * `keepUnstyled` keeps the targets a statement reached but left with no
 * declaration — a class applied whose every declaration was refused — for a
 * caller that lays further tiers over this result: a flowchart edge's
 * classes sit beneath its `linkStyle`s, and the classes it was given are
 * still its classes when only a `linkStyle` paints it.
 */
export function resolveStyleFacts(
  declarations: readonly StyleDecl[],
  validTargetIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  { keepUnstyled = false }: { keepUnstyled?: boolean } = {},
): ResolvedStyleFact[] {
  const definitions = new Map<string, StyleProperty[]>();
  for (const declaration of declarations) {
    if (declaration.styleKind !== "classDef" || declaration.name === null) continue;
    definitions.set(declaration.name, acceptedProperties(declaration, diagnostics));
  }

  /**
   * Each styled target's declarations so far, in first-declared order,
   * already sorted into the halves it will be emitted as.
   *
   * A half is keyed by the property as it will be *written*, so the two
   * never collide: `fill:#111,color:#fff` is one declaration of `fill` in
   * each half rather than one overwriting the other, and a second `color`
   * still replaces the first. A value travels with the statement that
   * wrote it, so replacing one replaces its source too.
   */
  const byTargetId = new Map<string, { classes: string[]; frame: Map<string, Sourced>; text: Map<string, Sourced> }>();

  // Each statement's contribution, worked out in source order so the
  // diagnostics come out in the order the author wrote the lines.
  const appliedBy = new Map<StyleDecl, StyleProperty[]>();
  for (const declaration of declarations) {
    if (declaration.styleKind === "classDef") continue;

    if (declaration.styleKind === "apply") {
      const defined = definitions.get(declaration.name ?? "");
      if (defined === undefined) {
        // Applying a name nothing defines is usually a typo, and a silent
        // one: without this the target is simply not styled, and the author
        // is left comparing two spellings by eye. So it speaks — but as a
        // **warning** (01M39FAVK, decided 2026-10-14). Mermaid 12.2.0
        // accepts it in all four kinds, records the class and paints
        // nothing, so the picture drawn here, the target unstyled, is
        // Mermaid's; an error would cost the whole picture, which is the
        // trade the compatibility condition exists to refuse. The
        // distinction from an unknown *target*, dropped in silence as
        // Mermaid drops it, is kept: the two are different mistakes.
        diagnostics.push({
          severity: "warning",
          message: `${declaration.authoredAs} applies "${declaration.name}", which no classDef defines; dropping the declaration.`,
          line: declaration.line,
          column: declaration.column,
        });
        continue;
      }
      appliedBy.set(declaration, defined);
    } else {
      appliedBy.set(declaration, acceptedProperties(declaration, diagnostics));
    }
  }

  // Then applied in two layers: every class first, every `style` after,
  // each layer in source order (the sort is stable). Measured on mermaid
  // 12.2.0 in flowchart, ER, class and state diagrams, with `:::` as well
  // as `class`: a `style` beats an applied class **whichever is written
  // first** — `style A fill:#0ff` above `class A alpha` still paints
  // `#0ff` (01M39F9N1). Plain source order, which this used to be, drew
  // the class's `fill` instead, with no diagnostic. Within a layer the
  // later statement still wins, and a property keeps the position it was
  // first given, so the class's `stroke` stays after the `fill` it shares.
  const layerOf = (declaration: StyleDecl) => (declaration.styleKind === "style" ? 1 : 0);
  const layered = [...appliedBy.keys()].sort((a, b) => layerOf(a) - layerOf(b));

  for (const declaration of layered) {
    const applied = appliedBy.get(declaration)!;

    for (const targetId of declaration.targetIds) {
      // Naming a target in a styling statement does not declare it, exactly
      // as `note for` and `click` do not: styling is about something that
      // already exists. One unknown target drops itself, not the statement,
      // so the other targets of an `apply` naming "A,Ghost" still get styled.
      //
      // And it drops **silently**, which is the one place this module is
      // deliberately quieter than the rest of its validation. Mermaid
      // accepts the same statement and says nothing — measured in all three
      // kinds that share this module (mermaid 11.17.2, via
      // `scripts/mermaid-probe.mjs`): a flowchart's `class A,Ghost urgent`
      // gives `A` `classes=["urgent"]` and never makes a vertex called
      // `Ghost`; a class diagram's `cssClass "Ghost" urgent` adds no class;
      // a state diagram's `class Ghost urgent` does declare `Ghost`, which
      // is a gap in *that kind's* statement set rather than anything this
      // function can see. So an error here was a divergence Siren invented,
      // and the author who deleted a node but left its `class` line behind
      // was being told their legal document is broken.
      //
      // Not a warning either, and that is a deliberate trade rather than an
      // oversight. `compat/corpus.ts` fails a `supported` row on *any*
      // diagnostic, because "parsed quietly" is what a silent mis-render
      // looks like — so a warning would leave this construct with no row
      // able to record it, unmeasured, which costs more than the hint it
      // buys. `CONTEXT.md`'s licence to out-diagnose Mermaid is bounded by
      // Mermaid drawing a picture that *contradicts* the document, and
      // there is no contradiction here: the author asked for a class on
      // something that does not exist, and nothing was drawn wrong because
      // nothing was drawn.
      if (!validTargetIds.has(targetId)) continue;

      let halves = byTargetId.get(targetId);
      if (halves === undefined) {
        halves = { classes: [], frame: new Map<string, Sourced>(), text: new Map<string, Sourced>() };
        byTargetId.set(targetId, halves);
      }
      if (declaration.name !== null && !halves.classes.includes(declaration.name)) {
        halves.classes.push(declaration.name);
      }
      const source = sourceOf(declaration);
      for (const accepted of applied) {
        const asText = asTextDeclaration(accepted);
        if (asText === null) {
          halves.frame.set(accepted.property, { value: accepted.value, source });
        } else {
          halves.text.set(asText.property, { value: asText.value, source });
        }
      }
    }
  }

  return [...byTargetId]
    .filter(([, { frame, text }]) => keepUnstyled || frame.size + text.size > 0)
    .map(([targetId, { classes, frame, text }]) => ({
      targetId,
      style: { frame: asProperties(frame), text: asProperties(text) },
      classes,
      sources: { frame: [...frame.values()].map(({ source }) => source), text: [...text.values()].map(({ source }) => source) },
    }));
}

/**
 * `resolveStyleFacts` without the provenance: the declarations each styled
 * target is painted with, which is all a model's `styles` carries. The
 * rules, and the promise that every `targetId` is one of `validTargetIds`,
 * are that function's.
 */
export function resolveStyles(
  declarations: readonly StyleDecl[],
  validTargetIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): ResolvedStyle[] {
  return resolveStyleFacts(declarations, validTargetIds, diagnostics).map(({ targetId, style }) => ({ targetId, style }));
}

/**
 * One resolved target as the fact `render()` reports, once its caller has
 * said what kind of target it is — the one thing this module cannot know.
 */
export function asStyleFact(
  { targetId, style, classes, sources }: ResolvedStyleFact,
  kind: StyleFact["kind"],
): StyleFact {
  return { id: targetId, kind, classes, effective: style, sources };
}

/** One surviving declaration's value, and the statement that wrote it. */
interface Sourced {
  value: string;
  source: StyleSource;
}

/**
 * The statement a declaration is reported as coming from: the `classDef` an
 * apply-directive applied, by name, or the `style` itself. A `linkStyle`
 * arrives here as a `style` and is told apart by the caller, which alone
 * knows which of its tiers it was.
 */
function sourceOf(declaration: StyleDecl): StyleSource {
  if (declaration.styleKind !== "apply") return { via: "style" };
  // Every parser names the class an apply-directive applies; one that names
  // none is a broken contract, and reporting it as a class called "" would
  // hand a caller a fact nobody wrote.
  if (declaration.name === null) {
    throw new Error(`${declaration.authoredAs} at line ${declaration.line} names no class to apply.`);
  }
  return { via: "classDef", name: declaration.name };
}

/**
 * The label-text declaration one accepted declaration becomes, or `null`
 * when it stays on the frame.
 *
 * `color` in, `fill` out, and that translation is the whole of this
 * function. An author writes `color` because that is what Mermaid's
 * `classDef` documents, but SVG paints a `<text>` with `fill`: an inline
 * `color:#fff` on a `<text>` leaves its computed `fill` exactly where the
 * theme put it, so emitting the author's spelling verbatim would move the
 * bug one element over rather than fix it. Normalizing the spelling once,
 * here, is the same move `TD` → `TB` and `linkStyle 0` → an edge id make;
 * nothing downstream has to know the word `color` exists.
 *
 * Matched case-insensitively, because CSS property names are, and because
 * `strokeOf` in the flowchart renderer already reads them that way.
 *
 * `color` is the only text property, deliberately. `font-size` and its
 * neighbours are genuine text properties Mermaid accepts, but
 * `layoutClassDiagram` *measures* text to size the box drawn around it, so
 * an author changing the font here would desynchronize the drawn text from
 * the box computed for it. That is a layout question, and it is not this
 * one. `stroke` is the frame's border everywhere else in this codebase and
 * stays so here.
 */
function asTextDeclaration({ property, value }: StyleProperty): StyleProperty | null {
  return property.toLowerCase() === "color" ? { property: "fill", value } : null;
}

/** One half's accumulated declarations, back as the list a renderer emits. */
function asProperties(half: ReadonlyMap<string, Sourced>): StyleProperty[] {
  return [...half].map(([property, { value }]) => ({ property, value }));
}

/**
 * What a style property may be spelled as: a plain CSS identifier, with the
 * leading `-`/`--` a vendor prefix or a custom property needs.
 *
 * Anything else is refused rather than escaped. The parser splits a
 * declaration on its first `:`, so a property is whatever text preceded it —
 * `a;b` in `style Shape a;b:red` — and a name carrying a `;` or a `{` is not
 * a property an author meant to write, it is a second declaration trying to
 * ride along inside the first.
 */
const CSS_PROPERTY_RE = /^-{0,2}[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Filters one statement's declarations down to the ones that may be
 * emitted, diagnosing each rejection at the statement that wrote it.
 *
 * **This is the board's security boundary for styling.** These declarations
 * become an inline `style` attribute on a rendered element, so whatever
 * survives here is whatever the browser is asked to do.
 *
 * A rejection takes the declaration, never the statement: the other
 * declarations of a `style Shape fill:url(#evil),stroke:#c00` still apply.
 * And a rejection is reported where the value is *written* — so a bad
 * `classDef` is reported once, at the `classDef`, rather than once per class
 * that applies it, because that is the line the author has to edit.
 */
function acceptedProperties(
  declaration: StyleDecl,
  diagnostics: Diagnostic[],
): StyleProperty[] {
  const accepted: StyleProperty[] = [];

  for (const property of declaration.properties) {
    const problem = rejectStyleProperty(property);
    if (problem !== null) {
      diagnostics.push({
        severity: "error",
        message: problem,
        line: declaration.line,
        column: declaration.column,
      });
      continue;
    }
    accepted.push(property);
  }

  return accepted;
}

/**
 * The reason one declaration may not be emitted, or `null` when it may.
 */
function rejectStyleProperty({ property, value }: StyleProperty): string | null {
  if (!CSS_PROPERTY_RE.test(property)) {
    return `Style property "${property}" is not a plain CSS identifier; dropping the declaration.`;
  }

  // The value half is the rule a label's style values are held to as well,
  // written once in `unsafeStyleValue` — read it for why each is refused.
  const unsafe = unsafeStyleValue(value);
  switch (unsafe?.kind) {
    case "function":
      return `Style value for "${property}" uses "${unsafe.name}", which ${unsafe.why}; dropping the declaration.`;
    case "semicolon":
      return `Style value for "${property}" contains ";", which would smuggle in a second declaration; dropping the declaration.`;
    case "backslash":
      return `Style value for "${property}" contains "\\", which can spell a rejected function as a CSS escape; dropping the declaration.`;
    case "character":
      return `Style value for "${property}" contains "${unsafe.character}", which no colour, length, keyword or quoted name is written with; dropping the declaration.`;
  }

  return null;
}
