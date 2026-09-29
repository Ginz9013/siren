import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Vite library-mode build for `siren-core`, in two shapes.
 *
 * - Default mode, `dist/index.js`: the npm entry point. Dependencies stay
 *   external, so a consumer's bundler dedupes `@dagrejs/dagre` like any
 *   other package.
 * - `--mode standalone`, `dist/siren-core.js`: the public `render()` entry
 *   point and everything it pulls in, including `@dagrejs/dagre`, in a single
 *   self-contained ESM file, so `demos/step-reveal.html` (or a CDN user) can
 *   load it directly via `<script type="module" src="...">` without a bundler
 *   or import map.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
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
        external: standalone ? [] : [/^@dagrejs\/dagre(\/.*)?$/],
      },
    },
  };
});
