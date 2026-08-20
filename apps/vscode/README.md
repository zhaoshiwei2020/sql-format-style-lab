# SQL Formatter · Hive 二开版（VS Code 插件）

对 [sql-formatter](https://github.com/sql-formatter-org/sql-formatter)（即原
SQL-Formatter-VSCode 插件所用的引擎）做的行为二开，只改两件事，其余输出与
原插件完全一致：

1. **会话语句原样透传**：`set` / `use` / `add jar` / `add file` / `delete jar`
   / `reset` / `dfs` / `list` 开头的语句（含其上方的 banner 注释）不格式化，
   逐字节保留手写形态。再也不需要 `/* sql-formatter-disable */` 包 set 块，
   也就不会因为这对注释在把 SQL 复制进内部平台时报错。
2. **旧 disable 标记自动摘除**：老文件里的 `/* sql-formatter-disable */ ...`
   `/* sql-formatter-enable */` 区段内容原样保留、两个标记本身删除。

附带两条兜底，保证任何文件都不会格式化失败：

- Hive 的 `!` 逻辑非改写为等价的 `not`（spark 方言不认 `!`，原插件在这里直接
  报错）；
- 单条语句解析失败时该语句原样保留，不拖垮整个文件。

纯注释块（banner）同样不进引擎，逐字保留（仅去行尾空白）。

## 配置

沿用原插件的 `SQL-Formatter-VSCode.*` 配置键，老 settings 无缝迁移。默认值：

| 键 | 默认 | 说明 |
|---|---|---|
| `dialect` | `spark` | |
| `expressionWidth` | `88` | 单行表达式最大宽度。88 是实证值：`cast(sum(x) / 100 as decimal(16, 2)) as x` 这类句式落在 79~84 列，88 使其保持单行 |
| `tabSizeOverride` | `2` | 缩进（映射 sql-formatter 的 `tabWidth`） |
| `keywordCase` 等 | `lower` | keyword / dataType / function / identifier |
| `newlineBeforeSemicolon` | `true` | |
| `linesBetweenQueries` | `2` | 语句间空行数 |
| `paramTypes` | `{}` | `${hiveconf:...}` 模板始终额外识别，无需配置 |

## 打包安装

```bash
npm run package -w apps/vscode   # 产出 sql-style-calibrator-<version>.vsix
code --install-extension sql-style-calibrator-<version>.vsix --force
```

引擎为 sql-formatter（MIT），已打进 bundle，vsix 不带 node_modules。

## 与 packages/core（自研 formatter）的关系

`packages/core` 是本仓库第一阶段自研的确定性 formatter（四态诚实 + 三重安全
门，见根目录 ARCHITECTURE.md），截至 2026-08-20 冻结为研究成果、不再迭代；
日常格式化由本插件承担。自研版本的关键审美结论（lineWidth 88 等）已迁移到
本插件的默认值。
