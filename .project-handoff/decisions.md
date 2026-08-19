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

- Status: active
- Decision: case/05、07、11 的 golden 失败故意保留（= 校准题 Q2/Q3/Q4），未经用户拍板不得加 printer 特判转绿、不得改语料。
- Reason: 语料矛盾属审美主观决策，代答会掩盖产品核心循环（校准）应向用户暴露的问题。
- Decided on: 2026-08-19
- Evidence/inputs: F-0001, F-0003, S-0005
- Supersedes: none
- Superseded by: none
- Consequences: CI/测试在拍板前保持非全绿；CLAUDE.md 铁律第 6 条与此对应

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
