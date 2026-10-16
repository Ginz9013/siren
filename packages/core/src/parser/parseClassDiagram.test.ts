import { describe, expect, it, vi } from "vitest";
import { parseClassDiagram } from "./parseClassDiagram";
import { parseSiren } from "./parseSiren";
import type { ClassDocument, ClassMember, Diagnostic, DiagramParseResult, Label } from "../contracts";
import { plainLabel, plainRun } from "../label/label";

/**
 * The test-only input for the one thing no real tag can exercise yet: how a
 * problem `readLabel` reports becomes a diagnostic — the device
 * `parseStateDiagram.test.ts` uses, for the same reason. `readLabel` is the
 * real one, delegated to unchanged, except that a `⚠` in a label's source
 * is reported as an error at that character and a `⚑` as a warning, so
 * where the diagnostic lands can be checked against where the author wrote
 * the character. No other label here contains either, so every other test
 * in this file reads labels exactly as production does.
 */
vi.mock("../label/readLabel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../label/readLabel")>();
  return {
    ...actual,
    readLabel: (...args: Parameters<typeof actual.readLabel>) => {
      const read = actual.readLabel(...args);
      const [source] = args;
      const problems = [...read.problems];
      for (const [mark, severity] of [["⚠", "error"], ["⚑", "warning"]] as const) {
        for (let at = source.indexOf(mark); at !== -1; at = source.indexOf(mark, at + 1)) {
          problems.push({ severity, message: `test problem ${mark}`, offset: at });
        }
      }
      return { ...read, problems };
    },
  };
});

/**
 * Rebuilds a member's source line from its parsed parts, the way the
 * renderer will have to. Nothing but the parts is used, so the test fails
 * if the parser drops a marker, a type, a parameter list or a return type.
 */
function reconstruct(member: ClassMember): string {
  const visibility = member.visibility ?? "";
  const type = member.type === null ? "" : `${member.type} `;
  const parameters = member.parameters === null ? "" : `(${member.parameters})`;
  const returnType = member.returnType === null ? "" : ` ${member.returnType}`;
  const classifier = member.classifier ?? "";
  return `${visibility}${type}${member.name}${parameters}${returnType}${classifier}`;
}

/**
 * Asserts a `parseClassDiagram` call produced a document and narrows it to
 * `ClassDocument`, so tests can read class-diagram fields without
 * repeating the null/union check.
 */
function parseOk(
  source: string,
  parse: (source: string) => DiagramParseResult = parseClassDiagram,
): { document: ClassDocument; diagnostics: Diagnostic[] } {
  const { document, diagnostics } = parse(source);
  if (document === null || document.kind !== "class") {
    throw new Error(
      `expected a class document, got ${document === null ? "null" : document.kind}` +
        ` (diagnostics: ${JSON.stringify(diagnostics)})`,
    );
  }
  return { document, diagnostics };
}

