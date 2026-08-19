/**
 * format() orchestration (ARCHITECTURE.md §11):
 * lex → parse → coverage → print → safety gates → outcome.
 * Any state other than VALID_SUPPORTED, or any failed gate, returns no output.
 */

import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import { analyzeCoverage } from "./coverage.js";
import { printFile } from "./printer/index.js";
import { checkTokenPreservation, structuralFingerprint } from "./safety.js";
import { HIVE_110 } from "./dialects/hive110.js";
import { DEFAULT_PROFILE, type StyleProfile } from "./profile.js";
import type { Dialect } from "./tokens.js";
import type { Diagnostic, FormatOutcome } from "./result.js";

export interface FormatOptions {
  profile?: StyleProfile;
  dialect?: Dialect;
  /** Internal: set during the idempotence re-run to prevent recursion. */
  skipIdempotenceCheck?: boolean;
}

export function formatSql(sql: string, options: FormatOptions = {}): FormatOutcome {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const dialect = options.dialect ?? HIVE_110;
  const diagnostics: Diagnostic[] = [];

  // 1. Lex. Unclosed strings/comments are provably invalid; unknown characters
  //    become `unknown` tokens and surface later as UNKNOWN, never INVALID.
  const lexed = lex(sql, dialect);
  if (lexed.errors.length > 0) {
    for (const e of lexed.errors) {
      diagnostics.push({ code: "LEX001", message: e.message, start: e.start, end: e.end });
    }
    return { state: "INVALID", diagnostics };
  }

  // 2. Parse + 3. coverage classification.
  const parsed = parse(lexed.tokens, dialect);
  const coverage = analyzeCoverage(parsed);
  diagnostics.push(...coverage.diagnostics);
  if (coverage.state !== "VALID_SUPPORTED") {
    return { state: coverage.state, diagnostics };
  }

  // 4. Print.
  let output: string;
  try {
    output = printFile(parsed.file, profile);
  } catch (err) {
    diagnostics.push({
      code: "FMT001",
      message: `No legal layout produced: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { state: "VALID_SUPPORTED", diagnostics };
  }

  // 5. Safety gates — every failure withholds output.
  const preservation = checkTokenPreservation(sql, output, profile, dialect);
  if (preservation.length > 0) {
    diagnostics.push(...preservation);
    return { state: "VALID_SUPPORTED", diagnostics };
  }

  const inFp = structuralFingerprint(sql, dialect);
  const outFp = structuralFingerprint(output, dialect);
  if (inFp === null || outFp === null || inFp !== outFp) {
    diagnostics.push({
      code: "SAFE002",
      message: "Formatted output does not re-parse to the same structure as the input.",
    });
    return { state: "VALID_SUPPORTED", diagnostics };
  }

  if (!options.skipIdempotenceCheck) {
    const second = formatSql(output, { ...options, skipIdempotenceCheck: true });
    if (second.state !== "VALID_SUPPORTED" || second.output !== output) {
      diagnostics.push({
        code: "SAFE003",
        message: "format(format(sql)) !== format(sql); refusing to write an unstable result.",
      });
      return { state: "VALID_SUPPORTED", diagnostics };
    }
  }

  return { state: "VALID_SUPPORTED", output, diagnostics };
}
