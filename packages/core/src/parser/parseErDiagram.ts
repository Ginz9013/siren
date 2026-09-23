import type { Diagnostic, ErDocument, ErEntityDecl, ParseResult } from "../contracts";
import { listAcceptedHeaders, matchDiagramHeader } from "./parseDirection";

/** The headers a diagnostic here names, asked of the one registry that accepts them. */
const ER_HEADERS = listAcceptedHeaders(["er"]);

/**
 * An entity name on a line of its own.
 *
 * **The alphabet is Mermaid's own, measured rather than borrowed.** Its ER
 * lexer reads a name as `([^\x00-\x7F]|\w|-|\*|\.)+` (mermaid 11.17.2), and
 * the probe agrees construct by construct: `LINE-ITEM`, `A_B`, `a1`,
 * `Order2`, `P.Q`, `Ünïcode` and `中文實體` each come back as one entity,
 * while `X$Y` is a parse error. This is a **different language** from a
 * flowchart, whose ids are `\w+` plus `.` and where a dashed id is still an
 * open gap — so `\w+` was not reusable here, and copying it would have
 * refused `LINE-ITEM`, which is ordinary ER.
 *
 * `-`, `.` and `*` are each a whole name on their own (measured: all three
 * report one entity), which is why there is no "must contain a letter"
 * guard: adding one would refuse three documents Mermaid draws.
 */
const ENTITY_NAME_RE = /^(?:[\w*.-]|[^\x00-\x7F])+$/u;

/**
 * A line of nothing but relationship punctuation — never a name, however
 * freely the alphabet above admits `-` and `.`.
 *
 * Mermaid's four relationship bodies are `--`, `..`, `.-` and `-.`, and its
 * lexer reads them before it reads a name. Measured, one probe per line:
 * `-` and `.` are each a whole entity, and **every** run of two or more of
 * the two characters is a parse error — `--`, `---`, `..`, `...`, `.-`,
 * `-.`, `-.-` and `.--.` all refused, with "got 'IDENTIFYING'" and "got
 * 'NON_IDENTIFYING'" naming which token the lexer found. So the boundary is
 * length, not shape, and `{2,}` is the whole rule.
 *
 * Without this, `--` on a line of its own would be drawn as a box labelled
 * `--` for a document Mermaid does not render at all.
 */
const RELATIONSHIP_BODY_ONLY_RE = /^[-.]{2,}$/;

/**
 * The line that opens an entity's attribute block, and the one that closes
 * it — the two ends of the construct this parser skips over whole.
 *
 * Measured: `CUSTOMER { string name / int age }` records the attributes
 * *under* an entity that still enters the table as `CUSTOMER`, so the block
 * is one construct rather than a run of independent statements. Reporting
 * each body line as malformed as well would make three claims where one is
 * true, and two of them would be untrue — `string name` is perfectly good ER.
 */
