import { describe, expect, it } from "vitest";
import type { Direction, ErAttribute, ErDocument } from "../contracts";
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

/**
 * The attributes the parser read under the **first** declaration of `name`,
 * or a thrown explanation naming what it did read instead. Narrowed here so
 * a test about an attribute block never reaches for `find(...)!`.
 */
function attributesOf(source: string, name: string): ErAttribute[] {
  const entities = documentOf(source).entities;
  const entity = entities.find((candidate) => candidate.name === name);
  if (entity === undefined) {
    throw new Error(
      `no entity named "${name}"; the parser read ${entities.map((e) => e.name).join(", ")}`,
    );
  }
  return entity.attributes;
}

/**
 * The alias the parser read under the **first** declaration of `name`, or a
 * thrown explanation naming what it did read instead. Narrowed here for the
 * reason `attributesOf` is: a test about an alias never reaches for
 * `find(...)!`, and never asserts on `undefined` by accident.
 */
function aliasOf(source: string, name: string): string | null {
  const entities = documentOf(source).entities;
  const entity = entities.find((candidate) => candidate.name === name);
  if (entity === undefined) {
    throw new Error(
      `no entity named "${name}"; the parser read ${entities.map((e) => e.name).join(", ")}`,
    );
  }
  return entity.alias;
}

