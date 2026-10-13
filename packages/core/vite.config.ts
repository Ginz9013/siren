import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite library-mode build for `siren-core`, in two shapes.
 *
 * - Default mode, `dist/index.js`: the npm entry point. The one dependency,
 *   `elkjs`, stays external, so a consumer's bundler dedupes it like any
 *   other package and its licence travels in its own package.
 * - `--mode standalone`, `dist/siren-core.js`: the public `render()` entry
 *   point and everything it pulls in, including the layout engine, in a
 *   single self-contained ESM file, so `demos/step-reveal.html` (or a CDN
 *   user) can load it directly via `<script type="module" src="...">` without
 *   a bundler or import map.
 *
 * The standalone file therefore *distributes* elkjs, which is not MIT — the
 * pinned 0.9.3 is `EPL-2.0` (a GPL-3.0 option only arrived in 0.12.0), read
 * from the installed package rather than written here — and the EPL-2.0 asks that a
 * copy of the program in object form carry its licence. `thirdPartyNotices`
 * writes `dist/THIRD-PARTY-NOTICES.md` beside it, and the bundle's first
 * line points there.
 */
const require = createRequire(import.meta.url);
const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`));
/** The installed package's own `package.json`, so a version bump can never leave a stale licence behind. */
const installed = (name: string) =>
  JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf8")) as { version: string; license: string };

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
        external: standalone ? [] : [/^elkjs(\/.*)?$/],
        output: standalone
          ? {
              banner:
                `/*! siren-core (MIT). Bundles elkjs ${installed("elkjs").version} (${installed("elkjs").license}, ` +
                "https://github.com/kieler/elkjs); see THIRD-PARTY-NOTICES.md. */",
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
  const version = (name: string) => installed(name).version;
  return {
    name: "siren-third-party-notices",
    generateBundle() {
      const elkLicence = readFileSync(join(packageDir("elkjs"), "LICENSE.md"), "utf8");
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
          `Licensed under ${installed("elkjs").license}; distributed here under the`,
          "Eclipse Public License 2.0, whose text follows. The source code is",
          "available from the project above and from the npm package `elkjs`.",
          "",
          elkLicence,
          "",
        ].join("\n"),
      });
    },
  };
}
