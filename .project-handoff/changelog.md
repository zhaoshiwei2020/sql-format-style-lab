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

## 2026-08-19 17:40 CST

- T-0003 dogfood 首轮：主测某 543 行真实 ETL 脚本→ 初判 UNKNOWN，暴露 `with ... insert` 缺口；修复后 VALID_SUPPORTED、门禁全过、输出与语料风格一致。
- 全库扫描内部数仓脚本库 178 个脚本，补齐三个语法缺口（with+insert / `!` 逻辑非 / 关键字别名），覆盖率 94%→98%（175/178），余 3 个均为诚实拒绝（F-0007）。
- 新增 golden-pending/hive/01-with-cte-insert-overwrite fixture + 3 个 parser 单测；测试 259/259，语料 43/43，pending 30/30。

## 2026-08-19 17:50 CST

- DDL 支持落地（三方分工：Opus parser / 主会话契约+printer / Sonnet 打包+护栏）：create table + drop table 进覆盖，fixtures/unsupported/drop-table.sql 因晋升移除。
- Q6 拍板选 A：DDL 列缩进维持 4 空格（D-0008）。
- VS Code 扩展打包 .vsix 并已安装（local.sql-style-calibrator），README 重写为使用文档。
- 新增 dogfood-scan CLI 与防泄漏 pre-commit 护栏（.privacy-denylist.local gitignored）。
- 真实覆盖：ddl 目录 180/181，脚本目录 175/178（F-0008）。测试 276/276，语料 46/46。

## 2026-08-19 18:20 CST

- 编辑器 dogfood 首日反馈闭环：Q7 拍板（then 前断行，D-0009），caseDoc 非链分支重写为三段式 choice，case/08/10/11 语料重生成。旧 formatter（renesaarsoo.sql-formatter-vsc）已卸载，settings.json 的 [sql] 已指向 local.sql-style-calibrator + formatOnSave。vsix 重打包重装。
