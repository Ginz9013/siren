import { JSON_SCHEMA, load, YAMLException } from "js-yaml";
import type { Diagnostic } from "../contracts";
import type { SourcePosition } from "../label/label";
import type { DiagramKind } from "./parseDirection";

/**
 * A document's frontmatter, read as Mermaid 12.2.0 reads it, and the
 * document left behind once it is gone.
 *
 * - `source` is the document with the frontmatter's lines blanked in place:
 *   every character but the line breaks removed, so each later line keeps
 *   its number and every diagnostic still points at the line the author
 *   wrote. A document with no frontmatter comes back as it was given.
 * - `config` is the frontmatter's `config` as written — the **document
 *   config** — or `{}` when there is none.
 * - `diagnostics` says what of it was read and is not drawn, or kept, as
 *   warnings, or why Mermaid refuses the whole document, as one error — and
 *   then the diagram below is not to be read at all. Its config keys are
 *   not reported here: whether the frontmatter or a directive decides each
 *   is only known once both are read (`documentConfigOf`).
 * - `position` is its opening fence, where its warnings point.
 */
export interface FrontmatterRead {
  source: string;
  config: Record<string, unknown>;
  diagnostics: Diagnostic[];
  position: SourcePosition;
}

/**
 * Mermaid's `whitespace` (`diagram-api/regexes.ts`): one character of
 * JavaScript's `\s`, which is wider than ASCII — a no-break space indents a
 * frontmatter as well as a space does.
 */
const WHITESPACE = /\s/;

const isLineBreak = (char: string | undefined): boolean => char === "\n" || char === "\r";

/**
 * Reads the frontmatter at the top of `text`, the document after Mermaid's
 * `cleanupText` — its tag quotes rewritten and its line breaks `\n` — which
 * is where Mermaid's `preprocessDiagram` reads it: after `cleanupText` and
 * before directives or comments are touched, so a `%%` inside a frontmatter
 * is YAML, not a comment.
 *
 * The rules are Mermaid's (`processFrontmatter` over `extractFrontMatter`
 * over `matchFrontMatter`, ported rather than imported — ADR-0001):
 *
 * - **Only at the very top.** The first line may be indented by whitespace
 *   that is not a line break, and must then begin `---` with nothing but
 *   whitespace after it. A blank line above the fence, or anything else,
 *   means there is no frontmatter, and the `---` is read as diagram text —
 *   which no diagram header accepts.
 * - **Closed by the same indent.** A closing fence is a line break followed
 *   by the opening line's indent and `---`, with only whitespace up to a
 *   later line break. The frontmatter runs to the first such fence at or
 *   before the last one in the document; a document none of whose lines
 *   closes it has no frontmatter. The indent is taken off each body line
 *   that starts with it before the YAML is read.
 * - **YAML under the JSON schema** (`js-yaml`, as Mermaid uses it). A body
 *   that reads as anything but a mapping — a string, a list, nothing — is
 *   an empty frontmatter, not a mistake.
 * - **Only the keys Mermaid knows.** `config` is kept as written, with a
 *   `displayMode` folded into `config.gantt.displayMode`; `title` is read
 *   and, like every config key, reported as not applied. A key Mermaid does
 *   not know (`siren:`) is dropped unread, as Mermaid drops it.
 */
