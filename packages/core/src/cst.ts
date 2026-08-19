/**
 * Tolerant, lossless layout CST.
 *
 * Design rules (ARCHITECTURE.md §7.2):
 * - Every source token appears exactly once somewhere in the tree, so the
 *   safety gate can re-derive the token sequence from the tree.
 * - Structures the printer understands get typed nodes; everything else is
 *   wrapped verbatim:
 *     - UnsupportedStatement / UnsupportedExpr: the parser recognized what it
 *       is but no print rule exists yet → statement classifies as
 *       VALID_UNSUPPORTED.
 *     - UnknownStatement: the parser could not decide whether it is valid →
 *       UNKNOWN. Never reported as a syntax error.
 * - Keywords are stored as tokens (never re-spelled strings) so case policy
 *   is applied at print time only.
 */

import type { Token } from "./tokens.js";

// ---------------------------------------------------------------------------
// File / statements
// ---------------------------------------------------------------------------

export interface SqlFile {
  kind: "sqlFile";
  statements: StatementNode[];
  eof: Token;
}

export type StatementNode =
  | GenericStatement
  | SetStatement
  | SelectStatement
  | InsertStatement
  | MultiInsertStatement
  | UnsupportedStatement
  | UnknownStatement;

export interface StatementBase {
  semicolon?: Token;
}

/**
 * Auxiliary single-line statements printed as one canonical line:
 * `use x`, `add jar '...'`, `add file '...'`, `reset ...`.
 * `tokens` excludes the semicolon.
 */
export interface GenericStatement extends StatementBase {
  kind: "genericStatement";
  tokens: Token[];
}

/** `set key = value`, `set`, `set -v`, `set key`. Value tokens kept raw. */
export interface SetStatement extends StatementBase {
  kind: "setStatement";
  setToken: Token;
  /** Tokens forming the key (identifiers, dots, `-v`, `hivevar:` etc.). */
  keyTokens: Token[];
  eq?: Token;
  /** Raw value tokens; may include templates, strings, bare words, commas. */
  valueTokens: Token[];
}

/** Statement recognized but with no printer coverage yet (e.g. DDL, MERGE). */
export interface UnsupportedStatement extends StatementBase {
  kind: "unsupportedStatement";
  /** Diagnostic label like "create-table", "merge", "explain". */
  construct: string;
  tokens: Token[];
}

/** Parser could not classify. Never treated as a syntax error. */
export interface UnknownStatement extends StatementBase {
  kind: "unknownStatement";
  tokens: Token[];
  reason: string;
}

// ---------------------------------------------------------------------------
// SELECT and query expressions
// ---------------------------------------------------------------------------

export interface SelectStatement extends StatementBase {
  kind: "selectStatement";
  with?: WithClause;
  body: QueryExpr;
}

export type QueryExpr = QuerySpec | SetOperation | ParenQuery;

export interface ParenQuery {
  kind: "parenQuery";
  lparen: Token;
  query: QueryExpr;
  rparen: Token;
}

/** `a union all b intersect c` — left-assoc chain flattened for layout. */
export interface SetOperation {
  kind: "setOperation";
  first: QueryExpr;
  rest: { opTokens: Token[]; query: QueryExpr }[]; // opTokens: [union, all] etc.
}

export interface WithClause {
  withToken: Token;
  ctes: Cte[];
  commas: Token[];
}

export interface Cte {
  name: Token;
  asToken: Token;
  lparen: Token;
  query: QueryExpr;
  rparen: Token;
}

export interface QuerySpec {
  kind: "querySpec";
  selectToken: Token;
  hint?: Token; // hint comment token is carried as leading trivia; reserved
  distinct?: Token; // `distinct` | `all`
  items: SelectItem[];
  itemCommas: Token[];
  from?: FromClause;
  lateralViews: LateralView[];
  where?: WhereClause;
  groupBy?: GroupByClause;
  having?: HavingClause;
  windowClause?: WindowClause;
  qualify?: QualifyClause;
  orderBy?: OrderByClause;
  clusterBy?: ByClause;
  distributeBy?: ByClause;
  sortBy?: OrderByClause;
  limit?: LimitClause;
}

export interface SelectItem {
  expr: Expr;
  asToken?: Token;
  alias?: Token; // identifier or quotedIdentifier
}

export interface FromClause {
  fromToken: Token;
  relation: Relation;
}

export type Relation = TableRef | SubqueryRelation | JoinRelation;

