---
name: siren
description: Write, edit and validate Siren (.srn) documents, which are Mermaid-syntax diagrams (flowchart, sequence, class, state, ER) with a `timeline:` block that animates them step by step. Use when the user asks for a Siren diagram or a .srn file, wants an animated or step-by-step Mermaid diagram, wants to add a reveal or highlight timeline to an existing Mermaid diagram, or asks to fix a .srn document that fails to render.
license: MIT
---

# Writing Siren documents

A Siren document is a Mermaid diagram followed by an optional `timeline:` block, or by
several named `timeline <name>:` blocks when one diagram tells more than one story. Each
line of a timeline is one step, and says what to reveal, highlight or remove. The
renderer is `siren-core` (npm), and a document is usually saved with the `.srn`
extension. This skill matches `siren-core` and `siren-board` 0.8.

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
   [references/syntax.md](references/syntax.md) for each diagram type. Leave colors to
   the theme unless they carry meaning. See [Color and styling](#color-and-styling).
4. **Write the timeline.** Follow the rules and ids below.
5. **Validate** with the bundled script, and fix every error and warning. See
   [Validating](#validating).
6. **Deliver** the `.srn` document and a short summary of what each step shows.

When the user gives you an existing Mermaid diagram, keep its content and only add
the timeline, unless the diagram uses something Siren rejects.

## Document shape

```
---                       optional front matter
siren: { … }              for the host page; other keys are read but not applied
---
<diagram header>          flowchart LR | sequenceDiagram | classDiagram | stateDiagram-v2 | erDiagram
<diagram body>            Mermaid syntax

timeline:                 optional: one unnamed block,
  <step 1>
  <step 2>

timeline <name>:          or several named blocks instead (never both)
  <step 1>
```

- The first non-comment line must be the diagram header, after the optional front
  matter at the very top. Siren supports these five diagram types and no others.
- **Settings are not applied yet.** Front matter `config`, `title` and the like, and
  `%%{init: …}%%` / `%%{wrap}%%` directives, are read and each reported as a warning; the
  diagram is drawn without them. So don't use them to set a theme, curve or font: a
  warning-free document has none. Two exceptions pass silently: `look: classic`, and a
  top-level `siren:` key, whose value `render()` hands to the host page untouched.
- `timeline:` starts the block, and every remaining line belongs to it. Nothing closes
  it, so it must come last. With named blocks, each one runs from its header to the next
  `timeline <name>:` header, or to the end of the document.
- Only a whole line is a comment: a line whose first non-blank characters are `%%`. A
  `%%` in the middle of a line is text, or an error, depending on where it is, so put
  each comment on a line of its own. (Inside a `timeline:` block, `%%` starts a comment
  anywhere on a line.) A line of only `%%` is refused in flowcharts and ER diagrams, so
  write `%% text` or leave the line blank.

## Timeline

Each non-blank line is one step, numbered by position from 1. Don't write step numbers:
`step 1: enter A fade` is an error. A step holds one or more actions separated by
commas, and they all play together.

| Action                    | Effects                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `enter <id> <effect>`     | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom` |
| `exit <id> <effect>`      | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom` |
| `highlight <id> <effect>` | `outline`, `glow`                                                |
| `unhighlight <id>`        | none; writing an effect is an error                              |

`enter`, `exit` and `highlight` require an effect.

Slides are named by the side of the screen involved. `enter X slide-left` arrives from
the left, and `exit X slide-left` leaves toward the left. The same holds for `-right`,
`-top` (above) and `-bottom` (below).

`outline` recolors and thickens a shape's border or a line. `glow` adds a colored halo
and recolors the border at its normal width. Both win over any color or width the author
gave the target, for as long as it stays highlighted. A connection's arrowhead keeps its
color.

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
- **Ids must exist and be unique.** An id that isn't in the diagram is an error, and so
  is an id that two things share (a node named `A-B` beside the edge `A --> B`).
- **Invisible edges stay invisible.** `A ~~~ B` is a valid target, but an `outline`
  highlight leaves it invisible, so don't use one to point at anything.
- **Animated edges march on their own.** An edge with `e1@{ animate: true }` keeps its
  dash animation at every step; the timeline still enters, exits and highlights it.

### Several timelines

Use named blocks when the same diagram should be walked through more than one way, such
as two checkout paths over one class diagram. Don't copy the diagram into a second file.

```
timeline card:
  enter Order fade
  enter CreditCard fade, highlight CreditCard glow

timeline wallet:
  enter Order fade
  enter Wallet fade, highlight Wallet glow
```

- A header is exactly `timeline <name>:`, with nothing between the name and the colon.
  A name is letters, digits, `_` and `-`, and is case-sensitive. Any other line starting
  with `timeline` isn't a header.
- Use either one unnamed `timeline:` or named blocks, never both. Two unnamed blocks, a
  repeated name, or a name with other characters is an error.
- Every block is a timeline of its own: its steps count from 1, and every rule above,
  step 0 included, applies within that block alone. So **each block must `enter`
  everything it wants hidden at its start**: an element one block never mentions is
  visible from that block's step 0, even if another block enters it later.
- Every block is validated on every render. A diagnostic from a named block starts
  `timeline <name>:` rather than `timeline:`.
- `render()` and `siren-board` play the first block by default. `siren-board` shows a
  dropdown to switch when there are two or more.

## Target ids

Every action names its target by id. Authored things use the id you wrote. Connections
join their two ends, unless you named the edge. Things without a name get a generated id
numbered in source order.

| Diagram   | Target                       | Id                                                  |
| --------- | ---------------------------- | --------------------------------------------------- |
| Flowchart | Node                         | `A` in `A[Label]` or `A@{ … }`, not the label        |
|           | Edge                         | `A-B` for `A --> B` or `A ~~~ B`, whatever the arrow |
|           | Named edge                   | `e1` for `A e1@--> B`                               |
|           | Subgraph                     | `subgraph:1`, `subgraph:2`, ... even when it has a handle |
| Sequence  | Participant or actor         | `Alice` in `participant Alice as Al`                |
|           | Message                      | `Alice-Bob` for `Alice->>Bob` (sender first)        |
|           | Block                        | `loop:1`, `alt:1`, `opt:1`, `par:1`, `critical:1`, `break:1`, `rect:1`, numbered per keyword |
|           | Box grouping                 | `box:1`, `box:2`, ...                               |
|           | Note                         | `note:1`, `note:2`, ... in source order             |
|           | Activation bar               | `activation:1`, ... numbered as each bar opens      |
| Class     | Class                        | `Order`                                             |
|           | Relationship                 | `Left-Right` as written: `Media <|-- Track` is `Media-Track` |
|           | Namespace                    | `namespace:1`, ... one per frame, outer first, in the order blocks open |
|           | Note                         | `note:1`, ...                                       |
| State     | State or composite state     | `Idle`, and the id, not the description             |
|           | Transition                   | `Idle-Running`                                      |
|           | `[*]`                        | `start:1`, `end:1`, ... one start and one end per nesting level |
|           | Concurrent region            | `region:1`, `region:2`, ...                         |
| ER        | Entity                       | `CUSTOMER`                                          |
|           | Relationship                 | `CUSTOMER:ORDER` (a colon, because entity names may contain `-`) |
|           | Subgraph                     | `subgraph:1`, ...                                   |

- A repeated connection between the same pair, in the same direction, gets `#2`,
  `#3`, ... from its second occurrence: `A-B`, `A-B#2`. Named edges still count:
  `A e1@--> B` then `A --> B` gives `e1` and `A-B#2`.
- A connection's id follows the direction written, so a reply `Bob-->>Alice` is
  `Bob-Alice`.
- `A --> B & C` creates `A-B` and `A-C`. A chain `A --> B --> C` creates `A-B` and `B-C`.
- Name an edge (`A e1@--> B`) when its generated id would be awkward, for example the
  third of several parallel edges.

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
  splitting the story into named timelines or several documents.

## Color and styling

A Siren diagram is usually viewed under a theme you can't see. The page may redeclare
Siren's theme tokens for a dark mode, brand colors or print, and every element you leave
unstyled follows them. Mermaid's styling statements (`classDef`, `class`, `:::`, `style`,
`linkStyle`) are drawn as inline styles that override the theme, so a color you write
looks the same under every theme: a light fill becomes a glaring panel on a dark page,
and a dark stroke disappears into it. (A host page can drop them with
`omitAuthorStyles`, but don't count on it.)

- **Prefer the theme.** Write no styling by default. Show structure with subgraphs,
  node shapes and labels, and point at things with the timeline's `highlight` rather
  than with color.
- **Add color only when it carries meaning** the structure can't, such as which layer a
  node belongs to, or your own systems against external ones. Use few classes, apply
  each one consistently, and don't color for decoration.
- **Write hex colors and plain values only.** Flowchart and ER style values refuse every
  CSS function (`rgb(`, `hsl(`, `var(`), and ER values refuse `.` and `!important` as
  well. See [Style values](references/syntax.md#style-values).
- **When you add color, make it work on light and dark backgrounds:**
  - `fill`: translucent, as 8-digit hex with an alpha around `22` to `40`
    (`fill:#3b82f633`). The theme's background shows through, and the theme's label
    color stays readable on it.
  - `stroke`: an opaque mid-tone, such as `#3b82f6`, `#f59e0b` or `#ec4899`. Avoid
    near-black (`#0f172a`) and near-white (`#f1f5f9`), which vanish on one of the two
    backgrounds.
  - `color` (label text): leave it unset on a translucent fill. Only an opaque fill
    needs it, and an opaque fill should be rare. If you use one, pair it with a `color`
    that contrasts with that fill, since the box will look the same on any page.
  - `stroke-width`: whole numbers (`2px`), since ER values can't hold a `.`.
  - `linkStyle`: leave edges to the theme. If you must style one, use a mid-tone stroke.
    Never set `linkStyle default` to a dark or light gray, which hides every edge under
    one of the themes.
- **Subgraphs can be styled** by their handle (`style backend fill:#3b82f611`, or
  `class backend layer`). Keep a subgraph's fill fainter than its nodes', around `11` to
  `22` alpha, so the nodes inside still stand out.
- **Highlights always show.** While a target is highlighted, the highlight's color and
  width replace the author's `stroke` and `stroke-width`, even `!important`, and go back
  when it is unhighlighted. Avoid teal and cyan in author colors, so the default theme's
  teal highlight still stands out against them.

```
flowchart LR
  classDef external fill:#64748b33,stroke:#64748b
  classDef ours fill:#3b82f633,stroke:#3b82f6
  Browser([Browser]):::external --> App[App]:::ours
  App --> Auth[Auth]:::ours
  Auth --> LDAP[(LDAP)]:::external
```

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
- The step count is the first block's. With named blocks, a `timelines:` line lists each
  block with its own step count. The errors and warnings cover every block.
- A document with icon nodes needs their packs: pass each Iconify JSON file with
  `--icons <pack.json>` (repeatable). Without it, every icon is an error.
- Pass `-` to read from stdin. The exit code is 1 when any document has an error.
- If the timeline rejects an id that `--ids` lists, that kind of element can't be
  animated yet. Leave it out of the timeline.
- Every document you produce must, with its timeline blocks removed, also be accepted by
  Mermaid 12.2.0, which `OK` alone does not prove. From a Siren checkout, check it with
  `pnpm --filter siren-core check-examples -- diagram.srn`.

If you can't run Node.js, check the document by hand against the rules above, and tell
the user it hasn't been validated.

## Common errors

Most refusals name the cause and the fix in their own text, so read the message first.
These are the ones that come up most:

| Diagnostic | Fix |
| ---------- | --- |
| `Expected "flowchart TB", ... found "..."` | The first line after any front matter must be one of the supported headers. Siren draws only the five diagram types. |
| `Unrecognized <kind> line: "..."` | That syntax isn't supported. Rewrite it with a supported form from references/syntax.md. |
| `A style declaration cannot hold "(": fill:rgb(...)` | Write a hex color or a name. The message gives the hex for `rgb()`. |
| `Character "." cannot appear in a `style` declaration list in erDiagram` | ER values take only letters, digits, `#-_*:,`. Write whole numbers and drop `!important`. |
| `... Frontmatter title is read but not drawn yet` (warning), or another setting warning | Remove the setting. Siren doesn't apply front matter or init settings yet. |
| `No icon pack "x" is registered` | The host page must pass the pack as `iconPacks`. Validate with `--icons`, or use a shape instead of an icon. |
| `Siren never fetches an image while drawing` | Embed the image as a `data:` URL, or drop the image. |
| `An edge label without quotes cannot begin with a word holding "@"` | Quote the whole label: `A -->|"a@b"| B`. |
| `The edge id "e1" is already the id of the node "e1"` | Give the edge another id. |
| `create participant "X" comes after "X" is already used` | Move the `create` above the first line that names X. |
| `The created participant "X" has no creating message` | Make the next message after `create participant X` one sent to X (`A->>X: ...`), with nothing in between. |
| `The destroyed participant "X" has no destroying message` | Make the next message after `destroy X` one sent by or to X, with nothing in between. |
| `... has no creating message, so the create draws nothing` (warning) | Add a message sent to X right after `create participant X`, or make it a plain `participant X`. |
| `... has no destroying message, so the destroy draws nothing` (warning) | Add a message sent by or to X right after `destroy X`, or remove the `destroy`. |
| `timeline: references unknown id "X"` | Check the id against `--ids`. Use the node id, not its label. |
| `timeline: "X" is the id of more than one thing in the diagram` | Rename the node, or name the edge with `id@`. |
| `"highlight" on "X" at step N comes before it becomes visible` | Move the action to or after X's `enter` step. |
| `edge "A-B" remains visible after its endpoint "B" exits` | Add `exit A-B <effect>` at or before B's exit step. |
| `"X" already has a "enter" action` | Remove the second `enter`. An element enters once. |
| `Unknown highlight effect ""` | Add an effect: `highlight X outline`. |
| `Unrecognized timeline action: "step 1: ..."` | Remove the step prefix. The line's position is its number. |
| `An unnamed "timeline:" block cannot share a document with named ones` | Name every block, or keep only the unnamed one. |
| `A document declares at most one unnamed "timeline:" block` | Name each block: `timeline <name>:`. |
| `Timeline "X" is already declared on line N` | Give each block a different name. |
| `Invalid timeline name "X"` | Use only letters, digits, `_` and `-` in the name. |
| `linkStyle interpolate "X" is a curve Siren does not draw yet` | Use `rounded`, `basis`, `linear`, `step`, `stepBefore` or `stepAfter`. |
| `linkStyle interpolate "X" names no curve` (warning) | Check the spelling and case: `stepBefore`, not `stepbefore`. |

## Using the result

Tell the user how to view the document when they ask, or when it isn't obvious:

- **`siren-board`** (npm) is a ready-made player: step controls, play/pause, pan and
  zoom, a timeline picker, fullscreen (where a click on the canvas steps forward) and a
  dot-grid background. `createBoard(element, { source })`, plus
  `import "siren-core/theme.css"`. Options include `iconPacks`, `dotGrid`,
  `omitAuthorStyles` and callbacks such as `onStepChange`, `onDiagnostics` and
  `onStyles`. The board has `setFullscreen()`, `setDotGrid()`, `play()` and `pause()`.
- **`siren-core`** (npm) renders to SVG with `render(source, element, options?)`, and
  returns `{ svg, controller, diagnostics, timelines, styles, siren }`. The controller
  has `next()`, `prev()` and `reset()`. Options: `timeline` (a block name, or `false`
  for the plain diagram), `iconPacks`, `omitAuthorStyles`, `onClick` (for `click … call`)
  and `measureText`.
- **Theming** is done with CSS custom properties (`--siren-*`) from `theme.css`. A color
  token may also hold `url(#id)` to a gradient or pattern on the page, except
  `--siren-highlight-color`.
