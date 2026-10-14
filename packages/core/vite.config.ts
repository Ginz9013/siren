import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { thirdPartyBanner, thirdPartyNotices } from "./thirdPartyNotices";

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
 * The standalone file therefore *distributes* elkjs, which is not MIT:
 * `thirdPartyNotices` writes `dist/THIRD-PARTY-NOTICES.md` beside it, and
 * the bundle's first line points there.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    plugins: standalone ? [thirdPartyNotices("siren-core", "siren-core.js")] : [],
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
        output: standalone ? { banner: thirdPartyBanner("siren-core") } : {},
      },
    },
  };
});
