---
name: siren
description: Write, edit and validate Siren (.srn) documents, which are Mermaid-syntax diagrams (flowchart, sequence, class, state, ER) with a `timeline:` block that animates them step by step. Use when the user asks for a Siren diagram or a .srn file, wants an animated or step-by-step Mermaid diagram, wants to add a reveal or highlight timeline to an existing Mermaid diagram, or asks to fix a .srn document that fails to render.
license: MIT
---

# Writing Siren documents

A Siren document is a Mermaid diagram followed by an optional `timeline:` block. Each
line of the timeline is one step, and says what to reveal, highlight or remove. The
renderer is `siren-core` (npm), and a document is usually saved with the `.srn`
extension.

```
flowchart LR
  Client[Browser] --> API[API server]
  API --> DB[(Database)]
  API --> Cache[(Cache)]

timeline:
  enter API fade, enter Client-API fade
  enter Cache slide-right, enter API-Cache fade
  highlight Cache glow
  unhighlight Cache, enter DB slide-right, enter API-DB fade
  highlight API-DB outline
```

Step 0 shows `Client` only, because every other target has an `enter` action. Then:

1. The API and its edge appear.
2. The cache appears.
3. The cache is highlighted.
4. The database appears.
5. The query path is highlighted.

## Workflow

1. **Find the story.** Before writing, decide what the diagram explains and in what
   order a reader should meet each part. The timeline is a narrative, not a list of
   elements.
2. **Choose the diagram type.** Use a flowchart for processes and architecture, a
   sequence diagram for interactions over time, a class diagram for types, a state
   diagram for lifecycles, and an ER diagram for data models.
3. **Write the diagram** in Mermaid syntax, using only what Siren supports. See
   [references/syntax.md](references/syntax.md) for each diagram type.
