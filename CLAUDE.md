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
5. lineWidth 默认 88（Q1 终局拍板 2026-08-20，dogfood 实证：高频句式 cast(sum(x) / 100 as decimal(16, 2)) 落在 79~84 列，88 使其保持单行；见 docs/calibration-questions.md）。
6. 第一批校准题 Q1~Q5 已全部拍板落地（2026-08-19，见 docs/calibration-questions.md 内标注）：golden 13/13、语料 42/42、golden-pending 29/29 全绿。后续新分歧仍走同一流程：先记 divergence-report、开 A/B 校准题，未经用户拍板不得改语料或加特判。

## 模块归属

- printer/（Doc IR + solver + 排版规则）：核心审美逻辑，改动需跑 divergence-report 对比前后。
- lexer.ts / dialects/：lossless 词法，70+ 单测。
- parser.ts：tolerant CST，token 完整性有专项测试（树上 token 与词法流一一对应）。
- safety.ts / coverage.ts：门禁与四态分类。
- apps/vscode：插件壳，formatter id `local.sql-style-calibrator`。

## 语料反推出的关键排版规则（printer/expr.ts 头注释有全表）

- 布尔链：flat 放得下才单行；否则一行一操作数、and/or 行首。
- 括号布尔组：flat 宽度 ≤ booleanGroup.compactMaxWidth(54) 才保持单行，任意嵌套深度独立判断（Q5 拍板去掉了"结构回声"强制跟拆；54 = 实证窗口 [52,56] 中点）。
- 加法链断行=运算符行首；乘法链从不把运算符移到行首，只强制展开括号操作数（"粘连"风格）。
- 窗口 over (...) 规格永远展开；带 over 且参数含嵌套调用的聚合，参数列表强制展开。
- WHEN 短则单行；条件为链且放不下 → when 独行、then 对齐。
- where/having 多条件永远展开；join on 首条件同行、后续条件行首对齐。

## 隐私护栏（公开仓库）

本仓库公开。公司内部标识（库名/表名/集群域名/业务词）不得进入任何被 git 跟踪的文件；fixtures 一律用 style_lab.* 合成名。提交前 pre-commit hook 会用 `.privacy-denylist.local`（gitignored，本机各自维护）跑 `tools/check-privacy.sh` 拦截；全量自查跑 `tools/check-privacy.sh --all`。dogfood 批量扫描用 `node --experimental-strip-types packages/core/scripts/dogfood-scan.ts <dir>`（只读、不落盘）。
