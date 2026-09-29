import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against core's source, not its build, so board's tests never run
    // against a stale `dist/`.
    alias: { "siren-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
