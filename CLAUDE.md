# sql-style-calibrator

Hive SQL 风格校准器 + 规范化 formatter。方案与全部裁决见 ARCHITECTURE.md（v0.3，第 25/26 节为评审记录）。

## 命令

```bash
npm run typecheck                # tsc core
npm test                         # vitest 全部
./node_modules/.bin/vitest run packages/core/test/golden.test.ts   # 仅 golden
node --experimental-strip-types packages/core/scripts/dev-format.ts <file.sql>
node --experimental-strip-types packages/core/scripts/divergence-report.ts  # → docs/divergence-report.md
node --experimental-strip-types packages/core/scripts/coverage-report.ts    # golden-pending 通过率
```

## 铁律（改代码前必读）

1. **四态诚实**：INVALID 只允许由"可证明的词法错误"产生；parser 解析不了= UNKNOWN，不是语法错误。任何非 VALID_SUPPORTED → 整篇零 edits。
2. **安全门禁不可绕过**：token preservation / structural fingerprint / 幂等，三关全过才写回。
3. **契约文件**（tokens.ts / cst.ts / profile.ts / result.ts）改动要极其谨慎——lexer/parser/printer/safety 四方共享。
4. **语料即事实**：fixtures/golden/case 必须逐字节通过；fixtures/golden-pending 是目标集；两份根目录 calibration .sql 是人工审定的审美源，**已知内部存在不一致**（详见 docs/divergence-report.md），分歧优先记报告、开 A/B 校准题，不要为单例过拟合加特判。
5. lineWidth 默认 78（宽度扫描 75~80 的经验最优；待用户校准，见 docs/calibration-questions.md）。
6. golden.test.ts 目前故意红着 3 个用例（case/05、07、11）= 校准题 Q2/Q3/Q4，未经用户拍板不得为"转绿"加特判或改语料。

## 模块归属

- printer/（Doc IR + solver + 排版规则）：核心审美逻辑，改动需跑 divergence-report 对比前后。
- lexer.ts / dialects/：lossless 词法，70+ 单测。
- parser.ts：tolerant CST，token 完整性有专项测试（树上 token 与词法流一一对应）。
- safety.ts / coverage.ts：门禁与四态分类。
- apps/vscode：插件壳，formatter id `local.sql-style-calibrator`。

## 语料反推出的关键排版规则（printer/expr.ts 头注释有全表）

- 布尔链：flat 放得下才单行；否则一行一操作数、and/or 行首。
- 括号布尔组：flat 宽度 ≤ booleanGroup.compactMaxWidth(50) 且不在已展开括号内才保持单行。
- 加法链断行=运算符行首；乘法链从不把运算符移到行首，只强制展开括号操作数（"粘连"风格）。
- 窗口 over (...) 规格永远展开；带 over 且参数含嵌套调用的聚合，参数列表强制展开。
- WHEN 短则单行；条件为链且放不下 → when 独行、then 对齐。
- where/having 多条件永远展开；join on 首条件同行、后续条件行首对齐。
