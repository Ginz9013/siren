import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Vite library-mode build for `@siren/board`.
 *
 * Bundles the public `createBoard()` entry point (and everything it pulls
 * in, including `@siren/core`) into a single self-contained ESM file under
 * `dist/`, mirroring `@siren/core`'s own build — so a demo page can load it
 * directly via `<script type="module" src="...">` with no bundler or import
 * map (see ADR-0005).
 */
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "SirenBoard",
      formats: ["es"],
      fileName: () => "siren-board.js",
    },
  },
});
