# 个性化 SQL Formatter：VS Code 插件架构设计

> 状态：Draft v0.3，已根据第二轮核心需求澄清修订；当前裁决见第 26 节  
> 日期：2026-08-19  
> 工作代号：`sql-style-calibrator`（非正式产品名）  
> 首要目标方言：项目实际运行环境中的 HiveQL（以 Hive 1.1 常用语法为首批基线）  


## 1. 摘要

我们要做的不是一个“选项更多的 SQL Formatter”，也不是让模型在每次保存时临场发挥，而是一个**先用高覆盖 Hive 语法题库完成一次审美校准，再以本地、确定性、安全的方式把该风格固化执行**的系统。

核心产品循环：

```text
版本化的 Hive 语法场景目录
    ↓
用户查看完整模板，并通过 A/B 选择或直接修改完成校准
    ↓
编译成可读、可编辑、可版本管理的 .sqlstyle.jsonc
    ↓
本地确定性规范化格式引擎
    ↓
VS Code 快捷键 / Format on Save

可选后续能力：从历史文件推断候选偏好、显式的结构重构建议、CLI/CI。
```

最重要的架构边界：

1. 校准过程决定风格；AI 和统计推断都不参与每一次保存时的格式化。
2. 日常格式化必须完全本地、快速、确定、可重复。
3. 普通格式化只改变空白、换行及用户明确授权的大小写，不重写 SQL 逻辑。
4. 只有“语法已识别且打印规则完整覆盖”的文档才格式化；否则原文不动并给出准确原因。
5. 风格文件是最终事实；校准器是首要生成方式，历史样例推断只是未来可选的快捷入口。


## 2. 背景与问题定义

当前 SQL Formatter VS Code 插件支持 Hive、Spark 和少量全局选项，但其布局模型难以表达以下偏好：

- CASE 条件较短时保持 `when condition then result`。
- CASE 条件换行后，`when` 后仍优先保留第一个条件。
- 长条件中的 `and/or` 作为行首逻辑运算符，并体现真实的括号层级。
- `substr(date_add(...), 1, 10)` 太长时只展开最外层 `substr`，内层 `date_add` 保持紧凑。
- 比较表达式右侧的短 `concat(...)` 不应因为左侧展开而连带展开。
- 同一个函数在不同结构复杂度和剩余行宽下采用不同布局。
- `${hiveconf:month}`、`SET`、Hive hints、`lateral view` 等必须作为一等语法处理。

现有工具的问题不只是“配置项不够”，而是底层 formatter 对语法结构和候选布局的表达能力不足。`sql-formatter` 官方也说明项目已进入维护模式，并认为旧架构存在无法修补的基础限制：<https://github.com/sql-formatter-org/sql-formatter>。


## 3. 产品目标与非目标

### 3.1 产品目标

#### P0：安全、稳定地格式化

- 首版成熟支持整个文档格式化；选中范围在整篇链路稳定后增加。
- 支持 VS Code 原生 `editor.formatOnSave`。
- 对相同 SQL 和相同配置永远产生相同结果。
- 满足幂等性：`format(format(sql)) === format(sql)`。
- 保留注释、hint、字符串、模板变量、额外括号和语句顺序。
- 发现未知或不安全语法时保守退出，不损坏源文件。

#### P1：表达细腻的个人风格

- 风格规则不仅能描述“缩进几个空格”，还可以描述语法上下文。
- 支持“能放下就紧凑，放不下时优先展开外层”的策略。
- 支持 CASE、函数、布尔表达式、SELECT 列表、JOIN、CTE 等分别配置。
- 风格文件可读、可编辑、可提交到 Git。

#### P2：一次校准、稳定固化

- 内置一个按 Hive 语法能力分类的高覆盖校准文件/向导，而不是要求用户准备大量历史样例。
- 用户通过直接修改模板或少量 A/B 决策确定偏好，并生成固定 profile。
- 同一语法结构与同一 profile 始终收敛到唯一布局；保存后无需再手调。
- 后续允许显式微调 profile，但不持续学习、不根据单个文件悄悄改变规则。
- 从历史 SQL 推断 profile 是后续增强，不是首个可用版本的前置条件。

#### P3：Hive 实战可用

- 首批覆盖用户工作中绝大多数 HiveQL 常用语法；以 Hive 1.1 兼容语法和真实项目语料建立版本化支持矩阵。
- 支持多条 `SET` 语句、`insert overwrite`、动态分区、CTE、窗口函数、Hive `if()`、`lateral view`、`distribute by`、`sort by`。
- 原子化保护 `${hiveconf:month}`、`${var}` 等模板占位符。
- Spark SQL 扩展进入后续阶段，不与首版 Hive 成熟度争夺资源。

### 3.2 明确非目标

- v1 不做 SQL 优化器。
- v1 不自动提取 CTE、不合并条件、不改写 `not exists`、不替换函数。
- v1 不验证表名、字段名或业务口径。
- 普通 Format 命令不做跨语句重构。
- v1 不承诺覆盖世界上所有 SQL 方言和所有存储过程语法。
- v1 不在保存文件时调用大模型。
- v1 不根据当前文件自动漂移风格，也不提供“尽量保留原布局”的第二套模式。
- v1 不对已识别但尚无打印规则的语法做猜测性、局部性改写。

将来可以增加独立的“AI 重构建议”，但它必须和确定性 Format 命令彻底分离，并通过明确的 diff 让用户确认。


## 4. 架构原则

### 4.1 Lossless first

格式化器不能只使用会丢失信息的 AST。普通 AST 往往不保留：

- 注释的精确位置；
- 多余但有意保留的括号；
- 原始关键字大小写；
- 引号类型；
- hint；
- 模板变量；
- 语句末尾是否有分号。

因此核心数据结构必须是保留原始 token 的 lossless 语法表示（具体采用自研 CST、生成 parser 还是适配现成 parser，由 Phase 0 决定）。parser 已识别但 printer 尚未覆盖的结构形成 `UnsupportedNode`；系统保留全部 token，但整次格式化返回零 edits。parser 自己无法识别时返回 `UNKNOWN`，不在未知区域内外混合重排。

### 4.2 Format is not refactor

格式化只改变 trivia：空格、换行、缩进，以及配置明确允许的关键字/函数/类型大小写。

例如下面的 SQL 可以通过重构变得更短：

```sql
substr(confirm_time, 1, 10) > month_end
or substr(date_add(confirm_time, 729), 1, 10) < month_start
```

但普通格式化不能擅自提前计算 `confirm_date`、`validity_end_date`。这属于重构，不属于排版。

### 4.3 Deterministic core, calibrated onboarding

首次使用通过语法场景目录校准 profile；真正的 formatter 只能读取固定配置并确定性执行。未来的样例推断或 AI 只能提出 profile 变更建议，不能直接改变保存时行为。

### 4.4 Fail closed

任何无法证明安全的结果都不写回编辑器：

- 输入解析失败且无法形成安全的局部结构；
- 输出重新解析失败；
- 非空白 token 序列异常变化；
- 字符串、注释、模板 token 被改动；
- 二次格式化结果不同。

### 4.5 Configuration is an API

