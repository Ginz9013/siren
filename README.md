# Siren

**Mermaid-syntax diagrams that animate step by step.**

Siren is a diagram format and renderer. You write a diagram in Mermaid syntax, then add a
`timeline:` block that says, step by step, what to reveal, highlight or remove. The result
is one plain-text document that renders as an SVG your reader can step through.

```
sequenceDiagram
  participant Browser
  participant API
  participant DB
  Browser->>API: GET /orders
  API->>DB: SELECT orders
  DB-->>API: rows
  API-->>Browser: 200 OK

timeline:
  enter Browser-API fade
  enter API-DB slide-right, highlight DB outline
  enter DB-API fade, unhighlight DB
  enter API-Browser fade, highlight API-Browser glow
```

One diagram can also tell several stories. Instead of a single `timeline:`, give each
story its own named block, and the reader picks which one to play:

```
timeline card:
  enter Order fade
  enter CreditCard fade, highlight CreditCard glow

timeline wallet:
  enter Order fade
  enter Wallet fade, highlight Wallet glow
```

Each block runs from its `timeline <name>:` header to the next one, counts its own steps,
and is checked on every render whichever one is shown. A document uses either one unnamed
`timeline:` or named blocks, never both. `render()` plays the first block unless you pass
another name, and `siren-board` shows a dropdown to switch between them (see
[`examples/multi-timeline.srn`](./examples/multi-timeline.srn)).

It supports flowchart, sequence, class, state and ER diagrams. Siren draws the diagrams
itself and follows one rule for Mermaid compatibility: a document that renders in Mermaid
must render here, and a construct that isn't implemented yet is rejected with a clear
error instead of being drawn incorrectly.

## Packages

| Package                           | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| [`siren-core`](./packages/core)   | Parser, layout, SVG renderer and animation controller. Start here for the syntax and the API. |
| [`siren-board`](./packages/board) | A drop-in browser player with step controls, pan and zoom.                        |

Each package records its releases in its own `CHANGELOG.md`
([core](./packages/core/CHANGELOG.md), [board](./packages/board/CHANGELOG.md)).

```sh
npm install siren-board siren-core
```

```js
import { createBoard } from "siren-board";
import "siren-core/theme.css";

createBoard(document.getElementById("board"), { source });
```

## Writing Siren with AI

[`skills/siren`](./skills/siren) is an agent skill that teaches AI coding agents to
write, edit and validate `.srn` documents. It works with any agent that supports the
Agent Skills format. See [`skills/`](./skills) for installation.

## Examples and demos

- [`examples/`](./examples): `.srn` documents for every diagram type, with timelines.
- [`demos/`](./demos): HTML pages that play them. To run them:

  ```sh
  pnpm install
  pnpm build
  npx serve .   # then open http://localhost:3000/demos/gallery.html
  ```

  The pages load `.srn` files with `fetch()`, so they must be served over HTTP. Opening
  them from the file system doesn't work.

## Repository layout

```
packages/core    siren-core: parser → graph model → layout → SVG renderer → animation
packages/board   siren-board: the player built on siren-core
skills/          agent skill for writing Siren documents with AI
examples/        sample Siren documents
demos/           HTML pages that render the examples
docs/adr/        architecture decision records
CONTEXT.md       the project glossary and design notes
```

## Development

This repository is a pnpm workspace. It requires Node.js 18 or later and pnpm.

```sh
pnpm install     # install dependencies
pnpm test        # run every package's tests
pnpm build       # build every package into its dist/
```

To work on one package:

```sh
pnpm --filter siren-core test:watch
```

Before changing behavior, read [`CONTEXT.md`](./CONTEXT.md) for the project's
vocabulary and [`docs/adr/`](./docs/adr) for the decisions behind the current design.

## Contributing

Bug reports and pull requests are welcome.

- **A diagram renders wrong or is rejected**: [open an issue](https://github.com/Ginz9013/siren/issues)
  with the smallest document that shows it. If it renders correctly in Mermaid, say which
  Mermaid version you used.
- **A pull request**: add tests for the change and make sure `pnpm test` passes.

## Releasing

Publish with `pnpm`, not `npm`. `pnpm publish` rewrites `siren-board`'s
`workspace:^` dependency to a real version range.

1. Update `version` in both `packages/*/package.json`. The two move together: `siren-board`
   depends on `siren-core`, so a core release gets a board release of the same version, and
   board's changelog section names the core version it requires.
2. In each package's `CHANGELOG.md`, move the entries under `[Unreleased]` into a new
   section for the version, dated with the release day.
3. Log in with `npm login` if needed.
4. Publish:

   ```sh
   pnpm run publish
   ```

   This is the root script for `pnpm -r publish --access public`. Type `run`: a bare
   `pnpm publish` is pnpm's own command, not this script.

Each package's `prepublishOnly` script runs its tests and build before it is published.
`LICENSE` is copied into each package so it travels in the tarball; npm only picks up the one
beside the `package.json` it is publishing, not the repository root's.

## License

[MIT](./LICENSE)
