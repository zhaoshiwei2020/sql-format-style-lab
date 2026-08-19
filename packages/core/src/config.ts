/**
 * Config loading (ARCHITECTURE.md §9, §11): parse `.sqlstyle.jsonc`, deep-merge
 * over DEFAULT_PROFILE, produce diagnostics for unknown/invalid keys, and
 * locate the nearest `.sqlstyle.jsonc` for a given SQL file.
 *
 * `packages/core/tsconfig.json` compiles only `src/` and does not pull in
 * `@types/node` (none is installed in this workspace — see
 * `packages/core/types/node-shim.d.ts`, which is out of scope for that
 * program). This file is the first `src` module to touch `node:fs`, so it
 * declares the small ambient surface it needs itself; the signatures are kept
 * identical to `node-shim.d.ts` so the two declarations merge without
 * conflict under `tsconfig.test.json`, and match real `@types/node`'s shape
 * closely enough (named function exports) to merge cleanly there too — e.g.
 * when `apps/vscode` (which does depend on `@types/node`) imports this file
 * directly by path. `node:path` deliberately is NOT used here for the same
 * reason: `@types/node`'s "node:path" typing is an `export =` (no named
 * value exports), which cannot be augmented at all — any ambient shim for it
 * here would conflict the moment a consumer with real `@types/node` pulls
 * this file in. `dirname`/`join` are reimplemented locally instead (only the
 * few semantics this module needs: POSIX and Windows-style absolute paths,
 * always operating on already-absolute input).
 */

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
}

import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_PROFILE, type StyleProfile } from "./profile.js";
import type { Diagnostic } from "./result.js";

// ---------------------------------------------------------------------------
// Minimal path helpers (POSIX + Windows), avoiding node:path — see file
// header for why. Callers are expected to pass already-absolute paths.
// ---------------------------------------------------------------------------

function pathSeparatorFor(p: string): "/" | "\\" {
  return p.includes("\\") && !p.includes("/") ? "\\" : "/";
}

function joinPath(...parts: string[]): string {
  const nonEmpty = parts.filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return ".";
  const sep = pathSeparatorFor(nonEmpty[0] as string);
  const pieces = nonEmpty
    .map((p, i) => {
      const withoutLeading = i === 0 ? p : p.replace(/^[\\/]+/, "");
      return withoutLeading.replace(/[\\/]+$/, "");
    })
    .filter((p) => p.length > 0);
  return pieces.length > 0 ? pieces.join(sep) : sep;
}

function dirnamePath(p: string): string {
  const sep = pathSeparatorFor(p);
  let trimmed = p;
  while (trimmed.length > 1 && (trimmed.endsWith("/") || trimmed.endsWith("\\"))) {
    trimmed = trimmed.slice(0, -1);
  }
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}${sep}`; // already a Windows drive root
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSep < 0) return ".";
  if (lastSep === 0) return sep; // POSIX root "/"
  const head = trimmed.slice(0, lastSep);
  return /^[A-Za-z]:$/.test(head) ? `${head}${sep}` : head; // Windows drive root "C:\"
}

/** Strips one trailing separator, so e.g. "/a/b/" and "/a/b" compare equal. */
function normalizeDir(p: string): string {
  if (p.length > 1 && (p.endsWith("/") || p.endsWith("\\")) && !/^[A-Za-z]:[\\/]$/.test(p)) {
    return p.slice(0, -1);
  }
  return p;
}

const PROFILE_FILE_NAME = ".sqlstyle.jsonc";

// ---------------------------------------------------------------------------
// parseJsonc
// ---------------------------------------------------------------------------

/**
 * Minimal JSONC support: strips `//` and `/* *\/` comments (never inside
 * string literals) and trailing commas, then delegates to `JSON.parse`.
 * No dependencies. Throws like `JSON.parse` on malformed input — callers
 * that need a never-throw contract (e.g. `loadProfileForFile`) must catch.
 */
export function parseJsonc(text: string): unknown {
  const withoutComments = stripJsonComments(text);
  const withoutTrailingCommas = stripTrailingCommas(withoutComments);
  return JSON.parse(withoutTrailingCommas);
}

