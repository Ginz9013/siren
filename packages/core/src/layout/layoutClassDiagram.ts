import type {
  ClassDirection,
  ClassMember,
  ClassModel,
  LayoutOptions,
  Point,
  PositionedClass,
  PositionedClassCompartment,
  PositionedClassDiagram,
  PositionedClassNamespace,
  PositionedClassNote,
  PositionedClassRelationship,
  ResolvedClass,
  ResolvedClassNamespace,
} from "../contracts";
import {
  layoutDirectedGraph,
  type DirectedGraphLayoutNodeBox,
  type RankDirection,
} from "./layoutDirectedGraph";

/** Horizontal padding between a class box's edge and its widest text line. */
const CLASS_PADDING_X = 12;
/** Vertical padding between a compartment's edge and its first/last text line. */
const CLASS_PADDING_Y = 8;
/** Gap between a namespace frame and the member boxes it encloses. */
const NAMESPACE_PADDING = 12;
/** Horizontal padding between a note box's edge and its text. */
const NOTE_PADDING_X = 10;
/** Vertical padding between a note box's edge and its text. */
const NOTE_PADDING_Y = 8;
/** How far along the line from its own end a multiplicity string is anchored. */
const MULTIPLICITY_OFFSET_ALONG = 12;
/** How far to the side of the line a multiplicity string is anchored, so it never sits on it. */
const MULTIPLICITY_OFFSET_ACROSS = 10;

/**
 * The text a member is drawn as, rebuilt from the parts the parser kept:
 * `+int age` for an attribute, `+swim() bool` for a method. The classifier
 * goes last, as Mermaid writes it (`-id$`, `#quack(int times)*`), so one
 * rule covers both member kinds whether or not a return type follows.
 */
function memberText(member: ClassMember): string {
  const visibility = member.visibility ?? "";
  const classifier = member.classifier ?? "";
  if (member.memberKind === "method") {
    const returnType =
      member.returnType === null ? "" : ` ${member.returnType}`;
    const parameters = member.parameters ?? "";
    return `${visibility}${member.name}(${parameters})${returnType}${classifier}`;
  }
  const type = member.type === null ? "" : `${member.type} `;
  return `${visibility}${type}${member.name}${classifier}`;
}

/**
 * The name text a class box draws: its id, carrying its generic parameter in
 * the `~T~` spelling the author wrote. The tildes are put back rather than
 * translated to `<T>` so that a generic reads the same everywhere on the box
 * — a member's type keeps whatever the author typed (`+List~int~ items`), so
 * a name spelled `List<int>` beside it would be the odd one out.
 */
function classNameText(cls: ResolvedClass): string {
  return cls.generic === null ? cls.id : `${cls.id}~${cls.generic}~`;
}

/**
 * A compartment's geometry in box-local coordinates: `dividerY` is measured
 * from the box's top edge, as is each member's line center.
 */
interface CompartmentPlan {
  dividerY: number;
  members: { text: string; y: number }[];
}

/**
 * A class box measured but not yet placed: its size, and where its
 * compartments and member lines sit relative to its own top edge. Computed
 * before the shared core runs, because the core needs the size; translated
 * into diagram coordinates once the core has placed the box.
 */
interface ClassBoxPlan {
  width: number;
  height: number;
  attributes: CompartmentPlan | null;
  methods: CompartmentPlan | null;
}

/**
 * Measures a class box from its own lines: as wide as its widest measured
 * line plus padding, and as tall as its name line and every member line
 * stacked, each compartment padded and preceded by a divider.
 */
function planClassBox(
  cls: ResolvedClass,
  options: LayoutOptions,
): ClassBoxPlan {
  const measure = (text: string) => options.measureText.measure(text);
  const widths: number[] = [];
  let bottom = CLASS_PADDING_Y;

  // An annotation takes a line of its own above the class name. It is
  // measured as the model stores it — without the `«»` the renderer draws
  // around it — so the box is a couple of characters narrower than the
  // decorated text; the horizontal padding absorbs that.
  if (cls.annotation !== null) {
    const annotation = measure(cls.annotation);
    widths.push(annotation.width);
    bottom += annotation.height;
  }

  const name = measure(classNameText(cls));
  widths.push(name.width);
  bottom += name.height + CLASS_PADDING_Y;

  /**
   * Stacks one group of members below everything placed so far, preceded by
   * its divider. Returns `null` for an empty group, which is how a class
   * with no attributes (or no methods) ends up with no divider drawn.
   */
  function planCompartment(members: ClassMember[]): CompartmentPlan | null {
    if (members.length === 0) return null;
    const dividerY = bottom;
    bottom += CLASS_PADDING_Y;
    const planned = members.map((member) => {
      const text = memberText(member);
      const measured = measure(text);
      widths.push(measured.width);
      const y = bottom + measured.height / 2;
      bottom += measured.height;
      return { text, y };
    });
    bottom += CLASS_PADDING_Y;
    return { dividerY, members: planned };
  }

  const attributes = planCompartment(
    cls.members.filter((member) => member.memberKind === "attribute"),
  );
  const methods = planCompartment(
    cls.members.filter((member) => member.memberKind === "method"),
  );

  return {
    width: Math.max(...widths) + CLASS_PADDING_X * 2,
    height: bottom,
    attributes,
    methods,
  };
}

