import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["src/client/original-components.ts"],
  outdir: "lib/components", bundle: true, splitting: true, format: "esm", platform: "browser",
  target: "es2022", jsx: "automatic", minify: true, metafile: false,
  alias: { obsidian: path.join(root, "src/client/obsidian.ts") },
  inject: [path.join(root, "src/client/original-globals.ts")],
  external: ["react", "react-dom", "react/jsx-runtime"],
  logLevel: "warning",
});
console.log("Original Agent components built; this is not an installable Harness plugin yet.");
