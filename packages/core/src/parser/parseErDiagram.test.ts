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

/** The relationships the parser read, whole, in source order. */
const relationshipsOf = (source: string) => documentOf(source).relationships;

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

  it("runs several statements on one line, in the order they are written", () => {
    // Measured (mermaid 11.17.2): `CUSTOMER ORDER LINE-ITEM` reports
    // **three** entities. Mermaid's ER grammar is `statements: statement |
    // statements statement` with no separator of its own, so a line is a
    // *stream* and not a statement — which is what a whole-line anchor got
    // wrong, refusing an ordinary document outright.
    expect(namesOf("erDiagram\n  CUSTOMER ORDER LINE-ITEM\n")).toEqual([
      "CUSTOMER",
      "ORDER",
      "LINE-ITEM",
    ]);

    // Names and relationships mix freely in that stream, both ways round —
    // measured: `A B ||--o{ C : x` reports three entities with the
    // relationship between **B** and C, and `A ||--o{ B : x C ||--o{ D : y`
    // reports two relationships.
    expect(namesOf("erDiagram\n  A B ||--o{ C : x\n")).toEqual(["A", "B", "C"]);
    expect(relationshipsOf("erDiagram\n  A B ||--o{ C : x\n").map((r) => `${r.left}->${r.right}`)).toEqual([
      "B->C",
    ]);
    expect(
      relationshipsOf("erDiagram\n  A ||--o{ B : x C ||--o{ D : y\n").map(
        (r) => `${r.left}->${r.right}`,
      ),
    ).toEqual(["A->B", "C->D"]);

    // And a quoted name takes part like any other.
    expect(namesOf('erDiagram\n  "A B" C\n')).toEqual(["A B", "C"]);
  });

  it("refuses a line whose statement stream would read an ER keyword as a box", () => {
    // ⚠️ **The guard a line-as-a-stream reader cannot do without.** Every one
    // of these words is spelled by the ordinary name alphabet, so without it
    // `subgraph sales` / `end` came back as boxes called `subgraph`, `sales`
    // and `end` — three figures Mermaid draws no box for — in place of the
    // cluster it does draw. Silently, which is the one outcome worse than a
    // refusal.
    //
    // Measured one probe per word (11.17.2): `end`, `subgraph`, `class`,
    // `style` and `classDef` are each a parse error on a line of their own,
    // and `A end B`, `A subgraph B` and `A style B` are parse errors too.
    for (const word of ["end", "subgraph", "class", "style", "classDef"]) {
      expect(refusalsFor(`erDiagram\n  A ${word} B\n`)).toEqual([
        `Unrecognized erDiagram line: "A ${word} B"`,
      ]);
    }

    // Case-insensitively, measured: `STYLE`, `Style`, `End`, `SubGraph` and
    // `classdef` all refuse the same way.
    expect(refusalsFor("erDiagram\n  A SubGraph B\n")).toHaveLength(1);
    expect(refusalsFor("erDiagram\n  A Style B\n")).toHaveLength(1);

    // At a relationship's endpoints and in its label too — measured,
    // `A ||--o{ end : x`, `style ||--o{ B : x` and `A ||--o{ B : end` are
    // each refused, the last two as *lexical* errors.
    expect(refusalsFor("erDiagram\n  A ||--o{ end : x\n")).toHaveLength(1);
    expect(refusalsFor("erDiagram\n  style ||--o{ B : x\n")).toHaveLength(1);
    expect(refusalsFor("erDiagram\n  A ||--o{ B : end\n")).toHaveLength(1);

    // ⚠️ **`title` is not one of them**, and that is measured rather than
    // assumed from the grammar's terminal list: `title My Diagram` reports
    // **three entities** and `A title B` three as well, so the ER lexer
    // never emits the token. Refusing it would cost three boxes Mermaid
    // draws.
    expect(namesOf("erDiagram\n  title My Diagram\n  A\n")).toEqual([
      "title",
      "My",
      "Diagram",
      "A",
    ]);

    // Quoted, a reserved word is an ordinary name again — quoting takes
    // anything (measured).
    expect(namesOf('erDiagram\n  A "end" B\n')).toEqual(["A", "end", "B"]);
  });

  it("reads a two-word relationship label as one word plus a third entity", () => {
    // ⚠️ Measured, and the reason the label is one token: `A ||--o{ B : two
    // words` reports the role as **`two`** and then declares a **third
    // entity** called `words`. Reading the tail as the label would draw a
    // label Mermaid never draws and lose a box it does.
    const source = "erDiagram\n  A ||--o{ B : two words\n";

    expect(namesOf(source)).toEqual(["A", "B", "words"]);
    expect(relationshipsOf(source).map((r) => r.label)).toEqual(["two"]);

    // The control: quoted, it really is one label with a space in it and no
    // third box (measured).
    const quoted = 'erDiagram\n  A ||--o{ B : "two words"\n';
    expect(namesOf(quoted)).toEqual(["A", "B"]);
    expect(relationshipsOf(quoted).map((r) => r.label)).toEqual(["two words"]);
  });

  it("reads `direction TD` as two entities, because this grammar has no TD", () => {
    // ⚠️ Measured: the ER lexer writes `TB`/`BT`/`RL`/`LR` out literally and
    // the flowchart's `TD` alias never reaches it, so `direction TD` is two
    // ordinary entities and the diagram still runs top-to-bottom by default.
    // This is the same construct as the row above, not a direction feature:
    // the line is simply two names.
    const source = "erDiagram\n  direction TD\n";

    expect(namesOf(source)).toEqual(["direction", "TD"]);
    expect(directionOf(source)).toBe("TB");

    // And with something in front of it: `XX direction TD` is **three**
    // entities (measured), because no direction rule matches the line at
    // all.
    expect(namesOf("erDiagram\n  XX direction TD\n")).toEqual(["XX", "direction", "TD"]);
  });

  it("lets a direction statement swallow its whole line, which is what Mermaid's rule does", () => {
    // ⚠️ Measured, and not derivable from anything else here: Mermaid's rule
    // is the **greedy** `/^(?:.*direction\s+LR[^\n]*)/i`, so it matches from
    // the start of the line whenever `direction` and one of the four values
    // appear anywhere in it, and swallows everything on either side.
    //
    // - `XX direction LR` sets `LR` and declares **no** entity.
    // - `direction LRX` sets `LR` — the trailing `[^\n]*` takes the `X`.
    // - `A ||--o{ B : x direction LR` sets `LR` and reports **no entities
    //   and no relationship at all**.
    expect(namesOf("erDiagram\n  XX direction LR\n")).toEqual([]);
    expect(directionOf("erDiagram\n  XX direction LR\n")).toBe("LR");

    expect(namesOf("erDiagram\n  direction LRX\n")).toEqual([]);
    expect(directionOf("erDiagram\n  direction LRX\n")).toBe("LR");

    const swallowed = "erDiagram\n  A ||--o{ B : x direction LR\n";
    expect(namesOf(swallowed)).toEqual([]);
    expect(relationshipsOf(swallowed)).toEqual([]);
    expect(directionOf(swallowed)).toBe("LR");
  });

  it("breaks a tie between two directions on one line by Mermaid's own rule order", () => {
    // Four lexer rules, one per value, and jison breaks a tie between two
    // equally long matches by rule order — `direction_tb`, `direction_bt`,
    // `direction_rl`, `direction_lr`, read straight out of its symbol table.
    // Measured, one probe per pair, and it is **not** "the last one wins":
    expect(directionOf("erDiagram\n  direction LR direction TB\n")).toBe("TB");
    expect(directionOf("erDiagram\n  direction TB direction LR\n")).toBe("TB");
    expect(directionOf("erDiagram\n  direction RL direction BT\n")).toBe("BT");
    expect(directionOf("erDiagram\n  direction LR direction RL\n")).toBe("RL");
  });

  it("reads accTitle and accDescr, and neither declares an entity", () => {
    // Measured (mermaid 11.17.2, `scripts/mermaid-probe.mjs`):
    //
    //     erDiagram
    //       accTitle: Order book
    //       accDescr: how orders relate to customers
    //       CUSTOMER ||--o{ ORDER : places
    //
    // reports exactly two entities, `CUSTOMER` and `ORDER` — so neither
    // statement puts a box on the canvas — while the rendered root carries
    // `aria-labelledby`/`aria-describedby` pointing at a `<title>` and a
    // `<desc>` holding those two strings.
    const document = documentOf(
      "erDiagram\n  accTitle: Order book\n  accDescr: how orders relate to customers\n  CUSTOMER ||--o{ ORDER : places\n",
    );
    expect(document.accTitle).toBe("Order book");
    expect(document.accDescr).toBe("how orders relate to customers");
    expect(document.entities.map((entity) => entity.name)).toEqual(["CUSTOMER", "ORDER"]);
  });

  it("leaves both null when the document writes neither", () => {
    // `null` rather than `""`, the way `FlowchartDocument` spells it: the
    // renderer draws no `<title>` at all for a document that named none,
    // which an empty string could not be told apart from.
    const document = documentOf("erDiagram\n  CUSTOMER\n");
    expect(document.accTitle).toBeNull();
    expect(document.accDescr).toBeNull();
  });
});

