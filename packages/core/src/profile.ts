/**
 * Style profile — the compiled, long-lived fact the formatter executes.
 * Mirrors .sqlstyle.jsonc v1 (ARCHITECTURE.md §9.2). Only semantically
 * validated options; no free-form layout DSL.
 */

export type CasePolicy = "lower" | "upper" | "preserve";

export interface StyleProfile {
  version: 1;
  dialect: "hive";
  dialectVersion: string;
  mode: "canonical";
  unsupportedBehavior: "leave-document-unchanged";

  indent: {
    style: "space";
    size: number;
  };

  lineWidth: number;

  case: {
    /** Short WHEN fits its line → keep `when cond then result` on one line. */
    shortWhen: "single-line";
    wrappedWhen: {
      /** v0.3 corpus: `when` alone on its line, conditions one level deeper. */
      layout: "when-own-line";
      logicalOperator: "leading-indented";
      then: "align-with-when";
    };
    nestedCase: "indent-one-level";
  };

  functionCall: {
    wrapStrategy: "outermost-first";
    wrappedArguments: "one-per-line";
    keepCompactNestedCalls: boolean;
    closingParenthesis: "own-line";
    keepShortComparisonSideInline: boolean;
  };

  select: {
    multipleItems: "one-per-line";
    comma: "trailing";
  };

  /**
   * Parenthesized boolean sub-chains stay on one line only when their flat
   * width is within this cap, judged independently at any nesting depth
   * (calibration Q5, user-decided 2026-08-19). Empirical: any value in
   * [52, 56] reproduces 42/42 corpus fixtures (52-char groups stay flat,
   * 57+-char groups expand); 54 is the window midpoint.
   */
  booleanGroup: {
    compactMaxWidth: number;
  };

  keywordCase: CasePolicy;
  functionCase: CasePolicy;
  dataTypeCase: CasePolicy;
  semicolon: "same-line";

  /**
   * Bounded deviation from strict canonical whitespace, applied only BETWEEN
   * statements and before own-line comments: blank-line presence is preserved
   * up to this cap. Inside a statement whitespace is fully canonical.
   */
  maxConsecutiveBlankLines: number;

  templates: {
    preserve: true;
    customPatterns: string[];
  };
}

export const DEFAULT_PROFILE: StyleProfile = {
  version: 1,
  dialect: "hive",
  dialectVersion: "1.1",
  mode: "canonical",
  unsupportedBehavior: "leave-document-unchanged",
  indent: { style: "space", size: 4 },
  // Empirical argmax over the calibration corpus (width-scan 75..80: 78 →
  // 36/42 byte-identical, the best fit; 80 → 35, 100 → far worse). The corpus
  // was clearly hand-formatted near 78-80 with some noise. CALIBRATION
  // QUESTION for the user: settle on 78, 80, or 100 + soft tolerance.
  lineWidth: 78,
  case: {
    shortWhen: "single-line",
    wrappedWhen: {
      layout: "when-own-line",
      logicalOperator: "leading-indented",
      then: "align-with-when",
    },
    nestedCase: "indent-one-level",
  },
  functionCall: {
    wrapStrategy: "outermost-first",
    wrappedArguments: "one-per-line",
    keepCompactNestedCalls: true,
    closingParenthesis: "own-line",
    keepShortComparisonSideInline: true,
  },
  select: {
    multipleItems: "one-per-line",
    comma: "trailing",
  },
  booleanGroup: { compactMaxWidth: 54 },
  keywordCase: "lower",
  functionCase: "lower",
  dataTypeCase: "lower",
  semicolon: "same-line",
  maxConsecutiveBlankLines: 2,
  templates: { preserve: true, customPatterns: [] },
};
