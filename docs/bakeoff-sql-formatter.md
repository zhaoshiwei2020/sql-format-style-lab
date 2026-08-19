# Bake-off note: reusing `sql-formatter`'s Hive dialect assets

Scope: answers the `sql-formatter` row of ARCHITECTURE.md §6.2 and feeds the
Phase 0 bake-off in §6.3. Investigated by cloning
[sql-formatter-org/sql-formatter](https://github.com/sql-formatter-org/sql-formatter)
(HEAD `aa8efaef`, 2026-07-23) and inspecting `registry.npmjs.org/sql-formatter`
(latest published version `15.8.2`, 2026-06-21). No dependency was added to
this repo; this is a source-reading exercise only.

## 1. Where the Hive dialect lives and what it contains

`src/languages/hive/`:

- [`hive.keywords.ts`](https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/hive/hive.keywords.ts) (341 lines) — two flat arrays: `keywords` (non-reserved, ~280 entries, e.g. `LATERAL`, `BUCKET`, `SERDE`) and `dataTypes` (19 entries: `ARRAY`, `MAP`, `STRUCT`, `DECIMAL`, …).
- [`hive.functions.ts`](https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/hive/hive.functions.ts) (219 lines) — one flat array of built-in function names: scalar/aggregate, table-generating (`EXPLODE`, `POSEXPLODE`, `INLINE`, `JSON_TUPLE`, `PARSE_URL_TUPLE`, `STACK`), windowing (`LEAD`, `LAG`, `RANK`, `NTILE`, …).
- [`hive.formatter.ts`](https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/hive/hive.formatter.ts) (112 lines) — combines the above into `tokenizerOptions`:
  - `reservedSelect`/`reservedClauses`/`reservedJoins`/`reservedSetOperations` — phrase lists via `expandPhrases(['{LEFT|RIGHT|FULL} [OUTER] JOIN', ...])`, expanding bracket/alternation shorthand (covers `SORT BY`, `CLUSTER BY`, `DISTRIBUTE BY`, `WINDOW`, `INSERT OVERWRITE [LOCAL] DIRECTORY`, `LOAD DATA [LOCAL] INPATH`, `LEFT SEMI JOIN`).
  - `stringTypes: ['""-bs', "''-bs"]` (double/single, backslash-escaped); `identTypes: ['``']` (backtick).
  - `variableTypes: [{ quote: '{}', prefixes: ['$'], requirePrefix: true }]` — matches `${...}` exactly, i.e. `${hiveconf:month}` (not `#{...}` or `{{ }}`).
  - `operators: ['%', '~', '^', '|', '&', '<=>', '==', '!', '||']`, `extraParens: ['[]']`.
  - `formatOptions.onelineClauses`/`tabularOnelineClauses` — printer-side, not tokenizer-side.

This is exactly the shape ARCHITECTURE.md §7.1's lexer needs as *input
data* (keyword/function/type lists, quoting rules, operator set) — not
parser or CST code.

## 2. Public API vs. internal-only

The package root (`src/index.ts`) exports `hive` itself (`export { hive }
from './languages/hive/hive.formatter.js'`) — the whole `DialectOptions`
object, keywords/functions/types included — plus the `DialectOptions`
type. So `import { hive } from 'sql-formatter';
hive.tokenizerOptions.reservedKeywords` works today, no vendoring needed,
**for the data**.

The actual tokenizer *engine* (`src/lexer/Tokenizer.ts`,
`TokenizerEngine.ts`, `regexFactory.ts`, `disambiguateTokens.ts` — ~994
lines total) is **not** exported. `package.json`'s `"exports"` map only
opens `"."` and `"./package.json"`, so Node's exports-map enforcement
blocks even a deep import (`sql-formatter/dist/...`) at resolution time,
not just by convention. Reusing the lexer *logic*, not just the keyword
lists, would require vendoring source, not depending on the package.

## 3. License / attribution

MIT, per [`LICENSE`](https://github.com/sql-formatter-org/sql-formatter/blob/master/LICENSE) and npm registry metadata. Copyright chain: ZeroTurnaround LLC (2016-2020) → George Leslie-Waksman and contributors (2020-2021) → inferrinizzard and contributors (2021-present).

Vendoring (copying `hive.keywords.ts`/`hive.functions.ts` or lexer source)
only requires keeping the above copyright + MIT notice with the copied
files (e.g. a header comment) — no source-disclosure/copyleft obligation.
Importing via the public API needs no attribution beyond a normal
`package.json` dependency.

## 4. Completeness / currency spot-check

| Feature | Present? | Where |
|---|---|---|
| `DISTRIBUTE BY` / `CLUSTER BY` / `SORT BY` | Yes, tested | `reservedClauses`; `test/hive.test.ts:79` |
| Named windows (`WINDOW w1 AS (...), w2 AS (...)`) | Yes, tested (single and multiple) | `reservedClauses` (`WINDOW`); `test/features/window.ts` |
| `LATERAL VIEW` | **No** — only bare `LATERAL` is a non-reserved keyword; not a `reservedClauses` phrase, untested | grep of `src/languages/hive/`, `test/hive.test.ts` |
| `EXPLODE`/`POSEXPLODE`/table-generating functions | Yes | `hive.functions.ts` |
| `${hiveconf:...}` placeholders | Yes, via `variableTypes` | `hive.formatter.ts` |

Notably, **Spark's** dialect file (`src/languages/spark/spark.formatter.ts:54`)
*does* include `'LATERAL VIEW'` as a reserved clause — added there but
never back-ported to Hive, even though `LATERAL VIEW` is core classic-Hive
syntax and explicitly called out as a P3 requirement in ARCHITECTURE.md
§2/§3.1. A concrete, verifiable gap, not a hypothetical one.

Currency: history for `src/languages/hive/` shows 62 commits since the
dialect file was split out (2022-07-14); most recent *content* change
2025-09-02 ("support timezone phrase as datatype not as a keyword"), plus
a trivial whitespace fix 2026-07-23 (current HEAD). Maintained, not
actively grown — gaps like `LATERAL VIEW` are unlikely to get filled
without an upstream PR.

## 5. Maintenance-mode statement

From `README.md` ("The future" section): "The development of this
formatter is currently in maintenance mode. Bugs will get fixed if
feasible, but new features will likely not be added."

The same section says the original author has moved to a new project,
[`prettier-plugin-sql-cst`](https://github.com/nene/prettier-plugin-sql-cst),
built on Prettier's layout algorithm, explicitly because "several problems
... can't be fixed in SQL Formatter because of fundamental problems in its
architecture" — SQLite/BigQuery only today, no Hive/Spark. Implication:
bug fixes to `hive.keywords.ts`/`hive.functions.ts` may still land
occasionally (as seen through mid-2025), but net-new Hive coverage (e.g.
`LATERAL VIEW`) shouldn't be expected upstream, and the printer/layout
architecture is a dead end regardless — confirms ARCHITECTURE.md §6.2's
own assessment.

## Recommendation

**(a) Keyword & function lists → reuse-via-API, not vendor.**
`hive.tokenizerOptions.{reservedKeywords, reservedDataTypes,
reservedFunctionNames, stringTypes, identTypes, variableTypes, operators}`
is public, MIT-licensed, and directly importable (`import { hive } from
'sql-formatter'`). Depending on the package (or copying just the two
small data-only files with attribution, if a runtime dependency is
undesirable) gives a real head start with near-zero integration cost.
Either path needs a manual patch layer on top: the confirmed
`LATERAL VIEW` gap plus normal drift against whatever Hive version this
project targets (§7's `hive110` corpus). Treat the list as a *seed*,
verify it against the project's own Hive 1.1 corpus and Hive's built-in
function reference before trusting it.

**(b) Tokenizer logic → reference-only.**
The lexer engine is not part of the public API, is written for
`sql-formatter`'s own AST-free, non-lossless token model, and is tied to
an architecture ARCHITECTURE.md §4.1 already rejects ("普通 AST 往往不保留
comment/paren/case/quote/hint/trivia"). Vendoring ~1000 lines of internal
lexer code to save a bounded amount of work isn't worth the burden of
tracking upstream fixes with no import path to pull them in. Read it as a
design reference (regex-based phrase-matching via `expandPhrases`,
`TokenizerEngine`'s longest-match strategy) while building this project's
own lossless lexer.
