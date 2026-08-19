# Sources

### S-0001｜ARCHITECTURE.md v0.3

- Type: document
- Location: ARCHITECTURE.md
- Inspected: yes
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: primary
- Supports: D-0001, F-0006
- Limitations: §8 与 §9.2 的排版示例与语料不符（见 C-0001、C-0002），示例不作 golden 事实

### S-0002｜complex_case 审美语料

- Type: document
- Location: complex_case_style_calibration.sql
- Inspected: yes
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: primary
- Supports: F-0001, F-0002
- Limitations: 人工手排，存在自身不一致（如 §06 vs §13 同构不同排）

### S-0003｜spark 审美语料

- Type: document
- Location: spark_sql_style_calibration.sql
- Inspected: yes
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: primary
- Supports: F-0001, F-0002
- Limitations: 与 S-0002 直接冲突处（嵌套括号组、比较断行侧）；部分语法超出 Hive v1 范围

### S-0004｜分歧报告（生成物）

- Type: document
- Location: docs/divergence-report.md
- Inspected: yes
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: internal-draft
- Supports: F-0001, F-0002
- Limitations: 由脚本再生成，内容随代码/语料变化；引用前先重跑

### S-0005｜校准题文档

- Type: document
- Location: docs/calibration-questions.md
- Inspected: yes
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: internal-draft
- Supports: D-0003, D-0004
- Limitations: Q1~Q5 均未拍板

### S-0006｜sql-formatter bake-off 调研

- Type: document
- Location: docs/bakeoff-sql-formatter.md
- Inspected: partial
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: secondary
- Supports: F-0005
- Limitations: 由 Sonnet 子代理调研产出，主会话只审阅了结论摘要，逐条引用前应复核原文与上游链接

### S-0007｜packages/core 源码与测试

- Type: code
- Location: packages/core/
- Inspected: yes
- Inspected on: 2026-08-19
- Integrity: not calculated
- Authority: primary
- Supports: F-0003, F-0004, F-0006
- Limitations: printer/ 由主会话手写并逐行掌握；lexer.ts/parser.ts 由子代理实现，主会话审阅了契约面与测试结果，未逐行审阅实现体