`.sqlstyle.jsonc` 是长期资产，需要有：

- JSON Schema；
- 配置版本；
- 默认值；
- 迁移器；
- 向后兼容策略；
- 明确的规则语义。

### 4.6 Canonical output

首版只提供规范化模式：

```text
canonicalSql = format(nonWhitespaceTokens, dialectVersion, styleProfile)
```

输入原本怎样换行不参与布局决策。只要 token、方言版本和 profile 相同，输出就相同。这是“保存即格式化且不需要保存后手调”的必要条件。

### 4.7 Coverage honesty

系统必须区分四种结果，不能把“解析器还不认识”伪装成“SQL 语法错误”：

| 状态 | 含义 | 行为 |
|---|---|---|
| `VALID_SUPPORTED` | 语法有效，且所有节点都有打印规则 | 执行格式化 |
| `VALID_UNSUPPORTED` | 语法有效，但至少一个节点没有打印规则 | 原文不动，指出未覆盖结构 |
| `INVALID` | 完整方言解析器能明确证明语法错误 | 原文不动，显示语法诊断 |
| `UNKNOWN` | 当前解析能力无法判断有效还是错误 | 原文不动，诚实标记“无法识别” |

`INVALID` 只有在解析器有足够语法覆盖时才能给出。部分 parser 的失败只能归为 `UNKNOWN`。


## 5. 总体架构

```text
┌────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                          │
│                                                                    │
│ Format Document  Calibrate Style  Preview  Profile  Diagnostics  │
└───────────────────────────────┬────────────────────────────────────┘
                                │ stable TypeScript API
┌───────────────────────────────▼────────────────────────────────────┐
│                         Application Layer                          │
│                                                                    │
│  Config Resolver  Workspace Cache  Diff Builder  Diagnostics       │
└───────────────┬────────────────────────────────┬───────────────────┘
                │                                │
┌───────────────▼──────────────────┐  ┌──────────▼───────────────────┐
│        Deterministic Core        │  │       Style Calibration      │
│                                  │  │                              │
│ Parser adapter → lossless CST    │  │ Syntax catalog → A/B/edit    │
│ → Doc IR → solver → safety gate  │  │ → validated style profile    │
└───────────────┬──────────────────┘  └──────────┬───────────────────┘
                │                                │
┌───────────────▼────────────────────────────────▼───────────────────┐
│                         Shared Foundations                         │
│                                                                    │
│ Dialect Version  Style Schema  Source Map  Syntax/Corpus Fixtures │
└────────────────────────────────────────────────────────────────────┘
```

### 5.1 单进程还是 Language Server

MVP 采用 VS Code Extension Host 内的直接 `DocumentFormattingEditProvider`，不先上 Language Server：

- 当前产品只需要格式化、预览和校准，不需要补全、跳转等完整语言服务。
- TypeScript formatter 可以直接复用，无跨进程序列化成本。
- 开发、打包和调试更简单。

VS Code 官方支持通过 `registerDocumentFormattingEditProvider` 和 `registerDocumentRangeFormattingEditProvider` 提供整篇及范围格式化，并建议返回尽可能小的 TextEdits：<https://code.visualstudio.com/api/language-extensions/programmatic-language-features>。

如果未来需要同时支持 IntelliJ、Neovim 或 Web IDE，再把同一个 core 包装为 LSP server；当前架构中的 core 不依赖 VS Code API，因此保留这条演进路径。


## 6. 技术选型

### 6.1 首选产品运行时：TypeScript / Node.js

原因：

- VS Code Extension Host 原生运行 Node.js。
- 不需要用户另外安装 Python、Java 或本地二进制。
- parser、printer、calibrator 与 extension 可共享类型和配置 Schema。
- 便于打包为单个 `.vsix`。

TypeScript 是首选，不是为了坚持单语言而牺牲语法正确性。若 Phase 0 证明成熟的版本化 Hive parser 只能通过 WASM 或内嵌运行时可靠复用，只要能够随 `.vsix` 离线分发，也应纳入对比。

### 6.2 现成方案评估

| 方案 | 优点 | 主要问题 | 本项目用途 |
|---|---|---|---|
| `sql-formatter` | TypeScript；Hive/Spark token 与语法资产成熟；MIT | formatter 进入维护模式；布局架构不适合细粒度选择 | 参考 dialect/keyword/tokenizer；不使用其 printer 作为最终核心 |
| SQLFluff | Hive/Spark 支持好；规则与布局配置丰富 | Python 运行时；精确表达“外层先展开、内层保持紧凑”困难 | 对照基线、语料验证、可能的早期实验后端 |
| Prettier SQL CST | CST 与 Prettier 布局思想成熟 | 现有 CST parser 未覆盖 Hive/Spark；风格选项偏少 | 参考 CST 和 Doc printer 设计 |
| 自研容错 CST + printer | 能表达目标风格；安全策略可控 | 完整 Hive 方言覆盖成本极高 | 候选方案，不在 spike 前预设胜出 |

`sql-parser-cst` 很好地展示了 lossless CST 的价值，但其公开方言列表目前不包含 Hive/Spark，且许可证与分发策略也需要单独评估：<https://github.com/nene/sql-parser-cst>。

SQLFluff 的布局系统已能配置空格、换行、运算符和部分缩进，是很有价值的对照工具：<https://docs.sqlfluff.com/en/latest/configuration/layout.html>。但本项目刚刚确认的函数局部展开规则需要更细的候选布局控制，因此不建议把 SQLFluff 固化为最终运行时依赖。

### 6.3 Parser/Printer 技术 bake-off

正式编码前通过统一的 `ParserAdapter` 比较以下路线：

1. 复用 `sql-formatter` 的 tokenizer/dialect 资产，加自研结构 parser；
2. 自研 lossless token tree，只对首批支持结构建立严格 parser；
3. 从版本化 Hive grammar（必要时参考 Spark grammar 资产）生成 parser，再映射到自有 lossless CST；
4. SQLFluff 或其他成熟 parser 作为离线 oracle/对照，不预先承诺进入最终 bundle。

Phase 0 只用同一批真实 SQL 和语法场景比较：语法判定准确率、注释/模板保真、包体与启动成本、错误定位、扩展一条新语法的成本。完整自研 CST、ANTLR 或复用现成资产都必须用结果胜出，不能把偏好写成事实。

`ParserAdapter` 对外至少返回：方言/版本、完整 token 流、lossless 结构、诊断、识别置信边界。打印覆盖由独立 `CoverageAnalyzer` 判断，避免“能 parse”与“敢 format”混为一谈。


## 7. 模块设计

S1 只保留清晰的逻辑边界，不提前拆成十几个发布包：

```text
sql-style-calibrator/
├── apps/
│   └── vscode/                 # VS Code 插件
├── packages/
│   └── core/                   # parser adapter、coverage、printer、profile、safety
├── fixtures/
│   ├── syntax-catalog/hive110/ # 版本化语法场景与校准题
│   ├── corpus/                 # 脱敏后的真实 Hive 结构
│   ├── golden/                 # 人工审定输入与输出
│   └── failures/               # 历史解析/格式失败样例
└── docs/
    ├── style-schema.md
    └── dialect-support.md       # parse/print 两层支持矩阵
```

