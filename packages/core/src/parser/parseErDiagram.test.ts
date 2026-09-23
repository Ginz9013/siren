import { describe, expect, it } from "vitest";
import type { ErDocument } from "../contracts";
import { parseErDiagram } from "./parseErDiagram";

/**
 * The parsed document, or a thrown explanation naming what went wrong
 * instead — the shape `documentOf` in `parseStateDiagram.test.ts` already
 * has, so a test about entities reads the document without repeating the
 * null check or the kind check. Narrowing once in the return type is what
 * keeps `document!` and a vacuous `not.toBeNull()` out of every test below.
 */
function documentOf(source: string): ErDocument {
  const { document, diagnostics } = parseErDiagram(source);
  if (document === null) {
    throw new Error(
      `expected an ER document, got diagnostics: ${diagnostics
        .map((d) => d.message)
        .join("; ")}`,
    );
  }
  if (document.kind !== "er") {
    throw new Error(`expected an ER document, got a ${document.kind} one`);
  }
  return document;
}

/** The names the parser read, in source order. */
const namesOf = (source: string): string[] =>
  documentOf(source).entities.map((entity) => entity.name);

describe("parseErDiagram", () => {
  it("reads a bare name on a line of its own as a standalone entity", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): an entity with
    // no relationship at all enters Mermaid's entity table and is drawn —
    // `erDiagram / CUSTOMER / ORDER` reports two entities, `shape="erBox"`
    // each, and no relationships. So a relationship is not what declares an
    // entity, and this document is legal ER rather than an empty diagram.
    expect(namesOf("erDiagram\n  CUSTOMER\n  ORDER\n")).toEqual(["CUSTOMER", "ORDER"]);
  });

  it("accepts a header with no entities under it at all", () => {
    // Measured: `erDiagram` on its own is **not** an error in Mermaid — it
    // reports the diagram type `er` with an empty entity table. So an empty
    // diagram is a diagram, and refusing the document would cost one Mermaid
    // renders.
    const { document, diagnostics } = parseErDiagram("erDiagram\n");

    expect(diagnostics).toEqual([]);
    expect(documentOf("erDiagram\n").entities).toEqual([]);
    expect(document).not.toBeNull();
  });

  it("reads a name in the whole alphabet Mermaid reads one in", () => {
    // Measured, one probe over all of them at once: each of these is **one**
    // entity in mermaid 11.17.2, whose ER lexer spells a name
    // `([^\x00-\x7F]|\w|-|\*|\.)+`. `LINE-ITEM` is the one that matters most
    // — a hyphen is ordinary here, and this is a *different language* from a
    // flowchart, where a dashed id is still an open gap. Reusing the `\w+` a
    // state or a flowchart id is read in would have refused it.
    expect(
      namesOf("erDiagram\n  LINE-ITEM\n  A_B\n  a1\n  Order2\n  P.Q\n  Ünïcode\n  中文實體\n"),
    ).toEqual(["LINE-ITEM", "A_B", "a1", "Order2", "P.Q", "Ünïcode", "中文實體"]);

    // And the boundary Mermaid itself draws: `$` is outside that alphabet
    // and `X$Y` is a parse error there, so it is not a name here either.
    expect(refusalsFor("erDiagram\n  X$Y\n")).toEqual([
      'Unrecognized erDiagram line: "X$Y"',
    ]);
  });

  it("does not read a line of nothing but relationship punctuation as an entity", () => {
    // The over-reach the measured name alphabet invites: `-` and `.` are each
    // a legal entity name on their own (measured — both report one entity),
    // so the alphabet has to admit them, and admitting them lets a *run* of
    // them through too. Mermaid does not: `--`, `---` and `..` are its
    // relationship-body tokens, and a line of nothing but one is a parse
    // error ("got 'IDENTIFYING'", "got 'NON_IDENTIFYING'"), never a name.
    // Drawing a box labelled `--` for a document Mermaid refuses is the
    // silent mis-render this exists to stop.
    for (const line of ["--", "---", "..", ".-", "-."]) {
      const { document, diagnostics } = parseErDiagram(`erDiagram\n  ${line}\n`);
      expect(document, `for the line "${line}"`).toBeNull();
      expect(diagnostics.map((d) => d.severity), `for the line "${line}"`).toContain("error");
    }

    // The negative control, so the guard cannot pass by refusing every name
    // with a dash or a dot in it: each of these is one entity in Mermaid.
    expect(namesOf("erDiagram\n  -\n  .\n  LINE-ITEM\n  P.Q\n")).toEqual([
      "-",
      ".",
      "LINE-ITEM",
      "P.Q",
    ]);
  });
});

