/**
 * Dogfood batch scan: recursively collects .sql files under the given paths,
 * runs formatSql (default profile) on each, and reports the coverage-state
 * breakdown plus timing. Read-only — never writes any file, never touches
 * git. Exit code is always 0 (this is a reporting tool, not a gate).
 *
 * Usage:
 *   node --experimental-strip-types packages/core/scripts/dogfood-scan.ts <dir-or-file> [...]
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join as pathJoin, relative, resolve } from "node:path";
import { register } from "node:module";

// Allow ./x.js specifiers to resolve to sibling .ts files under strip-types.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      export function resolve(specifier, context, next) {
        if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
          const url = new URL(specifier, context.parentURL);
          if (!existsSync(fileURLToPath(url))) {
            const ts = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
          }
        }
        return next(specifier, context);
      }
    `),
);

const { formatSql } = await import("../src/format.js");

const cwd = process.cwd();

function* collectSqlFiles(root: string): Generator<string> {
  const stat = statSync(root);
  if (stat.isFile()) {
    if (root.endsWith(".sql")) yield root;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = pathJoin(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* collectSqlFiles(full);
    } else if (st.isFile() && entry.endsWith(".sql")) {
      yield full;
    }
  }
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node --experimental-strip-types packages/core/scripts/dogfood-scan.ts <dir-or-file> [...]");
  process.exit(0);
}

const files: string[] = [];
for (const arg of args) {
  const abs = resolve(cwd, arg);
  if (!existsSync(abs)) {
    console.log(`CRASH\t-\t-\tpath not found: ${arg}`);
    continue;
  }
  for (const f of collectSqlFiles(abs)) files.push(f);
}

const counts: Record<string, number> = {};
const durationsMs: number[] = [];
const totalStart = performance.now();

for (const file of files) {
  const relPath = relative(cwd, file);
  const input = readFileSync(file, "utf8");
  const start = performance.now();
  try {
    const outcome = formatSql(input);
    const elapsed = performance.now() - start;
    durationsMs.push(elapsed);
    counts[outcome.state] = (counts[outcome.state] ?? 0) + 1;
    if (outcome.state !== "VALID_SUPPORTED") {
      const first = outcome.diagnostics[0];
      const code = first?.code ?? "-";
      const construct = first?.construct ?? "-";
      const message = first ? truncate(first.message, 100) : "-";
      console.log(`${outcome.state}\t${code}\t${construct}\t${message}\t${relPath}`);
    }
  } catch (err) {
    const elapsed = performance.now() - start;
    durationsMs.push(elapsed);
    counts["CRASH"] = (counts["CRASH"] ?? 0) + 1;
    const message = truncate(err instanceof Error ? err.message : String(err), 100);
    console.log(`CRASH\t-\t-\t${message}\t${relPath}`);
  }
}

const totalMs = performance.now() - totalStart;
const sorted = [...durationsMs].sort((a, b) => a - b);
const p50 = percentile(sorted, 50);
const p95 = percentile(sorted, 95);

console.log("---");
console.log(`files=${files.length} ${JSON.stringify(counts)}`);
console.log(
  `totalMs=${totalMs.toFixed(1)} p50Ms=${p50.toFixed(2)} p95Ms=${p95.toFixed(2)}`,
);
