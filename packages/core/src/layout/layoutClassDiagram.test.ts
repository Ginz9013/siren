import { describe, expect, it } from "vitest";
import type {
  Direction,
  ClassMember,
  ClassModel,
  Point,
  PositionedClass,
  PositionedClassDiagram,
  PositionedClassNote,
  ResolvedClass,
  ResolvedClassNamespace,
  ResolvedClassNote,
  ResolvedClassRelationship,
  TextMeasurer,
  Label,
} from "../contracts";
import { CONNECTOR_LABEL_SCALE, plainLabel, plainRun } from "../label/label";
import { layoutClassDiagram } from "./layoutClassDiagram";

/** A label of these rows, each one plain run — what `a<br/>b` reads as. */
const rowsLabel = (...rows: string[]): Label => ({
  text: rows.join("\n"),
  rows: rows.map((row) => [plainRun(row)]),
});

/** Deterministic fake measurer, same fixture pattern as layoutGraph.test.ts. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

/** Width the fake measurer reports for `text` — the tests' independent yardstick. */
const measuredWidth = (text: string) => fakeMeasurer.measure(text).width;
/** Height the fake measurer reports for any single line. */
const LINE_HEIGHT = 24;

function attribute(
  partial: Partial<ClassMember> & { name: string },
): ClassMember {
  return {
    memberKind: "attribute",
    visibility: null,
    classifier: null,
    type: null,
    parameters: null,
    returnType: null,
    ...partial,
  };
}

function method(partial: Partial<ClassMember> & { name: string }): ClassMember {
  return {
    memberKind: "method",
    visibility: null,
    classifier: null,
    type: null,
    parameters: "",
    returnType: null,
    ...partial,
  };
}

function cls(
  id: string,
  members: ClassMember[] = [],
  partial: Partial<ResolvedClass> = {},
): ResolvedClass {
  return {
    id,
    generic: null,
    annotation: null,
    label: null,
    members,
    namespaceId: null,
    ...partial,
  };
}

function relationship(
  from: string,
  to: string,
  partial: Partial<ResolvedClassRelationship> = {},
): ResolvedClassRelationship {
  return {
    id: `${from}-${to}`,
    from,
    to,
    line: "solid",
    fromEnd: "none",
    toEnd: "arrow",
    label: null,
    fromMultiplicity: null,
    toMultiplicity: null,
    fromInterfaceLabel: null,
    toInterfaceLabel: null,
    ...partial,
  };
}

function namespace(
  id: string,
  classIds: string[],
  label: string = id,
  parentId: string | null = null,
  noteIds: string[] = [],
): ResolvedClassNamespace {
  return { id, parentId, label: plainLabel(label), classIds, noteIds };
}

function note(
  id: string,
  text: string,
  targetId: string | null = null,
): ResolvedClassNote {
  return { id, label: plainLabel(text), targetId };
}

function classModel(partial: Partial<ClassModel> = {}): ClassModel {
  return {
    accTitle: null,
    accDescr: null,
    direction: "TB",
    classes: [],
    relationships: [],
    namespaces: [],
    notes: [],
    interactions: [],
    styles: [],
    timeline: { totalSteps: 0, entries: [] },
    ...partial,
  };
}

function classById(
  diagram: PositionedClassDiagram,
  id: string,
): PositionedClass {
  const found = diagram.classes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no positioned class ${id}`);
  return found;
}

function noteById(
  diagram: PositionedClassDiagram,
  id: string,
): PositionedClassNote {
  const found = diagram.notes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no positioned note ${id}`);
  return found;
}

/** Straight-line distance between two points. */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Total length of a routed path, walked segment by segment. */
function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

/**
 * Which side of the ray `a`→`b` the point `p` falls on, as the sign of the
 * cross product: positive one side, negative the other, zero on the ray.
 */
function sideOfLine(p: Point, a: Point, b: Point): number {
  return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

/** Any rectangle in diagram coordinates — a class box, a frame, a note. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether a point sits on or inside a positioned box. */
function touches(point: Point, box: Rect): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Whether two rectangles share any area. Touching edges do not count. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * 0 when some segment of `points` runs into or along `rect`, else 1 — the
 * question "does this line strike that box", asked of every segment.
 */
function distanceToRect(points: Point[], rect: Rect): number {
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    // Orthogonal segments: a line strikes the box when its span overlaps
    // the box's along the line and it lies within the box across it.
    if (left <= rect.x + rect.width && right >= rect.x && top <= rect.y + rect.height && bottom >= rect.y) {
      return 0;
    }
  }
  return 1;
}

/**
 * The rectangle a run of text covers when drawn centered on `anchor`: the
 * tests' independent yardstick for "where the glyph actually lands".
 */
