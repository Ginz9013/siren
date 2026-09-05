---
status: accepted
---

# A timeline target is an id, and it reaches every element carrying that id

`createAnimationController` resolved a timeline target with
`svg.querySelector('[data-siren-id="..."]')` — the first match in document order. That was never a
decision. It was correct by accident, because every diagram kind that animates so far draws
exactly one element per id: a flowchart node is one `<g>`, so is an edge, so are a class, a
relationship, a namespace and a note.

The sequence diagram breaks the coincidence, and it breaks it structurally rather than by
oversight. A declared, never-destroyed participant is drawn **twice** — once in the top participant
row, once in the bottom — because `buildParticipant` takes the row's `top` as a parameter for
exactly that reason. Its lifeline is a third element, and a destroyed participant's X mark is a
fourth. All four already carry the same `data-siren-id`. Wire a `timeline:` block to a sequence
diagram against the old lookup and `highlight A outline` lights the top box while the lifeline and
the bottom box sit there unchanged — a bug with no error, in the feature this project exists for.

So the rule is stated rather than inherited: **a timeline target is an id**, naming the thing the
author wrote in their document, and the controller applies that target's class state to every
element carrying it. `querySelectorAll`, and a loop.

The argument is about what the author means, not about what is convenient to implement. An author
who writes `highlight A outline` is pointing at *that participant*. That the participant happens to
be drawn as three shapes is a fact about layout — it exists because a tall diagram is easier to
read with the names repeated at the bottom — and layout facts have no business surfacing in the
animation vocabulary. The same reasoning already sits behind ADR-0002: the timeline block names
elements of the *diagram*, deliberately separate from how they are drawn.

## Considered Options

- **Mint an id per drawn element** (`A:lifeline`, `A:bottom`) so an author can animate the parts
  separately. Rejected as the worst of the three. It converts a layout detail into an id convention
  every author has to learn, and one that changes shape per diagram kind — the ids a document may
  name would depend on how many times the renderer decided to draw something. It also has no
  natural answer for the common case: the author who means "the participant" would have to know and
  list all three.
- **Keep first-match and make the renderer tag only a "primary" element**, moving the other
  elements to a different attribute. Rejected because it hides the problem rather than answering it:
  "which element is primary" is a new question per diagram kind, with no principled answer for a
  participant drawn identically at both ends, and the elements left untagged become invisible to
  anything else that looks up by id.
- **Have each diagram kind's renderer collapse its own multi-element cases**, e.g. by wrapping the
  three participant elements in one `<g data-siren-id>`. Rejected because the elements are not
  adjacent in the SVG and cannot be: the two participant rows sit at opposite ends of the drawing,
  with the whole message body between them. Wrapping them would mean giving up document order,
  which the renderer needs for painting order.

## Consequences

The change is a pure widening for every diagram kind that exists today — one element per id means
`querySelectorAll` returns exactly what `querySelector` did — so it landed with all twelve existing
controller tests untouched. Its whole value is in the kind that comes next, which is why it is
recorded here: without the ADR, the loop over `querySelectorAll` reads like defensive coding
against a case that never happens.

Ids are now genuinely many-to-one with elements, so nothing may assume a `data-siren-id` lookup
returns one node. The click path in `render()` is unaffected because it reads the attribute off the
element the event fired on rather than searching for it, but any future code that searches must use
all matches.

A renderer that tags several elements with one id takes on an obligation the controller cannot
check: every one of them must be able to carry the animation classes and mean the same thing by
them. A `siren-pending` participant must hide its box *and* its lifeline, or the target half-appears.
That obligation belongs to the theme, and it is the sequence-animation board's problem to discharge.
