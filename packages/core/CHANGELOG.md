# Changelog

All notable changes to `siren-core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

Breaking for a flowchart document whose `timeline:` names an id that a node and an edge are both
stamped with (the node `A-B` beside the edge `A --> B`), which is now refused (see **Changed**).

Breaking for a flowchart document with a class name that begins with a digit (`classDef 1c`,
`A:::1c`) or holds a `.` with no word after it, which is now refused (see **Changed**).

Breaking for a flowchart document with a node id that begins with a keyword such as `end`,
`style`, `class` or `graph` followed by a character other than a letter, digit or `_` (`end-x`,
`style.x`, `A --> end`), which is now refused (see **Changed**).

Breaking for a flowchart or ER document with a line that is nothing but `%%` outside its timeline
blocks, which is now refused (see **Changed**).

Breaking for a sequence document whose `destroy X` is followed by a message X neither sends nor
receives, which is now refused (see **Changed**).

Breaking for a sequence document whose `create participant X` is followed by a message not sent to
X, which is now refused (see **Changed**).

Breaking for a sequence document with a note, activation, `autonumber`, block boundary, or another
`create` or `destroy` between a `create` or `destroy` and the message after it, which is now
refused (see **Changed**).

Breaking for a flowchart document with a `%%` after a statement on the same line
(`A --> B %% note`), which is now refused (see **Changed**).

Breaking for a sequence document with a `%%` after the participant of an `activate` or
`deactivate` that names no participant known by then (`deactivate B %% note`), after a `rect`'s
color, or right after a one-character `destroy` participant (`destroy B%%note`), on the same line,
which is now refused (see **Changed**).

Breaking for a class document with a `%%` on the same line after a relationship, a note, a
`cssClass`, a `click`, `link` or `callback`, or a standalone annotation anywhere but its last line
(`A <|-- B %% note` followed by another statement); after its header, a class declaration, or a
namespace's `{` or a block's closing `}`; or after an annotation inside a class block — and for a
state document with a `%%` run straight into its header (`stateDiagram-v2%%note`). Each is now
refused (see **Changed**).

Breaking for an ER document with a `%%` on the same line after a statement
(`A ||--o{ B : places %% note`) or after its header; in a quoted entity name, an alias, a
`subgraph` line or a `style`/`classDef` declaration list; or inside an attribute block outside a
quoted comment or a backticked name. Each is now refused (see **Changed**).

Breaking for an ER document with a `%` in a quoted entity name or an alias (`A["50% off"]`,
`"A % b"`, `A ||--o{ "B % c" : r`) or in a subgraph's quoted name or title (`subgraph "s % t"`,
`subgraph s1["t % u"]`), which is now refused (see **Changed**).

Breaking for a flowchart document with an unquoted `[`, `]`, `{` or `}` inside a node label that
is not the shape's own bracket (`A[a}b]`, `A{a]b}`, `A>a{b]`, `A[[a}b]]`), or an unquoted `(` or
`)` there with no partner (`A[a)b]`, `A[a(b]`, `A{a)b}`, `A[(a)b)]`), which is now refused (see
**Changed**).

Breaking for code that reads a sequence diagram's SVG or positioned layout: a destroyed participant
is drawn with a closing box instead of an X mark, the `siren-destroy-mark` path and
`PositionedDestroyMark` are gone, and the rows after a destroying message move down (see
**Changed**).

Breaking for a class document with a `;` between two members of a class block where the text
reads as one member (`+int x; y`, `+foo(); +bar()`), which is now refused (see **Changed**).

Breaking for a class document with an empty namespace (`namespace N {` and `}` with nothing
between), which is now refused (see **Changed**).

Breaking for a flowchart document with an `&` between nodes that lacks a space on either side
(`A&B-->C`, `A &B-->C`, `A[x]&B-->C`), which is now refused (see **Changed**).

Breaking for a class document with a namespace written inside another whose timeline names a
namespace by its generated id (`namespace:N`): the ids are now numbered in the order the blocks
open, outer first, where they used to be numbered in the order the blocks closed (see **Changed**).

Breaking for a class document that opens one namespace more than once (`namespace N { class X }`
and later `namespace N { class Y }`): its blocks are now one frame under one `namespace:N` id,
where each used to be a frame and an id of its own, so the ids after it shift (see **Changed**).

Breaking for a class document with a statement other than a class declaration, a note or a nested
namespace inside a namespace (a relationship, `<<annotation>> A`, `direction`, `style`,
`classDef`, `cssClass`, `click`, `link`, `callback`, an inline member, `accTitle` or `accDescr`),
which is now refused (see **Changed**).

Breaking for a class document with a `;` in an inline member (`A : +int x; y`, `A : +foo(a; b)`),
which is now refused (see **Changed**).

Breaking for a class document with `direction TB`, `BT`, `RL` or `LR` inside a top-level line
that used to be drawn — a class label (`class A["direction LR"]`), an inline member
(`A : +direction LR`), a relationship label, a `~generic~`, a `<<annotation>>`, a note's text,
`accTitle`, `accDescr`, a `click`, `link` or `callback` string, or a `style` line; in the `%%`
comment after a `direction` statement, where it changes the direction applied
(`direction LR %% direction RL`); or split across lines, a line ending in `direction` before one
starting with the value (`A : +int direction` then `LRClass --> B`). Each is now refused (see
**Changed**).

Breaking for a class document with an entity code or a character reference in a member
(`+#lt; x`, `+foo(#9829;)`, `+&lt x`), which used to be drawn as written and is now drawn decoded,
`+< x`, `+foo(♥)` and `+< x` (see **Changed**).

Breaking for a class document with `direction TD`, which used to be read as `direction TB`, and
for one with text after the `}` that closes an `accDescr { ... }` block on its line
(`accDescr { d } class C`), which used to be read as the next statement. Each is now refused (see
**Changed**).

Breaking for a class document with a nested generic on a class name (`class A~List~int~~`), which
used to be drawn `A<List<int>>` and is now refused, and for one with an entity code or a character
reference in a class name's generic (`class A~#lt;~`), which used to be drawn as written and is now
drawn decoded, `A<<>` (see **Changed**).

Breaking for a class document with a method that declares a return type, which used to be drawn
`+foo() bool` and is now drawn `+foo() : bool`, its box sized from that text (see **Changed**).

Breaking for a class document that gives a class a generic after first naming it without one
(`class A` then `class A~T~`), which used to draw `A<T>`, and for one with a `<` opening a tag in
a class name's generic (`class A~List<int>~`), which used to draw `A<List<int>>`. Each is now
refused (see **Changed**).

Breaking for a class document that gives a class a generic other than the one it was first named
with (`class A~T~` then `class A~U~`, `A~U~ --> B` or `A~U~ : +x`), or a second, different
annotation (`<<interface>> A` then `<<service>> A`), each of which used to draw the first with a
warning and is now refused (see **Changed**).

Breaking for a class document with a classified member (`+x$`, `+run()*`), which used to be drawn
with the `$` or `*` at the end of its text (`+x$`) and is now drawn without it, the whole line
underlined for `$` and in italics for `*`; and for one with a method whose classifier stands right
after its `)` (`+foo()* bool`), which used to be drawn `+foo() : * bool` (see **Changed**).

### Added

- A flowchart edge may be written with an id of its own (nook `01M51XADJK`): `A e1@--> B`, before
  any arrow spelling, before a label in either spelling (`A e1@-->|x| B`, `A e1@-- x --> B`) and on
  each link of a chain (`A e1@--> B e2@--> C`). The edge is drawn and stamped `data-siren-id="e1"`
  in place of `A-B`, and a `timeline:` names it by that id. A pair's repeats are still numbered
  across every edge between it, named or not, so naming one edge never renumbers another
  (`A e1@--> B` then `A --> B` is `e1` and `A-B#2`, as Mermaid 12.2.0 numbers them). Each used to
  be refused, saying to leave the id out.
- An `@{ … }` block on an edge id written below the edge (`e1@{ … }`) is read as that edge's data:
  a key other than `animate`, `animation` and `curve` is ignored with a warning, as Mermaid 12.2.0
  ignores it; those three are refused as not drawn yet. The block used to be refused whole.
- A flowchart class name may hold what Mermaid 12.2.0 styles (nook `01M51Q7FSS`, measured in
  headless Chrome): a `-` (`c-d`, `-c`, `c-`), a `.`, `#` or `+` between words (`c.d`, `c#d`,
  `c+d`), a non-ASCII letter (`cé`) or a `\`, in `classDef`, `class` and `:::` alike, each applied
  as its name says; and `classDef c,d …` defines both `c` and `d`. Each used to be refused as an
  unrecognized line.
- More flowchart lines are read as Mermaid 12.2.0 reads them (nook `01M51Q7FK5`): a `%%` where an
  endpoint begins — after an arrow, its `|label|`, or an `&` with a space on each side — is the
  start of an id, not a comment (`A --> %%B`, `A -->|l| %%B`, `A & %%B --> C`, `A --> %%`), and a
  group of nodes joined by `&` with no arrow draws each node as a line of its own would
  (`A & B`, `A[x] & B{y}:::hot`, `A@{ shape: circle } & B`). Each used to be refused, as a
  mid-line `%%` or an unrecognized line. A `%%` anywhere else after a space (`A %%B`,
  `A --> B %%x`) is still refused, and an arrowless group whose `&` is not spaced on each side
  (`A&B`, which Mermaid draws as the one node `A&B`) gets the spacing error an edge's group gets;
  an `&` with no node on one side (`& A`, `A &`) is refused saying so.
- A flowchart node's `@{ … }` data block is read as Mermaid 12.2.0 reads it, for what Siren can
  draw (nook `01M51Q7F65`): `shape:` takes the 45 names that are one of the fourteen node shapes
  (`rect`, `rounded`, `stadium`, `fr-rect`, `cyl`, `circle`, `diam`, `hex`, `lean-r`, `lean-l`,
  `trap-b`, `trap-t`, `dbl-circ`, `odd` and their aliases, such as `db`, `decision` or
  `subroutine`), and `label:` gives the node's text, read as a Markdown string unless
  `labelType` is `text` or `string`. The block's text is YAML (a one-line block a flow mapping, a
  block across lines block YAML, a line break inside a quoted string a `<br/>`), and it may be
  written on a line of its own or at either end of an edge, after a bracket or a `:::name`
  (`A[x]:::c@{ shape: circle }`), and on a node written before, whose text it keeps. A shape
  Siren does not draw yet (`cloud`, `doc` and the rest), a name that is no shape (`foo`, `Rect`,
  `lean_right`), the keys `icon`, `img`, `form`, `pos`, `w`, `h` and `constraint`, a block that is
  not YAML, a space before the `@`, text after the `}`, a second block, a block never closed and a
  block on a subgraph's id are each refused at the `@` or the text, saying what to write instead;
  another key is ignored with a warning. Each used to be refused as `@{ … }` not supported yet. A
  node with a block followed by `& B` and no arrow gets the error a bare `A & B` line gets; a
  block never closed is read to the end of the document, and many blocks written across lines are
  read, in time linear in the document.
- A dotted class namespace name (`namespace N.M { class A }`) is read as Mermaid 12.2.0 reads it
  (nook `01M51B43T8`): the `M` inside N, drawn as the frame N around the frame M, the same picture
  as the nested spelling. An `N` no block opens is created, titled `N` and numbered before `N.M`;
  one that a block does open is merged with it, written before or after. A bracketed label titles
  the last part only (`namespace N.M["Leaf"]`), a dotted name works inside another namespace
  (`namespace N { namespace M.K { … } }` is three levels), and a space beside a dot is read as
  none (`N. M`). A name with an empty part (`.N`, `N.`, `N..M`), which Mermaid refuses, is refused
  at the name with the name to write instead. Each used to be refused as an unrecognized line.
- A class namespace written inside another (`namespace N { namespace M { class A } }`, on lines of
  their own or on one line) is drawn as Mermaid 12.2.0 draws it (nook `01M51B43CP`): the frame N
  around the frame M around A, as nested clusters in the layout core, the outer frame painted first
  and drawn even when it holds no class of its own. Each frame keeps its own label and its own
  `data-siren-id`, so a timeline reaches the outer frame too. A namespace is known by its qualified
  name (decision `01M51B4M3C`): the `M` inside N is `N.M`, and a top-level `namespace M` is another
  frame. `ClassNamespace` gains `name` (its own name) and `parentId`, and its `id` is the qualified
  name; `ResolvedClassNamespace` gains `parentId`. Siren used to draw only the innermost frame.
- More flowchart subgraph headers are read as Mermaid 12.2.0 reads them (nook `01M4ZY2D3D`): a
  word glued to a quoted title runs on from it (`subgraph "t"zz` is the handle and title `tzz`,
  `subgraph "t"zz yy` the title `tzz yy` under no handle), and a quoted handle may carry a
  bracketed title (`subgraph "t" [x]` and `subgraph "t"[x]` are the handle `t` and the title `x`;
  a handle holding a space, `subgraph "a b" [x]`, is none). Each used to be refused.
- A flowchart `direction` with text after its value (`direction LR zz`, `direction LRzz`) is read
  as Mermaid 12.2.0 reads it: inside a subgraph the value lays the block out and the text is
  ignored with a warning; outside one the whole line is ignored with the warning a top-level
  `direction` already gives. It used to be refused (nook `01M4ZY2D3D`).
- A flowchart subgraph title of several words is read as Mermaid 12.2.0 reads it (nook
  `01M4ZWT89B`): a quoted title with words after it (`subgraph "t" zz`) is the title `t zz`, and
  an unquoted run (`subgraph S a & b`, `subgraph S a b c`) is the whole run, both under a generated
  id, so the block has no handle of its own and a timeline reaches it by that generated id, as it
  does any subgraph without one. An unquoted word may hold letters and digits in any script, the
  punctuation `_&.!:?/#*+'$^\%-` and a backtick, the characters Mermaid reads there. Such a line
  used to be refused.
