# Current state

- Last updated: 2026-08-19 17:10 CST
- Active workstream: formatter 核心（单一工作流）
- Current objective: 个人 dogfood（ARCHITECTURE Phase 3）：VS Code 实装到日常 Hive SQL 工作流，收集覆盖缺口
- Current status: 第一批校准题 Q1~Q5 已全部拍板落地（D-0006/D-0007）。语料复现 42/42，golden 13/13，golden-pending 29/29，测试 256/256 全绿。compactMaxWidth 50→54（实证窗口 [52,56] 中点），"结构回声"规则已按 Q5 删除。

## Active tasks

### T-0003｜dogfood
- Status: pending
- Inputs: apps/vscode（F5 调试，formatter id `local.sql-style-calibrator`）
- Output: 真实工作 SQL 上的 unsupported/unknown 缺口清单（fixtures/failures/）+ 新审美分歧（若有，走 A/B 校准题流程）
- Next action: VS Code 装载插件，对真实 Hive 脚本试格式化；lineWidth 78 是否合适也在此阶段用体感验证（Q1 非终局）
- Blocker: none（T-0001 已完成解除依赖）

## Completed recently

### T-0001｜校准题 Q1~Q5 拍板与落地
- Status: completed (2026-08-19)
- Outcome: Q2/Q3/Q4 选 A → case/05/07/11 语料按 formatter 输出重生成；Q5 选"放得下就一行" → 删结构回声规则 + case/03 重生成 + compactMaxWidth 54（D-0007）；Q1 暂维持 78。详见 D-0006 与 docs/calibration-questions.md 内标注。

## Files to reopen next session

- docs/calibration-questions.md — 五题拍板结论都标注在内；新分歧照此格式追加
- CLAUDE.md — 铁律 + 语料反推的排版规则总表（已随拍板更新）
- packages/core/src/printer/expr.ts — 排版规则实现（头注释是规则清单）
- docs/divergence-report.md — 可用 `node --experimental-strip-types packages/core/scripts/divergence-report.ts` 重生成

## Unresolved questions

- lineWidth 78 是否终局（Q1）— 用户无明确偏好，dogfood 体感后再定
- MemberExpr 是否进 cst.ts — parser 目前用 dot-opToken 的 BinaryExpr 表达 `f(...).a.b`（parser 作者标注的契约 workaround），若扩语法建议正式建节点
- 语句级原子性（ARCHITECTURE §23-5）— 待 dogfood 数据
