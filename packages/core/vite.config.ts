import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite library-mode build for `siren-core`, in two shapes.
 *
 * - Default mode, `dist/index.js`: the npm entry point. Dependencies stay
 *   external — `@dagrejs/dagre` and `elkjs` — so a consumer's bundler dedupes
 *   them like any other package and their licences travel in their own
 *   packages.
 * - `--mode standalone`, `dist/siren-core.js`: the public `render()` entry
 *   point and everything it pulls in, including both layout engines, in a
 *   single self-contained ESM file, so `demos/step-reveal.html` (or a CDN
 *   user) can load it directly via `<script type="module" src="...">` without
 *   a bundler or import map.
 *
 * The standalone file therefore *distributes* elkjs, which is licensed
 * `EPL-2.0 OR GPL-3.0-or-later` rather than MIT, and the EPL-2.0 asks that a
 * copy of the program in object form carry its licence. `thirdPartyNotices`
 * writes `dist/THIRD-PARTY-NOTICES.md` beside it, and the bundle's first
 * line points there.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    plugins: standalone ? [thirdPartyNotices()] : [],
    build: {
      emptyOutDir: !standalone,
      minify: standalone,
      lib: {
        entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        name: "SirenCore",
        formats: ["es"],
        fileName: () => (standalone ? "siren-core.js" : "index.js"),
      },
      rollupOptions: {
        external: standalone ? [] : [/^@dagrejs\/dagre(\/.*)?$/, /^elkjs(\/.*)?$/],
        output: standalone
          ? {
              banner:
                "/*! siren-core (MIT). Bundles elkjs (EPL-2.0 OR GPL-3.0-or-later, " +
                "https://github.com/kieler/elkjs) and @dagrejs/dagre (MIT); " +
                "see THIRD-PARTY-NOTICES.md. */",
            }
          : {},
      },
    },
  };
});

/**
 * Emits `THIRD-PARTY-NOTICES.md` next to the standalone bundle: which
 * third-party code is inside it, under which licence, and elkjs's licence
 * text verbatim — read from the installed package at build time, so the
 * notice is always the one the bundled version ships with.
 */
function thirdPartyNotices(): Plugin {
  const require = createRequire(import.meta.url);
  const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));
  const version = (name: string) =>
    (JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf8")) as { version: string }).version;
  return {
    name: "siren-third-party-notices",
    generateBundle() {
      const elkLicence = readFileSync(join(packageDir("elkjs"), "LICENSE.md"), "utf8");
      const dagreLicence = readFileSync(join(packageDir("@dagrejs/dagre"), "LICENSE"), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-NOTICES.md",
        source: [
          "# Third-party notices for dist/siren-core.js",
          "",
          "`dist/siren-core.js`, the standalone build of siren-core, bundles the",
          "following third-party code. siren-core itself is MIT-licensed (see LICENSE).",
          "",
          `## elkjs ${version("elkjs")}`,
          "",
          "Eclipse Layout Kernel, compiled to JavaScript. https://github.com/kieler/elkjs",
          "Licensed under EPL-2.0 OR GPL-3.0-or-later; distributed here under the",
          "Eclipse Public License 2.0, whose text follows. The source code is",
          "available from the project above and from the npm package `elkjs`.",
          "",
          elkLicence,
          "",
          `## @dagrejs/dagre ${version("@dagrejs/dagre")}`,
          "",
          "https://github.com/dagrejs/dagre",
          "",
          "```",
          dagreLicence.trim(),
          "```",
          "",
        ].join("\n"),
      });
    },
  };
}