- A flowchart `direction LR` outside any subgraph is drawn as Mermaid 12.2.0 draws it, in the
  header's direction, with a warning that the line does nothing and that the direction belongs on
  the header, spelled with the header's own keyword (`flowchart LR`, or `graph LR` under a `graph`
  header). It used to be refused.
- A `%` in a flowchart id is read as Mermaid 12.2.0 reads it (nook `01M4ZWT8PR`): it is an id
  character anywhere (`A%B --> C`, `%A`, `A%`, `A-->B%C`, `A%B[lbl]`), in every statement that names
  an id (`class`, `style`, `click`, `:::`, a subgraph's handle), and a `%%` glued to the end of an
  id is the id's (`A%%B`, `A%%B --> C`, `A-->B%%C`, `A%%`). Such a line used to be refused, a glued
  `%%` as a mid-line comment. A `%%` written after a space or a bracket (`A %% x`, `A[x]%%B`) is
  still refused as one. An `o`, `x` or `.-` right after a `%` is the id's too (`A%x--xB` is the node
  `A%x`, `A%.-B` one node), and `A%>a]` is an asymmetric node `A%`. A `class` statement's targets
  also take a `-` (`class a-b,c hot`), as every other statement naming an id already did. A timeline
  names such a node by its id: in a flowchart, a `%%` glued to an action's target no longer cuts the
  line, so `enter A%%B fade` names `A%%B`, where it used to name `A`. A `%%` anywhere else in a
  timeline line (`enter A fade%% note`), and every `%%` in another kind's timeline, still starts a
  comment.
- A document may open with a Mermaid frontmatter (`---` … `---`), read as Mermaid 12.2.0 reads it,
  each rule measured with the probe: only at the very top, optionally indented, closed by the first
  `---` at the same indent, and parsed as YAML under the JSON schema (with `js-yaml`, now a
  dependency). Such a document used to be refused with `found "---"` (nook `01M4XSF9C`). Its
  `config` (with a top-level `displayMode` folded into `config.gantt.displayMode`) is kept on
  `ParseResult.config`, `{}` when there is none, but **not applied yet**: each top-level config key,
  and a `title`, is reported as a warning at the opening fence. A `config` that is not a mapping
  (`config: foo`) is ignored with a warning; Mermaid draws such a document too. A key Mermaid does
  not know, such as `siren:`, is dropped in silence, as Mermaid drops it. A frontmatter that is not
  valid YAML, or whose `displayMode` would have to be written into a `config` or `config.gantt`
  that is a scalar (`gantt: true`), refuses the document with an error, as Mermaid refuses it. Line
  and column numbers of every other diagnostic still point at the lines the author wrote
  (ADR-0017). The standalone bundles' `THIRD-PARTY-NOTICES.md` now carries js-yaml's MIT licence.
- `%%{init: ...}%%` (and `%%{initialize: ...}%%`) directives are read as Mermaid 12.2.0 reads them,
  each rule measured: their arguments are JSON once every `'` is made `"`, several are merged in
  order, and an init's `config` is filed under the diagram type's key (`flowchart`, `sequence`,
  `classDiagram`, `stateDiagram`, `er`). The result is merged over the frontmatter's config on
  `ParseResult.config`, the init winning where both set a value, and a `%%{wrap}%%` reads as
  `wrap`. Nothing is **applied yet**: each top-level key is reported as a warning at the directive
  that decided it, or at the frontmatter's opening fence. An init that is not valid JSON is
  reported, and then, as in Mermaid, no init in the document is read; the diagram is still drawn.
  A directive Mermaid does not read (`%%{foo}%%`) is removed with a warning. A `%%{wrap}%%` beside
  a lone bare-word init (`%%{init: dark}%%`) refuses the document with an error at the wrap
  directive, as Mermaid refuses it ("Cannot create property 'wrap' on string 'dark'"). A lone
  init holding a list (`%%{init: [1, 2]}%%`) reads as its items under their indexes, as Mermaid's
  merge reads it (nook `01M4XSF9J`).
- Sequence diagrams accept the colon spelling of the title, `title: text`, in any case, as Mermaid
  12.2.0 does. A later colon stays in the title. `title:text` with no space is still rejected,
  because Mermaid rejects it too (nook `01M3NM3BT`).
- ER diagrams read `accTitle:` and `accDescr:` in any case and with whitespace before the colon
  (`ACCDESCR: hi`, `accTitle : hi`), as Mermaid 12.2.0 does (nook `01M4WAFD4`).
- Sequence diagrams read `accDescr: text` and the braced `accDescr { ... }` block, in any case,
  and draw the description as the SVG's `<desc>` with `aria-describedby` on the root, as Mermaid
  12.2.0 does. A block's lines lose their leading whitespace, an empty block is no description, and
  a block that never closes is refused. `accTitle : text`, with a space before the colon, is read
  too (nook `01M3NNNE1`).
- State diagrams read `style X decls` and paint the declarations onto the state, as Mermaid 12.2.0
  does; a comma list in the target position styles each state (nook `01M36C24S`). It used to
  refuse the whole document. Two places draw what the line says where Mermaid does not: `style A, B`
  with a space after the comma styles both (Mermaid paints `B decls` onto A), and a composite's
  frame is painted (Mermaid paints it for `class` but not for `style`).
- State diagrams read several statements on one line, as Mermaid 12.2.0 does: a bare id ends its
  statement at the whitespace after it. `Foo Bar` declares two states, `direction sideways` two
  states called `direction` and `sideways`, and `Foo Bar --> Done` Foo and the transition Bar → Done
  (nook `01M369AQW`). Such a document used to be refused outright.
- A state diagram's `class` statement reads its class name as the whole rest of the line, as
  Mermaid 12.2.0 does: `class Busy a,b` applies a class called `a,b` (which no `classDef` defines,
  so it warns and paints nothing), and `class Busy` with no name is accepted with a warning. Both
  documents used to be refused (nook `01M37GQRM`).
- State-diagram notes: `note … of [*]` hangs on the level's start pseudo-state, as Mermaid 12.2.0
  draws it (a level with no start is refused, since Mermaid cannot draw it either); the multi-line
  `note … end note` is read as one row per non-blank line; and a note's side is read in any case,
  `note LEFT OF X` drawn on the left as the line says, where Mermaid draws it on the right
  (nook `01M36DWFN`). All three used to be refused.
- State diagrams read every statement keyword in any case, as Mermaid 12.2.0 does: `CLASSDEF`,
  `CLASS`, `STYLE`, `DIRECTION` and its value (`Direction Rl`), `STATE C {` and `STATE "x" AS y`
  (nook `01M4WAFCY`). They used to be refused.
- A state diagram reads `[*]` on a line of its own as its level's start pseudo-state, as Mermaid
  12.2.0 draws it; a later `[*] --> A` leaves from the same disc (nook `01M4WSRMX`).
- Flowchart node ids may hold `-` wherever Mermaid's lexer allows it — anywhere the next
  character is not `>`, `-` or `.` — so `a-b --> c`, `a-b-->c-d`, `-a` and `a-` read as Mermaid
  12.2.0 reads them (nook `01M2SVAFT`). They used to be refused.
- Flowcharts and ER diagrams read the braced `accDescr { ... }` block, as sequence diagrams do, and
  flowcharts read `accTitle : text` and `accDescr : text` with a space before the colon (nook
  `01M4WS1P6`). ER used to refuse the block by name; a flowchart refused it.
- A class block may open and close on one line — `class A { +int x }`, `class A {}`, with a
  generic, a label or `:::name` — and its `}` may end its last member's line (`+int y }`), as
  Mermaid 12.2.0 reads both (nook `01M4ZWT8XF`). Such a block used to be refused as an unrecognized
  line or member. Text after the `}` on its line, and a member on the line below it, are refused
  as Mermaid refuses them, each error saying what to move.
- A namespace block may open and close on one line — `namespace N { class A }`, with a class block
  inside (`namespace N { class A { +x } }`) or nested (`namespace N { namespace M { class A } }`,
  though an outer namespace holding only namespaces still draws no frame of its own) — and its `}`
  may end its last statement's line (`class B }`), as Mermaid 12.2.0 reads each (nook
  `01M4ZY2DA1`). Such a namespace used to be refused as an unrecognized line. Text after its `}`
  on its line is refused as Mermaid refuses it, the error saying to move it to a line of its own.
- A class relationship's ends may carry a `~generic~` (`A~T~ --> B`, `A~T~ "1" --> "*" B~U~ :
  label`, a space before the `~` allowed), drawn `A<T>` as Mermaid 12.2.0 draws it (nook
  `01M51Q7G6R5TY4NGMMNCMJ9JVJ`). The generic is the class's only on its first mention, as there: a
  class declared or named before keeps what it had. Such a line used to be refused as unrecognized.
  On a lollipop `()` end, which names an interface, a generic is refused: Mermaid draws the
  interface's name with its tildes.
- More class-name generics are read as Mermaid 12.2.0 reads them (nook `01M51RR6AJKAR05VBT12A2BSB4`):
  after a space on a declaration (`class A ~T~`, as a relationship's end already allowed); empty, as
  none (`class A~~`, `A~~ --> B` draw `A`); on the inline member form's class (`A~T~ : +x`); and on
  a note's target when it is that class's own generic (`note for A~T~ "n"` on a class first named
  `A~T~`). Each used to be refused as an unrecognized line.
- A `<br>` in a class name's generic is drawn as a line break (nook `01M51TMV71BF1Y0EC2RS2B6ZWG`),
  as Mermaid 12.2.0 draws it: `class A~a<br>b~` draws `A<a` over `b>`, in any spelling the browser
  reads as a break (`<br/>`, `<BR>`, `<br />`). It used to be refused as a tag.

### Changed

- **A class member's classifier is drawn as a style, not as a character** (nook `01M51XAEEX`):
  Mermaid 12.2.0 draws `+x$` as `+x` underlined and `+y*` as `+y` in italics, the style on the
  whole line, visibility and return type included. Siren drew the `$` or `*` at the end of the
  text; it now leaves it out — the line measured without it — and draws the line with
  `text-decoration:underline` or `font-style:italic`, after the class's own text style. A method's
  classifier is read right after its `)` too (`+foo()* bool` is an abstract method returning
  `bool`), as well as at the end of its return type; an attribute's only as its last character,
  so `+x$ int` is drawn as written. A positioned class member carries its `classifier` beside its
  `text`.
- **A flowchart edge id is refused where it would not name the one edge it was written on** (nook
  `01M51XADJK`): on an arrow joining a group (`A & B e1@--> C`, `A e1@--> B & C`), where the id
  names only one of the edges drawn; when a node holds the same id (`e1`, `C --> e1`), or another
  edge does — written, or derived as `A-B` or `A-B#2`; and when it holds a character outside a
  node id's alphabet (`e$1`, `é1`). Mermaid 12.2.0 draws the first three other than as written
  and accepts the last; each is refused at the id.
