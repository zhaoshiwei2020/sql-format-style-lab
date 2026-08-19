/**
 * Hive 1.1 dialect data. OWNER: lexer implementation task.
 *
 * The keyword set is the union of:
 *   - Hive 1.x `HiveLexer.g` / `IdentifiersParser.g` reserved + non-reserved
 *     keywords (Hive 1.1 / 1.2 vintage);
 *   - the statement/clause openers and window vocabulary the printer needs;
 *   - a few Spark-on-Hive extras that show up in the calibration corpus
 *     (QUALIFY, ANTI, PIVOT, RESET, CACHE, ...).
 *
 * Being generous is deliberate and safe: the lexer only tags kind "keyword"
 * and always preserves the source text verbatim. Whether a word acts as a
 * keyword or as an identifier in a given position is the parser's decision.
 */

import type { Dialect } from "../tokens.js";

const KEYWORDS: readonly string[] = [
  // --- query core ---------------------------------------------------------
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "SORT",
  "DISTRIBUTE", "CLUSTER", "LIMIT", "OFFSET", "DISTINCT", "ALL", "AS",
  "QUALIFY", "FILTER", "LATERAL", "VIEW", "EXPLODE", "POSEXPLODE",
  "TABLESAMPLE", "PERCENT", "BUCKET", "OUT", "OF", "ON", "USING",

  // --- joins --------------------------------------------------------------
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "SEMI", "ANTI", "CROSS",
  "NATURAL", "UNIQUEJOIN", "MAPJOIN", "STREAMTABLE", "PRESERVE",

  // --- set operations -----------------------------------------------------
  "UNION", "INTERSECT", "EXCEPT", "MINUS",

  // --- boolean / predicates ----------------------------------------------
  "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "RLIKE", "REGEXP",
  "IS", "NULL", "TRUE", "FALSE", "ANY", "SOME", "DIV",

  // --- expressions --------------------------------------------------------
  "CASE", "WHEN", "THEN", "ELSE", "END", "IF", "CAST", "INTERVAL", "DEFAULT",
  "GROUPING", "SETS", "ROLLUP", "CUBE", "PIVOT", "UNPIVOT", "TRANSFORM",
  "REDUCE", "MAP", "ARRAY", "STRUCT", "UNIONTYPE",

  // --- ordering -----------------------------------------------------------
  "ASC", "DESC", "NULLS", "FIRST", "LAST",

  // --- windows ------------------------------------------------------------
  "OVER", "WINDOW", "PARTITION", "PARTITIONS", "PARTITIONED", "ROWS", "ROW",
  "RANGE", "UNBOUNDED", "PRECEDING", "FOLLOWING", "CURRENT",

  // --- CTE ----------------------------------------------------------------
  "WITH", "RECURSIVE",

  // --- DML ----------------------------------------------------------------
  "INSERT", "OVERWRITE", "INTO", "VALUES", "UPDATE", "DELETE", "MERGE",
  "MATCHED", "LOAD", "INPATH", "DIRECTORY", "LOCAL", "EXPORT", "IMPORT",
  "TABLE", "TABLES",

  // --- DDL ----------------------------------------------------------------
  "CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME", "TO", "CHANGE", "REPLACE",
  "ADD", "COLUMN", "COLUMNS", "EXTERNAL", "TEMPORARY", "TRANSACTIONAL",
  "IF", "EXISTS", "DATABASE", "DATABASES", "SCHEMA", "SCHEMAS", "MATERIALIZED",
  "INDEX", "INDEXES", "REBUILD", "FUNCTION", "FUNCTIONS", "MACRO",
  "CONSTRAINT", "PRIMARY", "FOREIGN", "REFERENCES", "UNIQUE", "ENABLE",
  "DISABLE", "VALIDATE", "NOVALIDATE", "RELY", "NORELY", "CASCADE", "RESTRICT",
  "PURGE", "AFTER", "BEFORE", "EXCHANGE", "ARCHIVE", "UNARCHIVE", "TOUCH",
  "COMPACT", "COMPACTIONS", "CONCATENATE", "SKEWED", "STORED", "DIRECTORIES",
  "CLUSTERED", "SORTED", "BUCKETS", "COMMENT", "LOCATION", "TBLPROPERTIES",
  "DBPROPERTIES", "IDXPROPERTIES", "SERDE", "SERDEPROPERTIES", "DEFERRED",
  "ROW", "FORMAT", "DELIMITED", "FIELDS", "TERMINATED", "ESCAPED",
  "COLLECTION", "ITEMS", "KEYS", "LINES", "NULL", "DEFINED", "FILEFORMAT",
  "INPUTFORMAT", "OUTPUTFORMAT", "INPUTDRIVER", "OUTPUTDRIVER",
  "RECORDREADER", "RECORDWRITER", "OFFLINE", "NO_DROP", "READONLY",
  "KEY_TYPE", "VALUE_TYPE", "ELEM_TYPE", "REWRITE", "URI", "SERVER",

  // --- types --------------------------------------------------------------
  "BOOLEAN", "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "FLOAT",
  "DOUBLE", "PRECISION", "DECIMAL", "NUMERIC", "STRING", "CHAR", "VARCHAR",
  "BINARY", "DATE", "DATETIME", "TIMESTAMP", "LONG", "REAL", "VOID",

  // --- utility statements -------------------------------------------------
  "SET", "UNSET", "RESET", "USE", "SHOW", "DESCRIBE", "DESC", "EXPLAIN",
  "EXTENDED", "FORMATTED", "DEPENDENCY", "LOGICAL", "ANALYZE", "COMPUTE",
  "STATISTICS", "NOSCAN", "PARTIALSCAN", "MSCK", "REPAIR", "CACHE", "UNCACHE",
  "CLEAR", "LAZY", "REFRESH", "BEGIN", "COMMIT", "ROLLBACK", "START",
  "TRANSACTION", "TRANSACTIONS", "DECLARE", "WHILE", "FOR", "CONTINUE",
  "CURSOR", "PROCEDURE", "TRIGGER", "UNDO", "READ", "READS", "FETCH",
  "JAR", "FILE", "FILES", "JARS", "ARCHIVES", "LIST", "DELETE", "DFS",

  // --- security -----------------------------------------------------------
  "GRANT", "REVOKE", "ROLE", "ROLES", "USER", "GROUP", "OWNER", "PRINCIPALS",
  "ADMIN", "AUTHORIZATION", "OPTION", "SSL", "LOCK", "LOCKS", "UNLOCK",
  "SHARED", "EXCLUSIVE", "DATA", "NONE",
];

export const HIVE_110: Dialect = {
  name: "hive",
  version: "1.1",
  keywords: new Set<string>(KEYWORDS),
  templatePatterns: [],
};
