import type { AuthorStyle, ResolvedStyle } from "../contracts";

/**
 * What a model builder strikes when its caller omits nothing — the default
 * every builder's `omitted` takes, so a builder called without one (as its
 * own tests call it) writes each target's style as the author wrote it.
 */
export const NOTHING_OMITTED: ReadonlySet<string> = new Set();

/**
 * The names a caller passed as `RenderOptions.omitAuthorStyles`, lower-cased
 * — CSS matches property names case-insensitively — and empty when it passed
 * none.
 */
export function omittedStyleNames(names: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((names ?? []).map((name) => name.toLowerCase()));
}

/**
 * `style` with each declaration a caller named in
 * `RenderOptions.omitAuthorStyles` struck out.
 *
 * Only the model builders apply it, to the `style` they write onto a target.
 * A target's style fact is always taken from the unstruck style — the
 * resolver's answer, or for a flowchart edge the style its tiers built — and
 * the target's `style` is the struck one, so a fact states what the author
 * wrote whatever was omitted. No layout module or renderer knows a property
 * can be omitted: a renderer simply never sees the declaration, and an edge
 * with no `stroke` left takes the theme's arrowhead as an edge never given
 * one does. A new object rather than an edit, since a fact may share this
 * one and must keep what was written.
 *
 * The list is in the author's spelling and the text half in SVG's: the
 * model holds an author's `color` as the `fill` a `<text>` is painted with
 * (see `AuthorStyle.text`), so that `fill` is matched as `color`.
 */
export function withoutOmitted(style: AuthorStyle, omitted: ReadonlySet<string>): AuthorStyle {
  return {
    frame: style.frame.filter(({ property }) => !omitted.has(property.toLowerCase())),
    text: style.text.filter(({ property }) => {
      const name = property.toLowerCase();
      return !omitted.has(name === "fill" ? "color" : name);
    }),
  };
}

/**
 * Writes each resolved target's style, with the omitted declarations struck
 * (`withoutOmitted`), onto the model item `targetOf` finds for its id.
 *
 * One helper rather than a loop in each builder, so the promise is stated
 * once: every target the resolver answered for gets the struck style, and a
 * target it did not answer for keeps no `style` at all. The caller takes its
 * style facts from `resolved` itself, which this leaves as written.
 *
 * A miss throws, naming the id: the resolver only returns ids it was handed
 * (see `resolveStyleFacts`), so a lookup that finds nothing is a builder
 * whose lookup disagrees with the ids it handed over — a programming error,
 * refused by name the way `placeConnectors` refuses a missing route, rather
 * than a style silently dropped or a TypeError with no id in it.
 */
export function writeAuthorStyles(
  resolved: readonly ResolvedStyle[],
  targetOf: (id: string) => { style?: AuthorStyle } | undefined,
  omitted: ReadonlySet<string>,
): void {
  for (const { targetId, style } of resolved) {
    const target = targetOf(targetId);
    if (target === undefined) {
      throw new Error(`writeAuthorStyles: no target for style ${targetId}`);
    }
    target.style = withoutOmitted(style, omitted);
  }
}
