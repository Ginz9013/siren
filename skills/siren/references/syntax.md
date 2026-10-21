# Siren diagram syntax

Siren reads Mermaid's syntax for five diagram types and draws them itself. This file
lists what Siren supports, as of `siren-core` 0.8. Siren refuses any construct it doesn't
implement with an error that points at the line, instead of drawing part of it, so stick
to the forms listed here.

Each example below is a complete document that Siren renders without diagnostics and that
Mermaid 12.2.0 also accepts.

## Contents

- [Document preamble](#document-preamble)
- [Timeline blocks](#timeline-blocks)
- [Flowchart](#flowchart)
- [Sequence diagram](#sequence-diagram)
- [Class diagram](#class-diagram)
- [State diagram](#state-diagram)
- [ER diagram](#er-diagram)
- [Style values](#style-values)
- [Not supported](#not-supported)

## Document preamble

```
---
siren:
  author: docs team
---
%% A whole-line comment
flowchart LR
  A --> B
```

- **Front matter** (`---` … `---`) may open the document, at the very top. It is read as
  YAML. `config`, `title` and the other keys Mermaid knows are read but **not applied
  yet**: each is reported as a warning. `look: classic` is the exception and passes
  silently. A top-level `siren:` key is never warned about; `render()` hands its value
  back to the host page unchanged. Front matter that is not valid YAML refuses the
  document.
- **`%%{init: …}%%`** directives (one line or several) and `%%{wrap}%%` are read, but no
  setting is applied yet: each is a warning. Any other `%%{…}%%` is removed with a
  warning.
- **Comments** are whole lines starting with `%%`. A `%%` in the middle of a line is
  text, not a comment, and after a statement it is usually an error. A line of only `%%`
  is refused in flowcharts and ER diagrams. In a timeline block, a comment is `%%`
  followed by a space, on its own line or after the last action.

## Timeline blocks

The timeline comes after the diagram, in one of two forms, never both:

```
classDiagram
  class Order
  class CreditCard
  class Wallet

timeline card:
  enter CreditCard fade
  highlight CreditCard glow

timeline wallet:
  enter Wallet fade
  highlight Wallet glow
```

- **One unnamed block:** a `timeline:` line, and every line after it is a step.
- **Named blocks:** `timeline <name>:` lines (one space, no space before the colon). A
  name is letters, digits, `_` and `-`, case-sensitive and unique in the document. Each
  block runs to the next header or the end of the document, and is a timeline of its
  own: steps count from 1, and step 0 hides only what that block `enter`s.
- A step is one line of comma-separated actions: `enter <id> <effect>`,
  `exit <id> <effect>`, `highlight <id> <effect>` or `unhighlight <id>`. A comment is
  `%%` followed by a space (`enter A fade %% why`); `%%x` with no space is read as part
  of an id.

See SKILL.md for the effects, the rules each block must follow, and every target id.

## Flowchart

Header: `flowchart` or `graph`, followed by `TB`, `TD` (same as `TB`), `BT`, `LR` or
`RL`.

### Nodes

A node is an id followed by an optional shape with a label. The id is what the timeline
uses. Ids may contain ASCII letters, digits, `_`, `-`, `.` and `%`; a CJK or other
non-ASCII id is refused, so put such text in the label (`U[用戶]`). An id may not begin with a
keyword (`end`, `style`, `class`, `graph`, `subgraph`, …) followed by `-` or `.`
(`end-x`), and may not be just `click`, `call` or `href`.

```
flowchart LR
  A[Rectangle] --> B(Rounded) --> C([Stadium]) --> D[[Subroutine]]
  D --> E[(Database)] --> F((Circle)) --> G(((Double circle)))
  G --> H{Decision} --> I{{Hexagon}} --> J>Flag]
  J --> K[/Parallelogram/] --> L[\Alt parallelogram\]
  L --> M[/Trapezoid\] --> N[\Alt trapezoid/]
  N --> O["Quoted label, with (punctuation)"]
  O --> P["`**Markdown** label`"]
  Q
```

- A node defined once can be referenced by id alone afterwards.
- A bare id on its own line (`Q`) declares a node labeled with its id.
- Quote a label that contains punctuation. An unquoted `[`, `]`, `{` or `}` other than
  the shape's own brackets is refused, and so is an unquoted `(` or `)` without its
  partner.
- A long label wraps by itself at about 175px, breaking at spaces or between CJK
  characters, and the node grows taller. `<br>` forces a break:
  `A["first line<br>second line"]`.
- Labels take inline HTML formatting: `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`,
  `<code>`, `<sub>`, `<sup>`, `<small>`, `<big>`, `<mark>`, `<span style>`, `<a href>`,
  and block tags such as `<p>`, `<div>`, lists and headings. `<table>`, `<img>`, form
  controls and media are refused.
- Character codes work as in Mermaid: `#quot;`, `#35;`, `#copy;`, and HTML's `&amp;` and
  `&#35;`.
- A Markdown string (`` "`**bold**`" ``) works in node labels only. In an edge label or
  a subgraph title its backticks and asterisks are drawn as written.
- Font Awesome text such as `fa:fa-user` is drawn as plain text. Use an icon node.
- Subgraph titles never wrap.

### Shapes with `@{ … }`

Every shape, including the ones brackets can't write, can be given in an `@{ … }` block
right after the node id. `label:` gives the text.

```
flowchart LR
  Start@{ shape: sm-circ }
  Input@{ shape: sl-rect, label: "Manual input" }
  Docs@{ shape: docs, label: "Reports" }
  Store@{ shape: cyl, label: "Orders DB" }
  User@{ shape: person, label: "Customer" }
  Web@{ shape: cloud, label: "Internet" }
  Split@{ shape: fork }
  Start --> Input --> Split
  Split --> Docs
  Split --> Store
  User --> Web --> Input
```

| Group | Shape names (common aliases in brackets) |
| ----- | --------------------------------- |
| Bracket shapes | `rect`, `rounded`, `stadium`, `fr-rect` (`subroutine`), `cyl` (`db`, `database`), `circle`, `diam` (`decision`), `hex`, `lean-r`, `lean-l`, `trap-b`, `trap-t`, `dbl-circ`, `odd` |
| Plain outlines | `notch-rect` (`card`), `notch-pent` (`loop-limit`), `sl-rect` (`manual-input`), `tri` (`extract`), `flip-tri` (`manual-file`), `folder`, `lin-rect` (`lin-proc`), `div-rect` (`div-proc`), `win-pane` (`internal-storage`), `st-rect` (`processes`), `tag-rect` (`tag-proc`), `text`, `datastore`, `composite`, `note`, `state` |
| Curved outlines | `delay`, `curv-trap` (`display`), `h-cyl` (`das`), `lin-cyl` (`disk`), `bow-rect` (`stored-data`), `doc` (`document`), `lin-doc`, `tag-doc`, `docs` (`documents`), `flag` (`paper-tape`), `brace` (`comment`), `brace-r`, `braces` |
| Figures | `bucket`, `person`, `console`, `browser`, `cloud`, `bang` |
| Fixed size, no label | `fork` (`join`), `hourglass` (`collate`), `bolt` (`com-link`), `sm-circ` (`start`), `fr-circ` (`stop`), `f-circ` (`junction`), `cross-circ` (`summary`), `anchor`, `choice` |

- Every name and alias Mermaid 12.2.0 lists is accepted, including the long forms
  (`process`, `diamond`, `terminal`, `small-circle`, `stacked-document`, …); the table
  shows the short ones. Names are case-sensitive. An unknown name is refused, and the
  error lists valid ones.
- A shape in the last row draws no label, so giving it one (`A[Ready]@{ shape: fork }`)
  is an error. `sm-circ` and `anchor` can't be styled.
- A `label:` is read as Markdown. Add `labelType: text` to draw it as written. A quoted
  value broken across lines draws as a line break.
- The block may also follow brackets or a class (`A[x]:::c@{ shape: circle }`), sit at
  either end of an edge, or span several lines. No space before the `@`, no text after
  the `}`, and one block per node mention. Any other key is ignored with a warning.

**Icon nodes** draw an icon from an [Iconify](https://iconify.design) pack:
`A@{ icon: "fa6-solid:user", form: circle, label: "User", pos: t, h: 64 }`. `form` is
`square`, `rounded` or `circle`; `pos` is `t` or `b` (the label's side); `h` is the size
in pixels. Siren never fetches a pack: the host page must pass it to `render()` as
`iconPacks`, and an icon from a pack it wasn't given is an error. Use icons only when the
user's page will provide the pack.

**Image nodes** draw an embedded image: `A@{ img: "data:image/png;base64,…", label: "Logo",
w: 80, h: 40, constraint: on }`. Only a `data:` URL works (PNG, GIF, JPEG, WebP or SVG,
up to 4 MB). Siren never fetches, so an `https:` image is an error that says to embed it.

### Edges

```
flowchart LR
  A --> B
  B --- C
  C -.-> D
  D -.- E
  E ==> F
  F === G
  G --x H
  H --o I
  I <--> J
  J x--x K
  K o--o L
  L ----> M
  M <-.-> M2
  M2 <==> M3
  M3 ==x M4
  M4 -.-o M5
  M5 -..-> M6
  M6 ===> N
  N --> N
  M -->|label| N
  N -- label --> O
  O -. label .-> P
  P ==>|label| Q
  Q ~~~ R
```

- Chains: `A --> B --> C`. Groups: `A --> B & C`, `B & C --> D`, with a space on each
  side of `&`. A group without an arrow (`A & B`) declares both nodes.
- `;` separates statements on one line: `A --> B; B --> C`.
- Heads go on thick (`==`) and dotted (`-.`) lines too, and on both ends with `<`, `x`
  or `o` at the start. The start must match the end: `o--x` is refused. Extra length is
  an extra `-`, `=` or `.` (`-..->`).
- `A --> A` is a self-loop, also from a subgraph to itself.
- `A ~~~ B` is an **invisible edge**: it affects the layout but draws no line. Each extra
  `~` pushes `B` one rank further. It still counts in `linkStyle` numbering. A `|label|`
  on it is still drawn.
- A long edge label wraps by itself at about 150px. `<br>` forces a break.
- In a `|label|`, quote the whole label if it holds `@`, a quote or a bracket:
  `A -->|"a@b"| B`.

### Edge ids and edge data

An edge can be named with `id@` before its arrow. The timeline then uses that id instead
of `A-B`.

```
flowchart LR
  Client e1@--> API
  API e2@-->|query| DB[(Database)]
  e1@{ animate: true }
  e2@{ animation: slow, curve: step }
  classDef hot stroke:#f43f5e
  class e2 hot
```

- `e1@{ … }` must come **below** the edge it describes. Its keys are `animate: true`,
  `animation: fast` or `slow` (the dashes march continuously, independent of the
  timeline) and `curve:` (see the curve names under [Styling](#styling)).
- `class e1 name` applies a `classDef` to the edge, also only below the edge. A class can't
  animate an edge; use `e1@{ animate: true }`.
- An edge id must not be a keyword, a subgraph name, or another node's id, and may be
  used once. An id can't go on a `&` group (`A e1@--> B & C`).
- `style e1` and `click e1` are refused. Style an edge with `class e1 name` or
  `linkStyle`.

### Subgraphs

```
flowchart TB
  subgraph Build
    direction LR
    Commit --> Compile
  end
  subgraph checks [Quality checks]
    subgraph Fast
      Unit
      Lint
    end
    Integration
  end
  Compile --> Unit
  Unit --> Integration
  checks --> Deploy
```

- The timeline names a subgraph `subgraph:1`, `subgraph:2`, ... in the order the
  `subgraph` lines appear. The handle you write (`checks`) is not its timeline id.
- `subgraph id [Title]`, `subgraph "Title"` and a multi-word `subgraph Some title` all
  work. A multi-word title has no handle.
- An edge may start or end at a subgraph. Its id uses the subgraph's handle:
  `checks-Deploy`.
- A node belongs to the first subgraph that names it; naming it in another subgraph
  later doesn't move it.
- `direction` outside any subgraph does nothing and is warned about: set the direction
  on the header line.
- `direction` inside a subgraph lays it out on its own, but only when no edge has exactly
  one end inside it. An edge between a subgraph and one of its own members, inside a
  subgraph that keeps its own direction, is refused.

### Styling

```
flowchart LR
  classDef stage fill:#3b82f633,stroke:#3b82f6,stroke-width:2px
  classDef terminal fill:#64748b33,stroke:#64748b
  subgraph pipeline [Pipeline]
    Parse --> Layout
  end
  Source:::terminal --> Parse
  Layout --> Output[(Output)]:::terminal
  class Parse,Layout stage
  style pipeline fill:#3b82f611
  linkStyle 0 stroke:#f43f5e
  linkStyle 1,2 stroke:#3b82f6,stroke-width:3px
```

- `:::name` goes after the node's shape: `Output[(Output)]:::terminal`.
- `style`, `class` and `:::` work on a subgraph's handle too, painting its frame and
  title.
- `classDef default …` styles every node. `classDef a,b …` defines several classes at
  once.
- `class A,B name` applies one class to several nodes, but one statement applies one
  class: `class A c,d` is refused. Class names must be valid CSS class names.
- When both apply, a `style` wins over a class, wherever each is written.
- `linkStyle` numbers edges from 0 in the order they're written, invisible ones included.
  `linkStyle default` styles every edge that no numbered statement names.
- `interpolate <curve>` picks how an edge bends: `linkStyle default interpolate step`,
  `linkStyle 1 interpolate linear stroke:#f43f5e`. The curves are `rounded` (the
  default), `basis`, `linear`, `step`, `stepBefore` and `stepAfter`, case-sensitive.
  `cardinal`, `bumpX`, `bumpY`, `catmullRom`, `monotoneX`, `monotoneY` and `natural` are
  errors. Any other name draws `rounded` with a warning.
- `color` sets a label's color.
- Values follow [Style values](#style-values): **hex colors and names only, no CSS
  functions.** Read SKILL.md's "Color and styling" before choosing colors.

### Interaction and accessibility

```
flowchart LR
  accTitle: Support flow
  accDescr {
    How a request
    reaches support
  }
  Docs --> Support --> Order
  click Docs href "https://example.com/docs" "Open the docs"
  click Support href "https://example.com/support" _blank
  click Order call showOrder("42") "Show the order"
```

- `click X href "url"` takes an optional tooltip and an optional target
  (`_blank`, `_self`, `_top`, `_parent`). `click X "url"` is the same without `href`.
  Only `http:`, `https:`, `mailto:` and relative URLs are allowed.
- `call` hands the function name and argument to the host page's `onClick` handler.
  Siren never runs it. `click X fn` is shorthand for `click X call fn()`.
- `accDescr: text` and the multi-line `accDescr { … }` both work.

## Sequence diagram

Header: `sequenceDiagram`. Keywords (`participant`, `note`, `loop`, `end`, ...) may be
written in any case.

A participant you don't declare is created where it is first named, labeled with its id.
Lanes run left to right in the order participants are first named, so declare them up
front when you want a specific order or a label (`participant A as Alice`).

```
sequenceDiagram
  title: Checkout
  box Blue Storefront
    actor Shopper
    participant Web
  end
  participant Orders as Order service
  participant Payments
  links Payments: {"Docs": "https://example.com/pay", "Status": "https://example.com/status"}
  autonumber
  Shopper->>Web: Open checkout
  Web->>+Orders: Create order
  Orders->>Orders: Validate items
  Orders-->>-Web: Order ready
  autonumber off
  loop Every attempt
    Web->>Payments: Authorize
    alt approved
      Payments-->>Web: Approved
    else declined
      Payments-xWeb: Declined
    end
  end
  note right of Payments: Card network
  create participant Receipt
  Web->>Receipt: Build receipt
  destroy Receipt
  Receipt-->>Web: Receipt ready
  Web-->>Shopper: Done
```

### Messages

| Arrow    | Meaning                     |
| -------- | --------------------------- |
| `->`     | Solid line, no arrowhead    |
| `-->`    | Dotted line, no arrowhead   |
| `->>`    | Solid line, arrowhead       |
| `-->>`   | Dotted line, arrowhead      |
| `<<->>`  | Solid, both directions      |
| `<<-->>` | Dotted, both directions     |
| `-x`     | Solid, cross (lost message) |
| `--x`    | Dotted, cross               |
| `-)`     | Solid, open arrow (async)   |
| `--)`    | Dotted, open arrow          |

Every message needs a `:` (`A->>B:` with empty text is fine; `A->>B` is refused). Ids
are word characters only, so no quoted or hyphenated participant ids. The message text
is everything after the first `:`, so it may contain more colons and
`%%`. A message's id is `Sender-Receiver`, so a reply has a different id from the
request. `+` after the arrow activates the receiver, and `-` deactivates the sender.

### Other statements

- Blocks: `loop`, `alt` / `else`, `opt`, `par` / `and`, `critical` / `option`, `break`,
  `rect <color>`, where the color must be `rgb(…)` or `rgba(…)` (`rect #hex` and
  `rect blue` are refused). Close every block with `end`. Blocks can nest. Timeline ids are
  `loop:1`, `alt:1`, and so on, numbered per keyword.
- `box <color> <label>` ... `end` groups participant declarations (`box:1`, ...). Both
  are optional, and the color may be a name, `#hex`, `rgb()` or `transparent`.
- `activate X` and `deactivate X`. The timeline names activation bars `activation:1`,
  ... in the order they open, across all participants.
- Notes: `note right of X: text`, `note left of X: text`, `note over X,Y: text`
  (`note:1`, ... in source order).
- `create participant X` / `create actor X` starts a lifeline mid-diagram, and
  `destroy X` ends it with a closing box. Rules:
  - `create` must come before anything else names X.
  - The message right after `create X` must be sent **to** X. The one right after
    `destroy X` must be sent by or to X.
  - Nothing may stand between a `create` or `destroy` and its message: no note,
    activation, `autonumber`, block boundary or other `create`/`destroy`.
  - A `create` or `destroy` with no message after it at all draws nothing and is warned
    about.
- `link X: Label @ https://...` and `links X: {"Label": "https://…", …}` add links to a
  participant. Two or more links show as a hover menu.
- `autonumber`, `autonumber off`, `title text` or `title: text`, `accTitle: text`,
  `accDescr: text` and `accDescr { … }`.

## Class diagram

Header: `classDiagram` (or `classDiagram-v2`).

```
classDiagram
  direction LR
  namespace catalog {
    class Media {
      <<abstract>>
      +String title
      #int duration
      -bool licensed
      +play()*
      +describe() String
    }
    class Track {
      +String artist
      +remix(Track other) Track
    }
  }
  namespace store.shelves {
    class Shelf~T~ {
      -List~T~ items
      +add(T item)
      +count()$ int
    }
  }
  class Playable {
    <<interface>>
    +play()
  }
  class Artwork { +String url }
  Listener : +String name
  Media <|-- Track
  Track ..|> Playable
  Shelf "1" *-- "0..*" Media : holds
  Listener --> Media : rates
  Media o-- Artwork
  Listener ..> Shelf
  Artwork .. Listener
  Player ()-- Playable
  note for Shelf "One shelf per kind"
  classDef external fill:#3b82f633
  cssClass "Artwork" external
  style Track fill:#f59e0b33
  click Track call showDetails("track")
```

- Visibility: `+` public, `-` private, `#` protected, `~` package. `*` after a member
  marks it abstract (drawn in italics) and `$` static (underlined). A return type after a
  method is drawn `+describe() : String`.
- Relationships: `<|--` inheritance, `*--` composition, `o--` aggregation, `-->`
  association, `--` link, `..>` dependency, `..|>` realization, `..` dashed link,
  `()--` lollipop interface. Each also works reversed (`--|>`, `--*`, `--o`, `<..`,
  `--()`) and two-way (`<|--|>`, `*--*`). Add cardinalities in quotes and a label after
  `:`.
- `class A["Display name"]` gives a class a label. `note "text"` with no `for` is a
  floating note.
- `direction` takes `TB`, `BT`, `LR` or `RL` in capitals; `TD` is refused here.
- Generics use `~T~`, on a class or a relationship end (`Shelf~T~ --> Media`). A class
  keeps the generic it was first named with: adding or changing it later is an error, and
  nested generics (`A~List~int~~`) are refused.
- `class A { … }` may open and close on one line. `class X:::name` applies a class, but
  only on a `class` declaration: a standalone `X:::name`, `:::` in a relationship, and
  `class A,B name` are refused. Use `cssClass "A,B" name` for several classes.
- Namespaces may nest (`namespace a { namespace b { … } }`) or use a dotted name
  (`namespace a.b { … }`). Each frame gets its own `namespace:N`, numbered in the order
  the blocks open, outer first. A namespace opened twice is one frame. A namespace may
  hold only classes, notes and namespaces, and may not be empty.
- One member per line in a class block, and no `;` in an inline member
  (`A : +int x`). An annotation (`<<interface>> A`) must come after the class is
  declared; a class takes one annotation, and `A : <<interface>>` is refused.
- Interaction: `click X href "url" "tip"`, `click X call fn() "tip"`, `link X "url" "tip"`
  and `callback X "fn" "tip"`. The flowchart shorthands `click X "url"` and `click X fn`
  are refused here.
- A relationship's id is `Left-Right` in the order written: `Media <|-- Track` is
  `Media-Track`. Notes are `note:1`, ...
- A long relationship label wraps by itself at about 150px. Class names, members and
  notes don't wrap. `<br>` forces a break.

## State diagram

Header: `stateDiagram-v2` (or `stateDiagram`).

```
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle : waiting for work
  Idle --> Running : job arrives
  state Running {
    [*] --> Fetching
    Fetching --> Saving
    Saving --> [*]
  }
  Running --> Check
  state Check <<choice>>
  Check --> Done : ok
  Check --> Failed : error
  state Fanout <<fork>>
  Failed --> Fanout
  Fanout --> Alert
  Fanout --> Log
  state Merge <<join>>
  Alert --> Merge
  Log --> Merge
  Merge --> [*]
  Done --> [*]
  note right of Failed : retried later
  note left of [*] : entry point
  state "Waiting for approval" as Pending
  Idle --> Pending
  state Parallel {
    [*] --> A
    --
    [*] --> B
  }
  classDef warn fill:#f59e0b33
  class Failed warn
  style Done fill:#22c55e33
```

- `[*]` is the start or end of its nesting level: `start:1`, `end:1`, and so on. A
  transition from the start is `start:1-Idle`. Levels are numbered in the order they
  open, the document's own level first. `note … of [*]` hangs on the level's start.
- `Name : text` draws the text in place of the state's name; several such lines stack.
  The timeline id stays `Name`.
- In a composite split by `--`, the composite takes a `[*]` level number and each region
  the next: `state X { [*] --> A -- [*] --> B }` under the root gives `start:3` and
  `start:4`, not `start:2`.
- `direction` also works inside a composite or region.
- `--` inside a composite state splits it into concurrent regions (`region:1`, ...).
- `state "Label" as Id` gives a state a display name. Its timeline id is `Id`.
- Notes may span lines (`note right of X` … `end note`).
- Styling: `classDef`, `class` and `style` work. **Don't use `:::`**: `A:::hot --> B`
  draws only a state `A` with no error, and `state A:::hot` is refused. Apply classes
  with `class A hot`.
- Don't name a state `href`, `default` or `stateDiagram`.
- Several statements may share a line and a bare word declares a state, so a Mermaid
  line Siren doesn't know can turn into boxes without an error: `hide empty description`
  draws three states. Leave such lines out.
- A long description, display name or note wraps at about 175px, a transition label at
  about 150px. `<br>` forces a break.

## ER diagram

Header: `erDiagram`.

```
erDiagram
  direction LR
  CUSTOMER["Customer account"] {
    string id PK "account number"
    string name
    string email UK
  }
  subgraph fulfilment
    ORDER {
      int number PK
      string customer_id FK
    }
    LINE-ITEM {
      int quantity
    }
  end
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  LINE-ITEM }o--|| PRODUCT:::catalog : names
  CUSTOMER |o..o| ADDRESS : "billed to"
  PRODUCT one to zero or many LINE-ITEM : "appears in"
  classDef catalog fill:#3b82f633
  style fulfilment fill:#64748b22
```

- Cardinality markers: `||` exactly one, `|o` / `o|` zero or one, `}|` / `|{` one or
  more, `}o` / `o{` zero or more. `--` is an identifying relationship and `..` is a
  non-identifying one. Word forms also work: `one`, `only one`, `1`, `zero or one`,
  `one or zero`, `many`, `one or many`, `zero or many`, `1+`, `0+`, `many(0)`, `many(1)`
  joined by `to` (identifying) or `optionally to`, `.-`, `-.` (non-identifying). A
  cardinality word can't be an entity name.
- Every relationship needs a non-empty label after `:`.
- Attributes: `type name`, optionally followed by keys `PK`, `FK`, `UK` (comma-separated)
  and a quoted comment.
- `NAME["Display name"]` is an alias. The timeline still uses `NAME`. A `%` in a quoted
  name or alias is refused. A quoted entity name (`"Customer Account"`) works, but its
  space keeps it out of the timeline, so prefer an alias.
- A relationship's id joins the entity names with a colon: `CUSTOMER:ORDER`.
- `subgraph` groups entities (`subgraph:1`, ...), with an optional title
  (`subgraph s1 [Title]`). Subgraphs may nest. A relationship end may name a subgraph to
  draw to its frame.
- `direction` takes `TB`, `BT`, `LR` or `RL`. Don't write `direction TD`, `title` or
  `click` here: each is silently read as entity names (`direction TD` draws entities
  `direction` and `TD`).
- Styling: `classDef`, `class`, `:::` (on an entity or a relationship end) and `style`.
  `style CUSTOMER:ORDER` is refused: a relationship can't be styled. These all work,
  including on a subgraph's handle written below it. ER values are the strictest; see
  [Style values](#style-values).
- `accTitle`, `accDescr` and `accDescr { … }` work.
- A long relationship label wraps by itself at about 171px. Entity names, aliases and
  comments don't wrap. `<br>` forces a break.

## Style values

The value after `style X`, `classDef name` or `linkStyle N` is checked strictly,
because Mermaid draws nothing at all for a document with a bad one.

| Diagram | Allowed | Refused |
| ------- | ------- | ------- |
| Flowchart | hex colors, color names, numbers, `px`, `'single quotes'` | any function (`rgb(`, `var(`, `hsl(`), `"`, `[ ]`, `{ }`, `\|`, `@`, `--`, `->`, `=`, `~` |
| ER | letters, digits, `#`, `-`, `_`, `*`, `:`, `,`, a final `;` | `.` (so `1.5px`), `!important`, quotes, `%`, `/`, any function, a space inside a value (`5 5`), a trailing space, an empty declaration (`fill:red,`) |
| Class, state | hex, names, numbers with units, quoted family names, `!important`, and the color, math, `var` and gradient functions | any other function |

The safe subset everywhere: `fill:#3b82f633,stroke:#3b82f6,stroke-width:2px,color:#1e293b`.

## Not supported

These fail with an error. Rewrite them or leave them out.

- Diagram types other than the five above, such as `gantt`, `pie`, `mindmap`,
  `gitGraph` or `journey`.
- Settings from front matter or `%%{init}%%` (themes, `htmlLabels`, `curve`, …): read and
  warned about, never applied.
- Flowchart: the curves `cardinal`, `bumpX`, `bumpY`, `catmullRom`, `monotoneX`,
  `monotoneY` and `natural`; images from any URL other than `data:`; icons from a pack the
  page doesn't pass.
- Flowchart: edge arrows whose two ends don't match (`o--x`); `style` or `click` on an
  edge id; non-ASCII node ids; `javascript:` and other URL schemes in `click`.
- Sequence: `participant A@{ "type": … }`, `autonumber` with arguments, `par_over`,
  half-arrows, central connections `()`, `properties`, a message without `:`, a
  non-`rgb()` `rect` color.
- Class: standalone `X:::name`, `class A,B name`, `linkStyle`, `title`, two annotations
  on one class, the flowchart `click` shorthands.
- State: `:::` (silently misdrawn, see above), `click`, `scale`, `note over`,
  `<<start>>` / `<<end>>`, hyphenated ids.
- ER diagram: the `u` cardinality (`u--o{`), `classDef default`, `style` on a
  relationship, a relationship without a label.

This list isn't complete. If Siren rejects a line that is valid Mermaid, the
construct isn't implemented yet: find an equivalent supported form, or tell the user.
