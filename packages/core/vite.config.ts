import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Vite library-mode build for `@siren/core`.
 *
 * Bundles the public `render()` entry point (and everything it pulls in,
 * including `@dagrejs/dagre`) into a single self-contained ESM file under
 * `dist/`, so `demos/step-reveal.html` can load it directly via
 * `<script type="module" src="...">` without a bundler or import map.
 */
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "SirenCore",
      formats: ["es"],
      fileName: () => "siren-core.js",
    },
  },
});
