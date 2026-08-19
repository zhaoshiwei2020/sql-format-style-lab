/**
 * Divergence report: formats every golden + golden-pending fixture input and
 * diffs the result against the hand-formatted expected output. Divergences
 * are calibration questions, not necessarily bugs (the corpus is known to be
 * internally inconsistent in places — see ARCHITECTURE.md §26.4).
 *
 * Usage: node --experimental-strip-types packages/core/scripts/divergence-report.ts
 * Writes docs/divergence-report.md
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join as pathJoin, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

function* fixtureDirs(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const full = pathJoin(root, entry);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(pathJoin(full, "input.sql")) && existsSync(pathJoin(full, "expected.sql"))) {
      yield full;
    } else {
      yield* fixtureDirs(full);
    }
  }
}

function firstDiffBlock(actual: string, expected: string, context = 3): string {
  const a = actual.split("\n");
  const e = expected.split("\n");
  let i = 0;
  while (i < a.length && i < e.length && a[i] === e[i]) i++;
  if (i === a.length && i === e.length) return "";
  const start = Math.max(0, i - context);
  const end = Math.min(Math.max(a.length, e.length), i + 8);
  const lines: string[] = [];
  lines.push("```diff");
  for (let k = start; k < end; k++) {
    const al = a[k];
    const el = e[k];
    if (al === el) {
      if (al !== undefined) lines.push("  " + al);
    } else {
      if (el !== undefined) lines.push("- " + el);
      if (al !== undefined) lines.push("+ " + al);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

const sections: string[] = [];
let pass = 0;
let diverge = 0;
let failed = 0;

for (const root of ["fixtures/golden", "fixtures/golden-pending"]) {
  for (const dir of fixtureDirs(pathJoin(repoRoot, root))) {
    const rel = dir.slice(repoRoot.length + 1);
    const input = readFileSync(pathJoin(dir, "input.sql"), "utf8");
    const expected = readFileSync(pathJoin(dir, "expected.sql"), "utf8");
    let outcome;
    try {
      outcome = formatSql(input);
    } catch (err) {
      failed++;
      sections.push(`## ${rel}\n\nFORMAT CRASHED: ${err instanceof Error ? err.message : String(err)}\n`);
      continue;
    }
    if (outcome.state !== "VALID_SUPPORTED" || outcome.output === undefined) {
      failed++;
      const diag = outcome.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ");
      sections.push(`## ${rel}\n\nNO OUTPUT — state ${outcome.state}. ${diag}\n`);
      continue;
    }
    if (outcome.output === expected) {
      pass++;
      continue;
    }
    diverge++;
    sections.push(`## ${rel}\n\n(-) 人工语料 | (+) formatter 输出\n\n${firstDiffBlock(outcome.output, expected)}\n`);
  }
}

const report = [
  "# Formatter vs 人工语料分歧报告",
  "",
  `生成时间基准：本地运行 | 逐字一致 ${pass} | 有分歧 ${diverge} | 无输出/崩溃 ${failed}`,
  "",
  "分歧不一定是 bug：语料本身存在内部不一致（见 ARCHITECTURE.md §26.4）。每一处分歧都是一道校准 A/B 题。",
  "",
  ...sections,
].join("\n");

writeFileSync(pathJoin(repoRoot, "docs/divergence-report.md"), report);
console.log(`pass=${pass} diverge=${diverge} failed=${failed} → docs/divergence-report.md`);