4. **Write the timeline.** Follow the rules and ids below.
5. **Validate** with the bundled script, and fix every error and warning. See
   [Validating](#validating).
6. **Deliver** the `.srn` document and a short summary of what each step shows.

When the user gives you an existing Mermaid diagram, keep its content and only add
the timeline, unless the diagram uses something Siren rejects.

## Document shape

```
<diagram header>          flowchart LR | sequenceDiagram | classDiagram | stateDiagram-v2 | erDiagram
<diagram body>            Mermaid syntax

timeline:                 optional, at most once
  <step 1>
  <step 2>
```

- The first non-comment line must be the diagram header. Siren doesn't support YAML
  front matter (`---`) or diagram types other than these five.
- `timeline:` starts the block, and every remaining line belongs to it. Nothing closes
  it, so it must come last.
- `%%` starts a comment, anywhere in the document. `%%{init: ...}%%` directives are
  treated as comments and ignored.

## Timeline

Each non-blank line is one step, numbered by position from 1. Don't write step numbers:
`step 1: enter A fade` is an error. A step holds one or more actions separated by
commas, and they all play together.

| Action                  | Effects                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `enter <id> <effect>`   | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom` |
| `exit <id> <effect>`    | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom` |
| `highlight <id> <effect>` | `outline`, `glow`                                              |
| `unhighlight <id>`      | none; writing an effect is an error                              |

`enter`, `exit` and `highlight` require an effect.

Slides are named by the side of the screen involved. `enter X slide-left` arrives from
the left, and `exit X slide-left` leaves toward the left. The same holds for `-right`,
`-top` (above) and `-bottom` (below).

`outline` recolors and thickens a shape's border or a line. `glow` adds a colored halo
and recolors the border at its normal width. In sequence diagrams only `glow` is
visible at the moment: `outline` is accepted but draws nothing.

### Rules the renderer enforces

- **Step 0.** A target with an `enter` action is hidden until its step. Every other
  target is visible from the start. To reveal a whole diagram piece by piece, give
  every element an `enter`, except the ones that should be visible at step 0.
- **One enter and one exit per target.** A second `enter` or `exit` for the same id is
  ignored with a warning, so an element can't come back after it exits.
- **Nothing before it's visible.** An `exit`, `highlight` or `unhighlight` on a target
  before its `enter` step is an error.
- **Connections leave with their ends.** When a node exits, also exit every edge
  attached to it at the same step or earlier. Otherwise the renderer warns that the
  edge stays visible.
- **Enter connections with their ends.** Reveal an edge in the same step as the later
  of its two endpoints, or after it. The renderer allows an edge to appear before its
  nodes, but the reader then sees a line to nothing.
- **Containers don't carry their contents.** A subgraph, namespace, composite state,
  sequence block or box animates only its own frame and label. The nodes, messages or
  states inside keep their own timeline, so enter and exit them explicitly, usually in
  the same step as the container.
- **Highlights persist** until `unhighlight`. Several targets can be highlighted at
  once. A new `highlight` on the same target replaces its effect.
- **Ids must exist.** An id that isn't in the diagram is an error.

## Target ids

Every action names its target by id. Authored things use the id you wrote. Connections
join their two ends. Things without a name get a generated id numbered in source
order.

| Diagram   | Target                               | Id                                         |
| --------- | ------------------------------------ | ------------------------------------------ |
| Flowchart | Node                                 | `A` in `A[Label]`, not the label           |
|           | Edge                                 | `A-B` for `A --> B`, whatever the arrow    |
|           | Subgraph                             | `subgraph:1`, `subgraph:2`, ... even when it has a name |
| Sequence  | Participant or actor                 | `Alice` in `participant Alice as Al`       |
|           | Message                              | `Alice-Bob` for `Alice->>Bob` (sender first) |
|           | Block                                | `loop:1`, `alt:1`, `opt:1`, `par:1`, `critical:1`, `break:1`, `rect:1`, numbered per keyword |
|           | Box grouping                         | `box:1`, `box:2`, ...                      |
|           | Note                                 | `note:1`, `note:2`, ... in source order    |
|           | Activation bar                       | `activation:1`, ... numbered as each bar opens |
| Class     | Class                                | `Order`                                    |
|           | Relationship                         | `Left-Right` as written: `Media <|-- Track` is `Media-Track` |
|           | Namespace, note                      | `namespace:1`, `note:1`, ...               |
| State     | State or composite state             | `Idle`, and the id, not the description    |
|           | Transition                           | `Idle-Running`                             |
|           | `[*]`                                | `start:1`, `end:1`, ... one start and one end per nesting level |
|           | Concurrent region                    | `region:1`, `region:2`, ...                |
| ER        | Entity                               | `CUSTOMER`                                 |
|           | Relationship                         | `CUSTOMER:ORDER` (a colon, because entity names may contain `-`) |
|           | Subgraph                             | `subgraph:1`, ...                          |

- A repeated connection between the same pair, in the same direction, gets `#2`,
  `#3`, ... from its second occurrence: `A-B`, `A-B#2`.
- A connection's id follows the direction written, so a reply `Bob-->>Alice` is
  `Bob-Alice`.
- `A --> B & C` creates `A-B` and `A-C`. A chain `A --> B --> C` creates `A-B` and `B-C`.

Generated numbering is easy to get wrong in a large diagram. Run the validator with
`--ids` to list every id exactly as the renderer produced it.

## Designing a good timeline

- **One idea per step.** A step should add one thing the reader can name, such as a
  component, a call or a decision.
- **Keep a skeleton.** Leave the entry point, or the few elements that frame the story,
  visible at step 0, so the first frame isn't empty.
- **Follow the flow.** Reveal in the order the process runs. Choose slide directions
  that match the layout: in an `LR` flowchart, a new node on the right arrives with
  `slide-right`, and a branch below the main line with `slide-bottom`. For edges and
  sequence messages, `fade` is usually clearest.
- **Check step 0.** Before finishing, list what is visible at step 0 (everything
  without an `enter`) and make sure it makes sense on its own.
- **Point, then release.** Use `highlight` to draw attention to what the step is about,
  and `unhighlight` it on a later step so highlights don't pile up.
- **Use `exit` to declutter**, not to tell the story backwards. Remember that an exited
  element can't come back.
- **Prefer `fade`.** Use slides where movement means something.
- **Keep it short.** 5 to 15 steps suit most diagrams. Beyond about 20, consider
  splitting into several documents.

## Validating

The bundled script renders documents with `siren-core` and reports every diagnostic
with its line and column. It needs Node.js 18+ and two packages, installed in the
directory you run it from:

```sh
npm install --no-save siren-core jsdom
node <skill-dir>/scripts/validate.mjs diagram.srn --ids
```

`<skill-dir>` is the directory that contains this `SKILL.md`.

```
diagram.srn: ERRORS (1 error(s), 0 warning(s), 5 step(s))
  diagram.srn:12:3 error: timeline: references unknown id "API-Db"
  ids: Client, API, DB, Cache, Client-API, API-DB, API-Cache
```

- Status `OK` means the document is valid. Fix every `error`, and treat every
  `warning` as a bug unless the user wants that behavior.
- `OK` means well-formed, not well-staged. The validator doesn't judge the story:
  review step 0 and the order of steps yourself.
- Pass `-` to read from stdin. The exit code is 1 when any document has an error.
- If the timeline rejects an id that `--ids` lists, that kind of element can't be
  animated yet. Leave it out of the timeline.

If you can't run Node.js, check the document by hand against the rules above, and tell
the user it hasn't been validated.

## Common errors

| Diagnostic                                                  | Fix                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Expected "flowchart TB", ... found "..."`                  | The first line must be one of the five headers. Remove front matter.    |
| `Unrecognized <kind> line: "..."`                           | That syntax isn't supported. Rewrite it with a supported form from references/syntax.md. |
| `Message references undeclared participant "X"`             | Declare `participant X` (or `actor X`) before its first message.        |
| `timeline: references unknown id "X"`                       | Check the id against `--ids`. Use the node id, not its label.           |
| `"highlight" on "X" at step N comes before it becomes visible` | Move the action to or after X's `enter` step.                        |
| `edge "A-B" remains visible after its endpoint "B" exits`   | Add `exit A-B <effect>` at or before B's exit step.                     |
| `"X" already has a "enter" action`                          | Remove the second `enter`. An element enters once.                      |
| `Unknown highlight effect ""`                               | Add an effect: `highlight X outline`.                                   |
| `Unrecognized timeline action: "step 1: ..."`               | Remove the step prefix. The line's position is its number.              |

## Using the result

Tell the user how to view the document when they ask, or when it isn't obvious:

- `siren-board` (npm) is a ready-made player with step controls, pan and zoom:
  `createBoard(element, { source })`, plus `import "siren-core/theme.css"`.
- `siren-core` (npm) renders to SVG with `render(source, element)` and returns a
  controller with `next()`, `prev()` and `reset()`.
