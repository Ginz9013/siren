import { describe, expect, it } from "vitest";
import type {
  ClassMember,
  ClassModel,
  Point,
  PositionedClass,
  PositionedClassDiagram,
  ResolvedClass,
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

/** Straight-line distance between two points. */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Whether a point sits on or inside a positioned class's box. */
function touches(point: Point, box: PositionedClass): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
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
  });
});
