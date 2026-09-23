import { describe, expect, it } from "vitest";
import type { ErDocument } from "../contracts";
import { buildErModel } from "./buildErModel";

/** An `ErDocument` naming `names`, in the order given. */
const documentOf = (...names: string[]): ErDocument => ({
  kind: "er",
  entities: names.map((name) => ({ name })),
});

describe("buildErModel", () => {
  it("gives each entity its authored name as both its id and its drawn label", () => {
    // Measured (mermaid 11.17.2): Mermaid keys its entity table on the name
    // the author wrote and reports `label="CUSTOMER"` for it — so the name
    // is both what addresses the entity and what is drawn in the box. They
    // are two fields here rather than one because an alias splits them: a
    // later ticket puts the alias in `label` and leaves `id` alone, which is
    // what keeps a timeline target (ADR-0009 — a target is an id) pointing
    // at the same entity after it is renamed on screen.
    const { model, diagnostics } = buildErModel(documentOf("CUSTOMER", "ORDER"));

    expect(diagnostics).toEqual([]);
    expect(model.entities).toEqual([
      { id: "CUSTOMER", label: "CUSTOMER" },
      { id: "ORDER", label: "ORDER" },
    ]);
  });

  it("records an entity named twice once, in the position it was first named", () => {
    // Measured: `CUSTOMER / ORDER / CUSTOMER` reports **two** entities, with
    // `CUSTOMER` still first — Mermaid's table is keyed on the name, so a
    // second mention finds the entry already there. Two boxes with the same
    // `data-siren-id` would make a timeline entry naming it ambiguous, so
    // this is a rule the model owes rather than a tidy-up.
    const { model, diagnostics } = buildErModel(documentOf("CUSTOMER", "ORDER", "CUSTOMER"));

    // Silently, and that is measured too: Mermaid reports nothing for the
    // repeat, so a warning here would be Siren's opinion rather than a fact
    // about the document.
    expect(diagnostics).toEqual([]);
    expect(model.entities.map((entity) => entity.id)).toEqual(["CUSTOMER", "ORDER"]);
  });

  it("hands back a timeline with no steps, since this kind reads no timeline block yet", () => {
    const { model } = buildErModel(documentOf("CUSTOMER"));

    expect(model.timeline).toEqual({ totalSteps: 0, entries: [] });
  });
});
