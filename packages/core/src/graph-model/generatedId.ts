/**
 * The id a model assigns to an element the author never named: a class
 * diagram's `namespace:1` and `note:1`, a sequence diagram's `box:1`,
 * `loop:1`, `alt:2`. `kind` is the element's own word for itself and `n` a
 * 1-based counter within that kind, in document order.
 *
 * The separator is a colon rather than the `-` these ids started out with,
 * and it is load-bearing rather than cosmetic. Every element a diagram can
 * animate shares one id space — the one `timeline:` addresses and the one
 * `data-siren-id` is stamped from — and `-` is already spoken for by the
 * connector convention, `${from}-${to}`. So a class named `namespace`
 * pointing at a class named `1` produces the relationship id `namespace-1`,
 * and a participant named `box` messaging a participant named `1` produces
 * the message id `box-1`: in both cases the same string the first namespace
 * or the first box grouping already held, with no diagnostic to say so.
 *
 * A class id and a participant id are both `\w+` (the parser's rule), which
 * cannot contain a `:`. No connector id can therefore ever spell a generated
 * one, which makes the collision structurally impossible rather than merely
 * unlikely — the reason this is a function with a reason attached and not an
 * incidental bit of string concatenation at each call site.
 *
 * Written once for both diagram kinds because the argument is the same one
 * twice: it is about the shape of the id space, not about namespaces or
 * about boxes. Two copies of it would be two places for a future kind's
 * separator to drift.
 *
 * The cost is that an author addressing one of these in a `timeline:` block
 * writes `step 1: enter namespace:1 fade`. That parses: the timeline action
 * grammar takes everything after the step's own colon and splits it on
 * whitespace, so a colon inside the id is read as part of the id.
 */
export function generatedId(kind: string, n: number): string {
  return `${kind}${ID_SEPARATOR}${n}`;
}

const ID_SEPARATOR = ":";