export interface TableRef {
  kind: "tableRef";
  /** db.table possibly with template tokens; verbatim sequence. */
  nameTokens: Token[];
  asToken?: Token;
  alias?: Token;
  /** `tablesample (10 percent)` raw tail, if present. */
  sampleTokens?: Token[];
}

export interface SubqueryRelation {
  kind: "subqueryRelation";
  lparen: Token;
  query: QueryExpr;
  rparen: Token;
  asToken?: Token;
  alias?: Token;
}

/** Left-assoc join chain flattened: FROM a join b on ... join c on ... */
export interface JoinRelation {
  kind: "joinRelation";
  first: Relation;
  joins: JoinPart[];
}

export interface JoinPart {
  /** e.g. [inner, join] / [left, outer, join] / [left, semi, join] / [cross, join] */
  joinTokens: Token[];
  relation: Relation;
  on?: { onToken: Token; condition: Expr };
  using?: { usingToken: Token; lparen: Token; columns: Token[]; commas: Token[]; rparen: Token };
}

export interface LateralView {
  /** [lateral, view] or [lateral, view, outer] */
  introTokens: Token[];
  fn: FunctionCall;
  tableAlias?: Token;
  asToken?: Token;
  columnAliases: Token[];
  columnCommas: Token[];
}

export interface WhereClause {
  whereToken: Token;
  condition: Expr;
}

export interface GroupByClause {
  groupToken: Token;
  byToken: Token;
  /** plain expressions; grouping sets/rollup/cube arrive as UnsupportedExpr for now */
  items: Expr[];
  commas: Token[];
}

export interface HavingClause {
  havingToken: Token;
  condition: Expr;
}

export interface QualifyClause {
  qualifyToken: Token;
  condition: Expr;
}

export interface WindowClause {
  windowToken: Token;
  definitions: { name: Token; asToken: Token; spec: WindowSpec }[];
  commas: Token[];
}

export interface OrderByClause {
  /** [order, by] or [sort, by] */
  introTokens: Token[];
  items: OrderItem[];
  commas: Token[];
}

export interface OrderItem {
  expr: Expr;
  direction?: Token; // asc | desc
  nulls?: Token[]; // [nulls, first] / [nulls, last]
}

export interface ByClause {
  /** [distribute, by] or [cluster, by] */
  introTokens: Token[];
  items: Expr[];
  commas: Token[];
}

export interface LimitClause {
  limitToken: Token;
  countToken: Token;
}

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

export interface InsertStatement extends StatementBase {
  kind: "insertStatement";
  /** Hive allows a CTE list before the insert: `with u as (...) insert ...` */
  with?: WithClause;
  /** [insert, overwrite, table] or [insert, into] or [insert, into, table] */
  introTokens: Token[];
  table: TableRef;
  partition?: PartitionSpec;
  ifNotExists?: Token[];
  source: SelectStatement;
}

export interface PartitionSpec {
  partitionToken: Token;
  lparen: Token;
  /** raw token runs per entry, split on commas: `dt = '2026-08-19'` or `dt` */
  entries: Token[][];
  commas: Token[];
  rparen: Token;
}

/** Hive multi-insert: `from src insert overwrite ... select ... insert ...` */
export interface MultiInsertStatement extends StatementBase {
  kind: "multiInsertStatement";
  fromToken: Token;
  relation: Relation;
  inserts: MultiInsertBranch[];
}