describe("parseClassDiagram", () => {
  it("parses a bare class declaration into a class with no members", () => {
    const source = `classDiagram
  class Animal
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes).toEqual([
      {
        id: "Animal",
        generic: null,
        annotation: null,
        label: null,
        members: [],
        line: 2,
        column: 3,
      },
    ]);
  });

  it("parses a block-form class, keeping each member's visibility, type, parameters and return type", () => {
    const source = `classDiagram
  class Fish {
    +int size
    -String name
    +swim() bool
  }
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes).toHaveLength(1);
    expect(document.classes[0].id).toBe("Fish");
    expect(document.classes[0].members).toEqual([
      {
        memberKind: "attribute",
        visibility: "+",
        classifier: null,
        name: "size",
        type: "int",
        parameters: null,
        returnType: null,
        line: 3,
        column: 5,
      },
      {
        memberKind: "attribute",
        visibility: "-",
        classifier: null,
        name: "name",
        type: "String",
        parameters: null,
        returnType: null,
        line: 4,
        column: 5,
      },
      {
        memberKind: "method",
        visibility: "+",
        classifier: null,
        name: "swim",
        type: null,
        parameters: "",
        returnType: "bool",
        line: 5,
        column: 5,
      },
    ]);
  });

  it("parses the inline member form, one declaration per line — merging repeats is the model's job", () => {
    const source = `classDiagram
  Bird : +fly()
  Bird : +int wingspan
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => c.id)).toEqual(["Bird", "Bird"]);
    expect(document.classes[0].members).toEqual([
      {
        memberKind: "method",
        visibility: "+",
        classifier: null,
        name: "fly",
        type: null,
        parameters: "",
        returnType: null,
        line: 2,
        column: 3,
      },
    ]);
    expect(document.classes[1].members).toEqual([
      {
        memberKind: "attribute",
        visibility: "+",
        classifier: null,
        name: "wingspan",
        type: "int",
        parameters: null,
        returnType: null,
        line: 3,
        column: 3,
      },
    ]);
  });

  it("parses an inheritance relationship into its line style and its two endpoint markers", () => {
    const source = `classDiagram
  Animal <|-- Duck
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.relationships).toEqual([
      {
        from: "Animal",
        to: "Duck",
        line: "solid",
        fromEnd: "triangle",
        toEnd: "none",
        label: null,
        fromMultiplicity: null,
        toMultiplicity: null,
        sourceLine: 2,
        sourceColumn: 3,
      },
    ]);
  });

  it("keeps every part of a member line, so the line can be reconstructed from the parts", () => {
    const memberLines = [
      "+int size",
      "-String name",
      "#protectedThing",
      "~packageThing",
      "+swim() bool",
      "+move(int x, int y)",
      "draw()*",
      "count$",
      "+getPoints() List~int~",
    ];
    const source = `classDiagram
  class Everything {
${memberLines.map((member) => `    ${member}`).join("\n")}
  }
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes[0].members.map(reconstruct)).toEqual(memberLines);
  });

  it("reports an error diagnostic and no document for an unterminated class block, without throwing", () => {
    const source = `classDiagram
  class Fish {
    +int size
`;

    expect(() => parseClassDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("reports an error diagnostic and no document for an unrecognized statement, without throwing", () => {
    const source = `classDiagram
  wibble wobble wubble
`;

    expect(() => parseClassDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("reports an error diagnostic and no document for a member line it cannot read", () => {
    const source = `classDiagram
  class Fish {
    !!!
  }
`;

    expect(() => parseClassDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  // Mermaid's eight relationship forms, plus the mirrored spelling of each
  // form that has one. Expected values are read off Mermaid's own
  // relationship table (inheritance, composition, aggregation,
  // association, link, dependency, realization, dashed link), not off this
  // parser's output.
  const RELATIONSHIP_FORMS: ReadonlyArray<
    [token: string, line: string, fromEnd: string, toEnd: string]
  > = [
    ["<|--", "solid", "triangle", "none"],
    ["*--", "solid", "diamondFilled", "none"],
    ["o--", "solid", "diamondHollow", "none"],
    ["-->", "solid", "none", "arrow"],
    ["--", "solid", "none", "none"],
    ["..>", "dashed", "none", "arrow"],
    ["..|>", "dashed", "none", "triangle"],
    ["..", "dashed", "none", "none"],
    ["--|>", "solid", "none", "triangle"],
    ["--*", "solid", "none", "diamondFilled"],
    ["--o", "solid", "none", "diamondHollow"],
    ["<--", "solid", "arrow", "none"],
    ["<..", "dashed", "arrow", "none"],
    ["<|..", "dashed", "triangle", "none"],
  ];

  it("creates a class named only by a relationship, alongside the declared ones", () => {
    const source = `classDiagram
  Animal <|-- Duck
  class Fish {
    +int size
    -String name
    +swim() bool
  }
  Bird : +fly()
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => c.id)).toEqual(["Animal", "Duck", "Fish", "Bird"]);
    expect(document.classes.map((c) => c.members.length)).toEqual([0, 0, 3, 1]);
    expect(
      document.classes
        .find((c) => c.id === "Fish")
        ?.members.map((m) => `${m.memberKind}:${m.name}`),
    ).toEqual(["attribute:size", "attribute:name", "method:swim"]);
    expect(
      document.classes.find((c) => c.id === "Bird")?.members.map((m) => m.memberKind),
    ).toEqual(["method"]);
    expect(document.relationships).toHaveLength(1);
  });

  it("creates an implicitly named class once, however many relationships name it", () => {
    const source = `classDiagram
  Animal <|-- Duck
  Animal <|-- Fish
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => c.id)).toEqual(["Animal", "Duck", "Fish"]);
  });

  it("parses a relationship's label and the multiplicity string at each end", () => {
    const source = `classDiagram
  Customer "1" --> "*" Ticket : places
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.relationships).toEqual([
      {
        from: "Customer",
        to: "Ticket",
        line: "solid",
        fromEnd: "none",
        toEnd: "arrow",
        label: plainLabel("places"),
        fromMultiplicity: "1",
        toMultiplicity: "*",
        sourceLine: 2,
        sourceColumn: 3,
      },
    ]);
  });

  it("parses an annotation written inside a class block, alongside that class's members", () => {
    const source = `classDiagram
  class Shape {
    <<interface>>
    +int sides
    +draw()
  }
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);

    // An annotation line inside a block is emitted as its own
    // annotation-only declaration of the class, the same shape a standalone
    // `<<interface>> Shape` produces, rather than being folded into the
    // block's own declaration. Two declarations of one id is this parser's
    // normal output — every mention emits one, and `buildClassModel` merges
    // them — and it is what lets two conflicting annotations in one block be
    // diagnosed by the same rule as two across separate declarations.
    const shape = document.classes.filter((c) => c.id === "Shape");
    expect(shape).toHaveLength(2);
    expect(shape.map((c) => c.annotation)).toEqual(["interface", null]);
    expect(shape.flatMap((c) => c.members.map((m) => m.name))).toEqual([
      "sides",
      "draw",
    ]);
  });

  it("emits both annotations when one class block carries two, so the model can diagnose the conflict", () => {
    const source = `classDiagram
  class Shape {
    <<interface>>
    <<abstract>>
    +int sides
  }
`;

    const { document, diagnostics } = parseOk(source);

    // The parser does not choose between them: collapsing here is what made
    // an in-block conflict silently keep the last one while the same mistake
    // across two declarations warned and kept the first.
    expect(diagnostics).toEqual([]);
    expect(
      document.classes.filter((c) => c.id === "Shape").map((c) => c.annotation),
    ).toEqual(["interface", "abstract", null]);
  });

  it("parses a standalone annotation as a declaration of the class it names, with any author text", () => {
    const source = `classDiagram
  <<interface>> Shape
  <<Service>> Repository
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => ({ id: c.id, annotation: c.annotation }))).toEqual([
      { id: "Shape", annotation: "interface" },
      { id: "Repository", annotation: "Service" },
    ]);
  });

  it("captures a class's generic parameter in both declaration forms, and keeps a generic member type verbatim", () => {
    const source = `classDiagram
  class Square~Shape~
  class Bag~T~ {
    +List~int~ points
  }
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => ({ id: c.id, generic: c.generic }))).toEqual([
      { id: "Square", generic: "Shape" },
      { id: "Bag", generic: "T" },
    ]);
    expect(document.classes[1].members[0]).toMatchObject({
      name: "points",
      type: "List~int~",
    });
  });

  it("parses a nested generic parameter whole, rather than diagnosing it", () => {
    const source = `classDiagram
  class Shelf~Map~String, List~int~~~
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.classes).toHaveLength(1);
    expect(document.classes[0].id).toBe("Shelf");
    expect(document.classes[0].generic).toBe("Map~String, List~int~~");
  });

  it("parses a namespace naming its member classes, which stay ordinary classes in the document", () => {
    const source = `classDiagram
  namespace BaseShapes {
    class Triangle
    class Square {
      -int id
      +getArea() int
    }
  }
  Triangle <|-- Square
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.namespaces).toEqual([
      { id: "BaseShapes", label: null, classIds: ["Triangle", "Square"], line: 2, column: 3 },
    ]);
    expect(document.classes.map((c) => c.id)).toEqual(["Triangle", "Square"]);
    expect(document.classes[1].members.map((m) => m.name)).toEqual(["id", "getArea"]);
    expect(document.relationships).toHaveLength(1);
  });

  it("reports an error diagnostic and no document for an unterminated namespace, without throwing", () => {
    const source = `classDiagram
  namespace BaseShapes {
    class Triangle
`;

    expect(() => parseClassDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("parses a free note as a note with no target", () => {
    const source = `classDiagram
  note "This diagram is a work in progress"
  class Duck
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.notes).toEqual([
      {
        label: plainLabel("This diagram is a work in progress"),
        targetId: null,
        line: 2,
        column: 3,
      },
    ]);
    expect(document.classes.map((c) => c.id)).toEqual(["Duck"]);
  });

  it("parses an attached note as a note carrying its target class name", () => {
    const source = `classDiagram
  class Duck
  note for Duck "can fly, can swim"
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.notes).toEqual([
      {
        label: plainLabel("can fly, can swim"),
        targetId: "Duck",
        line: 3,
        column: 3,
      },
    ]);
  });

  it("parses a direction statement, defaulting to TB when the document has none", () => {
    const withDirection = parseOk(`classDiagram
  direction RL
  Animal <|-- Duck
`);
    const withoutDirection = parseOk(`classDiagram
  Animal <|-- Duck
`);

    expect(withDirection.diagnostics).toEqual([]);
    expect(withDirection.document.direction).toBe("RL");
    expect(withoutDirection.document.direction).toBe("TB");
  });

  it("accepts the TD alias for TB, exactly as the flowchart header does", () => {
    const parsed = parseOk(`classDiagram
  direction TD
  Animal <|-- Duck
`);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.direction).toBe("TB");
  });

  it("parses a click href interaction, with and without the trailing tooltip", () => {
    const source = `classDiagram
  class Shape
  click Shape href "https://example.com"
  click Other href "https://example.org" "Read the docs"
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "Shape",
        action: "https://example.com",
        argument: null,
        tooltip: null,
        line: 3,
        column: 3,
      },
      {
        interactionKind: "href",
        targetId: "Other",
        action: "https://example.org",
        argument: null,
        tooltip: "Read the docs",
        line: 4,
        column: 3,
      },
    ]);
  });

  it("parses a click call interaction, capturing the function name and any literal argument", () => {
    const source = `classDiagram
  click Shape call callbackFn()
  click Other call callbackFn("arg")
  click Third call callbackFn("arg") "Do the thing"
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "call",
        targetId: "Shape",
        action: "callbackFn",
        argument: null,
        tooltip: null,
        line: 2,
        column: 3,
      },
      {
        interactionKind: "call",
        targetId: "Other",
        action: "callbackFn",
        argument: "arg",
        tooltip: null,
        line: 3,
        column: 3,
      },
      {
        interactionKind: "call",
        targetId: "Third",
        action: "callbackFn",
        argument: "arg",
        tooltip: "Do the thing",
        line: 4,
        column: 3,
      },
    ]);
  });

  it("parses callback and link as spellings of the click forms, not as separate concepts", () => {
    const spellings = parseOk(`classDiagram
  callback Shape "callbackFn"
  link Shape "https://example.com"
`);
    const clicks = parseOk(`classDiagram
  click Shape call callbackFn()
  click Shape href "https://example.com"
`);

    expect(spellings.diagnostics).toEqual([]);
    // Compared to the `click` equivalents rather than to a literal, because
    // the criterion is that the two spellings produce the same shape.
    expect(spellings.document.interactions.map((i) => ({ ...i, line: 0 }))).toEqual(
      clicks.document.interactions.map((i) => ({ ...i, line: 0 })),
    );
    expect(spellings.document.interactions.map((i) => i.line)).toEqual([2, 3]);
  });

  it("parses a style statement into its target and an ordered list of property/value pairs", () => {
    const source = `classDiagram
  class Shape
  style Shape fill:#fdd,stroke:#c00
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles).toEqual([
      {
        styleKind: "style",
        authoredAs: "style",
        targetIds: ["Shape"],
        name: null,
        properties: [
          { property: "fill", value: "#fdd" },
          { property: "stroke", value: "#c00" },
        ],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("parses classDef as a named definition and cssClass as an application naming every target", () => {
    const source = `classDiagram
  classDef emphasis fill:#fdd
  cssClass "Shape,Other" emphasis
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles).toEqual([
      {
        styleKind: "classDef",
        authoredAs: "classDef",
        targetIds: [],
        name: "emphasis",
        properties: [{ property: "fill", value: "#fdd" }],
        line: 2,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: "cssClass",
        targetIds: ["Shape", "Other"],
        name: "emphasis",
        properties: [],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("normalizes the authored `cssClass` to the canonical apply kind, as `direction TD` normalizes to TB", () => {
    // Mermaid spells the apply-directive `cssClass` here and `class` in a
    // flowchart. One kind reaches the model, so nothing downstream learns
    // that two spellings exist; the spelling survives only in `authoredAs`,
    // which is what a diagnostic quotes back at the author.
    const parsed = parseOk(`classDiagram
  classDef emphasis fill:#fdd
  cssClass "Shape" emphasis
`);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.styles.map((style) => [style.styleKind, style.authoredAs])).toEqual([
      ["classDef", "classDef"],
      ["apply", "cssClass"],
    ]);
  });

  it("reads `class X:::c` as a declaration plus the same apply directive cssClass produces, in every spelling Mermaid takes", () => {
    // Measured on mermaid 12.2.0: `:::` follows the name, a generic or a
    // label, with or without spaces round it, and inside a namespace too.
    const { document, diagnostics } = parseOk(`classDiagram
  class A:::urgent
  class B ::: urgent
  class C~T~:::urgent
  class D["Dee"] :::urgent
  namespace N {
    class E:::urgent
  }
`);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => [c.id, c.generic, c.label?.text ?? null])).toEqual([
      ["A", null, null],
      ["B", null, null],
      ["C", "T", null],
      ["D", null, "Dee"],
      ["E", null, null],
    ]);
    expect(document.namespaces[0].classIds).toEqual(["E"]);
    expect(document.styles).toEqual(
      [
        ["A", 2],
        ["B", 3],
        ["C", 4],
        ["D", 5],
        ["E", 7],
      ].map(([id, line]) => ({
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: [id],
        name: "urgent",
        properties: [],
        line,
        column: id === "E" ? 5 : 3,
      })),
    );
  });

  it("reads `:::c` on a block-form declaration's opening line, keeping the block's members", () => {
    // Measured on mermaid 12.2.0: `class X:::c {` and `class X:::c{` both
    // draw X with its members and the class attached.
    const { document, diagnostics } = parseOk(`classDiagram
  class A:::urgent {
    +int a
  }
  class B~T~["Bee"] ::: urgent{
    +b()
  }
`);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => [c.id, c.generic, c.label?.text ?? null, c.members.map((m) => m.name)])).toEqual([
      ["A", null, null, ["a"]],
      ["B", "T", "Bee", ["b"]],
    ]);
    expect(document.styles.map((style) => [style.styleKind, style.authoredAs, style.targetIds, style.name, style.line])).toEqual([
      ["apply", ":::", ["A"], "urgent", 2],
      ["apply", ":::", ["B"], "urgent", 5],
    ]);
  });

  it("refuses `:::` everywhere Mermaid parse-errors on it", () => {
    // Each measured on mermaid 12.2.0 as a parse error (`got
    // 'STYLE_SEPARATOR'`, or `got 'MINUS'` for the hyphenated name). Three
    // of them Siren used to draw: `X:::c --> Y` and `X:::c : +int a` as a
    // class X with a member, `Y --> X:::c` as a relationship labelled `::c`.
    const statements = [
      "X:::c --> Y",
      "Y --> X:::c",
      "X:::c --() Y",
      "X:::c",
      "X:::c : +int a",
      "<<interface>> X:::c",
      "class X:::c,d",
      "class X:::c:::d",
      "class X:::my-c",
    ];
    const refused = statements.map((statement) => {
      const { document, diagnostics } = parseClassDiagram(`classDiagram\n  classDef c fill:#f96\n  ${statement}\n`);
      return [statement, document === null, diagnostics.map((d) => `${d.severity}@${d.line}`)];
    });
    expect(refused).toEqual(statements.map((statement) => [statement, true, ["error@3"]]));
  });

  it("still reads a `:::` inside quotes as text: a class label and a note", () => {
    // Measured on mermaid 12.2.0: each draws, with `a:::b` as its text.
    const { document, diagnostics } = parseOk(`classDiagram
  class A["a:::b"]
  A --> B
  note for B "a:::b"
`);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => c.id)).toEqual(["A", "B"]);
    expect(document.styles).toEqual([]);
    expect(document.notes).toHaveLength(1);
  });

  it("reports an error diagnostic for a style declaration that is not a property:value pair", () => {
    const source = `classDiagram
  class Shape
  style Shape fill:#fdd,wibble
`;

    expect(() => parseClassDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error" && d.line === 3)).toBe(true);
  });

  // Boundary-pinning, not a missing check: a `javascript:` URL and a
  // `url(` value are syntactically well-formed, and this parser reports
  // syntax only. Both are rejected one stage later, by `buildClassModel`,
  // which owns the `http`/`https`/`mailto` allowlist and the rejected
  // style-function list. This test exists so that moving either check into
  // the parser — where it would silently change what a document *is*,
  // rather than what is safe to render — fails loudly.
  it("parses a javascript: URL and a url( style value without a diagnostic — rejecting them is the model's job", () => {
    const source = `classDiagram
  class Shape
  click Shape href "javascript:alert(1)"
  style Shape fill:url(#evil)
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toHaveLength(1);
    expect(document.interactions[0].action).toBe("javascript:alert(1)");
    expect(document.styles).toHaveLength(1);
    expect(document.styles[0].properties).toEqual([{ property: "fill", value: "url(#evil)" }]);
  });

  it("keeps a comma inside a style value's parentheses out of the declaration split", () => {
    const source = `classDiagram
  class Shape
  style Shape fill:rgb(255, 0, 0)
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles).toHaveLength(1);
    expect(document.styles[0].properties).toEqual([{ property: "fill", value: "rgb(255, 0, 0)" }]);
  });

  // The decision this pins: an unbalanced parenthesis is a value problem,
  // not a list problem. An unclosed `(` runs to the end of the declaration
  // list — the text is kept in that one value rather than dropped — and a
  // stray `)` is ignored by the splitter, so the declarations after it
  // still separate normally instead of being swallowed into one value.
  it("reads an unclosed ( as running to the end of the list, and lets a stray ) still split", () => {
    const unclosed = parseOk(`classDiagram
  class Shape
  style Shape fill:rgb(1, 2,stroke:#c00
`);

    expect(unclosed.diagnostics).toEqual([]);
    expect(unclosed.document.styles[0].properties).toEqual([
      { property: "fill", value: "rgb(1, 2,stroke:#c00" },
    ]);

    const stray = parseOk(`classDiagram
  class Shape
  style Shape fill:a),stroke:#c00
`);

    expect(stray.diagnostics).toEqual([]);
    expect(stray.document.styles[0].properties).toEqual([
      { property: "fill", value: "a)" },
      { property: "stroke", value: "#c00" },
    ]);
  });

  it("still splits the commas that separate declarations, around and inside a nested paren value", () => {
    const source = `classDiagram
  class Shape
  style Shape fill:rgb(1,2,3),stroke:#c00,stroke-width:2px
  classDef emphasis fill:color-mix(in srgb, rgb(1,2,3), #fff),stroke:#c00
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles[0].properties).toEqual([
      { property: "fill", value: "rgb(1,2,3)" },
      { property: "stroke", value: "#c00" },
      { property: "stroke-width", value: "2px" },
    ]);
    expect(document.styles[1].properties).toEqual([
      { property: "fill", value: "color-mix(in srgb, rgb(1,2,3), #fff)" },
      { property: "stroke", value: "#c00" },
    ]);
  });

  it("still reports a segment with no colon, even beside a declaration whose value holds commas", () => {
    const source = `classDiagram
  class Shape
  style Shape fill:rgb(1,2,3),wibble
`;

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized style declaration: "wibble"',
        line: 3,
        column: 3,
      },
    ]);
  });

  it.each(RELATIONSHIP_FORMS)(
    "parses the %s relationship form into its line style and endpoint markers",
    (token, expectedLine, expectedFromEnd, expectedToEnd) => {
      const { document, diagnostics } = parseOk(`classDiagram
  A ${token} B
`);

      expect(diagnostics).toEqual([]);
      expect(document.relationships).toHaveLength(1);
      const [relationship] = document.relationships;
      expect({
        from: relationship.from,
        to: relationship.to,
        line: relationship.line,
        fromEnd: relationship.fromEnd,
        toEnd: relationship.toEnd,
      }).toEqual({
        from: "A",
        to: "B",
        line: expectedLine,
        fromEnd: expectedFromEnd,
        toEnd: expectedToEnd,
      });
    },
  );

  it.each([
    ["Duck ()-- Quacks", "solid", "circle", "none"],
    ["Quacks --() Duck", "solid", "none", "circle"],
    ["Duck ()..Quacks", "dashed", "circle", "none"],
    ["Duck () -- Quacks", "solid", "circle", "none"],
    ["Duck()--Quacks", "solid", "circle", "none"],
  ])(
    "parses the lollipop marker %s into a circle endpoint",
    (line, expectedLine, expectedFromEnd, expectedToEnd) => {
      const { document, diagnostics } = parseOk(`classDiagram
  ${line}
`);

      expect(diagnostics).toEqual([]);
      expect(document.relationships).toHaveLength(1);
      const [relationship] = document.relationships;
      expect({
        line: relationship.line,
        fromEnd: relationship.fromEnd,
        toEnd: relationship.toEnd,
      }).toEqual({ line: expectedLine, fromEnd: expectedFromEnd, toEnd: expectedToEnd });
    },
  );

  it("does not implicitly declare a class for the lollipop side of a relationship", () => {
    const source = `classDiagram
  Duck ()-- Quacks
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    // Mermaid measured (mermaid-probe.mjs): the `()` side never becomes a
    // class — only "Quacks" does. Asserting the class list stays exactly
    // ["Quacks"] catches a parser that still calls `declareImplicitly` for
    // the lollipop side.
    expect(document.classes.map((c) => c.id)).toEqual(["Quacks"]);
  });

  it("parses a timeline: block into the same entry shape the flowchart parser produces", () => {
    const source = `classDiagram
  Animal <|-- Duck
timeline:
enter Animal fade
enter Duck slide-left, enter Animal-Duck fade
highlight Duck glow
unhighlight Duck
exit Animal slide-top
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.timeline).toEqual({
      entries: [
        { kind: "enter", step: 1, targetId: "Animal", effect: "fade", line: 4, column: 1 },
        { kind: "enter", step: 2, targetId: "Duck", effect: "slide-left", line: 5, column: 1 },
        { kind: "enter", step: 2, targetId: "Animal-Duck", effect: "fade", line: 5, column: 1 },
        { kind: "highlight", step: 3, targetId: "Duck", effect: "glow", line: 6, column: 1 },
        { kind: "unhighlight", step: 4, targetId: "Duck", line: 7, column: 1 },
        { kind: "exit", step: 5, targetId: "Animal", effect: "slide-top", line: 8, column: 1 },
      ],
    });
  });

  it("keeps the colon inside a namespace or note id, which the model assigns as namespace:1 / note:1", () => {
    // The entry grammar splits on whitespace *after* the step's own colon, so
    // a second colon inside the target id is read as part of the id rather
    // than ending the step. Worth pinning: it looks like it should not work.
    const source = `classDiagram
  namespace Zoo {
    class Duck
  }
  note "Drawn from the ledger"
timeline:
enter namespace:1 fade
enter note:1 fade
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.timeline?.entries.map((entry) => entry.targetId)).toEqual([
      "namespace:1",
      "note:1",
    ]);
  });

  it("reports an unrecognized timeline verb the way the flowchart parser does, and returns no document", () => {
    const source = `classDiagram
  class Animal
timeline:
wibble Animal fade
`;

    const { document, diagnostics } = parseClassDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Unrecognized timeline verb "wibble" (expected "enter", "exit", "highlight", or "unhighlight")',
        line: 4,
        column: 1,
      },
    ]);
  });
});

