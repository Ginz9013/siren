import { describe, expect, it } from "vitest";
import { renderClassDiagramToSVG } from "./renderClassDiagramToSVG";
import type {
  ClassRelationshipEnd,
  ClassRelationshipLine,
  PositionedClass,
  PositionedClassDiagram,
  PositionedClassRelationship,
} from "../contracts";

/**
 * Hand-built class box with no compartments — a bare `class Animal`, laid
 * out at a known box. Every field a test does not care about is given a
 * neutral value here so each test reads as the one thing it exercises.
 */
function buildClass(overrides: Partial<PositionedClass> = {}): PositionedClass {
  return {
    id: "Animal",
    name: "Animal",
    annotation: null,
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    attributes: null,
    methods: null,
    style: [],
    interaction: null,
    ...overrides,
  };
}

/**
 * A class with both compartments populated: two attributes under a divider
 * at y=50, one method under a divider at y=90, inside a box spanning
 * y=20..140.
 */
const COMPARTMENTED_CLASS: Partial<PositionedClass> = {
  height: 120,
  attributes: {
    dividerY: 50,
    members: [
      { text: "+int age", x: 18, y: 64 },
      { text: "-String name", x: 18, y: 82 },
    ],
  },
  methods: {
    dividerY: 90,
    members: [{ text: "+isMammal() bool", x: 18, y: 104 }],
  },
};

/**
 * Hand-built relationship between the two fixture classes, defaulting to
 * Mermaid's `Animal --> Duck` association; each test overrides the axes and
 * text it is about.
 */
function buildRelationship(
  overrides: Partial<PositionedClassRelationship> = {},
): PositionedClassRelationship {
  return {
    id: "Animal-Duck",
    from: "Animal",
    to: "Duck",
    line: "solid",
    fromEnd: "none",
    toEnd: "arrow",
    points: [
      { x: 70, y: 80 },
      { x: 70, y: 160 },
      { x: 260, y: 160 },
    ],
    label: null,
    labelAnchor: null,
    fromMultiplicity: null,
    fromMultiplicityAnchor: null,
    toMultiplicity: null,
    toMultiplicityAnchor: null,
    ...overrides,
  };
}

/**
 * Mermaid's eight class relationship forms as the `{ line, fromEnd, toEnd }`
 * triples contracts.ts models them by, with the rendering each one is
 * expected to get. Written from Mermaid's class-diagram syntax (the marker
 * always sits on the end the author put it on: `Animal <|-- Duck` decorates
 * the `from` end), not from this renderer's output.
 */
const MERMAID_RELATIONSHIP_TYPES = [
  {
    mermaid: "<|--",
    type: "inheritance",
    line: "solid",
    fromEnd: "triangle",
    toEnd: "none",
    dashed: false,
    startMarked: true,
    endMarked: false,
  },
  {
    mermaid: "*--",
    type: "composition",
    line: "solid",
    fromEnd: "diamondFilled",
    toEnd: "none",
    dashed: false,
    startMarked: true,
    endMarked: false,
  },
  {
    mermaid: "o--",
    type: "aggregation",
    line: "solid",
    fromEnd: "diamondHollow",
    toEnd: "none",
    dashed: false,
    startMarked: true,
    endMarked: false,
  },
  {
    mermaid: "-->",
    type: "association",
    line: "solid",
    fromEnd: "none",
    toEnd: "arrow",
    dashed: false,
    startMarked: false,
    endMarked: true,
  },
  {
    mermaid: "--",
    type: "link",
    line: "solid",
    fromEnd: "none",
    toEnd: "none",
    dashed: false,
    startMarked: false,
    endMarked: false,
  },
  {
    mermaid: "..>",
    type: "dependency",
    line: "dashed",
    fromEnd: "none",
    toEnd: "arrow",
    dashed: true,
    startMarked: false,
    endMarked: true,
  },
  {
    mermaid: "..|>",
    type: "realization",
    line: "dashed",
    fromEnd: "none",
    toEnd: "triangle",
    dashed: true,
    startMarked: false,
    endMarked: true,
  },
  {
    mermaid: "..",
    type: "dashedLink",
    line: "dashed",
    fromEnd: "none",
    toEnd: "none",
    dashed: true,
    startMarked: false,
    endMarked: false,
  },
] as const satisfies readonly {
  mermaid: string;
  type: string;
  line: ClassRelationshipLine;
  fromEnd: ClassRelationshipEnd;
  toEnd: ClassRelationshipEnd;
  dashed: boolean;
  startMarked: boolean;
  endMarked: boolean;
}[];