/** The messages the parser reported for `source`. */
const refusalsFor = (source: string): string[] =>
  parseErDiagram(source).diagnostics.map((d) => d.message);

describe("parseErDiagram refuses an unimplemented construct by name", () => {
  it("names the multi-line accDescr block rather than reading an entity out of it", () => {
    // Measured (mermaid 11.17.2): `accDescr {` / `a long description` / `}`
    // written beside `CUSTOMER` reports **one** entity, `CUSTOMER` — the
    // block is the description's own multi-line spelling and puts no box on
    // the canvas.
    //
    // ⚠️ `ENTITY_HEAD_RE` matches that opening line exactly as it matches
    // `CUSTOMER {`, so without a guard read *before* it this parser would
    // draw a box called `accDescr` for a document Mermaid draws no box for —
    // a silently wrong picture rather than a refusal.
    //
    // The control below is the boundary: `accTitle {` has no such rule.
    // Measured, `accTitle {` / `x` / `}` is a **parse error** in Mermaid
    // ("Expecting 'ATTRIBUTE_WORD'"), which is an entity called `accTitle`
    // opening a block with a malformed attribute in it — the reading this
    // parser already gives it, so it must stay untouched.
    expect(
      refusalsFor("erDiagram\n  accDescr {\n    a long description\n  }\n  CUSTOMER\n"),
    ).toEqual([
      'Unimplemented erDiagram construct: the multi-line `accDescr { ... }` description, in "accDescr {"',
    ]);

    // **The body that made this a silently wrong picture rather than a
    // missing one.** Measured: `accDescr {` / `string x` / `}` beside
    // `CUSTOMER` reports **one** entity in Mermaid. `string x` is a
    // well-formed attribute, so without the guard this parser read the
    // block as an entity's and drew two boxes — `CUSTOMER`, and an
    // `accDescr` carrying a `string x` row — saying nothing. One
    // diagnostic, and no second box.
    expect(refusalsFor("erDiagram\n  accDescr {\n    string x\n  }\n  CUSTOMER\n")).toEqual([
      'Unimplemented erDiagram construct: the multi-line `accDescr { ... }` description, in "accDescr {"',
    ]);

    // The boundary: `accTitle {` has no such rule in Mermaid, so it stays
    // an ordinary entity opening an ordinary attribute block here.
    expect(namesOf("erDiagram\n  accTitle {\n    string x\n  }\n")).toEqual(["accTitle"]);
  });

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

  it("reads a brace as a mode switch rather than a line ending, so a block may open and close on one line", () => {
    // ⚠️ **The one-line block is not a second construct.** Measured
    // (mermaid 11.17.2, `scripts/mermaid-probe.mjs`), `E { string a }` and
    // the three-line spelling report the *same* record — one entity `E`
    // carrying `type="string" name="a"`. Read out of Mermaid's lexer, the
    // reason is that a newline is insignificant on both sides of the brace:
    // `{` switches into the block condition, `}` pops straight back out
    // (rule 31, `popState(); return 18`), and the statement stream carries
    // on from wherever that leaves it. So the brace is a mode switch and
    // the line ending means nothing to it.
    const oneLine = "erDiagram\n  E { string a }\n";
    const threeLine = "erDiagram\n  E {\n    string a\n  }\n";

    expect(refusalsFor(oneLine)).toEqual([]);
    expect(namesOf(oneLine)).toEqual(namesOf(threeLine));
    expect(attributesOf(oneLine, "E")).toEqual(attributesOf(threeLine, "E"));
    expect(attributesOf(oneLine, "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);

    // Spaces around the braces are the lexer's to skip, so the tight
    // spelling is the same document — measured, `E {string a}` reports the
    // same one attribute.
    expect(attributesOf("erDiagram\n  E {string a}\n", "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);

    // An **empty** block is an entity with no attributes rather than a
    // refusal — measured, both `E {}` and `E { }` report `E` with none.
    for (const line of ["E {}", "E { }"]) {
      expect(refusalsFor(`erDiagram\n  ${line}\n`), `for "${line}"`).toEqual([]);
      expect(namesOf(`erDiagram\n  ${line}\n`), `for "${line}"`).toEqual(["E"]);
      expect(attributesOf(`erDiagram\n  ${line}\n`, "E"), `for "${line}"`).toEqual([]);
    }
  });

  it("carries the statement stream through a block's braces, in both directions", () => {
    // The consequence of the brace being a mode switch: everything
    // `01M3978B7` measured about a line being a *stream* of statements
    // still holds on either side of one. Measured, one probe per line.

    // A block closes and the stream resumes: `E { string a } F` is two
    // entities, and only `E` carries the attribute.
    const afterClose = "erDiagram\n  E { string a } F\n";
    expect(refusalsFor(afterClose)).toEqual([]);
    expect(namesOf(afterClose)).toEqual(["E", "F"]);
    expect(attributesOf(afterClose, "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);
    expect(attributesOf(afterClose, "F")).toEqual([]);

    // A block opens on an entity that was not the first on its line —
    // measured, `A B { string a }` puts the attribute on **`B`**, which is
    // the same rule the multi-line spelling already followed.
    const secondOnLine = "erDiagram\n  A B { string a }\n";
    expect(namesOf(secondOnLine)).toEqual(["A", "B"]);
    expect(attributesOf(secondOnLine, "A")).toEqual([]);
    expect(attributesOf(secondOnLine, "B")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);

    // Two blocks on one line, each keeping its own attributes.
    const twoBlocks = "erDiagram\n  E { string a } F { string b }\n";
    expect(namesOf(twoBlocks)).toEqual(["E", "F"]);
    expect(attributesOf(twoBlocks, "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);
    expect(attributesOf(twoBlocks, "F")).toEqual([
      { type: "string", name: "b", keys: [], comment: "" },
    ]);

    // And a relationship on either side of a block, measured both ways
    // round: `E { string a } A ||--o{ B : x` and
    // `A ||--o{ B : x C { string d }` each report the relationship *and*
    // the block's attribute.
    const blockThenRelationship = "erDiagram\n  E { string a } A ||--o{ B : x\n";
    expect(refusalsFor(blockThenRelationship)).toEqual([]);
    expect(namesOf(blockThenRelationship)).toEqual(["E", "A", "B"]);
    expect(relationshipsOf(blockThenRelationship)).toEqual([
      {
        left: "A",
        leftCardinality: "onlyOne",
        line: "identifying",
        rightCardinality: "zeroOrMore",
        right: "B",
        label: "x",
      },
    ]);
    expect(attributesOf(blockThenRelationship, "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);

    const relationshipThenBlock = "erDiagram\n  A ||--o{ B : x C { string d }\n";
    expect(refusalsFor(relationshipThenBlock)).toEqual([]);
    expect(namesOf(relationshipThenBlock)).toEqual(["A", "B", "C"]);
    expect(attributesOf(relationshipThenBlock, "C")).toEqual([
      { type: "string", name: "d", keys: [], comment: "" },
    ]);

    // The brace is insignificant in the *other* direction too, and this is
    // the half a "one-line block" reading alone would miss: a block may
    // open mid-line and close two lines later, or open on its own line and
    // close mid-line with statements after it. Measured, both of these
    // report the same two entities and the same attributes.
    const opensMidLine = "erDiagram\n  E { string a\n    int b\n  }\n  F\n";
    expect(refusalsFor(opensMidLine)).toEqual([]);
    expect(namesOf(opensMidLine)).toEqual(["E", "F"]);
    expect(attributesOf(opensMidLine, "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
      { type: "int", name: "b", keys: [], comment: "" },
    ]);

    const closesMidLine = "erDiagram\n  E {\n    string a } F\n";
    expect(refusalsFor(closesMidLine)).toEqual([]);
    expect(namesOf(closesMidLine)).toEqual(["E", "F"]);
    expect(attributesOf(closesMidLine, "E")).toEqual([
      { type: "string", name: "a", keys: [], comment: "" },
    ]);
    expect(attributesOf(closesMidLine, "F")).toEqual([]);
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

  it("reads a `~`-delimited generic type as one word, tildes and all", () => {
    // Measured (mermaid 11.17.2, `scripts/mermaid-probe.mjs`), one probe per
    // claim. Mermaid's in-block generic rule is `([^\s]*)[~].*[~]([^\s]*)`,
    // read *before* the word rule, and its action returns the **whole match**
    // as one `ATTRIBUTE_WORD`: `list~int~ codes` comes back
    // `type="list~int~" name="codes"`. The delimiters are kept, so there is
    // no inner structure to model and nothing to re-spell — a class
    // diagram's generic is rewritten into angle brackets, and this one is
    // not.
    const source =
      "erDiagram\n  E {\n    list~int~ codes\n    map~string,list~int~~ index\n" +
      "    x list~int~\n    list~a b~ spaced\n    ~x~ headless\n  }\n";

    expect(refusalsFor(source)).toEqual([]);
    expect(attributesOf(source, "E")).toEqual([
      // Nested, and still one token: `.*` is greedy, so it runs to the last
      // `~` rather than to the first — measured, `map~string,list~int~~`
      // comes back entire, not truncated at `list~int~`.
      { type: "list~int~", name: "codes", keys: [], comment: "" },
      { type: "map~string,list~int~~", name: "index", keys: [], comment: "" },
      // The rule is not the type's: measured, `x list~int~` reports
      // `type="x" name="list~int~"`, so a generic is a *word* wherever a
      // word may stand.
      { type: "x", name: "list~int~", keys: [], comment: "" },
      // ⚠️ A space goes **inside** the delimiters, unlike every other word
      // in this block: `.*` is not `[^\s]*`. Measured, `list~a b~ spaced`
      // is one type and one name, not three words.
      { type: "list~a b~", name: "spaced", keys: [], comment: "" },
      // And the leading group may be empty — `~x~ headless` reports
      // `type="~x~"`.
      { type: "~x~", name: "headless", keys: [], comment: "" },
    ]);

    // ⚠️ **Greedy to the last tilde on the line**, which is the measurement
    // a reader would most likely get wrong by stopping at the second `~`:
    // `list~int~ x~y~ z` is **one** attribute whose type spans the space,
    // not two attributes. Read non-greedily it would be `list~int~ x` plus
    // `y~ z`, which is a different picture.
    expect(attributesOf("erDiagram\n  E {\n    list~int~ x~y~ z\n  }\n", "E")).toEqual([
      { type: "list~int~ x~y~", name: "z", keys: [], comment: "" },
    ]);
    // The control that keeps that greed honest: with no second pair on the
    // line, `list~int~ a string b` is two ordinary attributes.
    expect(attributesOf("erDiagram\n  E {\n    list~int~ a string b\n  }\n", "E")).toEqual([
      { type: "list~int~", name: "a", keys: [], comment: "" },
      { type: "string", name: "b", keys: [], comment: "" },
    ]);

    // A generic takes keys and a comment like any other type — measured,
    // `list~int~ codes PK "c"` reports all four fields.
    expect(attributesOf('erDiagram\n  E {\n    list~int~ codes PK "c"\n  }\n', "E")).toEqual([
      { type: "list~int~", name: "codes", keys: ["PK"], comment: "c" },
    ]);
  });

  it("refuses the tilde spellings Mermaid refuses, rather than half-reading them", () => {
    // Measured, one probe per line, and both refusals fall out of *where*
    // the generic rule sits rather than out of a guard written for them:
    //
    // - `list~int xs` — a lone `~` reaches no rule at all ("Expecting
    //   'ATTRIBUTE_WORD', '?', got '~'"), because the generic rule needs its
    //   closing tilde and the word alphabet has no `~` in it.
    // - `string x "a~b~"` — a parse error too, and the interesting one: the
    //   generic rule is read **before** the comment rule, so it swallows the
    //   quoted string whole and leaves a third bare word where the grammar
    //   wanted an attribute. A reader that put its comment rule first would
    //   accept this and draw a comment Mermaid draws no picture for at all.
    for (const body of ["list~int xs", 'string x "a~b~"']) {
      expect(refusalsFor(`erDiagram\n  E {\n    ${body}\n  }\n`), `for "${body}"`).toEqual([
        `Unrecognized erDiagram attribute: "${body}"`,
      ]);
    }

    // The negative control for that ordering: a tilde that is *not* closed
    // inside the quotes leaves the comment rule its own. Measured,
    // `string x "has ~ tilde"` and `string x "a~b"` are both ordinary
    // attributes with ordinary comments.
    expect(
      attributesOf('erDiagram\n  E {\n    string x "has ~ tilde"\n    string y "a~b"\n  }\n', "E"),
    ).toEqual([
      { type: "string", name: "x", keys: [], comment: "has ~ tilde" },
      { type: "string", name: "y", keys: [], comment: "a~b" },
    ]);
  });

  it("reads a backticked word with its backticks stripped, whatever is between them", () => {
    // Measured (mermaid 11.17.2), one probe per claim, and the mechanism is
    // read out of Mermaid's own lexer: a backtick inside a block enters the
    // `block_bq` condition and emits **no token**, the run of non-backticks
    // after it emits one `ATTRIBUTE_WORD`, and the closing backtick pops the
    // state and emits no token either. So the quotes are delimiters that
    // vanish — `string `odd name`` comes back `type="string" name="odd
    // name"` — the **opposite** of the generic above, whose tildes are part
    // of the word.
    const source =
      "erDiagram\n  E {\n    string `odd name`\n    `odd type` x\n" +
      '    string `a:b{}~"c`\n    string `PK`\n  }\n';

    expect(refusalsFor(source)).toEqual([]);
    expect(attributesOf(source, "E")).toEqual([
      { type: "string", name: "odd name", keys: [], comment: "" },
      // Either position, measured: a backticked word is a word.
      { type: "odd type", name: "x", keys: [], comment: "" },
      // ⚠️ **This is what backticks are for.** Every one of these
      // characters is refused by the block's word alphabet
      // (`[*A-Za-z_À-￿][A-Za-z0-9\-_\[\]().,À-￿*]*`) — a colon, braces, a
      // tilde and a double quote — and measured, all four go straight
      // through: `string `a:b{}~"c`` reports `name="a:b{}~\"c"`. Note the
      // brace in particular: it does **not** close the attribute block from
      // inside the quotes.
      { type: "string", name: 'a:b{}~"c', keys: [], comment: "" },
      // And a key word quoted is ordinary text, because the key rule never
      // gets to look: the backtick rule has already switched conditions.
      // Measured, `string `PK`` reports `name="PK"` with **no** key at all,
      // where a bare `string PK` is a parse error.
      { type: "string", name: "PK", keys: [], comment: "" },
    ]);

    // Keys and a comment still follow a backticked name — measured,
    // `string `x` PK "c"` reports all four fields.
    expect(attributesOf('erDiagram\n  E {\n    string `x` PK "c"\n  }\n', "E")).toEqual([
      { type: "string", name: "x", keys: ["PK"], comment: "c" },
    ]);

    // The consequence of the delimiters being token-less rather than part
    // of the word: two backticked runs may touch. Measured, `` `a``b` `` is
    // one attribute — type `a`, name `b` — and not one word called `a``b`.
    expect(attributesOf("erDiagram\n  E {\n    `a``b`\n  }\n", "E")).toEqual([
      { type: "a", name: "b", keys: [], comment: "" },
    ]);

    // And the ordering control between the two constructs this ticket
    // added: Mermaid reads its generic rule **before** its backtick rule,
    // so measured, ``list~`a`~ x`` is one type `list~`a`~` with the
    // backticks intact inside it — not a backticked word. Read the other
    // way round it would be three words and a refusal.
    expect(attributesOf("erDiagram\n  E {\n    list~`a`~ x\n  }\n", "E")).toEqual([
      { type: "list~`a`~", name: "x", keys: [], comment: "" },
    ]);
  });

  it("refuses the backtick spellings Mermaid refuses, rather than half-reading them", () => {
    // Measured, one probe per line:
    //
    // - ``string ` ` `` with nothing between the backticks emits no word at
    //   all, so the grammar is left wanting one ("Expecting
    //   'ATTRIBUTE_WORD', '?', got 'BLOCK_STOP'"). An empty name is not an
    //   attribute.
    // - ``string `a`b`` and ``string a`b` `` are parse errors for a
    //   different reason, and the one this parser gets for free: the
    //   delimiters vanish, so each line is **three** words where an
    //   attribute is two, and the third is a type with no name after it.
    for (const body of ["string ``", "string `a`b", "string a`b`"]) {
      expect(refusalsFor(`erDiagram\n  E {\n    ${body}\n  }\n`), `for "${body}"`).toEqual([
        `Unrecognized erDiagram attribute: "${body}"`,
      ]);
    }

    // An opening backtick with no closing one on the line. ⚠️ **This is a
    // divergence, and a deliberate one**: Mermaid's `block_bq` rule is
    // `` [^`]+ ``, which matches a newline, so measured, `string `a` on one
    // line and ``b` `` on the next is **one** attribute named `a\n    b` —
    // a name with a line break and the source's indentation inside it.
    // This parser reads a line at a time and refuses both halves, which
    // costs the document and says so; drawing a single-line cell for a
    // two-line name would be the silent kind of wrong. Unterminated
    // altogether — no second backtick anywhere — is a parse error in
    // Mermaid too, so that half agrees.
    expect(refusalsFor("erDiagram\n  E {\n    string `a\n    b`\n  }\n")).toEqual([
      'Unrecognized erDiagram attribute: "string `a"',
      'Unrecognized erDiagram attribute: "b`"',
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

  it("reads a quoted entity name as the entity's name, quotes stripped and no alias", () => {
    // Measured (mermaid 11.17.2):
    //
    //     "Customer Account" ||--o{ ORDER : places
    //
    // reports an entity **keyed on** `Customer Account` —
    // `label="Customer Account"` with **no `alias` field at all** — and the
    // relationship names it the same way. So the quotes are how an ER name
    // gets a character its bare alphabet has no room for, and what they
    // change is the *id*.
    const source = 'erDiagram\n  "Customer Account" ||--o{ ORDER : places\n';

    expect(namesOf(source)).toEqual(["Customer Account", "ORDER"]);
    expect(aliasOf(source, "Customer Account")).toBeNull();
    expect(relationshipsOf(source)).toEqual([
      {
        left: "Customer Account",
        leftCardinality: "onlyOne",
        line: "identifying",
        rightCardinality: "zeroOrMore",
        right: "ORDER",
        label: "places",
      },
    ]);

    // A quoted name on a line of its own is an entity too (measured), and
    // one on the **right** of a relationship as well.
    expect(namesOf('erDiagram\n  "Customer Account"\n')).toEqual(["Customer Account"]);
    expect(namesOf('erDiagram\n  A ||--o{ "Order Line" : has\n')).toEqual(["A", "Order Line"]);
  });

  it("parts the quoted name from the alias — one moves the id, the other the drawn text", () => {
    // ⚠️ **The two constructs that look identical on screen.** Measured,
    // side by side:
    //
    //     CUSTOMER["Customer Account"]   label="CUSTOMER" alias="Customer Account"
    //     "Customer Account"             label="Customer Account", no alias
    //
    // Both draw a box reading "Customer Account". Only the id tells them
    // apart, and the id is what a `timeline:` entry addresses (ADR-0009), so
    // reading one as the other moves every animation target in the document.
    expect(namesOf('erDiagram\n  CUSTOMER["Customer Account"]\n')).toEqual(["CUSTOMER"]);
    expect(aliasOf('erDiagram\n  CUSTOMER["Customer Account"]\n', "CUSTOMER")).toBe(
      "Customer Account",
    );

    expect(namesOf('erDiagram\n  "Customer Account"\n')).toEqual(["Customer Account"]);
    expect(aliasOf('erDiagram\n  "Customer Account"\n', "Customer Account")).toBeNull();

    // And they **compose**: measured, `"A B" ["alias"]` reports
    // `label="A B" alias="alias"`, so a quoted name may still take one.
    expect(namesOf('erDiagram\n  "A B" ["alias"]\n')).toEqual(["A B"]);
    expect(aliasOf('erDiagram\n  "A B" ["alias"]\n', "A B")).toBe("alias");
  });

  it("reads a quoted name in the whole alphabet Mermaid reads one in, and no wider", () => {
    // **Anything but a quote**, which is the measurement that ended
    // `01M3977716`'s separator argument: `"CUSTOMER:ORDER"` and
    // `"subgraph:1"` both parse and are keyed on exactly those strings, so
    // no character is reserved to keep authored ids and generated ones
    // apart in this kind.
    expect(namesOf('erDiagram\n  "CUSTOMER:ORDER" ||--|| X : y\n')).toEqual([
      "CUSTOMER:ORDER",
      "X",
    ]);
    expect(namesOf('erDiagram\n  "subgraph:1" ||--|| B : y\n')).toEqual(["subgraph:1", "B"]);

    // Whitespace inside the quotes is **kept**, not trimmed — measured, the
    // entity is keyed on `"  padded  "` with both runs of spaces intact. A
    // trim here would key two different Mermaid entities on one id.
    expect(namesOf('erDiagram\n  "  padded  "\n')).toEqual(["  padded  "]);

    // `--` is a whole entity once it is quoted (measured), where a bare
    // `--` is a parse error — so the relationship-body guard must not reach
    // inside the quotes.
    expect(namesOf('erDiagram\n  "--"\n')).toEqual(["--"]);

    // The over-reach control, measured as a **parse error** in Mermaid
    // ("Expecting ... got 'WORD'"): an empty quoted name is not a name, so
    // the pattern is `[^"]+` and never `[^"]*`.
    expect(refusalsFor('erDiagram\n  ""\n')).toEqual(['Unrecognized erDiagram line: """"']);
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
    expect(refusalsFor("erDiagram\n  direction TD\n  A\n")).toEqual([]);
    expect(namesOf("erDiagram\n  direction TD\n  A\n")).toEqual(["direction", "TD", "A"]);

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

/** The styling statements the parser read, in source order. */
const stylesOf = (source: string) => documentOf(source).styles;

describe("parseErDiagram reads the author's styling statements", () => {
  it("reads `style <entity> <declarations>` as one declaration per comma-separated pair", () => {
    // Measured (mermaid 11.17.2): `style ORDER fill:#f96,stroke:#333` leaves
    // `ORDER` carrying `cssStyles=["fill:#f96","stroke:#333"]` while its
    // `cssClasses` stays `"default"` — so the declarations hang off the
    // entity itself and the comma splits the list and nothing else.
    // `--markup` confirms the picture: the entity's own
    // `rect.basic.label-container` gains
    // `style="fill:#f96 !important;stroke:#333 !important"`.
    expect(
      stylesOf("erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  style ORDER fill:#f96,stroke:#333\n"),
    ).toEqual([
      {
        styleKind: "style",
        authoredAs: "style",
        targetIds: ["ORDER"],
        name: null,
        properties: [
          { property: "fill", value: "#f96" },
          { property: "stroke", value: "#333" },
        ],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("lets a `style` swallow the rest of its line, and declares no entity for the target it names", () => {
    // Measured (mermaid 11.17.2), one probe per claim. `style\b` calls
    // `this.begin("style")` and the only rule that leaves that condition is
    // `[\n]+`, so the declaration list runs to the newline:
    //
    //   A style B fill:#f96 C   → one entity, `A`. No `C`.
    //   A style B fill:#f96     → one entity, `A`. No `B` either.
    //
    // Both halves matter and they fail differently. Returning to the
    // statement stream after the declarations draws a box for `C` that
    // Mermaid draws none for; treating a target as a declaration draws one
    // for `B`. Each would be silent.
    expect(namesOf("erDiagram\n  A style B fill:#f96 C\n")).toEqual(["A"]);
    expect(namesOf("erDiagram\n  A style B fill:#f96\n")).toEqual(["A"]);

    // And the statement is still read, mid-line, with the entity before it
    // intact — so this is one statement stream and not a line class.
    expect(
      stylesOf("erDiagram\n  A style B fill:#f96 C\n").map((s) => [s.targetIds, s.properties]),
    ).toEqual([[["B"], [{ property: "fill", value: "#f96 C" }]]]);
  });

  it("keeps `style` a reserved word everywhere a name belongs, so `er-subgraph` stays a refusal", () => {
    // ⚠️ The regression guard. `style`, `class` and `classDef` becoming
    // statement openers must not make them ordinary names: measured
    // (mermaid 11.17.2), `A ||--o{ style : x` is a parse error ("got
    // 'STYLE'"), `erDiagram / style` alone is one, and so is `A style B`
    // with no declarations after it. A **quoted** `"style"` is an ordinary
    // entity and still is.
    expect(refusalsFor("erDiagram\n  A ||--o{ style : x\n")).toEqual([
      'Unrecognized erDiagram line: "A ||--o{ style : x"',
    ]);
    expect(refusalsFor("erDiagram\n  style\n")).toEqual([
      'Unrecognized erDiagram line: "style"',
    ]);
    expect(refusalsFor("erDiagram\n  A style B\n")).toEqual([
      'Unrecognized erDiagram line: "A style B"',
    ]);
    expect(namesOf('erDiagram\n  "style" ||--o{ B : x\n')).toEqual(["style", "B"]);

    // And the row this guard was found by: `subgraph` and `end` are spelled
    // by the name alphabet, and a statement stream that read them as names
    // drew three boxes Mermaid draws none for.
    expect(
      refusalsFor(
        "erDiagram\n  subgraph sales\n    direction LR\n    CUSTOMER ||--o{ ORDER : places\n  end\n  WAREHOUSE\n",
      ),
    ).toEqual([
      'Unrecognized erDiagram line: "subgraph sales"',
      'Unrecognized erDiagram line: "end"',
    ]);
  });

  it("reads `classDef` as a definition that targets nothing and `class` as the directive applying it", () => {
    // Measured (mermaid 11.17.2), and **both halves land**: `getClasses()`
    // answers with `urgent -> {id:"urgent", styles:["fill:#f96",
    // "stroke:#333"], textStyles:[]}`, and the entity's `cssClasses`
    // becomes `"default urgent"`. `--markup` shows the definition reaching
    // the entity's own `rect.basic.label-container`.
    expect(
      stylesOf(
        "erDiagram\n  classDef urgent fill:#f96,stroke:#333\n" +
          "  CUSTOMER ||--o{ ORDER : places\n  class ORDER urgent\n",
      ),
    ).toEqual([
      {
        styleKind: "classDef",
        authoredAs: "classDef",
        targetIds: [],
        name: "urgent",
        properties: [
          { property: "fill", value: "#f96" },
          { property: "stroke", value: "#333" },
        ],
        line: 2,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: "class",
        targetIds: ["ORDER"],
        name: "urgent",
        properties: [],
        line: 4,
        column: 3,
      },
    ]);
  });

  it("splits a `class` statement's comma in **both** halves, where a state diagram splits only one", () => {
    // ⚠️ The measurement that could not be carried across. `01M368GZR`
    // measured a state diagram's `class Busy alpha,beta` as **one** class
    // literally named `alpha,beta`, matching no definition and painting
    // nothing — its grammar reads that operand as a bare `\w+`. ER's rule is
    // `CLASS idList idList`, and measured (mermaid 11.17.2) both halves
    // really do split:
    //
    //   class A,B urgent      → both entities report cssClasses "default urgent"
    //   class A alpha,beta    → A reports cssClasses "default alpha beta"
    //
    // Assuming the state diagram's asymmetry would have dropped a class the
    // author applied, silently.
    const targets = stylesOf("erDiagram\n  A\n  B\n  class A,B urgent\n");
    expect(targets.map((s) => [s.targetIds, s.name])).toEqual([[["A", "B"], "urgent"]]);

    const names = stylesOf("erDiagram\n  A\n  class A alpha,beta\n");
    expect(names.map((s) => [s.targetIds, s.name])).toEqual([
      [["A"], "alpha"],
      [["A"], "beta"],
    ]);

    // A space after the comma is spare, measured: `class A, B urgent` is the
    // same statement, because the lexer skips whitespace between tokens.
    expect(stylesOf("erDiagram\n  A\n  B\n  class A, B urgent\n")[0].targetIds).toEqual([
      "A",
      "B",
    ]);

    // And `classDef` defines both names from one line: measured, `classDef
    // a,b fill:red` beside `class A b` paints `A`.
    expect(
      stylesOf("erDiagram\n  classDef a,b fill:red\n  A\n")
        .map((s) => [s.styleKind, s.name, s.properties]),
    ).toEqual([
      ["classDef", "a", [{ property: "fill", value: "red" }]],
      ["classDef", "b", [{ property: "fill", value: "red" }]],
    ]);
  });

  it("stops a `class` statement where its second name list ends, unlike `style`", () => {
    // ⚠️ The pair that has to be read side by side. `style\b` and
    // `classDef\b` each call `this.begin("style")`, whose only exit is the
    // newline; `class\b` changes no condition at all. Measured (mermaid
    // 11.17.2):
    //
    //   class A urgent B      → A is styled **and** `B` is an entity
    //   A style B fill:#f96 C → one entity, `A`; `C` is a styleComponent
    //
    // One reader treating "a styling keyword" as one idea gets one of the
    // two wrong, and both failures are silent: a box drawn that Mermaid
    // draws none for, or one dropped that it draws.
    expect(namesOf("erDiagram\n  A\n  class A urgent B\n")).toEqual(["A", "B"]);

    // The entity the target list can reach and the `style` alphabet cannot.
    // Measured: `P.Q` is one entity, `class P.Q u` styles it, and
    // `style P.Q fill:red` is a **lexical error** in Mermaid, because the
    // style condition's word rule drops the `.`.
    expect(stylesOf("erDiagram\n  P.Q\n  class P.Q u\n")[0].targetIds).toEqual(["P.Q"]);
  });

  it("reads `ORDER:::urgent` as the same apply-directive, riding on the entity declaration", () => {
    // Measured (mermaid 11.17.2): `ORDER:::urgent` reaches the same
    // `setClass` the `class ORDER urgent` statement does — the entity's
    // `cssClasses` becomes `"default urgent"` — so the two are one construct
    // in two spellings. The keyword kept in `authoredAs` is `:::`, which is
    // what a diagnostic about this line may quote; `parseFlowchart` already
    // spells it that way.
    const document = documentOf("erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER:::urgent\n");

    // ⚠️ The directive **rides on** an entity declaration rather than
    // replacing it: `ORDER` is named a third time here, exactly as a bare
    // `ORDER` on its own line would name it.
    expect(document.entities.map((e) => e.name)).toEqual(["CUSTOMER", "ORDER", "ORDER"]);
    expect(document.styles).toEqual([
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["ORDER"],
        name: "urgent",
        properties: [],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("composes `:::` with the alias and the attribute block, in Mermaid's own order", () => {
    // Measured, one probe per position — Mermaid's grammar has a separate
    // production for each and they are all `entityName ::: idList` *after*
    // the alias brackets:
    //
    //   A["Alias"]:::u       → the alias and the class both land
    //   A:::u["Alias"]       → a **parse error** ("got 'SQS'")
    //   A:::u { string n }   → the block's attribute lands on A
    //   A:::alpha,beta       → two classes, the comma splitting as `class`'s does
    //   A:::x B              → A is styled and `B` is an ordinary entity
    //   A:::                 → a parse error ("Expecting ... got 'NEWLINE'")
    const aliased = documentOf('erDiagram\n  A["Alias"]:::u\n');
    expect(aliased.entities.map((e) => [e.name, e.alias])).toEqual([["A", "Alias"]]);
    expect(aliased.styles.map((s) => [s.targetIds, s.name])).toEqual([[["A"], "u"]]);

    expect(refusalsFor('erDiagram\n  A:::u["Alias"]\n')).toEqual([
      'Unrecognized erDiagram line: "A:::u[\"Alias\"]"',
    ]);

    expect(attributesOf("erDiagram\n  A:::u {\n    string n\n  }\n", "A")).toEqual([
      { type: "string", name: "n", keys: [], comment: "" },
    ]);

    expect(
      stylesOf("erDiagram\n  A:::alpha,beta\n").map((s) => [s.targetIds, s.name]),
    ).toEqual([
      [["A"], "alpha"],
      [["A"], "beta"],
    ]);

    expect(namesOf("erDiagram\n  A:::x B\n")).toEqual(["A", "B"]);

    expect(refusalsFor("erDiagram\n  A:::\n")).toEqual([
      'Unrecognized erDiagram line: "A:::"',
    ]);
  });

  it("refuses `classDef default` by name rather than accepting it and painting nothing", () => {
    // ⚠️ **Every ER entity already wears a class called `default`**, and
    // that is measured rather than inferred: Mermaid's `addEntity` creates
    // each one with `cssClasses: "default"`, and `getCompiledStyles` reads
    // `cssClasses.split(" ")`. So `classDef default fill:#abc` beside a bare
    // `A` paints `A` — measured with `--markup`,
    // `style="fill:#abc !important"` on its box — with no `class` statement
    // anywhere.
    //
    // Siren has no implicit class of any kind, so reading this statement and
    // applying it to nothing would draw a **different picture with no
    // diagnostic** — the one failure mode the compatibility condition rules
    // out absolutely. Refused by name until the construct is implemented,
    // which is what `UNIMPLEMENTED` is for.
    expect(refusalsFor("erDiagram\n  classDef default fill:#abc\n  A\n")).toEqual([
      'Unimplemented erDiagram construct: the implicit "default" class every entity wears, in "classDef default fill:#abc"',
    ]);

    // Refused wherever it is named in the list, not only alone — measured,
    // `classDef a,default fill:red` defines both.
    expect(refusalsFor("erDiagram\n  classDef a,default fill:red\n")).toEqual([
      'Unimplemented erDiagram construct: the implicit "default" class every entity wears, in "classDef a,default fill:red"',
    ]);

    // The over-reach control: an ordinary class whose name merely contains
    // the word is untouched, and so is an **entity** called `default`, which
    // is an ordinary ER name (measured: `erDiagram / default` is one box).
    expect(stylesOf("erDiagram\n  classDef defaulting fill:red\n")[0].name).toBe("defaulting");
    expect(namesOf("erDiagram\n  default\n")).toEqual(["default"]);
  });
});
