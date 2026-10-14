import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/**
 * The licence notice every standalone bundle that carries `siren-core`'s
 * layout engine needs: `siren-core`'s own `dist/siren-core.js`, and
 * `siren-board`'s `dist/siren-board.js`, which bundles `siren-core` from
 * source. Both therefore *distribute* elkjs, which is not MIT — the pinned
 * 0.9.3 is `EPL-2.0` (a GPL-3.0 option only arrived in 0.12.0), read from the
 * installed package rather than written here — and the EPL-2.0 asks that a
 * copy of the program in object form carry its licence.
 *
 * They also distribute js-yaml, which reads a document's frontmatter. It is
 * MIT, and the MIT licence asks that its notice travel with every copy, so
 * its licence text goes into the same file.
 *
 * Both are resolved from this package, `siren-core`, the only one that
 * depends on them, so a version bump can never leave a stale licence behind
 * in either bundle.
 */
const require = createRequire(import.meta.url);
const elkjsDir = dirname(require.resolve("elkjs/package.json"));
const elkjs = JSON.parse(readFileSync(join(elkjsDir, "package.json"), "utf8")) as {
  version: string;
  license: string;
};
const jsYamlDir = dirname(require.resolve("js-yaml/package.json"));
const jsYaml = JSON.parse(readFileSync(join(jsYamlDir, "package.json"), "utf8")) as {
  version: string;
  license: string;
};

/**
 * The bundle's first line, pointing at the notice file beside it.
 * `packageName` is the package whose bundle this is.
 */
export function thirdPartyBanner(packageName: string): string {
  return (
    `/*! ${packageName} (MIT). Bundles elkjs ${elkjs.version} (${elkjs.license}, ` +
    `https://github.com/kieler/elkjs) and js-yaml ${jsYaml.version} (${jsYaml.license}, ` +
    "https://github.com/nodeca/js-yaml); see THIRD-PARTY-NOTICES.md. */"
  );
}

/**
 * Emits `THIRD-PARTY-NOTICES.md` next to the standalone bundle `bundleFile`
 * of `packageName`: which third-party code is inside it, under which
 * licence, and each one's licence text verbatim — read from the installed
 * package at build time, so the notice is always the one the bundled version
 * ships with.
 */
export function thirdPartyNotices(packageName: string, bundleFile: string): Plugin {
  return {
    name: "siren-third-party-notices",
    generateBundle() {
      const elkLicence = readFileSync(join(elkjsDir, "LICENSE.md"), "utf8");
      const jsYamlLicence = readFileSync(join(jsYamlDir, "LICENSE"), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-NOTICES.md",
        source: [
          `# Third-party notices for dist/${bundleFile}`,
          "",
          `\`dist/${bundleFile}\`, the standalone build of ${packageName}, bundles the`,
          `following third-party code. ${packageName} itself is MIT-licensed (see LICENSE).`,
          "",
          `## elkjs ${elkjs.version}`,
          "",
          "Eclipse Layout Kernel, compiled to JavaScript. https://github.com/kieler/elkjs",
          `Licensed under ${elkjs.license}; distributed here under the`,
          "Eclipse Public License 2.0, whose text follows. The source code is",
          "available from the project above and from the npm package `elkjs`.",
          "",
          elkLicence,
          "",
          `## js-yaml ${jsYaml.version}`,
          "",
          "YAML 1.2 parser for JavaScript, used to read a document's frontmatter.",
          "https://github.com/nodeca/js-yaml",
          `Licensed under ${jsYaml.license}, whose text follows.`,
          "",
          jsYamlLicence,
          "",
        ].join("\n"),
      });
    },
  };
}
