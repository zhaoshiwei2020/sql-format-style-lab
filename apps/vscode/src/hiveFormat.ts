/**
 * Hive-aware formatting pipeline on top of sql-formatter.
 *
 * Two behaviors the stock sql-formatter cannot express (and which motivated
 * this fork):
 *
 * 1. Session statements pass through verbatim. `set`, `use`, `add jar`,
 *    `reset`, ... must keep their exact hand-written shape — Hive job-config
 *    blocks at the top of ETL scripts are tuned by hand and sql-formatter
 *    mangles them (`set a=b` → three lines with padded `=`). Passing them
 *    through also removes the need for `/* sql-formatter-disable *​/`
 *    wrappers, which broke copy-paste into the internal query platform.
 * 2. Legacy `/* sql-formatter-disable *​/ ... /* sql-formatter-enable *​/`
 *    blocks: the enclosed text is preserved verbatim and both markers are
 *    dropped, so old files keep their protected regions and stop carrying
 *    the markers into pasted SQL.
 *
 * Everything else goes to sql-formatter unchanged.
 */

import { format as sqlFormatterFormat, type FormatOptions } from "sql-formatter";

/** Statements whose shape is never touched. Matched after leading trivia. */
const RAW_STATEMENT =
  /^(?:set|use|reset|add\s+(?:jar|file)|delete\s+jar|dfs|list(?:\s+(?:jar|file))?)\b/i;

/** Leading whitespace and comments (banner blocks) before the first word. */
const LEADING_TRIVIA = /(?:\s+|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/y;

const DISABLE_MARKER = /\/\*\s*sql-formatter-disable\s*\*\//y;
const ENABLE_MARKER = /\/\*\s*sql-formatter-enable\s*\*\//g;

interface Segment {
  kind: "raw" | "sql";
  text: string;
}

/**
 * Splits SQL into statements on top-level semicolons. Quote-, comment- and
 * backtick-aware; `${...}` templates ride along as plain text.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  const n = sql.length;
  let start = 0;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < n && sql[i] !== quote) {
        if (sql[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < n && sql[i] !== "`") i++;
      i++;
      continue;
    }
    if (c === ";") {
      out.push(sql.slice(start, i + 1));
      start = i + 1;
    }
    i++;
  }
  if (start < n) out.push(sql.slice(start));
  return out;
}

/**
 * Session statement (or comment-only fragment), allowing banner comments
 * ahead of the keyword. Comment-only chunks are raw too: banners are
 * hand-drawn and sending them through the library makes the pass-1/pass-2
 * statement grouping diverge.
 */
function isRawStatement(statement: string): boolean {
  LEADING_TRIVIA.lastIndex = 0;
  const m = LEADING_TRIVIA.exec(statement);
  const stripped = m ? statement.slice(LEADING_TRIVIA.lastIndex) : statement;
  return stripped.trim() === "" ? true : RAW_STATEMENT.test(stripped);
}

/** Strips blank lines at both ends and trailing whitespace on each line. */
function cleanRaw(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/**
 * Document → segments. Disable blocks become single raw segments (markers
 * dropped); everything else is split into statements and classified, then
 * consecutive same-kind segments merge.
 */
function segmentDocument(text: string): Segment[] {
  const segments: Segment[] = [];
  let plain = 0; // start of unprocessed plain-text region
  let i = 0;
  const n = text.length;

  const flushPlain = (chunk: string) => {
    if (chunk.trim() === "") return;
    for (const stmt of splitStatements(chunk)) {
      if (stmt.trim() === "") continue;
      const kind = isRawStatement(stmt) ? "raw" : "sql";
      const last = segments[segments.length - 1];
      // Consecutive same-kind statements merge into one segment: raw keeps
      // its hand-written block shape, sql lets the library apply its own
      // linesBetweenQueries spacing.
      if (last && last.kind === kind) last.text += stmt;
      else segments.push({ kind, text: stmt });
    }
  };

  while (i < n) {
    DISABLE_MARKER.lastIndex = i;
    if (DISABLE_MARKER.test(text)) {
      flushPlain(text.slice(plain, i));
      const contentStart = DISABLE_MARKER.lastIndex;
      ENABLE_MARKER.lastIndex = contentStart;
      const enable = ENABLE_MARKER.exec(text);
      const contentEnd = enable ? enable.index : n;
      const resume = enable ? enable.index + enable[0].length : n;
      const content = cleanRaw(text.slice(contentStart, contentEnd));
      if (content !== "") segments.push({ kind: "raw", text: content });
      i = plain = resume;
      continue;
    }
    i++;
  }
  flushPlain(text.slice(plain));
  return segments;
}

/**
 * Hive `!` logical negation → `not`. sql-formatter's spark dialect has no
 * `!` prefix operator and dies on `where ! (a and b)`. Semantically
 * equivalent in Hive; `!=` is left alone. Quote/comment/backtick-aware.
 */
function rewriteBangNot(sql: string): string {
  let out = "";
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      const end = j === -1 ? n : j;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      const end = j === -1 ? n : j + 2;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n && sql[j] !== quote) {
        if (quote !== "`" && sql[j] === "\\") j++;
        j++;
      }
      const end = Math.min(n, j + 1);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === "!" && sql[i + 1] !== "=") {
      out += "not ";
      i++;
      while (i < n && (sql[i] === " " || sql[i] === "\t")) i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Formats one sql segment. On a parse error, falls back statement by
 * statement so a single exotic construct keeps its hand shape without
 * blocking the rest of the file.
 */
function formatSqlSegment(segment: string, options: FormatOptions): string {
  const rewritten = rewriteBangNot(segment);
  try {
    return sqlFormatterFormat(rewritten, options).trim();
  } catch {
    const parts = splitStatements(rewritten).map((stmt) => {
      if (stmt.trim() === "") return undefined;
      try {
        return sqlFormatterFormat(stmt, options).trim();
      } catch {
        return cleanRaw(stmt);
      }
    });
    return parts.filter((p): p is string => p !== undefined && p !== "").join("\n\n");
  }
}

export interface FormatDocumentResult {
  output: string;
}

/**
 * Formats a full SQL document: session statements and disable-block content
 * verbatim, everything else through sql-formatter (with `!`→`not` rewrite
 * and per-statement fallback). Segments are joined with one blank line; the
 * result always ends with a single newline.
 */
export function formatDocument(text: string, options: FormatOptions): FormatDocumentResult {
  const segments = segmentDocument(text);
  const out = segments.map((seg) =>
    seg.kind === "raw" ? cleanRaw(seg.text) : formatSqlSegment(seg.text, options),
  );
  return { output: out.join("\n\n").replace(/\s+$/, "") + "\n" };
}