`core` 内部仍按 parser、CST、printer、profile、safety 分模块；只有出现第二个真实消费者或独立版本需求时才拆 package。

### 7.1 Lexer

输入：原始 SQL 字符串。  
输出：保留精确 offset、文本与 trivia 的 token 流。

首批 token 类型：

- keyword、identifier、quoted identifier；
- number、string、boolean、null；
- operator、comma、dot、semicolon、parenthesis；
- line comment、block comment、hint；
- whitespace、newline；
- template placeholder；
- unknown。

模板 token 必须在字符串切分前识别，并原样保留：

```text
${hiveconf:month}
${run_date}
#{run_date}
{{ run_date }}
{% if condition %}
```

用户可以在配置中增加自定义 placeholder 正则，但正则必须经过超时和长度保护，避免灾难性回溯。

### 7.2 Lossless CST 与覆盖分析

parser 应尽量覆盖目标版本 Hive 的完整 statement grammar；printer 则可以分阶段支持决定首批布局的结构：

- Program / StatementList；
- SetStatement；
- SelectStatement / SelectList / SelectItem；
- CTE / Subquery；
- From / Join / On / Where / Group / Having / Window / Order；
- Insert / Partition；
- CaseExpression / WhenClause；
- FunctionCall / ArgumentList；
- ParenthesizedExpression；
- BinaryExpression / BooleanGroup；
- WindowSpecification；
- CommentAnchor；
- TemplateToken；
- UnsupportedNode（parser 已识别语法，但 printer 尚未实现）。

解析和打印覆盖必须分开：

```text
完整方言 parser
  ├── 语法错误                         → INVALID
  └── 有效 lossless CST
       ├── 所有节点有 printer          → VALID_SUPPORTED
       └── 存在 UnsupportedNode        → VALID_UNSUPPORTED
```

如果当前 parser 不是完整方言 parser，无法识别的 token 区域只能产生 `UNKNOWN`，不能声称 SQL 有错。首版采用**文档原子性**：任一 statement 为 `INVALID`、`UNKNOWN` 或 `VALID_UNSUPPORTED`，整次保存格式化都返回零 edits。后续只有在真实使用证明单条未知语句长期阻塞其他独立语句时，才评估 statement 级原子性。

### 7.3 Doc IR

parser 不直接输出字符串，而是由 printer 把 CST 转换成带候选布局的 Doc：

```ts
type Doc =
  | { kind: "text"; value: string }
  | { kind: "concat"; parts: Doc[] }
  | { kind: "line"; mode: "soft" | "hard" }
  | { kind: "indent"; by: number; content: Doc }
  | { kind: "group"; content: Doc }
  | { kind: "choice"; alternatives: LayoutAlternative[] }
  | { kind: "ifBreak"; broken: Doc; flat: Doc };
```

`choice` 是本产品区别于普通规则 formatter 的关键。每个语法节点可以提出多种合法排版，再由 layout solver 根据风格与行宽选择。

### 7.4 Layout Solver

solver 选择总代价最低的合法布局：

```text
totalCost =
    overflowPenalty
  + styleViolationPenalty
  + unwantedBreakPenalty
  + innerBeforeOuterBreakPenalty
  + unstableAlignmentPenalty
```

其中：

- `overflowPenalty` 极高，防止超过用户行宽。
- `styleViolationPenalty` 来自 `.sqlstyle.jsonc`。
- `innerBeforeOuterBreakPenalty` 实现“外层优先展开”。

首版不引入 `sourceChurnPenalty`：原始空白不应影响 canonical 输出。最小 TextEdit 只优化编辑器修改范围，不改变最终文本。


## 8. 复杂函数换行：本轮讨论对应的实现

以以下表达式为例：

```sql
substr(date_add(confirm_time, 729), 1, 10) < concat(report_month, '-01')
```

printer 为左侧 `substr` 生成三种候选布局。

### 候选 A：完全紧凑

```sql
substr(date_add(confirm_time, 729), 1, 10)
```

### 候选 B：只展开最外层

```sql
substr(
    date_add(confirm_time, 729),
    1,
    10
)
```

### 候选 C：外层与内层全部展开

```sql
substr(
    date_add(
        confirm_time,
        729
    ),
    1,
    10
)
```

默认代价顺序：

```text
能放下：A < B < C
A 放不下：B < C
B 也放不下或内层参数很复杂：C
```

比较右侧的 `concat(report_month, '-01')` 能放下，所以保持紧凑。最终得到：

```sql
when substr(confirm_time, 1, 10) > last_day(concat(report_month, '-01'))
    or substr(
        date_add(confirm_time, 729),
        1,
        10
    ) < concat(report_month, '-01')
then 0
```

这不是对某个函数名称进行硬编码；任何嵌套函数调用都走相同的候选布局与代价模型。


## 9. 风格配置设计

### 9.1 文件形式

项目根目录使用 `.sqlstyle.jsonc`：

- JSONC 允许注释；
- VS Code 可通过 JSON Schema 自动补全；
- 适合提交 Git；
- 比开放式自然语言配置更确定。

解析优先级：

```text
文件最近父目录 .sqlstyle.jsonc
    > workspace 根配置
    > VS Code 用户设置
    > 内置默认值
```

多 root workspace 分别解析，不共享错误配置。

### 9.2 基于当前讨论的候选配置

```jsonc
{
  "$schema": "https://example.invalid/sqlstyle.schema.json",
  "version": 1,
  "dialect": "hive",
  "dialectVersion": "1.1",
  "mode": "canonical",
  "unsupportedBehavior": "leave-document-unchanged",

  "indent": {
    "style": "space",
    "size": 4
  },

  "lineWidth": 100,

  "case": {
    "shortWhen": "single-line",
    "wrappedWhen": {
      "firstCondition": "same-line-as-when",
      "logicalOperator": "leading-indented",
      "then": "own-line"
    },
    "nestedCase": "indent-one-level"
  },

  "functionCall": {
    "wrapStrategy": "outermost-first",
    "wrappedArguments": "one-per-line",
    "keepCompactNestedCalls": true,
    "closingParenthesis": "own-line",
    "keepShortComparisonSideInline": true
  },

  "select": {
    "multipleItems": "one-per-line",
    "comma": "trailing"
  },

  "keywordCase": "lower",
  "functionCase": "lower",
  "dataTypeCase": "lower",
  "semicolon": "same-line",

  "templates": {
    "preserve": true,
    "customPatterns": []
  }
}
```

实际 Schema 不直接暴露任意布局 DSL，只暴露经过定义和测试的语义选项。否则用户可以配出互相矛盾、无法幂等的规则。

### 9.3 校准记录与正式配置分离

正式配置只保存确认后的规则。校准器自己的题目版本、回答与覆盖信息单独保存在本地记录中：

```json
{
  "catalog": "hive110/common-v1",
  "completedAt": "2026-08-19T10:00:00+08:00",
  "decisions": {
    "functionCall.wrapStrategy": "outermost-first",
    "case.wrappedWhen.logicalOperator": "leading-indented"
  },
  "unanswered": []
}
```

这样可以升级校准题库并只询问新增或受影响的选择，又不会把交互历史混入 formatter 的长期事实。


