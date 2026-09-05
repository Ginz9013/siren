import type { Diagnostic, ResolvedStyle, StyleDecl, StyleProperty } from "../contracts";

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
 * Only targets that end up with at least one declaration appear in the
 * result, so a target whose every declaration was rejected is absent rather
 * than present-and-empty — the renderer's "no styles, no `style` attribute"
 * case, reached without it having to test for an empty list.
 */
export function resolveStyles(
  declarations: readonly StyleDecl[],
  validTargetIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): ResolvedStyle[] {
  const definitions = new Map<string, StyleProperty[]>();
  for (const declaration of declarations) {
    if (declaration.styleKind !== "classDef" || declaration.name === null) continue;
    definitions.set(declaration.name, acceptedProperties(declaration, diagnostics));
  }

  /** Each styled target's declarations so far, in first-declared order. */
  const byTargetId = new Map<string, Map<string, string>>();

  for (const declaration of declarations) {
    if (declaration.styleKind === "classDef") continue;

    let applied: StyleProperty[];
    if (declaration.styleKind === "apply") {
      const defined = definitions.get(declaration.name ?? "");
      if (defined === undefined) {
        // Applying a name nothing defines is a typo, and a silent one:
        // without this the target is simply not styled, and the author is
        // left comparing two spellings by eye.
        diagnostics.push({
          severity: "error",
          message: `${declaration.authoredAs} applies "${declaration.name}", which no classDef defines; dropping the declaration.`,
          line: declaration.line,
          column: declaration.column,
        });
        continue;
      }
      applied = defined;
    } else {
      applied = acceptedProperties(declaration, diagnostics);
    }

    for (const targetId of declaration.classIds) {
      // Naming a target in a styling statement does not declare it, exactly
      // as `note for` and `click` do not: styling is about something that
      // already exists. One unknown target drops itself, not the statement,
      // so the other targets of an `apply` naming "A,Ghost" still get styled.
      if (!validTargetIds.has(targetId)) {
        diagnostics.push({
          severity: "error",
          message: `${declaration.authoredAs} "${targetId}" references a class that does not exist; dropping the declaration.`,
          line: declaration.line,
          column: declaration.column,
        });
        continue;
      }

      let properties = byTargetId.get(targetId);
      if (properties === undefined) {
        properties = new Map<string, string>();
        byTargetId.set(targetId, properties);
      }
      for (const { property, value } of applied) {
        properties.set(property, value);
      }
    }
  }

  return [...byTargetId]
    .filter(([, properties]) => properties.size > 0)
    .map(([targetId, properties]) => ({
      targetId,
      properties: [...properties].map(([property, value]) => ({ property, value })),
    }));
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
 * The CSS functions an author's style value may not use, with why.
 *
 * `url(` fetches: it turns a diagram into a beacon that reports every reader
 * to whoever wrote the document, and in some contexts loads code.
 * `expression(` is legacy IE and executes script outright. Both are matched
 * case-insensitively and with optional space before the paren — the value is
 * refused, not sanitized, so being broader than the CSS grammar costs a
 * diagnostic on an unusable declaration and nothing else.
 *
 * A deliberately short list. It is not "every way CSS can fetch" — the
 * board named these two — so a future value-bearing sink (`image-set(`,
 * `-moz-binding`) belongs here, and this is the one place to add it. Note
 * that these patterns match *text*: an author can spell any of them with a
 * CSS escape, which is why `rejectStyleProperty` refuses a value carrying a
 * backslash before it can reach one of these names in disguise.
 */
const REJECTED_VALUE_FUNCTIONS: { pattern: RegExp; name: string; why: string }[] = [
  { pattern: /url\s*\(/i, name: "url(", why: "can fetch a remote resource" },
  { pattern: /expression\s*\(/i, name: "expression(", why: "can execute script" },
];

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

  for (const rejected of REJECTED_VALUE_FUNCTIONS) {
    if (rejected.pattern.test(value)) {
      return `Style value for "${property}" uses "${rejected.name}", which ${rejected.why}; dropping the declaration.`;
    }
  }

  // A value is one declaration's worth of CSS. A `;` inside it can only be
  // an attempt at a second one — the parser splits on the first `:`, so
  // `fill:#fdd;position:fixed` arrives here as a single value. Whether it
  // would actually smuggle depends on how the renderer serializes the
  // attribute; refusing it here means the answer does not matter.
  if (value.includes(";")) {
    return `Style value for "${property}" contains ";", which would smuggle in a second declaration; dropping the declaration.`;
  }

  // A `\` is refused outright, because the list above matches literal text
  // and literal text is not what CSS reads: `\75 rl(...)`, `u\72 l(...)` and
  // `\65 xpression(...)` are `url(` and `expression(` by the time a browser
  // has resolved the escapes, and each one walked straight past the list.
  //
  // The alternative — resolving escapes here and matching the result — means
  // owning a piece of the CSS tokenizer (hex escapes with an optional
  // trailing space, `\0` becoming U+FFFD, escapes inside strings versus
  // idents), and every corner of it got subtly wrong reopens exactly this
  // hole. Refusing is cruder, and it is the option whose failure mode is a
  // diagnostic rather than a bypass: no value this stage exists to emit —
  // colors, lengths, keywords, `rgb()`, `color-mix()` — contains a
  // backslash, so nothing legitimate is lost by not spending that
  // complexity here.
  if (value.includes("\\")) {
    return `Style value for "${property}" contains "\\", which can spell a rejected function as a CSS escape; dropping the declaration.`;
  }

  return null;
}