function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < n) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      out += " ";
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      out += " ";
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2; // consume closing */
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function stripTrailingCommas(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < n) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < n && isJsonWhitespace(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") {
        i++; // drop the trailing comma
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function isJsonWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

type Primitive = "string" | "number" | "boolean";

interface ObjectSpec {
  kind: "object";
  children: Record<string, Spec>;
}

interface LeafSpec {
  kind: "leaf";
  type: Primitive;
  /** When set, the value must also be one of these (in addition to matching `type`). */
  allowed?: readonly (string | number | boolean)[];
}

interface StringArraySpec {
  kind: "stringArray";
}

type Spec = ObjectSpec | LeafSpec | StringArraySpec;

function leaf(type: Primitive, allowed?: readonly (string | number | boolean)[]): LeafSpec {
  return allowed ? { kind: "leaf", type, allowed } : { kind: "leaf", type };
}

/** Mirrors StyleProfile (packages/core/src/profile.ts) exactly. */
const PROFILE_SPEC: ObjectSpec = {
  kind: "object",
  children: {
    version: leaf("number", [1]),
    dialect: leaf("string", ["hive"]),
    dialectVersion: leaf("string"),
    mode: leaf("string", ["canonical"]),
    unsupportedBehavior: leaf("string", ["leave-document-unchanged"]),
    indent: {
      kind: "object",
      children: {
        style: leaf("string", ["space"]),
        size: leaf("number"),
      },
    },
    lineWidth: leaf("number"),
    case: {
      kind: "object",
      children: {
        shortWhen: leaf("string", ["single-line"]),
        wrappedWhen: {
          kind: "object",
          children: {
            layout: leaf("string", ["when-own-line"]),
            logicalOperator: leaf("string", ["leading-indented"]),
            then: leaf("string", ["align-with-when"]),
          },
        },
        nestedCase: leaf("string", ["indent-one-level"]),
      },
    },
    functionCall: {
      kind: "object",
      children: {
        wrapStrategy: leaf("string", ["outermost-first"]),
        wrappedArguments: leaf("string", ["one-per-line"]),
        keepCompactNestedCalls: leaf("boolean"),
        closingParenthesis: leaf("string", ["own-line"]),
        keepShortComparisonSideInline: leaf("boolean"),
      },
    },
    select: {
      kind: "object",
      children: {
        multipleItems: leaf("string", ["one-per-line"]),
        comma: leaf("string", ["trailing"]),
      },
    },
    booleanGroup: {
      kind: "object",
      children: {
        compactMaxWidth: leaf("number"),
      },
    },
    keywordCase: leaf("string", ["lower", "upper", "preserve"]),
    functionCase: leaf("string", ["lower", "upper", "preserve"]),
    dataTypeCase: leaf("string", ["lower", "upper", "preserve"]),
    semicolon: leaf("string", ["same-line"]),
    maxConsecutiveBlankLines: leaf("number"),
    templates: {
      kind: "object",
      children: {
        preserve: leaf("boolean", [true]),
        customPatterns: { kind: "stringArray" },
      },
    },
  },
};

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function warn(path: string, message: string): Diagnostic {
  return { code: "CFG001", message: `Config key "${path}": ${message}` };
}

function warnUnknownKey(path: string): Diagnostic {
  return { code: "CFG001", message: `Unknown config key: "${path}"` };
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function mergeValue(
  spec: Spec,
  defaultValue: unknown,
  rawValue: unknown,
  path: string,
  diagnostics: Diagnostic[],
): unknown {
  if (rawValue === undefined) return defaultValue;

  if (spec.kind === "object") {
    if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
      diagnostics.push(warn(path, `expected an object, got ${describeType(rawValue)}; keeping default.`));
      return defaultValue;
    }
    const rawObj = rawValue as Record<string, unknown>;
    const defaultObj = defaultValue as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(spec.children)) {
      result[key] = mergeValue(
        spec.children[key] as Spec,
        defaultObj[key],
        rawObj[key],
        childPath(path, key),
        diagnostics,
      );
    }
    for (const key of Object.keys(rawObj)) {
      if (!(key in spec.children)) {
        diagnostics.push(warnUnknownKey(childPath(path, key)));
      }
    }
    return result;
  }

  if (spec.kind === "stringArray") {
    if (!Array.isArray(rawValue) || !rawValue.every((item) => typeof item === "string")) {
      diagnostics.push(
        warn(path, `expected an array of strings, got ${describeType(rawValue)}; keeping default.`),
      );
      return defaultValue;
    }
    return rawValue.slice();
  }

  // Leaf.
  if (typeof rawValue !== spec.type) {
    diagnostics.push(warn(path, `expected ${spec.type}, got ${describeType(rawValue)}; keeping default.`));
    return defaultValue;
  }
  if (spec.allowed && !spec.allowed.includes(rawValue as string | number | boolean)) {
    diagnostics.push(warn(path, `unsupported value ${JSON.stringify(rawValue)}; keeping default.`));
    return defaultValue;
  }
  return rawValue;
}