/**
 * Maps a class diagram's `direction` statement onto the shared layout core's
 * rank directions. The two vocabularies spell the same four values, but they
 * are separate types on purpose — `ClassDirection` is a pipeline contract,
 * `RankDirection` is the core's own — so the mapping is written out rather
 * than cast across.
 */
const RANK_DIRECTION: Record<ClassDirection, RankDirection> = {
  TB: "TB",
  BT: "BT",
  LR: "LR",
  RL: "RL",
};

/**
 * Anchors a multiplicity string beside one end of a routed relationship:
 * a step along the line away from the class box it belongs to, then a step
 * to the side of it, so the text clears both the box and the line itself.
 */
function multiplicityAnchor(points: Point[], atStart: boolean): Point {
  const end = atStart ? points[0] : points[points.length - 1];
  const neighbour = atStart ? points[1] : points[points.length - 2];
  const towards = neighbour ?? end;
  const dx = towards.x - end.x;
  const dy = towards.y - end.y;
  const length = Math.hypot(dx, dy) || 1;
  const alongX = dx / length;
  const alongY = dy / length;
  return {
    x:
      end.x +
      alongX * MULTIPLICITY_OFFSET_ALONG -
      alongY * MULTIPLICITY_OFFSET_ACROSS,
    y:
      end.y +
      alongY * MULTIPLICITY_OFFSET_ALONG +
      alongX * MULTIPLICITY_OFFSET_ACROSS,
  };
}

/**
 * The id a namespace's cluster is known by inside the shared layout core.
 * Namespace ids and class ids are separate id spaces in a `ClassModel`, so a
 * namespace may legitimately be named after a class; prefixing keeps the two
 * from colliding as graph nodes. Class nodes keep their own id unprefixed, so
 * a diagram with no namespaces is laid out exactly as before.
 */
function namespaceNodeId(id: string): string {
  return `namespace:${id}`;
}

/**
 * The id a note is known by inside the shared layout core. Prefixed for the
 * same reason a namespace's is: note ids and class ids are separate id spaces
 * in a `ClassModel`.
 */
function noteNodeId(id: string): string {
  return `note:${id}`;
}

/**
 * The id of the edge joining an attached note to its class. Prefixed away
 * from the `${from}-${to}` ids relationships carry, so a note's connector is
 * never mistaken for one of them.
 */
function noteLinkEdgeId(id: string): string {
  return `note-link:${id}`;
}

/**
 * A namespace's frame: the cluster box the shared core placed, widened until
 * it clears every member box by `NAMESPACE_PADDING` and has a strip along its
 * top for its own label. The core sizes a cluster to hold its children, but
 * knows nothing about the label this module draws on it, so the frame is
 * taken as whichever is larger at each edge.
 *
 * The result can extend past the core's own top-left corner, which is why
 * `layoutClassDiagram` translates the diagram afterwards.
 */
function namespaceFrame(
  ns: ResolvedClassNamespace,
  memberBoxes: DirectedGraphLayoutNodeBox[],
  clusterBox: DirectedGraphLayoutNodeBox,
  options: LayoutOptions,
): PositionedClassNamespace {
  const label = options.measureText.measure(ns.label);
  const left = Math.min(
    clusterBox.x,
    ...memberBoxes.map((box) => box.x - NAMESPACE_PADDING),
  );
  const top = Math.min(
    clusterBox.y,
    // The label strip: padding, the label line, then padding again before the
    // first member box starts.
    ...memberBoxes.map(
      (box) => box.y - NAMESPACE_PADDING * 2 - label.height,
    ),
  );
  const right = Math.max(
    clusterBox.x + clusterBox.width,
    left + label.width + NAMESPACE_PADDING * 2,
    ...memberBoxes.map((box) => box.x + box.width + NAMESPACE_PADDING),
  );
  const bottom = Math.max(
    clusterBox.y + clusterBox.height,
    ...memberBoxes.map((box) => box.y + box.height + NAMESPACE_PADDING),
  );

  return {
    id: ns.id,
    label: ns.label,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    labelAnchor: {
      x: (left + right) / 2,
      y: top + NAMESPACE_PADDING + label.height / 2,
    },
  };
}

