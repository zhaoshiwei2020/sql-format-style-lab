/**
 * Ad-hoc dev harness: format a single file and print state + diagnostics.
 *
 * Usage:
 *   node --experimental-strip-types packages/core/scripts/dev-format.ts <file.sql>
 *
 * The rest of this package writes relative imports the TypeScript "bundler"
 * way (`./lexer.js` resolving to sibling `lexer.ts`), which `tsc` and
 * Vitest (via esbuild) both resolve for free. Node's native
 * --experimental-strip-types deliberately does NOT remap `.js` specifiers to
 * sibling `.ts` files (see https://github.com/nodejs/loaders/issues/214), so
 * running this file directly under `node` needs a small resolve hook to
 * bridge that gap — otherwise loading ../src/format.js fails as soon as it
 * tries to import its own ./lexer.js sibling. The hook is process-local, is
 * registered before the deterministic core is ever imported, and only
 * changes resolution for relative *.js specifiers that don't otherwise
 * exist on disk (so it's a no-op once/if this package ships compiled .js).
 */

import { register } from "node:module";

const jsToTsFallback = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err && err.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(specifier.slice(0, -3) + ".ts", context);
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(jsToTsFallback)}`, import.meta.url);

// Imported dynamically, after the hook above is registered, so its own
// relative ./lexer.js-style imports resolve too.
const { formatSql } = await import("../src/format.js");
const { readFileSync } = await import("node:fs");

const file = process.argv[2];
if (!file) {
  console.error("usage: dev-format.ts <file.sql>");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const outcome = formatSql(sql);

console.log(`state: ${outcome.state}`);

if (outcome.diagnostics.length === 0) {
  console.log("diagnostics: (none)");
} else {
  console.log("diagnostics:");
  for (const d of outcome.diagnostics) {
    const pos =
      d.start !== undefined ? ` @${d.start}${d.end !== undefined ? `-${d.end}` : ""}` : "";
    const construct = d.construct ? ` [${d.construct}]` : "";
    console.log(`  ${d.code}${pos}${construct}: ${d.message}`);
  }
}

console.log("");
console.log(outcome.output ?? "(no output)");