/** A label of these rows, each one plain run — what `a<br/>b` reads as. */
const rowsLabel = (...rows: string[]): Label => ({
  text: rows.join("\n"),
  rows: rows.map((row) => [plainRun(row)]),
});

describe("parseClassDiagram — the places a class diagram writes a label", () => {
  // Measured (mermaid 11.17.2, `--paint`): `class A["Order<br/>Line"]` draws
  // "Order" over "Line" in both label modes, the `<br/>` honored rather than
  // drawn.
  it("reads a class's bracketed label, so a <br> in it breaks a row", () => {
    const { document, diagnostics } = parseOk(`classDiagram
  class Order["Order<br/>Line"]
  class Plain
`);

    expect(diagnostics).toEqual([]);
    expect(document.classes.map((c) => [c.id, c.label])).toEqual([
      ["Order", rowsLabel("Order", "Line")],
      ["Plain", null],
    ]);
  });

  // Measured: the label goes after the generic (`class A~T~["Lab"]`), a
  // space may stand before its `[`, and the block form takes one too.
  it("reads the label in the block form and after a generic, keeping the generic", () => {
    const { document, diagnostics } = parseOk(`classDiagram
  class Registry~T~ ["Kept<br>here"] {
    +int size
  }
`);

    expect(diagnostics).toEqual([]);
    const [registry] = document.classes;
    expect(registry.generic).toBe("T");
    expect(registry.label).toEqual(rowsLabel("Kept", "here"));
    expect(registry.members.map((m) => m.name)).toEqual(["size"]);
  });

  // Measured: `A --> B : a<br/>b` draws "a" over "b" (`title="a<br>b"`, two
  // rows in `--markup`), the tags honored in Mermaid's HTML labels.
  it("reads a relationship's label, so a <br> in it breaks a row", () => {
    const { document, diagnostics } = parseOk(`classDiagram
  Order --> Line : holds<br/>many
`);

    expect(diagnostics).toEqual([]);
    expect(document.relationships.map((r) => r.label)).toEqual([rowsLabel("holds", "many")]);
  });

  // The board inferred this position; measured (mermaid 11.17.2, `--paint`,
  // `htmlLabels: true`): `note for A "n<br/>m <i>q</i>r"` reads "nm qr" and
  // draws "n" over "m q r" — the tags honored — and a free note likewise.
  it("reads a note's text as a label, attached or free", () => {
    const { document, diagnostics } = parseOk(`classDiagram
  class Duck
  note for Duck "can fly<br/>can swim"
  note "free<br>note"
`);

    expect(diagnostics).toEqual([]);
    expect(document.notes.map((n) => n.label)).toEqual([
      rowsLabel("can fly", "can swim"),
      rowsLabel("free", "note"),
    ]);
  });

  // Not on the board's table of measured places; measured (mermaid 11.17.2,
  // `--paint`): `namespace Zoo["Big<br/>Zoo <b>x</b>"] {` is accepted, keeps
  // `Zoo` as the cluster's id, and draws "Big" over "Zoo x" — the tags
  // honored in HTML labels. A namespace written without one is labelled by
  // its name downstream, so here it has none.
  it("reads a namespace's bracketed label, keeping the name it is declared by", () => {
    const { document, diagnostics } = parseOk(`classDiagram
  namespace Zoo["Big<br/>Zoo"] {
    class Lion
  }
  namespace Farm {
    class Cow
  }
`);

    expect(diagnostics).toEqual([]);
    expect(document.namespaces.map((n) => [n.id, n.label, n.classIds])).toEqual([
      ["Zoo", rowsLabel("Big", "Zoo"), ["Lion"]],
      ["Farm", null, ["Cow"]],
    ]);
  });

  // A member is not a label. Measured (mermaid 11.17.2, `--paint`): Mermaid
  // escapes a member's text in both label modes, so `+id<br/>int` draws the
  // characters `+id<br>int` — its own `/<br\s*\/?>/gi` respells every `<br>`
  // as `<br>` first — and `+<b>id</b> int` draws its tags as written.
  it("keeps a member's tags as written, respelling a <br> the way Mermaid does", () => {
    const { document, diagnostics } = parseOk(`classDiagram
  class Order {
    +id<br/>int
    +<b>id</b> int
  }
  Order : -a<BR />b
`);

    expect(diagnostics).toEqual([]);
    expect(document.classes.flatMap((c) => c.members).map(reconstruct)).toEqual([
      "+id<br>int",
      "+<b>id</b> int",
      "-a<br>b",
    ]);
  });
});

