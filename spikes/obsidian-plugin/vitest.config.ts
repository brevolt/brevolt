import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // The real `obsidian` package ships only types; tests use a fetch-based shim.
    alias: { obsidian: fileURLToPath(new URL("./test/obsidian-shim.ts", import.meta.url)) },
  },
  test: { include: ["test/**/*.test.ts"] },
});
