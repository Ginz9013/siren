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
          { id: "BaseShapes", classIds: ["Triangle", "Square"] },
          { id: "Widgets", classIds: ["Button"] },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.namespaces).toEqual([
      { id: "namespace:1", label: "BaseShapes", classIds: ["Triangle", "Square"] },
      { id: "namespace:2", label: "Widgets", classIds: ["Button"] },
    ]);
    expect(model!.classes.map((c) => [c.id, c.namespaceId])).toEqual([
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
      { id: "namespace:1", label: "BaseShapes", classIds: ["Triangle", "Square"] },
      { id: "namespace:2", label: "Widgets", classIds: [] },
    ]);
    expect(model!.classes.map((c) => c.namespaceId)).toEqual(["namespace:1", "namespace:1"]);
  });

  it("leaves a class outside every namespace with a null namespaceId", () => {
    const { model } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Triangle" }), classDecl({ id: "Loose" })],
        namespaces: [{ id: "BaseShapes", classIds: ["Triangle"] }],
      }),
    );

    expect(model).not.toBeNull();
    expect(model!.classes.map((c) => c.namespaceId)).toEqual(["namespace:1", null]);
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
      { id: "Triangle", generic: null, annotation: null, members: [], namespaceId: "namespace:1" },
      { id: "Square", generic: null, annotation: null, members: [], namespaceId: "namespace:1" },
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

  it("resolves notes to stable note:n ids, an attached one carrying its target and a free one none", () => {
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
      { id: "note:1", text: "free standing", targetId: null },
      { id: "note:2", text: "can fly", targetId: "Duck" },
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
      { id: "note:1", text: "first", targetId: "Duck" },
      { id: "note:3", text: "third", targetId: null },
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
            { kind: "enter", step: 1, targetId: "namespace:1", effect: "fade" },
            { kind: "enter", step: 2, targetId: "note:1", effect: "fade" },
          ],
        },
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.timeline.entries.map((e) => e.targetId)).toEqual(["namespace:1", "note:1"]);
    expect(model!.timeline.totalSteps).toBe(2);
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

    expect(model).not.toBeNull();
    expect(model!.timeline.entries).toEqual([
      { kind: "enter", step: 1, targetId: "Animal", effect: "slide-left" },
    ]);
    expect(model!.timeline.totalSteps).toBe(1);
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

    expect(model).not.toBeNull();
    expect(model!.timeline.entries).toEqual([
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

    expect(model).not.toBeNull();
    expect(model!.timeline.entries).toHaveLength(1);
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

    expect(model).not.toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it("drops a timeline entry naming a note that was dropped for an unknown target", () => {
    // The note's id never enters the model, so the timeline entry naming it
    // is unresolvable — reported on its own terms rather than silently.
    const { model, diagnostics } = buildClassModel(
      classDocument({
        classes: [classDecl({ id: "Duck" })],
        notes: [{ text: "orphan", targetId: "Ghost", line: 4, column: 1 }],
        timeline: {
          entries: [{ kind: "enter", step: 1, targetId: "note:1", effect: "fade", line: 8 }],
        },
      }),
    );

    expect(model).not.toBeNull();
    expect(diagnostics.map((d) => d.line)).toEqual([4, 8]);
    expect(model!.timeline.entries).toEqual([]);
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
    expect(model).not.toBeNull();
    expect(model!.interactions).toEqual([
      {
        targetId: "Shape",
        interactionKind: "href",
        action: "https://example.com/shape",
        argument: null,
        tooltip: "the shape docs",
      },
      {
        targetId: "Duck",
        interactionKind: "call",
        action: "showDuck",
        argument: "quack",
        tooltip: null,
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
    expect(model).not.toBeNull();
    expect(model!.interactions.map((i) => i.targetId)).toEqual(["Shape"]);
    expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
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
      expect(model!.interactions.map((i) => i.action)).toEqual([url]);
    });

    it.each([
      ["./docs/shape.html"],
      ["docs/shape.html"],
      ["/docs/shape.html"],
      ["#shape"],
    ])("resolves the relative URL %s — the allowlist rejects schemes, it does not require absolute URLs", (url) => {
      const { model, diagnostics } = buildClassModel(hrefDocument(url));

      expect(diagnostics).toEqual([]);
      expect(model!.interactions.map((i) => i.action)).toEqual([url]);
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
      expect(model).not.toBeNull();
      expect(model!.interactions).toEqual([]);
      expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
    });

    it("drops a data: URL with an error diagnostic naming the scheme", () => {
      const { model, diagnostics } = buildClassModel(
        hrefDocument("data:text/html;base64,PHNjcmlwdD4="),
      );

      expect(diagnostics.map((d) => d.message)).toEqual([
        'click "Shape" uses the disallowed URL scheme "data:"; only http:, https: ' +
          "and mailto: are allowed; dropping the interaction.",
      ]);
      expect(model!.interactions).toEqual([]);
      expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
    });

    it("drops a vbscript: URL with an error diagnostic naming the scheme", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("vbscript:MsgBox(1)"));

      expect(diagnostics.map((d) => d.message)).toEqual([
        'click "Shape" uses the disallowed URL scheme "vbscript:"; only http:, https: ' +
          "and mailto: are allowed; dropping the interaction.",
      ]);
      expect(model!.interactions).toEqual([]);
    });

    it("drops a scheme-relative URL, which would adopt whatever scheme the page was served over", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("//evil.example/shape"));

      expect(diagnostics.map((d) => d.message)).toEqual([
        'click "Shape" uses a scheme-relative URL ("//evil.example/shape"), which adopts the ' +
          "page's scheme; only http:, https: and mailto: are allowed; dropping the interaction.",
      ]);
      expect(model!.interactions).toEqual([]);
      expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
    });

    it("drops a backslash-spelled scheme-relative URL, which browsers read as //", () => {
      const { model, diagnostics } = buildClassModel(hrefDocument("\\\\evil.example/shape"));

      expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
      expect(model!.interactions).toEqual([]);
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
      expect(model!.interactions).toEqual([]);
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
        expect(model!.interactions).toEqual([]);
        // The class still renders, just without a link.
        expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
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
      expect(model!.interactions.map((i) => i.action)).toEqual(["data"]);
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
    expect(model).not.toBeNull();
    expect(model!.styles).toEqual([
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
    expect(model).not.toBeNull();
    expect(model!.styles).toEqual([
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
    expect(model!.styles).toEqual([
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

  it("drops a style statement on a class that does not exist with an error diagnostic, keeping the rest", () => {
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

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'style "Ghost" references an id that does not exist; dropping the declaration.',
        line: 4,
        column: 1,
      },
    ]);
    expect(model).not.toBeNull();
    expect(model!.styles).toEqual([
      { targetId: "Shape", style: { frame: [{ property: "fill", value: "#00f" }], text: [] } },
    ]);
    expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
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

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'cssClass "Ghost" references an id that does not exist; dropping the declaration.',
        line: 6,
        column: 1,
      },
    ]);
    expect(model!.styles).toEqual([
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
        severity: "error",
        message:
          'cssClass applies "emphsis", which no classDef defines; dropping the declaration.',
        line: 6,
        column: 1,
      },
    ]);
    expect(model).not.toBeNull();
    expect(model!.styles).toEqual([]);
    expect(model!.classes.map((c) => c.id)).toEqual(["Shape"]);
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
      expect(model!.styles).toEqual([
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
      expect(model!.styles).toEqual([]);
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
      expect(model!.styles).toEqual([]);
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
      expect(model!.styles).toEqual([
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
        expect(model!.styles[0].style.frame).toEqual([{ property, value: "#fdd" }]);
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
      expect(model!.styles).toEqual([]);
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
      expect(model!.styles).toEqual([
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
      expect(model!.styles).toEqual([{ targetId: "Shape", style: { frame: [{ property, value }], text: [] } }]);
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
      expect(model!.styles).toEqual([
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
        namespaces: [{ id: "Shapes", classIds: ["namespace"] }],
        notes: [{ text: "about shapes", targetId: "namespace" }],
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
    expect(model).not.toBeNull();
    expect(model!.relationships.map((r) => r.id)).toEqual(["namespace-1"]);
    expect(model!.namespaces.map((n) => n.id)).toEqual(["namespace:1"]);
    expect(model!.notes.map((n) => n.id)).toEqual(["note:1"]);
    // All three ids address a different element, so nothing is ambiguous.
    expect(model!.timeline.entries.map((e) => e.targetId)).toEqual([
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
    expect(model).not.toBeNull();
    expect(model!.timeline.entries.map((e) => e.targetId)).toEqual(["Animal", "Duck"]);
    expect(model!.timeline.totalSteps).toBe(3);
    expect(model!.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(model!.relationships.map((r) => r.id)).toEqual(["Animal-Duck"]);
  });
});