describe("parseClassDiagram — a problem in a label, reported where the author wrote it", () => {
  it("reports a warning at its line and column in each place a label is read, and keeps the document", () => {
    const { document, diagnostics } = parseClassDiagram(`classDiagram
  class Order["ab⚑"]
  Order --> Line : x⚑
  note "n⚑"
  namespace Zoo["⚑"] {
    class Lion
  }
`);

    expect(document).not.toBeNull();
    expect(diagnostics).toEqual([
      { severity: "warning", message: "test problem ⚑", line: 2, column: 18 },
      { severity: "warning", message: "test problem ⚑", line: 3, column: 21 },
      { severity: "warning", message: "test problem ⚑", line: 4, column: 10 },
      { severity: "warning", message: "test problem ⚑", line: 5, column: 18 },
    ]);
  });

  it("refuses the whole document for an error in a label, as for an unrecognized line", () => {
    const { document, diagnostics } = parseClassDiagram(`classDiagram
  note for Lion "lazy ⚠"
  class Lion
`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      { severity: "error", message: "test problem ⚠", line: 2, column: 23 },
    ]);
  });
});

/**
 * Mermaid's style-line rule (its `encodeEntities`): before it parses, it
 * drops the last `;` of every line where `style` (or `classDef`), a `:` and
 * then a `#` come before it — the whole line, not one label. Mermaid
 * 11.17.2, measured with `--html`. `parseSiren` applies it to the whole
 * document, so these read through it.
 */
