# SQL Style Calibrator（VS Code 插件）

确定性、本地运行的 Hive SQL formatter。读取项目根目录（或最近父目录）的
`.sqlstyle.jsonc` 配置，把已支持的 HiveQL 收敛到唯一的规范化输出；遇到语法
错误、尚未支持的语法或无法判定的语法时，原文件**零改动**，详情写入 "SQL
Style" 输出面板。仅供作者本人日常 dogfood 使用，不发布 marketplace。

## 打包

在仓库根目录执行（会先跑 `build`，再用 `vsce` 打包，产出
`apps/vscode/sql-style-calibrator-<version>.vsix`）：

```bash
npm run package -w apps/vscode
```

## 安装

```bash
code --install-extension apps/vscode/sql-style-calibrator-0.0.1.vsix
```

## 推荐配置

在用户设置或 workspace 设置的 `settings.json` 中加入：

```jsonc
{
  "[sql]": {
    "editor.defaultFormatter": "local.sql-style-calibrator",
    "editor.formatOnSave": true
  }
}
```

（`local.sql-style-calibrator` = `publisher.name`，即 `package.json` 中的
`"publisher": "local"` + `"name": "sql-style-calibrator"`。）

## 命令

从命令面板（`Cmd+Shift+P`）运行，均以 `SQL Style:` 开头：

| 命令 | 作用 |
| --- | --- |
| Preview Formatting | 用 diff 视图预览格式化结果，不落盘 |
| Show Unsupported Syntax | 定位并跳转到导致无法格式化的语法位置 |
| Debug Parse | 输出词法/语法/覆盖率分析的详细信息，排查解析问题用 |
| Open Style Profile | 打开当前生效的 `.sqlstyle.jsonc`；找不到则可在 workspace 根目录创建一份 starter |

也可以直接用 VS Code 内建的 `Format Document`（或开启 `editor.formatOnSave`
后保存自动触发）。

## 四态行为

formatter 对每份文档的判定结果只有四种状态：

- **VALID_SUPPORTED**：语法合法且已支持 → 正常格式化，写回文档。
- **VALID_UNSUPPORTED** / **INVALID** / **UNKNOWN**：语法合法但暂未支持
  的构造、可证明的词法错误、或解析器无法判定 → **原文件零改动**，状态栏
  短暂提示 "SQL Style: 未格式化 (...)"，详情（具体到行列位置）写入 "SQL
  Style" 输出面板（`View > Output`，下拉选 "SQL Style"）。

任何非 VALID_SUPPORTED 状态都不会做"部分格式化"——要么整篇按规范输出，要么
完全不动源文件。

## 配置文件发现规则

从当前 SQL 文件所在目录开始向上查找 `.sqlstyle.jsonc`，直到 workspace 根目录
（或文件系统根）为止，取第一个命中的文件；找不到则用内置默认 profile。字段
说明见仓库根目录 `docs/style-schema.md` 与
`packages/core/schema/sqlstyle.schema.json`（本插件已通过 `jsonValidation`
贡献点为该文件名提供编辑器内自动补全与校验）。

## 更新插件

改了 `packages/core` 或 `apps/vscode/src` 代码后，重新打包并重装即可：

```bash
npm run package -w apps/vscode
code --install-extension apps/vscode/sql-style-calibrator-0.0.1.vsix
```

（版本号不变时 VS Code 也会覆盖安装；如需在扩展列表里明确看到版本变化，可
先bump `apps/vscode/package.json` 里的 `version`。）

## 开发调试（F5）

1. 用 VS Code 打开仓库根目录 `sql-format-style-lab`。
2. 按 F5 启动 "Extension Development Host"（若没有自动生成
   `launch.json`，可手动创建 `apps/vscode/.vscode/launch.json`）：

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

3. 在新窗口中打开 `.sql`/`.hql` 文件，从命令面板试跑上面几个命令。

持续构建（不打包）：

```bash
npm run watch -w apps/vscode
```

## 已知边界（S1）

- 只支持整篇文档格式化；选中范围格式化留待后续阶段。
- 只支持 `hive` 方言（Hive 1.1 基线）。
- 架构背景见仓库根目录 `ARCHITECTURE.md`（尤其 §9 配置、§11 执行流程、§14
  插件设计）。
