# Current state

- Last updated: 2026-08-19 17:40 CST
- Active workstream: formatter 核心（单一工作流）
- Current objective: 个人 dogfood（ARCHITECTURE Phase 3）：VS Code 实装到日常 Hive SQL 工作流，收集覆盖缺口
- Current status: 校准题 Q1~Q5 已落地；dogfood CLI 首轮完成——真实库 178 脚本 175 个 VALID_SUPPORTED（F-0007），三个语法缺口已补。测试 259/259，语料 43/43，pending 30/30 全绿。

## Active tasks

### T-0003｜dogfood
- Status: in-progress
- Inputs: apps/vscode（F5 调试，formatter id `local.sql-style-calibrator`）；内部数仓真实脚本库（路径见本地会话记忆）
- Output: 覆盖缺口修复 + 新审美分歧（若有，走 A/B 校准题流程）
- Progress: CLI 首轮完成（2026-08-19，F-0007）——178 个真实脚本 175 个 VALID_SUPPORTED，三个语法缺口（with+insert / `!` 逻辑非 / 关键字别名）已修复并加测试
- Next action: VS Code F5 装载插件在编辑器里实际用（保存即格式化体验）；lineWidth 78 是否合适用体感验证（Q1 非终局）；真实输出是否要写回工作仓库由用户决定
- Blocker: none

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
