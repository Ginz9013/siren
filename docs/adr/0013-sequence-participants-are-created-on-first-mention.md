---
status: accepted
---

# A sequence participant is created where it is first mentioned

The sequence diagram slice adopted an explicit-reference rule: a message, note, `activate`,
`deactivate` or `destroy` naming a participant with no earlier `participant` / `create
participant` statement was an error, and the statement was dropped. Its stated reason was to
mirror flowchart's "no implicit node creation" stance. We reverse it. A participant nothing has
declared is created where a statement first names it, with its id as its label and no
diagnostic, as Mermaid does:

```
sequenceDiagram
  A->>B: hi
  B-->>A: ok
```

draws two lanes, `A` then `B`, and both messages.

## Why

- **The rule broke the compatibility condition.** CONTEXT.md holds Siren to "a document that
  renders in Mermaid must render here". Mermaid 11.17.2 draws the document above; Siren drew an
  empty diagram with four errors. And this is not an edge case: it is how most sequence diagrams
  are written, including the first example in Mermaid's own documentation.
- **Its premise was false.** Flowchart has no "no implicit node creation" stance: `A --> B`
  creates both nodes with no declaration and no diagnostic. The rule mirrored nothing.
- **A misspelled name is visible.** The one thing the rule caught was a typo such as `Srever`,
  and a typo now draws an extra lane, which a reader sees at once. A warning for every
  undeclared participant would fire on the most common way of writing a sequence diagram, so it
  would be noise.

## Details

Each rule below was measured against Mermaid 11.17.2.

- **Every reference creates.** Either end of a message, a note, `activate`, `deactivate` and
  `destroy` all create an undeclared participant.
- **Lanes follow first mention.** Order is the order in which participants are first named in
  the flattened statement order, declaration or reference alike, block bodies included:
  `participant B` then `A->>B` gives B, A.
- **A later declaration fills in, and does not move.** `A->>B` then `participant B as Bee` keeps
  A, B and labels B `Bee`; `actor B` also makes it an actor.
- **`create` must come first.** `A->>X` then `create participant X` stays an error. Mermaid
  rejects that document ("It is not possible to have actors with the same id"). Siren drops the
  `create` and keeps the lane X already has, from the top.
- **A created-by-mention participant is never in a `box`.** A box body holds only declarations,
  so its members are always declared. The model still checks box members, because a document
  built by hand can name one that isn't declared.

## Considered Options

- **Keep the rule** — rejected, for the reasons above.
- **Create implicitly and warn** — rejected. It satisfies the compatibility condition, but it
  warns on the ordinary case to catch a typo that is already visible in the picture.
