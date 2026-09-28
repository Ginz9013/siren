---
status: accepted
---

# A timeline line is a step, and its number is its place in the block

ADR-0002 put the timeline in its own block and left the syntax inside it provisional. Until now
every line began with its step number — `step 3: highlight B outline` — which made the number a
second copy of something the document already says: the order its lines are in. We drop the
prefix. Each non-blank line of a `timeline:` block is one step, numbered by its place among the
block's non-blank lines, counting from 1, and its comma-separated actions all fire on it:

```
timeline:
  enter B fade, enter A-B fade
  enter C fade, enter B-C fade
  highlight B outline
```

## Why

Two copies of one fact can disagree, and the old grammar let them disagree without a word:

- **Duplicates merged.** Two `step 1:` lines were read as one step holding both lines' actions.
  An author who meant two steps got one, and no diagnostic.
- **Gaps made empty steps.** `totalSteps` is the highest step named, so `step 1` then `step 3`
  produced a step 2 in which nothing happens; `next()` appeared to do nothing.
- **Order was decorative.** Lines could be written out of order and still animated in numeric
  order, so the block no longer read top to bottom as what the viewer would see.

Each of these is a picture other than the one the author meant, with nothing in it to notice —
the failure CONTEXT.md's opening rule exists to rule out. Making the order of lines *be* the
order of steps removes all three by construction, rather than adding three checks for them.

It also removes a cost of editing: inserting a step used to mean renumbering every line after it.

## Details

- **Blank lines take no number.** They remain free for grouping a long timeline visually.
- **A malformed line still takes its number.** Its actions produce errors, and the document is
  rejected, but the lines after it keep the numbers they will have once it is fixed. An author
  reading "step 5" in a diagnostic or on a board counts non-blank lines and lands on the same one.
- **The old form is not accepted**, not even with a warning: Siren is pre-release and no document
  outside this repository depends on it. `step 1: enter A fade` is an action nobody recognizes and
  fails like any other. A second `timeline:` line, which used to be an unrecognized *line*, is now
  an unrecognized *action*, since there is no line-level grammar left to fail.
- **`TimelineEntry.step` is unchanged.** The parser fills it by counting instead of reading it, so
  `resolveTimeline`, the animation controller and board see the same shape they always did.

## Considered Options

- **Keep `step N:` and diagnose duplicates, gaps and disorder** — rejected. It keeps the
  renumbering cost and turns three silent failures into three rules an author must satisfy, all to
  preserve a number the line order already determines.
- **Keep a marker without a number** (`step: enter A fade`, `- enter A fade`) — rejected. Every
  line starts with a verb, so the grammar is unambiguous without a marker, and a marker that
  carries no information is one more thing to type.
- **Allow one step to span several lines** — deferred. A step with many actions makes a long
  line (the complex showcase has one), but a continuation syntax is a separate decision to make
  when someone needs it; nothing here closes it off.