const ATTRIBUTE_BLOCK_OPEN_RE = /^(?:[\w*.-]|[^\x00-\x7F])+\s*\{$/u;
const ATTRIBUTE_BLOCK_CLOSE = "}";

/**
 * The constructs this parser reads well enough to *recognize* and does not
 * implement — each refused **by name**, in the author's own words.
 *
 * CONTEXT.md's opening policy is what makes this a table rather than a
 * silence, and `parseStateDiagram` carries the same one for the same reason:
 * while a construct is unimplemented, Siren rejects it and says what is
 * missing, so an author knows to route around it. Every entry is valid
 * Mermaid (measured against 11.17.2 with `scripts/mermaid-probe.mjs`) and
 * carries a `rejected` row in the compatibility corpus, which is where the
 * measurement of each lives. Falling through to `Unrecognized erDiagram
 * line` would tell the author their document is malformed — a different
 * claim, and an untrue one.
 *
 * Read **last**, after every construct this parser does implement, so a
 * pattern here can never shadow a working one. Each is anchored on the
 * *statement* rather than on a bare word, which is what leaves an entity the
 * author simply named `direction` or `to` alone.
 *
 * The table shrinks as constructs land. Every one of these has a ticket.
 *
 * The attribute block is the one unimplemented construct **not** in here,
 * because it is the one that spans several lines: it is named at the line
 * that opens it and then swallowed whole (see `ATTRIBUTE_BLOCK_OPEN_RE`),
 * which a table of one-line patterns cannot express.
 */
const UNIMPLEMENTED: readonly { pattern: RegExp; name: string }[] = [
  {
    // Two spellings of one construct, measured to be exactly that: both
    // `CUSTOMER ||--o{ ORDER : places` and `CUSTOMER one to zero or more
    // ORDER : places` report `leftCard="ONLY_ONE" relType="IDENTIFYING"
    // rightCard="ZERO_OR_MORE"`, so the words are a synonym of the
    // punctuation rather than a second construct.
    //
    // The punctuation half requires the body (`--`, `..`, `.-`, `-.`) to be
    // its own whitespace-delimited token, flanked only by cardinality
    // punctuation. That is what keeps it off `A--B C`, where Mermaid's own
    // longest-match lexer reads `A--B` as **one entity name** and no
    // relationship exists to refuse.
    pattern: /^\S+\s+[|o{}01+]*(?:--|\.\.|\.-|-\.)[|o{}01+]*(?:\s|$)/,
    name: "a relationship between two entities",
  },
  {
    // The word spelling of the same thing. `to` and `optionally to` are the
    // two identification words (measured), and nothing this parser
    // implements is more than one token wide, so a multi-token line reaching
    // here cannot be an entity being shadowed.
    pattern: /^\S+\s+.*\s(?:optionally\s+)?to\s/i,
    name: "a relationship between two entities",
  },
  {
    // Measured: `CUSTOMER["Customer Account"]` records **one** entity whose
    // `label` is still `CUSTOMER`, with `alias="Customer Account"` beside
    // it. So the alias is a second field on the entity rather than a
    // renaming of it — and reading the line while dropping the brackets
    // would title the box with the very name the author replaced.
    pattern: /^(?:[\w*.-]|[^\x00-\x7F])+\s*\[/u,
    name: "an entity alias",
  },
  {
    // Measured: `direction LR` reports `LR` where a document naming none
    // reports `TB`, so it genuinely governs the layout and cannot be read
    // and dropped.
    //
    // **Four spellings, and `TD` is deliberately not among them.** Mermaid's
    // ER lexer writes the four out literally and has no `TD` rule (the
    // flowchart's alias does not reach this grammar), so `direction TD` is
    // measured to be *two entities* — `direction` and `TD` — and refusing it
    // here would refuse a document Mermaid draws. Case-insensitive, because
    // the lexer is: `direction lr` reports `LR` too.
    pattern: /^direction\s+(?:TB|BT|RL|LR)\s*$/i,
    name: 'a document-level "direction" statement',
  },
];

/**
 * The refusal for `line`, or `null` when this parser has no name for what is
 * wrong with it and the generic unrecognized-line message is the honest
 * answer.
 */
function unimplementedIn(line: string): string | null {
  for (const { pattern, name } of UNIMPLEMENTED) {
    if (pattern.test(line)) {
      return `Unimplemented erDiagram construct: ${name}, in "${line}"`;
    }
  }
  return null;
}

/**
 * Parses Siren ER-diagram source text — an `erDiagram` header and the
 * entities declared under it. Never throws: a malformed line is reported as
 * a diagnostic and costs the document.
 */
export function parseErDiagram(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const entities: ErEntityDecl[] = [];
  let sawError = false;
  let sawHeader = false;
  /**
   * Whether the reader is inside an attribute block it has already refused.
   * The body is swallowed rather than read: the construct was named once at
   * the line that opened it, and every further message about it would be a
   * second opinion on the same gap.
   */
  let inAttributeBlock = false;

  const lines = source.split(/\r\n|\r|\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    if (inAttributeBlock) {
      inAttributeBlock = line !== ATTRIBUTE_BLOCK_CLOSE;
      continue;
    }

    const lineNumber = index + 1;
    const column = rawLine.length - rawLine.trimStart().length + 1;

    // The header, asked of the shared registry rather than of a private copy
    // of the pattern — the rule `parseStateDiagram` already follows, so this
    // parser and the dispatcher cannot disagree about which spellings exist.
    if (!sawHeader) {
      if (matchDiagramHeader(line) !== "er") {
        diagnostics.push({
          severity: "error",
          message: `Expected ${ER_HEADERS}, found "${line}"`,
          line: lineNumber,
          column,
        });
        return { document: null, diagnostics };
      }
      sawHeader = true;
      continue;
    }

    if (ENTITY_NAME_RE.test(line) && !RELATIONSHIP_BODY_ONLY_RE.test(line)) {
      entities.push({ name: line });
      continue;
    }

    // Refused by name at the line that opens it, and then swallowed whole —
    // see `ATTRIBUTE_BLOCK_OPEN_RE`. Its body is good ER, so the honest
    // count of things wrong with this document is one.
    if (ATTRIBUTE_BLOCK_OPEN_RE.test(line)) {
      diagnostics.push({
        severity: "error",
        message: `Unimplemented erDiagram construct: an entity's attribute block, in "${line}"`,
        line: lineNumber,
        column,
      });
      sawError = true;
      inAttributeBlock = true;
      continue;
    }

    // Read last, so nothing here can shadow a construct this parser does
    // implement: a line only reaches the table once every working pattern
    // above has declined it.
    diagnostics.push({
      severity: "error",
      message: unimplementedIn(line) ?? `Unrecognized erDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
  }

  if (!sawHeader) {
    diagnostics.push({
      severity: "error",
      message: `Empty document: expected a ${ER_HEADERS} header`,
      line: 1,
      column: 1,
    });
    return { document: null, diagnostics };
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const document: ErDocument = { kind: "er", entities };
  return { document, diagnostics };
}