/**
 * Computes class boxes and relationship paths for a resolved `ClassModel`.
 *
 * This is the class-diagram adapter over `layoutDirectedGraph`: it measures
 * every line a class box draws, hands the resulting sizes to the shared
 * layout core, and reattaches the class diagram's own data to the
 * coordinates that come back. All graph-layout math lives in the core.
 */
export function layoutClassDiagram(
  model: ClassModel,
  options: LayoutOptions,
): PositionedClassDiagram {
  const planById = new Map(
    model.classes.map((cls) => [cls.id, planClassBox(cls, options)]),
  );

  const knownClassIds = new Set(model.classes.map((cls) => cls.id));

  // Membership is read from each namespace's own class list, filtered to the
  // classes this model actually has. That one list drives both the cluster
  // parentage and the frame, so the two cannot disagree. A namespace left
  // with no members is dropped entirely: it has nothing to enclose, and the
  // shared core lays a childless cluster out as an ordinary box, which would
  // put a stray frame in the middle of the diagram.
  const groups = model.namespaces
    .map((ns) => ({
      ns,
      memberIds: ns.classIds.filter((id) => knownClassIds.has(id)),
    }))
    .filter((group) => group.memberIds.length > 0);

  const namespaceIdByClassId = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.memberIds) {
      namespaceIdByClassId.set(id, group.ns.id);
    }
  }

  // A note counts as attached only when the class it names is one this model
  // has. `buildClassModel` diagnoses a note pointing at an unknown class, so
  // this is the layout declining to invent a connector to nothing.
  const attachedNotes = model.notes.filter(
    (note) => note.targetId !== null && knownClassIds.has(note.targetId),
  );

  const laidOut = layoutDirectedGraph({
    rankdir: RANK_DIRECTION[model.direction],
    nodes: [
      ...model.classes.map((cls) => {
        const plan = planById.get(cls.id)!;
        const namespaceId = namespaceIdByClassId.get(cls.id);
        return {
          id: cls.id,
          width: plan.width,
          height: plan.height,
          ...(namespaceId === undefined
            ? {}
            : { parentId: namespaceNodeId(namespaceId) }),
        };
      }),
      ...groups.map((group) => {
        // The core sizes a cluster from its children and ignores what it is
        // given here; the label's own size is passed anyway, as the smallest
        // the frame could sensibly be.
        const label = options.measureText.measure(group.ns.label);
        return {
          id: namespaceNodeId(group.ns.id),
          isCluster: true,
          width: label.width + NAMESPACE_PADDING * 2,
          height: label.height + NAMESPACE_PADDING * 2,
        };
      }),
      // A note is a box the layout places like any other, which is what keeps
      // it from landing on top of a class.
      ...model.notes.map((note) => {
        const text = options.measureText.measure(note.text);
        return {
          id: noteNodeId(note.id),
          width: text.width + NOTE_PADDING_X * 2,
          height: text.height + NOTE_PADDING_Y * 2,
        };
      }),
    ],
    edges: [
      ...model.relationships.map((rel) => ({
        id: rel.id,
        from: rel.from,
        to: rel.to,
        // A labelled relationship asks the core to keep its ranks far enough
        // apart for the text, and reports back where that space ended up.
        ...(rel.label === null
          ? {}
          : { label: options.measureText.measure(rel.label) }),
      })),
      // An attached note is joined to its class by an edge that is never
      // drawn as a relationship: it is what puts the note beside the class it
      // annotates, and its route is the note's connector.
      ...attachedNotes.map((note) => ({
        id: noteLinkEdgeId(note.id),
        from: note.targetId!,
        to: noteNodeId(note.id),
      })),
    ],
  });

  const placedById = new Map(laidOut.nodes.map((box) => [box.id, box]));

  const frames = groups.map((group) =>
    namespaceFrame(
      group.ns,
      group.memberIds.map((id) => placedById.get(id)!),
      placedById.get(namespaceNodeId(group.ns.id))!,
      options,
    ),
  );

  // A frame is grown outward from the boxes it encloses, so it can reach
  // above or left of the corner the core laid the graph out from. Everything
  // is shifted by however far it did, rather than letting a frame be drawn at
  // a negative coordinate — off the canvas.
  const shift = {
    x: Math.max(0, ...frames.map((frame) => -frame.x)),
    y: Math.max(0, ...frames.map((frame) => -frame.y)),
  };
  const shifted = (point: Point): Point => ({
    x: point.x + shift.x,
    y: point.y + shift.y,
  });

  const boxById = new Map(
    laidOut.nodes.map((box) => [box.id, { ...box, ...shifted(box) }]),
  );
  const routeById = new Map(
    laidOut.edges.map((route) => [
      route.id,
      {
        ...route,
        points: route.points.map(shifted),
        labelAnchor:
          route.labelAnchor === undefined
            ? undefined
            : shifted(route.labelAnchor),
      },
    ]),
  );
  const namespaces = frames.map((frame) => ({
    ...frame,
    ...shifted(frame),
    labelAnchor: shifted(frame.labelAnchor),
  }));

  const classes = model.classes.map<PositionedClass>((cls) => {
    const box = boxById.get(cls.id)!;
    const plan = planById.get(cls.id)!;

    /** Moves a compartment's box-local geometry into diagram coordinates. */
    const place = (
      compartment: CompartmentPlan | null,
    ): PositionedClassCompartment | null =>
      compartment === null
        ? null
        : {
            dividerY: box.y + compartment.dividerY,
            members: compartment.members.map((member) => ({
              text: member.text,
              x: box.x + CLASS_PADDING_X,
              y: box.y + member.y,
            })),
          };

    return {
      id: cls.id,
      name: classNameText(cls),
      annotation: cls.annotation,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      attributes: place(plan.attributes),
      methods: place(plan.methods),
      style: [],
      interaction: null,
    };
  });

  const relationships = model.relationships.map<PositionedClassRelationship>(
    (rel) => {
      const route = routeById.get(rel.id)!;
      return {
        id: rel.id,
        from: rel.from,
        to: rel.to,
        line: rel.line,
        fromEnd: rel.fromEnd,
        toEnd: rel.toEnd,
        points: route.points,
        label: rel.label,
        labelAnchor: route.labelAnchor ?? null,
        fromMultiplicity: rel.fromMultiplicity,
        fromMultiplicityAnchor:
          rel.fromMultiplicity === null
            ? null
            : multiplicityAnchor(route.points, true),
        toMultiplicity: rel.toMultiplicity,
        toMultiplicityAnchor:
          rel.toMultiplicity === null
            ? null
            : multiplicityAnchor(route.points, false),
      };
    },
  );

  const attachedNoteIds = new Set(attachedNotes.map((note) => note.id));

  const notes = model.notes.map<PositionedClassNote>((note) => {
    const box = boxById.get(noteNodeId(note.id))!;
    // The joining edge was routed from the class to the note; the connector
    // is drawn the other way round, out of the note it belongs to.
    const link = attachedNoteIds.has(note.id)
      ? [...routeById.get(noteLinkEdgeId(note.id))!.points].reverse()
      : null;
    return {
      id: note.id,
      text: note.text,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      linkPoints: link,
    };
  });

  const bounds = diagramBounds(
    classes,
    relationships,
    namespaces,
    notes,
    options,
  );

  return {
    direction: model.direction,
    classes,
    relationships,
    namespaces,
    notes,
    timeline: model.timeline,
    width: Math.max(laidOut.width + shift.x, bounds.width),
    height: Math.max(laidOut.height + shift.y, bounds.height),
  };
}

