/**
 * Parser contract tests (ARCHITECTURE.md §4.7, §7.2).
 *
 * The three properties that matter here:
 *   1. LOSSLESS  — every non-eof token from the lexer appears exactly once in
 *      the returned tree, in source order.
 *   2. COVERAGE  — the supported corpus classifies as VALID_SUPPORTED, and the
 *      deliberately out-of-scope constructs never do.
 *   3. SHAPE     — the typed nodes actually model the grammar (boolean chain
 *      flattening, between/and binding, simple vs searched CASE, ...).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { analyzeCoverage } from "../src/coverage.js";
import type {
  BetweenExpr,
  BooleanChain,
  CaseExpr,
  Expr,
  FunctionCall,
  InsertStatement,
  IsExpr,
  LambdaExpr,
  MultiInsertStatement,
  NotExpr,
  ParseResult,
  QuerySpec,
  SelectStatement,
  SetStatement,
  StatementNode,
} from "../src/cst.js";
import { HIVE_110 } from "../src/dialects/hive110.js";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import type { Token } from "../src/tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");
const COMPLEX_CASE_SQL = join(REPO_ROOT, "complex_case_style_calibration.sql");
const SPARK_SQL = join(REPO_ROOT, "spark_sql_style_calibration.sql");
const SPARK_FIXTURES = join(REPO_ROOT, "fixtures/golden-pending/spark");
const UNSUPPORTED_FIXTURES = join(REPO_ROOT, "fixtures/unsupported");

function parseSql(sql: string): ParseResult {
  return parse(lex(sql, HIVE_110).tokens, HIVE_110);
}

// ---------------------------------------------------------------------------
// Generic token walker (duck-typed, so it never needs updating for new nodes)
// ---------------------------------------------------------------------------

function isToken(value: unknown): value is Token {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec["text"] === "string" &&
    typeof rec["upper"] === "string" &&
    typeof rec["start"] === "number" &&
    typeof rec["end"] === "number"
  );
}

function collectTokens(node: unknown, out: Token[]): void {
  if (node === null || typeof node !== "object") return;
  if (isToken(node)) {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTokens(item, out);
    return;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectTokens(value, out);
  }
}

/** Every token in the tree, sorted by source position. */
function treeTokens(result: ParseResult): Token[] {
  const out: Token[] = [];
  for (const stmt of result.file.statements) collectTokens(stmt, out);
  return out.sort((a, b) => a.start - b.start);
}

function expectLossless(sql: string): void {
  // One lex, so token identity (not just equality) is meaningful.
  const lexed = lex(sql, HIVE_110).tokens;
  const expected = lexed.filter((t) => t.kind !== "eof");
  const result = parse(lexed, HIVE_110);
  const actual = treeTokens(result);
  expect(result.file.eof).toBe(lexed[lexed.length - 1]);

  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    // Identity, not just equality: the parser must never re-spell a token.
    expect(actual[i]).toBe(expected[i]);
  }
}

// ---------------------------------------------------------------------------
// Small helpers for the shape assertions
// ---------------------------------------------------------------------------

function parseOne(sql: string): StatementNode {
  const result = parseSql(sql);
  expect(result.file.statements.length).toBe(1);
  const stmt = result.file.statements[0];
  if (stmt === undefined) throw new Error("no statement parsed");
  return stmt;
}

function stateOf(sql: string): string {
  return analyzeCoverage(parseSql(sql)).state;
}

function querySpecOf(stmt: StatementNode): QuerySpec {
  expect(stmt.kind).toBe("selectStatement");
  const body = (stmt as SelectStatement).body;
  expect(body.kind).toBe("querySpec");
  return body as QuerySpec;
}

/** First select item expression of a single-statement select. */
function firstItemExpr(sql: string): Expr {
  const spec = querySpecOf(parseOne(sql));
  const item = spec.items[0];
  if (item === undefined) throw new Error("no select items");
  return item.expr;
}

function listDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function listSqlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

// ---------------------------------------------------------------------------
// 1. Losslessness
// ---------------------------------------------------------------------------

