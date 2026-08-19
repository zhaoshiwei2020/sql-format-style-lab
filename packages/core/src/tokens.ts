/**
 * Lossless token model. Every character of the input is accounted for either
 * by a token's text or by trivia recorded on adjacent tokens, so that the
 * original document can be reconstructed and the safety gate can compare
 * non-whitespace token sequences byte-for-byte.
 */

export type TokenKind =
  | "keyword" // reserved word or contextual keyword recognized by the dialect
  | "identifier"
  | "quotedIdentifier" // `select` style backtick identifiers
  | "number" // includes Spark typed suffixes: 10L, 12.50BD
  | "string" // includes escapes, verbatim
  | "operator" // + - * / % = <> != <= >= < > || -> <=> etc.
  | "comma"
  | "dot"
  | "semicolon"
  | "lparen"
  | "rparen"
  | "template" // ${hiveconf:x} ${var} #{x} {{ x }} {% ... %} — atomic, verbatim
  | "unknown" // anything the lexer cannot classify; forces UNKNOWN state
  | "eof";

export interface Comment {
  kind: "line" | "block" | "hint"; // hint = /*+ ... */
  /** Verbatim text including delimiters (line: `-- x`; block: slash-star x star-slash). Never modified. */
  text: string;
  start: number;
  end: number;
  /** True if the comment starts a line in the source (nothing but whitespace before it on its line). */
  ownLine: boolean;
  /** True if at least one blank line separates it from the previous token/comment. */
  blankLineBefore: boolean;
}

export interface Token {
  kind: TokenKind;
  /** Verbatim source text of the token itself (no trivia). */
  text: string;
  /** Uppercased text, precomputed for keyword matching. */
  upper: string;
  start: number;
  end: number;
  /** Comments that appear before this token and belong to it. */
  leadingComments: Comment[];
  /** Same-line comment that follows this token (before any newline), if any. */
  trailingComment?: Comment;
  /** True if at least one blank line separates this token from the previous one. */
  blankLineBefore: boolean;
}

export interface LexError {
  code: "LEX001";
  message: string;
  start: number;
  end: number;
}

export interface LexResult {
  tokens: Token[]; // always ends with an eof token carrying any dangling comments
  errors: LexError[];
}

/** Dialect descriptor consumed by the lexer/parser. v1: hive only. */
export interface Dialect {
  name: "hive";
  version: string; // e.g. "1.1"
  /** Uppercase keyword set (reserved + contextual). */
  keywords: ReadonlySet<string>;
  /** Additional template placeholder patterns (already length/timeout-guarded by config layer). */
  templatePatterns: RegExp[];
}

/** Non-whitespace, non-comment tokens — the sequence the safety gate compares. */
export function codeTokens(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.kind !== "eof");
}
