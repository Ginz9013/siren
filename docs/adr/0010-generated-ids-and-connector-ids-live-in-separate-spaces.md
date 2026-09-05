---
status: accepted
---

# A generated id uses a colon, so it can never spell a connector id

Every diagram kind hands its elements ids that an author types into a `timeline:` block and that
the renderer stamps as `data-siren-id`. Those ids come from two different places, and until they
were told apart they could collide.

Some ids are **authored**: a flowchart node's `A`, a class's `Animal`, a participant's `Shopper`.
Some are **derived from a pair** — the connector convention `${from}-${to}`, then `#2` for a
repeated pair, which a flowchart edge, a class relationship and a sequence message all share. And
some are **generated** for a thing the author never named at all: the first `namespace` in a class
diagram, the third `loop` in a sequence diagram, a `note`, a `box` grouping.

The generated ones used to be spelled with a hyphen — `namespace-1`, `box-1`, `loop-1` — which put
them in the same space as the connector convention, because a hyphen is what that convention is
made of. So `box->>1: hi`, a message between a participant named `box` and one named `1`, produced
the id `box-1`: the same string the document's first box grouping already held.
`querySelectorAll('[data-siren-id="box-1"]')` then matched two unrelated elements, a `timeline:`
entry naming it addressed both, and nothing anywhere reported a problem. The class diagram found
this first and answered it locally; the sequence diagram had the identical hole and had not.

The rule is now stated once, for every kind: **a generated id is `${kind}:${n}`**. An authored id
is `\w+` by every parser's own grammar, and `\w` does not match a colon — so no authored id can
contain one, no connector id built from two authored ids can contain one, and no generated id can
therefore be spelled by either. The collision is not unlikely; it is unconstructible.

This is what `generatedId(kind, n)` exists for. Not to save the characters — to make the id's
*shape* one decision in one place, so a future diagram kind cannot conform to the separator while
getting the rest wrong by emitting `1:loop` or counting from zero.

## Considered options

**Detect the collision and report a diagnostic.** Keeps `box-1` and warns when two elements claim
it. Rejected: it tells an author their document is broken without giving them a way to write it
correctly — the two ids are both legal and neither can yield. A rule that makes the state
unreachable beats a rule that reports it.

**Make the timeline grammar disambiguate.** Some prefix or sigil at the point of use — `enter
block:loop-1`. Rejected: it moves a spelling problem into the authored language, and the author
would carry the cost of an ambiguity that is not theirs.

**Namespace the generated ids per kind in the DOM instead** — a `data-siren-block-id` attribute
separate from `data-siren-id`. Rejected: it forks the one lookup ADR-0009 just unified, and the
controller would have to know which attribute a target might be hiding behind.

## Consequences

`data-siren-id` values changed for sequence box groupings and control-flow blocks (`box-1` →
`box:1`, `loop-1` → `loop:1`). That was accepted deliberately and is cheap exactly once: it landed
in the same board that first made those ids addressable, so no document could have named them
before.

An author addressing a generated element writes a colon inside the id — `step 1: enter loop:1
fade`. The timeline grammar already supports this: `parseTimelineLine` consumes only the step's own
colon and splits the remainder on whitespace, so a colon inside a target id is read as part of the
id. This ADR is why that behavior is load-bearing rather than incidental.

A new diagram kind gets this for free by calling `generatedId`, and gets it wrong only by choosing
not to. `resolveTimeline`'s dedupe key also uses a colon internally, for an unrelated purpose; it
is unambiguous because the four timeline verbs contain none, and it is commented as such so a
reader does not infer a rule that is not there.