describe("token completeness", () => {
  it("keeps every token of the complex-CASE corpus exactly once, in order", () => {
    expectLossless(readFileSync(COMPLEX_CASE_SQL, "utf8"));
  });

  it("keeps every token of the Spark corpus exactly once, in order", () => {
    expectLossless(readFileSync(SPARK_SQL, "utf8"));
  });

  it("keeps every token of each unsupported fixture", () => {
    for (const name of listSqlFiles(UNSUPPORTED_FIXTURES)) {
      expectLossless(readFileSync(join(UNSUPPORTED_FIXTURES, name), "utf8"));
    }
  });

  it("puts a trailing semicolon in `semicolon`, not in the token run", () => {
    const stmt = parseOne("use style_lab;");
    expect(stmt.kind).toBe("genericStatement");
    expect(stmt.semicolon?.kind).toBe("semicolon");
    const tokens = (stmt as { tokens: Token[] }).tokens;
    expect(tokens.some((t) => t.kind === "semicolon")).toBe(false);
  });

  it("never throws on garbage input", () => {
    expect(() => parseSql("!!! @@@ ;; select from where;")).not.toThrow();
    const result = parseSql("!!! @@@ ;; select from where;");
    expect(result.diagnostics).toEqual([]);
    expect(result.file.eof.kind).toBe("eof");
  });
});

// ---------------------------------------------------------------------------
// 2. complex_case corpus: fully supported
// ---------------------------------------------------------------------------

describe("complex_case_style_calibration.sql", () => {
  const sql = readFileSync(COMPLEX_CASE_SQL, "utf8");
  const result = parseSql(sql);

  it("parses as exactly 13 select statements", () => {
    expect(result.file.statements.length).toBe(13);
    expect(result.file.statements.map((s) => s.kind)).toEqual(
      new Array(13).fill("selectStatement"),
    );
  });

  it("contains no unsupported or unknown nodes anywhere", () => {
    const coverage = analyzeCoverage(result);
    expect(coverage.diagnostics).toEqual([]);
    expect(coverage.state).toBe("VALID_SUPPORTED");
  });
});

// ---------------------------------------------------------------------------
// 3. Spark corpus classification
// ---------------------------------------------------------------------------

describe("spark_sql_style_calibration.sql", () => {
  const sql = readFileSync(SPARK_SQL, "utf8");

  it("does not throw", () => {
    expect(() => parseSql(sql)).not.toThrow();
  });

  const result = parseSql(sql);
  const byOpener = new Map<string, StatementNode[]>();
  for (const stmt of result.file.statements) {
    const tokens = (stmt as { tokens?: Token[] }).tokens;
    const head = tokens?.[0]?.upper;
    if (head === undefined) continue;
    const bucket = byOpener.get(head) ?? [];
    bucket.push(stmt);
    byOpener.set(head, bucket);
  }

  const outOfScopeOpeners = [
    "MERGE",
    "UPDATE",
    "DELETE",
    "LOAD",
    "CREATE",
    "DROP",
    "ALTER",
    "DECLARE",
    "BEGIN",
    "SHOW",
    "DESCRIBE",
    "ANALYZE",
    "REPAIR",
    "CACHE",
    "UNCACHE",
    "CLEAR",
    "EXPLAIN",
  ];

  it.each(outOfScopeOpeners)("%s statements never parse as selectStatement", (opener) => {
    const found = byOpener.get(opener) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const stmt of found) {
      expect(["unsupportedStatement", "unknownStatement"]).toContain(stmt.kind);
    }
  });

  it("classifies MERGE / LOAD / CREATE with a precise construct name", () => {
    const constructs = result.file.statements
      .filter((s) => s.kind === "unsupportedStatement")
      .map((s) => (s as { construct: string }).construct);
    expect(constructs).toContain("merge");
    expect(constructs).toContain("load-data");
    expect(constructs).toContain("create-table");
    expect(constructs).toContain("create-view");
    expect(constructs).toContain("create-database");
    expect(constructs).toContain("explain");
  });

  it("keeps PIVOT / UNPIVOT / VALUES / range() / TRANSFORM out of selectStatement", () => {
    const unsupportedConstructs = result.file.statements
      .filter((s) => s.kind === "unsupportedStatement")
      .map((s) => (s as { construct: string }).construct);
    expect(unsupportedConstructs).toContain("pivot");
    expect(unsupportedConstructs).toContain("unpivot");
    expect(unsupportedConstructs).toContain("values-inline-table");
    expect(unsupportedConstructs).toContain("table-function");
    expect(unsupportedConstructs).toContain("transform");
    expect(unsupportedConstructs).toContain("insert-values");
  });
});

