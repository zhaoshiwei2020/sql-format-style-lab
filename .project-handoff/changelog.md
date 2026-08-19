# Changelog

## 2026-08-19 15:55 CST

- 初始化 project-handoff 状态（software profile）。
- 记录 S-0001~S-0007、F-0001~F-0006、D-0001~D-0005、C-0001~C-0002、T-0001~T-0003。
- 项目状态快照：Phase 0+1+大半 Phase 2 完成；测试 253/256；语料复现 38/42；1300 行 p95=35ms；VS Code 插件壳可构建。
- 待办主线：校准题 Q1~Q5 拍板（T-0001，blocked on user）→ golden 100% → dogfood。

## 2026-08-19 16:05 CST

- Completed T-0002：git init（main）→ rebase 远端初始 README → 推送 https://github.com/zhaoshiwei2020/sql-format-style-lab.git（commit 4b8b706，174 文件；node_modules/dist/handoff 本地态均排除）。
- 远端原有 README.md 仅一行标题，保留待后续补充（S2 内推阶段再写正式 README，见 ARCHITECTURE ADR-009 分级）。
## 2026-08-19 17:10 CST

- Completed T-0001：用户拍板校准题 Q1~Q5（Q3/Q4/Q5 经真实输出对比预览确认）。
- 落地：case/03/05/07/11 语料按 formatter 输出重生成；printer 删除"结构回声"规则（Q5）；compactMaxWidth 50→54（实证窗口 [52,56] 中点，D-0007）；schema 遗留 lineWidth default 100→78 连带修正。
- 结果：语料 42/42、golden 13/13、golden-pending 29/29、测试 256/256 全绿。
- 新增 D-0006/D-0007；D-0003 标记 superseded。
- 下一步主线：T-0003 dogfood。