- **An `@{ … }` block on an edge id written above the edge is refused** (nook `01M51XADJK`):
  `e1@{ … }` then `A e1@--> B` declares a node `e1` beside the edge, as Mermaid 12.2.0 draws it.
  It used to be drawn as that node, with only a warning about the block's keys.
- **A `timeline:` action naming an id more than one drawn thing holds is refused** (nook
  `01M51XADJK`): the node `A-B` and the edge `A --> B` are both stamped `data-siren-id="A-B"`, so
  `enter A-B fade` cannot say which it means. The document is still drawn; give the edge an id of
  its own (`A e1@--> B`) or rename the node. It used to animate both.
- **A flowchart class name Mermaid cannot style is refused** (nook `01M51Q7FSS`): Mermaid 12.2.0
  writes each `classDef` as the CSS rule `.<name> > *`, and a name that makes it fail to parse
  (`1c`, `c.`, `c..d`, `c:d`, `c%`, `c!`, `c/d` and the like) stops the whole diagram rendering in a
  browser. Siren drew a digit-first name such as `1c`; it now refuses every such name at the name,
  saying what a class name may hold. `class A c,d` and `A:::c,d`, which Mermaid draws unstyled as
  the one class `c,d`, are refused saying to apply one class at a time.
- A flowchart `%%` that begins a statement after a `;` (`A;%%B`, `A --> B; %%c`), which Mermaid
  12.2.0 draws as a node, is refused saying so and to move the comment to a line of its own, where
  it was told only that a mid-line `%%` is not a comment (nook `01M51Q7FK5`).
- **A flowchart node id that begins with a keyword is refused** (nook `01M51Q7FCN`): Mermaid
  12.2.0's lexer reads `style`, `linkStyle`, `interpolate`, `classDef`, `class`, `graph`,
  `flowchart`, `flowchart-elk`, `swimlane-beta`, `subgraph`, `end`, `_self`, `_blank`, `_parent`
  and `_top` as the keyword wherever an id could begin and the next character is not
  `[A-Za-z0-9_]`, so `end-x`, `style.x`, `graph%x`, `end[x]`, `end:::c` and `A --> end` are parse
  errors there, and inside a subgraph `end-x` ends the block and adds a node `-x` outside it. Siren
  drew each as the id written (and reported such a block as unterminated); it now refuses it at the
  id, naming the keyword and a fix (`endX`), as a node on its own line, at an edge's end, in an `&`
  group and as a `style` or `class` target, leaving the block open for its own `end`. Inside a
  subgraph, `end B` (which Mermaid reads as the block's end and then `B` outside it) is refused
  saying to write `end` on a line of its own, and `subgraph end` (which Mermaid reads as the
  block's own end) is refused as a title ending with `end` is. An id that only contains the word
  (`endx`, `end_x`, `End-x`, `A-end`) is unchanged, as are `click-x`, `call-x`, `href-x`,
  `default-x`, `v-x`, `direction-x`, `click end-x`, `click end` and `subgraph end-x`, which Mermaid
  reads as ids. An endpoint that is nothing but `click`, `call` or `href`, which Mermaid reads as
  that keyword before a space or a line break (`A --> click`, `click --> A`), is refused the same
  way, as is one before a space and a `;` (`A --> click ;B`); `click-x`, `click[x]` and
  `A --> click;B` are ids.
- **An entity code in a class member is drawn decoded** (nook `01M51K83X2`): Mermaid 12.2.0
  encodes each `#\w+;` before it parses and decodes it when it draws, so `+#lt; x` draws `+< x`,
  `+int #59;` `+int ;` and `+foo(#9829;)` `+foo(♥)`, in a block and inline alike, in the type, the
  name, the parameters and the return type; an unknown name stays as the reference
  (`+#zz; x` draws `+&zz; x`). The member is measured as drawn. A code may stand where the name
  does (`+x #lt;`, `+int a#lt;b`, `+#lt;foo()`), which used to be refused as an unrecognized
  member; a `~generic~` opens at a code (`+List~#lt;~ x` draws `+List<<> x`); and a `#` opening a
  code is no visibility marker (`#lt; x` draws `< x`). Mermaid escapes a member's `<` and `>` but
  not its `&`, so a character reference written in it resolves too, in the same pass as the codes
  (`+&lt x` draws `+< x`, `+a&copyb x` `+a©b x`, `+#amp;lt#59; x` `+&lt; x`); `&lt;`, with its
  `;`, is still refused by the `;` rule. The codes and references used to be drawn as written.
- **A class-diagram line holding a `direction` inside it is refused** (nook `01M51K83NB`):
  Mermaid 12.2.0's lexer reads any top-level line containing `direction TB`, `BT`, `RL` or `LR`,
  anywhere and glued or not (`xdirection LR`, `direction LRx`), as one direction statement, and
  the rest of the line is lost with no diagnostic — a class declaration, a label, an inline
  member, a relationship, a note, `accTitle`, a `click` url or tooltip. Each such line gets one
  error at its `direction`, saying to write the direction on a line of its own or reword the text.
  The rule crosses line breaks, blank lines too: a line ending in `direction` and the next line
  starting with `TB`, `BT`, `RL` or `LR` (`TBD` included) are refused together, at that
  `direction`. A class block's members, a namespace body and an `accDescr { }` block are
  untouched: Mermaid draws a `direction LR` there as written. Mermaid tries `TB`, `BT`, `RL`, `LR`
  in that order, the first found anywhere in the line winning, and the error quotes that one.
  `direction LR %% note` still reads as a direction, and so does a comment naming a direction
  that is not applied over the statement's own (`direction RL %% direction LR` is RL either way);
  one that is (`direction LR %% direction RL`, laid out right to left by Mermaid) is refused.
  `direction LR;` (and `direction LR ;`, `direction LR;;`) now reads as `direction LR`, as
  Mermaid draws it; it used to be refused as an unrecognized line, and `direction LR; class C`,
  which loses the class, is refused as above. A label, an inline member, a relationship label, a
  generic, an annotation, a note's text, `accTitle`, `accDescr`, a `click`, `link` or `callback`
  string and a `style` line holding one used to be drawn, as did a commented direction whose
  comment changes it (as the first) and a split one whose two lines each read as a statement. A
  class declaration, a relationship or `note "x"` followed by one, a glued form, `classDef`,
  `cssClass`, a mid-line `%%` and a one-line namespace were already refused, as unrecognized
  lines, a `classDef` for its declaration, a mid-line `%%` for the `%%`.
- **A space in a class namespace name is refused once, saying how to write it** (nook
  `01M51DSEXR`): Mermaid 12.2.0 drops the space, drawing `namespace N M {` as the one frame `NM`.
  The error stands at the word after the space and offers `NM` or `N_M`; the block is still read,
  so its `}` is no longer refused as well, and errors inside it are reported as usual. On a
  one-line, nested or dotted name (`N.M K`) too; a space beside a dot (`N . M`) still reads as
  none. Such a line used to be refused as unrecognized, with a second error at its `}`.
- **A `;` in an inline class member is refused** (nook `01M51DSEQ3`), as Mermaid 12.2.0's lexer
  refuses it: `A : +int x; y`, `A : +foo(a; b)`, `A : +int x;` and a `;` in a type, a return type,
  a `~generic~` or quotes each get one error at the `;`, saying to write each member on a line of
  its own. The `;` ending an entity code (`#59;`, `#lt;`) is the code's and still reads. Most
  used to be drawn as one member with no diagnostic — a `;` between members, in parentheses, a
  type, a return type or a `~generic~` (`+List~a;b~ x`, `+f() a;b`), or after a `%%`
  (`+x %% a; b`); only a member Siren could not read otherwise (`+int x;`, `"a;b"`) was refused,
  as an unrecognized member.
- **A class namespace holds only classes, notes and namespaces** (nook `01M51DSEGE`), as Mermaid
  12.2.0 reads it: any other statement in a namespace body — a relationship, `<<annotation>> A`,
  `direction`, `style`, `classDef`, `cssClass`, `click`, `link`, `callback`, an inline member
  (`A : +x`), `accTitle` or `accDescr` — is refused at that statement, with an error saying to
  move it outside the namespace. On a one-line, nested or dotted namespace too. Such statements
  used to be drawn as if written outside, and a namespace holding only `direction LR` drew no frame
  and gave no diagnostic. A line no statement reads is still refused as unrecognized, once.
- **A class `note for X` naming no class is drawn, unattached, with a warning** (nook
  `01M51DSF5H`), as Mermaid 12.2.0 draws it: `note for Ghost "x"` with no class Ghost is a note
  with no connector, and no class Ghost is made up. One written in a namespace is drawn inside its
  frame, and a namespace holding only it is framed. Such a note used to be an error and dropped. Its
  `note:N` id is unchanged, and the model gives it `targetId: null`, as for a free note.
- **A note written in a class namespace is drawn inside its frame** (nook `01M51B440V`, decision
  `01M51B4M3C`), as Mermaid 12.2.0 draws it: `note "x"` and `note for X "x"` alike, the latter
  even when X stands outside the namespace, its connector running out across the frame. In a
  nested namespace the note goes in the innermost frame around it, and in a dotted one
  (`namespace N.M`) in `N.M`'s. A namespace holding only a note (`namespace N { note "x" }`) is
  framed, where it used to draw no frame and give no diagnostic. Such notes used to be drawn
  outside every frame. A note's `note:N` id is unchanged. `ClassNamespace` gains `noteIndexes`
  and `ResolvedClassNamespace` gains `noteIds`.
- **A class namespace opened more than once is one namespace** (nook `01M51B43KA`, decision
  `01M51B4M3C`), as Mermaid 12.2.0 draws it: `namespace N { class X }` and `namespace N { class Y }`
  are one frame N around X and Y, and `N { M { A } }` with `N { M { B } }` one N around one `N.M`.
  The merged namespace keeps the `namespace:N` id and place of its first block and the last
  bracketed label written, and two of its blocks naming one class is no longer an error. Each block
  used to be a frame of its own.
- **A class namespace's generated id is numbered in the order the blocks open** (nook
  `01M51B43CP`, decision `01M51B4M3C`), outer before inner, as a flowchart's `subgraph:N` is: in
  `namespace N { namespace M { class A } }`, N is `namespace:1` and M `namespace:2`, where they used
  to be the other way round. A document whose namespaces are not nested keeps its ids.
- **A flowchart `&` between nodes needs a space on each side** (nook `01M4ZWT8PR`). Mermaid 12.2.0
  reads an `&` glued to an id as a character of it (`A&B-->C` is the one node `A&B`, `A%&B-->C` the
  node `A%&B`) and refuses one spaced on a single side or written after a bracket (`A &B-->C`,
  `B& C`, `A[x]&B-->C`). Siren used to draw each as a group; it now refuses the line at the `&`,
  with the line rewritten spaced (`A & B-->C`). An `&` inside a label is text, as before.
- **An unquoted bracket inside a flowchart node label is refused** (nook `01M4ZWT8G2`), as Mermaid
  12.2.0 refuses every unquoted `( ) [ ] { }` in any shape's label. An `[`, `]`, `{` or `}` that is
  not the shape's own (`A[a}b]`, `A{a]b}`, `A>a{b]`), and a `(` or `)` with no partner (`A[a)b]`,
  `A{a)b}`, `A[a (b) (c]`), used to be drawn; each is now an error at the bracket asking to quote
  the label (`A["a}b"]`), on a line of its own or at an edge endpoint. `A[(a)b)]` used to be drawn
  as the rect `(a)b)`. A balanced pair of parentheses outside a round shape (`A[f(x)]`, `A{f(x)}`)
  is still drawn, a recorded divergence (nook `01M4R3RVV`), and so is one inside a cylinder:
  `A[(f(x))]` is the cylinder `f(x)`, where it used to be drawn as the rect `(f(x))`. A label that
  was already refused (`A[a]b]`, `A(a)b)`, `A{{a}b}}`, `A{a@{b}}`) now gets the same error instead
  of "Unrecognized flowchart line". Two nodes written side by side (`A[x] B[y]`) are offered no
  quoting fix, since quoting would merge them; they keep the generic error.
