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
    expect(document.classes).toHaveLength(1);
    expect(document.classes[0].id).toBe("Shape");
    expect(document.classes[0].annotation).toBe("interface");
    expect(document.classes[0].members.map((m) => m.name)).toEqual(["sides", "draw"]);
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
});
