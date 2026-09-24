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

  it("reads a relationship's two markers on the sides the author wrote them", () => {
    // **The trap this test exists to spring.** Measured (mermaid 11.17.2,
    // `scripts/mermaid-probe.mjs`), Mermaid records a relationship's two
    // cardinalities *crossed*: for `CUSTOMER ||--o{ ORDER : places` it
    // reports `cardA="ZERO_OR_MORE" cardB="ONLY_ONE"` — `cardA` is the
    // marker written next to `entityB`. Implementing from those field names
    // draws every relationship backwards, and the two sources below are
    // **asymmetric** so that a swap cannot hide: a symmetric `||--||` passes
    // either way round.
    expect(documentOf("erDiagram\n  CUSTOMER ||--o{ ORDER : places\n").relationships).toEqual([
      {
        left: "CUSTOMER",
        leftCardinality: "onlyOne",
        line: "identifying",
        rightCardinality: "zeroOrMore",
        right: "ORDER",
        label: "places",
      },
    ]);
    // The mirror image of the same relationship. Measured:
    // `leftCard="ZERO_OR_MORE" rightCard="ONLY_ONE"` — so reading the line
    // backwards turns this one into the one above.
    expect(documentOf("erDiagram\n  ORDER }o--|| CUSTOMER : belongs\n").relationships).toEqual([
      {
        left: "ORDER",
        leftCardinality: "zeroOrMore",
        line: "identifying",
        rightCardinality: "onlyOne",
        right: "CUSTOMER",
        label: "belongs",
      },
    ]);
  });

  it("reads the word spelling of a cardinality as the same thing as the punctuation", () => {
    // Measured, one probe per spelling: the words reach the *same* records
    // as the punctuation, so they are a synonym rather than a second
    // construct — which is why one corpus row covers both. Every source here
    // is asymmetric, so reading the line backwards fails it.
    //
    // Mermaid's lexer rules are all `/i`, measured: `A ZERO OR ONE to many B`
    // reports `ZERO_OR_ONE` too.
    const markers = (source: string) => {
      const [relationship] = documentOf(`erDiagram\n  ${source}\n`).relationships;
      return [relationship.leftCardinality, relationship.line, relationship.rightCardinality];
    };

    expect(markers("A one or zero to zero or many B : x")).toEqual([
      "zeroOrOne",
      "identifying",
      "zeroOrMore",
    ]);
    expect(markers("A ZERO OR ONE to many B : x")).toEqual([
      "zeroOrOne",
      "identifying",
      "zeroOrMore",
    ]);
    expect(markers("A zero or many optionally to many(1) B : x")).toEqual([
      "zeroOrMore",
      "nonIdentifying",
      "oneOrMore",
    ]);
    expect(markers("A 0+ to 1+ B : x")).toEqual(["zeroOrMore", "identifying", "oneOrMore"]);
    expect(markers("A many(0) to only one B : x")).toEqual([
      "zeroOrMore",
      "identifying",
      "onlyOne",
    ]);
    expect(markers("A 1 to one or many B : x")).toEqual(["onlyOne", "identifying", "oneOrMore"]);

    // And the two spellings **mix**, measured rather than assumed: each of
    // the three tokens is chosen independently, so a line may word one end
    // and punctuate the other.
    expect(markers("A one --o{ B : x")).toEqual(["onlyOne", "identifying", "zeroOrMore"]);
    expect(markers("A ||.. many B : x")).toEqual(["onlyOne", "nonIdentifying", "zeroOrMore"]);
  });

  it("declares both of a relationship's entities, in the order the line names them", () => {
    // Measured: `erDiagram / ZZZ / A ||--o{ B : first / B / A` reports three
    // entities in the order `ZZZ`, `A`, `B` — so a relationship declares its
    // two entities exactly as a bare name does, and the table is in
    // first-mention order across *both* kinds of statement. Recording the
    // endpoints anywhere but in this one list would lose that interleaving.
    expect(namesOf("erDiagram\n  ZZZ\n  A ||--o{ B : first\n  B\n  A\n")).toEqual([
      "ZZZ",
      "A",
      "B",
      "B",
      "A",
    ]);
  });
});

/** The messages the parser reported for `source`. */
const refusalsFor = (source: string): string[] =>
  parseErDiagram(source).diagnostics.map((d) => d.message);

