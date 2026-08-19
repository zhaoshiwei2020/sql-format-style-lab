/**
 * Coverage-honesty regression test (ARCHITECTURE.md §4.7, §18.3).
 *
 * Every fixture under <repo root>/fixtures/unsupported/*.sql is syntax the
 * printer must never rewrite: either it's syntax the parser recognizes but
 * doesn't print yet (VALID_UNSUPPORTED) or syntax the parser can't classify
 * (UNKNOWN). It must never come back as VALID_SUPPORTED (would mean an
 * unsafe rewrite) and never as INVALID (would mean a coverage gap is being
 * misreported as a syntax error).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatSql } from "../src/format.js";

const here = dirname(fileURLToPath(import.meta.url));
const UNSUPPORTED_ROOT = resolve(here, "../../../fixtures/unsupported");

function findUnsupportedFixtures(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => join(root, e.name))
    .sort();
}

const files = findUnsupportedFixtures(UNSUPPORTED_ROOT);

describe("unsupported fixtures never get rewritten", () => {
  if (files.length === 0) {
    it.skip("no unsupported fixtures found yet under fixtures/unsupported/", () => {
      // Placeholder so this file always contributes at least one test case.
    });
  } else {
    const cases = files.map((file) => ({ file, name: basename(file) }));

    it.each(cases)("$name is never formatted", ({ file }) => {
      const input = readFileSync(file, "utf8");
      const outcome = formatSql(input);

      expect(outcome.output).toBeUndefined();
      expect(outcome.state).not.toBe("VALID_SUPPORTED");
      expect(outcome.state).not.toBe("INVALID");
      expect(["VALID_UNSUPPORTED", "UNKNOWN"]).toContain(outcome.state);
      expect(outcome.diagnostics.length).toBeGreaterThan(0);
    });
  }
});
