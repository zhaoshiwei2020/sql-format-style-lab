# Decisions

### D-0001｜架构裁决以 ARCHITECTURE.md v0.3 §26 为准

- Status: active
- Decision: 产品定义与 ADR-001~014（校准器优先、canonical-only、四态诚实、Hive-first、AI 不进保存链路等）以 ARCHITECTURE.md v0.3 为唯一架构事实源；handoff 只引用不复制。
- Reason: 避免双事实源漂移；该文档经两轮双向钢人评审与用户澄清定稿。
- Decided on: 2026-08-19
- Evidence/inputs: S-0001
- Supersedes: none
- Superseded by: none
- Consequences: 架构变更必须改 ARCHITECTURE.md 并升版本号，不在 handoff 层"顺便"改

### D-0002｜DEFAULT_PROFILE.lineWidth = 78（实证暂定）

- Status: active
- Decision: 默认行宽取宽度扫描的经验最优 78，显著标注为待校准项。
- Reason: F-0002；比拍脑袋的 80/100 对语料拟合更好，且方法论与产品 Phase 3 候选 profile 搜索一致。
- Decided on: 2026-08-19
- Evidence/inputs: F-0002, S-0005
- Supersedes: none
- Superseded by: none
- Consequences: 校准题 Q1 拍板后可能被替代；替代时同步 profile.ts、schema、CLAUDE.md、docs/style-schema.md

### D-0003｜golden 红 3 例保留为校准信号

- Status: superseded
- Decision: case/05、07、11 的 golden 失败故意保留（= 校准题 Q2/Q3/Q4），未经用户拍板不得加 printer 特判转绿、不得改语料。
- Reason: 语料矛盾属审美主观决策，代答会掩盖产品核心循环（校准）应向用户暴露的问题。
- Decided on: 2026-08-19
- Evidence/inputs: F-0001, F-0003, S-0005
- Supersedes: none
- Superseded by: D-0006（2026-08-19 用户拍板 Q1~Q5，红测试已按拍板结果全部转绿）
- Consequences: CI/测试在拍板前保持非全绿；CLAUDE.md 铁律第 6 条与此对应（已随拍板更新）

### D-0004｜语料矛盾走 A/B 校准题流程，不过拟合

- Status: active
- Decision: printer 只实现可解释的确定性规则；与语料的分歧先跑 divergence-report 归因，可归因为语料矛盾的转化为校准题，不为单例加特判。
- Reason: 规则可解释性是 canonical 模式可预测性的前提（ARCHITECTURE R2）。
- Decided on: 2026-08-19
- Evidence/inputs: F-0001, S-0001, S-0004
- Supersedes: none
- Superseded by: none
- Consequences: 改 printer 前后必跑 divergence-report 对比（见 runbook）

### D-0005｜包管理用 npm workspaces

- Status: active
- Decision: 使用 npm workspaces（root package.json `workspaces` 字段），不用 pnpm。
- Reason: 本机无 pnpm（早期探测误报系 npm 回退输出）；Node 22 + npm 10 即满足需求。
- Decided on: 2026-08-19
- Evidence/inputs: S-0007
- Supersedes: none
- Superseded by: none
- Consequences: 文档/脚本一律 npm 语义；新增依赖注意放对 workspace（vscode 的 devDeps 在 apps/vscode）

### D-0006｜第一批校准题 Q1~Q5 拍板结果（用户，2026-08-19）

- Status: active
- Decision: Q1 = 暂维持 lineWidth 78（用户表示无明确偏好，dogfood 后再定，非终局）；Q2 = A（放得下的嵌套调用不为"视觉平行"断行，case/05 语料重生成）；Q3 = A（已展开参数列表内放得下的嵌套调用不拆，case/07 语料重生成）；Q4 = A（超宽就拆、无 cast 特例，case/11 语料重生成）；Q5 = 选"放得下就一行"（spark 优先）：删除"结构回声"规则，嵌套括号布尔组在任意深度独立按 compactMaxWidth 判断，case/03 语料重生成。
- Reason: 用户逐题拍板（Q3/Q4/Q5 经真实输出对比预览后确认）；Q2/Q3/Q5 取向一致——"一行放得下就保持一行"。
- Decided on: 2026-08-19
- Evidence/inputs: S-0004, F-0001, D-0003, D-0004
- Supersedes: D-0003（红测试保留的前提已消失，golden 已 13/13 全绿；"未经拍板不得改语料"的流程原则仍由 D-0004 延续）
- Superseded by: none
- Consequences: 语料复现 42/42、golden-pending 29/29、测试 256/256 全绿；后续新分歧继续走 divergence-report → A/B 校准题流程

### D-0007｜booleanGroup.compactMaxWidth 从 50 调整为 54

- Status: active
- Decision: 落地 Q5 时发现 spark §17 有 52 字符的组保持单行，超出旧阈值 50；对阈值做扫描，[52, 56] 区间内任意值均 42/42 复现语料（60+ 又出现该拆未拆），取窗口中点 54 为默认值。
- Reason: 与 lineWidth 78 同一方法论：阈值取实证窗口而非单点拟合，中点对未见样本最稳。
- Decided on: 2026-08-19
- Evidence/inputs: D-0006, F-0002（方法论同源）
- Supersedes: none
- Superseded by: none
- Consequences: profile.ts、两份 sqlstyle.schema.json（default 54）、docs/style-schema.md、CLAUDE.md 已同步；schema 中连带修正了遗留的 lineWidth default 100 → 78
