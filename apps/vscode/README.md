# SQL Style Calibrator（VS Code 插件）

确定性、本地运行的 Hive SQL formatter：读取项目根目录（或最近父目录）的
`.sqlstyle.jsonc` 配置，在保存/格式化时把已支持的 HiveQL 收敛到唯一的规范化
输出；遇到语法错误、尚未支持的语法或无法判定的语法时，原文件不做任何改动，
详情写入 "SQL Style" 输出面板。架构背景见仓库根目录 `ARCHITECTURE.md`（尤其
§9 配置、§11 执行流程、§14 插件设计）。

当前是 S1（个人使用）阶段的最小可用垂直切片：Format Document、Preview
Formatting、Show Unsupported Syntax、Debug Parse、Open Style Profile。

## 安装依赖

在仓库根目录执行一次（workspaces 会把 `apps/vscode` 的新增 devDependencies
一起装好，并把 `@sqlstyle/core` 软链接进 `node_modules`）：

```bash
npm install
```

## 构建

```bash
npm run build -w apps/vscode
```

等价地：

```bash
cd apps/vscode && npm run build
```

产物是单文件 `apps/vscode/dist/extension.cjs`（esbuild 打包，`platform:
node`、`format: cjs`，`vscode` 模块保持 external）。构建脚本同时会把
`packages/core/schema/sqlstyle.schema.json` 拷贝到
`apps/vscode/schema/sqlstyle.schema.json`，供 `jsonValidation` 贡献点使用。

开发时持续构建：

```bash
npm run watch -w apps/vscode
```

## 用 F5 调试

1. 用 VS Code 打开仓库根目录 `sql-format-style-lab`。
2. 打开 `apps/vscode` 文件夹作为窗口，或直接在根目录窗口按 F5 —— VS Code 会
   根据 `apps/vscode/package.json` 识别这是一个扩展项目并启动
   "Extension Development Host"。若没有自动生成 `launch.json`，可以手动创建
   `apps/vscode/.vscode/launch.json`：

   ```jsonc
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "extensionHost",
         "request": "launch",
         "name": "Run SQL Style Calibrator",
         "runtimeExecutable": "${execPath}",
         "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
         "outFiles": ["${workspaceFolder}/dist/**/*.cjs"],
         "preLaunchTask": "npm: build - apps/vscode"
       }
     ]
   }
   ```

3. 在新打开的 Extension Development Host 窗口中打开一个 `.sql`（或 `.hql`）
   文件，从命令面板运行：
   - `SQL Style: Preview Formatting`
   - `SQL Style: Show Unsupported Syntax`
   - `SQL Style: Debug Parse`
   - `SQL Style: Open Style Profile`
   - 或直接执行 VS Code 内建的 `Format Document`。

## 配置 Format on Save

插件注册的是标准 `DocumentFormattingEditProvider`，不自己监听保存事件。在
用户设置或 workspace 设置中启用（ARCHITECTURE.md §14.2）：

```jsonc
{
  "[sql]": {
    "editor.defaultFormatter": "local.sql-style-calibrator",
    "editor.formatOnSave": true
  }
}
```

`local.sql-style-calibrator` = `publisher.name`（`package.json` 中
`"publisher": "local"`，`"name": "sql-style-calibrator"`）。

## 配置文件

在项目根目录（或任意父目录）创建 `.sqlstyle.jsonc`，字段说明见
`docs/style-schema.md` 与 `packages/core/schema/sqlstyle.schema.json`（本插件
已通过 `jsonValidation` 贡献点为该文件名提供自动补全与校验）。命令
`SQL Style: Open Style Profile` 会打开当前生效的配置文件，找不到时可选择在
workspace 根目录创建一份最小 starter。

## 已知边界（S1）

- 只支持整篇文档格式化；选中范围格式化留待后续阶段。
- 只支持 `hive` 方言（Hive 1.1 基线）。
- 未知/尚未支持的语法：文档不做任何改动，原因写入输出面板，不做半篇格式化。
