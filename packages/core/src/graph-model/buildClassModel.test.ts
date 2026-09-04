import { describe, expect, it } from "vitest";
import type { ClassDecl, ClassDocument, ClassMember, ClassRelationship } from "../contracts";
import { buildClassModel } from "./buildClassModel";

/**
 * A `ClassDocument` with everything empty, so each test states only the
 * declarations it is about. Hand-built rather than parsed: `buildClassModel`
 * is a pure function over the document shape, and the parser is a separate
 * seam with its own tests.
 */
function classDocument(overrides: Partial<ClassDocument> = {}): ClassDocument {
  return {
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
  return { generic: null, annotation: null, members: [], ...overrides };
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
    expect(model).not.toBeNull();
    expect(model!.direction).toBe("TB");
    expect(model!.classes).toEqual([
      {
        id: "Animal",
        generic: null,
        annotation: null,
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
    expect(model).not.toBeNull();
    expect(model!.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(model!.classes[0].members).toEqual([age, swim]);
    expect(model!.classes[1].members).toEqual([]);
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
    expect(model).not.toBeNull();
    expect(model!.classes).toHaveLength(1);
    expect(model!.classes[0].members).toEqual([firstAge]);
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

    expect(model).not.toBeNull();
    expect(model!.classes[0].members).toEqual([
      publicAge,
      privateAge,
      stringAge,
      swim,
      swimFar,
      swimVoid,
      swimAbstract,
    ]);
  });

  it("keeps an annotation and a generic carried by a later declaration than the one that introduced the class", () => {
    // The implicit declaration a relationship makes comes first and carries
    // neither, so taking the first declaration's values wholesale would
    // throw away everything the explicit `class Shape~T~ { <<interface>> }`
    // said.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [
          classDecl({ id: "Shape" }),
          classDecl({ id: "Shape", annotation: "interface", generic: "T" }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.classes).toHaveLength(1);
    expect(model!.classes[0].annotation).toBe("interface");
    expect(model!.classes[0].generic).toBe("T");
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

    expect(model).not.toBeNull();
    expect(model!.classes).toHaveLength(1);
    expect(model!.classes[0].annotation).toBe("interface");
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

  it("resolves each namespace to a stable namespace-n id carrying its declared name and member ids", () => {
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
          { id: "BaseShapes", classIds: ["Triangle", "Square"] },
          { id: "Widgets", classIds: ["Button"] },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.namespaces).toEqual([
      { id: "namespace-1", label: "BaseShapes", classIds: ["Triangle", "Square"] },
      { id: "namespace-2", label: "Widgets", classIds: ["Button"] },
    ]);
    expect(model!.classes.map((c) => [c.id, c.namespaceId])).toEqual([
      ["Triangle", "namespace-1"],
      ["Square", "namespace-1"],
      ["Button", "namespace-2"],
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
          { id: "BaseShapes", classIds: ["Triangle", "Square"], line: 2, column: 1 },
          { id: "Widgets", classIds: ["Triangle"], line: 7, column: 1 },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Class "Triangle" is named by more than one namespace ("BaseShapes" and "Widgets"); keeping the first.',
        line: 7,
        column: 1,
      },
    ]);
    expect(model).not.toBeNull();
    expect(model!.namespaces).toEqual([
      { id: "namespace-1", label: "BaseShapes", classIds: ["Triangle", "Square"] },
      { id: "namespace-2", label: "Widgets", classIds: [] },
    ]);
    expect(model!.classes.map((c) => c.namespaceId)).toEqual(["namespace-1", "namespace-1"]);
  });

  it("leaves a class outside every namespace with a null namespaceId", () => {
    const { model } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" }), classDecl({ id: "Loose" })],
        namespaces: [{ id: "BaseShapes", classIds: ["Triangle"] }],
      }),
    );

    expect(model).not.toBeNull();
    expect(model!.classes.map((c) => c.namespaceId)).toEqual(["namespace-1", null]);
  });

  it("creates a class a namespace names but nothing else declares, as a relationship endpoint does", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" })],
        namespaces: [{ id: "BaseShapes", classIds: ["Triangle", "Square"] }],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.classes).toEqual([
      { id: "Triangle", generic: null, annotation: null, members: [], namespaceId: "namespace-1" },
      { id: "Square", generic: null, annotation: null, members: [], namespaceId: "namespace-1" },
    ]);
    expect(model!.namespaces[0].classIds).toEqual(["Triangle", "Square"]);
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
            label: "raises",
            fromMultiplicity: "1",
            toMultiplicity: "*",
            sourceLine: 3,
            sourceColumn: 1,
          }),
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.relationships).toEqual([
      {
        id: "Customer-Ticket",
        from: "Customer",
        to: "Ticket",
        line: "dashed",
        fromEnd: "diamondFilled",
        toEnd: "arrow",
        label: "raises",
        fromMultiplicity: "1",
        toMultiplicity: "*",
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
    expect(model).not.toBeNull();
    expect(model!.relationships.map((r) => r.id)).toEqual(["A-B", "A-B#2", "B-A"]);
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
    expect(model).not.toBeNull();
    expect(model!.classes.map((c) => c.id)).toEqual(["Duck", "Animal"]);
    expect(model!.classes[1]).toEqual({
      id: "Animal",
      generic: null,
      annotation: null,
      members: [],
      namespaceId: null,
    });
    expect(model!.relationships.map((r) => r.id)).toEqual(["Animal-Duck"]);
  });

  it("resolves notes to stable note-n ids, an attached one carrying its target and a free one none", () => {
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [
          { text: "free standing", targetId: null },
          { text: "can fly", targetId: "Duck" },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.notes).toEqual([
      { id: "note-1", text: "free standing", targetId: null },
      { id: "note-2", text: "can fly", targetId: "Duck" },
    ]);
  });

  it("drops a note whose target class does not exist with an error diagnostic, keeping the rest of the model", () => {
    // Naming a class in a `note for` does not declare it — only a class
    // statement or a relationship does — so an unknown target is a mistake,
    // not an implicit declaration. The note goes; nothing else does.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [
          { text: "first", targetId: "Duck" },
          { text: "orphan", targetId: "Ghost", line: 6, column: 1 },
          { text: "third", targetId: null },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'note for "Ghost" references a class that does not exist; dropping the note.',
        line: 6,
        column: 1,
      },
    ]);
    expect(model).not.toBeNull();
    // The surviving notes keep the ids their own position gives them: a
    // broken note does not renumber the ones after it.
    expect(model!.notes).toEqual([
      { id: "note-1", text: "first", targetId: "Duck" },
      { id: "note-3", text: "third", targetId: null },
    ]);
    expect(model!.classes.map((c) => c.id)).toEqual(["Duck"]);
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
    expect(model).not.toBeNull();
    expect(model!.timeline).toEqual({
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
        namespaces: [{ id: "BaseShapes", classIds: ["Triangle"] }],
        notes: [{ text: "shapes live here", targetId: "Triangle" }],
        timeline: {
          entries: [
            { kind: "enter", step: 1, targetId: "namespace-1", effect: "fade" },
            { kind: "enter", step: 2, targetId: "note-1", effect: "fade" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.timeline.entries.map((e) => e.targetId)).toEqual(["namespace-1", "note-1"]);
    expect(model!.timeline.totalSteps).toBe(2);
  });

  it("drops a timeline entry naming a note that was dropped for an unknown target", () => {
    // The note's id never enters the model, so the timeline entry naming it
    // is unresolvable — reported on its own terms rather than silently.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [{ text: "orphan", targetId: "Ghost", line: 4, column: 1 }],
        timeline: {
          entries: [{ kind: "enter", step: 1, targetId: "note-1", effect: "fade", line: 8 }],
        },
      }),
    );

    expect(model).not.toBeNull();
    expect(diagnostics.map((d) => d.line)).toEqual([4, 8]);
    expect(model!.timeline.entries).toEqual([]);
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
    expect(model).not.toBeNull();
    expect(model!.timeline.entries.map((e) => e.targetId)).toEqual(["Animal", "Duck"]);
    expect(model!.timeline.totalSteps).toBe(3);
    expect(model!.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(model!.relationships.map((r) => r.id)).toEqual(["Animal-Duck"]);
  });
});
