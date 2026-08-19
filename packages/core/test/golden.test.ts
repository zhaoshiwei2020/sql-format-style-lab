/**
 * Golden test harness (ARCHITECTURE.md §18.1).
 *
 * Fixtures live at <repo root>/fixtures/golden/**, one directory per
 * scenario containing at least `input.sql` and `expected.sql`. Fixtures are
 * authored concurrently with this harness, so directories are discovered at
 * collection time via fs globbing rather than hardcoded.
 *
 * For every fixture:
 *   1. formatSql(input) is VALID_SUPPORTED and its output === expected.
 *   2. formatSql(expected).output === expected (idempotence from pretty input).
 *   3. checkTokenPreservation(input, expected, ...) === [] (the fixture itself
 *      must be a legal rewrite of the input, not just something the printer
 *      happens to currently produce).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatSql } from "../src/format.js";
import { checkTokenPreservation } from "../src/safety.js";
import { DEFAULT_PROFILE } from "../src/profile.js";
import { HIVE_110 } from "../src/dialects/hive110.js";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = resolve(here, "../../../fixtures/golden");

/** Recursively finds directories under `root` containing input.sql + expected.sql. */
function findGoldenDirs(root: string): string[] {
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

const goldenDirs = findGoldenDirs(GOLDEN_ROOT);

describe("golden fixtures", () => {
  if (goldenDirs.length === 0) {
    it.skip("no golden fixtures found yet under fixtures/golden/", () => {
      // Placeholder so this file always contributes at least one test case.
    });
  } else {
    const cases = goldenDirs.map((dir) => ({ dir, name: relative(GOLDEN_ROOT, dir) }));

    it.each(cases)("$name formats to the golden output", ({ dir }) => {
      const input = readFileSync(join(dir, "input.sql"), "utf8");
      const expected = readFileSync(join(dir, "expected.sql"), "utf8");

      const outcome = formatSql(input, { profile: DEFAULT_PROFILE, dialect: HIVE_110 });
      expect(outcome.state).toBe("VALID_SUPPORTED");
      expect(outcome.output).toBe(expected);

      const idempotent = formatSql(expected, { profile: DEFAULT_PROFILE, dialect: HIVE_110 });
      expect(idempotent.state).toBe("VALID_SUPPORTED");
      expect(idempotent.output).toBe(expected);

      const preservation = checkTokenPreservation(input, expected, DEFAULT_PROFILE, HIVE_110);
      expect(preservation).toEqual([]);
    });
  }
});
