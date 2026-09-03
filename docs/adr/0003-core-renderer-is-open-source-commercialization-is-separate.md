---
status: accepted
---

# Core renderer is open source (MIT); commercialization lives in a separate future project

The goal is for the Siren format to become as widely adopted and authoritative as mermaid itself.
Mermaid's ubiquity is a direct function of being embeddable everywhere without licensing
friction — GitHub, GitLab, Notion, VS Code's built-in preview, static doc generators all render it
for free. Closed-source competitors surveyed during initial research (FlowGif, fanfa.dev,
Ilograph) are all niche SaaS products, none reaching "de facto standard" status — closed formats
don't get embedded by third-party tools. `packages/core` (this repo) is therefore MIT-licensed.
Any commercialization — cloud collaboration, AI-assisted authoring, premium VS Code features —
is scoped to a separate future project (website + playground), mirroring the Mermaid.js
(open engine) / Mermaid Chart Inc. (commercial layer on top) split.

## Considered Options

- **Fully closed source** — rejected. Directly conflicts with the "become a de facto standard"
  goal; a format nobody but its own tool can render doesn't get adopted as a standard.
- **Open source everything, including future commercial features, from day one** — deferred, not
  rejected. That's a decision for when the website/playground project starts; out of scope for
  this repo.