function textBoxAt(text: string, anchor: Point): Rect {
  const size = fakeMeasurer.measure(text);
  return {
    x: anchor.x - size.width / 2,
    y: anchor.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

/** Each multiplicity of a relationship paired with the class box it belongs beside. */
function multiplicitiesWithTheirClassBoxes(
  diagram: PositionedClassDiagram,
): { text: string; anchor: Point; box: PositionedClass }[] {
  return diagram.relationships.flatMap((routed) =>
    (
      [
        [routed.fromMultiplicity, routed.fromMultiplicityAnchor, routed.from],
        [routed.toMultiplicity, routed.toMultiplicityAnchor, routed.to],
      ] as const
    )
      .filter(([text, anchor]) => text !== null && anchor !== null)
      .map(([text, anchor, classId]) => ({
        text: text!,
        anchor: anchor!,
        box: classById(diagram, classId),
      })),
  );
}

describe("layoutClassDiagram", () => {
  describe("class box sizing", () => {
    it("gives every class a box that fits its widest measured line and all its stacked lines", () => {
      const model = classModel({
        classes: [
          cls("Animal", [
            attribute({ visibility: "+", type: "int", name: "age" }),
          ]),
          cls("Duck"),
        ],
        relationships: [relationship("Animal", "Duck")],
      });

      const diagram = layoutClassDiagram(model, { measureText: fakeMeasurer });

      expect(diagram.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
      const animal = classById(diagram, "Animal");
      // The member line "+int age" is wider than the name "Animal", and the
      // box has to hold it with padding to spare on both sides.
      expect(animal.width).toBeGreaterThan(measuredWidth("+int age"));
      // Name line plus one member line, again with padding to spare.
      expect(animal.height).toBeGreaterThan(LINE_HEIGHT * 2);
    });

    it("widens a class box by exactly the extra measured width when its widest line lengthens", () => {
      // "+int age" (8 chars) is the widest line of this class; "Animal" (6) is not.
      const narrow = layoutClassDiagram(
        classModel({
          classes: [
            cls("Animal", [
              attribute({ visibility: "+", type: "int", name: "age" }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );
      const wide = layoutClassDiagram(
        classModel({
          classes: [
            cls("Animal", [
              attribute({ visibility: "+", type: "int", name: "ages" }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(classById(wide, "Animal").width).toBe(
        classById(narrow, "Animal").width +
          (measuredWidth("+int ages") - measuredWidth("+int age")),
      );
    });

    it("grows a class box by exactly one line height per extra member", () => {
      const oneMember = layoutClassDiagram(
        classModel({ classes: [cls("Animal", [attribute({ name: "age" })])] }),
        { measureText: fakeMeasurer },
      );
      const twoMembers = layoutClassDiagram(
        classModel({
          classes: [
            cls("Animal", [
              attribute({ name: "age" }),
              attribute({ name: "id" }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(classById(twoMembers, "Animal").height).toBe(
        classById(oneMember, "Animal").height + LINE_HEIGHT,
      );
    });
  });

  describe("compartments", () => {
    it("records a divider between the name and the attributes, and another between the attributes and the methods", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Duck", [
              attribute({ visibility: "+", type: "String", name: "beakColor" }),
              method({ visibility: "+", name: "swim" }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const duck = classById(diagram, "Duck");
      // Name line first, then the attribute compartment, then the methods.
      expect(duck.attributes?.dividerY).toBeGreaterThan(duck.y + LINE_HEIGHT);
      expect(duck.methods?.dividerY).toBeGreaterThan(
        duck.attributes!.dividerY + LINE_HEIGHT,
      );
      expect(duck.methods?.dividerY).toBeLessThan(duck.y + duck.height);
    });

    it("stacks each member line at its own y, attributes before methods, in declaration order", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Duck", [
              attribute({ name: "beakColor" }),
              attribute({ name: "age" }),
              method({ name: "swim" }),
              method({ name: "quack" }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const duck = classById(diagram, "Duck");
      const attributeYs = duck.attributes!.members.map((m) => m.y);
      const methodYs = duck.methods!.members.map((m) => m.y);
      expect(attributeYs).toHaveLength(2);
      expect(methodYs).toHaveLength(2);
      expect(attributeYs[1]).toBe(attributeYs[0] + LINE_HEIGHT);
      expect(methodYs[0]).toBeGreaterThan(attributeYs[1]);
      expect(methodYs[1]).toBe(methodYs[0] + LINE_HEIGHT);
      for (const y of [...attributeYs, ...methodYs]) {
        expect(y).toBeGreaterThan(duck.y);
        expect(y).toBeLessThan(duck.y + duck.height);
      }
    });

    it("draws every member line inside its box's left padding", () => {
      const diagram = layoutClassDiagram(
        classModel({ classes: [cls("Duck", [attribute({ name: "age" })])] }),
        { measureText: fakeMeasurer },
      );

      const duck = classById(diagram, "Duck");
      const member = duck.attributes!.members[0];
      expect(member.x).toBeGreaterThan(duck.x);
      expect(member.x).toBeLessThan(duck.x + duck.width);
    });

    it("records no compartment for a class that declares only a name", () => {
      const diagram = layoutClassDiagram(
        classModel({ classes: [cls("Animal")] }),
        { measureText: fakeMeasurer },
      );

      const animal = classById(diagram, "Animal");
      expect(animal.attributes).toBeNull();
      expect(animal.methods).toBeNull();
    });

    it("records only a method compartment for a class that declares no attributes", () => {
      const diagram = layoutClassDiagram(
        classModel({ classes: [cls("Animal", [method({ name: "swim" })])] }),
        { measureText: fakeMeasurer },
      );

      const animal = classById(diagram, "Animal");
      expect(animal.attributes).toBeNull();
      expect(animal.methods?.members).toHaveLength(1);
      expect(animal.methods?.dividerY).toBeGreaterThan(animal.y + LINE_HEIGHT);
    });
  });

  describe("member text", () => {
    it("rebuilds each member line from the parts the model kept, its classifier left out of the text", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Duck", [
              attribute({ visibility: "+", type: "String", name: "beakColor" }),
              attribute({ visibility: "-", name: "id", classifier: "$" }),
              method({
                visibility: "+",
                name: "swim",
                parameters: "",
                returnType: "bool",
              }),
              method({
                visibility: "#",
                name: "quack",
                parameters: "int times",
                classifier: "*",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const duck = classById(diagram, "Duck");
      expect(duck.attributes!.members.map((m) => m.text)).toEqual([
        "+String beakColor",
        "-id",
      ]);
      expect(duck.methods!.members.map((m) => m.text)).toEqual([
        "+swim() : bool",
        "#quack(int times)",
      ]);
    });

    it("gives a member line that draws no text no height, so the next line moves up", () => {
      // Measured (Mermaid 12.2.0, Chrome): in `+x` ⏎ `$` ⏎ `+y` the `$`
      // line's label is 0 high and `+y` sits right under `+x`; the same for
      // `*`. Either is an attribute, wherever it is written.
      const layout = (members: ClassMember[]) =>
        classById(layoutClassDiagram(classModel({ classes: [cls("A", members)] }), { measureText: fakeMeasurer }), "A");
      const x = attribute({ visibility: "+", name: "x" });
      const y = attribute({ visibility: "+", name: "y" });
      const f = method({ visibility: "+", name: "f" });
      const g = method({ visibility: "+", name: "g" });
      const without = layout([x, y, f, g]);
      const withEmpty = layout([
        x,
        attribute({ name: "", classifier: "$" }),
        y,
        attribute({ name: "", classifier: "*" }),
        f,
        g,
      ]);
      expect(withEmpty.height).toBe(without.height);
      const ys = (box: typeof without) =>
        [...box.attributes!.members, ...box.methods!.members].filter((m) => m.text !== "").map((m) => [m.text, m.y]);
      expect(ys(withEmpty)).toEqual(ys(without));
    });

    it("lays out a compartment whose every line draws no text as no compartment at all", () => {
      // Measured (Mermaid 12.2.0, Chrome): `class A {` ⏎ `$` ⏎ `+f()` ⏎ `}`
      // is exactly as tall as `class A {` ⏎ `+f()` ⏎ `}`, its dividers where
      // that one's are — the `$` adds no room, not even the padding of a
      // compartment of its own.
      const layout = (members: ClassMember[]) =>
        classById(layoutClassDiagram(classModel({ classes: [cls("A", members)] }), { measureText: fakeMeasurer }), "A");
      const empty = attribute({ name: "", classifier: "$" });
      const f = method({ visibility: "+", name: "f" });
      const summary = (box: ReturnType<typeof layout>) => [
        box.height,
        box.attributes?.dividerY ?? null,
        box.methods?.dividerY ?? null,
      ];
      expect(summary(layout([empty, f]))).toEqual(summary(layout([f])));
      expect(summary(layout([empty, attribute({ name: "", classifier: "*" })]))).toEqual(summary(layout([])));
    });

    it("draws one space after the visibility marker when the member wrote one", () => {
      // Measured (Mermaid 12.2.0, Chrome): `+ x` draws `+ x`, `- int x`
      // `- int x` and `+ foo() bool` `+ foo() : bool`.
      const box = classById(
        layoutClassDiagram(
          classModel({
            classes: [
              cls("A", [
                attribute({ visibility: "+", name: "x", spaceAfterVisibility: true }),
                attribute({ visibility: "-", type: "int", name: "x", spaceAfterVisibility: true }),
                method({ visibility: "+", name: "foo", returnType: "bool", spaceAfterVisibility: true }),
              ]),
            ],
          }),
          { measureText: fakeMeasurer },
        ),
        "A",
      );
      expect([...box.attributes!.members, ...box.methods!.members].map((m) => m.text)).toEqual([
        "+ x",
        "- int x",
        "+ foo() : bool",
      ]);
    });

    it("carries each member's classifier beside its text, and measures the line without it", () => {
      // Measured (Mermaid 12.2.0, Chrome): `+x$` draws `+x` underlined and
      // `+foo()* bool` draws `+foo() : bool` in italics — the classifier is
      // a style on the whole line, never a character of it, so the line is
      // as wide as the same member without one.
      const layout = (members: ClassMember[]) =>
        classById(layoutClassDiagram(classModel({ classes: [cls("A", members)] }), { measureText: fakeMeasurer }), "A");
      const box = layout([
        attribute({ visibility: "+", name: "x", classifier: "$" }),
        attribute({ visibility: "+", name: "y" }),
        method({ visibility: "+", name: "foo", parameters: "", returnType: "bool", classifier: "*" }),
      ]);
      expect([...box.attributes!.members, ...box.methods!.members].map((m) => [m.text, m.classifier])).toEqual([
        ["+x", "$"],
        ["+y", null],
        ["+foo() : bool", "*"],
      ]);
      expect(layout([method({ visibility: "+", name: "foolong", parameters: "", classifier: "$" })]).width).toBe(
        layout([method({ visibility: "+", name: "foolong", parameters: "" })]).width,
      );
    });

    it("draws a method's return type after ` : `, and sizes the box from that text", () => {
      // Measured on Mermaid 12.2.0 (Chrome), in a class block and after
      // `A :` alike: `+foo() bool` draws `+foo() : bool`, `+foo(int a)
      // List~T~` `+foo(int a) : List<T>`, `-foo(a, b) Map~K,V~` `-foo(a, b) :
      // Map<K,V>`, `+foo() #lt;T#gt;` `+foo() : <T>`, `+foo() bool int`
      // `+foo() : bool int` and `+foo() a<br>b` `+foo() : a<br>b`; one space
      // either side of the colon, however many were written before the
      // return type. A method with none draws no colon.
      const methods = [
        method({ visibility: "+", name: "foo", parameters: "", returnType: "bool" }),
        method({ visibility: "+", name: "foo", parameters: "int a", returnType: "List~T~" }),
        method({ visibility: "-", name: "foo", parameters: "a, b", returnType: "Map~K,V~" }),
        method({ visibility: "+", name: "foo", parameters: "", returnType: "#lt;T#gt;" }),
        method({ visibility: "+", name: "foo", parameters: "", returnType: "bool int" }),
        method({ visibility: "+", name: "foo", parameters: "", returnType: "a<br>b" }),
        method({ visibility: "+", name: "foo", parameters: "" }),
      ];
      const diagram = layoutClassDiagram(classModel({ classes: [cls("A", methods)] }), { measureText: fakeMeasurer });
      const box = classById(diagram, "A");
      expect(box.methods!.members.map((m) => m.text)).toEqual([
        "+foo() : bool",
        "+foo(int a) : List<T>",
        "-foo(a, b) : Map<K,V>",
        "+foo() : <T>",
        "+foo() : bool int",
        "+foo() : a<br>b",
        "+foo()",
      ]);
      expect(box.width).toBeGreaterThan(measuredWidth("-foo(a, b) : Map<K,V>"));
    });

    it("draws a colon the author wrote before a return type as part of it, after the colon it adds", () => {
      // Measured on Mermaid 12.2.0 (Chrome): in a class block `+foo() :
      // bool` draws `+foo() : : bool` and `+bar(): int` `+bar() : : int` —
      // the written colon is the start of the return type.
      expect(
        classById(
          layoutClassDiagram(
            classModel({
              classes: [
                cls("A", [
                  method({ visibility: "+", name: "foo", parameters: "", returnType: ": bool" }),
                  method({ visibility: "+", name: "bar", parameters: "", returnType: ": int" }),
                ]),
              ],
            }),
            { measureText: fakeMeasurer },
          ),
          "A",
        ).methods!.members.map((m) => m.text),
      ).toEqual(["+foo() : : bool", "+bar() : : int"]);
    });

    it("sizes the box from the composed member text, not the bare member name", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("A", [
              method({
                visibility: "+",
                name: "swim",
                parameters: "",
                returnType: "bool",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(classById(diagram, "A").width).toBeGreaterThan(
        measuredWidth("+swim() bool"),
      );
    });
  });

  /**
   * Entity codes in a member, decoded as Mermaid 12.2.0 draws them (spec
   * `class-direction-entities`, T2, measured in Chrome): `+#lt; x` draws
   * `+< x`, `+#9829; x` `+♥ x`, and an unknown name is left as the
   * reference the browser was handed (`+#zz; x` draws `+&zz; x`).
   */
  describe("entity codes in member text", () => {
    const drawn = (...members: ClassMember[]) => {
      const box = classById(layoutClassDiagram(classModel({ classes: [cls("A", members)] }), { measureText: fakeMeasurer }), "A");
      return [...(box.attributes?.members ?? []), ...(box.methods?.members ?? [])].map((m) => m.text);
    };

    it("draws an attribute's type decoded, and measures the box from the decoded text", () => {
      expect(drawn(attribute({ visibility: "+", type: "#lt;", name: "x" }))).toEqual(["+< x"]);
      expect(drawn(attribute({ visibility: "+", type: "#9829;", name: "x" }))).toEqual(["+♥ x"]);
      expect(drawn(attribute({ visibility: "+", type: "#zz;", name: "x" }))).toEqual(["+&zz; x"]);
      const width = (member: ClassMember) =>
        classById(layoutClassDiagram(classModel({ classes: [cls("A", [member])] }), { measureText: fakeMeasurer }), "A").width;
      expect(width(attribute({ visibility: "+", type: "#lt;", name: "longername" }))).toBe(
        width(attribute({ visibility: "+", type: "<", name: "longername" })),
      );
    });

    it("draws an entity code decoded in every other position of a member", () => {
      // Measured: each as Mermaid 12.2.0 draws it, its return-type ` : ` and
      // its classifier aside (both drawn differently already).
      expect(
        drawn(
          attribute({ visibility: "+", type: "x", name: "#lt;" }),
          attribute({ visibility: "+", type: "int", name: "#59;" }),
          attribute({ visibility: "+", type: "x", name: "#amp;" }),
          attribute({ visibility: "+", type: "int", name: "a#lt;b" }),
          attribute({ type: "#lt;", name: "x" }),
          attribute({ visibility: "+", type: "#copy;", name: "x" }),
          attribute({ visibility: "+", type: "#notit;", name: "x" }),
          attribute({ visibility: "+", type: "#lt;br#gt;", name: "x" }),
          method({ visibility: "+", name: "foo", parameters: "int #lt; a, #9829; b", returnType: "bool" }),
          method({ visibility: "+", name: "foo", parameters: "", returnType: "#lt;T" }),
          method({ visibility: "+", name: "f#lt;oo", parameters: "int a" }),
        ),
      ).toEqual([
        "+x <",
        "+int ;",
        "+x &",
        "+int a<b",
        "< x",
        "+© x",
        "+¬it; x",
        "+<br> x",
        "+foo(int < a, ♥ b) : bool",
        "+foo() : <T",
        "+f<oo(int a)",
      ]);
    });

    it("resolves an HTML character reference the author wrote, as the label path does", () => {
      // Measured: Mermaid escapes a member's `<` and `>` but not its `&`, so
      // the browser resolves `+&lt x` to `+< x`, `+&amp x` to `+& x`,
      // `+&#60 x` to `+< x` and `+a&copyb x` to `+a©b x` — in one pass with
      // the entity codes, so `+#amp;lt#59; x` draws `+&lt; x`.
      expect(
        drawn(
          attribute({ visibility: "+", type: "&lt", name: "x" }),
          attribute({ visibility: "+", type: "&amp", name: "x" }),
          attribute({ visibility: "+", type: "&#60", name: "x" }),
          attribute({ visibility: "+", type: "a&copyb", name: "x" }),
          attribute({ visibility: "+", type: "#amp;lt#59;", name: "x" }),
        ),
      ).toEqual(["+< x", "+& x", "+< x", "+a©b x", "+&lt; x"]);
    });

    it("opens a generic at an entity code, as at a type name", () => {
      // Measured: `+List~#lt;~ x` draws `+List<<> x`, `+List~int#lt;~ x`
      // `+List<int<> x`, and `+foo(Map~#9829;~ m)` `+foo(Map<♥> m)` —
      // Mermaid pairs the tildes before it decodes.
      expect(
        drawn(
          attribute({ visibility: "+", type: "List~#lt;~", name: "x" }),
          attribute({ visibility: "+", type: "List~int#lt;~", name: "x" }),
          method({ visibility: "+", name: "foo", parameters: "Map~#9829;~ m" }),
        ),
      ).toEqual(["+List<<> x", "+List<int<> x", "+foo(Map<♥> m)"]);
    });

    it("decodes an entity code beside a classifier, which is no part of the text", () => {
      expect(
        drawn(
          attribute({ visibility: "+", type: "int", name: "#lt;", classifier: "$" }),
          method({ visibility: "+", name: "foo", parameters: "#lt;", classifier: "*" }),
        ),
      ).toEqual(["+int <", "+foo(<)"]);
    });
  });

  describe("annotation", () => {
    it("gives an annotated class a line of its own above the name and a box wide enough for it", () => {
      const plain = layoutClassDiagram(
        classModel({ classes: [cls("Shape")] }),
        { measureText: fakeMeasurer },
      );
      const annotated = layoutClassDiagram(
        classModel({
          classes: [cls("Shape", [], { annotation: "interface" })],
        }),
        { measureText: fakeMeasurer },
      );

      const box = classById(annotated, "Shape");
      expect(box.annotation).toBe("interface");
      expect(box.height).toBe(classById(plain, "Shape").height + LINE_HEIGHT);
      // "interface" is wider than the name "Shape", so the box grows with it.
      expect(box.width).toBeGreaterThan(measuredWidth("interface"));
    });
  });

  describe("generics", () => {
    // `~T~` is Mermaid's *authoring* delimiter for a generic; what Mermaid
    // draws is `<T>`. This board's premise is parity with what Mermaid draws,
    // so the drawn text carries angle brackets and the tildes never reach the
    // canvas.
    it("draws a class's generic parameter in angle brackets and sizes the box from the composed name", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Square", [], { generic: "Shape" }), cls("Circle")],
        }),
        { measureText: fakeMeasurer },
      );

      const square = classById(diagram, "Square");
      expect(square.label).toEqual(plainLabel("Square<Shape>"));
      // The name it draws is the widest line of this class, so the box has to
      // hold the whole composed name with padding to spare.
      expect(square.width).toBeGreaterThan(measuredWidth("Square<Shape>"));
      // A class with no generic still draws its bare id.
      expect(classById(diagram, "Circle").label).toEqual(plainLabel("Circle"));
    });

    it("decodes the entity codes in a class's generic and sizes the box from the decoded name", () => {
      // Measured on Mermaid 12.2.0 (Chrome): `class A~#lt;~` draws `A<<>`,
      // as do `~&lt;~` and `~#60;~`; `~&amp;~` draws `A<&>` and `~#quot;~`
      // `A<">`.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("A", [], { generic: "#lt;" }),
            cls("B", [], { generic: "&lt;" }),
            cls("C", [], { generic: "&amp;" }),
            cls("D", [], { generic: "#quot;" }),
            cls("E", [], { generic: "#60;" }),
            cls("F", [], { generic: "<" }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(["A", "B", "C", "D", "E"].map((id) => classById(diagram, id).label)).toEqual([
        plainLabel("A<<>"),
        plainLabel("B<<>"),
        plainLabel("C<&>"),
        plainLabel('D<">'),
        plainLabel("E<<>"),
      ]);
      // Measured as drawn: the box is the one the decoded name needs.
      expect(classById(diagram, "A").width).toBe(classById(diagram, "F").width);
    });

    it("draws a line break in a class's generic as a row of its own, and sizes the box from the rows", () => {
      // Measured on Mermaid 12.2.0 (Chrome): `class A~a<br>b~` draws `A<a`
      // over `b>`, `~a<br>b<br>c~` three rows, `~<br>~` `A<` over `>`.
      const rows = (...texts: string[]) => ({ text: texts.join("\n"), rows: texts.map((t) => [plainRun(t)]) });
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("A", [], { generic: "a\nb" }),
            cls("B", [], { generic: "a\nb\nc" }),
            cls("C", [], { generic: "\n" }),
            cls("D", [], { generic: "#lt;\nb" }),
          ],
        }),
        { measureText: fakeMeasurer },
      );
      expect(["A", "B", "C", "D"].map((id) => classById(diagram, id).label)).toEqual([
        rows("A<a", "b>"),
        rows("B<a", "b", "c>"),
        rows("C<", ">"),
        rows("D<<", "b>"),
      ]);
      expect(classById(diagram, "B").height).toBeGreaterThan(classById(diagram, "A").height);
    });

    it("draws a member's generic type and return type in angle brackets, leaving a package-visibility tilde alone", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Store", [
              attribute({ visibility: "+", type: "List~int~", name: "items" }),
              // The leading `~` here is the package-visibility marker, a
              // different token that happens to share the character.
              attribute({ visibility: "~", type: "String", name: "tag" }),
              attribute({ visibility: "+", type: "int", name: "age" }),
              method({
                visibility: "+",
                name: "all",
                parameters: "",
                returnType: "List~int~",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const store = classById(diagram, "Store");
      expect(store.attributes!.members.map((m) => m.text)).toEqual([
        "+List<int> items",
        "~String tag",
        "+int age",
      ]);
      expect(store.methods!.members.map((m) => m.text)).toEqual([
        "+all() : List<int>",
      ]);
    });

    it("draws a generic type inside a method's parameter list in angle brackets", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Store", [
              method({
                visibility: "+",
                name: "addAll",
                parameters: "List~int~ items, String tag",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(
        classById(diagram, "Store").methods!.members.map((m) => m.text),
      ).toEqual(["+addAll(List<int> items, String tag)"]);
    });

    it("converts a nested generic throughout, on the class name and on a member type", () => {
      // `class Map~String, List~int~~` reaches layout as the id `Map` and the
      // generic `String, List~int~`: the parser's capture runs to the last
      // tilde on the line, so the inner pair is still spelled with tildes.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls(
              "Map",
              [
                attribute({
                  visibility: "+",
                  type: "Map~String, List~int~~",
                  name: "lookup",
                }),
              ],
              { generic: "String, List~int~" },
            ),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const map = classById(diagram, "Map");
      expect(map.label).toEqual(plainLabel("Map<String, List<int>>"));
      expect(map.attributes!.members.map((m) => m.text)).toEqual([
        "+Map<String, List<int>> lookup",
      ]);
    });

    it("converts two independent generics on one line without interleaving them", () => {
      // Two generics side by side in one parameter list are *siblings*, not
      // nested: the first `~` closes at the second, not at the last one on
      // the line. Pairing them outside-in interleaves the two, which is what
      // this ticket exists to fix.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Registry", [
              method({
                visibility: "+",
                name: "lookup",
                parameters: "List~int~ a, Map~String,int~ b",
                returnType: "bool",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(
        classById(diagram, "Registry").methods!.members.map((m) => m.text),
      ).toEqual(["+lookup(List<int> a, Map<String,int> b) : bool"]);
    });

    it("converts a nested generic and a sibling generic on the same line", () => {
      // The case that pins the rule from both sides at once: the tilde after
      // `List` has to open (nesting) while the tilde after the first `int~~`
      // pair has to close (sibling), and no single "distance from the ends"
      // rule can do both on one line.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Registry", [
              method({
                visibility: "+",
                name: "merge",
                parameters: "Map~String, List~int~~ a, Set~int~ b",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(
        classById(diagram, "Registry").methods!.members.map((m) => m.text),
      ).toEqual(["+merge(Map<String, List<int>> a, Set<int> b)"]);
    });

    it("converts three sibling generics on one line, each on its own", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Registry", [
              method({
                visibility: "+",
                name: "store",
                parameters: "List~int~ a, Set~String~ b, Map~String,int~ c",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(
        classById(diagram, "Registry").methods!.members.map((m) => m.text),
      ).toEqual(["+store(List<int> a, Set<String> b, Map<String,int> c)"]);
    });

    it("leaves a package-visibility tilde written inside a parameter list alone", () => {
      // `~run(~int a, ~int b)` — the tildes on the parameters are visibility
      // markers the author typed into the parameter text, not generic
      // delimiters. Each is followed by a type name, so each reads as an
      // opening tilde that never closes, and an unclosed tilde is drawn as
      // itself. A real generic further along the same line still converts.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Runner", [
              method({
                visibility: "~",
                name: "run",
                parameters: "~int a, ~int b",
              }),
              method({
                visibility: "~",
                name: "runAll",
                parameters: "~int a, List~int~ b",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(
        classById(diagram, "Runner").methods!.members.map((m) => m.text),
      ).toEqual(["~run(~int a, ~int b)", "~runAll(~int a, List<int> b)"]);
    });

    it("draws a tilde with no partner literally and still converts the pairs around it", () => {
      // The documented rule for author typos: whichever tilde is left over
      // once the pairs around it are matched is drawn as itself. A missing
      // tilde therefore costs the author that one character, not the rest of
      // the line.
      //
      // Which one is left over changed with ticket 21. Under the old
      // outside-in pairing, `Map~String,List~int~` drew as
      // `Map<String,List~int>` — first tilde with last. That pairing is
      // exactly what interleaves two sibling generics, and applying it here
      // is inseparable from applying it there: the same first-with-last step
      // draws `~int a, List~int~ b` as `<int a, List~int> b`, eating a
      // package-visibility marker. Ticket 21 pairs by depth instead, so the
      // leftover is now the *outer* opening tilde and the inner pair
      // converts.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Broken", [
              attribute({ visibility: "+", type: "List~int", name: "items" }),
              attribute({
                visibility: "+",
                type: "Map~String,List~int~",
                name: "lookup",
              }),
            ]),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(
        classById(diagram, "Broken").attributes!.members.map((m) => m.text),
      ).toEqual(["+List~int items", "+Map~String,List<int> lookup"]);
    });

    it("measures a box holding two generics on one line from the converted text", () => {
      // Characterization of the measuring seam for the sibling case: the box
      // is sized from `memberText`'s output, so it holds the drawn line and
      // never pays for the four tildes that do not reach the canvas.
      const tildeIsWide: TextMeasurer = {
        measure(text: string) {
          const tildes = [...text].filter((ch) => ch === "~").length;
          return { width: text.length * 8 + tildes * 40, height: 24 };
        },
      };

      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Registry", [
              method({
                visibility: "+",
                name: "lookup",
                parameters: "List~int~ a, Map~String,int~ b",
                returnType: "bool",
              }),
            ]),
          ],
        }),
        { measureText: tildeIsWide },
      );

      const registry = classById(diagram, "Registry");
      expect(registry.width).toBeGreaterThan(
        tildeIsWide.measure("+lookup(List<int> a, Map<String,int> b) bool")
          .width,
      );
      expect(registry.width).toBeLessThan(
        tildeIsWide.measure("+lookup(List~int~ a, Map~String,int~ b) bool")
          .width,
      );
    });

    it("measures a class box from the converted text, not from the tildes the author wrote", () => {
      // A measurer that charges heavily for a tilde, so a box measured from
      // the authored spelling is a different width from one measured from the
      // drawn spelling. The real measurer's two glyphs differ far less, but
      // they do differ.
      const tildeIsWide: TextMeasurer = {
        measure(text: string) {
          const tildes = [...text].filter((ch) => ch === "~").length;
          return { width: text.length * 8 + tildes * 40, height: 24 };
        },
      };

      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Square", [], { generic: "Shape" }),
            cls("Store", [
              attribute({ visibility: "+", type: "List~int~", name: "items" }),
            ]),
          ],
        }),
        { measureText: tildeIsWide },
      );

      // Both boxes hold their drawn line with padding to spare, and neither
      // paid for the two tildes that are no longer drawn.
      const square = classById(diagram, "Square");
      expect(square.width).toBeGreaterThan(
        tildeIsWide.measure("Square<Shape>").width,
      );
      expect(square.width).toBeLessThan(
        tildeIsWide.measure("Square~Shape~").width,
      );

      const store = classById(diagram, "Store");
      expect(store.width).toBeGreaterThan(
        tildeIsWide.measure("+List<int> items").width,
      );
      expect(store.width).toBeLessThan(
        tildeIsWide.measure("+List~int~ items").width,
      );
    });
  });

  describe("relationships", () => {
    it("routes each relationship as a path from one class box to the other, carrying its type through", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Animal"), cls("Duck")],
          relationships: [
            relationship("Animal", "Duck", {
              line: "dashed",
              fromEnd: "triangle",
              toEnd: "none",
            }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(diagram.relationships).toHaveLength(1);
      const routed = diagram.relationships[0];
      expect(routed.id).toBe("Animal-Duck");
      expect(routed.from).toBe("Animal");
      expect(routed.to).toBe("Duck");
      expect(routed.line).toBe("dashed");
      expect(routed.fromEnd).toBe("triangle");
      expect(routed.toEnd).toBe("none");

      // The related classes are ranked apart, and the path runs from one
      // box to the other.
      const animal = classById(diagram, "Animal");
      const duck = classById(diagram, "Duck");
      expect(duck.y).toBeGreaterThanOrEqual(animal.y + animal.height);
      expect(routed.points.length).toBeGreaterThanOrEqual(2);
      expect(touches(routed.points[0], animal)).toBe(true);
      expect(touches(routed.points[routed.points.length - 1], duck)).toBe(true);
    });

    it("routes every relationship and note link orthogonally, as Mermaid 12's ELK layout does", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Animal"), cls("Duck"), cls("Fish"), cls("Zoo")],
          relationships: [
            relationship("Animal", "Duck"),
            relationship("Animal", "Fish"),
            relationship("Zoo", "Duck"),
            relationship("Zoo", "Fish", { label: plainLabel("keeps") }),
          ],
          notes: [note("note1", "a note", "Fish")],
        }),
        { measureText: fakeMeasurer },
      );

      const routes = [
        ...diagram.relationships.map((routed) => routed.points),
        noteById(diagram, "note1").linkPoints!,
      ];
      const slanted = routes.flatMap((points) =>
        points.slice(1).flatMap((point, index) => {
          const previous = points[index];
          return Math.abs(point.x - previous.x) < 1e-6 || Math.abs(point.y - previous.y) < 1e-6
            ? []
            : [`(${previous.x}, ${previous.y}) → (${point.x}, ${point.y})`];
        }),
      );
      expect(slanted).toEqual([]);
    });

    it("reports the line hops on each relationship's own horizontal runs, clear of its rounded corners", () => {
      // Each of A and B joined to both C and D: routes run across between
      // the rows and cross the others' vertical runs.
      const diagram = layoutClassDiagram(
        classModel({
          classes: ["A", "B", "C", "D"].map((id) => cls(id)),
          relationships: [
            relationship("A", "D"),
            relationship("B", "C"),
            relationship("A", "C"),
            relationship("B", "D"),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const hops = diagram.relationships.flatMap((routed) =>
        (routed.hops ?? []).map((hop) => ({ routed, hop })),
      );
      expect(hops.length).toBeGreaterThan(0);
      // A relationship is drawn `rounded`, corners cut back 5px (Mermaid's
      // `generateRoundedPath(points, 5)`); a hop keeps 2px clear of that.
      const ROUNDING = 5;
      for (const { routed, hop } of hops) {
        const points = routed.points;
        const [a, b] = [points[hop.segment], points[hop.segment + 1]];
        expect(a.y).toBe(hop.y);
        expect(b.y).toBe(hop.y);
        const fromStart = Math.abs(hop.x - a.x);
        const fromEnd = Math.abs(b.x - hop.x);
        expect(fromStart).toBeGreaterThanOrEqual(hop.radius + 2 + (hop.segment > 0 ? ROUNDING : 0) - 1e-6);
        expect(fromEnd).toBeGreaterThanOrEqual(
          hop.radius + 2 + (hop.segment + 2 < points.length ? ROUNDING : 0) - 1e-6,
        );
      }
    });

    it("anchors the label between the ends and each multiplicity beside its own end", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Customer"), cls("Ticket")],
          relationships: [
            relationship("Customer", "Ticket", {
              label: plainLabel("raises"),
              fromMultiplicity: "1",
              toMultiplicity: "*",
            }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const routed = diagram.relationships[0];
      const first = routed.points[0];
      const last = routed.points[routed.points.length - 1];

      expect(routed.label).not.toBeNull();
      expect(routed.label!.anchor.y).toBeGreaterThan(first.y);
      expect(routed.label!.anchor.y).toBeLessThan(last.y);

      // Each multiplicity sits beside its own end of the line: nearer that
      // end than the other end and than the label between them.
      for (const [anchor, own, other] of [
        [routed.fromMultiplicityAnchor!, first, last],
        [routed.toMultiplicityAnchor!, last, first],
      ] as const) {
        expect(distance(anchor, own)).toBeLessThan(distance(anchor, other));
        expect(distance(anchor, own)).toBeLessThan(distance(anchor, routed.label!.anchor));
      }
      // On its own hand of the line, Mermaid 12.2.0's: the from end's
      // (`startLabelRight`) right of the line's first run as it travels, the
      // to end's (`endLabelLeft`) left of its last. Nothing here is in the
      // way of either.
      expect(sideOfLine(routed.fromMultiplicityAnchor!, first, routed.points[1])).toBe(1);
      expect(sideOfLine(routed.toMultiplicityAnchor!, routed.points[routed.points.length - 2], last)).toBe(-1);
      // Beside the line, not on it.
      expect(routed.fromMultiplicityAnchor).not.toEqual(first);
      expect(routed.toMultiplicityAnchor).not.toEqual(last);
    });

    /**
     * `Keeper "1" --> "*" Animal` inside a triangle of classes, which is what
     * makes the relationship arrive at a corner rather than square-on: the
     * shape a real diagram produced when this defect was spotted by looking at
     * a rendered picture.
     */
    function cornerArrival(direction: Direction): PositionedClassDiagram {
      return layoutClassDiagram(
        classModel({
          direction,
          classes: [cls("Keeper"), cls("Animal"), cls("Habitat")],
          relationships: [
            relationship("Keeper", "Animal", {
              fromMultiplicity: "1",
              toMultiplicity: "*",
            }),
            relationship("Keeper", "Habitat", { toEnd: "none" }),
            relationship("Habitat", "Animal", { toEnd: "diamondFilled" }),
          ],
        }),
        { measureText: fakeMeasurer },
      );
    }

    /**
     * Which of a diagram's multiplicity strings are drawn on top of the class
     * box they belong to — named, so a failure says which label landed where
     * rather than just that a boolean was wrong.
     */
    function multiplicitiesOnTheirClassBox(
      diagram: PositionedClassDiagram,
    ): string[] {
      return multiplicitiesWithTheirClassBoxes(diagram)
        .filter(({ text, anchor, box }) => overlaps(textBoxAt(text, anchor), box))
        .map(({ text, box }) => `"${text}" on ${box.id}`);
    }

    it("keeps a multiplicity clear of its own class box when the line arrives at a corner", () => {
      expect(multiplicitiesOnTheirClassBox(cornerArrival("TB"))).toEqual([]);
    });

    it.each(["TB", "BT", "LR", "RL"] as const)(
      "keeps a multiplicity clear of its own class box with direction %s",
      (direction) => {
        expect(multiplicitiesOnTheirClassBox(cornerArrival(direction))).toEqual(
          [],
        );
      },
    );

    it.each(["TB", "BT", "LR", "RL"] as const)(
      "still reads each multiplicity as its own end's label with direction %s",
      (direction) => {
        const routed = cornerArrival(direction).relationships.find(
          (candidate) => candidate.id === "Keeper-Animal",
        )!;
        const points = routed.points;
        const first = points[0];
        const last = points[points.length - 1];
        const half = pathLength(points) / 2;

        for (const [anchor, own, other] of [
          [routed.fromMultiplicityAnchor!, first, last],
          [routed.toMultiplicityAnchor!, last, first],
        ] as const) {
          // Beside its own end, and never past the middle of the line — a
          // multiplicity pushed clear of one box must not arrive at the other.
          expect(distance(anchor, own)).toBeLessThan(distance(anchor, other));
          expect(distance(anchor, own)).toBeLessThanOrEqual(half);
          // Off its own line, and every other: see the test below.
        }

      },
    );

    it.each(["TB", "BT", "LR", "RL"] as const)(
      "keeps every multiplicity off every line and class box with direction %s",
      (direction) => {
        const diagram = cornerArrival(direction);
        // At the 12px a multiplicity is drawn at: the fake measurer's box,
        // scaled from its 14px.
        const texts = multiplicitiesWithTheirClassBoxes(diagram).map(({ text, anchor }) => {
          const size = fakeMeasurer.measure(text);
          const [width, height] = [size.width * CONNECTOR_LABEL_SCALE, size.height * CONNECTOR_LABEL_SCALE];
          return { text, box: { x: anchor.x - width / 2, y: anchor.y - height / 2, width, height } };
        });
        expect(texts.length).toBe(2);
        const struck = texts.flatMap(({ text, box }) => [
          ...diagram.relationships
            .filter((routed) => distanceToRect(routed.points, box) === 0)
            .map((routed) => `"${text}" on ${routed.id}`),
          ...diagram.classes.filter((cls) => overlaps(box, cls)).map((cls) => `"${text}" on ${cls.id}`),
        ]);
        expect(struck).toEqual([]);
      },
    );

    it("keeps both multiplicities of a self-relationship clear of the one box they share", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Ticket"), cls("Customer")],
          relationships: [
            relationship("Ticket", "Ticket", {
              id: "Ticket-Ticket",
              fromMultiplicity: "0..1",
              toMultiplicity: "0..*",
            }),
            relationship("Customer", "Ticket"),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(multiplicitiesOnTheirClassBox(diagram)).toEqual([]);
    });

    it("anchors nothing for a relationship with no label and no multiplicity", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Animal"), cls("Duck")],
          relationships: [relationship("Animal", "Duck")],
        }),
        { measureText: fakeMeasurer },
      );

      const routed = diagram.relationships[0];
      expect(routed.label).toBeNull();
      expect(routed.fromMultiplicityAnchor).toBeNull();
      expect(routed.toMultiplicityAnchor).toBeNull();
    });

    it("positions a lollipop's interface label and draws no class box for it", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Quacks")],
          relationships: [
            relationship("Duck-Quacks:from-interface", "Quacks", {
              fromEnd: "circle",
              toEnd: "none",
              fromInterfaceLabel: "Duck",
            }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      // Mermaid measured (mermaid-probe.mjs): the lollipop side never draws
      // a class box — only "Quacks" does.
      expect(diagram.classes.map((c) => c.id)).toEqual(["Quacks"]);

      const routed = diagram.relationships[0];
      expect(routed.fromInterfaceLabel).toBe("Duck");
      expect(routed.toInterfaceLabel).toBeNull();
      expect(routed.fromInterfaceLabelAnchor).not.toBeNull();
      expect(Number.isFinite(routed.fromInterfaceLabelAnchor!.x)).toBe(true);
      expect(Number.isFinite(routed.fromInterfaceLabelAnchor!.y)).toBe(true);
      expect(routed.toInterfaceLabelAnchor).toBeNull();
    });

    it("gives two relationships that each draw the same lollipop label their own, separately positioned, anchors", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Quacks"), cls("Flies")],
          relationships: [
            relationship("Duck-Quacks:from-interface", "Quacks", {
              fromEnd: "circle",
              toEnd: "none",
              fromInterfaceLabel: "Duck",
            }),
            relationship("Duck-Flies:from-interface", "Flies", {
              fromEnd: "circle",
              toEnd: "none",
              fromInterfaceLabel: "Duck",
            }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const [first, second] = diagram.relationships;
      expect(first.fromInterfaceLabelAnchor).not.toEqual(second.fromInterfaceLabelAnchor);
    });

    it("centres a lollipop's interface label on its line, even when its box is narrower than ELK's port clearance", () => {
      // Measured in headless Chrome, Mermaid 12.2.0 draws `Animal --() i`
      // and `Animal --() IO` with each interface label centred on its own
      // line (the line ends at x 33.56 and 114.52, the labels' centres).
      // Mermaid's interface node is never narrower than about 35px, so its
      // `alignDegenerateNodeToAnchor` never has to move it; Siren's is the
      // label plus 8px, 16px here with the fake measurer, which leaves ELK's
      // port off its middle — and the core moves it onto its line, which is
      // the picture Mermaid draws.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Animal")],
          relationships: [
            relationship("Animal", "Animal-i:to-interface", { toEnd: "circle", toInterfaceLabel: "i" }),
            relationship("Animal", "Animal-IO:to-interface", { toEnd: "circle", toInterfaceLabel: "IO" }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      for (const routed of diagram.relationships) {
        expect(routed.toInterfaceLabelAnchor!.x, routed.id).toBeCloseTo(routed.points.at(-1)!.x, 6);
      }
    });
  });

  describe("namespaces", () => {
    /** `namespace BaseShapes { Triangle, Square }`, plus an outsider linked to it. */
    function grouped(): PositionedClassDiagram {
      return layoutClassDiagram(
        classModel({
          classes: [
            cls("Triangle", [], { namespaceId: "BaseShapes" }),
            cls("Square", [], { namespaceId: "BaseShapes" }),
            cls("Duck"),
          ],
          namespaces: [namespace("BaseShapes", ["Triangle", "Square"])],
          relationships: [relationship("Square", "Duck")],
        }),
        { measureText: fakeMeasurer },
      );
    }

    it("frames a namespace's member classes with padding on every side, and anchors its label above them", () => {
      const diagram = grouped();

      expect(diagram.namespaces).toHaveLength(1);
      const frame = diagram.namespaces[0];
      expect(frame.id).toBe("BaseShapes");
      expect(frame.label.label).toEqual(plainLabel("BaseShapes"));
      // A frame is drawn like every other element, so it stays on the canvas.
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);

      const members = ["Triangle", "Square"].map((id) =>
        classById(diagram, id),
      );
      for (const box of members) {
        expect(frame.x).toBeLessThan(box.x);
        expect(frame.y).toBeLessThan(box.y);
        expect(frame.x + frame.width).toBeGreaterThan(box.x + box.width);
        expect(frame.y + frame.height).toBeGreaterThan(box.y + box.height);
      }

      // The label sits inside the frame and clear of every member box.
      const halfLabel = measuredWidth("BaseShapes") / 2;
      expect(frame.label.anchor.x - halfLabel).toBeGreaterThanOrEqual(frame.x);
      expect(frame.label.anchor.x + halfLabel).toBeLessThanOrEqual(
        frame.x + frame.width,
      );
      expect(frame.label.anchor.y - LINE_HEIGHT / 2).toBeGreaterThanOrEqual(
        frame.y,
      );
      expect(frame.label.anchor.y + LINE_HEIGHT / 2).toBeLessThanOrEqual(
        Math.min(...members.map((box) => box.y)),
      );
    });

    it("keeps every frame, box and route on the canvas, the title band above the first member", () => {
      const diagram = grouped();
      const frame = diagram.namespaces[0];
      const members = ["Triangle", "Square"].map((id) =>
        classById(diagram, id),
      );

      // The frame comes from the layout core with its title band inside it,
      // so nothing reaches above the canvas and nothing has to be moved.
      expect(Math.min(...members.map((box) => box.y))).toBeGreaterThan(
        frame.y + LINE_HEIGHT,
      );
      for (const box of [...diagram.namespaces, ...diagram.classes, ...diagram.notes]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(diagram.width);
        expect(box.y + box.height).toBeLessThanOrEqual(diagram.height);
      }
      for (const routed of diagram.relationships) {
        for (const point of routed.points) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("lays namespaces out before the classes in none, as Mermaid 12.2.0 hands them to ELK", () => {
      // Measured in headless Chrome: `class X`, then `namespace N1 { P }`,
      // `namespace N2 { Q }`, then `class Y` — Mermaid draws N1, N2, X, Y
      // from left to right, X declared first or not.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("X"),
            cls("P", [], { namespaceId: "N1" }),
            cls("Q", [], { namespaceId: "N2" }),
            cls("Y"),
          ],
          namespaces: [namespace("N1", ["P"]), namespace("N2", ["Q"])],
        }),
        { measureText: fakeMeasurer },
      );

      const [n1, n2] = diagram.namespaces;
      const x = classById(diagram, "X");
      const y = classById(diagram, "Y");
      expect(n1.x + n1.width).toBeLessThanOrEqual(n2.x);
      expect(n2.x + n2.width).toBeLessThanOrEqual(x.x);
      expect(x.x + x.width).toBeLessThanOrEqual(y.x);
    });

    it("leaves a class in no namespace outside every frame", () => {
      const diagram = grouped();

      const duck = classById(diagram, "Duck");
      expect(overlaps(duck, diagram.namespaces[0])).toBe(false);
    });

    it("frames nothing for a namespace naming no class this diagram has", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Duck")],
          namespaces: [namespace("Empty", [])],
        }),
        { measureText: fakeMeasurer },
      );

      expect(diagram.namespaces).toEqual([]);
    });
  });

  describe("notes", () => {
    /** A free note and a note attached to `Duck`, alongside `Animal <|-- Duck`. */
    function annotated(): PositionedClassDiagram {
      return layoutClassDiagram(
        classModel({
          classes: [cls("Animal"), cls("Duck")],
          relationships: [relationship("Animal", "Duck")],
          notes: [
            note("note1", "ducks are birds", "Duck"),
            note("note2", "a free-standing remark"),
          ],
        }),
        { measureText: fakeMeasurer },
      );
    }

    it("gives every note a box that fits its text, overlapping no class box", () => {
      const diagram = annotated();

      expect(diagram.notes.map((n) => n.id)).toEqual(["note1", "note2"]);
      expect(diagram.notes.map((n) => n.label.text)).toEqual([
        "ducks are birds",
        "a free-standing remark",
      ]);
      for (const box of diagram.notes) {
        expect(box.width).toBeGreaterThan(measuredWidth(box.label.text));
        expect(box.height).toBeGreaterThan(LINE_HEIGHT);
        for (const cls of diagram.classes) {
          expect(overlaps(box, cls)).toBe(false);
        }
      }
    });

    it("lays an attached note out a layer before its class, as Mermaid 12.2.0 links the note to the class", () => {
      // Measured in headless Chrome: `A --> B` with `note for B "hi"` under
      // TB draws the note above B, beside A's layer — Mermaid's edge runs
      // from the note to the class.
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("A"), cls("B")],
          relationships: [relationship("A", "B")],
          notes: [note("note1", "hi", "B")],
        }),
        { measureText: fakeMeasurer },
      );

      const attached = noteById(diagram, "note1");
      expect(attached.y + attached.height).toBeLessThanOrEqual(classById(diagram, "B").y);
    });

    it("leaves a free note unconnected", () => {
      expect(noteById(annotated(), "note2").linkPoints).toBeNull();
    });

    it("connects an attached note's box to its target class's box", () => {
      const diagram = annotated();

      const attached = noteById(diagram, "note1");
      const duck = classById(diagram, "Duck");
      expect(attached.linkPoints).not.toBeNull();
      const points = attached.linkPoints!;
      expect(points.length).toBeGreaterThanOrEqual(2);
      // The connector runs from the note it belongs to towards its target.
      expect(touches(points[0], attached)).toBe(true);
      expect(touches(points[points.length - 1], duck)).toBe(true);
    });
  });

  describe("direction", () => {
    /** `A --> B`, laid out in the given direction. */
    function pair(direction: ClassModel["direction"]): PositionedClassDiagram {
      return layoutClassDiagram(
        classModel({
          direction,
          classes: [cls("A"), cls("B")],
          relationships: [relationship("A", "B")],
        }),
        { measureText: fakeMeasurer },
      );
    }

    it("ranks a TB diagram downward and an LR diagram rightward, and carries the direction through", () => {
      const topBottom = pair("TB");
      const leftRight = pair("LR");

      expect(topBottom.direction).toBe("TB");
      expect(leftRight.direction).toBe("LR");
      expect(classById(topBottom, "B").y).toBeGreaterThan(
        classById(topBottom, "A").y,
      );
      expect(classById(leftRight, "B").x).toBeGreaterThan(
        classById(leftRight, "A").x,
      );
      // The same model laid out both ways places its classes differently.
      expect(classById(leftRight, "B").y).not.toBe(
        classById(topBottom, "B").y,
      );
    });

    it("ranks BT upward and RL leftward", () => {
      const bottomTop = pair("BT");
      const rightLeft = pair("RL");

      expect(classById(bottomTop, "B").y).toBeLessThan(
        classById(bottomTop, "A").y,
      );
      expect(classById(rightLeft, "B").x).toBeLessThan(
        classById(rightLeft, "A").x,
      );
    });
  });

  describe("author styling and interaction", () => {
    it("carries each class's resolved style declarations through, in declaration order, and leaves an unstyled class with none", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Duck"), cls("Animal")],
          styles: [
            {
              targetId: "Duck",
              style: {
                frame: [
                  { property: "fill", value: "#fdd" },
                  { property: "stroke", value: "#c00" },
                ],
                text: [{ property: "fill", value: "#fff" }],
              },
            },
          ],
        }),
        { measureText: fakeMeasurer },
      );

      // Both halves, unaltered. Layout sizes a class box from its text, but
      // which declarations that text takes is `resolveStyles`' answer and
      // this stage carries it rather than reading it.
      expect(classById(diagram, "Duck").style).toEqual({
        frame: [
          { property: "fill", value: "#fdd" },
          { property: "stroke", value: "#c00" },
        ],
        text: [{ property: "fill", value: "#fff" }],
      });
      // No declarations, so the renderer emits no `style` attribute at all.
      expect(classById(diagram, "Animal").style).toEqual({ frame: [], text: [] });
    });

    it("carries each class's resolved interaction through, and leaves a class named by none with null", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Duck"), cls("Animal")],
          interactions: [
            {
              targetId: "Duck",
              interactionKind: "call",
              action: "showDetails",
              argument: "Duck",
              tooltip: "What a duck is",
            },
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(classById(diagram, "Duck").interaction).toEqual({
        targetId: "Duck",
        interactionKind: "call",
        action: "showDetails",
        argument: "Duck",
        tooltip: "What a duck is",
      });
      expect(classById(diagram, "Animal").interaction).toBeNull();
    });

    it("gives a class named by two interactions the last of them, as a class styled twice keeps the last value", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Duck")],
          interactions: [
            {
              targetId: "Duck",
              interactionKind: "href",
              action: "https://example.com/duck",
              argument: null,
              tooltip: null,
            },
            {
              targetId: "Duck",
              interactionKind: "call",
              action: "showDetails",
              argument: null,
              tooltip: null,
            },
          ],
        }),
        { measureText: fakeMeasurer },
      );

      // One class draws one way: it is either a link or a click hook, never
      // both, so a second `click` statement replaces the first rather than
      // joining it — the answer a second `style` statement already gets.
      expect(classById(diagram, "Duck").interaction).toEqual({
        targetId: "Duck",
        interactionKind: "call",
        action: "showDetails",
        argument: null,
        tooltip: null,
      });
    });
  });

  describe("bounds", () => {
    it("reports a width and height that contain every class box, relationship path, label and multiplicity", () => {
      const diagram = layoutClassDiagram(
        classModel({
          direction: "LR",
          classes: [
            cls("Customer", [
              attribute({ visibility: "+", type: "String", name: "name" }),
            ]),
            cls("Ticket", [method({ visibility: "+", name: "close" })]),
          ],
          relationships: [
            relationship("Customer", "Ticket", {
              label: plainLabel("raises a great many of"),
              fromMultiplicity: "1",
              toMultiplicity: "*",
            }),
            relationship("Ticket", "Ticket", {
              id: "Ticket-Ticket",
              fromMultiplicity: "0..1",
              toMultiplicity: "0..*",
            }),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const withinBounds = (point: Point, halfWidth = 0, halfHeight = 0) => {
        expect(point.x - halfWidth).toBeGreaterThanOrEqual(0);
        expect(point.y - halfHeight).toBeGreaterThanOrEqual(0);
        expect(point.x + halfWidth).toBeLessThanOrEqual(diagram.width);
        expect(point.y + halfHeight).toBeLessThanOrEqual(diagram.height);
      };

      for (const box of diagram.classes) {
        withinBounds({ x: box.x, y: box.y });
        withinBounds({ x: box.x + box.width, y: box.y + box.height });
      }

      for (const routed of diagram.relationships) {
        for (const point of routed.points) withinBounds(point);
        if (routed.label) {
          const size = fakeMeasurer.measure(routed.label.label.text);
          withinBounds(routed.label.anchor, size.width / 2, size.height / 2);
        }
        for (const [text, anchor] of [
          [routed.fromMultiplicity, routed.fromMultiplicityAnchor],
          [routed.toMultiplicity, routed.toMultiplicityAnchor],
        ] as const) {
          if (anchor) {
            const size = fakeMeasurer.measure(text!);
            withinBounds(anchor, size.width / 2, size.height / 2);
          }
        }
      }
    });

    it("grows its width and height to contain namespace frames, their labels, note boxes and connectors", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Triangle", [], { namespaceId: "BaseShapes" }),
            cls("Square", [], { namespaceId: "BaseShapes" }),
            cls("Duck"),
          ],
          namespaces: [
            // A label far wider than the two small boxes it groups, so the
            // frame reaches past what the graph itself needed.
            namespace(
              "BaseShapes",
              ["Triangle", "Square"],
              "Base shapes and every last one of their many close and distant relatives",
            ),
          ],
          relationships: [relationship("Square", "Duck")],
          notes: [
            note("note1", "ducks are birds", "Duck"),
            note("note2", "a free-standing remark"),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const withinBounds = (point: Point, halfWidth = 0, halfHeight = 0) => {
        expect(point.x - halfWidth).toBeGreaterThanOrEqual(0);
        expect(point.y - halfHeight).toBeGreaterThanOrEqual(0);
        expect(point.x + halfWidth).toBeLessThanOrEqual(diagram.width);
        expect(point.y + halfHeight).toBeLessThanOrEqual(diagram.height);
      };

      const boxes: Rect[] = [
        ...diagram.classes,
        ...diagram.namespaces,
        ...diagram.notes,
      ];
      expect(boxes).toHaveLength(6);
      for (const box of boxes) {
        withinBounds({ x: box.x, y: box.y });
        withinBounds({ x: box.x + box.width, y: box.y + box.height });
      }

      for (const frame of diagram.namespaces) {
        const size = fakeMeasurer.measure(frame.label.label.text);
        withinBounds(frame.label.anchor, size.width / 2, size.height / 2);
      }

      for (const box of diagram.notes) {
        for (const point of box.linkPoints ?? []) withinBounds(point);
      }
    });
  });

  describe("labels", () => {
    // Each row past the first adds one 14px × 1.5 = 21px line, Mermaid's line
    // height; the measurer's 24px answer for one line is that line and 3px of
    // padding, which a label of any number of rows carries once.
    const ROW_HEIGHT = 21;

    it("sizes a class's name band for every row of its label, which replaces the id and generic it would draw", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [
            cls("Order", [], { label: rowsLabel("Order", "Line"), generic: "T" }),
            cls("Plain"),
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const order = classById(diagram, "Order");
      // Measured: a label replaces the whole drawn name, generic included.
      expect(order.label).toEqual(rowsLabel("Order", "Line"));
      expect(order.labelBox.height).toBe(LINE_HEIGHT + ROW_HEIGHT);
      expect(order.labelBox.rows.map((row) => row.width)).toEqual([
        measuredWidth("Order"),
        measuredWidth("Line"),
      ]);
      // One row taller than a class whose name is one row, and as wide as
      // the widest row rather than as the two rows written end to end.
      const plain = classById(diagram, "Plain");
      expect(order.height).toBe(plain.height + ROW_HEIGHT);
      expect(order.width).toBe(plain.width + measuredWidth("Order") - measuredWidth("Plain"));
      // A class with no label draws its id as one plain run.
      expect(plain.label).toEqual(plainLabel("Plain"));
    });

    it("keeps clear the space every row of a relationship's label needs, and reports the box it measured", () => {
      const laidOutWith = (label: Label) =>
        layoutClassDiagram(
          classModel({
            classes: [cls("Order"), cls("Line")],
            relationships: [relationship("Order", "Line", { label })],
          }),
          { measureText: fakeMeasurer },
        );
      const gap = (diagram: PositionedClassDiagram) =>
        classById(diagram, "Line").y - classById(diagram, "Order").y;

      const oneRow = laidOutWith(plainLabel("holds"));
      const twoRows = laidOutWith(rowsLabel("holds", "many"));

      const routed = twoRows.relationships[0];
      expect(routed.label?.label).toEqual(rowsLabel("holds", "many"));
      // Measured at the 12px `.siren-relationship-label` is drawn at
      // (`--siren-label-font-size`), not the 14px the measurer measures at:
      // the same text 12/14 as large is 12/14 the size, and its second row
      // one 12px × 1.5 = 18px line.
      expect(routed.label!.labelBox.height).toBeCloseTo(LINE_HEIGHT * CONNECTOR_LABEL_SCALE + 18, 6);
      expect(routed.label!.labelBox.width).toBeCloseTo(measuredWidth("holds") * CONNECTOR_LABEL_SCALE, 6);
      expect(gap(twoRows)).toBeGreaterThan(gap(oneRow));
    });

    // The spec (decision 1, measured on mermaid 11.17.2): a class
    // relationship's label wraps at Mermaid's 200px scaled to the 12px it is
    // drawn at, 150px of text. `fakeMeasurer` at 12px is 8 × 12/14 px a
    // character, so 21 characters (144px) fit and 22 (150.86px) do not.
    it("wraps a relationship label wider than 150px at its spaces, and the relationship carries the wrapped rows", () => {
      const [routed] = layoutClassDiagram(
        classModel({
          classes: [cls("Order"), cls("Line")],
          relationships: [
            relationship("Order", "Line", { label: plainLabel("alpha beta gamma delta epsilon zeta") }),
          ],
        }),
        { measureText: fakeMeasurer },
      ).relationships;

      expect(routed.label!.label).toEqual(rowsLabel("alpha beta gamma", "delta epsilon zeta"));
      expect(routed.label!.labelBox.width).toBe(150);
      // A 12px line of the measurer's 24 × 12/14, then one 12px × 1.5 = 18px row.
      expect(routed.label!.labelBox.height).toBeCloseTo(LINE_HEIGHT * CONNECTOR_LABEL_SCALE + 18, 6);
    });

    it("gives a namespace's label strip room for every row of its label, clear of the boxes it frames", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Lion", [], { namespaceId: "namespace:1" })],
          namespaces: [
            { id: "namespace:1", parentId: null, label: rowsLabel("Big", "Zoo"), classIds: ["Lion"], noteIds: [] },
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const [frame] = diagram.namespaces;
      expect(frame.label.label).toEqual(rowsLabel("Big", "Zoo"));
      expect(frame.label.labelBox.height).toBe(LINE_HEIGHT + ROW_HEIGHT);
      // Both rows inside the frame and above the box it frames.
      const lion = classById(diagram, "Lion");
      expect(frame.label.anchor.y - frame.label.labelBox.height / 2).toBeGreaterThanOrEqual(frame.y);
      expect(frame.label.anchor.y + frame.label.labelBox.height / 2).toBeLessThanOrEqual(lion.y);
    });

    it("sizes a note's box around every row of its label, and reports the box it measured", () => {
      const diagram = layoutClassDiagram(
        classModel({
          notes: [
            { id: "note:1", label: rowsLabel("can fly", "can swim"), targetId: null },
            { id: "note:2", label: plainLabel("can fly"), targetId: null },
          ],
        }),
        { measureText: fakeMeasurer },
      );

      const twoRows = noteById(diagram, "note:1");
      const oneRow = noteById(diagram, "note:2");
      expect(twoRows.label).toEqual(rowsLabel("can fly", "can swim"));
      expect(twoRows.labelBox.height).toBe(LINE_HEIGHT + ROW_HEIGHT);
      expect(twoRows.height).toBe(oneRow.height + ROW_HEIGHT);
      expect(twoRows.width).toBe(oneRow.width + measuredWidth("can swim") - measuredWidth("can fly"));
    });
  });
});

/**
 * Nested namespaces (spec `class-nested-namespaces`, measured on Mermaid
 * 12.2.0): `namespace N { namespace M { class A } }` draws the frame N around
 * the frame `N.M` around A — the outer frame there even when it holds no
 * class of its own.
 */
describe("layoutClassDiagram — nested namespaces", () => {
  /** Whether `inner` lies wholly inside `outer`, every edge strictly within. */
  const encloses = (outer: Rect, inner: Rect): boolean =>
    outer.x < inner.x &&
    outer.y < inner.y &&
    inner.x + inner.width < outer.x + outer.width &&
    inner.y + inner.height < outer.y + outer.height;
  const frameById = (diagram: PositionedClassDiagram, id: string) => {
    const frame = diagram.namespaces.find((n) => n.id === id);
    if (frame === undefined) throw new Error(`no frame ${id} was laid out`);
    return frame;
  };
  const layOut = (partial: Partial<ClassModel>) =>
    layoutClassDiagram(classModel(partial), { measureText: fakeMeasurer });

  it("frames a namespace holding only a namespace, around the inner frame", () => {
    const diagram = layOut({
      classes: [cls("A", [], { namespaceId: "namespace:2" })],
      namespaces: [namespace("namespace:1", [], "N"), namespace("namespace:2", ["A"], "M", "namespace:1")],
    });

    // Outer first, the order the renderer paints them in.
    expect(diagram.namespaces.map((n) => n.id)).toEqual(["namespace:1", "namespace:2"]);
    const outer = frameById(diagram, "namespace:1");
    const inner = frameById(diagram, "namespace:2");
    expect(encloses(outer, inner)).toBe(true);
    expect(encloses(inner, classById(diagram, "A"))).toBe(true);
    // Each title in its own frame's band, the inner one below the outer one.
    expect(outer.label.anchor.y).toBeLessThan(inner.y);
    expect(inner.label.anchor.y).toBeLessThan(classById(diagram, "A").y);
  });

  it("frames three levels, each inside the one around it", () => {
    const diagram = layOut({
      classes: [cls("A", [], { namespaceId: "namespace:3" })],
      namespaces: [
        namespace("namespace:1", [], "N"),
        namespace("namespace:2", [], "M", "namespace:1"),
        namespace("namespace:3", ["A"], "L", "namespace:2"),
      ],
    });

    const [n, m, l] = ["namespace:1", "namespace:2", "namespace:3"].map((id) => frameById(diagram, id));
    expect(encloses(n, m)).toBe(true);
    expect(encloses(m, l)).toBe(true);
    expect(encloses(l, classById(diagram, "A"))).toBe(true);
  });

  it("frames two sibling namespaces inside their parent, apart from each other", () => {
    const diagram = layOut({
      classes: [cls("A", [], { namespaceId: "namespace:2" }), cls("B", [], { namespaceId: "namespace:3" })],
      namespaces: [
        namespace("namespace:1", [], "N"),
        namespace("namespace:2", ["A"], "M", "namespace:1"),
        namespace("namespace:3", ["B"], "K", "namespace:1"),
      ],
    });

    const [n, m, k] = ["namespace:1", "namespace:2", "namespace:3"].map((id) => frameById(diagram, id));
    expect(encloses(n, m)).toBe(true);
    expect(encloses(n, k)).toBe(true);
    expect(overlaps(m, k)).toBe(false);
    expect(encloses(k, classById(diagram, "B"))).toBe(true);
  });

  it("frames an outer namespace around its own classes and its inner frame, with relationships across the levels", () => {
    // `namespace N { class X; namespace M { class A } }`, `class B`,
    // `A --> B`, `X --> A`, under TB and LR alike.
    for (const direction of ["TB", "LR"] as const) {
      const diagram = layOut({
        direction,
        classes: [
          cls("X", [], { namespaceId: "namespace:1" }),
          cls("A", [], { namespaceId: "namespace:2" }),
          cls("B"),
        ],
        namespaces: [namespace("namespace:1", ["X"], "N"), namespace("namespace:2", ["A"], "M", "namespace:1")],
        relationships: [relationship("A", "B"), relationship("X", "A")],
      });

      const outer = frameById(diagram, "namespace:1");
      const inner = frameById(diagram, "namespace:2");
      expect([direction, encloses(outer, inner)]).toEqual([direction, true]);
      expect([direction, encloses(outer, classById(diagram, "X"))]).toEqual([direction, true]);
      expect([direction, overlaps(inner, classById(diagram, "X"))]).toEqual([direction, false]);
      expect([direction, encloses(inner, classById(diagram, "A"))]).toEqual([direction, true]);
      expect([direction, overlaps(outer, classById(diagram, "B"))]).toEqual([direction, false]);
      expect([direction, diagram.relationships.map((r) => r.points.length >= 2)]).toEqual([direction, [true, true]]);
    }
  });
});

/**
 * Notes written inside a namespace (measured on Mermaid 12.2.0, spec
 * `class-nested-namespaces`): each is drawn inside its namespace's frame,
 * `note for X` too when X stands outside it, its connector still drawn.
 */
describe("layoutClassDiagram — notes inside namespaces", () => {
  const encloses = (outer: Rect, inner: Rect): boolean =>
    outer.x < inner.x &&
    outer.y < inner.y &&
    inner.x + inner.width < outer.x + outer.width &&
    inner.y + inner.height < outer.y + outer.height;
  const frameById = (diagram: PositionedClassDiagram, id: string) => {
    const frame = diagram.namespaces.find((n) => n.id === id);
    if (frame === undefined) throw new Error(`no frame ${id} was laid out`);
    return frame;
  };
  const noteOf = (diagram: PositionedClassDiagram, id: string) => {
    const placed = diagram.notes.find((n) => n.id === id);
    if (placed === undefined) throw new Error(`no note ${id} was laid out`);
    return placed;
  };
  const layOut = (partial: Partial<ClassModel>) =>
    layoutClassDiagram(classModel(partial), { measureText: fakeMeasurer });

  it("frames a namespace's free note and its note for a class outside it, the connector still drawn", () => {
    const diagram = layOut({
      classes: [cls("A", [], { namespaceId: "namespace:1" }), cls("B")],
      namespaces: [namespace("namespace:1", ["A"], "N", null, ["note:1", "note:2"])],
      notes: [note("note:1", "free"), note("note:2", "for B", "B")],
    });

    const frame = frameById(diagram, "namespace:1");
    expect(encloses(frame, noteOf(diagram, "note:1"))).toBe(true);
    expect(encloses(frame, noteOf(diagram, "note:2"))).toBe(true);
    expect(overlaps(frame, classById(diagram, "B"))).toBe(false);
    expect(noteOf(diagram, "note:2").linkPoints!.length).toBeGreaterThanOrEqual(2);
  });

  it("frames a namespace holding only a note", () => {
    const diagram = layOut({
      classes: [cls("B")],
      namespaces: [namespace("namespace:1", [], "N", null, ["note:1"])],
      notes: [note("note:1", "only")],
    });

    expect(diagram.namespaces.map((n) => n.id)).toEqual(["namespace:1"]);
    expect(encloses(frameById(diagram, "namespace:1"), noteOf(diagram, "note:1"))).toBe(true);
    expect(overlaps(frameById(diagram, "namespace:1"), classById(diagram, "B"))).toBe(false);
  });

  it("frames each note in the namespace it was written in, an outer one outside the inner frame", () => {
    const diagram = layOut({
      classes: [cls("X", [], { namespaceId: "namespace:1" }), cls("A", [], { namespaceId: "namespace:2" })],
      namespaces: [
        namespace("namespace:1", ["X"], "N", null, ["note:1"]),
        namespace("namespace:2", ["A"], "M", "namespace:1", ["note:2"]),
      ],
      notes: [note("note:1", "outer"), note("note:2", "inner")],
    });

    const outer = frameById(diagram, "namespace:1");
    const inner = frameById(diagram, "namespace:2");
    expect(encloses(outer, noteOf(diagram, "note:1"))).toBe(true);
    expect(overlaps(inner, noteOf(diagram, "note:1"))).toBe(false);
    expect(encloses(inner, noteOf(diagram, "note:2"))).toBe(true);
  });
});
