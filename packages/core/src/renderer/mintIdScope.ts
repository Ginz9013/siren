/**
 * Mints the token every id in one rendered SVG is namespaced by.
 *
 * The hazard it answers: an SVG `<marker>` is referenced as `url(#id)`, and
 * that reference resolves against the whole **document**, never against the
 * SVG it is written in. A fixed id therefore means the *first* matching
 * marker on the page wins, so two Siren diagrams on one page would draw the
 * first diagram's arrowheads on both. ADR-0008 rejected a generated `<style>`
 * block partly over this same global namespace ("two Siren diagrams on one
 * page would have to coordinate their generated names"); the answer here is
 * to need no coordination at all, by giving each render a name space nobody
 * else draws from.
 *
 * A random token rather than a counter, deliberately. A module-level counter
 * is only unique per *module instance*: two copies of `siren-core` on one
 * page — an ordinary outcome of a dependency tree, and of a dual ESM/CJS
 * build — each start at 1 and collide, which is precisely the bug this
 * exists to prevent. A token drawn per call has no such shared state to
 * disagree about. `Math.random` rather than `crypto`: an id is a name, not a
 * secret, and nothing here is defended by unguessability.
 *
 * A random token rather than a content hash, equally deliberately, and this
 * is the sharper of the two comparisons: a hash of the marker's own markup
 * would have kept renders byte-reproducible and would still collide exactly
 * where it matters. Two diagrams whose markers are byte-identical but whose
 * CSS contexts differ — which ADR-0004 explicitly invites by letting a
 * consumer scope `--siren-*` tokens to a container — would hash to one id,
 * and the second diagram's arrowheads would resolve to the first's marker and
 * take the first container's theme. Identical markup is precisely the case a
 * hash cannot separate and the case that needs separating.
 *
 * What it costs: the markup is no longer byte-reproducible across renders, so
 * two renders of the same document differ in exactly these tokens and in
 * nothing else. Nothing may cache or hardcode a marker id, and a test that
 * wants one must read it out of the DOM.
 *
 * The `__` is load-bearing rather than decorative: no `siren-*` class name
 * contains an underscore, so `siren-arrow__k3f9a1x2` is unambiguously a base
 * name plus a scope, and a reader (or a test normalizing markup back to "the
 * same drawing") can tell the two apart without a table of known names. The
 * eight-character width is part of that contract for the same reason: a
 * normalizer collapses `__` plus exactly eight characters, so the padding is
 * what keeps a short `Math.random()` draw (`0.5` is `"0.i"` in base 36) from
 * minting a scope no such normalizer recognizes.
 *
 * One module, three callers: the flowchart, class-diagram and sequence
 * renderers all mint from here. They were two copies while there were two
 * callers and no shared home to put one in; the third caller is what made a
 * module of it, as the second copy's comment said it should.
 */
export function mintIdScope(): string {
  return `__${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}