export interface MultiInsertBranch {
  introTokens: Token[];
  table: TableRef;
  partition?: PartitionSpec;
  /** SELECT body without its own FROM (per Hive multi-insert grammar). */
  body: QuerySpec;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expr =
  | LiteralExpr
  | NameExpr
  | TemplateExpr
  | StarExpr
  | UnaryExpr
  | BinaryExpr
  | BooleanChain
  | NotExpr
  | ParenExpr
  | FunctionCall
  | CaseExpr
  | CastExpr
  | BetweenExpr
  | InExpr
  | ExistsExpr
  | IsExpr
  | SubqueryExpr
  | IntervalExpr
  | LambdaExpr
  | UnsupportedExpr;

/** number | string | true | false | null | date '...' | timestamp '...' */
export interface LiteralExpr {
  kind: "literal";
  tokens: Token[]; // usually 1; date/timestamp literals have 2
}

/** Possibly-qualified name: a.b.c, `quoted`.d, template-containing names. */
export interface NameExpr {
  kind: "name";
  tokens: Token[]; // identifiers, dots, quoted identifiers, templates
}

export interface TemplateExpr {
  kind: "templateExpr";
  token: Token;
}

export interface StarExpr {
  kind: "star";
  /** `*` or `t.*` */
  tokens: Token[];
}

export interface UnaryExpr {
  kind: "unary";
  opToken: Token; // - + ~
  operand: Expr;
}

/** Any non-boolean binary operator: arithmetic, comparison, ||, like, rlike. */
export interface BinaryExpr {
  kind: "binary";
  left: Expr;
  /** e.g. [>] [<=] [not, like] [rlike] [<=>] */
  opTokens: Token[];
  right: Expr;
}

/**
 * N-ary AND / OR chain, flattened at a single precedence level.
 * `a and b and c` → { op: "and", operands: [a, b, c], opTokens: [and, and] }.
 * Nested different-op chains keep their tree structure (OR of ANDs etc.).
 */
export interface BooleanChain {
  kind: "booleanChain";
  op: "and" | "or";
  operands: Expr[];
  opTokens: Token[]; // length = operands.length - 1
}

export interface NotExpr {
  kind: "not";
  notToken: Token;
  operand: Expr;
}

/** Parentheses that exist in the source are always preserved. */
export interface ParenExpr {
  kind: "paren";
  lparen: Token;
  inner: Expr;
  rparen: Token;
}

export interface FunctionCall {
  kind: "functionCall";
  nameTokens: Token[]; // possibly qualified
  lparen: Token;
  distinct?: Token;
  args: Expr[];
  commas: Token[];
  rparen: Token;
  /** aggregate FILTER (where ...) — raw tail, printer-supported later */
  filterTokens?: Token[];
  over?: OverClause;
}

export interface OverClause {
  overToken: Token;
  /** Either a named window reference or an inline spec. */
  windowName?: Token;
  spec?: WindowSpec;
}

export interface WindowSpec {
  lparen: Token;
  partitionBy?: { introTokens: Token[]; items: Expr[]; commas: Token[] };
  orderBy?: OrderByClause;
  /** rows/range frame — raw token run, printed on one line. */
  frameTokens?: Token[];
  rparen: Token;
}

export interface CaseExpr {
  kind: "case";
  caseToken: Token;
  /** simple CASE operand: `case x when ...` */
  operand?: Expr;
  whens: WhenArm[];
  elseArm?: { elseToken: Token; result: Expr };
  endToken: Token;
}

export interface WhenArm {
  whenToken: Token;
  condition: Expr;
  thenToken: Token;
  result: Expr;
}

export interface CastExpr {
  kind: "cast";
  nameToken: Token; // cast | try_cast
  lparen: Token;
  expr: Expr;
  asToken: Token;
  /** type expression kept raw: decimal(18, 2), array<struct<...>>, string */
  typeTokens: Token[];
  rparen: Token;
}

export interface BetweenExpr {
  kind: "between";
  expr: Expr;
  notToken?: Token;
  betweenToken: Token;
  low: Expr;
  andToken: Token;
  high: Expr;
}

export interface InExpr {
  kind: "in";
  expr: Expr;
  notToken?: Token;
  inToken: Token;
  lparen: Token;
  /** either list items or a subquery */
  items?: { exprs: Expr[]; commas: Token[] };
  subquery?: QueryExpr;
  rparen: Token;
}

export interface ExistsExpr {
  kind: "exists";
  notToken?: Token;
  existsToken: Token;
  lparen: Token;
  query: QueryExpr;
  rparen: Token;
}

/** `x is null` / `x is not null` / `x is true` */
export interface IsExpr {
  kind: "is";
  expr: Expr;
  /** [is] [not]? [null|true|false] */
  opTokens: Token[];
}

export interface SubqueryExpr {
  kind: "subqueryExpr";
  lparen: Token;
  query: QueryExpr;
  rparen: Token;
}

export interface IntervalExpr {
  kind: "interval";
  tokens: Token[]; // interval 7 days — raw
}

/** Spark lambda: `item -> expr` or `(a, b) -> expr` */
export interface LambdaExpr {
  kind: "lambda";
  paramTokens: Token[]; // includes parens/commas if present
  arrowToken: Token;
  body: Expr;
}

/** Syntactically plausible expression the printer cannot lay out yet. */
export interface UnsupportedExpr {
  kind: "unsupportedExpr";
  construct: string;
  tokens: Token[];
}

// ---------------------------------------------------------------------------
// Parse result
// ---------------------------------------------------------------------------

export interface ParseDiagnostic {
  code: "PAR001" | "PAR002" | "PAR003";
  message: string;
  start: number;
  end: number;
  construct?: string;
}

export interface ParseResult {
  file: SqlFile;
  diagnostics: ParseDiagnostic[];
}
