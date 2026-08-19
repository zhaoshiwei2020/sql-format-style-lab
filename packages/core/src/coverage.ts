/**
 * CoverageAnalyzer — decides the four-state outcome for a parsed file.
 * Kept separate from the parser so "can parse" is never conflated with
 * "safe to format" (ARCHITECTURE.md §6.3, §7.2).
 */

import type { ParseResult, StatementNode } from "./cst.js";
import type { CoverageState, Diagnostic } from "./result.js";

interface CoverageReport {
  state: CoverageState;
  diagnostics: Diagnostic[];
}

/** Generic deep walk that finds unsupported constructs anywhere in a node. */
function findUnsupported(node: unknown, out: { construct: string; start?: number; end?: number }[]): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) findUnsupported(item, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec["kind"] === "unsupportedExpr" || rec["kind"] === "unsupportedStatement") {
    const tokens = rec["tokens"] as { start: number; end: number }[] | undefined;
    out.push({
      construct: String(rec["construct"] ?? "unknown-construct"),
      start: tokens?.[0]?.start,
      end: tokens?.[tokens.length - 1]?.end,
    });
    return; // no need to descend further
  }
  for (const key of Object.keys(rec)) {
    if (key === "tokens" || key === "leadingComments") continue;
    findUnsupported(rec[key], out);
  }
}

export function analyzeCoverage(parsed: ParseResult): CoverageReport {
  const diagnostics: Diagnostic[] = [];
  let hasInvalid = false;
  let hasUnknown = false;
  let hasUnsupported = false;

  for (const d of parsed.diagnostics) {
    if (d.code === "PAR001") hasInvalid = true;
    diagnostics.push({ code: d.code, message: d.message, start: d.start, end: d.end });
  }

  for (const stmt of parsed.file.statements) {
    if ((stmt as StatementNode).kind === "unknownStatement") {
      hasUnknown = true;
      const s = stmt as Extract<StatementNode, { kind: "unknownStatement" }>;
      diagnostics.push({
        code: "PAR003",
        message: `Cannot decide whether this statement is valid Hive SQL: ${s.reason}`,
        start: s.tokens[0]?.start,
        end: s.tokens[s.tokens.length - 1]?.end,
      });
      continue;
    }
    const found: { construct: string; start?: number; end?: number }[] = [];
    findUnsupported(stmt, found);
    for (const f of found) {
      hasUnsupported = true;
      diagnostics.push({
        code: "PAR002",
        message: `Syntax is valid but the printer does not cover it yet: ${f.construct}`,
        construct: f.construct,
        start: f.start,
        end: f.end,
      });
    }
  }

  const state: CoverageState = hasInvalid
    ? "INVALID"
    : hasUnknown
      ? "UNKNOWN"
      : hasUnsupported
        ? "VALID_UNSUPPORTED"
        : "VALID_SUPPORTED";
  return { state, diagnostics };
}
