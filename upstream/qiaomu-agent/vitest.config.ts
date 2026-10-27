import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "**/.claude/**"] }, resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)) } } });
