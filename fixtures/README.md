# fixtures/

Test fixtures for the Hive/Spark SQL formatter, derived from the two style-calibration
corpora at the repo root (`complex_case_style_calibration.sql`,
`spark_sql_style_calibration.sql`). Those corpus files ARE the desired output style — every
`expected.sql` below is an exact, byte-verified excerpt of them. See ARCHITECTURE.md §18.1.

## Policy: golden vs golden-pending vs unsupported

- **`golden/`** — statements the printer must handle correctly *today*. These fixtures are
  wired into Phase 1 and must pass: `format(input.sql) === expected.sql`,
  `format(expected.sql) === expected.sql` (idempotence), plus the §18.2 invariants
  (token/structural/comment/template preservation).
- **`golden-pending/`** — the target set for syntax the printer does not yet cover (or covers
  only partially). Not required to pass yet; each fixture is promoted into `golden/` as the
  printer matures. Until promoted, the formatter is expected to return `VALID_UNSUPPORTED` or
  `UNKNOWN` (zero edits) on these inputs, never a wrong edit.
- **`unsupported/`** — one representative statement per construct that is explicitly out of
  scope for the first batch. These must yield **zero edits** with state
  `VALID_UNSUPPORTED` or `UNKNOWN` — never `INVALID` (they are syntactically valid Spark/Hive
  SQL) and never silently reformatted.

Every `input.sql` is a whitespace-mangled version of its sibling `expected.sql`: every run of
whitespace (including newlines) is collapsed to a single space, producing one long line with a
single trailing newline — except where a statement contains `--` line comments, in which case
each comment line is kept on its own line (newline preserved after it) and `/* */` block
comments stay inline; all other whitespace is still collapsed. This guarantees
`input.sql` and `expected.sql` have the identical token sequence (verified programmatically),
so a correct formatter run on `input.sql` must produce exactly `expected.sql`.

## fixtures/golden/case/ — from complex_case_style_calibration.sql

All 13 numbered sections of the corpus, one directory per section (each section is exactly one
`select` statement). Slugs summarize the CASE-formatting rule the section calibrates.

| dir | corpus section | lines |
|---|---|---|
| 01-short-when-baseline | 01. 基准：短条件不强制展开 | 19-26 |
| 02-consecutive-and | 02. 连续 AND | 33-52 |
| 03-or-inside-and | 03. AND 中嵌套 OR | 59-83 |
| 04-parenthesized-and-or-groups | 04. 多组 AND/OR | 90-112 |
| 05-nested-function-calls-in-when | 05. WHEN 内包含较深函数调用 | 119-142 |
| 06-window-function-in-when | 06. WHEN 内包含窗口函数和条件函数 | 149-170 |
| 07-window-aggregate-in-then | 07. THEN 内包含窗口聚合和多层函数 | 177-201 |
| 08-case-nested-in-round-cast | 08. CASE 嵌在 round/cast 中 | 208-235 |
| 09-case-in-arithmetic-expression | 09. CASE 作为长算术表达式的一部分 | 242-263 |
| 10-nested-case-in-case | 10. CASE 套 CASE | 270-292 |
| 11-then-result-complex-computation | 11. THEN 结果本身也是复杂条件计算 | 299-335 |
| 12-case-inside-aggregate-function | 12. 聚合函数中的复杂 CASE | 342-379 |
| 13-extreme-combined-scenario | 13. 极端综合场景 | 386-433 |

## fixtures/golden-pending/spark/ — from spark_sql_style_calibration.sql

Only first-batch formatter scope (ARCHITECTURE.md §13.2 Hive/Spark first-batch syntax). 29
fixture directories, one per statement except where the task spec grouped statements together
(01, 16-2) because they are meant to be calibrated/read as a unit.

