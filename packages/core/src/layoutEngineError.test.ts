import { describe, expect, it, vi } from "vitest";

// The engine is replaced at the one seam it sits behind, `elkSync`, by a
// stand-in that rejects every graph the way the real wrapper rejects one ELK
// cannot read. No document is known to reach that path — the shared layout
// core only ever names nodes it declared — so this is the one way to show
// what an author would see if one ever did.
vi.mock("./layout/elkSync", async (importActual) => {
  const actual = await importActual<typeof import("./layout/elkSync")>();
  return {
    ...actual,
    layoutWithElk: () => {
      throw new actual.LayoutEngineError("org.eclipse.elk.graph.json.JsonImportException: Referenced shape does not exist: ghost");
    },
  };
});

const { render } = await import("./index");

describe("render() — a diagram the layout engine rejects", () => {
  it("returns no SVG and one error diagnostic naming what the engine said, rather than throwing", () => {
    const container = document.createElement("div");
    const result = render("flowchart TB\n  A --> B\n", container);

    expect(result.svg).toBeNull();
    expect(result.controller).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe("error");
    expect(result.diagnostics[0].message).toMatch(/layout engine rejected this diagram.*ghost/);
  });
});
