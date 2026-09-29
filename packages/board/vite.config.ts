import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const coreSource = fileURLToPath(new URL("../core/src/index.ts", import.meta.url));

/**
 * Vite library-mode build for `siren-board`, in two shapes mirroring
 * `siren-core`'s own build.
 *
 * - Default mode, `dist/index.js`: the npm entry point. `siren-core` stays
 *   external — it is a dependency, so a consumer that also imports core
 *   directly gets one copy of it, not two.
 * - `--mode standalone`, `dist/siren-board.js`: the public `createBoard()`
 *   entry point and everything it pulls in, including `siren-core` (read from
 *   source), in a single self-contained ESM file — so a demo page can load it
 *   directly via `<script type="module" src="...">` with no bundler or import
 *   map (see ADR-0005).
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    resolve: standalone ? { alias: { "siren-core": coreSource } } : {},
    build: {
      emptyOutDir: !standalone,
      minify: standalone,
      lib: {
        entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        name: "SirenBoard",
        formats: ["es"],
        fileName: () => (standalone ? "siren-board.js" : "index.js"),
      },
      rollupOptions: {
        external: standalone ? [] : [/^siren-core(\/.*)?$/],
      },
    },
  };
});
