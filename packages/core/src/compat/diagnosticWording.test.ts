/**
 * A guard over the wording of every diagnostic the corpora reach: a message
 * says what is wrong and how to fix it, and never names Mermaid. The reader
 * is fixing their own document; another tool's name tells them nothing they
 * can act on.
 *
 * `COMPAT_CASES` already spreads `LABEL_CASES`, so one pass covers both
 * corpora. This only sees what the corpora exercise; messages they do not
 * reach are covered by their own module's tests.
 */
import { describe, expect, it } from "vitest";
import { render } from "../index";
import { COMPAT_CASES } from "./corpus";

describe("diagnostic wording across the corpora", () => {
  it("never names Mermaid in a diagnostic message", () => {
    const offenders: string[] = [];
    for (const entry of COMPAT_CASES) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const result = render(entry.source, container);
      for (const diagnostic of result.diagnostics) {
        if (/mermaid/i.test(diagnostic.message)) {
          offenders.push(`${entry.id} (${diagnostic.severity}): ${diagnostic.message}`);
        }
      }
      container.remove();
    }
    expect(offenders).toEqual([]);
  });
});
