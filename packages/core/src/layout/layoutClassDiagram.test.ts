import { describe, expect, it } from "vitest";
import type {
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
    it("draws a class's generic parameter as part of its name and sizes the box from the composed name", () => {
      const diagram = layoutClassDiagram(
        classModel({
          classes: [cls("Square", [], { generic: "Shape" }), cls("Circle")],
        }),
        { measureText: fakeMeasurer },
      );

      const square = classById(diagram, "Square");
      expect(square.name).toBe("Square~Shape~");
      // The name it draws is the widest line of this class, so the box has to
      // hold the whole composed name with padding to spare.
      expect(square.width).toBeGreaterThan(measuredWidth("Square~Shape~"));
      // A class with no generic still draws its bare id.
      expect(classById(diagram, "Circle").name).toBe("Circle");
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