- A flowchart refusal that used to read "Unrecognized flowchart line" now says what Siren does not
  support yet and what to write instead (nook `01M4ZWT8G2`): a node's `@{ … }` data
  (`A@{ shape: rect }`, on a line of its own or at either end of an edge) is pointed at its `@` and
  asked to write the shape with brackets (`A[text]`, `A((text))`, `A{text}`); an edge id
  (`A e1@--> B`) is pointed at and asked to be left out, with the line rewritten without it (a
  label's own text, such as `A["p q@-->r"]`, is left as written); and an
  `@{ … }` on an id an edge was given (`e1@{ animate: true }`) is asked to be left out.
- A flowchart `style`, `classDef` or `linkStyle` declaration with no `:` (`linkStyle 0 zz`,
  `linkStyle 0 interpolate basis zz`) is still refused, now saying how a declaration is written
  (`property:value`, such as `stroke:#f00`) instead of "Unrecognized style declaration" (nook
  `01M4ZWT8G2`). A value holding a space (`stroke:red zz`) is passed on as written, as before.
- A flowchart subgraph title Siren cannot read is now refused with an error saying how to fix it,
  instead of "Unrecognized flowchart line", and its `end` no longer reports a second error: words
  after a bracketed title (`subgraph s1 ["t"] zz`, refused by Mermaid 12.2.0) are pointed at and
  asked to move inside the brackets; a character an unquoted title cannot hold (`subgraph S a, b`,
  also `(`, `[`, `{`, `|`, `<`, `=`, `~`, `@`, `--`, `-.`, `:::`, each refused by Mermaid) is
  pointed at and the title asked to be quoted; and a title whose last word is `end`, which
  Mermaid reads as the block's end and swallows the next line into the title, is asked to be
  quoted (nook `01M4ZWT89B`).
- **A `%` in an ER entity's quoted name or alias is refused** (nook `01M4ZWT94S`), as Mermaid
  12.2.0 refuses it: its ER lexer reads a quoted string holding a `%` as a word only a
  relationship's label takes. `A["50% off"]`, `"A % b"` and `"B % c"` at either end of a
  relationship used to be drawn; each is now an error at the `%`, asking to remove it or spell it
  out. A subgraph's quoted name or title (`subgraph "s % t"`, `subgraph s1["t % u"]`), which
  Mermaid refuses the same way, used to be drawn too and gets the same error. A `%%` in any of
  these quoted strings gets this error as well, at its first `%`, instead of the mid-line `%%`
  error's advice to move a comment to its own line: inside quotes it is not a comment. A `%` in a
  relationship's quoted label or an attribute's quoted comment is still text, as in Mermaid.
- **Diagnostic messages no longer mention Mermaid** (nook `01M4ZJZ3FT`). Each says what is wrong and
  how to fix it. Reworded: frontmatter that is not YAML is refused "until the frontmatter is valid
  YAML", and a `displayMode` that cannot be written into a non-mapping `config` or `config.gantt` is
  refused until that key is a mapping or `displayMode` is removed; a wrap directive that cannot be
  written into a non-mapping init asks for a mapping or for the wrap directive to be removed; an
  init that is not valid JSON says every init is ignored and that every init must be valid JSON for
  any to apply; a removed directive drops "as Mermaid removes it" and says only init and wrap
  directives are read, wrap ones only while every wrap directive's arguments are valid JSON, so
  remove the directive or rewrite it to be read; an ER class-list number or reserved word says the
  line is refused and asks to rename the class; an `<img>` in a label asks for the image to be
  described in the label's text (it used to point at `A@{ img: "…" }`, which Siren refuses); a
  `linkStyle interpolate` curve Siren does not draw is now "a curve Siren does not draw yet" and
  lists the curves it does, and an unknown curve name drops "as Mermaid does". Code that matches
  diagnostic text exactly must be updated.
- **A `%%` in the middle of a flowchart line is no longer a comment** (nook `01M4Z7TQRE`). Only a
  whole line whose first non-blank characters are `%%` is a comment, as in Mermaid 12.2.0, whose
  flowchart grammar has no comment of its own. Inside text a `%%` is now kept as text — a node's
  label, an edge's label, a subgraph's title, a `click` tooltip, `accTitle`/`accDescr`, and a
  `style`/`classDef`/`linkStyle` declaration list (`A[50 %% done]` draws "50 %% done", where it used
  to be cut short and refused). After a complete statement (`A --> B %% note`, `A[a] %% x`,
  `end %% x`, `flowchart TB %% x`) the document is refused, as Mermaid refuses it, with an error at
  the `%%` saying it is not a comment and, if it is meant as one, to move it to a line of its own;
  it used to be ignored. A subgraph's bare name followed by `%%` and words (`subgraph S %% x`) is
  one title, "S %% x", with no handle, and a block's `direction LR %% x` is `direction LR`, both as
  Mermaid reads them. Timeline blocks still cut a line at its first `%%` (in a flowchart, not one
  glued to an action's target). The flowchart's readers now agree on where text runs: a `;`, `&` or
  arrow inside an asymmetric node's label (`A>a;b] --> B`) or inside a quoted string outside any
  bracket (`click A "https://x.org/a;b" "t;u"`) is text, as in Mermaid 12.2.0; both used to be
  refused.
- **A `%%` in the middle of a sequence line is no longer a comment** (nook `01M4Z7TQZ4`). Only a
  whole line is a comment, as in Mermaid 12.2.0; its sequence lexer reads a `%%` as a comment only
  where a token has ended and no text has started. Text keeps its `%%`: a message's and a note's
  text (`A->>B: 50%% done` draws "50%% done", where it used to draw "50"), a block's or branch's
  label (`loop`, `opt`, `alt`/`else`, `par`/`and`, `critical`/`option`, `break`), a box's label,
  `title`, `accTitle`/`accDescr`, a participant's `as` alias, and a `link`'s url. A participant's
  name keeps it too: `participant A %% x` declares a participant named "A %% x", so a later `A->>B`
  draws a second lane `A`; `participant A %% x as Al` is named "A %% x as Al"; and a message's
  sender or receiver, a note's participants, `create` and `destroy` name participants the same way
  (`A->>B %% x: m` is sent to "B %% x"). A `links` object followed by `%%` is no longer JSON, so it
  adds no link, with a warning, as in Mermaid. A `%%` after the header, after `end`, `autonumber` or
  `autonumber off`, or after a `;` is still a comment, as Mermaid's lexer reads it there. `activate`
  and `deactivate` read their participant's name with its `%%` too when a participant of that name
  is already known (declared, created, or named by an earlier message or note); otherwise the
  document is refused with an error at the `%%` saying it is not a comment and, if it is meant as
  one, to move it to a line of its own, as Mermaid refuses `deactivate B %% x` ("Trying to
  inactivate an inactive participant") and fails to draw `activate B %% x`. The same error refuses a
  `%%` after a `rect`'s color, which Mermaid fills with a color that is not one, and a `%%` written
  right after a one-character name where Mermaid's lexer reads it as a comment from that character
  on: a message's sender or receiver, a note's participant or a `destroy` (`A->>B%%x: m`,
  `note over A%%x: n` and `destroy B%%x` are refused by Mermaid, and `A%%x->>B: m` draws nothing for
  its line). A longer name, or a `%%` after a space, is part of the name (`A->>BC%%x: m` is sent to
  "BC%%x"). Timeline blocks still cut a line at its first `%%`.
- **A `%%` in the middle of a class or state line is no longer a comment** (nook `01M4Z7TR5R`). Only
  a whole line is a comment, as in Mermaid 12.2.0; what a later `%%` means is each lexer's. Text
  keeps its `%%`: in a class diagram a member or method (in a block or after `Class :`), a
  relationship's label, a note's quoted text, a class's quoted label, a `style`/`classDef`
  declaration list and `accTitle`/`accDescr`; in a state diagram a transition's label, a description
  (`A : desc %% x`, `state "d %% x" as A`), a note's text on one line or in a block, a
  `style`/`classDef` declaration list and `accTitle`/`accDescr` — each used to be cut at the `%%`. A
  state block note's opening line keeps what follows a `%%` as the note's first row
  (`note right of A %% x` opens a note whose first row is "%% x"), as Mermaid records it. A state
  `class` statement's class names are read one per word, as Mermaid paints them through the drawn
  node's class attribute: `class A c %% x` paints A with `c`, exactly as `class A c` does, and
  `class A u extra` paints A with `u`, where it used to be read as one class name and paint nothing.
  Each name no `classDef` defines draws nothing and is warned about, as before. What follows a class
  block's `{` on its line is now read as the block's first member, as Mermaid reads it
  (`class A { %% x` has the member "%% x"; it used to be refused). A class diagram's lexer reads a
  `%%` after `direction` as a comment, and after a relationship, a note, a `cssClass`, a `click`,
  `link` or `callback`, or a standalone annotation as a comment that swallows the line break after
  it, so Siren reads it as a comment only on the document's last line and otherwise refuses it with
  an error at the `%%` saying it is not a comment and, if it is meant as one, to move it to a line
  of its own, as Mermaid refuses the document ("Expecting 'NEWLINE', 'EOF' …"). The same error
  refuses a `%%` after a class diagram's header, a class declaration, or a namespace's `{` or a
  block's closing `}`, which Mermaid refuses on any line, and a `%%` after an annotation inside a
  class block, which Mermaid draws as a member `<> %% x` instead. A state diagram's lexer reads a
  `%%` as a comment wherever a token ends and no text has started — after the header and a space, a
  state's id, a transition, `state "d" as A`, a composite's braces, a stereotype, a `--` divider,
  `end note`, `[*]` and `direction` — on any line, as before. The error refuses a `%%` run straight
  into a state diagram's header (`stateDiagram-v2%%x`, refused by Mermaid). Timeline blocks still
  cut a line at its first `%%`.
- **A `%%` in the middle of an ER line is no longer a comment** (nook `01M4Z7TRCQ`). Only a whole
  line is a comment, as in Mermaid 12.2.0, and ER is the last kind to stop cutting a line at its
  first `%%`: every kind's parser now reads its lines as written, whole-line comments removed. The
  ER lexer has no `%` rule, so a `%%` is text only where it reads a string to its end: a
  relationship's quoted label (`A ||--o{ B : "r %% x"`), an attribute's quoted comment, a backticked
  attribute name, a generic type (`list~a %% b~`), `accTitle`/`accDescr` and the braced
  `accDescr { ... }` — each used to be cut at the `%%`. A line naming a direction is read whole as
  that direction, `%%` and all (`direction LR %% x`, and `A %% direction LR` as Mermaid's
  `.*direction\s+LR` rule reads it). Anywhere else the document is refused, as Mermaid refuses it,
  with an error at the `%%` saying it is not a comment and, if it is meant as one, to move it to a
  line of its own: after a statement or the header, in a quoted entity name or an alias (a quoted
  string holding `%` is a word only a relationship's label takes), on a `subgraph` line, in a
  `style`/`classDef` declaration list (quoted or not), and inside an attribute block outside a
  quoted comment or a backticked name. Timeline blocks still cut a line at its first `%%`.
- **A sequence `create participant X` draws X's box on its creating message**: the message right
  after it, which must be sent to X (nook `01M4YS7DMG`). X's box is now centred on that message's
  arrow, the arrow stops at the box's near edge, X's lifeline starts at the box's bottom, and
  `create` no longer takes a row of its own; the next row starts below the box. Measured against
  Mermaid 12.2.0, which reads `create` the same way and centres X's box on that arrow. Nothing may
  stand between the two: a note, an activation or a block boundary in between is refused (see
  below). For a `create` with no message after it, see below.
- **A `create participant X` whose next message is not sent to X is refused** — including one X
  sends — with an error at the `create` line: `The created participant "X" has no creating
  message: the next message must be sent to it.` Siren used to draw such a document in silence;
  Mermaid 12.2.0 refuses it. As with Siren's other sequence errors, the diagram is still drawn
  beside the error, with X's box where `create` is written.
- **A sequence `destroy X` ends X's lifeline at its destroying message**: the message right after
  it, which X must send or receive (nook `01M4YS7DDX`). X's lifeline now ends on that message's row,
  at X's closing box (see the closing-box entry below), and `destroy` no longer takes a row of its
  own. That message is no longer warned about as reaching past the end of X's lifeline; a later
  message naming X still is. Measured against Mermaid 12.2.0, which reads `destroy X` the same way
  and ends X's lifeline on that message's row. Nothing may stand between the two: a note, an
  activation or a block boundary in between is refused (see below). For a `destroy` with no message
  after it, see below.
- **A `destroy X` whose next message X neither sends nor receives is refused** with an error at
  the `destroy` line: `The destroyed participant "X" has no destroying message: the next message
  must be sent by or to it.` Siren used to draw such a document in silence; Mermaid 12.2.0
  refuses it. As with Siren's other sequence errors, the diagram is still drawn beside the error,
  with X's lifeline ending where `destroy` is written.
- **A sequence `actor`'s stick figure is a fixed 36px wide**, whatever its label (nook
  `01M4YVB29`). It used to widen with the label — arms two thirds and legs half the label's width
  plus padding — so a long name drew a sprawling figure. The label keeps its own width beneath the
  figure and may be wider than it; lane spacing still follows the label. The creating message of
  a created actor now stops at the figure's near arm tip, 18px from the lane, rather than at the
  edge of its label-wide row, so its arrow reaches the figure however long the name. Measured
  against Mermaid 12.2.0, which sizes its figure by a fixed `ACTOR_TYPE_WIDTH` of 36 and stops the
  creating arrow against that rather than the label. Appearance only; box participants are
  unchanged.
- **A `create` or `destroy` with anything but its message right after it is refused** once a
  message follows: a note, an `activate` or `deactivate`, an `autonumber`, a block boundary (a
  block's start, `else`, `and`, `option`, `end`), or another `create` or `destroy` in between
  (nook `01M4YS7DV8`). The error is at the declaration's line and names what stands in between:
  `The created participant "X" has no creating message: the message sent to it must come right
  after the create, with no "note" in between.`, and for `destroy`, `The destroyed participant "X"
  has no destroying message: the message sent by or to it must come right after the destroy, with
  no "note" in between.` Measured against Mermaid 12.2.0: it accepts most of these documents but
  then draws the declaration as if it were never written — X's box at the top, X's lifeline to the
  bottom — because its drawing pairs a declaration with the record right after it; the rest it
  refuses. A wrong picture with no diagnostic is refused (ADR-0001). Siren used to pair across
  them in silence, and with two declarations waiting it checked only the latest (`destroy B`,
  `destroy C`, `A-xC`), or a `create` before a `destroy`, which also warned that a message `B`
  sent right after `create C`, `destroy B` reached past B's end. With no message after them, such
  declarations are not refused; they draw what a lone one at the end draws (see below).
- **A `create` or `destroy` with no message after it draws nothing**, following Mermaid 12.2.0
  (nook `01M4YWYFJ`). A `destroy X` there used to end X's lifeline with an X mark on a row of its
  own; X now runs to the bottom row with its box there and no X (`destroyedAt: null`). A `create
  participant X` (or `create actor X`) there used to put X's box on a row of its own; X now has
  boxes in the top and bottom rows and a full-height lifeline (`origin: "declared"`,
  `createdAt: 0`), its lane shifted right as any created participant's is (see below). Neither
  declaration takes a row any more, also
  when only a note, an activation, an `autonumber`, a block boundary or another declaration
  follows it. A repeated `destroy X` while X's is still waiting is the same declaration, so
  `destroy B`, `destroy B`, `A-xB` ends B on `A-xB`, as in Mermaid. Each unpaired declaration gets a
  warning at its line, such as `The destroyed participant "X" has no destroying message, so the
  destroy draws nothing: …`, because Mermaid accepts the document but silently ignores what the
  author wrote, and the warning says why nothing is drawn.
- **A line that is nothing but `%%` is refused in flowcharts and ER diagrams**, with an error at its
  `%%` that says to write `%% text` or leave the line blank (ADR-0017, nook `01M4XSF9S`). Such a
  line used to be stripped as a comment, but Mermaid 12.2.0 does not read it as one: its comment
  cleanup wants at least one character after the `%%`, so a flowchart draws the line as a node
  named `%%` (or, above the header, refuses the document) and an ER diagram refuses the document.
  Sequence, class and state diagrams read it as a comment, as Mermaid's own grammars for them do,
  and so does a timeline block in any kind, since Mermaid never sees one; `%%` followed by a
  space, a tab or any text is still a comment everywhere.
  `examples/flowchart-styling.srn` used one as a paragraph break; it is now a blank line.
  The error names only the cause and the fix; it no longer says what Mermaid does with the line.
- A `style` on a node, state or entity now beats a class applied to it whichever line comes first,
  as Mermaid 12.2.0 paints it in flowchart, class, state and ER diagrams. Before, the later line
  won, so `style A fill:#0ff` written above `class A alpha` drew the class's fill (nook `01M39F9N1`,
  ADR-0008 amended).
- Applying a class name no `classDef` defines (`A:::ghost`, `class A ghost`, `cssClass "A" ghost`)
  is a **warning** now, not an error, in flowchart, class, state and ER diagrams: the diagram is
  drawn with the target unstyled, as Mermaid 12.2.0 draws it, instead of not at all. A target that
  does not exist is still dropped in silence (nook `01M39FAVK`).
- **A created sequence participant is laid out as Mermaid 12.2.0 lays it out** (nook `01M4Z7TRKD`).
  A participant a `create participant X` / `create actor X` introduces and nothing destroys is now
  drawn in the bottom row as well, level with every declared participant, where it used to be drawn
  only once, on its creating message. And when anything — a message, a note, an activation, a
  block, or an `autonumber` or `autonumber off` — comes before its `create`, its lane sits half
  its own width further right than a declared participant's would, and every lane after it, and
  the diagram's width, move with it; created after nothing but declarations, a `destroy` or a
  `link`, it stays put, as in Mermaid. A `create` with no message after it moves the same way,
  though its participant is drawn from the top. The resolved participant says which: its
  `createdAfterDrawing` is `true` when something drawn comes before its `create`.
- **A sequence `destroy` no longer creates the participant it names** (nook `01M4Z7TRT0`,
  ADR-0013 amended). Every other reference still creates an undeclared participant on first
  mention, but `destroy Z`, as in Mermaid 12.2.0, does not: a `Z` that nothing else names gets no
  lane, where it used to get one ending at the `destroy`, and the warning for the unpaired `destroy`
  now says `Z` has no lane. When the destroying message is the first statement to name `Z`, `Z`'s
  lane is placed where that message names it, so `A->>B`, `destroy Z`, `C-xZ` draws lanes A, B, C,
  Z, where it used to draw A, B, Z, C; Z still ends on `C-xZ`. A `create participant Z` after
  `destroy Z` is no longer refused as naming `Z` a second time; the `destroy`, interrupted by the
  `create`, is refused instead, and `Z` is drawn created and never destroyed, as Mermaid draws it.
- **A `;` between members in a class block is refused** (`+int x; +foo()`, `+foo(); +bar()`,
  `+int x; y`), saying that a `;` does not separate members and to write each on a line of its own;
  Mermaid 12.2.0 draws such text as one member (nook `01M4ZWT8XF`). Where Siren could read the text
  as one member — `+int x; y`, `+int x; int y`, `+foo(); +bar()` — it used to draw that one member,
  as Mermaid does, and now refuses it. A `;` inside a method's parentheses (`+foo(a; b)`) or a
  `~generic~` is kept as written, and so is the `;` ending an entity code (`+x #59; y`), which
  Mermaid encodes before reading the member.
- **An empty namespace is refused** (`namespace N {` and `}` with nothing between), saying to add a
  class to it or remove it, as Mermaid 12.2.0 refuses it (nook `01M4ZY2DA1`). It used to be accepted
  and drawn as no frame at all.
- **A destroyed sequence participant ends with a closing box, not an X mark** (nook decision
  `01M4ZXTTY3`, superseding the X-mark convention of the sequence-create-destroy board). As in
  Mermaid 12.2.0, `destroy X` draws X's box (or actor figure) a second time, centred on its
  destroying message's arrow, whether X sends or receives it; X's lifeline ends there, under the
  box, and X still gets no box in the bottom row. The arrow stops at the box's near edge (an actor's
  arm tip), as a creating message's arrow does, whatever the arrowhead. Every row after the
  destroying message, the bottom row and the diagram's height move down by half the box, and a block
  around the pair grows with it. The SVG no longer has a `path.siren-destroy-mark`; the closing box
  is a `g.siren-participant` wearing the participant's `data-siren-id`, so a timeline action on the
  participant still reaches it. `PositionedDestroyMark` and the `destroyMark` element kind are
  removed from the positioned layout, and the default theme drops their styles.
- **A class diagram's `direction TD` is refused** (nook `01M51Q7G098SYMMW8BCGM22H2R`), alone, after
  another `direction` or with a `%%` comment, saying to write `direction TB` for top to bottom;
  inside a namespace it gets the namespace's placement error, as `direction LR` there does. Mermaid
  12.2.0's class lexer has no `TD` alias: `direction LR` then `direction TD` is laid out left to
  right, and `direction TD %% x` runs on into the next line. Siren used to read it as TB. A
  flowchart's `direction TD` is unchanged.
- **Text after a class diagram's `accDescr { ... }` closing `}` is refused** (`accDescr { d } class
  C`, a multi-line block's `} direction LR`), saying to move it to a line of its own, as Mermaid
  12.2.0 refuses it in a class diagram; Siren used to read it as the next statement. A `%%` comment
  there is read on the document's last line and refused on any other, as after a relationship.
  Other diagram kinds are unchanged.
- **`class C direction XX` is refused with an explanation** instead of as an unrecognized line: the
  error says the line would declare one class named `CdirectionXX` and to write the direction on a
  line of its own. Mermaid 12.2.0 draws that one class for any value no direction rule names (`XX`,
  `TD`, `lr`).
- **A nested generic on a class name is refused** (nook `01M51Q7G6R5TY4NGMMNCMJ9JVJ`):
  `class A~List~int~~`, its block form and the same on a relationship's end, which Mermaid 12.2.0
  refuses (a generic ends at its second `~`). Siren used to draw `A<List<int>>`. The error suggests
  writing the inner angle brackets as entity codes, `~List#lt;int#gt;~`, which both draw
  `A<List<int>>`. A nested generic in a member's type (`+List~List~int~~ x`) is unchanged.
- **Entity codes in a class name's generic are decoded** (nook `01M51Q7G6R5TY4NGMMNCMJ9JVJ`), as a
  member line's are: `class A~#lt;~`, `~&lt;~` and `~#60;~` draw `A<<>`, `~&amp;~` `A<&>` and
  `~#quot;~` `A<">`, as Mermaid 12.2.0 draws them, and the box is sized from the decoded name. A
  bracketed label written after such a generic (`class A~#lt;~["L"]`) still replaces the name
  whole.
- **A class member's name may start with a digit and hold `-`, `.` or a letter of any script**
  (nook `01M51Q7GD59NHR6MFZEC13NJ1K`), in a class block and after `A :` alike: `+int 2x`, `+x 1`,
  `+x 1.5`, `+x a-b`, `+x a.b`, `+x é`, `+1foo()` and `+a-b()` are drawn as written, as Mermaid
  12.2.0 draws them. Siren used to refuse each as an unrecognized member.
- **In a class block, the `;` ending an HTML character reference is the reference's**, not a member
  separator (nook `01M51Q7GD59NHR6MFZEC13NJ1K`): `+&lt; x`, `+&amp; x`, `+x &lt;`, `+x &#60;` and
  `+&lt;foo()` are one member each, decoded when drawn (`+< x`, `+& x`, `+x <`, `+x &<`,
  `+<foo()`), as Mermaid 12.2.0 draws them; a reference may stand in a member's name, also after
  `A :` when it has no `;` (`+x &lt`). A `#…;` that is no entity code, written as a block member's
  name (`+x #a-b;`, `+x #é;`, `+x #;`), is drawn as written. A `;` that ends neither still
  separates nothing and is refused (`+x a;b`, `# lt; x`), and after `A :` every `;` is refused as
  before.
- **A class method's return type is drawn after ` : `** (nook `01M51Q7GKMPTCB6MX643KS1YSE`), as
  Mermaid 12.2.0 draws it, in a class block and after `A :` alike: `+foo() bool`, `+foo()bool` and
  `+foo()  bool` draw `+foo() : bool`, and `+foo(int a) List~T~` draws `+foo(int a) : List<T>`. The
  box is measured from the new text. A method with no return type is unchanged.
- **A class generic given after the class was first named without one is refused** (nook
  `01M51RR6AJKAR05VBT12A2BSB4`): `class A` then `class A~T~`, `A --> C` or `A : +x` then `class
  A~T~`, and `class A` then `A~T~ --> B`. Mermaid 12.2.0 keeps what a class's first naming gave it
  and draws `A`, dropping the `T`; Siren drew `A<T>`. The error says to write the generic where the
  class is first named. A different generic after a first one is still kept to the first, with a
  warning.
- **A `<` opening a tag in a class name's generic is refused** (nook `01M51RR6AJKAR05VBT12A2BSB4`):
  before a letter, `/` or `!` (`class A~List<int>~`, `A~List<int>~ --> B`), where Mermaid 12.2.0 reads
  markup and draws `A<List>`; Siren drew `A<List<int>>`. The error suggests `#lt;`. Any other `<`
  (`~a<1~`, `~a < b~`) is drawn as written, as before.
- **A note's target with a generic other than its class's is refused** (nook
  `01M51RR6AJKAR05VBT12A2BSB4`): `note for A~T~ "n"` on a class first named without `T`, or never
  named, whose `T` Mermaid 12.2.0 does not draw.
- **A class generic other than the one the class was first named with is refused** (nook
  `01M51TMV71BF1Y0EC2RS2B6ZWG`), in every statement and order — `class A~T~` then `class A~U~`,
  `A~U~ --> B` or `A~U~ : +x`, `A~T~ --> B` then `class A~U~`, two blocks — where Mermaid 12.2.0
  draws `A<T>`, the `U` gone with no diagnostic. It used to be kept to the first with a warning. The
  check a note's target generic gets now lives beside this one, in the model, and its error names
  the line the class was first named on. Being a model-stage error now, a mismatched `note for
  A~T~ "n"` is reported beside a drawn diagram — the class with the generic it keeps, the note
  attached to it (or free, when no class `A` exists) — where it used to return no SVG. A generic's
  line break is quoted as `<br>` in these errors.
- **A second, different class annotation is refused** (nook `01M51TMV71BF1Y0EC2RS2B6ZWG`):
  `<<interface>> A` then `<<service>> A`, or two annotation lines in one block, where Mermaid
  12.2.0 draws only the first. It used to be kept to the first with a warning.
- A timeline action whose target begins with `%%` in a sequence, class, state or ER diagram
  (`enter %%B fade`) is refused saying that the `%%` starts a comment, so the verb has no target,
  and that an id in that diagram cannot begin with `%%`, where it was called an unrecognized
  action (nook `01M51XAEVWWTPSDYAR8E54F80R`). A flowchart still reads `%%B` as the target.

### Fixed

- Positions after a flowchart node's `@{ … }` block written across lines are where the author
  wrote them (nook `01M51S4P5S`): a statement after the block's `}` (`}; E --> F`), the nodes and
  edges it declares, and a mistake after the `}` (`} ~~> B`, `}:::c`, `} --> end-x`) are placed
  on their own line and column, where they were all counted from the line the block opened on. A
  YAML error inside a block is reported where the YAML reader stopped rather than at the `@` —
  save one inside a quoted string that crosses lines, which stays at the `@`, since that string is
  read with its line breaks as `<br/>` — and a message that quotes such a statement quotes the
  block on one line (`A@{ shape: circle } --> B C`), while a fix it suggests shows a block written
  across lines as `@{ … }` rather than flattening its YAML.
- A flowchart timeline can name a node or an edge whose id begins with `%%` (nook `01M51TJRT0`):
  `A --> %%B` draws a node `%%B`, and `enter %%B fade` now reaches it, where the line was cut at its
  `%%` and refused as `Unrecognized timeline action: "enter"`. Only a `%%` glued to the start of the
  target's text is the id's; a `%%` with a space after it (`enter %% note`), one after the action
  (`enter %%B fade %% note`), and a `%%` line stay comments. Other kinds' ids hold no `%`, so their
  timelines still cut every such `%%`.
- In a flowchart timeline, a note glued after a lone verb (`enter %%todo`) is now read as that
  action's target, not as a comment (nook `01M51TJRT0`). The line is still refused, with a
  different message: `enter %%todo` reports its missing effect where it reported
  `Unrecognized timeline action: "enter"`, and `unhighlight %%todo` names an id that is not in the
  diagram. Write `%% todo`, with a space, for a comment. A `%%` after a timeline header
  (`timeline: %%note`, glued or tabbed) is a comment, as before.
- An `@{` that a flowchart statement holds as text no longer opens a node data block that runs on
  into the lines below (nook `01M51RE5K5`): `A -- x@{y --> B` followed by `C` draws A, B and C, the
  edge labelled `x@{y`, as Mermaid 12.2.0 does, where it was refused with the next line folded into
  it. A block runs on across lines only where a node is written — at an edge's end or as a node of
  its own — and never from an arrow's label, a `|label|`, a quoted string, `accTitle`, a subgraph
  title, `classDef` or `style`.
- A flowchart subgraph whose quoted title is one word (`subgraph "t"`) now takes that word as its
  handle, as Mermaid 12.2.0 records it (id `t`, measured), so an edge naming it (`t --> B`) joins
  the frame, where Siren used to draw a stray node `t` beside it. A quoted title holding whitespace
  (`subgraph "Two Words"`) still has no handle. A timeline still reaches the frame by its generated
  `subgraph:N` (ADR-0010), and a node also named `t` stays a node beside it (nook `01M4ZY2D3D`).
- An init directive spread over several lines no longer breaks the document. It used to be
  removed one line at a time as a `%%` comment, so its middle lines were read as diagram text and
  refused, where Mermaid removes the whole directive and draws the diagram. Every directive is now
  removed whole before comments are, and blanked in place with spaces, so the line and column of
  every other diagnostic still point at what the author wrote — on the directive's own line too
  (`  %%{wrap}%%  classDiagrm` reports column 15, not 5) (nook `01M4XSF9J`).
- Flowchart nodes have twice their original positive text padding, without scaling text or changing
  wrapping; subgraphs use 24px padding, including nested frames and title bands. Other diagram kinds
  retain their existing geometry (nook `01M4XKQXA`).
- Flowchart lines paint below subgraph frames and titles, edge labels and nodes, so a crossing
  line cannot paint over their text (nook `01M4XJ8Y0`). Routes, styling and timeline targets stay
  the same; transparent fills can still reveal the lines beneath them.
- State and class diagrams read `accTitle:` and `accDescr:` (and the braced block) as the diagram's
  accessible title and description, drawn as the SVG's `<title>` and `<desc>`. Siren used to draw a
  state or a class called `accTitle` and another called `accDescr` for them, with no diagnostic
  (nook `01M4WVVN9`). State diagrams read the keywords in any case; class diagrams in lower case
  only, as Mermaid 12.2.0 does.
- `x.o-->y` in a flowchart is the node `x.o` and a plain arrow, as Mermaid reads it. It was read as
  the node `x.` with a circle-headed arrow, with no diagnostic.
- A flowchart's `classDef default` now styles every node, under any other class or `style`, as
  Mermaid 12.2.0 paints it. It used to be recorded and applied to nothing, with no diagnostic (nook
  `01M39F94W`).
- State diagrams refuse all ten words Mermaid 12.2.0 reserves, adding `href`, `default` and
  `stateDiagram`, and refuse them as a description's subject too (`note : hi`, `style : hi`), where
  Siren used to draw a box called `note` or `style` with no diagnostic. `state : hi` declares
  nothing, as Mermaid reads it (nook `01M2ZQQQ6`).
- A sequence `link` may name a participant nothing declares. It used to fail with `click "B"
  references a target that does not exist` when only a message created B; now the link is a
  mention like any other, creating the lane where it is written, as Mermaid 12.2.0 does
  (nook `01M3NNNE6`).
- An ER `ACCDESCR {` block in capitals is refused by name, as the lower-case block is. It used to be
  read as an entity called `ACCDESCR`, so a body like `string x` drew an extra box with no
  diagnostic.

## [0.6.0] - 2026-10-14

**Every graph-shaped diagram is now laid out by ELK, as Mermaid 12 lays it out, and dagre is
gone.** Flowcharts, class diagrams, state diagrams and ER diagrams are laid out by ELK's `layered`
algorithm (elkjs 0.9.3, the version Mermaid 12.2.0 bundles), configured as Mermaid 12.2.0's default
layout, behind one shared layout core. Almost every diagram of those four kinds looks different:
routes are orthogonal with rounded corners and line hops, frames are the engine's, and boxes are
ordered as Mermaid orders them. `@dagrejs/dagre` is no longer a dependency. Against Mermaid 12.2.0
on the parity fixtures, Siren now draws the same crossings (flowchart 176 to its 176; class, state
and ER 0) with no edge through an unrelated box, and agrees on above/below and left/right for
99.6% / 97.8% of node pairs (flowchart), 97.4% / 100% (class), 100% / 98.5% (state) and 97.2% /
100% (ER). The cost: the standalone `dist/siren-core.js` is about 545 KB gzipped (was about 83 KB),
and the first layout in a page costs about 0.1s while the engine starts. Where Siren departs from
Mermaid 12 it measured the difference and wrote it down: a long arrow keeps its length (nook
`01M4VA6MS`), `linkStyle … interpolate` is still honoured (`01M4VANRC`, rule 6), straightening a
route's end never runs it through a box (`01M4VBHWY`), a frame fits its contents with its own
padding (`01M4VDB3X`), a frame's title moves clear of the routes crossing it (`01M4VFW4X`), class
multiplicities stay off lines and boxes (`01M4VHSY2`), a state's note stays in its block
(`01M4VKTJ2`), and an ER cardinality marker stays on its line (`01M4VP6AV`, with Mermaid's
half-buried almond, `01M4W687V`). The layout engine
decision is nook `01M4VA67H`; the amendment of ADR-0001 that puts ELK behind the shared core and
removes dagre is `01M4VPWF5`.

### Changed

- **Flowcharts are laid out by ELK, as Mermaid 12 lays them out.** The layout engine for
  flowcharts is now ELK's `layered` algorithm (elkjs 0.9.3, the version Mermaid 12.2.0 bundles),
  configured with the options of Mermaid 12.2.0's own default layout. Almost every flowchart looks
  different: edges are routed **orthogonally** and drawn with **rounded corners** (Mermaid's
  `rounded`, radius 5) unless a `linkStyle … interpolate` names a curve, which is still honoured
  and now applied to ELK's points (a name that is no curve draws `rounded`, as Mermaid 12 does);
  siblings keep the order they were written in (the street-fair diagram's options A, B, C
  now read left to right); groups are listed to the engine as Mermaid lists them; no edge is drawn
  through an unrelated box. Against Mermaid 12.2.0 on the parity fixtures: 176 crossings to its
  176, 0 edges through boxes (was 29), 99.6% / 97.8% agreement on above/below and left/right (was
  91.6% / 61.0%).
- **Edges that run back between subgraphs are laid out as Mermaid 12 lays them out.** Where the
  subgraphs form a cycle (`A --> B` from one subgraph into another, `B --> C` back), the edge that
  closes the cycle is laid out pointing the other way and still drawn from its source to its
  target, so the subgraphs stack in Mermaid's order rather than mirrored (the garden-network fixture's
  left/right agreement with Mermaid: 25.8% before, 92.1% after).