describe("parseClassDiagram — the `;` Mermaid drops from a style line", () => {
  const labelOf = (source: string) => parseOk(source, parseSiren).document.classes.find((c) => c.id === "A")!.label!.text;

  it("is the label's own last `;` when nothing follows it on the line", () => {
    // `class A["<b style='x:#1'>r</b> #35;"]` draws `r #35`.
    expect(labelOf(`classDiagram\n  class A["<b style='x:#1'>r</b> #35;"]`)).toBe("r #35");
  });

  it("is the statement's trailing `;` when one follows the label", () => {
    // `class A["<b style='x:#1'>r</b> #35;"];` draws `r #`.
    expect(labelOf(`classDiagram\n  class A["<b style='x:#1'>r</b> #35;"];`)).toBe("r #");
  });

  it("leaves a position past it where the author wrote it", () => {
    // `  class A["<b style='x:#1'>#35;⚑</b>"]`: the ⚑ is the 32nd character.
    expect(parseSiren(`classDiagram\n  class A["<b style='x:#1'>#35;⚑</b>"]`).diagnostics).toEqual([
      { severity: "warning", message: "test problem ⚑", line: 2, column: 32 },
    ]);
  });
});

describe("the header a class diagram rejects", () => {
  // Characterization: two accepted spellings joined by a bare `or`, with no
  // comma — the shape a two-item list takes, as against the eight-item one
  // a flowchart's rejection prints.
  it("names both of its spellings", () => {
    const { document, diagnostics } = parseClassDiagram("classDiagram-v3\n  class Animal\n");

    expect(document).toBeNull();
    expect(diagnostics[0].message).toBe(
      'Expected "classDiagram" or "classDiagram-v2", found "classDiagram-v3"',
    );
  });
});

describe("parseClassDiagram — accTitle and accDescr", () => {
  it("reads them as the diagram's accessible title and description, never as classes", () => {
    // 01M4WVVN9, measured on mermaid 12.2.0: lower-case `accTitle: T`,
    // `accTitle : T` and `accDescr:D` set the fields and draw nothing, and
    // the braced block reads as in every kind. Siren drew classes called
    // `accTitle` and `accDescr`, each with the text as a member.
    const { document, diagnostics } = parseOk(
      "classDiagram\n  accTitle : Orders\n  accDescr {\n    how\n      orders move\n  }\n  class A\n",
    );
    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBe("Orders");
    expect(document.accDescr).toBe("how\norders move");
    expect(document.classes.map((c) => c.id)).toEqual(["A"]);
    expect(parseOk("classDiagram\n  accDescr:D\n  class A\n").document.accDescr).toBe("D");
  });

  it("leaves the capital spelling to the class-member syntax, as Mermaid's lexer does", () => {
    // Measured: a class diagram's acc rules are lower case only, so
    // `ACCTITLE: T` is the class `ACCTITLE` with the member `T`.
    const { document } = parseOk("classDiagram\n  ACCTITLE: T\n");
    expect(document.accTitle).toBeNull();
    expect(document.classes.map((c) => c.id)).toEqual(["ACCTITLE"]);
  });

  it("refuses an empty or unclosed accDescr block, both parse errors in Mermaid", () => {
    for (const source of ["classDiagram\n  accDescr {\n  }\n  class A\n", "classDiagram\n  accDescr {\n  one\n  class A\n"]) {
      expect([source, parseClassDiagram(source).document]).toEqual([source, null]);
    }
  });
});

/**
 * A `%%` in the middle of a class-diagram line (CONTEXT.md **Comment**),
 * measured on Mermaid 12.2.0 (the class table in the mermaid-parity
 * measurement). Only a whole line is a comment; the class lexer's own `%%`
 * rules read one where a token ends but swallow the line break after it, so
 * such a comment holds only on the document's last line. Read through
 * `parseSiren`, which hands a class diagram its lines as written.
 */
describe("a `%%` in the middle of a class-diagram line", () => {
  const NOT_A_COMMENT =
    'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
    "If it is a comment, move it to a line of its own.";

  const classOk = (body: string) => parseOk(`classDiagram\n${body}`, parseSiren).document;
  const membersOf = (document: ClassDocument) =>
    document.classes.flatMap((declaration) => declaration.members.map(reconstruct));

  it("keeps a `%%` in every piece of text a statement holds, as Mermaid records it", () => {
    // Measured: a member or method in a block or after `Class :`, a
    // relationship's label, a note's quoted text, a class's quoted label,
    // a `style`/`classDef` declaration list and the accessibility lines all
    // keep their `%% zz`, on the last line or not.
    expect(membersOf(classOk("  class A {\n    +int x %% zz\n  }"))).toEqual(["+int x %% zz"]);
    expect(membersOf(classOk("  class A {\n    +run(a) int %% zz\n  }"))).toEqual(["+run(a) int %% zz"]);
    expect(membersOf(classOk("  class A\n  A : +int x %% zz"))).toEqual(["+int x %% zz"]);
    expect(membersOf(classOk("  class A\n  A : +int x %% zz\n  class B"))).toEqual(["+int x %% zz"]);
    expect(membersOf(classOk("  class A\n  A : +run() %% zz\n  class B"))).toEqual(["+run() %% zz"]);
    expect(classOk("  A --> B : lbl %% zz\n  class C").relationships.map((r) => r.label?.text)).toEqual([
      "lbl %% zz",
    ]);
    expect(classOk("  A --> B : lbl %% zz").relationships.map((r) => r.label?.text)).toEqual(["lbl %% zz"]);
    expect(classOk('  class A\n  note "n %% zz"\n  class B').notes.map((n) => n.label.text)).toEqual(["n %% zz"]);
    expect(classOk('  class A\n  note for A "n %% zz"\n  class B').notes.map((n) => n.label.text)).toEqual([
      "n %% zz",
    ]);
    expect(classOk('  class A["l %% zz"]\n  class B').classes.map((c) => c.label?.text ?? null)).toEqual([
      "l %% zz",
      null,
    ]);
    const styled = classOk("  class A\n  style A fill:#f00 %% zz\n  classDef c fill:#0f0 %% zz\n  class B");
    expect(styled.styles.map((s) => [s.styleKind, s.properties])).toEqual([
      ["style", [{ property: "fill", value: "#f00 %% zz" }]],
      ["classDef", [{ property: "fill", value: "#0f0 %% zz" }]],
    ]);
    const described = classOk("  accTitle: t %% zz\n  accDescr: d %% zz\n  class A");
    expect([described.accTitle, described.accDescr]).toEqual(["t %% zz", "d %% zz"]);
  });

  it("reads a `%%` after a complete statement as a comment on the document's last line, and refuses it, at its `%%`, on any other", () => {
    // Measured: the class lexer's `%%[^\n]*(\r?\n)*` rules read a comment
    // there and swallow the line break, so the next statement runs on into
    // this one — `A <|-- B %% zz` alone is drawn without its comment, and
    // `A <|-- B %% zz` then `class C` is "Expecting 'NEWLINE', 'EOF' …".
    // The same holds after a relationship with multiplicities, a note, a
    // `cssClass`, a `click`, a `link`, a `callback` and a standalone
    // annotation. Blank lines and whole-line comments below do not count:
    // they are gone before the lexer runs.
    for (const [statement, before] of [
      ["  A <|-- B %% zz", ""],
      ["  A <|-- B%%zz", ""],
      ['  A "1" --> "*" B %% zz', ""],
      ['  note "n" %% zz', "  class A\n"],
      ['  note for A "n" %% zz', "  class A\n"],
      ['  cssClass "A" c %% zz', "  class A\n"],
      ['  click A href "https://x.org" %% zz', "  class A\n"],
      ['  link A "https://x.org" %% zz', "  class A\n"],
      ['  callback A "cb" %% zz', "  class A\n"],
      ["  <<interface>> A %% zz", "  class A\n"],
    ] as const) {
      const line = before === "" ? 2 : 3;
      const column = statement.indexOf("%%") + 1;
      const last = parseSiren(`classDiagram\n${before}${statement}\n\n%% the end\n`);
      const plain = parseSiren(`classDiagram\n${before}${statement.slice(0, column - 1).trimEnd()}\n\n\n`);
      expect([statement, last.diagnostics]).toEqual([statement, []]);
      expect([statement, last.document]).toEqual([statement, plain.document]);

      const notLast = parseSiren(`classDiagram\n${before}${statement}\n  class C`);
      expect([statement, notLast.document]).toEqual([statement, null]);
      expect([statement, notLast.diagnostics]).toEqual([
        statement,
        [{ severity: "error", message: NOT_A_COMMENT, line, column }],
      ]);
    }
  });

  it("reads a `%%` after `direction` as a comment on any line", () => {
    // Measured: `direction LR %% zz` and `direction LR%%zz` followed by
    // `class A` draw left to right with no trace of the comment.
    for (const statement of ["  direction LR %% zz", "  direction LR%%zz"]) {
      const { document, diagnostics } = parseSiren(`classDiagram\n${statement}\n  class A`);
      expect([statement, diagnostics]).toEqual([statement, []]);
      expect([statement, document]).toEqual([statement, parseSiren("classDiagram\n  direction LR\n  class A").document]);
    }
  });

  it("refuses a `%%` after the header, a class declaration, or a block's brace, at its `%%`, on the last line too", () => {
    // Measured: Mermaid refuses each, on the last line or not — the header
    // ("Expecting 'NEWLINE', got 'EOF'" even with nothing below it), a class
    // declaration bare, generic, labelled or with `:::` ("… got 'PCT'"), a
    // class block's closing `}`, and a namespace's opening `{` and closing `}`.
    for (const [body, line] of [
      ["classDiagram %% zz\n  class A", 1],
      ["classDiagram%%zz\n  class A", 1],
      ["classDiagram\n  class A %% zz", 2],
      ["classDiagram\n  class A %% zz\n  class B", 2],
      ["classDiagram\n  class A~T~ %% zz", 2],
      ['classDiagram\n  class A["l"] %% zz', 2],
      ["classDiagram\n  class A:::c %% zz", 2],
      ["classDiagram\n  class A {\n    +int x\n  } %% zz", 4],
      ["classDiagram\n  class A {\n    +int x\n  } %% zz\n  class B", 4],
      ["classDiagram\n  namespace N { %% zz\n    class A\n  }\n  class B", 2],
      ["classDiagram\n  namespace N {\n    class A\n  } %% zz\n  class B", 4],
      ["classDiagram\n  namespace N {\n    class A\n  } %% zz", 4],
    ] as const) {
      const column = body.split("\n")[line - 1]!.indexOf("%%") + 1;
      const { document, diagnostics } = parseSiren(body);
      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: NOT_A_COMMENT, line, column }]]);
    }
  });

  it("reads what follows a class block's `{` on its line as the block's first member, `%%` and all", () => {
    // Measured: `class A { %% zz` then `+int x` and `}` records the members
    // "%% zz" and "+int x" — the block's lexer state reads the rest of the
    // opening line as a member, as it reads `class A { +int x`.
    expect(membersOf(classOk("  class A { %% zz\n    +int x\n  }"))).toEqual(["%% zz", "+int x"]);
    expect(membersOf(classOk("  class A { +int x\n  }"))).toEqual(["+int x"]);
  });

  it("refuses a `%%` after an annotation inside a class block, at its `%%` — Mermaid draws neither the annotation nor the text", () => {
    // Measured: `<<interface>> %% zz` in a block is no annotation to Mermaid
    // but a member, drawn "<> %% zz" — the `<interface>` stripped as a tag.
    // A picture of something the author did not write, with no diagnostic,
    // so Siren refuses it (ADR-0001).
    const { document, diagnostics } = parseSiren("classDiagram\n  class A {\n    <<interface>> %% zz\n    +int x\n  }");
    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message: NOT_A_COMMENT, line: 3, column: 19 }]);
  });
});