/**
 * Deep-merges `raw` (a parsed but unvalidated JSON value, typically from
 * `parseJsonc`) over `DEFAULT_PROFILE`. Unknown keys (top-level or nested)
 * produce a CFG001 warning listing the key path and are dropped. A `version`
 * other than `1` produces a CFG001 error and the entire result falls back to
 * `DEFAULT_PROFILE`. Any other type-mismatched value produces a CFG001
 * warning and keeps the default for that key only. Never throws.
 */
export function resolveProfile(raw: unknown): { profile: StyleProfile; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined) {
      diagnostics.push({
        code: "CFG001",
        message: `Config root must be an object, got ${describeType(raw)}; using defaults.`,
      });
    }
    return { profile: DEFAULT_PROFILE, diagnostics };
  }

  const rawObj = raw as Record<string, unknown>;

  if ("version" in rawObj && rawObj.version !== 1) {
    diagnostics.push({
      code: "CFG001",
      message: `Unsupported config version ${JSON.stringify(rawObj.version)}; expected 1. Falling back to defaults.`,
    });
    return { profile: DEFAULT_PROFILE, diagnostics };
  }

  const profile = mergeValue(PROFILE_SPEC, DEFAULT_PROFILE, rawObj, "", diagnostics) as StyleProfile;
  return { profile, diagnostics };
}

// ---------------------------------------------------------------------------
// findProfileFile / loadProfileForFile
// ---------------------------------------------------------------------------

/**
 * Walks up from `startDir` (inclusive) toward `stopDir` (inclusive, when
 * given) or the filesystem root, looking for `.sqlstyle.jsonc`. Returns the
 * first match's absolute path, or null.
 */
export function findProfileFile(startDir: string, stopDir?: string): string | null {
  let dir = normalizeDir(startDir);
  const stop = stopDir !== undefined ? normalizeDir(stopDir) : undefined;

  for (;;) {
    const candidate = joinPath(dir, PROFILE_FILE_NAME);
    if (existsSync(candidate)) return candidate;

    if (stop !== undefined && dir === stop) return null;

    const parent = dirnamePath(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Combines `findProfileFile` + read + `parseJsonc` + `resolveProfile` for a
 * single SQL file. `workspaceRoot`, when given, bounds the upward search
 * (ARCHITECTURE.md §9.1: nearest parent `.sqlstyle.jsonc` wins over the
 * workspace root). Never throws: unreadable or malformed config files fall
 * back to `DEFAULT_PROFILE` with a CFG001 diagnostic.
 */
export function loadProfileForFile(
  sqlFilePath: string,
  workspaceRoot?: string,
): { profile: StyleProfile; diagnostics: Diagnostic[]; sourcePath: string | null } {
  const startDir = dirnamePath(sqlFilePath);
  const sourcePath = findProfileFile(startDir, workspaceRoot);

  if (sourcePath === null) {
    return { profile: DEFAULT_PROFILE, diagnostics: [], sourcePath: null };
  }

  let raw: unknown;
  try {
    const text = readFileSync(sourcePath, "utf8");
    raw = parseJsonc(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      profile: DEFAULT_PROFILE,
      diagnostics: [{ code: "CFG001", message: `Failed to read/parse ${sourcePath}: ${message}` }],
      sourcePath,
    };
  }

  const { profile, diagnostics } = resolveProfile(raw);
  return { profile, diagnostics, sourcePath };
}