- **A subgraph's frame fits what it holds.** As in Mermaid 12, a frame is pulled in after layout to
  its members and the edges routed inside it, rather than also holding where edges leaving it cross
  on their way out. It stops one of the subgraph's own padding (12px) beyond them, where Mermaid
  stops 24px beyond: Mermaid's 24px measured worse against Mermaid's own pictures.
- **The short sidestep at an edge's end is taken out**, as Mermaid 12 does: a jog of at most 16px
  within 30px of a box is straightened when that adds no crossing and covers no more labels.
  Unlike Mermaid, Siren also keeps the jog when straightening it would run the edge through a box.
  The parity numbers above moved with the other two changes; keeping the jog off boxes left them
  unchanged.
- **A subgraph's frame is the engine's.** ELK sizes each frame around its members, its 12px
  padding and a band for its title, and routes edges that end on a subgraph (`one --> two`) and a
  subgraph's own loop (`one --> one`) to the frame itself. A title wider than its members widens
  the frame and centres them under it.
- **A subgraph's `direction` follows Mermaid 12's rule.** A declared direction is given up when an
  edge whose ends have different parents passes through the subgraph — including an edge between
  two of its own members at different nesting depths, which Mermaid 11 did not count. A subgraph
  with no `direction` inside one that keeps its own is laid out in the enclosing subgraph's
  direction (Mermaid 11 used the document's).
- **A subgraph's title moves aside for the edges crossing its band.** Mermaid 12 centres the title
  and draws an edge entering or leaving the subgraph from above straight through its words. Siren
  moves the title along the band to the place nearest the centre that clears every such edge by
  half a padding; it stays centred when nothing crosses, or when the frame has no room. Edges and
  frames are unchanged. On the flowchart parity fixtures: 19 edges through a title (Mermaid 23);
  crossings, agreement, reversals and detour unchanged.
- **`A ----> B` still spans three ranks.** Mermaid 12 on ELK silently draws it like `-->`; Siren
  keeps the length the document asks for.
- **Class diagrams are laid out by ELK too, as Mermaid 12 lays them out.** Relationships and note
  connectors are routed orthogonally and drawn `rounded`, with line hops where they cross. A
  namespace's frame is the engine's, sized around its members, its 12px padding and a band for its
  title, and the title moves aside for routes and multiplicities crossing the band. Namespaces come
  before the classes outside them, and an attached note sits a layer before its class, in Mermaid
  12's order. Multiplicities are placed by the engine beside their own end, the from end's on the
  right of the line and the to end's on its left; unlike Mermaid, Siren also moves one off any line
  or box it lands on, and keeps it at its own end of a relationship laid out turned round. Against
  Mermaid 12.2.0 on the three class parity fixtures: 0 crossings to its 0 (was 0), 0 edges through
  boxes (was 1), 97.3% / 100% agreement on above/below and left/right (was 67.6% / 83.8%).
- **State diagrams are laid out by ELK too, as Mermaid 12 lays them out.** Transitions and note
  connectors are routed orthogonally and drawn `rounded`, with line hops where they cross; a
  self-transition, on a state or on a composite's frame, is an orthogonal loop. A composite's frame
  is the engine's, sized around its members, its 12px padding and a band for its title, and the
  title moves aside for routes crossing the band. A composite or concurrent region that names no
  `direction` is laid out top to bottom whatever the document's direction, as Mermaid lays it out
  (it used to follow a document-level `LR`); one that names a direction gives it up when a
  transition crosses its boundary, by Mermaid 12's rule. A start or end sits on the line of its
  transition. Unlike Mermaid, a note stays inside the composite its state is written in, and
  writing it makes no composite give up its direction. Against Mermaid 12.2.0 on the four state
  parity fixtures: 0 crossings to its 0 (was 1), 0 edges through boxes (was 0), 100% / 98.5%
  agreement on above/below and left/right (was 87.7% / 66.2%).
- **ER diagrams are laid out by ELK too, as Mermaid 12 lays them out.** Relationships are routed
  orthogonally and drawn `rounded` (they were `basis` curves), with line hops where they cross, and
  a self-relationship is an orthogonal loop; each cardinality marker lies along its route's first
  or last run. A relationship's label sits centred on its route. A `subgraph` block's frame is the
  engine's, sized around its members, its 12px padding and a band for its title, and the title
  moves aside for routes crossing the band. Blocks are handed to the engine in Mermaid's order —
  sibling blocks last-written first, every block before the entities — so `subgraph SA`,
  `subgraph SB`, `X` reads SB, SA, X from left to right, as in Mermaid. A block that names no
  `direction` inside one that keeps its own is laid out in the enclosing block's direction (it used
  to take the document's), and one that names a direction gives it up when a relationship crosses
  its boundary, by Mermaid 12's rule. Against Mermaid 12.2.0 on the four ER parity fixtures: 0
  crossings to its 0 (was 0), 0 edges through boxes (was 0), 97.2% / 100% agreement on above/below
  and left/right (was 58.3% / 77.8%).
- **An ER cardinality marker stays on its line.** Each end of a relationship now runs straight out
  of its entity, past the rounded corner, for at least as far as its marker reaches (15px for
  exactly one, 27 for zero or one, 24 for one or more, 34 for zero or more), so a crow's foot no
  longer sticks out past the first bend — a self-relationship's loop reaches out that far too.
  Mermaid 12.2.0's markers do overrun the bend; Siren departs from it here. ER diagrams grow along
  their ranks to make the room (the ER subgraph parity fixture's boxes span 1422px instead of
  1271px; Mermaid's 1321px); the parity numbers are unchanged. The layout core's edges take a
  `straightEnds` length for it; no other diagram kind sets one.
- **An ER "many" marker is half buried in its entity, as Mermaid draws it.** The almond of a
  one-or-more or zero-or-more marker is now centred on the entity's edge, with the half inside the
  box hidden under it, and its bar or circle sits 24 or 28px out (was every glyph outside the box,
  the almond's tip on the edge and the outer glyph 42 or 48px out). Every glyph is where Mermaid
  12.2.0's ER markers put it. ER diagrams are shorter along their ranks for it (nook `01M4W687V`).
- The Mermaid the parity and probe scripts measure against is **12.2.0** (was 11.17.2).

### Added

- `elkjs` **0.9.3** is a dependency (pinned exactly; licensed EPL-2.0). It is
  external in the npm entry and bundled into the standalone `dist/siren-core.js`, which grows from
  about 83 KB to about 545 KB gzipped and now ships with `dist/THIRD-PARTY-NOTICES.md`. `render()`
  is still synchronous; the first diagram laid out in a page costs about 0.1s while the engine
  initialises, later ones about 20ms for 40 nodes. siren-core must not run inside a Web Worker.
- A graph the layout engine rejects is reported as an error diagnostic, like any other layout
  failure.
- **Line hops**, as Mermaid 12 draws them: where two flowchart edges cross, one of them jumps the
  other with a half circle of radius 6 — on the horizontal line of the two, bulging up (the later
  edge where neither is horizontal, bulging right on a vertical one), never inside a rounded
  corner, smaller near a corner or next to another hop, and left out where less than 3.6 would
  remain. Drawn on `rounded` (the default), `linear` and `step` edges; a `basis` edge draws none.
  Lines that only meet at an end do not hop. The routes are unchanged — `data-siren-points` holds
  no hop — and a hopped `step` edge's `d` is written as straight segments through the route, the
  same picture as before. The layout reports each edge's hops (`PositionedEdge.hops`); class and
  state connectors have them too (`PositionedStateTransition.hops`,
  `PositionedStateNote.connectorHops`) and so do ER relationships
  (`PositionedErRelationship.hops`).
- `PositionedStateLabel.x`: the centre of a composite's title where the layout moved it along its
  band.

### Removed

- `@dagrejs/dagre` is no longer a dependency, and the standalone build no longer bundles it or
  lists it in `dist/THIRD-PARTY-NOTICES.md`. No diagram kind was laid out by it any more.

## [0.5.0] - 2026-10-12

Flowcharts, class, state and ER diagrams now lay out much closer to Mermaid's own pictures:
connectors are curved, connector labels sit on their lines over a background, long labels wrap,
and a group with a connector crossing its boundary follows the surrounding direction. Almost every
diagram looks different. Breaking for a script or test that reads a connector's route off its
`<path>`'s `d` (read `data-siren-points` instead), and for a second theme that does not declare
`--siren-edge-label-fill` (see **Added**).

### Added

- **Connector labels are painted on a background**, as in Mermaid, so a line running under a
  label no longer strikes its text out. Every labelled edge, class relationship, state transition
  and ER relationship gets a `<rect class="siren-connector-label-background">` over the label's
  box, drawn above every line and under the label's text. It is part of the label: a timeline
  `enter`/`exit` on the connector moves it with the text, and a highlight leaves its fill alone. An
  author's `linkStyle … color:` still paints only the text.
- Token `--siren-edge-label-fill` (default `rgb(255 255 255 / 0.8)`, the white canvas at Mermaid's
  0.8 opacity) fills that background. It sits outside the five-color palette, but **a second theme
  must redeclare it**: on a dark canvas the default draws a white background behind every connector
  label. `demos/theme-dark.css` declares a dark value.
- Every connector `<path>` (flowchart edge, class relationship, state transition, ER
  relationship, note connector) carries **`data-siren-points`**: the points its route passes
  through, as `"x,y x,y …"` (the spelling of an SVG `points` attribute). A connector is now drawn
  as a curve whose `d` holds control points rather than the route (see **Changed**), so this
  attribute is where a script or test reads the route.
- **`linkStyle … interpolate`** picks the curve a flowchart edge is drawn with, as in Mermaid:
  `linkStyle default interpolate <curve>` or `linkStyle <n>[,<m>…] interpolate <curve>`, optionally
  followed by declarations (`linkStyle 0 interpolate step stroke:#f00`). The curves are `basis`,
  `linear`, `step`, `stepBefore`, `stepAfter` and `rounded`; a numbered statement's curve beats
  `default`'s in either order. These lines used to fail with `Unrecognized style declaration`. The
  seven curves Mermaid draws and Siren does not yet (`cardinal`, `bumpX`, `bumpY`, `catmullRom`,
  `monotoneX`, `monotoneY`, `natural`) are reported as an error and the edge keeps its fallback
  curve; a name Mermaid does not know either is drawn as `basis`, as Mermaid draws it, with a
  warning. `GraphEdge` (and so `PositionedEdge`) gains an optional `curve`.

### Changed

- **A flowchart node's label wraps** once its text is wider than 175px, as Mermaid wraps its labels
  at 200px of 16px text (scaled to the 14px a node is drawn at): Latin text at its spaces, CJK text
  between any two characters, never with closing punctuation such as `，` or `)` beginning a row.
  A `<br>` still breaks a row, and each row is then wrapped on its own; a word too long for 175px is
  left whole and widens the label. A wrapped label's text is 175px wide and its box that plus the
  measurer's padding (the padding is outside the wrap width, as Mermaid's shape padding is outside
  its label), so a long-labelled node is now narrower and taller, and the whole diagram's layout
  can change. A subgraph's title is not wrapped. The width is fixed: `flowchart.wrappingWidth` is
  not read. `PositionedNode.label` is the wrapped label (its rows are what is drawn); `wrapLabel`
  and `wrapWidthAt` are internal.
- **A flowchart edge's label wraps** too, once its text is wider than 150px: Mermaid's 200px
  scaled to the 12px an edge label is drawn at, by the same rules as a node's. A wrapped edge
  label's text is 150px wide and its box that plus the measurer's padding (scaled to 12px); its
  background covers the wrapped box, and dagre keeps that box clear, so a diagram with long edge
  labels is laid out differently. `PositionedEdge.label.label` is the wrapped label.
- **A state diagram's labels wrap** as Mermaid's do (measured, mermaid 11.17.2): a state's
  description (and a quoted name, `state "…" as S`) and a note once their text is wider than
  175px, a transition label once its text is wider than 150px, by the same rules as a flowchart's.
  A long-described state and a long note are drawn narrower and taller, and the diagram's layout
  can change. A composite state's title is not wrapped. `PositionedStateLabel.label`,
  `PositionedStateNote.label` and `PositionedStateTransition.label.label` are the wrapped labels.
- **A class or ER relationship's label wraps** as Mermaid's does (measured, mermaid 11.17.2), by
  the same rules as a flowchart edge's label: a class relationship's once its text is wider than
  150px, Mermaid's 200px scaled from its 16px to the 12px Siren draws it at; an ER relationship's
  once wider than 200 × 12/14 ≈ 171.43px, because Mermaid draws that label at 14px, so a row holds
  as much as Mermaid's (the wrap width is `200 × Siren px / Mermaid px`). The layout keeps the
  wrapped box clear, so a diagram with long relationship labels is laid out differently. A class
  name, a class member, a class diagram's note, an ER entity name and an attribute's comment are
  not wrapped, as Mermaid wraps none of them.
  `PositionedClassRelationship.label.label` and `PositionedErRelationship.label.label` are the
  wrapped labels.
- **A label's rows are closer together**: one line apart, a line being 1.5 times the size the
  label is drawn at, as Mermaid's HTML labels draw 16px text on 24px lines (measured). A node's,
  a class's, a state's or a subgraph title's rows are 21px apart (14px), a connector label's 18px
  (12px). The measurer's height for one line is now that line plus a padding added once around
  all the rows, not once per row, so a one-row label's box is exactly as tall as before and each
  row after it adds one line rather than the measurer's full height. Sequence text follows
  Mermaid's SVG text instead: a message's, a note's and a block condition's rows are 14 × 19/16 =
  16.625px apart, a participant's and a box caption's 14px. A run's mark or background rect is one
  such line tall. Multi-row labels' boxes, and the layouts around them, are shorter.
- A flowchart subgraph, a state diagram's composite state or an ER subgraph that declares a
  `direction` now uses it **only when no connector crosses its boundary**: a connector with
  exactly one end inside the group, at any depth. A group with such a connector is laid out in the
  direction of the nearest enclosing group that keeps its own, or else the diagram's, as Mermaid
  lays it out. A connector that names the group itself from outside (`one --> C`,
  `Before --> Outer`) does not cross it, and the group keeps its direction, as in Mermaid. The members and connectors of a group that loses its direction go back to the
  ordinary layout: connectors crossing it are routed instead of drawn as two-point straight lines
  through other boxes, and its frame no longer overlaps the frames beside it. A diagram whose
  grouped direction relied on a crossing connector draws differently.
- **Connector labels are drawn on the line**, centred on a point the connector passes through, in
  flowcharts, class diagrams, state diagrams and ER diagrams, as Mermaid draws them. They used to
  sit 10px to the right of the line. The room the layout keeps for a label is now the size it is
  drawn at (`--siren-label-font-size`, 12px) rather than the node text's 14px, so a diagram with
  labelled connectors comes out slightly more compact.
- Flowcharts, class diagrams, state diagrams and ER diagrams are laid out with an **8px margin
  around the drawing**, as Mermaid lays them out (`marginx`/`marginy: 8`). This is inside the
  canvas gutter the `<svg>` already had. A diagram without frames moves 8 right and 8 down and
  its `viewBox` grows by 16 on each axis. A diagram whose subgraph, composite state, namespace or
  ER subgraph frames reached past the top or left edge was already moved to keep them on the
  canvas; there the margin takes up part or all of that move instead, so it moves, and grows,
  by less.
- **Connectors are drawn as curves**, as Mermaid draws them. Every flowchart edge, class
  relationship, state transition, ER relationship and note connector is a `basis` spline (d3's
  `curveBasis`, Mermaid's default) through its routed points instead of a polyline with corners.
  The route itself is unchanged: the curve starts and ends where the polyline did and still
  arrives along the route's last segment, so arrowheads and other end markers point as before.
  A connector `<path>`'s `d` now holds the curve's control points rather than the route, so a
  script or test that read the route off `d` should read `data-siren-points` (see **Added**).
  Every diagram with a bent connector looks different.

## [0.4.0] - 2026-10-10

Breaking for a stylesheet or script that reaches a connector's label through the connector's
own group, and for a script that matches the old message for a second unnamed `timeline:`
(see **Changed**). `SirenRenderResult` gains a required `timelines` field, so TypeScript code
that builds one itself, such as a mock, must add it.

### Added

- `render(source, container, { timeline: false })` draws the **full diagram**: the picture the
  same document draws without its `timeline:` block, as Mermaid draws it. Every element is
  visible, nothing is highlighted, and the controller has `totalSteps: 0`. The block is still
  parsed and checked, so `diagnostics` are the same as the default render's, and the render
  fails only when the default one does. Works for all five diagram kinds.
- **Several timelines in one document.** A document can declare named blocks,
  `timeline <name>:`, instead of the one unnamed `timeline:`; each runs to the next timeline
  header or the end of the document and has its own steps and its own step 0. Mixing the
  unnamed block with named ones, two unnamed blocks, a repeated name and a malformed name are
  each an error. Every block is checked on every render, and a diagnostic about a named block
  starts with `timeline <name>:`. A document with one unnamed block renders as before.
  A header is exactly `timeline:` or `timeline <name>:`, with nothing between the name and
  the colon; any other line starting with `timeline` keeps its ordinary meaning, so a document
  that rendered before renders the same.
- `RenderOptions.timeline` also takes a string: `render(source, container, { timeline: "wallet" })`
  applies the block of that name. `true`, or leaving the option out, applies the first block.
  A name the document does not declare throws a `RangeError` listing the declared names, and
  leaves the container untouched; a document that fails to render still returns its
  diagnostics instead. The diagnostics are the same whichever block is applied.
- `SirenRenderResult.timelines` lists the named blocks in document order, so a viewer can offer
  them as a choice. It is `[]` for a document with only the unnamed block or none, and when
  rendering failed.

### Changed

- A second unnamed `timeline:` header is now reported as `A document declares at most one
  unnamed "timeline:" block; name each block ("timeline <name>:") to declare several`, instead
  of `Unrecognized timeline action: "timeline:"`. The document is still rejected.
- **Connectors paint under the boxes, in Mermaid's layer order** (ADR-0016). Flowchart, class,
  state and ER diagrams now draw frames, then every connector line, then every connector label,
  then the boxes. A line routed past a box it does not end at runs under it instead of across
  its text, and no line crosses a label. A state's composite frame stays among the states, and a
  class note's box is still drawn last.
- A class relationship, a state transition and an ER relationship are each drawn as two groups
  that wear the same `data-siren-id`: the line group (`g.siren-relationship`,
  `g.siren-transition`, `g.siren-er-relationship`, unchanged in count and in
  `data-siren-relationship`) and a new label group (`g.siren-relationship-labels`,
  `g.siren-transition-labels`, `g.siren-er-relationship-labels`) holding the label,
  multiplicities and interface labels. A connector with no text has no label group. A timeline
  step on the connector's id still reaches both. A selector such as
  `g.siren-transition text.siren-transition-label` no longer matches; select the label group,
  or the label by `data-siren-id`.
- A class note's connector (`path.siren-note-link`) is drawn outside `g.siren-note`, on the line
  layer, and wears the note's id itself. A flowchart edge keeps its structure; only the order
  changes.

### Fixed

- The README's dark-theme example, and `demos/theme-dark.css` it points to, now redeclare
  `--siren-label-link` (`#9cc7ff`). Copied as they were, they left a label link in the
  browser's light-page blue, 1.6:1 on the dark node fill and unreadable.

## [0.3.0] - 2026-10-05

Breaking for a stylesheet that targets `siren-node-label-row`, which is now `siren-label-row`,
and for a document whose labels write HTML Siren now refuses (see **Changed**). That is why this
is 0.3.0 rather than 0.2.1.

### Added

- **Labels draw the HTML Mermaid's labels draw.** Every label in every diagram kind now reads
  the tags Mermaid's default (`htmlLabels: true`) picture honours and draws them as SVG text,
  never as `<foreignObject>` (ADR-0015). `<br>` breaks a row; `b`/`strong`, `i`/`em`, `u`, `s`,
  `code`, `small`/`big`, `sub`/`sup`, `q`, `mark` and the rest of the text-styling tags style a
  run; `<font>`, `<span style>` (ten properties) and `<a href>` (an SVG link) are drawn; block
  tags (`p`, `div`, headings, lists, `pre`) become rows with their fonts and list markers;
  tags with no rendering of their own, unknown tags and the tags Mermaid's sanitizer removes
  behave as they do there; and `#name;`/`#NN;` entity codes resolve. Markdown strings read
  `**`, `*`, `__`, `_`, backslash escapes, hard breaks and blank lines as Mermaid's `marked`
  does. A sequence diagram honours `<br>` and entity codes only, and a class member stays
  literal, as in Mermaid.
- Three theme tokens paint what the browser's stylesheet paints in Mermaid's picture:
  `--siren-label-link` (`#0000ee`), `--siren-label-mark-fill` (`#ff0`) and
  `--siren-label-mark-text` (`#000`).
- `class X["…"]` and `namespace X["…"] {` give a class and a namespace their own label.

### Changed

- **A label that writes HTML Siren cannot draw as SVG text is refused** with an error that
  names it: a `table`, `ruby`, `img` (the message points at Mermaid's image shape), form
  controls, media and interactive content, `svg` and `math`. Tags the browser hides
  (`template`, a closed `dialog`, `datalist`, `rp`, `source`, `track`, `area`, `title`) are
  removed with their content instead.
- A flowchart node or class declared twice with different labels draws the last one, and a
  flowchart node the last shape, with no warning, as Mermaid does.
- Mermaid's whole-document preprocessing is followed: `="…"` inside a tag becomes `='…'`, and a
  style line's last `;` is dropped, before any diagram reads its text.
- An unquoted ER subgraph title outside the name alphabet is refused at the title.
- Row tspans are `siren-label-row` (was `siren-node-label-row`). A transition, relationship or
  message label is now centred on the space layout keeps for it rather than standing on its
  baseline there.

## [0.2.0] - 2026-10-02

### Changed

- **The theme ships one palette, and a second one is yours.** `theme.css` no longer follows
  `prefers-color-scheme` and no longer reads `data-theme`: it declares one set of token values,
  in one `:root` block. A reader on a dark system sees that one palette unless your page says
  otherwise. To get the previous dark colors back, redeclare the five color tokens under a
  selector of your own — the README has the values and a worked example, and `demos/theme-dark.css`
  in the repo is the whole thing, ready to copy. Pinning a subtree with `data-theme="light"` is
  gone too; scope your own override to that subtree instead, which works for any palette rather
  than only for light. See ADR-0014.

## [0.1.1] - 2026-09-29

### Added

- A flowchart click's tooltip is drawn: the node shows it on hover, as a class
  diagram's and a sequence diagram's already do. It was parsed but never drawn.

### Changed

- A sequence-diagram participant nothing declares is created where it is first named, as
  in Mermaid, instead of being an error that dropped the message. Lanes run in the order
  participants are first named, and a later `participant X as Label` sets the label
  without moving the lane. A `create participant X` after X was already named is still
  an error.

### Fixed

- A `timeline:` block can name a sequence diagram's notes (`note:1`, ...) and activation
  bars (`activation:1`, ...). They were drawn with these ids but rejected as unknown.
- `highlight ... outline` is visible on every sequence-diagram target: participants
  (both rows, the lifeline and the destroy mark), messages, blocks including `rect`,
  box groupings and activation bars. It used to change nothing. `glow` now also takes
  those targets' strokes to the highlight color, as it does in the other diagram types.
- Sequence-diagram keywords are read in any case, as in Mermaid: `Note LEFT OF A`,
  `Participant A AS Alice`, `Loop` ... `End`, `ACTIVATE`, `Autonumber` and the rest.
  Only lowercase was accepted, and any other spelling rejected the whole diagram.
- The flowchart shorthand `click X "url"` takes an optional tooltip and target, as the
  `click X href "url"` form does. With either, the line was rejected.

## [0.1.0] - 2026-09-29

First public release.

### Added

- `render(source, container, options?)`, which parses a Siren document, draws it into a
  container as SVG, and returns the `<svg>`, an `AnimationController` and every
  `Diagnostic`.
- Five diagram types, written in Mermaid syntax:
  - **Flowchart** (`flowchart` / `graph`): four directions, fourteen node shapes, every
    arrow form, edge labels, subgraphs (with their own direction), Markdown labels, and
    `accTitle` / `accDescr`.
  - **Sequence diagram**: participants and actors, every message arrow, `autonumber`,
    control-flow blocks (`loop`, `alt`, `opt`, `par`, `critical`, `break`, `rect`),
    create/destroy, `box` groupings, activations, notes and links.
  - **Class diagram**: members, generics, annotations, relationships with
    multiplicities, lollipop interfaces, namespaces, notes and direction.
  - **State diagram** (`stateDiagram-v2`): `[*]` start and end, descriptions, composite
    states, concurrent regions, choice, fork and join, notes and direction.
  - **ER diagram**: entities, relationships with cardinality markers, attribute tables,
    aliases and direction.
- The `timeline:` block. Each non-blank line is one step, with `enter` and `exit`
  (`fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom`), `highlight`
  (`outline`, `glow`) and `unhighlight` actions that target any node, edge, class,
  participant, message, block, state or entity by id.
- `AnimationController` with `next()`, `prev()` and `reset()`. `prev()` restores each
  earlier step exactly.
- Author styling as in Mermaid: `classDef`, `class`, `:::name`, `style` and `linkStyle`.
- Click interactions: `click ... href` becomes a link, and `click ... call fn()` is
  passed to the `onClick` option without running any function named in the document.
- A `measureText` option for sizing labels with real text metrics.
- `siren-core/theme.css`, with light and dark palettes and `--siren-*` custom
  properties for colors, text, lines, shapes and motion.
- Diagnostics with severity, line and column, for every problem in a document.
  Constructs that aren't implemented yet are rejected with an error instead of being
  drawn incorrectly.
- ES module build with bundled TypeScript declarations, and a self-contained
  `dist/siren-core.js` for use without a bundler.
