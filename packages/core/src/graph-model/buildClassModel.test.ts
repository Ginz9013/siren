import { describe, expect, it } from "vitest";
import type { ClassDecl, ClassDocument, ClassMember, ClassRelationship, Label } from "../contracts";
import { plainLabel, plainRun } from "../label/label";
import { parseClassDiagram } from "../parser/parseClassDiagram";
import { buildClassModel } from "./buildClassModel";

/** A label of these rows, each one plain run — what `a<br/>b` reads as. */
const rowsLabel = (...rows: string[]): Label => ({
  text: rows.join("\n"),
  rows: rows.map((row) => [plainRun(row)]),
});

/**
 * A `ClassDocument` with everything empty, so each test states only the
 * declarations it is about. Hand-built rather than parsed: `buildClassModel`
 * is a pure function over the document shape, and the parser is a separate
 * seam with its own tests.
 */
function classDocument(overrides: Partial<ClassDocument> = {}): ClassDocument {
  return {
    accTitle: null,
    accDescr: null,
    kind: "class",
    direction: "TB",
    classes: [],
    relationships: [],
    namespaces: [],
    notes: [],
    interactions: [],
    styles: [],
    timeline: null,
    ...overrides,
  };
}

/** A `ClassDecl` with the fields a test does not care about defaulted. */
function classDecl(overrides: Partial<ClassDecl> & { id: string }): ClassDecl {
  return { generic: null, annotation: null, label: null, members: [], ...overrides };
}

/** An attribute member, `+int size` by default. */
function attribute(overrides: Partial<ClassMember> & { name: string }): ClassMember {
  return {
    memberKind: "attribute",
    visibility: "+",
    classifier: null,
    type: "int",
    parameters: null,
    returnType: null,
    ...overrides,
  };
}

/** A method member, `+name() bool` by default. */
function method(overrides: Partial<ClassMember> & { name: string }): ClassMember {
  return {
    memberKind: "method",
    visibility: "+",
    classifier: null,
    type: null,
    parameters: "",
    returnType: "bool",
    ...overrides,
  };
}

/** A relationship with the inheritance form `from <|-- to` by default. */
function relationship(
  overrides: Partial<ClassRelationship> & { from: string; to: string },
): ClassRelationship {
  return {
    line: "solid",
    fromEnd: "triangle",
    toEnd: "none",
    label: null,
    fromMultiplicity: null,
    toMultiplicity: null,
    ...overrides,
  };
}