| dir | corpus section | lines |
|---|---|---|
| 01-session-config | 01. set/use/add jar/add file/reset/set;/set -v;/set var | 15-34 |
| 02-1-scalar-literals-and-types | 02. literal select | 41-50 |
| 02-2-identifiers-and-builtin-functions | 02. identifiers + builtins select | 52-67 |
| 02-3-collection-and-lambda-functions | 02. array/map/struct/lambda select | 69-84 |
| 03-case-and-complex-predicates | 03. case + where | 91-122 |
| 04-1-inner-join-with-compound-on | 04. inner+left join | 129-149 |
| 04-2-left-semi-join-using | 04. left semi join using | 151-157 |
| 04-3-left-anti-join | 04. left anti join | 159-165 |
| 04-4-cross-join | 04. cross join | 167-174 |
| 05-1-cte-chain-with-window-rank | 05. CTE chain + row_number | 181-220 |
| 05-2-scalar-subquery-and-exists | 05. scalar subquery + exists/not exists | 222-247 |
| 06-aggregation-group-by-having-order-limit | 06. first aggregation select (grouping sets/rollup/cube excluded) | 254-277 |
| 07-1-window-functions-multiple-frames | 07. row_number/lag/sum/avg over () | 311-335 |
| 07-2-named-window-clause | 07. window customer_window as (...) | 337-348 |
| 07-3-qualify-filter | 07. qualify | 350-359 |
| 08-1-union-all-three-way | 08. union all | 366-386 |
| 08-2-intersect | 08. intersect | 388-394 |
| 08-3-except | 08. except | 396-402 |
| 09-1-lateral-view-posexplode | 09. lateral view posexplode | 409-418 |
| 09-2-lateral-view-explode | 09. lateral view explode | 420-425 |
| 09-3-tablesample | 09. tablesample (from range() excluded) | 432-437 |
| 11-1-hint-distribute-sort-by | 11. hint + distribute by + sort by (values inline table excluded) | 494-502 |
| 11-2-cluster-by | 11. cluster by | 504-509 |
| 13-1-insert-overwrite-partition | 13. insert overwrite table ... partition ... select | 616-627 |
| 13-2-multi-insert-from | 13. multi-insert from ... insert overwrite ... insert overwrite ... | 629-645 |
| 16-1-comment-rich-select | 16. comment-rich select (-- and /* */ preserved) | 783-796 |
| 16-2-hiveconf-set-job-vars | 16. set job.run_date/previous_date = ${hiveconf:...} | 798-799 |
| 16-3-templated-insert-overwrite | 16. templated insert overwrite with ${...} | 801-814 |
| 17-1-nested-function-and-long-boolean-where | 17. long expressions + wrapping | 821-862 |

Excluded sections entirely: 10 (pivot/unpivot), 12 (DDL), 14 (scripting), 15 (metadata), 18
(transform). Excluded statements within included sections: grouping sets/rollup/cube (06),
`from range(...)` (09), `from values ...` inline table (11), insert-values/merge/update/
delete/load (13).

**Note on section 17**: the task brief for this batch expected "both statements" for section
17, but the corpus (verified by grepping every `;` in the file) contains only **one** statement
in that section (lines 821-862, one `select`). Created a single fixture
(`17-1-nested-function-and-long-boolean-where`) rather than inventing a second one.

## fixtures/unsupported/

One `.sql` file per excluded construct, each containing one statement copied verbatim from
`spark_sql_style_calibration.sql`.

| file | corpus lines | construct |
|---|---|---|
| grouping-sets.sql | 279-290 | `group by grouping sets (...)` |
| rollup.sql | 292-297 | `group by rollup (...)` |
| cube.sql | 299-304 | `group by cube (...)` |
| range-table-function.sql | 427-430 | `from range(...)` |
| values-inline-table.sql | 484-492 | `from values (...) as t(...)` |
| pivot.sql | 444-462 | `pivot (...)` |
| unpivot.sql | 464-477 | `unpivot include nulls (...)` |
| create-database.sql | 516-522 | `create database ...` |
| create-table.sql | 524-547 | `create table ... (...)` |
| create-view.sql | 565-578 | `create or replace view ...` |
| alter-table.sql | 584-588 | `alter table ... add columns (...)` |
| insert-values.sql | 609-614 | `insert into ... values (...)` |
| merge.sql | 647-668 | `merge into ... using ... when matched ...` |
| update.sql | 670-676 | `update ... set ... where ...` |
| delete.sql | 678-681 | `delete from ... where ...` |
| load-data.sql | 683-685 | `load data inpath ... overwrite into table ...` |
| declare-variable.sql | 692 | `declare or replace variable ...` |
| begin-block.sql | 707-723 | `begin ... if ... elseif ... end if; end;` |
| show-tables.sql | 734 | `show tables in ... like ...` |
| describe-table.sql | 738 | `describe table extended ... partition (...)` |
| analyze-table.sql | 746-747 | `analyze table ... compute statistics for all columns` |
| cache-table.sql | 751-758 | `cache lazy table ... as select ...` |
| explain.sql | 763-776 | `explain formatted with ... select ...` |
| transform-using.sql | 869-879 | `select transform (...) using '...' as (...)` |
