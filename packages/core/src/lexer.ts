/**
 * Lossless Hive lexer. Implementation contract: see tokens.ts.
 * OWNER: lexer implementation task. Do not change exported signatures.
 *
 * Design notes
 * ------------
 * - Single forward pass, no backtracking-prone regexes. The few regexes used
 *   are sticky (`y`) and anchored at the current offset; none of them nest
 *   quantifiers over overlapping character classes.
 * - Template placeholders are matched *before* strings/identifiers so that
 *   `${hiveconf:x}` stays one atomic, verbatim token. Templates that appear
 *   *inside* a quoted string are not separated out: the string wins and is kept
 *   verbatim (e.g. `'${run_date}'` is a single `string` token). That is
 *   intentional — a formatter must never reshape the inside of a literal.
 * - Every non-whitespace character of the input ends up inside exactly one
 *   token span or one comment span, which is what the safety gate relies on.
 */

import type { Comment, Dialect, LexError, LexResult, Token, TokenKind } from "./tokens.js";

/** Hard cap on the source span a single template placeholder may cover. */
const MAX_TEMPLATE_LENGTH = 10_000;

/** Anchored scanners. All sticky; `lastIndex` is set explicitly before use. */
const WHITESPACE_RUN = /\s+/uy;
/** Non-sticky single-character whitespace probe (no `lastIndex` state). */
const WHITESPACE_CHAR = /\s/u;
const IDENTIFIER_RUN = /[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}_]*/uy;
/**
 * `123`, `1.5`, `.5`, `1e5`, `1.5E-3`, plus immediately adjacent letter
 * suffixes (`10Y`, `12.50BD`, `9223372036854775807L`).
 */
const NUMBER_RUN = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?[A-Za-z]*/y;

/** Multi-character operators, longest match first. */
const MULTI_CHAR_OPERATORS: readonly string[] = ["<=>", "<>", "!=", "<=", ">=", "==", "||", "->"];
/** Single-character operators. `.` is handled separately (kind "dot"). */
const SINGLE_CHAR_OPERATORS = "+-*/%=<>!|&^~?:";

const PUNCTUATION: Readonly<Record<string, TokenKind>> = {
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
  ";": "semicolon",
};

/**
 * Token kinds after which an *immediately adjacent* `.` is a member/qualifier
 * separator rather than the start of a fractional literal (`db.5x` vs
 * `select .5`). Keywords are deliberately absent: `select .5` is real SQL,
 * while `<keyword>.<digits>` is not.
 */
const DOT_AFTER: ReadonlySet<TokenKind> = new Set<TokenKind>([
  "identifier",
  "quotedIdentifier",
  "number",
  "rparen",
  "template",
]);

/** Sticky clones of user-supplied template patterns, cached per RegExp object. */
const stickyCache = new WeakMap<RegExp, RegExp>();

function toSticky(pattern: RegExp): RegExp {
  const cached = stickyCache.get(pattern);
  if (cached !== undefined) return cached;
  const flags = `${pattern.flags.replace(/[gy]/g, "")}y`;
  const sticky = new RegExp(pattern.source, flags);
  stickyCache.set(pattern, sticky);
  return sticky;
}

const LF = 10;
const CR = 13;