## 10. 风格校准系统

### 10.1 为什么校准优先于样例学习

用户的真实成本不是“不会提供偏好”，而是准备 5～10 个结构不同且风格一致的历史 SQL 太繁琐。偏好本身大多是有限、离散、可解释的选择；真正困难的是确保题目覆盖 CASE、嵌套函数、布尔表达式、窗口、JOIN、SET、DDL/DML 和 Hive 扩展等上下文。

因此首版由产品提供语法场景，用户只负责判断好不好看。校准过程可以是：

```text
官方语法目录 + 目标版本 grammar + 真实项目结构
                      ↓
               去重后的场景清单
                      ↓
        默认风格模板 + 少量高信息量 A/B 题
                      ↓
             编译并预览 style profile
```

“完整语法”不能是营销式承诺。每个 catalog 都要绑定 `dialectVersion`，并公开标记：已列入场景、parser 已识别、printer 已支持、golden 已通过。[Apache Hive LanguageManual](https://hive.apache.org/docs/latest/language/languagemanual/) 可用于建立能力分类，但 Hive 1.1 的行为必须用对应版本资料和真实运行语料复核，不能拿最新文档替代旧版本事实。若评估生成式 grammar 路线，[Apache Spark 的官方 SQL grammar](https://github.com/apache/spark/blob/master/sql/api/src/main/antlr4/org/apache/spark/sql/catalyst/parser/SqlBaseParser.g4) 只作为实现规模与语法资产的参考，不自动等同于目标 Hive 版本。

### 10.2 校准场景目录

场景按语法结构而不是按一份巨型 SQL 的出现顺序管理：

- session/config：`set`、`add jar/file`；
- query：select list、subquery、CTE、set operators；
- expression：CASE、函数、cast、复杂 boolean、in/exists；
- relation：join、lateral view、table sample；
- analytic：window specification、窗口函数；
- DML：insert into/overwrite、动态分区、多表 insert；
- DDL：首版明确列出支持子集；
- physical clauses：distribute/sort/cluster by；
- lexical：comment、hint、模板变量、quoted identifier、字符串。

同一结构需要短/长、浅/深、含注释/模板变量、位于不同父上下文的变体。巨型展示文件由这些小场景生成，便于用户整体审美；测试和覆盖追踪仍以独立场景为单位。

### 10.3 校准交互

`SQL Style: Calibrate Style`：

1. 选择明确的 Hive 版本 profile；
2. 展示一份可直接阅读和修改的完整默认模板；
3. 只对无法从修改结果唯一推导、或影响很大的规则展示 A/B；
4. 编译 `.sqlstyle.jsonc` 并对真实 SQL 做只读预览；
5. 用户确认后启用 Format on Save。

校准不是每次升级都重做。catalog 新增题目时，只询问新增规则；已确认规则保持不变。用户以后可运行 `Recalibrate Affected Rules` 做显式微调。

### 10.4 可选的未来样例推断

从历史文件观察大小写、缩进、逗号、CASE 与函数布局仍有价值，但它只负责给校准题预选答案：

- 永不直接改动正式 profile；
- 冲突时展示证据和 A/B，不以多数票静默覆盖；
- 不进入 Format on Save 热路径；
- 不作为首版可用性的退出条件。


## 11. 格式化执行流程

```text
1. 读取 document + workspace 配置
2. 确定 dialect + dialectVersion（必须显式配置）
3. ParserAdapter 生成 lossless tokens、CST 与语法诊断
4. 分类为 VALID_SUPPORTED / VALID_UNSUPPORTED / INVALID / UNKNOWN
5. 非 VALID_SUPPORTED → 返回零 edits + 准确诊断
6. printer 为每个节点生成候选 Doc
7. layout solver 根据固定 profile 与行宽选布局
8. 输出 SQL并运行安全门禁
9. 生成最小 TextEdits
10. 返回 VS Code
```

### 11.1 配置错误

- 未知配置项：提示 warning，不静默忽略。
- 非法组合：拒绝格式化并指出冲突项。
- 老版本配置：在内存中迁移，提供显式写回命令；不在保存 SQL 时顺便改配置。

### 11.2 无法格式化

- 明确语法错误：`INVALID`，不改文件，给出错误位置与 parser 诊断；
- 语法有效但打印未覆盖：`VALID_UNSUPPORTED`，不改文件，给出最小未支持节点与支持矩阵链接；
- parser 能力不足：`UNKNOWN`，不改文件，不误报为语法错误；
- 任一安全门禁失败：不改文件，记录稳定错误码。

S1 采用整篇文档原子性，避免 Format on Save 只改半份文件造成风格混合。statement 级降级以后可作为显式选项评估，但不能跨失败区域移动注释或空白。

### 11.3 Range formatting

选区格式化不能直接截断 token。流程：

1. 将选区扩展到最小安全 CST 节点。
2. 格式化完整节点。
3. 只返回节点范围内的 edit。
4. 找不到安全节点时拒绝，而不是猜测。


## 12. 安全门禁

### 12.1 Token preservation

格式化前后重新 tokenize，并比较：

- 除空白外 token 数量一致；
- token 类型与顺序一致；
- 字符串 literal 文本逐字一致；
- identifier 文本一致；
- template token 逐字一致；
- comment 文本一致；
- 只有配置允许时，keyword/function/type 的大小写可以变化。

### 12.2 Structural fingerprint

输入和输出重新解析后生成忽略 trivia 的 CST fingerprint。两者必须一致。

### 12.3 Idempotence

开发测试和 CLI `check` 中强制：

```text
format(output) === output
```

VS Code 运行时可以通过版本化缓存避免每次重复完整计算；新规则、未知节点和 debug 模式仍执行二次检查。

### 12.4 Comments and hints

- 不修改注释正文。
- 注释锚定到最近的 CST 节点，不允许跨语句漂移。
- `/*+ MAPJOIN(...) */` 作为 hint token，不能当普通块注释移动。
- formatter 不自动插入 disable 注释。
- disable 指令优先使用单行注释，避免旧 Hive/beeline 对文件首部独立块注释的兼容问题：

```sql
-- sqlstyle-disable
select vendor_specific_syntax ...;
-- sqlstyle-enable
```


## 13. 方言与模板策略

### 13.1 方言显式化

S1 dialect：

- `hive`：以 HiveQL 1.1 常见语法为首要兼容基线；

后续可增加：

- `spark`：单独维护 Spark SQL 扩展；
- `generic`：只支持保守公共子集，不假装自动识别准确。

项目可以按 glob 覆盖：

```jsonc
{
  "dialect": "hive",
  "overrides": [
    {
      "files": ["spark/**/*.sql"],
      "dialect": "spark"
    }
  ]
}
```

### 13.2 Hive 首批专项语法

- `set key=value` / `set key = value`；
- `${hiveconf:name}`；
- `insert overwrite table ... partition (...)`；
- 多表 insert；
- `lateral view explode`；
- `distribute by` / `sort by` / `cluster by`；
- `transform ... using`；
- Hive `if()`；
- hints；
- `add jar` / `add file`。

### 13.3 方言版本

`dialect` 与 `dialectVersion` 分离。即便 formatter 不做完整语义校验，也要避免把只存在于新版本的关键字错误识别为旧 Hive 关键字。


## 14. VS Code 插件设计

### 14.1 MVP 命令

| 命令 | 作用 |
|---|---|
| `SQL Style: Format Document` | 使用标准 Document Formatter |
| `SQL Style: Preview Formatting` | 打开左右 diff，不写文件 |
| `SQL Style: Calibrate Style` | 用 Hive 语法目录生成/更新 profile |
| `SQL Style: Open Style Profile` | 打开最近生效的配置 |
| `SQL Style: Show Unsupported Syntax` | 定位导致整篇未格式化的语法 |
| `SQL Style: Debug Parse` | 输出脱敏结构和覆盖信息，帮助报 bug |

`Format Selection` 与 `Explain Formatting Here` 有价值，但不是首版成熟可用的必需项；在整篇 format-on-save 稳定后再加入。

### 14.2 Format on Save

不自己监听保存事件，直接实现标准 formatter。用户使用 VS Code 原生设置：

```jsonc
{
  "[sql]": {
    "editor.defaultFormatter": "publisher.sql-style-learner",
    "editor.formatOnSave": true
  }
}
```

### 14.3 Preview

首次校准与重大配置变更必须先走 diff：

- 左侧：原 SQL；
- 右侧：候选格式；
- 状态栏：dialect/version、profile 路径、parse/print 覆盖状态；
- 可对受影响规则 Accept / Reject / Try Alternative。

### 14.4 Explain（后续）

为了让复杂规则可调试，formatter 为每个布局决定保留 reason code：

```text
FUNC_OUTER_BREAK
  node: substr(...)
  flatWidth: 108
  availableWidth: 83
  selected: outermost-first
  preservedNested: date_add(...)
  rule: functionCall.wrapStrategy
```

这同时是产品差异化能力和开发排错工具。


## 15. CLI 与 CI

core 必须与 VS Code API 解耦，但 S1 不要求同时交付完整 CLI。开发期间只保留内部测试 harness：

```bash
pnpm test:golden
pnpm dev:format fixtures/example.sql
pnpm dev:coverage fixtures/corpus/
```

同事内推阶段若出现真实需求，再公开 `sqlstyle format/check` CLI。CI 中 `check` 只检查、不写文件，并约定：

- `0`：全部符合；
- `1`：存在格式差异；
- `2`：配置或解析失败；
- `3`：安全门禁失败。


## 16. 性能设计

目标而非当前承诺：

- 1,000 行 SQL：p95 小于 200 ms；
- 10,000 行 SQL：小于 1 s；
- Format on Save 不阻塞 UI 超过可感知阈值；
- 配置和 dialect grammar 按 workspace 缓存；
- 大文件在 Worker Thread 中执行；
- CancellationToken 被取消后尽快停止；
- 校准器可以较慢，但必须显示进度且可取消。

不为了速度跳过安全门禁；可以通过缓存 token fingerprint 和二次格式结果降低重复开销。


## 17. 隐私与安全

- 默认完全离线。
- 不上传 SQL、表名、字段名、注释或路径。
- 默认无遥测。
- 日志默认不打印原始 SQL，只打印错误位置、token 类型和 reason code。
- 若未来增加 AI 重构建议，必须显式 opt-in，并在发送前展示内容范围。
- 企业使用可通过配置彻底禁用所有网络能力。


## 18. 测试策略

### 18.1 Golden tests

每个输入 SQL 对应人工审定输出：

```text
input.sql
expected.sql
style.jsonc
```

当前两份 calibration 文件是第一批审美语料，但不代表语法覆盖清单：

- `spark_sql_style_calibration.sql`
- `complex_case_style_calibration.sql`

另建版本化 syntax catalog。每个场景都要同时记录 parser 期望状态、printer 支持状态和至少一个 golden 输出，防止“模板中出现过”被误解为“产品已支持”。

### 18.2 不变量测试

所有测试样例必须满足：

```text
tokenPreserved(input, output)
structurallyEquivalent(input, output)
format(output) === output
commentsPreserved(input, output)
templatesPreserved(input, output)
```

### 18.3 Property-based tests

对同一 token 序列随机注入：

- 多余空格；
- 随机换行；
- tab/space 混用；
- 大小写变化；
- 注释；
- 模板变量。

无论输入空白怎样变化，都应收敛到同一个输出。

还要生成合法但 printer 未覆盖的语法，断言它稳定返回 `VALID_UNSUPPORTED` 和零 edits；只有专门的无效语法 fixture 才允许返回 `INVALID`。

### 18.4 Corpus tests

从真实项目抽取结构并脱敏：

- 超长 CASE；
- CASE 中的窗口函数；
- 函数三四层嵌套；
- 注释夹在布尔条件中；
- Hive `SET` + 多条 insert；
- 当前或历史 formatter 曾经失败的 SQL。

真实业务 SQL 只作为本地测试输入，不进入公开包，除非完成脱敏和授权确认。

### 18.5 VS Code 集成测试

- Format Document；
- formatOnSave；
- multi-root 配置解析；
- 配置热更新；
- `INVALID` / `VALID_UNSUPPORTED` / `UNKNOWN` 均不修改文档且诊断不同；
- 返回最小 edits，不丢 diagnostics/断点位置。


## 19. 可观测性与错误模型

错误需要稳定 code，方便搜索和测试：

| Code | 含义 |
|---|---|
| `CFG001` | 配置无法解析 |
| `CFG002` | 配置项冲突 |
| `LEX001` | 非法或未闭合 token |
| `PAR001` | 完整 parser 判定语法无效（`INVALID`） |
| `PAR002` | 语法有效但 printer 未覆盖（`VALID_UNSUPPORTED`） |
| `PAR003` | 当前 parser 无法判定（`UNKNOWN`） |
| `FMT001` | 无合法布局 |
| `SAFE001` | token preservation 失败 |
| `SAFE002` | 输出重新解析失败 |
| `SAFE003` | 幂等性失败 |
| `CAL001` | 校准题或 profile 规则不完整 |

Output Channel 提供简洁诊断；Debug 模式才输出更详细的 CST 和布局选择，且默认隐去 literal 内容。


## 20. 分阶段实施计划

### Phase 0：需求基线与技术 bake-off

交付：

- `hive110/common-v1` 语法场景目录与 parse/print 双层支持矩阵；
- 当前审美模板审定完成，并把每个可变决策映射到 style key；
- `.sqlstyle.jsonc` v1 Schema 草案；
- `ParserAdapter` 三条候选路线的同语料对比结论；
- CASE 与 FunctionCall 的 Doc IR 原型。

退出条件：

- 能可靠区分至少首批语料中的 `VALID_SUPPORTED`、`VALID_UNSUPPORTED`、`INVALID` 与 `UNKNOWN`；
- 能稳定表示目前讨论过的所有 CASE/函数布局；
- 对 parser 路线作出有数据的 ADR，而不是默认完整自研。

### Phase 1：Hive Canonical Formatter 核心

范围：

- 选定的 lossless parser/CST 路线；
- coverage analyzer；
- SELECT、CASE、函数、布尔表达式、CTE、JOIN、SET；
- layout solver；
- token preservation 与幂等门禁；
- 内部 golden/coverage harness。

退出条件：

- 支持语料 100% token preservation；
- 支持语料 100% 幂等；
- 对任意非 `VALID_SUPPORTED` 输入 100% 返回零 edits；
- 人工审定的核心 golden tests 全部通过。

### Phase 2：VS Code 个人可用版

范围：

- Format Document；
- Format on Save；
- Preview Diff；
- Style Calibration；
- 配置解析与 Schema 补全；
- invalid/unsupported/unknown 分类诊断。

退出条件：

- 可以替代当前插件完成日常使用；
- 典型 1,000 行 SQL 保存无明显卡顿；
- 解析/覆盖/安全错误不会修改文档；
- 不要求用户保存后再次手工调格式。

### Phase 3：1～2 个月 dogfood 与同事内推

范围：

- 记录但不上传 `unsupported` fixture 与性能样本；
- 只根据真实高频缺口扩语法/打印覆盖；
- 修正少量 profile 语义，不随单个 SQL 摇摆；
- 完成 README、迁移器、许可证复核、脱敏语料流程后给公司同事使用。

退出条件：

- 连续使用期间无语义损坏；
- 常用 Hive 文件不因覆盖缺口频繁拒绝格式化；
- profile 变更频率降至用户可接受；
- 至少一轮同事反馈验证配置可移植性。

### Phase 4：按真实需求选择增强

- 从历史文件推断校准题预选答案；
- 独立且显式确认的 AI 结构重构建议；
- Spark SQL profile；
- CLI/CI、范围格式化、Explain、可选 LSP；
- 更多方言或规则插件 API。


## 21. 风险与缓解

### R1：Hive 语法覆盖不足

风险最高。缓解：

- 用官方语法目录、目标版本资料和真实语料建立场景清单；
- parse 覆盖与 print 覆盖分开追踪；
- 未覆盖输入整篇不改，不做 UnsupportedNode 内外混合格式化；
- 用真实项目语料持续增加 fixtures；
- dialect/version 显式配置；
- 未知或解析失败绝不写回，也不误报语法错误。

### R2：规则过多导致不可预测

缓解：

- 配置只开放经过验证的语义选项；
- 每次布局保留 reason code；
- 使用冲突检测和 Schema；
- 不开放任意用户脚本作为 v1 规则。

### R3：校准题不完整或风格频繁漂移

缓解：

- catalog 绑定方言版本并有显式覆盖矩阵；
- 用真实项目只补高频结构，不追求一份文件字面穷举所有未来语法；
- profile 只有显式校准/微调才改变；
- 新 catalog 版本只询问新增或受影响规则；
- 用 dogfood 期的变更频率衡量风格模型是否稳定。

### R4：注释漂移或语义意外变化

缓解：

- lossless tokens；
- comment anchor；
- token preservation；
- structural fingerprint；
- fail closed；
- 大量 property tests。

### R5：性能不足

缓解：

- TypeScript 单运行时；
- workspace cache；
- 增量/statement 级解析；
- Worker Thread；
- 可取消任务；
- 性能语料和基准进入 CI。


## 22. 架构决策记录（ADR 摘要）

### ADR-001：使用 TypeScript 作为首选产品运行时

状态：建议接受。  
原因：VS Code 原生、易打包、无外部运行时依赖；但 parser bake-off 可以验证可随包分发的 WASM/生成代码路线。

### ADR-002：MVP 使用直接 VS Code Formatting Provider

状态：建议接受。  
原因：当前不需要完整 LSP；core 保持编辑器无关，未来可包装为 LSP。

### ADR-003：使用 lossless 语法表示，不使用会丢信息的 AST 作为格式化事实

状态：原则接受，实现待 Phase 0。  
原因：注释、hint、模板变量和额外括号是安全格式化的必要信息；自研 CST、生成 parser 或适配现成 parser 尚未裁决。

### ADR-004：自研带 `choice + cost` 的 Doc printer

状态：暂定，需原型验证。  
原因：outermost-first 等条件布局需要多候选能力，但应先用复杂 CASE/函数 golden 验证最小 Doc IR，而不是一次设计通用布局语言。

### ADR-005：SQLFluff 不作为最终运行时依赖

状态：暂不预设。  
原因：默认产品仍偏好单 `.vsix` 离线运行；SQLFluff 可作为 oracle，任何运行时复用决定必须服从 Phase 0 数据和许可证审查。

### ADR-006：AI 不进入保存时格式化链路

状态：建议接受。  
原因：确定性、速度、隐私、成本和语义安全。

### ADR-010：校准优先，历史样例学习递延

状态：接受。  
原因：用户愿意判断完整模板的审美，但准备大量多样且一致的历史样例成本过高；场景目录由产品负责，能更直接覆盖风格空间。

### ADR-011：首版只提供 canonical 模式

状态：接受。  
原因：Format on Save 后不希望再手调，要求相同语法和 profile 收敛为唯一结果；`preserve` 会引入第二套相互冲突的产品语义。

### ADR-012：parse 与 print 覆盖分离，未覆盖时零 edits

状态：接受。  
原因：用户明确要求语法错误报错，合法但无规则不格式化；只有四态结果才能诚实表达 parser 的能力边界。

### ADR-013：AI 只做显式结构重构建议，不做格式化 fallback

状态：接受。  
原因：AI fallback 与“合法但未覆盖时不格式化”冲突，也无法在 parser 不认识语法时可靠证明结构等价。重构建议是另一项产品能力，必须显式触发、展示 diff、由用户确认，且永不进入 on-save。

### ADR-014：Hive-first，Spark 与多方言递延

状态：接受。  
原因：成熟可用优先于表面覆盖；先用真实环境验证 Hive，再决定是否扩展 Spark。


## 23. 尚需在校准阶段决定的样式问题

以下问题会实质影响架构或产品体验：

1. `lineWidth` 是硬上限，还是允许字符串/模板等不可拆 token 小幅超过？
2. 多行函数的右括号始终独占一行，还是特定简单场景允许 `10)`？
3. 长 `WHEN` 中第一个条件和 `when` 同行时，最多允许占到多少宽度/复杂度？
4. 同一 workspace 是否确有按目录/glob 使用不同 profile 的真实需求？
5. dogfood 中出现一条 unsupported statement 时，整篇原子性是否造成明显阻碍；若是，再评估 statement 级原子性。


## 24. 当前建议结论

推荐方案是：

```text
TypeScript VS Code 插件
  + 编辑器无关的 formatter core
  + 经 bake-off 选出的 lossless Hive parser adapter
  + parse/print 双层覆盖矩阵与四态失败模型
  + 可枚举候选布局的 Doc IR
  + 基于规则和代价的 layout solver
  + 人可读的 .sqlstyle.jsonc
  + 版本化 Hive 场景目录与风格校准器
  + token/结构/幂等三重安全门禁
```

不建议：

- 继续给当前插件增加外围配置但不改变 printer；
- 保存时直接让 AI 重写 SQL；
- 在 parser bake-off 前武断决定完整自研或依赖某一个现成 parser；
- 在 style schema 稳定前做复杂样例学习模型；
- 为了“支持所有语法”在 v1 遇到未知节点仍强行格式化。

下一步进入 Phase 0，但不立即搭完整插件。先建立 Hive 场景目录和支持矩阵，再用同一批语料完成 parser bake-off，同时证明复杂 CASE/嵌套函数可以收敛为用户认可的 canonical 输出。


## 25. 2026-08-19 v0.2 评审记录（历史，已被第 26 节覆盖）

> 本节是 v0.2 的历史决策记录。第二轮澄清推翻了“样例学习器是核心”和“AI 格式化 fallback”两个前提；与当前正文或第 26 节冲突时，以第 26 节为准，不应按本节直接实现。

一轮双向钢人评审后，与作者确认了四个关键变量：

1. 使用模式：format-on-save 高频 + 成稿整理低频，两者都要。
2. 受众：本人长期使用 → 好用则以 GitHub 形式推给公司同事 → 反响好再公开发布。
3. AI 参与：SQL 允许发给大模型，但关注实际体验与接入方式。
4. 样例学习器：核心价值，不是锦上添花。

### 25.1 评审裁决

- **方案主体成立**：format-on-save 的高频确定性要求 + 学习器作为核心价值 + 存在对外发布路径，三者共同排除了"AI 直接当 printer"和"只做极简个人脚本"两条替代路线。自研 lossless CST + choice/cost Doc IR 是唯一同时满足三者的架构。ADR-001~006 全部维持。
- **评审中被驳倒的反方论点**（留档）："学习器可砍"被受众路径和核心价值定位否决；"产品工程过度"修正为"分阶段递延"而非删除；"AI 替代自研内核"被 on-save 确定性要求否决，但其残余价值转化为 ADR-007 的 fallback 设计。
- **反方存活的批评**：fail-closed 的长尾陷阱（最怪的文件恰恰被拒绝服务）是真实风险，由 ADR-007 的 AI fallback 化解；产品工程项（Schema 迁移器、插件 API、遥测政策、方言版本矩阵）在"仅本人使用"阶段全部递延，见 25.4。

### 25.2 ADR-007：AI 三分法定位

历史状态：当时接受；当前已被 ADR-013 推翻，不实施。以下内容仅用于解释决策演变：

1. **学习器助手**（Phase 3 起）：解释规则冲突、把低置信度歧义翻译成自然语言 A/B 问题、辅助从自然语言反馈调整配置。离线交互场景，慢无所谓。
2. **Fail-closed 兜底格式化**（Phase 2 起，手动命令 `SQL Style: AI Format (Gated)`）：parser 无法解析的 statement，可显式调用大模型重排空白，输出必须通过与确定性内核**完全相同的安全门禁**（token preservation + 幂等复检 + diff 预览确认后才写入）。这把"覆盖不足 → 拒绝服务"的长尾陷阱转化为"覆盖不足 → 降级可用"，同时为 parser 长尾争取时间。
3. **绝不进入 on-save 链路**（重申 ADR-006）。

接入方式：默认探测本机 `claude` CLI（headless `claude -p`），复用用户既有订阅与代理配置，插件不管理任何 API key；配置项 `ai.provider: "none" | "cli" | "api"`，默认 `none`（发布版必须显式 opt-in，兼容第 17 节隐私承诺）。AI 调用必须可取消、可超时、失败静默降级为普通 fail-closed 行为——中转链路的限流与不稳定不允许影响任何确定性功能。

### 25.3 ADR-008：学习器提前建立行走骨架

历史状态：当时接受；当前已被 ADR-010 推翻，不进入首版。原 v0.2 修订如下：

- **Phase 0 增加交付物**：第一层（直接观察）学习器原型，在两份 calibration 语料上跑通"样例 → 观察统计 → 生成 .sqlstyle.jsonc 草稿"，用它反向验证 schema 设计是否可推断（不可推断的配置项即是坏设计的信号）。
- **Phase 1 增加交付物**：第二层（上下文观察）依赖 CST，随 parser 一起长；`sqlstyle infer` 骨架命令提前进入 CLI。
- **Phase 3 收缩为**：第三层候选搜索、置信度/冲突报告、A/B diff 交互、增量学习。
- 新增不变量测试：**round-trip 自洽**——用学习器从"内核以配置 C 格式化的输出"反推配置，必须恢复出与 C 等价的规则（schema 可推断性的持续回归）。

### 25.4 ADR-009：产品化分三级递延

状态：接受。按受众路径把产品工程项挂到触发点，而不是 v1 一次做完：

| 阶段 | 触发点 | 才需要做 |
|---|---|---|
| S1 仅本人 | 现在 | schema 带 `version` 字段但**不写迁移器**；错误码保留（测试需要）；无遥测；multi-root 只做最近父目录查找 |
| S2 GitHub 内推 | 同事真实使用 | README/配置文档、迁移器、依赖许可证复核（`sql-formatter` 资产复用边界）、issue 模板、脱敏语料流程 |
| S3 公开发布 | 内推反响良好 | Marketplace 打包合规、遥测政策声明、dialect 版本矩阵、规则插件 API |

S1 阶段写代码时只需保证"不给 S2/S3 制造不可逆障碍"（core 不依赖 VS Code API、许可证干净、schema 有版本号），不提前实现其内容。

### 25.5 第 23 节问题的已决项

> 以下是 v0.2 当时的答案；Hive-first、CLI 递延等当前决定以第 26 节和 ADR-014 为准。

- 问题 1：首版仅 HiveQL 1.1 + Spark SQL，不含 MySQL/PostgreSQL（受众阶段 S1/S2 均不需要）。
- 问题 8：CLI 与 VS Code 同步交付，但 CI 集成（exit code 约定落地、流水线接入）递延到 S2。
- 问题 9：计划分阶段公开，按 ADR-009 执行；许可证策略在 Phase 0 spike 时即按"未来会公开"的标准审查。
- 其余问题（2/3/4/5/6/7）仍待样式层面逐条确认，建议在 Phase 0 用 calibration 语料逐条定案。


## 26. 2026-08-19 第二轮澄清后的最终裁决（v0.3）

### 26.1 真正要解决的问题

用户要解决的不是“怎样让 AI 猜出我的格式”，而是以下完整问题：

> 产品先替用户承担搜集和组织 Hive SQL 风格场景的成本，让用户通过一份高覆盖模板快速确定审美；随后把审美编译成稳定的规范，使 VS Code 每次保存都能本地、快速、确定地把合法且已支持的 Hive SQL 收敛到唯一结果。用户不需要保存后手调，规则也不会随文件漂移。遇到确凿语法错误时明确报错；遇到合法但尚未支持、或系统无法判断的语法时保持原文。先做到个人工作中成熟可靠，连续使用 1～2 个月后再推广给同事。格式化之外，可以再提供显式的结构重构建议，但不得混入保存链路。

这里的核心价值排序是：

```text
信任与不改坏代码
    > 日常常用 Hive 覆盖率
    > 风格是否真正顺眼且稳定
    > 保存时速度
    > 校准便利性
    > 自动学习的“聪明感”
```

### 26.2 对当前想法的最强支持论证

**钢人论证：** 对单个用户而言，风格空间远小于 SQL 语法空间。大小写、缩进、CASE、布尔运算符、函数参数、JOIN/CTE、列表与括号等偏好虽然会受上下文影响，但仍能由有限的 profile 表达。由产品提供覆盖上下文的题目，比要求用户自己准备一致的历史样例更省力、更可控。profile 一旦确认，规范化 printer 可以稳定执行；这正好适配 Format on Save，也天然适合以后成为团队规范。

**第一性原理：** 一个保存时 formatter 的必要输入只有三类：语法结构、固定风格函数和安全约束。其本质是：

```text
parse(sql, dialectVersion)
    → verifyPrintCoverage(cst)
    → printCanonical(cst, profile)
    → verifyEquivalent(input, output)
```

“从历史文件学习”不是这个闭环的必要组成，只是获得 `profile` 的一种方式。既然用户愿意直接判断模板和修改结果，就可以用信息密度更高的主动校准替代噪声更大的被动推断，显著降低首版风险。

### 26.3 对当前想法的最强反对论证

**钢人论证：** “一个文件包含 Hive 所有语法”在字面上无法完成。Hive 有版本差异、厂内扩展、模板语言、UDF、语法组合和注释位置；即使每个 grammar production 都出现一次，结构的笛卡尔组合仍然无穷。过度追求完整模板会造成校准疲劳，也可能把开发拖进 grammar 工程，迟迟没有成熟插件。固定 profile 如果表达力不足，还会把“不喜欢的死板格式”从旧插件复制到新插件。

另一个强反对点是失败模型：若 parser 不完整，它无法可靠区分“SQL 真错了”和“这是合法但我不认识的 Hive 扩展”。如果仍强行报语法错误或局部格式化，就会伤害用户信任。AI 也不能简单补洞；parser 都不认识时，无法可靠证明 AI 只改了布局，而结构重构更不满足 token-preservation。

**第一性原理：** formatter 能安全改写的前提不是“看起来像 SQL”，而是系统能证明：输入有效、每个结构都有明确 printer、输出与输入结构等价。因此成熟度由**已证明的覆盖率**决定，不由配置项数量、模板长度或 AI 能力决定。

### 26.4 双方真正的分歧与关键变量

双方并不争论“确定性 formatter 是否值得做”，真正分歧是：

1. **完整性的定义**：字面穷举所有 Hive 组合，还是覆盖版本化 grammar 类别并命中绝大多数真实工作文件；
2. **parser 投资边界**：为了准确区分 invalid/unsupported，需要多完整的 parser，是否值得完全自研；
3. **风格模型是否足够表达上下文**：若大量审美只能靠单例特判，canonical profile 会再次变死板；
4. **fail-closed 的可用性成本**：整篇不改最安全，但 unsupported 比例高时会失去日常价值；
5. **重构建议的职责**：它是 formatter 的兜底，还是独立的代码审查能力。

最可能改变结论的变量，按优先级是：

- 真实项目语料中，候选 parser 的 `INVALID/UNKNOWN` 误判率；
- 首批 printer 支持后，实际保存事件的成功格式化比例；
- profile 能否不用函数名/文件名特判就还原已确认审美；
- 1～2 个月内需要调整 profile 的频率；
- 1,000 行左右真实 SQL 的保存延迟；
- 同事是否能复用同一 profile，或至少复用同一校准题库。

### 26.5 用户回答带来的结论变化

| 澄清 | 对 v0.2 的影响 | v0.3 裁决 |
|---|---|---|
| 愿意直接看完整 Hive 模板确定审美 | 样例学习不再是核心价值 | 校准器成为主入口，样例推断递延 |
| 不希望保存后手调 | `preserve` 与 source-churn 权重会制造多解 | 只做 canonical 模式 |
| 语法错报错；合法未覆盖不格式化 | 单一“parse failed”错误模型不够 | parse/print 分层，使用四态结果 |
| 风格固化更稳定 | 持续学习会破坏预期 | profile 只在显式校准时改变 |
| 首版覆盖大多数常用语法 | 广而浅不符合目标 | Hive-first，按风险/频率扩覆盖 |
| 希望有结构重构建议 | AI 有价值，但不是 formatter | 独立显式命令，diff 确认，绝不上保存链路 |
| 先成熟可用再优化 | 同时做 CLI、学习器、Spark 会延迟价值 | 先完成 formatter + VS Code 垂直切片 |
| 个人用 1～2 个月再推同事 | 产品化不应一开始做满 | 以 dogfood 数据触发 S2 工作 |

### 26.6 明确判断

**值得做，而且方案比 v0.2 更小、更清楚、更有机会做成。** 但成立的产品不是“会从 SQL 文件中学习的 formatter”，而是：

> **Hive SQL Style Calibrator + Canonical Formatter**

应立即保留的部分：lossless、安全门禁、确定性 Doc printer、可读 profile、VS Code 标准 formatter、format-on-save、真实语料测试。

应从首版删除或递延的部分：历史文件学习器、AI 格式化 fallback、Spark、多包 monorepo、公开 CLI/CI、范围格式化、LSP、规则插件系统。

尚不能预先接受的技术结论：完整自研 CST 是唯一方案、TypeScript 必须承载 parser 的全部实现、SQLFluff 永远不能成为任何运行时组件。它们都应由 Phase 0 bake-off 决定。

### 26.7 AI 重构建议应怎样放置

结构重构不一定都需要 AI：明显的重复表达式、超深嵌套、可提取 CTE 等可以先用 CST 规则发现。AI 的优势是提出更贴近业务可读性的候选写法，但无法仅靠 token-preservation 证明语义一致。

因此未来命令应是 `SQL Style: Suggest Structural Refactor`：

1. 用户显式触发；
2. 默认只分析选中 statement；
3. 展示“原因 + 候选 SQL + 完整 diff”，绝不自动保存；
4. 候选重新通过目标方言 parser；
5. 若 token/结构发生变化，明确标注“需要人工验证语义”，不能复用 formatter 的安全徽章；
6. 可选接入元数据或执行计划时再提高置信度；
7. 企业环境默认关闭网络能力。

### 26.8 个人成熟可用的验收线

首版不以“支持所有 Hive SQL”验收，而以可观测、能持续提高的标准验收：

- 安全：支持语料 token preservation、结构 fingerprint、幂等全部通过；任何非 `VALID_SUPPORTED` 输入零 edits；
- 可用：dogfood 稳定期内，至少 95% 的实际保存事件能完成格式化，其余都有准确可复现的 unsupported/unknown fixture；
- 审美：初次校准后，第二周起平均每周 profile 微调不超过一次；
- 性能：典型 1,000 行 SQL 的 format-on-save p95 小于 200 ms；
- 稳定：连续 1～2 个月无语义损坏、无静默配置漂移；
- 推广：完成脱敏语料与许可证复核后，再给公司同事试用。

这些阈值是工程假设，不是用户承诺；Phase 0/个人 dogfood 可以根据真实数据调整。至此架构层面的关键问题已经足够明确，不需要继续等待额外问答；第 23 节剩余问题在校准模板中用具体 SQL 视觉选择解决即可。
