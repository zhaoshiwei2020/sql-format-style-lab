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
