/**
 * Bundles a package's declarations into one `dist/index.d.ts`, run from the
 * package's own directory by its `build` script.
 *
 * One bundled file rather than `tsc`'s file-per-module output because the
 * source's relative imports are extensionless: fine under `bundler` module
 * resolution, unresolvable under `node16`. A single file has no relative
 * imports left to resolve. Every bare import — a dependency — stays external.
 */
import { build } from "rolldown";
import { dts } from "rolldown-plugin-dts";

await build({
  input: "src/index.ts",
  external: (id) => !id.startsWith(".") && !id.startsWith("/"),
  plugins: [dts({ tsconfig: "tsconfig.build.json", emitDtsOnly: true })],
  output: { dir: "dist" },
});
