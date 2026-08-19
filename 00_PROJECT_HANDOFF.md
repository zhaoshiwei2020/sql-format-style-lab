# sql-style-calibrator — Project Handoff

## 项目目的

个人用 Hive SQL 风格校准器 + 规范化 formatter（VS Code 插件 + core 库）。
产品定义、全部架构裁决（ADR-001~014）见 `ARCHITECTURE.md` v0.3 第 26 节——那是架构事实源，本 handoff 不复制它。

## 新会话如何恢复

1. `python3 <skill-dir>/scripts/handoff.py session-brief --root .`（另一窗口可能改过 → 加 `--git` hot-refresh）
2. 读 `.project-handoff/current.md` + 本仓库 `CLAUDE.md`（含铁律与语料反推的排版规则表）
3. 按当前任务需要再打开 `docs/calibration-questions.md` 或 printer 源码

## 不可协商的约束与危险误解

- **golden.test.ts 红着的 3 个用例（case/05、07、11）是故意的校准信号**（= 校准题 Q2/Q3/Q4），未经用户拍板不得加特判转绿、不得改语料（D-0003）。
- 两份根目录 calibration 语料**内部互相矛盾**（F-0001）——分歧走 A/B 校准题流程，不过拟合（D-0004）。
- 四态诚实：parser 永不报 INVALID；只有词法可证错误才 INVALID（F-0006）。任何非 VALID_SUPPORTED → 整篇零 edits。
- 安全门禁（token preservation / 结构指纹 / 幂等）不可绕过。
- ARCHITECTURE §9.2 的 lineWidth 100 示例和 §8 的断行示例**不是** golden 事实（C-0001、C-0002）；golden 以 fixtures/ 为准。

## 当前工作

单一工作流（formatter 核心），无独立 workstream 文件。活跃任务见 `.project-handoff/current.md`：
等用户拍板校准题 Q1~Q5 → 收敛 golden 100% → dogfood。

## 事实源层级

1. fixtures/golden/**（人工审定语料，字节级事实）
2. packages/core 源码与测试（253/256）
3. ARCHITECTURE.md v0.3（架构裁决）
4. docs/（divergence-report 可再生成；calibration-questions 待拍板）
5. README/注释（最低优先）

## Last validated

2026-08-19（init 当日，validate 通过情况见 changelog）
