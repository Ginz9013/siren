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

It supports flowchart, sequence, class, state and ER diagrams. Siren draws the diagrams
itself and follows one rule for Mermaid compatibility: a document that renders in Mermaid
must render here, and a construct that isn't implemented yet is rejected with a clear
error instead of being drawn incorrectly.

## Packages

| Package                           | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| [`siren-core`](./packages/core)   | Parser, layout, SVG renderer and animation controller. Start here for the syntax and the API. |
| [`siren-board`](./packages/board) | A drop-in browser player with step controls, pan and zoom.                        |

```sh
npm install siren-board siren-core
```

```js
import { createBoard } from "siren-board";
import "siren-core/theme.css";

createBoard(document.getElementById("board"), { source });
```

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

1. Update `version` in both `packages/*/package.json`.
2. Log in with `npm login` if needed.
3. Publish:

   ```sh
   pnpm -r publish --access public
   ```

Each package's `prepublishOnly` script runs its tests and build before it is published.

## License

[MIT](./LICENSE)
