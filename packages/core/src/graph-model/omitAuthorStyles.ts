import type { AuthorStyle } from "../contracts";

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
 * Only the model builders apply it, each as it writes a target's `style` and
 * after that target's style fact was taken — which is why the facts state
 * what the author wrote whatever is omitted — so no layout module or
 * renderer knows a property can be omitted: a renderer simply never sees the
 * declaration, and an edge with no `stroke` left takes the theme's arrowhead
 * as an edge never given one does. A new object rather than an edit, since a
 * fact may share this one and must keep what was written.
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
