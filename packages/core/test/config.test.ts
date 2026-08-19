import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { DEFAULT_PROFILE } from "../src/profile.js";
import { findProfileFile, loadProfileForFile, parseJsonc, resolveProfile } from "../src/config.js";

// ---------------------------------------------------------------------------
// parseJsonc
// ---------------------------------------------------------------------------

describe("parseJsonc", () => {
  it("parses plain JSON unchanged", () => {
    expect(parseJsonc('{"a": 1, "b": [1, 2, 3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("strips line comments", () => {
    const text = `{
      // this is a comment
      "a": 1
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  it("strips block comments", () => {
    const text = `{
      /* block
         comment */
      "a": 1 /* inline */
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  it("strips trailing commas in objects and arrays", () => {
    const text = `{
      "a": 1,
      "b": [1, 2, 3,],
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("does not strip // or /* inside string values", () => {
    const text = `{ "a": "http://example.com", "b": "not /* a comment */ either" }`;
    expect(parseJsonc(text)).toEqual({
      a: "http://example.com",
      b: "not /* a comment */ either",
    });
  });

  it("does not strip a comma inside a string that looks trailing", () => {
    const text = `{ "a": "trailing, comma, in, string" }`;
    expect(parseJsonc(text)).toEqual({ a: "trailing, comma, in, string" });
  });

  it("handles escaped quotes inside strings without losing track of string state", () => {
    const text = `{ "a": "quote: \\" // not a comment", "b": 2 }`;
    expect(parseJsonc(text)).toEqual({ a: 'quote: " // not a comment', b: 2 });
  });

  it("throws like JSON.parse on malformed input", () => {
    expect(() => parseJsonc("{ not json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  it("returns DEFAULT_PROFILE with no diagnostics for an empty object", () => {
    const { profile, diagnostics } = resolveProfile({});
    expect(profile).toEqual(DEFAULT_PROFILE);
    expect(diagnostics).toEqual([]);
  });

  it("warns on an unknown top-level key and drops it", () => {
    const { profile, diagnostics } = resolveProfile({ notAField: true });
    expect(profile).toEqual(DEFAULT_PROFILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("CFG001");
    expect(diagnostics[0]?.message).toContain("notAField");
  });

  it("warns on an unknown nested key with a dotted path", () => {
    const { diagnostics } = resolveProfile({ case: { madeUp: true } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("case.madeUp");
  });

  it("errors and falls back to defaults on wrong version", () => {
    const { profile, diagnostics } = resolveProfile({ version: 2, lineWidth: 40 });
    expect(profile).toEqual(DEFAULT_PROFILE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("CFG001");
    expect(diagnostics[0]?.message).toMatch(/version/i);
  });

  it("merges a partial override on top of defaults, leaving the rest untouched", () => {
    const { profile, diagnostics } = resolveProfile({ version: 1, lineWidth: 120, keywordCase: "upper" });
    expect(diagnostics).toEqual([]);
    expect(profile.lineWidth).toBe(120);
    expect(profile.keywordCase).toBe("upper");
    expect(profile.functionCase).toBe(DEFAULT_PROFILE.functionCase);
    expect(profile.indent).toEqual(DEFAULT_PROFILE.indent);
  });

  it("overrides a deeply nested field like booleanGroup.compactMaxWidth", () => {
    const { profile, diagnostics } = resolveProfile({ booleanGroup: { compactMaxWidth: 72 } });
    expect(diagnostics).toEqual([]);
    expect(profile.booleanGroup).toEqual({ compactMaxWidth: 72 });
    expect(profile.lineWidth).toBe(DEFAULT_PROFILE.lineWidth);
  });

  it("warns and keeps the default when a value's type is wrong", () => {
    const { profile, diagnostics } = resolveProfile({ lineWidth: "wide" });
    expect(profile.lineWidth).toBe(DEFAULT_PROFILE.lineWidth);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("CFG001");
    expect(diagnostics[0]?.message).toContain("lineWidth");
  });

  it("warns and keeps the default when a nested value's type is wrong", () => {
    const { profile, diagnostics } = resolveProfile({ indent: { size: "four" } });
    expect(profile.indent).toEqual(DEFAULT_PROFILE.indent);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("indent.size");
  });

  it("warns and keeps the default for an out-of-enum value", () => {
    const { profile, diagnostics } = resolveProfile({ keywordCase: "shout" });
    expect(profile.keywordCase).toBe(DEFAULT_PROFILE.keywordCase);
    expect(diagnostics).toHaveLength(1);
  });

  it("rejects a non-object root and falls back to defaults", () => {
    const { profile, diagnostics } = resolveProfile("not an object");
    expect(profile).toEqual(DEFAULT_PROFILE);
    expect(diagnostics).toHaveLength(1);
  });

  it("never throws even on wildly malformed input", () => {
    expect(() => resolveProfile(null)).not.toThrow();
    expect(() => resolveProfile(42)).not.toThrow();
    expect(() => resolveProfile([1, 2, 3])).not.toThrow();
    expect(() => resolveProfile(undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// findProfileFile / loadProfileForFile
// ---------------------------------------------------------------------------

describe("findProfileFile / loadProfileForFile", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function makeTree() {
    root = mkdtempSync(join(tmpdir(), "sqlstyle-config-test-"));
    // root/
    //   .sqlstyle.jsonc          <- workspace-level config
    //   pkgA/
    //     sub/                    <- no config here; should find pkgA's
    //       query.sql
    //     .sqlstyle.jsonc
    //   pkgB/
    //     query.sql                <- no config anywhere until root
    const pkgA = join(root, "pkgA");
    const pkgASub = join(pkgA, "sub");
    const pkgB = join(root, "pkgB");
    mkdirSync(pkgASub, { recursive: true });
    mkdirSync(pkgB, { recursive: true });

    writeFileSync(join(root, ".sqlstyle.jsonc"), JSON.stringify({ version: 1, lineWidth: 999 }));
    writeFileSync(join(pkgA, ".sqlstyle.jsonc"), JSON.stringify({ version: 1, lineWidth: 77 }));
    writeFileSync(join(pkgASub, "query.sql"), "select 1;");
    writeFileSync(join(pkgB, "query.sql"), "select 1;");

    return { root, pkgA, pkgASub, pkgB };
  }

  it("finds the nearest parent .sqlstyle.jsonc, walking up past directories without one", () => {
    const { pkgASub, pkgA } = makeTree();
    const found = findProfileFile(pkgASub);
    expect(found).toBe(join(pkgA, ".sqlstyle.jsonc"));
  });

  it("falls further up to the workspace root config when no closer one exists", () => {
    const { pkgB, root: r } = makeTree();
    const found = findProfileFile(pkgB);
    expect(found).toBe(join(r, ".sqlstyle.jsonc"));
  });

  it("returns null when nothing is found before the filesystem root / stopDir", () => {
    const { pkgB } = makeTree();
    const found = findProfileFile(pkgB, pkgB);
    expect(found).toBeNull();
  });

  it("respects stopDir as an inclusive upper bound", () => {
    const { root: r, pkgB } = makeTree();
    // stopDir is root itself, which does have a config -> still found.
    const found = findProfileFile(pkgB, r);
    expect(found).toBe(join(r, ".sqlstyle.jsonc"));
  });

  it("loadProfileForFile resolves the nearest config's profile for a given SQL file", () => {
    const { pkgASub, pkgA } = makeTree();
    const sqlFile = join(pkgASub, "query.sql");
    const result = loadProfileForFile(sqlFile);
    expect(result.sourcePath).toBe(join(pkgA, ".sqlstyle.jsonc"));
    expect(result.profile.lineWidth).toBe(77);
    expect(result.diagnostics).toEqual([]);
  });

  it("loadProfileForFile returns DEFAULT_PROFILE with null sourcePath when nothing is found", () => {
    const { pkgB } = makeTree();
    const sqlFile = join(pkgB, "query.sql");
    const result = loadProfileForFile(sqlFile, pkgB);
    expect(result.sourcePath).toBeNull();
    expect(result.profile).toEqual(DEFAULT_PROFILE);
    expect(result.diagnostics).toEqual([]);
  });

  it("loadProfileForFile falls back to defaults with a CFG001 diagnostic on malformed config", () => {
    const { pkgB, root: r } = makeTree();
    writeFileSync(join(r, ".sqlstyle.jsonc"), "{ not valid json");
    const sqlFile = join(pkgB, "query.sql");
    const result = loadProfileForFile(sqlFile);
    expect(result.profile).toEqual(DEFAULT_PROFILE);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("CFG001");
  });
});
