# Runbook

## Environment

- macOS (darwin 25.5), Node v22.22.3, npm 10.9.8；**无 pnpm**（用 npm workspaces，D-0005）— verified 2026-08-19
- Node 22 `--experimental-strip-types` 不会把 `./x.js` 相对导入重映射到 `x.ts`——scripts/ 下脚本用 `node:module` `register()` 内联 data: URL resolve hook 解决（scripts/dev-format.ts、divergence-report.ts、coverage-report.ts 均已内置）— verified 2026-08-19

## Verified commands（仓库根目录执行）

- `npm install` — 装依赖 — verified 2026-08-19 — 通过
- `npm run typecheck` — core 类型检查 — verified 2026-08-19 — 通过
- `./node_modules/.bin/vitest run` — 全量测试 — verified 2026-08-19 — 253/256（3 红=校准信号，F-0003）
- `node --experimental-strip-types packages/core/scripts/dev-format.ts <file.sql>` — CLI 试格式化（打印四态+诊断+输出）— verified 2026-08-19 — 通过
- `node --experimental-strip-types packages/core/scripts/divergence-report.ts` — 生成 docs/divergence-report.md — verified 2026-08-19 — pass=38 diverge=4 failed=0
- `node --experimental-strip-types packages/core/scripts/coverage-report.ts` — golden-pending 通过率表 — verified 2026-08-19（由子代理验证）
- `npm run build -w apps/vscode` — esbuild 打包插件 → apps/vscode/dist/extension.cjs — verified 2026-08-19（由子代理验证，120KB）
- VS Code F5 调试：仓库根打开 → Extension Development Host（apps/vscode/README.md 有 launch.json 样例与 formatOnSave 配置片段，formatter id `local.sql-style-calibrator`）

## Known gotchas

- vitest 收集 test/ 与 scripts/ 不在 core tsconfig include 里；类型检查它们用 packages/core/tsconfig.test.json（子代理建，勿并回主 tsconfig）— found 2026-08-19
- `npx tsc` 在未装 typescript 时会拉到一个假的 `tsc` 包——一律用 `./node_modules/.bin/tsc` — found 2026-08-19
- fixtures 的 input.sql 是 expected.sql 的空白打乱版；多语句/含注释 fixture 的打乱必须保留语句间空行与注释行结构（16-1、01-session-config 曾因此误报）— found 2026-08-19