describe("golden-pending spark fixtures parse as supported statements", () => {
  const dirs = listDirs(SPARK_FIXTURES);

  it("finds the fixture corpus", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)("%s → VALID_SUPPORTED", (name) => {
    const sql = readFileSync(join(SPARK_FIXTURES, name, "expected.sql"), "utf8");
    expectLossless(sql);
    const result = parseSql(sql);
    for (const stmt of result.file.statements) {
      expect(["unsupportedStatement", "unknownStatement"]).not.toContain(stmt.kind);
    }
    expect(analyzeCoverage(result).state).toBe("VALID_SUPPORTED");
  });

  it("gives each fixture its expected statement kind", () => {
    const expectedKind: Record<string, string> = {
      "05-1-cte-chain-with-window-rank": "selectStatement",
      "04-1-inner-join-with-compound-on": "selectStatement",
      "07-2-named-window-clause": "selectStatement",
      "08-1-union-all-three-way": "selectStatement",
      "09-1-lateral-view-posexplode": "selectStatement",
      "13-1-insert-overwrite-partition": "insertStatement",
      "16-3-templated-insert-overwrite": "insertStatement",
      "13-2-multi-insert-from": "multiInsertStatement",
    };
    for (const [name, kind] of Object.entries(expectedKind)) {
      const sql = readFileSync(join(SPARK_FIXTURES, name, "expected.sql"), "utf8");
      const stmts = parseSql(sql).file.statements;
      expect(stmts.length, name).toBe(1);
      expect(stmts[0]?.kind, name).toBe(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Unsupported fixtures
// ---------------------------------------------------------------------------

describe("fixtures/unsupported", () => {
  const files = listSqlFiles(UNSUPPORTED_FIXTURES);

  it("finds the fixture corpus", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is never VALID_SUPPORTED", (name) => {
    const sql = readFileSync(join(UNSUPPORTED_FIXTURES, name), "utf8");
    const state = stateOf(sql);
    expect(["VALID_UNSUPPORTED", "UNKNOWN"]).toContain(state);
  });

  it.each(["grouping-sets.sql", "rollup.sql", "cube.sql"])(
    "%s stays a select statement carrying an UnsupportedExpr",
    (name) => {
      const sql = readFileSync(join(UNSUPPORTED_FIXTURES, name), "utf8");
      const stmt = parseOne(sql);
      const spec = querySpecOf(stmt);
      const item = spec.groupBy?.items[0];
      expect(item?.kind).toBe("unsupportedExpr");
      expect(stateOf(sql)).toBe("VALID_UNSUPPORTED");
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Grammar shape unit tests
// ---------------------------------------------------------------------------

describe("boolean chains", () => {
  it("parses Hive's `!` logical negation like NOT", () => {
    const sql = "select 1 from t where a = 1 and ! (b = 0 and c = 0);";
    const spec = querySpecOf(parseOne(sql));
    const cond = spec.where?.condition as BooleanChain;
    expect(cond.kind).toBe("booleanChain");
    const neg = cond.operands[1] as Extract<Expr, { kind: "not" }>;
    expect(neg.kind).toBe("not");
    expect(neg.notToken.text).toBe("!");
    expect(neg.operand.kind).toBe("paren");
    expectLossless(sql);
  });

  it("flattens `a and b and c` into a single 3-operand chain", () => {
    const spec = querySpecOf(parseOne("select 1 from t where a = 1 and b = 2 and c = 3;"));
    const cond = spec.where?.condition as BooleanChain;
    expect(cond.kind).toBe("booleanChain");
    expect(cond.op).toBe("and");
    expect(cond.operands.length).toBe(3);
    expect(cond.opTokens.length).toBe(2);
  });

  it("keeps OR-of-ANDs nested and preserves parentheses as ParenExpr operands", () => {
    const spec = querySpecOf(parseOne("select 1 from t where a and (b or c) and d;"));
    const cond = spec.where?.condition as BooleanChain;
    expect(cond.op).toBe("and");
    expect(cond.operands.length).toBe(3);
    const paren = cond.operands[1];
    expect(paren?.kind).toBe("paren");
    const inner = (paren as { inner: Expr }).inner as BooleanChain;
    expect(inner.kind).toBe("booleanChain");
    expect(inner.op).toBe("or");
    expect(inner.operands.length).toBe(2);
  });

  it("makes a top-level OR the outer chain", () => {
    const spec = querySpecOf(parseOne("select 1 from t where a and b or c;"));
    const cond = spec.where?.condition as BooleanChain;
    expect(cond.op).toBe("or");
    expect(cond.operands.length).toBe(2);
    expect(cond.operands[0]?.kind).toBe("booleanChain");
  });
});

describe("predicates", () => {
  it("binds the AND inside BETWEEN to the between node", () => {
    const spec = querySpecOf(parseOne("select 1 from t where dt between 'a' and 'b' and x = 1;"));
    const cond = spec.where?.condition as BooleanChain;
    expect(cond.kind).toBe("booleanChain");
    expect(cond.op).toBe("and");
    expect(cond.operands.length).toBe(2);
    const between = cond.operands[0] as BetweenExpr;
    expect(between.kind).toBe("between");
    expect(between.andToken.upper).toBe("AND");
    expect(between.high.kind).toBe("literal");
  });

  it("supports NOT BETWEEN and NOT IN", () => {
    const notBetween = firstItemExpr("select a not between 1 and 2 from t;") as BetweenExpr;
    expect(notBetween.kind).toBe("between");
    expect(notBetween.notToken?.upper).toBe("NOT");

    const notIn = firstItemExpr("select a not in (1, 2) from t;");
    expect(notIn.kind).toBe("in");
    expect((notIn as { notToken?: Token }).notToken?.upper).toBe("NOT");
  });

  it("models `is not null`", () => {
    const expr = firstItemExpr("select a is not null from t;") as IsExpr;
    expect(expr.kind).toBe("is");
    expect(expr.opTokens.map((t) => t.upper)).toEqual(["IS", "NOT", "NULL"]);
  });

  it("models `not exists (subquery)` as an ExistsExpr with a notToken", () => {
    const spec = querySpecOf(parseOne("select 1 from t where not exists (select 1 from u);"));
    const cond = spec.where?.condition;
    expect(cond?.kind).toBe("exists");
    expect((cond as { notToken?: Token }).notToken?.upper).toBe("NOT");
    expect((cond as { query: { kind: string } }).query.kind).toBe("querySpec");
  });

  it("models a bare NOT as NotExpr", () => {
    const spec = querySpecOf(parseOne("select 1 from t where not (a = 1 or b = 2);"));
    const cond = spec.where?.condition as NotExpr;
    expect(cond.kind).toBe("not");
    expect(cond.operand.kind).toBe("paren");
  });

  it("supports IN with a subquery", () => {
    const expr = firstItemExpr("select a in (select b from u) from t;");
    expect(expr.kind).toBe("in");
    expect((expr as { subquery?: { kind: string } }).subquery?.kind).toBe("querySpec");
  });
});

describe("CASE", () => {
  it("detects the simple-CASE operand", () => {
    const expr = firstItemExpr(
      "select case order_status when 'paid' then 1 else 0 end from t;",
    ) as CaseExpr;
    expect(expr.kind).toBe("case");
    expect(expr.operand?.kind).toBe("name");
    expect(expr.whens.length).toBe(1);
    expect(expr.elseArm?.elseToken.upper).toBe("ELSE");
    expect(expr.endToken.upper).toBe("END");
  });

  it("leaves the operand absent for a searched CASE", () => {
    const expr = firstItemExpr("select case when a = 1 then 1 when a = 2 then 2 end from t;") as CaseExpr;
    expect(expr.operand).toBeUndefined();
    expect(expr.whens.length).toBe(2);
    expect(expr.elseArm).toBeUndefined();
  });

  it("nests CASE inside CASE", () => {
    const expr = firstItemExpr(
      "select case when a then case when b then 1 else 2 end else 3 end from t;",
    ) as CaseExpr;
    expect(expr.whens[0]?.result.kind).toBe("case");
  });
});

describe("SET statements", () => {
  it("splits key and value at the first top-level `=`", () => {
    const stmt = parseOne("set hive.exec.dynamic.partition.mode = nonstrict;") as SetStatement;
    expect(stmt.kind).toBe("setStatement");
    expect(stmt.keyTokens.map((t) => t.text).join("")).toBe("hive.exec.dynamic.partition.mode");
    expect(stmt.eq?.text).toBe("=");
    expect(stmt.valueTokens.map((t) => t.text)).toEqual(["nonstrict"]);
  });

  it("keeps commas and templates in the raw value run", () => {
    const stmt = parseOne("set path = system_path, current_schema;") as SetStatement;
    expect(stmt.valueTokens.map((t) => t.text)).toEqual(["system_path", ",", "current_schema"]);

    const templated = parseOne("set job.run_date = ${hiveconf:run_date};") as SetStatement;
    expect(templated.valueTokens.length).toBe(1);
    expect(templated.valueTokens[0]?.kind).toBe("template");
  });

  it("handles `set;`, `set -v;` and `set a.b.c;`", () => {
    const bare = parseOne("set;") as SetStatement;
    expect(bare.keyTokens).toEqual([]);
    expect(bare.eq).toBeUndefined();

    const verbose = parseOne("set -v;") as SetStatement;
    expect(verbose.keyTokens.map((t) => t.text)).toEqual(["-", "v"]);

    const keyOnly = parseOne("set spark.sql.ansi.enabled;") as SetStatement;
    expect(keyOnly.eq).toBeUndefined();
    expect(keyOnly.valueTokens).toEqual([]);
  });
});

describe("INSERT and multi-insert", () => {
  it("models insert overwrite + partition + select source", () => {
    const stmt = parseOne(
      "insert overwrite table db.t partition (dt = '2026-08-19') select a from s;",
    ) as InsertStatement;
    expect(stmt.kind).toBe("insertStatement");
    expect(stmt.introTokens.map((t) => t.upper)).toEqual(["INSERT", "OVERWRITE", "TABLE"]);
    expect(stmt.table.nameTokens.map((t) => t.text).join("")).toBe("db.t");
    expect(stmt.partition?.entries.length).toBe(1);
    expect(stmt.partition?.entries[0]?.map((t) => t.text)).toEqual(["dt", "=", "'2026-08-19'"]);
    expect(stmt.source.kind).toBe("selectStatement");
  });

  it("splits multi-entry partition specs on top-level commas", () => {
    const stmt = parseOne(
      "insert into table t partition (dt = '1', region) select a from s;",
    ) as InsertStatement;
    expect(stmt.partition?.entries.length).toBe(2);
    expect(stmt.partition?.commas.length).toBe(1);
    expect(stmt.partition?.entries[1]?.map((t) => t.text)).toEqual(["region"]);
  });

  it("attaches a leading CTE list to the insert (with ... insert overwrite)", () => {
    const sql =
      "with u as (select order_id from s group by order_id) " +
      "insert overwrite table db.t partition (dt = '${hiveconf:month}') select order_id from u;";
    const stmt = parseOne(sql) as InsertStatement;
    expect(stmt.kind).toBe("insertStatement");
    expect(stmt.with?.ctes.length).toBe(1);
    expect(stmt.with?.ctes[0]?.name.text).toBe("u");
    expect(stmt.introTokens.map((t) => t.upper)).toEqual(["INSERT", "OVERWRITE", "TABLE"]);
    expect(stmt.source.kind).toBe("selectStatement");
    expectLossless(sql);
  });

  it("models the Hive multi-insert shape", () => {
    const sql = readFileSync(join(SPARK_FIXTURES, "13-2-multi-insert-from/expected.sql"), "utf8");
    const stmt = parseOne(sql) as MultiInsertStatement;
    expect(stmt.kind).toBe("multiInsertStatement");
    expect(stmt.fromToken.upper).toBe("FROM");
    expect(stmt.relation.kind).toBe("tableRef");
    expect(stmt.inserts.length).toBe(2);
    for (const branch of stmt.inserts) {
      expect(branch.introTokens.map((t) => t.upper)).toEqual(["INSERT", "OVERWRITE", "TABLE"]);
      expect(branch.partition?.entries.length).toBe(1);
      expect(branch.body.kind).toBe("querySpec");
      // Multi-insert branches never carry their own FROM.
      expect(branch.body.from).toBeUndefined();
      expect(branch.body.where).toBeDefined();
      expect(branch.body.groupBy).toBeDefined();
    }
  });
});

describe("misc expression shapes", () => {
  it("parses single-parameter and parenthesized lambdas", () => {
    const single = firstItemExpr("select transform(items, item -> item.sku_id) from t;") as FunctionCall;
    expect(single.kind).toBe("functionCall");
    const lambda = single.args[1] as LambdaExpr;
    expect(lambda.kind).toBe("lambda");
    expect(lambda.paramTokens.map((t) => t.text)).toEqual(["item"]);
    expect(lambda.arrowToken.text).toBe("->");
    expect(lambda.body.kind).toBe("name");

    const multi = firstItemExpr("select aggregate(x, 0, (a, b) -> a + b) from t;") as FunctionCall;
    const pair = multi.args[2] as LambdaExpr;
    expect(pair.kind).toBe("lambda");
    expect(pair.paramTokens.map((t) => t.text)).toEqual(["(", "a", ",", "b", ")"]);
    expect(pair.body.kind).toBe("binary");
  });

  it("attaches OVER, FILTER and DISTINCT to function calls", () => {
    const windowed = firstItemExpr(
      "select row_number() over (partition by a order by b desc) from t;",
    ) as FunctionCall;
    expect(windowed.over?.spec?.partitionBy?.items.length).toBe(1);
    expect(windowed.over?.spec?.orderBy?.items[0]?.direction?.upper).toBe("DESC");

    const named = firstItemExpr("select sum(a) over w from t;") as FunctionCall;
    expect(named.over?.windowName?.text).toBe("w");

    const filtered = firstItemExpr("select sum(a) filter (where b = 1) from t;") as FunctionCall;
    expect(filtered.filterTokens?.[0]?.upper).toBe("FILTER");

    const distinct = firstItemExpr("select count(distinct a) from t;") as FunctionCall;
    expect(distinct.distinct?.upper).toBe("DISTINCT");

    const star = firstItemExpr("select count(*) from t;") as FunctionCall;
    expect(star.args[0]?.kind).toBe("star");
  });

  it("parses two-token date/timestamp literals and interval literals", () => {
    const spec = querySpecOf(
      parseOne("select date '2026-08-19' as d, interval 7 days as i, null as n;"),
    );
    expect(spec.items[0]?.expr.kind).toBe("literal");
    expect((spec.items[0]?.expr as { tokens: Token[] }).tokens.map((t) => t.text)).toEqual([
      "date",
      "'2026-08-19'",
    ]);
    expect(spec.items[1]?.expr.kind).toBe("interval");
    expect((spec.items[1]?.expr as { tokens: Token[] }).tokens.map((t) => t.text)).toEqual([
      "interval",
      "7",
      "days",
    ]);
    expect(spec.items[1]?.alias?.text).toBe("i");
  });

  it("keeps CAST target types raw, including nested generics", () => {
    const expr = firstItemExpr("select cast(a as decimal(18, 2)) from t;");
    expect(expr.kind).toBe("cast");
    expect((expr as { typeTokens: Token[] }).typeTokens.map((t) => t.text).join("")).toBe(
      "decimal(18,2)",
    );
  });

  it("supports bare and explicit select aliases", () => {
    const spec = querySpecOf(parseOne("select a x, b as y from t;"));
    expect(spec.items[0]?.asToken).toBeUndefined();
    expect(spec.items[0]?.alias?.text).toBe("x");
    expect(spec.items[1]?.asToken?.upper).toBe("AS");
    expect(spec.items[1]?.alias?.text).toBe("y");
  });

  it("accepts non-reserved keywords as explicit AS aliases, rejects structural ones", () => {
    const sql = "select a as comment, b as type from t;";
    const spec = querySpecOf(parseOne(sql));
    expect(spec.items[0]?.alias?.text).toBe("comment");
    expect(spec.items[1]?.alias?.text).toBe("type");
    expectLossless(sql);
    // A structural stop keyword after AS is still a missing alias → UNKNOWN.
    const bad = parse(lex("select a as from t;", HIVE_110).tokens, HIVE_110);
    expect(bad.file.statements[0]?.kind).toBe("unknownStatement");
  });

  it("flattens set operations left-assoc into first + rest", () => {
    const stmt = parseOne(
      "select a from t union all select a from u union all select a from v;",
    ) as SelectStatement;
    const body = stmt.body as { kind: string; first: unknown; rest: { opTokens: Token[] }[] };
    expect(body.kind).toBe("setOperation");
    expect(body.rest.length).toBe(2);
    expect(body.rest[0]?.opTokens.map((t) => t.upper)).toEqual(["UNION", "ALL"]);
  });

  it("models joins with ON and USING", () => {
    const onSpec = querySpecOf(parseOne("select 1 from a inner join b on a.id = b.id;"));
    const join = onSpec.from?.relation as { kind: string; joins: { joinTokens: Token[] }[] };
    expect(join.kind).toBe("joinRelation");
    expect(join.joins[0]?.joinTokens.map((t) => t.upper)).toEqual(["INNER", "JOIN"]);

    const usingSpec = querySpecOf(parseOne("select 1 from a left semi join b using (id, dt);"));
    const semi = usingSpec.from?.relation as {
      joins: { joinTokens: Token[]; using?: { columns: Token[]; commas: Token[] } }[];
    };
    expect(semi.joins[0]?.joinTokens.map((t) => t.upper)).toEqual(["LEFT", "SEMI", "JOIN"]);
    expect(semi.joins[0]?.using?.columns.map((t) => t.text)).toEqual(["id", "dt"]);
    expect(semi.joins[0]?.using?.commas.length).toBe(1);
  });

  it("carries tablesample as a raw tail on the table ref", () => {
    const spec = querySpecOf(parseOne("select 1 from db.t tablesample (10 percent);"));
    const ref = spec.from?.relation as { kind: string; sampleTokens?: Token[] };
    expect(ref.kind).toBe("tableRef");
    expect(ref.sampleTokens?.map((t) => t.text)).toEqual(["tablesample", "(", "10", "percent", ")"]);
  });

  it("models lateral view column aliases", () => {
    const spec = querySpecOf(
      parseOne("select 1 from t lateral view posexplode(x) v as pos, item where a = 1;"),
    );
    expect(spec.lateralViews.length).toBe(1);
    const view = spec.lateralViews[0];
    expect(view?.introTokens.map((t) => t.upper)).toEqual(["LATERAL", "VIEW"]);
    expect(view?.fn.nameTokens[0]?.text).toBe("posexplode");
    expect(view?.tableAlias?.text).toBe("v");
    expect(view?.columnAliases.map((t) => t.text)).toEqual(["pos", "item"]);
    expect(spec.where).toBeDefined();
  });

  it("treats postfix member access on a call result as a dotted binary chain", () => {
    const expr = firstItemExpr("select from_json(a, 'x').order.items from t;");
    expect(expr.kind).toBe("binary");
    const outer = expr as { left: Expr; opTokens: Token[]; right: Expr };
    expect(outer.opTokens[0]?.kind).toBe("dot");
    expect(outer.left.kind).toBe("binary");
  });
});