/**
 * The extent every drawn thing fits inside: class boxes, relationship paths,
 * and the text anchored along them. The shared core reports bounds for the
 * graph it placed, but it never saw the multiplicity strings this module
 * anchors afterwards — a multiplicity sits beside its end of a routed path,
 * which can put it outside the core's figure — so the diagram measures its
 * own extent and takes the larger.
 *
 * (An earlier version of this comment also claimed the core under-reports a
 * self-relationship's routing. That was checked afterwards across four graph
 * shapes in both axes and does not reproduce: dagre's reported bounds covered
 * every node box every time. The multiplicity reason above is the real one,
 * and it stands on its own.)
 */
function diagramBounds(
  classes: PositionedClass[],
  relationships: PositionedClassRelationship[],
  namespaces: PositionedClassNamespace[],
  notes: PositionedClassNote[],
  options: LayoutOptions,
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;

  const cover = (x: number, y: number) => {
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };

  /** Covers a centered run of text drawn at `anchor`. */
  const coverText = (text: string, anchor: Point) => {
    const size = options.measureText.measure(text);
    cover(anchor.x + size.width / 2, anchor.y + size.height / 2);
  };

  for (const box of [...classes, ...namespaces, ...notes]) {
    cover(box.x + box.width, box.y + box.height);
  }

  for (const note of notes) {
    for (const point of note.linkPoints ?? []) cover(point.x, point.y);
  }

  for (const rel of relationships) {
    for (const point of rel.points) cover(point.x, point.y);
    if (rel.label !== null && rel.labelAnchor !== null) {
      coverText(rel.label, rel.labelAnchor);
    }
    if (rel.fromMultiplicity !== null && rel.fromMultiplicityAnchor !== null) {
      coverText(rel.fromMultiplicity, rel.fromMultiplicityAnchor);
    }
    if (rel.toMultiplicity !== null && rel.toMultiplicityAnchor !== null) {
      coverText(rel.toMultiplicity, rel.toMultiplicityAnchor);
    }
  }

  return { width: right, height: bottom };
}
