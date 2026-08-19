# 第一批校准 A/B 题（2026-08-19）

formatter 已在 42 组语料中 38 组逐字节复现人工排版。剩余 4 组分歧经逐一归因，
**全部是两份人工语料互相矛盾或自身不一致的点**——机械规则无法同时满足，需要你拍板。
拍板后：选 A 则改 fixtures 语料，选 B 则加/改 printer 规则，golden 即可 100%。

## Q1: lineWidth 到底是多少？（已临时定 78）

宽度扫描（75→80）实证：78 使 36/42 逐字一致（80 为 35，100 差得多）。语料显然是按
78~80 手排的，且有 2 行超宽（81、99 字符）被人工容忍。
- A. 定为 78（当前默认，对语料拟合最好）
- B. 定为 80/100 + "不可拆单元允许小幅超宽"的软上限（ARCHITECTURE §23-Q1）

## Q2: 放得下的嵌套调用要不要为"视觉平行"而断行？(case/05)

```sql
-- 人工语料（把 78 字符、放得下的条件 1 断开，与条件 2 呼应）
when
    substr(confirm_time, 1, 10) > last_day(
        concat(report_month, '-01')
    )
    or substr(date_add(confirm_time, 729), 1, 10) < concat(
        report_month,
        '-01'
    )
-- formatter（条件 1 放得下就不断）
when
    substr(confirm_time, 1, 10) > last_day(concat(report_month, '-01'))
    or substr(date_add(confirm_time, 729), 1, 10) < concat(
        report_month,
        '-01'
    )
```
- A. 认可 formatter：放得下就不断（规则可解释，推荐）
- B. 坚持语料：需要"相邻条件结构对齐"规则（实现复杂且主观性强）

## Q3: 已展开的聚合参数里，77 字符的 if(...) 断不断？(case/07)

语料自身不一致：case/07 断了 77 字符的 `if(...)`，case/13 却保留了 71 字符的同构
`if(...)`。阈值不可知。
- A. 认可 formatter：放得下（≤ lineWidth）就不断，case/07 语料改掉
- B. 给"已展开参数列表内的嵌套调用"设更小的紧凑阈值（新配置项）

## Q4: cast 内部的 `expr as type` 超宽时保持一行吗？(case/11)

语料把 99 字符的 `if(...) as decimal(18, 2)` 保留在一行（超过任何合理行宽）；
formatter 按行宽把 if 参数展开了。
- A. 认可 formatter：超宽就展开（无特例）
- B. 语料是对的：cast 内壁尽量单行，允许超宽（= Q1 选 B 的软上限特例）

## Q5: 嵌套括号布尔组是否随外层展开？(spark/17-1，两份语料直接冲突)

同为 46 字符、同处已展开括号内的布尔组：complex_case §03 展开了，spark §17 保留单行。
当前实现随 complex_case（"结构回声"规则：外层括号展开 → 内层括号组跟随展开）。
- A. 维持现状（complex_case 优先，spark 语料改掉）
- B. 嵌套括号组独立按 compactMaxWidth(50) 判断（spark 优先，complex_case 语料改掉）

---

附：当前 `golden.test.ts` 红着的 3 个用例（05/07/11）即 Q2/Q3/Q4，属故意保留的
校准信号，不是回归。完整 diff 见 docs/divergence-report.md（运行
`node --experimental-strip-types packages/core/scripts/divergence-report.ts` 重新生成）。