export function readFrontmatter(text: string): FrontmatterRead {
  const match = matchFrontmatter(text);
  if (match === undefined) {
    return { source: text, config: {}, diagnostics: [], position: { line: 1, column: 1 } };
  }
  const yamlBody = match.indent
    ? match.body
        .split("\n")
        .map((line) => (line.startsWith(match.indent) ? line.slice(match.indent.length) : line))
        .join("\n")
    : match.body;
  // The opening fence: line 1 always, since an indent holds no line break.
  const openingFence = { line: 1, column: match.indent.length + 1 };
  // Where Mermaid throws, it draws nothing; so does this, as a diagnostic
  // rather than a throw, and the document is read no further.
  const refuse = (why: string): FrontmatterRead => ({
    source: text,
    config: {},
    diagnostics: [{ severity: "error", message: `${why}; Mermaid refuses the document too.`, ...openingFence }],
    position: openingFence,
  });
  let loaded: unknown;
  try {
    loaded = load(yamlBody, { schema: JSON_SCHEMA });
  } catch (error) {
    const reason = error instanceof YAMLException ? error.reason : String(error);
    return refuse(`Frontmatter is not valid YAML (${reason})`);
  }
  const parsed = asMapping(loaded);
  const config = isMapping(parsed.config) ? parsed.config : {};
  if (parsed.displayMode) {
    // `processFrontmatter`: a top-level `displayMode` is Gantt's, and lands
    // in `config.gantt` beside whatever the author wrote there — a missing
    // or falsy `gantt` (or `config`) becomes a fresh one. A truthy scalar
    // takes no property, and Mermaid's assignment to it throws ("Cannot
    // create property 'displayMode' on boolean 'true'", measured on 12.2.0).
    if (isScalar(parsed.config)) {
      return refuse("Frontmatter displayMode cannot be written into config, which is not a mapping");
    }
    if (isScalar(config.gantt)) {
      return refuse("Frontmatter displayMode cannot be written into config.gantt, which is not a mapping");
    }
    const gantt = isMapping(config.gantt) ? config.gantt : {};
    gantt.displayMode = String(parsed.displayMode);
    config.gantt = gantt;
  }
  const diagnostics: Diagnostic[] = [];
  if (parsed.config && !isMapping(parsed.config)) {
    // Mermaid keeps a truthy `config` of any kind and merges it with
    // es-toolkit's `merge` (imported in lodash's place), which reads a string
    // as nothing and spreads a list's items into index keys no diagram reads;
    // it draws the diagram (measured on 12.2.0). Siren keeps nothing of it
    // and says so.
    diagnostics.push({
      severity: "warning",
      message: "Frontmatter config is not a mapping; it is ignored, and the diagram is drawn without it.",
      ...openingFence,
    });
  }
  if (parsed.title) {
    diagnostics.push({
      severity: "warning",
      message: "Frontmatter title is read but not drawn yet; the diagram is drawn without it.",
      ...openingFence,
    });
  }
  return {
    source: text.slice(0, match.length).replace(/[^\n]/g, "") + text.slice(match.length),
    config,
    diagnostics,
    position: openingFence,
  };
}

/**
 * The warning for a top-level document config key Siren reads and keeps but
 * does not act on yet (ADR-0017's first step: read every key, apply none).
 * Mermaid would apply it, so the picture differs, and saying so beats
 * dropping it in silence.
 */
function notAppliedYet(key: string): string {
  return `Document config "${key}" is read but not applied yet; the diagram is drawn without it.`;
}