/**
 * A class block written on one line, or closed at the end of its last
 * member's line (T4, measured on Mermaid 12.2.0): its block lexer state
 * reads members up to a `}` wherever the `}` stands, so `class A { +int x }`
 * is the class A with the member `+int x`.
 */
describe("parseClassDiagram — a class block closed on a member's line", () => {
  const classOk = (body: string) => parseOk(`classDiagram\n${body}`).document;
  const membersOf = (document: ClassDocument) =>
    document.classes.flatMap((declaration) => declaration.members.map(reconstruct));

  it("reads `class A { +int x }` as the class A with that one member", () => {
    for (const source of ["  class A { +int x }", "  class A {   +int x   }", "  class A { +int x }   "]) {
      const document = classOk(source);
      expect([source, document.classes.map((c) => c.id)]).toEqual([source, ["A"]]);
      expect([source, membersOf(document)]).toEqual([source, ["+int x"]]);
    }
    // Measured: Mermaid reads the method `+foo() : int`.
    expect(membersOf(classOk("  class A { +foo() int }"))).toEqual(["+foo() int"]);
  });

  it("reads an empty one-line block, `class A {}` or `class A { }`, as a class with no members", () => {
    for (const source of ["  class A {}", "  class A{}", "  class A { }", "  class A {    }"]) {
      const document = classOk(source);
      expect([source, document.classes.map((c) => c.id)]).toEqual([source, ["A"]]);
      expect([source, membersOf(document)]).toEqual([source, []]);
    }
  });

  it("keeps the generic, the label and the `:::` style of a one-line block's class", () => {
    const generic = classOk("  class A~T~ { +x }");
    expect(generic.classes.map((c) => [c.id, c.generic])).toEqual([["A", "T"]]);
    expect(membersOf(generic)).toEqual(["+x"]);

    const labelled = classOk('  class A["Lbl"] { +x }');
    expect(labelled.classes.map((c) => c.label?.text ?? null)).toEqual(["Lbl"]);
    expect(membersOf(labelled)).toEqual(["+x"]);

    const styled = classOk("  class A:::c { +x }");
    expect(membersOf(styled)).toEqual(["+x"]);
    expect(styled.styles).toEqual(classOk("  class A:::c").styles);
  });

  it("reads a one-line block's annotation and `%%` text as a multi-line block's", () => {
    // Measured: `class A { <<interface>> }` is annotated, and the block state
    // has no comment rule, so `%% c` is a member.
    expect(classOk("  class A { <<interface>> }").classes.map((c) => c.annotation)).toEqual(["interface", null]);
    expect(membersOf(classOk("  class A { +int x %% c }"))).toEqual(["+int x %% c"]);
    expect(membersOf(classOk("  class A { %% c }"))).toEqual(["%% c"]);
  });

  it("reads a `}` at the end of a member's line as that member, then the block's end", () => {
    // Measured: `class A { +int x` then `+int y }` records both members.
    expect(membersOf(classOk("  class A { +int x\n    +int y }"))).toEqual(["+int x", "+int y"]);
    const document = classOk("  class A {\n    +int x\n    +run(a) int }\n  class B");
    expect(membersOf(document)).toEqual(["+int x", "+run(a) int"]);
    expect(document.classes.map((c) => c.id)).toEqual(["A", "B"]);
    expect(document.classes[0]!.members[1]).toMatchObject({ line: 4, column: 5 });
  });

  it("refuses text after a block's closing `}` on its line, where the text starts", () => {
    // Measured: Mermaid refuses each ("Expecting 'NEWLINE', 'EOF',
    // 'STRUCT_STOP', got 'ALPHA'" for a statement, "… got 'STRUCT_STOP'" for
    // a second `}`).
    const textAfter = (text: string) =>
      `Unexpected text after the "}" that closes class "A": "${text}". ` +
      "Remove it, or start the next statement on a line of its own.";
    for (const [body, line, text] of [
      ["  class A { +int x } class B", 2, "class B"],
      ["  class A {\n    +int x\n    +int y } class B", 4, "class B"],
      ["  class A { +x } }", 2, "}"],
      ["  class A {\n  }}", 3, "}"],
      ["  class A {\n  } class B", 3, "class B"],
    ] as const) {
      const source = `classDiagram\n${body}`;
      const column = source.split("\n")[line - 1]!.lastIndexOf(text) + 1;
      const { document, diagnostics } = parseClassDiagram(source);
      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: textAfter(text), line, column }]]);
    }
  });

  it("refuses a `%%` after a block's `}` on a member's line, at its `%%`", () => {
    // Measured: `class A { +int x } %% c` is "… got 'PCT'", on the last line too.
    const notAComment =
      'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
      "If it is a comment, move it to a line of its own.";
    for (const [body, line] of [
      ["  class A { +int x } %% c", 2],
      ["  class A {\n    +int x } %% c\n  class B", 3],
    ] as const) {
      const source = `classDiagram\n${body}`;
      const column = source.split("\n")[line - 1]!.indexOf("%%") + 1;
      const { document, diagnostics } = parseSiren(source);
      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: notAComment, line, column }]]);
    }
  });

  it("refuses a member on the line after a block's `}`, naming the class and the `}` that closed it", () => {
    // Measured: `class A { +int x }` then `+int y` is "… got 'PLUS'".
    const outside = (closedOn: number) =>
      `Member "+int y" is outside class "A": the "}" on line ${closedOn} already closed its block. ` +
      'Move the "}" below the class\'s last member.';
    for (const [body, closedOn] of [
      ["  class A { +int x }\n  +int y", 2],
      ["  class A {\n    +int x }\n    +int y", 3],
      ["  class A {\n    +int x\n  }\n\n    +int y", 4],
    ] as const) {
      const source = `classDiagram\n${body}`;
      const lines = source.split("\n");
      const line = lines.length;
      const column = lines[line - 1]!.indexOf("+") + 1;
      const { document, diagnostics } = parseClassDiagram(source);
      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: outside(closedOn), line, column }]]);
    }
    // Not after a block, the line is unrecognized as before.
    expect(parseClassDiagram("classDiagram\n  class A\n  +int y").diagnostics).toEqual([
      { severity: "error", message: 'Unrecognized classDiagram line: "+int y"', line: 3, column: 3 },
    ]);
  });

  it("refuses members run together with `;`, which Mermaid draws as one member, saying to write one per line", () => {
    // Measured: `class A { +int x; +foo() }` records the single method
    // `+int x; +foo()` — a picture of neither member, with no diagnostic
    // (ADR-0001); `+a; +b` is the one attribute `+a; +b`. A multi-line
    // block's `+int x; +foo()` is read the same way.
    const separated = (text: string) =>
      `Unrecognized class member: "${text}". A ";" does not separate members: write each member on a line of its own.`;
    for (const [body, text, line] of [
      ["  class A { +int x; +foo() }", "+int x; +foo()", 2],
      ["  class A {\n    +int x; +foo()\n  }", "+int x; +foo()", 3],
      ["  class A { +a; +b }", "+a; +b", 2],
    ] as const) {
      const source = `classDiagram\n${body}`;
      const column = source.split("\n")[line - 1]!.indexOf(text) + 1;
      const { document, diagnostics } = parseClassDiagram(source);
      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: separated(text), line, column }]]);
    }
  });

  it("refuses a `;` between members even where the text reads as one member", () => {
    // Measured: Mermaid draws `+foo(); +bar()` as the one method
    // `+foo(); +bar()`, `+int x; int y` and `+int x; y` as one attribute
    // each, and `+foo() int; x` as the method `+foo() : int; x` — in a
    // one-line and a multi-line block alike, with no diagnostic. The author
    // wrote two members, so each is refused (ADR-0001).
    const separated = (text: string) =>
      `Unrecognized class member: "${text}". A ";" does not separate members: write each member on a line of its own.`;
    for (const [body, text, line] of [
      ["  class A { +foo(); +bar() }", "+foo(); +bar()", 2],
      ["  class A { +int x; int y }", "+int x; int y", 2],
      ["  class A {\n    +int x; int y\n  }", "+int x; int y", 3],
      ["  class A {\n    +int x; y\n  }", "+int x; y", 3],
      ["  class A {\n    +foo() int; x }", "+foo() int; x", 3],
    ] as const) {
      const source = `classDiagram\n${body}`;
      const column = source.split("\n")[line - 1]!.indexOf(text) + 1;
      const { document, diagnostics } = parseClassDiagram(source);
      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: separated(text), line, column }]]);
    }
  });

  it("does not call a `;` ending a member a separator: only one with a member after it", () => {
    // Measured: Mermaid draws `+int x;` as the one attribute `+int x;`, a
    // single member as written. Siren cannot read a name ending in `;` and
    // has refused it since before T4, but nothing follows the `;`, so the
    // error says only that it is unrecognized.
    for (const [body, line] of [
      ["  class A {\n    +int x;\n  }", 3],
      ["  class A { +int x; }", 2],
      ["  class A { +int x;   }", 2],
    ] as const) {
      const source = `classDiagram\n${body}`;
      const column = source.split("\n")[line - 1]!.indexOf("+") + 1;
      expect([body, parseClassDiagram(source).diagnostics]).toEqual([
        body,
        [{ severity: "error", message: 'Unrecognized class member: "+int x;"', line, column }],
      ]);
    }
  });

  it("still reads a `;` inside a method's parentheses or a `~generic~`", () => {
    // Measured: Mermaid reads `+foo(a; b)` as the method foo with the
    // parameters `a; b`, and `List~int; x~ y` as the attribute
    // `List<int; x> y` — what was written, so nothing is refused.
    expect(membersOf(classOk("  class A {\n    +foo(a; b)\n    List~int; x~ y\n  }"))).toEqual([
      "+foo(a; b)",
      "List~int; x~ y",
    ]);
  });

  it("reads a one-line block inside a namespace, and beside other statements", () => {
    const document = classOk("  namespace N {\n    class A { +int x }\n  }\n  class B { }\n  A <|-- B");
    expect(document.namespaces.map((n) => n.classIds)).toEqual([["A"]]);
    expect(membersOf(document)).toEqual(["+int x"]);
    expect(document.relationships).toHaveLength(1);
  });
});

