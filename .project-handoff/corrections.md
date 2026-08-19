# Corrections

### C-0001｜ARCHITECTURE §9.2 的 lineWidth: 100 不是语料事实

- Incorrect: 按 §9.2 候选配置里的 `"lineWidth": 100` 校对输出或写规则
- Correct: 语料实际手排基准在 78~80（宽度扫描实证 78 最优）；100 会导致几十处"放得下却断行"无法解释
- Corrected on: 2026-08-19
- Basis: F-0002, S-0004
- Affected files/tasks: packages/core/src/profile.ts, docs/calibration-questions.md Q1
- Prevention: 新会话不要"顺手把 78 改回 100 对齐文档"；以 fixtures 和校准题拍板为准

### C-0002｜ARCHITECTURE §8 示例不是 golden 事实

- Incorrect: 把 §8"最终得到"的示例输出（LHS substr 展开、RHS concat 保持紧凑）当作目标行为
- Correct: 语料 S-0002 §05 对同一表达式的排法与该示例相反（LHS 平铺、RHS 展开）；文档示例与语料冲突时以 fixtures 为准，该冲突已收进校准题 Q2 语境
- Corrected on: 2026-08-19
- Basis: F-0001, S-0001, S-0002
- Affected files/tasks: packages/core/src/printer/expr.ts（binaryDoc 备选顺序）
- Prevention: 校对排版行为一律对 fixtures 跑 divergence-report，不对文档示例目测
