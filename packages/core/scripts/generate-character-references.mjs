/**
 * Regenerates the `NAMED` table in `src/label/characterReferences.ts` — the
 * HTML standard's named character references — from the decoder jsdom's
 * HTML parser uses, which is the parser `mermaid-probe.mjs` measures
 * Mermaid's labels through:
 *
 *     node packages/core/scripts/generate-character-references.mjs
 *     node packages/core/scripts/generate-character-references.mjs --check
 *
 * `--check` writes nothing, and exits non-zero when the committed table is
 * not what this script would write.
 *
 * The decoder is the `entities` package jsdom reaches through `parse5`,
 * resolved from jsdom itself rather than named as a dependency of this
 * package, so the table is always the one the probe's parser holds. It ships
 * the table only as a compressed trie (`htmlDecodeTree`), which is walked
 * here: every path from the root that ends at a value is a name, a path
 * ending in `;` the name with its `;`, and one without the name the standard
 * also accepts without its `;` — a **legacy** name, marked `*` in the table.
 *
 * Only the text between `const NAMED = \`` and the closing `` `; `` is
 * written; everything else in that file is ordinary source.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const parse5 = createRequire(require.resolve("jsdom")).resolve("parse5");
const decode = createRequire(parse5)("entities/decode");
const { htmlDecodeTree, BinTrieFlags, determineBranch } = decode;

const TARGET = fileURLToPath(new URL("../src/label/characterReferences.ts", import.meta.url));

/** The characters a reference name is spelled with, and the `;` that may end it. */
const NAME_CHARACTERS = [..."0123456789;ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];

/** How many trie slots a node's value takes: 0 for none. */
function valueLength(node) {
  return (htmlDecodeTree[node] & BinTrieFlags.VALUE_LENGTH) >> 14;
}

/** The text the value at `node` stands for, as the decoder emits it. */
function valueAt(node) {
  const length = valueLength(node);
  const units =
    length === 1
      ? [htmlDecodeTree[node] & ~BinTrieFlags.VALUE_LENGTH]
      : length === 2
        ? [htmlDecodeTree[node + 1]]
        : [htmlDecodeTree[node + 1], htmlDecodeTree[node + 2]];
  return String.fromCharCode(...units);
}

/** Every name in the trie under `node`, reached by `prefix`, with its text. */
function* walk(node, prefix) {
  const current = htmlDecodeTree[node];
  for (const character of NAME_CHARACTERS) {
    const next = determineBranch(htmlDecodeTree, current, node + Math.max(1, valueLength(node)), character.charCodeAt(0));
    if (next < 0) {
      continue;
    }
    const name = prefix + character;
    if (valueLength(next) !== 0) {
      yield { name, text: valueAt(next) };
    }
    if (character !== ";") {
      yield* walk(next, name);
    }
  }
}

/** The table's entries, `name:codepoints`, a legacy name marked `*`. */
function entries() {
  const terminated = new Map();
  const legacy = new Set();
  for (const { name, text } of walk(0, "")) {
    if (name.endsWith(";")) {
      terminated.set(name.slice(0, -1), text);
    } else {
      legacy.add(name);
    }
  }
  // Code-unit order, except that a name comes after every name it is a
  // prefix of (`Delta` before `Del`), as the table has always been ordered.
  const names = [...terminated.keys()].sort((a, b) => {
    const [x, y] = [`${a}\u007f`, `${b}\u007f`];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return names.map((name) => {
    const points = Array.from(terminated.get(name), (character) =>
      character.codePointAt(0).toString(16).toUpperCase(),
    );
    return `${legacy.has(name) ? "*" : ""}${name}:${points.join("+")}`;
  });
}

/** `items`, space-separated, in lines of at most `width` columns, each indented by two. */
function wrap(items, width) {
  const lines = [];
  let line = "";
  for (const item of items) {
    if (line !== "" && 2 + line.length + 1 + item.length > width) {
      lines.push(`  ${line}`);
      line = item;
    } else {
      line = line === "" ? item : `${line} ${item}`;
    }
  }
  lines.push(`  ${line}`);
  return lines.join("\n");
}

const source = readFileSync(TARGET, "utf8");
const match = /(const NAMED = `\n)([\s\S]*?)(\n`;)/.exec(source);
if (match === null) {
  console.error(`No \`const NAMED = \`...\`;\` block in ${TARGET}.`);
  process.exit(1);
}
const table = wrap(entries(), 98);
const regenerated = source.slice(0, match.index) + match[1] + table + match[3] + source.slice(match.index + match[0].length);

if (process.argv.includes("--check")) {
  if (regenerated !== source) {
    console.error(`${TARGET} is not what this script generates; run it without --check.`);
    process.exit(1);
  }
  console.log(`${TARGET} is up to date.`);
} else {
  writeFileSync(TARGET, regenerated);
  console.log(`Wrote ${TARGET}.`);
}
