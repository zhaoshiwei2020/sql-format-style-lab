/**
 * Tolerant lossless parser for the first-batch Hive layout grammar.
 * Implementation contract: see cst.ts. OWNER: parser implementation task.
 * Do not change exported signatures.
 *
 * Design notes
 * ------------
 * - The parser NEVER throws and NEVER reports PAR001/INVALID. It is not a
 *   complete dialect parser, so anything it cannot confidently shape into typed
 *   nodes degrades to `UnknownStatement` (statement-level granularity), and
 *   anything it positively recognizes but deliberately does not model degrades
 *   to `UnsupportedStatement` / `UnsupportedExpr` (ARCHITECTURE.md §4.7, §7.2).
 * - Recovery works by *aborting* the current statement: an internal
 *   `ParseAbort` unwinds to the statement dispatcher, which re-emits the whole
 *   statement's token slice verbatim. That keeps losslessness trivially true —
 *   every token of a statement ends up either in typed fields or in one raw
 *   `tokens` array, exactly once.
 * - Keywords are kept as Tokens everywhere; nothing is synthesized or dropped.
 */

import type { Dialect, Token, TokenKind } from "./tokens.js";
import type {
  ByClause,
  CaseExpr,
  CastExpr,
  Cte,
  Expr,
  FromClause,
  FunctionCall,
  GenericStatement,
  GroupByClause,
  InsertStatement,
  JoinPart,
  LateralView,
  LimitClause,
  MultiInsertBranch,
  MultiInsertStatement,
  OrderByClause,
  OrderItem,
  OverClause,
  ParseResult,
  PartitionSpec,
  QueryExpr,
  QuerySpec,
  Relation,
  SelectItem,
  SelectStatement,
  SetStatement,
  SqlFile,
  StatementNode,
  SubqueryRelation,
  TableRef,
  WhenArm,
  WindowClause,
  WindowSpec,
  WithClause,
} from "./cst.js";

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

/** Statement openers recognized but deliberately out of printer scope. */
const UNSUPPORTED_OPENERS: ReadonlyMap<string, string> = new Map([
  ["CREATE", "create"],
  ["DROP", "drop"],
  ["ALTER", "alter"],
  ["TRUNCATE", "truncate"],
  ["MERGE", "merge"],
  ["UPDATE", "update"],
  ["DELETE", "delete"],
  ["LOAD", "load-data"],
  ["SHOW", "show"],
  ["DESCRIBE", "describe"],
  ["DESC", "describe"],
  ["EXPLAIN", "explain"],
  ["ANALYZE", "analyze"],
  ["MSCK", "msck"],
  ["REPAIR", "repair"],
  ["CACHE", "cache"],
  ["UNCACHE", "uncache"],
  ["CLEAR", "clear"],
  ["DECLARE", "declare"],
  ["BEGIN", "begin"],
  ["GRANT", "grant"],
  ["REVOKE", "revoke"],
]);

/** Object keywords used to refine `create` / `drop` / `alter` construct names. */
const DDL_OBJECTS: ReadonlySet<string> = new Set([
  "TABLE",
  "VIEW",
  "DATABASE",
  "SCHEMA",
  "FUNCTION",
  "INDEX",
  "MACRO",
  "ROLE",
]);

const SET_OPERATORS: ReadonlySet<string> = new Set(["UNION", "INTERSECT", "EXCEPT", "MINUS"]);

const JOIN_MODIFIERS: ReadonlySet<string> = new Set([
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "NATURAL",
  "SEMI",
  "ANTI",
]);

const COMPARISON_OPS: ReadonlySet<string> = new Set([
  "=",
  "==",
  "<>",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "<=>",
]);

const ADDITIVE_OPS: ReadonlySet<string> = new Set(["+", "-", "||"]);
const MULTIPLICATIVE_OPS: ReadonlySet<string> = new Set(["*", "/", "%"]);
const UNARY_OPS: ReadonlySet<string> = new Set(["-", "+", "~"]);
const LIKE_OPS: ReadonlySet<string> = new Set(["LIKE", "RLIKE", "REGEXP"]);
const IS_TAILS: ReadonlySet<string> = new Set(["NULL", "TRUE", "FALSE", "UNKNOWN"]);

/** Words that may follow `interval` while still belonging to the literal. */
const INTERVAL_UNITS: ReadonlySet<string> = new Set([
  "TO",
  "YEAR",
  "YEARS",
  "MONTH",
  "MONTHS",
  "WEEK",
  "WEEKS",
  "DAY",
  "DAYS",
  "HOUR",
  "HOURS",
  "MINUTE",
  "MINUTES",
  "SECOND",
  "SECONDS",
  "MILLISECOND",
  "MILLISECONDS",
  "MICROSECOND",
  "MICROSECONDS",
  "NANOSECOND",
  "NANOSECONDS",
]);

/**
 * Keywords that may never stand in for a bare column name. Everything NOT in
 * this set (`items`, `data`, `comment`, `percent`, ...) is a Hive non-reserved
 * word that real scripts do use as an identifier, so the parser accepts it as a
 * NameExpr head. Only the structural words below must terminate an expression,
 * otherwise clause detection would swallow `from` / `where` / `then` / ... .
 */
const EXPR_STOP_KEYWORDS: ReadonlySet<string> = new Set([
  // statement & clause structure
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "WINDOW", "QUALIFY",
  "ORDER", "SORT", "CLUSTER", "DISTRIBUTE", "LIMIT", "OFFSET", "LATERAL",
  "VIEW", "UNION", "INTERSECT", "EXCEPT", "MINUS", "WITH", "INSERT", "INTO",
  "OVERWRITE", "VALUES", "TABLE", "SET", "UPDATE", "DELETE", "MERGE", "CREATE",
  "DROP", "ALTER", "TRUNCATE", "LOAD", "SHOW", "DESCRIBE", "EXPLAIN",
  "ANALYZE", "USE", "RESET", "CACHE", "UNCACHE", "CLEAR", "DECLARE", "BEGIN",
  "GRANT", "REVOKE", "MSCK", "REPAIR", "TABLESAMPLE",
  // joins
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "NATURAL",
  "SEMI", "ANTI", "ON", "USING",
  // predicates and operators
  "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "RLIKE", "REGEXP",
  "IS", "DIV",
  // case
  "CASE", "WHEN", "THEN", "ELSE", "END",
  // modifiers
  "AS", "DISTINCT", "ALL", "ASC", "DESC", "NULLS",
  // windows / grouping
  "OVER", "PARTITION", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING", "FOLLOWING",
  "CURRENT", "FILTER", "GROUPING", "SETS", "ROLLUP", "CUBE",
]);