describe("buildClassModel", () => {
  it("resolves a class declaration into one class carrying its members verbatim", () => {
    const size = attribute({ name: "size" });
    const swim = method({ name: "swim" });

    const { model, diagnostics } = buildClassModel(
      classDocument({
        direction: "TB",
        classes: [classDecl({ id: "Animal", members: [size, swim] })],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.direction).toBe("TB");
    expect(model.classes).toEqual([
      {
        id: "Animal",
        generic: null,
        annotation: null,
        label: null,
        members: [size, swim],
        namespaceId: null,
      },
    ]);
  });

  it("merges repeat declarations of one id into a single class whose members are the union in declaration order", () => {
    // What the parser hands over for:
    //   Animal <|-- Duck
    //   Animal : +int age
    //   class Animal {
    //     +swim() bool
    //   }
    // — one ClassDecl per mention, implicit or explicit, so "Animal" arrives
    // three times: once from the relationship, once from the inline member,
    // once from the block.
    const age = attribute({ name: "age" });
    const swim = method({ name: "swim" });

    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Animal" }),
          classDecl({ id: "Duck" }),
          classDecl({ id: "Animal", members: [age] }),
          classDecl({ id: "Animal", members: [swim] }),
        ],
        relationships: [relationship({ from: "Animal", to: "Duck" })],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(model.classes[0].members).toEqual([age, swim]);
    expect(model.classes[1].members).toEqual([]);
  });

  it("unions rather than concatenates, so a member written twice appears once", () => {
    // What the parser hands over for:
    //   Animal : +int age
    //   Animal : +int age
    // Two declarations, each carrying its own copy of the same member line.
    // The merge is a union: a class that renders "+int age" twice is never
    // what the author meant.
    const firstAge = attribute({ name: "age", line: 2, column: 1 });
    const secondAge = attribute({ name: "age", line: 3, column: 1 });

    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Animal", members: [firstAge] }),
          classDecl({ id: "Animal", members: [secondAge] }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes).toHaveLength(1);
    expect(model.classes[0].members).toEqual([firstAge]);
  });

  it("treats members differing in any rendered part as distinct when unioning", () => {
    // Same name, different visibility / type / parameters / return type /
    // classifier: each renders as its own line, so each survives the union.
    const publicAge = attribute({ name: "age", visibility: "+" });
    const privateAge = attribute({ name: "age", visibility: "-" });
    const stringAge = attribute({ name: "age", visibility: "+", type: "String" });
    const swim = method({ name: "swim" });
    const swimFar = method({ name: "swim", parameters: "int distance" });
    const swimVoid = method({ name: "swim", returnType: null });
    const swimAbstract = method({ name: "swim", classifier: "*" });

    const { model } = buildClassModel(
      classDocument({
        classes: [
          classDecl({
            id: "Animal",
            members: [publicAge, privateAge, stringAge, swim, swimFar, swimVoid, swimAbstract],
          }),
          classDecl({ id: "Animal", members: [swim] }),
        ],
      }),
    );

    expect(model.classes[0].members).toEqual([
      publicAge,
      privateAge,
      stringAge,
      swim,
      swimFar,
      swimVoid,
      swimAbstract,
    ]);
  });

  it("keeps an annotation carried by a later declaration than the one that introduced the class", () => {
    // The implicit declaration a relationship makes comes first and carries
    // none, so taking the first declaration's values wholesale would throw
    // away the explicit `class Shape { <<interface>> }`.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" }), classDecl({ id: "Shape", annotation: "interface" })],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes).toHaveLength(1);
    expect(model.classes[0].annotation).toBe("interface");
  });

  it("refuses a generic given after the class was first named without one", () => {
    // Measured on Mermaid 12.2.0 (Chrome): a class keeps what its first
    // naming gave it, generic-less included — `class A` then `class A~T~`,
    // `A --> C` then `class A~T~`, `A : +x` then `class A~T~`, `class A~~`
    // then `class A~T~`, `namespace N { class A }` then `class A~T~`, and
    // `class A` then `A~T~ --> B` each draw `A`, the `T` gone with no
    // diagnostic. A picture other than the one written, refused (ADR-0001).
    const message = (line: number) =>
      `Class "A" gets the generic "T" here, but it was first named on line ${line} without one, ` +
      'and a class keeps what its first naming gave it. Write "~T~" where "A" is first named.';
    for (const [source, line, column, first] of [
      ["classDiagram\n  class A\n  class A~T~", 3, 3, 2],
      ["classDiagram\n  A --> C\n  class A~T~", 3, 3, 2],
      ["classDiagram\n  A : +x\n  class A~T~", 3, 3, 2],
      ["classDiagram\n  class A~~\n  class A~T~", 3, 3, 2],
      ["classDiagram\n  namespace N {\n    class A\n  }\n  class A~T~", 5, 3, 3],
      ["classDiagram\n  class A\n  A~T~ --> B", 3, 3, 2],
    ] as const) {
      const parsed = parseClassDiagram(source);
      if (parsed.document === null || parsed.document.kind !== "class") throw new Error(source);
      expect([source, parsed.diagnostics]).toEqual([source, []]);
      const { model, diagnostics } = buildClassModel(parsed.document);
      expect([source, diagnostics]).toEqual([source, [{ severity: "error", message: message(first), line, column }]]);
      expect(model.classes.find((c) => c.id === "A")!.generic).toBeNull();
    }
  });

  it("keeps the first generic a class was named with, warning about a different later one in any order", () => {
    // Measured on Mermaid 12.2.0 (Chrome): `class A~T~` then `A~U~ --> B`,
    // and `A~T~ --> B` then `A~U~ --> C`, draw `A<T>`; `A~U~ --> B` then
    // `class A~T~` draws `A<U>`; `A~T~ --> B` then `class A` draws `A<T>`.
    const conflict = (kept: string, dropped: string, line: number) => ({
      severity: "warning",
      message: `Class "A" is declared with conflicting generics ("${kept}" vs. "${dropped}"); keeping the first-seen generic.`,
      line,
      column: 3,
    });
    for (const [source, generic, warnings] of [
      ["classDiagram\n  class A~T~\n  A~U~ --> B", "T", [conflict("T", "U", 3)]],
      ["classDiagram\n  A~T~ --> B\n  A~U~ --> C", "T", [conflict("T", "U", 3)]],
      ["classDiagram\n  A~U~ --> B\n  class A~T~", "U", [conflict("U", "T", 3)]],
      ["classDiagram\n  A~T~ --> B\n  A~T~ --> C\n  class A", "T", []],
    ] as const) {
      const parsed = parseClassDiagram(source);
      if (parsed.document === null || parsed.document.kind !== "class") throw new Error(source);
      expect([source, parsed.diagnostics]).toEqual([source, []]);
      const { model, diagnostics } = buildClassModel(parsed.document);
      expect([source, diagnostics]).toEqual([source, warnings]);
      expect(model.classes.find((c) => c.id === "A")!.generic).toBe(generic);
    }
  });

  it("warns and keeps the first annotation when two declarations of one class annotate it differently", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Shape", annotation: "interface", line: 2, column: 1 }),
          classDecl({ id: "Shape", annotation: "abstract", line: 5, column: 1 }),
        ],
      }),
    );

    expect(model.classes).toHaveLength(1);
    expect(model.classes[0].annotation).toBe("interface");
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'Class "Shape" is declared with conflicting annotations ("interface" vs. "abstract"); keeping the first-seen annotation.',
        line: 5,
        column: 1,
      },
    ]);
  });

  it("resolves each namespace to a stable namespace:n id carrying its declared name and member ids", () => {
    // What the parser hands over for:
    //   namespace BaseShapes {
    //     class Triangle
    //     class Square
    //   }
    //   namespace Widgets {
    //     class Button
    //   }
    // — the member classes are ordinary declarations too, and the namespace
    // records only the grouping.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Triangle" }),
          classDecl({ id: "Square" }),
          classDecl({ id: "Button" }),
        ],
        namespaces: [
          { id: "BaseShapes", name: "BaseShapes", parentId: null, label: null, classIds: ["Triangle", "Square"], noteIndexes: [] },
          { id: "Widgets", name: "Widgets", parentId: null, label: null, classIds: ["Button"], noteIndexes: [] },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.namespaces).toEqual([
      { id: "namespace:1", parentId: null, label: plainLabel("BaseShapes"), classIds: ["Triangle", "Square"], noteIds: [] },
      { id: "namespace:2", parentId: null, label: plainLabel("Widgets"), classIds: ["Button"], noteIds: [] },
    ]);
    expect(model.classes.map((c) => [c.id, c.namespaceId])).toEqual([
      ["Triangle", "namespace:1"],
      ["Square", "namespace:1"],
      ["Button", "namespace:2"],
    ]);
  });

  it("errors and keeps the first namespace when two of them name the same class", () => {
    // A class belongs to at most one namespace: a frame cannot enclose a box
    // that another frame also encloses. The first claim wins, and the second
    // namespace neither lists the class nor takes it from the first.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" }), classDecl({ id: "Square" })],
        namespaces: [
          { id: "BaseShapes", name: "BaseShapes", parentId: null, label: null, classIds: ["Triangle", "Square"], noteIndexes: [], line: 2, column: 1 },
          { id: "Widgets", name: "Widgets", parentId: null, label: null, classIds: ["Triangle"], noteIndexes: [], line: 7, column: 1 },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Class "Triangle" is named by more than one namespace ("BaseShapes" and "Widgets"), and a class can sit in only one; keeping it in "BaseShapes". ' +
          'Name it in only one of the namespaces.',
        line: 7,
        column: 1,
      },
    ]);
    expect(model.namespaces).toEqual([
      { id: "namespace:1", parentId: null, label: plainLabel("BaseShapes"), classIds: ["Triangle", "Square"], noteIds: [] },
      { id: "namespace:2", parentId: null, label: plainLabel("Widgets"), classIds: [], noteIds: [] },
    ]);
    expect(model.classes.map((c) => c.namespaceId)).toEqual(["namespace:1", "namespace:1"]);
  });

  it("gives a nested namespace the generated id of the namespace around it as its parentId", () => {
    // What the parser hands over for:
    //   namespace N {
    //     class X
    //     namespace M {
    //       class A
    //     }
    //   }
    //   namespace M {
    //     class B
    //   }
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "X" }), classDecl({ id: "A" }), classDecl({ id: "B" })],
        namespaces: [
          { id: "N", name: "N", parentId: null, label: null, classIds: ["X"], noteIndexes: [] },
          { id: "N.M", name: "M", parentId: "N", label: null, classIds: ["A"], noteIndexes: [] },
          { id: "M", name: "M", parentId: null, label: null, classIds: ["B"], noteIndexes: [] },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.namespaces.map((n) => [n.id, n.parentId])).toEqual([
      ["namespace:1", null],
      ["namespace:2", "namespace:1"],
      ["namespace:3", null],
    ]);
  });

  it("numbers namespaces in the order they open, outer before inner, each labelled by its own name", () => {
    // The parser lists blocks as they open, so `namespace N { namespace M {
    // namespace L { class A } } }` is N, `N.M`, `N.M.L`: the outermost is
    // `namespace:1`, as a flowchart's outer subgraph is `subgraph:1`.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "A" })],
        namespaces: [
          { id: "N", name: "N", parentId: null, label: null, classIds: [], noteIndexes: [] },
          { id: "N.M", name: "M", parentId: "N", label: null, classIds: [], noteIndexes: [] },
          { id: "N.M.L", name: "L", parentId: "N.M", label: null, classIds: ["A"], noteIndexes: [] },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.namespaces).toEqual([
      { id: "namespace:1", parentId: null, label: plainLabel("N"), classIds: [], noteIds: [] },
      { id: "namespace:2", parentId: "namespace:1", label: plainLabel("M"), classIds: [], noteIds: [] },
      { id: "namespace:3", parentId: "namespace:2", label: plainLabel("L"), classIds: ["A"], noteIds: [] },
    ]);
    expect(model.classes.map((c) => [c.id, c.namespaceId])).toEqual([["A", "namespace:3"]]);
  });

  it("errors when a class is named by a namespace and by one nested in it, naming the two in source order", () => {
    // `namespace N { class A; namespace M { class A } }`: one box cannot sit
    // in two frames, and the outer block is written first.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "A" })],
        namespaces: [
          { id: "N", name: "N", parentId: null, label: null, classIds: ["A"], noteIndexes: [], line: 2, column: 1 },
          { id: "N.M", name: "M", parentId: "N", label: null, classIds: ["A"], noteIndexes: [], line: 4, column: 3 },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Class "A" is named by more than one namespace ("N" and "N.M"), and a class can sit in only one; keeping it in "N". ' +
          'Name it in only one of the namespaces.',
        line: 4,
        column: 3,
      },
    ]);
    expect(model.classes.map((c) => c.namespaceId)).toEqual(["namespace:1"]);
  });

  /**
   * A namespace opened again under the same qualified name (measured on
   * Mermaid 12.2.0, spec `class-nested-namespaces`): one frame holding every
   * block's classes, numbered where it first opened.
   */
  describe("a namespace opened more than once", () => {
    const ns = (
      id: string,
      classIds: string[],
      extra: { parentId?: string; label?: Label; line?: number } = {},
    ) => ({
      id,
      name: id.slice(id.lastIndexOf(".") + 1),
      parentId: extra.parentId ?? null,
      label: extra.label ?? null,
      classIds,
      noteIndexes: [],
      ...(extra.line === undefined ? {} : { line: extra.line, column: 1 }),
    });

    it("merges two blocks of one namespace into one, holding both blocks' classes", () => {
      // `namespace N { class X }` ⏎ `namespace N { class Y }`: measured, one
      // frame N around X and Y.
      const { model, diagnostics } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "X" }), classDecl({ id: "Y" })],
          namespaces: [ns("N", ["X"]), ns("N", ["Y"])],
        }),
      );

      expect(diagnostics).toEqual([]);
      expect(model.namespaces).toEqual([
        { id: "namespace:1", parentId: null, label: plainLabel("N"), classIds: ["X", "Y"], noteIds: [] },
      ]);
      expect(model.classes.map((c) => [c.id, c.namespaceId])).toEqual([
        ["X", "namespace:1"],
        ["Y", "namespace:1"],
      ]);
    });

    it("merges a nested namespace opened again inside its reopened parent", () => {
      // `N { M { A } }` ⏎ `N { M { B } }`: measured, one N around one `N.M`
      // around A and B.
      const { model, diagnostics } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "A" }), classDecl({ id: "B" })],
          namespaces: [ns("N", []), ns("N.M", ["A"], { parentId: "N" }), ns("N", []), ns("N.M", ["B"], { parentId: "N" })],
        }),
      );

      expect(diagnostics).toEqual([]);
      expect(model.namespaces).toEqual([
        { id: "namespace:1", parentId: null, label: plainLabel("N"), classIds: [], noteIds: [] },
        { id: "namespace:2", parentId: "namespace:1", label: plainLabel("M"), classIds: ["A", "B"], noteIds: [] },
      ]);
    });

    it("numbers the merged namespace where it first opened, before a namespace opened between its blocks", () => {
      // `N { X }`, `K { Z }`, `N { Y }`: measured, N then K.
      const { model } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "X" }), classDecl({ id: "Z" }), classDecl({ id: "Y" })],
          namespaces: [ns("N", ["X"]), ns("K", ["Z"]), ns("N", ["Y"])],
        }),
      );

      expect(model.namespaces.map((n) => [n.id, n.label.text, n.classIds])).toEqual([
        ["namespace:1", "N", ["X", "Y"]],
        ["namespace:2", "K", ["Z"]],
      ]);
    });

    it("labels the merged namespace with the last label its blocks wrote, or its name when none wrote one", () => {
      // Measured: `N["First"]` then `N["Second"]` is titled Second; `N` then
      // `N["Second"]` Second; `N["First"]` then `N` First.
      const labelOf = (first: Label | undefined, second: Label | undefined) =>
        buildClassModel(
          classDocument({
            classes: [classDecl({ id: "X" }), classDecl({ id: "Y" })],
            namespaces: [ns("N", ["X"], { label: first }), ns("N", ["Y"], { label: second })],
          }),
        ).model.namespaces.map((n) => n.label);

      expect(labelOf(plainLabel("First"), plainLabel("Second"))).toEqual([plainLabel("Second")]);
      expect(labelOf(undefined, plainLabel("Second"))).toEqual([plainLabel("Second")]);
      expect(labelOf(plainLabel("First"), undefined)).toEqual([plainLabel("First")]);
      expect(labelOf(undefined, undefined)).toEqual([plainLabel("N")]);
    });

    it("lets one namespace name a class in two of its blocks without an error", () => {
      // `namespace N { class X }` twice: measured, one frame around one X.
      const { model, diagnostics } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "X" })],
          namespaces: [ns("N", ["X"], { line: 2 }), ns("N", ["X"], { line: 5 })],
        }),
      );

      expect(diagnostics).toEqual([]);
      expect(model.namespaces.map((n) => n.classIds)).toEqual([["X"]]);
      expect(model.classes.map((c) => c.namespaceId)).toEqual(["namespace:1"]);
    });

    it("still errors when a different namespace names a class a reopened one holds", () => {
      const { diagnostics } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "X" })],
          namespaces: [ns("N", ["X"], { line: 2 }), ns("N.M", ["X"], { parentId: "N", line: 3 }), ns("N", ["X"], { line: 6 })],
        }),
      );

      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Class "X" is named by more than one namespace ("N" and "N.M"), and a class can sit in only one; keeping it in "N". ' +
            'Name it in only one of the namespaces.',
          line: 3,
          column: 1,
        },
      ]);
    });
  });

  it("leaves a class outside every namespace with a null namespaceId", () => {
    const { model } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" }), classDecl({ id: "Loose" })],
        namespaces: [{ id: "BaseShapes", name: "BaseShapes", parentId: null, label: null, classIds: ["Triangle"], noteIndexes: [] }],
      }),
    );

    expect(model.classes.map((c) => c.namespaceId)).toEqual(["namespace:1", null]);
  });

  it("creates a class a namespace names but nothing else declares, as a relationship endpoint does", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" })],
        namespaces: [{ id: "BaseShapes", name: "BaseShapes", parentId: null, label: null, classIds: ["Triangle", "Square"], noteIndexes: [] }],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes).toEqual([
      { id: "Triangle", generic: null, annotation: null, label: null, members: [], namespaceId: "namespace:1" },
      { id: "Square", generic: null, annotation: null, label: null, members: [], namespaceId: "namespace:1" },
    ]);
    expect(model.namespaces[0].classIds).toEqual(["Triangle", "Square"]);
  });

  it("resolves a relationship into an id of the form fromId-toId, passing its type, label and multiplicity through unchanged", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Customer" }), classDecl({ id: "Ticket" })],
        relationships: [
          relationship({
            from: "Customer",
            to: "Ticket",
            line: "dashed",
            fromEnd: "diamondFilled",
            toEnd: "arrow",
            label: plainLabel("raises"),
            fromMultiplicity: "1",
            toMultiplicity: "*",
            sourceLine: 3,
            sourceColumn: 1,
          }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.relationships).toEqual([
      {
        id: "Customer-Ticket",
        from: "Customer",
        to: "Ticket",
        line: "dashed",
        fromEnd: "diamondFilled",
        toEnd: "arrow",
        label: plainLabel("raises"),
        fromMultiplicity: "1",
        toMultiplicity: "*",
        fromInterfaceLabel: null,
        toInterfaceLabel: null,
      },
    ]);
  });

  it("suffixes the id of a second relationship between the same pair with #2, as flowchart edges do", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "A" }), classDecl({ id: "B" })],
        relationships: [
          relationship({ from: "A", to: "B" }),
          relationship({ from: "A", to: "B", line: "dashed" }),
          relationship({ from: "B", to: "A" }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.relationships.map((r) => r.id)).toEqual(["A-B", "A-B#2", "B-A"]);
  });

  it("resolves a relationship whose endpoint has no declaration at all, creating that class", () => {
    // Defensive only: the parser declares every class a relationship names,
    // so a document reaching here is never missing one. This covers
    // hand-built documents and future callers — it is not where implicit
    // declaration lives.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        relationships: [relationship({ from: "Animal", to: "Duck" })],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes.map((c) => c.id)).toEqual(["Duck", "Animal"]);
    expect(model.classes[1]).toEqual({
      id: "Animal",
      generic: null,
      annotation: null,
      label: null,
      members: [],
      namespaceId: null,
    });
    expect(model.relationships.map((r) => r.id)).toEqual(["Animal-Duck"]);
  });

  it("resolves a lollipop end into a synthetic node id and its interface label, without creating a class for it", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Quacks" })],
        relationships: [relationship({ from: "Duck", to: "Quacks", fromEnd: "circle" })],
      }),
    );

    expect(diagnostics).toEqual([]);
    // Mermaid measured (mermaid-probe.mjs): the `()` side never becomes a
    // class — only "Quacks" does, and the defensive endpoint-declares-a-
    // class fallback (the case above) must not resurrect it either.
    expect(model.classes.map((c) => c.id)).toEqual(["Quacks"]);
    expect(model.relationships).toHaveLength(1);
    const [rel] = model.relationships;
    expect(rel.to).toBe("Quacks");
    expect(rel.fromInterfaceLabel).toBe("Duck");
    expect(rel.toInterfaceLabel).toBeNull();
    // The synthetic id just has to be stable and distinct from any real
    // class id — not a literal value the spec pins.
    expect(rel.from).not.toBe("Duck");
    expect(typeof rel.from).toBe("string");
  });

  it("resolves a lollipop on the to-end symmetrically", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Quacks" })],
        relationships: [relationship({ from: "Quacks", to: "Duck", toEnd: "circle" })],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes.map((c) => c.id)).toEqual(["Quacks"]);
    const [rel] = model.relationships;
    expect(rel.from).toBe("Quacks");
    expect(rel.toInterfaceLabel).toBe("Duck");
    expect(rel.fromInterfaceLabel).toBeNull();
    expect(rel.to).not.toBe("Duck");
  });

  it("gives two relationships that both name the same lollipop label distinct synthetic ids, unmerged", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Quacks" }), classDecl({ id: "Flies" })],
        relationships: [
          relationship({ from: "Duck", to: "Quacks", fromEnd: "circle" }),
          relationship({ from: "Duck", to: "Flies", fromEnd: "circle" }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes.map((c) => c.id)).toEqual(["Quacks", "Flies"]);
    const [first, second] = model.relationships;
    expect(first.fromInterfaceLabel).toBe("Duck");
    expect(second.fromInterfaceLabel).toBe("Duck");
    expect(first.from).not.toBe(second.from);
  });

  it("resolves notes to stable note:n ids, an attached one carrying its target and a free one none", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [
          { label: plainLabel("free standing"), targetId: null },
          { label: plainLabel("can fly"), targetId: "Duck" },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.notes).toEqual([
      { id: "note:1", label: plainLabel("free standing"), targetId: null },
      { id: "note:2", label: plainLabel("can fly"), targetId: "Duck" },
    ]);
  });

  it("keeps a note whose target class does not exist as a free note, with a warning on it and no class made up", () => {
    // Mermaid 12.2.0 draws `note for Ghost "x"` with no connector and no
    // class Ghost (measured). Naming a class in a `note for` does not declare
    // it, so the note stays and is attached to nothing; the warning is there
    // because the name is most likely a typo.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [
          { label: plainLabel("first"), targetId: "Duck" },
          { label: plainLabel("orphan"), targetId: "Ghost", line: 6, column: 1 },
          { label: plainLabel("third"), targetId: null },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'note for "Ghost" names no class in this diagram, so the note is not attached to anything. ' +
          'Check the name, or declare the class with "class Ghost".',
        line: 6,
        column: 1,
      },
    ]);
    // Every note keeps the id its own position gives it.
    expect(model.notes).toEqual([
      { id: "note:1", label: plainLabel("first"), targetId: "Duck" },
      { id: "note:2", label: plainLabel("orphan"), targetId: null },
      { id: "note:3", label: plainLabel("third"), targetId: null },
    ]);
    expect(model.classes.map((c) => c.id)).toEqual(["Duck"]);
  });

  it("resolves timeline entries against class ids and relationship ids", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Animal" }), classDecl({ id: "Duck" })],
        relationships: [relationship({ from: "Animal", to: "Duck" })],
        timeline: {
          entries: [
            { kind: "enter", step: 1, targetId: "Animal", effect: "fade" },
            { kind: "enter", step: 2, targetId: "Animal-Duck", effect: "fade" },
            { kind: "highlight", step: 3, targetId: "Duck", effect: "glow" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.timeline).toEqual({
      totalSteps: 3,
      entries: [
        { kind: "enter", step: 1, targetId: "Animal", effect: "fade" },
        { kind: "enter", step: 2, targetId: "Animal-Duck", effect: "fade" },
        { kind: "highlight", step: 3, targetId: "Duck", effect: "glow" },
      ],
    });
  });

  it("lets a timeline address a namespace and a note by the ids this stage assigned them", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" })],
        namespaces: [{ id: "BaseShapes", name: "BaseShapes", parentId: null, label: null, classIds: ["Triangle"], noteIndexes: [] }],
        notes: [{ label: plainLabel("shapes live here"), targetId: "Triangle" }],
        timeline: {
          entries: [
            { kind: "enter", step: 1, targetId: "namespace:1", effect: "fade" },
            { kind: "enter", step: 2, targetId: "note:1", effect: "fade" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.timeline.entries.map((e) => e.targetId)).toEqual(["namespace:1", "note:1"]);
    expect(model.timeline.totalSteps).toBe(2);
  });

  it("keeps only the earliest-step enter for one target, warning about the later one", () => {
    // The same dedupe `buildFlowchartModel` applies. Without it a class with
    // two `enter` actions is revealed and then revealed again, which the
    // controller replays as a class change on a step where nothing should
    // move — the animation a class diagram gets has to be the animation a
    // flowchart gets, not a near-miss.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Animal" })],
        timeline: {
          entries: [
            { kind: "enter", step: 3, targetId: "Animal", effect: "fade", line: 5, column: 1 },
            { kind: "enter", step: 1, targetId: "Animal", effect: "slide-left", line: 6, column: 1 },
          ],
        },
      }),
    );

    expect(model.timeline.entries).toEqual([
      { kind: "enter", step: 1, targetId: "Animal", effect: "slide-left" },
    ]);
    expect(model.timeline.totalSteps).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].line).toBe(5);
    expect(diagnostics[0].message).toContain("Animal");
    expect(diagnostics[0].message).toContain("enter");
  });

  it("drops an action that fires before its target has entered, with an error", () => {
    // Also `buildFlowchartModel`'s rule. A highlight on a still-`siren-pending`
    // element highlights nothing a reader can see, and the author has no way
    // to tell that from a highlight the theme forgot.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Animal" })],
        timeline: {
          entries: [
            { kind: "highlight", step: 1, targetId: "Animal", effect: "glow", line: 5, column: 1 },
            { kind: "enter", step: 3, targetId: "Animal", effect: "fade", line: 6, column: 1 },
          ],
        },
      }),
    );

    expect(model.timeline.entries).toEqual([
      { kind: "enter", step: 3, targetId: "Animal", effect: "fade" },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].line).toBe(5);
    expect(diagnostics[0].message).toContain("highlight");
    expect(diagnostics[0].message).toContain("Animal");
  });

  it("warns when a relationship stays visible after one of its endpoint classes exits", () => {
    // The same defect `buildFlowchartModel` warns about for an edge outliving
    // its node: relationship visibility is not coupled to its endpoints'
    // anywhere in the pipeline, so the line is left pointing at empty space.
    // Advisory only — nothing is dropped, and the author fixes it by giving
    // the relationship its own `exit`.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Animal" }), classDecl({ id: "Duck" })],
        relationships: [relationship({ from: "Animal", to: "Duck" })],
        timeline: {
          entries: [{ kind: "exit", step: 2, targetId: "Animal", effect: "fade" }],
        },
      }),
    );

    expect(model.timeline.entries).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("Animal-Duck");
    expect(diagnostics[0].message).toContain("Animal");
    expect(diagnostics[0].message).toContain("step 2");
  });

  it("does not warn when the relationship exits no later than its endpoint does", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Animal" }), classDecl({ id: "Duck" })],
        relationships: [relationship({ from: "Animal", to: "Duck" })],
        timeline: {
          entries: [
            { kind: "exit", step: 1, targetId: "Animal-Duck", effect: "fade" },
            { kind: "exit", step: 2, targetId: "Animal", effect: "fade" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([]);
  });

  it("resolves a timeline entry naming a note whose target class does not exist", () => {
    // The note is kept, attached to nothing, so its id is in the model and a
    // timeline animates it like any other note; only the warning remains.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [{ label: plainLabel("orphan"), targetId: "Ghost", line: 4, column: 1 }],
        timeline: {
          entries: [{ kind: "enter", step: 1, targetId: "note:1", effect: "fade", line: 8 }],
        },
      }),
    );

    expect(diagnostics.map((d) => [d.severity, d.line])).toEqual([["warning", 4]]);
    expect(model.timeline.entries.map((e) => e.targetId)).toEqual(["note:1"]);
  });

  it("resolves an interaction on a declared class, passing its action, argument and tooltip through", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" }), classDecl({ id: "Duck" })],
        interactions: [
          {
            interactionKind: "href",
            targetId: "Shape",
            action: "https://example.com/shape",
            argument: null,
            tooltip: "the shape docs",
            line: 4,
            column: 1,
          },
          {
            interactionKind: "call",
            targetId: "Duck",
            action: "showDuck",
            argument: "quack",
            tooltip: null,
            line: 5,
            column: 1,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.interactions).toEqual([
      {
        targetId: "Shape",
        interactionKind: "href",
        action: "https://example.com/shape",
        argument: null,
        tooltip: "the shape docs",
        linkTarget: null,
      },
      {
        targetId: "Duck",
        interactionKind: "call",
        action: "showDuck",
        argument: "quack",
        tooltip: null,
        linkTarget: null,
      },
    ]);
  });

  it("drops an interaction on a class that does not exist with an error diagnostic, keeping the rest", () => {
    // Naming a class in a `click` does not declare it, exactly as `note for`
    // does not: the interaction is about a class that already exists.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" })],
        interactions: [
          {
            interactionKind: "href",
            targetId: "Ghost",
            action: "https://example.com",
            argument: null,
            tooltip: null,
            line: 5,
            column: 3,
          },
          {
            interactionKind: "href",
            targetId: "Shape",
            action: "https://example.com/shape",
            argument: null,
            tooltip: null,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'click "Ghost" references a target that does not exist; dropping the interaction.',
        line: 5,
        column: 3,
      },
    ]);
    expect(model.interactions.map((i) => i.targetId)).toEqual(["Shape"]);
    expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
  });

  /**
   * The board's security boundary. The parser records a `click X href
   * "..."` URL verbatim and deliberately judges nothing, so if the
   * allowlist here does not reject a URL, nothing downstream will: it
   * reaches the DOM as a live `href`.
   */
  describe("href URL allowlist", () => {
    /** A `click Shape href "<url>"` interaction, the only field that varies. */
    function hrefDocument(url: string) {
      return classDocument({
        classes: [classDecl({ id: "Shape" })],
        interactions: [
          {
            interactionKind: "href",
            targetId: "Shape",
            action: url,
            argument: null,
            tooltip: null,
            line: 4,
            column: 1,
          },
        ],
      });
    }

    it.each([
      ["http:", "http://example.com/shape"],
      ["https:", "https://example.com/shape"],
      ["mailto:", "mailto:shapes@example.com"],
    ])("resolves an allowed %s URL", (_scheme, url) => {
      const { model, diagnostics } = buildClassModel(hrefDocument(url));

      expect(diagnostics).toEqual([]);
      expect(model.interactions.map((i) => i.action)).toEqual([url]);
    });

    it.each([
      ["./docs/shape.html"],
      ["docs/shape.html"],
      ["/docs/shape.html"],
      ["#shape"],
    ])("resolves the relative URL %s — the allowlist rejects schemes, it does not require absolute URLs", (url) => {
      const { model, diagnostics } = buildClassModel(hrefDocument(url));

      expect(diagnostics).toEqual([]);
      expect(model.interactions.map((i) => i.action)).toEqual([url]);
    });

    it("drops a javascript: URL with an error diagnostic naming the scheme", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("javascript:alert(1)"));

      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'click "Shape" uses the disallowed URL scheme "javascript:"; only http:, https: ' +
            "and mailto: are allowed; dropping the interaction.",
          line: 4,
          column: 1,
        },
      ]);
      // The class still renders, just without a link.
      expect(model.interactions).toEqual([]);
      expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
    });

    it("drops a data: URL with an error diagnostic naming the scheme", () => {
      const { model, diagnostics } = buildClassModel(
        hrefDocument("data:text/html;base64,PHNjcmlwdD4="),
      );

      expect(diagnostics.map((d) => d.message)).toEqual([
        'click "Shape" uses the disallowed URL scheme "data:"; only http:, https: ' +
          "and mailto: are allowed; dropping the interaction.",
      ]);
      expect(model.interactions).toEqual([]);
      expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
    });

    it("drops a vbscript: URL with an error diagnostic naming the scheme", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("vbscript:MsgBox(1)"));

      expect(diagnostics.map((d) => d.message)).toEqual([
        'click "Shape" uses the disallowed URL scheme "vbscript:"; only http:, https: ' +
          "and mailto: are allowed; dropping the interaction.",
      ]);
      expect(model.interactions).toEqual([]);
    });

    it("drops a scheme-relative URL, which would adopt whatever scheme the page was served over", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("//evil.example/shape"));

      expect(diagnostics.map((d) => d.message)).toEqual([
        'click "Shape" uses a scheme-relative URL ("//evil.example/shape"), which adopts the ' +
          "page's scheme; only http:, https: and mailto: are allowed; dropping the interaction.",
      ]);
      expect(model.interactions).toEqual([]);
      expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
    });

    it("drops a backslash-spelled scheme-relative URL, which browsers read as //", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("\\\\evil.example/shape"));

      expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
      expect(model.interactions).toEqual([]);
    });

    it.each([
      ["mixed case", "JaVaScRiPt:alert(1)"],
      ["a tab inside the scheme", "java\tscript:alert(1)"],
      ["a newline inside the scheme", "java\nscript:alert(1)"],
      ["a NUL inside the scheme", "java\u0000script:alert(1)"],
      ["leading whitespace", "  javascript:alert(1)"],
      ["a leading control character", "\u0001javascript:alert(1)"],
    ])("drops a javascript: URL obfuscated with %s, as a browser would still run it", (_how, url) => {
      const { model, diagnostics } = buildClassModel(hrefDocument(url));

      expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
      expect(diagnostics[0].message).toContain('"javascript:"');
      expect(model.interactions).toEqual([]);
    });

    it.each([
      ["plain", "//evil.example/shape"],
      ["a backslash", "/\\evil.example/shape"],
      ["a tab wedged between the slashes", "/\t/evil.example/shape"],
      ["a NUL wedged between the slashes", "/\u0000\\evil.example/shape"],
      ["leading whitespace", " //evil.example/shape"],
    ])(
      "drops an off-site navigation spelled scheme-relative with %s, which a browser resolves as another origin",
      (_how, url) => {
        const { model, diagnostics } = buildClassModel(hrefDocument(url));

        expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
        expect(diagnostics[0].message).toContain("scheme-relative");
        expect(model.interactions).toEqual([]);
        // The class still renders, just without a link.
        expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
      },
    );

    it("leaves a call interaction alone, whose action is a callback name and not a URL", () => {
      const { model, diagnostics } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "Shape" })],
          interactions: [
            {
              interactionKind: "call",
              targetId: "Shape",
              action: "data",
              argument: null,
              tooltip: null,
            },
          ],
        }),
      );

      expect(diagnostics).toEqual([]);
      expect(model.interactions.map((i) => i.action)).toEqual(["data"]);
    });
  });

  it("resolves a style statement into that class's declarations, in the order they were written", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" }), classDecl({ id: "Duck" })],
        styles: [
          {
            styleKind: "style",
            authoredAs: "style",
            targetIds: ["Shape"],
            name: null,
            properties: [
              { property: "fill", value: "#fdd" },
              { property: "stroke", value: "#c00" },
            ],
            line: 4,
            column: 1,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([
      {
        targetId: "Shape",
        style: {
          frame: [
            { property: "fill", value: "#fdd" },
            { property: "stroke", value: "#c00" },
          ],
          text: [],
        },
      },
    ]);
  });

  it("flattens a classDef onto every class a cssClass applies it to, in application order, with a later style winning", () => {
    // What the parser hands over for:
    //   cssClass "Shape,Duck" emphasis
    //   classDef emphasis fill:#fdd,stroke:#c00
    //   style Shape fill:#00f
    // The cssClass is written before the classDef it names, which is legal:
    // pairing them in either source order is this stage's job. The `style`
    // comes last, so its fill wins on Shape and leaves Duck alone.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" }), classDecl({ id: "Duck" })],
        styles: [
          {
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape", "Duck"],
            name: "emphasis",
            properties: [],
          },
          {
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name: "emphasis",
            properties: [
              { property: "fill", value: "#fdd" },
              { property: "stroke", value: "#c00" },
            ],
          },
          {
            styleKind: "style",
            authoredAs: "style",
            targetIds: ["Shape"],
            name: null,
            properties: [{ property: "fill", value: "#00f" }],
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([
      {
        targetId: "Shape",
        style: {
          frame: [
            { property: "fill", value: "#00f" },
            { property: "stroke", value: "#c00" },
          ],
          text: [],
        },
      },
      {
        targetId: "Duck",
        style: {
          frame: [
            { property: "fill", value: "#fdd" },
            { property: "stroke", value: "#c00" },
          ],
          text: [],
        },
      },
    ]);
  });

  it("applies two classDefs to one class in the order the cssClass statements were written", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" })],
        styles: [
          {
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name: "warm",
            properties: [{ property: "fill", value: "#fdd" }],
          },
          {
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name: "cool",
            properties: [
              { property: "fill", value: "#ddf" },
              { property: "stroke", value: "#00c" },
            ],
          },
          {
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape"],
            name: "warm",
            properties: [],
          },
          {
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape"],
            name: "cool",
            properties: [],
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([
      {
        targetId: "Shape",
        style: {
          frame: [
            { property: "fill", value: "#ddf" },
            { property: "stroke", value: "#00c" },
          ],
          text: [],
        },
      },
    ]);
  });

  it("drops a style statement on a class that does not exist silently, keeping the rest", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" })],
        styles: [
          {
            styleKind: "style",
            authoredAs: "style",
            targetIds: ["Ghost"],
            name: null,
            properties: [{ property: "fill", value: "#fdd" }],
            line: 4,
            column: 1,
          },
          {
            styleKind: "style",
            authoredAs: "style",
            targetIds: ["Shape"],
            name: null,
            properties: [{ property: "fill", value: "#00f" }],
          },
        ],
      }),
    );

    // Silently: Mermaid accepts a class diagram naming a class that does not
    // exist and reports nothing (measured, 11.17.2: `cssClass "Ghost" urgent`
    // adds no class and no error), so `resolveStyles` says nothing either.
    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([
      { targetId: "Shape", style: { frame: [{ property: "fill", value: "#00f" }], text: [] } },
    ]);
    expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
  });

  it("drops only the unknown targets of a cssClass, still applying it to the ones that exist", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" })],
        styles: [
          {
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name: "emphasis",
            properties: [{ property: "fill", value: "#fdd" }],
          },
          {
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape", "Ghost"],
            name: "emphasis",
            properties: [],
            line: 6,
            column: 1,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([
      { targetId: "Shape", style: { frame: [{ property: "fill", value: "#fdd" }], text: [] } },
    ]);
  });

  it("errors when a cssClass applies a classDef name nothing defines, and styles the class with nothing", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Shape" })],
        styles: [
          {
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name: "emphasis",
            properties: [{ property: "fill", value: "#fdd" }],
          },
          {
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape"],
            name: "emphsis",
            properties: [],
            line: 6,
            column: 1,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'cssClass applies "emphsis", which no classDef defines; dropping the declaration.',
        line: 6,
        column: 1,
      },
    ]);
    expect(model.styles).toEqual([]);
    expect(model.classes.map((c) => c.id)).toEqual(["Shape"]);
  });

  /**
   * The board's other security boundary. The parser splits `fill:#fdd` into
   * a property and a value and inspects neither, and the renderer puts the
   * survivors into a live `style` attribute — so a declaration accepted
   * here is a declaration the browser will act on.
   */
  describe("style declaration rejection list", () => {
    /** A `style Shape <properties>` statement over a declared class. */
    function styleDocument(properties: { property: string; value: string }[]) {
      return classDocument({
        classes: [classDecl({ id: "Shape" })],
        styles: [
          {
            styleKind: "style",
            authoredAs: "style",
            targetIds: ["Shape"],
            name: null,
            properties,
            line: 4,
            column: 1,
          },
        ],
      });
    }

    it("drops a url( value with an error diagnostic, leaving the other declarations of the same statement", () => {
      const { model, diagnostics } = buildClassModel(
        styleDocument([
          { property: "stroke", value: "#c00" },
          { property: "fill", value: "url(#evil)" },
          { property: "stroke-width", value: "2px" },
        ]),
      );

      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "fill" uses "url(", which can fetch a remote resource; ' +
            "dropping the declaration.",
          line: 4,
          column: 1,
        },
      ]);
      expect(model.styles).toEqual([
        {
          targetId: "Shape",
          style: {
            frame: [
              { property: "stroke", value: "#c00" },
              { property: "stroke-width", value: "2px" },
            ],
            text: [],
          },
        },
      ]);
    });

    it("drops an expression( value with an error diagnostic", () => {
      const { model, diagnostics } = buildClassModel(
        styleDocument([{ property: "width", value: "expression(alert(1))" }]),
      );

      expect(diagnostics.map((d) => d.message)).toEqual([
        'Style value for "width" uses "expression(", which can execute script; ' +
          "dropping the declaration.",
      ]);
      expect(model.styles).toEqual([]);
    });

    it.each([
      ["upper case", "URL(#evil)"],
      ["mixed case", "Url(#evil)"],
      ["space before the paren", "url (#evil)"],
      ["a value that merely contains it", "#fdd, url(#evil)"],
    ])("drops a url( value spelled with %s", (_how, value) => {
      const { model, diagnostics } = buildClassModel(
        styleDocument([{ property: "fill", value }]),
      );

      expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
      expect(model.styles).toEqual([]);
    });

    it.each([
      ["a semicolon", "a;b"],
      ["a space", "a b"],
      ["a colon", "fill:red"],
      ["a brace", "a}b"],
      ["a bare digit start", "1fill"],
      ["nothing at all", ""],
    ])("drops a property name containing %s, which is not a plain CSS identifier", (_how, property) => {
      const { model, diagnostics } = buildClassModel(
        styleDocument([
          { property, value: "red" },
          { property: "fill", value: "#fdd" },
        ]),
      );

      expect(diagnostics.map((d) => d.message)).toEqual([
        `Style property "${property}" is not a plain CSS identifier; dropping the declaration.`,
      ]);
      expect(model.styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "fill", value: "#fdd" }], text: [] } },
      ]);
    });

    it.each([["fill"], ["stroke-width"], ["--siren-class-fill"], ["-webkit-mask"], ["_odd"]])(
      "accepts the plain CSS identifier %s",
      (property) => {
        const { model, diagnostics } = buildClassModel(
          styleDocument([{ property, value: "#fdd" }]),
        );

        expect(diagnostics).toEqual([]);
        expect(model.styles[0].style.frame).toEqual([{ property, value: "#fdd" }]);
      },
    );

    it("drops a value carrying a semicolon, which would smuggle a second declaration through one value", () => {
      // The parser splits a declaration on its *first* colon, so everything
      // after it is one value however many `;` it holds. Whether that
      // smuggles depends on how the renderer serializes the attribute — a
      // dependency this boundary refuses to take.
      const { model, diagnostics } = buildClassModel(
        styleDocument([{ property: "fill", value: "#fdd;position:fixed;top:0" }]),
      );

      expect(diagnostics.map((d) => d.message)).toEqual([
        'Style value for "fill" contains ";", which would smuggle in a second declaration; ' +
          "dropping the declaration.",
      ]);
      expect(model.styles).toEqual([]);
    });

    it.each([
      ["url(", "background-image", "\\75 rl(https://e.example/beacon.png)"],
      ["url( with the escape on its second letter", "background-image", "u\\72 l(https://e.example/beacon.png)"],
      ["expression(", "width", "\\65 xpression(alert(1))"],
      ["url( behind a custom property", "--brand-image", "\\75 rl(https://e.example/beacon.png)"],
    ])("drops a value that reaches a rejected function by spelling %s as a CSS escape", (_what, property, value) => {
      const { model, diagnostics } = buildClassModel(
        styleDocument([
          { property, value },
          { property: "fill", value: "#fdd" },
        ]),
      );

      expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
      // The declaration beside it is untouched, as for any other rejection.
      expect(model.styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "fill", value: "#fdd" }], text: [] } },
      ]);
    });

    it.each([
      ["a function-bearing color", "fill", "rgb(255, 0, 0)"],
      ["a nested function-bearing color", "fill", "color-mix(in srgb, rgb(1,2,3), #fff)"],
      ["a length calculation", "stroke-width", "calc(2px + 1em)"],
    ])("keeps admitting %s, which the rejection list has no quarrel with", (_what, property, value) => {
      const { model, diagnostics } = buildClassModel(styleDocument([{ property, value }]));

      expect(diagnostics).toEqual([]);
      expect(model.styles).toEqual([{ targetId: "Shape", style: { frame: [{ property, value }], text: [] } }]);
    });

    it("reports a rejected classDef declaration once, at the classDef, however many classes apply it", () => {
      // The author fixes it where it is written, not where it is used.
      const { model, diagnostics } = buildClassModel(
        classDocument({
          classes: [classDecl({ id: "Shape" }), classDecl({ id: "Duck" })],
          styles: [
            {
              styleKind: "classDef",
              authoredAs: "classDef",
              targetIds: [],
              name: "emphasis",
              properties: [
                { property: "fill", value: "url(#evil)" },
                { property: "stroke", value: "#c00" },
              ],
              line: 4,
              column: 1,
            },
            {
              styleKind: "apply",
              authoredAs: "cssClass",
              targetIds: ["Shape"],
              name: "emphasis",
              properties: [],
            },
            {
              styleKind: "apply",
              authoredAs: "cssClass",
              targetIds: ["Duck"],
              name: "emphasis",
              properties: [],
            },
          ],
        }),
      );

      expect(diagnostics.map((d) => [d.message, d.line])).toEqual([
        [
          'Style value for "fill" uses "url(", which can fetch a remote resource; ' +
            "dropping the declaration.",
          4,
        ],
      ]);
      expect(model.styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "stroke", value: "#c00" }], text: [] } },
        { targetId: "Duck", style: { frame: [{ property: "stroke", value: "#c00" }], text: [] } },
      ]);
    });
  });

  it("keeps a namespace id distinct from the relationship id a class named 'namespace' would produce", () => {
    // The collision this closes: a relationship's id is `${from}-${to}`, so
    //   classDiagram
    //     namespace Shapes {
    //       class namespace
    //     }
    //     namespace --|> 1
    // gave the relationship and the first namespace the same "namespace-1",
    // making both `timeline:` addressing and `data-siren-id` ambiguous with
    // no diagnostic. Class ids are `\w+` and so can never contain a `:`,
    // which is why a `:` separator cannot be collided with.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "namespace" }), classDecl({ id: "1" })],
        relationships: [relationship({ from: "namespace", to: "1" })],
        namespaces: [{ id: "Shapes", name: "Shapes", parentId: null, label: null, classIds: ["namespace"], noteIndexes: [] }],
        notes: [{ label: plainLabel("about shapes"), targetId: "namespace" }],
        timeline: {
          entries: [
            { kind: "enter", step: 1, targetId: "namespace-1", effect: "fade" },
            { kind: "enter", step: 2, targetId: "namespace:1", effect: "fade" },
            { kind: "enter", step: 3, targetId: "note:1", effect: "fade" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.relationships.map((r) => r.id)).toEqual(["namespace-1"]);
    expect(model.namespaces.map((n) => n.id)).toEqual(["namespace:1"]);
    expect(model.notes.map((n) => n.id)).toEqual(["note:1"]);
    // All three ids address a different element, so nothing is ambiguous.
    expect(model.timeline.entries.map((e) => e.targetId)).toEqual([
      "namespace-1",
      "namespace:1",
      "note:1",
    ]);
  });

  it("drops a timeline entry naming an unknown id with an error diagnostic, keeping the rest of the model", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Animal" }), classDecl({ id: "Duck" })],
        relationships: [relationship({ from: "Animal", to: "Duck" })],
        timeline: {
          entries: [
            { kind: "enter", step: 1, targetId: "Animal", effect: "fade" },
            { kind: "enter", step: 2, targetId: "Ghost", effect: "fade", line: 7, column: 3 },
            { kind: "enter", step: 3, targetId: "Duck", effect: "fade" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'timeline: references unknown id "Ghost"',
        line: 7,
        column: 3,
      },
    ]);
    expect(model.timeline.entries.map((e) => e.targetId)).toEqual(["Animal", "Duck"]);
    expect(model.timeline.totalSteps).toBe(3);
    expect(model.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(model.relationships.map((r) => r.id)).toEqual(["Animal-Duck"]);
  });
});

