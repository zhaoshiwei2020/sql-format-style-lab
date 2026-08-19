# Facts

### F-0001｜两份审美语料内部/相互不一致

- Status: verified
- Statement: calibration 语料存在至少 5 处机械规则不可同时满足的矛盾：同构表达式在两文件（或同文件两节）排法不同（比较断行侧、嵌套括号组展开与否、~77 字符嵌套调用断行阈值、cast 内壁 99 字符超宽保留、视觉平行断行）。
- Sources: S-0002, S-0003, S-0004
- Scope: 仅指这两份语料文件；不代表用户真实偏好已定
- Verified on: 2026-08-19
- Public-use boundary: unrestricted
- Notes: 逐项对应校准题 Q2~Q5；据此确立 D-0003/D-0004

### F-0002｜lineWidth=78 是对语料的经验最优

- Status: verified
- Statement: 对全部 42 组 fixture 做宽度扫描（75~80），78 使逐字节复现数最大（当日终值 38/42；80 为 37 以下，100 显著更差）。语料手排基准在 78~80 之间且有 2 行超宽（81、99 字符）被人工容忍。
- Sources: S-0002, S-0003, S-0004, S-0007
- Scope: 当前语料 + 当前 printer 规则组合下的实证值
- Verified on: 2026-08-19
- As of: 2026-08-19
- Public-use boundary: unrestricted
- Notes: 校准题 Q1 拍板后可能改变；DEFAULT_PROFILE.lineWidth 与 CLAUDE.md 已同步为 78

### F-0003｜测试基线 253/256，3 红为校准信号

- Status: verified
- Statement: vitest 全量 256 用例中 253 通过；3 个失败均在 golden.test.ts（case/05、07、11），成因是 F-0001 的语料矛盾而非回归。
- Sources: S-0007, S-0004
- Scope: 2026-08-19 会话结束时的工作区状态
- Verified on: 2026-08-19
- As of: 2026-08-19
- Public-use boundary: unrestricted
- Notes: 处置规则见 D-0003

### F-0004｜性能远超目标

- Status: verified
- Statement: 1302 行真实结构 Hive SQL 全链路格式化（含 token preservation、结构指纹、幂等复跑）median 29ms / p95 35ms（20 次采样，本机 Apple Silicon）；目标为 1,000 行 p95 < 200ms。
- Sources: S-0007
- Scope: 本机、当前语法覆盖范围
- Verified on: 2026-08-19
- As of: 2026-08-19
- Public-use boundary: unrestricted

### F-0005｜sql-formatter Hive 资产可经公开 API 复用

- Status: source-backed-limited
- Statement: sql-formatter (MIT) 的 hive DialectOptions（关键字/函数/tokenizer 配置）从包根导出可直接 import；tokenizer 引擎不导出且 exports 封锁深层导入；其 Hive 方言缺 `LATERAL VIEW` 短语。项目已决定自研 lexer，此资产仅作参考/补词表来源。
- Sources: S-0006
- Scope: 子代理调研时点的上游仓库状态
- Verified on: 2026-08-19
- As of: 2026-08-19
- Public-use boundary: attribute
- Notes: 主会话未逐条复核，引用上游细节前先查 S-0006 原文

### F-0006｜四态模型的 INVALID 边界

- Status: verified
- Statement: 当前实现中 parser 永不产出 INVALID（非完整方言 parser 不可证伪语法）；仅词法可证错误（未闭合字符串/引号标识符）产出 INVALID（LEX001）；解析不了= UNKNOWN；语法有效但 printer 未覆盖= VALID_UNSUPPORTED + 整篇零 edits（冒烟已验证 merge 语句精确定位并整篇拒绝）。
- Sources: S-0001, S-0007
- Scope: 当前代码状态
- Verified on: 2026-08-19
- Public-use boundary: unrestricted

### F-0007｜dogfood 首轮：内部数仓全库 178 个脚本的四态分布

- Status: verified
- Statement: 对本机内部数仓脚本库（路径见本地会话记忆）全部 178 个 .sql 跑 formatSql：补齐三个语法缺口后 175 个 VALID_SUPPORTED；2 个 VALID_UNSUPPORTED（drop-table/create-table，DDL 打印按 ARCHITECTURE S1 范围内属正确拒绝）；1 个 UNKNOWN（tmp/_verify_sign_pipeline_base.sql 文件本身残缺——CTE 列表后无最终 select，判 UNKNOWN 是正确行为）。三个补齐的缺口：`with ... insert overwrite`（CTE 前置 insert，内部脚本标准写法）、`!` 逻辑非（`and ! (...)`）、非保留关键字作显式 AS 别名（`as comment`）。
- Sources: S-0004（dogfood 属 T-0003）
- Scope: 2026-08-19 时点的内部数仓仓库内容
- Verified on: 2026-08-19
- As of: 2026-08-19
- Public-use boundary: unrestricted（内部路径与表名已泛化，具体指向存本地记忆）
- Notes: 主测文件（543 行实物签收口径 ETL）VALID_SUPPORTED、三重门禁全过；输出与校准语料风格一致（手写 2 空格/`from` 独行风格被 canonical 规范化属预期行为）

### F-0008｜DDL 支持后的真实覆盖率

- Status: verified
- Statement: create table（managed 形态：列定义/comment/partitioned by/row format serde/stored as/location/tblproperties）与 drop table 已进 parser+printer 覆盖。内部数仓两目录实测：ddl 目录 180/181 VALID_SUPPORTED（余 1 个 = create table like），脚本目录 175/178（余 2 个 = create table like 与 create temporary table ... as select，1 个 = 残缺 scratch）。CTAS/like/external/clustered by 等仍按范围外诚实拒绝，是后续覆盖候选。机器导出风格 DDL 被 canonical 规范成手写风格（小写、4 空格、不做列对齐、尾子句一行一个）。
- Sources: S-0004
- Scope: 2026-08-19 时点；DDL 排版规则取自手写 DDL 语料 49 份多数派
- Verified on: 2026-08-19
- As of: 2026-08-19
- Public-use boundary: unrestricted（内部标识已泛化）
- Notes: Q6（DDL 缩进 4 空格）已拍板选 A（D-0008）
