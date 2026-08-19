/**
 * Four-state outcome model (ARCHITECTURE.md §4.7) and stable error codes (§19).
 */

export type CoverageState =
  | "VALID_SUPPORTED"
  | "VALID_UNSUPPORTED"
  | "INVALID"
  | "UNKNOWN";

export type ErrorCode =
  | "CFG001"
  | "CFG002"
  | "LEX001"
  | "PAR001" // provably invalid syntax
  | "PAR002" // valid but printer not covering (VALID_UNSUPPORTED)
  | "PAR003" // parser cannot decide (UNKNOWN)
  | "FMT001"
  | "SAFE001" // token preservation failed
  | "SAFE002" // output re-parse failed
  | "SAFE003" // idempotence failed
  | "CAL001";

export interface Diagnostic {
  code: ErrorCode;
  message: string;
  start?: number;
  end?: number;
  /** e.g. "merge", "pivot" — which construct blocked formatting */
  construct?: string;
}

export interface FormatOutcome {
  state: CoverageState;
  /**
   * Full canonical text. Present only when state === "VALID_SUPPORTED" and
   * every safety gate passed; otherwise the document must not be modified.
   */
  output?: string;
  diagnostics: Diagnostic[];
}