describe("buildClassModel — labels", () => {
  it("keeps a label written for a class through the declarations that write none", () => {
    // The implicit declaration a relationship makes carries no label, before
    // or after the one that wrote it; neither one takes the label away.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Order" }),
          classDecl({ id: "Order", label: rowsLabel("Order", "Line") }),
          classDecl({ id: "Order" }),
          classDecl({ id: "Plain" }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes.map((c) => [c.id, c.label])).toEqual([
      ["Order", rowsLabel("Order", "Line")],
      ["Plain", null],
    ]);
  });

  it("takes the last label, silently, when two declarations of one class label it differently", () => {
    // Mermaid 11.17.2, measured: `class A["x"]` then `class A["y"]` draws
    // "y" with no diagnostic — unlike a generic or an annotation, where the
    // first is the one drawn.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Order", label: plainLabel("x"), line: 2, column: 3 }),
          classDecl({ id: "Order", label: rowsLabel("y", "z"), line: 3, column: 3 }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.classes.map((c) => [c.id, c.label])).toEqual([["Order", rowsLabel("y", "z")]]);
  });

  it("labels a namespace with the label it wrote, and one that wrote none with its name", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Lion" }), classDecl({ id: "Cow" })],
        namespaces: [
          { id: "Zoo", name: "Zoo", parentId: null, label: rowsLabel("Big", "Zoo"), classIds: ["Lion"], noteIndexes: [] },
          { id: "Farm", name: "Farm", parentId: null, label: null, classIds: ["Cow"], noteIndexes: [] },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.namespaces).toEqual([
      { id: "namespace:1", parentId: null, label: rowsLabel("Big", "Zoo"), classIds: ["Lion"], noteIds: [] },
      { id: "namespace:2", parentId: null, label: plainLabel("Farm"), classIds: ["Cow"], noteIds: [] },
    ]);
  });

  it("carries a note's label and a relationship's label through unchanged", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Order" }), classDecl({ id: "Line" })],
        relationships: [
          relationship({ from: "Order", to: "Line", label: rowsLabel("holds", "many") }),
        ],
        notes: [{ label: rowsLabel("can fly", "can swim"), targetId: "Order" }],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.relationships.map((r) => r.label)).toEqual([rowsLabel("holds", "many")]);
    expect(model.notes).toEqual([
      { id: "note:1", label: rowsLabel("can fly", "can swim"), targetId: "Order" },
    ]);
  });
});