/**
 * A `namespace` block written on one line (T8, measured on Mermaid 12.2.0):
 * the text after its `{` is the body's first statement, and a `}` closes
 * the namespace wherever it stands — the rule T4 gave a class block.
 */
describe("parseClassDiagram — a namespace block written on one line", () => {
  const classOk = (body: string) => parseOk(`classDiagram\n${body}`).document;
  const namespacesOf = (document: ClassDocument) => document.namespaces.map((n) => [n.id, n.classIds]);
  const membersOf = (document: ClassDocument, id: string) =>
    document.classes.filter((c) => c.id === id).flatMap((c) => c.members.map(reconstruct));
  const refused = (body: string) => {
    const { document, diagnostics } = parseClassDiagram(`classDiagram\n${body}`);
    expect([body, document]).toEqual([body, null]);
    return diagnostics;
  };

  it("reads `namespace N { class A }` as the namespace N holding the class A", () => {
    // Measured: each spelling draws the cluster N around A.
    for (const body of [
      "  namespace N { class A }",
      "  namespace N {class A}",
      "  namespace N{ class A }",
      "  namespace N {   class A   }   ",
    ]) {
      const document = classOk(body);
      expect([body, namespacesOf(document)]).toEqual([body, [["N", ["A"]]]]);
      expect([body, document.classes.map((c) => [c.id, c.line, c.column])]).toEqual([
        body,
        [["A", 2, `classDiagram\n${body}`.split("\n")[1]!.indexOf("class") + 1]],
      ]);
    }
    // The namespace's label and the class's generic, label and `:::` are kept.
    const labelled = classOk('  namespace N["L"] { class A~T~ }');
    expect(labelled.namespaces.map((n) => n.label?.text ?? null)).toEqual(["L"]);
    expect(labelled.classes.map((c) => c.generic)).toEqual(["T"]);
    expect(classOk('  namespace N { class A["Lbl"] }').classes.map((c) => c.label?.text ?? null)).toEqual(["Lbl"]);
    const stylesOf = (document: ClassDocument) => document.styles.map((s) => [s.styleKind, s.targetIds, s.name]);
    expect(stylesOf(classOk("  namespace N { class A:::c }"))).toEqual(stylesOf(classOk("  class A:::c")));
    // Beside other statements, and twice in a row.
    const two = classOk("  namespace N { class A }\n  namespace M { class B }\n  class C\n  A <|-- C");
    expect(namespacesOf(two)).toEqual([["N", ["A"]], ["M", ["B"]]]);
    expect(two.relationships).toHaveLength(1);
  });

  it("reads a one-line class block inside a one-line namespace", () => {
    // Measured: `{ +x } }`, `{ +x }}` and `{}}` each close the class, then the namespace.
    for (const [body, members] of [
      ["  namespace N { class A { +x } }", ["+x"]],
      ["  namespace N { class A { +x }}", ["+x"]],
      ["  namespace N { class A {} }", []],
      ["  namespace N { class A {}}", []],
    ] as const) {
      const document = classOk(body);
      expect([body, namespacesOf(document)]).toEqual([body, [["N", ["A"]]]]);
      expect([body, membersOf(document, "A")]).toEqual([body, members]);
    }
  });

  it("closes the namespace at a `}` on a later line, alone or after that line's statement", () => {
    // Measured: each draws the cluster N around every class named, and a
    // statement after the namespace stands outside it.
    for (const [body, ids] of [
      ["  namespace N { class A\n  }\n  class B", ["A"]],
      ["  namespace N { class A\n    class B }\n  class C", ["A", "B"]],
      ["  namespace N {\n    class A }\n  class B", ["A"]],
      ["  namespace N {\n    class A\n    class B { +x } }", ["A", "B"]],
      ["  namespace N { class A {\n    +x\n  }\n  }", ["A"]],
    ] as const) {
      expect([body, namespacesOf(classOk(body))]).toEqual([body, [["N", ids]]]);
    }
  });

  it("reads a `}` after a block's own `}` as closing the namespace around it, nested too", () => {
    // Measured: each draws A inside M inside N (or inside N alone), the
    // `}`s after the innermost one closing the namespaces around it in turn.
    // N is recorded first, as the parent of `N.M`.
    for (const [body, namespaces] of [
      ["  namespace N { namespace M { class A } }", [["N", []], ["N.M", ["A"]]]],
      ["  namespace N { namespace M { class A }}", [["N", []], ["N.M", ["A"]]]],
      ["  namespace N { namespace M { class A {}}}", [["N", []], ["N.M", ["A"]]]],
      ["  namespace N { class A {\n    +x\n  } }", [["N", ["A"]]]],
      ["  namespace N { class A {\n    +x }}", [["N", ["A"]]]],
      ["  namespace N {\n    namespace M {\n      class A\n    } }", [["N", []], ["N.M", ["A"]]]],
      ["  namespace N {\n    namespace M { class A {\n      +x } } }\n  class B", [["N", []], ["N.M", ["A"]]]],
    ] as const) {
      const document = classOk(body);
      expect([body, namespacesOf(document)]).toEqual([body, namespaces]);
      expect([body, document.namespaces.map((n) => n.parentId ?? null)]).toEqual([
        body,
        namespaces.length === 2 ? [null, "N"] : [null],
      ]);
      expect([body, membersOf(document, "A")]).toEqual([body, body.includes("+x") ? ["+x"] : []]);
    }
  });

  it("refuses text after a namespace's `}` on its line, where the text starts", () => {
    // Measured: Mermaid refuses each — a statement ("… got 'ALPHA'"), a `}`
    // closing nothing (a lexical error) and a `%%` ("… got 'PCT'").
    const textAfter = (text: string) =>
      `Unexpected text after the "}" that closes namespace "N": "${text}". ` +
      "Remove it, or start the next statement on a line of its own.";
    for (const [body, line, text] of [
      ["  namespace N { class A } class B", 2, "class B"],
      ["  namespace N {\n    class A\n  } class B", 4, "class B"],
      ["  namespace N { class A { +x } } class B", 2, "class B"],
      ["  namespace N { class A }}", 2, "}"],
      ["  namespace N {\n    class A\n  }}", 4, "}"],
    ] as const) {
      const column = `classDiagram\n${body}`.split("\n")[line - 1]!.lastIndexOf(text) + 1;
      expect([body, refused(body)]).toEqual([body, [{ severity: "error", message: textAfter(text), line, column }]]);
    }
    const notAComment =
      'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
      "If it is a comment, move it to a line of its own.";
    for (const body of ["  namespace N { class A } %% c", "  namespace N { class A { +x } } %% c"]) {
      expect([body, refused(body)]).toEqual([body, [{ severity: "error", message: notAComment, line: 2, column: body.indexOf("%%") + 1 }]]);
    }
  });

  it("refuses text after the `}`s closing a block and its namespace, as after the namespace's `}`", () => {
    // Measured: `class A {` ⏎ `+x` ⏎ `}} class B` is "… got 'ALPHA'",
    // `}} %% c` "… got 'PCT'" and `+x }}}` a lexical error — each the
    // one-line namespace's refusal, so each is one error after N's `}`.
    const textAfter = (text: string) =>
      `Unexpected text after the "}" that closes namespace "N": "${text}". ` +
      "Remove it, or start the next statement on a line of its own.";
    const notAComment =
      'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
      "If it is a comment, move it to a line of its own.";
    for (const [body, line, text, message] of [
      ["  namespace N { class A {\n    +x\n  }} class B", 4, "class B", textAfter("class B")],
      ["  namespace N { class A {\n    +x }}}", 3, "}", textAfter("}")],
      ["  namespace N { class A {\n    +x\n  }} %% c", 4, "%%", notAComment],
    ] as const) {
      const column = `classDiagram\n${body}`.split("\n")[line - 1]!.lastIndexOf(text) + 1;
      expect([body, refused(body)]).toEqual([body, [{ severity: "error", message, line, column }]]);
    }
  });

  it("refuses a `%%` after the namespace's `{`, at the `%%`", () => {
    // Measured: `namespace N { %% x` is "… got 'PCT'": no comment there, so
    // the line opens no namespace for its text to be read in (the
    // lookahead in `NAMESPACE_OPEN_RE`) and is refused at the `%%`.
    const notAComment =
      'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
      "If it is a comment, move it to a line of its own.";
    expect(refused("  namespace N { %% x\n    class A\n  }")).toEqual([
      { severity: "error", message: notAComment, line: 2, column: 17 },
    ]);
  });

  it("refuses an empty namespace, on one line or two", () => {
    // Measured: `namespace N {}`, `namespace N { }` and `namespace N {` ⏎ `}`
    // are each "Expecting 'NEWLINE', 'NAMESPACE', 'CLASS', 'NOTE_FOR',
    // 'NOTE', got 'STRUCT_STOP'".
    const empty =
      'Empty "namespace N" block: a namespace needs at least one statement inside it. ' +
      "Add a class to it, or remove the namespace.";
    for (const body of ["  namespace N {}", "  namespace N { }", "  namespace N {\n  }", "  class A\n  namespace N {\n\n  }"]) {
      const line = `classDiagram\n${body}`.split("\n").findIndex((l) => l.includes("namespace")) + 1;
      expect([body, refused(body)]).toEqual([body, [{ severity: "error", message: empty, line, column: 3 }]]);
    }
  });

  it("refuses two class statements on the namespace's line, as it refuses them on any line", () => {
    // Measured: Mermaid draws one class `AclassB` for `class A class B`, here
    // and at the top level alike.
    expect(refused("  namespace N { class A class B }")).toEqual([
      { severity: "error", message: 'Unrecognized classDiagram line: "class A class B"', line: 2, column: 17 },
    ]);
  });
});

