/**
 * Coverage report for fixtures that aren't promoted to fixtures/golden/ yet.
 *
 * Runs formatSql over every fixtures/golden-pending/**\/input.sql, compares
 * to the sibling expected.sql, and prints a summary table. Never fails the
 * process — this is a progress report, not a gate — so exit code is always 0.
 *
 * Usage:
 *   node --experimental-strip-types packages/core/scripts/coverage-report.ts
 *
 * See dev-format.ts for why the resolve hook below exists: Node's native
 * --experimental-strip-types does not remap relative `./x.js` specifiers to
 * sibling `x.ts` files, but the rest of this package's src/ writes imports
 * that way (https://github.com/nodejs/loaders/issues/214).
 */

import { register } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const { formatSql } = await import("../src/format.js");

const here = dirname(fileURLToPath(import.meta.url));
const PENDING_ROOT = resolve(here, "../../../fixtures/golden-pending");

function findFixtureDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const hasInput = entries.some((e) => e.isFile() && e.name === "input.sql");
    const hasExpected = entries.some((e) => e.isFile() && e.name === "expected.sql");
    if (hasInput && hasExpected) found.push(dir);
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name));
    }
  };

  walk(root);
  return found.sort();
}

interface Row {
  fixture: string;
  state: string;
  outcome: "match" | "mismatch" | "error";
}

const dirs = findFixtureDirs(PENDING_ROOT);
const rows: Row[] = [];

for (const dir of dirs) {
  const fixture = relative(PENDING_ROOT, dir);
  try {
    const input = readFileSync(join(dir, "input.sql"), "utf8");
    const expected = readFileSync(join(dir, "expected.sql"), "utf8");
    const result = formatSql(input);
    const outcome: Row["outcome"] =
      result.state === "VALID_SUPPORTED" && result.output === expected ? "match" : "mismatch";
    rows.push({ fixture, state: result.state, outcome });
  } catch (err) {
    rows.push({
      fixture,
      state: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      outcome: "error",
    });
  }
}

const fixtureWidth = Math.max(7, ...rows.map((r) => r.fixture.length));
const stateWidth = Math.max(5, ...rows.map((r) => r.state.length));

if (rows.length === 0) {
  console.log("no pending fixtures found under fixtures/golden-pending/");
} else {
  console.log(`${"fixture".padEnd(fixtureWidth)}  ${"state".padEnd(stateWidth)}  outcome`);
  for (const row of rows) {
    console.log(`${row.fixture.padEnd(fixtureWidth)}  ${row.state.padEnd(stateWidth)}  ${row.outcome}`);
  }
}

const passing = rows.filter((r) => r.outcome === "match").length;
console.log("");
console.log(`pending: ${passing}/${rows.length} passing`);

process.exit(0);
