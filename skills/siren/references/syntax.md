# Siren diagram syntax

Siren follows Mermaid's syntax for five diagram types. This file lists what Siren
supports. Siren rejects any construct it doesn't implement with an
`Unrecognized ... line` error instead of drawing it incorrectly, so always run the
validator.

Each example below is a complete document that validates.

## Contents

- [Flowchart](#flowchart)
- [Sequence diagram](#sequence-diagram)
- [Class diagram](#class-diagram)
- [State diagram](#state-diagram)
- [ER diagram](#er-diagram)
- [Not supported](#not-supported)

## Flowchart

Header: `flowchart` or `graph`, followed by `TB`, `TD` (same as `TB`), `BT`, `LR` or
`RL`.

### Nodes

A node is an id followed by an optional shape with a label. The id is what the timeline
uses. Ids may contain letters, digits, `_`, `-` and `.`.

```
flowchart LR
  A[Rectangle] --> B(Rounded) --> C([Stadium]) --> D[[Subroutine]]
  D --> E[(Database)] --> F((Circle)) --> G(((Double circle)))
  G --> H{Decision} --> I{{Hexagon}} --> J>Flag]
  J --> K[/Parallelogram/] --> L[\Alt parallelogram\]
  L --> M[/Trapezoid\] --> N[\Alt trapezoid/]
  N --> O["Quoted label, with commas"]
  O --> P["`**Markdown** label`"]
  Q
```

- A node defined once can be referenced by id alone afterwards.
- A bare id on its own line (`Q`) declares a node labeled with its id.
- Quote a label that contains punctuation such as `,`, `(`, `[` or `:`.

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
  M -->|label| N
  N -- label --> O
  O -. label .-> P
  P ==>|label| Q
```

- Chains: `A --> B --> C`. Fan-out and fan-in: `A --> B & C`, `B & C --> D`.
- `;` separates statements on one line: `A --> B; B --> C`.
- Each edge gets its own id, `A-B`, and repeats of the same pair get `A-B#2`, ...

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
  `subgraph` lines appear. The name or id you write is not its timeline id.
- An edge may start or end at a subgraph. Its id uses the subgraph's written id:
  `checks-Deploy`.
- `direction` inside a subgraph lays it out independently.

### Styling

```
flowchart LR
  classDef stage fill:#dbeafe,stroke:#3b82f6,stroke-width:2
  classDef terminal fill:#1e293b,stroke:#0f172a,color:#f8fafc
  Source:::terminal --> Parse --> Layout --> Output[(Output)]:::terminal
  class Parse,Layout stage
  style Output stroke:#f59e0b,stroke-width:3
  linkStyle default stroke:#94a3b8
  linkStyle 0 stroke:#f43f5e
  linkStyle 1,2 stroke:#3b82f6,stroke-width:3
```

- `:::name` goes after the node's shape: `Output[(Output)]:::terminal`.
- `linkStyle` numbers edges from 0 in the order they're written.

### Interaction and accessibility

```
flowchart LR
  accTitle: Support flow
  accDescr: How a request reaches support
  Docs --> Support --> Order
  click Docs href "https://example.com/docs" "Open the docs"
  click Support href "https://example.com/support" _blank
  click Order call showOrder("42") "Show the order"
```

- `click X href "url"` takes an optional tooltip and an optional target
  (`_blank`, `_self`, `_top`, `_parent`). The shorthand `click X "url"` leaves out
  `href` and takes the same tooltip and target. A tooltip shows on hover.
- `call` hands the function name and argument to the host page's `onClick` handler.
  Siren never runs it. `click X fn` is shorthand for `click X call fn()`.

## Sequence diagram

Header: `sequenceDiagram`. Keywords (`participant`, `note`, `loop`, `end`, ...) may be
written in any case, as in Mermaid.

A participant you don't declare is created where it is first named, labeled with its id.
Lanes run left to right in the order participants are first named, so declare them up
front when you want a specific order or a label (`participant A as Alice`). A declaration
after the first mention still sets the label and kind, but doesn't move the lane.
`create participant X` must come before anything else names X.

```
sequenceDiagram
  title Checkout
  box Blue Storefront
    actor Shopper
    participant Web
  end
  participant Orders as Order service
  participant Payments
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

The message text is everything after the first `:` to the end of the line, so it may
contain more colons. A message's id is `Sender-Receiver`, so a reply is a different id
from the request.
`+` after the arrow activates the receiver, and `-` deactivates the sender.

### Other statements

- Blocks: `loop`, `alt` / `else`, `opt`, `par` / `and`, `critical` / `option`, `break`,
  `rect <color>`. Close every block with `end`. Blocks can nest. The timeline ids are
  `loop:1`, `alt:1`, and so on, numbered per keyword.
- `box <color> <label>` ... `end` groups participant declarations (`box:1`, ...).
- `activate X` and `deactivate X`. The timeline names activation bars `activation:1`,
  `activation:2`, ... in the order they open, across all participants.
- Notes: `note right of X: text`, `note left of X: text`, `note over X,Y: text`.
  The timeline names notes `note:1`, `note:2`, ... in source order.
- `create participant X` / `create actor X` starts a lifeline mid-diagram, and
  `destroy X` ends it.
- `link X: Label @ https://...` adds a link to a participant.
- `autonumber` and `autonumber off`, `title`, `accTitle`, `accDescr`.

## Class diagram

Header: `classDiagram`.

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
  class Playable {
    <<interface>>
    +play()
  }
  class Shelf~T~ {
    -List~T~ items
    +add(T item)
    +count()$ int
  }
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
  classDef external fill:#dbeafe,stroke:#3b82f6
  cssClass "Artwork" external
  style Track stroke:#f59e0b
  click Track call showDetails("track")
```

- Visibility: `+` public, `-` private, `#` protected, `~` package. `*` after a method
  marks it abstract, and `$` marks it static.
- Relationships: `<|--` inheritance, `*--` composition, `o--` aggregation, `-->`
  association, `--` link, `..>` dependency, `..|>` realization, `..` dashed link,
  `()--` lollipop interface. Add cardinalities in quotes and a label after `:`.
- Generics use `~T~`.
- A relationship's id is `Left-Right` in the order written: `Media <|-- Track` is
  `Media-Track`.
- `namespace:1`, `note:1`, ... are the generated ids for namespaces and notes.

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
  state "Waiting for approval" as Pending
  Idle --> Pending
  state Parallel {
    [*] --> A
    --
    [*] --> B
  }
```

- `[*]` is the start or end of its nesting level. The timeline ids are `start:1`,
  `end:1`, and so on. A transition from the start is `start:1-Idle`. Use `--ids` to
  find which number belongs to which level.
- `Name : text` adds a description line to a state.
- `--` inside a composite state splits it into concurrent regions (`region:1`, ...).
- `state "Label" as Id` gives a state a display name. Its timeline id is `Id`.
- Styling: `classDef`, `class` and `:::` work as in flowcharts. `style` is not supported.

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
  LINE-ITEM }o--|| PRODUCT : names
  CUSTOMER |o..o| ADDRESS : "billed to"
  PRODUCT one to zero or many LINE-ITEM : "appears in"
```

- Cardinality markers: `||` exactly one, `|o` / `o|` zero or one, `}|` / `|{` one or
  more, `}o` / `o{` zero or more. `--` is an identifying relationship and `..` is a
  non-identifying one. Word forms such as `one to zero or many` also work.
- Attributes: `type name`, optionally followed by keys `PK`, `FK`, `UK` (comma-separated)
  and a quoted comment.
- `NAME["Display name"]` is an alias. The timeline still uses `NAME`.
- A relationship's id joins the entity names with a colon: `CUSTOMER:ORDER`.
- `subgraph` groups entities (`subgraph:1`, ...).

## Not supported

These fail with an error. Rewrite them or leave them out.

- Diagram types other than the five above, such as `gantt`, `pie`, `mindmap`,
  `gitGraph` or `journey`.
- YAML front matter (`---` ... `---`) before the header.
- Flowchart shape syntax `A@{ shape: ... }`. Use the bracket shapes instead.
- State diagram: `style` statements.
- ER diagram: the `u` cardinality (`u--o{`), styling a relationship or subgraph, the
  `:::` shorthand on an entity, `classDef default`, a multi-line `accDescr { ... }`, and
  a backticked attribute name that spans lines.

This list isn't complete. If the validator rejects a line that is valid Mermaid, the
construct isn't implemented yet: find an equivalent supported form, or tell the user.
