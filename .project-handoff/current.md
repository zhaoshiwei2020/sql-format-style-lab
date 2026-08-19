# Current state

- Last updated: 2026-08-19 15:55 CST
- Active workstream: formatter 核心（单一工作流）
- Current objective: 校准题拍板后收敛 golden 100%，进入个人 dogfood（ARCHITECTURE Phase 2 收尾 → Phase 3）
- Current status: Phase 0+1+大半 Phase 2 已交付。测试 253/256（3 红为校准信号），语料复现 38/42，1300 行 p95=35ms（含门禁）。

## Active tasks

### T-0001｜校准题 Q1~Q5 等用户拍板
- Status: blocked
- Inputs: docs/calibration-questions.md, S-0004
- Output: 拍板结果 → 改 fixtures 语料或改 printer 规则
- Next action: 用户逐题选 A/B 后，按选项修改并把 golden 收敛到 13/13
- Blocker: 需用户决策（审美主观项，不可代答）

### T-0002｜推送 GitHub 仓库
- Status: in_progress
- Inputs: https://github.com/zhaoshiwei2020/sql-format-style-lab.git（用户已建好）
- Output: main 分支含全部代码 + handoff 可移植状态
- Next action: git init → 根 .gitignore → commit → push
- Blocker: none

### T-0003｜dogfood 准备
- Status: pending
- Inputs: apps/vscode（F5 调试，formatter id `local.sql-style-calibrator`）
- Output: 真实工作 SQL 上的 unsupported/unknown 缺口清单（fixtures/failures/）
- Next action: T-0001 完成后，VS Code 装载插件对真实 Hive 脚本试格式化
- Blocker: 依赖 T-0001

## Files to reopen next session

- docs/calibration-questions.md — 待拍板的 5 道 A/B 题，决定下一步全部工作
- CLAUDE.md — 铁律 + 语料反推的排版规则总表
- packages/core/src/printer/expr.ts — 排版规则实现（头注释是规则清单），拍板后改这里
- docs/divergence-report.md — 可用 `node --experimental-strip-types packages/core/scripts/divergence-report.ts` 重生成

## Unresolved questions

- Q1~Q5（见 calibration-questions.md）— 直接决定 golden 能否 100% 与默认 profile 的最终值
- MemberExpr 是否进 cst.ts — parser 目前用 dot-opToken 的 BinaryExpr 表达 `f(...).a.b`（parser 作者标注的契约 workaround），若扩语法建议正式建节点
- 语句级原子性（ARCHITECTURE §23-5）— 待 dogfood 数据
