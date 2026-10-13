// node --test scripts/parity — reading the author's node id back out of the
// DOM id Mermaid 12.2.0 gives a node's group. Formats measured in headless
// Chrome (render id `pm0`): `pm0-flowchart-A-0`, `pm0-state-Idle-1`,
// `pm0-state-root_start-0`, `pm0-entity-CUSTOMER-0`, `pm0-classId-Shape-0`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mermaidNodeId } from "./ids.mjs";

test("flowchart, state and ER node DOM ids yield the authored id", () => {
  assert.equal(mermaidNodeId("pm0-flowchart-A-0", "pm0"), "A");
  assert.equal(mermaidNodeId("pm3-state-Idle-1", "pm3"), "Idle");
  assert.equal(mermaidNodeId("pm2-entity-CUSTOMER-0", "pm2"), "CUSTOMER");
});

test("an authored id containing dashes and digits survives intact", () => {
  assert.equal(mermaidNodeId("pm0-flowchart-node-2-b-17", "pm0"), "node-2-b");
});

test("a DOM id of no known node shape yields null", () => {
  assert.equal(mermaidNodeId("pm0-S1", "pm0"), null);
  assert.equal(mermaidNodeId("other-flowchart-A-0", "pm0"), null);
});

test("a class node DOM id yields the class name", () => {
  assert.equal(mermaidNodeId("pm0-classId-Shape-0", "pm0"), "Shape");
  assert.equal(mermaidNodeId("pm4-classId-Order-Line-12", "pm4"), "Order-Line");
});

test("a class note DOM id stays unmatched", () => {
  assert.equal(mermaidNodeId("pm0-note0", "pm0"), null);
});