/** A value a property cannot be written into: a truthy string, number or boolean. */
function isScalar(value: unknown): boolean {
  return Boolean(value) && typeof value !== "object";
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What `extractFrontMatter` keeps of a loaded body: a mapping, or nothing at all. */
function asMapping(value: unknown): Record<string, unknown> {
  return isMapping(value) ? value : {};
}

/**
 * Mermaid's `matchFrontMatter`, step for step: where the frontmatter at the
 * top of `text` is, as its opening line's `indent`, the YAML `body` between
 * the fences, and the `length` of text it takes up — which runs past the
 * closing fence through the last line break of the whitespace after it, so
 * it always ends on a line break. `undefined` when `text` has none.
 */
function matchFrontmatter(text: string): { indent: string; body: string; length: number } | undefined {
  let cursor = 0;
  while (cursor < text.length && WHITESPACE.test(text[cursor]!) && !isLineBreak(text[cursor])) {
    cursor++;
  }
  const indent = text.slice(0, cursor);
  if (!text.startsWith("---", cursor)) {
    return undefined;
  }
  const openingEnds: number[] = [];
  for (let i = cursor + 3; i < text.length && WHITESPACE.test(text[i]!); i++) {
    if (isLineBreak(text[i])) {
      openingEnds.push(i);
    }
  }
  if (openingEnds.length === 0) {
    return undefined;
  }
  const closingFence = `${indent}---`;
  const closingEnd = (i: number): number =>
    isLineBreak(text[i]) && text.startsWith(closingFence, i + 1)
      ? lastLineBreakInWhitespaceRun(text, i + 1 + closingFence.length)
      : -1;
  let lastClosingFence = -1;
  for (let i = openingEnds[0]! + 1; i < text.length; i++) {
    if (closingEnd(i) !== -1) {
      lastClosingFence = i;
    }
  }
  if (lastClosingFence === -1) {
    return undefined;
  }
  let openingEnd = openingEnds[0]!;
  for (const candidate of openingEnds) {
    if (candidate < lastClosingFence) {
      openingEnd = candidate;
    }
  }
  const bodyStart = openingEnd + 1;
  for (let i = bodyStart; i <= lastClosingFence; i++) {
    const matchEnd = closingEnd(i);
    if (matchEnd !== -1) {
      return { indent, body: text.slice(bodyStart, i), length: matchEnd + 1 };
    }
  }
  return undefined;
}

/**
 * Mermaid's `lastLineBreakInWhitespaceRun`: the index of the last line break
 * in the run of whitespace starting at `from`, or `-1` when the run holds
 * none — so a closing fence followed by more text on its own line, or by the
 * end of the document, closes nothing.
 */
function lastLineBreakInWhitespaceRun(text: string, from: number): number {
  let index = -1;
  for (let i = from; i < text.length && WHITESPACE.test(text[i]!); i++) {
    if (isLineBreak(text[i])) {
      index = i;
    }
  }
  return index;
}

/**
 * A document's `%%{…}%%` directives, read as Mermaid 12.2.0 reads them, and
 * the document left behind once they are gone.
 *
 * - `source` is the document with every directive blanked in place: each
 *   of its characters but a line break made a space, so every later line
 *   and column — on the directive's last line too — is where the author
 *   wrote it.
 * - `init` is what its init directives say, or `undefined` when none says
 *   anything; `positions` says which directive decided each of its
 *   top-level keys.
 * - `wrap` is what its wrap directives say, and where, or `undefined` when
 *   they say nothing.
 * - `diagnostics` says what was removed unread, as warnings, or why Mermaid
 *   refuses the whole document, as one error.
 */
export interface DirectivesRead extends InitsRead {
  source: string;
  wrap: { value: boolean; position: SourcePosition } | undefined;
  diagnostics: Diagnostic[];
}

/** What a document's init directives say together, and which decided each top-level key. */
interface InitsRead {
  init: Record<string, unknown> | undefined;
  positions: Map<string, SourcePosition>;
}

/** One init directive's arguments as read, and where the directive starts. */
interface InitRead {
  args: unknown;
  position: SourcePosition;
}

/** One directive whose type holds `wrap`, its type, and where it starts. */
interface WrapDirective {
  match: RegExpMatchArray;
  type: string;
  position: SourcePosition;
}

/**
 * Mermaid's `directiveRegex`, character for character: `%%{`, a type word
 * (`init:` with its arguments, or a bare `wrap`), then arguments that run
 * to the first `}%%` — across line breaks — and the `}%%` itself, which may
 * be missing, so an unclosed directive runs to the end of the document.
 */
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;

/**
 * The diagram type Mermaid 12.2.0 detects for each kind's headers, as
 * `detectInit` names the key an init's `config` moves under — measured:
 * `flowchart` for `flowchart` and `graph` alike (`flowchart-v2` is renamed
 * `flowchart`), and one type for both spellings of the class and state
 * headers.
 */
const MERMAID_DIAGRAM_TYPE: Record<DiagramKind, string> = {
  flowchart: "flowchart",
  sequence: "sequence",
  class: "classDiagram",
  state: "stateDiagram",
  er: "er",
};

const INIT_NOT_JSON =
  "Init directive is not valid JSON; Mermaid then ignores every init directive in the document, " +
  "and so does Siren — the diagram is drawn without them.";

/** Mermaid's `detectInit` type test: a type word holding `init` or `initialize` at a word's end. */
const INIT_TYPE = /(?:init\b)|(?:initialize\b)/;

/**
 * Reads and removes the directives in `text`, the document after its
 * frontmatter is blanked (`readFrontmatter`) — which is where Mermaid's
 * `preprocessDiagram` reads them: after the frontmatter, before any `%%`
 * comment is removed, so a directive is found wherever it stands, at the end
 * of a diagram line or inside a comment too, and a directive spanning lines
 * is removed whole rather than left half behind as diagram text.
 */
export function readDirectives(text: string): DirectivesRead {
  const inits: InitRead[] = [];
  const wraps: WrapDirective[] = [];
  const diagnostics: Diagnostic[] = [];
  let unreadable = false;
  let source = "";
  let copied = 0;
  for (const match of text.matchAll(DIRECTIVE)) {
    const position = positionOf(text, match.index);
    const type = match[1] ?? match[2] ?? "";
    if (INIT_TYPE.test(type)) {
      try {
        inits.push({ args: argumentsOf(match), position });
      } catch {
        unreadable = true;
        diagnostics.push({ severity: "warning", message: INIT_NOT_JSON, ...position });
      }
    } else if (type.includes("wrap")) {
      wraps.push({ match, type, position });
    } else {
      diagnostics.push({ severity: "warning", message: removedUnread(type), ...position });
    }
    source += text.slice(copied, match.index) + match[0].replace(/[^\n]/g, " ");
    copied = match.index + match[0].length;
  }
  source += text.slice(copied);
  // `detectDirective` parses inside one `try`: the first init that is not
  // JSON ends it, and it hands back no init at all — the readable ones
  // before it included (measured on 12.2.0). Mermaid only logs it and draws
  // the diagram.
  const { init, positions } = unreadable ? { init: undefined, positions: new Map<string, SourcePosition>() } : initOf(inits);
  const wrap = wrapOf(wraps);
  if (wrap === undefined) {
    for (const { type, position } of wraps) {
      diagnostics.push({ severity: "warning", message: removedUnread(type), ...position });
    }
  } else if (!unreadable && inits.length === 1 && isScalar(inits[0]!.args)) {
    // `processDirectives` writes `wrap` into what `detectInit` handed back,
    // and one init's arguments are handed back as they are: a bare word or
    // any other truthy scalar takes no property, and the assignment throws
    // ("Cannot create property 'wrap' on string 'dark'", measured on
    // 12.2.0). Where Mermaid throws, it draws nothing; so does this.
    const refusal: Diagnostic = {
      severity: "error",
      message:
        `Wrap directive cannot be written into the init directive "${String(inits[0]!.args)}", ` +
        "which is not a mapping; Mermaid refuses the document too.",
      ...wrap.position,
    };
    return { source, init: undefined, wrap: undefined, positions: new Map(), diagnostics: [refusal] };
  }
  return { source, init, wrap, positions, diagnostics: inDocumentOrder(diagnostics) };
}

/**
 * What `detectInit` makes of a document's readable init directives, and
 * which of them decided each top-level key.
 *
 * - **One** is handed back as it is written, to be merged over the
 *   frontmatter's config by `cleanAndMerge` — es-toolkit's `merge`, which
 *   reads a list as a mapping from each index to its item and a bare word
 *   as nothing (measured on 12.2.0: `[1, 2]` reads `{"0": 1, "1": 2}`).
 * - **Several** are merged in order by `assignWithDepth`, after Mermaid's
 *   `sanitizeDirective` has been over each. Of what that sanitizing drops,
 *   only `config` — not a Mermaid config key — is dropped here, because only
 *   it changes what is read: one init's `config` is moved under the
 *   diagram's own key (`documentConfigOf`), several inits' never is
 *   (measured on 12.2.0). The rest it drops — keys Mermaid has no setting
 *   for — is kept as written, as the frontmatter's config is. A key is
 *   decided by the last init whose value `assignWithDepth` took for it.
 */
function initOf(inits: readonly InitRead[]): InitsRead {
  const positions = new Map<string, SourcePosition>();
  if (inits.length === 0) {
    return { init: undefined, positions };
  }
  if (inits.length === 1) {
    const { args, position } = inits[0]!;
    if (!isObject(args)) {
      return { init: undefined, positions };
    }
    const init: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      define(init, key, value);
      positions.set(key, position);
    }
    return { init, positions };
  }
  const init: Record<string, unknown> = {};
  for (const { args, position } of inits) {
    if (!isMapping(args)) {
      continue;
    }
    const sanitized = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "config"));
    for (const [key, value] of Object.entries(sanitized)) {
      if (takes(ownValue(init, key), value)) {
        positions.set(key, position);
      }
    }
    assignWithDepth(init, sanitized, 2);
  }
  return { init, positions };
}