/**
 * Dotted namespace names, read by the parser and resolved here (measured on
 * Mermaid 12.2.0, spec `class-nested-namespaces`): the ancestors a dotted
 * name implies exist whether or not a block opens them, and merge with the
 * blocks that do.
 */
describe("buildClassModel — dotted namespace names", () => {
  const modelOf = (body: string) => {
    const { document } = parseClassDiagram(`classDiagram\n${body}`);
    if (document === null || document.kind !== "class") throw new Error("expected a class document");
    return buildClassModel(document);
  };
  const framesOf = (body: string) => {
    const { model, diagnostics } = modelOf(body);
    expect(diagnostics).toEqual([]);
    return model.namespaces.map((n) => [n.id, n.parentId, n.label.text, n.classIds]);
  };

  it("creates the ancestor a dotted name implies, titled by its segment and numbered first", () => {
    expect(framesOf("namespace N.M {\n  class A\n}")).toEqual([
      ["namespace:1", null, "N", []],
      ["namespace:2", "namespace:1", "M", ["A"]],
    ]);
  });

  it("merges a dotted name's ancestor with a namespace of that name, written before or after", () => {
    // Measured: `namespace N { class X }` with `namespace N.M { class A }`,
    // in either order, is one N around X and `N.M`.
    expect(framesOf("namespace N {\n  class X\n}\nnamespace N.M {\n  class A\n}")).toEqual([
      ["namespace:1", null, "N", ["X"]],
      ["namespace:2", "namespace:1", "M", ["A"]],
    ]);
    expect(framesOf("namespace N.M {\n  class A\n}\nnamespace N {\n  class X\n}")).toEqual([
      ["namespace:1", null, "N", ["X"]],
      ["namespace:2", "namespace:1", "M", ["A"]],
    ]);
    // A dotted name and the nested spelling of it are one namespace.
    expect(framesOf("namespace N { namespace M { class A } }\nnamespace N.M { class B }")).toEqual([
      ["namespace:1", null, "N", []],
      ["namespace:2", "namespace:1", "M", ["A", "B"]],
    ]);
  });

  it("labels the leaf only, leaving an ancestor its segment until a block of its own labels it", () => {
    // Measured: `N.M["Leaf"]` alone titles N plain N; a later `N["Outer"]` titles it Outer.
    expect(framesOf('namespace N.M["Leaf"] {\n  class A\n}')).toEqual([
      ["namespace:1", null, "N", []],
      ["namespace:2", "namespace:1", "Leaf", ["A"]],
    ]);
    expect(framesOf('namespace N.M["Leaf"] {\n  class A\n}\nnamespace N["Outer"] {\n  class X\n}')).toEqual([
      ["namespace:1", null, "Outer", ["X"]],
      ["namespace:2", "namespace:1", "Leaf", ["A"]],
    ]);
  });

  it("numbers namespaces in the order they first open, an ancestor where its first dotted name opens it", () => {
    // Measured: `K`, `N.M`, `N.L` draw K, N, `N.M`, `N.L`.
    expect(framesOf("namespace K {\n  class Z\n}\nnamespace N.M {\n  class A\n}\nnamespace N.L {\n  class B\n}")).toEqual([
      ["namespace:1", null, "K", ["Z"]],
      ["namespace:2", null, "N", []],
      ["namespace:3", "namespace:2", "M", ["A"]],
      ["namespace:4", "namespace:2", "L", ["B"]],
    ]);
  });
});

