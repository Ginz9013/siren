import { describe, expect, it } from "vitest";
import { readAccDescrBlock } from "./readAccDescrBlock";

/** Reads the block opened on the first line of `source`, at its `{`. */
function read(source: string) {
  const lines = source.split("\n");
  return readAccDescrBlock(lines, 0, lines[0].indexOf("{"));
}

describe("readAccDescrBlock", () => {
  // Every expectation measured on mermaid 12.2.0, in flowchart, sequence and
  // ER diagrams alike.
  it("drops each line's leading whitespace and every blank line", () => {
    expect(read("accDescr {\n    line one\n\n      line two\n  }")).toEqual({
      closed: true,
      description: "line one\nline two",
      closeIndex: 4,
      rest: null,
    });
  });

  it("reads a block opened and closed on one line", () => {
    expect(read("accDescr{one}")).toMatchObject({ description: "one", closeIndex: 0, rest: null });
    expect(read("  accDescr { one }  ")).toMatchObject({ description: "one", rest: null });
    expect(read("accDescr { one\n  two }")).toMatchObject({ description: "one\ntwo", closeIndex: 1 });
  });

  it("reads an empty block as no description at all", () => {
    expect(read("accDescr {\n  }")).toMatchObject({ description: null });
  });

  it("hands back what follows the `}` as the next statement, blanked to its column", () => {
    expect(read("  accDescr { one } A --> B")).toMatchObject({ description: "one", rest: `${" ".repeat(19)}A --> B` });
  });

  it("reports a block that never closes", () => {
    expect(read("accDescr {\n  one\n  A")).toEqual({ closed: false });
  });
});
