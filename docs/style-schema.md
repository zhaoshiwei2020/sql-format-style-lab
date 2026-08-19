# `.sqlstyle.jsonc` 配置项参考

本文档列出 `StyleProfile`（`packages/core/src/profile.ts`）的每一个配置项，对应
JSON Schema 见 `packages/core/schema/sqlstyle.schema.json`。字段含义与 v1 语义
以 `ARCHITECTURE.md` §9.2（风格配置设计）为准；Schema 与本文档必须与
`profile.ts` 保持逐字段同步。

约定：

- 表中"允许值"为空表示该字段是自由格式（字符串或数字），不是受限枚举。
- S1（当前阶段）中标注"固定值"的字段技术上仍是可配置的 JSON 字段，但 v1
  只承认其默认值；配置为其他值会被 `resolveProfile` 记为 `CFG001` 警告并回退
  为默认值，不影响其它字段的解析。
- 未知的顶层或嵌套配置键会产生 `CFG001` 警告（列出完整键路径，如
  `case.madeUp`），不会导致解析失败。

## 顶层字段

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `version` | integer | `1` | `1` | 配置文件格式版本。非 1 会记为 `CFG001` **错误**（而非警告），并整体回退到内置默认 profile。 |
| `dialect` | string | `"hive"` | `"hive"`（固定值） | SQL 方言。S1 仅支持 HiveQL；`spark`/`generic` 留待后续阶段。 |
| `dialectVersion` | string | `"1.1"` | 自由字符串 | 方言的具体版本号，避免把仅存在于新版本的关键字误判为旧版本语法。 |
| `mode` | string | `"canonical"` | `"canonical"`（固定值） | 格式化模式。S1 只提供规范化模式：相同 token/方言版本/profile 恒定收敛到同一输出，不提供"尽量保留原布局"模式。 |
| `unsupportedBehavior` | string | `"leave-document-unchanged"` | `"leave-document-unchanged"`（固定值） | 遇到 `VALID_UNSUPPORTED`/`INVALID`/`UNKNOWN` 时的行为：整篇文档原子性，不改动源文件，只给出诊断。 |
| `lineWidth` | integer | `100` | 任意正整数 | 期望的最大行宽（字符数），驱动 layout solver 的换行决策。 |
| `keywordCase` | string | `"lower"` | `"lower"` \| `"upper"` \| `"preserve"` | 关键字（`select`/`from`/`where` 等）大小写策略。 |
| `functionCase` | string | `"lower"` | `"lower"` \| `"upper"` \| `"preserve"` | 函数名大小写策略。 |
| `dataTypeCase` | string | `"lower"` | `"lower"` \| `"upper"` \| `"preserve"` | 数据类型名（`string`/`bigint` 等）大小写策略。 |
| `semicolon` | string | `"same-line"` | `"same-line"`（固定值） | 语句末尾分号的位置：与最后一个 token 同行。 |
| `maxConsecutiveBlankLines` | integer | `2` | 任意非负整数 | 仅语句之间、以及独占一行注释之前允许保留的最大连续空行数；语句内部空白始终完全规范化。 |

## `indent`

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `indent.style` | string | `"space"` | `"space"`（固定值） | 缩进字符类型，当前仅支持空格。 |
| `indent.size` | integer | `4` | 任意正整数 | 每级缩进使用的空格数。 |

## `case`（CASE 表达式排版）

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `case.shortWhen` | string | `"single-line"` | `"single-line"`（固定值） | 整个 WHEN 子句能放进一行时，保持 `when condition then result` 单行书写。 |
| `case.wrappedWhen.layout` | string | `"when-own-line"` | `"when-own-line"`（固定值） | 换行时 `when` 关键字独占一行，条件缩进一级。 |
| `case.wrappedWhen.logicalOperator` | string | `"leading-indented"` | `"leading-indented"`（固定值） | 多个条件之间的 `and`/`or` 作为行首逻辑运算符并缩进对齐，体现真实括号层级。 |
| `case.wrappedWhen.then` | string | `"align-with-when"` | `"align-with-when"`（固定值） | `then` 子句与 `when` 对齐排版。 |
| `case.nestedCase` | string | `"indent-one-level"` | `"indent-one-level"`（固定值） | CASE 嵌套在另一个 CASE 内部时，整体再缩进一级。 |

## `functionCall`（函数调用排版）

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `functionCall.wrapStrategy` | string | `"outermost-first"` | `"outermost-first"`（固定值） | 函数调用放不下一行时优先展开最外层调用（如 `substr(...)`），内层嵌套调用（如 `date_add(...)`）尽量保持紧凑。见 ARCHITECTURE.md §8。 |
| `functionCall.wrappedArguments` | string | `"one-per-line"` | `"one-per-line"`（固定值） | 参数列表换行展开时，每个参数独占一行。 |
| `functionCall.keepCompactNestedCalls` | boolean | `true` | `true` \| `false` | 外层函数展开后，只要内层嵌套调用自身能放进一行就保持紧凑，不随外层强制展开。 |
| `functionCall.closingParenthesis` | string | `"own-line"` | `"own-line"`（固定值） | 函数调用展开时右括号是否独占一行。 |
| `functionCall.keepShortComparisonSideInline` | boolean | `true` | `true` \| `false` | 比较表达式一侧展开换行时，只要另一侧（如短小的 `concat(...)`）本身能放进一行，就不随之连带展开。 |

## `select`（SELECT 列表排版）

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `select.multipleItems` | string | `"one-per-line"` | `"one-per-line"`（固定值） | SELECT 列表包含多列时每列独占一行。 |
| `select.comma` | string | `"trailing"` | `"trailing"`（固定值） | 列表项之间逗号置于当前行末尾（而非下一行行首）。 |

## `booleanGroup`（带括号的布尔子表达式）

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `booleanGroup.compactMaxWidth` | integer | `50` | 任意正整数 | 带括号的布尔子表达式分组，只有展开后单行宽度不超过该值、且未嵌套在已展开的括号分组内时才保持紧凑；否则展开。语料参考：约 46 字符的分组在最外层保持紧凑，约 60+ 字符的分组总是展开。 |

## `templates`（模板占位符）

| Key | 类型 | 默认值 | 允许值 | 中文说明 |
|---|---|---|---|---|
| `templates.preserve` | boolean | `true` | `true`（固定值） | 模板占位符（`${hiveconf:month}`、`#{run_date}`、`{{ run_date }}`、`{% if ... %}` 等）必须原样保留，不参与格式化改写。 |
| `templates.customPatterns` | string[] | `[]` | 字符串数组（正则表达式源码） | 用户自定义的模板占位符正则，用于在内置四种形式之外识别更多占位符；正则必须有超时与长度保护，避免灾难性回溯。 |

## 配置解析优先级

```text
文件最近父目录 .sqlstyle.jsonc
    > workspace 根配置
    > VS Code 用户设置
    > 内置默认值
```

多 root workspace 分别解析，不共享错误配置（ARCHITECTURE.md §9.1）。

## 未知/非法配置的处理

- **未知配置项**（顶层或嵌套）：产生 `CFG001` 警告，列出完整键路径（如
  `functionCall.madeUp`），该键被忽略，其余字段正常解析。
- **`version` 不为 `1`**：产生 `CFG001` 错误，整个 profile 回退为内置默认值。
- **类型不匹配的值**（如 `lineWidth` 传了字符串）：产生 `CFG001` 警告，该字段
  保留默认值，其余字段不受影响。
- 解析函数（`resolveProfile`、`loadProfileForFile`）**永不抛出异常**；无法
  解析的配置文件同样回退为内置默认值并给出诊断。
