import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HIVE_110 } from "../src/dialects/hive110.js";
import { lex } from "../src/lexer.js";
import type { Comment, Dialect, Token, TokenKind } from "../src/tokens.js";

function run(sql: string, dialect: Dialect = HIVE_110) {
  return lex(sql, dialect);
}

/** Tokens without the trailing eof, as [kind, text] pairs. */
function shape(sql: string, dialect: Dialect = HIVE_110): Array<[TokenKind, string]> {
  return run(sql, dialect)
    .tokens.filter((t) => t.kind !== "eof")
    .map((t): [TokenKind, string] => [t.kind, t.text]);
}

function texts(sql: string): string[] {
  return shape(sql).map(([, text]) => text);
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

describe("template placeholders", () => {
  it("recognizes all four built-in forms as atomic verbatim tokens", () => {
    expect(shape("${a} ${hiveconf:month} ${hivevar:x} #{run_date} {{ run_date }} {% if c %}")).toEqual([
      ["template", "${a}"],
      ["template", "${hiveconf:month}"],
      ["template", "${hivevar:x}"],
      ["template", "#{run_date}"],
      ["template", "{{ run_date }}"],
      ["template", "{% if c %}"],
    ]);
  });

  it("splits a template from an adjacent dot-qualified name", () => {
    expect(shape("from ${target_database}.order_daily")).toEqual([
      ["keyword", "from"],
      ["template", "${target_database}"],
      ["dot", "."],
      ["identifier", "order_daily"],
    ]);
  });

  it("keeps a template inside a quoted string as part of the string", () => {
    // Templates are only recognized OUTSIDE strings: the literal wins, verbatim.
    expect(shape("where dt = '${hiveconf:run_date}'")).toEqual([
      ["keyword", "where"],
      ["identifier", "dt"],
      ["operator", "="],
      ["string", "'${hiveconf:run_date}'"],
    ]);
  });

  it("handles a template glued to quotes on both sides", () => {
    expect(shape("'${a}'${b}'${c}'")).toEqual([
      ["string", "'${a}'"],
      ["template", "${b}"],
      ["string", "'${c}'"],
    ]);
  });

  it("recognizes extra dialect template patterns anchored at the position", () => {
    const dialect: Dialect = { ...HIVE_110, templatePatterns: [/@@[A-Za-z_]+@@/] };
    expect(shape("select @@run_date@@ as d", dialect)).toEqual([
      ["keyword", "select"],
      ["template", "@@run_date@@"],
      ["keyword", "as"],
      ["identifier", "d"],
    ]);
  });

  it("does not let a custom pattern match away from the current position", () => {
    // The pattern would match later in the input; sticky anchoring must prevent it.
    const dialect: Dialect = { ...HIVE_110, templatePatterns: [/@@[A-Za-z_]+@@/] };
    const kinds = shape("select a @@x@@", dialect);
    expect(kinds[0]).toEqual(["keyword", "select"]);
    expect(kinds[1]).toEqual(["identifier", "a"]);
    expect(kinds[2]).toEqual(["template", "@@x@@"]);
  });

  it("refuses an unterminated template rather than swallowing the file", () => {
    const result = run("${abc\nselect 1");
    expect(result.tokens.map((t) => t.kind)).toEqual([
      "unknown",
      "identifier",
      "keyword",
      "number",
      "eof",
    ]);
    expect(result.errors).toEqual([]);
  });

  it("guards custom patterns with the 10000-char cap", () => {
    const dialect: Dialect = { ...HIVE_110, templatePatterns: [/<<[^>]*>>/] };
    const long = `<<${"x".repeat(20000)}>>`;
    const kinds = run(long, dialect).tokens.map((t) => t.kind);
    expect(kinds).not.toContain("template");
  });
});

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

describe("comments", () => {
  it("distinguishes hints from block comments", () => {
    const { tokens } = run("select /*+ broadcast(c) */ /* plain */ 1");
    const leading = tokens[1]?.leadingComments ?? [];
    expect(tokens[0]?.trailingComment?.kind).toBe("hint");
    expect(tokens[0]?.trailingComment?.text).toBe("/*+ broadcast(c) */");
    expect(leading.map((c) => c.kind)).toEqual(["block"]);
    expect(leading[0]?.text).toBe("/* plain */");
  });

  it("recognizes line comments verbatim without the newline", () => {
    const { tokens } = run("select 1 -- tail\n");
    expect(tokens[1]?.trailingComment?.kind).toBe("line");
    expect(tokens[1]?.trailingComment?.text).toBe("-- tail");
  });

  it("attaches a same-line comment as trailingComment of the preceding token", () => {
    const { tokens } = run("select a, -- about a\n  b\n");
    const comma = tokens.find((t) => t.kind === "comma");
    expect(comma?.trailingComment?.text).toBe("-- about a");
    const b = tokens.find((t) => t.text === "b");
    expect(b?.leadingComments).toEqual([]);
  });

  it("attaches an own-line comment as leadingComments of the next token", () => {
    const { tokens } = run("select a,\n-- about b\nb\n");
    const b = tokens.find((t) => t.text === "b");
    expect(b?.leadingComments.map((c) => c.text)).toEqual(["-- about b"]);
    expect(b?.leadingComments[0]?.ownLine).toBe(true);
  });

  it("gives a second same-line comment to the next token", () => {
    const { tokens } = run("a /*x*/ /*y*/ b");
    expect(tokens[0]?.trailingComment?.text).toBe("/*x*/");
    expect(tokens[1]?.leadingComments.map((c) => c.text)).toEqual(["/*y*/"]);
  });

  it("sets ownLine correctly for the first comment of the file", () => {
    const { tokens } = run("-- header\nselect 1");
    const header = tokens[0]?.leadingComments[0];
    expect(header?.ownLine).toBe(true);
    expect(header?.blankLineBefore).toBe(false);
  });

  it("sets blankLineBefore on comments separated by a blank line", () => {
    const { tokens } = run("-- one\n\n-- two\nselect 1");
    const comments = tokens[0]?.leadingComments ?? [];
    expect(comments.map((c) => c.text)).toEqual(["-- one", "-- two"]);
    expect(comments[0]?.blankLineBefore).toBe(false);
    expect(comments[1]?.blankLineBefore).toBe(true);
  });

  it("attaches dangling comments after the last token to eof", () => {
    const { tokens } = run("select 1;\n\n-- the end\n-- really\n");
    const eof = tokens[tokens.length - 1];
    expect(eof?.kind).toBe("eof");
    expect(eof?.start).toBe(eof?.end);
    expect(eof?.leadingComments.map((c: Comment) => c.text)).toEqual(["-- the end", "-- really"]);
    expect(eof?.leadingComments[0]?.blankLineBefore).toBe(true);
  });

  it("keeps a multi-line block comment as one comment with exact offsets", () => {
    const sql = "select\n/* line one\n   line two */\n1";
    const { tokens } = run(sql);
    const comment = tokens[1]?.leadingComments[0];
    expect(comment?.kind).toBe("block");
    expect(sql.slice(comment?.start ?? 0, comment?.end ?? 0)).toBe(comment?.text);
    expect(comment?.text).toBe("/* line one\n   line two */");
  });
});

// ---------------------------------------------------------------------------
// blank lines
// ---------------------------------------------------------------------------

describe("blankLineBefore", () => {
  it("is false for a single newline and true for two or more", () => {
    const { tokens } = run("a\nb\n\nc\n\n\nd");
    const byText = new Map(tokens.map((t) => [t.text, t]));
    expect(byText.get("a")?.blankLineBefore).toBe(false);
    expect(byText.get("b")?.blankLineBefore).toBe(false);
    expect(byText.get("c")?.blankLineBefore).toBe(true);
    expect(byText.get("d")?.blankLineBefore).toBe(true);
  });

  it("measures the gap to the nearest preceding comment, not token", () => {
    const { tokens } = run("select 1;\n\n-- note\nselect 2;");
    const second = tokens.find((t, i) => t.text === "select" && i > 0);
    // The comment sits directly above `select`, so no blank line separates them.
    expect(second?.blankLineBefore).toBe(false);
    expect(second?.leadingComments[0]?.blankLineBefore).toBe(true);
  });

  it("handles CRLF line endings", () => {
    const { tokens } = run("a\r\n\r\nb");
    expect(tokens[1]?.blankLineBefore).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// strings
// ---------------------------------------------------------------------------

describe("strings", () => {
  it("keeps single-quoted strings verbatim including backslash escapes", () => {
    expect(shape("select '\\\\s+', 'it\\'s'")).toEqual([
      ["keyword", "select"],
      ["string", "'\\\\s+'"],
      ["comma", ","],
      ["string", "'it\\'s'"],
    ]);
  });

  it("supports '' doubling", () => {
    expect(shape("'a''b'")).toEqual([["string", "'a''b'"]]);
    expect(shape("'' ''")).toEqual([
      ["string", "''"],
      ["string", "''"],
    ]);
  });

  it("treats double-quoted text as a string with the same rules", () => {
    expect(shape('"a""b" "c\\"d"')).toEqual([
      ["string", '"a""b"'],
      ["string", '"c\\"d"'],
    ]);
  });

  it("allows newlines inside a string literal", () => {
    expect(shape("'line one\nline two'")).toEqual([["string", "'line one\nline two'"]]);
  });

  it("reports LEX001 for an unclosed string literal", () => {
    const sql = "select 'oops";
    const { tokens, errors } = run(sql);
    expect(errors).toEqual([
      { code: "LEX001", message: "unclosed string literal", start: 7, end: sql.length },
    ]);
    // The span is still tokenized so downstream offsets stay complete.
    expect(tokens[1]?.kind).toBe("string");
    expect(tokens[1]?.end).toBe(sql.length);
  });

  it("reports LEX001 for an unclosed double-quoted string", () => {
    const { errors } = run('select "oops');
    expect(errors.map((e) => e.code)).toEqual(["LEX001"]);
  });
});

// ---------------------------------------------------------------------------
// quoted identifiers
// ---------------------------------------------------------------------------

describe("backtick identifiers", () => {
  it("lexes backticked words as quotedIdentifier", () => {
    expect(shape("select `select` as x")).toEqual([
      ["keyword", "select"],
      ["quotedIdentifier", "`select`"],
      ["keyword", "as"],
      ["identifier", "x"],
    ]);
  });

  it("supports backtick doubling", () => {
    expect(shape("`we``ird`")).toEqual([["quotedIdentifier", "`we``ird`"]]);
  });

  it("does not treat backslash as an escape inside backticks", () => {
    expect(shape("`a\\` b")).toEqual([
      ["quotedIdentifier", "`a\\`"],
      ["identifier", "b"],
    ]);
  });

  it("reports LEX001 for an unclosed quoted identifier", () => {
    const { errors } = run("select `oops");
    expect(errors).toEqual([
      { code: "LEX001", message: "unclosed quoted identifier", start: 7, end: 12 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

describe("numbers", () => {
  it("lexes integers, decimals, exponents and leading-dot literals", () => {
    expect(texts("1 12.50 1e5 1.5E-3 .5 0.0")).toEqual(["1", "12.50", "1e5", "1.5E-3", ".5", "0.0"]);
    expect(shape("1e5").map(([kind]) => kind)).toEqual(["number"]);
  });

  it("absorbs adjacent letter suffixes into the number token", () => {
    expect(texts("9223372036854775807L 12.50BD 10Y 10S 10L 10D 1.5f")).toEqual([
      "9223372036854775807L",
      "12.50BD",
      "10Y",
      "10S",
      "10L",
      "10D",
      "1.5f",
    ]);
  });

  it("keeps the dot inside a number but splits a qualified name", () => {
    expect(shape("t.col")).toEqual([
      ["identifier", "t"],
      ["dot", "."],
      ["identifier", "col"],
    ]);
    expect(shape("select 0.5")).toEqual([
      ["keyword", "select"],
      ["number", "0.5"],
    ]);
    expect(shape("select .5")).toEqual([
      ["keyword", "select"],
      ["number", ".5"],
    ]);
  });

  it("does not start a number from a dot glued to a preceding identifier", () => {
    // `db.5x` is not a fractional literal — the dot separates the parts.
    expect(shape("db.5x").map(([kind]) => kind)).toEqual(["identifier", "dot", "number"]);
    expect(shape("f(x).5").map(([kind]) => kind)).toEqual([
      "identifier",
      "lparen",
      "identifier",
      "rparen",
      "dot",
      "number",
    ]);
  });

  it("starts a number from a detached leading dot", () => {
    // Whitespace before the dot means it cannot be a qualifier.
    expect(texts("1.5E-3 .5")).toEqual(["1.5E-3", ".5"]);
  });

  it("does not consume a trailing dot with no fractional digits", () => {
    expect(shape("1.")).toEqual([
      ["number", "1"],
      ["dot", "."],
    ]);
  });
});

// ---------------------------------------------------------------------------
// operators and punctuation
// ---------------------------------------------------------------------------

describe("operators", () => {
  it("prefers the longest multi-character operator", () => {
    expect(texts("a <=> b")).toEqual(["a", "<=>", "b"]);
    expect(texts("a <= b")).toEqual(["a", "<=", "b"]);
    expect(texts("a <> b")).toEqual(["a", "<>", "b"]);
    expect(texts("a != b")).toEqual(["a", "!=", "b"]);
    expect(texts("a >= b")).toEqual(["a", ">=", "b"]);
    expect(texts("a == b")).toEqual(["a", "==", "b"]);
    expect(texts("a || b")).toEqual(["a", "||", "b"]);
    expect(texts("item -> item.sku_id")).toEqual(["item", "->", "item", ".", "sku_id"]);
  });

  it("kinds every multi-char operator as operator", () => {
    for (const op of ["<=>", "<>", "!=", "<=", ">=", "==", "||", "->"]) {
      expect(shape(`a ${op} b`)[1]).toEqual(["operator", op]);
    }
  });

  it("lexes single-character operators", () => {
    expect(shape("+ - * / % = < > ! | & ^ ~ ? :").map(([kind]) => kind)).toEqual(
      new Array(15).fill("operator"),
    );
  });

  it("gives parens, comma and semicolon dedicated kinds", () => {
    expect(shape("(a, b);")).toEqual([
      ["lparen", "("],
      ["identifier", "a"],
      ["comma", ","],
      ["identifier", "b"],
      ["rparen", ")"],
      ["semicolon", ";"],
    ]);
  });

  it("does not confuse `--` with two minus operators", () => {
    expect(shape("a - -1")).toEqual([
      ["identifier", "a"],
      ["operator", "-"],
      ["operator", "-"],
      ["number", "1"],
    ]);
    expect(shape("a --1")).toEqual([["identifier", "a"]]);
  });
});

// ---------------------------------------------------------------------------
// keywords
// ---------------------------------------------------------------------------

describe("keywords", () => {
  it("tags dialect keywords case-insensitively while preserving text", () => {
    const { tokens } = run("SeLeCt");
    expect(tokens[0]?.kind).toBe("keyword");
    expect(tokens[0]?.text).toBe("SeLeCt");
    expect(tokens[0]?.upper).toBe("SELECT");
  });

  it("treats true/false/null as keywords", () => {
    expect(shape("true false null").map(([kind]) => kind)).toEqual([
      "keyword",
      "keyword",
      "keyword",
    ]);
  });

  it("covers the vocabulary the printer needs", () => {
    const required = [
      "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "SORT",
      "DISTRIBUTE", "CLUSTER", "LIMIT", "JOIN", "INNER", "LEFT", "RIGHT",
      "FULL", "OUTER", "SEMI", "ANTI", "CROSS", "ON", "USING", "AS", "CASE",
      "WHEN", "THEN", "ELSE", "END", "AND", "OR", "NOT", "IN", "EXISTS",
      "BETWEEN", "LIKE", "RLIKE", "REGEXP", "IS", "NULL", "TRUE", "FALSE",
      "CAST", "DISTINCT", "ALL", "UNION", "INTERSECT", "EXCEPT", "MINUS",
      "WITH", "OVER", "PARTITION", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING",
      "FOLLOWING", "CURRENT", "ROW", "WINDOW", "INSERT", "OVERWRITE", "INTO",
      "TABLE", "VALUES", "SET", "USE", "ADD", "JAR", "FILE", "LATERAL", "VIEW",
      "EXPLODE", "POSEXPLODE", "ASC", "DESC", "NULLS", "FIRST", "LAST", "IF",
      "INTERVAL", "TABLESAMPLE", "PERCENT", "QUALIFY", "FILTER", "RESET",
      "CREATE", "DROP", "ALTER", "MERGE", "UPDATE", "DELETE", "LOAD", "SHOW",
      "DESCRIBE", "EXPLAIN", "ANALYZE", "MSCK", "TRUNCATE", "GRANT", "REVOKE",
      "BEGIN", "DECLARE", "CACHE", "UNCACHE", "CLEAR", "REPAIR", "TRANSFORM",
      "GROUPING", "SETS", "ROLLUP", "CUBE", "PIVOT", "UNPIVOT",
    ];
    const missing = required.filter((word) => !HIVE_110.keywords.has(word));
    expect(missing).toEqual([]);
  });

  it("stores only uppercase entries", () => {
    const notUpper = [...HIVE_110.keywords].filter((word) => word !== word.toUpperCase());
    expect(notUpper).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unknown + eof
// ---------------------------------------------------------------------------

describe("unknown characters", () => {
  it("emits one maximal run of unclassifiable characters, not an error", () => {
    const { tokens, errors } = run("select @@@ x");
    expect(errors).toEqual([]);
    expect(shape("select @@@ x")).toEqual([
      ["keyword", "select"],
      ["unknown", "@@@"],
      ["identifier", "x"],
    ]);
    expect(tokens.some((t) => t.kind === "unknown")).toBe(true);
  });

  it("stops an unknown run at the next known construct", () => {
    expect(shape("@#a")).toEqual([
      ["unknown", "@#"],
      ["identifier", "a"],
    ]);
    expect(shape("[a]")).toEqual([
      ["unknown", "["],
      ["identifier", "a"],
      ["unknown", "]"],
    ]);
  });

  it("stops an unknown run at whitespace", () => {
    expect(shape("@ @")).toEqual([
      ["unknown", "@"],
      ["unknown", "@"],
    ]);
  });
});

describe("eof token", () => {
  it("always terminates the stream with a zero-width eof at the end", () => {
    for (const sql of ["", "   ", "select 1", "select 1;\n"]) {
      const { tokens } = run(sql);
      const eof = tokens[tokens.length - 1];
      expect(eof?.kind).toBe("eof");
      expect(eof?.text).toBe("");
      expect(eof?.upper).toBe("");
      expect(eof?.start).toBe(sql.length);
      expect(eof?.end).toBe(sql.length);
      expect(tokens.filter((t) => t.kind === "eof")).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// property tests over the calibration corpora
// ---------------------------------------------------------------------------

const CORPUS_FILES = [
  "complex_case_style_calibration.sql",
  "spark_sql_style_calibration.sql",
] as const;

function readCorpus(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${name}`, import.meta.url)), "utf8");
}

/** Every comment in the stream, in source order. */
function allComments(tokens: Token[]): Comment[] {
  const out: Comment[] = [];
  for (const token of tokens) {
    out.push(...token.leadingComments);
    if (token.trailingComment !== undefined) out.push(token.trailingComment);
  }
  return out.sort((a, b) => a.start - b.start);
}

describe.each(CORPUS_FILES)("corpus %s", (name) => {
  const sql = readCorpus(name);
  const { tokens, errors } = lex(sql, HIVE_110);

  it("is non-trivial", () => {
    expect(sql.length).toBeGreaterThan(1000);
    expect(tokens.length).toBeGreaterThan(100);
  });

  it("produces zero lex errors", () => {
    expect(errors).toEqual([]);
  });

  it("produces zero unknown tokens", () => {
    const unknown = tokens
      .filter((t) => t.kind === "unknown")
      .map((t) => `${t.start}:${JSON.stringify(t.text)}`);
    expect(unknown).toEqual([]);
  });

  it("has exact, strictly increasing, non-overlapping offsets", () => {
    let cursor = 0;
    for (const token of tokens) {
      expect(token.start).toBeGreaterThanOrEqual(cursor);
      expect(token.end).toBeGreaterThanOrEqual(token.start);
      expect(sql.slice(token.start, token.end)).toBe(token.text);
      expect(token.upper).toBe(token.text.toUpperCase());
      cursor = token.end;
    }
    const code = tokens.filter((t) => t.kind !== "eof");
    for (let i = 1; i < code.length; i++) {
      expect(code[i]!.start).toBeGreaterThan(code[i - 1]!.start);
      expect(code[i]!.start).toBeGreaterThanOrEqual(code[i - 1]!.end);
    }
  });

  it("has comments with exact offsets, interleaved in source order", () => {
    const comments = allComments(tokens);
    for (const comment of comments) {
      expect(sql.slice(comment.start, comment.end)).toBe(comment.text);
    }
    for (let i = 1; i < comments.length; i++) {
      expect(comments[i]!.start).toBeGreaterThanOrEqual(comments[i - 1]!.end);
    }
    expect(comments.length).toBeGreaterThan(0);
  });

  it("attaches every comment exactly once", () => {
    const comments = allComments(tokens);
    expect(new Set(comments.map((c) => c.start)).size).toBe(comments.length);
  });

  it("covers every non-whitespace character exactly once", () => {
    const spans: Array<[number, number]> = [];
    for (const token of tokens) {
      if (token.end > token.start) spans.push([token.start, token.end]);
    }
    for (const comment of allComments(tokens)) spans.push([comment.start, comment.end]);
    spans.sort((a, b) => a[0] - b[0]);

    // No overlaps.
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]);
    }

    const covered = new Uint8Array(sql.length);
    for (const [start, end] of spans) covered.fill(1, start, end);

    const whitespace = /\s/u;
    const uncovered: string[] = [];
    for (let i = 0; i < sql.length; i++) {
      if (covered[i] === 0 && !whitespace.test(sql[i]!)) {
        uncovered.push(`${i}:${JSON.stringify(sql.slice(Math.max(0, i - 20), i + 20))}`);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it("recognizes the expected token kinds", () => {
    const kinds = new Set(tokens.map((t) => t.kind));
    expect(kinds.has("keyword")).toBe(true);
    expect(kinds.has("identifier")).toBe(true);
    expect(kinds.has("string")).toBe(true);
    expect(kinds.has("number")).toBe(true);
    expect(kinds.has("lparen")).toBe(true);
    expect(kinds.has("semicolon")).toBe(true);
  });
});

describe("corpus specifics", () => {
  const spark = readCorpus("spark_sql_style_calibration.sql");
  const { tokens } = lex(spark, HIVE_110);

  it("finds the hiveconf templates as template tokens", () => {
    const templates = tokens.filter((t) => t.kind === "template").map((t) => t.text);
    expect(templates).toContain("${hiveconf:run_date}");
    expect(templates).toContain("${target_database}");
    expect(templates.length).toBeGreaterThan(0);
  });

  it("keeps '${run_date}' inside a string as a single string token", () => {
    const strings = tokens.filter((t) => t.kind === "string").map((t) => t.text);
    expect(strings).toContain("'${run_date}'");
  });

  it("finds the optimizer hint", () => {
    const hints = allComments(tokens).filter((c) => c.kind === "hint");
    expect(hints.map((c) => c.text)).toEqual(["/*+ broadcast(c), repartition(200, o.dt) */"]);
  });

  it("finds typed numeric literals", () => {
    const numbers = tokens.filter((t) => t.kind === "number").map((t) => t.text);
    expect(numbers).toContain("9223372036854775807L");
    expect(numbers).toContain("12.50BD");
  });

  it("finds the backtick identifier", () => {
    const quoted = tokens.filter((t) => t.kind === "quotedIdentifier").map((t) => t.text);
    expect(quoted).toEqual(["`select`"]);
  });
});