describe("parseErDiagram refuses an unimplemented construct by name", () => {
  it('names the "u" cardinality, the fifth one this parser does not draw', () => {
    // Measured (mermaid 11.17.2): Mermaid's `Cardinality` enum has **five**
    // members, and the fifth is `MD_PARENT`, spelled `u` — its lexer rule is
    // `u(?=[.\-|])`. `A u--o{ B : x` parses, and the renderer then emits the
    // edge with `marker-end` only and **no `marker-start` at all**, because
    // `md_parent` names no marker in its table.
    //
    // Nothing in the document says what a missing marker means, so this is
    // refused by name rather than guessed at — and named as itself rather
    // than as "a relationship", which this parser now draws.
    //
    // Only ever the **left** cardinality, and that is measured too: the
    // lookahead means `u` is only a marker when the body follows it
    // immediately, so `A ||--u B : x` is a parse error ("got 'UNICODE_TEXT'")
    // and there is no right-hand spelling of it to refuse.
    for (const line of ["A u--o{ B : x", "A u..|| B : x", "A u-.o{ B : x"]) {
      expect(refusalsFor(`erDiagram\n  ${line}\n`), `for the line "${line}"`).toEqual([
        `Unimplemented erDiagram construct: the "u" (MD_PARENT) relationship cardinality, in "${line}"`,
      ]);
    }

    // Measured over-reach control: `u` is a cardinality only directly before
    // `.`, `-` or `|`, so an entity called `u` — and one called `usage` — is
    // an ordinary name, and `A u to many B : x` is a Mermaid **parse error**
    // rather than a relationship.
    expect(namesOf("erDiagram\n  u\n  usage\n")).toEqual(["u", "usage"]);
  });

  it("refuses a relationship line Mermaid itself refuses, rather than reading one", () => {
    // Each of these is a measured Mermaid parse error, so reading any of
    // them would be Siren drawing a picture for a document that has none.
    //
    // - `A ||--o{ B` — "Expecting 'COLON', 'STYLE_SEPARATOR', got 'NEWLINE'".
    //   The `: label` is part of the grammar, not an option.
    // - `A -- B : x` — `relSpec` is `cardinality relType cardinality`, so a
    //   body with no markers either side is not a relationship.
    // - `Ao|--o{ B : x` and `Ao{--|| B : x` — the **over-reach this pattern
    //   invites**, and the same shape as the run-of-punctuation trap one
    //   ticket back. `o` is in the entity-name alphabet, so Mermaid's
    //   longest-match lexer reads the name as `Ao` and what is left is not a
    //   cardinality. A pattern letting any cardinality glue itself to the
    //   left-hand name reads two documents Mermaid rejects.
    // - `A ||--o{ B : --` — a label of nothing but body punctuation, refused
    //   with "got 'IDENTIFYING'", exactly as a *name* of nothing but body
    //   punctuation is.
    for (const line of [
      "A ||--o{ B",
      "A -- B : x",
      "Ao|--o{ B : x",
      "Ao{--|| B : x",
      "A ||--o{ B : --",
    ]) {
      const { document, diagnostics } = parseErDiagram(`erDiagram\n  ${line}\n`);
      expect(document, `for the line "${line}"`).toBeNull();
      expect(diagnostics.map((d) => d.severity), `for the line "${line}"`).toContain("error");
    }

    // The negative controls, so the guard above cannot pass by refusing
    // every relationship: each of these *is* one in Mermaid. `A}o--|| B` is
    // the mirror of the glued case — `}` cannot appear in a name, so this
    // one really is a relationship.
    for (const line of ["A}o--|| B : x", "A||--o{B : x", "A ||-- o{ B : x", "A ||--o{ B : -"]) {
      expect(refusalsFor(`erDiagram\n  ${line}\n`), `for the line "${line}"`).toEqual([]);
    }
  });

  it("names a second statement written after a relationship on the same line", () => {
    // Measured, and genuinely surprising: `A ||--o{ B : two words` is **not**
    // a relationship labelled "two words". Mermaid reports the role as `two`
    // and then declares a *third entity* called `words` — its grammar runs
    // several statements on one line, which this parser does not. Reading
    // the whole tail as the label would draw a label Mermaid never draws and
    // lose a box it does.
    const line = "A ||--o{ B : two words";
    expect(refusalsFor(`erDiagram\n  ${line}\n`)).toEqual([
      `Unimplemented erDiagram construct: a second statement after a relationship on the same line, in "${line}"`,
    ]);

    // A quoted label is the spelling that *does* carry a space — measured,
    // `: "two words"` reports the role as `two words` with no extra entity.
    expect(documentOf('erDiagram\n  A ||--o{ B : "two words"\n').relationships[0].label).toBe(
      "two words",
    );
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