/** The document's rank direction, read through the same narrowing helper. */
const directionOf = (source: string): Direction => documentOf(source).direction;

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

  it("reads an attribute block as attributes under the entity that opened it", () => {
    // Measured (mermaid 11.17.2, `scripts/mermaid-probe.mjs`): `CUSTOMER {
    // string name / int age }` records the two attributes *under* an entity
    // that still enters the table as `CUSTOMER` — the block is one
    // construct, not a run of statements, and it declares the entity as
    // surely as a bare name does. `ORDER` after the closing brace is an
    // ordinary entity again, which is what says the block really closed.
    const source = "erDiagram\n  CUSTOMER {\n    string name\n    int age\n  }\n  ORDER\n";

    expect(refusalsFor(source)).toEqual([]);
    expect(namesOf(source)).toEqual(["CUSTOMER", "ORDER"]);
    expect(attributesOf(source, "CUSTOMER")).toEqual([
      { type: "string", name: "name", keys: [], comment: "" },
      { type: "int", name: "age", keys: [], comment: "" },
    ]);
    // And an entity that opened no block has none — measured, `attributes`
    // comes back an empty collection for a bare name.
    expect(attributesOf(source, "ORDER")).toEqual([]);
  });

  it("splits an attribute's keys on the comma, and keeps a comma inside a comment", () => {
    // Measured (mermaid 11.17.2): `string c UK,PK "both"` reports
    // `keys: ["UK", "PK"]` — two keys, because Mermaid's block lexer takes
    // `\b(PK|FK|UK)\b` before its word rule, leaving the `,` to separate
    // them. The same character two fields to the right is ordinary text:
    // `"x, y"` is one comment with a comma in it.
    //
    // ⚠️ The split is **this construct's own**. One kind over, a state
    // diagram's `class Busy alpha,beta` does *not* split — it yields a
    // single literal class name `"alpha,beta"` — so neither behaviour may be
    // carried across from the other.
    const source =
      'erDiagram\n  CUSTOMER {\n    string c UK,PK "both"\n    int age PK "the age"\n' +
      '    string note "x, y"\n    string plain\n  }\n';

    expect(attributesOf(source, "CUSTOMER")).toEqual([
      { type: "string", name: "c", keys: ["UK", "PK"], comment: "both" },
      { type: "int", name: "age", keys: ["PK"], comment: "the age" },
      { type: "string", name: "note", keys: [], comment: "x, y" },
      { type: "string", name: "plain", keys: [], comment: "" },
    ]);

    // Over-reach control, measured: `x,y` in the *name* position is one
    // name and not two, because `x` is no key and the word rule — whose
    // alphabet contains the comma — then takes the lot.
    expect(attributesOf("erDiagram\n  E {\n    string x,y\n  }\n", "E")).toEqual([
      { type: "string", name: "x,y", keys: [], comment: "" },
    ]);
  });

  it("reads a type and a name in the alphabet Mermaid reads them in", () => {
    // Measured, one probe per line: the in-block word rule is
    // `[*A-Za-z_À-￿][A-Za-z0-9\-_\[\]().,À-￿*]*`, so
    // parentheses and brackets are ordinary *inside* a word — `string(99)`
    // and `int[]` are each one type — and so are `-`, `.`, `_`, `*` and
    // anything above ASCII. This is a **third** alphabet in this one diagram
    // kind: an entity name admits none of `()[]`, and a flowchart id admits
    // no hyphen.
    const source =
      "erDiagram\n  E {\n    string(99) code\n    int[] xs\n    decimal(10,2) price\n" +
      "    a-b c-d\n    a.b c.d\n    中文 名字\n    *x _y\n  }\n";

    expect(attributesOf(source, "E")).toEqual([
      { type: "string(99)", name: "code", keys: [], comment: "" },
      { type: "int[]", name: "xs", keys: [], comment: "" },
      { type: "decimal(10,2)", name: "price", keys: [], comment: "" },
      { type: "a-b", name: "c-d", keys: [], comment: "" },
      { type: "a.b", name: "c.d", keys: [], comment: "" },
      { type: "中文", name: "名字", keys: [], comment: "" },
      { type: "*x", name: "_y", keys: [], comment: "" },
    ]);

    // Several attributes on one line, because Mermaid's grammar is
    // `attributes: attribute | attributes attribute` — measured, `string a
    // int b` inside a block reports the same two attributes the two-line
    // spelling does.
    expect(attributesOf("erDiagram\n  E {\n    string a int b\n  }\n", "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
      { type: "int", name: "b", keys: [], comment: "" },
    ]);
  });

  it("refuses the attribute lines Mermaid refuses, rather than drawing half of one", () => {
    // Each of these is a parse error in mermaid 11.17.2, measured one probe
    // per line, and each is an over-reach this parser could easily commit:
    //
    // - `int 1st` — the word rule may not *begin* with a digit.
    // - `string PK` and `PK x` — the key rule is read before the word rule,
    //   so those two letters standing alone are never a type or a name.
    // - `string UK.y` — the same, mid-line: `UK` is taken, and `.y` is left
    //   where a name was wanted.
    // - `string c UK,XX "both"` — the key list holds key kinds only; a
    //   fourth word in that position is refused, not adopted as a key.
    // - `string x PK UK` and `string x PK,` — keys are comma-separated,
    //   and the comma may neither be omitted nor left dangling.
    // - `string x "a" PK` — the comment is last; keys after it are refused.
    // - `string x` alone on a line is fine, but `string` alone is not.
    // - `list~int~ xs` and `` `odd` x `` — a generic type and a backticked
    //   word are constructs Mermaid draws and this parser does not
    //   implement, so they are refused whole rather than half-read.
    for (const body of [
      "int 1st",
      "string PK",
      "PK x",
      "string UK.y",
      'string c UK,XX "both"',
      "string x PK UK",
      "string x PK,",
      'string x "a" PK',
      "string",
      "list~int~ xs",
      "`odd` x",
    ]) {
      expect(refusalsFor(`erDiagram\n  E {\n    ${body}\n  }\n`), `for "${body}"`).toEqual([
        `Unrecognized erDiagram attribute: "${body}"`,
      ]);
    }
  });

  it("refuses a block the author never closed, which Mermaid refuses too", () => {
    // Measured: `E {` with `string a` under it and no `}` is a parse error
    // in Mermaid — the block has to close. Read as if it had closed, Siren
    // would draw a picture for a document Mermaid draws nothing for, which
    // is the one direction the absolute compatibility condition does not
    // permit.
    expect(refusalsFor("erDiagram\n  E {\n    string a\n")).toEqual([
      'Unclosed erDiagram attribute block: "E {"',
    ]);
  });

  it("reads a bracketed quoted string after a name as that entity's alias", () => {
    // Measured (mermaid 11.17.2): `CUSTOMER["Customer Account"]` records
    // **one** entity, `label="CUSTOMER" alias="Customer Account"` — so the
    // alias sits *beside* the name rather than replacing it, and the name
    // stays what addresses the entity.
    expect(namesOf('erDiagram\n  CUSTOMER["Customer Account"]\n')).toEqual(["CUSTOMER"]);
    expect(aliasOf('erDiagram\n  CUSTOMER["Customer Account"]\n', "CUSTOMER")).toBe(
      "Customer Account",
    );

    // The control that says the field is genuinely read rather than always
    // filled: a bare name carries no alias at all.
    expect(aliasOf("erDiagram\n  CUSTOMER\n", "CUSTOMER")).toBeNull();
  });

  it("reads an alias on the line that opens an attribute block", () => {
    // Measured: `CUSTOMER["Customer Account"] {` with `string n` under it
    // reports one entity, `label="CUSTOMER" alias="Customer Account"`,
    // carrying that attribute — the two constructs compose, and the alias
    // does not cost the entity its table.
    const source = 'erDiagram\n  CUSTOMER["Customer Account"] {\n    string n\n  }\n';

    expect(namesOf(source)).toEqual(["CUSTOMER"]);
    expect(aliasOf(source, "CUSTOMER")).toBe("Customer Account");
    expect(attributesOf(source, "CUSTOMER")).toEqual([
      { type: "string", name: "n", keys: [], comment: "" },
    ]);
  });

  it("reads an alias in the whole alphabet Mermaid reads one in, and no wider", () => {
    // Measured: the alias is a quoted run of anything but a quote —
    // `A["a & b <c> d"]` reports `alias="a & b <c> d"`, so the characters a
    // renderer has to escape are ordinary text here.
    expect(aliasOf('erDiagram\n  A["a & b <c> d"]\n', "A")).toBe("a & b <c> d");

    // And `A [ "spaced" ]` is the same entity, because Mermaid's lexer skips
    // whitespace between tokens (measured: `alias="spaced"`).
    expect(aliasOf('erDiagram\n  A [ "spaced" ]\n', "A")).toBe("spaced");

    // The over-reach controls, both measured as **parse errors** in Mermaid.
    // An empty alias is one ("Expecting 'UNICODE_TEXT', ... got 'WORD'"), and
    // so is an alias with a relationship written after it — so a pattern that
    // admitted either would draw a picture for a document Mermaid draws
    // nothing for.
    expect(refusalsFor('erDiagram\n  A[""]\n')).toEqual(['Unrecognized erDiagram line: "A[""]"']);
    expect(refusalsFor('erDiagram\n  A["one"] ||--|| B : r\n')).toEqual([
      'Unrecognized erDiagram line: "A["one"] ||--|| B : r"',
    ]);

    // Mermaid's *bracketless* spelling is an alias too (measured:
    // `A[Unquoted]` reports `alias="Unquoted"`), and this parser does not
    // read it — so it is refused **by name**, not reported as malformed.
    expect(refusalsFor("erDiagram\n  A[Unquoted]\n")).toEqual([
      'Unimplemented erDiagram construct: an entity alias written without quotes, in "A[Unquoted]"',
    ]);
  });

  it("reads a document-level direction, in all four spellings, and defaults to TB", () => {
    // Measured (mermaid 11.17.2): `direction LR` reports `LR` where a
    // document naming none reports `TB`, so it genuinely governs the layout.
    // All four are written out literally in Mermaid's ER lexer.
    expect(directionOf("erDiagram\n  direction LR\n  A\n")).toBe("LR");
    expect(directionOf("erDiagram\n  direction RL\n  A\n")).toBe("RL");
    expect(directionOf("erDiagram\n  direction BT\n  A\n")).toBe("BT");
    expect(directionOf("erDiagram\n  direction TB\n  A\n")).toBe("TB");

    // The default, which is what makes the four above readings rather than a
    // constant: a document naming no direction reports `TB` (measured).
    expect(directionOf("erDiagram\n  A\n")).toBe("TB");

    // Case-insensitively, because Mermaid's lexer rules are all `/i`:
    // measured, `direction lr` reports `LR` too.
    expect(directionOf("erDiagram\n  direction lr\n  A\n")).toBe("LR");

    // And the statement is not an entity: the line declares a direction and
    // nothing else, so `A` is the only box.
    expect(namesOf("erDiagram\n  direction LR\n  A\n")).toEqual(["A"]);
  });

  it("lets the last direction statement win, wherever on the page it was written", () => {
    // ⚠️ Measured, not derived, because the two kinds already in this repo
    // disagree: `parseStateDiagram` is **first**-wins and
    // `parseClassDiagram` is last-wins. ER is the class diagram's answer —
    // `direction LR` then `direction RL` reports `RL`, and the reverse pair
    // reports `LR` (mermaid 11.17.2), because its `setDirection(dir)` is a
    // plain assignment. Both orders are asserted: a first-wins reader passes
    // one of them by luck.
    expect(directionOf("erDiagram\n  direction LR\n  direction RL\n  A\n")).toBe("RL");
    expect(directionOf("erDiagram\n  direction RL\n  direction LR\n  A\n")).toBe("LR");

    // And position on the page does not matter otherwise: measured, a
    // `direction` written *after* the first relationship governs just the
    // same.
    expect(directionOf("erDiagram\n  A ||--|| B : r\n  direction LR\n")).toBe("LR");
  });

  it("reads a direction only where Mermaid reads one", () => {
    // The over-reach control. Measured: `direction` on a line of its own is
    // an ordinary **entity** (Mermaid reports one entity called `direction`
    // and the document's direction still `TB`), so a pattern reaching for a
    // bare keyword would swallow a box Mermaid draws.
    expect(namesOf("erDiagram\n  direction\n")).toEqual(["direction"]);
    expect(directionOf("erDiagram\n  direction\n")).toBe("TB");

    // **`TD` is not a fifth spelling**, measured: Mermaid's ER lexer writes
    // the four out literally and the flowchart's alias never reaches this
    // grammar, so `direction TD` is *two entities*. Reading it as `TB` here
    // would turn two boxes into a directive — silently, since `TB` is also
    // the default and nothing in the picture would say a box went missing.
    // Siren does not draw the two-statements-on-one-line form either, so the
    // document is refused rather than half-read.
    expect(refusalsFor("erDiagram\n  direction TD\n  A\n")).toEqual([
      'Unrecognized erDiagram line: "direction TD"',
    ]);

    // And a `direction` written *inside* an attribute block is an
    // attribute, not a directive — measured, `E { direction LR }` reports
    // `type="direction" name="LR"` and the document's direction stays `TB`.
    // A reader that tried the statement patterns first would lose the row.
    const inBlock = "erDiagram\n  E {\n    direction LR\n  }\n";
    expect(attributesOf(inBlock, "E")).toEqual([
      { type: "direction", name: "LR", keys: [], comment: "" },
    ]);
    expect(directionOf(inBlock)).toBe("TB");
  });
});

