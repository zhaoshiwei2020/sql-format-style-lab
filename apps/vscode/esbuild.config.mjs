// Bundles src/extension.ts -> dist/extension.cjs for the VS Code extension
// host. Plain JS (not TS) so it can run directly under `node` without a
// separate compile step. sql-formatter is bundled in (node_modules stays
// out of the vsix).
import * as esbuild from "esbuild";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: [path.join(here, "src/extension.ts")],
  outfile: path.join(here, "dist/extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[sql-formatter-hive] watching for changes...");
} else {
  await esbuild.build(options);
  console.log("[sql-formatter-hive] build complete: dist/extension.cjs");
}