export function lex(sql: string, dialect: Dialect): LexResult {
  const length = sql.length;
  const tokens: Token[] = [];
  const errors: LexError[] = [];

  let pos = 0;
  /** Comments waiting to be attached as leadingComments of the next token. */
  let pendingComments: Comment[] = [];
  /** Newlines seen since the previous token or comment ended. */
  let newlines = 0;
  /** Whether a token or comment has already been emitted on the current line. */
  let contentOnLine = false;
  let lastToken: Token | undefined;
  /** Monotone `indexOf` memo for template close delimiters. */
  const closeSearchCache = new Map<string, { from: number; index: number }>();

  function emitToken(kind: TokenKind, start: number, end: number): void {
    const text = sql.slice(start, end);
    const token: Token = {
      kind,
      text,
      upper: text.toUpperCase(),
      start,
      end,
      leadingComments: pendingComments,
      blankLineBefore: newlines >= 2,
    };
    pendingComments = [];
    tokens.push(token);
    lastToken = token;
    newlines = 0;
    contentOnLine = true;
  }

  function emitComment(kind: Comment["kind"], start: number, end: number): void {
    const ownLine = !contentOnLine;
    const comment: Comment = {
      kind,
      text: sql.slice(start, end),
      start,
      end,
      ownLine,
      blankLineBefore: newlines >= 2,
    };
    if (
      !ownLine &&
      newlines === 0 &&
      lastToken !== undefined &&
      lastToken.trailingComment === undefined &&
      pendingComments.length === 0
    ) {
      lastToken.trailingComment = comment;
    } else {
      pendingComments.push(comment);
    }
    newlines = 0;
    contentOnLine = true;
  }

  function countNewlines(start: number, end: number): void {
    for (let i = start; i < end; i++) {
      const code = sql.charCodeAt(i);
      if (code === LF) {
        newlines++;
      } else if (code === CR) {
        // Treat CRLF as a single line break.
        if (sql.charCodeAt(i + 1) !== LF) newlines++;
      }
    }
    if (newlines > 0) contentOnLine = false;
  }

  /** `${x}` / `#{x}` / `{{ x }}` / `{% x %}`. Returns the end offset or -1. */
  function scanBuiltinTemplate(start: number): number {
    const c0 = sql.charAt(start);
    const c1 = sql.charAt(start + 1);
    if ((c0 === "$" || c0 === "#") && c1 === "{") return scanTemplateBody(start, "}", false);
    if (c0 === "{" && c1 === "{") return scanTemplateBody(start, "}}", true);
    if (c0 === "{" && c1 === "%") return scanTemplateBody(start, "%}", true);
    return -1;
  }

  function scanTemplateBody(start: number, close: string, allowNewline: boolean): number {
    const closeAt = indexOfClose(close, start + 2);
    if (closeAt === -1) return -1;
    const end = closeAt + close.length;
    if (end - start > MAX_TEMPLATE_LENGTH) return -1;
    if (!allowNewline) {
      // `${x}` / `#{x}` never span lines; a line break means this is not a
      // placeholder at all (a stray `$` must not swallow the rest of the file).
      for (let i = start + 2; i < closeAt; i++) {
        const code = sql.charCodeAt(i);
        if (code === LF || code === CR) return -1;
      }
    }
    return end;
  }

  /**
   * Memoized `indexOf` for template close delimiters. `from` advances
   * monotonically through the input, so a previously found (or absent)
   * occurrence stays valid — this keeps degenerate inputs such as `"${".repeat(n)`
   * linear instead of O(n * MAX_TEMPLATE_LENGTH).
   */
  function indexOfClose(close: string, from: number): number {
    const cached = closeSearchCache.get(close);
    if (cached !== undefined && cached.from <= from) {
      if (cached.index === -1) return -1;
      if (cached.index >= from) return cached.index;
    }
    const index = sql.indexOf(close, from);
    closeSearchCache.set(close, { from, index });
    return index;
  }

  /** Dialect-supplied extra placeholder patterns. Returns end offset or -1. */
  function scanCustomTemplate(start: number): number {
    for (const pattern of dialect.templatePatterns) {
      const sticky = toSticky(pattern);
      sticky.lastIndex = start;
      const match = sticky.exec(sql);
      if (match === null) continue;
      const matched = match[0];
      if (matched.length === 0 || matched.length > MAX_TEMPLATE_LENGTH) continue;
      return start + matched.length;
    }
    return -1;
  }

  /**
   * Quote scanner shared by '…', "…" and `…`. Handles doubling of the quote
   * character; backslash escapes only where the dialect allows them.
   * Returns the end offset, or -1 when the literal runs to EOF unterminated.
   */
  function scanQuoted(start: number, quote: string, backslashEscapes: boolean): number {
    let i = start + 1;
    while (i < length) {
      const ch = sql.charAt(i);
      if (backslashEscapes && ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) {
        if (sql.charAt(i + 1) === quote) {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return -1;
  }

  /** True when some known construct starts at `at` (used to bound unknown runs). */
  function startsKnownConstruct(at: number): boolean {
    const ch = sql.charAt(at);
    if (ch === "") return true;
    if (WHITESPACE_CHAR.test(ch)) return true;
    if (ch === "-" && sql.charAt(at + 1) === "-") return true;
    if (ch === "/" && sql.charAt(at + 1) === "*") return true;
    if (ch === "'" || ch === '"' || ch === "`") return true;
    if (ch >= "0" && ch <= "9") return true;
    if (ch === ".") return true;
    if (SINGLE_CHAR_OPERATORS.includes(ch)) return true;
    if (Object.prototype.hasOwnProperty.call(PUNCTUATION, ch)) return true;
    if (scanBuiltinTemplate(at) !== -1) return true;
    if (scanCustomTemplate(at) !== -1) return true;
    IDENTIFIER_RUN.lastIndex = at;
    return IDENTIFIER_RUN.test(sql);
  }

  while (pos < length) {
    const ch = sql.charAt(pos);

    // --- whitespace -------------------------------------------------------
    WHITESPACE_RUN.lastIndex = pos;
    const wsMatch = WHITESPACE_RUN.exec(sql);
    if (wsMatch !== null) {
      const end = pos + wsMatch[0].length;
      countNewlines(pos, end);
      pos = end;
      continue;
    }

    // --- comments ---------------------------------------------------------
    if (ch === "-" && sql.charAt(pos + 1) === "-") {
      let end = pos + 2;
      while (end < length) {
        const code = sql.charCodeAt(end);
        if (code === LF || code === CR) break;
        end++;
      }
      emitComment("line", pos, end);
      pos = end;
      continue;
    }

    if (ch === "/" && sql.charAt(pos + 1) === "*") {
      const closeAt = sql.indexOf("*/", pos + 2);
      const end = closeAt === -1 ? length : closeAt + 2;
      const kind: Comment["kind"] = sql.charAt(pos + 2) === "+" ? "hint" : "block";
      emitComment(kind, pos, end);
      pos = end;
      continue;
    }

    // --- template placeholders (before strings and identifiers) -----------
    const builtinTemplateEnd = scanBuiltinTemplate(pos);
    const templateEnd = builtinTemplateEnd !== -1 ? builtinTemplateEnd : scanCustomTemplate(pos);
    if (templateEnd !== -1) {
      emitToken("template", pos, templateEnd);
      pos = templateEnd;
      continue;
    }

    // --- strings ----------------------------------------------------------
    if (ch === "'" || ch === '"') {
      const end = scanQuoted(pos, ch, true);
      if (end === -1) {
        errors.push({
          code: "LEX001",
          message: "unclosed string literal",
          start: pos,
          end: length,
        });
        emitToken("string", pos, length);
        pos = length;
        continue;
      }
      emitToken("string", pos, end);
      pos = end;
      continue;
    }

    // --- backtick quoted identifiers --------------------------------------
    if (ch === "`") {
      const end = scanQuoted(pos, "`", false);
      if (end === -1) {
        errors.push({
          code: "LEX001",
          message: "unclosed quoted identifier",
          start: pos,
          end: length,
        });
        emitToken("quotedIdentifier", pos, length);
        pos = length;
        continue;
      }
      emitToken("quotedIdentifier", pos, end);
      pos = end;
      continue;
    }

    // --- numbers ----------------------------------------------------------
    const isDigit = ch >= "0" && ch <= "9";
    const nextCh = sql.charAt(pos + 1);
    const dotIsQualifier =
      lastToken !== undefined && lastToken.end === pos && DOT_AFTER.has(lastToken.kind);
    const isLeadingDotNumber = ch === "." && nextCh >= "0" && nextCh <= "9" && !dotIsQualifier;
    if (isDigit || isLeadingDotNumber) {
      NUMBER_RUN.lastIndex = pos;
      const match = NUMBER_RUN.exec(sql);
      // The guards above guarantee a match here.
      /* c8 ignore next */
      const end = match === null ? pos + 1 : pos + match[0].length;
      emitToken("number", pos, end);
      pos = end;
      continue;
    }

    // --- identifiers and keywords ----------------------------------------
    IDENTIFIER_RUN.lastIndex = pos;
    const identMatch = IDENTIFIER_RUN.exec(sql);
    if (identMatch !== null) {
      const text = identMatch[0];
      const end = pos + text.length;
      const kind: TokenKind = dialect.keywords.has(text.toUpperCase()) ? "keyword" : "identifier";
      emitToken(kind, pos, end);
      pos = end;
      continue;
    }

    // --- punctuation with dedicated kinds ---------------------------------
    const punctKind = Object.prototype.hasOwnProperty.call(PUNCTUATION, ch)
      ? PUNCTUATION[ch]
      : undefined;
    if (punctKind !== undefined) {
      emitToken(punctKind, pos, pos + 1);
      pos += 1;
      continue;
    }

    // --- dot --------------------------------------------------------------
    if (ch === ".") {
      emitToken("dot", pos, pos + 1);
      pos += 1;
      continue;
    }

    // --- operators, longest match first -----------------------------------
    let operator: string | undefined;
    for (const candidate of MULTI_CHAR_OPERATORS) {
      if (sql.startsWith(candidate, pos)) {
        operator = candidate;
        break;
      }
    }
    if (operator === undefined && SINGLE_CHAR_OPERATORS.includes(ch)) {
      operator = ch;
    }
    if (operator !== undefined) {
      emitToken("operator", pos, pos + operator.length);
      pos += operator.length;
      continue;
    }

    // --- unknown: one maximal run of unclassifiable characters -------------
    let end = pos + 1;
    while (end < length && !startsKnownConstruct(end)) end++;
    emitToken("unknown", pos, end);
    pos = end;
  }

  tokens.push({
    kind: "eof",
    text: "",
    upper: "",
    start: length,
    end: length,
    leadingComments: pendingComments,
    blankLineBefore: newlines >= 2,
  });

  return { tokens, errors };
}
