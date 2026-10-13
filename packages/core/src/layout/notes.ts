/**
 * How a note is handed to the shared layout core (`layoutDirectedGraph`) —
 * the class diagram's `note for` and the state diagram's `note left of` /
 * `note right of` alike: a box of its own, sized around its text, joined to
 * what it annotates by an edge whose route is the note's connector.
 *
 * Mermaid 12.2.0 places both kinds' notes the same way, as a node of their
 * own with an edge to their target, so the two adapters share the ids, the
 * box and the padding here rather than each keeping a copy. Where the two
 * still differ is theirs: which way the edge runs (a class note's always
 * from the note; a state note's by the side the author named) and where in
 * the core's input the note goes.
 */
import type { LabelBox } from "../contracts";

/** Horizontal padding between a note box's edge and its text. */
const NOTE_PADDING_X = 10;
/** Vertical padding between a note box's edge and its text. */
const NOTE_PADDING_Y = 8;

/**
 * The id a note is known by inside the shared layout core, by the key its
 * adapter names it with: the note's own id in a class diagram, the noted
 * state's id in a state diagram (a state carries at most one note).
 *
 * Prefixed because note ids and the ids of the boxes beside them are
 * separate id spaces: a class may share a note's id, and a state's note is
 * keyed by the state's own id. An authored state id is `\w+` and cannot
 * contain a colon, and a generated pseudo-state id is `start:1`, so neither
 * can collide with this.
 */
export function noteNodeId(key: string): string {
  return `note:${key}`;
}

/**
 * The id of the edge joining a note to what it annotates — prefixed away
 * from every connector id a document produces, so a note's connector is
 * never mistaken for a relationship or a transition.
 */
export function noteLinkEdgeId(key: string): string {
  return `note-link:${key}`;
}

/** The box a note is laid out as: its measured text, padded on every side. */
export function noteBoxSize(labelBox: LabelBox): { width: number; height: number } {
  return {
    width: labelBox.width + NOTE_PADDING_X * 2,
    height: labelBox.height + NOTE_PADDING_Y * 2,
  };
}