/** Hand-built diagram carrying the given classes and relationships, and no timeline. */
function buildDiagram(
  classes: PositionedClass[],
  relationships: PositionedClassRelationship[] = [],
): PositionedClassDiagram {
  return {
    direction: "TB",
    classes,
    relationships,
    namespaces: [],
    notes: [],
    timeline: { totalSteps: 0, entries: [] },
    width: 400,
    height: 300,
  };
}

describe("renderClassDiagramToSVG", () => {
  it("sizes the root svg from the diagram's own dimensions", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass()]));

    expect(svg.getAttribute("width")).toBe("400");
    expect(svg.getAttribute("height")).toBe("300");
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 300");
  });

  it("renders one identified group per class, holding a frame rect at the class's box", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram([buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 20 })]),
    );

    const groups = svg.querySelectorAll("g.siren-class");
    expect(groups.length).toBe(2);
    expect(Array.from(groups).map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "Animal",
      "Duck",
    ]);

    const frame = groups[0].querySelector("rect.siren-class-frame");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("x")).toBe("10");
    expect(frame?.getAttribute("y")).toBe("20");
    expect(frame?.getAttribute("width")).toBe("120");
    expect(frame?.getAttribute("height")).toBe("60");
  });

  it("renders the class name centered in the box when the class has no compartments", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass({ name: "Square~Shape~" })]));

    const name = svg.querySelector("g.siren-class text.siren-class-name");
    expect(name?.textContent).toBe("Square~Shape~");
    expect(name?.getAttribute("x")).toBe("70");
    expect(name?.getAttribute("y")).toBe("50");
  });

  it("renders one divider per compartment the layout recorded, spanning the frame", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    const dividers = svg.querySelectorAll("g.siren-class line.siren-class-divider");
    expect(dividers.length).toBe(2);
    expect(Array.from(dividers).map((line) => line.getAttribute("y1"))).toEqual(["50", "90"]);
    expect(Array.from(dividers).map((line) => line.getAttribute("y2"))).toEqual(["50", "90"]);
    expect(dividers[0].getAttribute("x1")).toBe("10");
    expect(dividers[0].getAttribute("x2")).toBe("130");
  });

  it("renders one member text per member line, at the position the layout assigned it", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    const members = svg.querySelectorAll("g.siren-class text.siren-member");
    expect(Array.from(members).map((text) => text.textContent)).toEqual([
      "+int age",
      "-String name",
      "+isMammal() bool",
    ]);
    expect(members[0].getAttribute("x")).toBe("18");
    expect(members[0].getAttribute("y")).toBe("64");
    expect(members[2].getAttribute("x")).toBe("18");
    expect(members[2].getAttribute("y")).toBe("104");
  });

  it("centers the class name above the first divider when the class has compartments", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    // The name compartment runs from the box's top edge (20) to the first
    // divider (50), so its center sits at 35 rather than the whole box's 80.
    expect(svg.querySelector("text.siren-class-name")?.getAttribute("y")).toBe("35");
  });

  it("renders one identified group per relationship, with its line along the layout's points", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 140 })],
        [buildRelationship()],
      ),
    );

    const groups = svg.querySelectorAll("g.siren-relationship");
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute("data-siren-id")).toBe("Animal-Duck");

    const line = groups[0].querySelector("path.siren-relationship-line");
    expect(line?.getAttribute("d")).toBe("M70,80 L70,160 L260,160");
    // A multi-segment path must never be painted as a filled polygon, however
    // it is themed — same reasoning as the sequence renderer's frames.
    expect(line?.getAttribute("fill")).toBe("none");
  });

  it("defines all four endpoint markers as distinct marker defs", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([], []));

    const markers = svg.querySelectorAll("defs > marker");
    const ids = Array.from(markers).map((marker) => marker.getAttribute("id"));
    expect(markers.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
    // Each def must actually draw something, or a "distinct marker" is an
    // empty box on screen.
    for (const marker of Array.from(markers)) {
      expect(marker.querySelector("path")?.getAttribute("d")).toBeTruthy();
    }
  });

  it.each(MERMAID_RELATIONSHIP_TYPES)(
    "renders $mermaid ($type) with its own markers and line style",
    ({ type, line, fromEnd, toEnd, dashed, startMarked, endMarked }) => {
      const svg = renderClassDiagramToSVG(
        buildDiagram([], [buildRelationship({ line, fromEnd, toEnd })]),
      );

      const group = svg.querySelector("g.siren-relationship");
      expect(group?.getAttribute("data-siren-relationship")).toBe(type);

      const path = group?.querySelector("path.siren-relationship-line");
      expect(path?.hasAttribute("marker-start")).toBe(startMarked);
      expect(path?.hasAttribute("marker-end")).toBe(endMarked);
      expect(path?.hasAttribute("stroke-dasharray")).toBe(dashed);

      // Every marker reference has to resolve to a def in this same document,
      // or the endpoint silently renders as nothing.
      const references = [path?.getAttribute("marker-start"), path?.getAttribute("marker-end")];
      for (const reference of references) {
        if (reference !== null && reference !== undefined) {
          expect(reference).toMatch(/^url\(#.+\)$/);
          const id = reference.slice("url(#".length, -1);
          expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
        }
      }
    },
  );

  it("gives each of the eight Mermaid relationship types a distinguishable rendering", () => {
    const signatures = MERMAID_RELATIONSHIP_TYPES.map(({ line, fromEnd, toEnd }) => {
      const svg = renderClassDiagramToSVG(
        buildDiagram([], [buildRelationship({ line, fromEnd, toEnd })]),
      );
      const path = svg.querySelector("path.siren-relationship-line");
      return [
        path?.getAttribute("marker-start"),
        path?.getAttribute("marker-end"),
        path?.getAttribute("stroke-dasharray"),
      ].join("|");
    });

    expect(new Set(signatures).size).toBe(MERMAID_RELATIONSHIP_TYPES.length);
  });

  it("renders a relationship's label and both multiplicity strings at their anchors", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [],
        [
          buildRelationship({
            label: "owns",
            labelAnchor: { x: 150, y: 148 },
            fromMultiplicity: "1",
            fromMultiplicityAnchor: { x: 80, y: 96 },
            toMultiplicity: "*",
            toMultiplicityAnchor: { x: 244, y: 152 },
          }),
        ],
      ),
    );

    const group = svg.querySelector("g.siren-relationship");
    const label = group?.querySelector("text.siren-relationship-label");
    expect(label?.textContent).toBe("owns");
    expect(label?.getAttribute("x")).toBe("150");
    expect(label?.getAttribute("y")).toBe("148");

    const multiplicities = group?.querySelectorAll("text.siren-multiplicity") ?? [];
    expect(Array.from(multiplicities).map((text) => text.textContent)).toEqual(["1", "*"]);
    expect(multiplicities[0].getAttribute("x")).toBe("80");
    expect(multiplicities[0].getAttribute("y")).toBe("96");
    expect(multiplicities[1].getAttribute("x")).toBe("244");
    expect(multiplicities[1].getAttribute("y")).toBe("152");
  });

  it("renders no label or multiplicity text when the relationship carries none", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([], [buildRelationship()]));

    expect(svg.querySelectorAll("text.siren-relationship-label").length).toBe(0);
    expect(svg.querySelectorAll("text.siren-multiplicity").length).toBe(0);
  });

  it("renders only the multiplicity that is present", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [],
        [buildRelationship({ toMultiplicity: "0..1", toMultiplicityAnchor: { x: 244, y: 152 } })],
      ),
    );

    const multiplicities = svg.querySelectorAll("text.siren-multiplicity");
    expect(multiplicities.length).toBe(1);
    expect(multiplicities[0].textContent).toBe("0..1");
  });

  it("starts classes and relationships with an enter action as siren-pending", () => {
    const diagram = buildDiagram(
      [buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 140 })],
      [buildRelationship()],
    );
    diagram.timeline = {
      totalSteps: 2,
      entries: [
        { kind: "enter", step: 1, targetId: "Duck", effect: "fade" },
        { kind: "enter", step: 2, targetId: "Animal-Duck", effect: "fade" },
      ],
    };
    const svg = renderClassDiagramToSVG(diagram);

    expect(svg.querySelector('g.siren-class[data-siren-id="Animal"]')?.getAttribute("class")).toBe(
      "siren-class",
    );
    expect(svg.querySelector('g.siren-class[data-siren-id="Duck"]')?.getAttribute("class")).toBe(
      "siren-class siren-pending",
    );
    expect(svg.querySelector("g.siren-relationship")?.getAttribute("class")).toBe(
      "siren-relationship siren-pending",
    );
  });

  it("leaves an element whose only actions are exit or highlight visible from the start", () => {
    const diagram = buildDiagram(
      [buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 140 })],
      [buildRelationship()],
    );
    diagram.timeline = {
      totalSteps: 2,
      entries: [
        { kind: "exit", step: 1, targetId: "Animal", effect: "fade" },
        { kind: "highlight", step: 1, targetId: "Duck", effect: "glow" },
        { kind: "unhighlight", step: 2, targetId: "Animal-Duck" },
      ],
    };
    const svg = renderClassDiagramToSVG(diagram);

    expect(svg.querySelectorAll(".siren-pending").length).toBe(0);
  });

  // Guard for the hard invariant every Siren renderer holds: author text is
  // set with textContent, never innerHTML, so markup-looking input renders as
  // characters instead of becoming elements.
  it("renders markup-looking author text literally, never as markup", () => {
    const markup = '<script>alert("x")</script>';
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [
          buildClass({
            name: markup,
            methods: { dividerY: 50, members: [{ text: markup, x: 18, y: 64 }] },
          }),
        ],
        [
          buildRelationship({
            label: markup,
            labelAnchor: { x: 150, y: 148 },
            toMultiplicity: markup,
            toMultiplicityAnchor: { x: 244, y: 152 },
          }),
        ],
      ),
    );

    expect(svg.querySelector("text.siren-class-name")?.textContent).toBe(markup);
    expect(svg.querySelector("text.siren-member")?.textContent).toBe(markup);
    expect(svg.querySelector("text.siren-relationship-label")?.textContent).toBe(markup);
    expect(svg.querySelector("text.siren-multiplicity")?.textContent).toBe(markup);
    expect(svg.querySelectorAll("script").length).toBe(0);
    for (const text of Array.from(svg.querySelectorAll("text"))) {
      expect(text.children.length).toBe(0);
    }
  });

  it("renders a single divider for a class that only has methods", () => {
    const methodsOnly = buildClass({
      attributes: null,
      methods: COMPARTMENTED_CLASS.methods,
    });
    const svg = renderClassDiagramToSVG(buildDiagram([methodsOnly]));

    const dividers = svg.querySelectorAll("line.siren-class-divider");
    expect(dividers.length).toBe(1);
    expect(dividers[0].getAttribute("y1")).toBe("90");
    expect(svg.querySelector("text.siren-class-name")?.getAttribute("y")).toBe("55");
  });
});
