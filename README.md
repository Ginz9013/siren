# Siren

Siren is a Mermaid-syntax-aligned diagram renderer for authoring declarative
animation (step reveal, highlighting, enter/exit transitions) inside the same
plain-text diagram document.

This repository is a pnpm workspace. The core library lives in
`packages/core` (`@siren/core`).

## Development

```sh
pnpm install
pnpm --filter @siren/core test
```

MIT licensed — see [LICENSE](./LICENSE).
