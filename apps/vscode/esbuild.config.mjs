// Bundles src/extension.ts -> dist/extension.cjs for the VS Code extension
// host. Plain JS (not TS) so it can run directly under `node` without a
// separate compile step.
//
// Two things need help beyond esbuild's defaults:
//
// 1. `@sqlstyle/core`'s package.json exports ".": "./src/index.ts" (no build
//    step for that package either). esbuild's package resolution generally
//    follows that "exports" target fine, but we pin it with an explicit
//    alias so this build never depends on how `npm install` happened to lay
//    out node_modules for the workspace.
// 2. Inside packages/core/src, relative imports are written the TypeScript
//    "bundler"-moduleResolution way: `./lexer.js` resolving to sibling
//    `./lexer.ts` (see packages/core/scripts/dev-format.ts for the same gap
//    bridged for plain Node). esbuild does not do that remap by default, so
//    a small onResolve plugin does it here.
import * as esbuild from "esbuild";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").Plugin} */
const jsToTsSiblingPlugin = {
  name: "js-to-ts-sibling",
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return undefined;
      const asJs = path.resolve(args.resolveDir, args.path);
      if (existsSync(asJs)) return undefined; // real .js file — let esbuild handle it
      const asTs = asJs.replace(/\.js$/, ".ts");
      if (existsSync(asTs)) return { path: asTs };
      return undefined;
    });
  },
};

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
  alias: {
    "@sqlstyle/core": path.join(here, "../../packages/core/src/index.ts"),
  },
  plugins: [jsToTsSiblingPlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[sql-style-calibrator] watching for changes...");
} else {
  await esbuild.build(options);
  console.log("[sql-style-calibrator] build complete: dist/extension.cjs");
}