/**
 * Notes written inside a namespace (measured on Mermaid 12.2.0, spec
 * `class-nested-namespaces`): each is listed on the namespace the parser
 * recorded it on, by the `note:N` id it already had.
 */
describe("buildClassModel — notes inside namespaces", () => {
  const block = (id: string, classIds: string[], noteIndexes: number[], parentId: string | null = null) => ({
    id,
    name: id.slice(id.lastIndexOf(".") + 1),
    parentId,
    label: null,
    classIds,
    noteIndexes,
  });
  const free = (text: string) => ({ label: plainLabel(text), targetId: null });

  it("lists a namespace's notes by their note:N ids, which a note outside every namespace keeps too", () => {
    // `note "first"`, `namespace N { class A; note "second"; note for B "third" }`, `class B`.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "A" }), classDecl({ id: "B" })],
        namespaces: [block("N", ["A"], [1, 2])],
        notes: [free("first"), free("second"), { label: plainLabel("third"), targetId: "B" }],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.notes.map((n) => n.id)).toEqual(["note:1", "note:2", "note:3"]);
    expect(model.namespaces.map((n) => [n.id, n.noteIds])).toEqual([["namespace:1", ["note:2", "note:3"]]]);
  });

  it("lists each note on the namespace it was written in, nested or dotted", () => {
    // `namespace N { note "outer"; namespace M { class A; note "inner" } }`,
    // or the leaf of `namespace N.M { class A; note "inner" }`.
    const { model } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "A" })],
        namespaces: [block("N", [], [0]), block("N.M", ["A"], [1], "N")],
        notes: [free("outer"), free("inner")],
      }),
    );

    expect(model.namespaces.map((n) => [n.id, n.noteIds])).toEqual([
      ["namespace:1", ["note:1"]],
      ["namespace:2", ["note:2"]],
    ]);
  });

  it("gathers the notes of every block of a reopened namespace on the one namespace", () => {
    const { model } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "X" })],
        namespaces: [block("N", ["X"], [0]), block("N", [], [1])],
        notes: [free("a"), free("b")],
      }),
    );

    expect(model.namespaces.map((n) => [n.id, n.classIds, n.noteIds])).toEqual([["namespace:1", ["X"], ["note:1", "note:2"]]]);
  });

  it("keeps a note whose target class does not exist on the namespace it was written in", () => {
    // Measured: Mermaid 12.2.0 frames N around `note for Ghost "x"`, the
    // note's only content, and draws no class Ghost.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        namespaces: [block("N", [], [0])],
        notes: [{ label: plainLabel("lost"), targetId: "Ghost" }],
      }),
    );

    expect(diagnostics.map((d) => d.severity)).toEqual(["warning"]);
    expect(model.notes.map((n) => [n.id, n.targetId])).toEqual([["note:1", null]]);
    expect(model.namespaces.map((n) => [n.id, n.classIds, n.noteIds])).toEqual([["namespace:1", [], ["note:1"]]]);
    expect(model.classes).toEqual([]);
  });

  it("keeps a note whose target class does not exist on the nested namespace it was written in", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "A" })],
        namespaces: [block("N", ["A"], [1]), block("N.M", [], [0], "N")],
        notes: [{ label: plainLabel("lost"), targetId: "Ghost" }, free("kept")],
      }),
    );

    expect(diagnostics.map((d) => d.severity)).toEqual(["warning"]);
    expect(model.notes.map((n) => [n.id, n.targetId])).toEqual([
      ["note:1", null],
      ["note:2", null],
    ]);
    expect(model.namespaces.map((n) => [n.id, n.classIds, n.noteIds])).toEqual([
      ["namespace:1", ["A"], ["note:2"]],
      ["namespace:2", [], ["note:1"]],
    ]);
    expect(model.classes.map((c) => c.id)).toEqual(["A"]);
  });
});
