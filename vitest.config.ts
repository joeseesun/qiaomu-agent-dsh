import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { include: ["tests/**/*.test.{ts,tsx}"] },
  resolve: { alias: { obsidian: fileURLToPath(new URL("./src/client/obsidian.ts", import.meta.url)) } },
});
