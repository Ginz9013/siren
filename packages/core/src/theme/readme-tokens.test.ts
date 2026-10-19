import { describe, expect, it } from "vitest";

/**
 * The README's token table and `default.css`'s `:root` block must name the
 * same tokens: `:root` is the theme's whole styling interface (ADR-0014) and
 * holds only design tokens (decision 01M59N4KXRKK7R9Y55K64R4013), and the
 * table is where a theme author reads what that interface is.
 *
 * Both files are read off disk the way `default.test.ts` reads `default.css`
 * (see the note there on why neither `?raw` nor `import "node:fs"` works in
 * this package).
 */
const readText = (relativePath: string): string =>
  (
    globalThis as unknown as {
      process: {
        getBuiltinModule(id: "node:fs"): { readFileSync(path: string, encoding: "utf8"): string };
      };
    }
  ).process
    .getBuiltinModule("node:fs")
    .readFileSync(`${(import.meta as unknown as { dirname: string }).dirname}/${relativePath}`, "utf8");

const TOKEN = /--siren-[a-z0-9-]+/g;

/** Every `--siren-*` name in the Tokens column of the `| Group | Tokens |` table. */
function readmeTokens(readme: string): Set<string> {
  const lines = readme.split("\n");
  const header = lines.findIndex((line) => /^\|\s*Group\s*\|\s*Tokens\s*\|\s*$/.test(line));
  if (header === -1) throw new Error("README has no `| Group | Tokens |` table");
  const tokens = new Set<string>();
  // Skip the header and its `| --- | --- |` separator; the table ends at the first non-row line.
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const tokensCell = line.split("|").slice(2).join("|");
    for (const match of tokensCell.matchAll(TOKEN)) tokens.add(match[0]);
  }
  return tokens;
}

/** Every custom property the stylesheet's first `:root` block declares, comments removed. */
function rootTokens(css: string): Set<string> {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /(?:^|[}\s]):root\s*\{([^}]*)\}/.exec(rules);
  if (!block) throw new Error("stylesheet has no `:root` block");
  return new Set(Array.from(block[1].matchAll(/(--siren-[a-z0-9-]+)\s*:/g), (match) => match[1]));
}

/** What the README is missing from `:root`, and what it lists that `:root` does not declare. */
function tableDrift(readme: string, css: string): { missingFromReadme: string[]; extraInReadme: string[] } {
  const listed = readmeTokens(readme);
  const declared = rootTokens(css);
  return {
    missingFromReadme: [...declared].filter((token) => !listed.has(token)).sort(),
    extraInReadme: [...listed].filter((token) => !declared.has(token)).sort(),
  };
}

describe("README token table", () => {
  it("lists exactly the tokens default.css declares on :root", () => {
    const drift = tableDrift(readText("../../README.md"), readText("default.css"));
    expect(drift).toEqual({ missingFromReadme: [], extraInReadme: [] });
  });

  // The comparison itself, on fixtures, so a drift in either direction is
  // known to be caught rather than assumed to be.
  it("reports a token on either side that the other lacks", () => {
    const readme = [
      "| Group | Tokens |",
      "| ----- | ------ |",
      "| Colors | `--siren-a` (`none`, a note), `--siren-listed-only` |",
      "",
      "Prose mentioning `--siren-prose` is not the table.",
    ].join("\n");
    const css = [
      "/* --siren-commented: 1; */",
      ":root {",
      "  --siren-a: none;",
      "  /* --siren-also-commented: 2; */",
      "  --siren-declared-only: 1px;",
      "}",
      ".x { --siren-elsewhere: 0; }",
    ].join("\n");
    expect(tableDrift(readme, css)).toEqual({
      missingFromReadme: ["--siren-declared-only"],
      extraInReadme: ["--siren-listed-only"],
    });
  });
});