// ---------------------------------------------------------------------------
// Internal control flow
// ---------------------------------------------------------------------------

/**
 * Thrown internally to bail out of the current statement.
 * `construct === undefined` → UnknownStatement, otherwise UnsupportedStatement.
 */
class ParseAbort extends Error {
  readonly construct?: string;

  constructor(reason: string, construct?: string) {
    super(reason);
    this.name = "ParseAbort";
    if (construct !== undefined) this.construct = construct;
  }
}

function abort(reason: string): never {
  throw new ParseAbort(reason);
}

function unsupported(construct: string): never {
  throw new ParseAbort(`unsupported construct: ${construct}`, construct);
}

// ---------------------------------------------------------------------------
// Statement splitting
// ---------------------------------------------------------------------------

interface RawStatement {
  tokens: Token[];
  semicolon?: Token;
}

/** Split on semicolons that sit at paren depth 0. */
function splitStatements(tokens: Token[]): RawStatement[] {
  const out: RawStatement[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    if (t.kind === "lparen") depth++;
    else if (t.kind === "rparen") {
      if (depth > 0) depth--;
    } else if (t.kind === "semicolon" && depth === 0) {
      out.push({ tokens: tokens.slice(start, i), semicolon: t });
      start = i + 1;
    }
  }
  if (start < tokens.length) out.push({ tokens: tokens.slice(start) });
  return out;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class StatementParser {
  private readonly toks: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.toks = tokens;
  }

  // --- cursor primitives ---------------------------------------------------

  private peek(offset = 0): Token | undefined {
    return this.toks[this.pos + offset];
  }

  private upperAt(offset = 0): string | undefined {
    return this.toks[this.pos + offset]?.upper;
  }

  private kindAt(offset = 0): TokenKind | undefined {
    return this.toks[this.pos + offset]?.kind;
  }

  private atEnd(): boolean {
    return this.pos >= this.toks.length;
  }

  private next(): Token {
    const t = this.toks[this.pos];
    if (t === undefined) abort("unexpected end of statement");
    this.pos++;
    return t;
  }

  private expectUpper(upper: string): Token {
    const t = this.peek();
    if (t === undefined || t.upper !== upper) abort(`expected ${upper}`);
    this.pos++;
    return t;
  }

  private expectKind(kind: TokenKind, what: string): Token {
    const t = this.peek();
    if (t === undefined || t.kind !== kind) abort(`expected ${what}`);
    this.pos++;
    return t;
  }

  /** Index of the token after the `)` matching the `(` at `from`. */
  private matchParen(from: number): number {
    let depth = 0;
    for (let i = from; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t === undefined) break;
      if (t.kind === "lparen") depth++;
      else if (t.kind === "rparen") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  /** Consume a balanced `( ... )` run starting at the cursor, returning it raw. */
  private takeBalancedParens(): Token[] {
    const end = this.matchParen(this.pos);
    if (end === -1) abort("unbalanced parentheses");
    const run = this.toks.slice(this.pos, end);
    this.pos = end;
    return run;
  }

  /** Consume raw tokens up to (not including) the `)` closing the current group. */
  private takeUntilGroupEnd(): Token[] {
    const start = this.pos;
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.peek();
      if (t === undefined) break;
      if (t.kind === "lparen") depth++;
      else if (t.kind === "rparen") {
        if (depth === 0) break;
        depth--;
      }
      this.pos++;
    }
    return this.toks.slice(start, this.pos);
  }

  // --- statement dispatch --------------------------------------------------

  parseStatement(): StatementNode {
    const first = this.peek();
    if (first === undefined) abort("empty statement");

    const construct = UNSUPPORTED_OPENERS.get(first.upper);
    if (construct !== undefined) unsupported(this.refineDdlConstruct(construct));

    let node: StatementNode;
    switch (first.upper) {
      case "SET":
        node = this.parseSet();
        break;
      case "USE":
      case "ADD":
      case "RESET":
      case "LIST":
      case "REFRESH":
        node = this.parseGeneric();
        break;
      case "SELECT":
      case "WITH":
        node = this.parseSelectStatement();
        break;
      case "INSERT":
        node = this.parseInsert();
        break;
      case "FROM":
        node = this.parseMultiInsert();
        break;
      default:
        if (first.kind === "lparen") {
          node = this.parseSelectStatement();
          break;
        }
        abort(`unrecognized statement opener "${first.text}"`);
    }

    if (!this.atEnd()) abort(`unconsumed tokens after statement at "${this.peek()?.text ?? ""}"`);
    return node;
  }

  /** `create table ...` → "create-table"; falls back to the bare opener. */
  private refineDdlConstruct(base: string): string {
    if (base !== "create" && base !== "drop" && base !== "alter") return base;
    const limit = Math.min(this.toks.length, 6);
    for (let i = 1; i < limit; i++) {
      const u = this.toks[i]?.upper;
      if (u !== undefined && DDL_OBJECTS.has(u)) return `${base}-${u.toLowerCase()}`;
    }
    return base;
  }

  // --- SET / generic -------------------------------------------------------

  private parseSet(): SetStatement {
    const setToken = this.expectUpper("SET");
    // Split at the first `=` that sits outside parentheses.
    let eqIndex = -1;
    let depth = 0;
    for (let i = this.pos; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t === undefined) continue;
      if (t.kind === "lparen") depth++;
      else if (t.kind === "rparen") depth--;
      else if (depth === 0 && t.kind === "operator" && t.text === "=") {
        eqIndex = i;
        break;
      }
    }
    if (eqIndex === -1) {
      const keyTokens = this.toks.slice(this.pos);
      this.pos = this.toks.length;
      return { kind: "setStatement", setToken, keyTokens, valueTokens: [] };
    }
    const keyTokens = this.toks.slice(this.pos, eqIndex);
    const eq = this.toks[eqIndex];
    if (eq === undefined) abort("missing = in set statement");
    const valueTokens = this.toks.slice(eqIndex + 1);
    this.pos = this.toks.length;
    return { kind: "setStatement", setToken, keyTokens, eq, valueTokens };
  }

  private parseGeneric(): GenericStatement {
    const tokens = this.toks.slice(this.pos);
    this.pos = this.toks.length;
    return { kind: "genericStatement", tokens };
  }

  // --- SELECT --------------------------------------------------------------

  private parseSelectStatement(): SelectStatement {
    const withClause = this.upperAt() === "WITH" ? this.parseWith() : undefined;
    const body = this.parseQueryExpr();
    return withClause === undefined
      ? { kind: "selectStatement", body }
      : { kind: "selectStatement", with: withClause, body };
  }

  private parseWith(): WithClause {
    const withToken = this.expectUpper("WITH");
    if (this.upperAt() === "RECURSIVE") unsupported("recursive-cte");
    const ctes: Cte[] = [];
    const commas: Token[] = [];
    for (;;) {
      ctes.push(this.parseCte());
      if (this.kindAt() === "comma") {
        commas.push(this.next());
        continue;
      }
      break;
    }
    return { withToken, ctes, commas };
  }

  private parseCte(): Cte {
    const nameTok = this.peek();
    if (
      nameTok === undefined ||
      (nameTok.kind !== "identifier" && nameTok.kind !== "quotedIdentifier")
    ) {
      abort("expected CTE name");
    }
    const name = this.next();
    const asToken = this.expectUpper("AS");
    const lparen = this.expectKind("lparen", "( after CTE name");
    const query = this.parseQueryExpr();
    const rparen = this.expectKind("rparen", ") closing CTE");
    return { name, asToken, lparen, query, rparen };
  }

  private parseQueryExpr(): QueryExpr {
    let first: QueryExpr = this.parseQueryPrimary();
    const rest: { opTokens: Token[]; query: QueryExpr }[] = [];
    for (;;) {
      const u = this.upperAt();
      if (u === undefined || !SET_OPERATORS.has(u)) break;
      const opTokens: Token[] = [this.next()];
      const modifier = this.upperAt();
      if (modifier === "ALL" || modifier === "DISTINCT") opTokens.push(this.next());
      rest.push({ opTokens, query: this.parseQueryPrimary() });
    }
    if (rest.length === 0) return first;
    return { kind: "setOperation", first, rest };
  }

  private parseQueryPrimary(): QueryExpr {
    if (this.kindAt() === "lparen") {
      const lparen = this.next();
      const query = this.parseQueryExpr();
      const rparen = this.expectKind("rparen", ") closing parenthesized query");
      return { kind: "parenQuery", lparen, query, rparen };
    }
    return this.parseQuerySpec();
  }

  private parseQuerySpec(): QuerySpec {
    const selectToken = this.expectUpper("SELECT");

    // `select transform ( ... ) using '...'` is the Hive TRANSFORM form; a plain
    // `transform(items, x -> ...)` call is an ordinary higher-order function.
    const head = this.upperAt();
    if ((head === "TRANSFORM" || head === "REDUCE") && this.kindAt(1) === "lparen") {
      const after = this.matchParen(this.pos + 1);
      if (after !== -1 && this.toks[after]?.upper === "USING") unsupported("transform");
    }

    let distinct: Token | undefined;
    const quantifier = this.upperAt();
    if (quantifier === "DISTINCT" || quantifier === "ALL") distinct = this.next();

    const items: SelectItem[] = [];
    const itemCommas: Token[] = [];
    for (;;) {
      items.push(this.parseSelectItem());
      if (this.kindAt() === "comma") {
        itemCommas.push(this.next());
        continue;
      }
      break;
    }

    const spec: QuerySpec = {
      kind: "querySpec",
      selectToken,
      items,
      itemCommas,
      lateralViews: [],
    };
    if (distinct !== undefined) spec.distinct = distinct;

    if (this.upperAt() === "FROM") spec.from = this.parseFromClause();

    this.parseTrailingClauses(spec);
    return spec;
  }

  private parseTrailingClauses(spec: QuerySpec): void {
    for (;;) {
      const u = this.upperAt();
      if (u === undefined) return;
      switch (u) {
        case "LATERAL": {
          if (this.upperAt(1) !== "VIEW") return;
          spec.lateralViews.push(this.parseLateralView());
          continue;
        }
        case "WHERE": {
          if (spec.where !== undefined) return;
          const whereToken = this.next();
          spec.where = { whereToken, condition: this.parseExpr() };
          continue;
        }
        case "GROUP": {
          if (spec.groupBy !== undefined || this.upperAt(1) !== "BY") return;
          spec.groupBy = this.parseGroupBy();
          continue;
        }
        case "HAVING": {
          if (spec.having !== undefined) return;
          const havingToken = this.next();
          spec.having = { havingToken, condition: this.parseExpr() };
          continue;
        }
        case "WINDOW": {
          if (spec.windowClause !== undefined) return;
          spec.windowClause = this.parseWindowClause();
          continue;
        }
        case "QUALIFY": {
          if (spec.qualify !== undefined) return;
          const qualifyToken = this.next();
          spec.qualify = { qualifyToken, condition: this.parseExpr() };
          continue;
        }
        case "ORDER": {
          if (spec.orderBy !== undefined || this.upperAt(1) !== "BY") return;
          spec.orderBy = this.parseOrderByClause();
          continue;
        }
        case "SORT": {
          if (spec.sortBy !== undefined || this.upperAt(1) !== "BY") return;
          spec.sortBy = this.parseOrderByClause();
          continue;
        }
        case "CLUSTER": {
          if (spec.clusterBy !== undefined || this.upperAt(1) !== "BY") return;
          spec.clusterBy = this.parseByClause();
          continue;
        }
        case "DISTRIBUTE": {
          if (spec.distributeBy !== undefined || this.upperAt(1) !== "BY") return;
          spec.distributeBy = this.parseByClause();
          continue;
        }
        case "LIMIT": {
          if (spec.limit !== undefined) return;
          spec.limit = this.parseLimit();
          continue;
        }
        default:
          return;
      }
    }
  }

  private parseSelectItem(): SelectItem {
    const expr = this.parseExpr();
    const item: SelectItem = { expr };
    const t = this.peek();
    if (t?.upper === "AS") {
      item.asToken = this.next();
      const alias = this.peek();
      if (
        alias === undefined ||
        (alias.kind !== "identifier" && alias.kind !== "quotedIdentifier")
      ) {
        abort("expected select alias after AS");
      }
      item.alias = this.next();
    } else if (t !== undefined && (t.kind === "identifier" || t.kind === "quotedIdentifier")) {
      item.alias = this.next();
    }
    return item;
  }

  // --- FROM / relations ----------------------------------------------------

  private parseFromClause(): FromClause {
    const fromToken = this.expectUpper("FROM");
    const relation = this.parseRelation();
    const tail = this.upperAt();
    if (tail === "PIVOT") unsupported("pivot");
    if (tail === "UNPIVOT") unsupported("unpivot");
    return { fromToken, relation };
  }

  private parseRelation(): Relation {
    const first = this.parseRelationPrimary();
    const joins: JoinPart[] = [];
    for (;;) {
      const u = this.upperAt();
      if (u === undefined) break;
      if (u !== "JOIN" && !JOIN_MODIFIERS.has(u)) break;
      joins.push(this.parseJoinPart());
    }
    if (joins.length === 0) return first;
    return { kind: "joinRelation", first, joins };
  }

  private parseJoinPart(): JoinPart {
    const joinTokens: Token[] = [];
    for (;;) {
      const u = this.upperAt();
      if (u === undefined) abort("incomplete join clause");
      if (u === "JOIN") {
        joinTokens.push(this.next());
        break;
      }
      if (!JOIN_MODIFIERS.has(u)) abort("incomplete join clause");
      joinTokens.push(this.next());
    }
    const relation = this.parseRelationPrimary();
    const part: JoinPart = { joinTokens, relation };
    const u = this.upperAt();
    if (u === "ON") {
      const onToken = this.next();
      part.on = { onToken, condition: this.parseExpr() };
    } else if (u === "USING") {
      const usingToken = this.next();
      const lparen = this.expectKind("lparen", "( after USING");
      const columns: Token[] = [];
      const commas: Token[] = [];
      for (;;) {
        const col = this.peek();
        if (col === undefined) abort("unterminated USING column list");
        if (col.kind !== "identifier" && col.kind !== "quotedIdentifier") {
          abort("expected column name in USING list");
        }
        columns.push(this.next());
        if (this.kindAt() === "comma") {
          commas.push(this.next());
          continue;
        }
        break;
      }
      const rparen = this.expectKind("rparen", ") closing USING list");
      part.using = { usingToken, lparen, columns, commas, rparen };
    }
    return part;
  }

  private parseRelationPrimary(): Relation {
    const t = this.peek();
    if (t === undefined) abort("expected a relation");

    if (t.upper === "VALUES") unsupported("values-inline-table");
    if (t.upper === "LATERAL") unsupported("lateral-subquery");

    if (t.kind === "lparen") {
      const lparen = this.next();
      const query = this.parseQueryExpr();
      const rparen = this.expectKind("rparen", ") closing subquery relation");
      const rel: SubqueryRelation = { kind: "subqueryRelation", lparen, query, rparen };
      this.tryRelationAlias(rel);
      return rel;
    }

    if (!this.isNameStart(t) && t.kind !== "keyword") abort("expected a table name");

    const nameTokens = this.parseDottedNameTokens();
    if (this.kindAt() === "lparen") unsupported("table-function");
    const ref: TableRef = { kind: "tableRef", nameTokens };

    for (;;) {
      const u = this.upperAt();
      if (u === "TABLESAMPLE" && this.kindAt(1) === "lparen" && ref.sampleTokens === undefined) {
        const sampleToken = this.next();
        ref.sampleTokens = [sampleToken, ...this.takeBalancedParens()];
        continue;
      }
      if (ref.alias === undefined && this.tryRelationAlias(ref)) continue;
      break;
    }
    return ref;
  }

  /** `as x` or a bare identifier alias. Returns true when one was consumed. */
  private tryRelationAlias(target: { asToken?: Token; alias?: Token }): boolean {
    if (target.alias !== undefined) return false;
    const t = this.peek();
    if (t === undefined) return false;
    if (t.upper === "AS") {
      const asToken = this.next();
      const alias = this.peek();
      if (
        alias === undefined ||
        (alias.kind !== "identifier" && alias.kind !== "quotedIdentifier")
      ) {
        abort("expected relation alias after AS");
      }
      target.asToken = asToken;
      target.alias = this.next();
      return true;
    }
    if (t.kind === "identifier" || t.kind === "quotedIdentifier") {
      target.alias = this.next();
      return true;
    }
    return false;
  }

  private parseLateralView(): LateralView {
    const introTokens: Token[] = [this.expectUpper("LATERAL"), this.expectUpper("VIEW")];
    if (this.upperAt() === "OUTER") introTokens.push(this.next());
    const fn = this.parseFunctionCallNode();
    const view: LateralView = { introTokens, fn, columnAliases: [], columnCommas: [] };

    const aliasTok = this.peek();
    if (
      aliasTok !== undefined &&
      (aliasTok.kind === "identifier" || aliasTok.kind === "quotedIdentifier")
    ) {
      view.tableAlias = this.next();
    }
    if (this.upperAt() === "AS") {
      view.asToken = this.next();
      for (;;) {
        const col = this.peek();
        if (col === undefined) break;
        if (col.kind !== "identifier" && col.kind !== "quotedIdentifier") {
          abort("expected lateral view column alias");
        }
        view.columnAliases.push(this.next());
        if (this.kindAt() === "comma") {
          view.columnCommas.push(this.next());
          continue;
        }
        break;
      }
    }
    return view;
  }

  // --- clause helpers ------------------------------------------------------

  private parseGroupBy(): GroupByClause {
    const groupToken = this.expectUpper("GROUP");
    const byToken = this.expectUpper("BY");
    const items: Expr[] = [];
    const commas: Token[] = [];

    const head = this.upperAt();
    if (head === "GROUPING" || head === "ROLLUP" || head === "CUBE") {
      const start = this.pos;
      let construct = head.toLowerCase();
      this.next();
      if (head === "GROUPING" && this.upperAt() === "SETS") {
        this.next();
        construct = "grouping-sets";
      }
      if (this.kindAt() === "lparen") this.takeBalancedParens();
      items.push({
        kind: "unsupportedExpr",
        construct,
        tokens: this.toks.slice(start, this.pos),
      });
      return { groupToken, byToken, items, commas };
    }

    for (;;) {
      items.push(this.parseExpr());
      if (this.kindAt() === "comma") {
        commas.push(this.next());
        continue;
      }
      break;
    }
    return { groupToken, byToken, items, commas };
  }

  private parseWindowClause(): WindowClause {
    const windowToken = this.expectUpper("WINDOW");
    const definitions: { name: Token; asToken: Token; spec: WindowSpec }[] = [];
    const commas: Token[] = [];
    for (;;) {
      const nameTok = this.peek();
      if (
        nameTok === undefined ||
        (nameTok.kind !== "identifier" && nameTok.kind !== "quotedIdentifier")
      ) {
        abort("expected named window identifier");
      }
      const name = this.next();
      const asToken = this.expectUpper("AS");
      const spec = this.parseWindowSpec();
      definitions.push({ name, asToken, spec });
      if (this.kindAt() === "comma") {
        commas.push(this.next());
        continue;
      }
      break;
    }
    return { windowToken, definitions, commas };
  }

  private parseWindowSpec(): WindowSpec {
    const lparen = this.expectKind("lparen", "( starting a window specification");
    const spec: Partial<WindowSpec> = { lparen };

    if (this.upperAt() === "PARTITION" && this.upperAt(1) === "BY") {
      const introTokens = [this.next(), this.next()];
      const partItems: Expr[] = [];
      const partCommas: Token[] = [];
      for (;;) {
        partItems.push(this.parseExpr());
        if (this.kindAt() === "comma") {
          partCommas.push(this.next());
          continue;
        }
        break;
      }
      spec.partitionBy = { introTokens, items: partItems, commas: partCommas };
    }

    if (this.upperAt() === "ORDER" && this.upperAt(1) === "BY") {
      spec.orderBy = this.parseOrderByClause();
    }

    const frameHead = this.upperAt();
    if (frameHead === "ROWS" || frameHead === "RANGE") {
      spec.frameTokens = this.takeUntilGroupEnd();
    }

    const rparen = this.expectKind("rparen", ") closing a window specification");
    return { ...(spec as WindowSpec), lparen, rparen };
  }

  private parseOrderByClause(): OrderByClause {
    const introTokens: Token[] = [this.next(), this.expectUpper("BY")];
    const items: OrderItem[] = [];
    const commas: Token[] = [];
    for (;;) {
      const expr = this.parseExpr();
      const item: OrderItem = { expr };
      const dir = this.upperAt();
      if (dir === "ASC" || dir === "DESC") item.direction = this.next();
      if (this.upperAt() === "NULLS") {
        const nullsToken = this.next();
        const which = this.upperAt();
        if (which !== "FIRST" && which !== "LAST") abort("expected FIRST or LAST after NULLS");
        item.nulls = [nullsToken, this.next()];
      }
      items.push(item);
      if (this.kindAt() === "comma") {
        commas.push(this.next());
        continue;
      }
      break;
    }
    return { introTokens, items, commas };
  }

  private parseByClause(): ByClause {
    const introTokens: Token[] = [this.next(), this.expectUpper("BY")];
    const items: Expr[] = [];
    const commas: Token[] = [];
    for (;;) {
      items.push(this.parseExpr());
      if (this.kindAt() === "comma") {
        commas.push(this.next());
        continue;
      }
      break;
    }
    return { introTokens, items, commas };
  }

  private parseLimit(): LimitClause {
    const limitToken = this.expectUpper("LIMIT");
    const countToken = this.peek();
    if (countToken === undefined) abort("expected a LIMIT count");
    if (countToken.kind !== "number" && countToken.kind !== "template") {
      abort("expected a numeric LIMIT count");
    }
    this.pos++;
    return { limitToken, countToken };
  }

  // --- INSERT --------------------------------------------------------------

  private parseInsert(): InsertStatement {
    const introTokens: Token[] = [this.expectUpper("INSERT")];
    const mode = this.upperAt();
    if (mode === "OVERWRITE" || mode === "INTO") introTokens.push(this.next());
    else abort("expected OVERWRITE or INTO after INSERT");

    if (this.upperAt() === "DIRECTORY" || this.upperAt() === "LOCAL") {
      unsupported("insert-directory");
    }
    if (this.upperAt() === "TABLE") introTokens.push(this.next());

    const table = this.parseInsertTarget();

    const stmt: Partial<InsertStatement> = { kind: "insertStatement", introTokens, table };

    if (this.kindAt() === "lparen") unsupported("insert-column-list");
    if (this.upperAt() === "PARTITION") stmt.partition = this.parsePartitionSpec();
    if (this.upperAt() === "VALUES") unsupported("insert-values");
    if (this.upperAt() === "IF" && this.upperAt(1) === "NOT" && this.upperAt(2) === "EXISTS") {
      stmt.ifNotExists = [this.next(), this.next(), this.next()];
    }
    if (this.upperAt() === "VALUES") unsupported("insert-values");

    const head = this.upperAt();
    if (head !== "SELECT" && head !== "WITH" && this.kindAt() !== "lparen") {
      abort("expected a SELECT source for INSERT");
    }
    stmt.source = this.parseSelectStatement();
    return stmt as InsertStatement;
  }

  private parseInsertTarget(): TableRef {
    const t = this.peek();
    if (t === undefined || (!this.isNameStart(t) && t.kind !== "keyword")) {
      abort("expected an INSERT target table");
    }
    return { kind: "tableRef", nameTokens: this.parseDottedNameTokens() };
  }

  private parsePartitionSpec(): PartitionSpec {
    const partitionToken = this.expectUpper("PARTITION");
    const lparen = this.expectKind("lparen", "( after PARTITION");
    const entries: Token[][] = [];
    const commas: Token[] = [];
    let current: Token[] = [];
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t === undefined) abort("unterminated PARTITION spec");
      if (t.kind === "rparen" && depth === 0) break;
      if (t.kind === "comma" && depth === 0) {
        entries.push(current);
        current = [];
        commas.push(this.next());
        continue;
      }
      if (t.kind === "lparen") depth++;
      else if (t.kind === "rparen") depth--;
      current.push(this.next());
    }
    entries.push(current);
    const rparen = this.expectKind("rparen", ") closing PARTITION spec");
    return { partitionToken, lparen, entries, commas, rparen };
  }

  // --- multi-insert --------------------------------------------------------

  private parseMultiInsert(): MultiInsertStatement {
    const fromToken = this.expectUpper("FROM");
    const relation = this.parseRelation();
    const tail = this.upperAt();
    if (tail === "PIVOT") unsupported("pivot");
    if (tail === "UNPIVOT") unsupported("unpivot");

    const inserts: MultiInsertBranch[] = [];
    while (this.upperAt() === "INSERT") {
      inserts.push(this.parseMultiInsertBranch());
    }
    if (inserts.length === 0) abort("FROM statement without INSERT branches");
    return { kind: "multiInsertStatement", fromToken, relation, inserts };
  }

  private parseMultiInsertBranch(): MultiInsertBranch {
    const introTokens: Token[] = [this.expectUpper("INSERT")];
    const mode = this.upperAt();
    if (mode === "OVERWRITE" || mode === "INTO") introTokens.push(this.next());
    else abort("expected OVERWRITE or INTO in multi-insert branch");
    if (this.upperAt() === "DIRECTORY" || this.upperAt() === "LOCAL") {
      unsupported("insert-directory");
    }
    if (this.upperAt() === "TABLE") introTokens.push(this.next());

    const table = this.parseInsertTarget();
    const branch: Partial<MultiInsertBranch> = { introTokens, table };
    if (this.kindAt() === "lparen") unsupported("insert-column-list");
    if (this.upperAt() === "PARTITION") branch.partition = this.parsePartitionSpec();
    if (this.upperAt() === "VALUES") unsupported("insert-values");
    branch.body = this.parseQuerySpec();
    return branch as MultiInsertBranch;
  }

  // --- expressions ---------------------------------------------------------

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    const operands: Expr[] = [this.parseAnd()];
    const opTokens: Token[] = [];
    while (this.upperAt() === "OR") {
      opTokens.push(this.next());
      operands.push(this.parseAnd());
    }
    const only = operands[0];
    if (opTokens.length === 0 && only !== undefined) return only;
    return { kind: "booleanChain", op: "or", operands, opTokens };
  }

  private parseAnd(): Expr {
    const operands: Expr[] = [this.parseNot()];
    const opTokens: Token[] = [];
    while (this.upperAt() === "AND") {
      opTokens.push(this.next());
      operands.push(this.parseNot());
    }
    const only = operands[0];
    if (opTokens.length === 0 && only !== undefined) return only;
    return { kind: "booleanChain", op: "and", operands, opTokens };
  }

  private parseNot(): Expr {
    if (this.upperAt() === "NOT") {
      if (this.upperAt(1) === "EXISTS") {
        const notToken = this.next();
        return this.parseExists(notToken);
      }
      const notToken = this.next();
      return { kind: "not", notToken, operand: this.parseNot() };
    }
    return this.parsePredicate();
  }

  private parseExists(notToken?: Token): Expr {
    const existsToken = this.expectUpper("EXISTS");
    const lparen = this.expectKind("lparen", "( after EXISTS");
    const query = this.parseQueryExpr();
    const rparen = this.expectKind("rparen", ") closing EXISTS subquery");
    return notToken === undefined
      ? { kind: "exists", existsToken, lparen, query, rparen }
      : { kind: "exists", notToken, existsToken, lparen, query, rparen };
  }

  private parsePredicate(): Expr {
    if (this.upperAt() === "EXISTS") return this.parseExists();

    let left = this.parseAdditive();
    for (;;) {
      const t = this.peek();
      if (t === undefined) return left;

      if (t.kind === "operator" && COMPARISON_OPS.has(t.text)) {
        const op = this.next();
        left = { kind: "binary", left, opTokens: [op], right: this.parseAdditive() };
        continue;
      }

      let notToken: Token | undefined;
      let head = t.upper;
      if (head === "NOT") {
        const following = this.upperAt(1);
        if (
          following === undefined ||
          (following !== "IN" &&
            following !== "BETWEEN" &&
            following !== "LIKE" &&
            following !== "RLIKE" &&
            following !== "REGEXP")
        ) {
          return left;
        }
        notToken = this.next();
        head = following;
      }

      if (head === "BETWEEN") {
        const betweenToken = this.next();
        const low = this.parseAdditive();
        const andToken = this.expectUpper("AND");
        const high = this.parseAdditive();
        left =
          notToken === undefined
            ? { kind: "between", expr: left, betweenToken, low, andToken, high }
            : { kind: "between", expr: left, notToken, betweenToken, low, andToken, high };
        continue;
      }

      if (head === "IN") {
        const inToken = this.next();
        const lparen = this.expectKind("lparen", "( after IN");
        let subquery: QueryExpr | undefined;
        let items: { exprs: Expr[]; commas: Token[] } | undefined;
        if (this.upperAt() === "SELECT" || this.kindAt() === "lparen") {
          subquery = this.parseQueryExpr();
        } else {
          const exprs: Expr[] = [];
          const commas: Token[] = [];
          for (;;) {
            exprs.push(this.parseExpr());
            if (this.kindAt() === "comma") {
              commas.push(this.next());
              continue;
            }
            break;
          }
          items = { exprs, commas };
        }
        const rparen = this.expectKind("rparen", ") closing IN list");
        const node: Expr = subquery !== undefined
          ? { kind: "in", expr: left, inToken, lparen, subquery, rparen }
          : { kind: "in", expr: left, inToken, lparen, items: items!, rparen };
        if (notToken !== undefined) (node as { notToken?: Token }).notToken = notToken;
        left = node;
        continue;
      }

      if (LIKE_OPS.has(head)) {
        const opTokens: Token[] = notToken === undefined ? [] : [notToken];
        opTokens.push(this.next());
        left = { kind: "binary", left, opTokens, right: this.parseAdditive() };
        continue;
      }

      if (notToken !== undefined) abort("unexpected NOT in predicate");

      if (head === "IS") {
        const opTokens: Token[] = [this.next()];
        if (this.upperAt() === "NOT") opTokens.push(this.next());
        const tail = this.upperAt();
        if (tail === undefined || !IS_TAILS.has(tail)) abort("expected NULL/TRUE/FALSE after IS");
        opTokens.push(this.next());
        left = { kind: "is", expr: left, opTokens };
        continue;
      }

      return left;
    }
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t === undefined || t.kind !== "operator" || !ADDITIVE_OPS.has(t.text)) return left;
      const op = this.next();
      left = { kind: "binary", left, opTokens: [op], right: this.parseMultiplicative() };
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t === undefined) return left;
      const isOp = t.kind === "operator" && MULTIPLICATIVE_OPS.has(t.text);
      const isDiv = t.kind === "keyword" && t.upper === "DIV";
      if (!isOp && !isDiv) return left;
      const op = this.next();
      left = { kind: "binary", left, opTokens: [op], right: this.parseUnary() };
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t !== undefined && t.kind === "operator" && UNARY_OPS.has(t.text)) {
      const opToken = this.next();
      return { kind: "unary", opToken, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** Member access after a call/paren: `f(x).a.b`. Names absorb their own dots. */
  private parsePostfix(): Expr {
    let base = this.parsePrimary();
    for (;;) {
      if (this.kindAt() !== "dot") return base;
      const member = this.peek(1);
      if (member === undefined || !this.isNameContinuation(member)) return base;
      const dot = this.next();
      const name = this.next();
      base = { kind: "binary", left: base, opTokens: [dot], right: { kind: "name", tokens: [name] } };
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t === undefined) abort("expected an expression");

    // `*` and `t.*` in select-item / count(*) position.
    if (t.kind === "operator" && t.text === "*") {
      return { kind: "star", tokens: [this.next()] };
    }

    if (t.kind === "number" || t.kind === "string") {
      return { kind: "literal", tokens: [this.next()] };
    }

    if (t.kind === "lparen") {
      // Lambda parameter list: `(a, b) -> expr`
      const after = this.matchParen(this.pos);
      if (after !== -1) {
        const arrow = this.toks[after];
        if (arrow !== undefined && arrow.kind === "operator" && arrow.text === "->") {
          const paramTokens = this.takeBalancedParens();
          const arrowToken = this.next();
          return { kind: "lambda", paramTokens, arrowToken, body: this.parseExpr() };
        }
      }
      if (this.isQueryStart(this.pos)) {
        const lparen = this.next();
        const query = this.parseQueryExpr();
        const rparen = this.expectKind("rparen", ") closing a subquery");
        return { kind: "subqueryExpr", lparen, query, rparen };
      }
      const lparen = this.next();
      const inner = this.parseExpr();
      const rparen = this.expectKind("rparen", ") closing a parenthesized expression");
      return { kind: "paren", lparen, inner, rparen };
    }

    if (t.kind === "template") {
      if (this.kindAt(1) === "dot") return { kind: "name", tokens: this.parseDottedNameTokens() };
      return { kind: "templateExpr", token: this.next() };
    }

    if (t.kind === "keyword") {
      switch (t.upper) {
        case "TRUE":
        case "FALSE":
        case "NULL":
          return { kind: "literal", tokens: [this.next()] };
        case "DATE":
        case "TIMESTAMP": {
          if (this.kindAt(1) === "string") return { kind: "literal", tokens: [this.next(), this.next()] };
          break;
        }
        case "INTERVAL":
          return this.parseInterval();
        case "CASE":
          return this.parseCase();
        case "CAST":
          if (this.kindAt(1) === "lparen") return this.parseCast();
          break;
        case "EXISTS":
          return this.parseExists();
        default:
          break;
      }
      // Keywords name functions when a `(` follows (`if(...)`, `map(...)`,
      // `array(...)`, `filter(...)`, ...); non-structural keywords are also
      // legal bare column names in Hive (`items`, `data`, `comment`, ...).
      if (this.kindAt(1) === "lparen") return this.parseFunctionCallNode();
      if (EXPR_STOP_KEYWORDS.has(t.upper)) {
        abort(`unexpected keyword "${t.text}" in an expression`);
      }
    }

    if (t.kind === "identifier" || t.kind === "quotedIdentifier" || t.kind === "keyword") {
      const arrow = this.peek(1);
      if (arrow !== undefined && arrow.kind === "operator" && arrow.text === "->") {
        const paramTokens = [this.next()];
        const arrowToken = this.next();
        return { kind: "lambda", paramTokens, arrowToken, body: this.parseExpr() };
      }
      if (t.upper === "TRY_CAST" && this.kindAt(1) === "lparen") return this.parseCast();

      const tokens = this.parseDottedNameTokens();
      const last = tokens[tokens.length - 1];
      if (last !== undefined && last.kind === "operator" && last.text === "*") {
        return { kind: "star", tokens };
      }
      if (this.kindAt() === "lparen") return this.finishFunctionCall(tokens);
      return { kind: "name", tokens };
    }

    abort(`unexpected token "${t.text}" in an expression`);
  }

  private parseInterval(): Expr {
    const tokens: Token[] = [this.expectUpper("INTERVAL")];
    for (;;) {
      const t = this.peek();
      if (t === undefined) break;
      if (t.kind === "number" || t.kind === "string") {
        tokens.push(this.next());
        continue;
      }
      if (t.kind === "operator" && (t.text === "-" || t.text === "+")) {
        tokens.push(this.next());
        continue;
      }
      if (
        (t.kind === "identifier" || t.kind === "keyword") &&
        INTERVAL_UNITS.has(t.upper)
      ) {
        tokens.push(this.next());
        continue;
      }
      break;
    }
    if (tokens.length === 1) abort("empty INTERVAL literal");
    return { kind: "interval", tokens };
  }

  private parseCase(): CaseExpr {
    const caseToken = this.expectUpper("CASE");
    const node: Partial<CaseExpr> = { kind: "case", caseToken };
    if (this.upperAt() !== "WHEN") node.operand = this.parseExpr();
    const whens: WhenArm[] = [];
    while (this.upperAt() === "WHEN") {
      const whenToken = this.next();
      const condition = this.parseExpr();
      const thenToken = this.expectUpper("THEN");
      const result = this.parseExpr();
      whens.push({ whenToken, condition, thenToken, result });
    }
    if (whens.length === 0) abort("CASE without WHEN arms");
    node.whens = whens;
    if (this.upperAt() === "ELSE") {
      const elseToken = this.next();
      node.elseArm = { elseToken, result: this.parseExpr() };
    }
    node.endToken = this.expectUpper("END");
    return node as CaseExpr;
  }

  private parseCast(): CastExpr {
    const nameToken = this.next();
    const lparen = this.expectKind("lparen", "( after CAST");
    const expr = this.parseExpr();
    const asToken = this.expectUpper("AS");
    const typeTokens = this.takeUntilGroupEnd();
    if (typeTokens.length === 0) abort("empty CAST target type");
    const rparen = this.expectKind("rparen", ") closing CAST");
    return { kind: "cast", nameToken, lparen, expr, asToken, typeTokens, rparen };
  }

  private parseFunctionCallNode(): FunctionCall {
    const t = this.peek();
    if (t === undefined || (!this.isNameStart(t) && t.kind !== "keyword")) {
      abort("expected a function name");
    }
    return this.finishFunctionCall(this.parseDottedNameTokens());
  }

  private finishFunctionCall(nameTokens: Token[]): FunctionCall {
    const lparen = this.expectKind("lparen", "( after a function name");
    const call: Partial<FunctionCall> = { kind: "functionCall", nameTokens, lparen };
    const quantifier = this.upperAt();
    if (quantifier === "DISTINCT" || (quantifier === "ALL" && this.kindAt(1) !== "rparen")) {
      call.distinct = this.next();
    }
    const args: Expr[] = [];
    const commas: Token[] = [];
    if (this.kindAt() !== "rparen") {
      for (;;) {
        args.push(this.parseExpr());
        if (this.kindAt() === "comma") {
          commas.push(this.next());
          continue;
        }
        break;
      }
    }
    call.args = args;
    call.commas = commas;
    call.rparen = this.expectKind("rparen", ") closing a function call");

    if (this.upperAt() === "FILTER" && this.kindAt(1) === "lparen") {
      const filterToken = this.next();
      call.filterTokens = [filterToken, ...this.takeBalancedParens()];
    }
    if (this.upperAt() === "OVER") {
      call.over = this.parseOverClause();
    }
    return call as FunctionCall;
  }

  private parseOverClause(): OverClause {
    const overToken = this.expectUpper("OVER");
    if (this.kindAt() === "lparen") {
      return { overToken, spec: this.parseWindowSpec() };
    }
    const name = this.peek();
    if (name === undefined || (name.kind !== "identifier" && name.kind !== "quotedIdentifier")) {
      abort("expected a window name or ( after OVER");
    }
    return { overToken, windowName: this.next() };
  }

  // --- shared token helpers ------------------------------------------------

  private isNameStart(t: Token | undefined): boolean {
    return (
      t !== undefined &&
      (t.kind === "identifier" || t.kind === "quotedIdentifier" || t.kind === "template")
    );
  }

  private isNameContinuation(t: Token | undefined): boolean {
    return (
      t !== undefined &&
      (t.kind === "identifier" ||
        t.kind === "quotedIdentifier" ||
        t.kind === "template" ||
        t.kind === "keyword")
    );
  }

  /** `a`, `a.b`, `${db}.t`, `t.*` — returns the verbatim token run. */
  private parseDottedNameTokens(): Token[] {
    const head = this.peek();
    if (head === undefined || (!this.isNameStart(head) && head.kind !== "keyword")) {
      abort("expected a name");
    }
    const tokens: Token[] = [this.next()];
    for (;;) {
      if (this.kindAt() !== "dot") break;
      const after = this.peek(1);
      if (after !== undefined && after.kind === "operator" && after.text === "*") {
        tokens.push(this.next(), this.next());
        break;
      }
      if (!this.isNameContinuation(after)) break;
      tokens.push(this.next(), this.next());
    }
    return tokens;
  }

  /** True when `(` at `index` opens a parenthesized query. */
  private isQueryStart(index: number): boolean {
    let i = index;
    while (this.toks[i]?.kind === "lparen") i++;
    return this.toks[i]?.upper === "SELECT";
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parse(tokens: Token[], dialect: Dialect): ParseResult {
  void dialect;

  let eofIndex = tokens.length;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]?.kind === "eof") {
      eofIndex = i;
      break;
    }
  }
  const body = tokens.slice(0, eofIndex);
  const eofToken = tokens[eofIndex];
  const eof: Token = eofToken ?? {
    kind: "eof",
    text: "",
    upper: "",
    start: 0,
    end: 0,
    leadingComments: [],
    blankLineBefore: false,
  };

  const statements: StatementNode[] = [];
  for (const raw of splitStatements(body)) {
    statements.push(parseOneStatement(raw));
  }

  const file: SqlFile = { kind: "sqlFile", statements, eof };
  return { file, diagnostics: [] };
}

function parseOneStatement(raw: RawStatement): StatementNode {
  const { tokens, semicolon } = raw;

  if (tokens.length === 0) {
    // A stray `;` — nothing to model, but the token must still be carried.
    const empty: GenericStatement = { kind: "genericStatement", tokens: [] };
    if (semicolon !== undefined) empty.semicolon = semicolon;
    return empty;
  }

  let node: StatementNode;
  try {
    node = new StatementParser(tokens).parseStatement();
  } catch (err) {
    if (err instanceof ParseAbort && err.construct !== undefined) {
      node = { kind: "unsupportedStatement", construct: err.construct, tokens };
    } else {
      const reason =
        err instanceof Error && err.message.length > 0 ? err.message : "unrecognized statement";
      node = { kind: "unknownStatement", tokens, reason };
    }
  }
  if (semicolon !== undefined) node.semicolon = semicolon;
  return node;
}