/**
 * What `processDirectives` makes of the directives whose type holds `wrap`
 * (`detectDirective(code, "wrap")`): one says `wrap` only if its type is
 * exactly `wrap`; several say whether any of them is — so a lone `nowrap`
 * says nothing, and two of them say `false`. Their arguments are parsed as
 * an init's are, and one that is not JSON makes them all say nothing.
 */
function wrapOf(wraps: readonly WrapDirective[]): DirectivesRead["wrap"] {
  try {
    wraps.forEach(({ match }) => argumentsOf(match));
  } catch {
    return undefined;
  }
  const exact = wraps.find(({ type }) => type === "wrap");
  if (wraps.length > 1) {
    return { value: exact !== undefined, position: (exact ?? wraps[0]!).position };
  }
  return exact === undefined ? undefined : { value: true, position: exact.position };
}

/**
 * A directive's arguments as `detectDirective` reads them: a bare word as a
 * string, anything else as JSON once every `'` is made `"`, or `null` when
 * there are none.
 */
function argumentsOf(match: RegExpMatchArray): unknown {
  if (match[3]) {
    return match[3].trim();
  }
  return match[4] ? (JSON.parse(match[4].trim().replace(/'/g, '"')) as unknown) : null;
}

/**
 * Mermaid's `assignWithDepth`, which merges several inits: `src` into `dst`
 * key by key down to `depth` levels and shallowly below that; a list's items
 * are added to a list's unless already there; a `null` sets nothing, an
 * object never replaces a scalar and a scalar never replaces an object. Each
 * key is defined rather than assigned, as Mermaid defines a new one, so a
 * `__proto__` key is data and not a prototype.
 */
function assignWithDepth(dst: unknown, src: unknown, depth: number): unknown {
  if (Array.isArray(src) && !Array.isArray(dst)) {
    for (const item of src) {
      assignWithDepth(dst, item, depth);
    }
    return dst;
  }
  if (Array.isArray(src) && Array.isArray(dst)) {
    for (const item of src) {
      if (!dst.includes(item)) {
        dst.push(item);
      }
    }
    return dst;
  }
  if (dst === undefined || dst === null || depth <= 0) {
    if (isObject(dst) && isObject(src)) {
      for (const [key, value] of Object.entries(src)) {
        define(dst, key, value);
      }
      return dst;
    }
    return src;
  }
  if (isObject(src) && isObject(dst)) {
    for (const [key, value] of Object.entries(src)) {
      const current = ownValue(dst, key);
      if (!takes(current, value)) {
        continue;
      }
      if (isObject(value)) {
        const into = current === undefined ? (Array.isArray(value) ? [] : {}) : current;
        define(dst, key, assignWithDepth(into, value, depth - 1));
      } else {
        define(dst, key, value);
      }
    }
  }
  return dst;
}

/**
 * Mermaid's `cleanAndMerge` — es-toolkit's `merge({}, defaults, data)`
 * (`es-toolkit/compat`, which Mermaid 12.2.0 imports in lodash's place) — over
 * the values JSON and YAML can hold: a fresh object holding `defaults`, then
 * `data` merged into it all the way down. A mapping merges into a mapping (or
 * a list) key by key, a list into a list index by index, and anything else,
 * `null` included, replaces what was there. Neither argument is changed.
 */
function cleanAndMerge(defaults: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  const merged = {};
  mergeInto(merged, defaults);
  mergeInto(merged, data);
  return merged;
}

function mergeInto(target: object, source: object): void {
  for (const [key, value] of Object.entries(source)) {
    const current = ownValue(target, key);
    if (Array.isArray(value)) {
      const into = Array.isArray(current) ? current : [];
      mergeInto(into, value);
      define(target, key, into);
    } else if (isObject(value)) {
      const into = isObject(current) ? current : {};
      mergeInto(into, value);
      define(target, key, into);
    } else {
      define(target, key, value);
    }
  }
}

/**
 * Whether `assignWithDepth` takes `value` for a key now holding `current`:
 * never a `null`; anything where nothing is yet; and otherwise only an
 * object for an object or a scalar for a scalar.
 */
function takes(current: unknown, value: unknown): boolean {
  return value !== null && (current === undefined || isObject(value) === isObject(current));
}

/** `target`'s own value for `key`, never one it inherits — a `__proto__` key included. */
function ownValue(target: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(target, key) ? (target as Record<string, unknown>)[key] : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * The warning for a directive Mermaid finds and removes but takes nothing
 * from: a type it has no reading for, or a wrap directive that ends up saying
 * nothing.
 */
function removedUnread(type: string): string {
  return `Directive "${type}" is removed unread, as Mermaid removes it; the diagram is drawn without it.`;
}

/** `diagnostics` by line and then column, those at one place in the order given. */
function inDocumentOrder(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
}

/** Where `index` falls in `text`, as a line and column from 1. */
function positionOf(text: string, index: number): SourcePosition {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return { line: text.slice(0, lineStart).split("\n").length, column: index - lineStart + 1 };
}

/**
 * The **document config** — the frontmatter's and the directives' settings
 * merged as Mermaid's `preprocessDiagram` merges them — and a warning for
 * each of its top-level keys, none of which is applied yet, at whichever
 * source decided it: the directive that set it last, or else the
 * frontmatter's opening fence.
 *
 * The steps are Mermaid's, in Mermaid's order. `detectInit` moves an init's
 * `config` under the key of the diagram type the header names
 * (`MERMAID_DIAGRAM_TYPE`); `processDirectives` then sets `wrap`; and
 * `cleanAndMerge(frontmatter.config, directive)` merges the result over the
 * frontmatter's config, so an init wins wherever both set a value and a
 * mapping both set is merged all the way down (measured on 12.2.0:
 * `theme: forest` and `flowchart: {curve: linear, htmlLabels: false}` under
 * an init of `{"theme": "dark", "flowchart": {"curve": "basis"}}` read
 * `theme: dark` and `flowchart: {curve: basis, htmlLabels: false}`).
 *
 * Its diagnostics — the frontmatter's own, the directives' own, and these —
 * are in document order.
 */
export function documentConfigOf(
  frontmatter: FrontmatterRead,
  directives: DirectivesRead,
  kind: DiagramKind | null,
): { config: Record<string, unknown>; diagnostics: Diagnostic[] } {
  let init = directives.init === undefined ? undefined : { ...directives.init };
  const positions = new Map(directives.positions);
  if (init !== undefined && init.config !== undefined && kind !== null) {
    // `detectInit`: an init's `config` is the diagram's own settings, and
    // moves under the key of the diagram type Mermaid detects. Where no
    // header names a kind, Mermaid detects no type and refuses the
    // document, as Siren does; the `config` is left where it was.
    const key = MERMAID_DIAGRAM_TYPE[kind];
    init[key] = init.config;
    positions.set(key, positions.get("config")!);
    delete init.config;
  }
  if (directives.wrap !== undefined) {
    // `processDirectives` sets `wrap` on the init's settings, after the move.
    const into = init ?? {};
    into.wrap = directives.wrap.value;
    positions.set("wrap", directives.wrap.position);
    init = into;
  }
  const config = cleanAndMerge(frontmatter.config, init ?? {});
  const keyWarnings: Diagnostic[] = Object.keys(config).map((key) => ({
    severity: "warning",
    message: notAppliedYet(key),
    ...(positions.get(key) ?? frontmatter.position),
  }));
  return { config, diagnostics: inDocumentOrder([...frontmatter.diagnostics, ...directives.diagnostics, ...keyWarnings]) };
}
