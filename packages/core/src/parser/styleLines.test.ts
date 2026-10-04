import { describe, expect, it } from "vitest";
import type { ParseResult } from "../contracts";
import { parseSiren } from "./parseSiren";

/**
 * `asWritten` finds a source position by its key pair — `line`/`column` or
 * `sourceLine`/`sourceColumn` — and by nothing else (the convention
 * `contracts.ts` states). A position spelled another way would be walked
 * past, and would point one character early on every style line.
 */
const POSITION_KEY = /Line$|Column$/i;
const POSITION_PAIRS = new Set(["line", "column", "sourceLine", "sourceColumn"]);

/** Every key holding a number that looks like a source position, by path. */
function positionKeys(value: unknown, path = "", seen = new WeakSet<object>()): string[] {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return [];
  }
  seen.add(value);
  return Object.entries(value).flatMap(([key, child]) => [
    ...(typeof child === "number" && POSITION_KEY.test(key) ? [`${path}.${key}`] : []),
    ...positionKeys(child, `${path}.${key}`, seen),
  ]);
}

/** The keys among `positionKeys` that are neither of the two pairs. */
function strayPositionKeys(result: ParseResult): string[] {
  return positionKeys(result).filter((path) => !POSITION_PAIRS.has(path.slice(path.lastIndexOf(".") + 1)));
}

/**
 * One document per kind, each written to reach as many of its parse
 * result's shapes as one document can: labels, edges or their kind's
 * equivalent, notes, blocks and styles.
 */
const REPRESENTATIVE: Record<string, string> = {
  flowchart: `flowchart LR
  A["<b>start</b>"] -->|go| B{choice}
  B -- no --> C([end])
  B -.-> D[(store)]
  subgraph S [Group]
    direction TB
    E --> F
  end
  S --> A
  classDef hot fill:#fdd,stroke:#c00
  class A hot
  style B fill:#eef
  linkStyle 0 stroke:#f00
  click A "https://example.com"
`,
  sequence: `sequenceDiagram
  participant A as Alice
  actor B
  A->>B: hello <b>there</b>
  B-->>A: back
  Note over A,B: shared
  loop every minute
    A->>B: ping
  end
  alt yes
    A->>B: y
  else no
    A->>B: n
  end
  activate A
  deactivate A
`,
  class: `classDiagram
  direction LR
  class Animal["<b>Animal</b>"] {
    +String name
    +eat() void
  }
  class Dog
  Animal <|-- Dog : is a
  Dog "1" --> "*" Bone
  note for Dog "good boy"
  classDef warm fill:#fdd
  cssClass "Dog" warm
  style Bone fill:#eef
  namespace Pets {
    class Cat
  }
`,
  state: `stateDiagram-v2
  [*] --> Idle
  Idle --> Busy : start
  state Busy {
    [*] --> Working
    Working --> [*]
    --
    [*] --> Waiting
  }
  state "A <b>described</b> state" as D
  note right of Idle : rests here
  Busy --> [*]
  classDef warm fill:#fdd
  class D warm
`,
  er: `erDiagram
  direction LR
  CUSTOMER["Customer"]
  CUSTOMER ||--o{ ORDER : places
  ORDER {
    string id PK "the key"
    int total
  }
  ORDER }|..|{ LINE : contains
  classDef warm fill:#fdd
  class ORDER warm
  style LINE fill:#eef
`,
};

describe("the source positions a parse result holds", () => {
  it.each(Object.entries(REPRESENTATIVE))("in a %s, are all spelled line/column or sourceLine/sourceColumn", (_, source) => {
    const result = parseSiren(source);
    // Not vacuous: the walk reached a document and its positions.
    expect(result.document).not.toBeNull();
    expect(positionKeys(result).length).toBeGreaterThan(0);
    expect(strayPositionKeys(result)).toEqual([]);
  });

  it("reach both pairs between them, and parse without a diagnostic", () => {
    const results = Object.values(REPRESENTATIVE).map((source) => parseSiren(source));
    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
    const keys = new Set(results.flatMap((result) => positionKeys(result)).map((path) => path.slice(path.lastIndexOf(".") + 1)));
    expect([...keys].sort()).toEqual(["column", "line", "sourceColumn", "sourceLine"]);
  });

  it("would be caught spelled any other way", () => {
    const planted = {
      document: { kind: "flowchart", nodes: [{ id: "A", endLine: 3, startColumn: 1, line: 2, column: 4 }] },
      diagnostics: [],
    } as unknown as ParseResult;
    expect(strayPositionKeys(planted)).toEqual([".document.nodes.0.endLine", ".document.nodes.0.startColumn"]);
  });
});
