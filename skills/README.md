# Agent skills

Skills that teach AI coding agents to work with Siren. They follow the open
[Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md` file (YAML
front matter plus Markdown instructions) and optional supporting files. They don't
depend on any particular agent or model.

| Skill              | What it does                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| [`siren`](./siren) | Writes and edits `.srn` documents: Mermaid-syntax diagrams with a step-by-step `timeline:`, or several named timelines. |

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

## Contents of `siren`

```
siren/
  SKILL.md              workflow, document shape, timeline rules (one or several blocks), target ids, color, common errors
  references/syntax.md  supported syntax for each diagram type, timeline blocks, style value rules, and what isn't supported
```
