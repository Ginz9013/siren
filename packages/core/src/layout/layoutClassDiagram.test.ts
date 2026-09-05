import { describe, expect, it } from "vitest";
import type {
  ClassDirection,
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
  ResolvedTimeline,
  TextMeasurer,
} from "../contracts";
import { layoutClassDiagram } from "./layoutClassDiagram";

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
    ...partial,
  };
}

function namespace(
  id: string,
  classIds: string[],
  label: string = id,
): ResolvedClassNamespace {
  return { id, label, classIds };
}

function note(
  id: string,
  text: string,
  targetId: string | null = null,
): ResolvedClassNote {
  return { id, text, targetId };
}

function classModel(partial: Partial<ClassModel> = {}): ClassModel {
  return {
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

/** Shortest distance from `point` to a routed path, over all its segments. */
function distanceToPath(point: Point, points: Point[]): number {
  let nearest = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const span = distance(a, b);
    // How far along `a`→`b` the nearest point lies, clamped to the segment.
    const t =
      span === 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
                (span * span),
            ),
          );
    nearest = Math.min(
      nearest,
      distance(point, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
    );
  }
  return nearest;
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
 * The rectangle a run of text covers when drawn centered on `anchor` — the
 * same model of a text's extent `layoutClassDiagram` uses when it measures
 * the diagram's own bounds, so this is the tests' independent yardstick for
 * "where the glyph actually lands".
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
    it("rebuilds each member line from the parts the model kept, classifier last", () => {
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
        "-id$",
      ]);
      expect(duck.methods!.members.map((m) => m.text)).toEqual([
        "+swim() bool",
        "#quack(int times)*",
      ]);
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
      expect(square.name).toBe("Square<Shape>");
      // The name it draws is the widest line of this class, so the box has to
      // hold the whole composed name with padding to spare.
      expect(square.width).toBeGreaterThan(measuredWidth("Square<Shape>"));
      // A class with no generic still draws its bare id.
      expect(classById(diagram, "Circle").name).toBe("Circle");
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
        "+all() List<int>",
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
      expect(map.name).toBe("Map<String, List<int>>");
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
      ).toEqual(["+lookup(List<int> a, Map<String,int> b) bool"]);
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

    it("anchors the label between the ends and each multiplicity beside its own end", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Customer"), cls("Ticket")],
          relationships: [
            relationship("Customer", "Ticket", {
              label: "raises",
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

      expect(routed.labelAnchor).not.toBeNull();
      expect(routed.labelAnchor!.y).toBeGreaterThan(first.y);
      expect(routed.labelAnchor!.y).toBeLessThan(last.y);

      // Each multiplicity sits beside its own end of the line: nearer that
      // end than the other, and within a line height of it.
      expect(distance(routed.fromMultiplicityAnchor!, first)).toBeLessThan(
        distance(routed.fromMultiplicityAnchor!, last),
      );
      expect(distance(routed.fromMultiplicityAnchor!, first)).toBeLessThan(
        LINE_HEIGHT,
      );
      expect(distance(routed.toMultiplicityAnchor!, last)).toBeLessThan(
        distance(routed.toMultiplicityAnchor!, first),
      );
      expect(distance(routed.toMultiplicityAnchor!, last)).toBeLessThan(
        LINE_HEIGHT,
      );
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
    function cornerArrival(direction: ClassDirection): PositionedClassDiagram {
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
          // Off the stroke, which is what the across-offset buys.
          expect(distanceToPath(anchor, points)).toBeGreaterThanOrEqual(8);
        }

        // Each sits on the same hand of its *own* outward direction, and the
        // two outward directions are opposite — so the two labels fall on
        // opposite sides of the line and read as two, not one clump.
        expect(
          sideOfLine(routed.fromMultiplicityAnchor!, first, points[1]) *
            sideOfLine(
              routed.toMultiplicityAnchor!,
              last,
              points[points.length - 2],
            ),
        ).toBeGreaterThan(0);
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
      expect(routed.labelAnchor).toBeNull();
      expect(routed.fromMultiplicityAnchor).toBeNull();
      expect(routed.toMultiplicityAnchor).toBeNull();
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
      expect(frame.label).toBe("BaseShapes");
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
      expect(frame.labelAnchor.x - halfLabel).toBeGreaterThanOrEqual(frame.x);
      expect(frame.labelAnchor.x + halfLabel).toBeLessThanOrEqual(
        frame.x + frame.width,
      );
      expect(frame.labelAnchor.y - LINE_HEIGHT / 2).toBeGreaterThanOrEqual(
        frame.y,
      );
      expect(frame.labelAnchor.y + LINE_HEIGHT / 2).toBeLessThanOrEqual(
        Math.min(...members.map((box) => box.y)),
      );
    });

    it("moves the whole diagram down when a frame's label strip reaches above the graph's own top edge", () => {
      // The frame is grown outward from the boxes it encloses: its label
      // strip is taller than the room the layout core leaves above a
      // clustered box, so the frame reaches above the corner the core laid
      // the graph out from. `grouped()` is exactly that case.
      const diagram = grouped();
      const frame = diagram.namespaces[0];
      const members = ["Triangle", "Square"].map((id) =>
        classById(diagram, id),
      );

      // Flush with the top edge: the diagram was translated by exactly the
      // overshoot. Any less and the frame would be drawn off the canvas.
      expect(frame.y).toBe(0);
      // Everything moved with it, rather than the frame alone being clamped
      // to zero: the label strip above the first member box survives the
      // translation.
      expect(Math.min(...members.map((box) => box.y))).toBeGreaterThan(
        frame.y + LINE_HEIGHT,
      );
      // And nothing else was left behind above the canvas.
      for (const box of [...diagram.classes, ...diagram.notes]) {
        expect(box.y).toBeGreaterThanOrEqual(0);
      }
      for (const routed of diagram.relationships) {
        for (const point of routed.points) {
          expect(point.y).toBeGreaterThanOrEqual(0);
        }
      }
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
      expect(diagram.notes.map((n) => n.text)).toEqual([
        "ducks are birds",
        "a free-standing remark",
      ]);
      for (const box of diagram.notes) {
        expect(box.width).toBeGreaterThan(measuredWidth(box.text));
        expect(box.height).toBeGreaterThan(LINE_HEIGHT);
        for (const cls of diagram.classes) {
          expect(overlaps(box, cls)).toBe(false);
        }
      }
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

  describe("timeline", () => {
    it("carries the model's resolved timeline through untouched", () => {
      const timeline: ResolvedTimeline = {
        totalSteps: 2,
        entries: [
          { kind: "enter", step: 1, targetId: "Duck", effect: "fade" },
          { kind: "highlight", step: 2, targetId: "Animal-Duck" },
        ],
      };

      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Animal"), cls("Duck")],
          relationships: [relationship("Animal", "Duck")],
          timeline,
        }),
        { measureText: fakeMeasurer },
      );

      expect(diagram.timeline).toEqual(timeline);
    });
  });

  describe("author styling and interaction", () => {
    it("carries each class's resolved style declarations through, in declaration order, and leaves an unstyled class with none", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Duck"), cls("Animal")],
          styles: [
            {
              classId: "Duck",
              properties: [
                { property: "fill", value: "#fdd" },
                { property: "stroke", value: "#c00" },
              ],
            },
          ],
        }),
        { measureText: fakeMeasurer },
      );

      expect(classById(diagram, "Duck").style).toEqual([
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ]);
      // No declarations, so the renderer emits no `style` attribute at all.
      expect(classById(diagram, "Animal").style).toEqual([]);
    });

    it("carries each class's resolved interaction through, and leaves a class named by none with null", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Duck"), cls("Animal")],
          interactions: [
            {
              classId: "Duck",
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
        classId: "Duck",
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
              classId: "Duck",
              interactionKind: "href",
              action: "https://example.com/duck",
              argument: null,
              tooltip: null,
            },
            {
              classId: "Duck",
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
        classId: "Duck",
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
              label: "raises a great many of",
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
        if (routed.labelAnchor) {
          const size = fakeMeasurer.measure(routed.label!);
          withinBounds(routed.labelAnchor, size.width / 2, size.height / 2);
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
        const size = fakeMeasurer.measure(frame.label);
        withinBounds(frame.labelAnchor, size.width / 2, size.height / 2);
      }

      for (const box of diagram.notes) {
        for (const point of box.linkPoints ?? []) withinBounds(point);
      }
    });
  });
});
