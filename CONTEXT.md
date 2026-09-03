# Siren

Siren is a Mermaid-syntax-aligned diagram format and renderer that adds declarative animation —
step reveal, highlighting, enter/exit transitions — authored inside the same plain-text document
as the diagram. See `docs/adr/` for the architectural decisions behind it.

## Language

**Siren document**:
A plain-text file containing Mermaid-compatible diagram syntax (flowchart, etc.) plus an optional
timeline block describing how elements animate. The single self-contained artifact an author
writes and a renderer consumes — copy the whole document, paste it wherever `@siren/core` is
loaded, and it renders. Convention: `.srn` file extension.
_Avoid_: Siren file, Siren spec, animation file

**Core renderer** (`@siren/core`):
The parser, graph model, layout engine, SVG renderer, and animation runtime, published as one npm
package. Does not include the VS Code extension, the website, or the playground — those are
separate projects.
_Avoid_: the library, the engine (ambiguous — say which stage: parser, layout, renderer, ...)

**Timeline block**:
The `timeline:` section of a Siren document. Lists step entries that assign animation actions to
nodes/edges by id. Deliberately separate from the diagram's structural definition — see
[ADR-0002](docs/adr/0002-animation-timeline-is-a-separate-block.md).
_Avoid_: animation block, timeline section

**Step**:
A positive integer named in a timeline block. Steps reveal in ascending order via
`controller.next()`. A node or edge never mentioned in the timeline block is visible from the
start (implicit "step 0").
_Avoid_: frame, stage

**Enter effect**:
The action a pending node or edge performs when its step is revealed. `fade` is the only effect
defined so far.
_Avoid_: animation type, transition

**Diagnostic**:
A non-fatal, structured message (`severity: 'error' | 'warning'`) describing a problem in a Siren
document — an unresolved timeline reference, a duplicate node id, etc. Returned from `render()`,
never thrown.
_Avoid_: error, warning (too broad alone — say "diagnostic" for the type, "error-severity
diagnostic" for the level)