/**
 * A `namespace` block inside another (measured on Mermaid 12.2.0, spec
 * `class-nested-namespaces`): each block is recorded under its qualified name
 * — the enclosing block's qualified name, a `.`, its own — with the qualified
 * name of the block around it, in the order the blocks open.
 */
describe("parseClassDiagram — nested namespace blocks", () => {
  const classOk = (body: string) => parseOk(`classDiagram\n${body}`).document;
  const nestingOf = (document: ClassDocument) =>
    document.namespaces.map((n) => [n.id, n.parentId ?? null, n.classIds]);

  it("records a namespace written inside another on lines of their own under its qualified name, outer first", () => {
    // Measured: the cluster N around the cluster `N.M` around A, and a class
    // beside the inner block is the outer one's.
    expect(nestingOf(classOk("  namespace N {\n    namespace M {\n      class A\n    }\n  }"))).toEqual([
      ["N", null, []],
      ["N.M", "N", ["A"]],
    ]);
    expect(nestingOf(classOk("  namespace N {\n    class X\n    namespace M {\n      class A\n    }\n  }"))).toEqual([
      ["N", null, ["X"]],
      ["N.M", "N", ["A"]],
    ]);
    // Three levels, and two siblings, each opening in turn.
    expect(
      nestingOf(classOk("  namespace N {\n    namespace M {\n      namespace L {\n        class A\n      }\n    }\n  }")),
    ).toEqual([
      ["N", null, []],
      ["N.M", "N", []],
      ["N.M.L", "N.M", ["A"]],
    ]);
    expect(
      nestingOf(classOk("  namespace N {\n    namespace M {\n      class A\n    }\n    namespace K {\n      class B\n    }\n  }")),
    ).toEqual([
      ["N", null, []],
      ["N.M", "N", ["A"]],
      ["N.K", "N", ["B"]],
    ]);
  });

  it("records a namespace written inside another on one line the same way", () => {
    // Measured: `namespace N { namespace M { class A } }` draws what the
    // multi-line spelling draws.
    for (const body of [
      "  namespace N { namespace M { class A } }",
      "  namespace N { namespace M { class A }}",
      "  namespace N { class X\n    namespace M { class A } }",
    ]) {
      expect([body, nestingOf(classOk(body))]).toEqual([
        body,
        [
          ["N", null, body.includes("X") ? ["X"] : []],
          ["N.M", "N", ["A"]],
        ],
      ]);
    }
  });

  it("keeps a top-level namespace apart from one of the same name written inside another", () => {
    // Measured: two frames, `M` and `N.M`.
    expect(nestingOf(classOk("  namespace N {\n    namespace M {\n      class A\n    }\n  }\n  namespace M {\n    class B\n  }"))).toEqual([
      ["N", null, []],
      ["N.M", "N", ["A"]],
      ["M", null, ["B"]],
    ]);
  });

  it("keeps each block's own label", () => {
    const document = classOk('  namespace N["Outer"] {\n    namespace M["Inner"] {\n      class A\n    }\n  }');
    expect(document.namespaces.map((n) => [n.id, n.label?.text ?? null])).toEqual([
      ["N", "Outer"],
      ["N.M", "Inner"],
    ]);
  });
});
