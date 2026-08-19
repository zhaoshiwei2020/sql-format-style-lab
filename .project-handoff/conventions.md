# Conventions

- 排版规则的事实层级：fixtures/golden > 源码/测试 > ARCHITECTURE.md > docs 生成物 > 注释 — Stated: 2026-08-19 — Basis: D-0001, C-0001, C-0002
- 改 printer/ 前后必跑 divergence-report 对比通过数（不许只看单例） — Stated: 2026-08-19 — Basis: D-0004
- 契约文件（tokens.ts / cst.ts / profile.ts / result.ts）为多模块共享，改动需检查 lexer/parser/printer/safety 四方 — Stated: 2026-08-19 — Basis: CLAUDE.md 铁律 3
- 多 agent 并行开发时按文件所有权分工，契约先行；子代理不得改契约文件，发现问题回报不擅改 — Stated: 2026-08-19 — Basis: 本次开发实践（零冲突）
- 与用户交流用中文；代码/注释保持现有英文风格 — Stated: 2026-08-19 — Basis: 会话惯例
