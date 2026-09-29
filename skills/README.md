# Agent skills

Skills that teach AI coding agents to work with Siren. They follow the open
[Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md` file (YAML
front matter plus Markdown instructions) and optional supporting files. They don't
depend on any particular agent or model.

| Skill              | What it does                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| [`siren`](./siren) | Writes, edits and validates `.srn` documents: Mermaid-syntax diagrams with a step-by-step `timeline:`. |

## Installing

Copy the skill folder into the directory your agent loads skills from. For example:

```sh
# Claude Code, for every project
cp -r skills/siren ~/.claude/skills/

# Claude Code, for one project
cp -r skills/siren .claude/skills/
```

Other agents that support Agent Skills load them from their own skills directory. See
your agent's documentation for the location.

If your agent doesn't support skills, give it `siren/SKILL.md` and
`siren/references/syntax.md` as context, for example as project instructions.

## Validation

The `siren` skill includes `scripts/validate.mjs`, which renders a document with
`siren-core` and reports every error and warning with its line and column. The agent
runs it after writing a document. It needs Node.js 18 or later, and two packages in
the directory it runs from:

```sh
npm install --no-save siren-core jsdom
node <skill-dir>/scripts/validate.mjs diagram.srn --ids
```

## Contents of `siren`

```
siren/
  SKILL.md              workflow, document shape, timeline rules, target ids, common errors
  references/syntax.md  supported syntax for each diagram type, and what isn't supported
  scripts/validate.mjs  validator
```
