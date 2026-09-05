import { describe, expect, it } from "vitest";
import { parseClassDiagram } from "./parseClassDiagram";
import type { ClassDocument, ClassMember, Diagnostic } from "../contracts";

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
function parseOk(source: string): { document: ClassDocument; diagnostics: Diagnostic[] } {
  const { document, diagnostics } = parseClassDiagram(source);
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
        label: "places",
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
      { id: "BaseShapes", classIds: ["Triangle", "Square"], line: 2, column: 3 },
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
        text: "This diagram is a work in progress",
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
        text: "can fly, can swim",
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
        classId: "Shape",
        action: "https://example.com",
        argument: null,
        tooltip: null,
        line: 3,
        column: 3,
      },
      {
        interactionKind: "href",
        classId: "Other",
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
        classId: "Shape",
        action: "callbackFn",
        argument: null,
        tooltip: null,
        line: 2,
        column: 3,
      },
      {
        interactionKind: "call",
        classId: "Other",
        action: "callbackFn",
        argument: "arg",
        tooltip: null,
        line: 3,
        column: 3,
      },
      {
        interactionKind: "call",
        classId: "Third",
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

  it("parses a timeline: block into the same entry shape the flowchart parser produces", () => {
    const source = `classDiagram
  Animal <|-- Duck
timeline:
step 1: enter Animal fade
step 2: enter Duck slide-left, enter Animal-Duck fade
step 3: highlight Duck glow
step 4: unhighlight Duck
step 5: exit Animal slide-top
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
step 1: enter namespace:1 fade
step 2: enter note:1 fade
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
step 1: wibble Animal fade
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