/** The messages the parser reported for `source`. */
const refusalsFor = (source: string): string[] =>
  parseErDiagram(source).diagnostics.map((d) => d.message);

describe("parseErDiagram refuses an unimplemented construct by name", () => {
  it("names a relationship, in both of the spellings Mermaid accepts for one", () => {
    // Measured (mermaid 11.17.2): `CUSTOMER ||--o{ ORDER : places` and
    // `CUSTOMER one to zero or more ORDER : places` report the *same*
    // relationship — `leftCard="ONLY_ONE" relType="IDENTIFYING"
    // rightCard="ZERO_OR_MORE"` — so the words are a synonym of the
    // punctuation and not a separate construct. Both are refused here, so an
    // author reaching for either is told which construct is missing rather
    // than that their document is malformed.
    for (const line of [
      "CUSTOMER ||--o{ ORDER : places",
      "A }o..o{ B : x",
      "CUSTOMER one to zero or more ORDER : places",
    ]) {
      expect(refusalsFor(`erDiagram\n  ${line}\n`), `for the line "${line}"`).toEqual([
        `Unimplemented erDiagram construct: a relationship between two entities, in "${line}"`,
      ]);
    }
  });

  it("names an attribute block once, rather than once per line inside it", () => {
    // Measured: `CUSTOMER { string name / int age }` records the two
    // attributes *under* the entity, which still enters the table as
    // `CUSTOMER`. The block is therefore one construct, and reporting its
    // body lines as malformed as well would make three claims where one is
    // true — two of them untrue, since `string name` is perfectly good ER.
    expect(
      refusalsFor("erDiagram\n  CUSTOMER {\n    string name\n    int age\n  }\n  ORDER\n"),
    ).toEqual([
      'Unimplemented erDiagram construct: an entity\'s attribute block, in "CUSTOMER {"',
    ]);
  });

  it("names an alias, and leaves the bracketless entity beside it alone", () => {
    // Measured: `CUSTOMER["Customer Account"]` records one entity whose
    // `label` is still `CUSTOMER` with `alias="Customer Account"` beside it —
    // the alias is a second field on the entity, not a renaming of it. Read
    // and dropped, the box would be titled with the name the author took
    // care to replace.
    const line = 'CUSTOMER["Customer Account"]';
    expect(refusalsFor(`erDiagram\n  ${line}\n`)).toEqual([
      `Unimplemented erDiagram construct: an entity alias, in "${line}"`,
    ]);
  });

  it("names a document-level direction, and only for a direction Mermaid reads as one", () => {
    // Measured: `direction LR` in an ER document reports `LR` where a
    // document naming none reports `TB`, so it genuinely governs the layout.
    // Read and dropped, a diagram the author asked to run left-to-right
    // would be drawn top-to-bottom with nothing said.
    // `direction lr` is here because Mermaid's lexer is case-insensitive and
    // reports `LR` for it (measured) — refusing only the shouted spelling
    // would leave the quiet one reported as a malformed line.
    for (const line of ["direction LR", "direction TB", "direction BT", "direction lr"]) {
      expect(refusalsFor(`erDiagram\n  ${line}\n  A\n`), `for "${line}"`).toEqual([
        `Unimplemented erDiagram construct: a document-level "direction" statement, in "${line}"`,
      ]);
    }

    // The over-reach control. Measured: `direction` on a line of its own is
    // an ordinary **entity** (Mermaid reports one entity called `direction`
    // and the document's direction still `TB`), so a pattern reaching for a
    // bare keyword would refuse a document Mermaid draws.
    expect(namesOf("erDiagram\n  direction\n")).toEqual(["direction"]);
  });
});
