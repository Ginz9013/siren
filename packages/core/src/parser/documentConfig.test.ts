import { describe, expect, it } from "vitest";
import { parseSiren } from "./parseSiren";

const lookWarning = 'Document config "look" is read but not applied yet; the diagram is drawn without it.';

function warningsOf(source: string): string[] {
  return parseSiren(source)
    .diagnostics.filter((d) => d.severity === "warning")
    .map((d) => d.message);
}

/**
 * The document config `look`. Siren draws in the classic look, so asking
 * for it is already honoured; any other look is read, kept, and reported as
 * not applied.
 */
describe("document config look", () => {
  it("accepts `look: classic` in a frontmatter without a diagnostic, and keeps it", () => {
    const { diagnostics, config } = parseSiren("---\nconfig:\n  look: classic\n---\nflowchart TD\n  A --> B");
    expect(diagnostics).toEqual([]);
    expect(config).toEqual({ look: "classic" });
  });

  it("accepts `look: classic` in an init directive without a diagnostic, and keeps it", () => {
    const { diagnostics, config } = parseSiren('%%{init: {"look": "classic"}}%%\nflowchart TD\n  A --> B');
    expect(diagnostics).toEqual([]);
    expect(config).toEqual({ look: "classic" });
  });

  it("still warns for the other keys beside `look: classic`", () => {
    expect(warningsOf("---\nconfig:\n  look: classic\n  theme: dark\n---\nflowchart TD\n  A --> B")).toEqual([
      'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
    ]);
  });

  it.each(["neo", "handDrawn", "fancy", "Classic"])("still warns that `look: %s` is not applied", (look) => {
    expect(warningsOf(`---\nconfig:\n  look: ${look}\n---\nflowchart TD\n  A --> B`)).toEqual([lookWarning]);
    expect(warningsOf(`%%{init: {"look": "${look}"}}%%\nflowchart TD\n  A --> B`)).toEqual([lookWarning]);
  });

  it("still warns for a look that is not a string", () => {
    expect(warningsOf("---\nconfig:\n  look: 42\n---\nflowchart TD\n  A --> B")).toEqual([lookWarning]);
  });

  it("an init's other look wins over a frontmatter's classic, and is reported", () => {
    const source = '---\nconfig:\n  look: classic\n---\n%%{init: {"look": "neo"}}%%\nflowchart TD\n  A --> B';
    expect(warningsOf(source)).toEqual([lookWarning]);
  });
});