describe("parseErDiagram reads the timeline block", () => {
  it("reads `timeline:` and its entries, ending the diagram body there", () => {
    // ADR-0002 keeps the animation block separate from the structural
    // definition, and `parseTimelineBlock` is the one grammar every kind
    // reads it with — so this parser's whole share of the construct is
    // *where the block starts*, and a fifth copy of the entry grammar would
    // be a fifth chance for a verb to drift.
    const document = documentOf(
      "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n\ntimeline:\n  step 1: enter ORDER fade\n",
    );

    expect(document.timeline).toEqual({
      entries: [
        { kind: "enter", step: 1, targetId: "ORDER", effect: "fade", line: 5, column: 3 },
      ],
    });
    // And the body above it is still read: opening the block must not cost
    // the diagram.
    expect(document.entities.map((entity) => entity.name)).toEqual(["CUSTOMER", "ORDER"]);
  });

  it("reports no timeline at all for a document that opens no block", () => {
    // `null` rather than an empty block, because the two are different
    // answers and `resolveTimeline` short-circuits on the first — which is
    // what keeps a document with no animation free of timeline diagnostics.
    expect(documentOf("erDiagram\n  CUSTOMER\n").timeline).toBeNull();
  });

  it("costs the whole document when a line inside the block is not a step entry", () => {
    // The rule every kind keeps: a diagnostic inside the block is an error
    // like any other, so nothing half-animated reaches the next stage.
    const { document, diagnostics } = parseErDiagram(
      "erDiagram\n  CUSTOMER\n\ntimeline:\n  nonsense\n",
    );

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual(['Unrecognized timeline line: "nonsense"']);
  });

  it("opens the timeline even while an attribute block is still open, and names the unclosed block", () => {
    // The ordering claim, and it is the difference between two diagnostics.
    // The in-block reader runs before every statement pattern because
    // `string name` is two words; `timeline:` is read *before* it anyway, so
    // an author who forgot a `}` is told about the brace they forgot rather
    // than about an "attribute" they never wrote.
    const { document, diagnostics } = parseErDiagram(
      "erDiagram\n  CUSTOMER {\n    string name\n\ntimeline:\n  step 1: enter CUSTOMER fade\n",
    );

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Unclosed erDiagram attribute block: "CUSTOMER {"',
    ]);
  });

  it("answers a document that opens with `timeline:` with the missing header, not with a timeline", () => {
    // Before the header there is no diagram to animate, so the header
    // diagnostic is the one that names the problem. A timeline check running
    // first would drain the rest of the file and then report an empty
    // document, pointing at line 1 for a fault on line 1 with the wrong
    // reason.
    const { document, diagnostics } = parseErDiagram("timeline:\n  step 1: enter A fade\n");

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Expected "erDiagram", found "timeline:"',
    ]);
  });

  it("leaves an entity the author simply called `timeline` alone", () => {
    // The over-reach control. Measured (mermaid 11.17.2): `timeline` is an
    // ordinary ER name — `erDiagram / timeline / timeline ||--o{ ORDER : x`
    // reports an entity called `timeline` and a relationship from it. The
    // block is opened by `timeline:` and by nothing else (the shared
    // `TIMELINE_HEADER_RE` is anchored on the whole line, colon included),
    // so a reader matching the bare word would swallow a box Mermaid draws
    // **and** silently eat the rest of the document with it.
    const document = documentOf("erDiagram\n  timeline\n  timeline ||--o{ ORDER : x\n");

    expect(document.entities.map((entity) => entity.name)).toEqual([
      "timeline",
      "timeline",
      "ORDER",
    ]);
    expect(document.relationships.map((r) => `${r.left}-${r.right}`)).toEqual([
      "timeline-ORDER",
    ]);
    expect(document.timeline).toBeNull();
  });
});
